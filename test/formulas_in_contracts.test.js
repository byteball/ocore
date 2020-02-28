var path = require('path');
var desktop_app = require('../desktop_app.js');
desktop_app.getAppDataDir = function() { return __dirname + '/.testdata-' + path.basename(__filename); }

var test = require('ava');

var definition = require("../definition");
var formulaParser = require("../formula/index");
var constants = require('../constants.js');
require('./_init_datafeeds.js');
constants.formulaUpgradeMci = 0;

function validateFormula(formula, complexity, cb) {
	formulaParser.validate({formula: formula, complexity: complexity}, cb);
}

var objUnit = {
	messages: [{
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
				{ "address": "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", "amount": 19088 },
				{ "address": "GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN", "amount": 1 }
			]
		}
	}]
};

var objValidationState = {
	last_ball_mci: 1000,
	last_ball_timestamp: 1.5e9,
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
};


test.after.always(t => {
	console.log('***** formulas_in_contracts.test done');
});

test('formula - validate formula - ok', t => {
	validateFormula("10 + 10 == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - validate authentifiers in formula - ok ', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "10 + 10 == 20"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate formula (data_feed, input, output) - ok', t => {
	validateFormula("data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"Test\", min_mci=\"1\"]] * input[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20 / output[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - validate formula (data_feed, input, output) 2 oracles - ok', t => {
	validateFormula("data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:\"||this_address, feed_name=\"Test\", min_mci=\"1\"]] * input[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20 / output[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - validate calculation 1 - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount - 912 == output[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate this_address - ok', async (t) => {
	var signature = require('../signature');
	signature.verify = function () {
		return true;
	};
	let result = await new Promise(resolve => {
		definition.validateAuthentifiers({}, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', null,
			['and',
				[
					['sig', {pubkey: 'AoKzoVEoN6CpH1Vfi6Vnn0PS9BBJ9Ld92Nh8RCeOAqQI'}],
					['formula', "input[[address=this_address]].amount == 20000"]
				]
			], objUnit, objValidationState, {'r.0': 'AoKzoVEoN6CpH1Vfi6Vnn0PS9BBJ9Ld92Nh8RCeOAqQI'}, function (err, res) {
				return resolve({err, res});
			});
	});
	t.is(result.res, true);
	t.is(result.err, null);
});

test('formula - validate calculation 2 - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 60000 /3 * 4 / 4"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate calculation decimal 1 - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "10 == 10"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - amount !=', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[[asset=base]].amount != output[[asset=base, address=GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN]].amount"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - amount = 1', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "output[[asset=base, amount=1]].amount == 1"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - invalid formula', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "out77put[[asset=base, amount=1]].amount == 1"], objUnit, objValidationState, null, function (err, res) {
		t.is(err, 'parse error');
	});
});

test('formula - amount != 2 - ambiguous', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "output[[asset=base, amount!=2]].amount == 1"], objUnit, objValidationState, null, function (err, res) {
		t.is(err, null);
		t.is(res, false);
	});
});

test('formula - asset - asset ambiguous', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[[asset=base]].asset != output[[asset=base]].asset"], objUnit, objValidationState, null, function (err, res) {
		t.is(err, null);
		t.is(res, false);
	});
});

test('formula - address - amount !=', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].asset != output[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].asset"], objUnit, objValidationState, null, function (err, res) {
		t.is(err, null);
		t.is(res, false);
	});
});

test('formula - asset ==', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "output[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].asset == input[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].asset"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - address ==', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "output[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].address == input[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].address"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate calculation decimal 2 - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "0.1 + 0.2 == 0.3"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - incorrect min_mci - error', t => {
	validateFormula("data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"Test\", min_mci=\"-1\", abra=\"te\"]] == 10", 0, function (result) {
		t.not(result.error.match(/parse error/), null);
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - not equal - error', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == output[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - amount in input - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, amount>10]].amount == output[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount"], objUnit, objValidationState, null, function (err, res) {
		t.is(err, null);
		t.is(res, false);
	});
});

test('formula - min - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "min(2,5,7) == 2"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - max - error', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "max(2,5,7) == 2"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - pow - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "2^9 == 512"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - round - 2 - error', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "round(2.9) == 2"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - round - 3 - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "round(2.9) == 3"], objUnit, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - Incorrect data_feed(no parameter feed_name) - error', t => {
	validateFormula("data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"]] ", 0,
		(result) => {
			t.is(result.error, 'no oracles or feed name');
		//	t.deepEqual(result.complexity, 1);
		});
});

test('formula - without parameters in data_feed - error', t => {
	validateFormula("data_feed[[]] ", 0,
		(result) => {
			t.is(result.error, 'parse error');
		//	t.deepEqual(result.complexity, 1);
		});
});

test('formula - incorrect address in input - error', t => {
	validateFormula("input[[address=TEST]].amount == 20 ", 0,
		(result) => {
			t.is(result.error, 'parse error');
		//	t.deepEqual(result.complexity, 2);
		});
});

test('formula - incorrect address in output - error', t => {
	validateFormula("  output[[address=TEST]].amount", 0,
		(result) => {
			t.is(result.error, 'parse error');
		//	t.deepEqual(result.complexity, 2);
		});
});

test('formula - without parameters in output - error', t => {
	validateFormula(" 20 / output[[]].amount", 0,
		(result) => {
			t.is(result.error, 'parse error');
		//	t.deepEqual(result.complexity, 2);
		});
});

test('formula - without parameters in input - error', t => {
	validateFormula("20 / input[[]].amount", 0,
		(result) => {
			t.is(result.error, 'parse error');
		//	t.deepEqual(result.complexity, 2);
		});
});


test('formula - input_x0 - error', t => {
	validateFormula("input_x0.amount * outputs_x1.amount == 10", 2,
		(result) => {
			t.not(result.error.match(/parse error/), null);
			t.deepEqual(result.complexity, 2);
		});
});

test('formula - invalid operator in feed_name - error', t => {
	validateFormula("data_feed[[feed_name>\"test\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"]] == 20", 0, (result) => {
		t.is(result.error, 'not =');
	//	t.deepEqual(result.complexity, 1);
	});
});

test('formula - =name=name in feed_name - error', t => {
	validateFormula("data_feed[[feed_name=name=\"name\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"]] == 20", 0, (result) => {
		t.not(result.error.match(/Incorrect data_feed/, null));
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - empty value in feed_name - error', t => {
	validateFormula("data_feed[[feed_name=\"\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"]] == 20", 0, (result) => {
		t.is(result.error, 'empty feed name');
	//	t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect operator in oracles - error', t => {
	validateFormula("data_feed[[feed_name=\"t\", oracles>\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"]] == 20", 0, (result) => {
		t.is(result.error, 'not =');
	//	t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect param in data_feed - error', t => {
	validateFormula("data_feed[[feed_name=\"test\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", hi=\"kyky\"]] == 20", 0,
		(result) => {
			t.not(result.error.match(/Incorrect data_feed/, null));
			t.deepEqual(result.complexity, 0);
		});
});

test('formula - identical data_feed - ok', t => {
	validateFormula("data_feed[[feed_name=\"test\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"]] == data_feed[[feed_name=\"test\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"]]", 0,
		(result) => {
			t.is(result.error, false);
			t.deepEqual(result.complexity, 2);
		});
});
test('formula - identical data_feed - error', t => {
	validateFormula("data_feed[[feed_name=\"test\", oracles>\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"]] == data_feed[[feed_name=\"test\", oracles>\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"]]", 0,
		(result) => {
			t.is(result.error, 'not =');
		//	t.deepEqual(result.complexity, 1);
		});
});

test('formula - correct operator in address in input - ok', t => {
	validateFormula("input[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - correct operator in address in input - ok - 2', t => {
	validateFormula("input[[address!=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - correct operator in asset in input - ok - 1', t => {
	validateFormula("input[[asset='p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=']].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - incorrect value in asset in input - error - 1', t => {
	validateFormula("input[[asset=test]].amount == 20", 0, (result) => {
		t.is(result.error, 'parse error');
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - != operator in asset in input - ok', t => {
	validateFormula("input[[asset!='p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=']].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - incorrect operator in address in input - error', t => {
	validateFormula("input[[address>MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20", 0, (result) => {
		t.is(result.error, 'input not valid: not allowed: >');
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - incorrect operator in address in input - error - 2', t => {
	validateFormula("input[[address<=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20", 0, (result) => {
		t.is(result.error, 'input not valid: not allowed: <=');
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - incorrect operator in address in input - error - 3', t => {
	validateFormula("input[[address>=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20", 0, (result) => {
		t.is(result.error, 'input not valid: not allowed: >=');
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - incorrect param in input - error', t => {
	validateFormula("input[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, bb=bb]].amount == 20", 0, (result) => {
		t.not(result.error.match(/Incorrect input/, null));
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - correct operator in address in output - ok', t => {
	validateFormula("output[[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - correct operator in address in output - ok - 2', t => {
	validateFormula("output[[address!=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20", 1, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - correct operator in asset in output - ok - 1', t => {
	validateFormula("output[[asset='p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=']].amount == 20", 1, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - != operator in asset in output - ok', t => {
	validateFormula("output[[asset!='p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=']].amount == 20", 5, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 5);
	});
});

test('formula - incorrect operator in address in output - error', t => {
	validateFormula("output[[address>MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20", 0, (result) => {
		t.is(result.error, 'output not valid: not allowed: >');
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - incorrect operator in address in output - error - 2', t => {
	validateFormula("output[[address<=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20", 0, (result) => {
		t.is(result.error, 'output not valid: not allowed: <=');
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - incorrect operator in address in output - error - 3', t => {
	validateFormula("output[[address>=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]].amount == 20", 0, (result) => {
		t.is(result.error, 'output not valid: not allowed: >=');
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - this_address in input - ok', t => {
	validateFormula("input[[address=this_address]].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - other address in input - ok', t => {
	validateFormula("input[[address!=this_address]].amount == 20", 3, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 3);
	});
});

test('formula - this_address in output - error', t => {
	validateFormula("output[[address=this_address]] == 20", 3, (result) => {
		t.not(result.error.match(/parse error/), null);
		t.deepEqual(result.complexity, 3);
	});
});
test('formula - this_address in output - ok', t => {
	validateFormula("output[[address=this_address]].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 0);
	});
});
test('formula - this_address in input - error', t => {
	validateFormula("input[[address=this_address]] == 20", 0, (result) => {
		t.not(result.error.match(/parse error/), null);
		t.deepEqual(result.complexity, 0);
	});
});
test('formula - this_address in input - ok', t => {
	validateFormula("input[[address=this_address]].address == \"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - other address in output - ok', t => {
	validateFormula("output[[address!=this_address]].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 0);
	});
});

test('formula - random < 10', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "random(1) < 10"], objUnit, objValidationState, null, function (err, res) {
		t.not(err.match(/parse error/), null);
	});
});

test('formula - random < -1', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "random(1) > -1"], objUnit, objValidationState, null, function (err, res) {
		t.not(err.match(/parse error/), null);
	});
});

test('formula - test', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "test(1) == test(1)"], objUnit, objValidationState, null, function (err, res) {
		t.not(err.match(/parse error/), null);
	});
});

test('formula - test', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "test(1) == test(1)"], objUnit, objValidationState, null, function (err, res) {
		t.not(err.match(/parse error/), null);
	});
});

test('formula - y == x', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "y == x"], objUnit, objValidationState, null, function (err, res) {
		t.not(err.match(/parse error/), null);
	});
});


test.cb('formula - data_feed == 10', t => {
	definition.validateAuthentifiers({}, null, 'base',
		['formula', "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\"]] == 10"], objUnit, objValidationState, null,
		function (err, res) {
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - not found', t => {
	definition.validateAuthentifiers({}, null, 'base',
		['formula', "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\"]] == 10"], objUnit, objValidationState, null,
		function (err, res) {
			t.is(err, null);
			t.is(res, false);
			t.end();
		});
});

test.cb('formula - data_feed == 10', t => {
	definition.validateAuthentifiers({}, null, 'base',
		['formula', "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", min_mci=1]] == 10"], objUnit, objValidationState, null,
		function (err, res) {
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - not found with min_mci', t => {
	definition.validateAuthentifiers({}, null, 'base',
		['formula', "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\", min_mci=1]] == 10"], objUnit, objValidationState, null,
		function (err, res) {
			t.is(err, null);
			t.is(res, false);
			t.end();
		});
});

test.cb('formula - 2 rows, take last', t => {
	definition.validateAuthentifiers({}, null, 'base',
		['formula', "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", min_mci=1]] == 10"], objUnit, objValidationState, null,
		function (err, res) {
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - ifnone 100', t => {
	definition.validateAuthentifiers({}, null, 'base',
		['formula', "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\", ifnone=100]] == 100"], objUnit, objValidationState, null,
		function (err, res) {
			console.error(err, res);
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - ifnone "100"', t => {
	definition.validateAuthentifiers({}, null, 'base',
		['formula', "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\", ifnone=\"100\"]] == 100"], objUnit, objValidationState, null,
		function (err, res) {
			console.error(err, res);
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - ifnone abort', t => {
	definition.validateAuthentifiers({}, null, 'base',
		['formula', "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\", ifnone=\"abort\"]] == 10"], objUnit, objValidationState,
		null, function (err, res) {
			t.is(err, null);
			t.is(res, false);
			t.end();
		});
});

test.cb('formula - ifseveral abort', t => {
	definition.validateAuthentifiers({}, null, 'base',
		['formula', "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"abort\"]] == 10"], objUnit, objValidationState, null,
		function (err, res) {
			t.is(err, null);
			t.is(res, false);
			t.end();
		});
});
/*
test('formula - if ifseveral first', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 9}, {value: 'test2'}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"first\"] == 9"], objUnit, objValidationState, null,
		function (err, res) {
			t.is(res, true);
		});
});*/

test.cb('formula - ifseveral last', t => {
	definition.validateAuthentifiers({}, null, 'base',
		['formula', "data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"last\"]] == 10"], objUnit,
		objValidationState, null,
		function (err, res) {
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - ifseveral=last', t => {
	validateFormula("data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"last\"]] == 10", 3,
		(result) => {
			t.is(result.error, false);
			t.deepEqual(result.complexity, 4);
			t.end();
		});
});
/*test('formula - ifseveral=first', t => {
	validateFormula("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"first\"] == 10", 0,
		(result) => {
			t.is(result.error, false);
			t.deepEqual(result.complexity, 2);
		});
});*/
test.cb('formula - ifseveral=abort', t => {
	validateFormula("data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"abort\"]] == 10", 0,
		(result) => {
			t.is(result.error, false);
			t.deepEqual(result.complexity, 1);
			t.end();
		});
});
test.cb('formula - ifseveral=test', t => {
	validateFormula("data_feed[[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"test\"]] == 10", 0,
		(result) => {
			t.not(result.error, null);
			t.deepEqual(result.complexity, 1);
			t.end();
		});
});