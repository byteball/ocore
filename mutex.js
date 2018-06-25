/*jslint node: true */
"use strict";
var _ = require('lodash');
require('./enforce_singleton.js');

var arrQueuedJobs = [];
var arrLockedKeyArrays = [];

function getCountOfQueuedJobs(){
	return arrQueuedJobs.length;
}

function getCountOfLocks(){
	return arrLockedKeyArrays.length;
}

function isAnyOfKeysLocked(arrKeys){
	for (var i=0; i<arrLockedKeyArrays.length; i++){
		var arrLockedKeys = arrLockedKeyArrays[i];
		for (var j=0; j<arrLockedKeys.length; j++){
			if (arrKeys.indexOf(arrLockedKeys[j]) !== -1)
				return true;
		}
	}
	return false;
}

function release(arrKeys){
	for (var i=0; i<arrLockedKeyArrays.length; i++){
		if (_.isEqual(arrKeys, arrLockedKeyArrays[i])){
			arrLockedKeyArrays.splice(i, 1);
			return;
		}
	}
}

function exec(arrKeys, proc, next_proc){
	arrLockedKeyArrays.push(arrKeys);
	console.log("lock acquired", arrKeys);
	var bLocked = true;
	proc(function(){
		if (!bLocked)
			throw Error("double unlock?");
		bLocked = false;
		release(arrKeys);
		console.log("lock released", arrKeys);
		if (next_proc)
			next_proc.apply(next_proc, arguments);
		handleQueue();
	});
}

function handleQueue(){
	console.log("handleQueue "+arrQueuedJobs.length+" items");
	for (var i=0; i<arrQueuedJobs.length; i++){
		var job = arrQueuedJobs[i];
		if (isAnyOfKeysLocked(job.arrKeys))
			continue;
		arrQueuedJobs.splice(i, 1); // do it before exec as exec can trigger another job added, another lock unlocked, another handleQueue called
		console.log("starting job held by keys", job.arrKeys);
		exec(job.arrKeys, job.proc, job.next_proc);
		i--; // we've just removed one item
	}
	console.log("handleQueue done "+arrQueuedJobs.length+" items");
}

function lock(arrKeys, proc, next_proc){
	if (isAnyOfKeysLocked(arrKeys)){
		console.log("queuing job held by keys", arrKeys);
		arrQueuedJobs.push({arrKeys: arrKeys, proc: proc, next_proc: next_proc, ts:Date.now()});
	}
	else
		exec(arrKeys, proc, next_proc);
}

function lockOrSkip(arrKeys, proc, next_proc){
	if (isAnyOfKeysLocked(arrKeys)){
		console.log("skipping job held by keys", arrKeys);
		if (next_proc)
			next_proc();
	}
	else
		exec(arrKeys, proc, next_proc);
}

function checkForDeadlocks(){
	for (var i=0; i<arrQueuedJobs.length; i++){
		var job = arrQueuedJobs[i];
		if (Date.now() - job.ts > 30*1000)
			throw Error("possible deadlock on job "+require('util').inspect(job)+",\nproc:"+job.proc.toString()+" \nall jobs: "+require('util').inspect(arrQueuedJobs, {depth: null}));
	}
}

// long running locks are normal in multisig scenarios
//setInterval(checkForDeadlocks, 1000);

setInterval(function(){
	console.log("queued jobs: "+JSON.stringify(arrQueuedJobs.map(function(job){ return job.arrKeys; }))+", locked keys: "+JSON.stringify(arrLockedKeyArrays));
}, 10000);

exports.lock = lock;
exports.lockOrSkip = lockOrSkip;
exports.isAnyOfKeysLocked = isAnyOfKeysLocked;
exports.getCountOfQueuedJobs = getCountOfQueuedJobs;
exports.getCountOfLocks = getCountOfLocks;

/*
function test(key){
	var loc = "localvar"+key;
	lock(
		[key], 
		function(cb){
			console.log("doing "+key);
			setTimeout(function(){
				console.log("done "+key);
				cb("arg1", "arg2");
			}, 1000)
		},
		function(arg1, arg2){
			console.log("got "+arg1+", "+arg2+", loc="+loc);
		}
	);
}

test("key1");
test("key2");
*/
