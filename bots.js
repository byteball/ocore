/*jslint node: true */
const db = require('./db.js');
const objectHash = require('./object_hash.js');
const device = require('./device.js');
const async = require('async');

let bots_cache = [];

function getBotByID(id, cb) {
	for (const i in bots_cache) {
		const bot = bots_cache[i];
		if (bot.id == id) {
			return setPairingStatus(bot, cb);
		}
	}
}

function load(cb) {
	device.requestFromHub("hub/get_bots", false, (err, bots) => {
		if (err != null) {
			return cb(err, null);
		}
		async.eachSeries(bots, 
			(bot, cb) => {
				setPairingStatus(bot, ({isPaired}) => {
					bot.isPaired = isPaired;
					cb();
				})
			},
			() => {
				bots_cache = bots;
				cb(err, bots);
			}
		);
	})
}

function setPairingStatus(bot, cb) {
	const pubkey = bot.pairing_code.substr(0, bot.pairing_code.indexOf('@'));
	bot.device_address = objectHash.getDeviceAddress(pubkey);
	db.query("SELECT 1 FROM correspondent_devices WHERE device_address = ?", [bot.device_address], ({length}) => {
		bot.isPaired = (length == 1);
		cb(bot);
	});
}

exports.load = load;
exports.getBotByID = getBotByID;