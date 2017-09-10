import test from 'ava';

var ValidationUtils = require("./validation_utils.js");

/**
 * hasFieldsExcept
 */

test('hasFieldsExcept happy path', t => {
  t.true(ValidationUtils.hasFieldsExcept({foo: 1}, []));
  t.true(ValidationUtils.hasFieldsExcept({foo: 1}, ["bar"]));
});

test('hasFieldsExcept empty obj', t => {
  t.false(ValidationUtils.hasFieldsExcept({}, []));
  t.false(ValidationUtils.hasFieldsExcept({}, ["foo"]));
});

test('hasFieldsExcept single fail', t => {
  t.false(ValidationUtils.hasFieldsExcept({foo: 1}, ["foo"]));
});

test('hasFieldsExcept mixed bag', t => {
  t.true(ValidationUtils.hasFieldsExcept({foo: 1, bar: 2}, ["bar", "baz"]));
});

/**
 * isInteger
 */

test('ValidationUtils.isInteger matches Number.isInteger', t => {
  [0,
   1,
   1.0,
   10,
   1E3,
   -0,
   -1,
   -1.0,
   -10,
   -1E3,
   Number.MAX_SAFE_INTEGER,
   Number.MIN_SAFE_INTEGER,
   Number.MAX_SAFE_INTEGER + 1,
   Number.MIN_SAFE_INTEGER + 1,
   "foo",
   NaN,
   {},
   [],
   true,
   false,
   undefined,
   null
  ]
  .map(function(example) {
    t.is(ValidationUtils.isInteger(example), Number.isInteger(example));
  });
});
