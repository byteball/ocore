/*jslint node: true */
const async = require('async');
const _ = require('lodash');
const conf = require('./conf.js');
const storage = require('./storage.js');
const objectHash = require("./object_hash.js");
const db = require('./db.js');
const constants = require("./constants.js");
const composer = require("./composer.js");
const validation = require('./validation.js');
const ValidationUtils = require("./validation_utils.js");
const writer = require('./writer.js');
const graph = require('./graph.js');
const profiler = require('./profiler.js');

const NOT_ENOUGH_FUNDS_ERROR_MESSAGE = "not enough indivisible asset coins that fit the desired amount within the specified tolerances, make sure all your funds are confirmed";

function validatePrivatePayment(conn, objPrivateElement, objPrevPrivateElement, callbacks){
		
	function validateSpendProof(spend_proof, cb){
		profiler.start();
		conn.query(
			"SELECT spend_proof, address FROM spend_proofs WHERE unit=? AND message_index=?", 
			[objPrivateElement.unit, objPrivateElement.message_index], 
			rows => {
				profiler.stop('spend_proof');
				if (rows.length !== 1)
					return cb(`expected 1 spend proof, found ${rows.length}`);
				const stored_spend_proof = rows[0].spend_proof;
				const spend_proof_address = rows[0].address;
				if (stored_spend_proof !== spend_proof)
					return cb("spend proof doesn't match");
				if (objPrevPrivateElement && objPrevPrivateElement.output.address !== spend_proof_address)
					return cb("spend proof address does not match src output");
				if (input.address && input.address !== spend_proof_address)
					return cb("spend proof address does not match issuer address");
				cb();
			}
		);
	}
	
	function validateSourceOutput(cb){
		if (conf.bLight)
			return cb(); // already validated the linkproof
		profiler.start();
		graph.determineIfIncluded(conn, input.unit, [objPrivateElement.unit], bIncluded => {
			profiler.stop('determineIfIncluded');
			bIncluded ? cb() : cb("input unit not included");
		});
	}
		
	const payload = objPrivateElement.payload;
	if (!ValidationUtils.isStringOfLength(payload.asset, constants.HASH_LENGTH))
		return callbacks.ifError("invalid asset in private payment");
	if (!ValidationUtils.isPositiveInteger(payload.denomination))
		return callbacks.ifError("invalid denomination in private payment");
	if (!ValidationUtils.isNonemptyObject(objPrivateElement.output))
		return callbacks.ifError("no output");
	if (!ValidationUtils.isNonnegativeInteger(objPrivateElement.output_index))
		return callbacks.ifError("invalid output index");
	if (!ValidationUtils.isNonemptyArray(payload.outputs))
		return callbacks.ifError("invalid outputs");
	const our_hidden_output = payload.outputs[objPrivateElement.output_index];
	if (!ValidationUtils.isNonemptyObject(payload.outputs[objPrivateElement.output_index]))
		return callbacks.ifError("no output at output_index");
	if (!ValidationUtils.isValidAddress(objPrivateElement.output.address))
		return callbacks.ifError("bad address in output");
	if (!ValidationUtils.isNonemptyString(objPrivateElement.output.blinding))
		return callbacks.ifError("bad blinding in output");
	if (objectHash.getBase64Hash(objPrivateElement.output) !== our_hidden_output.output_hash)
		return callbacks.ifError(`output hash doesn't match, output=${JSON.stringify(objPrivateElement.output)}, hash=${our_hidden_output.output_hash}`);
	if (!ValidationUtils.isArrayOfLength(payload.inputs, 1))
		return callbacks.ifError("inputs array must be 1 element long");
	var input = payload.inputs[0];
	if (!ValidationUtils.isNonemptyObject(input))
		return callbacks.ifError("no inputs[0]");
	
	profiler.start();
	validation.initPrivatePaymentValidationState(
		conn, objPrivateElement.unit, objPrivateElement.message_index, payload, callbacks.ifError, 
		(bStable, objPartialUnit, objValidationState) => {
		
			profiler.stop('initPrivatePaymentValidationState');
			const arrFuncs = [];
			let spend_proof;
			let input_address; // from which address the money is sent
			if (!input.type){ // transfer
				if (typeof input.unit !== 'string')
					return callbacks.ifError("invalid unit in private payment");
				if (!ValidationUtils.isNonnegativeInteger(input.message_index))
					return callbacks.ifError("invalid input message_index");
				if (!ValidationUtils.isNonnegativeInteger(input.output_index))
					return callbacks.ifError("invalid input output_index");
				if (!objPrevPrivateElement || !objPrevPrivateElement.output || !objPrevPrivateElement.output.blinding)
					return callbacks.ifError("no prev output blinding");
				if (!objPrevPrivateElement.payload || !objPrevPrivateElement.payload.outputs)
					return callbacks.ifError("no prev outputs");
				const src_output = objPrevPrivateElement.output;
				const prev_hidden_output = objPrevPrivateElement.payload.outputs[input.output_index];
				if (!prev_hidden_output)
					return callbacks.ifError("no prev hidden output");
				input_address = src_output.address;
				spend_proof = objectHash.getBase64Hash({
					asset: payload.asset,
					unit: input.unit,
					message_index: input.message_index,
					output_index: input.output_index,
					address: src_output.address,
					amount: prev_hidden_output.amount,
					blinding: src_output.blinding
				});
				console.log(`validation spend proof: ${JSON.stringify({
    asset: payload.asset,
    unit: input.unit,
    message_index: input.message_index,
    output_index: input.output_index,
    address: src_output.address,
    amount: prev_hidden_output.amount,
    blinding: src_output.blinding
})}`);
				arrFuncs.push(validateSourceOutput);
				objValidationState.src_coin = {
					src_output,
					denomination: payload.denomination,
					amount: prev_hidden_output.amount
				};
			}
			else if (input.type === 'issue'){
				if (objPrevPrivateElement)
					return callbacks.ifError("prev payload and initial input");

				input_address = (objPartialUnit.authors.length === 1) ? objPartialUnit.authors[0].address : input.address;
				spend_proof = objectHash.getBase64Hash({
					asset: payload.asset,
					address: input_address,
					serial_number: input.serial_number, // need to avoid duplicate spend proofs when issuing uncapped coins
					denomination: payload.denomination,
					amount: input.amount
				});
			}
			else
				return callbacks.ifError("neither transfer nor issue in private input");
			
			if (!objPartialUnit.authors.some(({address}) => address === input_address))
				return callbacks.ifError("input address not found among unit authors");

			arrFuncs.push(cb => {
				validateSpendProof(spend_proof, cb);
			});
			arrFuncs.push(cb => {
				// we need to unhide the single output we are interested in, other outputs stay partially hidden like {amount: 300, output_hash: "base64"}
				const partially_revealed_payload = _.cloneDeep(payload);
				const our_output = partially_revealed_payload.outputs[objPrivateElement.output_index];
				our_output.address = objPrivateElement.output.address;
				our_output.blinding = objPrivateElement.output.blinding;
				validation.validatePayment(conn, partially_revealed_payload, objPrivateElement.message_index, objPartialUnit, objValidationState, cb);
			});
			async.series(arrFuncs, err => {
			//	profiler.stop('validatePayment');
				err ? callbacks.ifError(err) : callbacks.ifOk(bStable, input_address);
			});
		}
	);
}



// arrPrivateElements is ordered in reverse chronological order
function parsePrivatePaymentChain(conn, arrPrivateElements, callbacks){
	let bAllStable = true;
	const issuePrivateElement = arrPrivateElements[arrPrivateElements.length-1];
	if (!issuePrivateElement.payload || !issuePrivateElement.payload.inputs || !issuePrivateElement.payload.inputs[0])
		return callbacks.ifError("invalid issue private element");
	const asset = issuePrivateElement.payload.asset;
	if (!asset)
		return callbacks.ifError("no asset in issue private element");
	const denomination = issuePrivateElement.payload.denomination;
	if (!denomination)
		return callbacks.ifError("no denomination in issue private element");
	async.forEachOfSeries(
		arrPrivateElements,
		(objPrivateElement, i, cb) => {
			if (!objPrivateElement.payload || !objPrivateElement.payload.inputs || !objPrivateElement.payload.inputs[0])
				return cb("invalid payload");
			if (!objPrivateElement.output)
				return cb("no output in private element");
			if (objPrivateElement.payload.asset !== asset)
				return cb("private element has a different asset");
			if (objPrivateElement.payload.denomination !== denomination)
				return cb("private element has a different denomination");
			var prevElement = null; 
			if (i+1 < arrPrivateElements.length){ // excluding issue transaction
				var prevElement = arrPrivateElements[i+1];
				if (prevElement.unit !== objPrivateElement.payload.inputs[0].unit)
					return cb("not referencing previous element unit");
				if (prevElement.message_index !== objPrivateElement.payload.inputs[0].message_index)
					return cb("not referencing previous element message index");
				if (prevElement.output_index !== objPrivateElement.payload.inputs[0].output_index)
					return cb("not referencing previous element output index");
			}
			validatePrivatePayment(conn, objPrivateElement, prevElement, {
				ifError: cb,
				ifOk(bStable, input_address) {
					objPrivateElement.bStable = bStable;
					objPrivateElement.input_address = input_address;
					if (!bStable)
						bAllStable = false;
					cb();
				}
			});
		},
		err => {
			if (err)
				return callbacks.ifError(err);
			callbacks.ifOk(bAllStable);
		}
	);
}


function validateAndSavePrivatePaymentChain(conn, arrPrivateElements, callbacks){
	parsePrivatePaymentChain(conn, arrPrivateElements, {
		ifError: callbacks.ifError,
		ifOk(bAllStable) {
			console.log(`saving private chain ${JSON.stringify(arrPrivateElements)}`);
			profiler.start();
			const arrQueries = [];
			for (let i=0; i<arrPrivateElements.length; i++){
				const objPrivateElement = arrPrivateElements[i];
				const payload = objPrivateElement.payload;
				const input_address = objPrivateElement.input_address;
				const input = payload.inputs[0];
				const is_unique = objPrivateElement.bStable ? 1 : null; // unstable still have chances to become nonserial therefore nonunique
				if (!input.type) // transfer
					conn.addQuery(arrQueries, 
						`INSERT ${db.getIgnore()} INTO inputs \n\
                        (unit, message_index, input_index, src_unit, src_message_index, src_output_index, asset, denomination, address, type, is_unique) \n\
                        VALUES (?,?,?,?,?,?,?,?,?,'transfer',?)`, 
						[objPrivateElement.unit, objPrivateElement.message_index, 0, input.unit, input.message_index, input.output_index, 
						payload.asset, payload.denomination, input_address, is_unique]);
				else if (input.type === 'issue')
					conn.addQuery(arrQueries, 
						`INSERT ${db.getIgnore()} INTO inputs \n\
                        (unit, message_index, input_index, serial_number, amount, asset, denomination, address, type, is_unique) \n\
                        VALUES (?,?,?,?,?,?,?,?,'issue',?)`, 
						[objPrivateElement.unit, objPrivateElement.message_index, 0, input.serial_number, input.amount, 
						payload.asset, payload.denomination, input_address, is_unique]);
				else
					throw Error("neither transfer nor issue after validation");
				const is_serial = objPrivateElement.bStable ? 1 : null; // initPrivatePaymentValidationState already checks for non-serial
				const outputs = payload.outputs;
				for (let output_index=0; output_index<outputs.length; output_index++){
					const output = outputs[output_index];
					console.log(`inserting output ${JSON.stringify(output)}`);
					conn.addQuery(arrQueries, 
						`INSERT ${db.getIgnore()} INTO outputs \n\
                        (unit, message_index, output_index, amount, output_hash, asset, denomination) \n\
                        VALUES (?,?,?,?,?,?,?)`,
						[objPrivateElement.unit, objPrivateElement.message_index, output_index, 
						output.amount, output.output_hash, payload.asset, payload.denomination]);
					let fields = "is_serial=?";
					const params = [is_serial];
					if (output_index === objPrivateElement.output_index){
						const is_spent = (i===0) ? 0 : 1;
						fields += ", is_spent=?, address=?, blinding=?";
						params.push(is_spent, objPrivateElement.output.address, objPrivateElement.output.blinding);
					}
					params.push(objPrivateElement.unit, objPrivateElement.message_index, output_index);
					conn.addQuery(arrQueries, `UPDATE outputs SET ${fields} WHERE unit=? AND message_index=? AND output_index=? AND is_spent=0`, params);
				}
			}
		//	console.log("queries: "+JSON.stringify(arrQueries));
			async.series(arrQueries, () => {
				profiler.stop('save');
				callbacks.ifOk();
			});
		}
	});
}


// must be executed within transaction
function updateIndivisibleOutputsThatWereReceivedUnstable(conn, onDone){
	
	function updateOutputProps(unit, is_serial, onUpdated){
		// may update several outputs
		conn.query(
			"UPDATE outputs SET is_serial=? WHERE unit=?", 
			[is_serial, unit],
			() => {
				is_serial ? updateInputUniqueness(unit, onUpdated) : onUpdated();
			}
		);
	}
	
	function updateInputUniqueness(unit, onUpdated){
		// may update several inputs
		conn.query("UPDATE inputs SET is_unique=1 WHERE unit=?", [unit], () => {
			onUpdated();
		});
	}
	
	console.log("updatePrivateIndivisibleOutputsThatWereReceivedUnstable starting");
	conn.query(
		`SELECT unit, message_index, sequence FROM outputs ${conf.storage === 'sqlite' ? "INDEXED BY outputsIsSerial" : ""} \n\
        JOIN units USING(unit) \n\
        WHERE outputs.is_serial IS NULL AND units.is_stable=1 AND is_spent=0`, // is_spent=0 selects the final output in the chain
		rows => {
			if (rows.length === 0)
				return onDone();
			async.eachSeries(
				rows,
				({unit, sequence, message_index}, cb) => {
					
					function updateFinalOutputProps(is_serial){
						updateOutputProps(unit, is_serial, cb);
					}
					
					function goUp(unit, message_index){
						// we must have exactly 1 input per message
						conn.query(
							"SELECT src_unit, src_message_index, src_output_index \n\
							FROM inputs \n\
							WHERE unit=? AND message_index=?", 
							[unit, message_index],
							src_rows => {
								if (src_rows.length === 0)
									throw Error("updating unstable: blackbyte input not found");
								if (src_rows.length > 1)
									throw Error("updating unstable: more than one input found");
								const src_row = src_rows[0];
								if (src_row.src_unit === null) // reached root of the chain (issue)
									return cb();
								conn.query(
									"SELECT sequence, is_stable, is_serial FROM outputs JOIN units USING(unit) \n\
									WHERE unit=? AND message_index=? AND output_index=?", 
									[src_row.src_unit, src_row.src_message_index, src_row.src_output_index],
									prev_rows => {
										if (prev_rows.length === 0)
											throw Error("src unit not found");
										const prev_output = prev_rows[0];
										if (prev_output.is_serial === 0)
											throw Error("prev is already nonserial");
										if (prev_output.is_stable === 0)
											throw Error("prev is not stable");
										if (prev_output.is_serial === 1 && prev_output.sequence !== 'good')
											throw Error("prev is_serial=1 but seq!=good");
										if (prev_output.is_serial === 1) // already was stable when initially received
											return cb();
										const is_serial = (prev_output.sequence === 'good') ? 1 : 0;
										updateOutputProps(src_row.src_unit, is_serial, () => {
											if (!is_serial) // overwrite the tip of the chain
												return updateFinalOutputProps(0);
											goUp(src_row.src_unit, src_row.src_message_index);
										});
									}
								);
							}
						);
					}
					
					const is_serial = (sequence === 'good') ? 1 : 0;
					updateOutputProps(unit, is_serial, () => {
						goUp(unit, message_index);
					});
				},
				onDone
			);
		}
	);
}

function pickIndivisibleCoinsForAmount(
	conn, objAsset, arrAddresses, last_ball_mci, to_address, change_address, amount, tolerance_plus, tolerance_minus, bMultiAuthored, onDone)
{
	if (!ValidationUtils.isPositiveInteger(amount))
		throw Error(`bad amount: ${amount}`);
	updateIndivisibleOutputsThatWereReceivedUnstable(conn, () => {
		console.log("updatePrivateIndivisibleOutputsThatWereReceivedUnstable done");
		const arrPayloadsWithProofs = [];
		const arrOutputIds = [];
		let accumulated_amount = 0;
		const asset = objAsset.asset;
		
		function createOutputs(amount_to_use, change_amount){
			const output = {
				address: to_address,
				amount: amount_to_use
			};
			if (objAsset.is_private)
				output.blinding = composer.generateBlinding();
			const outputs = [output];
			if (change_amount){
				const change_output = {
					address: change_address,
					amount: change_amount
				};
				if (objAsset.is_private)
					change_output.blinding = composer.generateBlinding();
				outputs.push(change_output);
				outputs.sort(({address}, {address}) => (address < address) ? -1 : 1);
			}
			return outputs;
		}
		
		function pickNextCoin(remaining_amount){
			console.log(`looking for output for ${remaining_amount}`);
			if (remaining_amount <= 0)
				throw Error(`remaining amount is ${remaining_amount}`);
			conn.query(
				"SELECT output_id, unit, message_index, output_index, amount, denomination, address, blinding, is_stable \n\
				FROM outputs CROSS JOIN units USING(unit) \n\
				WHERE asset=? AND address IN(?) AND +is_serial=1 AND is_spent=0 AND sequence='good' \n\
					AND main_chain_index<=? AND denomination<=? AND output_id NOT IN(?) \n\
				ORDER BY denomination DESC, (amount>=?) DESC, ABS(amount-?) LIMIT 1",
				[asset, arrAddresses, 
				last_ball_mci, remaining_amount, (arrOutputIds.length > 0) ? arrOutputIds : -1, 
				remaining_amount + tolerance_plus, remaining_amount],
				rows => {
					if (rows.length === 0)
						return issueNextCoinIfAllowed(remaining_amount);
					const row = rows[0];
					if (row.is_stable === 0) // contradicts to main_chain_index<=last_ball_mci
						throw Error("unstable or nonserial unit");
					const input = {
						unit: row.unit,
						message_index: row.message_index,
						output_index: row.output_index
					};
					let amount_to_use;
					let change_amount;
					if (row.amount > remaining_amount + tolerance_plus){
						// take the maximum that the denomination allows
						amount_to_use = Math.floor((remaining_amount + tolerance_plus)/row.denomination) * row.denomination;
						change_amount = row.amount - amount_to_use;
					}
					else
						amount_to_use = row.amount;
					const payload = {
						asset,
						denomination: row.denomination,
						inputs: [input],
						outputs: createOutputs(amount_to_use, change_amount)
					};
					const objPayloadWithProof = {payload, input_address: row.address};
					if (objAsset.is_private){
						const spend_proof = objectHash.getBase64Hash({
							asset,
							unit: row.unit,
							message_index: row.message_index,
							output_index: row.output_index,
							address: row.address,
							amount: row.amount,
							blinding: row.blinding
						});
						const objSpendProof = {
							spend_proof
						};
						if (bMultiAuthored)
							objSpendProof.address = row.address;
						objPayloadWithProof.spend_proof = objSpendProof;
					}
					arrPayloadsWithProofs.push(objPayloadWithProof);
					arrOutputIds.push(row.output_id);
					accumulated_amount += amount_to_use;
					if (accumulated_amount >= amount - tolerance_minus && accumulated_amount <= amount + tolerance_plus)
						return onDone(null, arrPayloadsWithProofs);
					if (arrPayloadsWithProofs.length >= constants.MAX_MESSAGES_PER_UNIT - 1) // reserve 1 for fees
						return onDone("Too many messages, try sending a smaller amount");
					pickNextCoin(amount - accumulated_amount);
				}
			);
		}
		
		function issueNextCoinIfAllowed(remaining_amount){
			return (!objAsset.issued_by_definer_only || arrAddresses.indexOf(objAsset.definer_address) >= 0) 
				? issueNextCoin(remaining_amount) 
				: onDone(NOT_ENOUGH_FUNDS_ERROR_MESSAGE);
		}
		
		function issueNextCoin(remaining_amount){
			console.log("issuing a new coin");
			if (remaining_amount <= 0)
				throw Error(`remaining amount is ${remaining_amount}`);
			const issuer_address = objAsset.issued_by_definer_only ? objAsset.definer_address : arrAddresses[0];
			const can_issue_condition = objAsset.cap ? "max_issued_serial_number=0" : "1";
			conn.query(
				`SELECT denomination, count_coins, max_issued_serial_number FROM asset_denominations \n\
                WHERE asset=? AND ${can_issue_condition} AND denomination<=? \n\
                ORDER BY denomination DESC LIMIT 1`, 
				[asset, remaining_amount+tolerance_plus], 
				rows => {
					if (rows.length === 0)
						return onDone(NOT_ENOUGH_FUNDS_ERROR_MESSAGE);
					const row = rows[0];
					if (!!row.count_coins !== !!objAsset.cap)
						throw Error("invalid asset cap and count_coins");
					const denomination = row.denomination;
					const serial_number = row.max_issued_serial_number+1;
					const count_coins_to_issue = row.count_coins || Math.floor((remaining_amount+tolerance_plus)/denomination);
					const issue_amount = count_coins_to_issue * denomination;
					conn.query(
						"UPDATE asset_denominations SET max_issued_serial_number=max_issued_serial_number+1 WHERE denomination=? AND asset=?", 
						[denomination, asset], 
						() => {
							const input = {
								type: 'issue',
								serial_number,
								amount: issue_amount
							};
							if (bMultiAuthored)
								input.address = issuer_address;
							let amount_to_use;
							let change_amount;
							if (issue_amount > remaining_amount + tolerance_plus){
								amount_to_use = Math.floor((remaining_amount + tolerance_plus)/denomination) * denomination;
								change_amount = issue_amount - amount_to_use;
							}
							else
								amount_to_use = issue_amount;
							const payload = {
								asset,
								denomination,
								inputs: [input],
								outputs: createOutputs(amount_to_use, change_amount)
							};
							const objPayloadWithProof = {payload, input_address: issuer_address};
							if (objAsset.is_private){
								const spend_proof = objectHash.getBase64Hash({
									asset,
									address: issuer_address,
									serial_number, // need to avoid duplicate spend proofs when issuing uncapped coins
									denomination,
									amount: input.amount
								});
								const objSpendProof = {
									spend_proof
								};
								if (bMultiAuthored)
									objSpendProof.address = issuer_address;
								objPayloadWithProof.spend_proof = objSpendProof;
							}
							arrPayloadsWithProofs.push(objPayloadWithProof);
							accumulated_amount += amount_to_use;
							console.log(`payloads with proofs: ${JSON.stringify(arrPayloadsWithProofs)}`);
							if (accumulated_amount >= amount - tolerance_minus && accumulated_amount <= amount + tolerance_plus)
								return onDone(null, arrPayloadsWithProofs);
							pickNextCoin(amount - accumulated_amount);
						}
					);
				}
			);
		}
				
		const arrSpendableAddresses = arrAddresses.concat(); // cloning
		if (objAsset && objAsset.auto_destroy){
			const i = arrAddresses.indexOf(objAsset.definer_address);
			if (i>=0)
				arrSpendableAddresses.splice(i, 1);
		}
		if (arrSpendableAddresses.length > 0)
			pickNextCoin(amount);
		else
			issueNextCoinIfAllowed(amount);
	});
}


/**
 * Randomize array element order in-place.
 * Using Durstenfeld shuffle algorithm.
 */
function shuffleArray(array) {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = array[i];
		array[i] = array[j];
		array[j] = temp;
	}
	return array;
}

// this function receives fully open payload
function buildPrivateElementsChain(conn, unit, message_index, output_index, payload, handlePrivateElements){
	const asset = payload.asset;
	const denomination = payload.denomination;
	const output = payload.outputs[output_index];
	const hidden_payload = _.cloneDeep(payload);
	hidden_payload.outputs.forEach(({address, blinding}) => {
		delete address;
		delete blinding;
		// output_hash was already added
	});
	const arrPrivateElements = [{
		unit,
		message_index,
		payload: hidden_payload,
		output_index,
		output: {
			address: output.address,
			blinding: output.blinding
		}
	}];
	
	function readPayloadAndGoUp(_unit, _message_index, _output_index){
		conn.query(
			"SELECT src_unit, src_message_index, src_output_index, serial_number, denomination, amount, address, asset, \n\
				(SELECT COUNT(*) FROM unit_authors WHERE unit=?) AS count_authors \n\
			FROM inputs WHERE unit=? AND message_index=?", 
			[_unit, _unit, _message_index],
			in_rows => {
				if (in_rows.length === 0)
					throw Error("building chain: blackbyte input not found");
				if (in_rows.length > 1)
					throw Error("building chain: more than 1 input found");
				const in_row = in_rows[0];
				if (!in_row.address)
					throw Error("readPayloadAndGoUp: input address is NULL");
				if (in_row.asset !== asset)
					throw Error("building chain: asset mismatch");
				if (in_row.denomination !== denomination)
					throw Error("building chain: denomination mismatch");
				const input = {};
				if (in_row.src_unit){ // transfer
					input.unit = in_row.src_unit;
					input.message_index = in_row.src_message_index;
					input.output_index = in_row.src_output_index;
				}
				else{
					input.type = 'issue';
					input.serial_number = in_row.serial_number;
					input.amount = in_row.amount;
					if (in_row.count_authors > 1)
						input.address = in_row.address;
				}
				conn.query(
					"SELECT address, blinding, output_hash, amount, output_index, asset, denomination FROM outputs \n\
					WHERE unit=? AND message_index=? ORDER BY output_index", 
					[_unit, _message_index], 
					out_rows => {
						if (out_rows.length === 0)
							throw Error("blackbyte output not found");
						const output = {};
						const outputs = out_rows.map(o => {
							if (o.asset !== asset)
								throw Error("outputs asset mismatch");
							if (o.denomination !== denomination)
								throw Error("outputs denomination mismatch");
							if (o.output_index === _output_index){
								output.address = o.address;
								output.blinding = o.blinding;
							}
							return {
								amount: o.amount,
								output_hash: o.output_hash
							};
						});
						if (!output.address)
							throw Error("output not filled");
						const objPrivateElement = {
							unit: _unit,
							message_index: _message_index,
							payload: {
								asset,
								denomination,
								inputs: [input],
								outputs
							},
							output_index: _output_index,
							output
						};
						arrPrivateElements.push(objPrivateElement);
						(input.type === 'issue') 
							? handlePrivateElements(arrPrivateElements)
							: readPayloadAndGoUp(input.unit, input.message_index, input.output_index);
					}
				);
			}
		);
	}
	
	const input = payload.inputs[0];
	(input.type === 'issue') 
		? handlePrivateElements(arrPrivateElements)
		: readPayloadAndGoUp(input.unit, input.message_index, input.output_index);
}

function composeIndivisibleAssetPaymentJoint(params){
	console.log(`indivisible payment from ${params.paying_addresses}`, params);
	if ((params.to_address || params.amount) && params.asset_outputs)
		throw Error("to_address and asset_outputs at the same time");
	if (params.asset_outputs){
		if (params.asset_outputs.length !== 1)
			throw Error("multiple indivisible asset outputs not supported");
		params.amount = params.asset_outputs[0].amount;
		params.to_address = params.asset_outputs[0].address;
	}
	if (!ValidationUtils.isNonemptyArray(params.fee_paying_addresses))
		throw Error('no fee_paying_addresses');
	composer.composeJoint({
		paying_addresses: _.union(params.paying_addresses, params.fee_paying_addresses), // addresses that pay for the transfer and commissions
		signing_addresses: params.signing_addresses,
		minimal: params.minimal,
		outputs: [{address: params.fee_paying_addresses[0], amount: 0}], // public outputs in bytes: the change only
		
		// function that creates additional messages to be added to the joint
		retrieveMessages: function createAdditionalMessages(conn, last_ball_mci, bMultiAuthored, arrPayingAddresses, onDone){
			const arrAssetPayingAddresses = _.intersection(arrPayingAddresses, params.paying_addresses);
			storage.loadAssetWithListOfAttestedAuthors(conn, params.asset, last_ball_mci, arrAssetPayingAddresses, (err, objAsset) => {
				if (err)
					return onDone(err);
				if (!objAsset.fixed_denominations)
					return onDone("divisible asset type");
				if (!objAsset.is_transferrable && params.to_address !== objAsset.definer_address && arrAssetPayingAddresses.indexOf(objAsset.definer_address) === -1)
					return onDone("the asset is not transferrable and definer not found on either side of the deal");
				if (objAsset.cosigned_by_definer && arrPayingAddresses.concat(params.signing_addresses || []).indexOf(objAsset.definer_address) === -1)
					return onDone("the asset must be cosigned by definer");
				if (objAsset.spender_attested && objAsset.arrAttestedAddresses.length === 0)
					return onDone("none of the authors is attested");
				
				pickIndivisibleCoinsForAmount(
					conn, objAsset, arrAssetPayingAddresses, last_ball_mci, 
					params.to_address, params.change_address,
					params.amount, params.tolerance_plus || 0, params.tolerance_minus || 0, 
					bMultiAuthored, 
					(err, arrPayloadsWithProofs) => {
						if (!arrPayloadsWithProofs)
							return onDone({
								error_code: "NOT_ENOUGH_FUNDS", 
								error: err
							});
						const arrMessages = [];
						const assocPrivatePayloads = {};
						for (let i=0; i<arrPayloadsWithProofs.length; i++){
							const payload = arrPayloadsWithProofs[i].payload;
							let payload_hash;// = objectHash.getBase64Hash(payload);
							if (objAsset.is_private){
								payload.outputs.forEach(o => {
									o.output_hash = objectHash.getBase64Hash({address: o.address, blinding: o.blinding});
								});
								const hidden_payload = _.cloneDeep(payload);
								hidden_payload.outputs.forEach(({address, blinding}) => {
									delete address;
									delete blinding;
								});
								payload_hash = objectHash.getBase64Hash(hidden_payload);
							}
							else
								payload_hash = objectHash.getBase64Hash(payload);
							const objMessage = {
								app: "payment",
								payload_location: objAsset.is_private ? "none" : "inline",
								payload_hash
							};
							if (objAsset.is_private){
								assocPrivatePayloads[payload_hash] = payload;
								objMessage.spend_proofs = [arrPayloadsWithProofs[i].spend_proof];
							}
							else
								objMessage.payload = payload;
							arrMessages.push(objMessage);
						}
						// messages are sorted in descending order by denomination of the coin, so shuffle them to avoid giving any clues
						shuffleArray(arrMessages);
						console.log(`composed messages ${JSON.stringify(arrMessages)}`);
						onDone(null, arrMessages, assocPrivatePayloads);
					}
				);
			});
		},
		
		signer: params.signer, 
		
		callbacks: {
			ifError: params.callbacks.ifError,
			ifNotEnoughFunds: params.callbacks.ifNotEnoughFunds,
			ifOk(objJoint, assocPrivatePayloads, composer_unlock_callback) {
				params.callbacks.ifOk(objJoint, assocPrivatePayloads, composer_unlock_callback);
			}
		}
	});
}

// ifOk validates and saves before calling back
function getSavingCallbacks(to_address, callbacks){
	return {
		ifError: callbacks.ifError,
		ifNotEnoughFunds: callbacks.ifNotEnoughFunds,
		ifOk(objJoint, assocPrivatePayloads, composer_unlock) {
			const objUnit = objJoint.unit;
			const unit = objUnit.unit;
			validation.validate(objJoint, {
				ifUnitError(err) {
					composer_unlock();
					callbacks.ifError(`Validation error: ${err}`);
				//	throw Error("unexpected validation error: "+err);
				},
				ifJointError(err) {
					throw Error(`unexpected validation joint error: ${err}`);
				},
				ifTransientError(err) {
					throw Error(`unexpected validation transient error: ${err}`);
				},
				ifNeedHashTree() {
					throw Error("unexpected need hash tree");
				},
				ifNeedParentUnits(arrMissingUnits) {
					throw Error(`unexpected dependencies: ${arrMissingUnits.join(", ")}`);
				},
				ifOk(objValidationState, validation_unlock) {
					console.log(`Private OK ${objValidationState.sequence}`);
					if (objValidationState.sequence !== 'good'){
						validation_unlock();
						composer_unlock();
						return callbacks.ifError(`Indivisible asset bad sequence ${objValidationState.sequence}`);
					}
					const bPrivate = !!assocPrivatePayloads;
					const arrRecipientChains = bPrivate ? [] : null; // chains for to_address
					const arrCosignerChains = bPrivate ? [] : null; // chains for all output addresses, including change, to be shared with cosigners (if any)
					let preCommitCallback = null;
					let bPreCommitCallbackFailed = false;
					
					if (bPrivate){
						preCommitCallback = (conn, cb) => {
							async.eachSeries(
								Object.keys(assocPrivatePayloads),
								(payload_hash, cb2) => {
									const message_index = composer.getMessageIndexByPayloadHash(objUnit, payload_hash);
									const payload = assocPrivatePayloads[payload_hash];
									// We build, validate, and save two chains: one for the payee, the other for oneself (the change).
									// They differ only in the last element
									async.forEachOfSeries(
										payload.outputs,
										({address}, output_index, cb3) => {
											// we have only heads of the chains so far. Now add the tails.
											buildPrivateElementsChain(
												conn, unit, message_index, output_index, payload, 
												arrPrivateElements => {
													validateAndSavePrivatePaymentChain(conn, _.cloneDeep(arrPrivateElements), {
														ifError(err) {
															cb3(err);
														},
														ifOk() {
															if (address === to_address)
																arrRecipientChains.push(arrPrivateElements);
															arrCosignerChains.push(arrPrivateElements);
															cb3();
														}
													});
												}
											);
										},
										cb2
									);
								},
								err => {
									if (err){
										console.log(`===== error in precommit callback: ${err}`);
										bPreCommitCallbackFailed = true;
										return cb(err);
									}
									const onSuccessfulPrecommit = !conf.bLight ? cb : () => {
										composer.postJointToLightVendorIfNecessaryAndSave(
											objJoint, 
											function onLightError(err){ // light only
												console.log(`failed to post indivisible payment ${unit}`);
												bPreCommitCallbackFailed = true;
												cb(err); // will rollback
											},
											function save(){ // not actually saving yet but greenlighting the commit
												cb();
											}
										);
									};
									if (!callbacks.preCommitCb)
										return onSuccessfulPrecommit();
									callbacks.preCommitCb(conn, arrRecipientChains, arrCosignerChains, onSuccessfulPrecommit);
								}
							);
						};
					} else {
						if (typeof callbacks.preCommitCb === "function") {
							preCommitCallback = (conn, cb) => {
								callbacks.preCommitCb(conn, objJoint, cb);
							}
						}
					}
					
					const saveAndUnlock = () => {
						writer.saveJoint(
							objJoint, objValidationState, 
							preCommitCallback,
							function onDone(err){
								console.log(`saved unit ${unit}`);
								validation_unlock();
								composer_unlock();
								if (bPreCommitCallbackFailed)
									callbacks.ifError(`precommit callback failed: ${err}`);
								else
									callbacks.ifOk(objJoint, arrRecipientChains, arrCosignerChains);
							}
						);
					};
					
					// if light and private, we'll post the joint later, in precommit 
					// (saving private payloads can take quite some time and the app can be killed before saving them to its local database, 
					// we should not broadcast the joint earlier)
					if (bPrivate || !conf.bLight)
						return saveAndUnlock();
					composer.postJointToLightVendorIfNecessaryAndSave(
						objJoint, 
						function onLightError(err){ // light only
							console.log(`failed to post indivisible payment ${unit}`);
							validation_unlock();
							composer_unlock();
							callbacks.ifError(err);
						},
						saveAndUnlock
					);
				} // ifOk validation
			}); // validate
		} // ifOk compose
	};
}

function restorePrivateChains(asset, unit, to_address, handleChains){
	const arrRecipientChains = [];
	const arrCosignerChains = [];
	db.query(
		"SELECT DISTINCT message_index, denomination, payload_hash FROM outputs JOIN messages USING(unit, message_index) WHERE unit=? AND asset=?", 
		[unit, asset], 
		rows => {
			async.eachSeries(
				rows,
				(row, cb) => {
					const payload = {asset, denomination: row.denomination};
					const message_index = row.message_index;
					db.query(
						"SELECT src_unit, src_message_index, src_output_index, denomination, asset FROM inputs WHERE unit=? AND message_index=?", 
						[unit, message_index],
						input_rows => {
							if (input_rows.length !== 1)
								throw Error("not 1 input");
							const input_row = input_rows[0];
							if (input_row.asset !== asset)
								throw Error("assets don't match");
							if (input_row.denomination !== row.denomination)
								throw Error("denominations don't match");
							if (input_row.src_message_index === null || input_row.src_output_index === null)
								throw Error("only transfers supported");
							const input = {
								unit: input_row.src_unit,
								message_index: input_row.src_message_index,
								output_index: input_row.src_output_index
							};
							payload.inputs = [input];
							db.query(
								"SELECT address, amount, blinding, output_hash FROM outputs \n\
								WHERE unit=? AND asset=? AND message_index=? ORDER BY output_index", 
								[unit, asset, message_index],
								outputs => {
									if (outputs.length === 0)
										throw Error(`outputs not found for mi ${message_index}`);
									if (!outputs.some(({address, blinding}) => address && blinding))
										throw Error("all outputs are hidden");
									payload.outputs = outputs;
									const hidden_payload = _.cloneDeep(payload);
									hidden_payload.outputs.forEach(({address, blinding}) => {
										delete address;
										delete blinding;
									});
									const payload_hash = objectHash.getBase64Hash(hidden_payload);
									if (payload_hash !== row.payload_hash)
										throw Error("wrong payload hash");
									async.forEachOfSeries(
										payload.outputs,
										({address, blinding}, output_index, cb3) => {
											if (!address || !blinding) // skip
												return cb3();
											// we have only heads of the chains so far. Now add the tails.
											buildPrivateElementsChain(
												db, unit, message_index, output_index, payload, 
												arrPrivateElements => {
													if (address === to_address)
														arrRecipientChains.push(arrPrivateElements);
													arrCosignerChains.push(arrPrivateElements);
													cb3();
												}
											);
										},
										cb
									);
								}
							);
						}
					);
				},
				() => {
					handleChains(arrRecipientChains, arrCosignerChains);
				}
			);
		}
	);
}

// {asset: asset, paying_addresses: arrPayingAddresses, fee_paying_addresses: arrFeePayingAddresses, to_address: to_address, change_address: change_address, amount: amount, tolerance_plus: tolerance_plus, tolerance_minus: tolerance_minus, signer: signer, callbacks: callbacks}
function composeAndSaveIndivisibleAssetPaymentJoint(params){
	const params_with_save = _.clone(params);
	params_with_save.callbacks = getSavingCallbacks(getToAddress(params), params.callbacks);
	composeIndivisibleAssetPaymentJoint(params_with_save);
}

function readAddressesFundedInAsset(asset, amount, arrAvailablePayingAddresses, handleFundedAddresses){
	let remaining_amount = amount;
	const assocAddresses = {};
	db.query(
		"SELECT amount, denomination, address FROM outputs CROSS JOIN units USING(unit) \n\
		WHERE is_spent=0 AND address IN(?) AND is_stable=1 AND sequence='good' AND asset=? \n\
			AND NOT EXISTS ( \n\
				SELECT * FROM unit_authors JOIN units USING(unit) \n\
				WHERE is_stable=0 AND unit_authors.address=outputs.address AND definition_chash IS NOT NULL \n\
			) \n\
		ORDER BY denomination DESC, amount DESC",
		[arrAvailablePayingAddresses, asset],
		rows => {
			for (let i=0; i<rows.length; i++){
				const row = rows[i];
				if (row.denomination > remaining_amount)
					continue;
				assocAddresses[row.address] = true;
				const used_amount = (row.amount <= remaining_amount) ? row.amount : row.denomination * Math.floor(remaining_amount/row.denomination);
				remaining_amount -= used_amount;
				if (remaining_amount === 0)
					break;
			};
			const arrAddresses = Object.keys(assocAddresses);
			handleFundedAddresses(arrAddresses);
		}
	);
}

const TYPICAL_FEE = 3000;

// reads addresses funded in asset plus addresses for paying commissions
function readFundedAddresses(asset, amount, arrAvailablePayingAddresses, arrAvailableFeePayingAddresses, handleFundedAddresses){
	readAddressesFundedInAsset(asset, amount, arrAvailablePayingAddresses, arrAddressesFundedInAsset => {
		// add other addresses to pay for commissions (in case arrAddressesFundedInAsset don't have enough bytes to pay commissions)
	//	var arrOtherAddresses = _.difference(arrAvailablePayingAddresses, arrAddressesFundedInAsset);
	//	if (arrOtherAddresses.length === 0)
	//		return handleFundedAddresses(arrAddressesFundedInAsset);
		composer.readSortedFundedAddresses(null, arrAvailableFeePayingAddresses, TYPICAL_FEE, arrFundedFeePayingAddresses => {
		//	if (arrFundedOtherAddresses.length === 0)
		//		return handleFundedAddresses(arrAddressesFundedInAsset);
		//	handleFundedAddresses(arrAddressesFundedInAsset.concat(arrFundedOtherAddresses));
			handleFundedAddresses(arrAddressesFundedInAsset, arrFundedFeePayingAddresses);
		});
	});
}

// {asset: asset, available_paying_addresses: arrAvailablePayingAddresses, available_fee_paying_addresses: arrAvailableFeePayingAddresses, to_address: to_address, change_address: change_address, amount: amount, tolerance_plus: tolerance_plus, tolerance_minus: tolerance_minus, signer: signer, callbacks: callbacks}
function composeMinimalIndivisibleAssetPaymentJoint(params){
	if (!ValidationUtils.isNonemptyArray(params.available_paying_addresses))
		throw Error('no available_paying_addresses');
	if (!ValidationUtils.isNonemptyArray(params.available_fee_paying_addresses))
		throw Error('no available_fee_paying_addresses');
	readFundedAddresses(
		params.asset, params.amount, params.available_paying_addresses, params.available_fee_paying_addresses, 
		(arrFundedPayingAddresses, arrFundedFeePayingAddresses) => {
			if (arrFundedPayingAddresses.length === 0)
				return params.callbacks.ifNotEnoughFunds("all paying addresses are unfunded in asset, make sure all your funds are confirmed");
			const minimal_params = _.clone(params);
			delete minimal_params.available_paying_addresses;
			delete minimal_params.available_fee_paying_addresses;
			minimal_params.minimal = true;
			minimal_params.paying_addresses = arrFundedPayingAddresses;
			minimal_params.fee_paying_addresses = arrFundedFeePayingAddresses;
			composeIndivisibleAssetPaymentJoint(minimal_params);
		}
	);
}

// {asset: asset, available_paying_addresses: arrAvailablePayingAddresses, available_fee_paying_addresses: arrAvailableFeePayingAddresses, to_address: to_address, amount: amount, tolerance_plus: tolerance_plus, tolerance_minus: tolerance_minus, signer: signer, callbacks: callbacks}
function composeAndSaveMinimalIndivisibleAssetPaymentJoint(params){
	const params_with_save = _.clone(params);
	params_with_save.callbacks = getSavingCallbacks(getToAddress(params), params.callbacks);
	composeMinimalIndivisibleAssetPaymentJoint(params_with_save);
}

function getToAddress({to_address, asset_outputs}) {
	if (to_address)
		return to_address;
	if (asset_outputs)
		return asset_outputs[0].address;
	throw Error("unable to determine to_address");
}


exports.getSavingCallbacks = getSavingCallbacks;
exports.validateAndSavePrivatePaymentChain = validateAndSavePrivatePaymentChain;
exports.restorePrivateChains = restorePrivateChains;
exports.composeAndSaveIndivisibleAssetPaymentJoint = composeAndSaveIndivisibleAssetPaymentJoint;
exports.composeAndSaveMinimalIndivisibleAssetPaymentJoint = composeAndSaveMinimalIndivisibleAssetPaymentJoint;
exports.updateIndivisibleOutputsThatWereReceivedUnstable = updateIndivisibleOutputsThatWereReceivedUnstable;

