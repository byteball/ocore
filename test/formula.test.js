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
	storage_size: 200,
	assocBalances: {},
	arrPreviousResponseUnits: [],
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


test.after.always(t => {
	console.log('***** formula.test done');
});

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

test.cb('validate datafeed this address', t => {
	validateFormula("data_feed[[oracles=this address, feed_name=\"test\"]]", 0, res => {
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

test('trigger.data with numeric index', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", arr: ['gg', 9] }, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, " trigger.data.arr[0]", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, "gg");
	})
});

test('$local_var with numeric index', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", arr: ['gg', 9] }, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, "$d = trigger.data; $d.arr.1", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 9);
	})
});

test('$local_var with object under numeric index', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { key1: "val1", arr: ['gg', {h: 88}, 4] }, outputs: { base: 555, "s7GXNHSjRVIS6ohoDclYF/LbCnrRdBP429qLbBGWGMo=": 777 } };
	evalAAFormula(0, "$d = trigger.data; $d.arr.1.h + trigger.data.arr.2", trigger, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, 92);
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

test.cb('response unit', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "var['unit'] = response_unit;", trigger: {}, locals: { a4: 100 }, stateVars: stateVars, objValidationState: objValidationState, bStatementsOnly: true, bStateVarAssignmentAllowed: true, objResponseUnit: {unit: 'theunit'}, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
		t.deepEqual(res, true);
		t.deepEqual(stateVars.MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU.unit.value, 'theunit');
		t.end();
	})
});

test('misplaced response unit', t => {
	var stateVars = {};
	evalFormulaWithVars({ formula: "var['unit'] = response_unit;", trigger: {}, locals: { a4: 100 }, stateVars: stateVars, objValidationState: objValidationState, bStatementsOnly: true,  robjResponseUnit: {unit: 'theunit'}, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, res => {
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

test.cb('asset non-existing', t => {
	var db = require("../db");
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ conn: db, formula: "asset['xx'||''].exists", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, false);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('asset exists', t => {
	var db = require("../db");
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ conn: db, formula: "asset['oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0='].exists", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, true);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('asset definer_address', t => {
	var db = require("../db");
	var trigger = {  };
	var stateVars = {  };
	evalFormulaWithVars({ conn: db, formula: "asset['oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0='].definer_address", trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity) => {
		t.deepEqual(res, 'BVVJ2K7ENPZZ3VYZFWQWK7ISPCATFIW3');
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
		t.deepEqual(res, 8);
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

test('typeof', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `typeof("vvv") || typeof(trigger.data) || typeof(2*2) || typeof(2==3)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'stringobjectnumberboolean');
	})
});

test('length', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `length("vvv") || length(trigger.data) || length(20*20) || length(2==3)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, '3435');
	})
});

test('is_valid_address', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `is_valid_address("MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU") || is_valid_address(trigger.data.z) || is_valid_address(20*20) || is_valid_address(2==3)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'truefalsefalsefalse');
		t.deepEqual(complexity, 5);
	})
});

test('is_valid_address bad string literal', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `is_valid_address("bbb")`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, false);
	})
});

test('is_valid_address bad type', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `is_valid_address(88)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, false);
	})
});

test('starts_with ends_with contains', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `starts_with("abcd", "abc") || starts_with('abcd', 'cd') || ends_with('abcd', 'cd') || ends_with("abcd", "abc") || contains('abcd', 'bc') || contains('abcd', 'x')`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'truefalsetruefalsetruefalse');
		t.deepEqual(complexity, 1);
	})
});

test('index_of', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `index_of("abcd", "cd") || index_of('abcd', 'z')`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, '2-1');
		t.deepEqual(complexity, 1);
	})
});

test('substring', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `substring("abcd", 1) || ' ' || substring('abcd', -2) || ' ' || substring('abcd', 1, 2) || ' ' || substring("abcd", 1, 100) || ' ' || substring('abcd', -2, 100)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'bcd cd bc bcd cd');
		t.deepEqual(complexity, 1);
	})
});

test('substring with string index', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `substring("abcd", 'd'||'')`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 1);
	})
});

test('timestamp_to_string', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `timestamp_to_string(timestamp)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, '2017-07-14T02:40:00Z');
		t.deepEqual(complexity, 1);
	})
});

test('timestamp_to_string date and time', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `timestamp_to_string(timestamp, 'date') || ' at ' || timestamp_to_string(timestamp, 'time')`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, '2017-07-14 at 02:40:00');
		t.deepEqual(complexity, 1);
	})
});

test('timestamp_to_string invalid', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `timestamp_to_string(timestamp, 'cc')`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, null);
	})
});

test('parse_date', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `parse_date('1970-01-01') || ' ' || parse_date('2017-07-14T02:40:00Z') || ' ' || parse_date('2017-07-14T02:41:00')`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, '0 1500000000 1500000060');
		t.deepEqual(complexity, 1);
	})
});

test('parse_date invalid', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `parse_date('1970-01-32') || ' ' || parse_date('bb') || ' ' || parse_date(8)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'false false false');
		t.deepEqual(complexity, 1);
	})
});

test('storage_size', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `storage_size + 10`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 210);
		t.deepEqual(complexity, 1);
	})
});

test.cb('is_aa', t => {
	var db = require("../db");
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: db, formula: `is_aa(this_address) || is_aa('MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU') || is_aa(2*2) || is_aa('JPQKPRI5FMTQRJF4ZZMYZYDQVRD55OTC')`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'truetruefalsefalse');
		t.deepEqual(complexity, 5);
		t.end();
	})
});

test.cb('is_aa invalid literal', t => {
	var db = require("../db");
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: 8}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: db, formula: `is_aa(6)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, false);
		t.end();
	})
});

test('is_integer', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: '8', bb: '-7'}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `is_integer(trigger.data.z.1) || is_integer(trigger.data.ww.aa) || is_integer(trigger.data.ww.bb) || is_integer(trigger.data.z) || is_integer(trigger.data.ww.dd)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'truetruetruefalsefalse');
		t.deepEqual(complexity, 1);
	})
});

test('is_integer invalid', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: '8', bb: '-7'}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `is_integer('nn')`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, false);
	})
});

test('is_valid_amount', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { z: ['z', 9, 'ak'], ww: {dd: 'h', aa: '8', bb: '-7', cc: 9.9e15}}  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `is_valid_amount(trigger.data.z.1) || is_valid_amount(trigger.data.ww.aa) || is_valid_amount(trigger.data.ww.bb) || is_valid_amount(trigger.data.z) || is_valid_amount(trigger.data.ww.dd) || is_valid_amount(trigger.data.ww.cc)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'truetruefalsefalsefalsefalse');
		t.deepEqual(complexity, 1);
	})
});

test('selector with search criteria', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `$x=trigger.data; $x.messages[[.app = 'payment', .payload.asset != 'ff', .payload.outputs.0.amount > 10]].payload.asset`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'sss');
		t.deepEqual(complexity, 1);
	})
});

test('selector with search criteria and 2 payments', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {asset: 'asset2', outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `$x=trigger.data; $x.messages[[.app = 'payment', .payload.asset = 'sss', .payload.outputs.0.amount > 10]].payload.outputs.address`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'ADDR');
		t.deepEqual(complexity, 1);
	})
});

test('2 selectors with search criteria and 2 payments', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {asset: 'asset2', outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `$x=trigger.data; $x.messages[[.app = 'payment', .payload.asset = 'sss', .payload.outputs.0.amount > 10]].payload.outputs[[.address!=9]].address`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'ADDR');
		t.deepEqual(complexity, 1);
	})
});

test('selector with search criteria and none', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `$x=trigger.data; $x.messages[[.app = 'payment', .payload.asset = none, .payload.outputs.0.amount > 10]].payload.outputs.amount`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 5000);
		t.deepEqual(complexity, 1);
	})
});

test('selector with search criteria and !=none', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `$x=trigger.data; $x.messages[[.app = 'payment', .payload.asset != none, .payload.outputs.0.amount > 10]].payload.outputs.amount`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 1000);
		t.deepEqual(complexity, 1);
	})
});

test('selector with search criteria and deep none', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `$x=trigger.data; $x.messages[[ .payload.asset = none, .payload.outputs.0.amount = none]].payload.age`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 88);
		t.deepEqual(complexity, 1);
	})
});

test('selector with search criteria and deep !=none', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `trigger.data.messages[[ .payload.asset = none, .payload.outputs.0.amount != none]].payload.outputs.amount`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 5000);
		t.deepEqual(complexity, 1);
	})
});

test('selector with search criteria and 2-element array after filtering', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `$x=trigger.data; $x.messages[[ .app = 'payment', .payload.outputs.0.amount != none]].payload.outputs.amount`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, false);
		t.deepEqual(complexity, 1);
	})
});

test('is_array', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `is_array(trigger.data.messages) || is_array(trigger.data.messages.0) || is_array(trigger.data.messages.0.app) || is_array(trigger.data.nonexistent)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'truefalsefalsefalse');
		t.deepEqual(complexity, 1);
	})
});

test('is_assoc', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `is_assoc(trigger.data.messages) || is_assoc(trigger.data.messages.0) || is_assoc(trigger.data.messages.0.app) || is_assoc(trigger.data.nonexistent)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'falsetruefalsefalse');
		t.deepEqual(complexity, 1);
	})
});

test('array_length', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `array_length(trigger.data.messages)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 3);
		t.deepEqual(complexity, 1);
	})
});

test('array_length invalid obj', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `array_length(trigger.data)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 1);
	})
});

test('array_length invalid scalar', t => {
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: null, formula: `array_length(trigger.data.messages[0].app)`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, null);
		t.deepEqual(complexity, 1);
	})
});

test.cb('unit', t => {
	var db = require("../db");
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: db, formula: `unit['oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0='].authors[0].address`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W');
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('unit and var', t => {
	var db = require("../db");
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: db, formula: `$u = unit['oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=']; $u.authors[0].address`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W');
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('unit selector and var', t => {
	var db = require("../db");
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: db, formula: `$u = unit['oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0='].authors; $u[0].address`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, 'TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W');
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('unit not found', t => {
	var db = require("../db");
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	evalFormulaWithVars({ conn: db, formula: `unit['4ne7myhibBARgaA/PPwynnK408bmY7ypL/+X+tp0IqU='].authors[0].address`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU'}, (res, complexity, count_ops) => {
		t.deepEqual(res, false);
		t.deepEqual(complexity, 2);
		t.end();
	})
});

test.cb('unit and response_unit', t => {
	var db = require("../db");
	var trigger = { address: "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", data: { messages: [{app: 'payment', payload: {asset: 'sss', outputs: [{amount: '1000', address: 'ADDR'}]}}, {app: 'profile', payload: {name: 'John', age: 88}}, {app: 'payment', payload: {outputs: [{amount: 5000, address: 'ADDR2'}]}},] }  };
	var stateVars = {};
	var objResponseUnit = { unit: 'C2sUTptm3d55Q9qTYau4Wdq1ppLgZEC2snsVv78krkE=', authors: [{ address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU' }], messages: [{ app: 'profile', payload: { humidity: 78 } }, { app: 'payment', payload: { outputs: [{ address: 'OYW2XTDKSNKGSEZ27LMGNOPJSYIXHBHC', amount: 5000 }] } }] };
	evalFormulaWithVars({ conn: db, formula: `var['x'] = unit[response_unit].authors[0].address || ' ' || unit[response_unit].messages[[.app='profile']].payload.humidity;`, trigger: trigger, locals: {  }, stateVars: stateVars,  objValidationState: objValidationState, address: 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', bStatementsOnly: true, bStateVarAssignmentAllowed: true, objResponseUnit}, (res, complexity, count_ops) => {
		t.deepEqual(res, true);
		t.deepEqual(stateVars.MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU.x.value, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU 78');
		t.deepEqual(complexity, 4);
		t.end();
	})
});
