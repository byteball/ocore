/*jslint node: true */
"use strict";
var db = require('./db.js');
var device = require('./device.js');
var http = require('https');

function getInfo(address, cb) {
	var cb = cb || function() {};
	db.query("SELECT device_pub_key, real_name FROM wallet_arbiters WHERE arbiter_address=?", [address], function(rows){
		if (rows.length) {
			cb(rows[0]);
		} else {
			device.requestFromHub("hub/get_arbstore_address", address, function(err, arbstore_address){
				if (!arbstore_address) {
					console.warn("no arbstore for arbiter address", address);
					return cb();
				}
				requestInfoFromArbStore(address, arbstore_address, function(err, info){
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

function requestInfoFromArbStore(address, arbstore_address, cb){
	http.get(arbstore_address+'/api/arbiter/'+address, function(resp){
		var data = '';
		resp.on('data', function(chunk){
			data += chunk;
		});
		resp.on('end', function(){
			cb(null, JSON.parse(data));
		});
	}).on("error", cb);
}

exports.getInfo = getInfo;