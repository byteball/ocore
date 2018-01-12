/*jslint node: true */
const _ = require('lodash');
const storage = require('./storage.js');
const db = require('./db.js');
const conf = require('./conf.js');
const ValidationUtils = require("./validation_utils.js");
const indivisibleAsset = require('./indivisible_asset.js');
const divisibleAsset = require('./divisible_asset.js');

function findUnfinishedPastUnitsOfPrivateChains(arrChains, includeLatestElement, handleUnits){
	const assocUnits = {};
	arrChains.forEach(arrPrivateElements => {
		assocUnits[arrPrivateElements[0].payload.asset] = true; // require asset definition
		for (let i = includeLatestElement ? 0 : 1; i<arrPrivateElements.length; i++) // skip latest element
			assocUnits[arrPrivateElements[i].unit] = true;
	});
	const arrUnits = Object.keys(assocUnits);
	storage.filterNewOrUnstableUnits(arrUnits, handleUnits);
}


function validateAndSavePrivatePaymentChain(arrPrivateElements, callbacks){
	if (!ValidationUtils.isNonemptyArray(arrPrivateElements))
		return callbacks.ifError("no priv elements array");
	const headElement = arrPrivateElements[0];
	if (!headElement.payload)
		return callbacks.ifError("no payload in head element");
	const asset = headElement.payload.asset;
	if (!asset)
		return callbacks.ifError("no asset in head element");
	if (!ValidationUtils.isNonnegativeInteger(headElement.message_index))
		return callbacks.ifError("no message index in head private element");
	
	const validateAndSave = () => {
		storage.readAsset(db, asset, null, (err, {fixed_denominations}) => {
			if (err)
				return callbacks.ifError(err);
			if (!!fixed_denominations !== !!headElement.payload.denomination)
				return callbacks.ifError("presence of denomination field doesn't match the asset type");
			db.takeConnectionFromPool(conn => {
				conn.query("BEGIN", () => {
					const transaction_callbacks = {
						ifError(err) {
							conn.query("ROLLBACK", () => {
								conn.release();
								callbacks.ifError(err);
							});
						},
						ifOk() {
							conn.query("COMMIT", () => {
								conn.release();
								callbacks.ifOk();
							});
						}
					};
					// check if duplicate
					let sql = "SELECT address FROM outputs WHERE unit=? AND message_index=?";
					const params = [headElement.unit, headElement.message_index];
					if (fixed_denominations){
						if (!ValidationUtils.isNonnegativeInteger(headElement.output_index))
							return transaction_callbacks.ifError("no output index in head private element");
						sql += " AND output_index=?";
						params.push(headElement.output_index);
					}
					conn.query(
						sql, 
						params, 
						rows => {
							if (rows.length > 1)
								throw Error(`more than one output ${sql} ${params.join(', ')}`);
							if (rows.length > 0 && rows[0].address){ // we could have this output already but the address is still hidden
								console.log(`duplicate private payment ${params.join(', ')}`);
								return transaction_callbacks.ifOk();
							}
							const assetModule = fixed_denominations ? indivisibleAsset : divisibleAsset;
							assetModule.validateAndSavePrivatePaymentChain(conn, arrPrivateElements, transaction_callbacks);
						}
					);
				});
			});
		});
	};
	
	if (conf.bLight)
		findUnfinishedPastUnitsOfPrivateChains([arrPrivateElements], false, ({length}) => {
			(length > 0) ? callbacks.ifWaitingForChain() : validateAndSave();
		});
	else
		validateAndSave();
}

exports.findUnfinishedPastUnitsOfPrivateChains = findUnfinishedPastUnitsOfPrivateChains;
exports.validateAndSavePrivatePaymentChain = validateAndSavePrivatePaymentChain;

