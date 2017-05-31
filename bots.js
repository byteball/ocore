/*jslint node: true */
"use strict";
var db = require('./db.js');
var objectHash = require('./object_hash.js');
var async = require('async');

function getBotByID(id, cb) {
	db.query("SELECT * FROM bots WHERE id = ?", [id], function(rows){
		setPairingStatus(rows[0], cb);
	});
}

function load(cb) {
	db.query("SELECT id, name, pairing_code, description FROM bots", [], function(rows){
		async.eachSeries(rows, 
			function(bot, cb) {
				setPairingStatus(bot, function(handled_bot){
					bot.isPaired = handled_bot.isPaired;
					cb();
				})
			},
			function(){
				cb(rows);
			}
		);
	});
}

function setPairingStatus(bot, cb) {
	var pubkey = bot.pairing_code.substr(0, bot.pairing_code.indexOf('@'));
	bot.device_address = objectHash.getDeviceAddress(pubkey);
	db.query("SELECT 1 FROM correspondent_devices WHERE device_address = ?", [bot.device_address], function(rows){
		bot.isPaired = rows.length == 1 ? true : false;
		cb(bot);
	});
}

exports.load = load;
exports.getBotByID = getBotByID;