var test = require('ava');
var kvstore = require("../kvstore");
var string_utils = require("../string_utils");
var rocksdb = require('rocksdb');
var app_data_dir = require('../desktop_app.js'+'').getAppDataDir();
var path = app_data_dir + '/rocksdb';


function insertDataFeed(address, feed_name, value, mci, unit){
	var strMci = string_utils.encodeMci(mci);
	var strValue = null;
	var numValue = null;
	if (typeof value === 'string'){
		strValue = value;
		var float = string_utils.getNumericFeedValue(value);
		if (float !== null)
			numValue = string_utils.encodeDoubleInLexicograpicOrder(float);
	}
	else
		numValue = string_utils.encodeDoubleInLexicograpicOrder(value);
	if (strValue !== null)
		kvstore.put('df\n'+address+'\n'+feed_name+'\ns\n'+strValue+'\n'+strMci, unit, ()=>{});
	if (numValue !== null)
		kvstore.put('df\n'+address+'\n'+feed_name+'\nn\n'+numValue+'\n'+strMci, unit, ()=>{});
	kvstore.put('dfv\n'+address+'\n'+feed_name+'\n'+strMci, value+'\n'+unit, ()=>{});
}

test.before.cb(t => {
//	console.log('===== before');
	insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'test', 8, 90, 'unit1');
	insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'test', 10, 100, 'unit2');
	insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'te"st', 11, 100, 'unit3');
	insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'te\'st', 15, 100, 'unit4');
	insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 't,e(s)[],\'t', 20, 100, 'unit5');
	t.end();
});

test.after.always.cb(t => {
//	console.log('===== after');
	kvstore.close(() => {
		rocksdb.destroy(path, function(err){
			console.log('db destroy result: '+(err || 'ok'));
			t.end();
		});
	});
});
