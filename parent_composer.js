/*jslint node: true */
"use strict";
var db = require('./db.js');
var constants = require("./constants.js");
var conf = require("./conf.js");
var storage = require("./storage.js");
var main_chain = require("./main_chain.js");


function pickParentUnits(conn, arrWitnesses, onDone){
	// don't exclude units derived from unwitnessed potentially bad units! It is not their blame and can cause a split.
	
	// test creating bad units
	//var cond = bDeep ? "is_on_main_chain=1" : "is_free=0 AND main_chain_index=1420";
	//var order_and_limit = bDeep ? "ORDER BY main_chain_index DESC LIMIT 1" : "ORDER BY unit LIMIT 1";
	
	conn.query(
		"SELECT \n\
			unit, version, alt, ( \n\
				SELECT COUNT(*) \n\
				FROM unit_witnesses \n\
				WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
			) AS count_matching_witnesses \n\
		FROM units "+(conf.storage === 'sqlite' ? "INDEXED BY byFree" : "")+" \n\
		LEFT JOIN archived_joints USING(unit) \n\
		WHERE +sequence='good' AND is_free=1 AND archived_joints.unit IS NULL ORDER BY unit", 
		// exclude potential parents that were archived and then received again
		[arrWitnesses], 
		function(rows){
			if (rows.some(function(row){ return (row.version !== constants.version || row.alt !== constants.alt); }))
				throw Error('wrong network');
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
		WHERE +sequence='good' \n\
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
		WHERE is_on_main_chain=1 AND is_stable=1 AND +sequence='good' AND ( \n\
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

function adjustLastStableMcBall(conn, last_stable_mc_ball_unit, arrParentUnits, handleAdjustedLastStableUnit){
	main_chain.determineIfStableInLaterUnits(conn, last_stable_mc_ball_unit, arrParentUnits, function(bStable){
		if (bStable){
			conn.query("SELECT ball, main_chain_index FROM units JOIN balls USING(unit) WHERE unit=?", [last_stable_mc_ball_unit], function(rows){
				if (rows.length !== 1)
					throw Error("not 1 ball by unit "+last_stable_mc_ball_unit);
				var row = rows[0];
				handleAdjustedLastStableUnit(row.ball, last_stable_mc_ball_unit, row.main_chain_index);
			});
			return;
		}
		console.log('will adjust last stable ball because '+last_stable_mc_ball_unit+' is not stable in view of parents '+arrParentUnits.join(', '));
		storage.readStaticUnitProps(conn, last_stable_mc_ball_unit, function(objUnitProps){
			if (!objUnitProps.best_parent_unit)
				throw Error("no best parent of "+last_stable_mc_ball_unit);
			adjustLastStableMcBall(conn, objUnitProps.best_parent_unit, arrParentUnits, handleAdjustedLastStableUnit)
		});
	});
}

function pickParentUnitsAndLastBall(conn, arrWitnesses, onDone){
	pickParentUnits(conn, arrWitnesses, function(arrParentUnits){
		findLastStableMcBall(conn, arrWitnesses, function(last_stable_mc_ball, last_stable_mc_ball_unit, last_stable_mc_ball_mci){
			adjustLastStableMcBall(conn, last_stable_mc_ball_unit, arrParentUnits, function(last_stable_ball, last_stable_unit, last_stable_mci){
				onDone(arrParentUnits, last_stable_ball, last_stable_unit, last_stable_mci);
			});
		});
	});
}

exports.pickParentUnitsAndLastBall = pickParentUnitsAndLastBall;
