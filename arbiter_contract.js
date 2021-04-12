"use strict";
var db = require("./db.js");
var device = require("./device.js");
var composer = require("./composer.js");
var crypto = require("crypto");
var arbiters = require("./arbiters.js");
var objectHash = require("./object_hash.js");
var storage = require("./storage.js");
var constants = require("./constants.js");
var http = require("https");
var url = require("url");
var _ = require('lodash');
var eventBus = require('./event_bus.js');

var status_PENDING = "pending";
exports.CHARGE_AMOUNT = 4000;

function createAndSend(objContract, cb) {
	db.query("INSERT INTO wallet_arbiter_contracts (hash, peer_address, peer_device_address, my_address, arbiter_address, me_is_payer, amount, asset, is_incoming, creation_date, ttl, status, title, text, my_contact_info, cosigners) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [objContract.hash, objContract.peer_address, objContract.peer_device_address, objContract.my_address, objContract.arbiter_address, objContract.me_is_payer, objContract.amount, objContract.asset, false, objContract.creation_date, objContract.ttl, status_PENDING, objContract.title, objContract.text, objContract.my_contact_info, JSON.stringify(objContract.cosigners)], function() {
		var objContractForPeer = _.cloneDeep(objContract);
		delete objContractForPeer.cosigners;
		device.sendMessageToDevice(objContract.peer_device_address, "arbiter_contract_offer", objContractForPeer);
		if (cb) {
			cb(objContract);
		}
	});
}

function getByHash(hash, cb) {
	db.query("SELECT * FROM wallet_arbiter_contracts WHERE hash=?", [hash], function(rows){
		if (!rows.length) {
			return cb(null);
		}
		var contract = rows[0];
		cb(decodeRow(contract));			
	});
}
function getBySharedAddress(address, cb) {
	db.query("SELECT * FROM wallet_arbiter_contracts WHERE shared_address=?", [address], function(rows){
		if (!rows.length) {
			return cb(null);
		}
		var contract = rows[0];
		cb(decodeRow(contract));
	});
}

function getAllByStatus(status, cb) {
	db.query("SELECT * FROM wallet_arbiter_contracts WHERE status IN (?) ORDER BY creation_date DESC", [status], function(rows){
		rows.forEach(decodeRow);
		cb(rows);
	});
}

function getAllByArbiterAddress(address, cb) {
	db.query("SELECT * FROM wallet_arbiter_contracts WHERE arbiter_address IN (?) ORDER BY creation_date DESC", [address], function(rows){
		rows.forEach(decodeRow);
		cb(rows);
	});
}

function getAllByPeerAddress(address, cb) {
	db.query("SELECT * FROM wallet_arbiter_contracts WHERE peer_address IN (?) ORDER BY creation_date DESC", [address], function(rows){
		rows.forEach(decodeRow);
		cb(rows);
	});
}

function setField(hash, field, value, cb) {
	if (!["status", "shared_address", "unit", "my_contact_info", "peer_contact_info", "peer_pairing_code", "resolution_unit", "cosigners"].includes(field)) {
		throw new Error("wrong field for setField method");
	}
	db.query("UPDATE wallet_arbiter_contracts SET " + field + "=? WHERE hash=?", [value, hash], function(res) {
		if (cb) {
			getByHash(hash, cb);
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
	db.query("INSERT "+db.getIgnore()+" INTO wallet_arbiter_contracts "+fields+" VALUES "+placeholders, values, function(res) {
		if (cb) {
			cb(res);
		}
	});
}

function respond(objContract, status, signedMessageBase64, signer, cb) {
	cb = cb || function(){};
	var send = function(authors, pairing_code) {
		var response = {hash: objContract.hash, status: status, signed_message: signedMessageBase64, my_contact_info: objContract.my_contact_info};
		if (authors) {
			response.authors = authors;
		}
		if (pairing_code) {
			response.my_pairing_code = pairing_code;
		}
		device.sendMessageToDevice(objContract.peer_device_address, "arbiter_contract_response", response);

		setField(objContract.hash, "status", status, function(objContract) {
			cb(null, objContract);
		});
	};
	if (status === "accepted") {
		device.getOrGeneratePermanentPairingInfo(function(pairingInfo){
			var pairing_code = pairingInfo.device_pubkey + "@" + pairingInfo.hub + "#" + pairingInfo.pairing_secret;
			composer.composeAuthorsAndMciForAddresses(db, [objContract.my_address], signer, function(err, authors) {
				if (err) {
					return cb(err);
				}
				send(authors, pairing_code);
			});
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
		device.requestFromHub("hub/get_arbstore_url", objContract.arbiter_address, function(err, url){
			if (err)
				return cb(err);
			arbiters.getInfo(objContract.arbiter_address, function(objArbiter) {
				if (!objArbiter)
					return cb("can't get arbiter info from ArbStore");
				device.getOrGeneratePermanentPairingInfo(function(pairingInfo){
					var my_pairing_code = pairingInfo.device_pubkey + "@" + pairingInfo.hub + "#" + pairingInfo.pairing_secret;
					var data = {
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
					};
					db.query("SELECT 1 FROM assets WHERE unit IN(?) AND is_private=1 LIMIT 1", [objContract.asset], function(rows){
						if (rows.length > 0) {
							data.asset = objContract.asset;
							data.amount = objContract.amount;
						}
						var dataJSON = JSON.stringify(data);
						httpRequest(url, "/api/dispute/new", dataJSON, function(err, resp) {
							if (err)
								return cb(err);

							device.requestFromHub("hub/get_arbstore_address", objContract.arbiter_address, function(err, arbstore_address){
								if (err) {
									console.error(err);
									return;
								}
								httpRequest(url, "/api/get_device_address", "", function(err, arbstore_device_address) {
									if (err) {
										console.warn("no arbstore_device_address", err);
										return;
									}
									db.query("UPDATE wallet_arbiter_contracts SET arbstore_address=?, arbstore_device_address=? WHERE hash=?", [arbstore_address, arbstore_device_address, objContract.hash], function(){});
								});
							});

							setField(hash, "status", "in_dispute", function(objContract) {
								cb(null, resp, objContract);
							});
						});
					});
				});
			});
		});
	});
}

function appeal(hash, cb) {
	getByHash(hash, function(objContract){
		var command = "hub/get_arbstore_url";
		var address = objContract.arbiter_address;
		if (objContract.arbstore_address) {
			command = "hub/get_arbstore_url_by_address";
			address = objContract.arbstore_address;
		}
		device.requestFromHub(command, address, function(err, url){
			if (err)
				return cb("can't get arbstore url:", err);
			device.getOrGeneratePermanentPairingInfo(function(pairingInfo){
				var my_pairing_code = pairingInfo.device_pubkey + "@" + pairingInfo.hub + "#" + pairingInfo.pairing_secret;
				var data = JSON.stringify({
					contract_hash: hash,
					my_pairing_code: my_pairing_code,
					my_address: objContract.my_address,
					contract: {title: objContract.title, text: objContract.text, creation_date: objContract.creation_date}
				});
				httpRequest(url, "/api/appeal/new", data, function(err, resp) {
					if (err)
						return cb(err);
					setField(hash, "status", "in_appeal", function(objContract) {
						cb(null, resp, objContract);
					});
				});
			});
		});
	});
}

function meIsCosigner(objContract, cb) {
	db.query("SELECT COUNT(1) AS count FROM wallet_signing_paths\n\
		JOIN my_addresses USING(wallet)\n\
		WHERE address=?", [objContract.my_address], function(rows) {
			if (rows[0].count > 1 && objContract.is_incoming && (!objContract.cosigners || objContract.cosigners.length == 0) && objContract.status !== 'pending') {
				cb(true)
			} else {
				cb(false);
			}
		});
}

function httpRequest(host, path, data, cb) {
	var reqParams = Object.assign(url.parse(host),
		{
			path: path,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": data.length
			}
		}
	);
	var req = http.request(
		reqParams,
		function(resp){
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
					cb(null, data);
				} catch (e) {
					cb(e);
				}
			});
		}).on("error", cb);
	req.write(data);
	req.end();
}

function getAllMyCosigners(hash, cb) {
	db.query("SELECT device_address FROM wallet_signing_paths \n\
		JOIN my_addresses AS ma USING(wallet)\n\
		JOIN wallet_arbiter_contracts AS wac ON wac.my_address=ma.address\n\
		WHERE wac.hash=?", [hash], function(rows) {
			var cosigners = [];
			rows.forEach(function(row) {
				if (row.device_address !== device.getMyDeviceAddress())
					cosigners.push(row.device_address);
			});
			cb(cosigners);
		});
}

// walletInstance should have "sendMultiPayment" function with appropriate signer inside
function createSharedAddressAndPostUnit(contract, walletInstance, cb) {
	db.query("SELECT 1 FROM assets WHERE unit IN(?) AND is_private=1 LIMIT 1", [contract.asset], function(rows){
	    var arrDefinition =
		["or", [
			["and", [
				["address", contract.my_address],
				["address", contract.peer_address]
			]],
			[], // placeholders [1][1]
			[],	// placeholders [1][2]
			["and", [
		        ["address", contract.my_address],
		        ["in data feed", [[contract.arbiter_address], "CONTRACT_" + contract.hash, "=", contract.my_address]]
		    ]],
		    ["and", [
		        ["address", contract.peer_address],
		        ["in data feed", [[contract.arbiter_address], "CONTRACT_" + contract.hash, "=", contract.peer_address]]
		    ]]
		]];
		var isPrivate = rows.length > 0;
		if (isPrivate) { // private asset
			arrDefinition[1][1] = ["and", [
		        ["address", contract.my_address],
		        ["in data feed", [[contract.peer_address], "CONTRACT_DONE_" + contract.hash, "=", contract.my_address]]
		    ]];
		    arrDefinition[1][2] = ["and", [
		        ["address", contract.peer_address],
		        ["in data feed", [[contract.my_address], "CONTRACT_DONE_" + contract.hash, "=", contract.peer_address]]
		    ]];
		} else {
			arrDefinition[1][1] = ["and", [
		        ["address", contract.my_address],
		        ["has", {
		            what: "output",
		            asset: contract.asset || "base", 
		            amount: contract.amount, 
		            address: contract.peer_address
		        }]
		    ]];
		    arrDefinition[1][2] = ["and", [
		        ["address", contract.peer_address],
		        ["has", {
		            what: "output",
		            asset: contract.asset || "base", 
		            amount: contract.amount, 
		            address: contract.my_address
		        }]
		    ]];
		}
		var assocSignersByPath = {
			"r.0.0": {
				address: contract.my_address,
				member_signing_path: "r",
				device_address: device.getMyDeviceAddress()
			},
			"r.0.1": {
				address: contract.peer_address,
				member_signing_path: "r",
				device_address: contract.peer_device_address
			},
			"r.1.0": {
				address: contract.my_address,
				member_signing_path: "r",
				device_address: device.getMyDeviceAddress()
			},
			"r.2.0": {
				address: contract.peer_address,
				member_signing_path: "r",
				device_address: contract.peer_device_address
			},
			"r.3.0": {
				address: contract.my_address,
				member_signing_path: "r",
				device_address: device.getMyDeviceAddress()
			},
			"r.4.0": {
				address: contract.peer_address,
				member_signing_path: "r",
				device_address: contract.peer_device_address
			},
		};
		require("ocore/wallet_defined_by_addresses.js").createNewSharedAddress(arrDefinition, assocSignersByPath, {
			ifError: function(err){
				cb(err);
			},
			ifOk: function(shared_address){
				setField(contract.hash, "shared_address", shared_address, function(contract) {
					// share this contract to my cosigners for them to show proper ask dialog
					contract.cosigners.forEach(function(cosigner) {
						share(contract.hash, cosigner);
					});

					// post a unit with contract text hash and send it for signing to correspondent
					var value = {"contract_text_hash": contract.hash, "arbiter": contract.arbiter_address};
					var objContractMessage = {
						app: "data",
						payload_location: "inline",
						payload_hash: objectHash.getBase64Hash(value, storage.getMinRetrievableMci() >= constants.timestampUpgradeMci),
						payload: value
					};

					walletInstance.sendMultiPayment({
						asset: "base",
						to_address: shared_address,
						amount: exports.CHARGE_AMOUNT,
						arrSigningDeviceAddresses: contract.cosigners.length ? contract.cosigners.concat([contract.peer_device_address, device.getMyDeviceAddress()]) : [],
						signing_addresses: [shared_address],
						messages: [objContractMessage]
					}, function(err, unit) { // can take long if multisig
						if (err)
							return cb(err);

						// set contract's unit field
						setField(contract.hash, "unit", unit, function(contract) {
							// set signed status
							setField(contract.hash, "status", "signed", function(contract) {
								// share new contract fields (shared address and unit) to peer & my cosigners
								contract.cosigners.concat([contract.peer_device_address]).forEach(function(cosigner) {
									device.sendMessageToDevice(cosigner, "arbiter_contract_update", {
										hash: contract.hash,
										field: "shared_address",
										value: shared_address
									});
									device.sendMessageToDevice(cosigner, "arbiter_contract_update", {
										hash: contract.hash,
										field: "unit",
										value: unit
									});
								});

								cb(null, contract);
							});
						});
					});
				});
			}
		});
	});
}

/* ==== LISTENERS ==== */

function showError(msg) {
	eventBus.emit('alert_error', msg);
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
exports.meIsCosigner = meIsCosigner;
exports.getAllByArbiterAddress = getAllByArbiterAddress;
exports.getAllByPeerAddress = getAllByPeerAddress;
exports.getAllMyCosigners = getAllMyCosigners;
exports.createSharedAddressAndPostUnit = createSharedAddressAndPostUnit;