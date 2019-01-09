var nearley = require("nearley");
var grammar = require("./grammar.js");
var BigNumber = require('bignumber.js');
var async = require('async');
var ValidationUtils = require("../validation_utils.js");
var constants = require('../constants');

BigNumber.config({EXPONENTIAL_AT: [-30, 30], POW_PRECISION: 100, RANGE: 100});

var cacheLimit = 100;
var formulasInCache = [];
var cache = {};

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
		return callback({error: 'Incorrect formula', complexity});
	}
	
	function evaluate(arr, cb) {
		if(typeof arr !== 'object' || BigNumber.isBigNumber(arr)){
			if (BigNumber.isBigNumber(arr)) return cb(arr);
			if (typeof arr === 'boolean') return cb(arr);
			if (typeof arr === 'string') return cb(arr);
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
					if (BigNumber.isBigNumber(param)) {
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
			case 'sin':
			case 'cos':
			case 'tan':
			case 'asin':
			case 'acos':
			case 'atan':
			case 'log':
			case 'sqrt':
			case 'ceil':
			case 'floor':
			case 'round':
				if (BigNumber.isBigNumber(arr[1])) {
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
					if (BigNumber.isBigNumber(param)) {
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
			case 'and':
			case 'or':
			case 'comparison':
				if (arr[1] === '=') return cb(false);
				async.eachSeries(arr.slice(2), function (param, cb2) {
					if (BigNumber.isBigNumber(param)) {
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
					if (BigNumber.isBigNumber(param)) {
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
				var result = validateDataFeed(arr[1]);
				complexity += result.complexity;
				cb(!result.error);
				break;
			case 'input':
			case 'output':
				cb(inputOrOutputIsValid(arr[1]));
				break;
			case 'concat':
				async.eachSeries(arr.slice(1), function (param, cb2) {
					if (BigNumber.isBigNumber(param)) {
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
		callback({complexity, error: true});
	}
};

function inputOrOutputIsValid(params) {
	if (!Object.keys(params).length) return false;
	for (var k in params) {
		var operator = params[k].operator;
		var value = params[k].value;
		if (BigNumber.isBigNumber(value)) value = value.toString();
		if (operator === '==') return false;
		switch (k) {
			case 'address':
				if (operator !== '=' && operator !== '!=') return false;
				if (!(value === 'this address' || value === 'other address' || ValidationUtils.isValidAddress(value))) return false;
				break;
			case 'amount':
				if (!(/^\d+$/.test(value) && ValidationUtils.isPositiveInteger(parseInt(value)))) return false;
				break;
			case 'asset':
				if (operator !== '=' && operator !== '!=') return false;
				if (!(value === 'base' || ValidationUtils.isValidBase64(value, constants.HASH_LENGTH))) return false;
				break;
			default:
				return false;
		}
	}
	return true;
}

function validateDataFeed(arr) {
	var complexity = 0;
	if (arr['oracles'] && arr['feed_name']) {
		for (var k in arr) {
			var operator = arr[k].operator;
			var value = arr[k].value;
			if (BigNumber.isBigNumber(value)) value = value.toString();
			if (operator === '==') return false;
			switch (k) {
				case 'oracles':
					if (value.trim() === '') return {error: true, complexity};
					if (operator !== '=') return {error: true, complexity};
					var addresses = value.split(':');
					if (addresses.length === 0) return {error: true, complexity};
					complexity += addresses.length;
					if (!addresses.every(function (address) {
						return ValidationUtils.isValidAddress(address) || address === 'this address';
					})) return {error: true, complexity};
					break;
				
				case 'feed_name':
					if (!(operator === '=')) return {error: true, complexity};
					if (value.trim() === '') return {error: true, complexity};
					break;
				
				case 'mci':
					if (!(/^\d+$/.test(value) && ValidationUtils.isNonnegativeInteger(parseInt(value)))) return {
						error: true,
						complexity
					};
					break;
				
				case 'feed_value':
					break;
				case 'ifseveral':
					if (!(value === 'first' || value === 'last' || value === 'abort')) return {error: true, complexity};
					if (!(operator === '=')) return {error: true, complexity};
					break;
				case 'ifnone':
					if (!(operator === '=')) return {error: true, complexity};
					break;
				default:
					return {error: true, complexity};
			}
		}
		return {error: false, complexity};
	} else {
		return {error: true, complexity};
	}
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
			callback(false);
		}
	}
	var fatal_error = false;
	
	function evaluate(arr, cb) {
		if (typeof arr !== 'object' || BigNumber.isBigNumber(arr)) {
			if (BigNumber.isBigNumber(arr)) return cb(arr);
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
					if (BigNumber.isBigNumber(param)) {
						if (prevV === undefined) {
							prevV = param;
						} else {
							prevV = prevV[f](param);
						}
						cb2();
					} else {
						evaluate(param, function (res) {
							if (BigNumber.isBigNumber(res)) {
								if (prevV === undefined) {
									prevV = res;
								} else {
									prevV = prevV[f](res);
								}
								cb2();
							} else {
								fatal_error = true;
								cb2('incorrect res')
							}
							
						});
					}
				}, function (err) {
					cb(err ? false : prevV);
				});
				break;
			case 'sin':
			case 'cos':
			case 'tan':
			case 'asin':
			case 'acos':
			case 'atan':
			case 'log':
				if (BigNumber.isBigNumber(arr[1])) {
					cb(new BigNumber(Math[op](arr[1].toNumber()).toPrecision(15)));
				} else {
					evaluate(arr[1], function (res) {
						if (BigNumber.isBigNumber(res)) {
							cb(new BigNumber(Math[op](res.toNumber()).toPrecision(15)));
						} else {
							fatal_error = true;
							cb(false);
						}
					});
				}
				break;
			case 'sqrt':
				if (BigNumber.isBigNumber(arr[1])) {
					cb(arr[1].sqrt());
				} else {
					evaluate(arr[1], function (res) {
						if (BigNumber.isBigNumber(res)) {
							cb(res.sqrt());
						} else {
							fatal_error = true;
							cb(false);
						}
					});
				}
				break;
			case 'ceil':
			case 'floor':
			case 'round':
				var roundingMode;
				switch (op) {
					case 'ceil':
						roundingMode = BigNumber.ROUND_CEIL;
						break;
					case 'floor':
						roundingMode = BigNumber.ROUND_FLOOR;
						break;
					case 'round':
						roundingMode = BigNumber.ROUND_HALF_EVEN;
						break;
				}
				if (BigNumber.isBigNumber(arr[1])) {
					cb(arr[1].dp(0, roundingMode));
				} else {
					evaluate(arr[1], function (res) {
						if (BigNumber.isBigNumber(res)) {
							cb(res.dp(0, roundingMode));
						} else {
							fatal_error = true;
							cb(false);
						}
					});
				}
				break;
			case 'min':
			case 'max':
				var vals = [];
				async.eachSeries(arr[1], function (param, cb2) {
					if (BigNumber.isBigNumber(param)) {
						vals.push(param);
						cb2();
					} else {
						evaluate(param, function (res) {
							if (BigNumber.isBigNumber(res)) {
								vals.push(res);
								cb2();
							} else {
								fatal_error = true;
								cb2('Incorrect ' + op);
							}
						});
					}
				}, function (err) {
					if (err) {
						fatal_error = true;
						return cb(false);
					}
					if (op === 'min') {
						return cb(BigNumber.min.apply(null, vals));
					} else {
						return cb(BigNumber.max.apply(null, vals))
					}
				});
				break;
			case 'and':
				var prevV = true;
				async.eachSeries(arr.slice(1), function (param, cb2) {
					if (typeof param === 'boolean') {
						prevV = prevV && param;
						cb2();
					} else if (BigNumber.isBigNumber(param)) {
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
							} else if (BigNumber.isBigNumber(res)) {
								prevV = prevV && !(res.eq(0));
								cb2();
							} else if (typeof res === 'string') {
								prevV = prevV && !!res;
								cb2();
							} else {
								fatal_error = true;
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
					} else if (BigNumber.isBigNumber(param)) {
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
							} else if (BigNumber.isBigNumber(res)) {
								prevV = prevV || !(res.eq(0));
								cb2();
							} else if (typeof res === 'string') {
								prevV = prevV || !!res;
								cb2();
							} else {
								fatal_error = true;
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
					if (BigNumber.isBigNumber(param) || typeof param === 'string') {
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
							if (BigNumber.isBigNumber(val1)) {
								val1 = !(val1.eq(0));
							} else if (typeof val1 === "string") {
								val1 = !!val1;
							} else {
								fatal_error = true;
								return cb(false);
							}
						}
						if (typeof val2 !== 'boolean') {
							if (BigNumber.isBigNumber(val2)) {
								val2 = !(val2.eq(0));
							} else if (typeof val2 === "string") {
								val2 = !!val2;
							} else {
								fatal_error = true;
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
						if (BigNumber.isBigNumber(val1)) {
							val1 = val1.toString();
						}
						if (BigNumber.isBigNumber(val2)) {
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
					} else if (BigNumber.isBigNumber(val1) && BigNumber.isBigNumber(val2)) {
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
						return cb(false);
					}
				});
				break;
			case 'ternary':
				var conditionResult;
				async.eachSeries([arr[1]], function (param, cb2) {
					if (BigNumber.isBigNumber(param)) {
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
							} else if (BigNumber.isBigNumber(res)) {
								conditionResult = !(res.eq(0));
								cb2();
							} else if (typeof res === 'string') {
								conditionResult = !!res;
								cb2();
							} else {
								fatal_error = true;
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
					if (BigNumber.isBigNumber(param2)) {
						cb(param2);
					} else if (typeof param2 === 'boolean') {
						cb(param2);
					} else if (typeof param2 === 'string') {
						cb(param2);
					} else {
						evaluate(param2, function (res) {
							if (BigNumber.isBigNumber(res)) {
								cb(res);
							} else if (typeof res === 'boolean') {
								cb(res);
							} else if (typeof res === 'string') {
								cb(res);
							} else {
								fatal_error = true;
								cb(false);
							}
						});
					}
				});
				break;
			case 'pi':
				cb(new BigNumber(Math.PI));
				break;
			case 'e':
				cb(new BigNumber(Math.E));
				break;
			case 'data_feed':
			
			function getDataFeed(params, cb) {
				var arrAddresses = params.oracles.value.split(':');
				var feed_name = params.feed_name.value;
				var value = null;
				var relation = '';
				var mci_relation = '';
				var min_mci = 0;
				if (params.feed_value) {
					value = params.feed_value.value;
					relation = params.feed_value.operator;
				}
				if (params.mci) {
					min_mci = params.mci.value.toString();
					mci_relation = params.mci.operator;
				}
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
					if (BigNumber.isBigNumber(value)) {
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
									cb(null, new BigNumber(rows[0].int_value));
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
				);
			}
				
				getDataFeed(arr[1], function (err, result) {
					if (err) {
						fatal_error = true;
						return cb(false);
					}
					cb(result);
				});
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
				if (puts.length === 0) return '';
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
						put.amount = new BigNumber(put.amount);
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
					if (puts.length > 1) return '';
					return puts[0];
				} else {
					return '';
				}
			}
				
				var result = findOutputOrInputAndReturnName(arr[1]);
				if (result === '') {
					fatal_error = true;
					return cb(false);
				}
				if (arr[2] === 'amount') {
					cb(new BigNumber(result['amount']));
				} else if (arr[2] === 'asset') {
					if (!result['asset']) result['asset'] = 'base';
					cb(result['asset'])
				} else {
					cb(result[arr[2]]);
				}
				break;
			
			case 'concat':
				var result = '';
				async.eachSeries(arr.slice(1), function (param, cb2) {
					if (BigNumber.isBigNumber(param)) {
						result += param.toString();
						cb2();
					} else if (typeof param === 'string') {
						result += param;
						cb2();
					} else {
						evaluate(param, function (res) {
							if (BigNumber.isBigNumber(res)) {
								result += res.toString();
								cb2();
							} else if (typeof res === 'string') {
								result += res;
								cb2();
							} else {
								fatal_error = true;
								cb2('Incorrect res');
							}
						});
					}
				}, function (err) {
					cb(!err ? result : false);
				});
				break;
			default:
				fatal_error = true;
				cb(false);
				break;
		}
		
	}
	
	if (parser.results.length === 1 && parser.results[0]) {
		evaluate(parser.results[0], res => {
			if (fatal_error) {
				callback(false);
			} else {
				callback(res);
			}
		});
	} else {
		callback(false);
	}
};