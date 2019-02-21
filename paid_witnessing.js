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

var paidWitnessEvents = [];

function calcWitnessEarnings(conn, type, from_main_chain_index, to_main_chain_index, address, callbacks){
	conn.query(
		"SELECT COUNT(1) AS count FROM units WHERE is_on_main_chain=1 AND is_stable=1 AND main_chain_index>=? AND main_chain_index<=?", 
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
			throw Error("no units or more than one unit on MC index "+main_chain_index);
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
					throw Error(err);
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
	conn.cquery(
		"SELECT COUNT(1) AS count, SUM(CASE WHEN is_stable=1 THEN 1 ELSE 0 END) AS count_on_stable_mc \n\
		FROM units WHERE is_on_main_chain=1 AND main_chain_index>=? AND main_chain_index<=?",
		[main_chain_index, main_chain_index+constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING+1],
		function(rows){
			profiler.stop('mc-wc-select-count');
			var countRAM = _.countBy(storage.assocStableUnits, function(props){
				return props.main_chain_index <= (main_chain_index+constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING+1) 
					&& props.main_chain_index >= main_chain_index 
					&& props.is_on_main_chain;
			})["1"];
			var count = conf.bFaster ? countRAM : rows[0].count;
			if (count !== constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING+2)
				throw Error("main chain is not long enough yet for MC index "+main_chain_index);
			if (!conf.bFaster){
				var count_on_stable_mc = rows[0].count_on_stable_mc;
				if (count_on_stable_mc !== count)
					throw Error("not enough stable MC units yet after MC index "+main_chain_index+": count_on_stable_mc="+count_on_stable_mc+", count="+count);
				if (!_.isEqual(countRAM, count))
					throwError("different count in buildPaidWitnessesForMainChainIndex, db: "+count+", ram: "+countRAM);
			}
			profiler.start();
			// we read witnesses from MC unit (users can cheat with side-chains to flip the witness list and pay commissions to their own witnesses)
			readMcUnitWitnesses(conn, main_chain_index, function(arrWitnesses){
				conn.cquery(
					"CREATE TEMPORARY TABLE paid_witness_events_tmp ( \n\
					unit CHAR(44) NOT NULL, \n\
					address CHAR(32) NOT NULL)",
					function(){
						conn.cquery("SELECT unit, main_chain_index FROM units WHERE main_chain_index=?", [main_chain_index], function(rows){
							profiler.stop('mc-wc-select-units');
							et=0; rt=0;
							var unitsRAM = storage.assocStableUnitsByMci[main_chain_index].map(function(props){return {unit: props.unit, main_chain_index: main_chain_index}});
							if (!conf.bFaster && !_.isEqual(rows, unitsRAM)) {
								if (!_.isEqual(_.sortBy(rows, function(v){return v.unit;}), _.sortBy(unitsRAM, function(v){return v.unit;})))
									throwError("different units in buildPaidWitnessesForMainChainIndex, db: "+JSON.stringify(rows)+", ram: "+JSON.stringify(unitsRAM));
							}
							paidWitnessEvents = [];
							async.eachSeries(
								conf.bFaster ? unitsRAM : rows, 
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
										throw Error(err);
									//var t=Date.now();
									profiler.start();
									var countPaidWitnesses = _.countBy(paidWitnessEvents, function(v){return v.unit});
									var assocPaidAmountsByAddress = _.reduce(paidWitnessEvents, function(amountsByAddress, v) {
										var objUnit = storage.assocStableUnits[v.unit];
										if (typeof amountsByAddress[v.address] === "undefined")
											amountsByAddress[v.address] = 0;
										if (objUnit.sequence == 'good')
											amountsByAddress[v.address] += Math.round(objUnit.payload_commission / countPaidWitnesses[v.unit]);
										return amountsByAddress;
									}, {});
									var arrPaidAmounts2 = _.map(assocPaidAmountsByAddress, function(amount, address) {return {address: address, amount: amount}});
									profiler.stop('mc-wc-js-aggregate-events');
									profiler.start();
									if (conf.bFaster)
										return conn.query("INSERT INTO witnessing_outputs (main_chain_index, address, amount) VALUES " + arrPaidAmounts2.map(function(o){ return "("+main_chain_index+", "+db.escape(o.address)+", "+o.amount+")" }).join(', '), function(){ profiler.stop('mc-wc-aggregate-events'); cb(); });
									conn.query(
										"INSERT INTO witnessing_outputs (main_chain_index, address, amount) \n\
										SELECT main_chain_index, address, \n\
											SUM(CASE WHEN sequence='good' THEN ROUND(1.0*payload_commission/count_paid_witnesses) ELSE 0 END) \n\
										FROM balls \n\
										JOIN units USING(unit) \n\
										JOIN paid_witness_events_tmp USING(unit) \n\
										WHERE main_chain_index=? \n\
										GROUP BY address",
										[main_chain_index],
										function(){
											//console.log(Date.now()-t);
											conn.query("SELECT address, amount FROM witnessing_outputs WHERE main_chain_index=?", [main_chain_index], function(rows){
												if (!_.isEqual(rows, arrPaidAmounts2)){
													if (!_.isEqual(_.sortBy(rows, function(v){return v.address}), _.sortBy(arrPaidAmounts2, function(v){return v.address})))
														throwError("different amount in buildPaidWitnessesForMainChainIndex mci "+main_chain_index+" db:" + JSON.stringify(rows) + " ram:" + JSON.stringify(arrPaidAmounts2)+" paidWitnessEvents="+JSON.stringify(paidWitnessEvents));
												}
												conn.query(conn.dropTemporaryTable("paid_witness_events_tmp"), function(){
													profiler.stop('mc-wc-aggregate-events');
													cb();
												});
											});
										}
									);
								}
							);
						});
					}
				);
			});
		}
	);
}


function readMcUnitWitnesses(conn, main_chain_index, handleWitnesses){
	var witness_list_unitRAM = storage.assocStableUnitsByMci[main_chain_index].find(function(props){return props.is_on_main_chain}).witness_list_unit;
	if (conf.bFaster)
		return storage.readWitnessList(conn, witness_list_unitRAM, handleWitnesses);
	conn.query("SELECT witness_list_unit, unit FROM units WHERE main_chain_index=? AND is_on_main_chain=1", [main_chain_index], function(rows){
		if (rows.length !== 1)
			throw Error("not 1 row on MC "+main_chain_index);
		var witness_list_unit = rows[0].witness_list_unit ? rows[0].witness_list_unit : rows[0].unit;
		if (!_.isEqual(witness_list_unit, witness_list_unitRAM))
			throw Error("witness_list_units are not equal db:"+witness_list_unit+", RAM:"+witness_list_unitRAM);
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
		var force_index = (conf.storage === 'mysql') ? 'FORCE INDEX (PRIMARY)' : ''; // force mysql to use primary key on unit_authors
		var strUnitsList = (arrUnits.length === 0) ? 'NULL' : arrUnits.map(function(unit){ return conn.escape(unit); }).join(', ');
			//throw "no witnesses before mc "+to_main_chain_index+" for unit "+objUnitProps.unit;
		profiler.start();
		conn.cquery( // we don't care if the unit is majority witnessed by the unit-designated witnesses
			// _left_ join forces use of indexes in units
			// can't get rid of filtering by address because units can be co-authored by witness with somebody else
			"SELECT address \n\
			FROM units \n\
			LEFT JOIN unit_authors "+ force_index +" USING(unit) \n\
			WHERE unit IN("+strUnitsList+") AND address IN(?) AND +sequence='good' \n\
			GROUP BY address",
			[arrWitnesses],
			function(rows){
				et += Date.now()-t;
				/*var arrPaidWitnessesRAM = _.uniq(_.flatMap(_.pickBy(storage.assocStableUnits, function(v, k){return _.includes(arrUnits,k) && v.sequence == 'good'}), function(v, k){
					return _.intersection(v.author_addresses, arrWitnesses);
				}));*/
				var arrPaidWitnessesRAM = _.uniq(_.flatten(arrUnits.map(function(_unit){
					var unitProps = storage.assocStableUnits[_unit];
					if (!unitProps)
						throw Error("stable unit "+_unit+" not found in cache");
					return (unitProps.sequence !== 'good') ? [] : _.intersection(unitProps.author_addresses, arrWitnesses);
				}) ) );
				if (conf.bFaster)
					rows = arrPaidWitnessesRAM.map(function(address){ return {address: address}; });
				if (!conf.bFaster && !_.isEqual(arrPaidWitnessesRAM.sort(), _.map(rows, function(v){return v.address}).sort()))
					throw Error("arrPaidWitnesses are not equal");
				var arrValues;
				var count_paid_witnesses = rows.length;
				if (count_paid_witnesses === 0){ // nobody witnessed, pay equally to all
					count_paid_witnesses = arrWitnesses.length;
					arrValues = arrWitnesses.map(function(address){ return "("+conn.escape(unit)+", "+conn.escape(address)+")"; });
					paidWitnessEvents = _.concat(paidWitnessEvents, arrWitnesses.map(function(address){ return {unit: unit, address: address};}));
				}
				else {
					arrValues = rows.map(function(row){ return "("+conn.escape(unit)+", "+conn.escape(row.address)+")"; });
					paidWitnessEvents = _.concat(paidWitnessEvents, rows.map(function(row){ return {unit: unit, address: row.address};}));
				}

				profiler.stop('mc-wc-select-events');
				profiler.start();
				conn.cquery("INSERT INTO paid_witness_events_tmp (unit, address) VALUES "+arrValues.join(", "), function(){
					updateCountPaidWitnesses(count_paid_witnesses);
				});
			}
		);
	});
	
}

function getMaxSpendableMciForLastBallMci(last_ball_mci){
	return last_ball_mci - 1 - constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING;
}

function throwError(msg){
	var eventBus = require('./event_bus.js');
	debugger;
	if (typeof window === 'undefined')
		throw Error(msg);
	else
		eventBus.emit('nonfatal_error', msg, new Error());
}

exports.updatePaidWitnesses = updatePaidWitnesses;
exports.calcWitnessEarnings = calcWitnessEarnings;
exports.getMaxSpendableMciForLastBallMci = getMaxSpendableMciForLastBallMci;

