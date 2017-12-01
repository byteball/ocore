/*jslint node: true */
"use strict";
var _ = require('lodash');
var async = require('async');
var sqlite_migrations = require('./sqlite_migrations');
var EventEmitter = require('events').EventEmitter;

var bCordova = (typeof window === 'object' && window.cordova);
var sqlite3;
var path;
var cordovaSqlite;

if (bCordova){
	// will error before deviceready
	//cordovaSqlite = window.cordova.require('cordova-sqlite-plugin.SQLite');
}
else{
	sqlite3 = require('sqlite3');//.verbose();
	path = require('./desktop_app.js'+'').getDatabaseDir() + '/';
	console.log("path="+path);
}

module.exports = function(db_name, MAX_CONNECTIONS, bReadOnly){

	function openDb(cb){
		if (bCordova){
			var db = new cordovaSqlite(db_name);
			db.open(cb);
			return db;
		}
		else
			return new sqlite3.Database(path + db_name, bReadOnly ? sqlite3.OPEN_READONLY : sqlite3.OPEN_READWRITE, cb);
	}

	var eventEmitter = new EventEmitter();
	var bReady = false;
	var arrConnections = [];
	var arrQueue = [];

	function connect(handleConnection){
		console.log("opening new db connection");
		var db = openDb(function(err){
			if (err)
				throw Error(err);
			console.log("opened db");
			connection.query("PRAGMA foreign_keys = 1", function(){
				connection.query("PRAGMA busy_timeout=30000", function(){
					connection.query("PRAGMA journal_mode=WAL", function(){
						connection.query("PRAGMA synchronous=NORMAL", function(){
							connection.query("PRAGMA temp_store=MEMORY", function(){
								sqlite_migrations.migrateDb(connection, function(){
									handleConnection(connection);
								});
							});
						});
					});
				});
			});
		});
		
		var connection = {
			db: db,
			bInUse: true,
			
			release: function(){
				//console.log("released connection");
				this.bInUse = false;
				if (arrQueue.length === 0)
					return;
				var connectionHandler = arrQueue.shift();
				this.bInUse = true;
				connectionHandler(this);
			},
			
			query: function(){
				if (!this.bInUse)
					throw Error("this connection was returned to the pool");
				var last_arg = arguments[arguments.length - 1];
				var bHasCallback = (typeof last_arg === 'function');
				if (!bHasCallback) // no callback
					last_arg = function(){};

				var sql = arguments[0];
				//console.log("======= query: "+sql);
				var bSelect = !!sql.match(/^SELECT/i);
				var count_arguments_without_callback = bHasCallback ? (arguments.length-1) : arguments.length;
				var new_args = [];
				var self = this;

				for (var i=0; i<count_arguments_without_callback; i++) // except the final callback
					new_args.push(arguments[i]);
				if (count_arguments_without_callback === 1) // no params
					new_args.push([]);
				expandArrayPlaceholders(new_args);
				
				// add callback with error handling
				new_args.push(function(err, result){
					//console.log("query done: "+sql);
					if (err){
						console.error("\nfailed query:", new_args);
						throw Error(err+"\n"+sql+"\n"+new_args[1].map(function(param){ if (param === null) return 'null'; if (param === undefined) return 'undefined'; return param;}).join(', '));
					}
					// note that sqlite3 sets nonzero this.changes even when rows were matched but nothing actually changed (new values are same as old)
					// this.changes appears to be correct for INSERTs despite the documentation states the opposite
					if (!bSelect && !bCordova)
						result = {affectedRows: this.changes, insertId: this.lastID};
					if (bSelect && bCordova) // note that on android, result.affectedRows is 1 even when inserted many rows
						result = result.rows || [];
					//console.log("changes="+this.changes+", affected="+result.affectedRows);
					var consumed_time = Date.now() - start_ts;
					if (consumed_time > 25)
						console.log("long query took "+consumed_time+"ms:\n"+new_args.filter(function(a, i){ return (i<new_args.length-1); }).join(", ")+"\nload avg: "+require('os').loadavg().join(', '));
					last_arg(result);
				});
				
				var start_ts = Date.now();
				if (bCordova)
					this.db.query.apply(this.db, new_args);
				else
					bSelect ? this.db.all.apply(this.db, new_args) : this.db.run.apply(this.db, new_args);
			},
			
			addQuery: addQuery,
			escape: escape,
			addTime: addTime,
			getNow: getNow,
			getUnixTimestamp: getUnixTimestamp,
			getFromUnixTime: getFromUnixTime,
			getRandom: getRandom,
			getIgnore: getIgnore,
			forceIndex: forceIndex,
			dropTemporaryTable: dropTemporaryTable
			
		};
		arrConnections.push(connection);
	}

	// accumulate array of functions for async.series()
	// it applies both to individual connection and to pool
	function addQuery(arr) {
		var self = this;
		var query_args = [];
		for (var i=1; i<arguments.length; i++) // except first, which is array
			query_args.push(arguments[i]);
		arr.push(function(callback){ // add callback for async.series() member tasks
			if (typeof query_args[query_args.length-1] !== 'function')
				query_args.push(function(){callback();}); // add callback
			else{
				var f = query_args[query_args.length-1];
				query_args[query_args.length-1] = function(){ // add callback() call to the end of the function
					f.apply(f, arguments);
					callback();
				}
			}
			self.query.apply(self, query_args);
		});
	}
	
	function takeConnectionFromPool(handleConnection){

		if (!bReady){
			console.log("takeConnectionFromPool will wait for ready");
			eventEmitter.once('ready', function(){
				console.log("db is now ready");
				takeConnectionFromPool(handleConnection);
			});
			return;
		}
		
		// first, try to find a free connection
		for (var i=0; i<arrConnections.length; i++)
			if (!arrConnections[i].bInUse){
				//console.log("reusing previously opened connection");
				arrConnections[i].bInUse = true;
				return handleConnection(arrConnections[i]);
			}

		// second, try to open a new connection
		if (arrConnections.length < MAX_CONNECTIONS)
			return connect(handleConnection);

		// third, queue it
		//console.log("queuing");
		arrQueue.push(handleConnection);
	}
	
	function onDbReady(){
		if (bCordova && !cordovaSqlite)
			cordovaSqlite = window.cordova.require('cordova-sqlite-plugin.SQLite');
		bReady = true;
		eventEmitter.emit('ready');
	}
	
	function getCountUsedConnections(){
		var count = 0;
		for (var i=0; i<arrConnections.length; i++)
			if (arrConnections[i].bInUse)
				count++;
		return count;
	}

	// takes a connection from the pool, executes the single query on this connection, and immediately releases the connection
	function query(){
		//console.log(arguments[0]);
		var args = arguments;
		takeConnectionFromPool(function(connection){
			var last_arg = args[args.length - 1];
			var bHasCallback = (typeof last_arg === 'function');
			if (!bHasCallback) // no callback
				last_arg = function(){};

			var count_arguments_without_callback = bHasCallback ? (args.length-1) : args.length;
			var new_args = [];

			for (var i=0; i<count_arguments_without_callback; i++) // except callback
				new_args.push(args[i]);
			// add callback that releases the connection before calling the supplied callback
			new_args.push(function(rows){
				connection.release();
				last_arg(rows);
			});
			connection.query.apply(connection, new_args);
		});
	}
	
	function close(cb){
		if (!cb)
			cb = function(){};
		bReady = false;
		if (arrConnections.length === 0)
			return cb();
		arrConnections[0].db.close(cb);
		arrConnections.shift();
	}

	// interval is string such as -8 SECOND
	function addTime(interval){
		return "datetime('now', '"+interval+"')";
	}

	function getNow(){
		return "datetime('now')";
	}

	function getUnixTimestamp(date){
		return "strftime('%s', "+date+")";
	}

	function getFromUnixTime(ts){
		return "datetime("+ts+", 'unixepoch')";
	}

	function getRandom(){
		return "RANDOM()";
	}

	function forceIndex(index){
		return "INDEXED BY " + index;
	}

	function dropTemporaryTable(table) {
		return "DROP TABLE IF EXISTS " + table;
	}

	// note that IGNORE behaves differently from mysql.  In particular, if you insert and forget to specify a NOT NULL colum without DEFAULT value, 
	// sqlite will ignore while mysql will throw an error
	function getIgnore(){
		return "OR IGNORE";
	}

	function escape(str){
		if (typeof str === 'string')
			return "'"+str.replace(/'/g, "''")+"'";
		else if (Array.isArray(str))
			return str.map(function(member){ return escape(member); }).join(",");
		else
			throw Error("escape: unknown type "+(typeof str));
	}
	
	
	createDatabaseIfNecessary(db_name, onDbReady);

	var pool = {};
	pool.query = query;
	pool.addQuery = addQuery;
	pool.takeConnectionFromPool = takeConnectionFromPool;
	pool.getCountUsedConnections = getCountUsedConnections;
	pool.close = close;
	pool.escape = escape;
	pool.addTime = addTime;
	pool.getNow = getNow;
	pool.getUnixTimestamp = getUnixTimestamp;
	pool.getFromUnixTime = getFromUnixTime;
	pool.getRandom = getRandom;
	pool.getIgnore = getIgnore;
	pool.forceIndex = forceIndex;
	pool.dropTemporaryTable = dropTemporaryTable;
	
	return pool;
};

// expands IN(?) into IN(?,?,?) and flattens parameter array
// the function modifies first two memebers of the args array in place
// will misbehave if there are ? in SQL comments
function expandArrayPlaceholders(args){
	var sql = args[0];
	var params = args[1];
	if (!Array.isArray(params) || params.length === 0)
		return;
	var assocLengthsOfArrayParams = {};
	for (var i=0; i<params.length; i++)
		if (Array.isArray(params[i])){
			if (params[i].length === 0)
				throw Error("empty array in query params");
			assocLengthsOfArrayParams[i] = params[i].length;
		}
	if (Object.keys(assocLengthsOfArrayParams).length === 0)
		return;
	var arrParts = sql.split('?');
	if (arrParts.length - 1 !== params.length)
		throw Error("wrong parameter count");
	var expanded_sql = "";
	for (var i=0; i<arrParts.length; i++){
		expanded_sql += arrParts[i];
		if (i === arrParts.length-1) // last part
			break;
		var len = assocLengthsOfArrayParams[i];
		if (len) // array
			expanded_sql += _.fill(Array(len), "?").join(",");
		else
			expanded_sql += "?";
	}
	var flattened_params = _.flatten(params);
	args[0] = expanded_sql;
	args[1] = flattened_params;
}


function getParentDirPath(){
	switch(window.cordova.platformId){
		case 'ios': 
			return window.cordova.file.applicationStorageDirectory + '/Library';
		case 'android': 
		default:
			return window.cordova.file.applicationStorageDirectory;
	}
}

function getDatabaseDirName(){
	switch(window.cordova.platformId){
		case 'ios': 
			return 'LocalDatabase';
		case 'android': 
		default:
			return 'databases';
	}
}

function getDatabaseDirPath(){
	return getParentDirPath() + '/' + getDatabaseDirName();
}


function createDatabaseIfNecessary(db_name, onDbReady){
	
	console.log('createDatabaseIfNecessary '+db_name);
	var initial_db_filename = 'initial.' + db_name;

	// on mobile platforms, copy initial sqlite file from app root to data folder where we can open it for writing
	if (bCordova){
		console.log("will wait for deviceready");
		document.addEventListener("deviceready", function onDeviceReady(){
			console.log("deviceready handler");
			console.log("data dir: "+window.cordova.file.dataDirectory);
			console.log("app dir: "+window.cordova.file.applicationDirectory);
			window.requestFileSystem(LocalFileSystem.PERSISTENT, 0, function onFileSystemSuccess(fs){
				window.resolveLocalFileSystemURL(getDatabaseDirPath() + '/' + db_name, function(fileEntry){
					console.log("database file already exists");
					onDbReady();
				}, function onSqliteNotInited(err) { // file not found
					console.log("will copy initial database file");
					window.resolveLocalFileSystemURL(window.cordova.file.applicationDirectory + "/www/" + initial_db_filename, function(fileEntry) {
						console.log("got initial db fileentry");
						// get parent dir
						window.resolveLocalFileSystemURL(getParentDirPath(), function(parentDirEntry) {
							console.log("resolved parent dir");
							parentDirEntry.getDirectory(getDatabaseDirName(), {create: true}, function(dbDirEntry){
								console.log("resolved db dir");
								fileEntry.copyTo(dbDirEntry, db_name, function(){
									console.log("copied initial cordova database");
									onDbReady();
								}, function(err){
									throw Error("failed to copyTo: "+JSON.stringify(err));
								});
							}, function(err){
								throw Error("failed to getDirectory databases: "+JSON.stringify(err));
							});
						}, function(err){
							throw Error("failed to resolveLocalFileSystemURL of parent dir: "+JSON.stringify(err));
						});
					}, function(err){
						throw Error("failed to getFile: "+JSON.stringify(err));
					});
				});
			}, function onFailure(err){
				throw Error("failed to requestFileSystem: "+err);
			});
		}, false);
	}
	else{ // copy initial db to app folder
		var fs = require('fs'+'');
		fs.stat(path + db_name, function(err, stats){
			console.log("stat "+err);
			if (!err) // already exists
				return onDbReady();
			console.log("will copy initial db");
			var mode = parseInt('700', 8);
			var parent_dir = require('path'+'').dirname(path);
			fs.mkdir(parent_dir, mode, function(err){
				console.log('mkdir '+parent_dir+': '+err);
				fs.mkdir(path, mode, function(err){
					console.log('mkdir '+path+': '+err);
					fs.createReadStream(__dirname + '/' + initial_db_filename).pipe(fs.createWriteStream(path + db_name)).on('finish', onDbReady);
				});
			});
		});
	}
}
