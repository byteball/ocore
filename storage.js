/*jslint node: true */
"use strict";
var async = require('async');
var _ = require('lodash');
var db = require('./db.js');
var conf = require('./conf.js');
var objectHash = require("./object_hash.js");
var constants = require("./constants.js");
var mutex = require('./mutex.js');
var profiler = require('./profiler.js');

var MAX_INT32 = Math.pow(2, 31) - 1;

var genesis_ball = objectHash.getBallHash(constants.GENESIS_UNIT);

var MAX_ITEMS_IN_CACHE = 300;
var assocKnownUnits = {};
var assocCachedUnits = {};
var assocCachedUnitAuthors = {};
var assocCachedUnitWitnesses = {};
var assocCachedAssetInfos = {};

var min_retrievable_mci = null;
initializeMinRetrievableMci();


function readJoint(conn, unit, callbacks) {
	if (!conf.bSaveJointJson)
		return readJointDirectly(conn, unit, callbacks);
	conn.query("SELECT json FROM joints WHERE unit=?", [unit], function(rows){
		if (rows.length === 0)
			return readJointDirectly(conn, unit, callbacks);
		callbacks.ifFound(JSON.parse(rows[0].json));
	});
}

function readJointDirectly(conn, unit, callbacks) {
	console.log("\nreading unit "+unit);
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
			content_hash, headers_commission, payload_commission, main_chain_index, "+conn.getUnixTimestamp("units.creation_date")+" AS timestamp \n\
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
			objUnit.timestamp = parseInt(objUnit.timestamp);
			var bFinalBad = !!objUnit.content_hash;
			var bStable = objUnit.is_stable;
			delete objUnit.is_stable;

			objectHash.cleanNulls(objUnit);
			var bVoided = (objUnit.content_hash && main_chain_index < min_retrievable_mci);
			var bRetrievable = (main_chain_index >= min_retrievable_mci || main_chain_index === null);
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
							if (rows.length === 0)
								throw new Error("no messages in unit "+unit);
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
				if (!conf.bSaveJointJson || !bStable || (bFinalBad && bRetrievable))
					return callbacks.ifFound(objJoint);
				conn.query("INSERT "+db.getIgnore()+" INTO joints (unit, json) VALUES (?,?)", [unit, JSON.stringify(objJoint)], function(){
					callbacks.ifFound(objJoint);
				});
			});
		}
	);
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



function readWitnessList(conn, unit, handleWitnessList){
	var arrWitnesses = assocCachedUnitWitnesses[unit];
	if (arrWitnesses)
		return handleWitnessList(arrWitnesses);
	conn.query("SELECT address FROM unit_witnesses WHERE unit=? ORDER BY address", [unit], function(rows){
		if (rows.length === 0)
			throw Error("witness list of unit "+unit+" not found");
		if (rows.length !== constants.COUNT_WITNESSES)
			throw Error("wrong number of witnesses in unit "+unit);
		arrWitnesses = rows.map(function(row){ return row.address; });
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


function readDefinitionByAddress(conn, address, max_mci, callbacks){
	if (max_mci === null)
		max_mci = MAX_INT32;
	// try to find last definition change, otherwise definition_chash=address
	conn.query(
		"SELECT definition_chash FROM address_definition_changes JOIN units USING(unit) \n\
		WHERE address=? AND is_stable=1 AND sequence='good' AND main_chain_index<=? ORDER BY level DESC LIMIT 1", 
		[address, max_mci], 
		function(rows){
			var definition_chash = (rows.length > 0) ? rows[0].definition_chash : address;
			readDefinition(conn, definition_chash, callbacks);
		}
	);
}

function readDefinition(conn, definition_chash, callbacks){
	conn.query("SELECT definition FROM definitions WHERE definition_chash=?", [definition_chash], function(rows){
		if (rows.length === 0)
			return callbacks.ifDefinitionNotFound(definition_chash);
		callbacks.ifFound(JSON.parse(rows[0].definition));
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
	conn.query(
		"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain, is_free, is_stable FROM units WHERE unit=?", 
		[unit], 
		function(rows){
			if (rows.length !== 1)
				throw Error("not 1 row");
			handleProps(rows[0]);
		}
	);
}

function readPropsOfUnits(conn, earlier_unit, arrLaterUnits, handleProps){
	var bEarlierInLaterUnits = (arrLaterUnits.indexOf(earlier_unit) !== -1);
	conn.query(
		"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain, is_free FROM units WHERE unit IN(?, ?)", 
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
			handleProps(objEarlierUnitProps, arrLaterUnitProps);
		}
	);
}






function readLastStableMcUnitProps(conn, handleLastStableMcUnitProps){
	conn.query(
		"SELECT units.*, ball FROM units LEFT JOIN balls USING(unit) WHERE is_on_main_chain=1 AND is_stable=1 ORDER BY main_chain_index DESC LIMIT 1", 
		function(rows){
			if (rows.length === 0)
				return handleLastStableMcUnitProps(null); // empty database
				//throw "readLastStableMcUnitProps: no units on stable MC?";
			if (!rows[0].ball)
				throw Error("no ball for last stable unit");
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

function getMinRetrievableMci(){
	return min_retrievable_mci;
}

function updateMinRetrievableMciAfterStabilizingMci(conn, last_stable_mci, handleMinRetrievableMci){
	console.log("updateMinRetrievableMciAfterStabilizingMci "+last_stable_mci);
	findLastBallMciOfMci(conn, last_stable_mci, function(last_ball_mci){
		if (last_ball_mci <= min_retrievable_mci) // nothing new
			return handleMinRetrievableMci(min_retrievable_mci);
		var prev_min_retrievable_mci = min_retrievable_mci;
		min_retrievable_mci = last_ball_mci;

		// strip content off units older than min_retrievable_mci
		conn.query(
			// 'JOIN messages' filters units that are not stripped yet
			"SELECT DISTINCT unit, content_hash FROM units JOIN messages USING(unit) \n\
			WHERE main_chain_index<=? AND main_chain_index>=? AND sequence='final-bad'", 
			[min_retrievable_mci, prev_min_retrievable_mci],
			function(unit_rows){
				var arrQueries = [];
				async.eachSeries(
					unit_rows,
					function(unit_row, cb){
						var unit = unit_row.unit;
						if (!unit_row.content_hash)
							throw Error("no content hash in bad unit "+unit);
						readJoint(conn, unit, {
							ifNotFound: function(){
								throw Error("bad unit not found: "+unit);
							},
							ifFound: function(objJoint){
								generateQueriesToArchiveJoint(conn, objJoint, 'voided', arrQueries, cb);
							}
						});
					},
					function(){
						if (arrQueries.length === 0)
							return handleMinRetrievableMci(min_retrievable_mci);
						async.series(arrQueries, function(){
							handleMinRetrievableMci(min_retrievable_mci);
						});
					}
				);
			}
		);
	});
}

function initializeMinRetrievableMci(){
	db.query(
		"SELECT MAX(lb_units.main_chain_index) AS min_retrievable_mci \n\
		FROM units JOIN units AS lb_units ON units.last_ball_unit=lb_units.unit \n\
		WHERE units.is_on_main_chain=1 AND units.is_stable=1", 
		function(rows){
			if (rows.length !== 1)
				throw Error("MAX() no rows?");
			min_retrievable_mci = rows[0].min_retrievable_mci;
			if (min_retrievable_mci === null)
				min_retrievable_mci = 0;
		}
	);
}

function generateQueriesToArchiveJoint(conn, objJoint, reason, arrQueries, cb){
	var func = (reason === 'uncovered') ? generateQueriesToRemoveJoint : generateQueriesToVoidJoint;
	func(conn, objJoint.unit.unit, arrQueries, function(){
		conn.addQuery(arrQueries, "INSERT "+conn.getIgnore()+" INTO archived_joints (unit, reason, json) VALUES (?,?,?)", 
			[objJoint.unit.unit, reason, JSON.stringify(objJoint)]);
		cb();
	});
}

function generateQueriesToRemoveJoint(conn, unit, arrQueries, cb){
	generateQueriesToUnspendOutputsSpentInArchivedUnit(conn, unit, arrQueries, function(){
		conn.addQuery(arrQueries, "DELETE FROM witness_list_hashes WHERE witness_list_unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM earned_headers_commission_recipients WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM unit_witnesses WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM authentifiers WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM unit_authors WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM parenthoods WHERE parent_unit=? OR child_unit=?", [unit, unit]);
		conn.addQuery(arrQueries, "DELETE FROM address_definition_changes WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM inputs WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM outputs WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM spend_proofs WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM messages WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM balls WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM units WHERE unit=?", [unit]);
		cb();
	});
}

function generateQueriesToVoidJoint(conn, unit, arrQueries, cb){
	generateQueriesToUnspendOutputsSpentInArchivedUnit(conn, unit, arrQueries, function(){
		// we keep witnesses, author addresses, and the unit itself
		conn.addQuery(arrQueries, "DELETE FROM witness_list_hashes WHERE witness_list_unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM earned_headers_commission_recipients WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM authentifiers WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "UPDATE unit_authors SET definition_chash=NULL WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM address_definition_changes WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM inputs WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM outputs WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM spend_proofs WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM messages WHERE unit=?", [unit]);
		cb();
	});
}

function generateQueriesToUnspendOutputsSpentInArchivedUnit(conn, unit, arrQueries, cb){
	generateQueriesToUnspendTransferOutputsSpentInArchivedUnit(conn, unit, arrQueries, function(){
		generateQueriesToUnspendHeadersCommissionOutputsSpentInArchivedUnit(conn, unit, arrQueries, function(){
			generateQueriesToUnspendWitnessingOutputsSpentInArchivedUnit(conn, unit, arrQueries, cb);
		});
	});
}

function generateQueriesToUnspendTransferOutputsSpentInArchivedUnit(conn, unit, arrQueries, cb){
	conn.query(
		"SELECT src_unit, src_message_index, src_output_index \n\
		FROM inputs \n\
		WHERE inputs.unit=? \n\
			AND inputs.type='transfer' \n\
			AND NOT EXISTS ( \n\
				SELECT 1 FROM inputs AS alt_inputs \n\
				WHERE inputs.src_unit=alt_inputs.src_unit \n\
					AND inputs.src_message_index=alt_inputs.src_message_index \n\
					AND inputs.src_output_index=alt_inputs.src_output_index \n\
					AND alt_inputs.type='transfer' \n\
					AND inputs.unit!=alt_inputs.unit \n\
			)",
		[unit],
		function(rows){
			rows.forEach(function(row){
				conn.addQuery(
					arrQueries, 
					"UPDATE outputs SET is_spent=0 WHERE unit=? AND message_index=? AND output_index=?", 
					[row.src_unit, row.src_message_index, row.src_output_index]
				);
			});
			cb();
		}
	);
}

function generateQueriesToUnspendHeadersCommissionOutputsSpentInArchivedUnit(conn, unit, arrQueries, cb){
	conn.query(
		"SELECT headers_commission_outputs.address, headers_commission_outputs.main_chain_index \n\
		FROM inputs \n\
		CROSS JOIN headers_commission_outputs \n\
			ON inputs.from_main_chain_index <= +headers_commission_outputs.main_chain_index \n\
			AND inputs.to_main_chain_index >= +headers_commission_outputs.main_chain_index \n\
			AND inputs.address = headers_commission_outputs.address \n\
		WHERE inputs.unit=? \n\
			AND inputs.type='headers_commission' \n\
			AND NOT EXISTS ( \n\
				SELECT 1 FROM inputs AS alt_inputs \n\
				WHERE headers_commission_outputs.main_chain_index >= alt_inputs.from_main_chain_index \n\
					AND headers_commission_outputs.main_chain_index <= alt_inputs.to_main_chain_index \n\
					AND inputs.address=alt_inputs.address \n\
					AND alt_inputs.type='headers_commission' \n\
					AND inputs.unit!=alt_inputs.unit \n\
			)",
		[unit],
		function(rows){
			rows.forEach(function(row){
				conn.addQuery(
					arrQueries, 
					"UPDATE headers_commission_outputs SET is_spent=0 WHERE address=? AND main_chain_index=?", 
					[row.address, row.main_chain_index]
				);
			});
			cb();
		}
	);
}

function generateQueriesToUnspendWitnessingOutputsSpentInArchivedUnit(conn, unit, arrQueries, cb){
	conn.query(
		"SELECT witnessing_outputs.address, witnessing_outputs.main_chain_index \n\
		FROM inputs \n\
		CROSS JOIN witnessing_outputs \n\
			ON inputs.from_main_chain_index <= +witnessing_outputs.main_chain_index \n\
			AND inputs.to_main_chain_index >= +witnessing_outputs.main_chain_index \n\
			AND inputs.address = witnessing_outputs.address \n\
		WHERE inputs.unit=? \n\
			AND inputs.type='witnessing' \n\
			AND NOT EXISTS ( \n\
				SELECT 1 FROM inputs AS alt_inputs \n\
				WHERE witnessing_outputs.main_chain_index >= alt_inputs.from_main_chain_index \n\
					AND witnessing_outputs.main_chain_index <= alt_inputs.to_main_chain_index \n\
					AND inputs.address=alt_inputs.address \n\
					AND alt_inputs.type='witnessing' \n\
					AND inputs.unit!=alt_inputs.unit \n\
			)",
		[unit],
		function(rows){
			rows.forEach(function(row){
				conn.addQuery(
					arrQueries, 
					"UPDATE witnessing_outputs SET is_spent=0 WHERE address=? AND main_chain_index=?", 
					[row.address, row.main_chain_index]
				);
			});
			cb();
		}
	);
}

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

function readAsset(conn, asset, last_ball_mci, handleAsset){
	if (last_ball_mci === null){
		if (conf.bLight)
			last_ball_mci = MAX_INT32;
		else
			return readLastStableMcIndex(conn, function(last_stable_mci){
				readAsset(conn, asset, last_stable_mci, handleAsset);
			});
	}
	readAssetInfo(conn, asset, function(objAsset){
		if (!objAsset)
			return handleAsset("asset "+asset+" not found");
		if (objAsset.main_chain_index > last_ball_mci)
			return handleAsset("asset definition must be before last ball");
		if (objAsset.sequence !== "good")
			return handleAsset("asset definition is not serial");
		if (!objAsset.spender_attested)
			return handleAsset(null, objAsset);

		// find latest list of attestors
		conn.query(
			"SELECT MAX(level) AS max_level FROM asset_attestors JOIN units USING(unit) \n\
			WHERE asset=? AND main_chain_index<=? AND is_stable=1 AND sequence='good'", 
			[asset, last_ball_mci],
			function(latest_rows){
				var max_level = latest_rows[0].max_level;
				if (!max_level)
					throw Error("no max level of asset attestors");

				// read the list
				conn.query(
					"SELECT attestor_address FROM asset_attestors JOIN units USING(unit) \n\
					WHERE asset=? AND level=? AND main_chain_index<=? AND is_stable=1 AND sequence='good'",
					[asset, max_level, last_ball_mci],
					function(att_rows){
						if (att_rows.length === 0)
							throw Error("no attestors?");
						objAsset.arrAttestorAddresses = att_rows.map(function(att_row){ return att_row.attestor_address; });
						handleAsset(null, objAsset);
					}
				);
			}
		);
	});
}

// filter only those authors that are attested (doesn't work for light clients)
function filterAttestedAddresses(conn, objAsset, last_ball_mci, arrAuthorAddresses, handleAttestedAddresses){
	conn.query(
		"SELECT DISTINCT address FROM attestations JOIN units USING(unit) \n\
		WHERE attestor_address IN(?) AND address IN(?) AND main_chain_index<=? AND is_stable=1 AND sequence='good'",
		[objAsset.arrAttestorAddresses, arrAuthorAddresses, last_ball_mci],
		function(addr_rows){
			var arrAttestedAddresses = addr_rows.map(function(addr_row){ return addr_row.address; });
			handleAttestedAddresses(arrAttestedAddresses);
		}
	);
}

// note that light clients cannot check attestations
function loadAssetWithListOfAttestedAuthors(conn, asset, last_ball_mci, arrAuthorAddresses, handleAsset){
	readAsset(conn, asset, last_ball_mci, function(err, objAsset){
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
		FROM witness_list_hashes JOIN units ON witness_list_hashes.witness_list_unit=unit \n\
		WHERE witness_list_hash=? AND sequence='good' AND is_stable=1 AND main_chain_index<=?", 
		[objectHash.getBase64Hash(arrWitnesses), last_ball_mci], 
		function(rows){
			handleWitnessListUnit((rows.length === 0) ? null : rows[0].witness_list_unit);
		}
	);
}

function filterNewOrUnstableUnits(arrUnits, handleFilteredUnits){
	var CHUNK_SIZE = 200;
	if (arrUnits.length > CHUNK_SIZE){
		console.log('filterNewOrUnstableUnits: will split in chunks');
		var arrChunks = [];
		for (var offset=0; offset<arrUnits.length; offset+=CHUNK_SIZE)
			arrChunks.push(arrUnits.slice(offset, offset+CHUNK_SIZE));
		var arrFilteredUnits = [];
		async.eachSeries(
			arrChunks,
			function(arrSubsetOfUnits, cb){
				filterNewOrUnstableUnits(arrSubsetOfUnits, function(arrSubsetOfFilteredUnits){
					arrFilteredUnits = arrFilteredUnits.concat(arrSubsetOfFilteredUnits);
					cb();
				});
			},
			function(){
				handleFilteredUnits(arrFilteredUnits);
			}
		);
		return;
	}
	db.query("SELECT unit FROM units WHERE unit IN(?) AND is_stable=1", [arrUnits], function(rows){
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


function readStaticUnitProps(conn, unit, handleProps){
	var props = assocCachedUnits[unit];
	if (props)
		return handleProps(props);
	conn.query("SELECT level, witnessed_level, best_parent_unit, witness_list_unit FROM units WHERE unit=?", [unit], function(rows){
		if (rows.length !== 1)
			throw Error("not 1 unit");
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
			throw Error("no authors");
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

function shrinkCache(){
	if (Object.keys(assocCachedAssetInfos).length > MAX_ITEMS_IN_CACHE)
		assocCachedAssetInfos = {};
	var arrKnownUnits = Object.keys(assocKnownUnits);
	var arrPropsUnits = Object.keys(assocCachedUnits);
	var arrAuthorsUnits = Object.keys(assocCachedUnitAuthors);
	var arrWitnessesUnits = Object.keys(assocCachedUnitWitnesses);
	if (arrPropsUnits.length < MAX_ITEMS_IN_CACHE && arrAuthorsUnits.length < MAX_ITEMS_IN_CACHE && arrWitnessesUnits.length < MAX_ITEMS_IN_CACHE && arrKnownUnits.length < MAX_ITEMS_IN_CACHE)
		return console.log('cache is small, will not shrink');
	var arrUnits = _.union(arrPropsUnits, arrAuthorsUnits, arrWitnessesUnits, arrKnownUnits);
	console.log('will shrink cache, total units: '+arrUnits.length);
	readLastStableMcIndex(db, function(last_stable_mci){
		var CHUNK_SIZE = 500; // there is a limit on the number of query params
		for (var offset=0; offset<arrUnits.length; offset+=CHUNK_SIZE){
			// filter units that became stable more than 100 MC indexes ago
			db.query(
				"SELECT unit FROM units WHERE unit IN(?) AND main_chain_index<? AND main_chain_index!=0", 
				[arrUnits.slice(offset, offset+CHUNK_SIZE), last_stable_mci-100], 
				function(rows){
					console.log('will remove '+rows.length+' units from cache');
					rows.forEach(function(row){
						delete assocKnownUnits[row.unit];
						delete assocCachedUnits[row.unit];
						delete assocCachedUnitAuthors[row.unit];
						delete assocCachedUnitWitnesses[row.unit];
					});
				}
			);
		}
	});
}
setInterval(shrinkCache, 300*1000);

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

exports.readDefinitionByAddress = readDefinitionByAddress;
exports.readDefinition = readDefinition;

exports.readLastMainChainIndex = readLastMainChainIndex;

exports.readLastStableMcUnitProps = readLastStableMcUnitProps;
exports.readLastStableMcIndex = readLastStableMcIndex;


exports.findLastBallMciOfMci = findLastBallMciOfMci;
exports.getMinRetrievableMci = getMinRetrievableMci;
exports.updateMinRetrievableMciAfterStabilizingMci = updateMinRetrievableMciAfterStabilizingMci;

exports.generateQueriesToArchiveJoint = generateQueriesToArchiveJoint;

exports.readAsset = readAsset;
exports.loadAssetWithListOfAttestedAuthors = loadAssetWithListOfAttestedAuthors;

exports.filterNewOrUnstableUnits = filterNewOrUnstableUnits;

exports.determineBestParent = determineBestParent;

exports.readStaticUnitProps = readStaticUnitProps;
exports.readUnitAuthors = readUnitAuthors;

exports.isKnownUnit = isKnownUnit;
exports.setUnitIsKnown = setUnitIsKnown;

