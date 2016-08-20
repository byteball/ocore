/*jslint node: true */
"use strict";
var _ = require('lodash');

var PARENT_UNITS_SIZE = 2*44;

function getLength(value) {
	if (value === null)
		return 0;
	switch (typeof value){
		case "string": 
			return value.length;
		case "number": 
			return 8;
			//return value.toString().length;
		case "object":
			var len = 0;
			if (Array.isArray(value))
				value.forEach(function(element){
					len += getLength(element);
				});
			else    
				for (var key in value)
					len += getLength(value[key]);
			return len;
		case "boolean": 
			return 1;
		default:
			throw "unknown type="+(typeof value)+" of "+value;
	}
}

function getHeadersSize(objUnit) {
	if (objUnit.content_hash)
		throw "trying to get headers size of stripped unit";
	var objHeader = _.cloneDeep(objUnit);
	delete objHeader.unit;
	delete objHeader.headers_commission;
	delete objHeader.payload_commission;
	delete objHeader.main_chain_index;
	delete objHeader.timestamp;
	delete objHeader.messages;
	delete objHeader.parent_units; // replaced with PARENT_UNITS_SIZE
	return getLength(objHeader) + PARENT_UNITS_SIZE;
}

function getTotalPayloadSize(objUnit) {
	if (objUnit.content_hash)
		throw "trying to get payload size of stripped unit";
	return getLength(objUnit.messages);
}

exports.getHeadersSize = getHeadersSize;
exports.getTotalPayloadSize = getTotalPayloadSize;
