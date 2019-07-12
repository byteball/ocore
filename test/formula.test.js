var path = require('path');
var crypto = require('crypto');
var Mnemonic = require('bitcore-mnemonic');
var objectHash = require("../object_hash.js");
var ecdsaSig = require('../signature.js');
var desktop_app = require('../desktop_app.js');
desktop_app.getAppDataDir = function() { return __dirname + '/.testdata-' + path.basename(__filename); }

var Decimal = require('decimal.js');
var formulaParser = require('../formula/index');
var test = require('ava');
require('./_init_datafeeds.js');

function validateFormula(formula, complexity, cb) {
	formulaParser.validate({formula: formula, complexity: complexity}, cb);
}

function evalFormula(conn, formula, messages, objValidationState, address, callback){
	formulaParser.validate({ formula: formula, complexity: 1, count_ops: 0 }, function (res) {
		console.log('validation: ', res);
		if (res.error)
			return callback(null);
		if (res.complexity > 100)
			return callback(null);
		var opts = {
			conn: conn,
			formula: formula,
			messages: messages,
			objValidationState: objValidationState,
			address: address
		};
		formulaParser.evaluate(opts, function (err, eval_res) {
			if (err)
				console.log("evaluation error: " + err);
			callback(eval_res);
		});
	});
}

function evalAAFormula(conn, formula, trigger, objValidationState, address, callback){
	formulaParser.validate({ formula: formula, complexity: 1, count_ops: 0, bAA: true }, function(validation_res){
		if (validation_res.error) {
			console.log("validation failed", validation_res);
			return callback(null);
		}
		if (validation_res.complexity > 100) {
			console.log('complexity exceeded');
			return callback(null);
		}
		var opts = {
			conn: conn,
			formula: formula,
			trigger: trigger,
			objValidationState: objValidationState,
			address: address
		};
		formulaParser.evaluate(opts, function (err, eval_res) {
			if (err)
				console.log("evaluation error: " + err);
			callback(eval_res, validation_res.complexity, validation_res.count_ops);
		});
	});
}

function evalFormulaWithVars(opts, callback) {
	var val_opts = {
		formula: opts.formula,
		complexity: 1,
		count_ops: 0,
		bAA: true,
		bStateVarAssignmentAllowed: opts.bStateVarAssignmentAllowed,
		bStatementsOnly: opts.bStatementsOnly
	};
	formulaParser.validate(val_opts, function(validation_res){
		if (validation_res.error) {
			console.log("validation failed", validation_res);
			return callback(null);
		}
		if (validation_res.complexity > 100) {
			console.log('complexity exceeded');
			return callback(null);
		}
		formulaParser.evaluate(opts, function (err, eval_res) {
			if (err)
				console.log("evaluation error: " + err);
			callback(eval_res, validation_res.complexity, validation_res.count_ops);
		});
	});
}

var objValidationState = {
	last_ball_mci: 1000,
	last_ball_timestamp: 1.5e9,
	mc_unit: "oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=",
	assocBalances: {},
	arrAugmentedMessages: [{
		"app": "payment",
		"payload_location": "inline",
		"payload_hash": "2p893QLyyaUi0Nw5IWGjRtocjAksxpiFvXYuBRwPTZI=",
		"payload": {
			"outputs": [
				{"address": "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", "amount": 19088},
				{"address": "GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN", "amount": 1}
			],
			"inputs": [{
				"unit": "p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=",
				"message_index": 0,
				"output_index": 1,
				"type": "transfer",
				"amount": 20000,
				"address": "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU"
			}]
		}
	}],
/*	messages: [{
		"app": "payment",
		"payload_hash": "vHTdyhuQI1jnlAAyc6EGzwVCH0BGFT+dIYrsjTeRV8k=",
		"payload_location": "inline",
		"payload": {
			"inputs": [{
				"unit": "W/6iS75IT8mKJzKyyjz5dKCp9Ux6F7+AUUNq8VLiZ6o=",
				"message_index": 0,
				"output_index": 0
			}],
			"outputs": [
				{"address": "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", "amount": 19088},
				{"address": "GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN", "amount": 1}
			]
		}
	}]*/
};



test('number_from_seed with non-int min', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `number_from_seed("vvv", '10', 109)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, null);
	})
});



test.cb('is_valid_sig brainpoolP160r1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEIwFAYHKoZIzj0CAQYJKyQDAwIIAQEBAyoABJCmcRs3G2UFvmChdUjnHfWLwHDu\n\
Eb73voycog6PiLDlhliiKRChX/k=\n\
-----END PUBLIC KEY-----\n\
",
		message: "r8MICxEwcvjATw==",
		signature: "302d02141e6b3cf28ee0cc5f5e3237e5b756ccfd29da9b1a0215009b2938baad0cd8d9d0e0360bf70385aa80465769"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig brainpoolP160t1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEIwFAYHKoZIzj0CAQYJKyQDAwIIAQECAyoABDrXbW64eeEMFd6X10bUUIB+0+4I\n\
BNikqRtTJI5OEF+1zgM/vPbOiSk=\n\
-----END PUBLIC KEY-----",
		message: "ghcVhm4PupDhtw==",
		signature: "302e021500e51ac6ea7109ea896a20a447c2bc15284dd089d2021500b2243f3fb844bbef81b7166ed53df3900e38ffcb"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig brainpoolP192r1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEowFAYHKoZIzj0CAQYJKyQDAwIIAQEDAzIABBrPicyaJL113QhTutwGTUlZpvUN\n\
Xr4O+pCjIwdCf4ZWB5zm175REld05mCxw1WD7w==\n\
-----END PUBLIC KEY-----\n\
",
		message: "ifrRBpyCAppA4Q==",
		signature: "30340218436e84c604312ad267ef1768111ebdfe5f89774e254e3b8a02185638216092aa5ac464aa9b8d58ce58ac6d7c243641785f6f"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig brainpoolP192t1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEowFAYHKoZIzj0CAQYJKyQDAwIIAQEEAzIABG7FrdP/Kqv8MZ4A097cEz0VuG1P\n\
ebtdiWNfmIvnMC3quUpg3XQal7okD8HuqcuQCg==\n\
-----END PUBLIC KEY-----",
		message: "6ct+Hx9kTTzQtw==",
		signature: "303402187959b2a68956ac5945165e9a6a6bb86e21d0541294a101700218471f19357d8582302208467fb61744192f9238c2a83ec6d2"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig brainpoolP224r1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFIwFAYHKoZIzj0CAQYJKyQDAwIIAQEFAzoABKrMKlXz4Q1V4E5Jc/pOtu8e9hCz\n\
2d+v4QG4PyomNzzMl4jkW6LdIsNiec3NfzYCBV32nGWh2mga\n\
-----END PUBLIC KEY-----\n\
",
		message: "RaG6CO3DGoei0A==",
		signature: "303c021c0de15c9a56a5a09990fa37b41dee7be9bae5ea39627b1cdc808bd85c021c79815e69d4d9c1c341d1910f4255705ce07f5eb40996c13ab842cff5"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig brainpoolP224t1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFIwFAYHKoZIzj0CAQYJKyQDAwIIAQEGAzoABJOCCM3NyNbBPuKM5tXnEYF9G1yN\n\
5xoNC5cVbgB+6jTrleVbN9tdZUzIGAv4N+dQwAm/wT/IJi/L\n\
-----END PUBLIC KEY-----\n\
",
		message: "EYI8scoS3O2P+Q==",
		signature: "303c021c01ea5074b12fa3ef4e9267baf61f065babbae2ed841d7ab34dae976d021c02287b50d112b6e689e06297099002b49c8c1ba6f794a2851fc6f681"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig brainpoolP256r1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFowFAYHKoZIzj0CAQYJKyQDAwIIAQEHA0IABB+Oy7FreTgSzE2o1yJ9Pax82B1H\n\
hFTQlZtnri6yeYc4FD14JtRsGlCs/MhFD0cJ1eyG8LF6at3IKDgEXVKFQ14=\n\
-----END PUBLIC KEY-----\n\
",
		message: "97SbbYLEi+OKiQ==",
		signature: "304402205f0ada205ff3ccd7a64bbbb87565cbde23369c0405e8d65788f18ee68a7a3da502201c481c526cdf53196499e62bcbff96dd9c2d615ff7464e37e6655cc0c71e6cfc"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig brainpoolP256t1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFowFAYHKoZIzj0CAQYJKyQDAwIIAQEIA0IABAOwh8XfsafAtRLbSXr9TeyoxALw\n\
9AHEuAyzR9Jkn5naKtXw92tsgELEAe8FoC2bMQra90BBunDSZ5hWJ0kmhsM=\n\
-----END PUBLIC KEY-----\n\
",
		message: "BV+t1g4ry/lwbQ==",
		signature: "3046022100a096ea0ee17013cab1d5efe91d5ebc089de1453aa3fdb7231c4d7fe0579d8f79022100a4ea5e17b9a683236b66cd5c7e6dbf9e487dbdcfd23637dd7bbde4227aab4371"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig prime192v1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQEDMgAE9gVzj8ln8mQkWYjiJPtXaux/sE+i\n\
wyyL5c97Q1PKdOs3imnb6vHzjX2+OiUbyeo0\n\
-----END PUBLIC KEY-----\n\
",
		message: "1jEzhdzTt8jdDg==",
		signature: "3036021900f6110d12605d91fc3e02bfff96b31c6d0216719a6d8af59b021900cea71a90bc4bc03744e34e6d84ee27b22175b154184253eb"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig prime192v2', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQIDMgAEUv/XMkZQAh6raybe5eUSZslEQHa2\n\
hF0aQX7GEzIUaf6U+tcCxH0vA98NJruvNSo6\n\
-----END PUBLIC KEY-----\n\
",
		message: "GrR8t8sUxWoZTA==",
		signature: "3035021900d6f10143fdd2663e607005e63946d3f8b06fc5506853b32502183f1b991abf1dd88b2be604db0439070eb190e663f3e0d4c2"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig prime192v3', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQMDMgAETwRXBZPMijq57ZJtjW0bERO1zFtn\n\
j1CF57Xty1oW0qwQp7MGwZFoI4PUcPOW13n7\n\
-----END PUBLIC KEY-----\n\
",
		message: "mMzo8jXJXTxtOw==",
		signature: "3035021900bfd6c6d13b5693a061e28cc958ccd74c393bec648d23a6440218321dde94d7fcef0444ac54017afe7fa7fd7262ab46f0228d"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig prime239v1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFUwEwYHKoZIzj0CAQYIKoZIzj0DAQQDPgAEeI1X93xK8CMd4LaKxn2htmX6T+qG\n\
AmjfEi1SfznVLimygh0tagzsOd+nsU1ZR/9Rsm6tYA5/WQ6TSm82\n\
-----END PUBLIC KEY-----\n\
",
		message: "hNA/OY7gCBlwYw==",
		signature: "3040021e6a54c095ea0342274b1de23ab32b7fa05f4979879208668545973c545349021e4e21110e36b338b7861fd533152c8eac73fe0b76b27cae73ddbdb65f8df9"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig prime239v2', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFUwEwYHKoZIzj0CAQYIKoZIzj0DAQUDPgAEe954N2iMUnXf1MI71W5DlO9Aig02\n\
zZKc5kzJv5+RO+h27kH9YwGQxVrHkYBuT0CdHPwRP4qoV3rtDTr0\n\
-----END PUBLIC KEY-----\n\
",
		message: "f+kuiPY5TeMQlA==",
		signature: "3040021e72ad6ec7a52e13700feb74239646b15c978c506839de522e8a6102641e4e021e14f64b7340ef700d6f73799d1ff8249c2561fdf97cbaa8b09370cef44d37"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig prime239v3', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFUwEwYHKoZIzj0CAQYIKoZIzj0DAQYDPgAETfQcYzVhKIU9psJpErUWj4mIyVqs\n\
rdqRuUd2Xov6cNdKWVEqD3b+75UoD85QY1T0kGRGPozJsYOQi5mo\n\
-----END PUBLIC KEY-----\n\
",
		message: "m7tV23s+mg88Zw==",
		signature: "3040021e27b1c4433432264b4c37b5906f78df846ca5abafa7c38891a2ed61e0a110021e16060df846382374e9f10e89408365d3ef645e7a2a54393f7d34094a09c8"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig prime256v1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEm0mHi/tkBaLsV3r8NkAe2qdxjELY\n\
Efj35hOsRLwauY4Zwcg3np9JwXnGKpqOcQqzAoGssdDu4VcEsLBH36aDOQ==\n\
-----END PUBLIC KEY-----\n\
",
		message: "rSBCK+7STefBZw==",
		signature: "3045022060987010a85c5d99eec8c47067e0b60fec8074c44a2d17015e3e07fa58f583db022100cc4d73b6be530fba46f92d8d315917bc0b370cce69dc964078271d384ff4f046"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig secp112r1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDIwEAYHKoZIzj0CAQYFK4EEAAYDHgAEgv8t87LBg+WU26Jt06IRjX4EAy/eYWrz\n\
pGgXPA==\n\
-----END PUBLIC KEY-----\n\
",
		message: "RDF/mb8EuM0TKw==",
		signature: "3021020f00d56f5bc11604ee190bde024bf7a5020e1e223ecbeb5cf3f8afae847c4b95"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig secp112r2', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDIwEAYHKoZIzj0CAQYFK4EEAAcDHgAEfrkTX0zPYHUUqITaNTq1/n0VEo99W35k\n\
RhK3zQ==\n\
-----END PUBLIC KEY-----\n\
",
		message: "mM1x7/KYT2i7YQ==",
		signature: "3020020e36d025b7c498e5256cce2de33f41020e323e4a33bcacdb5acce2cfcb8a7d"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig secp128r1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDYwEAYHKoZIzj0CAQYFK4EEABwDIgAE3NnCLe9V/CnfPGidbHKBTYOfqlncIBF7\n\
n4Eph94TXsE=\n\
-----END PUBLIC KEY-----\n\
",
		message: "H6SCKhzkVH7KyA==",
		signature: "302402105cb60567603f2b2dc60552c282470525021034be9c19e7b1a065316c6197aba3dda4"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig secp128r2', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----MDYwEAYHKoZIzj0CAQYFK4EEAB0DIgAE/rxQC9fowzoqPifvmQ2nwVNSeDf68UvKa8yalVhbMfo=-----END PUBLIC KEY-----\n\
",
		message: "MyBhy6HPFOTA6w==",
		signature: "302402100193661097af8581cd2c4395a1ddee730210292858cb027da9d4ea428be130948c34"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig secp160k1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----MD4wEAYHKoZIzj0CAQYFK4EEAAkDKgAEzrS/07CLkeakDXcqyT4KPkk7nmoS2WQ8\n\
mU8TyjvILmp3uf30gAhRog==\n\
-----END PUBLIC KEY-----\n\
",
		message: "JqJjbn+BV8jIjg==",
		signature: "302d0214540c680bb2eae476d7aafa2c43490aaf872f258a021500ba56a8c1b1c5fb7d272eeada8f3ae7413601abd7"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig  secp160k1 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFK4EEAAkDK  gAEHB7gqTrUuENcC95Ld+UUiSUXi0bMicn9\n\
yO83NJ3jYS8N0m+zf2ZjnA==\n\
-----END PUBLIC KEY-----\n\
",
			message: "19277b3f15c5d69bf27f85888a402c20162dde71feadf35bdc3d0974a78b5da4",
			signature: "MC0CFQCAya0J6hEOwJFDdqs/fNVAqOxUFgIUQsnZ7chouQ/XwPUly7sJKoXOVmc="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  secp160r1 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFK4EEAAgDKgAEvEaOIt	V3bgJr+buaecauJ2GgI5pd1rA6\n\
ZB5m99fx0RZtoS	zGjNnDDg==\n\
-----END PUBLIC KEY-----\n\
",
			message: "897980aeb750f1a2b43f353b3b0274c9e8e2137887a4d42e5400d6a089fa68a4",
			signature: "MC0CFQDKLJtF0ss/8G+FM5THxTQld2MjXgIUI6qgmZHIztM+xXGTYkysBF74CNA="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  secp160r2 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFK4EEAB4DKgAEwnavWgz/5H+lPJI91F3OhpEp6cGGsjYn\n\
ddE32NpknZ/jRrKFw9Mfig==\n\
-----END PUBLIC KEY-----\n\
",
			message: "9b1799a4ba7b4330e230c81e4b3f0fcbd42682b68b524111f435011a67d59e56",
			signature: "MC0CFQDh5VdHy+Yj0KwoqZKh31+v6r8F8gIUVZLKHvAxvHHmQPtQk9aPBAEKhYo="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  secp192k1 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEYwEAYHKoZIzj0CAQYFK4EEAB8DMgAEg9qAQX+CEdA1Dx4wCeC4CWoPwvi09CXe\n\
aFLaYYaAn4u5uMY8cKp3ljZU8JAdgEZ8\n\
-----END PUBLIC KEY-----",
			message: "6825b5eef7aba09e29c18e54b7639e969ca1c8f746a9b6faf90a9d294428330d",
			signature: "MDQCGFSWSytQAz1YsfULlgWCFHeuYk7t2eY76QIYMpNhdtI0a47K1QH9jrQgU+PMglcxCLwk"
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  secp224k1 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
ME4wEAYHKoZIzj0CAQYFK4EEACADOgAEwmeaTigeEry/ZV5LISsp9q8PWbe5u7bj\n\
HzORXVUNLI8wxes5guOcc80Ik3iFcb0uPn5J7xf0bNw=\n\
-----END PUBLIC KEY-----",
			message: "7d970297fdace86d668780249813d3d7849e606cf21575123052060600add58c",
			signature: "MD4CHQDmSHUWEqnJlnItkPgyxLr1ab1hPBuvCl4pVug3Ah0A1XLLQ9x23mofTn172LHvZHZKc2Wpb++1Oe3Xsw=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  secp224r1 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
ME4wEAYHKoZIzj0CAQYFK4EEACEDOgAEDyXSZpxi3D0o+ETj9OPuSSJn24xeHAj5\n\
kMigTiz+BMzuLiDBGicKTufnYN/NDDuynnRS0DCHBs0=\n\
-----END PUBLIC KEY-----\n\
",
			message: "968ed711b805d1740c98c9d5257c41fa8d91d01cebe468e5e6c85230190cf2e7",
			signature: "MD4CHQCvxWb7su+S+hroTrGs9qohQJve2vnfHVzKPtrGAh0A5zJxa3P3iZZ+nOGI68VgnWhZfAilGrwXSFGPgw=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  secp256k1 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEG7dvwfTNoLaqlZPiXoatOr7ru0qW3OE6\n\
wtxsPV3F3i6MFRJgSRCbUChJkG9dqyGh7DqM7xwHn5YdqQ+HwfE4bw==\n\
-----END PUBLIC KEY-----",
			message: "4111c0dfc41d47f56248ccdc9009b98e7516d6f3db806e999ee5f27b574a48d6",
			signature: "MEUCIDbAjd+mtf4gim/5VkZdPnnexnS8hOCrGXMVFTOnO2MsAiEA7VtOW1aGhRaX5fbRCtNTosHCCmMQ7Z+kc76wUuPMMgU="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  secp384r1 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAESrCfUeo8PK2yYjh7qQi3E5NnhI7cMxV2\n\
k590vrJ5L0ZwnpZ7X4j0Htm85gKWj/fBnPFF2JxZw584nvXH3U4HmfwPil5OmDVN\n\
BY/eihj5OWxfk4edRHEw/5oVwCYjv8Lp\n\
-----END PUBLIC KEY-----",
			message: "0bfa4fa0dfb7c5ea690936984deaf734519b2ff06cc6a391a61650dea2bcab36",
			signature: "MGUCMQDgcsJ82L9FlMeG+CQVhdYsfpJBKR6C4eN9Hoc7s5OeDvAbzLgIHcJE63PNlCa0bRQCMGpqhKxUCRiPSMgwxrJoDofHIqhDdzdW6OWKud4rVl/KdtnTmxXjbqamb73HhXBZuA=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  sect113r1 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDQwEAYHKoZIzj0CAQYFK4EEAAQDIAAEARoivIeHqLLETrzXuUCpAXzG/47I76cp\n\
m19WO62N\n\
-----END PUBLIC KEY-----\n\
",
			message: "f570f92c7254caa7deff812e7135982d148ddf6c48f4a0dfd603aba3da014c87",
			signature: "MCECDwC++pNxTN78ZUvFgq09FAIOMPbLIJnPAVnm0o+Uecs="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  sect113r2 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDQwEAYHKoZIzj0CAQYFK4EEAAUDIAAEALcmgHruxF2kowJbntUXAPWT/vZ9DJop\n\
XgWeszOD\n\
-----END PUBLIC KEY-----\n\
",
			message: "ba7e1418f8f922c65076fbf5bde2240fd06d5fe6530714b7d2f55c77cae8c3bb",
			signature: "MCECDwCP5tvTCG2NPwO3ev/kHwIOLAj0vPRhqDbo2b9PygA="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  sect131r1 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDgwEAYHKoZIzj0CAQYFK4EEABYDJAAEA7pGqXHZbq7YmIwR+Sz0RS0E5+EYuEOF\n\
Qe/VD9Z8TSogbQ==\n\
-----END PUBLIC KEY-----",
			message: "288478241cbaedb3db7e713b4671b2d1c14e04899793dcb901e9c9f9dfaca6ce",
			signature: "MCUCEELWlLGgYQz2gDuG3tWAkRYCEQHN5f3ce2tjNVmOtSWf3leD"
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  sect131r2 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDgwEAYHKoZIzj0CAQYFK4EEABcDJAAEBXsC0pF78Pkm+xbZ9O0jas4HcXpkaj3V\n\
Nj0rbU9Qdp3fUQ==\n\
-----END PUBLIC KEY-----",
			message: "5a3b72275d4df38beacce80614ee742498cbeea4ce8fde0a36726e8c0edb464f",
			signature: "MCUCEQJMpOatObfCwHqg9ibWp9ztAhAHL6DIq4sggDTG6B9SyFp5"
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  wap-wsg-idm-ecid-wtls1 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDQwEAYHKoZIzj0CAQYFZysBBAEDIAAEAMOLI6WbXBKMrhHy2n5pAJFXA2TVvyuB\n\
plx5ZBeK\n\
-----END PUBLIC KEY-----",
			message: "0b7f3ee98e92e64b78036a25fa016ec72668bb01046fecc9930273e428e22f4e",
			signature: "MCICDwDvKpUuquvfW5Qr5g6CdwIPAMH4Djm1ifzlfjDqiOvY"
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  wap-wsg-idm-ecid-wtls4 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDQwEAYHKoZIzj0CAQYFZysBBAQDIAAEASXF52NqXzD0LTJITPpFAdCSnjmAbbOd\n\
wweGdisD\n\
-----END PUBLIC KEY-----",
			message: "93742a587b78a1e9fcbb28ca5e22911ee40b9ef52bcf65a5a0b6a84b98de0003",
			signature: "MCECDwCwFsU3ad7Ds+4J5UQa0wIOQRCzDTvmfKJbYuWlh8Y="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  wap-wsg-idm-ecid-wtls6 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDIwEAYHKoZIzj0CAQYFZysBBAYDHgAEtDlDeleEaOtZqhiq8NS57eVTp02jbGYU\n\
5GXZsA==\n\
-----END PUBLIC KEY-----\n\
",
			message: "ba0366789050060398a428d9890311b4ddd4a42fd605431aa42146a70fa21a21",
			signature: "MCECDhrZdlPX+gOcXFs40Z3pAg8Axtbap8vwiYJqK52xLAc="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  wap-wsg-idm-ecid-wtls7 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFZysBBAcDKgAEuafrAVc0ym3lxXBCqIVkKasIwV0dErF9\n\
2w2aL5E2iCtWJiMBZPj1Xg==\n\
-----END PUBLIC KEY-----",
			message: "6bd95527ec489fc85fcc50c1e2de9576cd590e8b334283b2ac8007761f65321f",
			signature: "MC0CFHRbtpr0eXsXyyDjZ4MCMt/IYqW5AhUA1WBkcg7hvusyTTnYChpy93P8JNA="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  wap-wsg-idm-ecid-wtls8 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDIwEAYHKoZIzj0CAQYFZysBBAgDHgAEhBQU9JZ/Ov5FDslsocdLgCcl4avwXqFo\n\
HFuU6g==\n\
-----END PUBLIC KEY-----",
			message: "81aaf7c9b3e28fe1b99bed9f3977b08208b62ebe0c466d86c52228277fc78db9",
			signature: "MCECDghjjHVPnJiGrMh7qIfBAg8AnL1JewKY2Zfy9NoemR0="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});
test.cb('is_valid_sig  wap-wsg-idm-ecid-wtls9 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFZysBBAkDKgAEjPJsTF6uFoQjeE2zVnYzpFJX2Q21Kvkc\n\
yufZHPc4CmP84iPBG1yA4A==\n\
-----END PUBLIC KEY-----\n\
",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "MC4CFQCZcoeqbsp8STbd0DAATLgdt4cedAIVAOmXhLBP/rmATKg+78kQ5eIA5553"
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

test.cb('is_valid_sig  wrong pub key 1', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PRIVATE KEY-----\n\
MD4wEAYHKoZIzj0CAQYFZysBBAkDKgAEjPJsTF6uFoQjeE2zVnYzpFJX2Q21Kvkc\n\
yufZHPc4CmP84iPBG1yA4A==\n\
-----END PRIVATE KEY-----\n\
",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "MC4CFQCZcoeqbsp8STbd0DAATLgdt4cedAIVAOmXhLBP/rmATKg+78kQ5eIA5553"
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 3);
		t.end();
	})
});

