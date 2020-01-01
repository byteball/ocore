var nearley = require("nearley");
var grammar = require("./grammars/oscript.js");
var async = require('async');
var ValidationUtils = require("../validation_utils.js");
var constants = require('../constants');

var cache = require('./common.js').cache;
var formulasInCache = require('./common.js').formulasInCache;
var cacheLimit = require('./common.js').cacheLimit;

var Decimal = require('./common.js').Decimal;
var objBaseAssetInfo = require('./common.js').objBaseAssetInfo;

var isFiniteDecimal = require('./common.js').isFiniteDecimal;
var toDoubleRange = require('./common.js').toDoubleRange;

function validateDataFeed(params) {
	var complexity = 1;
	if (params.oracles && params.feed_name) {
		for (var name in params) {
			var operator = params[name].operator;
			var value = params[name].value;
			if (Decimal.isDecimal(value)){
				if (!isFiniteDecimal(value))
					return {error: 'not finite', complexity};
				value = toDoubleRange(value).toString();
			}
			if (operator !== '=') return {error: 'not =', complexity};
			if (['oracles', 'feed_name', 'min_mci', 'feed_value', 'ifseveral', 'ifnone', 'what', 'type'].indexOf(name) === -1)
				return {error: 'unknown df param: ' + name, complexity};
			if (typeof value !== 'string')
				continue;
			switch (name) {
				case 'oracles':
					if (value.trim() === '') return {error: 'empty oracle', complexity};
					var addresses = value.split(':');
					if (addresses.length === 0) return {error: 'empty oracle list', complexity};
				//	complexity += addresses.length;
					if (!addresses.every(ValidationUtils.isValidAddress)) return {error: 'oracle address not valid', complexity};
					break;

				case 'feed_name':
					if (value.trim() === '') return {error: 'empty feed name', complexity};
					break;

				case 'min_mci':
					if (!(/^\d+$/.test(value) && ValidationUtils.isNonnegativeInteger(parseInt(value)))) return {
						error: 'bad min_mci',
						complexity
					};
					break;

				case 'feed_value':
					break;
				case 'ifseveral':
					if (!(value === 'last' || value === 'abort')) return {error: 'bad ifseveral: ' + value, complexity};
					break;
				case 'ifnone':
					break;
				case 'what':
					if (!(value === 'value' || value === 'unit')) return {error: 'bad what: ' + value, complexity};
					break;
				case 'type':
					if (!(value === 'string' || value === 'auto')) return {error: 'bad df type: ' + value, complexity};
					break;
				default:
					throw Error("unrecognized name after checking: "+name);
			}
		}
		return {error: false, complexity};
	} else {
		return {error: 'no oracles or feed name', complexity};
	}
}

function validateDataFeedExists(params) {
	var complexity = 1;
	if (!params.oracles || !params.feed_name || !params.feed_value)
		return {error: 'no oracles or feed name or feed value', complexity};
	for (var name in params) {
		var operator = params[name].operator;
		var value = params[name].value;
		if (Decimal.isDecimal(value)){
			if (!isFiniteDecimal(value))
				return {error: 'not finite', complexity};
			value = toDoubleRange(value).toString();
		}
		if (operator === '==') return {error: 'op ==', complexity};
		if (['oracles', 'feed_name', 'min_mci', 'feed_value'].indexOf(name) === -1)
			return {error: 'unknown param: ' + name, complexity};
		if ((name === 'oracles' || name === 'feed_name' || name === 'min_mci') && operator !== '=')
			return {error: 'not =', complexity};
		if (typeof value !== 'string')
			continue;
		switch (name) {
			case 'oracles':
				if (value.trim() === '') return {error: 'empty oracles', complexity};
				var addresses = value.split(':');
				if (addresses.length === 0) return {error: 'empty oracles list', complexity};
			//	complexity += addresses.length;
				if (!addresses.every(ValidationUtils.isValidAddress)) return {error: 'not valid oracle address', complexity};
				break;

			case 'feed_name':
				if (value.trim() === '') return {error: 'empty feed name', complexity};
				break;

			case 'min_mci':
				if (!(/^\d+$/.test(value) && ValidationUtils.isNonnegativeInteger(parseInt(value))))
					return {error: 'bad min_mci', complexity};
				break;

			case 'feed_value':
				break;
			default:
				throw Error("unrecognized name after checking: "+name);
		}
	}
	return {error: false, complexity};
}

function getAttestationError(params) {
	if (!params.attestors || !params.address)
		return 'no attestors or address';
	for (var name in params) {
		var operator = params[name].operator;
		var value = params[name].value;
		if (Decimal.isDecimal(value)){
			if (!isFiniteDecimal(value))
				return 'not finite';
			value = toDoubleRange(value).toString();
		}
		if (operator !== '=')
			return 'not =';
		if (['attestors', 'address', 'ifseveral', 'ifnone', 'type'].indexOf(name) === -1)
			return 'unknown field: ' + name;
		if (typeof value !== 'string') // expression
			continue;
		switch (name) {
			case 'attestors':
				value = value.trim();
				if (!value)
					return 'empty attestors';
				var attestor_addresses = value.split(':');
				if (!attestor_addresses.every(ValidationUtils.isValidAddress)) return 'bad attestor address: ' + value;
				break;

			case 'address':
				if (!ValidationUtils.isValidAddress(value))
					return 'bad address: ' + value;
				break;

			case 'ifseveral':
				if (!(value === 'last' || value === 'abort'))
					return 'bad ifseveral: ' + value;
				break;

			case 'type':
				if (!(value === 'string' || value === 'auto'))
					return 'bad attestation value type: ' + value;
				break;

			case 'ifnone':
				break;

			default:
				throw Error("unrecognized name in attestor after checking: "+name);
		}
	}
	return null;
}

function getInputOrOutputError(params) {
	if (!Object.keys(params).length) return 'no params';
	for (var name in params) {
		var operator = params[name].operator;
		var value = params[name].value;
		if (Decimal.isDecimal(value)){
			if (!isFiniteDecimal(value))
				return 'not finite';
			value = toDoubleRange(value).toString();
		}
		if (operator === '==') return '== not allowed';
		if (['address', 'amount', 'asset'].indexOf(name) === -1)
			return 'unknown field: ' + name;
		if ((name === 'address' || name === 'asset') && operator !== '=' && operator !== '!=')
			return 'not allowed: ' + operator;
		if (typeof value !== 'string') // a nested expression
			continue;
		switch (name) {
			case 'address':
				if (!ValidationUtils.isValidAddress(value)) return 'bad address: ' + value;
				break;
			case 'amount':
				if (!(/^\d+$/.test(value) && ValidationUtils.isPositiveInteger(parseInt(value)))) return 'bad amount: ' + value;
				break;
			case 'asset':
				if (!(value === 'base' || ValidationUtils.isValidBase64(value, constants.HASH_LENGTH))) return 'bad asset: ' + value;
				break;
			default:
				throw Error("unrec name after check: "+name);
		}
	}
	return null;
}

exports.validate = function (opts, callback) {
	//	complexity++;
	var formula = opts.formula;
	var bStateVarAssignmentAllowed = opts.bStateVarAssignmentAllowed;
	var bStatementsOnly = opts.bStatementsOnly;
	var bAA = opts.bAA;
	var complexity = opts.complexity;
	var count_ops = opts.count_ops;

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
		console.log('==== parse error', e, e.stack)
		return callback({error: 'parse error', complexity, errorMessage: e.message});
	}

	var count = 0;

	function evaluate(arr, cb) {
		count++;
		if (count % 100 === 0) // avoid extra long call stacks to prevent Maximum call stack size exceeded
			return (typeof setImmediate === 'function') ? setImmediate(evaluate, arr, cb) : setTimeout(evaluate, 0, arr, cb);
		if (Decimal.isDecimal(arr))
			return isFiniteDecimal(arr) ? cb() : cb("not finite decimal: " + arr);
		if(typeof arr !== 'object'){
			if (typeof arr === 'boolean') return cb();
			if (typeof arr === 'string') return cb();
			return cb('unknown type: ' + (typeof arr));
		}
		count_ops++;
		var op = arr[0];
		switch (op) {
			case '+':
			case '-':
			case '*':
			case '/':
			case '%':
			case '^':
				if (op === '^')
					complexity++;
				async.eachSeries(arr.slice(1), function (param, cb2) {
					if (typeof param === 'string') {
						cb2("arithmetic operation " + op + " with a string: " + param);
					} else {
						evaluate(param, cb2);
					}
				}, cb);
				break;
			case 'sqrt':
			case 'ln':
			case 'abs':
				if (typeof arr[1] === 'string')
					return cb(op + " of a string " + arr[1]);
				if (op === 'sqrt' || op === 'ln')
					complexity++;
				evaluate(arr[1], cb);
				break;
			case 'ceil':
			case 'floor':
			case 'round':
				if (typeof arr[1] === 'string' || typeof arr[2] === 'string')
					return cb(op + " of a string " + arr[1] + ', ' + arr[2]);
				evaluate(arr[1], function (err) {
					if (err)
						return cb(err);
					if (!arr[2])
						return cb();
					evaluate(arr[2], cb);
				});
				break;
			case 'min':
			case 'max':
			case 'hypot':
				if (op === 'hypot')
					complexity++;
				async.eachSeries(arr[1], function (param, cb2) {
					if (typeof param === 'string')
						return cb2(op + ' of a string: ' + param);
					evaluate(param, cb2);
				}, cb);
				break;
			case 'pi':
			case 'e':
				cb();
				break;
			case 'not':
				evaluate(arr[1], cb);
				break;

			case 'and':
			case 'or':
				async.eachSeries(arr.slice(1), function (param, cb2) {
					evaluate(param, cb2);
				}, cb);
				break;

			case 'comparison':
				if (arr[1] === '=') return cb('= in comparison');
				async.eachSeries(arr.slice(2), function (param, cb2) {
					evaluate(param, cb2);
				}, cb);
				break;

			case 'ternary':
			case 'otherwise':
				async.eachSeries(arr.slice(1), function (param, cb2) {
					evaluate(param, cb2);
				}, cb);
				break;

			case 'data_feed':
			case 'in_data_feed':
				var params = arr[1];
				var result = (op === 'data_feed') ? validateDataFeed(params) : validateDataFeedExists(params);
				complexity += result.complexity;
				if (result.error)
					return cb(result.error);
				async.eachSeries(
					Object.keys(params),
					function(param_name, cb2){
						evaluate(params[param_name].value, cb2);
					},
					cb
				);
				break;

			case 'input':
			case 'output':
			case 'attestation':
				if (op === 'attestation')
					complexity++;
				var params = arr[1];
				var field = arr[2];
				var err = (op === 'attestation') ? getAttestationError(params) : getInputOrOutputError(params);
				if (err)
					return cb(op + ' not valid: ' + err);
				if (op === 'input' || op === 'output') {
					if (bAA)
						return cb("io in AA");
					if (['amount', 'address', 'asset'].indexOf(field) === -1)
						return cb('unknown field: ' + field);
				}
				async.eachSeries(
					Object.keys(params),
					function(param_name, cb2){
						evaluate(params[param_name].value, cb2);
					},
					function(err){
						if (err)
							return cb(err);
						if (op !== 'attestation' || typeof field === 'string' || field === null)
							return cb();
						// for attestation, field can be an expression
						evaluate(field, cb);
					}
				);
				break;

			case 'concat':
				async.eachSeries(arr.slice(1), function (param, cb2) {
					evaluate(param, cb2);
				}, cb);
				break;

			case 'mci':
			case 'timestamp':
			case 'this_address':
				cb();
				break;

			case 'trigger.address':
			case 'trigger.initial_address':
			case 'trigger.unit':
			case 'mc_unit':
			case 'storage_size':
			case 'number_of_responses':
				cb(bAA ? undefined : op + ' in non-AA');
				break;

			case 'params':
				if (!bAA)
					return cb("params in non-AA");
				// fall through
			case 'trigger.data':
				// for non-AAs too
				var arrKeys = arr[1];
				async.eachSeries(
					arrKeys,
					function (key, cb2) {
						evaluate(key, cb2);
					},
					cb
				);
				break;

			case 'trigger.output':
				if (!bAA)
					return cb(op + ' in non-AA');
				var comparison_operator = arr[1];
				var asset = arr[2];
				var field = arr[3];
				if (comparison_operator !== '=' && comparison_operator !== '!=')
					return cb(comparison_operator + ' in ' + op);
				if (field !== 'amount' && field !== 'asset')
					return cb('unknown field: ' + field);
				if (typeof asset === 'boolean' || typeof asset === 'number' || Decimal.isDecimal(asset))
					return cb('bad asset: ' + asset);
				if (typeof asset === 'string')
					return cb((asset === 'base' || ValidationUtils.isValidBase64(asset, constants.HASH_LENGTH)) ? undefined : 'invalid asset: ' + asset);
				evaluate(asset, cb);
				break;

			case 'search_param_list':
				var arrPairs = arr[1];
				async.eachSeries(
					arrPairs,
					function (pair, cb2) {
						if (!ValidationUtils.isArrayOfLength(pair, 3))
							return cb2("not array of 3");
						var fields = pair[0];
						var comp = pair[1];
						var value = pair[2];
						if (comp === '==')
							return cb2("wrong comparison operator: " + comp);
						if (!ValidationUtils.isNonemptyArray(fields) || !fields.every(key => typeof key === 'string'))
							return cb2("bad search field: " + fields);
						if (value.type === 'none') {
							if (comp !== '=' && comp !== '!=')
								return cb2("bad comparison for none: " + comp);
							return cb2();
						}
						evaluate(value, cb2);
					},
					cb
				);
				break;

			case 'local_var':
				var var_name_or_expr = arr[1];
				var arrKeys = arr[2];
				if (typeof var_name_or_expr === 'number' || typeof var_name_or_expr === 'boolean' || Decimal.isDecimal(var_name_or_expr))
					return cb('bad var name: ' + var_name_or_expr);
				if (!arrKeys)
					return evaluate(var_name_or_expr, cb);
				async.eachSeries(
					arrKeys,
					function (key, cb2) {
						evaluate(key, cb2);
					},
					function (err) {
						if (err)
							return cb(err);
						evaluate(var_name_or_expr, cb);
					}
				);
				break;

			case 'local_var_assignment':
			case 'state_var_assignment':
			case 'response_var_assignment':
				if (op === 'state_var_assignment' && (!bAA || !bStateVarAssignmentAllowed))
					return cb('state var assignment not allowed here');
				if (op === 'state_var_assignment')
					complexity++;
				var var_name_or_expr = arr[1];
				if (op === 'local_var_assignment') {
					// arr[1] is ['local_var', var_name, selectors]
					if (arr[1][2]) { // selector in assignment.  It is allowed only when accessing a local var
						console.log('selector in local var assignment: ', arr[1][2]);
						return cb('selector in local var assignment: ' + arr[1][2]);
					}
					var_name_or_expr = arr[1][1];
				}
				var rhs = arr[2];
				var assignment_op = arr[3];
				if (typeof var_name_or_expr === 'number' || typeof var_name_or_expr === 'boolean' || Decimal.isDecimal(var_name_or_expr))
					return cb('bad var name: ' + var_name_or_expr);
				if (assignment_op) {
					if (op !== 'state_var_assignment')
						return cb(assignment_op + ' in ' + op);
					if (['=', '+=', '-=', '*=', '/=', '%=', '||='].indexOf(assignment_op) === -1)
						return cb('bad assignment op: ' + assignment_op);
				}
				else if (op === 'state_var_assignment')
					return cb('no assignment op in state var assignment');
				// we can't check local var reassignment without analyzing the code, e.g. if(..) $x=1; else $x=2; is valid
				evaluate(var_name_or_expr, function (err) {
					if (err)
						return cb(err);
					evaluate(rhs, cb);
				});
				break;

			case 'block':
				var arrStatements = arr[1];
				if (!Array.isArray(arrStatements))
					throw Error("statements in {} is not an array");
				async.eachSeries(
					arrStatements,
					function (statement, cb2) {
						evaluate(statement, function (err) {
							if (err)
								return cb2("statement in {} " + statement + " invalid: " + err);
							cb2();
						});
					},
					cb
				);
				break;

			case 'ifelse':
				var test = arr[1];
				var if_block = arr[2];
				var else_block = arr[3];
				evaluate(test, function (err) {
					if (err)
						return cb(err);
					evaluate(if_block, function (err) {
						if (err)
							return cb(err);
						if (!else_block)
							return cb();
						evaluate(else_block, cb);
					});
				});
				break;

			case 'var':
			case 'balance':
				if (!bAA) // we cannot allow even var[aa_address][name] in non-AAs because the var would have to be taken at some past time that corresponds to the unit's last_ball_unit but we know only the current (last) value of the var
					return cb(op + ' in non-AA');
				function isValidVarNameOrAsset(param) {
					if (op === 'var')
						return true;
					if (typeof param !== 'string') // expression
						return true;
					return (param === 'base' || ValidationUtils.isValidBase64(param, constants.HASH_LENGTH));
				}
				complexity++;
				var param1 = arr[1];
				var param2 = arr[2];
				if (Decimal.isDecimal(param1) || typeof param1 === 'boolean')
					return cb('bad param1 ' + param1 + ' in ' + op);
				if (param2 !== null && (Decimal.isDecimal(param2) || typeof param2 === 'boolean'))
					return cb('bad param2 ' + param2 + ' in ' + op);
				evaluate(param1, function (err) {
					if (err)
						return cb(err);
					if (param2 === null) // single argument
						return cb(isValidVarNameOrAsset(param1) ? undefined : 'invalid param1');
					if (typeof param1 === 'string' && !ValidationUtils.isValidAddress(param1))
						return cb('bad param1: ' + param1);
					evaluate(param2, function (err) {
						if (err)
							return cb(err);
						cb(isValidVarNameOrAsset(param2) ? undefined : 'invalid param2');
					});
				});
				break;

			case 'asset':
				complexity++;
				var asset = arr[1];
				var field = arr[2];
				async.eachSeries(
					[asset, field],
					function (param, cb2) {
						if (typeof param === 'boolean' || Decimal.isDecimal(param))
							return cb2("wrong type in asset[]");
						evaluate(param, cb2);
					},
					function (err) {
						if (err)
							return cb(err);
						if (typeof asset === 'string') {
							if (asset !== 'base' && !ValidationUtils.isValidBase64(asset, constants.HASH_LENGTH))
								return cb("bad asset in asset[]: " + asset);
						}
						if (typeof field === 'string' && !objBaseAssetInfo.hasOwnProperty(field))
							return cb("bad field in asset[]: " + field);
						cb();
					}
				);
				break;

			case 'unit':
			case 'definition':
				// for non-AAs too
				complexity++;
				var expr = arr[1];
				var arrKeys = arr[2];
				evaluate(expr, function (err) {
					if (err)
						return cb(err);
					async.eachSeries(
						arrKeys || [],
						function (key, cb2) {
							evaluate(key, cb2);
						},
						cb
					);
				});
				break;
	
			case 'is_valid_signed_package':
				complexity++;
				var signed_package_expr = arr[1];
				var address_expr = arr[2];
				evaluate(signed_package_expr, function (err) {
					if (err)
						return cb(err);
					evaluate(address_expr, cb);
				});
				break;

			case 'is_valid_sig':
				complexity+=1;
				var message = arr[1];
				var pem_key = arr[2];
				var sig = arr[3];
				evaluate(message, function (err) {
					if (err)
						return cb(err);
					evaluate(pem_key, function (err) {
						if (err)
							return cb(err);
						evaluate(sig, cb);
					});
				});
				break;

			case 'vrf_verify':
				complexity+=1;
				var seed = arr[1];
				var proof = arr[2];
				var pem_key = arr[3];
				evaluate(seed, function (err) {
					if (err)
						return cb(err);
					evaluate(pem_key, function (err) {
						if (err)
							return cb(err);
						evaluate(proof, cb);
					});
				});
				break;

			case 'sha256':
				complexity++;
				var expr = arr[1];
				evaluate(expr, function (err) {
					if (err)
						return cb(err);
					var format_expr = arr[2];
					if (format_expr === null || format_expr === 'hex' || format_expr === 'base64' || format_expr === 'base32')
						return cb();
					if (typeof format_expr === 'boolean' || Decimal.isDecimal(format_expr))
						return cb("format of sha256 must be string");
					if (typeof format_expr === 'string')
						return cb("wrong format of sha256: " + format_expr);
					evaluate(format_expr, cb);
				});
				break;

			case 'number_from_seed':
				complexity++;
				if (arr[1].length > 3)
					return cb("too many params in number_from_seed");
				if (typeof arr[1][1] === 'string' || typeof arr[1][2] === 'string')
					return cb("min or max is a string");
				async.eachSeries(
					arr[1],
					function (param, cb2) {
						evaluate(param, cb2);
					},
					cb
				);
				break;

			case 'json_parse':
			case 'is_valid_address':
			case 'is_aa':
				complexity++;
				var expr = arr[1];
			/*	if (typeof expr === 'boolean' || Decimal.isDecimal(expr))
					return cb("bad type in " + op);
				if ((op === 'is_valid_address' || op === 'is_aa') && (typeof expr === 'boolean' || Decimal.isDecimal(expr) || typeof expr === 'string' && !ValidationUtils.isValidAddress(expr)))
					return cb("not valid address literal: " + expr);*/
				evaluate(expr, cb);
				break;
			
			case 'is_integer':
			case 'is_valid_amount':
				var expr = arr[1];
			/*	if (typeof expr === 'string' || typeof expr === 'boolean')
					return cb('bad literal in ' + op);
				if (Decimal.isDecimal(expr)) {
					if (!expr.isInteger())
						return cb('non-int literal in ' + op);
					if (op === 'is_valid_amount' && !expr.isPositive())
						return cb('non-positive literal in is_valid_amount');
					return cb();
				}*/
				evaluate(expr, cb);
				break;

			case 'exists':
			case 'is_array':
			case 'is_assoc':
			case 'array_length':
				var expr = arr[1];
				evaluate(expr, cb);
				break;

			case 'json_stringify':
			case 'typeof':
			case 'length':
			case 'parse_date':
			case 'to_upper':
			case 'to_lower':
				var expr = arr[1];
				evaluate(expr, cb);
				break;

			case 'starts_with':
			case 'ends_with':
			case 'contains':
			case 'index_of':
				var str = arr[1];
				var sub = arr[2];
				evaluate(str, function (err) {
					if (err)
						return cb(err);
					evaluate(sub, cb);
				});
				break;

			case 'substring':
				var str = arr[1];
				var start = arr[2];
				var length = arr[3];
				if (typeof start === 'string' || typeof length === 'string')
					return cb("start and length in substring cannot be strings");
				evaluate(str, function (err) {
					if (err)
						return cb(err);
					evaluate(start, function (err) {
						if (err)
							return cb(err);
						length ? evaluate(length, cb) : cb();
					});
				});
				break;

			case 'timestamp_to_string':
				var ts = arr[1];
				var format = arr[2];
				if (typeof ts === 'string')
					return cb("timestamp cannot be string");
				if (format) {
					if (typeof format === 'boolean' || Decimal.isDecimal(format))
						return cb("format must be string");
					if (typeof format === 'string' && format !== 'date' && format !== 'time' && format !== 'datetime')
						return cb("format must be date or time or datetime");
				}
				evaluate(ts, function (err) {
					if (err)
						return cb(err);
					format ? evaluate(format, cb) : cb();
				});
				break;

			case 'response_unit':
				cb(bAA && bStatementsOnly && bStateVarAssignmentAllowed ? undefined : 'response_unit not allowed here');
				break;

			case 'bounce':
				// can be used in non-statements-only formulas and non-AAs too
				var expr = arr[1];
				evaluate(expr, cb);
				break;

			case 'return':
				// can be used in non-statements-only formulas and non-AAs too
				var expr = arr[1];
				if (expr === null)
					return cb(bStatementsOnly ? undefined : 'return; not allowed here');
				if (bStatementsOnly)
					return cb('return value; not allowed here');
				evaluate(expr, cb);
				break;

			case 'main':
				var arrStatements = arr[1];
				var expr = arr[2];
				if (!Array.isArray(arrStatements))
					throw Error("statements is not an array");
				if (bStatementsOnly && expr)
					return cb('should be statements only');
				if (!bStatementsOnly && !expr)
					return cb('result missing');
				async.eachSeries(
					arrStatements,
					function (statement, cb2) {
						evaluate(statement, function (err) {
							if (err)
								return cb2("statement " + statement + " invalid: " + err);
							cb2();
						});
					},
					function (err) {
						if (err)
							return cb(err);
						expr ? evaluate(expr, cb) : cb();
					}
				);
				break;

			default:
				cb('unknown op: ' + op);
				break;
		}
	}

	if (parser.results.length === 1 && parser.results[0]) {
		//	console.log('--- parser result', JSON.stringify(parser.results[0], null, '\t'));
		evaluate(parser.results[0], err => {
			callback({ complexity, count_ops, error: err || false });
		});
	} else {
		if (parser.results.length > 1){
			console.log('validation: ambiguous grammar', JSON.stringify(parser.results));
			callback({ complexity, error: 'ambiguous grammar' });
		}
		else
			callback({complexity, error: 'parser failed'});
	}
};
