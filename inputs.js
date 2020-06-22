/*jslint node: true */
"use strict";
var async = require('async');
var objectHash = require("./object_hash.js");
var constants = require("./constants.js");
var paid_witnessing = require("./paid_witnessing.js");
var headers_commission = require("./headers_commission.js");
var mc_outputs = require("./mc_outputs.js");

var TRANSFER_INPUT_SIZE = 0 // type: "transfer" omitted
	+ 44 // unit
	+ 8 // message_index
	+ 8; // output_index

var HEADERS_COMMISSION_INPUT_SIZE = 18 // type: "headers_commission"
	+ 8 // from_main_chain_index
	+ 8; // to_main_chain_index

var WITNESSING_INPUT_SIZE = 10 // type: "witnessing"
	+ 8 // from_main_chain_index
	+ 8; // to_main_chain_index

var ADDRESS_SIZE = 32;

// bMultiAuthored includes all addresses, not just those that pay
// arrAddresses is paying addresses
// spend_unconfirmed is one of: none, all, own
function pickDivisibleCoinsForAmount(conn, objAsset, arrAddresses, last_ball_mci, amount, bMultiAuthored, spend_unconfirmed, onDone){
	var asset = objAsset ? objAsset.asset : null;
	console.log("pick coins in "+asset+" for amount "+amount+" with spend_unconfirmed "+spend_unconfirmed);
	var is_base = objAsset ? 0 : 1;
	var arrInputsWithProofs = [];
	var total_amount = 0;
	var required_amount = amount;
	
	if (!(typeof last_ball_mci === 'number' && last_ball_mci >= 0))
		throw Error("invalid last_ball_mci: "+last_ball_mci);
	var confirmation_condition;
	if (spend_unconfirmed === 'none')
		confirmation_condition = 'AND main_chain_index<='+last_ball_mci;
	else if (spend_unconfirmed === 'all')
		confirmation_condition = '';
	else if (spend_unconfirmed === 'own')
		confirmation_condition = 'AND ( main_chain_index<='+last_ball_mci+' OR EXISTS ( \n\
			SELECT 1 FROM unit_authors CROSS JOIN my_addresses USING(address) WHERE unit_authors.unit=outputs.unit \n\
			UNION \n\
			SELECT 1 FROM unit_authors CROSS JOIN shared_addresses ON address=shared_address WHERE unit_authors.unit=outputs.unit \n\
			UNION \n\
			SELECT 1 FROM unit_authors WHERE unit_authors.unit=outputs.unit AND unit_authors.address IN(' + arrAddresses.map(db.escape).join(', ') + ')\n\
		) )';
	else
		throw Error("invalid spend_unconfirmed="+spend_unconfirmed);

	// adds element to arrInputsWithProofs
	function addInput(input){
		total_amount += input.amount;
		var objInputWithProof = {input: input};
		if (objAsset && objAsset.is_private){ // for type=payment only
			var spend_proof = objectHash.getBase64Hash({
				asset: asset,
				amount: input.amount,
				address: input.address,
				unit: input.unit,
				message_index: input.message_index,
				output_index: input.output_index,
				blinding: input.blinding
			});
			var objSpendProof = {spend_proof: spend_proof};
			if (bMultiAuthored)
				objSpendProof.address = input.address;
			objInputWithProof.spend_proof = objSpendProof;
		}
		if (!bMultiAuthored || !input.type)
			delete input.address;
		delete input.amount;
		delete input.blinding;
		arrInputsWithProofs.push(objInputWithProof);
	}

	// first, try to find a coin just bigger than the required amount
	function pickOneCoinJustBiggerAndContinue(){
		if (amount === Infinity)
			return pickMultipleCoinsAndContinue();
		var more = is_base ? '>' : '>=';
		conn.query(
			"SELECT unit, message_index, output_index, amount, blinding, address \n\
			FROM outputs \n\
			CROSS JOIN units USING(unit) \n\
			WHERE address IN(?) AND asset"+(asset ? "="+conn.escape(asset) : " IS NULL")+" AND is_spent=0 AND amount "+more+" ? \n\
				AND sequence='good' "+confirmation_condition+" \n\
			ORDER BY is_stable DESC, amount LIMIT 1",
			[arrSpendableAddresses, amount+is_base*TRANSFER_INPUT_SIZE],
			function(rows){
				if (rows.length === 1){
					var input = rows[0];
					// default type is "transfer"
					addInput(input);
					onDone(arrInputsWithProofs, total_amount);
				}
				else
					pickMultipleCoinsAndContinue();
			}
		);
	}

	// then, try to add smaller coins until we accumulate the target amount
	function pickMultipleCoinsAndContinue(){
		conn.query(
			"SELECT unit, message_index, output_index, amount, address, blinding \n\
			FROM outputs \n\
			CROSS JOIN units USING(unit) \n\
			WHERE address IN(?) AND asset"+(asset ? "="+conn.escape(asset) : " IS NULL")+" AND is_spent=0 \n\
				AND sequence='good' "+confirmation_condition+"  \n\
			ORDER BY amount DESC LIMIT ?",
			[arrSpendableAddresses, constants.MAX_INPUTS_PER_PAYMENT_MESSAGE-2],
			function(rows){
				async.eachSeries(
					rows,
					function(row, cb){
						var input = row;
						objectHash.cleanNulls(input);
						required_amount += is_base*TRANSFER_INPUT_SIZE;
						addInput(input);
						// if we allow equality, we might get 0 amount for change which is invalid
						var bFound = is_base ? (total_amount > required_amount) : (total_amount >= required_amount);
						bFound ? cb('found') : cb();
					},
					function(err){
						if (err === 'found')
							onDone(arrInputsWithProofs, total_amount);
						else if (asset)
							issueAsset();
						else
							addHeadersCommissionInputs();
					}
				);
			}
		);
	}

	function addHeadersCommissionInputs(){
		addMcInputs("headers_commission", HEADERS_COMMISSION_INPUT_SIZE,
			headers_commission.getMaxSpendableMciForLastBallMci(last_ball_mci), addWitnessingInputs);
	}

	function addWitnessingInputs(){
		addMcInputs("witnessing", WITNESSING_INPUT_SIZE, paid_witnessing.getMaxSpendableMciForLastBallMci(last_ball_mci), issueAsset);
	}

	function addMcInputs(type, input_size, max_mci, onStillNotEnough){
		async.eachSeries(
			arrAddresses,
			function(address, cb){
				var target_amount = required_amount + input_size + (bMultiAuthored ? ADDRESS_SIZE : 0) - total_amount;
				mc_outputs.findMcIndexIntervalToTargetAmount(conn, type, address, max_mci, target_amount, {
					ifNothing: cb,
					ifFound: function(from_mc_index, to_mc_index, earnings, bSufficient){
						if (earnings === 0)
							throw Error("earnings === 0");
						total_amount += earnings;
						var input = {
							type: type,
							from_main_chain_index: from_mc_index,
							to_main_chain_index: to_mc_index
						};
						var full_input_size = input_size;
						if (bMultiAuthored){
							full_input_size += ADDRESS_SIZE; // address length
							input.address = address;
						}
						required_amount += full_input_size;
						arrInputsWithProofs.push({input: input});
						(total_amount > required_amount)
							? cb("found") // break eachSeries
							: cb(); // try next address
					}
				});
			},
			function(err){
				if (!err)
					console.log(arrAddresses+" "+type+": got only "+total_amount+" out of required "+required_amount);
				(err === "found") ? onDone(arrInputsWithProofs, total_amount) : onStillNotEnough();
			}
		);
	}

	function issueAsset(){
		if (!asset)
			return finish();
		else{
			if (amount === Infinity && !objAsset.cap) // don't try to create infinite issue
				return onDone(null);
		}
		console.log("will try to issue asset "+asset);
		// for issue, we use full list of addresses rather than spendable addresses
		if (objAsset.issued_by_definer_only && arrAddresses.indexOf(objAsset.definer_address) === -1)
			return finish();
		var issuer_address = objAsset.issued_by_definer_only ? objAsset.definer_address : arrAddresses[0];
		var issue_amount = objAsset.cap || (required_amount - total_amount) || 1; // 1 currency unit in case required_amount = total_amount

		function addIssueInput(serial_number){
			total_amount += issue_amount;
			var input = {
				type: "issue",
				amount: issue_amount,
				serial_number: serial_number
			};
			if (bMultiAuthored)
				input.address = issuer_address;
			var objInputWithProof = {input: input};
			if (objAsset && objAsset.is_private){
				var spend_proof = objectHash.getBase64Hash({
					asset: asset,
					amount: issue_amount,
					denomination: 1,
					address: issuer_address,
					serial_number: serial_number
				});
				var objSpendProof = {spend_proof: spend_proof};
				if (bMultiAuthored)
					objSpendProof.address = input.address;
				objInputWithProof.spend_proof = objSpendProof;
			}
			arrInputsWithProofs.unshift(objInputWithProof);
			var bFound = is_base ? (total_amount > required_amount) : (total_amount >= required_amount);
			bFound ? onDone(arrInputsWithProofs, total_amount) : finish();
		}

		if (objAsset.cap){
			conn.query("SELECT 1 FROM inputs WHERE type='issue' AND asset=?", [asset], function(rows){
				if (rows.length > 0) // already issued
					return finish();
				addIssueInput(1);
			});
		}
		else{
			conn.query(
				"SELECT MAX(serial_number) AS max_serial_number FROM inputs WHERE type='issue' AND asset=? AND address=?",
				[asset, issuer_address],
				function(rows){
					var max_serial_number = (rows.length === 0) ? 0 : rows[0].max_serial_number;
					addIssueInput(max_serial_number+1);
				}
			);
		}
	}

	function finish(){
		if (amount === Infinity && arrInputsWithProofs.length > 0)
			onDone(arrInputsWithProofs, total_amount);
		else
			onDone(null);
	}

	var arrSpendableAddresses = arrAddresses.concat(); // cloning
	if (objAsset && objAsset.auto_destroy){
		var i = arrAddresses.indexOf(objAsset.definer_address);
		if (i>=0)
			arrSpendableAddresses.splice(i, 1);
	}
	if (arrSpendableAddresses.length > 0)
		pickOneCoinJustBiggerAndContinue();
	else
		issueAsset();
}

function getConfirmationConditionSql(spend_unconfirmed){
	if (spend_unconfirmed === 'none')
		return 'AND is_stable=1';
	else if (spend_unconfirmed === 'all')
		return '';
	else if (spend_unconfirmed === 'own')
		return 'AND ( is_stable=1 OR EXISTS ( \n\
			SELECT 1 FROM unit_authors CROSS JOIN my_addresses USING(address) WHERE unit_authors.unit=outputs.unit \n\
			UNION \n\
			SELECT 1 FROM unit_authors CROSS JOIN shared_addresses ON address=shared_address WHERE unit_authors.unit=outputs.unit \n\
		) )';
	else
		throw Error("invalid spend_unconfirmed="+spend_unconfirmed);

}

exports.pickDivisibleCoinsForAmount = pickDivisibleCoinsForAmount;
exports.getConfirmationConditionSql = getConfirmationConditionSql;
