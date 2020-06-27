/*jslint node: true */
"use strict";

if (typeof process === 'object' && typeof process.versions === 'object' && typeof process.versions.node !== 'undefined') { // desktop
	var desktopApp = require('./desktop_app.js');
	var appRootDir = desktopApp.getAppRootDir();
	require('dotenv').config({path: appRootDir + '/.env'});
}

if (!Number.MAX_SAFE_INTEGER)
	Number.MAX_SAFE_INTEGER = Math.pow(2, 53) - 1; // 9007199254740991

exports.COUNT_WITNESSES = 12;
exports.MAX_WITNESS_LIST_MUTATIONS = 1;
exports.TOTAL_WHITEBYTES = 1e15;
exports.MAJORITY_OF_WITNESSES = (exports.COUNT_WITNESSES%2===0) ? (exports.COUNT_WITNESSES/2+1) : Math.ceil(exports.COUNT_WITNESSES/2);
exports.COUNT_MC_BALLS_FOR_PAID_WITNESSING = 100;

exports.bTestnet = !!process.env.testnet;
console.log('===== testnet = ' + exports.bTestnet);

exports.version = exports.bTestnet ? '2.0t' : '2.0';
exports.alt = exports.bTestnet ? '2' : '1';

exports.supported_versions = exports.bTestnet ? ['1.0t', '2.0t', '3.0t'] : ['1.0', '2.0', '3.0'];
exports.versionWithoutTimestamp = exports.bTestnet ? '1.0t' : '1.0';
exports.versionWithoutKeySizes = exports.bTestnet ? '2.0t' : '2.0';

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

exports.MAX_AA_STRING_LENGTH = 4096;
exports.MAX_STATE_VAR_NAME_LENGTH = 128;
exports.MAX_STATE_VAR_VALUE_LENGTH = 1024;
exports.MAX_OPS = 2000;
exports.MAX_RESPONSES_PER_PRIMARY_TRIGGER = 10;

exports.MIN_BYTES_BOUNCE_FEE = 10000;

exports.minCoreVersion = exports.bTestnet ? '0.3.12' : '0.3.8';
exports.minCoreVersionForFullNodes = exports.bTestnet ? '0.3.12' : '0.3.11';
exports.minCoreVersionToSharePeers = exports.bTestnet ? '0.3.9' : '0.3.9';

exports.lastBallStableInParentsUpgradeMci =  exports.bTestnet ? 0 : 1300000;
exports.witnessedLevelMustNotRetreatUpgradeMci = exports.bTestnet ? 684000 : 1400000;
exports.skipEvaluationOfUnusedNestedAddressUpgradeMci = exports.bTestnet ? 1400000 : 1400000;
exports.spendUnconfirmedUpgradeMci = exports.bTestnet ? 589000 : 2909000;
exports.branchedMinMcWlUpgradeMci = exports.bTestnet ? 593000 : 2909000;
exports.otherAddressInDefinitionUpgradeMci = exports.bTestnet ? 602000 : 2909000;
exports.attestedInDefinitionUpgradeMci = exports.bTestnet ? 616000 : 2909000;
exports.altBranchByBestParentUpgradeMci = exports.bTestnet ? 642000 : 3009824;
exports.anyDefinitionChangeUpgradeMci = exports.bTestnet ? 855000 : 4229100;
exports.formulaUpgradeMci = exports.bTestnet ? 961000 : 5210000;
exports.witnessedLevelMustNotRetreatFromAllParentsUpgradeMci = exports.bTestnet ? 909000 : 5210000;
exports.timestampUpgradeMci = exports.bTestnet ? 909000 : 5210000;
exports.aaStorageSizeUpgradeMci = exports.bTestnet ? 1034000 : 5210000;
exports.aa2UpgradeMci = exports.bTestnet ? 1358300 : 5494000;
exports.unstableInitialDefinitionUpgradeMci = exports.bTestnet ? 1358300 : 5494000;
exports.includeKeySizesUpgradeMci = exports.bTestnet ? 1383500 : 5530000;


if (process.env.devnet) {
	console.log('===== devnet');
	exports.bDevnet = true;
	exports.version = '3.0dev';
	exports.alt = '3';
	exports.supported_versions = ['1.0dev', '2.0dev', '3.0dev'];
	exports.versionWithoutTimestamp = '1.0dev';
	exports.versionWithoutKeySizes = '2.0dev';
	exports.GENESIS_UNIT = 'pLzHaCisvxkfgwyBDzgvZzhPp37ZKnuMOxiI3QwXxqM=';
	exports.BLACKBYTES_ASSET = 'GRzA4D/ElsiwivoUrkCg36s+CoOr6rLsSH2F0EOes64=';

	exports.COUNT_WITNESSES = 1;
	exports.MAJORITY_OF_WITNESSES = (exports.COUNT_WITNESSES%2===0) ? (exports.COUNT_WITNESSES/2+1) : Math.ceil(exports.COUNT_WITNESSES/2);

	exports.lastBallStableInParentsUpgradeMci = 0;
	exports.witnessedLevelMustNotRetreatUpgradeMci = 0;
	exports.spendUnconfirmedUpgradeMci = 0;
	exports.branchedMinMcWlUpgradeMci = 0;
	exports.otherAddressInDefinitionUpgradeMci = 0;
	exports.attestedInDefinitionUpgradeMci = 0;
	exports.altBranchByBestParentUpgradeMci = 0;
	exports.anyDefinitionChangeUpgradeMci = 0;
	exports.formulaUpgradeMci = 0;
	exports.witnessedLevelMustNotRetreatFromAllParentsUpgradeMci = 0;
	exports.timestampUpgradeMci = 0;
	exports.aaStorageSizeUpgradeMci = 0;
	exports.aa2UpgradeMci = 0;
	exports.unstableInitialDefinitionUpgradeMci = 0;
	exports.includeKeySizesUpgradeMci = 0;
}


exports.TEXTCOIN_CLAIM_FEE = 772 + (exports.version.length - 3);
exports.TEXTCOIN_ASSET_CLAIM_HEADER_FEE = 399 + 123 + (exports.version.length - 3);
exports.TEXTCOIN_ASSET_CLAIM_MESSAGE_FEE = 201 + 98;
exports.TEXTCOIN_ASSET_CLAIM_BASE_MSG_FEE = 197 + 106 + 1;
exports.TEXTCOIN_ASSET_CLAIM_FEE = exports.TEXTCOIN_ASSET_CLAIM_HEADER_FEE + exports.TEXTCOIN_ASSET_CLAIM_MESSAGE_FEE + exports.TEXTCOIN_ASSET_CLAIM_BASE_MSG_FEE;
exports.TEXTCOIN_PRIVATE_ASSET_CLAIM_MESSAGE_FEE = 141;
