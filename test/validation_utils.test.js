const test = require('ava');
const { check, gen, property } = require('testcheck');

const ValidationUtils = require("../validation_utils.js");

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

test('isInteger === Number.isInteger', t => {
  const result = check(
    property(
      gen.any,
      e => ValidationUtils.isInteger(e) === Number.isInteger(e)
    )
  );
  t.true(result.result, result);
});

/**
 * isPositiveInteger
 */

test('isPositiveInteger false for not ints', t => {
  const result = check(
    property(
      gen.any.suchThat(n => !Number.isInteger(n)),
      e => !ValidationUtils.isPositiveInteger(e)
    )
  );
  t.true(result.result, result);
});

test('isPositiveInteger true for posInts', t => {
  const result = check(
    property(
      gen.sPosInt,
      e => ValidationUtils.isPositiveInteger(e)
    )
  );
  t.true(result.result, result);
});

test('isPositiveInteger false for negInts', t => {
  const result = check(
    property(
      gen.negInt,
      e => !ValidationUtils.isPositiveInteger(e)
    )
  );
  t.true(result.result, result);
});

test('isPositiveInteger false for 0', t => {
  t.false(ValidationUtils.isPositiveInteger(0));
});

/**
 * isNonnegativeInteger
 */

test('isNonnegativeInteger false for not ints', t => {
  const result = check(
    property(
      gen.any.suchThat(n => !Number.isInteger(n)),
      e => !ValidationUtils.isNonnegativeInteger(e)
    )
  );
  t.true(result.result, result);
});

test('isNonnegativeInteger true for posInts', t => {
  const result = check(
    property(
      gen.posInt,
      e => ValidationUtils.isNonnegativeInteger(e)
    )
  );
  t.true(result.result, result);
});

test('isNonnegativeInteger false for negInts', t => {
  const result = check(
    property(
      // https://github.com/byteball/byteballcore/issues/47
      gen.sNegInt,
      e => !ValidationUtils.isNonnegativeInteger(e)
    )
  );
  t.true(result.result, result);
});

/**
 * isNonemptyString
 */

test('isNonemptyString false for empty string', t => {
  t.false(ValidationUtils.isNonemptyString(''));
});

test('isNonemptyString false for non strings', t => {
  const result = check(
    property(
      gen.any.suchThat(s => typeof s !== 'string'),
      e => !ValidationUtils.isNonemptyString(e)
    )
  );
  t.true(result.result, result);
});

test('isNonemptyString true for strings other than the empty string', t => {
  const result = check(
    property(
      gen.string.suchThat(s => s !== ''),
      e => ValidationUtils.isNonemptyString(e)
    )
  );
  t.true(result.result, result);
});

/**
 * isStringOfLength
 */

test('isStringOfLength false for non strings', t => {
  const result = check(
    property(
      gen.any.suchThat(s => typeof s !== 'string'),
      gen.any,
      (e, a) => !ValidationUtils.isStringOfLength(e, a)
    )
  );
  t.true(result.result, result);
});

test('isStringOfLength true for strings of length len', t => {
  const result = check(
    property(
      gen.string,
      e => ValidationUtils.isStringOfLength(e, e.length)
    )
  );
  t.true(result.result, result);
});

test('isStringOfLength false for strings not of length len', t => {
  const result = check(
    property(
      gen.string,
      gen.int.suchThat(i => i != 0),
      (e, i) => !ValidationUtils.isStringOfLength(e, e.length + i)
    )
  );
  t.true(result.result, result);
});

test('isStringOfLength false for all non-integer len', t => {
  const result = check(
    property(
      gen.string,
      gen.any.suchThat(a => !Number.isInteger(a)),
      (e, a) => !ValidationUtils.isStringOfLength(e, a)
    )
  );
  t.true(result.result, result);
});

test('isStringOfLength false when len not provided', t => {
  const result = check(
    property(
      gen.any,
      e => !ValidationUtils.isStringOfLength(e)
    )
  );
  t.true(result.result, result);
});
