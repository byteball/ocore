/*jslint node: true */
"use strict";
var ecdsa = require('secp256k1');
var ValidationUtils = require('./validation_utils.js');
var crypto = require('crypto');

exports.sign = function(hash, priv_key){
	var res = ecdsa.sign(hash, priv_key);
	return res.signature.toString("base64");
};

exports.verify = function(hash, b64_sig, b64_pub_key){
	try{
		var signature = new Buffer(b64_sig, "base64"); // 64 bytes (32+32)
		return ecdsa.verify(hash, signature, new Buffer(b64_pub_key, "base64"));
	}
	catch(e){
		console.log('signature verification exception: '+e.toString());
		return false;
	}
};

exports.verifyMessageWithPemPubKey = function(message, signature, pem_key) {

	var verify = crypto.createVerify('SHA256');
	verify.update(message);
	verify.end();
	var encoding = ValidationUtils.isValidHexadecimal(signature) ? 'hex' : 'base64';
	try {
		return verify.verify(pem_key, signature, encoding)
	} catch(e1) {
		try {
			return verify.verify({key: pem_key}, signature, encoding) // from Node v11, the key has to be included in an object 
		} catch(e2) {
			console.log("exception when verifying with pem key: " + e1 + " " + e2);
			return false;
		}
	}
}

exports.signMessageWithPemPrivKey = function(message, pem_key) {

	//we fix pem key formatting
	var contentAloneB64 = pem_key.replace("-----BEGIN EC PRIVATE KEY-----", "").replace("-----END EC PRIVATE KEY-----", ""); 
	contentAloneB64 = contentAloneB64.replace(/\s/g, "");
	pem_key =	"-----BEGIN EC PRIVATE KEY-----" + "\n";
	pem_key += contentAloneB64+"\n";
	pem_key += "-----END EC PRIVATE KEY-----";

	var sign = crypto.createSign('SHA256');
	sign.update(message);
	sign.end();
	try {
		return sign.sign(pem_key, 'base64');
	} catch(e1) {
		try {
			return sign.sign({key: pem_key}, 'base64');
		} catch(e2) {
			console.log("exception when signing with pem key: " + e1 + " " + e2);
			return null;
		}
	}
}


exports.validateAndFormatPemPubKey = function(pem_key, handle) {

		if (!ValidationUtils.isNonemptyString(pem_key))
			return handle("pem key should be a non empty string");

		//we remove header and footer if present
		var contentAloneB64 = 	pem_key.replace("-----BEGIN PUBLIC KEY-----", "").replace("-----END PUBLIC KEY-----", ""); 
		
		//we remove space, tab space or carriage returns
		contentAloneB64 = contentAloneB64.replace(/\s/g, "");
		if (!ValidationUtils.isValidBase64(contentAloneB64))
			return handle("not valid base64 encoding" + contentAloneB64);
	
		var contentAloneBuffer = Buffer.from(contentAloneB64, 'base64');
	
		//we decode the length of curve identifiers
		var curveIdentifiersLength = contentAloneBuffer[3];
		if (curveIdentifiersLength != 16 && curveIdentifiersLength != 19 && curveIdentifiersLength != 20)
			return handle("wrong curve identifiers length" + curveIdentifiersLength);
	
		//we isolate the curve identifiers
		var contentAloneHex = contentAloneBuffer.toString('hex')
		var curveIdentifiersHex = contentAloneHex.slice(0,(curveIdentifiersLength +4)*2);
	
		if (!objSupportedPemCurves[curveIdentifiersHex])
			return handle("unsupported_curve in pem key");
		if (objSupportedPemCurves[curveIdentifiersHex].hex_pub_key_length != (contentAloneHex.length - (curveIdentifiersLength + 8)*2))
			return handle("wrong key length");
	
		//we add back header and footer
		pem_key =	"-----BEGIN PUBLIC KEY-----" + "\n";
		pem_key += contentAloneB64+"\n";
		pem_key += "-----END PUBLIC KEY-----";
		return handle(null,pem_key);
	}

var objSupportedPemCurves = {
	'3042301406072a8648ce3d020106092b2403030208010101': {
		name:'brainpoolP160r1',
		hex_pub_key_length: 80,
		base64_beginning:'MEIwFAYHKoZIzj0CAQYJKyQDAwIIAQ'
	},
	'3042301406072a8648ce3d020106092b2403030208010102': {
		name:'brainpoolP160t1',
		hex_pub_key_length: 80,
		base64_beginning:'MEIwFAYHKoZIzj0CAQYJKyQDAwIIAQ'
	},
	'304a301406072a8648ce3d020106092b2403030208010103': {
		name:'brainpoolP192r1',
		hex_pub_key_length: 96,
		base64_beginning:'MEowFAYHKoZIzj0CAQYJKyQDAwIIAQ'
	},
	'304a301406072a8648ce3d020106092b2403030208010104': {
		name:'brainpoolP192t1',
		hex_pub_key_length: 96,
		base64_beginning:'MEowFAYHKoZIzj0CAQYJKyQDAwIIAQ'
	},
	'3052301406072a8648ce3d020106092b2403030208010105': {
		name:'brainpoolP224r1',
		hex_pub_key_length: 112,
		base64_beginning:'MFIwFAYHKoZIzj0CAQYJKyQDAwIIAQ'
	},
	'3052301406072a8648ce3d020106092b2403030208010106': {
		name:'brainpoolP224t1',
		hex_pub_key_length: 112,
		base64_beginning:'MFIwFAYHKoZIzj0CAQYJKyQDAwIIAQ'
	},
	'305a301406072a8648ce3d020106092b2403030208010107': {
		name:'brainpoolP256r1',
		hex_pub_key_length: 128,
		base64_beginning:'MFowFAYHKoZIzj0CAQYJKyQDAwIIAQ'
	},
	'305a301406072a8648ce3d020106092b2403030208010108': {
		name:'brainpoolP256t1',
		hex_pub_key_length: 128,
		base64_beginning:'MFowFAYHKoZIzj0CAQYJKyQDAwIIAQ'
	},
	'3049301306072a8648ce3d020106082a8648ce3d030101': {
		name:'prime192v1',
		hex_pub_key_length: 96,
		base64_beginning:'MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQ'
	},
	'3049301306072a8648ce3d020106082a8648ce3d030102': {
		name:'prime192v2',
		hex_pub_key_length: 96,
		base64_beginning:'MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQ'
	},
	'3049301306072a8648ce3d020106082a8648ce3d030103': {
		name:'prime192v3',
		hex_pub_key_length: 96,
		base64_beginning:'MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQ'
	},
	'3055301306072a8648ce3d020106082a8648ce3d030104': {
		name:'prime239v1',
		hex_pub_key_length: 120,
		base64_beginning:'MFUwEwYHKoZIzj0CAQYIKoZIzj0DAQ'
	},
	'3055301306072a8648ce3d020106082a8648ce3d030105': {
		name:'prime239v2',
		hex_pub_key_length: 120,
		base64_beginning:'MFUwEwYHKoZIzj0CAQYIKoZIzj0DAQ'
	},
	'3055301306072a8648ce3d020106082a8648ce3d030106': {
		name:'prime239v3',
		hex_pub_key_length: 120,
		base64_beginning:'MFUwEwYHKoZIzj0CAQYIKoZIzj0DAQ'
	},
	'3059301306072a8648ce3d020106082a8648ce3d030107': {
		name:'prime256v1',
		hex_pub_key_length: 128,
		base64_beginning:'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQ'
	},
	'3032301006072a8648ce3d020106052b81040006': {
		name:'secp112r1',
		hex_pub_key_length: 56,
		base64_beginning:'MDIwEAYHKoZIzj0CAQYFK4EEAA'
	},
	'3032301006072a8648ce3d020106052b81040007': {
		name:'secp112r2',
		hex_pub_key_length: 56,
		base64_beginning:'MDIwEAYHKoZIzj0CAQYFK4EEAA'
	},
	'3036301006072a8648ce3d020106052b8104001c': {
		name:'secp128r1',
		hex_pub_key_length: 64,
		base64_beginning:'MDYwEAYHKoZIzj0CAQYFK4EEAB'
	},
	'3036301006072a8648ce3d020106052b8104001d': {
		name:'secp128r2',
		hex_pub_key_length: 64,
		base64_beginning:'MDYwEAYHKoZIzj0CAQYFK4EEAB'
	},
	'303e301006072a8648ce3d020106052b81040009': {
		name:'secp160k1',
		hex_pub_key_length: 80,
		base64_beginning:'MD4wEAYHKoZIzj0CAQYFK4EEAA'
	},
	'303e301006072a8648ce3d020106052b81040008': {
		name:'secp160r1',
		hex_pub_key_length: 80,
		base64_beginning:'MD4wEAYHKoZIzj0CAQYFK4EEAA'
	},
	'303e301006072a8648ce3d020106052b8104001e': {
		name:'secp160r2',
		hex_pub_key_length: 80,
		base64_beginning:'MD4wEAYHKoZIzj0CAQYFK4EEAB'
	},
	'3046301006072a8648ce3d020106052b8104001f': {
		name:'secp192k1',
		hex_pub_key_length: 96,
		base64_beginning:'MEYwEAYHKoZIzj0CAQYFK4EEAB'
	},
	'304e301006072a8648ce3d020106052b81040020': {
		name:'secp224k1',
		hex_pub_key_length: 112,
		base64_beginning:'ME4wEAYHKoZIzj0CAQYFK4EEAC'
	},
	'304e301006072a8648ce3d020106052b81040021': {
		name:'secp224r1',
		hex_pub_key_length: 112,
		base64_beginning:'ME4wEAYHKoZIzj0CAQYFK4EEAC'
	},
	'3056301006072a8648ce3d020106052b8104000a': {
		name:'secp256k1',
		hex_pub_key_length: 128,
		base64_beginning:'MFYwEAYHKoZIzj0CAQYFK4EEAA'
	},
	'3076301006072a8648ce3d020106052b81040022': {
		name:'secp384r1',
		hex_pub_key_length: 192,
		base64_beginning:'MHYwEAYHKoZIzj0CAQYFK4EEAC'
	},
	'3034301006072a8648ce3d020106052b81040004': {
		name:'sect113r1',
		hex_pub_key_length: 60,
		base64_beginning:'MDQwEAYHKoZIzj0CAQYFK4EEAA'
	},
	'3034301006072a8648ce3d020106052b81040005': {
		name:'sect113r2',
		hex_pub_key_length: 60,
		base64_beginning:'MDQwEAYHKoZIzj0CAQYFK4EEAA'
	},
	'3038301006072a8648ce3d020106052b81040016': {
		name:'sect131r1',
		hex_pub_key_length: 68,
		base64_beginning:'MDgwEAYHKoZIzj0CAQYFK4EEAB'
	},
	'3038301006072a8648ce3d020106052b81040017': {
		name:'sect131r2',
		hex_pub_key_length: 68,
		base64_beginning:'MDgwEAYHKoZIzj0CAQYFK4EEAB'
	},
	'3034301006072a8648ce3d02010605672b010401': {
		name:'wap-wsg-idm-ecid-wtls1',
		hex_pub_key_length: 60,
		base64_beginning:'MDQwEAYHKoZIzj0CAQYFZysBBA'
	},
	'3034301006072a8648ce3d02010605672b010404': {
		name:'wap-wsg-idm-ecid-wtls4',
		hex_pub_key_length: 60,
		base64_beginning:'MDQwEAYHKoZIzj0CAQYFZysBBA'
	},
	'3032301006072a8648ce3d02010605672b010406': {
		name:'wap-wsg-idm-ecid-wtls6',
		hex_pub_key_length: 56,
		base64_beginning:'MDIwEAYHKoZIzj0CAQYFZysBBA'
	},
	'303e301006072a8648ce3d02010605672b010407': {
		name:'wap-wsg-idm-ecid-wtls7',
		hex_pub_key_length: 80,
		base64_beginning:'MD4wEAYHKoZIzj0CAQYFZysBBA'
	},
	'3032301006072a8648ce3d02010605672b010408': {
		name:'wap-wsg-idm-ecid-wtls8',
		hex_pub_key_length: 56,
		base64_beginning:'MDIwEAYHKoZIzj0CAQYFZysBBA'
	},
	'303e301006072a8648ce3d02010605672b010409': {
		name:'wap-wsg-idm-ecid-wtls9',
		hex_pub_key_length: 80,
		base64_beginning:'MD4wEAYHKoZIzj0CAQYFZysBBA'
	}
};