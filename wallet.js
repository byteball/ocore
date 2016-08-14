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
                    if (payload_hash !== objectHash.getBase64Hash(assocPrivatePayloads[payload_hash]))
                        return callbacks.ifError("private payload hash does not match");
                    if (!ValidationUtils.isNonemptyArray(objUnit.messages))
                        return callbacks.ifError("no messages in unsigned unit");
                    if (objUnit.messages.filter(function(objMessage){ return (objMessage.payload_hash === payload_hash); }).length !== 1)
                        return callbacks.ifError("no such payload hash in the messages");
                }
            }
            // findAddress handles both types of addresses
            walletDefinedByAddresses.findAddress(body.address, body.signing_path, {
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
            
            if (conf.bLight)
                network.requestUnfinishedPastUnitsOfPrivateChains(arrChains); // it'll work in the background
            
            var assocValidatedByKey = {};
            var cancelAllKeys = function(){
                for (var key in assocValidatedByKey)
                    eventBus.removeAllListeners(key);
            };
            var checkIfAllValidated = function(){
                if (!assocValidatedByKey) // duplicate call - ignore
                    return;
                for (var key in assocValidatedByKey)
                    if (!assocValidatedByKey[key])
                        return;
                assocValidatedByKey = null; // to avoid duplicate calls
                emitNewPrivatePaymentReceived(from_address, arrChains);
            };
            
            async.eachSeries(
                arrChains,
                function(arrPrivateElements, cb){ // validate each chain individually
                    var objHeadPrivateElement = arrPrivateElements[0];
                    var payload_hash = objectHash.getBase64Hash(objHeadPrivateElement.payload);
                    var key = 'private_payment_validated-'+objHeadPrivateElement.unit+'-'+payload_hash;
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
                            console.log("handleOnlinePrivatePayment queued");
                            eventBus.once(key, function(bValid){
                                if (!bValid)
                                    return cancelAllKeys();
                                assocValidatedByKey[key] = true;
                                checkIfAllValidated();
                            });
                            cb();
                        }
                    });
                },
                function(err){
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
        if (rows.length === 0)
            throw Error("not my wallet?");
        var arrWallets = rows.map(function(row){ return row.wallet; });
        walletDefinedByKeys.forwardPrivateChainsToOtherMembersOfWallets(arrChains, arrWallets);
    });
}

// event emitted in two cases:
// 1. if I received private payloads via direct connection, not through a hub
// 2. (not true any more) received private payload from anywhere, didn't handle it immediately, saved and handled later
eventBus.on("new_direct_private_chains", forwardPrivateChainsToOtherMembersOfOutputAddresses);


function emitNewPrivatePaymentReceived(payer_device_address, arrChains){
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



// todo, almost same as payment
function signAuthRequest(wallet, objRequest, handleResult){
    
}




walletGeneral.readMyAddresses(function(arrAddresses){
    network.setWatchedAddresses(arrAddresses);
})




exports.sendSignature = sendSignature;

