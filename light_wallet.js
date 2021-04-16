/*jslint node: true */
"use strict";
var db = require('./db.js');
var conf = require('./conf.js');
var myWitnesses = require('./my_witnesses.js');
var network = require('./network.js');
var storage = require('./storage.js');
var walletGeneral = require('./wallet_general.js');
var light = require('./light.js');
var eventBus = require('./event_bus.js');
var breadcrumbs = require('./breadcrumbs.js');

var RECONNECT_TO_LIGHT_VENDOR_PERIOD = 60*1000;
var bFirstHistoryReceived = false;

function setLightVendorHost(light_vendor_host){
	if (network.light_vendor_url)
		return console.log("light_vendor_url is already set, current:" + network.light_vendor_url + ", new one:" + light_vendor_host);
	network.light_vendor_url = conf.WS_PROTOCOL+light_vendor_host; // for now, light vendor is also a hub
	if (conf.bLight){
		refreshLightClientHistory();
		setInterval(reconnectToLightVendor, RECONNECT_TO_LIGHT_VENDOR_PERIOD);
		eventBus.on('connected', reconnectToLightVendor);
	}
}

function reconnectToLightVendor(){
	network.findOutboundPeerOrConnect(network.light_vendor_url, function(err, ws){
		if (err)
			return console.log("reconnectToLightVendor: "+err);
		if (ws.bLightVendor)
			return console.log("already connected to light vendor");
		if (ws.bRefreshingHistory)
			return console.log("already refreshing history");
		refreshLightClientHistory();
	});
}

function readListOfUnstableUnits(handleUnits){
	db.query("SELECT unit FROM units WHERE is_stable=0", function(rows){
		var arrUnits = rows.map(function(row){ return row.unit; });
		handleUnits(arrUnits);
	});
}


function prepareRequestForHistory(newAddresses, handleResult){
	myWitnesses.readMyWitnesses(function(arrWitnesses){
		if (arrWitnesses.length === 0) // first start, witnesses not set yet
			return handleResult(null);
		var objHistoryRequest = {witnesses: arrWitnesses};
		if (newAddresses)
			prepareRequest(newAddresses, true);
		else
			walletGeneral.readMyAddresses(function(arrAddresses){
				prepareRequest(arrAddresses);
			});

		function prepareRequest(arrAddresses, bNewAddresses){
			if (arrAddresses.length > 0)
			objHistoryRequest.addresses = arrAddresses;
				readListOfUnstableUnits(function(arrUnits){
					if (arrUnits.length > 0)
						objHistoryRequest.requested_joints = arrUnits;
					if (!objHistoryRequest.addresses && !objHistoryRequest.requested_joints)
						return handleResult(null);
					if (!objHistoryRequest.addresses)
						return handleResult(objHistoryRequest);

					var strAddressList = arrAddresses.map(db.escape).join(', ');
					if (bNewAddresses){
						db.query(
							"SELECT unit FROM unit_authors CROSS JOIN units USING(unit) WHERE is_stable=1 AND address IN("+strAddressList+") \n\
							UNION \n\
							SELECT unit FROM outputs CROSS JOIN units USING(unit) WHERE is_stable=1 AND address IN("+strAddressList+")",
							function(rows){
								if (rows.length)
									objHistoryRequest.known_stable_units = rows.map(function(row){ return row.unit; });
								if (typeof conf.refreshHistoryOnlyAboveMci == 'number')
									objHistoryRequest.min_mci = conf.refreshHistoryOnlyAboveMci;
								handleResult(objHistoryRequest);
							}
						);
					} else {
						db.query(
							"SELECT MAX(main_chain_index) AS last_stable_mci FROM units WHERE is_stable=1",
							function(rows){
								objHistoryRequest.min_mci = Math.max(rows[0].last_stable_mci || 0, conf.refreshHistoryOnlyAboveMci || 0);
								handleResult(objHistoryRequest);
							}
						);
					}
				});
		}

	}, 'wait');
}

var bFirstRefreshStarted = false;

exports.bRefreshHistoryOnNewAddress = true;
exports.bRefreshFullHistory = true;
exports.bRefreshHistory = true;

if (conf.bLight) {
	eventBus.on("new_address", function(address){
		if (!exports.bRefreshHistoryOnNewAddress) {
			db.query("DELETE FROM unprocessed_addresses WHERE address=?", [address]);
			return console.log("skipping history refresh on new address " + address);
		}
		refreshLightClientHistory([address], function(error){
			if (error)
				return console.log(error);
			db.query("DELETE FROM unprocessed_addresses WHERE address=?", [address]);
		});
	});

	// we refresh history for all addresses that could have been missed
	eventBus.on('connected', function(ws){
		console.log('light connected to ' + ws.peer);
		if (ws.peer === network.light_vendor_url) {
			console.log('resetting bFirstHistoryReceived');
			bFirstHistoryReceived = false;
		}
		db.query("SELECT address FROM unprocessed_addresses", function(rows){
			if (rows.length === 0)
				return console.log("no unprocessed addresses");
			var arrAddresses = rows.map(function(row){return row.address});
			console.log('found unprocessed addresses, will request their full history', arrAddresses);
			refreshLightClientHistory(arrAddresses, function(error){
				if (error)
					return console.log("couldn't process history");
				db.query("DELETE FROM unprocessed_addresses WHERE address IN("+ arrAddresses.map(db.escape).join(', ') + ")");
			});
		})
		
	});
}


function refreshLightClientHistory(addresses, handle){
	if (!conf.bLight)
		return;
	var refuse = function (err) {
		console.log(err);
		if (handle)
			throw Error("have a callback but can't refresh history");
	};
	if (!network.light_vendor_url)
		return refuse('refreshLightClientHistory called too early: light_vendor_url not set yet');
	if (!addresses && !exports.bRefreshFullHistory || !exports.bRefreshHistory)
		return refuse("history refresh is disabled now");
	if (!addresses) // partial refresh stays silent
		eventBus.emit('refresh_light_started');
	if (!bFirstRefreshStarted){
		archiveDoublespendUnits();
		bFirstRefreshStarted = true;
	}
	network.findOutboundPeerOrConnect(network.light_vendor_url, function onLocatedLightVendor(err, ws){
		var finish = function(err){
		//	if (err)
				console.log("finished refresh, err =", err);
			if (ws && !addresses)
				ws.bRefreshingHistory = false;
			if (handle)
				handle(err);
			if (!addresses)
				eventBus.emit('refresh_light_done');
		};
		if (err)
			return finish("refreshLightClientHistory: "+err);
		console.log('refreshLightClientHistory ' + (addresses ? 'selective ' + addresses.join(', ') : 'full'));
		// handling the response may take some time, don't send new requests
		if (!addresses){ // bRefreshingHistory flag concerns only a full refresh
			if (ws.bRefreshingHistory)
				return refuse("previous refresh not finished yet");
			ws.bRefreshingHistory = true;
		}
		else if (ws.bRefreshingHistory || !isFirstHistoryReceived()) {
			console.log("full refresh ongoing, refreshing=" + ws.bRefreshingHistory + " firstReceived=" + isFirstHistoryReceived() + " will refresh later for: " + addresses.join(' '));
			return setTimeout(function(){
				refreshLightClientHistory(addresses, handle); // full refresh must have priority over selective refresh
			}, 2*1000)
		}
		prepareRequestForHistory(addresses, function(objRequest){
			if (!objRequest)
				return finish();
			network.sendRequest(ws, 'light/get_history', objRequest, false, function(ws, request, response){
				if (response.error){
					if (response.error.indexOf('your history is too large') >= 0)
						throw Error(response.error);
					return finish(response.error);
				}
				ws.bLightVendor = true;
				var interval = setInterval(function(){ // refresh UI periodically while we are processing history
				//	eventBus.emit('maybe_new_transactions');
				}, 10*1000);
				light.processHistory(response, objRequest.witnesses, {
					ifError: function(err){
						clearInterval(interval);
						network.sendError(ws, err);
						finish(err);
					},
					ifOk: function(bRefreshUI){
						clearInterval(interval);
						finish();
						if (!addresses) {
							bFirstHistoryReceived = true;
							console.log('received 1st history');
							eventBus.emit('first_history_received');
						}
						if (bRefreshUI)
							eventBus.emit('maybe_new_transactions');
					}
				});
			});
		});
	});
}

function archiveDoublespendUnits(){
	var col = (conf.storage === 'sqlite') ? 'rowid' : 'creation_date';
	db.query("SELECT unit FROM units WHERE is_stable=0 AND creation_date<"+db.addTime('-1 DAY')+" ORDER BY "+col+" DESC", function(rows){
		var arrUnits = rows.map(function(row){ return row.unit; });
		breadcrumbs.add("units still unstable after 1 day: "+(arrUnits.join(', ') || 'none'));
		arrUnits.forEach(function(unit){
			network.requestFromLightVendor('get_joint', unit, function(ws, request, response){
				if (response.error)
					return breadcrumbs.add("get_joint "+unit+": "+response.error);
				if (response.joint_not_found === unit){
					breadcrumbs.add("light vendor doesn't know about unit "+unit+" any more, will archive");
					storage.archiveJointAndDescendantsIfExists(unit);
				}
			});
		});
	});
}

if (conf.bLight){
//	setTimeout(archiveDoublespendUnits, 5*1000);
	setInterval(archiveDoublespendUnits, 24*3600*1000);
	eventBus.on('new_my_transactions', function(arrUnits){
		db.query("SELECT DISTINCT asset FROM outputs WHERE unit IN("+arrUnits.map(db.escape).join(',')+") AND asset IS NOT NULL", function(rows){
			if (rows.length === 0)
				return;
			var arrAssets = rows.map(function(row){ return row.asset; });
			network.requestProofsOfJointsIfNewOrUnstable(arrAssets);
		});
	});
}

function isFirstHistoryReceived(){
	return bFirstHistoryReceived;
}

function waitUntilFirstHistoryReceived(cb) {
	if (!cb)
		return new Promise(resolve => waitUntilFirstHistoryReceived(resolve));
	if (bFirstHistoryReceived)
		return cb();
	console.log('will wait for the 1st history');
	eventBus.once('first_history_received', () => process.nextTick(cb));
}

function waitUntilHistoryRefreshDone(cb) {
	if (!cb)
		return new Promise((resolve, reject) => waitUntilHistoryRefreshDone(err => err ? reject(err) : resolve()));
	network.findOutboundPeerOrConnect(network.light_vendor_url, (err, ws) => {
		if (err)
			return cb(err);
		if (!ws.bRefreshingHistory)
			return cb();
		console.log('will wait for history refresh to complete');
		eventBus.once('refresh_light_done', () => process.nextTick(cb));
	});
}

exports.setLightVendorHost = setLightVendorHost;
exports.refreshLightClientHistory = refreshLightClientHistory;
exports.isFirstHistoryReceived = isFirstHistoryReceived;
exports.waitUntilFirstHistoryReceived = waitUntilFirstHistoryReceived;
exports.waitUntilHistoryRefreshDone = waitUntilHistoryRefreshDone;
