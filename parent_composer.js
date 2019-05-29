/*jslint node: true */
"use strict";
var _ = require('lodash');
var db = require('./db.js');
var constants = require("./constants.js");
var conf = require("./conf.js");
var storage = require("./storage.js");
var main_chain = require("./main_chain.js");


function pickParentUnits(conn, arrWitnesses, timestamp, onDone){
	// don't exclude units derived from unwitnessed potentially bad units! It is not their blame and can cause a split.
	
	// test creating bad units
	//var cond = bDeep ? "is_on_main_chain=1" : "is_free=0 AND main_chain_index=1420";
	//var order_and_limit = bDeep ? "ORDER BY main_chain_index DESC LIMIT 1" : "ORDER BY unit LIMIT 1";
	
	var bWithTimestamp = (storage.getMinRetrievableMci() >= constants.timestampUpgradeMci);
	var ts_cond = bWithTimestamp ? "AND timestamp<=" + timestamp : '';
	conn.query(
		"SELECT \n\
			unit, version, alt, ( \n\
				SELECT COUNT(*) \n\
				FROM unit_witnesses \n\
				WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
			) AS count_matching_witnesses \n\
		FROM units "+(conf.storage === 'sqlite' ? "INDEXED BY byFree" : "")+" \n\
		LEFT JOIN archived_joints USING(unit) \n\
		WHERE +sequence='good' AND is_free=1 AND archived_joints.unit IS NULL "+ts_cond+" ORDER BY unit", 
		// exclude potential parents that were archived and then received again
		[arrWitnesses], 
		function(rows){
			if (rows.some(function(row){ return (constants.supported_versions.indexOf(row.version) == -1 || row.alt !== constants.alt); }))
				throw Error('wrong network');
			var count_required_matches = constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS;
			// we need at least one compatible parent, otherwise go deep
			if (rows.filter(function(row){ return (row.count_matching_witnesses >= count_required_matches); }).length === 0)
				return pickDeepParentUnits(conn, arrWitnesses, null, onDone);
			var arrParentUnits = rows.map(function(row){ return row.unit; });
			adjustParentsToNotRetreatWitnessedLevel(conn, arrWitnesses, arrParentUnits, function(arrAdjustedParents, max_parent_wl){
				onDone(null, arrAdjustedParents, max_parent_wl);
			});
		//	checkWitnessedLevelNotRetreatingAndLookLower(conn, arrWitnesses, arrParentUnits, (arrParentUnits.length === 1), onDone);
		}
	);
}

function adjustParentsToNotRetreatWitnessedLevel(conn, arrWitnesses, arrParentUnits, handleAdjustedParents){
	var arrExcludedUnits = [];
	var iterations = 0;
	
	function replaceExcludedParent(arrCurrentParentUnits, excluded_unit){
		console.log('replaceExcludedParent '+arrCurrentParentUnits.join(', ')+" excluding "+excluded_unit);
		var arrNewExcludedUnits = [excluded_unit];
		console.log('excluded parents: '+arrNewExcludedUnits.join(', '));
		arrExcludedUnits = arrExcludedUnits.concat(arrNewExcludedUnits);
		var arrParentsToKeep = _.difference(arrCurrentParentUnits, arrNewExcludedUnits);
		conn.query("SELECT DISTINCT parent_unit FROM parenthoods WHERE child_unit IN(?)", [arrNewExcludedUnits], function(rows){
			var arrCandidateReplacements = rows.map(function(row){ return row.parent_unit; });
			console.log('candidate replacements: '+arrCandidateReplacements.join(', '));
			conn.query(
				"SELECT DISTINCT parent_unit FROM parenthoods CROSS JOIN units ON child_unit=unit \n\
				WHERE parent_unit IN(?) AND child_unit NOT IN("+arrExcludedUnits.map(db.escape).join(', ')+") AND (is_free=0 OR sequence='good')", 
				[arrCandidateReplacements], 
				function(rows){
					// other children can lead to some of the non-excluded parents
					var arrCandidatesWithOtherChildren = rows.map(function(row){ return row.parent_unit; });
					console.log('candidates with other children: '+arrCandidatesWithOtherChildren.join(', '));
					var arrReplacementParents = _.difference(arrCandidateReplacements, arrCandidatesWithOtherChildren);
					console.log('replacements for excluded parents: '+arrReplacementParents.join(', '));
					var arrNewParents = arrParentsToKeep.concat(arrReplacementParents);
					console.log('new parents: '+arrNewParents.join(', '));
					if (arrNewParents.length === 0)
						throw Error("no new parents for initial parents "+arrParentUnits.join(', ')+", current parents "+arrCurrentParentUnits.join(', ')+", excluded unit "+excluded_unit+", excluded units "+arrExcludedUnits.join(', ')+", and witnesses "+arrWitnesses.join(', '));
					checkWitnessedLevelAndReplace(arrNewParents);
				}
			);
		});
	}
	
	function checkWitnessedLevelAndReplace(arrCurrentParentUnits){
		console.log('checkWitnessedLevelAndReplace '+arrCurrentParentUnits.join(', '));
		if (iterations > 0 && arrExcludedUnits.length === 0)
			throw Error("infinite cycle");
		iterations++;
		determineWitnessedLevels(conn, arrWitnesses, arrCurrentParentUnits, function(child_witnessed_level, max_parent_wl, parent_with_max_wl, best_parent_unit){
			if (child_witnessed_level >= max_parent_wl){
				if (arrCurrentParentUnits.length <= constants.MAX_PARENTS_PER_UNIT)
					return handleAdjustedParents(arrCurrentParentUnits.sort(), max_parent_wl);
				var bp_index = arrCurrentParentUnits.indexOf(best_parent_unit);
				if (bp_index < 0)
					throw Error("best parent "+best_parent_unit+" not found among parents "+arrCurrentParentUnits.join(', '));
				arrCurrentParentUnits.splice(bp_index, 1);
				arrCurrentParentUnits.unshift(best_parent_unit); // moves best_parent_unit to the 1st position to make sure it is not sliced off
				return handleAdjustedParents(arrCurrentParentUnits.slice(0, constants.MAX_PARENTS_PER_UNIT).sort(), max_parent_wl);
			}
			console.log('wl would retreat from '+max_parent_wl+' to '+child_witnessed_level+', parents '+arrCurrentParentUnits.join(', '));
			replaceExcludedParent(arrCurrentParentUnits, parent_with_max_wl);
		});
	}
	
	checkWitnessedLevelAndReplace(arrParentUnits);
}

function pickParentUnitsUnderWitnessedLevel(conn, arrWitnesses, max_wl, onDone){
	console.log("looking for free parents under wl "+max_wl);
	conn.query(
		"SELECT unit \n\
		FROM units "+(conf.storage === 'sqlite' ? "INDEXED BY byFree" : "")+" \n\
		WHERE +sequence='good' AND is_free=1 AND witnessed_level<? \n\
			AND ( \n\
				SELECT COUNT(*) \n\
				FROM unit_witnesses \n\
				WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
			)>=? \n\
		ORDER BY witnessed_level DESC, level DESC LIMIT ?", 
		[max_wl, arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS, constants.MAX_PARENTS_PER_UNIT], 
		function(rows){
			if (rows.length === 0)
				return pickDeepParentUnits(conn, arrWitnesses, max_wl, onDone);
			var arrParentUnits = rows.map(function(row){ return row.unit; }).sort();
			checkWitnessedLevelNotRetreatingAndLookLower(conn, arrWitnesses, arrParentUnits, true, onDone);
		}
	);
}

// if we failed to find compatible parents among free units. 
// (This may be the case if an attacker floods the network trying to shift the witness list)
function pickDeepParentUnits(conn, arrWitnesses, max_wl, onDone){
	// fixed: an attacker could cover all free compatible units with his own incompatible ones, then those that were not on MC will be never included
	//var cond = bDeep ? "is_on_main_chain=1" : "is_free=1";
	
	console.log("looking for deep parents, max_wl="+max_wl);
	var and_wl = (max_wl === null) ? '' : "AND +is_on_main_chain=1 AND witnessed_level<"+max_wl;
	conn.query(
		"SELECT unit \n\
		FROM units \n\
		WHERE +sequence='good' "+and_wl+" \n\
			AND ( \n\
				SELECT COUNT(*) \n\
				FROM unit_witnesses \n\
				WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
			)>=? \n\
		ORDER BY main_chain_index DESC LIMIT 1", 
		[arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS], 
		function(rows){
			if (rows.length === 0)
				return onDone("failed to find compatible parents: no deep units");
			var arrParentUnits = rows.map(function(row){ return row.unit; });
			checkWitnessedLevelNotRetreatingAndLookLower(conn, arrWitnesses, arrParentUnits, true, onDone);
		}
	);
}

function determineWitnessedLevels(conn, arrWitnesses, arrParentUnits, handleResult){
	storage.determineWitnessedLevelAndBestParent(conn, arrParentUnits, arrWitnesses, function(witnessed_level, best_parent_unit){
		conn.query(
			"SELECT unit, witnessed_level FROM units WHERE unit IN(?) ORDER BY witnessed_level DESC LIMIT 1",
			[arrParentUnits],
			function (rows) {
				var max_parent_wl = rows[0].witnessed_level;
				var parent_with_max_wl = rows[0].unit;
				storage.readStaticUnitProps(conn, best_parent_unit, function(bestParentProps){
					if (bestParentProps.witnessed_level === max_parent_wl)
						parent_with_max_wl = best_parent_unit;
					handleResult(witnessed_level, max_parent_wl, parent_with_max_wl, best_parent_unit);
				});
			}
		);
	//	storage.readStaticUnitProps(conn, best_parent_unit, function(bestParentProps){
	//		handleResult(witnessed_level, bestParentProps.witnessed_level, best_parent_unit);
	//	});
	});
}

function checkWitnessedLevelNotRetreatingAndLookLower(conn, arrWitnesses, arrParentUnits, bRetryDeeper, onDone){
	determineWitnessedLevels(conn, arrWitnesses, arrParentUnits, function(child_witnessed_level, max_parent_wl){
		if (child_witnessed_level >= max_parent_wl)
			return onDone(null, arrParentUnits, max_parent_wl);
		console.log("witness level would retreat from "+max_parent_wl+" to "+child_witnessed_level+" if parents = "+arrParentUnits.join(', ')+", will look for older parents");
		bRetryDeeper
			? pickDeepParentUnits(conn, arrWitnesses, max_parent_wl, onDone)
			: pickParentUnitsUnderWitnessedLevel(conn, arrWitnesses, max_parent_wl, onDone);
	});
}

function findLastStableMcBall(conn, arrWitnesses, onDone){
	conn.query(
		"SELECT ball, unit, main_chain_index FROM units JOIN balls USING(unit) \n\
		WHERE is_on_main_chain=1 AND is_stable=1 AND +sequence='good' AND ( \n\
			SELECT COUNT(*) \n\
			FROM unit_witnesses \n\
			WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
		)>=? \n\
		ORDER BY main_chain_index DESC LIMIT 1", 
		[arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS], 
		function(rows){
			if (rows.length === 0)
				return onDone("failed to find last stable ball");
			onDone(null, rows[0].ball, rows[0].unit, rows[0].main_chain_index);
		}
	);
}

function adjustLastStableMcBallAndParents(conn, last_stable_mc_ball_unit, arrParentUnits, arrWitnesses, handleAdjustedLastStableUnit){
	main_chain.determineIfStableInLaterUnits(conn, last_stable_mc_ball_unit, arrParentUnits, function(bStable){
		if (bStable){
			conn.query("SELECT ball, main_chain_index FROM units JOIN balls USING(unit) WHERE unit=?", [last_stable_mc_ball_unit], function(rows){
				if (rows.length !== 1)
					throw Error("not 1 ball by unit "+last_stable_mc_ball_unit);
				var row = rows[0];
				handleAdjustedLastStableUnit(row.ball, last_stable_mc_ball_unit, row.main_chain_index, arrParentUnits);
			});
			return;
		}
		console.log('will adjust last stable ball because '+last_stable_mc_ball_unit+' is not stable in view of parents '+arrParentUnits.join(', '));
		/*if (arrParentUnits.length > 1){ // select only one parent
			pickDeepParentUnits(conn, arrWitnesses, null, function(err, arrAdjustedParentUnits){
				if (err)
					throw Error("pickDeepParentUnits in adjust failed: "+err);
				adjustLastStableMcBallAndParents(conn, last_stable_mc_ball_unit, arrAdjustedParentUnits, arrWitnesses, handleAdjustedLastStableUnit);
			});
			return;
		}*/
		storage.readStaticUnitProps(conn, last_stable_mc_ball_unit, function(objUnitProps){
			if (!objUnitProps.best_parent_unit)
				throw Error("no best parent of "+last_stable_mc_ball_unit);
			adjustLastStableMcBallAndParents(conn, objUnitProps.best_parent_unit, arrParentUnits, arrWitnesses, handleAdjustedLastStableUnit);
		});
	});
}

function trimParentList(conn, arrParentUnits, arrWitnesses, handleTrimmedList){
	if (arrParentUnits.length <= constants.MAX_PARENTS_PER_UNIT)
		return handleTrimmedList(arrParentUnits);
	conn.query(
		"SELECT unit, (SELECT 1 FROM unit_authors WHERE unit_authors.unit=units.unit AND address IN(?) LIMIT 1) AS is_witness \n\
		FROM units WHERE unit IN("+arrParentUnits.map(db.escape).join(', ')+") ORDER BY is_witness DESC, "+db.getRandom()+" LIMIT ?",
		[arrWitnesses, constants.MAX_PARENTS_PER_UNIT],
		function(rows){
			handleTrimmedList(rows.map(function(row){ return row.unit; }).sort());
		}
	);
}

function pickParentUnitsAndLastBall(conn, arrWitnesses, timestamp, onDone){

	pickParentUnits(conn, arrWitnesses, timestamp, function(err, arrParentUnits, max_parent_wl){
		if (err)
			return onDone(err);
		findLastBallAndAdjust(conn, arrWitnesses, arrParentUnits, function(err,arrTrimmedParentUnits, last_stable_ball, last_stable_unit, last_stable_mci){
			if (err)
				return pickParentsDeeper(max_parent_wl)
			onDone(null, arrTrimmedParentUnits, last_stable_ball, last_stable_unit, last_stable_mci);

		})
	});

	function pickParentsDeeper(max_parent_wl){
		process.stdout.write("will pick parents deeper " + max_parent_wl);
		pickDeepParentUnits(conn, arrWitnesses, max_parent_wl, function(err, arrParentUnits, max_parent_wl){
			if (err)
				return onDone(err);
				findLastBallAndAdjust(conn, arrWitnesses, arrParentUnits, function(err,arrTrimmedParentUnits, last_stable_ball, last_stable_unit, last_stable_mci){
					if (err)
						return pickParentsDeeper(max_parent_wl);
					onDone(null, arrTrimmedParentUnits, last_stable_ball, last_stable_unit, last_stable_mci);
				});
		});
	}
}

function findLastBallAndAdjust(conn, arrWitnesses, arrParentUnits, onDone){

	findLastStableMcBall(conn, arrWitnesses, function(err, last_stable_mc_ball, last_stable_mc_ball_unit, last_stable_mc_ball_mci){
		if (err)
			return onDone(err);
		adjustLastStableMcBallAndParents(
			conn, last_stable_mc_ball_unit, arrParentUnits, arrWitnesses, 
			function(last_stable_ball, last_stable_unit, last_stable_mci, arrAdjustedParentUnits){
				trimParentList(conn, arrAdjustedParentUnits, arrWitnesses, function(arrTrimmedParentUnits){
					storage.findWitnessListUnit(conn, arrWitnesses, last_stable_mci, function(witness_list_unit){
						var objFakeUnit = {parent_units: arrTrimmedParentUnits};
						if (witness_list_unit)
							objFakeUnit.witness_list_unit = witness_list_unit;
						storage.determineIfHasWitnessListMutationsAlongMc(conn, objFakeUnit, last_stable_unit, arrWitnesses, function(err){
							if (err)
								return onDone(err); // if first arg is not array, it is error
							onDone(null, arrTrimmedParentUnits, last_stable_ball, last_stable_unit, last_stable_mci);
						});
					});
				});
			}
		);
	});

}



exports.pickParentUnitsAndLastBall = pickParentUnitsAndLastBall;
