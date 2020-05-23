var shell = require('child_process').execSync;
var test = require('ava');
var constants = require("../constants.js");
var kvstore = require("../kvstore");
var string_utils = require("../string_utils");
var db = require("../db");
var rocksdb = require('rocksdb');
var app_data_dir = require('../desktop_app.js').getAppDataDir();
var path = app_data_dir + '/rocksdb';

async function insertDataFeed(address, feed_name, value, mci, unit){
	return new Promise(function(resolve) {
		var strMci = string_utils.encodeMci(mci);
		var strValue = null;
		var numValue = null;
		if (typeof value === 'string'){
			var bLimitedPrecision = (mci < constants.aa2UpgradeMci);
			strValue = value;
			var float = string_utils.toNumber(value, bLimitedPrecision);
			if (float !== null)
				numValue = string_utils.encodeDoubleInLexicograpicOrder(float);
		}
		else
			numValue = string_utils.encodeDoubleInLexicograpicOrder(value);
		if (strValue !== null)
			kvstore.put('df\n'+address+'\n'+feed_name+'\ns\n'+strValue+'\n'+strMci, unit, ()=>{});
		if (numValue !== null)
			kvstore.put('df\n'+address+'\n'+feed_name+'\nn\n'+numValue+'\n'+strMci, unit, ()=>{});
		kvstore.put('dfv\n'+address+'\n'+feed_name+'\n'+strMci, value+'\n'+unit, resolve);
	});
}

async function insertStateVar(address, var_name, value){
	return new Promise(function(resolve) {
		kvstore.put('st\n'+address+'\n'+var_name, getType(value) + "\n" + value, resolve);
	});
}

function getType(value) {
	return (typeof value === 'string') ? 's' : 'n';
}

async function insertJoint(unit, value){
	return new Promise(function(resolve) {
		kvstore.put('j\n'+unit, value, resolve);
	});
}

test.before(async t => {
	console.log('===== before _init_datafeeds for ' + app_data_dir);
	await insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'test', 8, 90, 'unit1');
	await insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'test', 10, 100, 'unit2');
	await insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'te"st', 11, 100, 'unit3');
	await insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'te\'st', 15, 100, 'unit4');
	await insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 't,e(s)[],\'t', 20, 100, 'unit5');

	await insertStateVar('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'points', 1.2345);
	await insertStateVar('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'player_name', 'John');
	await insertStateVar('I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'temperature', '18.5');
	await insertStateVar('I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'price', 0.000678901234567);

	await db.query("INSERT "+db.getIgnore()+" INTO addresses (address) VALUES ('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'), ('I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT')");
	
	await db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable) VALUES ('testunit', 300, 300, 0, 100, 1)");
	await db.query("INSERT " + db.getIgnore() + " INTO attestations (unit, message_index, attestor_address, address) VALUES ('testunit', 0, 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU')");
	await db.query("INSERT " + db.getIgnore() + " INTO attested_fields (unit, message_index, attestor_address, address, field, value) VALUES ('testunit', 0, 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'email', 'smith@matrix.com')");
	await db.query("INSERT " + db.getIgnore() + " INTO attested_fields (unit, message_index, attestor_address, address, field, value) VALUES ('testunit', 0, 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'age', '24')");
	
	await db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable) VALUES ('unit2', 300, 300, 0, 1000, 1)");
	await db.query("INSERT " + db.getIgnore() + " INTO attestations (unit, message_index, attestor_address, address) VALUES ('unit2', 0, 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU')");
	await db.query("INSERT " + db.getIgnore() + " INTO attested_fields (unit, message_index, attestor_address, address, field, value) VALUES ('unit2', 0, 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'email', 'smith@matrix.com')");

	await db.query("INSERT " + db.getIgnore() + " INTO aa_addresses (address, unit, mci, definition, storage_size) VALUES ('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'def-unit', 100, '[\"autonomous agent\", {\"bounce_fees\": 20000}]', 27)");
	await db.query("INSERT " + db.getIgnore() + " INTO aa_balances (address, asset, balance) VALUES ('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'base', 10000)");

	await db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable) VALUES ('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=', 300, 300, 0, 0, 1)");
	
	await db.query("INSERT " + db.getIgnore() + " INTO witness_list_hashes (witness_list_unit, witness_list_hash) VALUES ('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'8/0sh9uejLd2vaf/5JDYeZ2fSTOnnEQnxz885cGJgf0=')");

	await db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable, is_on_main_chain, witness_list_unit, witnessed_level, level, timestamp) VALUES ('oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=', 300, 300, 0, 500, 1, 1, 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=', 450, 500, 1.5e9)");
	await db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable, latest_included_mc_index, best_parent_unit, witness_list_unit, witnessed_level, level, timestamp) VALUES ('DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=', 300, 300, 0, 600, 1, 599, 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=', 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=', 550, 600, 1.5e9)");

	await db.query("INSERT " + db.getIgnore() + " INTO addresses (address) VALUES ('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU')");
	await db.query("INSERT " + db.getIgnore() + " INTO addresses (address) VALUES ('BVVJ2K7ENPZZ3VYZFWQWK7ISPCATFIW3')");
	await db.query("INSERT " + db.getIgnore() + " INTO unit_authors (unit, address, _mci) VALUES ('oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=', 'BVVJ2K7ENPZZ3VYZFWQWK7ISPCATFIW3', 500)");
	await db.query("INSERT " + db.getIgnore() + " INTO unit_authors (unit, address, _mci) VALUES ('DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 600)");

	await db.query("INSERT " + db.getIgnore() + " INTO balls (unit, ball) VALUES ('oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=', 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=')");

	await db.query("INSERT " + db.getIgnore() + " INTO assets (unit, message_index, cap, is_private, is_transferrable, auto_destroy, fixed_denominations, issued_by_definer_only, cosigned_by_definer, spender_attested) VALUES ('oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=', 0, 6000, 0, 1, 0, 0, 1, 0, 0)");
	await db.query("INSERT " + db.getIgnore() + " INTO assets (unit, message_index, cap, is_private, is_transferrable, auto_destroy, fixed_denominations, issued_by_definer_only, cosigned_by_definer, spender_attested) VALUES ('DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=', 0, 6000, 0, 1, 0, 0, 1, 0, 0)");

	await db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable, latest_included_mc_index, witness_list_unit, witnessed_level, level) VALUES ('poP/Us+OuBgUxkNK5kIMA4ph6m+fkDQY4hl7T/8p/gs=', 300, 300, 0, 700, 1, 699, 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=', 550, 600)");
	await db.query("INSERT " + db.getIgnore() + " INTO inputs (unit, message_index, input_index, asset, type, serial_number, amount, address) VALUES ('poP/Us+OuBgUxkNK5kIMA4ph6m+fkDQY4hl7T/8p/gs=', 0, 0, 'DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=', 'issue', 1, 6000, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU')");

	await db.query("INSERT " + db.getIgnore() + " INTO unit_witnesses (unit, address) VALUES \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'BVVJ2K7ENPZZ3VYZFWQWK7ISPCATFIW3'), \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'DJMMI5JYA5BWQYSXDPRZJVLW3UGL3GJS'), \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'FOPUBEUPBC6YLIQDLKL6EW775BMV7YOH'), \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN'), \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'H5EZTQE7ABFH27AUDTQFMZIALANK6RBG'), \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT'), \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'JEDZYC2HMGDBIDQKG3XSTXUSHMCBK725'), \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'JPQKPRI5FMTQRJF4ZZMYZYDQVRD55OTC'), \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'OYW2XTDKSNKGSEZ27LMGNOPJSYIXHBHC'), \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'S7N5FE42F6ONPNDQLCF64E2MGFYKQR2I'), \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'TKT4UESIKTTRALRRLWS4SENSTJX6ODCW'), \n\
	('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'UENJPVZ7HVHM6QGVGT6MWOJGGRTUTJXQ')");

	await insertJoint('oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=', '{"unit":{"unit":"oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=","version":"1.0","alt":"1","witness_list_unit":"J8QFgTLI+3EkuAxX+eL6a0q114PJ4h4EOAiHAzxUp24=","last_ball_unit":"ichtuZ7mv93Jw26hksj8O4LnoNd8S+XCehVcFc8mbNg=","last_ball":"KQyKskSkOpGG839zVBKLbSe2Q6q+VJ2oh1m+46A0p1I=","headers_commission":344,"payload_commission":197,"main_chain_index":4123083,"timestamp":1553853204,"parent_units":["4ne7myhibBARgaA/PPwynnK408bmY7ypL/+X+tp0IqU="],"authors":[{"address":"TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W","authentifiers":{"r":"deqAMOAKyn4mDOZlyBd2eHMPrIXiT8BsVh7/Ejuii+kUm90CCrcWU0adsTWGHhj/7j7/LGZn7SLzzISQ93QRlA=="}}],"messages":[{"app":"payment","payload_hash":"24J5BXJrAfoOub2g/auiK04Z0x3LfQJq71Zsv8M8GVQ=","payload_location":"inline","payload":{"inputs":[{"unit":"ichtuZ7mv93Jw26hksj8O4LnoNd8S+XCehVcFc8mbNg=","message_index":0,"output_index":0}],"outputs":[{"address":"2VOBZNQPXAO4POCXEUZXUJSRD53OMOTH","amount":13729863},{"address":"TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W","amount":1543931896}]}}]},"ball":"nAgiWwtErFZ7Y2GNKbcrAJmN4qf4AeV++wlwNi1MTww="}');
});

test.after.always.cb(t => {
	console.log('===== after ' + app_data_dir);
	kvstore.close(() => {
		console.log("kvstore closed");
		setTimeout(() => {
			rocksdb.destroy(path, function(err){
				console.log('db destroy result: '+(err || 'ok'));
				db.close(() => {
					// shell('rm -r ' + app_data_dir); // was throwing errors on Windows, now old data gets deleted before each run
					t.end();
				});
			});
		}, 100);
	});
});
