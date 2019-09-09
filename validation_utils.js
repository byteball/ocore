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
 * ES6 Number.isInteger Ponyfill.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/isInteger
 */
function isInteger(value){
	return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
};

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

/**
 * True if str is a string and not the empty string.
 */
function isNonemptyString(str){
	return (typeof str === "string" && str.length > 0);
}

/**
 * True if str is a string and has length len. False if len not provided.
 */
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
	return (typeof b64 === "string" && (!len || b64.length === len) && b64 === (new Buffer.from(b64, "base64")).toString("base64"));
}

function isValidHexadecimal(hex, len){
	try {
		return (typeof hex === "string" && (!len || hex.length === len) && hex === (new Buffer(hex, "hex")).toString("hex"));
	}
	catch (e) {
		return false;
	}
}

function isValidEmail(str) {
	return (typeof str === "string" && /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(str));
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
exports.isValidHexadecimal = isValidHexadecimal;
exports.isValidEmail = isValidEmail;
