/*jslint node: true */
"use strict";
var async = require('async');
var kvstore = require('./kvstore.js');
var string_utils = require('./string_utils.js');
var conf = require('./conf.js');
var storage = require('./storage.js'); // have to introduce a cyclic dependency but fortunately it's only when we upgrade

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
		var batch = kvstore.batch();
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
							delete objJoint.unit.timestamp;
							delete objJoint.unit.main_chain_index;
						}
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
	conn.query(
		"SELECT unit, address, feed_name, `value`, int_value, main_chain_index \n\
		FROM data_feeds CROSS JOIN units USING(unit) CROSS JOIN unit_authors USING(unit) \n\
		ORDER BY data_feeds.rowid",
		function(rows){
			if (rows.length === 0)
				return onDone();
			var start_time = Date.now();
			var batch = kvstore.batch();
			async.forEachOfSeries(
				rows,
				function(row, i, cb){
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
						value = int_value;
						numValue = string_utils.encodeDoubleInLexicograpicOrder(row.int_value);
					}
					// duplicates will be overwritten, that's ok for data feed search
					if (strValue !== null)
						batch.put('df\n'+row.address+'\n'+row.feed_name+'\ns\n'+strValue+'\n'+strMci, row.unit);
					if (numValue !== null)
						batch.put('df\n'+row.address+'\n'+row.feed_name+'\nn\n'+numValue+'\n'+strMci, row.unit);
					batch.put('dfv\n'+row.address+'\n'+row.feed_name+'\n'+strMci, value+'\n'+row.unit);
					
					if (i%10000 > 0)
						return (i%1000 === 0) ? setImmediate(cb) : cb();
					commitBatch(batch, function(){
						console.error('df '+i);
						// open a new batch
						batch = kvstore.batch();
						cb();
					});
				},
				function(){
					commitBatch(batch, function(){
						var consumed_time = Date.now()-start_time;
						console.error('df done in '+consumed_time+'ms, avg '+(consumed_time/rows.length)+'ms');
						onDone();
					});
				}
			);
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
