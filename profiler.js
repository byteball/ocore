/*jslint node: true */
"use strict";

var count = 0;
var times = {};
var start_ts = 0;

var timers = {};
var timers_results = {};
var profiler_start_ts = Date.now();

function mark_start(tag, id) {
	return;
	if (!id) id = 0;
	if (!timers[tag]) timers[tag] = {};
	if (timers[tag][id])
		throw Error("multiple start marks for " + tag + "[" + id + "]");
	timers[tag][id] = Date.now();
}

function mark_end(tag, id) {
	return;
	if (!timers[tag]) return;
	if (!id) id = 0;
	if (!timers_results[tag])
		timers_results[tag] = [];
	timers_results[tag].push(Date.now() - timers[tag][id]);
	timers[tag][id] = 0;
}

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

function results() {
	console.log("\nBenchmarking results:");
	for (var tag in timers_results) {
		var results = timers_results[tag];
		var sum = 0, max = 0, min = 999999999999;
		for (var i = 0; i < results.length; i++) {
			var v = results[i];
			sum += v;
			if (v > max) max = v;
			if (v < min) min = v;
		}
		console.log(tag.padding(50) + ": avg:" + Math.round(sum / results.length).toString().padding(8) + "max:" + Math.round(max).toString().padding(8) + "min:" + Math.round(min).toString().padding(8) + "records:" + results.length);
	}
	console.log("\n\nStart time: " + profiler_start_ts + ", End time: " + Date.now() + " Elapsed ms:" + (Date.now() - profiler_start_ts));
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
	//print();
	results();
	process.exit();
});

String.prototype.padding = function(n, c)
{
        var val = this.valueOf();
        if ( Math.abs(n) <= val.length ) {
                return val;
        }
        var m = Math.max((Math.abs(n) - this.length) || 0, 0);
        var pad = Array(m + 1).join(String(c || ' ').charAt(0));
//      var pad = String(c || ' ').charAt(0).repeat(Math.abs(n) - this.length);
        return (n < 0) ? pad + val : val + pad;
//      return (n < 0) ? val + pad : pad + val;
};

var clog = console.log;
//console.log = function(){};

//exports.start = start;
//exports.stop = stop;
//exports.increment = increment;
exports.print = print;
exports.mark_start = mark_start;
exports.mark_end = mark_end;


exports.start = function(){};
exports.stop = function(){};
exports.increment = function(){};
//exports.print = function(){};