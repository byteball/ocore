/*jslint node: true */
"use strict";
var crypto = require('crypto');
var async = require('async');
var db = require('./db.js');
var constants = require('./constants.js');
var objectHash = require('./object_hash.js');
var objectLength = require("./object_length.js");
var ecdsaSig = require('./signature.js');
var mutex = require('./mutex.js');
var _ = require('lodash');
var storage = require('./storage.js');
var myWitnesses = require('./my_witnesses.js');
var parentComposer = require('./parent_composer.js');
var validation = require('./validation.js');
var writer = require('./writer.js');
var conf = require('./conf.js');
var profiler = require('./profiler.js');
var inputs = require('./inputs.js');

var hash_placeholder = "--------------------------------------------"; // 256 bits (32 bytes) base64: 44 bytes
var sig_placeholder = "----------------------------------------------------------------------------------------"; // 88 bytes


var bGenesis = false;
exports.setGenesis = function(_bGenesis){ bGenesis = _bGenesis; };


function repeatString(str, times){
	if (str.repeat)
		return str.repeat(times);
	return (new Array(times+1)).join(str);
}

function sortOutputs(a,b){
	var addr_comparison = a.address.localeCompare(b.address);
	return addr_comparison ? addr_comparison : (a.amount - b.amount);
}

function createTextMessage(text){
	return {
		app: "text",
		payload_location: "inline",
		payload_hash: objectHash.getBase64Hash(text, storage.getMinRetrievableMci() >= constants.timestampUpgradeMci),
		payload: text
	};
}

// change goes back to the first paying address
function composeTextJoint(arrSigningAddresses, arrPayingAddresses, text, signer, callbacks){
	composePaymentAndTextJoint(arrSigningAddresses, arrPayingAddresses, [{address: arrPayingAddresses[0], amount: 0}], text, signer, callbacks);
}

function composePaymentJoint(arrFromAddresses, arrOutputs, signer, callbacks){
	composeJoint({paying_addresses: arrFromAddresses, outputs: arrOutputs, signer: signer, callbacks: callbacks});
}
	
function composePaymentAndTextJoint(arrSigningAddresses, arrPayingAddresses, arrOutputs, text, signer, callbacks){
	composeJoint({
		signing_addresses: arrSigningAddresses, 
		paying_addresses: arrPayingAddresses, 
		outputs: arrOutputs, 
		messages: [createTextMessage(text)], 
		signer: signer, 
		callbacks: callbacks
	});
}

function composeContentJoint(from_address, app, payload, signer, callbacks){
	var objMessage = {
		app: app,
		payload_location: "inline",
		payload: payload
	};
	objMessage.payload_hash = objectHash.getBase64Hash(getPayloadForHash(objMessage), storage.getMinRetrievableMci() >= constants.timestampUpgradeMci);
	composeJoint({
		paying_addresses: [from_address], 
		outputs: [{address: from_address, amount: 0}], 
		messages: [objMessage], 
		signer: signer, 
		callbacks: callbacks
	});
}

function composeDefinitionChangeJoint(from_address, definition_chash, signer, callbacks){
	composeContentJoint(from_address, "address_definition_change", {definition_chash: definition_chash}, signer, callbacks);
}

function composeDataFeedJoint(from_address, data, signer, callbacks){
	composeContentJoint(from_address, "data_feed", data, signer, callbacks);
}

function composeDataJoint(from_address, data, signer, callbacks){
	composeContentJoint(from_address, "data", data, signer, callbacks);
}

function composeDefinitionTemplateJoint(from_address, arrDefinitionTemplate, signer, callbacks){
	composeContentJoint(from_address, "definition_template", arrDefinitionTemplate, signer, callbacks);
}

function composePollJoint(from_address, question, arrChoices, signer, callbacks){
	var poll_data = {question: question, choices: arrChoices};
	composeContentJoint(from_address, "poll", poll_data, signer, callbacks);
}

function composeVoteJoint(from_address, poll_unit, choice, signer, callbacks){
	var vote_data = {unit: poll_unit, choice: choice};
	composeContentJoint(from_address, "vote", vote_data, signer, callbacks);
}

function composeProfileJoint(from_address, profile_data, signer, callbacks){
	composeContentJoint(from_address, "profile", profile_data, signer, callbacks);
}

function composeAttestationJoint(from_address, attested_address, profile_data, signer, callbacks){
	composeContentJoint(from_address, "attestation", {address: attested_address, profile: profile_data}, signer, callbacks);
}

function composeAssetDefinitionJoint(from_address, asset_definition, signer, callbacks){
	composeContentJoint(from_address, "asset", asset_definition, signer, callbacks);
}

function composeAssetAttestorsJoint(from_address, asset, arrNewAttestors, signer, callbacks){
	composeContentJoint(from_address, "asset_attestors", {asset: asset, attestors: arrNewAttestors}, signer, callbacks);
}

/*
	params.signing_addresses must sign the message but they do not necessarily pay 
	params.paying_addresses pay for byte outputs and commissions
*/
function composeJoint(params){
	
	if (storage.getMinRetrievableMci() >= constants.v4UpgradeMci || conf.bLight) {
		if (storage.systemVars.threshold_size.length === 0)
			return params.callbacks.ifError("sys vars not initialized yet");
		var arrWitnesses = storage.getOpList(Infinity);
	}
	else {
		var arrWitnesses = params.witnesses;
		if (!arrWitnesses) {
			myWitnesses.readMyWitnesses(function (_arrWitnesses) {
				params.witnesses = _arrWitnesses;
				composeJoint(params);
			});
			return;
		}
	}
	
	/*if (conf.bLight && !params.lightProps){
		var network = require('./network.js');
		network.requestFromLightVendor(
			'light/get_parents_and_last_ball_and_witness_list_unit', 
			{witnesses: arrWitnesses}, 
			function(ws, request, response){
				if (response.error)
					return params.callbacks.ifError(response.error);
				if (!response.parent_units || !response.last_stable_mc_ball || !response.last_stable_mc_ball_unit || typeof response.last_stable_mc_ball_mci !== 'number')
					return params.callbacks.ifError("invalid parents from light vendor");
				params.lightProps = response;
				composeJoint(params);
			}
		);
		return;
	}*/
	
	// try to use as few paying_addresses as possible. Assuming paying_addresses are sorted such that the most well-funded addresses come first
	if (params.minimal && !params.send_all){
		var callbacks = params.callbacks;
		var arrCandidatePayingAddresses = params.paying_addresses;

		var trySubset = function(count){
			if (count > constants.MAX_AUTHORS_PER_UNIT)
				return callbacks.ifNotEnoughFunds("Too many authors.  Consider splitting the payment into two units.");
			var try_params = _.clone(params);
			delete try_params.minimal;
			try_params.paying_addresses = arrCandidatePayingAddresses.slice(0, count);
			try_params.callbacks = {
				ifOk: callbacks.ifOk,
				ifError: callbacks.ifError,
				ifNotEnoughFunds: function(error_message){
					if (count === arrCandidatePayingAddresses.length)
						return callbacks.ifNotEnoughFunds(error_message);
					trySubset(count+1); // add one more paying address
				}
			};
			composeJoint(try_params);
		};
		
		return trySubset(1);
	}
	
	var arrSigningAddresses = params.signing_addresses || [];
	var arrPayingAddresses = params.paying_addresses || [];
	var arrOutputs = params.outputs || [];
	var arrMessages = _.clone(params.messages || []);
	var assocPrivatePayloads = params.private_payloads || {}; // those that correspond to a subset of params.messages
	var fnRetrieveMessages = params.retrieveMessages;
//	var lightProps = params.lightProps;
	const max_aa_responses = (typeof params.max_aa_responses === "number") ? params.max_aa_responses : constants.MAX_RESPONSES_PER_PRIMARY_TRIGGER;
	var signer = params.signer;
	var callbacks = params.callbacks;
	
//	if (conf.bLight && !lightProps)
//		throw Error("no parent props for light");
	
	
	//profiler.start();
	var arrChangeOutputs = arrOutputs.filter(function(output) { return (output.amount === 0); });
	var arrExternalOutputs = arrOutputs.filter(function(output) { return (output.amount > 0); });
	const arrOutputAddresses = arrOutputs.map(o => o.address);
	if (arrChangeOutputs.length > 1)
		throw Error("more than one change output");
	if (arrChangeOutputs.length === 0)
		throw Error("no change outputs");
	
	if (arrPayingAddresses.length === 0)
		throw Error("no payers?");
	var arrFromAddresses = _.union(arrSigningAddresses, arrPayingAddresses).sort();
	
	var objPaymentMessage = {
		app: "payment",
		payload_location: "inline",
		payload_hash: hash_placeholder,
		payload: {
			inputs: [],
			// first output is the change, it has 0 amount (placeholder) that we'll modify later. 
			// Then we'll sort outputs, so the change is not necessarity the first in the final transaction
			outputs: arrChangeOutputs
			// we'll add more outputs below
		}
	};
	var total_amount = 0;
	arrExternalOutputs.forEach(function(output){
		objPaymentMessage.payload.outputs.push(output);
		total_amount += output.amount;
	});
	arrMessages.push(objPaymentMessage);
	
	var bMultiAuthored = (arrFromAddresses.length > 1);
	var objUnit = {
		version: constants.version, 
		alt: constants.alt,
		//timestamp: Date.now(),
		messages: arrMessages,
		authors: []
	};
	var objJoint = {unit: objUnit};
	if (params.earned_headers_commission_recipients) // it needn't be already sorted by address, we'll sort it now
		objUnit.earned_headers_commission_recipients = params.earned_headers_commission_recipients.concat().sort(function(a,b){
			return ((a.address < b.address) ? -1 : 1);
		});
	else if (bMultiAuthored) // by default, the entire earned hc goes to the change address
		objUnit.earned_headers_commission_recipients = [{address: arrChangeOutputs[0].address, earned_headers_commission_share: 100}];
	if (params.burn_fee)
		objUnit.burn_fee = params.burn_fee;
	if (bGenesis && params.witnesses /*&& constants.v4UpgradeMci === 0*/) {
		arrMessages.push({
			app: 'system_vote',
			payload: {
				subject: 'op_list',
				value: params.witnesses.sort()
			}
		}, {
			app: 'system_vote_count',
			payload: 'op_list'
		});
	}
	
	var total_input;
	var last_ball_mci;
	let vote_count_fee = 0;
	var unlock_callback;
	var conn;
	var lightProps;
	
	var handleError = function(err){
		//profiler.stop('compose');
		unlock_callback();
		if (typeof err === "object"){
			if (err.error_code === "NOT_ENOUGH_FUNDS")
				return callbacks.ifNotEnoughFunds(err.error);
			throw Error("unknown error code in: "+JSON.stringify(err));
		}
		callbacks.ifError(err);
	};
	
	async.series([
		function(cb){ // lock
			mutex.lock(arrFromAddresses.map(function(from_address){ return 'c-'+from_address; }), function(unlock){
				unlock_callback = unlock;
				cb();
			});
		},
		function(cb){ // lightProps
			if (!conf.bLight)
				return cb();
			var network = require('./network.js');
			network.requestFromLightVendor(
				'light/get_parents_and_last_ball_and_witness_list_unit', 
				{witnesses: arrWitnesses, from_addresses: arrFromAddresses, output_addresses: arrOutputAddresses, max_aa_responses}, 
				function(ws, request, response){
					if (response.error)
						return handleError(response.error); // cb is not called
					if (!response.parent_units || !response.last_stable_mc_ball || !response.last_stable_mc_ball_unit || typeof response.last_stable_mc_ball_mci !== 'number')
						return handleError("invalid parents from light vendor"); // cb is not called
					lightProps = response;
					cb();
				}
			);
		},
		function(cb){ // start transaction
			db.takeConnectionFromPool(function(new_conn){
				conn = new_conn;
				conn.query("BEGIN", function(){cb();});
			});
		},
		function(cb){ // parent units
			if (bGenesis) {
				last_ball_mci = 0;
				if (constants.timestampUpgradeMci === 0)
					objUnit.timestamp = (params.witnesses && constants.v4UpgradeMci === 0) ? Math.round(Date.now() / 1000) : 1561049490; // Jun 20 2019 16:51:30 UTC
				return cb();	
			}
			
			function checkForUnstablePredecessors(){
				var and_not_initial = (last_ball_mci >= constants.unstableInitialDefinitionUpgradeMci) ? "AND definition_chash!=address" : "";
				conn.query(
					// is_stable=0 condition is redundant given that last_ball_mci is stable
					"SELECT 1 FROM units CROSS JOIN unit_authors USING(unit) \n\
					WHERE  (main_chain_index>? OR main_chain_index IS NULL) AND address IN(?) AND definition_chash IS NOT NULL " + and_not_initial + " \n\
					UNION \n\
					SELECT 1 FROM units JOIN address_definition_changes USING(unit) \n\
					WHERE (main_chain_index>? OR main_chain_index IS NULL) AND address IN(?) \n\
					UNION \n\
					SELECT 1 FROM units CROSS JOIN unit_authors USING(unit) \n\
					WHERE (main_chain_index>? OR main_chain_index IS NULL) AND address IN(?) AND sequence!='good'", 
					[last_ball_mci, arrFromAddresses, last_ball_mci, arrFromAddresses, last_ball_mci, arrFromAddresses],
					function(rows){
						if (rows.length > 0)
							return cb("some definition changes or definitions or nonserials are not stable yet");
						cb();
					}
				);
			}
			
			if (conf.bLight){
				objUnit.parent_units = lightProps.parent_units;
				objUnit.last_ball = lightProps.last_stable_mc_ball;
				objUnit.last_ball_unit = lightProps.last_stable_mc_ball_unit;
				last_ball_mci = lightProps.last_stable_mc_ball_mci;
				objUnit.timestamp = lightProps.timestamp || Math.round(Date.now() / 1000);
				if (last_ball_mci >= constants.v4UpgradeMci)
					objUnit.tps_fee = lightProps.tps_fee;
				return checkForUnstablePredecessors();
			}
			objUnit.timestamp = Math.round(Date.now() / 1000);
			parentComposer.pickParentUnitsAndLastBall(
				conn, 
				arrWitnesses, 
				objUnit.timestamp,
				arrFromAddresses,
				async function(err, arrParentUnits, last_stable_mc_ball, last_stable_mc_ball_unit, last_stable_mc_ball_mci) {
					if (err)
						return cb("unable to find parents: "+err);
					console.log(`pickParentUnitsAndLastBall returned`, {last_stable_mc_ball_mci})
					objUnit.parent_units = arrParentUnits;
					objUnit.last_ball = last_stable_mc_ball;
					objUnit.last_ball_unit = last_stable_mc_ball_unit;
					last_ball_mci = last_stable_mc_ball_mci;
					if (last_ball_mci >= constants.v4UpgradeMci) {
						const rows = await conn.query("SELECT 1 FROM aa_addresses WHERE address IN (?)", [arrOutputAddresses]);
						const count_primary_aa_triggers = rows.length;
						const tps_fee = await parentComposer.getTpsFee(conn, arrParentUnits, last_stable_mc_ball_unit, objUnit.timestamp, 1 + count_primary_aa_triggers * max_aa_responses);
						const recipients = storage.getTpsFeeRecipients(objUnit.earned_headers_commission_recipients, arrFromAddresses);
						let paid_tps_fee = 0;
						for (let address in recipients) {
							const share = recipients[address] / 100;
							const [row] = await conn.query("SELECT tps_fees_balance FROM tps_fees_balances WHERE address=? AND mci<=? ORDER BY mci DESC LIMIT 1", [address, last_ball_mci]);
							const tps_fees_balance = row ? row.tps_fees_balance : 0;
							console.log('composer', {address, tps_fees_balance, tps_fee})
							const addr_tps_fee = Math.ceil(tps_fee - tps_fees_balance / share);
							if (addr_tps_fee > paid_tps_fee)
								paid_tps_fee = addr_tps_fee;
						}
						objUnit.tps_fee = paid_tps_fee;
					}
					checkForUnstablePredecessors();
				}
			);
		},
		function (cb) { // version
			var bVersion2 = (last_ball_mci >= constants.timestampUpgradeMci || constants.timestampUpgradeMci === 0);
			if (!bVersion2)
				objUnit.version = constants.versionWithoutTimestamp;
			else if (last_ball_mci < constants.includeKeySizesUpgradeMci)
				objUnit.version = constants.versionWithoutKeySizes;
			else if (last_ball_mci < constants.v4UpgradeMci)
				objUnit.version = constants.version3;
			if (last_ball_mci >= constants.v4UpgradeMci && typeof objUnit.tps_fee !== "number" && !bGenesis)
				throw Error(`wrong tps_fee field in the composed unit: ${objUnit.tps_fee}`);
			// calc or fix payload_hash of non-payment messages
			objUnit.messages.forEach(function (message) {
				if (message.app === 'payment')
					return;
				if (!message.payload_location && message.payload)
					message.payload_location = 'inline';
				if (message.payload_location === 'inline')
					message.payload_hash = objectHash.getBase64Hash(getPayloadForHash(message), bVersion2);
			});
			cb();
		},
		function(cb){ // authors
			composeAuthorsForAddresses(conn, arrFromAddresses, last_ball_mci, objUnit.last_ball_unit, signer, function(err, authors) {
				if (err)
					return cb(err);
				objUnit.authors = authors;
				cb();
			});
		},
		function(cb){ // witnesses
			if (last_ball_mci >= constants.v4UpgradeMci)
				return cb();
			if (bGenesis){
				objUnit.witnesses = arrWitnesses;
				return cb();
			}
			if (conf.bLight){
				if (lightProps.witness_list_unit)
					objUnit.witness_list_unit = lightProps.witness_list_unit;
				else
					objUnit.witnesses = arrWitnesses;
				return cb();
			}
			// witness addresses must not have references
			storage.determineIfWitnessAddressDefinitionsHaveReferences(conn, arrWitnesses, function(bWithReferences){
				if (bWithReferences)
					return cb("some witnesses have references in their addresses");
				storage.findWitnessListUnit(conn, arrWitnesses, last_ball_mci, function(witness_list_unit){
					if (witness_list_unit)
						objUnit.witness_list_unit = witness_list_unit;
					else
						objUnit.witnesses = arrWitnesses;
					cb();
				});
			});
		},
		// messages retrieved via callback
		function(cb){
			if (!fnRetrieveMessages)
				return cb();
			console.log("will retrieve messages");
			fnRetrieveMessages(conn, last_ball_mci, bMultiAuthored, arrPayingAddresses, function(err, arrMoreMessages, assocMorePrivatePayloads){
				console.log("fnRetrieveMessages callback: err code = "+(err ? err.error_code : ""));
				if (err)
					return cb((typeof err === "string") ? ("unable to add additional messages: "+err) : err);
				Array.prototype.push.apply(objUnit.messages, arrMoreMessages);
				if (assocMorePrivatePayloads && Object.keys(assocMorePrivatePayloads).length > 0)
					for (var payload_hash in assocMorePrivatePayloads)
						assocPrivatePayloads[payload_hash] = assocMorePrivatePayloads[payload_hash];
				cb();
			});
		},
		function(cb){ // input coins
			objUnit.headers_commission = objectLength.getHeadersSize(objUnit);
			var naked_payload_commission = objectLength.getTotalPayloadSize(objUnit); // without input coins
			vote_count_fee = objUnit.messages.find(m => m.app === 'system_vote_count') ? constants.SYSTEM_VOTE_COUNT_FEE : 0;

			if (bGenesis){
				var issueInput = {type: "issue", serial_number: 1, amount: constants.TOTAL_WHITEBYTES};
				if (objUnit.authors.length > 1) {
					issueInput.address = constants.v4UpgradeMci === 0 ? params.witnesses[0] : arrWitnesses[0];
				}
				objPaymentMessage.payload.inputs = [issueInput];
				objUnit.payload_commission = objectLength.getTotalPayloadSize(objUnit);
				total_input = constants.TOTAL_WHITEBYTES;
				return cb();
			}
			if (params.inputs){ // input coins already selected
				if (!params.input_amount)
					throw Error('inputs but no input_amount');
				total_input = params.input_amount;
				objPaymentMessage.payload.inputs = params.inputs;
				objUnit.payload_commission = objectLength.getTotalPayloadSize(objUnit);
				const oversize_fee = (last_ball_mci >= constants.v4UpgradeMci) ? storage.getOversizeFee(objUnit, last_ball_mci) : 0;
				if (oversize_fee)
					objUnit.oversize_fee = oversize_fee;
				return cb();
			}
			
			// all inputs must appear before last_ball
			const naked_size = objUnit.headers_commission + naked_payload_commission;
			const paid_temp_data_fee = objectLength.getPaidTempDataFee(objUnit);
			const oversize_fee = (last_ball_mci >= constants.v4UpgradeMci) ? storage.getOversizeFee(naked_size - paid_temp_data_fee, last_ball_mci) : 0;
			var target_amount = params.send_all ? Infinity : (total_amount + naked_size + oversize_fee + (objUnit.tps_fee||0) + (objUnit.burn_fee||0) + vote_count_fee);
			inputs.pickDivisibleCoinsForAmount(
				conn, null, arrPayingAddresses, last_ball_mci, target_amount, naked_size, paid_temp_data_fee, bMultiAuthored, params.spend_unconfirmed || conf.spend_unconfirmed || 'own',
				function(arrInputsWithProofs, _total_input){
					if (!arrInputsWithProofs)
						return cb({ 
							error_code: "NOT_ENOUGH_FUNDS", 
							error: "not enough spendable funds from "+arrPayingAddresses+" for "+target_amount
						});
					total_input = _total_input;
					objPaymentMessage.payload.inputs = arrInputsWithProofs.map(function(objInputWithProof){ return objInputWithProof.input; });
					objUnit.payload_commission = objectLength.getTotalPayloadSize(objUnit);
					console.log("inputs increased payload by", objUnit.payload_commission - naked_payload_commission);
					const oversize_fee = (last_ball_mci >= constants.v4UpgradeMci) ? storage.getOversizeFee(objUnit, last_ball_mci) : 0;
					if (oversize_fee)
						objUnit.oversize_fee = oversize_fee;
					cb();
				}
			);
		}
	], function(err){
		if (!err && last_ball_mci >= constants.v4UpgradeMci) {
			const size_fees = objUnit.headers_commission + objUnit.payload_commission;
			const additional_fees = (objUnit.oversize_fee || 0) + objUnit.tps_fee;
			const max_ratio = params.max_fee_ratio || conf.max_fee_ratio || 100;
			if (additional_fees > max_ratio * size_fees)
				err = `additional fees ${additional_fees} (oversize fee ${objUnit.oversize_fee || 0} + tps fee ${objUnit.tps_fee}) would be more than ${max_ratio} times the regular fees ${size_fees}`;
		}
		// we close the transaction and release the connection before signing as multisig signing may take very very long
		// however we still keep c-ADDRESS lock to avoid creating accidental doublespends
		conn.query(err ? "ROLLBACK" : "COMMIT", function(){
			conn.release();
			if (err)
				return handleError(err);
			
			// change, payload hash, signature, and unit hash
			var change = total_input - total_amount - objUnit.headers_commission - objUnit.payload_commission - (objUnit.oversize_fee||0) - (objUnit.tps_fee||0) - (objUnit.burn_fee||0) - vote_count_fee;
			if (change <= 0){
				if (!params.send_all)
					throw Error("change="+change+", params="+JSON.stringify(params));
				return handleError({ 
					error_code: "NOT_ENOUGH_FUNDS", 
					error: "not enough spendable funds from "+arrPayingAddresses+" for fees"
				});
			}
			objPaymentMessage.payload.outputs[0].amount = change;
			objPaymentMessage.payload.outputs.sort(sortOutputs);
			objPaymentMessage.payload_hash = objectHash.getBase64Hash(objPaymentMessage.payload, objUnit.version !== constants.versionWithoutTimestamp);
			var text_to_sign = objectHash.getUnitHashToSign(objUnit);
			async.each(
				objUnit.authors,
				function(author, cb2){
					var address = author.address;
					async.each( // different keys sign in parallel (if multisig)
						Object.keys(author.authentifiers),
						function(path, cb3){
							if (signer.sign){
								signer.sign(objUnit, assocPrivatePayloads, address, path, function(err, signature){
									if (err)
										return cb3(err);
									// it can't be accidentally confused with real signature as there are no [ and ] in base64 alphabet
									if (signature === '[refused]')
										return cb3('one of the cosigners refused to sign');
									author.authentifiers[path] = signature;
									cb3();
								});
							}
							else{
								signer.readPrivateKey(address, path, function(err, privKey){
									if (err)
										return cb3(err);
									author.authentifiers[path] = ecdsaSig.sign(text_to_sign, privKey);
									cb3();
								});
							}
						},
						function(err){
							cb2(err);
						}
					);
				},
				function(err){
					if (err)
						return handleError(err);
					objUnit.unit = objectHash.getUnitHash(objUnit);
					if (bGenesis)
						objJoint.ball = objectHash.getBallHash(objUnit.unit);
					console.log(require('util').inspect(objJoint, {depth:null}));
				//	objJoint.unit.timestamp = Math.round(Date.now()/1000); // light clients need timestamp
					if (Object.keys(assocPrivatePayloads).length === 0)
						assocPrivatePayloads = null;
					//profiler.stop('compose');
					callbacks.ifOk(objJoint, assocPrivatePayloads, unlock_callback);
				}
			);
		});
	});
}

async function estimateTpsFee(arrFromAddresses, arrOutputAddresses) {
//	if (storage.getMinRetrievableMci() < constants.v4UpgradeMci)
//		return 0;
	const max_aa_responses = constants.MAX_RESPONSES_PER_PRIMARY_TRIGGER;
	const arrWitnesses = storage.getOpList(Infinity);
	if (conf.bLight) {
		const network = require('./network.js');
		const response = await network.requestFromLightVendor('light/get_parents_and_last_ball_and_witness_list_unit', {
			witnesses: arrWitnesses,
			from_addresses: arrFromAddresses,
			output_addresses: arrOutputAddresses,
			max_aa_responses,
		});
		return (response.last_stable_mc_ball_mci >= constants.v4UpgradeMci) ? response.tps_fee : 0;
	}
	const timestamp = Math.round(Date.now() / 1000);
	const { arrParentUnits, last_stable_mc_ball_unit, last_stable_mc_ball_mci } =
		await parentComposer.pickParentUnitsAndLastBall(db, arrWitnesses, timestamp, arrFromAddresses);
	if (last_stable_mc_ball_mci < constants.v4UpgradeMci)
		return 0;
	const rows = await db.query("SELECT 1 FROM aa_addresses WHERE address IN (?)", [arrOutputAddresses]);
	const count_primary_aa_triggers = rows.length;
	const tps_fee = await parentComposer.getTpsFee(db, arrParentUnits, last_stable_mc_ball_unit, timestamp, 1 + count_primary_aa_triggers * max_aa_responses);
	// in this implementation, tps fees are paid by the 1st address only
	const [row] = await db.query("SELECT tps_fees_balance FROM tps_fees_balances WHERE address=? AND mci<=? ORDER BY mci DESC LIMIT 1", [arrFromAddresses[0], last_stable_mc_ball_mci]);
	const tps_fees_balance = row ? row.tps_fees_balance : 0;
	return Math.max(tps_fee - tps_fees_balance, 0);
}

function getPayloadForHash(objMessage) {
	if (objMessage.app !== "temp_data")
		return objMessage.payload;
	let p = _.clone(objMessage.payload);
	delete p.data;
	return p;
}


var TYPICAL_FEE = 1500;
var MAX_FEE = 20000;

function filterMostFundedAddresses(rows, estimated_amount){
	if (!estimated_amount)
		return rows.map(function(row){ return row.address; });
	var arrFundedAddresses = [];
	var accumulated_amount = 0;
	for (var i=0; i<rows.length; i++){
		arrFundedAddresses.push(rows[i].address);
		accumulated_amount += rows[i].total;
		if (accumulated_amount > estimated_amount + MAX_FEE)
			break;
	}
	return arrFundedAddresses;
}

function readSortedFundedAddresses(asset, arrAvailableAddresses, estimated_amount, spend_unconfirmed, handleFundedAddresses){
	if (arrAvailableAddresses.length === 0)
		return handleFundedAddresses([]);
	if (estimated_amount && typeof estimated_amount !== 'number')
		throw Error('invalid estimated amount: '+estimated_amount);
	// addresses closest to estimated amount come first
	var order_by = estimated_amount ? "(SUM(amount)>"+estimated_amount+") DESC, ABS(SUM(amount)-"+estimated_amount+") ASC" : "SUM(amount) DESC";
	db.query(
		"SELECT * FROM ( \n\
			SELECT address, SUM(amount) AS total \n\
			FROM outputs \n\
			CROSS JOIN units USING(unit) \n\
			WHERE address IN(?) "+inputs.getConfirmationConditionSql(spend_unconfirmed)+" AND sequence='good' \n\
				AND is_spent=0 AND asset"+(asset ? "=?" : " IS NULL")+" \n\
			GROUP BY address ORDER BY "+order_by+" \n\
		) AS t \n\
		WHERE NOT EXISTS ( \n\
			SELECT * FROM units CROSS JOIN unit_authors USING(unit) \n\
			WHERE is_stable=0 AND unit_authors.address=t.address AND definition_chash IS NOT NULL AND definition_chash != unit_authors.address \n\
		)",
		asset ? [arrAvailableAddresses, asset] : [arrAvailableAddresses],
		function(rows){
			var arrFundedAddresses = filterMostFundedAddresses(rows, estimated_amount);
			if (arrFundedAddresses.length > 0 || !asset)
				return handleFundedAddresses(arrFundedAddresses);
			storage.readAssetInfo(db, asset, objAsset => {
				if (!objAsset)
					throw Error("no such asset " + asset);
				if (objAsset.issued_by_definer_only && arrAvailableAddresses.indexOf(objAsset.definer_address) >= 0 || !objAsset.issued_by_definer_only)
					return handleFundedAddresses(objAsset.issued_by_definer_only ? [objAsset.definer_address] : arrAvailableAddresses);
				handleFundedAddresses([]);
			});
		/*	if (arrFundedAddresses.length === 0)
				return handleFundedAddresses([]);
			if (!asset || arrFundedAddresses.length === arrAvailableAddresses.length) // base asset or all available addresses already used
				return handleFundedAddresses(arrFundedAddresses);
			
			// add other addresses to pay for commissions (in case arrFundedAddresses don't have enough bytes to pay commissions)
			var arrOtherAddresses = _.difference(arrAvailableAddresses, arrFundedAddresses);
			readSortedFundedAddresses(null, arrOtherAddresses, TYPICAL_FEE, function(arrFundedOtherAddresses){
				if (arrFundedOtherAddresses.length === 0)
					return handleFundedAddresses(arrFundedAddresses);
				handleFundedAddresses(arrFundedAddresses.concat(arrFundedOtherAddresses));
			});*/
		}
	);
}

// tries to use as few of the params.available_paying_addresses as possible.
// note: it doesn't select addresses that have _only_ witnessing or headers commissions outputs
function composeMinimalJoint(params){
	var estimated_amount = (params.send_all || params.retrieveMessages) ? 0 : params.outputs.reduce(function(acc, output){ return acc+output.amount; }, 0) + TYPICAL_FEE;
	readSortedFundedAddresses(null, params.available_paying_addresses, estimated_amount, params.spend_unconfirmed || conf.spend_unconfirmed || 'own', function(arrFundedPayingAddresses){
		if (arrFundedPayingAddresses.length === 0)
			return params.callbacks.ifNotEnoughFunds("all paying addresses are unfunded");
		var minimal_params = _.clone(params);
		delete minimal_params.available_paying_addresses;
		minimal_params.minimal = true;
		minimal_params.paying_addresses = arrFundedPayingAddresses;
		composeJoint(minimal_params);
	});
}

function composeAndSaveMinimalJoint(params){
	var params_with_save = _.clone(params);
	params_with_save.callbacks = params.compose_only ? getNonsavingCallbacks(params.callbacks) : getSavingCallbacks(params.callbacks);
	composeMinimalJoint(params_with_save);
}

function getSavingCallbacks(callbacks){
	return {
		ifError: callbacks.ifError,
		ifNotEnoughFunds: callbacks.ifNotEnoughFunds,
		ifOk: async function(objJoint, assocPrivatePayloads, composer_unlock){
			var objUnit = objJoint.unit;
			var unit = objUnit.unit;
			const validate_and_save_unlock = await mutex.lock('handleJoint');
			const combined_unlock = () => {
				validate_and_save_unlock();
				composer_unlock();
			};
			validation.validate(objJoint, {
				ifUnitError: function(err){
					combined_unlock();
					callbacks.ifError("Validation error: "+err);
				//	throw Error("unexpected validation error: "+err);
				},
				ifJointError: function(err){
					throw Error("unexpected validation joint error: "+err);
				},
				ifTransientError: function(err){
					throw Error("unexpected validation transient error: "+err);
				},
				ifNeedHashTree: function(){
					throw Error("unexpected need hash tree");
				},
				ifNeedParentUnits: function(arrMissingUnits){
					throw Error("unexpected dependencies: "+arrMissingUnits.join(", "));
				},
				ifOk: function(objValidationState, validation_unlock){
					console.log("base asset OK "+objValidationState.sequence);
					if (objValidationState.sequence !== 'good'){
						validation_unlock();
						combined_unlock();
						return callbacks.ifError("Bad sequence "+objValidationState.sequence);
					}
					postJointToLightVendorIfNecessaryAndSave(
						objJoint, 
						function onLightError(err){ // light only
							console.log("failed to post base payment "+unit);
							var eventBus = require('./event_bus.js');
							if (err.match(/signature/))
								eventBus.emit('nonfatal_error', "failed to post unit "+unit+": "+err+"; "+JSON.stringify(objUnit), new Error());
							validation_unlock();
							combined_unlock();
							callbacks.ifError(err);
						},
						function save(){
							writer.saveJoint(
								objJoint, objValidationState, 
								function(conn, cb){
									if (typeof callbacks.preCommitCb === "function")
										callbacks.preCommitCb(conn, objJoint, cb);
									else
										cb();
								},
								function onDone(err){
									validation_unlock();
									combined_unlock();
									if (err)
										return callbacks.ifError(err);
									console.log("composer saved unit "+unit);
									callbacks.ifOk(objJoint, assocPrivatePayloads);
								}
							);
						}
					);
				} // ifOk validation
			}); // validate
		}
	};
}

function getNonsavingCallbacks(callbacks) {
	return {
		ifError: callbacks.ifError,
		ifNotEnoughFunds: callbacks.ifNotEnoughFunds,
		ifOk: function (objJoint, assocPrivatePayloads, composer_unlock) {
			composer_unlock();
			callbacks.ifOk(objJoint, assocPrivatePayloads);
		}
	};
}

function postJointToLightVendorIfNecessaryAndSave(objJoint, onLightError, save){
	if (conf.bLight){ // light clients cannot save before receiving OK from light vendor
		var network = require('./network.js');
		network.postJointToLightVendor(objJoint, function(response){
			if (response === 'accepted')
				save();
			else
				onLightError(response.error);
		});
	}
	else
		save();
}

function composeAndSavePaymentJoint(arrFromAddresses, arrOutputs, signer, callbacks){
	composePaymentJoint(arrFromAddresses, arrOutputs, signer, getSavingCallbacks(callbacks));
}


function getMessageIndexByPayloadHash(objUnit, payload_hash){
	for (var i=0; i<objUnit.messages.length; i++)
		if (objUnit.messages[i].payload_hash === payload_hash)
			return i;
	throw Error("message not found by payload hash "+payload_hash);
}

function generateBlinding(){
	return crypto.randomBytes(12).toString("base64");
}

function composeAuthorsAndMciForAddresses(conn, arrFromAddresses, signer, cb) {
	myWitnesses.readMyWitnesses(function(arrWitnesses){
	//	if (storage.getMinRetrievableMci() >= constants.v4UpgradeMci)
			arrWitnesses = storage.getOpList(Infinity);
		if (conf.bLight)
			require('./network.js').requestFromLightVendor(
				'light/get_parents_and_last_ball_and_witness_list_unit', 
				{witnesses: arrWitnesses, from_addresses: arrFromAddresses, output_addresses: arrFromAddresses}, 
				function(ws, request, response){
					if (response.error)
						return cb(response.error);
					if (!response.parent_units || !response.last_stable_mc_ball || !response.last_stable_mc_ball_unit || typeof response.last_stable_mc_ball_mci !== 'number')
						return cb("invalid parents from light vendor");
					composeAuthorsForAddresses(conn, arrFromAddresses, response.last_stable_mc_ball_mci, response.last_stable_mc_ball_unit, signer, cb);
				}
			);
		else
			parentComposer.pickParentUnitsAndLastBall(
				conn,
				arrWitnesses,
				Math.round(Date.now() / 1000),
				arrFromAddresses,
				function(err, arrParentUnits, last_stable_mc_ball, last_stable_mc_ball_unit, last_stable_mc_ball_mci){
					if (err)
						return cb("unable to find parents: "+err);
					composeAuthorsForAddresses(conn, arrFromAddresses, last_stable_mc_ball_mci, last_stable_mc_ball_unit, signer, cb);
				}
			);
	});
}

function composeAuthorsForAddresses(conn, arrFromAddresses, last_ball_mci, last_ball_unit, signer, cb) {
	var authors = [];
	async.eachSeries(arrFromAddresses, function(from_address, cb2){
		function setDefinition(){
			signer.readDefinition(conn, from_address, function(err, arrDefinition){
				if (err)
					return cb2(err);
				objAuthor.definition = arrDefinition;
				cb2();
			});
		}
		
		var objAuthor = {
			address: from_address,
			authentifiers: {}
		};
		signer.readSigningPaths(conn, from_address, function(assocLengthsBySigningPaths){
			var arrSigningPaths = Object.keys(assocLengthsBySigningPaths);
			for (var j=0; j<arrSigningPaths.length; j++)
				objAuthor.authentifiers[arrSigningPaths[j]] = repeatString("-", assocLengthsBySigningPaths[arrSigningPaths[j]]);
			authors.push(objAuthor);
			var and_stable = (last_ball_mci < constants.unstableInitialDefinitionUpgradeMci) ? "AND is_stable=1 AND main_chain_index<=" + parseInt(last_ball_mci) : "";
			conn.query(
				"SELECT 1 FROM unit_authors CROSS JOIN units USING(unit) \n\
				WHERE address=? AND sequence='good' " + and_stable + " \n\
				LIMIT 1", 
				[from_address], 
				function(rows){
					if (rows.length === 0) // first message from this address
						return setDefinition();
					// try to find last stable change of definition, then check if the definition was already disclosed
					conn.query(
						"SELECT definition \n\
						FROM address_definition_changes CROSS JOIN units USING(unit) LEFT JOIN definitions USING(definition_chash) \n\
						WHERE address=? AND is_stable=1 AND sequence='good' AND main_chain_index<=? \n\
						ORDER BY main_chain_index DESC LIMIT 1", 
						[from_address, last_ball_mci],
						function(rows){
							if (rows.length === 0) // no definition changes at all
								return cb2();
							var row = rows[0];
							row.definition ? cb2() : setDefinition(); // if definition not found in the db, add it into the json
						}
					);
				}
			);
		});
	}, function(err) {
		cb(err, authors, last_ball_unit);
	});
}


exports.composePaymentAndTextJoint = composePaymentAndTextJoint;
exports.composeTextJoint = composeTextJoint;
exports.composePaymentJoint = composePaymentJoint;
exports.composeDefinitionChangeJoint = composeDefinitionChangeJoint;
exports.composeDataFeedJoint = composeDataFeedJoint;
exports.composeDataJoint = composeDataJoint;
exports.composeDefinitionTemplateJoint = composeDefinitionTemplateJoint;
exports.composePollJoint = composePollJoint;
exports.composeVoteJoint = composeVoteJoint;
exports.composeProfileJoint = composeProfileJoint;
exports.composeAttestationJoint = composeAttestationJoint;
exports.composeAssetDefinitionJoint = composeAssetDefinitionJoint;
exports.composeAssetAttestorsJoint = composeAssetAttestorsJoint;

exports.composeJoint = composeJoint;

exports.estimateTpsFee = estimateTpsFee;

exports.filterMostFundedAddresses = filterMostFundedAddresses;
exports.readSortedFundedAddresses = readSortedFundedAddresses;
exports.composeAndSaveMinimalJoint = composeAndSaveMinimalJoint;

exports.sortOutputs = sortOutputs;
exports.getSavingCallbacks = getSavingCallbacks;
exports.getNonsavingCallbacks = getNonsavingCallbacks;
exports.postJointToLightVendorIfNecessaryAndSave = postJointToLightVendorIfNecessaryAndSave;
exports.composeAndSavePaymentJoint = composeAndSavePaymentJoint;

exports.generateBlinding = generateBlinding;
exports.getMessageIndexByPayloadHash = getMessageIndexByPayloadHash;
exports.composeAuthorsAndMciForAddresses = composeAuthorsAndMciForAddresses;
