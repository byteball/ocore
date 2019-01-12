/*jslint node: true */
"use strict";
var async = require('async');
var kvstore = require('./kvstore.js');
var string_utils = require('./string_utils.js');


function dataFeedExists(arrAddresses, feed_name, relation, value, min_mci, max_mci, handleResult){
	async.eachSeries(
		arrAddresses,
		function(address, cb){
			dataFeedByAddressExists(address, feed_name, relation, value, min_mci, max_mci, cb);
		},
		function(bFound){
			console.log('data feed by '+arrAddresses+' '+feed_name+relation+value+': '+bFound);
			handleResult(!!bFound);
		}
	);
}

function dataFeedByAddressExists(address, feed_name, relation, value, min_mci, max_mci, handleResult){
	if (relation === '!='){
		return dataFeedByAddressExists(address, feed_name, '>', value, min_mci, max_mci, function(bFound){
			if (bFound)
				return handleResult(true);
			dataFeedByAddressExists(address, feed_name, '<', value, min_mci, max_mci, handleResult);
		});
	}
	var prefixed_value;
	if (typeof value === 'string'){
		var float = string_utils.getNumericFeedValue(value);
		if (float !== null)
			prefixed_value = 'n\n'+string_utils.encodeDoubleInLexicograpicOrder(float);
		else
			prefixed_value = 's\n'+value;
	}
	else
		prefixed_value = 'n\n'+string_utils.encodeDoubleInLexicograpicOrder(value);
	var strMinMci = string_utils.encodeMci(min_mci);
	var strMaxMci = string_utils.encodeMci(max_mci);
	var key_prefix = 'df\n'+address+'\n'+feed_name+'\n'+prefixed_value;
	var bFound = false;
	var options = {};
	switch (relation){
		case '=':
			options.gte = key_prefix+'\n'+strMaxMci;
			options.lte = key_prefix+'\n'+strMinMci;
			options.limit = 1;
			break;
		case '>':
		case '>=':
			options[(relation === '>') ? 'gt' : 'gte'] = key_prefix;
			options.lt = 'df\n'+address+'\n'+feed_name+'\r';  // \r is next after \n
			break;
		case '<':
		case '<=':
			options[(relation === '<') ? 'lt' : 'lte'] = key_prefix;
			options.gt = 'df\n'+address+'\n'+feed_name+'\n';
			break;
	}
	var handleData;
	if (relation === '=')
		handleData = function(data){
			bFound = true;
		};
	else
		handleData = function(data){
			if (bFound)
				return;
			var mci = string_utils.getMciFromDataFeedKey(data);
			if (mci >= min_mci && mci <= max_mci){
				bFound = true;
			}
		};
	kvstore.createKeyStream(options)
	.on('data', handleData)
	.on('end', function(){
		handleResult(bFound);
	})
	.on('error', function(error){
		throw Error('error from data stream: '+error);
	});
}


function readDataFeedValue(arrAddresses, feed_name, value, min_mci, max_mci, ifseveral, handleResult){
	var objResult = {bAbortedBecauseOfSeveral: false, value: undefined, unit: undefined, mci: undefined};
	async.eachSeries(
		arrAddresses,
		function(address, cb){
			readDataFeedByAddress(address, feed_name, value, min_mci, max_mci, ifseveral, objResult, cb);
		},
		function(err){ // err passed here if aborted because of several
			console.log('data feed by '+arrAddresses+' '+feed_name+', val='+value+': '+objResult.value);
			handleResult(objResult);
		}
	);
}

function readDataFeedByAddress(address, feed_name, value, min_mci, max_mci, ifseveral, objResult, handleResult){
	var bAbortIfSeveral = (ifseveral === 'abort');
	var key_prefix;
	if (value === null){
		key_prefix = 'dfv\n'+address+'\n'+feed_name;
	}
	else{
		var prefixed_value;
		if (typeof value === 'string'){
			var float = string_utils.getNumericFeedValue(value);
			if (float !== null)
				prefixed_value = 'n\n'+string_utils.encodeDoubleInLexicograpicOrder(float);
			else
				prefixed_value = 's\n'+value;
		}
		else
			prefixed_value = 'n\n'+string_utils.encodeDoubleInLexicograpicOrder(value);
		key_prefix = 'df\n'+address+'\n'+feed_name+'\n'+prefixed_value;
	}
	var options = {
		gte: key_prefix+'\n'+string_utils.encodeMci(max_mci),
		lte: key_prefix+'\n'+string_utils.encodeMci(min_mci),
		limit: bAbortIfSeveral ? 2 : 1
	};
	var handleData = function(data){
		if (bAbortIfSeveral && objResult.value !== undefined){
			objResult.bAbortedBecauseOfSeveral = true;
			return;
		}
		var mci = string_utils.getMciFromDataFeedKey(data.key);
		if (objResult.value === undefined || ifseveral === 'last' && mci > objResult.mci){
			if (value !== null){
				objResult.value = string_utils.getValueFromDataFeedKey(data.key);
				objResult.unit = data.value;
			}
			else{
				var arrParts = data.value.split('\n');
				objResult.value = string_utils.getFeedValue(arrParts[0]); // may convert to number
				objResult.unit = arrParts[1];
			}
			objResult.mci = mci;
		}
	};
	kvstore.createReadStream(options)
	.on('data', handleData)
	.on('end', function(){
		handleResult(objResult.bAbortedBecauseOfSeveral);
	})
	.on('error', function(error){
		throw Error('error from data stream: '+error);
	});
}



exports.dataFeedExists = dataFeedExists;
exports.readDataFeedValue = readDataFeedValue;
