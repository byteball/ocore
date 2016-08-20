/*jslint node: true */
"use strict";
/*
var times = {};
var start_ts = 0;

function start(){
	if (start_ts)
		throw Error("profiler already started");
	start_ts = Date.now();
}

function stop(tag){
	if (!start_ts)
		throw Error("profiler not started");
	if (!times[tag])
		times[tag] = 0;
	times[tag] += Date.now() - start_ts;
	start_ts = 0;
}

function print(){
	console.log("\nProfiling results:");
	var total = 0;
	for (var tag in times){
		console.log(tag+": "+times[tag]);
		total += times[tag];
	}
	console.log('total: '+total);
}


process.on('SIGINT', function(){
	console.log("received sigint");
	print();
	process.exit();
});


exports.start = start;
exports.stop = stop;
*/

exports.start = function(){};
exports.stop = function(){};

