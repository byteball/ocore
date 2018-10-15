var test = require('ava');

var definition = require("../definition");
var db = require("../db");

var objValidationState = {
	last_ball_mci: 0,
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

test('formula - validate formula - ok', t => {
	definition.validate_formula("10 + 10 == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - validate authentifiers in formula - ok ', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "10 + 10 == 20"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate formula (data_feed, input, output) - ok', t => {
	definition.validate_formula("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=Test, mci=1] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 2);
	});
});

test('formula - validate formula (data_feed, input, output) 2 oracles - ok', t => {
	definition.validate_formula("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address, feed_name=Test, mci=1] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 3);
	});
});

test('formula - validate calculation 1 - ok', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount - 912 == output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate this address - ok', async (t) => {
	var signature = require('../signature');
	signature.verify = function () {
		return true;
	};
	let result = await new Promise(resolve => {
		definition.validateAuthentifiers(db, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', null,
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
	definition.validateAuthentifiers(db, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 60000 /3 * 4 / 4"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate calculation bignumber 1 - ok', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "10 == 10"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - amount !=', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "input[asset=base].amount != output[asset=base, address=GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN].amount"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - amount = 1', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "output[asset=base, amount=1].amount == 1"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - amount > 0 - error', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "output[asset=base, amount!=2].amount == 1"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - asset - asset !=', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "input[asset=base].asset != output[asset=base].asset"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - address - amount !=', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].asset != output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].asset"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - asset ==', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].asset == input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].asset"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - address ==', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].address == input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].address"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - validate calculation bignumber 2 - ok', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "0.1 + 0.2 == 0.3"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - incorrect mci - error', t => {
	definition.validate_formula("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=Test, mci=-1,abra=te] == 10", 0, function (err, complexity) {
		t.not(err.match(/Incorrect data_feed/), null);
		t.deepEqual(complexity, 2);
	});
});

test('formula - not equal - error', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - amount in input - ok', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, amount>10].amount == output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount"], null, objValidationState, null, function (err, res) {
		t.is(err, null);
	});
});

test('formula - min - ok', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "min(2,5,7) == 2"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - max - error', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "max(2,5,7) == 2"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - pow - ok', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "pow(2,9) == 512"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - round - 2 - error', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "round(2.9) == 2"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - round - 3 - ok', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "round(2.9) == 3"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - Incorrect data_feed(no parameter feed_name) - error', t => {
	definition.validate_formula("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect data_feed/), null);
			t.deepEqual(complexity, 2);
		});
});

test('formula - without parameters in data_feed - error', t => {
	definition.validate_formula("data_feed[] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect data_feed/), null);
			t.deepEqual(complexity, 1);
		});
});

test('formula - incorrect address in input - error', t => {
	definition.validate_formula("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name = test] * input[address=TEST].amount == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect input/), null);
			t.deepEqual(complexity, 2);
		});
});

test('formula - incorrect address in output - error', t => {
	definition.validate_formula("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name = test] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20 / output[address=TEST].amount", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect output/), null);
			t.deepEqual(complexity, 2);
		});
});

test('formula - without parameters in output - error', t => {
	definition.validate_formula("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name = test] == 20 / output[].amount", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect output/), null);
			t.deepEqual(complexity, 1);
		});
});

test('formula - without parameters in input - error', t => {
	definition.validate_formula("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name = test] == 20 / input[].amount", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect input/), null);
			t.deepEqual(complexity, 1);
		});
});


test('formula - input_x0 - error', t => {
	definition.validate_formula("input_x0.amount * outputs_x1.amount == 10", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect formula/), null);
			t.deepEqual(complexity, 1);
		});
});

test('formula - invalid operator in feed_name - error', t => {
	definition.validate_formula("data_feed[feed_name>test, oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect data_feed/, null));
		t.deepEqual(complexity, 1);
	});
});

test('formula - =name=name in feed_name - error', t => {
	definition.validate_formula("data_feed[feed_name=name=name, oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect data_feed/, null));
		t.deepEqual(complexity, 1);
	});
});

test('formula - empty value in feed_name - error', t => {
	definition.validate_formula("data_feed[feed_name=, oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect data_feed/, null));
		t.deepEqual(complexity, 1);
	});
});

test('formula - incorrect operator in oracles - error', t => {
	definition.validate_formula("data_feed[feed_name=, oracles>MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect data_feed/, null));
		t.deepEqual(complexity, 1);
	});
});

test('formula - incorrect param in data_feed - error', t => {
	definition.validate_formula("data_feed[feed_name=test, oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, hi=kyky] == 20", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect data_feed/, null));
			t.deepEqual(complexity, 2);
		});
});

test('formula - identical data_feed - ok', t => {
	definition.validate_formula("data_feed[feed_name=test, oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == data_feed[feed_name=test, oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]", 0,
		(err, complexity) => {
			t.is(err, null);
			t.deepEqual(complexity, 2);
		});
});
test('formula - identical data_feed - error', t => {
	definition.validate_formula("data_feed[feed_name=test, oracles>MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == data_feed[feed_name=test, oracles>MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect data_feed/), null);
			t.deepEqual(complexity, 1);
		});
});

test('formula - correct operator in address in input - ok', t => {
	definition.validate_formula("input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - correct operator in address in input - ok - 2', t => {
	definition.validate_formula("input[address!=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - correct operator in asset in input - ok - 1', t => {
	definition.validate_formula("input[asset=p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - incorrect value in asset in input - error - 1', t => {
	definition.validate_formula("input[asset=test].amount == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect input/, null));
		t.deepEqual(complexity, 1);
	});
});

test('formula - != operator in asset in input - ok', t => {
	definition.validate_formula("input[asset!=p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - incorrect operator in address in input - error', t => {
	definition.validate_formula("input[address>MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect input/, null));
		t.deepEqual(complexity, 1);
	});
});

test('formula - incorrect operator in address in input - error - 2', t => {
	definition.validate_formula("input[address<=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect input/, null));
		t.deepEqual(complexity, 1);
	});
});

test('formula - incorrect operator in address in input - error - 3', t => {
	definition.validate_formula("input[address>=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect input/, null));
		t.deepEqual(complexity, 1);
	});
});

test('formula - incorrect param in input - error', t => {
	definition.validate_formula("input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, bb=bb].amount == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect input/, null));
		t.deepEqual(complexity, 1);
	});
});

test('formula - correct operator in address in output - ok', t => {
	definition.validate_formula("output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - correct operator in address in output - ok - 2', t => {
	definition.validate_formula("output[address!=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - correct operator in asset in output - ok - 1', t => {
	definition.validate_formula("output[asset=p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - != operator in asset in output - ok', t => {
	definition.validate_formula("output[asset!=p+U9OB+JOCW5/7hXiRpVw65HwzFprNfj68PCy/7BR6A=].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - incorrect operator in address in output - error', t => {
	definition.validate_formula("output[address>MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect output/), null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - incorrect operator in address in output - error - 2', t => {
	definition.validate_formula("output[address<=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect output/), null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - incorrect operator in address in output - error - 3', t => {
	definition.validate_formula("output[address>=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect output/), null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - this address in input - ok', t => {
	definition.validate_formula("input[address=this address].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - other address in input - ok', t => {
	definition.validate_formula("input[address=other address].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - this address in output - ok', t => {
	definition.validate_formula("output[address=this address] == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect output/), null);
		t.deepEqual(complexity, 1);
	});
});
test('formula - this address in output - ok', t => {
	definition.validate_formula("output[address=this address].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});
test('formula - this address in input - ok', t => {
	definition.validate_formula("input[address=this address] == 20", 0, (err, complexity) => {
		t.not(err.match(/Incorrect input/), null);
		t.deepEqual(complexity, 1);
	});
});
test('formula - this address in input - ok', t => {
	definition.validate_formula("input[address=this address].address == MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - other address in output - ok', t => {
	definition.validate_formula("output[address=other address].amount == 20", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 1);
	});
});

test('formula - random < 10', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "random(1) < 10"], null, objValidationState, null, function (err, res) {
		console.error('err', err, res);
		t.is(res, false);
	});
});

test('formula - random < -1', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "random(1) > -1"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - test', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "test(1) == test(1)"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - test', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "test(1) == test(1)"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - y == x', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "y == x"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - data_feed == 10', t => {
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=test] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, true);
		});
});

test('formula - if not ifnone and ifseveral', t => {
	db.query = function (query, params, cb) {
		let rows = [];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=test] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, false);
		});
});

test('formula - data_feed == 10', t => {
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=test, mci>1] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, true);
		});
});

test('formula - if not ifnone and ifseveral', t => {
	db.query = function (query, params, cb) {
		let rows = [];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=test, mci>1] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, false);
		});
});

test('formula - if not ifnone and ifseveral - 2 rows', t => {
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 9}, {value: null, int_value: 12}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=test, mci>1] == 12"], null, objValidationState, null,
		function (err, res) {
			t.is(res, true);
		});
});

test('formula - if ifnone 10', t => {
	db.query = function (query, params, cb) {
		let rows = [];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=test, ifnone=10] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, true);
		});
});

test('formula - if ifnone abort', t => {
	db.query = function (query, params, cb) {
		let rows = [];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=test, ifnone=abort] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, false);
		});
});

test('formula - if ifseveral abort', t => {
	db.query = function (query, params, cb) {
		let rows = [{value: 'test'}, {value: 'test2'}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=test, ifseveral=abort] == 10"], null, objValidationState, null,
		function (err, res) {
			t.is(res, false);
		});
});

test('formula - if ifseveral first', t => {
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 9}, {value: 'test2'}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=test, ifseveral=first] == 9"], null, objValidationState, null,
		function (err, res) {
			t.is(res, true);
		});
});

test('formula - if ifseveral last', t => {
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 9}, {value: null, int_value: 11}];
		cb(rows);
	};
	definition.validateAuthentifiers(db, null, 'base',
		['formula', "data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=test, ifseveral=last] == 11"], null, objValidationState, null,
		function (err, res) {
			t.is(res, true);
		});
});