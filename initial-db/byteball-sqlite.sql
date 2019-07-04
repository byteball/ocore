CREATE TABLE units (
	unit CHAR(44) NOT NULL PRIMARY KEY, -- sha256 in base64
	creation_date timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	version VARCHAR(3) NOT NULL DEFAULT '1.0',
	alt VARCHAR(3) NOT NULL DEFAULT '1',
	witness_list_unit CHAR(44) NULL,
	last_ball_unit CHAR(44) NULL,
	timestamp INT NOT NULL DEFAULT 0,
	content_hash CHAR(44) NULL,
	headers_commission INT NOT NULL,
	payload_commission INT NOT NULL,
	is_free TINYINT NOT NULL DEFAULT 1,
	is_on_main_chain TINYINT NOT NULL DEFAULT 0,
	main_chain_index INT NULL, -- when it first appears
	latest_included_mc_index INT NULL, -- latest MC ball that is included in this ball (excluding itself)
	level INT NULL,
	witnessed_level INT NULL,
	is_stable TINYINT NOT NULL DEFAULT 0,
	sequence TEXT CHECK (sequence IN('good','temp-bad','final-bad')) NOT NULL DEFAULT 'good',
	best_parent_unit CHAR(44) NULL,
	CONSTRAINT unitsByLastBallUnit FOREIGN KEY (last_ball_unit) REFERENCES units(unit),
	FOREIGN KEY (best_parent_unit) REFERENCES units(unit),
	CONSTRAINT unitsByWitnessListUnit FOREIGN KEY (witness_list_unit) REFERENCES units(unit)
);
CREATE INDEX byLB ON units(last_ball_unit);
CREATE INDEX byBestParent ON units(best_parent_unit);
CREATE INDEX byWL ON units(witness_list_unit);
CREATE INDEX byMainChain ON units(is_on_main_chain);
CREATE INDEX byMcIndex ON units(main_chain_index);
CREATE INDEX byLimci ON units(latest_included_mc_index);
CREATE INDEX byLevel ON units(level);
CREATE INDEX byFree ON units(is_free);
CREATE INDEX byStableMci ON units(is_stable, main_chain_index);


CREATE TABLE balls (
	ball CHAR(44) NOT NULL PRIMARY KEY, -- sha256 in base64
	creation_date timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	unit CHAR(44) NOT NULL UNIQUE, -- sha256 in base64
--  count_witnesses TINYINT NOT NULL DEFAULT 0,
	count_paid_witnesses TINYINT NULL,
	FOREIGN KEY (unit) REFERENCES units(unit)
);
CREATE INDEX byCountPaidWitnesses ON balls(count_paid_witnesses);

CREATE TABLE skiplist_units (
	unit CHAR(44) NOT NULL,
	skiplist_unit CHAR(44) NOT NULL, -- only for MC units with MCI divisible by 10: previous MC units divisible by 10
	PRIMARY KEY (unit, skiplist_unit),
	FOREIGN KEY (unit) REFERENCES units(unit),
	FOREIGN KEY (skiplist_unit) REFERENCES units(unit)
);
CREATE INDEX bySkiplistUnit ON skiplist_units(skiplist_unit);



-- must be sorted by parent_unit
CREATE TABLE parenthoods (
	child_unit CHAR(44) NOT NULL,
	parent_unit CHAR(44) NOT NULL,
	PRIMARY KEY (parent_unit, child_unit),
	CONSTRAINT parenthoodsByChild FOREIGN KEY (child_unit) REFERENCES units(unit),
	CONSTRAINT parenthoodsByParent FOREIGN KEY (parent_unit) REFERENCES units(unit)
);
CREATE INDEX byChildUnit ON parenthoods(child_unit);



CREATE TABLE definitions (
	definition_chash CHAR(32) NOT NULL PRIMARY KEY,
	definition TEXT NOT NULL,
	has_references TINYINT NOT NULL
);


-- current list of all known from-addresses
CREATE TABLE addresses (
	address CHAR(32) NOT NULL PRIMARY KEY,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- must be sorted by address
CREATE TABLE unit_authors (
	unit CHAR(44) NOT NULL,
	address CHAR(32) NOT NULL,
	definition_chash CHAR(32) NULL, -- only with 1st ball from this address, and with next ball after definition change
	_mci INT NULL,
	PRIMARY KEY (unit, address),
	FOREIGN KEY (unit) REFERENCES units(unit),
	CONSTRAINT unitAuthorsByAddress FOREIGN KEY (address) REFERENCES addresses(address),
	FOREIGN KEY (definition_chash) REFERENCES definitions(definition_chash)
);
CREATE INDEX byDefinitionChash ON unit_authors(definition_chash);
CREATE INDEX unitAuthorsIndexByAddress ON unit_authors(address);
CREATE INDEX unitAuthorsIndexByAddressDefinitionChash ON unit_authors(address, definition_chash);
CREATE INDEX unitAuthorsIndexByAddressMci ON unit_authors(address, _mci);


CREATE TABLE authentifiers (
	unit CHAR(44) NOT NULL,
	address CHAR(32) NOT NULL,
	path VARCHAR(40) NOT NULL,
	authentifier VARCHAR(4096) NOT NULL,
	PRIMARY KEY (unit, address, path),
	FOREIGN KEY (unit) REFERENCES units(unit),
	CONSTRAINT authentifiersByAddress FOREIGN KEY (address) REFERENCES addresses(address)
);
CREATE INDEX authentifiersIndexByAddress ON authentifiers(address);

-- must be sorted by address
CREATE TABLE unit_witnesses (
	unit CHAR(44) NOT NULL,
	address CHAR(32) NOT NULL,
	PRIMARY KEY (unit, address),
	FOREIGN KEY (unit) REFERENCES units(unit)
);
CREATE INDEX byAddress ON unit_witnesses(address);

CREATE TABLE witness_list_hashes (
	witness_list_unit CHAR(44) NOT NULL PRIMARY KEY,
	witness_list_hash CHAR(44) NOT NULL UNIQUE,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (witness_list_unit) REFERENCES units(unit)
);


-- if this ball wins headers commission from at least one of the included balls, how it is distributed
-- required if more than one author
-- if one author, all commission goes to the author by default
CREATE TABLE earned_headers_commission_recipients (
	unit CHAR(44) NOT NULL,
	address CHAR(32) NOT NULL,
	earned_headers_commission_share INT NOT NULL, -- percentage
	PRIMARY KEY (unit, address),
	FOREIGN KEY (unit) REFERENCES units(unit)
);
CREATE INDEX earnedbyAddress ON earned_headers_commission_recipients(address);


CREATE TABLE messages (
	unit CHAR(44) NOT NULL,
	message_index TINYINT NOT NULL,
	app VARCHAR(30) NOT NULL,
	payload_location TEXT CHECK (payload_location IN ('inline','uri','none')) NOT NULL,
	payload_hash CHAR(44) NOT NULL,
	payload TEXT NULL,
	payload_uri_hash CHAR(44) NULL,
	payload_uri VARCHAR(500) NULL,
	PRIMARY KEY (unit, message_index),
	FOREIGN KEY (unit) REFERENCES units(unit)
);

-- must be sorted by spend_proof
CREATE TABLE spend_proofs (
	unit CHAR(44) NOT NULL,
	message_index TINYINT NOT NULL,
	spend_proof_index TINYINT NOT NULL,
	spend_proof CHAR(44) NOT NULL,
	address CHAR(32) NOT NULL,
	PRIMARY KEY (unit, message_index, spend_proof_index),
	UNIQUE  (spend_proof, unit),
	FOREIGN KEY (unit) REFERENCES units(unit),
	CONSTRAINT spendProofsByAddress FOREIGN KEY (address) REFERENCES addresses(address)
);
CREATE INDEX spendProofsIndexByAddress ON spend_proofs(address);


-- -------------------------
-- Specific message types


CREATE TABLE address_definition_changes (
	unit CHAR(44) NOT NULL,
	message_index TINYINT NOT NULL,
	address CHAR(32) NOT NULL,
	definition_chash CHAR(32) NOT NULL, -- might not be defined in definitions yet (almost always, it is not defined)
	PRIMARY KEY (unit, message_index),
	UNIQUE  (address, unit),
	FOREIGN KEY (unit) REFERENCES units(unit),
	CONSTRAINT addressDefinitionChangesByAddress FOREIGN KEY (address) REFERENCES addresses(address)
);


CREATE TABLE data_feeds (
	unit CHAR(44) NOT NULL,
	message_index TINYINT NOT NULL,
	feed_name VARCHAR(64) NOT NULL,
--    type ENUM('string', 'number') NOT NULL,
	`value` VARCHAR(64) NULL,
	`int_value` BIGINT NULL,
	PRIMARY KEY (unit, feed_name),
	FOREIGN KEY (unit) REFERENCES units(unit)
);
CREATE INDEX byNameStringValue ON data_feeds(feed_name, `value`);
CREATE INDEX byNameIntValue ON data_feeds(feed_name, `int_value`);

CREATE TABLE polls (
	unit CHAR(44) NOT NULL PRIMARY KEY,
	message_index TINYINT NOT NULL,
	question VARCHAR(4096) NOT NULL,
	FOREIGN KEY (unit) REFERENCES units(unit)
);

CREATE TABLE poll_choices (
	unit CHAR(44) NOT NULL,
	choice_index TINYINT NOT NULL,
	choice VARCHAR(64) NOT NULL,
	PRIMARY KEY (unit, choice_index),
	UNIQUE  (unit, choice),
	FOREIGN KEY (unit) REFERENCES polls(unit)
);

CREATE TABLE votes (
	unit CHAR(44) NOT NULL,
	message_index TINYINT NOT NULL,
	poll_unit CHAR(44) NOT NULL,
	choice VARCHAR(64) NOT NULL,
	PRIMARY KEY (unit, message_index),
	UNIQUE  (unit, choice),
	CONSTRAINT votesByChoice FOREIGN KEY (poll_unit, choice) REFERENCES poll_choices(unit, choice),
	FOREIGN KEY (unit) REFERENCES units(unit)
);
CREATE INDEX votesIndexByPollUnitChoice ON votes(poll_unit, choice);


CREATE TABLE attestations (
	unit CHAR(44) NOT NULL,
	message_index TINYINT NOT NULL,
	attestor_address CHAR(32) NOT NULL,
	address CHAR(32) NOT NULL,
--	name VARCHAR(44) NOT NULL,
	PRIMARY KEY (unit, message_index),
	CONSTRAINT attestationsByAttestorAddress FOREIGN KEY (attestor_address) REFERENCES addresses(address),
	FOREIGN KEY (unit) REFERENCES units(unit)
);
CREATE INDEX attestationsByAddress ON attestations(address);
CREATE INDEX attestationsIndexByAttestorAddress ON attestations(attestor_address);

CREATE TABLE assets (
	unit CHAR(44) NOT NULL PRIMARY KEY,
	message_index TINYINT NOT NULL,
	cap BIGINT NULL,
	is_private TINYINT NOT NULL,
	is_transferrable TINYINT NOT NULL,
	auto_destroy TINYINT NOT NULL,
	fixed_denominations TINYINT NOT NULL,
	issued_by_definer_only TINYINT NOT NULL,
	cosigned_by_definer TINYINT NOT NULL,
	spender_attested TINYINT NOT NULL, -- must subsequently publish and update the list of trusted attestors
	issue_condition TEXT NULL,
	transfer_condition TEXT NULL,
	FOREIGN KEY (unit) REFERENCES units(unit)
);

CREATE TABLE asset_denominations (
	asset CHAR(44) NOT NULL,
	denomination INT NOT NULL,
	count_coins BIGINT NULL,
	max_issued_serial_number BIGINT NOT NULL DEFAULT 0,
	PRIMARY KEY (asset, denomination),
	FOREIGN KEY (asset) REFERENCES assets(unit)
);

CREATE TABLE asset_attestors (
	unit CHAR(44) NOT NULL,
	message_index TINYINT NOT NULL,
	asset CHAR(44) NOT NULL, -- in the initial attestor list: same as unit 
	attestor_address CHAR(32) NOT NULL,
	PRIMARY KEY (unit, message_index, attestor_address),
	UNIQUE (asset, attestor_address, unit),
	FOREIGN KEY (unit) REFERENCES units(unit),
	CONSTRAINT assetAttestorsByAsset FOREIGN KEY (asset) REFERENCES assets(unit)
);


-- -------------------------
-- Payments

CREATE TABLE inputs (
	unit CHAR(44) NOT NULL,
	message_index TINYINT NOT NULL,
	input_index TINYINT NOT NULL,
	asset CHAR(44) NULL,
	denomination INT NOT NULL DEFAULT 1,
	is_unique TINYINT NULL DEFAULT 1,
	type TEXT CHECK (type IN('transfer','headers_commission','witnessing','issue')) NOT NULL,
	src_unit CHAR(44) NULL, -- transfer
	src_message_index TINYINT NULL, -- transfer
	src_output_index TINYINT NULL, -- transfer
	from_main_chain_index INT NULL, -- witnessing/hc
	to_main_chain_index INT NULL, -- witnessing/hc
	serial_number BIGINT NULL, -- issue
	amount BIGINT NULL, -- issue
	address CHAR(32) NOT NULL,
	PRIMARY KEY (unit, message_index, input_index),
	UNIQUE  (src_unit, src_message_index, src_output_index, is_unique), -- UNIQUE guarantees there'll be no double spend for type=transfer
	UNIQUE  (type, from_main_chain_index, address, is_unique), -- UNIQUE guarantees there'll be no double spend for type=hc/witnessing
	UNIQUE  (asset, denomination, serial_number, address, is_unique), -- UNIQUE guarantees there'll be no double issue
	FOREIGN KEY (unit) REFERENCES units(unit),
	CONSTRAINT inputsBySrcUnit FOREIGN KEY (src_unit) REFERENCES units(unit),
	CONSTRAINT inputsByAddress FOREIGN KEY (address) REFERENCES addresses(address),
	CONSTRAINT inputsByAsset FOREIGN KEY (asset) REFERENCES assets(unit)
);
CREATE INDEX inputsIndexByAddress ON inputs(address);
CREATE INDEX inputsIndexByAddressTypeToMci ON inputs(address, type, to_main_chain_index);
CREATE INDEX inputsIndexByAssetType ON inputs(asset, type);


CREATE TABLE outputs (
	output_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	unit CHAR(44) NOT NULL,
	message_index TINYINT NOT NULL,
	output_index TINYINT NOT NULL,
	asset CHAR(44) NULL,
	denomination INT NOT NULL DEFAULT 1,
	address CHAR(32) NULL,  -- NULL if hidden by output_hash
	amount BIGINT NOT NULL,
	blinding CHAR(16) NULL,
	output_hash CHAR(44) NULL,
	is_serial TINYINT NULL, -- NULL if not stable yet
	is_spent TINYINT NOT NULL DEFAULT 0,
	UNIQUE (unit, message_index, output_index),
	FOREIGN KEY (unit) REFERENCES units(unit),
	CONSTRAINT outputsByAsset FOREIGN KEY (asset) REFERENCES assets(unit)
);
CREATE INDEX outputsByAddressSpent ON outputs(address, is_spent);
CREATE INDEX outputsIndexByAsset ON outputs(asset);
CREATE INDEX outputsIsSerial ON outputs(is_serial);

-- ------------
-- Commissions

-- updated immediately after main chain is updated
CREATE TABLE headers_commission_contributions (
	unit CHAR(44) NOT NULL, -- parent unit that pays commission
	address CHAR(32) NOT NULL, -- address of the commission receiver: author of child unit or address named in earned_headers_commission_recipients
	amount BIGINT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (unit, address),
	FOREIGN KEY (unit) REFERENCES units(unit)
);
CREATE INDEX hccbyAddress ON headers_commission_contributions(address);

CREATE TABLE headers_commission_outputs (
	main_chain_index INT NOT NULL, -- mci of the sponsoring (paying) unit
	address CHAR(32) NOT NULL, -- address of the commission receiver
	amount BIGINT NOT NULL,
	is_spent TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (main_chain_index, address)
);
-- CREATE INDEX hcobyAddressSpent ON headers_commission_outputs(address, is_spent);
CREATE UNIQUE INDEX hcobyAddressMci ON headers_commission_outputs(address, main_chain_index);
CREATE UNIQUE INDEX hcobyAddressSpentMci ON headers_commission_outputs(address, is_spent, main_chain_index);

CREATE TABLE paid_witness_events (
	unit CHAR(44) NOT NULL,
	address CHAR(32) NOT NULL, -- witness address
--    witnessed_in_ball CHAR(44) NOT NULL, -- if expired, MC ball next after expiry. Or NULL?
	delay TINYINT NULL, -- NULL if expired
	PRIMARY KEY (unit, address),
	FOREIGN KEY (unit) REFERENCES units(unit),
	FOREIGN KEY (address) REFERENCES addresses(address)
);
CREATE INDEX pweIndexByAddress ON paid_witness_events(address);


CREATE TABLE witnessing_outputs (
	main_chain_index INT NOT NULL,
	address CHAR(32) NOT NULL,
	amount BIGINT NOT NULL,
	is_spent TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (main_chain_index, address),
	FOREIGN KEY (address) REFERENCES addresses(address)
);
-- CREATE INDEX byWitnessAddressSpent ON witnessing_outputs(address, is_spent);
CREATE UNIQUE INDEX byWitnessAddressMci ON witnessing_outputs(address, main_chain_index);
CREATE UNIQUE INDEX byWitnessAddressSpentMci ON witnessing_outputs(address, is_spent, main_chain_index);


-- ---------------------------------------
-- Networking

CREATE TABLE dependencies (
	unit CHAR(44) NOT NULL,
	depends_on_unit CHAR(44) NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (depends_on_unit, unit)
);
CREATE INDEX depbyUnit ON dependencies(unit);

CREATE TABLE unhandled_joints (
	unit CHAR(44) NOT NULL PRIMARY KEY,
	peer VARCHAR(100) NOT NULL,
	json TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE archived_joints (
	unit CHAR(44) NOT NULL PRIMARY KEY,
	reason TEXT CHECK (reason IN('uncovered', 'voided')) NOT NULL,
--    is_retrievable TINYINT NOT NULL,
	json TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE known_bad_joints (
	joint CHAR(44) NULL UNIQUE,
	unit CHAR(44) NULL UNIQUE,
	json TEXT NOT NULL,
	error TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE joints (
	unit CHAR(44) NOT NULL PRIMARY KEY,
	json TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);


CREATE TABLE unhandled_private_payments (
	unit CHAR(44) NOT NULL,
	message_index TINYINT NOT NULL,
	output_index TINYINT NOT NULL,
	json TEXT NOT NULL,
	peer VARCHAR(100) NOT NULL,
	linked TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (unit, message_index, output_index)
);

-- ------------------
-- Catching up

CREATE TABLE hash_tree_balls (
	ball_index INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, -- in increasing level order
	ball CHAR(44) NOT NULL UNIQUE,
	unit CHAR(44) NOT NULL UNIQUE
);

CREATE TABLE catchup_chain_balls (
	member_index INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, -- in increasing level order
	ball CHAR(44) NOT NULL UNIQUE
);


-- ------------------------
-- Peers

CREATE TABLE peer_hosts (
	peer_host VARCHAR(100) NOT NULL PRIMARY KEY, -- domain or IP
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	count_new_good_joints INT NOT NULL DEFAULT 0,
	count_invalid_joints INT NOT NULL DEFAULT 0,
	count_nonserial_joints INT NOT NULL DEFAULT 0
);

CREATE TABLE peers (
	peer VARCHAR(100) NOT NULL PRIMARY KEY, -- wss:// address
	peer_host VARCHAR(100) NOT NULL, -- domain or IP
	learnt_from_peer_host VARCHAR(100) NULL, -- domain or IP
	is_self TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (learnt_from_peer_host) REFERENCES peer_hosts(peer_host),
	FOREIGN KEY (peer_host) REFERENCES peer_hosts(peer_host)
);
CREATE INDEX peersIndexByPeerHost ON peers(peer_host);
CREATE INDEX peersIndexByLearntHost ON peers(learnt_from_peer_host);

-- INSERT INTO peer_hosts (peer_host) VALUES('127.0.0.1');
-- INSERT INTO peers (peer_host, peer) VALUES('127.0.0.1', 'ws://127.0.0.1:8081');

CREATE TABLE peer_events (
	peer_host VARCHAR(100) NOT NULL, -- domain or IP
	event_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	event TEXT CHECK (event IN('new_good', 'invalid', 'nonserial', 'known_good', 'known_bad')) NOT NULL,
	FOREIGN KEY (peer_host) REFERENCES peer_hosts(peer_host)
);
CREATE INDEX peerEventsIndexByPeerHost ON peer_events(peer_host);

-- self advertised urls
-- only inbound peers can advertise their urls
CREATE TABLE peer_host_urls (
	peer_host VARCHAR(100) NOT NULL, -- IP
	url VARCHAR(100) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	is_active TINYINT NULL DEFAULT 1,
	revocation_date TIMESTAMP NULL,
	UNIQUE  (peer_host, is_active),
	FOREIGN KEY (peer_host) REFERENCES peer_hosts(peer_host)
);






-- -----------------------
-- wallet tables

-- wallets composed of BIP44 keys, the keys live on different devices, each device knows each other's extended public key
CREATE TABLE wallets (
	wallet CHAR(44) NOT NULL PRIMARY KEY,
	account INT NOT NULL,
	definition_template TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	full_approval_date TIMESTAMP NULL,
	ready_date TIMESTAMP NULL -- when all members notified me that they saw the wallet fully approved
);

-- BIP44 addresses. Coin type and account are fixed and stored in credentials in localstorage.
-- derivation path is m/44'/0'/account'/is_change/address_index
CREATE TABLE my_addresses (
	address CHAR(32) NOT NULL PRIMARY KEY,
	wallet CHAR(44) NOT NULL,
	is_change TINYINT NOT NULL,
	address_index INT NOT NULL,
	definition TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (wallet, is_change, address_index),
	FOREIGN KEY (wallet) REFERENCES wallets(wallet)
);

CREATE TABLE my_witnesses (
	address CHAR(32) NOT NULL PRIMARY KEY
);


-- --------------------
-- hub tables

CREATE TABLE devices (
	device_address CHAR(33) NOT NULL PRIMARY KEY,
	pubkey CHAR(44) NOT NULL,
	temp_pubkey_package TEXT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE device_messages (
	message_hash CHAR(44) NOT NULL PRIMARY KEY,
	device_address CHAR(33) NOT NULL, -- the device this message is addressed to
	message TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (device_address) REFERENCES devices(device_address)
);
CREATE INDEX deviceMessagesIndexByDeviceAddress ON device_messages(device_address);


-- --------------------
-- hub client tables

CREATE TABLE correspondent_devices (
	device_address CHAR(33) NOT NULL PRIMARY KEY,
	name VARCHAR(100) NOT NULL,
	pubkey CHAR(44) NOT NULL,
	hub VARCHAR(100) NOT NULL, -- domain name of the hub this address is subscribed to
	is_confirmed TINYINT NOT NULL DEFAULT 0,
	is_indirect TINYINT NOT NULL DEFAULT 0,
	is_blackhole TINYINT NOT NULL DEFAULT 0,
	push_enabled TINYINT NOT NULL DEFAULT 1,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pairing_secrets (
	pairing_secret VARCHAR(40) NOT NULL PRIMARY KEY,
	is_permanent TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	expiry_date TIMESTAMP NOT NULL
);

CREATE TABLE extended_pubkeys (
	wallet CHAR(44) NOT NULL, -- no FK because xpubkey may arrive earlier than the wallet is approved by the user and written to the db
	extended_pubkey CHAR(112) NULL, -- base58 encoded, see bip32, NULL while pending
	device_address CHAR(33) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	approval_date TIMESTAMP NULL,
	member_ready_date TIMESTAMP NULL, -- when this member notified us that he has collected all member xpubkeys
	PRIMARY KEY (wallet, device_address)
	-- own address is not present in correspondents
--    FOREIGN KEY byDeviceAddress(device_address) REFERENCES correspondent_devices(device_address)
);

CREATE TABLE wallet_signing_paths (
	wallet CHAR(44) NOT NULL, -- no FK because xpubkey may arrive earlier than the wallet is approved by the user and written to the db
	signing_path VARCHAR(255) NULL, -- NULL if xpubkey arrived earlier than the wallet was approved by the user
	device_address CHAR(33) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (wallet, signing_path),
	FOREIGN KEY (wallet) REFERENCES wallets(wallet)
	-- own address is not present in correspondents
--    FOREIGN KEY byDeviceAddress(device_address) REFERENCES correspondent_devices(device_address)
);

CREATE TABLE my_watched_addresses (
	address CHAR(32) NOT NULL PRIMARY KEY,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- addresses composed of several other addresses (such as ["and", [["address", "ADDRESS1"], ["address", "ADDRESS2"]]]), 
-- member addresses live on different devices, member addresses themselves may be composed of several keys
CREATE TABLE shared_addresses (
	shared_address CHAR(32) NOT NULL PRIMARY KEY,
	definition TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pending_shared_addresses (
	definition_template_chash CHAR(32) NOT NULL PRIMARY KEY,
	definition_template TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE pending_shared_address_signing_paths (
	definition_template_chash CHAR(32) NOT NULL,
	device_address CHAR(33) NOT NULL,
	signing_path TEXT NOT NULL, -- path from root to member address
	address CHAR(32) NULL, -- member address
	device_addresses_by_relative_signing_paths TEXT NULL, -- json
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	approval_date TIMESTAMP NULL,
	PRIMARY KEY (definition_template_chash, signing_path),
	-- own address is not present in correspondents
--    FOREIGN KEY byDeviceAddress(device_address) REFERENCES correspondent_devices(device_address),
	FOREIGN KEY (definition_template_chash) REFERENCES pending_shared_addresses(definition_template_chash)
);

CREATE TABLE shared_address_signing_paths (
	shared_address CHAR(32) NOT NULL,
	signing_path VARCHAR(255) NULL, -- full path to signing key which is a member of the member address
	address CHAR(32) NOT NULL, -- member address
	member_signing_path VARCHAR(255) NULL, -- path to signing key from root of the member address
	device_address CHAR(33) NOT NULL, -- where this signing key lives or is reachable through
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (shared_address, signing_path),
	FOREIGN KEY (shared_address) REFERENCES shared_addresses(shared_address)
	-- own address is not present in correspondents
--    FOREIGN KEY byDeviceAddress(device_address) REFERENCES correspondent_devices(device_address)
);
CREATE INDEX sharedAddressSigningPathsByDeviceAddress ON shared_address_signing_paths(device_address);

CREATE TABLE outbox (
	message_hash CHAR(44) NOT NULL PRIMARY KEY,
	`to` CHAR(33) NOT NULL, -- the device this message is addressed to, no FK because of pairing case
	message TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_error TEXT NULL
);


-- light clients

CREATE TABLE watched_light_addresses (
	peer VARCHAR(100) NOT NULL,
	address CHAR(32) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (peer, address)
);
CREATE INDEX wlabyAddress ON watched_light_addresses(address);

CREATE INDEX "bySequence" ON "units" ("sequence");

DROP TABLE IF EXISTS paid_witness_events;


CREATE TABLE IF NOT EXISTS push_registrations (
    registrationId TEXT, 
    device_address TEXT NOT NULL,
    platform TEXT NOT NULL,
    PRIMARY KEY (device_address)
);

CREATE TABLE chat_messages (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	correspondent_address CHAR(33) NOT NULL,
	message LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	is_incoming INTEGER(1) NOT NULL,
	type CHAR(15) NOT NULL DEFAULT 'text',
	FOREIGN KEY (correspondent_address) REFERENCES correspondent_devices(device_address) ON DELETE CASCADE
);
CREATE INDEX chatMessagesIndexByDeviceAddress ON chat_messages(correspondent_address, id);
ALTER TABLE correspondent_devices ADD COLUMN my_record_pref INTEGER DEFAULT 1;
ALTER TABLE correspondent_devices ADD COLUMN peer_record_pref INTEGER DEFAULT 1;

CREATE TABLE watched_light_units (
	peer VARCHAR(100) NOT NULL,
	unit CHAR(44) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (peer, unit)
);
CREATE INDEX wlabyUnit ON watched_light_units(unit);

CREATE TABLE bots (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	rank INTEGER NOT NULL DEFAULT 0,
	name VARCHAR(100) NOT NULL UNIQUE,
	pairing_code VARCHAR(200) NOT NULL,
	description LONGTEXT NOT NULL
);

CREATE TABLE asset_metadata (
	asset CHAR(44) NOT NULL PRIMARY KEY,
	metadata_unit CHAR(44) NOT NULL,
	registry_address CHAR(32) NULL, -- filled only on the hub
	suffix VARCHAR(20) NULL, -- added only if the same name is registered by different registries for different assets, equal to registry name
	name VARCHAR(20) NULL,
	decimals TINYINT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (name, registry_address),
	FOREIGN KEY (asset) REFERENCES assets(unit),
	FOREIGN KEY (metadata_unit) REFERENCES units(unit)
--	FOREIGN KEY (registry_address) REFERENCES addresses(address) -- addresses is not always filled on light
);

CREATE TABLE sent_mnemonics (
	unit CHAR(44) NOT NULL,
	address CHAR(32) NOT NULL,
	mnemonic VARCHAR(107) NOT NULL,
	textAddress VARCHAR(120) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (unit) REFERENCES units(unit)
);
CREATE INDEX sentByAddress ON sent_mnemonics(address);
CREATE INDEX sentByUnit ON sent_mnemonics(unit);

CREATE TABLE private_profiles (
	private_profile_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	unit CHAR(44) NOT NULL,
	payload_hash CHAR(44) NOT NULL,
	attestor_address CHAR(32) NOT NULL,
	address CHAR(32) NOT NULL,
	src_profile TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (unit) REFERENCES units(unit)
);
CREATE UNIQUE INDEX IF NOT EXISTS unqPayloadHash ON private_profiles(payload_hash);

CREATE TABLE private_profile_fields (
	private_profile_id INTEGER NOT NULL ,
	`field` VARCHAR(50) NOT NULL,
	`value` VARCHAR(50) NOT NULL,
	blinding CHAR(16) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (private_profile_id, `field`),
	FOREIGN KEY (private_profile_id) REFERENCES private_profiles(private_profile_id)
);
CREATE INDEX ppfByField ON private_profile_fields(`field`);


CREATE TABLE attested_fields (
	unit CHAR(44) NOT NULL,
	message_index TINYINT NOT NULL,
	attestor_address CHAR(32) NOT NULL,
	address CHAR(32) NOT NULL,
	`field` VARCHAR(50) NOT NULL,
	`value` VARCHAR(100) NOT NULL,
	PRIMARY KEY (unit, message_index, `field`),
	CONSTRAINT attestationsByAttestorAddress FOREIGN KEY (attestor_address) REFERENCES addresses(address),
	FOREIGN KEY (unit) REFERENCES units(unit)
);
CREATE INDEX attestedFieldsByAttestorFieldValue ON attested_fields(attestor_address, `field`, `value`);
CREATE INDEX attestedFieldsByAddressField ON attested_fields(address, `field`);


-- user enters an email address (it is original address) and it is translated to BB address
CREATE TABLE original_addresses (
	unit CHAR(44) NOT NULL,
	address CHAR(32) NOT NULL,
	original_address VARCHAR(100) NOT NULL, -- email
	PRIMARY KEY (unit, address),
	FOREIGN KEY (unit) REFERENCES units(unit)
);

CREATE TABLE peer_addresses (
	address CHAR(32) NOT NULL,
	signing_paths VARCHAR(255) NULL,
	device_address CHAR(33) NOT NULL,
	definition TEXT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (address),
	FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address)
);

CREATE TABLE prosaic_contracts (
	hash CHAR(44) NOT NULL PRIMARY KEY,
	peer_address CHAR(32) NOT NULL,
	peer_device_address CHAR(33) NOT NULL,
	my_address  CHAR(32) NOT NULL,
	is_incoming TINYINT NOT NULL,
	creation_date TIMESTAMP NOT NULL,
	ttl REAL NOT NULL DEFAULT 168, -- 168 hours = 24 * 7 = 1 week
	status TEXT CHECK (status IN('pending', 'revoked', 'accepted', 'declined')) NOT NULL DEFAULT 'active',
	title VARCHAR(1000) NOT NULL,
	`text` TEXT NOT NULL,
	shared_address CHAR(32),
	unit CHAR(44),
	cosigners VARCHAR(1500),
	FOREIGN KEY (my_address) REFERENCES my_addresses(address)
);

-- hub table
CREATE TABLE correspondent_settings (
	device_address CHAR(33) NOT NULL,
	correspondent_address CHAR(33) NOT NULL,
	push_enabled TINYINT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (device_address, correspondent_address)
);


-- Autonomous agents

CREATE TABLE aa_addresses (
	address CHAR(32) NOT NULL PRIMARY KEY,
	unit CHAR(44) NOT NULL, -- where it is first defined.  No index for better speed
	mci INT NOT NULL, -- it is available since this mci (mci of the above unit)
	definition TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- the table is a queue, it is almost always empty and any entries are short-lived
-- INSERTs are wrapped in the same SQL transactions that write the triggering units
-- secondary triggers are not written here
CREATE TABLE aa_triggers (
	mci INT NOT NULL,
	unit CHAR(44) NOT NULL,
	address CHAR(32) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (mci, unit, address),
	FOREIGN KEY (address) REFERENCES aa_addresses(address)
);

-- SQL is more convenient for +- the balances
CREATE TABLE aa_balances (
	address CHAR(32) NOT NULL,
	asset CHAR(44) NOT NULL, -- 'base' for bytes (NULL would not work for uniqueness of primary key)
	balance BIGINT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (address, asset),
	FOREIGN KEY (address) REFERENCES aa_addresses(address)
--	FOREIGN KEY (asset) REFERENCES assets(unit)
);

-- this is basically a log.  It has many indexes to be searchable by various fields
CREATE TABLE aa_responses (
	aa_response_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	mci INT NOT NULL, -- mci of the trigger unit
	trigger_address CHAR(32) NOT NULL, -- trigger address
	aa_address CHAR(32) NOT NULL,
	trigger_unit CHAR(44) NOT NULL,
	bounced TINYINT NOT NULL,
	response_unit CHAR(44) NULL UNIQUE,
	response TEXT NULL, -- json
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (trigger_unit, aa_address),
	FOREIGN KEY (aa_address) REFERENCES aa_addresses(address),
	FOREIGN KEY (trigger_unit) REFERENCES units(unit)
--	FOREIGN KEY (response_unit) REFERENCES units(unit)
);
CREATE INDEX aaResponsesByTriggerAddress ON aa_responses(trigger_address);
CREATE INDEX aaResponsesByAAAddress ON aa_responses(aa_address);
CREATE INDEX aaResponsesByMci ON aa_responses(mci);


PRAGMA user_version=31;
