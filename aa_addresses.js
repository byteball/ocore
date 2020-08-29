/*jslint node: true */
"use strict";
var _ = require('lodash');
var async = require('async');
var objectHash = require('./object_hash.js');
var constants = require('./constants.js');
var conf = require("./conf.js");
var network = require("./network.js");
var db = require("./db.js");

var cacheOfNewAddresses = {};


function MissingBounceFeesErrorMessage(obj) {
	this.error = obj.error;
	this.missing_bounce_fees = obj.missing_bounce_fees;
	var assocRequiredByAsset = {};
	obj.missing_bounce_fees.forEach(function (fees) {
		if (!assocRequiredByAsset[fees.asset])
			assocRequiredByAsset[fees.asset] = 0;
		assocRequiredByAsset[fees.asset] += fees.recommended_amount;
	});
	var arrRequired = [];
	for (var asset in assocRequiredByAsset)
		arrRequired.push(assocRequiredByAsset[asset] + ((asset === 'base') ? ' bytes' : ' of ' + asset));
	this.toString = function () {
		return obj.error + ", required: " + arrRequired.join(', ');
	}
}


function readAADefinitions(arrAddresses, handleRows) {
	db.query("SELECT definition, address, base_aa FROM aa_addresses WHERE address IN (" + arrAddresses.map(db.escape).join(', ') + ")", function (rows) {
		if (!conf.bLight || arrAddresses.length === rows.length)
			return handleRows(rows);
		var arrKnownAAAdresses = rows.map(function (row) { return row.address; });
		var arrRemainingAddresses = _.difference(arrAddresses, arrKnownAAAdresses);
		var remaining_addresses_list = arrRemainingAddresses.map(db.escape).join(', ');
		db.query(
			"SELECT definition_chash AS address FROM definitions WHERE definition_chash IN("+remaining_addresses_list+") \n\
			UNION \n\
			SELECT address FROM my_addresses WHERE address IN(" + remaining_addresses_list + ") \n\
			UNION \n\
			SELECT shared_address AS address FROM shared_addresses WHERE shared_address IN(" + remaining_addresses_list + ")",
			function (non_aa_rows) {
				if (arrRemainingAddresses.length === non_aa_rows.length)
					return handleRows(rows);
				var arrKnownNonAAAddresses = non_aa_rows.map(function (row) { return row.address; });
				arrRemainingAddresses = _.difference(arrRemainingAddresses, arrKnownNonAAAddresses);
				var arrCachedNewAddresses = [];
				arrRemainingAddresses.forEach(function (address) {
					var ts = cacheOfNewAddresses[address]
					if (!ts)
						return;
					if (Date.now() - ts > 60 * 1000)
						delete cacheOfNewAddresses[address];
					else
						arrCachedNewAddresses.push(address);
				});
				arrRemainingAddresses = _.difference(arrRemainingAddresses, arrCachedNewAddresses);
				if (arrRemainingAddresses.length === 0)
					return handleRows(rows);
				async.each(
					arrRemainingAddresses,
					function (address, cb) {
						network.requestFromLightVendor('light/get_definition', address, function (ws, request, response) {
							if (response && response.error) { 
								console.log('failed to get definition of ' + address + ': ' + response.error);
								return cb();
							}
							if (!response) {
								cacheOfNewAddresses[address] = Date.now();
								console.log('address ' + address + ' not known yet');
								return cb();
							}
							var arrDefinition = response;
							if (objectHash.getChash160(arrDefinition) !== address) {
								console.log("definition doesn't match address: " + address);
								return cb();
							}
							var Definition = require("./definition.js");
							var insert_cb = function () { cb(); };
							var strDefinition = JSON.stringify(arrDefinition);
							var bAA = (arrDefinition[0] === 'autonomous agent');
							if (bAA) {
								var base_aa = arrDefinition[1].base_aa;
								rows.push({ address: address, definition: strDefinition, base_aa: base_aa });
								db.query("INSERT " + db.getIgnore() + " INTO aa_addresses (address, definition, unit, mci, base_aa) VALUES(?, ?, ?, ?, ?)", [address, strDefinition, constants.GENESIS_UNIT, 0, base_aa], insert_cb);
							}
							else
								db.query("INSERT " + db.getIgnore() + " INTO definitions (definition_chash, definition, has_references) VALUES (?,?,?)", [address, strDefinition, Definition.hasReferences(arrDefinition) ? 1 : 0], insert_cb);
						});
					},
					function () {
						handleRows(rows);
					}
				);
			}
		);
	});
}

function checkAAOutputs(arrPayments, handleResult) {
	var assocAmounts = {};
	arrPayments.forEach(function (payment) {
		var asset = payment.asset || 'base';
		payment.outputs.forEach(function (output) {
			if (!assocAmounts[output.address])
				assocAmounts[output.address] = {};
			if (!assocAmounts[output.address][asset])
				assocAmounts[output.address][asset] = 0;
			assocAmounts[output.address][asset] += output.amount;
		});
	});
	var arrAddresses = Object.keys(assocAmounts);
	readAADefinitions(arrAddresses, function (rows) {
		if (rows.length === 0)
			return handleResult();
		var arrMissingBounceFees = [];
		rows.forEach(function (row) {
			var arrDefinition = JSON.parse(row.definition);
			var bounce_fees = arrDefinition[1].bounce_fees;
			if (!bounce_fees)
				bounce_fees = { base: constants.MIN_BYTES_BOUNCE_FEE };
			if (!bounce_fees.base)
				bounce_fees.base = constants.MIN_BYTES_BOUNCE_FEE;
			for (var asset in bounce_fees) {
				var amount = assocAmounts[row.address][asset] || 0;
				if (amount < bounce_fees[asset])
					arrMissingBounceFees.push({ address: row.address, asset: asset, missing_amount: bounce_fees[asset] - amount, recommended_amount: bounce_fees[asset] });
			}
		});
		if (arrMissingBounceFees.length === 0)
			return handleResult();
		handleResult(new MissingBounceFeesErrorMessage({ error: "The amounts are less than bounce fees", missing_bounce_fees: arrMissingBounceFees }));
	});
}

exports.readAADefinitions = readAADefinitions;
exports.checkAAOutputs = checkAAOutputs;
