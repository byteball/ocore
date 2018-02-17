"use strict";

const test = require('ava');

const Device = require('../device.js');
var ecdsa = require('secp256k1');

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
});
