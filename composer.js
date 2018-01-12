/*jslint node: true */
const crypto = require('crypto');
const async = require('async');
const db = require('./db.js');
const constants = require('./constants.js');
const objectHash = require('./object_hash.js');
const objectLength = require("./object_length.js");
const ecdsaSig = require('./signature.js');
const mutex = require('./mutex.js');
const _ = require('lodash');
const storage = require('./storage.js');
const myWitnesses = require('./my_witnesses.js');
const parentComposer = require('./parent_composer.js');
const paid_witnessing = require("./paid_witnessing.js");
const headers_commission = require("./headers_commission.js");
const mc_outputs = require("./mc_outputs.js");
const validation = require('./validation.js');
const writer = require('./writer.js');
const conf = require('./conf.js');
const profiler = require('./profiler.js');

const TRANSFER_INPUT_SIZE = 0 // type: "transfer" omitted
	+ 44 // unit
	+ 8 // message_index
	+ 8; // output_index

const HEADERS_COMMISSION_INPUT_SIZE = 18 // type: "headers_commission"
	+ 8 // from_main_chain_index
	+ 8; // to_main_chain_index

const WITNESSING_INPUT_SIZE = 10 // type: "witnessing"
	+ 8 // from_main_chain_index
	+ 8; // to_main_chain_index

const ADDRESS_SIZE = 32;

const hash_placeholder = "--------------------------------------------"; // 256 bits (32 bytes) base64: 44 bytes
const sig_placeholder = "----------------------------------------------------------------------------------------"; // 88 bytes


let bGenesis = false;
exports.setGenesis = _bGenesis => { bGenesis = _bGenesis; };


function repeatString(str, times){
	if (str.repeat)
		return str.repeat(times);
	return (new Array(times+1)).join(str);
}

function sortOutputs({address, amount}, {address, amount}) {
	const addr_comparison = address.localeCompare(address);
	return addr_comparison ? addr_comparison : (amount - amount);
}

// bMultiAuthored includes all addresses, not just those that pay
// arrAddresses is paying addresses
function pickDivisibleCoinsForAmount(conn, objAsset, arrAddresses, last_ball_mci, amount, bMultiAuthored, onDone){
	const asset = objAsset ? objAsset.asset : null;
	console.log(`pick coins ${asset} amount ${amount}`);
	const is_base = objAsset ? 0 : 1;
	const arrInputsWithProofs = [];
	let total_amount = 0;
	let required_amount = amount;
	
	// adds element to arrInputsWithProofs
	function addInput(input){
		total_amount += input.amount;
		const objInputWithProof = {input};
		if (objAsset && objAsset.is_private){ // for type=payment only
			const spend_proof = objectHash.getBase64Hash({
				asset,
				amount: input.amount,
				address: input.address,
				unit: input.unit,
				message_index: input.message_index,
				output_index: input.output_index,
				blinding: input.blinding
			});
			const objSpendProof = {spend_proof};
			if (bMultiAuthored)
				objSpendProof.address = input.address;
			objInputWithProof.spend_proof = objSpendProof;
		}
		if (!bMultiAuthored || !input.type)
			delete input.address;
		delete input.amount;
		delete input.blinding;
		arrInputsWithProofs.push(objInputWithProof);
	}
   
	// first, try to find a coin just bigger than the required amount
	function pickOneCoinJustBiggerAndContinue(){
		if (amount === Infinity)
			return pickMultipleCoinsAndContinue();
		const more = is_base ? '>' : '>=';
		conn.query(
			`SELECT unit, message_index, output_index, amount, blinding, address \n\
            FROM outputs \n\
            CROSS JOIN units USING(unit) \n\
            WHERE address IN(?) AND asset${asset ? `=${conn.escape(asset)}` : " IS NULL"} AND is_spent=0 AND amount ${more} ? \n\
                AND is_stable=1 AND sequence='good' AND main_chain_index<=?  \n\
            ORDER BY amount LIMIT 1`, 
			[arrSpendableAddresses, amount+is_base*TRANSFER_INPUT_SIZE, last_ball_mci],
			rows => {
				if (rows.length === 1){
					const input = rows[0];
					// default type is "transfer"
					addInput(input);
					onDone(arrInputsWithProofs, total_amount);
				}
				else
					pickMultipleCoinsAndContinue();
			}
		);
	}
	
	// then, try to add smaller coins until we accumulate the target amount
	function pickMultipleCoinsAndContinue(){
		conn.query(
			`SELECT unit, message_index, output_index, amount, address, blinding \n\
            FROM outputs \n\
            CROSS JOIN units USING(unit) \n\
            WHERE address IN(?) AND asset${asset ? `=${conn.escape(asset)}` : " IS NULL"} AND is_spent=0 \n\
                AND is_stable=1 AND sequence='good' AND main_chain_index<=?  \n\
            ORDER BY amount DESC LIMIT ?`,
			[arrSpendableAddresses, last_ball_mci, constants.MAX_INPUTS_PER_PAYMENT_MESSAGE-2],
			rows => {
				async.eachSeries(
					rows,
					(row, cb) => {
						const input = row;
						objectHash.cleanNulls(input);
						required_amount += is_base*TRANSFER_INPUT_SIZE;
						addInput(input);
						// if we allow equality, we might get 0 amount for change which is invalid
						const bFound = is_base ? (total_amount > required_amount) : (total_amount >= required_amount);
						bFound ? cb('found') : cb();
					},
					err => {
						if (err === 'found')
							onDone(arrInputsWithProofs, total_amount);
						else if (asset)
							issueAsset();
						else
							addHeadersCommissionInputs();
					}
				);
			}
		);
	}
	
	function addHeadersCommissionInputs(){
		addMcInputs("headers_commission", HEADERS_COMMISSION_INPUT_SIZE, 
			headers_commission.getMaxSpendableMciForLastBallMci(last_ball_mci), addWitnessingInputs);
	}
	
	function addWitnessingInputs(){
		addMcInputs("witnessing", WITNESSING_INPUT_SIZE, paid_witnessing.getMaxSpendableMciForLastBallMci(last_ball_mci), issueAsset);
	}
	
	function addMcInputs(type, input_size, max_mci, onStillNotEnough){
		async.eachSeries(
			arrAddresses, 
			(address, cb) => {
				const target_amount = required_amount + input_size + (bMultiAuthored ? ADDRESS_SIZE : 0) - total_amount;
				mc_outputs.findMcIndexIntervalToTargetAmount(conn, type, address, max_mci, target_amount, {
					ifNothing: cb,
					ifFound(from_mc_index, to_mc_index, earnings, bSufficient) {
						if (earnings === 0)
							throw Error("earnings === 0");
						total_amount += earnings;
						const input = {
							type,
							from_main_chain_index: from_mc_index,
							to_main_chain_index: to_mc_index
						};
						let full_input_size = input_size;
						if (bMultiAuthored){
							full_input_size += ADDRESS_SIZE; // address length
							input.address = address;
						}
						required_amount += full_input_size;
						arrInputsWithProofs.push({input});
						(total_amount > required_amount)
							? cb("found") // break eachSeries
							: cb(); // try next address
					}
				});
			},
			err => {
				if (!err)
					console.log(`${arrAddresses} ${type}: got only ${total_amount} out of required ${required_amount}`);
				(err === "found") ? onDone(arrInputsWithProofs, total_amount) : onStillNotEnough();
			}
		);
	}
	
	function issueAsset(){
		if (!asset)
			return finish();
		else{
			if (amount === Infinity && !objAsset.cap) // don't try to create infinite issue
				return onDone(null);
		}
		console.log(`will try to issue asset ${asset}`);
		// for issue, we use full list of addresses rather than spendable addresses
		if (objAsset.issued_by_definer_only && arrAddresses.indexOf(objAsset.definer_address) === -1)
			return finish();
		const issuer_address = objAsset.issued_by_definer_only ? objAsset.definer_address : arrAddresses[0];
		const issue_amount = objAsset.cap || (required_amount - total_amount) || 1; // 1 currency unit in case required_amount = total_amount
		
		function addIssueInput(serial_number){
			total_amount += issue_amount;
			const input = {
				type: "issue",
				amount: issue_amount,
				serial_number
			};
			if (bMultiAuthored)
				input.address = issuer_address;
			const objInputWithProof = {input};
			if (objAsset && objAsset.is_private){
				const spend_proof = objectHash.getBase64Hash({
					asset,
					amount: issue_amount,
					denomination: 1,
					address: issuer_address,
					serial_number
				});
				const objSpendProof = {spend_proof};
				if (bMultiAuthored)
					objSpendProof.address = input.address;
				objInputWithProof.spend_proof = objSpendProof;
			}
			arrInputsWithProofs.push(objInputWithProof);
			const bFound = is_base ? (total_amount > required_amount) : (total_amount >= required_amount);
			bFound ? onDone(arrInputsWithProofs, total_amount) : finish();
		}
		
		if (objAsset.cap){
			conn.query("SELECT 1 FROM inputs WHERE type='issue' AND asset=?", [asset], ({length}) => {
				if (length > 0) // already issued
					return finish();
				addIssueInput(1);
			});
		}
		else{
			conn.query(
				"SELECT MAX(serial_number) AS max_serial_number FROM inputs WHERE type='issue' AND asset=? AND address=?", 
				[asset, issuer_address], 
				rows => {
					const max_serial_number = (rows.length === 0) ? 0 : rows[0].max_serial_number;
					addIssueInput(max_serial_number+1);
				}
			);
		}
	}
	
	function finish(){
		if (amount === Infinity && arrInputsWithProofs.length > 0)
			onDone(arrInputsWithProofs, total_amount);
		else
			onDone(null);
	}
	
	var arrSpendableAddresses = arrAddresses.concat(); // cloning
	if (objAsset && objAsset.auto_destroy){
		const i = arrAddresses.indexOf(objAsset.definer_address);
		if (i>=0)
			arrSpendableAddresses.splice(i, 1);
	}
	if (arrSpendableAddresses.length > 0)
		pickOneCoinJustBiggerAndContinue();
	else
		issueAsset();
}


function createTextMessage(text){
	return {
		app: "text",
		payload_location: "inline",
		payload_hash: objectHash.getBase64Hash(text),
		payload: text
	};
}

// change goes back to the first paying address
function composeTextJoint(arrSigningAddresses, arrPayingAddresses, text, signer, callbacks){
	composePaymentAndTextJoint(arrSigningAddresses, arrPayingAddresses, [{address: arrPayingAddresses[0], amount: 0}], text, signer, callbacks);
}

function composePaymentJoint(arrFromAddresses, arrOutputs, signer, callbacks){
	composeJoint({paying_addresses: arrFromAddresses, outputs: arrOutputs, signer, callbacks});
}

function composePaymentAndTextJoint(arrSigningAddresses, arrPayingAddresses, arrOutputs, text, signer, callbacks){
	composeJoint({
		signing_addresses: arrSigningAddresses, 
		paying_addresses: arrPayingAddresses, 
		outputs: arrOutputs, 
		messages: [createTextMessage(text)], 
		signer, 
		callbacks
	});
}

function composeContentJoint(from_address, app, payload, signer, callbacks){
	const objMessage = {
		app,
		payload_location: "inline",
		payload_hash: objectHash.getBase64Hash(payload),
		payload
	};
	composeJoint({
		paying_addresses: [from_address], 
		outputs: [{address: from_address, amount: 0}], 
		messages: [objMessage], 
		signer, 
		callbacks
	});
}

function composeDefinitionChangeJoint(from_address, definition_chash, signer, callbacks){
	composeContentJoint(from_address, "address_definition_change", {definition_chash}, signer, callbacks);
}

function composeDataFeedJoint(from_address, data, signer, callbacks){
	composeContentJoint(from_address, "data_feed", data, signer, callbacks);
}

function composeDataJoint(from_address, data, signer, callbacks){
	composeContentJoint(from_address, "data", data, signer, callbacks);
}

function composeDedinitionTemplateJoint(from_address, arrDefinitionTemplate, signer, callbacks){
	composeContentJoint(from_address, "definition_template", arrDefinitionTemplate, signer, callbacks);
}

function composePollJoint(from_address, question, arrChoices, signer, callbacks){
	const poll_data = {question, choices: arrChoices};
	composeContentJoint(from_address, "poll", poll_data, signer, callbacks);
}

function composeVoteJoint(from_address, poll_unit, choice, signer, callbacks){
	const vote_data = {unit: poll_unit, choice};
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
	composeContentJoint(from_address, "asset_attestors", {asset, attestors: arrNewAttestors}, signer, callbacks);
}

/*
	params.signing_addresses must sign the message but they do not necessarily pay 
	params.paying_addresses pay for byte outputs and commissions
*/
function composeJoint(params){
	
	const arrWitnesses = params.witnesses;
	if (!arrWitnesses){
		myWitnesses.readMyWitnesses(_arrWitnesses => {
			params.witnesses = _arrWitnesses;
			composeJoint(params);
		});
		return;
	}
	
	if (conf.bLight && !params.lightProps){
		const network = require('./network.js');
		network.requestFromLightVendor(
			'light/get_parents_and_last_ball_and_witness_list_unit', 
			{witnesses: arrWitnesses}, 
			(ws, request, response) => {
				if (response.error)
					return params.callbacks.ifError(response.error);
				if (!response.parent_units || !response.last_stable_mc_ball || !response.last_stable_mc_ball_unit || typeof response.last_stable_mc_ball_mci !== 'number')
					return params.callbacks.ifError("invalid parents from light vendor");
				params.lightProps = response;
				composeJoint(params);
			}
		);
		return;
	}
	
	// try to use as few paying_addresses as possible. Assuming paying_addresses are sorted such that the most well-funded addresses come first
	if (params.minimal && !params.send_all){
		var callbacks = params.callbacks;
		const arrCandidatePayingAddresses = params.paying_addresses;

		const trySubset = count => {
			if (count > constants.MAX_AUTHORS_PER_UNIT)
				return callbacks.ifNotEnoughFunds("Too many authors.  Consider splitting the payment into two units.");
			const try_params = _.clone(params);
			delete try_params.minimal;
			try_params.paying_addresses = arrCandidatePayingAddresses.slice(0, count);
			try_params.callbacks = {
				ifOk: callbacks.ifOk,
				ifError: callbacks.ifError,
				ifNotEnoughFunds(error_message) {
					if (count === arrCandidatePayingAddresses.length)
						return callbacks.ifNotEnoughFunds(error_message);
					trySubset(count+1); // add one more paying address
				}
			};
			composeJoint(try_params);
		};
		
		return trySubset(1);
	}
	
	const arrSigningAddresses = params.signing_addresses || [];
	const arrPayingAddresses = params.paying_addresses || [];
	const arrOutputs = params.outputs || [];
	const arrMessages = _.clone(params.messages || []);
	let assocPrivatePayloads = params.private_payloads || {}; // those that correspond to a subset of params.messages
	const fnRetrieveMessages = params.retrieveMessages;
	const lightProps = params.lightProps;
	const signer = params.signer;
	var callbacks = params.callbacks;
	
	if (conf.bLight && !lightProps)
		throw Error("no parent props for light");
	
	
	//profiler.start();
	const arrChangeOutputs = arrOutputs.filter(({amount}) => amount === 0);
	const arrExternalOutputs = arrOutputs.filter(({amount}) => amount > 0);
	if (arrChangeOutputs.length > 1)
		throw Error("more than one change output");
	if (arrChangeOutputs.length === 0)
		throw Error("no change outputs");
	
	if (arrPayingAddresses.length === 0)
		throw Error("no payers?");
	const arrFromAddresses = _.union(arrSigningAddresses, arrPayingAddresses).sort();
	
	const objPaymentMessage = {
		app: "payment",
		payload_location: "inline",
		payload_hash: hash_placeholder,
		payload: {
			// first output is the change, it has 0 amount (placeholder) that we'll modify later. 
			// Then we'll sort outputs, so the change is not necessarity the first in the final transaction
			outputs: arrChangeOutputs
			// we'll add more outputs below
		}
	};
	let total_amount = 0;
	arrExternalOutputs.forEach(output => {
		objPaymentMessage.payload.outputs.push(output);
		total_amount += output.amount;
	});
	arrMessages.push(objPaymentMessage);
	
	const bMultiAuthored = (arrFromAddresses.length > 1);
	const objUnit = {
		version: constants.version, 
		alt: constants.alt,
		//timestamp: Date.now(),
		messages: arrMessages,
		authors: []
	};
	const objJoint = {unit: objUnit};
	if (params.earned_headers_commission_recipients) // it needn't be already sorted by address, we'll sort it now
		objUnit.earned_headers_commission_recipients = params.earned_headers_commission_recipients.concat().sort(({address}, {address}) => (address < address) ? -1 : 1);
	else if (bMultiAuthored) // by default, the entire earned hc goes to the change address
		objUnit.earned_headers_commission_recipients = [{address: arrChangeOutputs[0].address, earned_headers_commission_share: 100}];
	
	let total_input;
	let last_ball_mci;
	const assocSigningPaths = {};
	let unlock_callback;
	let conn;
	
	const handleError = err => {
		//profiler.stop('compose');
		unlock_callback();
		if (typeof err === "object"){
			if (err.error_code === "NOT_ENOUGH_FUNDS")
				return callbacks.ifNotEnoughFunds(err.error);
			throw Error(`unknown error code in: ${JSON.stringify(err)}`);
		}
		callbacks.ifError(err);
	};
	
	async.series([
		cb => { // lock
			mutex.lock(arrFromAddresses.map(from_address => `c-${from_address}`), unlock => {
				unlock_callback = unlock;
				cb();
			});
		},
		cb => { // start transaction
			db.takeConnectionFromPool(new_conn => {
				conn = new_conn;
				conn.query("BEGIN", () => {cb();});
			});
		},
		cb => { // parent units
			if (bGenesis)
				return cb();
			
			function checkForUnstablePredecessors(){
				conn.query(
					// is_stable=0 condition is redundant given that last_ball_mci is stable
					"SELECT 1 FROM units CROSS JOIN unit_authors USING(unit) \n\
					WHERE  (main_chain_index>? OR main_chain_index IS NULL) AND address IN(?) AND definition_chash IS NOT NULL \n\
					UNION \n\
					SELECT 1 FROM units JOIN address_definition_changes USING(unit) \n\
					WHERE (main_chain_index>? OR main_chain_index IS NULL) AND address IN(?) \n\
					UNION \n\
					SELECT 1 FROM units CROSS JOIN unit_authors USING(unit) \n\
					WHERE (main_chain_index>? OR main_chain_index IS NULL) AND address IN(?) AND sequence!='good'", 
					[last_ball_mci, arrFromAddresses, last_ball_mci, arrFromAddresses, last_ball_mci, arrFromAddresses],
					({length}) => {
						if (length > 0)
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
				return checkForUnstablePredecessors();
			}
			parentComposer.pickParentUnitsAndLastBall(
				conn, 
				arrWitnesses, 
				(
                    err,
                    arrParentUnits,
                    last_stable_mc_ball,
                    last_stable_mc_ball_unit,
                    last_stable_mc_ball_mci
                ) => {
					if (err)
						return cb(`unable to find parents: ${err}`);
					objUnit.parent_units = arrParentUnits;
					objUnit.last_ball = last_stable_mc_ball;
					objUnit.last_ball_unit = last_stable_mc_ball_unit;
					last_ball_mci = last_stable_mc_ball_mci;
					checkForUnstablePredecessors();
				}
			);
		},
		cb => { // authors
			async.eachSeries(arrFromAddresses, (from_address, cb2) => {
				
				function setDefinition(){
					signer.readDefinition(conn, from_address, (err, arrDefinition) => {
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
				signer.readSigningPaths(conn, from_address, assocLengthsBySigningPaths => {
					const arrSigningPaths = Object.keys(assocLengthsBySigningPaths);
					assocSigningPaths[from_address] = arrSigningPaths;
					for (let j=0; j<arrSigningPaths.length; j++)
						objAuthor.authentifiers[arrSigningPaths[j]] = repeatString("-", assocLengthsBySigningPaths[arrSigningPaths[j]]);
					objUnit.authors.push(objAuthor);
					conn.query(
						"SELECT 1 FROM unit_authors CROSS JOIN units USING(unit) \n\
						WHERE address=? AND is_stable=1 AND sequence='good' AND main_chain_index<=? \n\
						LIMIT 1", 
						[from_address, last_ball_mci], 
						({length}) => {
							if (length === 0) // first message from this address
								return setDefinition();
							// try to find last stable change of definition, then check if the definition was already disclosed
							conn.query(
								"SELECT definition \n\
								FROM address_definition_changes CROSS JOIN units USING(unit) LEFT JOIN definitions USING(definition_chash) \n\
								WHERE address=? AND is_stable=1 AND sequence='good' AND main_chain_index<=? \n\
								ORDER BY level DESC LIMIT 1", 
								[from_address, last_ball_mci],
								rows => {
									if (rows.length === 0) // no definition changes at all
										return cb2();
									const row = rows[0];
									row.definition ? cb2() : setDefinition(); // if definition not found in the db, add it into the json
								}
							);
						}
					);
				});
			}, cb);
		},
		cb => { // witnesses
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
			storage.determineIfWitnessAddressDefinitionsHaveReferences(conn, arrWitnesses, bWithReferences => {
				if (bWithReferences)
					return cb("some witnesses have references in their addresses");
				storage.findWitnessListUnit(conn, arrWitnesses, last_ball_mci, witness_list_unit => {
					if (witness_list_unit)
						objUnit.witness_list_unit = witness_list_unit;
					else
						objUnit.witnesses = arrWitnesses;
					cb();
				});
			});
		},
		cb => {
			if (!fnRetrieveMessages)
				return cb();
			console.log("will retrieve messages");
			fnRetrieveMessages(conn, last_ball_mci, bMultiAuthored, arrPayingAddresses, (err, arrMoreMessages, assocMorePrivatePayloads) => {
				console.log(`fnRetrieveMessages callback: err code = ${err ? err.error_code : ""}`);
				if (err)
					return cb((typeof err === "string") ? (`unable to add additional messages: ${err}`) : err);
				Array.prototype.push.apply(objUnit.messages, arrMoreMessages);
				if (assocMorePrivatePayloads && Object.keys(assocMorePrivatePayloads).length > 0)
					for (const payload_hash in assocMorePrivatePayloads)
						assocPrivatePayloads[payload_hash] = assocMorePrivatePayloads[payload_hash];
				cb();
			});
		},
		cb => { // input coins
			objUnit.headers_commission = objectLength.getHeadersSize(objUnit);
			const naked_payload_commission = objectLength.getTotalPayloadSize(objUnit); // without input coins

			if (bGenesis){
				const issueInput = {type: "issue", serial_number: 1, amount: constants.TOTAL_WHITEBYTES};
				if (objUnit.authors.length > 1) {
					issueInput.address = arrWitnesses[0];
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
				return cb();
			}
			
			// all inputs must appear before last_ball
			const target_amount = params.send_all ? Infinity : (total_amount + objUnit.headers_commission + naked_payload_commission);
			pickDivisibleCoinsForAmount(
				conn, null, arrPayingAddresses, last_ball_mci, target_amount, bMultiAuthored, 
				(arrInputsWithProofs, _total_input) => {
					if (!arrInputsWithProofs)
						return cb({ 
							error_code: "NOT_ENOUGH_FUNDS", 
							error: `not enough spendable funds from ${arrPayingAddresses} for ${target_amount}`
						});
					total_input = _total_input;
					objPaymentMessage.payload.inputs = arrInputsWithProofs.map(({input}) => input);
					objUnit.payload_commission = objectLength.getTotalPayloadSize(objUnit);
					console.log("inputs increased payload by", objUnit.payload_commission - naked_payload_commission);
					cb();
				}
			);
		}
	], err => {
		// we close the transaction and release the connection before signing as multisig signing may take very very long
		// however we still keep c-ADDRESS lock to avoid creating accidental doublespends
		conn.query(err ? "ROLLBACK" : "COMMIT", () => {
			conn.release();
			if (err)
				return handleError(err);
			
			// change, payload hash, signature, and unit hash
			const change = total_input - total_amount - objUnit.headers_commission - objUnit.payload_commission;
			if (change <= 0){
				if (!params.send_all)
					throw Error(`change=${change}, params=${JSON.stringify(params)}`);
				return handleError({ 
					error_code: "NOT_ENOUGH_FUNDS", 
					error: `not enough spendable funds from ${arrPayingAddresses} for fees`
				});
			}
			objPaymentMessage.payload.outputs[0].amount = change;
			objPaymentMessage.payload.outputs.sort(sortOutputs);
			objPaymentMessage.payload_hash = objectHash.getBase64Hash(objPaymentMessage.payload);
			const text_to_sign = objectHash.getUnitHashToSign(objUnit);
			async.each(
				objUnit.authors,
				(author, cb2) => {
					const address = author.address;
					async.each( // different keys sign in parallel (if multisig)
						assocSigningPaths[address],
						(path, cb3) => {
							if (signer.sign){
								signer.sign(objUnit, assocPrivatePayloads, address, path, (err, signature) => {
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
								signer.readPrivateKey(address, path, (err, privKey) => {
									if (err)
										return cb3(err);
									author.authentifiers[path] = ecdsaSig.sign(text_to_sign, privKey);
									cb3();
								});
							}
						},
						err => {
							cb2(err);
						}
					);
				},
				err => {
					if (err)
						return handleError(err);
					objUnit.unit = objectHash.getUnitHash(objUnit);
					if (bGenesis)
						objJoint.ball = objectHash.getBallHash(objUnit.unit);
					console.log(require('util').inspect(objJoint, {depth:null}));
					objJoint.unit.timestamp = Math.round(Date.now()/1000); // light clients need timestamp
					if (Object.keys(assocPrivatePayloads).length === 0)
						assocPrivatePayloads = null;
					//profiler.stop('compose');
					callbacks.ifOk(objJoint, assocPrivatePayloads, unlock_callback);
				}
			);
		});
	});
}

const TYPICAL_FEE = 1000;
const MAX_FEE = 20000;

function filterMostFundedAddresses(rows, estimated_amount){
	if (!estimated_amount)
		return rows.map(({address}) => address);
	const arrFundedAddresses = [];
	let accumulated_amount = 0;
	for (let i=0; i<rows.length; i++){
		arrFundedAddresses.push(rows[i].address);
		accumulated_amount += rows[i].total;
		if (accumulated_amount > estimated_amount + MAX_FEE)
			break;
	}
	return arrFundedAddresses;
}

function readSortedFundedAddresses(asset, arrAvailableAddresses, estimated_amount, handleFundedAddresses){
	if (arrAvailableAddresses.length === 0)
		return handleFundedAddresses([]);
	if (estimated_amount && typeof estimated_amount !== 'number')
		throw Error(`invalid estimated amount: ${estimated_amount}`);
	// addresses closest to estimated amount come first
	const order_by = estimated_amount ? `(SUM(amount)>${estimated_amount}) DESC, ABS(SUM(amount)-${estimated_amount}) ASC` : "SUM(amount) DESC";
	db.query(
		`SELECT address, SUM(amount) AS total \n\
        FROM outputs \n\
        CROSS JOIN units USING(unit) \n\
        WHERE address IN(?) AND is_stable=1 AND sequence='good' AND is_spent=0 AND asset${asset ? "=?" : " IS NULL"} \n\
            AND NOT EXISTS ( \n\
                SELECT * FROM unit_authors JOIN units USING(unit) \n\
                WHERE is_stable=0 AND unit_authors.address=outputs.address AND definition_chash IS NOT NULL \n\
            ) \n\
        GROUP BY address ORDER BY ${order_by}`,
		asset ? [arrAvailableAddresses, asset] : [arrAvailableAddresses],
		rows => {
			const arrFundedAddresses = filterMostFundedAddresses(rows, estimated_amount);
			handleFundedAddresses(arrFundedAddresses);
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
	const estimated_amount = (params.send_all || params.retrieveMessages) ? 0 : params.outputs.reduce((acc, {amount}) => acc+amount, 0) + TYPICAL_FEE;
	readSortedFundedAddresses(null, params.available_paying_addresses, estimated_amount, arrFundedPayingAddresses => {
		if (arrFundedPayingAddresses.length === 0)
			return params.callbacks.ifNotEnoughFunds("all paying addresses are unfunded");
		const minimal_params = _.clone(params);
		delete minimal_params.available_paying_addresses;
		minimal_params.minimal = true;
		minimal_params.paying_addresses = arrFundedPayingAddresses;
		composeJoint(minimal_params);
	});
}

function composeAndSaveMinimalJoint(params){
	const params_with_save = _.clone(params);
	params_with_save.callbacks = getSavingCallbacks(params.callbacks);
	composeMinimalJoint(params_with_save);
}

function getSavingCallbacks(callbacks){
	return {
		ifError: callbacks.ifError,
		ifNotEnoughFunds: callbacks.ifNotEnoughFunds,
		ifOk(objJoint, assocPrivatePayloads, composer_unlock) {
			const objUnit = objJoint.unit;
			const unit = objUnit.unit;
			validation.validate(objJoint, {
				ifUnitError(err) {
					composer_unlock();
					callbacks.ifError(`Validation error: ${err}`);
				//	throw Error("unexpected validation error: "+err);
				},
				ifJointError(err) {
					throw Error(`unexpected validation joint error: ${err}`);
				},
				ifTransientError(err) {
					throw Error(`unexpected validation transient error: ${err}`);
				},
				ifNeedHashTree() {
					throw Error("unexpected need hash tree");
				},
				ifNeedParentUnits(arrMissingUnits) {
					throw Error(`unexpected dependencies: ${arrMissingUnits.join(", ")}`);
				},
				ifOk(objValidationState, validation_unlock) {
					console.log(`base asset OK ${objValidationState.sequence}`);
					if (objValidationState.sequence !== 'good'){
						validation_unlock();
						composer_unlock();
						return callbacks.ifError(`Bad sequence ${objValidationState.sequence}`);
					}
					postJointToLightVendorIfNecessaryAndSave(
						objJoint, 
						function onLightError(err){ // light only
							console.log(`failed to post base payment ${unit}`);
							const eventBus = require('./event_bus.js');
							if (err.match(/signature/))
								eventBus.emit('nonfatal_error', `failed to post unit ${unit}: ${err}; ${JSON.stringify(objUnit)}`, new Error());
							validation_unlock();
							composer_unlock();
							callbacks.ifError(err);
						},
						function save(){
							writer.saveJoint(
								objJoint, objValidationState, 
								(conn, cb) => {
									if (typeof callbacks.preCommitCb === "function")
										callbacks.preCommitCb(conn, objJoint, cb);
									else
										cb();
								},
								function onDone(err){
									validation_unlock();
									composer_unlock();
									if (err)
										return callbacks.ifError(err);
									console.log(`saved unit ${unit}`);
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

function postJointToLightVendorIfNecessaryAndSave(objJoint, onLightError, save){
	if (conf.bLight){ // light clients cannot save before receiving OK from light vendor
		const network = require('./network.js');
		network.postJointToLightVendor(objJoint, response => {
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


function getMessageIndexByPayloadHash({messages}, payload_hash) {
	for (let i=0; i<messages.length; i++)
		if (messages[i].payload_hash === payload_hash)
			return i;
	throw Error(`message not found by payload hash ${payload_hash}`);
}

function generateBlinding(){
	return crypto.randomBytes(12).toString("base64");
}


exports.composePaymentAndTextJoint = composePaymentAndTextJoint;
exports.composeTextJoint = composeTextJoint;
exports.composePaymentJoint = composePaymentJoint;
exports.composeDefinitionChangeJoint = composeDefinitionChangeJoint;
exports.composeDataFeedJoint = composeDataFeedJoint;
exports.composeDataJoint = composeDataJoint;
exports.composeDedinitionTemplateJoint = composeDedinitionTemplateJoint;
exports.composePollJoint = composePollJoint;
exports.composeVoteJoint = composeVoteJoint;
exports.composeProfileJoint = composeProfileJoint;
exports.composeAttestationJoint = composeAttestationJoint;
exports.composeAssetDefinitionJoint = composeAssetDefinitionJoint;
exports.composeAssetAttestorsJoint = composeAssetAttestorsJoint;

exports.composeJoint = composeJoint;

exports.filterMostFundedAddresses = filterMostFundedAddresses;
exports.readSortedFundedAddresses = readSortedFundedAddresses;
exports.composeAndSaveMinimalJoint = composeAndSaveMinimalJoint;

exports.sortOutputs = sortOutputs;
exports.getSavingCallbacks = getSavingCallbacks;
exports.postJointToLightVendorIfNecessaryAndSave = postJointToLightVendorIfNecessaryAndSave;
exports.composeAndSavePaymentJoint = composeAndSavePaymentJoint;

exports.generateBlinding = generateBlinding;
exports.getMessageIndexByPayloadHash = getMessageIndexByPayloadHash;
exports.pickDivisibleCoinsForAmount = pickDivisibleCoinsForAmount;
