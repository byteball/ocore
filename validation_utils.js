/*jslint node: true */
"use strict";
var chash = require('./chash.js');

/**
 * True if there is at least one field in obj that is not in arrFields.
 */
function hasFieldsExcept(obj, arrFields){
	for (var field in obj)
		if (arrFields.indexOf(field) === -1)
			return true;
	return false;
}

/**
 * True if int is an integer as per ES6 Number.isInteger.
 */
function isInteger(int){
	return (typeof int === 'number' && int.toString().indexOf('.') === -1 && !isNaN(int));
}

/**
 * True if int is an integer strictly greater than zero.
 */
function isPositiveInteger(int){
	return (isInteger(int) && int > 0);
}

/**
 * True if int is an integer greater than or equal to zero.
 */
function isNonnegativeInteger(int){
	return (isInteger(int) && int >= 0);
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

function isValidAddressAnyCase(address){
	return isValidChash(address, 32);
}

function isValidAddress(address){
	return (typeof address === "string" && address === address.toUpperCase() && isValidChash(address, 32));
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
	return (typeof b64 === "string" && b64.length === len && b64 === (new Buffer(b64, "base64")).toString("base64"));
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

exports.isValidAddressAnyCase = isValidAddressAnyCase;
exports.isValidAddress = isValidAddress;
exports.isValidDeviceAddress = isValidDeviceAddress;
exports.isValidBase64 = isValidBase64;
