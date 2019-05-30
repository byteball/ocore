var path = require('path');
var crypto = require('crypto');
var Mnemonic = require('bitcore-mnemonic');
var objectHash = require("../object_hash.js");
var ecdsaSig = require('../signature.js');
var desktop_app = require('../desktop_app.js');
desktop_app.getAppDataDir = function() { return __dirname + '/.testdata-' + path.basename(__filename); }

var Decimal = require('decimal.js');
var formulaParser = require('../formula/index');
var kvstore = require('../kvstore.js');
var aa_validation = require('../aa_validation.js');
var aa_composer = require('../aa_composer.js');
var writer = require('../writer.js');
var validation = require('../validation.js');
var mutex = require('../mutex.js');
var test = require('ava');
require('./_init_datafeeds.js');

writer.saveJoint = function (objJoint, objValidationState, preCommitCallback, onDone) {
	console.log("mock saving unit", JSON.stringify(objJoint, null, '\t'));
	onDone();
}

validation.validate = function (objJoint, callbacks, external_conn) {
	mutex.lock(['val'], function (unlock) {
		var objAAValidationState = { sequence: 'good' };
		callbacks.ifOk(objAAValidationState, unlock);
	});
}

test('simple AA', t => {
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
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, null);
	});
});

test('AA with cases', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		init: "{$a=77;}",
		messages: {
			cases: [
				{
					if: "{trigger.data.x}",
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
				},
				{
					if: "{trigger.data.y}",
					init: "{$c = trigger.data.y;}",
					messages: [
						{
							app: 'payment',
							payload: {
								asset: 'base',
								outputs: [
									{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - 500 - $c}"}
								]
							}
						}
					]
				},
			]
		}
	}];
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, null);
	});
});

test('AA with bad cases', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: {
			cases: [
				{
				//	no if in 1st case
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
				},
				{
					if: "{trigger.data.y}",
					init: "{$c = trigger.data.y;}",
					messages: [
						{
							app: 'payment',
							payload: {
								asset: 'base',
								outputs: [
									{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - 500 - $c}"}
								]
							}
						}
					]
				},
			]
		}
	}];
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, 'if required in all but the last cases');
	});
});

test.cb('complex AA', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 20000 },
		init: "{$b=77;}",
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] * 2 - 500}"}
					]
				}
			},
			{
				app: 'payment',
				payload: {
					asset: 'W/6iS75IT8mKJzKyyjz5dKCp9Ux6F7+AUUNq8VLiZ6o=',
					outputs: [
						{address: "{trigger.address}", amount: "{trigger.output[[asset!=base]] * 0.02 - 500}"}
					]
				}
			},
			{
				app: 'data',
				payload: {
					if: "{trigger.data.post}",
					temp: 25.3,
					velocity: {
						ground: 3.3,
						tenmetersaboveground: "{trigger.data.x+1}",
						names: ["{'John'||trigger.data.name}", "George"],
						"{'init'}": "{trigger.data.name+trigger.output[[asset=base]]}",
						init: "{$x=22+trigger.data.x;}",
						if: "{trigger.data.velocity}"
					}
				}
			},
			{
				app: 'data_feed',
				payload: {
					if: "{trigger.data.post}",
					"{trigger.data.y}": "{trigger.address||'_aa'}",
					bbb: 234
				}
			},
			{
				app: 'profile',
				payload: {
					if: "{trigger.data.post}",
					"{trigger.data.y}": {ddd: ["{trigger.address||'_aa'}"]},
					bbb: 234,
					ccc: {
						cases: [
							{ if: "{$a}", ccc: { fff: "vvvv" } },
							{
								if: "{trigger.data.b}", ccc: { 
									cases: [
										{ if: "{$d}", ccc: "gggg" },
										{ if: "{$e}", ccc: ["gggg", "vvvv"] },
									]
								}
							},
							{ ccc: { fff: "xxx" } },
						]
					}
				}
			},
			{
				app: 'attestation',
				payload: {
					address: "{trigger.address}",
					profile: {
						if: "{trigger.data.post}",
						"{trigger.data.y}": {ddd: ["{trigger.address||'_aa'}"]},
						bbb: 234
					}
				}
			},
			{
				app: 'asset',
				payload: {
					cap: "{trigger.output[[asset=base]]}",
					is_transferrable: true,
					is_private: false,
					auto_destroy: "{trigger.data.auto_destroy}",
					fixed_denominations: false,
					issued_by_definer_only: true,
					cosigned_by_definer: false,
					spender_attested: false,
				}
			},
			{
				app: 'asset_attestors',
				payload: {
					asset: "{trigger.output[[asset!=base]].asset}",
					attestors: [
						"{trigger.data.attestor1}",
						"{trigger.data.attestor2 ? trigger.data.attestor2 : ''}",
					]
				}
			},
			{
				app: 'text',
				payload: "{'received '||trigger.data.text||' from '+trigger.address}"
			},
			{
				app: 'definition',
				payload: {definition: ['autonomous agent', {
					bounce_fees: { base: 12000, 'W/6iS75IT8mKJzKyyjz5dKCp9Ux6F7+AUUNq8VLiZ6o=': 1 },
					messages: [{app: 'payment', payload: {asset: 'base', outputs: [{address: "{trigger.address}", amount: 33}]}}]
				}]}
			},
			{
				app: 'poll',
				payload: {
					question: "{trigger.data.question}",
					choices: [
						"{trigger.data.choice1}",
						"{trigger.data.choice2 ? trigger.data.choice2 : ''}",
					]
				}
			},
			{
				app: 'vote',
				payload: {
					init: "{$v=trigger.data.v;}",
					unit: "{trigger.data.unit}",
					choice: "{trigger.data.choice}"
				}
			},
			{
				app: 'definition_template',
				payload: ['and', [
					['sig', { pubkey: "{trigger.data.pubkey}" }],
					['in data feed', ["{trigger.data.oracle}"], "{trigger.data.feed_name}", "=", "@feed_value"]
				]]
			},
			{
				app: 'state',
				state: "{$v=99; var[trigger.data.address||'_count'] = var[trigger.data.address||'_count'] + 1;}"
			},
		]
	}];
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, null);
		t.end();
	});
});

test('state only and no bounce fees', t => {
	var aa = ['autonomous agent', {
	//	bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'state',
				state: "{$v=99; var[trigger.data.address||'_count'] = var[trigger.data.address||'_count'] + 1;}"
			},
		]
	}];
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, null);
	});
});


test('bad formula', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{trigger.address[]}", amount: "{trigger.output[[asset=base]] - 500}"}
					]
				}
			}
		]
	}];
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, 'validation of furmula trigger.address[] failed: parse error');
	});
});

test('bad formula with asset', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: {
			cases: [
				{
					if: "{trigger.data.issue}",
					messages: [
						{
							app: 'asset',
							payload: {
								cap: '{trigger.data.cap}',
								is_transferrable: true,
								is_private: false,
								auto_destroy: "{trigger.data.auto_destroy[]}",
								fixed_denominations: false,
								issued_by_definer_only: true,
								cosigned_by_definer: false,
								spender_attested: false,
							}
						}
					]
				}
			]
		}
	}];
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, 'validation of furmula trigger.data.auto_destroy[] failed: parse error');
	});
});

test('state not on last position', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'state',
				state: "{$v=99; var[trigger.data.address||'_count'] = var[trigger.data.address||'_count'] + 1;}"
			},
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
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, 'state message must be last');
	});
});

test('low bounce fees', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 100 },
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
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, 'too small base bounce fee: 100');
	});
});

test('extraneous fields', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		ggg: "mmm",
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
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, 'foreign fields in AA definition');
	});
});

test('no messages', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
	}];
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, 'bad messages in AA');
	});
});

test('no amount', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{trigger.address}", }
					]
				}
			}
		]
	}];
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, 'bad amount: undefined');
	});
});

test('negative amount', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{trigger.address}", amount: -1}
					]
				}
			}
		]
	}];
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, 'bad amount number: -1');
	});
});

test('bad address', t => {
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "xxx", amount: 1}
					]
				}
			}
		]
	}];
	aa_validation.validateAADefinition(aa, err => {
		t.deepEqual(err, 'bad address: xxx');
	});
});


/////////////////////////////
// composing

test.cb.serial('compose simple AA', t => {
	var db = require("../db");
	var batch = kvstore.batch();
	var stateVars = {};
	var objMcUnit = {
		unit: 'DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=',
		last_ball_unit: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		last_ball: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		witness_list_unit: 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',
	};
	var trigger = { address: 'TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W', outputs: { base: 40000 }, data: { x: 333 }, unit: objMcUnit.unit };
	var arrResponseUnits = [];
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - 2000}"}
					]
				}
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	db.query("INSERT "+db.getIgnore()+" INTO aa_addresses (address, definition, unit, mci) VALUES(?, ?, ?, ?)", [address, JSON.stringify(aa), objMcUnit.last_ball_unit, 500]);
	db.query("INSERT " + db.getIgnore() + " INTO outputs (unit, message_index, output_index, address, amount) VALUES(?, 0, 0, ?, ?)", [objMcUnit.unit, address, trigger.outputs.base]);
	db.query("DELETE FROM aa_responses WHERE trigger_unit=? AND aa_address=?", [trigger.unit, address]);

	var objUnit;
	writer.saveJoint = function (objJoint, objValidationState, preCommitCallback, onDone) {
		console.log("mock saving unit", JSON.stringify(objJoint, null, '\t'));
		objUnit = objJoint.unit;
		onDone();
	}
	
	aa_composer.handleTrigger(db, batch, trigger, stateVars, aa, address, 600, objMcUnit, false, arrResponseUnits, (bPosted, bBounced) => {
		t.deepEqual(!!bPosted, true);
		t.deepEqual(bBounced, false);
		t.deepEqual(objUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger.address); }).amount, 38000);
		t.end();
	});
});

test.cb.serial('compose complex AA', t => {
	var db = require("../db");
	var batch = kvstore.batch();
	var stateVars = {};
	var objMcUnit = {
		unit: 'DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=',
		last_ball_unit: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		last_ball: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		witness_list_unit: 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',
	};
	var trigger = { address: 'TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W', outputs: { base: 40000 }, data: { x: 333 }, unit: objMcUnit.unit };
	var arrResponseUnits = [];
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		init: "{ $a = trigger.data.x - 33;\n $b = trigger.output[[asset=base]]; }", // a=300, b=40000
		messages: {
			cases: [
				{
					if: "{trigger.data.y}",
					messages: [
						{
							app: 'payment',
							payload: {
								asset: 'base',
								outputs: [
									{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - 2000}"}
								]
							}
						}
					]
				},
				{
					if: "{trigger.data.x}",
					messages: [
						{
							app: 'payment',
							init: "{ $c = $b + $a; }", // c=40300
							payload: {
								asset: 'base',
								init: "{ $d = round($c/2); }", // d=20150
								outputs: [
									{address: "{trigger.address}", amount: "{$d - 2000}"} // 18150
								]
							}
						},
						{
							app: 'data',
							init: "{$c=2*$b;}", // c=80000
							payload: {
								"{'val_'||$a}": "{$c}",
								sss: 22,
								zzz: "{($a == 300) ? '' : $a}"
							}
						},
						{
							app: 'state',
							state: "{ $c=3*$a; var['z'] = $c/200; }" // c=900, var[z] = 4.5
						}
					]
				},
			]
		}
	}];
	var address = objectHash.getChash160(aa);
	db.query("INSERT "+db.getIgnore()+" INTO aa_addresses (address, definition, unit, mci) VALUES(?, ?, ?, ?)", [address, JSON.stringify(aa), objMcUnit.last_ball_unit, 500]);
	db.query("INSERT " + db.getIgnore() + " INTO outputs (unit, message_index, output_index, address, amount) VALUES(?, 0, 1, ?, ?)", [objMcUnit.unit, address, trigger.outputs.base]);
	db.query("DELETE FROM aa_responses WHERE trigger_unit=? AND aa_address=?", [trigger.unit, address]);

	var objUnit;
	writer.saveJoint = function (objJoint, objValidationState, preCommitCallback, onDone) {
		console.log("mock saving unit", JSON.stringify(objJoint, null, '\t'));
		objUnit = objJoint.unit;
		onDone();
	}
	
	aa_composer.handleTrigger(db, batch, trigger, stateVars, aa, address, 600, objMcUnit, false, arrResponseUnits, (bPosted, bBounced) => {
		t.deepEqual(!!bPosted, true);
		t.deepEqual(bBounced, false);
		t.deepEqual(stateVars[address]['z'].value.toNumber(), 4.5);
		t.deepEqual(objUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger.address); }).amount, 18150);
		t.deepEqual(objUnit.messages.find(function (message) { return (message.app === 'data'); }).payload.zzz, undefined);
		t.deepEqual(objUnit.messages.find(function (message) { return (message.app === 'data'); }).payload.val_300, 80000);
		t.end();
	});
});


test.cb.serial('variable reassignment', t => {
	var db = require("../db");
	var batch = kvstore.batch();
	var stateVars = {};
	var objMcUnit = {
		unit: 'DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=',
		last_ball_unit: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		last_ball: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		witness_list_unit: 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',
	};
	var trigger = { address: 'TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W', outputs: { base: 40000 }, data: { x: 333 }, unit: objMcUnit.unit };
	var arrResponseUnits = [];
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					init: "{$a=9;}",
					outputs: [
						{address: "{trigger.address}", amount: "{$a=10; trigger.output[[asset=base]] - 2000}"}
					]
				}
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	db.query("INSERT "+db.getIgnore()+" INTO aa_addresses (address, definition, unit, mci) VALUES(?, ?, ?, ?)", [address, JSON.stringify(aa), objMcUnit.last_ball_unit, 500]);
	db.query("INSERT " + db.getIgnore() + " INTO outputs (unit, message_index, output_index, address, amount) VALUES(?, 0, 2, ?, ?)", [objMcUnit.unit, address, trigger.outputs.base]);
	db.query("DELETE FROM aa_responses WHERE trigger_unit=? AND aa_address=?", [trigger.unit, address]);

	var objUnit;
	writer.saveJoint = function (objJoint, objValidationState, preCommitCallback, onDone) {
		console.log("mock saving unit", JSON.stringify(objJoint, null, '\t'));
		objUnit = objJoint.unit;
		onDone();
	}
	
	aa_composer.handleTrigger(db, batch, trigger, stateVars, aa, address, 600, objMcUnit, false, arrResponseUnits, (bPosted, bBounced) => {
		t.deepEqual(!!bPosted, true);
		t.deepEqual(bBounced, true);
		t.deepEqual(objUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger.address); }).amount, 30000);
		t.end();
	});
});

test.cb.serial('no messages', t => {
	var db = require("../db");
	var batch = kvstore.batch();
	var stateVars = {};
	var objMcUnit = {
		unit: 'DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=',
		last_ball_unit: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		last_ball: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		witness_list_unit: 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',
	};
	var trigger = { address: 'TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W', outputs: { base: 40000 }, data: { x: 333 }, unit: objMcUnit.unit };
	var arrResponseUnits = [];
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				if: "{trigger.data.nonexistent}",
				payload: {
					asset: 'base',
					init: "{$a=9;}",
					outputs: [
						{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - 2000}"}
					]
				}
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	db.query("INSERT "+db.getIgnore()+" INTO aa_addresses (address, definition, unit, mci) VALUES(?, ?, ?, ?)", [address, JSON.stringify(aa), objMcUnit.last_ball_unit, 500]);
	db.query("INSERT " + db.getIgnore() + " INTO outputs (unit, message_index, output_index, address, amount) VALUES(?, 0, 3, ?, ?)", [objMcUnit.unit, address, trigger.outputs.base]);
	db.query("DELETE FROM aa_responses WHERE trigger_unit=? AND aa_address=?", [trigger.unit, address]);

	var objUnit;
	writer.saveJoint = function (objJoint, objValidationState, preCommitCallback, onDone) {
		console.log("mock saving unit", JSON.stringify(objJoint, null, '\t'));
		objUnit = objJoint.unit;
		onDone();
	}
	
	aa_composer.handleTrigger(db, batch, trigger, stateVars, aa, address, 600, objMcUnit, false, arrResponseUnits, (response_unit, bBounced) => {
		t.deepEqual(response_unit, null);
		t.deepEqual(bBounced, false);
		t.deepEqual(objUnit, undefined);
		t.end();
	});
});


test.cb.serial('no outputs', t => {
	var db = require("../db");
	var batch = kvstore.batch();
	var stateVars = {};
	var objMcUnit = {
		unit: 'DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=',
		last_ball_unit: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		last_ball: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		witness_list_unit: 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',
	};
	var trigger = { address: 'TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W', outputs: { base: 40000 }, data: { x: 333 }, unit: objMcUnit.unit };
	var arrResponseUnits = [];
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{if: "{trigger.data.nonexistent}", address: "{trigger.address}", amount: "{trigger.output[[asset=base]] - 2000}"}
					]
				}
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	db.query("INSERT "+db.getIgnore()+" INTO aa_addresses (address, definition, unit, mci) VALUES(?, ?, ?, ?)", [address, JSON.stringify(aa), objMcUnit.last_ball_unit, 500]);
	db.query("INSERT " + db.getIgnore() + " INTO outputs (unit, message_index, output_index, address, amount) VALUES(?, 0, 3, ?, ?)", [objMcUnit.unit, address, trigger.outputs.base]);
	db.query("DELETE FROM aa_responses WHERE trigger_unit=? AND aa_address=?", [trigger.unit, address]);

	var objUnit;
	writer.saveJoint = function (objJoint, objValidationState, preCommitCallback, onDone) {
		console.log("mock saving unit", JSON.stringify(objJoint, null, '\t'));
		objUnit = objJoint.unit;
		onDone();
	}
	
	aa_composer.handleTrigger(db, batch, trigger, stateVars, aa, address, 600, objMcUnit, false, arrResponseUnits, (response_unit, bBounced) => {
		t.deepEqual(response_unit, null);
		t.deepEqual(bBounced, false);
		t.deepEqual(objUnit, undefined);
		t.end();
	});
});


test.cb.serial('only 0 output', t => {
	var db = require("../db");
	var batch = kvstore.batch();
	var stateVars = {};
	var objMcUnit = {
		unit: 'DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=',
		last_ball_unit: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		last_ball: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		witness_list_unit: 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',
	};
	var trigger = { address: 'TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W', outputs: { base: 40000 }, data: { x: 333 }, unit: objMcUnit.unit};
	var arrResponseUnits = [];
	var aa = ['autonomous agent', {
		bounce_fees: { base: 10000 },
		messages: [
			{
				app: 'payment',
				payload: {
					asset: 'base',
					outputs: [
						{address: "{trigger.address}", amount: "{trigger.output[[asset=base]] * 0}"}
					]
				}
			}
		]
	}];
	var address = objectHash.getChash160(aa);
	db.query("INSERT "+db.getIgnore()+" INTO aa_addresses (address, definition, unit, mci) VALUES(?, ?, ?, ?)", [address, JSON.stringify(aa), objMcUnit.last_ball_unit, 500]);
	db.query("INSERT " + db.getIgnore() + " INTO outputs (unit, message_index, output_index, address, amount) VALUES(?, 0, 3, ?, ?)", [objMcUnit.unit, address, trigger.outputs.base]);
	db.query("DELETE FROM aa_responses WHERE trigger_unit=? AND aa_address=?", [trigger.unit, address]);

	var objUnit;
	writer.saveJoint = function (objJoint, objValidationState, preCommitCallback, onDone) {
		console.log("mock saving unit", JSON.stringify(objJoint, null, '\t'));
		objUnit = objJoint.unit;
		onDone();
	}
	
	aa_composer.handleTrigger(db, batch, trigger, stateVars, aa, address, 600, objMcUnit, false, arrResponseUnits, (response_unit, bBounced) => {
		t.deepEqual(response_unit, null);
		t.deepEqual(bBounced, false);
		t.deepEqual(objUnit, undefined);
		t.end();
	});
});


test.cb.serial('AA with response vars', t => {
	var db = require("../db");
	var batch = kvstore.batch();
	var stateVars = {};
	var objMcUnit = {
		unit: 'DTDDiGV4wBlVUdEpwwQMxZK2ZsHQGBQ6x4vM463/uy8=',
		last_ball_unit: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		last_ball: 'oXGOcA9TQx8Tl5Syjp1d5+mB4xicsRk3kbcE82YQAS0=',
		witness_list_unit: 'oj8yEksX9Ubq7lLc+p6F2uyHUuynugeVq4+ikT67X6E=',
	};
	var trigger = { address: 'TU3Q44S6H2WXTGQO6BZAGWFKKJCF7Q3W', outputs: { base: 40000 }, data: { x: 333 }, unit: objMcUnit.unit };
	var arrResponseUnits = [];
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
	db.query("INSERT "+db.getIgnore()+" INTO aa_addresses (address, definition, unit, mci) VALUES(?, ?, ?, ?)", [address, JSON.stringify(aa), objMcUnit.last_ball_unit, 500]);
	db.query("INSERT " + db.getIgnore() + " INTO outputs (unit, message_index, output_index, address, amount) VALUES(?, 0, 4, ?, ?)", [objMcUnit.unit, address, trigger.outputs.base]);
	db.query("DELETE FROM aa_responses WHERE trigger_unit=? AND aa_address=?", [trigger.unit, address]);

	var objUnit;
	writer.saveJoint = function (objJoint, objValidationState, preCommitCallback, onDone) {
		console.log("mock saving unit", JSON.stringify(objJoint, null, '\t'));
		objUnit = objJoint.unit;
		onDone();
	}
	
	aa_composer.handleTrigger(db, batch, trigger, stateVars, aa, address, 600, objMcUnit, false, arrResponseUnits, (bPosted, bBounced) => {
		t.deepEqual(!!bPosted, true);
		t.deepEqual(bBounced, false);
		t.deepEqual(objUnit.messages.find(function (message) { return (message.app === 'payment'); }).payload.outputs.find(function (output) { return (output.address === trigger.address); }).amount, 38000);
		t.end();
	});
});