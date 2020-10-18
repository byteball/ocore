/*jslint node: true */
"use strict";
if (typeof window === 'object' && window.cordova)
	return;
var fs = require("fs");
var eventBus = require("./event_bus.js");
var desktopApp = require('./desktop_app.js');
var appDataDir = desktopApp.getAppDataDir();

var bPrintOnExit = false;
var printOnScreenPeriodInSeconds = 0;
var printOnFileMciPeriod = 0;
var directoryName = "profiler";

var bOn = bPrintOnExit || printOnScreenPeriodInSeconds > 0;

var count = 0;
var times = {};
var start_ts = 0;

var times_sl1 = {};
var counters_sl1 = {};

var start_ts_sl1 = 0;

var timers = {};
var counters = {};
var timers_results = {};
var profiler_start_ts = Date.now();

if (printOnScreenPeriodInSeconds > 0)
	setInterval(print_on_screen, printOnScreenPeriodInSeconds * 1000);

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

function add_result(tag, consumed_time){
	if (!bOn)
		return;
	if (!timers_results[tag])
		timers_results[tag] = [];
	timers_results[tag].push(consumed_time);
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
	if (!counters[tag])
		counters[tag]=0;
	counters[tag]++;
	start_ts = 0;
}

function start_sl1(){
	if (start_ts_sl1)
		throw Error("profiler already started");
	start_ts_sl1 = Date.now();
}

function stop_sl1(tag){
	if (!start_ts_sl1)
		throw Error("profiler not started");
	if (!times_sl1[tag])
		times_sl1[tag] = 0;
	times_sl1[tag] += Date.now() - start_ts_sl1;
	if (!counters_sl1[tag])
		counters_sl1[tag]=0;
	counters_sl1[tag]++;
	start_ts_sl1 = 0;
}

function isStarted(){
	return !!start_ts;
}

function print_on_screen(){
	console.error("\n" + getFormattedResults());
}

function print_on_log(){
	console.log(getFormattedResults());
}

if (printOnFileMciPeriod){
	fs.mkdir(appDataDir + '/' + directoryName, (err) => { 
		eventBus.on("mci_became_stable", function(mci){
			if (mci % printOnFileMciPeriod === 0){
				var total = 0;
				for (var tag in times)
					total += times[tag];
				fs.writeFile(appDataDir + '/' + directoryName + "/mci-" + mci + "-" + (total/count).toFixed(2) +' ms', getFormattedResults(), ()=>{});
				count = 0;
				times = {};
				times_sl1 = {};
				counters_sl1 = {};
				timers = {};
				counters = {};
				timers_results = {};
				profiler_start_ts = Date.now();
			}
		});
	}); 
}


function getFormattedResults(){
	var formattedResults = "";
	if (count === 0)
		return "No profiling result yet.";;
	
	var format_line = function(times_for_tag, counter_for_tag, tag){
		formattedResults += "\n" +
			pad_right(tag+": ", 33) + 
			pad_left(times_for_tag, 5) + ', ' + 
			pad_left((times_for_tag/counter_for_tag).toFixed(2), 5) + ' ms per op, ' + 
			pad_left((times_for_tag/count).toFixed(2), 5) + ' ms per unit' + 
			(total > 0 ? ', ' + pad_left((100*times_for_tag/total).toFixed(2), 5) + '%' : '');
	}
	
	formattedResults += "---------- Profiling results ----------\n-> Main level:";
	var total = 0;
	for (var tag in times)
		total += times[tag];
	for (var tag in times){
		format_line(times[tag], counters[tag], tag);
	}
	formattedResults +='\ntotal: '+total;
	formattedResults += "\n" + total/count+' ms per unit';
	
	if(Object.keys(times_sl1).length > 0){
		formattedResults += "\n\n-> Sub level 1:";
		total = 0;
		for (var tag in times_sl1){
			format_line(times_sl1[tag], counters_sl1[tag], tag);
		}
	}

	return formattedResults;
}

function print_results_on_log() {
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
	var elapsed = Date.now() - profiler_start_ts;
	console.log("\n\nStart time: " + profiler_start_ts + ", End time: " + Date.now() + " Elapsed ms:" + (Date.now() - profiler_start_ts));
	console.log("time in db "+exports.time_in_db+"ms, "+(exports.time_in_db/elapsed*100)+"%");
	if (process.cpuUsage){
		var usage = process.cpuUsage();
		console.log("usage "+usage.user+"mus "+(usage.user/1000/elapsed*100)+"%, sys "+usage.system+"mus "+(usage.system/1000/elapsed*100)+"%, total "+((usage.system+usage.user)/1000/elapsed*100)+"%");
	}
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

if (bPrintOnExit){
	process.on('SIGINT', function(){
		console.log = clog;
		console.log("received sigint");
		print_on_log();
		print_results_on_log();
		process.exit();
	});
}

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

if (bOn){
	exports.start = start;
	exports.stop = stop;
	exports.start_sl1 = start_sl1;
	exports.stop_sl1 = stop_sl1;
	exports.increment = increment;
	exports.isStarted = isStarted;
} else {
	exports.start = function(){};
	exports.stop = function(){};
	exports.start_sl1 = function(){};
	exports.stop_sl1 = function(){};
	exports.increment = function(){};
	exports.isStarted = function(){};
}

exports.print = print_on_log;
exports.mark_start = mark_start;
exports.mark_end = mark_end;
exports.add_result = add_result;
exports.time_in_db = 0;


//exports.print = function(){};