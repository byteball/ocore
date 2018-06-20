'use strict';
var child_process = require('child_process');
var conf = require('./conf.js');
var DNS;

if (conf.smtpTransport === 'direct' && !(typeof window !== 'undefined' && window && window.cordova)) {
	DNS = require('dns');
	DNS.setServers(["8.8.8.8", "114.114.114.114"]); // google public DNS, China 114dns
}

if (conf.smtpTransport === 'relay' && !conf.smtpRelay)
	throw Error("please set smtpRelay in conf");
	

function sendmail(params, cb){
	if (!cb)
		cb = function(){};
	switch (conf.smtpTransport){
		case 'relay':
			return sendMailThroughRelay(params, cb);
		case 'direct':
			return sendMailDirectly(params, cb);
		case 'local':
		default:
			sendMailThroughUnixSendmail(params, cb);
	}
}

function sendMailThroughUnixSendmail(params, cb){
	var child = child_process.spawn('/usr/sbin/sendmail', ['-t', params.to]);
	child.stdout.pipe(process.stdout);
	child.stderr.pipe(process.stderr);
	child.stdin.write("Return-Path: <"+params.from+">\r\nTo: "+params.to+"\r\nFrom: "+params.from+"\r\nSubject: "+params.subject+"\r\n\r\n"+params.body);
	child.stdin.end();
	cb();
}

function sendMailDirectly(params, cb) {
	var nodemailer = require('node4mailer'+'');
	var hostname = params.to.slice(params.to.indexOf("@")+1);
	DNS.resolveMx(hostname, function(err, exchanges){
		var exchange = hostname;
		if (exchanges && exchanges.length)
			exchange = exchanges[0].exchange;

		var transporter = nodemailer.createTransport({
			host: exchange,
			port: conf.smtpPort || null, // custom port
			secure: conf.smtpSsl || false, // secure=true is port 465
			requireTLS: false,
			tls: {
				rejectUnauthorized: true
			}
		});

		var mailOptions = {
			from: params.from,
			to: params.to,
			subject: params.subject,
			text: params.body, // plain text body
			html: params.htmlBody // html body
		};

		transporter.sendMail(mailOptions, function(error, info) {
			if (error) {
				console.error("failed to send mail to "+params.to+": "+error);
				return cb(error);
			}
			console.log('Message sent: %s', info.messageId);
			cb(null, info);
		});
	});
}

function sendMailThroughRelay(params, cb){
	var nodemailer = require('node4mailer'+'');
	var transportOpts = {
		host: conf.smtpRelay,
		port: conf.smtpPort || null, // custom port
		secure: conf.smtpSsl || false, // secure=true is port 465
		requireTLS: false,
		tls: {
			rejectUnauthorized: true
		}
	};
	if (conf.smtpUser && conf.smtpPassword)
		transportOpts.auth = {
			user: conf.smtpUser,
			pass: conf.smtpPassword
		}
	var transporter = nodemailer.createTransport(transportOpts);
	var mailOptions = {
		from: params.from,
		to: params.to,
		subject: params.subject,
		text: params.body, // plain text body
		html: params.htmlBody // html body
	};

	transporter.sendMail(mailOptions, function(error, info) {
		if (error) {
			console.error("failed to send mail to "+params.to+": "+error+"\n", error);
			return cb(error);
		}
		console.log('Message sent: %s', info.messageId);
		cb(null, info);
	});
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
