/*jslint node: true */
"use strict";
var db = require('./db.js');
var objectHash = require('./object_hash.js');
var device = require('./device.js');
var async = require('async');

var bots = [];

function getBotByID(id, cb) {
	for (var i in bots) {
		var bot = bots[i];
		if (bot.id == id) {
			return setPairingStatus(bot, cb);
		}
	}
}

function load(cb) {
	device.requestFromHub("hub/get_bots", false, function(err, bots){
		if (err != null) {
			return cb(err, null);
		}
		async.eachSeries(bots, 
			function(bot, cb) {
				setPairingStatus(bot, function(handled_bot){
					bot.isPaired = handled_bot.isPaired;
					cb();
				})
			},
			function(){
				cb(err, bots);
			}
		);
	})
}

function setPairingStatus(bot, cb) {
	var pubkey = bot.pairing_code.substr(0, bot.pairing_code.indexOf('@'));
	bot.device_address = objectHash.getDeviceAddress(pubkey);
	db.query("SELECT 1 FROM correspondent_devices WHERE device_address = ?", [bot.device_address], function(rows){
		bot.isPaired = (rows.length == 1);
		cb(bot);
	});
}

exports.load = load;
exports.getBotByID = getBotByID;