var path = require('path');
var shell = require('child_process').execSync;
var _ = require('lodash');

process.env.devnet = 1;
var constants = require("../constants.js");
var objectHash = require("../object_hash.js");
var desktop_app = require('../desktop_app.js');
desktop_app.getAppDataDir = function () { return __dirname + '/.testdata-' + path.basename(__filename); }

var src_dir = __dirname + '/initial-testdata-' + path.basename(__filename);
var dst_dir = __dirname + '/.testdata-' + path.basename(__filename);
//shell('mkdir ' + dst_dir);
shell('rm -rf ' + dst_dir);
shell('cp -r ' + src_dir + '/ ' + dst_dir);

var db = require('../db.js');
var aa_validation = require('../aa_validation.js');
var aa_composer = require('../aa_composer.js');
var storage = require('../storage.js');
var eventBus = require('../event_bus.js');
var network = require('../network.js'); // to initialize caches
var test = require('ava');

process.on('unhandledRejection', up => { throw up; });

var readGetterProps = function (aa_address, func_name, cb) {
	storage.readAAGetterProps(db, aa_address, func_name, cb);
};

function validateAA(aa, cb) {
	aa_validation.validateAADefinition(aa, readGetterProps, Number.MAX_SAFE_INTEGER, cb);
}

function addAA(aa) {
	var address = objectHash.getChash160(aa);
	db.query("INSERT " + db.getIgnore() + " INTO addresses (address) VALUES(?)", [address]);
	storage.insertAADefinitions(db, [{ address, definition: aa }], constants.GENESIS_UNIT, 1, false);
}

async function asyncAddAA(aa) {
	var address = objectHash.getChash160(aa);
	await db.query("INSERT " + db.getIgnore() + " INTO addresses (address) VALUES(?)", [address]);
	await storage.insertAADefinitions(db, [{ address, definition: aa }], constants.GENESIS_UNIT, 1, false);
}

var old_cache = {};

// this hack is necessary only for 1-witness network where an AA-response unit can rebuild the MC to itself
function fixCache() {
	if (Object.keys(old_cache.assocUnstableUnits).length !== 1)
		return;
	for (var unit in storage.assocUnstableUnits) {
		var objUnit = storage.assocUnstableUnits[unit];
		if (objUnit.is_free) {
			objUnit.is_on_main_chain = old_cache.assocUnstableUnits[unit].is_on_main_chain;
			objUnit.main_chain_index = old_cache.assocUnstableUnits[unit].main_chain_index;
		}
	}
}

test.before.cb(t => {
	eventBus.once('caches_ready', () => {
		old_cache.assocUnstableUnits = _.cloneDeep(storage.assocUnstableUnits);
		old_cache.assocStableUnits = _.cloneDeep(storage.assocStableUnits);
		old_cache.assocUnstableMessages = _.cloneDeep(storage.assocUnstableMessages);
		old_cache.assocBestChildren = _.cloneDeep(storage.assocBestChildren);
		old_cache.assocStableUnitsByMci = _.cloneDeep(storage.assocStableUnitsByMci);
		t.end();
	});
});

test.after.always.cb(t => {
	db.close(t.end);
	console.log('***** aa_composer.test done');
});

test.cb.serial('AA with response vars', t => {
	var trigger = { outputs: { base: 40000 }, data: { x: 333 } };
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		doc_url: 'https://myapp.com/description.json',
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

	validateAA(aa, async err => {
		t.deepEqual(err, null);

		var address = objectHash.getChash160(aa);
		await addAA(aa);
		
		aa_composer.dryRunPrimaryAATrigger(trigger, address, aa, (arrResponses) => {
			t.deepEqual(arrResponses.length, 1);
			t.deepEqual(arrResponses[0].bounced, false);
			t.deepEqual(arrResponses[0].response.responseVars.received_amount, 40000);
			t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger.address); }).amount, 38000);
			fixCache();
			t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
			t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
			t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
			t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
			t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
			t.end();
		});
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
		t.deepEqual(arrResponses[0].bounced, true);
		t.deepEqual(arrResponses[0].response_unit, null);
		t.deepEqual(arrResponses[0].objResponseUnit, null);
		t.deepEqual(arrResponses[0].response.error, "received bytes are not enough to cover bounce fees");
		fixCache();
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});

test.cb.serial('chain of AAs', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 40000 }, data: { x: 333 }, address: trigger_address };

	var secondary_aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{trigger.initial_address}", amount: "{trigger.output[[asset=base]] - 1000}"}
					]
				}
			},
			{
				app: 'state',
				state: `{
					var['who'] = trigger.address || timestamp;
					var['initial'] = trigger.initial_address || timestamp;
					var['large_num2'] = var[trigger.address]['large_num'] + 1;
					var['long_num2'] = var[trigger.address]['long_num'] + 1;
				}`
			}
		]
	}];
	var secondary_address = objectHash.getChash160(secondary_aa);
	addAA(secondary_aa);

	var primary_aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: secondary_address, amount: "{trigger.output[[asset=base]] - 1000}"}
					]
				}
			},
			{
				app: 'state',
				state: `{
					var['who'] = trigger.address || timestamp;
					var['initial'] = trigger.initial_address || timestamp;
					var['large_num'] = 1e15;
					var['long_num'] = 0.000678901234567;
				}`
			}
		]
	}];
	var primary_address = objectHash.getChash160(primary_aa);
	addAA(primary_aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, primary_address, primary_aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 2);
		t.deepEqual(arrResponses[0].aa_address, primary_address);
		t.deepEqual(arrResponses[0].bounced, false);
		t.deepEqual(arrResponses[0].response.error, undefined);
		t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === secondary_address); }).amount, 39000);
		t.deepEqual(arrResponses[0].updatedStateVars[primary_address], {
			who: { value: trigger_address + arrResponses[0].objResponseUnit.timestamp },
			initial: { value: trigger_address + arrResponses[0].objResponseUnit.timestamp },
			large_num: { value: 1e15 },
			long_num: { value: 0.000678901234567 },
		});
		t.deepEqual(arrResponses[0].updatedStateVars[secondary_address], {
			who: { value: primary_address + arrResponses[1].objResponseUnit.timestamp },
			initial: { value: trigger_address + arrResponses[1].objResponseUnit.timestamp },
			large_num2: { value: 1e15 }, // the same due to loss of precision
			long_num2: { value: 1.00067890123457 }, // rounded to 15 significant digits (but uses cached vars)
		});
		
		t.deepEqual(arrResponses[1].aa_address, secondary_address);
		t.deepEqual(arrResponses[1].bounced, false);
		t.deepEqual(arrResponses[1].response.error, undefined);
		t.deepEqual(arrResponses[1].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger_address); }).amount, 38000);
		t.deepEqual(arrResponses[1].updatedStateVars, undefined);
		
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});


test.cb.serial('AA with state changes only', t => {
	var trigger = { outputs: { base: 40000 }, data: { x: 333 } };
	var aa = ['autonomous agent', {
		messages: [
			{
				app: 'state',
				state: `{
					var['count'] += 1;
					var['unit'] = response_unit;
				}`
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	addAA(aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, address, aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 1);
		t.deepEqual(arrResponses[0].bounced, false);
		t.deepEqual(arrResponses[0].updatedStateVars[address].count.delta, 1);
		t.deepEqual(arrResponses[0].updatedStateVars[address].unit.value, false);
		fixCache();
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});


test.cb.serial('AA with insufficient balance for storage', t => {
	var trigger = { outputs: { base: 40000 }, data: { x: 333 } };
	var aa = ['autonomous agent', {
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{trigger.address}"}
					]
				}
			},
			{
				app: 'state',
				state: `{
					var['count'] += 1;
					var['unit'] = response_unit;
					var['last_addr'] = trigger.address;
				}`
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	addAA(aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, address, aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 1);
		console.log('--- responses', arrResponses);
		t.deepEqual(arrResponses[0].bounced, true);
		fixCache();
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});

test.cb.serial('AA with storage < 60 bytes', t => {
	// state var size is only 54 bytes
	var trigger = { outputs: { base: 40000 }, data: { x: 333 } };
	var aa = ['autonomous agent', {
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{trigger.address}"}
					]
				}
			},
			{
				app: 'state',
				state: `{
					var['count'] += 1;
					var['unit'] = response_unit;
				}`
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	addAA(aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, address, aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 1);
		console.log('--- responses', arrResponses);
		t.deepEqual(arrResponses[0].bounced, false);
		fixCache();
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});


test.cb.serial('recently defined asset', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 40000 }, data: { x: 333 }, address: trigger_address };

	var secondary_aa = ['autonomous agent', {
		messages: [
			{
				app: 'state',
				state: `{
					$asset = var[trigger.address]['asset'];
					var['asset'] = $asset;
					var['exists'] = asset[$asset].exists;
					var['is_issued'] = asset[$asset].is_issued;
				}`
			}
		]
	}];
	var secondary_address = objectHash.getChash160(secondary_aa);
	addAA(secondary_aa);

	var primary_aa = ['autonomous agent', {
		messages: [
			{
				app: 'asset',
				payload: {
					cap: 1e6,
					is_private: false,
					is_transferrable: true,
					auto_destroy: false,
					fixed_denominations: false,
					issued_by_definer_only: true,
					cosigned_by_definer: false,
					spender_attested: false,
				}
			},
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: secondary_address, amount: "{trigger.output[[asset=base]] - 1000}"}
					]
				}
			},
			{
				app: 'state',
				state: `{
					var['asset'] = response_unit;
				}`
			}
		]
	}];
	var primary_address = objectHash.getChash160(primary_aa);
	addAA(primary_aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, primary_address, primary_aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 2);
		t.deepEqual(arrResponses[0].aa_address, primary_address);
		t.deepEqual(arrResponses[0].bounced, false);
		t.deepEqual(arrResponses[0].response.error, undefined);
		t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === secondary_address); }).amount, 39000);
		let asset = arrResponses[0].updatedStateVars[primary_address].asset.value;
		
		t.deepEqual(arrResponses[1].aa_address, secondary_address);
		t.deepEqual(arrResponses[1].bounced, false);
		t.deepEqual(arrResponses[1].response.error, undefined);
		t.deepEqual(arrResponses[1].response.info, 'no messages after filtering');
		t.deepEqual(arrResponses[0].updatedStateVars[secondary_address].asset.value, asset);
		t.deepEqual(arrResponses[0].updatedStateVars[secondary_address].exists.value, 1); // converted from true
		t.deepEqual(arrResponses[0].updatedStateVars[secondary_address].is_issued.value, false); // false=deleted
		
		fixCache();
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});


test.cb.serial('issue recently defined asset', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 10000 }, data: { define: true }, address: trigger_address };

	// a chain of 3 AA responses
	// 1. define asset, save var['asset'] state var, and send bytes to bouncer AA
	// 2. bouncer reflects the bytes back
	// 3. the 1st AA acts again, it reads the state var and issues the asset

	var bouncer_aa = ['autonomous agent', {
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - 1000}"}
					]
				}
			},
		]
	}];
	var bouncer_address = objectHash.getChash160(bouncer_aa);
	addAA(bouncer_aa);

	var asset_aa = ['autonomous agent', {
		messages: {
			cases: [
				{
					if: "{trigger.data.define}",
					messages: [
						{
							app: 'asset',
							payload: {
								cap: 1e6,
								is_private: false,
								is_transferrable: true,
								auto_destroy: false,
								fixed_denominations: false,
								issued_by_definer_only: true,
								cosigned_by_definer: false,
								spender_attested: false,
							}
						},
						{
							app: 'payment',
							payload: {
								asset: 'base',
								outputs: [
									{address: bouncer_address, amount: "{trigger.output[[asset=base]] - 1000}"}
								]
							}
						},
						{
							app: 'state',
							state: `{
								var['asset'] = response_unit;
							}`
						}
					]
				},
				{
					if: `{trigger.address == '${bouncer_address}' AND var['asset']}`,
					messages: [{
						app: 'payment',
						payload: {
							asset: "{var['asset']}",
							outputs: [
								{address: "{trigger.initial_address}", amount: "{asset[var['asset']].cap}"}
							]
						}
					}]
				},
			]
		}
	}];
	var asset_address = objectHash.getChash160(asset_aa);
	addAA(asset_aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, asset_address, asset_aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 3);
		t.deepEqual(arrResponses[0].aa_address, asset_address);
		t.deepEqual(arrResponses[0].bounced, false);
		t.deepEqual(arrResponses[0].response.error, undefined);
		t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === bouncer_address); }).amount, 9000);
		let asset = arrResponses[0].updatedStateVars[asset_address].asset.value;
		
		t.deepEqual(arrResponses[1].aa_address, bouncer_address);
		t.deepEqual(arrResponses[1].bounced, false);
		t.deepEqual(arrResponses[1].response.error, undefined);
		
		t.deepEqual(arrResponses[2].aa_address, asset_address);
		t.deepEqual(arrResponses[2].bounced, false);
		t.deepEqual(arrResponses[2].response.error, undefined);
		t.deepEqual(arrResponses[2].objResponseUnit.messages.find(function (message) { return (message.app === 'payment' && message.payload.asset === asset); }).payload.outputs.find(function (output) { return (output.address === trigger_address); }).amount, 1e6);
		
		fixCache();
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});


test.cb.serial('define new AA and activate it', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 10000 }, data: { define: true }, address: trigger_address };

	// a chain of 3 AA responses
	// 1. define new AA, save its address in var['new_aa'] state var, and send bytes to forwarder AA
	// 2. forwarder sends the bytes to the new AA
	// 3. the new AA posts data

	var data_poster_hidden_definition = ['autonomous agent', {
		messages: [
			{
				app: 'data',
				payload: {
					trigger_address: "{'{trigger.address}'}",
					amount_received: "{'{trigger.output[[asset=base]]}'}",
				}
			},
		]
	}];

	var forwarder_aa = ['autonomous agent', {
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{var[trigger.address]['new_aa']}", amount: "{trigger.output[[asset=base]] - 1000}"}
					]
				}
			},
		]
	}];
	var forwarder_address = objectHash.getChash160(forwarder_aa);
	addAA(forwarder_aa);


	var definition_aa = ['autonomous agent', {
		messages: [
			{
				app: 'definition',
				payload: {
					definition: data_poster_hidden_definition,
				}
			},
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: forwarder_address, amount: "{trigger.output[[asset=base]] - 1000}"}
					]
				}
			},
			{
				app: 'state',
				state: `{
					var['new_aa'] = unit[response_unit].messages[[.app='definition']].payload.address;
				}`
			}
		]
	}];
	var definition_aa_address = objectHash.getChash160(definition_aa);
	addAA(definition_aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, definition_aa_address, definition_aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 3);
		t.deepEqual(arrResponses[0].aa_address, definition_aa_address);
		t.deepEqual(arrResponses[0].bounced, false);
		t.deepEqual(arrResponses[0].response.error, undefined);
		t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === forwarder_address); }).amount, 9000);
		let new_aa_address = arrResponses[0].updatedStateVars[definition_aa_address].new_aa.value;
		t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'definition'); }).payload.address, new_aa_address);
		
		t.deepEqual(arrResponses[1].aa_address, forwarder_address);
		t.deepEqual(arrResponses[1].bounced, false);
		t.deepEqual(arrResponses[1].response.error, undefined);
		
		t.deepEqual(arrResponses[2].aa_address, new_aa_address);
		t.deepEqual(arrResponses[2].bounced, false);
		t.deepEqual(arrResponses[2].response.error, undefined);
		t.deepEqual(arrResponses[2].objResponseUnit.messages.find(function (message) { return (message.app === 'data'); }).payload, {trigger_address: forwarder_address, amount_received: 8000});
		
		fixCache();
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});


test.cb.serial('parameterized AA', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 10000 }, data: { define: true }, address: trigger_address };

	var base_aa = ['autonomous agent', {
		messages: [
			{
				app: 'data',
				payload: {
					expiry: `{params.expiry}`,
				}
			},
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: `{trigger.address}`, amount: "{trigger.output[[asset=base]] - params.fee}"}
					]
				}
			},
			{
				app: 'state',
				state: `{
					var['me'] = this_address;
				}`
			}
		]
	}];
	var base_aa_address = objectHash.getChash160(base_aa);
	addAA(base_aa);

	var parameterized_aa = ['autonomous agent', {
		base_aa: base_aa_address,
		params: {expiry: '2020-01-31', fee: 2000},
	}]
	var parameterized_aa_address = objectHash.getChash160(parameterized_aa);
	addAA(parameterized_aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, parameterized_aa_address, parameterized_aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 1);
		t.deepEqual(arrResponses[0].aa_address, parameterized_aa_address);
		t.deepEqual(arrResponses[0].bounced, false);
		t.deepEqual(arrResponses[0].response.error, undefined);
		t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger_address); }).amount, 8000);
		let me = arrResponses[0].updatedStateVars[parameterized_aa_address].me.value;
		t.deepEqual(me, parameterized_aa_address);
		t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'data'); }).payload, {expiry: '2020-01-31'});
				
		fixCache();
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});


test.cb.serial('reading definition in parameterized AA', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 10000 }, data: { define: true }, address: trigger_address };

	var base_aa = ['autonomous agent', {
		messages: [
			{
				app: 'data',
				payload: {
					expiry: `{params.expiry}`,
					base: `{definition[this_address].1.base_aa}`,
					deep: `{definition[definition[this_address][1].base_aa].1.messages[[.app='data']].payload.expiry}`,
				}
			},
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: `{trigger.address}`, amount: "{trigger.output[[asset=base]] - params.fee}"}
					]
				}
			},
			{
				app: 'state',
				state: `{
					var['me'] = this_address;
				}`
			}
		]
	}];
	var base_aa_address = objectHash.getChash160(base_aa);
	addAA(base_aa);

	var parameterized_aa = ['autonomous agent', {
		base_aa: base_aa_address,
		params: {expiry: '2020-01-31', fee: 2000},
	}]
	var parameterized_aa_address = objectHash.getChash160(parameterized_aa);
	addAA(parameterized_aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, parameterized_aa_address, parameterized_aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 1);
		t.deepEqual(arrResponses[0].aa_address, parameterized_aa_address);
		t.deepEqual(arrResponses[0].bounced, false);
		t.deepEqual(arrResponses[0].response.error, undefined);
		t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger_address); }).amount, 8000);
		let me = arrResponses[0].updatedStateVars[parameterized_aa_address].me.value;
		t.deepEqual(me, parameterized_aa_address);
		t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'data'); }).payload, {expiry: '2020-01-31', base: base_aa_address, deep: '{params.expiry}'});
				
		fixCache();
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});

test.cb.serial('AA with functions', t => {
	var trigger = { outputs: { base: 10000 }, data: { x: 5 } };
	var aa = ['autonomous agent', {
		init: `{
			$f = ($x) => {
				$y = $x * var['s'];
				$y
			};
		}`,
		messages: [
			{
				app: 'state',
				state: `{
					$f2 = ( $x ) => {
						$x + $f ($x) + trigger.data.x
					};
					var['v1'] = $f(2);
					var['s'] = 3;
					var['v2'] = $f ( 2 );
					var['v3'] = $f2 ( 2 );
				}`
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	addAA(aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, address, aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 1);
		t.deepEqual(arrResponses[0].bounced, false);
		t.deepEqual(arrResponses[0].updatedStateVars[address].v1.value, 0);
		t.deepEqual(arrResponses[0].updatedStateVars[address].v2.value, 6);
		t.deepEqual(arrResponses[0].updatedStateVars[address].v3.value, 2 + 6 + 5);
		fixCache();
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});

test.cb.serial('AA with messages composed of objects', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 10000 }, data: { x: 5 }, address: trigger_address };
	var aa = ['autonomous agent', {
		init: `{
			$getPayload = ($fee) => {
				$output = {
					address: trigger.address,
					amount: trigger.output[[asset=base]] - $fee
				};
				{
					asset: 'base',
					outputs: [$output]
				}
			};
		}`,
		messages: [
			{
				app: 'payment',
				payload: `{$getPayload(1000)}`
			},
		]
	}];

	validateAA(aa, err => {
		t.deepEqual(err, null);

		var address = objectHash.getChash160(aa);
		addAA(aa);
		
		aa_composer.dryRunPrimaryAATrigger(trigger, address, aa, (arrResponses) => {
			t.deepEqual(arrResponses.length, 1);
			t.deepEqual(arrResponses[0].bounced, false);
			t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger_address); }).amount, 9000);
			fixCache();
			t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
			t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
			t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
			t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
			t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
			t.end();
		});
	});
});

test.cb.serial('AA with generated messages', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 10000 }, data: { x: 5 }, address: trigger_address };
	var aa = ['autonomous agent', {
		init: `{
			$getMessage = ($fee) => {
				$output = {
					address: trigger.address,
					amount: trigger.output[[asset=base]] - $fee
				};
				return {
					app: 'payment',
					payload: {
						asset: 'base',
						outputs: [$output]
					}
				};					
			};
		}`,
		messages: [
			`{$getMessage(1000)}`,
			{
				app: 'state',
				state: `{}`
			}
		]
	}];

	validateAA(aa, err => {
		t.deepEqual(err, null);

		var address = objectHash.getChash160(aa);
		addAA(aa);
		
		aa_composer.dryRunPrimaryAATrigger(trigger, address, aa, (arrResponses) => {
			t.deepEqual(arrResponses.length, 1);
			t.deepEqual(arrResponses[0].bounced, false);
			t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger_address); }).amount, 9000);
			fixCache();
			t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
			t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
			t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
			t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
			t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
			t.end();
		});
	});
});

test.cb.serial('AA with generated definition of new AA and immediately sending to this new AA', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 10000 }, data: { x: 5 }, address: trigger_address };

	var child_aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		doc_url: 'https://myapp.com/description.json',
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					init: "{response['received_amount'] = trigger.output[[asset=base]];}",
					outputs: [
						{address: "{trigger.initial_address}", amount: "{min(trigger.output[[asset=base]] - 2000, 5000)}"}
					]
				}
			}
		]
	}];
	var child_aa_address = objectHash.getChash160(child_aa);
	
	var factory_aa = ['autonomous agent', {
		init: `{
			$child_aa = ['autonomous agent', {
				bounce_fees: { base: 10000 },
				doc_url: 'https://myapp.com/description.json',
				messages: [
					{
						app: 'payment',
						payload: {
							asset: 'base',
							init: "{response['received_amount'] = trigger.output[[asset=base]];}",
							outputs: [
								{address: "{trigger.initial_address}", amount: "{min(trigger.output[[asset=base]] - 2000, 5000)}"}
							]
						}
					}
				]
			}];
			$child_aa_address = chash160($child_aa);
		}`,
		messages: [
			{
				app: 'definition',
				payload: {
					definition: `{$child_aa}`
				}
			},
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [{address: `{$child_aa_address}`, amount: 8000}]
				}
			},
			{
				app: 'state',
				state: `{
					var['child_aa1'] = $child_aa_address;
					var['child_aa2'] = unit[response_unit].messages[[.app='definition']].payload.address;
				}`
			}
		]
	}];

	validateAA(factory_aa, err => {
		t.deepEqual(err, null);

		var factory_address = objectHash.getChash160(factory_aa);
		addAA(factory_aa);
		
		aa_composer.dryRunPrimaryAATrigger(trigger, factory_address, factory_aa, (arrResponses) => {
			t.deepEqual(arrResponses.length, 2);
			t.deepEqual(arrResponses[0].bounced, false);
			t.deepEqual(arrResponses[0].updatedStateVars[factory_address].child_aa1.value, child_aa_address);
			t.deepEqual(arrResponses[0].updatedStateVars[factory_address].child_aa2.value, child_aa_address);
			t.deepEqual(arrResponses[0].objResponseUnit.messages.find(function (message) { return (message.app === 'definition'); }).payload.definition, child_aa);
			t.deepEqual(arrResponses[1].objResponseUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger_address); }).amount, 5000);
			fixCache();
			t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
			t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
			t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
			t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
			t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
			t.end();
		});
	});
});

test.cb.serial('trying to modify a var conditionally frozen in an earlier formula', t => {
	var trigger = { outputs: { base: 10000 }, data: { x: 333 } };
	var aa = ['autonomous agent', {
		init: `{
			$x={a:9};
			if (true)
				freeze($x);
		}`,
		messages: [
			{
				app: 'state',
				state: `{
					$x.b = 8;
				}`
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	addAA(aa);
	
	aa_composer.dryRunPrimaryAATrigger(trigger, address, aa, (arrResponses) => {
		t.deepEqual(arrResponses.length, 1);
		t.deepEqual(arrResponses[0].aa_address, address);
		t.deepEqual(arrResponses[0].bounced, true);
		t.deepEqual(arrResponses[0].response_unit, null);
		t.deepEqual(arrResponses[0].objResponseUnit, null);
		t.deepEqual(arrResponses[0].response.error, `formula 
					$x.b = 8;
				 failed: variable x is frozen`);
		fixCache();
		t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
		t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
		t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
		t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
		t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
		t.end();
	});
});

test.cb.serial('calling a remote function', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 10000 }, data: { x: 5 }, address: trigger_address };

	var remote_aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		doc_url: 'https://myapp.com/description.json',
		getters: `{
			$f = ($x) => {
				{
					sq: $x^2,
					this: this_address,
					bal: balance[base]
				}
			};
		}`,
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					init: "{response['received_amount'] = trigger.output[[asset=base]];}",
					outputs: [
						{address: "{trigger.initial_address}", amount: "{min(trigger.output[[asset=base]] - 2000, 5000)}"}
					]
				}
			}
		]
	}];
	var remote_aa_address = objectHash.getChash160(remote_aa);
	
	var aa = ['autonomous agent', {
		init: `{
			$ret = ${remote_aa_address}.$f(trigger.data.x);
		}`,
		messages: [
			{
				app: 'state',
				state: `{
					var['sq'] = $ret.sq;
					var['this'] = $ret.this;
					var['bal'] = $ret.bal;
				}`
			}
		]
	}];

	validateAA(remote_aa, async err => {
		t.deepEqual(err, null);
		await asyncAddAA(remote_aa);

		validateAA(aa, async err => {
			t.deepEqual(err, null);

			var aa_address = objectHash.getChash160(aa);
			await asyncAddAA(aa);
			
			aa_composer.dryRunPrimaryAATrigger(trigger, aa_address, aa, (arrResponses) => {
				t.deepEqual(arrResponses.length, 1);
				t.deepEqual(arrResponses[0].bounced, false);
				t.deepEqual(arrResponses[0].updatedStateVars[aa_address].sq.value, 25);
				t.deepEqual(arrResponses[0].updatedStateVars[aa_address].this.value, remote_aa_address);
				t.deepEqual(arrResponses[0].updatedStateVars[aa_address].bal.value, 0);
				fixCache();
				t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
				t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
				t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
				t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
				t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
				t.end();
			});
		});
	});
});

test.cb.serial('calling a remote function in a parameterized AA', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 10000 }, data: { x: 5 }, address: trigger_address };

	var remote_base_aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		doc_url: 'https://myapp.com/description.json',
		getters: `{
			$a = 10;
			$f = ($x) => {
				{
					sq: $x^2,
					this: this_address,
					bal: balance[base],
					fee: params.fee,
					vvv: params.vvv,
					ss: storage_size,
					ts: timestamp,
					mci: mci,
					a: $a,
				}
			};
		}`,
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					init: "{response['received_amount'] = trigger.output[[asset=base]];}",
					outputs: [
						{address: "{trigger.initial_address}", amount: "{min(trigger.output[[asset=base]] - 2000, 5000)}"}
					]
				}
			}
		]
	}];
	var remote_base_aa_address = objectHash.getChash160(remote_base_aa);
	
	var remote_aa = ['autonomous agent', {
		base_aa: remote_base_aa_address,
		params: {
			vvv: "fff",
			fee: 0.02,
		}
	}];
	var remote_aa_address = objectHash.getChash160(remote_aa);
	
	var aa = ['autonomous agent', {
		init: `{
			$remote_aa = '${remote_aa_address}';
			$ret = $remote_aa.$f(trigger.data.x);
		}`,
		messages: [
			{
				app: 'state',
				state: `{
					var['sq'] = $ret.sq;
					var['this'] = $ret.this;
					var['bal'] = $ret.bal;
					var['fee'] = $ret.fee;
					var['vvv'] = $ret.vvv;
					var['ss'] = $ret.ss;
					var['ts'] = $ret.ts;
					var['mci'] = $ret.mci;
					var['a'] = $ret.a;
				}`
			}
		]
	}];
	var aa_address = objectHash.getChash160(aa);

	validateAA(remote_base_aa, async err => {
		t.deepEqual(err, null);
		await asyncAddAA(remote_base_aa);

		validateAA(remote_aa, async err => {
			t.deepEqual(err, null);
			await asyncAddAA(remote_aa);
			await db.query("UPDATE aa_addresses SET storage_size=100 WHERE address=?", [remote_aa_address]);
			var objLastStableMcUnitProps = await storage.readLastStableMcUnitProps(db);

			validateAA(aa, async err => {
				t.deepEqual(err, null);
				await asyncAddAA(aa);
				
				aa_composer.dryRunPrimaryAATrigger(trigger, aa_address, aa, (arrResponses) => {
					t.deepEqual(arrResponses.length, 1);
					t.deepEqual(arrResponses[0].bounced, false);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].sq.value, 25);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].this.value, remote_aa_address);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].bal.value, 0);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].fee.value, 0.02);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].vvv.value, 'fff');
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].ss.value, 100);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].ts.value, objLastStableMcUnitProps.timestamp);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].mci.value, objLastStableMcUnitProps.main_chain_index);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].a.value, 10);
					fixCache();
					t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
					t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
					t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
					t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
					t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
					t.end();
				});
			});
		});
	});
});

test.cb.serial('calling a chain of remote functions', t => {
	var trigger_address = "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT";
	var trigger = { outputs: { base: 10000 }, data: { x: 5 }, address: trigger_address };

	var remote_aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		doc_url: 'https://myapp.com/description.json',
		getters: `{
			$a = 10;
			$f = ($x) => {
				{
					sq: $x^2,
					this: this_address,
					bal: balance[base],
					ss: storage_size,
					ts: timestamp,
					mci: mci,
					a: $a,
				}
			};
		}`,
		messages: [
			{
				app: 'state',
				state: `{
					var['d'] = 100;
				}`
			}
		]
	}];
	var remote_aa_address = objectHash.getChash160(remote_aa);
	
	var remote_intermediary_aa = ['autonomous agent', {
		getters: `{
			$a = 20;
			$origin_aa = '${remote_aa_address}';
			$h = ($x) => {
				3*$x
			};
			$g = ($x) => {
				$ret = $origin_aa.$f($x);
				$ret.origin_aa = $origin_aa;
				{
					origin: $ret,
					this: this_address,
					bal: balance[base],
					ss: storage_size,
					ts: timestamp,
					mci: mci,
					h: $h($x)
				}
			};
		}`,
		init: `{
			$x = 50;
		}`,
		messages: [
			{
				app: 'state',
				state: `{
					var['d'] = $x;
				}`
			}
		]
	}];
	var remote_intermediary_aa_address = objectHash.getChash160(remote_intermediary_aa);
	
	var aa = ['autonomous agent', {
		init: `{
			$a = 30;
			$f = 6;
			$h = 7;
			$g = ($x) => {$x^2};
			$remote_aa = '${remote_intermediary_aa_address}';
			$ret = $remote_aa.$g(trigger.data.x);
		}`,
		messages: [
			{
				app: 'state',
				state: `{
					var['origin_sq'] = $ret.origin.sq;
					var['origin_this'] = $ret.origin.this;
					var['origin_bal'] = $ret.origin.bal;
					var['origin_ss'] = $ret.origin.ss;
					var['origin_ts'] = $ret.origin.ts;
					var['origin_mci'] = $ret.origin.mci;
					var['origin_a'] = $ret.origin.a;
					var['origin_origin_aa'] = $ret.origin.origin_aa;
					var['this'] = $ret.this;
					var['bal'] = $ret.bal;
					var['ss'] = $ret.ss;
					var['ts'] = $ret.ts;
					var['mci'] = $ret.mci;
					var['h'] = $ret.h;
					var['mul'] = $remote_aa.$h(2.5); // string or number?
				}`
			}
		]
	}];
	var aa_address = objectHash.getChash160(aa);

	validateAA(remote_aa, async err => {
		t.deepEqual(err, null);
		await asyncAddAA(remote_aa);

		validateAA(remote_intermediary_aa, async err => {
			t.deepEqual(err, null);
			await asyncAddAA(remote_intermediary_aa);

			await db.query("UPDATE aa_addresses SET storage_size=100 WHERE address=?", [remote_aa_address]);
			await db.query("UPDATE aa_addresses SET storage_size=200 WHERE address=?", [remote_intermediary_aa_address]);
			var objLastStableMcUnitProps = await storage.readLastStableMcUnitProps(db);
			var ts = objLastStableMcUnitProps.timestamp;
			var mci = objLastStableMcUnitProps.main_chain_index;

			validateAA(aa, async err => {
				t.deepEqual(err, null);
				await asyncAddAA(aa);
				
				aa_composer.dryRunPrimaryAATrigger(trigger, aa_address, aa, (arrResponses) => {
					t.deepEqual(arrResponses.length, 1);
					t.deepEqual(arrResponses[0].bounced, false);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].origin_sq.value, 25);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].origin_this.value, remote_aa_address);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].origin_bal.value, 0);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].origin_ss.value, 100);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].origin_ts.value, ts);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].origin_mci.value, mci);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].origin_a.value, 10);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].origin_origin_aa.value, remote_aa_address);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].this.value, remote_intermediary_aa_address);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].bal.value, 0);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].ss.value, 200);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].ts.value, ts);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].mci.value, mci);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].h.value, 15);
					t.deepEqual(arrResponses[0].updatedStateVars[aa_address].mul.value, 7.5);
					fixCache();
					t.deepEqual(storage.assocUnstableUnits, old_cache.assocUnstableUnits);
					t.deepEqual(storage.assocStableUnits, old_cache.assocStableUnits);
					t.deepEqual(storage.assocUnstableMessages, old_cache.assocUnstableMessages);
					t.deepEqual(storage.assocBestChildren, old_cache.assocBestChildren);
					t.deepEqual(storage.assocStableUnitsByMci, old_cache.assocStableUnitsByMci);
					t.end();
				});
			});
		});
	});
});
