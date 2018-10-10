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
			"outputs": [{"address": "MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU", "amount": 19088}],
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
	definition.validate_formula("10 + 10 == 20", 0, err => {
		t.is(err, null);
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

test('formula - validate calculation 1 - ok', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount - 912 == output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
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


test('formula - inputs_x0 - error', t => {
	definition.validate_formula("inputs_x0.amount * outputs_x1.amount == 10", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect formula/), null);
			t.deepEqual(complexity, 1);
		});
});
