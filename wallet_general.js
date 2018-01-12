/*jslint node: true */
const async = require('async');
const db = require('./db.js');
const device = require('./device.js');



function sendOfferToSign(device_address, address, signing_path, objUnsignedUnit, assocPrivatePayloads){
	const body = {address, signing_path, unsigned_unit: objUnsignedUnit};
	if (assocPrivatePayloads && Object.keys(assocPrivatePayloads).length > 0)
		body.private_payloads = assocPrivatePayloads;
	device.sendMessageToDevice(device_address, "sign", body);
}

// unlike similar function in network, this function sends multiple chains in a single package
function sendPrivatePayments(device_address, arrChains, bForwarded, conn, onSaved){
	const body = {chains: arrChains};
	if (bForwarded)
		body.forwarded = true;
	device.sendMessageToDevice(device_address, "private_payments", body, {
		ifOk() {},
		ifError() {},
		onSaved
	}, conn);
}

function forwardPrivateChainsToDevices(arrDeviceAddresses, arrChains, bForwarded, conn, onSaved){
	console.log(`devices: ${arrDeviceAddresses}`);
	async.eachSeries(
		arrDeviceAddresses,
		(device_address, cb) => {
			console.log(`forwarding to device ${device_address}`);
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
		UNION SELECT address FROM sent_mnemonics LEFT JOIN unit_authors USING(address) WHERE unit_authors.unit IS NULL", rows => {
		const arrAddresses = rows.map(({address}) => address);
		handleAddresses(arrAddresses);
	});
}

exports.sendOfferToSign = sendOfferToSign;
exports.sendPrivatePayments = sendPrivatePayments;
exports.forwardPrivateChainsToDevices = forwardPrivateChainsToDevices;
exports.sendPaymentNotification = sendPaymentNotification;
exports.readMyAddresses = readMyAddresses;
