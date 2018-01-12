/*jslint node: true */
const _ = require('lodash');
const db = require('./db.js');
const constants = require("./constants.js");
const conf = require("./conf.js");
const storage = require("./storage.js");
const main_chain = require("./main_chain.js");


function pickParentUnits(conn, arrWitnesses, onDone){
	// don't exclude units derived from unwitnessed potentially bad units! It is not their blame and can cause a split.
	
	// test creating bad units
	//var cond = bDeep ? "is_on_main_chain=1" : "is_free=0 AND main_chain_index=1420";
	//var order_and_limit = bDeep ? "ORDER BY main_chain_index DESC LIMIT 1" : "ORDER BY unit LIMIT 1";
	
	conn.query(
		`SELECT \n\
            unit, version, alt, ( \n\
                SELECT COUNT(*) \n\
                FROM unit_witnesses \n\
                WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
            ) AS count_matching_witnesses \n\
        FROM units ${conf.storage === 'sqlite' ? "INDEXED BY byFree" : ""} \n\
        LEFT JOIN archived_joints USING(unit) \n\
        WHERE +sequence='good' AND is_free=1 AND archived_joints.unit IS NULL ORDER BY unit LIMIT ?`, 
		// exclude potential parents that were archived and then received again
		[arrWitnesses, constants.MAX_PARENTS_PER_UNIT], 
		rows => {
			if (rows.some(({version, alt}) => version !== constants.version || alt !== constants.alt))
				throw Error('wrong network');
			const count_required_matches = constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS;
			// we need at least one compatible parent, otherwise go deep
			if (rows.filter(({count_matching_witnesses}) => count_matching_witnesses >= count_required_matches).length === 0)
				return pickDeepParentUnits(conn, arrWitnesses, null, onDone);
			const arrParentUnits = rows.map(({unit}) => unit);
			adjustParentsToNotRetreatWitnessedLevel(conn, arrWitnesses, arrParentUnits, arrAdjustedParents => {
				onDone(null, arrAdjustedParents);
			});
		//	checkWitnessedLevelNotRetreatingAndLookLower(conn, arrWitnesses, arrParentUnits, (arrParentUnits.length === 1), onDone);
		}
	);
}

function adjustParentsToNotRetreatWitnessedLevel(conn, arrWitnesses, arrParentUnits, handleAdjustedParents){
	let arrExcludedUnits = [];
	let iterations = 0;
	
	function replaceExcludedParent(arrCurrentParentUnits, excluded_unit){
		console.log(`replaceExcludedParent ${arrCurrentParentUnits.join(', ')} excluding ${excluded_unit}`);
		const arrNewExcludedUnits = [excluded_unit];
		console.log(`excluded parents: ${arrNewExcludedUnits.join(', ')}`);
		arrExcludedUnits = arrExcludedUnits.concat(arrNewExcludedUnits);
		const arrParentsToKeep = _.difference(arrCurrentParentUnits, arrNewExcludedUnits);
		conn.query("SELECT DISTINCT parent_unit FROM parenthoods WHERE child_unit IN(?)", [arrNewExcludedUnits], rows => {
			const arrCandidateReplacements = rows.map(({parent_unit}) => parent_unit);
			console.log(`candidate replacements: ${arrCandidateReplacements.join(', ')}`);
			conn.query(
				"SELECT DISTINCT parent_unit FROM parenthoods WHERE parent_unit IN(?) AND child_unit NOT IN(?)", 
				[arrCandidateReplacements, arrExcludedUnits], 
				rows => {
					const arrCandidatesWithOtherChildren = rows.map(({parent_unit}) => parent_unit);
					console.log(`candidates with other children: ${arrCandidatesWithOtherChildren.join(', ')}`);
					const arrReplacementParents = _.difference(arrCandidateReplacements, arrCandidatesWithOtherChildren);
					console.log(`replacements for excluded parents: ${arrReplacementParents.join(', ')}`);
					const arrNewParents = arrParentsToKeep.concat(arrReplacementParents);
					console.log(`new parents: ${arrNewParents.join(', ')}`);
					if (arrNewParents.length === 0)
						throw Error("no new parents");
					checkWitnessedLevelAndReplace(arrNewParents);
				}
			);
		});
	}
	
	function checkWitnessedLevelAndReplace(arrCurrentParentUnits){
		console.log(`checkWitnessedLevelAndReplace ${arrCurrentParentUnits.join(', ')}`);
		if (iterations > 0 && arrExcludedUnits.length === 0)
			throw Error("infinite cycle");
		iterations++;
		determineWitnessedLevels(conn, arrWitnesses, arrCurrentParentUnits, (child_witnessed_level, best_parent_witnessed_level, best_parent_unit) => {
			if (child_witnessed_level >= best_parent_witnessed_level)
				return handleAdjustedParents(arrCurrentParentUnits.sort());
			console.log(`wl would retreat from ${best_parent_witnessed_level} to ${child_witnessed_level}, parents ${arrCurrentParentUnits.join(', ')}`);
			replaceExcludedParent(arrCurrentParentUnits, best_parent_unit);
		});
	}
	
	checkWitnessedLevelAndReplace(arrParentUnits);
}

function pickParentUnitsUnderWitnessedLevel(conn, arrWitnesses, max_wl, onDone){
	console.log(`looking for free parents under wl ${max_wl}`);
	conn.query(
		`SELECT unit \n\
        FROM units ${conf.storage === 'sqlite' ? "INDEXED BY byFree" : ""} \n\
        WHERE +sequence='good' AND is_free=1 AND witnessed_level<? \n\
            AND ( \n\
                SELECT COUNT(*) \n\
                FROM unit_witnesses \n\
                WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
            )>=? \n\
        ORDER BY witnessed_level DESC, level DESC LIMIT ?`, 
		[max_wl, arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS, constants.MAX_PARENTS_PER_UNIT], 
		rows => {
			if (rows.length === 0)
				return pickDeepParentUnits(conn, arrWitnesses, max_wl, onDone);
			const arrParentUnits = rows.map(({unit}) => unit).sort();
			checkWitnessedLevelNotRetreatingAndLookLower(conn, arrWitnesses, arrParentUnits, true, onDone);
		}
	);
}

// if we failed to find compatible parents among free units. 
// (This may be the case if an attacker floods the network trying to shift the witness list)
function pickDeepParentUnits(conn, arrWitnesses, max_wl, onDone){
	// fixed: an attacker could cover all free compatible units with his own incompatible ones, then those that were not on MC will be never included
	//var cond = bDeep ? "is_on_main_chain=1" : "is_free=1";
	
	console.log(`looking for deep parents, max_wl=${max_wl}`);
	const and_wl = (max_wl === null) ? '' : `AND +is_on_main_chain=1 AND witnessed_level<${max_wl}`;
	conn.query(
		`SELECT unit \n\
        FROM units \n\
        WHERE +sequence='good' ${and_wl} \n\
            AND ( \n\
                SELECT COUNT(*) \n\
                FROM unit_witnesses \n\
                WHERE unit_witnesses.unit IN(units.unit, units.witness_list_unit) AND address IN(?) \n\
            )>=? \n\
        ORDER BY main_chain_index DESC LIMIT 1`, 
		[arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS], 
		rows => {
			if (rows.length === 0)
				return onDone("failed to find compatible parents: no deep units");
			const arrParentUnits = rows.map(({unit}) => unit);
			checkWitnessedLevelNotRetreatingAndLookLower(conn, arrWitnesses, arrParentUnits, true, onDone);
		}
	);
}

function determineWitnessedLevels(conn, arrWitnesses, arrParentUnits, handleResult){
	storage.determineWitnessedLevelAndBestParent(conn, arrParentUnits, arrWitnesses, (witnessed_level, best_parent_unit) => {
		storage.readStaticUnitProps(conn, best_parent_unit, bestParentProps => {
			handleResult(witnessed_level, bestParentProps.witnessed_level, best_parent_unit);
		});
	});
}

function checkWitnessedLevelNotRetreatingAndLookLower(conn, arrWitnesses, arrParentUnits, bRetryDeeper, onDone){
	determineWitnessedLevels(conn, arrWitnesses, arrParentUnits, (child_witnessed_level, best_parent_witnessed_level) => {
		if (child_witnessed_level >= best_parent_witnessed_level)
			return onDone(null, arrParentUnits);
		console.log(`witness level would retreat from ${best_parent_witnessed_level} to ${child_witnessed_level} if parents = ${arrParentUnits.join(', ')}, will look for older parents`);
		bRetryDeeper
			? pickDeepParentUnits(conn, arrWitnesses, best_parent_witnessed_level, onDone)
			: pickParentUnitsUnderWitnessedLevel(conn, arrWitnesses, best_parent_witnessed_level, onDone);
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
		rows => {
			if (rows.length === 0)
				return onDone("failed to find last stable ball");
			onDone(null, rows[0].ball, rows[0].unit, rows[0].main_chain_index);
		}
	);
}

function adjustLastStableMcBallAndParents(conn, last_stable_mc_ball_unit, arrParentUnits, arrWitnesses, handleAdjustedLastStableUnit){
	main_chain.determineIfStableInLaterUnits(conn, last_stable_mc_ball_unit, arrParentUnits, bStable => {
		if (bStable){
			conn.query("SELECT ball, main_chain_index FROM units JOIN balls USING(unit) WHERE unit=?", [last_stable_mc_ball_unit], rows => {
				if (rows.length !== 1)
					throw Error(`not 1 ball by unit ${last_stable_mc_ball_unit}`);
				const row = rows[0];
				handleAdjustedLastStableUnit(row.ball, last_stable_mc_ball_unit, row.main_chain_index, arrParentUnits);
			});
			return;
		}
		console.log(`will adjust last stable ball because ${last_stable_mc_ball_unit} is not stable in view of parents ${arrParentUnits.join(', ')}`);
		/*if (arrParentUnits.length > 1){ // select only one parent
			pickDeepParentUnits(conn, arrWitnesses, null, function(err, arrAdjustedParentUnits){
				if (err)
					throw Error("pickDeepParentUnits in adjust failed: "+err);
				adjustLastStableMcBallAndParents(conn, last_stable_mc_ball_unit, arrAdjustedParentUnits, arrWitnesses, handleAdjustedLastStableUnit);
			});
			return;
		}*/
		storage.readStaticUnitProps(conn, last_stable_mc_ball_unit, ({best_parent_unit}) => {
			if (!best_parent_unit)
				throw Error(`no best parent of ${last_stable_mc_ball_unit}`);
			adjustLastStableMcBallAndParents(conn, best_parent_unit, arrParentUnits, arrWitnesses, handleAdjustedLastStableUnit);
		});
	});
}

function trimParentList(conn, arrParentUnits, arrWitnesses, handleTrimmedList){
	if (arrParentUnits.length <= constants.MAX_PARENTS_PER_UNIT)
		return handleTrimmedList(arrParentUnits);
	conn.query(
		`SELECT unit, (SELECT 1 FROM unit_authors WHERE unit_authors.unit=units.unit AND address IN(?) LIMIT 1) AS is_witness \n\
        FROM units WHERE unit IN(${arrParentUnits.map(db.escape).join(', ')}) ORDER BY is_witness DESC, ${db.getRandom()} LIMIT ?`,
		[arrWitnesses, constants.MAX_PARENTS_PER_UNIT],
		rows => {
			handleTrimmedList(rows.map(({unit}) => unit).sort());
		}
	);
}

function pickParentUnitsAndLastBall(conn, arrWitnesses, onDone){
	pickParentUnits(conn, arrWitnesses, (err, arrParentUnits) => {
		if (err)
			return onDone(err);
		findLastStableMcBall(conn, arrWitnesses, (
            err,
            last_stable_mc_ball,
            last_stable_mc_ball_unit,
            last_stable_mc_ball_mci
        ) => {
			if (err)
				return onDone(err);
			adjustLastStableMcBallAndParents(
				conn, last_stable_mc_ball_unit, arrParentUnits, arrWitnesses, 
				(
                    last_stable_ball,
                    last_stable_unit,
                    last_stable_mci,
                    arrAdjustedParentUnits
                ) => {
					trimParentList(conn, arrAdjustedParentUnits, arrWitnesses, arrTrimmedParentUnits => {
						storage.findWitnessListUnit(conn, arrWitnesses, last_stable_mci, witness_list_unit => {
							const objFakeUnit = {parent_units: arrTrimmedParentUnits};
							if (witness_list_unit)
								objFakeUnit.witness_list_unit = witness_list_unit;
							storage.determineIfHasWitnessListMutationsAlongMc(conn, objFakeUnit, last_stable_unit, arrWitnesses, err => {
								if (err)
									return onDone(err); // if first arg is not array, it is error
								onDone(null, arrTrimmedParentUnits, last_stable_ball, last_stable_unit, last_stable_mci);
							});
						});
					});
				}
			);
		});
	});
}

exports.pickParentUnitsAndLastBall = pickParentUnitsAndLastBall;
