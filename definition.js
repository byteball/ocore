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

// validate definition of address or asset spending conditions
function validateDefinition(conn, arrDefinition, objUnit, objValidationState, arrAuthentifierPaths, bAssetCondition, handleResult){
	
	function getFilterError(filter){
		if (!filter)
			return "no filter";
		if (hasFieldsExcept(filter, ["what", "asset", "type", "address", "amount", "amount_at_least", "amount_at_most"]))
			return "unknown fields in filter";
		if (filter.what !== "input" && filter.what !== "output")
			return "invalid what="+filter.what;
		if (bAssetCondition && filter.asset === "this asset" && objValidationState.bDefiningPrivateAsset)
			return "private asset cannot reference itself";
		if ("asset" in filter && !(filter.asset === "base" || isStringOfLength(filter.asset, constants.HASH_LENGTH) || bAssetCondition && filter.asset === "this asset"))
			return "invalid asset: "+filter.asset;
		if (filter.what === "output"){
			if ("type" in filter)
				return "output canot have type";
		}
		if ("type" in filter && filter.type !== "issue" && filter.type !== "transfer")
			return "invalid type: "+filter.type;
		if (bAssetCondition && (filter.address === 'this address' || filter.address === 'other address'))
			return "asset condition cannot reference this/other address";
		if ("address" in filter && !isValidAddress(filter.address) && filter.address !== 'this address' && (filter.address !== 'other address' || objValidationState.last_ball_mci < constants.otherAddressInDefinitionUpgradeMci)) // it is ok if the address was never used yet
			return "invalid address: "+filter.address;
		if ("amount" in filter && !isPositiveInteger(filter.amount))
			return "amount must be positive int";
		if ("amount_at_least" in filter && !isPositiveInteger(filter.amount_at_least))
			return "amount_at_least must be positive int";
		if ("amount_at_most" in filter && !isPositiveInteger(filter.amount_at_most))
			return "amount_at_most must be positive int";
		if (filter.amount && (filter.amount_at_least || filter.amount_at_most))
			return "can't have amount and amount_at_least/most at the same time";
		return null;
	}
	
	// it is difficult to ease this condition for bAssetCondition:
	// we might allow _this_ asset (the asset this condition is attached to) to be private but we might have only part of this asset's payments disclosed,
	// some parties may see more disclosed than others.
	function determineIfAnyOfAssetsIsPrivate(arrAssets, cb){
		if (arrAssets.length === 0)
			return cb(false);
		conn.query("SELECT 1 FROM assets WHERE unit IN(?) AND is_private=1 LIMIT 1", [arrAssets], function(rows){
			cb(rows.length > 0);
		});
	}
	
	
	function pathIncludesOneOfAuthentifiers(path){
		if (bAssetCondition)
			throw Error('pathIncludesOneOfAuthentifiers called in asset condition');
		for (var i=0; i<arrAuthentifierPaths.length; i++){
			var authentifier_path = arrAuthentifierPaths[i];
			if (authentifier_path.substr(0, path.length) === path)
				return true;
		}
		return false;
	}
	
	function needToEvaluateNestedAddress(path){
		if (!arrAuthentifierPaths) // no signatures, just validating a new definition
			return true;
		if (objValidationState.last_ball_mci < 1400000) // skipping is enabled after this mci
			return true;
		return pathIncludesOneOfAuthentifiers(path);
	}
	
	
	function evaluate(arr, path, bInNegation, cb){
		complexity++;
		if (complexity > constants.MAX_COMPLEXITY)
			return cb("complexity exceeded at "+path);
		if (!isArrayOfLength(arr, 2))
			return cb("expression must be 2-element array");
		var op = arr[0];
		var args = arr[1];
		switch(op){
			case 'or':
			case 'and':
				if (!Array.isArray(args))
					return cb(op+" args must be array");
				if (args.length < 2)
					return cb(op+" must have at least 2 options");
				var count_options_with_sig = 0;
				var index = -1;
				async.eachSeries(
					args,
					function(arg, cb2){
						index++;
						evaluate(arg, path+'.'+index, bInNegation, function(err, bHasSig){
							if (err)
								return cb2(err);
							if (bHasSig)
								count_options_with_sig++;
							cb2();
						});
					},
					function(err){
						if (err)
							return cb(err);
						cb(null, op === "and" && count_options_with_sig > 0 || op === "or" && count_options_with_sig === args.length);
					}
				);
				break;
				
			case 'r of set':
				if (hasFieldsExcept(args, ["required", "set"]))
					return cb("unknown fields in "+op);
				if (!isPositiveInteger(args.required))
					return cb("required must be positive");
				if (!Array.isArray(args.set))
					return cb("set must be array");
				if (args.set.length < 2)
					return cb("set must have at least 2 options");
				if (args.required > args.set.length)
					return cb("required must be <= than set length");
				//if (args.required === args.set.length)
				//    return cb("required must be strictly less than set length, use and instead");
				//if (args.required === 1)
				//    return cb("required must be more than 1, use or instead");
				var count_options_with_sig = 0;
				var index = -1;
				async.eachSeries(
					args.set,
					function(arg, cb2){
						index++;
						evaluate(arg, path+'.'+index, bInNegation, function(err, bHasSig){
							if (err)
								return cb2(err);
							if (bHasSig)
								count_options_with_sig++;
							cb2();
						});
					},
					function(err){
						if (err)
							return cb(err);
						var count_options_without_sig = args.set.length - count_options_with_sig;
						cb(null, args.required > count_options_without_sig);
					}
				);
				break;
				
			case 'weighted and':
				if (hasFieldsExcept(args, ["required", "set"]))
					return cb("unknown fields in "+op);
				if (!isPositiveInteger(args.required))
					return cb("required must be positive");
				if (!Array.isArray(args.set))
					return cb("set must be array");
				if (args.set.length < 2)
					return cb("set must have at least 2 options");
				var weight_of_options_with_sig = 0;
				var total_weight = 0;
				var index = -1;
				async.eachSeries(
					args.set,
					function(arg, cb2){
						index++;
						if (hasFieldsExcept(arg, ["value", "weight"]))
							return cb2("unknown fields in weighted set element");
						if (!isPositiveInteger(arg.weight))
							return cb2("weight must be positive int");
						total_weight += arg.weight;
						evaluate(arg.value, path+'.'+index, bInNegation, function(err, bHasSig){
							if (err)
								return cb2(err);
							if (bHasSig)
								weight_of_options_with_sig += arg.weight;
							cb2();
						});
					},
					function(err){
						if (err)
							return cb(err);
						if (args.required > total_weight)
							return cb("required must be <= than total weight");
						var weight_of_options_without_sig = total_weight - weight_of_options_with_sig;
						cb(null, args.required > weight_of_options_without_sig);
					}
				);
				break;
				
			case 'sig':
				if (bInNegation)
					return cb(op+" cannot be negated");
				if (bAssetCondition)
					return cb("asset condition cannot have "+op);
				if (hasFieldsExcept(args, ["algo", "pubkey"]))
					return cb("unknown fields in "+op);
				if (args.algo === "secp256k1")
					return cb("default algo must not be explicitly specified");
				if ("algo" in args && args.algo !== "secp256k1")
					return cb("unsupported sig algo");
				if (!isStringOfLength(args.pubkey, constants.PUBKEY_LENGTH))
					return cb("wrong pubkey length");
				return cb(null, true);
				
			case 'hash':
				if (bInNegation)
					return cb(op+" cannot be negated");
				if (bAssetCondition)
					return cb("asset condition cannot have "+op);
				if (hasFieldsExcept(args, ["algo", "hash"]))
					return cb("unknown fields in "+op);
				if (args.algo === "sha256")
					return cb("default algo must not be explicitly specified");
				if ("algo" in args && args.algo !== "sha256")
					return cb("unsupported hash algo");
				if (!ValidationUtils.isValidBase64(args.hash, constants.HASH_LENGTH))
					return cb("wrong base64 hash");
				return cb();
				
			case 'address':
				if (objValidationState.bNoReferences)
					return cb("no references allowed in address definition");
				if (bInNegation)
					return cb(op+" cannot be negated");
				if (bAssetCondition)
					return cb("asset condition cannot have "+op);
				var other_address = args;
				if (!isValidAddress(other_address))
					return cb("invalid address");
				storage.readDefinitionByAddress(conn, other_address, objValidationState.last_ball_mci, {
					ifFound: function(arrInnerAddressDefinition){
						console.log("inner address:", arrInnerAddressDefinition);
						needToEvaluateNestedAddress(path) ? evaluate(arrInnerAddressDefinition, path, bInNegation, cb) : cb(null, true);
					},
					ifDefinitionNotFound: function(definition_chash){
					//	if (objValidationState.bAllowUnresolvedInnerDefinitions)
					//		return cb(null, true);
						var bAllowUnresolvedInnerDefinitions = true;
						var arrDefiningAuthors = objUnit.authors.filter(function(author){
							return (author.address === other_address && author.definition && objectHash.getChash160(author.definition) === definition_chash);
						});
						if (arrDefiningAuthors.length === 0) // no address definition in the current unit
							return bAllowUnresolvedInnerDefinitions ? cb(null, true) : cb("definition of inner address "+other_address+" not found");
						if (arrDefiningAuthors.length > 1)
							throw Error("more than 1 address definition");
						var arrInnerAddressDefinition = arrDefiningAuthors[0].definition;
						needToEvaluateNestedAddress(path) ? evaluate(arrInnerAddressDefinition, path, bInNegation, cb) : cb(null, true);
					}
				});
				break;
				
			case 'definition template':
				// ['definition template', ['unit', {param1: 'value1'}]]
				if (objValidationState.bNoReferences)
					return cb("no references allowed in address definition");
				if (!isArrayOfLength(args, 2))
					return cb("2-element array expected in "+op);
				var unit = args[0];
				var params = args[1];
				if (!isStringOfLength(unit, constants.HASH_LENGTH))
					return cb("unit must be 44 bytes long");
				if (!ValidationUtils.isNonemptyObject(params))
					return cb("params must be non-empty object");
				for (var key in params)
					if (typeof params[key] !== "string" && typeof params[key] !== "number")
						return cb("each param must be string or number");
				conn.query(
					"SELECT payload FROM messages JOIN units USING(unit) \n\
					WHERE unit=? AND app='definition_template' AND main_chain_index<=? AND +sequence='good' AND is_stable=1",
					[unit, objValidationState.last_ball_mci],
					function(rows){
						if (rows.length !== 1)
							return cb("template not found or too many");
						var template = rows[0].payload;
						var arrTemplate = JSON.parse(template);
						try{
							var arrFilledTemplate = replaceInTemplate(arrTemplate, params);
							console.log(require('util').inspect(arrFilledTemplate, {depth: null}));
						}
						catch(e){
							if (e instanceof NoVarException)
								return cb(e.toString());
							else
								throw e;
						}
						evaluate(arrFilledTemplate, path, bInNegation, cb);
					}
				);
				break;
				
			case 'seen address':
				if (objValidationState.bNoReferences)
					return cb("no references allowed in address definition");
				if (!isValidAddress(args)) // it is ok if the address was never used yet
					return cb("invalid seen address");
				return cb();
				
			case 'seen definition change':
			case 'has definition change':
				if (objValidationState.bNoReferences)
					return cb("no references allowed in address definition");
				if (!isArrayOfLength(args, 2))
					return cb(op+" must have 2 args");
				var changed_address = args[0];
				var new_definition_chash = args[1];
				if (bAssetCondition && (changed_address === 'this address' || new_definition_chash === 'this address' || changed_address === 'other address' || new_definition_chash === 'other address'))
					return cb("asset condition cannot reference this/other address in "+op);
				if (!isValidAddress(changed_address) && changed_address !== 'this address') // it is ok if the address was never used yet
					return cb("invalid changed address");
				if (!isValidAddress(new_definition_chash) && new_definition_chash !== 'this address' && new_definition_chash !== 'any')
					return cb("invalid new definition chash");
				if (new_definition_chash === 'any' && objValidationState.last_ball_mci < constants.anyDefinitionChangeUpgradeMci)
					return cb("too early use of 'any' in new_definition_chash");
				return cb();
				
			case 'attested':
				if (objValidationState.bNoReferences)
					return cb("no references allowed in address definition");
				if (!isArrayOfLength(args, 2))
					return cb(op+" must have 2 args");
				var attested_address = args[0];
				var arrAttestors = args[1];
				if (bAssetCondition && attested_address === 'this address')
					return cb("asset condition cannot reference this address in "+op);
				if (!isValidAddress(attested_address) && attested_address !== 'this address') // it is ok if the address was never used yet
					return cb("invalid attested address");
				if (!ValidationUtils.isNonemptyArray(arrAttestors))
					return cb("no attestors");
				for (var i=0; i<arrAttestors.length; i++)
					if (!isValidAddress(arrAttestors[i]))
						return cb("invalid attestor address "+arrAttestors[i]);
				if (objValidationState.last_ball_mci < constants.attestedInDefinitionUpgradeMci)
					return cb(op+" not enabled yet");
				return cb();
				
			case 'cosigned by':
				if (bInNegation)
					return cb(op+" cannot be negated");
				if (!isValidAddress(args)) // it is ok if the address was never used yet
					return cb("invalid cosigner address");
				return cb();
				
			case 'not':
				evaluate(args, path, true, cb);
				break;
				
			case 'in data feed':
				if (objValidationState.bNoReferences)
					return cb("no references allowed in address definition");
				if (!Array.isArray(args))
					return cb(op+" arg must be array");
				if (args.length !== 4 && args.length !== 5)
					return cb(op+" must have 4 or 5 args");
				var arrAddresses = args[0];
				var feed_name = args[1];
				var relation = args[2];
				var value = args[3];
				var min_mci = args[4];
				if (!isNonemptyArray(arrAddresses))
					return cb("no addresses in "+op);
				for (var i=0; i<arrAddresses.length; i++)
					if (!isValidAddress(arrAddresses[i])) // it is ok if the address was never used yet
						return cb("address "+arrAddresses[i]+" not valid");
				complexity += arrAddresses.length-1; // 1 complexity point for each address (1 point was already counted)
				if (!isNonemptyString(relation))
					return cb("no relation");
				if (["=", ">", "<", ">=", "<=", "!="].indexOf(relation) === -1)
					return cb("invalid relation: "+relation);
				if (!isNonemptyString(feed_name))
					return cb("no feed_name");
				if (feed_name.length > constants.MAX_DATA_FEED_NAME_LENGTH)
					return cb("feed_name too long");
				if (typeof value === "string"){
					if (!isNonemptyString(value))
						return cb("no value");
					if (value.length > constants.MAX_DATA_FEED_VALUE_LENGTH)
						return cb("value too long");
				}
				else if (typeof value === "number"){
					if (!isInteger(value))
						return cb("no fractional values allowed");
				}
				else
					return cb("invalid value");
				if (typeof min_mci !== 'undefined' && !isNonnegativeInteger(min_mci))
					return cb(op+": invalid min_mci");
				return cb();
				
			case 'in merkle':
				if (bInNegation)
					return cb(op+" cannot be negated");
				if (objValidationState.bNoReferences)
					return cb("no references allowed in address definition");
				if (bAssetCondition)
					return cb("asset condition cannot have "+op);
				if (!Array.isArray(args))
					return cb(op+" arg must be array");
				if (args.length !== 3 && args.length !== 4)
					return cb(op+" must have 3 or 4 args");
				var arrAddresses = args[0];
				var feed_name = args[1];
				var element = args[2];
				var min_mci = args[3];
				if (!isNonemptyArray(arrAddresses))
					return cb("no addresses in "+op);
				for (var i=0; i<arrAddresses.length; i++)
					if (!isValidAddress(arrAddresses[i])) // it is ok if the address was never used yet
						return cb("address "+arrAddresses[i]+" not valid");
				complexity += arrAddresses.length-1; // 1 complexity point for each address (1 point was already counted)
				if (!isNonemptyString(feed_name))
					return cb("no feed_name");
				if (feed_name.length > constants.MAX_DATA_FEED_NAME_LENGTH)
					return cb("feed_name too long");
			//	if (!isStringOfLength(element_hash, constants.HASH_LENGTH))
			//		return cb("incorrect length of element hash");
				if (!element.match(/[\w ~,.\/\\;:!@#$%^&*\(\)=+\[\]\{\}<>\?|-]{1,100}/))
					return cb("incorrect format of merkled element");
				if (typeof min_mci !== 'undefined' && !isNonnegativeInteger(min_mci))
					return cb(op+": invalid min_mci");
				return cb();
				
			case 'mci':
			case 'age':
				var relation = args[0];
				var value = args[1];
				if (!isNonemptyString(relation))
					return cb("no relation");
				if (["=", ">", "<", ">=", "<=", "!="].indexOf(relation) === -1)
					return cb("invalid relation: "+relation);
				if (!isNonnegativeInteger(value))
					return cb(op+" must be a non-neg number");
				return cb();
				
			case 'has':
			case 'has one':
			case 'seen':
				if (objValidationState.bNoReferences)
					return cb("no references allowed in address definition");
				var err = getFilterError(args);
				if (err)
					return cb(err);
				if (op === 'seen'){
					if (!args.address)
						return cb('seen must specify address');
					if (args.address === 'other address')
						return cb('seen cannot be other address');
					if (args.what === 'input' && (args.amount || args.amount_at_least || args.amount_at_most))
						return cb('amount not allowed in seen input');
				}
				if (!args.asset || args.asset === 'base' || bAssetCondition && args.asset === "this asset")
					return cb();
				determineIfAnyOfAssetsIsPrivate([args.asset], function(bPrivate){
					if (bPrivate)
						return cb("asset must be public");
					cb();
				});
				break;
				
			case 'has equal':
			case 'has one equal':
				if (objValidationState.bNoReferences)
					return cb("no references allowed in address definition");
				if (hasFieldsExcept(args, ["equal_fields", "search_criteria"]))
					return cb("unknown fields in "+op);
				
				if (!isNonemptyArray(args.equal_fields))
					return cb("no equal_fields");
				var assocUsedFields = {};
				for (var i=0; i<args.equal_fields.length; i++){
					var field = args.equal_fields[i];
					if (assocUsedFields[field])
						return cb("duplicate "+field);
					assocUsedFields[field] = true;
					if (["asset", "address", "amount", "type"].indexOf(field) === -1)
						return cb("unknown field: "+field);
				}
				
				if (!isArrayOfLength(args.search_criteria, 2))
					return cb("search_criteria must be 2-elements array");
				var arrAssets = [];
				for (var i=0; i<2; i++){
					var filter = args.search_criteria[i];
					var err = getFilterError(filter);
					if (err)
						return cb(err);
					if (!(filter.asset || filter.asset === 'base' || bAssetCondition && filter.asset === "this asset"))
						arrAssets.push(filter.asset);
				}
				if (args.equal_fields.indexOf("type") >= 0 && (args.search_criteria[0].what === "output" || args.search_criteria[1].what === "output"))
					return cb("outputs cannot have type");
				if (arrAssets.length === 0)
					return cb();
				determineIfAnyOfAssetsIsPrivate(arrAssets, function(bPrivate){
					bPrivate ? cb("all assets must be public") : cb();
				});
				break;
				
			case 'sum':
				if (objValidationState.bNoReferences)
					return cb("no references allowed in address definition");
				if (hasFieldsExcept(args, ["filter", "equals", "at_least", "at_most"]))
					return cb("unknown fields in "+op);
				var err = getFilterError(args.filter);
				if (err)
					return cb(err);
				if (args.filter.amount || args.filter.amount_at_least || args.filter.amount_at_most)
					return cb("sum filter cannot restrict amounts");
				if ("equals" in args && !isNonnegativeInteger(args.equals))
					return cb("equals must be nonnegative int");
				if ("at_least" in args && !isPositiveInteger(args.at_least))
					return cb("at_least must be positive int");
				if ("at_most" in args && !isPositiveInteger(args.at_most))
					return cb("at_most must be positive int");
				if ("equals" in args && ("at_least" in args || "at_most" in args))
					return cb("can't have equals and at_least/at_most at the same time")
				if (!("equals" in args) && !("at_least" in args) && !("at_most" in args))
					return cb("at least one of equals, at_least, at_most must be specified");
				if (!args.filter.asset || args.filter.asset === 'base' || bAssetCondition && args.filter.asset === "this asset")
					return cb();
				determineIfAnyOfAssetsIsPrivate([args.filter.asset], function(bPrivate){
					bPrivate ? cb("asset must be public") : cb();
				});
				break;
			case 'formula':
				if (objValidationState.last_ball_mci < constants.formulaUpgradeMci)
					return cb("formulas not allowed at this mci yet");
				formulaParser.validate({ formula: args, complexity: complexity }, function (result) {
					complexity = result.complexity;
					cb(result.error);
				});
				break;
			default:
				return cb("unknown op: "+op);
		}
	}
	
	var complexity = 0;
	evaluate(arrDefinition, 'r', false, function(err, bHasSig){
		if (err)
			return handleResult(err);
		if (!bHasSig && !bAssetCondition)
			return handleResult("each branch must have a signature");
		if (complexity > constants.MAX_COMPLEXITY)
			return handleResult("complexity exceeded");
		handleResult();
	});
}

function evaluateAssetCondition(conn, asset, arrDefinition, objUnit, objValidationState, cb){
	validateAuthentifiers(conn, null, asset, arrDefinition, objUnit, objValidationState, null, cb);
}

// also validates address definition
function validateAuthentifiers(conn, address, this_asset, arrDefinition, objUnit, objValidationState, assocAuthentifiers, cb){
	
	function evaluate(arr, path, cb2){
		var op = arr[0];
		var args = arr[1];
		switch(op){
			case 'or':
				// ['or', [list of options]]
				var res = false;
				var index = -1;
				async.eachSeries(
					args,
					function(arg, cb3){
						index++;
						evaluate(arg, path+'.'+index, function(arg_res){
							res = res || arg_res;
							cb3(); // check all members, even if required minimum already found
							//res ? cb3("found") : cb3();
						});
					},
					function(){
						cb2(res);
					}
				);
				break;
				
			case 'and':
				// ['and', [list of requirements]]
				var res = true;
				var index = -1;
				async.eachSeries(
					args,
					function(arg, cb3){
						index++;
						evaluate(arg, path+'.'+index, function(arg_res){
							res = res && arg_res;
							cb3(); // check all members, even if required minimum already found
							//res ? cb3() : cb3("found");
						});
					},
					function(){
						cb2(res);
					}
				);
				break;
				
			case 'r of set':
				// ['r of set', {required: 2, set: [list of options]}]
				var count = 0;
				var index = -1;
				async.eachSeries(
					args.set,
					function(arg, cb3){
						index++;
						evaluate(arg, path+'.'+index, function(arg_res){
							if (arg_res)
								count++;
							cb3(); // check all members, even if required minimum already found, so that we don't allow invalid sig on unchecked path
							//(count < args.required) ? cb3() : cb3("found");
						});
					},
					function(){
						cb2(count >= args.required);
					}
				);
				break;
				
			case 'weighted and':
				// ['weighted and', {required: 15, set: [{value: boolean_expr, weight: 10}, {value: boolean_expr, weight: 20}]}]
				var weight = 0;
				var index = -1;
				async.eachSeries(
					args.set,
					function(arg, cb3){
						index++;
						evaluate(arg.value, path+'.'+index, function(arg_res){
							if (arg_res)
								weight += arg.weight;
							cb3(); // check all members, even if required minimum already found
							//(weight < args.required) ? cb3() : cb3("found");
						});
					},
					function(){
						cb2(weight >= args.required);
					}
				);
				break;
				
			case 'sig':
				// ['sig', {algo: 'secp256k1', pubkey: 'base64'}]
				//console.log(op, path);
				var signature = assocAuthentifiers[path];
				if (!signature)
					return cb2(false);
				arrUsedPaths.push(path);
				var algo = args.algo || 'secp256k1';
				if (algo === 'secp256k1'){
					if (objValidationState.bUnsigned && signature[0] === "-") // placeholder signature
						return cb2(true);
					var res = ecdsaSig.verify(objValidationState.unit_hash_to_sign, signature, args.pubkey);
					if (!res)
						fatal_error = "bad signature at path "+path;
					cb2(res);
				}
				break;
				
			case 'hash':
				// ['hash', {algo: 'sha256', hash: 'base64'}]
				if (!assocAuthentifiers[path])
					return cb2(false);
				arrUsedPaths.push(path);
				var algo = args.algo || 'sha256';
				if (algo === 'sha256'){
					var res = (args.hash === crypto.createHash("sha256").update(assocAuthentifiers[path], "utf8").digest("base64"));
					if (!res)
						fatal_error = "bad hash at path "+path;
					cb2(res);
				}
				break;
				
			case 'address':
				// ['address', 'BASE32']
				var other_address = args;
				storage.readDefinitionByAddress(conn, other_address, objValidationState.last_ball_mci, {
					ifFound: function(arrInnerAddressDefinition){
						evaluate(arrInnerAddressDefinition, path, cb2);
					},
					ifDefinitionNotFound: function(definition_chash){
						var arrDefiningAuthors = objUnit.authors.filter(function(author){
							return (author.address === other_address && author.definition && objectHash.getChash160(author.definition) === definition_chash);
						});
						if (arrDefiningAuthors.length === 0) // no definition in the current unit
							return cb2(false);
						if (arrDefiningAuthors.length > 1)
							throw Error("more than 1 address definition");
						var arrInnerAddressDefinition = arrDefiningAuthors[0].definition;
						evaluate(arrInnerAddressDefinition, path, cb2);
					}
				});
				break;
				
			case 'definition template':
				// ['definition template', ['unit', {param1: 'value1'}]]
				var unit = args[0];
				var params = args[1];
				conn.query(
					"SELECT payload FROM messages JOIN units USING(unit) \n\
					WHERE unit=? AND app='definition_template' AND main_chain_index<=? AND +sequence='good' AND is_stable=1",
					[unit, objValidationState.last_ball_mci],
					function(rows){
						if (rows.length !== 1)
							throw Error("not 1 template");
						var template = rows[0].payload;
						var arrTemplate = JSON.parse(template);
						var arrFilledTemplate = replaceInTemplate(arrTemplate, params);
						evaluate(arrFilledTemplate, path, cb2);
					}
				);
				break;
				
			case 'seen address':
				// ['seen address', 'BASE32']
				var seen_address = args;
				conn.query(
					"SELECT 1 FROM unit_authors CROSS JOIN units USING(unit) \n\
					WHERE address=? AND main_chain_index<=? AND sequence='good' AND is_stable=1 \n\
					LIMIT 1",
					[seen_address, objValidationState.last_ball_mci],
					function(rows){
						cb2(rows.length > 0);
					}
				);
				break;
				
			case 'seen definition change':
				// ['seen definition change', ['BASE32', 'BASE32']]
				var changed_address = args[0];
				var new_definition_chash = args[1];
				if (changed_address === 'this address')
					changed_address = address;
				if (new_definition_chash === 'this address')
					new_definition_chash = address;
				var and_definition_chash = (new_definition_chash === 'any') ? '' : 'AND definition_chash='+db.escape(new_definition_chash);
				conn.query(
					"SELECT 1 FROM address_definition_changes CROSS JOIN units USING(unit) \n\
					WHERE address=? "+and_definition_chash+" AND main_chain_index<=? AND sequence='good' AND is_stable=1 \n\
					LIMIT 1",
					[changed_address, objValidationState.last_ball_mci],
					function(rows){
						cb2(rows.length > 0);
					}
				);
				break;
				
			case 'seen':
				// ['seen', {what: 'input', asset: 'asset or base', type: 'transfer'|'issue', amount_at_least: 123, amount_at_most: 123, amount: 123, address: 'BASE32'}]
				var filter = args;
				var sql = "SELECT 1 FROM "+filter.what+"s CROSS JOIN units USING(unit) \n\
					LEFT JOIN assets ON asset=assets.unit \n\
					WHERE main_chain_index<=? AND sequence='good' AND is_stable=1 AND (asset IS NULL OR is_private=0) ";
				var params = [objValidationState.last_ball_mci];
				if (filter.asset){
					if (filter.asset === 'base')
						sql += " AND asset IS NULL ";
					else{
						sql += " AND asset=? ";
						params.push(filter.asset);
					}
				}
				if (filter.type){
					sql += " AND type=? ";
					params.push(filter.type);
				}
				if (filter.address){
					sql += " AND address=? ";
					params.push((filter.address === 'this address') ? address : filter.address);
				}
				if (filter.what === 'output'){
					if (filter.amount_at_least){
						sql += " AND amount>=? ";
						params.push(filter.amount_at_least);
					}
					if (filter.amount_at_most){
						sql += " AND amount<=? ";
						params.push(filter.amount_at_most);
					}
					if (filter.amount){
						sql += " AND amount=? ";
						params.push(filter.amount);
					}
				}
				sql += " LIMIT 1";
				conn.query(sql, params, function(rows){
					cb2(rows.length > 0);
				});
				break;
				
			case 'attested':
				// ['attested', ['BASE32', ['BASE32']]]
				var attested_address = args[0];
				var arrAttestors = args[1];
				if (attested_address === 'this address')
					attested_address = address;
				storage.filterAttestedAddresses(
					conn, {arrAttestorAddresses: arrAttestors}, objValidationState.last_ball_mci, [attested_address], function(arrFilteredAddresses){
						cb2(arrFilteredAddresses.length > 0);
					}
				);
				break;
				
			case 'cosigned by':
				// ['cosigned by', 'BASE32']
				var cosigner_address = args;
				var arrAuthorAddresses = objUnit.authors.map(function(author){ return author.address; });
				console.log(op+" "+arrAuthorAddresses.indexOf(cosigner_address));
				cb2(arrAuthorAddresses.indexOf(cosigner_address) >= 0);
				break;
				
			case 'not':
				// useful for conditions such as: after timestamp but there's still no searched value in datafeed
				// sig, hash, and address cannot be negated
				evaluate(args, path, function(not_res){
					cb2(!not_res);
				});
				break;
				
			case 'in data feed':
				// ['in data feed', [['BASE32'], 'data feed name', '=', 'expected value']]
				var arrAddresses = args[0];
				var feed_name = args[1];
				var relation = args[2];
				var value = args[3];
				var min_mci = args[4] || 0;
				dataFeeds.dataFeedExists(arrAddresses, feed_name, relation, value, min_mci, objValidationState.last_ball_mci, false, cb2);
				/*
				var value_condition;
				var index;
				var params = [arrAddresses, feed_name];
				if (typeof value === "string"){
					index = 'byNameStringValue';
					var isNumber = /^-?\d+\.?\d*$/.test(value);
					if (isNumber){
						var bForceNumericComparison = (['>','>=','<','<='].indexOf(relation) >= 0);
						var plus_0 = bForceNumericComparison ? '+0' : '';
						value_condition = '(value'+plus_0+relation+value+' OR int_value'+relation+value+')';
					//	params.push(value, value);
					}
					else{
						value_condition = 'value'+relation+'?';
						params.push(value);
					}
				}
				else{
					index = 'byNameIntValue';
					value_condition = 'int_value'+relation+'?';
					params.push(value);
				}
				params.push(objValidationState.last_ball_mci, min_mci);
				conn.query(
					"SELECT 1 FROM data_feeds "+db.forceIndex(index)+" CROSS JOIN units USING(unit) CROSS JOIN unit_authors USING(unit) \n\
					WHERE address IN(?) AND feed_name=? AND "+value_condition+" \n\
						AND main_chain_index<=? AND main_chain_index>=? AND sequence='good' AND is_stable=1 LIMIT 1",
					params,
					function(rows){
						console.log(op+" "+feed_name+" "+rows.length);
						cb2(rows.length > 0);
					}
				);
				*/
				break;
				
			case 'in merkle':
				// ['in merkle', [['BASE32'], 'data feed name', 'expected value']]
				if (!assocAuthentifiers[path])
					return cb2(false);
				arrUsedPaths.push(path);
				var arrAddresses = args[0];
				var feed_name = args[1];
				var element = args[2];
				var min_mci = args[3] || 0;
				var serialized_proof = assocAuthentifiers[path];
				var proof = merkle.deserializeMerkleProof(serialized_proof);
			//	console.error('merkle root '+proof.root);
				if (!merkle.verifyMerkleProof(element, proof)){
					fatal_error = "bad merkle proof at path "+path;
					return cb2(false);
				}
				dataFeeds.dataFeedExists(arrAddresses, feed_name, '=', proof.root, min_mci, objValidationState.last_ball_mci, false, cb2);
				/*
				conn.query(
					"SELECT 1 FROM data_feeds CROSS JOIN units USING(unit) JOIN unit_authors USING(unit) \n\
					WHERE address IN(?) AND feed_name=? AND value=? AND main_chain_index<=? AND main_chain_index>=? AND sequence='good' AND is_stable=1 \n\
					LIMIT 1",
					[arrAddresses, feed_name, proof.root, objValidationState.last_ball_mci, min_mci],
					function(rows){
						if (rows.length === 0)
							fatal_error = "merkle proof at path "+path+" not found";
						cb2(rows.length > 0);
					}
				);
				*/
				break;
				
			case 'mci':
				var relation = args[0];
				var mci = args[1];
				switch(relation){
					case '>': return cb2(objValidationState.last_ball_mci > mci);
					case '>=': return cb2(objValidationState.last_ball_mci >= mci);
					case '<': return cb2(objValidationState.last_ball_mci < mci);
					case '<=': return cb2(objValidationState.last_ball_mci <= mci);
					case '=': return cb2(objValidationState.last_ball_mci === mci);
					default: throw Error('unknown relation in mci: '+relation);
				}
				break;
				
			case 'age':
				var relation = args[0];
				var age = args[1];
				augmentMessagesAndContinue(function(){
					var arrSrcUnits = [];
					for (var i=0; i<objValidationState.arrAugmentedMessages.length; i++){
						var message = objValidationState.arrAugmentedMessages[i];
						if (message.app !== 'payment' || !message.payload)
							continue;
						var inputs = message.payload.inputs;
						for (var j=0; j<inputs.length; j++){
							var input = inputs[j];
							if (input.type !== 'transfer') // assume age is satisfied for issue, headers commission, and witnessing commission
								continue;
							if (!input.address) // augment should add it
								throw Error('no input address');
							if (input.address === address && arrSrcUnits.indexOf(input.unit) === -1)
								arrSrcUnits.push(input.unit);
						}
					}
					if (arrSrcUnits.length === 0) // not spending anything from our address
						return cb2(false);
					conn.query(
						"SELECT 1 FROM units \n\
						WHERE unit IN(?) AND ?"+relation+"main_chain_index AND main_chain_index<=? AND +sequence='good' AND is_stable=1",
						[arrSrcUnits, objValidationState.last_ball_mci - age, objValidationState.last_ball_mci],
						function(rows){
							var bSatisfies = (rows.length === arrSrcUnits.length);
							console.log(op+" "+bSatisfies);
							cb2(bSatisfies);
						}
					);
				});
				break;
				
			case 'has':
			case 'has one':
				// ['has', {what: 'input', asset: 'asset or base', type: 'transfer'|'issue', amount_at_least: 123, amount_at_most: 123, amount: 123, address: 'BASE32'}]
				// when an address is included (referenced from another address), "this address" refers to the outer address
				augmentMessagesAndEvaluateFilter(op, args, function(res){
					console.log(op+" "+res, args);
					cb2(res);
				});
				break;
				
			case 'has equal':
			case 'has one equal':
				// ['has equal', {equal_fields: ['address', 'amount'], search_criteria: [{what: 'output', asset: 'asset1', address: 'BASE32'}, {what: 'input', asset: 'asset2', type: 'issue', address: 'ANOTHERBASE32'}]}]
				augmentMessagesAndEvaluateFilter("has", args.search_criteria[0], function(res1, arrFirstObjects){
					if (!res1)
						return cb2(false);
					augmentMessagesAndEvaluateFilter("has", args.search_criteria[1], function(res2, arrSecondObjects){
						if (!res2)
							return cb2(false);
						var count_equal_pairs = 0;
						for (var i=0; i<arrFirstObjects.length; i++)
							for (var j=0; j<arrSecondObjects.length; j++)
								if (!args.equal_fields.some(function(field){ return (arrFirstObjects[i][field] !== arrSecondObjects[j][field]); }))
									count_equal_pairs++;
						if (count_equal_pairs === 0)
							return cb2(false);
						if (op === "has one equal" && count_equal_pairs === 1)
							return cb2(true);
						if (op === "has equal" && count_equal_pairs > 0)
							return cb2(true);
						cb2(false);
					});
				});
				break;
				
			case 'sum':
				// ['sum', {filter: {what: 'input', asset: 'asset or base', type: 'transfer'|'issue', address: 'BASE32'}, at_least: 123, at_most: 123, equals: 123}]
				augmentMessagesAndEvaluateFilter("has", args.filter, function(res, arrFoundObjects){
					var sum = 0;
					if (res)
						for (var i=0; i<arrFoundObjects.length; i++)
							sum += arrFoundObjects[i].amount;
					console.log("sum="+sum);
					if (typeof args.equals === "number" && sum === args.equals)
						return cb2(true);
					if (typeof args.at_least === "number" && sum < args.at_least)
						return cb2(false);
					if (typeof args.at_most === "number" && sum > args.at_most)
						return cb2(false);
					cb2(true);
				});
				break;
				
			case 'has definition change':
				// ['has definition change', ['BASE32', 'BASE32']]
				var changed_address = args[0];
				var new_definition_chash = args[1];
				if (changed_address === 'this address')
					changed_address = address;
				if (new_definition_chash === 'this address')
					new_definition_chash = address;
				cb2(objUnit.messages.some(function(message){
					if (message.app !== 'address_definition_change')
						return false;
					if (!message.payload)
						return false;
					if (new_definition_chash !== 'any' && message.payload.definition_chash !== new_definition_chash)
						return false;
					var payload_address = message.payload.address || objUnit.authors[0].address;
					return (payload_address === changed_address);
				}));
				break;
			
			case 'formula':
				var formula = args;
				augmentMessagesOrIgnore(formula, function (messages) {
					var trigger = {};
					objUnit.messages.forEach(function (message) {
						if (message.app === 'data' && !trigger.data) // use the first data mesage, ignore the subsequent ones
							trigger.data = message.payload;
					});
					var opts = {
						conn: conn,
						formula: formula,
						messages: messages,
						trigger: trigger,
						objValidationState: objValidationState,
						address: address
					};
					formulaParser.evaluate(opts, function (err, result) {
						if (err)
							return cb2(false);
						if (typeof result === 'boolean') {
							cb2(result);
						} else if (typeof result === 'string') {
							cb2(!!result);
						} else if (Decimal.isDecimal(result)) {
							cb2(!result.eq(0))
						} else {
							cb2(false);
						}
					});
				});
				break;
		}
	}
	
	function augmentMessagesOrIgnore(formula, cb){
		if (objValidationState.arrAugmentedMessages || /input/.test(formula)){
			augmentMessagesAndContinue(function () {
				cb(objValidationState.arrAugmentedMessages);
			});
		}else{
			cb(objUnit.messages);
		}
	}
	
	function augmentMessagesAndContinue(next){
		if (!objValidationState.arrAugmentedMessages)
			augmentMessages(next);
		else
			next();
	}
	
	function augmentMessagesAndEvaluateFilter(op, filter, handleResult){
		function doEvaluateFilter(){
			//console.log("augmented: ", objValidationState.arrAugmentedMessages[0].payload);
			evaluateFilter(op, filter, handleResult);
		}
		if (!objValidationState.arrAugmentedMessages && filter.what === "input" && (filter.address || typeof filter.amount === "number" || typeof filter.amount_at_least === "number" || typeof filter.amount_at_most === "number"))
			augmentMessages(doEvaluateFilter);
		else
			doEvaluateFilter();
	}
	
	
	function evaluateFilter(op, filter, handleResult){
		var arrFoundObjects = [];
		for (var i=0; i<objUnit.messages.length; i++){
			var message = objUnit.messages[i];
			if (message.app !== "payment" || !message.payload) // we consider only public payments
				continue;
			var payload = message.payload;
			if (filter.asset){
				if (filter.asset === "base"){
					if (payload.asset)
						continue;
				}
				else if (filter.asset === "this asset"){
					if (payload.asset !== this_asset)
						continue;
				}
				else{
					if (payload.asset !== filter.asset)
						continue;
				}
			}
			if (filter.what === "input"){
				for (var j=0; j<payload.inputs.length; j++){
					var input = payload.inputs[j];
					if (input.type === "headers_commission" || input.type === "witnessing")
						continue;
					if (filter.type){
						var type = input.type || "transfer";
						if (type !== filter.type)
							continue;
					}
					var augmented_input = objValidationState.arrAugmentedMessages ? objValidationState.arrAugmentedMessages[i].payload.inputs[j] : null;
					if (filter.address){
						if (filter.address === 'this address'){
							if (augmented_input.address !== address)
								continue;
						}
						else if (filter.address === 'other address'){
							if (augmented_input.address === address)
								continue;
						}
						else { // normal address
							if (augmented_input.address !== filter.address)
								continue;
						}
					}
					if (filter.amount && augmented_input.amount !== filter.amount)
						continue;
					if (filter.amount_at_least && augmented_input.amount < filter.amount_at_least)
						continue;
					if (filter.amount_at_most && augmented_input.amount > filter.amount_at_most)
						continue;
					arrFoundObjects.push(augmented_input || input);
				}
			} // input
			else if (filter.what === "output"){
				for (var j=0; j<payload.outputs.length; j++){
					var output = payload.outputs[j];
					if (filter.address){
						if (filter.address === 'this address'){
							if (output.address !== address)
								continue;
						}
						else if (filter.address === 'other address'){
							if (output.address === address)
								continue;
						}
						else { // normal address
							if (output.address !== filter.address)
								continue;
						}
					}
					if (filter.amount && output.amount !== filter.amount)
						continue;
					if (filter.amount_at_least && output.amount < filter.amount_at_least)
						continue;
					if (filter.amount_at_most && output.amount > filter.amount_at_most)
						continue;
					arrFoundObjects.push(output);
				}
			} // output
		}
		if (arrFoundObjects.length === 0)
			return handleResult(false);
		if (op === "has one" && arrFoundObjects.length === 1)
			return handleResult(true);
		if (op === "has" && arrFoundObjects.length > 0)
			return handleResult(true, arrFoundObjects);
		handleResult(false);
	}

	
	function augmentMessages(onDone){
		console.log("augmenting");
		var arrAuthorAddresses = objUnit.authors.map(function(author){ return author.address; });
		objValidationState.arrAugmentedMessages = _.cloneDeep(objUnit.messages);
		async.eachSeries(
			objValidationState.arrAugmentedMessages,
			function(message, cb3){
				if (message.app !== 'payment' || !message.payload) // we are looking only for public payments
					return cb3();
				var payload = message.payload;
				if (!payload.inputs) // skip now, will choke when checking the message
					return cb3();
				console.log("augmenting inputs");
				async.eachSeries(
					payload.inputs,
					function(input, cb4){
						console.log("input", input);
						if (input.type === "issue"){
							if (!input.address)
								input.address = arrAuthorAddresses[0];
							cb4();
						}
						else if (!input.type){
							input.type = "transfer";
							conn.query(
								"SELECT amount, address FROM outputs WHERE unit=? AND message_index=? AND output_index=?",
								[input.unit, input.message_index, input.output_index],
								function(rows){
									if (rows.length === 1){
										console.log("src", rows[0]);
										input.amount = rows[0].amount;
										input.address = rows[0].address;
									} // else will choke when checking the message
									else
										console.log(rows.length+" src outputs found");
									cb4();
								}
							);
						}
						else // ignore headers commissions and witnessing
							cb4();
					},
					cb3
				);
			},
			onDone
		);
	}
	
	var bAssetCondition = (assocAuthentifiers === null);
	if (bAssetCondition && address || !bAssetCondition && this_asset)
		throw Error("incompatible params");
	var arrAuthentifierPaths = bAssetCondition ? null : Object.keys(assocAuthentifiers);
	var fatal_error = null;
	var arrUsedPaths = [];
	
	// we need to re-validate the definition every time, not just the first time we see it, because:
	// 1. in case a referenced address was redefined, complexity might change and exceed the limit
	// 2. redefinition of a referenced address might introduce loops that will drive complexity to infinity
	// 3. if an inner address was redefined by keychange but the definition for the new keyset not supplied before last ball, the address
	// becomes temporarily unusable
	validateDefinition(conn, arrDefinition, objUnit, objValidationState, arrAuthentifierPaths, bAssetCondition, function(err){
		if (err)
			return cb(err);
		//console.log("eval def");
		evaluate(arrDefinition, 'r', function(res){
			if (fatal_error)
				return cb(fatal_error);
			if (!bAssetCondition && arrUsedPaths.length !== Object.keys(assocAuthentifiers).length)
				return cb("some authentifiers are not used, res="+res+", used="+arrUsedPaths+", passed="+JSON.stringify(assocAuthentifiers));
			cb(null, res);
		});
	});
}

function replaceInTemplate(arrTemplate, params){
	function replaceInVar(x){
		switch (typeof x){
			case 'number':
			case 'boolean':
				return x;
			case 'string':
				// searching for pattern "$name"
				if (x.charAt(0) !== '$')
					return x;
				var name = x.substring(1);
				if (!(name in params))
					throw new NoVarException("variable "+name+" not specified, template "+JSON.stringify(arrTemplate)+", params "+JSON.stringify(params));
				return params[name]; // may change type if params[name] is not a string
			case 'object':
				if (Array.isArray(x))
					for (var i=0; i<x.length; i++)
						x[i] = replaceInVar(x[i]);
				else
					for (var key in x)
						x[key] = replaceInVar(x[key]);
				return x;
			default:
				throw Error("unknown type");
		}
	}
	return replaceInVar(_.cloneDeep(arrTemplate));
}

function NoVarException(error){
	this.error = error;
	this.toString = function(){
		return this.error;
	};
}

function hasReferences(arrDefinition){
	
	function evaluate(arr){
		var op = arr[0];
		var args = arr[1];
	
		switch(op){
			case 'or':
			case 'and':
				for (var i=0; i<args.length; i++)
					if (evaluate(args[i]))
						return true;
				return false;
				
			case 'r of set':
				for (var i=0; i<args.set.length; i++)
					if (evaluate(args.set[i]))
						return true;
				return false;
				
			case 'weighted and':
				for (var i=0; i<args.set.length; i++)
					if (evaluate(args.set[i].value))
						return true;
				return false;
				
			case 'sig':
			case 'hash':
			case 'cosigned by':
				return false;
				
			case 'not':
				return evaluate(args);
				
			case 'address':
			case 'definition template':
			case 'seen address':
			case 'seen':
			case 'in data feed':
			case 'in merkle':
			case 'mci':
			case 'age':
			case 'has':
			case 'has one':
			case 'has equal':
			case 'has one equal':
			case 'sum':
				return true;
				
			default:
				throw Error("unknown op: "+op);
		}
	}
	
	return evaluate(arrDefinition);
}

exports.validateDefinition = validateDefinition;
exports.evaluateAssetCondition = evaluateAssetCondition;
exports.validateAuthentifiers = validateAuthentifiers;
exports.hasReferences = hasReferences;
exports.replaceInTemplate = replaceInTemplate;
