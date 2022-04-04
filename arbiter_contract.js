"use strict";
var db = require("./db.js");
var device = require("./device.js");
var composer = require("./composer.js");
var crypto = require("crypto");
var arbiters = require("./arbiters.js");
var objectHash = require("./object_hash.js");
var wallet_general = require('./wallet_general.js');
var storage = require("./storage.js");
var constants = require("./constants.js");
var http = require("https");
var url = require("url");
var _ = require('lodash');
var eventBus = require('./event_bus.js');

var status_PENDING = "pending";
exports.CHARGE_AMOUNT = 4000;

function createAndSend(objContract, cb) {
	objContract = _.cloneDeep(objContract);
	objContract.creation_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
	objContract.hash = getHash(objContract);
	device.getOrGeneratePermanentPairingInfo(pairingInfo => {
		objContract.my_pairing_code = pairingInfo.device_pubkey + "@" + pairingInfo.hub + "#" + pairingInfo.pairing_secret;
		db.query("INSERT INTO wallet_arbiter_contracts (hash, peer_address, peer_device_address, my_address, arbiter_address, me_is_payer, amount, asset, is_incoming, creation_date, ttl, status, title, text, my_contact_info, cosigners) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [objContract.hash, objContract.peer_address, objContract.peer_device_address, objContract.my_address, objContract.arbiter_address, objContract.me_is_payer ? 1 : 0, objContract.amount, objContract.asset, 0, objContract.creation_date, objContract.ttl, status_PENDING, objContract.title, objContract.text, objContract.my_contact_info, JSON.stringify(objContract.cosigners)], function() {
				var objContractForPeer = _.cloneDeep(objContract);
				delete objContractForPeer.cosigners;
				device.sendMessageToDevice(objContract.peer_device_address, "arbiter_contract_offer", objContractForPeer);
				if (cb) {
					cb(objContract);
				}
		});
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

function setField(hash, field, value, cb, skipSharing) {
	if (!["status", "shared_address", "unit", "my_contact_info", "peer_contact_info", "peer_pairing_code", "resolution_unit", "cosigners"].includes(field)) {
		throw new Error("wrong field for setField method");
	}
	db.query("UPDATE wallet_arbiter_contracts SET " + field + "=? WHERE hash=?", [value, hash], function(res) {
		if (!skipSharing)
			shareUpdateToCosigners(hash, field);
		if (cb) {
			getByHash(hash, cb);
		}
	});
}

function store(objContract, cb) {
	var fields = "(hash, peer_address, peer_device_address, my_address, arbiter_address, me_is_payer, amount, asset, is_incoming, creation_date, ttl, status, title, text, peer_pairing_code, peer_contact_info, me_is_cosigner";
	var placeholders = "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
	var values = [objContract.hash, objContract.peer_address, objContract.peer_device_address, objContract.my_address, objContract.arbiter_address, objContract.me_is_payer ? 1 : 0, objContract.amount, objContract.asset, 1, objContract.creation_date, objContract.ttl, objContract.status || status_PENDING, objContract.title, objContract.text, objContract.peer_pairing_code, objContract.peer_contact_info, objContract.me_is_cosigner ? 1 : 0];
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

function respond(hash, status, signedMessageBase64, signer, cb) {
	cb = cb || function(){};
	getByHash(hash, function(objContract){
		if (objContract.status !== "pending" && objContract.status !== "accepted")
			return cb("contract is in non-applicable status");
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
				if (status === "accepted") {
					shareContractToCosigners(objContract.hash);
				};
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
	});
}

function revoke(hash, cb) {
	getByHash(hash, function(objContract){
		if (objContract.status !== "pending")
			return cb("contract is in non-applicable status");
		setField(objContract.hash, "status", "revoked", function(objContract) {
			shareUpdateToPeer(objContract.hash, "status");
			cb(null, objContract);
		});
	});
}

function shareContractToCosigners(hash) {
	getByHash(hash, function(objContract){
		getAllMyCosigners(hash, function(cosigners) {
			cosigners.forEach(function(device_address) {
				device.sendMessageToDevice(device_address, "arbiter_contract_shared", objContract);
			});
		});
	});
}

function shareUpdateToCosigners(hash, field) {
	getByHash(hash, function(objContract){
		getAllMyCosigners(hash, function(cosigners) {
			cosigners.forEach(function(device_address) {
				device.sendMessageToDevice(device_address, "arbiter_contract_update", {hash: objContract.hash, field: field, value: objContract[field]});
			});
		});
	});
}

function shareUpdateToPeer(hash, field) {
	getByHash(hash, function(objContract){
		device.sendMessageToDevice(objContract.peer_device_address, "arbiter_contract_update", {hash: objContract.hash, field: field, value: objContract[field]});
	});
}

function getHash(contract) {
	return crypto.createHash("sha256").update(contract.title + contract.text + contract.creation_date + contract.arbiter_address + contract.amount + contract.asset, "utf8").digest("base64");
}

function decodeRow(row) {
	if (row.cosigners)
		row.cosigners = JSON.parse(row.cosigners);
	if (row.creation_date)
		row.creation_date_obj = new Date(row.creation_date.replace(" ", "T")+".000Z");
	if (row.contract_content)
		row.contract_content = JSON.parse(row.contract_content);
	return row;
}

function openDispute(hash, cb) {
	getByHash(hash, function(objContract){
		if (objContract.status !== "paid")
			return cb("contract can't be disputed");
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
									return cb(err);
								}
								httpRequest(url, "/api/get_device_address", "", function(err, arbstore_device_address) {
									if (err) {
										console.warn("no arbstore_device_address", err);
										return cb(err);
									}
									db.query("UPDATE wallet_arbiter_contracts SET arbstore_address=?, arbstore_device_address=? WHERE hash=?", [arbstore_address, arbstore_device_address, objContract.hash], function(){});
								});
							});

							setField(hash, "status", "in_dispute", function(objContract) {
								shareUpdateToPeer(hash, "status");
								// listen for arbiter response
								db.query("INSERT "+db.getIgnore()+" INTO my_watched_addresses (address) VALUES (?)", [objContract.arbiter_address]);
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
		if (objContract.status !== "dispute_resolved")
			return cb("contract can't be appealed");
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

function getAppealFee(hash, cb) {
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
			httpRequest(url, "/api/get_appeal_fee", "", function(err, resp) {
				if (err)
					return cb(err);
				cb(null, resp);
			});
		});
	});
}

function httpRequest(host, path, data, cb) {
	var reqParams = Object.assign(url.parse(host),
		{
			path: path,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": (new TextEncoder().encode(data)).length
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

function getDisputeByContractHash(hash, cb) {
	db.query("SELECT * FROM arbiter_disputes WHERE contract_hash=?", [hash], function(rows){
		if (!rows.length) {
			return cb(null);
		}
		var contract = rows[0];
		cb(decodeRow(contract));
	});
}

function insertDispute(objDispute, cb) {
	db.query("INSERT INTO arbiter_disputes (contract_hash,plaintiff_address,respondent_address,plaintiff_is_payer,plaintiff_pairing_code,\n\
					respondent_pairing_code,contract_content,contract_unit,amount,asset,arbiter_address,service_fee_asset,arbstore_device_address,\n\
					plaintiff_contact_info,respondent_contact_info)\n\
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [objDispute.contract_hash,objDispute.my_address,objDispute.peer_address,objDispute.me_is_payer,
			objDispute.my_pairing_code,objDispute.peer_pairing_code,JSON.stringify(objDispute.contract_content),objDispute.unit,objDispute.amount,objDispute.asset,objDispute.arbiter_address,
			objDispute.service_fee_asset,objDispute.arbstore_device_address,objDispute.my_contact_info,objDispute.peer_contact_info], function(res) {
				cb(res);
		}
	);
}

function getDisputesByArbstore(arbstore_device_address, cb) {
	db.query("SELECT * FROM arbiter_disputes WHERE arbstore_device_address=? ORDER BY creation_date DESC", [arbstore_device_address], function(rows){
		rows.forEach(decodeRow);
		cb(rows);
	});
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
function createSharedAddressAndPostUnit(hash, walletInstance, cb) {
	getByHash(hash, function(contract) {
		arbiters.getArbstoreInfo(contract.arbiter_address, function(arbstoreInfo) {
			if (!arbstoreInfo)
				return cb("can't get ArbStore info");
			storage.readAssetInfo(db, contract.asset, function(assetInfo) {
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
				var isPrivate = assetInfo && assetInfo.is_private;
				var isFixedDen = assetInfo && assetInfo.fixed_denominations;
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
				            amount: contract.me_is_payer && !isFixedDen ? Math.round(contract.amount * (1-arbstoreInfo.cut)) : contract.amount,
				            address: contract.peer_address
				        }]
				    ]];
				    arrDefinition[1][2] = ["and", [
				        ["address", contract.peer_address],
				        ["has", {
				            what: "output",
				            asset: contract.asset || "base", 
				            amount: contract.me_is_payer || isFixedDen ? contract.amount : Math.round(contract.amount * (1-arbstoreInfo.cut)),
				            address: contract.my_address
				        }]
				    ]];
				    if (!isFixedDen) {
				    	arrDefinition[1][contract.me_is_payer ? 1 : 2][1].push(
					        ["has", {
					            what: "output",
					            asset: contract.asset || "base", 
					            amount: contract.amount - Math.round(contract.amount * (1-arbstoreInfo.cut)),
					            address: arbstoreInfo.address
					        }]
					    );
				    }
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
							shareContractToCosigners(contract.hash);
							shareUpdateToPeer(contract.hash, "shared_address");

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
									shareUpdateToPeer(contract.hash, "unit");
									setField(contract.hash, "status", "signed", function(contract) {
										cb(null, contract);
									});
								});
							});
						});
					}
				});
			});
		});
	});
}

function pay(hash, walletInstance, arrSigningDeviceAddresses, cb) {
	getByHash(hash, function(objContract) {
		if (!objContract.shared_address || objContract.status !== "signed" || !objContract.me_is_payer)
			return cb("contract can't be paid");
		var opts = {
			asset: objContract.asset,
			to_address: objContract.shared_address,
			amount: objContract.amount,
			spend_unconfirmed: walletInstance.spendUnconfirmed ? 'all' : 'own'
		};
		if (arrSigningDeviceAddresses.length)
			opts.arrSigningDeviceAddresses = arrSigningDeviceAddresses;
		walletInstance.sendMultiPayment(opts, function(err, unit){								
			if (err)
				return cb(err);
			setField(objContract.hash, "status", "paid", function(objContract){
				cb(null, objContract, unit);
			});
			// listen for peer announce to withdraw funds
			storage.readAssetInfo(db, objContract.asset, function(assetInfo) {
				if (assetInfo && assetInfo.is_private)
					db.query("INSERT "+db.getIgnore()+" INTO my_watched_addresses (address) VALUES (?)", [objContract.peer_address]);
			});
		});
	});
}

function complete(hash, walletInstance, arrSigningDeviceAddresses, cb) {
	getByHash(hash, function(objContract) {
		if (objContract.status !== "paid" && objContract.status !== "in_dispute")
			return cb("contract can't be completed");
		storage.readAssetInfo(db, objContract.asset, function(assetInfo) {
			var opts;
			new Promise(resolve => {
				if (assetInfo && assetInfo.is_private) {
					var value = {};
					value["CONTRACT_DONE_" + objContract.hash] = objContract.peer_address;
					opts = {
						paying_addresses: [objContract.my_address],
						signing_addresses: [objContract.my_address],
						change_address: objContract.my_address,
						messages: [{
							app: 'data_feed',
							payload_location: "inline",
							payload_hash: objectHash.getBase64Hash(value, storage.getMinRetrievableMci() >= constants.timestampUpgradeMci),
							payload: value
						}]
					};
					resolve();
				} else {
					opts = {
						paying_addresses: [objContract.shared_address],
						change_address: objContract.shared_address,
						asset: objContract.asset
					};
					if (objContract.me_is_payer && !(assetInfo && assetInfo.fixed_denominations)) { // complete
						arbiters.getArbstoreInfo(objContract.arbiter_address, function(arbstoreInfo) {
							if (!arbstoreInfo)
								return cb("can't get ArbStore info");
							opts[objContract.asset && objContract.asset != "base" ? "asset_outputs" : "base_outputs"] = [
								{ address: objContract.peer_address, amount: Math.round(objContract.amount * (1-arbstoreInfo.cut))},
								{ address: arbstoreInfo.address, amount:  1- Math.round(objContract.amount * (1-arbstoreInfo.cut))},
							];
							resolve();
						});
					} else { // refund
						opts.to_address = objContract.peer_address;
						opts.amount = objContract.amount;
						resolve();
					}
				}
			}).then(() => {
				if (arrSigningDeviceAddresses.length)
					opts.arrSigningDeviceAddresses = arrSigningDeviceAddresses;
				walletInstance.sendMultiPayment(opts, function(err, unit){
					if (err)
						return cb(err);
					var status = objContract.me_is_payer ? "completed" : "cancelled";
					setField(objContract.hash, "status", status, function(objContract){
						cb(null, objContract, unit);
					});
				});
			});
		});
	});
}

function parseWinnerFromUnit(contract, objUnit) {
	if (objUnit.authors[0].address !== contract.arbiter_address) {
		return;
	}
	var key = "CONTRACT_" + contract.hash;
	var winner;
	objUnit.messages.forEach(function(message){
		if (message.app !== "data_feed" || !message.payload || !message.payload[key]) {
			return;
		}
		winner = message.payload[key];
	});
	if (!winner || (winner !== contract.my_address && winner !== contract.peer_address)) {
		return;
	}
	return winner;
}


/* ==== LISTENERS ==== */

eventBus.on("arbiter_contract_update", function(objContract, field, value) {
	// listen for arbiter response
	if (field === 'status' && value === 'in_dispute') {
		db.query("INSERT "+db.getIgnore()+" INTO my_watched_addresses (address) VALUES (?)", [objContract.arbiter_address]);
	}
});

// contract payment received
eventBus.on("new_my_transactions", function newtxs(arrNewUnits) {
	db.query("SELECT hash, outputs.unit FROM wallet_arbiter_contracts\n\
		JOIN outputs ON outputs.address=wallet_arbiter_contracts.shared_address\n\
		WHERE outputs.unit IN (" + arrNewUnits.map(db.escape).join(', ') + ") AND outputs.asset IS wallet_arbiter_contracts.asset AND (wallet_arbiter_contracts.status='signed' OR wallet_arbiter_contracts.status='accepted')\n\
		GROUP BY outputs.address\n\
		HAVING SUM(outputs.amount) >= wallet_arbiter_contracts.amount", function(rows) {
			rows.forEach(function(row) {
				getByHash(row.hash, function(contract){
					if (contract.status === 'accepted') { // we received payment already but did not yet receive signature unit message, wait for unit to be received
						eventBus.on('arbiter_contract_update', function retryPaymentCheck(objContract, field, value){
							if (objContract.hash === contract.hash && field === 'unit') {
								newtxs(arrNewUnits);
								eventBus.removeListener('arbiter_contract_update', retryPaymentCheck);
							}
						});
						return;
					}
					setField(contract.hash, "status", "paid", function(objContract) {
						eventBus.emit("arbiter_contract_update", objContract, "status", "paid", row.unit);
						// listen for peer announce to withdraw funds
						storage.readAssetInfo(db, contract.asset, function(assetInfo) {
							if (assetInfo && assetInfo.is_private)
								db.query("INSERT "+db.getIgnore()+" INTO my_watched_addresses (address) VALUES (?)", [objContract.peer_address]);

						});
					});
				});
			});
	});
});

// contract completion (public asset)
eventBus.on("new_my_transactions", function(arrNewUnits) {
	db.query("SELECT hash, outputs.unit FROM wallet_arbiter_contracts\n\
		JOIN outputs ON outputs.address=wallet_arbiter_contracts.my_address AND outputs.amount=wallet_arbiter_contracts.amount\n\
		JOIN inputs ON inputs.address=wallet_arbiter_contracts.shared_address AND inputs.unit=outputs.unit\n\
		WHERE outputs.unit IN (" + arrNewUnits.map(db.escape).join(', ') + ") AND outputs.asset IS wallet_arbiter_contracts.asset AND (wallet_arbiter_contracts.status='paid' OR wallet_arbiter_contracts.status='in_dispute')\n\
		GROUP BY wallet_arbiter_contracts.hash", function(rows) {
			rows.forEach(function(row) {
				getByHash(row.hash, function(contract){
					var status = contract.me_is_payer ? "cancelled" : "completed";
					setField(contract.hash, "status", status, function(objContract) {
						eventBus.emit("arbiter_contract_update", objContract, "status", status, row.unit);
					});
				});
			});
	});
});

// arbiter response
eventBus.on("new_my_transactions", function(units) {
	units.forEach(function(unit) {
		storage.readUnit(unit, function(objUnit) {
			var address = objUnit.authors[0].address;
			getAllByArbiterAddress(address, function(contracts) {
				contracts.forEach(function(objContract) {
					if (objContract.status !== "in_dispute")
						return;
					var winner = parseWinnerFromUnit(objContract, objUnit);
					if (!winner) {
						return;
					}
					var unit = objUnit.unit;
					setField(objContract.hash, "resolution_unit", unit);
					setField(objContract.hash, "status", "dispute_resolved", function(objContract) {
						eventBus.emit("arbiter_contract_update", objContract, "status", "dispute_resolved", unit, winner);
					});
				});
			});
		});
	});
});

// arbiter response stabilized
eventBus.on("my_transactions_became_stable", function(units) {
	db.query(
		"SELECT DISTINCT unit_authors.unit \n\
		FROM unit_authors \n\
		JOIN wallet_arbiter_contracts ON address=arbiter_address \n\
		WHERE unit_authors.unit IN(" + units.map(db.escape).join(', ') + ")",
		function (rows) {
			units = rows.map(row => row.unit);
			units.forEach(function(unit) {
				storage.readUnit(unit, function(objUnit) {
					var address = objUnit.authors[0].address;
					getAllByArbiterAddress(address, function(contracts) {
						var count = 0;
						contracts.forEach(function(objContract) {
							if (objContract.status !== "dispute_resolved" && objContract.status !== "in_dispute") // we still can be in dispute in case of light wallet stayed offline
								return;
							var winner = parseWinnerFromUnit(objContract, objUnit);
							if (winner === objContract.my_address)
								eventBus.emit("arbiter_contract_update", objContract, "resolution_unit_stabilized", null, null, winner);
							if (objContract.status === "in_dispute")
								count++;
						});
						if (count === 0)
							wallet_general.removeWatchedAddress(address);
					});
				});
			});
		}
	);
});

// unit with peer funds release for private assets became stable
eventBus.on("my_transactions_became_stable", function(units) {
	db.query(
		"SELECT DISTINCT unit_authors.unit \n\
		FROM unit_authors \n\
		JOIN wallet_arbiter_contracts ON (address=peer_address OR address=my_address) \n\
		JOIN assets ON asset=assets.unit \n\
		WHERE unit_authors.unit IN(" + units.map(db.escape).join(', ') + ") AND is_private=1",
		function (rows) {
			units = rows.map(row => row.unit);
			units.forEach(function (unit) {
				storage.readUnit(unit, function (objUnit) {
					objUnit.messages.forEach(function (m) {
						if (m.app !== "data_feed")
							return;
						for (var key in m.payload) {
							var contract_hash_matches = key.match(/CONTRACT_DONE_(.+)/);
							if (!contract_hash_matches)
								continue;
							var contract_hash = contract_hash_matches[1];
							getByHash(contract_hash, function (objContract) {
								if (!objContract)
									return;
								if (objContract.peer_address !== objUnit.authors[0].address)
									return;
								storage.readAssetInfo(db, objContract.asset, function(assetInfo) {
									if (!assetInfo || !assetInfo.is_private)
										return;
									if (m.payload[key] != objContract.my_address)
										return;
									if (objContract.status === 'paid') {
										var status = objContract.me_is_payer ? 'cancelled' : 'completed';
										setField(contract_hash, 'status', status, function (objContract) {
											eventBus.emit("arbiter_contract_update", objContract, "status", status, unit, null, true);
											var count = 0;
											getAllByPeerAddress(objContract.peer_address, function (contracts) {
												contracts.forEach(function (objContract) {
													if (objContract.status === "paid")
														count++;
												});
												if (count == 0)
													wallet_general.removeWatchedAddress(objContract.peer_address);
											});
										});
									}
								});
							});
						}
					});
				});
			});
		}
	);
});

exports.createAndSend = createAndSend;
exports.getByHash = getByHash;
exports.getBySharedAddress = getBySharedAddress;
exports.respond = respond;
exports.revoke = revoke;
exports.getAllByStatus = getAllByStatus;
exports.setField = setField;
exports.store = store;
exports.getHash = getHash;
exports.openDispute = openDispute;
exports.getDisputeByContractHash = getDisputeByContractHash;
exports.insertDispute = insertDispute;
exports.getDisputesByArbstore = getDisputesByArbstore;
exports.appeal = appeal;
exports.getAppealFee = getAppealFee;
exports.getAllByArbiterAddress = getAllByArbiterAddress;
exports.getAllByPeerAddress = getAllByPeerAddress;
exports.getAllMyCosigners = getAllMyCosigners;
exports.createSharedAddressAndPostUnit = createSharedAddressAndPostUnit;
exports.shareUpdateToPeer = shareUpdateToPeer;
exports.pay = pay;
exports.complete = complete;
exports.parseWinnerFromUnit = parseWinnerFromUnit;