/*jslint node: true */
"use strict";

var _ = require('lodash');
var async = require('async');
var constants = require('./constants.js');
var objectHash = require("./object_hash.js");
var ValidationUtils = require("./validation_utils.js");
var formulaValidator = require('./formula/validation.js');
var getFormula = require('./formula/common.js').getFormula;
var hasCases = require('./formula/common.js').hasCases;

var hasFieldsExcept = ValidationUtils.hasFieldsExcept;
var isStringOfLength = ValidationUtils.isStringOfLength;
var isNonemptyString = ValidationUtils.isNonemptyString;
var isInteger = ValidationUtils.isInteger;
var isNonnegativeInteger = ValidationUtils.isNonnegativeInteger;
var isPositiveInteger = ValidationUtils.isPositiveInteger;
var isNonemptyArray = ValidationUtils.isNonemptyArray;
var isNonemptyObject = ValidationUtils.isNonemptyObject;
var isArrayOfLength = ValidationUtils.isArrayOfLength;
var isValidAddress = ValidationUtils.isValidAddress;
var isValidBase64 = ValidationUtils.isValidBase64;

var MAX_DEPTH = 100;

function validateAADefinition(arrDefinition, readGetterProps, mci, callback) {


	function validateMessage(message, cb) {

		function validatePayload(payload, cb2) {

			function validateAttestors(attestors, cb3) {
				if (isNonemptyString(attestors)) {
					var f = getFormula(attestors);
					if (f === null)
						return cb3("attestors is a string but not formula: " + attestors);
					return cb3();
				}
				if (!isNonemptyArray(attestors))
					return cb3("wrong attestors: " + attestors);
				for (var i = 0; i < attestors.length; i++) {
					var attestor = attestors[i];
					if (!isNonemptyString(attestor))
						return cb3("bad attestor: " + attestor);
					if (!isValidAddress(attestor)) {
						var f = getFormula(attestor);
						if (f === null)
							return cb3("bad formula in attestor");
					}
				}
				cb3();
			}

			if (message.app !== 'text' && isNonemptyString(payload)) {
				var payload_formula = getFormula(payload);
				if (payload_formula === null)
					return cb2("payload is a string but doesn't look like a formula: " + payload);
				return cb2();
			}

			if (['payment', 'asset', 'asset_attestors', 'attestation', 'poll', 'vote'].indexOf(message.app) >= 0) {
				if ('init' in payload) {
					if (!isNonemptyString(payload.init))
						return cb2("bad init: " + payload.init);
					var f = getFormula(payload.init);
					if (f === null)
						return cb2("init is not a formula: " + payload.init);
				}
			}

			switch (message.app) {
				case 'profile':
				case 'data':
					if (!isNonemptyObject(payload))
						return cb2('payload of app=' + message.app + ' must be non-empty object or formula: ' + payload);
					cb2();
					break;

				case 'data_feed':
					if (!isNonemptyObject(payload))
						return cb2("data feed payload must be non-empty object or formula");
					for (var feed_name in payload) {
						var feed_name_formula = getFormula(feed_name);
						if (feed_name_formula === null) {
							if (feed_name.length > constants.MAX_DATA_FEED_NAME_LENGTH)
								return cb2("feed name " + feed_name + " too long");
							if (feed_name.indexOf('\n') >= 0)
								return cb2("feed name " + feed_name + " contains \\n");
						}
						var value = payload[feed_name];
						if (typeof value === 'string') {
							var value_formula = getFormula(value);
							if (value_formula === null) {
								if (value.length > constants.MAX_DATA_FEED_VALUE_LENGTH)
									return cb2("value " + value + " too long");
								if (value.indexOf('\n') >= 0)
									return cb2("value " + value + " of feed name " + feed_name + " contains \\n");
							}
						}
						else if (typeof value === 'number') {
							if (!isInteger(value))
								return cb2("fractional numbers not allowed in data feeds");
						}
						else
							return cb2("data feed " + feed_name + " must be string or number");
					}
					cb2();
					break;

				case 'payment':
				//	console.log('---payment', payload);
					if (hasFieldsExcept(payload, ['asset', 'outputs', 'init']))
						return cb2("foreign fields in payment");
					if ('asset' in payload) {
						if (!isNonemptyString(payload.asset))
							return cb2("bad asset: " + payload.asset);
						if (payload.asset !== 'base' && !isValidBase64(payload.asset, constants.HASH_LENGTH)) {
							var asset_formula = getFormula(payload.asset);
							if (asset_formula === null)
								return cb2("bad asset in payment: " + payload.asset);
						}
					}

					function validateOutputs(outputs, cb3) {
						if (!isNonemptyArray(outputs))
							return cb3("bad outputs");
						var bHaveSendAll = false;
						for (var i = 0; i < outputs.length; i++) {
							var output = outputs[i];
							if (isNonemptyString(output)) {
								var output_formula = getFormula(output);
								if (output_formula === null)
									return cb3("bad output formula: " + output);
								continue;
							}
							if (hasFieldsExcept(output, ['address', 'amount', 'init', 'if']))
								return cb3('foreign fields in output');
							if ('if' in output) {
								if (!isNonemptyString(output.if))
									return cb3("bad if in output: " + output.if);
								var f = getFormula(output.if);
								if (f === null)
									return cb3("if in output is not a formula: " + output.if);
							}
							if ('init' in output) {
								if (!isNonemptyString(output.init))
									return cb3("bad init in output: " + output.init);
								var f = getFormula(output.init);
								if (f === null)
									return cb3("init in output is not a formula: " + output.init);
							}
							if (!isNonemptyString(output.address))
								return cb3('address not a string: ' + output.address);
							var f = getFormula(output.address);
							if (f !== null) {
							}
							else if (!isValidAddress(output.address))
								return cb3("bad address: "+output.address);
							if (typeof output.amount === 'number') {
								if (!isPositiveInteger(output.amount) || output.amount > constants.MAX_CAP)
									return cb3('bad amount number: ' + output.amount);
							}
							else if (typeof output.amount === 'string') {
								var f = getFormula(output.amount);
								if (f === null)
									return cb3("bad formula in amount: " + output.amount);
							}
							else if (typeof output.amount === 'undefined') {
								if (bHaveSendAll)
									return cb3("a second send-all output");
								bHaveSendAll = true;
							}
							else
								return cb3('bad amount: ' + output.amount);
						}
						cb3();
					}

					validateFieldWrappedInCases(payload, 'outputs', validateOutputs, function (err) {
					//	console.log('---- after outputs', err);
						if (err)
							return cb2(err);
						cb2();
					});
					break;

				case 'text':
					if (!isNonemptyString(payload))
						return cb2("bad text: " + payload);
					cb2();
					break;

				case 'definition':
					if (mci >= constants.aa2UpgradeMci && getFormula(payload.definition) !== null)
						return cb2();
					if (!isArrayOfLength(payload.definition, 2))
						return cb2("definition must be array of 2");
					if (hasFieldsExcept(payload, ['definition']))
						return cb2("unknown fields in AA definition in AA");
					if (payload.definition[0] !== 'autonomous agent')
						return cb2('not an AA in nested AA definition');
					if (mci >= constants.aa2UpgradeMci && getFormula(payload.definition[1]) !== null)
						return cb2();
					if (!isNonemptyObject(payload.definition[1]))
						return cb2('empty nested definition');
					cb2();
				//	(typeof setImmediate === 'function') ? setImmediate(validateAADefinition, payload.definition, cb2) : setTimeout(validateAADefinition, 0, payload.definition, cb2); // interrupt the call stack to protect against deep nesting
					break;

				case 'asset':
					if (hasFieldsExcept(payload, ["cap", "is_private", "is_transferrable", "auto_destroy", "fixed_denominations", "issued_by_definer_only", "cosigned_by_definer", "spender_attested", "issue_condition", "transfer_condition", "attestors", "denominations", "init"]))
						return cb2("unknown fields in asset definition in AA");
					if (payload.fixed_denominations === true && !isNonemptyArray(payload.denominations))
						return cb2("denominations not defined");
					if ("cap" in payload) {
						if (typeof payload.cap === 'number') {
							if (!(isPositiveInteger(payload.cap) && payload.cap <= constants.MAX_CAP))
								return cb2("invalid cap: " + payload.cap);
						}
						else if (typeof payload.cap === 'string') {
							var f = getFormula(payload.cap);
							if (f === null)
								return cb2("bad formula in cap: " + payload.cap);
						}
						else
							return cb2("wrong cap: " + payload.cap);
					}

					function validateDenominations(denominations, cb3) {
						if (isNonemptyString(denominations)) {
							var f = getFormula(denominations);
							if (f === null)
								return cb3("denominations is a string but not formula: " + attestors);
							return cb3();
						}
						if (!isNonemptyArray(denominations))
							return cb3("wrong denominations: " + denominations);
						if (denominations.length > constants.MAX_DENOMINATIONS_PER_ASSET_DEFINITION)
							return cb3("too many denominations");
						for (var i=0; i<denominations.length; i++){
							var denomInfo = denominations[i];
							if (typeof denomInfo.denomination === 'number') {
								if (!isPositiveInteger(denomInfo.denomination))
									return cb3("invalid denomination");
							}
							else if (typeof denomInfo.denomination === 'string') {
								var f = getFormula(denomInfo.denomination);
								if (f === null)
									return cb3("bad formula in denomination: "+ denomInfo.denomination);
							}
							else
								return cb3("bad denomination " + denomInfo.denomination);
							if ("count_coins" in denomInfo) {
								if (typeof denomInfo.count_coins === 'number') {
									if (!isPositiveInteger(denomInfo.count_coins))
										return cb3("invalid count_coins");
								}
								else if (typeof denomInfo.count_coins === 'string') {
									var f = getFormula(denomInfo.count_coins);
									if (f === null)
										return cb3("bad formula in count_coins: "+ denomInfo.count_coins);
								}
								else
									return cb3("bad count_coins " + denomInfo.count_coins);
							}
						}
						cb3();
					}

					if ("issue_condition" in payload) {
						if (!isArrayOfLength(payload.issue_condition, 2))
							return cb2("wrong issue condition: " + payload.issue_condition);
					}
					if ("transfer_condition" in payload) {
						if (!isArrayOfLength(payload.transfer_condition, 2))
							return cb2("wrong transfer condition: " + payload.transfer_condition);
					}
					if (payload.cosigned_by_definer !== false)
						return cb2("cosigned_by_definer must be false because AA can't cosign");
					if (payload.issued_by_definer_only === true && (payload.is_private !== false || payload.fixed_denominations !== false))
						return cb2("asset issued by AA definer cannot be private or fixed denominations");
					async.eachSeries(
						["is_private", "is_transferrable", "auto_destroy", "fixed_denominations", "issued_by_definer_only", "cosigned_by_definer", "spender_attested"],
						function (field, cb3) {
							if (typeof payload[field] === 'boolean')
								return cb3();
							if (typeof payload[field] === 'string') {
								var f = getFormula(payload[field]);
								if (f === null)
									return cb3("bad formula for " + field + " in asset");
								return cb3();
							}
							cb3(field + " is missing or of wrong type");
						},
						function (err) {
							if (err)
								return cb2(err);
							async.series([
								function (cb3) {
									if (!("attestors" in payload))
										return cb3();
									validateFieldWrappedInCases(payload, 'attestors', validateAttestors, cb3);
								},
								function (cb3) {
									if (!("denominations" in payload))
										return cb3();
									validateFieldWrappedInCases(payload, 'denominations', validateDenominations, cb3);
								}
							],
							function (err) {
								if (err)
									return cb2(err);
								cb2();
							});
						}
					);
					break;

				case 'asset_attestors':
					if (hasFieldsExcept(payload, ['asset', 'attestors', 'init']))
						return cb2("foreign fields in attestor list update");
					if (!isNonemptyString(payload.asset))
						return cb2("asset is not a string");
					var asset_formula = getFormula(payload.asset);
					if (asset_formula !== null) {
					}
					else if (!isValidBase64(payload.asset, constants.HASH_LENGTH))
						return cb2("bad asset in asset_attestors: " + payload.asset);
					validateFieldWrappedInCases(payload, 'attestors', validateAttestors, function (err) {
						if (err)
							return cb2(err);
						cb2();
					});
					break;

				case 'attestation':
					if (hasFieldsExcept(payload, ["address", "profile", "init"]))
						return cb2("unknown fields in AA attestation");
					if (!isNonemptyObject(payload.profile))
						return cb2('bad attested profile' + payload.profile);
					if (!isNonemptyString(payload.address))
						return cb2("bad attested address: " + payload.address);
					var address_formula = getFormula(payload.address);
					if (address_formula !== null) {
					}
					else if (!isValidAddress(payload.address))
						return cb2("bad address in attestation: " + payload.address);
					cb2();
					break;

				case 'poll':
					if (!isNonemptyObject(payload))
						return cb2("poll payload must be a non-empty object");
					if (hasFieldsExcept(payload, ["question", "choices", 'init']))
						return cb2("unknown fields in AA poll");
					if (!isNonemptyString(payload.question))
						return cb2("bad question in AA poll: " + payload.question);

					function validateChoices(choices, cb3) {
						if (isNonemptyString(choices)) {
							var f = getFormula(choices);
							if (f === null)
								return cb3("choices is a string but not formula: " + attestors);
							return cb3();
						}
						if (!isNonemptyArray(choices))
							return cb3("no choices in AA poll");
						if (choices.length > constants.MAX_CHOICES_PER_POLL)
							return cb3("too many choices in AA poll");
						for (var i = 0; i < choices.length; i++) {
							if (typeof choices[i] !== 'string')
								return cb3("all choices must be strings");
							if (choices[i].trim().length === 0)
								return cb3("all choices must be longer than 0 chars");
							var choice_formula = getFormula(choices[i]);
							if (choice_formula !== null) {
							}
							else if (choices[i].length > constants.MAX_CHOICE_LENGTH)
								return cb3("all choices must be " + constants.MAX_CHOICE_LENGTH + " chars or less");
						}
						cb3();
					}

					validateFieldWrappedInCases(payload, 'choices', validateChoices, function (err) {
						if (err)
							return cb2(err);
						cb2();
					});
					break;

				case 'vote':
					if (hasFieldsExcept(payload, ["unit", "choice", 'init']))
						return cb2("unknown fields in AA vote");
					if (!isNonemptyString(payload.unit))
						return cb2("AA vote unit must be string");
					if (!isNonemptyString(payload.choice))
						return cb2("AA vote choice must be string");
					var unit_formula = getFormula(payload.unit);
					if (unit_formula !== null) {
					}
					else if (!isValidBase64(payload.unit, constants.HASH_LENGTH))
						return cb2("AA vote bad unit: "+payload.unit);
					cb2();
					break;

				case 'definition_template':
					if (!ValidationUtils.isArrayOfLength(payload, 2))
						return cb2("AA definition_template must be array of two elements");
					cb2();
					break;

				default:
					cb2("unsupported app in AA: " + message.app);
			}
		}

		if (mci >= constants.aa2UpgradeMci && typeof message === 'string')
			return cb();
		if (message.app === 'state') {
			var f = getFormula(message.state);
			if (f === null)
				return cb('bad state formula: ' + message.state);
			return cb();
		}
		validateFieldWrappedInCases(message, 'payload', validatePayload, cb);
	}

	function validateMessages(messages, cb) {
		if (!Array.isArray(messages))
			return cb("bad messages in AA");
		for (var i = 0; i < messages.length; i++){
			var message = messages[i];
			if (mci >= constants.aa2UpgradeMci && typeof message === 'string') {
				var f = getFormula(message);
				if (f === null)
					return cb("bad message formula: " + message);
				continue;
			}
			if (['payment', 'data', 'data_feed', 'definition', "asset", "asset_attestors", "attestation", "poll", "vote", 'text', 'profile', 'definition_template', 'state'].indexOf(message.app) === -1)
				return cb("bad app: " + message.app);
			if (message.app === 'state') {
				if (hasFieldsExcept(message, ['app', 'state', 'if', 'init']))
					return cb("foreign fields in state message");
				if (!('state' in message))
					return cb("no state in message");
				if (i !== messages.length - 1)
					return cb("state message must be last");
			}
			else {
				if (hasFieldsExcept(message, ['app', 'payload', 'if', 'init']))
					return cb("foreign fields in payload message");
				if (!('payload' in message))
					return cb("no payload in message");
			}
			if ('if' in message && !isNonemptyString(message.if))
				return cb('bad if in message: '+message.if);
			if ('init' in message && !isNonemptyString(message.init))
				return cb('bad init in message: '+message.init);
		}
		async.eachSeries(messages, validateMessage, cb);
	}

	function validateFieldWrappedInCases(obj, field, validateField, cb, depth) {
		if (!depth)
			depth = 0;
		if (depth > MAX_DEPTH)
			return cb("cases for " + field + " go too deep");
		var value = obj.hasOwnProperty(field) ? obj[field] : undefined;
		var bCases = hasCases(value);
		if (!bCases)
			return validateField(value, cb);
		var cases = value.cases;
		for (var i = 0; i < cases.length; i++){
			var acase = cases[i];
			if (hasFieldsExcept(acase, [field, 'if', 'init']))
				return cb('foreign fields in case ' + i + ' of ' + field);
			if (!acase.hasOwnProperty(field))
				return cb('case ' + i + ' has no field ' + field);
			if ('if' in acase && !isNonemptyString(acase.if))
				return cb('bad if in case: ' + acase.if);
			if (!('if' in acase) && i < cases.length - 1)
				return cb('if required in all but the last cases');
			if ('init' in acase && !isNonemptyString(acase.init))
				return cb('bad init in case: ' + acase.init);
		}
		async.eachSeries(
			cases,
			function (acase, cb2) {
				async.eachSeries(
					['if', 'init'],
					function (key, cb3) {
						if (!acase.hasOwnProperty(key))
							return cb3();
						var f = getFormula(acase[key]);
						if (f === null)
							return cb3("not a formula in " + key);
						cb3();
					},
					function (err) {
						if (err)
							return cb2(err);
						validateFieldWrappedInCases(acase, field, validateField, cb2, depth + 1);
					}
				);
			},
			cb
		);
	}

	function validateFormula(aa_opts, cb) {
		if (typeof aa_opts.formula !== 'string' || !aa_opts.locals)
			throw Error("bad opts in validateFormula: " + JSON.stringify(aa_opts));
		var opts = {
			formula: aa_opts.formula,
			complexity: complexity,
			count_ops: count_ops,
			bAA: true,
			bStatementsOnly: aa_opts.bStatementsOnly || false,
			bGetters: aa_opts.bGetters || false,
			bStateVarAssignmentAllowed: aa_opts.bStateVarAssignmentAllowed || false,
			locals: aa_opts.locals,
			readGetterProps: readGetterProps,
			mci: mci,
		};
		if (constants.bTestnet && opts.bStatementsOnly && (mci === 1027249 && objectHash.getChash160(arrDefinition) === 'IUSWVQLBVRCXJ3W23JUQG5NNVJ3K4BJY' || mci === 1034656 && objectHash.getChash160(arrDefinition) === 'VACU4WDHOXCKXVEQ4K2XPBCZC2IA56LC'))
			opts.formula = opts.formula.replace('elsevar', 'else var').replace('elseresponse', 'else response');
	//	console.log('--- validateFormula', formula);
		formulaValidator.validate(opts, function (result) {
			if (typeof result.complexity !== 'number' || !isFinite(result.complexity))
				throw Error("bad complexity after " + opts.formula + ": " + result.complexity);
			complexity = result.complexity;
			count_ops = result.count_ops;
			if (result.error) {
				var errorMessage = "validation of formula " + opts.formula + " failed: " + result.error
				errorMessage += result.errorMessage ? `\nparser error: ${result.errorMessage}` : ''
				return cb(errorMessage);
			}
			if (complexity > constants.MAX_COMPLEXITY)
				return cb('complexity exceeded: ' + complexity);
			if (count_ops > constants.MAX_OPS)
				return cb('number of ops exceeded: ' + count_ops);
			cb();
		});
	}

	function validateDefinition(arrDefinition, cb) {
		var locals = {};
		var f = getFormula(arrDefinition[1].getters);
		if (f === null) // no getters
			return validate(arrDefinition, 1, '', locals, 0, cb);
		// validate getters before everything else as they can define a few functions
		delete arrDefinition[1].getters;
		var opts = {
			formula: f,
			locals: locals,
			bStatementsOnly: true,
			bGetters: true,
		};
		validateFormula(opts, function (err) {
			if (err)
				return cb(err);
			getters = getGettersFromLocals(locals);
			validate(arrDefinition, 1, '', locals, 0, cb);
		});
	}

	function validate(obj, name, path, locals, depth, cb, bValueOnly) {
		if (depth > MAX_DEPTH)
			return cb("max depth reached");
		count++;
		if (count % 100 === 0) // interrupt the call stack
			return setImmediate(validate, obj, name, path, locals, depth, cb, bValueOnly);
		locals = _.cloneDeep(locals);
		var value = obj[name];
		if (typeof name === 'string' && !bValueOnly) {
			var f = getFormula(name);
			if (f !== null) {
				var opts = {
					formula: f,
					locals: _.cloneDeep(locals),
				};
				return validateFormula(opts, function (err) {
					if (err)
						return cb(err);
					validate(obj, name, path, locals, depth, cb, true);
				});
			}
		}
		if (typeof value === 'number' || typeof value === 'boolean')
			return cb();
		if (typeof value === 'string') {
			var f = getFormula(value);
			if (f === null)
				return cb();
		//	console.log('path', path, 'name', name, 'f', f);
			var bStateUpdates = (path === '/messages/state');
			var opts = {
				formula: f,
				locals: locals,
				bStatementsOnly: bStateUpdates,
				bStateVarAssignmentAllowed: bStateUpdates,
			};
			validateFormula(opts, cb);
		}
		// cases are parsed as regular objects with if/init but we need to skip them in path
		else if (hasCases(value)) {
			if (typeof name === 'string')
				path = path.substring(0, path.length - name.length - 1); // strip off the /name
			async.eachOfSeries(
				value.cases,
				function (acase, i, cb2) {
				//	if (hasFieldsExcept(acase, [name, 'if', 'init']))
				//		return cb2('validate: foreign fields in case ' + i + ' of ' + name);
					if (!acase.hasOwnProperty(name))
						return cb2('validate: case ' + i + ' has no field ' + name);
					validate(value.cases, i, path, _.cloneDeep(locals), depth + 1, cb2);
				},
				cb
			);
		}
		else if (typeof value === 'object' && (typeof value.if === 'string' || typeof value.init === 'string')) {
			function evaluateIf(cb2) {
				if (typeof value.if !== 'string')
					return cb2();
				var f = getFormula(value.if);
				if (f === null)
					return cb2("if is not a formula: " + value.if);
				var opts = {
					formula: f,
					locals: locals,
				};
				validateFormula(opts, cb2);
			}
			function evaluateInit(cb2) {
				if (typeof value.init !== 'string')
					return cb2();
				var f = getFormula(value.init);
				if (f === null)
					return cb2("init is not a formula: " + value.init);
				var opts = {
					formula: f,
					locals: locals,
					bStatementsOnly: true,
				};
				validateFormula(opts, cb2);
			}
			evaluateIf(function (err) {
				if (err)
					return cb(err);
				evaluateInit(function (err) {
					if (err)
						return cb(err);
					delete value.if;
					delete value.init;
					validate(obj, name, path, locals, depth, cb);
				})
			});
		}
		else if (Array.isArray(value)) {
			async.eachOfSeries(
				value,
				function (elem, i, cb2) {
					validate(value, i, path, _.cloneDeep(locals), depth + 1, cb2);
				},
				cb
			);
		}
		else if (isNonemptyObject(value)) {
			async.eachSeries(
				Object.keys(value),
				function (key, cb2) {
					validate(value, key, path + '/' + key, _.cloneDeep(locals), depth + 1, cb2);
				},
				cb
			);
		}
		else
			throw Error('unknown type of value in ' + name);
	}


	if (callback === undefined) { // 2 arguments
		callback = readGetterProps;
		mci = Number.MAX_SAFE_INTEGER;
		readGetterProps = function (aa_address, func_name, cb2) {
			// all getters exist and have complexity=0
			cb2({ complexity: 0, count_ops: 1, count_args: null });
		};
	}
	var complexity = 0;
	var count_ops = 0;
	var getters = null;
	var count = 0;
	if (!isArrayOfLength(arrDefinition, 2))
		return callback("AA definition must be 2-element array");
	if (arrDefinition[0] !== 'autonomous agent')
		return callback("not an AA");
	var arrDefinitionCopy = _.cloneDeep(arrDefinition);
	var template = arrDefinitionCopy[1];
	if (template.base_aa) { // parameterized AA
		if (hasFieldsExcept(template, ['base_aa', 'params']))
			return callback("foreign fields in parameterized AA definition");
		if (!ValidationUtils.isNonemptyObject(template.params))
			return callback("no params in parameterized AA");
		if (!variableHasStringsOfAllowedLength(template.params))
			return callback("some strings in params are too long");
		if (!isValidAddress(template.base_aa))
			return callback("base_aa is not a valid address");
		return callback(null);
	}
	// else regular AA
	if (hasFieldsExcept(template, ['bounce_fees', 'messages', 'init', 'doc_url', 'getters']))
		return callback("foreign fields in AA definition");
	if ('bounce_fees' in template){
		if (!ValidationUtils.isNonemptyObject(template.bounce_fees))
			return callback("empty bounce_fees");
		for (var asset in template.bounce_fees){
			if (asset !== 'base' && !isValidBase64(asset, constants.HASH_LENGTH))
				return callback("bad asset in bounce_fees: " + asset);
			var fee = template.bounce_fees[asset];
			if (!isNonnegativeInteger(fee) || fee > constants.MAX_CAP)
				return callback("bad bounce fee: "+fee);
		}
		if ('base' in template.bounce_fees && template.bounce_fees.base < constants.MIN_BYTES_BOUNCE_FEE)
			return callback("too small base bounce fee: "+template.bounce_fees.base);
	}
	if ('doc_url' in template && !isNonemptyString(template.doc_url))
		return callback("invalid doc_url: " + template.doc_url);
	if ('getters' in template) {
		if (mci < constants.aa2UpgradeMci)
			return callback("getters not activated yet");
		if (getFormula(template.getters) === null)
			return callback("invalid getters: " + template.getters);
	}
	validateFieldWrappedInCases(template, 'messages', validateMessages, function (err) {
		if (err)
			return callback(err);
		validateDefinition(arrDefinitionCopy, function (err) {
			if (err)
				return callback(err);
			console.log('AA validated, complexity = ' + complexity + ', ops = ' + count_ops);
			callback(null, { complexity, count_ops, getters });
		});
	});
}


// assumes the definition is valid
function determineGetterProps(arrDefinition, readGetterProps, cb) {
	if (!arrDefinition[1].getters)
		return cb(null);
	var locals = {};
	var f = getFormula(arrDefinition[1].getters);
	var opts = {
		formula: f,
		complexity: 0,
		count_ops: 0,
		bAA: true,
		locals: locals,
		bStatementsOnly: true,
		bGetters: true,
		readGetterProps: readGetterProps,
		mci: Number.MAX_SAFE_INTEGER,
	};
	formulaValidator.validate(opts, function (result) {
		if (result.error)
			throw Error(result.error);
		if (result.complexity > 0)
			throw Error("getters has non-0 complexity");
		cb(getGettersFromLocals(locals));
	});
}

function getGettersFromLocals(locals) {
	// all locals are either getter functions or constants
	var getters = null;
	for (var name in locals) {
		if (locals[name].type === 'func') {
			if (!getters)
				getters = {};
			getters[name] = locals[name].props;
		}
		else if (locals[name].value === undefined)
			throw Error("some locals are not functions or constants");
	}
	return getters;
}


function variableHasStringsOfAllowedLength(x) {
	switch (typeof x) {
		case 'number':
		case 'boolean':
			return true;
		case 'string':
			return (x.length <= constants.MAX_AA_STRING_LENGTH);
		case 'object':
			if (Array.isArray(x)) {
				for (var i = 0; i < x.length; i++)
					if (!variableHasStringsOfAllowedLength(x[i]))
						return false;
			}
			else {
				for (var key in x) {
					if (key.length > constants.MAX_AA_STRING_LENGTH)
						return false;
					if (!variableHasStringsOfAllowedLength(x[key]))
						return false;
				}
			}
			return true;
		default:
			throw Error("unknown type " + (typeof x) + " of " + x);
	}
}

exports.validateAADefinition = validateAADefinition;
exports.determineGetterProps = determineGetterProps;
