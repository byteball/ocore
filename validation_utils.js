/*jslint node: true */
"use strict";
var chash = require('./chash.js');

function hasFieldsExcept(obj, arrFields){
	for (var field in obj)
		if (arrFields.indexOf(field) === -1)
			return true;
	return false;
}

function isInteger(int){
	return (typeof int === 'number' && int.toString().indexOf('.') === -1 && !isNaN(int));
}

function isPositiveInteger(int){
	return (typeof int === 'number' && int > 0 && int.toString().indexOf('.') === -1 && !isNaN(int));
}

function isNonnegativeInteger(int){
	return (typeof int === 'number' && int >= 0 && int.toString().indexOf('.') === -1 && !isNaN(int));
}

function isNonemptyString(str){
	return (typeof str === "string" && str.length > 0);
}

function isStringOfLength(str, len){
	return (typeof str === "string" && str.length === len);
}

function isValidChash(str, len){
	return (isStringOfLength(str, len) && chash.isChashValid(str));
}

function isValidAddress(address){
	return isValidChash(address, 32);
}

function isValidDeviceAddress(address){
	return ( isStringOfLength(address, 33) && address[0] === '0' && isValidAddress(address.substr(1)) );
}

function isNonemptyArray(arr){
	return (Array.isArray(arr) && arr.length > 0);
}

function isArrayOfLength(arr, len){
	return (Array.isArray(arr) && arr.length === len);
}

function isNonemptyObject(obj){
	return (obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj).length > 0);
}

function isValidBase64(b64, len){
	return (b64.length === len && b64 === (new Buffer(b64, "base64")).toString("base64"));
}

exports.hasFieldsExcept = hasFieldsExcept;

exports.isNonemptyString = isNonemptyString;
exports.isStringOfLength = isStringOfLength;

exports.isInteger = isInteger;
exports.isNonnegativeInteger = isNonnegativeInteger;
exports.isPositiveInteger = isPositiveInteger;

exports.isNonemptyObject = isNonemptyObject;

exports.isNonemptyArray = isNonemptyArray;
exports.isArrayOfLength = isArrayOfLength;

exports.isValidAddress = isValidAddress;
exports.isValidDeviceAddress = isValidDeviceAddress;
exports.isValidBase64 = isValidBase64;
