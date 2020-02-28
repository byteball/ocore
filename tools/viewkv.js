/*jslint node: true */
'use strict';
var kvstore = require('../kvstore.js');

var args = process.argv.slice(2);
var key = args.join('\n');

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
