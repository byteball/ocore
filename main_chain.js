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



function updateMainChain(conn, last_unit, onDone){
	
	
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
				LIMIT 1",
				function(rows){
					if (rows.length === 0)
						throw Error("no free units?");
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
				if (!objBestParentUnitProps.is_on_main_chain)
					conn.query("UPDATE units SET is_on_main_chain=1, main_chain_index=NULL WHERE unit=?", [best_parent_unit], function(){
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
		console.log("checkNotRebuildingStableMainChainAndGoDown "+last_unit);
		profiler.start();
		conn.query(
			"SELECT unit FROM units WHERE is_on_main_chain=1 AND main_chain_index>? AND is_stable=1 LIMIT 1", 
			[last_main_chain_index],
			function(rows){
				profiler.stop('mc-checkNotRebuilding');
				if (rows.length > 0)
					throw Error("removing stable witnessed unit "+rows[0].unit+" from main chain");
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
				var main_chain_index = last_main_chain_index;
				var main_chain_unit = last_main_chain_unit;
				conn.query(
					"SELECT unit FROM units WHERE is_on_main_chain=1 AND main_chain_index IS NULL ORDER BY level",
					function(rows){
						if (rows.length === 0){
							//if (last_main_chain_index > 0)
								throw Error("no unindexed MC units?");
							//else{
							//    console.log("last MC=0, no unindexed MC units");
							//    return updateLatestIncludedMcIndex(last_main_chain_index, true);
							//}
						}
						async.eachSeries(
							rows, 
							function(row, cb){
								main_chain_index++;
								var arrUnits = [row.unit];
								
								function goUp(arrStartUnits){
									conn.query(
										"SELECT unit \n\
										FROM parenthoods JOIN units ON parent_unit=unit \n\
										WHERE child_unit IN(?) AND main_chain_index IS NULL",
										[arrStartUnits],
										function(rows){
											if (rows.length === 0)
												return updateMc();
											var arrNewStartUnits = rows.map(function(row){ return row.unit; });
											arrUnits = arrUnits.concat(arrNewStartUnits);
											goUp(arrNewStartUnits);
										}
									);
								}
	
								function updateMc(){
									conn.query("UPDATE units SET main_chain_index=? WHERE unit IN(?)", [main_chain_index, arrUnits], function(){
										cb();
									});
								}
								
								goUp(arrUnits);
								
							}, 
							function(err){
								console.log("goDownAndUpdateMainChainIndex done");
								if (err)
									throw Error("goDownAndUpdateMainChainIndex eachSeries failed");
								profiler.stop('mc-goDown');
								updateLatestIncludedMcIndex(last_main_chain_index, true);
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
		
		console.log("updateLatestIncludedMcIndex "+last_main_chain_index);
		profiler.start();
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
						throw Error("no latest_included_mc_index updated");
					async.eachSeries(
						rows,
						function(row, cb){
							console.log(row.main_chain_index, row.unit);
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
	}

	function readLastStableMcUnit(handleLastStableMcUnit){
		conn.query("SELECT unit FROM units WHERE is_on_main_chain=1 AND is_stable=1 ORDER BY main_chain_index DESC LIMIT 1", function(rows){
			if (rows.length === 0)
				throw Error("no units on stable MC?");
			handleLastStableMcUnit(rows[0].unit);
		});
	}

	
	function updateStableMcFlag(){
		console.log("updateStableMcFlag");
		profiler.start();
		readLastStableMcUnit(function(last_stable_mc_unit){
			console.log("last stable mc unit "+last_stable_mc_unit);
			storage.readWitnesses(conn, last_stable_mc_unit, function(arrWitnesses){
				conn.query("SELECT unit, is_on_main_chain, main_chain_index, level FROM units WHERE best_parent_unit=?", [last_stable_mc_unit], function(rows){
					if (rows.length === 0){
						//if (isGenesisUnit(last_stable_mc_unit))
						//    return finish();
						throw Error("no best children of last stable MC unit "+last_stable_mc_unit+"?");
					}
					var arrMcRows  = rows.filter(function(row){ return (row.is_on_main_chain === 1); }); // only one element
					var arrAltRows = rows.filter(function(row){ return (row.is_on_main_chain === 0); });
					if (arrMcRows.length !== 1)
						throw Error("not a single MC child?");
					var first_unstable_mc_unit = arrMcRows[0].unit;
					var first_unstable_mc_index = arrMcRows[0].main_chain_index;
					var first_unstable_mc_level = arrMcRows[0].level;
					var arrAltBranchRootUnits = arrAltRows.map(function(row){ return row.unit; });
					
					function advanceLastStableMcUnitAndTryNext(){
						profiler.stop('mc-stableFlag');
						markMcIndexStable(conn, first_unstable_mc_index, updateStableMcFlag);
					}
				
					conn.query("SELECT witnessed_level FROM units WHERE is_free=1 AND is_on_main_chain=1", function(wl_rows){
						if (wl_rows.length !== 1)
							throw Error("not a single mc wl");
						// this is the level when we colect 7 witnesses if walking up the MC from its end
						var mc_end_witnessed_level = wl_rows[0].witnessed_level;
						conn.query(
							// among these 7 witnesses, find min wl
							"SELECT MIN(witnessed_level) AS min_mc_wl FROM units LEFT JOIN unit_authors USING(unit) \n\
							WHERE is_on_main_chain=1 AND level>=? AND address IN(?)", // _left_ join enforces the best query plan in sqlite
							[mc_end_witnessed_level, arrWitnesses],
							function(min_wl_rows){
								if (min_wl_rows.length !== 1)
									throw Error("not a single min mc wl");
								var min_mc_wl = min_wl_rows[0].min_mc_wl;
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
									// Compose a set S of units that increase WL, that is their own WL is greater than that of every parent. 
									// In this set, find max L. Alt WL will never reach it. If min_mc_wl > L, next MC unit is stable.
									// Also filter the set S to include only those units that are conformant with the last stable MC unit.
									conn.query(
										"SELECT MAX(units.level) AS max_alt_level \n\
										FROM units \n\
										LEFT JOIN parenthoods ON units.unit=child_unit \n\
										LEFT JOIN units AS punits ON parent_unit=punits.unit AND punits.witnessed_level >= units.witnessed_level \n\
										WHERE units.unit IN(?) AND punits.unit IS NULL AND ( \n\
											SELECT COUNT(*) \n\
											FROM unit_witnesses \n\
											WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND unit_witnesses.address IN(?) \n\
										)>=?",
										[arrAltBestChildren, arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS],
										function(max_alt_rows){
											if (max_alt_rows.length !== 1)
												throw "not a single max alt level";
											var max_alt_level = max_alt_rows[0].max_alt_level;
											(min_mc_wl > max_alt_level) ? advanceLastStableMcUnitAndTryNext() : finish();
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


	
	function finish(){
		profiler.stop('mc-stableFlag');
		console.log("done updating MC\n");
		if (onDone)
			onDone();
	}
	
	
	console.log("\nwill update MC");
	//finish();
	goUpFromUnit(last_unit);
	
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

function determineIfStableInLaterUnits(conn, earlier_unit, arrLaterUnits, handleResult){
	if (storage.isGenesisUnit(earlier_unit))
		return handleResult(true);
	storage.readPropsOfUnits(conn, earlier_unit, arrLaterUnits, function(objEarlierUnitProps, arrLaterUnitProps){
		if (objEarlierUnitProps.is_free === 1)
			return handleResult(false);
		var max_later_limci = Math.max.apply(
			null, arrLaterUnitProps.map(function(objLaterUnitProps){ return objLaterUnitProps.latest_included_mc_index; }));
		readBestParentAndItsWitnesses(conn, earlier_unit, function(best_parent_unit, arrWitnesses){
			conn.query("SELECT unit, is_on_main_chain, main_chain_index, level FROM units WHERE best_parent_unit=?", [best_parent_unit], function(rows){
				if (rows.length === 0)
					throw "no best children of "+best_parent_unit+"?";
				var arrMcRows  = rows.filter(function(row){ return (row.is_on_main_chain === 1); }); // only one element
				var arrAltRows = rows.filter(function(row){ return (row.is_on_main_chain === 0); });
				if (arrMcRows.length !== 1)
					throw "not a single MC child?";
				var first_unstable_mc_unit = arrMcRows[0].unit;
				if (first_unstable_mc_unit !== earlier_unit)
					throw "first unstable MC unit is not our input unit";
				var first_unstable_mc_index = arrMcRows[0].main_chain_index;
				var first_unstable_mc_level = arrMcRows[0].level;
				var arrAltBranchRootUnits = arrAltRows.map(function(row){ return row.unit; });
				//console.log("first_unstable_mc_index", first_unstable_mc_index);
				//console.log("first_unstable_mc_level", first_unstable_mc_level);
				//console.log("alt", arrAltBranchRootUnits);
				
				function findMinMcWitnessedLevel(handleMinMcWl){
					var min_mc_wl = Number.MAX_VALUE;
					var count = 0;

					function goUp(start_unit){
						conn.query(
							"SELECT best_parent_unit, witnessed_level, \n\
								(SELECT COUNT(*) FROM unit_authors WHERE unit_authors.unit=units.unit AND address IN(?)) AS count \n\
							FROM units WHERE unit=?", [arrWitnesses, start_unit],
							function(rows){
								if (rows.length !== 1)
									throw "findMinMcWitnessedLevel: not 1 row";
								var row = rows[0];
								if (row.count > 0 && row.witnessed_level < min_mc_wl)
									min_mc_wl = row.witnessed_level;
								count += row.count;
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

					function goDownAndCollectBestChildren(arrStartUnits, cb){
						conn.query("SELECT unit, is_free, main_chain_index FROM units WHERE best_parent_unit IN(?)", [arrStartUnits], function(rows){
							if (rows.length === 0)
								return cb();
							async.eachSeries(
								rows, 
								function(row, cb2){
									
									function addUnit(){
										arrBestChildren.push(row.unit);
										if (row.is_free === 1)
											cb2();
										else
											goDownAndCollectBestChildren([row.unit], cb2);
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

					// leaves only those roots that are included by later units
					function filterAltBranchRootUnits(cb){
						var arrFilteredAltBranchRootUnits = [];
						conn.query("SELECT unit, is_free, main_chain_index FROM units WHERE unit IN(?)", [arrAltBranchRootUnits], function(rows){
							if (rows.length === 0)
								throw Error("no alt branch root units?");
							async.eachSeries(
								rows, 
								function(row, cb2){
									
									function addUnit(){
										arrBestChildren.push(row.unit);
										if (row.is_free === 0)
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
									goDownAndCollectBestChildren(arrFilteredAltBranchRootUnits, cb);
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
					determineIfHasAltBranches(function(bHasAltBranches){
						if (!bHasAltBranches){
							//console.log("no alt");
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
						createListOfBestChildrenIncludedByLaterUnits(arrAltBranchRootUnits, function(arrAltBestChildren){
							//throw arrAltBestChildren;
							// Compose a set S of units that increase WL, that is their own WL is greater than that of every parent. 
							// In this set, find max L. Alt WL will never reach it. If min_mc_wl > L, next MC unit is stable.
							// Also filter the set S to include only those units that are conformant with the last stable MC unit.
							conn.query(
								"SELECT MAX(units.level) AS max_alt_level \n\
								FROM units \n\
								LEFT JOIN parenthoods ON units.unit=child_unit \n\
								LEFT JOIN units AS punits ON parent_unit=punits.unit AND punits.witnessed_level >= units.witnessed_level \n\
								WHERE units.unit IN(?) AND punits.unit IS NULL AND ( \n\
									SELECT COUNT(*) \n\
									FROM unit_witnesses \n\
									WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND unit_witnesses.address IN(?) \n\
								)>=?",
								[arrAltBestChildren, arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS],
								function(max_alt_rows){
									if (max_alt_rows.length !== 1)
										throw "not a single max alt level";
									var max_alt_level = max_alt_rows[0].max_alt_level;
									handleResult(min_mc_wl > max_alt_level);
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
function determineIfStableInLaterUnitsAndUpdateStableMcFlag(conn, earlier_unit, arrLaterUnits, handleResult){
	determineIfStableInLaterUnits(conn, earlier_unit, arrLaterUnits, function(bStable){
		console.log("determineIfStableInLaterUnits", earlier_unit, arrLaterUnits, bStable);
		if (!bStable)
			return handleResult(bStable);
		breadcrumbs.add('stable in parents, will wait for write lock');
		mutex.lock(["write"], function(unlock){
			breadcrumbs.add('stable in parents, got write lock');
			storage.readLastStableMcIndex(conn, function(last_stable_mci){
				storage.readUnitProps(conn, earlier_unit, function(objEarlierUnitProps){
					var new_last_stable_mci = objEarlierUnitProps.main_chain_index;
					if (new_last_stable_mci <= last_stable_mci) // fix: it could've been changed by parallel tasks - No, our SQL transaction doesn't see the changes
						throw "new last stable mci expected to be higher than existing";
					var mci = last_stable_mci;
					advanceLastStableMcUnitAndStepForward();

					function advanceLastStableMcUnitAndStepForward(){
						mci++;
						if (mci <= new_last_stable_mci)
							markMcIndexStable(conn, mci, advanceLastStableMcUnitAndStepForward);
						else{
							unlock();
							handleResult(bStable);
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


function markMcIndexStable(conn, mci, onDone){
	profiler.start();
	conn.query(
		"UPDATE units SET is_stable=1 WHERE is_stable=0 AND main_chain_index=?", 
		[mci], 
		function(){
			// next op
			handleNonserialUnits();
		}
	);


	function handleNonserialUnits(){
		conn.query(
			"SELECT * FROM units WHERE main_chain_index=? AND sequence!='good' ORDER BY unit", [mci], 
			function(rows){
				async.eachSeries(
					rows,
					function(row, cb){
						if (row.sequence === 'final-bad')
							return row.content_hash ? cb() : setContentHash(row.unit, cb);
						// temp-bad
						if (row.content_hash)
							throw "temp-bad and with content_hash?";
						findStableConflictingUnits(row, function(arrConflictingUnits){
							var sequence = (arrConflictingUnits.length > 0) ? 'final-bad' : 'good';
							console.log("unit "+row.unit+" has competitors "+arrConflictingUnits+", it becomes "+sequence);
							conn.query("UPDATE units SET sequence=? WHERE unit=?", [sequence, row.unit], function(){
								if (sequence === 'good')
									conn.query("UPDATE inputs SET is_unique=1 WHERE unit=?", [row.unit], function(){ cb(); });
								else
									setContentHash(row.unit, cb);
							});
						});
					},
					function(){
						//if (rows.length > 0)
						//    throw "stop";
						// next op
						addBalls();
					}
				);
			}
		);
	}

	function setContentHash(unit, onSet){
		storage.readJoint(conn, unit, {
			ifNotFound: function(){
				throw "bad unit not found: "+unit;
			},
			ifFound: function(objJoint){
				var content_hash = objectHash.getUnitContentHash(objJoint.unit);
				conn.query("UPDATE units SET content_hash=? WHERE unit=?", [content_hash, unit], function(){
					onSet();
				});
			}
		});
	}

	function findStableConflictingUnits(objUnitProps, handleConflictingUnits){
		// find potential competitors.
		// units come here sorted by original unit, so the smallest original on the same MCI comes first and will become good, all others will become final-bad
		conn.query(
			"SELECT competitor_units.* \n\
			FROM unit_authors AS this_unit_authors \n\
			JOIN unit_authors AS competitor_unit_authors USING(address) \n\
			JOIN units AS competitor_units ON competitor_unit_authors.unit=competitor_units.unit \n\
			JOIN units AS this_unit ON this_unit_authors.unit=this_unit.unit \n\
			WHERE this_unit_authors.unit=? AND competitor_units.is_stable=1 AND competitor_units.sequence='good' \n\
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
			WHERE main_chain_index=? ORDER BY level", [mci], 
			function(unit_rows){
				async.eachSeries(
					unit_rows,
					function(objUnitProps, cb){
						var unit = objUnitProps.unit;
						conn.query(
							"SELECT ball FROM parenthoods LEFT JOIN balls ON parent_unit=unit WHERE child_unit=? ORDER BY ball", 
							[unit], 
							function(parent_ball_rows){
								if (parent_ball_rows.some(function(parent_ball_row){ return (parent_ball_row.ball === null); }))
									throw "some parent balls not found for unit "+unit;
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
													throw "no skiplist ball";
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
									if (objUnitProps.ball){ // already inserted
										if (objUnitProps.ball !== ball)
											throw "stored and calculated ball hashes do not match";
										return cb();
									}
									conn.query("INSERT INTO balls (ball, unit) VALUES(?,?)", [ball, unit], function(){
										conn.query("DELETE FROM hash_tree_balls WHERE ball=?", [ball], function(){
											if (arrSkiplistUnits.length === 0)
												return cb();
											conn.query(
												"INSERT INTO skiplist_units (unit, skiplist_unit) VALUES "
												+arrSkiplistUnits.map(function(skiplist_unit){
													return "("+conn.escape(unit)+", "+conn.escape(skiplist_unit)+")"; 
												}), 
												function(){ cb(); }
											);
										});
									});
								}
							}
						);
					},
					function(){
						// next op
						updateRetrievable();
					}
				);
			}
		);
	}

	function updateRetrievable(){
		storage.updateMinRetrievableMciAfterStabilizingMci(conn, mci, function(min_retrievable_mci){
			profiler.stop('mc-mark-stable');
			calcCommissions();
		});
	}
	
	function calcCommissions(){
		async.series([
			function(cb){
				profiler.start();
				headers_commission.calcHeadersCommissions(conn, cb);
			},
			function(cb){
				profiler.stop('mc-headers-commissions');
				paid_witnessing.updatePaidWitnesses(conn, cb);
			}
		], function(){
			process.nextTick(function(){ // don't call it synchronously with event emitter
				eventBus.emit("mci_became_stable", mci);
			});
			onDone();
		});
	}
	
}

// returns list of past MC indices for skiplist
function getSimilarMcis(mci){
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

exports.updateMainChain = updateMainChain;
exports.determineIfStableInLaterUnitsAndUpdateStableMcFlag = determineIfStableInLaterUnitsAndUpdateStableMcFlag;

/*
determineIfStableInLaterUnits(db, "oeS2p87yO9DFkpjj+z+mo+RNoieaTN/8vOPGn/cUHhM=", [ '8vh0/buS3NaknEjBF/+vyLS3X5T0t5imA2mg8juVmJQ=', 'oO/INGsFr8By+ggALCdVkiT8GIPzB2k3PQ3TxPWq8Ac='], function(bStable){
	console.log(bStable);
});
*/
