/*jslint node: true */
"use strict";

exports.COUNT_WITNESSES = 12;
exports.MAX_WITNESS_LIST_MUTATIONS = 1;
exports.TOTAL_WHITEBYTES = 1e15;
exports.MAJORITY_OF_WITNESSES = (exports.COUNT_WITNESSES%2===0) ? (exports.COUNT_WITNESSES/2+1) : Math.ceil(exports.COUNT_WITNESSES/2);
exports.COUNT_MC_BALLS_FOR_PAID_WITNESSING = 100;
exports.GENESIS_UNIT = 'viPN94397MkS/agvr+jN1kidQZwQIcSEACQOysnfpyE=';

exports.version = '1.0t';
exports.alt = '1';

exports.HASH_LENGTH = 44;
exports.PUBKEY_LENGTH = 44;
exports.SIG_LENGTH = 88;
