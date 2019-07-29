/*jslint node: true */
"use strict";
var async = require('async');
var constants = require('./constants.js');
var kvstore = require('./kvstore.js');
var string_utils = require('./string_utils.js');
var conf = require('./conf.js');
var storage = require('./storage.js'); // have to introduce a cyclic dependency but fortunately it's only when we upgrade

var bCordova = (typeof window === 'object' && window.cordova);
if (!process.hrtime)
	process.hrtime = function () { return 0; }

function migrate(conn, onDone){
	storage.initializeMinRetrievableMci(conn, function(){
		migrateUnits(conn, function(){
			migrateDataFeeds(conn, onDone);
		});
	});
}

function migrateUnits(conn, onDone){
	conn.query("SELECT unit FROM units", function(rows){
		if (rows.length === 0)
			return onDone();
		var start_time = Date.now();
		var reading_time = 0;
		var batch = bCordova ? null : kvstore.batch();
		async.forEachOfSeries(
			rows,
			function(row, i, cb){
				var unit = row.unit;
				var time = process.hrtime();
				storage.readJoint(conn, unit, {
					ifNotFound: function(){
						throw Error("not found: "+unit);
					},
					ifFound: function(objJoint){
						reading_time += getTimeDifference(time);
						if (!conf.bLight){
							if (objJoint.unit.version === constants.versionWithoutTimestamp)
								delete objJoint.unit.timestamp;
							delete objJoint.unit.main_chain_index;
						}
						if (bCordova)
							return conn.query("INSERT " + conn.getIgnore() + " INTO joints (unit, json) VALUES (?,?)", [unit, JSON.stringify(objJoint)], function(){ cb(); });
						batch.put('j\n'+unit, JSON.stringify(objJoint));
						if (i%1000 > 0)
							return cb();
						commitBatch(batch, function(){
							console.error('units '+i);
							// open a new batch
							batch = kvstore.batch();
							cb();
						});
					}
				}, true);
			},
			function(){
				if (bCordova)
					return onDone();
				commitBatch(batch, function(){
					var consumed_time = Date.now()-start_time;
					console.error('units done in '+consumed_time+'ms, avg '+(consumed_time/rows.length)+'ms');
					console.error('reading time '+reading_time+'ms, avg '+(reading_time/rows.length)+'ms');
					onDone();
				});
			}
		);
	});
}

function migrateDataFeeds(conn, onDone){
	if (conf.storage !== 'sqlite')
		throw Error('only sqlite migration supported');
	if (bCordova)
		return onDone();
	var count = 0;
	var offset = 0;
	var CHUNK_SIZE = 10000;
	var start_time = Date.now();
	async.forever(
		function(next){
			conn.query(
				"SELECT unit, address, feed_name, `value`, int_value, main_chain_index \n\
				FROM data_feeds CROSS JOIN units USING(unit) CROSS JOIN unit_authors USING(unit) \n\
				WHERE data_feeds.rowid>=? AND data_feeds.rowid<? \n\
				ORDER BY data_feeds.rowid",
				[offset, offset + CHUNK_SIZE],
				function(rows){
					if (rows.length === 0)
						return next('done');
					var batch = kvstore.batch();
					async.eachSeries(
						rows,
						function(row, cb){
							count++;
							var strMci = string_utils.encodeMci(row.main_chain_index);
							var strValue = null;
							var numValue = null;
							var value = null;
							if (row.value !== null){
								value = row.value;
								strValue = row.value;
								var float = string_utils.getNumericFeedValue(row.value);
								if (float !== null)
									numValue = string_utils.encodeDoubleInLexicograpicOrder(float);
							}
							else{
								value = row.int_value;
								numValue = string_utils.encodeDoubleInLexicograpicOrder(row.int_value);
							}
							// duplicates will be overwritten, that's ok for data feed search
							if (strValue !== null)
								batch.put('df\n'+row.address+'\n'+row.feed_name+'\ns\n'+strValue+'\n'+strMci, row.unit);
							if (numValue !== null)
								batch.put('df\n'+row.address+'\n'+row.feed_name+'\nn\n'+numValue+'\n'+strMci, row.unit);
							batch.put('dfv\n'+row.address+'\n'+row.feed_name+'\n'+strMci, value+'\n'+row.unit);

							(count % 1000 === 0) ? setImmediate(cb) : cb();
						},
						function(){
							commitBatch(batch, function(){
								console.error('df '+count);
								offset += CHUNK_SIZE;
								next();
							});
						}
					);
				}
			);
		},
		function(err){
			if (count === 0)
				return onDone();
			var consumed_time = Date.now()-start_time;
			console.error('df done in '+consumed_time+'ms, avg '+(consumed_time/count)+'ms');
			onDone();
		}
	);
}

function commitBatch(batch, onDone){
	batch.write(function(err){
		if (err)
			throw Error("writer: batch write failed: "+err);
		onDone();
	});
}

function getTimeDifference(time){
	var diff = process.hrtime(time);
	return (diff[0] + diff[1]/1e9)*1000;
}


module.exports = migrate;
