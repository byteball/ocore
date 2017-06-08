/*jslint node: true */
"use strict";
var db = require('./db');

function readBalance(wallet, handleBalance){
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
			var my_addresses_join = walletIsAddress ? "" : "my_addresses CROSS JOIN";
			var using = walletIsAddress ? "" : "USING(address)";
			db.query(
				"SELECT SUM(total) AS total FROM ( \n\
				SELECT SUM(amount) AS total FROM "+my_addresses_join+" witnessing_outputs "+using+" WHERE is_spent=0 AND "+where_condition+" \n\
				UNION ALL \n\
				SELECT SUM(amount) AS total FROM "+my_addresses_join+" headers_commission_outputs "+using+" WHERE is_spent=0 AND "+where_condition+" ) AS t",
				[wallet,wallet],
				function(rows) {
					if(rows.length){
						assocBalances["base"]["stable"] += rows[0].total;
					}
					// add 0-balance assets
					db.query(
						"SELECT DISTINCT outputs.asset, is_private \n\
						FROM outputs "+join_my_addresses+" CROSS JOIN units USING(unit) LEFT JOIN assets ON asset=assets.unit \n\
						WHERE "+where_condition+" AND sequence='good'",
						[wallet],
						function(rows){
							for (var i=0; i<rows.length; i++){
								var row = rows[i];
								var asset = row.asset || "base";
								if (!assocBalances[asset])
									assocBalances[asset] = {stable: 0, pending: 0};
								assocBalances[asset].is_private = row.is_private;
							}
							handleBalance(assocBalances);
						}
					);
				}
			);
		}
	);
}

function readSharedAddressesOnWallet(wallet, handleSharedAddresses){
	db.query("SELECT DISTINCT shared_address FROM my_addresses JOIN shared_address_signing_paths USING(address) WHERE wallet=?", [wallet], function(rows){
		handleSharedAddresses(rows.map(function(row){ return row.shared_address; }));
	});
}

function readSharedBalance(wallet, handleBalance){
	var assocBalances = {};
	readSharedAddressesOnWallet(wallet, function(arrSharedAddresses){
		if (arrSharedAddresses.length === 0)
			return handleBalance(assocBalances);
		db.query(
			"SELECT asset, address, is_stable, SUM(amount) AS balance \n\
			FROM outputs CROSS JOIN units USING(unit) \n\
			WHERE is_spent=0 AND sequence='good' AND address IN(?) \n\
			GROUP BY asset, address, is_stable \n\
			UNION ALL \n\
			SELECT NULL AS asset, address, 1 AS is_stable, SUM(amount) AS balance FROM witnessing_outputs \n\
			WHERE is_spent=0 AND address IN(?) GROUP BY address \n\
			UNION ALL \n\
			SELECT NULL AS asset, address, 1 AS is_stable, SUM(amount) AS balance FROM headers_commission_outputs \n\
			WHERE is_spent=0 AND address IN(?) GROUP BY address",
			[arrSharedAddresses, arrSharedAddresses, arrSharedAddresses],
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
				handleBalance(assocBalances);
			}
		);
	});
}

exports.readBalance = readBalance; 
exports.readSharedBalance = readSharedBalance;