/*jslint node: true */
"use strict";

/* !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

This module is unfinished and barely tested!

*/


var async = require('async');
var db = require('./db.js');
var constants = require('./constants.js');
var conf = require('./conf.js');
var composer = require('./composer.js');
var objectHash = require('./object_hash.js');
var _ = require('lodash');
var network = require('./network.js');
var device = require('./device.js');
var walletGeneral = require('./wallet_general.js');
var eventBus = require('./event_bus.js');
var Definition = require("./definition.js");
var ValidationUtils = require("./validation_utils.js");
var indivisibleAsset = require('./indivisible_asset.js');
var divisibleAsset = require('./divisible_asset.js');

var MAX_INT32 = Math.pow(2, 31) - 1;




function sendOfferToCreateNewSharedAddress(device_address, arrAddressDefinitionTemplate){
	device.sendMessageToDevice(device_address, "create_new_shared_address", {address_definition_template: arrAddressDefinitionTemplate});
}

// called from UI
function sendApprovalOfNewSharedAddress(device_address, address_definition_template_chash, address, assocDeviceAddressesByRelativeSigningPaths){
	device.sendMessageToDevice(device_address, "approve_new_shared_address", {
		address_definition_template_chash: address_definition_template_chash, 
		address: address, 
		device_addresses_by_relative_signing_paths: assocDeviceAddressesByRelativeSigningPaths
	});
}

// called from UI
function sendRejectionOfNewSharedAddress(device_address, address_definition_template_chash){
	device.sendMessageToDevice(device_address, "reject_new_shared_address", {
		address_definition_template_chash: address_definition_template_chash
	});
}

function sendNewSharedAddress(device_address, address, arrDefinition, assocSignersByPath){
	device.sendMessageToDevice(device_address, "new_shared_address", {
		address: address, definition: arrDefinition, signers: assocSignersByPath
	});
}





// called from UI
// my address is not filled explicitly, it is specified as variable in the template like external addresses
// assocMyDeviceAddressesByRelativeSigningPaths points to my device addresses that hold the actual signing keys
function createNewSharedAddress(arrAddressDefinitionTemplate, my_address, assocMyDeviceAddressesByRelativeSigningPaths){
	validateAddressDefinitionTemplate(arrAddressDefinitionTemplate, device.getMyDeviceAddress(), function(err, assocMemberDeviceAddressesBySigningPaths){
		// assocMemberDeviceAddressesBySigningPaths are keyed by paths from root to member addresses (not all the way to signing keys)
		var arrMemberSigningPaths = Object.keys(assocMemberDeviceAddressesBySigningPaths);
		var address_definition_template_chash = objectHash.getChash160(arrAddressDefinitionTemplate);
		db.query(
			"INSERT INTO pending_shared_addresses (definition_template_chash, definition_template) VALUES(?,?)", 
			[address_definition_template_chash, JSON.stringify(arrAddressDefinitionTemplate)],
			function(){
				async.series(
					arrMemberSigningPaths, 
					function(signing_path, cb){
						var device_address = assocMemberDeviceAddressesBySigningPaths[signing_path];
						var fields = "definition_template_chash, device_address, signing_path";
						var values = "?,?,?";
						var arrParams = [address_definition_template_chash, device_address, signing_path];
						if (device_address === device.getMyDeviceAddress()){
							fields += ", address, device_addresses_by_relative_signing_paths, approval_date";
							values += ",?,?,"+db.getNow();
							arrParams.push(my_address, JSON.stringify(assocMyDeviceAddressesByRelativeSigningPaths));
						}
						db.query("INSERT INTO pending_shared_address_signing_paths ("+fields+") VALUES("+values+")", arrParams, function(){
							cb();
						});
					},
					function(){
						var arrMemberDeviceAddresses = _.uniq(_.values(assocMemberDeviceAddressesBySigningPaths));
						arrMemberDeviceAddresses.forEach(function(device_address){
							if (device_address !== device.getMyDeviceAddress())
								sendOfferToCreateNewSharedAddress(device_address, arrAddressDefinitionTemplate);
						})
					}
				);
			}
		);
	});
}

// received approval from co-signer address
function approvePendingSharedAddress(address_definition_template_chash, from_address, address, assocDeviceAddressesByRelativeSigningPaths){
	db.query( // may update several rows if the device is referenced multiple times from the definition template
		"UPDATE pending_shared_address_signing_paths SET address=?, device_addresses_by_relative_signing_paths=?, approval_date="+db.getNow()+" \n\
		WHERE definition_template_chash=? AND device_address=?", 
		[address, JSON.stringify(assocDeviceAddressesByRelativeSigningPaths), address_definition_template_chash, from_address], 
		function(){
			// check if this is the last required approval
			db.query(
				"SELECT device_address, signing_path, address, device_addresses_by_relative_signing_paths \n\
				FROM pending_shared_address_signing_paths \n\
				WHERE definition_template_chash=?",
				[address_definition_template_chash],
				function(rows){
					if (rows.length === 0) // another device rejected the address at the same time
						return;
					if (rows.some(function(row){ return !row.address; })) // some devices haven't approved yet
						return;
					// all approvals received
					var params = {};
					rows.forEach(function(row){ // the same device_address can be mentioned in several rows
						params['address@'+row.device_address] = row.address;
					});
					db.query(
						"SELECT definition_template FROM pending_shared_addresses WHERE definition_template_chash=?", 
						[address_definition_template_chash],
						function(templ_rows){
							if (templ_rows.length !== 1)
								throw Error("template not found");
							var arrAddressDefinitionTemplate = JSON.parse(templ_rows[0].definition_template);
							var arrDefinition = Definition.replaceInTemplate(arrAddressDefinitionTemplate, params);
							var shared_address = objectHash.getChash160(arrDefinition);
							db.query(
								"INSERT INTO shared_addresses (shared_address, definition) VALUES (?,?)", 
								[shared_address, JSON.stringify(arrDefinition)], 
								function(){
									var arrQueries = [];
									var assocSignersByPath = {};
									rows.forEach(function(row){
										var assocDeviceAddressesByRelativeSigningPaths = JSON.parse(row.device_addresses_by_relative_signing_paths);
										for (var member_signing_path in assocDeviceAddressesByRelativeSigningPaths){
											var signing_device_address = assocDeviceAddressesByRelativeSigningPaths[member_signing_path];
											// this is full signing path, from root of shared address (not from root of member address)
											var full_signing_path = row.signing_path + member_signing_path.substring(1);
											// note that we are inserting row.device_address (the device we requested approval from), not signing_device_address 
											// (the actual signer), because signing_device_address might not be our correspondent. When we need to sign, we'll
											// send unsigned unit to row.device_address and it'll forward the request to signing_device_address (subject to 
											// row.device_address being online)
											db.addQuery(arrQueries, 
												"INSERT INTO shared_address_signing_paths \n\
												(shared_address, address, signing_path, member_signing_path, device_address) VALUES(?,?,?,?,?)", 
												[shared_address, row.address, full_signing_path, member_signing_path, row.device_address]);
											assocSignersByPath[full_signing_path] = {
												device_address: row.device_address, 
												address: row.address, 
												member_signing_path: member_signing_path
											};
										}
									});
									async.series(arrQueries, function(){
										deletePendingSharedAddress(address_definition_template_chash);
										// notify all other member-devices about the new shared address they are a part of
										rows.forEach(function(row){
											if (row.device_address !== device.getMyDeviceAddress())
												sendNewSharedAddress(row.device_address, shared_address, arrDefinition, assocSignersByPath);
										});
									});
								}
							);
						}
					);
				}
			);
		}
	);
}

function deletePendingSharedAddress(address_definition_template_chash){
	db.query("DELETE FROM pending_shared_address_signing_paths WHERE definition_template_chash=?", [address_definition_template_chash], function(){
		db.query("DELETE FROM pending_shared_addresses WHERE definition_template_chash=?", [address_definition_template_chash], function(){});
	});
}

// called from network after the initiator collects approvals from all members of the address and then sends the completed address to all members
function addNewSharedAddress(address, arrDefinition, assocSignersByPath, onDone){
//	network.addWatchedAddress(address);
	db.query("INSERT INTO shared_addresses (shared_address, definition) VALUES (?,?)", [address, JSON.stringify(arrDefinition)], function(){
		var arrQueries = [];
		for (var full_signing_path in assocSignersByPath){
			var signerInfo = assocSignersByPath[full_signing_path];
			db.addQuery(arrQueries, 
				"INSERT INTO shared_address_signing_paths (shared_address, address, signing_path, member_signing_path, device_address) VALUES (?,?,?,?,?)", 
				[address, signerInfo.address, full_signing_path, signerInfo.member_signing_path, signerInfo.device_address]);
		}
		// todo: forward new shared address to devices that are members of my member address
		async.series(arrQueries, function(){
			eventBus.emit("new_address-"+address);
			if (onDone)
				onDone();
		});
	});
}

// {address: "BASE32", definition: [...], signers: {...}}
function handleNewSharedAddress(body, callbacks){
	if (!ValidationUtils.isArrayOfLength(body.definition, 2))
		return callbacks.ifError("invalid definition");
	if (typeof body.signers !== "object" || Object.keys(body.signers).length === 0)
		return callbacks.ifError("invalid signers");
	if (body.address !== objectHash.getChash160(body.definition))
		return callbacks.ifError("definition doesn't match its c-hash");
	validateAddressDefinition(body.definition, function(err){
		if (err)
			return callbacks.ifError(err);
		addNewSharedAddress(body.address, body.definition, body.signers, callbacks.ifOk);
	});
}

function getMemberDeviceAddressesBySigningPaths(arrAddressDefinitionTemplate){
	function evaluate(arr, path){
		var op = arr[0];
		var args = arr[1];
		if (!args)
			return;
		switch (op){
			case 'or':
			case 'and':
				for (var i=0; i<args.length; i++)
					evaluate(args[i], path + '.' + i);
				break;
			case 'r of set':
				if (!ValidationUtils.isNonemptyArray(args.set))
					return;
				for (var i=0; i<args.set.length; i++)
					evaluate(args.set[i], path + '.' + i);
				break;
			case 'weighted and':
				if (!ValidationUtils.isNonemptyArray(args.set))
					return;
				for (var i=0; i<args.set.length; i++)
					evaluate(args.set[i].value, path + '.' + i);
				break;
			case 'address':
				var address = args;
				var prefix = '$address@';
				if (!ValidationUtils.isNonemptyString(address) || address.substr(0, prefix.length) !== prefix)
					return;
				var device_address = address.substr(prefix.length);
				assocMemberDeviceAddressesBySigningPaths[path] = device_address;
			case 'definition template':
				throw Error(op+" not supported yet");
			// all other ops cannot reference device address
		}
	}
	var assocMemberDeviceAddressesBySigningPaths = {};
	evaluate(arrAddressDefinitionTemplate, 'r');
	return assocMemberDeviceAddressesBySigningPaths;
}

function validateAddressDefinitionTemplate(arrDefinitionTemplate, from_address, handleResult){
	var assocMemberDeviceAddressesBySigningPaths = getMemberDeviceAddressesBySigningPaths(arrDefinitionTemplate);
	var arrDeviceAddresses = _.uniq(_.values(assocMemberDeviceAddressesBySigningPaths));
	if (arrDeviceAddresses.length < 2)
		return handleResult("less than 2 member devices");
	if (arrDeviceAddresses.indexOf(device.getMyDeviceAddress()) === - 1)
		return handleResult("my device address not mentioned in the definition");
	if (arrDeviceAddresses.indexOf(from_address) === - 1)
		return handleResult("sender device address not mentioned in the definition");
	
	var params = {};
	// to fill the template for validation, assign my device address (without leading 0) to all member devices 
	// (we need just any valid address with a definition)
	var fake_address = device.getMyDeviceAddress().substr(1);
	arrDeviceAddresses.forEach(function(device_address){
		params['address@'+device_address] = fake_address;
	});
	try{
		var arrFakeDefinition = Definition.replaceInTemplate(arrDefinitionTemplate, params);
	}
	catch(e){
		return handleResult(e.toString());
	}
	var objFakeUnit = {authors: [{address: fake_address, definition: ["sig", {pubkey: device.getMyDevicePubKey()}]}]};
	var objFakeValidationState = {last_ball_mci: MAX_INT32};
	Definition.validateDefinition(db, arrFakeDefinition, objFakeUnit, objFakeValidationState, false, function(err){
		if (err)
			return handleResult(err);
		handleResult(null, assocMemberDeviceAddressesBySigningPaths);
	});
}

// fix:
// 1. check that my address is referenced in the definition
// 2. check that signing paths reference my device address
// 3. handle references to addresses whose definitions are not yet written onto the main chain
function validateAddressDefinition(arrDefinition, handleResult){
	var objFakeUnit = {authors: []};
	var objFakeValidationState = {last_ball_mci: MAX_INT32, bAllowUnresolvedInnerDefinitions: true};
	Definition.validateDefinition(db, arrDefinition, objFakeUnit, objFakeValidationState, false, function(err){
		if (err)
			return handleResult(err);
		handleResult();
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

// todo handle asset payments
function sendPaymentFromAddress(from_address, to_address, amount, change_address, arrSigningDeviceAddresses, signWithLocalPrivateKey, handleResult){
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
	
	composer.composeAndSavePaymentJoint([from_address], [{address: to_address, amount: amount}, {address: change_address, amount: 0}], signer, {
		ifNotEnoughFunds: function(err){
			handleResult(err);
		},
		ifError: function(err){
			handleResult(err);
		},
		ifOk: function(objJoint, assocPrivatePayloads){
			// todo handle private payloads
			network.broadcastJoint(objJoint);
			handleResult();
		}
	});
}



exports.validateAddressDefinitionTemplate = validateAddressDefinitionTemplate;
exports.approvePendingSharedAddress = approvePendingSharedAddress;
exports.deletePendingSharedAddress = deletePendingSharedAddress;
exports.validateAddressDefinition = validateAddressDefinition;
exports.handleNewSharedAddress = handleNewSharedAddress;
exports.findAddress = findAddress;
exports.sendPaymentFromAddress = sendPaymentFromAddress;

