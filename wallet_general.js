/*jslint node: true */
"use strict";
var async = require('async');
var db = require('./db.js');
var device = require('./device.js');
var conf = require('./conf.js');
var ValidationUtils = require("./validation_utils.js");
var eventBus = require('./event_bus.js');


function sendOfferToSign(device_address, address, signing_path, objUnsignedUnit, assocPrivatePayloads){
	var body = {address: address, signing_path: signing_path, unsigned_unit: objUnsignedUnit};
	if (assocPrivatePayloads && Object.keys(assocPrivatePayloads).length > 0)
		body.private_payloads = assocPrivatePayloads;
	device.sendMessageToDevice(device_address, "sign", body);
}

// unlike similar function in network, this function sends multiple chains in a single package
function sendPrivatePayments(device_address, arrChains, bForwarded, conn, onSaved){
	var body = {chains: arrChains};
	if (bForwarded)
		body.forwarded = true;
	device.sendMessageToDevice(device_address, "private_payments", body, {
		ifOk: function(){},
		ifError: function(){},
		onSaved: onSaved
	}, conn);
}

function forwardPrivateChainsToDevices(arrDeviceAddresses, arrChains, bForwarded, conn, onSaved){
	console.log("devices: "+arrDeviceAddresses);
	async.eachSeries(
		arrDeviceAddresses,
		function(device_address, cb){
			console.log("forwarding to device "+device_address);
			sendPrivatePayments(device_address, arrChains, bForwarded, conn, cb);
		},
		onSaved
	);
}

// notification about public payment
function sendPaymentNotification(device_address, unit){
	device.sendMessageToDevice(device_address, "payment_notification", unit);
}


function readMyAddresses(handleAddresses){
	db.query("SELECT address FROM my_addresses \n\
		UNION SELECT shared_address AS address FROM shared_addresses \n\
		UNION SELECT address FROM sent_mnemonics LEFT JOIN unit_authors USING(address) WHERE unit_authors.unit IS NULL\n\
		UNION SELECT address FROM my_watched_addresses", function(rows){
		var arrAddresses = rows.map(function(row){ return row.address; });
		handleAddresses(arrAddresses);
	});
}

function readMyPersonalAddresses(handleAddresses){
	db.query("SELECT address FROM my_addresses", function(rows){
		var arrAddresses = rows.map(function(row){ return row.address; });
		handleAddresses(arrAddresses);
	});
}

function addWatchedAddress(address, handle){
	if (!handle)
		handle = function () { };
	if (!ValidationUtils.isValidAddress(address))
		return handle("not a valid address");
	if (conf.bLight)
		db.query("INSERT " + db.getIgnore() + " INTO unprocessed_addresses (address) VALUES (?)", [address], insertInDb);
	else
		insertInDb();

	function insertInDb(){
		db.query("INSERT "+db.getIgnore()+" INTO my_watched_addresses (address) VALUES (?)", [address], function(){
			eventBus.emit("new_address", address); // if light node, this will trigger an history refresh for this address thus it will be watched by the hub
			handle();
		});
	}
}

function removeWatchedAddress(address){
	db.query("DELETE FROM my_watched_addresses WHERE address=?", [address], function(){});
}

exports.sendOfferToSign = sendOfferToSign;
exports.sendPrivatePayments = sendPrivatePayments;
exports.forwardPrivateChainsToDevices = forwardPrivateChainsToDevices;
exports.sendPaymentNotification = sendPaymentNotification;
exports.readMyAddresses = readMyAddresses;
exports.readMyPersonalAddresses = readMyPersonalAddresses;
exports.addWatchedAddress = addWatchedAddress;
exports.removeWatchedAddress = removeWatchedAddress;
