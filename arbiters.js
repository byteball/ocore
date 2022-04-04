/*jslint node: true */
"use strict";
var db = require('./db.js');
var device = require('./device.js');
var http = require('https');

var arbStoreInfos = {}; // map arbiter_address => arbstoreInfo {address: ..., cut: ...}

function getInfo(address, cb) {
	var cb = cb || function() {};
	db.query("SELECT device_pub_key, real_name FROM wallet_arbiters WHERE arbiter_address=?", [address], function(rows){
		if (rows.length) {
			cb(rows[0]);
		} else {
			device.requestFromHub("hub/get_arbstore_url", address, function(err, url){
				if (err) {
					console.error(err);
					return cb();
				}
				requestInfoFromArbStore(url+'/api/arbiter/'+address, function(err, info){
					if (err) {
						console.error(err);
						return cb();
					}
					db.query("INSERT INTO wallet_arbiters (arbiter_address, device_pub_key, real_name) VALUES (?, ?, ?)", [address, info.device_pub_key, info.real_name], function() {cb(info);});
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
			cb(null, JSON.parse(data));
		});
	}).on("error", cb);
}

function getArbstoreInfo(arbiter_address, cb) {
	if (!cb)
		return new Promise(resolve => getArbstoreInfo(arbiter_address, resolve));
	if (arbStoreInfos[arbiter_address]) return cb(arbStoreInfos[arbiter_address]);
	device.requestFromHub("hub/get_arbstore_url", arbiter_address, function(err, url){
		if (err) {
			return cb();
		}
		requestInfoFromArbStore(url+'/api/get_address_and_cut', function(err, info){
			if (err)
				return cb();
			arbStoreInfos[arbiter_address] = info;
			cb(info);
		});
	});
}

exports.getInfo = getInfo;
exports.getArbstoreInfo = getArbstoreInfo;