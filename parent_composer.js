/*jslint node: true */
"use strict";
var db = require('./db.js');
var constants = require("./constants.js");


function pickParentUnits(conn, arrWitnesses, onDone){
	// don't exclude units derived from unwitnessed potentially bad units! It is not their blame and can cause a split.
	
	// test creating bad units
	//var cond = bDeep ? "is_on_main_chain=1" : "is_free=0 AND main_chain_index=1420";
	//var order_and_limit = bDeep ? "ORDER BY main_chain_index DESC LIMIT 1" : "ORDER BY unit LIMIT 1";
	
	conn.query(
		"SELECT \n\
			unit, ( \n\
				SELECT COUNT(*) \n\
				FROM unit_witnesses \n\
				WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
			) AS count_matching_witnesses \n\
		FROM units \n\
		LEFT JOIN archived_joints USING(unit) \n\
		WHERE sequence='good' AND is_free=1 AND archived_joints.unit IS NULL ORDER BY unit", 
		// exclude potential parents that were archived and then received again
		[arrWitnesses], 
		function(rows){
			var count_required_matches = constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS;
			// we need at least one compatible parent, otherwise go deep
			if (rows.filter(function(row){ return (row.count_matching_witnesses >= count_required_matches); }).length === 0)
				return pickDeepParentUnits(conn, arrWitnesses, onDone);
			onDone(rows.map(function(row){ return row.unit; }));
		}
	);
}

// if we failed to find compatible parents among free units. 
// (This may be the case if an attacker floods the network trying to shift the witness list)
function pickDeepParentUnits(conn, arrWitnesses, onDone){
	// fixed: an attacker could cover all free compatible units with his own incompatible ones, then those that were not on MC will be never included
	//var cond = bDeep ? "is_on_main_chain=1" : "is_free=1";
	
	conn.query(
		"SELECT unit \n\
		FROM units \n\
		WHERE sequence='good' \n\
			AND ( \n\
				SELECT COUNT(*) \n\
				FROM unit_witnesses \n\
				WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
			)>=? \n\
		ORDER BY main_chain_index DESC LIMIT 1", 
		[arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS], 
		function(rows){
			if (rows.length === 0)
				throw Error("no deep units?");
			onDone(rows.map(function(row){ return row.unit; }));
		}
	);
}

function findLastStableMcBall(conn, arrWitnesses, onDone){
	conn.query(
		"SELECT ball, unit, main_chain_index FROM units JOIN balls USING(unit) \n\
		WHERE is_on_main_chain=1 AND is_stable=1 AND sequence='good' AND ( \n\
			SELECT COUNT(*) \n\
			FROM unit_witnesses \n\
			WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
		)>=? \n\
		ORDER BY main_chain_index DESC LIMIT 1", 
		[arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS], 
		function(rows){
			if (rows.length === 0)
				throw Error("no last stable ball?");
			onDone(rows[0].ball, rows[0].unit, rows[0].main_chain_index);
		}
	);
}

function pickParentUnitsAndLastBall(conn, arrWitnesses, onDone){
	pickParentUnits(conn, arrWitnesses, function(arrParentUnits){
		findLastStableMcBall(conn, arrWitnesses, function(last_stable_mc_ball, last_stable_mc_ball_unit, last_stable_mc_ball_mci){
			onDone(arrParentUnits, last_stable_mc_ball, last_stable_mc_ball_unit, last_stable_mc_ball_mci);
			/*
			graph.determineIfIncludedOrEqual(conn, last_stable_mc_ball_unit, arrParentUnits, function(bIncluded){
				if (!bIncluded && !conf.bLight)
					throw "last ball not included in parents";
				objUnit.last_ball = last_stable_mc_ball;
				objUnit.last_ball_unit = last_stable_mc_ball_unit;
				last_ball_mci = last_stable_mc_ball_mci;
			});*/
		});
	});
}

exports.pickParentUnitsAndLastBall = pickParentUnitsAndLastBall;
