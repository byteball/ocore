var path = require('path');
var ecdsaSig = require('../signature.js');
var desktop_app = require('../desktop_app.js');
desktop_app.getAppDataDir = function() { return __dirname + '/.testdata-' + path.basename(__filename); }

var formulaParser = require('../formula/index');
var test = require('ava');
require('./_init_datafeeds.js');


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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig secp128r1', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDYwEAYHKoZIzj		0CAQYF   K4EEABwDIgAE3NnCLe  9V/CnfPGidbHKBTYOfqlncIBF7\n\
n4Eph94TXsE=\n\
-----END PUBLIC KEY-----\n\
",
		message: "H6SCKhzkVH7KyA==",
		signature: "302402105cb60567603f2b2dc60552c282470525021034be9c19e7b1a065316c6197aba3dda4"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('is_valid_sig  wap-wsg-idm-ecid-wtls4 base64', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----MDQwEAYHKoZIzj0CAQYFZysBBAQDIAAEASXF52NqXzD0LTJITPpFAdCSnjmAbbOdwweGdisD\n\
-----END PUBLIC KEY-----",
			message: "93742a587b78a1e9fcbb28ca5e22911ee40b9ef52bcf65a5a0b6a84b98de0003",
			signature: "MCECDwCwFsU3ad7Ds+4J5UQa0wIOQRCzDTvmfKJbYuWlh8Y="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
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
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig bad sig', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAESrCfUeo8PK2yYjh7qQi3E5NnhI7cMxV2\n\
k590vrJ5L0ZwnpZ7X4j0Htm85gKWj/fBnPFF2JxZw584nvXH3U4HmfwPil5OmDVN\n\
BY/eihj5OWxfk4edRHEw/5oVwCYjv8Lp\n\
-----END PUBLIC KEY-----",
			message: "0bfa4fa0dfb7c5ea690936984deaf734519b2ff06cc6a391a61650dea2bcab36",
			signature: "!GUCMQDgcsJ82L9FlMeG+CQVhdYsfpJBKR6C4eN9Hoc7s5OeDvAbzLgIHcJE63PNlCa0bRQCMGpqhKxUCRiPSMgwxrJoDofHIqhDdzdW6OWKud4rVl/KdtnTmxXjbqamb73HhXBZuA=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig bad message', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDgwEAYHKoZIzj0CAQYFK4EEABcDJAAEBXsC0pF78Pkm+xbZ9O0jas4HcXpkaj3V\n\
Nj0rbU9Qdp3fUQ==\n\
-----END PUBLIC KEY-----",
			message: {data: "5a3b2275d4df38beacce80614ee742498cbeea4ce8fde0a36726e8c0edb464f"},
			signature: "MCUCEQJMpOatObfCwHqg9ibWp9ztAhAHL6DIq4sggDTG6B9SyFp5"
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig brainpoolP192r1 wrong sig', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEowFAYHKoZIzj0CAQYJKyQDAwIIAQEDAzIABBrPicyaJL113QhTutwGTUlZpvUN\n\
Xr4O+pCjIwdCf4ZWB5zm175REld05mCxw1WD7w==\n\
-----END PUBLIC KEY-----\n\
",
		message: "ifrRBpyCAppA4Q==",
		signature: "30340228436e84c604312ad267ef1768111ebdfe5f89774e254e3b8a02185638216092aa5ac464aa9b8d58ce58ac6d7c243641785f6f"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, false);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig wrong key length', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQIDMgAv/XMkZQAh6raybe5eUSZslEQHa2\n\
hF0aQX7GEzIUaf6U+tcCxH0vA98NJruvNSo6\n\
-----END PUBLIC KEY-----\n\
",
		message: "GrR8t8sUxWoZTA==",
		signature: "3035021900d6f10143fdd2663e607005e63946d3f8b06fc5506853b32502183f1b991abf1dd88b2be604db0439070eb190e663f3e0d4c2"}
	};

	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig null key', t => {
	var trigger = { data: 
	{
		pem_key: null,
		message: "GrR8t8sUxWoZTA==",
		signature: "3035021900d6f10143fdd2663e607005e63946d3f8b06fc5506853b32502183f1b991abf1dd88b2be604db0439070eb190e663f3e0d4c2"}
	};

	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig  null message', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFZysBBAcDKgAEuafrAVc0ym3lxXBCqIVkKasIwV0dErF9\n\
2w2aL5E2iCtWJiMBZPj1Xg==\n\
-----END PUBLIC KEY-----",
			message: null,
			signature: "MC0CFHRbtpr0eXsXyyDjZ4MCMt/IYqW5AhUA1WBkcg7hvusyTTnYChpy93P8JNA="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig null sig', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFZysBBAcDKgAEuafrAVc0ym3lxXBCqIVkKasIwV0dErF9\n\
2w2aL5E2iCtWJiMBZPj1Xg==\n\
-----END PUBLIC KEY-----",
			message: "6bd95527ec489fc85fcc50c1e2de9576cd590e8b334283b2ac8007761f65321f",
			signature: null
		}
	};
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('sign message with brainpoolP160r1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEIwFAYHKoZIzj0CAQYJKyQDAwIIAQEBAyoABFnaKe/9gUiP7kmnq86iGFQN5kXP\n\
dsX7gtJq81qwr9o3A3OQvhdRkt4=\n\
-----END PUBLIC KEY-----",
				message: "P951kKJ14x5O7Q==",
				signature: ecdsaSig.signMessageWithPemPrivKey("P951kKJ14x5O7Q==","-----BEGIN EC PRIVATE KEY-----\n\
MFQCAQEEFNzyc6dCke0GhI2ucAadDnCDaT1uoAsGCSskAwMCCAEBAaEsAyoABFna\n\
Ke/9gUiP7kmnq86iGFQN5kXPdsX7gtJq81qwr9o3A3OQvhdRkt4=\n\
-----END EC PRIVATE KEY-----\n\
")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with brainpoolP160t1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEIwFAYHKoZIzj0CAQYJKyQDAwIIAQECAyoABKexMvkPqvL6pv4nOBR8RKqpYCbx\n\
pzL02uF+qXAijKUfhnod6cVzZyI=\n\
-----END PUBLIC KEY-----\n\
",
				message: "zPUBWinJhyNOEQ==",
				signature: ecdsaSig.signMessageWithPemPrivKey("zPUBWinJhyNOEQ==","-----BEGIN EC PRIVATE KEY-----\n\
MFQCAQEEFAlZ5apMPrIdbuf5mXGF6Ii+5hHvoAsGCSskAwMCCAEBAqEsAyoABKex\n\
MvkPqvL6pv4nOBR8RKqpYCbxpzL02uF+qXAijKUfhnod6cVzZyI=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with brainpoolP192r1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEowFAYHKoZIzj0CAQYJKyQDAwIIAQEDAzIABEhl92YIRKzy7hvtkCJJ5rha/V6A\n\
KZ8r0JRPfbh+zFZ/X/RPDip3oWjTQnvpIkg77Q==\n\
-----END PUBLIC KEY-----",
				message: "rG3+h/T0mwQcbQ==",
				signature: ecdsaSig.signMessageWithPemPrivKey("rG3+h/T0mwQcbQ==","-----BEGIN EC PRIVATE KEY-----\n\
MGACAQEEGBCj91wTucIqOq94t5NLOLCE77LP99kB76ALBgkrJAMDAggBAQOhNAMy\n\
AARIZfdmCESs8u4b7ZAiSea4Wv1egCmfK9CUT324fsxWf1/0Tw4qd6Fo00J76SJI\n\
O+0=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with brainpoolP192t1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEowFAYHKoZIzj0CAQYJKyQDAwIIAQEEAzIABHxDJOxXr8BQzILUU08wZRNLbd2j\n\
R8tCDzmE/EUKT4isbH3stl9XbPa1wn3o5eMk4w==\n\
-----END PUBLIC KEY-----",
				message: "rsMMMjPmpj78dA==",
				signature: ecdsaSig.signMessageWithPemPrivKey("rsMMMjPmpj78dA==","-----BEGIN EC PRIVATE KEY-----\n\
MGACAQEEGA69Y41/g1Z52Pu2Ft1ew7pidsIJzLm7OaALBgkrJAMDAggBAQShNAMy\n\
AAR8QyTsV6/AUMyC1FNPMGUTS23do0fLQg85hPxFCk+IrGx97LZfV2z2tcJ96OXj\n\
JOM=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with brainpoolP224r1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFIwFAYHKoZIzj0CAQYJKyQDAwIIAQEFAzoABMwKiFUoRiASBZd10FfIbQkx6X8W\n\
LbsqQ1gvRYY+5aYG/NR7w0C8X54MVO46bAiLSga+JIzQUiOg\n\
-----END PUBLIC KEY-----",
				message: "WI+nO8zTv/4i7A==",
				signature: ecdsaSig.signMessageWithPemPrivKey("WI+nO8zTv/4i7A==","-----BEGIN EC PRIVATE KEY-----\n\
MGwCAQEEHHmHoXMh8XBVrGrMRhgHiFxDTWYe+Lh9Iw5bYKmgCwYJKyQDAwIIAQEF\n\
oTwDOgAEzAqIVShGIBIFl3XQV8htCTHpfxYtuypDWC9Fhj7lpgb81HvDQLxfngxU\n\
7jpsCItKBr4kjNBSI6A=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with brainpoolP224t1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFIwFAYHKoZIzj0CAQYJKyQDAwIIAQEGAzoABGjnhJGfw3fHAOARjzcZMg1RAGcN\n\
L+WIYiwaubQ4HtYKeorB8qpb1gXaLb1Z+XXPfQM4ULBzZ9tg\n\
-----END PUBLIC KEY-----",
				message: "qfBoh08KLefyog==",
				signature: ecdsaSig.signMessageWithPemPrivKey("qfBoh08KLefyog==","-----BEGIN EC PRIVATE KEY-----\n\
MGwCAQEEHHBk4o+HSv3W9vfja6EDJXOzL84wMRLqGnStMMmgCwYJKyQDAwIIAQEG\n\
oTwDOgAEaOeEkZ/Dd8cA4BGPNxkyDVEAZw0v5YhiLBq5tDge1gp6isHyqlvWBdot\n\
vVn5dc99AzhQsHNn22A=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with brainpoolP256r1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFowFAYHKoZIzj0CAQYJKyQDAwIIAQEHA0IABBVx5WUJX1vbRd8bxrYbbkr5DVh+\n\
TzFiur/Cqc0qTIm9GO5QUld2+tqWqGA/eCbTv2U4dqLcMS+dbHkftzU5IHs=\n\
-----END PUBLIC KEY-----",
				message: "lFHZncTgWOgt9w==",
				signature: ecdsaSig.signMessageWithPemPrivKey("lFHZncTgWOgt9w==","-----BEGIN EC PRIVATE KEY-----\n\
MHgCAQEEIE1+FxGZbwXOvm4qZtqqJ13tct6YU+aeVwpW4ujUUTimoAsGCSskAwMC\n\
CAEBB6FEA0IABBVx5WUJX1vbRd8bxrYbbkr5DVh+TzFiur/Cqc0qTIm9GO5QUld2\n\
+tqWqGA/eCbTv2U4dqLcMS+dbHkftzU5IHs=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with brainpoolP256t1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFowFAYHKoZIzj0CAQYJKyQDAwIIAQEIA0IABAaGHi+UThhmfE3k0LBbSat/fZGP\n\
E7oh5jCD6ErYtp8oddIIck1ryEU/Yjk6pB6gOTuD5akpqOg5SCJom0GpP9Y=\n\
-----END PUBLIC KEY-----",
				message: "6Wn6XpqsTTqHcw==",
				signature: ecdsaSig.signMessageWithPemPrivKey("6Wn6XpqsTTqHcw==","-----BEGIN EC PRIVATE KEY-----\n\
MHgCAQEEICo5ipF78+V61XdlJs0ll21MSEEPhVwXIFGkSqo09BszoAsGCSskAwMC\n\
CAEBCKFEA0IABAaGHi+UThhmfE3k0LBbSat/fZGPE7oh5jCD6ErYtp8oddIIck1r\n\
yEU/Yjk6pB6gOTuD5akpqOg5SCJom0GpP9Y=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with prime192v1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQEDMgAECk+a+Nc76d8ir3nlL15MA58H9ubH\n\
AQMkVCkkk4VApnU4JbfSZwBecMIXYQPdNti7\n\
-----END PUBLIC KEY-----",
				message: "bu/BChQKxK59Ow==",
				signature: ecdsaSig.signMessageWithPemPrivKey("bu/BChQKxK59Ow==","-----BEGIN EC PRIVATE KEY-----\n\
MF8CAQEEGAntpQZlpZFK5TY4qY+y7nI4JDdcSdU4u6AKBggqhkjOPQMBAaE0AzIA\n\
BApPmvjXO+nfIq955S9eTAOfB/bmxwEDJFQpJJOFQKZ1OCW30mcAXnDCF2ED3TbY\n\
uw==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with prime192v2', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQIDMgAE+cdmDQMfo0cDKxgMb4SmRNRVPTmu\n\
zrD/csOZa8imuV8EI1sgXxHmYbGVLd2CYHAX\n\
-----END PUBLIC KEY-----",
				message: "j/+vyqkq3j/uHA==",
				signature: ecdsaSig.signMessageWithPemPrivKey("j/+vyqkq3j/uHA==","-----BEGIN EC PRIVATE KEY-----\n\
MF8CAQEEGDp4GFvvPaVsmRx+k55cfTasmBfN4MGqnaAKBggqhkjOPQMBAqE0AzIA\n\
BPnHZg0DH6NHAysYDG+EpkTUVT05rs6w/3LDmWvIprlfBCNbIF8R5mGxlS3dgmBw\n\
Fw==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with prime192v3', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEkwEwYHKoZIzj0CAQYIKoZIzj0DAQMDMgAElIDRb7/SJoeiaX7I+Z3X+CKSeMiA\n\
/Yze7I+nVquw1PGotTCK1np8A9d7HPeZdmDm\n\
-----END PUBLIC KEY-----",
				message: "mjby08qYqOJPwQ==",
				signature: ecdsaSig.signMessageWithPemPrivKey("mjby08qYqOJPwQ==","-----BEGIN EC PRIVATE KEY-----\n\
MF8CAQEEGIQK7Gg2jqAoPcyfcUD88Jbgzb3PFZ2MUqAKBggqhkjOPQMBA6E0AzIA\n\
BJSA0W+/0iaHoml+yPmd1/giknjIgP2M3uyPp1arsNTxqLUwitZ6fAPXexz3mXZg\n\
5g==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with prime239v1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFUwEwYHKoZIzj0CAQYIKoZIzj0DAQQDPgAEIf2VE8RvqbKniwTWZFWQARZeD/99\n\
0jRHiNoSlDc5Hjx76Gel0Y68sjbspv4vX6pbVIxhtjj83M18Jbsr\n\
-----END PUBLIC KEY-----",
				message: "uCwwuuTM//mADA==",
				signature: ecdsaSig.signMessageWithPemPrivKey("uCwwuuTM//mADA==","-----BEGIN EC PRIVATE KEY-----\n\
MHECAQEEHlUo688ZTyjgACeo7+dkLb0jZRVn2Wjw0PDxNZ0jdKAKBggqhkjOPQMB\n\
BKFAAz4ABCH9lRPEb6myp4sE1mRVkAEWXg//fdI0R4jaEpQ3OR48e+hnpdGOvLI2\n\
7Kb+L1+qW1SMYbY4/NzNfCW7Kw==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with prime239v2', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFUwEwYHKoZIzj0CAQYIKoZIzj0DAQUDPgAEGjv/thdrx+d49WfOIuzaG5qcvCLv\n\
jLh6QyHuOMPFGUGdGzqpIy4dJzzrOKRcte2k8/b6iAOqH7VvzaHt\n\
-----END PUBLIC KEY-----",
				message: "AeU3D0LpW3SMvA==",
				signature: ecdsaSig.signMessageWithPemPrivKey("AeU3D0LpW3SMvA==","-----BEGIN EC PRIVATE KEY-----\n\
MHECAQEEHlQK7XxuDXlQfRLIO2eX5S34esRx5YRaRG1NC827H6AKBggqhkjOPQMB\n\
BaFAAz4ABBo7/7YXa8fnePVnziLs2huanLwi74y4ekMh7jjDxRlBnRs6qSMuHSc8\n\
6zikXLXtpPP2+ogDqh+1b82h7Q==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with prime239v3', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFUwEwYHKoZIzj0CAQYIKoZIzj0DAQYDPgAESVfWwJ1+TVULyuVQ4TKTwSDEbYHY\n\
voMtjSnnEiR9IQSnjy5oWrfMYncSvFL+7ZYoofqNTJ9WkUSHTZRv\n\
-----END PUBLIC KEY-----",
				message: "GvTpKtMlArHf5g==",
				signature: ecdsaSig.signMessageWithPemPrivKey("GvTpKtMlArHf5g==","-----BEGIN EC PRIVATE KEY-----\n\
MHECAQEEHkySSJmr5TYs6Y0p75XClywzOaIPgiZp4rz7TYO3s6AKBggqhkjOPQMB\n\
BqFAAz4ABElX1sCdfk1VC8rlUOEyk8EgxG2B2L6DLY0p5xIkfSEEp48uaFq3zGJ3\n\
ErxS/u2WKKH6jUyfVpFEh02Ubw==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with prime256v1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESjc7uWTaaTKLPRVhCNw8/FGkIW3m\n\
w/u13SI8Tcq+tG58sYTXo6XqSEJO8f9+EA2QWxGX+hO5VTVUZ8g4PyYe9w==\n\
-----END PUBLIC KEY-----",
				message: "OsJ1WYbqleP19Q==",
				signature: ecdsaSig.signMessageWithPemPrivKey("OsJ1WYbqleP19Q==","-----BEGIN EC PRIVATE KEY-----\n\
MHcCAQEEIFlnqtei6h4rQ99mW4hzB9l6VGuEKk/Xm9eVNVQ9cQw3oAoGCCqGSM49\n\
AwEHoUQDQgAESjc7uWTaaTKLPRVhCNw8/FGkIW3mw/u13SI8Tcq+tG58sYTXo6Xq\n\
SEJO8f9+EA2QWxGX+hO5VTVUZ8g4PyYe9w==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp112r1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDIwEAYHKoZIzj0CAQYFK4EEAAYDHgAEt8avrLvM1oPUMJABPF2wxjQIUifoJuch\n\
HuDfMA==\n\
-----END PUBLIC KEY-----",
				message: "SJOQV8cQaNJa8w==",
				signature: ecdsaSig.signMessageWithPemPrivKey("SJOQV8cQaNJa8w==","-----BEGIN EC PRIVATE KEY-----\n\
MD4CAQEEDjxHEMYZ5y2ughL6uU7XoAcGBSuBBAAGoSADHgAEt8avrLvM1oPUMJAB\n\
PF2wxjQIUifoJuchHuDfMA==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp112r2', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDIwEAYHKoZIzj0CAQYFK4EEAAcDHgAEYcVPzIZFm7lwjjYK0f1Oc+tw4eSn9Kqu\n\
tSZ/vw==\n\
-----END PUBLIC KEY-----",
				message: "V149vQJY7QhrBQ==",
				signature: ecdsaSig.signMessageWithPemPrivKey("V149vQJY7QhrBQ==","-----BEGIN EC PRIVATE KEY-----\n\
MD4CAQEEDhSv5IBto2+5e3Lvy5GVoAcGBSuBBAAHoSADHgAEYcVPzIZFm7lwjjYK\n\
0f1Oc+tw4eSn9KqutSZ/vw==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp128r1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDYwEAYHKoZIzj0CAQYFK4EEABwDIgAE58yGZ7w7GFJCgL7hyWTvC8aaHb/CtjdS\n\
y0YfKJXZ+OY=\n\
-----END PUBLIC KEY-----",
				message: "+HWnjTr4OBXsCw==",
				signature: ecdsaSig.signMessageWithPemPrivKey("+HWnjTr4OBXsCw==","-----BEGIN EC PRIVATE KEY-----\n\
MEQCAQEEEM9Dxiryj2BfHfZJEnaF56OgBwYFK4EEAByhJAMiAATnzIZnvDsYUkKA\n\
vuHJZO8Lxpodv8K2N1LLRh8oldn45g==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp128r2', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDYwEAYHKoZIzj0CAQYFK4EEAB0DIgAEW2AIxqUvKVutHmPng7GUr1ztAOtkeylP\n\
1fkRRPJJdBE=\n\
-----END PUBLIC KEY-----\n\
",
				message: "ZSxUNQm8kUg1Mg==",
				signature: ecdsaSig.signMessageWithPemPrivKey("ZSxUNQm8kUg1Mg==","-----BEGIN EC PRIVATE KEY-----\n\
MEQCAQEEECwRUefX+kOXlqsU035t1MqgBwYFK4EEAB2hJAMiAARbYAjGpS8pW60e\n\
Y+eDsZSvXO0A62R7KU/V+RFE8kl0EQ==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp160k1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFK4EEAAkDKgAEi3zQ+KFa7irEphVVgvQimETcepubZSTD\n\
z+lBkfnyZLGx+oPqQrugJw==\n\
-----END PUBLIC KEY-----",
				message: "w+n7Q+uC9isq+g==",
				signature: ecdsaSig.signMessageWithPemPrivKey("w+n7Q+uC9isq+g==","-----BEGIN EC PRIVATE KEY-----\n\
MFECAQEEFQBOmbCrnr0AVkS/bny3ZQRqwaUH76AHBgUrgQQACaEsAyoABIt80Pih\n\
Wu4qxKYVVYL0IphE3Hqbm2Ukw8/pQZH58mSxsfqD6kK7oCc=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp160r1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFK4EEAAgDKgAES1dAvFlycx/zkyt7S2s798fPyxcC+o0V\n\
2EpvstnYgNkBBEDux3Jo9A==\n\
-----END PUBLIC KEY-----",
				message: "IXLL456FZXZNIg==",
				signature: ecdsaSig.signMessageWithPemPrivKey("IXLL456FZXZNIg==","-----BEGIN EC PRIVATE KEY-----\n\
MFECAQEEFQAiUVh2vnM1+feCg4QLLfLUi/hNFKAHBgUrgQQACKEsAyoABEtXQLxZ\n\
cnMf85Mre0trO/fHz8sXAvqNFdhKb7LZ2IDZAQRA7sdyaPQ=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp160r2', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFK4EEAB4DKgAES983z8DP/kL8XJJnc5gUGvpm3hK88b0c\n\
G82Ope396dy3LzW/Svl5ZA==\n\
-----END PUBLIC KEY-----",
				message: "fmrsX+OMA3ayMQ==",
				signature: ecdsaSig.signMessageWithPemPrivKey("fmrsX+OMA3ayMQ==","-----BEGIN EC PRIVATE KEY-----\n\
MFECAQEEFQArISfTMTISV9Qqxj298ky4lhCOdaAHBgUrgQQAHqEsAyoABEvfN8/A\n\
z/5C/FySZ3OYFBr6Zt4SvPG9HBvNjqXt/encty81v0r5eWQ=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp192k1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MEYwEAYHKoZIzj0CAQYFK4EEAB8DMgAEU2ixhXRTKVY5mkRvQTg95P3VmX9c3zA+\n\
Z7ukxzPWB/to/ifJiSeGkxh8elsH0PMS\n\
-----END PUBLIC KEY-----",
				message: "ytp0cUsLIyp+Lw==",
				signature: ecdsaSig.signMessageWithPemPrivKey("ytp0cUsLIyp+Lw==","-----BEGIN EC PRIVATE KEY-----\n\
MFwCAQEEGL+duLTMkM7kD8m0Osl/L5F60940Gv3JrKAHBgUrgQQAH6E0AzIABFNo\n\
sYV0UylWOZpEb0E4PeT91Zl/XN8wPme7pMcz1gf7aP4nyYknhpMYfHpbB9DzEg==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp224k1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
ME4wEAYHKoZIzj0CAQYFK4EEACADOgAE3DLYkMEQQRw78B+0D4C+cyVomvOB++1m\n\
S4grpJd/xhXAhR5d5Uz7J8Z9BoJtX9hx9d/AV1hi9qw=\n\
-----END PUBLIC KEY-----",
				message: "8YBUoJ5tYNjUYw==",
				signature: ecdsaSig.signMessageWithPemPrivKey("8YBUoJ5tYNjUYw==","-----BEGIN EC PRIVATE KEY-----\n\
MGkCAQEEHQDo/ZH/afEh5psKHjJIFyvpIAw+/OO/dqXCVgR3oAcGBSuBBAAgoTwD\n\
OgAE3DLYkMEQQRw78B+0D4C+cyVomvOB++1mS4grpJd/xhXAhR5d5Uz7J8Z9BoJt\n\
X9hx9d/AV1hi9qw=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp224r1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
ME4wEAYHKoZIzj0CAQYFK4EEACEDOgAE3rs9juTaPZGfGVYXuagvE4SYuBt69UgA\n\
HzKT3Q96Xs310tGwCSqfXhHmJiSuy+r5SX9Cg/Nx0XM=\n\
-----END PUBLIC KEY-----",
				message: "bOi+O5CaYSRy3A==",
				signature: ecdsaSig.signMessageWithPemPrivKey("bOi+O5CaYSRy3A==","-----BEGIN EC PRIVATE KEY-----\n\
MGgCAQEEHFCh5y4awaHiHmbespwaK7+/+fe6WD9M9ZWqsEygBwYFK4EEACGhPAM6\n\
AATeuz2O5No9kZ8ZVhe5qC8ThJi4G3r1SAAfMpPdD3pezfXS0bAJKp9eEeYmJK7L\n\
6vlJf0KD83HRcw==\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp256k1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEy0Qk1KKfeFo7uLGhWKrjB7nS1A/hlruy\n\
ZYQWvg4QIcOLSNKybwWOetAQ2n/RpGQ+s1IRrDqH0CbreueCYwrvhQ==\n\
-----END PUBLIC KEY-----\n\
",
				message: "i/2GHsVLuPMS1A==",
				signature: ecdsaSig.signMessageWithPemPrivKey("i/2GHsVLuPMS1A==","-----BEGIN EC PRIVATE KEY-----\n\
MHQCAQEEIGlXxOl6x+QE+bISiZ62J3+FpAFExGghr0LJAfNbYu/eoAcGBSuBBAAK\n\
oUQDQgAEy0Qk1KKfeFo7uLGhWKrjB7nS1A/hlruyZYQWvg4QIcOLSNKybwWOetAQ\n\
2n/RpGQ+s1IRrDqH0CbreueCYwrvhQ==\n\
-----END EC PRIVATE KEY-----\n\
")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with secp384r1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAEzruTS/AoP5orVaYNq+9HU5+DTFNy260/\n\
RkYA0TA6hnv6MRTG3JDqvf2Ej34CnXkyia3c/OiLVQ5Eyf6DwgZLns0jxSUKG08r\n\
GKigipJvGEcrsG4q/2B+ahkWG4x9x/KE\n\
-----END PUBLIC KEY-----",
				message: "RITUW1Lyy+Nd5g==",
				signature: ecdsaSig.signMessageWithPemPrivKey("RITUW1Lyy+Nd5g==","-----BEGIN EC PRIVATE KEY-----\n\
MIGkAgEBBDCXu+sSLLS/bdSf7d+awNK9QJgfWTS2DKixt2LI1vbby1bWYpYDfpY1\n\
68AsOQZ/j2WgBwYFK4EEACKhZANiAATOu5NL8Cg/mitVpg2r70dTn4NMU3LbrT9G\n\
RgDRMDqGe/oxFMbckOq9/YSPfgKdeTKJrdz86ItVDkTJ/oPCBkuezSPFJQobTysY\n\
qKCKkm8YRyuwbir/YH5qGRYbjH3H8oQ=\n\
-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with sect113r1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDQwEAYHKoZIzj0CAQYFK4EEAAQDIAAEAfCq6/h+u9Jr+xJfRJHxAfDm5yidT0Nu\n\
A5f6BdUL\n\
-----END PUBLIC KEY-----",
				message: "YEHGB6+1GhV7+w==",
				signature: ecdsaSig.signMessageWithPemPrivKey("YEHGB6+1GhV7+w==","-----BEGIN EC PRIVATE KEY-----MEECAQEEDwBN3++mR4p6tyUvFV4j46AHBgUrgQQABKEiAyAABAHwquv4frvSa/sSX0SR8QHw5uconU9DbgOX+gXVCw==-----END EC PRIVATE KEY-----")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with sect113r2', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDQwEAYHKoZIzj0CAQYFK4EEAAUDIAAEABaNnvMnG030iracJQorAdYPDlEYJNcL\n\
Ek1y55kZ\n\
-----END PUBLIC KEY-----\n\
",
				message: "4LB1rkIVESVHwA==",
				signature: ecdsaSig.signMessageWithPemPrivKey("4LB1rkIVESVHwA==","-----BEGIN EC PRIVATE KEY-----\n\
MEECAQEEDwAEhQKL1UGiRfRjL99JF6AHBgUrgQQABaEiAyAABAAWjZ7zJxtN9Iq2\n\
nCUKKwHWDw5RGCTXCxJNcueZGQ==\n\
-----END EC PRIVATE KEY-----\n\
")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with sect131r1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDgwEAYHKoZIzj0CAQYFK4EEABYDJAAEBOSQ+aUY98NF1MGofMa95+MAItKsMs/o\n\
zSjFjE9ybpRo+w==\n\
-----END PUBLIC KEY-----\n\
",
				message: "mpZy1ydEz/g7fQ==",
				signature: ecdsaSig.signMessageWithPemPrivKey("mpZy1ydEz/g7fQ==","-----BEGIN EC PRIVATE KEY-----\n\
MEcCAQEEEQI6aiidxX6Md5bBPfFtR+9MoAcGBSuBBAAWoSYDJAAEBOSQ+aUY98NF\n\
1MGofMa95+MAItKsMs/ozSjFjE9ybpRo+w==\n\
-----END EC PRIVATE KEY-----\n\
")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with sect131r2', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDgwEAYHKoZIzj0CAQYFK4EEABcDJAAEB+Hctkiru2DRYvYaQ8xGjRIFXDpwq8TC\n\
nYu/i1GmfiDQFg==\n\
-----END PUBLIC KEY-----\n\
",
				message: "QNqq1iOGVGIaIw==",
				signature: ecdsaSig.signMessageWithPemPrivKey("QNqq1iOGVGIaIw==","-----BEGIN EC PRIVATE KEY-----\n\
MEcCAQEEEQIaAZ/6tm/GTnH0F8fMPDeCoAcGBSuBBAAXoSYDJAAEB+Hctkiru2DR\n\
YvYaQ8xGjRIFXDpwq8TCnYu/i1GmfiDQFg==\n\
-----END EC PRIVATE KEY-----\n\
")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with wap-wsg-idm-ecid-wtls1', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDQwEAYHKoZIzj0CAQYFZysBBAEDIAAEAYZx7u5OU1KJte22Z0YLAXp/dIWIsso2\n\
+5qPCmRX\n\
-----END PUBLIC KEY-----\n\
",
				message: "WrKWkvIe2KHFKA==",
				signature: ecdsaSig.signMessageWithPemPrivKey("WrKWkvIe2KHFKA==","-----BEGIN EC PRIVATE KEY-----\n\
MEACAQEEDifylqCGRzs3hQzUpf1ioAcGBWcrAQQBoSIDIAAEAYZx7u5OU1KJte22\n\
Z0YLAXp/dIWIsso2+5qPCmRX\n\
-----END EC PRIVATE KEY-----\n\
")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with wap-wsg-idm-ecid-wtls4', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDQwEAYHKoZIzj0CAQYFZysBBAQDIAAEAI2QWRCsLqFAv69KYa6tAHyAv8tyvW3e\n\
cDFB3ROd\n\
-----END PUBLIC KEY-----\n\
",
				message: "JjCugnQ9d0gDkw==",
				signature: ecdsaSig.signMessageWithPemPrivKey("JjCugnQ9d0gDkw==","-----BEGIN EC PRIVATE KEY-----\n\
MEECAQEEDwCWF13YXcQJBf8nYoUAWaAHB            gVnKwEEBKEiAyAABACNkFkQrC6hQL+v\n\
SmGurQB8gL/Lcr1t3nAxQd     				0TnQ==\n\
-----END EC PRIVATE KEY-----\n\
")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with wap-wsg-idm-ecid-wtls6', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDIwEAYHKoZIzj0CAQYFZysBBAYDHgAEhr2YFSHSex0hNQfmQqtl6jIs3JUgrlRY\n\
IqHtwA==\n\
-----END PUBLIC KEY-----\n\
",
				message: "jPNJdo1VQMVEaQ==",
				signature: ecdsaSig.signMessageWithPemPrivKey("jPNJdo1VQMVEaQ==","-----BEGIN EC PRIVATE KEY-----\n\
MD4CAQEEDgbLNazQhGyCVoAwpC+RoAcGBWcrAQQGoSADHgAEhr2YFSHSex0hNQfm\n\
Qqtl6jIs3JUgrlRYIqHtwA==\n\
-----END EC PRIVATE KEY-----\n\
")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with wap-wsg-idm-ecid-wtls7', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFZysBBAcDKgAEX9kAHmzNraEA1GVy28+dMpOa5HFvdJb3\n\
ihXK/JlCOPpJFxCrK99MDQ==\n\
-----END PUBLIC KEY-----\n\
",
				message: "22b+Sy2xvG0RXQ==",
				signature: ecdsaSig.signMessageWithPemPrivKey("22b+Sy2xvG0RXQ==","-----BEGIN EC PRIVATE KEY-----\n\
MFECAQEEFQAfZqOV4DDHPSHQ4AkW+LjHMJ7x96AHBgVnKwEEB6EsAyoABF/ZAB5s\n\
za2hANRlctvPnTKTmuRxb3SW94oVyvyZQjj6SRcQqyvfTA0=\n\
-----END EC PRIVATE KEY-----\n\
")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with wap-wsg-idm-ecid-wtls8', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MDIwEAYHKoZIzj0CAQYFZysBBAgDHgAETK8rJC2FGQVpyoUDFoEji/3Y6LilTdaz\n\
TdebqA==\n\
-----END PUBLIC KEY-----\n\
",
				message: "efTLqoi+pC0Fbw==",
				signature: ecdsaSig.signMessageWithPemPrivKey("efTLqoi+pC0Fbw==","-----BEGIN EC PRIVATE KEY-----\n\
MD8CAQEEDwDBBlwtuuA29sataZjDXaAHBgVnKwEECKEgAx4ABEyvKyQthRkFacqF\n\
AxaBI4v92Oi4pU3Ws03Xm6g=\n\
-----END EC PRIVATE KEY-----\n\
")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});
test.cb('sign message with wap-wsg-idm-ecid-wtls9', t => {
	var trigger = {
		data: 
			{
				pem_key: "-----BEGIN PUBLIC KEY-----\n\
MD4wEAYHKoZIzj0CAQYFZysBBAkDKgAE7Ztnu8Z4x/SpZaJVFU8LIoidOl1ABZzL\n\
artOrKBvnfjmZJPRCNRXDA==\n\
-----END PUBLIC KEY-----\n\
",
				message: "cUfEcKX5l2rO8w==",
				signature: ecdsaSig.signMessageWithPemPrivKey("cUfEcKX5l2rO8w==","-----BEGIN EC PRIVATE KEY-----\n\
MFECAQEEFQA2IZUNqctaMdZhyFuGcDjeoYqbc6AHBgVnKwEECaEsAyoABO2bZ7vGeMf0qWWiVRVPCyKInTpdQAWcy2q7Tqygb5345mST0QjUVww=\n\
-----END EC PRIVATE KEY-----\n\
")
			}
	};
	t.deepEqual(!!trigger.data.signature, true);
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('sign message bad key 1', t => {
	var signature = ecdsaSig.signMessageWithPemPrivKey("22b+Sy2xvG0RXQ==","-----BEGIN EC RIVATE KEY-----\n\
MFECAQEEFQAfZqOV4DDHPSHQ4AkW+LjHMJ7x96AHBgVnKwEEB6EsAyoABF/ZAB5s\n\
za2hANRlctvPnTKTmuRxb3SW94oVyvyZQjj6SRcQqyvfTA0=\n\
-----END EC PRIVATE KEY-----\n\
")
	t.deepEqual(signature, null);
	t.end();
});

test.cb('sign message bad key 2', t => {
	var signature = ecdsaSig.signMessageWithPemPrivKey("22b+Sy2xvG0RXQ==","-----BEGIN EC PRIVATE KEY-----\n\
MFECAQEEFQAfZqOV4DDHPSHQ4AkW+LjHMJ7!96AHBgVnKwEEB6EsAyoABF/ZAB5s\n\
za2hANRlctvPnTKTmuRxb3SW94oVyvyZQjj6SRcQqyvfTA0=\n\
-----END EC PRIVATE KEY-----\n\
")
	t.deepEqual(signature, null);
	t.end();
});


