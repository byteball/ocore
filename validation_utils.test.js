const test = require('ava');
const { check, gen, property } = require('testcheck');

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

test('isInteger matches Number.isInteger', t => {
  const result = check(
    property(
      gen.any,
      e => ValidationUtils.isInteger(e) === Number.isInteger(e)
    )
  );
  t.true(result.result, result);
});
