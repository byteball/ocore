/*jslint node: true */
"use strict";
var db = require('./db.js');
var device = require('./device.js');
var http = require('http');

function getInfo(address, cb) {
	var cb = cb || function() {};
	db.query("SELECT device_pub_key, real_name FROM arbiters_wallet WHERE arbiter_address=?", [address], function(rows){
		if (rows.length) {
			cb(rows[0]);
		} else {
			device.requestFromHub("hub/get_arbstore_address", address, function(err, host){
				requestInfoFromArbStore(address, host, function(err, info){
					if (err) {
						console.error(err);
						return cb();
					}
					db.query("UPDATE arbiters_wallet SET device_pub_key=?, real_name=? WHERE arbiter_address=?", [info.device_pub_key, info.real_name, address]);
					cb(info);
				});
			});
		}
	});
}

function requestInfoFromArbStore(address, host, cb){
	http.get('http://'+host+'/api/arbiter/'+address, function(resp){
		var data = '';
		resp.on('data', function(chunk){
			data += chunk;
		});
		resp.on('end', function(){
			cb(null, data);
		});
	}).on("error", cb);
}

exports.getInfo = getInfo;