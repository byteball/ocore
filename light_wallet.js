/*jslint node: true */
"use strict";
var db = require('./db.js');
var conf = require('./conf.js');
var myWitnesses = require('./my_witnesses.js');
var network = require('./network.js');
var walletGeneral = require('./wallet_general.js');
var light = require('./light.js');
var eventBus = require('./event_bus.js');

var RECONNECT_TO_LIGHT_VENDOR_PERIOD = 60*1000;


function setLightVendorHost(light_vendor_host){
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
		eventBus.emit('connected');
	});
}

function readListOfUnstableUnits(handleUnits){
	db.query("SELECT unit FROM units WHERE is_stable=0", function(rows){
		var arrUnits = rows.map(function(row){ return row.unit; });
		handleUnits(arrUnits);
	});
}


function prepareRequestForHistory(handleResult){
	myWitnesses.readMyWitnesses(function(arrWitnesses){
		if (arrWitnesses.length === 0) // first start, witnesses not set yet
			return handleResult(null);
		var objHistoryRequest = {witnesses: arrWitnesses};
		walletGeneral.readMyAddresses(function(arrAddresses){
			if (arrAddresses.length > 0)
				objHistoryRequest.addresses = arrAddresses;
			readListOfUnstableUnits(function(arrUnits){
				if (arrUnits.length > 0)
					objHistoryRequest.requested_joints = arrUnits;
				if (!objHistoryRequest.addresses && !objHistoryRequest.requested_joints)
					return handleResult(null);
				if (!objHistoryRequest.addresses)
					return handleResult(objHistoryRequest);
				db.query(
					"SELECT MAX(main_chain_index) AS last_stable_mci FROM units JOIN unit_authors USING(unit) WHERE is_stable=1 AND address IN(?)",
					[arrAddresses],
					function(rows){
						objHistoryRequest.last_stable_mci = rows[0].last_stable_mci || 0;
						handleResult(objHistoryRequest);
					}
				);
			});
		});
	}, 'wait');
}


function refreshLightClientHistory(){
	if (!conf.bLight)
		return;
	network.findOutboundPeerOrConnect(network.light_vendor_url, function(err, ws){
		if (err)
			return console.log("refreshLightClientHistory: "+err);
		console.log('refreshLightClientHistory connected');
		// handling the response may take some time, don't send new requests
		if (ws.bRefreshingHistory)
			return console.log("previous refresh not finished yet");
		ws.bRefreshingHistory = true;
		prepareRequestForHistory(function(objRequest){
			if (!objRequest){
				ws.bRefreshingHistory = false;
				return;
			}
			network.sendRequest(ws, 'light/get_history', objRequest, false, function(ws, request, response){
				if (response.error){
					ws.bRefreshingHistory = false;
					console.log(response.error);
					return;
				}
				ws.bLightVendor = true;
				var interval = setInterval(function(){ // refresh UI periodically while we are processing history
					eventBus.emit('maybe_new_transactions');
				}, 500);
				light.processHistory(response, {
					ifError: function(err){
						network.sendError(ws, err);
						ws.bRefreshingHistory = false;
						clearInterval(interval);
					},
					ifOk: function(){
						ws.bRefreshingHistory = false;
						clearInterval(interval);
						eventBus.emit('maybe_new_transactions');
					}
				});
			});
		});
	});
}


exports.setLightVendorHost = setLightVendorHost;
exports.refreshLightClientHistory = refreshLightClientHistory;

