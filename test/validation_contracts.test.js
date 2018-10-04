const test = require('ava');

var definition = require("../definition.js");

test('formula - ok 0', t => {
	definition.formula_validation("10 + 10 == 20", err => {
		t.is(err, undefined);
	});
});

test('formula - ok 1', t => {
	definition.formula_validation("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name=Test] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]", err => {
		t.is(err, undefined);
	});
});

test('formula - error 0', t => {
	definition.formula_validation("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]",
		err => {
			t.not(err.match(/Incorrect data_feed/), null);
		});
});

test('formula - error 1', t => {
	definition.formula_validation("data_feed[] * input[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU] == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]",
		err => {
			t.not(err.match(/Incorrect data_feed/), null);
		});
});

test('formula - error 2', t => {
	definition.formula_validation("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name = test] * input[address=TEST] == 20 / output[address=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU]",
		err => {
			t.not(err.match(/Incorrect address in input/), null);
		});
});

test('formula - error 3', t => {
	definition.formula_validation("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name = test] == 20 / output[]",
		err => {
			t.not(err.match(/Incorrect output/), null);
		});
});

test('formula - error 4', t => {
	definition.formula_validation("data_feed[oracles=MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU, feed_name = test] == 20 / input[]",
		err => {
			t.not(err.match(/Incorrect input/), null);
		});
});

