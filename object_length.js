/*jslint node: true */
"use strict";
var _ = require('lodash');
var constants = require('./constants.js');

var PARENT_UNITS_SIZE = 2*44;
var PARENT_UNITS_KEY_SIZE = "parent_units".length;

function getLength(value, bWithKeys) {
	let cache = new WeakMap();  // object to length
	function _getLength(value) {
		if (value === null)
			return 0;
		switch (typeof value) {
			case "string":
				return value.length;
			case "number":
				if (!isFinite(value))
					throw Error("invalid number: " + value);
				return 8;
				//return value.toString().length;
			case "object":
				// return cached result if already processed
				if (cache.has(value))
					return cache.get(value);
				var len = 0;
				if (Array.isArray(value))
					value.forEach(function (element) {
						len += _getLength(element);
					});
				else
					for (var key in value) {
						if (typeof value[key] === "undefined")
							throw Error("undefined at " + key + " of " + JSON.stringify(value));
						if (bWithKeys)
							len += key.length;
						len += _getLength(value[key]);
					}
				cache.set(value, len);  // memoize for future references
				return len;
			case "boolean":
				return 1;
			default:
				throw Error("unknown type=" + (typeof value) + " of " + value);
		}
	}
	return _getLength(value);
}

function getHeadersSize(objUnit) {
	if (objUnit.content_hash)
		throw Error("trying to get headers size of stripped unit");
	var objHeader = _.cloneDeep(objUnit);
	delete objHeader.unit;
	delete objHeader.headers_commission;
	delete objHeader.payload_commission;
	delete objHeader.oversize_fee;
//	delete objHeader.tps_fee;
	delete objHeader.actual_tps_fee;
	delete objHeader.main_chain_index;
	if (objUnit.version === constants.versionWithoutTimestamp)
		delete objHeader.timestamp;
	delete objHeader.messages;
	delete objHeader.parent_units; // replaced with PARENT_UNITS_SIZE
	var bWithKeys = (objUnit.version !== constants.versionWithoutTimestamp && objUnit.version !== constants.versionWithoutKeySizes);
	return getLength(objHeader, bWithKeys) + PARENT_UNITS_SIZE + (bWithKeys ? PARENT_UNITS_KEY_SIZE : 0);
}

function getTotalPayloadSize(objUnit) {
	if (objUnit.content_hash)
		throw Error("trying to get payload size of stripped unit");
	var bWithKeys = (objUnit.version !== constants.versionWithoutTimestamp && objUnit.version !== constants.versionWithoutKeySizes);
	const { temp_data_length, messages_without_temp_data } = extractTempData(objUnit.messages);
	return Math.ceil(temp_data_length * constants.TEMP_DATA_PRICE) + getLength({ messages: messages_without_temp_data }, bWithKeys);
}

function extractTempData(messages) {
	let temp_data_length = 0;
	let messages_without_temp_data = messages;
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i];
		if (m.app === "temp_data") {
			if (!m.payload || typeof m.payload.data_length !== "number") // invalid message, but we don't want to throw exceptions here, so just ignore, and validation will fail later
				continue;
			temp_data_length += m.payload.data_length + 4; // "data".length is 4
			if (m.payload.data) {
				if (messages_without_temp_data === messages) // not copied yet
					messages_without_temp_data = _.cloneDeep(messages);
				delete messages_without_temp_data[i].payload.data;
			}
		}
	}
	return { temp_data_length, messages_without_temp_data };
}

function getTempDataLength(objUnit) {
	let temp_data_length = 0;
	for (let m of objUnit.messages){
		if (m.app === "temp_data") {
			if (!m.payload || typeof m.payload.data_length !== "number") // invalid message, but we don't want to throw exceptions here, so just ignore, and validation will fail later
				continue;
			temp_data_length += m.payload.data_length + 4; // "data".length is 4
		}
	}
	return temp_data_length;
}

function getPaidTempDataFee(objUnit) {
	return Math.ceil(getTempDataLength(objUnit) * constants.TEMP_DATA_PRICE);
}

function getRatio(objUnit) {
	try {
		if (objUnit.version === constants.versionWithoutTimestamp || objUnit.version === constants.versionWithoutKeySizes)
			return getLength(objUnit, true) / getLength(objUnit);
	}
	catch (e) {
	}
	return 1;
}

exports.getHeadersSize = getHeadersSize;
exports.getTotalPayloadSize = getTotalPayloadSize;
exports.getRatio = getRatio;
exports.getLength = getLength;
exports.getPaidTempDataFee = getPaidTempDataFee;
