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



test('1 + 1', t => {
	evalFormula(null, "1 + 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 2);
	});
});

test('1 - 1', t => {
	evalFormula(null, "1 - 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 0);
	});
});

test('1-1', t => {
	evalFormula(null, "1-1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 0);
	});
});

test('-3 + 1', t => {
	evalFormula(null, "-3 + 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, -2);
	});
});

test('2 * 2', t => {
	evalFormula(null, "2 * 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 4);
	});
});

test('- 2 / 2', t => {
	evalFormula(null, "- 2 / 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, -1);
	});
});

test('2 / 0 infinity', t => {
	evalFormula(null, "2 / 0", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, null);
	});
});

test('2 ^ 4', t => {
	evalFormula(null, "2 ^ 4", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 16);
	});
});

test('-2 ^ 4', t => {
	evalFormula(null, "-2 ^ 4", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, -16);
	});
});

test('2 ^ -2', t => {
	evalFormula(null, "2 ^ -2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, null);
	});
});

test('-2 ^ (-2)', t => {
	evalFormula(null, "-2 ^ (-2)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '-0.25');
	});
});

test('2 ^ 9007199254740992', t => {
	evalFormula(null, "2 ^ 9007199254740992", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, null);
	});
});

test('2 ^ 1.5', t => {
	evalFormula(null, "2 ^ 1.5", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '2.8284271247462');
	});
});

test('2 ^ 1.6', t => {
	evalFormula(null, "2 ^ 1.6", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '3.03143313302079');
	});
});

test('e ^ (4-2.5)', t => {
	evalFormula(null, "e^(4-2.5)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '4.48168907033806');
	});
});

test('222222222 ^ 222222222 infinity', t => {
	evalFormula(null, "222222222 ^ 222222222", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, null);
	});
});

test('222222222 ^ (-222222222) 0', t => {
	evalFormula(null, "222222222 ^ (-222222222)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 0);
	});
});

test('ln(e^2)', t => {
	evalFormula(null, "ln(e^2)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 2);
	});
});

test('e^ln(2)', t => {
	evalFormula(null, "e^ln(2)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 2);
	});
});

test('ln(e^(2+1e-15))', t => {
	evalFormula(null, "ln(e^(2+1e-15))", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 2);
	});
});

test('ln(e^(2+1e-14))', t => {
	evalFormula(null, "ln(e^(2+1e-14))", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '2.00000000000001');
	});
});

test('(2 + 2) * 2', t => {
	evalFormula(null, "(2 + 2) * 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 8);
	});
});

test('2 + 2 * 2', t => {
	evalFormula(null, "2 + 2 * 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 6);
	});
});

test('10 - 5 + 1', t => {
	evalFormula(null, "10 - 5 + 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 6);
	});
});

test('15 - 5 + 2*3', t => {
	evalFormula(null, "15 - 5 + 2*3", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 16);
	});
});

test('5 - 3*4 + 2*3', t => {
	evalFormula(null, "5 - 3*4 + 2*3", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, -1);
	});
});

test('pi + 2', t => {
	evalFormula(null, "pi + 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '5.14159265358979');
	});
});

test('e + 2', t => {
	evalFormula(null, "e + 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '4.71828182845904');
	});
});


test('sqrt(2)', t => {
	evalFormula(null, "sqrt ( max ( 1 , sqrt(4) ) )", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '1.4142135623731');
	});
});

test('sqrt ternary', t => {
	evalFormula(null, "sqrt ( 1==2 ? 4 : 9 )", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 3);
	});
});

test('abs negative', t => {
	evalFormula(null, "abs(-2)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 2);
	});
});

test('abs positive', t => {
	evalFormula(null, "abs(2.33)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '2.33');
	});
});

test('abs string', t => {
	evalFormula(null, "abs(2 || '')", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, null);
	});
});

test('1 == 1', t => {
	evalFormula(null, "1 == 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('1 != 1', t => {
	evalFormula(null, "1 != 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test('1 != 2', t => {
	evalFormula(null, "1 != 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('1 < 2', t => {
	evalFormula(null, "1 < 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('1 > 2', t => {
	evalFormula(null, "1 > 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test('1 >= 2', t => {
	evalFormula(null, "2 >= 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('1 <= 2', t => {
	evalFormula(null, "1 <= 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('0 >= 2', t => {
	evalFormula(null, "0 >= 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test('3 <= 2', t => {
	evalFormula(null, "3 <= 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test('"test" == "test"', t => {
	evalFormula(null, '"test" == "test"', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('"test" != "test"', t => {
	evalFormula(null, '"test" != "test"', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test('"test 1" != "test 2"', t => {
	evalFormula(null, '"test 1" != "test 2"', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('"test 2" != "test 2"', t => {
	evalFormula(null, '"test 2" != "test 2"', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test('"test 3" == "test 3"', t => {
	evalFormula(null, '"test 3" == "test 3"', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('1 and 1', t => {
	evalFormula(null, "1 and 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('0 and 0', t => {
	evalFormula(null, "0 and 0", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test('0 and 1', t => {
	evalFormula(null, "0 and 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test('0 or 1', t => {
	evalFormula(null, "0 or 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('1 == 1 and 1 == 1', t => {
	evalFormula(null, "1 == 1 and 1 == 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});
test('1 == 1 and 1 == 2', t => {
	evalFormula(null, "1 == 1 and 1 == 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test('1 or 1 and 0', t => {
	evalFormula(null, "1 or 1 and 0", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('1 == 1 or 1 == 2', t => {
	evalFormula(null, "1 == 1 or 1 == 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('1 == 2 or 1 == 2', t => {
	evalFormula(null, "1 == 2 or 1 == 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test('10 == 10 ? 1 : 2', t => {
	evalFormula(null, "10 == 10 ? 1 : 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 1);
	});
});

test('10 != 10 ? 1 : 2', t => {
	evalFormula(null, "10 != 10 ? 1 : 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 2);
	});
});

test('10 == 10 ? 1 + 1 : 2 + 2', t => {
	evalFormula(null, "10 == 10 ? 1 + 1 : 2 + 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 2);
	});
});

test('10 != 10 ? 1 + 1 : 2 + 2', t => {
	evalFormula(null, "10 != 10 ? 1 + 1 : 2 + 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 4);
	});
});

test('1000000000000000000000000000000 == 1000000000000000000000000000000', t => {
	evalFormula(null, "1000000000000000000000000000000 == 1000000000000000000000000000000", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('1000000000000000000000000000000 == 1000000000000000000000000000001 excessive precision', t => {
	evalFormula(null, "1000000000000000000000000000000 == 1000000000000000000000000000001", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('min 1,2', t => {
	evalFormula(null, 'min(1,2)', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 1);
	});
});

test('min 1,2,4', t => {
	evalFormula(null, "min(1,2,4)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 1);
	});
});

test('min 2,3,5,7', t => {
	evalFormula(null, "min(2,3,5,7)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 2);
	});
});

test('max 1,2', t => {
	evalFormula(null, "max(1,2)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 2);
	});
});

test('max 1,2 without parens', t => {
	evalFormula(null, "max 1,2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, null);
	});
});

test('max 1,2,4', t => {
	evalFormula(null, "max(1,2,4)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 4);
	});
});
test('max 2,3,5,7', t => {
	evalFormula(null, "max(2,3,5,7)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 7);
	});
});

test('hypot(3, 4)', t => {
	evalFormula(null, 'hypot(3, 4)', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 5);
	});
});

test('hypot no overflow', t => {
	evalFormula(null, 'hypot(3e307, 4e307)*1e-307', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 5);
	});
});

test('ceil 2.5', t => {
	evalFormula(null, "ceil(2.5)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 3);
	});
});

test('ceil 2.5 without parens', t => {
	evalFormula(null, "ceil 2.5", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, null);
	});
});

test('floor 2.5', t => {
	evalFormula(null, 'floor(2.5)', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 2);
	});
});

test('round 2.5', t => {
	evalFormula(null, 'round(2.9)', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 3);
	});
});

test('ceil(2.12345, 3)', t => {
	evalFormula(null, "ceil(2.12345, 3)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '2.124');
	});
});

test('ceil ternary', t => {
	evalFormula(null, "ceil((6==8 OR 3==9) ? 6.777 : 2.12345, 1+1==2 ? 3 : 1)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '2.124');
	});
});

test('floor(2.12345, 3)', t => {
	evalFormula(null, "floor(2.12345, 3)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '2.123');
	});
});

test('round(2.12345, 3)', t => {
	evalFormula(null, "round(2.12345, min(5, 23, 3, 77))", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, '2.123');
	});
});


test("0.1 + 0.2 == 0.3", t => {
	evalFormula(null, "0.1 + 0.2 == 0.3", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test("'test' || 'test'", t => {
	evalFormula(null, "1 || 1 || 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, "111");
	});
});

test("'test' || 'test' and 'test'", t => {
	evalFormula(null, "'test' || 'test' || 'test'", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, "testtesttest");
	});
});


test("'test' || 1 and 'test'", t => {
	evalFormula(null, "'test' || 1 || 'test'", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, "test1test");
	});
});

test("'test' || 1 and 'test'", t => {
	evalFormula(null, "'test' || (1>2 ? 55 : -3+1) || 'test'", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, "test-2test");
	});
});

test("1 == 1", t => {
	evalFormula(null, "1 == 1", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test("\"1\" == \"1\"", t => {
	evalFormula(null, "\"1\" == \"1\"", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test("\"1\" < \"1\"", t => {
	evalFormula(null, "\"1\" < \"1\"", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test("2 == \"2\"", t => {
	evalFormula(null, "2 == \"2\"", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test("\"1\" < 2", t => {
	evalFormula(null, "\"1\" < 2", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, null);
	});
});

test("\"bb\" > \"ba\"", t => {
	evalFormula(null, "\"bb\" > \"ba\"", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('formula - amount !=', t => {
	evalFormula(null, 'input[[asset="base" ]].amount != output[[ asset = base , address=GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN]].amount', objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
	});
});

test('formula - amount = 1', t => {
	evalFormula(null, "output[[asset = base, amount=1]].amount == 1", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
	});
});

test.cb('formula - datafeed', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"last\"]] == 10", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('datafeed int to string', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"last\", type='string']]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, '10');
		t.end();
	});
});

test.cb('datafeed ifnone', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"nonexistent\", ifseveral=\"last\", ifnone=77]]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, 77);
		t.end();
	});
});

test.cb('datafeed expr in ifnone', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"nonexistent\", ifseveral=\"last\", ifnone=(1==2)?'6':8]]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, 8);
		t.end();
	});
});

test.cb('formula - datafeed: formula in feed_name', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWH\"||\"T7XRG6LHJVVTAWU\", feed_name = 1 == 1+1*5 ? \"test2\" : \"tes\" || \"t\", ifseveral=\"last\"]] == 10", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed: oracle address from input', t => {
	evalFormula({}, "data_feed[[oracles=input[[asset=base]].address, feed_name=\"test\", ifseveral=\"last\"]] == 10", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed: input amount instead of oracle address', t => {
	evalFormula({}, "data_feed[[oracles=input[[asset=base]].amount, feed_name=\"test\", ifseveral=\"last\"]] == 10", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, null);
		t.end();
	});
});

test.cb('formula - datafeed not found', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\", ifseveral=\"last\"]] + 10", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, null);
		t.end();
	});
});

test.cb('formula - datafeed with this address', t => {
	evalFormula({}, "data_feed[[oracles=\"KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA:this address\", feed_name=\"test\", ifseveral=\"last\", min_mci = 10]] == 10", objValidationState.arrAugmentedMessages, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed3 te"st', t => {
	evalFormula({}, 'data_feed[[oracles="MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address", feed_name="te\\"st", ifseveral="last", min_mci = 10]] == 11', objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed4', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', ifseveral=\"last\", min_mci = 10]] == 10", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed te\"st', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='te\"st', ifseveral=\"last\", min_mci = 10]] == 11", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed te\'st', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='te\\'st', ifseveral=\"last\", min_mci = 10]] == 15", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed t,e(s)[],\'t', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='t,e(s)[],\\'t', ifseveral=\"last\", min_mci = 10]] == 20", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed +', t => {
	evalFormula({}, "1 + data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='t,e(s)[],\\'t', ifseveral=\"last\", min_mci = 10]]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, 21);
		t.end();
	});
});

test.cb('formula - datafeed concat', t => {
	evalFormula({}, "1 || data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='t,e(s)[],\\'t', ifseveral=\"last\", min_mci = 10]]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, "120");
		t.end();
	});
});

test.cb('formula - in datafeed', t => {
	evalFormula({}, "in_data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value > 5, min_mci = 10]]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - in datafeed large mci', t => {
	evalFormula({}, "in_data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value > 5, min_mci = 10000]] ? 'yes' : 'no'", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, 'no');
		t.end();
	});
});

test.cb('formula - in datafeed !=', t => {
	evalFormula({}, "in_data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='te\"st', feed_value != 11, min_mci = 10]] ? 'yes' : 'no'", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, 'no');
		t.end();
	});
});

test.cb('formula - not in datafeed', t => {
	evalFormula({}, "in_data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value < 5, min_mci = 10]]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, false);
		t.end();
	});
});

test.cb('formula - not in datafeed concat', t => {
	evalFormula({}, "60 || in_data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value > 5, min_mci = 10]]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, "60true");
		t.end();
	});
});

test.cb('formula - not in datafeed ternary true', t => {
	evalFormula({}, "in_data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value > 5, min_mci = 10]] ? 'yes' : 55", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, "yes");
		t.end();
	});
});

test.cb('formula - not in datafeed ternary false', t => {
	evalFormula({}, "in_data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value < 5]] ? 'yes' : 55", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, 55);
		t.end();
	});
});

test.cb('formula - not in datafeed, not ternary false', t => {
	evalFormula({}, "!in_data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value < 5]] ? 'yes' : 55", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, 'yes');
		t.end();
	});
});

test.cb('formula - what value', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', what='value']] == 10", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - what unit', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', what='unit']] || 'aaa' == 'unit2aaa'", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - invalid what', t => {
	evalFormula({}, "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', what='bbb']] || 'aaa'", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, null);
		t.end();
	});
});

test('validate 1 + 1', t => {
	validateFormula("1 + 1", 0, res => {
		t.deepEqual(res.error, false);
	})
});

test.cb('validate datafeed ok', t => {
	validateFormula("data_feed[[oracles=\"this address\", feed_name=\"test\"]]", 0, res => {
		t.deepEqual(res.error, false);
		t.end();
	})
});

test.cb('validate datafeed error', t => {
	validateFormula("data_feed[[oracles=\"this address\"]]", 0, res => {
		t.deepEqual(res.error, 'no oracles or feed name');
		t.end();
	})
});

test.cb('validate 1 + datafeed ok', t => {
	validateFormula("1 + data_feed[[oracles=\"this address\", feed_name=\"test\"]]", 0, res => {
		t.deepEqual(res.error, false);
		t.end();
	});
});

test.cb('validate 1 + datafeed error', t => {
	validateFormula("1 + data_feed[[oracles=\"this address\"]]", 0, res => {
		t.deepEqual(res.error, 'no oracles or feed name');
		t.end();
	})
});

test('validate round ok', t => {
	validateFormula("round(1+1.5)", 0, res => {
		t.deepEqual(res.error, false);
	})
});

test('validate min ok', t => {
	evalFormula(null, "min(1 + (1 + 1) - 1 - (2+3), 2)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, -3);
	})
});

test('max ternary', t => {
	evalFormula(null, "max(2>1 ? 5 : 6, 2)", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 5);
	})
});

test('eval ternary ok', t => {
	evalFormula(null, "1 == 1 ? 'ok' : '!ok'", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 'ok');
	})
});

test.cb('validate max datafeed error only oracles', t => {
	validateFormula("max(data_feed[[oracles=\"this address\"]], 2)", 0, res => {
		t.deepEqual(res.error, 'no oracles or feed name');
		t.end();
	})
});

test('1=1 assignment without var', t => {
	validateFormula("1 = 1", 0, res => {
		t.deepEqual(res.error, 'parse error');
	})
});

test('inp', t => {
	validateFormula("input[[address=this address, amount>10]].amount", 0, res => {
		t.deepEqual(res.error, false);
	})
});

test('inp', t => {
	validateFormula("input[[address=this address]].amount == 20000", 0, res => {
		t.deepEqual(res.error, false);
	})
});

test('max ternary input', t => {
	evalFormula(null, "max(2>1 ? 5 : 6, input[[address=this address]].amount > 10000 ? input[[address=this address]].amount + 1 : -1, 2)", objValidationState.arrAugmentedMessages, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 20001);
	})
});

test('formula in input', t => {
	evalFormula(null, "input[[address='this '||'address', amount=3*10*1000-10000]].amount - 5000", objValidationState.arrAugmentedMessages, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 15000);
	})
});

test('nested output in input', t => {
	evalFormula(null, "input[[address=output[[amount>10*2-6]].address, amount=3*10*1000-10000]].amount - 5000", objValidationState.arrAugmentedMessages, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 15000);
	})
});

test('bad address evaluated from nested output in input', t => {
	evalFormula(null, "input[[address=output[[amount>10*2-6]].amount, amount=3*10*1000-10000]].amount * 5000", objValidationState.arrAugmentedMessages, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, null);
	})
});

test.cb('nested data feed in input', t => {
	evalFormula(null, "input[[address=data_feed[[oracles=\"this address\", feed_name='test']]==10 ? 'this address' : 'bad address', amount=3*10*1000-10000]].amount - 5000", objValidationState.arrAugmentedMessages, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 15000);
		t.end();
	})
});

test('trigger quoted asset', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, "trigger.output[[asset='s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=']].amount ", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 777);
	})
});

test('trigger.output with missing asset', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, "trigger.output[[asset='wgkdjKivQ10LUIuuJmINu0iabhDSyPIC1dNddmunPgo=']].amount || trigger.output[[asset='wgkdjKivQ10LUIuuJmINu0iabhDSyPIC1dNddmunPgo=']].asset", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, "0none");
	})
});

test('trigger.output.amount with ambiguous asset', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777, 'wgkdjKivQ10LUIuuJmINu0iabhDSyPIC1dNddmunPgo=': 888 } };
	evalAAFormula(0, "trigger.output[[asset!=base]].amount ", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, null);
	})
});

test('trigger.output.asset with ambiguous asset', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777, 'wgkdjKivQ10LUIuuJmINu0iabhDSyPIC1dNddmunPgo=': 888 } };
	evalAAFormula(0, "trigger.output[[asset!=base]].asset ", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, "ambiguous");
	})
});

test('trigger concat asset', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, "trigger.output[[asset='s7GXNHSjRVIS6ohoDclYF/LbCnrR' || 'dBP429qLbBGWGMo=']].amount ", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 777);
	})
});

test('trigger formula', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, "trigger.address || ' ' || trigger.data.key1 || ' ' || (trigger.output[[asset='s7GXNHSjR'||'VIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=']].amount - trigger.output[[asset=base]].amount + 2)", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT val1 224");
	})
});

test('trigger formula with keywords', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", sqrt: {oracles: { key3: "val3", amount: 444 } }}, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, "trigger.address || ' ' || trigger.data.sqrt.oracles.amount || ' ' || (trigger.output[[asset='s7GXNHSjR'||'VIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=']].amount - trigger.output[[asset=base]] + 2)", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT 444 224");
	})
});

test('trigger formula with expr in data', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", ando: {oracles: { key3: "val3", amount: 444 } }}, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, " trigger.data.ando['ora'||'cles'].amount ", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 444);
	})
});

test('trigger with missing key', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", ando: {oracles: { key3: "val3", amount: 444 } }}, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, " trigger.data.ando['notora'||'cles'].amount || 1 || trigger.output[[asset='W/6iS75IT8mKJzKyyjz5dKCp9Ux6F7+AUUNq8VLiZ6o=']].amount || trigger.output[[asset='W/6iS75IT8mKJzKyyjz5dKCp9Ux6F7+AUUNq8VLiZ6o=']].asset", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 'false10none');
	})
});

test('trigger object converted to boolean', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", ando: {oracles: { key3: "val3", amount: 444 } }}, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, " trigger.data", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, true);
	})
});

test('trigger object returned as object', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", ando: {oracles: { key3: "val3", amount: 444 } }}, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalFormulaWithVars({ formula: " trigger.data.ando", trigger, objValidationState, bObjectResultAllowed: true, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, {oracles: { key3: "val3", amount: 444 } });
	})
});

test('trigger object comparison', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", ando: {oracles: { key3: "val3", amount: 444 } }}, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, " trigger.data.ando == trigger.data.ando", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, true);
	})
});

test('trigger object converted to boolean and nonexistent', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", ando: {oracles: { key3: "val3", amount: 444 } }}, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, " trigger.data || (trigger.data.ando+2) || trigger.data.nonexistent.nonex || (trigger.data.ando.nonex-1)", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, "true3false-1");
	})
});

test('trigger with bad asset', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", ando: {oracles: { key3: "val3", amount: 444 } }}, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, "7 + trigger.output[[asset='bbbbb']].amount", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, null);
	})
});

test.cb('attestation', t => {
	var db = require("../db");
	evalAAFormula(db, "attestation[[attestors=I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT, address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].email", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', (res, complexity) => {
		t.deepEqual(res, 'smith@matrix.com');
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('attestation int', t => {
	var db = require("../db");
	evalAAFormula(db, "attestation[[attestors=I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT, address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].age", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', (res, complexity, count_ops) => {
		t.deepEqual(res, 24);
		t.deepEqual(complexity, 2);
		t.deepEqual(count_ops, 2);
		t.end();
	})
});

test.cb('attestation int to string', t => {
	var db = require("../db");
	evalAAFormula(db, "attestation[[attestors=I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT, address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, type='string']].age", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', (res, complexity) => {
		t.deepEqual(res, '24');
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('attestation calc field', t => {
	var db = require("../db");
	evalAAFormula(db, "attestation[[attestors=I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT, address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]]['em'||'ail']", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 'smith@matrix.com');
		t.end();
	})
});

test.cb('attestation no field', t => {
	var db = require("../db");
	evalAAFormula(db, "attestation[[attestors=I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT, address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, ifseveral='last', ifnone='vvv']]", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, true);
		t.end();
	})
});

test.cb('attestation ifnone with field', t => {
	var db = require("../db");
	evalAAFormula(db, "attestation[[attestors=I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT, address='MXMEKGN37H5QO2A'||'WHT7XRG6LHJVVTAWU', ifseveral='last', ifnone='v'||'vv']].somefield", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 'vvv');
		t.end();
	})
});

test.cb('attestation ifnone no field', t => {
	var db = require("../db");
	evalAAFormula(db, "attestation[[attestors=this address, address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, ifseveral='last', ifnone=333, type='string']]", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', (res, complexity) => {
		t.deepEqual(res, 333);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('attestation ifnone fractional no field', t => {
	var db = require("../db");
	evalAAFormula(db, "attestation[[attestors=this address, address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, ifseveral='last', ifnone=33.3, type='auto']]", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', (res, complexity) => {
		t.deepEqual(res, '33.3');
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('attestation ifseveral abort', t => {
	var db = require("../db");
	evalAAFormula(db, "attestation[[attestors=I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT, address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, ifseveral='abort', ifnone='vvv']]", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, null);
		t.end();
	})
});

test('true', t => {
	evalFormula(null, "true", [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, true);
	});
});

test('ternary boolean 1', t => {
	evalFormula(null, '(2*2==5) ? "xx" : false', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, false);
	});
});

test('ternary boolean 2', t => {
	evalFormula(null, '(2*2==4) ? "xx" : true', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, "xx");
	});
});

test('concat boolean', t => {
	evalFormula(null, '"xx" || true', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, "xxtrue");
	});
});

test('multiply boolean', t => {
	evalFormula(null, '2 * true + 3 * false - true', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 1);
	});
});

test('min boolean', t => {
	evalFormula(null, 'min(2, true)', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 1);
	});
});

test('round boolean', t => {
	evalFormula(null, 'round(true)', [], objValidationState, "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", res => {
		t.deepEqual(res, 1);
	});
});


test.cb('balance 2 param', t => {
	var db = require("../db");
	evalAAFormula(db, "balance [MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] [base]", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', (res, complexity, count_ops) => {
		t.deepEqual(res, 10000);
		t.deepEqual(complexity, 2);
		t.deepEqual(count_ops, 2);
		t.end();
	})
});

test.cb('balance 1 param', t => {
	var db = require("../db");
	evalAAFormula(db, "balance[base]", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', (res, complexity) => {
		t.deepEqual(res, 10000);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('balance with expr and trigger', t => {
	var db = require("../db");
	var trigger = { outputs: { base: 333, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	// trigger does not affect the balances in this test, we are not processing it and filling objValidationState.assocBalances
	evalAAFormula(db, "balance['ba'||'se']", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 10000);
		t.end();
	})
});

test.cb('balance with expr', t => {
	var db = require("../db");
	evalAAFormula(db, "balance[(2==1) ? 'bad address' : 'this address']['ba'||'se']", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 10000);
		t.end();
	})
});

test.cb('balance with bad expr', t => {
	var db = require("../db");
	evalAAFormula(db, "balance[(2==2) ? 'bad address' : 'this address']['ba'||'se'] + 1", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, null);
		t.end();
	})
});

test.cb('balance with expr and concat', t => {
	var db = require("../db");
	evalAAFormula(db, "balance[this address]['ba'||'se'] || ''", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, '10000');
		t.end();
	})
});

test.cb('balance with dot param', t => {
	var db = require("../db");
	evalAAFormula(db, "balance['ba'||'se'].aaa || ''", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, null);
		t.end();
	})
});

test.cb('balance with asset not found', t => {
	var db = require("../db");
	evalAAFormula(db, "balance['s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=']", {}, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', (res, complexity) => {
		t.deepEqual(res, 0);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test('read locals +', t => {
	evalFormulaWithVars({ formula: "$volume + $price", trigger: {}, locals: { volume: 100 }, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity, count_ops) => {
		t.deepEqual(res, 100);
		t.deepEqual(count_ops, 4);
	})
});

test('read locals ||', t => {
	evalFormulaWithVars({ formula: "$volume || $price", trigger: {}, locals: { volume: 100 }, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity, count_ops) => {
		t.deepEqual(res, '100false');
		t.deepEqual(count_ops, 4);
	})
});

test('read locals with expr', t => {
	evalFormulaWithVars({ formula: "${'vo'||'lume'} || ${'nonexistent'}", trigger: {}, locals: { volume: 100 }, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, res => {
		t.deepEqual(res, '100false');
	})
});

test('read locals with expr evaluating to non-string', t => {
	evalFormulaWithVars({ formula: "${2*2} + 1", trigger: {}, locals: { volume: 100 }, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, res => {
		t.deepEqual(res, null);
	})
});

test('read locals with expr with number', t => {
	evalFormulaWithVars({ formula: "${'a'||2*2} + ${'b'||5} + 1", trigger: {}, locals: { a4: 100 }, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 101);
		t.deepEqual(count_ops, 8);
	})
});

test('assign locals', t => {
	evalFormulaWithVars({ formula: "$volume = 55+1; $x=1; $a4 + $volume + $x", trigger: {}, locals: { a4: 100 }, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, res => {
		t.deepEqual(res, 157);
	})
});

test('reassignment', t => {
	evalFormulaWithVars({ formula: "$volume = 55+1; $volume=6; $a4 + $volume", trigger: {}, locals: { a4: 100 }, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, res => {
		t.deepEqual(res, null);
	})
});

test('assign with expr', t => {
	evalFormulaWithVars({ formula: "${'vo'||'lu'||(false ? 'gg' : 'me')} = 55+1; ${'x'}=1; $a4 + $volume + ${(1==2) ? 6 : 'x'}",trigger: {}, locals: {a4: 100}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, res => {
		t.deepEqual(res, 157);
	})
});

test('if else', t => {
	evalFormulaWithVars({ formula: "if ($volume == 100) $price = 1; else $price = 2; $price", trigger: {}, locals: {volume: 100}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity, count_ops) => {
		t.deepEqual(res, 1);
		t.deepEqual(count_ops, 7);
	})
});

test('if else block', t => {
	evalFormulaWithVars({ formula: "if ($volume == 100) {$price = 1;} else $price = 2; $x=10; $price * $x", trigger: {}, locals: {volume: 100}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, res => {
		t.deepEqual(res, 10);
	})
});

test('if true block', t => {
	evalFormulaWithVars({ formula: "if ($volume == 100) $price = 1; $x=10; $price * $x", trigger: {}, locals: {volume: 100}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, res => {
		t.deepEqual(res, 10);
	})
});

test('if false block', t => {
	evalFormulaWithVars({ formula: "if ($volume < 100) $price = 1; $x=10; $price * $x", trigger: {}, locals: {volume: 100}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, res => {
		t.deepEqual(res, 0);
	})
});

test('if else if else if else', t => {
	evalFormulaWithVars({ formula: "if (1) $price = 1; else if (2) $price=2; else if (3) $price=3; else $price=4; $price ", trigger: {}, locals: {volume: 100}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, res => {
		t.deepEqual(res, 1);
	})
});

test('if else if else if else with triggers and math', t => {
	evalFormulaWithVars({ formula: "if ($volume < 100) $price = 1; else if ($volume > 100) $price=-1; else if ($z+trigger.data.a < 0) {$price=2;} else {$price=2; $y=3;} $x=10; $price * $x + $y + trigger.data.b", trigger: {}, locals: {volume: 100}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, res => {
		t.deepEqual(res, 23);
	})
});

test('nested if else', t => {
	evalFormulaWithVars({ formula: "if (1) { $a=2; if(0)$price = 1; else $price=-1; $x=10;} else if (2) $price=2; else $price=4; $price * $x * $a", trigger: {}, locals: {volume: 100}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, res => {
		t.deepEqual(res, -20);
	})
});

test.cb('state var', t => {
	evalFormulaWithVars({ formula: "var['points']", trigger: {}, locals: {volume: 100}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, '1.2345');
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('state var with address and with math', t => {
	evalFormulaWithVars({ formula: "$name='points'; var[$name] - 2 * var[this address]['poi'||'nts'] + var[I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT]['temperature'] + var['nonexistent']", trigger: {}, locals: {volume: 100}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, (-1.2345 + 18.5).toString());
		t.deepEqual(complexity, 5);
		t.end();
	})
});

test.cb('local var assignment with bStatementsOnly', t => {
	var locals = {};
	evalFormulaWithVars({ formula: "$x = 'kk'; $y = 9;", trigger: {}, locals: locals, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', bStatementsOnly: true }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(locals.x, 'kk');
		t.deepEqual(complexity, 1);
		t.end();
	})
});

test.cb('local var assignment without bStatementsOnly', t => {
	var locals = {};
	evalFormulaWithVars({ formula: "$x = 'kk'; $y = 9;", trigger: {}, locals: locals, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU',  }, (res, complexity) => {
		t.deepEqual(res, null);
		t.end();
	})
});

test.cb('state var assignment with bStateVarAssignmentAllowed and bStatementsOnly', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "var ['x'] = 'kk';", trigger: {}, locals: {volume: 100}, stateVars: stateVars, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', bStateVarAssignmentAllowed: true, bStatementsOnly: true }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(stateVars.MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU.x.value, 'kk');
		t.deepEqual(stateVars.MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU.x.updated, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('state var assignment without bStateVarAssignmentAllowed and with bStatementsOnly', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "var['x'] = 'kk';", trigger: {}, locals: {volume: 100}, stateVars: stateVars, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', bStateVarAssignmentAllowed: false, bStatementsOnly: true }, res => {
		t.deepEqual(res, null);
		t.end();
	})
});

test.cb('state var assignment with bStateVarAssignmentAllowed and without bStatementsOnly', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "var['x'] = 'kk';", trigger: {}, locals: {volume: 100}, stateVars: stateVars, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', bStateVarAssignmentAllowed: true, bStatementsOnly: false }, res => {
		t.deepEqual(res, null);
		t.end();
	})
});


test.cb('state var assignment with locals and math', t => {
	var stateVars = {MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU: {a: {value: new Decimal(10)}}};
	evalFormulaWithVars({ formula: "$b=2*var['a']; var['x'] = 'kk'||var['a']||$b; var['x']='+'||var['x']||var['player_name']||var[I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT]['temperature'];", trigger: {}, locals: {volume: 100}, stateVars: stateVars, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', bStateVarAssignmentAllowed: true, bStatementsOnly: true }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(stateVars.MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU.x.value, '+kk1020John18.5');
		t.deepEqual(stateVars.MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU.x.updated, true);
		t.deepEqual(complexity, 8);
		t.end();
	})
});

test('sha256', t => {
	var str = 'abcd';
	var hash = crypto.createHash("sha256").update(str, "utf8").digest("base64");
	evalFormulaWithVars({ formula: "sha256('ab'||'cd')", trigger: {}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, hash);
		t.deepEqual(complexity, 2);
	})
});

test('sha256 with true', t => {
	var str = 'true';
	var hash = crypto.createHash("sha256").update(str, "utf8").digest("base64");
	evalFormulaWithVars({ formula: "sha256 (trigger.data)", trigger: { data: {a: 5}}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, hash);
		t.deepEqual(complexity, 2);
	})
});

test('sha256 with false', t => {
	var str = 'false';
	var hash = crypto.createHash("sha256").update(str, "utf8").digest("base64");
	evalFormulaWithVars({ formula: "sha256(trigger.data.nonex)", trigger: { data: {a: 5}}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, hash);
		t.deepEqual(complexity, 2);
	})
});

test('sha256 with numbers', t => {
	var str = '2';
	var hash = crypto.createHash("sha256").update(str, "utf8").digest("base64");
	evalFormulaWithVars({ formula: "sha256(1+1)", trigger: {}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, hash);
		t.deepEqual(complexity, 2);
	})
});

test.cb('signature verification', t => {
	var db = require("../db");
	var mnemonic = new Mnemonic();
	var xPrivKey = mnemonic.toHDPrivateKey().derive("m/44'/0'/0'/0/0");
	var pubkey = xPrivKey.publicKey.toBuffer().toString("base64");
	var definition = ["sig", {"pubkey": pubkey}];
	var address = objectHash.getChash160(definition);

	var trigger = {
		data: {
			signed_package: {
				signed_message: {
					order: 11,
					pair: "GB/USD",
					amount: 1.23,
					price: 42.3
				},
				version: '2.0',
				last_ball_unit: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
				authors: [{
					address: address,
					definition: definition,
					authentifiers: {'r': '-------------'}
				}]
			}
		}
	};
	var hash = objectHash.getSignedPackageHashToSign(trigger.data.signed_package);
	var signature = ecdsaSig.sign(hash, xPrivKey.privateKey.bn.toBuffer({ size: 32 }));
	trigger.data.signed_package.authors[0].authentifiers.r = signature;
//	trigger.data.signed_package.signed_message.order = 12;
	evalFormulaWithVars({ conn: db, formula: "is_valid_signed_package(trigger.data.signed_package, '"+address+"')", trigger: trigger, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test('otherwise true with trigger', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } } };
	evalAAFormula(0, "trigger.data.key1 otherwise 66", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, "val1");
	})
});

test('otherwise false with trigger', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } } };
	evalAAFormula(0, "trigger.data.key1111 otherwise 66", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 66);
	})
});

test('triple otherwise with trigger', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } } };
	evalAAFormula(0, "trigger.data.key1111 otherwise trigger.data.xxxx otherwise trigger.data.key1 otherwise 66", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, "val1");
	})
});

test('triple otherwise with ternary and trigger', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } } };
	evalAAFormula(0, "trigger.data.key2 ? 0 : 'ss' otherwise trigger.data.xxxx otherwise trigger.data.key1 otherwise 66", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, "val1");
	})
});

test('response', t => {
	var responseVars = {};
	evalFormulaWithVars({ formula: "response['zzz'] = 99;", trigger: {}, locals: { a4: 100 }, responseVars: responseVars, objValidationState: objValidationState, bStatementsOnly: true, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, true);
		t.deepEqual(responseVars.zzz, 99);
	})
});

test('reading response', t => {
	var responseVars = {};
	evalFormulaWithVars({ formula: "$a = response['zzz'];", trigger: {}, locals: { a4: 100 }, responseVars: responseVars, objValidationState: objValidationState, bStatementsOnly: true, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, null);
	})
});

test('formula in response', t => {
	var responseVars = {};
	evalFormulaWithVars({ formula: "response ['zz'||'z'] = 99; 2*2", trigger: {}, locals: { a4: 100 }, responseVars: responseVars, objValidationState: objValidationState, bStatementsOnly: false, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, 4);
		t.deepEqual(responseVars.zzz, 99);
	})
});

test('large number in response', t => {
	var responseVars = {};
	evalFormulaWithVars({ formula: "response['z'] = 5e308;", trigger: {}, locals: { a4: 100 }, responseVars: responseVars, objValidationState: objValidationState, bStatementsOnly: true, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, null);
	})
});

test('response unit', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "var['unit'] = response_unit;", trigger: {}, locals: { a4: 100 }, stateVars: stateVars, objValidationState: objValidationState, bStatementsOnly: true, bStateVarAssignmentAllowed: true, response_unit: 'theunit', address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, true);
		t.deepEqual(stateVars.MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU.unit.value, 'theunit');
	})
});

test('misplaced response unit', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "var['unit'] = response_unit;", trigger: {}, locals: { a4: 100 }, stateVars: stateVars, objValidationState: objValidationState, bStatementsOnly: true,  response_unit: 'theunit', address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, null);
	})
});

test('double !! false', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "!!trigger.data.xxx", trigger: {}, locals: { a4: 100 }, stateVars: stateVars, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, false);
	})
});

test('double !! true', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "!!trigger.data.xxx", trigger: { data: { xxx: 55 } }, locals: { a4: 100 }, stateVars: stateVars, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, true);
	})
});

test('double !! false 0', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "!!trigger.data.xxx", trigger: { data: { xxx: 0 } }, locals: { a4: 100 }, stateVars: stateVars, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, false);
	})
});

test('double !! false empty string', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "!!trigger.data.xxx", trigger: { data: { xxx: '' } }, locals: { a4: 100 }, stateVars: stateVars, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, false);
	})
});

test('AND is interrupted after first false', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "trigger.data.xxx AND var[trigger.data.xxx]", trigger: { data: { a: '' } }, locals: { a4: 100 }, stateVars: stateVars, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, false);
	})
});

test('OR is interrupted after first true', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "trigger.data.a OR var[trigger.data.xxx]", trigger: { data: { a: 'aaa' } }, locals: { a4: 100 }, stateVars: stateVars, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, true);
	})
});

test('bounce expr', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalAAFormula(0, "bounce('error message')", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, null);
	})
});

test('bounce expr false', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalAAFormula(0, "(1==2) ? bounce('error message') : 8", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 8);
	})
});

test('bounce statement true', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalAAFormula(0, "if (1==1) bounce('error message'); 7", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, null);
	})
});

test('bounce statement false', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalAAFormula(0, "if (1==2) bounce('error message');\n7", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 7);
	})
});

test('return expr', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalAAFormula(0, "if (1==1) return 'aaa'; 3", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 'aaa');
	})
});

test('return expr false', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalAAFormula(0, "if (1==2) return 'aaa'; 3", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 3);
	})
});

test('return false', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalAAFormula(0, "if (1==1) return false; $a=is_valid_signed_package('invalid', 'invalid'); 3", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, false);
	})
});

test('empty return', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalAAFormula(0, "if (1==2) return; 3", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, null);
	})
});

test('empty return with statements', t => {
	evalFormulaWithVars({ formula: "if (1==1) return; $a=9;", trigger: {}, locals: { a4: 100 }, stateVars: {}, objValidationState: objValidationState, bStatementsOnly: true, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, true);
	})
});

test('non-empty return with statements', t => {
	evalFormulaWithVars({ formula: "if (1==2) return 'aa'; $a=9;", trigger: {}, locals: { a4: 100 }, stateVars: {}, objValidationState: objValidationState, bStatementsOnly: true, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, null);
	})
});

test('local vars with selectors', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalFormulaWithVars({ formula: "$a=trigger.data.key2; $b=trigger.data.key1; $a.key4||$a||$a.xxx||$b.xxx", trigger: trigger, locals: { a4: 100 }, stateVars: {}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, "444truefalsefalse");
	})
});

test('assignment to local var with selector', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalFormulaWithVars({ formula: "$a.x=1; true", trigger: trigger, locals: { a4: 100 }, stateVars: {}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, null);
	})
});

test('local vars with selectors by expr', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalFormulaWithVars({ formula: "$a=trigger.data.key2; $a['key'||'4']", trigger: trigger, locals: { a4: 100 }, stateVars: {}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, 444);
	})
});

test('line comment', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalFormulaWithVars({ formula: "$a=11; // a comment\n$a-1", trigger: trigger, locals: { a4: 100 }, stateVars: {}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, 10);
	})
});

test('comment', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalFormulaWithVars({ formula: "$a=11; /* a\n comment */ $a-1", trigger: trigger, locals: { a4: 100 }, stateVars: {}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, 10);
	})
});

test('comment within string', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalFormulaWithVars({ formula: "$a='xx /* a\n comment */ yyy'; $a", trigger: trigger, locals: { a4: 100 }, stateVars: {}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, 'xx /* a\n comment */ yyy');
	})
});

test('line comment within string', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	evalFormulaWithVars({ formula: "$a='xx // a\n comment yyy'; $a", trigger: trigger, locals: { a4: 100 }, stateVars: {}, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, 'xx // a\n comment yyy');
	})
});

test.cb('var += assignment', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	var stateVars = { MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU: { x: { value: new Decimal(8) } } };
	evalFormulaWithVars({ formula: "var['x'] += 1+2; var['y'] ||= '2';", trigger: trigger, locals: { a4: 100 }, stateVars: stateVars, bStatementsOnly: true, bStateVarAssignmentAllowed: true, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 3);
		t.deepEqual(stateVars.MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU.x.value.toNumber(), 11);
		t.deepEqual(stateVars.MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU.y.value, 'false2');
		t.end();
	})
});

test('local var += assignment', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	var stateVars = {  };
	evalFormulaWithVars({ formula: "$x += 3;", trigger: trigger, locals: { a4: 100 }, stateVars: stateVars, bStatementsOnly: true, bStateVarAssignmentAllowed: true, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, null);
	})
});

test('var += string assignment', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	var stateVars = { MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU: { x: { value: new Decimal(8) } } };
	evalFormulaWithVars({ formula: "var['x'] += '2';", trigger: trigger, locals: { a4: 100 }, stateVars: stateVars, bStatementsOnly: true, bStateVarAssignmentAllowed: true, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, null);
	})
});

test('long var assignment', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	var stateVars = { MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU: { x: { value: new Decimal(8) } } };
	evalFormulaWithVars({ formula: "var['x'] = '"+'a'.repeat(1025)+"';", trigger: trigger, locals: { a4: 100 }, stateVars: stateVars, bStatementsOnly: true, bStateVarAssignmentAllowed: true, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, null);
	})
});

test('long var name assignment', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", key2: { key3: "val3", key4: 444 } }, outputs: { base: 555 } };
	var stateVars = { MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU: { x: { value: new Decimal(8) } } };
	evalFormulaWithVars({ formula: "var['"+'a'.repeat(129)+"'] = 'c';", trigger: trigger, locals: { a4: 100 }, stateVars: stateVars, bStatementsOnly: true, bStateVarAssignmentAllowed: true, objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, null);
	})
});

test('asset base', t => {
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ formula: "asset['base'].cap", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, 1e15);
	})
});

test('asset base with formula', t => {
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ formula: "asset['ba'||'se']['is_'||'transferrable']", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, true);
	})
});

test.cb('asset non-base cap', t => {
	var db = require("../db");
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ conn: db, formula: "asset['oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0='].cap", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, 6000);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('asset non-base is_issued false', t => {
	var db = require("../db");
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ conn: db, formula: "asset['oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0='].is_issued", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, false);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('asset non-base is_issued true', t => {
	var db = require("../db");
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ conn: db, formula: "asset['DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8='].is_issued", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('asset non-base auto_destroy', t => {
	var db = require("../db");
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ conn: db, formula: "asset['DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=']['auto_destroy']", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, false);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test('mci', t => {
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: "mci + 1", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, 1001);
		t.deepEqual(complexity, 1);
	})
});

test('timestamp', t => {
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: "timestamp + 1", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, 1.5e9+1);
		t.deepEqual(complexity, 1);
	})
});

test('json_stringify', t => {
	var trigger = { data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}} };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: "json_stringify(trigger.data)", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, '{"ww":{"aa":8,"dd":"h"},"z":["z",9,"ak"]}');
		t.deepEqual(complexity, 1);
	})
});

test('json_stringify number', t => {
	var trigger = { data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}} };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: "json_stringify(trigger.data.ww.aa)", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, '8');
		t.deepEqual(complexity, 1);
	})
});

test('json_stringify large number', t => {
	var trigger = { data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}} };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: "json_stringify(5e308)", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, null);
	})
});

test('json_parse', t => {
	var trigger = { data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}} };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: `json_parse('{"ww":{"aa":8,"dd":"h"},"z":["z",9,"ak"]}')`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, bObjectResultAllowed: true, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}});
		t.deepEqual(complexity, 2);
	})
});

test('json_parse invalid json', t => {
	var trigger = { data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}} };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: `json_parse('{"ww":{"aa":8,"dd":"h"},"z":["z",9,"ak"]')`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, bObjectResultAllowed: true, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, false);
		t.deepEqual(complexity, 2);
	})
});

test('json_parse not a string', t => {
	var trigger = { data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}} };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: `json_parse(8)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, bObjectResultAllowed: true, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, null);
	})
});

test('json_parse object with object result', t => {
	var trigger = { data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}} };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: `json_parse(trigger.data.ww)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, bObjectResultAllowed: true, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, true);
	})
});

test('json_parse object with scalar result', t => {
	var trigger = { data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}} };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: `json_parse(trigger.data.ww)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, bObjectResultAllowed: false, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, true);
	})
});

test('json_parse scalar with object result', t => {
	var trigger = { data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}} };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: `json_parse(trigger.data.ww.aa)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, bObjectResultAllowed: true, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, 8);
	})
});

test('json_parse scalar with scalar result', t => {
	var trigger = { data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}} };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: `json_parse(trigger.data.ww.aa)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, bObjectResultAllowed: false, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, 8);
	})
});

test('this_address', t => {
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ conn: null, formula: `this_address || '@'`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU@');
	})
});

test('very long string', t => {
	var trigger = {  };
	var stateVars = {};
	var str = 'a'.repeat(1000);
	evalFormulaWithVars({ conn: null, formula: `$x="${str}"; $y=$x||$x; $z=$y||$y; $w=$z||$z; $w`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, null);
	})
});

test('trigger.initial_address', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", initial_address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `trigger.address == trigger.initial_address`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, true);
	})
});

test('underflow', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", initial_address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `2e-324`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, 0);
	})
});

test('mod', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `11+8%3`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, 13);
	})
});

test('fractional mod', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `1%0.9`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, '0.1');
		t.deepEqual(count_ops, 2);
	})
});

test('fractional negative mod', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `1%(-0.9)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, '0.1');
		t.deepEqual(count_ops, 3);
	})
});

test.cb('mod assignment', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = { MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU: {x: { value: new Decimal(47) } } };
	evalFormulaWithVars({ conn: null, formula: `var['x'] %= 3;`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', bStatementsOnly: true, bStateVarAssignmentAllowed: true}, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(stateVars.MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU.x.value.toNumber(), 2);
		t.end();
	})
});

test('mc_unit', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `(1==2) ? 6 : mc_unit`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=');
		t.deepEqual(count_ops, 4);
	})
});

test('number_from_seed', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `number_from_seed("vvv")`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, '0.240886496464544');
		t.deepEqual(count_ops, 2);
	})
});

test('int number_from_seed', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `number_from_seed("vvv", 99)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 24);
		t.deepEqual(count_ops, 2);
	})
});

test('int number_from_seed with min', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `number_from_seed("vvv", 10, 109)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 34);
		t.deepEqual(count_ops, 2);
	})
});

test('number_from_seed too many params', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT" };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `number_from_seed("vvv", 10, 99, 77)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, null);
	})
});


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
MDYwEAYHKoZIzj		0CAQYF   K4EEABwDIgAE3NnCLe  9V/CnfPGidbHKBTYOfqlncIBF7\n\
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
			pem_key: "-----BEGIN PUBLIC KEY-----MDQwEAYHKoZIzj0CAQYFZysBBAQDIAAEASXF52NqXzD0LTJITPpFAdCSnjmAbbOdwweGdisD\n\
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
		t.deepEqual(complexity, 3);
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
		t.deepEqual(complexity, 3);
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
		t.deepEqual(complexity, 3);
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
		t.deepEqual(complexity, 3);
		t.end();
	})
});


