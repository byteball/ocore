var test = require('ava');
var kvstore = require("../kvstore");
var string_utils = require("../string_utils");
var db = require("../db");
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

function insertStateVar(address, var_name, value){
	kvstore.put('st\n'+address+'\n'+var_name, value, ()=>{});
}

test.before.cb(t => {
//	console.log('===== before');
	insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'test', 8, 90, 'unit1');
	insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'test', 10, 100, 'unit2');
	insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'te"st', 11, 100, 'unit3');
	insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'te\'st', 15, 100, 'unit4');
	insertDataFeed('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 't,e(s)[],\'t', 20, 100, 'unit5');

	insertStateVar('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'points', 1.2345);
	insertStateVar('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'player_name', 'John');
	insertStateVar('I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'temperature', '18.5');

	db.query("INSERT "+db.getIgnore()+" INTO addresses (address) VALUES ('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'), ('I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT')");
	
	db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable) VALUES ('testunit', 300, 300, 0, 100, 1)");
	db.query("INSERT " + db.getIgnore() + " INTO attestations (unit, message_index, attestor_address, address) VALUES ('testunit', 0, 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU')");
	db.query("INSERT " + db.getIgnore() + " INTO attested_fields (unit, message_index, attestor_address, address, field, value) VALUES ('testunit', 0, 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'email', 'smith@matrix.com')");
	db.query("INSERT " + db.getIgnore() + " INTO attested_fields (unit, message_index, attestor_address, address, field, value) VALUES ('testunit', 0, 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'age', '24')");
	
	db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable) VALUES ('unit2', 300, 300, 0, 1000, 1)");
	db.query("INSERT " + db.getIgnore() + " INTO attestations (unit, message_index, attestor_address, address) VALUES ('unit2', 0, 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU')");
	db.query("INSERT " + db.getIgnore() + " INTO attested_fields (unit, message_index, attestor_address, address, field, value) VALUES ('unit2', 0, 'I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'email', 'smith@matrix.com')");

	db.query("INSERT " + db.getIgnore() + " INTO aa_addresses (address, unit, mci, definition) VALUES ('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'def-unit', 100, 'some definition')");
	db.query("INSERT " + db.getIgnore() + " INTO aa_balances (address, asset, balance) VALUES ('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 'base', 10000)");

	db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable) VALUES ('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=', 300, 300, 0, 0, 1)");
	
	db.query("INSERT " + db.getIgnore() + " INTO witness_list_hashes (witness_list_unit, witness_list_hash) VALUES ('oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',	'8/0sh9uejLd2vaf/5JDYeZ2fSTOnnEQnxz885cGJgf0=')");

	db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable, is_on_main_chain, witness_list_unit, witnessed_level, level) VALUES ('oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=', 300, 300, 0, 500, 1, 1, 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=', 450, 500)");
	db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable, latest_included_mc_index, best_parent_unit, witness_list_unit, witnessed_level, level) VALUES ('DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=', 300, 300, 0, 600, 1, 599, 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=', 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=', 550, 600)");

	db.query("INSERT " + db.getIgnore() + " INTO addresses (address) VALUES ('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU')");
	db.query("INSERT " + db.getIgnore() + " INTO addresses (address) VALUES ('BVVJ2K7ENPZZ3VYZFWQWK7ISPCATFIW3')");
	db.query("INSERT " + db.getIgnore() + " INTO unit_authors (unit, address, _mci) VALUES ('oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=', 'BVVJ2K7ENPZZ3VYZFWQWK7ISPCATFIW3', 500)");
	db.query("INSERT " + db.getIgnore() + " INTO unit_authors (unit, address, _mci) VALUES ('DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=', 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', 600)");

	db.query("INSERT " + db.getIgnore() + " INTO balls (unit, ball) VALUES ('oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=', 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=')");

	db.query("INSERT " + db.getIgnore() + " INTO assets (unit, message_index, cap, is_private, is_transferrable, auto_destroy, fixed_denominations, issued_by_definer_only, cosigned_by_definer, spender_attested) VALUES ('oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=', 0, 6000, 0, 1, 0, 0, 1, 0, 0)");
	db.query("INSERT " + db.getIgnore() + " INTO assets (unit, message_index, cap, is_private, is_transferrable, auto_destroy, fixed_denominations, issued_by_definer_only, cosigned_by_definer, spender_attested) VALUES ('DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=', 0, 6000, 0, 1, 0, 0, 1, 0, 0)");

	db.query("INSERT " + db.getIgnore() + " INTO units (unit, headers_commission, payload_commission, is_free, main_chain_index, is_stable, latest_included_mc_index, witness_list_unit, witnessed_level, level) VALUES ('poP/Us+OuBgUxkNK5kIMA4ph6m+fkDQY4hl7T/8p/gs=', 300, 300, 0, 700, 1, 699, 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=', 550, 600)");
	db.query("INSERT " + db.getIgnore() + " INTO inputs (unit, message_index, input_index, asset, type, serial_number, amount, address) VALUES ('poP/Us+OuBgUxkNK5kIMA4ph6m+fkDQY4hl7T/8p/gs=', 0, 0, 'DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=', 'issue', 1, 6000, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU')");

	db.query("INSERT " + db.getIgnore() + " INTO unit_witnesses (unit, address) VALUES \n\
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
