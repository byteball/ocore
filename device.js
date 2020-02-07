/*jslint node: true */
"use strict";
var crypto = require('crypto');
var async = require('async');
var ecdsa = require('secp256k1');
var db = require('./db.js');
var mutex = require('./mutex.js');
var objectHash = require('./object_hash.js');
var ecdsaSig = require('./signature.js');
var network = require('./network.js');
var eventBus = require('./event_bus.js');
var ValidationUtils = require("./validation_utils.js");
var conf = require('./conf.js');
var breadcrumbs = require('./breadcrumbs.js');


var SEND_RETRY_PERIOD = 60*1000;
var RECONNECT_TO_HUB_PERIOD = 60*1000;
var TEMP_DEVICE_KEY_ROTATION_PERIOD = 3600*1000;

var my_device_hub;
var my_device_name;
var my_device_address;

var objMyPermanentDeviceKey;
var objMyTempDeviceKey;
var objMyPrevTempDeviceKey;
var saveTempKeys; // function that saves temp keys
var bScheduledTempDeviceKeyRotation = false;

var bCordova = (typeof window !== 'undefined' && window && window.cordova);

function getMyDevicePubKey(){
	if (!objMyPermanentDeviceKey || !objMyPermanentDeviceKey.pub_b64)
		throw Error('my device pubkey not defined');
	return objMyPermanentDeviceKey.pub_b64;
}

function getMyDeviceAddress(){
	if (!my_device_address)
		throw Error('my_device_address not defined');
	if (bCordova)
		checkDeviceAddress();
	return my_device_address;
}


function setDevicePrivateKey(priv_key){
	breadcrumbs.add("setDevicePrivateKey");
	var bChanged = (!objMyPermanentDeviceKey || priv_key !== objMyPermanentDeviceKey.priv);
	objMyPermanentDeviceKey = {
		priv: priv_key,
		pub_b64: ecdsa.publicKeyCreate(priv_key, true).toString('base64')
	};
	var new_my_device_address = objectHash.getDeviceAddress(objMyPermanentDeviceKey.pub_b64);
	if (my_device_address && my_device_address !== new_my_device_address){
		breadcrumbs.add('different device address: old '+my_device_address+', new '+new_my_device_address);
		throw Error('different device address: old '+my_device_address+', new '+new_my_device_address);
	}
	breadcrumbs.add("same device addresses: "+new_my_device_address);
	my_device_address = new_my_device_address;
	// this temp pubkey package signs my permanent key and is actually used only if I'm my own hub. 
	// In this case, there are no intermediaries and TLS already provides perfect forward security
	network.setMyDeviceProps(my_device_address, createTempPubkeyPackage(objMyPermanentDeviceKey.pub_b64));
	if (bChanged)
		loginToHub();
}

function checkDeviceAddress(){
	if (!objMyPermanentDeviceKey)
		return;
	var derived_my_device_address = objectHash.getDeviceAddress(objMyPermanentDeviceKey.pub_b64);
	if (my_device_address !== derived_my_device_address){
		breadcrumbs.add('different device address: old '+my_device_address+', derived '+derived_my_device_address);
		throw Error('different device address: old '+my_device_address+', derived '+derived_my_device_address);
	}
}

function setTempKeys(temp_priv_key, prev_temp_priv_key, fnSaveTempKeys){
//	console.log("setTempKeys", temp_priv_key, prev_temp_priv_key);
	objMyTempDeviceKey = {
		use_count: null, // unknown
		priv: temp_priv_key,
		pub_b64: ecdsa.publicKeyCreate(temp_priv_key, true).toString('base64')
	};
	if (prev_temp_priv_key) // may be null
		objMyPrevTempDeviceKey = {
			priv: prev_temp_priv_key,
			pub_b64: ecdsa.publicKeyCreate(prev_temp_priv_key, true).toString('base64')
		};
	saveTempKeys = fnSaveTempKeys;
	loginToHub();
}

function setDeviceAddress(device_address){
	breadcrumbs.add("setDeviceAddress: " + device_address);
	if (my_device_address && my_device_address !== device_address)
		throw Error('different device address');
	my_device_address = device_address;
}

function setNewDeviceAddress(device_address){
	breadcrumbs.add("setNewDeviceAddress: " + device_address);
	my_device_address = device_address;
}

function setDeviceName(device_name){
	console.log("setDeviceName", device_name);
	my_device_name = device_name;
}

function setDeviceHub(device_hub){
	console.log("setDeviceHub", device_hub);
	var bChanged = (device_hub !== my_device_hub);
	my_device_hub = device_hub;
	if (bChanged){
		network.addPeer(conf.WS_PROTOCOL+device_hub);
		loginToHub();
	}
}

function isValidPubKey(b64_pubkey){
	return ecdsa.publicKeyVerify(new Buffer.from(b64_pubkey, 'base64'));
}

// -------------------------
// logging in to hub


function handleChallenge(ws, challenge){
	console.log('handleChallenge');
	if (ws.bLoggingIn)
		sendLoginCommand(ws, challenge);
	else // save for future login
		ws.received_challenge = challenge;
}

function loginToHub(){
	if (!objMyPermanentDeviceKey)
		return console.log("objMyPermanentDeviceKey not set yet, can't log in");
	if (!objMyTempDeviceKey)
		return console.log("objMyTempDeviceKey not set yet, can't log in");
	if (!my_device_hub)
		return console.log("my_device_hub not set yet, can't log in");
	console.log("logging in to hub "+my_device_hub);
	network.findOutboundPeerOrConnect(conf.WS_PROTOCOL+my_device_hub, function onLocatedHubForLogin(err, ws){
		if (err)
			return;
		if (ws.bLoggedIn)
			return;
		if (ws.received_challenge)
			sendLoginCommand(ws, ws.received_challenge);
		else
			ws.bLoggingIn = true;
		console.log('done loginToHub');
	});
}

function getHubWs(cb) {
	if (!my_device_hub)
		return setTimeout(function(){ getHubWs(cb); }, 2000);
	network.findOutboundPeerOrConnect(conf.WS_PROTOCOL+my_device_hub, cb);
}


setInterval(loginToHub, RECONNECT_TO_HUB_PERIOD);
eventBus.on('connected', loginToHub);

function sendLoginCommand(ws, challenge){
	var objLogin = {challenge: challenge, pubkey: objMyPermanentDeviceKey.pub_b64};
	objLogin.signature = ecdsaSig.sign(objectHash.getDeviceMessageHashToSign(objLogin), objMyPermanentDeviceKey.priv);
	network.sendJustsaying(ws, 'hub/login', objLogin);
	ws.bLoggedIn = true;
	sendTempPubkey(ws, objMyTempDeviceKey.pub_b64);
	network.initWitnessesIfNecessary(ws);
	resendStalledMessages(1);
}

function sendTempPubkey(ws, temp_pubkey, callbacks){
	if (!callbacks)
		callbacks = {ifOk: function(){}, ifError: function(){}};
	network.sendRequest(ws, 'hub/temp_pubkey', createTempPubkeyPackage(temp_pubkey), false, function(ws, request, response){
		if (response === 'updated')
			return callbacks.ifOk();
		var error = response.error || ("unrecognized response: "+JSON.stringify(response));
		callbacks.ifError(error);
	});
}

function createTempPubkeyPackage(temp_pubkey){
	var objTempPubkey = {
		temp_pubkey: temp_pubkey, 
		pubkey: objMyPermanentDeviceKey.pub_b64
	};
	objTempPubkey.signature = ecdsaSig.sign(objectHash.getDeviceMessageHashToSign(objTempPubkey), objMyPermanentDeviceKey.priv);
	return objTempPubkey;
}


// ------------------------------
// rotation of temp keys


function genPrivKey(){
	var privKey;
	do {
		console.log("generating new priv key");
		privKey = crypto.randomBytes(32);
	}
	while (!ecdsa.privateKeyVerify(privKey));
	return privKey;
}

var last_rotate_wake_ts = Date.now();

function rotateTempDeviceKeyIfCouldBeAlreadyUsed(){
	var actual_interval = Date.now() - last_rotate_wake_ts;
	last_rotate_wake_ts = Date.now();
	if (actual_interval > TEMP_DEVICE_KEY_ROTATION_PERIOD + 1000)
		return console.log("woke up after sleep or high load, will skip rotation");
	if (objMyTempDeviceKey.use_count === 0) // new key that was never used yet
		return console.log("the current temp key was not used yet, will not rotate");
	// if use_count === null, the key was set at start up, it could've been used before
	rotateTempDeviceKey();
}

function rotateTempDeviceKey(){
	if (!saveTempKeys)
		return console.log("no saving function");
	console.log("will rotate temp device key");
	network.findOutboundPeerOrConnect(conf.WS_PROTOCOL+my_device_hub, function onLocatedHubForRotation(err, ws){
		if (err)
			return console.log('will not rotate because: '+err);
		if (ws.readyState !== ws.OPEN)
			return console.log('will not rotate because connection is not open');
		if (!ws.bLoggedIn)
			return console.log('will not rotate because not logged in'); // reconnected and not logged in yet
		var new_priv_key = genPrivKey();
		var objNewMyTempDeviceKey = {
			use_count: 0,
			priv: new_priv_key,
			pub_b64: ecdsa.publicKeyCreate(new_priv_key, true).toString('base64')
		};
		saveTempKeys(new_priv_key, objMyTempDeviceKey.priv, function(err){
			if (err){
				console.log('failed to save new temp keys, canceling: '+err);
				return;
			}
			objMyPrevTempDeviceKey = objMyTempDeviceKey;
			objMyTempDeviceKey = objNewMyTempDeviceKey;
			breadcrumbs.add('rotated temp device key');
			sendTempPubkey(ws, objMyTempDeviceKey.pub_b64);
		});
	});
}

function scheduleTempDeviceKeyRotation(){
	if (bScheduledTempDeviceKeyRotation)
		return;
	bScheduledTempDeviceKeyRotation = true;
	console.log('will schedule rotation in 1 minute');
	setTimeout(function(){
		// due to timeout, we are probably last to request (and receive) this lock
		mutex.lock(["from_hub"], function(unlock){
			console.log("will schedule rotation");
			rotateTempDeviceKeyIfCouldBeAlreadyUsed();
			last_rotate_wake_ts = Date.now();
			setInterval(rotateTempDeviceKeyIfCouldBeAlreadyUsed, TEMP_DEVICE_KEY_ROTATION_PERIOD);
			unlock();
		});
	}, 60*1000);
}


// ---------------------------
// sending/receiving messages

function deriveSharedSecret(ecdh, peer_b64_pubkey){
	var shared_secret_src = ecdh.computeSecret(peer_b64_pubkey, "base64");
	var shared_secret = crypto.createHash("sha256").update(shared_secret_src).digest().slice(0, 16);
	return shared_secret;
}

function decryptPackage(objEncryptedPackage){
	var priv_key;
	if (typeof objEncryptedPackage.iv !== 'string' || typeof objEncryptedPackage.authtag !== 'string' || typeof objEncryptedPackage.encrypted_message !== 'string' || !objEncryptedPackage.dh || typeof objEncryptedPackage.dh !== 'object')
		return console.log("wrong params in encrypted package");
	if (objEncryptedPackage.dh.recipient_ephemeral_pubkey === objMyTempDeviceKey.pub_b64){
		priv_key = objMyTempDeviceKey.priv;
		if (objMyTempDeviceKey.use_count)
			objMyTempDeviceKey.use_count++;
		else
			objMyTempDeviceKey.use_count = 1;
		console.log("message encrypted to temp key");
	}
	else if (objMyPrevTempDeviceKey && objEncryptedPackage.dh.recipient_ephemeral_pubkey === objMyPrevTempDeviceKey.pub_b64){
		priv_key = objMyPrevTempDeviceKey.priv;
		console.log("message encrypted to prev temp key");
		//console.log("objMyPrevTempDeviceKey: "+JSON.stringify(objMyPrevTempDeviceKey));
		//console.log("prev temp private key buf: ", priv_key);
		//console.log("prev temp private key b64: "+priv_key.toString('base64'));
	}
	else if (objEncryptedPackage.dh.recipient_ephemeral_pubkey === objMyPermanentDeviceKey.pub_b64){
		priv_key = objMyPermanentDeviceKey.priv;
		console.log("message encrypted to permanent key");
	}
	else{
		console.log("message encrypted to unknown key");
		setTimeout(function(){
			throw Error("message encrypted to unknown key, device "+my_device_address+", len="+objEncryptedPackage.encrypted_message.length+". The error might be caused by restoring from an old backup or using the same keys on another device.");
		}, 100);
	//	eventBus.emit('nonfatal_error', "message encrypted to unknown key, device "+my_device_address+", len="+objEncryptedPackage.encrypted_message.length, new Error('unknown key'));
		return null;
	}
	
	var ecdh = crypto.createECDH('secp256k1');
	if (process.browser) // workaround bug in crypto-browserify https://github.com/crypto-browserify/createECDH/issues/9
		ecdh.generateKeys("base64", "compressed");
	ecdh.setPrivateKey(priv_key);
	var shared_secret = deriveSharedSecret(ecdh, objEncryptedPackage.dh.sender_ephemeral_pubkey);
	var iv = new Buffer.from(objEncryptedPackage.iv, 'base64');
	var decipher = crypto.createDecipheriv('aes-128-gcm', shared_secret, iv);
	var authtag = new Buffer.from(objEncryptedPackage.authtag, 'base64');
	decipher.setAuthTag(authtag);
	var enc_buf = Buffer.from(objEncryptedPackage.encrypted_message, "base64");
//	var decrypted1 = decipher.update(enc_buf);
	// under browserify, decryption of long buffers fails with Array buffer allocation errors, have to split the buffer into chunks
	var arrChunks = [];
	var CHUNK_LENGTH = 4096;
	for (var offset = 0; offset < enc_buf.length; offset += CHUNK_LENGTH){
	//	console.log('offset '+offset);
		arrChunks.push(decipher.update(enc_buf.slice(offset, Math.min(offset+CHUNK_LENGTH, enc_buf.length))));
	}
	var decrypted1 = Buffer.concat(arrChunks);
	arrChunks = null;
	try {
		var decrypted2 = decipher.final();
	} catch(e) {
		return console.log("Failed to decrypt package: " + e);
	}
	breadcrumbs.add("decrypted lengths: "+decrypted1.length+" + "+decrypted2.length);
	var decrypted_message_buf = Buffer.concat([decrypted1, decrypted2]);
	var decrypted_message = decrypted_message_buf.toString("utf8");
	console.log("decrypted: "+decrypted_message);
	var json = JSON.parse(decrypted_message);
	if (json.encrypted_package){ // strip another layer of encryption
		console.log("inner encryption");
		return decryptPackage(json.encrypted_package);
	}
	else
		return json;
}

// a hack to read large text from cordova sqlite
function readMessageInChunksFromOutbox(message_hash, len, handleMessage){
	var CHUNK_LEN = 1000000;
	var start = 1;
	var message = '';
	function readChunk(){
		db.query("SELECT SUBSTR(message, ?, ?) AS chunk FROM outbox WHERE message_hash=?", [start, CHUNK_LEN, message_hash], function(rows){
			if (rows.length === 0)
				return handleMessage();
			if (rows.length > 1)
				throw Error(rows.length+' msgs by hash in outbox, start='+start+', length='+len);
			message += rows[0].chunk;
			start += CHUNK_LEN;
			(start > len) ? handleMessage(message) : readChunk();
		});
	}
	readChunk();
}

function resendStalledMessages(delay){
	var delay = delay || 0;
	console.log("resending stalled messages delayed by "+delay+" minute");
	if (!objMyPermanentDeviceKey)
		return console.log("objMyPermanentDeviceKey not set yet, can't resend stalled messages");
	mutex.lockOrSkip(['stalled'], function(unlock){
		db.query(
			"SELECT "+(bCordova ? "LENGTH(message) AS len" : "message")+", message_hash, `to`, pubkey, hub \n\
			FROM outbox JOIN correspondent_devices ON `to`=device_address \n\
			WHERE outbox.creation_date<="+db.addTime("-"+delay+" MINUTE")+" ORDER BY outbox.creation_date", 
			function(rows){
				console.log(rows.length+" stalled messages");
				async.eachSeries(
					rows, 
					function(row, cb){
						if (!row.hub){ // weird error
							eventBus.emit('nonfatal_error', "no hub in resendStalledMessages: "+JSON.stringify(row)+", l="+rows.length, new Error('no hub'));
							return cb();
						}
						//	throw Error("no hub in resendStalledMessages: "+JSON.stringify(row));
						var send = function(message){
							if (!message) // the message is already gone
								return cb();
							var objDeviceMessage = JSON.parse(message);
							//if (objDeviceMessage.to !== row.to)
							//    throw "to mismatch";
							console.log('sending stalled '+row.message_hash);
							sendPreparedMessageToHub(row.hub, row.pubkey, row.message_hash, objDeviceMessage, {ifOk: cb, ifError: function(err){ cb(); }});
						};
						bCordova ? readMessageInChunksFromOutbox(row.message_hash, row.len, send) : send(row.message);
					},
					unlock
				);
			}
		);
	});
}

setInterval(function(){ resendStalledMessages(1); }, SEND_RETRY_PERIOD);

// reliable delivery
// first param is either WebSocket or hostname of the hub
function reliablySendPreparedMessageToHub(ws, recipient_device_pubkey, json, callbacks, conn){
	var recipient_device_address = objectHash.getDeviceAddress(recipient_device_pubkey);
	console.log('will encrypt and send to '+recipient_device_address+': '+JSON.stringify(json));
	// encrypt to recipient's permanent pubkey before storing the message into outbox
	var objEncryptedPackage = createEncryptedPackage(json, recipient_device_pubkey);
	// if the first attempt fails, this will be the inner message
	var objDeviceMessage = {
		encrypted_package: objEncryptedPackage
	};
	var message_hash = objectHash.getBase64Hash(objDeviceMessage);
	conn = conn || db;
	conn.query(
		"INSERT INTO outbox (message_hash, `to`, message) VALUES (?,?,?)", 
		[message_hash, recipient_device_address, JSON.stringify(objDeviceMessage)], 
		function(){
			if (callbacks && callbacks.onSaved){
				callbacks.onSaved();
				// db in resendStalledMessages will block until the transaction commits, assuming only 1 db connection
				// (fix if more than 1 db connection is allowed: in this case, it will send only after SEND_RETRY_PERIOD delay)
				process.nextTick(resendStalledMessages);
				// don't send to the network before the transaction commits
				return callbacks.ifOk ? callbacks.ifOk() : null;
			}
			sendPreparedMessageToHub(ws, recipient_device_pubkey, message_hash, json, callbacks);
		}
	);
}

// first param is either WebSocket or hostname of the hub
function sendPreparedMessageToHub(ws, recipient_device_pubkey, message_hash, json, callbacks){
	if (!callbacks)
		callbacks = {ifOk: function(){}, ifError: function(){}};
	if (typeof ws === "string"){
		var hub_host = ws;
		network.findOutboundPeerOrConnect(conf.WS_PROTOCOL+hub_host, function onLocatedHubForSend(err, ws){
			if (err){
				db.query("UPDATE outbox SET last_error=? WHERE message_hash=?", [err, message_hash], function(){});
				return callbacks.ifError(err);
			}
			sendPreparedMessageToConnectedHub(ws, recipient_device_pubkey, message_hash, json, callbacks);
		});
	}
	else
		sendPreparedMessageToConnectedHub(ws, recipient_device_pubkey, message_hash, json, callbacks);
}

// first param is WebSocket only
function sendPreparedMessageToConnectedHub(ws, recipient_device_pubkey, message_hash, json, callbacks){
	network.sendRequest(ws, 'hub/get_temp_pubkey', recipient_device_pubkey, false, function(ws, request, response){
		function handleError(error){
			callbacks.ifError(error);
			db.query("UPDATE outbox SET last_error=? WHERE message_hash=?", [error, message_hash], function(){});
		}
		if (response.error)
			return handleError(response.error);
		var objTempPubkey = response;
		if (!objTempPubkey.temp_pubkey || !objTempPubkey.pubkey || !objTempPubkey.signature)
			return handleError("missing fields in hub response");
		if (objTempPubkey.pubkey !== recipient_device_pubkey)
			return handleError("temp pubkey signed by wrong permanent pubkey");
		if (!ecdsaSig.verify(objectHash.getDeviceMessageHashToSign(objTempPubkey), objTempPubkey.signature, objTempPubkey.pubkey))
			return handleError("wrong sig under temp pubkey");
		var objEncryptedPackage = createEncryptedPackage(json, objTempPubkey.temp_pubkey);
		var recipient_device_address = objectHash.getDeviceAddress(recipient_device_pubkey);
		var objDeviceMessage = {
			encrypted_package: objEncryptedPackage,
			to: recipient_device_address,
			pubkey: objMyPermanentDeviceKey.pub_b64 // who signs. Essentially, the from again. 
		};
		objDeviceMessage.signature = ecdsaSig.sign(objectHash.getDeviceMessageHashToSign(objDeviceMessage), objMyPermanentDeviceKey.priv);
		network.sendRequest(ws, 'hub/deliver', objDeviceMessage, false, function(ws, request, response){
			if (response === "accepted"){
				db.query("DELETE FROM outbox WHERE message_hash=?", [message_hash], function(){
					callbacks.ifOk();
				});
			}
			else
				handleError( response.error || ("unrecognized response: "+JSON.stringify(response)) );
		});
	});
}

function createEncryptedPackage(json, recipient_device_pubkey){
	var text = JSON.stringify(json);
//	console.log("will encrypt and send: "+text);
	var ecdh = crypto.createECDH('secp256k1');
	var sender_ephemeral_pubkey = ecdh.generateKeys("base64", "compressed");
	var shared_secret = deriveSharedSecret(ecdh, recipient_device_pubkey); // Buffer
	console.log(shared_secret.length);
	// we could also derive iv from the unused bits of ecdh.computeSecret() and save some bandwidth
	var iv = crypto.randomBytes(12); // 128 bits (16 bytes) total, we take 12 bytes for random iv and leave 4 bytes for the counter
	var cipher = crypto.createCipheriv("aes-128-gcm", shared_secret, iv);
	// under browserify, encryption of long strings fails with Array buffer allocation errors, have to split the string into chunks
	var arrChunks = [];
	var CHUNK_LENGTH = 2003;
	for (var offset = 0; offset < text.length; offset += CHUNK_LENGTH){
	//	console.log('offset '+offset);
		arrChunks.push(cipher.update(text.slice(offset, Math.min(offset+CHUNK_LENGTH, text.length)), 'utf8'));
	}
	arrChunks.push(cipher.final());
	var encrypted_message_buf = Buffer.concat(arrChunks);
	arrChunks = null;
//	var encrypted_message_buf = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
	//console.log(encrypted_message_buf);
	var encrypted_message = encrypted_message_buf.toString("base64");
	//console.log(encrypted_message);
	var authtag = cipher.getAuthTag();
	// this is visible and verifiable by the hub
	var encrypted_package = {
		encrypted_message: encrypted_message,
		iv: iv.toString('base64'),
		authtag: authtag.toString('base64'),
		dh: {
			sender_ephemeral_pubkey: sender_ephemeral_pubkey,
			recipient_ephemeral_pubkey: recipient_device_pubkey
		}
	};
	return encrypted_package;
}

// first param is either WebSocket or hostname of the hub or null
function sendMessageToHub(ws, recipient_device_pubkey, subject, body, callbacks, conn){
	// this content is hidden from the hub by encryption
	var json = {
		from: my_device_address, // presence of this field guarantees that you cannot strip off the signature and add your own signature instead
		device_hub: my_device_hub, 
		subject: subject, 
		body: body
	};
	conn = conn || db;
	if (ws)
		return reliablySendPreparedMessageToHub(ws, recipient_device_pubkey, json, callbacks, conn);
	var recipient_device_address = objectHash.getDeviceAddress(recipient_device_pubkey);
	conn.query("SELECT hub FROM correspondent_devices WHERE device_address=?", [recipient_device_address], function(rows){
		if (rows.length !== 1)
			throw Error("no hub in correspondents");
		reliablySendPreparedMessageToHub(rows[0].hub, recipient_device_pubkey, json, callbacks, conn);
	});
}

function sendMessageToDevice(device_address, subject, body, callbacks, conn){
	conn = conn || db;
	conn.query("SELECT hub, pubkey, is_blackhole FROM correspondent_devices WHERE device_address=?", [device_address], function(rows){
		if (rows.length !== 1 && !conf.bIgnoreMissingCorrespondents)
			throw Error("correspondent not found");
		if (rows.length === 0 && conf.bIgnoreMissingCorrespondents || rows[0].is_blackhole){
			if (callbacks && callbacks.onSaved)
				callbacks.onSaved();
			if (callbacks && callbacks.ifOk)
				callbacks.ifOk();
			return;
		}
		sendMessageToHub(rows[0].hub, rows[0].pubkey, subject, body, callbacks, conn);
	});
}



// -------------------------
// pairing


function sendPairingMessage(hub_host, recipient_device_pubkey, pairing_secret, reverse_pairing_secret, callbacks){
	var body = {pairing_secret: pairing_secret, device_name: my_device_name};
	if (reverse_pairing_secret)
		body.reverse_pairing_secret = reverse_pairing_secret;
	sendMessageToHub(hub_host, recipient_device_pubkey, "pairing", body, callbacks);
}

function startWaitingForPairing(handlePairingInfo){
	var pairing_secret = crypto.randomBytes(9).toString("base64");
	var pairingInfo = {
		pairing_secret: pairing_secret,
		device_pubkey: objMyPermanentDeviceKey.pub_b64,
		device_address: my_device_address,
		hub: my_device_hub
	};
	db.query("INSERT INTO pairing_secrets (pairing_secret, expiry_date) VALUES(?, "+db.addTime("+1 MONTH")+")", [pairing_secret], function(){
		handlePairingInfo(pairingInfo);
	});
}

// {pairing_secret: "random string", device_name: "Bob's MacBook Pro", reverse_pairing_secret: "random string"}
function handlePairingMessage(json, device_pubkey, callbacks){
	var body = json.body;
	var from_address = objectHash.getDeviceAddress(device_pubkey);
	if (!ValidationUtils.isNonemptyString(body.pairing_secret))
		return callbacks.ifError("correspondent not known and no pairing secret");
	if (!ValidationUtils.isNonemptyString(json.device_hub)) // home hub of the sender
		return callbacks.ifError("no device_hub when pairing");
	if (!ValidationUtils.isNonemptyString(body.device_name))
		return callbacks.ifError("no device_name when pairing");
	if ("reverse_pairing_secret" in body && !ValidationUtils.isNonemptyString(body.reverse_pairing_secret))
		return callbacks.ifError("bad reverse pairing secret");
	eventBus.emit("pairing_attempt", from_address, body.pairing_secret);
	db.query(
		"SELECT is_permanent FROM pairing_secrets WHERE pairing_secret IN(?,'*') AND expiry_date>"+db.getNow()+" ORDER BY (pairing_secret=?) DESC LIMIT 1", 
		[body.pairing_secret, body.pairing_secret], 
		function(pairing_rows){
			if (pairing_rows.length === 0)
				return callbacks.ifError("pairing secret not found or expired");
			// add new correspondent and delete pending pairing
			var safe_device_name = body.device_name.replace(/<[^>]*>?/g, '');
			db.query(
				"INSERT "+db.getIgnore()+" INTO correspondent_devices (device_address, pubkey, hub, name, is_confirmed) VALUES (?,?,?,?,1)", 
				[from_address, device_pubkey, json.device_hub, safe_device_name],
				function(){
					db.query( // don't update name if already confirmed
						"UPDATE correspondent_devices SET is_confirmed=1, name=? WHERE device_address=? AND is_confirmed=0", 
						[safe_device_name, from_address],
						function(){
							eventBus.emit("paired", from_address, body.pairing_secret);
							if (pairing_rows[0].is_permanent === 0){ // multiple peers can pair through permanent secret
								db.query("DELETE FROM pairing_secrets WHERE pairing_secret=?", [body.pairing_secret], function(){});
								eventBus.emit('paired_by_secret-'+body.pairing_secret, from_address);
							}
							if (body.reverse_pairing_secret)
								sendPairingMessage(json.device_hub, device_pubkey, body.reverse_pairing_secret, null);
							db.query("UPDATE correspondent_devices SET is_blackhole=0 WHERE device_address=?", [from_address]);
							callbacks.ifOk();
						}
					);
				}
			);
		}
	);
}



// -------------------------------
// correspondents

function addUnconfirmedCorrespondent(device_pubkey, device_hub, device_name, onDone){
	console.log("addUnconfirmedCorrespondent");
	var device_address = objectHash.getDeviceAddress(device_pubkey);
	db.query(
		"INSERT "+db.getIgnore()+" INTO correspondent_devices (device_address, pubkey, hub, name, is_confirmed) VALUES (?,?,?,?,0)", 
		[device_address, device_pubkey, device_hub, device_name],
		function(){
			if (onDone)
				onDone(device_address);
		}
	);
}

function readCorrespondents(handleCorrespondents){
	db.query("SELECT device_address, hub, name, my_record_pref, peer_record_pref FROM correspondent_devices ORDER BY name", function(rows){
		handleCorrespondents(rows);
	});
}

function readCorrespondent(device_address, handleCorrespondent){
	db.query("SELECT device_address, hub, name, my_record_pref, peer_record_pref FROM correspondent_devices WHERE device_address=?", [device_address], function(rows){
		handleCorrespondent(rows.length ? rows[0] : null);
	});
}

function readCorrespondentsByDeviceAddresses(arrDeviceAddresses, handleCorrespondents){
	db.query(
		"SELECT device_address, hub, name, pubkey, my_record_pref, peer_record_pref FROM correspondent_devices WHERE device_address IN(?) ORDER BY name", 
		[arrDeviceAddresses], 
		function(rows){
			handleCorrespondents(rows);
		}
	);
}

function updateCorrespondentProps(correspondent, onDone){
	db.query(
		"UPDATE correspondent_devices SET hub=?, name=?, my_record_pref=?, peer_record_pref=? WHERE device_address=?", 
		[correspondent.hub, correspondent.name, correspondent.my_record_pref, correspondent.peer_record_pref, correspondent.device_address], 
		function(){
			if (onDone) onDone();
		}
	);
}

function addIndirectCorrespondents(arrOtherCosigners, onDone){
	async.eachSeries(arrOtherCosigners, function(correspondent, cb){
		if (correspondent.device_address === my_device_address)
			return cb();
		db.query(
			"INSERT "+db.getIgnore()+" INTO correspondent_devices (device_address, hub, name, pubkey, is_indirect) VALUES(?,?,?,?,1)", 
			[correspondent.device_address, correspondent.hub, correspondent.name, correspondent.pubkey],
			function(){
				cb();
			}
		);
	}, onDone);
}

function removeCorrespondentDevice(device_address, onDone){
	breadcrumbs.add('correspondent removed: '+device_address);
	var arrQueries = [];
	db.addQuery(arrQueries, "DELETE FROM outbox WHERE `to`=?", [device_address]);
	db.addQuery(arrQueries, "DELETE FROM correspondent_devices WHERE device_address=?", [device_address]);
	async.series(arrQueries, onDone);
	if (bCordova)
		updateCorrespondentSettings(device_address, {push_enabled: 0});
}

function updateCorrespondentSettings(correspondent_address, settings, cb){
	getHubWs(function(err, ws){
		if (err)
			return cb ? cb(err) : null;
		network.sendJustsaying(ws, 'hub/update_correspondent_settings', Object.assign({correspondent_address: correspondent_address}, settings));
		if (cb)
			cb();
	});
}

// -------------------------------
// witnesses


function getWitnessesFromHub(cb){
	console.log('getWitnessesFromHub');
	if (!my_device_hub){
		console.log('getWitnessesFromHub: no hub yet');
		return setTimeout(function(){
			getWitnessesFromHub(cb);
		}, 2000);
	}
	network.findOutboundPeerOrConnect(conf.WS_PROTOCOL+my_device_hub, function(err, ws){
		if (err)
			return cb(err);
		network.sendRequest(ws, 'get_witnesses', null, false, function(ws, request, response){
			if (response.error)
				return cb(response.error);
			var arrWitnessesFromHub = response;
			cb(null, arrWitnessesFromHub);
		});
	});
}

// responseHandler(error, response) callback
function requestFromHub(command, params, responseHandler){
	if (!my_device_hub)
		return setTimeout(function(){ requestFromHub(command, params, responseHandler); }, 2000);
	network.findOutboundPeerOrConnect(conf.WS_PROTOCOL+my_device_hub, function(err, ws){
		if (err)
			return responseHandler(err);
		network.sendRequest(ws, command, params, false, function(ws, request, response){
			if (response.error)
				return responseHandler(response.error);
			responseHandler(null, response);
		});
	});
}

exports.getMyDevicePubKey = getMyDevicePubKey;
exports.getMyDeviceAddress = getMyDeviceAddress;
exports.isValidPubKey = isValidPubKey;

exports.genPrivKey = genPrivKey;

exports.setDevicePrivateKey = setDevicePrivateKey;
exports.setTempKeys = setTempKeys;
exports.setDeviceAddress = setDeviceAddress;
exports.setNewDeviceAddress = setNewDeviceAddress;
exports.setDeviceName = setDeviceName;
exports.setDeviceHub = setDeviceHub;

exports.scheduleTempDeviceKeyRotation = scheduleTempDeviceKeyRotation;

exports.decryptPackage = decryptPackage;

exports.handleChallenge = handleChallenge;
exports.loginToHub = loginToHub;

exports.sendMessageToHub = sendMessageToHub;
exports.sendMessageToDevice = sendMessageToDevice;

exports.sendPairingMessage = sendPairingMessage;
exports.startWaitingForPairing = startWaitingForPairing;
exports.handlePairingMessage = handlePairingMessage;

exports.addUnconfirmedCorrespondent = addUnconfirmedCorrespondent;
exports.readCorrespondents = readCorrespondents;
exports.readCorrespondent = readCorrespondent;
exports.readCorrespondentsByDeviceAddresses = readCorrespondentsByDeviceAddresses;
exports.updateCorrespondentProps = updateCorrespondentProps;
exports.removeCorrespondentDevice = removeCorrespondentDevice;
exports.updateCorrespondentSettings = updateCorrespondentSettings;
exports.addIndirectCorrespondents = addIndirectCorrespondents;
exports.getWitnessesFromHub = getWitnessesFromHub;
exports.requestFromHub = requestFromHub;
exports.getHubWs = getHubWs;