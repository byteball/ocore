/*jslint node: true */
"use strict";
var _ = require('lodash');
var async = require('async');
var db = require('./db.js');
var constants = require("./constants.js");
var storage = require('./storage.js');
var graph = require('./graph.js');
var objectHash = require("./object_hash.js");
var paid_witnessing = require("./paid_witnessing.js");
var headers_commission = require("./headers_commission.js");
var mutex = require('./mutex.js');
var eventBus = require('./event_bus.js');
var profiler = require('./profiler.js');
var breadcrumbs = require('./breadcrumbs.js');
var conf = require('./conf.js');
var kvstore = require('./kvstore.js');
var string_utils = require('./string_utils.js');

// override when adding units which caused witnessed level to significantly retreat
var arrRetreatingUnits = [
	'+5ntioHT58jcFb8oVc+Ff4UvO5UvYGRcrGfYIofGUW8=',
	'C/aPdM0sODPLC3NqJPWdZlqmV8B4xxf2N/+HSEi0sKU=',
	'sSev6hvQU86SZBemy9CW2lJIko2jZDoY55Lm3zf2QU4=',
	'19GglT3uZx1WmfWstLb3yIa85jTic+t01Kpe6s5gTTA=',
	'Hyi2XVdZ/5D3H/MhwDL/jRWHp3F/dQTmwemyUHW+Urg=',
	'xm0kFeKh6uqSXx6UUmc2ucgsNCU5h/e6wxSMWirhOTo='
];


function updateMainChain(conn, batch, from_unit, last_added_unit, bKeepStabilityPoint, onDone){
	
	var arrAllParents = [];
	var arrNewMcUnits = [];
	let bStabilizedAATriggers = false;
	let arrStabilizedMcis = [];
	
	// if unit === null, read free balls
	function findNextUpMainChainUnit(unit, handleUnit){
		function handleProps(props){
			if (props.best_parent_unit === null)
				throw Error("best parent is null");
			console.log("unit "+unit+", best parent "+props.best_parent_unit+", wlevel "+props.witnessed_level);
			handleUnit(props.best_parent_unit);
		}
		function readLastUnitProps(handleLastUnitProps){
			conn.query("SELECT unit AS best_parent_unit, witnessed_level \n\
				FROM units WHERE is_free=1 \n\
				ORDER BY witnessed_level DESC, \n\
					level-witnessed_level ASC, \n\
					unit ASC \n\
				LIMIT 5",
				function(rows){
					if (rows.length === 0)
						throw Error("no free units?");
					if (rows.length > 1){
						var arrParents = rows.map(function(row){ return row.best_parent_unit; });
						arrAllParents = arrParents;
						for (var i=0; i<arrRetreatingUnits.length; i++){
							var n = arrParents.indexOf(arrRetreatingUnits[i]);
							if (n >= 0)
								return handleLastUnitProps(rows[n]);
						}
					}
					/*
					// override when adding +5ntioHT58jcFb8oVc+Ff4UvO5UvYGRcrGfYIofGUW8= which caused witnessed level to significantly retreat
					if (rows.length === 2 && (rows[1].best_parent_unit === '+5ntioHT58jcFb8oVc+Ff4UvO5UvYGRcrGfYIofGUW8=' || rows[1].best_parent_unit === 'C/aPdM0sODPLC3NqJPWdZlqmV8B4xxf2N/+HSEi0sKU=' || rows[1].best_parent_unit === 'sSev6hvQU86SZBemy9CW2lJIko2jZDoY55Lm3zf2QU4=') && (rows[0].best_parent_unit === '3XJT1iK8FpFeGjwWXd9+Yu7uJp7hM692Sfbb5zdqWCE=' || rows[0].best_parent_unit === 'TyY/CY8xLGvJhK6DaBumj2twaf4y4jPC6umigAsldIA=' || rows[0].best_parent_unit === 'VKX2Nsx2W1uQYT6YajMGHAntwNuSMpAAlxF7Y98tKj8='))
						return handleLastUnitProps(rows[1]);
					*/
					handleLastUnitProps(rows[0]);
				}
			);
		}
	
		unit ? storage.readStaticUnitProps(conn, unit, handleProps) : readLastUnitProps(handleProps);
	}
	
	function goUpFromUnit(unit){
		if (storage.isGenesisUnit(unit))
			return checkNotRebuildingStableMainChainAndGoDown(0, unit);
		
		profiler.start();
		findNextUpMainChainUnit(unit, function(best_parent_unit){
			storage.readUnitProps(conn, best_parent_unit, function(objBestParentUnitProps){
				var objBestParentUnitProps2 = storage.assocUnstableUnits[best_parent_unit] || storage.assocStableUnits[best_parent_unit];
				if (!objBestParentUnitProps2){
					if (storage.isGenesisUnit(best_parent_unit))
						objBestParentUnitProps2 = storage.assocStableUnits[best_parent_unit];
					else
						throw Error("unstable unit not found: "+best_parent_unit);
				}
				var objBestParentUnitProps2ForCheck = _.clone(objBestParentUnitProps2);
				delete objBestParentUnitProps2ForCheck.parent_units;
				delete objBestParentUnitProps2ForCheck.bAA;
				var objBestParentUnitPropsForCheck = _.clone(objBestParentUnitProps);
				delete objBestParentUnitPropsForCheck.bAA;
				delete objBestParentUnitPropsForCheck.parent_units;
				if (!storage.isGenesisUnit(best_parent_unit))
					delete objBestParentUnitProps2ForCheck.earned_headers_commission_recipients;
				if (!conf.bFaster && !_.isEqual(objBestParentUnitProps2ForCheck, objBestParentUnitPropsForCheck))
					throwError("different props, db: "+JSON.stringify(objBestParentUnitProps)+", unstable: "+JSON.stringify(objBestParentUnitProps2));
				if (!objBestParentUnitProps.is_on_main_chain)
					conn.query("UPDATE units SET is_on_main_chain=1, main_chain_index=NULL WHERE unit=?", [best_parent_unit], function(){
						objBestParentUnitProps2.is_on_main_chain = 1;
						objBestParentUnitProps2.main_chain_index = null;
						arrNewMcUnits.push(best_parent_unit);
						profiler.stop('mc-goUpFromUnit');
						goUpFromUnit(best_parent_unit);
					});
				else{
					profiler.stop('mc-goUpFromUnit');
					if (unit === null)
						updateLatestIncludedMcIndex(objBestParentUnitProps.main_chain_index, false);
					else
						checkNotRebuildingStableMainChainAndGoDown(objBestParentUnitProps.main_chain_index, best_parent_unit);
				}
			});
		});
	}
	
	function checkNotRebuildingStableMainChainAndGoDown(last_main_chain_index, last_main_chain_unit){
		console.log("checkNotRebuildingStableMainChainAndGoDown "+from_unit);
		profiler.start();
		conn.query(
			"SELECT unit FROM units WHERE is_on_main_chain=1 AND main_chain_index>? AND is_stable=1", 
			[last_main_chain_index],
			function(rows){
				profiler.stop('mc-checkNotRebuilding');
				if (rows.length > 0)
					throw Error("removing stable units "+rows.map(function(row){return row.unit}).join(', ')+" from MC after adding "+last_added_unit+" with all parents "+arrAllParents.join(', '));
				goDownAndUpdateMainChainIndex(last_main_chain_index, last_main_chain_unit);
			}
		);
	}
	
	function goDownAndUpdateMainChainIndex(last_main_chain_index, last_main_chain_unit){
		profiler.start();
		conn.query(
			//"UPDATE units SET is_on_main_chain=0, main_chain_index=NULL WHERE is_on_main_chain=1 AND main_chain_index>?", 
			"UPDATE units SET is_on_main_chain=0, main_chain_index=NULL WHERE main_chain_index>?", 
			[last_main_chain_index], 
			function(){
				for (var unit in storage.assocUnstableUnits){
					var o = storage.assocUnstableUnits[unit];
					if (o.main_chain_index > last_main_chain_index){
						o.is_on_main_chain = 0;
						o.main_chain_index = null;
					}
				}
				var main_chain_index = last_main_chain_index;
				var main_chain_unit = last_main_chain_unit;
				conn.cquery(
					"SELECT unit FROM units WHERE is_on_main_chain=1 AND main_chain_index IS NULL ORDER BY level",
					function(rows){
						if (!conf.bFaster && rows.length === 0){
							//if (last_main_chain_index > 0)
								throw Error("no unindexed MC units after adding "+last_added_unit);
							//else{
							//    console.log("last MC=0, no unindexed MC units");
							//    return updateLatestIncludedMcIndex(last_main_chain_index, true);
							//}
						}
						arrNewMcUnits.reverse();
						if (!conf.bFaster){
							var arrDbNewMcUnits = rows.map(function(row){ return row.unit; });
							if (!_.isEqual(arrNewMcUnits, arrDbNewMcUnits))
								throwError("different new MC units, arr: "+JSON.stringify(arrNewMcUnits)+", db: "+JSON.stringify(arrDbNewMcUnits));
						}
						async.eachSeries(
							conf.bFaster ? arrNewMcUnits : arrDbNewMcUnits, 
							function(mc_unit, cb){
								main_chain_index++;
								var arrUnits = [mc_unit];
								
								function goUp(arrStartUnits){
									conn.cquery(
										"SELECT DISTINCT unit \n\
										FROM parenthoods JOIN units ON parent_unit=unit \n\
										WHERE child_unit IN(?) AND main_chain_index IS NULL",
										[arrStartUnits],
										function(rows){
											var arrNewStartUnits2 = [];
											arrStartUnits.forEach(function(start_unit){
												storage.assocUnstableUnits[start_unit].parent_units.forEach(function(parent_unit){
													if (storage.assocUnstableUnits[parent_unit] && storage.assocUnstableUnits[parent_unit].main_chain_index === null && arrNewStartUnits2.indexOf(parent_unit) === -1)
														arrNewStartUnits2.push(parent_unit);
												});
											});
											var arrNewStartUnits = conf.bFaster ? arrNewStartUnits2 : rows.map(function(row){ return row.unit; });
											if (!conf.bFaster && !_.isEqual(arrNewStartUnits.sort(), arrNewStartUnits2.sort()))
												throwError("different new start units, arr: "+JSON.stringify(arrNewStartUnits2)+", db: "+JSON.stringify(arrNewStartUnits));
											if (arrNewStartUnits.length === 0)
												return updateMc();
											arrUnits = arrUnits.concat(arrNewStartUnits);
											goUp(arrNewStartUnits);
										}
									);
								}
	
								function updateMc(){
									arrUnits.forEach(function(unit){
										storage.assocUnstableUnits[unit].main_chain_index = main_chain_index;
									});
									var strUnitList = arrUnits.map(db.escape).join(', ');
									conn.query("UPDATE units SET main_chain_index=? WHERE unit IN("+strUnitList+")", [main_chain_index], function(){
										conn.query("UPDATE unit_authors SET _mci=? WHERE unit IN("+strUnitList+")", [main_chain_index], function(){
											cb();
										});
									});
								}
								
								goUp(arrUnits);
								
							}, 
							function(err){
								console.log("goDownAndUpdateMainChainIndex done");
								if (err)
									throw Error("goDownAndUpdateMainChainIndex eachSeries failed");
								conn.query(
									(conf.storage === 'mysql')
										? "UPDATE units LEFT JOIN unit_authors USING(unit) SET _mci=NULL WHERE main_chain_index IS NULL"
										: "UPDATE unit_authors SET _mci=NULL WHERE unit IN(SELECT unit FROM units WHERE main_chain_index IS NULL)", 
									function(){
										profiler.stop('mc-goDown');
										updateLatestIncludedMcIndex(last_main_chain_index, true);
									}
								);
							}
						);
					}
				);
			}
		);
	}
	
	function updateLatestIncludedMcIndex(last_main_chain_index, bRebuiltMc){
		
		function checkAllLatestIncludedMcIndexesAreSet(){
			profiler.start();
			if (!conf.bFaster && !_.isEqual(assocDbLimcisByUnit, assocLimcisByUnit))
				throwError("different  LIMCIs, mem: "+JSON.stringify(assocLimcisByUnit)+", db: "+JSON.stringify(assocDbLimcisByUnit));
			conn.query("SELECT unit FROM units WHERE latest_included_mc_index IS NULL AND level!=0", function(rows){
				if (rows.length > 0)
					throw Error(rows.length+" units have latest_included_mc_index=NULL, e.g. unit "+rows[0].unit);
				profiler.stop('mc-limci-check');
				updateStableMcFlag();
			});
		}
		
		function propagateLIMCI(){
			console.log("propagateLIMCI "+last_main_chain_index);
			profiler.start();
			// the 1st condition in WHERE is the same that was used 2 queries ago to NULL limcis
			conn.query(
				/*
				"UPDATE units AS punits \n\
				JOIN parenthoods ON punits.unit=parent_unit \n\
				JOIN units AS chunits ON child_unit=chunits.unit \n\
				SET chunits.latest_included_mc_index=punits.latest_included_mc_index \n\
				WHERE (chunits.main_chain_index > ? OR chunits.main_chain_index IS NULL) \n\
					AND (chunits.latest_included_mc_index IS NULL OR chunits.latest_included_mc_index < punits.latest_included_mc_index)",
				[last_main_chain_index],
				function(result){
					(result.affectedRows > 0) ? propagateLIMCI() : checkAllLatestIncludedMcIndexesAreSet();
				}
				*/
				"SELECT punits.latest_included_mc_index, chunits.unit \n\
				FROM units AS punits \n\
				JOIN parenthoods ON punits.unit=parent_unit \n\
				JOIN units AS chunits ON child_unit=chunits.unit \n\
				WHERE (chunits.main_chain_index > ? OR chunits.main_chain_index IS NULL) \n\
					AND (chunits.latest_included_mc_index IS NULL OR chunits.latest_included_mc_index < punits.latest_included_mc_index)",
				[last_main_chain_index],
				function(rows){
					profiler.stop('mc-limci-select-propagate');
					if (rows.length === 0)
						return checkAllLatestIncludedMcIndexesAreSet();
					profiler.start();
					async.eachSeries(
						rows,
						function(row, cb){
							assocDbLimcisByUnit[row.unit] = row.latest_included_mc_index;
							conn.query("UPDATE units SET latest_included_mc_index=? WHERE unit=?", [row.latest_included_mc_index, row.unit], function(){cb();});
						},
						function(){
							profiler.stop('mc-limci-update-propagate');
							propagateLIMCI();
						}
					);
				}
			);
		}
		
		function loadUnitProps(unit, handleProps){
			if (storage.assocUnstableUnits[unit])
				return handleProps(storage.assocUnstableUnits[unit]);
			storage.readUnitProps(conn, unit, handleProps);
		}
		
		function calcLIMCIs(onUpdated){
			console.log("will calcLIMCIs for " + Object.keys(assocChangedUnits).length + " changed units");
			var arrFilledUnits = [];
			async.forEachOfSeries(
				assocChangedUnits,
				function(props, unit, cb){
					var max_limci = -1;
					async.eachSeries(
						props.parent_units,
						function(parent_unit, cb2){
							loadUnitProps(parent_unit, function(parent_props){
								if (parent_props.is_on_main_chain){
									props.latest_included_mc_index = parent_props.main_chain_index;
									assocLimcisByUnit[unit] = props.latest_included_mc_index;
									arrFilledUnits.push(unit);
									return cb2('done');
								}
								if (parent_props.latest_included_mc_index === null)
									return cb2('parent limci not known yet');
								if (parent_props.latest_included_mc_index > max_limci)
									max_limci = parent_props.latest_included_mc_index;
								cb2();
							});
						},
						function(err){
							if (err)
								return cb();
							if (max_limci < 0)
								throw Error("max limci < 0 for unit "+unit);
							props.latest_included_mc_index = max_limci;
							assocLimcisByUnit[unit] = props.latest_included_mc_index;
							arrFilledUnits.push(unit);
							cb();
						}
					);
				},
				function(){
					arrFilledUnits.forEach(function(unit){
						delete assocChangedUnits[unit];
					});
					if (Object.keys(assocChangedUnits).length > 0)
						calcLIMCIs(onUpdated);
					else
						onUpdated();
				}
			);
		}
		
		console.log("updateLatestIncludedMcIndex "+last_main_chain_index);
		if (!conf.bFaster)
			profiler.start();
		var assocChangedUnits = {};
		var assocLimcisByUnit = {};
		var assocDbLimcisByUnit = {};
		for (var unit in storage.assocUnstableUnits){
			var o = storage.assocUnstableUnits[unit];
			if (o.main_chain_index > last_main_chain_index || o.main_chain_index === null){
				o.latest_included_mc_index = null;
				assocChangedUnits[unit] = o;
			}
		}
		calcLIMCIs(function(){
			console.log("calcLIMCIs done");
			if (conf.bFaster){
				return async.forEachOfSeries(
					assocLimcisByUnit,
					function(limci, unit, cb){
						conn.query("UPDATE units SET latest_included_mc_index=? WHERE unit=?", [limci, unit], function(){ cb(); });
					},
					checkAllLatestIncludedMcIndexesAreSet
				);
			}
			conn.query("UPDATE units SET latest_included_mc_index=NULL WHERE main_chain_index>? OR main_chain_index IS NULL", [last_main_chain_index], function(res){
				console.log("update LIMCI=NULL done, matched rows: "+res.affectedRows);
				profiler.stop('mc-limci-set-null');
				profiler.start();
				conn.query(
					// if these units have other parents, they cannot include later MC units (otherwise, the parents would've been redundant).
					// the 2nd condition in WHERE is the same that was used 1 query ago to NULL limcis.

					// I had to rewrite this single query because sqlite doesn't support JOINs in UPDATEs
					/*
					"UPDATE units AS punits \n\
					JOIN parenthoods ON punits.unit=parent_unit \n\
					JOIN units AS chunits ON child_unit=chunits.unit \n\
					SET chunits.latest_included_mc_index=punits.main_chain_index \n\
					WHERE punits.is_on_main_chain=1 \n\
						AND (chunits.main_chain_index > ? OR chunits.main_chain_index IS NULL) \n\
						AND chunits.latest_included_mc_index IS NULL", 
					[last_main_chain_index],
					function(result){
						if (result.affectedRows === 0 && bRebuiltMc)
							throw "no latest_included_mc_index updated";
						propagateLIMCI();
					}
					*/
					"SELECT chunits.unit, punits.main_chain_index \n\
					FROM units AS punits \n\
					JOIN parenthoods ON punits.unit=parent_unit \n\
					JOIN units AS chunits ON child_unit=chunits.unit \n\
					WHERE punits.is_on_main_chain=1 \n\
						AND (chunits.main_chain_index > ? OR chunits.main_chain_index IS NULL) \n\
						AND chunits.latest_included_mc_index IS NULL", 
					[last_main_chain_index],
					function(rows){
						console.log(rows.length+" rows");
						profiler.stop('mc-limci-select-initial');
						profiler.start();
						if (rows.length === 0 && bRebuiltMc)
							throw Error("no latest_included_mc_index updated, last_mci="+last_main_chain_index+", affected="+res.affectedRows);
						async.eachSeries(
							rows,
							function(row, cb){
								console.log(row.main_chain_index, row.unit);
								assocDbLimcisByUnit[row.unit] = row.main_chain_index;
								conn.query("UPDATE units SET latest_included_mc_index=? WHERE unit=?", [row.main_chain_index, row.unit], function(){ cb(); });
							},
							function(){
								profiler.stop('mc-limci-update-initial');
								propagateLIMCI();
							}
						);
					}
				);
			});
		});
	}

	function readLastStableMcUnit(handleLastStableMcUnit){
		conn.query("SELECT unit FROM units WHERE is_on_main_chain=1 AND is_stable=1 ORDER BY main_chain_index DESC LIMIT 1", function(rows){
			if (rows.length === 0)
				throw Error("no units on stable MC?");
			handleLastStableMcUnit(rows[0].unit);
		});
	}

	function findMinMcWitnessedLevel(tip_unit, first_unstable_mc_level, first_unstable_mc_index, arrWitnesses, handleMinMcWl){
		var _arrWitnesses = arrWitnesses;
		var arrCollectedWitnesses = [];
		var min_mc_wl = Number.POSITIVE_INFINITY;

		function addWitnessesAndGoUp(start_unit){
			storage.readStaticUnitProps(conn, start_unit, function(props){
				var best_parent_unit = props.best_parent_unit;
				var level = props.level;
				if (level === null)
					throw Error("null level in findMinMcWitnessedLevel");
				if (level < first_unstable_mc_level) {
					console.log("unit " + start_unit + ", level=" + level + ", first_unstable_mc_level=" + first_unstable_mc_level + ", min_mc_wl=" + min_mc_wl);
					return handleMinMcWl(-1);
				}
				storage.readUnitAuthors(conn, start_unit, function(arrAuthors){
					for (var i=0; i<arrAuthors.length; i++){
						var address = arrAuthors[i];
						if (_arrWitnesses.indexOf(address) !== -1 && arrCollectedWitnesses.indexOf(address) === -1) {
							arrCollectedWitnesses.push(address);
							var witnessed_level = props.witnessed_level;
							if (min_mc_wl > witnessed_level)
								min_mc_wl = witnessed_level;
						}
					}
					(arrCollectedWitnesses.length < constants.MAJORITY_OF_WITNESSES) 
						? addWitnessesAndGoUp(best_parent_unit) : handleMinMcWl(min_mc_wl);
				});
			});
		}

		if (first_unstable_mc_index > constants.lastBallStableInParentsUpgradeMci)
			return addWitnessesAndGoUp(tip_unit);
		// use old algo for old units
		storage.readWitnesses(conn, tip_unit, function(arrTipUnitWitnesses){
			_arrWitnesses = arrTipUnitWitnesses;
			addWitnessesAndGoUp(tip_unit);
		});
	}
	
	function updateStableMcFlag(){
		profiler.start();
		if (bKeepStabilityPoint)
			return finish();
		console.log("updateStableMcFlag");
		readLastStableMcUnit(function(last_stable_mc_unit){
			console.log("last stable mc unit "+last_stable_mc_unit);
			storage.readWitnesses(conn, last_stable_mc_unit, function(arrWitnesses){
				console.log(`witnesses on ${last_stable_mc_unit}`, arrWitnesses)
				conn.query("SELECT unit, is_on_main_chain, main_chain_index, level FROM units WHERE best_parent_unit=?", [last_stable_mc_unit], function(rows){
					if (rows.length === 0){
						if (storage.isGenesisUnit(last_added_unit))
						    return markMcIndexStable(conn, batch, 0, finish);
						throw Error("no best children of last stable MC unit "+last_stable_mc_unit+"?");
					}
					var arrMcRows  = rows.filter(function(row){ return (row.is_on_main_chain === 1); }); // only one element
					var arrAltRows = rows.filter(function(row){ return (row.is_on_main_chain === 0); });
					if (arrMcRows.length !== 1)
						throw Error("not a single MC child?");
					var first_unstable_mc_unit = arrMcRows[0].unit;
					var first_unstable_mc_index = arrMcRows[0].main_chain_index;
					console.log({first_unstable_mc_index})
					var first_unstable_mc_level = arrMcRows[0].level;
					var arrAltBranchRootUnits = arrAltRows.map(function(row){ return row.unit; });
					
					function advanceLastStableMcUnitAndTryNext(){
						profiler.stop('mc-stableFlag');
						markMcIndexStable(conn, batch, first_unstable_mc_index, (count_aa_triggers) => {
							arrStabilizedMcis.push(first_unstable_mc_index);
							if (count_aa_triggers)
								bStabilizedAATriggers = true;
							updateStableMcFlag();
						});
					}

					if (first_unstable_mc_index > constants.lastBallStableInParentsUpgradeMci) {
						var arrFreeUnits = [];
						for (var unit in storage.assocUnstableUnits)
							if (storage.assocUnstableUnits[unit].is_free === 1)
								arrFreeUnits.push(unit);
						console.log(`will call determineIfStableInLaterUnits`, first_unstable_mc_unit, arrFreeUnits)
						determineIfStableInLaterUnits(conn, first_unstable_mc_unit, arrFreeUnits, function (bStable) {
							console.log(first_unstable_mc_unit + ' stable in free units ' + arrFreeUnits.join(', ') + ' ? ' + bStable);
							bStable ? advanceLastStableMcUnitAndTryNext() : finish();
						});
						return;
					}
				
					conn.query("SELECT unit FROM units WHERE is_free=1 AND is_on_main_chain=1", function(tip_rows){
						if (tip_rows.length !== 1)
							throw Error("not a single mc tip");
						// this is the level when we colect 7 witnesses if walking up the MC from its end
						var tip_unit = tip_rows[0].unit;
						findMinMcWitnessedLevel(tip_unit, first_unstable_mc_level, first_unstable_mc_index, arrWitnesses,
							function(min_mc_wl){
								console.log("minimum witnessed level "+min_mc_wl);
								if (min_mc_wl == -1)
									return finish();

								if (arrAltBranchRootUnits.length === 0){ // no alt branches
									if (min_mc_wl >= first_unstable_mc_level) 
										return advanceLastStableMcUnitAndTryNext();
									return finish();
									/*
									// if there are 12 witnesses on the MC, the next unit is stable
									// This is not reliable. Adding a new unit after this one (not descending from this one)
									// could change the MC near the tip and route the MC away from a witness-authored unit, thus decreasing the count below 12
									conn.query(
										"SELECT COUNT(DISTINCT address) AS count_witnesses FROM units JOIN unit_authors USING(unit) \n\
										WHERE is_on_main_chain=1 AND main_chain_index>=? AND address IN(?)",
										[first_unstable_mc_index, arrWitnesses],
										function(count_witnesses_rows){
											(count_witnesses_rows[0].count_witnesses === constants.COUNT_WITNESSES) 
												? advanceLastStableMcUnitAndTryNext() : finish();
										}
									);
									return;
									*/
								}
								createListOfBestChildren(arrAltBranchRootUnits, function(arrAltBestChildren){
									determineMaxAltLevel(
										conn, first_unstable_mc_index, first_unstable_mc_level, arrAltBestChildren, arrWitnesses,
										function(max_alt_level){
											if (min_mc_wl > max_alt_level)
												return advanceLastStableMcUnitAndTryNext();
											console.log('--- with branches - unstable');
											if (arrAllParents.length <= 1) // single free unit
												return finish();
											console.log('--- will try tip parent '+tip_unit);
											determineIfStableInLaterUnits(conn, first_unstable_mc_unit, [tip_unit], function (bStable) {
												console.log('---- tip only: '+bStable);
												bStable ? advanceLastStableMcUnitAndTryNext() : finish();
											});
										}
									);
								});
							}
						);
					});
				});
			});
		});
	}

	// also includes arrParentUnits
	function createListOfBestChildren(arrParentUnits, handleBestChildrenList){
		if (arrParentUnits.length === 0)
			return handleBestChildrenList([]);
		var arrBestChildren = arrParentUnits.slice();
		
		function goDownAndCollectBestChildren(arrStartUnits, cb){
			conn.query("SELECT unit, is_free FROM units WHERE best_parent_unit IN(?)", [arrStartUnits], function(rows){
				if (rows.length === 0)
					return cb();
				//console.log("unit", arrStartUnits, "best children:", rows.map(function(row){ return row.unit; }), "free units:", rows.reduce(function(sum, row){ return sum+row.is_free; }, 0));
				async.eachSeries(
					rows, 
					function(row, cb2){
						arrBestChildren.push(row.unit);
						if (row.is_free === 1)
							cb2();
						else
							goDownAndCollectBestChildren([row.unit], cb2);
					},
					cb
				);
			});
		}
		
		goDownAndCollectBestChildren(arrParentUnits, function(){
			handleBestChildrenList(arrBestChildren);
		});
	}


	
	async function finish(){
		profiler.stop('mc-stableFlag');
		if (!bStabilizedAATriggers && arrStabilizedMcis.length > 0)
			await storage.updateTpsFees(conn, arrStabilizedMcis);
		console.log("done updating MC\n");
		if (onDone)
			onDone(arrStabilizedMcis, bStabilizedAATriggers);
	}
	
	
	console.log("\nwill update MC");
	
	/*if (from_unit === null && arrRetreatingUnits.indexOf(last_added_unit) >= 0){
		conn.query("UPDATE units SET is_on_main_chain=1, main_chain_index=NULL WHERE unit=?", [last_added_unit], function(){
			goUpFromUnit(last_added_unit);
		});
	}
	else*/
		goUpFromUnit(from_unit);
	
}





/*

// climbs up along best parent links up, returns list of units encountered with level >= min_level
function createListOfPrivateMcUnits(start_unit, min_level, handleList){
	var arrUnits = [];
	
	function goUp(unit){
		conn.query(
			"SELECT best_parent_unit, level FROM units WHERE unit=?", [unit],
			function(rows){
				if (rows.length !== 1)
					throw "createListOfPrivateMcUnits: not 1 row";
				var row = rows[0];
				if (row.level < min_level) 
					return handleList(arrUnits);
				arrUnits.push(unit);
				goUp(row.best_parent_unit);
			}
		);
	}
	
	goUp(start_unit);
}

*/


function readBestChildrenProps(conn, arrUnits, handleResult){
	if (arrUnits.every(function(unit){ return !!storage.assocUnstableUnits[unit]; })){
		var arrProps = [];
		arrUnits.forEach(function(unit){
			if (storage.assocBestChildren[unit])
				arrProps = arrProps.concat(storage.assocBestChildren[unit]);
		});
		return handleResult(arrProps);
	}
	conn.query("SELECT unit, is_on_main_chain, main_chain_index, latest_included_mc_index, level, witnessed_level, is_free FROM units WHERE best_parent_unit IN(?)", [arrUnits], function(rows){
		if (arrUnits.every(function(unit){ return !!storage.assocUnstableUnits[unit]; })){
			var arrProps = [];
			arrUnits.forEach(function(unit){
				if (storage.assocBestChildren[unit])
					arrProps = arrProps.concat(storage.assocBestChildren[unit]);
			});
			if (!arraysEqual(_.sortBy(rows, 'unit'), _.sortBy(arrProps, 'unit'), ['unit', 'is_on_main_chain', 'main_chain_index', 'latest_included_mc_index', 'level', 'witnessed_level', 'is_free']))
				throwError("different best children of "+arrUnits.join(', ')+": db "+JSON.stringify(rows)+", mem "+JSON.stringify(arrProps));
		}
		handleResult(rows);
	});
}

function arraysEqual(arr1, arr2, fields){
	if (arr1.length !== arr2.length)
		return false;
	for (var i=0; i<arr1.length; i++)
		for (var j=0; j<fields.length; j++)
			if (arr1[i][fields[i]] !== arr2[i][fields[i]])
				return false;
	return true;
}

function determineMaxAltLevel(conn, first_unstable_mc_index, first_unstable_mc_level, arrAltBestChildren, arrWitnesses, handleResult){
//	console.log('=============  alt branch children\n', arrAltBestChildren.join('\n'));
	// Compose a set S of units that increase WL, that is their own WL is greater than that of every parent. 
	// In this set, find max L. Alt WL will never reach it. If min_mc_wl > L, next MC unit is stable.
	// Also filter the set S to include only those units that are conformant with the last stable MC unit.
	if (first_unstable_mc_index >= constants.altBranchByBestParentUpgradeMci){
		conn.query(
			"SELECT MAX(bpunits.level) AS max_alt_level \n\
			FROM units \n\
			CROSS JOIN units AS bpunits \n\
				ON units.best_parent_unit=bpunits.unit AND bpunits.witnessed_level < units.witnessed_level \n\
			WHERE units.unit IN("+arrAltBestChildren.map(db.escape).join(', ')+")",
			function(max_alt_rows){
				var max_alt_level = max_alt_rows[0].max_alt_level; // can be null
			//	console.log('===== min_mc_wl='+min_mc_wl+', max_alt_level='+max_alt_level+", first_unstable_mc_level="+first_unstable_mc_level);
				handleResult(max_alt_level || first_unstable_mc_level);
			}
		);
	}
	else{
		// this sql query is totally wrong but we still leave it for compatibility
		conn.query(
			"SELECT MAX(units.level) AS max_alt_level \n\
			FROM units \n\
			LEFT JOIN parenthoods ON units.unit=child_unit \n\
			LEFT JOIN units AS punits ON parent_unit=punits.unit AND punits.witnessed_level >= units.witnessed_level \n\
			WHERE units.unit IN("+arrAltBestChildren.map(db.escape).join(', ')+") AND punits.unit IS NULL AND ( \n\
				SELECT COUNT(*) \n\
				FROM unit_witnesses \n\
				WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND unit_witnesses.address IN(?) \n\
			)>=?",
			[arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS],
			function(max_alt_rows){
				if (max_alt_rows.length !== 1)
					throw Error("not a single max alt level");
				var max_alt_level = max_alt_rows[0].max_alt_level;
			//	console.log('===== min_mc_wl='+min_mc_wl+', max_alt_level='+max_alt_level+", first_unstable_mc_level="+first_unstable_mc_level);
				handleResult(max_alt_level);
			}
		);
	}
}


function determineIfStableInLaterUnitsWithMaxLastBallMciFastPath(conn, earlier_unit, arrLaterUnits, handleResult) {
	if (!handleResult)
		return new Promise(resolve => determineIfStableInLaterUnitsWithMaxLastBallMciFastPath(conn, earlier_unit, arrLaterUnits, resolve));
	if (storage.isGenesisUnit(earlier_unit))
		return handleResult(true);
	storage.readUnitProps(conn, earlier_unit, function (objEarlierUnitProps) {
		if (objEarlierUnitProps.is_free === 1 || objEarlierUnitProps.main_chain_index === null)
			return handleResult(false);
		storage.readMaxLastBallMci(conn, arrLaterUnits, function (max_last_ball_mci) {
			if (objEarlierUnitProps.main_chain_index <= max_last_ball_mci)
				return handleResult(true);
			determineIfStableInLaterUnits(conn, earlier_unit, arrLaterUnits, handleResult);
		});
	});
}

function determineIfStableInLaterUnits(conn, earlier_unit, arrLaterUnits, handleResult){
	if (storage.isGenesisUnit(earlier_unit))
		return handleResult(true);
	// hack to workaround past validation error
	if (earlier_unit === 'LGFzduLJNQNzEqJqUXdkXr58wDYx77V8WurDF3+GIws=' && arrLaterUnits.join(',') === '6O4t3j8kW0/Lo7n2nuS8ITDv2UbOhlL9fF1M6j/PrJ4='
		|| earlier_unit === 'VLdMzBDVpwqu+3OcZrBrmkT0aUb/mZ0O1IveDmGqIP0=' && arrLaterUnits.join(',') === 'pAfErVAA5CSPeh1KoLidDTgdt5Blu7k2rINtxVTMq4k='
		|| earlier_unit === 'P2gqiei+7dur/gS1KOFHg0tiEq2+7l321AJxM3o0f5Q=' && arrLaterUnits.join(',') === '9G8kctAVAiiLf4/cyU2f4gdtD+XvKd1qRp0+k3qzR8o='
		|| constants.bTestnet && earlier_unit === 'zAytsscSjo+N9dQ/VLio4ZDgZS91wfUk0IOnzzrXcYU=' && arrLaterUnits.join(',') === 'ZSQgpR326LEU4jW+1hQ5ZwnHAVnGLV16Kyf/foVeFOc='
		|| constants.bTestnet && ['XbS1+l33sIlcBQ//2/ZyPsRV7uhnwOPvvuQ5IzB+vC0=', 'TMTkvkXOL8CxnuDzw36xDWI6bO5PrhicGLBR3mwrAxE=', '7s8y/32r+3ew1jmunq1ZVyH+MQX9HUADZDHu3otia9U='].indexOf(earlier_unit) >= 0 && arrLaterUnits.indexOf('39SDVpHJuzdDChPRerH0bFQOE5sudJCndQTaD4H8bms=') >= 0
		|| constants.bTestnet && earlier_unit === 'N6Va5P0GgJorezFzwHiZ5HuF6p6HhZ29rx+eebAu0J0=' && arrLaterUnits.indexOf('mKwL1PTcWY783sHiCuDRcb6nojQAkwbeSL/z2a7uE6g=') >= 0
	)
		return handleResult(true);
	var start_time = Date.now();
	storage.readPropsOfUnits(conn, earlier_unit, arrLaterUnits, function(objEarlierUnitProps, arrLaterUnitProps){
		if (constants.bTestnet && objEarlierUnitProps.main_chain_index <= 1220148 && objEarlierUnitProps.is_on_main_chain && arrLaterUnits.indexOf('qwKGj0w8P/jscAyQxSOSx2sUZCRFq22hsE6bSiqgUyk=') >= 0)
			return handleResult(true);
		if (objEarlierUnitProps.is_free === 1 || objEarlierUnitProps.main_chain_index === null)
			return handleResult(false);
		var max_later_limci = Math.max.apply(
			null, arrLaterUnitProps.map(function(objLaterUnitProps){ return objLaterUnitProps.latest_included_mc_index; }));
		if (max_later_limci < objEarlierUnitProps.main_chain_index) // the earlier unit is actually later
			return handleResult(false);
		var max_later_level = Math.max.apply(
			null, arrLaterUnitProps.map(function(objLaterUnitProps){ return objLaterUnitProps.level; }));
		var max_later_witnessed_level = Math.max.apply(
			null, arrLaterUnitProps.map(function(objLaterUnitProps){ return objLaterUnitProps.witnessed_level; }));
		readBestParentAndItsWitnesses(conn, earlier_unit, function(best_parent_unit, arrWitnesses){
			conn.query("SELECT unit, is_on_main_chain, main_chain_index, level FROM units WHERE best_parent_unit=?", [best_parent_unit], function(rows){
				if (rows.length === 0)
					throw Error("no best children of "+best_parent_unit+"?");
				var arrMcRows  = rows.filter(function(row){ return (row.is_on_main_chain === 1); }); // only one element
				var arrAltRows = rows.filter(function(row){ return (row.is_on_main_chain === 0); });
				if (arrMcRows.length !== 1)
					throw Error("not a single MC child?");
				var first_unstable_mc_unit = arrMcRows[0].unit;
				if (first_unstable_mc_unit !== earlier_unit)
					throw Error("first unstable MC unit is not our input unit");
				var first_unstable_mc_index = arrMcRows[0].main_chain_index;
				var first_unstable_mc_level = arrMcRows[0].level;
				var arrAltBranchRootUnits = arrAltRows.map(function(row){ return row.unit; });
				//console.log("first_unstable_mc_index", first_unstable_mc_index);
				//console.log("first_unstable_mc_level", first_unstable_mc_level);
				//console.log("alt", arrAltBranchRootUnits);
				
				function findMinMcWitnessedLevel(handleMinMcWl){
					createListOfBestChildrenIncludedByLaterUnits([first_unstable_mc_unit], function(arrBestChildren){
						conn.query( // if 2 witnesses authored the same unit, unit_authors will be joined 2 times and counted twice
							"SELECT witnessed_level, address \n\
							FROM units \n\
							CROSS JOIN unit_authors USING(unit) \n\
							WHERE unit IN("+arrBestChildren.map(db.escape).join(', ')+") AND address IN(?) \n\
							ORDER BY witnessed_level DESC",
							[arrWitnesses],
							function(rows){
								var arrCollectedWitnesses = [];
								var min_mc_wl = -1;
								for (var i=0; i<rows.length; i++){
									var row = rows[i];
									if (arrCollectedWitnesses.indexOf(row.address) === -1){
										arrCollectedWitnesses.push(row.address);
										if (arrCollectedWitnesses.length >= constants.MAJORITY_OF_WITNESSES){
											min_mc_wl = row.witnessed_level;
											break;
										}
									}
								}
							//	var min_mc_wl = rows[constants.MAJORITY_OF_WITNESSES-1].witnessed_level;
								if (first_unstable_mc_index > constants.branchedMinMcWlUpgradeMci){
									if (min_mc_wl === -1) {
										console.log("couldn't collect 7 witnesses, earlier unit "+earlier_unit+", best children "+arrBestChildren.join(', ')+", later "+arrLaterUnits.join(', ')+", witnesses "+arrWitnesses.join(', ')+", collected witnesses "+arrCollectedWitnesses.join(', '));
										return handleMinMcWl(null);
									}
									return handleMinMcWl(min_mc_wl);
								}
								// it might be more optimistic because it collects 7 witness units, not 7 units posted by _different_ witnesses
								findMinMcWitnessedLevelOld(function(old_min_mc_wl){
									var diff = min_mc_wl - old_min_mc_wl;
									console.log("---------- new min_mc_wl="+min_mc_wl+", old min_mc_wl="+old_min_mc_wl+", diff="+diff+", later "+arrLaterUnits.join(', '));
								//	if (diff < 0)
								//		throw Error("new min_mc_wl="+min_mc_wl+", old min_mc_wl="+old_min_mc_wl+", diff="+diff+" for earlier "+earlier_unit+", later "+arrLaterUnits.join(', '));
									handleMinMcWl(Math.max(old_min_mc_wl, min_mc_wl));
								});
							}
						);
					});
				}
				
				function findMinMcWitnessedLevelOld(handleMinMcWl){
					var min_mc_wl = Number.MAX_VALUE;
					var count = 0;

					function goUp(start_unit){
						conn.query(
							"SELECT best_parent_unit, witnessed_level, \n\
								(SELECT COUNT(*) FROM unit_authors WHERE unit_authors.unit=units.unit AND address IN(?)) AS count \n\
							FROM units WHERE unit=?", [arrWitnesses, start_unit],
							function(rows){
								if (rows.length !== 1)
									throw Error("findMinMcWitnessedLevelOld: not 1 row");
								var row = rows[0];
								if (row.count > 0 && row.witnessed_level < min_mc_wl)
									min_mc_wl = row.witnessed_level;
								count += row.count; // this is a bug, should count only unique witnesses
								(count < constants.MAJORITY_OF_WITNESSES) ? goUp(row.best_parent_unit) : handleMinMcWl(min_mc_wl);
							}
						);
					}

					conn.query(
						"SELECT witnessed_level, best_parent_unit, \n\
							(SELECT COUNT(*) FROM unit_authors WHERE unit_authors.unit=units.unit AND address IN(?)) AS count \n\
						FROM units \n\
						WHERE unit IN(?) \n\
						ORDER BY witnessed_level DESC, \n\
							level-witnessed_level ASC, \n\
							unit ASC \n\
						LIMIT 1", 
						[arrWitnesses, arrLaterUnits],
						function(rows){
							var row = rows[0];
							if (row.count > 0)
								min_mc_wl = row.witnessed_level;
							count += row.count;
							goUp(row.best_parent_unit);
						}
					);
				}
				
				function determineIfHasAltBranches(handleHasAltBranchesResult){
					if (arrAltBranchRootUnits.length === 0)
						return handleHasAltBranchesResult(false);
					// check if alt branches are included by later units
					async.eachSeries(
						arrAltBranchRootUnits, 
						function(alt_root_unit, cb){
							graph.determineIfIncludedOrEqual(conn, alt_root_unit, arrLaterUnits, function(bIncluded){
								bIncluded ? cb("included") : cb();
							});
						},
						function(err){
							handleHasAltBranchesResult(err ? true : false);
						}
					);
				}
				
				// also includes arrAltBranchRootUnits
				function createListOfBestChildrenIncludedByLaterUnits(arrAltBranchRootUnits, handleBestChildrenList){
					if (arrAltBranchRootUnits.length === 0)
						return handleBestChildrenList([]);
					var arrBestChildren = [];
					var arrTips = [];
					var arrNotIncludedTips = [];
					var arrRemovedBestChildren = [];

					function goDownAndCollectBestChildrenOld(arrStartUnits, cb){
						conn.query("SELECT unit, is_free, main_chain_index FROM units WHERE best_parent_unit IN(?)", [arrStartUnits], function(rows){
							if (rows.length === 0)
								return cb();
							async.eachSeries(
								rows, 
								function(row, cb2){
									
									function addUnit(){
										arrBestChildren.push(row.unit);
										if (row.is_free === 1 || arrLaterUnits.indexOf(row.unit) >= 0)
											cb2();
										else
											goDownAndCollectBestChildrenOld([row.unit], cb2);
									}
									
									if (row.main_chain_index !== null && row.main_chain_index <= max_later_limci)
										addUnit();
									else
										graph.determineIfIncludedOrEqual(conn, row.unit, arrLaterUnits, function(bIncluded){
											bIncluded ? addUnit() : cb2();
										});
								},
								cb
							);
						});
					}

					function goDownAndCollectBestChildrenFast(arrStartUnits, cb){
						readBestChildrenProps(conn, arrStartUnits, function(rows){
							if (rows.length === 0){
								arrStartUnits.forEach(function(start_unit){
									arrTips.push(start_unit);
								});
								return cb();
							}
							var count = arrBestChildren.length;
							async.eachSeries(
								rows, 
								function(row, cb2){
									arrBestChildren.push(row.unit);
									if (arrLaterUnits.indexOf(row.unit) >= 0)
										cb2();
									else if (
										row.is_free === 1
										|| row.level >= max_later_level
										|| row.witnessed_level > max_later_witnessed_level && first_unstable_mc_index >= constants.witnessedLevelMustNotRetreatFromAllParentsUpgradeMci
										|| row.latest_included_mc_index > max_later_limci
										|| row.is_on_main_chain && row.main_chain_index > max_later_limci
									){
										arrTips.push(row.unit);
										arrNotIncludedTips.push(row.unit);
										cb2();
									}
									else {
										if (count % 100 === 0)
											return setImmediate(goDownAndCollectBestChildrenFast, [row.unit], cb2);
										goDownAndCollectBestChildrenFast([row.unit], cb2);
									}
								},
								function () {
									(count % 100 === 0) ? setImmediate(cb) : cb();
								}
							);
						});
					}
					
					function findBestChildrenNotIncludedInLaterUnits(arrUnits, cb){
						var arrUnitsToRemove = [];
						async.eachSeries(
							arrUnits, 
							function(unit, cb2){
								if (arrRemovedBestChildren.indexOf(unit) >= 0)
									return cb2();
								if (arrNotIncludedTips.indexOf(unit) >= 0){
									arrUnitsToRemove.push(unit);
									return cb2();
								}
								graph.determineIfIncludedOrEqual(conn, unit, arrLaterUnits, function(bIncluded){
									if (!bIncluded)
										arrUnitsToRemove.push(unit);
									cb2();
								});
							},
							function(){
								if (arrUnitsToRemove.length === 0)
									return cb();
								arrRemovedBestChildren = arrRemovedBestChildren.concat(arrUnitsToRemove);
								goUp(arrUnitsToRemove, cb);
							}
						);
					}
					
					function goUp(arrCurrentTips, cb){
						var arrUnits = [];
						async.eachSeries(
							arrCurrentTips,
							function(unit, cb2){
								storage.readStaticUnitProps(conn, unit, function(props){
									if (arrUnits.indexOf(props.best_parent_unit) === -1)
										arrUnits.push(props.best_parent_unit);
									cb2();
								});
							},
							function(){
								findBestChildrenNotIncludedInLaterUnits(arrUnits, cb);
							}
						);
					}
					
					function collectBestChildren(arrFilteredAltBranchRootUnits, cb){
						goDownAndCollectBestChildrenFast(arrFilteredAltBranchRootUnits, function(){
							if (arrTips.length === 0)
								return cb();
							var start_time = Date.now();
							findBestChildrenNotIncludedInLaterUnits(arrTips, function(){
								console.log("findBestChildrenNotIncludedInLaterUnits took "+(Date.now()-start_time)+"ms");
								arrBestChildren = _.difference(arrBestChildren, arrRemovedBestChildren);
								cb();
							});
						});
					}

					// leaves only those roots that are included by later units
					function filterAltBranchRootUnits(cb){
						//console.log('===== before filtering:', arrAltBranchRootUnits);
						var arrFilteredAltBranchRootUnits = [];
						conn.query("SELECT unit, is_free, main_chain_index FROM units WHERE unit IN(?)", [arrAltBranchRootUnits], function(rows){
							if (rows.length === 0)
								throw Error("no alt branch root units?");
							async.eachSeries(
								rows, 
								function(row, cb2){
									
									function addUnit(){
										arrBestChildren.push(row.unit);
									//	if (row.is_free === 0) // seems no reason to exclude
											arrFilteredAltBranchRootUnits.push(row.unit);
										cb2();
									}
									
									if (row.main_chain_index !== null && row.main_chain_index <= max_later_limci)
										addUnit();
									else
										graph.determineIfIncludedOrEqual(conn, row.unit, arrLaterUnits, function(bIncluded){
											bIncluded ? addUnit() : cb2();
										});
								},
								function(){
									//console.log('filtered:', arrFilteredAltBranchRootUnits);
									if (arrFilteredAltBranchRootUnits.length === 0)
										return handleBestChildrenList([]);
									var arrInitialBestChildren = _.clone(arrBestChildren);
									var start_time = Date.now();
									if (conf.bFaster)
										return collectBestChildren(arrFilteredAltBranchRootUnits, function(){
											console.log("collectBestChildren took "+(Date.now()-start_time)+"ms");
											cb();
										});
									goDownAndCollectBestChildrenOld(arrFilteredAltBranchRootUnits, function(){
										console.log("goDownAndCollectBestChildrenOld took "+(Date.now()-start_time)+"ms");
										var arrBestChildren1 = _.clone(arrBestChildren.sort());
										arrBestChildren = arrInitialBestChildren;
										start_time = Date.now();
										collectBestChildren(arrFilteredAltBranchRootUnits, function(){
											console.log("collectBestChildren took "+(Date.now()-start_time)+"ms");
											arrBestChildren.sort();
											if (!_.isEqual(arrBestChildren, arrBestChildren1)){
												throwError("different best children, old "+arrBestChildren1.join(', ')+'; new '+arrBestChildren.join(', ')+', later '+arrLaterUnits.join(', ')+', earlier '+earlier_unit+", global db? = "+(conn === db));
												arrBestChildren = arrBestChildren1;
											}
											cb();
										});
									});
								}
							);
						});
					}

					filterAltBranchRootUnits(function(){
						//console.log('best children:', arrBestChildren);
						handleBestChildrenList(arrBestChildren);
					});
				}
				
				findMinMcWitnessedLevel(function(min_mc_wl){
					//console.log("min mc wl", min_mc_wl);
					if (min_mc_wl === null) // couldn't collect even 7 witnesses
						return handleResult(false);
					determineIfHasAltBranches(function(bHasAltBranches){
						if (!bHasAltBranches){
							console.log("determineIfStableInLaterUnits no alt took "+(Date.now()-start_time)+"ms");
							if (min_mc_wl >= first_unstable_mc_level) 
								return handleResult(true);
							return handleResult(false);
							/*
							// Wrong. See the comment above
							// if there are 12 witnesses on the MC, the next unit is stable
							conn.query(
								"SELECT COUNT(DISTINCT address) AS count_witnesses FROM units JOIN unit_authors USING(unit) \n\
								WHERE is_on_main_chain=1 AND main_chain_index>=? AND address IN(?)",
								[first_unstable_mc_index, arrWitnesses],
								function(count_witnesses_rows){
									console.log(count_witnesses_rows[0]);
									handleResult(count_witnesses_rows[0].count_witnesses === constants.COUNT_WITNESSES);
								}
							);
							return;
							*/
						}
						// has alt branches
						if (first_unstable_mc_index >= constants.altBranchByBestParentUpgradeMci && min_mc_wl < first_unstable_mc_level){
							console.log("determineIfStableInLaterUnits min_mc_wl < first_unstable_mc_level with branches: not stable took "+(Date.now()-start_time)+"ms");
							return handleResult(false);
						}
						createListOfBestChildrenIncludedByLaterUnits(arrAltBranchRootUnits, function(arrAltBestChildren){
							determineMaxAltLevel(
								conn, first_unstable_mc_index, first_unstable_mc_level, arrAltBestChildren, arrWitnesses,
								function(max_alt_level){
									console.log("determineIfStableInLaterUnits with branches took "+(Date.now()-start_time)+"ms");
									// allow '=' since alt WL will *never* reach max_alt_level.
									// The comparison when moving the stability point above is still strict for compatibility
									handleResult(min_mc_wl >= max_alt_level);
								}
							);
						});
						
					});
				});
		
			});
		});
	
	});

}

// It is assumed earlier_unit is not marked as stable yet
// If it appears to be stable, its MC index will be marked as stable, as well as all preceeding MC indexes
function determineIfStableInLaterUnitsAndUpdateStableMcFlag(conn, earlier_unit, arrLaterUnits, bStableInDb, handleResult){
	determineIfStableInLaterUnits(conn, earlier_unit, arrLaterUnits, function(bStable){
		console.log("determineIfStableInLaterUnits", earlier_unit, arrLaterUnits, bStable);
		if (!bStable)
			return handleResult(bStable);
		if (bStable && bStableInDb)
			return handleResult(bStable);
		breadcrumbs.add('stable in parents, will wait for write lock');
		handleResult(bStable, true);

		// result callback already called, we stay here to move the stability point forward.
		// To avoid deadlocks, we always first obtain a "write" lock, then a db connection
		mutex.lock(["write"], async function(unlock){
			breadcrumbs.add('stable in parents, got write lock');
			// take a new connection
			let conn = await db.takeConnectionFromPool();
			await conn.query("BEGIN");
			storage.readLastStableMcIndex(conn, function(last_stable_mci){
				if (last_stable_mci >= constants.v4UpgradeMci && !(constants.bTestnet && last_stable_mci === 3547801))
					throwError(`${earlier_unit} not stable in db but stable in later units ${arrLaterUnits.join(', ')} in v4`);
				storage.readUnitProps(conn, earlier_unit, function(objEarlierUnitProps){
					var new_last_stable_mci = objEarlierUnitProps.main_chain_index;
					if (new_last_stable_mci <= last_stable_mci) // fix: it could've been changed by parallel tasks - No, our SQL transaction doesn't see the changes
						return throwError("new last stable mci expected to be higher than existing");
					var mci = last_stable_mci;
					var batch = kvstore.batch();
					advanceLastStableMcUnitAndStepForward();

					function advanceLastStableMcUnitAndStepForward(){
						mci++;
						if (mci <= new_last_stable_mci)
							markMcIndexStable(conn, batch, mci, advanceLastStableMcUnitAndStepForward);
						else{
							batch.write({ sync: true }, async function(err){
								if (err)
									throw Error("determineIfStableInLaterUnitsAndUpdateStableMcFlag: batch write failed: "+err);
								await conn.query("COMMIT");
								conn.release();
								unlock();
							//	handleResult(bStable, true);
							});
						}
					}            
				});
			});
		});
	});
}




function readBestParentAndItsWitnesses(conn, unit, handleBestParentAndItsWitnesses){
	storage.readStaticUnitProps(conn, unit, function(props){
		storage.readWitnesses(conn, props.best_parent_unit, function(arrWitnesses){
			handleBestParentAndItsWitnesses(props.best_parent_unit, arrWitnesses);
		});
	});
}


function markMcIndexStable(conn, batch, mci, onDone){
	profiler.start();
	let count_aa_triggers;
	var arrStabilizedUnits = [];
	if (mci > 0)
		storage.assocStableUnitsByMci[mci] = [];
	for (var unit in storage.assocUnstableUnits){
		var o = storage.assocUnstableUnits[unit];
		if (o.main_chain_index === mci && o.is_stable === 0){
			o.is_stable = 1;
			storage.assocStableUnits[unit] = o;
			storage.assocStableUnitsByMci[mci].push(o);
			arrStabilizedUnits.push(unit);
		}
	}
	arrStabilizedUnits.forEach(function(unit){
		delete storage.assocUnstableUnits[unit];
	});
	conn.query(
		"UPDATE units SET is_stable=1 WHERE is_stable=0 AND main_chain_index=?", 
		[mci], 
		function(){
			// next op
			handleNonserialUnits();
		}
	);


	function handleNonserialUnits(){
	//	console.log('handleNonserialUnits')
		conn.query(
			"SELECT * FROM units WHERE main_chain_index=? AND sequence!='good' ORDER BY unit", [mci], 
			function(rows){
				var arrFinalBadUnits = [];
				async.eachSeries(
					rows,
					function(row, cb){
						if (row.sequence === 'final-bad'){
							arrFinalBadUnits.push(row.unit);
							return row.content_hash ? cb() : setContentHash(row.unit, cb);
						}
						// temp-bad
						if (row.content_hash)
							throw Error("temp-bad and with content_hash?");
						findStableConflictingUnits(row, function(arrConflictingUnits){
							var sequence = (arrConflictingUnits.length > 0) ? 'final-bad' : 'good';
							console.log("unit "+row.unit+" has competitors "+arrConflictingUnits+", it becomes "+sequence);
							conn.query("UPDATE units SET sequence=? WHERE unit=?", [sequence, row.unit], function(){
								if (sequence === 'good')
									conn.query("UPDATE inputs SET is_unique=1 WHERE unit=?", [row.unit], function(){
										storage.assocStableUnits[row.unit].sequence = 'good';
										cb();
									});
								else{
									arrFinalBadUnits.push(row.unit);
									setContentHash(row.unit, cb);
								}
							});
						});
					},
					function(){
						//if (rows.length > 0)
						//    throw "stop";
						// next op
						arrFinalBadUnits.forEach(function(unit){
							storage.assocStableUnits[unit].sequence = 'final-bad';
						});
						propagateFinalBad(arrFinalBadUnits, addBalls);
					}
				);
			}
		);
	}

	function setContentHash(unit, onSet){
		storage.readJoint(conn, unit, {
			ifNotFound: function(){
				throw Error("bad unit not found: "+unit);
			},
			ifFound: function(objJoint){
				var content_hash = objectHash.getUnitContentHash(objJoint.unit);
				// not setting it in kv store yet, it'll be done later by updateMinRetrievableMciAfterStabilizingMci
				conn.query("UPDATE units SET content_hash=? WHERE unit=?", [content_hash, unit], function(){
					onSet();
				});
			}
		});
	}
	
	// all future units that spent these unconfirmed units become final-bad too
	function propagateFinalBad(arrFinalBadUnits, onPropagated){
		if (arrFinalBadUnits.length === 0)
			return onPropagated();
		conn.query("SELECT DISTINCT inputs.unit, main_chain_index FROM inputs LEFT JOIN units USING(unit) WHERE src_unit IN(?)", [arrFinalBadUnits], function(rows){
			console.log("will propagate final-bad to", rows);
			if (rows.length === 0)
				return onPropagated();
			var arrSpendingUnits = rows.map(function(row){ return row.unit; });
			conn.query("UPDATE units SET sequence='final-bad' WHERE unit IN(?)", [arrSpendingUnits], function(){
				var arrNewBadUnitsOnSameMci = [];
				rows.forEach(function (row) {
					var unit = row.unit;
					if (row.main_chain_index === mci) { // on the same MCI that we've just stabilized
						if (storage.assocStableUnits[unit].sequence !== 'final-bad') {
							storage.assocStableUnits[unit].sequence = 'final-bad';
							arrNewBadUnitsOnSameMci.push(unit);
						}
					}
					else // on a future MCI
						storage.assocUnstableUnits[unit].sequence = 'final-bad';
				});
				console.log("new final-bads on the same mci", arrNewBadUnitsOnSameMci);
				async.eachSeries(
					arrNewBadUnitsOnSameMci,
					setContentHash,
					function () {
						propagateFinalBad(arrSpendingUnits, onPropagated);
					}
				);
			});
		});
	}

	function findStableConflictingUnits(objUnitProps, handleConflictingUnits){
		// find potential competitors.
		// units come here sorted by original unit, so the smallest original on the same MCI comes first and will become good, all others will become final-bad
		/*
		Same query optimized for frequent addresses:
		SELECT competitor_units.*
		FROM unit_authors AS this_unit_authors 
		CROSS JOIN units AS this_unit USING(unit)
		CROSS JOIN units AS competitor_units 
			ON competitor_units.is_stable=1 
			AND +competitor_units.sequence='good' 
			AND (competitor_units.main_chain_index > this_unit.latest_included_mc_index)
			AND (competitor_units.main_chain_index <= this_unit.main_chain_index)
		CROSS JOIN unit_authors AS competitor_unit_authors 
			ON this_unit_authors.address=competitor_unit_authors.address 
			AND competitor_units.unit = competitor_unit_authors.unit 
		WHERE this_unit_authors.unit=?
		*/
		conn.query(
			"SELECT competitor_units.* \n\
			FROM unit_authors AS this_unit_authors \n\
			JOIN unit_authors AS competitor_unit_authors USING(address) \n\
			JOIN units AS competitor_units ON competitor_unit_authors.unit=competitor_units.unit \n\
			JOIN units AS this_unit ON this_unit_authors.unit=this_unit.unit \n\
			WHERE this_unit_authors.unit=? AND competitor_units.is_stable=1 AND +competitor_units.sequence='good' \n\
				-- if it were main_chain_index <= this_unit_limci, the competitor would've been included \n\
				AND (competitor_units.main_chain_index > this_unit.latest_included_mc_index) \n\
				AND (competitor_units.main_chain_index <= this_unit.main_chain_index)",
			// if on the same mci, the smallest unit wins becuse it got selected earlier and was assigned sequence=good
			[objUnitProps.unit],
			function(rows){
				var arrConflictingUnits = [];
				async.eachSeries(
					rows,
					function(row, cb){
						graph.compareUnitsByProps(conn, row, objUnitProps, function(result){
							if (result === null)
								arrConflictingUnits.push(row.unit);
							cb();
						});
					},
					function(){
						handleConflictingUnits(arrConflictingUnits);
					}
				);
			}
		);
	}
	

	function addBalls(){
		conn.query(
			"SELECT units.*, ball FROM units LEFT JOIN balls USING(unit) \n\
			WHERE main_chain_index=? ORDER BY level, unit", [mci], 
			function(unit_rows){
				if (unit_rows.length === 0)
					throw Error("no units on mci "+mci);
				let voteCountSubjects = [];
				async.eachSeries(
					unit_rows,
					function(objUnitProps, cb){
						var unit = objUnitProps.unit;
						conn.query(
							"SELECT ball FROM parenthoods LEFT JOIN balls ON parent_unit=unit WHERE child_unit=? ORDER BY ball", 
							[unit], 
							function(parent_ball_rows){
								if (parent_ball_rows.some(function(parent_ball_row){ return (parent_ball_row.ball === null); }))
									throw Error("some parent balls not found for unit "+unit);
								var arrParentBalls = parent_ball_rows.map(function(parent_ball_row){ return parent_ball_row.ball; });
								var arrSimilarMcis = getSimilarMcis(mci);
								var arrSkiplistUnits = [];
								var arrSkiplistBalls = [];
								if (objUnitProps.is_on_main_chain === 1 && arrSimilarMcis.length > 0){
									conn.query(
										"SELECT units.unit, ball FROM units LEFT JOIN balls USING(unit) \n\
										WHERE is_on_main_chain=1 AND main_chain_index IN(?)", 
										[arrSimilarMcis],
										function(rows){
											rows.forEach(function(row){
												var skiplist_unit = row.unit;
												var skiplist_ball = row.ball;
												if (!skiplist_ball)
													throw Error("no skiplist ball");
												arrSkiplistUnits.push(skiplist_unit);
												arrSkiplistBalls.push(skiplist_ball);
											});
											addBall();
										}
									);
								}
								else
									addBall();
								
								function addBall(){
									var ball = objectHash.getBallHash(unit, arrParentBalls, arrSkiplistBalls.sort(), objUnitProps.sequence === 'final-bad');
									console.log("ball="+ball);
									if (objUnitProps.ball){ // already inserted
										if (objUnitProps.ball !== ball)
											throw Error("stored and calculated ball hashes do not match, ball="+ball+", objUnitProps="+JSON.stringify(objUnitProps));
										return saveUnstablePayloads();
									}
									conn.query("INSERT INTO balls (ball, unit) VALUES(?,?)", [ball, unit], function(){
										conn.query("DELETE FROM hash_tree_balls WHERE ball=?", [ball], function(){
											delete storage.assocHashTreeUnitsByBall[ball];
											var key = 'j\n'+unit;
											kvstore.get(key, function(old_joint){
												if (!old_joint)
													throw Error("unit not found in kv store: "+unit);
												var objJoint = JSON.parse(old_joint);
												if (objJoint.ball)
													throw Error("ball already set in kv store of unit "+unit);
												objJoint.ball = ball;
												if (arrSkiplistUnits.length > 0)
													objJoint.skiplist_units = arrSkiplistUnits;
												batch.put(key, JSON.stringify(objJoint));
												if (arrSkiplistUnits.length === 0)
													return saveUnstablePayloads();
												conn.query(
													"INSERT INTO skiplist_units (unit, skiplist_unit) VALUES "
													+arrSkiplistUnits.map(function(skiplist_unit){
														return "("+conn.escape(unit)+", "+conn.escape(skiplist_unit)+")"; 
													}), 
													function(){ saveUnstablePayloads(); }
												);
											});
										});
									});
								}

								async function saveUnstablePayloads() {
									let arrUnstableMessages = storage.assocUnstableMessages[unit];
									if (!arrUnstableMessages)
										return cb();
									if (objUnitProps.sequence === 'final-bad'){
										delete storage.assocUnstableMessages[unit];
										return cb();
									}
									for (let message of arrUnstableMessages) {
										const { app, payload } = message;
										switch (app) {
											case 'data_feed':
												addDataFeeds(payload);
												break;
											case 'definition':
												await storage.insertAADefinitions(conn, [payload], unit, mci, false);
												break;
											case 'system_vote':
												await saveSystemVote(payload);
												break;
											case 'system_vote_count': // will be processed later, when we finish this mci
												if (!voteCountSubjects.includes(payload))
													voteCountSubjects.push(payload);
												break;
											default:
												throw Error("unrecognized app in unstable message: " + app);
										}
									}
									delete storage.assocUnstableMessages[unit];
									cb();
								}
								
								function addDataFeeds(payload){
									if (!storage.assocStableUnits[unit])
										throw Error("no stable unit "+unit);
									var arrAuthorAddresses = storage.assocStableUnits[unit].author_addresses;
									if (!arrAuthorAddresses)
										throw Error("no author addresses in "+unit);
									var strMci = string_utils.encodeMci(mci);
									for (var feed_name in payload){
										var value = payload[feed_name];
										var strValue = null;
										var numValue = null;
										if (typeof value === 'string'){
											strValue = value;
											var bLimitedPrecision = (mci < constants.aa2UpgradeMci);
											var float = string_utils.toNumber(value, bLimitedPrecision);
											if (float !== null)
												numValue = string_utils.encodeDoubleInLexicograpicOrder(float);
										}
										else
											numValue = string_utils.encodeDoubleInLexicograpicOrder(value);
										arrAuthorAddresses.forEach(function(address){
											// duplicates will be overwritten, that's ok for data feed search
											if (strValue !== null)
												batch.put('df\n'+address+'\n'+feed_name+'\ns\n'+strValue+'\n'+strMci, unit);
											if (numValue !== null)
												batch.put('df\n'+address+'\n'+feed_name+'\nn\n'+numValue+'\n'+strMci, unit);
											// if several values posted on the same mci, the latest one wins
											batch.put('dfv\n'+address+'\n'+feed_name+'\n'+strMci, value+'\n'+unit);
										});
									}
								}

								async function saveSystemVote(payload) {
									console.log('saveSystemVote', payload);
									const { subject, value } = payload;
									const objStableUnit = storage.assocStableUnits[unit];
									if (!objStableUnit)
										throw Error("no stable unit " + unit);
									const { author_addresses, timestamp } = objStableUnit;
									const strValue = subject === "op_list" ? JSON.stringify(value) : value;
									for (let address of author_addresses)
										await conn.query("INSERT INTO system_votes (unit, address, subject, value, timestamp) VALUES (?,?,?,?,?)", [unit, address, subject, strValue, timestamp]);
									let sqlValues = [];
									switch (subject) {
										case "op_list":
											const arrOPs = value;
											await conn.query("DELETE FROM op_votes WHERE address IN (?)", [author_addresses]);
											for (let address of author_addresses)
												sqlValues = sqlValues.concat(arrOPs.map(op_address => `(${db.escape(unit)}, ${db.escape(address)}, ${db.escape(op_address)}, ${timestamp})`));
											await conn.query("INSERT INTO op_votes (unit, address, op_address, timestamp) VALUES " + sqlValues.join(', '));
											break;
										case "threshold_size":
										case "base_tps_fee":
										case "tps_interval":
										case "tps_fee_multiplier":
											await conn.query("DELETE FROM numerical_votes WHERE subject=? AND address IN (?)", [subject, author_addresses]);
											for (let address of author_addresses)
												sqlValues.push(`(${db.escape(unit)}, ${db.escape(address)}, ${db.escape(subject)}, ${value}, ${timestamp})`);
											await conn.query("INSERT INTO numerical_votes (unit, address, subject, value, timestamp) VALUES " + sqlValues.join(', '));
											break;
										default:
											throw Error("unknown subject after stability: " + subject);
									}
									eventBus.emit('system_var_vote', subject, value, author_addresses, unit, 1);
								}


							}
						);
					},
					async function() {
						// vote count must be processed last, after all system_votes, and once for the entire mci
						for (let subject of voteCountSubjects)
							await countVotes(conn, mci, subject);
						// next op
						updateRetrievable();
					}
				);
			}
		);
	}

	function updateRetrievable(){
		storage.updateMinRetrievableMciAfterStabilizingMci(conn, batch, mci, function(min_retrievable_mci){
			profiler.stop('mc-mark-stable');
			calcCommissions();
		});
	}
	
	function calcCommissions(){
		if (mci === 0)
			return handleAATriggers();
		async.series([
			function(cb){
				profiler.start();
				headers_commission.calcHeadersCommissions(conn, cb);
			},
			function(cb){
				profiler.stop('mc-headers-commissions');
				paid_witnessing.updatePaidWitnesses(conn, cb);
			}
		], handleAATriggers);
	}

	function handleAATriggers() {
		// a single unit can send to several AA addresses
		// a single unit can have multiple outputs to the same AA address, even in the same asset
		conn.query(
			"SELECT DISTINCT address, definition, units.unit, units.level \n\
			FROM units \n\
			CROSS JOIN outputs USING(unit) \n\
			CROSS JOIN aa_addresses USING(address) \n\
			LEFT JOIN assets ON asset=assets.unit \n\
			CROSS JOIN units AS aa_definition_units ON aa_addresses.unit=aa_definition_units.unit \n\
			WHERE units.main_chain_index = ? AND units.sequence = 'good' AND (outputs.asset IS NULL OR is_private=0) \n\
				AND NOT EXISTS (SELECT 1 FROM unit_authors CROSS JOIN aa_addresses USING(address) WHERE unit_authors.unit=units.unit) \n\
				AND aa_definition_units.main_chain_index<=? \n\
			ORDER BY units.level, units.unit, address", // deterministic order
			[mci, mci],
			function (rows) {
				count_aa_triggers = rows.length;
				if (rows.length === 0)
					return finishMarkMcIndexStable();
				var arrValues = rows.map(function (row) {
					return "("+mci+", "+conn.escape(row.unit)+", "+conn.escape(row.address)+")";
				});
				conn.query("INSERT INTO aa_triggers (mci, unit, address) VALUES " + arrValues.join(', '), function () {
					finishMarkMcIndexStable();
					// now calling handleAATriggers() from write.js
				//	process.nextTick(function(){ // don't call it synchronously with event emitter
				//		eventBus.emit("new_aa_triggers"); // they'll be handled after the current write finishes
				//	});
				});
			}
		);
	}


	function finishMarkMcIndexStable() {
			process.nextTick(function(){ // don't call it synchronously with event emitter
				eventBus.emit("mci_became_stable", mci);
			});
			onDone(count_aa_triggers);
	}

}



async function countVotes(conn, mci, subject, is_emergency = 0, emergency_count_command_timestamp = 0) {
	console.log('countVotes', mci, subject, is_emergency, emergency_count_command_timestamp);
	if (is_emergency && subject !== "op_list")
		throw Error("emergency vote count supported for op_list only, got " + subject);
	const address_rows = await conn.query("SELECT DISTINCT address FROM system_votes WHERE subject=?", [subject]);
	const addresses = address_rows.map(r => r.address);
	const strAddresses = addresses.map(db.escape).join(', ');
	let balances = {};
	const bal_rows = await conn.query(`SELECT address, SUM(amount) AS balance 
		FROM outputs
		LEFT JOIN units USING(unit)
		WHERE address IN(${strAddresses}) AND is_spent=0 AND asset IS NULL AND is_stable=1 AND sequence='good' 
		GROUP BY address`);
	console.log('bal rows', bal_rows)
	for (let { address, balance } of bal_rows) {
		balances[address] = balance;
	}
	const spent_rows = await conn.query(`SELECT inputs.address, SUM(outputs.amount) AS spent_balance
		FROM units
		CROSS JOIN inputs USING(unit)
		CROSS JOIN outputs ON src_unit=outputs.unit AND src_message_index=outputs.message_index AND src_output_index=outputs.output_index
		CROSS JOIN units AS output_units ON outputs.unit=output_units.unit
		WHERE units.is_stable=0 AND +units.sequence='good'
			AND +output_units.is_stable=1 AND +output_units.sequence='good'
			AND inputs.address IN(${strAddresses}) AND type='transfer' AND inputs.asset IS NULL
		GROUP BY inputs.address`);
	console.log('spent rows', spent_rows)
	for (let { address, spent_balance } of spent_rows) {
		if (balances[address])
			balances[address] += spent_balance;
		else
			balances[address] = spent_balance;
	}
	let values = [];
	for (let address in balances)
		values.push(`(${db.escape(address)}, ${balances[address]})`);
	if (values.length === 0)
		return console.log(`no voters for ${subject}, skipping vote count`);

	const [mc_row] = await conn.query("SELECT timestamp FROM units WHERE main_chain_index=? AND is_on_main_chain=1", [mci]);
	if (!mc_row)
		throw Error(`no MC unit on just stabilized MCI ` + mci);
	const mc_timestamp = mc_row.timestamp;
	
	const [activation_row] = await conn.query("SELECT timestamp FROM units WHERE main_chain_index=? AND is_on_main_chain=1", [constants.v4UpgradeMci]);
	if (!activation_row)
		throw Error(`no MC unit on OP vote activation MCI ` + constants.v4UpgradeMci);
	const activation_timestamp = activation_row.timestamp;

	await conn.query(`CREATE TEMPORARY TABLE voter_balances (
		address CHAR(32) NOT NULL PRIMARY KEY,
		balance INT NOT NULL
	)`);
	await conn.query(`INSERT INTO voter_balances (address, balance) VALUES ` + values.join(', '));

	// Vote timeframe. If too small share has voted in the previous year, expand the period to 2 years. If still small, expand to 3 years, and so on.
	let since_timestamp = mc_timestamp;
	while (true) {
		since_timestamp -= 365 * 24 * 3600;
		if (since_timestamp <= activation_timestamp)
			break;
		const [{ total_balance }] = await conn.query(`SELECT SUM(balance) AS total_balance 
			FROM voter_balances
			WHERE address IN (
				SELECT DISTINCT address FROM system_votes WHERE subject=? AND timestamp>=?
			)`,
			[subject, since_timestamp]);
		if (total_balance >= constants.SYSTEM_VOTE_MIN_SHARE * constants.TOTAL_WHITEBYTES)
			break;
	}

	let value;
	switch (subject) {
		case 'op_list':
			const votes_table = is_emergency ? 'op_votes_tmp' : 'op_votes';
			if (is_emergency) { // add unstable votes for OPs
				await conn.query(`CREATE TEMPORARY TABLE ${votes_table} AS SELECT address, op_address, timestamp FROM op_votes`);
				// the order of iteration is undefined, so we'll first collect the messages and then sort them. The order matters only when the same address sends multiple unstable votes
				let votes = [];
				for (let unit in storage.assocUnstableMessages) {
					for (let m of storage.assocUnstableMessages[unit]) {
						if (m.app === 'system_vote' && m.payload.subject === 'op_list') {
							const { timestamp, author_addresses, sequence, level } = storage.assocUnstableUnits[unit];
							if (sequence !== 'good')
								continue;
							if (emergency_count_command_timestamp - timestamp < constants.EMERGENCY_COUNT_MIN_VOTE_AGE) {
								console.log('unstable vote from', author_addresses, 'is too young');
								continue;
							}
							const arrOPs = m.payload.value;
							votes.push({ timestamp, level, author_addresses, arrOPs });
						}
					}
				}
				console.log('unsorted unstable votes', votes);
				votes.sort((v1, v2) => {
					const dt = v1.timestamp - v2.timestamp;
					if (dt !== 0)
						return dt;
					return v1.level - v2.level;
				});
				console.log('sorted unstable votes', votes);
				for (let { timestamp, author_addresses, arrOPs } of votes) {
					// apply each vote separately as a new unstable vote from the same user would override the previous one
					await conn.query(`DELETE FROM ${votes_table} WHERE address IN (?)`, [author_addresses]);
					let values = [];
					for (let address of author_addresses)
						for (let op_address of arrOPs)
							values.push(`(${db.escape(address)}, ${db.escape(op_address)}, ${timestamp})`);
					console.log('unstable votes', values);
					await conn.query(`INSERT INTO ${votes_table} (address, op_address, timestamp) VALUES ` + values.join(', '));
				}
			}
			const op_rows = await conn.query(`SELECT op_address, SUM(balance) AS total_balance
				FROM ${votes_table}
				CROSS JOIN voter_balances USING(address)
				WHERE timestamp>=?
				GROUP BY op_address
				ORDER BY total_balance DESC, op_address
				LIMIT ?`,
				[since_timestamp, constants.COUNT_WITNESSES]
			);
			console.log(`total votes for OPs`, op_rows);
			let ops = op_rows.map(r => r.op_address);
			if (ops.length !== constants.COUNT_WITNESSES)
				throw Error(`wrong number of voted OPs: ` + ops.length);
			ops.sort();
			if (constants.bTestnet && [3547796, 3548896, 3548898].includes(mci)) // workaround a bug
				ops = ["2FF7PSL7FYXVU5UIQHCVDTTPUOOG75GX", "2GPBEZTAXKWEXMWCTGZALIZDNWS5B3V7", "4H2AMKF6YO2IWJ5MYWJS3N7Y2YU2T4Z5", "DFVODTYGTS3ILVOQ5MFKJIERH6LGKELP", "ERMF7V2RLCPABMX5AMNGUQBAH4CD5TK4", "F4KHJUCLJKY4JV7M5F754LAJX4EB7M4N", "IOF6PTBDTLSTBS5NWHUSD7I2NHK3BQ2T", "O4K4QILG6VPGTYLRAI2RGYRFJZ7N2Q2O", "OPNUXBRSSQQGHKQNEPD2GLWQYEUY5XLD", "PA4QK46276MJJD5DBOLIBMYKNNXMUVDP", "RJDYXC4YQ4AZKFYTJVCR5GQJF5J6KPRI", "WMFLGI2GLAB2MDF2KQAH37VNRRMK7A5N"];
			if (mci === 0) {
				storage.resetWitnessCache();
				storage.systemVars.op_list = []; // reset
			}
			storage.systemVars.op_list.unshift({ vote_count_mci: mci === 0 ? -1 : mci, value: ops, is_emergency });
			value = JSON.stringify(ops);
			if (is_emergency) {
				storage.resetWitnessCache();
				await conn.query(conn.dropTemporaryTable(votes_table));
			}
			break;
		
		case "threshold_size":
		case "base_tps_fee":
		case "tps_interval":
		case "tps_fee_multiplier":
			const rows = await conn.query(`SELECT value, SUM(balance) AS total_balance
				FROM numerical_votes
				CROSS JOIN voter_balances USING(address)
				WHERE timestamp>=? AND subject=?
				GROUP BY value
				ORDER BY value`,
				[since_timestamp, subject]
			);
			console.log(`total votes for`, subject, rows);
			const total_voted_balance = rows.reduce((acc, row) => acc + row.total_balance, 0);
			let accumulated = 0;
			for (let { value: v, total_balance } of rows) {
				accumulated += total_balance;
				if (accumulated >= total_voted_balance / 2) {
					value = v;
					break;
				}
			}
			if (value === undefined)
				throw Error(`no median value for ` + subject);
			storage.systemVars[subject].unshift({ vote_count_mci: mci, value, is_emergency });
			break;
		
		default:
			throw Error("unknown subject in countVotes: " + subject);
	}
	console.log(`new`, subject, value);
	// a repeated emergency vote on the same mci would overwrite the previous one
	await conn.query(`${is_emergency || mci === 0 ? 'REPLACE' : 'INSERT'} INTO system_vars (subject, value, vote_count_mci, is_emergency) VALUES (?, ?, ?, ?)`, [subject, value, mci === 0 ? -1 : mci, is_emergency]);
	await conn.query(conn.dropTemporaryTable('voter_balances'));
	eventBus.emit('system_vars_updated', subject, value);
}


async function applyEmergencyOpListChange(conn, emergency_count_command_timestamp, cb) {
	// last stable unit
	const [{ timestamp, main_chain_index }] = await conn.query("SELECT timestamp, main_chain_index FROM units WHERE is_stable=1 ORDER BY main_chain_index DESC LIMIT 1");
	if (emergency_count_command_timestamp < timestamp + constants.EMERGENCY_OP_LIST_CHANGE_TIMEOUT) {
		console.log(`too early to apply emergency OP list change yet`);
		return cb();
	}
	console.log(`applying emergency vote count after being stuck at mci ${main_chain_index}`);
	await countVotes(conn, main_chain_index - 1, 'op_list', 1, emergency_count_command_timestamp);
	cb();
}


// returns list of past MC indices for skiplist
function getSimilarMcis(mci){
	if (mci === 0)
		return [];
	var arrSimilarMcis = [];
	var divisor = 10;
	while (true){
		if (mci % divisor === 0){
			arrSimilarMcis.push(mci - divisor);
			divisor *= 10;
		}
		else
			return arrSimilarMcis;
	}
}

function throwError(msg){
	debugger;
	if (typeof window === 'undefined')
		throw Error(msg);
	else
		eventBus.emit('nonfatal_error', msg, new Error());
}


exports.updateMainChain = updateMainChain;
exports.determineIfStableInLaterUnitsAndUpdateStableMcFlag = determineIfStableInLaterUnitsAndUpdateStableMcFlag;
exports.determineIfStableInLaterUnits = determineIfStableInLaterUnits;
exports.determineIfStableInLaterUnitsWithMaxLastBallMciFastPath = determineIfStableInLaterUnitsWithMaxLastBallMciFastPath;
exports.applyEmergencyOpListChange = applyEmergencyOpListChange;

/*
determineIfStableInLaterUnits(db, "oeS2p87yO9DFkpjj+z+mo+RNoieaTN/8vOPGn/cUHhM=", [ '8vh0/buS3NaknEjBF/+vyLS3X5T0t5imA2mg8juVmJQ=', 'oO/INGsFr8By+ggALCdVkiT8GIPzB2k3PQ3TxPWq8Ac='], function(bStable){
	console.log(bStable);
});
*/
