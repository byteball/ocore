var nearley = require("nearley");
var grammar = require("./grammars/oscript.js");
var async = require('async');
var crypto = require('crypto');
var _ = require('lodash');
var base32 = require('thirty-two');
var ValidationUtils = require("../validation_utils.js");
var string_utils = require("../string_utils.js");
var chash = require("../chash.js");
var objectHash = require("../object_hash.js");
var merkle = require('../merkle.js');
var constants = require('../constants');
var conf = require('../conf');
var dataFeeds = require('../data_feeds.js');
var storage = require('../storage.js');
var signed_message = require("../signed_message.js"); // which requires definition.js - cyclic dependency :(
var signature = require('../signature.js');

var cache = require('./common.js').cache;
var formulasInCache = require('./common.js').formulasInCache;
var cacheLimit = require('./common.js').cacheLimit;

var Decimal = require('./common.js').Decimal;
var objBaseAssetInfo = require('./common.js').objBaseAssetInfo;

var isFiniteDecimal = require('./common.js').isFiniteDecimal;
var toDoubleRange = require('./common.js').toDoubleRange;
var createDecimal = require('./common.js').createDecimal;
var assignObject = require('./common.js').assignObject;
var assignField = require('./common.js').assignField;
var isValidValue = require('./common.js').isValidValue;
var getFormula = require('./common.js').getFormula;
var fixFormula = require('./common.js').fixFormula;

var hasOwnProperty = ValidationUtils.hasOwnProperty;

var testnetStringToNumberInArithmeticUpgradeMci = 1151000;

var decimalE = new Decimal(Math.E);
var decimalPi = new Decimal(Math.PI);
var dec0 = new Decimal(0);
var dec1 = new Decimal(1);


function wrappedObject(obj){
	this.obj = obj;
	this.frozen = false;
}

function Func(args, body, scopeVarNames) {
	if (!Array.isArray(args))
		throw Error("args is not an array");
	this.args = args;
	this.body = body;
	this.scopeVarNames = scopeVarNames;
}

exports.evaluate = function (opts, callback) {
	var conn = opts.conn;
	var formula = fixFormula(opts.formula, opts.address);
	var messages = opts.messages || [];
	var trigger = opts.trigger || {};
	var aa_params = opts.params || {};
	var locals = opts.locals || {};
	var stateVars = opts.stateVars || {};
	var responseVars = opts.responseVars || {};
	var bStateVarAssignmentAllowed = opts.bStateVarAssignmentAllowed;
	var bStatementsOnly = opts.bStatementsOnly;
	var bObjectResultAllowed = opts.bObjectResultAllowed;
	var objValidationState = opts.objValidationState;
	var address = opts.address;
	var objResponseUnit = opts.objResponseUnit;
	var mci = objValidationState.last_ball_mci;
	if (!objValidationState.logs)
		objValidationState.logs = [];
	var logs = objValidationState.logs || [];

	if (!ValidationUtils.isPositiveInteger(objValidationState.last_ball_timestamp))
		throw Error('last_ball_timestamp is not a number: ' + objValidationState.last_ball_timestamp);

	var bAA = (messages.length === 0);
	if (!bAA && (bStatementsOnly || bStateVarAssignmentAllowed || bObjectResultAllowed))
		throw Error("bad opts for non-AA");

	var bLimitedPrecision = (mci < constants.aa2UpgradeMci);

	var parser = {};
	if(cache[formula]){
		parser.results = cache[formula];
	}else {
		try {
			parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar));
			parser.feed(formula);
			formulasInCache.push(formula);
			cache[formula] = parser.results;
			if (formulasInCache.length > cacheLimit) {
				var f = formulasInCache.shift();
				delete cache[f];
			}
		}catch (e) {
			console.log('exception from parser', e);
			return callback('parse failed: '+e, null);
		}
	}
	var fatal_error = false;
	var early_return;
	var count = 0;

	function evaluate(arr, cb, bTopLevel) {
		count++;
		if (count % 100 === 0) // avoid extra long call stacks to prevent Maximum call stack size exceeded
			return setImmediate(evaluate, arr, cb);
		if (fatal_error)
			return cb(false);
		if (early_return !== undefined)
			return cb(true);
		if (Decimal.isDecimal(arr)) {
			if (!arr.isFinite())
				return setFatalError("bad decimal: " + arr, cb, false);
			if (!isFinite(arr.toNumber()))
				return setFatalError("number overflow: " + arr, cb, false);
			return cb(toDoubleRange(arr));
		}
		if (arr instanceof Func) return setFatalError("function returned", cb, false);
		if (arr instanceof wrappedObject) return cb(arr);
		if (typeof arr !== 'object') {
			if (typeof arr === 'boolean') return cb(arr);
			if (typeof arr === 'string') {
				if (arr.length > constants.MAX_AA_STRING_LENGTH)
					return setFatalError("string is too long: " + arr, cb, false);
				return cb(arr);
			}
			return setFatalError("unknown type of arr: "+(typeof arr), cb, false);
		}
		var op = arr[0];
		switch (op) {
			case '+':
			case '-':
			case '*':
			case '/':
			case '%':
			case '^':
				var f = '';
				switch (op) {
					case '+':
						f = 'plus';
						break;
					case '-':
						f = 'minus';
						break;
					case '*':
						f = 'times';
						break;
					case '/':
						f = 'div';
						break;
					case '%':
						f = 'mod';
						break;
					case '^':
						f = 'pow';
						break;
				}
				var prevV;
				async.eachSeries(arr.slice(1), function (param, cb2) {
					evaluate(param, function (res) {
						if (fatal_error)
							return cb2(fatal_error);
						if (res instanceof wrappedObject)
							res = true;
						if (typeof res === 'boolean')
							res = res ? dec1 : dec0;
						else if (typeof res === 'string' && (!constants.bTestnet || mci > testnetStringToNumberInArithmeticUpgradeMci)) {
							var float = string_utils.toNumber(res, bLimitedPrecision);
							if (float !== null)
								res = createDecimal(res);
						}
						if (isFiniteDecimal(res)) {
							res = toDoubleRange(res);
							if (prevV === undefined) {
								prevV = res;
							} else {
								if (f === 'pow'){
									if (prevV.eq(decimalE)){ // natural exponential
										console.log('e^x');
										prevV = res.exp();
										return cb2();
									}
									if (res.abs().gte(Number.MAX_SAFE_INTEGER))
										return setFatalError('too large exponent ' + res, cb2);
									if (res.isInteger()) {
										prevV = prevV.pow(res);
										return cb2();
									}
									// sqrt-pow2 would be less accurate
								//	var res2 = res.times(2);
								//	if (res2.isInteger() && res2.abs().lt(Number.MAX_SAFE_INTEGER)) {
								//		prevV = prevV.sqrt().pow(res2);
								//		return cb2();
								//	}
									// else fractional power.  Don't use decimal's pow as it might try to increase the precision of the intermediary result only by 15 digits, not infinitely.  Instead, round the intermediary result to our precision to get a reproducible precision loss
									prevV = toDoubleRange(toDoubleRange(prevV.ln()).times(res)).exp();
									return cb2();
								}
								prevV = prevV[f](res);
							}
							cb2();
						} else {
							return setFatalError('not a decimal in '+op+': '+ res, cb2);
						}

					});
				}, function (err) {
					if (err)
						return cb(false);
					if (!isFiniteDecimal(prevV))
						return setFatalError('not finite in '+op, cb, false);
					cb(toDoubleRange(prevV));
				});
				break;

			case 'sqrt':
			case 'ln':
			case 'abs':
				evaluate(arr[1], function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject)
						res = true;
					if (typeof res === 'boolean')
						res = res ? dec1 : dec0;
					else if (typeof res === 'string') {
						var float = string_utils.toNumber(res, bLimitedPrecision);
						if (float !== null)
							res = createDecimal(res);
					}
					if (isFiniteDecimal(res)) {
						if (op === 'abs')
							return cb(toDoubleRange(res.abs()));
						if (res.isNegative())
							return setFatalError(op + " of negative", cb, false);
						evaluate(toDoubleRange(op === 'sqrt' ? res.sqrt() : res.ln()), cb);
					} else {
						return setFatalError('not a decimal in '+op, cb, false);
					}
				});
				break;

			case 'ceil':
			case 'floor':
			case 'round':
				var dp = arr[2];
				if (!dp)
					dp = dec0;
				evaluate(dp, function(dp_res){
					if (fatal_error)
						return cb(false);
					if (dp_res instanceof wrappedObject)
						dp_res = true;
					if (typeof dp_res === 'boolean')
						dp_res = dp_res ? dec1 : dec0;
					else if (typeof dp_res === 'string') {
						var float = string_utils.toNumber(dp_res, bLimitedPrecision);
						if (float !== null)
							dp_res = createDecimal(dp_res);
					}
					if (Decimal.isDecimal(dp_res) && dp_res.isInteger() && !dp_res.isNegative() && dp_res.lte(15))
						dp = dp_res;
					else{
						return setFatalError('bad dp in ' + op + ': ' + dp + ', ' + dp_res, cb, false);
					}
					var roundingMode;
					switch (op) {
						case 'ceil':
							roundingMode = Decimal.ROUND_CEIL;
							break;
						case 'floor':
							roundingMode = Decimal.ROUND_FLOOR;
							break;
						case 'round':
							roundingMode = Decimal.ROUND_HALF_EVEN;
							break;
					}
					evaluate(arr[1], function (res) {
						if (fatal_error)
							return cb(false);
						if (res instanceof wrappedObject)
							res = true;
						if (typeof res === 'boolean')
							res = res ? dec1 : dec0;
						else if (typeof res === 'string') {
							var float = string_utils.toNumber(res, bLimitedPrecision);
							if (float !== null)
								res = createDecimal(res);
						}
						if (isFiniteDecimal(res)) {
							evaluate(res.toDecimalPlaces(dp.toNumber(), roundingMode), cb);
						} else {
							return setFatalError('not a decimal in '+op, cb, false);
						}
					});
				});
				break;

			case 'min':
			case 'max':
			case 'hypot':
				var vals = [];
				async.eachSeries(arr[1], function (param, cb2) {
					evaluate(param, function (res) {
						if (fatal_error)
							return cb2(fatal_error);
						if (res instanceof wrappedObject)
							res = true;
						if (typeof res === 'boolean')
							res = res ? dec1 : dec0;
						else if (typeof res === 'string') {
							var float = string_utils.toNumber(res, bLimitedPrecision);
							if (float !== null)
								res = createDecimal(res);
						}
						if (isFiniteDecimal(res)) {
							vals.push(res);
							cb2();
						} else {
							return setFatalError('not a decimal in '+op, cb2);
						}
					});
				}, function (err) {
					if (err) {
						return cb(false);
					}
					evaluate(Decimal[op].apply(Decimal, vals), cb);
				});
				break;

			case 'not':
				evaluate(arr[1], function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject)
						res = true;
					else if (Decimal.isDecimal(res) && res.toNumber() === 0)
						res = 0;
					cb(!res);
				});
				break;

			case 'and':
				var prevV = true;
				async.eachSeries(arr.slice(1), function (param, cb2) {
					evaluate(param, function (res) {
						if (fatal_error)
							return cb2(fatal_error);
						if (res instanceof wrappedObject)
							res = true;
						if (typeof res === 'boolean'){
						}
						else if (isFiniteDecimal(res))
							res = (res.toNumber() !== 0);
						else if (typeof res === 'string')
							res = !!res;
						else
							return setFatalError('unrecognized type in ' + op, cb2);
						prevV = prevV && res;
						if (!prevV) // found first false - abort
							return cb2('done');
						cb2();
					});
				}, function (err) {
					if (err === 'done')
						return cb(false);
					cb(!err ? prevV : false);
				});
				break;

			case 'or':
				var prevV = false;
				async.eachSeries(arr.slice(1), function (param, cb2) {
					evaluate(param, function (res) {
						if (fatal_error)
							return cb2(fatal_error);
						if (res instanceof wrappedObject)
							res = true;
						if (typeof res === 'boolean') {
						}
						else if (isFiniteDecimal(res))
							res = (res.toNumber() !== 0);
						else if (typeof res === 'string')
							res = !!res;
						else
							return setFatalError('unrecognized type in ' + op, cb2);
						prevV = prevV || res;
						if (prevV) // found first true - abort
							return cb2('done');
						cb2();
					});
				}, function (err) {
					if (err === 'done')
						return cb(true);
					cb(!err ? prevV : false);
				});
				break;

			case 'comparison':
				var vals = [];
				var operator = arr[1];
				if (operator === '=')
					return setFatalError("= in comparison", cb, false);
				var param1 = arr[2];
				var param2 = arr[3];
				async.forEachOfSeries([param1, param2], function (param, index, cb2) {
					evaluate(param, function (res) {
						if (Decimal.isDecimal(res))
							res = toDoubleRange(res);
						vals[index] = res;
						cb2();
					});
				}, function () {
					if (fatal_error)
						return cb(false);
					var val1 = vals[0];
					var val2 = vals[1];
					if (val1 instanceof wrappedObject && val2 instanceof wrappedObject) {
						if (operator === '==')
							return cb(_.isEqual(val1, val2));
						if (operator === '!=')
							return cb(!_.isEqual(val1, val2));
						return setFatalError("not allowed comparision for objects: " + operator, cb, false);
					}
					if (val1 instanceof wrappedObject || val2 instanceof wrappedObject)
						return setFatalError("objects cannot be compared with other types", cb, false);
					if (typeof val1 === 'boolean' && typeof val2 === 'boolean' || typeof val1 === 'string' && typeof val2 === 'string') {
						switch (operator) {
							case '==':
								return cb(val1 === val2);
							case '>=':
								return cb(val1 >= val2);
							case '<=':
								return cb(val1 <= val2);
							case '!=':
								return cb(val1 !== val2);
							case '>':
								return cb(val1 > val2);
							case '<':
								return cb(val1 < val2);
							default:
								throw Error("unknown comparision: " + operator);
						}
					}
					if (typeof val1 === 'boolean' || typeof val2 === 'boolean')
						return setFatalError("booleans cannot be compared with other types", cb, false);
					if (Decimal.isDecimal(val1) && Decimal.isDecimal(val2)) {
						if (!isFiniteDecimal(val1) || !isFiniteDecimal(val2))
							return setFatalError("non-finite in comparison", cb, false);
						switch (operator) {
							case '==':
								return cb(val1.eq(val2));
							case '>=':
								return cb(val1.gte(val2));
							case '<=':
								return cb(val1.lte(val2));
							case '!=':
								return cb(!(val1.eq(val2)));
							case '>':
								return cb(val1.gt(val2));
							case '<':
								return cb(val1.lt(val2));
							default:
								throw Error("unknown comparision: " + operator);
						}
					}
					if (typeof val1 === 'string' || typeof val2 === 'string') {
						if (typeof val1 !== 'string')
							val1 = val1.toString();
						if (typeof val2 !== 'string')
							val2 = val2.toString();
						switch (operator) {
							case '==':
								return cb(val1 === val2);
							case '!=':
								return cb(val1 !== val2);
							default:
								return setFatalError("not allowed comparision for string-casts: " + operator, cb, false);
						}
					}
					return setFatalError('unrecognized combination of types in '+op, cb, false);
				});
				break;

			case 'ternary':
				var conditionResult;
				evaluate(arr[1], function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject)
						res = true;
					if (typeof res === 'boolean')
						conditionResult = res;
					else if (isFiniteDecimal(res))
						conditionResult = (res.toNumber() !== 0);
					else if (typeof res === 'string')
						conditionResult = !!res;
					else
						return setFatalError('unrecognized type in '+op, cb, false);
					var param2 = conditionResult ? arr[2] : arr[3];
					evaluate(param2, function (res) {
						if (fatal_error)
							return cb(false);
						if (isFiniteDecimal(res))
							cb(toDoubleRange(res));
						else if (typeof res === 'boolean' || typeof res === 'string' || res instanceof wrappedObject)
							cb(res);
						else
							return setFatalError('unrecognized type of res in '+op, cb, false);
					});
				});
				break;

			case 'otherwise':
				evaluate(arr[1], function (param1) {
					if (fatal_error)
						return cb(false);
					// wrappedObject stays intact
					if (Decimal.isDecimal(param1) && param1.toNumber() === 0)
						param1 = 0;
					if (param1)
						return cb(param1);
					// else: false, '', or 0
					evaluate(arr[2], cb);
				});
				break;

			case 'pi':
				cb(decimalPi);
				break;

			case 'e':
				cb(decimalE);
				break;

			case 'data_feed':

				function getDataFeed(params, cb) {
					if (typeof params.oracles.value !== 'string')
						return cb("oracles not a string "+params.oracles.value);
					var arrAddresses = params.oracles.value.split(':');
					if (!arrAddresses.every(ValidationUtils.isValidAddress))
						return cb("bad oracles "+arrAddresses);
					var feed_name = params.feed_name.value;
					if (!feed_name || typeof feed_name !== 'string')
						return cb("empty feed_name or not a string");
					var value = null;
					var relation = '';
					var min_mci = 0;
					if (params.feed_value) {
						value = params.feed_value.value;
						relation = params.feed_value.operator;
						if (!isValidValue(value))
							return cb("bad feed_value: "+value);
					}
					if (params.min_mci) {
						min_mci = params.min_mci.value.toString();
						if (!(/^\d+$/.test(min_mci) && ValidationUtils.isNonnegativeInteger(parseInt(min_mci))))
							return cb("bad min_mci: "+min_mci);
						min_mci = parseInt(min_mci);
					}
					var ifseveral = 'last';
					if (params.ifseveral){
						ifseveral = params.ifseveral.value;
						if (ifseveral !== 'abort' && ifseveral !== 'last')
							return cb("bad ifseveral: "+ifseveral);
					}
					var what = 'value';
					if (params.what){
						what = params.what.value;
						if (what !== 'unit' && what !== 'value')
							return cb("bad what: "+what);
					}
					var type = 'auto';
					if (params.type){
						type = params.type.value;
						if (type !== 'string' && type !== 'auto')
							return cb("bad df type: "+type);
					}
					if (params.ifnone && !isValidValue(params.ifnone.value))
						return cb("bad ifnone: "+params.ifnone.value);
					dataFeeds.readDataFeedValue(arrAddresses, feed_name, value, min_mci, mci, bAA, ifseveral, function(objResult){
					//	console.log(arrAddresses, feed_name, value, min_mci, ifseveral);
					//	console.log('---- objResult', objResult);
						if (objResult.bAbortedBecauseOfSeveral)
							return cb("several values found");
						if (objResult.value !== undefined){
							if (what === 'unit')
								return cb(null, objResult.unit);
							if (type === 'string')
								return cb(null, objResult.value.toString());
							return cb(null, (typeof objResult.value === 'string') ? objResult.value : createDecimal(objResult.value));
						}
						if (params.ifnone && params.ifnone.value !== 'abort'){
						//	console.log('===== ifnone=', params.ifnone.value, typeof params.ifnone.value);
							return cb(null, params.ifnone.value); // the type of ifnone (string, decimal, boolean) is preserved
						}
						cb("data feed " + feed_name + " not found");
					});
				}

				var params = arr[1];
				var evaluated_params = {};
				async.eachSeries(
					Object.keys(params),
					function(param_name, cb2){
						evaluate(params[param_name].value, function(res){
							if (fatal_error)
								return cb2(fatal_error);
							if (res instanceof wrappedObject)
								res = true;
							// boolean allowed for ifnone
							if (!isValidValue(res) || typeof res === 'boolean' && param_name !== 'ifnone')
								return setFatalError('bad value in data feed: '+res, cb2);
							if (Decimal.isDecimal(res))
								res = toDoubleRange(res);
							evaluated_params[param_name] = {
								operator: params[param_name].operator,
								value: res
							};
							cb2();
						});
					},
					function(err){
						if (fatal_error)
							return cb(false);
						getDataFeed(evaluated_params, function (err, result) {
							if (err)
								return setFatalError('error from data feed: '+err, cb, false);
							cb(result);
						});
					}
				);
				break;

			case 'in_data_feed':
				var params = arr[1];
				var evaluated_params = {};
				async.eachSeries(
					Object.keys(params),
					function(param_name, cb2){
						evaluate(params[param_name].value, function(res){
							if (fatal_error)
								return cb2(fatal_error);
							if (res instanceof wrappedObject)
								res = true;
							if (!isValidValue(res) || typeof res === 'boolean')
								return setFatalError('bad in-df param', cb2);
							if (Decimal.isDecimal(res))
								res = toDoubleRange(res);
							evaluated_params[param_name] = {
								operator: params[param_name].operator,
								value: res
							};
							cb2();
						});
					},
					function(err){
						if (fatal_error)
							return cb(false);
						if (typeof evaluated_params.oracles.value !== 'string')
							return setFatalError('oracles is not a string', cb, false);
						var arrAddresses = evaluated_params.oracles.value.split(':');
						if (!arrAddresses.every(ValidationUtils.isValidAddress)) // even if some addresses are ok
							return setFatalError('bad oracles', cb, false);
						var feed_name = evaluated_params.feed_name.value;
						if (!feed_name || typeof feed_name !== 'string')
							return setFatalError('bad feed name', cb, false);
						var value = evaluated_params.feed_value.value;
						var relation = evaluated_params.feed_value.operator;
						if (!isValidValue(value))
							return setFatalError("bad feed_value: "+value, cb, false);
						var min_mci = 0;
						if (evaluated_params.min_mci){
							min_mci = evaluated_params.min_mci.value.toString();
							if (!(/^\d+$/.test(min_mci) && ValidationUtils.isNonnegativeInteger(parseInt(min_mci))))
								return setFatalError('bad min_mci', cb, false);
							min_mci = parseInt(min_mci);
						}
						dataFeeds.dataFeedExists(arrAddresses, feed_name, relation, value, min_mci, mci, bAA, cb);
					}
				);
				break;

			case 'input':
			case 'output':
				var type = op + 's';

				function findOutputOrInputAndReturnName(objParams) {
					var asset = objParams.asset ? objParams.asset.value : null;
					var operator = objParams.asset ? objParams.asset.operator : null;
					var puts = [];
					messages.forEach(function (message) {
						if (message.payload && message.app === 'payment') {
							var payload_asset = message.payload.asset || 'base';
							if (!asset) { // no filter by asset
								puts = puts.concat(message.payload[type]);
							} else if (operator === '=' && asset === payload_asset) {
								puts = puts.concat(message.payload[type]);
							} else if (operator === '!=' && asset !== payload_asset) {
								puts = puts.concat(message.payload[type]);
							}
						}
					});
					if (puts.length === 0){
						console.log('no matching puts after filtering by asset');
						return '';
					}
					if (objParams.address) {
						puts = puts.filter(function (put) {
							if (objParams.address.operator === '=') {
								return put.address === objParams.address.value;
							} else {
								return put.address !== objParams.address.value;
							}
						});
					}
					if (objParams.amount) {
						puts = puts.filter(function (put) {
							put.amount = new Decimal(put.amount);
							if (objParams.amount.operator === '=') {
								return put.amount.eq(objParams.amount.value);
							} else if (objParams.amount.operator === '>') {
								return put.amount.gt(objParams.amount.value);
							} else if (objParams.amount.operator === '<') {
								return put.amount.lt(objParams.amount.value);
							} else if (objParams.amount.operator === '<=') {
								return put.amount.lte(objParams.amount.value);
							} else if (objParams.amount.operator === '>=') {
								return put.amount.gte(objParams.amount.value);
							} else if (objParams.amount.operator === '!=') {
								return !(put.amount.eq(objParams.amount.value));
							}
							else
								throw Error("unknown operator: " + objParams.amount.operator);
						});
					}
					if (puts.length) {
						if (puts.length > 1){
							console.log(puts.length+' matching puts');
							return '';
						}
						return puts[0];
					} else {
						console.log('no matching puts');
						return '';
					}
				}


				var params = arr[1];
				var evaluated_params = {};
				async.eachSeries(
					Object.keys(params),
					function(param_name, cb2){
						evaluate(params[param_name].value, function(res){
							if (fatal_error)
								return cb2(fatal_error);
							if (res instanceof wrappedObject)
								res = true;
							if (!isValidValue(res) || typeof res === 'boolean')
								return setFatalError('bad value in '+op+': '+res, cb2);
							if (Decimal.isDecimal(res))
								res = toDoubleRange(res);
							evaluated_params[param_name] = {
								operator: params[param_name].operator,
								value: res
							};
							cb2();
						});
					},
					function(err){
						if (fatal_error)
							return cb(false);
						if (evaluated_params.address){
							var v = evaluated_params.address.value;
							if (!ValidationUtils.isValidAddress(v))
								return setFatalError('bad address in '+op+': '+v, cb, false);
						}
						if (evaluated_params.asset){
							var v = evaluated_params.asset.value;
							if (!ValidationUtils.isValidBase64(v, constants.HASH_LENGTH) && v !== 'base')
								return setFatalError('bad asset', cb, false);
						}
						if (evaluated_params.amount){
							var v = evaluated_params.amount.value;
							if(!isFiniteDecimal(v))
								return setFatalError('bad amount', cb, false);
						}
						var result = findOutputOrInputAndReturnName(evaluated_params);
						if (result === '')
							return setFatalError('not found or ambiguous '+op, cb, false);
						if (arr[2] === 'amount') {
							cb(new Decimal(result.amount));
						} else if (arr[2] === 'asset') {
							cb(result.asset || 'base')
						} else if (arr[2] === 'address') {
							cb(result.address);
						}
						else
							throw Error("unknown field requested: "+arr[2]);
					}
				);
				break;

			case 'attestation':
				var params = arr[1];
				var field = arr[2];
				var evaluated_params = {};
				async.eachSeries(
					Object.keys(params),
					function(param_name, cb2){
						evaluate(params[param_name].value, function (res) {
							if (fatal_error)
								return cb2(fatal_error);
							if (res instanceof wrappedObject)
								res = true;
							if (typeof res !== 'string' && param_name !== 'ifnone')
								return setFatalError('bad value of '+param_name+' in attestation: '+res, cb2);
							if (Decimal.isDecimal(res)) {
								if (!isFiniteDecimal(res))
									return setFatalError('not finite '+param_name+' in attestation: '+res, cb2);
								res = toDoubleRange(res);
							}
							evaluated_params[param_name] = {
								operator: params[param_name].operator,
								value: res
							};
							cb2();
						});
					},
					function(err){
						if (fatal_error)
							return cb(false);
						params = evaluated_params;

						if (typeof params.attestors.value !== 'string')
							return setFatalError('attestors is not a string', cb, false);
						var arrAttestorAddresses = params.attestors.value.split(':');
						if (!arrAttestorAddresses.every(ValidationUtils.isValidAddress)) // even if some addresses are ok
							return setFatalError('bad attestors', cb, false);

						var v = params.address.value;
						if (!ValidationUtils.isValidAddress(v))
							return setFatalError('bad address in attestation: ' + v, cb, false);

						var ifseveral = 'last';
						if (params.ifseveral) {
							ifseveral = params.ifseveral.value;
							if (ifseveral !== 'last' && ifseveral !== 'abort')
								return setFatalError('bad ifseveral ' + ifseveral, cb, false);
						}

						var type = 'auto';
						if (params.type) {
							type = params.type.value;
							if (type !== 'string' && type !== 'auto')
								return setFatalError('bad att type ' + type, cb, false);
						}

						if (field === null) // special case when we are not interested in any field, just the fact of attestation
							field = false;
						evaluate(field, function (evaluated_field) {
							if (fatal_error)
								return cb(false);
							if (evaluated_field instanceof wrappedObject)
								evaluated_field = true;
							var table, and_field, selected_fields;
							if (field === false) {
								field = null; // restore when no field
								table = 'attestations';
								and_field = '';
								selected_fields = '1';
							}
							else {
								field = evaluated_field;
								if (typeof field !== 'string' || field.length === 0)
									return setFatalError('bad evaluated field: ' + field, cb, false);
								table = 'attested_fields';
								and_field = "AND field = " + conn.escape(field);
								selected_fields = 'value';
							}
							var count_rows = 0;

							function returnValue(rows) {
								if (!field)
									return cb(true);
								var value = rows[0].value;
								if (type === 'auto') {
									var f = string_utils.toNumber(value, bLimitedPrecision);
									if (f !== null)
										value = createDecimal(value);
								}
								return cb(value);
							}

							// first look for attestations in the recent unstable AA units
							conn.query(
								"SELECT " + selected_fields + " \n\
								FROM "+ table +" \n\
								CROSS JOIN units USING(unit) \n\
								CROSS JOIN unit_authors USING(unit) \n\
								CROSS JOIN aa_addresses ON unit_authors.address=aa_addresses.address \n\
								WHERE attestor_address IN(" + arrAttestorAddresses.map(conn.escape).join(', ') + ") \n\
									AND "+ table + ".address = ? " + and_field +" \n\
									AND (main_chain_index > ? OR main_chain_index IS NULL) \n\
								ORDER BY latest_included_mc_index DESC, level DESC, units.unit LIMIT ?",
								[params.address.value, mci, (ifseveral === 'abort') ? 2 : 1],
								function (rows) {
									if (!bAA)
										rows = []; // discard any results
									count_rows += rows.length;
									if (count_rows > 1 && ifseveral === 'abort')
										return setFatalError("several attestations found for " + params.address.value, cb, false);
									if (rows.length > 0 && ifseveral !== 'abort') // if found but ifseveral=abort, we continue
										return returnValue(rows);
									// then check the stable units
									conn.query(
										"SELECT "+selected_fields+" FROM "+table+" CROSS JOIN units USING(unit) \n\
										WHERE attestor_address IN(" + arrAttestorAddresses.map(conn.escape).join(', ') + ") \n\
											AND address = ? "+and_field+" AND main_chain_index <= ? \n\
										ORDER BY main_chain_index DESC, latest_included_mc_index DESC, level DESC, unit LIMIT ?",
										[params.address.value, mci, (ifseveral === 'abort') ? 2 : 1],
										function (rows) {
											count_rows += rows.length;
											if (count_rows > 1 && ifseveral === 'abort')
												return setFatalError("several attestations found for " + params.address.value, cb, false);
											if (rows.length > 0)
												return returnValue(rows);
											if (params.ifnone) // type is never converted
												return cb(params.ifnone.value); // even if no field
											cb(false);
										}
									);
								}
							);
						});
					}
				);
				break;

			case 'concat':
				var operands = [];
				async.eachSeries(arr.slice(1), function (param, cb2) {
					evaluate(param, function (res) {
						if (fatal_error)
							return cb2(fatal_error);
						var operand;
						if (res instanceof wrappedObject)
							operand = res;
						else if (isFiniteDecimal(res))
							operand = toDoubleRange(res).toString();
						else if (typeof res === 'string')
							operand = res;
						else if (typeof res === 'boolean')
							operand = res.toString();
						else
							return setFatalError('unrecognized type in ' + op + ': ' + res, cb2);
						operands.push(operand);
						cb2();
					});
				}, function (err) {
					if (err)
						return cb(false);
					var ret = concat(operands[0], operands[1]);
					if (ret.error)
						return setFatalError(ret.error, cb, false);
					cb(ret.result);
				});
				break;

			case 'storage_size':
				cb(new Decimal(objValidationState.storage_size));
				break;

			case 'mci':
				cb(new Decimal(mci));
				break;

			case 'timestamp':
				cb(new Decimal(objValidationState.last_ball_timestamp));
				break;

			case 'mc_unit':
				cb(objValidationState.mc_unit);
				break;

			case 'number_of_responses':
				cb(new Decimal(objValidationState.number_of_responses));
				break;

			case 'this_address':
				cb(address);
				break;

			case 'trigger.address':
				cb(trigger.address);
				break;

			case 'trigger.initial_address':
				cb(trigger.initial_address);
				break;

			case 'trigger.unit':
				cb(trigger.unit);
				break;

			case 'trigger.initial_unit':
				cb(trigger.initial_unit);
				break;

			case 'trigger.data':
			case 'params':
				var value = (op === 'params') ? aa_params : trigger.data;
				if (!value || Object.keys(value).length === 0)
					return cb(false);
				cb(new wrappedObject(value));
				break;

			case 'previous_aa_responses':
				cb(new wrappedObject(objValidationState.arrPreviousAAResponses));
				break;

			case 'trigger.outputs':
				cb(new wrappedObject(trigger.outputs));
				break;

			case 'trigger.output':
				var comparison_operator = arr[1];
				var asset_expr = arr[2];
				var field = arr[3];
				evaluate(asset_expr, function (asset) {
					if (fatal_error)
						return cb(false);
					if (typeof asset !== 'string' || asset !== 'base' && !ValidationUtils.isValidBase64(asset, constants.HASH_LENGTH))
						return setFatalError("bad asset " + asset, cb, false);
					var output;
					for (var a in trigger.outputs) {
						if (comparison_operator === '=' && a === asset || comparison_operator === '!=' && a !== asset) {
							if (output) {
								console.log("ambiguous output: asset" + comparison_operator + asset);
								output = { asset: 'ambiguous', amount: 0 };
								break;
							}
							output = { asset: a, amount: trigger.outputs[a] };
						}
					}
					if (!output) {
						console.log("output not found: asset"+comparison_operator+asset);
						output = { asset: 'none', amount: 0 };
					}
					if (output.asset === 'ambiguous' && field === 'amount')
						return setFatalError("trying to access amount of ambiguous asset", cb, false);
					output.amount = new Decimal(output.amount);
				//	console.log('output', output)
					cb(output[field]);
				});
				break;

			case 'array':
				var arrItemExprs = arr[1];
				var arrItems = [];
				async.eachSeries(
					arrItemExprs,
					function (item_expr, cb2) {
						evaluate(item_expr, function (res) {
							if (fatal_error)
								return cb2(fatal_error);
							if (res instanceof wrappedObject)
								arrItems.push(res.obj);
							else {
								if (!isValidValue(res))
									return setFatalError("bad value " + res, cb2);
								if (Decimal.isDecimal(res))
									res = res.toNumber();
								arrItems.push(res);
							}
							cb2();
						})
					},
					function (err) {
						if (fatal_error)
							return cb(false);
						cb(new wrappedObject(arrItems));
					}
				);
				break;
			
			case 'dictionary':
				var arrPairs = arr[1];
				var obj = {};
				async.eachSeries(
					arrPairs,
					function (pair, cb2) {
						var key = pair[0];
						evaluate(pair[1], function (res) {
							if (fatal_error)
								return cb2(fatal_error);
							if (res instanceof wrappedObject)
								assignField(obj, key, res.obj);
							else {
								if (!isValidValue(res))
									return setFatalError("bad value " + res, cb2);
								if (Decimal.isDecimal(res))
									res = res.toNumber();
								assignField(obj, key, res);
							}
							cb2();
						});	
					},
					function (err) {
						if (fatal_error)
							return cb(false);
						cb(new wrappedObject(obj));
					}
				);
				break;
	
			case 'local_var':
				var var_name_or_expr = arr[1];
				evaluate(var_name_or_expr, function (var_name) {
				//	console.log('--- evaluated var name', var_name);
					if (fatal_error)
						return cb(false);
					if (typeof var_name !== 'string')
						return setFatalError("var name evaluated to " + var_name, cb, false);
					var value = locals[var_name];
					if (value === undefined || !hasOwnProperty(locals, var_name))
						return cb(false);
					if (value instanceof Func)
						return setFatalError("trying to access function " + var_name + " without calling it", cb, false);
					if (typeof value === 'number')
						value = createDecimal(value);
					cb(value);
				});
				break;

			case 'local_var_assignment':
				// arr[1] is ['local_var', var_name]
				var var_name_or_expr = arr[1];
				var rhs = arr[2];
				var selectors = arr[3];
				evaluate(var_name_or_expr, function (var_name) {
					if (fatal_error)
						return cb(false);
					if (typeof var_name !== 'string')
						return setFatalError("assignment: var name "+var_name_or_expr+" evaluated to " + var_name, cb, false);
					if (hasOwnProperty(locals, var_name)) {
						if (!selectors)
							return setFatalError("reassignment to " + var_name + ", old value " + locals[var_name], cb, false);
						if (!(locals[var_name] instanceof wrappedObject))
							return setFatalError("variable " + var_name + " is not an object", cb, false);
						if (locals[var_name].frozen)
							return setFatalError("variable " + var_name + " is frozen", cb, false);
					}
					else if (selectors)
						return setFatalError("mutating a non-existent var " + var_name, cb, null);
					if (rhs[0] === 'func_declaration') {
						if (selectors)
							return setFatalError("only top level functions are supported", cb, null);
						var args = rhs[1];
						var body = rhs[2];
						var scopeVarNames = Object.keys(locals);
						if (args.indexOf(var_name) >= 0)
							throw Error("arg name cannot be the same as func name in evaluation");
						if (_.intersection(args, scopeVarNames).length > 0)
							return setFatalError("some args of " + var_name + " would shadow some local vars", cb, false);
						assignField(locals, var_name, new Func(args, body, scopeVarNames));
						return cb(true);
					}
					evaluate(rhs, function (res) {
						if (fatal_error)
							return cb(false);
						if (!isValidValue(res) && !(res instanceof wrappedObject))
							return setFatalError("evaluation of rhs " + rhs + " in local var assignment failed: " + JSON.stringify(res), cb, false);
						if (Decimal.isDecimal(res))
							res = toDoubleRange(res);
						if (hasOwnProperty(locals, var_name)) { // mutating an object
							if (!selectors)
								return setFatalError("reassignment to " + var_name + " after evaluation", cb, false);
							if (!(locals[var_name] instanceof wrappedObject))
								throw Error("variable " + var_name + " is not an object");
							if (Decimal.isDecimal(res))
								res = res.toNumber();
							if (res instanceof wrappedObject)
								res = _.cloneDeep(res.obj);
							evaluateSelectorKeys(selectors, function (arrKeys) {
								if (fatal_error)
									return cb(false);
								try {
									assignByPath(locals[var_name].obj, arrKeys, res);
									cb(true);
								}
								catch (e) {
									setFatalError(e.toString(), cb, false);
								}
							});
						}
						else { // regular assignment
							if (res instanceof wrappedObject) // copy because we might need to mutate it
								assignField(locals, var_name, new wrappedObject(_.cloneDeep(res.obj)) );
							else
								assignField(locals, var_name, res);
							cb(true);
						}
					});
				});
				break;

			case 'state_var_assignment':
				if (!bStateVarAssignmentAllowed)
					return setFatalError("state var assignment not allowed here", cb, false);
				var var_name_or_expr = arr[1];
				var rhs = arr[2];
				var assignment_op = arr[3];
				evaluate(var_name_or_expr, function (var_name) {
					if (fatal_error)
						return cb(false);
					if (typeof var_name !== 'string')
						return setFatalError("assignment: var name "+var_name_or_expr+" evaluated to " + var_name, cb, false);
					evaluate(rhs, function (res) {
						if (fatal_error)
							return cb(false);
						if (!isValidValue(res) && !(res instanceof wrappedObject))
							return setFatalError("evaluation of rhs " + rhs + " in state var assignment failed: " + JSON.stringify(res), cb, false);
						if (Decimal.isDecimal(res))
							res = toDoubleRange(res);
						// state vars can store strings, decimals, objects, and booleans but booleans are treated specially when persisting to the db: true is converted to 1, false deletes the var
						if (res instanceof wrappedObject) {
							if (mci < constants.aa2UpgradeMci)
								res = true;
							else {
								if (assignment_op !== '=' && assignment_op !== '||=')
									return setFatalError(assignment_op + " not supported for object vars", cb, false);
								try {
									var json = string_utils.getJsonSourceString(res.obj, true);
								}
								catch (e) {
									return setFatalError("stringify failed: " + e, cb, false);
								}
								if (json.length > constants.MAX_STATE_VAR_VALUE_LENGTH)
									return setFatalError("state var value too long when in json: " + json, cb, false);
								res = new wrappedObject(_.cloneDeep(res.obj)); // make a copy
							}
						}
						if (var_name.length > constants.MAX_STATE_VAR_NAME_LENGTH)
							return setFatalError("state var name too long: " + var_name, cb, false);
					//	if (typeof res === 'boolean')
					//		res = res ? dec1 : dec0;
						if (!stateVars[address])
							stateVars[address] = {};
					//	console.log('---- assignment_op', assignment_op)
						readVar(address, var_name, function (value) {
							if (assignment_op === "=") {
								if (typeof res === 'string' && res.length > constants.MAX_STATE_VAR_VALUE_LENGTH)
									return setFatalError("state var value too long: " + res, cb, false);
								stateVars[address][var_name].value = res;
								stateVars[address][var_name].updated = true;
								return cb(true);
							}
							if (value instanceof wrappedObject && assignment_op !== '||=')
								return setFatalError("can't " + assignment_op + " to object", cb, false);
							if (assignment_op === '||=') {
								var ret = concat(value, res);
								if (ret.error)
									return setFatalError("state var assignment: " + ret.error, cb, false);
								value = ret.result;
							}
							else {
								if (typeof value === 'boolean')
									value = value ? dec1 : dec0;
								if (typeof res === 'boolean')
									res = res ? dec1 : dec0;
								if (!Decimal.isDecimal(value))
									return setFatalError("current value is not decimal: " + value, cb, false);
								if (!Decimal.isDecimal(res))
									return setFatalError("rhs is not decimal: " + res, cb, false);
								if ((assignment_op === '+=' || assignment_op === '-=') && stateVars[address][var_name].old_value === undefined)
									stateVars[address][var_name].old_value = dec0;
								if (assignment_op === '+=')
									value = value.plus(res);
								else if (assignment_op === '-=')
									value = value.minus(res);
								else if (assignment_op === '*=')
									value = value.times(res);
								else if (assignment_op === '/=')
									value = value.div(res);
								else if (assignment_op === '%=')
									value = value.mod(res);
								else
									throw Error("unknown assignment op: " + assignment_op);
								if (!isFiniteDecimal(value))
									return setFatalError("not finite: " + value, cb, false);
								value = toDoubleRange(value);
							}
							stateVars[address][var_name].value = value;
							stateVars[address][var_name].updated = true;
							cb(true);
						});
					});
				});
				break;

			case 'response_var_assignment':
				var var_name_or_expr = arr[1];
				var rhs = arr[2];
				evaluate(var_name_or_expr, function (var_name) {
					if (fatal_error)
						return cb(false);
					if (typeof var_name !== 'string')
						return setFatalError("assignment: var name "+var_name_or_expr+" evaluated to " + var_name, cb, false);
					evaluate(rhs, function (res) {
						if (fatal_error)
							return cb(false);
						// response vars - strings, numbers, and booleans
						if (res instanceof wrappedObject)
							res = true;
						if (!isValidValue(res))
							return setFatalError("evaluation of rhs " + rhs + " in response var assignment failed: " + JSON.stringify(res), cb, false);
						if (Decimal.isDecimal(res)) {
							res = res.toNumber();
							if (!isFinite(res))
								return setFatalError("not finite js number in response_var_assignment", cb, false);
						}
						assignField(responseVars, var_name, res);
						cb(true);
					});
				});
				break;

			case 'block':
				var arrStatements = arr[1];
				async.eachSeries(
					arrStatements,
					function (statement, cb2) {
						evaluate(statement, function (res) {
							if (fatal_error)
								return cb2(fatal_error);
						//	if (res !== true)
						//		return setFatalError("statement in {} " + statement + " failed", cb2);
							cb2();
						});
					},
					function (err) {
						if (fatal_error)
							return cb(false);
						if (err)
							return setFatalError("statements in {} failed: " + err, cb, false);
						cb(true);
					}
				);
				break;

			case 'ifelse':
				var test = arr[1];
				var if_block = arr[2];
				var else_block = arr[3];
				evaluate(test, function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject)
						res = true;
					if (!isValidValue(res))
						return setFatalError("bad value in ifelse: " + res, cb, false);
					if (Decimal.isDecimal(res))
						res = (res.toNumber() !== 0);
					else if (typeof res === 'object')
						throw Error("test evaluated to object " + res);
					if (!res && !else_block)
						return cb(true);
					var block = res ? if_block : else_block;
					evaluate(block, cb);
				});
				break;

			case 'var':
			case 'balance':
				var param1 = arr[1];
				var param2 = arr[2];
				evaluate(param1, function (evaluated_param1) {
					if (fatal_error)
						return cb(false);
					if (typeof evaluated_param1 !== 'string')
						return setFatalError("1st var name is not a string: " + evaluated_param1, cb, false);
					if (param2 === null)
						return ((op === 'var') ? readVar(address, evaluated_param1, cb) : readBalance(address, evaluated_param1, cb));
					// then, the 1st param is the address of an AA whose state or balance we are going to query
					var param_address = evaluated_param1;
					if (!ValidationUtils.isValidAddress(param_address))
						return setFatalError("var address is invalid: " + param_address, cb, false);
					evaluate(param2, function (evaluated_param2) {
						if (fatal_error)
							return cb(false);
						if (typeof evaluated_param2 !== 'string')
							return setFatalError("2nd var name is not a string: " + evaluated_param2, cb, false);
						(op === 'var')
							? readVar(param_address, evaluated_param2, cb)
							: readBalance(param_address, evaluated_param2, cb);
					});
				});

				function readBalance(param_address, bal_asset, cb2) {
					if (bal_asset !== 'base' && !ValidationUtils.isValidBase64(bal_asset, constants.HASH_LENGTH))
						return setFatalError('bad asset ' + bal_asset, cb, false);

					if (!objValidationState.assocBalances[param_address])
						objValidationState.assocBalances[param_address] = {};
					var balance = objValidationState.assocBalances[param_address][bal_asset];
					if (balance !== undefined)
						return cb2(new Decimal(balance));
					conn.query(
						"SELECT balance FROM aa_balances WHERE address=? AND asset=? ",
						[param_address, bal_asset],
						function (rows) {
							balance = rows.length ? rows[0].balance : 0;
							objValidationState.assocBalances[param_address][bal_asset] = balance;
							cb2(new Decimal(balance));
						}
					);
				}
				break;

			case 'asset':
				var asset_expr = arr[1];
				var field_expr = arr[2];
				evaluate(asset_expr, function (asset) {
					if (fatal_error)
						return cb(false);
					evaluate(field_expr, function (field) {
						if (fatal_error)
							return cb(false);
						if (typeof field !== 'string' || !objBaseAssetInfo.hasOwnProperty(field))
							return setFatalError("bad field in asset[]: " + field, cb, false);
						var convertValue = (value) => (typeof value === 'number' && mci >= constants.aa3UpgradeMci) ? new Decimal(value) : value;
						if (asset === 'base')
							return cb(convertValue(objBaseAssetInfo[field]));
						if (!ValidationUtils.isValidBase64(asset, constants.HASH_LENGTH)) {
							if (field === 'exists')
								return cb(false);
							return setFatalError("bad asset in asset[]: " + asset, cb, false);
						}
						readAssetInfoPossiblyDefinedByAA(asset, function (objAsset) {
							if (!objAsset)
								return cb(false);
							if (objAsset.sequence !== "good")
								return cb(false);
							if (field === 'cap') // can be null
								return cb(convertValue(objAsset.cap || 0));
							if (field === 'definer_address')
								return cb(objAsset.definer_address);
							if (field === 'exists')
								return cb(true);
							if (field !== 'is_issued')
								return cb(!!objAsset[field]);
							conn.query("SELECT 1 FROM inputs WHERE type='issue' AND asset=? LIMIT 1", [asset], function(rows){
								cb(rows.length > 0);
							});
						});
					});
				});
				break;

			case 'unit':
				var unit_expr = arr[1];
				evaluate(unit_expr, function (unit) {
					console.log('---- unit', unit);
					if (fatal_error)
						return cb(false);
					if (!ValidationUtils.isValidBase64(unit, constants.HASH_LENGTH))
						return cb(false);
					if (bAA) {
						// 1. check the current response unit
						if (objResponseUnit && objResponseUnit.unit === unit)
							return cb(new wrappedObject(objResponseUnit));
						// 2. check previous response units from the same primary trigger, they are not in the db yet
						for (var i = 0; i < objValidationState.arrPreviousAAResponses.length; i++) {
							var objPreviousResponseUnit = objValidationState.arrPreviousAAResponses[i].unit_obj;
							if (objPreviousResponseUnit && objPreviousResponseUnit.unit === unit)
								return cb(new wrappedObject(objPreviousResponseUnit));
						}
					}
					// 3. check the units from the db
					console.log('---- reading', unit);
					storage.readJoint(conn, unit, {
						ifNotFound: function () {
							cb(false);
						},
						ifFound: function (objJoint, sequence) {
							console.log('---- found', unit);
							if (sequence !== 'good') // bad units don't exist for us
								return cb(false);
							var objUnit = objJoint.unit;
							if (objUnit.version === constants.versionWithoutTimestamp)
								objUnit.timestamp = 0;
							var unit_mci = objUnit.main_chain_index;
							// ignore non-AA units that are not stable or created at a later mci
							if (unit_mci === null || unit_mci > mci) {
								if (bAA && objUnit.authors[0].authentifiers) // non-AA unit
									return cb(false);
								if (!bAA)
									return cb(false);
							}
							cb(new wrappedObject(objUnit));
						}
					});
				});
				break;

			case 'definition':
				var address_expr = arr[1];
				evaluate(address_expr, function (addr) {
					console.log('---- definition', addr);
					if (fatal_error)
						return cb(false);
					if (!ValidationUtils.isValidAddress(addr))
						return cb(false);
					storage.readAADefinition(conn, addr, function (arrDefinition, definition_unit) {
						if (arrDefinition) {
							if (bAA)
								return cb(new wrappedObject(arrDefinition));
							// could be defined later, e.g. by fresh AA
							storage.readUnitProps(conn, definition_unit, function (props) {
								if (props.main_chain_index === null || props.main_chain_index > mci)
									return cb(false);
								cb(new wrappedObject(arrDefinition));
							});
							return;
						}
						storage.readDefinitionByAddress(conn, addr, mci, {
							ifDefinitionNotFound: function () {
								cb(false);
							},
							ifFound: function (arrDefinition) {
								cb(new wrappedObject(arrDefinition));
							}
						});
					});
				});
				break;

			case 'is_valid_signed_package':
				var signed_package_expr = arr[1];
				var address_expr = arr[2];
				evaluate(address_expr, function (evaluated_address) {
					if (fatal_error)
						return cb(false);
					if (!ValidationUtils.isValidAddress(evaluated_address))
						return setFatalError("bad address in is_valid_signed_package: " + evaluated_address, cb, false);
					evaluate(signed_package_expr, function (signedPackage) {
						if (fatal_error)
							return cb(false);
						if (!(signedPackage instanceof wrappedObject))
							return cb(false);
						signedPackage = signedPackage.obj;
						if (ValidationUtils.hasFieldsExcept(signedPackage, ['signed_message', 'last_ball_unit', 'authors', 'version']))
							return cb(false);
						if (signedPackage.version === constants.versionWithoutTimestamp)
							return cb(false);
						signed_message.validateSignedMessage(conn, signedPackage, evaluated_address, function (err, last_ball_mci) {
							if (err)
								return cb(false);
							if (last_ball_mci === null || last_ball_mci > mci)
								return cb(false);
							cb(true);
						});
					});
				});
				break;

			case 'is_valid_sig':
				var message = arr[1];
				var pem_key = arr[2];
				var sig = arr[3];
				evaluate(message, function (evaluated_message) {
					if (fatal_error)
						return cb(false);
					if (!ValidationUtils.isNonemptyString(evaluated_message))
						return setFatalError("bad message string in is_valid_sig", cb, false);
					evaluate(sig, function (evaluated_signature) {
						if (fatal_error)
							return cb(false);
						if (!ValidationUtils.isNonemptyString(evaluated_signature))
							return setFatalError("bad signature string in is_valid_sig", cb, false);
						if (evaluated_signature.length > 1024)
							return setFatalError("signature is too large", cb, false);
						if (!ValidationUtils.isValidHexadecimal(evaluated_signature) && !ValidationUtils.isValidBase64(evaluated_signature))
							return setFatalError("bad signature string in is_valid_sig", cb, false);
						evaluate(pem_key, function (evaluated_pem_key) {
							if (fatal_error)
								return cb(false);
							signature.validateAndFormatPemPubKey(evaluated_pem_key, "any", function (error, formatted_pem_key){
								if (error)
									return setFatalError("bad PEM key in is_valid_sig: " + error, cb, false);
								var result = signature.verifyMessageWithPemPubKey(evaluated_message, evaluated_signature, formatted_pem_key);
								return cb(result);
							});
						});
					});
				});
				break;

			case 'vrf_verify':
				var seed = arr[1];
				var proof = arr[2];
				var pem_key = arr[3];
				evaluate(seed, function (evaluated_seed) {
					if (fatal_error)
						return cb(false);
					if (!ValidationUtils.isNonemptyString(evaluated_seed))
						return setFatalError("bad seed in vrf_verify", cb, false);
					evaluate(proof, function (evaluated_proof) {
						if (fatal_error)
							return cb(false);
						if (!ValidationUtils.isNonemptyString(evaluated_proof))
							return setFatalError("bad proof string in vrf_verify", cb, false);
						if (evaluated_proof.length > 1024)
							return setFatalError("proof is too large", cb, false);
						if (!ValidationUtils.isValidHexadecimal(evaluated_proof))
							return setFatalError("bad signature string in vrf_verify", cb, false);
						evaluate(pem_key, function (evaluated_pem_key) {
							if (fatal_error)
								return cb(false);
							signature.validateAndFormatPemPubKey(evaluated_pem_key, "RSA", function (error, formatted_pem_key){
								if (error)
									return setFatalError("bad PEM key in vrf_verify: " + error, cb, false);
								var result = signature.verifyMessageWithPemPubKey(evaluated_seed, evaluated_proof, formatted_pem_key);
								return cb(result);
							});
						});
					});
				});
				break;

			case 'is_valid_merkle_proof':
				var element_expr = arr[1];
				var proof_expr = arr[2];
				evaluate(element_expr, function (element) {
					if (fatal_error)
						return cb(false);
					if (typeof element === 'boolean' || isFiniteDecimal(element))
						element = element.toString();
					if (!ValidationUtils.isNonemptyString(element))
						return setFatalError("bad element in is_valid_merkle_proof", cb, false);
					evaluate(proof_expr, function (proof) {
						if (fatal_error)
							return cb(false);
						var objProof;
						if (proof instanceof wrappedObject)
							objProof = proof.obj;
						else if (typeof proof === 'string') {
							if (proof.length > 1024)
								return setFatalError("proof is too large", cb, false);
							objProof = merkle.deserializeMerkleProof(proof);
						}
						else // can't be valid proof
							return cb(false);
						cb(merkle.verifyMerkleProof(element, objProof));
					});
				});
				break;

			case 'sha256':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject) {
						if (mci < constants.aa2UpgradeMci)
							res = true;
						else
							res = string_utils.getJsonSourceString(res.obj, true); // it's ok if the string is longer than MAX_AA_STRING_LENGTH
					}
					if (!isValidValue(res))
						return setFatalError("invalid value in sha256: " + res, cb, false);
					if (Decimal.isDecimal(res))
						res = toDoubleRange(res);
					var format_expr = arr[2];
					if (format_expr === null || format_expr === 'base64')
						return cb(crypto.createHash("sha256").update(res.toString(), "utf8").digest("base64"));
					evaluate(format_expr, function (format) {
						if (fatal_error)
							return cb(false);
						if (format !== 'base64' && format !== 'hex' && format !== 'base32')
							return setFatalError("bad format of sha256: " + format, cb, false);
						var h = crypto.createHash("sha256").update(res.toString(), "utf8");
						if (format === 'base32')
							cb(base32.encode(h.digest()).toString());
						else
							cb(h.digest(format));
					});
				});
				break;

			case 'chash160':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject) {
						try {
							var chash160 = objectHash.getChash160(res.obj);
						}
						catch (e) {
							return setFatalError("chash160 failed: " + e, cb, false);
						}
						return cb(chash160);
					}
					if (!isValidValue(res))
						return setFatalError("invalid value in chash160: " + res, cb, false);
					if (Decimal.isDecimal(res))
						res = toDoubleRange(res);
					cb(chash.getChash160(res.toString()));
				});
				break;

			case 'number_from_seed':
				var evaluated_params = [];
				async.eachSeries(
					arr[1],
					function (param, cb2) {
						evaluate(param, function (res) {
							if (fatal_error)
								return cb2(fatal_error);
							if (res instanceof wrappedObject)
								res = true;
							if (!isValidValue(res))
								return setFatalError("invalid value in sha256: " + res, cb, false);
							if (isFiniteDecimal(res))
								res = toDoubleRange(res);
							evaluated_params.push(res);
							cb2();
						});
					},
					function (err) {
						if (err)
							return cb(false);
						var seed = evaluated_params[0];
						var hash = crypto.createHash("sha256").update(seed.toString(), "utf8").digest("hex");
						var head = hash.substr(0, 16);
						var nominator = new Decimal("0x" + head);
						var denominator = new Decimal("0x1" + "0".repeat(16));
						var num = nominator.div(denominator); // float from 0 to 1
						if (evaluated_params.length === 1)
							return cb(num);
						var min = dec0;
						var max;
						if (evaluated_params.length === 2)
							max = evaluated_params[1];
						else {
							min = evaluated_params[1];
							max = evaluated_params[2];
						}
						if (!isFiniteDecimal(min) || !isFiniteDecimal(max))
							return setFatalError("min and max must be numbers", cb, false);
						if (!min.isInteger() || !max.isInteger())
							return setFatalError("min and max must be integers", cb, false);
						if (!max.gt(min))
							return setFatalError("max must be greater than min", cb, false);
						var len = max.minus(min).plus(1);
						num = num.times(len).floor().plus(min);
						cb(num);
					}
				);
				break;

			case 'json_parse':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject)
						res = true;
					//	return setFatalError("json_parse of object", cb, false);
					if (Decimal.isDecimal(res))
						res = toDoubleRange(res);
					if (typeof res !== 'string')
						res = res.toString();
					try {
						var json = JSON.parse(res);
					}
					catch (e) {
						console.log('json_parse failed: ' + e.toString());
						return cb(false);
					}
					if (typeof json === 'object')
						return cb(new wrappedObject(json));
					if (typeof json === 'number')
						return evaluate(createDecimal(json), cb);
					if (typeof json === 'string' || typeof json === 'boolean')
						return cb(json);
					throw Error("unknown type of json parse: " + (typeof json));
				});
				break;

			case 'json_stringify':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject)
						res = res.obj;
					else if (Decimal.isDecimal(res)) {
						if (!res.isFinite())
							return setFatalError("not finite decimal: " + res, cb, false);
						res = res.toNumber();
						if (!isFinite(res))
							return setFatalError("not finite js number: " + res, cb, false);
					}
					var bAllowEmpty = (mci >= constants.aa2UpgradeMci);
					var json = string_utils.getJsonSourceString(res, bAllowEmpty); // sorts keys unlike JSON.stringify()
					if (json.length > constants.MAX_AA_STRING_LENGTH)
						return setFatalError("json_stringified is too long", cb, false);
					cb(json);
				});
				break;

			case 'length':
			case 'to_upper':
			case 'to_lower':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (op === 'length'){
						if (res instanceof wrappedObject) {
							if (mci < constants.aa2UpgradeMci)
								res = true;
							else
								return cb(new Decimal(Array.isArray(res.obj) ? res.obj.length : Object.keys(res.obj).length));
						}
						return cb(new Decimal(res.toString().length));
					}
					if (res instanceof wrappedObject)
						res = true;
					if (op === 'to_upper')
						return cb(res.toString().toUpperCase());
					if (op === 'to_lower')
						return cb(res.toString().toLowerCase());
					throw Error("unknown op: " + op);
				});
				break;

			case 'starts_with':
			case 'ends_with':
			case 'contains':
			case 'has_only':
			case 'index_of':
				var str_expr = arr[1];
				var sub_expr = arr[2];
				evaluate(str_expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject)
						res = true;
					var str = res.toString();
					evaluate(sub_expr, function (sub_res) {
						if (fatal_error)
							return cb(false);
						if (sub_res instanceof wrappedObject)
							sub_res = true;
						var sub = sub_res.toString();
						if (op === 'starts_with')
							return cb(str.startsWith(sub));
						if (op === 'ends_with')
							return cb(str.endsWith(sub));
						if (op === 'contains')
							return cb(str.includes(sub));
						if (op === 'index_of')
							return cb(new Decimal(str.indexOf(sub)));
						if (op === 'has_only') {
							try {
								console.log('has only ' + str + ' ' + sub);
								if (sub.match(/\\]/) || sub[sub.length - 1] === '\\')
									return setFatalError("invalid character group: " + sub, cb, false);
								sub = sub.replace(/]/g, '\\]'); // don't allow to close the group early
								var bMatches = new RegExp("^[" + sub + "]*$").test(str);
							}
							catch (e) {
								console.log("regexp failed:", e);
								var bMatches = false;
							}
							return cb(bMatches);
						}
						throw Error("unknown op: " + op);
					});
				});
				break;

			case 'substring':
				var str_expr = arr[1];
				var start_expr = arr[2];
				var length_expr = arr[3];
				evaluate(str_expr, function (str) {
					if (fatal_error)
						return cb(false);
					if (str instanceof wrappedObject)
						str = true;
					str = str.toString();
					evaluate(start_expr, function (start) {
						if (fatal_error)
							return cb(false);
						if (typeof start === 'string') {
							var f = string_utils.toNumber(start);
							if (f !== null && mci >= constants.aa2UpgradeMci)
								start = createDecimal(f);
							else
								return setFatalError("start index in substring cannot be a string", cb, false);
						}
						if (start instanceof wrappedObject)
							start = true;
						if (typeof start === 'boolean')
							start = start ? 1 : 0;
						else if (Decimal.isDecimal(start))
							start = start.toNumber();
						else
							throw Error("unknown type of start in substring: " + start);
						if (!ValidationUtils.isInteger(start))
							return setFatalError("start index must be integer: " + start, cb, false);
						if (!length_expr)
							return cb(str.substr(start));
						evaluate(length_expr, function (length) {
							if (fatal_error)
								return cb(false);
							if (typeof length === 'string') {
								var f = string_utils.toNumber(length);
								if (f !== null && mci >= constants.aa2UpgradeMci)
									length = createDecimal(f);
								else
									return setFatalError("length in substring cannot be a string", cb, false);
							}
							if (length instanceof wrappedObject)
								length = true;
							if (typeof length === 'boolean')
								length = length ? 1 : 0;
							else if (Decimal.isDecimal(length))
								length = length.toNumber();
							else
								throw Error("unknown type of length in substring: " + length);
							if (!ValidationUtils.isInteger(length))
								return setFatalError("length must be integer: " + length, cb, false);
							cb(str.substr(start, length));
						});
					});
				});
				break;

			case 'replace':
				var str_expr = arr[1];
				var search_expr = arr[2];
				var replacement_expr = arr[3];
				evaluate(str_expr, function (str) {
					if (fatal_error)
						return cb(false);
					if (str instanceof wrappedObject)
						str = true;
					str = str.toString();
					evaluate(search_expr, function (search_str) {
						if (fatal_error)
							return cb(false);
						if (search_str instanceof wrappedObject)
							search_str = true;
						search_str = search_str.toString();
						evaluate(replacement_expr, function (replacement) {
							if (fatal_error)
								return cb(false);
							if (replacement instanceof wrappedObject)
								replacement = true;
							replacement = replacement.toString();
							var parts = str.split(search_str);
							var new_str = parts.join(replacement);
							if (new_str.length > constants.MAX_AA_STRING_LENGTH)
								return setFatalError("the string after replace would be too long: " + new_str, cb, false);
							cb(new_str);
						});
					});
				});
				break;

			case 'split':
			case 'join':
				if (mci < constants.aa2UpgradeMci)
					return cb(op + " not activated yet");
				var expr = arr[1];
				var separator_expr = arr[2];
				var limit_expr = arr[3];
				evaluate(separator_expr, function (separator) {
					if (fatal_error)
						return cb(false);
					if (separator instanceof wrappedObject)
						separator = true;
					separator = separator.toString();
					evaluate(expr, function (res) {
						if (fatal_error)
							return cb(false);
						if (op === 'split') {
							if (res instanceof wrappedObject)
								res = true;
							res = res.toString();
							if (!limit_expr)
								return cb(new wrappedObject(res.split(separator)));
							evaluate(limit_expr, function (limit) {
								if (fatal_error)
									return cb(false);
								if (Decimal.isDecimal(limit))
									limit = limit.toNumber();
								else if (typeof limit === 'string') {
									var f = string_utils.toNumber(limit);
									if (f === null)
										return setFatalError("not a number: " + limit, cb, false);
									limit = f;
								}
								else
									return setFatalError("bad type of limit: " + limit, cb, false);
								if (!ValidationUtils.isNonnegativeInteger(limit))
									return setFatalError("bad limit: " + limit, cb, false);
								cb(new wrappedObject(res.split(separator, limit)));
							});
						}
						else { // join
							if (!(res instanceof wrappedObject))
								return setFatalError("not an object in join: " + res, cb, false);
							var values = Array.isArray(res.obj) ? res.obj : Object.keys(res.obj).sort().map(key => res.obj[key]);
							if (!values.every(val => typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean'))
								return setFatalError("some elements to be joined are not scalars: " + values, cb, false);
							var str = values.join(separator);
							if (str.length > constants.MAX_AA_STRING_LENGTH)
								return setFatalError("the string after join would be too long: " + str, cb, false);
							cb(str);
						}
					});
				});
				break;
			
			case 'is_valid_address':
			case 'is_aa':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					var bValid = ValidationUtils.isValidAddress(res);
					if (!bValid || op === 'is_valid_address')
						return cb(bValid);
					conn.query("SELECT 1 FROM aa_addresses WHERE address=? AND mci<=?", [res, mci], function (rows) {
						cb(rows.length > 0);
					});
				});
				break;

			case 'is_integer':
			case 'is_valid_amount':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (!Decimal.isDecimal(res))
						return cb(false);
					if (!res.isInteger())
						return cb(false);
					if (op === 'is_valid_amount' && (!res.isPositive() || res.gt(constants.MAX_CAP)))
						return cb(false);
					cb(true);
				});
				break;

			case 'exists':
			case 'is_array':
			case 'is_assoc':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (op === 'exists')
						return cb(res !== false);
					if (!(res instanceof wrappedObject))
						return cb(false);
					var obj = res.obj;
					if (typeof obj !== 'object')
						return cb(false);
					var bArray = Array.isArray(obj);
					cb(op === 'is_array' ? bArray : !bArray);
				});
				break;

			case 'array_length':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (!(res instanceof wrappedObject) || !Array.isArray(res.obj))
						return setFatalError("not an array: " + res, cb, false);
					cb(new Decimal(res.obj.length));
				});
				break;

			case 'keys':
			case 'reverse':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (!(res instanceof wrappedObject))
						return setFatalError("not an object: " + res, cb, false);
					var bArray = Array.isArray(res.obj);
					if (op === 'keys') {
						if (bArray)
							return setFatalError("not an object but an array: " + res.obj, cb, false);
						cb(new wrappedObject(Object.keys(res.obj).sort()));
					}
					else {
						if (!bArray)
							return setFatalError("not an array: " + res.obj, cb, false);
						cb(new wrappedObject(_.cloneDeep(res.obj).reverse()));
					}
				});
				break;

			case 'freeze':
				var var_name_expr = arr[1];
				evaluate(var_name_expr, function (var_name) {
					if (fatal_error)
						return cb(false);
					if (!hasOwnProperty(locals, var_name))
						return setFatalError("no such variable: " + var_name, cb, false);
					if (locals[var_name] instanceof Func)
						return setFatalError("functions cannot be frozen: " + var_name, cb, false);
					if (locals[var_name] instanceof wrappedObject)
						locals[var_name].frozen = true;
					else
						console.log("skipping freeze of a scalar: " + var_name);
					cb(true);
				});
				break;

			case 'delete':
				var var_name_expr = arr[1];
				var selectors = arr[2];
				var key_expr = arr[3];
				evaluate(var_name_expr, function (var_name) {
					if (fatal_error)
						return cb(false);
					if (!hasOwnProperty(locals, var_name))
						return setFatalError("no such variable: " + var_name, cb, false);
					if (!(locals[var_name] instanceof wrappedObject))
						return setFatalError("trying to delete a key from a non-object", cb, false);
					if (locals[var_name].frozen)
						return setFatalError("variable " + var_name + " is frozen", cb, false);
					selectSubobject(locals[var_name], selectors, function (res) {
						if (!(res instanceof wrappedObject))
							return setFatalError("trying to delete a key from a subobject which is not an object", cb, false);
						evaluate(key_expr, function (key) {
							if (fatal_error)
								return cb(false);
							if (!isValidValue(key) || typeof key === 'boolean')
								return setFatalError("bad key to delete: " + key, cb, false);
							if (Array.isArray(res.obj)) {
								if (Decimal.isDecimal(key))
									key = key.toNumber();
								else { // string
									var f = string_utils.toNumber(key);
									if (f === null)
										return setFatalError("key to be deleted is not a number: " + key, cb, false);
									key = f;
								}
								if (!ValidationUtils.isNonnegativeInteger(key))
									return setFatalError("key to be deleted must be nonnegative integer: " + key, cb, false);
								res.obj.splice(key, 1); // does nothing if the key is out of range
							}
							else
								delete res.obj[key.toString()]; // does nothing if the key doesn't exist
							cb(true);
						});
					});
				});
				break;

			case 'foreach':
			case 'map':
			case 'filter':
			case 'reduce':
				var expr = arr[1];
				var count_expr = arr[2];
				var func_expr = arr[3];
				var initial_value_expr = arr[4];
				var bReduce = (op === 'reduce');
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (!(res instanceof wrappedObject))
						return setFatalError("scalar in foreach: " + res, cb, false);
					evaluate(count_expr, function (count) {
						if (fatal_error)
							return cb(false);
						if (!Decimal.isDecimal(count))
							return setFatalError("count is not a number: " + count, cb, false);
						count = count.toNumber();
						if (!ValidationUtils.isNonnegativeInteger(count))
							return setFatalError("count is not nonnegative integer: " + count, cb, false);
						evaluateFunctionExpression(func_expr, funcInfo => {
							if (fatal_error)
								return cb(false);
							var bArray = Array.isArray(res.obj);
							var arrElements = bArray ? res.obj : Object.keys(res.obj).sort();
							if (arrElements.length > count)
								return setFatalError("found " + arrElements.length + " elements in object, only up to " + count + " allowed", cb, false);
							evaluate(bReduce ? initial_value_expr : "", initial_value => {
								if (fatal_error)
									return cb(false);
								var retValue = bArray ? [] : {};
								var accumulator = initial_value;
								async.eachOfSeries(
									arrElements,
									function (element, index, cb2) {
										function getArgs(count_args) {
											var args = [];
											if (bReduce) {
												args.push(accumulator);
												count_args--; // remaining args
											}
											if (bArray) {
												var key = new Decimal(index);
												var value = toOscriptType(element);
											}
											else {
												var key = element;
												var value = toOscriptType(res.obj[element]);
											}
											if (count_args === 1)
												args.push(value);
											else
												args.push(key, value);
											return args;
										}
										var caller;
										if (funcInfo.local) {
											var func = funcInfo.local;
											var args = getArgs(func.args.length);
											caller = function (res_cb) {
												callFunction(func, args, res_cb);
											};
										}
										else if (funcInfo.remote) {
											var fargs = (func) => getArgs(func.args.length);
											caller = function (res_cb) {
												callGetter(conn, funcInfo.remote.remote_aa, funcInfo.remote.func_name, fargs, stateVars, objValidationState, (err, r) => {
													if (err)
														return setFatalError(err, res_cb, false);
													res_cb(r);
												});
											};
										}
										else
											throw Error("neither local nor remote: " + funcInfo);
										caller(r => {
											if (op === 'map') {
												r = toJsType(r);
												if (bArray)
													retValue.push(r);
												else
													assignField(retValue, element, r);
											}
											else if (op === 'filter') {
												r = toJsType(r);
												if (r) { // truthy
													if (bArray)
														retValue.push(_.cloneDeep(element));
													else
														assignField(retValue, element, _.cloneDeep(res.obj[element]));
												}
											}
											else if (bReduce)
												accumulator = r;
											cb2(fatal_error);
										});
									},
									function (err) {
										if (fatal_error)
											return cb(false);
										if (bReduce)
											cb(accumulator);
										else if (op === 'map' || op === 'filter')
											cb(new wrappedObject(retValue));
										else
											cb(true);
									}
								);
							});
						});
					});
				});
				break;
					
			case 'timestamp_to_string':
				var ts_expr = arr[1];
				var format_expr = arr[2] || 'datetime';
				evaluate(ts_expr, function (ts) {
					if (fatal_error)
						return cb(false);
					if (!Decimal.isDecimal(ts))
						return setFatalError('timestamp in timestamp_to_string must be a number', cb, false);
					ts = ts.toNumber();
					evaluate(format_expr, function (format) {
						if (fatal_error)
							return cb(false);
						if (format !== 'date' && format !== 'datetime' && format !== 'time')
							return setFatalError("format in timestamp_to_string must be date or time or datetime", cb, false);
						var str = new Date(ts * 1000).toISOString().replace('.000', '');
						if (format === 'date')
							str = str.substr(0, 10);
						else if (format === 'time')
							str = str.substr(11, 8);
						cb(str);
					});
				});
				break;

			case 'parse_date':
				var date_expr = arr[1];
				evaluate(date_expr, function (date) {
					if (fatal_error)
						return cb(false);
					if (typeof date !== 'string')
						return cb(false);
					var ts;
					if (date.match(/^\d\d\d\d-\d\d-\d\d$/))
						ts = Date.parse(date);
					else if (date.match(/^\d\d\d\d-\d\d-\d\d( |T)\d\d:\d\d:\d\dZ$/))
						ts = Date.parse(date);
					else if (date.match(/^\d\d\d\d-\d\d-\d\d( |T)\d\d:\d\d:\d\d$/))
						ts = Date.parse(date + 'Z');
					if (ts === undefined || isNaN(ts))
						return cb(false);
					if (ts % 1000)
						throw Error("non-integer seconds");
					cb(new Decimal(ts / 1000));
				});
				break;

			case 'typeof':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject)
						return cb('object');
					if (typeof res === 'boolean')
						return cb('boolean');
					if (Decimal.isDecimal(res))
						return cb('number');
					if (typeof res === 'string')
						return cb('string');
					setFatalError("unknown type of " + res, cb, false);
				});
				break;

			case 'response_unit':
				if (!bAA || !bStateVarAssignmentAllowed)
					return setFatalError("response_unit outside state update formula", cb, false);
				if (!objResponseUnit)
					return cb(false);
				cb(objResponseUnit.unit);
				break;

			case 'func_call':
				var func_name = arr[1];
				var arrExpressions = arr[2];
				var func = locals[func_name];
				if (!func)
					throw Error("no such function: " + func_name);
				if (!(func instanceof Func))
					throw Error("not a function: " + func_name);
				var args = [];
				async.eachSeries(
					arrExpressions,
					function (expr, cb2) {
						evaluate(expr, function (res) {
							if (fatal_error)
								return cb2(fatal_error);
							if (!isValidValue(res) && !(res instanceof wrappedObject))
								return setFatalError("bad value of function argument: " + res, cb2);
							args.push(res);
							cb2();
						});
					},
					function (err) {
						if (fatal_error)
							return cb(false);
						if (err)
							return setFatalError("arguments failed: " + err, cb, false);
						callFunction(func, args, cb);
					}
				);
				break;

			case 'remote_func_call':
				var remote_aa_expr = arr[1];
				var max_remote_complexity = arr[2];
				var func_name = arr[3];
				var arrExpressions = arr[4];
				var args = [];
				async.eachSeries(
					arrExpressions,
					function (expr, cb2) {
						evaluate(expr, function (res) {
							if (fatal_error)
								return cb2(fatal_error);
							if (!isValidValue(res) && !(res instanceof wrappedObject))
								return setFatalError("bad value of function argument: " + res, cb2);
							args.push(res);
							cb2();
						});
					},
					function (err) {
						if (fatal_error)
							return cb(false);
						evaluate(remote_aa_expr, function (remote_aa) {
							if (fatal_error)
								return setFatalError(fatal_error, cb, false);
							if (!ValidationUtils.isValidAddress(remote_aa))
								return setFatalError("not valid remote AA: " + remote_aa, cb, false);
							checkMaxRemoteComplexity(remote_aa, func_name, max_remote_complexity, (err) => {
								if (fatal_error)
									return cb(false);
								if (err)
									return setFatalError(err, cb, false);
								callGetter(conn, remote_aa, func_name, args, stateVars, objValidationState, (err, res) => {
									if (err)
										return setFatalError(err, cb, false);
									cb(res);
								});
							});
						});
					}
				);
				break;

			case 'with_selectors':
				var expr = arr[1];
				var arrKeys = arr[2];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (!isValidValue(res) && !(res instanceof wrappedObject))
						return setFatalError("bad value for with_selectors: " + JSON.stringify(res), cb, false);
					selectSubobject(res, arrKeys, cb);
				});
				break;
	
			case 'log':
				var entries = [];
				async.eachSeries(
					arr[1],
					function (expr, cb2) {
						evaluate(expr, res => {
							if (fatal_error)
								return cb2(fatal_error);
							entries.push(res);
							cb2();
						});
					},
					function (err) {
						if (fatal_error)
							return cb(false);
						console.log('log', entries);
						logs.push(_.cloneDeep(entries));
						cb(true);
					}
				);
				break;

			case 'bounce':
				var error_description = arr[1];
				evaluate(error_description, function (evaluated_error_description) {
					if (fatal_error)
						return cb(false);
					console.log('bounce called: ', evaluated_error_description);
					setFatalError({ bounce_message: evaluated_error_description }, cb, false);
				});
				break;

			case 'require':
				var req_expr = arr[1];
				var error_description = arr[2];
				evaluate(req_expr, evaluated_req => {
					if (fatal_error)
						return cb(false);
					if (evaluated_req instanceof wrappedObject)
						evaluated_req = true;
					if (!isValidValue(evaluated_req))
						return setFatalError("bad value in require: " + evaluated_req, cb, false);
					if (Decimal.isDecimal(evaluated_req) && evaluated_req.toNumber() === 0)
						evaluated_req = 0;
					if (evaluated_req)
						return cb(true);
					evaluate(error_description, function (evaluated_error_description) {
						if (fatal_error)
							return cb(false);
						console.log('require not met:', evaluated_error_description);
						setFatalError({ bounce_message: evaluated_error_description }, cb, false);
					});
				});
				break;

			case 'return':
				var expr = arr[1];
				if (expr === null) { // empty return
					// already checked during validation
				//	if (!bStatementsOnly)
				//		return setFatalError("empty early return", cb, false);
					early_return = true;
					return cb(true);
				}
			//	if (bStatementsOnly)
			//		return setFatalError("non-empty early return", cb, false);
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					console.log('early return with: ', res);
					if (mci < constants.aa2UpgradeMci && res instanceof wrappedObject)
						res = true;
					if (Decimal.isDecimal(res))
						res = toDoubleRange(res);
					early_return = res;
					cb(true);
				});
				break;

			case 'main':
				var arrStatements = arr[1];
				var expr = arr[2];
				if (bTopLevel) {
					if (bStatementsOnly && expr)
						return setFatalError("expected statements only", cb, false);
					if (!bStatementsOnly && !expr)
						return setFatalError("return value missing", cb, false);
				}
				async.eachSeries(
					arrStatements,
					function (statement, cb2) {
						evaluate(statement, function (res) {
							if (fatal_error)
								return cb2(fatal_error);
						//	if (res !== true)
						//		return setFatalError("statement " + statement + " failed", cb2);
							cb2();
						});
					},
					function (err) {
						if (fatal_error)
							return cb(false);
						if (err)
							return setFatalError("statements failed: " + err, cb, false);
					//	console.log('--- expr', expr)
						expr ? evaluate(expr, cb) : cb(true);
					}
				);
				break;

			default:
				throw Error('unrecognized op '+op);
		}

	}

	function concat(operand0, operand1) {
		if (mci < constants.aa2UpgradeMci) {
			if (operand0 instanceof wrappedObject)
				operand0 = true;
			if (operand1 instanceof wrappedObject)
				operand1 = true;
		}
		var result;
		if (operand0 instanceof wrappedObject && operand1 instanceof wrappedObject) {
			var obj0 = operand0.obj;
			var obj1 = operand1.obj;
			var bArray0 = Array.isArray(obj0);
			var bArray1 = Array.isArray(obj1);
			if (bArray0 && bArray1)
				result = new wrappedObject(obj0.concat(obj1));
			else if (!bArray0 && !bArray1)
				result = new wrappedObject(Object.assign({}, obj0, obj1));
			else
				return { error: "trying to concat an object and array: " + obj0 + " and " + obj1 };
		}
		else { // one of operands is a string, then treat both as strings
			if (operand0 instanceof wrappedObject)
				operand0 = true;
			if (operand1 instanceof wrappedObject)
				operand1 = true;
			result = operand0.toString() + operand1.toString();
			if (result.length > constants.MAX_AA_STRING_LENGTH)
				return { error: "string too long after concat: " + result };
		}
		return { result };
	}

	function readVar(param_address, var_name, cb2) {
		if (!stateVars[param_address])
			stateVars[param_address] = {};
		if (hasOwnProperty(stateVars[param_address], var_name)) {
		//	console.log('using cache for var '+var_name);
			return cb2(stateVars[param_address][var_name].value);
		}
		storage.readAAStateVar(param_address, var_name, function (value) {
		//	console.log(var_name+'='+(typeof value === 'object' ? JSON.stringify(value) : value));
			if (value === undefined) {
				assignField(stateVars[param_address], var_name, { value: false });
				return cb2(false);
			}
			if (bLimitedPrecision) {
				value = value.toString();
				var f = string_utils.toNumber(value, bLimitedPrecision);
				if (f !== null)
					value = createDecimal(value);
			}
			else {
				if (typeof value === 'number')
					value = createDecimal(value);
				else if (typeof value === 'object')
					value = new wrappedObject(value);
			}
			assignField(stateVars[param_address], var_name, { value: value, old_value: value, original_old_value: value });
			cb2(value);
		});
	}

	function evaluateSelectorKeys(arrKeys, cb) {
		var arrEvaluatedKeys = []; // strings or numbers
		async.eachSeries(
			arrKeys || [],
			function (key, cb2) {
				if (key === null) {
					arrEvaluatedKeys.push(null);
					return cb2();
				}
				evaluate(key, function (evaluated_key) {
					if (fatal_error)
						return cb2(fatal_error);
					if (Decimal.isDecimal(evaluated_key)) {
						evaluated_key = evaluated_key.toNumber();
						if (!ValidationUtils.isNonnegativeInteger(evaluated_key))
							return setFatalError("bad selector key: " + evaluated_key, cb2);
					}
					else if (typeof evaluated_key !== 'string')
						return setFatalError("result of " + key + " is not a string or number: " + evaluated_key, cb2);
					arrEvaluatedKeys.push(evaluated_key);
					cb2();
				});
			},
			function (err) {
				if (fatal_error)
					return cb(false);
				cb(arrEvaluatedKeys);
			}
		);
	}

	function assignByPath(obj, arrKeys, value) {
		if (typeof obj !== 'object')
			throw Error("not an object: " + obj);
		var pointer = obj;
		for (var i = 0; i < arrKeys.length - 1; i++){
			var key = arrKeys[i];
			if (key === null) { // special value to indicate the next element of an array
				if (!Array.isArray(pointer))
					throw Error("not an array: " + pointer);
				key = pointer.length;
			}
			if (pointer[key] === undefined || pointer[key] === null) {
				if (typeof key === 'number' && key > 0 && (pointer[key - 1] === undefined || pointer[key - 1] === null))
					throw Error("previous key value " + (key - 1) + " not set");
				var next_key = arrKeys[i + 1];
				assignField(pointer, key, (typeof next_key === 'number' || next_key === null) ? [] : {});
			}
			else if (typeof pointer[key] !== 'object')
				throw Error("scalar " + pointer[key] + " treated as object");
			pointer = pointer[key];
		}

		var last_key = arrKeys[arrKeys.length - 1];
		if (last_key === null) { // special value to indicate the next element of an array
			if (!Array.isArray(pointer))
				throw Error("not an array: " + pointer);
			last_key = pointer.length;
		}
		if (typeof last_key === 'number' && last_key > 0 && (pointer[last_key - 1] === undefined || pointer[last_key - 1] === null))
			throw Error("previous key value " + (last_key - 1) + " not set");
		
		assignField(pointer, last_key, value);
	}

	function selectSubobject(value, arrKeys, cb) {
		if (value instanceof wrappedObject)
			value = value.obj;
		async.eachSeries(
			arrKeys || [],
			function (key, cb2) {
				if (typeof value !== 'object')
					return cb2('not an object while trying to access key ' + key);
				if (ValidationUtils.isArrayOfLength(key, 2) && key[0] === 'search_param_list') {
					var arrPairs = key[1];
					filterBySearchCriteria(value, arrPairs, function (err, filtered_array) {
						if (fatal_error)
							return cb2(fatal_error);
						if (err)
							return cb2(err);
						value = filtered_array;
						cb2();
					});
					return;
				}
				evaluate(key, function (evaluated_key) {
					if (fatal_error)
						return cb2(fatal_error);
					if (Decimal.isDecimal(evaluated_key)) {
						evaluated_key = evaluated_key.toNumber();
						if (!ValidationUtils.isNonnegativeInteger(evaluated_key))
							return setFatalError("bad selector key: " + evaluated_key, cb2);
					}
					else if (typeof evaluated_key !== 'string')
						return setFatalError("result of " + key + " is not a string or number: " + evaluated_key, cb2);
					if (typeof evaluated_key === 'string')
						value = unwrapOneElementArrays(value);
					if (!hasOwnProperty(value, evaluated_key))
						return cb2("no such key in data");
					value = value[evaluated_key];
					cb2();
				});
			},
			function (err) {
				if (err || fatal_error)
					return cb(false);
				if (typeof value === 'boolean')
					cb(value);
				else if (typeof value === 'number')
					cb(createDecimal(value));
				else if (Decimal.isDecimal(value)) {
					if (!isFiniteDecimal(value))
						return setFatalError("bad decimal " + value, cb, false);
					cb(toDoubleRange(value.times(1)));
				}
				else if (typeof value === 'string') {
					if (value.length > constants.MAX_AA_STRING_LENGTH)
						return setFatalError("string value too long: " + value, cb, false);
					// convert to number if possible
					var f = string_utils.toNumber(value, bLimitedPrecision);
					(f === null) ? cb(value) : cb(createDecimal(value));
				}
				else if (typeof value === 'object')
					cb(new wrappedObject(value));
				else
					throw Error("unknown type of subobject: " + value);
			}
		);
	}

	function filterBySearchCriteria(array, arrPairs, handleResult) {
		if (!ValidationUtils.isNonemptyArray(arrPairs))
			throw Error('search params is not an array');
		if (!ValidationUtils.isNonemptyArray(array))
			return handleResult('not an array, search criteria cannot be applied');
		var arrSearchCriteria = [];
		async.eachSeries(
			arrPairs,
			function (pair, cb3) {
				var fields = pair[0]; // array of keys key1.key2.key3
				var comp = pair[1]; // comparison operator
				var search_value_expr = pair[2];
				if (search_value_expr.value === 'none') {
					arrSearchCriteria.push({ fields, comp, search_value: null });
					return cb3();
				}
				evaluate(search_value_expr, function (search_value) {
					if (fatal_error)
						return cb3(fatal_error);
					if (Decimal.isDecimal(search_value))
						search_value = search_value.toNumber();
					arrSearchCriteria.push({ fields, comp, search_value });
					cb3();
				});
			},
			function () {
				if (fatal_error)
					return handleResult(fatal_error);
				var filtered_array = array.filter(elem => {
					return arrSearchCriteria.every(search_criterion => {
						var val = elem;
						var fields = search_criterion.fields;
						var comp = search_criterion.comp;
						var search_value = search_criterion.search_value;
						for (var i = 0; i < fields.length; i++) {
							if (typeof val !== 'object')
								return (search_value === null ? comp === '=' : comp === '!=');
							val = hasOwnProperty(val, fields[i]) ? val[fields[i]] : undefined;
						}
						if (search_value === null)
							return (comp === '=' ? val === undefined : val !== undefined);
						if (typeof val === 'string' && typeof search_value === 'number') {
							var f = string_utils.toNumber(val, bLimitedPrecision);
							if (f !== null)
								val = f;
						}
						if (typeof val !== typeof search_value)
							return (comp === '!=');
						switch (comp) {
							case '=': return (val === search_value);
							case '!=': return (val !== search_value);
							case '>': return (val > search_value);
							case '>=': return (val >= search_value);
							case '<': return (val < search_value);
							case '<=': return (val <= search_value);
							default: throw Error("unknown comparison: " + comp);
						}
					});
				});
				if (filtered_array.length === 0)
					return handleResult('empty array after filtering');
				handleResult(null, filtered_array);
			}
		);
	}

	function callFunction(func, args, cb) {
		if (early_return !== undefined)
			throw Error("function called after a return");
		var func_locals = {};
		// set a subset of locals that were present in the declaration scope
		func.scopeVarNames.forEach(name => {
			assignField(func_locals, name, locals[name]);
		});
		// set the arguments as locals too
		for (var i = 0; i < func.args.length; i++){
			var arg_name = func.args[i];
			var value = args[i];
			if (value === undefined) // no argument passed
				value = false;
			if (func_locals[arg_name] !== undefined)
				throw Error("argument " + arg_name + " would shadow a local var");
			assignField(func_locals, arg_name, toOscriptType(value));
		}
		var saved_locals = _.clone(locals);
		assignObject(locals, func_locals);
		// bStateVarAssignmentAllowed is inherited, bStatementsOnly is ignored in functions
		evaluate(func.body, res => {
			if (early_return !== undefined)
				res = early_return;
			// restore
			assignObject(locals, saved_locals);
			early_return = undefined;

			if (fatal_error)
				return cb(false);
			if (!isValidValue(res) && !(res instanceof wrappedObject))
				return setFatalError("bad value returned from func", cb, false);
			cb(res);
		});
	}

	function evaluateFunctionExpression(func_expr, cb) {
		if (func_expr[0] === 'func_declaration') { // anonymous function
			var args = func_expr[1];
			var body = func_expr[2];
			var scopeVarNames = Object.keys(locals);
			if (_.intersection(args, scopeVarNames).length > 0)
				return setFatalError("some args of anonymous function would shadow some local vars", cb, false);
			cb({ local: new Func(args, body, scopeVarNames) });
		}
		else if (func_expr[0] === 'local_var') {
			var var_name = func_expr[1];
			var func = locals[var_name];
			if (!(func instanceof Func))
				return setFatalError("not a func: " + var_name, cb, false);
			cb({ local: func });
		}
		else if (func_expr[0] === 'remote_func') {
			var remote_aa_expr = func_expr[1];
			var max_remote_complexity = func_expr[2];
			var func_name = func_expr[3];
			evaluate(remote_aa_expr, remote_aa => {
				if (fatal_error)
					return cb(false);
				checkMaxRemoteComplexity(remote_aa, func_name, max_remote_complexity, (err) => {
					if (fatal_error)
						return cb(false);
					if (err)
						return setFatalError(err, cb, false);
					cb({ remote: { remote_aa, func_name } });
				});
			});
		}
		else
			throw Error("unrecognized function argument: " + func_expr);

	}

	function checkMaxRemoteComplexity(remote_aa, func_name, max_remote_complexity, cb) {
		if (max_remote_complexity === null)
			return cb();
		evaluate(max_remote_complexity, max_remote_complexity => {
			if (fatal_error)
				return cb(fatal_error);
			if (typeof max_remote_complexity === 'string') {
				storage.readAADefinition(conn, remote_aa, arrDefinition => {
					if (!arrDefinition)
						return cb("no such remote AA: " + remote_aa);
					const base_aa = arrDefinition[1].base_aa;
					if (max_remote_complexity !== base_aa)
						return cb(max_remote_complexity + " is not base AA for remote AA " + remote_aa);
					cb();
				});
			}
			else if (Decimal.isDecimal(max_remote_complexity)) {
				max_remote_complexity = max_remote_complexity.toNumber();
				storage.readAAGetterProps(conn, remote_aa, func_name, props => {
					if (!props)
						return cb("no such getter: " + remote_aa + "." + func_name);
					if (typeof props.complexity !== 'number')
						throw Error("bad complexity of " + remote_aa + "." + func_name + ": " + props.complexity);
					if (props.complexity > max_remote_complexity)
						return cb("getter " + remote_aa + "." + func_name + " has complexity " + props.complexity + " while called with max remote complexity " + max_remote_complexity);
					cb();
				});
			}
			else
				throw Error("unknown type of max_remote_complexity: " + max_remote_complexity);
		});
	}

	function readAssetInfoPossiblyDefinedByAA(asset, handleAssetInfo) {
		storage.readAssetInfo(conn, asset, function (objAsset) {
			if (!objAsset)
				return handleAssetInfo(null);
			if (objAsset.main_chain_index !== null && objAsset.main_chain_index <= mci)
				return handleAssetInfo(objAsset);
			if (!bAA) // we are not an AA and can't see assets defined by fresh AAs
				return handleAssetInfo(null);
			// defined later than last ball, check if defined by AA
			storage.readAADefinition(conn, objAsset.definer_address, function(arrDefinition) {
				if (arrDefinition)
					return handleAssetInfo(objAsset);
				handleAssetInfo(null); // defined later by non-AA
			});
		});
	}

	function unwrapOneElementArrays(value) {
		return ValidationUtils.isArrayOfLength(value, 1) ? unwrapOneElementArrays(value[0]) : value;
	}

	function setFatalError(err, cb, cb_arg){
		fatal_error = err;
		console.log(err);
		(cb_arg !== undefined) ? cb(cb_arg) : cb(err);
	}


	if (parser.results && parser.results.length === 1 && parser.results[0]) {
		evaluate(parser.results[0], res => {
			if (fatal_error) {
				callback(fatal_error, null);
			} else {
				if (early_return !== undefined)
					res = early_return;
				if (res instanceof wrappedObject)
					res = bObjectResultAllowed ? res.obj : true;
				else if (Decimal.isDecimal(res)) {
					if (!isFiniteDecimal(res))
						return callback('result is not finite', null);
					res = toDoubleRange(res);
					res = (res.isInteger() && res.abs().lt(Number.MAX_SAFE_INTEGER)) ? res.toNumber() : res.toString();
				}
				else if (typeof res === 'string' && res.length > constants.MAX_AA_STRING_LENGTH)
					return callback('result string is too long', null);
				callback(null, res);
			}
		}, true);
	} else {
		if (parser.results.length > 1) {
			console.log('ambiguous grammar', parser.results);
			callback('ambiguous grammar', null);
		}
	}
};


function toOscriptType(x) {
	if (typeof x === 'string' || typeof x === 'boolean' || x instanceof wrappedObject)
		return x;
	if (typeof x === 'number')
		return createDecimal(x);
	if (Decimal.isDecimal(x))
		return toDoubleRange(x);
	if (typeof x === 'object')
		return new wrappedObject(x);
	throw Error("unknown type in toOscriptType:" + x);
}

function toJsType(x) {
	if (x instanceof wrappedObject)
		return x.obj;
	if (Decimal.isDecimal(x))
		return x.toNumber();
	if (typeof x === 'string' || typeof x === 'boolean' || typeof x === 'number' || typeof x === 'object')
		return x;
	throw Error("unknown type in toJsType:" + x);
}

function assoc2stateVars(assoc) {
	var stateVars = {};
	for (var var_name in assoc) {
		var value = toOscriptType(assoc[var_name]);
		stateVars[var_name] = {
			value: value,
			old_value: value,
			original_old_value: value,
		};
	}
	return stateVars;
}

function stateVars2assoc(stateVars) {
	var assoc = {};
	for (var var_name in stateVars)
		assoc[var_name] = toJsType(stateVars[var_name].value);
	return assoc;
}

function callGetter(conn, aa_address, getter, args, stateVars, objValidationState, cb) {
	var i = 0;
	var locals = {};
	function getNextArgName() {
		i++;
		while (locals['arg' + i])
			i++;
		return 'arg' + i;
	}
	// no need to cloneDeep, we need to rewrite only storage size, assocBalances cache can be updated by reference
	objValidationState = _.clone(objValidationState);
	storage.readBaseAADefinitionAndParams(conn, aa_address, function (arrBaseDefinition, params, storage_size) {
		if (!arrBaseDefinition)
			return cb("remote AA not found: " + aa_address);
		// rewrite storage size with the storage size of the AA being called
		objValidationState.storage_size = storage_size;
		var f = getFormula(arrBaseDefinition[1].getters);
		var opts = {
			conn: conn,
			formula: f,
			trigger: null,
			params: params,
			locals: locals,
			stateVars: stateVars,
			responseVars: null,
			bStatementsOnly: true,
			objValidationState: objValidationState,
			address: aa_address
		};
		exports.evaluate(opts, function (err, res) {
			if (res === null)
				return cb(err.bounce_message || "formula " + f + " failed: " + err);
			if (!locals[getter])
				return cb("no such getter: " + getter);
			if (!(locals[getter] instanceof Func))
				return cb(getter + " is not a function");
			if (typeof args === 'function') // callback function passed instead of args
				args = args(locals[getter]);
			if (!Array.isArray(args))
				throw Error("args is not an array");
			var argNames = [];
			args.forEach(arg => {
				var arg_name = getNextArgName();
				argNames.push('$' + arg_name);
				assignField(locals, arg_name, toOscriptType(arg));
			});
			var call_formula = '$' + getter + '(' + argNames.join(', ') + ')';
			var call_opts = {
				conn: conn,
				formula: call_formula,
				trigger: null,
				params: params,
				locals: locals,
				stateVars: stateVars,
				responseVars: null,
				bObjectResultAllowed: true,
				objValidationState: objValidationState,
				address: aa_address
			};
			exports.evaluate(call_opts, function (err, res) {
				if (res === null)
					return cb(err.bounce_message || "formula " + call_formula + " failed: " + err);
				// fractional and large numbers are returned as strings, attempt to convert back
				if (typeof res === 'string') {
					var f = string_utils.toNumber(res);
					if (f !== null)
						res = f;
				}
				cb(null, toOscriptType(res));
			});	
		});
	});
}

function executeGetterInState(conn, aa_address, getter, args, stateVars, assocBalances, cb) {
	if (!cb)
		return new Promise((resolve, reject) => {
			executeGetterInState(conn, aa_address, getter, args, stateVars, assocBalances, (err, res) => {
				err ? reject(new Error(err)) : resolve(res);
			});
		});
	conn.query("SELECT * FROM units ORDER BY main_chain_index DESC LIMIT 1", rows => {
		var props = rows[0];
		if (!props) {
			if (!conf.bLight)
				throw Error("no last unit");
			props = {
				main_chain_index: 1e9,
				unit: 'dummyforgetter',
			};
		}
		objValidationState = {
			last_ball_mci: props.main_chain_index,
			last_ball_timestamp: Math.round(Date.now() / 1000),
			mc_unit: props.unit, // must not be used
			assocBalances: assocBalances,
			number_of_responses: 0, // must not be used
			arrPreviousAAResponses: [],
		};
		args = args.map(toOscriptType);
		callGetter(conn, aa_address, getter, args, stateVars, objValidationState, (err, res) => {
			if (err)
				return cb(err);
			cb(null, toJsType(res));
		});
	});
}

function executeGetter(conn, aa_address, getter, args, cb) {
	return executeGetterInState(conn, aa_address, getter, args, {}, {}, cb);
}


exports.wrappedObject = wrappedObject;
exports.toJsType = toJsType;
exports.toOscriptType = toOscriptType;
exports.assoc2stateVars = assoc2stateVars;
exports.stateVars2assoc = stateVars2assoc;
exports.executeGetterInState = executeGetterInState;
exports.executeGetter = executeGetter;
