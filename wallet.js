/*jslint node: true */
"use strict";
var async = require('async');
var _ = require('lodash');
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
var indivisibleAsset = require('./indivisible_asset.js');
var divisibleAsset = require('./divisible_asset.js');
var profiler = require('./profiler.js');
var breadcrumbs = require('./breadcrumbs.js');
var balances = require('./balances');
var Mnemonic = require('bitcore-mnemonic');

var message_counter = 0;
var assocLastFailedAssetMetadataTimestamps = {};
var ASSET_METADATA_RETRY_PERIOD = 3600*1000;

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
			
		// I'm connected to a hub, received a report about my undelivered inbox
		case 'hub/message_box_status':
			if (!ws.bLoggedIn)
				return respondWithError("you are not my hub");
			if (body === 'empty')
				device.scheduleTempDeviceKeyRotation();
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

// one of callbacks MUST be called, otherwise the mutex will stay locked
function handleMessageFromHub(ws, json, device_pubkey, bIndirectCorrespondent, callbacks){
	var subject = json.subject;
	var body = json.body;
	if (!subject || typeof body == "undefined")
		return callbacks.ifError("no subject or body");
	//if (bIndirectCorrespondent && ["cancel_new_wallet", "my_xpubkey", "new_wallet_address"].indexOf(subject) === -1)
	//    return callbacks.ifError("you're indirect correspondent, cannot trust "+subject+" from you");
	var from_address = objectHash.getDeviceAddress(device_pubkey);
	
	switch (subject){
		case "pairing":
			device.handlePairingMessage(json, device_pubkey, callbacks);
			break;
		
		case "text":
			message_counter++;
			if (!ValidationUtils.isNonemptyString(body))
				return callbacks.ifError("text body must be string");
			// the wallet should have an event handler that displays the text to the user
			eventBus.emit("text", from_address, body, message_counter);
			callbacks.ifOk();
			break;

		case "removed_paired_device":
			if(conf.bIgnoreUnpairRequests) {
				// unpairing is ignored
				callbacks.ifError("removed_paired_device ignored: "+from_address);
			} else {
				determineIfDeviceCanBeRemoved(from_address, function(bRemovable){
					if (!bRemovable)
						return callbacks.ifError("device "+from_address+" is not removable");
					device.removeCorrespondentDevice(from_address, function(){
						eventBus.emit("removed_paired_device", from_address);
						callbacks.ifOk();
					});
				});
			}
			break;

		case "chat_recording_pref":
			message_counter++;
			eventBus.emit("chat_recording_pref", from_address, body, message_counter);
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
			walletDefinedByAddresses.handleNewSharedAddress(body, {
				ifError: callbacks.ifError,
				ifOk: function(){
					callbacks.ifOk();
					eventBus.emit('maybe_new_transactions');
				}
			});
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
			// replace all existing signatures with placeholders so that signing requests sent to us on different stages of signing become identical,
			// hence the hashes of such unsigned units are also identical
			objUnit.authors.forEach(function(author){
				var authentifiers = author.authentifiers;
				for (var path in authentifiers)
					authentifiers[path] = authentifiers[path].replace(/./, '-'); 
			});
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
							eventBus.emit("signing_request", objAddress, body.address, objUnit, assocPrivatePayloads, from_address, body.signing_path);
						});
						// if validation is already under way, handleOnlineJoint will quickly exit because of assocUnitsInWork.
						// as soon as the previously started validation finishes, it will trigger our event handler (as well as its own)
						network.handleOnlineJoint(ws, objJoint);
					//});
				},
				ifRemote: function(device_address){
					if (device_address === from_address){
						callbacks.ifError("looping signing request for address "+body.address+", path "+body.signing_path);
						throw Error("looping signing request for address "+body.address+", path "+body.signing_path);
					}
					var text_to_sign = objectHash.getUnitHashToSign(body.unsigned_unit).toString("base64");
					// I'm a proxy, wait for response from the actual signer and forward to the requestor
					eventBus.once("signature-"+device_address+"-"+body.address+"-"+body.signing_path+"-"+text_to_sign, function(sig){
						sendSignature(from_address, text_to_sign, sig, body.signing_path, body.address);
					});
					// forward the offer to the actual signer
					device.sendMessageToDevice(device_address, subject, body);
					callbacks.ifOk();
				},
				ifMerkle: function(bLocal){
					callbacks.ifError("there is merkle proof at signing path "+body.signing_path);
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

			var current_message_counter = ++message_counter;

			var checkIfAllValidated = function(){
				if (!assocValidatedByKey) // duplicate call - ignore
					return console.log('duplicate call of checkIfAllValidated');
				for (var key in assocValidatedByKey)
					if (!assocValidatedByKey[key])
						return console.log('not all private payments validated yet');
				assocValidatedByKey = null; // to avoid duplicate calls
				if (!body.forwarded){
					emitNewPrivatePaymentReceived(from_address, arrChains, current_message_counter);
					// note, this forwarding won't work if the user closes the wallet before validation of the private chains
					var arrUnits = arrChains.map(function(arrPrivateElements){ return arrPrivateElements[0].unit; });
					db.query("SELECT address FROM unit_authors WHERE unit IN(?)", [arrUnits], function(rows){
						var arrAuthorAddresses = rows.map(function(row){ return row.address; });
						// if the addresses are not shared, it doesn't forward anything
						forwardPrivateChainsToOtherMembersOfSharedAddresses(arrChains, arrAuthorAddresses, from_address, true);
					});
				}
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
			var current_message_counter = ++message_counter;
			var unit = body;
			if (!ValidationUtils.isStringOfLength(unit, constants.HASH_LENGTH))
				return callbacks.ifError("invalid unit in payment notification");
			var bEmitted = false;
			var emitPn = function(objJoint){
				if (bEmitted)
					return;
				bEmitted = true;
				emitNewPublicPaymentReceived(from_address, objJoint.unit, current_message_counter);
			};
			eventBus.once('saved_unit-'+unit, emitPn);
			storage.readJoint(db, unit, {
				ifNotFound: function(){
					console.log("received payment notification for unit "+unit+" which is not known yet, will wait for it");
					callbacks.ifOk();
				},
				ifFound: function(objJoint){
					emitPn(objJoint);
					eventBus.removeListener('saved_unit-'+unit, emitPn);
					callbacks.ifOk();
				}
			});
			break;
			
		default:
			callbacks.ifError("unknnown subject: "+subject);
	}
}


function forwardPrivateChainsToOtherMembersOfOutputAddresses(arrChains, conn, onSaved){
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
	conn = conn || db;
	if (!onSaved)
		onSaved = function(){};
	readWalletsByAddresses(conn, arrOutputAddresses, function(arrWallets){
		if (arrWallets.length === 0){
		//	breadcrumbs.add("forwardPrivateChainsToOtherMembersOfOutputAddresses: " + JSON.stringify(arrChains)); // remove in livenet
			eventBus.emit('nonfatal_error', "not my wallet? output addresses: "+arrOutputAddresses.join(', '), new Error());
		//	throw Error("not my wallet? output addresses: "+arrOutputAddresses.join(', '));
		}
		var arrFuncs = [];
		if (arrWallets.length > 0)
			arrFuncs.push(function(cb){
				walletDefinedByKeys.forwardPrivateChainsToOtherMembersOfWallets(arrChains, arrWallets, conn, cb);
			});
		arrFuncs.push(function(cb){
			walletDefinedByAddresses.forwardPrivateChainsToOtherMembersOfAddresses(arrChains, arrOutputAddresses, conn, cb);
		});
		async.series(arrFuncs, onSaved);
	});
}

function readWalletsByAddresses(conn, arrAddresses, handleWallets){
	conn.query("SELECT DISTINCT wallet FROM my_addresses WHERE address IN(?)", [arrAddresses], function(rows){
		var arrWallets = rows.map(function(row){ return row.wallet; });
		conn.query("SELECT DISTINCT address FROM shared_address_signing_paths WHERE shared_address IN(?)", [arrAddresses], function(rows){
			if (rows.length === 0)
				return handleWallets(arrWallets);
			var arrNewAddresses = rows.map(function(row){ return row.address; });
			readWalletsByAddresses(conn, arrNewAddresses, function(arrNewWallets){
				handleWallets(_.union(arrWallets, arrNewWallets));
			});
		});
	});
}

// event emitted in two cases:
// 1. if I received private payloads via direct connection, not through a hub
// 2. (not true any more) received private payload from anywhere, didn't handle it immediately, saved and handled later
eventBus.on("new_direct_private_chains", forwardPrivateChainsToOtherMembersOfOutputAddresses);


function emitNewPrivatePaymentReceived(payer_device_address, arrChains, message_counter){
	console.log('emitNewPrivatePaymentReceived');
	walletGeneral.readMyAddresses(function(arrAddresses){
		var assocAmountsByAsset = {};
		var assocMyReceivingAddresses = {};
		arrChains.forEach(function(arrPrivateElements){
			var objHeadPrivateElement = arrPrivateElements[0];
			var payload = objHeadPrivateElement.payload;
			var asset = payload.asset || 'base';
			if (!assocAmountsByAsset[asset])
				assocAmountsByAsset[asset] = 0;
			payload.outputs.forEach(function(output){
				if (output.address && arrAddresses.indexOf(output.address) >= 0){
					assocAmountsByAsset[asset] += output.amount;
					assocMyReceivingAddresses[output.address] = true;
				}
			});
			// indivisible
			var output = objHeadPrivateElement.output;
			if (output && output.address && arrAddresses.indexOf(output.address) >= 0){
				assocAmountsByAsset[asset] += payload.outputs[objHeadPrivateElement.output_index].amount;
				assocMyReceivingAddresses[output.address] = true;
			}
		});
		console.log('assocAmountsByAsset', assocAmountsByAsset);
		var arrMyReceivingAddresses = Object.keys(assocMyReceivingAddresses);
		if (arrMyReceivingAddresses.length === 0)
			return;
		db.query("SELECT 1 FROM shared_addresses WHERE shared_address IN(?)", [arrMyReceivingAddresses], function(rows){
			var bToSharedAddress = (rows.length > 0);
			for (var asset in assocAmountsByAsset)
				if (assocAmountsByAsset[asset])
					eventBus.emit('received_payment', payer_device_address, assocAmountsByAsset[asset], asset, message_counter, bToSharedAddress);
		});
	});
}

function emitNewPublicPaymentReceived(payer_device_address, objUnit, message_counter){
	walletGeneral.readMyAddresses(function(arrAddresses){
		var assocAmountsByAsset = {};
		var assocMyReceivingAddresses = {};
		objUnit.messages.forEach(function(message){
			if (message.app !== 'payment' || !message.payload)
				return;
			var payload = message.payload;
			var asset = payload.asset || 'base';
			if (!assocAmountsByAsset[asset])
				assocAmountsByAsset[asset] = 0;
			payload.outputs.forEach(function(output){
				if (output.address && arrAddresses.indexOf(output.address) >= 0){
					assocAmountsByAsset[asset] += output.amount;
					assocMyReceivingAddresses[output.address] = true;
				}
			});
		});
		var arrMyReceivingAddresses = Object.keys(assocMyReceivingAddresses);
		if (arrMyReceivingAddresses.length === 0)
			return;
		db.query("SELECT 1 FROM shared_addresses WHERE shared_address IN(?)", [arrMyReceivingAddresses], function(rows){
			var bToSharedAddress = (rows.length > 0);
			for (var asset in assocAmountsByAsset)
				if (assocAmountsByAsset[asset])
					eventBus.emit('received_payment', payer_device_address, assocAmountsByAsset[asset], asset, message_counter, bToSharedAddress);
		});
	});
}


function findAddress(address, signing_path, callbacks, fallback_remote_device_address){
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
			//	"SELECT address, device_address, member_signing_path FROM shared_address_signing_paths WHERE shared_address=? AND signing_path=?", 
				// look for a prefix of the requested signing_path
				"SELECT address, device_address, signing_path FROM shared_address_signing_paths \n\
				WHERE shared_address=? AND signing_path=SUBSTR(?, 1, LENGTH(signing_path))", 
				[address, signing_path],
				function(sa_rows){
					if (rows.length > 1)
						throw Error("more than 1 member address found for shared address "+address+" and signing path "+signing_path);
					if (sa_rows.length === 0){
						if (fallback_remote_device_address)
							return callbacks.ifRemote(fallback_remote_device_address);
						return callbacks.ifUnknownAddress();
					}
					var objSharedAddress = sa_rows[0];
					var relative_signing_path = 'r' + signing_path.substr(objSharedAddress.signing_path.length);
					var bLocal = (objSharedAddress.device_address === device.getMyDeviceAddress()); // local keys
					if (objSharedAddress.address === '')
						return callbacks.ifMerkle(bLocal);
					findAddress(objSharedAddress.address, relative_signing_path, callbacks, bLocal ? null : objSharedAddress.device_address);
				}
			);
		}
	);
}

function readSharedBalance(wallet, handleBalance){
	balances.readSharedBalance(wallet, handleBalance);
}

function readBalance(wallet, handleBalance){
	balances.readBalance(wallet, function(assocBalances) {
		handleBalance(assocBalances);
		if (conf.bLight){ // make sure we have all asset definitions available
			var arrAssets = Object.keys(assocBalances).filter(function(asset){ return (asset !== 'base'); });
			if (arrAssets.length === 0)
				return;
			network.requestProofsOfJointsIfNewOrUnstable(arrAssets);
		}
	});
}

function readBalancesOnAddresses(walletId, handleBalancesOnAddresses) {
	db.query("SELECT outputs.address, COALESCE(outputs.asset, 'base') as asset, sum(outputs.amount) as amount \n\
	FROM outputs, my_addresses \n\
	WHERE outputs.address = my_addresses.address AND my_addresses.wallet = ? AND outputs.is_spent=0 \n\
	GROUP BY outputs.address, outputs.asset \n\
	ORDER BY my_addresses.address_index ASC", [walletId], function(rows) {
		handleBalancesOnAddresses(rows);
	});
}

function readAssetMetadata(arrAssets, handleMetadata){
	db.query("SELECT asset, metadata_unit, name, suffix, decimals FROM asset_metadata WHERE asset IN(?)", [arrAssets], function(rows){
		var assocAssetMetadata = {};
		for (var i=0; i<rows.length; i++){
			var row = rows[i];
			var asset = row.asset || "base";
			assocAssetMetadata[asset] = {
				metadata_unit: row.metadata_unit,
				decimals: row.decimals,
				name: row.suffix ? row.name+'.'+row.suffix : row.name
			};
		}
		handleMetadata(assocAssetMetadata);
		// after calling the callback, try to fetch missing data about assets
		arrAssets.forEach(function(asset){
			if (assocAssetMetadata[asset] || asset === 'base' && asset === constants.BLACKBYTES_ASSET)
				return;
			if ((assocLastFailedAssetMetadataTimestamps[asset] || 0) > Date.now() - ASSET_METADATA_RETRY_PERIOD)
				return;
			fetchAssetMetadata(asset, function(err, objMetadata){
				if (err)
					return console.log(err);
				assocAssetMetadata[asset] = {
					metadata_unit: objMetadata.metadata_unit,
					decimals: objMetadata.decimals,
					name: objMetadata.suffix ? objMetadata.name+'.'+objMetadata.suffix : objMetadata.name
				};
				eventBus.emit('maybe_new_transactions');
			});
		});
	});
}

function fetchAssetMetadata(asset, handleMetadata){
	device.requestFromHub('hub/get_asset_metadata', asset, function(err, response){
		if (err){
			if (err === 'no metadata')
				assocLastFailedAssetMetadataTimestamps[asset] = Date.now();
			return handleMetadata("error from get_asset_metadata "+asset+": "+err);
		}
		var metadata_unit = response.metadata_unit;
		var registry_address = response.registry_address;
		var suffix = response.suffix;
		if (!ValidationUtils.isStringOfLength(metadata_unit, constants.HASH_LENGTH))
			return handleMetadata("bad metadata_unit: "+metadata_unit);
		if (!ValidationUtils.isValidAddress(registry_address))
			return handleMetadata("bad registry_address: "+registry_address);
		var fetchMetadataUnit = conf.bLight 
			? function(onDone){
				network.requestProofsOfJointsIfNewOrUnstable([metadata_unit], onDone);
			}
			: function(onDone){
				onDone();
			};
		fetchMetadataUnit(function(err){
			if (err)
				return handleMetadata("fetchMetadataUnit failed: "+err);
			storage.readJoint(db, metadata_unit, {
				ifNotFound: function(){
					handleMetadata("metadata unit "+unit+" not found");
				},
				ifFound: function(objJoint){
					objJoint.unit.messages.forEach(function(message){
						if (message.app !== 'data')
							return;
						var payload = message.payload;
						if (payload.asset !== asset)
							return;
						if (!payload.name)
							return handleMetadata("no name in asset metadata "+metadata_unit);
						var decimals = (payload.decimals !== undefined) ? parseInt(payload.decimals) : undefined;
						if (decimals !== undefined && !ValidationUtils.isNonnegativeInteger(decimals))
							return handleMetadata("bad decimals in asset metadata "+metadata_unit);
						db.query(
							"INSERT "+db.getIgnore()+" INTO asset_metadata (asset, metadata_unit, registry_address, suffix, name, decimals) \n\
							VALUES (?,?,?, ?,?,?)",
							[asset, metadata_unit, registry_address, suffix, payload.name, decimals],
							function(){
								var objMetadata = {
									metadata_unit: metadata_unit,
									suffix: suffix,
									decimals: decimals,
									name: payload.name
								};
								handleMetadata(null, objMetadata);
							}
						);
					});
				}
			});
		});
	});
}

function readTransactionHistory(opts, handleHistory){
	var asset = opts.asset;
	if (opts.wallet && opts.address || !opts.wallet && !opts.address)
		throw Error('invalid wallet and address params');
	var wallet = opts.wallet || opts.address;
	var walletIsAddress = ValidationUtils.isValidAddress(wallet);
	var join_my_addresses = walletIsAddress ? "" : "JOIN my_addresses USING(address)";
	var where_condition = walletIsAddress ? "address=?" : "wallet=?";
	var asset_condition = (asset && asset !== "base") ? "asset="+db.escape(asset) : "asset IS NULL";
	var cross = "";
	if (opts.unit)
		where_condition += " AND unit="+db.escape(opts.unit);
	else if (opts.since_mci && ValidationUtils.isNonnegativeInteger(opts.since_mci)){
		where_condition += " AND main_chain_index>="+opts.since_mci;
		cross = "CROSS";
	}
	db.query(
		"SELECT unit, level, is_stable, sequence, address, \n\
			"+db.getUnixTimestamp("units.creation_date")+" AS ts, headers_commission+payload_commission AS fee, \n\
			SUM(amount) AS amount, address AS to_address, NULL AS from_address, main_chain_index AS mci \n\
		FROM units "+cross+" JOIN outputs USING(unit) "+join_my_addresses+" \n\
		WHERE "+where_condition+" AND "+asset_condition+" \n\
		GROUP BY unit, address \n\
		UNION \n\
		SELECT unit, level, is_stable, sequence, address, \n\
			"+db.getUnixTimestamp("units.creation_date")+" AS ts, headers_commission+payload_commission AS fee, \n\
			NULL AS amount, NULL AS to_address, address AS from_address, main_chain_index AS mci \n\
		FROM units "+cross+" JOIN inputs USING(unit) "+join_my_addresses+" \n\
		WHERE "+where_condition+" AND "+asset_condition+" \n\
		ORDER BY ts DESC"+(opts.limit ? " LIMIT ?" : ""),
		opts.limit ? [wallet, wallet, opts.limit] : [wallet, wallet],
		function(rows){
			var assocMovements = {};
			for (var i=0; i<rows.length; i++){
				var row = rows[i];
				//if (asset !== "base")
				//    row.fee = null;
				if (!assocMovements[row.unit])
					assocMovements[row.unit] = {
						plus:0, has_minus:false, ts: row.ts, level: row.level, is_stable: row.is_stable, sequence: row.sequence, fee: row.fee, mci: row.mci
					};
				if (row.to_address){
					assocMovements[row.unit].plus += row.amount;
				//	assocMovements[row.unit].my_address = row.to_address;
					if (!assocMovements[row.unit].arrMyRecipients)
						assocMovements[row.unit].arrMyRecipients = [];
					assocMovements[row.unit].arrMyRecipients.push({my_address: row.to_address, amount: row.amount})
				}
				if (row.from_address)
					assocMovements[row.unit].has_minus = true;
			}
		//	console.log(require('util').inspect(assocMovements));
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
							level: movement.level,
							mci: movement.mci
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
								movement.arrMyRecipients.forEach(function(objRecipient){
									var transaction = {
										action: 'received',
										amount: objRecipient.amount,
										my_address: objRecipient.my_address,
										arrPayerAddresses: arrPayerAddresses,
										confirmations: movement.is_stable,
										unit: unit,
										fee: movement.fee,
										time: movement.ts,
										level: movement.level,
										mci: movement.mci
									};
									arrTransactions.push(transaction);
								});
								cb();
							}
						);
					}
					else if (movement.has_minus){
						var queryString, parameters;
						queryString =   "SELECT outputs.address, SUM(outputs.amount) AS amount, ("
										+ ( walletIsAddress ? "outputs.address!=?" : "my_addresses.address IS NULL") + ") AS is_external, \n\
										sent_mnemonics.textAddress, sent_mnemonics.mnemonic, \n\
										(SELECT unit_authors.unit FROM unit_authors WHERE unit_authors.address = sent_mnemonics.address LIMIT 1) AS claiming_unit \n\
										FROM outputs "
										+ (walletIsAddress ? "" : "LEFT JOIN my_addresses ON outputs.address=my_addresses.address AND wallet=? ") +
										"LEFT JOIN sent_mnemonics USING(unit) \n\
										WHERE outputs.unit=? AND "+asset_condition+" \n\
										GROUP BY outputs.address";
						parameters = [wallet, unit];
						db.query(queryString, parameters, 
							function(payee_rows){
								var action = payee_rows.some(function(payee){ return payee.is_external; }) ? 'sent' : 'moved';
								if (payee_rows.length == 0) {
									cb();
									return;
								}
								var done = 0;
								payee_rows.forEach(function(payee) {
									if (action === 'sent' && !payee.is_external) {
										if (++done == payee_rows.length) cb();
										return;
									}

									var transaction = {
										action: action,
										amount: payee.amount,
										addressTo: payee.address,
										textAddress: ValidationUtils.isValidEmail(payee.textAddress) ? payee.textAddress : "",
										claimed: !!payee.claiming_unit,
										mnemonic: payee.mnemonic,
										confirmations: movement.is_stable,
										unit: unit,
										fee: movement.fee,
										time: movement.ts,
										level: movement.level,
										mci: movement.mci,
										isTextcoin: payee.textAddress ? true : false
									};
									if (action === 'moved')
										transaction.my_address = payee.address;
									if (transaction.claimed) {
										db.query(
											"SELECT (unit IS NOT NULL) AS claimed_by_me FROM outputs \n\
											JOIN ( \n\
												SELECT address FROM my_addresses \n\
												UNION SELECT shared_address AS address FROM shared_addresses \n\
											) USING (address) \n\
											WHERE outputs.unit=?", [payee.claiming_unit],
											function(rows) {
												transaction.claimedByMe = (rows.length > 0);
												arrTransactions.push(transaction);
												if (++done == payee_rows.length) cb();
											}
										);
									} else {
										arrTransactions.push(transaction);
										if (++done == payee_rows.length) cb();
									}
								});
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

// returns assoc array signing_path => (key|merkle)
function readFullSigningPaths(conn, address, arrSigningDeviceAddresses, handleSigningPaths){
	
	var assocSigningPaths = {};
	
	function goDeeper(member_address, path_prefix, onDone){
		// first, look for wallet addresses
		var sql = "SELECT signing_path FROM my_addresses JOIN wallet_signing_paths USING(wallet) WHERE address=?";
		var arrParams = [member_address];
		if (arrSigningDeviceAddresses && arrSigningDeviceAddresses.length > 0){
			sql += " AND device_address IN(?)";
			arrParams.push(arrSigningDeviceAddresses);
		}
		conn.query(sql, arrParams, function(rows){
			rows.forEach(function(row){
				assocSigningPaths[path_prefix + row.signing_path.substr(1)] = 'key';
			});
			if (rows.length > 0)
				return onDone();
			// next, look for shared addresses, and search from there recursively
			sql = "SELECT signing_path, address FROM shared_address_signing_paths WHERE shared_address=?";
			arrParams = [member_address];
			if (arrSigningDeviceAddresses && arrSigningDeviceAddresses.length > 0){
				sql += " AND device_address IN(?)";
				arrParams.push(arrSigningDeviceAddresses);
			}
			conn.query(sql, arrParams, function(rows){
				if(rows.length > 0) {
					async.eachSeries(
						rows,
						function (row, cb) {
							if (row.address === '') { // merkle
								assocSigningPaths[path_prefix + row.signing_path.substr(1)] = 'merkle';
								return cb();
							}

							goDeeper(row.address, path_prefix + row.signing_path.substr(1), cb);
						},
						onDone
					);
				} else {
					assocSigningPaths[path_prefix] = 'key';
					onDone();
				}
			});
		});
	}
	
	goDeeper(address, 'r', function(){
		handleSigningPaths(assocSigningPaths); // order of signing paths is not significant
	});
}

function determineIfFixedDenominations(asset, handleResult){
	if (!asset)
		return handleResult(false);
	storage.readAsset(db, asset, null, function(err, objAsset){
		if (err)
			throw Error(err);
		handleResult(objAsset.fixed_denominations);
	});
}

function readFundedAddresses(asset, wallet, estimated_amount, handleFundedAddresses){
	var walletIsAddresses = ValidationUtils.isNonemptyArray(wallet);
	if (walletIsAddresses)
		return composer.readSortedFundedAddresses(asset, wallet, estimated_amount, handleFundedAddresses);
	if (estimated_amount && typeof estimated_amount !== 'number')
		throw Error('invalid estimated amount: '+estimated_amount);
	// addresses closest to estimated amount come first
	var order_by = estimated_amount ? "(SUM(amount)>"+estimated_amount+") DESC, ABS(SUM(amount)-"+estimated_amount+") ASC" : "SUM(amount) DESC";
	db.query(
		"SELECT address, SUM(amount) AS total \n\
		FROM outputs JOIN my_addresses USING(address) \n\
		CROSS JOIN units USING(unit) \n\
		WHERE wallet=? AND is_stable=1 AND sequence='good' AND is_spent=0 AND "+(asset ? "asset=?" : "asset IS NULL")+" \n\
			AND NOT EXISTS ( \n\
				SELECT * FROM unit_authors JOIN units USING(unit) \n\
				WHERE is_stable=0 AND unit_authors.address=outputs.address AND definition_chash IS NOT NULL \n\
			) \n\
		GROUP BY address ORDER BY "+order_by,
		asset ? [wallet, asset] : [wallet],
		function(rows){
			determineIfFixedDenominations(asset, function(bFixedDenominations){
				if (bFixedDenominations)
					estimated_amount = 0; // don't shorten the list of addresses, indivisible_asset.js will do it later according to denominations
				handleFundedAddresses(composer.filterMostFundedAddresses(rows, estimated_amount));
			});
			/*if (arrFundedAddresses.length === 0)
				return handleFundedAddresses([]);
			if (!asset)
				return handleFundedAddresses(arrFundedAddresses);
			readFundedAddresses(null, wallet, function(arrBytesFundedAddresses){
				handleFundedAddresses(_.union(arrFundedAddresses, arrBytesFundedAddresses));
			});*/
		}
	);
}

function readAdditionalSigningAddresses(arrPayingAddresses, arrSigningAddresses, arrSigningDeviceAddresses, handleAdditionalSigningAddresses){
	var arrFromAddresses = arrPayingAddresses.concat(arrSigningAddresses);
	var sql = "SELECT DISTINCT address FROM shared_address_signing_paths \n\
		WHERE shared_address IN(?) \n\
			AND ( \n\
				EXISTS (SELECT 1 FROM my_addresses WHERE my_addresses.address=shared_address_signing_paths.address) \n\
				OR \n\
				EXISTS (SELECT 1 FROM shared_addresses WHERE shared_addresses.shared_address=shared_address_signing_paths.address) \n\
			) \n\
			AND ( \n\
				NOT EXISTS (SELECT 1 FROM addresses WHERE addresses.address=shared_address_signing_paths.address) \n\
				OR ( \n\
					SELECT definition \n\
					FROM address_definition_changes CROSS JOIN units USING(unit) LEFT JOIN definitions USING(definition_chash) \n\
					WHERE address_definition_changes.address=shared_address_signing_paths.address AND is_stable=1 AND sequence='good' \n\
					ORDER BY level DESC LIMIT 1 \n\
				) IS NULL \n\
			)";
	var arrParams = [arrFromAddresses];
	if (arrSigningAddresses.length > 0){
		sql += " AND address NOT IN(?)";
		arrParams.push(arrSigningAddresses);
	}
	if (arrSigningDeviceAddresses && arrSigningDeviceAddresses.length > 0){
		sql += " AND device_address IN(?)";
		arrParams.push(arrSigningDeviceAddresses);
	}
	db.query(
		sql, 
		arrParams,
		function(rows){
			var arrAdditionalAddresses = rows.map(function(row){ return row.address; });
			if (arrAdditionalAddresses.length === 0)
				return handleAdditionalSigningAddresses([]);
			readAdditionalSigningAddresses([], arrSigningAddresses.concat(arrAdditionalAddresses), arrSigningDeviceAddresses, function(arrMoreAddresses){
				handleAdditionalSigningAddresses(arrAdditionalAddresses.concat(arrMoreAddresses));
			});
		}
	);
}

var TYPICAL_FEE = 1000;

// fee_paying_wallet is used only if there are no bytes on the asset wallet, it is a sort of fallback wallet for fees
function readFundedAndSigningAddresses(
		asset, wallet, estimated_amount, fee_paying_wallet, arrSigningAddresses, arrSigningDeviceAddresses, handleFundedAndSigningAddresses)
{
	readFundedAddresses(asset, wallet, estimated_amount, function(arrFundedAddresses){
		if (arrFundedAddresses.length === 0)
			return handleFundedAndSigningAddresses([], [], []);
		var arrBaseFundedAddresses = [];
		var addSigningAddressesAndReturn = function(){
			var arrPayingAddresses = _.union(arrFundedAddresses, arrBaseFundedAddresses);
			readAdditionalSigningAddresses(arrPayingAddresses, arrSigningAddresses, arrSigningDeviceAddresses, function(arrAdditionalAddresses){
				handleFundedAndSigningAddresses(arrFundedAddresses, arrBaseFundedAddresses, arrSigningAddresses.concat(arrAdditionalAddresses));
			});
		};
		if (!asset)
			return addSigningAddressesAndReturn();
		readFundedAddresses(null, wallet, TYPICAL_FEE, function(_arrBaseFundedAddresses){
			// fees will be paid from the same addresses as the asset
			if (_arrBaseFundedAddresses.length > 0 || !fee_paying_wallet || fee_paying_wallet === wallet){
				arrBaseFundedAddresses = _arrBaseFundedAddresses;
				return addSigningAddressesAndReturn();
			}
			readFundedAddresses(null, fee_paying_wallet, TYPICAL_FEE, function(_arrBaseFundedAddresses){
				arrBaseFundedAddresses = _arrBaseFundedAddresses;
				addSigningAddressesAndReturn();
			});
		});
	});
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
	if (asset === 'base')
		asset = null;
	var wallet = opts.wallet;
	var arrPayingAddresses = opts.paying_addresses;
	var fee_paying_wallet = opts.fee_paying_wallet;
	var arrSigningAddresses = opts.signing_addresses || [];
	var to_address = opts.to_address;
	var amount = opts.amount;
	var bSendAll = opts.send_all;
	var change_address = opts.change_address;
	var arrSigningDeviceAddresses = opts.arrSigningDeviceAddresses;
	var recipient_device_address = opts.recipient_device_address;
	var signWithLocalPrivateKey = opts.signWithLocalPrivateKey;
	var merkle_proof = opts.merkle_proof;
	
	var base_outputs = opts.base_outputs;
	var asset_outputs = opts.asset_outputs;
	var messages = opts.messages;
	var insecureSendAsk = opts.insecure_send_ask;
	
	if (!wallet && !arrPayingAddresses)
		throw Error("neither wallet id nor paying addresses");
	if (wallet && arrPayingAddresses)
		throw Error("both wallet id and paying addresses");
	if ((to_address || amount) && (base_outputs || asset_outputs))
		throw Error('to_address and outputs at the same time');
	if (!asset && asset_outputs)
		throw Error('base asset and asset outputs');
	if (amount){
		if (typeof amount !== 'number')
			throw Error('amount must be a number');
		if (amount < 0)
			throw Error('amount must be positive');
	}
	
	if (recipient_device_address === device.getMyDeviceAddress())
		recipient_device_address = null;
	
	var estimated_amount = amount;
	if (!estimated_amount && asset_outputs)
		estimated_amount = asset_outputs.reduce(function(acc, output){ return acc+output.amount; }, 0);
	if (estimated_amount && !asset)
		estimated_amount += TYPICAL_FEE;
	
	readFundedAndSigningAddresses(
		asset, wallet || arrPayingAddresses, estimated_amount, fee_paying_wallet, arrSigningAddresses, arrSigningDeviceAddresses, 
		function(arrFundedAddresses, arrBaseFundedAddresses, arrAllSigningAddresses){
		
			if (arrFundedAddresses.length === 0)
				return handleResult("There are no funded addresses");
			if (asset && arrBaseFundedAddresses.length === 0)
				return handleResult("No bytes to pay fees");

			var bRequestedConfirmation = false;
			var signer = {
				readSigningPaths: function(conn, address, handleLengthsBySigningPaths){ // returns assoc array signing_path => length
					readFullSigningPaths(conn, address, arrSigningDeviceAddresses, function(assocTypesBySigningPaths){
						var assocLengthsBySigningPaths = {};
						for (var signing_path in assocTypesBySigningPaths){
							var type = assocTypesBySigningPaths[signing_path];
							if (type === 'key')
								assocLengthsBySigningPaths[signing_path] = constants.SIG_LENGTH;
							else if (type === 'merkle'){
								if (merkle_proof)
									assocLengthsBySigningPaths[signing_path] = merkle_proof.length;
							}
							else
								throw Error("unknown type "+type+" at "+signing_path);
						}
						handleLengthsBySigningPaths(assocLengthsBySigningPaths);
					});
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
							throw Error("unknown address "+address+" at "+signing_path);
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
						},
						ifMerkle: function(bLocal){
							if (!bLocal)
								throw Error("merkle proof at path "+signing_path+" should be provided by another device");
							if (!merkle_proof)
								throw Error("merkle proof at path "+signing_path+" not provided");
							handleSignature(null, merkle_proof);
						}
					});
				}
			};

			// if we have any output with text addresses / not byteball addresses (e.g. email) - generate new addresses and return them
			var assocMnemonics = {}; // return all generated wallet mnemonics to caller in callback
			var assocEmails = {}; // wallet mnemonics to send by emails
			var assocAddresses = {};
			var prefix = "textcoin:";
			function generateNewMnemonicIfNoAddress(outputs) {
				var generated = 0;
				outputs.forEach(function(output){
					if (output.address.indexOf(prefix) !== 0)
						return false;
					var address = output.address.slice(prefix.length);
					var mnemonic = new Mnemonic();
					while (!Mnemonic.isValid(mnemonic.toString()))
						mnemonic = new Mnemonic();
					if (!opts.do_not_email && ValidationUtils.isValidEmail(address)) {
						assocEmails[address] = mnemonic.toString();
					}
					assocMnemonics[output.address] = mnemonic.toString().replace(/ /g, "-");
					var pubkey = mnemonic.toHDPrivateKey().derive("m/44'/0'/0'/0/0").publicKey.toBuffer().toString("base64");
					assocAddresses[output.address] = objectHash.getChash160(["sig", {"pubkey": pubkey}]);
					output.address = assocAddresses[output.address];
					generated++;
				});
				return generated;
			}
			if (to_address) {
				var to_address_output = {address: to_address};
				var cnt = generateNewMnemonicIfNoAddress([to_address_output]);
				if (cnt) to_address = to_address_output.address;
			}
			if (base_outputs) generateNewMnemonicIfNoAddress(base_outputs);
			if (asset_outputs) generateNewMnemonicIfNoAddress(asset_outputs);

			var params = {
				available_paying_addresses: arrFundedAddresses, // forces 'minimal' for payments from shared addresses too, it doesn't hurt
				signing_addresses: arrAllSigningAddresses,
				messages: messages, 
				signer: signer, 
				callbacks: {
					ifNotEnoughFunds: function(err){
						handleResult(err);
					},
					ifError: function(err){
						handleResult(err);
					},
					preCommitCb: function(conn, objJoint, cb){
						var i = 0;
						if (Object.keys(assocMnemonics).length) {
							for (var to in assocMnemonics) {
								conn.query("INSERT INTO sent_mnemonics (unit, address, mnemonic, textAddress) VALUES (?, ?, ?, ?)", [objJoint.unit.unit, assocAddresses[to], assocMnemonics[to], to.slice(prefix.length)],
								function(){
									if (++i == Object.keys(assocMnemonics).length) { // stored all mnemonics
										cb();
									}
								});
							}
						} else 
							cb();
					},
					// for asset payments, 2nd argument is array of chains of private elements
					// for base asset, 2nd argument is assocPrivatePayloads which is null
					ifOk: function(objJoint, arrChainsOfRecipientPrivateElements, arrChainsOfCosignerPrivateElements){
						network.broadcastJoint(objJoint);
						if (!arrChainsOfRecipientPrivateElements && recipient_device_address) // send notification about public payment
							walletGeneral.sendPaymentNotification(recipient_device_address, objJoint.unit.unit);

						if (Object.keys(assocEmails).length) { // need to send emails
							var sent = 0;
							var mail = require('./mail'+'');
							for (var email in assocEmails) {
								mail.sendSMTPEmail(email, {mnemonic: assocEmails[email], amount: amount, asset: (asset ? asset : 'bytes')}, function(err, msgInfo){
									if (err && (err.code == "ETLS" || err.message.indexOf("certificate") > -1)) {
										if (typeof insecureSendAsk !== "function")
											insecureSendAsk = function(email, answer){answer(true)};
										insecureSendAsk(email, function(answer){
											if (answer) {
												mail.sendSMTPEmail(email, {mnemonic: assocEmails[email], amount: amount, asset: (asset ? asset : 'bytes')}, function(){}, true);
											}
										});
									}
									if (++sent == Object.keys(assocEmails).length) {
										handleResult(null, objJoint.unit.unit, assocMnemonics);
									}
								});
							}
						} else {
							handleResult(null, objJoint.unit.unit, assocMnemonics);
						}
					}
				}
			};

			if (asset){
				if (bSendAll)
					throw Error('send_all with asset');
				params.asset = asset;
				params.available_fee_paying_addresses = arrBaseFundedAddresses;
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
				//	if (objAsset.is_private && !recipient_device_address)
				//		return handleResult("for private asset, need recipient's device address to send private payload to");
					if (objAsset.is_private){
						// save messages in outbox before committing
						params.callbacks.preCommitCb = function(conn, arrChainsOfRecipientPrivateElements, arrChainsOfCosignerPrivateElements, cb){
							if (!arrChainsOfRecipientPrivateElements || !arrChainsOfCosignerPrivateElements)
								throw Error('no private elements');
							var sendToRecipients = function(cb2){
								if (recipient_device_address)
									walletGeneral.sendPrivatePayments(recipient_device_address, arrChainsOfRecipientPrivateElements, false, conn, cb2);
								else // paying to another wallet on the same device
									forwardPrivateChainsToOtherMembersOfOutputAddresses(arrChainsOfRecipientPrivateElements, conn, cb2);
							};
							var sendToCosigners = function(cb2){
								if (wallet)
									walletDefinedByKeys.forwardPrivateChainsToOtherMembersOfWallets(arrChainsOfCosignerPrivateElements, [wallet], conn, cb2);
								else // arrPayingAddresses can be only shared addresses
									forwardPrivateChainsToOtherMembersOfSharedAddresses(arrChainsOfCosignerPrivateElements, arrPayingAddresses, null, false, conn, cb2);
							};
							async.series([sendToRecipients, sendToCosigners], cb);
						};
					}
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
				if (bSendAll){
					params.send_all = bSendAll;
					params.outputs = [{address: to_address, amount: 0}];
				}
				else{
					params.outputs = to_address ? [{address: to_address, amount: amount}] : (base_outputs || []);
					params.outputs.push({address: change_address, amount: 0});
				}
				composer.composeAndSaveMinimalJoint(params);
			}

		}
	);
}

function forwardPrivateChainsToOtherMembersOfSharedAddresses(arrChainsOfCosignerPrivateElements, arrPayingAddresses, excluded_device_address, bForwarded, conn, onDone){
	walletDefinedByAddresses.readAllControlAddresses(conn, arrPayingAddresses, function(arrControlAddresses, arrControlDeviceAddresses){
		arrControlDeviceAddresses = arrControlDeviceAddresses.filter(function(device_address) {
			return (device_address !== device.getMyDeviceAddress() && device_address !== excluded_device_address);
		});
		walletDefinedByKeys.readDeviceAddressesControllingPaymentAddresses(conn, arrControlAddresses, function(arrMultisigDeviceAddresses){
			arrMultisigDeviceAddresses = _.difference(arrMultisigDeviceAddresses, arrControlDeviceAddresses);
			// counterparties on shared addresses must forward further, that's why bForwarded=false
			walletGeneral.forwardPrivateChainsToDevices(arrControlDeviceAddresses, arrChainsOfCosignerPrivateElements, bForwarded, conn, function(){
				walletGeneral.forwardPrivateChainsToDevices(arrMultisigDeviceAddresses, arrChainsOfCosignerPrivateElements, true, conn, onDone);
			});
		});
	});
}

function receiveTextCoin(mnemonic, addressTo, cb) {
	mnemonic = mnemonic.toLowerCase().split('-').join(' ');
	if ((mnemonic.split(' ').length % 3 !== 0) || !Mnemonic.isValid(mnemonic)) {
		return cb("invalid mnemonic");
	}
	var mnemonic = new Mnemonic(mnemonic);
	try {
		var xPrivKey = mnemonic.toHDPrivateKey().derive("m/44'/0'/0'/0/0");
		var pubkey = xPrivKey.publicKey.toBuffer().toString("base64");
	} catch (e) {
		cb(e.message);
		return;
	}
	var definition = ["sig", {"pubkey": pubkey}];
	var address = objectHash.getChash160(definition);
	var signer = {
		readSigningPaths: function(conn, address, handleLengthsBySigningPaths){ // returns assoc array signing_path => length
			var assocLengthsBySigningPaths = {};
			assocLengthsBySigningPaths["r"] = constants.SIG_LENGTH;
			handleLengthsBySigningPaths(assocLengthsBySigningPaths);
		},
		readDefinition: function(conn, address, handleDefinition){
			handleDefinition(null, definition);
		},
		sign: function(objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature){
			handleSignature(null, ecdsaSig.sign(objectHash.getUnitHashToSign(objUnsignedUnit), xPrivKey.privateKey.bn.toBuffer({size:32})));
		}
	};
	var opts = {};
	opts.signer = signer;
	opts.send_all = true;
	opts.outputs = [{address: addressTo, amount: 0}];
	opts.paying_addresses = [address];
 	opts.callbacks = composer.getSavingCallbacks({
		ifNotEnoughFunds: function(err){
			cb("This textcoin was already claimed");
		},
		ifError: function(err){
			if (err.indexOf("some definition changes") == 0)
				return cb("This textcoin was already claimed but not confirmed yet");
			cb(err);
		},
		ifOk: function(objJoint, arrChainsOfRecipientPrivateElements, arrChainsOfCosignerPrivateElements){
			network.broadcastJoint(objJoint);
			cb(null, objJoint.unit.unit);
		}
	});


	if (conf.bLight) {
		db.query(
			"SELECT 1 \n\
			FROM outputs JOIN units USING(unit) WHERE address=? LIMIT 1", 
			[address],
			function(rows){
				if (rows.length === 0) {
					network.requestHistoryFor([], [address], function(){
						checkStability();
					});
				}
				else
					checkStability();
			}
		);
	}
	else
		checkStability();

	// check stability of payingAddresses
	function checkStability() {
		db.query(
			"SELECT is_stable \n\
			FROM outputs JOIN units USING(unit) WHERE address=? AND sequence='good' LIMIT 1", 
			[address],
			function(rows){
				if (rows.length === 0) {
					cb("This payment doesn't exist in the network");
				} else {
					if (!rows[0].is_stable) {
						cb("This payment is not confirmed yet, try again later");
					} else {
						composer.composeJoint(opts);
					}
				}
			}
		);		
	}
}

function eraseTextcoin(unit, address) {
	db.query(
		"UPDATE sent_mnemonics \n\
		SET mnemonic='' WHERE unit=? AND address=?", 
		[unit, address],
		function(){}
	);
}

function readDeviceAddressesUsedInSigningPaths(onDone){

	var sql = "SELECT DISTINCT device_address FROM shared_address_signing_paths ";
	sql += "UNION SELECT DISTINCT device_address FROM wallet_signing_paths ";
	sql += "UNION SELECT DISTINCT device_address FROM pending_shared_address_signing_paths";
	
	db.query(
		sql, 
		function(rows){
			
			var arrDeviceAddress = rows.map(function(r) { return r.device_address; });

			onDone(arrDeviceAddress);
		}
	);
}

function determineIfDeviceCanBeRemoved(device_address, handleResult) {
	device.readCorrespondent(device_address, function(correspondent){
		if (!correspondent)
			return handleResult(false);
		readDeviceAddressesUsedInSigningPaths(function(arrDeviceAddresses){
			handleResult(arrDeviceAddresses.indexOf(device_address) === -1);
		});
	});
};


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
exports.readBalancesOnAddresses = readBalancesOnAddresses;
exports.readAssetMetadata = readAssetMetadata;
exports.readTransactionHistory = readTransactionHistory;
exports.sendPaymentFromWallet = sendPaymentFromWallet;
exports.sendMultiPayment = sendMultiPayment;
exports.readDeviceAddressesUsedInSigningPaths = readDeviceAddressesUsedInSigningPaths;
exports.determineIfDeviceCanBeRemoved = determineIfDeviceCanBeRemoved;
exports.receiveTextCoin = receiveTextCoin;
exports.eraseTextcoin = eraseTextcoin;
