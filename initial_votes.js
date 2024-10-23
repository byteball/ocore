/*jslint node: true */
"use strict";
var constants = require("./constants.js");

async function initSystemVarVotes(db) {
	const conn = await db.takeConnectionFromPool();
	const rows = await conn.query("SELECT 1 FROM system_vars LIMIT 1");
	if (rows.length > 1) {
		conn.release();
		return console.log("system vars already initialized");
	}
	await conn.query("BEGIN");
	const timestamp = 1724716800; // 27 Aug 2024
	const threshold_size = 10000;
	const base_tps_fee = 10;
	const tps_interval = constants.bDevnet ? 2 : 1;
	const tps_fee_multiplier = 10;
	const arrOPs = constants.bDevnet
		? ["ZQFHJXFWT2OCEBXF26GFXJU4MPASWPJT"]
		: (constants.bTestnet
			? ["2FF7PSL7FYXVU5UIQHCVDTTPUOOG75GX", "2GPBEZTAXKWEXMWCTGZALIZDNWS5B3V7", "4H2AMKF6YO2IWJ5MYWJS3N7Y2YU2T4Z5", "DFVODTYGTS3ILVOQ5MFKJIERH6LGKELP", "ERMF7V2RLCPABMX5AMNGUQBAH4CD5TK4", "F4KHJUCLJKY4JV7M5F754LAJX4EB7M4N", "IOF6PTBDTLSTBS5NWHUSD7I2NHK3BQ2T", "O4K4QILG6VPGTYLRAI2RGYRFJZ7N2Q2O", "OPNUXBRSSQQGHKQNEPD2GLWQYEUY5XLD", "PA4QK46276MJJD5DBOLIBMYKNNXMUVDP", "RJDYXC4YQ4AZKFYTJVCR5GQJF5J6KPRI", "WELOXP3EOA75JWNO6S5ZJHOO3EYFKPIR"]
			: ["2TO6NYBGX3NF5QS24MQLFR7KXYAMCIE5", "4GDZSXHEFVFMHCUCSHZVXBVF5T2LJHMU", "APABTE2IBKOIHLS2UNK6SAR4T5WRGH2J", "DXYWHSZ72ZDNDZ7WYZXKWBBH425C6WZN", "FAB6TH7IRAVHDLK2AAWY5YBE6CEBUACF", "FOPUBEUPBC6YLIQDLKL6EW775BMV7YOH", "GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN", "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", "JMFXY26FN76GWJJG7N36UI2LNONOGZJV", "JPQKPRI5FMTQRJF4ZZMYZYDQVRD55OTC", "TKT4UESIKTTRALRRLWS4SENSTJX6ODCW", "UE25S4GRWZOLNXZKY4VWFHNJZWUSYCQC"]
		);
	const strOPs = JSON.stringify(arrOPs);
	const arrPreloadedVoters = constants.bDevnet
		? [require('./chash.js').getChash160('')]
		: (constants.bTestnet
			? ['EJC4A7WQGHEZEKW6RLO7F26SAR4LAQBU']
			: ['3Y24IXW57546PQAPQ2SXYEPEDNX4KC6Y', 'G4E66WLVL4YMNFLBKWPRCVNBTPB64NOE', 'Q5OGEL2QFKQ4TKQTG4X3SSLU57OBMMBY', 'BQCVIU7Y7LHARKJVZKWL7SL3PEH7UHVM', 'U67XFUQN46UW3G6IEJ2ACOBYWHMI4DH2']
		);
	for (let address of arrPreloadedVoters) {
		await conn.query(
			`INSERT OR IGNORE INTO system_votes (unit, address, subject, value, timestamp) VALUES
			('', '${address}', 'op_list', '${strOPs}', ${timestamp}),
			('', '${address}', 'threshold_size', ${threshold_size}, ${timestamp}),
			('', '${address}', 'base_tps_fee', ${base_tps_fee}, ${timestamp}),
			('', '${address}', 'tps_interval', ${tps_interval}, ${timestamp}),
			('', '${address}', 'tps_fee_multiplier', ${tps_fee_multiplier}, ${timestamp})
		`);
		const values = arrOPs.map(op => `('', '${address}', '${op}', ${timestamp})`);
		await conn.query(`INSERT OR IGNORE INTO op_votes (unit, address, op_address, timestamp) VALUES ` + values.join(', '));
		await conn.query(
			`INSERT OR IGNORE INTO numerical_votes (unit, address, subject, value, timestamp) VALUES
			('', '${address}', 'threshold_size', ${threshold_size}, ${timestamp}),
			('', '${address}', 'base_tps_fee', ${base_tps_fee}, ${timestamp}),
			('', '${address}', 'tps_interval', ${tps_interval}, ${timestamp}),
			('', '${address}', 'tps_fee_multiplier', ${tps_fee_multiplier}, ${timestamp})
		`);
	}
	await conn.query(
		`INSERT OR IGNORE INTO system_vars (subject, value, vote_count_mci) VALUES 
		('op_list', '${strOPs}', -1),
		('threshold_size', ${threshold_size}, -1),
		('base_tps_fee', ${base_tps_fee}, -1),
		('tps_interval', ${tps_interval}, -1),
		('tps_fee_multiplier', ${tps_fee_multiplier}, -1)
	`);
	await conn.query("COMMIT");
	console.log("initialized system vars");
	conn.release();
}

exports.initSystemVarVotes = initSystemVarVotes;
