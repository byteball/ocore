/*jslint node: true */
"use strict";
var db = require('./db.js');
var device = require('./device.js');
var composer = require('./composer.js');
var objectHash = require('./object_hash.js');

var status_PENDING = 'pending';
exports.CHARGE_AMOUNT = 2000;

function createAndSend(hash, peer_address, peer_device_address, my_address, creation_date, ttl, title, text, cosigners, cb) {
	db.query("INSERT INTO prosaic_contracts (hash, peer_address, peer_device_address, my_address, is_incoming, creation_date, ttl, status, title, text, cosigners) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [hash, peer_address, peer_device_address, my_address, false, creation_date, ttl, status_PENDING, title, text, JSON.stringify(cosigners)], function() {
		var objContract = {title: title, text: text, creation_date: creation_date, hash: hash, peer_address: my_address, ttl: ttl, address: peer_address};
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
		rows.forEach(function(row) {
			row = decodeRow(row);
		});
		cb(rows);
	});
}

function setField(hash, field, value, cb) {
	if (!["status", "shared_address", "unit"].includes(field))
		throw new Error("wrong field for setField method");
	db.query("UPDATE prosaic_contracts SET " + field + "=? WHERE hash=?", [value, hash], function(err, res) {
		if (cb)
			cb(err, res);
	});
}

function store(objContract, cb) {
	db.query("INSERT INTO prosaic_contracts (hash, peer_address, peer_device_address, my_address, is_incoming, creation_date, ttl, status, title, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		[objContract.hash, objContract.peer_address, objContract.peer_device_address, objContract.address, true, objContract.creation_date, objContract.ttl, status_PENDING, objContract.title, objContract.text], function(err, res) {
		if (cb)
			cb(err, res);
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
		composer.composeAuthorsAndMciForAddresses(db, [objContract.address], signer, function(err, authors) {
			if (err)
				return cb(err);
			send(authors);
		});
	} else
		send();
}

function getHash(contract) {
	return objectHash.getBase64Hash(contract.title + contract.text + contract.creation_date);
}

function decodeRow(row) {
	if (row.cosigners)
		row.cosigners = JSON.parse(row.cosigners);
	var dt_tokens = row.creation_date.split(/[^0-9]/)
	row.creation_date = new Date(row.creation_date.replace(' ', 'T'));
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