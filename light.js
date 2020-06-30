/*jslint node: true */
"use strict";
var async = require('async');
var storage = require('./storage.js');
var archiving = require('./archiving.js');
var objectHash = require("./object_hash.js");
var conf = require('./conf.js');
var db = require('./db.js');
var mutex = require('./mutex.js');
var constants = require("./constants.js");
var graph = require('./graph.js');
var writer = require('./writer.js');
var validation = require('./validation.js');
var witnessProof = require('./witness_proof.js');
var ValidationUtils = require("./validation_utils.js");
var parentComposer = require('./parent_composer.js');
var breadcrumbs = require('./breadcrumbs.js');
var eventBus = require('./event_bus.js');
var proofChain = require('./proof_chain.js');
var _ = require('lodash');

var MAX_HISTORY_ITEMS = 2000;

function isValidUnitHash(unit) {
	return ValidationUtils.isValidBase64(unit, constants.HASH_LENGTH);
}

function prepareHistory(historyRequest, callbacks){
	if (!historyRequest)
		return callbacks.ifError("no history request");
	var arrKnownStableUnits = historyRequest.known_stable_units;
	var arrWitnesses = historyRequest.witnesses;
	var arrAddresses = historyRequest.addresses;
	var arrRequestedJoints = historyRequest.requested_joints;
	var mci = historyRequest.mci|0;

	if (!arrAddresses && !arrRequestedJoints)
		return callbacks.ifError("neither addresses nor joints requested");
	if (arrAddresses){
		if (!ValidationUtils.isNonemptyArray(arrAddresses))
			return callbacks.ifError("no addresses");
		if (!arrAddresses.every(ValidationUtils.isValidAddress))
			return callbacks.ifError("some addresses are not valid");
		if (mci && !ValidationUtils.isPositiveInteger(mci))
			return callbacks.ifError("mci should be positive integer");
	}
	if (arrRequestedJoints) {
		if (!ValidationUtils.isNonemptyArray(arrRequestedJoints))
			return callbacks.ifError("no requested joints");
		if (!arrRequestedJoints.every(isValidUnitHash))
			return callbacks.ifError("invalid requested joints");
	}
	if (!ValidationUtils.isArrayOfLength(arrWitnesses, constants.COUNT_WITNESSES))
		return callbacks.ifError("wrong number of witnesses");
		
	var assocKnownStableUnits = {};
	if (arrKnownStableUnits) {
		if (!ValidationUtils.isNonemptyArray(arrKnownStableUnits))
			return callbacks.ifError("known_stable_units must be non-empty array");
		if (!arrKnownStableUnits.every(isValidUnitHash))
			return callbacks.ifError("invalid known stable units");
		arrKnownStableUnits.forEach(function (unit) {
			assocKnownStableUnits[unit] = true;
		});
	}
	
	var objResponse = {};

	// add my joints and proofchain to these joints
	var arrSelects = [];
	if (arrAddresses){
		// we don't filter sequence='good' after the unit is stable, so the client will see final doublespends too
		var strAddressList = arrAddresses.map(db.escape).join(', ');
		var mciCond = mci ? " AND main_chain_index >= " + mci : "";
		arrSelects = ["SELECT DISTINCT unit, main_chain_index, level FROM outputs JOIN units USING(unit) \n\
			WHERE address IN("+strAddressList+") AND (+sequence='good' OR is_stable=1)"+mciCond+"\n\
			UNION \n\
			SELECT DISTINCT unit, main_chain_index, level FROM unit_authors JOIN units USING(unit) \n\
			WHERE address IN(" + strAddressList + ") AND (+sequence='good' OR is_stable=1)"+mciCond+" \n\
			UNION \n\
			SELECT DISTINCT unit, main_chain_index, level FROM aa_responses JOIN units ON trigger_unit=unit \n\
			WHERE aa_address IN(" + strAddressList + ")"+mciCond];
	}
	if (arrRequestedJoints){
		var strUnitList = arrRequestedJoints.map(db.escape).join(', ');
		arrSelects.push("SELECT unit, main_chain_index, level FROM units WHERE unit IN("+strUnitList+") AND (+sequence='good' OR is_stable=1) \n");
	}
	var sql = arrSelects.join("UNION \n") + "ORDER BY main_chain_index DESC, level DESC";
	db.query(sql, function(rows){
		// if no matching units, don't build witness proofs
		rows = rows.filter(function(row){ return !assocKnownStableUnits[row.unit]; });
		if (rows.length === 0)
			return callbacks.ifOk(objResponse);
		if (rows.length > MAX_HISTORY_ITEMS)
			return callbacks.ifError("your history is too large, consider switching to a full client");

		mutex.lock(['prepareHistory'], function(unlock){
			var start_ts = Date.now();
			witnessProof.prepareWitnessProof(
				arrWitnesses, 0, 
				function(err, arrUnstableMcJoints, arrWitnessChangeAndDefinitionJoints, last_ball_unit, last_ball_mci){
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
					var later_mci = last_ball_mci+1; // +1 so that last ball itself is included in the chain
					async.eachSeries(
						rows,
						function(row, cb2){
							storage.readJoint(db, row.unit, {
								ifNotFound: function(){
									throw Error("prepareJointsWithProofs unit not found "+row.unit);
								},
								ifFound: function(objJoint){
									objResponse.joints.push(objJoint);
									if (row.main_chain_index > last_ball_mci || row.main_chain_index === null) // unconfirmed, no proofchain
										return cb2();
									proofChain.buildProofChain(later_mci, row.main_chain_index, row.unit, objResponse.proofchain_balls, function(){
										later_mci = row.main_chain_index;
										cb2();
									});
								}
							});
						},
						function(){
							//if (objResponse.joints.length > 0 && objResponse.proofchain_balls.length === 0)
							//    throw "no proofs";
							if (objResponse.proofchain_balls.length === 0)
								delete objResponse.proofchain_balls;
							var arrUnits = objResponse.joints.map(function (objJoint) { return objJoint.unit.unit; });
							db.query("SELECT mci, trigger_address, aa_address, trigger_unit, bounced, response_unit, response, creation_date FROM aa_responses WHERE trigger_unit IN(" + arrUnits.map(db.escape).join(', ') + ") ORDER BY " + (conf.storage === 'sqlite' ? 'rowid' : 'mci'), function (aa_rows) {
								// there is nothing to prove that responses are authentic
								if (aa_rows.length > 0)
									objResponse.aa_responses = aa_rows.map(function (aa_row) {
										objectHash.cleanNulls(aa_row);
										return aa_row;
									});
								callbacks.ifOk(objResponse);
								console.log("prepareHistory for addresses "+(arrAddresses || []).join(', ')+" and joints "+(arrRequestedJoints || []).join(', ')+" took "+(Date.now()-start_ts)+'ms');
								unlock();
							});
						}
					);
				}
			);
		});
	});
}


function processHistory(objResponse, arrWitnesses, callbacks){
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
		objResponse.unstable_mc_joints, objResponse.witness_change_and_definition_joints, false, arrWitnesses,
		function(err, arrLastBallUnits, assocLastBallByLastBallUnit){
			
			if (err)
				return callbacks.ifError(err);
			
			var assocKnownBalls = {};
			for (var unit in assocLastBallByLastBallUnit){
				var ball = assocLastBallByLastBallUnit[unit];
				assocKnownBalls[ball] = true;
			}
		
			// proofchain
			var assocProvenUnitsNonserialness = {};
			for (var i=0; i<objResponse.proofchain_balls.length; i++){
				var objBall = objResponse.proofchain_balls[i];
				if (objBall.ball !== objectHash.getBallHash(objBall.unit, objBall.parent_balls, objBall.skiplist_balls, objBall.is_nonserial))
					return callbacks.ifError("wrong ball hash: unit "+objBall.unit+", ball "+objBall.ball);
				if (!assocKnownBalls[objBall.ball])
					return callbacks.ifError("ball not known: "+objBall.ball);
				objBall.parent_balls.forEach(function(parent_ball){
					assocKnownBalls[parent_ball] = true;
				});
				if (objBall.skiplist_balls)
					objBall.skiplist_balls.forEach(function(skiplist_ball){
						assocKnownBalls[skiplist_ball] = true;
					});
				assocProvenUnitsNonserialness[objBall.unit] = objBall.is_nonserial;
			}
			assocKnownBalls = null; // free memory

			// joints that pay to/from me and joints that I explicitly requested
			for (var i=0; i<objResponse.joints.length; i++){
				var objJoint = objResponse.joints[i];
				var objUnit = objJoint.unit;
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

			if (objResponse.aa_responses) {
				// AA responses are trusted without proof
				if (!ValidationUtils.isNonemptyArray(objResponse.aa_responses))
					return callbacks.ifError("aa_responses must be non-empty array");
				for (var i = 0; i < objResponse.aa_responses.length; i++){
					var aa_response = objResponse.aa_responses[i];
					if (!ValidationUtils.isPositiveInteger(aa_response.mci))
						return callbacks.ifError("bad mci");
					if (!ValidationUtils.isValidAddress(aa_response.trigger_address))
						return callbacks.ifError("bad trigger_address");
					if (!ValidationUtils.isValidAddress(aa_response.aa_address))
						return callbacks.ifError("bad aa_address");
					if (!ValidationUtils.isValidBase64(aa_response.trigger_unit, constants.HASH_LENGTH))
						return callbacks.ifError("bad trigger_unit");
					if (aa_response.bounced !== 0 && aa_response.bounced !== 1)
						return callbacks.ifError("bad bounced");
					if ("response_unit" in aa_response && !ValidationUtils.isValidBase64(aa_response.response_unit, constants.HASH_LENGTH))
						return callbacks.ifError("bad response_unit");
					try {
						JSON.parse(aa_response.response);
					}
					catch (e) {
						return callbacks.ifError("bad response json");
					}
					if (objResponse.joints.filter(function (objJoint) { return (objJoint.unit.unit === aa_response.trigger_unit) }).length === 0)
						return callbacks.ifError("foreign trigger_unit");
				}
			}

			// save joints that pay to/from me and joints that I explicitly requested
			mutex.lock(["light_joints"], function(unlock){
				var arrUnits = objResponse.joints.map(function(objJoint){ return objJoint.unit.unit; });
				breadcrumbs.add('got light_joints for processHistory '+arrUnits.join(', '));
				db.query("SELECT unit, is_stable FROM units WHERE unit IN("+arrUnits.map(db.escape).join(', ')+")", function(rows){
					var assocExistingUnits = {};
					rows.forEach(function(row){
						assocExistingUnits[row.unit] = true;
					});
					var arrNewUnits = [];
					var arrProvenUnits = [];
					async.eachSeries(
						objResponse.joints.reverse(), // have them in forward chronological order so that we correctly mark is_spent flag
						function(objJoint, cb2){
							var objUnit = objJoint.unit;
							var unit = objUnit.unit;
							// assocProvenUnitsNonserialness[unit] is true for non-serials, false for serials, undefined for unstable
							var sequence = assocProvenUnitsNonserialness[unit] ? 'final-bad' : 'good';
							if (assocProvenUnitsNonserialness.hasOwnProperty(unit))
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
									function(){
										if (sequence === 'good')
											return cb2();
										// void the final-bad
										breadcrumbs.add('will void '+unit);
										db.executeInTransaction(function doWork(conn, cb3){
											var arrQueries = [];
											archiving.generateQueriesToArchiveJoint(conn, objJoint, 'voided', arrQueries, function(){
												async.series(arrQueries, cb3);
											});
										}, cb2);
									}
								);
							}
							else{
								arrNewUnits.push(unit);
								writer.saveJoint(objJoint, {sequence: sequence, arrDoubleSpendInputs: [], arrAdditionalQueries: []}, null, cb2);
							}
						},
						function(err){
							breadcrumbs.add('processHistory almost done');
							if (err){
								unlock();
								return callbacks.ifError(err);
							}
							fixIsSpentFlagAndInputAddress(function(){
								if (arrNewUnits.length > 0)
									emitNewMyTransactions(arrNewUnits);
								if (arrProvenUnits.length === 0){
									unlock();
									return callbacks.ifOk(true);
								}
								var sqlProvenUnits = arrProvenUnits.map(db.escape).join(', ');
								db.query("UPDATE inputs SET is_unique=1 WHERE unit IN("+sqlProvenUnits+")", function(){
									db.query("UPDATE units SET is_stable=1, is_free=0 WHERE unit IN("+sqlProvenUnits+")", function(){
										unlock();
										arrProvenUnits = arrProvenUnits.filter(function(unit){ return !assocProvenUnitsNonserialness[unit]; });
										if (arrProvenUnits.length === 0)
											return callbacks.ifOk(true);
										emitStability(arrProvenUnits, function(bEmitted){
											callbacks.ifOk(!bEmitted);
										});
									});
								});
							});
							// this can execute after callbacks
							if (!objResponse.aa_responses)
								return;
							var arrAAResponsesToEmit = [];
							async.eachSeries(objResponse.aa_responses, function (objAAResponse, cb3) {
								db.query(
									"INSERT " + db.getIgnore() + " INTO aa_responses (mci, trigger_address, aa_address, trigger_unit, bounced, response_unit, response, creation_date) VALUES (?, ?,?, ?, ?, ?,?, ?)",
									[objAAResponse.mci, objAAResponse.trigger_address, objAAResponse.aa_address, objAAResponse.trigger_unit, objAAResponse.bounced, objAAResponse.response_unit, objAAResponse.response, objAAResponse.creation_date],
									function (res) {
										if (res.affectedRows === 0) // don't emit events again
											return cb3();
										objAAResponse.response = JSON.parse(objAAResponse.response);
										arrAAResponsesToEmit.push(objAAResponse);
										return cb3();
									}
								);
							}, function () {
								arrAAResponsesToEmit.forEach(function (objAAResponse) {
									eventBus.emit('aa_response', objAAResponse);
									eventBus.emit('aa_response_to_unit-'+objAAResponse.trigger_unit, objAAResponse);
									eventBus.emit('aa_response_to_address-'+objAAResponse.trigger_address, objAAResponse);
									eventBus.emit('aa_response_from_aa-'+objAAResponse.aa_address, objAAResponse);
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
		CROSS JOIN inputs ON outputs.unit=inputs.src_unit AND outputs.message_index=inputs.src_message_index AND outputs.output_index=inputs.src_output_index \n\
		WHERE is_spent=0 AND type='transfer'",
		function(rows){
			console.log(rows.length+" previous outputs appear to be spent");
			if (rows.length === 0)
				return onDone();
			var arrQueries = [];
			rows.forEach(function(row){
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
		function(rows){
			console.log(rows.length+" previous inputs appear to be without address");
			if (rows.length === 0)
				return onDone();
			var arrQueries = [];
			rows.forEach(function(row){
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
	fixIsSpentFlag(function(){
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
		function(rows){
			handleResult(rows.length > 0);
		}
	);
}

function getSqlToFilterMyUnits(arrUnits){
	var strUnitList = arrUnits.map(db.escape).join(', ');
	return "SELECT unit FROM unit_authors JOIN my_addresses USING(address) WHERE unit IN("+strUnitList+") \n\
		UNION \n\
		SELECT unit FROM outputs JOIN my_addresses USING(address) WHERE unit IN("+strUnitList+") \n\
		UNION \n\
		SELECT unit FROM unit_authors JOIN shared_addresses ON address=shared_address WHERE unit IN("+strUnitList+") \n\
		UNION \n\
		SELECT unit FROM outputs JOIN shared_addresses ON address=shared_address WHERE unit IN("+strUnitList+")\n\
		UNION \n\
		SELECT unit FROM unit_authors JOIN my_watched_addresses USING(address) WHERE unit IN("+strUnitList+") \n\
		UNION \n\
		SELECT unit FROM outputs JOIN my_watched_addresses USING(address) WHERE unit IN("+strUnitList+")";
}

function emitStability(arrProvenUnits, onDone){
	db.query(
		getSqlToFilterMyUnits(arrProvenUnits),
		function(rows){
			onDone(rows.length > 0);
			if (rows.length > 0){
				eventBus.emit('my_transactions_became_stable', rows.map(function(row){ return row.unit; }));
				rows.forEach(function(row){
					eventBus.emit('my_stable-'+row.unit);
				});
			}
		}
	);
}

function emitNewMyTransactions(arrNewUnits){
	db.query(
		getSqlToFilterMyUnits(arrNewUnits),
		function(rows){
			if (rows.length > 0){
				eventBus.emit('new_my_transactions', rows.map(function(row){ return row.unit; }));
				rows.forEach(function(row){
					eventBus.emit("new_my_unit-"+row.unit);
				});
			}
		}
	);
}

function updateAndEmitBadSequenceUnits(arrBadSequenceUnits, retryDelay){
	if (!ValidationUtils.isNonemptyArray(arrBadSequenceUnits))
		return console.log("arrBadSequenceUnits not array or empty");
	if (!retryDelay)
		retryDelay = 100;
	if (retryDelay > 6400)
		return;
	db.query("SELECT unit FROM units WHERE unit IN (?)", [arrBadSequenceUnits], function(rows){
		var arrAlreadySavedUnits = rows.map(function(row){return row.unit});
		var arrNotSavedUnits = _.difference(arrBadSequenceUnits, arrAlreadySavedUnits);
		if (arrNotSavedUnits.length > 0)
			setTimeout(function(){
				updateAndEmitBadSequenceUnits(arrNotSavedUnits, retryDelay*2); // we retry later for units that are not validated and saved yet
			}, retryDelay);
		if (arrAlreadySavedUnits.length > 0)
			db.query("UPDATE units SET sequence='temp-bad' WHERE is_stable=0 AND unit IN (?)", [arrAlreadySavedUnits], function(){
				db.query(getSqlToFilterMyUnits(arrAlreadySavedUnits),
				function(arrMySavedUnitsRows){
					if (arrMySavedUnitsRows.length > 0)
						eventBus.emit('sequence_became_bad', arrMySavedUnitsRows.map(function(row){ return row.unit; }));
				});
			});
	});
}


function prepareParentsAndLastBallAndWitnessListUnit(arrWitnesses, callbacks){
	if (!ValidationUtils.isArrayOfLength(arrWitnesses, constants.COUNT_WITNESSES))
		return callbacks.ifError("wrong number of witnesses");
	storage.determineIfWitnessAddressDefinitionsHaveReferences(db, arrWitnesses, function(bWithReferences){
		if (bWithReferences)
			return callbacks.ifError("some witnesses have references in their addresses");
		db.takeConnectionFromPool(function(conn){
			var timestamp = Math.round(Date.now() / 1000);
			parentComposer.pickParentUnitsAndLastBall(
				conn,
				arrWitnesses,
				timestamp,
				function(err, arrParentUnits, last_stable_mc_ball, last_stable_mc_ball_unit, last_stable_mc_ball_mci){
					conn.release();
					if (err)
						return callbacks.ifError("unable to find parents: "+err);
					var objResponse = {
						timestamp: timestamp,
						parent_units: arrParentUnits,
						last_stable_mc_ball: last_stable_mc_ball,
						last_stable_mc_ball_unit: last_stable_mc_ball_unit,
						last_stable_mc_ball_mci: last_stable_mc_ball_mci
					};
					storage.findWitnessListUnit(db, arrWitnesses, last_stable_mc_ball_mci, function(witness_list_unit){
						if (witness_list_unit)
							objResponse.witness_list_unit = witness_list_unit;
						callbacks.ifOk(objResponse);
					});
				}
			);
		});
	});
}

// arrUnits sorted in reverse chronological order
function prepareLinkProofs(arrUnits, callbacks){
	if (!ValidationUtils.isNonemptyArray(arrUnits))
		return callbacks.ifError("no units array");
	if (arrUnits.length === 1)
		return callbacks.ifError("chain of one element");
	mutex.lock(['prepareLinkProofs'], function(unlock){
		var start_ts = Date.now();
		var arrChain = [];
		async.forEachOfSeries(
			arrUnits,
			function(unit, i, cb){
				if (i === 0)
					return cb();
				createLinkProof(arrUnits[i-1], arrUnits[i], arrChain, cb);
			},
			function(err){
				console.log("prepareLinkProofs for units "+arrUnits.join(', ')+" took "+(Date.now()-start_ts)+'ms, err='+err);
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
		ifNotFound: function(){
			cb("later unit not found");
		},
		ifFound: function(objLaterJoint){
			var later_mci = objLaterJoint.unit.main_chain_index;
			arrChain.push(objLaterJoint);
			storage.readUnitProps(db, objLaterJoint.unit.last_ball_unit, function(objLaterLastBallUnitProps){
				var later_lb_mci = objLaterLastBallUnitProps.main_chain_index;
				storage.readJoint(db, earlier_unit, {
					ifNotFound: function(){
						cb("earlier unit not found");
					},
					ifFound: function(objEarlierJoint){
						var earlier_mci = objEarlierJoint.unit.main_chain_index;
						var earlier_unit = objEarlierJoint.unit.unit;
						if (later_mci < earlier_mci && later_mci !== null && earlier_mci !== null)
							return cb("not included");
						if (later_lb_mci >= earlier_mci && earlier_mci !== null){ // was spent when confirmed
							// includes the ball of earlier unit
							proofChain.buildProofChain(later_lb_mci + 1, earlier_mci, earlier_unit, arrChain, function(){
								cb();
							});
						}
						else{ // the output was unconfirmed when spent
							graph.determineIfIncluded(db, earlier_unit, [later_unit], function(bIncluded){
								if (!bIncluded)
									return cb("not included");
								buildPath(objLaterJoint, objEarlierJoint, arrChain, function(){
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
			ifNotFound: function(){
				throw Error("unit not found?");
			},
			ifFound: function(objJoint){
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
			function(rows){
				if (rows.length !== 1)
					throw Error("goUp not 1 parent");
				if (rows[0].unit === objEarlierJoint.unit.unit)
					return onDone();
				if (rows[0].main_chain_index < objEarlierJoint.unit.main_chain_index && rows[0].main_chain_index !== null) // jumped over the target
					return buildPathToEarlierUnit(objChildJoint);
				addJoint(rows[0].unit, function(objJoint){
					(objJoint.unit.main_chain_index === objEarlierJoint.unit.main_chain_index) ? buildPathToEarlierUnit(objJoint) : goUp(objJoint);
				});
			}
		);
	}
	
	function buildPathToEarlierUnit(objJoint){
		if (objJoint.unit.main_chain_index === undefined)
			throw Error("mci undefined? unit="+objJoint.unit.unit+", mci="+objJoint.unit.main_chain_index+", earlier="+objEarlierJoint.unit.unit+", later="+objLaterJoint.unit.unit);
		db.query(
			"SELECT unit FROM parenthoods JOIN units ON parent_unit=unit \n\
			WHERE child_unit=?",// AND main_chain_index"+(objJoint.unit.main_chain_index === null ? ' IS NULL' : '='+objJoint.unit.main_chain_index), 
			[objJoint.unit.unit],
			function(rows){
				if (rows.length === 0)
					throw Error("no parents with same mci? unit="+objJoint.unit.unit+", mci="+objJoint.unit.main_chain_index+", earlier="+objEarlierJoint.unit.unit+", later="+objLaterJoint.unit.unit);
				var arrParentUnits = rows.map(function(row){ return row.unit });
				if (arrParentUnits.indexOf(objEarlierJoint.unit.unit) >= 0)
					return onDone();
				if (arrParentUnits.length === 1)
					return addJoint(arrParentUnits[0], buildPathToEarlierUnit);
				// find any parent that includes earlier unit
				async.eachSeries(
					arrParentUnits,
					function(unit, cb){
						graph.determineIfIncluded(db, objEarlierJoint.unit.unit, [unit], function(bIncluded){
							if (!bIncluded)
								return cb(); // try next
							cb(unit); // abort the eachSeries
						});
					},
					function(unit){
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
	var objFirstJoint = arrChain[0];
	if (!objFirstJoint || !objFirstJoint.unit || objFirstJoint.unit.unit !== arrUnits[0])
		return callbacks.ifError("unexpected 1st element");
	var assocKnownUnits = {};
	var assocKnownBalls = {};
	assocKnownUnits[arrUnits[0]] = true;
	for (var i=0; i<arrChain.length; i++){
		var objElement = arrChain[i];
		if (objElement.unit && objElement.unit.unit){
			var objJoint = objElement;
			var objUnit = objJoint.unit;
			var unit = objUnit.unit;
			if (!assocKnownUnits[unit])
				return callbacks.ifError("unknown unit "+unit);
			if (!validation.hasValidHashes(objJoint))
				return callbacks.ifError("invalid hash of unit "+unit);
			assocKnownBalls[objUnit.last_ball] = true;
			assocKnownUnits[objUnit.last_ball_unit] = true;
			objUnit.parent_units.forEach(function(parent_unit){
				assocKnownUnits[parent_unit] = true;
			});
		}
		else if (objElement.unit && objElement.ball){
			var objBall = objElement;
			if (!assocKnownBalls[objBall.ball])
				return callbacks.ifError("unknown ball "+objBall.ball);
			if (objBall.ball !== objectHash.getBallHash(objBall.unit, objBall.parent_balls, objBall.skiplist_balls, objBall.is_nonserial))
				return callbacks.ifError("invalid ball hash");
			objBall.parent_balls.forEach(function(parent_ball){
				assocKnownBalls[parent_ball] = true;
			});
			if (objBall.skiplist_balls)
				objBall.skiplist_balls.forEach(function(skiplist_ball){
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
			return callbacks.ifError("unit "+arrUnits[i]+" not found in the chain");
	callbacks.ifOk();
}

exports.prepareHistory = prepareHistory;
exports.processHistory = processHistory;
exports.prepareLinkProofs = prepareLinkProofs;
exports.processLinkProofs = processLinkProofs;
exports.determineIfHaveUnstableJoints = determineIfHaveUnstableJoints;
exports.prepareParentsAndLastBallAndWitnessListUnit = prepareParentsAndLastBallAndWitnessListUnit;
exports.updateAndEmitBadSequenceUnits = updateAndEmitBadSequenceUnits;

