/*jslint node: true */
"use strict";
var ecdsa = require('secp256k1');

exports.sign = function(hash, priv_key){
	var res = ecdsa.sign(hash, priv_key);
	return res.signature.toString("base64");
};

exports.verify = function(hash, b64_sig, b64_pub_key){
	try{
		var signature = new Buffer.from(b64_sig, "base64"); // 64 bytes (32+32)
		return ecdsa.verify(hash, signature, new Buffer.from(b64_pub_key, "base64"));
	}
	catch(e){
		console.log('signature verification exception: '+e.toString());
		return false;
	}
};

