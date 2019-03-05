/*jslint node: true */
"use strict";
var async = require('async');
var constants = require('./constants.js');
var conf = require('./conf.js');
var objectHash = require('./object_hash.js');
var ValidationUtils = require('./validation_utils.js');
var eventBus = require('./event_bus.js');
var db = require('./db.js');
var storage = require('./storage.js');

/*
returns objPrivateProfile {
	unit: "...", // attestation unit
	payload_hash: "...", // pointer to attestation payload in this unit
	src_profile: object // attested fields
}
*/
function getPrivateProfileFromJsonBase64(privateProfileJsonBase64){
	var privateProfileJson = Buffer(privateProfileJsonBase64, 'base64').toString('utf8');
	console.log(privateProfileJson);
	try{
		var objPrivateProfile = JSON.parse(privateProfileJson);
	}
	catch(e){
		return null;
	}
	if (!ValidationUtils.isStringOfLength(objPrivateProfile.unit, constants.HASH_LENGTH) || !ValidationUtils.isStringOfLength(objPrivateProfile.payload_hash, constants.HASH_LENGTH) || typeof objPrivateProfile.src_profile !== 'object')
		return null;
	return objPrivateProfile;
}

function parseAndValidatePrivateProfile(objPrivateProfile, onDone){
	function handleJoint(objJoint){
		var attestor_address = objJoint.unit.authors[0].address;
		var payload;
		objJoint.unit.messages.forEach(function(message){
			if (message.app !== 'attestation' || message.payload_hash !== objPrivateProfile.payload_hash)
				return;
			payload = message.payload;
		});
		if (!payload)
			return onDone("no such payload hash in this unit");
		var hidden_profile = {};
		var bHasHiddenFields = false;
		for (var field in objPrivateProfile.src_profile){
			var value = objPrivateProfile.src_profile[field];
			// the value of each field is either array [plain_text_value, blinding] (if the field is disclosed) or a hash (if it is not disclosed)
			if (ValidationUtils.isArrayOfLength(value, 2))
				hidden_profile[field] = objectHash.getBase64Hash(value);
			else if (ValidationUtils.isStringOfLength(value, constants.HASH_LENGTH)){
				hidden_profile[field] = value;
				bHasHiddenFields = true;
			}
			else
				return onDone("invalid src profile");
		}
		if (objectHash.getBase64Hash(hidden_profile) !== payload.profile.profile_hash)
			return onDone("wrong profile hash");
		db.query(
			"SELECT 1 FROM my_addresses WHERE address=? UNION SELECT 1 FROM shared_addresses WHERE shared_address=?", 
			[payload.address, payload.address],
			function(rows){
				var bMyAddress = (rows.length > 0);
				if (bMyAddress && bHasHiddenFields){
					console.log("profile of my address but has hidden fields");
					bMyAddress = false;
				}
				onDone(null, payload.address, attestor_address, bMyAddress);
			}
		);
	}
	storage.readJoint(db, objPrivateProfile.unit, {
		ifNotFound: function(){
			eventBus.once('saved_unit-'+objPrivateProfile.unit, handleJoint);
			var network = require('./network.js');
			if (conf.bLight)
				network.requestHistoryFor([objPrivateProfile.unit], []);
		},
		ifFound: handleJoint
	});
}

// removes blinding and returns object {first_name: "First", last_name: "Last", ...}
function parseSrcProfile(src_profile){
	var assocPrivateData = {};
	for (var field in src_profile){
		var arrValueAndBlinding = src_profile[field];
		if (ValidationUtils.isArrayOfLength(arrValueAndBlinding, 2)) // otherwise it is a hash, meaning that the field was not disclosed
			assocPrivateData[field] = arrValueAndBlinding[0];
	}
	return assocPrivateData;
}

// the profile can be mine or peer's
function savePrivateProfile(objPrivateProfile, address, attestor_address, onDone){
	db.query(
		"INSERT "+db.getIgnore()+" INTO private_profiles (unit, payload_hash, attestor_address, address, src_profile) VALUES(?,?,?,?,?)", 
		[objPrivateProfile.unit, objPrivateProfile.payload_hash, attestor_address, address, JSON.stringify(objPrivateProfile.src_profile)], 
		function(res){
			var private_profile_id = res.insertId;
			var src_profile = {};
			if (!private_profile_id) { // already saved profile but with new fields being revealed
				db.query("SELECT private_profile_id, src_profile FROM private_profiles WHERE payload_hash=?", [objPrivateProfile.payload_hash], function(rows) {
					if (!rows.length)
						throw Error("can't insert private profile "+JSON.stringify(objPrivateProfile));
					private_profile_id = rows[0].private_profile_id;
					src_profile = JSON.parse(rows[0].src_profile);
					insert_fields();
				});
			} else
				insert_fields();

			var insert_fields = function() {
				var arrQueries = [];
				var isSrcProfileUpdated = false;
				for (var field in objPrivateProfile.src_profile){
					var arrValueAndBlinding = objPrivateProfile.src_profile[field];
					if (ValidationUtils.isArrayOfLength(arrValueAndBlinding, 2)) {
						db.addQuery(arrQueries, "INSERT INTO private_profile_fields (private_profile_id, field, value, blinding) VALUES(?,?,?,?)", 
							[private_profile_id, field, arrValueAndBlinding[0], arrValueAndBlinding[1] ]);
						if (!src_profile[field] || !ValidationUtils.isArrayOfLength(src_profile[field], 2)) {
							isSrcProfileUpdated = true;
							src_profile[field] = arrValueAndBlinding;
						}
					}
				}
				if (isSrcProfileUpdated)
					db.addQuery(arrQueries, "UPDATE private_profiles SET src_profile=? WHERE private_profile_id=?", [JSON.stringify(src_profile), private_profile_id]);
				async.series(arrQueries, onDone);
			}
		}
	);
}

function getFieldsForAddress(address, fields, arrTrustedAttestorAddresses, cb) {
	// selects LAST attestation, preferrably from trusted attestor that has full set of requested fields
	if (!arrTrustedAttestorAddresses.length)
		arrTrustedAttestorAddresses = [null];
	db.query("SELECT \n\
				field, value, \n\
				attestor_address, \n\
				attestor_address IN (?) AS trusted, \n\
				unit \n\
			FROM private_profile_fields \n\
			JOIN private_profiles USING (private_profile_id) \n\
			JOIN units USING(unit) \n\
			JOIN (SELECT private_profile_id \n\
				FROM private_profile_fields \n\
				WHERE field IN (?) \n\
				GROUP BY private_profile_id \n\
				HAVING COUNT(1) = ?) AS full_set \n\
			USING(private_profile_id) \n\
			WHERE address=? AND field IN (?) \n\
			ORDER BY trusted DESC, units.main_chain_index DESC LIMIT ?", [arrTrustedAttestorAddresses, fields, fields.length, address, fields, fields.length], function(rows){
			var result = {};
			rows.forEach(function(row) {
				result[row.field] = row.value;
				result.attestor_address = row.attestor_address;
				result.attestation_unit = row.unit;
			});
			cb(result);
	});
}

exports.getPrivateProfileFromJsonBase64 = getPrivateProfileFromJsonBase64;
exports.parseAndValidatePrivateProfile = parseAndValidatePrivateProfile;
exports.parseSrcProfile = parseSrcProfile;
exports.savePrivateProfile = savePrivateProfile;
exports.getFieldsForAddress = getFieldsForAddress;


