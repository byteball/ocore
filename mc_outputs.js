/*jslint node: true */
const _ = require('lodash');
const async = require('async');
const db = require('./db.js');
const conf = require('./conf.js');


// Functions for reading headers commissions and witnessing outputs.
// In all functions below, type=(headers_commission|witnessing)


function readNextSpendableMcIndex(conn, type, address, arrConflictingUnits, handleNextSpendableMcIndex){
	conn.query(
		`SELECT to_main_chain_index FROM inputs CROSS JOIN units USING(unit) \n\
        WHERE type=? AND address=? AND sequence='good' ${(arrConflictingUnits && arrConflictingUnits.length > 0) 
? ` AND unit NOT IN(${arrConflictingUnits.map(unit => db.escape(unit)).join(", ")}) ` 
: ""} \n\
        ORDER BY to_main_chain_index DESC LIMIT 1`, 
		[type, address],
		rows => {
			const mci = (rows.length > 0) ? (rows[0].to_main_chain_index+1) : 0;
		//	readNextUnspentMcIndex(conn, type, address, function(next_unspent_mci){
		//		if (next_unspent_mci !== mci)
		//			throw Error("next unspent mci !== next spendable mci: "+next_unspent_mci+" !== "+mci+", address "+address);
				handleNextSpendableMcIndex(mci);
		//	});
		}
	);
}

/*
function readNextUnspentMcIndex(conn, type, address, handleNextUnspentMcIndex){
	var table = type + '_outputs';
	conn.query(
		"SELECT main_chain_index FROM "+table+" WHERE address=? AND is_spent=1 \n\
		ORDER BY main_chain_index DESC LIMIT 1", [address],
		function(rows){
			handleNextUnspentMcIndex((rows.length > 0) ? (rows[0].main_chain_index+1) : 0);
		}
	);
}
*/

function readMaxSpendableMcIndex(conn, type, handleMaxSpendableMcIndex){
	const table = `${type}_outputs`;
	conn.query(`SELECT MAX(main_chain_index) AS max_mc_index FROM ${table}`, rows => {
		const max_mc_index = rows[0].max_mc_index || 0;
		handleMaxSpendableMcIndex(max_mc_index);
	});
}



function findMcIndexIntervalToTargetAmount(conn, type, address, max_mci, target_amount, callbacks){
	const table = `${type}_outputs`;
	readNextSpendableMcIndex(conn, type, address, null, from_mci => {
		if (from_mci > max_mci)
			return callbacks.ifNothing();
		readMaxSpendableMcIndex(conn, type, max_spendable_mci => {
			if (max_spendable_mci <= 0)
				return callbacks.ifNothing();
			if (max_spendable_mci > max_mci)
				max_spendable_mci = max_mci;
			if (target_amount === Infinity)
				target_amount = 1e15;
			if (conf.storage === 'mysql'){
				conn.query(
					`SELECT main_chain_index, accumulated, has_sufficient \n\
                    FROM ( \n\
                        SELECT main_chain_index, @sum:=@sum+amount AS accumulated, @has_sufficient:=(@sum>?) AS has_sufficient  \n\
                        FROM ${table}, (SELECT @sum:=0, @has_sufficient:=0) AS unused \n\
                        WHERE is_spent=0 AND address=? AND main_chain_index>=? AND main_chain_index<=? \n\
                        ORDER BY main_chain_index \n\
                    ) AS t \n\
                    WHERE IF(@has_sufficient, has_sufficient, 1) \n\
                    ORDER BY IF(@has_sufficient, accumulated, -accumulated) LIMIT 1`,
					[target_amount, address, from_mci, max_spendable_mci],
					rows => {
						if (rows.length === 0)
							return callbacks.ifNothing();
						const bHasSufficient = rows[0].has_sufficient;
						const accumulated = rows[0].accumulated;
						const to_mci = rows[0].main_chain_index;
						callbacks.ifFound(from_mci, to_mci, accumulated, bHasSufficient);
					}
				);
			}
			else{
				const MIN_MC_OUTPUT = (type === 'witnessing') ? 11 : 344;
				const max_count_outputs = Math.ceil(target_amount/MIN_MC_OUTPUT);
				conn.query(
					`SELECT main_chain_index, amount \n\
                    FROM ${table} \n\
                    WHERE is_spent=0 AND address=? AND main_chain_index>=? AND main_chain_index<=? \n\
                    ORDER BY main_chain_index LIMIT ?`,
					[address, from_mci, max_spendable_mci, max_count_outputs],
					rows => {
						if (rows.length === 0)
							return callbacks.ifNothing();
						let accumulated = 0;
						let to_mci;
						let bHasSufficient = false;
						for (let i=0; i<rows.length; i++){
							accumulated += rows[i].amount;
							to_mci = rows[i].main_chain_index;
							if (accumulated > target_amount){
								bHasSufficient = true;
								break;
							}
						}
						callbacks.ifFound(from_mci, to_mci, accumulated, bHasSufficient);
					}
				);
			}
		});
	});
}

function calcEarnings(conn, type, from_main_chain_index, to_main_chain_index, address, callbacks){
	const table = `${type}_outputs`;
	conn.query(
		`SELECT SUM(amount) AS total \n\
        FROM ${table} \n\
        WHERE main_chain_index>=? AND main_chain_index<=? AND address=?`,
		[from_main_chain_index, to_main_chain_index, address],
		rows => {
			let total = rows[0].total;
			if (total === null)
				total = 0;
			if (typeof total !== 'number')
				throw Error("mc outputs total is not a number");
			callbacks.ifOk(total);
		}
	);
}


exports.readNextSpendableMcIndex = readNextSpendableMcIndex;
exports.readMaxSpendableMcIndex = readMaxSpendableMcIndex;
exports.findMcIndexIntervalToTargetAmount = findMcIndexIntervalToTargetAmount;
exports.calcEarnings = calcEarnings;

