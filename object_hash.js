/*jslint node: true */
"use strict";
var crypto = require('crypto');
var _ = require('lodash');
var chash = require('./chash.js');
var constants = require('./constants.js');
var getSourceString = require('./string_utils').getSourceString;
var getJsonSourceString = require('./string_utils').getJsonSourceString;

function getChash160(obj) {
	return chash.getChash160(getSourceString(obj));
}

function getChash288(obj) {
	return chash.getChash288(getSourceString(obj));
}

function getHexHash(obj) {
	return crypto.createHash("sha256").update(getSourceString(obj), "utf8").digest("hex");
}

function getBase64Hash(obj, bJsonBased) {
	var sourceString = bJsonBased ? getJsonSourceString(obj) : getSourceString(obj)
	return crypto.createHash("sha256").update(sourceString, "utf8").digest("base64");
}


function getNakedUnit(objUnit){
	var objNakedUnit = _.cloneDeep(objUnit);
	delete objNakedUnit.unit;
	delete objNakedUnit.headers_commission;
	delete objNakedUnit.payload_commission;
	delete objNakedUnit.main_chain_index;
	if (objUnit.version === constants.versionWithoutTimestamp)
		delete objNakedUnit.timestamp;
	//delete objNakedUnit.last_ball_unit;
	if (objNakedUnit.messages){
		for (var i=0; i<objNakedUnit.messages.length; i++){
			delete objNakedUnit.messages[i].payload;
			delete objNakedUnit.messages[i].payload_uri;
		}
	}
	//console.log("naked Unit: ", objNakedUnit);
	//console.log("original Unit: ", objUnit);
	return objNakedUnit;
}

function getUnitContentHash(objUnit){
	return getBase64Hash(getNakedUnit(objUnit), objUnit.version !== constants.versionWithoutTimestamp);
}

function getUnitHash(objUnit) {
	var bVersion2 = (objUnit.version !== constants.versionWithoutTimestamp);
	if (objUnit.content_hash) // already stripped
		return getBase64Hash(getNakedUnit(objUnit), bVersion2);
	var objStrippedUnit = {
		content_hash: getUnitContentHash(objUnit),
		version: objUnit.version,
		alt: objUnit.alt,
		authors: objUnit.authors.map(function(author){ return {address: author.address}; }) // already sorted
	};
	if (objUnit.witness_list_unit)
		objStrippedUnit.witness_list_unit = objUnit.witness_list_unit;
	else
		objStrippedUnit.witnesses = objUnit.witnesses;
	if (objUnit.parent_units){
		objStrippedUnit.parent_units = objUnit.parent_units;
		objStrippedUnit.last_ball = objUnit.last_ball;
		objStrippedUnit.last_ball_unit = objUnit.last_ball_unit;
	}
	if (objUnit.version !== constants.versionWithoutTimestamp)
		objStrippedUnit.timestamp = objUnit.timestamp;
	return getBase64Hash(objStrippedUnit, bVersion2);
}

function getUnitHashToSign(objUnit) {
	var objNakedUnit = getNakedUnit(objUnit);
	for (var i=0; i<objNakedUnit.authors.length; i++)
		delete objNakedUnit.authors[i].authentifiers;
	var sourceString = (typeof objUnit.version === 'undefined' || objUnit.version === constants.versionWithoutTimestamp) ? getSourceString(objNakedUnit) : getJsonSourceString(objNakedUnit);
	return crypto.createHash("sha256").update(sourceString, "utf8").digest();
}

function getBallHash(unit, arrParentBalls, arrSkiplistBalls, bNonserial) {
	var objBall = {
		unit: unit
	};
	if (arrParentBalls && arrParentBalls.length > 0)
		objBall.parent_balls = arrParentBalls;
	if (arrSkiplistBalls && arrSkiplistBalls.length > 0)
		objBall.skiplist_balls = arrSkiplistBalls;
	if (bNonserial)
		objBall.is_nonserial = true;
	return getBase64Hash(objBall);
}

function getJointHash(objJoint) {
	// we use JSON.stringify, we can't use objectHash here because it might throw errors
	return crypto.createHash("sha256").update(JSON.stringify(objJoint), "utf8").digest("base64");
}

function cleanNulls(obj){
	Object.keys(obj).forEach(function(key){
		if (obj[key] === null)
			delete obj[key];
	});
}

function cleanNullsDeep(obj){
	Object.keys(obj).forEach(function(key){
		if (obj[key] === null)
			delete obj[key];
		else if (typeof obj[key] === 'object') // array included
			cleanNullsDeep(obj[key]);
	});
}

// -----------------

// prefix device addresses with 0 to avoid confusion with payment addresses
// Note that 0 is not a member of base32 alphabet, which makes device addresses easily distinguishable from payment addresses 
// but still selectable by double-click.  Stripping the leading 0 will not produce a payment address that the device owner knows a private key for,
// because payment address is derived by c-hashing the definition object, while device address is produced from raw public key.
function getDeviceAddress(b64_pubkey){
	return ('0' + getChash160(b64_pubkey));
}

function getDeviceMessageHashToSign(objDeviceMessage) {
	var objNakedDeviceMessage = _.clone(objDeviceMessage);
	delete objNakedDeviceMessage.signature;
	cleanNullsDeep(objNakedDeviceMessage); // device messages have free format and we can't guarantee absence of malicious fields
	return crypto.createHash("sha256").update(getSourceString(objNakedDeviceMessage), "utf8").digest();
}



exports.getChash160 = getChash160;
exports.getChash288 = getChash288;

exports.getHexHash = getHexHash;
exports.getBase64Hash = getBase64Hash;

exports.getUnitContentHash = getUnitContentHash;
exports.getUnitHash = getUnitHash;
exports.getUnitHashToSign = getUnitHashToSign;
exports.getBallHash = getBallHash;
exports.getJointHash = getJointHash;

exports.cleanNulls = cleanNulls;
exports.cleanNullsDeep = cleanNullsDeep;

exports.getDeviceAddress = getDeviceAddress;
exports.getDeviceMessageHashToSign = getDeviceMessageHashToSign;


