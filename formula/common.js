const nearley = require("nearley");
var Decimal = require('decimal.js');
var constants = require('../constants');
var ValidationUtils = require("../validation_utils.js");
const grammar = require("./grammars/oscript.js");
const grammarPrePemFix = require("./grammars/oscript_pre_pem_fix.js");

var cacheLimit = 100;
// parse results differ between the grammars, so each has its own cache
let caches = {
	post: { formulas: [], results: {} },
	pre: { formulas: [], results: {} },
};

// Before pemCurvesFixMci, formulas must be parsed with the old grammar exactly as before the fix: old units get re-validated by new nodes.
// Throws if the formula can't be parsed.
function parseFormula(formula, bPostPemCurvesFix) {
	let c = bPostPemCurvesFix ? caches.post : caches.pre;
	if (c.results[formula])
		return c.results[formula];
	let parser = new nearley.Parser(nearley.Grammar.fromCompiled(bPostPemCurvesFix ? grammar : grammarPrePemFix));
	parser.feed(formula);
	c.formulas.push(formula);
	c.results[formula] = parser.results;
	if (c.formulas.length > cacheLimit)
		delete c.results[c.formulas.shift()];
	return parser.results;
}

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

Decimal.isDecimal = obj => obj instanceof Decimal;

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
	for (let key in source) {
		if (ValidationUtils.hasOwnProperty(source, key))
			assignField(target, key, source[key]);
	}
}

function assignField(obj, field, value) {
	Object.defineProperty(obj, field, {
		value: value,
		writable: true,
		configurable: true,
		enumerable: true
	});
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

function replaceNulls(obj) {
	if (typeof obj !== 'object')
		return obj;
	if (obj === null)
		return false;
	if (Array.isArray(obj)) {
		for (let i = 0; i < obj.length; i++)
			obj[i] = replaceNulls(obj[i]);
	}
	else {
		for (let key in obj)
			obj[key] = replaceNulls(obj[key]);
	}
	return obj;
}

function fixFormula(formula, address) {
	if (constants.bTestnet && ['IUSWVQLBVRCXJ3W23JUQG5NNVJ3K4BJY', 'VACU4WDHOXCKXVEQ4K2XPBCZC2IA56LC', 'ZQ6WCTPB5LD7EDXSMNJSNUGSR7RN2AC4', '3OTPW4ISZW5DSBBL5EQJTNBBFM2OZGX4', '33RCDV6X3ABU6DCGLXIY3UZMGOWPX7SL', 'BSWZQ2YNCVGJEL7YZSL4RCFLIYUVNUTP', 'SLNCJI6SDRUGAHZ3POPCWBZQ6IE67DNI', 'XENBF353CYD6NEGKXNWRZSE34VKPIFFS', 'MCSSUWCHGTQUWGZKZZAHMUVBNPSTDX5C'].indexOf(address) >= 0)
		return formula.replace('elsevar', 'else var').replace('elseresponse', 'else response').replace('elsebounce', 'else bounce');
	else
		return formula;
}

exports.parseFormula = parseFormula;

exports.Decimal = Decimal;
exports.objBaseAssetInfo = objBaseAssetInfo;

exports.isFiniteDecimal = isFiniteDecimal;
exports.toDoubleRange = toDoubleRange;
exports.createDecimal = createDecimal;
exports.toOscriptPrecision = toOscriptPrecision;
exports.isValidValue = isValidValue;
exports.assignObject = assignObject;
exports.assignField = assignField;

exports.getFormula = getFormula;
exports.hasCases = hasCases;
exports.replaceNulls = replaceNulls;

exports.fixFormula = fixFormula;
