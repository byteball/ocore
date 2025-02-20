/*jslint node: true */
"use strict";
var crypto = require('crypto');

function hash(str){
	return crypto.createHash("sha256").update(str, "utf8").digest("base64");
}

function getMerkleRoot(arrElements){
	var arrHashes = arrElements.map(hash);
	while (arrHashes.length > 1){
		var arrOverHashes = []; // hashes over hashes
		for (var i=0; i<arrHashes.length; i+=2){
			var hash2_index = (i+1 < arrHashes.length) ? (i+1) : i; // for odd number of hashes
			arrOverHashes.push(hash(arrHashes[i] + arrHashes[hash2_index]));
		}
		arrHashes = arrOverHashes;
	}
	return arrHashes[0];
}

function getMerkleProof(arrElements, element_index){
	if (element_index < 0 || element_index >= arrElements.length)
		throw Error("invalid index");
	var arrHashes = arrElements.map(hash);
	var index = element_index;
	var arrSiblings = [];
	while (arrHashes.length > 1){
		var arrOverHashes = []; // hashes over hashes
		var overIndex = null;
		for (var i=0; i<arrHashes.length; i+=2){
			var hash2_index = (i+1 < arrHashes.length) ? (i+1) : i; // for odd number of hashes
			if (i === index){
				arrSiblings.push(arrHashes[hash2_index]);
				overIndex = i/2;
			}
			else if (hash2_index === index){
				arrSiblings.push(arrHashes[i]);
				overIndex = i/2;
			}
			arrOverHashes.push(hash(arrHashes[i] + arrHashes[hash2_index]));
		}
		arrHashes = arrOverHashes;
		if (overIndex === null)
			throw Error("overIndex not defined");
		index = overIndex;
	}
	// add merkle root
	//arrSiblings.push(arrHashes[0]);
	return {
		root: arrHashes[0],
		siblings: arrSiblings,
		index: element_index
	};
}

/*function getSerializedMerkleProof(arrElements, element_index){
	var proof = getMerkleProof(arrElements, element_index);
	var serialized_proof = element_index;//+"-"+hash(arrElements[element_index]);
	if (arrElements.length > 1)
		serialized_proof += "-"+proof.siblings.join("-");
	serialized_proof += "-"+proof.root;
	return serialized_proof;
}*/

// returns a string element_index-siblings_joined_by_dash-root
function serializeMerkleProof(proof){
	var serialized_proof = proof.index;
	if (proof.siblings.length > 0)
		serialized_proof += "-"+proof.siblings.join("-");
	serialized_proof += "-"+proof.root;
	return serialized_proof;
}

function deserializeMerkleProof(serialized_proof){
	var arr = serialized_proof.split("-");
	var proof = {};
	proof.root = arr.pop();
	proof.index = arr.shift();
	proof.siblings = arr;
	return proof;
}

function verifyMerkleProof(element, proof){
	var index = proof.index;
	var the_other_sibling = hash(element);
	for (var i=0; i<proof.siblings.length; i++){
		// this also works for duplicated trailing nodes
		if (index % 2 === 0)
			the_other_sibling = hash(the_other_sibling + proof.siblings[i]);
		else
			the_other_sibling = hash(proof.siblings[i] + the_other_sibling);
		index = Math.floor(index/2);
	}
	return (the_other_sibling === proof.root);
}



exports.getMerkleRoot = getMerkleRoot;

exports.getMerkleProof = getMerkleProof;
exports.verifyMerkleProof = verifyMerkleProof;

exports.serializeMerkleProof = serializeMerkleProof;
exports.deserializeMerkleProof = deserializeMerkleProof;
