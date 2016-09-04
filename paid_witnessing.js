/*jslint node: true */
"use strict";
var _ = require('lodash');
var async = require('async');
var storage = require('./storage.js');
var graph = require('./graph.js');
var db = require('./db.js');
var constants = require("./constants.js");
var conf = require("./conf.js");
var mc_outputs = require("./mc_outputs.js");
var profiler = require("./profiler.js");


function calcWitnessEarnings(conn, type, from_main_chain_index, to_main_chain_index, address, callbacks){
	conn.query(
		"SELECT COUNT(*) AS count FROM units WHERE is_on_main_chain=1 AND is_stable=1 AND main_chain_index>=? AND main_chain_index<=?", 
		[to_main_chain_index, to_main_chain_index+constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING+1], 
		function(count_rows){
			if (count_rows[0].count !== constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING+2)
				return callbacks.ifError("not enough stable MC units after to_main_chain_index");
			mc_outputs.calcEarnings(conn, type, from_main_chain_index, to_main_chain_index, address, callbacks);
		}
	);
}

/*
function readMaxWitnessSpendableMcIndex(conn, handleMaxSpendableMcIndex){
	conn.query("SELECT MAX(main_chain_index) AS max_mc_index FROM units WHERE is_on_main_chain=1 AND is_stable=1", function(rows){
		var max_mc_index = rows[0].max_mc_index;
		var max_spendable_mc_index = max_mc_index - constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING - 1;
		if (max_spendable_mc_index <= 0)
			return handleMaxSpendableMcIndex(max_spendable_mc_index);
		/ *
		function checkIfMajorityWitnessedByParentsAndAdjust(){
			readUnitOnMcIndex(conn, max_spendable_mc_index, function(unit){
				determineIfMajorityWitnessedByDescendants(conn, unit, arrParents, function(bWitnessed){
					if (!bWitnessed){
						max_spendable_mc_index--;
						checkIfMajorityWitnessedByParentsAndAdjust();
					}
					else
						handleMaxSpendableMcIndex(max_spendable_mc_index);
				});
			});
		}
		* /
		//arrParents ? checkIfMajorityWitnessedByParentsAndAdjust() : 
		handleMaxSpendableMcIndex(max_spendable_mc_index);
	});
}
*/

function readUnitOnMcIndex(conn, main_chain_index, handleUnit){
	conn.query("SELECT unit FROM units WHERE is_on_main_chain=1 AND main_chain_index=?", [main_chain_index], function(rows){
		if (rows.length !== 1)
			throw "no units or more than one unit on MC index "+main_chain_index;
		handleUnit(rows[0].unit);
	});
}

function updatePaidWitnesses(conn, cb){
	console.log("updating paid witnesses");
	profiler.start();
	storage.readLastStableMcIndex(conn, function(last_stable_mci){
		profiler.stop('mc-wc-readLastStableMCI');
		var max_spendable_mc_index = getMaxSpendableMciForLastBallMci(last_stable_mci);
		(max_spendable_mc_index > 0) ? buildPaidWitnessesTillMainChainIndex(conn, max_spendable_mc_index, cb) : cb();
	});
}

function buildPaidWitnessesTillMainChainIndex(conn, to_main_chain_index, cb){
	profiler.start();
	var cross = (conf.storage === 'sqlite') ? 'CROSS' : ''; // correct the query planner
	conn.query(
		"SELECT MIN(main_chain_index) AS min_main_chain_index FROM balls "+cross+" JOIN units USING(unit) WHERE count_paid_witnesses IS NULL", 
		function(rows){
			profiler.stop('mc-wc-minMCI');
			var main_chain_index = rows[0].min_main_chain_index;
			if (main_chain_index > to_main_chain_index)
				return cb();

			function onIndexDone(err){
				if (err) // impossible
					throw err;
				else{
					main_chain_index++;
					if (main_chain_index > to_main_chain_index)
						cb();
					else
						buildPaidWitnessesForMainChainIndex(conn, main_chain_index, onIndexDone);
				}
			}

			buildPaidWitnessesForMainChainIndex(conn, main_chain_index, onIndexDone);
		}
	);
}

function buildPaidWitnessesForMainChainIndex(conn, main_chain_index, cb){
	console.log("updating paid witnesses mci "+main_chain_index);
	profiler.start();
	conn.query(
		"SELECT COUNT(*) AS count, SUM(CASE WHEN is_stable=1 THEN 1 ELSE 0 END) AS count_on_stable_mc \n\
		FROM units WHERE is_on_main_chain=1 AND main_chain_index>=? AND main_chain_index<=?",
		[main_chain_index, main_chain_index+constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING+1],
		function(rows){
			profiler.stop('mc-wc-select-count');
			var count = rows[0].count;
			var count_on_stable_mc = rows[0].count_on_stable_mc;
			if (count !== constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING+2)
				throw "main chain is not long enough yet for MC index "+main_chain_index;
			if (count_on_stable_mc !== count)
				throw "not enough stable MC units yet after MC index "+main_chain_index;
			
			profiler.start();
			// we read witnesses from MC unit (users can cheat with side-chains to flip the witness list and pay commissions to their own witnesses)
			readMcUnitWitnesses(conn, main_chain_index, function(arrWitnesses){
				conn.query("SELECT * FROM units WHERE main_chain_index=?", [main_chain_index], function(rows){
					profiler.stop('mc-wc-select-units');
					et=0; rt=0;
					async.eachSeries(
						rows, 
						function(row, cb2){
							// the unit itself might be never majority witnessed by unit-designated witnesses (which might be far off), 
							// but its payload commission still belongs to and is spendable by the MC-unit-designated witnesses.
							//if (row.is_stable !== 1)
							//    throw "unit "+row.unit+" is not on stable MC yet";
							buildPaidWitnesses(conn, row, arrWitnesses, cb2);
						},
						function(err){
							console.log(rt, et);
							if (err) // impossible
								throw err;
							//var t=Date.now();
							profiler.start();
							conn.query(
								"INSERT INTO witnessing_outputs (main_chain_index, address, amount) \n\
								SELECT main_chain_index, address, \n\
									SUM(CASE WHEN sequence='good' THEN ROUND(1.0*payload_commission/count_paid_witnesses) ELSE 0 END) \n\
								FROM balls \n\
								JOIN units USING(unit) \n\
								JOIN paid_witness_events USING(unit) \n\
								WHERE main_chain_index=? \n\
								GROUP BY address",
								[main_chain_index],
								function(){
									//console.log(Date.now()-t);
									profiler.stop('mc-wc-aggregate-events');
									cb();
								}
							);
						}
					);
				});
			});
		}
	);
}


function readMcUnitWitnesses(conn, main_chain_index, handleWitnesses){
	conn.query("SELECT witness_list_unit, unit FROM units WHERE main_chain_index=? AND is_on_main_chain=1", [main_chain_index], function(rows){
		if (rows.length !== 1)
			throw "not 1 row on MC "+main_chain_index;
		var witness_list_unit = rows[0].witness_list_unit ? rows[0].witness_list_unit : rows[0].unit;
		storage.readWitnessList(conn, witness_list_unit, handleWitnesses);
	});
}

var et, rt;
function buildPaidWitnesses(conn, objUnitProps, arrWitnesses, onDone){
	
	function updateCountPaidWitnesses(count_paid_witnesses){
		conn.query("UPDATE balls SET count_paid_witnesses=? WHERE unit=?", [count_paid_witnesses, objUnitProps.unit], function(){
			profiler.stop('mc-wc-insert-events');
			onDone();
		});
	}
	
	var unit = objUnitProps.unit;
	var to_main_chain_index = objUnitProps.main_chain_index + constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING;
	
	var t=Date.now();
	graph.readDescendantUnitsByAuthorsBeforeMcIndex(conn, objUnitProps, arrWitnesses, to_main_chain_index, function(arrUnits){
		rt+=Date.now()-t;
		t=Date.now();
		if (arrUnits.length === 0)
			arrUnits = null;
			//throw "no witnesses before mc "+to_main_chain_index+" for unit "+objUnitProps.unit;
		profiler.start();
		conn.query( // we don't care if the unit is majority witnessed by the unit-designated witnesses
			"SELECT address, MIN(main_chain_index-?) AS delay \n\
			FROM unit_authors \n\
			JOIN units USING(unit) \n\
			WHERE unit IN(?) AND address IN(?) AND sequence='good' \n\
			GROUP BY address",
			[objUnitProps.main_chain_index, arrUnits, arrWitnesses],
			function(rows){
				et += Date.now()-t;
				var count_paid_witnesses = rows.length;
				var arrValues;
				if (count_paid_witnesses === 0){ // nobody witnessed, pay equally to all
					count_paid_witnesses = arrWitnesses.length;
					arrValues = arrWitnesses.map(function(address){ return "("+conn.escape(unit)+", "+conn.escape(address)+", NULL)"; });
				}
				else
					arrValues = rows.map(function(row){ return "("+conn.escape(unit)+", "+conn.escape(row.address)+", "+row.delay+")"; });
				profiler.stop('mc-wc-select-events');
				profiler.start();
				conn.query("INSERT INTO paid_witness_events (unit, address, delay) VALUES "+arrValues.join(", "), function(){
					updateCountPaidWitnesses(count_paid_witnesses);
				});
			}
		);
	});
	
}

function getMaxSpendableMciForLastBallMci(last_ball_mci){
	return last_ball_mci - 1 - constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING;
}


exports.updatePaidWitnesses = updatePaidWitnesses;
exports.calcWitnessEarnings = calcWitnessEarnings;
exports.getMaxSpendableMciForLastBallMci = getMaxSpendableMciForLastBallMci;

