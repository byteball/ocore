var path = require('path');
var desktop_app = require('../desktop_app.js');
desktop_app.getAppDataDir = function() { return __dirname + '/.testdata-' + path.basename(__filename); }

var Decimal = require('decimal.js');
var formulaParser = require('../formula/index');
var validateFormula = formulaParser.validate;
var test = require('ava');
require('./_init_datafeeds.js');

function evalFormula(conn, formula, messages, objValidationState, address, callback){
	formulaParser.validate(formula, 1, function(res){
		if (res.error)
			return callback(false);
		if (res.complexity > 100)
			return callback(false);
		formulaParser.evaluate(conn, formula, messages, objValidationState, address, callback);
	});
}

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



test('1 + 1', t => {
	evalFormula(0, "1 + 1", 0, 0, 0, res => {
		t.deepEqual(res.eq(2), true);
	});
});

test('1 - 1', t => {
	evalFormula(0, "1 - 1", 0, 0, 0, res => {
		t.deepEqual(res.eq(0), true);
	});
});

test('2 * 2', t => {
	evalFormula(0, "2 * 2", 0, 0, 0, res => {
		t.deepEqual(res.eq(4), true);
	});
});

test('2 / 2', t => {
	evalFormula(0, "2 / 2", 0, 0, 0, res => {
		t.deepEqual(res.eq(1), true);
	});
});

test('2 ^ 4', t => {
	evalFormula(0, "2 ^ 4", 0, 0, 0, res => {
		t.deepEqual(res.eq(16), true);
	});
});

test('2 ^ 9007199254740992', t => {
	evalFormula(0, "2 ^ 9007199254740992", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('2 ^ 1.5', t => {
	evalFormula(0, "2 ^ 1.5", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('(2 + 2) * 2', t => {
	evalFormula(0, "(2 + 2) * 2", 0, 0, 0, res => {
		t.deepEqual(res.eq(8), true);
	});
});

test('2 + 2 * 2', t => {
	evalFormula(0, "2 + 2 * 2", 0, 0, 0, res => {
		t.deepEqual(res.eq(6), true);
	});
});

test('10 - 5 + 1', t => {
	evalFormula(0, "10 - 5 + 1", 0, 0, 0, res => {
		t.deepEqual(res.eq(6), true);
	});
});

test('15 - 5 + 2*3', t => {
	evalFormula(0, "15 - 5 + 2*3", 0, 0, 0, res => {
		t.deepEqual(res.eq(16), true);
	});
});

test('5 - 3*4 + 2*3', t => {
	evalFormula(0, "5 - 3*4 + 2*3", 0, 0, 0, res => {
		t.deepEqual(res.eq(-1), true);
	});
});

test('pi + 2', t => {
	evalFormula(0, "pi + 2", 0, 0, 0, res => {
		t.deepEqual(res.eq('5.14159265358979'), true);
	});
});

test('e + 2', t => {
	evalFormula(0, "e + 2", 0, 0, 0, res => {
		t.deepEqual(res.eq('4.71828182845904'), true);
	});
});


test('sqrt(2)', t => {
	evalFormula(0, "sqrt ( max ( 1 , sqrt(4) ) )", 0, 0, 0, res => {
		t.deepEqual(res.eq('1.4142135623731'), true);
	});
});

test('1 == 1', t => {
	evalFormula(0, "1 == 1", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('1 != 1', t => {
	evalFormula(0, "1 != 1", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('1 != 2', t => {
	evalFormula(0, "1 != 2", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('1 < 2', t => {
	evalFormula(0, "1 < 2", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('1 > 2', t => {
	evalFormula(0, "1 > 2", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('1 >= 2', t => {
	evalFormula(0, "2 >= 2", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('1 <= 2', t => {
	evalFormula(0, "1 <= 2", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('0 >= 2', t => {
	evalFormula(0, "0 >= 2", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('3 <= 2', t => {
	evalFormula(0, "3 <= 1", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('"test" == "test"', t => {
	evalFormula(0, '"test" == "test"', 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('"test" != "test"', t => {
	evalFormula(0, '"test" != "test"', 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('"test 1" != "test 2"', t => {
	evalFormula(0, '"test 1" != "test 2"', 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('"test 2" != "test 2"', t => {
	evalFormula(0, '"test 2" != "test 2"', 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('"test 3" == "test 3"', t => {
	evalFormula(0, '"test 3" == "test 3"', 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('1 and 1', t => {
	evalFormula(0, "1 and 1", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('0 and 0', t => {
	evalFormula(0, "0 and 0", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('0 and 1', t => {
	evalFormula(0, "0 and 1", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('0 or 1', t => {
	evalFormula(0, "0 or 1", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('1 == 1 and 1 == 1', t => {
	evalFormula(0, "1 == 1 and 1 == 1", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});
test('1 == 1 and 1 == 2', t => {
	evalFormula(0, "1 == 1 and 1 == 2", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('1 or 1 and 0', t => {
	evalFormula(0, "1 or 1 and 0", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('1 == 1 or 1 == 2', t => {
	evalFormula(0, "1 == 1 or 1 == 2", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('1 == 2 or 1 == 2', t => {
	evalFormula(0, "1 == 2 or 1 == 2", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('10 == 10 ? 1 : 2', t => {
	evalFormula(0, "10 == 10 ? 1 : 2", 0, 0, 0, res => {
		t.deepEqual(res.eq(1), true);
	});
});

test('10 != 10 ? 1 : 2', t => {
	evalFormula(0, "10 != 10 ? 1 : 2", 0, 0, 0, res => {
		t.deepEqual(res.eq(2), true);
	});
});

test('10 == 10 ? 1 + 1 : 2 + 2', t => {
	evalFormula(0, "10 == 10 ? 1 + 1 : 2 + 2", 0, 0, 0, res => {
		t.deepEqual(res.eq(2), true);
	});
});

test('10 != 10 ? 1 + 1 : 2 + 2', t => {
	evalFormula(0, "10 != 10 ? 1 + 1 : 2 + 2", 0, 0, 0, res => {
		t.deepEqual(res.eq(4), true);
	});
});

test('1000000000000000000000000000000 == 1000000000000000000000000000000', t => {
	evalFormula(0, "1000000000000000000000000000000 == 1000000000000000000000000000000", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('1000000000000000000000000000000 == 1000000000000000000000000000001', t => {
	evalFormula(0, "1000000000000000000000000000000 == 1000000000000000000000000000001", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test('min 1,2', t => {
	evalFormula(0, 'min(1,2)', 0, 0, 0, res => {
		t.deepEqual(res.eq(1), true);
	});
});

test('min 1,2,4', t => {
	evalFormula(0, "min(1,2,4)", 0, 0, 0, res => {
		t.deepEqual(res.eq(1), true);
	});
});

test('min 2,3,5,7', t => {
	evalFormula(0, "min(2,3,5,7)", 0, 0, 0, res => {
		t.deepEqual(res.eq(2), true);
	});
});

test('max 1,2', t => {
	evalFormula(0, "max(1,2)", 0, 0, 0, res => {
		t.deepEqual(res.eq(2), true);
	});
});

test('max 1,2,4', t => {
	evalFormula(0, "max(1,2,4)", 0, 0, 0, res => {
		t.deepEqual(res.eq(4), true);
	});
});
test('max 2,3,5,7', t => {
	evalFormula(0, "max(2,3,5,7)", 0, 0, 0, res => {
		t.deepEqual(res.eq(7), true);
	});
});

test('ceil 2.5', t => {
	evalFormula(0, "ceil(2.5)", 0, 0, 0, res => {
		t.deepEqual(res.eq(3), true);
	});
});

test('floor 2.5', t => {
	evalFormula(0, 'floor(2.5)', 0, 0, 0, res => {
		t.deepEqual(res.eq(2), true);
	});
});

test('round 2.5', t => {
	evalFormula(0, 'round(2.9)', 0, 0, 0, res => {
		t.deepEqual(res.eq(3), true);
	});
});

test('ceil(2.12345, 3)', t => {
	evalFormula(0, "ceil(2.12345, 3)", 0, 0, 0, res => {
		t.deepEqual(res.eq('2.124'), true);
	});
});

test('floor(2.12345, 3)', t => {
	evalFormula(0, "floor(2.12345, 3)", 0, 0, 0, res => {
		t.deepEqual(res.eq('2.123'), true);
	});
});

test('round(2.12345, 3)', t => {
	evalFormula(0, "round(2.12345, min(5, 23, 3, 77))", 0, 0, 0, res => {
		t.deepEqual(res.eq('2.123'), true);
	});
});


test("0.1 + 0.2 == 0.3", t => {
	evalFormula(0, "0.1 + 0.2 == 0.3", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test("'test' || 'test'", t => {
	evalFormula(0, "1 || 1 || 1", 0, 0, 0, res => {
		t.deepEqual(res, "111");
	});
});

test("'test' || 'test' and 'test'", t => {
	evalFormula(0, "'test' || 'test' || 'test'", 0, 0, 0, res => {
		t.deepEqual(res, "testtesttest");
	});
});


test("'test' || 1 and 'test'", t => {
	evalFormula(0, "'test' || 1 || 'test'", 0, 0, 0, res => {
		t.deepEqual(res, "test1test");
	});
});

test("1 == 1", t => {
	evalFormula(0, "1 == 1", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test("\"1\" == \"1\"", t => {
	evalFormula(0, "\"1\" == \"1\"", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test("\"1\" < \"1\"", t => {
	evalFormula(0, "\"1\" < \"1\"", 0, 0, 0, res => {
		t.deepEqual(res, false);
	});
});

test("1 < \"2\"", t => {
	evalFormula(0, "1 < \"2\"", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test("\"1\" < 2", t => {
	evalFormula(0, "\"1\" < 2", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test("\"bb\" > \"ba\"", t => {
	evalFormula(0, "\"1\" < 2", 0, 0, 0, res => {
		t.deepEqual(res, true);
	});
});

test('formula - amount !=', t => {
	evalFormula(0, 'input[asset=base].amount != output[asset=base, address=GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN].amount', objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
	});
});

test('formula - amount = 1', t => {
	evalFormula(0, "output[asset = base, amount=1].amount == 1", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
	});
});

test.cb('formula - datafeed', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	evalFormula(db, "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test\", ifseveral=\"last\"] == 10", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed not found', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: 'test', int_value: null}];
		cb(rows);
	};
	evalFormula(db, "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU\", feed_name=\"test2\", ifseveral=\"last\"] + 10", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, false);
		t.end();
	});
});

test.cb('formula - datafeed with this address', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	evalFormula(db, "data_feed[oracles=\"KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA:this address\", feed_name=\"test\", ifseveral=\"last\", min_mci = 10] == 10", objValidationState.arrAugmentedMessages, objValidationState, 'MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed3 te"st', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	evalFormula(db, 'data_feed[oracles="MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address", feed_name="te\\"st", ifseveral="last", min_mci = 10] == 11', objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed4', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	evalFormula(db, "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', ifseveral=\"last\", min_mci = 10] == 10", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed te\"st', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	evalFormula(db, "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='te\"st', ifseveral=\"last\", min_mci = 10] == 11", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed te\'st', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	evalFormula(db, "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='te\\'st', ifseveral=\"last\", min_mci = 10] == 15", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed t,e(s)[],\'t', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	evalFormula(db, "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='t,e(s)[],\\'t', ifseveral=\"last\", min_mci = 10] == 20", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - datafeed +', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	evalFormula(db, "1 + data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='t,e(s)[],\\'t', ifseveral=\"last\", min_mci = 10]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(Decimal.isDecimal(res), true);
		t.deepEqual(res.eq(21), true);
		t.end();
	});
});

test.cb('formula - datafeed concat', t => {
	let db = {};
	db.query = function (query, params, cb) {
		let rows = [{value: null, int_value: 10}];
		cb(rows);
	};
	evalFormula(db, "1 || data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='t,e(s)[],\\'t', ifseveral=\"last\", min_mci = 10]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, "120");
		t.end();
	});
});

test.cb('formula - in datafeed', t => {
	evalFormula({}, "in_data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value > 5, min_mci = 10]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - in datafeed large mci', t => {
	evalFormula({}, "in_data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value > 5, min_mci = 10000] ? 'yes' : 'no'", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, 'no');
		t.end();
	});
});

test.cb('formula - in datafeed !=', t => {
	evalFormula({}, "in_data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='te\"st', feed_value != 11, min_mci = 10] ? 'yes' : 'no'", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, 'no');
		t.end();
	});
});

test.cb('formula - not in datafeed', t => {
	evalFormula({}, "in_data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value < 5, min_mci = 10]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, false);
		t.end();
	});
});

test.cb('formula - not in datafeed concat', t => {
	evalFormula({}, "60 || in_data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value > 5, min_mci = 10]", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, "60true");
		t.end();
	});
});

test.cb('formula - not in datafeed ternary true', t => {
	evalFormula({}, "in_data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value > 5, min_mci = 10] ? 'yes' : 55", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, "yes");
		t.end();
	});
});

test.cb('formula - not in datafeed ternary false', t => {
	evalFormula({}, "in_data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value < 5] ? 'yes' : 55", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res.eq(55), true);
		t.end();
	});
});

test.cb('formula - not in datafeed, not ternary false', t => {
	evalFormula({}, "!in_data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', feed_value < 5] ? 'yes' : 55", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, 'yes');
		t.end();
	});
});

test.cb('formula - what value', t => {
	evalFormula({}, "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', what='value'] == 10", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - what unit', t => {
	evalFormula({}, "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', what='unit'] || 'aaa' == 'unit2aaa'", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, true);
		t.end();
	});
});

test.cb('formula - invalid what', t => {
	evalFormula({}, "data_feed[oracles=\"MXMEKGN37H5QO2AWHT7XRG6LHJVVTAWU:this address\", feed_name='test', what='bbb'] || 'aaa'", objValidationState.arrAugmentedMessages, objValidationState, 'KRPWY2QQBLWPCFK3DZGDZYALSWCOEDWA', res => {
		t.deepEqual(res, false);
		t.end();
	});
});

test('validate 1 + 1', t => {
	validateFormula("1 + 1", 0, res => {
		t.deepEqual(res.error, false);
	})
});

test.cb('validate datafeed ok', t => {
	validateFormula("data_feed[oracles=\"this address\", feed_name=\"test\"]", 0, res => {
		t.deepEqual(res.error, false);
		t.end();
	})
});

test.cb('validate datafeed error', t => {
	validateFormula("data_feed[oracles=\"this address\"]", 0, res => {
		t.deepEqual(res.error, true);
		t.end();
	})
});

test.cb('validate 1 + datafeed ok', t => {
	validateFormula("1 + data_feed[oracles=\"this address\", feed_name=\"test\"]", 0, res => {
		t.deepEqual(res.error, false);
		t.end();
	});
});

test.cb('validate 1 + datafeed error', t => {
	validateFormula("1 + data_feed[oracles=\"this address\"]", 0, res => {
		t.deepEqual(res.error, true);
		t.end();
	})
});

test('validate round ok', t => {
	validateFormula("round(1+1.5)", 0, res => {
		t.deepEqual(res.error, false);
	})
});

test('validate min ok', t => {
	evalFormula(0, "min(1 + (1 + 1) - 1, 2)", 0, 0, 0, res => {
		t.deepEqual(Decimal.isDecimal(res), true);
		t.deepEqual(res.eq(2), true);
	})
});

test('eval ternary ok', t => {
	evalFormula(0, "1 == 1 ? 'ok' : '!ok'", 0, 0, 0, res => {
		t.deepEqual(res, 'ok');
	})
});

test.cb('validate 1 + datafeed error', t => {
	validateFormula("max(data_feed[oracles=\"this address\"], 2)", 0, res => {
		t.deepEqual(res.error, true);
		t.end();
	})
});

test('validate 1 + datafeed error', t => {
	validateFormula("1 = 1", 0, res => {
		t.deepEqual(res.error, true);
	})
});

test('inp', t => {
	validateFormula("input[address=this address, amount>10].amount", 0, res => {
		t.deepEqual(res.error, false);
	})
});

test('inp', t => {
	validateFormula("input[address=this address].amount == 20000", 0, res => {
		t.deepEqual(res.error, false);
	})
});
