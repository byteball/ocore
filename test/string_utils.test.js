const test = require('ava');

const StringUtils = require('../string_utils');

const STRING_JOIN_CHAR = StringUtils.STRING_JOIN_CHAR;
const getSourceString = StringUtils.getSourceString;

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
const arrayInputResultPairs = ['s', 'n', 's', 's', 'n', 'b'].map((typ, idx) => [typ, arrayInput[idx]].join(STRING_JOIN_CHAR)).join(STRING_JOIN_CHAR);
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


