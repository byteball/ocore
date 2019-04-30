/*jslint node: true */
"use strict";
var _ = require('lodash');
var async = require('async');
var storage = require('./storage.js');
var graph = require('./graph.js');
var main_chain = require('./main_chain.js');
var paid_witnessing = require("./paid_witnessing.js");
var headers_commission = require("./headers_commission.js");
var mc_outputs = require("./mc_outputs.js");
var objectHash = require("./object_hash.js");
var objectLength = require("./object_length.js");
var db = require('./db.js');
var chash = require('./chash.js');
var mutex = require('./mutex.js');
var constants = require("./constants.js");
var ValidationUtils = require("./validation_utils.js");
var Definition = require("./definition.js");
var conf = require('./conf.js');
var profiler = require('./profiler.js');
var breadcrumbs = require('./breadcrumbs.js');

var MAX_INT32 = Math.pow(2, 31) - 1;

var hasFieldsExcept = ValidationUtils.hasFieldsExcept;
var isNonemptyString = ValidationUtils.isNonemptyString;
var isStringOfLength = ValidationUtils.isStringOfLength;
var isInteger = ValidationUtils.isInteger;
var isNonnegativeInteger = ValidationUtils.isNonnegativeInteger;
var isPositiveInteger = ValidationUtils.isPositiveInteger;
var isNonemptyArray = ValidationUtils.isNonemptyArray;
var isValidAddress = ValidationUtils.isValidAddress;
var isValidBase64 = ValidationUtils.isValidBase64;

var assocWitnessListMci = {};

function hasValidHashes(objJoint){
	var objUnit = objJoint.unit;
	try {
		if (objectHash.getUnitHash(objUnit) !== objUnit.unit)
			return false;
	}
	catch(e){
		console.log("failed to calc unit hash: "+e);
		return false;
	}
	return true;
}

function validate(objJoint, callbacks) {
	
	var objUnit = objJoint.unit;
	if (typeof objUnit !== "object" || objUnit === null)
		throw Error("no unit object");
	if (!objUnit.unit)
		throw Error("no unit");
	
	console.log("\nvalidating joint identified by unit "+objJoint.unit.unit);
	
	if (!isStringOfLength(objUnit.unit, constants.HASH_LENGTH))
		return callbacks.ifJointError("wrong unit length");
	
	try{
		// UnitError is linked to objUnit.unit, so we need to ensure objUnit.unit is true before we throw any UnitErrors
		if (objectHash.getUnitHash(objUnit) !== objUnit.unit)
			return callbacks.ifJointError("wrong unit hash: "+objectHash.getUnitHash(objUnit)+" != "+objUnit.unit);
	}
	catch(e){
		return callbacks.ifJointError("failed to calc unit hash: "+e);
	}
	
	if (objJoint.unsigned){
		if (hasFieldsExcept(objJoint, ["unit", "unsigned"]))
			return callbacks.ifJointError("unknown fields in unsigned unit-joint");
	}
	else if ("ball" in objJoint){
		if (!isStringOfLength(objJoint.ball, constants.HASH_LENGTH))
			return callbacks.ifJointError("wrong ball length");
		if (hasFieldsExcept(objJoint, ["unit", "ball", "skiplist_units"]))
			return callbacks.ifJointError("unknown fields in ball-joint");
		if ("skiplist_units" in objJoint){
			if (!isNonemptyArray(objJoint.skiplist_units))
				return callbacks.ifJointError("missing or empty skiplist array");
			//if (objUnit.unit.charAt(0) !== "0")
			//    return callbacks.ifJointError("found skiplist while unit doesn't start with 0");
		}
	}
	else{
		if (hasFieldsExcept(objJoint, ["unit"]))
			return callbacks.ifJointError("unknown fields in unit-joint");
	}
	
	if ("content_hash" in objUnit){ // nonserial and stripped off content
		if (!isStringOfLength(objUnit.content_hash, constants.HASH_LENGTH))
			return callbacks.ifUnitError("wrong content_hash length");
		if (hasFieldsExcept(objUnit, ["unit", "version", "alt", "timestamp", "authors", "witness_list_unit", "witnesses", "content_hash", "parent_units", "last_ball", "last_ball_unit"]))
			return callbacks.ifUnitError("unknown fields in nonserial unit");
		if (!objJoint.ball)
			return callbacks.ifJointError("content_hash allowed only in finished ball");
	}
	else{ // serial
		if (hasFieldsExcept(objUnit, ["unit", "version", "alt", "timestamp", "authors", "messages", "witness_list_unit", "witnesses", "earned_headers_commission_recipients", "last_ball", "last_ball_unit", "parent_units", "headers_commission", "payload_commission"]))
			return callbacks.ifUnitError("unknown fields in unit");

		if (typeof objUnit.headers_commission !== "number")
			return callbacks.ifJointError("no headers_commission");
		if (typeof objUnit.payload_commission !== "number")
			return callbacks.ifJointError("no payload_commission");
		
		if (!isNonemptyArray(objUnit.messages))
			return callbacks.ifUnitError("missing or empty messages array");
		if (objUnit.messages.length > constants.MAX_MESSAGES_PER_UNIT)
			return callbacks.ifUnitError("too many messages");

		if (objectLength.getHeadersSize(objUnit) !== objUnit.headers_commission)
			return callbacks.ifJointError("wrong headers commission, expected "+objectLength.getHeadersSize(objUnit));
		if (objectLength.getTotalPayloadSize(objUnit) !== objUnit.payload_commission)
			return callbacks.ifJointError("wrong payload commission, unit "+objUnit.unit+", calculated "+objectLength.getTotalPayloadSize(objUnit)+", expected "+objUnit.payload_commission);
		if (objUnit.headers_commission + objUnit.payload_commission > constants.MAX_UNIT_LENGTH)
			return callbacks.ifUnitError("unit too large");
	}
	
	if (!isNonemptyArray(objUnit.authors))
		return callbacks.ifUnitError("missing or empty authors array");
	

	if (constants.supported_versions.indexOf(objUnit.version) === -1)
		return callbacks.ifUnitError("wrong version");
	if (objUnit.alt !== constants.alt)
		return callbacks.ifUnitError("wrong alt");

	if (objUnit.version !== constants.versionWithoutTimestamp) {
		if (!isPositiveInteger(objUnit.timestamp))
			return callbacks.ifUnitError("timestamp required in version " + objUnit.version);
		var current_ts = Math.round(Date.now() / 1000);
		var max_seconds_into_the_future_to_accept = conf.max_seconds_into_the_future_to_accept || 3600;
		if (objUnit.timestamp > current_ts + max_seconds_into_the_future_to_accept)
			return callbacks.ifTransientError("timestamp is too far into the future");
	}

	if (!storage.isGenesisUnit(objUnit.unit)){
		if (!isNonemptyArray(objUnit.parent_units))
			return callbacks.ifUnitError("missing or empty parent units array");
		
		if (!isStringOfLength(objUnit.last_ball, constants.HASH_LENGTH))
			return callbacks.ifUnitError("wrong length of last ball");
		if (!isStringOfLength(objUnit.last_ball_unit, constants.HASH_LENGTH))
			return callbacks.ifUnitError("wrong length of last ball unit");
	}
	
	
	if ("witness_list_unit" in objUnit && "witnesses" in objUnit)
		return callbacks.ifUnitError("ambiguous witnesses");
		
	var arrAuthorAddresses = objUnit.authors ? objUnit.authors.map(function(author) { return author.address; } ) : [];
	
	var objValidationState = {
		arrAdditionalQueries: [],
		arrDoubleSpendInputs: [],
		arrInputKeys: []
	};
	if (objJoint.unsigned)
		objValidationState.bUnsigned = true;
	
	if (conf.bLight){
		if (!isPositiveInteger(objUnit.timestamp) && !objJoint.unsigned)
			return callbacks.ifJointError("bad timestamp");
		if (objJoint.ball)
			return callbacks.ifJointError("I'm light, can't accept stable unit "+objUnit.unit+" without proof");
		return objJoint.unsigned 
			? callbacks.ifOkUnsigned(true) 
			: callbacks.ifOk({sequence: 'good', arrDoubleSpendInputs: [], arrAdditionalQueries: []}, function(){});
	}
	else{
		if ("timestamp" in objUnit && !isPositiveInteger(objUnit.timestamp))
			return callbacks.ifJointError("bad timestamp");
	}
	
	mutex.lock(arrAuthorAddresses, function(unlock){
		
		var conn = null;
		var start_time = null;

		async.series(
			[
				function(cb){
					db.takeConnectionFromPool(function(new_conn){
						conn = new_conn;
						start_time = Date.now();
						conn.query("BEGIN", function(){cb();});
					});
				},
				function(cb){
					profiler.start();
					checkDuplicate(conn, objUnit.unit, cb);
				},
				function(cb){
					profiler.stop('validation-checkDuplicate');
					profiler.start();
					objUnit.content_hash ? cb() : validateHeadersCommissionRecipients(objUnit, cb);
				},
				function(cb){
					profiler.stop('validation-hc-recipients');
					profiler.start();
					!objUnit.parent_units
						? cb()
						: validateHashTreeBall(conn, objJoint, cb);
				},
				function(cb){
					profiler.stop('validation-hash-tree-ball');
					profiler.start();
					!objUnit.parent_units
						? cb()
						: validateParentsExistAndOrdered(conn, objUnit, cb);
				},
				function(cb){
					profiler.stop('validation-parents-exist');
					profiler.start();
					!objUnit.parent_units
						? cb()
						: validateHashTreeParentsAndSkiplist(conn, objJoint, cb);
				},
				function(cb){
					profiler.stop('validation-hash-tree-parents');
				//	profiler.start(); // conflicting with profiling in determineIfStableInLaterUnitsAndUpdateStableMcFlag
					!objUnit.parent_units
						? cb()
						: validateParents(conn, objJoint, objValidationState, cb);
				},
				function(cb){
				//	profiler.stop('validation-parents');
					profiler.start();
					!objJoint.skiplist_units
						? cb()
						: validateSkiplist(conn, objJoint.skiplist_units, cb);
				},
				function(cb){
					profiler.stop('validation-skiplist');
					validateWitnesses(conn, objUnit, objValidationState, cb);
				},
				function(cb){
					profiler.start();
					validateAuthors(conn, objUnit.authors, objUnit, objValidationState, cb);
				},
				function(cb){
					profiler.stop('validation-authors');
					profiler.start();
					objUnit.content_hash ? cb() : validateMessages(conn, objUnit.messages, objUnit, objValidationState, cb);
				}
			], 
			function(err){
				if(err){
					profiler.stop('validation-advanced-stability');
					// We might have advanced the stability point and have to commit the changes as the caches are already updated.
					// There are no other updates/inserts/deletes during validation
					conn.query("COMMIT", function(){
						var consumed_time = Date.now()-start_time;
						profiler.add_result('failed validation', consumed_time);
						console.log(objUnit.unit+" validation "+JSON.stringify(err)+" took "+consumed_time+"ms");
						conn.release();
						unlock();
						if (typeof err === "object"){
							if (err.error_code === "unresolved_dependency")
								callbacks.ifNeedParentUnits(err.arrMissingUnits);
							else if (err.error_code === "need_hash_tree") // need to download hash tree to catch up
								callbacks.ifNeedHashTree();
							else if (err.error_code === "invalid_joint") // ball found in hash tree but with another unit
								callbacks.ifJointError(err.message);
							else if (err.error_code === "transient")
								callbacks.ifTransientError(err.message);
							else
								throw Error("unknown error code");
						}
						else
							callbacks.ifUnitError(err);
					});
				}
				else{
					profiler.stop('validation-messages');
					profiler.start();
					conn.query("COMMIT", function(){
						var consumed_time = Date.now()-start_time;
						profiler.add_result('validation', consumed_time);
						console.log(objUnit.unit+" validation ok took "+consumed_time+"ms");
						conn.release();
						profiler.stop('validation-commit');
						if (objJoint.unsigned){
							unlock();
							callbacks.ifOkUnsigned(objValidationState.sequence === 'good');
						}
						else
							callbacks.ifOk(objValidationState, unlock);
					});
				}
			}
		); // async.series
		
	});
	
}



//  ----------------    


function checkDuplicate(conn, unit, cb){
	conn.query("SELECT 1 FROM units WHERE unit=?", [unit], function(rows){
		if (rows.length === 0) 
			return cb();
		cb("unit "+unit+" already exists");
	});
}

function validateHashTreeBall(conn, objJoint, callback){
	if (!objJoint.ball)
		return callback();
	var objUnit = objJoint.unit;
	var unit_by_hash_tree_ball = storage.assocHashTreeUnitsByBall[objJoint.ball];
//	conn.query("SELECT unit FROM hash_tree_balls WHERE ball=?", [objJoint.ball], function(rows){
		if (!unit_by_hash_tree_ball) 
			return callback({error_code: "need_hash_tree", message: "ball "+objJoint.ball+" is not known in hash tree"});
		if (unit_by_hash_tree_ball !== objUnit.unit)
			return callback(createJointError("ball "+objJoint.ball+" unit "+objUnit.unit+" contradicts hash tree"));
		callback();
//	});
}

function validateHashTreeParentsAndSkiplist(conn, objJoint, callback){
	if (!objJoint.ball)
		return callback();
	var objUnit = objJoint.unit;
	
	function validateBallHash(arrParentBalls, arrSkiplistBalls){
		var hash = objectHash.getBallHash(objUnit.unit, arrParentBalls, arrSkiplistBalls, !!objUnit.content_hash);
		if (hash !== objJoint.ball)
			return callback(createJointError("ball hash is wrong"));
		callback();
	}
	
	function readBallsByUnits(arrUnits, handleList){
		conn.query("SELECT ball FROM balls WHERE unit IN(?) ORDER BY ball", [arrUnits], function(rows){
			var arrBalls = rows.map(function(row){ return row.ball; });
			if (arrBalls.length === arrUnits.length)
				return handleList(arrBalls);
			// we have to check in hash_tree_balls too because if we were synced, went offline, and now starting to catch up, our parents will have no ball yet
			for (var ball in storage.assocHashTreeUnitsByBall){
				var unit = storage.assocHashTreeUnitsByBall[ball];
				if (arrUnits.indexOf(unit) >= 0 && arrBalls.indexOf(ball) === -1)
					arrBalls.push(ball);
			}
			arrBalls.sort();
			handleList(arrBalls);
		});
	}
	
	readBallsByUnits(objUnit.parent_units, function(arrParentBalls){
		if (arrParentBalls.length !== objUnit.parent_units.length)
			return callback(createJointError("some parents not found in balls nor in hash tree")); // while the child is found in hash tree
		if (!objJoint.skiplist_units)
			return validateBallHash(arrParentBalls, []);
		readBallsByUnits(objJoint.skiplist_units, function(arrSkiplistBalls){
			if (arrSkiplistBalls.length !== objJoint.skiplist_units.length)
				return callback(createJointError("some skiplist balls not found"));
			validateBallHash(arrParentBalls, arrSkiplistBalls);
		});
	});
}

// we cannot verify that skiplist units lie on MC if they are unstable yet, 
// but if they don't, we'll get unmatching ball hash when the current unit reaches stability
function validateSkiplist(conn, arrSkiplistUnits, callback){
	var prev = "";
	async.eachSeries(
		arrSkiplistUnits,
		function(skiplist_unit, cb){
			//if (skiplist_unit.charAt(0) !== "0")
			//    return cb("skiplist unit doesn't start with 0");
			if (skiplist_unit <= prev)
				return cb(createJointError("skiplist units not ordered"));
			conn.query("SELECT unit, is_stable, is_on_main_chain, main_chain_index FROM units WHERE unit=?", [skiplist_unit], function(rows){
				if (rows.length === 0)
					return cb("skiplist unit "+skiplist_unit+" not found");
				var objSkiplistUnitProps = rows[0];
				// if not stable, can't check that it is on MC as MC is not stable in its area yet
				if (objSkiplistUnitProps.is_stable === 1){
					if (objSkiplistUnitProps.is_on_main_chain !== 1)
						return cb("skiplist unit "+skiplist_unit+" is not on MC");
					if (objSkiplistUnitProps.main_chain_index % 10 !== 0)
						return cb("skiplist unit "+skiplist_unit+" MCI is not divisible by 10");
				}
				// we can't verify the choice of skiplist unit.
				// If we try to find a skiplist unit now, we might find something matching on unstable part of MC.
				// Again, we have another check when we reach stability
				cb();
			});
		},
		callback
	);
}

function validateParentsExistAndOrdered(conn, objUnit, callback){
	var prev = "";
	var arrMissingParentUnits = [];
	if (objUnit.parent_units.length > constants.MAX_PARENTS_PER_UNIT) // anti-spam
		return callback("too many parents: "+objUnit.parent_units.length);
	async.eachSeries(
		objUnit.parent_units,
		function(parent_unit, cb){
			if (parent_unit <= prev)
				return cb("parent units not ordered");
			prev = parent_unit;
			if (storage.assocUnstableUnits[parent_unit] || storage.assocStableUnits[parent_unit])
				return cb();
			storage.readStaticUnitProps(conn, parent_unit, function(objUnitProps){
				if (!objUnitProps)
					arrMissingParentUnits.push(parent_unit);
				cb();
			}, true);
		},
		function(err){
			if (err)
				return callback(err);
			if (arrMissingParentUnits.length > 0){
				conn.query("SELECT error FROM known_bad_joints WHERE unit IN(?)", [arrMissingParentUnits], function(rows){
					(rows.length > 0)
						? callback("some of the unit's parents are known bad: "+rows[0].error)
						: callback({error_code: "unresolved_dependency", arrMissingUnits: arrMissingParentUnits});
				});
				return;
			}
			callback();
		}
	);
}

function validateParents(conn, objJoint, objValidationState, callback){
	
	// avoid merging the obvious nonserials
	function checkNoSameAddressInDifferentParents(){
		if (objUnit.parent_units.length === 1)
			return callback();
		var assocAuthors = {};
		var found_address;
		async.eachSeries(
			objUnit.parent_units,
			function(parent_unit, cb){
				storage.readUnitAuthors(conn, parent_unit, function(arrAuthors){
					arrAuthors.forEach(function(address){
						if (assocAuthors[address])
							found_address = address;
						assocAuthors[address] = true;
					});
					cb(found_address);
				});
			},
			function(){
				if (found_address)
					return callback("some addresses found more than once in parents, e.g. "+found_address);
				return callback();
			}
		);
	}
	
	function readMaxParentLastBallMci(handleResult){
		conn.query(
			"SELECT MAX(lb_units.main_chain_index) AS max_parent_last_ball_mci \n\
			FROM units JOIN units AS lb_units ON units.last_ball_unit=lb_units.unit \n\
			WHERE units.unit IN(?)",
			[objUnit.parent_units],
			function(rows){
				var max_parent_last_ball_mci = rows[0].max_parent_last_ball_mci;
				if (max_parent_last_ball_mci > objValidationState.last_ball_mci)
					return callback("last ball mci must not retreat, parents: "+objUnit.parent_units.join(', '));
				handleResult(max_parent_last_ball_mci);
			}
		);
	}
	
	var objUnit = objJoint.unit;
	// obsolete: when handling a ball, we can't trust parent list before we verify ball hash
	// obsolete: when handling a fresh unit, we can begin trusting parent list earlier, after we verify parents_hash
	// after this point, we can trust parent list as it either agrees with parents_hash or agrees with hash tree
	// hence, there are no more joint errors, except unordered parents or skiplist units
	var last_ball = objUnit.last_ball;
	var last_ball_unit = objUnit.last_ball_unit;
	var arrPrevParentUnitProps = [];
	objValidationState.max_parent_limci = 0;
	objValidationState.max_parent_wl = 0;
	async.eachSeries(
		objUnit.parent_units, 
		function(parent_unit, cb){
			storage.readUnitProps(conn, parent_unit, function(objParentUnitProps){
				if (objUnit.version !== constants.versionWithoutTimestamp && objUnit.timestamp < objParentUnitProps.timestamp)
					return cb("timestamp decreased from parent " + parent_unit);
				if (objParentUnitProps.latest_included_mc_index > objValidationState.max_parent_limci)
					objValidationState.max_parent_limci = objParentUnitProps.latest_included_mc_index;
				if (objParentUnitProps.witnessed_level > objValidationState.max_parent_wl)
					objValidationState.max_parent_wl = objParentUnitProps.witnessed_level;
				async.eachSeries(
					arrPrevParentUnitProps, 
					function(objPrevParentUnitProps, cb2){
						graph.compareUnitsByProps(conn, objPrevParentUnitProps, objParentUnitProps, function(result){
							(result === null) ? cb2() : cb2("parent unit "+parent_unit+" is related to one of the other parent units");
						});
					},
					function(err){
						if (err)
							return cb(err);
						arrPrevParentUnitProps.push(objParentUnitProps);
						cb();
					}
				);
			});
		}, 
		function(err){
			if (err)
				return callback(err);
			conn.query(
				"SELECT is_stable, is_on_main_chain, main_chain_index, ball, timestamp, (SELECT MAX(main_chain_index) FROM units) AS max_known_mci \n\
				FROM units LEFT JOIN balls USING(unit) WHERE unit=?", 
				[last_ball_unit], 
				function(rows){
					if (rows.length !== 1) // at the same time, direct parents already received
						return callback("last ball unit "+last_ball_unit+" not found");
					var objLastBallUnitProps = rows[0];
					// it can be unstable and have a received (not self-derived) ball
					//if (objLastBallUnitProps.ball !== null && objLastBallUnitProps.is_stable === 0)
					//    throw "last ball "+last_ball+" is unstable";
					if (objLastBallUnitProps.ball === null && objLastBallUnitProps.is_stable === 1)
						throw Error("last ball unit "+last_ball_unit+" is stable but has no ball");
					if (objLastBallUnitProps.is_on_main_chain !== 1)
						return callback("last ball "+last_ball+" is not on MC");
					if (objLastBallUnitProps.ball && objLastBallUnitProps.ball !== last_ball)
						return callback("last_ball "+last_ball+" and last_ball_unit "+last_ball_unit+" do not match");
					objValidationState.last_ball_mci = objLastBallUnitProps.main_chain_index;
					objValidationState.last_ball_timestamp = objLastBallUnitProps.timestamp;
					objValidationState.max_known_mci = objLastBallUnitProps.max_known_mci;
					if (objValidationState.max_parent_limci < objValidationState.last_ball_mci)
						return callback("last ball unit "+last_ball_unit+" is not included in parents, unit "+objUnit.unit);
					var bRequiresTimestamp = (objValidationState.last_ball_mci >= constants.timestampUpgradeMci);
					if (bRequiresTimestamp && objUnit.version === constants.versionWithoutTimestamp)
						return callback("should be higher version at this mci");
					if (!bRequiresTimestamp && objUnit.version !== constants.versionWithoutTimestamp)
						return callback("should be version " + constants.versionWithoutTimestamp + " at this mci");
					readMaxParentLastBallMci(function(max_parent_last_ball_mci){
						if (objLastBallUnitProps.is_stable === 1){
							// if it were not stable, we wouldn't have had the ball at all
							if (objLastBallUnitProps.ball !== last_ball)
								return callback("stable: last_ball "+last_ball+" and last_ball_unit "+last_ball_unit+" do not match");
							if (objValidationState.last_ball_mci <= constants.lastBallStableInParentsUpgradeMci || max_parent_last_ball_mci === objValidationState.last_ball_mci)
								return checkNoSameAddressInDifferentParents();
						}
						// Last ball is not stable yet in our view. Check if it is stable in view of the parents
						main_chain.determineIfStableInLaterUnitsAndUpdateStableMcFlag(conn, last_ball_unit, objUnit.parent_units, objLastBallUnitProps.is_stable, function(bStable, bAdvancedLastStableMci){
							/*if (!bStable && objLastBallUnitProps.is_stable === 1){
								var eventBus = require('./event_bus.js');
								eventBus.emit('nonfatal_error', "last ball is stable, but not stable in parents, unit "+objUnit.unit, new Error());
								return checkNoSameAddressInDifferentParents();
							}
							else */if (!bStable)
								return callback(objUnit.unit+": last ball unit "+last_ball_unit+" is not stable in view of your parents "+objUnit.parent_units);
							if (!bAdvancedLastStableMci)
								return checkNoSameAddressInDifferentParents();
							conn.query("SELECT ball FROM balls WHERE unit=?", [last_ball_unit], function(ball_rows){
								if (ball_rows.length === 0)
									throw Error("last ball unit "+last_ball_unit+" just became stable but ball not found");
								if (ball_rows[0].ball !== last_ball)
									return callback("last_ball "+last_ball+" and last_ball_unit "+last_ball_unit
													+" do not match after advancing stability point");
								if (bAdvancedLastStableMci)
									objValidationState.bAdvancedLastStableMci = true; // not used
								checkNoSameAddressInDifferentParents();
							});
						});
					});
				}
			);
		}
	);
}

function validateWitnesses(conn, objUnit, objValidationState, callback){

	function validateWitnessListMutations(arrWitnesses){
		if (!objUnit.parent_units) // genesis
			return callback();
		storage.determineIfHasWitnessListMutationsAlongMc(conn, objUnit, last_ball_unit, arrWitnesses, function(err){
			if (err && objValidationState.last_ball_mci >= 512000) // do not enforce before the || bug was fixed
				return callback(err);
			checkNoReferencesInWitnessAddressDefinitions(arrWitnesses);
		});
	}
	
	function checkNoReferencesInWitnessAddressDefinitions(arrWitnesses){
		profiler.start();
		var cross = (conf.storage === 'sqlite') ? 'CROSS' : ''; // correct the query planner
		conn.query(
			"SELECT 1 \n\
			FROM address_definition_changes \n\
			JOIN definitions USING(definition_chash) \n\
			JOIN units AS change_units USING(unit)   -- units where the change was declared \n\
			JOIN unit_authors USING(definition_chash) \n\
			JOIN units AS definition_units ON unit_authors.unit=definition_units.unit   -- units where the definition was disclosed \n\
			WHERE address_definition_changes.address IN(?) AND has_references=1 \n\
				AND change_units.is_stable=1 AND change_units.main_chain_index<=? AND +change_units.sequence='good' \n\
				AND definition_units.is_stable=1 AND definition_units.main_chain_index<=? AND +definition_units.sequence='good' \n\
			UNION \n\
			SELECT 1 \n\
			FROM definitions \n\
			"+cross+" JOIN unit_authors USING(definition_chash) \n\
			JOIN units AS definition_units ON unit_authors.unit=definition_units.unit   -- units where the definition was disclosed \n\
			WHERE definition_chash IN(?) AND has_references=1 \n\
				AND definition_units.is_stable=1 AND definition_units.main_chain_index<=? AND +definition_units.sequence='good' \n\
			LIMIT 1",
			[arrWitnesses, objValidationState.last_ball_mci, objValidationState.last_ball_mci, arrWitnesses, objValidationState.last_ball_mci],
			function(rows){
				profiler.stop('validation-witnesses-no-refs');
				(rows.length > 0) ? callback("some witnesses have references in their addresses") : checkWitnessedLevelDidNotRetreat(arrWitnesses);
			}
		);
	}

	function checkWitnessedLevelDidNotRetreat(arrWitnesses){
		storage.determineWitnessedLevelAndBestParent(conn, objUnit.parent_units, arrWitnesses, function(witnessed_level, best_parent_unit){
			objValidationState.witnessed_level = witnessed_level;
			objValidationState.best_parent_unit = best_parent_unit;
			if (objValidationState.last_ball_mci < constants.witnessedLevelMustNotRetreatUpgradeMci) // not enforced
				return callback();
			if (typeof objValidationState.max_parent_wl === 'undefined')
				throw Error('no max_parent_wl');
			if (objValidationState.last_ball_mci >= constants.witnessedLevelMustNotRetreatFromAllParentsUpgradeMci)
				return (witnessed_level >= objValidationState.max_parent_wl) ? callback() : callback("witnessed level retreats from parent's "+objValidationState.max_parent_wl+" to "+witnessed_level);
			storage.readStaticUnitProps(conn, best_parent_unit, function(props){
				(witnessed_level >= props.witnessed_level) 
					? callback() 
					: callback("witnessed level retreats from "+props.witnessed_level+" to "+witnessed_level);
			});
		});
	}
	
	var last_ball_unit = objUnit.last_ball_unit;
	if (typeof objUnit.witness_list_unit === "string"){
		profiler.start();
		storage.readWitnessList(conn, objUnit.witness_list_unit, function(arrWitnesses){
			if (arrWitnesses.length === 0){
				profiler.stop('validation-witnesses-read-list');
				return callback("referenced witness list unit "+objUnit.witness_list_unit+" has no witnesses");
			}
			if (typeof assocWitnessListMci[objUnit.witness_list_unit] === 'number' && assocWitnessListMci[objUnit.witness_list_unit] <= objValidationState.last_ball_mci){
				profiler.stop('validation-witnesses-read-list');
				return validateWitnessListMutations(arrWitnesses);
			}
			conn.query("SELECT sequence, is_stable, main_chain_index FROM units WHERE unit=?", [objUnit.witness_list_unit], function(unit_rows){
				profiler.stop('validation-witnesses-read-list');
				if (unit_rows.length === 0)
					return callback("witness list unit "+objUnit.witness_list_unit+" not found");
				var objWitnessListUnitProps = unit_rows[0];
				if (objWitnessListUnitProps.sequence !== 'good')
					return callback("witness list unit "+objUnit.witness_list_unit+" is not serial");
				if (objWitnessListUnitProps.is_stable !== 1)
					return callback("witness list unit "+objUnit.witness_list_unit+" is not stable");
				if (objWitnessListUnitProps.main_chain_index > objValidationState.last_ball_mci)
					return callback("witness list unit "+objUnit.witness_list_unit+" must come before last ball");
				assocWitnessListMci[objUnit.witness_list_unit] = objWitnessListUnitProps.main_chain_index;
				validateWitnessListMutations(arrWitnesses);
			});
		}, true);
	}
	else if (Array.isArray(objUnit.witnesses) && objUnit.witnesses.length === constants.COUNT_WITNESSES){
		var prev_witness = objUnit.witnesses[0];
		for (var i=0; i<objUnit.witnesses.length; i++){
			var curr_witness = objUnit.witnesses[i];
			if (!chash.isChashValid(curr_witness))
				return callback("witness address "+curr_witness+" is invalid");
			if (i === 0)
				continue;
			if (curr_witness <= prev_witness)
				return callback("wrong order of witnesses, or duplicates");
			prev_witness = curr_witness;
		}
		if (storage.isGenesisUnit(objUnit.unit)){
			// addresses might not be known yet, it's ok
			validateWitnessListMutations(objUnit.witnesses);
			return;
		}
		profiler.start();
		// check that all witnesses are already known and their units are good and stable
		conn.query(
			// address=definition_chash is true in the first appearence of the address
			// (not just in first appearence: it can return to its initial definition_chash sometime later)
			"SELECT COUNT(DISTINCT address) AS count_stable_good_witnesses FROM unit_authors CROSS JOIN units USING(unit) \n\
			WHERE address=definition_chash AND +sequence='good' AND is_stable=1 AND main_chain_index<=? AND definition_chash IN(?)",
			[objValidationState.last_ball_mci, objUnit.witnesses],
			function(rows){
				if (rows[0].count_stable_good_witnesses !== constants.COUNT_WITNESSES)
					return callback("some witnesses are not stable, not serial, or don't come before last ball");
				profiler.stop('validation-witnesses-stable');
				validateWitnessListMutations(objUnit.witnesses);
			}
		);
	}
	else
		return callback("no witnesses or not enough witnesses");
}

function validateHeadersCommissionRecipients(objUnit, cb){
	if (objUnit.authors.length > 1 && typeof objUnit.earned_headers_commission_recipients !== "object")
		return cb("must specify earned_headers_commission_recipients when more than 1 author");
	if ("earned_headers_commission_recipients" in objUnit){
		if (!isNonemptyArray(objUnit.earned_headers_commission_recipients))
			return cb("empty earned_headers_commission_recipients array");
		var total_earned_headers_commission_share = 0;
		var prev_address = "";
		for (var i=0; i<objUnit.earned_headers_commission_recipients.length; i++){
			var recipient = objUnit.earned_headers_commission_recipients[i];
			if (!isPositiveInteger(recipient.earned_headers_commission_share))
				return cb("earned_headers_commission_share must be positive integer");
			if (hasFieldsExcept(recipient, ["address", "earned_headers_commission_share"]))
				return cb("unknowsn fields in recipient");
			if (recipient.address <= prev_address)
				return cb("recipient list must be sorted by address");
			if (!isValidAddress(recipient.address))
				return cb("invalid recipient address checksum");
			total_earned_headers_commission_share += recipient.earned_headers_commission_share;
			prev_address = recipient.address;
		}
		if (total_earned_headers_commission_share !== 100)
			return cb("sum of earned_headers_commission_share is not 100");
	}
	cb();
}

function validateAuthors(conn, arrAuthors, objUnit, objValidationState, callback) {
	if (arrAuthors.length > constants.MAX_AUTHORS_PER_UNIT) // this is anti-spam. Otherwise an attacker would send nonserial balls signed by zillions of authors.
		return callback("too many authors");
	objValidationState.arrAddressesWithForkedPath = [];
	var prev_address = "";
	for (var i=0; i<arrAuthors.length; i++){
		var objAuthor = arrAuthors[i];
		if (objAuthor.address <= prev_address)
			return callback("author addresses not sorted");
		prev_address = objAuthor.address;
	}
	
	objValidationState.unit_hash_to_sign = objectHash.getUnitHashToSign(objUnit);
	
	async.eachSeries(arrAuthors, function(objAuthor, cb){
		validateAuthor(conn, objAuthor, objUnit, objValidationState, cb);
	}, callback);
}

function validateAuthor(conn, objAuthor, objUnit, objValidationState, callback){
	if (!isStringOfLength(objAuthor.address, 32))
		return callback("wrong address length");
	if (hasFieldsExcept(objAuthor, ["address", "authentifiers", "definition"]))
		return callback("unknown fields in author");
	if (!ValidationUtils.isNonemptyObject(objAuthor.authentifiers) && !objUnit.content_hash)
		return callback("no authentifiers");
	for (var path in objAuthor.authentifiers){
		if (!isNonemptyString(objAuthor.authentifiers[path]))
			return callback("authentifiers must be nonempty strings");
		if (objAuthor.authentifiers[path].length > constants.MAX_AUTHENTIFIER_LENGTH)
			return callback("authentifier too long");
	}
	
	var bNonserial = false;
	
	var arrAddressDefinition = objAuthor.definition;
	if (isNonemptyArray(arrAddressDefinition)){
		// todo: check that the address is really new?
		validateAuthentifiers(arrAddressDefinition);
	}
	else if (!("definition" in objAuthor)){
		if (!chash.isChashValid(objAuthor.address))
			return callback("address checksum invalid");
		if (objUnit.content_hash){ // nothing else to check
			objValidationState.sequence = 'final-bad';
			return callback();
		}
		// we check signatures using the latest address definition before last ball
		storage.readDefinitionByAddress(conn, objAuthor.address, objValidationState.last_ball_mci, {
			ifDefinitionNotFound: function(definition_chash){
				callback("definition "+definition_chash+" bound to address "+objAuthor.address+" is not defined");
			},
			ifFound: function(arrAddressDefinition){
				validateAuthentifiers(arrAddressDefinition);
			}
		});
	}
	else
		return callback("bad type of definition");
	
	
	function validateAuthentifiers(arrAddressDefinition){
		Definition.validateAuthentifiers(
			conn, objAuthor.address, null, arrAddressDefinition, objUnit, objValidationState, objAuthor.authentifiers, 
			function(err, res){
				if (err) // error in address definition
					return callback(err);
				if (!res) // wrong signature or the like
					return callback("authentifier verification failed");
				checkSerialAddressUse();
			}
		);
	}
	
	
	function findConflictingUnits(handleConflictingUnits){
	//	var cross = (objValidationState.max_known_mci - objValidationState.max_parent_limci < 1000) ? 'CROSS' : '';
		var indexMySQL = conf.storage == "mysql" ? "USE INDEX(unitAuthorsIndexByAddressMci)" : "";
		conn.query( // _left_ join forces use of indexes in units
		/*	"SELECT unit, is_stable \n\
			FROM units \n\
			"+cross+" JOIN unit_authors USING(unit) \n\
			WHERE address=? AND (main_chain_index>? OR main_chain_index IS NULL) AND unit != ?",
			[objAuthor.address, objValidationState.max_parent_limci, objUnit.unit],*/
			"SELECT unit, is_stable, sequence, level \n\
			FROM unit_authors "+indexMySQL+"\n\
			CROSS JOIN units USING(unit)\n\
			WHERE address=? AND _mci>? AND unit != ? \n\
			UNION \n\
			SELECT unit, is_stable, sequence, level \n\
			FROM unit_authors "+indexMySQL+"\n\
			CROSS JOIN units USING(unit)\n\
			WHERE address=? AND _mci IS NULL AND unit != ? \n\
			ORDER BY level DESC",
			[objAuthor.address, objValidationState.max_parent_limci, objUnit.unit, objAuthor.address, objUnit.unit],
			function(rows){
				if (rows.length === 0)
					return handleConflictingUnits([]);
				var bAllSerial = rows.every(function(row){ return (row.sequence === 'good'); });
				var arrConflictingUnitProps = [];
				async.eachSeries(
					rows,
					function(row, cb){
						graph.determineIfIncludedOrEqual(conn, row.unit, objUnit.parent_units, function(bIncluded){
							if (!bIncluded)
								arrConflictingUnitProps.push(row);
							else if (bAllSerial)
								return cb('done'); // all are serial and this one is included, therefore the earlier ones are included too
							cb();
						});
					},
					function(){
						handleConflictingUnits(arrConflictingUnitProps);
					}
				);
			}
		);
	}


	function checkSerialAddressUse(){
		var next = checkNoPendingChangeOfDefinitionChash;
		findConflictingUnits(function(arrConflictingUnitProps){
			if (arrConflictingUnitProps.length === 0){ // no conflicting units
				// we can have 2 authors. If the 1st author gave bad sequence but the 2nd is good then don't overwrite
				objValidationState.sequence = objValidationState.sequence || 'good';
				return next();
			}
			var arrConflictingUnits = arrConflictingUnitProps.map(function(objConflictingUnitProps){ return objConflictingUnitProps.unit; });
			breadcrumbs.add("========== found conflicting units "+arrConflictingUnits+" =========");
			breadcrumbs.add("========== will accept a conflicting unit "+objUnit.unit+" =========");
			objValidationState.arrAddressesWithForkedPath.push(objAuthor.address);
			objValidationState.arrConflictingUnits = (objValidationState.arrConflictingUnits || []).concat(arrConflictingUnits);
			bNonserial = true;
			var arrUnstableConflictingUnitProps = arrConflictingUnitProps.filter(function(objConflictingUnitProps){
				return (objConflictingUnitProps.is_stable === 0);
			});
			var bConflictsWithStableUnits = arrConflictingUnitProps.some(function(objConflictingUnitProps){
				return (objConflictingUnitProps.is_stable === 1);
			});
			if (objValidationState.sequence !== 'final-bad') // if it were already final-bad because of 1st author, it can't become temp-bad due to 2nd author
				objValidationState.sequence = bConflictsWithStableUnits ? 'final-bad' : 'temp-bad';
			var arrUnstableConflictingUnits = arrUnstableConflictingUnitProps.map(function(objConflictingUnitProps){ return objConflictingUnitProps.unit; });
			if (bConflictsWithStableUnits) // don't temp-bad the unstable conflicting units
				return next();
			if (arrUnstableConflictingUnits.length === 0)
				return next();
			// we don't modify the db during validation, schedule the update for the write
			objValidationState.arrAdditionalQueries.push(
				{sql: "UPDATE units SET sequence='temp-bad' WHERE unit IN(?) AND +sequence='good'", params: [arrUnstableConflictingUnits]});
			next();
		});
	}
	
	// don't allow contradicting pending keychanges.
	// We don't trust pending keychanges even when they are serial, as another unit may arrive and make them nonserial
	function checkNoPendingChangeOfDefinitionChash(){
		var next = checkNoPendingDefinition;
		//var filter = bNonserial ? "AND sequence='good'" : "";
		conn.query(
			"SELECT unit FROM address_definition_changes JOIN units USING(unit) \n\
			WHERE address=? AND (is_stable=0 OR main_chain_index>? OR main_chain_index IS NULL)", 
			[objAuthor.address, objValidationState.last_ball_mci], 
			function(rows){
				if (rows.length === 0)
					return next();
				if (!bNonserial || objValidationState.arrAddressesWithForkedPath.indexOf(objAuthor.address) === -1)
					return callback("you can't send anything before your last keychange is stable and before last ball");
				// from this point, our unit is nonserial
				async.eachSeries(
					rows,
					function(row, cb){
						graph.determineIfIncludedOrEqual(conn, row.unit, objUnit.parent_units, function(bIncluded){
							if (bIncluded)
								console.log("checkNoPendingChangeOfDefinitionChash: unit "+row.unit+" is included");
							bIncluded ? cb("found") : cb();
						});
					},
					function(err){
						(err === "found") 
							? callback("you can't send anything before your last included keychange is stable and before last ball (self is nonserial)") 
							: next();
					}
				);
			}
		);
	}
	
	// We don't trust pending definitions even when they are serial, as another unit may arrive and make them nonserial, 
	// then the definition will be removed
	function checkNoPendingDefinition(){
		//var next = checkNoPendingOrRetrievableNonserialIncluded;
		var next = validateDefinition;
		//var filter = bNonserial ? "AND sequence='good'" : "";
	//	var cross = (objValidationState.max_known_mci - objValidationState.last_ball_mci < 1000) ? 'CROSS' : '';
		conn.query( // _left_ join forces use of indexes in units
		//	"SELECT unit FROM units "+cross+" JOIN unit_authors USING(unit) \n\
		//	WHERE address=? AND definition_chash IS NOT NULL AND ( /* is_stable=0 OR */ main_chain_index>? OR main_chain_index IS NULL)", 
		//	[objAuthor.address, objValidationState.last_ball_mci], 
			"SELECT unit FROM unit_authors WHERE address=? AND definition_chash IS NOT NULL AND _mci>?  \n\
			UNION \n\
			SELECT unit FROM unit_authors WHERE address=? AND definition_chash IS NOT NULL AND _mci IS NULL", 
			[objAuthor.address, objValidationState.last_ball_mci, objAuthor.address], 
			function(rows){
				if (rows.length === 0)
					return next();
				if (!bNonserial || objValidationState.arrAddressesWithForkedPath.indexOf(objAuthor.address) === -1)
					return callback("you can't send anything before your last definition is stable and before last ball");
				// from this point, our unit is nonserial
				async.eachSeries(
					rows,
					function(row, cb){
						graph.determineIfIncludedOrEqual(conn, row.unit, objUnit.parent_units, function(bIncluded){
							if (bIncluded)
								console.log("checkNoPendingDefinition: unit "+row.unit+" is included");
							bIncluded ? cb("found") : cb();
						});
					},
					function(err){
						(err === "found") 
							? callback("you can't send anything before your last included definition is stable and before last ball (self is nonserial)") 
							: next();
					}
				);
			}
		);
	}
	
	// This was bad idea.  An uncovered nonserial, if not archived, will block new units from this address forever.
	/*
	function checkNoPendingOrRetrievableNonserialIncluded(){
		var next = validateDefinition;
		conn.query(
			"SELECT lb_units.main_chain_index FROM units JOIN units AS lb_units ON units.last_ball_unit=lb_units.unit \n\
			WHERE units.is_on_main_chain=1 AND units.main_chain_index=?",
			[objValidationState.last_ball_mci],
			function(lb_rows){
				var last_ball_of_last_ball_mci = (lb_rows.length > 0) ? lb_rows[0].main_chain_index : 0;
				conn.query(
					"SELECT unit FROM unit_authors JOIN units USING(unit) \n\
					WHERE address=? AND (is_stable=0 OR main_chain_index>?) AND sequence!='good'", 
					[objAuthor.address, last_ball_of_last_ball_mci], 
					function(rows){
						if (rows.length === 0)
							return next();
						if (!bNonserial)
							return callback("you can't send anything before all your nonserial units are stable and before last ball of last ball");
						// from this point, the unit is nonserial
						async.eachSeries(
							rows,
							function(row, cb){
								graph.determineIfIncludedOrEqual(conn, row.unit, objUnit.parent_units, function(bIncluded){
									if (bIncluded)
										console.log("checkNoPendingOrRetrievableNonserialIncluded: unit "+row.unit+" is included");
									bIncluded ? cb("found") : cb();
								});
							},
							function(err){
								(err === "found") 
									? callback("you can't send anything before all your included nonserial units are stable \
											   and lie before last ball of last ball (self is nonserial)") 
									: next();
							}
						);
					}
				);
			}
		);
	}
	*/
	
	function validateDefinition(){
		if (!("definition" in objAuthor))
			return callback();
		// the rest assumes that the definition is explicitly defined
		var arrAddressDefinition = objAuthor.definition;
		storage.readDefinitionByAddress(conn, objAuthor.address, objValidationState.last_ball_mci, {
			ifDefinitionNotFound: function(definition_chash){ // first use of the definition_chash (in particular, of the address, when definition_chash=address)
				if (objectHash.getChash160(arrAddressDefinition) !== definition_chash)
					return callback("wrong definition: "+objectHash.getChash160(arrAddressDefinition) +"!=="+ definition_chash);
				callback();
			},
			ifFound: function(arrAddressDefinition2){ // arrAddressDefinition2 can be different
				handleDuplicateAddressDefinition(arrAddressDefinition2);
			}
		});
	}
	
	function handleDuplicateAddressDefinition(arrAddressDefinition){
		if (!bNonserial || objValidationState.arrAddressesWithForkedPath.indexOf(objAuthor.address) === -1)
			return callback("duplicate definition of address "+objAuthor.address+", bNonserial="+bNonserial);
		// todo: investigate if this can split the nodes
		// in one particular case, the attacker changes his definition then quickly sends a new ball with the old definition - the new definition will not be active yet
		if (objectHash.getChash160(arrAddressDefinition) !== objectHash.getChash160(objAuthor.definition))
			return callback("unit definition doesn't match the stored definition");
		callback(); // let it be for now. Eventually, at most one of the balls will be declared good
	}
	
}

function validateMessages(conn, arrMessages, objUnit, objValidationState, callback){
	console.log("validateMessages "+objUnit.unit);
	async.forEachOfSeries(
		arrMessages, 
		function(objMessage, message_index, cb){
			validateMessage(conn, objMessage, message_index, objUnit, objValidationState, cb); 
		}, 
		function(err){
			if (err)
				return callback(err);
			if (!objValidationState.bHasBasePayment)
				return callback("no base payment message");
			callback();
		}
	);
}

function validateMessage(conn, objMessage, message_index, objUnit, objValidationState, callback) {
	if (typeof objMessage.app !== "string")
		return callback("no app");
	if (!isStringOfLength(objMessage.payload_hash, constants.HASH_LENGTH))
		return callback("wrong payload hash size");
	if (typeof objMessage.payload_location !== "string")
		return callback("no payload_location");
	if (hasFieldsExcept(objMessage, ["app", "payload_hash", "payload_location", "payload", "payload_uri", "payload_uri_hash", "spend_proofs"]))
		return callback("unknown fields in message");
	
	if ("spend_proofs" in objMessage){
		if (!Array.isArray(objMessage.spend_proofs) || objMessage.spend_proofs.length === 0 || objMessage.spend_proofs.length > constants.MAX_SPEND_PROOFS_PER_MESSAGE)
			return callback("spend_proofs must be non-empty array max "+constants.MAX_SPEND_PROOFS_PER_MESSAGE+" elements");
		var arrAuthorAddresses = objUnit.authors.map(function(author) { return author.address; } );
		// spend proofs are sorted in the same order as their corresponding inputs
		//var prev_spend_proof = "";
		for (var i=0; i<objMessage.spend_proofs.length; i++){
			var objSpendProof = objMessage.spend_proofs[i];
			if (typeof objSpendProof !== "object")
				return callback("spend_proof must be object");
			if (hasFieldsExcept(objSpendProof, ["spend_proof", "address"]))
				return callback("unknown fields in spend_proof");
			//if (objSpendProof.spend_proof <= prev_spend_proof)
			//    return callback("spend_proofs not sorted");
			
			if (!isValidBase64(objSpendProof.spend_proof, constants.HASH_LENGTH))
				return callback("spend proof "+objSpendProof.spend_proof+" is not a valid base64");
			
			var address = null;
			if (arrAuthorAddresses.length === 1){
				if ("address" in objSpendProof)
					return callback("when single-authored, must not put address in spend proof");
				address = arrAuthorAddresses[0];
			}
			else{
				if (typeof objSpendProof.address !== "string")
					return callback("when multi-authored, must put address in spend_proofs");
				if (arrAuthorAddresses.indexOf(objSpendProof.address) === -1)
					return callback("spend proof address "+objSpendProof.address+" is not an author");
				address = objSpendProof.address;
			}
			
			if (objValidationState.arrInputKeys.indexOf(objSpendProof.spend_proof) >= 0)
				return callback("spend proof "+objSpendProof.spend_proof+" already used");
			objValidationState.arrInputKeys.push(objSpendProof.spend_proof);
			
			//prev_spend_proof = objSpendProof.spend_proof;
		}
		if (objMessage.payload_location === "inline")
			return callback("you don't need spend proofs when you have inline payload");
	}

	if (objMessage.payload_location !== "inline" && objMessage.payload_location !== "uri" && objMessage.payload_location !== "none")
		return callback("wrong payload location: "+objMessage.payload_location);

	if (objMessage.payload_location === "none" && ("payload" in objMessage || "payload_uri" in objMessage || "payload_uri_hash" in objMessage))
		return callback("must be no payload");

	if (objMessage.payload_location === "uri"){
		if ("payload" in objMessage)
			return callback("must not contain payload");
		if (typeof objMessage.payload_uri !== "string")
			return callback("no payload uri");
		if (!isStringOfLength(objMessage.payload_uri_hash, constants.HASH_LENGTH))
			return callback("wrong length of payload uri hash");
		if (objMessage.payload_uri.length > 500)
			return callback("payload_uri too long");	
		if (objectHash.getBase64Hash(objMessage.payload_uri) !== objMessage.payload_uri_hash)
			return callback("wrong payload_uri hash");
	}
	else{
		if ("payload_uri" in objMessage || "payload_uri_hash" in objMessage)
			return callback("must not contain payload_uri and payload_uri_hash");
	}
	
	if (objMessage.app === "payment"){ // special requirements for payment
		if (objMessage.payload_location !== "inline" && objMessage.payload_location !== "none")
			return callback("payment location must be inline or none");
		if (objMessage.payload_location === "none" && !objMessage.spend_proofs)
			return callback("private payment must come with spend proof(s)");
	}
	
	var arrInlineOnlyApps = ["address_definition_change", "data_feed", "definition_template", "asset", "asset_attestors", "attestation", "poll", "vote"];
	if (arrInlineOnlyApps.indexOf(objMessage.app) >= 0 && objMessage.payload_location !== "inline")
		return callback(objMessage.app+" must be inline");

	
	function validatePayload(cb){
		if (objMessage.payload_location === "inline"){
			validateInlinePayload(conn, objMessage, message_index, objUnit, objValidationState, cb);
		}
		else{
			if (!isValidBase64(objMessage.payload_hash, constants.HASH_LENGTH))
				return cb("wrong payload hash");
			cb();
		}
	}
	
	function validateSpendProofs(cb){
		if (!("spend_proofs" in objMessage))
			return cb();
		var arrEqs = objMessage.spend_proofs.map(function(objSpendProof){
			return "spend_proof="+conn.escape(objSpendProof.spend_proof)+
				" AND address="+conn.escape(objSpendProof.address ? objSpendProof.address : objUnit.authors[0].address);
		});
		var doubleSpendIndexMySQL = conf.storage == "mysql" ? "USE INDEX(bySpendProof)" : "";
		checkForDoublespends(conn, "spend proof", 
			"SELECT address, unit, main_chain_index, sequence FROM spend_proofs "+ doubleSpendIndexMySQL+" JOIN units USING(unit) WHERE unit != ? AND ("+arrEqs.join(" OR ")+")",
			[objUnit.unit], 
			objUnit, objValidationState, function(cb2){ cb2(); }, cb);
	}
	
	async.series([validateSpendProofs, validatePayload], callback);
}


function checkForDoublespends(conn, type, sql, arrSqlArgs, objUnit, objValidationState, onAcceptedDoublespends, cb){
	conn.query(
		sql, 
		arrSqlArgs,
		function(rows){
			if (rows.length === 0)
				return cb();
			var arrAuthorAddresses = objUnit.authors.map(function(author) { return author.address; } );
			async.eachSeries(
				rows,
				function(objConflictingRecord, cb2){
					if (arrAuthorAddresses.indexOf(objConflictingRecord.address) === -1)
						throw Error("conflicting "+type+" spent from another address?");
					if (conf.bLight) // we can't use graph in light wallet, the private payment can be resent and revalidated when stable
						return cb2(objUnit.unit+": conflicting "+type);
					graph.determineIfIncludedOrEqual(conn, objConflictingRecord.unit, objUnit.parent_units, function(bIncluded){
						if (bIncluded){
							var error = objUnit.unit+": conflicting "+type+" in inner unit "+objConflictingRecord.unit;

							// too young (serial or nonserial)
							if (objConflictingRecord.main_chain_index > objValidationState.last_ball_mci || objConflictingRecord.main_chain_index === null)
								return cb2(error);

							// in good sequence (final state)
							if (objConflictingRecord.sequence === 'good')
								return cb2(error);

							// to be voided: can reuse the output
							if (objConflictingRecord.sequence === 'final-bad')
								return cb2();

							throw Error("unreachable code, conflicting "+type+" in unit "+objConflictingRecord.unit);
						}
						else{ // arrAddressesWithForkedPath is not set when validating private payments
							if (objValidationState.arrAddressesWithForkedPath && objValidationState.arrAddressesWithForkedPath.indexOf(objConflictingRecord.address) === -1)
								throw Error("double spending "+type+" without double spending address?");
							cb2();
						}
					});
				},
				function(err){
					if (err)
						return cb(err);
					onAcceptedDoublespends(cb);
				}
			);
		}
	);
}

function validateInlinePayload(conn, objMessage, message_index, objUnit, objValidationState, callback){
	var payload = objMessage.payload;
	if (typeof payload === "undefined")
		return callback("no inline payload");
	try{
		var expected_payload_hash = objectHash.getBase64Hash(payload, objUnit.version !== constants.versionWithoutTimestamp);
		if (expected_payload_hash !== objMessage.payload_hash)
			return callback("wrong payload hash: expected "+expected_payload_hash+", got "+objMessage.payload_hash);
	}
	catch(e){
		return callback("failed to calc payload hash: "+e);
	}

	switch (objMessage.app){

		case "text":
			if (typeof payload !== "string")
				return callback("payload must be string");
			return callback();

		case "address_definition_change":
			if (hasFieldsExcept(payload, ["definition_chash", "address"]))
				return callback("unknown fields in address_definition_change");
			var arrAuthorAddresses = objUnit.authors.map(function(author) { return author.address; } );
			var address;
			if (objUnit.authors.length > 1){
				if (!isValidAddress(payload.address))
					return callback("when multi-authored, must indicate address");
				if (arrAuthorAddresses.indexOf(payload.address) === -1)
					return callback("foreign address");
				address = payload.address;
			}
			else{
				if ('address' in payload)
					return callback("when single-authored, must not indicate address");
				address = arrAuthorAddresses[0];
			}
			if (!objValidationState.arrDefinitionChangeFlags)
				objValidationState.arrDefinitionChangeFlags = {};
			if (objValidationState.arrDefinitionChangeFlags[address])
				return callback("can be only one definition change per address");
			objValidationState.arrDefinitionChangeFlags[address] = true;
			if (!isValidAddress(payload.definition_chash))
				return callback("bad new definition_chash");
			return callback();

		case "poll":
			if (objValidationState.bHasPoll)
				return callback("can be only one poll");
			objValidationState.bHasPoll = true;
			if (typeof payload !== "object" || Array.isArray(payload))
				return callback("poll payload must be object");
			if (hasFieldsExcept(payload, ["question", "choices"]))
				return callback("unknown fields in "+objMessage.app);
			if (typeof payload.question !== 'string')
				return callback("no question in poll");
			if (!isNonemptyArray(payload.choices))
				return callback("no choices in poll");
			if (payload.choices.length > constants.MAX_CHOICES_PER_POLL)
				return callback("too many choices in poll");
			for (var i=0; i<payload.choices.length; i++) {
				if (typeof payload.choices[i] !== 'string')
					return callback("all choices must be strings");
				if (payload.choices[i].trim().length === 0)
					return callback("all choices must be longer than 0 chars");
				if (payload.choices[i].length > constants.MAX_CHOICE_LENGTH)
					return callback("all choices must be "+ constants.MAX_CHOICE_LENGTH + " chars or less");
			}
			return callback();
			
		case "vote":
			if (!isStringOfLength(payload.unit, constants.HASH_LENGTH))
				return callback("invalid unit in vote");
			if (typeof payload.choice !== "string")
				return callback("choice must be string");
			if (hasFieldsExcept(payload, ["unit", "choice"]))
				return callback("unknown fields in "+objMessage.app);
			conn.query(
				"SELECT main_chain_index, sequence FROM polls JOIN poll_choices USING(unit) JOIN units USING(unit) WHERE unit=? AND choice=?", 
				[payload.unit, payload.choice],
				function(poll_unit_rows){
					if (poll_unit_rows.length > 1)
						throw Error("more than one poll?");
					if (poll_unit_rows.length === 0)
						return callback("invalid choice "+payload.choice+" or poll "+payload.unit);
					var objPollUnitProps = poll_unit_rows[0];
					if (objPollUnitProps.main_chain_index === null || objPollUnitProps.main_chain_index > objValidationState.last_ball_mci)
						return callback("poll unit must be before last ball");
					if (objPollUnitProps.sequence !== 'good')
						return callback("poll unit is not serial");
					return callback();
				}
			);
			break;

		case "data_feed":
			if (objValidationState.bHasDataFeed)
				return callback("can be only one data feed");
			objValidationState.bHasDataFeed = true;
			if (typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length === 0)
				return callback("data feed payload must be non-empty object");
			for (var feed_name in payload){
				if (feed_name.length > constants.MAX_DATA_FEED_NAME_LENGTH)
					return callback("feed name "+feed_name+" too long");
				if (feed_name.indexOf('\n') >=0 )
					return callback("feed name "+feed_name+" contains \\n");
				var value = payload[feed_name];
				if (typeof value === 'string'){
					if (value.length > constants.MAX_DATA_FEED_VALUE_LENGTH)
						return callback("value "+value+" too long");
					if (value.indexOf('\n') >=0 )
						return callback("value "+value+" of feed name "+feed_name+" contains \\n");
				}
				else if (typeof value === 'number'){
					if (!isInteger(value))
						return callback("fractional numbers not allowed in data feeds");
				}
				else
					return callback("data feed "+feed_name+" must be string or number");
			}
			return callback();

		case "profile":
			if (objUnit.authors.length !== 1)
				return callback("profile must be single-authored");
			if (objValidationState.bHasProfile)
				return callback("can be only one profile");
			objValidationState.bHasProfile = true;
			// no break, continuing
		case "data":
			if (typeof payload !== "object" || payload === null)
				return callback(objMessage.app+" payload must be object");
			return callback();

		case "definition_template":
			if (objValidationState.bHasDefinitionTemplate)
				return callback("can be only one definition template");
			objValidationState.bHasDefinitionTemplate = true;
			if (!ValidationUtils.isArrayOfLength(payload, 2))
				return callback(objMessage.app+" payload must be array of two elements");
			return callback();

		case "attestation":
			if (objUnit.authors.length !== 1)
				return callback("attestation must be single-authored");
			if (hasFieldsExcept(payload, ["address", "profile"]))
				return callback("unknown fields in "+objMessage.app);
			if (!isValidAddress(payload.address))
				return callback("attesting an invalid address");
			if (typeof payload.profile !== 'object' || payload.profile === null)
				return callback("attested profile must be object");
			// it is ok if the address has never been used yet
			// it is also ok to attest oneself
			return callback();

		case "asset":
			if (objValidationState.bHasAssetDefinition)
				return callback("can be only one asset definition");
			objValidationState.bHasAssetDefinition = true;
			validateAssetDefinition(conn, payload, objUnit, objValidationState, callback);
			break;

		case "asset_attestors":
			if (!objValidationState.assocHasAssetAttestors)
				objValidationState.assocHasAssetAttestors = {};
			if (objValidationState.assocHasAssetAttestors[payload.asset])
				return callback("can be only one asset attestor list update per asset");
			objValidationState.assocHasAssetAttestors[payload.asset] = true;
			validateAttestorListUpdate(conn, payload, objUnit, objValidationState, callback);
			break;

		case "payment":
			validatePayment(conn, payload, message_index, objUnit, objValidationState, callback);
			break;

		default:
			return callback("unknown app: "+objMessage.app);
	}
}

// used for both public and private payments
function validatePayment(conn, payload, message_index, objUnit, objValidationState, callback){

	if (!("asset" in payload)){ // base currency
		if (hasFieldsExcept(payload, ["inputs", "outputs"]))
			return callback("unknown fields in payment message");
		if (objValidationState.bHasBasePayment)
			return callback("can have only one base payment");
		objValidationState.bHasBasePayment = true;
		return validatePaymentInputsAndOutputs(conn, payload, null, message_index, objUnit, objValidationState, callback);
	}
	
	// asset
	if (!isStringOfLength(payload.asset, constants.HASH_LENGTH))
		return callback("invalid asset");
	
	var arrAuthorAddresses = objUnit.authors.map(function(author) { return author.address; } );
	// note that light clients cannot check attestations
	storage.loadAssetWithListOfAttestedAuthors(conn, payload.asset, objValidationState.last_ball_mci, arrAuthorAddresses, function(err, objAsset){
		if (err)
			return callback(err);
		if (hasFieldsExcept(payload, ["inputs", "outputs", "asset", "denomination"]))
			return callback("unknown fields in payment message");
		if (!isNonemptyArray(payload.inputs))
			return callback("no inputs");
		if (!isNonemptyArray(payload.outputs))
			return callback("no outputs");
		if (objAsset.fixed_denominations){
			if (!isPositiveInteger(payload.denomination))
				return callback("no denomination");
		}
		else{
			if ("denomination" in payload)
				return callback("denomination in arbitrary-amounts asset")
		}
		if (!!objAsset.is_private !== !!objValidationState.bPrivate)
			return callback("asset privacy mismatch");
		var bIssue = (payload.inputs[0].type === "issue");
		var issuer_address;
		if (bIssue){
			if (arrAuthorAddresses.length === 1)
				issuer_address = arrAuthorAddresses[0];
			else{
				issuer_address = payload.inputs[0].address;
				if (arrAuthorAddresses.indexOf(issuer_address) === -1)
					return callback("issuer not among authors");
			}
			if (objAsset.issued_by_definer_only && issuer_address !== objAsset.definer_address)
				return callback("only definer can issue this asset");
		}
		if (objAsset.cosigned_by_definer && arrAuthorAddresses.indexOf(objAsset.definer_address) === -1)
			return callback("must be cosigned by definer");
		
		if (objAsset.spender_attested){
			if (conf.bLight && objAsset.is_private) // in light clients, we don't have the attestation data but if the asset is public, we trust witnesses to have checked attestations
				return callback("being light, I can't check attestations for private assets"); // TODO: request history
			if (objAsset.arrAttestedAddresses.length === 0)
				return callback("none of the authors is attested");
			if (bIssue && objAsset.arrAttestedAddresses.indexOf(issuer_address) === -1)
				return callback("issuer is not attested");
		}
		validatePaymentInputsAndOutputs(conn, payload, objAsset, message_index, objUnit, objValidationState, callback);
	});
}

// divisible assets (including base asset)
function validatePaymentInputsAndOutputs(conn, payload, objAsset, message_index, objUnit, objValidationState, callback){
	
//	if (objAsset)
//		profiler2.start();
	var denomination = payload.denomination || 1;
	var arrAuthorAddresses = objUnit.authors.map(function(author) { return author.address; } );
	var arrInputAddresses = []; // used for non-transferrable assets only
	var arrOutputAddresses = [];
	var total_input = 0;
	if (payload.inputs.length > constants.MAX_INPUTS_PER_PAYMENT_MESSAGE)
		return callback("too many inputs");
	if (payload.outputs.length > constants.MAX_OUTPUTS_PER_PAYMENT_MESSAGE)
		return callback("too many outputs");
	
	if (objAsset && objAsset.fixed_denominations && payload.inputs.length !== 1)
		return callback("fixed denominations payment must have 1 input");

	var total_output = 0;
	var prev_address = ""; // if public, outputs must be sorted by address
	var prev_amount = 0;
	var count_open_outputs = 0;
	for (var i=0; i<payload.outputs.length; i++){
		var output = payload.outputs[i];
		if (hasFieldsExcept(output, ["address", "amount", "blinding", "output_hash"]))
			return callback("unknown fields in payment output");
		if (!isPositiveInteger(output.amount))
			return callback("amount must be positive integer, found "+output.amount);
		if (objAsset && objAsset.fixed_denominations && output.amount % denomination !== 0)
			return callback("output amount must be divisible by denomination");
		if (objAsset && objAsset.is_private){
			if (("output_hash" in output) !== !!objAsset.fixed_denominations)
				return callback("output_hash must be present with fixed denominations only");
			if ("output_hash" in output && !isStringOfLength(output.output_hash, constants.HASH_LENGTH))
				return callback("invalid output hash");
			if (!objAsset.fixed_denominations && !(("blinding" in output) && ("address" in output)))
				return callback("no blinding or address");
			if ("blinding" in output && !isStringOfLength(output.blinding, 16))
				return callback("bad blinding");
			if (("blinding" in output) !== ("address" in output))
				return callback("address and bilinding must come together");
			if ("address" in output && !ValidationUtils.isValidAddressAnyCase(output.address))
				return callback("output address "+output.address+" invalid");
			if (output.address)
				count_open_outputs++;
		}
		else{
			if ("blinding" in output)
				return callback("public output must not have blinding");
			if ("output_hash" in output)
				return callback("public output must not have output_hash");
			if (!ValidationUtils.isValidAddressAnyCase(output.address))
				return callback("output address "+output.address+" invalid");
			if (prev_address > output.address)
				return callback("output addresses not sorted");
			else if (prev_address === output.address && prev_amount > output.amount)
				return callback("output amounts for same address not sorted");
			prev_address = output.address;
			prev_amount = output.amount;
		}
		if (output.address && arrOutputAddresses.indexOf(output.address) === -1)
			arrOutputAddresses.push(output.address);
		total_output += output.amount;
	}
	if (objAsset && objAsset.is_private && count_open_outputs !== 1)
		return callback("found "+count_open_outputs+" open outputs, expected 1");

	var bIssue = false;
	var bHaveHeadersComissions = false;
	var bHaveWitnessings = false;
	
	// same for both public and private
	function validateIndivisibleIssue(input, cb){
	//	if (objAsset)
	//		profiler2.start();
		conn.query(
			"SELECT count_coins FROM asset_denominations WHERE asset=? AND denomination=?", 
			[payload.asset, denomination], 
			function(rows){
				if (rows.length === 0)
					return cb("invalid denomination: "+denomination);
				if (rows.length > 1)
					throw Error("more than one record per denomination?");
				var denomInfo = rows[0];
				if (denomInfo.count_coins === null){ // uncapped
					if (input.amount % denomination !== 0)
						return cb("issue amount must be multiple of denomination");
				}
				else{
					if (input.amount !== denomination * denomInfo.count_coins)
						return cb("wrong size of issue of denomination "+denomination);
				}
			//	if (objAsset)
			//		profiler2.stop('validateIndivisibleIssue');
				cb();
			}
		);
	}
	
//	if (objAsset)
//		profiler2.stop('validate outputs');
	
	// max 1 issue must come first, then transfers, then hc, then witnessings
	// no particular sorting order within the groups
	async.forEachOfSeries(
		payload.inputs,
		function(input, input_index, cb){
			if (objAsset){
				if ("type" in input && input.type !== "issue")
					return cb("non-base input can have only type=issue");
			}
			else{
				if ("type" in input && !isNonemptyString(input.type))
					return cb("bad input type");
			}
			var type = input.type || "transfer";

			var doubleSpendFields = "unit, address, message_index, input_index, main_chain_index, sequence, is_stable";
			var doubleSpendWhere;
			var doubleSpendVars = [];
			var doubleSpendIndexMySQL = "";
			function checkInputDoubleSpend(cb2){
			//	if (objAsset)
			//		profiler2.start();
				doubleSpendWhere += " AND unit != " + conn.escape(objUnit.unit);
				if (objAsset){
					doubleSpendWhere += " AND asset=?";
					doubleSpendVars.push(payload.asset);
				}
				else
					doubleSpendWhere += " AND asset IS NULL";
				var doubleSpendQuery = "SELECT "+doubleSpendFields+" FROM inputs " + doubleSpendIndexMySQL + " JOIN units USING(unit) WHERE "+doubleSpendWhere;
				checkForDoublespends(
					conn, "divisible input", 
					doubleSpendQuery, doubleSpendVars, 
					objUnit, objValidationState, 
					function acceptDoublespends(cb3){
						console.log("--- accepting doublespend on unit "+objUnit.unit);
						var sql = "UPDATE inputs SET is_unique=NULL WHERE "+doubleSpendWhere+
							" AND (SELECT is_stable FROM units WHERE units.unit=inputs.unit)=0";
						if (!(objAsset && objAsset.is_private)){
							objValidationState.arrAdditionalQueries.push({sql: sql, params: doubleSpendVars});
							objValidationState.arrDoubleSpendInputs.push({message_index: message_index, input_index: input_index});
							return cb3();
						}
						mutex.lock(["private_write"], function(unlock){
							console.log("--- will ununique the conflicts of unit "+objUnit.unit);
							conn.query(
								sql, 
								doubleSpendVars, 
								function(){
									console.log("--- ununique done unit "+objUnit.unit);
									objValidationState.arrDoubleSpendInputs.push({message_index: message_index, input_index: input_index});
									unlock();
									cb3();
								}
							);
						});
					}, 
					function onDone(err){
						if (err && objAsset && objAsset.is_private)
							throw Error("spend proof didn't help: "+err);
					//	if (objAsset)
					//		profiler2.stop('checkInputDoubleSpend');
						cb2(err);
					}
				);
			}

			switch (type){
				case "issue":
				//	if (objAsset)
				//		profiler2.start();
					if (input_index !== 0)
						return cb("issue must come first");
					if (hasFieldsExcept(input, ["type", "address", "amount", "serial_number"]))
						return cb("unknown fields in issue input");
					if (!isPositiveInteger(input.amount))
						return cb("amount must be positive");
					if (!isPositiveInteger(input.serial_number))
						return cb("serial_number must be positive");
					if (!objAsset || objAsset.cap){
						if (input.serial_number !== 1)
							return cb("for capped asset serial_number must be 1");
					}
					if (bIssue)
						return cb("only one issue per message allowed");
					bIssue = true;
					
					var address = null;
					if (arrAuthorAddresses.length === 1){
						if ("address" in input)
							return cb("when single-authored, must not put address in issue input");
						address = arrAuthorAddresses[0];
					}
					else{
						if (typeof input.address !== "string")
							return cb("when multi-authored, must put address in issue input");
						if (arrAuthorAddresses.indexOf(input.address) === -1)
							return cb("issue input address "+input.address+" is not an author");
						address = input.address;
					}
					
					arrInputAddresses = [address];
					if (objAsset){
						if (objAsset.cap && !objAsset.fixed_denominations && input.amount !== objAsset.cap)
							return cb("issue must be equal to cap");
					}
					else{
						if (!storage.isGenesisUnit(objUnit.unit))
							return cb("only genesis can issue base asset");
						if (input.amount !== constants.TOTAL_WHITEBYTES)
							return cb("issue must be equal to cap");
					}
					total_input += input.amount;
					
					var input_key = (payload.asset || "base") + "-" + denomination + "-" + address + "-" + input.serial_number;
					if (objValidationState.arrInputKeys.indexOf(input_key) >= 0)
						return callback("input "+input_key+" already used");
					objValidationState.arrInputKeys.push(input_key);
					doubleSpendWhere = "type='issue'";
					doubleSpendVars = [];
					if (objAsset && objAsset.fixed_denominations){
						doubleSpendWhere += " AND denomination=?";
						doubleSpendVars.push(denomination);
					}
					if (objAsset){
						doubleSpendWhere += " AND serial_number=?";
						doubleSpendVars.push(input.serial_number);
					}
					if (objAsset && !objAsset.issued_by_definer_only){
						doubleSpendWhere += " AND address=?";
						doubleSpendVars.push(address);
					}
				//	if (objAsset)
				//		profiler2.stop('validate issue');
					if (objAsset && objAsset.fixed_denominations){
						validateIndivisibleIssue(input, function(err){
							if (err)
								return cb(err);
							checkInputDoubleSpend(cb);
						});
					}
					else
						checkInputDoubleSpend(cb);
					// attestations and issued_by_definer_only already checked before
					break;
					
				case "transfer":
				//	if (objAsset)
				//		profiler2.start();
					if (bHaveHeadersComissions || bHaveWitnessings)
						return cb("all transfers must come before hc and witnessings");
					if (hasFieldsExcept(input, ["type", "unit", "message_index", "output_index"]))
						return cb("unknown fields in payment input");
					if (!isStringOfLength(input.unit, constants.HASH_LENGTH))
						return cb("wrong unit length in payment input");
					if (!isNonnegativeInteger(input.message_index))
						return cb("no message_index in payment input");
					if (!isNonnegativeInteger(input.output_index))
						return cb("no output_index in payment input");
					
					var input_key = (payload.asset || "base") + "-" + input.unit + "-" + input.message_index + "-" + input.output_index;
					if (objValidationState.arrInputKeys.indexOf(input_key) >= 0)
						return cb("input "+input_key+" already used");
					objValidationState.arrInputKeys.push(input_key);
					
					doubleSpendWhere = "type=? AND src_unit=? AND src_message_index=? AND src_output_index=?";
					doubleSpendVars = [type, input.unit, input.message_index, input.output_index];
					if (conf.storage == "mysql")
						doubleSpendIndexMySQL = " FORCE INDEX(bySrcOutput) ";

					// for private fixed denominations assets, we can't look up src output in the database 
					// because we validate the entire chain before saving anything.
					// Instead we prepopulate objValidationState with denomination and src_output 
					if (objAsset && objAsset.is_private && objAsset.fixed_denominations){
						if (!objValidationState.src_coin)
							throw Error("no src_coin");
						var src_coin = objValidationState.src_coin;
						if (!src_coin.src_output)
							throw Error("no src_output");
						if (!isPositiveInteger(src_coin.denomination))
							throw Error("no denomination in src coin");
						if (!isPositiveInteger(src_coin.amount))
							throw Error("no src coin amount");
						var owner_address = src_coin.src_output.address;
						if (arrAuthorAddresses.indexOf(owner_address) === -1)
							return cb("output owner is not among authors");
						if (denomination !== src_coin.denomination)
							return cb("private denomination mismatch");
						if (objAsset.auto_destroy && owner_address === objAsset.definer_address)
							return cb("this output was destroyed by sending to definer address");
						if (objAsset.spender_attested && objAsset.arrAttestedAddresses.indexOf(owner_address) === -1)
							return cb("owner address is not attested");
						if (arrInputAddresses.indexOf(owner_address) === -1)
							arrInputAddresses.push(owner_address);
						total_input += src_coin.amount;
						console.log("-- val state "+JSON.stringify(objValidationState));
					//	if (objAsset)
					//		profiler2.stop('validate transfer');
						return checkInputDoubleSpend(cb);
					}
					
					conn.query(
						"SELECT amount, is_stable, sequence, address, main_chain_index, denomination, asset \n\
						FROM outputs \n\
						JOIN units USING(unit) \n\
						WHERE outputs.unit=? AND message_index=? AND output_index=?",
						[input.unit, input.message_index, input.output_index],
						function(rows){
							if (rows.length > 1)
								throw Error("more than 1 src output");
							if (rows.length === 0)
								return cb("input unit "+input.unit+" not found");
							var src_output = rows[0];
							if (typeof src_output.amount !== 'number')
								throw Error("src output amount is not a number");
							if (!(!payload.asset && !src_output.asset || payload.asset === src_output.asset))
								return cb("asset mismatch");
							//if (src_output.is_stable !== 1) // we allow immediate spends, that's why the error is transient
							//    return cb(createTransientError("input unit is not on stable MC yet, unit "+objUnit.unit+", input "+input.unit));
							if (src_output.main_chain_index !== null && src_output.main_chain_index <= objValidationState.last_ball_mci && src_output.sequence !== 'good')
								return cb("stable input unit "+input.unit+" is not serial");
							if (objValidationState.last_ball_mci < constants.spendUnconfirmedUpgradeMci){
								if (!objAsset || !objAsset.is_private){
									// for public payments, you can't spend unconfirmed transactions
									if (src_output.main_chain_index > objValidationState.last_ball_mci || src_output.main_chain_index === null)
										return cb("src output must be before last ball");
								}
								if (src_output.sequence !== 'good') // it is also stable or private
									return cb("input unit "+input.unit+" is not serial");
							}
							else{ // after this MCI, spending unconfirmed is allowed for public assets too, non-good sequence will be inherited
								if (src_output.sequence !== 'good'){
									if (objValidationState.sequence === 'good' || objValidationState.sequence === 'temp-bad')
										objValidationState.sequence = src_output.sequence;
								}
							}
							var owner_address = src_output.address;
							if (arrAuthorAddresses.indexOf(owner_address) === -1)
								return cb("output owner is not among authors");
							if (denomination !== src_output.denomination)
								return cb("denomination mismatch");
							if (objAsset && objAsset.auto_destroy && owner_address === objAsset.definer_address)
								return cb("this output was destroyed by sending it to definer address");
							if (objAsset && objAsset.spender_attested && objAsset.arrAttestedAddresses.indexOf(owner_address) === -1)
								return cb("owner address is not attested");
							if (arrInputAddresses.indexOf(owner_address) === -1)
								arrInputAddresses.push(owner_address);
							total_input += src_output.amount;
							
							if (src_output.main_chain_index !== null && src_output.main_chain_index <= objValidationState.last_ball_mci)
								return checkInputDoubleSpend(cb);

							// the below is for unstable inputs only.
							// when divisible, the asset is also non-transferrable and auto-destroy, 
							// then this transfer is a transfer back to the issuer 
							// and input.unit is known both to payer and the payee (issuer), even if light
							graph.determineIfIncludedOrEqual(conn, input.unit, objUnit.parent_units, function(bIncluded){
								if (!bIncluded)
									return cb("input "+input.unit+" is not in your genes");
								checkInputDoubleSpend(cb);
							});
						}
					);
					break;


				case "headers_commission":
				case "witnessing":
					if (type === "headers_commission"){
						if (bHaveWitnessings)
							return cb("all headers commissions must come before witnessings");
						bHaveHeadersComissions = true;
					}
					else
						bHaveWitnessings = true;
					if (objAsset)
						return cb("only base asset can have "+type);
					if (hasFieldsExcept(input, ["type", "from_main_chain_index", "to_main_chain_index", "address"]))
						return cb("unknown fields in witnessing input");
					if (!isNonnegativeInteger(input.from_main_chain_index))
						return cb("from_main_chain_index must be nonnegative int");
					if (!isNonnegativeInteger(input.to_main_chain_index))
						return cb("to_main_chain_index must be nonnegative int");
					if (input.from_main_chain_index > input.to_main_chain_index)
						return cb("from_main_chain_index > input.to_main_chain_index");
					if (input.to_main_chain_index > objValidationState.last_ball_mci)
						return cb("to_main_chain_index > last_ball_mci");
					if (input.from_main_chain_index > objValidationState.last_ball_mci)
						return cb("from_main_chain_index > last_ball_mci");

					var address = null;
					if (arrAuthorAddresses.length === 1){
						if ("address" in input)
							return cb("when single-authored, must not put address in "+type+" input");
						address = arrAuthorAddresses[0];
					}
					else{
						if (typeof input.address !== "string")
							return cb("when multi-authored, must put address in "+type+" input");
						if (arrAuthorAddresses.indexOf(input.address) === -1)
							return cb(type+" input address "+input.address+" is not an author");
						address = input.address;
					}

					var input_key = type + "-" + address + "-" + input.from_main_chain_index;
					if (objValidationState.arrInputKeys.indexOf(input_key) >= 0)
						return cb("input "+input_key+" already used");
					objValidationState.arrInputKeys.push(input_key);
					
					doubleSpendWhere = "type=? AND from_main_chain_index=? AND address=? AND asset IS NULL";
					doubleSpendVars = [type, input.from_main_chain_index, address];
					if (conf.storage == "mysql")
						doubleSpendIndexMySQL = " USE INDEX (byIndexAddress) ";

					mc_outputs.readNextSpendableMcIndex(conn, type, address, objValidationState.arrConflictingUnits, function(next_spendable_mc_index){
						if (input.from_main_chain_index < next_spendable_mc_index)
							return cb(type+" ranges must not overlap"); // gaps allowed, in case a unit becomes bad due to another address being nonserial
						var max_mci = (type === "headers_commission") 
							? headers_commission.getMaxSpendableMciForLastBallMci(objValidationState.last_ball_mci)
							: paid_witnessing.getMaxSpendableMciForLastBallMci(objValidationState.last_ball_mci);
						if (input.to_main_chain_index > max_mci)
							return cb(type+" to_main_chain_index is too large");

						var calcFunc = (type === "headers_commission") ? mc_outputs.calcEarnings : paid_witnessing.calcWitnessEarnings;
						calcFunc(conn, type, input.from_main_chain_index, input.to_main_chain_index, address, {
							ifError: function(err){
								throw Error(err);
							},
							ifOk: function(commission){
								if (commission === 0)
									return cb("zero "+type+" commission");
								total_input += commission;
								checkInputDoubleSpend(cb);
							}
						});
					});
					break;

				default:
					return cb("unrecognized input type: "+input.type);
			}
		},
		function(err){
			console.log("inputs done "+payload.asset, arrInputAddresses, arrOutputAddresses);
			if (err)
				return callback(err);
			if (objAsset){
				if (total_input !== total_output)
					return callback("inputs and outputs do not balance: "+total_input+" !== "+total_output);
				if (!objAsset.is_transferrable){ // the condition holds for issues too
					if (arrInputAddresses.length === 1 && arrInputAddresses[0] === objAsset.definer_address
					   || arrOutputAddresses.length === 1 && arrOutputAddresses[0] === objAsset.definer_address
						// sending payment to the definer and the change back to oneself
					   || !(objAsset.fixed_denominations && objAsset.is_private) 
							&& arrInputAddresses.length === 1 && arrOutputAddresses.length === 2 
							&& arrOutputAddresses.indexOf(objAsset.definer_address) >= 0
							&& arrOutputAddresses.indexOf(arrInputAddresses[0]) >= 0
					   ){
						// good
					}
					else
						return callback("the asset is not transferrable");
				}
				async.series([
					function(cb){
						if (!objAsset.spender_attested)
							return cb();
						storage.filterAttestedAddresses(
							conn, objAsset, objValidationState.last_ball_mci, arrOutputAddresses, 
							function(arrAttestedOutputAddresses){
								if (arrAttestedOutputAddresses.length !== arrOutputAddresses.length)
									return cb("some output addresses are not attested");
								cb();
							}
						);
					},
					function(cb){
						var arrCondition = bIssue ? objAsset.issue_condition : objAsset.transfer_condition;
						if (!arrCondition)
							return cb();
						Definition.evaluateAssetCondition(
							conn, payload.asset, arrCondition, objUnit, objValidationState, 
							function(cond_err, bSatisfiesCondition){
								if (cond_err)
									return cb(cond_err);
								if (!bSatisfiesCondition)
									return cb("transfer or issue condition not satisfied");
								console.log("validatePaymentInputsAndOutputs with transfer/issue conditions done");
								cb();
							}
						);
					}
				], callback);
			}
			else{ // base asset
				if (total_input !== total_output + objUnit.headers_commission + objUnit.payload_commission)
					return callback("inputs and outputs do not balance: "+total_input+" !== "+total_output+" + "+objUnit.headers_commission+" + "+objUnit.payload_commission);
				callback();
			}
		//	console.log("validatePaymentInputsAndOutputs done");
		//	if (objAsset)
		//		profiler2.stop('validate IO');
		//	callback();
		}
	);
}


function initPrivatePaymentValidationState(conn, unit, message_index, payload, onError, onDone){
	conn.query(
		"SELECT payload_hash, app, units.sequence, units.version, units.is_stable, lb_units.main_chain_index AS last_ball_mci \n\
		FROM messages JOIN units USING(unit) \n\
		LEFT JOIN units AS lb_units ON units.last_ball_unit=lb_units.unit \n\
		WHERE messages.unit=? AND message_index=?", 
		[unit, message_index], 
		function(rows){
			if (rows.length > 1)
				throw Error("more than 1 message by index");
			if (rows.length === 0)
				return onError("message not found");
			var row = rows[0];
			if (row.sequence !== "good" && row.is_stable === 1)
				return onError("unit is final nonserial");
			var bStable = (row.is_stable === 1); // it's ok if the unit is not stable yet
			if (row.app !== "payment")
				return onError("invalid app");
			try{
				if (objectHash.getBase64Hash(payload, row.version !== constants.versionWithoutTimestamp) !== row.payload_hash)
					return onError("payload hash does not match");
			}
			catch(e){
				return onError("failed to calc payload hash: "+e);
			}
			var objValidationState = {
				last_ball_mci: row.last_ball_mci,
				arrDoubleSpendInputs: [],
				arrInputKeys: [],
				bPrivate: true
			};
			var objPartialUnit = {unit: unit};
			storage.readUnitAuthors(conn, unit, function(arrAuthors){
				objPartialUnit.authors = arrAuthors.map(function(address){ return {address: address}; }); // array of objects {address: address}
				// we need parent_units in checkForDoublespends in case it is a doublespend
				conn.query("SELECT parent_unit FROM parenthoods WHERE child_unit=? ORDER BY parent_unit", [unit], function(prows){
					objPartialUnit.parent_units = prows.map(function(prow){ return prow.parent_unit; });
					onDone(bStable, objPartialUnit, objValidationState);
				});
			});
		}
	);
}


function validateAssetDefinition(conn, payload, objUnit, objValidationState, callback){
	if (objUnit.authors.length !== 1)
		return callback("asset definition must be single-authored");
	if (hasFieldsExcept(payload, ["cap", "is_private", "is_transferrable", "auto_destroy", "fixed_denominations", "issued_by_definer_only", "cosigned_by_definer", "spender_attested", "issue_condition", "transfer_condition", "attestors", "denominations"]))
		return callback("unknown fields in asset definition");
	if (typeof payload.is_private !== "boolean" || typeof payload.is_transferrable !== "boolean" || typeof payload.auto_destroy !== "boolean" || typeof payload.fixed_denominations !== "boolean" || typeof payload.issued_by_definer_only !== "boolean" || typeof payload.cosigned_by_definer !== "boolean" || typeof payload.spender_attested !== "boolean")
		return callback("some required fields in asset definition are missing");

	if ("cap" in payload && !(isPositiveInteger(payload.cap) && payload.cap <= constants.MAX_CAP))
		return callback("invalid cap");

	// attestors
	var err;
	if ( payload.spender_attested && (err=checkAttestorList(payload.attestors)) )
		return callback(err);

	// denominations
	if (payload.fixed_denominations && !isNonemptyArray(payload.denominations))
		return callback("denominations not defined");
	if (payload.denominations){
		if (payload.denominations.length > constants.MAX_DENOMINATIONS_PER_ASSET_DEFINITION)
			return callback("too many denominations");
		var total_cap_from_denominations = 0;
		var bHasUncappedDenominations = false;
		var prev_denom = 0;
		for (var i=0; i<payload.denominations.length; i++){
			var denomInfo = payload.denominations[i];
			if (!isPositiveInteger(denomInfo.denomination))
				return callback("invalid denomination");
			if (denomInfo.denomination <= prev_denom)
				return callback("denominations unsorted");
			if ("count_coins" in denomInfo){
				if (!isPositiveInteger(denomInfo.count_coins))
					return callback("invalid count_coins");
				total_cap_from_denominations += denomInfo.count_coins * denomInfo.denomination;
			}
			else
				bHasUncappedDenominations = true;
			prev_denom = denomInfo.denomination;
		}
		if (bHasUncappedDenominations && total_cap_from_denominations)
			return callback("some denominations are capped, some uncapped");
		if (bHasUncappedDenominations && payload.cap)
			return callback("has cap but some denominations are uncapped");
		if (total_cap_from_denominations && !payload.cap)
			return callback("has no cap but denominations are capped");
		if (total_cap_from_denominations && payload.cap !== total_cap_from_denominations)
			return callback("cap doesn't match sum of denominations");
	}
	
	if (payload.is_private && payload.is_transferrable && !payload.fixed_denominations)
		return callback("if private and transferrable, must have fixed denominations");
	if (payload.is_private && !payload.fixed_denominations){
		if (!(payload.auto_destroy && !payload.is_transferrable))
			return callback("if private and divisible, must also be auto-destroy and non-transferrable");
	}
	if (payload.cap && !payload.issued_by_definer_only)
		return callback("if capped, must be issued by definer only");
	
	// possible: definer is like black hole
	//if (!payload.issued_by_definer_only && payload.auto_destroy)
	//    return callback("if issued by anybody, cannot auto-destroy");
	
	// possible: the entire issue should go to the definer
	//if (!payload.issued_by_definer_only && !payload.is_transferrable)
	//    return callback("if issued by anybody, must be transferrable");
	
	objValidationState.bDefiningPrivateAsset = payload.is_private;
	
	async.series([
		function(cb){
			if (!("issue_condition" in payload))
				return cb();
			Definition.validateDefinition(conn, payload.issue_condition, objUnit, objValidationState, null, true, cb);
		},
		function(cb){
			if (!("transfer_condition" in payload))
				return cb();
			Definition.validateDefinition(conn, payload.transfer_condition, objUnit, objValidationState, null, true, cb);
		}
	], callback);
}

function validateAttestorListUpdate(conn, payload, objUnit, objValidationState, callback){
	if (objUnit.authors.length !== 1)
		return callback("attestor list must be single-authored");
	if (!isStringOfLength(payload.asset, constants.HASH_LENGTH))
		return callback("invalid asset in attestor list update");
	storage.readAsset(conn, payload.asset, objValidationState.last_ball_mci, function(err, objAsset){
		if (err)
			return callback(err);
		if (!objAsset.spender_attested)
			return callback("this asset does not require attestors");
		if (objUnit.authors[0].address !== objAsset.definer_address)
			return callback("attestor list can be edited only by definer");
		err = checkAttestorList(payload.attestors);
		if (err)
			return callback(err);
		callback();
	});
}

function checkAttestorList(arrAttestors){
	if (!isNonemptyArray(arrAttestors))
		return "attestors not defined";
	if (arrAttestors.length > constants.MAX_ATTESTORS_PER_ASSET)
		return "too many attestors";
	var prev="";
	for (var i=0; i<arrAttestors.length; i++){
		if (arrAttestors[i] <= prev)
			return "attestors not sorted";
		if (!isValidAddress(arrAttestors[i]))
			return "invalid attestor address: "+arrAttestors[i];
		prev = arrAttestors[i];
	}
	return null;
}



function validateAuthorSignaturesWithoutReferences(objAuthor, objUnit, arrAddressDefinition, callback){
	var objValidationState = {
		unit_hash_to_sign: objectHash.getUnitHashToSign(objUnit),
		last_ball_mci: -1,
		bNoReferences: true
	};
	Definition.validateAuthentifiers(
		null, objAuthor.address, null, arrAddressDefinition, objUnit, objValidationState, objAuthor.authentifiers, 
		function(err, res){
			if (err) // error in address definition
				return callback(err);
			if (!res) // wrong signature or the like
				return callback("authentifier verification failed");
			callback();
		}
	);
}


function createTransientError(err){
	return {
		error_code: "transient", 
		message: err
	};
}

// A problem is with the joint rather than with the unit. That is, the field that has an issue is not covered by unit hash.
function createJointError(err){
	return {
		error_code: "invalid_joint", 
		message: err
	};
}


function validateSignedMessage(objSignedMessage, handleResult){
	if (typeof objSignedMessage !== 'object')
		return handleResult("not an object");
	if (ValidationUtils.hasFieldsExcept(objSignedMessage, ["signed_message", "authors", "last_ball_unit", "timestamp"]))
		return handleResult("unknown fields");
	if (typeof objSignedMessage.signed_message !== 'string')
		return handleResult("signed message not a string");
	if (!Array.isArray(objSignedMessage.authors))
		return handleResult("authors not an array");
	if (!ValidationUtils.isArrayOfLength(objSignedMessage.authors, 1))
		return handleResult("authors not an array of len 1");
	var objAuthor = objSignedMessage.authors[0];
	if (!objAuthor)
		return handleResult("no authors[0]");
	if (!ValidationUtils.isValidAddress(objAuthor.address))
		return handleResult("not valid address");
	if (typeof objAuthor.authentifiers !== 'object')
		return handleResult("not valid authentifiers");
	var arrAddressDefinition = objAuthor.definition;
	try{
		if (objectHash.getChash160(arrAddressDefinition) !== objAuthor.address)
			return handleResult("wrong definition: "+objectHash.getChash160(arrAddressDefinition) +"!=="+ objAuthor.address);
	} catch(e) {
		return handleResult("failed to calc address definition hash: " +e);
	}
	var objUnit = _.clone(objSignedMessage);
	objUnit.messages = []; // some ops need it
	try{
		var objValidationState = {
			unit_hash_to_sign: objectHash.getUnitHashToSign(objSignedMessage),
			last_ball_mci: -1,
			bNoReferences: true
		};
	}
	catch(e) {
		return handleResult("failed to calc unit_hash_to_sign: " +e);
	}
	// passing db as null
	Definition.validateAuthentifiers(
		null, objAuthor.address, null, arrAddressDefinition, objUnit, objValidationState, objAuthor.authentifiers, 
		function(err, res){
			if (err) // error in address definition
				return handleResult(err);
			if (!res) // wrong signature or the like
				return handleResult("authentifier verification failed");
			handleResult();
		}
	);
}

// inconsistent for multisig addresses
function validateSignedMessageSync(objSignedMessage){
	var err;
	var bCalledBack = false;
	validateSignedMessage(objSignedMessage, function(_err){
		err = _err;
		bCalledBack = true;
	});
	if (!bCalledBack)
		throw Error("validateSignedMessage is not sync");
	return err;
}

exports.validate = validate;
exports.hasValidHashes = hasValidHashes;
exports.validateAuthorSignaturesWithoutReferences = validateAuthorSignaturesWithoutReferences;
exports.validatePayment = validatePayment;
exports.initPrivatePaymentValidationState = initPrivatePaymentValidationState;
exports.validateSignedMessage = validateSignedMessage;
exports.validateSignedMessageSync = validateSignedMessageSync;

