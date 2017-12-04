'use strict';
var child_process = require('child_process');
var conf = require('./conf.js');
var DNS = require('dns');
var nodemailer = require('node4mailer');
var fs = require('fs');

if (!(window && window.cordova)) {
	DNS.setServers(["8.8.8.8", "114.114.114.114"]); // google public DNS, China 114dns
}

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

function sendEmail(email, params, cb, forceInsecure) {
	var hostname = email.slice(email.indexOf("@")+1);
	var secure = forceInsecure ? false : true;
	DNS.resolveMx(hostname, function(err, exchanges){
		var exchange = hostname;
		if (exchanges && exchanges.length)
			exchange = exchanges[0].exchange;

		var transporter = nodemailer.createTransport({
			host: exchange,
			port: 25,
			secure: false,
			requireTLS: secure,
			tls: {
				rejectUnauthorized: secure
			}
		});

		fs.readFile(__dirname + '/email_template.html', 'utf8', function (err, template) {
			params.amount -= TEXTCOIN_CLAIM_FEE;
			var html = template.replace(/\{\{mnemonic\}\}/g, params.mnemonic).replace(/\{\{amount\}\}/g, params.amount).replace(/\{\{asset\}\}/g, params.asset);
			var text = "Someone sent you " + params.amount + " " + params.asset + ", to claim it download Byteball wallet and recover Wallet from the following Seed: " + params.mnemonic;
			let mailOptions = {
				from: '"Byteball Wallet" <noreply@byteball.org>',
				to: email,
				subject: 'Byteball Transaction Received',
				text: text, // plain text body
				html: html // html body
			};

			transporter.sendMail(mailOptions, function(error, info) {
				if (error) {
					return cb(error);
				}
				console.log('Message sent: %s', info.messageId);
				cb(null, info);
			});
		});
	});
}

exports.sendEmail = sendEmail;
exports.sendmail = sendmail;
exports.sendBugEmail = sendBugEmail;
