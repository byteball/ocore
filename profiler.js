/*jslint node: true */
"use strict";
/*
var count = 0;
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
	for (var tag in times)
		total += times[tag];
	for (var tag in times){
		console.log(
			pad_right(tag+": ", 33) + 
			pad_left(times[tag], 5) + ', ' + 
			pad_left((times[tag]/count).toFixed(2), 5) + ' per unit, ' + 
			pad_left((100*times[tag]/total).toFixed(2), 5) + '%'
		);
	}
	console.log('total: '+total);
	console.log(total/count+' per unit');
}

function pad_right(str, len){
	if (str.length >= len)
		return str;
	return str + ' '.repeat(len - str.length);
}

function pad_left(str, len){
	str = str+'';
	if (str.length >= len)
		return str;
	return ' '.repeat(len - str.length) + str;
}

function increment(){
	count++;
}

process.on('SIGINT', function(){
	console.log = clog;
	console.log("received sigint");
	print();
	process.exit();
});

var clog = console.log;
//console.log = function(){};

exports.start = start;
exports.stop = stop;
exports.increment = increment;
exports.print = print;
*/

exports.start = function(){};
exports.stop = function(){};
exports.increment = function(){};
exports.print = function(){};

