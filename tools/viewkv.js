/*jslint node: true */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');

// read-only follower, works whether or not the node is running
var secondary_dir = process.env.KVSTORE_SECONDARY_PATH || fs.mkdtempSync(path.join(os.tmpdir(), 'viewkv-'));
process.env.KVSTORE_SECONDARY_PATH = secondary_dir;

var kvstore = require('../kvstore.js');

process.on('exit', function(){
	fs.rmSync(secondary_dir, {recursive: true, force: true});
});

var args = process.argv.slice(2);
var key = args.join('\n');

kvstore.catchUpWithPrimary();

var start_time = process.hrtime();

kvstore.createReadStream({gte: key, lte: key+'\xff'})
.on('data', function(data){
	console.log(data.key.replace(/\n/g, ' / ') + ': '+data.value.replace(/\n/g, ' / '));
})
.on('end', function(){
	console.log('search done in ' + getTimeDifference(start_time) + 'ms');
})
.on('error', function(error){
	throw Error('error from data stream: '+error);
});


function getTimeDifference(time){
	const diff = process.hrtime(time);
	return (diff[0] + diff[1]/1e9)*1000;
}
