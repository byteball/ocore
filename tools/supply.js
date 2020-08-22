/*jslint node: true */
"use strict";
const db = require('../db.js');
const storage = require('../storage.js');
const balances = require('../balances.js');

const start_time = Date.now();
const not_circulating = process.env.testnet ? [
	"5ZPGXCOGRGUUXIUU72JIENHXU6XU77BD"
] : [
	"MZ4GUQC7WUKZKKLGAS3H3FSDKLHI7HFO", // address of Obyte distribution fund.
	"BZUAVP5O4ND6N3PVEUZJOATXFPIKHPDC", // 1% of total supply reserved for the Obyte founder.
	"TUOMEGAZPYLZQBJKLEM2BGKYR2Q5SEYS", // another address of Obyte distribution fund.
	"FCXZXQR353XI4FIPQL6U4G2EQJL4CCU2", // address of Obyte Foundation hot-wallet.
];

storage.readLastMainChainIndex(function(last_mci){
	storage.readLastStableMcIndex(db, function(last_stable_mci){
		balances.readAllUnspentOutputs(not_circulating, function(supply) {
			console.error('readAllUnspentOutputs took '+(Date.now()-start_time)+'ms');
			console.error(Object.assign({last_mci, last_stable_mci}, supply));
			process.exit();
		});
	});
});
