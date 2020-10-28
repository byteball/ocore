"use strict";
var db = require("./db.js");
var device = require("./device.js");
var composer = require("./composer.js");
var crypto = require("crypto");
var arbiters = require("./arbiters.js");
var http = require("https");
var url = require("url");

var status_PENDING = "pending";
exports.CHARGE_AMOUNT = 4000;

function createAndSend(params, cb) {
	db.query("INSERT INTO arbiter_contracts (hash, peer_address, peer_device_address, my_address, arbiter_address, me_is_payer, amount, asset, is_incoming, creation_date, ttl, status, title, text, my_contact_info, cosigners) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [params.hash, params.peer_address, params.peer_device_address, params.my_address, params.arbiter_address, params.me_is_payer, params.amount, params.asset, false, params.creation_date, params.ttl, status_PENDING, params.title, params.text, params.my_contact_info, JSON.stringify(params.cosigners)], function() {
		var objContract = {
			title: params.title,
			text: params.text,
			creation_date: params.creation_date,
			hash: params.hash,
			my_address: params.my_address,
			ttl: params.ttl,
			peer_address: params.peer_address,
			arbiter_address: params.arbiter_address,
			me_is_payer: params.me_is_payer,
			amount: params.amount,
			asset: params.asset,
			my_pairing_code: params.pairing_code,
			my_contact_info: params.my_contact_info};
		device.sendMessageToDevice(params.peer_device_address, "arbiter_contract_offer", objContract);
		if (cb) {
			cb(objContract);
		}
	});
}

function getByHash(hash, cb) {
	db.query("SELECT * FROM arbiter_contracts WHERE hash=?", [hash], function(rows){
		if (!rows.length) {
			return cb(null);
		}
		var contract = rows[0];
		cb(decodeRow(contract));			
	});
}
function getBySharedAddress(address, cb) {
	db.query("SELECT * FROM arbiter_contracts WHERE shared_address=?", [address], function(rows){
		if (!rows.length) {
			return cb(null);
		}
		var contract = rows[0];
		cb(decodeRow(contract));
	});
}

function getAllByStatus(status, cb) {
	db.query("SELECT hash, title, my_address, peer_address, shared_address, arbiter_address, status, amount, asset, peer_device_address, cosigners, creation_date, dispute_mci, unit FROM arbiter_contracts WHERE status IN (?) ORDER BY creation_date DESC", [status], function(rows){
		rows.forEach(function(row) {
			row = decodeRow(row);
		});
		cb(rows);
	});
}

function setField(hash, field, value, cb) {
	if (!["status", "shared_address", "unit", "my_contact_info", "peer_contact_info", "peer_pairing_code", "dispute_mci", "resolution_unit"].includes(field)) {
		throw new Error("wrong field for setField method");
	}
	db.query("UPDATE arbiter_contracts SET " + field + "=? WHERE hash=?", [value, hash], function(res) {
		if (cb) {
			cb(res);
		}
	});
}

function store(objContract, cb) {
	var fields = "(hash, peer_address, peer_device_address, my_address, arbiter_address, me_is_payer, amount, asset, is_incoming, creation_date, ttl, status, title, text, peer_pairing_code, peer_contact_info";
	var placeholders = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
	var values = [objContract.hash, objContract.peer_address, objContract.peer_device_address, objContract.my_address, objContract.arbiter_address, objContract.me_is_payer, objContract.amount, objContract.asset, true, objContract.creation_date, objContract.ttl, objContract.status || status_PENDING, objContract.title, objContract.text, objContract.peer_pairing_code, objContract.peer_contact_info];
	if (objContract.shared_address) {
		fields += ", shared_address";
		placeholders += ", ?";
		values.push(objContract.shared_address);
	}
	if (objContract.unit) {
		fields += ", unit";
		placeholders += ", ?";
		values.push(objContract.unit);
	}
	fields += ")";
	placeholders += ")";
	db.query("INSERT "+db.getIgnore()+" INTO arbiter_contracts "+fields+" VALUES "+placeholders, values, function(res) {
		if (cb) {
			cb(res);
		}
	});
}

function respond(objContract, status, signedMessageBase64, pairing_code, my_contact_info, signer, cb) {
	if (!cb) {
		cb = function(){};
	}
	var send = function(authors) {
		var response = {hash: objContract.hash, status: status, signed_message: signedMessageBase64, my_pairing_code: pairing_code, my_contact_info: my_contact_info};
		if (authors) {
			response.authors = authors;
		}
		device.sendMessageToDevice(objContract.peer_device_address, "arbiter_contract_response", response);
		cb();
	};
	if (status === "accepted") {
		composer.composeAuthorsAndMciForAddresses(db, [objContract.my_address], signer, function(err, authors) {
			if (err) {
				return cb(err);
			}
			send(authors);
		});
	} else {
		send();
	}
}

function share(hash, device_address) {
	getByHash(hash, function(objContract){
		device.sendMessageToDevice(device_address, "arbiter_contract_shared", objContract);
	});
}

function getHash(contract) {
	return crypto.createHash("sha256").update(contract.title + contract.text + contract.creation_date + contract.arbiter_address + contract.amount + contract.asset, "utf8").digest("base64");
}

function decodeRow(row) {
	if (row.cosigners) {
		row.cosigners = JSON.parse(row.cosigners);
	}
	row.creation_date_obj = new Date(row.creation_date.replace(" ", "T")+".000Z");
	return row;
}

function openDispute(hash, cb) {
	getByHash(hash, function(objContract){
		device.requestFromHub("hub/get_arbstore_address", objContract.arbiter_address, function(err, arbStoreAddress){
			arbiters.getInfo(objContract.arbiter_address, function(objArbiter) {
				if (!objArbiter)
					return cb("can't get arbiter info from ArbStore");
				device.getOrGeneratePermanentPairingInfo(function(pairingInfo){
					var my_pairing_code = pairingInfo.device_pubkey + "@" + pairingInfo.hub + "#" + pairingInfo.pairing_secret;
					var data = JSON.stringify({
						contract_hash: hash,
						unit: objContract.unit,
						my_address: objContract.my_address,
						peer_address: objContract.peer_address,
						me_is_payer: objContract.me_is_payer,
						my_pairing_code: my_pairing_code,
						peer_pairing_code: objContract.peer_pairing_code,
						encrypted_contract: device.createEncryptedPackage({title: objContract.title, text: objContract.text, creation_date: objContract.creation_date}, objArbiter.device_pub_key),
						my_contact_info: objContract.my_contact_info,
						peer_contact_info: objContract.peer_contact_info
					});
					var reqParams = Object.assign(url.parse(arbStoreAddress), 
						{
							path: "/api/dispute/new",
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								"Content-Length": data.length
							}
						}
					);
					var req = http.request(
						reqParams
						, function(resp){
						var data = "";
						resp.on("data", function(chunk){
							data += chunk;
						});
						resp.on("end", function(){
							try {
								data = JSON.parse(data);
								if (data.error) {
									return cb(data.error);
								}
								setField(hash, "status", "in_dispute");
								cb(null, data);
							} catch (e) {
								cb(e);
							}
						});
					}).on("error", cb);
					req.write(data);
					req.end();
				});
			});
		});
	});
}

function appeal(hash, cb) {
	getByHash(hash, function(objContract){
		device.requestFromHub("hub/get_arbstore_address", objContract.arbiter_address, function(err, arbStoreAddress){
			if (err)
				return cb(err);
			device.getOrGeneratePermanentPairingInfo(function(pairingInfo){
				var my_pairing_code = pairingInfo.device_pubkey + "@" + pairingInfo.hub + "#" + pairingInfo.pairing_secret;
				var data = JSON.stringify({
					contract_hash: hash,
					my_pairing_code: my_pairing_code,
					my_address: objContract.my_address,
					contract: {title: objContract.title, text: objContract.text, creation_date: objContract.creation_date}
				});
				var reqParams = Object.assign(url.parse(arbStoreAddress), 
					{
						path: "/api/appeal/new",
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Content-Length": data.length
						}
					}
				);
				var req = http.request(
					reqParams
					, function(resp){
					var data = "";
					resp.on("data", function(chunk){
						data += chunk;
					});
					resp.on("end", function(){
						try {
							data = JSON.parse(data);
							if (data.error) {
								return cb(data.error);
							}
							setField(hash, "status", "in_appeal");
							cb(null, data);
						} catch (e) {
							cb(e);
						}
					});
				}).on("error", cb);
				req.write(data);
				req.end();
			});
		});
	});
}

exports.createAndSend = createAndSend;
exports.getByHash = getByHash;
exports.getBySharedAddress = getBySharedAddress;
exports.respond = respond;
exports.getAllByStatus = getAllByStatus;
exports.setField = setField;
exports.store = store;
exports.getHash = getHash;
exports.share = share;
exports.openDispute = openDispute;
exports.appeal = appeal;