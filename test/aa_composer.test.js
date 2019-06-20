var path = require('path');
var shell = require('child_process').execSync; 
var constants = require("../constants.js");

constants.version = '2.0dev';
constants.alt = '3';
constants.supported_versions = ['1.0dev', '2.0dev'];
constants.versionWithoutTimestamp = '1.0dev';
constants.GENESIS_UNIT = 'pLzHaCisvxkfgwyBDzgvZzhPp37ZKnuMOxiI3QwXxqM=';
constants.BLACKBYTES_ASSET = 'GRzA4D/ElsiwivoUrkCg36s+CoOr6rLsSH2F0EOes64=';

constants.COUNT_WITNESSES = 1;
constants.MAJORITY_OF_WITNESSES = (constants.COUNT_WITNESSES%2===0) ? (constants.COUNT_WITNESSES/2+1) : Math.ceil(constants.COUNT_WITNESSES/2);

constants.lastBallStableInParentsUpgradeMci = 0;
constants.witnessedLevelMustNotRetreatUpgradeMci = 0;
constants.spendUnconfirmedUpgradeMci = 0;
constants.branchedMinMcWlUpgradeMci = 0;
constants.otherAddressInDefinitionUpgradeMci = 0;
constants.attestedInDefinitionUpgradeMci = 0;
constants.altBranchByBestParentUpgradeMci = 0;
constants.anyDefinitionChangeUpgradeMci = 0;
constants.formulaUpgradeMci = 0;
constants.witnessedLevelMustNotRetreatFromAllParentsUpgradeMci = 0;
constants.timestampUpgradeMci = 0;

var objectHash = require("../object_hash.js");
var desktop_app = require('../desktop_app.js');
desktop_app.getAppDataDir = function () { return __dirname + '/.testdata-' + path.basename(__filename); }

var src_dir = __dirname + '/initial-testdata-' + path.basename(__filename);
var dst_dir = __dirname + '/.testdata-' + path.basename(__filename);
//shell('mkdir ' + dst_dir);
shell('cp -r ' + src_dir + '/ ' + dst_dir);

var db = require('../db.js');
var aa_composer = require('../aa_composer.js');
var network = require('../network.js'); // to initialize caches
var test = require('ava');

function addAA(aa) {
	var address = objectHash.getChash160(aa);
	db.query("INSERT " + db.getIgnore() + " INTO addresses (address) VALUES(?)", [address]);
	db.query("INSERT " + db.getIgnore() + " INTO aa_addresses (address, definition, unit, mci) VALUES(?, ?, ?, ?)", [address, JSON.stringify(aa), constants.GENESIS_UNIT, 0]);
}


test.after.always.cb(t => {
	db.close(() => {
		t.end();
	});
});
	
test.cb.serial('AA with response vars', t => {
	var trigger = { outputs: { base: 40000 }, data: { x: 333 } };
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					init: "{response['received_amount'] = trigger.output[[asset=base]];}",
					outputs: [
						{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - 2000}"}
					]
				}
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	addAA(aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, address, aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 1);
		t.deepEqual(arrResponses[0].bounced, false);
		t.deepEqual(arrResponses[0].response.responseVars.received_amount, 40000);
		t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger.address); }).amount, 38000);
		t.end();
	});
});

test.cb.serial('less than bounce fees', t => {
	var trigger = { outputs: { base: 2000 }, data: { x: 333 } };
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - 500}"}
					]
				}
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	addAA(aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, address, aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 1);
		t.deepEqual(arrResponses[0].aa_address, address);
		t.deepEqual(arrResponses[0].bounced, false);
		t.deepEqual(arrResponses[0].response_unit, null);
		t.deepEqual(arrResponses[0].objResponseUnit, null);
		t.deepEqual(arrResponses[0].response.error, "received bytes are not enough to cover bounce fees");
		t.end();
	});
});

