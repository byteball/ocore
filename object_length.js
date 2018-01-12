/*jslint node: true */
const _ = require('lodash');

const PARENT_UNITS_SIZE = 2*44;

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
			let len = 0;
			if (Array.isArray(value))
				value.forEach(element => {
					len += getLength(element);
				});
			else    
				for (const key in value){
					if (typeof value[key] === "undefined")
						throw Error(`undefined at ${key} of ${JSON.stringify(value)}`);
					len += getLength(value[key]);
				}
			return len;
		case "boolean": 
			return 1;
		default:
			throw Error(`unknown type=${typeof value} of ${value}`);
	}
}

function getHeadersSize(objUnit) {
	if (objUnit.content_hash)
		throw Error("trying to get headers size of stripped unit");
	const objHeader = _.cloneDeep(objUnit);
	delete objHeader.unit;
	delete objHeader.headers_commission;
	delete objHeader.payload_commission;
	delete objHeader.main_chain_index;
	delete objHeader.timestamp;
	delete objHeader.messages;
	delete objHeader.parent_units; // replaced with PARENT_UNITS_SIZE
	return getLength(objHeader) + PARENT_UNITS_SIZE;
}

function getTotalPayloadSize({content_hash, messages}) {
	if (content_hash)
		throw Error("trying to get payload size of stripped unit");
	return getLength(messages);
}

exports.getHeadersSize = getHeadersSize;
exports.getTotalPayloadSize = getTotalPayloadSize;
