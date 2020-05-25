/*jslint node: true */
"use strict";

var STRING_JOIN_CHAR = "\x00";

/**
 * Converts the argument into a string by mapping data types to a prefixed string and concatenating all fields together.
 * @param obj the value to be converted into a string
 * @returns {string} the string version of the value
 */
function getSourceString(obj) {
	var arrComponents = [];
	function extractComponents(variable){
		if (variable === null)
			throw Error("null value in "+JSON.stringify(obj));
		switch (typeof variable){
			case "string":
				arrComponents.push("s", variable);
				break;
			case "number":
				arrComponents.push("n", variable.toString());
				break;
			case "boolean":
				arrComponents.push("b", variable.toString());
				break;
			case "object":
				if (Array.isArray(variable)){
					if (variable.length === 0)
						throw Error("empty array in "+JSON.stringify(obj));
					arrComponents.push('[');
					for (var i=0; i<variable.length; i++)
						extractComponents(variable[i]);
					arrComponents.push(']');
				}
				else{
					var keys = Object.keys(variable).sort();
					if (keys.length === 0)
						throw Error("empty object in "+JSON.stringify(obj));
					keys.forEach(function(key){
						if (typeof variable[key] === "undefined")
							throw Error("undefined at "+key+" of "+JSON.stringify(obj));
						arrComponents.push(key);
						extractComponents(variable[key]);
					});
				}
				break;
			default:
				throw Error("getSourceString: unknown type="+(typeof variable)+" of "+variable+", object: "+JSON.stringify(obj));
		}
	}

	extractComponents(obj);
	return arrComponents.join(STRING_JOIN_CHAR);
}


function encodeMci(mci){
	return (0xFFFFFFFF - mci).toString(16).padStart(8, '0'); // reverse order for more efficient sorting as we always need the latest
}

function getMciFromDataFeedKey(key){
	var arrParts = key.split('\n');
	var strReversedMci = arrParts[arrParts.length-1];
	var reversed_mci = parseInt(strReversedMci, 16);
	var mci = 0xFFFFFFFF - reversed_mci;
	return mci;
}

// df:address:feed_name:type:value:strReversedMci
function getValueFromDataFeedKey(key){
	var m = key.split('\n');
	if (m.length !== 6)
		throw Error("wrong number of elements in data feed "+key);
	var type = m[3];
	var value = m[4];
	return (type === 's') ? value : decodeLexicographicToDouble(value);
}

// returns a number if the value looks like a valid float
function toNumber(value, bLimitedPrecision) {
	if (bLimitedPrecision)
		return getNumericFeedValue(value);
	if (typeof value !== 'string')
		throw Error("toNumber of not a string: "+value);
	var m = value.match(/^[+-]?(\d+(\.\d+)?)([eE][+-]?(\d+))?$/);
	if (!m)
		return null;
	var f = parseFloat(value);
	if (!isFinite(f))
		return null;
	var mantissa = m[1];
	var abs_exp = m[4];
	if (f === 0 && mantissa > 0 && abs_exp > 0) // too small number out of range such as 1.23e-700
		return null;
	return f;
}

function getNumericFeedValue(value, bBySignificantDigits){
	if (typeof value !== 'string')
		throw Error("getNumericFeedValue of not a string: "+value);
	var m = value.match(/^[+-]?(\d+(\.\d+)?)([eE][+-]?(\d+))?$/);
	if (!m)
		return null;
	var f = parseFloat(value);
	if (!isFinite(f))
		return null;
	var mantissa = m[1];
	var abs_exp = m[4];
	if (f === 0 && mantissa > 0 && abs_exp > 0) // too small number out of range such as 1.23e-700
		return null;
	if (bBySignificantDigits) {
		var significant_digits = mantissa.replace(/^0+/, '');
		if (significant_digits.indexOf('.') >= 0)
			significant_digits = significant_digits.replace(/0+$/, '').replace('.', '');
		if (significant_digits.length > 16)
			return null;
	}
	else {
		// mantissa can also be 123.456, 00.123, 1.2300000000, 123000000000, anyway too long number indicates we want to keep it as a string
		if (mantissa.length > 15) // including the point (if any), including 0. in 0.123
			return null;
	}
	return f;
}

// transformss the value to number is possible
function getFeedValue(value, bLimitedPrecision){
	var numValue = toNumber(value, bLimitedPrecision);
	return (numValue === null) ? value : numValue;
}

// https://stackoverflow.com/questions/43299299/sorting-floating-point-values-using-their-byte-representation
function encodeDoubleInLexicograpicOrder(float){
	if (float === -0) // it is actually true for both 0's
		float = 0; // we always assign a positive 0
	var buf = Buffer.allocUnsafe(8);
	buf.writeDoubleBE(float, 0);
	if (float >= 0)
		buf[0] ^= 0x80; // flip the sign bit
	else
		for (var i=0; i<buf.length; i++)
			buf[i] ^= 0xff; // flip the sign bit and reverse the ordering
	return buf.toString('hex');
}

function decodeLexicographicToDouble(hex){
	var buf = Buffer.from(hex, 'hex');
	if (buf[0] & 0x80) // first bit set: positive
		buf[0] ^= 0x80; // flip the sign bit
	else
		for (var i=0; i<buf.length; i++)
			buf[i] ^= 0xff; // flip the sign bit and reverse the ordering
	var float = buf.readDoubleBE(0);
	if (float === -0)
		float = 0;
	return float;
}

// https://github.com/uxitten/polyfill/blob/master/string.polyfill.js
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/padStart
if (!String.prototype.padStart) {
	String.prototype.padStart = function padStart(targetLength, padString) {
		targetLength = targetLength >> 0; //truncate if number, or convert non-number to 0;
		padString = String(typeof padString !== 'undefined' ? padString : ' ');
		if (this.length >= targetLength) {
			return String(this);
		} else {
			targetLength = targetLength - this.length;
			if (targetLength > padString.length) {
				padString += padString.repeat(targetLength / padString.length); //append to original to ensure we are longer than needed
			}
			return padString.slice(0, targetLength) + String(this);
		}
	};
}

// node 12+ implements well-formed JSON.stringify(), earlier versions could generate invalid UTF
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#Well-formed_JSON.stringify()
var bWellFormedJsonStringify = (JSON.stringify("\uD800") === '"\\ud800"');
function toWellFormedJsonStringify(obj) {
	var str = JSON.stringify(obj);
	return bWellFormedJsonStringify ? str : str.replace(/[\ud800-\udfff]/g, chr => "\\u" + chr.codePointAt(0).toString(16));
}

function getJsonSourceString(obj) {
	function stringify(variable){
		if (variable === null)
			throw Error("null value in "+JSON.stringify(obj));
		switch (typeof variable){
			case "string":
				return toWellFormedJsonStringify(variable);
			case "number":
			case "boolean":
				return variable.toString();
			case "object":
				if (Array.isArray(variable)){
					if (variable.length === 0)
						throw Error("empty array in "+JSON.stringify(obj));
					return '[' + variable.map(stringify).join(',') + ']';
				}
				else{
					var keys = Object.keys(variable).sort();
					if (keys.length === 0)
						throw Error("empty object in "+JSON.stringify(obj));
					return '{' + keys.map(function(key){ return toWellFormedJsonStringify(key)+':'+stringify(variable[key]) }).join(',') + '}';
				}
				break;
			default:
				throw Error("getJsonSourceString: unknown type="+(typeof variable)+" of "+variable+", object: "+JSON.stringify(obj));
		}
	}

	return stringify(obj);
}

exports.STRING_JOIN_CHAR = STRING_JOIN_CHAR; // for tests
exports.getSourceString = getSourceString;
exports.encodeMci = encodeMci;
exports.getMciFromDataFeedKey = getMciFromDataFeedKey;
exports.getValueFromDataFeedKey = getValueFromDataFeedKey;
exports.toNumber = toNumber;
exports.getNumericFeedValue = getNumericFeedValue;
exports.getFeedValue = getFeedValue;
exports.encodeDoubleInLexicograpicOrder = encodeDoubleInLexicograpicOrder;
exports.decodeLexicographicToDouble = decodeLexicographicToDouble;
exports.getJsonSourceString = getJsonSourceString;


