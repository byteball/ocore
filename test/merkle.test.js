const test = require('ava');
const crypto = require('crypto');
const merkle = require('../merkle.js');

function getRandomString(){
	return crypto.randomBytes(12).toString("base64");
}

function hash(str){
	return crypto.createHash("sha256").update(str, "utf8").digest("base64");
}

test.after.always(t => {
	console.log('***** merkle.test done');
});

test('proofs', t => {
	for (var len = 1; len < 100; len++) {
		var arrElements = [];
		for (var i = 0; i < len; i++)
			arrElements.push(getRandomString());
		for (var i = 0; i < len; i++) {
			var proof = merkle.getMerkleProof(arrElements, i);
			var serialized_proof = merkle.serializeMerkleProof(proof);
			proof = merkle.deserializeMerkleProof(serialized_proof);
			var res = merkle.verifyMerkleProof(arrElements[i], proof);
			if (!res)
				throw Error("proof failed len="+len+", i="+i);
		}
	}
	t.true(true);
});

test('root', t => {
	var arrElements = [getRandomString(), getRandomString()];
	var root = hash(hash(arrElements[0]) + hash(arrElements[1]));
	if (root !== merkle.getMerkleRoot(arrElements))
		throw Error("2-element root failed");
	arrElements.push(getRandomString());
	var root = hash( hash( hash(arrElements[0]) + hash(arrElements[1]) ) + hash( hash(arrElements[2]) + hash(arrElements[2]) ) );
	if (root !== merkle.getMerkleRoot(arrElements))
		throw Error("3-element root failed");
	t.true(true);
});
