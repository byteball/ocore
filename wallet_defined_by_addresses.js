/*jslint node: true */
"use strict";

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



// unused
function sendOfferToCreateNewSharedAddress(device_address, arrAddressDefinitionTemplate){
	device.sendMessageToDevice(device_address, "create_new_shared_address", {address_definition_template: arrAddressDefinitionTemplate});
}

// called from UI (unused)
function sendApprovalOfNewSharedAddress(device_address, address_definition_template_chash, address, assocDeviceAddressesByRelativeSigningPaths){
	device.sendMessageToDevice(device_address, "approve_new_shared_address", {
		address_definition_template_chash: address_definition_template_chash, 
		address: address, 
		device_addresses_by_relative_signing_paths: assocDeviceAddressesByRelativeSigningPaths
	});
}

// called from UI (unused)
function sendRejectionOfNewSharedAddress(device_address, address_definition_template_chash){
	device.sendMessageToDevice(device_address, "reject_new_shared_address", {
		address_definition_template_chash: address_definition_template_chash
	});
}

function sendNewSharedAddress(device_address, address, arrDefinition, assocSignersByPath, bForwarded){
	device.sendMessageToDevice(device_address, "new_shared_address", {
		address: address, definition: arrDefinition, signers: assocSignersByPath, forwarded: bForwarded
	});
}

// when a peer has lost shared address definitions after a wallet recovery, we can resend them
function sendToPeerAllSharedAddressesHavingUnspentOutputs(device_address, asset, callbacks){
	var asset_filter = !asset || asset == "base" ? " AND outputs.asset IS NULL " : " AND outputs.asset="+db.escape(asset);
	db.query(
		"SELECT DISTINCT shared_address FROM shared_address_signing_paths CROSS JOIN outputs ON shared_address_signing_paths.shared_address=outputs.address\n\
		 WHERE device_address=? AND outputs.is_spent=0" + asset_filter, [device_address], function(rows){
			if (rows.length === 0)
				return callbacks.ifNoFundedSharedAddress();
			rows.forEach(function(row){
				sendSharedAddressToPeer(device_address, row.shared_address, function(err){
					if (err)
						return console.log(err)
					console.log("Definition for " + row.shared_address + " will be sent to " + device_address);
				});
			});
				return callbacks.ifFundedSharedAddress(rows.length);
	});
}

// read shared address definition and signing paths then send them to peer
function sendSharedAddressToPeer(device_address, shared_address, handle){
	var arrDefinition;
	var assocSignersByPath={};
	async.series([
		function(cb){
			db.query("SELECT definition FROM shared_addresses WHERE shared_address=?", [shared_address], function(rows){
				if (!rows[0])
					return cb("Definition not found for " + shared_address);
				arrDefinition = JSON.parse(rows[0].definition);
				return cb(null);
			});
		},
		function(cb){
			db.query("SELECT signing_path,address,member_signing_path,device_address FROM shared_address_signing_paths WHERE shared_address=?", [shared_address], function(rows){
				if (rows.length<2)
					return cb("Less than 2 signing paths found for " + shared_address);
				rows.forEach(function(row){
					assocSignersByPath[row.signing_path] = {address: row.address, member_signing_path: row.member_signing_path, device_address: row.device_address};
				});
				return cb(null);
			});
		}
	],
	function(err){
		if (err)
			return handle(err);
		sendNewSharedAddress(device_address, shared_address, arrDefinition, assocSignersByPath);
		return handle(null);
	});
}


// called from UI (unused)
// my address is not filled explicitly, it is specified as variable in the template like external addresses
// assocMyDeviceAddressesByRelativeSigningPaths points to my device addresses that hold the actual signing keys
function createNewSharedAddressByTemplate(arrAddressDefinitionTemplate, my_address, assocMyDeviceAddressesByRelativeSigningPaths){
	validateAddressDefinitionTemplate(arrAddressDefinitionTemplate, device.getMyDeviceAddress(), function(err, assocMemberDeviceAddressesBySigningPaths){
		if(err) {
			throw Error(err);
		}

		// assocMemberDeviceAddressesBySigningPaths are keyed by paths from root to member addresses (not all the way to signing keys)
		var arrMemberSigningPaths = Object.keys(assocMemberDeviceAddressesBySigningPaths);
		var address_definition_template_chash = objectHash.getChash160(arrAddressDefinitionTemplate);
		db.query(
			"INSERT INTO pending_shared_addresses (definition_template_chash, definition_template) VALUES(?,?)", 
			[address_definition_template_chash, JSON.stringify(arrAddressDefinitionTemplate)],
			function(){
				async.eachSeries(
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

// unused
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
										forwardNewSharedAddressToCosignersOfMyMemberAddresses(shared_address, arrDefinition, assocSignersByPath);
										if (conf.bLight)
											network.addLightWatchedAddress(shared_address);
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

// unused
function deletePendingSharedAddress(address_definition_template_chash){
	db.query("DELETE FROM pending_shared_address_signing_paths WHERE definition_template_chash=?", [address_definition_template_chash], function(){
		db.query("DELETE FROM pending_shared_addresses WHERE definition_template_chash=?", [address_definition_template_chash], function(){});
	});
}

// called from network after the initiator collects approvals from all members of the address and then sends the completed address to all members
// member_signing_path is now deprecated and unused
// shared_address_signing_paths.signing_path is now path to member-address, not full path to a signing key
function addNewSharedAddress(address, arrDefinition, assocSignersByPath, bForwarded, callbacks){
//	network.addWatchedAddress(address);
	db.query(
		"INSERT "+db.getIgnore()+" INTO shared_addresses (shared_address, definition) VALUES (?,?)", 
		[address, JSON.stringify(arrDefinition)], 
		function(){
			var arrQueries = [];
			for (var signing_path in assocSignersByPath){
				var signerInfo = assocSignersByPath[signing_path];
				db.addQuery(arrQueries, 
					"INSERT "+db.getIgnore()+" INTO shared_address_signing_paths \n\
					(shared_address, address, signing_path, member_signing_path, device_address) VALUES (?,?,?,?,?)", 
					[address, signerInfo.address, signing_path, signerInfo.member_signing_path, signerInfo.device_address]);
			}
			async.series(arrQueries, function(){
				console.log('added new shared address '+address);
				eventBus.emit("new_address-"+address);
				eventBus.emit("new_address", address);

				if (conf.bLight){
					db.query("INSERT " + db.getIgnore() + " INTO unprocessed_addresses (address) VALUES (?)", [address], callbacks.ifOk);
				} else if (callbacks)
					callbacks.ifOk();
				if (!bForwarded)
					forwardNewSharedAddressToCosignersOfMyMemberAddresses(address, arrDefinition, assocSignersByPath);
			
			});
		}
	);
}

function includesMyDeviceAddress(assocSignersByPath){
	for (var signing_path in assocSignersByPath){
		var signerInfo = assocSignersByPath[signing_path];
		if (signerInfo.device_address === device.getMyDeviceAddress())
			return true;
	}
	return false;
}

// Checks if any of my payment addresses is mentioned.
// It is possible that my device address is not mentioned in the definition if I'm a member of multisig address, one of my cosigners is mentioned instead
function determineIfIncludesMeAndRewriteDeviceAddress(assocSignersByPath, handleResult){
	var assocMemberAddresses = {};
	var bHasMyDeviceAddress = false;
	for (var signing_path in assocSignersByPath){
		var signerInfo = assocSignersByPath[signing_path];
		if (signerInfo.device_address === device.getMyDeviceAddress())
			bHasMyDeviceAddress = true;
		if (signerInfo.address)
			assocMemberAddresses[signerInfo.address] = true;
	}
	var arrMemberAddresses = Object.keys(assocMemberAddresses);
	if (arrMemberAddresses.length === 0)
		return handleResult("no member addresses?");
	db.query(
		"SELECT address, 'my' AS type FROM my_addresses WHERE address IN(?) \n\
		UNION \n\
		SELECT shared_address AS address, 'shared' AS type FROM shared_addresses WHERE shared_address IN(?)", 
		[arrMemberAddresses, arrMemberAddresses],
		function(rows){
		//	handleResult(rows.length === arrMyMemberAddresses.length ? null : "Some of my member addresses not found");
			if (rows.length === 0)
				return handleResult("I am not a member of this shared address");
			var arrMyMemberAddresses = rows.filter(function(row){ return (row.type === 'my'); }).map(function(row){ return row.address; });
			// rewrite device address for my addresses
			if (!bHasMyDeviceAddress){
				for (var signing_path in assocSignersByPath){
					var signerInfo = assocSignersByPath[signing_path];
					if (signerInfo.address && arrMyMemberAddresses.indexOf(signerInfo.address) >= 0)
						signerInfo.device_address = device.getMyDeviceAddress();
				}
			}
			handleResult();
		}
	);
}

function forwardNewSharedAddressToCosignersOfMyMemberAddresses(address, arrDefinition, assocSignersByPath){
	var assocMyMemberAddresses = {};
	for (var signing_path in assocSignersByPath){
		var signerInfo = assocSignersByPath[signing_path];
		if (signerInfo.device_address === device.getMyDeviceAddress() && signerInfo.address)
			assocMyMemberAddresses[signerInfo.address] = true;
	}
	var arrMyMemberAddresses = Object.keys(assocMyMemberAddresses);
	if (arrMyMemberAddresses.length === 0)
		throw Error("my member addresses not found");
	db.query(
		"SELECT DISTINCT device_address FROM my_addresses JOIN wallet_signing_paths USING(wallet) WHERE address IN(?) AND device_address!=?", 
		[arrMyMemberAddresses, device.getMyDeviceAddress()],
		function(rows){
			rows.forEach(function(row){
				sendNewSharedAddress(row.device_address, address, arrDefinition, assocSignersByPath, true);
			});
		}
	);
}

// {address: "BASE32", definition: [...], signers: {...}}
function handleNewSharedAddress(body, callbacks){
	if (!ValidationUtils.isArrayOfLength(body.definition, 2))
		return callbacks.ifError("invalid definition");
	if (typeof body.signers !== "object" || Object.keys(body.signers).length === 0)
		return callbacks.ifError("invalid signers");
	if (body.address !== objectHash.getChash160(body.definition))
		return callbacks.ifError("definition doesn't match its c-hash");
	for (var signing_path in body.signers){
		var signerInfo = body.signers[signing_path];
		if (signerInfo.address && signerInfo.address !== 'secret' && !ValidationUtils.isValidAddress(signerInfo.address))
			return callbacks.ifError("invalid member address: "+signerInfo.address);
	}
	determineIfIncludesMeAndRewriteDeviceAddress(body.signers, function(err){
		if (err)
			return callbacks.ifError(err);
		validateAddressDefinition(body.definition, function(err){
			if (err)
				return callbacks.ifError(err);
			addNewSharedAddress(body.address, body.definition, body.signers, body.forwarded, callbacks);
		});
	});
}

function createNewSharedAddress(arrDefinition, assocSignersByPath, callbacks){
	if (!includesMyDeviceAddress(assocSignersByPath))
		return callbacks.ifError("my device address not mentioned");
	var address = objectHash.getChash160(arrDefinition);
	handleNewSharedAddress({address: address, definition: arrDefinition, signers: assocSignersByPath}, {
		ifError: callbacks.ifError,
		ifOk: function(){
			// share the new address with all cosigners
			var arrDeviceAddresses = [];
			for (var signing_path in assocSignersByPath){
				var signerInfo = assocSignersByPath[signing_path];
				if (signerInfo.device_address !== device.getMyDeviceAddress() && arrDeviceAddresses.indexOf(signerInfo.device_address) === -1)
					arrDeviceAddresses.push(signerInfo.device_address);
			}
			arrDeviceAddresses.forEach(function(device_address){
				sendNewSharedAddress(device_address, address, arrDefinition, assocSignersByPath);
			});
			callbacks.ifOk(address);
		}
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
				break;
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
	Definition.validateDefinition(db, arrFakeDefinition, objFakeUnit, objFakeValidationState, null, false, function(err){
		if (err)
			return handleResult(err);
		handleResult(null, assocMemberDeviceAddressesBySigningPaths);
	});
}

// fix:
// 1. check that my address is referenced in the definition
function validateAddressDefinition(arrDefinition, handleResult){
	var objFakeUnit = {authors: []};
	var objFakeValidationState = {last_ball_mci: MAX_INT32, bAllowUnresolvedInnerDefinitions: true};
	Definition.validateDefinition(db, arrDefinition, objFakeUnit, objFakeValidationState, null, false, function(err){
		if (err)
			return handleResult(err);
		handleResult();
	});
}


function forwardPrivateChainsToOtherMembersOfAddresses(arrChains, arrAddresses, conn, onSaved){
	conn = conn || db;
	conn.query(
		"SELECT device_address FROM shared_address_signing_paths WHERE shared_address IN(?) AND device_address!=?", 
		[arrAddresses, device.getMyDeviceAddress()], 
		function(rows){
			console.log("shared address devices: "+rows.length);
			var arrDeviceAddresses = rows.map(function(row){ return row.device_address; });
			walletGeneral.forwardPrivateChainsToDevices(arrDeviceAddresses, arrChains, true, conn, onSaved);
		}
	);
}

function readAllControlAddresses(conn, arrAddresses, handleLists){
	conn = conn || db;
	conn.query(
		"SELECT DISTINCT address, shared_address_signing_paths.device_address, (correspondent_devices.device_address IS NOT NULL) AS have_correspondent \n\
		FROM shared_address_signing_paths LEFT JOIN correspondent_devices USING(device_address) WHERE shared_address IN(?)", 
		[arrAddresses], 
		function(rows){
			if (rows.length === 0)
				return handleLists([], []);
			var arrControlAddresses = rows.map(function(row){ return row.address; });
			var arrControlDeviceAddresses = rows.filter(function(row){ return row.have_correspondent; }).map(function(row){ return row.device_address; });
			readAllControlAddresses(conn, arrControlAddresses, function(arrControlAddresses2, arrControlDeviceAddresses2){
				handleLists(_.union(arrControlAddresses, arrControlAddresses2), _.union(arrControlDeviceAddresses, arrControlDeviceAddresses2));
			});
		}
	);
}


/*
function readRequiredCosigners(shared_address, arrSigningDeviceAddresses, handleCosigners){
	db.query(
		"SELECT shared_address_signing_paths.address \n\
		FROM shared_address_signing_paths \n\
		LEFT JOIN unit_authors USING(address) \n\
		WHERE shared_address=? AND device_address IN(?) AND unit_authors.address IS NULL",
		[shared_address, arrSigningDeviceAddresses],
		function(rows){
			handleCosigners(rows.map(function(row){ return row.address; }));
		}
	);
}*/

function readSharedAddressDefinition(shared_address, handleDefinition){
	db.query(
		"SELECT definition, "+db.getUnixTimestamp("creation_date")+" AS creation_ts FROM shared_addresses WHERE shared_address=?", 
		[shared_address], 
		function(rows){
			if (rows.length !== 1)
				throw Error('shared definition not found '+shared_address);
			var arrDefinition = JSON.parse(rows[0].definition);
			handleDefinition(arrDefinition, rows[0].creation_ts);
		}
	);
}

// returns information about cosigner devices
function readSharedAddressCosigners(shared_address, handleCosigners){
	db.query(
		"SELECT DISTINCT shared_address_signing_paths.device_address, name, "+db.getUnixTimestamp("shared_addresses.creation_date")+" AS creation_ts \n\
		FROM shared_address_signing_paths \n\
		JOIN shared_addresses USING(shared_address) \n\
		LEFT JOIN correspondent_devices USING(device_address) \n\
		WHERE shared_address=? AND device_address!=?",
		[shared_address, device.getMyDeviceAddress()],
		function(rows){
			if (rows.length === 0)
				throw Error("no cosigners found for shared address "+shared_address);
			handleCosigners(rows);
		}
	);
}

// returns list of payment addresses of peers
function readSharedAddressPeerAddresses(shared_address, handlePeerAddresses){
	readSharedAddressPeers(shared_address, function(assocNamesByAddress){
		handlePeerAddresses(Object.keys(assocNamesByAddress));
	});
}

// returns assoc array: peer name by address
function readSharedAddressPeers(shared_address, handlePeers){
	db.query(
		"SELECT DISTINCT address, name FROM shared_address_signing_paths LEFT JOIN correspondent_devices USING(device_address) \n\
		WHERE shared_address=? AND shared_address_signing_paths.device_address!=?",
		[shared_address, device.getMyDeviceAddress()],
		function(rows){
			// no problem if no peers found: the peer can be part of our multisig address and his device address will be rewritten to ours
		//	if (rows.length === 0)
		//		throw Error("no peers found for shared address "+shared_address);
			var assocNamesByAddress = {};
			rows.forEach(function(row){
				assocNamesByAddress[row.address] = row.name || 'unknown peer';
			});
			handlePeers(assocNamesByAddress);
		}
	);
}

function getPeerAddressesFromSigners(assocSignersByPath){
	var assocPeerAddresses = {};
	for (var path in assocSignersByPath){
		var signerInfo = assocSignersByPath[path];
		if (signerInfo.device_address !== device.getMyDeviceAddress())
			assocPeerAddresses[signerInfo.address] = true;
	}
	var arrPeerAddresses = Object.keys(assocPeerAddresses);
	return arrPeerAddresses;
}

function determineIfHasMerkle(shared_address, handleResult){
	db.query(
		"SELECT 1 FROM shared_address_signing_paths WHERE shared_address=? AND device_address=? AND address=''",
		[shared_address, device.getMyDeviceAddress()],
		function(rows){
			handleResult(rows.length > 0);
		}
	);
}




exports.validateAddressDefinitionTemplate = validateAddressDefinitionTemplate;
exports.approvePendingSharedAddress = approvePendingSharedAddress;
exports.deletePendingSharedAddress = deletePendingSharedAddress;
exports.validateAddressDefinition = validateAddressDefinition;
exports.handleNewSharedAddress = handleNewSharedAddress;
exports.forwardPrivateChainsToOtherMembersOfAddresses = forwardPrivateChainsToOtherMembersOfAddresses;
exports.readSharedAddressCosigners = readSharedAddressCosigners;
exports.readSharedAddressPeerAddresses = readSharedAddressPeerAddresses;
exports.readSharedAddressPeers = readSharedAddressPeers;
exports.getPeerAddressesFromSigners = getPeerAddressesFromSigners;
exports.readSharedAddressDefinition = readSharedAddressDefinition;
exports.determineIfHasMerkle = determineIfHasMerkle;
exports.createNewSharedAddress = createNewSharedAddress;
exports.createNewSharedAddressByTemplate = createNewSharedAddressByTemplate;
exports.readAllControlAddresses = readAllControlAddresses;
exports.sendToPeerAllSharedAddressesHavingUnspentOutputs = sendToPeerAllSharedAddressesHavingUnspentOutputs;
exports.sendSharedAddressToPeer = sendSharedAddressToPeer;