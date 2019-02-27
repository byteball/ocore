/*jslint node: true */
"use strict";
var crypto = require('crypto');
var _ = require('lodash');
var async = require('async');
var constants = require('./constants.js');
var storage = require('./storage.js');
var db = require('./db.js');
var ecdsaSig = require('./signature.js');
var merkle = require('./merkle.js');
var ValidationUtils = require("./validation_utils.js");
var objectHash = require("./object_hash.js");
var formulaParser = process.browser ? null : require('./formula/index'+'');
var Decimal = require('decimal.js');
var dataFeeds = require('./data_feeds.js');

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
				if (!isNonemptyArray(attestors))
					return cb3("wrong attestors: " + attestors);
				for (var i = 0; i < attestors.length; i++) {
					var attestor = attestors[i];
					if (!isNonemptyString(attestor))
						return cb3("bad attestor: " + attestor);
					if (attestor !== 'this address' && !isValidAddress(attestor))
						arrFormulas.push(getFormula(attestor, true));
				}
				cb3();
			}

			switch (message.app) {
				case 'profile':
				case 'data':
					if (!isNonemptyObject(payload))
						return cb2('bad payload of app=' + message.app + ': ' + payload);
					arrFormulas = collectFormulasInVar(payload);
					if (arrFormulas === null)
						return cb2("object too deep");
					async.eachSeries(arrFormulas, validateFormula, cb2);
					break;
				
				case 'data_feed':
					if (!isNonemptyObject(payload))
						return cb2("data feed payload must be non-empty object");
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
								arrFormulas.push(value_formula);
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
					if (hasFieldsExcept(payload, ['asset', 'outputs']))
						return cb2("foreign fields in payment");
					if ('asset' in payload) {
						if (!isNonemptyString(payload.asset))
							return cb2("bad asset: " + payload.asset);
						if (payload.asset !== 'base' && !isValidBase64(payload.asset, constants.HASH_LENGTH)) {
							var asset_formula = getFormula(payload.asset, true);
							arrFormulas.push(asset_formula);
						}
					}

					function validateOutputs(outputs, cb3) {
						if (!isNonemptyArray(outputs))
							return cb3("bad outputs");
						for (var i = 0; i < outputs.length; i++) {
							var output = outputs[i];
							if (hasFieldsExcept(output, ['address', 'amount']))
								return cb3('foreign fields in output');
							if (!isNonemptyString(output.address))
								return cb3('address not a string: ' + output.address);
							if (!isValidAddress(output.address))
								arrFormulas.push(getFormula(output.address, true));
							if (typeof output.amount === 'number') {
								if (!isPositiveInteger(output.amount) || output.amount > constants.MAX_CAP)
									return cb3('bad amount number: ' + output.amount);
							}
							else if (typeof output.amount === 'string')
								arrFormulas.push(getFormula(output.amount, true));
							else
								return cb3('bad amount: ' + output.amount);
						}
						cb3();
					}

					validateFieldWrappedInCases(payload, 'outputs', validateOutputs, function (err) {
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
					setImmediate(validateAADefinition, payload, cb2); // interrupt the call stack to protect against deep nesting
					break;
				
				case 'asset':
					if (hasFieldsExcept(payload, ["cap", "is_private", "is_transferrable", "auto_destroy", "fixed_denominations", "issued_by_definer_only", "cosigned_by_definer", "spender_attested", "issue_condition", "transfer_condition", "attestors", "denominations"]))
						return cb2("unknown fields in asset definition in AA");
					if (payload.fixed_denominations === true && !isNonemptyArray(payload.denominations))
						return cb2("denominations not defined");
					if ("cap" in payload) {
						if (typeof payload.cap === 'number') {
							if (!(isPositiveInteger(payload.cap) && payload.cap <= constants.MAX_CAP))
								return cp2("invalid cap: " + payload.cap);
						}
						else if (typeof payload.cap === 'string')
							arrFormulas.push(getFormula(payload.cap, true));
						else
							return cb2("wrong cap: " + payload.cap);
					}

					function validateDenominations(denominations, cb3) {
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
							else if (typeof denomInfo.denomination === 'string')
								arrFormulas.push(getFormula(denomInfo.denomination, true));
							else
								return cb3("bad denomination " + denomInfo.denomination);
							if ("count_coins" in denomInfo) {
								if (typeof denomInfo.count_coins === 'number') {
									if (!isPositiveInteger(denomInfo.count_coins))
										return cb3("invalid count_coins");
								}
								else if (typeof denomInfo.count_coins === 'string')
									arrFormulas.push(getFormula(denomInfo.count_coins, true));
								else
									return cb3("bad count_coins " + denomInfo.count_coins);
							}
						}
						cb3();
					}

					if ("issue_condition" in payload) {
						if (!isArrayOfLength(payload.issue_condition, 2))
							return cb2("wrong issue condition: " + payload.issue_condition);
						var arrIssueFormulas = concat(collectFormulasInVar(payload.issue_condition));
						if (arrIssueFormulas === null)
							return cb2("issue_condition too deep");
						arrFormulas = arrFormulas.concat(arrIssueFormulas);
					}
					if ("transfer_condition" in payload) {
						if (!isArrayOfLength(payload.transfer_condition, 2))
							return cb2("wrong transfer condition: " + payload.transfer_condition);
						var arrTransferFormulas = concat(collectFormulasInVar(payload.transfer_condition));
						if (arrTransferFormulas === null)
							return cb2("transfer_condition too deep");
						arrFormulas = arrFormulas.concat(arrTransferFormulas);
					}
					async.eachSeries(
						["is_private", "is_transferrable", "auto_destroy", "fixed_denominations", "issued_by_definer_only", "cosigned_by_definer", "spender_attested"],
						function (field, cb3) {
							if (typeof payload[field] === 'boolean')
								return cb3();
							if (typeof payload[field] === 'string') {
								arrFormulas.push(getFormula(payload[field], true));
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
									validateFieldWrappedInCases(payload, 'attestors', validateAttestors, cb2);
								},
								function (cb3) {
									if (!("denominations" in payload))
										return cb3();
									validateFieldWrappedInCases(payload, 'denominations', validateDenominations, cb2);
								}
							],
							function (err) {
								if (err)
									return cb2(err);
								async.eachSeries(arrFormulas, validateFormula, cb2);
							});
						}
					);
					break;
				
				case 'asset_attestors':
					if (hasFieldsExcept(payload, ['asset', 'attestors']))
						return cb2("foreign fields in attestor list update");
					if (!isNonemptyString(payload.asset))
						return cb2("asset is not a string");
					if (!isValidBase64(payload.asset, constants.HASH_LENGTH))
						arrFormulas.push(getFormula(payload.asset, true));
					
					validateFieldWrappedInCases(payload, 'attestors', validateAttestors, function (err) {
						if (err)
							return cb2(err);
						async.eachSeries(arrFormulas, validateFormula, cb2);
					});
					break;
				
				case 'attestation':
					if (hasFieldsExcept(payload, ["address", "profile"]))
						return cb2("unknown fields in AA attestation");
					if (!isNonemptyObject(payload.profile))
						return cb2('bad attested profile' + payload.profile);
					arrFormulas = collectFormulasInVar(payload.profile);
					if (arrFormulas === null)
						return cb2("attested profile too deep");
					if (!isNonemptyString(payload.address))
						return cb2("bad attested address: " + payload.address);
					if (!isValidAddress(payload.address))
						arrFormulas.push(getFormula(payload.address, true));
					async.eachSeries(arrFormulas, validateFormula, cb2);
					break;
				
				case 'poll':
					if (!isNonemptyObject(payload))
						return cb2("poll payload must be a non-empty object");
					if (hasFieldsExcept(payload, ["question", "choices"]))
						return cb2("unknown fields in AA poll");
					if (!isNonemptyString(payload.question))
						return cb2("bad question in AA poll: " + payload.question);
					var question_formula = getFormula(payload.question);
					if (question_formula !== null)
						arrFormulas.push(question_formula);
					
					function validateChoices(choices, cb3) {
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
					if (hasFieldsExcept(payload, ["unit", "choice"]))
						return cb2("unknown fields in AA vote");
					if (!isNonemptyString(payload.unit))
						return cb2("AA vote unit must be string");
					if (!isNonemptyString(payload.choice))
						return cb2("AA vote choice must be string");
					if (!isValidBase64(payload.unit, constants.HASH_LENGTH))
						arrFormulas.push(getFormula(payload.unit, true));
					var choice_formula = getFormula(payload.choice);
					if (choice_formula !== null)
						arrFormulas.push(choice_formula);
					async.eachSeries(arrFormulas, validateFormula, cb2);
					break;
				
				case 'definition_template':
					if (!ValidationUtils.isArrayOfLength(payload, 2))
						return cb2("AA definition_template must be array of two elements");
					arrFormulas = collectFormulasInVar(payload);
					if (arrFormulas === null)
						return cb2("AA definition_template too deep");
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
				validateFormula(message.if, cb2);
			},
			function (cb2) {
				validateFieldWrappedInCases(message, 'payload', validatePayload, cb2);
			}
		], cb);
	}

	function validateMessages(messages, cb) {
		if (!Array.isArray(messages))
			return cb("bad messages in AA");
		for (var i = 0; i < messages.length; i++){
			var message = messages[i];
			if (['payment', 'data', 'data_feed', 'definition', "asset", "asset_attestors", "attestation", "poll", "vote", 'text', 'profile', 'definition_template'].indexOf(message.app) === -1)
				return cb("bad app: " + message.app);
			if (!('payload' in message))
				return cb("no payload in message");
			if ('if' in message && !isNonemptyString(message.if))
				return cb('bad if in message: '+message.if);
		}
		async.eachSeries(messages, validateMessage, cb);
	}

	function validateFieldWrappedInCases(obj, field, validateField, cb, depth) {
		if (!depth)
			depth = 0;
		if (depth > 100)
			return cb("cases for " + field + " go too deep");
		var value = obj[field];
		var bCases = (typeof value === 'object' && Object.keys(value) === 1 && isNonemptyArray(value.cases));
		if (!bCases)
			return validateField(value, cb);
		var cases = value.cases;
		for (var i = 0; i < cases.length; i++){
			var acase = cases[i];
			if ('if' in acase && !isNonemptyString(acase.if))
				return cb('bad if in case: ' + acase.if);
			if (!('if' in acase) && i < cases.length - 1)
				return cb('if required in all but the last cases');
		}
		async.eachSeries(
			cases,
			function (acase, cb2) {
				if (!('if' in acase))
					return validateFieldWrappedInCases(acase, field, validateField, cb2, depth + 1);
				validateFormula(acase.if, function (err) {
					if (err)
						return cb2(err);
					validateFieldWrappedInCases(acase, field, validateField, cb2, depth + 1);
				});
			},
			cb
		);
	}

	function validateFormula(furmula, cb) {
		formulaParser.validate(formula, complexity, function (result) {
			complexity = result.complexity;
			if (result.error)
				return cb(result.error);
			if (complexity > constants.MAX_COMPLEXITY)
				return cb('complexity exceeded');
			cb();
		});
	}

	var complexity = 0;
	if (!isArrayOfLength(arrDefinition, 2))
		return callback("AA definition must be 2-element array");
	if (arrDefinition[0] !== 'autonomous agent')
		return callback("not an AA");
	var output = arrDefinition[1];
	if (hasFieldsExcept(output, ['bounce_fees', 'messages', 'cases']))
		return callback("foreign fields in AA definition");
	if ('bounce_fees' in output){
		if (!ValidationUtils.isNonemptyObject(output.bounce_fees))
			return callback("empty bounce_fees");
		for (var asset in output.bounce_fees){
			if (asset !== 'base' && !isValidBase64(asset, constants.HASH_LENGTH))
				return callback("bad asset in bounce_fees: " + asset);
			var fee = output.bounce_fees[asset];
			if (!isNonnegativeInteger(fee) || fee > constants.MAX_CAP)
				return callback("bad bounce fee: "+fee);
		}
		if ('base' in output.bounce_fees && output.bounce_fees.base < 10000)
			return callback("too small base bounce fee: "+output.bounce_fees.base);
	}
	validateFieldWrappedInCases(output, 'messages', validateMessages, callback);
}

function collectFormulasInVar(variable) {
	var MAX_DEPTH = 100;
	var bMaxDepthReached = false;
	var arrFormulas = [];

	function search(v, depth) {
		if (depth > MAX_DEPTH) {
			bMaxDepthReached = true;
			return;
		}
		switch (typeof v) {
			case 'string':
				var formula = getFormula(v);
				if (formula !== null)
					arrFormulas.push(formula);
				break;
			case 'object':
				if (Array.isArray(v))
					v.forEach(function (el) {
						search(el, depth + 1);
					});
				else {
					for (var key in v) {
						var key_formula = getFormula(key);
						if (key_formula !== null)
							arrFormulas.push(key_formula);
						search(v[key], depth + 1);
					}
				}
		}
	}

	search(variable, 0);
	return bMaxDepthReached ? null : arrFormulas;
}

function getFormula(str, bOptionalBraces) {
	if (str[0] === '{' && str[str.length - 1] === '}')
		return str.slice(1, -1);
	else if (bOptionalBraces)
		return str;
	else
		return null;
}

exports.validateAADefinition = validateAADefinition;
