/*jslint node: true */
"use strict";
var ecdsa = require('secp256k1');
var ValidationUtils = require('./validation_utils.js');
var crypto = require('crypto');

function sign(hash, priv_key){
	var res = ecdsa.sign(hash, priv_key);
	return res.signature.toString("base64");
};

function verify(hash, b64_sig, b64_pub_key){
	try{
		var signature = Buffer.from(b64_sig, "base64"); // 64 bytes (32+32)
		return ecdsa.verify(hash, signature, Buffer.from(b64_pub_key, "base64"));
	}
	catch(e){
		console.log('signature verification exception: '+e.toString());
		return false;
	}
};

function verifyMessageWithPemPubKey(message, signature, pem_key) {
	var verify = crypto.createVerify('SHA256');
	verify.update(message);
	verify.end();
	var encoding = ValidationUtils.isValidHexadecimal(signature) ? 'hex' : 'base64';
	try {
		return verify.verify(pem_key, signature, encoding);
	} catch(e1) {
		try {
			if (e1 instanceof TypeError)
				return verify.verify({key: pem_key}, signature, encoding); // from Node v11, the key has to be included in an object 
			else{
				console.log("exception when verifying with pem key: " + e1);
				return false;
			}
		} catch(e2) {
			console.log("exception when verifying with pem key: " + e1 + " " + e2);
			return false;
		}
	}
}

function signMessageWithEcPemPrivKey(message, encoding, pem_key) {
	//we fix pem key formatting
	var contentAloneB64 = pem_key.replace("-----BEGIN EC PRIVATE KEY-----", "").replace("-----END EC PRIVATE KEY-----", ""); 
	contentAloneB64 = contentAloneB64.replace(/\s/g, "");
	pem_key =	"-----BEGIN EC PRIVATE KEY-----" + "\n";
	pem_key += contentAloneB64+"\n";
	pem_key += "-----END EC PRIVATE KEY-----";
	return signMessage(message, encoding, pem_key);
}

function vrfGenerate(seed, privkey){
	return signMessageWithRsaPemPrivKey(seed, 'hex', privkey);
}


function signMessageWithRsaPemPrivKey(message, encoding, pem_key) {
	//we fix pem key formatting
	var contentAloneB64 = pem_key.replace("-----BEGIN RSA PRIVATE KEY-----", "").replace("-----END RSA PRIVATE KEY-----", ""); 
	contentAloneB64 = contentAloneB64.replace(/\s/g, "");
	pem_key =	"-----BEGIN RSA PRIVATE KEY-----" + "\n";
	pem_key += contentAloneB64+"\n";
	pem_key += "-----END RSA PRIVATE KEY-----";
	return signMessage(message, encoding, pem_key);
}

function signMessage(message, encoding, pem_key){
	if (!encoding)
		encoding = 'base64'
	var sign = crypto.createSign('SHA256');
	sign.update(message);
	sign.end();
	try {
		return sign.sign(pem_key, encoding);
	} catch(e1) {
		try {
			return sign.sign({key: pem_key}, encoding);
		} catch(e2) {
			console.log("exception when signing with pem key: " + e1 + " " + e2);
			return null;
		}
	}
}

function validateAndFormatPemPubKey(pem_key, algo, handle) {

	if (!ValidationUtils.isNonemptyString(pem_key))
		return handle("pem key should be a non empty string");

	//we remove header and footer if present
	var contentAloneB64 = pem_key.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", ""); 
	
	//we remove space, tab space or carriage returns
	contentAloneB64 = contentAloneB64.replace(/\s/g, "");

	if (contentAloneB64.length > 736) // largest is RSA 4096 bits
		return handle("pem content is too large");

	if (!ValidationUtils.isValidBase64(contentAloneB64))
		return handle("not valid base64 encoding" + contentAloneB64);

	var contentAloneBuffer = Buffer.from(contentAloneB64, 'base64');

	if (contentAloneBuffer[0] != 0x30)
		return handle("pem key doesn't start with a sequence");

//we determine start and length of algo/curve identifiers
	if (contentAloneBuffer[1] <= 0x7F){
		if (contentAloneBuffer[2] != 0x30)
			return handle("pem key doesn't have a second sequence");
		var identifiersStart = 4;
		var identifiersLength = contentAloneBuffer[3];
	} else if (contentAloneBuffer[1] == 0x81){
		if (contentAloneBuffer[3] != 0x30) 
			return handle("pem key doesn't have a second sequence");
		var identifiersStart = 5;
		var identifiersLength = contentAloneBuffer[4];
	} else if (contentAloneBuffer[1] == 0x82){
		if (contentAloneBuffer[4] != 0x30) 
			return handle("pem key doesn't have a second sequence");
		var identifiersStart = 6;
		var identifiersLength = contentAloneBuffer[5];
	} else {
		return handle("wrong length tag");
	}

	//we decode the length of identifiers
	if (identifiersLength != 13 && identifiersLength != 16 && identifiersLength != 19 && identifiersLength != 20)
		return handle("wrong identifiers length" + identifiersLength);

	//we isolate the identifiers
	var contentAloneHex = contentAloneBuffer.toString('hex')
	var typeIdentifiersHex = contentAloneHex.slice(identifiersStart * 2, identifiersStart *2 + identifiersLength *2);

	if (!objSupportedPemTypes[typeIdentifiersHex])
		return handle("unsupported algo or curve in pem key");

	if (algo != "any"){
		if (algo == "ECDSA" && objSupportedPemTypes[typeIdentifiersHex].algo != "ECDSA")
			return handle("PEM key is not ECDSA type");
		if (algo == "RSA" && objSupportedPemTypes[typeIdentifiersHex].algo != "RSA")
			return handle("PEM key is not RSA type");
	}

	if (objSupportedPemTypes[typeIdentifiersHex].algo == "ECDSA" && objSupportedPemTypes[typeIdentifiersHex].hex_pub_key_length != (contentAloneHex.length - identifiersStart * 2 - identifiersLength *2 - 8))
		return handle("wrong key length");

	//we add back header and footer
	pem_key =	"-----BEGIN PUBLIC KEY-----" + "\n";
	pem_key += contentAloneB64+"\n";
	pem_key += "-----END PUBLIC KEY-----";
	return handle(null,pem_key);
}

var objSupportedPemTypes = {
	'06072a8648ce3d020106092b2403030208010101': {
		name: 'brainpoolP160r1',
		hex_pub_key_length: 80,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106092b2403030208010102': {
		name: 'brainpoolP160t1',
		hex_pub_key_length: 80,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106092b2403030208010103': {
		name: 'brainpoolP192r1',
		hex_pub_key_length: 96,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106092b2403030208010104': {
		name: 'brainpoolP192t1',
		hex_pub_key_length: 96,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106092b2403030208010105': {
		name: 'brainpoolP224r1',
		hex_pub_key_length: 112,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106092b2403030208010106': {
		name: 'brainpoolP224t1',
		hex_pub_key_length: 112,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106092b2403030208010107': {
		name: 'brainpoolP256r1',
		hex_pub_key_length: 128,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106092b2403030208010108': {
		name: 'brainpoolP256t1',
		hex_pub_key_length: 128,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106082a8648ce3d030101': {
		name: 'prime192v1',
		hex_pub_key_length: 96,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106082a8648ce3d030102': {
		name: 'prime192v2',
		hex_pub_key_length: 96,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106082a8648ce3d030103': {
		name: 'prime192v3',
		hex_pub_key_length: 96,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106082a8648ce3d030104': {
		name: 'prime239v1',
		hex_pub_key_length: 120,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106082a8648ce3d030105': {
		name: 'prime239v2',
		hex_pub_key_length: 120,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106082a8648ce3d030106': {
		name: 'prime239v3',
		hex_pub_key_length: 120,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106082a8648ce3d030107': {
		name: 'prime256v1',
		hex_pub_key_length: 128,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b81040006': {
		name: 'secp112r1',
		hex_pub_key_length: 56,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b81040007': {
		name: 'secp112r2',
		hex_pub_key_length: 56,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b8104001c': {
		name: 'secp128r1',
		hex_pub_key_length: 64,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b8104001d': {
		name: 'secp128r2',
		hex_pub_key_length: 64,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b81040009': {
		name: 'secp160k1',
		hex_pub_key_length: 80,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b81040008': {
		name: 'secp160r1',
		hex_pub_key_length: 80,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b8104001e': {
		name: 'secp160r2',
		hex_pub_key_length: 80,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b8104001f': {
		name: 'secp192k1',
		hex_pub_key_length: 96,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b81040020': {
		name: 'secp224k1',
		hex_pub_key_length: 112,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b81040021': {
		name: 'secp224r1',
		hex_pub_key_length: 112,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b8104000a': {
		name: 'secp256k1',
		hex_pub_key_length: 128,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b81040022': {
		name: 'secp384r1',
		hex_pub_key_length: 192,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b81040004': {
		name: 'sect113r1',
		hex_pub_key_length: 60,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b81040005': {
		name: 'sect113r2',
		hex_pub_key_length: 60,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b81040016': {
		name: 'sect131r1',
		hex_pub_key_length: 68,
		algo: 'ECDSA'
	},
	'06072a8648ce3d020106052b81040017': {
		name: 'sect131r2',
		hex_pub_key_length: 68,
		algo: 'ECDSA'
	},
	'06072a8648ce3d02010605672b010401': {
		name: 'wap-wsg-idm-ecid-wtls1',
		hex_pub_key_length: 60,
		algo: 'ECDSA'
	},
	'06072a8648ce3d02010605672b010404': {
		name: 'wap-wsg-idm-ecid-wtls4',
		hex_pub_key_length: 60,
		algo: 'ECDSA'
	},
	'06072a8648ce3d02010605672b010406': {
		name: 'wap-wsg-idm-ecid-wtls6',
		hex_pub_key_length: 56,
		algo: 'ECDSA'
	},
	'06072a8648ce3d02010605672b010407': {
		name: 'wap-wsg-idm-ecid-wtls7',
		hex_pub_key_length: 80,
		algo: 'ECDSA'
	},
	'06072a8648ce3d02010605672b010408': {
		name: 'wap-wsg-idm-ecid-wtls8',
		hex_pub_key_length: 56,
		algo: 'ECDSA'
	},
	'06072a8648ce3d02010605672b010409': {
		name: 'wap-wsg-idm-ecid-wtls9',
		hex_pub_key_length: 80,
		algo: 'ECDSA'
	},
	'06092a864886f70d0101010500':{
		name: 'PKCS #1',
		algo: 'RSA'
	}
};


exports.signMessageWithRsaPemPrivKey = signMessageWithRsaPemPrivKey;
exports.sign = sign;
exports.verify = verify;
exports.verifyMessageWithPemPubKey = verifyMessageWithPemPubKey;
exports.signMessageWithEcPemPrivKey = signMessageWithEcPemPrivKey;
exports.vrfGenerate = vrfGenerate;
exports.validateAndFormatPemPubKey = validateAndFormatPemPubKey;