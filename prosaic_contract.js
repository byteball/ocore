/*jslint node: true */
"use strict";
var db = require('./db.js');
var device = require('./device.js');
var wallet = require('./wallet.js');
var composer = require('./composer.js');

function createAndSend(hash, peer_address, peer_device_address, my_address, creation_date, ttl, text, cosigners, cb) {
	var status = 'active';
	db.query("INSERT INTO prosaic_contracts ('hash', 'peer_address', 'peer_device_address', 'my_address', 'is_incoming', 'creation_date', 'ttl', 'status', 'text', 'cosigners') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [hash, peer_address, peer_device_address, my_address, false, creation_date, ttl, status, text, JSON.stringify(cosigners)], function() {
		var chat_message = "(prosaic-contract:" + Buffer(JSON.stringify({text: text, creation_date: creation_date, hash: hash, peer_address: my_address, ttl: ttl, status: status, address: peer_address}), 'utf8').toString('base64') + ")";
		device.sendMessageToDevice(peer_device_address, "text", chat_message);
		if (cb)
			cb(chat_message);
	});
}

function getByHash(hash, cb) {
	db.query("SELECT * FROM prosaic_contracts WHERE hash=?", [hash], function(rows){
		cb(rows.length ? rows[0] : null);			
	});
}

function getAllActive(cb) {
	db.query("SELECT hash, my_address, peer_address, peer_device_address, cosigners FROM prosaic_contracts WHERE status='active'", [], function(rows){
		cb(rows);
	});
}

function setStatus(hash, status, cb) {
	db.query("UPDATE prosaic_contracts SET status=? WHERE hash=?", [status, hash], cb);
}

function storeAndRespond(objContract, status, signedMessageBase64, authors, cb) {
	db.query("INSERT INTO prosaic_contracts ('hash', 'peer_address', 'peer_device_address', 'my_address', 'is_incoming', 'creation_date', 'ttl', 'status', 'text') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		[objContract.hash, objContract.peer_address, objContract.peer_device_address, objContract.address, true, objContract.creation_date, objContract.ttl, status, objContract.text],
		function() {
			composer.retrieveAuthorsAndMciForAddresses(db, [objContract.address], wallet.getSigner(), function(authors) {
					device.sendMessageToDevice(objContract.peer_device_address, "prosaic_contract_response", {hash: objContract.hash, status: status, signed_message: signedMessageBase64, authors: authors});
					if (cb)
						cb();
			});
	});
}

exports.createAndSend = createAndSend;
exports.getByHash = getByHash;
exports.setStatus = setStatus;
exports.storeAndRespond = storeAndRespond;
exports.getAllActive = getAllActive;