const Piscina = require('piscina');
const conf = require('../conf.js');
const sqlitePool = require('../sqlite_pool_for_workers.js');
const db = sqlitePool(Piscina.workerData, conf.database.filename, 1, true);

function filterRows(rows) {
	return rows.filter(row => {
		if (row.balance <= Number.MAX_SAFE_INTEGER || row.calculated_balance <= Number.MAX_SAFE_INTEGER)
			return true;
		const diff = Math.abs(row.balance - row.calculated_balance);
		if (diff > row.balance * 1e-5) // large relative difference cannot result from precision loss
			return true;
		console.log("ignoring balance difference in", row);
		return false;
	});
}

async function checkBalances() {
	const conn = await db.takeConnectionFromPool();
	const rows = await conn.query("SELECT 1 FROM aa_triggers");
	if (rows.length > 0) {
		console.log("skipping checkBalances because there are unhandled triggers");
		return { error: false };
	}
	
	await conn.query("CREATE TEMPORARY TABLE aa_outputs_balances ( \n\
					address CHAR(32) NOT NULL, \n\
					asset CHAR(44) NOT NULL, \n\
					calculated_balance BIGINT NOT NULL, \n\
					PRIMARY KEY (address, asset) \n\
				)");
	
	await conn.query("INSERT INTO aa_outputs_balances (address, asset, calculated_balance) \n\
					SELECT address, IFNULL(asset, 'base'), SUM(amount) \n\
					FROM aa_addresses \n\
					CROSS JOIN outputs USING(address) \n\
					CROSS JOIN units ON outputs.unit=units.unit \n\
					WHERE is_spent=0 AND ( \n\
						is_stable=1 \n\
						OR is_stable=0 AND EXISTS (SELECT 1 FROM unit_authors CROSS JOIN aa_addresses USING(address) WHERE unit_authors.unit=outputs.unit) \n\
					) \n\
					GROUP BY address, asset");
	
	let rows2 = await conn.query("SELECT aa_balances.address, aa_balances.asset, balance, calculated_balance \n\
				FROM aa_balances \n\
				LEFT JOIN aa_outputs_balances USING(address, asset) \n\
				GROUP BY aa_balances.address, aa_balances.asset \n\
				HAVING balance != calculated_balance");
	
	rows2 = filterRows(rows2);
	if (rows2.length > 0) {
		return { error: "checkBalances failed: sql:\n" + sql + "\n\nrows:\n" + JSON.stringify(rows, null, '\t') };
	}
	
	let rows3 = await conn.query("SELECT aa_outputs_balances.address, aa_outputs_balances.asset, balance, calculated_balance \n\
				FROM aa_outputs_balances \n\
				LEFT JOIN aa_balances USING(address, asset) \n\
				GROUP BY aa_outputs_balances.address, aa_outputs_balances.asset \n\
				HAVING balance != calculated_balance");
	
	rows3 = filterRows(rows3);
	if (rows3.length > 0) {
		return { error: "checkBalances failed: sql:\n" + sql + "\n\nrows:\n" + JSON.stringify(rows, null, '\t') };
	}
	
	await conn.query("DROP TABLE IF EXISTS aa_outputs_balances");
	return { error: false };
}

module.exports = {
	checkBalances
}