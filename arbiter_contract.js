/*jslint node: true */
"use strict";
var db = require('./db.js');
var device = require('./device.js');
var composer = require('./composer.js');
var objectHash = require('./object_hash.js');
var crypto = require('crypto');

var status_PENDING = 'pending';
exports.CHARGE_AMOUNT = 4000;

function createAndSend(hash, peer_address, peer_device_address, my_address, arbiter_address, me_is_payer, amount, creation_date, ttl, title, text, cosigners, pairing_code, myContactInfo, cb) {
	db.query("INSERT INTO arbiter_contracts (hash, peer_address, peer_device_address, my_address, arbiter_address, me_is_payer, amount, is_incoming, creation_date, ttl, status, title, text, my_contact_info, cosigners) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [hash, peer_address, peer_device_address, my_address, arbiter_address, me_is_payer, amount, false, creation_date, ttl, status_PENDING, title, text, myContactInfo, JSON.stringify(cosigners)], function() {
		var objContract = {title: title, text: text, creation_date: creation_date, hash: hash, peer_address: my_address, ttl: ttl, my_address: peer_address, arbiter_address: arbiter_address, me_is_payer: !me_is_payer, amount: amount, peer_pairing_code: pairing_code, peer_contact_info: myContactInfo};
		device.sendMessageToDevice(peer_device_address, "arbiter_contract_offer", objContract);
		if (cb)
			cb(objContract);
	});
}

function getByHash(hash, cb) {
	db.query("SELECT * FROM arbiter_contracts WHERE hash=?", [hash], function(rows){
		if (!rows.length)
			return cb(null);
		var contract = rows[0];
		cb(decodeRow(contract));			
	});
}
function getBySharedAddress(address, cb) {
	db.query("SELECT * FROM arbiter_contracts WHERE shared_address=?", [address], function(rows){
		if (!rows.length)
			return cb(null);
		var contract = rows[0];
		cb(decodeRow(contract));
	});
}

function getAllByStatus(status, cb) {
	db.query("SELECT hash, title, my_address, peer_address, peer_device_address, cosigners, creation_date FROM prosaic_contracts WHERE status=? ORDER BY creation_date DESC", [status], function(rows){
		rows.forEach(function(row) {
			row = decodeRow(row);
		});
		cb(rows);
	});
}

function setField(hash, field, value, cb) {
	if (!["status", "shared_address", "unit", "my_contact_info", "peer_contact_info", "peer_pairing_code"].includes(field))
		throw new Error("wrong field for setField method");
	db.query("UPDATE arbiter_contracts SET " + field + "=? WHERE hash=?", [value, hash], function(res) {
		if (cb)
			cb(res);
	});
}

function store(objContract, cb) {
	var fields = '(hash, peer_address, peer_device_address, my_address, arbiter_address, me_is_payer, amount, is_incoming, creation_date, ttl, status, title, text, peer_pairing_code, peer_contact_info';
	var placeholders = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?';
	var values = [objContract.hash, objContract.peer_address, objContract.peer_device_address, objContract.my_address, objContract.arbiter_address, objContract.me_is_payer, objContract.amount, true, objContract.creation_date, objContract.ttl, objContract.status || status_PENDING, objContract.title, objContract.text, objContract.peer_pairing_code, objContract.peer_contact_info];
	if (objContract.shared_address) {
		fields += ', shared_address';
		placeholders += ', ?';
		values.push(objContract.shared_address);
	}
	fields += ')';
	placeholders += ')';
	db.query("INSERT "+db.getIgnore()+" INTO arbiter_contracts "+fields+" VALUES "+placeholders, values, function(res) {
		if (cb)
			cb(res);
	});
}

function respond(objContract, status, signedMessageBase64, pairing_code, my_contact_info, signer, cb) {
	if (!cb)
		cb = function(){};
	var send = function(authors) {
		var response = {hash: objContract.hash, status: status, signed_message: signedMessageBase64, peer_pairing_code: pairing_code, peer_contact_info: my_contact_info};
		if (authors)
			response.authors = authors;
		device.sendMessageToDevice(objContract.peer_device_address, "arbiter_contract_response", response);
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
		device.sendMessageToDevice(device_address, "arbiter_contract_shared", objContract);
	})
}

function getHash(contract) {
	return crypto.createHash("sha256").update(contract.title + contract.text + contract.creation_date + contract.arbiter_address + contract.amount, "utf8").digest("base64");
}

function decodeRow(row) {
	if (row.cosigners)
		row.cosigners = JSON.parse(row.cosigners);
	row.creation_date_obj = new Date(row.creation_date.replace(' ', 'T')+'.000Z');
	return row;
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