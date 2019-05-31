/*jslint node: true */
"use strict";
var async = require('async');
var db = require('./db.js');
var constants = require('./constants.js');
var objectHash = require('./object_hash.js');
var ecdsaSig = require('./signature.js');
var _ = require('lodash');
var storage = require('./storage.js');
var composer = require('./composer.js');
var Definition = require("./definition.js");
var ValidationUtils = require("./validation_utils.js");


function repeatString(str, times){
	if (str.repeat)
		return str.repeat(times);
	return (new Array(times+1)).join(str);
}




// with bNetworkAware=true, last_ball_unit is added, the definition is taken at this point, and the definition is added only if necessary
function signMessage(message, from_address, signer, bNetworkAware, handleResult){
	if (typeof bNetworkAware === 'function') {
		handleResult = bNetworkAware;
		bNetworkAware = false;
	}
	var objAuthor = {
		address: from_address,
		authentifiers: {}
	};
	var objUnit = {
		version: constants.version,
		signed_message: message,
		authors: [objAuthor]
	};
	
	function setDefinitionAndLastBallUnit(cb) {
		if (bNetworkAware) {
			composer.composeAuthorsAndMciForAddresses(db, [from_address], signer, function (err, authors, last_ball_unit) {
				if (err)
					return handleResult(err);
				objUnit.authors = authors;
				objUnit.last_ball_unit = last_ball_unit;
				cb();
			});
		}
		else {
			signer.readDefinition(db, from_address, function (err, arrDefinition) {
				if (err)
					throw Error("signMessage: can't read definition: " + err);
				objAuthor.definition = arrDefinition;
				cb();
			});
		}
	}

	var assocSigningPaths = {};
	signer.readSigningPaths(db, from_address, function(assocLengthsBySigningPaths){
		var arrSigningPaths = Object.keys(assocLengthsBySigningPaths);
		assocSigningPaths[from_address] = arrSigningPaths;
		for (var j=0; j<arrSigningPaths.length; j++)
			objAuthor.authentifiers[arrSigningPaths[j]] = repeatString("-", assocLengthsBySigningPaths[arrSigningPaths[j]]);
		setDefinitionAndLastBallUnit(function(){
			var text_to_sign = objectHash.getSignedPackageHashToSign(objUnit);
			async.each(
				objUnit.authors,
				function(author, cb2){
					var address = author.address;
					async.each( // different keys sign in parallel (if multisig)
						assocSigningPaths[address],
						function(path, cb3){
							if (signer.sign){
								signer.sign(objUnit, {}, address, path, function(err, signature){
									if (err)
										return cb3(err);
									// it can't be accidentally confused with real signature as there are no [ and ] in base64 alphabet
									if (signature === '[refused]')
										return cb3('one of the cosigners refused to sign');
									author.authentifiers[path] = signature;
									cb3();
								});
							}
							else{
								signer.readPrivateKey(address, path, function(err, privKey){
									if (err)
										return cb3(err);
									author.authentifiers[path] = ecdsaSig.sign(text_to_sign, privKey);
									cb3();
								});
							}
						},
						function(err){
							cb2(err);
						}
					);
				},
				function(err){
					if (err)
						return handleResult(err);
					console.log(require('util').inspect(objUnit, {depth:null}));
					handleResult(null, objUnit);
				}
			);
		});
	});
}




function validateSignedMessage(conn, objSignedMessage, address, handleResult) {
	if (!handleResult) {
		handleResult = objSignedMessage;
		objSignedMessage = conn;
		conn = db;
	}
	if (typeof objSignedMessage !== 'object')
		return handleResult("not an object");
	if (ValidationUtils.hasFieldsExcept(objSignedMessage, ["signed_message", "authors", "last_ball_unit", "timestamp", "version"]))
		return handleResult("unknown fields");
	if (!('signed_message' in objSignedMessage))
		return handleResult("no signed message");
	if ("version" in objSignedMessage && constants.supported_versions.indexOf(objSignedMessage.version) === -1)
		return handleResult("unsupported version: " + objSignedMessage.version);
	var authors = objSignedMessage.authors;
	if (!ValidationUtils.isNonemptyArray(authors))
		return handleResult("no authors");
	if (!address && !ValidationUtils.isArrayOfLength(authors, 1))
		return handleResult("authors not an array of len 1");
	var the_author;
	for (var i = 0; i < authors.length; i++){
		var author = authors[i];
		if (ValidationUtils.hasFieldsExcept(author, ['address', 'definition', 'authentifiers']))
			return handleResult("foreign fields in author");
		if (author.address === address)
			the_author = author;
		else if (!ValidationUtils.isValidAddress(author.address))
			return handleResult("not valid address");
		if (!ValidationUtils.isNonemptyObject(author.authentifiers))
			return handleResult("no authentifiers");
	}
	if (!the_author) {
		if (address)
			return cb("not signed by the expected address");
		the_author = authors[0];
	}
	var objAuthor = the_author;
	var bNetworkAware = ("last_ball_unit" in objSignedMessage);
	if (bNetworkAware && !ValidationUtils.isValidBase64(objSignedMessage.last_ball_unit, constants.HASH_LENGTH))
		return handleResult("invalid last_ball_unit");
	
	function validateOrReadDefinition(cb) {
		var bHasDefinition = ("definition" in objAuthor);
		if (bNetworkAware) {
			conn.query("SELECT main_chain_index FROM units WHERE unit=?", [objSignedMessage.last_ball_unit], function (rows) {
				if (rows.length === 0)
					return handleResult("last_ball_unit " + objSignedMessage.last_ball_unit + " not found");
				var last_ball_mci = rows[0].main_chain_index;
				storage.readDefinitionByAddress(conn, objAuthor.address, last_ball_mci, {
					ifDefinitionNotFound: function (definition_chash) { // first use of the definition_chash (in particular, of the address, when definition_chash=address)
						if (!bHasDefinition)
							return handleResult("definition expected but not provided");
						if (objectHash.getChash160(objAuthor.definition) !== definition_chash)
							return handleResult("wrong definition: "+objectHash.getChash160(objAuthor.definition) +"!=="+ definition_chash);
						cb(objAuthor.definition, last_ball_mci);
					},
					ifFound: function (arrAddressDefinition) {
						if (bHasDefinition)
							return handleResult("should not include definition");
						cb(arrAddressDefinition, last_ball_mci);
					}
				});
			});
		}
		else {
			if (!bHasDefinition)
				return handleResult("no definition");
			try {
				if (objectHash.getChash160(objAuthor.definition) !== objAuthor.address)
					return handleResult("wrong definition: " + objectHash.getChash160(objAuthor.definition) + "!==" + objAuthor.address);
			} catch (e) {
				return handleResult("failed to calc address definition hash: " + e);
			}
			cb(objAuthor.definition, -1);
		}
	}

	validateOrReadDefinition(function (arrAddressDefinition, last_ball_mci) {
		var objUnit = _.clone(objSignedMessage);
		objUnit.messages = []; // some ops need it
		try {
			var objValidationState = {
				unit_hash_to_sign: objectHash.getSignedPackageHashToSign(objSignedMessage),
				last_ball_mci: last_ball_mci,
				bNoReferences: !bNetworkAware
			};
		}
		catch (e) {
			return handleResult("failed to calc unit_hash_to_sign: " + e);
		}
		// passing db as null
		Definition.validateAuthentifiers(
			conn, objAuthor.address, null, arrAddressDefinition, objUnit, objValidationState, objAuthor.authentifiers,
			function (err, res) {
				if (err) // error in address definition
					return handleResult(err);
				if (!res) // wrong signature or the like
					return handleResult("authentifier verification failed");
				handleResult(null, last_ball_mci);
			}
		);
	});
}

// inconsistent for multisig addresses
function validateSignedMessageSync(objSignedMessage){
	var err;
	var bCalledBack = false;
	validateSignedMessage(objSignedMessage, function(_err){
		err = _err;
		bCalledBack = true;
	});
	if (!bCalledBack)
		throw Error("validateSignedMessage is not sync");
	return err;
}



exports.signMessage = signMessage;
exports.validateSignedMessage = validateSignedMessage;
exports.validateSignedMessageSync = validateSignedMessageSync;
