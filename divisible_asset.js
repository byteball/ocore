/*jslint node: true */
const async = require('async');
const _ = require('lodash');
const constants = require('./constants.js');
const storage = require('./storage.js');
const objectHash = require("./object_hash.js");
const db = require('./db.js');
const composer = require("./composer.js");
const ValidationUtils = require('./validation_utils.js');
const validation = require('./validation.js');
const writer = require('./writer.js');


function validateAndSavePrivatePaymentChain(conn, arrPrivateElements, callbacks){
	// we always have only one element
	validateAndSaveDivisiblePrivatePayment(conn, arrPrivateElements[0], callbacks);
}


function validateAndSaveDivisiblePrivatePayment(conn, objPrivateElement, {ifError, ifOk}) {
	validateDivisiblePrivatePayment(conn, objPrivateElement, {
		ifError: ifError,
		ifOk(bStable, arrAuthorAddresses) {
			console.log(`private validation OK ${bStable}`);
			const unit = objPrivateElement.unit;
			const message_index = objPrivateElement.message_index;
			const payload = objPrivateElement.payload;
			const arrQueries = [];
			for (var j=0; j<payload.outputs.length; j++){
				const output = payload.outputs[j];
				conn.addQuery(arrQueries, 
					"INSERT INTO outputs (unit, message_index, output_index, address, amount, blinding, asset) VALUES (?,?,?,?,?,?,?)",
					[unit, message_index, j, output.address, parseInt(output.amount), output.blinding, payload.asset]
				);
			}
			for (var j=0; j<payload.inputs.length; j++){
                const input = payload.inputs[j];
                const type = input.type || "transfer";
                const src_unit = input.unit;
                const src_message_index = input.message_index;
                const src_output_index = input.output_index;
                let address = null;
                let address_sql = null;
                if (type === "issue")
					address = input.address || arrAuthorAddresses[0];
				else{ // transfer
					if (arrAuthorAddresses.length === 1)
						address = arrAuthorAddresses[0];
					else
						address_sql = `(SELECT address FROM outputs \
                            WHERE unit=${conn.escape(src_unit)} AND message_index=${src_message_index} \
                                AND output_index=${src_output_index} AND address IN(${conn.escape(arrAuthorAddresses)}))`;
				}
                const is_unique = bStable ? 1 : null; // unstable still have chances to become nonserial therefore nonunique
                conn.addQuery(arrQueries, `INSERT INTO inputs \n\
                        (unit, message_index, input_index, type, \n\
                        src_unit, src_message_index, src_output_index, \
                        serial_number, amount, \n\
                        asset, is_unique, address) VALUES(?,?,?,?,?,?,?,?,?,?,?,${address_sql || conn.escape(address)})`,
					[unit, message_index, j, type, 
					 src_unit, src_message_index, src_output_index, 
					 input.serial_number, input.amount, 
					 payload.asset, is_unique]);
                if (type === "transfer"){
					conn.addQuery(arrQueries, 
						"UPDATE outputs SET is_spent=1 WHERE unit=? AND message_index=? AND output_index=?",
						[src_unit, src_message_index, src_output_index]);
				}
            }
			async.series(arrQueries, ifOk);
		}
	});
}


function validateDivisiblePrivatePayment(conn, objPrivateElement, callbacks){
	
	const unit = objPrivateElement.unit;
	const message_index = objPrivateElement.message_index;
	const payload = objPrivateElement.payload;

	if (!ValidationUtils.isStringOfLength(payload.asset, constants.HASH_LENGTH))
		return callbacks.ifError("invalid asset in private divisible payment");
	if (!ValidationUtils.isNonemptyArray(payload.inputs))
		return callbacks.ifError("no inputs");
	
	validation.initPrivatePaymentValidationState(
		conn, unit, message_index, payload, callbacks.ifError, 
		(bStable, objPartialUnit, objValidationState) => {
		
			const arrAuthorAddresses = objPartialUnit.authors.map(({address}) => address );

			function validateSpendProofs(sp_cb){

				const arrSpendProofs = [];
				async.eachSeries(
					payload.inputs,
					(input, cb) => {
						if (input.type === "issue"){
							const address = input.address || arrAuthorAddresses[0];
							const spend_proof = objectHash.getBase64Hash({
								asset: payload.asset,
								amount: input.amount,
								address,
								serial_number: input.serial_number
							});
							arrSpendProofs.push({address, spend_proof});
							cb();
						}
						else if (!input.type){
							conn.query(
								"SELECT address, amount, blinding FROM outputs WHERE unit=? AND message_index=? AND output_index=? AND asset=?",
								[input.unit, input.message_index, input.output_index, payload.asset],
								rows => {
									if (rows.length !== 1)
										return cb("not 1 row when selecting src output");
									const src_output = rows[0];
									const spend_proof = objectHash.getBase64Hash({
										asset: payload.asset,
										unit: input.unit,
										message_index: input.message_index,
										output_index: input.output_index,
										address: src_output.address,
										amount: src_output.amount,
										blinding: src_output.blinding
									});
									arrSpendProofs.push({address: src_output.address, spend_proof});
									cb();
								}
							);
						}
						else
							cb(`unknown input type: ${input.type}`);
					},
					err => {
						if (err)
							return sp_cb(err);
						//arrSpendProofs.sort(function(a,b){ return a.spend_proof.localeCompare(b.spend_proof); });
						conn.query(
							"SELECT address, spend_proof FROM spend_proofs WHERE unit=? AND message_index=? ORDER BY spend_proof", 
							[unit, message_index],
							rows => {
								if (rows.length !== arrSpendProofs.length)
									return sp_cb("incorrect number of spend proofs");
								for (let i=0; i<rows.length; i++){
									if (rows[i].address !== arrSpendProofs[i].address || rows[i].spend_proof !== arrSpendProofs[i].spend_proof)
										return sp_cb("incorrect spend proof");
								}
								sp_cb();
							}
						);
					}
				);
			}

			const arrFuncs = [];
			arrFuncs.push(validateSpendProofs);
			arrFuncs.push(cb => {
				validation.validatePayment(conn, payload, message_index, objPartialUnit, objValidationState, cb);
			});
			async.series(arrFuncs, err => {
				console.log(`162: ${err}`);
				err ? callbacks.ifError(err) : callbacks.ifOk(bStable, arrAuthorAddresses);
			});
		}
	);
}

// {asset: asset, paying_addresses: arrPayingAddresses, fee_paying_addresses: arrFeePayingAddresses, change_address: change_address, to_address: to_address, amount: amount, signer: signer, callbacks: callbacks}
function composeDivisibleAssetPaymentJoint(params){
	console.log(`asset payment from ${params.paying_addresses}`);
	if ((params.to_address || params.amount) && params.asset_outputs)
		throw Error("to_address and asset_outputs at the same time");
	if (!ValidationUtils.isNonemptyArray(params.fee_paying_addresses))
		throw Error('no fee_paying_addresses');
	let private_payload;
	let arrBaseOutputs = [{address: params.fee_paying_addresses[0], amount: 0}]; // public outputs: the change only
	if (params.base_outputs)
		arrBaseOutputs = arrBaseOutputs.concat(params.base_outputs);
	composer.composeJoint({
		paying_addresses: _.union(params.paying_addresses, params.fee_paying_addresses), // addresses that pay for the transfer and commissions
		signing_addresses: params.signing_addresses,
		minimal: params.minimal,
		outputs: arrBaseOutputs,
		messages:params.messages,
		// function that creates additional messages to be added to the joint
		retrieveMessages(conn, last_ball_mci, bMultiAuthored, arrPayingAddresses, onDone) {
			const arrAssetPayingAddresses = _.intersection(arrPayingAddresses, params.paying_addresses);
			storage.loadAssetWithListOfAttestedAuthors(conn, params.asset, last_ball_mci, arrAssetPayingAddresses, (err, objAsset) => {
				if (err)
					return onDone(err);
				if (objAsset.fixed_denominations)
					return onDone("fixed denominations asset type");
				// fix: also check change address when not transferrable
				if (!objAsset.is_transferrable && params.to_address !== objAsset.definer_address && arrAssetPayingAddresses.indexOf(objAsset.definer_address) === -1)
					return onDone("the asset is not transferrable and definer not found on either side of the deal");
				if (objAsset.cosigned_by_definer && arrPayingAddresses.concat(params.signing_addresses || []).indexOf(objAsset.definer_address) === -1)
					return onDone("the asset must be cosigned by definer");
				if (objAsset.spender_attested && objAsset.arrAttestedAddresses.length === 0)
					return onDone("none of the authors is attested");
				
				const target_amount = params.to_address 
					? params.amount 
					: params.asset_outputs.reduce((accumulator, {amount}) => accumulator + amount, 0);
				composer.pickDivisibleCoinsForAmount(
					conn, objAsset, arrAssetPayingAddresses, last_ball_mci, target_amount, bMultiAuthored, 
					(arrInputsWithProofs, total_input) => {
						console.log(`pick coins callback ${arrInputsWithProofs}`);
						if (!arrInputsWithProofs)
							return onDone({error_code: "NOT_ENOUGH_FUNDS", error: "not enough asset coins"});
						const arrOutputs = params.to_address ? [{address: params.to_address, amount: params.amount}] : params.asset_outputs;
						const change = total_input - target_amount;
						if (change > 0){
							const objChangeOutput = {address: params.change_address, amount: change};
							arrOutputs.push(objChangeOutput);
						}
						if (objAsset.is_private)
							arrOutputs.forEach(output => { output.blinding = composer.generateBlinding(); });
						arrOutputs.sort(composer.sortOutputs);
						const payload = {
							asset: params.asset,
							inputs: arrInputsWithProofs.map(({input}) => input),
							outputs: arrOutputs
						};
						const objMessage = {
							app: "payment",
							payload_location: objAsset.is_private ? "none" : "inline",
							payload_hash: objectHash.getBase64Hash(payload)
						};
						let assocPrivatePayloads;
						if (objAsset.is_private){
							objMessage.spend_proofs = arrInputsWithProofs.map(({spend_proof}) => spend_proof);
							private_payload = payload;
							assocPrivatePayloads[objMessage.payload_hash] = private_payload;
						}
						else
							objMessage.payload = payload;
						onDone(null, [objMessage], assocPrivatePayloads);
					}
				);
			});
		},
		
		signer: params.signer, 
		
		callbacks: {
			ifError: params.callbacks.ifError,
			ifNotEnoughFunds: params.callbacks.ifNotEnoughFunds,
			ifOk(objJoint, assocPrivatePayloads, composer_unlock_callback) {
				// adding private_payload
				params.callbacks.ifOk(objJoint, private_payload, composer_unlock_callback);
			}
		}
	});
}

// ifOk validates and saves before calling back
function getSavingCallbacks(callbacks){
	return {
		ifError: callbacks.ifError,
		ifNotEnoughFunds: callbacks.ifNotEnoughFunds,
		ifOk(objJoint, private_payload, composer_unlock) {
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
					console.log(`divisible asset OK ${objValidationState.sequence}`);
					if (objValidationState.sequence !== 'good'){
						validation_unlock();
						composer_unlock();
						return callbacks.ifError(`Divisible asset bad sequence ${objValidationState.sequence}`);
					}
					const bPrivate = !!private_payload;
					let objPrivateElement;
					let preCommitCallback = null;
					
					if (bPrivate){
						preCommitCallback = (conn, cb) => {
							const payload_hash = objectHash.getBase64Hash(private_payload);
							const message_index = composer.getMessageIndexByPayloadHash(objUnit, payload_hash);
							objPrivateElement = {
								unit,
								message_index,
								payload: private_payload
							};
							validateAndSaveDivisiblePrivatePayment(conn, objPrivateElement, {
								ifError(err) {
									cb(err);
								},
								ifOk() {
									cb();
								}
							});
						};
					} else {
						if (typeof callbacks.preCommitCb === "function") {
							preCommitCallback = (conn, cb) => {
								callbacks.preCommitCb(conn, objJoint, cb);
							}
						}
					}
					
					composer.postJointToLightVendorIfNecessaryAndSave(
						objJoint, 
						function onLightError(err){ // light only
							console.log(`failed to post divisible payment ${unit}`);
							validation_unlock();
							composer_unlock();
							callbacks.ifError(err);
						},
						function save(){
							writer.saveJoint(
								objJoint, objValidationState, 
								preCommitCallback,
								function onDone(err){
									console.log(`saved unit ${unit}`, objPrivateElement);
									validation_unlock();
									composer_unlock();
									const arrChains = objPrivateElement ? [[objPrivateElement]] : null; // only one chain that consists of one element
									callbacks.ifOk(objJoint, arrChains, arrChains);
								}
							);
						}
					);
				} // ifOk validation
			}); // validate
		}
	};
}

// {asset: asset, paying_addresses: arrPayingAddresses, fee_paying_addresses: arrFeePayingAddresses, change_address: change_address, to_address: to_address, amount: amount, signer: signer, callbacks: callbacks}
function composeAndSaveDivisibleAssetPaymentJoint(params){
	const params_with_save = _.clone(params);
	params_with_save.callbacks = getSavingCallbacks(params.callbacks);
	composeDivisibleAssetPaymentJoint(params_with_save);
}

const TYPICAL_FEE = 1000;

// {asset: asset, available_paying_addresses: arrAvailablePayingAddresses, available_fee_paying_addresses: arrAvailableFeePayingAddresses, change_address: change_address, to_address: to_address, amount: amount, signer: signer, callbacks: callbacks}
function composeMinimalDivisibleAssetPaymentJoint(params){
		
	if (!ValidationUtils.isNonemptyArray(params.available_paying_addresses))
		throw Error('no available_paying_addresses');
	if (!ValidationUtils.isNonemptyArray(params.available_fee_paying_addresses))
		throw Error('no available_fee_paying_addresses');
	composer.readSortedFundedAddresses(params.asset, params.available_paying_addresses, params.amount, arrFundedPayingAddresses => {
		if (arrFundedPayingAddresses.length === 0)
			return params.callbacks.ifNotEnoughFunds("all paying addresses are unfunded in asset, make sure all your funds are confirmed");
		composer.readSortedFundedAddresses(null, params.available_fee_paying_addresses, TYPICAL_FEE, arrFundedFeePayingAddresses => {
			if (arrFundedPayingAddresses.length === 0)
				return params.callbacks.ifNotEnoughFunds("all paying addresses are unfunded in asset, make sure all your funds are confirmed");
			const minimal_params = _.clone(params);
			delete minimal_params.available_paying_addresses;
			delete minimal_params.available_fee_paying_addresses;
			minimal_params.minimal = true;
			minimal_params.paying_addresses = arrFundedPayingAddresses;
			minimal_params.fee_paying_addresses = arrFundedFeePayingAddresses;
			composeDivisibleAssetPaymentJoint(minimal_params);
		});
	});
}

// {asset: asset, available_paying_addresses: arrAvailablePayingAddresses, available_fee_paying_addresses: arrAvailableFeePayingAddresses, change_address: change_address, to_address: to_address, amount: amount, signer: signer, callbacks: callbacks}
function composeAndSaveMinimalDivisibleAssetPaymentJoint(params){
	const params_with_save = _.clone(params);
	params_with_save.callbacks = getSavingCallbacks(params.callbacks);
	composeMinimalDivisibleAssetPaymentJoint(params_with_save);
}


exports.validateAndSavePrivatePaymentChain = validateAndSavePrivatePaymentChain;
exports.composeAndSaveDivisibleAssetPaymentJoint = composeAndSaveDivisibleAssetPaymentJoint;
exports.composeAndSaveMinimalDivisibleAssetPaymentJoint = composeAndSaveMinimalDivisibleAssetPaymentJoint;
