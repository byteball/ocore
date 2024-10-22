/*jslint node: true */
"use strict";
var eventBus = require('./event_bus.js');
var constants = require("./constants.js");
var conf = require("./conf.js");

var VERSION = 46;

var async = require('async');
var bCordova = (typeof window === 'object' && window.cordova);

function migrateDb(connection, onDone){
	connection.db[bCordova ? 'query' : 'all']("PRAGMA user_version", function(err, result){
		if (err)
			throw Error("PRAGMA user_version failed: "+err);
		var rows = bCordova ? result.rows : result;
		if (rows.length !== 1)
			throw Error("PRAGMA user_version returned "+rows.length+" rows");
		var version = rows[0].user_version;
		console.log("db version "+version+", software version "+VERSION);
		if (version > VERSION)
			throw Error("user version "+version+" > "+VERSION+": looks like you are using a new database with an old client");
		if (version === VERSION)
			return onDone();
		var bLongUpgrade = (version < 31 && !conf.bLight);
		eventBus.emit('started_db_upgrade', bLongUpgrade);
		if (typeof window === 'undefined'){
			var message = bLongUpgrade ? "=== will upgrade the database, it will take several hours" : "=== will upgrade the database, it can take some time";
			console.error(message);
			console.log(message);
		}
		var arrQueries = [];
		async.series([
			function(cb){
				if (version < 1){
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS unitAuthorsIndexByAddressDefinitionChash ON unit_authors(address, definition_chash)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS outputsIsSerial ON outputs(is_serial)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS bySequence ON units(sequence)");
				}
				if (version < 2){
					connection.addQuery(arrQueries, "CREATE UNIQUE INDEX IF NOT EXISTS hcobyAddressMci ON headers_commission_outputs(address, main_chain_index)");
					connection.addQuery(arrQueries, "CREATE UNIQUE INDEX IF NOT EXISTS byWitnessAddressMci ON witnessing_outputs(address, main_chain_index)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS inputsIndexByAddressTypeToMci ON inputs(address, type, to_main_chain_index)");
					connection.addQuery(arrQueries, "DELETE FROM known_bad_joints");
				}
				if (version < 5){
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS push_registrations (registrationId TEXT, device_address TEXT NOT NULL, PRIMARY KEY (device_address))");
				}
				if (version < 6){
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS chat_messages ( \n\
						id INTEGER PRIMARY KEY, \n\
						correspondent_address CHAR(33) NOT NULL, \n\
						message LONGTEXT NOT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						is_incoming INTEGER(1) NOT NULL, \n\
						type CHAR(15) NOT NULL DEFAULT 'text', \n\
						FOREIGN KEY (correspondent_address) REFERENCES correspondent_devices(device_address) \n\
					)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS chatMessagesIndexByDeviceAddress ON chat_messages(correspondent_address, id)");
					connection.addQuery(arrQueries, "ALTER TABLE correspondent_devices ADD COLUMN my_record_pref INTEGER DEFAULT 1");
					connection.addQuery(arrQueries, "ALTER TABLE correspondent_devices ADD COLUMN peer_record_pref INTEGER DEFAULT 1");
					connection.addQuery(arrQueries, "DELETE FROM known_bad_joints");
				}
				if (version < 8) {
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS bySequence ON units(sequence)");
					connection.addQuery(arrQueries, "DELETE FROM known_bad_joints");
				}
				if(version < 9){
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS watched_light_units (peer VARCHAR(100) NOT NULL, unit CHAR(44) NOT NULL, creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (peer, unit))");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS wlabyUnit ON watched_light_units(unit)");
				}
				if(version < 10){
					connection.addQuery(arrQueries, "BEGIN TRANSACTION");
					connection.addQuery(arrQueries, "ALTER TABLE chat_messages RENAME TO chat_messages_old");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS chat_messages ( \n\
						id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, \n\
						correspondent_address CHAR(33) NOT NULL, \n\
						message LONGTEXT NOT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						is_incoming INTEGER(1) NOT NULL, \n\
						type CHAR(15) NOT NULL DEFAULT 'text', \n\
						FOREIGN KEY (correspondent_address) REFERENCES correspondent_devices(device_address) ON DELETE CASCADE \n\
					)");
					connection.addQuery(arrQueries, "INSERT INTO chat_messages SELECT * FROM chat_messages_old");
					connection.addQuery(arrQueries, "DROP TABLE chat_messages_old");
					connection.addQuery(arrQueries, "CREATE INDEX chatMessagesIndexByDeviceAddress ON chat_messages(correspondent_address, id);");
					connection.addQuery(arrQueries, "COMMIT");
					connection.addQuery(arrQueries, "DELETE FROM known_bad_joints");
					connection.addQuery(arrQueries, "DELETE FROM unhandled_joints");
					connection.addQuery(arrQueries, "DELETE FROM dependencies");
					connection.addQuery(arrQueries, "DELETE FROM hash_tree_balls");
					connection.addQuery(arrQueries, "DELETE FROM catchup_chain_balls");
				}
				if (version < 11) {
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS bots ( \n\
						id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, \n\
						rank INTEGER NOT NULL DEFAULT 0, \n\
						name VARCHAR(100) NOT NULL UNIQUE, \n\
						pairing_code VARCHAR(200) NOT NULL, \n\
						description LONGTEXT NOT NULL \n\
					);");
				}
				if (version < 12)
					connection.addQuery(arrQueries, "DELETE FROM known_bad_joints");
				if (version < 13){
					connection.addQuery(arrQueries, "ALTER TABLE unit_authors ADD COLUMN _mci INT NULL");
					connection.addQuery(arrQueries, "PRAGMA user_version=13");
				}
				if (version < 14){
					connection.addQuery(arrQueries, "UPDATE unit_authors SET _mci=(SELECT main_chain_index FROM units WHERE units.unit=unit_authors.unit)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS unitAuthorsIndexByAddressMci ON unit_authors(address, _mci)");
				}
				if (version < 15){
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS asset_metadata ( \n\
						asset CHAR(44) NOT NULL PRIMARY KEY, \n\
						metadata_unit CHAR(44) NOT NULL, \n\
						registry_address CHAR(32) NULL, \n\
						suffix VARCHAR(20) NULL, \n\
						name VARCHAR(20) NULL, \n\
						decimals TINYINT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						UNIQUE (name, registry_address), \n\
						FOREIGN KEY (asset) REFERENCES assets(unit), \n\
						FOREIGN KEY (metadata_unit) REFERENCES units(unit) \n\
					)");
				}
				if (version < 16){
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS sent_mnemonics ( \n\
						unit CHAR(44) NOT NULL, \n\
						address CHAR(32) NOT NULL, \n\
						mnemonic VARCHAR(107) NOT NULL, \n\
						textAddress VARCHAR(120) NOT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						FOREIGN KEY (unit) REFERENCES units(unit) \n\
					)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS sentByAddress ON sent_mnemonics(address)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS sentByUnit ON sent_mnemonics(unit)");
					connection.addQuery(arrQueries, "DELETE FROM known_bad_joints");
				}
				if (version < 17){
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS private_profiles ( \n\
						private_profile_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, \n\
						unit CHAR(44) NOT NULL, \n\
						payload_hash CHAR(44) NOT NULL, \n\
						attestor_address CHAR(32) NOT NULL, \n\
						address CHAR(32) NOT NULL, \n\
						src_profile TEXT NOT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						FOREIGN KEY (unit) REFERENCES units(unit) \n\
					)");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS private_profile_fields ( \n\
						private_profile_id INTEGER NOT NULL , \n\
						`field` VARCHAR(50) NOT NULL, \n\
						`value` VARCHAR(50) NOT NULL, \n\
						blinding CHAR(16) NOT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						UNIQUE (private_profile_id, `field`), \n\
						FOREIGN KEY (private_profile_id) REFERENCES private_profiles(private_profile_id) \n\
					)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS ppfByField ON private_profile_fields(`field`)");
				}
				cb();
			},
			function(cb){
				if (version < 18){
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS attested_fields ( \n\
						unit CHAR(44) NOT NULL, \n\
						message_index TINYINT NOT NULL, \n\
						attestor_address CHAR(32) NOT NULL, \n\
						address CHAR(32) NOT NULL, \n\
						`field` VARCHAR(50) NOT NULL, \n\
						`value` VARCHAR(100) NOT NULL, \n\
						PRIMARY KEY (unit, message_index, `field`), \n\
						"+(conf.bLight ? '' : "CONSTRAINT attestationsByAttestorAddress FOREIGN KEY (attestor_address) REFERENCES addresses(address),")+" \n\
						FOREIGN KEY (unit) REFERENCES units(unit) \n\
					)");
					connection.addQuery(arrQueries, 
						"CREATE INDEX IF NOT EXISTS attestedFieldsByAttestorFieldValue ON attested_fields(attestor_address, `field`, `value`)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS attestedFieldsByAddressField ON attested_fields(address, `field`)");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS original_addresses ( \n\
						unit CHAR(44) NOT NULL, \n\
						address CHAR(32) NOT NULL, \n\
						original_address VARCHAR(100) NOT NULL,  \n\
						PRIMARY KEY (unit, address), \n\
						FOREIGN KEY (unit) REFERENCES units(unit) \n\
					)");
					connection.query(
						"SELECT unit, message_index, attestor_address, address, payload FROM attestations CROSS JOIN messages USING(unit, message_index)",
						function(rows){
							rows.forEach(function(row){
								var attestation = JSON.parse(row.payload);
								if (attestation.address !== row.address)
									throw Error("attestation.address !== row.address");
								for (var field in attestation.profile){
									var value = attestation.profile[field];
									if (field.length <= constants.MAX_PROFILE_FIELD_LENGTH && typeof value === 'string' && value.length <= constants.MAX_PROFILE_VALUE_LENGTH){
										connection.addQuery(arrQueries, 
											"INSERT "+connection.getIgnore()+" INTO attested_fields \n\
											(unit, message_index, attestor_address, address, field, value) VALUES(?,?, ?,?, ?,?)",
											[row.unit, row.message_index, row.attestor_address, row.address, field, value]);
									}
								}
							});
							cb();
						}
					);
				}
				else
					cb();
			},
			function(cb){
				if (version < 19)
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS outputsIsSerial ON outputs(is_serial)");
				if (version < 20)
					connection.addQuery(arrQueries, "DELETE FROM known_bad_joints");
				if (version < 21)
					connection.addQuery(arrQueries, "ALTER TABLE push_registrations ADD COLUMN platform TEXT NOT NULL DEFAULT 'android'");
				if (version < 22)
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS sharedAddressSigningPathsByDeviceAddress ON shared_address_signing_paths(device_address);");
				if (version < 23){
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS peer_addresses ( \n\
						address CHAR(32) NOT NULL, \n\
						signing_paths VARCHAR(255) NULL, \n\
						device_address CHAR(33) NOT NULL, \n\
						definition TEXT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						PRIMARY KEY (address), \n\
						FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address) \n\
					)");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS prosaic_contracts ( \n\
						hash CHAR(44) NOT NULL PRIMARY KEY, \n\
						peer_address CHAR(32) NOT NULL, \n\
						peer_device_address CHAR(33) NOT NULL, \n\
						my_address  CHAR(32) NOT NULL, \n\
						is_incoming TINYINT NOT NULL, \n\
						creation_date TIMESTAMP NOT NULL, \n\
						ttl INT NOT NULL DEFAULT 168, -- 168 hours = 24 * 7 = 1 week \n\
						status TEXT CHECK (status IN('pending', 'revoked', 'accepted', 'declined')) NOT NULL DEFAULT 'active', \n\
						title VARCHAR(1000) NOT NULL, \n\
						`text` TEXT NOT NULL, \n\
						shared_address CHAR(32), \n\
						unit CHAR(44), \n\
						cosigners VARCHAR(1500), \n\
						FOREIGN KEY (my_address) REFERENCES my_addresses(address) \n\
					)");
				}
				if (version < 24){
					connection.addQuery(arrQueries, "BEGIN TRANSACTION");
					connection.addQuery(arrQueries, "CREATE TABLE asset_attestors_new ( \n\
						unit CHAR(44) NOT NULL, \n\
						message_index TINYINT NOT NULL, \n\
						asset CHAR(44) NOT NULL, -- in the initial attestor list: same as unit  \n\
						attestor_address CHAR(32) NOT NULL, \n\
						PRIMARY KEY (unit, message_index, attestor_address), \n\
						UNIQUE (asset, attestor_address, unit), \n\
						FOREIGN KEY (unit) REFERENCES units(unit), \n\
						CONSTRAINT assetAttestorsByAsset FOREIGN KEY (asset) REFERENCES assets(unit) \n\
					)");
					connection.addQuery(arrQueries, "INSERT INTO asset_attestors_new SELECT * FROM asset_attestors");
					connection.addQuery(arrQueries, "DROP TABLE asset_attestors");
					connection.addQuery(arrQueries, "ALTER TABLE asset_attestors_new RENAME TO asset_attestors");
					connection.addQuery(arrQueries, "COMMIT");
				}
				if (version < 25)
					connection.addQuery(arrQueries, "ALTER TABLE correspondent_devices ADD COLUMN is_blackhole TINYINT NOT NULL DEFAULT 0");
				if (version < 26){
					connection.addQuery(arrQueries, "ALTER TABLE correspondent_devices ADD COLUMN push_enabled TINYINT NOT NULL DEFAULT 1");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS correspondent_settings ( \n\
						device_address CHAR(33) NOT NULL, \n\
						correspondent_address CHAR(33) NOT NULL, \n\
						push_enabled TINYINT NOT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						PRIMARY KEY (device_address, correspondent_address) \n\
					)");
					connection.addQuery(arrQueries, "PRAGMA user_version=26");
				}
				if (version < 27){
					connection.addQuery(arrQueries, "CREATE UNIQUE INDEX IF NOT EXISTS unqPayloadHash ON private_profiles(payload_hash)");
				}
				if (version < 28){
					connection.addQuery(arrQueries, "ALTER TABLE units ADD COLUMN timestamp INT NOT NULL DEFAULT 0");
					connection.addQuery(arrQueries, "PRAGMA user_version=28");
				}
				if (version < 29)
					connection.addQuery(arrQueries, "DELETE FROM known_bad_joints");
				if (version < 30) {
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS joints ( \n\
						unit CHAR(44) NOT NULL PRIMARY KEY, \n\
						json TEXT NOT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP \n\
					)");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS aa_addresses ( \n\
						address CHAR(32) NOT NULL PRIMARY KEY, \n\
						unit CHAR(44) NOT NULL, -- where it is first defined.  No index for better speed \n\
						mci INT NOT NULL, -- it is available since this mci (mci of the above unit) \n\
						definition TEXT NOT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP \n\
					)");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS aa_triggers ( \n\
						mci INT NOT NULL, \n\
						unit CHAR(44) NOT NULL, \n\
						address CHAR(32) NOT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						PRIMARY KEY (mci, unit, address), \n\
						FOREIGN KEY (address) REFERENCES aa_addresses(address) \n\
					)");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS aa_balances ( \n\
						address CHAR(32) NOT NULL, \n\
						asset CHAR(44) NOT NULL, -- 'base' for bytes (NULL would not work for uniqueness of primary key) \n\
						balance BIGINT NOT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						PRIMARY KEY (address, asset), \n\
						FOREIGN KEY (address) REFERENCES aa_addresses(address) \n\
					--	FOREIGN KEY (asset) REFERENCES assets(unit) \n\
					)");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS aa_responses ( \n\
						aa_response_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, \n\
						mci INT NOT NULL, -- mci of the trigger unit \n\
						trigger_address CHAR(32) NOT NULL, -- trigger address \n\
						aa_address CHAR(32) NOT NULL, \n\
						trigger_unit CHAR(44) NOT NULL, \n\
						bounced TINYINT NOT NULL, \n\
						response_unit CHAR(44) NULL UNIQUE, \n\
						response TEXT NULL, -- json \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						UNIQUE (trigger_unit, aa_address), \n\
						"+(conf.bLight ? "" : "FOREIGN KEY (aa_address) REFERENCES aa_addresses(address),")+" \n\
						FOREIGN KEY (trigger_unit) REFERENCES units(unit) \n\
					--	FOREIGN KEY (response_unit) REFERENCES units(unit) \n\
					)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS aaResponsesByTriggerAddress ON aa_responses(trigger_address)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS aaResponsesByAAAddress ON aa_responses(aa_address)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS aaResponsesByMci ON aa_responses(mci)");
					connection.addQuery(arrQueries, "PRAGMA user_version=30");
				}
				cb();
			},
			function(cb){
				if (version < 31) {
					async.series(arrQueries, function () {
						require('./migrate_to_kv.js')(connection, function () {
							arrQueries = [];
							cb();
						});
					});
				}
				else
					cb();
			}, 
			function(cb){
				if (version < 32)
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS my_watched_addresses (\n\
						address CHAR(32) NOT NULL PRIMARY KEY,\n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP\n\
					)");
				if (version < 33) {
					connection.addQuery(arrQueries, "ALTER TABLE aa_addresses ADD COLUMN storage_size INT NOT NULL DEFAULT 0");
					connection.addQuery(arrQueries, "PRAGMA user_version=33");
				}
				cb();
			},
			function (cb) {
				if (version < 34)
					initStorageSizes(connection, arrQueries, cb);
				else
					cb();
			},
			function (cb) {
				if (version < 35)
					connection.addQuery(arrQueries, "REPLACE INTO aa_balances (address, asset, balance) \n\
						SELECT address, IFNULL(asset, 'base'), SUM(amount) AS balance \n\
						FROM aa_addresses \n\
						CROSS JOIN outputs USING(address) \n\
						CROSS JOIN units ON outputs.unit=units.unit \n\
						WHERE is_spent=0 AND ( \n\
							is_stable=1 \n\
							OR EXISTS (SELECT 1 FROM unit_authors CROSS JOIN aa_addresses USING(address) WHERE unit_authors.unit=outputs.unit) \n\
						) \n\
						GROUP BY address, asset");
				if (version < 36) {
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS watched_light_aas (  \n\
						peer VARCHAR(100) NOT NULL, \n\
						aa CHAR(32) NOT NULL, \n\
						address CHAR(32) NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						PRIMARY KEY (peer, aa, address) \n\
					)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS wlaabyAA ON watched_light_aas(aa)");
				}
				if (version < 37) {
					connection.addQuery(arrQueries, "ALTER TABLE aa_addresses ADD COLUMN base_aa CHAR(32) NULL" + (conf.bLight ? "" : " CONSTRAINT aaAddressesByBaseAA REFERENCES aa_addresses(address)"));
					connection.addQuery(arrQueries, "PRAGMA user_version=37");
				}
				if (version < 38)
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS byBaseAA ON aa_addresses(base_aa)");
				cb();
			},
			function (cb) {
				if (version < 39)
					addTypesToStateVars(cb);
				else
					cb();
			},
			function (cb) {
				if (version < 40) {
					connection.addQuery(arrQueries, "ALTER TABLE aa_addresses ADD COLUMN getters TEXT NULL");
					connection.addQuery(arrQueries, "PRAGMA user_version=40");
				}
				if (version < 41)
					connection.addQuery(arrQueries, "DELETE FROM known_bad_joints");
				if (version < 42 && conf.bLight) {
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS unprocessed_addresses (\n\
						address CHAR(32) NOT NULL PRIMARY KEY,\n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP\n\
					);");
				}
				if (version < 43) {
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS arbiter_locations ( \n\
						arbiter_address CHAR(32) NOT NULL PRIMARY KEY, \n\
						arbstore_address CHAR(32) NOT NULL, \n\
						unit CHAR(44) NULL \n\
					);");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS wallet_arbiters ( \n\
						arbiter_address CHAR(32) NOT NULL PRIMARY KEY, \n\
						real_name VARCHAR(250) NULL, \n\
						device_pub_key VARCHAR(44) NULL \n\
					);");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS wallet_arbiter_contracts ( \n\
						hash CHAR(44) NOT NULL PRIMARY KEY, \n\
						peer_address CHAR(32) NOT NULL, \n\
						peer_device_address CHAR(33) NOT NULL, \n\
						my_address  CHAR(32) NOT NULL, \n\
						arbiter_address CHAR(32) NOT NULL, \n\
						me_is_payer TINYINT NOT NULL, \n\
						amount BIGINT NULL, \n\
						asset CHAR(44) NULL, \n\
						is_incoming TINYINT NOT NULL, \n\
						me_is_cosigner TINYINT NULL, \n\
						creation_date TIMESTAMP NOT NULL, \n\
						ttl INT NOT NULL DEFAULT 168, -- 168 hours = 24 * 7 = 1 week \n\
						status VARCHAR CHECK (status IN('pending', 'revoked', 'accepted', 'signed', 'declined', 'paid', 'in_dispute', 'dispute_resolved', 'in_appeal', 'appeal_approved', 'appeal_declined', 'cancelled', 'completed')) NOT NULL DEFAULT 'pending', \n\
						title VARCHAR(1000) NOT NULL, \n\
						text TEXT NOT NULL, \n\
						my_contact_info TEXT NULL, \n\
						peer_contact_info TEXT NULL, \n\
						peer_pairing_code VARCHAR(200) NULL, \n\
						shared_address CHAR(32) NULL UNIQUE, \n\
						unit CHAR(44) NULL, \n\
						cosigners VARCHAR(1500), \n\
						resolution_unit CHAR(44) NULL, \n\
						arbstore_address  CHAR(32) NULL, \n\
						arbstore_device_address  CHAR(33) NULL, \n\
						FOREIGN KEY (my_address) REFERENCES my_addresses(address) \n\
					)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS wacStatus ON wallet_arbiter_contracts(status)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS wacArbiterAddress ON wallet_arbiter_contracts(arbiter_address)");
					connection.addQuery(arrQueries, "CREATE INDEX IF NOT EXISTS wacPeerAddress ON wallet_arbiter_contracts(peer_address)");

					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS arbiter_disputes (\n\
						contract_hash CHAR(44) NOT NULL PRIMARY KEY,\n\
						plaintiff_address CHAR(32) NOT NULL,\n\
						respondent_address CHAR(32) NOT NULL,\n\
						plaintiff_is_payer TINYINT(1) NOT NULL,\n\
						plaintiff_pairing_code VARCHAR(200) NOT NULL,\n\
						respondent_pairing_code VARCHAR(200) NOT NULL,\n\
						contract_content TEXT NOT NULL,\n\
						contract_unit CHAR(44) NOT NULL,\n\
						amount BIGINT NOT NULL,\n\
						asset CHAR(44) NULL,\n\
						arbiter_address CHAR(32) NOT NULL,\n\
						service_fee_asset CHAR(44) NULL,\n\
						arbstore_device_address CHAR(33) NOT NULL,\n\
						status VARCHAR(40) CHECK (status IN('pending', 'resolved')) NOT NULL DEFAULT 'pending',\n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n\
						plaintiff_contact_info TEXT NULL,\n\
						respondent_contact_info TEXT NULL,\n\
						FOREIGN KEY (arbstore_device_address) REFERENCES correspondent_devices(device_address)\n\
					)");
					connection.addQuery(arrQueries, "DROP TABLE IF EXISTS asset_metadata");
					connection.addQuery(arrQueries, "CREATE TABLE IF NOT EXISTS asset_metadata ( \n\
						asset CHAR(44) NOT NULL PRIMARY KEY, \n\
						metadata_unit CHAR(44) NOT NULL, \n\
						registry_address CHAR(32) NULL, \n\
						suffix VARCHAR(20) NULL, \n\
						name VARCHAR(20) NULL, \n\
						decimals TINYINT NULL, \n\
						creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, \n\
						UNIQUE (name, registry_address), \n\
						FOREIGN KEY (asset) REFERENCES assets(unit), \n\
						FOREIGN KEY (metadata_unit) REFERENCES units(unit) \n\
					)");
				}
				if (version < 44 && !conf.bLight && constants.bTestnet)
					connection.addQuery(arrQueries, "REPLACE INTO aa_balances (address, asset, balance) \n\
						SELECT address, IFNULL(asset, 'base'), SUM(amount) AS balance \n\
						FROM aa_addresses \n\
						CROSS JOIN outputs USING(address) \n\
						CROSS JOIN units ON outputs.unit=units.unit \n\
						WHERE is_spent=0 AND address='SLBA27JAT5UJBMQGDQLAT3FQ467XDOGF' AND ( \n\
							is_stable=1 \n\
							OR EXISTS (SELECT 1 FROM unit_authors CROSS JOIN aa_addresses USING(address) WHERE unit_authors.unit=outputs.unit) \n\
						) \n\
						GROUP BY address, asset");
				if (version < 45) {
					connection.addQuery(arrQueries, "ALTER TABLE wallet_arbiter_contracts ADD COLUMN my_party_name VARCHAR(100) NULL");
					connection.addQuery(arrQueries, "ALTER TABLE wallet_arbiter_contracts ADD COLUMN peer_party_name VARCHAR(100) NULL");
				}
				if (version < 46) {
					if (!conf.bLight) {
						connection.addQuery(arrQueries, `CREATE TABLE IF NOT EXISTS system_votes (
							unit CHAR(44) NOT NULL,
							address CHAR(32) NOT NULL,
							subject VARCHAR(50) NOT NULL,
							value TEXT NOT NULL,
							timestamp INT NOT NULL,
							creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
							PRIMARY KEY (unit, address, subject)
						--	FOREIGN KEY (unit) REFERENCES units(unit)
						)`);
						connection.addQuery(arrQueries, `CREATE INDEX IF NOT EXISTS bySysVotesAddress ON system_votes(address)`);
						connection.addQuery(arrQueries, `CREATE INDEX IF NOT EXISTS bySysVotesSubjectAddress ON system_votes(subject, address)`);
						connection.addQuery(arrQueries, `CREATE INDEX IF NOT EXISTS bySysVotesSubjectTimestamp ON system_votes(subject, timestamp)`);
						connection.addQuery(arrQueries, `CREATE TABLE IF NOT EXISTS op_votes (
							unit CHAR(44) NOT NULL,
							address CHAR(32) NOT NULL,
							op_address CHAR(32) NOT NULL,
							timestamp INT NOT NULL,
							creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
							PRIMARY KEY (address, op_address)
						--	FOREIGN KEY (unit) REFERENCES units(unit)
						)`);
						connection.addQuery(arrQueries, `CREATE INDEX IF NOT EXISTS byOpVotesTs ON op_votes(timestamp)`);
						connection.addQuery(arrQueries, `CREATE TABLE IF NOT EXISTS numerical_votes (
							unit CHAR(44) NOT NULL,
							address CHAR(32) NOT NULL,
							subject VARCHAR(50) NOT NULL,
							value DOUBLE NOT NULL,
							timestamp INT NOT NULL,
							creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
							PRIMARY KEY (address, subject)
						--	FOREIGN KEY (unit) REFERENCES units(unit)
						)`);
						connection.addQuery(arrQueries, `CREATE INDEX IF NOT EXISTS byNumericalVotesSubjectTs ON numerical_votes(subject, timestamp)`);
						connection.addQuery(arrQueries, `CREATE TABLE IF NOT EXISTS system_vars (
							subject VARCHAR(50) NOT NULL,
							value TEXT NOT NULL,
							vote_count_mci INT NOT NULL, -- applies since the next mci
							is_emergency TINYINT NOT NULL DEFAULT 0,
							creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
							PRIMARY KEY (subject, vote_count_mci DESC)
						)`);
						const timestamp = 1724716800; // 27 Aug 2024
						const threshold_size = 10000;
						const base_tps_fee = 10;
						const tps_interval = constants.bDevnet ? 2 : 1;
						const tps_fee_multiplier = 10;
						const arrOPs = constants.bDevnet
							? ["ZQFHJXFWT2OCEBXF26GFXJU4MPASWPJT"]
							: (constants.bTestnet
								? ["2FF7PSL7FYXVU5UIQHCVDTTPUOOG75GX", "2GPBEZTAXKWEXMWCTGZALIZDNWS5B3V7", "4H2AMKF6YO2IWJ5MYWJS3N7Y2YU2T4Z5", "DFVODTYGTS3ILVOQ5MFKJIERH6LGKELP", "ERMF7V2RLCPABMX5AMNGUQBAH4CD5TK4", "F4KHJUCLJKY4JV7M5F754LAJX4EB7M4N", "IOF6PTBDTLSTBS5NWHUSD7I2NHK3BQ2T", "O4K4QILG6VPGTYLRAI2RGYRFJZ7N2Q2O", "OPNUXBRSSQQGHKQNEPD2GLWQYEUY5XLD", "PA4QK46276MJJD5DBOLIBMYKNNXMUVDP", "RJDYXC4YQ4AZKFYTJVCR5GQJF5J6KPRI", "WELOXP3EOA75JWNO6S5ZJHOO3EYFKPIR"]
								: ["2TO6NYBGX3NF5QS24MQLFR7KXYAMCIE5", "4GDZSXHEFVFMHCUCSHZVXBVF5T2LJHMU", "APABTE2IBKOIHLS2UNK6SAR4T5WRGH2J", "DXYWHSZ72ZDNDZ7WYZXKWBBH425C6WZN", "FAB6TH7IRAVHDLK2AAWY5YBE6CEBUACF", "FOPUBEUPBC6YLIQDLKL6EW775BMV7YOH", "GFK3RDAPQLLNCMQEVGGD2KCPZTLSG3HN", "I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT", "JMFXY26FN76GWJJG7N36UI2LNONOGZJV", "JPQKPRI5FMTQRJF4ZZMYZYDQVRD55OTC", "TKT4UESIKTTRALRRLWS4SENSTJX6ODCW", "UE25S4GRWZOLNXZKY4VWFHNJZWUSYCQC"]
							);
						const strOPs = JSON.stringify(arrOPs);
						const arrPreloadedVoters = constants.bDevnet
							? [require('./chash.js').getChash160('')]
							: (constants.bTestnet
								? ['EJC4A7WQGHEZEKW6RLO7F26SAR4LAQBU']
								: ['3Y24IXW57546PQAPQ2SXYEPEDNX4KC6Y', 'G4E66WLVL4YMNFLBKWPRCVNBTPB64NOE', 'Q5OGEL2QFKQ4TKQTG4X3SSLU57OBMMBY', 'BQCVIU7Y7LHARKJVZKWL7SL3PEH7UHVM']
							);
						for (let address of arrPreloadedVoters) {
							connection.addQuery(arrQueries,
								`INSERT OR IGNORE INTO system_votes (unit, address, subject, value, timestamp) VALUES
								('', '${address}', 'op_list', '${strOPs}', ${timestamp}),
								('', '${address}', 'threshold_size', ${threshold_size}, ${timestamp}),
								('', '${address}', 'base_tps_fee', ${base_tps_fee}, ${timestamp}),
								('', '${address}', 'tps_interval', ${tps_interval}, ${timestamp}),
								('', '${address}', 'tps_fee_multiplier', ${tps_fee_multiplier}, ${timestamp})
							`);
							const values = arrOPs.map(op => `('', '${address}', '${op}', ${timestamp})`);
							connection.addQuery(arrQueries, `INSERT OR IGNORE INTO op_votes (unit, address, op_address, timestamp) VALUES ` + values.join(', '));
							connection.addQuery(arrQueries,
								`INSERT OR IGNORE INTO numerical_votes (unit, address, subject, value, timestamp) VALUES
								('', '${address}', 'threshold_size', ${threshold_size}, ${timestamp}),
								('', '${address}', 'base_tps_fee', ${base_tps_fee}, ${timestamp}),
								('', '${address}', 'tps_interval', ${tps_interval}, ${timestamp}),
								('', '${address}', 'tps_fee_multiplier', ${tps_fee_multiplier}, ${timestamp})
							`);
						}
						connection.addQuery(arrQueries,
							`INSERT OR IGNORE INTO system_vars (subject, value, vote_count_mci) VALUES 
							('op_list', '${strOPs}', -1),
							('threshold_size', ${threshold_size}, -1),
							('base_tps_fee', ${base_tps_fee}, -1),
							('tps_interval', ${tps_interval}, -1),
							('tps_fee_multiplier', ${tps_fee_multiplier}, -1)
						`);
						connection.addQuery(arrQueries, `CREATE TABLE IF NOT EXISTS tps_fees_balances (
							address CHAR(32) NOT NULL,
							mci INT NOT NULL,
							tps_fees_balance INT NOT NULL DEFAULT 0, -- can be negative
							creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
							PRIMARY KEY (address, mci DESC)
						)`);
						connection.addQuery(arrQueries, `CREATE TABLE IF NOT EXISTS node_vars (
							name VARCHAR(30) NOT NULL PRIMARY KEY,
							value TEXT NOT NULL,
							last_update TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
						)`);
						connection.addQuery(arrQueries, `INSERT INTO node_vars (name, value) VALUES ('last_temp_data_purge_mci', ?)`, [constants.v4UpgradeMci]);
					}
					connection.addQuery(arrQueries, "ALTER TABLE units ADD COLUMN oversize_fee INT NULL");
					connection.addQuery(arrQueries, "ALTER TABLE units ADD COLUMN tps_fee INT NULL");
					connection.addQuery(arrQueries, "ALTER TABLE units ADD COLUMN actual_tps_fee INT NULL");
					connection.addQuery(arrQueries, "ALTER TABLE units ADD COLUMN burn_fee INT NULL");
					connection.addQuery(arrQueries, "ALTER TABLE units ADD COLUMN max_aa_responses INT NULL");
					connection.addQuery(arrQueries, "ALTER TABLE units ADD COLUMN count_aa_responses INT NULL");
					connection.addQuery(arrQueries, "ALTER TABLE units ADD COLUMN is_aa_response TINYINT NULL");
					connection.addQuery(arrQueries, "ALTER TABLE units ADD COLUMN count_primary_aa_triggers TINYINT NULL");
					connection.addQuery(arrQueries, `UPDATE units SET is_aa_response=1 WHERE unit IN (SELECT response_unit FROM aa_responses)`);
					connection.addQuery(arrQueries, `UPDATE units 
						SET count_primary_aa_triggers=(SELECT COUNT(*) FROM aa_responses WHERE trigger_unit=unit)
						WHERE is_aa_response!=1 AND unit IN (SELECT trigger_unit FROM aa_responses)
					`);
				}
				cb();
			},
		],
		function(){
			connection.addQuery(arrQueries, "PRAGMA user_version="+VERSION);
			async.series(arrQueries, function(){
				eventBus.emit('finished_db_upgrade');
				if (typeof window === 'undefined'){
					console.error("=== db upgrade finished");
					console.log("=== db upgrade finished");
				}
				onDone();
			});
		});
	});
}


function initStorageSizes(connection, arrQueries, cb){
	if (bCordova)
		return cb();
	var options = {};
	options.gte = "st\n";
	options.lte = "st\n\uFFFF";

	var assocSizes = {};
	var handleData = function (data) {
		var address = data.key.substr(3, 32);
		var var_name = data.key.substr(36);
		if (!assocSizes[address])
			assocSizes[address] = 0;
		assocSizes[address] += var_name.length + data.value.length;
	}
	var kvstore = require('./kvstore.js');
	var stream = kvstore.createReadStream(options);
	stream.on('data', handleData)
		.on('end', function(){
			for (var address in assocSizes)
				connection.addQuery(arrQueries, "UPDATE aa_addresses SET storage_size=? WHERE address=?", [assocSizes[address], address]);
			cb();
		})
		.on('error', function(error){
			throw Error('error from data stream: '+error);
		});
}

function addTypesToStateVars(cb){
	if (bCordova || conf.bLight)
		return cb();
	var string_utils = require("./string_utils.js");
	var kvstore = require('./kvstore.js');
	var batch = kvstore.batch();
	var options = {};
	options.gte = "st\n";
	options.lte = "st\n\uFFFF";

	var bOldFormat = false;
	var handleData = function (data) {
		if (data.value.split("\n", 2).length < 2) // check if already upgraded
			bOldFormat = true; // if at least one non-upgraded value found, then we didn't upgrade yet
		var f = string_utils.getNumericFeedValue(data.value); // use old rules to convert strings to numbers
		var type = (f !== null) ? 'n' : 's';
		batch.put(data.key, type + "\n" + data.value);
	}
	var stream = kvstore.createReadStream(options);
	stream.on('data', handleData)
		.on('end', function () {
			if (!bOldFormat) {
				console.log("state vars already upgraded");
				batch.clear();
				return cb();
			}
			batch.write(function(err){
				if (err)
					throw Error("writer: batch write failed: " + err);
				console.log("done upgrading state vars");
				cb();
			});
		})
		.on('error', function(error){
			throw Error('error from data stream: ' + error);
		});
}

exports.migrateDb = migrateDb;