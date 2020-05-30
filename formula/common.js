var Decimal = require('decimal.js');
var constants = require('../constants');
var ValidationUtils = require("../validation_utils.js");

var cacheLimit = 100;
var formulasInCache = [];
var cache = {};

// the precision is slightly less than that of IEEE754 double
// the range is slightly wider (9e308 is still ok here but Infinity in double) to make sure numeric data feeds can be safely read.  When written, overflowing datafeeds will be saved as strings only
Decimal.set({
	precision: 15, // double precision is 15.95 https://en.wikipedia.org/wiki/IEEE_754
	rounding: Decimal.ROUND_HALF_EVEN,
	maxE: 308, // double overflows between 1.7e308 and 1.8e308
	minE: -324, // double underflows between 2e-324 and 3e-324
	toExpNeg: -7, // default, same as for js number
	toExpPos: 21, // default, same as for js number
});

var objBaseAssetInfo = {
	cap: constants.TOTAL_WHITEBYTES,
	is_private: false,
	is_transferrable: true,
	auto_destroy: false,
	fixed_denominations: false,
	issued_by_definer_only: true,
	cosigned_by_definer: false,
	spender_attested: false,
	is_issued: true,
	exists: true,
	definer_address: 'MZ4GUQC7WUKZKKLGAS3H3FSDKLHI7HFO',
};

function isFiniteDecimal(val) {
	return (Decimal.isDecimal(val) && val.isFinite() && isFinite(val.toNumber()));
}

function toDoubleRange(val) {
	// check for underflow
	return (val.toNumber() === 0) ? new Decimal(0) : val;
}

function createDecimal(val) {
	return toDoubleRange(new Decimal(val).times(1));
}

// reduces precision to 15 digits to calculate the same result as Oscript would calculate
function toOscriptPrecision(num) {
	return (new Decimal(num).times(1)).toString();
}

function clearObject(obj) {
	Object.keys(obj).forEach(key => {
		delete obj[key];
	});
}

// copies source to target while preserving the target object reference
function assignObject(target, source) {
	clearObject(target);
	Object.assign(target, source);
}

function isValidValue(val){
	return (typeof val === 'string' || typeof val === 'boolean' || isFiniteDecimal(val));
}

function getFormula(str, bOptionalBraces) {
	if (bOptionalBraces)
		throw Error("braces cannot be optional");
	if (typeof str !== 'string')
		return null;
	if (str[0] === '{' && str[str.length - 1] === '}')
		return str.slice(1, -1);
	else if (bOptionalBraces)
		return str;
	else
		return null;
}

function hasCases(value) {
	return (typeof value === 'object' && Object.keys(value).length === 1 && ValidationUtils.isNonemptyArray(value.cases));
}

exports.cache = cache;
exports.formulasInCache = formulasInCache;
exports.cacheLimit = cacheLimit;

exports.Decimal = Decimal;
exports.objBaseAssetInfo = objBaseAssetInfo;

exports.isFiniteDecimal = isFiniteDecimal;
exports.toDoubleRange = toDoubleRange;
exports.createDecimal = createDecimal;
exports.toOscriptPrecision = toOscriptPrecision;
exports.isValidValue = isValidValue;
exports.assignObject = assignObject;

exports.getFormula = getFormula;
exports.hasCases = hasCases;
