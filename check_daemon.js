/*jslint node: true */
"use strict";
var child_process = require('child_process');
var conf = require('./conf.js');
var mail = require('./mail.js');

function checkDaemon(daemon_name, handleResult){
	child_process.exec('ps x', function(err, stdout, stderr){
		if (err)
			throw Error('ps x failed: '+err);
		if (stderr)
			throw Error('ps x stderr: '+stderr);
		var bFound = false;
		stdout.split('\n').forEach(function(line){
			if (line.indexOf(daemon_name) >= 0){
				bFound = true;
				write(line);
			}
		});
		handleResult(bFound);
	});
}

function checkDaemonAndNotify(daemon_name){
	checkDaemon(daemon_name, function(bFound){
		if (!bFound)
			notifyAdmin('daemon '+daemon_name+' is down');
	});
}

function checkDaemonAndRestart(daemon_name, start_command){
	checkDaemon(daemon_name, function(bFound){
		if (bFound)
			return;
		notifyAdmin('daemon '+daemon_name+' is down, trying to restart '+start_command);
		child_process.exec(start_command).unref();
		process.exit();
	});
}

function notifyAdmin(message){
	write(message);
	if (!conf.admin_email || !conf.from_email)
		return write('cannot notify admin as admin_email or from_email are not defined');
	mail.sendmail({
		to: conf.admin_email,
		from: conf.from_email,
		subject: message,
		body: 'Check daemon:\n'+message
	});
}

function write(str){
	console.log(Date().toString()+': '+str);
}

exports.checkDaemon = checkDaemon;
exports.checkDaemonAndNotify = checkDaemonAndNotify;
exports.checkDaemonAndRestart = checkDaemonAndRestart;

