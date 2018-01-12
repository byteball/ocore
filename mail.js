const child_process = require('child_process');
const conf = require('./conf.js');
let DNS;

if (conf.smtpTransport === 'direct' && !(typeof window !== 'undefined' && window && window.cordova)) {
	DNS = require('dns');
	DNS.setServers(["8.8.8.8", "114.114.114.114"]); // google public DNS, China 114dns
}

if (conf.smtpTransport === 'relay' && !conf.smtpRelay)
	throw Error("please set smtpRelay in conf");


function sendmail(params, cb){
	if (!cb)
		cb = () => {};
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

function sendMailThroughUnixSendmail({to, from, subject, body}, cb) {
	const child = child_process.spawn('/usr/sbin/sendmail', ['-t', to]);
	child.stdout.pipe(process.stdout);
	child.stderr.pipe(process.stderr);
	child.stdin.write(`Return-Path: <${from}>\r\nTo: ${to}\r\nFrom: ${from}\r\nSubject: ${subject}\r\n\r\n${body}`);
	child.stdin.end();
	cb();
}

function sendMailDirectly(params, cb) {
	const nodemailer = require('node4mailer'+'');
	const hostname = params.to.slice(params.to.indexOf("@")+1);
	DNS.resolveMx(hostname, (err, exchanges) => {
		let exchange = hostname;
		if (exchanges && exchanges.length)
			exchange = exchanges[0].exchange;

		const transporter = nodemailer.createTransport({
			host: exchange,
		//	port: 25,
			secure: false,
			requireTLS: false,
			tls: {
				rejectUnauthorized: true
			}
		});

		const mailOptions = {
			from: params.from,
			to: params.to,
			subject: params.subject,
			text: params.body, // plain text body
			html: params.htmlBody // html body
		};

		transporter.sendMail(mailOptions, (error, info) => {
			if (error) {
				console.error(`failed to send mail to ${params.to}: ${error}`);
				return cb(error);
			}
			console.log('Message sent: %s', info.messageId);
			cb(null, info);
		});
	});
}

function sendMailThroughRelay(params, cb){
	const nodemailer = require('node4mailer'+'');
	const transportOpts = {
		host: conf.smtpRelay,
	//	port: 25,
		secure: false,
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
	const transporter = nodemailer.createTransport(transportOpts);
	const mailOptions = {
		from: params.from,
		to: params.to,
		subject: params.subject,
		text: params.body, // plain text body
		html: params.htmlBody // html body
	};

	transporter.sendMail(mailOptions, (error, info) => {
		if (error) {
			console.error(`failed to send mail to ${params.to}: ${error}\n`, error);
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
		subject: `BUG ${error_message.substr(0, 200).replace(/\s/g, ' ')}`,
		body: `${error_message}\n\n${(typeof exception === 'string') ? exception : JSON.stringify(exception, null, '\t')}`
	});
}

exports.sendmail = sendmail;
exports.sendBugEmail = sendBugEmail;
