/*jslint node: true */
'use strict';
var kvstore = require('../kvstore.js');
var string_utils = require('../string_utils.js');

var start_time = process.hrtime();
var totalCount = 0;
var badCount = 0;
var parseErrors = 0;

console.log('Scanning all joints (j\\n keys) for lone surrogates...');

kvstore.createReadStream({ gte: 'j\n', lte: 'j\n\xff' })
.on('data', function (data) {
	totalCount++;

	var unit = data.key.slice(2); // strip leading "j\n"
	var json = data.value;

	var obj;
	try {
		obj = JSON.parse(json);
	} catch (e) {
		parseErrors++;
		console.error('JSON parse error for unit ' + unit + ': ' + e.message);
		return;
	}

	if (!string_utils.isObjectWellFormed(obj)) {
		badCount++;
		console.log('ILL-FORMED: ' + unit);
	}

	if (totalCount % 100000 === 0)
		console.log('... scanned ' + totalCount);
})
.on('end', function () {
	var elapsed = getTimeDifference(start_time);
	console.log('\nDone in ' + elapsed.toFixed(0) + 'ms.');
	console.log('Scanned : ' + totalCount);
	console.log('Ill-formed: ' + badCount);
	if (parseErrors > 0)
		console.log('Parse errors: ' + parseErrors);
})
.on('error', function (error) {
	throw Error('error from data stream: ' + error);
});

function getTimeDifference(time) {
	var diff = process.hrtime(time);
	return (diff[0] + diff[1] / 1e9) * 1000;
}
