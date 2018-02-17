"use strict";

const test = require('ava');
import { deepEqual } from 'assert'

const Device = require('../device.js');
var objectHash = require('../object_hash.js');
var ecdsa = require('secp256k1');
const secp256k1 = require('secp256k1');

// don't change this!
// other implementations can cross reference these tests as long as the key
// doesn't change
const challenge = "bUSwwUmABqPGAyRteUPKdaaq/wDM5Rqr+UL3sO/a";
const priv = new Buffer("18d8bc95d3b4ae8e7dd5aaa77158f72d7ec4e8556a11e69b20a87ee7d6ac70b4", "hex");
const pubkey = "AqUMbbXfZg6uw506M9lbiJU/f74X5BhKdovkMPkspfNo"

test('private key is valid', t => {
  t.true(ecdsa.privateKeyVerify(priv));
});

test('public key is valid', t => {
  t.true(Device.isValidPubKey(pubkey));
  t.is(pubkey, secp256k1.publicKeyCreate(priv).toString('base64'));
});

test('message hash is correct', t => {
  t.is(
    objectHash.getDeviceMessageHashToSign({challenge: challenge, pubkey: pubkey}).toString('hex'),
    '1ac78e688e34a4e70a2e9ccde66ed015fb7d16203691834f702b1f76e53baaa8'
  );
});

test('challenge can be converted to loginMessage', t => {
  console.log(Device.loginMessage(challenge, priv, pubkey));
  var expected = {challenge: "bUSwwUmABqPGAyRteUPKdaaq/wDM5Rqr+UL3sO/a",
                  pubkey: "AqUMbbXfZg6uw506M9lbiJU/f74X5BhKdovkMPkspfNo",
                  signature: "cAT/c5zn4nb+5UnT5B++9ePvYdEE24qmPFTXbxYd2IE+4gQQNiHogRbyQRlXOLNto09JmRK0jHOyGeIttELkNA=="};
  var result = Device.loginMessage(challenge, priv, pubkey);
  t.is(result.challenge, expected.challenge);
  t.is(result.pubkey, expected.pubkey);
  t.is(result.signature, expected.signature);
  t.deepEqual(result, expected);
});
