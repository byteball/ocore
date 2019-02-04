/*jslint node: true */
"use strict";
var db = require('./db.js');
var device = require('./device.js');
var wallet = require('./wallet.js');
var composer = require('./composer.js');

var status_PENDING = 'pending';

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
		cb(rows.length ? rows[0] : null);			
	});
}
function getBySharedAddress(address, cb) {
	db.query("SELECT * FROM prosaic_contracts WHERE shared_address=?", [address], function(rows){
		cb(rows.length ? rows[0] : null);			
	});
}

function getAllByStatus(status, cb) {
	db.query("SELECT hash, title, my_address, peer_address, peer_device_address, cosigners, creation_date FROM prosaic_contracts WHERE status=?", [status], function(rows){
		cb(rows);
	});
}

function setField(hash, field, value, cb) {
	db.query("UPDATE prosaic_contracts SET " + db.escape(field) + "=? WHERE hash=?", [value, hash], function(err, res) {
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

function respond(objContract, status, signedMessageBase64, authors, cb) {
	composer.composeAuthorsAndMciForAddresses(db, [objContract.address], wallet.getSigner(), function(err, authors) {
		device.sendMessageToDevice(objContract.peer_device_address, "prosaic_contract_response", {hash: objContract.hash, status: status, signed_message: signedMessageBase64, authors: authors});
		if (cb)
			cb();
	});
}

exports.createAndSend = createAndSend;
exports.getByHash = getByHash;
exports.getBySharedAddress = getBySharedAddress;
exports.respond = respond;
exports.getAllByStatus = getAllByStatus;
exports.setField = setField;
exports.store = store;