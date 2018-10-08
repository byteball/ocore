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

test('formula - ok 0', t => {
	definition.formula_validation("10 + 10 == 20", 0, err => {
		t.is(err, null);
	});
});

test('formula - ok 1', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "10 + 10 == 20"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - ok 2', t => {
	definition.formula_validation("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=Test] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]", 0, (err, complexity) => {
		t.is(err, null);
		t.deepEqual(complexity, 2);
	});
});

test('formula - ok 3', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount - 912 == output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - ok 4', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == 60000 /3 * 4 / 4"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - ok 5', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "10 == 10"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - ok 6', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "0.1 + 0.2 == 0.3"], null, objValidationState, null, function (err, res) {
		t.is(res, true);
	});
});

test('formula - error 0', t => {
	definition.validateAuthentifiers(db, null, 'base', ['formula', "input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount == output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU].amount"], null, objValidationState, null, function (err, res) {
		t.is(res, false);
	});
});

test('formula - error 1', t => {
	definition.formula_validation("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect data_feed/), null);
			t.deepEqual(complexity, 1);
		});
});

test('formula - error 2', t => {
	definition.formula_validation("data_feed[] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect data_feed/), null);
			t.deepEqual(complexity, 1);
		});
});

test('formula - error 3', t => {
	definition.formula_validation("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name = test] * input[address=TEST] == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect address in input/), null);
			t.deepEqual(complexity, 2);
		});
});

test('formula - error 4', t => {
	definition.formula_validation("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name = test] == 20 / output[]", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect output/), null);
			t.deepEqual(complexity, 1);
		});
});

test('formula - error 5', t => {
	definition.formula_validation("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name = test] == 20 / input[]", 0,
		(err, complexity) => {
			t.not(err.match(/Incorrect input/), null);
			t.deepEqual(complexity, 1);
		});
});

