/*jslint node: true */
"use strict";
var prosaic_contract = require('./prosaic_contract.js');
var eventBus = require('./event_bus.js');
var device = require('./device.js');
var objectHash = require('./object_hash.js');
var wallet = require('./wallet.js');
var conf = require('ocore/conf.js');
var db = require('./db.js');
var ecdsaSig = require('./signature.js');
var walletDefinedByAddresses = require('./wallet_defined_by_addresses.js');
var walletDefinedByKeys = require('./wallet_defined_by_keys.js');

var contractsListened = [];
var wallet_id;

function offer(title, text, my_address, peer_address, peer_device_address, ttl, cosigners, signWithLocalPrivateKey, cb) {
	var creation_date = new Date().toISOString().slice(0, 19).replace('T', ' ');
	var hash = prosaic_contract.getHash({title:title, text:text, creation_date:creation_date});

	prosaic_contract.createAndSend(hash, peer_address, peer_device_address, my_address, creation_date, ttl, title, text, cosigners, function(objContract){
		listenForPendingContracts(signWithLocalPrivateKey);
		if (cb)
			cb(objContract);
	});
}

function listenForPendingContracts(signWithLocalPrivateKey) {
	var start_listening = function(contract) {
		var sendUnit = function(accepted, authors){
			if (!accepted) {
				return;
			}

			var arrDefinition = 
				['and', [
					['address', contract.my_address],
					['address', contract.peer_address]
				]];
			var assocSignersByPath = {
				'r.0': {
					address: contract.my_address,
					member_signing_path: 'r',
					device_address: device.getMyDeviceAddress()
				},
				'r.1': {
					address: contract.peer_address,
					member_signing_path: 'r',
					device_address: contract.peer_device_address
				}
			};
			walletDefinedByAddresses.createNewSharedAddress(arrDefinition, assocSignersByPath, {
				ifError: function(err){
					console.error(err);
				},
				ifOk: function(shared_address){
					composeAndSend(shared_address);
				}
			});
			
			// create shared address and deposit some bytes to cover fees
			function composeAndSend(shared_address){
				prosaic_contract.setField(contract.hash, "shared_address", shared_address);
				device.sendMessageToDevice(contract.peer_device_address, "prosaic_contract_update", {hash: contract.hash, field: "shared_address", value: shared_address});
				contract.cosigners.forEach(function(cosigner){
					if (cosigner != device.getMyDeviceAddress())
						prosaic_contract.share(contract.hash, cosigner);
				});

				var opts = {
					asset: "base",
					to_address: shared_address,
					amount: prosaic_contract.CHARGE_AMOUNT,
					arrSigningDeviceAddresses: contract.cosigners
				};

				issueChangeAddress(function(change_address){
					opts.change_address = change_address;
					opts.wallet = wallet_id;
					opts.arrSigningDeviceAddresses = [device.getMyDeviceAddress()];
					opts.signWithLocalPrivateKey = signWithLocalPrivateKey;
					wallet.sendMultiPayment(opts, function(err){
						if (err){
							if (err.match(/device address/))
								err = "This is a private asset, please send it only by clicking links from chat";
							if (err.match(/no funded/))
								err = "Not enough spendable funds, make sure all your funds are confirmed";
							console.error(err);
							return;
						}

						// post a unit with contract text hash and send it for signing to correspondent
						var value = {"contract_text_hash": contract.hash};
						var objMessage = {
							app: "data",
							payload_location: "inline",
							payload_hash: objectHash.getBase64Hash(value),
							payload: value
						};

						wallet.sendMultiPayment({
							arrSigningDeviceAddresses: contract.cosigners.length ? contract.cosigners.concat([contract.peer_device_address]) : [],
							paying_addresses: [shared_address],
							change_address: shared_address,
							messages: [objMessage],
							signWithLocalPrivateKey: signWithLocalPrivateKey
						}, function(err, unit) { // can take long if multisig
							//indexScope.setOngoingProcess(gettext('proposing a contract'), false);
							if (err) {
								console.error(err);
								return;
							}
							prosaic_contract.setField(contract.hash, "unit", unit);
							device.sendMessageToDevice(contract.peer_device_address, "prosaic_contract_update", {hash: contract.hash, field: "unit", value: unit});
							var url = 'https://explorer.obyte.org/#' + unit;
							var text = "unit with contract hash for \""+ contract.title +"\" was posted into DAG " + url;
							device.sendMessageToDevice(contract.peer_device_address, "text", text);
						});
					});
				});
			}
		};
		eventBus.once("prosaic_contract_response_received" + contract.hash, sendUnit);
	}

	prosaic_contract.getAllByStatus("pending", function(contracts){
		contracts.forEach(function(contract){
			if (contractsListened.indexOf(contract.hash) === -1) {
				start_listening(contract);
				contractsListened.push(contract.hash);
			}
		});
	});
}

function issueChangeAddress(cb) {
	db.query("SELECT wallet FROM wallets", function(rows){
		if (rows.length === 0)
			throw Error("no wallets");
		if (rows.length > 1)
			throw Error("more than 1 wallet");
		wallet_id = rows[0].wallet;

		if (conf.bSingleAddress) {
			db.query("SELECT address FROM my_addresses WHERE wallet=?", [wallet_id], function(rows){
				if (rows.length === 0)
					throw Error("no addresses");
				if (rows.length > 1)
					throw Error("more than 1 address");
				cb(rows[0].address);
			});
		}
		else if (conf.bStaticChangeAddress) {
			issueOrSelectStaticChangeAddress(handleAddress);
			issueOrSelectAddressByIndex(1, 0, handleAddress);
			walletDefinedByKeys.readAddressByIndex(wallet_id, 1, 0, function(objAddr){
				if (objAddr)
					return cb(objAddr.address);
				walletDefinedByKeys.issueAddress(wallet_id, 1, 0, function(objAddr){
					cb(objAddr.address);
				});
			});
		}
		else {
			walletDefinedByKeys.issueOrSelectNextChangeAddress(wallet_id, function(objAddr){
				cb(objAddr.address);
			});
		}
	});
}

function readSingleWallet(handleWallet){
	db.query("SELECT wallet FROM wallets", function(rows){
		if (rows.length === 0)
			throw Error("no wallets");
		if (rows.length > 1)
			throw Error("more than 1 wallet");
		handleWallet(rows[0].wallet);
	});
}

exports.offer = offer;
exports.listenForPendingContracts = listenForPendingContracts;