/*jslint node: true */
"use strict";
var async = require('async');
var _ = require('lodash');
var constants = require('./constants.js');
var storage = require('./storage.js');
var objectHash = require("./object_hash.js");
var db = require('./db.js');
var composer = require("./composer.js");
var ValidationUtils = require('./validation_utils.js');
var validation = require('./validation.js');
var writer = require('./writer.js');
var inputs = require('./inputs.js');
var conf = require('./conf.js');
var mutex = require('./mutex.js');

function validateAndSavePrivatePaymentChain(conn, arrPrivateElements, callbacks){
	// we always have only one element
	validateAndSaveDivisiblePrivatePayment(conn, arrPrivateElements[0], callbacks);
}


function validateAndSaveDivisiblePrivatePayment(conn, objPrivateElement, callbacks){
	validateDivisiblePrivatePayment(conn, objPrivateElement, {
		ifError: callbacks.ifError,
		ifOk: function(bStable, arrAuthorAddresses){
			console.log("private validation OK "+bStable);
			var unit = objPrivateElement.unit;
			var message_index = objPrivateElement.message_index;
			var payload = objPrivateElement.payload;
			var arrQueries = [];
			for (var j=0; j<payload.outputs.length; j++){
				var output = payload.outputs[j];
				conn.addQuery(arrQueries, 
					"INSERT INTO outputs (unit, message_index, output_index, address, amount, blinding, asset) VALUES (?,?,?,?,?,?,?)",
					[unit, message_index, j, output.address, parseInt(output.amount), output.blinding, payload.asset]
				);
			}
			for (var j=0; j<payload.inputs.length; j++){
				var input = payload.inputs[j];
				var type = input.type || "transfer";
				var src_unit = input.unit;
				var src_message_index = input.message_index;
				var src_output_index = input.output_index;
				var address = null, address_sql = null;
				if (type === "issue")
					address = input.address || arrAuthorAddresses[0];
				else{ // transfer
					if (arrAuthorAddresses.length === 1)
						address = arrAuthorAddresses[0];
					else
						address_sql = "(SELECT address FROM outputs \
							WHERE unit="+conn.escape(src_unit)+" AND message_index="+src_message_index+" \
								AND output_index="+src_output_index+" AND address IN("+conn.escape(arrAuthorAddresses)+"))";
				}
				var is_unique = bStable ? 1 : null; // unstable still have chances to become nonserial therefore nonunique
				conn.addQuery(arrQueries, "INSERT INTO inputs \n\
						(unit, message_index, input_index, type, \n\
						src_unit, src_message_index, src_output_index, \
						serial_number, amount, \n\
						asset, is_unique, address) VALUES(?,?,?,?,?,?,?,?,?,?,?,"+(address_sql || conn.escape(address))+")",
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
			async.series(arrQueries, callbacks.ifOk);
		}
	});
}


function validateDivisiblePrivatePayment(conn, objPrivateElement, callbacks){
	
	var unit = objPrivateElement.unit;
	var message_index = objPrivateElement.message_index;
	var payload = objPrivateElement.payload;

	if (!ValidationUtils.isStringOfLength(payload.asset, constants.HASH_LENGTH))
		return callbacks.ifError("invalid asset in private divisible payment");
	if (!ValidationUtils.isNonemptyArray(payload.inputs))
		return callbacks.ifError("no inputs");
	
	validation.initPrivatePaymentValidationState(
		conn, unit, message_index, payload, callbacks.ifError, 
		function(bStable, objPartialUnit, objValidationState){
		
			var arrAuthorAddresses = objPartialUnit.authors.map(function(author) { return author.address; } );

			function validateSpendProofs(sp_cb){

				var arrSpendProofs = [];
				async.eachSeries(
					payload.inputs,
					function(input, cb){
						if (input.type === "issue"){
							var address = input.address || arrAuthorAddresses[0];
							var spend_proof = objectHash.getBase64Hash({
								asset: payload.asset,
								amount: input.amount,
								address: address,
								serial_number: input.serial_number
							});
							arrSpendProofs.push({address: address, spend_proof: spend_proof});
							cb();
						}
						else if (!input.type){
							conn.query(
								"SELECT address, amount, blinding FROM outputs WHERE unit=? AND message_index=? AND output_index=? AND asset=?",
								[input.unit, input.message_index, input.output_index, payload.asset],
								function(rows){
									if (rows.length !== 1)
										return cb("not 1 row when selecting src output");
									var src_output = rows[0];
									var spend_proof = objectHash.getBase64Hash({
										asset: payload.asset,
										unit: input.unit,
										message_index: input.message_index,
										output_index: input.output_index,
										address: src_output.address,
										amount: src_output.amount,
										blinding: src_output.blinding
									});
									arrSpendProofs.push({address: src_output.address, spend_proof: spend_proof});
									cb();
								}
							);
						}
						else
							cb("unknown input type: "+input.type);
					},
					function(err){
						if (err)
							return sp_cb(err);
						//arrSpendProofs.sort(function(a,b){ return a.spend_proof.localeCompare(b.spend_proof); });
						conn.query(
							"SELECT address, spend_proof FROM spend_proofs WHERE unit=? AND message_index=? ORDER BY spend_proof", 
							[unit, message_index],
							function(rows){
								if (rows.length !== arrSpendProofs.length)
									return sp_cb("incorrect number of spend proofs");
								for (var i=0; i<rows.length; i++){
									if (rows[i].address !== arrSpendProofs[i].address || rows[i].spend_proof !== arrSpendProofs[i].spend_proof)
										return sp_cb("incorrect spend proof");
								}
								sp_cb();
							}
						);
					}
				);
			}

			var arrFuncs = [];
			arrFuncs.push(validateSpendProofs);
			arrFuncs.push(function(cb){
				validation.validatePayment(conn, payload, message_index, objPartialUnit, objValidationState, cb);
			});
			async.series(arrFuncs, function(err){
				console.log("162: "+err);
				err ? callbacks.ifError(err) : callbacks.ifOk(bStable, arrAuthorAddresses);
			});
		}
	);
}

// {asset: asset, paying_addresses: arrPayingAddresses, fee_paying_addresses: arrFeePayingAddresses, change_address: change_address, to_address: to_address, amount: amount, signer: signer, callbacks: callbacks}
function composeDivisibleAssetPaymentJoint(params){
	console.log("asset payment from "+params.paying_addresses);
	var bTo = params.to_address ? 1 : 0;
	var bAssetOutputs = params.asset_outputs ? 1 : 0;
	var bOutputsByAsset = params.outputs_by_asset ? 1 : 0;
	if (bTo + bAssetOutputs + bOutputsByAsset !== 1)
		throw Error("incompatible params");
	if ((params.to_address || params.amount) && params.asset_outputs)
		throw Error("to_address and asset_outputs at the same time");
	if (params.to_address && !params.amount)
		throw Error("to_address but not amount");
	if (!params.to_address && params.amount)
		throw Error("amount but not to_address");
	if (!params.to_address && !params.asset_outputs && !params.outputs_by_asset)
		throw Error("neither to_address nor asset_outputs nor outputs_by_asset");
	if (params.asset_outputs && !ValidationUtils.isNonemptyArray(params.asset_outputs))
		throw Error('asset_outputs must be non-empty array');
	if (!ValidationUtils.isNonemptyArray(params.fee_paying_addresses))
		throw Error('no fee_paying_addresses');
	var private_payload;
	let bAlreadyHaveChange = false;
	if (params.base_outputs && params.base_outputs.find(o => o.amount === 0))
		bAlreadyHaveChange = true;
	if (params.outputs_by_asset && params.outputs_by_asset.base && params.outputs_by_asset.base.find(o => o.amount === 0))
		bAlreadyHaveChange = true;
	var arrBaseOutputs = bAlreadyHaveChange ? [] : [{address: params.fee_paying_addresses[0], amount: 0}]; // public outputs: the change only
	if (params.base_outputs)
		arrBaseOutputs = arrBaseOutputs.concat(params.base_outputs);
	if (params.outputs_by_asset && params.outputs_by_asset.base)
		arrBaseOutputs = arrBaseOutputs.concat(params.outputs_by_asset.base);
	var arrAssetPayments = [];
	if (params.to_address)
		arrAssetPayments.push({ asset: params.asset, outputs: [{ address: params.to_address, amount: params.amount }] });
	else if (params.asset_outputs)
		arrAssetPayments.push({ asset: params.asset, outputs: params.asset_outputs });
	else if (params.outputs_by_asset)
		for (var a in params.outputs_by_asset)
			if (a !== 'base')
				arrAssetPayments.push({ asset: a, outputs: params.outputs_by_asset[a] });
	composer.composeJoint({
		paying_addresses: _.union(params.paying_addresses, params.fee_paying_addresses), // addresses that pay for the transfer and commissions
		signing_addresses: params.signing_addresses,
		minimal: params.minimal,
		outputs: arrBaseOutputs,
		messages:params.messages,
		spend_unconfirmed: params.spend_unconfirmed || conf.spend_unconfirmed || 'own',
		max_fee_ratio: params.max_fee_ratio,
		burn_fee: params.burn_fee,
		// function that creates additional messages to be added to the joint
		retrieveMessages: function(conn, last_ball_mci, bMultiAuthored, arrPayingAddresses, onDone){
			var arrAssetPayingAddresses = _.intersection(arrPayingAddresses, params.paying_addresses);
			var messages = [];
			var assocPrivatePayloads;
			async.eachSeries(
				arrAssetPayments,
				function (payment, cb) {
					storage.loadAssetWithListOfAttestedAuthors(conn, payment.asset, last_ball_mci, arrAssetPayingAddresses, function(err, objAsset){
						if (err)
							return cb(err);
						if (objAsset.fixed_denominations)
							return cb("fixed denominations asset type");
						// fix: also check change address when not transferrable
						if (!objAsset.is_transferrable && params.to_address !== objAsset.definer_address && arrAssetPayingAddresses.indexOf(objAsset.definer_address) === -1)
							return cb("the asset is not transferrable and definer not found on either side of the deal");
						if (objAsset.cosigned_by_definer && arrPayingAddresses.concat(params.signing_addresses || []).indexOf(objAsset.definer_address) === -1)
							return cb("the asset must be cosigned by definer");
						if (!conf.bLight && objAsset.spender_attested && objAsset.arrAttestedAddresses.length === 0)
							return cb("none of the authors is attested");
						
						var target_amount = payment.outputs.reduce(function(accumulator, output){ return accumulator + output.amount; }, 0);
						inputs.pickDivisibleCoinsForAmount(
							conn, objAsset, arrAssetPayingAddresses, last_ball_mci, target_amount, 0, 0, bMultiAuthored, params.spend_unconfirmed || conf.spend_unconfirmed || 'own',
							function(arrInputsWithProofs, total_input){
								console.log("pick coins callback "+JSON.stringify(arrInputsWithProofs));
								if (!arrInputsWithProofs)
									return cb({error_code: "NOT_ENOUGH_FUNDS", error: "not enough asset coins"});
								var arrOutputs = payment.outputs;
								var change = total_input - target_amount;
								if (change > 0){
									var objChangeOutput = {address: params.change_address, amount: change};
									arrOutputs.push(objChangeOutput);
								}
								if (objAsset.is_private)
									arrOutputs.forEach(function(output){ output.blinding = composer.generateBlinding(); });
								arrOutputs.sort(composer.sortOutputs);
								var payload = {
									asset: payment.asset,
									inputs: arrInputsWithProofs.map(function(objInputWithProof){ return objInputWithProof.input; }),
									outputs: arrOutputs
								};
								var objMessage = {
									app: "payment",
									payload_location: objAsset.is_private ? "none" : "inline",
									payload_hash: objectHash.getBase64Hash(payload, last_ball_mci >= constants.timestampUpgradeMci)
								};
								if (objAsset.is_private){
									objMessage.spend_proofs = arrInputsWithProofs.map(function(objInputWithProof){ return objInputWithProof.spend_proof; });
									private_payload = payload;
									assocPrivatePayloads[objMessage.payload_hash] = private_payload;
								}
								else
									objMessage.payload = payload;
								messages.push(objMessage);
								cb();
							}
						);
					});
				},
				function (err) {
					if (err)
						return onDone(err);
					onDone(null, messages, assocPrivatePayloads);
				}
			);
		},
		
		signer: params.signer, 
		
		callbacks: {
			ifError: params.callbacks.ifError,
			ifNotEnoughFunds: params.callbacks.ifNotEnoughFunds,
			ifOk: function(objJoint, assocPrivatePayloads, composer_unlock_callback){
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
		ifOk: async function(objJoint, private_payload, composer_unlock){
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
					console.log("divisible asset OK "+objValidationState.sequence);
					if (objValidationState.sequence !== 'good'){
						validation_unlock();
						combined_unlock();
						return callbacks.ifError("Divisible asset bad sequence "+objValidationState.sequence);
					}
					var bPrivate = !!private_payload;
					var objPrivateElement;
					var preCommitCallback = null;
					
					if (bPrivate){
						preCommitCallback = function(conn, cb){
							var payload_hash = objectHash.getBase64Hash(private_payload, objUnit.version !== constants.versionWithoutTimestamp);
							var message_index = composer.getMessageIndexByPayloadHash(objUnit, payload_hash);
							objPrivateElement = {
								unit: unit,
								message_index: message_index,
								payload: private_payload
							};
							validateAndSaveDivisiblePrivatePayment(conn, objPrivateElement, {
								ifError: function(err){
									cb(err);
								},
								ifOk: function(){
									cb();
								}
							});
						};
					} else {
						if (typeof callbacks.preCommitCb === "function") {
							preCommitCallback = function(conn, cb){
								callbacks.preCommitCb(conn, objJoint, cb);
							}
						}
					}
					
					composer.postJointToLightVendorIfNecessaryAndSave(
						objJoint, 
						function onLightError(err){ // light only
							console.log("failed to post divisible payment "+unit);
							validation_unlock();
							combined_unlock();
							callbacks.ifError(err);
						},
						function save(){
							writer.saveJoint(
								objJoint, objValidationState, 
								preCommitCallback,
								function onDone(err){
									console.log("saved unit "+unit+", err="+err, objPrivateElement);
									validation_unlock();
									combined_unlock();
									var arrChains = objPrivateElement ? [[objPrivateElement]] : null; // only one chain that consists of one element
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
	var params_with_save = _.clone(params);
	params_with_save.callbacks = params.compose_only ? composer.getNonsavingCallbacks(params.callbacks) : getSavingCallbacks(params.callbacks);
	composeDivisibleAssetPaymentJoint(params_with_save);
}

var TYPICAL_FEE = 1000;

// {asset: asset, available_paying_addresses: arrAvailablePayingAddresses, available_fee_paying_addresses: arrAvailableFeePayingAddresses, change_address: change_address, to_address: to_address, amount: amount, signer: signer, callbacks: callbacks}
function composeMinimalDivisibleAssetPaymentJoint(params){
		
	if (!ValidationUtils.isNonemptyArray(params.available_paying_addresses))
		throw Error('no available_paying_addresses');
	if (!ValidationUtils.isNonemptyArray(params.available_fee_paying_addresses))
		throw Error('no available_fee_paying_addresses');
	composer.readSortedFundedAddresses(params.asset, params.available_paying_addresses, params.amount, params.spend_unconfirmed || conf.spend_unconfirmed || 'own', function(arrFundedPayingAddresses){
		if (arrFundedPayingAddresses.length === 0){
			 // special case for issuing uncapped asset.  If it is not issuing, not-enough-funds will pop anyway
			if (params.available_paying_addresses.length === 1)
				arrFundedPayingAddresses = params.available_paying_addresses.concat();
			else
				return params.callbacks.ifNotEnoughFunds("all paying addresses are unfunded in asset, make sure all your funds are confirmed");
		}
		composer.readSortedFundedAddresses(null, params.available_fee_paying_addresses, TYPICAL_FEE, params.spend_unconfirmed || 'own', function(arrFundedFeePayingAddresses){
			if (arrFundedFeePayingAddresses.length === 0)
				return params.callbacks.ifNotEnoughFunds("all paying addresses are unfunded in bytes necessary for fees, make sure all your funds are confirmed");
			var minimal_params = _.clone(params);
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
	var params_with_save = _.clone(params);
	params_with_save.callbacks = getSavingCallbacks(params.callbacks);
	composeMinimalDivisibleAssetPaymentJoint(params_with_save);
}


exports.validateAndSavePrivatePaymentChain = validateAndSavePrivatePaymentChain;
exports.composeAndSaveDivisibleAssetPaymentJoint = composeAndSaveDivisibleAssetPaymentJoint;
exports.composeAndSaveMinimalDivisibleAssetPaymentJoint = composeAndSaveMinimalDivisibleAssetPaymentJoint;
