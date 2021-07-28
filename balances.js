/*jslint node: true */
"use strict";
var _ = require('lodash');
var constants = require('./constants.js');
var db = require('./db');

function readBalance(walletOrAddress, handleBalance){
	var start_time = Date.now();
	var walletIsAddress = typeof walletOrAddress === 'string' && walletOrAddress.length === 32; // ValidationUtils.isValidAddress
	var join_my_addresses = walletIsAddress ? "" : "JOIN my_addresses USING(address)";
	var where_condition = walletIsAddress ? "address=?" : "wallet=?";
	var assocBalances = {base: {stable: 0, pending: 0}};
	assocBalances[constants.BLACKBYTES_ASSET] = {is_private: 1, stable: 0, pending: 0};
	db.query(
		"SELECT asset, is_stable, SUM(amount) AS balance \n\
		FROM outputs "+join_my_addresses+" CROSS JOIN units USING(unit) \n\
		WHERE is_spent=0 AND "+where_condition+" AND sequence='good' \n\
		GROUP BY asset, is_stable",
		[walletOrAddress],
		function(rows){
			for (var i=0; i<rows.length; i++){
				var row = rows[i];
				var asset = row.asset || "base";
				if (!assocBalances[asset])
					assocBalances[asset] = {stable: 0, pending: 0};
				assocBalances[asset][row.is_stable ? 'stable' : 'pending'] = row.balance;
			}
			var my_addresses_join = walletIsAddress ? "" : "my_addresses CROSS JOIN";
			var using = walletIsAddress ? "" : "USING(address)";
			db.query(
				"SELECT SUM(total) AS total FROM ( \n\
				SELECT SUM(amount) AS total FROM "+my_addresses_join+" witnessing_outputs "+using+" WHERE is_spent=0 AND "+where_condition+" \n\
				UNION ALL \n\
				SELECT SUM(amount) AS total FROM "+my_addresses_join+" headers_commission_outputs "+using+" WHERE is_spent=0 AND "+where_condition+" ) AS t",
				[walletOrAddress,walletOrAddress],
				function(rows) {
					if(rows.length){
						assocBalances["base"]["stable"] += rows[0].total;
					}
					// add 0-balance assets
					db.query(
						"SELECT DISTINCT outputs.asset, is_private \n\
						FROM outputs "+join_my_addresses+" \n\
						CROSS JOIN units USING(unit) \n\
						LEFT JOIN assets ON outputs.asset=assets.unit \n\
						WHERE "+where_condition+" AND sequence='good'",
						[walletOrAddress],
						function(rows){
							for (var i=0; i<rows.length; i++){
								var row = rows[i];
								var asset = row.asset || "base";
								if (!assocBalances[asset])
									assocBalances[asset] = {stable: 0, pending: 0};
								assocBalances[asset].is_private = row.is_private;
							}
							if (assocBalances[constants.BLACKBYTES_ASSET].stable === 0 && assocBalances[constants.BLACKBYTES_ASSET].pending === 0)
								delete assocBalances[constants.BLACKBYTES_ASSET];
							for (var asset in assocBalances)
								assocBalances[asset].total = assocBalances[asset].stable + assocBalances[asset].pending;
							console.log('reading balances of ' + walletOrAddress + ' took ' + (Date.now() - start_time) + 'ms')
							handleBalance(assocBalances);
						}
					);
				}
			);
		}
	);
}

function readOutputsBalance(wallet, handleBalance){
	var walletIsAddress = typeof wallet === 'string' && wallet.length === 32; // ValidationUtils.isValidAddress
	var join_my_addresses = walletIsAddress ? "" : "JOIN my_addresses USING(address)";
	var where_condition = walletIsAddress ? "address=?" : "wallet=?";
	var assocBalances = {base: {stable: 0, pending: 0}};
	db.query(
		"SELECT asset, is_stable, SUM(amount) AS balance \n\
		FROM outputs "+join_my_addresses+" CROSS JOIN units USING(unit) \n\
		WHERE is_spent=0 AND "+where_condition+" AND sequence='good' \n\
		GROUP BY asset, is_stable",
		[wallet],
		function(rows){
			for (var i=0; i<rows.length; i++){
				var row = rows[i];
				var asset = row.asset || "base";
				if (!assocBalances[asset])
					assocBalances[asset] = {stable: 0, pending: 0};
				assocBalances[asset][row.is_stable ? 'stable' : 'pending'] = row.balance;
			}
			for (var asset in assocBalances)
				assocBalances[asset].total = assocBalances[asset].stable + assocBalances[asset].pending;
			handleBalance(assocBalances);
		}
	);
}

function readSharedAddressesOnWallet(wallet, handleSharedAddresses){
	db.query("SELECT DISTINCT shared_address_signing_paths.shared_address FROM my_addresses \n\
			JOIN shared_address_signing_paths USING(address) \n\
			LEFT JOIN prosaic_contracts ON prosaic_contracts.shared_address = shared_address_signing_paths.shared_address \n\
			WHERE wallet=? AND prosaic_contracts.hash IS NULL", [wallet], function(rows){
		var arrSharedAddresses = rows.map(function(row){ return row.shared_address; });
		if (arrSharedAddresses.length === 0)
			return handleSharedAddresses([]);
		readSharedAddressesDependingOnAddresses(arrSharedAddresses, function(arrNewSharedAddresses){
			handleSharedAddresses(arrSharedAddresses.concat(arrNewSharedAddresses));
		});
	});
}

function readSharedAddressesDependingOnAddresses(arrMemberAddresses, handleSharedAddresses){
	var strAddressList = arrMemberAddresses.map(db.escape).join(', ');
	db.query("SELECT DISTINCT shared_address FROM shared_address_signing_paths WHERE address IN("+strAddressList+")", function(rows){
		var arrSharedAddresses = rows.map(function(row){ return row.shared_address; });
		if (arrSharedAddresses.length === 0)
			return handleSharedAddresses([]);
		var arrNewMemberAddresses = _.difference(arrSharedAddresses, arrMemberAddresses);
		if (arrNewMemberAddresses.length === 0)
			return handleSharedAddresses([]);
		readSharedAddressesDependingOnAddresses(arrNewMemberAddresses, function(arrNewSharedAddresses){
			handleSharedAddresses(arrNewMemberAddresses.concat(arrNewSharedAddresses));
		});
	});
}

function readSharedBalance(wallet, handleBalance){
	var assocBalances = {};
	readSharedAddressesOnWallet(wallet, function(arrSharedAddresses){
		if (arrSharedAddresses.length === 0)
			return handleBalance(assocBalances);
		var strAddressList = arrSharedAddresses.map(db.escape).join(', ');
		db.query(
			"SELECT asset, address, is_stable, SUM(amount) AS balance \n\
			FROM outputs CROSS JOIN units USING(unit) \n\
			WHERE is_spent=0 AND sequence='good' AND address IN("+strAddressList+") \n\
			GROUP BY asset, address, is_stable \n\
			UNION ALL \n\
			SELECT NULL AS asset, address, 1 AS is_stable, SUM(amount) AS balance FROM witnessing_outputs \n\
			WHERE is_spent=0 AND address IN("+strAddressList+") GROUP BY address \n\
			UNION ALL \n\
			SELECT NULL AS asset, address, 1 AS is_stable, SUM(amount) AS balance FROM headers_commission_outputs \n\
			WHERE is_spent=0 AND address IN("+strAddressList+") GROUP BY address",
			function(rows){
				for (var i=0; i<rows.length; i++){
					var row = rows[i];
					var asset = row.asset || "base";
					if (!assocBalances[asset])
						assocBalances[asset] = {};
					if (!assocBalances[asset][row.address])
						assocBalances[asset][row.address] = {stable: 0, pending: 0};
					assocBalances[asset][row.address][row.is_stable ? 'stable' : 'pending'] += row.balance;
				}
				for (var asset in assocBalances)
					for (var address in assocBalances[asset])
						assocBalances[asset][address].total = assocBalances[asset][address].stable + assocBalances[asset][address].pending;
				handleBalance(assocBalances);
			}
		);
	});
}

function readAllUnspentOutputs(exclude_from_circulation, handleSupply) {
	if (!exclude_from_circulation)
		exclude_from_circulation = [];
	var supply = {
		addresses: 0,
		txouts: 0,
		total_amount: 0,
		circulating_txouts: 0,
		circulating_amount: 0,
		headers_commission_amount: 0,
		payload_commission_amount: 0,
	};
	db.query('SELECT address, COUNT(*) AS count, SUM(amount) AS amount FROM outputs WHERE is_spent=0 AND asset IS null GROUP BY address;', function(rows) {
		if (rows.length) {
			supply.addresses += rows.length;
			rows.forEach(function(row) {
				supply.txouts += row.count;
				supply.total_amount += row.amount;
				if (!exclude_from_circulation.includes(row.address)) {
					supply.circulating_txouts += row.count;
					supply.circulating_amount += row.amount;
				}
			});
		}
		db.query('SELECT "headers_commission_amount" AS amount_name, SUM(amount) AS amount FROM headers_commission_outputs WHERE is_spent=0 UNION SELECT "payload_commission_amount" AS amount_name, SUM(amount) AS amount FROM witnessing_outputs WHERE is_spent=0;', function(rows) {
			if (rows.length) {
				rows.forEach(function(row) {
					supply.total_amount += row.amount;
					supply.circulating_amount += row.amount;
					supply[row.amount_name] += row.amount;
				});
			}
			handleSupply(supply);
		});
	});
}

exports.readBalance = readBalance;
exports.readOutputsBalance = readOutputsBalance;
exports.readSharedBalance = readSharedBalance;
exports.readAllUnspentOutputs = readAllUnspentOutputs;
