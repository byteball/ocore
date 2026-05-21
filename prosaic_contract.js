/*jslint node: true */
"use strict";
var db = require('./db.js');
var device = require('./device.js');
var composer = require('./composer.js');
var objectHash = require('./object_hash.js');
var storage = require("./storage.js");
var crypto = require('crypto');

var status_PENDING = 'pending';
exports.CHARGE_AMOUNT = 2000;

function createAndSend(hash, peer_address, peer_device_address, my_address, creation_date, ttl, title, text, cosigners, cb) {
	db.query("INSERT INTO prosaic_contracts (hash, peer_address, peer_device_address, my_address, is_incoming, creation_date, ttl, status, title, text, cosigners) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [hash, peer_address, peer_device_address, my_address, false, creation_date, ttl, status_PENDING, title, text, JSON.stringify(cosigners)], function() {
		var objContract = {title: title, text: text, creation_date: creation_date, hash: hash, peer_address: my_address, ttl: ttl, my_address: peer_address};
		device.sendMessageToDevice(peer_device_address, "prosaic_contract_offer", objContract);
		if (cb)
			cb(objContract);
	});
}

function getByHash(hash, cb) {
	db.query("SELECT * FROM prosaic_contracts WHERE hash=?", [hash], function(rows){
		if (!rows.length)
			return cb(null);
		var contract = rows[0];
		cb(decodeRow(contract));			
	});
}
function getBySharedAddress(address, cb) {
	db.query("SELECT * FROM prosaic_contracts WHERE shared_address=?", [address], function(rows){
		if (!rows.length)
			return cb(null);
		var contract = rows[0];
		cb(decodeRow(contract));
	});
}

function getAllByStatus(status, cb) {
	db.query("SELECT hash, title, my_address, peer_address, peer_device_address, cosigners, creation_date FROM prosaic_contracts WHERE status=? ORDER BY creation_date DESC", [status], function(rows){
		rows.forEach(decodeRow);
		cb(rows);
	});
}

function setField(hash, field, value, cb) {
	if (!["status", "shared_address", "unit"].includes(field))
		throw new Error("wrong field for setField method");
	db.query("UPDATE prosaic_contracts SET " + field + "=? WHERE hash=?", [value, hash], function(res) {
		if (cb)
			cb(res);
	});
}

function store(objContract, cb) {
	var fields = '(hash, peer_address, peer_device_address, my_address, is_incoming, creation_date, ttl, status, title, text';
	var placeholders = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?';
	var values = [objContract.hash, objContract.peer_address, objContract.peer_device_address, objContract.my_address, true, objContract.creation_date, objContract.ttl, objContract.status || status_PENDING, objContract.title, objContract.text];
	if (objContract.shared_address) {
		fields += ', shared_address';
		placeholders += ', ?';
		values.push(objContract.shared_address);
	}
	fields += ')';
	placeholders += ')';
	db.query("INSERT "+db.getIgnore()+" INTO prosaic_contracts "+fields+" VALUES "+placeholders, values, function(res) {
		if (cb)
			cb(res);
	});
}

function respond(objContract, status, signedMessageBase64, signer, cb) {
	if (!cb)
		cb = function(){};
	var send = function(authors) {
		var response = {hash: objContract.hash, status: status, signed_message: signedMessageBase64};
		if (authors)
			response.authors = authors;
		device.sendMessageToDevice(objContract.peer_device_address, "prosaic_contract_response", response);
		cb();
	}
	if (status === "accepted") {
		composer.composeAuthorsAndMciForAddresses(db, [objContract.my_address], signer, function(err, authors) {
			if (err)
				return cb(err);
			send(authors);
		});
	} else
		send();
}

function share(hash, device_address) {
	getByHash(hash, function(objContract){
		device.sendMessageToDevice(device_address, "prosaic_contract_shared", objContract);
	})
}

function getHash(contract) {
	return crypto.createHash("sha256").update(contract.title + contract.text + contract.creation_date, "utf8").digest("base64");
}

function getHashV1(contract) {
	return objectHash.getBase64Hash(contract.title + contract.text + contract.creation_date);
}

function decodeRow(row) {
	if (row.cosigners)
		row.cosigners = JSON.parse(row.cosigners);
	row.creation_date_obj = new Date(row.creation_date.replace(' ', 'T')+'.000Z');
	return row;
}


function deriveSharedAddress(contract, bOfferor) {
	const offeror_address = bOfferor ? contract.my_address : contract.peer_address;
	const acceptor_address = bOfferor ? contract.peer_address : contract.my_address;
	const offeror_device_address = bOfferor ? device.getMyDeviceAddress() : contract.peer_device_address;
	const acceptor_device_address = bOfferor ? contract.peer_device_address : device.getMyDeviceAddress();
	var arrDefinition =
		["and", [
			["address", offeror_address],
			["address", acceptor_address]
		]];

	var assocSignersByPath = {
		"r.0": {
			address: offeror_address,
			member_signing_path: "r",
			device_address: offeror_device_address
		},
		"r.1": {
			address: acceptor_address,
			member_signing_path: "r",
			device_address: acceptor_device_address
		},
	};
	return { arrDefinition, assocSignersByPath };
}

function handleReceivedSharedAddress(contract, shared_address, retry_count = 0) {
	console.log(`received shared address ${shared_address} for prosaic contract ${contract.hash} from peer`);
	db.query("SELECT 1 FROM shared_addresses WHERE shared_address=?", [shared_address], function (rows) {
		if (rows.length === 0) {
			if (retry_count >= 10)
				return console.log(`shared address ${shared_address} not found in db after 10 retries, giving up`);
			console.log(`shared address ${shared_address} not yet in db, waiting for 30 seconds and trying again`);
			return setTimeout(handleReceivedSharedAddress, 30000, contract, shared_address, retry_count + 1);
		}
		console.log(`shared address ${shared_address} found in db, deriving shared address definition to verify it matches the received one`);
		const { arrDefinition } = deriveSharedAddress(contract, false);
		const expected_shared_address = objectHash.getChash160(arrDefinition);
		if (expected_shared_address !== shared_address)
			return console.log(`expected shared address ${expected_shared_address} does not match received from offeror ${shared_address}`, JSON.stringify(arrDefinition, null, 2));
		console.log(`shared address ${expected_shared_address} matches the received one, saving it to the contract`);
		setField(contract.hash, "shared_address", shared_address);
	});
}

function handleReceivedSigningUnit(contract, unit, retry_count = 0) {
	db.query("SELECT 1 FROM unit_authors WHERE unit=? AND address=?", [unit, contract.shared_address], async function (rows) {
		if (rows.length === 0) {
			if (retry_count >= 10)
				return console.log(`signing tx ${unit} not found in db after 10 retries, giving up`);
			console.log(`signing tx ${unit} not yet in db, waiting for 30 seconds and trying again`);
			return setTimeout(handleReceivedSigningUnit, 30000, contract, unit, retry_count + 1);
		}
		console.log(`signing tx ${unit} found in db, setting contract's unit`);
		const objUnit = await storage.readUnit(unit);
		const dataMessage = objUnit.messages.find(message => message.app === "data");
		if (!dataMessage)
			return console.log(`data message not found in purported prosaic signing unit ${unit}`);
		const { payload } = dataMessage;
		if (payload.contract_text_hash !== contract.hash)
			return console.log(`data message payload does not match contract ${contract.hash} in purported prosaic signing unit ${unit}`);
		setField(contract.hash, "unit", unit);
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
exports.getHashV1 = getHashV1;
exports.share = share;
exports.deriveSharedAddress = deriveSharedAddress;
exports.handleReceivedSharedAddress = handleReceivedSharedAddress;
exports.handleReceivedSigningUnit = handleReceivedSigningUnit;
