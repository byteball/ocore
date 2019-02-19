/*jslint node: true */
"use strict";
require('./enforce_singleton.js');

function mergeExports(anotherModule){
	for (var key in anotherModule)
		exports[key] = anotherModule[key];
}

// start node explicitly by `require('ocore/network').start()`
//exports.explicitStart = true

// port we are listening on.  Set to null to disable accepting connections
// recommended port for livenet: 6611
// recommended port for testnet: 16611
exports.port = null;
//exports.port = 6611;

// enable this will make websocket server doesn't spawn on new port
// this is usefull if you already have SocketServer running and want to reuse the port
//exports.portReuse = true;

// how peers connect to me
//exports.myUrl = 'wss://example.org/bb';

// if we are serving as hub.  Default is false
//exports.bServeAsHub = true;

// if we are a light client.  Default is full client
//exports.bLight = true;

// where to send bug reports to.  Usually, it is wallet vendor's server.
// By default, it is hub url
//exports.bug_sink_url = "wss://example.org/bb";

// this is used by wallet vendor only, to redirect bug reports to developers' email
//exports.bug_sink_email = 'admin@example.org';
//exports.bugs_from_email = 'bugs@example.org';

// Connects through socks v5 proxy without auth, WS_PROTOCOL has to be 'wss'
// exports.socksHost = 'localhost';
// exports.socksPort = 9050;
// For better security you should not use local DNS with socks proxy 
// exports.socksLocalDNS = false;

// WebSocket protocol prefixed to all hosts.  Must be wss:// on livenet, ws:// is allowed on testnet
exports.WS_PROTOCOL = "wss://";

exports.MAX_INBOUND_CONNECTIONS = 100;
exports.MAX_OUTBOUND_CONNECTIONS = 100;
exports.MAX_TOLERATED_INVALID_RATIO = 0.1; // max tolerated ratio of invalid to good joints
exports.MIN_COUNT_GOOD_PEERS = 10; // if we have less than this number of good peers, we'll ask peers for their lists of peers

exports.bWantNewPeers = true;

// true, when removed_paired_device commands received from peers are to be ignored. Default is false.
exports.bIgnoreUnpairRequests = false;

// storage engine: mysql or sqlite
exports.storage = 'sqlite';
if (process.browser){
	exports.storage = 'sqlite';
	exports.bLight = true;
}
exports.database = {};


/*
There are 3 ways to customize conf in modules that use ocore lib:
1. drop a custom conf.js into the project root.  The code below will find it and merge.  Will not work under browserify.
2. drop a custom conf.json into the app's data dir inside the user's home dir.  The code below will find it and merge.  Will not work under browserify.
3. require() this conf and modify it:
var conf = require('ocore/conf.js');
conf.custom_property = 'custom value';
You should do it as early as possible during your app's startup.
The later require()s of this conf will see the modified version.
This way is not recommended as the code becomes loading order dependent.
*/

if (typeof window === 'undefined' || !window.cordova){ // desktop
	var desktopApp = require('./desktop_app.js'+'');
	
	// merge conf from other modules that include us as lib.  The other module must place its custom conf.js into its root directory
	var appRootDir = desktopApp.getAppRootDir();
	var appPackageJson = require(appRootDir + '/package.json');
	exports.program = appPackageJson.name;
	exports.program_version = appPackageJson.version;
	if (appRootDir !== __dirname){
		try{
			mergeExports(require(appRootDir + '/conf.js'));
			console.log('merged app root conf from ' + appRootDir + '/conf.js');
		}
		catch(e){
			console.log("not using app root conf: "+e);
		}
	}
	else
		console.log("I'm already at the root");
	
	// merge conf from user home directory, if any.
	// Note that it is json rather than js to avoid code injection
	var appDataDir = desktopApp.getAppDataDir();
	try{
		mergeExports(require(appDataDir + '/conf.json'));
		console.log('merged user conf from ' + appDataDir + '/conf.json');
	}
	catch(e){
		console.log('not using user conf: '+e);
	}
}

// after merging the custom confs, set defaults if they are still not set
if (exports.storage === 'mysql'){
	exports.database.max_connections = exports.database.max_connections || 30;
	exports.database.host = exports.database.host || 'localhost';
	exports.database.name = exports.database.name || 'byteball';
	exports.database.user = exports.database.user || 'byteball';
}
else if (exports.storage === 'sqlite'){
	exports.database.max_connections = exports.database.max_connections || 1;
	exports.database.filename = exports.database.filename || (exports.bLight ? 'byteball-light.sqlite' : 'byteball.sqlite');
}

