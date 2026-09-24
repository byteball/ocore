/*jslint node: true */
'use strict';
// Shared logic used by tools/dump_units_by_last_ball_mci.js and tools/restore_units_by_last_ball_mci.js.
//
// Scope: this only covers immutable, append-only, per-unit ledger data (the same class of data that
// archiving.js removes when a unit is voided/uncovered), plus the corresponding rocksdb entries
// ('j\n' joints and 'df\n'/'dfv\n' data feed index entries).
//
// Note: the sqlite `data_feeds` table is legacy and no longer written to (writer.js has that code
// path commented out; data feeds are indexed only in rocksdb now), so it's not in TABLE_SPECS.
//
// Explicitly OUT OF SCOPE (not dumped/deleted/restored), because they hold cumulative/current-state
// data that is not meaningfully attributable to a single unit and cannot be "rolled back" per unit:
//   - aa_balances (sqlite)              - running AA balances
//   - 'st\n' address+var_name (rocksdb) - current AA state vars
//   - op_votes, numerical_votes, system_vars, node_vars (sqlite) - latest-value tables
// If the pruned range contains AA activity, those tables are left untouched by design: since this
// tool only ever does a delete-then-restore round trip (not a permanent rollback), that's safe as
// long as nothing else writes to the database between the delete and restore phases.
const db = require('../../db.js');
const kvstore = require('../../kvstore.js');
const string_utils = require('../../string_utils.js');
const constants = require('../../constants.js');

// Ordered so that deleting top-to-bottom never violates a foreign key (dependents before what they
// reference). Restoring must insert in the reverse order.
const TABLE_SPECS = [
	{ table: 'aa_responses', columns: ['trigger_unit', 'response_unit'] },
	{ table: 'aa_triggers', columns: ['unit'] },
	{ table: 'aa_addresses', columns: ['unit'] },
	{ table: 'system_votes', columns: ['unit'] },
	{ table: 'headers_commission_contributions', columns: ['unit'] },
	{ table: 'earned_headers_commission_recipients', columns: ['unit'] },
	{ table: 'spend_proofs', columns: ['unit'] },
	{ table: 'asset_attestors', columns: ['unit', 'asset'] },
	{ table: 'asset_denominations', columns: ['asset'] },
	{ table: 'asset_metadata', columns: ['asset', 'metadata_unit'] },
	{ table: 'inputs', columns: ['unit'] },
	{ table: 'outputs', columns: ['unit'] },
	{ table: 'assets', columns: ['unit'] },
	{ table: 'address_definition_changes', columns: ['unit'] },
	{ table: 'attested_fields', columns: ['unit'] },
	{ table: 'attestations', columns: ['unit'] },
	{ table: 'votes', columns: ['unit'] },
	{ table: 'poll_choices', columns: ['unit'] },
	{ table: 'polls', columns: ['unit'] },
	{ table: 'original_addresses', columns: ['unit'] },
	{ table: 'sent_mnemonics', columns: ['unit'] },
	{ table: 'messages', columns: ['unit'] },
	{ table: 'unit_witnesses', columns: ['unit'] },
	{ table: 'authentifiers', columns: ['unit'] },
	{ table: 'unit_authors', columns: ['unit'] },
	{ table: 'witness_list_hashes', columns: ['witness_list_unit'] },
	{ table: 'skiplist_units', columns: ['unit', 'skiplist_unit'] },
	{ table: 'parenthoods', columns: ['child_unit', 'parent_unit'] },
	{ table: 'balls', columns: ['unit'] },
	{ table: 'joints', columns: ['unit'] },
	{ table: 'units', columns: ['unit'] },
];

// headers_commission_outputs/witnessing_outputs/tps_fees_balances have no unit column: they are keyed
// by mci directly (tps_fees_balances is an append-only per-mci log, not a latest-value table), so
// they are pruned directly by that mci instead of by a set of units
const MCI_TABLE_SPECS = [
	{ table: 'headers_commission_outputs', mci_column: 'main_chain_index' },
	{ table: 'witnessing_outputs', mci_column: 'main_chain_index' },
	{ table: 'tps_fees_balances', mci_column: 'mci' },
];

function buildWhereClause(columns) {
	return columns.map(column => column + ' IN(?)').join(' OR ');
}

// rows matching this table for the given set of units
async function selectRows(table_spec, arrUnits) {
	if (arrUnits.length === 0)
		return [];
	const params = table_spec.columns.map(() => arrUnits);
	// ORDER BY rowid so the dump preserves insertion order and restore re-inserts rows in the same order
	return await db.query('SELECT * FROM ' + table_spec.table + ' WHERE ' + buildWhereClause(table_spec.columns) + ' ORDER BY +rowid', params);
}

async function deleteRows(conn, table_spec, arrUnits) {
	if (arrUnits.length === 0)
		return { affectedRows: 0 };
	const params = table_spec.columns.map(() => arrUnits);
	return await conn.query('DELETE FROM ' + table_spec.table + ' WHERE ' + buildWhereClause(table_spec.columns), params);
}

// rows matching this mci-keyed table for the given threshold
async function selectMciRows(mci_table_spec, min_last_ball_mci) {
	return await db.query('SELECT * FROM ' + mci_table_spec.table + ' WHERE ' + mci_table_spec.mci_column + '>=? ORDER BY +rowid', [min_last_ball_mci]);
}

async function deleteMciRows(conn, mci_table_spec, min_last_ball_mci) {
	return await conn.query('DELETE FROM ' + mci_table_spec.table + ' WHERE ' + mci_table_spec.mci_column + '>=?', [min_last_ball_mci]);
}

// local AUTOINCREMENT surrogate keys, not referenced by any other table, that get reassigned new
// values on restore (aa_response_id is just a monotonic ordering seq) - exclude from INSERT and
// from the post-restore verification diff, since the new values are expected to differ from the dump
const LOCAL_AUTOINCREMENT_COLUMNS = ['output_id'];

async function insertRows(conn, table, rows) {
	if (rows.length === 0)
		return;
	const columns = Object.keys(rows[0]).filter(column => !LOCAL_AUTOINCREMENT_COLUMNS.includes(column));
	const sql = 'INSERT INTO ' + table + ' (' + columns.join(', ') + ') VALUES (' + columns.map(() => '?').join(', ') + ')';
	for (let row of rows)
		await conn.query(sql, columns.map(column => row[column]));
}

// units whose last ball's main_chain_index is >= min_last_ball_mci
async function getMatchingUnits(min_last_ball_mci) {
	// done as two indexed lookups (byMcIndex, then byLB) instead of a join, which would otherwise
	// force a full scan of the units table since the mci filter only applies to the joined-in side
	const lb_rows = await db.query('SELECT unit FROM units WHERE main_chain_index>=?', [min_last_ball_mci]);
	if (lb_rows.length === 0)
		return [];
	const rows = await db.query(
		'SELECT unit FROM units WHERE last_ball_unit IN(?) ORDER BY rowid',
		[lb_rows.map(row => row.unit)]
	);
	return rows.map(row => row.unit);
}

// looks for rows outside arrUnits that reference into arrUnits through a foreign key;
// deleting arrUnits while such references exist would either violate FK constraints or silently
// leave the surviving data referencing rows that were removed and later restored out of order
async function findExternalReferences(arrUnits) {
	if (arrUnits.length === 0)
		return [];
	const arrViolations = [];

	const check = async (description, sql, params) => {
		const rows = await db.query(sql, params);
		if (rows.length > 0)
			arrViolations.push({ description: description, count: rows.length, examples: rows.slice(0, 5) });
	};
	const arrUnitsSet = new Set(arrUnits);

	await check(
		'units.last_ball_unit points into the set from a unit outside it',
		'SELECT unit, last_ball_unit FROM units WHERE last_ball_unit IN(?) AND unit NOT IN(?) LIMIT 100',
		[arrUnits, arrUnits]
	);
	await check(
		'units.best_parent_unit points into the set from a unit outside it',
		'SELECT unit, best_parent_unit FROM units WHERE best_parent_unit IN(?) AND unit NOT IN(?) LIMIT 100',
		[arrUnits, arrUnits]
	);
	await check(
		'parenthoods.parent_unit is in the set but child_unit is not',
		'SELECT child_unit, parent_unit FROM parenthoods WHERE parent_unit IN(?) AND child_unit NOT IN(?) LIMIT 100',
		[arrUnits, arrUnits]
	);
	await check(
		'inputs.src_unit is in the set but the spending unit is not',
		'SELECT unit, src_unit FROM inputs WHERE src_unit IN(?) AND unit NOT IN(?) LIMIT 100',
		[arrUnits, arrUnits]
	);
	// asset IN(?) against the (possibly huge) arrUnits list forces a full scan of outputs/inputs; assets
	// are rare, so it's much faster to first shrink to the few arrUnits that are actually asset-defining
	// units (a small scan of the assets table) and filter unit NOT IN(?) in JS instead of in SQL
	const asset_rows = await db.query('SELECT unit FROM assets WHERE unit IN(?)', [arrUnits]);
	const arrPrunedAssets = asset_rows.map(row => row.unit);
	if (arrPrunedAssets.length > 0) {
		const output_rows = await db.query('SELECT unit, asset FROM outputs WHERE asset IN(?)', [arrPrunedAssets]);
		const arrExternalOutputRows = output_rows.filter(row => !arrUnitsSet.has(row.unit)).slice(0, 100);
		if (arrExternalOutputRows.length > 0)
			arrViolations.push({ description: 'outputs.asset is defined by a unit in the set but the output-holding unit is not', count: arrExternalOutputRows.length, examples: arrExternalOutputRows.slice(0, 5) });

		const input_rows = await db.query('SELECT unit, asset FROM inputs WHERE asset IN(?)', [arrPrunedAssets]);
		const arrExternalInputRows = input_rows.filter(row => !arrUnitsSet.has(row.unit)).slice(0, 100);
		if (arrExternalInputRows.length > 0)
			arrViolations.push({ description: 'inputs.asset is defined by a unit in the set but the spending unit is not', count: arrExternalInputRows.length, examples: arrExternalInputRows.slice(0, 5) });
	}

	const aa_address_rows = await db.query('SELECT address FROM aa_addresses WHERE unit IN(?)', [arrUnits]);
	const arrAAAddresses = aa_address_rows.map(row => row.address);
	if (arrAAAddresses.length > 0) {
		await check(
			'aa_addresses.base_aa points to an AA defined in the set from an AA outside it',
			'SELECT address, base_aa FROM aa_addresses WHERE base_aa IN(?) AND address NOT IN(?) LIMIT 100',
			[arrAAAddresses, arrAAAddresses]
		);
		await check(
			'aa_triggers references an AA defined in the set from a trigger unit outside it',
			'SELECT unit, address FROM aa_triggers WHERE address IN(?) AND unit NOT IN(?) LIMIT 100',
			[arrAAAddresses, arrUnits]
		);
		await check(
			'aa_responses references an AA defined in the set from a trigger/response unit outside it',
			'SELECT trigger_unit, response_unit, aa_address FROM aa_responses WHERE aa_address IN(?) AND trigger_unit NOT IN(?) AND (response_unit IS NULL OR response_unit NOT IN(?)) LIMIT 100',
			[arrAAAddresses, arrUnits, arrUnits]
		);
	}

	return arrViolations;
}

// headers_commission_outputs/witnessing_outputs rows below the threshold (so not otherwise dumped or
// deleted) can still be marked spent by an inputs row belonging to a unit being deleted; find them so
// their is_spent flag can be reset, mirroring archiving.js's unspending of archived units' claims
async function getMciOutputsToUnspend(conn, type, arrUnits) {
	if (arrUnits.length === 0)
		return [];
	const table = type + '_outputs';
	return await conn.query(
		`SELECT DISTINCT ${table}.address, ${table}.main_chain_index
		FROM inputs
		CROSS JOIN ${table}
			ON inputs.from_main_chain_index<=${table}.main_chain_index
			AND inputs.to_main_chain_index>=${table}.main_chain_index
			AND inputs.address=${table}.address
		WHERE inputs.unit IN(?)
			AND inputs.type=?
			AND NOT EXISTS (
				SELECT 1 FROM inputs AS alt_inputs
				WHERE ${table}.main_chain_index>=alt_inputs.from_main_chain_index
					AND ${table}.main_chain_index<=alt_inputs.to_main_chain_index
					AND alt_inputs.address=${table}.address
					AND alt_inputs.type=?
					AND alt_inputs.unit NOT IN(?)
			)`,
		[arrUnits, type, type, arrUnits]
	);
}

async function unspendMciOutputs(conn, type, arrRows) {
	const table = type + '_outputs';
	for (let row of arrRows)
		await conn.query('UPDATE ' + table + ' SET is_spent=0 WHERE address=? AND main_chain_index=?', [row.address, row.main_chain_index]);
}

// same idea as getMciOutputsToUnspend, but for regular (transfer) outputs, keyed by unit/message_index/
// output_index instead of address/mci; mirrors archiving.js's generateQueriesToUnspendTransferOutputsSpentInArchivedUnit
async function getTransferOutputsToUnspend(conn, arrUnits) {
	if (arrUnits.length === 0)
		return [];
	return await conn.query(
		`SELECT DISTINCT src_unit, src_message_index, src_output_index
		FROM inputs
		WHERE inputs.unit IN(?)
			AND inputs.type='transfer'
			AND NOT EXISTS (
				SELECT 1 FROM inputs AS alt_inputs
				WHERE inputs.src_unit=alt_inputs.src_unit
					AND inputs.src_message_index=alt_inputs.src_message_index
					AND inputs.src_output_index=alt_inputs.src_output_index
					AND alt_inputs.type='transfer'
					AND alt_inputs.unit NOT IN(?)
			)`,
		[arrUnits, arrUnits]
	);
}

async function unspendTransferOutputs(conn, arrRows) {
	for (let row of arrRows)
		await conn.query(
			'UPDATE outputs SET is_spent=0 WHERE unit=? AND message_index=? AND output_index=?',
			[row.src_unit, row.src_message_index, row.src_output_index]
		);
}

// re-applies the same UPDATE writer.js issues when an inputs row is first written, so restoring the
// dumped inputs rows also restores the is_spent flag they set on outputs/headers_commission/witnessing_outputs
async function respendOutputs(conn, arrInputRows) {
	for (let row of arrInputRows) {
		if (row.type === 'transfer') {
			await conn.query(
				'UPDATE outputs SET is_spent=1 WHERE unit=? AND message_index=? AND output_index=?',
				[row.src_unit, row.src_message_index, row.src_output_index]
			);
			continue;
		}
		if (row.type !== 'headers_commission' && row.type !== 'witnessing')
			continue;
		const table = row.type + '_outputs';
		await conn.query(
			'UPDATE ' + table + ' SET is_spent=1 WHERE main_chain_index>=? AND main_chain_index<=? AND address=?',
			[row.from_main_chain_index, row.to_main_chain_index, row.address]
		);
	}
}

// derives the rocksdb data feed keys ('df\n...' and 'dfv\n...') posted by the given units from their
// joint JSON (the sqlite data_feeds table is legacy and no longer written to, see writer.js), and
// reads the current live value so the dump captures exactly what is stored
async function getDataFeedKvEntries(arrUnits, assocJointsByUnit) {
	if (arrUnits.length === 0)
		return [];
	const mci_rows = await db.query('SELECT unit, main_chain_index FROM units WHERE unit IN(?)', [arrUnits]);
	const assocMcisByUnit = {};
	mci_rows.forEach(row => { assocMcisByUnit[row.unit] = row.main_chain_index; });

	const assocKeys = {}; // dedupe: several units/authors can derive the same key
	for (let unit of arrUnits) {
		const mci = assocMcisByUnit[unit];
		if (mci === null || mci === undefined) // not on the stable main chain, no data feed kv entries were posted for it
			continue;
		const objJoint = JSON.parse(assocJointsByUnit[unit]);
		const arrAuthorAddresses = objJoint.unit.authors.map(author => author.address);
		const strMci = string_utils.encodeMci(mci);
		(objJoint.unit.messages || []).forEach(message => {
			if (message.app !== 'data_feed')
				return;
			for (let feed_name in message.payload) {
				const value = message.payload[feed_name];
				let strValue = null, numValue = null;
				if (typeof value === 'string') {
					strValue = value;
					const bLimitedPrecision = (mci < constants.aa2UpgradeMci);
					const float = string_utils.toNumber(value, bLimitedPrecision);
					if (float !== null)
						numValue = string_utils.encodeDoubleInLexicograpicOrder(float);
				}
				else
					numValue = string_utils.encodeDoubleInLexicograpicOrder(value);
				arrAuthorAddresses.forEach(address => {
					if (strValue !== null)
						assocKeys['df\n' + address + '\n' + feed_name + '\ns\n' + strValue + '\n' + strMci] = true;
					if (numValue !== null)
						assocKeys['df\n' + address + '\n' + feed_name + '\nn\n' + numValue + '\n' + strMci] = true;
					assocKeys['dfv\n' + address + '\n' + feed_name + '\n' + strMci] = true;
				});
			}
		});
	}
	const arrEntries = [];
	for (let key in assocKeys) {
		const value = await new Promise(resolve => kvstore.get(key, resolve));
		if (value !== undefined && value !== null)
			arrEntries.push({ key: key, value: value });
	}
	return arrEntries;
}

async function getJointKvEntries(arrUnits) {
	const arrEntries = [];
	for (let unit of arrUnits) {
		const key = 'j\n' + unit;
		const value = await new Promise(resolve => kvstore.get(key, resolve));
		if (value === undefined || value === null)
			throw Error('joint not found in rocksdb for unit ' + unit);
		arrEntries.push({ key: key, value: value });
	}
	return arrEntries;
}

function kvBatchDel(arrEntries) {
	if (arrEntries.length === 0)
		return Promise.resolve();
	const batch = kvstore.batch();
	arrEntries.forEach(entry => batch.del(entry.key));
	return new Promise((resolve, reject) => {
		batch.write({ sync: true }, err => err ? reject(Error(err)) : resolve());
	});
}

function kvBatchPut(arrEntries) {
	if (arrEntries.length === 0)
		return Promise.resolve();
	const batch = kvstore.batch();
	arrEntries.forEach(entry => batch.put(entry.key, entry.value));
	return new Promise((resolve, reject) => {
		batch.write({ sync: true }, err => err ? reject(Error(err)) : resolve());
	});
}

exports.TABLE_SPECS = TABLE_SPECS;
exports.LOCAL_AUTOINCREMENT_COLUMNS = LOCAL_AUTOINCREMENT_COLUMNS;
exports.MCI_TABLE_SPECS = MCI_TABLE_SPECS;
exports.selectRows = selectRows;
exports.deleteRows = deleteRows;
exports.insertRows = insertRows;
exports.selectMciRows = selectMciRows;
exports.deleteMciRows = deleteMciRows;
exports.getMatchingUnits = getMatchingUnits;
exports.findExternalReferences = findExternalReferences;
exports.getMciOutputsToUnspend = getMciOutputsToUnspend;
exports.unspendMciOutputs = unspendMciOutputs;
exports.getTransferOutputsToUnspend = getTransferOutputsToUnspend;
exports.unspendTransferOutputs = unspendTransferOutputs;
exports.respendOutputs = respendOutputs;
exports.getDataFeedKvEntries = getDataFeedKvEntries;
exports.getJointKvEntries = getJointKvEntries;
exports.kvBatchDel = kvBatchDel;
exports.kvBatchPut = kvBatchPut;
