/*jslint node: true */
const async = require('async');
const storage = require('./storage.js');
const objectHash = require("./object_hash.js");
const db = require('./db.js');
const mutex = require('./mutex.js');
const constants = require("./constants.js");
const graph = require('./graph.js');
const writer = require('./writer.js');
const validation = require('./validation.js');
const witnessProof = require('./witness_proof.js');
const ValidationUtils = require("./validation_utils.js");
const parentComposer = require('./parent_composer.js');
const breadcrumbs = require('./breadcrumbs.js');
const eventBus = require('./event_bus.js');

const MAX_HISTORY_ITEMS = 1000;

// unit's MC index is earlier_mci
function buildProofChain(later_mci, earlier_mci, unit, arrBalls, onDone){
	if (earlier_mci === null)
		throw Error(`earlier_mci=null, unit=${unit}`);
	if (later_mci === earlier_mci)
		return buildLastMileOfProofChain(earlier_mci, unit, arrBalls, onDone);
	buildProofChainOnMc(later_mci, earlier_mci, arrBalls, () => {
		buildLastMileOfProofChain(earlier_mci, unit, arrBalls, onDone);
	});
}

// later_mci is already known and not included in the chain
function buildProofChainOnMc(later_mci, earlier_mci, arrBalls, onDone){
	
	function addBall(mci){
		if (mci < 0)
			throw Error(`mci<0, later_mci=${later_mci}, earlier_mci=${earlier_mci}`);
		db.query("SELECT unit, ball, content_hash FROM units JOIN balls USING(unit) WHERE main_chain_index=? AND is_on_main_chain=1", [mci], rows => {
			if (rows.length !== 1)
				throw Error(`no prev chain element? mci=${mci}, later_mci=${later_mci}, earlier_mci=${earlier_mci}`);
			const objBall = rows[0];
			if (objBall.content_hash)
				objBall.is_nonserial = true;
			delete objBall.content_hash;
			db.query(
				"SELECT ball FROM parenthoods LEFT JOIN balls ON parent_unit=balls.unit WHERE child_unit=? ORDER BY ball", 
				[objBall.unit],
				parent_rows => {
					if (parent_rows.some(({ball}) => !ball))
						throw Error("some parents have no balls");
					if (parent_rows.length > 0)
						objBall.parent_balls = parent_rows.map(({ball}) => ball);
					db.query(
						"SELECT ball, main_chain_index \n\
						FROM skiplist_units JOIN units ON skiplist_unit=units.unit LEFT JOIN balls ON units.unit=balls.unit \n\
						WHERE skiplist_units.unit=? ORDER BY ball", 
						[objBall.unit],
						srows => {
							if (srows.some(({ball}) => !ball))
								throw Error("some skiplist units have no balls");
							if (srows.length > 0)
								objBall.skiplist_balls = srows.map(({ball}) => ball);
							arrBalls.push(objBall);
							if (mci === earlier_mci)
								return onDone();
							if (srows.length === 0) // no skiplist
								return addBall(mci-1);
							let next_mci = mci - 1;
							for (let i=0; i<srows.length; i++){
								const next_skiplist_mci = srows[i].main_chain_index;
								if (next_skiplist_mci < next_mci && next_skiplist_mci >= earlier_mci)
									next_mci = next_skiplist_mci;
							}
							addBall(next_mci);
						}
					);
				}
			);
		});
	}
	
	if (earlier_mci > later_mci)
		throw Error("earlier > later");
	if (earlier_mci === later_mci)
		return onDone();
	addBall(later_mci - 1);
}

// unit's MC index is mci, find a path from mci unit to this unit
function buildLastMileOfProofChain(mci, unit, arrBalls, onDone){
	function addBall(_unit){
		db.query("SELECT unit, ball, content_hash FROM units JOIN balls USING(unit) WHERE unit=?", [_unit], rows => {
			if (rows.length !== 1)
				throw Error("no unit?");
			const objBall = rows[0];
			if (objBall.content_hash)
				objBall.is_nonserial = true;
			delete objBall.content_hash;
			db.query(
				"SELECT ball FROM parenthoods LEFT JOIN balls ON parent_unit=balls.unit WHERE child_unit=? ORDER BY ball", 
				[objBall.unit],
				parent_rows => {
					if (parent_rows.some(({ball}) => !ball))
						throw Error("some parents have no balls");
					if (parent_rows.length > 0)
						objBall.parent_balls = parent_rows.map(({ball}) => ball);
					db.query(
						"SELECT ball \n\
						FROM skiplist_units JOIN units ON skiplist_unit=units.unit LEFT JOIN balls ON units.unit=balls.unit \n\
						WHERE skiplist_units.unit=? ORDER BY ball", 
						[objBall.unit],
						srows => {
							if (srows.some(({ball}) => !ball))
								throw Error("last mile: some skiplist units have no balls");
							if (srows.length > 0)
								objBall.skiplist_balls = srows.map(({ball}) => ball);
							arrBalls.push(objBall);
							if (_unit === unit)
								return onDone();
							findParent(_unit);
						}
					);
				}
			);
		});
	}
	
	function findParent(interim_unit){
		db.query(
			"SELECT parent_unit FROM parenthoods JOIN units ON parent_unit=unit WHERE child_unit=? AND main_chain_index=?", 
			[interim_unit, mci],
			parent_rows => {
				const arrParents = parent_rows.map(({parent_unit}) => parent_unit);
				if (arrParents.indexOf(unit) >= 0)
					return addBall(unit);
				async.eachSeries(
					arrParents,
					(parent_unit, cb) => {
						graph.determineIfIncluded(db, unit, [parent_unit], bIncluded => {
							bIncluded ? cb(parent_unit) : cb();
						});
					},
					parent_unit => {
						if (!parent_unit)
							throw Error("no parent that includes target unit");
						addBall(parent_unit);
					}
				)
			}
		);
	}
	
	// start from MC unit and go back in history
	db.query("SELECT unit FROM units WHERE main_chain_index=? AND is_on_main_chain=1", [mci], rows => {
		if (rows.length !== 1)
			throw Error("no mc unit?");
		const mc_unit = rows[0].unit;
		if (mc_unit === unit)
			return onDone();
		findParent(mc_unit);
	});
}



function prepareHistory(historyRequest, callbacks){
	if (!historyRequest)
		return callbacks.ifError("no history request");
	const arrKnownStableUnits = historyRequest.known_stable_units;
	const arrWitnesses = historyRequest.witnesses;
	const arrAddresses = historyRequest.addresses;
	const arrRequestedJoints = historyRequest.requested_joints;

	if (!arrAddresses && !arrRequestedJoints)
		return callbacks.ifError("neither addresses nor joints requested");
	if (arrAddresses){
		if (!ValidationUtils.isNonemptyArray(arrAddresses))
			return callbacks.ifError("no addresses");
		if (arrKnownStableUnits && !ValidationUtils.isNonemptyArray(arrKnownStableUnits))
			return callbacks.ifError("known_stable_units must be non-empty array");
	}
	if (arrRequestedJoints && !ValidationUtils.isNonemptyArray(arrRequestedJoints))
		return callbacks.ifError("no requested joints");
	if (!ValidationUtils.isArrayOfLength(arrWitnesses, constants.COUNT_WITNESSES))
		return callbacks.ifError("wrong number of witnesses");
		
	const assocKnownStableUnits = {};
	if (arrKnownStableUnits)
		arrKnownStableUnits.forEach(unit => {
			assocKnownStableUnits[unit] = true;
		});
	
	const objResponse = {};

	// add my joints and proofchain to these joints
	let arrSelects = [];
	if (arrAddresses){
		// we don't filter sequence='good' after the unit is stable, so the client will see final doublespends too
		const strAddressList = arrAddresses.map(db.escape).join(', ');
		arrSelects = [`SELECT DISTINCT unit, main_chain_index, level FROM outputs JOIN units USING(unit) \n\
            WHERE address IN(${strAddressList}) AND (+sequence='good' OR is_stable=1) \n\
            UNION \n\
            SELECT DISTINCT unit, main_chain_index, level FROM unit_authors JOIN units USING(unit) \n\
            WHERE address IN(${strAddressList}) AND (+sequence='good' OR is_stable=1) \n`];
	}
	if (arrRequestedJoints){
		const strUnitList = arrRequestedJoints.map(db.escape).join(', ');
		arrSelects.push(`SELECT unit, main_chain_index, level FROM units WHERE unit IN(${strUnitList}) AND (+sequence='good' OR is_stable=1) \n`);
	}
	const sql = `${arrSelects.join("UNION \n")}ORDER BY main_chain_index DESC, level DESC`;
	db.query(sql, rows => {
		// if no matching units, don't build witness proofs
		rows = rows.filter(({unit}) => !assocKnownStableUnits[unit]);
		if (rows.length === 0)
			return callbacks.ifOk(objResponse);
		if (rows.length > MAX_HISTORY_ITEMS)
			return callbacks.ifError("your history is too large, consider switching to a full client");

		mutex.lock(['prepareHistory'], unlock => {
			const start_ts = Date.now();
			witnessProof.prepareWitnessProof(
				arrWitnesses, 0, 
				(
                    err,
                    arrUnstableMcJoints,
                    arrWitnessChangeAndDefinitionJoints,
                    last_ball_unit,
                    last_ball_mci
                ) => {
					if (err){
						callbacks.ifError(err);
						return unlock();
					}
					objResponse.unstable_mc_joints = arrUnstableMcJoints;
					if (arrWitnessChangeAndDefinitionJoints.length > 0)
						objResponse.witness_change_and_definition_joints = arrWitnessChangeAndDefinitionJoints;

					// add my joints and proofchain to those joints
					objResponse.joints = [];
					objResponse.proofchain_balls = [];
					let later_mci = last_ball_mci+1; // +1 so that last ball itself is included in the chain
					async.eachSeries(
						rows,
						({unit, main_chain_index}, cb2) => {
							storage.readJoint(db, unit, {
								ifNotFound() {
									throw Error(`prepareJointsWithProofs unit not found ${unit}`);
								},
								ifFound(objJoint) {
									objResponse.joints.push(objJoint);
									if (main_chain_index > last_ball_mci || main_chain_index === null) // unconfirmed, no proofchain
										return cb2();
									buildProofChain(later_mci, main_chain_index, unit, objResponse.proofchain_balls, () => {
										later_mci = main_chain_index;
										cb2();
									});
								}
							});
						},
						() => {
							//if (objResponse.joints.length > 0 && objResponse.proofchain_balls.length === 0)
							//    throw "no proofs";
							if (objResponse.proofchain_balls.length === 0)
								delete objResponse.proofchain_balls;
							callbacks.ifOk(objResponse);
							console.log(`prepareHistory for addresses ${(arrAddresses || []).join(', ')} and joints ${(arrRequestedJoints || []).join(', ')} took ${Date.now()-start_ts}ms`);
							unlock();
						}
					);
				}
			);
		});
	});
}


function processHistory(objResponse, callbacks){
	if (!("joints" in objResponse)) // nothing found
		return callbacks.ifOk(false);
	if (!ValidationUtils.isNonemptyArray(objResponse.unstable_mc_joints))
		return callbacks.ifError("no unstable_mc_joints");
	if (!objResponse.witness_change_and_definition_joints)
		objResponse.witness_change_and_definition_joints = [];
	if (!Array.isArray(objResponse.witness_change_and_definition_joints))
		return callbacks.ifError("witness_change_and_definition_joints must be array");
	if (!ValidationUtils.isNonemptyArray(objResponse.joints))
		return callbacks.ifError("no joints");
	if (!objResponse.proofchain_balls)
		objResponse.proofchain_balls = [];

	witnessProof.processWitnessProof(
		objResponse.unstable_mc_joints, objResponse.witness_change_and_definition_joints, false, 
		(err, arrLastBallUnits, assocLastBallByLastBallUnit) => {
			
			if (err)
				return callbacks.ifError(err);
			
			let assocKnownBalls = {};
			for (const unit in assocLastBallByLastBallUnit){
				const ball = assocLastBallByLastBallUnit[unit];
				assocKnownBalls[ball] = true;
			}
		
			// proofchain
			const assocProvenUnitsNonserialness = {};
			for (var i=0; i<objResponse.proofchain_balls.length; i++){
				const objBall = objResponse.proofchain_balls[i];
				if (objBall.ball !== objectHash.getBallHash(objBall.unit, objBall.parent_balls, objBall.skiplist_balls, objBall.is_nonserial))
					return callbacks.ifError(`wrong ball hash: unit ${objBall.unit}, ball ${objBall.ball}`);
				if (!assocKnownBalls[objBall.ball])
					return callbacks.ifError(`ball not known: ${objBall.ball}`);
				objBall.parent_balls.forEach(parent_ball => {
					assocKnownBalls[parent_ball] = true;
				});
				if (objBall.skiplist_balls)
					objBall.skiplist_balls.forEach(skiplist_ball => {
						assocKnownBalls[skiplist_ball] = true;
					});
				assocProvenUnitsNonserialness[objBall.unit] = objBall.is_nonserial;
			}
			assocKnownBalls = null; // free memory

			// joints that pay to/from me and joints that I explicitly requested
			for (var i=0; i<objResponse.joints.length; i++){
				const objJoint = objResponse.joints[i];
				const objUnit = objJoint.unit;
				//if (!objJoint.ball)
				//    return callbacks.ifError("stable but no ball");
				if (!validation.hasValidHashes(objJoint))
					return callbacks.ifError("invalid hash");
				if (!ValidationUtils.isPositiveInteger(objUnit.timestamp))
					return callbacks.ifError("no timestamp");
				// we receive unconfirmed units too
				//if (!assocProvenUnitsNonserialness[objUnit.unit])
				//    return callbacks.ifError("proofchain doesn't prove unit "+objUnit.unit);
			}

			// save joints that pay to/from me and joints that I explicitly requested
			mutex.lock(["light_joints"], unlock => {
				const arrUnits = objResponse.joints.map(({unit}) => unit.unit);
				breadcrumbs.add(`got light_joints for processHistory ${arrUnits.join(', ')}`);
				db.query(`SELECT unit, is_stable FROM units WHERE unit IN(${arrUnits.map(db.escape).join(', ')})`, rows => {
					const assocExistingUnits = {};
					rows.forEach(({unit}) => {
						assocExistingUnits[unit] = true;
					});
					let arrProvenUnits = [];
					async.eachSeries(
						objResponse.joints.reverse(), // have them in forward chronological order so that we correctly mark is_spent flag
						(objJoint, cb2) => {
							const objUnit = objJoint.unit;
							const unit = objUnit.unit;
							// assocProvenUnitsNonserialness[unit] is true for non-serials, false for serials, undefined for unstable
							const sequence = assocProvenUnitsNonserialness[unit] ? 'final-bad' : 'good';
							if (unit in assocProvenUnitsNonserialness)
								arrProvenUnits.push(unit);
							if (assocExistingUnits[unit]){
								//if (!assocProvenUnitsNonserialness[objUnit.unit]) // not stable yet
								//    return cb2();
								// it can be null!
								//if (!ValidationUtils.isNonnegativeInteger(objUnit.main_chain_index))
								//    return cb2("bad main_chain_index in proven unit");
								db.query(
									"UPDATE units SET main_chain_index=?, sequence=? WHERE unit=?", 
									[objUnit.main_chain_index, sequence, unit], 
									() => {
										cb2();
									}
								);
							}
							else
								writer.saveJoint(objJoint, {sequence, arrDoubleSpendInputs: [], arrAdditionalQueries: []}, null, cb2);
						},
						err => {
							breadcrumbs.add('processHistory almost done');
							if (err){
								unlock();
								return callbacks.ifError(err);
							}
							fixIsSpentFlagAndInputAddress(() => {
								if (arrProvenUnits.length === 0){
									unlock();
									return callbacks.ifOk(true);
								}
								db.query("UPDATE units SET is_stable=1, is_free=0 WHERE unit IN(?)", [arrProvenUnits], () => {
									unlock();
									arrProvenUnits = arrProvenUnits.filter(unit => !assocProvenUnitsNonserialness[unit]);
									if (arrProvenUnits.length === 0)
										return callbacks.ifOk(true);
									emitStability(arrProvenUnits, bEmitted => {
										callbacks.ifOk(!bEmitted);
									});
								});
							});
						}
					);
				});
			});

		}
	);

}

// fixes is_spent in case units were received out of order
function fixIsSpentFlag(onDone){
	db.query(
		"SELECT outputs.unit, outputs.message_index, outputs.output_index \n\
		FROM outputs \n\
		JOIN inputs ON outputs.unit=inputs.src_unit AND outputs.message_index=inputs.src_message_index AND outputs.output_index=inputs.src_output_index \n\
		WHERE is_spent=0 AND type='transfer'",
		rows => {
			console.log(`${rows.length} previous outputs appear to be spent`);
			if (rows.length === 0)
				return onDone();
			const arrQueries = [];
			rows.forEach(row => {
				console.log('fixing is_spent for output', row);
				db.addQuery(arrQueries, 
					"UPDATE outputs SET is_spent=1 WHERE unit=? AND message_index=? AND output_index=?", [row.unit, row.message_index, row.output_index]);
			});
			async.series(arrQueries, onDone);
		}
	);
}

function fixInputAddress(onDone){
	db.query(
		"SELECT outputs.unit, outputs.message_index, outputs.output_index, outputs.address \n\
		FROM outputs \n\
		JOIN inputs ON outputs.unit=inputs.src_unit AND outputs.message_index=inputs.src_message_index AND outputs.output_index=inputs.src_output_index \n\
		WHERE inputs.address IS NULL AND type='transfer'",
		rows => {
			console.log(`${rows.length} previous inputs appear to be without address`);
			if (rows.length === 0)
				return onDone();
			const arrQueries = [];
			rows.forEach(row => {
				console.log('fixing input address for output', row);
				db.addQuery(arrQueries, 
					"UPDATE inputs SET address=? WHERE src_unit=? AND src_message_index=? AND src_output_index=?", 
					[row.address, row.unit, row.message_index, row.output_index]);
			});
			async.series(arrQueries, onDone);
		}
	);
}

function fixIsSpentFlagAndInputAddress(onDone){
	fixIsSpentFlag(() => {
		fixInputAddress(onDone);
	});
}

function determineIfHaveUnstableJoints(arrAddresses, handleResult){
	if (arrAddresses.length === 0)
		return handleResult(false);
	db.query(
		"SELECT DISTINCT unit, main_chain_index FROM outputs JOIN units USING(unit) \n\
		WHERE address IN(?) AND +sequence='good' AND is_stable=0 \n\
		UNION \n\
		SELECT DISTINCT unit, main_chain_index FROM unit_authors JOIN units USING(unit) \n\
		WHERE address IN(?) AND +sequence='good' AND is_stable=0 \n\
		LIMIT 1",
		[arrAddresses, arrAddresses],
		({length}) => {
			handleResult(length > 0);
		}
	);
}

function emitStability(arrProvenUnits, onDone){
	const strUnitList = arrProvenUnits.map(db.escape).join(', ');
	db.query(
		`SELECT unit FROM unit_authors JOIN my_addresses USING(address) WHERE unit IN(${strUnitList}) \n\
        UNION \n\
        SELECT unit FROM outputs JOIN my_addresses USING(address) WHERE unit IN(${strUnitList}) \n\
        UNION \n\
        SELECT unit FROM unit_authors JOIN shared_addresses ON address=shared_address WHERE unit IN(${strUnitList}) \n\
        UNION \n\
        SELECT unit FROM outputs JOIN shared_addresses ON address=shared_address WHERE unit IN(${strUnitList})`,
		rows => {
			onDone(rows.length > 0);
			if (rows.length > 0){
				eventBus.emit('my_transactions_became_stable', rows.map(({unit}) => unit));
				rows.forEach(({unit}) => {
					eventBus.emit(`my_stable-${unit}`);
				});
			}
		}
	);
}


function prepareParentsAndLastBallAndWitnessListUnit(arrWitnesses, callbacks){
	if (!ValidationUtils.isArrayOfLength(arrWitnesses, constants.COUNT_WITNESSES))
		return callbacks.ifError("wrong number of witnesses");
	storage.determineIfWitnessAddressDefinitionsHaveReferences(db, arrWitnesses, bWithReferences => {
		if (bWithReferences)
			return callbacks.ifError("some witnesses have references in their addresses");
		parentComposer.pickParentUnitsAndLastBall(
			db, 
			arrWitnesses, 
			(
                err,
                arrParentUnits,
                last_stable_mc_ball,
                last_stable_mc_ball_unit,
                last_stable_mc_ball_mci
            ) => {
				if (err)
					return callbacks.ifError(`unable to find parents: ${err}`);
				const objResponse = {
					parent_units: arrParentUnits,
					last_stable_mc_ball,
					last_stable_mc_ball_unit,
					last_stable_mc_ball_mci
				};
				storage.findWitnessListUnit(db, arrWitnesses, last_stable_mc_ball_mci, witness_list_unit => {
					if (witness_list_unit)
						objResponse.witness_list_unit = witness_list_unit;
					callbacks.ifOk(objResponse);
				});
			}
		);
	});
}

// arrUnits sorted in reverse chronological order
function prepareLinkProofs(arrUnits, callbacks){
	if (!ValidationUtils.isNonemptyArray(arrUnits))
		return callbacks.ifError("no units array");
	if (arrUnits.length === 1)
		return callbacks.ifError("chain of one element");
	mutex.lock(['prepareLinkProofs'], unlock => {
		const start_ts = Date.now();
		const arrChain = [];
		async.forEachOfSeries(
			arrUnits,
			(unit, i, cb) => {
				if (i === 0)
					return cb();
				createLinkProof(arrUnits[i-1], arrUnits[i], arrChain, cb);
			},
			err => {
				console.log(`prepareLinkProofs for units ${arrUnits.join(', ')} took ${Date.now()-start_ts}ms, err=${err}`);
				err ? callbacks.ifError(err) : callbacks.ifOk(arrChain);
				unlock();
			}
		);
	});
}

// adds later unit
// earlier unit is not included in the chain
function createLinkProof(later_unit, earlier_unit, arrChain, cb){
	storage.readJoint(db, later_unit, {
		ifNotFound() {
			cb("later unit not found");
		},
		ifFound(objLaterJoint) {
			const later_mci = objLaterJoint.unit.main_chain_index;
			arrChain.push(objLaterJoint);
			storage.readUnitProps(db, objLaterJoint.unit.last_ball_unit, ({main_chain_index}) => {
				const later_lb_mci = main_chain_index;
				storage.readJoint(db, earlier_unit, {
					ifNotFound() {
						cb("earlier unit not found");
					},
					ifFound(objEarlierJoint) {
						const earlier_mci = objEarlierJoint.unit.main_chain_index;
						const earlier_unit = objEarlierJoint.unit.unit;
						if (later_mci < earlier_mci)
							return cb("not included");
						if (later_lb_mci >= earlier_mci){ // was spent when confirmed
							// includes the ball of earlier unit
							buildProofChain(later_lb_mci + 1, earlier_mci, earlier_unit, arrChain, () => {
								cb();
							});
						}
						else{ // the output was unconfirmed when spent
							graph.determineIfIncluded(db, earlier_unit, [later_unit], bIncluded => {
								if (!bIncluded)
									return cb("not included");
								buildPath(objLaterJoint, objEarlierJoint, arrChain, () => {
									cb();
								});
							});
						}
					}
				});
			});
		}
	});
}

// build parent path from later unit to earlier unit and add all joints along the path into arrChain
// arrChain will include later unit but not include earlier unit
// assuming arrChain already includes later unit
function buildPath(objLaterJoint, objEarlierJoint, arrChain, onDone){
	
	function addJoint(unit, onAdded){
	   storage.readJoint(db, unit, {
			ifNotFound() {
				throw Error("unit not found?");
			},
			ifFound(objJoint) {
				arrChain.push(objJoint);
				onAdded(objJoint);
			}
		});
	 }
	
	function goUp(objChildJoint){
		db.query(
			"SELECT parent.unit, parent.main_chain_index FROM units AS child JOIN units AS parent ON child.best_parent_unit=parent.unit \n\
			WHERE child.unit=?", 
			[objChildJoint.unit.unit],
			rows => {
				if (rows.length !== 1)
					throw Error("goUp not 1 parent");
				if (rows[0].main_chain_index < objEarlierJoint.unit.main_chain_index) // jumped over the target
					return buildPathToEarlierUnit(objChildJoint);
				addJoint(rows[0].unit, objJoint => {
					(objJoint.unit.main_chain_index === objEarlierJoint.unit.main_chain_index) ? buildPathToEarlierUnit(objJoint) : goUp(objJoint);
				});
			}
		);
	}
	
	function buildPathToEarlierUnit({unit}) {
		db.query(
			"SELECT unit FROM parenthoods JOIN units ON parent_unit=unit \n\
			WHERE child_unit=? AND main_chain_index=?", 
			[unit.unit, unit.main_chain_index],
			rows => {
				if (rows.length === 0)
					throw Error("no parents with same mci?");
				const arrParentUnits = rows.map(({unit}) => unit);
				if (arrParentUnits.indexOf(objEarlierJoint.unit.unit) >= 0)
					return onDone();
				if (arrParentUnits.length === 1)
					return addJoint(arrParentUnits[0], buildPathToEarlierUnit);
				// find any parent that includes earlier unit
				async.eachSeries(
					arrParentUnits,
					(unit, cb) => {
						graph.determineIfIncluded(db, objEarlierJoint.unit.unit, [unit], bIncluded => {
							if (!bIncluded)
								return cb(); // try next
							cb(unit); // abort the eachSeries
						});
					},
					unit => {
						if (!unit)
							throw Error("none of the parents includes earlier unit");
						addJoint(unit, buildPathToEarlierUnit);
					}
				);
			}
		);
	}
	
	if (objLaterJoint.unit.unit === objEarlierJoint.unit.unit)
		return onDone();
	(objLaterJoint.unit.main_chain_index === objEarlierJoint.unit.main_chain_index) ? buildPathToEarlierUnit(objLaterJoint) : goUp(objLaterJoint);
}

function processLinkProofs(arrUnits, arrChain, callbacks){
	// check first element
	const objFirstJoint = arrChain[0];
	if (!objFirstJoint || !objFirstJoint.unit || objFirstJoint.unit.unit !== arrUnits[0])
		return callbacks.ifError("unexpected 1st element");
	const assocKnownUnits = {};
	const assocKnownBalls = {};
	assocKnownUnits[arrUnits[0]] = true;
	for (var i=0; i<arrChain.length; i++){
		const objElement = arrChain[i];
		if (objElement.unit && objElement.unit.unit){
			const objJoint = objElement;
			const objUnit = objJoint.unit;
			const unit = objUnit.unit;
			if (!assocKnownUnits[unit])
				return callbacks.ifError(`unknown unit ${unit}`);
			if (!validation.hasValidHashes(objJoint))
				return callbacks.ifError(`invalid hash of unit ${unit}`);
			assocKnownBalls[objUnit.last_ball] = true;
			assocKnownUnits[objUnit.last_ball_unit] = true;
			objUnit.parent_units.forEach(parent_unit => {
				assocKnownUnits[parent_unit] = true;
			});
		}
		else if (objElement.unit && objElement.ball){
			const objBall = objElement;
			if (!assocKnownBalls[objBall.ball])
				return callbacks.ifError(`unknown ball ${objBall.ball}`);
			if (objBall.ball !== objectHash.getBallHash(objBall.unit, objBall.parent_balls, objBall.skiplist_balls, objBall.is_nonserial))
				return callbacks.ifError("invalid ball hash");
			objBall.parent_balls.forEach(parent_ball => {
				assocKnownBalls[parent_ball] = true;
			});
			if (objBall.skiplist_balls)
				objBall.skiplist_balls.forEach(skiplist_ball => {
					assocKnownBalls[skiplist_ball] = true;
				});
			assocKnownUnits[objBall.unit] = true;
		}
		else
			return callbacks.ifError("unrecognized chain element");
	}
	// so, the chain is valid, now check that we can find the requested units in the chain
	for (var i=1; i<arrUnits.length; i++) // skipped first unit which was already checked
		if (!assocKnownUnits[arrUnits[i]])
			return callbacks.ifError(`unit ${arrUnits[i]} not found in the chain`);
	callbacks.ifOk();
}

exports.prepareHistory = prepareHistory;
exports.processHistory = processHistory;
exports.prepareLinkProofs = prepareLinkProofs;
exports.processLinkProofs = processLinkProofs;
exports.determineIfHaveUnstableJoints = determineIfHaveUnstableJoints;
exports.prepareParentsAndLastBallAndWitnessListUnit = prepareParentsAndLastBallAndWitnessListUnit;


