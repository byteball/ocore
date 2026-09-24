/*jslint node: true */
'use strict';
// Deletes the ledger data (sqlite rows + rocksdb entries) described in a dump file produced by
// tools/dump_units_by_last_ball_mci.js from the live databases, then restores it from that same
// dump file. Intended as an offline maintenance operation: stop the node before running this.
//
// Usage:
//   node tools/restore_units_by_last_ball_mci.js <dump_file> [--yes] [--force]
//
//   --yes    skip the interactive confirmation prompt
//   --force  proceed even if external references into the pruned set are detected (dangerous)
const fs = require('fs');
const readline = require('readline');
const _ = require('lodash');
const db = require('../db.js');
const archive = require('./lib/unit_mci_archive.js');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const dump_file = args[0];
const bYes = flags.includes('--yes');
const bForce = flags.includes('--force');

if (!dump_file) {
	console.error('Usage: node tools/restore_units_by_last_ball_mci.js <dump_file> [--yes] [--force]');
	process.exit(1);
}

function confirm(question) {
	if (bYes)
		return Promise.resolve(true);
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	return new Promise(resolve => {
		rl.question(question, answer => {
			rl.close();
			resolve(answer.trim() === 'YES');
		});
	});
}

function runInTransaction(doWork) {
	return new Promise((resolve, reject) => {
		db.executeInTransaction((conn, cb) => {
			doWork(conn).then(() => cb(), err => cb(err || Error('transaction failed')));
		}, err => err ? reject(err) : resolve());
	});
}

// SELECT * column order isn't guaranteed to be the same between the dump-time query and the
// post-restore verification query, so keys are sorted here to get an order-independent, stable
// representation for both sorting/pairing rows and diffing them
function canonicalRow(row) {
	const filtered = { ...row };
	archive.LOCAL_AUTOINCREMENT_COLUMNS.forEach(column => delete filtered[column]);
	const sorted = {};
	Object.keys(filtered).sort().forEach(column => { sorted[column] = filtered[column]; });
	return sorted;
}

function sortedCanonicalRows(rows) {
	return rows.map(canonicalRow).sort((a, b) => {
		const sa = JSON.stringify(a);
		const sb = JSON.stringify(b);
		return sa < sb ? -1 : (sa > sb ? 1 : 0);
	});
}

function rowsEqual(rowsA, rowsB) {
	const a = sortedCanonicalRows(rowsA);
	const b = sortedCanonicalRows(rowsB);
	return a.length === b.length && a.every((row, i) => _.isEqual(row, b[i]));
}

// writes both sides of a mismatch to pretty-printed json files (same sort order as rowsEqual used to
// compare them) so they can be diffed directly, e.g. `diff <table>_expected.json <table>_actual.json`
function writeMismatchFiles(table, arrExpectedRows, arrActualRows) {
	const arrExpected = sortedCanonicalRows(arrExpectedRows);
	const arrActual = sortedCanonicalRows(arrActualRows);
	const expected_file = table + '_expected.json';
	const actual_file = table + '_actual.json';
	fs.writeFileSync(expected_file, JSON.stringify(arrExpected, null, 2));
	fs.writeFileSync(actual_file, JSON.stringify(arrActual, null, 2));
	console.log('    wrote ' + expected_file + ' and ' + actual_file + ' for diffing');
}

async function main() {
	console.log('reading dump file ' + dump_file + ' ...');
	const dump = JSON.parse(fs.readFileSync(dump_file, 'utf8'));
	const arrUnits = dump.units;
	console.log('dump contains ' + arrUnits.length + ' unit(s), min_last_ball_mci=' + dump.min_last_ball_mci + ', created_at=' + dump.created_at);

	// the delete step operates on whatever currently has last_ball_mci >= threshold, which may have
	// grown since the dump was taken, not just the unit set frozen in the dump file
	const arrUnitsToDelete = await archive.getMatchingUnits(dump.min_last_ball_mci);
	console.log(arrUnitsToDelete.length + ' live unit(s) currently have last_ball_mci >= ' + dump.min_last_ball_mci + ' and will be deleted');
	if (arrUnitsToDelete.length === 0 && arrUnits.length === 0) {
		console.log('nothing to do');
		return;
	}

	const dump_mci_tables = dump.mci_tables || {};
	const arrViolations = await archive.findExternalReferences(arrUnitsToDelete);
	if (arrViolations.length > 0) {
		console.warn('\nfound references into the set from units outside it:');
		arrViolations.forEach(v => console.warn(' - ' + v.description + ' (' + v.count + ' row(s)): ' + JSON.stringify(v.examples)));
		if (!bForce)
			throw Error('refusing to proceed (pass --force to override at your own risk)');
		console.warn('--force given, proceeding anyway\n');
	}

	console.log('\nabout to DELETE data for ' + arrUnitsToDelete.length + ' live unit(s) and RESTORE data for ' + arrUnits.length + ' dumped unit(s):');
	for (let table_spec of archive.TABLE_SPECS) {
		const rows = dump.tables[table_spec.table] || [];
		if (rows.length > 0)
			console.log('  ' + table_spec.table + ': ' + rows.length + ' row(s) to restore');
	}
	for (let mci_table_spec of archive.MCI_TABLE_SPECS) {
		const rows = dump_mci_tables[mci_table_spec.table] || [];
		if (rows.length > 0)
			console.log('  ' + mci_table_spec.table + ': ' + rows.length + ' row(s) to restore');
	}
	console.log('  rocksdb joints: ' + dump.kv.joints.length + ', data feed kv entries: ' + dump.kv.data_feeds.length + ' to restore');

	const bConfirmed = await confirm('\nType YES to proceed: ');
	if (!bConfirmed) {
		console.log('aborted');
		return;
	}

	console.log('\ndeleting rocksdb entries...');
	if (arrUnitsToDelete.length > 0) {
		const arrJointEntriesToDelete = await archive.getJointKvEntries(arrUnitsToDelete);
		const assocJointsByUnit = {};
		arrJointEntriesToDelete.forEach(entry => { assocJointsByUnit[entry.key.slice('j\n'.length)] = entry.value; });
		const arrDataFeedEntriesToDelete = await archive.getDataFeedKvEntries(arrUnitsToDelete, assocJointsByUnit);
		await archive.kvBatchDel(arrJointEntriesToDelete);
		await archive.kvBatchDel(arrDataFeedEntriesToDelete);
	}

	console.log('deleting sqlite rows...');
	await runInTransaction(async conn => {
		// outputs/headers_commission_outputs/witnessing_outputs rows owned by a unit below the threshold
		// are not otherwise touched, but the inputs being deleted here may be the only thing keeping them
		// marked as spent
		const arrTransferRowsToUnspend = await archive.getTransferOutputsToUnspend(conn, arrUnitsToDelete);
		await archive.unspendTransferOutputs(conn, arrTransferRowsToUnspend);
		console.log('  unspent ' + arrTransferRowsToUnspend.length + ' outputs row(s)');
		for (let type of ['headers_commission', 'witnessing']) {
			const arrRowsToUnspend = await archive.getMciOutputsToUnspend(conn, type, arrUnitsToDelete);
			await archive.unspendMciOutputs(conn, type, arrRowsToUnspend);
			console.log('  unspent ' + arrRowsToUnspend.length + ' ' + type + '_outputs row(s)');
		}
		for (let table_spec of archive.TABLE_SPECS) {
			const result = await archive.deleteRows(conn, table_spec, arrUnitsToDelete);
			console.log('  deleted from ' + table_spec.table + ': ' + (result.affectedRows || 0) + ' row(s)');
		}
		for (let mci_table_spec of archive.MCI_TABLE_SPECS) {
			const result = await archive.deleteMciRows(conn, mci_table_spec, dump.min_last_ball_mci);
			console.log('  deleted from ' + mci_table_spec.table + ': ' + (result.affectedRows || 0) + ' row(s)');
		}
	});

	console.log('\nrestoring rocksdb entries...');
	await archive.kvBatchPut(dump.kv.joints);
	await archive.kvBatchPut(dump.kv.data_feeds);

	console.log('restoring sqlite rows...');
	await runInTransaction(async conn => {
		const arrReversedSpecs = archive.TABLE_SPECS.slice().reverse();
		for (let table_spec of arrReversedSpecs) {
			const rows = dump.tables[table_spec.table] || [];
			await archive.insertRows(conn, table_spec.table, rows);
			console.log('  restored into ' + table_spec.table + ': ' + rows.length + ' row(s)');
		}
		for (let mci_table_spec of archive.MCI_TABLE_SPECS) {
			const rows = dump_mci_tables[mci_table_spec.table] || [];
			await archive.insertRows(conn, mci_table_spec.table, rows);
			console.log('  restored into ' + mci_table_spec.table + ': ' + rows.length + ' row(s)');
		}
		// re-mark headers_commission/witnessing_outputs spent by the just-restored inputs, same UPDATE writer.js issues when they were first written
		await archive.respendOutputs(conn, dump.tables.inputs || []);
	});

	console.log('\nverifying restore...');
	let bAllOk = true;
	for (let table_spec of archive.TABLE_SPECS) {
		const arrExpectedRows = dump.tables[table_spec.table] || [];
		const arrActualRows = await archive.selectRows(table_spec, arrUnits);
		const bOk = rowsEqual(arrExpectedRows, arrActualRows);
		if (!bOk) {
			bAllOk = false;
			writeMismatchFiles(table_spec.table, arrExpectedRows, arrActualRows);
		}
		console.log('  ' + table_spec.table + ': ' + (bOk ? 'OK' : 'MISMATCH, expected ' + arrExpectedRows.length + ' got ' + arrActualRows.length));
	}
	for (let mci_table_spec of archive.MCI_TABLE_SPECS) {
		const arrExpectedRows = dump_mci_tables[mci_table_spec.table] || [];
		const arrActualRows = await archive.selectMciRows(mci_table_spec, dump.min_last_ball_mci);
		const bOk = rowsEqual(arrExpectedRows, arrActualRows);
		if (!bOk) {
			bAllOk = false;
			writeMismatchFiles(mci_table_spec.table, arrExpectedRows, arrActualRows);
		}
		console.log('  ' + mci_table_spec.table + ': ' + (bOk ? 'OK' : 'MISMATCH, expected ' + arrExpectedRows.length + ' got ' + arrActualRows.length));
	}
	for (let entry of dump.kv.joints.concat(dump.kv.data_feeds)) {
		const value = await new Promise(resolve => require('../kvstore.js').get(entry.key, resolve));
		if (value !== entry.value) {
			bAllOk = false;
			console.log('  kv MISMATCH for key ' + entry.key);
		}
	}
	console.log(bAllOk ? '\nrestore verified successfully' : '\nrestore verification FAILED, please inspect the database manually');
}

main().then(() => {
	process.exit(0);
}, err => {
	console.error(err);
	process.exit(1);
});
