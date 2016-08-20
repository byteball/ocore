/*jslint node: true */
"use strict";
var async = require('async');
var crypto = require('crypto');
var db = require('./db.js');
var constants = require('./constants.js');
var conf = require('./conf.js');
var composer = require('./composer.js');
var objectHash = require('./object_hash.js');
var _ = require('lodash');
var storage = require('./storage.js');
var network = require('./network.js');
var device = require('./device.js');
var walletGeneral = require('./wallet_general.js');
var eventBus = require('./event_bus.js');
var Definition = require("./definition.js");
var ValidationUtils = require("./validation_utils.js");
var indivisibleAsset = require('./indivisible_asset.js');
var divisibleAsset = require('./divisible_asset.js');
try{
	var Bitcore = require('bitcore-lib');
}
catch(e){ // if byteballcore is a symlink, load bitcore-lib from the main module
	var Bitcore = loadBitcoreFromNearestParent(module.parent);
}

var MAX_BIP44_GAP = 20;
var MAX_INT32 = Math.pow(2, 31) - 1;

function loadBitcoreFromNearestParent(mod){
	if (!mod)
		throw Error("reached root but bitcore not found");
	try{
		return require(mod.paths[0]+'/bitcore-lib');
	}
	catch(e){
		console.log("bitcore-lib not found from "+mod.filename+", will try from its parent");
		return loadBitcoreFromNearestParent(mod.parent);
	}
}

function sendOfferToCreateNewWallet(device_address, wallet, arrWalletDefinitionTemplate, walletName, arrOtherCosigners, callbacks){
	var body = {wallet: wallet, wallet_definition_template: arrWalletDefinitionTemplate, wallet_name: walletName, other_cosigners: arrOtherCosigners};
	device.sendMessageToDevice(device_address, "create_new_wallet", body, callbacks);
}

function sendCommandToCancelNewWallet(device_address, wallet, callbacks){
	device.sendMessageToDevice(device_address, "cancel_new_wallet", {wallet: wallet}, callbacks);
}

function sendMyXPubKey(device_address, wallet, my_xpubkey){
	device.sendMessageToDevice(device_address, "my_xpubkey", {wallet: wallet, my_xpubkey: my_xpubkey});
}

function sendNotificationThatWalletFullyApproved(device_address, wallet){
	device.sendMessageToDevice(device_address, "wallet_fully_approved", {wallet: wallet});
}

function sendNewWalletAddress(device_address, wallet, is_change, address_index, address){
	device.sendMessageToDevice(device_address, "new_wallet_address", {
		wallet: wallet, address: address, is_change: is_change, address_index: address_index
	});
}



// {wallet: "base64", wallet_definition_template: [...]}
function handleOfferToCreateNewWallet(body, from_address, callbacks){
	if (!ValidationUtils.isNonemptyString(body.wallet))
		return callbacks.ifError("no wallet");
	if (!ValidationUtils.isNonemptyString(body.wallet_name))
		return callbacks.ifError("no wallet_name");
	if (body.wallet.length > constants.HASH_LENGTH)
		return callbacks.ifError("wallet too long");
	if (body.wallet_name.length > 200)
		return callbacks.ifError("wallet_name too long");
	if (!ValidationUtils.isArrayOfLength(body.wallet_definition_template, 2))
		return callbacks.ifError("no definition template");
	if (!ValidationUtils.isNonemptyArray(body.other_cosigners))
		return callbacks.ifError("no other_cosigners");
	// the wallet should have an event handler that requests user confirmation, derives (or generates) a new key, records it, 
	// and sends the newly derived xpubkey to other members
	validateWalletDefinitionTemplate(body.wallet_definition_template, from_address, function(err, arrDeviceAddresses){
		if (err)
			return callbacks.ifError(err);
		if (body.other_cosigners.length !== arrDeviceAddresses.length - 1)
			return callbacks.ifError("wrong length of other_cosigners");
		var arrOtherDeviceAddresses = _.uniq(body.other_cosigners.map(function(cosigner){ return cosigner.device_address; }));
		arrOtherDeviceAddresses.push(from_address);
		if (!_.isEqual(arrDeviceAddresses.sort(), arrOtherDeviceAddresses.sort()))
			return callbacks.ifError("wrong other_cosigners");
		for (var i=0; i<body.other_cosigners.length; i++){
			var cosigner = body.other_cosigners[i];
			if (!ValidationUtils.isStringOfLength(cosigner.pubkey, constants.PUBKEY_LENGTH))
				return callbacks.ifError("bad pubkey");
			if (cosigner.device_address !== objectHash.getDeviceAddress(cosigner.pubkey))
				return callbacks.ifError("bad cosigner device address");
			if (!ValidationUtils.isNonemptyString(cosigner.name))
				return callbacks.ifError("no cosigner name");
			if (cosigner.name.length > 100)
				return callbacks.ifError("cosigner name too long");
			if (!ValidationUtils.isNonemptyString(cosigner.hub))
				return callbacks.ifError("no cosigner hub");
			if (cosigner.hub.length > 100)
				return callbacks.ifError("cosigner hub too long");
		}
		eventBus.emit("create_new_wallet", body.wallet, body.wallet_definition_template, arrDeviceAddresses, body.wallet_name, body.other_cosigners);
		callbacks.ifOk();
	});
}



function readNextAccount(handleAccount){
	db.query("SELECT MAX(account) AS max_account FROM wallets", function(rows){
		var account = (rows.length === 0) ? 0 : (rows[0].max_account + 1);
		handleAccount(account);
	});
}

// check that all members agree that the wallet is fully approved now
function checkAndFinalizeWallet(wallet, onDone){
	db.query("SELECT member_ready_date FROM wallets LEFT JOIN extended_pubkeys USING(wallet) WHERE wallets.wallet=?", [wallet], function(rows){
		if (rows.length === 0) // wallet not created yet
			throw Error("no wallet in checkAndFinalizeWallet");
		if (rows.some(function(row){ return !row.member_ready_date; }))
			return onDone ? onDone() : null;
		db.query("UPDATE wallets SET ready_date="+db.getNow()+" WHERE wallet=? AND ready_date IS NULL", [wallet], function(){
			if (onDone)
				onDone();
			eventBus.emit('wallet_completed', wallet);
		});
	});
}

function checkAndFullyApproveWallet(wallet, onDone){
	db.query("SELECT approval_date FROM wallets LEFT JOIN extended_pubkeys USING(wallet) WHERE wallets.wallet=?", [wallet], function(rows){
		if (rows.length === 0) // wallet not created yet
			return onDone ? onDone() : null;
		if (rows.some(function(row){ return !row.approval_date; }))
			return onDone ? onDone() : null;
		db.query("UPDATE wallets SET full_approval_date="+db.getNow()+" WHERE wallet=? AND full_approval_date IS NULL", [wallet], function(){
			db.query(
				"UPDATE extended_pubkeys SET member_ready_date="+db.getNow()+" WHERE wallet=? AND device_address=?", 
				[wallet, device.getMyDeviceAddress()], 
				function(){
					db.query(
						"SELECT device_address FROM extended_pubkeys WHERE wallet=? AND device_address!=?", 
						[wallet, device.getMyDeviceAddress()], 
						function(rows){
							// let other members know that I've collected all necessary xpubkeys and ready to use this wallet
							rows.forEach(function(row){
								sendNotificationThatWalletFullyApproved(row.device_address, wallet);
							});
							checkAndFinalizeWallet(wallet, onDone);
						}
					);
				}
			);
		});
	});
}

function addWallet(wallet, xPubKey, account, arrWalletDefinitionTemplate, onDone){
	var assocDeviceAddressesBySigningPaths = getDeviceAddressesBySigningPaths(arrWalletDefinitionTemplate);
	var arrDeviceAddresses = _.uniq(_.values(assocDeviceAddressesBySigningPaths));
	
	async.series([
		function(cb){
			var fields = "wallet, account, definition_template";
			var values = "?,?,?";
			if (arrDeviceAddresses.length === 1){ // single sig
				fields += ", full_approval_date, ready_date";
				values += ", "+db.getNow()+", "+db.getNow();
			}
			db.query("INSERT INTO wallets ("+fields+") VALUES ("+values+")", [wallet, account, JSON.stringify(arrWalletDefinitionTemplate)], function(){
				cb();
			});
		},
		function(cb){
			async.eachSeries(
				arrDeviceAddresses,
				function(device_address, cb2){
					console.log("adding device "+device_address);
					var fields = "wallet, device_address";
					var values = "?,?";
					var arrParams = [wallet, device_address];
					if (device_address === device.getMyDeviceAddress()){
						fields += ", extended_pubkey, approval_date";
						values += ",?,"+db.getNow();
						arrParams.push(xPubKey);
						if (arrDeviceAddresses.length === 1){
							fields += ", member_ready_date";
							values += ", "+db.getNow();
						}
					}
					db.query("INSERT "+db.getIgnore()+" INTO extended_pubkeys ("+fields+") VALUES ("+values+")", arrParams, function(){
						cb2();
					});
				},
				cb
			);
		},
		function(cb){
			var arrSigningPaths = Object.keys(assocDeviceAddressesBySigningPaths);
			async.eachSeries(
				arrSigningPaths,
				function(signing_path, cb2){
					console.log("adding signing path "+signing_path);
					var device_address = assocDeviceAddressesBySigningPaths[signing_path];
					db.query(
						"INSERT INTO wallet_signing_paths (wallet, signing_path, device_address) VALUES (?,?,?)", 
						[wallet, signing_path, device_address], 
						function(){
							cb2();
						}
					);
				},
				cb
			);
		}
	], function(){
		console.log("addWallet done");
		(arrDeviceAddresses.length === 1) ? onDone() : checkAndFullyApproveWallet(wallet, onDone);
	});
}

// initiator of the new wallet creates records about itself and sends requests to other devices
function createWallet(xPubKey, account, arrWalletDefinitionTemplate, walletName, handleWallet){
	var wallet = crypto.createHash("sha256").update(xPubKey, "utf8").digest("base64");
	var arrDeviceAddresses = getDeviceAddresses(arrWalletDefinitionTemplate);
	addWallet(wallet, xPubKey, account, arrWalletDefinitionTemplate, function(){
		handleWallet(wallet);
		if (arrDeviceAddresses.length === 1) // single sig
			return;
		console.log("will send offers");
		// this continues in parallel while the callback handleWallet was already called
		// We need arrOtherCosigners to make sure all cosigners know the pubkeys of all other cosigners, even when they were not paired.
		// For example, there are 3 cosigners: A (me), B, and C. A is paired with B, A is paired with C, but B is not paired with C.
		device.readCorrespondentsByDeviceAddresses(arrDeviceAddresses, function(arrOtherCosigners){
			if (arrOtherCosigners.length !== arrDeviceAddresses.length - 1)
				throw Error("incorrect length of other cosigners");
			arrDeviceAddresses.forEach(function(device_address){
				if (device_address === device.getMyDeviceAddress())
					return;
				console.log("sending offer to "+device_address);
				sendOfferToCreateNewWallet(device_address, wallet, arrWalletDefinitionTemplate, walletName, arrOtherCosigners);
				sendMyXPubKey(device_address, wallet, xPubKey);
			});
		});
	});
}

function createMultisigWallet(xPubKey, account, count_required_signatures, arrDeviceAddresses, walletName, handleWallet){
	if (count_required_signatures > arrDeviceAddresses.length)
		throw "required > length";
	var set = arrDeviceAddresses.map(function(device_address){ return ["sig", {pubkey: '$pubkey@'+device_address}]; });
	var arrDefinitionTemplate = ["r of set", {required: count_required_signatures, set: set}];
	createWallet(xPubKey, account, arrDefinitionTemplate, walletName, handleWallet);
}

// walletName will not be used
function createSinglesigWallet(xPubKey, account, walletName, handleWallet){
	var arrDefinitionTemplate = ["sig", {pubkey: '$pubkey@'+device.getMyDeviceAddress()}];
	createWallet(xPubKey, account, arrDefinitionTemplate, walletName, handleWallet);
}

// called from UI
function createWalletByDevices(xPubKey, account, count_required_signatures, arrOtherDeviceAddresses, walletName, handleWallet){
	if (arrOtherDeviceAddresses.length === 0)
		createSinglesigWallet(xPubKey, account, walletName, handleWallet);
	else
		createMultisigWallet(xPubKey, account, count_required_signatures, 
				[device.getMyDeviceAddress()].concat(arrOtherDeviceAddresses), walletName, handleWallet);
}

// called from UI after user confirms creation of wallet initiated by another device
function approveWallet(wallet, xPubKey, account, arrWalletDefinitionTemplate, arrOtherCosigners, onDone){
	var arrDeviceAddresses = getDeviceAddresses(arrWalletDefinitionTemplate);
	device.addIndirectCorrespondents(arrOtherCosigners, function(){
		addWallet(wallet, xPubKey, account, arrWalletDefinitionTemplate, function(){
			arrDeviceAddresses.forEach(function(device_address){
				if (device_address !== device.getMyDeviceAddress())
					sendMyXPubKey(device_address, wallet, xPubKey);
			});
			if (onDone)
				onDone();
		});
	});
}

// called from UI
function cancelWallet(wallet, arrDeviceAddresses, arrOtherCosigners){
	console.log("canceling wallet "+wallet);
	// some of the cosigners might not be paired
	/*
	arrDeviceAddresses.forEach(function(device_address){
		if (device_address !== device.getMyDeviceAddress())
			sendCommandToCancelNewWallet(device_address, wallet);
	});*/
	var arrOtherDeviceAddresses = _.uniq(arrOtherCosigners.map(function(cosigner){ return cosigner.device_address; }));
	var arrInitiatorDeviceAddresses = _.difference(arrDeviceAddresses, arrOtherDeviceAddresses);
	if (arrInitiatorDeviceAddresses.length !== 1)
		throw "not one initiator?";
	var initiator_device_address = arrInitiatorDeviceAddresses[0];
	sendCommandToCancelNewWallet(initiator_device_address, wallet);
	arrOtherCosigners.forEach(function(cosigner){
		if (cosigner.device_address === device.getMyDeviceAddress())
			return;
		// can't use device.sendMessageToDevice because some of the proposed cosigners might not be paired
		device.sendMessageToHub(cosigner.hub, cosigner.pubkey, "cancel_new_wallet", {wallet: wallet});
	});
	db.query("DELETE FROM extended_pubkeys WHERE wallet=?", [wallet], function(){
		db.query("DELETE FROM wallet_signing_paths WHERE wallet=?", [wallet], function(){});
	});
}

// called from network, without user interaction
// One of the proposed cosigners declined wallet creation
function deleteWallet(wallet, rejector_device_address, onDone){
	db.query("SELECT approval_date FROM extended_pubkeys WHERE wallet=? AND device_address=?", [wallet, rejector_device_address], function(rows){
		if (rows.length === 0) // you are not a member device
			return onDone();
		if (rows[0].approval_date) // you've already approved this wallet, you can't change your mind
			return onDone();
		db.query("SELECT device_address FROM extended_pubkeys WHERE wallet=?", [wallet], function(rows){
			var arrMemberAddresses = rows.map(function(row){ return row.device_address; });
			var arrQueries = [];
			db.addQuery(arrQueries, "DELETE FROM extended_pubkeys WHERE wallet=?", [wallet]);
			db.addQuery(arrQueries, "DELETE FROM wallet_signing_paths WHERE wallet=?", [wallet]);
			db.addQuery(arrQueries, "DELETE FROM wallets WHERE wallet=?", [wallet]);
			// delete unused indirect correspondents
			db.addQuery(
				arrQueries, 
				"DELETE FROM correspondent_devices WHERE is_indirect=1 AND device_address IN(?) AND NOT EXISTS ( \n\
					SELECT * FROM extended_pubkeys WHERE extended_pubkeys.device_address=correspondent_devices.device_address \n\
				)", 
				[arrMemberAddresses]
			);
			async.series(arrQueries, function(){
				eventBus.emit('wallet_declined', wallet, rejector_device_address);
				onDone();
			});
		});
	});
}

// called from network, without user interaction
function addDeviceXPubKey(wallet, device_address, xPubKey, onDone){
	db.query(
		"INSERT "+db.getIgnore()+" INTO extended_pubkeys (wallet, device_address) VALUES(?,?)",
		[wallet, device_address],
		function(){
			db.query(
				"UPDATE extended_pubkeys SET extended_pubkey=?, approval_date="+db.getNow()+" WHERE wallet=? AND device_address=?", 
				[xPubKey, wallet, device_address],
				function(){
					eventBus.emit('wallet_approved', wallet, device_address);
					checkAndFullyApproveWallet(wallet, onDone);
				}
			);
		}
	);
}

// called from network, without user interaction
function handleNotificationThatWalletFullyApproved(wallet, device_address, onDone){
	db.query( // just in case it was not inserted yet
		"INSERT "+db.getIgnore()+" INTO extended_pubkeys (wallet, device_address) VALUES(?,?)",
		[wallet, device_address],
		function(){
			db.query(
				"UPDATE extended_pubkeys SET member_ready_date="+db.getNow()+" WHERE wallet=? AND device_address=?", 
				[wallet, device_address],
				function(){
					checkAndFinalizeWallet(wallet, onDone);
				}
			);
		}
	);
}

function readCosigners(wallet, handleCosigners){
	db.query(
		"SELECT extended_pubkeys.device_address, name, approval_date, extended_pubkey \n\
		FROM extended_pubkeys LEFT JOIN correspondent_devices USING(device_address) WHERE wallet=?", 
		[wallet], 
		function(rows){
			rows.forEach(function(row){
				if (row.device_address === device.getMyDeviceAddress()){
					if (row.name !== null)
						throw Error("found self in correspondents");
					row.me = true;
				}
				else if (row.name === null)
					throw Error("cosigner not found among correspondents, cosigner="+row.device_address+", my="+device.getMyDeviceAddress());
			});
			handleCosigners(rows);
		}
	);
}

// silently adds new address upon receiving a network message
function addNewAddress(wallet, is_change, address_index, address, handleError){
	deriveAddress(wallet, is_change, address_index, function(new_address, arrDefinition){
		if (new_address !== address)
			return handleError("I derived address "+new_address+", your address "+address);
		recordAddress(wallet, is_change, address_index, address, arrDefinition, function(){
			eventBus.emit("new_wallet_address", address);
			handleError();
		});
	});
}

function getDeviceAddresses(arrWalletDefinitionTemplate){
	return _.uniq(_.values(getDeviceAddressesBySigningPaths(arrWalletDefinitionTemplate)));
}

function getDeviceAddressesBySigningPaths(arrWalletDefinitionTemplate){
	function evaluate(arr, path){
		var op = arr[0];
		var args = arr[1];
		if (!args)
			return;
		var prefix = '$pubkey@';
		switch (op){
			case 'sig':
				if (!args.pubkey || args.pubkey.substr(0, prefix.length) !== prefix)
					return;
				var device_address = args.pubkey.substr(prefix.length);
				assocDeviceAddressesBySigningPaths[path] = device_address;
				break;
			case 'hash':
				if (!args.hash || args.hash.substr(0, prefix.length) !== prefix)
					return;
				var device_address = args.hash.substr(prefix.length);
				assocDeviceAddressesBySigningPaths[path] = device_address;
				break;
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
			case 'definition template':
				throw op+" not supported yet";
			// all other ops cannot reference device address
		}
	}
	var assocDeviceAddressesBySigningPaths = {};
	evaluate(arrWalletDefinitionTemplate, 'r');
	return assocDeviceAddressesBySigningPaths;
}

function validateWalletDefinitionTemplate(arrWalletDefinitionTemplate, from_address, handleResult){
	var arrDeviceAddresses = getDeviceAddresses(arrWalletDefinitionTemplate);
	if (arrDeviceAddresses.indexOf(device.getMyDeviceAddress()) === - 1)
		return handleResult("my device address not mentioned in the definition");
	if (arrDeviceAddresses.indexOf(from_address) === - 1)
		return handleResult("sender device address not mentioned in the definition");
	
	var params = {};
	// to fill the template for validation, assign my public key to all member devices
	arrDeviceAddresses.forEach(function(device_address){
		params['pubkey@'+device_address] = device.getMyDevicePubKey();
	});
	try{
		var arrFakeDefinition = Definition.replaceInTemplate(arrWalletDefinitionTemplate, params);
	}
	catch(e){
		return handleResult(e.toString());
	}
	var objFakeUnit = {authors: []};
	var objFakeValidationState = {last_ball_mci: MAX_INT32};
	Definition.validateDefinition(db, arrFakeDefinition, objFakeUnit, objFakeValidationState, false, function(err){
		if (err)
			return handleResult(err);
		handleResult(null, arrDeviceAddresses);
	});
}




function readNextAddressIndex(wallet, is_change, handleNextAddressIndex){
	db.query("SELECT MAX(address_index) AS last_used_index FROM my_addresses WHERE wallet=? AND is_change=?", [wallet, is_change], function(rows){
		var last_used_index = rows[0].last_used_index;
		handleNextAddressIndex( (last_used_index === null) ? 0 : (last_used_index+1) );
	});
}


function readLastUsedAddressIndex(wallet, is_change, handleLastUsedAddressIndex){
	db.query(
		"SELECT MAX(address_index) AS last_used_index FROM my_addresses JOIN outputs USING(address) WHERE wallet=? AND is_change=?", 
		[wallet, is_change], 
		function(rows){
			var last_used_index = rows[0].last_used_index;
			handleLastUsedAddressIndex(last_used_index);
		}
	);
}

function derivePubkey(xPubKey, path){
	var hdPubKey = new Bitcore.HDPublicKey(xPubKey);
	return hdPubKey.derive(path).publicKey.toBuffer().toString("base64");
}

function deriveAddress(wallet, is_change, address_index, handleNewAddress){
	db.query("SELECT definition_template, full_approval_date FROM wallets WHERE wallet=?", [wallet], function(wallet_rows){
		if (wallet_rows.length === 0)
			throw "wallet not found";
		if (!wallet_rows[0].full_approval_date)
			throw "wallet not fully approved yet";
		var arrDefinitionTemplate = JSON.parse(wallet_rows[0].definition_template);
		db.query(
			"SELECT device_address, extended_pubkey FROM extended_pubkeys WHERE wallet=?", 
			[wallet], 
			function(rows){
				var path = "m/"+is_change+"/"+address_index;
				var params = {};
				rows.forEach(function(row){
					if (!row.extended_pubkey)
						throw "no extended_pubkey";
					params['pubkey@'+row.device_address] = derivePubkey(row.extended_pubkey, path);
				});
				var arrDefinition = Definition.replaceInTemplate(arrDefinitionTemplate, params);
				var address = objectHash.getChash160(arrDefinition);
				handleNewAddress(address, arrDefinition);
			}
		);
	});
}

function recordAddress(wallet, is_change, address_index, address, arrDefinition, onDone){
	if (typeof address_index === 'string' && is_change)
		throw Error("address with string index cannot be change address");
	var address_index_column_name = (typeof address_index === 'string') ? 'app' : 'address_index';
	db.query( // IGNORE in case the address was already generated
		"INSERT "+db.getIgnore()+" INTO my_addresses (wallet, is_change, "+address_index_column_name+", address, definition) VALUES (?,?,?,?,?)", 
		[wallet, is_change, address_index, address, JSON.stringify(arrDefinition)], 
		function(){
			eventBus.emit("new_address-"+address);
			if (onDone)
				onDone();
			network.addWatchedAddress(address);
			if (conf.bLight && !is_change)
				network.findOutboundPeerOrConnect(network.light_vendor_url, function(err, ws){
					if (err)
						return;
					network.sendJustsaying(ws, 'light/new_address_to_watch', address);
				});
		}
	);
}

function deriveAndRecordAddress(wallet, is_change, address_index, handleNewAddress){
	deriveAddress(wallet, is_change, address_index, function(address, arrDefinition){
		recordAddress(wallet, is_change, address_index, address, arrDefinition, function(){
			handleNewAddress(address);
		});
	});
}

function issueAddress(wallet, is_change, address_index, handleNewAddress){
	deriveAndRecordAddress(wallet, is_change, address_index, function(address){
		db.query("SELECT device_address FROM extended_pubkeys WHERE wallet=?", [wallet], function(rows){
			rows.forEach(function(row){
				if (row.device_address !== device.getMyDeviceAddress())
					sendNewWalletAddress(row.device_address, wallet, is_change, address_index, address);
			});
			handleNewAddress({address: address, is_change: is_change, address_index: address_index, creation_ts: parseInt(Date.now()/1000)});
		});
	});
}


function readAddressByIndex(wallet, is_change, address_index, handleAddress){
	db.query(
		"SELECT address, address_index, "+db.getUnixTimestamp("creation_date")+" AS creation_ts \n\
		FROM my_addresses WHERE wallet=? AND is_change=? AND address_index=?", 
		[wallet, is_change, address_index], 
		function(rows){
			handleAddress(rows[0]);
		}
	);
}

function selectRandomAddress(wallet, is_change, from_index, handleAddress){
	if (from_index === null)
		from_index = -1;
	db.query(
		"SELECT address, address_index, "+db.getUnixTimestamp("creation_date")+" AS creation_ts \n\
		FROM my_addresses WHERE wallet=? AND is_change=? AND address_index>? ORDER BY "+db.getRandom()+" LIMIT 1", 
		[wallet, is_change, from_index], 
		function(rows){
			handleAddress(rows[0]);
		}
	);
}

function issueNextAddress(wallet, is_change, handleAddress){
	readNextAddressIndex(wallet, is_change, function(next_index){
		if (next_index < MAX_BIP44_GAP)
			return issueAddress(wallet, is_change, next_index, handleAddress);
		readLastUsedAddressIndex(wallet, is_change, function(last_used_index){
			if (last_used_index === null || next_index - last_used_index >= MAX_BIP44_GAP)
				selectRandomAddress(wallet, is_change, last_used_index, handleAddress);
			else
				issueAddress(wallet, is_change, next_index, handleAddress);
		});
	});
}

function issueOrSelectNextChangeAddress(wallet, handleAddress){
	readNextAddressIndex(wallet, 1, function(next_index){
		readLastUsedAddressIndex(wallet, 1, function(last_used_index){
			var first_unused_index = (last_used_index === null) ? 0 : (last_used_index + 1);
			if (first_unused_index > next_index)
				throw Error("unued > next")
			if (first_unused_index < next_index)
				readAddressByIndex(wallet, 1, first_unused_index, handleAddress);
			else
				issueAddress(wallet, 1, next_index, handleAddress);
		});
	});
}

function issueOrSelectAddressForApp(wallet, app_name, handleAddress){
	db.query("SELECT address FROM my_addresses WHERE wallet=? AND app=?", [wallet, app_name], function(rows){
		if (rows.length > 1)
			throw Error("more than 1 address for app "+app_name);
		if (rows.length === 1)
			return handleAddress(rows[0].address);
		issueAddress(wallet, 0, app_name, function(addressInfo){
			handleAddress(addressInfo.address);
		});
	});
}

function readExternalAddresses(wallet, opts, handleAddresses){
	var sql = "SELECT address, address_index, "+db.getUnixTimestamp("creation_date")+" AS creation_ts \n\
		FROM my_addresses WHERE wallet=? AND is_change=0 ORDER BY address_index";
	if (opts.reverse)
		sql += " DESC";
	if (opts.limit)
		sql += " LIMIT "+opts.limit;
	db.query(
		sql, 
		[wallet], 
		function(rows){
			handleAddresses(rows);
		}
	);
}

function readChangeAddresses(wallet, handleAddresses){
	var sql = "SELECT address \n\
		FROM my_addresses WHERE wallet=? AND is_change=1 ORDER BY address_index DESC";
	db.query(
		sql, 
		[wallet], 
		function(rows){
			handleAddresses(rows.map(function(row){ return row.address; }));
		}
	);
}

// unused so far
function readAddressInfo(address, handleAddress){
	db.query("SELECT address_index, is_change FROM my_addresses WHERE address=?", [address], function(rows){
		if (rows.length === 0)
			return handleAddress("address "+address+" not found");
		handleAddress(null, rows[0]);
	});
}

function readAllAddresses(wallet, handleAddresses){
	db.query(
		"SELECT address FROM my_addresses WHERE wallet=?", 
		[wallet], 
		function(rows){
			handleAddresses(rows.map(function(row){ return row.address; }));
		}
	);
}







function sendPaymentFromWallet(
		asset, wallet, to_address, amount, change_address, arrSigningDeviceAddresses, recipient_device_address, signWithLocalPrivateKey, handleResult)
{
	if (!wallet)
		throw "no wallet id";
	readAllAddresses(wallet, function(arrFromAddresses){
		if (arrFromAddresses.length === 0)
			return handleResult("no from addresses in wallet "+wallet);
		
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
				conn.query("SELECT definition FROM my_addresses WHERE address=?", [address], function(rows){
					if (rows.length !== 1)
						throw "definition not found";
					handleDefinition(null, JSON.parse(rows[0].definition));
				});
			},
			sign: function(objUnsignedUnit, assocPrivatePayloads, address, signing_path, handleSignature){
				var buf_to_sign = objectHash.getUnitHashToSign(objUnsignedUnit);
				db.query(
					"SELECT device_address, account, is_change, address_index \n\
					FROM my_addresses JOIN wallets USING(wallet) JOIN wallet_signing_paths USING(wallet) \n\
					WHERE address=? AND signing_path=?", 
					[address, signing_path],
					function(rows){
						if (rows.length !== 1)
							throw "not 1 hub";
						var row = rows[0];
						if (row.device_address === device.getMyDeviceAddress()){
							signWithLocalPrivateKey(wallet, row.account, row.is_change, row.address_index, buf_to_sign, function(sig){
								handleSignature(null, sig);
							});
							return;
						}
						// we'll receive this event after the peer signs
						eventBus.once("signature-"+row.device_address+"-"+address+"-"+signing_path+"-"+buf_to_sign.toString("base64"), function(sig){
							handleSignature(null, sig);
							if (sig === '[refused]')
								eventBus.emit('refused_to_sign', row.device_address);
						});
						walletGeneral.sendOfferToSign(row.device_address, address, signing_path, objUnsignedUnit, assocPrivatePayloads);
						if (!bRequestedConfirmation){
							eventBus.emit("confirm_on_other_devices");
							bRequestedConfirmation = true;
						}
					}
				);
			}
		};
		
		var params = {
			available_paying_addresses: arrFromAddresses, // some of them may hold 0 coins
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
				ifOk: function(objJoint, arrChainsOfPrivateElements){
					network.broadcastJoint(objJoint);
					if (arrChainsOfPrivateElements){
						forwardPrivateChainsToOtherMembersOfWallets(arrChainsOfPrivateElements, [wallet]);
						walletGeneral.sendPrivatePayments(recipient_device_address, arrChainsOfPrivateElements);
					}
					else if (recipient_device_address) // send notification about public payment
						walletGeneral.sendPaymentNotification(recipient_device_address, objJoint.unit.unit);
					handleResult();
				}
			}
		};
		
		if (asset && asset !== "base"){
			params.asset = asset;
			params.to_address = to_address;
			params.change_address = change_address;
			params.amount = amount; // in asset units
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
			params.outputs = [{address: to_address, amount: amount}, {address: change_address, amount: 0}];
			composer.composeAndSaveMinimalJoint(params);
		}
	
	});
}


function forwardPrivateChainsToOtherMembersOfWallets(arrChains, arrWallets){
	console.log("forwardPrivateChainsToOtherMembersOfWallets", arrWallets);
	db.query(
		"SELECT device_address FROM extended_pubkeys WHERE wallet IN(?) AND device_address!=?", 
		[arrWallets, device.getMyDeviceAddress()], 
		function(rows){
			console.log("devices: "+rows.length);
			rows.forEach(function(row){
				console.log("forwarding to device "+row.device_address);
				walletGeneral.sendPrivatePayments(row.device_address, arrChains, true);
			});
		}
	);
}



function readBalance(wallet, handleBalance){
	var assocBalances = {base: {stable: 0, pending: 0}};
	db.query(
		"SELECT asset, is_stable, SUM(amount) AS balance \n\
		FROM my_addresses JOIN outputs USING(address) JOIN units USING(unit) \n\
		WHERE is_spent=0 AND wallet=? AND sequence='good' \n\
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
			// add 0-balance assets
			db.query(
				"SELECT DISTINCT asset \n\
				FROM my_addresses JOIN outputs USING(address) JOIN units USING(unit) \n\
				WHERE wallet=? AND sequence='good'", 
				[wallet], 
				function(rows){
					for (var i=0; i<rows.length; i++){
						var row = rows[i];
						var asset = row.asset || "base";
						if (!assocBalances[asset])
							assocBalances[asset] = {stable: 0, pending: 0};
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


function readTransactionHistory(wallet, asset, handleHistory){
	var asset_condition = (asset && asset !== "base") ? "asset="+db.escape(asset) : "asset IS NULL";
	db.query(
		"SELECT unit, level, is_stable, sequence, address, \n\
			"+db.getUnixTimestamp("units.creation_date")+" AS ts, headers_commission+payload_commission AS fee, \n\
			SUM(amount) AS amount, address AS to_address, NULL AS from_address \n\
		FROM my_addresses JOIN outputs USING(address) JOIN units USING(unit) \n\
		WHERE wallet=? AND "+asset_condition+" \n\
		GROUP BY unit, address \n\
		UNION \n\
		SELECT unit, level, is_stable, sequence, address, \n\
			"+db.getUnixTimestamp("units.creation_date")+" AS ts, headers_commission+payload_commission AS fee, \n\
			NULL AS amount, NULL AS to_address, address AS from_address \n\
		FROM my_addresses JOIN inputs USING(address) JOIN units USING(unit) \n\
		WHERE wallet=? AND "+asset_condition,
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
						db.query(
							"SELECT outputs.address, SUM(amount) AS amount \n\
							FROM outputs \n\
							LEFT JOIN my_addresses ON outputs.address=my_addresses.address AND wallet=? \n\
							WHERE unit=? AND "+asset_condition+" AND my_addresses.address IS NULL \n\
							GROUP BY outputs.address", 
							[wallet, unit], 
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


exports.readNextAccount = readNextAccount;
exports.createWalletByDevices = createWalletByDevices;
exports.approveWallet = approveWallet;
exports.cancelWallet = cancelWallet;

exports.handleOfferToCreateNewWallet = handleOfferToCreateNewWallet;
exports.deleteWallet = deleteWallet;
exports.addDeviceXPubKey = addDeviceXPubKey;
exports.handleNotificationThatWalletFullyApproved = handleNotificationThatWalletFullyApproved;
exports.addNewAddress = addNewAddress;

exports.issueNextAddress = issueNextAddress;
exports.issueOrSelectNextChangeAddress = issueOrSelectNextChangeAddress;
exports.readExternalAddresses = readExternalAddresses;
exports.readChangeAddresses = readChangeAddresses;
exports.readAddressInfo = readAddressInfo;

exports.sendPaymentFromWallet = sendPaymentFromWallet;
exports.forwardPrivateChainsToOtherMembersOfWallets = forwardPrivateChainsToOtherMembersOfWallets;

exports.readBalance = readBalance;
exports.readTransactionHistory = readTransactionHistory;

exports.readCosigners = readCosigners;

