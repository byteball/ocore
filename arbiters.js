/*jslint node: true */
"use strict";
var db = require('./db.js');
var device = require('./device.js');
var http = require('https');
var validationUtils = require('ocore/validation_utils.js');

var arbStoreInfos = {}; // map arbiter_address => arbstoreInfo {address: ..., cut: ...}

function getInfo(address, cb) {
	var cb = cb || function() {};
	db.query("SELECT device_pub_key, real_name FROM wallet_arbiters WHERE arbiter_address=?", [address], function(rows){
		if (rows.length && rows[0].real_name) { // request again if no real name
			cb(null, rows[0]);
		} else {
			device.requestFromHub("hub/get_arbstore_url", address, function(err, url){
				if (err) {
					return cb(err);
				}
				requestInfoFromArbStore(url+'/api/arbiter/'+address, function(err, info){
					if (err) {
						return cb(err);
					}
					db.query("REPLACE INTO wallet_arbiters (arbiter_address, device_pub_key, real_name) VALUES (?, ?, ?)", [address, info.device_pub_key, info.real_name], function() {cb(null, info);});
				});
			});
		}
	});
}

function requestInfoFromArbStore(url, cb){
	http.get(url, function(resp){
		var data = '';
		resp.on('data', function(chunk){
			data += chunk;
		});
		resp.on('end', function(){
			try {
				cb(null, JSON.parse(data));
			} catch(ex) {
				cb(ex);
			}
		});
	}).on("error", cb);
}

function getArbstoreInfo(arbiter_address, cb) {
	if (!cb)
		return new Promise(resolve => getArbstoreInfo(arbiter_address, resolve));
	if (arbStoreInfos[arbiter_address]) return cb(null, arbStoreInfos[arbiter_address]);
	device.requestFromHub("hub/get_arbstore_url", arbiter_address, function(err, url){
		if (err) {
			return cb(err);
		}
		requestInfoFromArbStore(url+'/api/get_info', function(err, info){
			if (err)
				return cb(err);
			if (!info.address || !validationUtils.isValidAddress(info.address) || parseFloat(info.cut) === NaN || parseFloat(info.cut) < 0 || parseFloat(info.cut) >= 1) {
				cb("mailformed info received from ArbStore");
			}
			arbStoreInfos[arbiter_address] = info;
			cb(null, info);
		});
	});
}

exports.getInfo = getInfo;
exports.getArbstoreInfo = getArbstoreInfo;