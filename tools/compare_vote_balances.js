/*jslint node: true */
'use strict';
// Compares voter balance calculations for system_vote subjects using two methods:
//   OLD: bal_rows (is_spent=0 stable-good) + spent_rows (unstable-good spending stable-good)
//   NEW: stable-good outputs with no stable-good spender (NOT EXISTS)
//
// A difference means the OLD method undercounts a voter's balance because a future
// unstable unit spent their stable output and was later propagated to final-bad,
// leaving is_spent=1 on the output while no good unit claims it in spent_rows.
//
// Usage: node tools/compare_vote_balances.js

const db = require('../db.js');

async function balancesOldWay(addresses) {
	const strAddresses = addresses.map(db.escape).join(', ');

	const bal_rows = await db.query(`
		SELECT address, SUM(amount) AS balance
		FROM outputs
		LEFT JOIN units USING(unit)
		WHERE address IN(${strAddresses}) AND is_spent=0 AND asset IS NULL AND is_stable=1 AND sequence='good'
		GROUP BY address`);

	const balances = {};
	for (const { address, balance } of bal_rows)
		balances[address] = balance || 0;

	const spent_rows = await db.query(`
		SELECT inputs.address, SUM(outputs.amount) AS spent_balance
		FROM units
		CROSS JOIN inputs USING(unit)
		CROSS JOIN outputs ON src_unit=outputs.unit AND src_message_index=outputs.message_index AND src_output_index=outputs.output_index
		CROSS JOIN units AS output_units ON outputs.unit=output_units.unit
		WHERE units.is_stable=0 AND +units.sequence='good'
			AND +output_units.is_stable=1 AND +output_units.sequence='good'
			AND inputs.address IN(${strAddresses}) AND type='transfer' AND inputs.asset IS NULL
		GROUP BY inputs.address`);

	for (const { address, spent_balance } of spent_rows) {
		if (balances[address])
			balances[address] += spent_balance;
		else
			balances[address] = spent_balance;
	}

	return balances;
}

async function balancesNewWay(addresses) {
	const strAddresses = addresses.map(db.escape).join(', ');

	const rows = await db.query(`
		SELECT outputs.address, SUM(outputs.amount) AS balance
		FROM outputs
		JOIN units ON outputs.unit = units.unit
		WHERE outputs.address IN(${strAddresses})
			AND outputs.asset IS NULL
			AND units.is_stable = 1 AND units.sequence = 'good'
			AND NOT EXISTS (
				SELECT 1 FROM inputs
				JOIN units AS su ON inputs.unit = su.unit
				WHERE inputs.src_unit = outputs.unit
					AND inputs.src_message_index = outputs.message_index
					AND inputs.src_output_index = outputs.output_index
					AND su.sequence = 'good'
					AND su.is_stable = 1
			)
		GROUP BY outputs.address`);

	const balances = {};
	for (const { address, balance } of rows)
		balances[address] = balance || 0;

	return balances;
}

async function main() {
	const subject_rows = await db.query("SELECT DISTINCT subject FROM system_votes");

	if (subject_rows.length === 0) {
		console.log('system_votes is empty — nothing to compare.');
		process.exit(0);
	}

	let any_diff = false;

	for (const { subject } of subject_rows) {
		const address_rows = await db.query(
			"SELECT DISTINCT address FROM system_votes WHERE subject=?", [subject]);
		const addresses = address_rows.map(r => r.address);

		console.log(`\nSubject: ${subject}  (${addresses.length} voter(s))`);

		if (addresses.length === 0) {
			console.log('  (no voters)');
			continue;
		}

		const [old_bal, new_bal] = await Promise.all([
			balancesOldWay(addresses),
			balancesNewWay(addresses),
		]);

		// Collect all addresses that appear in either result
		const all_addresses = new Set([...Object.keys(old_bal), ...Object.keys(new_bal)]);
		let subject_diff = false;

		for (const address of all_addresses) {
			const o = old_bal[address] || 0;
			const n = new_bal[address] || 0;
			if (o !== n) {
				const delta = n - o;
				console.log(`  DIFF  ${address}`);
				console.log(`        old=${o}  new=${n}  delta=${delta > 0 ? '+' : ''}${delta}`);
				subject_diff = true;
				any_diff = true;
			}
		}

		if (!subject_diff)
			console.log('  All voter balances match.');
	}

	console.log('\n' + '='.repeat(60));
	if (any_diff)
		console.log('RESULT: differences found — zombie-spent outputs exist in this DB.');
	else
		console.log('RESULT: no differences found — no zombie-spent outputs detected.');

	process.exit(0);
}

main().catch(err => {
	console.error('Fatal error:', err);
	process.exit(1);
});
