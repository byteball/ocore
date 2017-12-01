'use strict';
var child_process = require('child_process');
var conf = require('./conf.js');

function sendmail(params){
	var child = child_process.spawn('/usr/sbin/sendmail', ['-t', params.to]);
	child.stdout.pipe(process.stdout);
	child.stderr.pipe(process.stderr);
	child.stdin.write("Return-Path: <"+params.from+">\r\nTo: "+params.to+"\r\nFrom: "+params.from+"\r\nSubject: "+params.subject+"\r\n\r\n"+params.body);
	child.stdin.end();
}

function sendBugEmail(error_message, exception){
	sendmail({
		to: conf.bug_sink_email,
		from: conf.bugs_from_email,
		subject: 'BUG '+error_message.substr(0, 200).replace(/\s/g, ' '),
		body: error_message + "\n\n" + ((typeof exception === 'string') ? exception : JSON.stringify(exception, null, '\t'))
	});
}

exports.sendmail = sendmail;
exports.sendBugEmail = sendBugEmail;
