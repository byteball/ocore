/*jslint node: true */
"use strict";
var db = require('./db.js');
var conf = require('./conf.js');
var constants = require('./constants.js');
var storage = require('./storage.js');
var ValidationUtils = require("./validation_utils.js");

function readMyWitnesses(handleWitnesses, actionIfEmpty){
	db.query("SELECT address FROM my_witnesses ORDER BY address", function(rows){
		if (rows.length === 0){
			if (actionIfEmpty === 'ignore')
				return handleWitnesses([]);
			if (actionIfEmpty === 'wait'){
				console.log('no witnesses yet, will retry later');
				setTimeout(function(){
					readMyWitnesses(handleWitnesses, actionIfEmpty);
				}, 1000);
				return;
			}
		}
		if (rows.length !== constants.COUNT_WITNESSES)
			throw Error("wrong number of my witnesses: "+rows.length);
		var arrWitnesses = rows.map(function(row){ return row.address; });
		handleWitnesses(arrWitnesses);
	});
}

// replaces old_witness with new_witness
function replaceWitness(old_witness, new_witness, handleResult){
	if (!ValidationUtils.isValidAddress(new_witness))
		return handleResult("new witness address is invalid");
	readMyWitnesses(function(arrWitnesses){
		if (arrWitnesses.indexOf(old_witness) === -1)
			return handleResult("old witness not known");
		if (arrWitnesses.indexOf(new_witness) >= 0)
			return handleResult("new witness already present");
		var doReplace = function(){
			db.query("UPDATE my_witnesses SET address=? WHERE address=?", [new_witness, old_witness], function(){
				handleResult();
			});
		};
		if (conf.bLight) // absent the full database, there is nothing else to check
			return doReplace();
		db.query(
			"SELECT 1 FROM unit_authors JOIN units USING(unit) WHERE address=? AND sequence='good' AND is_stable=1 LIMIT 1", 
			[new_witness], 
			function(rows){
				if (rows.length === 0)
					return handleResult("no stable messages from the new witness yet");
				storage.determineIfWitnessAddressDefinitionsHaveReferences(db, [new_witness], function(bHasReferences){
					if (bHasReferences)
						return handleResult("address definition of the new witness has or had references");
					doReplace();
				});
			}
		);
	});
}

function insertWitnesses(arrWitnesses, onDone){
	if (arrWitnesses.length !== constants.COUNT_WITNESSES)
		throw Error("attempting to insert wrong number of witnesses: "+arrWitnesses.length);
	var placeholders = Array.apply(null, Array(arrWitnesses.length)).map(function(){ return '(?)'; }).join(',');
	console.log('will insert witnesses', arrWitnesses);
	db.query("INSERT INTO my_witnesses (address) VALUES "+placeholders, arrWitnesses, function(){
		console.log('inserted witnesses', arrWitnesses);
		if (onDone)
			onDone();
	});
}

exports.readMyWitnesses = readMyWitnesses;
exports.replaceWitness = replaceWitness;
exports.insertWitnesses = insertWitnesses;
