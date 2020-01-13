/*jslint node: true */
"use strict";
var async = require('async');
var _ = require('lodash');
var db = require('./db.js');
var conf = require('./conf.js');
var objectHash = require("./object_hash.js");
var constants = require("./constants.js");
var mutex = require('./mutex.js');
var archiving = require('./archiving.js');
var eventBus = require('./event_bus.js');
var profiler = require('./profiler.js');

var testnetAssetsDefinedByAAsAreVisibleImmediatelyUpgradeMci = 1167000;

var bCordova = (typeof window === 'object' && window.cordova);

var MAX_INT32 = Math.pow(2, 31) - 1;

var genesis_ball = objectHash.getBallHash(constants.GENESIS_UNIT);

var MAX_ITEMS_IN_CACHE = 300;
var assocKnownUnits = {};
var assocCachedUnits = {};
var assocCachedUnitAuthors = {};
var assocCachedUnitWitnesses = {};
var assocCachedAssetInfos = {};

var assocUnstableUnits = {};
var assocStableUnits = {};
var assocStableUnitsByMci = {};
var assocBestChildren = {};

var assocHashTreeUnitsByBall = {};
var assocUnstableMessages = {};

var min_retrievable_mci = null;
initializeMinRetrievableMci();

function readJointJsonFromStorage(conn, unit, cb) {
	var kvstore = require('./kvstore.js');
	if (!bCordova)
		return kvstore.get('j\n' + unit, cb);
	conn.query("SELECT json FROM joints WHERE unit=?", [unit], function (rows) {
		cb((rows.length === 0) ? null : rows[0].json);
	});
}

function readJoint(conn, unit, callbacks, bSql) {
	if (bSql)
		return readJointDirectly(conn, unit, callbacks);
	readJointJsonFromStorage(conn, unit, function(strJoint){
		if (!strJoint)
			return callbacks.ifNotFound();
		var objJoint = JSON.parse(strJoint);
		if (!isCorrectHash(objJoint.unit, unit))
			throw Error("wrong hash of unit "+unit);
		conn.query("SELECT main_chain_index, "+conn.getUnixTimestamp("creation_date")+" AS timestamp FROM units WHERE unit=?", [unit], function(rows){
			if (rows.length === 0)
				throw Error("unit found in kv but not in sql: "+unit);
			var row = rows[0];
			if (objJoint.unit.version === constants.versionWithoutTimestamp)
				objJoint.unit.timestamp = parseInt(row.timestamp);
			objJoint.unit.main_chain_index = row.main_chain_index;
			callbacks.ifFound(objJoint);
		});
	});
	/*
	if (!conf.bSaveJointJson)
		return readJointDirectly(conn, unit, callbacks);
	conn.query("SELECT json FROM joints WHERE unit=?", [unit], function(rows){
		if (rows.length === 0)
			return readJointDirectly(conn, unit, callbacks);
		var objJoint = JSON.parse(rows[0].json);
		if (!objJoint.ball){ // got there because of an old bug
			conn.query("DELETE FROM joints WHERE unit=?", [unit]);
			return readJointDirectly(conn, unit, callbacks);
		}
		callbacks.ifFound(objJoint);
	});
	*/
}

function readJointDirectly(conn, unit, callbacks, bRetrying) {
//	console.log("\nreading unit "+unit);
	if (min_retrievable_mci === null){
		console.log("min_retrievable_mci not known yet");
		setTimeout(function(){
			readJointDirectly(conn, unit, callbacks);
		}, 1000);
		return;
	}
	//profiler.start();
	conn.query(
		"SELECT units.unit, version, alt, witness_list_unit, last_ball_unit, balls.ball AS last_ball, is_stable, \n\
			content_hash, headers_commission, payload_commission, main_chain_index, timestamp, "+conn.getUnixTimestamp("units.creation_date")+" AS received_timestamp \n\
		FROM units LEFT JOIN balls ON last_ball_unit=balls.unit WHERE units.unit=?", 
		[unit], 
		function(unit_rows){
			if (unit_rows.length === 0){
				//profiler.stop('read');
				return callbacks.ifNotFound();
			}
			var objUnit = unit_rows[0];
			var objJoint = {unit: objUnit};
			var main_chain_index = objUnit.main_chain_index;
			//delete objUnit.main_chain_index;
			objUnit.timestamp = parseInt((objUnit.version === constants.versionWithoutTimestamp) ? objUnit.received_timestamp : objUnit.timestamp);
			delete objUnit.received_timestamp;
			var bFinalBad = !!objUnit.content_hash;
			var bStable = objUnit.is_stable;
			delete objUnit.is_stable;

			objectHash.cleanNulls(objUnit);
			var bVoided = (objUnit.content_hash && main_chain_index < min_retrievable_mci);
			var bRetrievable = (main_chain_index >= min_retrievable_mci || main_chain_index === null);
			
			if (!conf.bLight && !objUnit.last_ball && !isGenesisUnit(unit))
				throw Error("no last ball in unit "+JSON.stringify(objUnit));
			
			// unit hash verification below will fail if:
			// 1. the unit was received already voided, i.e. its messages are stripped and content_hash is set
			// 2. the unit is still retrievable (e.g. we are syncing)
			// In this case, bVoided=false hence content_hash will be deleted but the messages are missing
			if (bVoided){
				//delete objUnit.last_ball;
				//delete objUnit.last_ball_unit;
				delete objUnit.headers_commission;
				delete objUnit.payload_commission;
			}
			else
				delete objUnit.content_hash;

			async.series([
				function(callback){ // parents
					conn.query(
						"SELECT parent_unit \n\
						FROM parenthoods \n\
						WHERE child_unit=? \n\
						ORDER BY parent_unit", 
						[unit], 
						function(rows){
							if (rows.length === 0)
								return callback();
							objUnit.parent_units = rows.map(function(row){ return row.parent_unit; });
							callback();
						}
					);
				},
				function(callback){ // ball
					if (bRetrievable && !isGenesisUnit(unit))
						return callback();
					// include the .ball field even if it is not stable yet, because its parents might have been changed 
					// and the receiver should not attempt to verify them
					conn.query("SELECT ball FROM balls WHERE unit=?", [unit], function(rows){
						if (rows.length === 0)
							return callback();
						objJoint.ball = rows[0].ball;
						callback();
					});
				},
				function(callback){ // skiplist
					if (bRetrievable)
						return callback();
					conn.query("SELECT skiplist_unit FROM skiplist_units WHERE unit=? ORDER BY skiplist_unit", [unit], function(rows){
						if (rows.length === 0)
							return callback();
						objJoint.skiplist_units = rows.map(function(row){ return row.skiplist_unit; });
						callback();
					});
				},
				function(callback){ // witnesses
					conn.query("SELECT address FROM unit_witnesses WHERE unit=? ORDER BY address", [unit], function(rows){
						if (rows.length > 0)
							objUnit.witnesses = rows.map(function(row){ return row.address; });
						callback();
					});
				},
				function(callback){ // earned_headers_commission_recipients
					if (bVoided)
						return callback();
					conn.query("SELECT address, earned_headers_commission_share FROM earned_headers_commission_recipients \
						WHERE unit=? ORDER BY address", 
						[unit], 
						function(rows){
							if (rows.length > 0)
								objUnit.earned_headers_commission_recipients = rows;
							callback();
						}
					);
				},
				function(callback){ // authors
					conn.query("SELECT address, definition_chash FROM unit_authors WHERE unit=? ORDER BY address", [unit], function(rows){
						objUnit.authors = [];
						async.eachSeries(
							rows, 
							function(row, cb){
								var author = {address: row.address};

								function onAuthorDone(){
									objUnit.authors.push(author);
									cb();
								}

								if (bVoided)
									return onAuthorDone();
								author.authentifiers = {};
								conn.query(
									"SELECT path, authentifier FROM authentifiers WHERE unit=? AND address=?", 
									[unit, author.address], 
									function(sig_rows){
										for (var i=0; i<sig_rows.length; i++)
											author.authentifiers[sig_rows[i].path] = sig_rows[i].authentifier;

										// if definition_chash is defined:
										if (row.definition_chash){
											readDefinition(conn, row.definition_chash, {
												ifFound: function(arrDefinition){
													author.definition = arrDefinition;
													onAuthorDone();
												},
												ifDefinitionNotFound: function(definition_chash){
													throw Error("definition "+definition_chash+" not defined");
												}
											});
										}
										else
											onAuthorDone();
									}
								);
							}, 
							function(){
								callback();
							}
						);
					});
				},
				function(callback){ // messages
					if (bVoided)
						return callback();
					conn.query(
						"SELECT app, payload_hash, payload_location, payload, payload_uri, payload_uri_hash, message_index \n\
						FROM messages WHERE unit=? ORDER BY message_index", [unit], 
						function(rows){
							if (rows.length === 0){
								if (conf.bLight)
									throw new Error("no messages in unit "+unit);
								return callback(); // any errors will be caught by verifying unit hash
							}
							objUnit.messages = [];
							async.eachSeries(
								rows,
								function(row, cb){
									var objMessage = row;
									var message_index = row.message_index;
									delete objMessage.message_index;
									objectHash.cleanNulls(objMessage);
									objUnit.messages.push(objMessage);
									
									function addSpendProofs(){
										conn.query(
											"SELECT spend_proof, address FROM spend_proofs WHERE unit=? AND message_index=? ORDER BY spend_proof_index",
											[unit, message_index],
											function(proof_rows){
												if (proof_rows.length === 0)
													return cb();
												objMessage.spend_proofs = [];
												for (var i=0; i<proof_rows.length; i++){
													var objSpendProof = proof_rows[i];
													if (objUnit.authors.length === 1) // single-authored
														delete objSpendProof.address;
													objMessage.spend_proofs.push(objSpendProof);
												}
												cb();
											}
										);
									}
									
									if (objMessage.payload_location !== "inline")
										return addSpendProofs();
									switch(objMessage.app){
										case "address_definition_change":
											conn.query(
												"SELECT definition_chash, address FROM address_definition_changes WHERE unit=? AND message_index=?", 
												[unit, message_index], 
												function(dch_rows){
													if (dch_rows.length === 0)
														throw Error("no definition change?");
													objMessage.payload = dch_rows[0];
													if (objUnit.authors.length === 1) // single-authored
														delete objMessage.payload.address;
													addSpendProofs();
												}
											);
											break;

										case "poll":
											conn.query(
												"SELECT question FROM polls WHERE unit=? AND message_index=?", [unit, message_index], 
												function(poll_rows){
													if (poll_rows.length !== 1)
														throw Error("no poll question or too many?");
													objMessage.payload = {question: poll_rows[0].question};
													conn.query("SELECT choice FROM poll_choices WHERE unit=? ORDER BY choice_index", [unit], function(ch_rows){
														if (ch_rows.length === 0)
															throw Error("no choices?");
														objMessage.payload.choices = ch_rows.map(function(choice_row){ return choice_row.choice; });
														addSpendProofs();
													});
												}
											);
											break;

										 case "vote":
											conn.query(
												"SELECT poll_unit, choice FROM votes WHERE unit=? AND message_index=?", [unit, message_index], 
												function(vote_rows){
													if (vote_rows.length !== 1)
														throw Error("no vote choice or too many?");
													objMessage.payload = {unit: vote_rows[0].poll_unit, choice: vote_rows[0].choice};
													addSpendProofs();
												}
											);
											break;

										case "asset":
											conn.query(
												"SELECT cap, is_private, is_transferrable, auto_destroy, fixed_denominations, \n\
													issued_by_definer_only, cosigned_by_definer, spender_attested, \n\
													issue_condition, transfer_condition \n\
												FROM assets WHERE unit=? AND message_index=?", 
												[unit, message_index], 
												function(asset_rows){
													if (asset_rows.length !== 1)
														throw Error("no asset or too many?");
													objMessage.payload = asset_rows[0];
													objectHash.cleanNulls(objMessage.payload);
													objMessage.payload.is_private = !!objMessage.payload.is_private;
													objMessage.payload.is_transferrable = !!objMessage.payload.is_transferrable;
													objMessage.payload.auto_destroy = !!objMessage.payload.auto_destroy;
													objMessage.payload.fixed_denominations = !!objMessage.payload.fixed_denominations;
													objMessage.payload.issued_by_definer_only = !!objMessage.payload.issued_by_definer_only;
													objMessage.payload.cosigned_by_definer = !!objMessage.payload.cosigned_by_definer;
													objMessage.payload.spender_attested = !!objMessage.payload.spender_attested;
													if (objMessage.payload.issue_condition)
														objMessage.payload.issue_condition = JSON.parse(objMessage.payload.issue_condition);
													if (objMessage.payload.transfer_condition)
														objMessage.payload.transfer_condition = JSON.parse(objMessage.payload.transfer_condition);
												
													var addAttestors = function(next){
														if (!objMessage.payload.spender_attested)
															return next();
														conn.query(
															"SELECT attestor_address FROM asset_attestors \n\
															WHERE unit=? AND message_index=? ORDER BY attestor_address",
															[unit, message_index],
															function(att_rows){
																if (att_rows.length === 0)
																	throw Error("no attestors?");
																objMessage.payload.attestors = att_rows.map(function(att_row){
																	return att_row.attestor_address;
																});
																next();
															}
														);
													};
												
													var addDenominations = function(next){
														if (!objMessage.payload.fixed_denominations)
															return next();
														conn.query(
															"SELECT denomination, count_coins FROM asset_denominations \n\
															WHERE asset=? ORDER BY denomination",
															[unit],
															function(denom_rows){
																if (denom_rows.length === 0)
																	throw Error("no denominations?");
																objMessage.payload.denominations = denom_rows.map(function(denom_row){
																	var denom = {denomination: denom_row.denomination};
																	if (denom_row.count_coins)
																		denom.count_coins = denom_row.count_coins;
																	return denom;
																});
																next();
															}
														);
													};
												
													async.series([addAttestors, addDenominations], addSpendProofs);
												}
											);
											break;

										case "asset_attestors":
											conn.query(
												"SELECT attestor_address, asset FROM asset_attestors \n\
												WHERE unit=? AND message_index=? ORDER BY attestor_address",
												[unit, message_index],
												function(att_rows){
													if (att_rows.length === 0)
														throw Error("no attestors?");
													objMessage.payload = {asset: att_rows[0].asset};
													if (att_rows.length > 1 
															&& att_rows.some(function(att_row){ return (att_row.asset !== objMessage.payload.asset) }))
														throw Error("different assets in attestor list");
													objMessage.payload.attestors = att_rows.map(function(att_row){ return att_row.attestor_address;});
													addSpendProofs();
												}
											);
											break;

										case "data_feed":
											conn.query(
												"SELECT feed_name, `value`, int_value FROM data_feeds WHERE unit=? AND message_index=?", [unit, message_index], 
												function(df_rows){
													if (df_rows.length === 0)
														throw Error("no data feed?");
													objMessage.payload = {};
													df_rows.forEach(function(df_row){
														objMessage.payload[df_row.feed_name] = 
															(typeof df_row.value === 'string') ? df_row.value : Number(df_row.int_value);
													});
													addSpendProofs();
												}
											);
											break;

										case "profile":
										case "attestation": // maybe later we'll store profiles and attestations in some structured form
										case "data":
										case "definition_template":
											objMessage.payload = JSON.parse(objMessage.payload);
											addSpendProofs();
											break;

										case "payment":
											objMessage.payload = {};
											var prev_asset;
											var prev_denomination;
											
											var readInputs = function(cb2){
												conn.query(
													"SELECT type, denomination, assets.fixed_denominations, \n\
														src_unit AS unit, src_message_index AS message_index, src_output_index AS output_index, \n\
														from_main_chain_index, to_main_chain_index, serial_number, amount, address, asset \n\
													FROM inputs \n\
													LEFT JOIN assets ON asset=assets.unit \n\
													WHERE inputs.unit=? AND inputs.message_index=? \n\
													ORDER BY input_index", 
													[unit, message_index],
													function(input_rows){
														objMessage.payload.inputs = [];
														for (var i=0; i<input_rows.length; i++){
															var input = input_rows[i];
															if (!input.address && !conf.bLight) // may be NULL for light (light clients are reading units e.g. after receiving payment notification)
																throw Error("readJoint: input address is NULL");
															var asset = input.asset;
															var denomination = input.denomination;
															if (i>0){
																if (asset !== prev_asset)
																	throw Error("different assets in inputs?");
																if (denomination !== prev_denomination)
																	throw Error("different denominations in inputs?");
															}
															if (i === 0 && asset){
																objMessage.payload.asset = asset;
																if (input.fixed_denominations)
																	objMessage.payload.denomination = denomination;
															}
															delete input.asset;
															delete input.denomination;
															delete input.fixed_denominations;
															objectHash.cleanNulls(input);
															if (input.type === "transfer" || objUnit.authors.length === 1)
																delete input.address;
															if (input.type === "transfer")
																delete input.type;
															objMessage.payload.inputs.push(input);
															if (i === 0){
																prev_asset = asset;
																prev_denomination = denomination;
															}
														}
														cb2();
													}
												);
											};
											var readOutputs = function(cb2){
												objMessage.payload.outputs = [];
												conn.query( // we don't select blinding because it's absent on public payments
													"SELECT address, amount, asset, denomination \n\
													FROM outputs WHERE unit=? AND message_index=? ORDER BY output_index", 
													[unit, message_index],
													function(output_rows){
														for (var i=0; i<output_rows.length; i++){
															var output = output_rows[i];
															if (output.asset !== prev_asset)
																throw Error("different assets in outputs?");
															if (output.denomination !== prev_denomination)
																throw Error("different denominations in outputs?");
															delete output.asset;
															delete output.denomination;
															objMessage.payload.outputs.push(output);
														}
														cb2();
													}
												);
											};
											async.series(
												[readInputs, readOutputs], 
												addSpendProofs
											);
											break;

										default:
											addSpendProofs();
									}
								},
								callback
							);
						} // message rows
					);
				}
			], function(){
				//profiler.stop('read');
				// verify unit hash. Might fail if the unit was archived while reading, in this case retry
				// light wallets don't have last_ball, don't verify their hashes
				if (!conf.bLight && !isCorrectHash(objUnit, unit)){
					if (bRetrying)
						throw Error("unit hash verification failed, unit: "+unit+", objUnit: "+JSON.stringify(objUnit));
					console.log("unit hash verification failed, will retry");
					return setTimeout(function(){
						readJointDirectly(conn, unit, callbacks, true);
					}, 60*1000);
				}
				if (!conf.bSaveJointJson || !bStable || (bFinalBad && bRetrievable) || bRetrievable)
					return callbacks.ifFound(objJoint);
				conn.query("INSERT "+db.getIgnore()+" INTO joints (unit, json) VALUES (?,?)", [unit, JSON.stringify(objJoint)], function(){
					callbacks.ifFound(objJoint);
				});
			});
		}
	);
}


function isCorrectHash(objUnit, unit){
	try{
		return (objectHash.getUnitHash(objUnit) === unit);
	}
	catch(e){
		return false;
	}
}


// add .ball even if it is not retrievable
function readJointWithBall(conn, unit, handleJoint) {
	readJoint(conn, unit, {
		ifNotFound: function(){
			throw Error("joint not found, unit "+unit);
		},
		ifFound: function(objJoint){
			if (objJoint.ball)
				return handleJoint(objJoint);
			conn.query("SELECT ball FROM balls WHERE unit=?", [unit], function(rows){
				if (rows.length === 1)
					objJoint.ball = rows[0].ball;
				handleJoint(objJoint);
			});
		}
	});
}



function readWitnessList(conn, unit, handleWitnessList, bAllowEmptyList){
	var arrWitnesses = assocCachedUnitWitnesses[unit];
	if (arrWitnesses)
		return handleWitnessList(arrWitnesses);
	conn.query("SELECT address FROM unit_witnesses WHERE unit=? ORDER BY address", [unit], function(rows){
		if (!bAllowEmptyList && rows.length === 0)
			throw Error("witness list of unit "+unit+" not found");
		if (rows.length > 0 && rows.length !== constants.COUNT_WITNESSES)
			throw Error("wrong number of witnesses in unit "+unit);
		arrWitnesses = rows.map(function(row){ return row.address; });
		if (rows.length > 0)
			assocCachedUnitWitnesses[unit] = arrWitnesses;
		handleWitnessList(arrWitnesses);
	});
}

function readWitnesses(conn, unit, handleWitnessList){
	var arrWitnesses = assocCachedUnitWitnesses[unit];
	if (arrWitnesses)
		return handleWitnessList(arrWitnesses);
	conn.query("SELECT witness_list_unit FROM units WHERE unit=?", [unit], function(rows){
		if (rows.length === 0)
			throw Error("unit "+unit+" not found");
		var witness_list_unit = rows[0].witness_list_unit;
		readWitnessList(conn, witness_list_unit ? witness_list_unit : unit, function(arrWitnesses){
			assocCachedUnitWitnesses[unit] = arrWitnesses;
			handleWitnessList(arrWitnesses);
		});
	});
}

function determineIfWitnessAddressDefinitionsHaveReferences(conn, arrWitnesses, handleResult){
	conn.query(
		"SELECT 1 FROM address_definition_changes JOIN definitions USING(definition_chash) \n\
		WHERE address IN(?) AND has_references=1 \n\
		UNION \n\
		SELECT 1 FROM definitions WHERE definition_chash IN(?) AND has_references=1 \n\
		LIMIT 1",
		[arrWitnesses, arrWitnesses],
		function(rows){
			handleResult(rows.length > 0);
		}
	);
}

function determineWitnessedLevelAndBestParent(conn, arrParentUnits, arrWitnesses, handleWitnessedLevelAndBestParent){
	var arrCollectedWitnesses = [];
	var my_best_parent_unit;

	function addWitnessesAndGoUp(start_unit){
		readStaticUnitProps(conn, start_unit, function(props){
			var best_parent_unit = props.best_parent_unit;
			var level = props.level;
			if (level === null)
				throw Error("null level in updateWitnessedLevel");
			if (level === 0) // genesis
				return handleWitnessedLevelAndBestParent(0, my_best_parent_unit);
			readUnitAuthors(conn, start_unit, function(arrAuthors){
				for (var i=0; i<arrAuthors.length; i++){
					var address = arrAuthors[i];
					if (arrWitnesses.indexOf(address) !== -1 && arrCollectedWitnesses.indexOf(address) === -1)
						arrCollectedWitnesses.push(address);
				}
				(arrCollectedWitnesses.length < constants.MAJORITY_OF_WITNESSES) 
					? addWitnessesAndGoUp(best_parent_unit) : handleWitnessedLevelAndBestParent(level, my_best_parent_unit);
			});
		});
	}

	determineBestParent(conn, {parent_units: arrParentUnits, witness_list_unit: 'none'}, arrWitnesses, function(best_parent_unit){
		if (!best_parent_unit)
			return handleWitnessedLevelAndBestParent();
		//	throw Error("no best parent of "+arrParentUnits.join(', ')+", witnesses "+arrWitnesses.join(', '));
		my_best_parent_unit = best_parent_unit;
		addWitnessesAndGoUp(best_parent_unit);
	});
}


/*
function readWitnessesOnMcUnit(conn, main_chain_index, handleWitnesses){
	conn.query( // we read witnesses from MC unit (users can cheat with side-chains)
		"SELECT address \n\
		FROM units \n\
		JOIN unit_witnesses ON(units.unit=unit_witnesses.unit OR units.witness_list_unit=unit_witnesses.unit) \n\
		WHERE main_chain_index=? AND is_on_main_chain=1", 
		[main_chain_index],
		function(witness_rows){
			if (witness_rows.length === 0)
				throw "no witness list on MC unit "+main_chain_index;
			if (witness_rows.length !== constants.COUNT_WITNESSES)
				throw "wrong number of witnesses on MC unit "+main_chain_index;
			var arrWitnesses = witness_rows.map(function(witness_row){ return witness_row.address; });
			handleWitnesses(arrWitnesses);
		}
	);
}*/


function readDefinitionChashByAddress(conn, address, max_mci, handle){
	if (max_mci == null || max_mci == undefined)
		max_mci = MAX_INT32;
	// try to find last definition change, otherwise definition_chash=address
	conn.query(
		"SELECT definition_chash FROM address_definition_changes CROSS JOIN units USING(unit) \n\
		WHERE address=? AND is_stable=1 AND sequence='good' AND main_chain_index<=? ORDER BY main_chain_index DESC LIMIT 1", 
		[address, max_mci], 
		function(rows){
			var definition_chash = (rows.length > 0) ? rows[0].definition_chash : address;
			handle(definition_chash);
	});
}


// max_mci must be stable
function readDefinitionByAddress(conn, address, max_mci, callbacks){
	readDefinitionChashByAddress(conn, address, max_mci, function(definition_chash){
			readDefinitionAtMci(conn, definition_chash, max_mci, callbacks);
	});
}

// max_mci must be stable
function readDefinitionAtMci(conn, definition_chash, max_mci, callbacks){
	var sql = "SELECT definition FROM definitions CROSS JOIN unit_authors USING(definition_chash) CROSS JOIN units USING(unit) \n\
		WHERE definition_chash=? AND is_stable=1 AND sequence='good' AND main_chain_index<=?";
	var params = [definition_chash, max_mci];
	conn.query(sql, params, function(rows){
		if (rows.length === 0)
			return callbacks.ifDefinitionNotFound(definition_chash);
		callbacks.ifFound(JSON.parse(rows[0].definition));
	});
}

function readDefinition(conn, definition_chash, callbacks){
	conn.query("SELECT definition FROM definitions WHERE definition_chash=?", [definition_chash], function(rows){
		if (rows.length === 0)
			return callbacks.ifDefinitionNotFound(definition_chash);
		callbacks.ifFound(JSON.parse(rows[0].definition));
	});
}

function readAADefinition(conn, address, handleDefinition) {
	conn.query("SELECT definition, unit FROM aa_addresses WHERE address=?", [address], function (rows) {
		if (rows.length !== 1)
			return handleDefinition(null);
		var arrDefinition = JSON.parse(rows[0].definition);
		if (arrDefinition[0] !== 'autonomous agent')
			throw Error("non-AA definition in AA unit");
		handleDefinition(arrDefinition, rows[0].unit);
	});
}

// arrAddresses is an array of AA addresses whose definitions are posted by other AAs
function getUnconfirmedAADefinitionsPostedByAAs(arrAddresses) {
	var payloads = [];
	for (var unit in assocUnstableMessages) {
		var objUnit = assocUnstableUnits[unit] || assocStableUnits[unit]; // just stabilized
		if (!objUnit)
			throw Error("unstable unit " + unit + " not in assoc");
		if (!objUnit.bAA)
			continue;
		assocUnstableMessages[unit].forEach(function (message) {
			if (message.app !== 'definition')
				return;
			var payload = message.payload;
			if (arrAddresses.indexOf(payload.address) >= 0)
			payloads.push(payload);
		});
	}
	return payloads;
}

function insertAADefinitions(conn, arrPayloads, unit, mci, bForAAsOnly, onDone) {
	async.eachSeries(
		arrPayloads,
		function (payload, cb) {
			var address = payload.address;
			var json = JSON.stringify(payload.definition);
			var base_aa = payload.definition[1].base_aa;
			var bAlreadyPostedByUnconfirmedAA = false;
			conn.query("INSERT " + db.getIgnore() + " INTO aa_addresses (address, definition, unit, mci, base_aa) VALUES (?,?, ?,?, ?)", [address, json, unit, mci, base_aa], function (res) {
				if (res.affectedRows === 0) { // already exists
					if (bForAAsOnly){
						console.log("ignoring repeated definition of AA " + address + " in AA unit " + unit);
						return cb();
					}
					var old_payloads = getUnconfirmedAADefinitionsPostedByAAs([address]);
					if (old_payloads.length === 0) {
						console.log("ignoring repeated definition of AA " + address + " in unit " + unit);
						return cb();
					}
					// we need to recalc the balances to reflect the payments received from non-AAs between definition and stabilization
					bAlreadyPostedByUnconfirmedAA = true;
					console.log("will recalc balances after repeated definition of AA " + address + " in unit " + unit);
				}
				var verb = bAlreadyPostedByUnconfirmedAA ? "REPLACE" : "INSERT";
				var or_sent_by_aa = bAlreadyPostedByUnconfirmedAA ? "OR EXISTS (SELECT 1 FROM unit_authors CROSS JOIN aa_addresses USING(address) WHERE unit_authors.unit=outputs.unit)" : "";
				conn.query(
					verb + " INTO aa_balances (address, asset, balance) \n\
					SELECT address, IFNULL(asset, 'base'), SUM(amount) AS balance \n\
					FROM outputs CROSS JOIN units USING(unit) \n\
					WHERE address=? AND is_spent=0 AND (main_chain_index<? " + or_sent_by_aa + ") \n\
					GROUP BY address, asset", // not including the outputs on the current mci, which will trigger the AA and be accounted for separately
					[address, mci],
					function () {
						conn.query(
							"INSERT " + db.getIgnore() + " INTO addresses (address) VALUES (?)", [address],
							function () {
								// can emit again if bAlreadyPostedByUnconfirmedAA, that's ok, the watchers will learn that the AA became now available to non-AAs
								process.nextTick(function () { // don't call it synchronously with event emitter
									eventBus.emit("aa_definition_saved", payload, unit);
								});
								cb();
							}
						);
					}
				);
			});
		},
		onDone
	);
}

function readAAStateVar(address, var_name, handleResult) {
	var kvstore = require('./kvstore.js');
	kvstore.get("st\n" + address + "\n" + var_name, handleResult);
}

function readAAStateVars(address, var_prefix_from, var_prefix_to, limit, handle) {
	if (arguments.length === 2) {
		handle = var_prefix_from;
		var_prefix_from = '';
		var_prefix_to = '';
		limit = 0;
	}
	var options = {};
	options.gte = "st\n" + address + "\n" + var_prefix_from;
	options.lte = "st\n" + address + "\n" + var_prefix_to + "\uFFFF";
	if (limit)
		options.limit = limit;

	var objStateVars = {}
	var handleData = function (data){
		objStateVars[data.key.slice(36)] = data.value;
	}
	var kvstore = require('./kvstore.js');
	var stream = kvstore.createReadStream(options);
	stream.on('data', handleData)
	.on('end', function(){
		handle(objStateVars);
	})
	.on('error', function(error){
		throw Error('error from data stream: '+error);
	});
}

function readFreeJoints(ifFoundFreeBall, onDone){
	db.query("SELECT units.unit FROM units LEFT JOIN archived_joints USING(unit) WHERE is_free=1 AND archived_joints.unit IS NULL", function(rows){
		async.each(rows, function(row, cb){
			readJoint(db, row.unit, {
				ifNotFound: function(){
					throw Error("free ball lost");
				},
				ifFound: function(objJoint){
					ifFoundFreeBall(objJoint);
					cb();
				}
			});
		}, onDone);
	});
}

function isGenesisUnit(unit){
	return (unit === constants.GENESIS_UNIT);
}

function isGenesisBall(ball){
	return (ball === genesis_ball);
}






function readUnitProps(conn, unit, handleProps){
	if (assocStableUnits[unit])
		return handleProps(assocStableUnits[unit]);
	if (conf.bFaster && assocUnstableUnits[unit])
		return handleProps(assocUnstableUnits[unit]);
	var stack = new Error().stack;
	conn.query(
		"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain, is_free, is_stable, witnessed_level, headers_commission, payload_commission, sequence, timestamp, GROUP_CONCAT(address) AS author_addresses, COALESCE(witness_list_unit, unit) AS witness_list_unit\n\
			FROM units \n\
			JOIN unit_authors USING(unit) \n\
			WHERE unit=? \n\
			GROUP BY +unit", 
		[unit], 
		function(rows){
			if (rows.length !== 1)
				throw Error("not 1 row, unit "+unit);
			var props = rows[0];
			props.author_addresses = props.author_addresses.split(',');
			if (props.is_stable) {
				if (props.sequence === 'good') // we don't cache final-bads as they can be voided later
					assocStableUnits[unit] = props;
				// we don't add it to assocStableUnitsByMci as all we need there is already there
			}
			else{
				if (!assocUnstableUnits[unit])
					throw Error("no unstable props of "+unit);
				var props2 = _.cloneDeep(assocUnstableUnits[unit]);
				delete props2.parent_units;
				delete props2.earned_headers_commission_recipients;
				delete props2.bAA;
				if (!_.isEqual(props, props2)) {
					debugger;
					throw Error("different props of "+unit+", mem: "+JSON.stringify(props2)+", db: "+JSON.stringify(props)+", stack "+stack);
				}
			}
			handleProps(props);
		}
	);
}

function readPropsOfUnits(conn, earlier_unit, arrLaterUnits, handleProps){
	var objEarlierUnitProps2 = assocUnstableUnits[earlier_unit] || assocStableUnits[earlier_unit];
	var arrLaterUnitProps2 = arrLaterUnits.map(function(later_unit){ return assocUnstableUnits[later_unit] || assocStableUnits[later_unit]; });
	if (conf.bFaster && objEarlierUnitProps2 && arrLaterUnitProps2.every(function(p){ return !!p; }))
		return handleProps(objEarlierUnitProps2, arrLaterUnitProps2);
	
	var bEarlierInLaterUnits = (arrLaterUnits.indexOf(earlier_unit) !== -1);
	conn.query(
		"SELECT unit, level, witnessed_level, latest_included_mc_index, main_chain_index, is_on_main_chain, is_free, timestamp FROM units WHERE unit IN(?, ?)", 
		[earlier_unit, arrLaterUnits], 
		function(rows){
			if (rows.length !== arrLaterUnits.length + (bEarlierInLaterUnits ? 0 : 1))
				throw Error("wrong number of rows for earlier "+earlier_unit+", later "+arrLaterUnits);
			var objEarlierUnitProps, arrLaterUnitProps = [];
			for (var i=0; i<rows.length; i++){
				if (rows[i].unit === earlier_unit)
					objEarlierUnitProps = rows[i];
				else
					arrLaterUnitProps.push(rows[i]);
			}
			if (bEarlierInLaterUnits)
				arrLaterUnitProps.push(objEarlierUnitProps);
			if (objEarlierUnitProps2 && arrLaterUnitProps2.every(function(p){ return !!p; })){
				console.log('have earlier and later in cache, earlier '+earlier_unit);
				var objEarlierUnitProps2cmp = _.cloneDeep(objEarlierUnitProps2);
				var arrLaterUnitProps2cmp = _.cloneDeep(arrLaterUnitProps2);
				var arrAllProps2cmp = arrLaterUnitProps2cmp.concat([objEarlierUnitProps2cmp]);
				arrAllProps2cmp.forEach(function(props){
					delete props.parent_units;
					delete props.earned_headers_commission_recipients;
					delete props.author_addresses;
					delete props.is_stable;
				//	delete props.witnessed_level;
					delete props.headers_commission;
					delete props.payload_commission;
					delete props.sequence;
					delete props.witness_list_unit;
					delete props.bAA;
				});
				if (!_.isEqual(objEarlierUnitProps, objEarlierUnitProps2cmp))
					throwError("different earlier, db "+JSON.stringify(objEarlierUnitProps)+", mem "+JSON.stringify(objEarlierUnitProps2cmp));
				if (!_.isEqual(_.sortBy(arrLaterUnitProps, 'unit'), _.sortBy(arrLaterUnitProps2cmp, 'unit')))
					throwError("different later, db "+JSON.stringify(arrLaterUnitProps)+", mem "+JSON.stringify(arrLaterUnitProps2cmp));
			}
			else
				console.log('have earlier or later not in cache');
			handleProps(objEarlierUnitProps, arrLaterUnitProps);
		}
	);
}

function throwError(msg){
	debugger;
	if (typeof window === 'undefined')
		throw Error(msg);
	else
		eventBus.emit('nonfatal_error', msg, new Error());
}





function readLastStableMcUnitProps(conn, handleLastStableMcUnitProps){
	conn.query(
		"SELECT units.*, ball FROM units LEFT JOIN balls USING(unit) WHERE is_on_main_chain=1 AND is_stable=1 ORDER BY main_chain_index DESC LIMIT 1", 
		function(rows){
			if (rows.length === 0)
				return handleLastStableMcUnitProps(null); // empty database
				//throw "readLastStableMcUnitProps: no units on stable MC?";
			if (!rows[0].ball)
				throw Error("no ball for last stable unit "+rows[0].unit);
			handleLastStableMcUnitProps(rows[0]);
		}
	);
}

function readLastStableMcIndex(conn, handleLastStableMcIndex){
	readLastStableMcUnitProps(conn, function(objLastStableMcUnitProps){
		handleLastStableMcIndex(objLastStableMcUnitProps ? objLastStableMcUnitProps.main_chain_index : 0);
	});
}


function readLastMainChainIndex(handleLastMcIndex){
	db.query("SELECT MAX(main_chain_index) AS last_mc_index FROM units", function(rows){
		var last_mc_index = rows[0].last_mc_index;
		if (last_mc_index === null) // empty database
			last_mc_index = 0;
		handleLastMcIndex(last_mc_index);
	});
}


function findLastBallMciOfMci(conn, mci, handleLastBallMci){
	if (mci === 0)
		throw Error("findLastBallMciOfMci called with mci=0");
	conn.query(
		"SELECT lb_units.main_chain_index, lb_units.is_on_main_chain \n\
		FROM units JOIN units AS lb_units ON units.last_ball_unit=lb_units.unit \n\
		WHERE units.is_on_main_chain=1 AND units.main_chain_index=?", 
		[mci],
		function(rows){
			if (rows.length !== 1)
				throw Error("last ball's mci count "+rows.length+" !== 1, mci = "+mci);
			if (rows[0].is_on_main_chain !== 1)
				throw Error("lb is not on mc?");
			handleLastBallMci(rows[0].main_chain_index);
		}
	);
}

function readMaxLastBallMci(conn, arrUnits, handleResult) {
	conn.query(
		"SELECT MAX(lb_units.main_chain_index) AS max_last_ball_mci \n\
		FROM units JOIN units AS lb_units ON units.last_ball_unit=lb_units.unit \n\
		WHERE units.unit IN(?)",
		[arrUnits],
		function(rows) {
			handleResult(rows[0].max_last_ball_mci);
		}
	);
}

function getMinRetrievableMci(){
	return min_retrievable_mci;
}

function updateMinRetrievableMciAfterStabilizingMci(conn, batch, last_stable_mci, handleMinRetrievableMci){
	console.log("updateMinRetrievableMciAfterStabilizingMci "+last_stable_mci);
	findLastBallMciOfMci(conn, last_stable_mci, function(last_ball_mci){
		if (last_ball_mci <= min_retrievable_mci) // nothing new
			return handleMinRetrievableMci(min_retrievable_mci);
		var prev_min_retrievable_mci = min_retrievable_mci;
		min_retrievable_mci = last_ball_mci;

		// strip content off units older than min_retrievable_mci
		conn.query(
			// 'JOIN messages' filters units that are not stripped yet
			"SELECT DISTINCT unit, content_hash FROM units "+db.forceIndex('byMcIndex')+" CROSS JOIN messages USING(unit) \n\
			WHERE main_chain_index<=? AND main_chain_index>=? AND sequence='final-bad'", 
			[min_retrievable_mci, prev_min_retrievable_mci],
			function(unit_rows){
				var arrQueries = [];
				async.eachSeries(
					unit_rows,
					function(unit_row, cb){
						var unit = unit_row.unit;
						console.log('voiding unit '+unit);
						if (!unit_row.content_hash)
							throw Error("no content hash in bad unit "+unit);
						readJoint(conn, unit, {
							ifNotFound: function(){
								throw Error("bad unit not found: "+unit);
							},
							ifFound: function(objJoint){
								var objUnit = objJoint.unit;
								var objStrippedUnit = {
									unit: unit,
									content_hash: unit_row.content_hash,
									version: objUnit.version,
									alt: objUnit.alt,
									parent_units: objUnit.parent_units,
									last_ball: objUnit.last_ball,
									last_ball_unit: objUnit.last_ball_unit,
									authors: objUnit.authors.map(function(author){ return {address: author.address}; }) // already sorted
								};
								if (objUnit.witness_list_unit)
									objStrippedUnit.witness_list_unit = objUnit.witness_list_unit;
								else
									objStrippedUnit.witnesses = objUnit.witnesses;
								var objStrippedJoint = {unit: objStrippedUnit, ball: objJoint.ball};
								batch.put('j\n'+unit, JSON.stringify(objStrippedJoint));
								archiving.generateQueriesToArchiveJoint(conn, objJoint, 'voided', arrQueries, cb);
							}
						});
					},
					function(){
						if (arrQueries.length === 0)
							return handleMinRetrievableMci(min_retrievable_mci);
						async.series(arrQueries, function(){
							unit_rows.forEach(function(unit_row){
								// don't forget, can be still used when calculating witnessing commissions
							//	forgetUnit(unit_row.unit);
							});
							handleMinRetrievableMci(min_retrievable_mci);
						});
					}
				);
			}
		);
	});
}

function initializeMinRetrievableMci(conn, onDone){
	var conn = conn || db;
	conn.query(
		"SELECT MAX(lb_units.main_chain_index) AS min_retrievable_mci \n\
		FROM units JOIN units AS lb_units ON units.last_ball_unit=lb_units.unit \n\
		WHERE units.is_on_main_chain=1 AND units.is_stable=1", 
		function(rows){
			if (rows.length !== 1)
				throw Error("MAX() no rows?");
			min_retrievable_mci = rows[0].min_retrievable_mci;
			if (min_retrievable_mci === null)
				min_retrievable_mci = 0;
			if (onDone)
				onDone();
		}
	);
}


function archiveJointAndDescendantsIfExists(from_unit){
	console.log('will archive if exists from unit '+from_unit);
	db.query("SELECT 1 FROM units WHERE unit=?", [from_unit], function(rows){
		if (rows.length > 0)
			archiveJointAndDescendants(from_unit);
	});
}

function archiveJointAndDescendants(from_unit){
	db.executeInTransaction(function doWork(conn, cb){
		
		function addChildren(arrParentUnits){
			conn.query("SELECT DISTINCT child_unit FROM parenthoods WHERE parent_unit IN(?)", [arrParentUnits], function(rows){
				if (rows.length === 0)
					return archive();
				var arrChildUnits = rows.map(function(row){ return row.child_unit; });
				arrUnits = arrUnits.concat(arrChildUnits);
				addChildren(arrChildUnits);
			});
		}
		
		function archive(){
			arrUnits = _.uniq(arrUnits); // does not affect the order
			arrUnits.reverse();
			console.log('will archive', arrUnits);
			var arrQueries = [];
			async.eachSeries(
				arrUnits,
				function(unit, cb2){
					readJoint(conn, unit, {
						ifNotFound: function(){
							throw Error("unit to be archived not found: "+unit);
						},
						ifFound: function(objJoint){
							archiving.generateQueriesToArchiveJoint(conn, objJoint, 'uncovered', arrQueries, cb2);
						}
					});
				},
				function(){
					conn.addQuery(arrQueries, "DELETE FROM known_bad_joints");
					conn.addQuery(arrQueries, "UPDATE units SET is_free=1 WHERE is_free=0 AND is_stable=0 \n\
						AND (SELECT 1 FROM parenthoods WHERE parent_unit=unit LIMIT 1) IS NULL");
					console.log('will execute '+arrQueries.length+' queries to archive');
					async.series(arrQueries, function(){
						arrUnits.forEach(forgetUnit);
						cb();
					});
				}
			);
		}
		
		console.log('will archive from unit '+from_unit);
		var arrUnits = [from_unit];
		addChildren([from_unit]);
	},
	function onDone(){
		console.log('done archiving from unit '+from_unit);
	});
}


//_______________________________________________________________________________________________
// Assets

function readAssetInfo(conn, asset, handleAssetInfo){
	var objAsset = assocCachedAssetInfos[asset];
	if (objAsset)
		return handleAssetInfo(objAsset);
	conn.query(
		"SELECT assets.*, main_chain_index, sequence, is_stable, address AS definer_address, unit AS asset \n\
		FROM assets JOIN units USING(unit) JOIN unit_authors USING(unit) WHERE unit=?", 
		[asset], 
		function(rows){
			if (rows.length > 1)
				throw Error("more than one asset?");
			if (rows.length === 0)
				return handleAssetInfo(null);
			var objAsset = rows[0];
			if (objAsset.issue_condition)
				objAsset.issue_condition = JSON.parse(objAsset.issue_condition);
			if (objAsset.transfer_condition)
				objAsset.transfer_condition = JSON.parse(objAsset.transfer_condition);
			if (objAsset.is_stable) // cache only if stable
				assocCachedAssetInfos[asset] = objAsset;
			handleAssetInfo(objAsset);
		}
	);
}

function readAsset(conn, asset, last_ball_mci, bAcceptUnconfirmedAA, handleAsset) {
	if (arguments.length === 4) {
		handleAsset = bAcceptUnconfirmedAA;
		bAcceptUnconfirmedAA = false;
	}
	if (last_ball_mci === null){
		if (conf.bLight)
			last_ball_mci = MAX_INT32;
		else
			return readLastStableMcIndex(conn, function(last_stable_mci){
				readAsset(conn, asset, last_stable_mci, bAcceptUnconfirmedAA, handleAsset);
			});
	}
	readAssetInfo(conn, asset, function (objAsset) {
		if (!objAsset)
			return handleAsset("asset " + asset + " not found");
		if (objAsset.sequence !== "good")
			return handleAsset("asset definition is not serial");
		
		function addAttestorsIfNecessary(){
			if (!objAsset.spender_attested)
				return handleAsset(null, objAsset);

			// find latest list of attestors
			conn.query(
				"SELECT unit FROM asset_attestors CROSS JOIN units USING(unit) \n\
				WHERE asset=? AND main_chain_index<=? AND is_stable=1 AND sequence='good' ORDER BY "+ (conf.bLight ? "units.rowid" : "level") + " DESC LIMIT 1",
				[asset, last_ball_mci],
				function (latest_rows) {
					if (latest_rows.length === 0)
						throw Error("no latest attestor list");
					var latest_attestor_list_unit = latest_rows[0].unit;

					// read the list
					conn.query(
						"SELECT attestor_address FROM asset_attestors CROSS JOIN units USING(unit) \n\
						WHERE asset=? AND unit=? AND main_chain_index<=? AND is_stable=1 AND sequence='good'",
						[asset, latest_attestor_list_unit, last_ball_mci],
						function (att_rows) {
							if (att_rows.length === 0)
								throw Error("no attestors?");
							objAsset.arrAttestorAddresses = att_rows.map(function (att_row) { return att_row.attestor_address; });
							handleAsset(null, objAsset);
						}
					);
				}
			);
		}

		if (objAsset.main_chain_index !== null && objAsset.main_chain_index <= last_ball_mci)
			return addAttestorsIfNecessary();
		// && objAsset.main_chain_index !== null below is for bug compatibility with the old version
		if (!bAcceptUnconfirmedAA || constants.bTestnet && last_ball_mci < testnetAssetsDefinedByAAsAreVisibleImmediatelyUpgradeMci && objAsset.main_chain_index !== null)
			return handleAsset("asset definition must be before last ball");
		readAADefinition(conn, objAsset.definer_address, function (arrDefinition) {
			arrDefinition ? addAttestorsIfNecessary() : handleAsset("asset definition must be before last ball (AA)");
		});
	});
}

// filter only those addresses that are attested (doesn't work for light clients)
function filterAttestedAddresses(conn, objAsset, last_ball_mci, arrAddresses, handleAttestedAddresses){
	conn.query(
		"SELECT DISTINCT address FROM attestations CROSS JOIN units USING(unit) \n\
		WHERE attestor_address IN(?) AND address IN(?) AND main_chain_index<=? AND is_stable=1 AND sequence='good' \n\
			AND main_chain_index>IFNULL( \n\
				(SELECT main_chain_index FROM address_definition_changes JOIN units USING(unit) \n\
				WHERE address_definition_changes.address=attestations.address ORDER BY main_chain_index DESC LIMIT 1), \n\
			0)",
		[objAsset.arrAttestorAddresses, arrAddresses, last_ball_mci],
		function(addr_rows){
			var arrAttestedAddresses = addr_rows.map(function(addr_row){ return addr_row.address; });
			handleAttestedAddresses(arrAttestedAddresses);
		}
	);
}

// note that light clients cannot check attestations
function loadAssetWithListOfAttestedAuthors(conn, asset, last_ball_mci, arrAuthorAddresses, bAcceptUnconfirmedAA, handleAsset){
	if (arguments.length === 5) {
		handleAsset = bAcceptUnconfirmedAA;
		bAcceptUnconfirmedAA = false;
	}
	readAsset(conn, asset, last_ball_mci, bAcceptUnconfirmedAA, function(err, objAsset){
		if (err)
			return handleAsset(err);
		if (!objAsset.spender_attested)
			return handleAsset(null, objAsset);
		filterAttestedAddresses(conn, objAsset, last_ball_mci, arrAuthorAddresses, function(arrAttestedAddresses){
			objAsset.arrAttestedAddresses = arrAttestedAddresses;
			handleAsset(null, objAsset);
		});
	});
}

function findWitnessListUnit(conn, arrWitnesses, last_ball_mci, handleWitnessListUnit){
	conn.query(
		"SELECT witness_list_hashes.witness_list_unit \n\
		FROM witness_list_hashes CROSS JOIN units ON witness_list_hashes.witness_list_unit=unit \n\
		WHERE witness_list_hash=? AND sequence='good' AND is_stable=1 AND main_chain_index<=?", 
		[objectHash.getBase64Hash(arrWitnesses), last_ball_mci], 
		function(rows){
			handleWitnessListUnit((rows.length === 0) ? null : rows[0].witness_list_unit);
		}
	);
}

function sliceAndExecuteQuery(query, params, largeParam, callback) {
	if (typeof largeParam !== 'object' || largeParam.length === 0) return callback([]);
	var CHUNK_SIZE = 200;
	var length = largeParam.length;
	var arrParams = [];
	var newParams;
	var largeParamPosition = params.indexOf(largeParam);

	for (var offset = 0; offset < length; offset += CHUNK_SIZE) {
		newParams = params.slice(0);
		newParams[largeParamPosition] = largeParam.slice(offset, offset + CHUNK_SIZE);
		arrParams.push(newParams);
	}

	var result = [];
	async.eachSeries(arrParams, function(params, cb) {
		db.query(query, params, function(rows) {
			result = result.concat(rows);
			cb();
		});
	}, function() {
		callback(result);
	});
}

function filterNewOrUnstableUnits(arrUnits, handleFilteredUnits){
	sliceAndExecuteQuery("SELECT unit FROM units WHERE unit IN(?) AND is_stable=1", [arrUnits], arrUnits, function(rows) {
		var arrKnownStableUnits = rows.map(function(row){ return row.unit; });
		var arrNewOrUnstableUnits = _.difference(arrUnits, arrKnownStableUnits);
		handleFilteredUnits(arrNewOrUnstableUnits);
	});
}

// for unit that is not saved to the db yet
function determineBestParent(conn, objUnit, arrWitnesses, handleBestParent){
	// choose best parent among compatible parents only
	conn.query(
		"SELECT unit \n\
		FROM units AS parent_units \n\
		WHERE unit IN(?) \n\
			AND (witness_list_unit=? OR ( \n\
				SELECT COUNT(*) \n\
				FROM unit_witnesses AS parent_witnesses \n\
				WHERE parent_witnesses.unit IN(parent_units.unit, parent_units.witness_list_unit) AND address IN(?) \n\
			)>=?) \n\
		ORDER BY witnessed_level DESC, \n\
			level-witnessed_level ASC, \n\
			unit ASC \n\
		LIMIT 1", 
		[objUnit.parent_units, objUnit.witness_list_unit, 
		arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS], 
		function(rows){
			if (rows.length !== 1)
				return handleBestParent(null);
			var best_parent_unit = rows[0].unit;
			handleBestParent(best_parent_unit);
		}
	);
}

function determineIfHasWitnessListMutationsAlongMc(conn, objUnit, last_ball_unit, arrWitnesses, handleResult){
	if (!objUnit.parent_units) // genesis
		return handleResult();
	buildListOfMcUnitsWithPotentiallyDifferentWitnesslists(conn, objUnit, last_ball_unit, arrWitnesses, function(bHasBestParent, arrMcUnits){
		if (!bHasBestParent)
			return handleResult("no compatible best parent");
		if (arrMcUnits.length > 0)
			console.log("###### MC units with potential mutations from parents " + objUnit.parent_units.join(', ') + " to last unit " + last_ball_unit + ":", arrMcUnits);
		if (arrMcUnits.length === 0)
			return handleResult();
		conn.query(
			"SELECT units.unit, COUNT(*) AS count_matching_witnesses \n\
			FROM units CROSS JOIN unit_witnesses ON (units.unit=unit_witnesses.unit OR units.witness_list_unit=unit_witnesses.unit) AND address IN(?) \n\
			WHERE units.unit IN("+arrMcUnits.map(db.escape).join(', ')+") \n\
			GROUP BY units.unit \n\
			HAVING count_matching_witnesses<? LIMIT 1",
			[arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS],
			function(rows){
				if (rows.length > 0)
					return handleResult("too many ("+(constants.COUNT_WITNESSES - rows[0].count_matching_witnesses)+") witness list mutations relative to MC unit "+rows[0].unit);
				handleResult();
			}
		);
	});
}

// the MC for this function is the MC built from this unit, not our current MC
function buildListOfMcUnitsWithPotentiallyDifferentWitnesslists(conn, objUnit, last_ball_unit, arrWitnesses, handleList){

	function addAndGoUp(unit){
		readStaticUnitProps(conn, unit, function(props){
			// the parent has the same witness list and the parent has already passed the MC compatibility test
			if (objUnit.witness_list_unit && objUnit.witness_list_unit === props.witness_list_unit)
				return handleList(true, arrMcUnits);
			else
				arrMcUnits.push(unit);
			if (unit === last_ball_unit)
				return handleList(true, arrMcUnits);
			if (!props.best_parent_unit)
				throw Error("no best parent of unit "+unit+"?");
			addAndGoUp(props.best_parent_unit);
		});
	}

	var arrMcUnits = [];
	determineBestParent(conn, objUnit, arrWitnesses, function(best_parent_unit){
		if (!best_parent_unit)
			return handleList(false);
		addAndGoUp(best_parent_unit);
	});
}


function readStaticUnitProps(conn, unit, handleProps, bReturnNullIfNotFound){
	if (!unit)
		throw Error("no unit");
	var props = assocCachedUnits[unit];
	if (props)
		return handleProps(props);
	conn.query("SELECT level, witnessed_level, best_parent_unit, witness_list_unit FROM units WHERE unit=?", [unit], function(rows){
		if (rows.length !== 1){
			if (bReturnNullIfNotFound)
				return handleProps(null);
			throw Error("not 1 unit "+unit);
		}
		props = rows[0];
		assocCachedUnits[unit] = props;
		handleProps(props);
	});
}

function readUnitAuthors(conn, unit, handleAuthors){
	var arrAuthors = assocCachedUnitAuthors[unit];
	if (arrAuthors)
		return handleAuthors(arrAuthors);
	conn.query("SELECT address FROM unit_authors WHERE unit=?", [unit], function(rows){
		if (rows.length === 0)
			throw Error("no authors, unit "+unit);
		var arrAuthors2 = rows.map(function(row){ return row.address; }).sort();
	//	if (arrAuthors && arrAuthors.join('-') !== arrAuthors2.join('-'))
	//		throw Error('cache is corrupt');
		assocCachedUnitAuthors[unit] = arrAuthors2;
		handleAuthors(arrAuthors2);
	});
}

function isKnownUnit(unit){
	return (assocCachedUnits[unit] || assocKnownUnits[unit]) ? true : false;
}

function setUnitIsKnown(unit){
	return assocKnownUnits[unit] = true;
}

function forgetUnit(unit){
	console.log('forgetting unit '+unit);
	if (!conf.bLight){
		console.log('parents', assocUnstableUnits[unit].parent_units);
		assocUnstableUnits[unit].parent_units.forEach(function(parent_unit){
			console.log('parent '+parent_unit+' best children', JSON.stringify(assocBestChildren[parent_unit]));
			if (assocBestChildren[parent_unit] && assocBestChildren[parent_unit].indexOf(assocUnstableUnits[unit]) >= 0){
				console.log('before pull', assocBestChildren[parent_unit]);
				_.pull(assocBestChildren[parent_unit], assocUnstableUnits[unit]);
				console.log('after pull', assocBestChildren[parent_unit]);
			}
		});
	}
	delete assocKnownUnits[unit];
	delete assocCachedUnits[unit];
	delete assocCachedUnitAuthors[unit];
	delete assocCachedUnitWitnesses[unit];
	delete assocUnstableUnits[unit];
	if (!conf.bLight && assocStableUnits[unit])
		throw Error("trying to forget stable unit "+unit);
	delete assocStableUnits[unit];
	delete assocUnstableMessages[unit];
	delete assocBestChildren[unit];
}

// parent_units are parent units of the forgotten unit
function fixIsFreeAfterForgettingUnit(parent_units) {
	parent_units.forEach(function(parent_unit){
		if (!assocUnstableUnits[parent_unit]) // the parent is already stable
			return;
		var bHasChildren = false;
		for (var unit in assocUnstableUnits){
			var o = assocUnstableUnits[unit];
			if (o.parent_units.indexOf(parent_unit) >= 0)
				bHasChildren = true;
		}
		if (!bHasChildren)
			assocUnstableUnits[parent_unit].is_free = 1;
	});
}

function shrinkCache(){
	if (Object.keys(assocCachedAssetInfos).length > MAX_ITEMS_IN_CACHE)
		assocCachedAssetInfos = {};
	console.log(Object.keys(assocUnstableUnits).length+" unstable units");
	var arrKnownUnits = Object.keys(assocKnownUnits);
	var arrPropsUnits = Object.keys(assocCachedUnits);
	var arrStableUnits = Object.keys(assocStableUnits);
	var arrAuthorsUnits = Object.keys(assocCachedUnitAuthors);
	var arrWitnessesUnits = Object.keys(assocCachedUnitWitnesses);
	if (arrPropsUnits.length < MAX_ITEMS_IN_CACHE && arrAuthorsUnits.length < MAX_ITEMS_IN_CACHE && arrWitnessesUnits.length < MAX_ITEMS_IN_CACHE && arrKnownUnits.length < MAX_ITEMS_IN_CACHE && arrStableUnits.length < MAX_ITEMS_IN_CACHE)
		return console.log('cache is small, will not shrink');
	var arrUnits = _.union(arrPropsUnits, arrAuthorsUnits, arrWitnessesUnits, arrKnownUnits, arrStableUnits);
	console.log('will shrink cache, total units: '+arrUnits.length);
	readLastStableMcIndex(db, function(last_stable_mci){
		for (var mci = last_stable_mci-constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING-10-1; true; mci--){
			if (assocStableUnitsByMci[mci])
				delete assocStableUnitsByMci[mci];
			else
				break;
		}
		var CHUNK_SIZE = 500; // there is a limit on the number of query params
		for (var offset=0; offset<arrUnits.length; offset+=CHUNK_SIZE){
			// filter units that became stable more than 100 MC indexes ago
			db.query(
				"SELECT unit FROM units WHERE unit IN(?) AND main_chain_index<? AND main_chain_index!=0", 
				[arrUnits.slice(offset, offset+CHUNK_SIZE), last_stable_mci-constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING-10], 
				function(rows){
					console.log('will remove '+rows.length+' units from cache');
					rows.forEach(function(row){
						delete assocKnownUnits[row.unit];
						delete assocCachedUnits[row.unit];
						delete assocBestChildren[row.unit];
						delete assocStableUnits[row.unit];
						delete assocCachedUnitAuthors[row.unit];
						delete assocCachedUnitWitnesses[row.unit];
					});
				}
			);
		}
	});
}
setInterval(shrinkCache, 300*1000);



function initUnstableUnits(conn, onDone){
	var conn = conn || db;
	conn.query(
		"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain, is_free, is_stable, witnessed_level, headers_commission, payload_commission, sequence, timestamp, GROUP_CONCAT(address) AS author_addresses, COALESCE(witness_list_unit, unit) AS witness_list_unit, best_parent_unit \n\
			FROM units \n\
			JOIN unit_authors USING(unit) \n\
			WHERE is_stable=0 \n\
			GROUP BY +unit \n\
			ORDER BY +level",
		function(rows){
		//	assocUnstableUnits = {};
			rows.forEach(function(row){
				var best_parent_unit = row.best_parent_unit;
				delete row.best_parent_unit;
				row.author_addresses = row.author_addresses.split(',');
				assocUnstableUnits[row.unit] = row;
				if (assocUnstableUnits[best_parent_unit]){
					if (!assocBestChildren[best_parent_unit])
						assocBestChildren[best_parent_unit] = [];
					assocBestChildren[best_parent_unit].push(row);
				}
			});
			console.log('initUnstableUnits 1 done');
			if (Object.keys(assocUnstableUnits).length === 0)
				return onDone ? onDone() : null;
			initParenthoodAndHeadersComissionShareForUnits(conn, assocUnstableUnits, onDone);
		}
	);
}

function initStableUnits(conn, onDone){
	var conn = conn || db;
	readLastStableMcIndex(conn, function(last_stable_mci){
		conn.query(
			"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain, is_free, is_stable, witnessed_level, headers_commission, payload_commission, sequence, timestamp, GROUP_CONCAT(address) AS author_addresses, COALESCE(witness_list_unit, unit) AS witness_list_unit \n\
			FROM units \n\
			JOIN unit_authors USING(unit) \n\
			WHERE is_stable=1 AND main_chain_index>=? \n\
			GROUP BY +unit \n\
			ORDER BY +level", [last_stable_mci-constants.COUNT_MC_BALLS_FOR_PAID_WITNESSING-10],
			function(rows){
				rows.forEach(function(row){
					row.author_addresses = row.author_addresses.split(',');
					assocStableUnits[row.unit] = row;
					if (!assocStableUnitsByMci[row.main_chain_index])
						assocStableUnitsByMci[row.main_chain_index] = [];
					assocStableUnitsByMci[row.main_chain_index].push(row);
				});
				console.log('initStableUnits 1 done');
				if (Object.keys(assocStableUnits).length === 0)
					return onDone ? onDone() : null;
				initParenthoodAndHeadersComissionShareForUnits(conn, assocStableUnits, onDone);
			}
		);
	});
}

function initParenthoodAndHeadersComissionShareForUnits(conn, assocUnits, onDone) {
	async.series([
		function(cb){ // parenthood
			conn.query(
				"SELECT parent_unit, child_unit FROM parenthoods WHERE child_unit IN("+Object.keys(assocUnits).map(db.escape).join(', ')+")", 
				function(prows){
					prows.forEach(function(prow){
						if (!assocUnits[prow.child_unit].parent_units)
							assocUnits[prow.child_unit].parent_units = [];
						assocUnits[prow.child_unit].parent_units.push(prow.parent_unit);
					});
					cb();
				}
			);
		},
		function(cb){ // headers_commision_share
			conn.query(
				"SELECT unit, address, earned_headers_commission_share FROM earned_headers_commission_recipients WHERE unit IN("+Object.keys(assocUnits).map(db.escape).join(', ')+")",
				function(prows){
					prows.forEach(function(prow){
						if (!assocUnits[prow.unit].earned_headers_commission_recipients)
							assocUnits[prow.unit].earned_headers_commission_recipients = {};
						assocUnits[prow.unit].earned_headers_commission_recipients[prow.address] = prow.earned_headers_commission_share;
					});
					cb();
				}
			);
		}],
		function() {
			if (onDone)
				onDone();
		}
	);
}

function initHashTreeBalls(conn, onDone){
	var conn = conn || db;
	conn.query("SELECT * FROM hash_tree_balls", function(rows){
		rows.forEach(function(row){
			assocHashTreeUnitsByBall[row.ball] = row.unit;
		});
		console.log('initHashTreeBalls done');
		if (onDone)
			onDone();
	});
}

function initUnstableMessages(conn, onDone){
	var conn = conn || db;
	conn.query("SELECT unit FROM units CROSS JOIN messages USING(unit) WHERE is_stable=0 AND app IN('data_feed', 'definition')", function(rows){
		async.eachSeries(
			rows,
			function(row, cb){
				readJoint(conn, row.unit, {
					ifNotFound: function(){
						throw Error("unit not found: "+row.unit);
					},
					ifFound: function(objJoint){
						objJoint.unit.messages.forEach(function(message){
							if (message.app === 'data_feed' || message.app === 'definition') {
								if (!assocUnstableMessages[row.unit])
									assocUnstableMessages[row.unit] = [];
								assocUnstableMessages[row.unit].push(message);
							}
						});
						cb();
					}
				});
			},
			function(){
				console.log('initUnstableMessages done, '+Object.keys(assocUnstableMessages).length+' messages found');
				if (onDone)
					onDone();
			}
		);
	});
}

/*
function initLastUnstableAAUnit(conn, onDone) {
	conn.query(
		"SELECT units.unit FROM units CROSS JOIN unit_authors USING(unit) CROSS JOIN aa_addresses USING(address) \n\
		WHERE is_stable=0 ORDER BY latest_included_mc_index DESC, level DESC LIMIT 1",
		function (rows) {
			if (rows.length > 0)
				exports.last_unstable_aa_unit = rows[0].unit;
			console.log('last_unstable_aa_unit = ' + exports.last_unstable_aa_unit);
			onDone();
		}
	);
}*/

function resetUnstableUnits(conn, onDone){
	Object.keys(assocBestChildren).forEach(function(unit){
		delete assocBestChildren[unit];
	});
	Object.keys(assocUnstableUnits).forEach(function(unit){
		delete assocUnstableUnits[unit];
	});
	initUnstableUnits(conn, onDone);
}

function resetStableUnits(conn, onDone){
	Object.keys(assocStableUnits).forEach(function(unit){
		delete assocStableUnits[unit];
	});
	Object.keys(assocStableUnitsByMci).forEach(function(mci){
		delete assocStableUnitsByMci[mci];
	});
	initStableUnits(conn, onDone);
}

function resetMemory(conn, onDone){
	resetUnstableUnits(conn, function(){
		resetStableUnits(conn, function(){
			min_retrievable_mci = null;
			initializeMinRetrievableMci(conn, onDone);
		});
	});
}

function initCaches(){
	console.log('initCaches');
	db.executeInTransaction(function(conn, onDone){
		mutex.lock(['write'], function(unlock) {
			initUnstableUnits(conn, initStableUnits.bind(this, conn, initUnstableMessages.bind(this, conn, initHashTreeBalls.bind(this, conn, function(){
				console.log('initCaches done');
				if (!conf.bLight && constants.bTestnet)
					archiveJointAndDescendantsIfExists('K6OAWrAQkKkkTgfvBb/4GIeN99+6WSHtfVUd30sen1M=');
				unlock();
				onDone();
				eventBus.emit('caches_ready');
			}))));
		});
	});
}



exports.isGenesisUnit = isGenesisUnit;
exports.isGenesisBall = isGenesisBall;

exports.readWitnesses = readWitnesses;
exports.readWitnessList = readWitnessList;
exports.findWitnessListUnit = findWitnessListUnit;
exports.determineIfWitnessAddressDefinitionsHaveReferences = determineIfWitnessAddressDefinitionsHaveReferences;

exports.readUnitProps = readUnitProps;
exports.readPropsOfUnits = readPropsOfUnits;

exports.readJoint = readJoint;
exports.readJointWithBall = readJointWithBall;
exports.readFreeJoints = readFreeJoints;

exports.readDefinitionChashByAddress = readDefinitionChashByAddress;
exports.readDefinitionByAddress = readDefinitionByAddress;
exports.readDefinition = readDefinition;
exports.readAADefinition = readAADefinition;
exports.getUnconfirmedAADefinitionsPostedByAAs = getUnconfirmedAADefinitionsPostedByAAs;
exports.insertAADefinitions = insertAADefinitions;
exports.readAAStateVar = readAAStateVar;
exports.readAAStateVars = readAAStateVars;

exports.readLastMainChainIndex = readLastMainChainIndex;

exports.readLastStableMcUnitProps = readLastStableMcUnitProps;
exports.readLastStableMcIndex = readLastStableMcIndex;


exports.findLastBallMciOfMci = findLastBallMciOfMci;
exports.readMaxLastBallMci = readMaxLastBallMci;
exports.getMinRetrievableMci = getMinRetrievableMci;
exports.updateMinRetrievableMciAfterStabilizingMci = updateMinRetrievableMciAfterStabilizingMci;

exports.archiveJointAndDescendantsIfExists = archiveJointAndDescendantsIfExists;

exports.readAsset = readAsset;
exports.readAssetInfo = readAssetInfo;
exports.filterAttestedAddresses = filterAttestedAddresses;
exports.loadAssetWithListOfAttestedAuthors = loadAssetWithListOfAttestedAuthors;

exports.filterNewOrUnstableUnits = filterNewOrUnstableUnits;

exports.determineWitnessedLevelAndBestParent = determineWitnessedLevelAndBestParent;
exports.determineBestParent = determineBestParent;
exports.determineIfHasWitnessListMutationsAlongMc = determineIfHasWitnessListMutationsAlongMc;

exports.readStaticUnitProps = readStaticUnitProps;
exports.readUnitAuthors = readUnitAuthors;

exports.isKnownUnit = isKnownUnit;
exports.setUnitIsKnown = setUnitIsKnown;
exports.forgetUnit = forgetUnit;
exports.fixIsFreeAfterForgettingUnit = fixIsFreeAfterForgettingUnit;

exports.sliceAndExecuteQuery = sliceAndExecuteQuery;

exports.assocUnstableUnits = assocUnstableUnits;
exports.assocStableUnits = assocStableUnits;
exports.assocStableUnitsByMci = assocStableUnitsByMci;
exports.assocBestChildren = assocBestChildren;
exports.assocHashTreeUnitsByBall = assocHashTreeUnitsByBall;
exports.assocUnstableMessages = assocUnstableMessages;
exports.initCaches = initCaches;
exports.resetMemory = resetMemory;
exports.initializeMinRetrievableMci = initializeMinRetrievableMci;
