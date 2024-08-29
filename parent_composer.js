/*jslint node: true */
"use strict";
var _ = require('lodash');
var db = require('./db.js');
var constants = require("./constants.js");
var conf = require("./conf.js");
var storage = require("./storage.js");
var main_chain = require("./main_chain.js");
var graph = require('./graph.js');

const bAdvanceLastStableUnit = true;

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
				return pickDeepParentUnits(conn, arrWitnesses, timestamp, null, onDone);
			var arrParentUnits = rows.map(function(row){ return row.unit; });
			adjustParentsToNotRetreatWitnessedLevel(conn, arrWitnesses, arrParentUnits, function(err, arrAdjustedParents, max_parent_wl){
				onDone(err, arrAdjustedParents, max_parent_wl);
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
		if (!excluded_unit)
			throw Error("no excluded unit");
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
		if (iterations >= conf.MAX_PARENT_DEPTH)
			return handleAdjustedParents("failed to find suitable parents after " + iterations + " attempts, please check that your order provider list is updated.");
		iterations++;
		determineWitnessedLevels(conn, arrWitnesses, arrCurrentParentUnits, function(child_witnessed_level, max_parent_wl, parent_with_max_wl, best_parent_unit){
			if (child_witnessed_level >= max_parent_wl && best_parent_unit){
				if (arrCurrentParentUnits.length <= constants.MAX_PARENTS_PER_UNIT)
					return handleAdjustedParents(null, arrCurrentParentUnits.sort(), max_parent_wl);
				var bp_index = arrCurrentParentUnits.indexOf(best_parent_unit);
				if (bp_index < 0)
					throw Error("best parent "+best_parent_unit+" not found among parents "+arrCurrentParentUnits.join(', '));
				arrCurrentParentUnits.splice(bp_index, 1);
				arrCurrentParentUnits.unshift(best_parent_unit); // moves best_parent_unit to the 1st position to make sure it is not sliced off
				return handleAdjustedParents(null, arrCurrentParentUnits.slice(0, constants.MAX_PARENTS_PER_UNIT).sort(), max_parent_wl);
			}
			var msg = best_parent_unit ? 'wl would retreat from '+max_parent_wl+' to '+child_witnessed_level : 'no best parent'
			console.log(msg+', parents '+arrCurrentParentUnits.join(', '));
			replaceExcludedParent(arrCurrentParentUnits, parent_with_max_wl);
		});
	}
	
	checkWitnessedLevelAndReplace(arrParentUnits);
}

function pickParentUnitsUnderWitnessedLevel(conn, arrWitnesses, timestamp, max_wl, onDone){
	console.log("looking for free parents under wl "+max_wl);
	var bWithTimestamp = (storage.getMinRetrievableMci() >= constants.timestampUpgradeMci);
	var ts_cond = bWithTimestamp ? "AND timestamp<=" + timestamp : '';
	conn.query(
		"SELECT unit \n\
		FROM units "+(conf.storage === 'sqlite' ? "INDEXED BY byFree" : "")+" \n\
		WHERE +sequence='good' AND is_free=1 AND witnessed_level<? "+ts_cond+" \n\
			AND ( \n\
				SELECT COUNT(*) \n\
				FROM unit_witnesses \n\
				WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
			)>=? \n\
		ORDER BY witnessed_level DESC, level DESC LIMIT ?", 
		[max_wl, arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS, constants.MAX_PARENTS_PER_UNIT], 
		function(rows){
			if (rows.length === 0)
				return pickDeepParentUnits(conn, arrWitnesses, timestamp, max_wl, onDone);
			var arrParentUnits = rows.map(function(row){ return row.unit; }).sort();
			checkWitnessedLevelNotRetreatingAndLookLower(conn, arrWitnesses, timestamp, arrParentUnits, true, onDone);
		}
	);
}

// if we failed to find compatible parents among free units. 
// (This may be the case if an attacker floods the network trying to shift the witness list)
function pickDeepParentUnits(conn, arrWitnesses, timestamp, max_wl, onDone){
	// fixed: an attacker could cover all free compatible units with his own incompatible ones, then those that were not on MC will be never included
	//var cond = bDeep ? "is_on_main_chain=1" : "is_free=1";
	
	console.log("looking for deep parents, max_wl="+max_wl);
	var and_wl = (max_wl === null) ? '' : "AND +is_on_main_chain=1 AND witnessed_level<"+max_wl;
	var bWithTimestamp = (storage.getMinRetrievableMci() >= constants.timestampUpgradeMci);
	var ts_cond = bWithTimestamp ? "AND timestamp<=" + timestamp : '';
	conn.query(
		"SELECT unit \n\
		FROM units \n\
		WHERE +sequence='good' "+and_wl+" "+ts_cond+" \n\
			AND ( \n\
				SELECT COUNT(*) \n\
				FROM unit_witnesses \n\
				WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
			)>=? \n\
		ORDER BY latest_included_mc_index DESC LIMIT 1", 
		[arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS], 
		function(rows){
			if (rows.length === 0)
				return onDone("failed to find compatible parents: no deep units");
			var arrParentUnits = rows.map(function(row){ return row.unit; });
			console.log('found deep parents: ' + arrParentUnits.join(', '));
			checkWitnessedLevelNotRetreatingAndLookLower(conn, arrWitnesses, timestamp, arrParentUnits, true, onDone);
		}
	);
}

function determineWitnessedLevels(conn, arrWitnesses, arrParentUnits, handleResult){
	storage.determineWitnessedLevelAndBestParent(conn, arrParentUnits, arrWitnesses, constants.version3, function(witnessed_level, best_parent_unit){
		conn.query(
			"SELECT unit, witnessed_level FROM units WHERE unit IN(?) ORDER BY witnessed_level DESC LIMIT 1",
			[arrParentUnits],
			function (rows) {
				var max_parent_wl = rows[0].witnessed_level;
				var parent_with_max_wl = rows[0].unit;
				if (!best_parent_unit)
					return handleResult(witnessed_level, max_parent_wl, parent_with_max_wl);
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

function checkWitnessedLevelNotRetreatingAndLookLower(conn, arrWitnesses, timestamp, arrParentUnits, bRetryDeeper, onDone){
	determineWitnessedLevels(conn, arrWitnesses, arrParentUnits, function(child_witnessed_level, max_parent_wl, parent_with_max_wl, best_parent_unit){
		if (child_witnessed_level >= max_parent_wl && best_parent_unit)
			return onDone(null, arrParentUnits, max_parent_wl);
		var msg = best_parent_unit ? "witness level would retreat from "+max_parent_wl+" to "+child_witnessed_level : "no best parent";
		console.log(msg + " if parents = " + arrParentUnits.join(', ') + ", will look for older parents");
		if (conf.bServeAsHub) // picking parents for someone else, give up early
			return onDone("failed to find parents: " + msg);
		bRetryDeeper
			? pickDeepParentUnits(conn, arrWitnesses, timestamp, max_parent_wl, onDone)
			: pickParentUnitsUnderWitnessedLevel(conn, arrWitnesses, timestamp, max_parent_wl, onDone);
	});
}

function findLastStableMcBall(conn, arrWitnesses, arrParentUnits, onDone) {
	storage.readMaxLastBallMci(conn, arrParentUnits, function (max_parent_last_ball_mci) {
		conn.query(
			"SELECT ball, unit, main_chain_index FROM units JOIN balls USING(unit) \n\
			WHERE is_on_main_chain=1 AND is_stable=1 AND +sequence='good' \n\
				AND main_chain_index" + (bAdvanceLastStableUnit ? '>=' : '=') + "? \n\
				AND main_chain_index<=IFNULL((SELECT MAX(latest_included_mc_index) FROM units WHERE unit IN(?)), 0) \n\
				AND ( \n\
					SELECT COUNT(*) \n\
					FROM unit_witnesses \n\
					WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
				)>=? \n\
			ORDER BY main_chain_index DESC LIMIT 1",
			[max_parent_last_ball_mci, arrParentUnits,
			arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS],
			function (rows) {
				if (rows.length === 0)
					return onDone("failed to find last stable ball");
				console.log('last stable unit: ' + rows[0].unit);
				onDone(null, rows[0].ball, rows[0].unit, rows[0].main_chain_index);
			}
		);
	});
}

function adjustLastStableMcBallAndParents(conn, last_stable_mc_ball_unit, arrParentUnits, arrWitnesses, handleAdjustedLastStableUnit){
	main_chain.determineIfStableInLaterUnitsWithMaxLastBallMciFastPath(conn, last_stable_mc_ball_unit, arrParentUnits, function(bStable){
		console.log("stability of " + last_stable_mc_ball_unit + " in " + arrParentUnits.join(', ') + ": " + bStable);
		if (bStable) {
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
			var next_last_ball_unit = objUnitProps.best_parent_unit;
			graph.determineIfIncluded(conn, next_last_ball_unit, arrParentUnits, function (bIncluded) {
				if (bIncluded)
					return adjustLastStableMcBallAndParents(conn, next_last_ball_unit, arrParentUnits, arrWitnesses, handleAdjustedLastStableUnit);
				console.log("last ball unit " + next_last_ball_unit + " not included in parents " + arrParentUnits.join(', '));
				conn.query(
					"SELECT lb_units.unit \n\
					FROM units AS p_units \n\
					CROSS JOIN units AS lb_units ON p_units.last_ball_unit=lb_units.unit \n\
					WHERE p_units.unit IN(?) \n\
					ORDER BY lb_units.main_chain_index DESC LIMIT 1",
					[arrParentUnits],
					function (rows) {
						next_last_ball_unit = rows[0].unit;
						adjustLastStableMcBallAndParents(conn, next_last_ball_unit, arrParentUnits, arrWitnesses, handleAdjustedLastStableUnit);
					}
				);
			});
		});
	});
}

function trimParentList(conn, arrParentUnits, last_stable_mci, arrWitnesses, handleTrimmedList) {
	if (arrParentUnits.length === 1)
		return handleTrimmedList(arrParentUnits);
	conn.query(
		"SELECT DISTINCT units.unit \n\
		FROM units \n\
		CROSS JOIN unit_authors USING(unit) \n\
		LEFT JOIN aa_addresses USING(address) \n\
		WHERE units.unit IN(" + arrParentUnits.map(db.escape).join(', ') + ") \n\
			AND (aa_addresses.address IS NULL OR latest_included_mc_index<=?) \n\
		ORDER BY (unit_authors.address IN(?)) DESC, " + db.getRandom() + " LIMIT ?",
		[last_stable_mci, arrWitnesses, constants.MAX_PARENTS_PER_UNIT],
		function (rows) {
			handleTrimmedList(rows.map(function (row) { return row.unit; }).sort());
		}
	);
}

function pickParentUnitsAndLastBallBeforeOpVote(conn, arrWitnesses, timestamp, onDone){

	var depth = 0;
	pickParentUnits(conn, arrWitnesses, timestamp, function(err, arrParentUnits, max_parent_wl){
		if (err)
			return onDone(err);
		findLastBallAndAdjust(conn, arrWitnesses, arrParentUnits, function(err,arrTrimmedParentUnits, last_stable_ball, last_stable_unit, last_stable_mci){
			if (err) {
				console.log("initial findLastBallAndAdjust returned error: " + err + ", will pickParentsDeeper");
				return pickParentsDeeper(max_parent_wl)
			}
			onDone(null, arrTrimmedParentUnits, last_stable_ball, last_stable_unit, last_stable_mci);
		})
	});

	function pickParentsDeeper(max_parent_wl){
		depth++;
		if (conf.MAX_PARENT_DEPTH && depth > conf.MAX_PARENT_DEPTH)
			return onDone("failed to pick parents after digging to depth " + depth + ", please check that your order provider list is updated.");
		pickDeepParentUnits(conn, arrWitnesses, timestamp, max_parent_wl, function (err, arrParentUnits, max_parent_wl) {
			if (err)
				return onDone(err);
			findLastBallAndAdjust(conn, arrWitnesses, arrParentUnits, function(err,arrTrimmedParentUnits, last_stable_ball, last_stable_unit, last_stable_mci){
				if (err) {
					console.log("secondary findLastBallAndAdjust returned error: " + err + ", will pickParentsDeeper");
					return pickParentsDeeper(max_parent_wl);
				}
				onDone(null, arrTrimmedParentUnits, last_stable_ball, last_stable_unit, last_stable_mci);
			});
		});
	}
}

function findLastBallAndAdjust(conn, arrWitnesses, arrParentUnits, onDone){

	findLastStableMcBall(conn, arrWitnesses, arrParentUnits, function(err, last_stable_mc_ball, last_stable_mc_ball_unit, last_stable_mc_ball_mci){
		if (err)
			return onDone(err);
		adjustLastStableMcBallAndParents(
			conn, last_stable_mc_ball_unit, arrParentUnits, arrWitnesses, 
			function(last_stable_ball, last_stable_unit, last_stable_mci, arrAdjustedParentUnits){
				trimParentList(conn, arrAdjustedParentUnits, last_stable_mci, arrWitnesses, function(arrTrimmedParentUnits){
					storage.findWitnessListUnit(conn, arrWitnesses, last_stable_mci, function(witness_list_unit){
						var objFakeUnit = {parent_units: arrTrimmedParentUnits, version: constants.version3};
						if (witness_list_unit)
							objFakeUnit.witness_list_unit = witness_list_unit;
						console.log('determineIfHasWitnessListMutationsAlongMc last_stable_unit '+last_stable_unit+', parents '+arrParentUnits.join(', '));
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

function pickParentUnitsAndLastBall(conn, arrWitnesses, timestamp, arrFromAddresses, onDone) {
	if (!onDone)
		return new Promise((resolve, reject) => pickParentUnitsAndLastBall(
			conn, arrWitnesses, timestamp, arrFromAddresses,
			(err, arrParentUnits, last_stable_mc_ball, last_stable_mc_ball_unit, last_stable_mc_ball_mci) => {
				if (err)
					return reject(err)
				resolve({ arrParentUnits, last_stable_mc_ball, last_stable_mc_ball_unit, last_stable_mc_ball_mci });
			}
		));
	conn.query(
		`SELECT units.unit, units.version, units.alt, units.witnessed_level, units.level, units.is_aa_response, lb_units.main_chain_index AS last_ball_mci
		FROM units ${conf.storage === 'sqlite' ? "INDEXED BY byFree" : ""}
		LEFT JOIN archived_joints USING(unit)
		LEFT JOIN units AS lb_units ON units.last_ball_unit=lb_units.unit
		WHERE +units.sequence='good' AND units.is_free=1 AND archived_joints.unit IS NULL AND units.timestamp<=?
		ORDER BY last_ball_mci DESC
		LIMIT ?`,
		// exclude potential parents that were archived and then received again
		[timestamp, constants.MAX_PARENTS_PER_UNIT],
		async function (prows) {
			if (prows.some(row => constants.supported_versions.indexOf(row.version) == -1 || row.alt !== constants.alt))
				throw Error('wrong network');
			if (prows.length === 0)
				return onDone(`no usable free units`);
			const max_parent_last_ball_mci = Math.max.apply(null, prows.map(row => row.last_ball_mci));
			if (max_parent_last_ball_mci < constants.v4UpgradeMci)
				return pickParentUnitsAndLastBallBeforeOpVote(conn, arrWitnesses, timestamp, onDone);
			prows = await filterParentsByTpsFeeAndReplace(conn, prows, arrFromAddresses);
			let arrParentUnits = prows.map(row => row.unit);
			console.log('parents', prows)
			let lb = await getLastBallInfo(conn, prows);
			if (lb)
				return onDone(null, arrParentUnits.sort(), lb.ball, lb.unit, lb.main_chain_index);
			console.log(`failed to find parents that satisfy all requirements, will try a subset with the most recent OP list`);
			let uniform_prows = []; // parents having the same and new OP list at their last ball mci
			const top_ops = storage.getOpList(prows[0].last_ball_mci).join(',');
			for (let prow of prows) {
				const ops = storage.getOpList(prow.last_ball_mci).join(',');
				if (ops === top_ops)
					uniform_prows.push(prow);
				else
					break;
			}
			if (uniform_prows.length === 0)
				throw Error(`no uniform prows`);
			if (uniform_prows.length < prows.length) {
				arrParentUnits = uniform_prows.map(row => row.unit);
				lb = await getLastBallInfo(conn, uniform_prows);
				if (lb)
					return onDone(null, arrParentUnits.sort(), lb.ball, lb.unit, lb.main_chain_index);
				console.log(`failed to find parents even when looking for parents with the new OP list`);
			}
			else
				console.log("failed to find last stable ball, OP lists of all candidates are the same");
			const prev_ops = storage.getOpList(prows[0].last_ball_mci - 1).join(',');
			if (prev_ops === top_ops)
				return onDone(`failed to find parents, OP list didn't change`);
			console.log("will drop the parents with the new OP list and pick deeper parents");
			prows = await filterParentsWithOlderOpListAndReplace(conn, prows, top_ops, arrFromAddresses);
			console.log('parents with older OP lists', prows)
			arrParentUnits = prows.map(row => row.unit);
			lb = await getLastBallInfo(conn, prows);
			if (lb)
				return onDone(null, arrParentUnits.sort(), lb.ball, lb.unit, lb.main_chain_index);
			onDone(`failed to find parents even when looking for parents with the older OP list`);
		}
	);
}

async function filterParentsByTpsFeeAndReplace(conn, prows, arrFromAddresses) {
	const current_tps_fee = storage.getCurrentTpsFee();
	const min_parentable_tps_fee_multiplier = conf.min_parentable_tps_fee_multiplier || 3;
	const min_parentable_tps_fee = current_tps_fee * min_parentable_tps_fee_multiplier;
	let filtered_prows = [];
	let excluded_parents = [];
	for (let prow of prows) {
		const { unit, is_aa_response } = prow;
		if (is_aa_response) {
			filtered_prows.push(prow);
			continue;			
		}
		const paid_tps_fee = await storage.getPaidTpsFee(conn, unit);
		const objUnitProps = await storage.readUnitProps(conn, unit);
		const count_units = storage.getCountUnitsPayingTpsFee(objUnitProps);
		const paid_tps_fee_per_unit = paid_tps_fee / count_units;
		if (paid_tps_fee_per_unit >= min_parentable_tps_fee)
			filtered_prows.push(prow);
		else {
			if (_.intersection(objUnitProps.author_addresses, arrFromAddresses).length > 0) {
				console.log(`cannot skip potential parent ${unit} whose paid tps fee per unit ${paid_tps_fee_per_unit} < min parentable tps fee ${min_parentable_tps_fee} because it is authored by one of our from addresses`);
				filtered_prows.push(prow);
				continue;
			}
			console.log(`skipping potential parent ${unit} as its paid tps fee per unit ${paid_tps_fee_per_unit} < min parentable tps fee ${min_parentable_tps_fee}`);
			excluded_parents.push(unit);
		}
	}
	if (excluded_parents.length > 0) {
		// filtered_prows is modified in place
		const bAddedNewParents = await replaceParents(conn, filtered_prows, excluded_parents);
		if (bAddedNewParents) // check the new parents for tps fee
			return await filterParentsByTpsFeeAndReplace(conn, filtered_prows, arrFromAddresses);
	}
	if (filtered_prows.length === 0)
		throw Error(`all potential parents underpay the tps fee`);
	return filtered_prows;
}

// finds parents with an older OP list
async function filterParentsWithOlderOpListAndReplace(conn, prows, top_ops, arrFromAddresses) {
	let filtered_prows = [];
	let excluded_parents = [];
	for (let prow of prows) {
		const { unit, is_aa_response } = prow;
		if (is_aa_response) {
			// we might end up choosing an older last ball unit, so the trigger would not be stable yet
			continue;			
		}
		const ops = storage.getOpList(prow.last_ball_mci).join(',');
		if (ops !== top_ops)
			filtered_prows.push(prow);
		else {
			const objUnitProps = await storage.readUnitProps(conn, unit);
			if (_.intersection(objUnitProps.author_addresses, arrFromAddresses).length > 0) {
				console.log(`cannot skip potential parent ${unit} whose OP list ${ops} = top OP list ${top_ops} because it is authored by one of our from addresses`);
				filtered_prows.push(prow);
				continue;
			}
			console.log(`skipping potential parent ${unit} as its OP list ${ops} = top OP list ${top_ops}`);
			excluded_parents.push(unit);
		}
	}
	if (excluded_parents.length > 0) {
		// filtered_prows is modified in place
		const bAddedNewParents = await replaceParents(conn, filtered_prows, excluded_parents);
		if (bAddedNewParents) // check the new parents for OP list
			return await filterParentsWithOlderOpListAndReplace(conn, filtered_prows, top_ops, arrFromAddresses);
	}
	if (filtered_prows.length === 0)
		throw Error(`all potential parents have the top OP list`);
	return filtered_prows;
}

async function replaceParents(conn, filtered_prows, excluded_parents) {
	const max_parent_limci = filtered_prows.length > 0 ? Math.max.apply(null, filtered_prows.map(row => row.latest_included_mc_index)) : -1;
	const replacement_rows = await conn.query(`SELECT DISTINCT parent_unit 
		FROM parenthoods
		LEFT JOIN units ON parent_unit=unit
		WHERE child_unit IN(?) AND (main_chain_index IS NULL OR main_chain_index > ?)`,
		[excluded_parents, max_parent_limci]
	);
	const replacement_parents = replacement_rows.map(r => r.parent_unit);
	let bAddedNewParents = false;
	for (let unit of replacement_parents) {
		const remaining_replacement_parents = replacement_parents.filter(p => p !== unit);
		const other_parents = _.uniq(filtered_prows.map(r => r.unit).concat(remaining_replacement_parents));
		if (other_parents.length > 0) {
			const bIncluded = await graph.determineIfIncludedOrEqual(conn, unit, other_parents);
			if (bIncluded) {
				console.log(`potential replacement parent ${unit} would be included in other parents, skipping`);
				continue;
			}
		}
		const [props] = await conn.query(
			`SELECT units.unit, units.version, units.alt, units.witnessed_level, units.level, units.is_aa_response, lb_units.main_chain_index AS last_ball_mci
			FROM units
			LEFT JOIN units AS lb_units ON units.last_ball_unit=lb_units.unit
			WHERE units.unit=?`,
			[unit]
		);
		filtered_prows.push(props);
		bAddedNewParents = true;
	}
	return bAddedNewParents;
}

async function getTpsFee(conn, parent_units, last_ball_unit, timestamp, count_units = 1) {
	return Math.max(
		await getLocalTpsFee(conn, parent_units, last_ball_unit, timestamp, count_units),
		storage.getCurrentTpsFeeToPay() * count_units,
		storage.getCurrentTpsFeeToPay(1) * count_units
	);
}

async function getLocalTpsFee(conn, parent_units, last_ball_unit, timestamp, count_units = 1) {
	const objUnitProps = await createUnitProps(conn, parent_units, last_ball_unit, timestamp);
	console.log('getLocalTpsFee', objUnitProps)
	return await storage.getLocalTpsFee(conn, objUnitProps, count_units);
}

async function createUnitProps(conn, parent_units, last_ball_unit, timestamp) {
	return {
		unit: 'new-unit',
		timestamp,
		last_ball_unit,
		parent_units,
		best_parent_unit: await getBestParentUnit(conn, parent_units),
		// count_primary_aa_triggers and max_aa_responses are not used for the tip unit
	};
}

async function getBestParentUnit(conn, parent_units) {
	if (parent_units.length === 1)
		return parent_units[0];
	const prows = await conn.query("SELECT unit, level, witnessed_level FROM units WHERE unit IN(?)", [parent_units]);
	let best_parent_prow = prows[0];
	for (let i = 1; i < prows.length; i++){
		const prow = prows[i];
		if (prow.witnessed_level < best_parent_prow.witnessed_level)
			continue;
		if (prow.witnessed_level === best_parent_prow.witnessed_level) {
			if (prow.level > best_parent_prow.level)
				continue;
			if (prow.level === best_parent_prow.level) {
				if (prow.unit > best_parent_prow.unit)
					continue;
			}
		}
		best_parent_prow = prow;
	}
	return best_parent_prow.unit;
}

async function getLastBallInfo(conn, prows) {
	const arrParentUnits = prows.map(row => row.unit);
	const max_parent_wl = Math.max.apply(null, prows.map(row => row.witnessed_level));
	const max_parent_last_ball_mci = Math.max.apply(null, prows.map(row => row.last_ball_mci));
	const rows = await conn.query(
		`SELECT ball, unit, main_chain_index
		FROM units
		JOIN balls USING(unit)
		WHERE is_on_main_chain=1 AND is_stable=1 AND +sequence='good'
			AND main_chain_index ${bAdvanceLastStableUnit ? '>=' : '='}?
			AND main_chain_index<=IFNULL((SELECT MAX(latest_included_mc_index) FROM units WHERE unit IN(?)), 0)
		ORDER BY main_chain_index DESC`,
		[max_parent_last_ball_mci, arrParentUnits]
	);
	if (rows.length === 0) {
		console.log(`no last stable ball candidates`);
		return null;
	}
	for (let row of rows) {
		console.log('trying last stable unit: ' + row.unit);
		const bStable = await main_chain.determineIfStableInLaterUnitsWithMaxLastBallMciFastPath(conn, row.unit, arrParentUnits);
		if (!bStable) {
			console.log(`unit ${row.unit} not stable in potential parents`, arrParentUnits);
			continue;
		}
		const arrWitnesses = storage.getOpList(row.main_chain_index);
		const { witnessed_level } = await storage.determineWitnessedLevelAndBestParent(conn, arrParentUnits, arrWitnesses, constants.version);
		if (witnessed_level >= max_parent_wl)
			return row;
	}
	console.log(`no candidate last ball fits: is stable in parents and witness level does not retreat`);
	return null;
}

exports.pickParentUnitsAndLastBall = pickParentUnitsAndLastBall;
exports.getTpsFee = getTpsFee;
