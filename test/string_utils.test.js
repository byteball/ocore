const test = require('ava');

const StringUtils = require('../string_utils');

const STRING_JOIN_CHAR = StringUtils.STRING_JOIN_CHAR;
const getSourceString = StringUtils.getSourceString;
const getNumericFeedValue = StringUtils.getNumericFeedValue;
const encodeDoubleInLexicograpicOrder = StringUtils.encodeDoubleInLexicograpicOrder;
const decodeLexicographicToDouble = StringUtils.decodeLexicographicToDouble;
const encodeMci = StringUtils.encodeMci;
const getMciFromDataFeedKey = StringUtils.getMciFromDataFeedKey;
const getJsonSourceString = StringUtils.getJsonSourceString;

test.after.always(t => {
	console.log('***** string_utils.test done');
});

/**
 * getSourceString
 */

const simpleString = 'simple test string';
const simpleStringResult = ['s', simpleString].join(STRING_JOIN_CHAR);
test('Test a simple string', t => {
    t.true(getSourceString(simpleString) === simpleStringResult);
});

const integer = 27090;
const simpleIntResult = ['n', integer].join(STRING_JOIN_CHAR);
test('Test an integer', t => {
    t.true(getSourceString(integer) === simpleIntResult);
});

const float = 8.103;
const simpleFloatResult = ['n', float].join(STRING_JOIN_CHAR);
test('Test a float', t => {
    t.true(getSourceString(float) === simpleFloatResult);
});

const boolean = false;
const simpleBooleanResult = ['b', boolean].join(STRING_JOIN_CHAR);
test('Test a boolean', t => {
    t.true(getSourceString(boolean) === simpleBooleanResult);
});

const arrayInput = ['a', 81, 'b', 'c', 3.6903690369, true];
const arrayInputResultPairs = ['s', 'n', 's', 's', 'n', 'b'].map(function(typ, idx) {
    return [typ, arrayInput[idx]].join(STRING_JOIN_CHAR);
}).join(STRING_JOIN_CHAR);
const arrayInputResult = ['[', arrayInputResultPairs, ']'].join(STRING_JOIN_CHAR);
test('Test an array', t => {
    t.true(getSourceString(arrayInput) === arrayInputResult);
});

// Just hard-coding this...
const object = {unit: 'cluster', bunch: 9, witness: {name: 'axe', index: 18}};
const objectPairs = ['bunch', getSourceString(9), 'unit', getSourceString('cluster'), 'witness', 'index', getSourceString(18), 'name', getSourceString('axe')];
const objectResult = objectPairs.join(STRING_JOIN_CHAR);
test('Test an object', t => {
    t.true(getSourceString(object) === objectResult);
});


// getNumericFeedValue

test('getNumericFeedValue small int', t => {
    t.true(getNumericFeedValue('1234') === 1234);
});

test('getNumericFeedValue large int 15 digits long', t => {
    t.true(getNumericFeedValue('123456789012345') === 123456789012345);
});

test('getNumericFeedValue oversized int', t => {
    t.true(getNumericFeedValue('1234567890123456') === null);
});

test('getNumericFeedValue oversized decimal', t => {
    t.true(getNumericFeedValue('1234.56789012345') === null);
});

test('getNumericFeedValue exponential decimal', t => {
    t.true(getNumericFeedValue('1234.567e70') === 1234.567e70);
});

test('getNumericFeedValue exponential decimal +exp', t => {
    t.true(getNumericFeedValue('1234.567e+70') === 1234.567e70);
});

test('getNumericFeedValue exponential decimal negative', t => {
    t.true(getNumericFeedValue('-1234.567e-70') === -1234.567e-70);
});

test('getNumericFeedValue out of range large decimal', t => {
    t.true(getNumericFeedValue('1234.567e700') === null);
});

test('getNumericFeedValue out of range small decimal', t => {
    t.true(getNumericFeedValue('1234.567e-700') === null);
});


// encodeDoubleInLexicograpicOrder

test('encodeDoubleInLexicograpicOrder ints', t => {
    t.true(encodeDoubleInLexicograpicOrder(9) < encodeDoubleInLexicograpicOrder(11));
});

test('encodeDoubleInLexicograpicOrder decimals', t => {
    t.true(encodeDoubleInLexicograpicOrder(9.123) < encodeDoubleInLexicograpicOrder(11.123));
});

test('encodeDoubleInLexicograpicOrder negative', t => {
    t.true(encodeDoubleInLexicograpicOrder(-9.123) > encodeDoubleInLexicograpicOrder(-11.123));
});

test('encodeDoubleInLexicograpicOrder negative/positive', t => {
    t.true(encodeDoubleInLexicograpicOrder(9.123) > encodeDoubleInLexicograpicOrder(-9.456));
});

test('encodeDoubleInLexicograpicOrder positive/zero', t => {
    t.true(encodeDoubleInLexicograpicOrder(9.123) > encodeDoubleInLexicograpicOrder(0));
});

test('encodeDoubleInLexicograpicOrder negative/zero', t => {
    t.true(encodeDoubleInLexicograpicOrder(-9.123) < encodeDoubleInLexicograpicOrder(0));
});

test('encodeDoubleInLexicograpicOrder -0', t => {
    t.true(encodeDoubleInLexicograpicOrder(-0) === encodeDoubleInLexicograpicOrder(0));
});

test('encodeDoubleInLexicograpicOrder + getNumericFeedValue', t => {
    t.true(encodeDoubleInLexicograpicOrder(9.123) === encodeDoubleInLexicograpicOrder(getNumericFeedValue('912.3e-2')));
});


// decodeLexicographicToDouble

test('encode/decode double positive', t => {
    t.true(decodeLexicographicToDouble(encodeDoubleInLexicograpicOrder(9.123)) === 9.123);
});

test('encode/decode double negative', t => {
    t.true(decodeLexicographicToDouble(encodeDoubleInLexicograpicOrder(-9.123)) === -9.123);
});

test('encode/decode double positive +exp', t => {
    t.true(decodeLexicographicToDouble(encodeDoubleInLexicograpicOrder(9.123e60)) === 9.123e60);
});

test('encode/decode double negative +exp', t => {
    t.true(decodeLexicographicToDouble(encodeDoubleInLexicograpicOrder(-9.123e60)) === -9.123e60);
});

test('encode/decode double positive -exp', t => {
    t.true(decodeLexicographicToDouble(encodeDoubleInLexicograpicOrder(9.123e-60)) === 9.123e-60);
});

test('encode/decode double negative +exp', t => {
    t.true(decodeLexicographicToDouble(encodeDoubleInLexicograpicOrder(-9.123e-60)) === -9.123e-60);
});

test('encode/decode double 0', t => {
    t.true(decodeLexicographicToDouble(encodeDoubleInLexicograpicOrder(0)) === 0);
});


// encode/decode mci

test('encoded mci order', t => {
    t.true(encodeMci(12345) > encodeMci(12346));
});
test('encoded mci order big', t => {
    t.true(encodeMci(1e9-1) > encodeMci(1e9));
});
test('encoded mci order first bit set', t => {
    t.true(encodeMci(3e9-1) > encodeMci(3e9));
});
test('encoded mci order mixed', t => {
    t.true(encodeMci(1e9) > encodeMci(3e9));
});

test('encode/decode mci', t => {
    t.true(getMciFromDataFeedKey('aaa\nbbbbbb\n'+encodeMci(12345)) === 12345);
});
test('encode/decode mci big', t => {
    t.true(getMciFromDataFeedKey('aaa\nbbbbbb\n'+encodeMci(1e9)) === 1e9);
});
test('encode/decode mci first bit set', t => {
    t.true(getMciFromDataFeedKey('aaa\nbbbbbb\n'+encodeMci(3e9)) === 3e9);
});

/**
 * getJsonSourceString
 */

test('ordered object', t => {
    const obj = {aa: ['x', "v'n", "{\"bb"], b: 8, ccc: false, "s'x": 55};
    t.true(getJsonSourceString(obj) === JSON.stringify(obj));
});

test('unordered object', t => {
    const unordered = { ccc: ['s', {d: 'c', a: 'nn'}], aa: 'j', b: 8};
    const ordered = { aa: 'j', b: 8, ccc: ['s', {a: 'nn', d: 'c', }], };
    t.true(getJsonSourceString(unordered) === JSON.stringify(ordered));
});
