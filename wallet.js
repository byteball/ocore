/*jslint node: true */
"use strict";
var async = require('async');
var db = require('./db.js');
var constants = require('./constants.js');
var conf = require('./conf.js');
var mutex = require('./mutex.js');
var objectHash = require('./object_hash.js');
var ecdsaSig = require('./signature.js');
var network = require('./network.js');
var storage = require('./storage.js');
var device = require('./device.js');
var walletGeneral = require('./wallet_general.js');
var lightWallet = require('./light_wallet.js');
var walletDefinedByKeys = require('./wallet_defined_by_keys.js');
var walletDefinedByAddresses = require('./wallet_defined_by_addresses.js');
var eventBus = require('./event_bus.js');
var ValidationUtils = require("./validation_utils.js");
var composer = require('./composer.js');
var profiler = require('./profiler.js');
var breadcrumbs = require('./breadcrumbs.js');



function handleJustsaying(ws, subject, body){
	switch (subject){
		// I'm connected to a hub, received challenge
		case 'hub/challenge':
			var challenge = body;
			device.handleChallenge(ws, challenge);
			break;
			
		// I'm connected to a hub, received a message through the hub
		case 'hub/message':
			var objDeviceMessage = body.message;
			var message_hash = body.message_hash;
			var respondWithError = function(error){
				network.sendError(ws, error);
				network.sendJustsaying(ws, 'hub/delete', message_hash);
			};
			if (!message_hash || !objDeviceMessage || !objDeviceMessage.signature || !objDeviceMessage.pubkey || !objDeviceMessage.to
					|| !objDeviceMessage.encrypted_package || !objDeviceMessage.encrypted_package.dh
					|| !objDeviceMessage.encrypted_package.dh.sender_ephemeral_pubkey 
					|| !objDeviceMessage.encrypted_package.encrypted_message
					|| !objDeviceMessage.encrypted_package.iv || !objDeviceMessage.encrypted_package.authtag)
				return network.sendError(ws, "missing fields");
			if (objDeviceMessage.to !== device.getMyDeviceAddress())
				return network.sendError(ws, "not mine");
			if (message_hash !== objectHash.getBase64Hash(objDeviceMessage))
				return network.sendError(ws, "wrong hash");
			if (!ecdsaSig.verify(objectHash.getDeviceMessageHashToSign(objDeviceMessage), objDeviceMessage.signature, objDeviceMessage.pubkey))
				return respondWithError("wrong message signature");
			// end of checks on the open (unencrypted) part of the message. These checks should've been made by the hub before accepting the message
			
			// decrypt the message
			var json = device.decryptPackage(objDeviceMessage.encrypted_package);
			if (!json)
				return respondWithError("failed to decrypt");
			
			// who is the sender
			var from_address = objectHash.getDeviceAddress(objDeviceMessage.pubkey);
			// the hub couldn't mess with json.from as it was encrypted, but it could replace the objDeviceMessage.pubkey and re-sign. It'll be caught here
			if (from_address !== json.from) 
				return respondWithError("wrong message signature");
			
			var handleMessage = function(bIndirectCorrespondent){
				// serialize all messages from hub
				mutex.lock(["from_hub"], function(unlock){
					handleMessageFromHub(ws, json, objDeviceMessage.pubkey, bIndirectCorrespondent, {
						ifError: function(err){
							respondWithError(err);
							unlock();
						},
						ifOk: function(){
							network.sendJustsaying(ws, 'hub/delete', message_hash);
							unlock();
						}
					});
				});
			};
			// check that we know this device
			db.query("SELECT hub, is_indirect FROM correspondent_devices WHERE device_address=?", [from_address], function(rows){
				if (rows.length > 0){
					if (json.device_hub && json.device_hub !== rows[0].hub) // update correspondent's home address if necessary
						db.query("UPDATE correspondent_devices SET hub=? WHERE device_address=?", [json.device_hub, from_address], function(){
							handleMessage(rows[0].is_indirect);
						});
					else
						handleMessage(rows[0].is_indirect);
				}
				else{ // correspondent not known
					var arrSubjectsAllowedFromNoncorrespondents = ["pairing", "my_xpubkey", "wallet_fully_approved"];
					if (arrSubjectsAllowedFromNoncorrespondents.indexOf(json.subject) === -1)
						return respondWithError("correspondent not known and not whitelisted subject");
					handleMessage(false);
				}
			});
			break;
			
		case 'light/have_updates':
			lightWallet.refreshLightClientHistory();
			break;
	}
}

eventBus.on("message_from_hub", handleJustsaying);
eventBus.on("message_for_light", handleJustsaying);





// called from UI after user confirms signing request initiated from another device, initiator device being the recipient of this message
function sendSignature(device_address, signed_text, signature, signing_path, address){
	device.sendMessageToDevice(device_address, "signature", {signed_text: signed_text, signature: signature, signing_path: signing_path, address: address});
}

function handleMessageFromHub(ws, json, device_pubkey, bIndirectCorrespondent, callbacks){
	var subject = json.subject;
	var body = json.body;
	if (!subject || !body)
		return callbacks.ifError("no subject or body");
	//if (bIndirectCorrespondent && ["cancel_new_wallet", "my_xpubkey", "new_wallet_address"].indexOf(subject) === -1)
	//    return callbacks.ifError("you're indirect correspondent, cannot trust "+subject+" from you");
	var from_address = objectHash.getDeviceAddress(device_pubkey);
	
	switch (subject){
		case "pairing":
			device.handlePairingMessage(json, device_pubkey, callbacks);
			break;
		
		case "text":
			if (!ValidationUtils.isNonemptyString(body))
				return callbacks.ifError("text body must be string");
			// the wallet should have an event handler that displays the text to the user
			eventBus.emit("text", from_address, body);
			callbacks.ifOk();
			break;
		
		case "create_new_wallet":
			// {wallet: "base64", wallet_definition_template: [...]}
			walletDefinedByKeys.handleOfferToCreateNewWallet(body, from_address, callbacks);
			break;
		
		case "cancel_new_wallet":
			// {wallet: "base64"}
			if (!ValidationUtils.isNonemptyString(body.wallet))
				return callbacks.ifError("no wallet");
			walletDefinedByKeys.deleteWallet(body.wallet, from_address, callbacks.ifOk);
			break;
		
		case "my_xpubkey": // allowed from non-correspondents
			// {wallet: "base64", my_xpubkey: "base58"}
			if (!ValidationUtils.isNonemptyString(body.wallet))
				return callbacks.ifError("no wallet");
			if (!ValidationUtils.isNonemptyString(body.my_xpubkey))
				return callbacks.ifError("no my_xpubkey");
			if (body.my_xpubkey.length > 112)
				return callbacks.ifError("my_xpubkey too long");
			walletDefinedByKeys.addDeviceXPubKey(body.wallet, from_address, body.my_xpubkey, callbacks.ifOk);
			break;
		
		case "wallet_fully_approved": // allowed from non-correspondents
			// {wallet: "base64"}
			if (!ValidationUtils.isNonemptyString(body.wallet))
				return callbacks.ifError("no wallet");
			walletDefinedByKeys.handleNotificationThatWalletFullyApproved(body.wallet, from_address, callbacks.ifOk);
			break;
		
		case "new_wallet_address":
			// {wallet: "base64", is_change: (0|1), address_index: 1234, address: "BASE32"}
			if (!ValidationUtils.isNonemptyString(body.wallet))
				return callbacks.ifError("no wallet");
			if (!(body.is_change === 0 || body.is_change === 1))
				return callbacks.ifError("bad is_change");
			if (!ValidationUtils.isNonnegativeInteger(body.address_index))
				return callbacks.ifError("bad address_index");
			if (!ValidationUtils.isValidAddress(body.address))
				return callbacks.ifError("no address or bad address");
			walletDefinedByKeys.addNewAddress(body.wallet, body.is_change, body.address_index, body.address, function(err){
				if (err)
					return callbacks.ifError(err);
				callbacks.ifOk();
			});
			break;
			
		case "create_new_shared_address":
			// {address_definition_template: [...]}
			if (!ValidationUtils.isArrayOfLength(body.address_definition_template, 2))
				return callbacks.ifError("no address definition template");
			walletDefinedByAddresses.validateAddressDefinitionTemplate(
				body.address_definition_template, from_address, 
				function(err, assocMemberDeviceAddressesBySigningPaths){
					if (err)
						return callbacks.ifError(err);
					// this event should trigger a confirmatin dialog, user needs to approve creation of the shared address and choose his 
					// own address that is to become a member of the shared address
					eventBus.emit("create_new_shared_address", body.address_definition_template, assocMemberDeviceAddressesBySigningPaths);
					callbacks.ifOk();
				}
			);
			break;
		
		case "approve_new_shared_address":
			// {address_definition_template_chash: "BASE32", address: "BASE32", device_addresses_by_relative_signing_paths: {...}}
			if (!ValidationUtils.isValidAddress(body.address_definition_template_chash))
				return callbacks.ifError("invalid addr def c-hash");
			if (!ValidationUtils.isValidAddress(body.address))
				return callbacks.ifError("invalid address");
			if (typeof body.device_addresses_by_relative_signing_paths !== "object" 
					|| Object.keys(body.device_addresses_by_relative_signing_paths).length === 0)
				return callbacks.ifError("invalid device_addresses_by_relative_signing_paths");
			walletDefinedByAddresses.approvePendingSharedAddress(body.address_definition_template_chash, from_address, 
				body.address, body.device_addresses_by_relative_signing_paths);
			callbacks.ifOk();
			break;
			
		case "reject_new_shared_address":
			// {address_definition_template_chash: "BASE32"}
			if (!ValidationUtils.isValidAddress(body.address_definition_template_chash))
				return callbacks.ifError("invalid addr def c-hash");
			walletDefinedByAddresses.deletePendingSharedAddress(body.address_definition_template_chash);
			callbacks.ifOk();
			break;
			
		case "new_shared_address":
			// {address: "BASE32", definition: [...], signers: {...}}
			walletDefinedByAddresses.handleNewSharedAddress(body, callbacks);
			break;
			
		// request to sign a unit created on another device
		// two use cases:
		// 1. multisig: same address hosted on several devices
		// 2. multilateral signing: different addresses signing the same message, such as a (dumb) contract
		case "sign":
			// {address: "BASE32", signing_path: "r.1.2.3", unsigned_unit: {...}}
			if (!ValidationUtils.isValidAddress(body.address))
				return callbacks.ifError("no address or bad address");
			if (!ValidationUtils.isNonemptyString(body.signing_path) || body.signing_path.charAt(0) !== 'r')
				return callbacks.ifError("bad signing path");
			var objUnit = body.unsigned_unit;
			if (typeof objUnit !== "object")
				return callbacks.ifError("no unsigned unit");
			var assocPrivatePayloads = body.private_payloads;
			if ("private_payloads" in body){
				if (typeof assocPrivatePayloads !== "object" || !assocPrivatePayloads)
					return callbacks.ifError("bad private payloads");
				for (var payload_hash in assocPrivatePayloads){
					var payload = assocPrivatePayloads[payload_hash];
					var hidden_payload = _.cloneDeep(payload);
					if (payload.denomination) // indivisible asset.  In this case, payload hash is calculated based on output_hash rather than address and blinding
						hidden_payload.outputs.forEach(function(o){
							delete o.address;
							delete o.blinding;
						});
					var calculated_payload_hash = objectHash.getBase64Hash(hidden_payload);
					if (payload_hash !== calculated_payload_hash)
						return callbacks.ifError("private payload hash does not match");
					if (!ValidationUtils.isNonemptyArray(objUnit.messages))
						return callbacks.ifError("no messages in unsigned unit");
					if (objUnit.messages.filter(function(objMessage){ return (objMessage.payload_hash === payload_hash); }).length !== 1)
						return callbacks.ifError("no such payload hash in the messages");
				}
			}
			// findAddress handles both types of addresses
			findAddress(body.address, body.signing_path, {
				ifError: callbacks.ifError,
				ifLocal: function(objAddress){
					// the commented check would make multilateral signing impossible
					//db.query("SELECT 1 FROM extended_pubkeys WHERE wallet=? AND device_address=?", [row.wallet, from_address], function(sender_rows){
					//    if (sender_rows.length !== 1)
					//        return callbacks.ifError("sender is not cosigner of this address");
						callbacks.ifOk();
						objUnit.unit = objectHash.getUnitHash(objUnit);
						var objJoint = {unit: objUnit, unsigned: true};
						eventBus.once("validated-"+objUnit.unit, function(bValid){
							if (!bValid){
								console.log("===== unit in signing request is invalid");
								return;
							}
							// This event should trigger a confirmation dialog.
							// If we merge coins from several addresses of the same wallet, we'll fire this event multiple times for the same unit.
							// The event handler must lock the unit before displaying a confirmation dialog, then remember user's choice and apply it to all
							// subsequent requests related to the same unit
							eventBus.emit("signing_request", objAddress, objUnit, assocPrivatePayloads, from_address, body.signing_path);
						});
						// if validation is already under way, handleOnlineJoint will quickly exit because of assocUnitsInWork.
						// as soon as the previously started validation finishes, it will trigger our event handler (as well as its own)
						network.handleOnlineJoint(ws, objJoint);
					//});
				},
				ifRemote: function(device_address){
					var text_to_sign = objectHash.getUnitHashToSign(body.unsigned_unit).toString("base64");
					// I'm a proxy, wait for response from the actual signer and forward to the requestor
					eventBus.once("signature-"+device_address+"-"+body.address+"-"+body.signing_path+"-"+text_to_sign, function(sig){
						sendSignature(from_address, text_to_sign, sig, body.signing_path, body.address);
					});
					// forward the offer to the actual signer
					device.sendMessageToDevice(device_address, subject, body);
					callbacks.ifOk();
				},
				ifUnknownAddress: function(){
					callbacks.ifError("not aware of address "+body.address+" but will see if I learn about it later");
					eventBus.once("new_address-"+body.address, function(){
						// rewrite callbacks to avoid duplicate unlocking of mutex
						handleMessageFromHub(ws, json, device_pubkey, bIndirectCorrespondent, { ifOk: function(){}, ifError: function(){} });
					});
				}
			});
			break;
		
		case "signature":
			// {signed_text: "base64 of sha256", signing_path: "r.1.2.3", signature: "base64"}
			if (!ValidationUtils.isStringOfLength(body.signed_text, constants.HASH_LENGTH)) // base64 of sha256
				return callbacks.ifError("bad signed text");
			if (!ValidationUtils.isStringOfLength(body.signature, constants.SIG_LENGTH) && body.signature !== '[refused]')
				return callbacks.ifError("bad signature length");
			if (!ValidationUtils.isNonemptyString(body.signing_path) || body.signing_path.charAt(0) !== 'r')
				return callbacks.ifError("bad signing path");
			if (!ValidationUtils.isValidAddress(body.address))
				return callbacks.ifError("bad address");
			eventBus.emit("signature-" + from_address + "-" + body.address + "-" + body.signing_path + "-" + body.signed_text, body.signature);
			callbacks.ifOk();
			break;
			
		case 'private_payments':
			var arrChains = body.chains;
			if (!ValidationUtils.isNonemptyArray(arrChains))
				return callbacks.ifError("no chains found");
			profiler.increment();
			
			if (conf.bLight)
				network.requestUnfinishedPastUnitsOfPrivateChains(arrChains); // it'll work in the background
			
			var assocValidatedByKey = {};
			var bParsingComplete = false;
			var cancelAllKeys = function(){
				for (var key in assocValidatedByKey)
					eventBus.removeAllListeners(key);
			};
			var checkIfAllValidated = function(){
				if (!assocValidatedByKey) // duplicate call - ignore
					return console.log('duplicate call of checkIfAllValidated');
				for (var key in assocValidatedByKey)
					if (!assocValidatedByKey[key])
						return console.log('not all private payments validated yet');
				assocValidatedByKey = null; // to avoid duplicate calls
				if (!body.forwarded)
					emitNewPrivatePaymentReceived(from_address, arrChains);
				profiler.print();
			};
			
			async.eachSeries(
				arrChains,
				function(arrPrivateElements, cb){ // validate each chain individually
					var objHeadPrivateElement = arrPrivateElements[0];
					if (!!objHeadPrivateElement.payload.denomination !== ValidationUtils.isNonnegativeInteger(objHeadPrivateElement.output_index))
						return cb("divisibility doesn't match presence of output_index");
					var output_index = objHeadPrivateElement.payload.denomination ? objHeadPrivateElement.output_index : -1;
					var payload_hash = objectHash.getBase64Hash(objHeadPrivateElement.payload);
					var key = 'private_payment_validated-'+objHeadPrivateElement.unit+'-'+payload_hash+'-'+output_index;
					assocValidatedByKey[key] = false;
					network.handleOnlinePrivatePayment(ws, arrPrivateElements, true, {
						ifError: function(error){
							console.log("handleOnlinePrivatePayment error: "+error);
							cb("an error"); // do not leak error message to the hub
						},
						ifValidationError: function(unit, error){
							console.log("handleOnlinePrivatePayment validation error: "+error);
							cb("an error"); // do not leak error message to the hub
						},
						ifAccepted: function(unit){
							console.log("handleOnlinePrivatePayment accepted");
							assocValidatedByKey[key] = true;
							cb(); // do not leak unit info to the hub
						},
						// this is the most likely outcome for light clients
						ifQueued: function(){
							console.log("handleOnlinePrivatePayment queued, will wait for "+key);
							eventBus.once(key, function(bValid){
								if (!bValid)
									return cancelAllKeys();
								assocValidatedByKey[key] = true;
								if (bParsingComplete)
									checkIfAllValidated();
								else
									console.log('parsing incomplete yet');
							});
							cb();
						}
					});
				},
				function(err){
					bParsingComplete = true;
					if (err){
						cancelAllKeys();
						return callbacks.ifError(err);
					}
					checkIfAllValidated();
					callbacks.ifOk();
					// forward the chains to other members of output addresses
					if (!body.forwarded)
						forwardPrivateChainsToOtherMembersOfOutputAddresses(arrChains);
				}
			);
			break;
			
		case 'payment_notification':
			// note that since the payments are public, an evil user might notify us about a payment sent by someone else 
			// (we'll be fooled to believe it was sent by the evil user).  It is only possible if he learns our address, e.g. if we make it public.
			// Normally, we generate a one-time address and share it in chat session with the future payer only. 
			var unit = body;
			if (!ValidationUtils.isStringOfLength(unit, constants.HASH_LENGTH))
				return callbacks.ifError("invalid unit in payment notification");
			eventBus.once('new_my_unit-'+unit, function(objJoint){
				emitNewPublicPaymentReceived(from_address, objJoint.unit);
			});
			storage.readJoint(db, unit, {
				ifNotFound: function(){
					console.log("received payment notification for unit "+unit+" which is not known yet, will wait for it");
					callbacks.ifOk();
				},
				ifFound: function(objJoint){
					// we emit rather than calling the handler directly to ensure that it is handled only once
					eventBus.emit('new_my_unit-'+unit, objJoint);
					callbacks.ifOk();
				}
			});
			break;
	}
}


function forwardPrivateChainsToOtherMembersOfOutputAddresses(arrChains){
	console.log("forwardPrivateChainsToOtherMembersOfOutputAddresses", arrChains);
	var assocOutputAddresses = {};
	arrChains.forEach(function(arrPrivateElements){
		var objHeadPrivateElement = arrPrivateElements[0];
		var payload = objHeadPrivateElement.payload;
		payload.outputs.forEach(function(output){
			if (output.address)
				assocOutputAddresses[output.address] = true;
		});
		if (objHeadPrivateElement.output && objHeadPrivateElement.output.address)
			assocOutputAddresses[objHeadPrivateElement.output.address] = true;
	});
	var arrOutputAddresses = Object.keys(assocOutputAddresses);
	console.log("output addresses", arrOutputAddresses);
	db.query("SELECT DISTINCT wallet FROM my_addresses WHERE address IN(?)", [arrOutputAddresses], function(rows){
		if (rows.length === 0){
			breadcrumbs.add("forwardPrivateChainsToOtherMembersOfOutputAddresses: " + JSON.stringify(arrChains)); // remove in livenet
			throw Error("not my wallet? output addresses: "+arrOutputAddresses.join(', '));
		}
		var arrWallets = rows.map(function(row){ return row.wallet; });
		if (arrWallets.length > 0)
			walletDefinedByKeys.forwardPrivateChainsToOtherMembersOfWallets(arrChains, arrWallets);
		walletDefinedByAddresses.forwardPrivateChainsToOtherMembersOfAddresses(arrChains, arrOutputAddresses);
	});
}

// event emitted in two cases:
// 1. if I received private payloads via direct connection, not through a hub
// 2. (not true any more) received private payload from anywhere, didn't handle it immediately, saved and handled later
eventBus.on("new_direct_private_chains", forwardPrivateChainsToOtherMembersOfOutputAddresses);


function emitNewPrivatePaymentReceived(payer_device_address, arrChains){
	console.log('emitNewPrivatePaymentReceived');
	walletGeneral.readMyAddresses(function(arrAddresses){
		var assocAmountsByAsset = {};
		arrChains.forEach(function(arrPrivateElements){
			var objHeadPrivateElement = arrPrivateElements[0];
			var payload = objHeadPrivateElement.payload;
			var asset = payload.asset || 'base';
			if (!assocAmountsByAsset[asset])
				assocAmountsByAsset[asset] = 0;
			payload.outputs.forEach(function(output){
				if (output.address && arrAddresses.indexOf(output.address) >= 0)
					assocAmountsByAsset[asset] += output.amount;
			});
			// indivisible
			var output = objHeadPrivateElement.output;
			if (output && output.address && arrAddresses.indexOf(output.address) >= 0)
				assocAmountsByAsset[asset] += payload.outputs[objHeadPrivateElement.output_index].amount;
		});
		console.log('assocAmountsByAsset', assocAmountsByAsset);
		for (var asset in assocAmountsByAsset)
			if (assocAmountsByAsset[asset])
				eventBus.emit('received_payment', payer_device_address, assocAmountsByAsset[asset], asset);
	});
}

function emitNewPublicPaymentReceived(payer_device_address, objUnit){
	walletGeneral.readMyAddresses(function(arrAddresses){
		var assocAmountsByAsset = {};
		objUnit.messages.forEach(function(message){
			if (message.app !== 'payment' || !message.payload)
				return;
			var payload = message.payload;
			var asset = payload.asset || 'base';
			if (!assocAmountsByAsset[asset])
				assocAmountsByAsset[asset] = 0;
			payload.outputs.forEach(function(output){
				if (output.address && arrAddresses.indexOf(output.address) >= 0)
					assocAmountsByAsset[asset] += output.amount;
			});
		});
		for (var asset in assocAmountsByAsset)
			if (assocAmountsByAsset[asset])
				eventBus.emit('received_payment', payer_device_address, assocAmountsByAsset[asset], asset);
	});
}


function findAddress(address, signing_path, callbacks){
	db.query(
		"SELECT wallet, account, is_change, address_index, full_approval_date, device_address \n\
		FROM my_addresses JOIN wallets USING(wallet) JOIN wallet_signing_paths USING(wallet) \n\
		WHERE address=? AND signing_path=?",
		[address, signing_path],
		function(rows){
			if (rows.length > 1)
				throw Error("more than 1 address found");
			if (rows.length === 1){
				var row = rows[0];
				if (!row.full_approval_date)
					return callbacks.ifError("wallet of address "+address+" not approved");
				if (row.device_address !== device.getMyDeviceAddress())
					return callbacks.ifRemote(row.device_address);
				var objAddress = {
					address: address,
					wallet: row.wallet,
					account: row.account,
					is_change: row.is_change,
					address_index: row.address_index
				};
				callbacks.ifLocal(objAddress);
				return;
			}
			db.query(
				"SELECT address, device_address, member_signing_path FROM shared_address_signing_paths WHERE shared_address=? AND signing_path=?", 
				[address, signing_path],
				function(sa_rows){
					if (sa_rows.length !== 1)
						return callbacks.ifUnknownAddress();
					var objSharedAddress = sa_rows[0];
					(objSharedAddress.device_address === device.getMyDeviceAddress()) // local keys
						? findAddress(objSharedAddress.address, objSharedAddress.member_signing_path, callbacks)
						: callbacks.ifRemote(objSharedAddress.device_address);
				}
			);
		}
	);
}




function readSharedBalance(wallet, handleBalance){
	var assocBalances = {};
	db.query(
		"SELECT asset, shared_address, is_stable, SUM(amount) AS balance \n\
		FROM shared_addresses JOIN outputs ON shared_address=address JOIN units USING(unit) \n\
		WHERE is_spent=0 AND sequence='good' AND shared_address IN ( \n\
			SELECT DISTINCT shared_address FROM my_addresses JOIN shared_address_signing_paths USING(address) WHERE wallet=? \n\
		) \n\
		GROUP BY asset, shared_address, is_stable", 
		[wallet], 
		function(rows){
			for (var i=0; i<rows.length; i++){
				var row = rows[i];
				var asset = row.asset || "base";
				if (!assocBalances[asset])
					assocBalances[asset] = {};
				if (!assocBalances[asset][row.shared_address])
					assocBalances[asset][row.shared_address] = {stable: 0, pending: 0};
				assocBalances[asset][row.shared_address][row.is_stable ? 'stable' : 'pending'] = row.balance;
			}
			handleBalance(assocBalances);
		}
	);
}


function readBalance(wallet, handleBalance){
	var walletIsAddress = ValidationUtils.isValidAddress(wallet);
	var join_my_addresses = walletIsAddress ? "" : "JOIN my_addresses USING(address)";
	var where_condition = walletIsAddress ? "address=?" : "wallet=?";
	var assocBalances = {base: {stable: 0, pending: 0}};
	db.query(
		"SELECT asset, is_stable, SUM(amount) AS balance \n\
		FROM outputs "+join_my_addresses+" JOIN units USING(unit) \n\
		WHERE is_spent=0 AND "+where_condition+" AND sequence='good' \n\
		GROUP BY asset, is_stable", 
		[wallet], 
		function(rows){
			for (var i=0; i<rows.length; i++){
				var row = rows[i];
				var asset = row.asset || "base";
				if (!assocBalances[asset])
					assocBalances[asset] = {stable: 0, pending: 0};
				assocBalances[asset][row.is_stable ? 'stable' : 'pending'] = row.balance;
			}
			var my_addresses_join = walletIsAddress ? "" : "my_addresses CROSS JOIN";
			var using = walletIsAddress ? "" : "USING(address)";
			db.query(
				"SELECT SUM(total) AS total FROM ( \n\
				SELECT SUM(amount) AS total FROM "+my_addresses_join+" witnessing_outputs "+using+" WHERE is_spent=0 AND "+where_condition+" \n\
				UNION \n\
				SELECT SUM(amount) AS total FROM "+my_addresses_join+" headers_commission_outputs "+using+" WHERE is_spent=0 AND "+where_condition+" )",
				[wallet,wallet],
				function(rows) {
					if(rows.length){
						assocBalances["base"]["stable"] += rows[0].total;
					}
					// add 0-balance assets
					db.query(
						"SELECT DISTINCT outputs.asset, is_private \n\
						FROM outputs "+join_my_addresses+" JOIN units USING(unit) LEFT JOIN assets ON asset=assets.unit \n\
						WHERE "+where_condition+" AND sequence='good'", 
						[wallet], 
						function(rows){
							for (var i=0; i<rows.length; i++){
								var row = rows[i];
								var asset = row.asset || "base";
								if (!assocBalances[asset])
									assocBalances[asset] = {stable: 0, pending: 0};
								assocBalances[asset].is_private = row.is_private;
							}
							handleBalance(assocBalances);
							if (conf.bLight){ // make sure we have all asset definitions available
								var arrAssets = Object.keys(assocBalances).filter(function(asset){ return (asset !== 'base'); });
								if (arrAssets.length === 0)
									return;
								network.requestProofsOfJointsIfNewOrUnstable(arrAssets);
							}
						}
					);
				}
			);
		}
	);
}


function readTransactionHistory(wallet, asset, handleHistory){
	var walletIsAddress = ValidationUtils.isValidAddress(wallet);
	var join_my_addresses = walletIsAddress ? "" : "JOIN my_addresses USING(address)";
	var where_condition = walletIsAddress ? "address=?" : "wallet=?";
	var asset_condition = (asset && asset !== "base") ? "asset="+db.escape(asset) : "asset IS NULL";
	db.query(
		"SELECT unit, level, is_stable, sequence, address, \n\
			"+db.getUnixTimestamp("units.creation_date")+" AS ts, headers_commission+payload_commission AS fee, \n\
			SUM(amount) AS amount, address AS to_address, NULL AS from_address \n\
		FROM outputs "+join_my_addresses+" JOIN units USING(unit) \n\
		WHERE "+where_condition+" AND "+asset_condition+" \n\
		GROUP BY unit, address \n\
		UNION \n\
		SELECT unit, level, is_stable, sequence, address, \n\
			"+db.getUnixTimestamp("units.creation_date")+" AS ts, headers_commission+payload_commission AS fee, \n\
			NULL AS amount, NULL AS to_address, address AS from_address \n\
		FROM inputs "+join_my_addresses+" JOIN units USING(unit) \n\
		WHERE "+where_condition+" AND "+asset_condition,
		[wallet, wallet],
		function(rows){
			var assocMovements = {};
			for (var i=0; i<rows.length; i++){
				var row = rows[i];
				//if (asset !== "base")
				//    row.fee = null;
				if (!assocMovements[row.unit])
					assocMovements[row.unit] = {
						plus:0, has_minus:false, ts: row.ts, level: row.level, is_stable: row.is_stable, sequence: row.sequence, fee: row.fee
					};
				if (row.to_address)
					assocMovements[row.unit].plus += row.amount;
				if (row.from_address)
					assocMovements[row.unit].has_minus = true;
			}
			var arrTransactions = [];
			async.forEachOfSeries(
				assocMovements,
				function(movement, unit, cb){
					if (movement.sequence !== 'good'){
						var transaction = {
							action: 'invalid',
							confirmations: movement.is_stable,
							unit: unit,
							fee: movement.fee,
							time: movement.ts,
							level: movement.level
						};
						arrTransactions.push(transaction);
						cb();
					}
					else if (movement.plus && !movement.has_minus){
						// light clients will sometimes have input address = NULL
						db.query(
							"SELECT DISTINCT address FROM inputs WHERE unit=? AND "+asset_condition+" ORDER BY address", 
							[unit], 
							function(address_rows){
								var arrPayerAddresses = address_rows.map(function(address_row){ return address_row.address; });
								var transaction = {
									action: 'received',
									amount: movement.plus,
									arrPayerAddresses: arrPayerAddresses,
									confirmations: movement.is_stable,
									unit: unit,
									fee: movement.fee,
									time: movement.ts,
									level: movement.level
								};
								arrTransactions.push(transaction);
								cb();
							}
						);
					}
					else if (movement.has_minus){
						var queryString, parameters;
						if(walletIsAddress){
							queryString =   "SELECT address, SUM(amount) AS amount \n\
											FROM outputs \n\
											WHERE unit=? AND "+asset_condition+" AND address!=? \n\
											GROUP BY address";
							parameters = [unit, wallet];
						}
						else {
							queryString =   "SELECT outputs.address, SUM(amount) AS amount \n\
											FROM outputs \n\
											LEFT JOIN my_addresses ON outputs.address=my_addresses.address AND wallet=? \n\
											WHERE unit=? AND "+asset_condition+" AND my_addresses.address IS NULL \n\
											GROUP BY outputs.address";
							parameters = [wallet, unit];
						}
						db.query(queryString, parameters, 
							function(payee_rows){
								for (var i=0; i<payee_rows.length; i++){
									var payee = payee_rows[i];
									var transaction = {
										action: 'sent',
										amount: payee.amount,
										addressTo: payee.address,
										confirmations: movement.is_stable,
										unit: unit,
										fee: movement.fee,
										time: movement.ts,
										level: movement.level
									};
									arrTransactions.push(transaction);
								}
								cb();
							}
						);
					}
				},
				function(){
					arrTransactions.sort(function(a, b){
						if (a.level < b.level)
							return 1;
						if (a.level > b.level)
							return -1;
						if (a.time < b.time)
							return 1;
						if (a.time > b.time)
							return -1;
						return 0;
					});
					arrTransactions.forEach(function(transaction){ transaction.asset = asset; });
					handleHistory(arrTransactions);
				}
			);
		}
	);
}



function readFundedAddresses(asset, wallet, handleFundedAddresses){
	var walletIsAddresses = ValidationUtils.isNonemptyArray(wallet);
	var join_my_addresses = walletIsAddresses ? "" : "JOIN my_addresses USING(address)";
	var where_condition = walletIsAddresses ? "address IN(?)" : "wallet=?";
	db.query(
		"SELECT DISTINCT address \n\
		FROM outputs "+join_my_addresses+" \n\
		JOIN units USING(unit) \n\
		WHERE "+where_condition+" AND is_stable=1 AND sequence='good' AND is_spent=0 AND "+(asset ? "(asset=? OR asset IS NULL)" : "asset IS NULL")+" \n\
			AND NOT EXISTS ( \n\
				SELECT * FROM unit_authors JOIN units USING(unit) \n\
				WHERE is_stable=0 AND unit_authors.address=outputs.address AND definition_chash IS NOT NULL \n\
			)",
		asset ? [wallet, asset] : [wallet],
		function(rows){
			var arrFundedAddresses = rows.map(function(row){ return row.address; });
			return handleFundedAddresses(arrFundedAddresses);
		}
	);
}



function sendPaymentFromWallet(
		asset, wallet, to_address, amount, change_address, arrSigningDeviceAddresses, recipient_device_address, signWithLocalPrivateKey, handleResult)
{
	sendMultiPayment({
		asset: asset,
		wallet: wallet,
		to_address: to_address,
		amount: amount,
		change_address: change_address,
		arrSigningDeviceAddresses: arrSigningDeviceAddresses,
		recipient_device_address: recipient_device_address,
		signWithLocalPrivateKey: signWithLocalPrivateKey
	}, handleResult);
}

function sendMultiPayment(opts, handleResult)
{
	var asset = opts.asset;
	var wallet = opts.wallet;
	var arrPayingAddresses = opts.paying_addresses;
	var arrSigningAddresses = opts.signing_addresses;
	var to_address = opts.to_address;
	var amount = opts.amount;
	var change_address = opts.change_address;
	var arrSigningDeviceAddresses = opts.arrSigningDeviceAddresses;
	var recipient_device_address = opts.recipient_device_address;
	var signWithLocalPrivateKey = opts.signWithLocalPrivateKey;
	
	var base_outputs = opts.base_outputs;
	var asset_outputs = opts.asset_outputs;
	
	if (!wallet && !arrPayingAddresses)
		throw Error("neither wallet id nor paying addresses");
	if (wallet && arrPayingAddresses)
		throw Error("both wallet id and paying addresses");
	if ((to_address || amount) && (base_outputs || asset_outputs))
		throw Error('to_address and outputs at the same time');
	if (!asset && asset_outputs)
		throw Error('base asset and asset outputs');
	
	readFundedAddresses(asset, wallet || arrPayingAddresses, function(arrFromAddresses){
		if (arrFromAddresses.length === 0)
			return handleResult("There are no funded addresses");
		
		var bRequestedConfirmation = false;
		var signer = {
			getSignatureLength: function(address, path){
				return constants.SIG_LENGTH;
			},
			readSigningPaths: function(conn, address, handleSigningPaths){
				var sql = "SELECT signing_path FROM my_addresses JOIN wallet_signing_paths USING(wallet) WHERE address=?";
				var arrParams = [address];
				if (arrSigningDeviceAddresses && arrSigningDeviceAddresses.length > 0){
					sql += " AND device_address IN(?)";
					arrParams.push(arrSigningDeviceAddresses);
				}
				sql += " UNION SELECT signing_path FROM shared_address_signing_paths WHERE shared_address=?";
				arrParams.push(address);
				if (arrSigningDeviceAddresses && arrSigningDeviceAddresses.length > 0){
					sql += " AND device_address IN(?)";
					arrParams.push(arrSigningDeviceAddresses);
				}
				sql += " ORDER BY signing_path";   
				conn.query(
					sql, 
					arrParams,
					function(rows){
						var arrSigningPaths = rows.map(function(row){ return row.signing_path; });
						handleSigningPaths(arrSigningPaths);
					}
				);
			},
			readDefinition: function(conn, address, handleDefinition){
				conn.query(
					"SELECT definition FROM my_addresses WHERE address=? UNION SELECT definition FROM shared_addresses WHERE shared_address=?", 
					[address, address], 
					function(rows){
						if (rows.length !== 1)
							throw Error("definition not found");
						handleDefinition(null, JSON.parse(rows[0].definition));
					}
				);
			},
			sign: function(objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature){
				var buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
				findAddress(address, signing_path, {
					ifError: function(err){
						throw Error(err);
					},
					ifUnknownAddress: function(err){
						throw Error("unknown address");
					},
					ifLocal: function(objAddress){
						signWithLocalPrivateKey(objAddress.wallet, objAddress.account, objAddress.is_change, objAddress.address_index, buf_to_sign, function(sig){
							handleSignature(null, sig);
						});
					},
					ifRemote: function(device_address){
						// we'll receive this event after the peer signs
						eventBus.once("signature-"+device_address+"-"+address+"-"+signing_path+"-"+buf_to_sign.toString("base64"), function(sig){
							handleSignature(null, sig);
							if (sig === '[refused]')
								eventBus.emit('refused_to_sign', device_address);
						});
						walletGeneral.sendOfferToSign(device_address, address, signing_path, objUnsignedUnit, assocPrivatePayloads);
						if (!bRequestedConfirmation){
							eventBus.emit("confirm_on_other_devices");
							bRequestedConfirmation = true;
						}
					}
				});
			}
		};
		
		var params = {
			available_paying_addresses: arrFromAddresses, // forces 'minimal' for payments from shared addresses too, it doesn't hurt
			signing_addresses: arrSigningAddresses,
			signer: signer, 
			callbacks: {
				ifNotEnoughFunds: function(err){
					handleResult(err);
				},
				ifError: function(err){
					handleResult(err);
				},
				// for asset payments, 2nd argument is array of chains of private elements
				// for base asset, 2nd argument is assocPrivatePayloads which is null
				ifOk: function(objJoint, arrChainsOfRecipientPrivateElements, arrChainsOfCosignerPrivateElements){
					network.broadcastJoint(objJoint);
					if (arrChainsOfRecipientPrivateElements){
						if (wallet)
							walletDefinedByKeys.forwardPrivateChainsToOtherMembersOfWallets(arrChainsOfCosignerPrivateElements, [wallet]);
						else // arrPayingAddresses can be only shared addresses
							walletDefinedByAddresses.forwardPrivateChainsToOtherMembersOfAddresses(arrChainsOfCosignerPrivateElements, arrPayingAddresses);
						walletGeneral.sendPrivatePayments(recipient_device_address, arrChainsOfRecipientPrivateElements);
					}
					else if (recipient_device_address) // send notification about public payment
						walletGeneral.sendPaymentNotification(recipient_device_address, objJoint.unit.unit);
					handleResult(null, objJoint.unit.unit);
				}
			}
		};
		
		if (asset && asset !== "base"){
			params.asset = asset;
			if (to_address){
				params.to_address = to_address;
				params.amount = amount; // in asset units
			}
			else{
				params.asset_outputs = asset_outputs;
				params.base_outputs = base_outputs; // only destinations, without the change
			}
			params.change_address = change_address;
			storage.readAsset(db, asset, null, function(err, objAsset){
				if (err)
					throw Error(err);
				if (objAsset.is_private && !recipient_device_address)
					return handleResult("for private asset, need recipient's device address to send private payload to");
				if (objAsset.fixed_denominations){ // indivisible
					params.tolerance_plus = 0;
					params.tolerance_minus = 0;
					indivisibleAsset.composeAndSaveMinimalIndivisibleAssetPaymentJoint(params);
				}
				else{ // divisible
					divisibleAsset.composeAndSaveMinimalDivisibleAssetPaymentJoint(params);
				}
			});
		}
		else{ // base asset
			params.outputs = to_address ? [{address: to_address, amount: amount}] : base_outputs;
			params.outputs.push({address: change_address, amount: 0});
			composer.composeAndSaveMinimalJoint(params);
		}
	
	});
}


// todo, almost same as payment
function signAuthRequest(wallet, objRequest, handleResult){
	
}



/*
walletGeneral.readMyAddresses(function(arrAddresses){
	network.setWatchedAddresses(arrAddresses);
})
*/



exports.sendSignature = sendSignature;
exports.readSharedBalance = readSharedBalance;
exports.readBalance = readBalance;
exports.readTransactionHistory = readTransactionHistory;
exports.sendPaymentFromWallet = sendPaymentFromWallet;
exports.sendMultiPayment = sendMultiPayment;

