/*jslint node: true */
"use strict";
var child_process = require('child_process');
var conf = require('./conf.js');
var mail = require('./mail.js');

function checkDaemon(daemon_name){
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
		if (!bFound)
			notifyAdmin('daemon '+daemon_name+' is down');
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

