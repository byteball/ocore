/*jslint node: true */
"use strict";
var Decimal = require('decimal.js');
var _ = require('lodash');
var async = require('async');
var constants = require('./constants.js');
var storage = require('./storage.js');
var db = require('./db.js');
var ValidationUtils = require("./validation_utils.js");
var objectLength = require("./object_length.js");
var objectHash = require("./object_hash.js");
var aa_validation = require("./aa_validation.js");
var validation = require("./validation.js");
var formulaParser = require('./formula/index');
var kvstore = require('./kvstore.js');
var eventBus = require('./event_bus.js');
var mutex = require('./mutex.js');
var writer = require('./writer.js');
var conf = require('./conf.js');

var isNonnegativeInteger = ValidationUtils.isNonnegativeInteger;
var isNonemptyArray = ValidationUtils.isNonemptyArray;
var isNonemptyObject = ValidationUtils.isNonemptyObject;

var TRANSFER_INPUT_SIZE = 0 // type: "transfer" omitted
	+ 44 // unit
	+ 8 // message_index
	+ 8; // output_index

var OUTPUT_SIZE = 32 + 8; // address + amount

eventBus.on('new_aa_triggers', function () {
	mutex.lock(["write"], function (unlock) {
		unlock(); // we don't need to block writes, we requested the lock just to wait that the current write completes
		handleAATriggers();
	});
});

function handleAATriggers() {
	mutex.lock(['aa_triggers'], function (unlock) {
		db.query(
			"SELECT aa_triggers.mci, aa_triggers.unit, address, definition \n\
			FROM aa_triggers \n\
			CROSS JOIN units USING(unit) \n\
			CROSS JOIN aa_addresses USING(address) \n\
			ORDER BY aa_triggers.mci, level, aa_triggers.unit, address",
			function (rows) {
				var arrPostedUnits = [];
				async.eachSeries(
					rows,
					function (row, cb) {
						var arrDefinition = JSON.parse(row.definition);
						handlePrimaryAATrigger(row.mci, row.unit, row.address, arrDefinition, arrPostedUnits, cb);
					},
					function () {
						arrPostedUnits.forEach(function (objUnit) {
							eventBus.emit('new_aa_unit', objUnit);
						});
						unlock();
					}
				);
			}
		);
	});
}

function handlePrimaryAATrigger(mci, unit, address, arrDefinition, arrPostedUnits, onDone) {
	db.takeConnectionFromPool(function (conn) {
		conn.query("BEGIN", function () {
			var batch = kvstore.batch();
			readMcUnit(conn, mci, function (objMcUnit) {
				readUnit(conn, unit, function (objUnit) {
					var arrResponses = [];
					var trigger = getTrigger(objUnit, address);
					trigger.initial_address = trigger.address;
					handleTrigger(conn, batch, null, trigger, {}, arrDefinition, address, mci, objMcUnit, false, arrResponses, function(){
						conn.query("DELETE FROM aa_triggers WHERE mci=? AND unit=? AND address=?", [mci, unit, address], function(){
							var batch_start_time = Date.now();
							batch.write(function(err){
								console.log("AA batch write took "+(Date.now()-batch_start_time)+'ms');
								if (err)
									throw Error("AA composer: batch write failed: "+err);
								conn.query("COMMIT", function () {
									conn.release();
									arrResponses.forEach(function (objAAResponse) {
										if (objAAResponse.objResponseUnit)
											arrPostedUnits.push(objAAResponse.objResponseUnit);
										eventBus.emit('aa_response', objAAResponse);
										eventBus.emit('aa_response_to_unit-'+objAAResponse.trigger_unit, objAAResponse);
										eventBus.emit('aa_response_to_address-'+objAAResponse.trigger_address, objAAResponse);
										eventBus.emit('aa_response_from_aa-'+objAAResponse.aa_address, objAAResponse);
									});
									onDone();
								});
							});
						});
					});
				});
			});
		});
	});
}

var lightBatch = {
	put: function () { },
	del: function () { },
	clear: function () { },
	write: function () {
		throw Error("attempting to write a batch in a light client");
	}
};

function dryRunPrimaryAATrigger(trigger, address, arrDefinition, onDone) {
	db.takeConnectionFromPool(function (conn) {
		conn.query("BEGIN", function () {
			var batch = conf.bLight ? lightBatch : kvstore.batch();
			readLastStableMcUnit(conn, function (mci, objMcUnit) {
				trigger.unit = objMcUnit.unit;
				if (!trigger.address)
					trigger.address = objMcUnit.authors[0].address;
				trigger.initial_address = trigger.address;
				var fPrepare = function (cb) {
					insertFakeOutputsIntoMcUnit(conn, objMcUnit, trigger.outputs, address, cb);
				};
				fPrepare(function () {
					var arrResponses = [];
					handleTrigger(conn, batch, fPrepare, trigger, {}, arrDefinition, address, mci, objMcUnit, false, arrResponses, function () {
						revertResponsesInCaches(arrResponses);
						batch.clear();
						conn.query("ROLLBACK", function () {
							conn.release();
							onDone(arrResponses);
						});
					});
				});
			});
		});
	});
}

function readLastStableMcUnit(conn, handleMciAndUnit) {
	conn.query(
		"SELECT unit, main_chain_index FROM units WHERE +is_on_main_chain=1 AND +is_stable=1 \n\
		ORDER BY main_chain_index DESC LIMIT 1",
		function (rows) {
			if (rows.length !== 1)
				throw Error("found " + rows.length + " last stable MC units");
			var row = rows[0];
			readUnit(conn, row.unit, function (objUnit) {
				handleMciAndUnit(row.main_chain_index, objUnit);
			});
		}
	);
}

function insertFakeOutputsIntoMcUnit(conn, objMcUnit, outputs, address, onDone) {
	// this ensures we have the funds on AA address in case the response unit tries to send the received funds somewhere else
	console.log('inserting fake outputs into unit ' + objMcUnit.unit);
	var arrQueries = [];
	var message_index = objMcUnit.messages.length;
	for (var asset in outputs) {
		conn.addQuery(arrQueries,
			"INSERT INTO outputs (unit, message_index, output_index, asset, address, amount) VALUES(?, ?,0, ?, ?, ?)",
			[objMcUnit.unit, message_index, asset === 'base' ? null : asset, address, outputs[asset]]);
		message_index++;
	}
	async.series(arrQueries, onDone);
}

function readMcUnit(conn, mci, handleUnit) {
	conn.query("SELECT unit FROM units WHERE main_chain_index=? AND is_on_main_chain=1", [mci], function (rows) {
		if (rows.length !== 1)
			throw Error("found " + rows.length + " MC units on MCI " + mci);
		readUnit(conn, rows[0].unit, handleUnit);
	});
}

function readUnit(conn, unit, handleUnit) {
	storage.readJoint(conn, unit, {
		ifNotFound: function () {
			throw Error("unit not found: " + unit);
		},
		ifFound: function (objJoint) {
			handleUnit(objJoint.unit);
		}
	});
}

function getTrigger(objUnit, receiving_address) {
	var trigger = { address: objUnit.authors[0].address, unit: objUnit.unit, outputs: {} };
	objUnit.messages.forEach(function (message) {
		if (message.app === 'data' && !trigger.data) // use the first data mesage, ignore the subsequent ones
			trigger.data = message.payload;
		else if (message.app === 'payment') {
			var payload = message.payload;
			var asset = payload.asset || 'base';
			payload.outputs.forEach(function (output) {
				if (output.address === receiving_address) {
					if (!trigger.outputs[asset])
						trigger.outputs[asset] = 0;
					trigger.outputs[asset] += output.amount; // in case there are several outputs
				}
			});
		}
	});
	if (Object.keys(trigger.outputs).length === 0)
		throw Error("no outputs to " + receiving_address);
	return trigger;
}

// the result is onDone(objResponseUnit, bBounced)
function handleTrigger(conn, batch, fPrepare, trigger, stateVars, arrDefinition, address, mci, objMcUnit, bSecondary, arrResponses, onDone) {
	if (arrDefinition[0] !== 'autonomous agent')
		throw Error('bad AA definition ' + arrDefinition);
	if (!trigger.initial_address)
		trigger.initial_address = trigger.address;
	var error_message = '';
	var responseVars = {};
	var template = arrDefinition[1];
	var bounce_fees = template.bounce_fees || {base: constants.MIN_BYTES_BOUNCE_FEE};
	if (!bounce_fees.base)
		bounce_fees.base = constants.MIN_BYTES_BOUNCE_FEE;
//	console.log('===== trigger.outputs', trigger.outputs);
	var objValidationState = {
		last_ball_mci: mci,
		last_ball_timestamp: objMcUnit.timestamp,
		mc_unit: objMcUnit.unit,
		assocBalances: {},
		number_of_responses: arrResponses.length,
		arrPreviousResponseUnits: arrResponses.map(objAAResponse => objAAResponse.objResponseUnit)
	};
	var byte_balance;
	var storage_size;
	var objStateUpdate;
	var count = 0;
	if (bSecondary)
		updateOriginalOldValues();

	// add the coins received in the trigger
	function updateInitialAABalances(cb) {
		objValidationState.assocBalances[address] = {};
		var arrAssets = Object.keys(trigger.outputs);
		conn.query(
			"SELECT asset, balance FROM aa_balances WHERE address=? AND asset IN(" + arrAssets.map(conn.escape).join(',') + ")",
			[address],
			function (rows) {
				var arrQueries = [];
				// 1. update balances of existing assets
				rows.forEach(function (row) {
					conn.addQuery(
						arrQueries,
						"UPDATE aa_balances SET balance=balance+? WHERE address=? AND asset=? ",
						[trigger.outputs[row.asset], address, row.asset]
					);
					objValidationState.assocBalances[address][row.asset] = row.balance + trigger.outputs[row.asset];
				});
				// 2. insert balances of new assets
				var arrExistingAssets = rows.map(function (row) { return row.asset; });
				var arrNewAssets = _.difference(arrAssets, arrExistingAssets);
				if (arrNewAssets.length > 0) {
					var arrValues = arrNewAssets.map(function (asset) {
						objValidationState.assocBalances[address][asset] = trigger.outputs[asset];
						return "(" + conn.escape(address) + ", " + conn.escape(asset) + ", " + trigger.outputs[asset] + ")"
					});
					conn.addQuery(arrQueries, "INSERT INTO aa_balances (address, asset, balance) VALUES "+arrValues.join(', '));
				}
				byte_balance = objValidationState.assocBalances[address].base;
				if (!bSecondary)
					conn.addQuery(arrQueries, "SAVEPOINT initial_balances");
				async.series(arrQueries, function () {
					conn.query("SELECT storage_size FROM aa_addresses WHERE address=?", [address], function (rows) {
						if (rows.length === 0)
							throw Error("AA not found? " + address);
						storage_size = rows[0].storage_size;
						objValidationState.storage_size = storage_size;
						cb();
					});
				});
			}
		);
	}

	function updateFinalAABalances(arrConsumedOutputs, objUnit, cb) {
		var assocDeltas = {};
		arrConsumedOutputs.forEach(function (output) {
			if (!assocDeltas[output.asset])
				assocDeltas[output.asset] = 0;
			assocDeltas[output.asset] -= output.amount;
		});
		var arrNewAssets = [];
		objUnit.messages.forEach(function (message) {
			if (message.app !== 'payment')
				return;
			var payload = message.payload;
			var asset = payload.asset || 'base';
			payload.outputs.forEach(function (output) {
				if (output.address !== address)
					return;
				if (!assocDeltas[asset]) { // it can happen if the asset was issued by AA
					assocDeltas[asset] = 0;
					arrNewAssets.push(asset);
				}
				assocDeltas[asset] += output.amount;
			});
		});
		var arrQueries = [];
		if (arrNewAssets.length > 0) {
			var arrValues = arrNewAssets.map(function (asset) { return "(" + conn.escape(address) + ", " + conn.escape(asset) + ", 0)"; });
			conn.addQuery(arrQueries, "INSERT "+conn.getIgnore()+" INTO aa_balances (address, asset, balance) VALUES "+arrValues.join(', '));
		}
		for (var asset in assocDeltas) {
			if (assocDeltas[asset])
				conn.addQuery(arrQueries, "UPDATE aa_balances SET balance=balance+? WHERE address=? AND asset=?", [assocDeltas[asset], address, asset]);
		}
		if (assocDeltas.base)
			byte_balance += assocDeltas.base;
		async.series(arrQueries, cb);
	}
	
	// note that app=definition is also replaced using the current trigger and vars, its code has to generate "{}"-formulas in order to be dynamic
	function replace(obj, name, path, locals, cb) {
		count++;
		if (count % 100 === 0) // interrupt the call stack
			return setImmediate(replace, obj, name, path, locals, cb);
		locals = _.clone(locals);
		var value = obj[name];
		if (typeof name === 'string') {
			var f = aa_validation.getFormula(name);
			if (f !== null) {
				var opts = {
					conn: conn,
					formula: f,
					trigger: trigger,
					locals: _.clone(locals),
					stateVars: stateVars,
					responseVars: responseVars,
					objValidationState: objValidationState,
					address: address
				};
				return formulaParser.evaluate(opts, function (err, res) {
					if (res === null)
						return cb(err.bounce_message || "formula " + f + " failed: "+err);
					delete obj[name];
					if (res === '')
						return cb(); // the key is just removed from the object
					if (typeof res !== 'string')
						return cb("result of formula " + name + " is not a string: " + res);
					if (res in obj)
						return cb("duplicate key " + res + " calculated from " + name);
					if (aa_validation.getFormula(res) !== null)
						return cb("calculated value of " + name + " looks like a formula again: " + res);
					obj[res] = value;
					replace(obj, res, path, locals, cb);
				});
			}
		}
		if (typeof value === 'number' || typeof value === 'boolean')
			return cb();
		if (typeof value === 'string') {
			var f = aa_validation.getFormula(value);
			if (f === null)
				return cb();
		//	console.log('path', path, 'name', name, 'f', f);
			var bStateUpdates = (path === '/messages/state');
			if (bStateUpdates) {
				if (objStateUpdate)
					return cb("second state update formula: " + f + ", existing: " + objStateUpdate.formula);
				objStateUpdate = {formula: f, locals: locals};
				return cb();
			}
			var opts = {
				conn: conn,
				formula: f,
				trigger: trigger,
				locals: locals,
				stateVars: stateVars,
				responseVars: responseVars,
				objValidationState: objValidationState,
				address: address,
				bObjectResultAllowed: true
			};
			formulaParser.evaluate(opts, function (err, res) {
			//	console.log('--- f', f, '=', res, typeof res);
				if (res === null)
					return cb(err.bounce_message || "formula " + f + " failed: "+err);
				if (res === '') { // signals that the key should be removed (only empty string, cannot be false as it is a valid value for asset properties)
					if (typeof name === 'string')
						delete obj[name];
					else
						obj[name] = null;
				}
				else
					obj[name] = res;
				cb();
			});
		}
		else if (aa_validation.hasCases(value)) {
			var thecase;
			async.eachSeries(
				value.cases,
				function (acase, cb2) {
					if (!("if" in acase)) {
						thecase = acase;
						return cb2('done');
					}
					var f = aa_validation.getFormula(acase.if);
					if (f === null)
						return cb2("case if is not a formula: " + acase.if);
					var locals_tmp = _.clone(locals); // separate copy for each iteration of eachSeries
					var opts = {
						conn: conn,
						formula: f,
						trigger: trigger,
						locals: locals_tmp,
						stateVars: stateVars,
						responseVars: responseVars,
						objValidationState: objValidationState,
						address: address
					};
					formulaParser.evaluate(opts, function (err, res) {
						if (res === null)
							return cb2(err.bounce_message || "formula " + acase.if + " failed: " + err);
						if (res) {
							thecase = acase;
							locals = locals_tmp;
							return cb2('done');
						}
						cb2(); // try next
					});
				},
				function (err) {
					if (!err)
						return cb("neither case is true in " + name);
					if (err !== 'done')
						return cb(err);
					var replacement_value = thecase[name];
					if (!replacement_value)
						throw Error("a case was selected but no replacement value in " + name);
					obj[name] = replacement_value;
					if (!thecase.init)
						return replace(obj, name, path, locals, cb);
					var f = aa_validation.getFormula(thecase.init);
					if (f === null)
						return cb("case init is not a formula: " + thecase.init);
					var opts = {
						conn: conn,
						formula: f,
						trigger: trigger,
						locals: locals,
						stateVars: stateVars,
						responseVars: responseVars,
						bStatementsOnly: true,
						objValidationState: objValidationState,
						address: address
					};
					formulaParser.evaluate(opts, function (err, res) {
						if (res === null)
							return cb(err.bounce_message || "formula " + f + " failed: " + err);
						replace(obj, name, path, locals, cb);
					});
				}
			);
		}
		else if (typeof value === 'object' && (typeof value.if === 'string' || typeof value.init === 'string')) {
			function evaluateIf(cb2) {
				if (typeof value.if !== 'string')
					return cb2();
				var f = aa_validation.getFormula(value.if);
				if (f === null)
					return cb("if is not a formula: " + value.if);
				var opts = {
					conn: conn,
					formula: f,
					trigger: trigger,
					locals: locals,
					stateVars: stateVars,
					responseVars: responseVars,
					objValidationState: objValidationState,
					address: address
				};
				formulaParser.evaluate(opts, function (err, res) {
					if (res === null)
						return cb(err.bounce_message || "formula " + value.if + " failed: " + err);
					if (!res) {
						if (typeof name === 'string')
							delete obj[name];
						else
							obj[name] = null; // will be removed
						return cb();
					}
					delete value.if;
					cb2();
				});
			}
			evaluateIf(function () {
				if (typeof value.init !== 'string')
					return replace(obj, name, path, locals, cb);
				var f = aa_validation.getFormula(value.init);
				if (f === null)
					return cb("init is not a formula: " + value.init);
				var opts = {
					conn: conn,
					formula: f,
					trigger: trigger,
					locals: locals,
					stateVars: stateVars,
					responseVars: responseVars,
					bStatementsOnly: true,
					objValidationState: objValidationState,
					address: address
				};
				formulaParser.evaluate(opts, function (err, res) {
					if (res === null)
						return cb(err.bounce_message || "formula " + value.init + " failed: " + err);
					delete value.init;
					replace(obj, name, path, locals, cb);
				});
			});
		}
		else if (Array.isArray(value)) {
			async.eachOfSeries(
				value,
				function (elem, i, cb2) {
					replace(value, i, path, _.clone(locals), cb2);
				},
				function (err) {
					if (err)
						return cb(err);
					var replacement_value = value.filter(function (elem) { return (elem !== null); });
					if (replacement_value.length === 0) {
						if (typeof name === 'string')
							delete obj[name];
						else
							obj[name] = null; // to be removed
						return cb();
					}
					obj[name] = replacement_value;
					cb();
				}
			);
		}
		else if (isNonemptyObject(value)) {
			async.eachSeries(
				Object.keys(value),
				function (key, cb2) {
					replace(value, key, path + '/' + key, _.clone(locals), cb2);
				},
				function (err) {
					if (err)
						return cb(err);
					if (Object.keys(value) === 0) {
						if (typeof name === 'string')
							delete obj[name];
						else
							obj[name] = null; // to be removed
						return cb();
					}
					cb();
				}
			);
		}
		else
			throw Error('unknown type of value in ' + name);
	}

	function pickParents(handleParents) {
		// first look for a chain of AAs stemming from the MC unit
		conn.query(
			"SELECT units.unit \n\
			FROM units CROSS JOIN unit_authors USING(unit) CROSS JOIN aa_addresses USING(address) \n\
			WHERE latest_included_mc_index=? AND aa_addresses.mci<=? \n\
			ORDER BY level DESC LIMIT 1",
			[mci, mci],
			function (rows) {
				if (rows.length > 0)
					return handleParents([rows[0].unit]);
				// next, check if there is an AA stemming from a recent MCI
				conn.query(
					"SELECT units.unit, latest_included_mc_index \n\
					FROM units CROSS JOIN unit_authors USING(unit) CROSS JOIN aa_addresses USING(address) \n\
					WHERE (main_chain_index>? OR main_chain_index IS NULL) AND aa_addresses.mci<=? \n\
					ORDER BY latest_included_mc_index DESC, level DESC LIMIT 1",
					[mci, mci],
					function (rows) {
						if (rows.length > 0) {
							var row = rows[0];
							if (row.latest_included_mc_index >= mci)
								throw Error("limci of last AA > mci");
							return handleParents([row.unit, objMcUnit.unit].sort());
						}
						handleParents([objMcUnit.unit]);
					}
				);
			}
		);
	}

	var bBouncing = false;
	function bounce(error) {
		console.log('bouncing with error', error, new Error().stack);
		objStateUpdate = null;
		error_message = error_message ? (error_message + ', then ' + error) : error;
		if (bBouncing)
			return finish(null);
		bBouncing = true;
		if (bSecondary)
			return finish(null);
		var messages = [];
		for (var asset in trigger.outputs) {
			var amount = trigger.outputs[asset];
			if (bounce_fees[asset] && bounce_fees[asset] >= amount)
				continue;
			var bounced_amount = amount - (bounce_fees[asset] || 0);
			messages.push({app: 'payment', payload: {asset: asset, outputs: [{address: trigger.address, amount: bounced_amount}]}});
		}
		if (messages.length === 0)
			return finish(null);
		sendUnit(messages);
	}

	function sendUnit(messages) {
		console.log('send unit with messages', JSON.stringify(messages, null, '\t'));
		var arrUsedOutputIds = [];
		var arrConsumedOutputs = [];

		function completeMessage(message) {
			message.payload_location = 'inline';
			message.payload_hash = objectHash.getBase64Hash(message.payload, true);
		}

		function completePaymentPayload(payload, additional_amount, cb) {
			var asset = payload.asset || null;
			var is_base = (asset === null) ? 1 : 0;
			payload.inputs = [];
			var total_amount = 0;

			var send_all_outputs = payload.outputs.filter(function (output) { return (output.amount === undefined); });
			if (send_all_outputs.length > 1)
				return cb(send_all_outputs.length + " send-all outputs");
			var send_all_output = send_all_outputs[0];
			// send-all output looks like {address: "BASE32"}, its size is 32 since it has no amount.
			// remove the send-all output from size calculation, it might be added later
			if (send_all_output && is_base){
				additional_amount -= 32;
				// we add a change output to AA to keep balance above storage_size
				if (storage_size > 60 && mci >= constants.aaStorageSizeUpgradeMci){
					additional_amount += OUTPUT_SIZE;
					payload.outputs.push({ address: address, amount: storage_size });
				}
			}
			var target_amount = payload.outputs.reduce(function (acc, output) { return acc + (output.amount || 0); }, additional_amount);
			var bFound = false;

			function iterateUnspentOutputs(rows) {
				for (var i = 0; i < rows.length; i++){
					var row = rows[i];
					var input = { unit: row.unit, message_index: row.message_index, output_index: row.output_index };
					arrUsedOutputIds.push(row.output_id);
					arrConsumedOutputs.push({asset: asset || 'base', amount: row.amount});
					payload.inputs.push(input);
					total_amount += row.amount;
					if (is_base)
						target_amount += TRANSFER_INPUT_SIZE;
					if (total_amount < target_amount)
						continue;
					if (total_amount === target_amount && payload.outputs.length > 0) {
						bFound = true;
						if (send_all_output)
							continue;
						else
							break;
					}
					var additional_output_size = is_base ? OUTPUT_SIZE : 0; // the same for send-all
					var change_amount = total_amount - (target_amount + additional_output_size);
					if (change_amount > 0) {
						bFound = true;
						if (send_all_output) {
							console.log("change " + change_amount + ", storage_size " + storage_size);
							send_all_output.amount = change_amount;
						}
						else {
							payload.outputs.push({ address: address, amount: change_amount });
							break;
						}
					}
				}
			}

			function readStableOutputs(handleRows) {
			//	console.log('--- readStableOutputs');
				// byte outputs less than 60 bytes (which are net negative) are ignored to prevent dust attack: spamming the AA with very small outputs so that the AA spends all its money for fees when it tries to respond
				conn.query(
					"SELECT unit, message_index, output_index, amount, output_id \n\
					FROM outputs \n\
					CROSS JOIN units USING(unit) \n\
					WHERE address=? AND asset"+(asset ? "="+conn.escape(asset) : " IS NULL AND amount>=60")+" AND is_spent=0 \n\
						AND sequence='good' AND main_chain_index<=? \n\
						AND output_id NOT IN("+(arrUsedOutputIds.length === 0 ? "-1" : arrUsedOutputIds.join(', '))+") \n\
					ORDER BY main_chain_index, unit, output_index", // sort order must be deterministic
					[address, mci], handleRows
				);
			}

			function readUnstableOutputsSentByAAs(handleRows) {
			//	console.log('--- readUnstableOutputsSentByAAs');
				conn.query(
					"SELECT outputs.unit, message_index, output_index, amount, output_id \n\
					FROM units \n\
					CROSS JOIN outputs USING(unit) \n\
					CROSS JOIN unit_authors USING(unit) \n\
					CROSS JOIN aa_addresses ON unit_authors.address=aa_addresses.address \n\
					WHERE outputs.address=? AND asset"+(asset ? "="+conn.escape(asset) : " IS NULL AND amount>=60")+" AND is_spent=0 \n\
						AND sequence='good' AND (main_chain_index>? OR main_chain_index IS NULL) \n\
						AND output_id NOT IN("+(arrUsedOutputIds.length === 0 ? "-1" : arrUsedOutputIds.join(', '))+") \n\
					ORDER BY latest_included_mc_index, level, outputs.unit, output_index", // sort order must be deterministic
					[address, mci], handleRows
				);
			}

			function issueAsset(cb2) {
				var objAsset = assetInfos[asset];
				if (objAsset.issued_by_definer_only && address !== objAsset.definer_address)
					return cb2("not a definer");
				var issue_amount = objAsset.cap || (target_amount - total_amount);

				function addIssueInput(serial_number){
					var input = {
						type: "issue",
						amount: issue_amount,
						serial_number: serial_number
					};
					payload.inputs.unshift(input);
					total_amount += issue_amount;
					var change_amount = total_amount - target_amount;
					if (change_amount > 0)
						payload.outputs.push({ address: address, amount: change_amount });
					cb2();
				}
				
				if (objAsset.cap) {
					conn.query("SELECT 1 FROM inputs WHERE type='issue' AND asset=?", [asset], function(rows){
						if (rows.length > 0) // already issued
							return cb2('already issued');
						addIssueInput(1);
					});
				}
				else{
					conn.query(
						"SELECT MAX(serial_number) AS max_serial_number FROM inputs WHERE type='issue' AND asset=? AND address=?",
						[asset, address],
						function(rows){
							var max_serial_number = (rows.length === 0) ? 0 : rows[0].max_serial_number;
							addIssueInput(max_serial_number+1);
						}
					);
				}
			}

			function sortOutputsAndReturn() {
				if (send_all_output && send_all_output.amount === undefined)
					_.pull(payload.outputs, send_all_output);
				if (payload.outputs.find(output => typeof output.address !== 'string'))
					return cb("some addresses are not strings");
				payload.outputs.sort(sortOutputs);
				cb();
			}

			readStableOutputs(function (rows) {
				iterateUnspentOutputs(rows);
				if (bFound && !send_all_output)
					return sortOutputsAndReturn();
				readUnstableOutputsSentByAAs(function (rows2) {
					iterateUnspentOutputs(rows2);
					if (bFound)
						return sortOutputsAndReturn();
					if (!asset)
						return cb('not enough funds for ' + target_amount + ' bytes');
					issueAsset(function (err) {
						if (err) {
							console.log("issue failed: " + err);
							return cb('not enough funds for ' + target_amount + ' of asset ' + asset);
						}
						sortOutputsAndReturn();
					});
				});
			});
		}

		for (var i = 0; i < messages.length; i++){
			var message = messages[i];
			if (message.app !== 'payment')
				continue;
			var payload = message.payload;
			// negative or fractional
			if (!payload.outputs.every(function (output) { return (isNonnegativeInteger(output.amount) || output.amount === undefined); }))
				return bounce("negative or fractional amounts");
			// filter out 0-outputs
			payload.outputs = payload.outputs.filter(function (output) { return (output.amount > 0 || output.amount === undefined); });
		}
		// remove messages with no outputs
		messages = messages.filter(function (message) { return (message.app !== 'payment' || message.payload.outputs.length > 0); });
		if (messages.length === 0) {
			error_message = 'no messages after removing 0-outputs';
			console.log(error_message);
			return handleSuccessfulEmptyResponseUnit(null);
		}
		var objBasePaymentMessage;
		var arrOutputAddresses = [];
		var assetInfos = {};
		async.eachSeries(
			messages,
			function (message, cb) {
				if (message.app !== 'payment') {
					if (message.app === 'definition')
						message.payload.address = objectHash.getChash160(message.payload.definition);
					completeMessage(message);
					return cb();
				}
				var payload = message.payload;
				payload.outputs.forEach(function (output) {
					if (output.address !== address && arrOutputAddresses.indexOf(output.address) === -1)
						arrOutputAddresses.push(output.address);
				});
				if (payload.asset === 'base')
					delete payload.asset;
				var asset = payload.asset || null;
				if (asset === null) {
					if (objBasePaymentMessage)
						return cb("already have base payment");
					objBasePaymentMessage = message;
					return cb(); // skip it for now, we can estimate the fees only after all other messages are in place
				}
				storage.loadAssetWithListOfAttestedAuthors(conn, asset, mci, [address], function (err, objAsset) {
					if (err)
						return cb(err);
					assetInfos[asset] = objAsset;
					if (objAsset.fixed_denominations) // will skip it later
						return cb();
					completePaymentPayload(payload, 0, function (err) {
						if (err)
							return cb(err);
						completeMessage(message);
						cb();
					});
				});
			},
			function (err) {
				if (err)
					return bounce(err);
				messages = messages.filter(function (message) { return (message.app !== 'payment' || !message.payload.asset || !assetInfos[message.payload.asset].fixed_denominations); });
				if (messages.length === 0) {
					error_message = 'no messages after removing fixed denominations';
					console.log(error_message);
					return handleSuccessfulEmptyResponseUnit(null);
				}
				if (!objBasePaymentMessage) {
					objBasePaymentMessage = { app: 'payment', payload: { outputs: [] } };
					messages.push(objBasePaymentMessage);
				}
				// add payload_location and wrong payload_hash
				objBasePaymentMessage.payload_location = 'inline';
				objBasePaymentMessage.payload_hash = '-'.repeat(44);
				var objUnit = {
					version: constants.version, 
					alt: constants.alt,
					timestamp: objMcUnit.timestamp,
					messages: messages,
					authors: [{ address: address }],
					last_ball_unit: objMcUnit.last_ball_unit,
					last_ball: objMcUnit.last_ball,
					witness_list_unit: objMcUnit.witnesses ? objMcUnit.unit : objMcUnit.witness_list_unit
				};
				pickParents(function (parent_units) {
					objUnit.parent_units = parent_units;
					objUnit.headers_commission = objectLength.getHeadersSize(objUnit);
					objUnit.payload_commission = objectLength.getTotalPayloadSize(objUnit);
					var size = objUnit.headers_commission + objUnit.payload_commission;
					console.log('unit before completing bytes payment', JSON.stringify(objUnit, null, '\t'));
					completePaymentPayload(objBasePaymentMessage.payload, size, function (err) {
					//	console.log('--- completePaymentPayload', err);
						if (err)
							return bounce(err);
						completeMessage(objBasePaymentMessage); // fixes payload_hash
						objUnit.payload_commission = objectLength.getTotalPayloadSize(objUnit);
						objUnit.unit = objectHash.getUnitHash(objUnit);
						executeStateUpdateFormula(objUnit, function (err) {
							if (err)
								return bounce(err);
							validateAndSaveUnit(objUnit, function (err) {
								if (err)
									return bounce(err);
								updateFinalAABalances(arrConsumedOutputs, objUnit, function () {
									if (arrOutputAddresses.length === 0)
										return finish(objUnit);
									fixStateVars();
									addResponse(objUnit, function () {
										updateStorageSize(function (err) {
											if (err)
												return revert(err);
											handleSecondaryTriggers(objUnit, arrOutputAddresses);
										});
									});
								});
							});
						});
					});
				});
			}
		);
	}

	function executeStateUpdateFormula(objResponseUnit, cb) {
		if (!objStateUpdate || bBouncing)
			return cb();
		var opts = {
			conn: conn,
			formula: objStateUpdate.formula,
			trigger: trigger,
			locals: objStateUpdate.locals,
			stateVars: stateVars,
			responseVars: responseVars,
			bStateVarAssignmentAllowed: true,
			bStatementsOnly: true,
			objValidationState: objValidationState,
			address: address,
			objResponseUnit: objResponseUnit
		};
		formulaParser.evaluate(opts, function (err, res) {
		//	console.log('--- state update formula', objStateUpdate.formula, '=', res);
			if (res === null)
				return cb(err.bounce_message || "formula " + objStateUpdate.formula + " failed: "+err);
			cb();
		});
	}

	function fixStateVars() {
		if (bBouncing)
			return;
		for (var address in stateVars) {
			var addressVars = stateVars[address];
			for (var var_name in addressVars) {
				var state = addressVars[var_name];
				if (!state.updated)
					continue;
				if (state.value === true)
					state.value = 1; // affects secondary triggers that execute after ours
			}
		}
	}

	function saveStateVars() {
		if (bSecondary || bBouncing)
			return;
		for (var address in stateVars) {
			var addressVars = stateVars[address];
			for (var var_name in addressVars) {
				var state = addressVars[var_name];
				if (!state.updated)
					continue;
				var key = "st\n" + address + "\n" + var_name;
				if (state.value === false) // false value signals that the var should be deleted
					batch.del(key);
				else
					batch.put(key, state.value.toString()); // Decimal converted to string
			}
		}
	}

	function updateStorageSize(cb) {
		if (bBouncing)
			return cb();
		var delta_storage_size = 0;
		var addressVars = stateVars[address] || {};
		for (var var_name in addressVars) {
			var state = addressVars[var_name];
			if (!state.updated)
				continue;
			if (state.value === false) { // false value signals that the var should be deleted
				if (state.original_old_value !== undefined)
					delta_storage_size -= var_name.length + state.original_old_value.toString().length;
			}
			else {
				if (state.original_old_value !== undefined)
					delta_storage_size += state.value.toString().length - state.original_old_value.toString().length;
				else
					delta_storage_size += var_name.length + state.value.toString().length;
			}
		}
		console.log('storage size = ' + storage_size + ' + ' + delta_storage_size + ', byte_balance = ' + byte_balance);
		var new_storage_size = storage_size + delta_storage_size;
		if (new_storage_size < 0)
			throw Error("storage size would become negative: " + new_storage_size);
		if (byte_balance < new_storage_size && new_storage_size > 60 && mci >= constants.aaStorageSizeUpgradeMci)
			return cb("byte balance " + byte_balance + " would drop below new storage size " + new_storage_size);
		if (delta_storage_size === 0)
			return cb();
		conn.query("UPDATE aa_addresses SET storage_size=? WHERE address=?", [new_storage_size, address], function () {
			cb();
		});
	}

	function updateOriginalOldValues() {
		if (!bSecondary || !stateVars[address])
			return;
		var addressVars = stateVars[address];
		for (var var_name in addressVars) {
			var state = addressVars[var_name];
			if (state.updated)
				state.original_old_value = (state.value === false) ? undefined : state.value;
		}
	}

	function handleSuccessfulEmptyResponseUnit() {
		if (!objStateUpdate)
			return bounce("no state changes");
		executeStateUpdateFormula(null, function (err) {
			if (err) {
				error_message = undefined; // remove error message like 'no messages after filtering'
				return bounce(err);
			}
			finish(null);
		});
	}

	function addResponse(objResponseUnit, cb) {
		var response_unit = objResponseUnit ? objResponseUnit.unit : null;
		var response = {};
		if (!bBouncing && Object.keys(responseVars).length > 0)
			response.responseVars = responseVars;
		if (error_message) {
			if (bBouncing)
				response.error = error_message;
			else
				response.info = error_message;
		}
		var objAAResponse = {
			mci: mci,
			trigger_address: trigger.address,
			trigger_initial_address: trigger.initial_address,
			trigger_unit: trigger.unit,
			aa_address: address,
			bounced: bBouncing,
			response_unit: response_unit,
			objResponseUnit: objResponseUnit,
			response: response,
		};
		arrResponses.push(objAAResponse);
		conn.query(
			"INSERT INTO aa_responses (mci, trigger_address, aa_address, trigger_unit, bounced, response_unit, response) \n\
			VALUES (?, ?,?,?, ?,?,?)",
			[mci, trigger.address, address, trigger.unit, bBouncing ? 1 : 0, response_unit, JSON.stringify(response)],
			function () {
				cb();
			}
		);
	}

	function addUpdatedStateVarsIntoPrimaryResponse() {
		if (bSecondary || bBouncing)
			return;
		var updatedStateVars = {};
		for (var var_address in stateVars) {
			var addressVars = stateVars[var_address];
			for (var var_name in addressVars) {
				var state = addressVars[var_name];
				if (!state.updated)
					continue;
				if (!updatedStateVars[var_address])
					updatedStateVars[var_address] = {};
				var varInfo = {
					value: Decimal.isDecimal(state.value) ? state.value.toNumber() : state.value,
				};
				if (state.old_value !== undefined)
					varInfo.old_value = Decimal.isDecimal(state.old_value) ? state.old_value.toNumber() : state.old_value;
				if (typeof varInfo.value === 'number') {
					if (typeof varInfo.old_value === 'number')
						varInfo.delta = varInfo.value - varInfo.old_value;
				//	else if (varInfo.old_value === undefined || varInfo.old_value === false)
				//		varInfo.delta = varInfo.value;
				}
				updatedStateVars[var_address][var_name] = varInfo;
			}
		}
		arrResponses[0].updatedStateVars = updatedStateVars;
	}

	function finish(objResponseUnit) {
		if (bBouncing && bSecondary) {
			if (objResponseUnit)
				throw Error('response_unit with bouncing a secondary AA');
			return onDone(null, error_message);
		}
		fixStateVars();
		saveStateVars();
		addResponse(objResponseUnit, function () {
			updateStorageSize(function (err) {
				if (err)
					return revert(err);
				addUpdatedStateVarsIntoPrimaryResponse();
				onDone(objResponseUnit, bBouncing ? error_message : false);
			});
		});
	}

	function handleSecondaryTriggers(objUnit, arrOutputAddresses) {
		conn.query("SELECT address, definition FROM aa_addresses WHERE address IN(?) AND mci<=? ORDER BY address", [arrOutputAddresses, mci], function (rows) {
			if (rows.length === 0) {
				saveStateVars();
				addUpdatedStateVarsIntoPrimaryResponse();
				return onDone(objUnit, bBouncing ? error_message : false);
			}
			if (bBouncing)
				throw Error("secondary triggers while bouncing");
			async.eachSeries(
				rows,
				function (row, cb) {
					var child_trigger = getTrigger(objUnit, row.address);
					child_trigger.initial_address = trigger.initial_address;
					var arrChildDefinition = JSON.parse(row.definition);
					handleTrigger(conn, batch, null, child_trigger, stateVars, arrChildDefinition, row.address, mci, objMcUnit, true, arrResponses, function (objSecondaryUnit, bounce_message) {
						if (bounce_message)
							return cb(bounce_message);
						cb();
					});
				},
				function (err) {
					if (err) {
						// revert
						if (bSecondary)
							return bounce(err);
						return revert("one of secondary AAs bounced with error: " + err);
					}
					saveStateVars();
					addUpdatedStateVarsIntoPrimaryResponse();
					onDone(objUnit, bBouncing ? error_message : false);
				}
			);
		});
	}

	function revert(err) {
		console.log('will revert: ' + err);
		if (bSecondary)
			return bounce(err);
		revertResponsesInCaches(arrResponses);
		arrResponses.splice(0, arrResponses.length); // start over
		Object.keys(stateVars).forEach(function (address) { delete stateVars[address]; });
		batch.clear();
		conn.query("ROLLBACK TO SAVEPOINT initial_balances", function () {
			console.log('done revert: ' + err);
			bounce(err);
		});
		/*
		conn.query("ROLLBACK", function () {
			conn.query("BEGIN", function () {
				// initial AA balances were rolled back, we have to add them again
				if (!fPrepare)
					fPrepare = function (cb) { cb(); };
				fPrepare(function () {
					updateInitialAABalances(function () {
						console.log('done revert: ' + err);
						bounce(err);
					});
				});
			});
		});*/
	}

	function validateAndSaveUnit(objUnit, cb) {
		var objJoint = { unit: objUnit, aa: true };
		validation.validate(objJoint, {
			ifJointError: function (err) {
				throw Error("AA validation joint error: " + err);
			},
			ifUnitError: function (err) {
				console.log("AA validation unit error: " + err);
				return cb(err);
			},
			ifTransientError: function (err) {
				throw Error("AA validation transient error: " + err);
			},
			ifNeedHashTree: function () {
				throw Error("AA validation unexpected need hash tree");
			},
			ifNeedParentUnits: function (arrMissingUnits) {
				throw Error("AA validation unexpected dependencies: " + arrMissingUnits.join(", "));
			},
			ifOkUnsigned: function () {
				throw Error("AA validation returned ok unsigned");
			},
			ifOk: function (objAAValidationState, validation_unlock) {
				if (objAAValidationState.sequence !== 'good')
					throw Error("nonserial AA");
				validation_unlock();
				objAAValidationState.conn = conn;
				objAAValidationState.batch = batch;
				writer.saveJoint(objJoint, objAAValidationState, null, function(err){
					if (err)
						throw Error('AA writer returned error: ' + err);
					cb();
				});
			}
		}, conn);
	}


	updateInitialAABalances(function () {

		// these errors must be thrown after updating the balances
		if (arrResponses.length >= constants.MAX_RESPONSES_PER_PRIMARY_TRIGGER) // max number of responses per primary trigger, over all branches stemming from the primary trigger
			return bounce("max number of responses per trigger exceeded");
		// being able to pay for bounce fees is not required for secondary triggers as they never actually send any bounce response or change state when bounced
		if (!bSecondary) {
			if ((trigger.outputs.base || 0) < bounce_fees.base) {
				error_message = 'received bytes are not enough to cover bounce fees';
				return finish(null);
			}
			for (var asset in trigger.outputs) { // if not enough asset received to pay for bounce fees, ignore silently
				if (bounce_fees[asset] && trigger.outputs[asset] < bounce_fees[asset]) {
					error_message = 'received ' + asset + ' is not enough to cover bounce fees';
					return finish(null);
				}
			}
		}

		replace(arrDefinition, 1, '', {}, function (err) {
			if (err)
				return bounce(err);
			var messages = template.messages;
			if (!messages)
				return bounce('no messages');
			// this will also filter out the special message that performs the state changes
			messages = messages.filter(function (message) { return ('payload' in message && (message.app !== 'payment' || 'outputs' in message.payload)); });
			if (messages.length === 0) { // eat the received coins and send no response, state changes are still performed
				error_message = 'no messages after filtering';
				console.log(error_message);
				return handleSuccessfulEmptyResponseUnit(null);
			}
			messages.forEach(function (message) {
				var payload = message.payload;
				if (message.app === 'asset' && isNonemptyArray(payload.denominations))
					payload.denominations.sort(sortDenominations);
				if ((message.app === 'asset' || message.app === 'asset_attestors') && isNonemptyArray(payload.attestors))
					payload.attestors.sort();
			});
			sendUnit(messages);
		});
	});

}

function sortOutputs(a,b){
	var addr_comparison = a.address.localeCompare(b.address);
	return addr_comparison ? addr_comparison : (a.amount - b.amount);
}

function sortDenominations(a,b){
	return (a.denomination - b.denomination);
}

function revertResponsesInCaches(arrResponses) {
	// remove the rolled back units from caches and correct is_free of their parents if necessary
	console.log('will revert responses ' + JSON.stringify(arrResponses, null, '\t'));
	var arrResponseUnits = [];
	arrResponses.forEach(function (objAAResponse) {
		if (objAAResponse.response_unit)
			arrResponseUnits.push(objAAResponse.response_unit);
	});
	console.log('will revert response units ' + arrResponseUnits.join(', '));
	if (arrResponseUnits.length > 0) {
		var first_unit = arrResponseUnits[0];
		var objFirstUnit = storage.assocUnstableUnits[first_unit];
		var parent_units = objFirstUnit.parent_units;
		arrResponseUnits.forEach(storage.forgetUnit);
		storage.fixIsFreeAfterForgettingUnit(parent_units);
	}
}

function checkStorageSizes() {
	db.takeConnectionFromPool(function (conn) { // block conection for the etire duration of the check
		var options = {};
		options.gte = "st\n";
		options.lte = "st\n\uFFFF";

		var assocSizes = {};
		var handleData = function (data) {
			var address = data.key.substr(3, 32);
			var var_name = data.key.substr(36);
			if (!assocSizes[address])
				assocSizes[address] = 0;
			assocSizes[address] += var_name.length + data.value.length;
		}
		var stream = kvstore.createReadStream(options);
		stream.on('data', handleData)
			.on('end', function () {
				conn.query("SELECT address, storage_size FROM aa_addresses", function (rows) {
					rows.forEach(function (row) {
						if (!assocSizes[row.address])
							assocSizes[row.address] = 0;
						if (row.storage_size !== assocSizes[row.address])
							throw Error("storage size mismatch on " + row.address + ": db=" + row.storage_size + ", kv=" + assocSizes[row.address]);
					});
					conn.release();
				});
			})
			.on('error', function (error) {
				throw Error('error from data stream: ' + error);
			});
	});
}

if (!conf.bLight) {
	setTimeout(checkStorageSizes, 1000);
	setInterval(checkStorageSizes, 600 * 1000);
}

exports.handleAATriggers = handleAATriggers;
exports.handleTrigger = handleTrigger;
exports.dryRunPrimaryAATrigger = dryRunPrimaryAATrigger;
