/*jslint node: true */
const ecdsa = require('secp256k1');

exports.sign = (hash, priv_key) => {
	const res = ecdsa.sign(hash, priv_key);
	return res.signature.toString("base64");
};

exports.verify = (hash, b64_sig, b64_pub_key) => {
	try{
		const signature = new Buffer(b64_sig, "base64"); // 64 bytes (32+32)
		return ecdsa.verify(hash, signature, new Buffer(b64_pub_key, "base64"));
	}
	catch(e){
		console.log(`signature verification exception: ${e.toString()}`);
		return false;
	}
};

