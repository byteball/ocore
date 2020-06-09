var nearley = require("nearley");
var grammar = require("./grammars/oscript.js");
var async = require('async');
var _ = require('lodash');
var ValidationUtils = require("../validation_utils.js");
var constants = require('../constants');

var cache = require('./common.js').cache;
var formulasInCache = require('./common.js').formulasInCache;
var cacheLimit = require('./common.js').cacheLimit;

var Decimal = require('./common.js').Decimal;
var objBaseAssetInfo = require('./common.js').objBaseAssetInfo;

var isFiniteDecimal = require('./common.js').isFiniteDecimal;
var toDoubleRange = require('./common.js').toDoubleRange;
var assignObject = require('./common.js').assignObject;
var isValidValue = require('./common.js').isValidValue;

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

function finalizeLocals(locals) {
	for (var name in locals)
		if (name !== '' && locals[name].state === 'maybe assigned')
			locals[name].state = 'assigned';
}


exports.validate = function (opts, callback) {
	//	complexity++;
	var formula = opts.formula;
	var bStateVarAssignmentAllowed = opts.bStateVarAssignmentAllowed;
	var bStatementsOnly = opts.bStatementsOnly;
	var bGetters = opts.bGetters;
	var bAA = opts.bAA;
	var complexity = opts.complexity;
	var count_ops = opts.count_ops;
	var mci = opts.mci;
	var locals = opts.locals;
	if (!locals)
		throw Error("no locals");
	finalizeLocals(locals);
	var readGetterProps = opts.readGetterProps;

	if (!readGetterProps && bAA)
		throw Error("no readGetterProps callback");
	if (bGetters && !bStatementsOnly)
		throw Error("getters must be statements-only");
	
	var bInFunction = false;
	var bInIf = false;
	var bHadReturn = false;

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

	function evaluate(arr, cb, bTopLevel) {
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
				if (arr[1].length === 0)
					return cb("no arguments of " + op);
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
				if (bAA)
					return cb(op + ' in AA');
				if (bGetters)
					return cb(op + ' in getters');
			case 'attestation':
				if (op === 'attestation')
					complexity++;
				var params = arr[1];
				var field = arr[2];
				var err = (op === 'attestation') ? getAttestationError(params) : getInputOrOutputError(params);
				if (err)
					return cb(op + ' not valid: ' + err);
				if (op === 'input' || op === 'output') {
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
			case 'number_of_responses':
				if (bGetters)
					return cb(op + ' in getters');
			case 'storage_size':
				cb(bAA ? undefined : op + ' in non-AA');
				break;

			case 'params':
				if (!bAA)
					return cb("params in non-AA");
				cb();
				break;
			
			case 'trigger.data':
				// for non-AAs too
				if (bGetters)
					return cb(op + ' in getters');
				cb();
				break;

			case 'trigger.output':
				if (!bAA)
					return cb(op + ' in non-AA');
				if (bGetters)
					return cb(op + ' in getters');
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
						if (value.value === 'none') {
							if (comp !== '=' && comp !== '!=')
								return cb2("bad comparison for none: " + comp);
							return cb2();
						}
						evaluate(value, cb2);
					},
					cb
				);
				break;

			case 'array':
				if (mci < constants.aa2UpgradeMci)
					return cb("arrays not activated yet");
				var arrItems = arr[1];
				async.eachSeries(arrItems, evaluate, cb);
				break;

			case 'dictionary':
				if (mci < constants.aa2UpgradeMci)
					return cb("dictionaries not activated yet");
				var arrPairs = arr[1];
				var obj = {};
				async.eachSeries(
					arrPairs,
					function (pair, cb2) {
						if (!ValidationUtils.isArrayOfLength(pair, 2))
							return cb2("not an array of 2");
						var key = pair[0];
						if (typeof key !== 'string')
							return cb2("dictionary keys must be strings");
						if (obj.hasOwnProperty(key))
							return cb2("key " + key + " already set");
						obj[key] = true;
						evaluate(pair[1], cb2);	
					},
					cb
				);
				break;

			case 'local_var':
				var var_name_or_expr = arr[1];
				var arrKeys = arr[2];
				if (typeof var_name_or_expr === 'number' || typeof var_name_or_expr === 'boolean' || Decimal.isDecimal(var_name_or_expr))
					return cb('bad var name: ' + var_name_or_expr);
				if (typeof var_name_or_expr === 'string') {
					if (mci < constants.aa2UpgradeMci && var_name_or_expr[0] === '_')
						return cb("leading underscores not allowed in var names yet");
					if (mci >= constants.aa2UpgradeMci) {
						var bExists = locals.hasOwnProperty(var_name_or_expr);
						if (!locals[''] && !bExists)
							return cb("uninitialized local var " + var_name_or_expr);
						if (bExists && locals[var_name_or_expr].type === 'func')
							return cb("trying to access function " + var_name_or_expr + " without calling it");
					}
				}
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
				var var_name_or_expr = arr[1];
				var rhs = arr[2];
				var selectors = arr[3];
				if (selectors && mci < constants.aa2UpgradeMci)
					return cb("selectors in assignment not enabled yet");
				if (typeof var_name_or_expr === 'number' || typeof var_name_or_expr === 'boolean' || Decimal.isDecimal(var_name_or_expr))
					return cb('bad var name: ' + var_name_or_expr);
				// we can't check local var reassignment without analyzing the code, e.g. if(..) $x=1; else $x=2; is valid
				evaluate(var_name_or_expr, function (err) {
					if (err)
						return cb(err);
					var bLiteral = (typeof var_name_or_expr === 'string');
					var var_name = bLiteral ? var_name_or_expr : ''; // special name for calculated var names
					var bExists = locals.hasOwnProperty(var_name);
					if (mci >= constants.aa2UpgradeMci && bLiteral) {
						if (var_name_or_expr === '')
							return cb("empty literal local var names not allowed");
						if (bExists) {
							if (locals[var_name].type === 'func')
								return cb("local var " + var_name + " already declared as a function");
							if (locals[var_name].state === 'frozen')
								return cb("local var " + var_name + " is frozen");
							if (locals[var_name].state === 'assigned' && !selectors)
								return cb("local var " + var_name + " already assigned");
							if (locals[var_name].state === 'maybe assigned' && !bInIf && !bHadReturn && !selectors)
								return cb("local var " + var_name + " already conditionally assigned");
						}
						if (!bExists && !locals[''] && selectors)
							return cb("mutating a non-existent var " + var_name);
					}
					var bFuncDeclaration = (rhs[0] === 'func_declaration');
					var bConstant = isValidValue(rhs);
					if (bGetters && !(bInFunction || bFuncDeclaration || bConstant))
						return cb("non-constant top level vars not allowed in getters");
					if (bFuncDeclaration) {
						if (mci < constants.aa2UpgradeMci)
							return cb("functions not activated yet");
						if (!bLiteral)
							return cb("func name must be a string literal");
						if (bExists)
							return cb("func " + var_name + " already declared");
						if (selectors)
							return cb("only top level functions are supported");
						var args = rhs[1];
						var body = rhs[2];
						if (args.indexOf(var_name) >= 0)
							return cb("arg name cannot be the same as func name");
						return parseFunctionDeclaration(args, body, (err, funcProps) => {
							if (err)
								return cb("function " + var_name + ": " + err);
							locals[var_name] = { props: funcProps, type: 'func' };
							cb();
						});
					}
					evaluate(rhs, function (err) {
						if (err)
							return cb(err);
						var localVarProps = {
							state: bInIf ? 'maybe assigned' : 'assigned',
							type: 'data'
						};
						if (bConstant && !bInIf)
							localVarProps.value = rhs;
						locals[var_name] = localVarProps;
						if (!selectors) // scalar variable
							return cb();
						if (!Array.isArray(selectors))
							return cb("selectors is not an array");
						async.eachSeries(selectors.filter(key => key !== null), evaluate, cb);
					});
				});
				break;

			case 'state_var_assignment':
				if (!bAA || !bStateVarAssignmentAllowed || bGetters)
					return cb('state var assignment not allowed here');
				complexity++;
				var var_name_or_expr = arr[1];
				var rhs = arr[2];
				var assignment_op = arr[3];
				if (typeof var_name_or_expr === 'number' || typeof var_name_or_expr === 'boolean' || Decimal.isDecimal(var_name_or_expr))
					return cb('bad var name: ' + var_name_or_expr);
				if (!assignment_op)
					return cb('no assignment op in state var assignment');
				if (['=', '+=', '-=', '*=', '/=', '%=', '||='].indexOf(assignment_op) === -1)
					return cb('bad assignment op: ' + assignment_op);
				evaluate(var_name_or_expr, function (err) {
					if (err)
						return cb(err);
					evaluate(rhs, cb);
				});
				break;

			case 'response_var_assignment':
				if (bGetters)
					return cb("response var assignment not allowed in getters");
				var var_name_or_expr = arr[1];
				var rhs = arr[2];
				if (typeof var_name_or_expr === 'number' || typeof var_name_or_expr === 'boolean' || Decimal.isDecimal(var_name_or_expr))
					return cb('bad var name: ' + var_name_or_expr);
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
				if (bGetters && !bInFunction)
					return cb("if-else not allowed at top level in getters");
				var test = arr[1];
				var if_block = arr[2];
				var else_block = arr[3];
				evaluate(test, function (err) {
					if (err)
						return cb(err);
					var prev_in_if = bInIf;
					bInIf = true;
					evaluate(if_block, function (err) {
						if (err)
							return cb(err);
						if (!else_block) {
							bInIf = prev_in_if;
							return cb();
						}
						evaluate(else_block, function (err) {
							bInIf = prev_in_if;
							cb(err);
						});
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
				evaluate(expr, cb);
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

			case 'is_valid_merkle_proof':
				complexity++;
				var element = arr[1];
				var proof = arr[2];
				evaluate(element, function (err) {
					if (err)
						return cb(err);
					evaluate(proof, cb);
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
				if (arr[1].length === 0)
					return cb("no arguments of number_from_seed");
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
			case 'chash160':
				if (op === 'chash160' && mci < constants.aa2UpgradeMci)
					return cb("chash160 not activated yet");
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

			case 'keys':
			case 'reverse':
				if (mci < constants.aa2UpgradeMci)
					return cb(op + " function not activated yet");
			case 'exists':
			case 'is_array':
			case 'is_assoc':
			case 'array_length':
				var expr = arr[1];
				evaluate(expr, cb);
				break;

			case 'freeze':
				if (mci < constants.aa2UpgradeMci)
					return cb("freeze statement not activated yet");
				var var_name_expr = arr[1];
				evaluate(var_name_expr, function (err) {
					if (err)
						return cb(err);
					if (typeof var_name_expr === 'string') {
						var bExists = locals.hasOwnProperty(var_name_expr);
						if (!bExists && !locals[''])
							return cb("no such variable: " + var_name_expr);
						if (bExists && locals[var_name_expr].type === 'func')
							return cb("functions cannot be frozen");
						if (!bInIf)
							locals[var_name_expr].state = 'frozen';
					}
					cb();
				});
				break;

			case 'delete':
				if (mci < constants.aa2UpgradeMci)
					return cb("delete statement not activated yet");
				var var_name_expr = arr[1];
				var selectors = arr[2];
				var key = arr[3];
				evaluate(var_name_expr, function (err) {
					if (err)
						return cb(err);
					if (typeof var_name_expr === 'string') {
						var bExists = locals.hasOwnProperty(var_name_expr);
						if (!bExists && !locals[''])
							return cb("no such variable: " + var_name_expr);
						if (bExists && locals[var_name_expr].state === 'frozen')
							return cb("var " + var_name_expr + " is frozen");
						if (bExists && locals[var_name_expr].type === 'func')
							return cb("functions cannot be deleted");
					}
					if (!Array.isArray(selectors))
						return cb("selectors is not an array");
					evaluate(key, function (err) {
						if (err)
							return cb(err);
						async.eachSeries(selectors, evaluate, cb);
					});
				});
				break;

			case 'foreach':
			case 'map':
			case 'filter':
			case 'reduce':
				if (mci < constants.aa2UpgradeMci)
					return cb(op + " not activated yet");
				var expr = arr[1];
				var count_expr = arr[2];
				var func_expr = arr[3];
				var initial_value_expr = arr[4];
				
				readCount(count_expr, (err, count) => {
					if (err)
						return cb(err);
					readFuncProps(func_expr, (err, funcProps) => {
						if (err)
							return cb(err);
						if (op !== 'reduce' && funcProps.count_args !== 1 && funcProps.count_args !== 2)
							return cb("callback function must have 1 or 2 arguments");
						if (op === 'reduce' && funcProps.count_args !== 2 && funcProps.count_args !== 3)
							return cb("callback function must have 2 or 3 arguments");
						complexity += (funcProps.complexity === 0) ? 1 : count * funcProps.complexity;
						count_ops += count * funcProps.count_ops;
						if (op !== 'reduce')
							return evaluate(expr, cb);
						evaluate(expr, err => {
							if (err)
								return cb(err);
							evaluate(initial_value_expr, cb);
						})
					});
				});
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

			case 'has_only':
				if (mci < constants.aa2UpgradeMci)
					return cb(op + " not activated yet");
				complexity++;
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
				if ((typeof start === 'string' || typeof length === 'string') && mci < constants.aa2UpgradeMci)
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

			case 'replace':
				if (mci < constants.aa2UpgradeMci)
					return cb("replace function not supported yet");
				var str = arr[1];
				var search_str = arr[2];
				var replacement = arr[3];
				evaluate(str, function (err) {
					if (err)
						return cb(err);
					evaluate(search_str, function (err) {
						if (err)
							return cb(err);
						evaluate(replacement, cb);
					});
				});
				break;

			case 'split':
			case 'join':
				if (mci < constants.aa2UpgradeMci)
					return cb(op + " not activated yet");
				var p1 = arr[1];
				var separator = arr[2];
				var limit = arr[3];
				evaluate(p1, function (err) {
					if (err)
						return cb(err);
					if (!limit)
						return evaluate(separator, cb);
					evaluate(separator, function (err) {
						if (err)
							return cb(err);
						evaluate(limit, cb);
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
				cb(bAA && bStateVarAssignmentAllowed && !bGetters ? undefined : 'response_unit not allowed here');
				break;

			case 'func_call':
				if (mci < constants.aa2UpgradeMci)
					return cb("funcs not activated yet");
				var func_name = arr[1];
				var arrExpressions = arr[2];
				if (!locals.hasOwnProperty(func_name))
					return cb("no such function name: " + func_name);
				if (locals[func_name].type !== 'func')
					return cb("not a function: " + func_name);
				var func = locals[func_name].props;
				if (func.count_args < arrExpressions.length)
					return cb("excessive arguments to func " + func_name);
				console.log('func', func)
				complexity += func.complexity;
				count_ops += func.count_ops;
				async.eachSeries(
					arrExpressions,
					function (expr, cb2) {
						evaluate(expr, function (err) {
							if (err)
								return cb2("expr " + expr + " invalid: " + err);
							cb2();
						});
					},
					cb
				);
				break;
				
			case 'remote_func_call':
				if (!bAA)
					return cb("remote func call allowed in AAs only");
				if (mci < constants.aa2UpgradeMci)
					return cb("getter funcs not activated yet");
				var remote_aa = arr[1];
				var func_name = arr[2];
				var arrExpressions = arr[3];
				var res = parseRemoteAA(remote_aa);
				if (res.error)
					return cb(res.error);
				remote_aa = res.remote_aa;
				readGetterProps(remote_aa, func_name, getter => {
					if (!getter)
						return cb("no such getter: " + remote_aa + ".$" + func_name + "()");
					if (typeof getter.complexity !== 'number' || typeof getter.count_ops !== 'number' || (typeof getter.count_args !== 'number' && getter.count_args !== null))
						throw Error("invalid getter in " + remote_aa + ".$" + func_name + ": " + JSON.stringify(getter));
					if (getter.count_args !== null && arrExpressions.length > getter.count_args)
						return cb("getter " + func_name + " expects " + getter.count_args + " args, got " + arrExpressions.length);
					complexity += getter.complexity + 1;
					count_ops += getter.count_ops;
					async.eachSeries(
						arrExpressions,
						function (expr, cb2) {
							evaluate(expr, function (err) {
								if (err)
									return cb2("expr " + expr + " invalid: " + err);
								cb2();
							});
						},
						cb
					);
				});
				break;
				
			case 'with_selectors':
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
		
			case 'bounce':
				// can be used in non-statements-only formulas and non-AAs too
				if (bGetters && !bInFunction)
					return cb("bounce not allowed at top level in getters");
				var expr = arr[1];
				evaluate(expr, cb);
				break;

			case 'return':
				// can be used in non-statements-only formulas and non-AAs too
				if (bGetters && !bInFunction)
					return cb("return not allowed at top level in getters");
				var expr = arr[1];
				bHadReturn = true;
				if (expr === null)
					return cb((bStatementsOnly || bInFunction) ? undefined : 'return; not allowed here');
				if (bStatementsOnly && !bInFunction)
					return cb('return value; not allowed here');
				evaluate(expr, cb);
				break;

			case 'main':
				var arrStatements = arr[1];
				var expr = arr[2];
				if (!Array.isArray(arrStatements))
					throw Error("statements is not an array");
				if (bTopLevel) {
					if (bStatementsOnly && expr)
						return cb('should be statements only');
					if (!bStatementsOnly && !expr)
						return cb('result missing');
				}
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

	function parseFunctionDeclaration(args, body, cb) {
		var scopeVarNames = Object.keys(locals);
		if (_.intersection(args, scopeVarNames).length > 0)
			return cb("some args would shadow some local vars");
		var count_args = args.length;
		var saved_complexity = complexity;
		var saved_count_ops = count_ops;
		var saved_sva = bStateVarAssignmentAllowed;
		var saved_locals = _.cloneDeep(locals);
		complexity = 0;
		count_ops = 0;
		//	bStatementsOnly is ignored in functions
		bStateVarAssignmentAllowed = true;
		bInFunction = true;
		// if a var was conditinally assigned, treat it as assigned when parsing the function body
		finalizeLocals(locals);
		// arguments become locals within function body
		args.forEach(name => {
			locals[name] = { state: 'assigned', type: 'data' };
		});
		evaluate(body, function (err) {
			if (err)
				return cb(err);
			var funcProps = { complexity, count_args, count_ops };
			// restore the saved values
			complexity = saved_complexity;
			count_ops = saved_count_ops;
			bStateVarAssignmentAllowed = saved_sva;
			bInFunction = false;
			assignObject(locals, saved_locals);

			if (funcProps.complexity > constants.MAX_COMPLEXITY)
				return cb("function exceeds complexity: " + funcProps.complexity);
			cb(null, funcProps);
		});
	}

	function readFuncProps(func_expr, cb) {
		if (func_expr[0] === 'local_var') {
			var var_name = func_expr[1];
			if (typeof var_name !== 'string')
				return cb("only literal var names allowed in func expression");
			if (!locals.hasOwnProperty(var_name))
				return cb("no such func: " + var_name);
			if (locals[var_name].type !== 'func')
				return cb("not a function: " + var_name);
			var props = locals[var_name].props;
			cb(null, props);
		}
		else if (func_expr[0] === 'func_declaration') {
			var arglist = func_expr[1];
			var body = func_expr[2];
			parseFunctionDeclaration(arglist, body, cb);
		}
		else if (func_expr[0] === 'remote_func') {
			var remote_aa = func_expr[1];
			var func_name = func_expr[2];
			var res = parseRemoteAA(remote_aa);
			if (res.error)
				return cb(res.error);
			remote_aa = res.remote_aa;
			readGetterProps(remote_aa, func_name, getter => {
				if (!getter)
					return cb("no such getter: " + remote_aa + ".$" + func_name + "()");
				if (typeof getter.complexity !== 'number' || typeof getter.count_ops !== 'number' || (typeof getter.count_args !== 'number' && getter.count_args !== null))
					throw Error("invalid getter in " + remote_aa + ".$" + func_name + ": " + JSON.stringify(getter));
				getter.complexity++; // for remote call
				cb(null, getter);
			});
		}
		else
			throw Error("unrecognized func expression");
	}

	function readCount(count_expr, cb) {
		var count;
		if (Decimal.isDecimal(count_expr))
			count = count_expr.toNumber();
		else if (typeof count_expr === 'object') {
			if (count_expr[0] !== 'local_var')
				return cb("only local vars allowed as count expression: " + count_expr);
			var var_name = count_expr[1];
			if (typeof var_name !== 'string')
				return cb("only literal var names allowed in count expression");
			if (!locals.hasOwnProperty(var_name))
				return cb("no such local var: " + var_name);
			count = locals[var_name].value;
			if (count === undefined)
				return cb("count must be a constant");
			if (!Decimal.isDecimal(count))
				return cb("not decimal: " + count);
			count = count.toNumber();
		}
		else
			throw Error("unrecognized type of count_expr: " + count_expr);
		if (!ValidationUtils.isNonnegativeInteger(count))
			return cb("count in foreach must be a non-negative integer, found " + count);
		if (count > 100)
			return cb("count is too large: " + count);
		cb(null, count);
	}

	function parseRemoteAA(remote_aa) {
		if (typeof remote_aa === 'object' && remote_aa[0] === 'local_var') {
			var var_name = remote_aa[1];
			if (typeof var_name !== 'string')
				return { error: "remote AA var name must be literal" };
			if (!locals.hasOwnProperty(var_name))
				return { error: "remote AA var " + var_name + " does not exist" };
			remote_aa = locals[var_name].value;
			if (remote_aa === undefined)
				return { error: "remote AA var " + var_name + " must be a constant" };
		}
		if (!ValidationUtils.isValidAddress(remote_aa))
			return { error: "not valid AA address: " + remote_aa };
		return { remote_aa };
	}

	if (parser.results.length === 1 && parser.results[0]) {
		//	console.log('--- parser result', JSON.stringify(parser.results[0], null, '\t'));
		evaluate(parser.results[0], err => {
			finalizeLocals(locals);
			callback({ complexity, count_ops, error: err || false });
		}, true);
	} else {
		if (parser.results.length > 1){
			console.log('validation: ambiguous grammar', JSON.stringify(parser.results));
			callback({ complexity, error: 'ambiguous grammar' });
		}
		else
			callback({complexity, error: 'parser failed'});
	}
};
