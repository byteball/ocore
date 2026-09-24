/*jslint node: true */
'use strict';
// Dumps all ledger data (sqlite rows + rocksdb entries) belonging to units whose last ball mci is
// >= a given threshold, to a single JSON file. Read-only, makes no changes to any database.
//
// Usage:
//   node tools/dump_units_by_last_ball_mci.js <min_last_ball_mci> [output_file]
//
// See tools/lib/unit_mci_archive.js for exactly what is (and isn't) covered.
// See tools/restore_units_by_last_ball_mci.js to delete this data from the live databases and
// restore it from the produced dump file.
const fs = require('fs');
const path = require('path');
const db = require('../db.js');
const archive = require('./lib/unit_mci_archive.js');

const min_last_ball_mci = parseInt(process.argv[2], 10);
if (!Number.isInteger(min_last_ball_mci) || min_last_ball_mci < 0) {
	console.error('Usage: node tools/dump_units_by_last_ball_mci.js <min_last_ball_mci> [output_file]');
	process.exit(1);
}
const output_file = process.argv[3] || path.join(__dirname, 'unit_dump_mci' + min_last_ball_mci + '_' + Date.now() + '.json');

async function main() {
	console.log('looking for units whose last ball mci >= ' + min_last_ball_mci + ' ...');
	const arrUnits = await archive.getMatchingUnits(min_last_ball_mci);
	console.log('found ' + arrUnits.length + ' matching units');
	if (arrUnits.length === 0) {
		console.log('nothing to dump');
		return;
	}

	const arrViolations = await archive.findExternalReferences(arrUnits);
	if (arrViolations.length > 0) {
		console.warn('\nWARNING: found references into the matching set from units outside it.');
		console.warn('Restoring from this dump after deletion may fail or leave the database inconsistent:');
		arrViolations.forEach(v => console.warn(' - ' + v.description + ' (' + v.count + ' row(s))'));
		console.warn('');
	}

	const tables = {};
	for (let table_spec of archive.TABLE_SPECS) {
		const rows = await archive.selectRows(table_spec, arrUnits);
		if (rows.length > 0)
			tables[table_spec.table] = rows;
		console.log('  ' + table_spec.table + ': ' + rows.length + ' row(s)');
	}

	const mci_tables = {};
	for (let mci_table_spec of archive.MCI_TABLE_SPECS) {
		const rows = await archive.selectMciRows(mci_table_spec, min_last_ball_mci);
		if (rows.length > 0)
			mci_tables[mci_table_spec.table] = rows;
		console.log('  ' + mci_table_spec.table + ': ' + rows.length + ' row(s)');
	}

	console.log('reading rocksdb joints...');
	const joints = await archive.getJointKvEntries(arrUnits);
	const assocJointsByUnit = {};
	joints.forEach(entry => { assocJointsByUnit[entry.key.slice(2)] = entry.value; });
	console.log('reading rocksdb data feed entries...');
	const data_feeds = await archive.getDataFeedKvEntries(arrUnits, assocJointsByUnit);
	console.log('  joints: ' + joints.length + ', data feed kv entries: ' + data_feeds.length);

	const dump = {
		version: 1,
		min_last_ball_mci: min_last_ball_mci,
		created_at: new Date().toISOString(),
		units: arrUnits,
		tables: tables,
		mci_tables: mci_tables,
		kv: { joints: joints, data_feeds: data_feeds },
	};

	fs.writeFileSync(output_file, JSON.stringify(dump));
	console.log('\ndump written to ' + output_file);
}

main().then(() => {
	process.exit(0);
}, err => {
	console.error(err);
	process.exit(1);
});
