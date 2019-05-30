/*jslint node: true */
"use strict";

if (typeof window === 'undefined' || !window.cordova){ // desktop
	var desktopApp = require('./desktop_app.js'+'');
	var appRootDir = desktopApp.getAppRootDir();
	require('dotenv'+'').config({path: appRootDir + '/.env'});
}

exports.COUNT_WITNESSES = 12;
exports.MAX_WITNESS_LIST_MUTATIONS = 1;
exports.TOTAL_WHITEBYTES = 1e15;
exports.MAJORITY_OF_WITNESSES = (exports.COUNT_WITNESSES%2===0) ? (exports.COUNT_WITNESSES/2+1) : Math.ceil(exports.COUNT_WITNESSES/2);
exports.COUNT_MC_BALLS_FOR_PAID_WITNESSING = 100;

exports.bTestnet = !!process.env.testnet;
console.log('===== testnet = ' + exports.bTestnet);

exports.version = exports.bTestnet ? '2.0t' : '2.0';
exports.alt = exports.bTestnet ? '2' : '1';

exports.supported_versions = exports.bTestnet ? ['1.0t', '2.0t'] : ['1.0', '2.0'];
exports.versionWithoutTimestamp = exports.bTestnet ? '1.0t' : '1.0';

//exports.bTestnet = (exports.alt === '2' && exports.version === '1.0t');

exports.GENESIS_UNIT = exports.bTestnet ? 'TvqutGPz3T4Cs6oiChxFlclY92M2MvCvfXR5/FETato=' : 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=';
exports.BLACKBYTES_ASSET = exports.bTestnet ? 'LUQu5ik4WLfCrr8OwXezqBa+i3IlZLqxj2itQZQm8WY=' : 'qO2JsiuDMh/j+pqJYZw3u82O71WjCDf0vTNvsnntr8o=';

exports.HASH_LENGTH = 44;
exports.PUBKEY_LENGTH = 44;
exports.SIG_LENGTH = 88;

// anti-spam limits
exports.MAX_AUTHORS_PER_UNIT = 16;
exports.MAX_PARENTS_PER_UNIT = 16;
exports.MAX_MESSAGES_PER_UNIT = 128;
exports.MAX_SPEND_PROOFS_PER_MESSAGE = 128;
exports.MAX_INPUTS_PER_PAYMENT_MESSAGE = 128;
exports.MAX_OUTPUTS_PER_PAYMENT_MESSAGE = 128;
exports.MAX_CHOICES_PER_POLL = 128;
exports.MAX_CHOICE_LENGTH = 64;
exports.MAX_DENOMINATIONS_PER_ASSET_DEFINITION = 64;
exports.MAX_ATTESTORS_PER_ASSET = 64;
exports.MAX_DATA_FEED_NAME_LENGTH = 64;
exports.MAX_DATA_FEED_VALUE_LENGTH = 64;
exports.MAX_AUTHENTIFIER_LENGTH = 4096;
exports.MAX_CAP = 9e15;
exports.MAX_COMPLEXITY = 100;
exports.MAX_UNIT_LENGTH = 5e6;

exports.MAX_PROFILE_FIELD_LENGTH = 50;
exports.MAX_PROFILE_VALUE_LENGTH = 100;

exports.TEXTCOIN_CLAIM_FEE = 548;
exports.TEXTCOIN_ASSET_CLAIM_FEE = 750;
exports.TEXTCOIN_ASSET_CLAIM_HEADER_FEE = 391;
exports.TEXTCOIN_ASSET_CLAIM_MESSAGE_FEE = 209;
exports.TEXTCOIN_ASSET_CLAIM_BASE_MSG_FEE = 158;
exports.TEXTCOIN_PRIVATE_ASSET_CLAIM_MESSAGE_FEE = 99;

exports.minCoreVersion = exports.bTestnet ? '0.2.95' : '0.2.0';
exports.minCoreVersionForFullNodes = exports.bTestnet ? '0.2.95' : '0.2.94';

exports.lastBallStableInParentsUpgradeMci = 1300000;
exports.witnessedLevelMustNotRetreatUpgradeMci = exports.bTestnet ? 684000 : 1400000;
exports.spendUnconfirmedUpgradeMci = exports.bTestnet ? 589000 : 2909000;
exports.branchedMinMcWlUpgradeMci = exports.bTestnet ? 593000 : 2909000;
exports.otherAddressInDefinitionUpgradeMci = exports.bTestnet ? 602000 : 2909000;
exports.attestedInDefinitionUpgradeMci = exports.bTestnet ? 616000 : 2909000;
exports.altBranchByBestParentUpgradeMci = exports.bTestnet ? 642000 : 3009824;
exports.anyDefinitionChangeUpgradeMci = exports.bTestnet ? 855000 : 4229100;
exports.formulaUpgradeMci = exports.bTestnet ? Infinity : Infinity;
exports.witnessedLevelMustNotRetreatFromAllParentsUpgradeMci = exports.bTestnet ? 909000 : Infinity;
exports.timestampUpgradeMci = exports.bTestnet ? 909000 : Infinity;
