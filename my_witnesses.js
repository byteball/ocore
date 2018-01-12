/*jslint node: true */
const db = require('./db.js');
const conf = require('./conf.js');
const constants = require('./constants.js');
const storage = require('./storage.js');
const ValidationUtils = require("./validation_utils.js");

function readMyWitnesses(handleWitnesses, actionIfEmpty){
	db.query("SELECT address FROM my_witnesses ORDER BY address", rows => {
		let arrWitnesses = rows.map(({address}) => address);
		// reset witness list if old witnesses found
		if (constants.alt === '2' && arrWitnesses.indexOf('5K7CSLTRPC5LFLOS3D34GBHG7RFD4TPO') >= 0
			|| constants.version === '1.0' && arrWitnesses.indexOf('2FF7PSL7FYXVU5UIQHCVDTTPUOOG75GX') >= 0
		){
			console.log('deleting old witnesses');
			db.query("DELETE FROM my_witnesses");
			arrWitnesses = [];
		}
		if (arrWitnesses.length === 0){
			if (actionIfEmpty === 'ignore')
				return handleWitnesses([]);
			if (actionIfEmpty === 'wait'){
				console.log('no witnesses yet, will retry later');
				setTimeout(() => {
					readMyWitnesses(handleWitnesses, actionIfEmpty);
				}, 1000);
				return;
			}
		}
		if (arrWitnesses.length !== constants.COUNT_WITNESSES)
			throw Error(`wrong number of my witnesses: ${arrWitnesses.length}`);
		handleWitnesses(arrWitnesses);
	});
}

// replaces old_witness with new_witness
function replaceWitness(old_witness, new_witness, handleResult){
	if (!ValidationUtils.isValidAddress(new_witness))
		return handleResult("new witness address is invalid");
	readMyWitnesses(arrWitnesses => {
		if (arrWitnesses.indexOf(old_witness) === -1)
			return handleResult("old witness not known");
		if (arrWitnesses.indexOf(new_witness) >= 0)
			return handleResult("new witness already present");
		const doReplace = () => {
			db.query("UPDATE my_witnesses SET address=? WHERE address=?", [new_witness, old_witness], () => {
				handleResult();
			});
		};
		if (conf.bLight) // absent the full database, there is nothing else to check
			return doReplace();
		db.query(
			"SELECT 1 FROM unit_authors CROSS JOIN units USING(unit) WHERE address=? AND sequence='good' AND is_stable=1 LIMIT 1", 
			[new_witness], 
			({length}) => {
				if (length === 0)
					return handleResult("no stable messages from the new witness yet");
				storage.determineIfWitnessAddressDefinitionsHaveReferences(db, [new_witness], bHasReferences => {
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
		throw Error(`attempting to insert wrong number of witnesses: ${arrWitnesses.length}`);
	const placeholders = Array(...Array(arrWitnesses.length)).map(() => '(?)').join(',');
	console.log('will insert witnesses', arrWitnesses);
	db.query(`INSERT INTO my_witnesses (address) VALUES ${placeholders}`, arrWitnesses, () => {
		console.log('inserted witnesses');
		if (onDone)
			onDone();
	});
}

exports.readMyWitnesses = readMyWitnesses;
exports.replaceWitness = replaceWitness;
exports.insertWitnesses = insertWitnesses;
