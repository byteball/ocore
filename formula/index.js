var nearley = require("nearley");
var grammar = require("./grammar.js");
var Decimal = require('decimal.js');
var async = require('async');
var ValidationUtils = require("../validation_utils.js");
var constants = require('../constants');
var dataFeeds = require('../data_feeds.js');

if (!Number.MAX_SAFE_INTEGER)
	Number.MAX_SAFE_INTEGER = Math.pow(2, 53) - 1; // 9007199254740991


Decimal.set({
	precision: 15,
	rounding: Decimal.ROUND_HALF_EVEN,
	maxE: 308,
	minE: -324,
	toExpNeg: -400,
	toExpPos: 400,
});

var decimalE = new Decimal(Math.E);
var decimalPi = new Decimal(Math.PI);

var cacheLimit = 100;
var formulasInCache = [];
var cache = {};

function isValidValue(val){
	return (typeof val === 'string' || typeof val === 'boolean' || Decimal.isDecimal(val) && val.isFinite());
}

exports.validate = function (formula, complexity, callback) {
	complexity++;
	var parser = {};
	try {
		if(cache[formula]){
			parser.results = cache[formula];
		}else {
			parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar));
			parser.feed(formula);
			if(formulasInCache.length > cacheLimit){
				var f = formulasInCache.shift();
				delete cache[f];
			}
			formulasInCache.push(formula);
			cache[formula] = parser.results;
		}
	} catch (e) {
	//	console.log('==== parse error', e, e.stack)
		return callback({error: 'parse error', complexity});
	}
	
	function evaluate(arr, cb) {
		if (Decimal.isDecimal(arr) && arr.isFinite()) return cb(true);
		if(typeof arr !== 'object'){
			if (typeof arr === 'boolean') return cb(true);
			if (typeof arr === 'string') return cb(true);
			return cb(false);
		}
		var op = arr[0];
		switch (op) {
			case '+':
			case '-':
			case '*':
			case '/':
			case '^':
				async.eachSeries(arr.slice(1), function (param, cb2) {
					if (Decimal.isDecimal(param) && param.isFinite()) {
						cb2();
					} else {
						evaluate(param, function (res) {
							cb2(!res);
						});
					}
				}, function (error) {
					cb(!error);
				});
				break;
			case 'sqrt':
			case 'ceil':
			case 'floor':
			case 'round':
				if (Decimal.isDecimal(arr[1]) && arr[1].isFinite()) {
					cb(true);
				} else {
					evaluate(arr[1], function (res) {
						cb(!!res);
					});
				}
				break;
			case 'min':
			case 'max':
				async.eachSeries(arr[1], function (param, cb2) {
					if (Decimal.isDecimal(param) && param.isFinite()) {
						cb2();
					} else {
						evaluate(param, function (res) {
							cb2(!res);
						});
					}
				}, function (error) {
					cb(!error);
				});
				break;
			case 'pi':
			case 'e':
				cb(true);
				break;
			case 'not':
				evaluate(arr[1], cb);
				break;
			case 'and':
			case 'or':
			case 'comparison':
				if (arr[1] === '=') return cb(false);
				async.eachSeries(arr.slice(2), function (param, cb2) {
					if (Decimal.isDecimal(param) && param.isFinite()) {
						cb2();
					} else {
						evaluate(param, function (res) {
							cb2(!res);
						});
					}
				}, function (error) {
					cb(!error);
				});
				break;
			case 'ternary':
				async.eachSeries(arr.slice(1), function (param, cb2) {
					if (Decimal.isDecimal(param) && param.isFinite()) {
						cb2();
					} else if (typeof param === 'string') {
						cb2();
					} else {
						evaluate(param, function (res) {
							cb2(!res);
						});
					}
				}, function (error) {
					cb(!error);
				});
				break;
			case 'data_feed':
			case 'in_data_feed':
				var params = arr[1];
				var result = (op === 'data_feed') ? validateDataFeed(params) : validateDataFeedExists(params);
				complexity += result.complexity;
				if (result.error)
					return cb(false);
				async.eachSeries(
					Object.keys(params),
					function(param_name, cb2){
						evaluate(params[param_name].value, function(res){
							cb2(!res);
						});
					},
					function(err){
						cb(!err);
					}
				);
				break;
			case 'input':
			case 'output':
				var params = arr[1];
				var bIoValid = inputOrOutputIsValid(params);
				if (!bIoValid)
					return cb(false);
				async.eachSeries(
					Object.keys(params),
					function(param_name, cb2){
						evaluate(params[param_name].value, function(res){
							cb2(!res);
						});
					},
					function(err){
						cb(!err);
					}
				);
				break;
			case 'concat':
				async.eachSeries(arr.slice(1), function (param, cb2) {
					if (Decimal.isDecimal(param) && param.isFinite()) {
						cb2();
					} else if (typeof param === 'string') {
						cb2();
					} else {
						evaluate(param, function (res) {
							cb2(!res);
						});
					}
				}, function (err) {
					cb(!err);
				});
				break;
			default:
				cb(false);
				break;
		}
	}
	
	if (parser.results.length === 1 && parser.results[0]) {
		evaluate(parser.results[0], res => {
			callback({complexity, error: !res});
		});
	} else {
		if (parser.results.length > 1)
			console.log('validation: ambiguous grammar', JSON.stringify(parser.results));
		callback({complexity, error: true});
	}
};

function inputOrOutputIsValid(params) {
	if (!Object.keys(params).length) return false;
	for (var name in params) {
		var operator = params[name].operator;
		var value = params[name].value;
		if (Decimal.isDecimal(value)){
			if (!value.isFinite())
				return false;
			value = value.toString();
		}
		if (operator === '==') return false;
		if (['address', 'amount', 'asset'].indexOf(name) === -1)
			return false;
		if ((name === 'address' || name === 'asset') && operator !== '=' && operator !== '!=')
			return false;
		if (typeof value !== 'string') // a nested expression
			return true;
		switch (name) {
			case 'address':
				if (!(value === 'this address' || value === 'other address' || ValidationUtils.isValidAddress(value))) return false;
				break;
			case 'amount':
				if (!(/^\d+$/.test(value) && ValidationUtils.isPositiveInteger(parseInt(value)))) return false;
				break;
			case 'asset':
				if (!(value === 'base' || ValidationUtils.isValidBase64(value, constants.HASH_LENGTH))) return false;
				break;
			default:
				throw Error("unrec name after check: "+name);
		}
	}
	return true;
}

function validateDataFeed(params) {
	var complexity = 1;
	if (params.oracles && params.feed_name) {
		for (var name in params) {
			var operator = params[name].operator;
			var value = params[name].value;
			if (Decimal.isDecimal(value)){
				if (!value.isFinite())
					return {error: true, complexity};
				value = value.toString();
			}
			if (operator !== '=') return {error: true, complexity};
			if (['oracles', 'feed_name', 'min_mci', 'feed_value', 'ifseveral', 'ifnone', 'what'].indexOf(name) === -1)
				return {error: true, complexity};
			if (typeof value !== 'string')
				continue;
			switch (name) {
				case 'oracles':
					if (value.trim() === '') return {error: true, complexity};
					var addresses = value.split(':');
					if (addresses.length === 0) return {error: true, complexity};
				//	complexity += addresses.length;
					if (!addresses.every(function (address) {
						return ValidationUtils.isValidAddress(address) || address === 'this address';
					})) return {error: true, complexity};
					break;
				
				case 'feed_name':
					if (value.trim() === '') return {error: true, complexity};
					break;
				
				case 'min_mci':
					if (!(/^\d+$/.test(value) && ValidationUtils.isNonnegativeInteger(parseInt(value)))) return {
						error: true,
						complexity
					};
					break;
				
				case 'feed_value':
					break;
				case 'ifseveral':
					if (!(value === 'last' || value === 'abort')) return {error: true, complexity};
					break;
				case 'ifnone':
					break;
				case 'what':
					if (!(value === 'value' || value === 'unit')) return {error: true, complexity};
					break;
				default:
					throw Error("unrecognized name after checking: "+name);
			}
		}
		return {error: false, complexity};
	} else {
		return {error: true, complexity};
	}
}

function validateDataFeedExists(params) {
	var complexity = 1;
	if (!params.oracles || !params.feed_name || !params.feed_value)
		return {error: true, complexity};
	for (var name in params) {
		var operator = params[name].operator;
		var value = params[name].value;
		if (Decimal.isDecimal(value)){
			if (!value.isFinite())
				return {error: true, complexity};
			value = value.toString();
		}
		if (operator === '==') return {error: true, complexity};
		if (['oracles', 'feed_name', 'min_mci', 'feed_value'].indexOf(name) === -1)
			return {error: true, complexity};
		if ((name === 'oracles' || name === 'feed_name' || name === 'min_mci') && operator !== '=')
			return {error: true, complexity};
		if (typeof value !== 'string')
			continue;
		switch (name) {
			case 'oracles':
				if (value.trim() === '') return {error: true, complexity};
				var addresses = value.split(':');
				if (addresses.length === 0) return {error: true, complexity};
			//	complexity += addresses.length;
				if (!addresses.every(function (address) {
					return ValidationUtils.isValidAddress(address) || address === 'this address';
				})) return {error: true, complexity};
				break;

			case 'feed_name':
				if (value.trim() === '') return {error: true, complexity};
				break;

			case 'min_mci':
				if (!(/^\d+$/.test(value) && ValidationUtils.isNonnegativeInteger(parseInt(value))))
					return {error: true, complexity};
				break;

			case 'feed_value':
				break;
			default:
				throw Error("unrecognized name after checking: "+name);
		}
	}
	return {error: false, complexity};
}

exports.evaluate = function (conn, formula, messages, objValidationState, address, callback) {
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
			callback(null);
		}
	}
	var fatal_error = false;
	
	function evaluate(arr, cb) {
		if (fatal_error)
			return cb(false);
		if (Decimal.isDecimal(arr) && arr.isFinite()) return cb(arr);
		if (typeof arr !== 'object') {
			if (typeof arr === 'boolean') return cb(arr);
			if (typeof arr === 'string') return cb(arr);
			fatal_error = true;
			return cb(false);
		}
		var op = arr[0];
		switch (op) {
			case '+':
			case '-':
			case '*':
			case '/':
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
					case '^':
						f = 'pow';
						break;
				}
				var prevV;
				async.eachSeries(arr.slice(1), function (param, cb2) {
					evaluate(param, function (res) {
						if (Decimal.isDecimal(res) && res.isFinite()) {
							if (prevV === undefined) {
								prevV = res;
							} else {
								if (f === 'pow'){
									if (prevV.eq(decimalE)){ // natural exponential
										console.log('e^x');
										prevV = res.exp();
										return cb2();
									}
									else if (!res.isInteger() || res.abs().gte(Number.MAX_SAFE_INTEGER)){
										fatal_error = true;
										console.log('non-integer or large exponent '+res);
										return cb2('non-integer or large exponent');
									}
								}
								prevV = prevV[f](res);
							}
							cb2();
						} else {
							fatal_error = true;
							console.log('not a decimal in '+op);
							cb2('incorrect res')
						}

					});
				}, function (err) {
					if (err)
						return cb(false);
					if (!prevV.isFinite()){
						fatal_error = true;
						console.log('not finite in '+op);
						return cb(false);
					}
					cb(prevV);
				});
				break;
			case 'sqrt':
				evaluate(arr[1], function (res) {
					if (Decimal.isDecimal(res) && !res.isNegative() && res.isFinite()) {
						cb(res.sqrt());
					} else {
						fatal_error = true;
						console.log('not a decimal in '+op);
						cb(false);
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
					if (Decimal.isDecimal(dp_res) && dp_res.isInteger() && !dp_res.isNegative() && dp_res.lte(15))
						dp = dp_res;
					else{
						fatal_error = true;
						console.log('bad dp in '+op, dp, dp_res);
						return cb(false);
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
						if (Decimal.isDecimal(res) && res.isFinite()) {
							cb(res.toDecimalPlaces(dp.toNumber(), roundingMode));
						} else {
							fatal_error = true;
							console.log('not a decimal in '+op);
							cb(false);
						}
					});
				});
				break;
			case 'min':
			case 'max':
				var vals = [];
				async.eachSeries(arr[1], function (param, cb2) {
					evaluate(param, function (res) {
						if (Decimal.isDecimal(res) && res.isFinite()) {
							vals.push(res);
							cb2();
						} else {
							fatal_error = true;
							console.log('not a decimal in '+op);
							cb2('Incorrect ' + op);
						}
					});
				}, function (err) {
					if (err) {
						fatal_error = true;
						return cb(false);
					}
					if (op === 'min') {
						return cb(Decimal.min.apply(Decimal, vals));
					} else {
						return cb(Decimal.max.apply(Decimal, vals))
					}
				});
				break;
			case 'not':
				evaluate(arr[1], function(res){
					cb(!res);
				});
				break;
			case 'and':
				var prevV = true;
				async.eachSeries(arr.slice(1), function (param, cb2) {
					if (typeof param === 'boolean') {
						prevV = prevV && param;
						cb2();
					} else if (Decimal.isDecimal(param) && param.isFinite()) {
						prevV = prevV && !(param.eq(0));
						cb2();
					} else if (typeof param === 'string') {
						prevV = prevV && !!param;
						cb2();
					} else {
						evaluate(param, function (res) {
							if (typeof res === 'boolean') {
								prevV = prevV && res;
								cb2();
							} else if (Decimal.isDecimal(res) && res.isFinite()) {
								prevV = prevV && !(res.eq(0));
								cb2();
							} else if (typeof res === 'string') {
								prevV = prevV && !!res;
								cb2();
							} else {
								fatal_error = true;
								console.log('unrecognized type in '+op);
								cb2('Incorrect and');
							}
						});
					}
				}, function (err) {
					cb(!err ? prevV : false);
				});
				break;
			case 'or':
				var prevV = false;
				async.eachSeries(arr.slice(1), function (param, cb2) {
					if (typeof param === 'boolean') {
						prevV = prevV && param;
						cb2();
					} else if (Decimal.isDecimal(param) && param.isFinite()) {
						prevV = prevV || !(param.eq(0));
						cb2();
					} else if (typeof param === 'string') {
						prevV = prevV || !!param;
						cb2();
					} else {
						evaluate(param, function (res) {
							if (typeof res === 'boolean') {
								prevV = prevV || res;
								cb2();
							} else if (Decimal.isDecimal(res) && res.isFinite()) {
								prevV = prevV || !(res.eq(0));
								cb2();
							} else if (typeof res === 'string') {
								prevV = prevV || !!res;
								cb2();
							} else {
								fatal_error = true;
								console.log('unrecognized type in '+op);
								cb2('Incorrect or');
							}
						});
					}
				}, function (err) {
					cb(!err ? prevV : false);
				});
				break;
			case 'comparison':
				var vals = [];
				var operator = arr[1];
				if (operator === '=') {
					fatal_error = true;
					return cb(false);
				}
				var param1 = arr[2];
				var param2 = arr[3];
				async.forEachOfSeries([param1, param2], function (param, index, cb2) {
					if (Decimal.isDecimal(param) && param.isFinite() || typeof param === 'string') {
						vals[index] = param;
						cb2();
					} else {
						evaluate(param, function (res) {
							vals[index] = res;
							cb2();
						});
					}
				}, function () {
					var val1 = vals[0];
					var val2 = vals[1];
					if (typeof val1 === 'boolean' || typeof val2 === 'boolean') {
						if (typeof val1 !== 'boolean') {
							if (Decimal.isDecimal(val1) && val1.isFinite()) {
								val1 = !(val1.eq(0));
							} else if (typeof val1 === "string") {
								val1 = !!val1;
							} else {
								fatal_error = true;
								console.log('unrecognized type of val1 in '+op);
								return cb(false);
							}
						}
						if (typeof val2 !== 'boolean') {
							if (Decimal.isDecimal(val2) && val2.isFinite()) {
								val2 = !(val2.eq(0));
							} else if (typeof val2 === "string") {
								val2 = !!val2;
							} else {
								fatal_error = true;
								console.log('unrecognized type of val2 in '+op);
								return cb(false);
							}
						}
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
						}
					} else if (typeof val1 === 'string' || typeof val2 === 'string') {
						if (Decimal.isDecimal(val1) && val1.isFinite()) {
							val1 = val1.toString();
						}
						if (Decimal.isDecimal(val2) && val2.isFinite()) {
							val2 = val2.toString();
						}
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
						}
					} else if (Decimal.isDecimal(val1) && Decimal.isDecimal(val2) && val1.isFinite() && val2.isFinite()) {
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
						}
					} else {
						fatal_error = true;
						console.log('unrecognized combination of types in '+op);
						return cb(false);
					}
				});
				break;
			case 'ternary':
				var conditionResult;
				async.eachSeries([arr[1]], function (param, cb2) {
					if (Decimal.isDecimal(param) && param.isFinite()) {
						conditionResult = !param.eq(0);
						cb2();
					} else if (typeof param === 'boolean') {
						conditionResult = param;
						cb2();
					} else {
						evaluate(param, function (res) {
							if (typeof res === 'boolean') {
								conditionResult = res;
								cb2();
							} else if (Decimal.isDecimal(res) && res.isFinite()) {
								conditionResult = !(res.eq(0));
								cb2();
							} else if (typeof res === 'string') {
								conditionResult = !!res;
								cb2();
							} else {
								fatal_error = true;
								console.log('unrecognized type in '+op);
								cb2('Incorrect res');
							}
						});
					}
				}, function (error) {
					if (error) {
						fatal_error = true;
						return cb(false);
					}
					var param2 = conditionResult ? arr[2] : arr[3];
					if (Decimal.isDecimal(param2) && param2.isFinite()) {
						cb(param2);
					} else if (typeof param2 === 'boolean') {
						cb(param2);
					} else if (typeof param2 === 'string') {
						cb(param2);
					} else {
						evaluate(param2, function (res) {
							if (Decimal.isDecimal(res) && res.isFinite()) {
								cb(res);
							} else if (typeof res === 'boolean') {
								cb(res);
							} else if (typeof res === 'string') {
								cb(res);
							} else {
								fatal_error = true;
								console.log('unrecognized type of res in '+op);
								cb(false);
							}
						});
					}
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
				if (params.ifnone && !isValidValue(params.ifnone.value))
					return cb("bad ifnone: "+params.ifnone.value);
				dataFeeds.readDataFeedValue(arrAddresses, feed_name, value, min_mci, objValidationState.last_ball_mci, ifseveral, function(objResult){
				//	console.log(arrAddresses, feed_name, value, min_mci, ifseveral);
				//	console.log('---- objResult', objResult);
					if (objResult.bAbortedBecauseOfSeveral)
						return cb("several values found");
					if (objResult.value !== undefined){
						if (what === 'unit')
							return cb(null, objResult.unit);
						return cb(null, (typeof objResult.value === 'string') ? objResult.value : new Decimal(objResult.value));
					}
					if (params.ifnone && params.ifnone.value !== 'abort'){
					//	console.log('===== ifnone=', params.ifnone.value, typeof params.ifnone.value);
						return cb(null, params.ifnone.value); // the type of ifnone (string, decimal) is preserved
					}
					cb("data feed not found");
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
							if (!isValidValue(res)){
								fatal_error = true;
								console.log('bad value '+res);
								return cb2('bad res');
							}
							evaluated_params[param_name] = {
								operator: params[param_name].operator,
								value: res
							};
							cb2();
						});
					},
					function(err){
						if (err)
							return cb(false);
						getDataFeed(evaluated_params, function (err, result) {
							if (err) {
								fatal_error = true;
								console.log('error from data feed: '+err);
								return cb(false);
							}
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
							if (!isValidValue(res)){
								fatal_error = true;
								console.log('bad value '+res);
								return cb2('bad res');
							}
							evaluated_params[param_name] = {
								operator: params[param_name].operator,
								value: res
							};
							cb2();
						});
					},
					function(err){
						if (err)
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
						}
						dataFeeds.dataFeedExists(arrAddresses, feed_name, relation, value, min_mci, objValidationState.last_ball_mci, cb);
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
					if (message.payload) {
						if (!asset) {
							puts = puts.concat(message.payload[type]);
						} else if (operator === '=' && asset === 'base' && !message.payload.asset) {
							puts = puts.concat(message.payload[type]);
						} else if (operator === '!=' && asset === 'base' && message.payload.asset) {
							puts = puts.concat(message.payload[type]);
						} else if (operator === '=' && asset === message.payload.asset && message.payload.asset) {
							puts = puts.concat(message.payload[type]);
						} else if (operator === '!=' && asset !== message.payload.asset && message.payload.asset) {
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
						} else {
							return !(put.amount.eq(objParams.amount.value));
						}
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
							if (!isValidValue(res))
								return setFatalError('bad value '+res, cb2);
							evaluated_params[param_name] = {
								operator: params[param_name].operator,
								value: res
							};
							cb2();
						});
					},
					function(err){
						if (err)
							return cb(false);
						if (evaluated_params.address){
							var v = evaluated_params.address.value;
							if (!ValidationUtils.isValidAddress(v) && v !== 'this address' && v !== 'other address')
								return setFatalError('bad address '+v, cb, false);
						}
						if (evaluated_params.asset){
							var v = evaluated_params.asset.value;
							if (!ValidationUtils.isValidBase64(v, constants.HASH_LENGTH) && v !== 'base')
								return setFatalError('bad asset', cb, false);
						}
						if (evaluated_params.amount){
							var v = evaluated_params.amount.value;
							if(!(Decimal.isDecimal(v) && v.isFinite()))
								return setFatalError('bad amount', cb, false);
						}
						var result = findOutputOrInputAndReturnName(evaluated_params);
						if (result === '') {
							console.log('not found or ambiguous in '+op);
							fatal_error = true;
							return cb(false);
						}
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
			
			case 'concat':
				var result = '';
				async.eachSeries(arr.slice(1), function (param, cb2) {
					if (Decimal.isDecimal(param) && param.isFinite()) {
						result += param.toString();
						cb2();
					} else if (typeof param === 'string') {
						result += param;
						cb2();
					} else {
						evaluate(param, function (res) {
							if (Decimal.isDecimal(res) && res.isFinite()) {
								result += res.toString();
								cb2();
							} else if (typeof res === 'string') {
								result += res;
								cb2();
							} else if (typeof res === 'boolean') {
								result += res.toString();
								cb2();
							} else {
								fatal_error = true;
								console.log('unrecognized type in '+op);
								cb2('Incorrect res');
							}
						});
					}
				}, function (err) {
					cb(!err ? result : false);
				});
				break;
			default:
				throw Error('unrecognized op '+op);
		}
		
	}
	
	function setFatalError(err, cb, cb_arg){
		fatal_error = true;
		console.log(err);
		(cb_arg !== undefined) ? cb(cb_arg) : cb(err);
	}
	
	
	if (parser.results.length === 1 && parser.results[0]) {
		evaluate(parser.results[0], res => {
			if (fatal_error) {
				callback(null);
			} else {
				callback(res);
			}
		});
	} else {
		if (parser.results.length > 1)
			console.log('ambiguous grammar', parser.results);
		callback(null);
	}
};
