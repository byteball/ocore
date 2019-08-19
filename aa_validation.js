/*jslint node: true */
"use strict";

var async = require('async');
var constants = require('./constants.js');
var ValidationUtils = require("./validation_utils.js");
var formulaValidator = require('./formula/validation.js');

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


function validateAADefinition(arrDefinition, callback) {


	function validateMessage(message, cb) {

		function validatePayload(payload, cb2) {
			var arrFormulas = [];

			function validateAttestors(attestors, cb3) {
				if (isNonemptyString(attestors)) {
					var f = getFormula(attestors);
					if (f === null)
						return cb3("attestors is a string but not formula: " + attestors);
					arrFormulas.push(f);
					return cb3();
				}
				if (!isNonemptyArray(attestors))
					return cb3("wrong attestors: " + attestors);
				for (var i = 0; i < attestors.length; i++) {
					var attestor = attestors[i];
					if (!isNonemptyString(attestor))
						return cb3("bad attestor: " + attestor);
					if (attestor !== 'this address' && !isValidAddress(attestor)) {
						var f = getFormula(attestor);
						if (f === null)
							return cb3("bad formula in attestor");
						arrFormulas.push(f);
					}
				}
				cb3();
			}

			if (message.app !== 'text' && isNonemptyString(payload)) {
				var payload_formula = getFormula(payload);
				if (payload_formula === null)
					return cb2("payload is a string but doesn't look like a formula: " + payload);
				return validateFormula(payload_formula, cb2);
			}

			if (['payment', 'asset', 'asset_attestors', 'attestation', 'poll', 'vote'].indexOf(message.app) >= 0) {
				if ('init' in payload) {
					if (!isNonemptyString(payload.init))
						return cb2("bad init: " + payload.init);
					var f = getFormula(payload.init);
					if (f === null)
						return cb2("init is not a formula: " + payload.init);
					arrFormulas.push({formula: f, bStatementsOnly: true});
				}
			}

			switch (message.app) {
				case 'profile':
				case 'data':
					if (!isNonemptyObject(payload))
						return cb2('payload of app=' + message.app + ' must be non-empty object or formula: ' + payload);
					var arrDataFormulas = collectFormulasInVar(payload);
					if (arrDataFormulas === null)
						return cb2("object too deep");
					arrFormulas = arrFormulas.concat(arrDataFormulas);
					async.eachSeries(arrFormulas, validateFormula, cb2);
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
						else
							arrFormulas.push(feed_name_formula);
						var value = payload[feed_name];
						if (typeof value === 'string') {
							var value_formula = getFormula(value);
							if (value_formula === null) {
								if (value.length > constants.MAX_DATA_FEED_VALUE_LENGTH)
									return cb2("value " + value + " too long");
								if (value.indexOf('\n') >= 0)
									return cb2("value " + value + " of feed name " + feed_name + " contains \\n");
							}
							else
								arrFormulas.push((feed_name === 'init') ? {formula: value_formula, bStatementsOnly: true} : value_formula);
						}
						else if (typeof value === 'number') {
							if (!isInteger(value))
								return cb2("fractional numbers not allowed in data feeds");
						}
						else
							return cb2("data feed " + feed_name + " must be string or number");
					}
					async.eachSeries(arrFormulas, validateFormula, cb2);
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
							arrFormulas.push(asset_formula);
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
								arrFormulas.push(output_formula);
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
								arrFormulas.push(f);
							}
							if ('init' in output) {
								if (!isNonemptyString(output.init))
									return cb3("bad init in output: " + output.init);
								var f = getFormula(output.init);
								if (f === null)
									return cb3("init in output is not a formula: " + output.init);
								arrFormulas.push({formula: f, bStatementsOnly: true});
							}
							if (!isNonemptyString(output.address))
								return cb3('address not a string: ' + output.address);
							var f = getFormula(output.address);
							if (f !== null)
								arrFormulas.push(f);
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
								arrFormulas.push(f);
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
						async.eachSeries(arrFormulas, validateFormula, cb2);
					});
					break;

				case 'text':
					if (!isNonemptyString(payload))
						return cb2("bad text: " + payload);
					var text_formula = getFormula(payload);
					if (text_formula === null)
						return cb2();
					validateFormula(text_formula, cb2);
					break;

				case 'definition':
					if (!isArrayOfLength(payload.definition, 2))
						return cb2("definition must be array of 2");
					if (hasFieldsExcept(payload, ['definition']))
						return cb2("unknown fields in AA definition in AA");
					(typeof setImmediate === 'function') ? setImmediate(validateAADefinition, payload.definition, cb2) : setTimeout(validateAADefinition, 0, payload.definition, cb2); // interrupt the call stack to protect against deep nesting
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
							arrFormulas.push(f);
						}
						else
							return cb2("wrong cap: " + payload.cap);
					}

					function validateDenominations(denominations, cb3) {
						if (isNonemptyString(denominations)) {
							var f = getFormula(denominations);
							if (f === null)
								return cb3("denominations is a string but not formula: " + attestors);
							arrFormulas.push(f);
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
								arrFormulas.push(f);
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
									arrFormulas.push(f);
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
						var arrIssueFormulas = collectFormulasInVar(payload.issue_condition);
						if (arrIssueFormulas === null)
							return cb2("issue_condition too deep");
						arrFormulas = arrFormulas.concat(arrIssueFormulas);
					}
					if ("transfer_condition" in payload) {
						if (!isArrayOfLength(payload.transfer_condition, 2))
							return cb2("wrong transfer condition: " + payload.transfer_condition);
						var arrTransferFormulas = collectFormulasInVar(payload.transfer_condition);
						if (arrTransferFormulas === null)
							return cb2("transfer_condition too deep");
						arrFormulas = arrFormulas.concat(arrTransferFormulas);
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
								arrFormulas.push(f);
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
							//	console.log(arrFormulas);
								async.eachSeries(arrFormulas, validateFormula, cb2);
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
					if (asset_formula !== null)
						arrFormulas.push(asset_formula);
					else if (!isValidBase64(payload.asset, constants.HASH_LENGTH))
						return cb2("bad asset in asset_attestors: " + payload.asset);
					validateFieldWrappedInCases(payload, 'attestors', validateAttestors, function (err) {
						if (err)
							return cb2(err);
						async.eachSeries(arrFormulas, validateFormula, cb2);
					});
					break;

				case 'attestation':
					if (hasFieldsExcept(payload, ["address", "profile", "init"]))
						return cb2("unknown fields in AA attestation");
					if (!isNonemptyObject(payload.profile))
						return cb2('bad attested profile' + payload.profile);
					var arrAttProfileFormulas = collectFormulasInVar(payload.profile);
					if (arrAttProfileFormulas === null)
						return cb2("attested profile too deep");
					arrFormulas = arrFormulas.concat(arrAttProfileFormulas);
					if (!isNonemptyString(payload.address))
						return cb2("bad attested address: " + payload.address);
					var address_formula = getFormula(payload.address);
					if (address_formula !== null)
						arrFormulas.push(address_formula);
					else if (!isValidAddress(payload.address))
						return cb2("bad address in attestation: " + payload.address);
					async.eachSeries(arrFormulas, validateFormula, cb2);
					break;

				case 'poll':
					if (!isNonemptyObject(payload))
						return cb2("poll payload must be a non-empty object");
					if (hasFieldsExcept(payload, ["question", "choices", 'init']))
						return cb2("unknown fields in AA poll");
					if (!isNonemptyString(payload.question))
						return cb2("bad question in AA poll: " + payload.question);
					var question_formula = getFormula(payload.question);
					if (question_formula !== null)
						arrFormulas.push(question_formula);

					function validateChoices(choices, cb3) {
						if (isNonemptyString(choices)) {
							var f = getFormula(choices);
							if (f === null)
								return cb3("choices is a string but not formula: " + attestors);
							arrFormulas.push(f);
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
							if (choice_formula !== null)
								arrFormulas.push(choice_formula);
							else if (choices[i].length > constants.MAX_CHOICE_LENGTH)
								return cb3("all choices must be " + constants.MAX_CHOICE_LENGTH + " chars or less");
						}
						cb3();
					}

					validateFieldWrappedInCases(payload, 'choices', validateChoices, function (err) {
						if (err)
							return cb2(err);
						async.eachSeries(arrFormulas, validateFormula, cb2);
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
					if (unit_formula !== null)
						arrFormulas.push(unit_formula);
					else if (!isValidBase64(payload.unit, constants.HASH_LENGTH))
						return cb2("AA vote bad unit: "+payload.unit);
					var choice_formula = getFormula(payload.choice);
					if (choice_formula !== null)
						arrFormulas.push(choice_formula);
					async.eachSeries(arrFormulas, validateFormula, cb2);
					break;

				case 'definition_template':
					if (!ValidationUtils.isArrayOfLength(payload, 2))
						return cb2("AA definition_template must be array of two elements");
					var arrTemplFormulas = collectFormulasInVar(payload);
					if (arrTemplFormulas === null)
						return cb2("AA definition_template too deep");
					arrFormulas = arrFormulas.concat(arrTemplFormulas);
					async.eachSeries(arrFormulas, validateFormula, cb2);
					break;

				default:
					cb2("unsupported app in AA: " + message.app);
			}
		}

		async.series([
			function (cb2) {
				if (!message.if)
					return cb2();
				var f = getFormula(message.if);
				if (f === null)
					return cb2("bad if in message");
				validateFormula(f, cb2);
			},
			function (cb2) {
				if (!message.init)
					return cb2();
				var f = getFormula(message.init);
				if (f === null)
					return cb2("bad init in message");
				validateFormula(f, true, false, cb2);
			},
			function (cb2) {
				if (message.app === 'state') {
					var f = getFormula(message.state);
					if (f === null)
						return cb2('bad state formula: '+message.state);
					return validateFormula(f, true, true, cb2);
				}
				validateFieldWrappedInCases(message, 'payload', validatePayload, cb2);
			}
		], cb);
	}

	function validateMessages(messages, cb) {
		if (!Array.isArray(messages))
			return cb("bad messages in AA");
		for (var i = 0; i < messages.length; i++){
			var message = messages[i];
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
		if (depth > 100)
			return cb("cases for " + field + " go too deep");
		var value = obj[field];
		var bCases = hasCases(value);
		if (!bCases)
			return validateField(value, cb);
		var cases = value.cases;
		for (var i = 0; i < cases.length; i++){
			var acase = cases[i];
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
						if (!(key in acase))
							return cb3();
						var f = getFormula(acase[key]);
						if (f === null)
							return cb3("not a formula in " + key);
						validateFormula(f, key === 'init', false, cb3);
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

	function validateFormula(formula, bStatementsOnly, bStateVarAssignmentAllowed, cb) {
		if (typeof bStatementsOnly === 'function') {
			cb = bStatementsOnly;
			bStatementsOnly = false;
			bStateVarAssignmentAllowed = false;
		}
		if (typeof formula === 'object') { // { formula: "....", bStatementsOnly: true }
			bStatementsOnly = formula.bStatementsOnly;
			formula = formula.formula;
		}
		var opts = {
			formula: formula,
			complexity: complexity,
			count_ops: count_ops,
			bAA: true,
			bStatementsOnly: bStatementsOnly,
			bStateVarAssignmentAllowed: bStateVarAssignmentAllowed
		};
	//	console.log('--- validateFormula', formula);
		formulaValidator.validate(opts, function (result) {
			complexity = result.complexity;
			count_ops = result.count_ops;
			if (result.error) {
				var errorMessage = "validation of formula " + formula + " failed: " + result.error
				errorMessage += result.errorMessage ? `\nparser error: ${result.errorMessage}` : ''
				return cb(errorMessage);
			}
			if (complexity > constants.MAX_COMPLEXITY)
				return cb('complexity exceeded');
			if (count_ops > constants.MAX_OPS)
				return cb('number of ops exceeded');
			cb();
		});
	}

	var complexity = 0;
	var count_ops = 0;
	if (!isArrayOfLength(arrDefinition, 2))
		return callback("AA definition must be 2-element array");
	if (arrDefinition[0] !== 'autonomous agent')
		return callback("not an AA");
	var template = arrDefinition[1];
	if (hasFieldsExcept(template, ['bounce_fees', 'messages', 'init']))
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
	if ('init' in template) {
		if (!ValidationUtils.isNonemptyString(template.init))
			return callback("init is not a string");
		var f = getFormula(template.init);
		if (f === null)
			return callback("bad formula in init: " + template.init);
		return validateFormula(f, true, false, function (err) {
			if (err)
				return callback(err);
			validateFieldWrappedInCases(template, 'messages', validateMessages, function (err) {
				if (err)
					return callback(err);
				callback(null, 'AA validated, complexity = ' + complexity + ', ops = ' + count_ops);
			});
		});
	}
	validateFieldWrappedInCases(template, 'messages', validateMessages, function (err) {
		if (err)
			return callback(err);
		callback(null, 'AA validated, complexity = ' + complexity + ', ops = ' + count_ops);
	});
}

function collectFormulasInVar(variable) {
	var MAX_DEPTH = 100;
	var bMaxDepthReached = false;
	var arrFormulas = [];

	function search(v, k, depth) {
		if (depth > MAX_DEPTH) {
			bMaxDepthReached = true;
			return;
		}
		switch (typeof v) {
			case 'string':
				var formula = getFormula(v);
				if (formula !== null)
					arrFormulas.push((k === 'init') ? {formula: formula, bStatementsOnly: true} : formula);
				break;
			case 'object':
				if (Array.isArray(v))
					v.forEach(function (el) {
						search(el, '', depth + 1);
					});
				else {
					for (var key in v) {
						var key_formula = getFormula(key);
						if (key_formula !== null)
							arrFormulas.push(key_formula);
						search(v[key], key, depth + 1);
					}
				}
		}
	}

	search(variable, '', 0);
	return bMaxDepthReached ? null : arrFormulas;
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
	return (typeof value === 'object' && Object.keys(value).length === 1 && isNonemptyArray(value.cases));
}


exports.validateAADefinition = validateAADefinition;
exports.getFormula = getFormula;
exports.hasCases = hasCases;
