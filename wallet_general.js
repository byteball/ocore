/*jslint node: true */
"use strict";
var db = require('./db.js');
var device = require('./device.js');
var conf = require('./conf');
var lightWallet = require('./light_wallet');



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
		ifOk: function(){
			if(conf.bLight)
				lightWallet.refreshLightClientHistory();
		},
		ifError: function(){},
		onSaved: onSaved
	}, conn);
}

// notification about public payment
function sendPaymentNotification(device_address, unit){
	device.sendMessageToDevice(device_address, "payment_notification", unit);
	if(conf.bLight)
		lightWallet.refreshLightClientHistory();
}


function readMyAddresses(handleAddresses){
	db.query("SELECT address FROM my_addresses UNION SELECT shared_address AS address FROM shared_addresses", function(rows){
		var arrAddresses = rows.map(function(row){ return row.address; });
		handleAddresses(arrAddresses);
	});
}

exports.sendOfferToSign = sendOfferToSign;
exports.sendPrivatePayments = sendPrivatePayments;
exports.sendPaymentNotification = sendPaymentNotification;
exports.readMyAddresses = readMyAddresses;
