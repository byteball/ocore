/*jslint node: true */
'use strict';
var kvstore = require('../kvstore.js');

var args = process.argv.slice(2);
var showValue = args.includes('--show-value');
var topN = 10;
var topNArg = args.find(arg => arg.startsWith('--top='));
if (topNArg) {
	topN = parseInt(topNArg.split('=')[1], 10) || 10;
}

var start_time = process.hrtime();
var topVars = []; // array of {address, var_name, value_length, value}
var totalCount = 0;

console.log('Scanning all state variables...');

kvstore.createReadStream({ gte: 'st\n', lte: 'st\n\xff' })
.on('data', function(data) {
	totalCount++;
	
	// key format: "st\n" + address + "\n" + var_name
	var key = data.key;
	if (!key.startsWith('st\n')) return;
	
	var rest = key.slice(3); // remove "st\n"
	var newlinePos = rest.indexOf('\n');
	if (newlinePos === -1) return;
	
	var address = rest.slice(0, newlinePos);
	var var_name = rest.slice(newlinePos + 1);
	var value = data.value;
	var value_length = value.length;
	
	// Insert into topVars maintaining sorted order (descending by length)
	if (topVars.length < topN || value_length > topVars[topVars.length - 1].value_length) {
		var entry = {
			address: address,
			var_name: var_name,
			value_length: value_length,
			value: value
		};
		
		// Find insertion position
		var insertPos = topVars.findIndex(v => v.value_length < value_length);
		if (insertPos === -1) {
			topVars.push(entry);
		} else {
			topVars.splice(insertPos, 0, entry);
		}
		
		// Keep only top N
		if (topVars.length > topN) {
			topVars.pop();
		}
	}
	
	if (totalCount % 100000 === 0) {
		console.log('Processed ' + totalCount + ' state variables...');
	}
})
.on('end', function() {
	console.log('\n=== Results ===');
	console.log('Total state variables scanned: ' + totalCount);
	console.log('Search completed in ' + getTimeDifference(start_time).toFixed(2) + 'ms\n');
	
	if (topVars.length === 0) {
		console.log('No state variables found.');
	} else {
		console.log('Top ' + topVars.length + ' longest state variables:\n');
		
		topVars.forEach(function(entry, index) {
			console.log((index + 1) + '. Address: ' + entry.address);
			console.log('   Variable: ' + entry.var_name);
			console.log('   Value length: ' + entry.value_length + ' bytes');
			
			if (showValue) {
				// Parse the value type
				var type = entry.value[0];
				var typeStr = type === 's' ? 'string' : type === 'n' ? 'number' : type === 'j' ? 'json' : 'unknown';
				console.log('   Type: ' + typeStr);
				
				// Show truncated value
				var displayValue = entry.value;
				if (displayValue.length > 500) {
					displayValue = displayValue.substring(0, 500) + '... (truncated)';
				}
				console.log('   Value: ' + displayValue.replace(/\n/g, '\\n'));
			}
			console.log('');
		});
	}
	
	process.exit(0);
})
.on('error', function(error) {
	console.error('Error from data stream:', error);
	process.exit(1);
});

function getTimeDifference(time) {
	const diff = process.hrtime(time);
	return (diff[0] + diff[1] / 1e9) * 1000;
}
