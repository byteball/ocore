/*jslint node: true */
const async = require('async');
const _ = require('lodash');
const db = require('./db.js');
const constants = require('./constants.js');
const conf = require('./conf.js');
const mutex = require('./mutex.js');
const objectHash = require('./object_hash.js');
const ecdsaSig = require('./signature.js');
const network = require('./network.js');
const storage = require('./storage.js');
const device = require('./device.js');
const walletGeneral = require('./wallet_general.js');
const lightWallet = require('./light_wallet.js');
const walletDefinedByKeys = require('./wallet_defined_by_keys.js');
const walletDefinedByAddresses = require('./wallet_defined_by_addresses.js');
const eventBus = require('./event_bus.js');
const ValidationUtils = require("./validation_utils.js");
const composer = require('./composer.js');
const indivisibleAsset = require('./indivisible_asset.js');
const divisibleAsset = require('./divisible_asset.js');
const profiler = require('./profiler.js');
const breadcrumbs = require('./breadcrumbs.js');
const balances = require('./balances');
const Mnemonic = require('bitcore-mnemonic');

let message_counter = 0;
const assocLastFailedAssetMetadataTimestamps = {};
const ASSET_METADATA_RETRY_PERIOD = 3600*1000;

function handleJustsaying(ws, subject, body){
	switch (subject){
		// I'm connected to a hub, received challenge
		case 'hub/challenge':
			const challenge = body;
			device.handleChallenge(ws, challenge);
			break;
			
		// I'm connected to a hub, received a message through the hub
		case 'hub/message':
			const objDeviceMessage = body.message;
			const message_hash = body.message_hash;
			const respondWithError = error => {
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
			const json = device.decryptPackage(objDeviceMessage.encrypted_package);
			if (!json)
				return respondWithError("failed to decrypt");
			
			// who is the sender
			const from_address = objectHash.getDeviceAddress(objDeviceMessage.pubkey);
			// the hub couldn't mess with json.from as it was encrypted, but it could replace the objDeviceMessage.pubkey and re-sign. It'll be caught here
			if (from_address !== json.from) 
				return respondWithError("wrong message signature");
			
			const handleMessage = bIndirectCorrespondent => {
				// serialize all messages from hub
				mutex.lock(["from_hub"], unlock => {
					handleMessageFromHub(ws, json, objDeviceMessage.pubkey, bIndirectCorrespondent, {
						ifError(err) {
							respondWithError(err);
							unlock();
						},
						ifOk() {
							network.sendJustsaying(ws, 'hub/delete', message_hash);
							unlock();
						}
					});
				});
			};
			// check that we know this device
			db.query("SELECT hub, is_indirect FROM correspondent_devices WHERE device_address=?", [from_address], rows => {
				if (rows.length > 0){
					if (json.device_hub && json.device_hub !== rows[0].hub) // update correspondent's home address if necessary
						db.query("UPDATE correspondent_devices SET hub=? WHERE device_address=?", [json.device_hub, from_address], () => {
							handleMessage(rows[0].is_indirect);
						});
					else
						handleMessage(rows[0].is_indirect);
				}
				else{ // correspondent not known
					const arrSubjectsAllowedFromNoncorrespondents = ["pairing", "my_xpubkey", "wallet_fully_approved"];
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
	device.sendMessageToDevice(device_address, "signature", {signed_text, signature, signing_path, address});
}

// one of callbacks MUST be called, otherwise the mutex will stay locked
function handleMessageFromHub(ws, json, device_pubkey, bIndirectCorrespondent, callbacks){
	const subject = json.subject;
	const body = json.body;
	if (!subject || typeof body == "undefined")
		return callbacks.ifError("no subject or body");
	//if (bIndirectCorrespondent && ["cancel_new_wallet", "my_xpubkey", "new_wallet_address"].indexOf(subject) === -1)
	//    return callbacks.ifError("you're indirect correspondent, cannot trust "+subject+" from you");
	const from_address = objectHash.getDeviceAddress(device_pubkey);
	
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
				callbacks.ifError(`removed_paired_device ignored: ${from_address}`);
			} else {
				determineIfDeviceCanBeRemoved(from_address, bRemovable => {
					if (!bRemovable)
						return callbacks.ifError(`device ${from_address} is not removable`);
					device.removeCorrespondentDevice(from_address, () => {
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
			walletDefinedByKeys.addNewAddress(body.wallet, body.is_change, body.address_index, body.address, err => {
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
				(err, assocMemberDeviceAddressesBySigningPaths) => {
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
				ifOk() {
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
			const objUnit = body.unsigned_unit;
			if (typeof objUnit !== "object")
				return callbacks.ifError("no unsigned unit");
			// replace all existing signatures with placeholders so that signing requests sent to us on different stages of signing become identical,
			// hence the hashes of such unsigned units are also identical
			objUnit.authors.forEach(author => {
				const authentifiers = author.authentifiers;
				for (const path in authentifiers)
					authentifiers[path] = authentifiers[path].replace(/./, '-'); 
			});
			const assocPrivatePayloads = body.private_payloads;
			if ("private_payloads" in body){
				if (typeof assocPrivatePayloads !== "object" || !assocPrivatePayloads)
					return callbacks.ifError("bad private payloads");
				for (const payload_hash in assocPrivatePayloads){
					const payload = assocPrivatePayloads[payload_hash];
					const hidden_payload = _.cloneDeep(payload);
					if (payload.denomination) // indivisible asset.  In this case, payload hash is calculated based on output_hash rather than address and blinding
						hidden_payload.outputs.forEach(({address, blinding}) => {
							delete address;
							delete blinding;
						});
					const calculated_payload_hash = objectHash.getBase64Hash(hidden_payload);
					if (payload_hash !== calculated_payload_hash)
						return callbacks.ifError("private payload hash does not match");
					if (!ValidationUtils.isNonemptyArray(objUnit.messages))
						return callbacks.ifError("no messages in unsigned unit");
					if (objUnit.messages.filter(objMessage => objMessage.payload_hash === payload_hash).length !== 1)
						return callbacks.ifError("no such payload hash in the messages");
				}
			}
			// findAddress handles both types of addresses
			findAddress(body.address, body.signing_path, {
				ifError: callbacks.ifError,
				ifLocal(objAddress) {
					// the commented check would make multilateral signing impossible
					//db.query("SELECT 1 FROM extended_pubkeys WHERE wallet=? AND device_address=?", [row.wallet, from_address], function(sender_rows){
					//    if (sender_rows.length !== 1)
					//        return callbacks.ifError("sender is not cosigner of this address");
						callbacks.ifOk();
						objUnit.unit = objectHash.getUnitHash(objUnit);
						const objJoint = {unit: objUnit, unsigned: true};
						eventBus.once(`validated-${objUnit.unit}`, bValid => {
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
				ifRemote(device_address) {
					if (device_address === from_address){
						callbacks.ifError(`looping signing request for address ${body.address}, path ${body.signing_path}`);
						throw Error(`looping signing request for address ${body.address}, path ${body.signing_path}`);
					}
					const text_to_sign = objectHash.getUnitHashToSign(body.unsigned_unit).toString("base64");
					// I'm a proxy, wait for response from the actual signer and forward to the requestor
					eventBus.once(`signature-${device_address}-${body.address}-${body.signing_path}-${text_to_sign}`, sig => {
						sendSignature(from_address, text_to_sign, sig, body.signing_path, body.address);
					});
					// forward the offer to the actual signer
					device.sendMessageToDevice(device_address, subject, body);
					callbacks.ifOk();
				},
				ifMerkle(bLocal) {
					callbacks.ifError(`there is merkle proof at signing path ${body.signing_path}`);
				},
				ifUnknownAddress() {
					callbacks.ifError(`not aware of address ${body.address} but will see if I learn about it later`);
					eventBus.once(`new_address-${body.address}`, () => {
						// rewrite callbacks to avoid duplicate unlocking of mutex
						handleMessageFromHub(ws, json, device_pubkey, bIndirectCorrespondent, { ifOk() {}, ifError() {} });
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
			eventBus.emit(`signature-${from_address}-${body.address}-${body.signing_path}-${body.signed_text}`, body.signature);
			callbacks.ifOk();
			break;
			
		case 'private_payments':
			const arrChains = body.chains;
			if (!ValidationUtils.isNonemptyArray(arrChains))
				return callbacks.ifError("no chains found");
			profiler.increment();
			
			if (conf.bLight)
				network.requestUnfinishedPastUnitsOfPrivateChains(arrChains); // it'll work in the background
			
			let assocValidatedByKey = {};
			let bParsingComplete = false;
			const cancelAllKeys = () => {
				for (const key in assocValidatedByKey)
					eventBus.removeAllListeners(key);
			};

			var current_message_counter = ++message_counter;

			const checkIfAllValidated = () => {
				if (!assocValidatedByKey) // duplicate call - ignore
					return console.log('duplicate call of checkIfAllValidated');
				for (const key in assocValidatedByKey)
					if (!assocValidatedByKey[key])
						return console.log('not all private payments validated yet');
				assocValidatedByKey = null; // to avoid duplicate calls
				if (!body.forwarded){
					emitNewPrivatePaymentReceived(from_address, arrChains, current_message_counter);
					// note, this forwarding won't work if the user closes the wallet before validation of the private chains
					const arrUnits = arrChains.map(arrPrivateElements => arrPrivateElements[0].unit);
					db.query("SELECT address FROM unit_authors WHERE unit IN(?)", [arrUnits], rows => {
						const arrAuthorAddresses = rows.map(({address}) => address);
						// if the addresses are not shared, it doesn't forward anything
						forwardPrivateChainsToOtherMembersOfSharedAddresses(arrChains, arrAuthorAddresses, from_address, true);
					});
				}
				profiler.print();
			};
			
			async.eachSeries(
				arrChains,
				(arrPrivateElements, cb) => { // validate each chain individually
					const objHeadPrivateElement = arrPrivateElements[0];
					if (!!objHeadPrivateElement.payload.denomination !== ValidationUtils.isNonnegativeInteger(objHeadPrivateElement.output_index))
						return cb("divisibility doesn't match presence of output_index");
					const output_index = objHeadPrivateElement.payload.denomination ? objHeadPrivateElement.output_index : -1;
					const payload_hash = objectHash.getBase64Hash(objHeadPrivateElement.payload);
					const key = `private_payment_validated-${objHeadPrivateElement.unit}-${payload_hash}-${output_index}`;
					assocValidatedByKey[key] = false;
					network.handleOnlinePrivatePayment(ws, arrPrivateElements, true, {
						ifError(error) {
							console.log(`handleOnlinePrivatePayment error: ${error}`);
							cb("an error"); // do not leak error message to the hub
						},
						ifValidationError(unit, error) {
							console.log(`handleOnlinePrivatePayment validation error: ${error}`);
							cb("an error"); // do not leak error message to the hub
						},
						ifAccepted(unit) {
							console.log("handleOnlinePrivatePayment accepted");
							assocValidatedByKey[key] = true;
							cb(); // do not leak unit info to the hub
						},
						// this is the most likely outcome for light clients
						ifQueued() {
							console.log(`handleOnlinePrivatePayment queued, will wait for ${key}`);
							eventBus.once(key, bValid => {
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
				err => {
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
			const unit = body;
			if (!ValidationUtils.isStringOfLength(unit, constants.HASH_LENGTH))
				return callbacks.ifError("invalid unit in payment notification");
			let bEmitted = false;
			const emitPn = objJoint => {
				if (bEmitted)
					return;
				bEmitted = true;
				emitNewPublicPaymentReceived(from_address, objJoint.unit, current_message_counter);
			};
			eventBus.once(`saved_unit-${unit}`, emitPn);
			storage.readJoint(db, unit, {
				ifNotFound() {
					console.log(`received payment notification for unit ${unit} which is not known yet, will wait for it`);
					callbacks.ifOk();
				},
				ifFound(objJoint) {
					emitPn(objJoint);
					eventBus.removeListener(`saved_unit-${unit}`, emitPn);
					callbacks.ifOk();
				}
			});
			break;
			
		default:
			callbacks.ifError(`unknnown subject: ${subject}`);
	}
}


function forwardPrivateChainsToOtherMembersOfOutputAddresses(arrChains, conn, onSaved){
	console.log("forwardPrivateChainsToOtherMembersOfOutputAddresses", arrChains);
	const assocOutputAddresses = {};
	arrChains.forEach(arrPrivateElements => {
		const objHeadPrivateElement = arrPrivateElements[0];
		const payload = objHeadPrivateElement.payload;
		payload.outputs.forEach(({address}) => {
			if (address)
				assocOutputAddresses[address] = true;
		});
		if (objHeadPrivateElement.output && objHeadPrivateElement.output.address)
			assocOutputAddresses[objHeadPrivateElement.output.address] = true;
	});
	const arrOutputAddresses = Object.keys(assocOutputAddresses);
	console.log("output addresses", arrOutputAddresses);
	conn = conn || db;
	if (!onSaved)
		onSaved = () => {};
	readWalletsByAddresses(conn, arrOutputAddresses, arrWallets => {
		if (arrWallets.length === 0){
		//	breadcrumbs.add("forwardPrivateChainsToOtherMembersOfOutputAddresses: " + JSON.stringify(arrChains)); // remove in livenet
			eventBus.emit('nonfatal_error', `not my wallet? output addresses: ${arrOutputAddresses.join(', ')}`, new Error());
		//	throw Error("not my wallet? output addresses: "+arrOutputAddresses.join(', '));
		}
		const arrFuncs = [];
		if (arrWallets.length > 0)
			arrFuncs.push(cb => {
				walletDefinedByKeys.forwardPrivateChainsToOtherMembersOfWallets(arrChains, arrWallets, conn, cb);
			});
		arrFuncs.push(cb => {
			walletDefinedByAddresses.forwardPrivateChainsToOtherMembersOfAddresses(arrChains, arrOutputAddresses, conn, cb);
		});
		async.series(arrFuncs, onSaved);
	});
}

function readWalletsByAddresses(conn, arrAddresses, handleWallets){
	conn.query("SELECT DISTINCT wallet FROM my_addresses WHERE address IN(?)", [arrAddresses], rows => {
		const arrWallets = rows.map(({wallet}) => wallet);
		conn.query("SELECT DISTINCT address FROM shared_address_signing_paths WHERE shared_address IN(?)", [arrAddresses], rows => {
			if (rows.length === 0)
				return handleWallets(arrWallets);
			const arrNewAddresses = rows.map(({address}) => address);
			readWalletsByAddresses(conn, arrNewAddresses, arrNewWallets => {
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
	walletGeneral.readMyAddresses(arrAddresses => {
		const assocAmountsByAsset = {};
		const assocMyReceivingAddresses = {};
		arrChains.forEach(arrPrivateElements => {
			const objHeadPrivateElement = arrPrivateElements[0];
			const payload = objHeadPrivateElement.payload;
			const asset = payload.asset || 'base';
			if (!assocAmountsByAsset[asset])
				assocAmountsByAsset[asset] = 0;
			payload.outputs.forEach(({address, amount}) => {
				if (address && arrAddresses.indexOf(address) >= 0){
					assocAmountsByAsset[asset] += amount;
					assocMyReceivingAddresses[address] = true;
				}
			});
			// indivisible
			const output = objHeadPrivateElement.output;
			if (output && output.address && arrAddresses.indexOf(output.address) >= 0){
				assocAmountsByAsset[asset] += payload.outputs[objHeadPrivateElement.output_index].amount;
				assocMyReceivingAddresses[output.address] = true;
			}
		});
		console.log('assocAmountsByAsset', assocAmountsByAsset);
		const arrMyReceivingAddresses = Object.keys(assocMyReceivingAddresses);
		if (arrMyReceivingAddresses.length === 0)
			return;
		db.query("SELECT 1 FROM shared_addresses WHERE shared_address IN(?)", [arrMyReceivingAddresses], ({length}) => {
			const bToSharedAddress = (length > 0);
			for (const asset in assocAmountsByAsset)
				if (assocAmountsByAsset[asset])
					eventBus.emit('received_payment', payer_device_address, assocAmountsByAsset[asset], asset, message_counter, bToSharedAddress);
		});
	});
}

function emitNewPublicPaymentReceived(payer_device_address, {messages}, message_counter) {
	walletGeneral.readMyAddresses(arrAddresses => {
		const assocAmountsByAsset = {};
		const assocMyReceivingAddresses = {};
		messages.forEach(message => {
			if (message.app !== 'payment' || !message.payload)
				return;
			const payload = message.payload;
			const asset = payload.asset || 'base';
			if (!assocAmountsByAsset[asset])
				assocAmountsByAsset[asset] = 0;
			payload.outputs.forEach(({address, amount}) => {
				if (address && arrAddresses.indexOf(address) >= 0){
					assocAmountsByAsset[asset] += amount;
					assocMyReceivingAddresses[address] = true;
				}
			});
		});
		const arrMyReceivingAddresses = Object.keys(assocMyReceivingAddresses);
		if (arrMyReceivingAddresses.length === 0)
			return;
		db.query("SELECT 1 FROM shared_addresses WHERE shared_address IN(?)", [arrMyReceivingAddresses], ({length}) => {
			const bToSharedAddress = (length > 0);
			for (const asset in assocAmountsByAsset)
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
		rows => {
			if (rows.length > 1)
				throw Error("more than 1 address found");
			if (rows.length === 1){
				const row = rows[0];
				if (!row.full_approval_date)
					return callbacks.ifError(`wallet of address ${address} not approved`);
				if (row.device_address !== device.getMyDeviceAddress())
					return callbacks.ifRemote(row.device_address);
				const objAddress = {
					address,
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
				sa_rows => {
					if (rows.length > 1)
						throw Error(`more than 1 member address found for shared address ${address} and signing path ${signing_path}`);
					if (sa_rows.length === 0){
						if (fallback_remote_device_address)
							return callbacks.ifRemote(fallback_remote_device_address);
						return callbacks.ifUnknownAddress();
					}
					const objSharedAddress = sa_rows[0];
					const relative_signing_path = `r${signing_path.substr(objSharedAddress.signing_path.length)}`;
					const bLocal = (objSharedAddress.device_address === device.getMyDeviceAddress()); // local keys
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
	balances.readBalance(wallet, assocBalances => {
		handleBalance(assocBalances);
		if (conf.bLight){ // make sure we have all asset definitions available
			const arrAssets = Object.keys(assocBalances).filter(asset => asset !== 'base');
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
	ORDER BY my_addresses.address_index ASC", [walletId], rows => {
		handleBalancesOnAddresses(rows);
	});
}

function readAssetMetadata(arrAssets, handleMetadata){
	let sql = "SELECT asset, metadata_unit, name, suffix, decimals FROM asset_metadata";
	if (arrAssets && arrAssets.length)
		sql += ` WHERE asset IN (${arrAssets.map(db.escape).join(', ')})`;
	db.query(sql, rows => {
		const assocAssetMetadata = {};
		for (let i=0; i<rows.length; i++){
			const row = rows[i];
			const asset = row.asset || "base";
			assocAssetMetadata[asset] = {
				metadata_unit: row.metadata_unit,
				decimals: row.decimals,
				name: row.suffix ? `${row.name}.${row.suffix}` : row.name
			};
		}
		handleMetadata(assocAssetMetadata);
		// after calling the callback, try to fetch missing data about assets
		if (!arrAssets)
			return;
		arrAssets.forEach(asset => {
			if (assocAssetMetadata[asset] || asset === 'base' && asset === constants.BLACKBYTES_ASSET)
				return;
			if ((assocLastFailedAssetMetadataTimestamps[asset] || 0) > Date.now() - ASSET_METADATA_RETRY_PERIOD)
				return;
			fetchAssetMetadata(asset, (err, {metadata_unit, decimals, suffix, name}) => {
				if (err)
					return console.log(err);
				assocAssetMetadata[asset] = {
					metadata_unit: metadata_unit,
					decimals: decimals,
					name: suffix ? `${name}.${suffix}` : name
				};
				eventBus.emit('maybe_new_transactions');
			});
		});
	});
}

function fetchAssetMetadata(asset, handleMetadata){
	device.requestFromHub('hub/get_asset_metadata', asset, (err, response) => {
		if (err){
			if (err === 'no metadata')
				assocLastFailedAssetMetadataTimestamps[asset] = Date.now();
			return handleMetadata(`error from get_asset_metadata ${asset}: ${err}`);
		}
		const metadata_unit = response.metadata_unit;
		const registry_address = response.registry_address;
		const suffix = response.suffix;
		if (!ValidationUtils.isStringOfLength(metadata_unit, constants.HASH_LENGTH))
			return handleMetadata(`bad metadata_unit: ${metadata_unit}`);
		if (!ValidationUtils.isValidAddress(registry_address))
			return handleMetadata(`bad registry_address: ${registry_address}`);
		const fetchMetadataUnit = conf.bLight 
			? onDone => {
				network.requestProofsOfJointsIfNewOrUnstable([metadata_unit], onDone);
			}
			: onDone => {
				onDone();
			};
		fetchMetadataUnit(err => {
			if (err)
				return handleMetadata(`fetchMetadataUnit failed: ${err}`);
			storage.readJoint(db, metadata_unit, {
				ifNotFound() {
					handleMetadata(`metadata unit ${metadata_unit} not found`);
				},
				ifFound({unit}) {
					unit.messages.forEach(message => {
						if (message.app !== 'data')
							return;
						const payload = message.payload;
						if (payload.asset !== asset)
							return;
						if (!payload.name)
							return handleMetadata(`no name in asset metadata ${metadata_unit}`);
						const decimals = (payload.decimals !== undefined) ? parseInt(payload.decimals) : undefined;
						if (decimals !== undefined && !ValidationUtils.isNonnegativeInteger(decimals))
							return handleMetadata(`bad decimals in asset metadata ${metadata_unit}`);
						db.query(
							`INSERT ${db.getIgnore()} INTO asset_metadata (asset, metadata_unit, registry_address, suffix, name, decimals) \n\
                            VALUES (?,?,?, ?,?,?)`,
							[asset, metadata_unit, registry_address, suffix, payload.name, decimals],
							() => {
								const objMetadata = {
									metadata_unit,
									suffix,
									decimals,
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
	const asset = opts.asset && (opts.asset !== "base") ? opts.asset : null;
	if (opts.wallet && opts.address || !opts.wallet && !opts.address)
		throw Error('invalid wallet and address params');
	const wallet = opts.wallet || opts.address;
	const walletIsAddress = ValidationUtils.isValidAddress(wallet);
	const join_my_addresses = walletIsAddress ? "" : "JOIN my_addresses USING(address)";
	let where_condition = walletIsAddress ? "address=?" : "wallet=?";
	const asset_condition = asset ? `asset=${db.escape(asset)}` : "asset IS NULL";
	let cross = "";
	if (opts.unit)
		where_condition += ` AND unit=${db.escape(opts.unit)}`;
	else if (opts.since_mci && ValidationUtils.isNonnegativeInteger(opts.since_mci)){
		where_condition += ` AND main_chain_index>=${opts.since_mci}`;
		cross = "CROSS";
	}
	db.query(
		`SELECT unit, level, is_stable, sequence, address, \n\
            ${db.getUnixTimestamp("units.creation_date")} AS ts, headers_commission+payload_commission AS fee, \n\
            SUM(amount) AS amount, address AS to_address, NULL AS from_address, main_chain_index AS mci \n\
        FROM units ${cross} JOIN outputs USING(unit) ${join_my_addresses} \n\
        WHERE ${where_condition} AND ${asset_condition} \n\
        GROUP BY unit, address \n\
        UNION \n\
        SELECT unit, level, is_stable, sequence, address, \n\
            ${db.getUnixTimestamp("units.creation_date")} AS ts, headers_commission+payload_commission AS fee, \n\
            NULL AS amount, NULL AS to_address, address AS from_address, main_chain_index AS mci \n\
        FROM units ${cross} JOIN inputs USING(unit) ${join_my_addresses} \n\
        WHERE ${where_condition} AND ${asset_condition} \n\
        ORDER BY ts DESC${opts.limit ? " LIMIT ?" : ""}`,
		opts.limit ? [wallet, wallet, opts.limit] : [wallet, wallet],
		rows => {
			const assocMovements = {};
			for (let i=0; i<rows.length; i++){
				const row = rows[i];
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
			const arrTransactions = [];
			async.forEachOfSeries(
				assocMovements,
				(movement, unit, cb) => {
					if (movement.sequence !== 'good'){
						const transaction = {
							action: 'invalid',
							confirmations: movement.is_stable,
							unit,
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
							`SELECT DISTINCT address FROM inputs WHERE unit=? AND ${asset_condition} ORDER BY address`, 
							[unit], 
							address_rows => {
								const arrPayerAddresses = address_rows.map(({address}) => address);
								movement.arrMyRecipients.forEach(({amount, my_address}) => {
									const transaction = {
										action: 'received',
										amount: amount,
										my_address: my_address,
										arrPayerAddresses,
										confirmations: movement.is_stable,
										unit,
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
                        let queryString;
                        let parameters;
                        queryString =   `SELECT outputs.address, SUM(outputs.amount) AS amount, outputs.asset, (${walletIsAddress ? "outputs.address!=?" : "my_addresses.address IS NULL"}) AS is_external, \n\
                                        sent_mnemonics.textAddress, sent_mnemonics.mnemonic, \n\
                                        (SELECT unit_authors.unit FROM unit_authors WHERE unit_authors.address = sent_mnemonics.address LIMIT 1) AS claiming_unit \n\
                                        FROM outputs ${walletIsAddress ? "" : "LEFT JOIN my_addresses ON outputs.address=my_addresses.address AND wallet=? "}LEFT JOIN sent_mnemonics USING(unit) \n\
                                        WHERE outputs.unit=? \n\
                                        GROUP BY outputs.address, asset`;
                        parameters = [wallet, unit];
                        db.query(queryString, parameters, 
							payee_rows => {
								const action = payee_rows.some(({is_external}) => is_external) ? 'sent' : 'moved';
								if (payee_rows.length == 0) {
									cb();
									return;
								}
								const has_asset = payee_rows.some(payee => payee.asset);
								if (has_asset && !asset) { // filter out "fees" txs from history
									cb();
									return;
								}
								async.eachSeries(payee_rows, (payee, cb2) => {
									if ((action === 'sent' && !payee.is_external) || (asset != payee.asset)) {
										return cb2();
									}

									const transaction = {
										action,
										amount: payee.amount,
										addressTo: payee.address,
										textAddress: ValidationUtils.isValidEmail(payee.textAddress) ? payee.textAddress : "",
										claimed: !!payee.claiming_unit,
										mnemonic: payee.mnemonic,
										confirmations: movement.is_stable,
										unit,
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
											({length}) => {
												transaction.claimedByMe = (length > 0);
												arrTransactions.push(transaction);
												cb2();
											}
										);
									} else {
										arrTransactions.push(transaction);
										cb2();
									}
								}, () => {
									cb();
								});
							}
						);
                    }
				},
				() => {
					arrTransactions.sort(({mci, level, time}, {mci, level, time}) => {
						if (mci && mci){
							if (mci < mci)
								return 1;
							if (mci > mci)
								return -1;
						}
						if (level < level)
							return 1;
						if (level > level)
							return -1;
						if (time < time)
							return 1;
						if (time > time)
							return -1;
						return 0;
					});
					arrTransactions.forEach(transaction => { transaction.asset = opts.asset; });
					handleHistory(arrTransactions);
				}
			);
		}
	);
}

// returns assoc array signing_path => (key|merkle)
function readFullSigningPaths(conn, address, arrSigningDeviceAddresses, handleSigningPaths){
	
	const assocSigningPaths = {};
	
	function goDeeper(member_address, path_prefix, onDone){
		// first, look for wallet addresses
		let sql = "SELECT signing_path FROM my_addresses JOIN wallet_signing_paths USING(wallet) WHERE address=?";
		let arrParams = [member_address];
		if (arrSigningDeviceAddresses && arrSigningDeviceAddresses.length > 0){
			sql += " AND device_address IN(?)";
			arrParams.push(arrSigningDeviceAddresses);
		}
		conn.query(sql, arrParams, rows => {
			rows.forEach(({signing_path}) => {
				assocSigningPaths[path_prefix + signing_path.substr(1)] = 'key';
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
			conn.query(sql, arrParams, rows => {
				if(rows.length > 0) {
					async.eachSeries(
						rows,
						(row, cb) => {
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
	
	goDeeper(address, 'r', () => {
		handleSigningPaths(assocSigningPaths); // order of signing paths is not significant
	});
}

function determineIfFixedDenominations(asset, handleResult){
	if (!asset)
		return handleResult(false);
	storage.readAsset(db, asset, null, (err, {fixed_denominations}) => {
		if (err)
			throw Error(err);
		handleResult(fixed_denominations);
	});
}

function readFundedAddresses(asset, wallet, estimated_amount, handleFundedAddresses){
	const walletIsAddresses = ValidationUtils.isNonemptyArray(wallet);
	if (walletIsAddresses)
		return composer.readSortedFundedAddresses(asset, wallet, estimated_amount, handleFundedAddresses);
	if (estimated_amount && typeof estimated_amount !== 'number')
		throw Error(`invalid estimated amount: ${estimated_amount}`);
	// addresses closest to estimated amount come first
	const order_by = estimated_amount ? `(SUM(amount)>${estimated_amount}) DESC, ABS(SUM(amount)-${estimated_amount}) ASC` : "SUM(amount) DESC";
	db.query(
		`SELECT address, SUM(amount) AS total \n\
        FROM outputs JOIN my_addresses USING(address) \n\
        CROSS JOIN units USING(unit) \n\
        WHERE wallet=? AND is_stable=1 AND sequence='good' AND is_spent=0 AND ${asset ? "asset=?" : "asset IS NULL"} \n\
            AND NOT EXISTS ( \n\
                SELECT * FROM unit_authors JOIN units USING(unit) \n\
                WHERE is_stable=0 AND unit_authors.address=outputs.address AND definition_chash IS NOT NULL \n\
            ) \n\
        GROUP BY address ORDER BY ${order_by}`,
		asset ? [wallet, asset] : [wallet],
		rows => {
			determineIfFixedDenominations(asset, bFixedDenominations => {
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
	const arrFromAddresses = arrPayingAddresses.concat(arrSigningAddresses);
	let sql = "SELECT DISTINCT address FROM shared_address_signing_paths \n\
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
	const arrParams = [arrFromAddresses];
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
		rows => {
			const arrAdditionalAddresses = rows.map(({address}) => address);
			if (arrAdditionalAddresses.length === 0)
				return handleAdditionalSigningAddresses([]);
			readAdditionalSigningAddresses([], arrSigningAddresses.concat(arrAdditionalAddresses), arrSigningDeviceAddresses, arrMoreAddresses => {
				handleAdditionalSigningAddresses(arrAdditionalAddresses.concat(arrMoreAddresses));
			});
		}
	);
}

const TYPICAL_FEE = 1000;

// fee_paying_wallet is used only if there are no bytes on the asset wallet, it is a sort of fallback wallet for fees
function readFundedAndSigningAddresses(
		asset, wallet, estimated_amount, fee_paying_wallet, arrSigningAddresses, arrSigningDeviceAddresses, handleFundedAndSigningAddresses)
{
	readFundedAddresses(asset, wallet, estimated_amount, arrFundedAddresses => {
		if (arrFundedAddresses.length === 0)
			return handleFundedAndSigningAddresses([], [], []);
		let arrBaseFundedAddresses = [];
		const addSigningAddressesAndReturn = () => {
			const arrPayingAddresses = _.union(arrFundedAddresses, arrBaseFundedAddresses);
			readAdditionalSigningAddresses(arrPayingAddresses, arrSigningAddresses, arrSigningDeviceAddresses, arrAdditionalAddresses => {
				handleFundedAndSigningAddresses(arrFundedAddresses, arrBaseFundedAddresses, arrSigningAddresses.concat(arrAdditionalAddresses));
			});
		};
		if (!asset)
			return addSigningAddressesAndReturn();
		readFundedAddresses(null, wallet, TYPICAL_FEE, _arrBaseFundedAddresses => {
			// fees will be paid from the same addresses as the asset
			if (_arrBaseFundedAddresses.length > 0 || !fee_paying_wallet || fee_paying_wallet === wallet){
				arrBaseFundedAddresses = _arrBaseFundedAddresses;
				return addSigningAddressesAndReturn();
			}
			readFundedAddresses(null, fee_paying_wallet, TYPICAL_FEE, _arrBaseFundedAddresses => {
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
		asset,
		wallet,
		to_address,
		amount,
		change_address,
		arrSigningDeviceAddresses,
		recipient_device_address,
		signWithLocalPrivateKey
	}, handleResult);
}

function sendMultiPayment(opts, handleResult)
{
	let asset = opts.asset;
	if (asset === 'base')
		asset = null;
	const wallet = opts.wallet;
	const arrPayingAddresses = opts.paying_addresses;
	const fee_paying_wallet = opts.fee_paying_wallet;
	const arrSigningAddresses = opts.signing_addresses || [];
	let to_address = opts.to_address;
	const amount = opts.amount;
	const bSendAll = opts.send_all;
	const change_address = opts.change_address;
	const arrSigningDeviceAddresses = opts.arrSigningDeviceAddresses;
	let recipient_device_address = opts.recipient_device_address;
	const signWithLocalPrivateKey = opts.signWithLocalPrivateKey;
	const merkle_proof = opts.merkle_proof;
	
	const base_outputs = opts.base_outputs;
	const asset_outputs = opts.asset_outputs;
	const messages = opts.messages;
	
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
	
	let estimated_amount = amount;
	if (!estimated_amount && asset_outputs)
		estimated_amount = asset_outputs.reduce((acc, output) => acc+output.amount, 0);
	if (estimated_amount && !asset)
		estimated_amount += TYPICAL_FEE;
	
	readFundedAndSigningAddresses(
		asset, wallet || arrPayingAddresses, estimated_amount, fee_paying_wallet, arrSigningAddresses, arrSigningDeviceAddresses, 
		(arrFundedAddresses, arrBaseFundedAddresses, arrAllSigningAddresses) => {
		
			if (arrFundedAddresses.length === 0)
				return handleResult("There are no funded addresses");
			if (asset && arrBaseFundedAddresses.length === 0)
				return handleResult("No bytes to pay fees");

			let bRequestedConfirmation = false;
			const signer = {
				readSigningPaths(conn, address, handleLengthsBySigningPaths) { // returns assoc array signing_path => length
					readFullSigningPaths(conn, address, arrSigningDeviceAddresses, assocTypesBySigningPaths => {
						const assocLengthsBySigningPaths = {};
						for (const signing_path in assocTypesBySigningPaths){
							const type = assocTypesBySigningPaths[signing_path];
							if (type === 'key')
								assocLengthsBySigningPaths[signing_path] = constants.SIG_LENGTH;
							else if (type === 'merkle'){
								if (merkle_proof)
									assocLengthsBySigningPaths[signing_path] = merkle_proof.length;
							}
							else
								throw Error(`unknown type ${type} at ${signing_path}`);
						}
						handleLengthsBySigningPaths(assocLengthsBySigningPaths);
					});
				},
				readDefinition(conn, address, handleDefinition) {
					conn.query(
						"SELECT definition FROM my_addresses WHERE address=? UNION SELECT definition FROM shared_addresses WHERE shared_address=?", 
						[address, address], 
						rows => {
							if (rows.length !== 1)
								throw Error("definition not found");
							handleDefinition(null, JSON.parse(rows[0].definition));
						}
					);
				},
				sign(
                    objUnsignedUnit,
                    assocPrivatePayloads,
                    address,
                    signing_path,
                    handleSignature
                ) {
					const buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
					findAddress(address, signing_path, {
						ifError(err) {
							throw Error(err);
						},
						ifUnknownAddress(err) {
							throw Error(`unknown address ${address} at ${signing_path}`);
						},
						ifLocal(objAddress) {
							signWithLocalPrivateKey(objAddress.wallet, objAddress.account, objAddress.is_change, objAddress.address_index, buf_to_sign, sig => {
								handleSignature(null, sig);
							});
						},
						ifRemote(device_address) {
							// we'll receive this event after the peer signs
							eventBus.once(`signature-${device_address}-${address}-${signing_path}-${buf_to_sign.toString("base64")}`, sig => {
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
						ifMerkle(bLocal) {
							if (!bLocal)
								throw Error(`merkle proof at path ${signing_path} should be provided by another device`);
							if (!merkle_proof)
								throw Error(`merkle proof at path ${signing_path} not provided`);
							handleSignature(null, merkle_proof);
						}
					});
				}
			};

			// if we have any output with text addresses / not byteball addresses (e.g. email) - generate new addresses and return them
			const assocMnemonics = {}; // return all generated wallet mnemonics to caller in callback
			const assocPaymentsByEmail = {}; // wallet mnemonics to send by emails
			const assocAddresses = {};
			const prefix = "textcoin:";
			function generateNewMnemonicIfNoAddress(output_asset, outputs) {
				let generated = 0;
				outputs.forEach(output => {
					if (output.address.indexOf(prefix) !== 0)
						return false;
					const address = output.address.slice(prefix.length);
					let strMnemonic = assocMnemonics[output.address] || "";
					let mnemonic = new Mnemonic(strMnemonic.replace(/-/g, " "));
					if (!strMnemonic) {
						while (!Mnemonic.isValid(mnemonic.toString()))
							mnemonic = new Mnemonic();
						strMnemonic = mnemonic.toString().replace(/ /g, "-");
					}
					if (!opts.do_not_email && ValidationUtils.isValidEmail(address)) {
						assocPaymentsByEmail[address] = {mnemonic: strMnemonic, amount: output.amount, asset: output_asset};
					}
					assocMnemonics[output.address] = strMnemonic;
					const pubkey = mnemonic.toHDPrivateKey().derive("m/44'/0'/0'/0/0").publicKey.toBuffer().toString("base64");
					assocAddresses[output.address] = objectHash.getChash160(["sig", {"pubkey": pubkey}]);
					output.address = assocAddresses[output.address];
					generated++;
				});
				return generated;
			}
			if (to_address) {
				const to_address_output = {address: to_address, amount};
				const cnt = generateNewMnemonicIfNoAddress(asset, [to_address_output]);
				if (cnt) to_address = to_address_output.address;
			}
			if (base_outputs) generateNewMnemonicIfNoAddress(null, base_outputs);
			if (asset_outputs) generateNewMnemonicIfNoAddress(asset, asset_outputs);

			const params = {
				available_paying_addresses: arrFundedAddresses, // forces 'minimal' for payments from shared addresses too, it doesn't hurt
				signing_addresses: arrAllSigningAddresses,
				messages, 
				signer, 
				callbacks: {
					ifNotEnoughFunds(err) {
						handleResult(err);
					},
					ifError(err) {
						handleResult(err);
					},
					preCommitCb(conn, {unit}, cb) {
						let i = 0;
						if (Object.keys(assocMnemonics).length) {
							for (const to in assocMnemonics) {
								conn.query("INSERT INTO sent_mnemonics (unit, address, mnemonic, textAddress) VALUES (?, ?, ?, ?)", [unit.unit, assocAddresses[to], assocMnemonics[to], to.slice(prefix.length)],
								() => {
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
					ifOk(
                        objJoint,
                        arrChainsOfRecipientPrivateElements,
                        arrChainsOfCosignerPrivateElements
                    ) {
						network.broadcastJoint(objJoint);
						if (!arrChainsOfRecipientPrivateElements && recipient_device_address) // send notification about public payment
							walletGeneral.sendPaymentNotification(recipient_device_address, objJoint.unit.unit);

						if (Object.keys(assocPaymentsByEmail).length) { // need to send emails
							let sent = 0;
							for (const email in assocPaymentsByEmail) {
								const objPayment = assocPaymentsByEmail[email];
								sendTextcoinEmail(email, opts.email_subject, objPayment.amount, objPayment.asset, objPayment.mnemonic);
								if (++sent == Object.keys(assocPaymentsByEmail).length)
									handleResult(null, objJoint.unit.unit, assocMnemonics);
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
				storage.readAsset(db, asset, null, (err, {is_private, fixed_denominations}) => {
					if (err)
						throw Error(err);
				//	if (objAsset.is_private && !recipient_device_address)
				//		return handleResult("for private asset, need recipient's device address to send private payload to");
					if (is_private){
						// save messages in outbox before committing
						params.callbacks.preCommitCb = (
                            conn,
                            arrChainsOfRecipientPrivateElements,
                            arrChainsOfCosignerPrivateElements,
                            cb
                        ) => {
							if (!arrChainsOfRecipientPrivateElements || !arrChainsOfCosignerPrivateElements)
								throw Error('no private elements');
							const sendToRecipients = cb2 => {
								if (recipient_device_address)
									walletGeneral.sendPrivatePayments(recipient_device_address, arrChainsOfRecipientPrivateElements, false, conn, cb2);
								else // paying to another wallet on the same device
									forwardPrivateChainsToOtherMembersOfOutputAddresses(arrChainsOfRecipientPrivateElements, conn, cb2);
							};
							const sendToCosigners = cb2 => {
								if (wallet)
									walletDefinedByKeys.forwardPrivateChainsToOtherMembersOfWallets(arrChainsOfCosignerPrivateElements, [wallet], conn, cb2);
								else // arrPayingAddresses can be only shared addresses
									forwardPrivateChainsToOtherMembersOfSharedAddresses(arrChainsOfCosignerPrivateElements, arrPayingAddresses, null, false, conn, cb2);
							};
							async.series([sendToRecipients, sendToCosigners], cb);
						};
					}
					if (fixed_denominations){ // indivisible
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
					params.outputs = to_address ? [{address: to_address, amount}] : (base_outputs || []);
					params.outputs.push({address: change_address, amount: 0});
				}
				composer.composeAndSaveMinimalJoint(params);
			}

		}
	);
}

function forwardPrivateChainsToOtherMembersOfSharedAddresses(arrChainsOfCosignerPrivateElements, arrPayingAddresses, excluded_device_address, bForwarded, conn, onDone){
	walletDefinedByAddresses.readAllControlAddresses(conn, arrPayingAddresses, (arrControlAddresses, arrControlDeviceAddresses) => {
		arrControlDeviceAddresses = arrControlDeviceAddresses.filter(device_address => device_address !== device.getMyDeviceAddress() && device_address !== excluded_device_address);
		walletDefinedByKeys.readDeviceAddressesControllingPaymentAddresses(conn, arrControlAddresses, arrMultisigDeviceAddresses => {
			arrMultisigDeviceAddresses = _.difference(arrMultisigDeviceAddresses, arrControlDeviceAddresses);
			// counterparties on shared addresses must forward further, that's why bForwarded=false
			walletGeneral.forwardPrivateChainsToDevices(arrControlDeviceAddresses, arrChainsOfCosignerPrivateElements, bForwarded, conn, () => {
				walletGeneral.forwardPrivateChainsToDevices(arrMultisigDeviceAddresses, arrChainsOfCosignerPrivateElements, true, conn, onDone);
			});
		});
	});
}

function sendTextcoinEmail(email, subject, amount, asset, mnemonic){
	const mail = require('./mail.js'+'');
	let usd_amount_str = '';
	if (!asset){
		amount -= constants.TEXTCOIN_CLAIM_FEE;
		if (network.exchangeRates['GBYTE_USD']) {
			usd_amount_str = ` (≈${((amount/1e9)*network.exchangeRates['GBYTE_USD']).toLocaleString([], {maximumFractionDigits: 2})} USD)`;
		}
		amount = (amount/1e9).toLocaleString([], {maximumFractionDigits: 9});
		asset = 'GB';
	}
	replaceInTextcoinTemplate({amount, asset, mnemonic, usd_amount_str}, (html, text) => {
		mail.sendmail({
			to: email,
			from: conf.from_email || "noreply@byteball.org",
			subject: subject || "Byteball user beamed you money",
			body: text,
			htmlBody: html
		});
	});
}

function replaceInTextcoinTemplate(params, handleText){
	const fs = require('fs'+'');
	fs.readFile(`${__dirname}/email_template.html`, 'utf8', (err, template) => {
		if (err)
			throw Error(`failed to read template: ${err}`);
		_.forOwn(params, (value, key) => {
			const re = new RegExp(`\\{\\{${key}\\}\\}`,"g");
			template = template.replace(re, value);
		});
		template = template.replace(/\{\{\w*\}\}/g, '');

		const text = `Here is your link to receive ${params.amount} ${params.asset}${params.usd_amount_str}: https://byteball.org/openapp.html#textcoin?${params.mnemonic}`;
		handleText(template, text);
	});
}

function receiveTextCoin(mnemonic, addressTo, cb) {
	mnemonic = mnemonic.toLowerCase().split('-').join(' ');
	if ((mnemonic.split(' ').length % 3 !== 0) || !Mnemonic.isValid(mnemonic)) {
		return cb(`invalid mnemonic: ${mnemonic}`);
	}
	var mnemonic = new Mnemonic(mnemonic);
	try {
		var xPrivKey = mnemonic.toHDPrivateKey().derive("m/44'/0'/0'/0/0");
		var pubkey = xPrivKey.publicKey.toBuffer().toString("base64");
	} catch (e) {
		cb(e.message);
		return;
	}
	const definition = ["sig", {"pubkey": pubkey}];
	const address = objectHash.getChash160(definition);
	const signer = {
		readSigningPaths(conn, address, handleLengthsBySigningPaths) { // returns assoc array signing_path => length
			const assocLengthsBySigningPaths = {};
			assocLengthsBySigningPaths["r"] = constants.SIG_LENGTH;
			handleLengthsBySigningPaths(assocLengthsBySigningPaths);
		},
		readDefinition(conn, address, handleDefinition) {
			handleDefinition(null, definition);
		},
		sign(
            objUnsignedUnit,
            assocPrivatePayloads,
            address,
            signing_path,
            handleSignature
        ) {
			handleSignature(null, ecdsaSig.sign(objectHash.getUnitHashToSign(objUnsignedUnit), xPrivKey.privateKey.bn.toBuffer({size:32})));
		}
	};
	const opts = {};
	let asset = null;
	opts.signer = signer;
	opts.paying_addresses = [address];

	opts.callbacks = {
		ifNotEnoughFunds(err) {
			cb("This textcoin was already claimed");
		},
		ifError(err) {
			if (err.indexOf("some definition changes") == 0)
				return cb("This textcoin was already claimed but not confirmed yet");
			cb(err);
		},
		ifOk(
            objJoint,
            arrChainsOfRecipientPrivateElements,
            arrChainsOfCosignerPrivateElements
        ) {
			network.broadcastJoint(objJoint);
			cb(null, objJoint.unit.unit, asset);
		}
	};

	if (conf.bLight) {
		db.query(
			"SELECT 1 \n\
			FROM outputs JOIN units USING(unit) WHERE address=? LIMIT 1", 
			[address],
			({length}) => {
				if (length === 0) {
					network.requestHistoryFor([], [address], checkStability);
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
			"SELECT is_stable, asset, is_spent, amount \n\
			FROM outputs JOIN units USING(unit) WHERE address=? AND sequence='good' ORDER BY asset DESC, is_spent ASC LIMIT 1", 
			[address],
			rows => {
				if (rows.length === 0) {
					cb("This payment doesn't exist in the network");
				} else {
					const row = rows[0];
					if (!row.is_stable) {
						cb("This payment is not confirmed yet, try again later");
					} else {
						if (row.asset) { // claiming asset
							// TODO: request asset data for light clients
							opts.asset = row.asset;
							opts.amount = row.amount;
							opts.fee_paying_addresses = [address];
							storage.readAsset(db, row.asset, null, (err, {fixed_denominations}) => {
								if (err && err.indexOf("not found" !== -1)) {
									return network.requestHistoryFor([opts.asset], [], checkStability);
								}
								asset = opts.asset;
								opts.to_address = addressTo;
								if (fixed_denominations){ // indivisible
									opts.tolerance_plus = 0;
									opts.tolerance_minus = 0;
									indivisibleAsset.composeAndSaveIndivisibleAssetPaymentJoint(opts);
								}
								else{ // divisible
									divisibleAsset.composeAndSaveDivisibleAssetPaymentJoint(opts);
								}
							});
						} else {// claiming bytes
							opts.send_all = true;
							opts.outputs = [{address: addressTo, amount: 0}];
							opts.callbacks = composer.getSavingCallbacks(opts.callbacks);
							composer.composeJoint(opts);
						}
					}
				}
			}
		);		
	}
}

// if a textcoin was not claimed for 'days' days, claims it back
function claimBackOldTextcoins(to_address, days){
	db.query(
		`SELECT mnemonic FROM sent_mnemonics LEFT JOIN unit_authors USING(address) \n\
        WHERE mnemonic!='' AND unit_authors.address IS NULL AND creation_date<${db.addTime(`-${days} DAYS`)}`,
		rows => {
			async.eachSeries(
				rows,
				({mnemonic}, cb) => {
					receiveTextCoin(mnemonic, to_address, (err, unit, asset) => {
						if (err)
							console.log(`failed claiming back old textcoin ${mnemonic}: ${err}`);
						else
							console.log(`claimed back mnemonic ${mnemonic}, unit ${unit}, asset ${asset}`);
						cb();
					});
				}
			);
		}
	);
}

function eraseTextcoin(unit, address) {
	db.query(
		"UPDATE sent_mnemonics \n\
		SET mnemonic='' WHERE unit=? AND address=?", 
		[unit, address],
		() => {}
	);
}

function readDeviceAddressesUsedInSigningPaths(onDone){

	let sql = "SELECT DISTINCT device_address FROM shared_address_signing_paths ";
	sql += "UNION SELECT DISTINCT device_address FROM wallet_signing_paths ";
	sql += "UNION SELECT DISTINCT device_address FROM pending_shared_address_signing_paths";
	
	db.query(
		sql, 
		rows => {
			
			const arrDeviceAddress = rows.map(({device_address}) => device_address);

			onDone(arrDeviceAddress);
		}
	);
}

function determineIfDeviceCanBeRemoved(device_address, handleResult) {
	device.readCorrespondent(device_address, correspondent => {
		if (!correspondent)
			return handleResult(false);
		readDeviceAddressesUsedInSigningPaths(arrDeviceAddresses => {
			handleResult(arrDeviceAddresses.indexOf(device_address) === -1);
		});
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
exports.readBalancesOnAddresses = readBalancesOnAddresses;
exports.readAssetMetadata = readAssetMetadata;
exports.readTransactionHistory = readTransactionHistory;
exports.sendPaymentFromWallet = sendPaymentFromWallet;
exports.sendMultiPayment = sendMultiPayment;
exports.readDeviceAddressesUsedInSigningPaths = readDeviceAddressesUsedInSigningPaths;
exports.determineIfDeviceCanBeRemoved = determineIfDeviceCanBeRemoved;
exports.receiveTextCoin = receiveTextCoin;
exports.claimBackOldTextcoins = claimBackOldTextcoins;
exports.eraseTextcoin = eraseTextcoin;
