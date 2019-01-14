var path = require('path');
var desktop_app = require('../desktop_app.js');
desktop_app.getAppDataDir = function() { return __dirname + '/.testdata-' + path.basename(__filename); }

var test = require('ava');

var definition = require("../definition");
var evalFormulaBB = require("../formula/index");
var constants = require('../constants.js');
require('./_init_datafeeds.js');
constants.formulaUpgradeMci = 0;

var objValidationState = {
	last_ball_mci: 1000,
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
				{"address": "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", "amount": 19088},
				{"address": "GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN", "amount": 1}
			]
		}
	}]
};


test('formula - validate formula - ok', t => {
	evalFormulaBB.validate("10 + 10 == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - validate authentifiers in formula - ok ', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "10 + 10 == 20"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate formula (data_feed, input, output) - ok', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"Test\", min_mci=\"1\"] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 2);
	});
});

test('formula - validate formula (data_feed, input, output) 2 oracles - ok', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name=\"Test\", min_mci=\"1\"] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 3);
	});
});

test('formula - validate calculation 1 - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount - 912 == output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate this address - ok', async (t) => {
	var signature = require('../signature');
	signature.verify = function () {
		return true;
	};
	let result = await new Promise(resolve => {
		definition.validateAuthentifiers({}, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', null,
			['and',
				[
					['sig', {pubkey: 'AoKzoVEoN6CpH1Vfi6Vnn0PS9BBJ9Ld92Nh8RCeOAqQI'}],
					['formula', "input[address=this address].amount == 20000"]
				]
			], null, objValidationState, {'r.0': 'AoKzoVEoN6CpH1Vfi6Vnn0PS9BBJ9Ld92Nh8RCeOAqQI'}, function (err, res) {
				return resolve({err, res});
			});
	});
	t.is(result.res, true);
	t.is(result.err, null);
});

test('formula - validate calculation 2 - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 60000 /3 * 4 / 4"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate calculation bignumber 1 - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "10 == 10"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - amount !=', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[asset=base].amount != output[asset=base, address=GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN].amount"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - amount = 1', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "output[asset=base, amount=1].amount == 1"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - amount > 0 - error', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "output[asset=base, amount!=2].amount == 1"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - asset - asset !=', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[asset=base].asset != output[asset=base].asset"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - address - amount !=', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].asset != output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].asset"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - asset ==', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].asset == input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].asset"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - address ==', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].address == input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].address"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate calculation bignumber 2 - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "0.1 + 0.2 == 0.3"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - incorrect min_mci - error', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"Test\", min_mci=\"-1\", abra=\"te\"] == 10", 0, function (result) {
		t.not(result.error.match(/Incorrect formula/), null);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - not equal - error', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - amount in input - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, amount>10].amount == output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount"], null, objValidationState, null, function (err, res) {
		t.is(err, null);
	});
});

test('formula - min - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "min(2,5,7) == 2"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - max - error', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "max(2,5,7) == 2"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - pow - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "2^9 == 512"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - round - 2 - error', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "round(2.9) == 2"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - round - 3 - ok', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "round(2.9) == 3"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - Incorrect data_feed(no parameter feed_name) - error', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount", 0,
		(result) => {
			t.is(result.error, true);
			t.deepEqual(result.complexity, 1);
		});
});

test('formula - without parameters in data_feed - error', t => {
	evalFormulaBB.validate("data_feed[] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount", 0,
		(result) => {
			t.is(result.error, true);
			t.deepEqual(result.complexity, 1);
		});
});

test('formula - incorrect address in input - error', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name = \"test\"] * input[address=TEST].amount == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount", 0,
		(result) => {
			t.is(result.error, true);
			t.deepEqual(result.complexity, 2);
		});
});

test('formula - incorrect address in output - error', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name = \"test\"] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20 / output[address=TEST].amount", 0,
		(result) => {
			t.is(result.error, true);
			t.deepEqual(result.complexity, 2);
		});
});

test('formula - without parameters in output - error', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name = \"test\"] == 20 / output[].amount", 0,
		(result) => {
			t.is(result.error, true);
			t.deepEqual(result.complexity, 2);
		});
});

test('formula - without parameters in input - error', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name = \"test\"] == 20 / input[].amount", 0,
		(result) => {
			t.is(result.error, true);
			t.deepEqual(result.complexity, 2);
		});
});


test('formula - input_x0 - error', t => {
	evalFormulaBB.validate("input_x0.amount * outputs_x1.amount == 10", 0,
		(result) => {
			t.not(result.error.match(/Incorrect formula/), null);
			t.deepEqual(result.complexity, 1);
		});
});

test('formula - invalid operator in feed_name - error', t => {
	evalFormulaBB.validate("data_feed[feed_name>\"test\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"] == 20", 0, (result) => {
		t.is(result.error, true);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - =name=name in feed_name - error', t => {
	evalFormulaBB.validate("data_feed[feed_name=name=\"name\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"] == 20", 0, (result) => {
		t.not(result.error.match(/Incorrect data_feed/, null));
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - empty value in feed_name - error', t => {
	evalFormulaBB.validate("data_feed[feed_name=\"\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"] == 20", 0, (result) => {
		t.is(result.error, true);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect operator in oracles - error', t => {
	evalFormulaBB.validate("data_feed[feed_name=\"t\", oracles>\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"] == 20", 0, (result) => {
		t.is(result.error, true);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect param in data_feed - error', t => {
	evalFormulaBB.validate("data_feed[feed_name=\"test\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", hi=\"kyky\"] == 20", 0,
		(result) => {
			t.not(result.error.match(/Incorrect data_feed/, null));
			t.deepEqual(result.complexity, 1);
		});
});

test('formula - identical data_feed - ok', t => {
	evalFormulaBB.validate("data_feed[feed_name=\"test\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"] == data_feed[feed_name=\"test\", oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"]", 0,
		(result) => {
			t.is(result.error, false);
			t.deepEqual(result.complexity, 3);
		});
});
test('formula - identical data_feed - error', t => {
	evalFormulaBB.validate("data_feed[feed_name=\"test\", oracles>\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"] == data_feed[feed_name=\"test\", oracles>\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"]", 0,
		(result) => {
			t.is(result.error, true);
			t.deepEqual(result.complexity, 1);
		});
});

test('formula - correct operator in address in input - ok', t => {
	evalFormulaBB.validate("input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - correct operator in address in input - ok - 2', t => {
	evalFormulaBB.validate("input[address!=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - correct operator in asset in input - ok - 1', t => {
	evalFormulaBB.validate("input[asset=p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect value in asset in input - error - 1', t => {
	evalFormulaBB.validate("input[asset=test].amount == 20", 0, (result) => {
		t.is(result.error, true);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - != operator in asset in input - ok', t => {
	evalFormulaBB.validate("input[asset!=p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect operator in address in input - error', t => {
	evalFormulaBB.validate("input[address>MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (result) => {
		t.is(result.error, true);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect operator in address in input - error - 2', t => {
	evalFormulaBB.validate("input[address<=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (result) => {
		t.is(result.error, true);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect operator in address in input - error - 3', t => {
	evalFormulaBB.validate("input[address>=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (result) => {
		t.is(result.error, true);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect param in input - error', t => {
	evalFormulaBB.validate("input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, bb=bb].amount == 20", 0, (result) => {
		t.not(result.error.match(/Incorrect input/, null));
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - correct operator in address in output - ok', t => {
	evalFormulaBB.validate("output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - correct operator in address in output - ok - 2', t => {
	evalFormulaBB.validate("output[address!=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - correct operator in asset in output - ok - 1', t => {
	evalFormulaBB.validate("output[asset=p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - != operator in asset in output - ok', t => {
	evalFormulaBB.validate("output[asset!=p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect operator in address in output - error', t => {
	evalFormulaBB.validate("output[address>MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (result) => {
		t.is(result.error, true);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect operator in address in output - error - 2', t => {
	evalFormulaBB.validate("output[address<=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (result) => {
		t.is(result.error, true);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - incorrect operator in address in output - error - 3', t => {
	evalFormulaBB.validate("output[address>=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (result) => {
		t.is(result.error, true);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - this address in input - ok', t => {
	evalFormulaBB.validate("input[address=this address].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - other address in input - ok', t => {
	evalFormulaBB.validate("input[address=other address].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - this address in output - error', t => {
	evalFormulaBB.validate("output[address=this address] == 20", 0, (result) => {
		t.not(result.error.match(/Incorrect formula/), null);
		t.deepEqual(result.complexity, 1);
	});
});
test('formula - this address in output - ok', t => {
	evalFormulaBB.validate("output[address=this address].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});
test('formula - this address in input - error', t => {
	evalFormulaBB.validate("input[address=this address] == 20", 0, (result) => {
		t.not(result.error.match(/Incorrect formula/), null);
		t.deepEqual(result.complexity, 1);
	});
});
test('formula - this address in input - ok', t => {
	evalFormulaBB.validate("input[address=this address].address == \"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\"", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - other address in output - ok', t => {
	evalFormulaBB.validate("output[address=other address].amount == 20", 0, (result) => {
		t.is(result.error, false);
		t.deepEqual(result.complexity, 1);
	});
});

test('formula - random < 10', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "random(1) < 10"], null, objValidationState, null, function (err, res) {
		t.not(err.match(/Incorrect formula/), null);
	});
});

test('formula - random < -1', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "random(1) > -1"], null, objValidationState, null, function (err, res) {
		t.not(err.match(/Incorrect formula/), null);
	});
});

test('formula - test', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "test(1) == test(1)"], null, objValidationState, null, function (err, res) {
		t.not(err.match(/Incorrect formula/), null);
	});
});

test('formula - test', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "test(1) == test(1)"], null, objValidationState, null, function (err, res) {
		t.not(err.match(/Incorrect formula/), null);
	});
});

test('formula - y == x', t => {
	definition.validateAuthentifiers({}, null, 'base', ['formula', "y == x"], null, objValidationState, null, function (err, res) {
		t.not(err.match(/Incorrect formula/), null);
	});
});


test.cb('formula - data_feed == 10', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\"] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - not found', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\"] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, false);
			t.end();
		});
});

test.cb('formula - data_feed == 10', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", min_mci=1] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - not found with min_mci', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\", min_mci=1] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, false);
			t.end();
		});
});

test.cb('formula - 2 rows, take last', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 12}, {value: null, int_value: 9}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", min_mci=1] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - ifnone 100', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\", ifnone=100] == 100"], null, objValidationState, null,
		function (err, res) {
			console.error(err, res);
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - ifnone "100"', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\", ifnone=\"100\"] == 100"], null, objValidationState, null,
		function (err, res) {
			console.error(err, res);
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - ifnone abort', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\", ifnone=\"abort\"] == 10"], null, objValidationState,
		null, function (err, res) {
			t.is(res, false);
			t.end();
		});
});

test.cb('formula - ifseveral abort', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: 'test'}, {value: 'test2'}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"abort\"] == 10"], null, objValidationState, null,
		function (err, res) {
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
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"first\"] == 9"], null, objValidationState, null,
		function (err, res) {
			t.is(res, true);
		});
});*/

test.cb('formula - ifseveral last', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 11}, {value: null, int_value: 9}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"last\"] == 10"], null,
		objValidationState, null,
		function (err, res) {
			t.is(res, true);
			t.end();
		});
});

test.cb('formula - ifseveral=last', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"last\"] == 10", 0,
		(result) => {
			t.is(result.error, false);
			t.deepEqual(result.complexity, 2);
			t.end();
		});
});
/*test('formula - ifseveral=first', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"first\"] == 10", 0,
		(result) => {
			t.is(result.error, false);
			t.deepEqual(result.complexity, 2);
		});
});*/
test.cb('formula - ifseveral=abort', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"abort\"] == 10", 0,
		(result) => {
			t.is(result.error, false);
			t.deepEqual(result.complexity, 2);
			t.end();
		});
});
test.cb('formula - ifseveral=test', t => {
	evalFormulaBB.validate("data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"test\"] == 10", 0,
		(result) => {
			t.not(result.error, null);
			t.deepEqual(result.complexity, 2);
			t.end();
		});
});