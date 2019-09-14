var nearley = require("nearley");
var grammar = require("./grammars/oscript.js");
var async = require('async');
var crypto = require('crypto');
var _ = require('lodash');
var ValidationUtils = require("../validation_utils.js");
var string_utils = require("../string_utils.js");
var constants = require('../constants');
var dataFeeds = require('../data_feeds.js');
var storage = require('../storage.js');
var kvstore = require('../kvstore.js');
var signed_message = require("../signed_message.js"); // which requires definition.js - cyclic dependency :(
var signature = require('../signature.js');

var cache = require('./common.js').cache;
var formulasInCache = require('./common.js').formulasInCache;
var cacheLimit = require('./common.js').cacheLimit;

var Decimal = require('./common.js').Decimal;
var objBaseAssetInfo = require('./common.js').objBaseAssetInfo;

var isFiniteDecimal = require('./common.js').isFiniteDecimal;
var toDoubleRange = require('./common.js').toDoubleRange;

if (!Number.MAX_SAFE_INTEGER)
	Number.MAX_SAFE_INTEGER = Math.pow(2, 53) - 1; // 9007199254740991

var decimalE = new Decimal(Math.E);
var decimalPi = new Decimal(Math.PI);

function isValidValue(val){
	return (typeof val === 'string' || typeof val === 'boolean' || isFiniteDecimal(val));
}

function wrappedObject(obj){
	this.obj = obj;
}

exports.evaluate = function (opts, callback) {
	var conn = opts.conn;
	var formula = opts.formula;
	var messages = opts.messages || [];
	var trigger = opts.trigger || {};
	var locals = opts.locals || {};
	var stateVars = opts.stateVars || {};
	var responseVars = opts.responseVars || {};
	var bStateVarAssignmentAllowed = opts.bStateVarAssignmentAllowed;
	var bStatementsOnly = opts.bStatementsOnly;
	var bObjectResultAllowed = opts.bObjectResultAllowed;
	var objValidationState = opts.objValidationState;
	var address = opts.address;
	var response_unit = opts.response_unit;

	if (!ValidationUtils.isPositiveInteger(objValidationState.last_ball_timestamp))
		throw Error('last_ball_timestamp is not a number: ' + objValidationState.last_ball_timestamp);

	var bAA = (messages.length === 0);
	if (!bAA && (bStatementsOnly || bStateVarAssignmentAllowed || bObjectResultAllowed))
		throw Error("bad opts for non-AA");

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

	function evaluate(arr, cb) {
		count++;
		if (count % 100 === 0) // avoid extra long call stacks to prevent Maximum call stack size exceeded
			return setImmediate(evaluate, arr, cb);
		if (fatal_error)
			return cb(false);
		if (early_return !== undefined)
			return cb(true);
		if (Decimal.isDecimal(arr)) {
			if (!arr.isFinite())
				setFatalError("bad decimal: " + arr, cb, false);
			if (!isFinite(arr.toNumber()))
				setFatalError("number overflow: " + arr, cb, false);
			return cb(toDoubleRange(arr));
		}
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
							res = new Decimal(res ? 1 : 0);
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
						res = new Decimal(res ? 1 : 0);
					if (isFiniteDecimal(res)) {
						res = toDoubleRange(res);
						if (op === 'abs')
							return cb(toDoubleRange(res.abs()));
						if (res.isNegative())
							return setFatalError(op + " of negative", cb, false);
						cb(toDoubleRange(op === 'sqrt' ? res.sqrt() : res.ln()));
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
					dp = new Decimal(0);
				evaluate(dp, function(dp_res){
					if (fatal_error)
						return cb(false);
					if (dp_res instanceof wrappedObject)
						dp_res = true;
					if (typeof dp_res === 'boolean')
						dp_res = new Decimal(dp_res ? 1 : 0);
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
							res = new Decimal(res ? 1 : 0);
						if (isFiniteDecimal(res)) {
							res = toDoubleRange(res);
							cb(res.toDecimalPlaces(dp.toNumber(), roundingMode));
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
							res = new Decimal(res ? 1 : 0);
						if (isFiniteDecimal(res)) {
							res = toDoubleRange(res);
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
					cb(Decimal[op].apply(Decimal, vals));
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
				var arrAddresses = params.oracles.value.split(':').map(function(addr){
					return (addr === 'this address') ? address : addr;
				});
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
				dataFeeds.readDataFeedValue(arrAddresses, feed_name, value, min_mci, objValidationState.last_ball_mci, bAA, ifseveral, function(objResult){
				//	console.log(arrAddresses, feed_name, value, min_mci, ifseveral);
				//	console.log('---- objResult', objResult);
					if (objResult.bAbortedBecauseOfSeveral)
						return cb("several values found");
					if (objResult.value !== undefined){
						if (what === 'unit')
							return cb(null, objResult.unit);
						if (type === 'string')
							return cb(null, objResult.value.toString());
						return cb(null, (typeof objResult.value === 'string') ? objResult.value : new Decimal(objResult.value).times(1));
					}
					if (params.ifnone && params.ifnone.value !== 'abort'){
					//	console.log('===== ifnone=', params.ifnone.value, typeof params.ifnone.value);
						return cb(null, params.ifnone.value); // the type of ifnone (string, decimal, boolean) is preserved
					}
					cb("data feed " + feed_name + " not found");
				});
				/*
				var ifseveral = 'ORDER BY main_chain_index DESC';
				var abortIfSeveral = false;
				if (params.ifseveral) {
					if (params.ifseveral.value === 'first') {
						ifseveral = 'ORDER BY main_chain_index ASC';
					} else if (params.ifseveral.value === 'abort') {
						ifseveral = '';
						abortIfSeveral = true;
					}
				}
				var ifnone = false;
				if (params.ifnone && params.ifnone.value !== 'abort') {
					ifnone = params.ifnone.value;
				}

				var value_condition = '';
				var queryParams = [arrAddresses, feed_name];
				if (value) {
					if (Decimal.isDecimal(value)) {
						var bForceNumericComparison = (['>', '>=', '<', '<='].indexOf(relation) >= 0);
						var plus_0 = bForceNumericComparison ? '+0' : '';
						value_condition = '(value' + plus_0 + relation + value.toString() +
							' OR int_value' + relation + value.toString() + ')';
					}
					else {
						value_condition = 'value' + relation + '?';
						queryParams.push(value);
					}
				}
				if (params.mci) {
					queryParams.push(objValidationState.last_ball_mci, min_mci);
				}
				conn.query(
					"SELECT value, int_value FROM data_feeds CROSS JOIN units USING(unit) CROSS JOIN unit_authors USING(unit) \n\
							WHERE address IN(?) AND feed_name=? " + (value_condition ? ' AND ' + value_condition : '') + " \n\
							AND " + (params.mci ? "main_chain_index<=? AND main_chain_index" + mci_relation + "? " : '') + " \n\
							AND sequence='good' AND is_stable=1 " + ifseveral + " LIMIT " + (abortIfSeveral ? "2" : "1"),
					queryParams,
					function (rows) {
						if (rows.length) {
							if (abortIfSeveral && rows.length > 1) {
								cb('abort');
							} else {
								if (rows[0].value === null) {
									cb(null, new Decimal(rows[0].int_value));
								} else {
									cb(null, rows[0].value);
								}
							}
						} else {
							if (ifnone === false) {
								cb('not found');
							} else {
								cb(null, ifnone);
							}
						}
					}
				);*/
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
						var arrAddresses = evaluated_params.oracles.value.split(':').map(function(addr){
							return (addr === 'this address') ? address : addr;
						});
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
						dataFeeds.dataFeedExists(arrAddresses, feed_name, relation, value, min_mci, objValidationState.last_ball_mci, bAA, cb);
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
					if (objParams.address.value === 'this address')
						objParams.address.value = address;

					if (objParams.address.value === 'other address') {
						objParams.address.value = address;
						if (objParams.address.operator === '=') {
							objParams.address.operator = '!=';
						} else {
							objParams.address.operator = '=';
						}
					}

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
							if (!ValidationUtils.isValidAddress(v) && v !== 'this address' && v !== 'other address')
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
						var arrAttestorAddresses = params.attestors.value.split(':').map(function(addr){
							return (addr === 'this address') ? address : addr;
						});
						if (!arrAttestorAddresses.every(ValidationUtils.isValidAddress)) // even if some addresses are ok
							return setFatalError('bad attestors', cb, false);

						var v = params.address.value;
						if (!ValidationUtils.isValidAddress(v) && v !== 'this address')
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
									var f = string_utils.getNumericFeedValue(value);
									if (f !== null)
										value = new Decimal(value).times(1);
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
								[params.address.value, objValidationState.last_ball_mci, (ifseveral === 'abort') ? 2 : 1],
								function (rows) {
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
										[params.address.value, objValidationState.last_ball_mci, (ifseveral === 'abort') ? 2 : 1],
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
				var result = '';
				async.eachSeries(arr.slice(1), function (param, cb2) {
					evaluate(param, function (res) {
						if (fatal_error)
							return cb2(fatal_error);
						if (res instanceof wrappedObject)
							res = true;
						if (isFiniteDecimal(res))
							result += toDoubleRange(res).toString();
						else if (typeof res === 'string')
							result += res;
						else if (typeof res === 'boolean')
							result += res.toString();
						else
							return setFatalError('unrecognized type in ' + op + ': ' + res, cb2);
						cb2();
					});
				}, function (err) {
					if (err)
						return cb(false);
					if (result.length > constants.MAX_AA_STRING_LENGTH)
						return setFatalError("string too long after concat: " + result, cb, false);
					cb(result);
				});
				break;

			case 'storage_size':
				cb(new Decimal(objValidationState.storage_size));
				break;

			case 'mci':
				cb(new Decimal(objValidationState.last_ball_mci));
				break;

			case 'timestamp':
				cb(new Decimal(objValidationState.last_ball_timestamp));
				break;

			case 'mc_unit':
				cb(objValidationState.mc_unit);
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

			case 'trigger.data':
				var arrKeys = arr[1];
			//	console.log('keys', arrKeys);
				var value = trigger.data;
				if (!value || Object.keys(value).length === 0)
					return cb(false);
				async.eachSeries(
					arrKeys, // can be 0-length array
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
							if (Decimal.isDecimal(evaluated_key))
								evaluated_key = evaluated_key.toNumber();
							else if (typeof evaluated_key !== 'string')
								return setFatalError("result of " + key + " is not a string or number: " + evaluated_key, cb2);
							if (typeof evaluated_key === 'string')
								value = unwrapOneElementArrays(value);
							value = value[evaluated_key];
							if (value === undefined)
								return cb2("no such key in data");
							cb2();
						});
					},
					function (err) {
						if (fatal_error || err)
							return cb(false);
					//	console.log('value', typeof value, value)
						if (typeof value === 'boolean')
							cb(value);
						else if (typeof value === 'number')
							cb(new Decimal(value).times(1));
						else if (typeof value === 'string') {
							if (value.length > constants.MAX_AA_STRING_LENGTH)
								return setFatalError("trigger.data field too long: " + value, cb, false);
							// convert to number if possible
							var f = string_utils.getNumericFeedValue(value);
							(f === null) ? cb(value) : cb(new Decimal(value).times(1));
						}
						else if (typeof value === 'object')
							cb(new wrappedObject(value));
						else
							throw Error("unknown type of trigger.data: " + value);
					}
				);
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

			case 'local_var':
				var var_name_or_expr = arr[1];
				var arrKeys = arr[2];
				evaluate(var_name_or_expr, function (var_name) {
				//	console.log('--- evaluated var name', var_name);
					if (fatal_error)
						return cb(false);
					if (typeof var_name !== 'string')
						return setFatalError("var name evaluated to " + var_name, cb, false);
					var value = locals[var_name];
					if (value === undefined)
						return cb(false);
					if (typeof value === 'number')
						value = new Decimal(value);
					if (!arrKeys)
						return cb(value);
					// from now on, selectors exist
					if (!(value instanceof wrappedObject)) // scalars have no keys
						return cb(false);
					value = value.obj; // unwrap
					async.eachSeries(
						arrKeys,
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
								if (Decimal.isDecimal(evaluated_key))
									evaluated_key = evaluated_key.toNumber();
								else if (typeof evaluated_key !== 'string')
									return setFatalError("result of " + key + " is not a string or number: " + evaluated_key, cb2);
								if (typeof evaluated_key === 'string')
									value = unwrapOneElementArrays(value);
								value = value[evaluated_key];
								if (value === undefined)
									return cb2("no such key in data");
								cb2();
							});
						},
						function (err) {
							if (err || fatal_error)
								return cb(false);
						//	console.log('value', typeof value, value)
							if (typeof value === 'boolean')
								cb(value);
							else if (typeof value === 'number')
								cb(new Decimal(value).times(1));
							else if (typeof value === 'string') {
								// convert to number if possible
								var f = string_utils.getNumericFeedValue(value);
								(f === null) ? cb(value) : cb(new Decimal(value).times(1));
							}
							else if (typeof value === 'object')
								cb(new wrappedObject(value));
							else
								throw Error("unknown type of keyed local var: " + value);
						}
					);
				});
				break;

			case 'local_var_assignment':
			case 'state_var_assignment':
			case 'response_var_assignment':
				var bLocal = (op === 'local_var_assignment');
				if (op === 'state_var_assignment' && !bStateVarAssignmentAllowed)
					return setFatalError("state var assignment not allowed here", cb, false);
				var var_name_or_expr = arr[1];
				if (bLocal) {
					// arr[1] is ['local_var', var_name, selectors]
					if (arr[1][2]) // selector in assignment
						return setFatalError("selector in assignment", cb, false);
					var_name_or_expr = arr[1][1];
				}
				var rhs = arr[2];
				var assignment_op = arr[3];
				if (assignment_op && op !== 'state_var_assignment')
					return setFatalError("assignment op set for non-state-var assignment", cb, false);
				evaluate(var_name_or_expr, function (var_name) {
					if (fatal_error)
						return cb(false);
					if (typeof var_name !== 'string')
						return setFatalError("assignment: var name "+var_name_or_expr+" evaluated to " + var_name, cb, false);
					if (bLocal && locals[var_name] !== undefined)
						return setFatalError("reassignment to " + var_name + ", old value " + locals[var_name], cb, false);
					evaluate(rhs, function (res) {
						if (fatal_error)
							return cb(false);
						if (!isValidValue(res) && !(res instanceof wrappedObject))
							return setFatalError("evaluation of rhs " + rhs + " failed: " + res, cb, false);
						if (Decimal.isDecimal(res))
							res = toDoubleRange(res);
						if (bLocal) {
							if (locals[var_name] !== undefined)
								return setFatalError("reassignment to " + var_name + " after evaluation", cb, false);
							locals[var_name] = res; // can be wrappedObject too
							return cb(true);
						}
						// state vars can store only strings, decimals, and booleans but booleans are treated specially when persisting to the db: true is converted to 1, false deletes the var
						// response vars - strings, numbers, and booleans
						if (res instanceof wrappedObject)
							res = true;
						if (op === 'response_var_assignment') {
							if (Decimal.isDecimal(res)) {
								res = res.toNumber();
								if (!isFinite(res))
									return setFatalError("not finite js number in response_var_assignment", cb, false);
							}
							responseVars[var_name] = res;
							return cb(true);
						}
						// state_var_assignment
						if (var_name.length > constants.MAX_STATE_VAR_NAME_LENGTH)
							return setFatalError("state var name too long: " + var_name, cb, false);
					//	if (typeof res === 'boolean')
					//		res = new Decimal(res ? 1 : 0);
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
							if (assignment_op === '||=') {
								value = value.toString() + res.toString();
								if (value.length > constants.MAX_STATE_VAR_VALUE_LENGTH)
									return setFatalError("state var value after "+assignment_op+" too long: " + value, cb, false);
							}
							else {
								if (typeof value === 'boolean')
									value = new Decimal(value ? 1 : 0);
								if (typeof res === 'boolean')
									res = new Decimal(res ? 1 : 0);
								if (!Decimal.isDecimal(value))
									return setFatalError("current value is not decimal: " + value, cb, false);
								if (!Decimal.isDecimal(res))
									return setFatalError("rhs is not decimal: " + res, cb, false);
								if ((assignment_op === '+=' || assignment_op === '-=') && stateVars[address][var_name].old_value === undefined)
									stateVars[address][var_name].old_value = new Decimal(0);
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

			case 'block':
				var arrStatements = arr[1];
				async.eachSeries(
					arrStatements,
					function (statement, cb2) {
						evaluate(statement, function (res) {
							if (fatal_error)
								return cb2(fatal_error);
							if (res !== true)
								return setFatalError("statement in {} " + statement + " failed", cb2);
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
					if (param_address !== 'this address' && !ValidationUtils.isValidAddress(param_address))
						return setFatalError("var address is invalid: " + param_address, cb, false);
					if (param_address === 'this address')
						param_address = address;
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
						if (typeof field !== 'string' || !(field in objBaseAssetInfo))
							return setFatalError("bad field in asset[]: " + field, cb, false);
						if (asset === 'base')
							return cb(objBaseAssetInfo[field]);
						if (!ValidationUtils.isValidBase64(asset, constants.HASH_LENGTH)) {
							if (field === 'exists')
								return cb(false);
							return setFatalError("bad asset in asset[]: " + asset, cb, false);
						}
						storage.readAssetInfo(conn, asset, function (objAsset) {
							if (!objAsset)
								return cb(false);
							if (objAsset.main_chain_index > objValidationState.last_ball_mci)
								return cb(false);
							if (objAsset.sequence !== "good")
								return cb(false);
							if (field === 'cap') // can be null
								return cb(objAsset.cap || 0);
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
						if (signedPackage.version !== constants.version)
							return cb(false);
						signed_message.validateSignedMessage(conn, signedPackage, evaluated_address, function (err, last_ball_mci) {
							if (err)
								return cb(false);
							if (last_ball_mci === null || last_ball_mci > objValidationState.last_ball_mci)
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
						if (!ValidationUtils.isValidHexadecimal(evaluated_signature) && !ValidationUtils.isValidBase64(evaluated_signature))
							return setFatalError("bad signature string in is_valid_sig", cb, false);
						evaluate(pem_key, function (evaluated_pem_key) {
							if (fatal_error)
								return cb(false);
							signature.validateAndFormatPemPubKey(evaluated_pem_key, function (error, formatted_pem_key){
								if (error)
									return setFatalError("bad PEM key in is_valid_sig: " + error, cb, false);
								var result = signature.verifyMessageWithPemPubKey(evaluated_message, evaluated_signature, formatted_pem_key);
								return cb(result);
							});
						});
					});
				});
				break;

			case 'sha256':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject)
						res = true;
					if (!isValidValue(res))
						return setFatalError("invalid value in sha256: " + res, cb, false);
					if (Decimal.isDecimal(res))
						res = toDoubleRange(res);
					cb(crypto.createHash("sha256").update(res.toString(), "utf8").digest("base64"));
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
						var min = new Decimal(0);
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
						return cb(new Decimal(json).times(1));
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
					var json = string_utils.getJsonSourceString(res); // sorts keys unlike JSON.stringify()
					if (json.length > constants.MAX_AA_STRING_LENGTH)
						return setFatalError("json_stringified is too long", cb, false);
					cb(json);
				});
				break;

			case 'length':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					if (res instanceof wrappedObject)
						res = true;
					cb(new Decimal(res.toString().length));
				});
				break;

			case 'starts_with':
			case 'ends_with':
			case 'contains':
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
						if (typeof start === 'string')
							return setFatalError("start index in substring cannot be a string", cb, false);
						if (start instanceof wrappedObject)
							start = true;
						if (typeof start === 'boolean')
							start = start ? 1 : 0;
						else if (Decimal.isDecimal(start))
							start = start.toNumber();
						else
							throw Error("unknown type of start in substring: " + start);
						if (!length_expr)
							return cb(str.substr(start));
						evaluate(length_expr, function (length) {
							if (fatal_error)
								return cb(false);
							if (typeof length === 'string')
								return setFatalError("length in substring cannot be a string", cb, false);
							if (length instanceof wrappedObject)
								length = true;
							if (typeof length === 'boolean')
								length = length ? 1 : 0;
							else if (Decimal.isDecimal(length))
								length = length.toNumber();
							else
								throw Error("unknown type of length in substring: " + length);
							cb(str.substr(start, length));
						});
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
					conn.query("SELECT 1 FROM aa_addresses WHERE address=? AND mci<=?", [res, objValidationState.last_ball_mci], function (rows) {
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

			case 'is_array':
			case 'is_assoc':
				var expr = arr[1];
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
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
				if (!bAA || !bStatementsOnly || !bStateVarAssignmentAllowed)
					return setFatalError("response_unit outside state update formula", cb, false);
				if (!response_unit)
					return cb(false);
				cb(response_unit);
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

			case 'return':
				var expr = arr[1];
				if (expr === null) { // empty return
					if (!bStatementsOnly)
						return setFatalError("empty early return", cb, false);
					early_return = true;
					return cb(true);
				}
				if (bStatementsOnly)
					return setFatalError("non-empty early return", cb, false);
				evaluate(expr, function (res) {
					if (fatal_error)
						return cb(false);
					console.log('early return with: ', res);
					if (res instanceof wrappedObject)
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
				if (bStatementsOnly && expr)
					return setFatalError("expected statements only", cb, false);
				if (!bStatementsOnly && !expr)
					return setFatalError("return value missing", cb, false);
				async.eachSeries(
					arrStatements,
					function (statement, cb2) {
						evaluate(statement, function (res) {
							if (fatal_error)
								return cb2(fatal_error);
							if (res !== true)
								return setFatalError("statement " + statement + " failed", cb2);
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

	function readVar(param_address, var_name, cb2) {
		if (!stateVars[param_address])
			stateVars[param_address] = {};
		if (var_name in stateVars[param_address]) {
			console.log('using cache for var '+var_name);
			return cb2(stateVars[param_address][var_name].value);
		}
		kvstore.get("st\n" + param_address + "\n" + var_name, function (value) {
			console.log(var_name+'='+value);
			if (value === undefined) {
				stateVars[param_address][var_name] = {value: false};
				return cb2(false);
			}
			var f = string_utils.getNumericFeedValue(value);
			if (f !== null)
				value = new Decimal(value).times(1);
			stateVars[param_address][var_name] = {value: value, old_value: value, original_old_value: value};
			cb2(value);
		});
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
				if (search_value_expr.type === 'none') {
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
							val = val[fields[i]];
						}
						if (search_value === null)
							return (comp === '=' ? val === undefined : val !== undefined);
						if (typeof val === 'string' && typeof search_value === 'number') {
							var f = string_utils.getNumericFeedValue(val);
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
		});
	} else {
		if (parser.results.length > 1) {
			console.log('ambiguous grammar', parser.results);
			callback('ambiguous grammar', null);
		}
	}
};
