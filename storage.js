/*jslint node: true */
const async = require('async');
const _ = require('lodash');
const db = require('./db.js');
const conf = require('./conf.js');
const objectHash = require("./object_hash.js");
const constants = require("./constants.js");
const mutex = require('./mutex.js');
const archiving = require('./archiving.js');
const profiler = require('./profiler.js');

const MAX_INT32 = Math.pow(2, 31) - 1;

const genesis_ball = objectHash.getBallHash(constants.GENESIS_UNIT);

const MAX_ITEMS_IN_CACHE = 300;
const assocKnownUnits = {};
const assocCachedUnits = {};
const assocCachedUnitAuthors = {};
const assocCachedUnitWitnesses = {};
let assocCachedAssetInfos = {};

const assocUnstableUnits = {};
const assocStableUnits = {};

let min_retrievable_mci = null;
initializeMinRetrievableMci();


function readJoint(conn, unit, callbacks) {
	if (!conf.bSaveJointJson)
		return readJointDirectly(conn, unit, callbacks);
	conn.query("SELECT json FROM joints WHERE unit=?", [unit], rows => {
		if (rows.length === 0)
			return readJointDirectly(conn, unit, callbacks);
		callbacks.ifFound(JSON.parse(rows[0].json));
	});
}

function readJointDirectly(conn, unit, callbacks, bRetrying) {
	console.log(`\nreading unit ${unit}`);
	if (min_retrievable_mci === null){
		console.log("min_retrievable_mci not known yet");
		setTimeout(() => {
			readJointDirectly(conn, unit, callbacks);
		}, 1000);
		return;
	}
	//profiler.start();
	conn.query(
		`SELECT units.unit, version, alt, witness_list_unit, last_ball_unit, balls.ball AS last_ball, is_stable, \n\
            content_hash, headers_commission, payload_commission, main_chain_index, ${conn.getUnixTimestamp("units.creation_date")} AS timestamp \n\
        FROM units LEFT JOIN balls ON last_ball_unit=balls.unit WHERE units.unit=?`, 
		[unit], 
		unit_rows => {
			if (unit_rows.length === 0){
				//profiler.stop('read');
				return callbacks.ifNotFound();
			}
			const objUnit = unit_rows[0];
			const objJoint = {unit: objUnit};
			const main_chain_index = objUnit.main_chain_index;
			//delete objUnit.main_chain_index;
			objUnit.timestamp = parseInt(objUnit.timestamp);
			const bFinalBad = !!objUnit.content_hash;
			const bStable = objUnit.is_stable;
			delete objUnit.is_stable;

			objectHash.cleanNulls(objUnit);
			const bVoided = (objUnit.content_hash && main_chain_index < min_retrievable_mci);
			const bRetrievable = (main_chain_index >= min_retrievable_mci || main_chain_index === null);
			
			if (!conf.bLight && !objUnit.last_ball)
				throw Error(`no last ball in unit ${JSON.stringify(objUnit)}`);
			
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
				callback => { // parents
					conn.query(
						"SELECT parent_unit \n\
						FROM parenthoods \n\
						WHERE child_unit=? \n\
						ORDER BY parent_unit", 
						[unit], 
						rows => {
							if (rows.length === 0)
								return callback();
							objUnit.parent_units = rows.map(({parent_unit}) => parent_unit);
							callback();
						}
					);
				},
				callback => { // ball
					if (bRetrievable && !isGenesisUnit(unit))
						return callback();
					// include the .ball field even if it is not stable yet, because its parents might have been changed 
					// and the receiver should not attempt to verify them
					conn.query("SELECT ball FROM balls WHERE unit=?", [unit], rows => {
						if (rows.length === 0)
							return callback();
						objJoint.ball = rows[0].ball;
						callback();
					});
				},
				callback => { // skiplist
					if (bRetrievable)
						return callback();
					conn.query("SELECT skiplist_unit FROM skiplist_units WHERE unit=? ORDER BY skiplist_unit", [unit], rows => {
						if (rows.length === 0)
							return callback();
						objJoint.skiplist_units = rows.map(({skiplist_unit}) => skiplist_unit);
						callback();
					});
				},
				callback => { // witnesses
					conn.query("SELECT address FROM unit_witnesses WHERE unit=? ORDER BY address", [unit], rows => {
						if (rows.length > 0)
							objUnit.witnesses = rows.map(({address}) => address);
						callback();
					});
				},
				callback => { // earned_headers_commission_recipients
					if (bVoided)
						return callback();
					conn.query("SELECT address, earned_headers_commission_share FROM earned_headers_commission_recipients \
						WHERE unit=? ORDER BY address", 
						[unit], 
						rows => {
							if (rows.length > 0)
								objUnit.earned_headers_commission_recipients = rows;
							callback();
						}
					);
				},
				callback => { // authors
					conn.query("SELECT address, definition_chash FROM unit_authors WHERE unit=? ORDER BY address", [unit], rows => {
						objUnit.authors = [];
						async.eachSeries(
							rows, 
							({address, definition_chash}, cb) => {
								const author = {address: address};

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
									sig_rows => {
										for (let i=0; i<sig_rows.length; i++)
											author.authentifiers[sig_rows[i].path] = sig_rows[i].authentifier;

										// if definition_chash is defined:
										if (definition_chash){
											readDefinition(conn, definition_chash, {
												ifFound(arrDefinition) {
													author.definition = arrDefinition;
													onAuthorDone();
												},
												ifDefinitionNotFound(definition_chash) {
													throw Error(`definition ${definition_chash} not defined`);
												}
											});
										}
										else
											onAuthorDone();
									}
								);
							}, 
							() => {
								callback();
							}
						);
					});
				},
				callback => { // messages
					if (bVoided)
						return callback();
					conn.query(
						"SELECT app, payload_hash, payload_location, payload, payload_uri, payload_uri_hash, message_index \n\
						FROM messages WHERE unit=? ORDER BY message_index", [unit], 
						rows => {
							if (rows.length === 0){
								if (conf.bLight)
									throw new Error(`no messages in unit ${unit}`);
								return callback(); // any errors will be caught by verifying unit hash
							}
							objUnit.messages = [];
							async.eachSeries(
								rows,
								(row, cb) => {
									const objMessage = row;
									const message_index = row.message_index;
									delete objMessage.message_index;
									objectHash.cleanNulls(objMessage);
									objUnit.messages.push(objMessage);
									
									function addSpendProofs(){
										conn.query(
											"SELECT spend_proof, address FROM spend_proofs WHERE unit=? AND message_index=? ORDER BY spend_proof_index",
											[unit, message_index],
											proof_rows => {
												if (proof_rows.length === 0)
													return cb();
												objMessage.spend_proofs = [];
												for (let i=0; i<proof_rows.length; i++){
													const objSpendProof = proof_rows[i];
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
												dch_rows => {
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
												poll_rows => {
													if (poll_rows.length !== 1)
														throw Error("no poll question or too many?");
													objMessage.payload = {question: poll_rows[0].question};
													conn.query("SELECT choice FROM poll_choices WHERE unit=? ORDER BY choice_index", [unit], ch_rows => {
														if (ch_rows.length === 0)
															throw Error("no choices?");
														objMessage.payload.choices = ch_rows.map(({choice}) => choice);
														addSpendProofs();
													});
												}
											);
											break;

										 case "vote":
											conn.query(
												"SELECT poll_unit, choice FROM votes WHERE unit=? AND message_index=?", [unit, message_index], 
												vote_rows => {
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
												asset_rows => {
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
												
													const addAttestors = next => {
														if (!objMessage.payload.spender_attested)
															return next();
														conn.query(
															"SELECT attestor_address FROM asset_attestors \n\
															WHERE unit=? AND message_index=? ORDER BY attestor_address",
															[unit, message_index],
															att_rows => {
																if (att_rows.length === 0)
																	throw Error("no attestors?");
																objMessage.payload.attestors = att_rows.map(({attestor_address}) => attestor_address);
																next();
															}
														);
													};
												
													const addDenominations = next => {
														if (!objMessage.payload.fixed_denominations)
															return next();
														conn.query(
															"SELECT denomination, count_coins FROM asset_denominations \n\
															WHERE asset=? ORDER BY denomination",
															[unit],
															denom_rows => {
																if (denom_rows.length === 0)
																	throw Error("no denominations?");
																objMessage.payload.denominations = denom_rows.map(({denomination, count_coins}) => {
																	const denom = {denomination: denomination};
																	if (count_coins)
																		denom.count_coins = count_coins;
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
												att_rows => {
													if (att_rows.length === 0)
														throw Error("no attestors?");
													objMessage.payload = {asset: att_rows[0].asset};
													if (att_rows.length > 1 
															&& att_rows.some(({asset}) => asset !== objMessage.payload.asset))
														throw Error("different assets in attestor list");
													objMessage.payload.attestors = att_rows.map(({attestor_address}) => attestor_address);
													addSpendProofs();
												}
											);
											break;

										case "data_feed":
											conn.query(
												"SELECT feed_name, `value`, int_value FROM data_feeds WHERE unit=? AND message_index=?", [unit, message_index], 
												df_rows => {
													if (df_rows.length === 0)
														throw Error("no data feed?");
													objMessage.payload = {};
													df_rows.forEach(({feed_name, value, int_value}) => {
														objMessage.payload[feed_name] = 
															(typeof value === 'string') ? value : Number(int_value);
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
											let prev_asset;
											let prev_denomination;
											
											const readInputs = cb2 => {
												conn.query(
													"SELECT type, denomination, assets.fixed_denominations, \n\
														src_unit AS unit, src_message_index AS message_index, src_output_index AS output_index, \n\
														from_main_chain_index, to_main_chain_index, serial_number, amount, address, asset \n\
													FROM inputs \n\
													LEFT JOIN assets ON asset=assets.unit \n\
													WHERE inputs.unit=? AND inputs.message_index=? \n\
													ORDER BY input_index", 
													[unit, message_index],
													input_rows => {
														objMessage.payload.inputs = [];
														for (let i=0; i<input_rows.length; i++){
															const input = input_rows[i];
															if (!input.address && !conf.bLight) // may be NULL for light (light clients are reading units e.g. after receiving payment notification)
																throw Error("readJoint: input address is NULL");
															const asset = input.asset;
															const denomination = input.denomination;
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
											const readOutputs = cb2 => {
												objMessage.payload.outputs = [];
												conn.query( // we don't select blinding because it's absent on public payments
													"SELECT address, amount, asset, denomination \n\
													FROM outputs WHERE unit=? AND message_index=? ORDER BY output_index", 
													[unit, message_index],
													output_rows => {
														for (let i=0; i<output_rows.length; i++){
															const output = output_rows[i];
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
						}
					);
				}
			], () => {
				//profiler.stop('read');
				// verify unit hash. Might fail if the unit was archived while reading, in this case retry
				// light wallets don't have last_ball, don't verify their hashes
				if (!conf.bLight && !isCorrectHash(objUnit, unit)){
					if (bRetrying)
						throw Error(`unit hash verification failed, unit: ${unit}, objUnit: ${JSON.stringify(objUnit)}`);
					console.log("unit hash verification failed, will retry");
					return setTimeout(() => {
						readJointDirectly(conn, unit, callbacks, true);
					}, 60*1000);
				}
				if (!conf.bSaveJointJson || !bStable || (bFinalBad && bRetrievable) || bRetrievable)
					return callbacks.ifFound(objJoint);
				conn.query(`INSERT ${db.getIgnore()} INTO joints (unit, json) VALUES (?,?)`, [unit, JSON.stringify(objJoint)], () => {
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
		ifNotFound() {
			throw Error(`joint not found, unit ${unit}`);
		},
		ifFound(objJoint) {
			if (objJoint.ball)
				return handleJoint(objJoint);
			conn.query("SELECT ball FROM balls WHERE unit=?", [unit], rows => {
				if (rows.length === 1)
					objJoint.ball = rows[0].ball;
				handleJoint(objJoint);
			});
		}
	});
}



function readWitnessList(conn, unit, handleWitnessList, bAllowEmptyList){
	let arrWitnesses = assocCachedUnitWitnesses[unit];
	if (arrWitnesses)
		return handleWitnessList(arrWitnesses);
	conn.query("SELECT address FROM unit_witnesses WHERE unit=? ORDER BY address", [unit], rows => {
		if (!bAllowEmptyList && rows.length === 0)
			throw Error(`witness list of unit ${unit} not found`);
		if (rows.length > 0 && rows.length !== constants.COUNT_WITNESSES)
			throw Error(`wrong number of witnesses in unit ${unit}`);
		arrWitnesses = rows.map(({address}) => address);
		if (rows.length > 0)
			assocCachedUnitWitnesses[unit] = arrWitnesses;
		handleWitnessList(arrWitnesses);
	});
}

function readWitnesses(conn, unit, handleWitnessList){
	const arrWitnesses = assocCachedUnitWitnesses[unit];
	if (arrWitnesses)
		return handleWitnessList(arrWitnesses);
	conn.query("SELECT witness_list_unit FROM units WHERE unit=?", [unit], rows => {
		if (rows.length === 0)
			throw Error(`unit ${unit} not found`);
		const witness_list_unit = rows[0].witness_list_unit;
		readWitnessList(conn, witness_list_unit ? witness_list_unit : unit, arrWitnesses => {
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
		({length}) => {
			handleResult(length > 0);
		}
	);
}

function determineWitnessedLevelAndBestParent(conn, arrParentUnits, arrWitnesses, handleWitnessedLevelAndBestParent){
	const arrCollectedWitnesses = [];
	let my_best_parent_unit;

	function addWitnessesAndGoUp(start_unit){
		readStaticUnitProps(conn, start_unit, props => {
			const best_parent_unit = props.best_parent_unit;
			const level = props.level;
			if (level === null)
				throw Error("null level in updateWitnessedLevel");
			if (level === 0) // genesis
				return handleWitnessedLevelAndBestParent(0, my_best_parent_unit);
			readUnitAuthors(conn, start_unit, arrAuthors => {
				for (let i=0; i<arrAuthors.length; i++){
					const address = arrAuthors[i];
					if (arrWitnesses.indexOf(address) !== -1 && arrCollectedWitnesses.indexOf(address) === -1)
						arrCollectedWitnesses.push(address);
				}
				(arrCollectedWitnesses.length < constants.MAJORITY_OF_WITNESSES) 
					? addWitnessesAndGoUp(best_parent_unit) : handleWitnessedLevelAndBestParent(level, my_best_parent_unit);
			});
		});
	}

	determineBestParent(conn, {parent_units: arrParentUnits, witness_list_unit: 'none'}, arrWitnesses, best_parent_unit => {
		if (!best_parent_unit)
			throw Error(`no best parent of ${arrParentUnits.join(', ')}`);
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


// max_mci must be stable
function readDefinitionByAddress(conn, address, max_mci, callbacks){
	if (max_mci === null)
		max_mci = MAX_INT32;
	// try to find last definition change, otherwise definition_chash=address
	conn.query(
		"SELECT definition_chash FROM address_definition_changes CROSS JOIN units USING(unit) \n\
		WHERE address=? AND is_stable=1 AND sequence='good' AND main_chain_index<=? ORDER BY level DESC LIMIT 1", 
		[address, max_mci], 
		rows => {
			const definition_chash = (rows.length > 0) ? rows[0].definition_chash : address;
			readDefinitionAtMci(conn, definition_chash, max_mci, callbacks);
		}
	);
}

// max_mci must be stable
function readDefinitionAtMci(conn, definition_chash, max_mci, callbacks){
	const sql = "SELECT definition FROM definitions CROSS JOIN unit_authors USING(definition_chash) CROSS JOIN units USING(unit) \n\
		WHERE definition_chash=? AND is_stable=1 AND sequence='good' AND main_chain_index<=?";
	const params = [definition_chash, max_mci];
	conn.query(sql, params, rows => {
		if (rows.length === 0)
			return callbacks.ifDefinitionNotFound(definition_chash);
		callbacks.ifFound(JSON.parse(rows[0].definition));
	});
}

function readDefinition(conn, definition_chash, callbacks){
	conn.query("SELECT definition FROM definitions WHERE definition_chash=?", [definition_chash], rows => {
		if (rows.length === 0)
			return callbacks.ifDefinitionNotFound(definition_chash);
		callbacks.ifFound(JSON.parse(rows[0].definition));
	});
}

function readFreeJoints(ifFoundFreeBall, onDone){
	db.query("SELECT units.unit FROM units LEFT JOIN archived_joints USING(unit) WHERE is_free=1 AND archived_joints.unit IS NULL", rows => {
		async.each(rows, ({unit}, cb) => {
			readJoint(db, unit, {
				ifNotFound() {
					throw Error("free ball lost");
				},
				ifFound(objJoint) {
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
	conn.query(
		"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain, is_free, is_stable, witnessed_level FROM units WHERE unit=?", 
		[unit], 
		rows => {
			if (rows.length !== 1)
				throw Error("not 1 row");
			const props = rows[0];
			if (props.is_stable)
				assocStableUnits[unit] = props;
			else{
				const props2 = _.cloneDeep(assocUnstableUnits[unit]);
				if (!props2)
					throw Error(`no unstable props of ${unit}`);
				delete props2.parent_units;
				if (!_.isEqual(props, props2))
					throw Error(`different props of ${unit}, mem: ${JSON.stringify(props2)}, db: ${JSON.stringify(props)}`);
			}
			handleProps(props);
		}
	);
}

function readPropsOfUnits(conn, earlier_unit, arrLaterUnits, handleProps){
	const bEarlierInLaterUnits = (arrLaterUnits.indexOf(earlier_unit) !== -1);
	conn.query(
		"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain, is_free FROM units WHERE unit IN(?, ?)", 
		[earlier_unit, arrLaterUnits], 
		rows => {
            if (rows.length !== arrLaterUnits.length + (bEarlierInLaterUnits ? 0 : 1))
				throw Error(`wrong number of rows for earlier ${earlier_unit}, later ${arrLaterUnits}`);
            let objEarlierUnitProps;
            const arrLaterUnitProps = [];
            for (let i=0; i<rows.length; i++){
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
		rows => {
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
	readLastStableMcUnitProps(conn, objLastStableMcUnitProps => {
		handleLastStableMcIndex(objLastStableMcUnitProps ? objLastStableMcUnitProps.main_chain_index : 0);
	});
}


function readLastMainChainIndex(handleLastMcIndex){
	db.query("SELECT MAX(main_chain_index) AS last_mc_index FROM units", rows => {
		let last_mc_index = rows[0].last_mc_index;
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
		rows => {
			if (rows.length !== 1)
				throw Error(`last ball's mci count ${rows.length} !== 1, mci = ${mci}`);
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
	console.log(`updateMinRetrievableMciAfterStabilizingMci ${last_stable_mci}`);
	findLastBallMciOfMci(conn, last_stable_mci, last_ball_mci => {
		if (last_ball_mci <= min_retrievable_mci) // nothing new
			return handleMinRetrievableMci(min_retrievable_mci);
		const prev_min_retrievable_mci = min_retrievable_mci;
		min_retrievable_mci = last_ball_mci;

		// strip content off units older than min_retrievable_mci
		conn.query(
			// 'JOIN messages' filters units that are not stripped yet
			`SELECT DISTINCT unit, content_hash FROM units ${db.forceIndex('byMcIndex')} CROSS JOIN messages USING(unit) \n\
            WHERE main_chain_index<=? AND main_chain_index>=? AND sequence='final-bad'`, 
			[min_retrievable_mci, prev_min_retrievable_mci],
			unit_rows => {
				const arrQueries = [];
				async.eachSeries(
					unit_rows,
					(unit_row, cb) => {
						const unit = unit_row.unit;
						if (!unit_row.content_hash)
							throw Error(`no content hash in bad unit ${unit}`);
						readJoint(conn, unit, {
							ifNotFound() {
								throw Error(`bad unit not found: ${unit}`);
							},
							ifFound(objJoint) {
								archiving.generateQueriesToArchiveJoint(conn, objJoint, 'voided', arrQueries, cb);
							}
						});
					},
					() => {
						if (arrQueries.length === 0)
							return handleMinRetrievableMci(min_retrievable_mci);
						async.series(arrQueries, () => {
							unit_rows.forEach(({unit}) => {
								forgetUnit(unit);
							});
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
		rows => {
			if (rows.length !== 1)
				throw Error("MAX() no rows?");
			min_retrievable_mci = rows[0].min_retrievable_mci;
			if (min_retrievable_mci === null)
				min_retrievable_mci = 0;
		}
	);
}


function archiveJointAndDescendantsIfExists(from_unit){
	console.log(`will archive if exists from unit ${from_unit}`);
	db.query("SELECT 1 FROM units WHERE unit=?", [from_unit], ({length}) => {
		if (length > 0)
			archiveJointAndDescendants(from_unit);
	});
}

function archiveJointAndDescendants(from_unit){
	db.executeInTransaction(function doWork(conn, cb){
		
		function addChildren(arrParentUnits){
			conn.query("SELECT DISTINCT child_unit FROM parenthoods WHERE parent_unit IN(?)", [arrParentUnits], rows => {
				if (rows.length === 0)
					return archive();
				const arrChildUnits = rows.map(({child_unit}) => child_unit);
				arrUnits = arrUnits.concat(arrChildUnits);
				addChildren(arrChildUnits);
			});
		}
		
		function archive(){
			arrUnits = _.uniq(arrUnits); // does not affect the order
			arrUnits.reverse();
			console.log('will archive', arrUnits);
			const arrQueries = [];
			async.eachSeries(
				arrUnits,
				(unit, cb2) => {
					readJoint(conn, unit, {
						ifNotFound() {
							throw Error(`unit to be archived not found: ${unit}`);
						},
						ifFound(objJoint) {
							archiving.generateQueriesToArchiveJoint(conn, objJoint, 'uncovered', arrQueries, cb2);
						}
					});
				},
				() => {
					conn.addQuery(arrQueries, "DELETE FROM known_bad_joints");
					console.log(`will execute ${arrQueries.length} queries to archive`);
					async.series(arrQueries, () => {
						arrUnits.forEach(forgetUnit);
						cb();
					});
				}
			);
		}
		
		console.log(`will archive from unit ${from_unit}`);
		var arrUnits = [from_unit];
		addChildren([from_unit]);
	},
	function onDone(){
		console.log(`done archiving from unit ${from_unit}`);
	});
}


//_______________________________________________________________________________________________
// Assets

function readAssetInfo(conn, asset, handleAssetInfo){
	const objAsset = assocCachedAssetInfos[asset];
	if (objAsset)
		return handleAssetInfo(objAsset);
	conn.query(
		"SELECT assets.*, main_chain_index, sequence, is_stable, address AS definer_address, unit AS asset \n\
		FROM assets JOIN units USING(unit) JOIN unit_authors USING(unit) WHERE unit=?", 
		[asset], 
		rows => {
			if (rows.length > 1)
				throw Error("more than one asset?");
			if (rows.length === 0)
				return handleAssetInfo(null);
			const objAsset = rows[0];
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
			return readLastStableMcIndex(conn, last_stable_mci => {
				readAsset(conn, asset, last_stable_mci, handleAsset);
			});
	}
	readAssetInfo(conn, asset, objAsset => {
		if (!objAsset)
			return handleAsset(`asset ${asset} not found`);
		if (objAsset.main_chain_index > last_ball_mci)
			return handleAsset("asset definition must be before last ball");
		if (objAsset.sequence !== "good")
			return handleAsset("asset definition is not serial");
		if (!objAsset.spender_attested)
			return handleAsset(null, objAsset);

		// find latest list of attestors
		conn.query(
			"SELECT MAX(level) AS max_level FROM asset_attestors CROSS JOIN units USING(unit) \n\
			WHERE asset=? AND main_chain_index<=? AND is_stable=1 AND sequence='good'", 
			[asset, last_ball_mci],
			latest_rows => {
				const max_level = latest_rows[0].max_level;
				if (!max_level)
					throw Error("no max level of asset attestors");

				// read the list
				conn.query(
					"SELECT attestor_address FROM asset_attestors CROSS JOIN units USING(unit) \n\
					WHERE asset=? AND level=? AND main_chain_index<=? AND is_stable=1 AND sequence='good'",
					[asset, max_level, last_ball_mci],
					att_rows => {
						if (att_rows.length === 0)
							throw Error("no attestors?");
						objAsset.arrAttestorAddresses = att_rows.map(({attestor_address}) => attestor_address);
						handleAsset(null, objAsset);
					}
				);
			}
		);
	});
}

// filter only those addresses that are attested (doesn't work for light clients)
function filterAttestedAddresses(
    conn,
    {arrAttestorAddresses},
    last_ball_mci,
    arrAddresses,
    handleAttestedAddresses
) {
	conn.query(
		"SELECT DISTINCT address FROM attestations CROSS JOIN units USING(unit) \n\
		WHERE attestor_address IN(?) AND address IN(?) AND main_chain_index<=? AND is_stable=1 AND sequence='good' \n\
			AND main_chain_index>IFNULL( \n\
				(SELECT main_chain_index FROM address_definition_changes JOIN units USING(unit) \n\
				WHERE address_definition_changes.address=attestations.address ORDER BY main_chain_index DESC LIMIT 1), \n\
			0)",
		[arrAttestorAddresses, arrAddresses, last_ball_mci],
		addr_rows => {
			const arrAttestedAddresses = addr_rows.map(({address}) => address);
			handleAttestedAddresses(arrAttestedAddresses);
		}
	);
}

// note that light clients cannot check attestations
function loadAssetWithListOfAttestedAuthors(conn, asset, last_ball_mci, arrAuthorAddresses, handleAsset){
	readAsset(conn, asset, last_ball_mci, (err, objAsset) => {
		if (err)
			return handleAsset(err);
		if (!objAsset.spender_attested)
			return handleAsset(null, objAsset);
		filterAttestedAddresses(conn, objAsset, last_ball_mci, arrAuthorAddresses, arrAttestedAddresses => {
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
		rows => {
			handleWitnessListUnit((rows.length === 0) ? null : rows[0].witness_list_unit);
		}
	);
}

function sliceAndExecuteQuery(query, params, largeParam, callback) {
	if (typeof largeParam !== 'object' || largeParam.length === 0) return callback([]);
	const CHUNK_SIZE = 200;
	const length = largeParam.length;
	const arrParams = [];
	let newParams;
	const largeParamPosition = params.indexOf(largeParam);

	for (let offset = 0; offset < length; offset += CHUNK_SIZE) {
		newParams = params.slice(0);
		newParams[largeParamPosition] = largeParam.slice(offset, offset + CHUNK_SIZE);
		arrParams.push(newParams);
	}

	let result = [];
	async.eachSeries(arrParams, (params, cb) => {
		db.query(query, params, rows => {
			result = result.concat(rows);
			cb();
		});
	}, () => {
		callback(result);
	});
}

function filterNewOrUnstableUnits(arrUnits, handleFilteredUnits){
	sliceAndExecuteQuery("SELECT unit FROM units WHERE unit IN(?) AND is_stable=1", [arrUnits], arrUnits, rows => {
		const arrKnownStableUnits = rows.map(({unit}) => unit);
		const arrNewOrUnstableUnits = _.difference(arrUnits, arrKnownStableUnits);
		handleFilteredUnits(arrNewOrUnstableUnits);
	});
}

// for unit that is not saved to the db yet
function determineBestParent(conn, {parent_units, witness_list_unit}, arrWitnesses, handleBestParent) {
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
		[parent_units, witness_list_unit, 
		arrWitnesses, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS], 
		rows => {
			if (rows.length !== 1)
				return handleBestParent(null);
			const best_parent_unit = rows[0].unit;
			handleBestParent(best_parent_unit);
		}
	);
}

function determineIfHasWitnessListMutationsAlongMc(conn, objUnit, last_ball_unit, arrWitnesses, handleResult){
	if (!objUnit.parent_units) // genesis
		return handleResult();
	buildListOfMcUnitsWithPotentiallyDifferentWitnesslists(conn, objUnit, last_ball_unit, arrWitnesses, (bHasBestParent, arrMcUnits) => {
		if (!bHasBestParent)
			return handleResult("no compatible best parent");
		console.log("###### MC units ", arrMcUnits);
		if (arrMcUnits.length === 0)
			return handleResult();
		conn.query(
			"SELECT units.unit, COUNT(*) AS count_matching_witnesses \n\
			FROM units CROSS JOIN unit_witnesses ON (units.unit=unit_witnesses.unit OR units.witness_list_unit=unit_witnesses.unit) AND address IN(?) \n\
			WHERE units.unit IN(?) \n\
			GROUP BY units.unit \n\
			HAVING count_matching_witnesses<?",
			[arrWitnesses, arrMcUnits, constants.COUNT_WITNESSES - constants.MAX_WITNESS_LIST_MUTATIONS],
			rows => {
				console.log(rows);
				if (rows.length > 0)
					return handleResult(`too many (${constants.COUNT_WITNESSES - rows[0].count_matching_witnesses}) witness list mutations relative to MC unit ${rows[0].unit}`);
				handleResult();
			}
		);
	});
}

// the MC for this function is the MC built from this unit, not our current MC
function buildListOfMcUnitsWithPotentiallyDifferentWitnesslists(conn, objUnit, last_ball_unit, arrWitnesses, handleList){

	function addAndGoUp(unit){
		readStaticUnitProps(conn, unit, ({witness_list_unit, best_parent_unit}) => {
			// the parent has the same witness list and the parent has already passed the MC compatibility test
			if (objUnit.witness_list_unit && objUnit.witness_list_unit === witness_list_unit)
				return handleList(true, arrMcUnits);
			else
				arrMcUnits.push(unit);
			if (unit === last_ball_unit)
				return handleList(true, arrMcUnits);
			if (!best_parent_unit)
				throw Error(`no best parent of unit ${unit}?`);
			addAndGoUp(best_parent_unit);
		});
	}

	var arrMcUnits = [];
	determineBestParent(conn, objUnit, arrWitnesses, best_parent_unit => {
		if (!best_parent_unit)
			return handleList(false);
		addAndGoUp(best_parent_unit);
	});
}


function readStaticUnitProps(conn, unit, handleProps){
	let props = assocCachedUnits[unit];
	if (props)
		return handleProps(props);
	conn.query("SELECT level, witnessed_level, best_parent_unit, witness_list_unit FROM units WHERE unit=?", [unit], rows => {
		if (rows.length !== 1)
			throw Error("not 1 unit");
		props = rows[0];
		assocCachedUnits[unit] = props;
		handleProps(props);
	});
}

function readUnitAuthors(conn, unit, handleAuthors){
	const arrAuthors = assocCachedUnitAuthors[unit];
	if (arrAuthors)
		return handleAuthors(arrAuthors);
	conn.query("SELECT address FROM unit_authors WHERE unit=?", [unit], rows => {
		if (rows.length === 0)
			throw Error("no authors");
		const arrAuthors2 = rows.map(({address}) => address).sort();
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
	delete assocKnownUnits[unit];
	delete assocCachedUnits[unit];
	delete assocCachedUnitAuthors[unit];
	delete assocCachedUnitWitnesses[unit];
	delete assocUnstableUnits[unit];
	delete assocStableUnits[unit];
}

function shrinkCache(){
	if (Object.keys(assocCachedAssetInfos).length > MAX_ITEMS_IN_CACHE)
		assocCachedAssetInfos = {};
	console.log(`${Object.keys(assocUnstableUnits).length} unstable units`);
	const arrKnownUnits = Object.keys(assocKnownUnits);
	const arrPropsUnits = Object.keys(assocCachedUnits);
	const arrStableUnits = Object.keys(assocStableUnits);
	const arrAuthorsUnits = Object.keys(assocCachedUnitAuthors);
	const arrWitnessesUnits = Object.keys(assocCachedUnitWitnesses);
	if (arrPropsUnits.length < MAX_ITEMS_IN_CACHE && arrAuthorsUnits.length < MAX_ITEMS_IN_CACHE && arrWitnessesUnits.length < MAX_ITEMS_IN_CACHE && arrKnownUnits.length < MAX_ITEMS_IN_CACHE && arrStableUnits.length < MAX_ITEMS_IN_CACHE)
		return console.log('cache is small, will not shrink');
	const arrUnits = _.union(arrPropsUnits, arrAuthorsUnits, arrWitnessesUnits, arrKnownUnits, arrStableUnits);
	console.log(`will shrink cache, total units: ${arrUnits.length}`);
	readLastStableMcIndex(db, last_stable_mci => {
		const CHUNK_SIZE = 500; // there is a limit on the number of query params
		for (let offset=0; offset<arrUnits.length; offset+=CHUNK_SIZE){
			// filter units that became stable more than 100 MC indexes ago
			db.query(
				"SELECT unit FROM units WHERE unit IN(?) AND main_chain_index<? AND main_chain_index!=0", 
				[arrUnits.slice(offset, offset+CHUNK_SIZE), last_stable_mci-100], 
				rows => {
					console.log(`will remove ${rows.length} units from cache`);
					rows.forEach(({unit}) => {
						delete assocKnownUnits[unit];
						delete assocCachedUnits[unit];
						delete assocStableUnits[unit];
						delete assocCachedUnitAuthors[unit];
						delete assocCachedUnitWitnesses[unit];
					});
				}
			);
		}
	});
}
setInterval(shrinkCache, 300*1000);



function initUnstableUnits(onDone){
	db.query(
		"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain, is_free, is_stable, witnessed_level \n\
		FROM units WHERE is_stable=0 ORDER BY +level",
		rows => {
		//	assocUnstableUnits = {};
			rows.forEach(row => {
				row.parent_units = [];
				assocUnstableUnits[row.unit] = row;
			});
			console.log('initUnstableUnits 1 done');
			db.query(
				`SELECT parent_unit, child_unit FROM parenthoods WHERE child_unit IN(${Object.keys(assocUnstableUnits).map(db.escape)})`, 
				prows => {
					prows.forEach(({child_unit, parent_unit}) => {
						assocUnstableUnits[child_unit].parent_units.push(parent_unit);
					});
					console.log('initUnstableUnits done');
					if (onDone)
						onDone();
				}
			);
		}
	);
}

function resetUnstableUnits(onDone){
	Object.keys(assocUnstableUnits).forEach(unit => {
		delete assocUnstableUnits[unit];
	});
	initUnstableUnits(onDone);
}

mutex.lock(['write'], initUnstableUnits);

if (!conf.bLight)
	archiveJointAndDescendantsIfExists('N6QadI9yg3zLxPMphfNGJcPfddW4yHPkoGMbbGZsWa0=');


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

exports.archiveJointAndDescendantsIfExists = archiveJointAndDescendantsIfExists;

exports.readAsset = readAsset;
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

exports.sliceAndExecuteQuery = sliceAndExecuteQuery;

exports.assocUnstableUnits = assocUnstableUnits;
exports.assocStableUnits = assocStableUnits;
exports.resetUnstableUnits = resetUnstableUnits;
