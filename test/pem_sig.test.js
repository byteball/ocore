var path = require('path');
var asymSig = require('../signature.js');
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
	}]
};


test.after.always(t => {
	console.log('***** pem_sig.test done');
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

test.cb('is_valid_sig RSA 512 bits', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBANOJ1Y6/6uzcHDa7Q1gLO9z0KGOM51sO\n\
			Pc2nfBF4RTobSVVpFnWtZF92r8iWCebwgSRSS9dEX6YIMIWNg11LbQ8CAwEAAQ==\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "nzGFl7hkdz0TGS+QsN4LPbws1Ire1zdZQx/z1o1RrbR9KJ7YiQMoaSv0oW8Unz4VGunAlYIMuS4DqYoGfPwDcg=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 700 bits', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MHMwDQYJKoZIhvcNAQEBBQADYgAwXwJYDFoRKRkIqYRLtowxgBCrrS92DpoeTcnq\n\
			UOi3ixzFxhWrQ2q64LYiczp6ESHAy1DI9p8LWjMmhMpW6kIIRGPiE6txmzbCJmIy\n\
			kvSqAQ+617L1TejNZYpTAQIDAQAB\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "A8PSEg4KkDHhUmSBwXtMG1sXc8dPmSK+ls85+MM+utTwKuDZKCjH0jHIArLGoQS1/enf1sqduu+0GbHgz2AZCx+knMM/pqZ0RvJwAJqpk0fjaGqcDf7tXw=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 1024 bits', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7H5vd63m4dbcZck+axekZeAIp\n\
			cl+ozwQPyAYfvGOuDbjulLSiqqCcBuSbGbXJ2BNO9aEZSNESEOJkrhUo48tXLaLo\n\
			x4FhDyV0Qzr6RoHF6QU5gfaUJw76IZD5aHD5rBj2fEx2H8KuA2vJMC9MVpQoaLu/\n\
			iV6XBD2GYqzpyEz8oQIDAQAB\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "uqgkmILRk+zZK+nQ9z93Hd0yDIV2jPOeWt7VrY6s/ve5P3lzRc6ylELyS8V4G3+0PYC9mPRVwr5SeXIq3z5YPlx5Q+Y7l/0KHFSikNFMbJpGYtsgFjs4KLyo1J8md0J5sJw11cZLmHKO+hZYucGbZHYxcNvMCaJGjbGSPBsqtV0="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 1024 bits publicExponent 17', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIGdMA0GCSqGSIb3DQEBAQUAA4GLADCBhwKBgQCzF0auj8p6VEADxTwZL/l5KiH7\n\
			eGDPKuvH2Hzz/0AzYadyh8phYI+S+Hth5h01Wvk/Mem7T8uSpJPwI/moYQTG8v7k\n\
			UdN2orOKeNUxi1ONa1KopmLCztGdmNTqEkrPoDC2F/RH0UWpcN8KcKDAmyz7v+hA\n\
			1oeFagTjQM4BMYe2NwIBEQ==\n\
			-----END PUBLIC KEY-----",
			message: "zouplaboom",
			signature: "PcbwcsAKrI5IuPxihtrUliyjynELvzZLWGUuEAvGVlP3ugKJ7XEDDhgwaxgbU55UFppd4a9zsGvAlunFfLmrZqHR5AwpxN0HZz18bhHYgld7tb16JF1rnzcyVkqBkQhYekF6KVkQ8qfRUkpJt7bkFH4YX8xcncMXYGotV5dYc6g="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 1500 bits', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIHaMA0GCSqGSIb3DQEBAQUAA4HIADCBxAKBvA0UcxwIUHyMIyzjCgXDIMCl/s+s\n\
			F2k0uNaUpI9wkJY/mBlSLyG6wdtDK8uqt7PX78uM6kst42Aop9v2EwhFRgYTB5VV\n\
			KKmmQRFbVTtDkrAT5LFFBUYyqI4ZAAzkwuaPWvkOuiFIDNPOEwfb+lhiI0QqgBYt\n\
			s8nlRAkAD3aBUuOICYsZXku7Qo4R18YaUdQWmtPwzTmJjLiCVHrcmyEo5iQBQ+6m\n\
			EQpBjJStf/z7R3Q+VUiaQAFHVhZjI8npAgMBAAE=\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "Aj866wdAsRojMLJ7yU031r0ltFARoCQgF2TRNBJsfRPuTrGsa0nXEDaNA6bnXzEnWuoz8/rA7E8Ezn2qrCyiOhvucs9IJVSQCFwNu6w7EvaXy65prfYbjODY6YkC1z4UP7eGocHl1EgvTlludvRp0KK+cKI+1J9voY3LfpQwh+aL292pImhQX0AGmk2BhUrgGMUCraVsQaJxkarkpf65pdMrz1Q0MWsIgxkJ+DabwqyE+UwKJqHqj0sa/Co="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 2048 bits', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqJJbtLz0lLTgxcZX8xyJ\n\
			zzPBeLNnxfLYXrDo3eFO2j7yGR3YYF1L5LDEiPDBzH9cWscc4h1GKdjKQe4diB7T\n\
			AKinZEVojaad7o7kxAHHGcK0fsJH3pBgvVNRcTPi0WsuQtjxV8N+A26nFEVY4hJH\n\
			dOAJ3oEuZB13IhXQE+OrjEF6AXEY8vQaVran1D1Na1QMAk0oConXKMBCcqU2cfrv\n\
			OT8HtOnrlu9sB2IZ5Mnyur2yPyQilAT47CVqbNlxdE+E2tlOwewswVFacpkjgMI8\n\
			Ls/TScxkS++BxCbans5UrlwwmdD+i0mdbdu8gjNeF+HNt6OTLBPvTJjaaqX99E2Q\n\
			GQIDAQAB\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "VY+yGr7Pag6ODBbiMn9xBu+42MNPnQzjTDXF00tqbOPMC+PkW4ozJrHwsADgyScqY5N/eTelC8fCPMRIELKKDZPVhD6sN4kR6v48yQtdmVAX/ogqB0mHcuT1Fyw4rPQcTHzXa3TWaaR6LBXJz83bD4x9p3aQ5CiYy0zCJ7tVtBGzMw6un6DZbDJCsJcWkxmDoMp9I/Kkrh5nfNgptHpqqzZLaCzaGBbychy22OtrTUkii1E/Bnel+qSD5dU908tZ1aXVWK9iqALH3FhnBVIMDGwqh1ymk2HWt+XaP9kuqaYWbyGqh9IB2C9pC09jsZ48vtGXbJVsrbEst8AP/a2lXg=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 2048 bits wrong sig', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqJJbtLz0lLTgxcZX8xyJ\n\
			zzPBeLNnxfLYXrDo3eFO2j7yGR3YYF1L5LDEiPDBzH9cWscc4h1GKdjKQe4diB7T\n\
			AKinZEVojaad7o7kxAHHGcK0fsJH3pBgvVNRcTPi0WsuQtjxV8N+A26nFEVY4hJH\n\
			dOAJ3oEuZB13IhXQE+OrjEF6AXEY8vQaVran1D1Na1QMAk0oConXKMBCcqU2cfrv\n\
			OT8HtOnrlu9sB2IZ5Mnyur2yPyQilAT47CVqbNlxdE+E2tlOwewswVFacpkjgMI8\n\
			Ls/TScxkS++BxCbans5UrlwwmdD+i0mdbdu8gjNeF+HNt6OTLBPvTJjaaqX99E2Q\n\
			GQIDAQAB\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "VY+yGr7Pag6ODBbiMn9xBu+42MNPnQzjTDXF00tqbOPMC+PkW4ozJrHwsADgySaqY5N/eTelC8fCPMRIELKKDZPVhD6sN4kR6v48yQtdmVAX/ogqB0mHcuT1Fyw4rPQcTHzXa3TWaaR6LBXJz83bD4x9p3aQ5CiYy0zCJ7tVtBGzMw6un6DZbDJCsJcWkxmDoMp9I/Kkrh5nfNgptHpqqzZLaCzaGBbychy22OtrTUkii1E/Bnel+qSD5dU908tZ1aXVWK9iqALH3FhnBVIMDGwqh1ymk2HWt+XaP9kuqaYWbyGqh9IB2C9pC09jsZ48vtGXbJVsrbEst8AP/a2lXg=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, false);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 4096 bits', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAvcrZ8rhIwBOE8I/aytpH\n\
			3wEe/KinFrCfRJrgvGV0kih9991EXpteciKUGGGc0hI4z04WgkYtudFctqSd6Fgs\n\
			peEjitD88GC9MtAVZzfjy6gpfb3z9WC2L6W3CiM009sK6djc2JPjIkISOLZ8IZ7K\n\
			/buWzvs/mQyvr2kF9TIbKrNiTO1xvpW36ET2CJ+Eba7WkFDgS2qnP47Csg14A2lh\n\
			oazgMEYwlFK029rectrqdBofMtlswBUcTNnkvVQbcgEXAnbs/p8EiTRQ2q2XQTB0\n\
			/r+KDpJZ1jnK7++jYvltdQ9VTNic/dZAkW89xN0LQ02YXCI0+TCUI4ERwFr/auzy\n\
			EpP3uQo56abKkEmg5pjrNR3uZ3NfyiZsr0PQIeAWmJCYPMZWxtbIUQLBxH8urC4e\n\
			AA5CisBJD5vNsJgpWWQ7PiI/lek3Po/BkhU1OhwJ9nrwoAvUsydv89R73AWgw79d\n\
			HFkOTQC1TZ42d1Tzt9kBE1Iclqk92dySzp5SZdm6GTYSf6pNhFPmqzUI6oWOte0Y\n\
			xWDGsqOZWIwnGMbARLn2DPU8Mtm7tqUBSWTs3O74b26ifY5MXsrt6wa+BtBVXKZh\n\
			X4WYcvM2Z1+Oyu6Hm9ed73vP8ur5msEmX41pajXHDBDpJxETodrb1L3N+pgeejuC\n\
			9MGph9Xy9M02OKy0tZYPwV8CAwEAAQ==\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "HkqmOotxKcKrt0CD9uUHlETHDNI4mYLugKyX6uB3oN5bYLlxKCcqeCXHxryZqPpjcK1YRK5WJU5iSSk9ZYtV81+BxemX5ganei39aifSKl1AEgcEBCHYelvry26xgi0UTgMzg+CntZD4ep5qTH/QWKcvumW4Xdggn5+Pn76W8ASe3usK+AZEcpqXziHIXq7zyCqxtcmT6t9QESndqHOowZcZG3FrGJQKpPIuPtl+AAweZW/W9IIfBUGOphwOgOkD60qh+LgPhj/KqmLaVDPLj030YCgv9596Y7gRX6tGsof/wtSx4Og0hohFfD5n3/R1IsDFLa47JNOJiuclJBX9R0JmNKkx/LBe2t9+3OJ+qcnPJLP122+szoY0QuJ7IEQnXsc0Q5ohUppaxgyp7S9gkD2PDz+szIImqEOSKTajiSRWgX3yzqPjbz/GRIBQDTJmGkuwVM71Fgf0HrzJWZhgl08mQG71WdUqGByuWP3DxUYuLm9kPi37CtgMpXW+pziJyUbE03xlWVe/eYUSNJh15JzHdHA6M7z+8diipFg4bP9RdyIg5kI7G78IiZruEJEMe5ct1bfQFokR9kAUfUeMPhMq498atSqpVq/LRioJx9nK1D0+d98VmS8hw1gN3XGQEn/0lYe5/DAnPPQfPj58UD8rqvtUUIUygPx491bSFm4="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 1024 bits hexa sig', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC/haO6RdT65vkuuKfW81stciW/\n\
			kunEovt7FeBrmxkj08s6FRpmBb1XM7yKvMRC6g2jpmRmdQ7ha6s9BsGmy/a2MpSU\n\
			NZsugh3cSMmgud+H/kovobBLLnO4LzQxT7uEabKtoYEZ5RAPVGmPlBq8Hu7fAWlt\n\
			XqGh2+GEJfp8uTj25QIDAQAB\n\
			-----END PUBLIC KEY-----\n\
			",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "7882daeaa0a5b193b94968c9d7e4d4da3b9d599f70c8fdb84d0045e5a5896d05dda6e3308401d171e822b6433933923c8499123f0f275e8d909677ff566a0dca06ba98ad7f5025d4f9056192a2e897aa8bf7026c3e7b0eb6436181a1bb6e3567e676023a93f87a90601445bb0b6509cf5d69fda8cd88a79d7d71e4bb8714f24a"
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA pem too large', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIICQjANBgkqhkiG9w0BAQEFAAOCAi8AMIICKgKCAiEAw0IdSxvhFpduaCcUcDS4\n\
			95oM7JJc1pA78UN8ZLwPMERbydh6mmrIMRe1jQD+jMZCGNcUduJSBPMADLy1tGES\n\
			hKleoz68UFs9p6VLbwWmo1n4slZzbtv01hk9H0UGw/cECZUljrEuHztBAKpXX7vp\n\
			lhWGHYCt+Yi4qBtwyx+QQIYbpDGnm42dXua14Z5Iw6OhdXo0RtIBzHfK9l+4ldtV\n\
			ILp8intVzaZc9h+m0Sd2Ek57Q6uhCMm47P7TBPAnzIKLAtkdpc0tMmYV0yORTZZ0\n\
			/Fk+PrsxnDdE7RUc/FHyDd+YTwZdP/IC7hy0g+fxDBHwjukq+V9/kLyW8Tx0ZU4Z\n\
			YByk2wa6SL6hdXQj6TB+t8Jg5zRwZ/CIkZloULmivpc+E4Y2yHeL+CMxpHtfWnmU\n\
			kopPzbhOXlDNJYhO32z31LpHK+cqR0cZy3oDvYmCa7XXdbao8IOd7dIKzR6Cz09o\n\
			ncnwFpRqNtq4vw4EmLrqRfJssfawi9m/wu26jFe3Tr9bptNFbHtcKhdihqlB7NtK\n\
			McX5/RkQRIITAT/7depm/zFK+LLJfj+AyAwWHyn832i2kteTbJBUmnmZSOHYMKMw\n\
			DuUXj0WaAC/5Z8oYUaLkxM5JERUIIdfGqatveegicYv8GaqQDkrWB0N73AF8IipH\n\
			CPogLltyiZ/m3T7zYLujEgZbdZBNvwE/F9FX855qGZ5FSJT02tEi+CFL//OgK2NB\n\
			7wIDAQAB\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "HkqmOotxKcKrt0CD9uUHlETHDNI4mYLugKyX6uB3oN5bYLlxKCcqeCXHxryZqPpjcK1YRK5WJU5iSSk9ZYtV81+BxemX5ganei39aifSKl1AEgcEBCHYelvry26xgi0UTgMzg+CntZD4ep5qTH/QWKcvumW4Xdggn5+Pn76W8ASe3usK+AZEcpqXziHIXq7zyCqxtcmT6t9QESndqHOowZcZG3FrGJQKpPIuPtl+AAweZW/W9IIfBUGOphwOgOkD60qh+LgPhj/KqmLaVDPLj030YCgv9596Y7gRX6tGsof/wtSx4Og0hohFfD5n3/R1IsDFLa47JNOJiuclJBX9R0JmNKkx/LBe2t9+3OJ+qcnPJLP122+szoY0QuJ7IEQnXsc0Q5ohUppaxgyp7S9gkD2PDz+szIImqEOSKTajiSRWgX3yzqPjbz/GRIBQDTJmGkuwVM71Fgf0HrzJWZhgl08mQG71WdUqGByuWP3DxUYuLm9kPi37CtgMpXW+pziJyUbE03xlWVe/eYUSNJh15JzHdHA6M7z+8diipFg4bP9RdyIg5kI7G78IiZruEJEMe5ct1bfQFokR9kAUfUeMPhMq498atSqpVq/LRioJx9nK1D0+d98VmS8hw1gN3XGQEn/0lYe5/DAnPPQfPj58UD8rqvtUUIUygPx491bSFm4="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA sig too large', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAniLSGrpD9GZIXKN9JoUN\n\
			BVuCx/wgkBbMwi2qN0VzAr14ZPPjpNz5LuJKfAzg6jVFMvQMEUf2uYqbxqCC2EHn\n\
			T2RmcU5DZC46IIli2JAs+qBLJ9U9FkR9/xyHUr6sckKbIG3lhdf/FBqBZkIMgVRD\n\
			dtG7qTjGimxiCTXQe016WvuWvdepI+fNwushCJ3GRQ4b7C6Gfgdzxb5KXDcLc7lz\n\
			38kX5FEjJFyKBCxjJxl/KIY0KPeqZLmmifrsmX5u0AXhmMtn9IrWpTu918MW348m\n\
			sD7MxngxFRG8tufcLpsqhLjlD4W7sOigjxw6F/0Iva6rcIWejKnA1L3rYWazkGpg\n\
			avjf0w5JJdz2Qj7Heiw+X7vNcbpxU0KvHE5tzYdBdFmND2x/FLFdw/LMtvWtMuhd\n\
			XbaXBmyUEw0Elk5/4YKb0Jiq7gZuhqUDHjc4z1um/f9cUmlvfq6jq4c8D4hm1/bl\n\
			6gL5376yVs1cGr14u3t3HEMkil0HIphwH0gFHKFfuQHrpF3SyJS940UzTE7+tqnq\n\
			2XZ0Si6isPCYqaxsDmVB9fjgAAgKg3hxewDSzZBsTg0pYGSyMtwLNmXNLLt7IrQ+\n\
			CRonN/C99wmir2doxHTU7cVCb/plOlQMdV4/VpT29VTZPkE7z7EpZ+NFR9XmlLWM\n\
			QMMJhuzyp8RjbxqWbPqKpSECAwEAAQ==\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "1687684e88876fe8fa3be350beb47a329dc7216aed0d7fc3c253a3383284d07a355735f7bcc9abfa2265d9ad7203548204bca66173431f02c1f75418391feb4066d92c10420c3a98ae56ba0bc80ecf456737719997c86a1dd3bc4c32ea5da193210741c4ce3c6ded57b3067ff96d6ebec3122897e18e6f1ce22a182f8270927dfd766bdd274c1066d2d7269766d009c9ead7b127b00d761e6bf5fd4bd73284ac3e99458e208f0e480c2f1b5d070691de0563dc6549e3daaa931c1b970de215f53cbdc9a795f49899116b13f2d1f0507486269e20183dccbdaf4942fe883ed568834d29608698bd999d0ef76a1afe4b338d8b76400a2201f37170327be1b9b3ad381c977c172f5c6e6da809a2fbd6bac70b99ef31971a2d51111a04011cddde513ca89db6b0dad25b09fa92d48bbddbcbb19e34728a5f4490e946ed1b8b4cf966196ded6407bd2710a1ca719123dd728284ee962a2a8af07c7fd1b5060fa021b45d173dc2fa9119fe5446e4512e1264eae6fcbc5d50c44d1e84ae4368b303220004bb79205c26d5975d122b1c6b037c89d98732a32b1cdbc3aa80c6cf322d8b67da0678ab4acd67472b6cefd70c0594ad15f78d13c27618bfbe4ef398259ef3a6259bb98d2294f6b39a0bea9ac383fdc487c6fde63979bb26fc3eafb6131b839cee6dc51dd2416307e3f67394b6d6f3d946409c6634c1276591b4d526a30ca31b14"
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});


test.cb('is_valid_sig RSA 512 bits wrong first sequence', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			QFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBANOJ1Y6/6uzcHDa7Q1gLO9z0KGOM51sOPc2nfBF4RTobSVVpFnWtZF92r8iWCebwgSRSS9dEX6YIMIWNg11LbQ8CAwEAAQ==\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "nzGFl7hkdz0TGS+QsN4LPbws1Ire1zdZQx/z1o1RrbR9KJ7YiQMoaSv0oW8Unz4VGunAlYIMuS4DqYoGfPwDcg=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 512 bits wrong second sequence', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MFw3DQYJKoZIhvcNAQEBBQADSwAwSAJBANOJ1Y6/6uzcHDa7Q1gLO9z0KGOM51sOPc2nfBF4RTobSVVpFnWtZF92r8iWCebwgSRSS9dEX6YIMIWNg11LbQ8CAwEAAQ==\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "nzGFl7hkdz0TGS+QsN4LPbws1Ire1zdZQx/z1o1RrbR9KJ7YiQMoaSv0oW8Unz4VGunAlYIMuS4DqYoGfPwDcg=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 512 bits empty signature', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MFwwCAYJKoZIhvcNAQEBBQADSwAwSAJBANOJ1Y6/6uzcHDa7Q1gLO9z0KGOM51sOPc2nfBF4RTobSVVpFnWtZF92r8iWCebwgSRSS9dEX6YIMIWNg11LbQ8CAwEAAQ==\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: ""
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 512 bits wrong identifier length', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MFwwCAYJKoZIhvcNAQEBBQADSwAwSAJBANOJ1Y6/6uzcHDa7Q1gLO9z0KGOM51sOPc2nfBF4RTobSVVpFnWtZF92r8iWCebwgSRSS9dEX6YIMIWNg11LbQ8CAwEAAQ==\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "nzGFl7hkdz0TGS+QsN4LPbws1Ire1zdZQx/z1o1RrbR9KJ7YiQMoaSv0oW8Unz4VGunAlYIMuS4DqYoGfPwDcg=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 1024 bits wrong second sequence', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIGfMQ0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCtJFLVGiGAtvSLzLXTRzDlw4+WBvOpDFzK7wYTuuzVxGG/EdD0NiOMlzaaonpcUCBHGfDLHWJ2UTqTCKlpUXoZN+8zY1Id/gbCF68GS9mE05PO1ey3oZVdhNxxflSi1eh4Bz3W6xJ/4vXelaUOExei3UXj/jCWzBDE2ilIRAw1wIDAQA=\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "nzGFl7hkdz0TGS+QsN4LPbws1Ire1zdZQx/z1o1RrbR9KJ7YiQMoaSv0oW8Unz4VGunAlYIMuS4DqYoGfPwDcg=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 2048 bits wrong second sequence', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIIBIjUNBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsyIS32cADwBVq+BICLqwdc2FoamE8hAL605mo73ZiyoYLxjQIMGAUt4U0AVb2fR8IRli7drOUhUneLEOYQPtMRe2O9AdzCqZWdh5Vgyzmf3W98xNk2atKHn1JEG+1RgTmfqCr9CJZEWRG2FJTyVlrcXzNGXDcrvnNrva+1WRmCHbLJnZDTMUEHu31bHtY2Jh6uR3zBne6cYfzj4rD5nS1F/t5PHP32F/Jtl8vM8589g/4znkunpKIDVqR5HVFHy64WNzIWX4OW8FI6BUfNPrqY6RxFr5JD/0XJoNwKi23fsQmriZezOCsQHneQG+U9YuSW1+P0eKQ/yUTH+E98JuyQIDAQAB\n\
			-----END PUBLIC KEY-----",
			message: "44e8fd580c05c2ea8af20fbec3c83c6314baa7c05ec4e147fd21fd613eba73ce",
			signature: "nzGFl7hkdz0TGS+QsN4LPbws1Ire1zdZQx/z1o1RrbR9KJ7YiQMoaSv0oW8Unz4VGunAlYIMuS4DqYoGfPwDcg=="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('is_valid_sig RSA 1024 bits PSS padding (non-deterministic)', t => {
	var trigger = { data: 
		{
			pem_key: "-----BEGIN PUBLIC KEY-----\n\
			MIGdMA0GCSqGSIb3DQEBAQUAA4GLADCBhwKBgQDjnZCQWuJ9zg/ubzrQsqb4eBjt\n\
			A1qI4LGbq/4WAYVK/JgMGXbghuGlEpb9CX1N3wjlm90s5nS3oS5Dc9r0+5PDfMNP\n\
			Xkpm2solSSSQFOmkazacGmpgu1+0wnd55S1IOxlHMskWZ5qHaTeHWdgOOzbuh2or\n\
			oL8kV6HkeL2DGlDhBQIBEQ==\n\
			-----END PUBLIC KEY-----\n\
			",
			message: "zouplaboom",
			signature: "H12bUZND/vovbHzj3213sujVmlkTYCyeOh0J83bfQWR3IkpUY69DJaBciidppV1CgIDG+NKWi1xhcl6GA3YID/MKpAjhy1yOluDwjChg8Nur2LA5ipbIcSv5XKI86Rm7QPOpK6kEWxNKVK2S57eys58ZhCtPaw7lapkeYgaYRyk="
		}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "is_valid_sig(trigger.data.message, trigger.data.pem_key, trigger.data.signature)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, false);
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
				signature: asymSig.signMessageWithEcPemPrivKey("P951kKJ14x5O7Q==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("zPUBWinJhyNOEQ==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("rG3+h/T0mwQcbQ==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("rsMMMjPmpj78dA==",  null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("WI+nO8zTv/4i7A==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("qfBoh08KLefyog==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("lFHZncTgWOgt9w==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("6Wn6XpqsTTqHcw==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("bu/BChQKxK59Ow==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("j/+vyqkq3j/uHA==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("mjby08qYqOJPwQ==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("uCwwuuTM//mADA==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("AeU3D0LpW3SMvA==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("GvTpKtMlArHf5g==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("OsJ1WYbqleP19Q==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("SJOQV8cQaNJa8w==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("V149vQJY7QhrBQ==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("+HWnjTr4OBXsCw==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("ZSxUNQm8kUg1Mg==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("w+n7Q+uC9isq+g==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("IXLL456FZXZNIg==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("fmrsX+OMA3ayMQ==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("ytp0cUsLIyp+Lw==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("8YBUoJ5tYNjUYw==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("bOi+O5CaYSRy3A==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("i/2GHsVLuPMS1A==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("RITUW1Lyy+Nd5g==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("YEHGB6+1GhV7+w==", null, "-----BEGIN EC PRIVATE KEY-----MEECAQEEDwBN3++mR4p6tyUvFV4j46AHBgUrgQQABKEiAyAABAHwquv4frvSa/sSX0SR8QHw5uconU9DbgOX+gXVCw==-----END EC PRIVATE KEY-----")
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
				signature: asymSig.signMessageWithEcPemPrivKey("4LB1rkIVESVHwA==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("mpZy1ydEz/g7fQ==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("QNqq1iOGVGIaIw==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("WrKWkvIe2KHFKA==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("JjCugnQ9d0gDkw==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("jPNJdo1VQMVEaQ==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("22b+Sy2xvG0RXQ==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("efTLqoi+pC0Fbw==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
				signature: asymSig.signMessageWithEcPemPrivKey("cUfEcKX5l2rO8w==", null, "-----BEGIN EC PRIVATE KEY-----\n\
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
	var signature = asymSig.signMessageWithEcPemPrivKey("22b+Sy2xvG0RXQ==", null, "-----BEGIN EC RIVATE KEY-----\n\
MFECAQEEFQAfZqOV4DDHPSHQ4AkW+LjHMJ7x96AHBgVnKwEEB6EsAyoABF/ZAB5s\n\
za2hANRlctvPnTKTmuRxb3SW94oVyvyZQjj6SRcQqyvfTA0=\n\
-----END EC PRIVATE KEY-----\n\
")
	t.deepEqual(signature, null);
	t.end();
});

test.cb('sign message bad key 2', t => {
	var signature = asymSig.signMessageWithEcPemPrivKey("22b+Sy2xvG0RXQ==", null, "-----BEGIN EC PRIVATE KEY-----\n\
MFECAQEEFQAfZqOV4DDHPSHQ4AkW+LjHMJ7!96AHBgVnKwEEB6EsAyoABF/ZAB5s\n\
za2hANRlctvPnTKTmuRxb3SW94oVyvyZQjj6SRcQqyvfTA0=\n\
-----END EC PRIVATE KEY-----\n\
")
	t.deepEqual(signature, null);
	t.end();
});


test.cb('sign message with RSA 512 bits (deterministic)', t => {
	var signature = asymSig.signMessageWithRsaPemPrivKey("zouplaboom", null, "-----BEGIN RSA PRIVATE KEY-----\n\
	MIIBOgIBAAJBALpW4O8MZitz/kPWqqs0H/Rip69LH0a5isg2o7mFZJzirzmN2lA3\n\
	eWNfiNkW1o9RFOsjQ9NpBDj6XHgyOMMU9PECAwEAAQJAXSsTTHLmotNcTo8GxpNJ\n\
	Zufs77if6rzap0CqnBgWNlpG2YIPZqDO9ZmCtqZl4xxO8ynp74PFzu62kMP4nHcA\n\
	AQIhANq7vgLgKzlrB4djg75kOJNtWAC2IkHrcWIGg74EYSmdAiEA2hY+BZ6r1MuH\n\
	ENVA3xgUHV7ZiOprV6gf73K5Z/3UkmUCIHnpL9NMe+rps22LUo9YLoxE4kqrONbC\n\
	0hQPi3fp2vmlAiEAjHp9UxNlLfo4M3Cai9ovwseBKn+Ny3YBtDTbFxBbKD0CIA5s\n\
	8UgPeZrMh+R1uihikqny8p3KGeJopjerZ9IQpnN2\n\
	-----END RSA PRIVATE KEY-----\n\
")
	t.deepEqual(signature, "as2PhM4+/GfvWZjmH7y3S5ZDm0+mW2y2u2TSSq8Ty3l61GH/kB8gHNrRaezLyrW7PTjOHjJdl8EH7GQ7DrgXlQ==");
	t.end();
});

test.cb('sign message with RSA 512 bits (deterministic) base64', t => {
	var signature = asymSig.signMessageWithRsaPemPrivKey("zouplaboom", 'base64', "-----BEGIN RSA PRIVATE KEY-----\n\
	MIIBOgIBAAJBALpW4O8MZitz/kPWqqs0H/Rip69LH0a5isg2o7mFZJzirzmN2lA3\n\
	eWNfiNkW1o9RFOsjQ9NpBDj6XHgyOMMU9PECAwEAAQJAXSsTTHLmotNcTo8GxpNJ\n\
	Zufs77if6rzap0CqnBgWNlpG2YIPZqDO9ZmCtqZl4xxO8ynp74PFzu62kMP4nHcA\n\
	AQIhANq7vgLgKzlrB4djg75kOJNtWAC2IkHrcWIGg74EYSmdAiEA2hY+BZ6r1MuH\n\
	ENVA3xgUHV7ZiOprV6gf73K5Z/3UkmUCIHnpL9NMe+rps22LUo9YLoxE4kqrONbC\n\
	0hQPi3fp2vmlAiEAjHp9UxNlLfo4M3Cai9ovwseBKn+Ny3YBtDTbFxBbKD0CIA5s\n\
	8UgPeZrMh+R1uihikqny8p3KGeJopjerZ9IQpnN2\n\
	-----END RSA PRIVATE KEY-----\n\
")
	t.deepEqual(signature, "as2PhM4+/GfvWZjmH7y3S5ZDm0+mW2y2u2TSSq8Ty3l61GH/kB8gHNrRaezLyrW7PTjOHjJdl8EH7GQ7DrgXlQ==");
	t.end();
});


test.cb('sign message with RSA 512 bits (deterministic) hex', t => {
	var signature = asymSig.signMessageWithRsaPemPrivKey("zouplaboom", 'hex', "-----BEGIN RSA PRIVATE KEY-----\n\
	MIIBOgIBAAJBALpW4O8MZitz/kPWqqs0H/Rip69LH0a5isg2o7mFZJzirzmN2lA3\n\
	eWNfiNkW1o9RFOsjQ9NpBDj6XHgyOMMU9PECAwEAAQJAXSsTTHLmotNcTo8GxpNJ\n\
	Zufs77if6rzap0CqnBgWNlpG2YIPZqDO9ZmCtqZl4xxO8ynp74PFzu62kMP4nHcA\n\
	AQIhANq7vgLgKzlrB4djg75kOJNtWAC2IkHrcWIGg74EYSmdAiEA2hY+BZ6r1MuH\n\
	ENVA3xgUHV7ZiOprV6gf73K5Z/3UkmUCIHnpL9NMe+rps22LUo9YLoxE4kqrONbC\n\
	0hQPi3fp2vmlAiEAjHp9UxNlLfo4M3Cai9ovwseBKn+Ny3YBtDTbFxBbKD0CIA5s\n\
	8UgPeZrMh+R1uihikqny8p3KGeJopjerZ9IQpnN2\n\
	-----END RSA PRIVATE KEY-----\n\
")
	t.deepEqual(signature, "6acd8f84ce3efc67ef5998e61fbcb74b96439b4fa65b6cb6bb64d24aaf13cb797ad461ff901f201cdad169eccbcab5bb3d38ce1e325d97c107ec643b0eb81795");
	t.end();
});

test.cb('sign message with RSA 1024 bits (deterministic)', t => {
	var signature = asymSig.signMessageWithRsaPemPrivKey("zouplaboom", null, "-----BEGIN RSA PRIVATE KEY-----\n\
	MIICXQIBAAKBgQDgkqDUC9sneYkZ/lpSY4Ugsj8dfoMt4duj/Ng1KOaUB+kp1lDg\n\
	Kdzmmjv8VTaoEE1XsmNHxERM4vIZdhIJS2O5LjbdQl+KxCpvktjnjBODntQH7xn9\n\
	/CyRkd/Pn31uH8qRbPUcGOO58OBUTEZmpGaROMW2Odw0D9bDGja4crTrQQIDAQAB\n\
	AoGBAN4Ovu7NxmczGulUA7XB6GqbNiOQ7F9bHJb7tkJibhVj+R9AZvoxCtgPHE93\n\
	ZzMp44BaySa2oJ6yLZgVkuIT5MblMNbJmS10eUKm+S9yNe2F2hHIF+OrkCfOIjfY\n\
	bAx3k92RO+MiF2gHkwHoW3UZXGCBz8YL5Caxj6pD9WfPeEbNAkEA/n6VSNMIva1X\n\
	kngHSM+NQ+D3sJygveP7V5rQj3afpa1GotdKfgdIrHobdzSIX7+ej+rvAss+RkSN\n\
	kJoWGxWXJwJBAOHmuv5xjs5u4CpE+/s8WNEXv6aQsNEgNkEuxG+FVuMReMzB7R+t\n\
	MNn6eNT0K8fF6HBm23FRjiginS7AzycNK1cCQBpKFT3KnxKI/4zf3VDGL/+dE7ko\n\
	1OoIzQQFuBm51VAWED/uIYHXWsiGbKPpx1SsxMJ1MG+Hc01q83zGjhYKKu0CQQC9\n\
	drzi5u81KD0Odqk4f9amF9r/ol8KJpAaf1T1i8nhzCea5BMy/Bj62V46jUei19Qp\n\
	YbsvAY3PD6jxK3kScbMlAkABdwSgm/T5NdN4MAqshan6FCZQCA8SABnq63zbTkvx\n\
	lK5FuzylcDkZUg2DfRARKlJpnRZT5EXRhaHe8MMNLdqa\n\
	-----END RSA PRIVATE KEY-----\n\
")
	t.deepEqual(signature, "OBm668H9rAsgB87Sc5SH+NLP7jsyRtPtQz+S4h+eHTM8PCzoE7MVqDfIFFaY0I4wBeGRyFzZY40B7rFYIgHGut17SaZPifzLqzjuIYm9dW/CBq8b2L6lLwDOpGsctelcccrVqrJVbS9L8DR0owy3J2YXCzBsCceAgRTh1NcndN8=");
	t.end();
});

test.cb('sign message with RSA 4096 bits (deterministic)', t => {
	var signature = asymSig.signMessageWithRsaPemPrivKey("zouplaboom", null, "-----BEGIN RSA PRIVATE KEY-----\n\
	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\n\
	-----END RSA PRIVATE KEY-----\n\
")
	t.deepEqual(signature, "AyR5fiIl48hJoZOa4Jon6mjKOoDYPTdnjBAqKMMCLTwz3Uy5dXMxLoVkx25x8/1yjOAwCpZjMVSnAmZyRenJroEM7aXUpO4Wjk4bKO4/cHhZ8whGKVC4zKnLaJU4GBatjvBUQyvzelTlMK5o6iDtt3x5WHbWssFzNrnErC9XtMwO8R0JU6HeF0TXZf/RoFs+uVx1dJGnkgzTAUs7XdIWMO1WnEukwR91F/3gjAey2wfe1vSgW6zTYk3ZG2KT/7jD7uBFpKcP8ot+3WR5PwpzfBCm7hayxddgUqC67JfKvZ3NzlBWQrfly1ZuplXX6kXvSpFAJHVLnxbl5kejLQ2zj6QAGbIvbTbdZGzN4yQf/rhC1biTB6lAg7qwVhyk6Zjm2InIT+EF8fb5pzjwk36OcEFBRkrhftMIdgHIuvyoq5MRbPpE2FveFu3jixYfMEwBzOwP1gbtRVtYka1POLMJqlBuT0ogeLpOMYoGxZO0HSOxPbwXTMvDQ1y1fICw5ogxaPjFdaWbTp4J4AK3peAKJRv74AzBvoqCL8EJS0OVW9JSavQRsDT9ZFcRHheVKsIVqgia6P3sl6MarXk63Lmjsh8uD2vrjMG0lR4FS9jjYx8UZqdgejdEtOOgxQf8PciPDiu6GPCRuCB01knguovcPU6ibsnrvvY8FxZv5ohVHL8=");
	t.end();
});


test.cb('vrf generate with RSA 2048 bits', t => {
	var signature = asymSig.vrfGenerate("thisIsAseed","\n\
	-----BEGIN RSA PRIVATE KEY-----\n\
	MIIEoQIBAAKCAQEAvb7LwrxSigIPYCCwGwvuA5vnv41v2z0LzI7iDqiuDrK4kQJn\n\
	26kjpX9qDcnot15lAgLew9yysuPZ57GfUKRL4O9uk/pXaJGE0jV7+NLy//yL+udU\n\
	648sfjKwxHhmT2AnbN41ZG1OCvSaFD+pZ+PTfi6ywfj+k2IPwpphd/1TD2Uut6J0\n\
	8/gnUIWPsh05aegf8LJ/ZI/iRLQp1zcoGDvu9v2S+RBvdF4aTCVTRxk1vL5C0x2O\n\
	7r+WBIGqnyKfcIyYLKaj0cLBU0LZHRJXferOryzjmAQukg0obJYek+WzrZ57BP7x\n\
	J3AJV+hED/PY3PRwH6V+VP98a//QjcS0twcq+wIBEQKCAQA3zrRmc5/OPNdYghWt\n\
	mhjT4o90kwLIAuVaSCReqhUTYb3QTABtyFXHQ5eps9sIwWkAl26yE7wWf0AW+AGu\n\
	TnCrkbccds5qDK6YLdkrEN4PDgsNj1U2OSs0LQbQX6We4AuYfZc7p62KwGmNfCLE\n\
	M/Lo4I7twbRJdzHP0w2bwvpP0fSBa/4DLfKd60wzpPd4Or5YkO+8TPrKuJKHl4Eh\n\
	fjz8mteVsSq/3o7tDgeVLtVALRGUe6VmFpuvfGUKAVBZgnzlR5KfIVNUwY3Ps+0F\n\
	QdVHtAjhDpEEcVu+kffsrO0ZEdL6ixktZZSB/SqcbS+0tV9B2wfqO8UL2UyBZtEe\n\
	mM3hAoGBAPmLgN3wC7rFlC9W7UQG8HucUo1IfZrt/99eqzWiPT1tpszywKLXhEQL\n\
	BfNnYecidpDFevmKYK5zGT+3PhkD00EOS1zdAAaRmKbV5PWwTaoUJDvNH1gOh8AR\n\
	2tJxLy0xnOKM0btgGHUoVtjFvqVyo0bYA4pYw2kZPCS6AI5WRXtzAoGBAMKnTAQs\n\
	UDOlN8OrmKv9Yx0nP/Y1cvKlc/HevAg3UXvIFRw8jwgQfr0bIt+xS0ZZrnZH/i/W\n\
	Eglv9Kz5E0IJMOGsZ+4K6wXUsbaE/NWIihxA17zNs0/a0MoF/jRkapONK2S97eAs\n\
	/jTcAXQDKF4D6H8BUtkTCnVdrae1ZpKSU8BZAoGAOrdpnaHkpGq5dIzsiHoad3AT\n\
	bImG90cPB2GRskRKpQq91d7D6hSXl4ofhJDLven9x7X+0U28ZUhCLRwOnHle4iF7\n\
	JOi0tkBgJ0FjDKH0KAS9Oz9Sq062h4u7BFbd7IQk6gMELBacV81BnGrDcjkXW/aX\n\
	a9imcxT/F7NLbMkBSjkCgYAiWcIe2qS90dyqDzkPStVBYUeFzTJnDiOFCTA9r2i7\n\
	falfVfsfinC39brcLliT8bVgKtKA6Yq2Xw0Pdz+iPdtzHmyxiXTEyy5rgOFS29wj\n\
	GoBsnMVKU8p+AQ6985pWRha3bM+gB/Cf6pbYPMrjahn4S4cXP5hvEIgOiWx0N/Cp\n\
	eQKBgQCxIt82bU9niJzs0jte2hz0xhtTdR0Bu5nZ8R0mGsAa+HG/zxYZNnIpPJpg\n\
	BtlUz8RZ5M1Ffdq/Rf1NpC4XitnAqUzNPRzZW74ULIU3cqoLBWr2Nnfh7f6ZlKaw\n\
	2WG490et25eJA4z3upgkvJc7O1XpRXLtm9XrE5bmWTKoJfNJjA==\n\
	-----END RSA PRIVATE KEY-----")
	t.deepEqual(signature, "33296bb4c9d56c36f9f9b877cf35becc63a99a9915016071027434aeac396b66aac2f93a59f4a49b8ca61c7e3e6ba072b76874c20363c6928c8ecfe317ae131e229d03d644c3a8577fd431c907e7536d5e89dacff244404fea8fe052371d483d52bea4bf31d8e4fa1c0608976c70d0f9686284454152104134988d32788b9b0d89c5b060a6aaf9b4744ad72ea1f63dd88531ad509758fc72ffa80de4730ab494b65cdc3c47aff09ed343c352c7c2a8a7c1d6d03a47eaf391d42f88d65d16800a5c527e3fa9364b82bc2796f807645a8d9842f267e74f7e594d31f8781ab81497ecf4c2a04ef978c0eb6e8fc0a2994dec191e8827574c0e8af0ab04c9ef2c1ea5");
	t.end();
});

test.cb('vrf generate with ECDSA ', t => {
	var signature = asymSig.vrfGenerate("thisIsAseed","-----BEGIN EC PRIVATE KEY-----\n\
	MFQCAQEEFNzyc6dCke0GhI2ucAadDnCDaT1uoAsGCSskAwMCCAEBAaEsAyoABFna\n\
	Ke/9gUiP7kmnq86iGFQN5kXPdsX7gtJq81qwr9o3A3OQvhdRkt4=\n\
	-----END EC PRIVATE KEY-----\n\
	")
	t.deepEqual(signature, null);
	t.end();
});

test.cb('vrf generate with RSA 4096 bits', t => {
	var signature = asymSig.vrfGenerate("thisIsAseed","\n\
	-----BEGIN RSA PRIVATE KEY-----\n\
MIIJKQIBAAKCAgEAwneF/bxlr/5V42TyCPiroiTXSTvDIZ1AYE3XKCvh9E60jpWq\n\
jlo5mdQCVapeSyJMgaszvWaCGQgc6HhmVZEYpc6Ivey/ac93uLT0nNnuFHingJgt\n\
GOiucN1dENrexsdG9aXMHjCNfkaZevyOLHdxj343tdBg65bvpp3Y0A3QMUgW9cVX\n\
7/xLGsS6BFGEPQRm1FIKAgJxPilVZuyc1yJRcmwYzCfPKAxAUhxh7dEoB8OD/pIL\n\
S37qtzv0CzYr5A76jUyA56HCyBAnPQLYWM4oeLRmW7fFDavAZmJ0xpGAR1Bt0qc0\n\
JncQJ7T+iFefLHGbIA8dBoptGxj9J1pwLL4Z964cFThZc2a0XzxiI/zggRLYoe1X\n\
06pbYRXTywrxqTNGsxbFiW69m7vwjNZWVooG+ngbSFeIlDBtB6AEC7M5tDIrloSv\n\
pIZI1VjKOAUxI9PghVxbKnje9IxKTSO90Ld+P+iD9+V4FcfXpKBarazgh+75iM8o\n\
ZW708eJxLumC48MVH74K+3a5A2gtR/3R2PK1qAJ9pgpKQKauBy3rF8JpYaJ42XLx\n\
sTADDNC28MQV5NnasN38Ctkh44FkTJccoJhhnf/ca5OX45ZkR2aYgdeoAtA0vzaP\n\
nclTM1IseZoHOcBJMKupNtrZcC0wPG8IPSS38L4LyAb0w8LN7zsKZ0cgmBcCAwEA\n\
AQKCAgEAhsATlLLLM5xlH2B/ZkAJjh1BIHnMyKoSRakqgaeGtqci7fo/aMyURUdn\n\
Jr0bAa0OnntnKsKxO28nuN5U6s3T6nCmyBQYvtUH/HFHXriUB JNmXfEUrsHsvkBl\n\
kJxY6hyDywvL2M+D/BAnodUHH0DU671mFRIDVrwL68RMzD4GGV/+qObJ/H0x/aZ7\n\
zyo9G5rFNjJyxNm0ZoJ1rxAdzeT10vecZzrejL2QhFUudoAL4PVVrTy9nt6e/cEJ\n\
ZgtvdmP6sZZlbBvmwIKQ7fHewAp6eMloc/1vCf4NH+TxTfbckI3my6UYud6ezyTX\n\
itpMbZt7BkfysOmSmMhEAtTkDdzcWFF4hHYhWNpTVIpZYVDmYEQtbsMFCmcopVDL\n\
vpUwxM4Ht2kmCXBHxFkSKjx8NbT/vIvFE5Bw22MGRraKiNhs473C1Jl8ox15384S\n\
WHDFiATl1ZZyq+bjOZWCfJ/NusRqr+sNpALV2KGjVLYtQtwFkeCTNouXBHUo0CY8\n\
qJv/pgM91t8pkFzcuqx1RjFMxvNx+P9IpuuZgqFW73EGwBY4MHBdJe7iNXmOwX9e\n\
oc1to7nT9/JN9clSfzGazxpqTKurBHzBT8HrTqxUEck9MY2izZpWhGwKpMOaHvDz\n\
63OUG4Mnwcnvfh9z0nGP9rQgCVl30X8QHkSgA3Tw55GZpLfkfqECggEBAPK7Qxp/\n\
cvX6hB4VghSuzH7BXZHNTd7eppCnFIqVssCiCUy9MMXP83oNP1VS97tyaZ3HQHyl\n\
GJ5lkXrNUlNVZJN9uPm4SrE/lPinGIrSjIZsO9tJ6df9hCNyzuAyXbs9ZI2Dp6F6\n\
TKwPyfMuoQ+tZCBm1Eu/1mFGQ2zmGeI+5O7wGZRR+UFSrb4KI9S4ZAivUwMLrtB2\n\
jVKshhj0w1HbDV8VMxa+3urE8zY1OSwqPvVK4lVAmOg5jmiSRooAZ4nUe4Z7OdAa\n\
g18sms2LuhL1Oh8UtANzy2Tg7I3HmVKpzmh/l/hMoQ6bSGE6vZ/pwaRUUcUjuPMR\n\
smGpSx9bajocuEsCggEBAM0Y2w29xqYZRIDfirDtk/VEmMGfPLwRqar7yOszVyrv\n\
IoMhSymWNVHiM6XScu+970qRjGPfPpNlMDdKhpPKRA9MJZXffZVIw9wT19Jporik\n\
altL0mCHx/xypD8Fib9z5/khGu8sdxmvDzrcCglGdCjr0vvhJrH3zQS/g+vSZ3w/\n\
wWHvZlXjCKcX614M8MZv4cPLIpBYbzyAOc3rkVEZMbE9U3JomVXWYSPOtzt46WKi\n\
sWNKObrsY2pBqQd81BIjbG+9teIYGr5zmQpXpnKHBTrU9lPJoDU8HydSyhfhBWFI\n\
50ZUWrmg+j1eDdZo11Agoih0FNLR6FWvp0YAWuoDF+UCggEAVKFZ+ikpqf3Yhqy1\n\
GAUCI8fDmgxc9DHpHVJD5TXghy131Ju6H54rpAhuZo9w9Jglnu9T2qGtfbyoBosE\n\
Ay4ozQvurJLG6BnlFPUdp3lVqaCfFgwlTjuEEN/8pUqqR5hWMMkQb0q25N70aKd/\n\
XHn2CR4RMwAF/RCEfbmUmL+ZDn4ETSRvpYjwLuxWJdrMdgK7DLrMDr7m80ZX0ue0\n\
GhwoA1je4TVXf79/lQzljDKGlPuxAkxtg7pdnrQxh/gwIWxGTVM1iwtTdqGUr8nh\n\
7K43v5J2WSXMarXJhH1tRdcSsniaQeZl2TPm/o9+gfz8mREVGYkk+QrYiRh/qsUy\n\
umQ9FQKCAQEAmw9Lrdvor/Myg2x+Yr17u1cdVmWZeWaxLAAoKwopwOAC67jkJpDV\n\
xw6JlbjCBNdIbswTo/5IRQ+foG3LyTiGtDoRwHmzbIYS7fRim0YaLBbCAjwU1b5S\n\
SF40JyF8vy5WF1gcEO9BLD3Z+doaDGEjuTxxytSyeKKscgaJKmVsr9dT0UM5z31S\n\
MWI4JGcMMjqsKWcOvqrdjpQzH6gVuYaety1yRXEnXGo0DupeRaxoZpYyHqsjclr9\n\
3nu921dYzk3R0blQJZurvImRDuytfrDuF0ii4z3wzc6ijwxclikd9Cs2D0n/PZCj\n\
IHpXY97nykCh2IvKoojoar/ea2IhWgL0sQKCAQA8FawHOrjNfqJROlxZdtuuRyon\n\
wsXIrVAwWsY49NaG2GeC2M0eE8c5o6A6fX2jXmcpy7Zfilr88TznfGbUgqLAQp+c\n\
HOJBnuVRKDe2eQkkofWhFZdfOMYzRfeMT2L5UNf99O8A0xw2C2KbhLyxzZEpU/F1\n\
hXQNL0SLjcm3i+ejEg/9hs1ueFk26Q6/ld6sfCjX7C71f9Wr+QKjIqeJlDY3TkaZ\n\
NjVjIpKKEUTP3Kzv8Fm4xzw27STmHv24EF5ijsCsXLtmgaH1mipDSWtWPW8SddT5\n\
j8RrU9v2EfKTjLjNa52GK69gsU7L8XYJEizCjre0MUzq3Q20Po/ZUHgYpO9e\n\
-----END RSA PRIVATE KEY-----")
	t.deepEqual(signature, "571b947b0c0d93fcb691ccb7a50b64f208b72faf8c7b5ff859e7d0e0c711d5a31b6cfcbad6a3b09c733b32452d0ca2cb806cd938ddb3f6b461fbef4c303df985649e35b6c5e78c23e52af5d27d9c6e7970d4be5938db0298f1a5bfb110241c9a5effc77cd5ff56a5e783576bb9d139348be9e8237dd4fce1f64c48c293a4bceec4af703ab22e036b07979ba7ce7de3c31e03c604477df74a15575adc9c237800faf796cbd665e197dd2c990831f3fe24ed36befe6a865da6b8d6f038a2e4d7794c42e4194b83e25c5a8d1e473611503354f8cc588b54d7d71bff89fd801f72d31717f2f30846796f6c502f75a9af8b6dd5d9b338c25568e5c1cbb033450c868774f173cbbbeaed59d1a84b6c1b34eaa208ddae20489fcc15bdad590da921c632af6257531c4a834d8da0888150795c8f12074d8ce43e01e810e39ff86b85891a26437218df27759c2a8e5a66a5690e8d1fb681739ac93e12a8cd0d1b34a05ac3d9379797be3e284564b0c0948871b4d9d30b6d6963083d12a9359bacb52d42f8ea0a9b90d0cb9b56a34d0edb4d401566e4b1c466b0103aeecf6f49d97e99f20b1cf3dc8799bbba6ac62e5e5d7e788af4437e52ce08b012a9e534a1bafe8e6395a47d0019990700d96c8d70da7f4ef425ce616348c971d943d234af0b38da149a4f814bae48384fceac3914eaa0c7d84c1821ff58a09048f289cec8aac5013af2");
	t.end();
});

test.cb('vrf generate with ECDSA ', t => {
	var signature = asymSig.vrfGenerate("thisIsAseed","-----BEGIN EC PRIVATE KEY-----\n\
	MFQCAQEEFNzyc6dCke0GhI2ucAadDnCDaT1uoAsGCSskAwMCCAEBAaEsAyoABFna\n\
	Ke/9gUiP7kmnq86iGFQN5kXPdsX7gtJq81qwr9o3A3OQvhdRkt4=\n\
	-----END EC PRIVATE KEY-----\n\
	")
	t.deepEqual(signature, null);
	t.end();
});


test.cb('vrf_verify RSA 2048 bits', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
		MIIBIDANBgkqhkiG9w0BAQEFAAOCAQ0AMIIBCAKCAQEAvb7LwrxSigIPYCCwGwvu\n\
		A5vnv41v2z0LzI7iDqiuDrK4kQJn26kjpX9qDcnot15lAgLew9yysuPZ57GfUKRL\n\
		4O9uk/pXaJGE0jV7+NLy//yL+udU648sfjKwxHhmT2AnbN41ZG1OCvSaFD+pZ+PT\n\
		fi6ywfj+k2IPwpphd/1TD2Uut6J08/gnUIWPsh05aegf8LJ/ZI/iRLQp1zcoGDvu\n\
		9v2S+RBvdF4aTCVTRxk1vL5C0x2O7r+WBIGqnyKfcIyYLKaj0cLBU0LZHRJXferO\n\
		ryzjmAQukg0obJYek+WzrZ57BP7xJ3AJV+hED/PY3PRwH6V+VP98a//QjcS0twcq\n\
		+wIBEQ==\n\
		-----END PUBLIC KEY-----",
		seed: "thisIsAseed",
		pseudorandom_value: "33296bb4c9d56c36f9f9b877cf35becc63a99a9915016071027434aeac396b66aac2f93a59f4a49b8ca61c7e3e6ba072b76874c20363c6928c8ecfe317ae131e229d03d644c3a8577fd431c907e7536d5e89dacff244404fea8fe052371d483d52bea4bf31d8e4fa1c0608976c70d0f9686284454152104134988d32788b9b0d89c5b060a6aaf9b4744ad72ea1f63dd88531ad509758fc72ffa80de4730ab494b65cdc3c47aff09ed343c352c7c2a8a7c1d6d03a47eaf391d42f88d65d16800a5c527e3fa9364b82bc2796f807645a8d9842f267e74f7e594d31f8781ab81497ecf4c2a04ef978c0eb6e8fc0a2994dec191e8827574c0e8af0ab04c9ef2c1ea5"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "vrf_verify(trigger.data.seed, trigger.data.pseudorandom_value, trigger.data.pem_key)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});


test.cb('vrf_verify RSA 2048 bits wrong value', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
		MIIBIDANBgkqhkiG9w0BAQEFAAOCAQ0AMIIBCAKCAQEAvb7LwrxSigIPYCCwGwvu\n\
		A5vnv41v2z0LzI7iDqiuDrK4kQJn26kjpX9qDcnot15lAgLew9yysuPZ57GfUKRL\n\
		4O9uk/pXaJGE0jV7+NLy//yL+udU648sfjKwxHhmT2AnbN41ZG1OCvSaFD+pZ+PT\n\
		fi6ywfj+k2IPwpphd/1TD2Uut6J08/gnUIWPsh05aegf8LJ/ZI/iRLQp1zcoGDvu\n\
		9v2S+RBvdF4aTCVTRxk1vL5C0x2O7r+WBIGqnyKfcIyYLKaj0cLBU0LZHRJXferO\n\
		ryzjmAQukg0obJYek+WzrZ57BP7xJ3AJV+hED/PY3PRwH6V+VP98a//QjcS0twcq\n\
		+wIBEQ==\n\
		-----END PUBLIC KEY-----",
		seed: "thisIsAseed",
		pseudorandom_value: "13296bb4c9d56c36f9f9b877cf35becc63a99a9915016071027434aeac396b66aac2f93a59f4a49b8ca61c7e3e6ba072b76874c20363c6928c8ecfe317ae131e229d03d644c3a8577fd431c907e7536d5e89dacff244404fea8fe052371d483d52bea4bf31d8e4fa1c0608976c70d0f9686284454152104134988d32788b9b0d89c5b060a6aaf9b4744ad72ea1f63dd88531ad509758fc72ffa80de4730ab494b65cdc3c47aff09ed343c352c7c2a8a7c1d6d03a47eaf391d42f88d65d16800a5c527e3fa9364b82bc2796f807645a8d9842f267e74f7e594d31f8781ab81497ecf4c2a04ef978c0eb6e8fc0a2994dec191e8827574c0e8af0ab04c9ef2c1ea5"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "vrf_verify(trigger.data.seed, trigger.data.pseudorandom_value, trigger.data.pem_key)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, false);
		t.deepEqual(complexity, 2);
		t.end();
	})
});


test.cb('vrf_verify RSA 2048 bits base64', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
		MIIBIDANBgkqhkiG9w0BAQEFAAOCAQ0AMIIBCAKCAQEAvb7LwrxSigIPYCCwGwvu\n\
		A5vnv41v2z0LzI7iDqiuDrK4kQJn26kjpX9qDcnot15lAgLew9yysuPZ57GfUKRL\n\
		4O9uk/pXaJGE0jV7+NLy//yL+udU648sfjKwxHhmT2AnbN41ZG1OCvSaFD+pZ+PT\n\
		fi6ywfj+k2IPwpphd/1TD2Uut6J08/gnUIWPsh05aegf8LJ/ZI/iRLQp1zcoGDvu\n\
		9v2S+RBvdF4aTCVTRxk1vL5C0x2O7r+WBIGqnyKfcIyYLKaj0cLBU0LZHRJXferO\n\
		ryzjmAQukg0obJYek+WzrZ57BP7xJ3AJV+hED/PY3PRwH6V+VP98a//QjcS0twcq\n\
		+wIBEQ==\n\
		-----END PUBLIC KEY-----",
		seed: "thisIsAseed",
		pseudorandom_value: "MylrtMnVbDb5+bh3zzW+zGOpmpkVAWBxAnQ0rqw5a2aqwvk6WfSkm4ymHH4+a6Byt2h0wgNjxpKMjs/jF64THiKdA9ZEw6hXf9QxyQfnU21eidrP8kRAT+qP4FI3HUg9Ur6kvzHY5PocBgiXbHDQ+WhihEVBUhBBNJiNMniLmw2JxbBgpqr5tHRK1y6h9j3YhTGtUJdY/HL/qA3kcwq0lLZc3DxHr/Ce00PDUsfCqKfB1tA6R+rzkdQviNZdFoAKXFJ+P6k2S4K8J5b4B2RajZhC8mfnT35ZTTH4eBq4FJfs9MKgTvl4wOtuj8CimU3sGR6IJ1dMDorwqwTJ7ywepQ=="}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "vrf_verify(trigger.data.seed, trigger.data.pseudorandom_value, trigger.data.pem_key)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('vrf_verify RSA 2048 bits empty seed', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
		MIIBIDANBgkqhkiG9w0BAQEFAAOCAQ0AMIIBCAKCAQEAvb7LwrxSigIPYCCwGwvu\n\
		A5vnv41v2z0LzI7iDqiuDrK4kQJn26kjpX9qDcnot15lAgLew9yysuPZ57GfUKRL\n\
		4O9uk/pXaJGE0jV7+NLy//yL+udU648sfjKwxHhmT2AnbN41ZG1OCvSaFD+pZ+PT\n\
		fi6ywfj+k2IPwpphd/1TD2Uut6J08/gnUIWPsh05aegf8LJ/ZI/iRLQp1zcoGDvu\n\
		9v2S+RBvdF4aTCVTRxk1vL5C0x2O7r+WBIGqnyKfcIyYLKaj0cLBU0LZHRJXferO\n\
		ryzjmAQukg0obJYek+WzrZ57BP7xJ3AJV+hED/PY3PRwH6V+VP98a//QjcS0twcq\n\
		+wIBEQ==\n\
		-----END PUBLIC KEY-----",
		seed: "",
		pseudorandom_value: "33296bb4c9d56c36f9f9b877cf35becc63a99a9915016071027434aeac396b66aac2f93a59f4a49b8ca61c7e3e6ba072b76874c20363c6928c8ecfe317ae131e229d03d644c3a8577fd431c907e7536d5e89dacff244404fea8fe052371d483d52bea4bf31d8e4fa1c0608976c70d0f9686284454152104134988d32788b9b0d89c5b060a6aaf9b4744ad72ea1f63dd88531ad509758fc72ffa80de4730ab494b65cdc3c47aff09ed343c352c7c2a8a7c1d6d03a47eaf391d42f88d65d16800a5c527e3fa9364b82bc2796f807645a8d9842f267e74f7e594d31f8781ab81497ecf4c2a04ef978c0eb6e8fc0a2994dec191e8827574c0e8af0ab04c9ef2c1ea5"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "vrf_verify(trigger.data.seed, trigger.data.pseudorandom_value, trigger.data.pem_key)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('vrf_verify RSA 2048 bits empty random value', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
		MIIBIDANBgkqhkiG9w0BAQEFAAOCAQ0AMIIBCAKCAQEAvb7LwrxSigIPYCCwGwvu\n\
		A5vnv41v2z0LzI7iDqiuDrK4kQJn26kjpX9qDcnot15lAgLew9yysuPZ57GfUKRL\n\
		4O9uk/pXaJGE0jV7+NLy//yL+udU648sfjKwxHhmT2AnbN41ZG1OCvSaFD+pZ+PT\n\
		fi6ywfj+k2IPwpphd/1TD2Uut6J08/gnUIWPsh05aegf8LJ/ZI/iRLQp1zcoGDvu\n\
		9v2S+RBvdF4aTCVTRxk1vL5C0x2O7r+WBIGqnyKfcIyYLKaj0cLBU0LZHRJXferO\n\
		ryzjmAQukg0obJYek+WzrZ57BP7xJ3AJV+hED/PY3PRwH6V+VP98a//QjcS0twcq\n\
		+wIBEQ==\n\
		-----END PUBLIC KEY-----",
		seed: "thisIsAseed",
		pseudorandom_value: ""}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "vrf_verify(trigger.data.seed, trigger.data.pseudorandom_value, trigger.data.pem_key)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('vrf_verify RSA 2048 bits bad key', t => {
	var trigger = { data: 
	{
		pem_key: "-----BEGIN PUBLIC KEY-----\n\
		MIIBADANBgkqhkiG9w0BAQEFAAOCAQ0AMIIBCAKCAQEAvb7LwrxSigIPYCCwGwvu\n\
		A5vnv41v2z0LzI7iDqiuDrK4kQJn26kjpX9qDcnot15lAgLew9yysuPZ57GfUKRL\n\
		4O9uk/pXaJGE0jV7+NLy//yL+udU648sfjKwxHhmT2AnbN41ZG1OCvSaFD+pZ+PT\n\
		fi6ywfj+k2IPwpphd/1TD2Uut6J08/gnUIWPsh05aegf8LJ/ZI/iRLQp1zcoGDvu\n\
		9v2S+RBvdF4aTCVTRxk1vL5C0x2O7r+WBIGqnyKfcIyYLKaj0cLBU0LZHRJXferO\n\
		ryzjmAQukg0obJYek+WzrZ57BP7xJ3AJV+hED/PY3PRwH6V+VP98a//QjcS0twcq\n\
		+wIBEQ==\n\
		-----END PUBLIC KEY-----",
		seed: "thisIsAseed",
		pseudorandom_value: "33296bb4c9d56c36f9f9b877cf35becc63a99a9915016071027434aeac396b66aac2f93a59f4a49b8ca61c7e3e6ba072b76874c20363c6928c8ecfe317ae131e229d03d644c3a8577fd431c907e7536d5e89dacff244404fea8fe052371d483d52bea4bf31d8e4fa1c0608976c70d0f9686284454152104134988d32788b9b0d89c5b060a6aaf9b4744ad72ea1f63dd88531ad509758fc72ffa80de4730ab494b65cdc3c47aff09ed343c352c7c2a8a7c1d6d03a47eaf391d42f88d65d16800a5c527e3fa9364b82bc2796f807645a8d9842f267e74f7e594d31f8781ab81497ecf4c2a04ef978c0eb6e8fc0a2994dec191e8827574c0e8af0ab04c9ef2c1ea5"}
	};
	
	evalFormulaWithVars({ conn: null, formula:  "vrf_verify(trigger.data.seed, trigger.data.pseudorandom_value, trigger.data.pem_key)", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, false);
		t.deepEqual(complexity, 2);
		t.end();
	})
});