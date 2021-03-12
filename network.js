/*jslint node: true */
"use strict";
var WebSocket = process.browser ? global.WebSocket : require('ws');
var socks = process.browser ? null : require('socks');
var WebSocketServer = WebSocket.Server;
var crypto = require('crypto');
var _ = require('lodash');
var async = require('async');
var db = require('./db.js');
var constants = require('./constants.js');
var storage = require('./storage.js');
var myWitnesses = require('./my_witnesses.js');
var joint_storage = require('./joint_storage.js');
var validation = require('./validation.js');
var ValidationUtils = require("./validation_utils.js");
var writer = require('./writer.js');
var conf = require('./conf.js');
var mutex = require('./mutex.js');
var catchup = require('./catchup.js');
var privatePayment = require('./private_payment.js');
var objectHash = require('./object_hash.js');
var objectLength = require('./object_length.js');
var ecdsaSig = require('./signature.js');
var eventBus = require('./event_bus.js');
var light = require('./light.js');
var inputs = require('./inputs.js');
var breadcrumbs = require('./breadcrumbs.js');
var mail = require('./mail.js');
var aa_composer = require('./aa_composer.js');
var formulaEvaluation = require('./formula/evaluation.js');
var dataFeeds = require('./data_feeds.js');
var libraryPackageJson = require('./package.json');

var FORWARDING_TIMEOUT = 10*1000; // don't forward if the joint was received more than FORWARDING_TIMEOUT ms ago
var STALLED_TIMEOUT = 5000; // a request is treated as stalled if no response received within STALLED_TIMEOUT ms
var RESPONSE_TIMEOUT = 300*1000; // after this timeout, the request is abandoned
var HEARTBEAT_TIMEOUT = conf.HEARTBEAT_TIMEOUT || 10*1000;
var HEARTBEAT_RESPONSE_TIMEOUT = 60*1000;
var HEARTBEAT_PAUSE_TIMEOUT = 2*HEARTBEAT_TIMEOUT;
var MAX_STATE_VARS = 2000;

var wss;
var arrOutboundPeers = [];
var assocConnectingOutboundWebsockets = {};
var assocUnitsInWork = {};
var assocRequestedUnits = {};
var bStarted = false;
var bCatchingUp = false;
var bWaitingForCatchupChain = false;
var coming_online_time = Date.now();
var assocReroutedConnectionsByTag = {};
var arrWatchedAddresses = []; // does not include my addresses, therefore always empty
var last_hearbeat_wake_ts = Date.now();
var peer_events_buffer = [];
var assocKnownPeers = {};
var assocBlockedPeers = {};
var exchangeRates = {};
var knownWitnesses = {};
var bWatchingForLight = false;
var prev_bugreport_hash = '';

if (process.browser){ // browser
	console.log("defining .on() on ws");
	WebSocket.prototype.on = function(event, callback) {
		var self = this;
		if (event === 'message'){
			this['on'+event] = function(event){
				callback.call(self, event.data);
			};
			return;
		}
		if (event !== 'open'){
			this['on'+event] = callback;
			return;
		}
		// allow several handlers for 'open' event
		if (!this['open_handlers'])
			this['open_handlers'] = [];
		this['open_handlers'].push(callback);
		this['on'+event] = function(){
			self['open_handlers'].forEach(function(cb){
				cb();
			});
		};
	};
	WebSocket.prototype.once = WebSocket.prototype.on;
	WebSocket.prototype.setMaxListeners = function(){};
}

// if not using a hub and accepting messages directly (be your own hub)
var my_device_address;
var objMyTempPubkeyPackage;

function setMyDeviceProps(device_address, objTempPubkey){
	my_device_address = device_address;
	objMyTempPubkeyPackage = objTempPubkey;
}

exports.light_vendor_url = null;

// general network functions

function sendMessage(ws, type, content) {
	var message = JSON.stringify([type, content]);
	if (ws.readyState !== ws.OPEN)
		return console.log("readyState="+ws.readyState+' on peer '+ws.peer+', will not send '+message);
	console.log("SENDING "+message+" to "+ws.peer);
	if (typeof window !== 'undefined' && window && window.cordova) {
		ws.send(message);
	} else {
		ws.send(message, function(err){
			if (err)
				ws.emit('error', 'From send: '+err);
		});
	}
}


function sendJustsayingToLightVendor(subject, body, handle){
	if (!handle)
		handle = function(){};
	if (!conf.bLight)
		return handle("sendJustsayingToLightVendor cannot be called as full node")
	if (!exports.light_vendor_url){
		console.log("light_vendor_url not set yet");
		return setTimeout(function(){
			sendJustsayingToLightVendor(subject, body, handle);
		}, 1000);
	}
	findOutboundPeerOrConnect(exports.light_vendor_url, function(err, ws){
		if (err)
			return handle("connect to light vendor failed: "+err);
		sendMessage(ws, 'justsaying', {subject: subject, body: body});
		return handle(null);
	});
}


function sendJustsaying(ws, subject, body){
	sendMessage(ws, 'justsaying', {subject: subject, body: body});
}

function sendAllInboundJustsaying(subject, body){
	wss.clients.forEach(function(ws){
		sendMessage(ws, 'justsaying', {subject: subject, body: body});
	});
}

function sendError(ws, error) {
	sendJustsaying(ws, 'error', error);
}

function sendInfo(ws, content) {
	sendJustsaying(ws, 'info', content);
}

function sendResult(ws, content) {
	sendJustsaying(ws, 'result', content);
}

function sendErrorResult(ws, unit, error) {
	sendResult(ws, {unit: unit, result: 'error', error: error});
}

function sendVersion(ws){
	sendJustsaying(ws, 'version', {
		protocol_version: constants.version, 
		alt: constants.alt, 
		library: libraryPackageJson.name, 
		library_version: libraryPackageJson.version, 
		program: conf.program, 
		program_version: conf.program_version
	});
}

function sendResponse(ws, tag, response){
	var command = ws.assocCommandsInPreparingResponse[tag];
	delete ws.assocCommandsInPreparingResponse[tag];
	sendMessage(ws, 'response', {tag: tag, command: command, response: response});
}

function sendErrorResponse(ws, tag, error) {
	sendResponse(ws, tag, {error: error});
}


// if a 2nd identical request is issued before we receive a response to the 1st request, then:
// 1. its responseHandler will be called too but no second request will be sent to the wire
// 2. bReroutable flag must be the same
function sendRequest(ws, command, params, bReroutable, responseHandler){
	var request = {command: command};
	if (params)
		request.params = params;
	var content = _.clone(request);
	var tag = objectHash.getBase64Hash(request, true);
	//if (ws.assocPendingRequests[tag]) // ignore duplicate requests while still waiting for response from the same peer
	//    return console.log("will not send identical "+command+" request");
	if (ws.assocPendingRequests[tag]){
		console.log('already sent a '+command+' request to '+ws.peer+', will add one more response handler rather than sending a duplicate request to the wire');
		ws.assocPendingRequests[tag].responseHandlers.push(responseHandler);
	}
	else{
		content.tag = tag;
		// after STALLED_TIMEOUT, reroute the request to another peer
		// it'll work correctly even if the current peer is already disconnected when the timeout fires
		var reroute = !bReroutable ? null : function(){
			console.log('will try to reroute a '+command+' request stalled at '+ws.peer);
			if (!ws.assocPendingRequests[tag])
				return console.log('will not reroute - the request was already handled by another peer');
			ws.assocPendingRequests[tag].bRerouted = true;
			findNextPeer(ws, function(next_ws){ // the callback may be called much later if findNextPeer has to wait for connection
				if (!ws.assocPendingRequests[tag])
					return console.log('will not reroute after findNextPeer - the request was already handled by another peer');
				if (next_ws === ws || assocReroutedConnectionsByTag[tag] && assocReroutedConnectionsByTag[tag].indexOf(next_ws) >= 0){
					console.log('will not reroute '+command+' to the same peer, will rather wait for a new connection');
					eventBus.once('connected_to_source', function(){ // try again
						console.log('got new connection, retrying reroute '+command);
						reroute();
					});
					return;
				}
				console.log('rerouting '+command+' from '+ws.peer+' to '+next_ws.peer);
				ws.assocPendingRequests[tag].responseHandlers.forEach(function(rh){
					sendRequest(next_ws, command, params, bReroutable, rh);
				});
				if (!assocReroutedConnectionsByTag[tag])
					assocReroutedConnectionsByTag[tag] = [ws];
				assocReroutedConnectionsByTag[tag].push(next_ws);
			});
		};
		var reroute_timer = !bReroutable ? null : setTimeout(reroute, STALLED_TIMEOUT);
		var cancel_timer = bReroutable ? null : setTimeout(function(){
			ws.assocPendingRequests[tag].responseHandlers.forEach(function(rh){
				rh(ws, request, {error: "[internal] response timeout"});
			});
			delete ws.assocPendingRequests[tag];
		}, RESPONSE_TIMEOUT);
		ws.assocPendingRequests[tag] = {
			request: request,
			responseHandlers: [responseHandler], 
			reroute: reroute,
			reroute_timer: reroute_timer,
			cancel_timer: cancel_timer
		};
		sendMessage(ws, 'request', content);
	}
	return tag;
}


function deletePendingRequest(ws, tag){
	if (ws && ws.assocPendingRequests && ws.assocPendingRequests[tag]){
		var pendingRequest = ws.assocPendingRequests[tag];
		clearTimeout(pendingRequest.reroute_timer);
		clearTimeout(pendingRequest.cancel_timer);
		delete ws.assocPendingRequests[tag];

		// if the request was rerouted, cancel all other pending requests
		if (assocReroutedConnectionsByTag[tag]){
			assocReroutedConnectionsByTag[tag].forEach(function(client){
				if (client.assocPendingRequests[tag]){
					clearTimeout(client.assocPendingRequests[tag].reroute_timer);
					clearTimeout(client.assocPendingRequests[tag].cancel_timer);
					delete client.assocPendingRequests[tag];
				}
			});
			delete assocReroutedConnectionsByTag[tag];
		}
		return true;
	}else{
		return false;
	}
}


function handleResponse(ws, tag, response){
	var pendingRequest = ws.assocPendingRequests[tag];
	if (!pendingRequest) // was canceled due to timeout or rerouted and answered by another peer
		//throw "no req by tag "+tag;
		return console.log("no req by tag "+tag);
	pendingRequest.responseHandlers.forEach(function(responseHandler){
		process.nextTick(function(){
			responseHandler(ws, pendingRequest.request, response);
		});
	});

	deletePendingRequest(ws, tag);
}

function cancelRequestsOnClosedConnection(ws){
	console.log("websocket closed, will complete all outstanding requests");
	for (var tag in ws.assocPendingRequests){
		var pendingRequest = ws.assocPendingRequests[tag];
		clearTimeout(pendingRequest.reroute_timer);
		clearTimeout(pendingRequest.cancel_timer);
		if (pendingRequest.reroute){ // reroute immediately, not waiting for STALLED_TIMEOUT
			if (!pendingRequest.bRerouted)
				pendingRequest.reroute();
			// we still keep ws.assocPendingRequests[tag] because we'll need it when we find a peer to reroute to
		}
		else{
			pendingRequest.responseHandlers.forEach(function(rh){
				rh(ws, pendingRequest.request, {error: "[internal] connection closed"});
			});
			delete ws.assocPendingRequests[tag];
		}
	}
	printConnectionStatus();
}



// peers

function findNextPeer(ws, handleNextPeer){
	tryFindNextPeer(ws, function(next_ws){
		if (next_ws)
			return handleNextPeer(next_ws);
		var peer = ws ? ws.peer : '[none]';
		console.log('findNextPeer after '+peer+' found no appropriate peer, will wait for a new connection');
		eventBus.once('connected_to_source', function(new_ws){
			console.log('got new connection, retrying findNextPeer after '+peer);
			findNextPeer(ws, handleNextPeer);
		});
	});
}

function tryFindNextPeer(ws, handleNextPeer){
	var arrOutboundSources = arrOutboundPeers.filter(function(outbound_ws){ return outbound_ws.bSource; });
	var len = arrOutboundSources.length;
	if (len > 0){
		var peer_index = arrOutboundSources.indexOf(ws); // -1 if it is already disconnected by now, or if it is inbound peer, or if it is null
		var next_peer_index = (peer_index === -1) ? getRandomInt(0, len-1) : ((peer_index+1)%len);
		handleNextPeer(arrOutboundSources[next_peer_index]);
	}
	else
		findRandomInboundPeer(handleNextPeer);
}

function getRandomInt(min, max) {
	return Math.floor(Math.random() * (max+1 - min)) + min;
}

function findRandomInboundPeer(handleInboundPeer){
	var arrInboundSources = wss.clients.filter(function(inbound_ws){ return inbound_ws.bSource; });
	if (arrInboundSources.length === 0)
		return handleInboundPeer(null);
	var arrInboundHosts = arrInboundSources.map(function(ws){ return ws.host; });
	// filter only those inbound peers that are reversible
	db.query(
		"SELECT peer_host FROM peer_host_urls JOIN peer_hosts USING(peer_host) \n\
		WHERE is_active=1 AND peer_host IN(?) \n\
			AND (count_invalid_joints/count_new_good_joints<? \n\
			OR count_new_good_joints=0 AND count_nonserial_joints=0 AND count_invalid_joints=0) \n\
		ORDER BY (count_new_good_joints=0), "+db.getRandom()+" LIMIT 1", 
		[arrInboundHosts, conf.MAX_TOLERATED_INVALID_RATIO], 
		function(rows){
			console.log(rows.length+" inbound peers");
			if (rows.length === 0)
				return handleInboundPeer(constants.bDevnet ? arrInboundSources[Math.floor(Math.random()*arrInboundSources.length)] : null);
			var host = rows[0].peer_host;
			console.log("selected inbound peer "+host);
			var ws = arrInboundSources.filter(function(ws){ return (ws.host === host); })[0];
			if (!ws)
				throw Error("inbound ws not found");
			handleInboundPeer(ws);
		}
	);
}

function checkIfHaveEnoughOutboundPeersAndAdd(){
	var arrOutboundPeerUrls = arrOutboundPeers.map(function(ws){ return ws.peer; });
	db.query(
		"SELECT peer FROM peers JOIN peer_hosts USING(peer_host) \n\
		WHERE (count_invalid_joints/count_new_good_joints<? \n\
			OR count_new_good_joints=0 AND count_nonserial_joints=0 AND count_invalid_joints=0) \n\
			AND peer IN(?)", 
		[conf.MAX_TOLERATED_INVALID_RATIO, (arrOutboundPeerUrls.length > 0) ? arrOutboundPeerUrls : null],
		function(rows){
			var count_good_peers = rows.length;
			if (count_good_peers >= conf.MIN_COUNT_GOOD_PEERS)
				return;
			if (count_good_peers === 0) // nobody trusted enough to ask for new peers, can't do anything
				return;
			var arrGoodPeerUrls = rows.map(function(row){ return row.peer; });
			for (var i=0; i<arrOutboundPeers.length; i++){
				var ws = arrOutboundPeers[i];
				if (arrGoodPeerUrls.indexOf(ws.peer) !== -1)
					requestPeers(ws);
			}
		}
	);
}

function connectToPeer(url, onOpen) {
	addPeer(url);
	var options = {};
	if (socks && conf.socksHost && conf.socksPort) {
		options.agent = new socks.Agent({
			proxy: {
				ipaddress: conf.socksHost,
				port: conf.socksPort,
				type: 5,
				authentication: {
					username: typeof conf.socksUsername === 'undefined' ? "dummy" : conf.socksUsername,
					password: typeof conf.socksPassword === 'undefined' ? "dummy" : conf.socksPassword
				}
			}
		}, /^wss/i.test(url));
		console.log('Using socksHost: ' + conf.socksHost);
		console.log('Using socksPort: ' + conf.socksPort);
		console.log('Using socksUsername: ' + typeof conf.socksUsername === 'undefined' ? "dummy" : conf.socksUsername);
		console.log('Using socksPassword: ' + typeof conf.socksPassword === 'undefined' ? "dummy" : conf.socksPassword);
	}
	var ws = options.agent ? new WebSocket(url,options) : new WebSocket(url);
	assocConnectingOutboundWebsockets[url] = ws;
	setTimeout(function(){
		if (assocConnectingOutboundWebsockets[url]){
			console.log('abandoning connection to '+url+' due to timeout');
			delete assocConnectingOutboundWebsockets[url];
			// after this, new connection attempts will be allowed to the wire, but this one can still succeed.  See the check for duplicates below.
		}
	}, 5000);
	ws.setMaxListeners(20); // avoid warning
	ws.once('open', function onWsOpen() {
		breadcrumbs.add('connected to '+url);
		delete assocConnectingOutboundWebsockets[url];
		ws.assocPendingRequests = {};
		ws.assocCommandsInPreparingResponse = {};
		if (!ws.url)
			throw Error("no url on ws");
		if (ws.url !== url && ws.url !== url + "/") // browser implementatin of Websocket might add /
			throw Error("url is different: "+ws.url);
		var another_ws_to_same_peer = getOutboundPeerWsByUrl(url);
		if (another_ws_to_same_peer){ // duplicate connection.  May happen if we abondoned a connection attempt after timeout but it still succeeded while we opened another connection
			console.log('already have a connection to '+url+', will keep the old one and close the duplicate');
			ws.close(1000, 'duplicate connection');
			if (onOpen)
				onOpen(null, another_ws_to_same_peer);
			return;
		}
		ws.peer = url;
		ws.host = getHostByPeer(ws.peer);
		ws.bOutbound = true;
		ws.last_ts = Date.now();
		console.log('connected to '+url+", host "+ws.host);
		arrOutboundPeers.push(ws);
		sendVersion(ws);
		if (conf.myUrl) // I can listen too, this is my url to connect to
			sendJustsaying(ws, 'my_url', conf.myUrl);
		if (!conf.bLight)
			subscribe(ws);
		if (onOpen)
			onOpen(null, ws);
		eventBus.emit('connected', ws);
		eventBus.emit('open-'+url);
	});
	ws.on('close', function onWsClose() {
		var i = arrOutboundPeers.indexOf(ws);
		console.log('close event, removing '+i+': '+url);
		if (i !== -1)
			arrOutboundPeers.splice(i, 1);
		cancelRequestsOnClosedConnection(ws);
		if (options.agent && options.agent.destroy)
			options.agent.destroy();
	});
	ws.on('error', function onWsError(e){
		delete assocConnectingOutboundWebsockets[url];
		console.log("error from server "+url+": "+e);
		var err = e.toString();
		// !ws.bOutbound means not connected yet. This is to distinguish connection errors from later errors that occur on open connection
		if (!ws.bOutbound && onOpen)
			onOpen(err);
		if (!ws.bOutbound)
			eventBus.emit('open-'+url, err);
	});
	ws.on('message', onWebsocketMessage);
	console.log('connectToPeer done');
}

function addOutboundPeers(multiplier){
	if (!multiplier)
		multiplier = 1;
	if (multiplier >= 32) // limit recursion
		return;
	var order_by = (multiplier <= 4) ? "count_new_good_joints DESC" : db.getRandom(); // don't stick to old peers with most accumulated good joints
	var arrOutboundPeerUrls = arrOutboundPeers.map(function(ws){ return ws.peer; });
	var arrInboundHosts = wss.clients.map(function(ws){ return ws.host; });
	var max_new_outbound_peers = Math.min(conf.MAX_OUTBOUND_CONNECTIONS-arrOutboundPeerUrls.length, 5); // having too many connections being opened creates odd delays in db functions
	if (max_new_outbound_peers <= 0)
		return;
	db.query(
		"SELECT peer \n\
		FROM peers \n\
		JOIN peer_hosts USING(peer_host) \n\
		LEFT JOIN peer_host_urls ON peer=url AND is_active=1 \n\
		WHERE (count_invalid_joints/count_new_good_joints<? \n\
			OR count_new_good_joints=0 AND count_nonserial_joints=0 AND count_invalid_joints=0) \n\
			"+((arrOutboundPeerUrls.length > 0) ? "AND peer NOT IN("+arrOutboundPeerUrls.map(db.escape).join(', ')+") \n" : "")+"\n\
			"+((arrInboundHosts.length > 0) ? "AND (peer_host_urls.peer_host IS NULL OR peer_host_urls.peer_host NOT IN("+arrInboundHosts.map(db.escape).join(', ')+")) \n" : "")+"\n\
			AND peer_hosts.peer_host != 'byteball.org' \n\
			AND is_self=0 \n\
		ORDER BY "+order_by+" LIMIT ?", 
		[conf.MAX_TOLERATED_INVALID_RATIO*multiplier, max_new_outbound_peers], 
		function(rows){
			for (var i=0; i<rows.length; i++){
				assocKnownPeers[rows[i].peer] = true;
				findOutboundPeerOrConnect(rows[i].peer);
			}
			if (arrOutboundPeerUrls.length === 0 && rows.length === 0) // if no outbound connections at all, get less strict
				addOutboundPeers(multiplier*2);
		}
	);
}

function getHostByPeer(peer){
	var matches = peer.match(/^wss?:\/\/(.*)$/i);
	if (matches)
		peer = matches[1];
	matches = peer.match(/^(.*?)[:\/]/);
	return matches ? matches[1] : peer;
}

function addPeerHost(host, onDone){
	db.query("INSERT "+db.getIgnore()+" INTO peer_hosts (peer_host) VALUES (?)", [host], function(){
		if (onDone)
			onDone();
	});
}

function addPeer(peer){
	if (assocKnownPeers[peer])
		return;
	assocKnownPeers[peer] = true;
	var host = getHostByPeer(peer);
	addPeerHost(host, function(){
		console.log("will insert peer "+peer);
		db.query("INSERT "+db.getIgnore()+" INTO peers (peer_host, peer) VALUES (?,?)", [host, peer]);
	});
}

function getOutboundPeerWsByUrl(url){
	console.log("outbound peers: "+arrOutboundPeers.map(function(o){ return o.peer; }).join(", "));
	for (var i=0; i<arrOutboundPeers.length; i++)
		if (arrOutboundPeers[i].peer === url)
			return arrOutboundPeers[i];
	return null;
}

function getPeerWebSocket(peer){
	for (var i=0; i<arrOutboundPeers.length; i++)
		if (arrOutboundPeers[i].peer === peer)
			return arrOutboundPeers[i];
	for (var i=0; i<wss.clients.length; i++)
		if (wss.clients[i].peer === peer)
			return wss.clients[i];
	return null;
}

function getInboundDeviceWebSocket(device_address){
	for (var i=0; i<wss.clients.length; i++){
		if (wss.clients[i].device_address === device_address)
			return wss.clients[i];
	}
	return null;
}



function findOutboundPeerOrConnect(url, onOpen){
	if (!url)
		throw Error('no url');
	if (!onOpen)
		onOpen = function(){};
	if (!bStarted)
		return onOpen("[internal] network not started yet");
	url = url.toLowerCase();
	var ws = getOutboundPeerWsByUrl(url);
	if (ws)
		return onOpen(null, ws);
	// check if we are already connecting to the peer
	ws = assocConnectingOutboundWebsockets[url];
	if (ws){ // add second event handler
		breadcrumbs.add('already connecting to '+url);
		return eventBus.once('open-'+url, function secondOnOpen(err){
			console.log('second open '+url+", err="+err);
			if (err)
				return onOpen(err);
			if (ws.readyState === ws.OPEN)
				onOpen(null, ws);
			else{
				// can happen e.g. if the ws was abandoned but later succeeded, we opened another connection in the meantime, 
				// and had another_ws_to_same_peer on the first connection
				console.log('in second onOpen, websocket already closed');
				onOpen('[internal] websocket already closed');
			}
		});
	}
	console.log("will connect to "+url);
	connectToPeer(url, onOpen);
}

function purgePeerEvents(){
    if (conf.storage !== 'sqlite')
        return;
    console.log('will purge peer events');
    db.query("DELETE FROM peer_events WHERE event_date <= datetime('now', '-0.5 day')", function() {
        console.log("deleted some old peer_events");
    });
}

function purgeDeadPeers(){
	if (conf.storage !== 'sqlite')
		return;
	console.log('will purge dead peers');
	var arrOutboundPeerUrls = arrOutboundPeers.map(function(ws){ return ws.peer; });
	db.query("SELECT rowid, "+db.getUnixTimestamp('event_date')+" AS ts FROM peer_events ORDER BY rowid DESC LIMIT 1", function(lrows){
		if (lrows.length === 0)
			return;
		var last_rowid = lrows[0].rowid;
		var last_event_ts = lrows[0].ts;
		db.query("SELECT peer, peer_host FROM peers", function(rows){
			async.eachSeries(rows, function(row, cb){
				if (arrOutboundPeerUrls.indexOf(row.peer) >= 0)
					return cb();
				db.query(
					"SELECT MAX(rowid) AS max_rowid, MAX("+db.getUnixTimestamp('event_date')+") AS max_event_ts FROM peer_events WHERE peer_host=?", 
					[row.peer_host], 
					function(mrows){
						var max_rowid = mrows[0].max_rowid || 0;
						var max_event_ts = mrows[0].max_event_ts || 0;
						var count_other_events = last_rowid - max_rowid;
						var days_since_last_event = (last_event_ts - max_event_ts)/24/3600;
						if (count_other_events < 20000 || days_since_last_event < 7)
							return cb();
						console.log('peer '+row.peer+' is dead, will delete');
						db.query("DELETE FROM peers WHERE peer=?", [row.peer], function(){
							delete assocKnownPeers[row.peer];
							cb();
						});
					}
				);
			});
		});
	});
}

function requestPeers(ws){
	sendRequest(ws, 'get_peers', null, false, handleNewPeers);
}

function handleNewPeers(ws, request, arrPeerUrls){
	if (arrPeerUrls.error)
		return console.log('get_peers failed: '+arrPeerUrls.error);
	if (!Array.isArray(arrPeerUrls))
		return sendError(ws, "peer urls is not an array");
	var arrQueries = [];
	for (var i=0; i<arrPeerUrls.length; i++){
		var url = arrPeerUrls[i];
		if (conf.myUrl && conf.myUrl.toLowerCase() === url.toLowerCase())
			continue;
		var regexp = (conf.WS_PROTOCOL === 'wss://') ? /^wss:\/\// : /^wss?:\/\//;
		if (!url.match(regexp)){
			console.log('ignoring new peer '+url+' because of incompatible ws protocol');
			continue;
		}
		var host = getHostByPeer(url);
		if (host === 'byteball.org')
			continue;
		db.addQuery(arrQueries, "INSERT "+db.getIgnore()+" INTO peer_hosts (peer_host) VALUES (?)", [host]);
		db.addQuery(arrQueries, "INSERT "+db.getIgnore()+" INTO peers (peer_host, peer, learnt_from_peer_host) VALUES(?,?,?)", [host, url, ws.host]);
	}
	async.series(arrQueries);
}

function heartbeat(){
	// just resumed after sleeping
	var bJustResumed = (typeof window !== 'undefined' && window && window.cordova && Date.now() - last_hearbeat_wake_ts > HEARTBEAT_PAUSE_TIMEOUT);
	last_hearbeat_wake_ts = Date.now();
	wss.clients.concat(arrOutboundPeers).forEach(function(ws){
		if (ws.bSleeping || ws.readyState !== ws.OPEN)
			return;
		var elapsed_since_last_received = Date.now() - ws.last_ts;
		if (elapsed_since_last_received < HEARTBEAT_TIMEOUT)
			return;
		if (!ws.last_sent_heartbeat_ts || bJustResumed){
			ws.last_sent_heartbeat_ts = Date.now();
			return sendRequest(ws, 'heartbeat', null, false, handleHeartbeatResponse);
		}
		var elapsed_since_last_sent_heartbeat = Date.now() - ws.last_sent_heartbeat_ts;
		if (elapsed_since_last_sent_heartbeat < HEARTBEAT_RESPONSE_TIMEOUT)
			return;
		console.log('will disconnect peer '+ws.peer+' who was silent for '+elapsed_since_last_received+'ms');
		ws.close(1000, "lost connection");
	});
}

function handleHeartbeatResponse(ws, request, response){
	delete ws.last_sent_heartbeat_ts;
	if (response === 'sleep') // the peer doesn't want to be bothered with heartbeats any more, but still wants to keep the connection open
		ws.bSleeping = true;
	// as soon as the peer sends a heartbeat himself, we'll think he's woken up and resume our heartbeats too
}

function requestFromLightVendor(command, params, responseHandler){
	if (!exports.light_vendor_url){
		console.log("light_vendor_url not set yet");
		return setTimeout(function(){
			requestFromLightVendor(command, params, responseHandler);
		}, 1000);
	}
	findOutboundPeerOrConnect(exports.light_vendor_url, function(err, ws){
		if (err)
			return responseHandler(null, null, {error: "[connect to light vendor failed]: "+err});
		sendRequest(ws, command, params, false, responseHandler);
	});
}


function getConnectionStatus(){
	return {
		incoming: wss.clients.length,
		outgoing: arrOutboundPeers.length,
		outgoing_being_opened: Object.keys(assocConnectingOutboundWebsockets).length
	}
}

function printConnectionStatus(){
	var objConnectionStatus = getConnectionStatus();
	console.log(objConnectionStatus.incoming+" incoming connections, "+objConnectionStatus.outgoing+" outgoing connections, "+
	objConnectionStatus.outgoing_being_opened+" outgoing connections being opened");
}

function subscribe(ws){
	ws.subscription_id = crypto.randomBytes(30).toString("base64"); // this is to detect self-connect
	storage.readLastMainChainIndex(function(last_mci){
		sendRequest(ws, 'subscribe', {subscription_id: ws.subscription_id, last_mci: last_mci, library_version: libraryPackageJson.version}, false, function(ws, request, response){
			delete ws.subscription_id;
			if (response.error)
				return;
			ws.bSource = true;
			eventBus.emit('connected_to_source', ws);
		});
	});
}

// joints

// sent as justsaying or as response to a request
function sendJoint(ws, objJoint, tag) {
	console.log('sending joint identified by unit ' + objJoint.unit.unit + ' to', ws.peer);
	tag ? sendResponse(ws, tag, {joint: objJoint}) : sendJustsaying(ws, 'joint', objJoint);
}

// sent by light clients to their vendors
function postJointToLightVendor(objJoint, handleResponse) {
	console.log('posting joint identified by unit ' + objJoint.unit.unit + ' to light vendor');
	requestFromLightVendor('post_joint', objJoint, function(ws, request, response){
		handleResponse(response);
	});
}

function sendFreeJoints(ws) {
	storage.readFreeJoints(function(objJoint){
		sendJoint(ws, objJoint);
	}, function(){
		sendJustsaying(ws, 'free_joints_end', null);
	});
}

function sendJointsSinceMci(ws, mci) {
	joint_storage.readJointsSinceMci(
		mci, 
		function(objJoint){
			sendJoint(ws, objJoint);
		},
		function(){
			sendJustsaying(ws, 'free_joints_end', null);
		}
	);
}

function requestFreeJointsFromAllOutboundPeers(){
	for (var i=0; i<arrOutboundPeers.length; i++)
		sendJustsaying(arrOutboundPeers[i], 'refresh', null);
}

function requestNewJoints(ws){
	storage.readLastMainChainIndex(function(last_mci){
		sendJustsaying(ws, 'refresh', last_mci);
	});
}

function rerequestLostJoints(bForce){
	//console.log("rerequestLostJoints");
	if (bCatchingUp && !bForce)
		return;
	joint_storage.findLostJoints(function(arrUnits){
		console.log("lost units", arrUnits.length > 0 ? arrUnits : 'none');
		tryFindNextPeer(null, function(ws){
			if (!ws)
				return;
			console.log("found next peer "+ws.peer);
			requestJoints(ws, arrUnits.filter(function(unit){ return (!assocUnitsInWork[unit] && !havePendingJointRequest(unit)); }));
		});
	});
}

function requestNewMissingJoints(ws, arrUnits){
	var arrNewUnits = [];
	async.eachSeries(
		arrUnits,
		function(unit, cb){
			if (assocUnitsInWork[unit])
				return cb();
			if (havePendingJointRequest(unit)){
				console.log("unit "+unit+" was already requested");
				return cb();
			}
			joint_storage.checkIfNewUnit(unit, {
				ifNew: function(){
					arrNewUnits.push(unit);
					cb();
				},
				ifKnown: function(){console.log("known"); cb();}, // it has just been handled
				ifKnownUnverified: function(){console.log("known unverified"); cb();}, // I was already waiting for it
				ifKnownBad: function(error){
					throw Error("known bad "+unit+": "+error);
				}
			});
		},
		function(){
			//console.log(arrNewUnits.length+" of "+arrUnits.length+" left", assocUnitsInWork);
			// filter again as something could have changed each time we were paused in checkIfNewUnit
			arrNewUnits = arrNewUnits.filter(function(unit){ return (!assocUnitsInWork[unit] && !havePendingJointRequest(unit)); });
			if (arrNewUnits.length > 0)
				requestJoints(ws, arrNewUnits);
		}
	);
}

function requestJoints(ws, arrUnits) {
	if (arrUnits.length === 0)
		return;
	arrUnits.forEach(function(unit){
		if (assocRequestedUnits[unit]){
			var diff = Date.now() - assocRequestedUnits[unit];
			// since response handlers are called in nextTick(), there is a period when the pending request is already cleared but the response
			// handler is not yet called, hence assocRequestedUnits[unit] not yet cleared
			if (diff <= STALLED_TIMEOUT)
				return console.log("unit "+unit+" already requested "+diff+" ms ago, assocUnitsInWork="+assocUnitsInWork[unit]);
			//	throw new Error("unit "+unit+" already requested "+diff+" ms ago, assocUnitsInWork="+assocUnitsInWork[unit]);
		}
		if (ws.readyState === ws.OPEN)
			assocRequestedUnits[unit] = Date.now();
		// even if readyState is not ws.OPEN, we still send the request, it'll be rerouted after timeout
		sendRequest(ws, 'get_joint', unit, true, handleResponseToJointRequest);
	});
}

function handleResponseToJointRequest(ws, request, response){
	delete assocRequestedUnits[request.params];
	if (!response.joint){
		var unit = request.params;
		if (response.joint_not_found === unit){
			if (conf.bLight) // we trust the light vendor that if it doesn't know about the unit after 1 day, it doesn't exist
				db.query("DELETE FROM unhandled_private_payments WHERE unit=? AND creation_date<"+db.addTime('-1 DAY'), [unit]);
			if (!bCatchingUp)
				return console.log("unit "+unit+" does not exist"); // if it is in unhandled_joints, it'll be deleted in 1 hour
			//	return purgeDependenciesAndNotifyPeers(unit, "unit "+unit+" does not exist");
			db.query("SELECT 1 FROM hash_tree_balls WHERE unit=?", [unit], function(rows){
				if (rows.length === 0)
					return console.log("unit "+unit+" does not exist (catching up)");
				//	return purgeDependenciesAndNotifyPeers(unit, "unit "+unit+" does not exist (catching up)");
				findNextPeer(ws, function(next_ws){
					breadcrumbs.add("found next peer to reroute joint_not_found "+unit+": "+next_ws.peer);
					requestJoints(next_ws, [unit]);
				});
			});
		}
		// if it still exists, we'll request it again
		// we requst joints in two cases:
		// - when referenced from parents, in this case we request it from the same peer who sent us the referencing joint, 
		//   he should know, or he is attempting to DoS us
		// - when catching up and requesting old joints from random peers, in this case we are pretty sure it should exist
		return;
	}
	var objJoint = response.joint;
	if (!objJoint.unit || !objJoint.unit.unit)
		return sendError(ws, 'no unit');
	var unit = objJoint.unit.unit;
	if (request.params !== unit)
		return sendError(ws, "I didn't request this unit from you: "+unit);
	if (conf.bLight && objJoint.ball && !objJoint.unit.content_hash){
		// accept it as unfinished (otherwise we would have to require a proof)
		delete objJoint.ball;
		delete objJoint.skiplist_units;
	}
	conf.bLight ? handleLightOnlineJoint(ws, objJoint) : handleOnlineJoint(ws, objJoint);
}

function havePendingRequest(command){
	var arrPeers = wss.clients.concat(arrOutboundPeers);
	for (var i=0; i<arrPeers.length; i++){
		var assocPendingRequests = arrPeers[i].assocPendingRequests;
		for (var tag in assocPendingRequests)
			if (assocPendingRequests[tag].request.command === command)
				return true;
	}
	return false;
}

function havePendingJointRequest(unit){
	var arrPeers = wss.clients.concat(arrOutboundPeers);
	for (var i=0; i<arrPeers.length; i++){
		var assocPendingRequests = arrPeers[i].assocPendingRequests;
		for (var tag in assocPendingRequests){
			var request = assocPendingRequests[tag].request;
			if (request.command === 'get_joint' && request.params === unit)
				return true;
		}
	}
	return false;
}

// We may receive a reference to a nonexisting unit in parents. We are not going to keep the referencing joint forever.
function purgeJunkUnhandledJoints(){
	if (bCatchingUp || Date.now() - coming_online_time < 3600*1000 || wss.clients.length === 0 && arrOutboundPeers.length === 0)
		return;
	joint_storage.purgeOldUnhandledJoints();
}

function purgeJointAndDependenciesAndNotifyPeers(objJoint, error, onDone){
	if (error.indexOf('is not stable in view of your parents') >= 0){ // give it a chance to be retried after adding other units
		eventBus.emit('nonfatal_error', "error on unit "+objJoint.unit.unit+": "+error+"; "+JSON.stringify(objJoint), new Error());
		// schedule a retry
		console.log("will schedule a retry of " + objJoint.unit.unit);
		setTimeout(function () {
			console.log("retrying " + objJoint.unit.unit);
			rerequestLostJoints(true);
			joint_storage.readDependentJointsThatAreReady(null, handleSavedJoint);
		}, 60 * 1000);
		return onDone();
	}
	joint_storage.purgeJointAndDependencies(
		objJoint, 
		error, 
		// this callback is called for each dependent unit
		function(purged_unit, peer){
			var ws = getPeerWebSocket(peer);
			if (ws)
				sendErrorResult(ws, purged_unit, "error on (indirect) parent unit "+objJoint.unit.unit+": "+error);
		}, 
		onDone
	);
}

function purgeDependenciesAndNotifyPeers(unit, error, onDone){
	joint_storage.purgeDependencies(
		unit, 
		error, 
		// this callback is called for each dependent unit
		function(purged_unit, peer){
			var ws = getPeerWebSocket(peer);
			if (ws)
				sendErrorResult(ws, purged_unit, "error on (indirect) parent unit "+unit+": "+error);
		}, 
		onDone
	);
}

function forwardJoint(ws, objJoint){
	wss.clients.concat(arrOutboundPeers).forEach(function(client) {
		if (client != ws && client.bSubscribed)
			sendJoint(client, objJoint);
	});
}

function handleJoint(ws, objJoint, bSaved, bPosted, callbacks){
	if ('aa' in objJoint)
		return callbacks.ifJointError("AA unit cannot be broadcast");
	var unit = objJoint.unit.unit;
	if (assocUnitsInWork[unit])
		return callbacks.ifUnitInWork();
	assocUnitsInWork[unit] = true;
	
	var validate = function(){
		mutex.lock(['handleJoint'], function(unlock){
			validation.validate(objJoint, {
				ifUnitError: function(error){
					console.log(objJoint.unit.unit+" validation failed: "+error);
					callbacks.ifUnitError(error);
				//	throw Error(error);
					unlock();
					purgeJointAndDependenciesAndNotifyPeers(objJoint, error, function(){
						delete assocUnitsInWork[unit];
					});
					if (ws && error !== 'authentifier verification failed' && !error.match(/bad merkle proof at path/))
						writeEvent('invalid', ws.host);
					if (objJoint.unsigned)
						eventBus.emit("validated-"+unit, false);
				},
				ifJointError: function(error){
					callbacks.ifJointError(error);
				//	throw Error(error);
					unlock();
					joint_storage.saveKnownBadJoint(objJoint, error, function(){
						delete assocUnitsInWork[unit];
					});
					if (ws)
						writeEvent('invalid', ws.host);
					if (objJoint.unsigned)
						eventBus.emit("validated-"+unit, false);
				},
				ifTransientError: function(error){
				//	throw Error(error);
					callbacks.ifUnitError(error);
					unlock();
					console.log("############################## transient error "+error);
					joint_storage.removeUnhandledJointAndDependencies(unit, function(){
					//	if (objJoint.ball)
					//		db.query("DELETE FROM hash_tree_balls WHERE ball=? AND unit=?", [objJoint.ball, objJoint.unit.unit]);
						delete assocUnitsInWork[unit];
					});
				},
				ifNeedHashTree: function(){
					console.log('need hash tree for unit '+unit);
					if (objJoint.unsigned)
						throw Error("ifNeedHashTree() unsigned");
					callbacks.ifNeedHashTree();
					// we are not saving unhandled joint because we don't know dependencies
					delete assocUnitsInWork[unit];
					unlock();
				},
				ifNeedParentUnits: function(arrMissingUnits){
					callbacks.ifNeedParentUnits(arrMissingUnits);
					unlock();
				},
				ifOk: function(objValidationState, validation_unlock){
					if (objJoint.unsigned)
						throw Error("ifOk() unsigned");
					if (bPosted && objValidationState.sequence !== 'good') {
						validation_unlock();
						callbacks.ifUnitError("The transaction would be non-serial (a double spend)");
						delete assocUnitsInWork[unit];
						unlock();
						if (ws)
							writeEvent('nonserial', ws.host);
						return;
					}
					writer.saveJoint(objJoint, objValidationState, null, function(){
						validation_unlock();
						callbacks.ifOk();
						unlock();
						if (ws)
							writeEvent((objValidationState.sequence !== 'good') ? 'nonserial' : 'new_good', ws.host);
						notifyWatchers(objJoint, objValidationState.sequence === 'good', ws);
						if (objValidationState.arrUnitsGettingBadSequence)
							notifyWatchersAboutUnitsGettingBadSequence(objValidationState.arrUnitsGettingBadSequence);
						if (!bCatchingUp)
							eventBus.emit('new_joint', objJoint);
					});
				},
				ifOkUnsigned: function(bSerial){
					if (!objJoint.unsigned)
						throw Error("ifOkUnsigned() signed");
					callbacks.ifOkUnsigned();
					unlock();
					eventBus.emit("validated-"+unit, bSerial);
				}
			});
		});
	};

	joint_storage.checkIfNewJoint(objJoint, {
		ifNew: function(){
			bSaved ? callbacks.ifNew() : validate();
		},
		ifKnown: function(){
			callbacks.ifKnown();
			delete assocUnitsInWork[unit];
		},
		ifKnownBad: function(){
			callbacks.ifKnownBad();
			delete assocUnitsInWork[unit];
		},
		ifKnownUnverified: function(){
			bSaved ? validate() : callbacks.ifKnownUnverified();
		}
	});
}

// handle joint posted to me by a light client
function handlePostedJoint(ws, objJoint, onDone){
	
	if (!objJoint || !objJoint.unit || !objJoint.unit.unit)
		return onDone('no unit');
	
	var unit = objJoint.unit.unit;
	delete objJoint.unit.main_chain_index;
	
	handleJoint(ws, objJoint, false, true, {
		ifUnitInWork: function(){
			onDone("already handling this unit");
		},
		ifUnitError: function(error){
			onDone(error);
		},
		ifJointError: function(error){
			onDone(error);
		},
		ifNeedHashTree: function(){
			onDone("need hash tree");
		},
		ifNeedParentUnits: function(arrMissingUnits){
			onDone("unknown parents");
		},
		ifOk: function(){
			onDone();
			
			// forward to other peers
			if (!bCatchingUp && !conf.bLight)
				forwardJoint(ws, objJoint);

			delete assocUnitsInWork[unit];
		},
		ifOkUnsigned: function(){
			delete assocUnitsInWork[unit];
			onDone("you can't send unsigned units");
		},
		ifKnown: function(){
			if (objJoint.unsigned)
				return onDone("you can't send unsigned units");
			onDone("known");
			writeEvent('known_good', ws.host);
		},
		ifKnownBad: function(){
			onDone("known bad");
			writeEvent('known_bad', ws.host);
		},
		ifKnownUnverified: function(){ // impossible unless the peer also sends this joint by 'joint' justsaying
			onDone("known unverified");
			delete assocUnitsInWork[unit];
		}
	});
}

function handleOnlineJoint(ws, objJoint, onDone){
	if (!onDone)
		onDone = function(){};
	var unit = objJoint.unit.unit;
	delete objJoint.unit.main_chain_index;
	
	handleJoint(ws, objJoint, false, false, {
		ifUnitInWork: onDone,
		ifUnitError: function(error){
			sendErrorResult(ws, unit, error);
			onDone();
		},
		ifJointError: function(error){
			sendErrorResult(ws, unit, error);
			onDone();
		},
		ifNeedHashTree: function(){
			if (!bCatchingUp && !bWaitingForCatchupChain)
				requestCatchup(ws);
			// we are not saving the joint so that in case requestCatchup() fails, the joint will be requested again via findLostJoints, 
			// which will trigger another attempt to request catchup
			onDone();
		},
		ifNeedParentUnits: function(arrMissingUnits, dontsave){
			sendInfo(ws, {unit: unit, info: "unresolved dependencies: "+arrMissingUnits.join(", ")});
			if (dontsave)
				delete assocUnitsInWork[unit];
			else
				joint_storage.saveUnhandledJointAndDependencies(objJoint, arrMissingUnits, ws.peer, function(){
					delete assocUnitsInWork[unit];
				});
			requestNewMissingJoints(ws, arrMissingUnits);
			onDone();
		},
		ifOk: function(){
			sendResult(ws, {unit: unit, result: 'accepted'});
			
			// forward to other peers
			if (!bCatchingUp && !conf.bLight)
				forwardJoint(ws, objJoint);

			delete assocUnitsInWork[unit];

			// wake up other joints that depend on me
			findAndHandleJointsThatAreReady(unit);
			onDone();
		},
		ifOkUnsigned: function(){
			delete assocUnitsInWork[unit];
			onDone();
		},
		ifKnown: function(){
			if (objJoint.unsigned)
				return onDone();
			sendResult(ws, {unit: unit, result: 'known'});
			writeEvent('known_good', ws.host);
			onDone();
		},
		ifKnownBad: function(){
			sendResult(ws, {unit: unit, result: 'known_bad'});
			writeEvent('known_bad', ws.host);
			if (objJoint.unsigned)
				eventBus.emit("validated-"+unit, false);
			onDone();
		},
		ifKnownUnverified: function(){
			sendResult(ws, {unit: unit, result: 'known_unverified'});
			delete assocUnitsInWork[unit];
			onDone();
		}
	});
}


function handleSavedJoint(objJoint, creation_ts, peer){
	
	var unit = objJoint.unit.unit;
	var ws = getPeerWebSocket(peer);
	if (ws && ws.readyState !== ws.OPEN)
		ws = null;

	handleJoint(ws, objJoint, true, false, {
		ifUnitInWork: function(){
			setTimeout(function(){
				handleSavedJoint(objJoint, creation_ts, peer);
			}, 1000);
		},
		ifUnitError: function(error){
			if (ws)
				sendErrorResult(ws, unit, error);
		},
		ifJointError: function(error){
			if (ws)
				sendErrorResult(ws, unit, error);
		},
		ifNeedHashTree: function(){
			console.log("handleSavedJoint "+objJoint.unit.unit+": need hash tree, will retry later");
			setTimeout(function(){
				handleSavedJoint(objJoint, creation_ts, peer);
			}, 1000);
		//	throw Error("handleSavedJoint "+objJoint.unit.unit+": need hash tree");
		},
		ifNeedParentUnits: function(arrMissingUnits){
			db.query("SELECT 1 FROM archived_joints WHERE unit IN(?) LIMIT 1", [arrMissingUnits], function(rows){
				if (rows.length === 0)
					throw Error("unit "+unit+" still has unresolved dependencies: "+arrMissingUnits.join(", "));
				breadcrumbs.add("unit "+unit+" has unresolved dependencies that were archived: "+arrMissingUnits.join(", "))
				if (ws)
					requestNewMissingJoints(ws, arrMissingUnits);
				else
					findNextPeer(null, function(next_ws){
						requestNewMissingJoints(next_ws, arrMissingUnits);
					});
				delete assocUnitsInWork[unit];
			});
		},
		ifOk: function(){
			if (ws)
				sendResult(ws, {unit: unit, result: 'accepted'});
			
			// forward to other peers
			if (!bCatchingUp && !conf.bLight && creation_ts > Date.now() - FORWARDING_TIMEOUT)
				forwardJoint(ws, objJoint);

			joint_storage.removeUnhandledJointAndDependencies(unit, function(){
				delete assocUnitsInWork[unit];
				// wake up other saved joints that depend on me
				findAndHandleJointsThatAreReady(unit);
			});
		},
		ifOkUnsigned: function(){
			joint_storage.removeUnhandledJointAndDependencies(unit, function(){
				delete assocUnitsInWork[unit];
			});
		},
		// readDependentJointsThatAreReady can read the same joint twice before it's handled. If not new, just ignore (we've already responded to peer).
		ifKnown: function(){},
		ifKnownBad: function(){},
		ifNew: function(){
			// that's ok: may be simultaneously selected by readDependentJointsThatAreReady and deleted by purgeJunkUnhandledJoints when we wake up after sleep
			delete assocUnitsInWork[unit];
			console.log("new in handleSavedJoint: "+unit);
		//	throw Error("new in handleSavedJoint: "+unit);
		}
	});
}

function handleLightOnlineJoint(ws, objJoint){
	// the lock ensures that we do not overlap with history processing which might also write new joints
	mutex.lock(["light_joints"], function(unlock){
		breadcrumbs.add('got light_joints for handleLightOnlineJoint '+objJoint.unit.unit);
		handleOnlineJoint(ws, objJoint, function(){
			breadcrumbs.add('handleLightOnlineJoint done');
			unlock();
		});
	});
}

function setWatchedAddresses(_arrWatchedAddresses){
	arrWatchedAddresses = _arrWatchedAddresses;
}

function addWatchedAddress(address){
	arrWatchedAddresses.push(address);
}

function notifyWatchersAboutUnitsGettingBadSequence(arrUnits){
	if (conf.bLight)
		throw Error("light node cannot notify about bad sequence");

	// - one unit can concern several addresses
	// - same address can be concerned by several units
	// - several addresses can be watched locally or by same peer
	// we have to sort that in order to provide duplicated units to sequence_became_bad event
	arrUnits = _.uniq(arrUnits);
	var assocAddressesByUnit = {};
	var assocUnitsByAddress = {};
	async.each(arrUnits, function(unit, cb){
		storage.readJoint(db, unit, {
			ifFound: function(objJoint) {
				var objAddresses = getAllAuthorsAndOutputAddresses(objJoint.unit);
				if (!objAddresses) // voided unit
					return cb();
				var arrAddresses = objAddresses.addresses;
				assocAddressesByUnit[unit] = arrAddresses;
				arrAddresses.forEach(function(address){
					if (!assocUnitsByAddress[address])
						assocUnitsByAddress[address] = [];
					assocUnitsByAddress[address].push(unit);
				});
				cb();
			},
			ifNotFound: function(){
				cb();
			}
		});
	},
	function () {	
		// notify local watchers
		var assocUniqueUnits = {};
		for (var unit in assocAddressesByUnit){
			if (_.intersection(arrWatchedAddresses, assocAddressesByUnit[unit]).length > 0){
				assocUniqueUnits[unit] = true;
			}
		}
		var arrConcernedAddresses = Object.keys(assocUnitsByAddress);
		db.query(
			"SELECT address FROM my_addresses WHERE address IN(?) UNION SELECT shared_address AS address FROM shared_addresses WHERE address IN(?) UNION SELECT address FROM my_watched_addresses WHERE address IN(?)",  
			[arrConcernedAddresses, arrConcernedAddresses, arrConcernedAddresses],
			function(rows){
				if (rows.length > 0){
					var arrMyConcernedAddresses = rows.map(function(row){return row.address});
					for (var unit in assocAddressesByUnit){
						if (_.intersection(arrMyConcernedAddresses, assocAddressesByUnit[unit]).length > 0)
							assocUniqueUnits[unit] = true;
					}
				}
				var arrUniqueUnits = Object.keys(assocUniqueUnits);
				if (arrUniqueUnits.length > 0)
					eventBus.emit("sequence_became_bad", arrUniqueUnits);
			}
		);
		// notify light watchers
		if (!bWatchingForLight)
			return;
		db.query("SELECT peer,address,null FROM watched_light_addresses WHERE address IN(?) UNION SELECT peer,null,unit FROM watched_light_units WHERE unit IN(?)", [arrConcernedAddresses, arrUnits], function(rows){
			var assocUniqueUnitsByPeer = {};
			rows.forEach(function(row){
				if (row.address){
					if (assocUnitsByAddress[row.address]){
						assocUnitsByAddress[row.address].forEach(function(unit){
							if (!assocUniqueUnitsByPeer[row.peer])
								assocUniqueUnitsByPeer[row.peer] = {};
							assocUniqueUnitsByPeer[row.peer][unit] = true;
						});
					}
				}
				if (row.unit){
					if (!assocUniqueUnitsByPeer[row.peer])
						assocUniqueUnitsByPeer[row.peer] = {};
					assocUniqueUnitsByPeer[row.peer][row.unit] = true;
				}
			});
			Object.keys(assocUniqueUnitsByPeer).forEach(function(peer){
				var ws = getPeerWebSocket(peer);
				if (ws && ws.readyState === ws.OPEN)
					sendJustsaying(ws, 'light/sequence_became_bad', Object.keys(assocUniqueUnitsByPeer[peer]));
			});
		});
	});
}

function getAllAuthorsAndOutputAddresses(objUnit){
	var arrAuthorAddresses = objUnit.authors.map(function(author){ return author.address; });
	if (!objUnit.messages) // voided unit
		return null;
	var arrOutputAddresses = [];
	var arrBaseAAAddresses = [];
	for (var i=0; i<objUnit.messages.length; i++){
		var message = objUnit.messages[i];
		var payload = message.payload;
		if (message.app === "payment" && payload) {
			for (var j = 0; j < payload.outputs.length; j++) {
				var address = payload.outputs[j].address;
				if (arrOutputAddresses.indexOf(address) === -1)
					arrOutputAddresses.push(address);
			}
		}
		else if (message.app === 'definition' && payload.definition[1].base_aa)
			arrBaseAAAddresses.push(payload.definition[1].base_aa);
	}
	var arrAddresses = _.union(arrAuthorAddresses, arrOutputAddresses, arrBaseAAAddresses);
	return {
		author_addresses: arrAuthorAddresses,
		output_addresses: arrOutputAddresses,
		base_aa_addresses: arrBaseAAAddresses,
		addresses: arrAddresses,
	};
}

// if any of the watched addresses are affected, notifies:  1. own UI  2. light clients
function notifyWatchers(objJoint, bGoodSequence, source_ws){
	var bAA = objJoint.new_aa;
	delete objJoint.new_aa;
	var objUnit = objJoint.unit;
	var objAddresses = getAllAuthorsAndOutputAddresses(objUnit);
	if (!objAddresses) // voided unit
		return;
	var arrAddresses = objAddresses.addresses;

	if (_.intersection(arrWatchedAddresses, arrAddresses).length > 0){
		eventBus.emit("new_my_transactions", [objJoint.unit.unit]);
		eventBus.emit("new_my_unit-"+objJoint.unit.unit, objJoint);
	}
	else
		db.query(
			"SELECT 1 FROM my_addresses WHERE address IN(?) UNION SELECT 1 FROM shared_addresses WHERE shared_address IN(?) UNION SELECT 1 FROM my_watched_addresses WHERE address IN(?)", 
			[arrAddresses, arrAddresses, arrAddresses], 
			function(rows){
				if (rows.length > 0){
					eventBus.emit("new_my_transactions", [objJoint.unit.unit]);
					eventBus.emit("new_my_unit-"+objJoint.unit.unit, objJoint);
				}
			}
		);
	
	if (conf.bLight)
		return;
	if (objJoint.ball || !bGoodSequence) // If already stable, light clients will require a proof. We notify them only good sequence unit.
		return;
	if (!bWatchingForLight)
		return;
	// this is a new unstable joint, light clients will accept it without proof
	db.query("SELECT peer FROM watched_light_addresses WHERE address IN(?)", [arrAddresses], function(rows){
		if (rows.length === 0)
			return;
		if (!objUnit.timestamp)
			objUnit.timestamp = Math.round(Date.now()/1000); // light clients need timestamp
		rows.forEach(function(row){
			var ws = getPeerWebSocket(row.peer);
			if (ws && ws.readyState === ws.OPEN && ws !== source_ws) {
				if (bAA) // trigger a get_history request to receive the aa_response
					sendJustsaying(ws, 'light/have_updates');
				else
					sendJoint(ws, objJoint);
			}
		});
	});

	// look for transactions sent to watched AAs
	if (bAA) // skip secondary triggers, we'll see their responses in a moment
		return;
	var arrOutputAddresses = objAddresses.output_addresses;
	var arrAuthorAddresses = objAddresses.author_addresses;
	var arrBaseAAAddresses = objAddresses.base_aa_addresses;
	var arrAllAAAddresses = arrOutputAddresses.concat(arrBaseAAAddresses);
	db.query("SELECT peer, address, aa FROM watched_light_aas WHERE aa IN(?)", [arrAllAAAddresses], function (rows) {
		rows.forEach(function (row) {
			if ((!row.address || arrAuthorAddresses.includes(row.address)) && arrOutputAddresses.includes(row.aa)) {
				var ws = getPeerWebSocket(row.peer);
				if (ws && ws.readyState === ws.OPEN && ws !== source_ws)
					sendJustsaying(ws, 'light/aa_request', { aa_address: row.aa, unit: objUnit });
			}
			if (arrBaseAAAddresses.includes(row.aa)) {
				var ws = getPeerWebSocket(row.peer);
				if (ws && ws.readyState === ws.OPEN && ws !== source_ws)
					sendJustsaying(ws, 'light/aa_definition', objUnit);
			}
		});
	});
}

eventBus.on('mci_became_stable', notifyWatchersAboutStableJoints);

function notifyWatchersAboutStableJoints(mci){
	// the event was emitted from inside mysql transaction, make sure it completes so that the changes are visible
	// If the mci became stable in determineIfStableInLaterUnitsAndUpdateStableMcFlag (rare), write lock is released before the validation commits, 
	// so we might not see this mci as stable yet. Hopefully, it'll complete before light/have_updates roundtrip
	mutex.lock(["write"], function(unlock){
		unlock(); // we don't need to block writes, we requested the lock just to wait that the current write completes
		notifyLocalWatchedAddressesAboutStableJoints(mci);
		console.log("notifyWatchersAboutStableJoints "+mci);
		if (mci <= 1 || !bWatchingForLight)
			return;
		storage.findLastBallMciOfMci(db, mci, function(last_ball_mci){
			storage.findLastBallMciOfMci(db, mci-1, function(prev_last_ball_mci){
				if (prev_last_ball_mci === last_ball_mci)
					return;
				notifyLightClientsAboutStableJoints(prev_last_ball_mci, last_ball_mci);
			});
		});
	});
}

// from_mci is non-inclusive, to_mci is inclusive
function notifyLightClientsAboutStableJoints(from_mci, to_mci){
	db.query(
		"SELECT peer FROM units CROSS JOIN unit_authors USING(unit) CROSS JOIN watched_light_addresses USING(address) \n\
		WHERE main_chain_index>? AND main_chain_index<=? \n\
		UNION \n\
		SELECT peer FROM units CROSS JOIN outputs USING(unit) CROSS JOIN watched_light_addresses USING(address) \n\
		WHERE main_chain_index>? AND main_chain_index<=? \n\
		UNION \n\
		SELECT peer FROM units CROSS JOIN watched_light_units USING(unit) \n\
		WHERE main_chain_index>? AND main_chain_index<=?",
		[from_mci, to_mci, from_mci, to_mci, from_mci, to_mci],
		function(rows){
			rows.forEach(function(row){
				var ws = getPeerWebSocket(row.peer);
				if (ws && ws.readyState === ws.OPEN)
					sendJustsaying(ws, 'light/have_updates');
			});
			db.query("DELETE FROM watched_light_units \n\
				WHERE unit IN (SELECT unit FROM units WHERE main_chain_index>? AND main_chain_index<=?)", [from_mci, to_mci], function() {
				
			});
		}
	);
}

function notifyLocalWatchedAddressesAboutStableJoints(mci){
	function handleRows(rows){
		if (rows.length > 0){
			eventBus.emit('my_transactions_became_stable', rows.map(function(row){ return row.unit; }));
			rows.forEach(function(row){
				eventBus.emit('my_stable-'+row.unit);
			});
		}
	}
	if (arrWatchedAddresses.length > 0)
		db.query(
			"SELECT unit FROM units CROSS JOIN unit_authors USING(unit) \n\
			WHERE main_chain_index=? AND address IN("+arrWatchedAddresses.map(db.escape).join(', ')+") AND sequence='good' \n\
			UNION \n\
			SELECT unit FROM units CROSS JOIN outputs USING(unit) \n\
			WHERE main_chain_index=? AND address IN("+arrWatchedAddresses.map(db.escape).join(', ')+") AND sequence='good'",
			[mci, mci],
			handleRows
		);
	db.query(
		"SELECT unit FROM units CROSS JOIN unit_authors USING(unit) CROSS JOIN my_addresses USING(address) WHERE main_chain_index=? AND sequence='good' \n\
		UNION \n\
		SELECT unit FROM units CROSS JOIN outputs USING(unit) CROSS JOIN my_addresses USING(address) WHERE main_chain_index=? AND sequence='good' \n\
		UNION \n\
		SELECT unit FROM units CROSS JOIN unit_authors USING(unit) CROSS JOIN shared_addresses ON address=shared_address WHERE main_chain_index=? AND sequence='good' \n\
		UNION \n\
		SELECT unit FROM units CROSS JOIN outputs USING(unit) CROSS JOIN shared_addresses ON address=shared_address WHERE main_chain_index=? AND sequence='good'\n\
		UNION \n\
		SELECT unit FROM units CROSS JOIN unit_authors USING(unit) CROSS JOIN my_watched_addresses USING(address) WHERE main_chain_index=? AND sequence='good' \n\
		UNION \n\
		SELECT unit FROM units CROSS JOIN outputs USING(unit) CROSS JOIN my_watched_addresses USING(address) WHERE main_chain_index=? AND sequence='good'",
		[mci, mci, mci, mci, mci, mci],
		handleRows
	);
}

function aaResponseAffectsAddress(objAAResponse, address) {
	if (objAAResponse.trigger_address === address)
		return true;
	if (objAAResponse.objResponseUnit && objAAResponse.objResponseUnit.messages.find(function (message) {
		return message.app === 'payment' && message.payload.outputs.find(function (output) {
			return output.address === address;
		});
	}))
		return true;
	// check if any updated state variable name contains our address
	var aa_address = objAAResponse.aa_address;
	if (objAAResponse.updatedStateVars && objAAResponse.updatedStateVars[aa_address]) {
		for (var var_name in objAAResponse.updatedStateVars[aa_address]) {
			if (var_name.indexOf(address) >= 0)
				return true;
		}
	}
	// check if the error message contains our address
	if (objAAResponse.response.error && objAAResponse.response.error.indexOf(address) >= 0)
		return true;
	// check if any response variable name contains our address
	if (objAAResponse.response.responseVars) {
		for (var var_name in objAAResponse.response.responseVars) {
			if (var_name.indexOf(address) >= 0)
				return true;
		}
	}
	return false;
}

eventBus.on('aa_response', function (objAAResponse) {
	if (!bWatchingForLight)
		return;
	db.query("SELECT peer, address FROM watched_light_aas WHERE aa=?", [objAAResponse.aa_address], function (rows) {
		if (rows.length === 0)
			return;
		rows.forEach(function (row) {
			if (!row.address || aaResponseAffectsAddress(objAAResponse, row.address)) {
				var ws = getPeerWebSocket(row.peer);
				if (ws && ws.readyState === ws.OPEN)
					sendJustsaying(ws, 'light/aa_response', objAAResponse);
			}
		});
	});
});

// full wallets only
eventBus.on('aa_definition_saved', function (payload, unit) {
	if (!bWatchingForLight)
		return;
	var base_aa = payload.definition[1].base_aa;
	if (!base_aa)
		return;
	db.query("SELECT peer FROM watched_light_aas WHERE aa=?", [base_aa], function (rows) {
		var arrWses = [];
		rows.forEach(function (row) {
			var ws = getPeerWebSocket(row.peer);
			if (ws && ws.readyState === ws.OPEN)
				arrWses.push(ws);
		});
		if (arrWses.length === 0)
			return;
		storage.readJoint(db, unit, {
			ifNotFound: function () {
				console.log('recently saved unit ' + unit + ' not found');
			},
			ifFound: function (objJoint) {
				var objUnit = objJoint.unit;
				arrWses.forEach(function (ws) {
					sendJustsaying(ws, 'light/aa_definition_saved', objUnit);
					// posted by an AA, it was skipped when handling the request
					if (objUnit.authors.length === 1 && !objUnit.authors[0].authentifiers)
						sendJustsaying(ws, 'light/aa_definition', objUnit);
				});
			}
		})
	});
});

function addLightWatchedAddress(address, handle){
	sendJustsayingToLightVendor('light/new_address_to_watch', address, handle);
}

function addLightWatchedAa(aa, address, handle){
	var params = { aa: aa };
	if (address)
		params.address = address;
	sendJustsayingToLightVendor('light/new_aa_to_watch', params, handle);
	eventBus.on('connected', () => sendJustsayingToLightVendor('light/new_aa_to_watch', params));
}

function flushEvents(forceFlushing) {
	if (peer_events_buffer.length == 0 || (!forceFlushing && peer_events_buffer.length != 100)) {
		return;
	}

	var arrQueryParams = [];
	var objUpdatedHosts = {};
	peer_events_buffer.forEach(function(event_row){
		var host = event_row.host;
		var event = event_row.event;
		var event_date = event_row.event_date;
		if (event === 'new_good'){
			var column = "count_"+event+"_joints";
			_.set(objUpdatedHosts, [host, column], _.get(objUpdatedHosts, [host, column], 0)+1);
		}
		arrQueryParams.push("(" + db.escape(host) +"," + db.escape(event) + "," + db.getFromUnixTime(event_date) + ")");
	});

	for (var host in objUpdatedHosts) {
		var columns_obj = objUpdatedHosts[host];
		var sql_columns_updates = [];
		for (var column in columns_obj) {
			sql_columns_updates.push(column + "=" + column + "+" + columns_obj[column]);
		}
		db.query("UPDATE peer_hosts SET "+sql_columns_updates.join()+" WHERE peer_host=?", [host]);
	}

	db.query("INSERT INTO peer_events (peer_host, event, event_date) VALUES "+ arrQueryParams.join());
	peer_events_buffer = [];
	objUpdatedHosts = {};
}

function writeEvent(event, host){
	if (conf.bLight)
		return;
	if (event === 'invalid' || event === 'nonserial'){
		var column = "count_"+event+"_joints";
		db.query("UPDATE peer_hosts SET "+column+"="+column+"+1 WHERE peer_host=?", [host]);
		db.query("INSERT INTO peer_events (peer_host, event) VALUES (?,?)", [host, event]);
		if (event === 'invalid')
			assocBlockedPeers[host] = Date.now();
		return;
	}
	var event_date = Math.floor(Date.now() / 1000);
	peer_events_buffer.push({host: host, event: event, event_date: event_date});
	flushEvents();
}

function determineIfPeerIsBlocked(host, handleResult){
	if (constants.bTestnet || constants.bDevnet)
		return handleResult(false);
	handleResult(!!assocBlockedPeers[host]);
}

function unblockPeers(){
	for (var host in assocBlockedPeers)
		if (assocBlockedPeers[host] < Date.now() - 3600*1000)
			delete assocBlockedPeers[host];
}

function initBlockedPeers(){
	db.query(
		"SELECT peer_host, MAX("+db.getUnixTimestamp('event_date')+") AS ts FROM peer_events \n\
		WHERE event_date>"+db.addTime("-1 HOUR")+" AND event='invalid' \n\
		GROUP BY peer_host",
		function(rows){
			rows.forEach(function(row){
				assocBlockedPeers[row.peer_host] = row.ts*1000;
			});
		}
	);
}


function findAndHandleJointsThatAreReady(unit){
	joint_storage.readDependentJointsThatAreReady(unit, handleSavedJoint);
	handleSavedPrivatePayments(unit);
}

function comeOnline(){
	bCatchingUp = false;
	coming_online_time = Date.now();
	waitTillIdle(function(){
		requestFreeJointsFromAllOutboundPeers();
		setTimeout(cleanBadSavedPrivatePayments, 300*1000);
	});
	eventBus.emit('catching_up_done');
}

function isIdle(){
	//console.log(db._freeConnections.length +"/"+ db._allConnections.length+" connections are free, "+mutex.getCountOfQueuedJobs()+" jobs queued, "+mutex.getCountOfLocks()+" locks held, "+Object.keys(assocUnitsInWork).length+" units in work");
	return (db.getCountUsedConnections() === 0 && mutex.getCountOfQueuedJobs() === 0 && mutex.getCountOfLocks() === 0 && Object.keys(assocUnitsInWork).length === 0);
}

function waitTillIdle(onIdle){
	if (isIdle()){
		eventBus.emit('idle'); // first call the callbacks that were queued earlier
		if (onIdle)
			onIdle();
	}
	else{
		console.log('not idle, will wait');
		if (onIdle)
			eventBus.once('idle', onIdle);
		setTimeout(waitTillIdle, 100);
	}
}

function isSyncIdle() {
	return (db.getCountUsedConnections() === 0 && Object.keys(assocUnitsInWork).length === 0);
}

function waitTillSyncIdle(onIdle){
	if (isSyncIdle()){
		eventBus.emit('sync_idle'); // first call the callbacks that were queued earlier
		if (onIdle)
			onIdle();
	}
	else {
		console.log('sync is active, will wait');
		if (onIdle)
			eventBus.once('sync_idle', onIdle);
		setTimeout(waitTillSyncIdle, 100);
	}
}

function broadcastJoint(objJoint){
	if (!conf.bLight) // the joint was already posted to light vendor before saving
		wss.clients.concat(arrOutboundPeers).forEach(function(client) {
			if (client.bSubscribed)
				sendJoint(client, objJoint);
		});
	notifyWatchers(objJoint, true);
}

function onNewAA(objUnit) {
	findAndHandleJointsThatAreReady(objUnit.unit);
	notifyWatchers({ unit: objUnit, new_aa: true }, true);
}


// catchup

function checkCatchupLeftovers(){
	db.query(
		"SELECT 1 FROM hash_tree_balls \n\
		UNION \n\
		SELECT 1 FROM catchup_chain_balls \n\
		LIMIT 1",
		function(rows){
			if (rows.length === 0)
				return console.log('no leftovers');
			console.log('have catchup leftovers from the previous run');
			findNextPeer(null, function(ws){
				console.log('will request leftovers from '+ws.peer);
				if (!bCatchingUp && !bWaitingForCatchupChain)
					requestCatchup(ws);
			});
		}
	);
}

function requestCatchup(ws){
	console.log("will request catchup from "+ws.peer);
	eventBus.emit('catching_up_started');
	if (conf.storage === 'sqlite')
		db.query("PRAGMA cache_size=-200000", function(){});
	catchup.purgeHandledBallsFromHashTree(db, function(){
		db.query(
			"SELECT hash_tree_balls.unit FROM hash_tree_balls LEFT JOIN units USING(unit) WHERE units.unit IS NULL ORDER BY ball_index", 
			function(tree_rows){ // leftovers from previous run
				if (tree_rows.length > 0){
					bCatchingUp = true;
					console.log("will request balls found in hash tree");
					requestNewMissingJoints(ws, tree_rows.map(function(tree_row){ return tree_row.unit; }));
					waitTillHashTreeFullyProcessedAndRequestNext(ws);
					return;
				}
				db.query("SELECT 1 FROM catchup_chain_balls LIMIT 1", function(chain_rows){ // leftovers from previous run
					if (chain_rows.length > 0){
						bCatchingUp = true;
						requestNextHashTree(ws);
						return;
					}
					// we are not switching to catching up mode until we receive a catchup chain - don't allow peers to throw us into 
					// catching up mode by just sending a ball
					
					// to avoid duplicate requests, we are raising this flag before actually sending the request 
					// (will also reset the flag only after the response is fully processed)
					bWaitingForCatchupChain = true;
					
					console.log('will read last stable mci for catchup');
					storage.readLastStableMcIndex(db, function(last_stable_mci){
						storage.readLastMainChainIndex(function(last_known_mci){
							myWitnesses.readMyWitnesses(function(arrWitnesses){
								var params = {witnesses: arrWitnesses, last_stable_mci: last_stable_mci, last_known_mci: last_known_mci};
								sendRequest(ws, 'catchup', params, true, handleCatchupChain);
							}, 'wait');
						});
					});
				});
			}
		);
	});
}

function handleCatchupChain(ws, request, response){
	if (response.error){
		bWaitingForCatchupChain = false;
		console.log('catchup request got error response: '+response.error);
		// findLostJoints will wake up and trigger another attempt to request catchup
		return;
	}
	var catchupChain = response;
	console.log('received catchup chain from '+ws.peer);
	catchup.processCatchupChain(catchupChain, ws.peer, request.params.witnesses, {
		ifError: function(error){
			bWaitingForCatchupChain = false;
			sendError(ws, error);
		},
		ifOk: function(){
			bWaitingForCatchupChain = false;
			bCatchingUp = true;
			requestNextHashTree(ws);
		},
		ifCurrent: function(){
			bWaitingForCatchupChain = false;
		}
	});
}



// hash tree

function requestNextHashTree(ws){
	eventBus.emit('catchup_next_hash_tree');
	db.query("SELECT ball FROM catchup_chain_balls ORDER BY member_index LIMIT 2", function(rows){
		if (rows.length === 0)
			return comeOnline();
		if (rows.length === 1){
			db.query("DELETE FROM catchup_chain_balls WHERE ball=?", [rows[0].ball], function(){
				comeOnline();
			});
			return;
		}
		var from_ball = rows[0].ball;
		var to_ball = rows[1].ball;
		
		// don't send duplicate requests
		for (var tag in ws.assocPendingRequests)
			if (ws.assocPendingRequests[tag].request.command === 'get_hash_tree'){
				console.log("already requested hash tree from this peer");
				return;
			}
		sendRequest(ws, 'get_hash_tree', {from_ball: from_ball, to_ball: to_ball}, true, handleHashTree);
	});
}

function handleHashTree(ws, request, response){
	if (response.error){
		console.log('get_hash_tree got error response: '+response.error);
		waitTillHashTreeFullyProcessedAndRequestNext(ws); // after 1 sec, it'll request the same hash tree, likely from another peer
		return;
	}
	console.log('received hash tree from '+ws.peer);
	var hashTree = response;
	catchup.processHashTree(hashTree.balls, {
		ifError: function(error){
			sendError(ws, error);
			waitTillHashTreeFullyProcessedAndRequestNext(ws); // after 1 sec, it'll request the same hash tree, likely from another peer
		},
		ifOk: function(){
			requestNewMissingJoints(ws, hashTree.balls.map(function(objBall){ return objBall.unit; }));
			waitTillHashTreeFullyProcessedAndRequestNext(ws);
		}
	});
}

function haveManyUnhandledHashTreeBalls(){
	var count = 0;
	for (var ball in storage.assocHashTreeUnitsByBall){
		var unit = storage.assocHashTreeUnitsByBall[ball];
		if (!storage.assocUnstableUnits[unit]){
			count++;
			if (count > 30)
				return true;
		}
	}
	return false;
}

function waitTillHashTreeFullyProcessedAndRequestNext(ws){
	setTimeout(function(){
	//	db.query("SELECT COUNT(*) AS count FROM hash_tree_balls LEFT JOIN units USING(unit) WHERE units.unit IS NULL", function(rows){
		//	var count = Object.keys(storage.assocHashTreeUnitsByBall).length;
			if (!haveManyUnhandledHashTreeBalls()){
				findNextPeer(ws, function(next_ws){
					requestNextHashTree(next_ws);
				});
			}
			else
				waitTillHashTreeFullyProcessedAndRequestNext(ws);
	//	});
	}, 100);
}




// private payments

function sendPrivatePaymentToWs(ws, arrChains){
	// each chain is sent as separate ws message
	arrChains.forEach(function(arrPrivateElements){
		sendJustsaying(ws, 'private_payment', arrPrivateElements);
	});
}

// sends multiple private payloads and their corresponding chains
function sendPrivatePayment(peer, arrChains){
	var ws = getPeerWebSocket(peer);
	if (ws)
		return sendPrivatePaymentToWs(ws, arrChains);
	findOutboundPeerOrConnect(peer, function(err, ws){
		if (!err)
			sendPrivatePaymentToWs(ws, arrChains);
	});
}

// handles one private payload and its chain
function handleOnlinePrivatePayment(ws, arrPrivateElements, bViaHub, callbacks){
	if (!ValidationUtils.isNonemptyArray(arrPrivateElements))
		return callbacks.ifError("private_payment content must be non-empty array");
	
	var unit = arrPrivateElements[0].unit;
	var message_index = arrPrivateElements[0].message_index;
	var output_index = arrPrivateElements[0].payload.denomination ? arrPrivateElements[0].output_index : -1;
	if (!ValidationUtils.isValidBase64(unit, constants.HASH_LENGTH))
		return callbacks.ifError("invalid unit " + unit);
	if (!ValidationUtils.isNonnegativeInteger(message_index))
		return callbacks.ifError("invalid message_index " + message_index);
	if (!(ValidationUtils.isNonnegativeInteger(output_index) || output_index === -1))
		return callbacks.ifError("invalid output_index " + output_index);

	var savePrivatePayment = function(cb){
		// we may receive the same unit and message index but different output indexes if recipient and cosigner are on the same device.
		// in this case, we also receive the same (unit, message_index, output_index) twice - as cosigner and as recipient.  That's why IGNORE.
		db.query(
			"INSERT "+db.getIgnore()+" INTO unhandled_private_payments (unit, message_index, output_index, json, peer) VALUES (?,?,?,?,?)", 
			[unit, message_index, output_index, JSON.stringify(arrPrivateElements), bViaHub ? '' : ws.peer], // forget peer if received via hub
			function(){
				callbacks.ifQueued();
				if (cb)
					cb();
			}
		);
	};
	
	if (conf.bLight && arrPrivateElements.length > 1){
		savePrivatePayment(function(){
			updateLinkProofsOfPrivateChain(arrPrivateElements, unit, message_index, output_index);
			rerequestLostJointsOfPrivatePayments(); // will request the head element
		});
		return;
	}

	joint_storage.checkIfNewUnit(unit, {
		ifKnown: function(){
			//assocUnitsInWork[unit] = true;
			privatePayment.validateAndSavePrivatePaymentChain(arrPrivateElements, {
				ifOk: function(){
					//delete assocUnitsInWork[unit];
					callbacks.ifAccepted(unit);
					eventBus.emit("new_my_transactions", [unit]);
				},
				ifError: function(error){
					//delete assocUnitsInWork[unit];
					callbacks.ifValidationError(unit, error);
				},
				ifWaitingForChain: function(){
					savePrivatePayment();
				}
			});
		},
		ifNew: function(){
			savePrivatePayment();
			// if received via hub, I'm requesting from the same hub, thus telling the hub that this unit contains a private payment for me.
			// It would be better to request missing joints from somebody else
			requestNewMissingJoints(ws, [unit]);
		},
		ifKnownUnverified: savePrivatePayment,
		ifKnownBad: function(){
			callbacks.ifValidationError(unit, "known bad");
		}
	});
}
	
// if unit is undefined, find units that are ready
function handleSavedPrivatePayments(unit){
	//if (unit && assocUnitsInWork[unit])
	//    return;
	if (!unit && mutex.isAnyOfKeysLocked(["private_chains"])) // we are still downloading the history (light)
		return console.log("skipping handleSavedPrivatePayments because history download is still under way");
	var lock = unit ? mutex.lock : mutex.lockOrSkip;
	lock(["saved_private"], function(unlock){
		var sql = unit
			? "SELECT json, peer, unit, message_index, output_index, linked FROM unhandled_private_payments WHERE unit="+db.escape(unit)
			: "SELECT json, peer, unit, message_index, output_index, linked FROM unhandled_private_payments CROSS JOIN units USING(unit)";
		db.query(sql, function(rows){
			if (rows.length === 0)
				return unlock();
			var assocNewUnits = {};
			async.each( // handle different chains in parallel
				rows,
				function(row, cb){
					var arrPrivateElements = JSON.parse(row.json);
					var ws = getPeerWebSocket(row.peer);
					if (ws && ws.readyState !== ws.OPEN)
						ws = null;
					
					var validateAndSave = function(){
						var objHeadPrivateElement = arrPrivateElements[0];
						var json_payload_hash = objectHash.getBase64Hash(objHeadPrivateElement.payload, true);
						var key = 'private_payment_validated-'+objHeadPrivateElement.unit+'-'+json_payload_hash+'-'+row.output_index;
						privatePayment.validateAndSavePrivatePaymentChain(arrPrivateElements, {
							ifOk: function(){
								if (ws)
									sendResult(ws, {private_payment_in_unit: row.unit, result: 'accepted'});
								if (row.peer) // received directly from a peer, not through the hub
									eventBus.emit("new_direct_private_chains", [arrPrivateElements]);
								assocNewUnits[row.unit] = true;
								deleteHandledPrivateChain(row.unit, row.message_index, row.output_index, cb);
								console.log('emit '+key);
								eventBus.emit(key, true);
							},
							ifError: function(error){
								console.log("validation of priv: "+error);
							//	throw Error(error);
								if (ws)
									sendResult(ws, {private_payment_in_unit: row.unit, result: 'error', error: error});
								deleteHandledPrivateChain(row.unit, row.message_index, row.output_index, cb);
								eventBus.emit(key, false);
							},
							// light only. Means that chain joints (excluding the head) not downloaded yet or not stable yet
							ifWaitingForChain: function(){
								console.log('waiting for chain: unit '+row.unit+', message '+row.message_index+' output '+row.output_index);
								cb();
							}
						});
					};
					
					if (conf.bLight && arrPrivateElements.length > 1 && !row.linked)
						updateLinkProofsOfPrivateChain(arrPrivateElements, row.unit, row.message_index, row.output_index, cb, validateAndSave);
					else
						validateAndSave();
					
				},
				function(){
					unlock();
					var arrNewUnits = Object.keys(assocNewUnits);
					if (arrNewUnits.length > 0)
						eventBus.emit("new_my_transactions", arrNewUnits);
				}
			);
		});
	});
}

function deleteHandledPrivateChain(unit, message_index, output_index, cb){
	db.query("DELETE FROM unhandled_private_payments WHERE unit=? AND message_index=? AND output_index=?", [unit, message_index, output_index], function(){
		cb();
	});
}

// full only
function cleanBadSavedPrivatePayments(){
	if (conf.bLight || bCatchingUp)
		return;
	db.query(
		"SELECT DISTINCT unhandled_private_payments.unit FROM unhandled_private_payments LEFT JOIN units USING(unit) \n\
		WHERE units.unit IS NULL AND unhandled_private_payments.creation_date<"+db.addTime('-1 DAY'),
		function(rows){
			rows.forEach(function(row){
				breadcrumbs.add('deleting bad saved private payment '+row.unit);
				db.query("DELETE FROM unhandled_private_payments WHERE unit=?", [row.unit]);
			});
		}
	);
	
}

// light only
function rerequestLostJointsOfPrivatePayments(){
	if (!conf.bLight || !exports.light_vendor_url)
		return;
	db.query(
		"SELECT DISTINCT unhandled_private_payments.unit FROM unhandled_private_payments LEFT JOIN units USING(unit) WHERE units.unit IS NULL",
		function(rows){
			if (rows.length === 0)
				return;
			var arrUnits = rows.map(function(row){ return row.unit; });
			findOutboundPeerOrConnect(exports.light_vendor_url, function(err, ws){
				if (err)
					return;
				requestNewMissingJoints(ws, arrUnits);
			});
		}
	);
}

// light only
function requestUnfinishedPastUnitsOfPrivateChains(arrChains, onDone){
	mutex.lock(["private_chains"], function(unlock){
		function finish(){
			unlock();
			if (onDone)
				onDone();
		}
		privatePayment.findUnfinishedPastUnitsOfPrivateChains(arrChains, true, function(arrUnits){
			if (arrUnits.length === 0)
				return finish();
			breadcrumbs.add(arrUnits.length+" unfinished past units of private chains");
			requestHistoryFor(arrUnits, [], finish);
		});
	});
}

function requestHistoryFor(arrUnits, arrAddresses, onDone){
	if (!onDone)
		onDone = function(){};
	myWitnesses.readMyWitnesses(function(arrWitnesses){
		var objHistoryRequest = {witnesses: arrWitnesses};
		if (arrUnits.length)
			objHistoryRequest.requested_joints = arrUnits;
		if (arrAddresses.length)
			objHistoryRequest.addresses = arrAddresses;
		requestFromLightVendor('light/get_history', objHistoryRequest, function(ws, request, response){
			if (response.error){
				console.log(response.error);
				return onDone(response.error);
			}
			light.processHistory(response, arrWitnesses, {
				ifError: function(err){
					sendError(ws, err);
					onDone(err);
				},
				ifOk: function(){
					onDone();
				}
			});
		});
	}, 'wait');
}

function requestProofsOfJointsIfNewOrUnstable(arrUnits, onDone){
	if (!onDone)
		onDone = function(){};
	storage.filterNewOrUnstableUnits(arrUnits, function(arrNewOrUnstableUnits){
		if (arrNewOrUnstableUnits.length === 0)
			return onDone();
		requestHistoryFor(arrUnits, [], onDone);
	});
}

// light only
function requestUnfinishedPastUnitsOfSavedPrivateElements(){
	mutex.lockOrSkip(['saved_private_chains'], function(unlock){
		db.query("SELECT json FROM unhandled_private_payments", function(rows){
			eventBus.emit('unhandled_private_payments_left', rows.length);
			if (rows.length === 0)
				return unlock();
			breadcrumbs.add(rows.length+" unhandled private payments");
			var arrChains = [];
			rows.forEach(function(row){
				var arrPrivateElements = JSON.parse(row.json);
				arrChains.push(arrPrivateElements);
			});
			requestUnfinishedPastUnitsOfPrivateChains(arrChains, function onPrivateChainsReceived(err){
				if (err){
					console.log("error from requestUnfinishedPastUnitsOfPrivateChains: "+err);
					return unlock();
				}
				console.log("requestUnfinishedPastUnitsOfPrivateChains done");
				handleSavedPrivatePayments();
				setTimeout(unlock, 2000);
			});
		});
	});
}

// light only
// Note that we are leaking to light vendor information about the full chain. 
// If the light vendor was a party to any previous transaction in this chain, he'll know how much we received.
function checkThatEachChainElementIncludesThePrevious(arrPrivateElements, handleResult){
	if (arrPrivateElements.length === 1) // an issue
		return handleResult(true);
	var arrUnits = arrPrivateElements.map(function(objPrivateElement){ return objPrivateElement.unit; });
	requestFromLightVendor('light/get_link_proofs', arrUnits, function(ws, request, response){
		if (response.error)
			return handleResult(null); // undefined result
		var arrChain = response;
		if (!ValidationUtils.isNonemptyArray(arrChain))
			return handleResult(null); // undefined result
		light.processLinkProofs(arrUnits, arrChain, {
			ifError: function(err){
				console.log("linkproof validation failed: "+err);
				throw Error(err);
				handleResult(false);
			},
			ifOk: function(){
				console.log("linkproof validated ok");
				handleResult(true);
			}
		});
	});
}

// light only
function updateLinkProofsOfPrivateChain(arrPrivateElements, unit, message_index, output_index, onFailure, onSuccess){
	if (!conf.bLight)
		throw Error("not light but updateLinkProofsOfPrivateChain");
	if (!onFailure)
		onFailure = function(){};
	if (!onSuccess)
		onSuccess = function(){};
	checkThatEachChainElementIncludesThePrevious(arrPrivateElements, function(bLinked){
		if (bLinked === null)
			return onFailure();
		if (!bLinked)
			return deleteHandledPrivateChain(unit, message_index, output_index, onFailure);
		// the result cannot depend on output_index
		db.query("UPDATE unhandled_private_payments SET linked=1 WHERE unit=? AND message_index=?", [unit, message_index], function(){
			onSuccess();
		});
	});
}

function initWitnessesIfNecessary(ws, onDone){
	onDone = onDone || function(){};
	myWitnesses.readMyWitnesses(function(arrWitnesses){
		if (arrWitnesses.length > 0) // already have witnesses
			return onDone();
		sendRequest(ws, 'get_witnesses', null, false, function(ws, request, arrWitnesses){
			if (arrWitnesses.error){
				console.log('get_witnesses returned error: '+arrWitnesses.error);
				return onDone();
			}
			myWitnesses.insertWitnesses(arrWitnesses, onDone);
		});
	}, 'ignore');
}


// hub

function deleteOverlengthMessagesIfLimitIsSet(ws, device_address, handle){
	if (ws.max_message_length)
		db.query("DELETE FROM device_messages WHERE device_address=? AND LENGTH(message)>?", [device_address, ws.max_message_length], function(){
			return handle();
		});
	else
		return handle();
}


function sendStoredDeviceMessages(ws, device_address){
	deleteOverlengthMessagesIfLimitIsSet(ws, device_address, function(){
		var max_message_count = ws.max_message_count ? ws.max_message_count : 100;
		db.query("SELECT message_hash, message FROM device_messages WHERE device_address=? ORDER BY creation_date LIMIT ?", [device_address, max_message_count], function(rows){
			rows.forEach(function(row){
				sendJustsaying(ws, 'hub/message', {message_hash: row.message_hash, message: JSON.parse(row.message)});
			});
			sendInfo(ws, rows.length+" messages sent");
			sendJustsaying(ws, 'hub/message_box_status', (rows.length === max_message_count) ? 'has_more' : 'empty');
		});
	});
}

function version2int(version){
	var arr = version.split('.');
	return arr[0]*1000000 + arr[1]*1000 + arr[2]*1;
}


// switch/case different message types

function handleJustsaying(ws, subject, body){
	switch (subject){
		case 'refresh':
			if (bCatchingUp)
				return;
			var mci = body;
			if (ValidationUtils.isNonnegativeInteger(mci))
				return sendJointsSinceMci(ws, mci);
			else
				return sendFreeJoints(ws);
			
		case 'version':
			if (!body)
				return;
			if (constants.supported_versions.indexOf(body.protocol_version) === -1){
				sendError(ws, 'Incompatible versions, I support '+constants.supported_versions.join(', ')+', yours '+body.protocol_version);
				ws.close(1000, 'incompatible versions');
				return;
			}
			if (body.alt !== constants.alt){
				sendError(ws, 'Incompatible alts, mine '+constants.alt+', yours '+body.alt);
				ws.close(1000, 'incompatible alts');
				return;
			}
			ws.library_version = body.library_version;
			if (typeof ws.library_version !== 'string') {
				sendError(ws, "invalid library_version: " + ws.library_version);
				return ws.close(1000, "invalid library_version");
			}
			if (version2int(ws.library_version) < version2int(constants.minCoreVersion)){
				ws.old_core = true;
				ws.bSubscribed = false;
				sendJustsaying(ws, 'upgrade_required');
				sendJustsaying(ws, "old core");
				return ws.close(1000, "old core");
			}
			if (version2int(ws.library_version) < version2int(constants.minCoreVersionForFullNodes)){
				ws.old_core = true;
				if (ws.bSubscribed){
					ws.bSubscribed = false;
					sendJustsaying(ws, 'upgrade_required');
					sendJustsaying(ws, "old core (full)");
					return ws.close(1000, "old core (full)");
				}
			}
			if (version2int(ws.library_version) < version2int(constants.minCoreVersionToSharePeers)){
				ws.dontSharePeers = true;
				sendJustsaying(ws, "please upgrade the core to at least " + constants.minCoreVersionToSharePeers);
			}
			eventBus.emit('peer_version', ws, body); // handled elsewhere
			break;

		case 'new_version': // a new version is available
			if (!body)
				return;
			if (ws.bLoggingIn || ws.bLoggedIn) // accept from hub only
				eventBus.emit('new_version', ws, body);
			break;

		case 'hub/push_project_number':
			if (!body)
				return;
			if (ws.bLoggingIn || ws.bLoggedIn)
				eventBus.emit('receivedPushProjectNumber', ws, body);
			break;
		
		case 'bugreport':
			if (!body)
				return;
			var arrParts = body.exception.toString().split("Breadcrumbs", 2);
			var text = body.message + ' ' + arrParts[0];
			var matches = body.message.match(/message encrypted to unknown key, device (0\w{32})/);
			var hash = matches ? matches[1] : crypto.createHash("sha256").update(text, "utf8").digest("base64");
			if (hash === prev_bugreport_hash)
				return console.log("ignoring known bug report");
			prev_bugreport_hash = hash;
			if (conf.ignoreBugreportRegexp && new RegExp(conf.ignoreBugreportRegexp).test(text))
				return console.log('ignoring bugreport');
			mail.sendBugEmail(body.message, body.exception);
			break;
			
		case 'joint':
			var objJoint = body;
			if (!objJoint || !objJoint.unit || !objJoint.unit.unit)
				return sendError(ws, 'no unit');
			if (objJoint.ball && !storage.isGenesisUnit(objJoint.unit.unit))
				return sendError(ws, 'only requested joint can contain a ball');
			if (conf.bLight && !ws.bLightVendor)
				return sendError(ws, "I'm a light client and you are not my vendor");
			db.query("SELECT 1 FROM archived_joints WHERE unit=? AND reason='uncovered'", [objJoint.unit.unit], function(rows){
				if (rows.length > 0) // ignore it as long is it was unsolicited
					return sendError(ws, "this unit is already known and archived");
				if (objectLength.getRatio(objJoint.unit) > 3)
					return sendError(ws, "the total size of keys is too large");
				// light clients accept the joint without proof, it'll be saved as unconfirmed (non-stable)
				return conf.bLight ? handleLightOnlineJoint(ws, objJoint) : handleOnlineJoint(ws, objJoint);
			});
			
		case 'free_joints_end':
		case 'result':
		case 'info':
		case 'error':
			break;
			
		case 'private_payment':
			if (!body)
				return;
			var arrPrivateElements = body;
			handleOnlinePrivatePayment(ws, arrPrivateElements, false, {
				ifError: function(error){
					sendError(ws, error);
				},
				ifAccepted: function(unit){
					sendResult(ws, {private_payment_in_unit: unit, result: 'accepted'});
					eventBus.emit("new_direct_private_chains", [arrPrivateElements]);
				},
				ifValidationError: function(unit, error){
					sendResult(ws, {private_payment_in_unit: unit, result: 'error', error: error});
				},
				ifQueued: function(){
				}
			});
			break;
			
		case 'my_url':
			if (!ValidationUtils.isNonemptyString(body))
				return;
			var url = body;
			if (ws.bOutbound) // ignore: if you are outbound, I already know your url
				break;
			// inbound only
			if (ws.bAdvertisedOwnUrl) // allow it only once per connection
				break;
			ws.bAdvertisedOwnUrl = true;
			var regexp = (conf.WS_PROTOCOL === 'wss://') ? /^wss:\/\// : /^wss?:\/\//;
			if (!url.match(regexp)) {
				console.log("ignoring peer's my_url " + url + " because of incompatible ws protocol");
				break;
			}
			ws.claimed_url = url;
			db.query("SELECT creation_date AS latest_url_change_date, url FROM peer_host_urls WHERE peer_host=? ORDER BY creation_date DESC LIMIT 1", [ws.host], function(rows){
				var latest_change = rows[0];
				if (latest_change && latest_change.url === url) // advertises the same url
					return;
				//var elapsed_time = Date.now() - Date.parse(latest_change.latest_url_change_date);
				//if (elapsed_time < 24*3600*1000) // change allowed no more often than once per day
				//    return;
				
				// verify it is really your url by connecting to this url, sending a random string through this new connection, 
				// and expecting this same string over existing inbound connection
				ws.sent_echo_string = crypto.randomBytes(30).toString("base64");
				findOutboundPeerOrConnect(url, function(err, reverse_ws){
					if (!err)
						sendJustsaying(reverse_ws, 'want_echo', ws.sent_echo_string);
				});
			});
			break;
			
		case 'want_echo':
			var echo_string = body;
			if (ws.bOutbound || !echo_string) // ignore
				break;
			// inbound only
			if (!ws.claimed_url)
				break;
			var reverse_ws = getOutboundPeerWsByUrl(ws.claimed_url);
			if (!reverse_ws) // no reverse outbound connection
				break;
			sendJustsaying(reverse_ws, 'your_echo', echo_string);
			break;
			
		case 'your_echo': // comes on the same ws as my_url, claimed_url is already set
			var echo_string = body;
			if (ws.bOutbound || !echo_string) // ignore
				break;
			// inbound only
			if (!ws.claimed_url)
				break;
			if (ws.sent_echo_string !== echo_string)
				break;
			var outbound_host = getHostByPeer(ws.claimed_url);
			var arrQueries = [];
			db.addQuery(arrQueries, "INSERT "+db.getIgnore()+" INTO peer_hosts (peer_host) VALUES (?)", [outbound_host]);
			db.addQuery(arrQueries, "INSERT "+db.getIgnore()+" INTO peers (peer_host, peer, learnt_from_peer_host) VALUES (?,?,?)", 
				[outbound_host, ws.claimed_url, ws.host]);
			db.addQuery(arrQueries, "UPDATE peer_host_urls SET is_active=NULL, revocation_date="+db.getNow()+" WHERE peer_host=?", [ws.host]);
			db.addQuery(arrQueries, "INSERT INTO peer_host_urls (peer_host, url) VALUES (?,?)", [ws.host, ws.claimed_url]);
			async.series(arrQueries);
			ws.sent_echo_string = null;
			break;
			
			
		// I'm a hub, the peer wants to authenticate
		case 'hub/login':
			if (!body)
				return;
			if (!conf.bServeAsHub)
				return sendError(ws, "I'm not a hub");
			var objLogin = body;
			if (objLogin.challenge !== ws.challenge)
				return sendError(ws, "wrong challenge");
			if (!objLogin.pubkey || !objLogin.signature)
				return sendError(ws, "no login params");
			if (!ValidationUtils.isStringOfLength(objLogin.pubkey, constants.PUBKEY_LENGTH))
				return sendError(ws, "wrong pubkey length");
			if (!ValidationUtils.isStringOfLength(objLogin.signature, constants.SIG_LENGTH))
				return sendError(ws, "wrong signature length");
			if (objLogin.max_message_length && !ValidationUtils.isPositiveInteger(objLogin.max_message_length))
				return sendError(ws, "max_message_length must be an integer");
			if (objLogin.max_message_count && (!ValidationUtils.isPositiveInteger(objLogin.max_message_count) || objLogin.max_message_count > 100))
				return sendError(ws, "max_message_count must be an integer > 0 and <= 100");
			if (!ecdsaSig.verify(objectHash.getDeviceMessageHashToSign(objLogin), objLogin.signature, objLogin.pubkey))
				return sendError(ws, "wrong signature");
			ws.device_address = objectHash.getDeviceAddress(objLogin.pubkey);
			ws.max_message_length = objLogin.max_message_length;
			ws.max_message_count = objLogin.max_message_count;
			// after this point the device is authenticated and can send further commands
			var finishLogin = function(){
				ws.bLoginComplete = true;
				if (ws.onLoginComplete){
					ws.onLoginComplete();
					delete ws.onLoginComplete;
				}
			};
			db.query("SELECT 1 FROM devices WHERE device_address=?", [ws.device_address], function(rows){
				if (rows.length === 0)
					db.query("INSERT "+db.getIgnore()+" INTO devices (device_address, pubkey) VALUES (?,?)", [ws.device_address, objLogin.pubkey], function(){
						sendInfo(ws, "address created");
						finishLogin();
					});
				else {
					if (!ws.blockChat)
						sendStoredDeviceMessages(ws, ws.device_address);
					finishLogin();
				}
			});
			sendJustsaying(ws, 'hub/push_project_number', {projectNumber: (conf.pushApiProjectNumber && conf.pushApiKey ? conf.pushApiProjectNumber : 0), hasKeyId: !!conf.keyId});
			eventBus.emit('client_logged_in', ws);
			break;
			
		// I'm a hub, the peer wants to download new messages
		case 'hub/refresh':
			if (!conf.bServeAsHub)
				return sendError(ws, "I'm not a hub");
			if (!ws.device_address)
				return sendError(ws, "please log in first");
			if (ws.blockChat)
				return sendError(ws, "chat is blocked, please upgrade");
			sendStoredDeviceMessages(ws, ws.device_address);
			break;
			
		// I'm a hub, the peer wants to remove a message that he's just handled
		case 'hub/delete':
			if (!conf.bServeAsHub)
				return sendError(ws, "I'm not a hub");
			var message_hash = body;
			if (!message_hash)
				return sendError(ws, "no message hash");
			if (!ws.device_address)
				return sendError(ws, "please log in first");
			db.query("DELETE FROM device_messages WHERE device_address=? AND message_hash=?", [ws.device_address, message_hash], function(){
				sendInfo(ws, "deleted message "+message_hash);
			});
			break;
			
		// I'm a hub, the peer wants update settings for a correspondent device
		case 'hub/update_correspondent_settings':
			if (!body)
				return;
			if (!conf.bServeAsHub)
				return sendError(ws, "I'm not a hub");
			if (!ws.device_address)
				return sendError(ws, "please log in first");
			if (body.push_enabled !== 0 && body.push_enabled !== 1)
				return sendError(ws, "invalid push_enabled");
			if (!ValidationUtils.isValidDeviceAddress(body.correspondent_address))
				return sendError(ws, "invalid correspondent_address");
			db.query(
				"INSERT "+db.getIgnore()+" INTO correspondent_settings (device_address, correspondent_address, push_enabled) VALUES(?,?,?)",
				[ws.device_address, body.correspondent_address, body.push_enabled],
				function(res){
					if (res.affectedRows === 0)
						db.query("UPDATE correspondent_settings SET push_enabled=? WHERE device_address=? AND correspondent_address=?", [body.push_enabled, ws.device_address, body.correspondent_address]);
					sendInfo(ws, "updated push "+body.push_enabled);
				}
			);
			break;
			
		// I'm connected to a hub
		case 'hub/challenge':
		case 'hub/message':
		case 'hub/message_box_status':
			if (!body)
				return;
			eventBus.emit("message_from_hub", ws, subject, body);
			break;
			
		// I'm light client
		case 'light/have_updates':
		case 'light/sequence_became_bad':
		case 'light/aa_request':
		case 'light/aa_definition':
		case 'light/aa_response':
		case 'light/aa_definition_saved':
			if (!conf.bLight)
				return sendError(ws, "I'm not light");
			if (!ws.bLightVendor)
				return sendError(ws, "You are not my light vendor");
			eventBus.emit("message_for_light", ws, subject, body);
			break;
			
		// I'm light vendor
		case 'light/new_address_to_watch':
			if (conf.bLight)
				return sendError(ws, "I'm light myself, can't serve you");
			if (ws.bOutbound)
				return sendError(ws, "light clients have to be inbound");
			var address = body;
			if (!ValidationUtils.isValidAddress(address))
				return sendError(ws, "address not valid");
			bWatchingForLight = true;
			db.query("INSERT "+db.getIgnore()+" INTO watched_light_addresses (peer, address) VALUES (?,?)", [ws.peer, address], function(){
				sendInfo(ws, "now watching "+address);
				// check if we already have something on this address
				db.query(
					"SELECT unit, is_stable FROM unit_authors JOIN units USING(unit) WHERE address=? \n\
					UNION \n\
					SELECT unit, is_stable FROM outputs JOIN units USING(unit) WHERE address=? \n\
					ORDER BY is_stable LIMIT 10", 
					[address, address], 
					function(rows){
						if (rows.length === 0)
							return;
						if (rows.length === 10 || rows.some(function(row){ return row.is_stable; }))
							sendJustsaying(ws, 'light/have_updates');
						rows.forEach(function(row){
							if (row.is_stable)
								return;
							storage.readJoint(db, row.unit, {
								ifFound: function(objJoint){
									sendJoint(ws, objJoint);
								},
								ifNotFound: function(){
									throw Error("watched unit "+row.unit+" not found");
								}
							});
						});
					}
				);
			});            
			break;
			
		case 'light/new_aa_to_watch':
			if (!body)
				return;
			if (conf.bLight)
				return sendError(ws, "I'm light myself, can't serve you");
			if (ws.bOutbound)
				return sendError(ws, "light clients have to be inbound");
			if (!ValidationUtils.isValidAddress(body.aa))
				return sendError(ws, "invalid AA: " + body.aa);
			if (body.address && !ValidationUtils.isValidAddress(body.address))
				return sendError(ws, "invalid address: " + body.address);
			storage.readAADefinition(db, body.aa, function (arrDefinition) {
				if (!arrDefinition) {
					arrDefinition = storage.getUnconfirmedAADefinition(body.aa);
					if (!arrDefinition)
						return sendError(ws, "not an AA: " + body.aa);
				}
				bWatchingForLight = true;
				db.query("INSERT " + db.getIgnore() + " INTO watched_light_aas (peer, aa, address) VALUES (?,?,?)", [ws.peer, body.aa, body.address || ''], function () {
					sendInfo(ws, "now watching AA " + body.aa + " address " + (body.address || 'all'));
				});
			});
			break;
			
		case 'exchange_rates':
			if (!ws.bLoggingIn && !ws.bLoggedIn) // accept from hub only
				return;
			_.assign(exchangeRates, body);
			eventBus.emit('rates_updated');
			break;
			
		case 'known_witnesses':
			if (!ws.bLoggingIn && !ws.bLoggedIn) // accept from hub only
				return console.log('ignoring known_witnesses from non-hub');
			_.assign(knownWitnesses, body);
			eventBus.emit('known_witnesses_updated');
			break;
			
		case 'upgrade_required':
			if (!ws.bLoggingIn && !ws.bLoggedIn) // accept from hub only
				return;
			ws.close(1000, "my core is old");
			throw Error("Mandatory upgrade required, please check the release notes at https://github.com/byteball/obyte-gui-wallet/releases and upgrade.");
			break;
			
		case 'custom':
			eventBus.emit('custom_justsaying', ws, body);
			break;
	}
}

function handleRequest(ws, tag, command, params){
	if (!command)
		return sendErrorResponse(ws, tag, "no command");
	if (ws.assocCommandsInPreparingResponse[tag]) // ignore repeated request while still preparing response to a previous identical request
		return console.log("ignoring identical "+command+" request");
	ws.assocCommandsInPreparingResponse[tag] = command;
	if (command.startsWith('light/')) {
		if (conf.bLight)
			return sendErrorResponse(ws, tag, "I'm light myself, can't serve you");
		if (ws.bOutbound)
			return sendErrorResponse(ws, tag, "light clients have to be inbound");
	}
	switch (command){
		case 'heartbeat':
			ws.bSleeping = false; // the peer is sending heartbeats, therefore he is awake
			
			// true if our timers were paused
			// Happens only on android, which suspends timers when the app becomes paused but still keeps network connections
			// Handling 'pause' event would've been more straightforward but with preference KeepRunning=false, the event is delayed till resume
			var bPaused = (typeof window !== 'undefined' && window && window.cordova && Date.now() - last_hearbeat_wake_ts > HEARTBEAT_PAUSE_TIMEOUT);
			if (bPaused)
				return sendResponse(ws, tag, 'sleep'); // opt out of receiving heartbeats and move the connection into a sleeping state
			sendResponse(ws, tag);
			break;
			
		case 'subscribe':
			if (!ValidationUtils.isNonemptyObject(params))
				return sendErrorResponse(ws, tag, 'no params');
			var subscription_id = params.subscription_id;
			if (typeof subscription_id !== 'string')
				return sendErrorResponse(ws, tag, 'no subscription_id');
			if (wss.clients.concat(arrOutboundPeers).some(function(other_ws) { return (other_ws.subscription_id === subscription_id); })){
				if (ws.bOutbound)
					db.query("UPDATE peers SET is_self=1 WHERE peer=?", [ws.peer]);
				sendErrorResponse(ws, tag, "self-connect");
				return ws.close(1000, "self-connect");
			}
			if (conf.bLight){
				//if (ws.peer === exports.light_vendor_url)
				//    sendFreeJoints(ws);
				return sendErrorResponse(ws, tag, "I'm light, cannot subscribe you to updates");
			}
			if (typeof params.library_version !== 'string') {
				sendErrorResponse(ws, tag, "invalid library_version: " + params.library_version);
				return ws.close(1000, "invalid library_version");
			}
			if (version2int(params.library_version) < version2int(constants.minCoreVersionForFullNodes))
				ws.old_core = true;
			if (ws.old_core){ // can be also set in 'version'
				sendJustsaying(ws, 'upgrade_required');
				sendErrorResponse(ws, tag, "old core (full)");
				return ws.close(1000, "old core (full)");
			}
			ws.bSubscribed = true;
			sendResponse(ws, tag, "subscribed");
			if (bCatchingUp)
				return;
			if (ValidationUtils.isNonnegativeInteger(params.last_mci))
				sendJointsSinceMci(ws, params.last_mci);
			else
				sendFreeJoints(ws);
			break;
			
		case 'get_joint': // peer needs a specific joint
			//if (bCatchingUp)
			//    return;
			if (ws.old_core)
				return sendErrorResponse(ws, tag, "old core, will not serve get_joint");
			var unit = params;
			storage.readJoint(db, unit, {
				ifFound: function(objJoint){
					// make the peer go a bit deeper into stable units and request catchup only when and if it reaches min retrievable and we can deliver a catchup
					if (objJoint.ball && objJoint.unit.main_chain_index > storage.getMinRetrievableMci()) {
						delete objJoint.ball;
						delete objJoint.skiplist_units;
					}
					sendJoint(ws, objJoint, tag);
				},
				ifNotFound: function(){
					sendResponse(ws, tag, {joint_not_found: unit});
				}
			});
			break;
			
		case 'post_joint': // only light clients use this command to post joints they created
			var objJoint = params;
			if (objectLength.getRatio(objJoint.unit) > 3)
				return sendErrorResponse(ws, tag, "the total size of keys is too large");
			handlePostedJoint(ws, objJoint, function(error){
				error ? sendErrorResponse(ws, tag, error) : sendResponse(ws, tag, 'accepted');
			});
			break;
			
		case 'catchup':
			if (!ws.bSubscribed)
				return sendErrorResponse(ws, tag, "not subscribed, will not serve catchup");
			var catchupRequest = params;
			mutex.lock(['catchup_request'], function(unlock){
				if (!ws || ws.readyState !== ws.OPEN) // may be already gone when we receive the lock
					return process.nextTick(unlock);
				catchup.prepareCatchupChain(catchupRequest, {
					ifError: function(error){
						sendErrorResponse(ws, tag, error);
						unlock();
					},
					ifOk: function(objCatchupChain){
						sendResponse(ws, tag, objCatchupChain);
						unlock();
					}
				});
			});
			break;
			
		case 'get_hash_tree':
			if (!ws.bSubscribed)
				return sendErrorResponse(ws, tag, "not subscribed, will not serve get_hash_tree");
			var hashTreeRequest = params;
			mutex.lock(['get_hash_tree_request'], function(unlock){
				if (!ws || ws.readyState !== ws.OPEN) // may be already gone when we receive the lock
					return process.nextTick(unlock);
				catchup.readHashTree(hashTreeRequest, {
					ifError: function(error){
						sendErrorResponse(ws, tag, error);
						unlock();
					},
					ifOk: function(arrBalls){
						// we have to wrap arrBalls into an object because the peer will check .error property first
						sendResponse(ws, tag, {balls: arrBalls});
						unlock();
					}
				});
			});
			break;
			
		case 'get_peers':
			var arrPeerUrls = arrOutboundPeers.filter(function(ws){ return (ws.host !== 'byteball.org' && ws.readyState === ws.OPEN && ws.bSubscribed && ws.bSource); }).map(function(ws){ return ws.peer; });
			if (ws.dontSharePeers)
				arrPeerUrls = [];
			// empty array is ok
			sendResponse(ws, tag, arrPeerUrls);
			break;
			
		case 'get_witnesses':
			myWitnesses.readMyWitnesses(function(arrWitnesses){
				sendResponse(ws, tag, arrWitnesses);
			}, 'wait');
			break;
			
		case 'get_last_mci':
			storage.readLastMainChainIndex(function(last_mci){
				sendResponse(ws, tag, last_mci);
			});
			break;
			
		// I'm a hub, the peer wants to deliver a message to one of my clients
		case 'hub/deliver':
			var objDeviceMessage = params;
			if (!objDeviceMessage || !objDeviceMessage.signature || !objDeviceMessage.pubkey || !objDeviceMessage.to
					|| !objDeviceMessage.encrypted_package || !objDeviceMessage.encrypted_package.dh
					|| !objDeviceMessage.encrypted_package.dh.sender_ephemeral_pubkey 
					|| !objDeviceMessage.encrypted_package.encrypted_message
					|| !objDeviceMessage.encrypted_package.iv || !objDeviceMessage.encrypted_package.authtag)
				return sendErrorResponse(ws, tag, "missing fields");
			var bToMe = (my_device_address && my_device_address === objDeviceMessage.to);
			if (!conf.bServeAsHub && !bToMe)
				return sendErrorResponse(ws, tag, "I'm not a hub");
			if (!ecdsaSig.verify(objectHash.getDeviceMessageHashToSign(objDeviceMessage), objDeviceMessage.signature, objDeviceMessage.pubkey))
				return sendErrorResponse(ws, tag, "wrong message signature");
			
			// if i'm always online and i'm my own hub
			if (bToMe){
				sendResponse(ws, tag, "accepted");
				eventBus.emit("message_from_hub", ws, 'hub/message', {
					message_hash: objectHash.getBase64Hash(objDeviceMessage),
					message: objDeviceMessage
				});
				return;
			}
			
			db.query("SELECT 1 FROM devices WHERE device_address=?", [objDeviceMessage.to], function(rows){
				if (rows.length === 0)
					return sendErrorResponse(ws, tag, "address "+objDeviceMessage.to+" not registered here");
				var message_hash = objectHash.getBase64Hash(objDeviceMessage);
				var message_string = JSON.stringify(objDeviceMessage);
				db.query(
					"INSERT "+db.getIgnore()+" INTO device_messages (message_hash, message, device_address) VALUES (?,?,?)", 
					[message_hash, message_string, objDeviceMessage.to],
					function(){
						// if the addressee is connected, deliver immediately
						wss.clients.concat(arrOutboundPeers).forEach(function(client){
							if (client.device_address === objDeviceMessage.to && (!client.max_message_length || message_string.length <= client.max_message_length) && !client.blockChat) {
								sendJustsaying(client, 'hub/message', {
									message_hash: message_hash,
									message: objDeviceMessage
								});
							}
						});
						sendResponse(ws, tag, "accepted");
						var sender_device_address = objectHash.getDeviceAddress(objDeviceMessage.pubkey);
						db.query(
							"SELECT push_enabled FROM correspondent_settings WHERE device_address=? AND correspondent_address=?",
							[objDeviceMessage.to, sender_device_address],
							function(rows){
								if (rows.length === 0 || rows[0].push_enabled === 1)
									eventBus.emit('peer_sent_new_message', ws, objDeviceMessage);
							}
						);
					}
				);
			});
			break;
			
		// I'm a hub, the peer wants to get a correspondent's temporary pubkey
		case 'hub/get_temp_pubkey':
			var permanent_pubkey = params;
			if (!ValidationUtils.isStringOfLength(permanent_pubkey, constants.PUBKEY_LENGTH))
				return sendErrorResponse(ws, tag, "wrong permanent_pubkey length");
			var device_address = objectHash.getDeviceAddress(permanent_pubkey);
			if (device_address === my_device_address) // to me
				return sendResponse(ws, tag, objMyTempPubkeyPackage); // this package signs my permanent key
			if (!conf.bServeAsHub)
				return sendErrorResponse(ws, tag, "I'm not a hub");
			db.query("SELECT temp_pubkey_package FROM devices WHERE device_address=?", [device_address], function(rows){
				if (rows.length === 0)
					return sendErrorResponse(ws, tag, "device with this pubkey is not registered here");
				if (!rows[0].temp_pubkey_package)
					return sendErrorResponse(ws, tag, "temp pub key not set yet");
				var objTempPubkey = JSON.parse(rows[0].temp_pubkey_package);
				sendResponse(ws, tag, objTempPubkey);
			});
			break;
			
		// I'm a hub, the peer wants to update its temporary pubkey
		case 'hub/temp_pubkey':
			if (!conf.bServeAsHub)
				return sendErrorResponse(ws, tag, "I'm not a hub");
			if (!ws.device_address)
				return sendErrorResponse(ws, tag, "please log in first");
			var objTempPubkey = params;
			if (!objTempPubkey || !objTempPubkey.temp_pubkey || !objTempPubkey.pubkey || !objTempPubkey.signature)
				return sendErrorResponse(ws, tag, "no temp_pubkey params");
			if (!ValidationUtils.isStringOfLength(objTempPubkey.temp_pubkey, constants.PUBKEY_LENGTH))
				return sendErrorResponse(ws, tag, "wrong temp_pubkey length");
			if (objectHash.getDeviceAddress(objTempPubkey.pubkey) !== ws.device_address)
				return sendErrorResponse(ws, tag, "signed by another pubkey");
			if (!ecdsaSig.verify(objectHash.getDeviceMessageHashToSign(objTempPubkey), objTempPubkey.signature, objTempPubkey.pubkey))
				return sendErrorResponse(ws, tag, "wrong signature");
			var fnUpdate = function(onDone){
				db.query("UPDATE devices SET temp_pubkey_package=? WHERE device_address=?", [JSON.stringify(objTempPubkey), ws.device_address], function(){
					if (onDone)
						onDone();
				});
			};
			fnUpdate(function(){
				sendResponse(ws, tag, "updated");
			});
			if (!ws.bLoginComplete)
				ws.onLoginComplete = fnUpdate;
			break;
			
		case 'light/get_history':
			mutex.lock(['get_history_request'], function(unlock){
				if (!ws || ws.readyState !== ws.OPEN) // may be already gone when we receive the lock
					return process.nextTick(unlock);
				light.prepareHistory(params, {
					ifError: function(err){
						sendErrorResponse(ws, tag, err);
						unlock();
					},
					ifOk: function(objResponse){
						sendResponse(ws, tag, objResponse);
						bWatchingForLight = true;
						if (params.addresses)
							db.query(
								"INSERT "+db.getIgnore()+" INTO watched_light_addresses (peer, address) VALUES "+
								params.addresses.map(function(address){ return "("+db.escape(ws.peer)+", "+db.escape(address)+")"; }).join(", ")
							);
						if (params.requested_joints) {
							storage.sliceAndExecuteQuery("SELECT unit FROM units WHERE main_chain_index >= ? AND unit IN(?)",
								[storage.getMinRetrievableMci(), params.requested_joints], params.requested_joints, function(rows) {
								if(rows.length) {
									db.query(
										"INSERT " + db.getIgnore() + " INTO watched_light_units (peer, unit) VALUES " +
										rows.map(function(row) {
											return "(" + db.escape(ws.peer) + ", " + db.escape(row.unit) + ")";
										}).join(", ")
									);
								}
							});
						}
						//db.query("INSERT "+db.getIgnore()+" INTO light_peer_witnesses (peer, witness_address) VALUES "+
						//    params.witnesses.map(function(address){ return "("+db.escape(ws.peer)+", "+db.escape(address)+")"; }).join(", "));
						unlock();
					}
				});
			});
			break;
			
		case 'light/get_link_proofs':
			mutex.lock(['get_link_proofs_request'], function(unlock){
				if (!ws || ws.readyState !== ws.OPEN) // may be already gone when we receive the lock
					return process.nextTick(unlock);
				light.prepareLinkProofs(params, {
					ifError: function(err){
						sendErrorResponse(ws, tag, err);
						unlock();
					},
					ifOk: function(objResponse){
						sendResponse(ws, tag, objResponse);
						unlock();
					}
				});
			});
			break;
			
		case 'light/get_parents_and_last_ball_and_witness_list_unit':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in get_parents_and_last_ball_and_witness_list_unit");
			var callbacks = {
				ifError: function(err){
					sendErrorResponse(ws, tag, err);
				},
				ifOk: function(objResponse){
					sendResponse(ws, tag, objResponse);
				}
			}
			if (params.witnesses)
				light.prepareParentsAndLastBallAndWitnessListUnit(params.witnesses, callbacks);
			else
				myWitnesses.readMyWitnesses(function(arrWitnesses){
					light.prepareParentsAndLastBallAndWitnessListUnit(arrWitnesses, callbacks);
				});
			break;

	   case 'light/get_attestation':
			// find an attestation posted by the given attestor and attesting field=value
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/get_attestation");
			if (!params.attestor_address || !params.field || !params.value)
				return sendErrorResponse(ws, tag, "missing params in light/get_attestation");
			var order = (conf.storage === 'sqlite') ? 'rowid' : 'creation_date';
			var join = (conf.storage === 'sqlite') ? '' : 'JOIN units USING(unit)';
			db.query(
				"SELECT unit FROM attested_fields "+join+" WHERE attestor_address=? AND field=? AND value=? ORDER BY "+order+" DESC LIMIT 1", 
				[params.attestor_address, params.field, params.value],
				function(rows){
					var attestation_unit = (rows.length > 0) ? rows[0].unit : "";
					sendResponse(ws, tag, attestation_unit);
				}
			);
			break;

	   case 'light/get_attestations':
			// get list of all attestations of an address
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/get_attestations");
			if (!ValidationUtils.isValidAddress(params.address))
				return sendErrorResponse(ws, tag, "missing address in light/get_attestations");
			var order = (conf.storage === 'sqlite') ? 'attestations.rowid' : 'creation_date';
			var join = (conf.storage === 'sqlite') ? '' : 'JOIN units USING(unit)';
			db.query(
				"SELECT unit, attestor_address, payload \n\
				FROM attestations CROSS JOIN messages USING(unit, message_index) "+join+" \n\
				WHERE address=? ORDER BY "+order, 
				[params.address],
				function(rows){
					var arrAttestations = rows.map(function(row){
						var payload = JSON.parse(row.payload);
						if (payload.address !== params.address)
							throw Error("not matching addresses, expected "+params.address+", got "+payload.address);
						return {unit: row.unit, attestor_address: row.attestor_address, profile: payload.profile};
					});
					sendResponse(ws, tag, arrAttestations);
				}
			);
			break;

		case 'light/pick_divisible_coins_for_amount':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/pick_divisible_coins_for_amount");
			if (!params.addresses || !params.last_ball_mci || !params.amount)
				return sendErrorResponse(ws, tag, "missing params in light/pick_divisible_coins_for_amount");
			if (params.asset && !ValidationUtils.isValidBase64(params.asset, constants.HASH_LENGTH))
				return sendErrorResponse(ws, tag, "asset is not valid");
			if (!ValidationUtils.isNonemptyArray(params.addresses))
				return sendErrorResponse(ws, tag, "addresses must be non-empty array");
			if (!params.addresses.every(ValidationUtils.isValidAddress))
				return sendErrorResponse(ws, tag, "some addresses are not valid");
			if (!ValidationUtils.isPositiveInteger(params.last_ball_mci))
				return sendErrorResponse(ws, tag, "last_ball_mci is not valid");
			if (!ValidationUtils.isPositiveInteger(params.amount))
				return sendErrorResponse(ws, tag, "amount is not valid");
			if (params.amount > constants.MAX_CAP)
				return sendErrorResponse(ws, tag, "amount is too large");
			if (params.spend_unconfirmed && (params.spend_unconfirmed !== "own" && params.spend_unconfirmed !== "none" && params.spend_unconfirmed !== "all"))
				return sendErrorResponse(ws, tag, "spend_unconfirmed is not valid");
			var getAssetInfoOrNull = function(asset, cb){
				if (!asset)
					return cb(null, null);
				storage.readAssetInfo(db, asset, function(objAsset){
					if (!objAsset)
						return cb("asset " + asset + " not found", null);
					return cb(null, objAsset);
				});
			};
			getAssetInfoOrNull(params.asset, function(err, objAsset){
				if (err)
					return sendErrorResponse(ws, tag, err);
				var bMultiAuthored = (params.addresses.length > 1);
				inputs.pickDivisibleCoinsForAmount(db, objAsset, params.addresses, params.last_ball_mci, params.amount, bMultiAuthored, params.spend_unconfirmed || 'own', function(arrInputsWithProofs, total_amount) {
					var objResponse = {inputs_with_proofs: arrInputsWithProofs || [], total_amount: total_amount || 0};
					sendResponse(ws, tag, objResponse);
				});
			});
			break;

		case 'light/get_definition_chash':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/get_definition_chash");
			if (!ValidationUtils.isValidAddress(params.address))
				return sendErrorResponse(ws, tag, "address not valid");
			if (params.max_mci && !ValidationUtils.isPositiveInteger(params.max_mci))
				return sendErrorResponse(ws, tag, "max_mci not a positive integer");
			storage.readDefinitionChashByAddress(db, params.address, params.max_mci, function(definition_chash){
				sendResponse(ws, tag, definition_chash);
			});
			break;
		
		case 'light/get_definition':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/get_definition");
			if (!ValidationUtils.isValidAddress(params))
				return sendErrorResponse(ws, tag, "address not valid");
			db.query("SELECT definition FROM definitions WHERE definition_chash=? UNION SELECT definition FROM aa_addresses WHERE address=? LIMIT 1", [params, params], function(rows){
				var arrDefinition = rows[0]
					? JSON.parse(rows[0].definition)
					: storage.getUnconfirmedAADefinition(params);
				sendResponse(ws, tag, arrDefinition);
			});
			break;

		case 'light/get_definition_for_address':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/get_definition_for_address");
			if (!ValidationUtils.isValidAddress(params.address))
				return sendErrorResponse(ws, tag, "address not valid");

			db.query("SELECT definition_chash,is_stable FROM address_definition_changes CROSS JOIN units USING(unit) WHERE address=? AND sequence='good'\n\
			ORDER BY main_chain_index DESC LIMIT 1",[params.address],function(address_definition_changes){
				if (address_definition_changes[0] && address_definition_changes[0].is_stable === 0){
					return sendResponse(ws, tag, {
						definition_chash: address_definition_changes[0].definition_chash,
						is_stable: false
					});
				}
				var definition_chash = address_definition_changes[0] ? address_definition_changes[0].definition_chash : params.address;
				db.query("SELECT definition,is_stable FROM definitions CROSS JOIN unit_authors USING(definition_chash) CROSS JOIN units USING(unit) \n\
					WHERE definition_chash=? AND sequence='good'",[definition_chash], function(definitions){
						if (definitions[0]){
							return sendResponse(ws, tag, {
								definition_chash: definition_chash,
								definition: JSON.parse(definitions[0].definition),
								is_stable: definitions[0].is_stable === 1
							});
						} else {
							return sendResponse(ws, tag, {
								definition_chash: definition_chash,
								is_stable: true
							});
						}
					})
			});
			break;

		case 'light/get_balances':
			var addresses = params;
			if (!addresses)
				return sendErrorResponse(ws, tag, "no params in light/get_balances");
			if (!ValidationUtils.isNonemptyArray(addresses))
				return sendErrorResponse(ws, tag, "addresses must be non-empty array");
			if (!addresses.every(ValidationUtils.isValidAddress))
				return sendErrorResponse(ws, tag, "some addresses are not valid");
			if (addresses.length > 100)
				return sendErrorResponse(ws, tag, "too many addresses");
			db.query(
				"SELECT address, asset, is_stable, SUM(amount) AS balance, COUNT(*) AS outputs_count \n\
				FROM outputs JOIN units USING(unit) \n\
				WHERE is_spent=0 AND address IN(?) AND sequence='good' \n\
				GROUP BY address, asset, is_stable", [addresses], function(rows) {
					var balances = {};
					rows.forEach(function(row) {
						if (!balances[row.address])
							balances[row.address] = { base: { stable: 0, pending: 0, stable_outputs_count: 0, pending_outputs_count: 0}};
						if (row.asset && !balances[row.address][row.asset])
							balances[row.address][row.asset] = { stable: 0, pending: 0, stable_outputs_count: 0, pending_outputs_count: 0};
						balances[row.address][row.asset || 'base'][row.is_stable ? 'stable' : 'pending'] = row.balance;
						balances[row.address][row.asset || 'base'][row.is_stable ? 'stable_outputs_count' : 'pending_outputs_count'] = row.outputs_count;
					});
					for (var address in balances)
						for (var asset in balances[address])
							balances[address][asset].total = (balances[address][asset].stable || 0) + (balances[address][asset].pending || 0);
					sendResponse(ws, tag, balances);
				}
			);
			break;

		case 'light/get_profile_units':
			var addresses = params;
			if (!addresses)
				return sendErrorResponse(ws, tag, "no params in light/get_profiles_units");
			if (!ValidationUtils.isNonemptyArray(addresses))
				return sendErrorResponse(ws, tag, "addresses must be non-empty array");
			if (!addresses.every(ValidationUtils.isValidAddress))
				return sendErrorResponse(ws, tag, "some addresses are not valid");
			if (addresses.length > 100)
				return sendErrorResponse(ws, tag, "too many addresses");
			db.query(
				"SELECT unit FROM messages JOIN unit_authors USING(unit) \n\
				JOIN units USING(unit) WHERE app='profile' AND address IN(?) \n\
				ORDER BY main_chain_index ASC", [addresses], function(rows) {
					var units = rows.map(function(row) { return row.unit; });
					sendResponse(ws, tag, units);
				}
			);
			break;

		case 'light/get_data_feed':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/get_data_feed");
			dataFeeds.readDataFeedValueByParams(params, 1e15, 'all_unstable', function (err, value) {
				if (err)
					return sendErrorResponse(ws, tag, err);
				sendResponse(ws, tag, value);
			});
			break;

		case 'light/dry_run_aa':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/dry_run_aa");
			if (!ValidationUtils.isValidAddress(params.address))
				return sendErrorResponse(ws, tag, "address not valid");
		
			storage.readAADefinition(db, params.address, function (arrDefinition) {
				if (!arrDefinition)
					return sendErrorResponse(ws, tag, "not an AA");
				aa_composer.validateAATriggerObject(params.trigger, function(error){
					if (error)
						return sendErrorResponse(ws, tag, error);
					aa_composer.dryRunPrimaryAATrigger(params.trigger, params.address, arrDefinition, function (arrResponses) {
						if (constants.COUNT_WITNESSES === 1) { // the temp unit might have rebuilt the MC
							db.executeInTransaction(function (conn, onDone) {
								storage.resetMemory(conn, onDone);
							});
						}
						sendResponse(ws, tag, arrResponses);
					});
				})
			});
			break;

		case 'light/get_aa_state_vars':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/get_aa_state_vars");
			if (!ValidationUtils.isValidAddress(params.address))
				return sendErrorResponse(ws, tag, "address not valid");
			if ('var_prefix_from' in params && typeof params.var_prefix_from !== 'string')
				return sendErrorResponse(ws, tag, "var_prefix_from must be string");
			if ('var_prefix_to' in params && typeof params.var_prefix_to !== 'string')
				return sendErrorResponse(ws, tag, "var_prefix_to must be string");
			if ('var_prefix' in params && typeof params.var_prefix !== 'string')
				return sendErrorResponse(ws, tag, "var_prefix must be string");
			if ('var_prefix' in params && ('var_prefix_from' in params || 'var_prefix_to' in params))
				return sendErrorResponse(ws, tag, "var_prefix cannot be used with var_prefix_from or var_prefix_to");
			if ('var_prefix' in params){
				params.var_prefix_from = params.var_prefix;
				params.var_prefix_to = params.var_prefix;
			}
			if ('limit' in params && !ValidationUtils.isPositiveInteger(params.limit))
				return sendErrorResponse(ws, tag, "limit must be a positive integer");
			if ('limit' in params && params.limit > MAX_STATE_VARS)
				return sendErrorResponse(ws, tag, "limit cannot be greater than " + MAX_STATE_VARS);
			storage.readAADefinition(db, params.address, function (arrDefinition) {
				if (!arrDefinition) {
					arrDefinition = storage.getUnconfirmedAADefinition(params.address);
					if (!arrDefinition)
						return sendErrorResponse(ws, tag, "not an AA");
				}
				storage.readAAStateVars(params.address, params.var_prefix_from || '', params.var_prefix_to || '', params.limit || MAX_STATE_VARS, function (objStateVars) {
					sendResponse(ws, tag, objStateVars);
				});
			});
			break;
			
		case 'light/get_aa_balances':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/get_aa_balances");
			if (!ValidationUtils.isValidAddress(params.address))
				return sendErrorResponse(ws, tag, "address not valid");
			storage.readAABalances(db, params.address, function(assocBalances) {
				sendResponse(ws, tag, { balances: assocBalances });
			});
			break;
			
		case 'light/execute_getter':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/execute_getter");
			if (!ValidationUtils.isValidAddress(params.address))
				return sendErrorResponse(ws, tag, "address not valid");
			if (!ValidationUtils.isNonemptyString(params.getter))
				return sendErrorResponse(ws, tag, "no getter");
			if ('args' in params && !Array.isArray(params.args))
				return sendErrorResponse(ws, tag, "args must be array");
			formulaEvaluation.executeGetter(db, params.address, params.getter, params.args || [], function (err, res) {
				if (err)
					return sendErrorResponse(ws, tag, err);
				sendResponse(ws, tag, { result: res });
			});
			break;
			
		case 'light/get_aas_by_base_aas':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/get_aas_by_base_aas");
			var base_aas = params.base_aas || [params.base_aa];
			if (!ValidationUtils.isNonemptyArray(base_aas))
				return sendErrorResponse(ws, tag, "no base_aas in light/get_aas_by_base_aas");
			if (base_aas.length > 20)
				return sendErrorResponse(ws, tag, "too many base_aas in light/get_aas_by_base_aas, max 20");
			if (!base_aas.every(ValidationUtils.isValidAddress))
				return sendErrorResponse(ws, tag, "base_aa address not valid");
			var aa_params = params.params || {};
			for (var name in aa_params) {
				var value = aa_params[name];
				if (typeof value === 'object') {
					if (!ValidationUtils.isArrayOfLength(value, 2))
						return sendErrorResponse(ws, tag, "invalid value of param " + name + ": " + value);
					var comp = value[0];
					value = value[1];
					if (!['=', '!=', '>', '>=', '<', '<='].includes(comp))
						return sendErrorResponse(ws, tag, "invalid comparison of param " + name + ": " + comp);
					if (!['string', 'number', 'boolean'].includes(typeof value))
						return sendErrorResponse(ws, tag, "invalid type of param " + name + ": " + (typeof value));
				}
			}
			db.query("SELECT address, definition, unit, creation_date FROM aa_addresses WHERE base_aa IN(?)", [base_aas], function (rows) {
				var arrAAs = [];
				rows.forEach(function (row) {
					var arrDefinition = JSON.parse(row.definition);
					var this_aa_params = arrDefinition[1].params;
					for (var name in aa_params) {
						if (!satisfiesSearchCriteria(this_aa_params[name], aa_params[name]))
							return;
					}
					arrAAs.push({ address: row.address, definition: arrDefinition, unit: row.unit, creation_date: row.creation_date });
				});
				sendResponse(ws, tag, arrAAs);
			});
			break;
			
		case 'light/get_aa_responses':
			if (!params)
				return sendErrorResponse(ws, tag, "no params in light/get_aa_responses");
			var aas = params.aas || [params.aa];
			if (!ValidationUtils.isNonemptyArray(aas))
				return sendErrorResponse(ws, tag, "no aas in light/get_aa_responses");
			if (aas.length > 20)
				return sendErrorResponse(ws, tag, "too many aas in light/get_aa_responses, max 20");
			if (!aas.every(ValidationUtils.isValidAddress))
				return sendErrorResponse(ws, tag, "aa address not valid");
			db.query(
				"SELECT mci, trigger_address, aa_address, trigger_unit, bounced, response_unit, response, timestamp \n\
				FROM aa_responses CROSS JOIN units ON trigger_unit=unit \n\
				WHERE aa_address IN(?) ORDER BY aa_response_id DESC LIMIT 30",
				[aas],
				function (rows) {
					async.eachSeries(
						rows,
						function (row, cb) {
							row.response = JSON.parse(row.response);
							if (!row.response_unit)
								return cb();
							storage.readJoint(db, row.response_unit, {
								ifNotFound: function () {
									throw Error("response unit " + row.response_unit + " not found");
								},
								ifFound: function (objJoint) {
									row.objResponseUnit = objJoint.unit;
									cb();
								}
							});
						},
						function () {
							sendResponse(ws, tag, rows);
						}
					);
				}
			);
			break;

		// I'm a hub, the peer wants to enable push notifications
		case 'hub/enable_notification':
			if(ws.device_address)
				eventBus.emit("enableNotification", ws.device_address, params);
			sendResponse(ws, tag, 'ok');
			break;

		// I'm a hub, the peer wants to disable push notifications
		case 'hub/disable_notification':
			if(ws.device_address)
				eventBus.emit("disableNotification", ws.device_address, params);
			sendResponse(ws, tag, 'ok');
			break;
			
		case 'hub/get_bots':
			db.query("SELECT id, name, pairing_code, description FROM bots ORDER BY rank DESC, id", [], function(rows){
				sendResponse(ws, tag, rows);
			});
			break;
			
		case 'hub/get_asset_metadata':
			var asset = params;
			if (!ValidationUtils.isStringOfLength(asset, constants.HASH_LENGTH))
				return sendErrorResponse(ws, tag, "bad asset: "+asset);
			db.query("SELECT metadata_unit, registry_address, suffix FROM asset_metadata WHERE asset=?", [asset], function(rows){
				if (rows.length === 0)
					return sendErrorResponse(ws, tag, "no metadata");
				sendResponse(ws, tag, rows[0]);
			});
			break;
			
		case 'custom':
			eventBus.emit('custom_request', ws, params,tag);
		break;
	}
}

function satisfiesSearchCriteria(this_param_value, searched_param_value) {
	var comp = '=';
	if (typeof searched_param_value === 'object') {
		comp = searched_param_value[0];
		searched_param_value = searched_param_value[1];
	}
	if (typeof this_param_value !== typeof searched_param_value)
		return (comp === '!=');
	switch (comp) {
		case '=':  return this_param_value === searched_param_value;
		case '!=': return this_param_value !== searched_param_value;
		case '>':  return this_param_value > searched_param_value;
		case '>=': return this_param_value >= searched_param_value;
		case '<':  return this_param_value < searched_param_value;
		case '<=': return this_param_value <= searched_param_value;
		default: throw Error("unknown comp: " + comp);
	}
}

function onWebsocketMessage(message) {
		
	var ws = this;
	
	if (ws.readyState !== ws.OPEN)
		return console.log("received a message on socket with ready state "+ws.readyState);
	
	console.log('RECEIVED '+(message.length > 1000 ? message.substr(0,1000)+'... ('+message.length+' chars)' : message)+' from '+ws.peer);
	ws.last_ts = Date.now();
	
	try{
		var arrMessage = JSON.parse(message);
	}
	catch(e){
		return console.log('failed to json.parse message '+message);
	}
	var message_type = arrMessage[0];
	var content = arrMessage[1];
	if (!content || typeof content !== 'object')
		return console.log("content is not object: "+content);
	
	switch (message_type){
		case 'justsaying':
			return handleJustsaying(ws, content.subject, content.body);
			
		case 'request':
			return handleRequest(ws, content.tag, content.command, content.params);
			
		case 'response':
			return handleResponse(ws, content.tag, content.response);
			
		default: 
			console.log("unknown type: "+message_type);
		//	throw Error("unknown type: "+message_type);
	}
}

// @see https://www.npmjs.com/package/ws#multiple-servers-sharing-a-single-https-server
function handleUpgradeConnection(incomingRequest, socket, head) {
	if (!(wss instanceof WebSocketServer)) throw new Error('reuse port and upgrade connection in light node is not supported')

	if (incomingRequest instanceof require('net').Server && !socket && !head) {
		incomingRequest.on('upgrade', function(_request, _socket, _head) {
			upgrade(_request, _socket, _head)
		})
	} else upgrade(incomingRequest, socket, head)

	function upgrade($request, $socket, $head) {
		wss.handleUpgrade($request, $socket, $head, function(ws) {
			wss.emit('connection', ws, request);
		})
	}
}

function startAcceptingConnections(){
	db.query("DELETE FROM watched_light_addresses");
	db.query("DELETE FROM watched_light_aas");
	db.query("DELETE FROM watched_light_units");
	//db.query("DELETE FROM light_peer_witnesses");
	setInterval(unblockPeers, 10*60*1000);
	initBlockedPeers();
	// listen for new connections
	wss = new WebSocketServer(conf.portReuse ? { noServer: true } : { port: conf.port });
	wss.on('connection', function(ws) {
		var ip = ws.upgradeReq.connection.remoteAddress;
		if (!ip){
			console.log("no ip in accepted connection");
			ws.terminate();
			return;
		}
		if (ws.upgradeReq.headers['x-real-ip'] && (ip === '127.0.0.1' || ip.match(/^192\.168\./))) // we are behind a proxy
			ip = ws.upgradeReq.headers['x-real-ip'];
		ws.peer = ip + ":" + ws.upgradeReq.connection.remotePort;
		ws.host = ip;
		ws.assocPendingRequests = {};
		ws.assocCommandsInPreparingResponse = {};
		ws.bInbound = true;
		ws.last_ts = Date.now();
		console.log('got connection from '+ws.peer+", host "+ws.host);
		if (wss.clients.length >= conf.MAX_INBOUND_CONNECTIONS){
			console.log("inbound connections maxed out, rejecting new client "+ip);
			ws.close(1000, "inbound connections maxed out"); // 1001 doesn't work in cordova
			return;
		}
		var bStatsCheckUnderWay = true;
		determineIfPeerIsBlocked(ws.host, function(bBlocked){
			bStatsCheckUnderWay = false;
			if (bBlocked){
				console.log("rejecting new client "+ws.host+" because of bad stats");
				return ws.terminate();
			}

			// welcome the new peer with the list of free joints
			//if (!bCatchingUp)
			//    sendFreeJoints(ws);

			sendVersion(ws);

			// I'm a hub, send challenge
			if (conf.bServeAsHub){
				ws.challenge = crypto.randomBytes(30).toString("base64");
				sendJustsaying(ws, 'hub/challenge', ws.challenge);
			}
			if (!conf.bLight)
				subscribe(ws);
			eventBus.emit('connected', ws);
		});
		ws.on('message', function(message){ // might come earlier than stats check completes
			function tryHandleMessage(){
				if (bStatsCheckUnderWay)
					setTimeout(tryHandleMessage, 100);
				else
					onWebsocketMessage.call(ws, message);
			}
			tryHandleMessage();
		});
		ws.on('close', function(){
			if (bWatchingForLight){
				db.query("DELETE FROM watched_light_addresses WHERE peer=?", [ws.peer]);
				db.query("DELETE FROM watched_light_aas WHERE peer=?", [ws.peer]);
				db.query("DELETE FROM watched_light_units WHERE peer=?", [ws.peer]);
				//db.query("DELETE FROM light_peer_witnesses WHERE peer=?", [ws.peer]);
			}
			console.log("client "+ws.peer+" disconnected");
			cancelRequestsOnClosedConnection(ws);
		});
		ws.on('error', function(e){
			console.log("error on client "+ws.peer+": "+e);
			ws.close(1000, "received error");
		});
		addPeerHost(ws.host);
	});
	console.log('WSS running at port ' + conf.port);
}


function startPeerExchange() {
	if (conf.bWantNewPeers){
		// outbound connections
		addOutboundPeers();
		// retry lost and failed connections every 1 minute
		setInterval(addOutboundPeers, 60*1000);
		setTimeout(checkIfHaveEnoughOutboundPeersAndAdd, 30*1000);
		setInterval(purgeDeadPeers, 30*60*1000);
	}
}

function startRelay(){
	if (process.browser || !conf.port) // no listener on mobile
		wss = {clients: []};
	else
		startAcceptingConnections();
	
	storage.initCaches();
	joint_storage.initUnhandledAndKnownBad();
	checkCatchupLeftovers();

	startPeerExchange();

	// purge peer_events every 6 hours, removing those older than 0.5 days ago.
	setInterval(purgePeerEvents, 6*60*60*1000);
	setInterval(function(){flushEvents(true)}, 1000 * 60);
	
	// request needed joints that were not received during the previous session
	rerequestLostJoints();
	setInterval(rerequestLostJoints, 8*1000);
	
	setInterval(purgeJunkUnhandledJoints, 30*60*1000);
	setInterval(joint_storage.purgeUncoveredNonserialJointsUnderLock, 60*1000);
	setInterval(handleSavedPrivatePayments, 5*1000);
	joint_storage.readDependentJointsThatAreReady(null, handleSavedJoint);

	eventBus.on('new_aa_unit', onNewAA);
	aa_composer.handleAATriggers(); // in case anything's left from the previous run
}

function startLightClient(){
	wss = {clients: []};
	rerequestLostJointsOfPrivatePayments();
	setInterval(rerequestLostJointsOfPrivatePayments, 5*1000);
	setInterval(handleSavedPrivatePayments, 5*1000);
	setInterval(requestUnfinishedPastUnitsOfSavedPrivateElements, 12*1000);
}

function start(){
	if (bStarted)
		return console.log("network already started");
	bStarted = true;
	console.log("starting network");
	conf.bLight ? startLightClient() : startRelay();
	setInterval(printConnectionStatus, 6*1000);
	// if we have exactly same intervals on two clints, they might send heartbeats to each other at the same time
	setInterval(heartbeat, 3*1000 + getRandomInt(0, 1000));
	eventBus.emit('network_started');
}

function closeAllWsConnections() {
	arrOutboundPeers.forEach(function(ws) {
		ws.close(1000,'Re-connect');
	});
}

function isStarted(){
	return bStarted;
}

function isConnected(){
	return (arrOutboundPeers.length + wss.clients.length);
}

function isCatchingUp(){
	return bCatchingUp;
}

function waitUntilCatchedUp(cb) {
	if (conf.bLight)
		throw Error("call waitUntilCatchedUp in full wallets only");
	if (!cb)
		return new Promise(resolve => waitUntilCatchedUp(resolve));
	waitTillSyncIdle(() => {
		if (!bCatchingUp && !bWaitingForCatchupChain)
			return cb();
		console.log('bCatchingUp =', bCatchingUp, 'bWaitingForCatchupChain =', bWaitingForCatchupChain, ' will wait for catchup to finish');
		eventBus.once('catching_up_done', () => waitUntilCatchedUp(cb));
	});
}

if (!conf.explicitStart) {
	start();
}

exports.start = start;
exports.startAcceptingConnections = startAcceptingConnections;
exports.startPeerExchange = startPeerExchange;

exports.postJointToLightVendor = postJointToLightVendor;
exports.broadcastJoint = broadcastJoint;
exports.sendPrivatePayment = sendPrivatePayment;

exports.sendJustsaying = sendJustsaying;
exports.sendAllInboundJustsaying = sendAllInboundJustsaying;
exports.sendError = sendError;
exports.sendRequest = sendRequest;
exports.sendResponse = sendResponse;
exports.findOutboundPeerOrConnect = findOutboundPeerOrConnect;
exports.handleOnlineJoint = handleOnlineJoint;
exports.handleUpgradeConnection = handleUpgradeConnection

exports.handleOnlinePrivatePayment = handleOnlinePrivatePayment;
exports.requestUnfinishedPastUnitsOfPrivateChains = requestUnfinishedPastUnitsOfPrivateChains;
exports.requestProofsOfJointsIfNewOrUnstable = requestProofsOfJointsIfNewOrUnstable;

exports.requestFromLightVendor = requestFromLightVendor;

exports.addPeer = addPeer;

exports.initWitnessesIfNecessary = initWitnessesIfNecessary;

exports.setMyDeviceProps = setMyDeviceProps;

exports.setWatchedAddresses = setWatchedAddresses;
exports.addWatchedAddress = addWatchedAddress;
exports.addLightWatchedAddress = addLightWatchedAddress;
exports.addLightWatchedAa = addLightWatchedAa;

exports.getConnectionStatus = getConnectionStatus;
exports.closeAllWsConnections = closeAllWsConnections;
exports.isStarted = isStarted;
exports.isConnected = isConnected;
exports.isCatchingUp = isCatchingUp;
exports.waitUntilCatchedUp = waitUntilCatchedUp;
exports.requestHistoryFor = requestHistoryFor;
exports.exchangeRates = exchangeRates;
exports.knownWitnesses = knownWitnesses;
exports.getInboundDeviceWebSocket = getInboundDeviceWebSocket;
exports.deletePendingRequest = deletePendingRequest;

exports.MAX_STATE_VARS = MAX_STATE_VARS;
