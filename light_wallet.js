/*jslint node: true */
const db = require('./db.js');
const conf = require('./conf.js');
const myWitnesses = require('./my_witnesses.js');
const network = require('./network.js');
const storage = require('./storage.js');
const walletGeneral = require('./wallet_general.js');
const light = require('./light.js');
const eventBus = require('./event_bus.js');
const breadcrumbs = require('./breadcrumbs.js');

const RECONNECT_TO_LIGHT_VENDOR_PERIOD = 60*1000;


function setLightVendorHost(light_vendor_host){
	network.light_vendor_url = conf.WS_PROTOCOL+light_vendor_host; // for now, light vendor is also a hub
	if (conf.bLight){
		refreshLightClientHistory();
		setInterval(reconnectToLightVendor, RECONNECT_TO_LIGHT_VENDOR_PERIOD);
		eventBus.on('connected', reconnectToLightVendor);
	}
}

function reconnectToLightVendor(){
	network.findOutboundPeerOrConnect(network.light_vendor_url, (err, {bLightVendor, bRefreshingHistory}) => {
		if (err)
			return console.log(`reconnectToLightVendor: ${err}`);
		if (bLightVendor)
			return console.log("already connected to light vendor");
		if (bRefreshingHistory)
			return console.log("already refreshing history");
		refreshLightClientHistory();
	});
}

function readListOfUnstableUnits(handleUnits){
	db.query("SELECT unit FROM units WHERE is_stable=0", rows => {
		const arrUnits = rows.map(({unit}) => unit);
		handleUnits(arrUnits);
	});
}


function prepareRequestForHistory(handleResult){
	myWitnesses.readMyWitnesses(arrWitnesses => {
		if (arrWitnesses.length === 0) // first start, witnesses not set yet
			return handleResult(null);
		const objHistoryRequest = {witnesses: arrWitnesses};
		walletGeneral.readMyAddresses(arrAddresses => {
			if (arrAddresses.length > 0)
				objHistoryRequest.addresses = arrAddresses;
			readListOfUnstableUnits(arrUnits => {
				if (arrUnits.length > 0)
					objHistoryRequest.requested_joints = arrUnits;
				if (!objHistoryRequest.addresses && !objHistoryRequest.requested_joints)
					return handleResult(null);
				if (!objHistoryRequest.addresses)
					return handleResult(objHistoryRequest);
				objHistoryRequest.last_stable_mci = 0;
				const strAddressList = arrAddresses.map(db.escape).join(', ');
				db.query(
					`SELECT unit FROM unit_authors JOIN units USING(unit) WHERE is_stable=1 AND address IN(${strAddressList}) \n\
                    UNION \n\
                    SELECT unit FROM outputs JOIN units USING(unit) WHERE is_stable=1 AND address IN(${strAddressList})`,
					rows => {
						if (rows.length)
							objHistoryRequest.known_stable_units = rows.map(({unit}) => unit);
						handleResult(objHistoryRequest);
					}
				);
				/*db.query(
					"SELECT MAX(main_chain_index) AS last_stable_mci FROM units JOIN unit_authors USING(unit) WHERE is_stable=1 AND address IN(?)",
					[arrAddresses],
					function(rows){
						objHistoryRequest.last_stable_mci = rows[0].last_stable_mci || 0;
						handleResult(objHistoryRequest);
					}
				);*/
			});
		});
	}, 'wait');
}

let bFirstRefreshStarted = false;

function refreshLightClientHistory(){
	if (!conf.bLight)
		return;
	if (!network.light_vendor_url)
		return console.log('refreshLightClientHistory called too early: light_vendor_url not set yet');
	eventBus.emit('refresh_light_started');
	if (!bFirstRefreshStarted){
		archiveDoublespendUnits();
		bFirstRefreshStarted = true;
	}
	network.findOutboundPeerOrConnect(network.light_vendor_url, function onLocatedLightVendor(err, ws){
		const finish = msg => {
			if (msg)
				console.log(msg);
			if (ws)
				ws.bRefreshingHistory = false;
			eventBus.emit('refresh_light_done');
		};
		if (err)
			return finish(`refreshLightClientHistory: ${err}`);
		console.log('refreshLightClientHistory connected');
		// handling the response may take some time, don't send new requests
		if (ws.bRefreshingHistory)
			return console.log("previous refresh not finished yet");
		ws.bRefreshingHistory = true;
		prepareRequestForHistory(objRequest => {
			if (!objRequest)
				return finish();
			network.sendRequest(ws, 'light/get_history', objRequest, false, (ws, request, response) => {
				if (response.error){
					if (response.error.indexOf('your history is too large') >= 0)
						throw Error(response.error);
					return finish(response.error);
				}
				ws.bLightVendor = true;
				const interval = setInterval(() => { // refresh UI periodically while we are processing history
					eventBus.emit('maybe_new_transactions');
				}, 500);
				light.processHistory(response, {
					ifError(err) {
						clearInterval(interval);
						network.sendError(ws, err);
						finish();
					},
					ifOk(bRefreshUI) {
						clearInterval(interval);
						finish();
						if (bRefreshUI)
							eventBus.emit('maybe_new_transactions');
					}
				});
			});
		});
	});
}

function archiveDoublespendUnits(){
	db.query(`SELECT unit FROM units WHERE is_stable=0 AND is_free=1 AND creation_date<${db.addTime('-1 DAY')}`, rows => {
		const arrUnits = rows.map(({unit}) => unit);
		breadcrumbs.add(`units still unstable after 1 day: ${arrUnits.join(', ')}`);
		arrUnits.forEach(unit => {
			network.requestFromLightVendor('get_joint', unit, (ws, request, {error, joint_not_found}) => {
				if (error)
					return breadcrumbs.add(`get_joint ${unit}: ${error}`);
				if (joint_not_found === unit){
					breadcrumbs.add(`light vendor doesn't know about unit ${unit} any more, will archive`);
					storage.archiveJointAndDescendantsIfExists(unit);
				}
			});
		});
	});
}

if (conf.bLight){
//	setTimeout(archiveDoublespendUnits, 5*1000);
	setInterval(archiveDoublespendUnits, 24*3600*1000);
}

exports.setLightVendorHost = setLightVendorHost;
exports.refreshLightClientHistory = refreshLightClientHistory;

