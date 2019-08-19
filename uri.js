/*jslint node: true */
"use strict";
var ValidationUtils = require("./validation_utils.js");
var constants = require("./constants.js");
var conf = require('./conf.js');
var Mnemonic = require('bitcore-mnemonic');


function parseUri(uri, callbacks){
	var protocol = conf.program || 'byteball';
	var re = new RegExp('^'+protocol+':(.+)$', 'i');
	var arrMatches = uri.match(re);
	if (!arrMatches){ // try with obyte
		var oprotocol = protocol.replace(/byteball/i, 'obyte');
		re = new RegExp('^'+oprotocol+':(.+)$', 'i');
		arrMatches = uri.match(re);
		if (!arrMatches)
			return callbacks.ifError("no "+protocol+" or "+oprotocol+" prefix");
	}
	var value = arrMatches[1];
	var objRequest = {};
	
	// pairing / start a chat
//	var arrPairingMatches = value.match(/^([\w\/+]{44})@([\w.:\/-]+)(?:#|%23)([\w\/+]+)$/);
	var arrPairingMatches = value.replace('%23', '#').match(/^([\w\/+]{44})@([\w.:\/-]+)#(.+)$/);
	if (arrPairingMatches){
		objRequest.type = "pairing";
		objRequest.pubkey = arrPairingMatches[1];
		objRequest.hub = arrPairingMatches[2];
		objRequest.pairing_secret = arrPairingMatches[3];
		//if (objRequest.pairing_secret.length > 12)
		//    return callbacks.ifError("pairing secret too long");
		return callbacks.ifOk(objRequest);
	}
	
	// authentication/authorization
	var arrAuthMatches = value.match(/^auth\?(.+)$/);
	if (arrAuthMatches){
		objRequest.type = "auth";
		var query_string = arrAuthMatches[1];
		var assocParams = parseQueryString(query_string);
		if (assocParams.url){
			if (!assocParams.url.match(/^https?:\/\//))
				return callbacks.ifError("invalid url");
		}
		else if (assocParams.device){
			if (!assocParams.pairing_secret)
				return callbacks.ifError("no pairing secret in auth params");
			if (!assocParams.app)
				return callbacks.ifError("no app in auth params");
			var arrParts = assocParams.device.split('@');
			if (arrParts.length !== 2)
				return callbacks.ifError("not 2 parts in full device address");
			var pubkey = arrParts[0];
			var hub = arrParts[1];
			if (pubkey.length !== constants.PUBKEY_LENGTH)
				return callbacks.ifError("pubkey length is not 44");
			if (hub.match(/[^\w\.:-]/))
				return callbacks.ifError("invalid hub address");
		}
		else
			return callbacks.ifError("neither url nor device in auth params");
		objRequest.params = assocParams;
		return callbacks.ifOk(objRequest);
	}
	
	function handleMnemonic(mnemonic){
		try {
			if (Mnemonic.isValid(mnemonic)) {
				objRequest.mnemonic = mnemonic;
				return callbacks.ifOk(objRequest);
			} else {
				return callbacks.ifError("invalid mnemonic");
			}
		} catch(e) {
			return callbacks.ifError("invalid mnemonic");
		}
	}

	// claim textcoin using mnemonic
	var arrMnemonicMatches = value.match(/^textcoin\?(.+)$/);
	if (arrMnemonicMatches){
		objRequest.type = "textcoin";
		var mnemonic = arrMnemonicMatches[1].split('-').join(' ');
		return handleMnemonic(mnemonic);
	}
	var arrWords = value.split('-');
	if (arrWords.length === 12){
		objRequest.type = "textcoin";
		mnemonic = arrWords.join(' ');
		return handleMnemonic(mnemonic);
	}
	
	// pay to address or send data
	var arrParts = value.split('?');
	if (arrParts.length > 2)
		return callbacks.ifError("too many question marks");
	var main_part = decodeURIComponent(arrParts[0]);
	var query_string = arrParts[1];

	if (main_part === 'data') {
		if (!query_string)
			return callbacks.ifError("data without query string");
		var assocParams = parseQueryString(query_string);
		var app = assocParams.app;
		if (app !== 'data' && app !== 'data_feed' && app !== 'attestation' && app !== 'profile' && app !== 'poll' && app !== 'vote' && app !== 'definition')
			return callbacks.ifError("invalid app: " + app);
		if (app === 'attestation' && !ValidationUtils.isValidAddress(assocParams.address))
			return callbacks.ifError("invalid attested address: "+assocParams.address);
		if (app === 'vote' && !ValidationUtils.isValidBase64(assocParams.unit, constants.HASH_LENGTH))
			return callbacks.ifError("invalid poll unit: " + assocParams.unit);
		objRequest = assocParams;
		objRequest.type = 'data';
		return callbacks.ifOk(objRequest);
	}

	var address = main_part;
	if (!ValidationUtils.isValidAddress(address) && !ValidationUtils.isValidEmail(address) && !address.match(/^(steem\/|reddit\/|@).{3,}/i) && !address.match(/^\+\d{9,14}$/))
		return callbacks.ifError("address "+address+" is invalid");
	objRequest.type = "address";
	objRequest.address = address;
	if (query_string){
		var assocParams = parseQueryString(query_string);
		var strAmount = assocParams.amount;
		if (typeof strAmount === 'string'){
			var amount = parseInt(strAmount);
			if (amount + '' !== strAmount)
				return callbacks.ifError("invalid amount: "+strAmount);
			if (!ValidationUtils.isPositiveInteger(amount))
				return callbacks.ifError("nonpositive amount: "+strAmount);
			objRequest.amount = amount;
		}
		var asset = assocParams.asset;
		if (typeof asset === 'string'){
			if (asset !== 'base' && !ValidationUtils.isValidBase64(asset, constants.HASH_LENGTH)) // invalid asset
				return callbacks.ifError('invalid asset: '+asset);
			objRequest.asset = asset;
		}
		if (!objRequest.asset && objRequest.amount) // when amount is set, asset must be also set
			objRequest.asset = 'base';
		var device_address = assocParams.device_address;
		if (device_address){
			if (!ValidationUtils.isValidDeviceAddress(device_address))
				return callbacks.ifError('invalid device address: '+device_address);
			objRequest.device_address = device_address;
		}
		var single_address = assocParams.single_address;
		if (single_address) {
			single_address = single_address.replace(/^single/, '');
			if (single_address && !ValidationUtils.isValidAddress(single_address))
				single_address = 1;
			objRequest.single_address = single_address;
		}
		var base64data = assocParams.base64data;
		if (base64data){
			objRequest.base64data = base64data;
		}
	}
	callbacks.ifOk(objRequest);
}

function parseQueryString(str, delimiter){
	if (!delimiter)
		delimiter = '&';
	var arrPairs = str.split(delimiter);
	var assocParams = {};
	arrPairs.forEach(function(pair){
		var arrNameValue = pair.split('=');
		if (arrNameValue.length !== 2)
			return;
		var name = decodeURIComponent(arrNameValue[0]);
		var value = decodeURIComponent(arrNameValue[1]);
		assocParams[name] = value;
	});
	return assocParams;
}



exports.parseQueryString = parseQueryString;
exports.parseUri = parseUri;
