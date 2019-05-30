CREATE TABLE units (
	unit CHAR(44) BINARY NOT NULL PRIMARY KEY, -- sha256 in base64
	creation_date timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	version VARCHAR(10) NOT NULL DEFAULT '1.0',
	alt VARCHAR(3) NOT NULL DEFAULT '1',
	witness_list_unit CHAR(44) BINARY NULL,
	last_ball_unit CHAR(44) BINARY NULL,
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
	sequence ENUM('good','temp-bad','final-bad') NOT NULL DEFAULT 'good',
	best_parent_unit CHAR(44) BINARY NULL,
	KEY byMainChain(is_on_main_chain),
	KEY byMcIndex(main_chain_index),
	KEY byLimci(latest_included_mc_index),
	KEY byLevel(level),
	KEY byFree(is_free),
	KEY byStableMci(is_stable, main_chain_index),
	KEY byDate(creation_date),
	KEY (last_ball_unit),
	KEY (best_parent_unit),
	KEY (witness_list_unit)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE balls (
	ball CHAR(44) BINARY NOT NULL PRIMARY KEY, -- sha256 in base64
	creation_date timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	unit CHAR(44) BINARY NOT NULL UNIQUE, -- sha256 in base64
	-- count_witnesses TINYINT NOT NULL DEFAULT 0,
	count_paid_witnesses TINYINT NULL,
	KEY byCountPaidWitnesses(count_paid_witnesses),
	KEY (unit)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE skiplist_units (
	unit CHAR(44) BINARY NOT NULL,
	skiplist_unit CHAR(44) BINARY NOT NULL, -- only for MC units with MCI divisible by 10: previous MC units divisible by 10
	PRIMARY KEY (unit, skiplist_unit),
	KEY (skiplist_unit)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;




-- must be sorted by parent_unit
CREATE TABLE parenthoods (
	child_unit CHAR(44) BINARY NOT NULL,
	parent_unit CHAR(44) BINARY NOT NULL,
	PRIMARY KEY (parent_unit, child_unit),
	KEY (child_unit)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;



CREATE TABLE definitions (
	definition_chash CHAR(32) BINARY NOT NULL PRIMARY KEY,
	definition TEXT NOT NULL,
	has_references TINYINT NOT NULL
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- current list of all known from-addresses
CREATE TABLE addresses (
	address CHAR(32) BINARY NOT NULL PRIMARY KEY,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- must be sorted by address
CREATE TABLE unit_authors (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	definition_chash CHAR(32) BINARY NULL, -- only with 1st ball from this address, and with next ball after definition change
	_mci INT NULL,
	PRIMARY KEY (unit, address),
	KEY unitAuthorsIndexByAddressMci (address, _mci),
	KEY (definition_chash)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


CREATE TABLE authentifiers (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	path VARCHAR(40) BINARY NOT NULL,
	authentifier VARCHAR(4096) BINARY NOT NULL,
	PRIMARY KEY (unit, address, path),
	KEY (address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- must be sorted by address
CREATE TABLE unit_witnesses (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	PRIMARY KEY (unit, address),
	KEY byAddress(address) -- no foreign key as the address might not be used yet
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE witness_list_hashes (
	witness_list_unit CHAR(44) BINARY NOT NULL PRIMARY KEY,
	witness_list_hash CHAR(44) BINARY NOT NULL UNIQUE,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- if this ball wins headers commission from at least one of the included balls, how it is distributed
-- required if more than one author
-- if one author, all commission goes to the author by default
CREATE TABLE earned_headers_commission_recipients (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	earned_headers_commission_share INT NOT NULL, -- percentage
	PRIMARY KEY (unit, address),
	KEY byAddress(address) -- no foreign key as the address might not be used yet
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


CREATE TABLE messages (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	app VARCHAR(30) BINARY NOT NULL,
	payload_location ENUM('inline','uri','none') NOT NULL,
	payload_hash CHAR(44) BINARY NOT NULL,
	payload TEXT NULL,
	payload_uri_hash CHAR(44) BINARY NULL,
	payload_uri VARCHAR(500) BINARY NULL,
	PRIMARY KEY (unit, message_index)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- must be sorted by spend_proof
CREATE TABLE spend_proofs (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	spend_proof_index TINYINT NOT NULL,
	spend_proof CHAR(44) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	PRIMARY KEY (unit, message_index, spend_proof_index),
	UNIQUE KEY bySpendProof(spend_proof, unit),
	KEY (address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- -------------------------
-- Specific message types


CREATE TABLE address_definition_changes (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	definition_chash CHAR(32) BINARY NOT NULL, -- might not be defined in definitions yet (almost always, it is not defined)
	PRIMARY KEY (unit, message_index),
	UNIQUE KEY byAddressUnit(address, unit)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


CREATE TABLE data_feeds (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	feed_name VARCHAR(64) BINARY NOT NULL,
	-- type ENUM('string', 'number') NOT NULL,
	`value` VARCHAR(64) BINARY NULL,
	`int_value` BIGINT NULL,
	PRIMARY KEY (unit, feed_name),
	KEY byNameStringValue(feed_name, `value`),
	KEY byNameIntValue(feed_name, `int_value`)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE polls (
	unit CHAR(44) BINARY NOT NULL PRIMARY KEY,
	message_index TINYINT NOT NULL,
	question VARCHAR(4096) BINARY NOT NULL
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE poll_choices (
	unit CHAR(44) BINARY NOT NULL,
	choice_index TINYINT NOT NULL,
	choice VARCHAR(64) BINARY NOT NULL,
	PRIMARY KEY (unit, choice_index),
	UNIQUE KEY (unit, choice)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE votes (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	poll_unit CHAR(44) BINARY NOT NULL,
	choice VARCHAR(64) BINARY NOT NULL,
	PRIMARY KEY (unit, message_index),
	UNIQUE KEY (unit, choice),
	KEY (poll_unit, choice)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE attestations (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	attestor_address CHAR(32) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	-- name VARCHAR(44) BINARY NOT NULL,
	PRIMARY KEY (unit, message_index),
	KEY byAddress(address),
	KEY (attestor_address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


CREATE TABLE assets (
	unit CHAR(44) BINARY NOT NULL PRIMARY KEY,
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
	transfer_condition TEXT NULL
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE asset_denominations (
	asset CHAR(44) BINARY NOT NULL,
	denomination INT NOT NULL,
	count_coins BIGINT NULL,
	max_issued_serial_number BIGINT NOT NULL DEFAULT 0,
	PRIMARY KEY (asset, denomination)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE asset_attestors (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	asset CHAR(44) BINARY NOT NULL, -- in the initial attestor list: same as unit
	attestor_address CHAR(32) BINARY NOT NULL,
	PRIMARY KEY (unit, message_index, attestor_address),
	UNIQUE KEY byAssetAttestorUnit(asset, attestor_address, unit)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- -------------------------
-- Payments

CREATE TABLE inputs (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	input_index TINYINT NOT NULL,
	asset CHAR(44) BINARY NULL,
	denomination INT NOT NULL DEFAULT 1,
	is_unique TINYINT NULL DEFAULT 1,
	type ENUM('transfer','headers_commission','witnessing','issue') NOT NULL,
	src_unit CHAR(44) BINARY NULL, -- transfer
	src_message_index TINYINT NULL, -- transfer
	src_output_index TINYINT NULL, -- transfer
	from_main_chain_index INT NULL, -- witnessing/hc
	to_main_chain_index INT NULL, -- witnessing/hc
	serial_number BIGINT NULL, -- issue
	amount BIGINT NULL, -- issue
	address CHAR(32) BINARY NOT NULL,
	PRIMARY KEY (unit, message_index, input_index),
	UNIQUE KEY bySrcOutput(src_unit, src_message_index, src_output_index, is_unique), -- UNIQUE guarantees there'll be no double spend for type=transfer
	UNIQUE KEY byIndexAddress(type, from_main_chain_index, address, is_unique), -- UNIQUE guarantees there'll be no double spend for type=hc/witnessing
	UNIQUE KEY byAssetDenominationSerialAddress(asset, denomination, serial_number, address, is_unique), -- UNIQUE guarantees there'll be no double issue
	KEY byAssetType(asset, type),
	KEY byAddressTypeToMci(address, type, to_main_chain_index),
	KEY (src_unit),
	KEY (address),
	KEY (asset)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE outputs (
	output_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	output_index TINYINT NOT NULL,
	asset CHAR(44) BINARY NULL,
	denomination INT NOT NULL DEFAULT 1,
	address CHAR(32) BINARY NULL, -- NULL if hidden by output_hash
	amount BIGINT NOT NULL,
	blinding CHAR(16) BINARY NULL,
	output_hash CHAR(44) BINARY NULL,
	is_serial TINYINT NULL, -- NULL if not stable yet
	is_spent TINYINT NOT NULL DEFAULT 0,
	UNIQUE KEY (unit, message_index, output_index),
	KEY byAddressSpent(address, is_spent),
	KEY bySerial(is_serial),
	KEY (asset)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------
-- Commissions

-- updated immediately after main chain is updated
CREATE TABLE headers_commission_contributions (
	unit CHAR(44) BINARY NOT NULL, -- parent unit that pays commission
	address CHAR(32) BINARY NOT NULL, -- address of the commission receiver: author of child unit or address named in earned_headers_commission_recipients
	amount BIGINT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (unit, address),
	KEY byAddress(address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE headers_commission_outputs (
	main_chain_index INT NOT NULL,
	address CHAR(32) BINARY NOT NULL, -- address of the commission receiver
	amount BIGINT NOT NULL,
	is_spent TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (main_chain_index, address),
	UNIQUE (address, main_chain_index),
	UNIQUE (address, is_spent, main_chain_index)
	-- KEY byAddressSpent(address, is_spent)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE paid_witness_events (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL, -- witness address
	-- witnessed_in_ball CHAR(44) BINARY NOT NULL, -- if expired, MC ball next after expiry. Or NULL?
	delay TINYINT NULL, -- NULL if expired
	PRIMARY KEY (unit, address),
	KEY (address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE witnessing_outputs (
	main_chain_index INT NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	amount BIGINT NOT NULL,
	is_spent TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (main_chain_index, address),
	UNIQUE (address, main_chain_index),
	UNIQUE (address, is_spent, main_chain_index)
	-- KEY byWitnessAddressSpent(address, is_spent),
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;



-- ---------------------------------------
-- Networking

CREATE TABLE dependencies (
	unit CHAR(44) BINARY NOT NULL,
	depends_on_unit CHAR(44) BINARY NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY (depends_on_unit, unit),
	KEY byUnit(unit)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE unhandled_joints (
	unit CHAR(44) BINARY NOT NULL PRIMARY KEY,
	peer VARCHAR(100) BINARY NOT NULL,
	json LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE archived_joints (
	unit CHAR(44) BINARY NOT NULL PRIMARY KEY,
	reason ENUM('uncovered', 'voided') NOT NULL,
	-- is_retrievable TINYINT NOT NULL,
	json LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


CREATE TABLE known_bad_joints (
	joint CHAR(44) BINARY NULL UNIQUE,
	unit CHAR(44) BINARY NULL UNIQUE,
	json LONGTEXT NOT NULL,
	error TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE joints (
	unit CHAR(44) BINARY NOT NULL PRIMARY KEY,
	json LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE unhandled_private_payments (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	output_index TINYINT NOT NULL,
	json LONGTEXT NOT NULL,
	peer VARCHAR(100) BINARY NOT NULL,
	linked TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (unit, message_index, output_index)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- ------------------
-- Catching up

CREATE TABLE hash_tree_balls (
	ball_index INT NOT NULL PRIMARY KEY AUTO_INCREMENT, -- in increasing level order
	ball CHAR(44) BINARY NOT NULL UNIQUE,
	unit CHAR(44) BINARY NOT NULL UNIQUE
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE catchup_chain_balls (
	member_index INT NOT NULL PRIMARY KEY AUTO_INCREMENT, -- in increasing level order
	ball CHAR(44) BINARY NOT NULL UNIQUE
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- ------------------------
-- Peers

CREATE TABLE peer_hosts (
	peer_host VARCHAR(100) BINARY NOT NULL PRIMARY KEY, -- domain or IP
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	count_new_good_joints INT NOT NULL DEFAULT 0,
	count_invalid_joints INT NOT NULL DEFAULT 0,
	count_nonserial_joints INT NOT NULL DEFAULT 0
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE peers (
	peer VARCHAR(100) BINARY NOT NULL PRIMARY KEY, -- wss:// address
	peer_host VARCHAR(100) BINARY NOT NULL, -- domain or IP
	learnt_from_peer_host VARCHAR(100) BINARY NULL, -- domain or IP
	is_self TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	KEY (learnt_from_peer_host),
	KEY (peer_host)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- INSERT INTO peer_hosts SET peer_host='127.0.0.1';
-- INSERT INTO peers SET peer_host='127.0.0.1', peer='ws://127.0.0.1:8081';

CREATE TABLE peer_events (
	peer_host VARCHAR(100) BINARY NOT NULL, -- domain or IP
	event_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	event ENUM('new_good', 'invalid', 'nonserial', 'known_good', 'known_bad') NOT NULL,
	KEY (peer_host)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- self advertised urls
-- only inbound peers can advertise their urls
CREATE TABLE peer_host_urls (
	peer_host VARCHAR(100) BINARY NOT NULL, -- IP
	url VARCHAR(100) BINARY NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	is_active TINYINT NULL DEFAULT 1,
	revocation_date TIMESTAMP NULL,
	UNIQUE KEY byHostActive(peer_host, is_active)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;






-- -----------------------
-- wallet tables

-- wallets composed of BIP44 keys, the keys live on different devices, each device knows each other's extended public key
CREATE TABLE wallets (
	wallet CHAR(44) BINARY NOT NULL PRIMARY KEY,
	account INT NOT NULL,
	definition_template TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	full_approval_date TIMESTAMP NULL, -- when received xpubkeys from all members
	ready_date TIMESTAMP NULL -- when all members notified me that they saw the wallet fully approved
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- BIP44 addresses. Coin type and account are fixed and stored in credentials in localstorage.
-- derivation path is m/44'/0'/account'/is_change/address_index
CREATE TABLE my_addresses (
	address CHAR(32) BINARY NOT NULL PRIMARY KEY,
	wallet CHAR(44) BINARY NOT NULL,
	is_change TINYINT NOT NULL,
	address_index INT NOT NULL,
	definition TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY byWalletPath(wallet, is_change, address_index)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE my_witnesses (
	address CHAR(32) BINARY NOT NULL PRIMARY KEY
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- --------------------
-- hub tables

CREATE TABLE devices (
	device_address CHAR(33) BINARY NOT NULL PRIMARY KEY,
	pubkey CHAR(44) BINARY NOT NULL,
	temp_pubkey_package TEXT NULL, -- temporary pubkey signed by the permanent pubkey
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE device_messages (
	message_hash CHAR(44) BINARY NOT NULL PRIMARY KEY,
	device_address CHAR(33) BINARY NOT NULL, -- the device this message is addressed to
	message LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	KEY (device_address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- --------------------
-- hub client tables

CREATE TABLE correspondent_devices (
	device_address CHAR(33) BINARY NOT NULL PRIMARY KEY,
	name VARCHAR(100) BINARY NOT NULL,
	pubkey CHAR(44) BINARY NOT NULL,
	hub VARCHAR(100) BINARY NOT NULL, -- domain name of the hub this address is subscribed to
	is_confirmed TINYINT NOT NULL DEFAULT 0,
	is_indirect TINYINT NOT NULL DEFAULT 0,
	is_blackhole TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE pairing_secrets (
	pairing_secret VARCHAR(40) BINARY NOT NULL PRIMARY KEY,
	is_permanent TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	expiry_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP  -- DEFAULT for newer mysql versions (never used)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE extended_pubkeys (
	wallet CHAR(44) BINARY NOT NULL, -- no FK because xpubkey may arrive earlier than the wallet is approved by the user and written to the db
	extended_pubkey CHAR(112) BINARY NULL, -- base58 encoded, see bip32, NULL while pending
	device_address CHAR(33) BINARY NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	approval_date TIMESTAMP NULL,
	member_ready_date TIMESTAMP NULL, -- when this member notified us that he has collected all member xpubkeys
	PRIMARY KEY (wallet, device_address)
	-- own address is not present in correspondents
	-- FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE wallet_signing_paths (
	wallet CHAR(44) BINARY NOT NULL, -- no FK because xpubkey may arrive earlier than the wallet is approved by the user and written to the db
	signing_path VARCHAR(255) BINARY CHARACTER SET latin1 COLLATE latin1_general_cs NULL, -- NULL if xpubkey arrived earlier than the wallet was approved by the user
	device_address CHAR(33) BINARY NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY byWalletSigningPath(wallet, signing_path)
	-- own address is not present in correspondents
	-- FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- addresses composed of several other addresses (such as ["and", [["address", "ADDRESS1"], ["address", "ADDRESS2"]]]),
-- member addresses live on different devices, member addresses themselves may be composed of several keys
CREATE TABLE shared_addresses (
	shared_address CHAR(32) BINARY NOT NULL PRIMARY KEY,
	definition TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE pending_shared_addresses (
	definition_template_chash CHAR(32) BINARY NOT NULL PRIMARY KEY,
	definition_template TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE pending_shared_address_signing_paths (
	definition_template_chash CHAR(32) BINARY NOT NULL,
	device_address CHAR(33) BINARY NOT NULL,
	signing_path VARCHAR(255) BINARY CHARACTER SET latin1 COLLATE latin1_general_cs NOT NULL, -- path from root to member address
	address CHAR(32) BINARY NULL, -- member address
	device_addresses_by_relative_signing_paths TEXT NULL, -- json
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	approval_date TIMESTAMP NULL,
	PRIMARY KEY (definition_template_chash, signing_path)
	-- own address is not present in correspondents
	-- FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address),
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE shared_address_signing_paths (
	shared_address CHAR(32) BINARY NOT NULL,
	signing_path VARCHAR(255) BINARY CHARACTER SET latin1 COLLATE latin1_general_cs NULL, -- full path to signing key which is a member of the member address
	address CHAR(32) BINARY NOT NULL, -- member address
	member_signing_path VARCHAR(255) BINARY CHARACTER SET latin1 COLLATE latin1_general_cs NULL, -- path to signing key from root of the member address
	device_address CHAR(33) BINARY NOT NULL, -- where this signing key lives or is reachable through
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY bySharedAddressSigningPath(shared_address, signing_path)
	-- own address is not present in correspondents
	-- FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
CREATE INDEX sharedAddressSigningPathsByDeviceAddress ON shared_address_signing_paths(device_address);

CREATE TABLE outbox (
	message_hash CHAR(44) BINARY NOT NULL PRIMARY KEY,
	`to` CHAR(33) BINARY NOT NULL, -- the device this message is addressed to, no FK because of pairing case
	message LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_error TEXT NULL
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


-- light clients

CREATE TABLE watched_light_addresses (
	peer VARCHAR(100) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (peer, address),
	KEY byAddress(address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


ALTER TABLE `units` ADD INDEX `bySequence` (`sequence`);

DROP TABLE IF EXISTS paid_witness_events;

CREATE TABLE IF NOT EXISTS push_registrations (
	registrationId VARCHAR(200) BINARY,
	device_address CHAR(33) BINARY NOT NULL,
	platform VARCHAR(20) BINARY NOT NULL,
	PRIMARY KEY (device_address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE chat_messages (
	id INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
	correspondent_address CHAR(33) BINARY NOT NULL, -- the device this message is came from
	message LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	is_incoming TINYINT NOT NULL,
	type CHAR(15) BINARY NOT NULL DEFAULT 'text',
	KEY (correspondent_address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
CREATE INDEX chatMessagesIndexByDeviceAddress ON chat_messages(correspondent_address, id);
ALTER TABLE correspondent_devices ADD COLUMN my_record_pref INTEGER DEFAULT 1;
ALTER TABLE correspondent_devices ADD COLUMN peer_record_pref INTEGER DEFAULT 1;

CREATE TABLE watched_light_units (
	peer VARCHAR(100) BINARY NOT NULL,
	unit CHAR(44) BINARY NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (peer, unit)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
CREATE INDEX wlabyUnit ON watched_light_units(unit);

CREATE TABLE bots (
	id INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
	rank INTEGER NOT NULL DEFAULT 0,
	name VARCHAR(100) BINARY NOT NULL UNIQUE,
	pairing_code VARCHAR(200) BINARY CHARACTER SET latin1 COLLATE latin1_general_cs NOT NULL,
	description LONGTEXT NOT NULL
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE asset_metadata (
	asset CHAR(44) BINARY NOT NULL PRIMARY KEY,
	metadata_unit CHAR(44) BINARY NOT NULL,
	registry_address CHAR(32) BINARY NULL, -- filled only on the hub
	suffix VARCHAR(20) BINARY NULL, -- added only if the same name is registered by different registries for different assets, equal to registry name
	name VARCHAR(20) BINARY NULL,
	decimals TINYINT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE byNameRegistry(name, registry_address),
	KEY (metadata_unit)
	-- FOREIGN KEY (registry_address) -- addresses is not always filled on light
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE sent_mnemonics (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	mnemonic VARCHAR(107) BINARY NOT NULL,
	textAddress VARCHAR(120) BINARY NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	KEY (unit)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
CREATE INDEX sentByAddress ON sent_mnemonics(address);

CREATE TABLE private_profiles (
	private_profile_id INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
	unit CHAR(44) BINARY NOT NULL,
	payload_hash CHAR(44) BINARY NOT NULL,
	attestor_address CHAR(32) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	src_profile TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	KEY (unit)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE private_profile_fields (
	private_profile_id INTEGER NOT NULL ,
	`field` VARCHAR(50) BINARY NOT NULL,
	`value` VARCHAR(50) BINARY NOT NULL,
	blinding CHAR(16) BINARY NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE byProfileIdField(private_profile_id, `field`)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
CREATE INDEX ppfByField ON private_profile_fields(`field`);


CREATE TABLE attested_fields (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	attestor_address CHAR(32) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	`field` VARCHAR(50) BINARY NOT NULL,
	`value` VARCHAR(100) BINARY NOT NULL,
	PRIMARY KEY (unit, message_index, `field`),
	KEY (attestor_address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;
CREATE INDEX attestedFieldsByAttestorFieldValue ON attested_fields(attestor_address, `field`, `value`);
CREATE INDEX attestedFieldsByAddressField ON attested_fields(address, `field`);


-- user enters an email address (it is original address) and it is translated to BB address
CREATE TABLE original_addresses (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) BINARY NOT NULL,
	original_address VARCHAR(100) BINARY NOT NULL, -- email
	PRIMARY KEY (unit, address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE peer_addresses (
	address CHAR(32) NOT NULL,
	signing_paths VARCHAR(255) NULL,
	device_address CHAR(33) NOT NULL,
	definition TEXT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (address),
	FOREIGN KEY (device_address) REFERENCES correspondent_devices(device_address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

CREATE TABLE prosaic_contracts (
	hash CHAR(32) NOT NULL PRIMARY KEY,
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
	FOREIGN KEY (peer_device_address) REFERENCES correspondent_devices(device_address),
	FOREIGN KEY (my_address) REFERENCES my_addresses(address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;

-- hub table
CREATE TABLE correspondent_settings (
	device_address CHAR(33) NOT NULL,
	correspondent_address CHAR(33) NOT NULL,
	push_enabled TINYINT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (device_address, correspondent_address)
) ENGINE=RocksDB  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_520_ci;


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
	PRIMARY KEY (mci, unit, address)
--	FOREIGN KEY (address) REFERENCES aa_addresses(address)
);

-- SQL is more convenient for +- the balances
CREATE TABLE aa_balances (
	address CHAR(32) NOT NULL,
	asset CHAR(44) NOT NULL, -- 'base' for bytes (NULL would not work for uniqueness of primary key)
	balance BIGINT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (address, asset)
--	FOREIGN KEY (address) REFERENCES aa_addresses(address)
--	FOREIGN KEY (asset) REFERENCES assets(unit)
);

-- this is basically a log.  It has many indexes to be searchable by various fields
CREATE TABLE aa_responses (
	aa_response_id INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
	mci INT NOT NULL, -- mci of the trigger unit
	trigger_address CHAR(32) NOT NULL, -- trigger address
	aa_address CHAR(32) NOT NULL,
	trigger_unit CHAR(44) NOT NULL,
	bounced TINYINT NOT NULL,
	response_unit CHAR(44) NULL UNIQUE,
	response TEXT NULL, -- json
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE (trigger_unit, aa_address)
--	FOREIGN KEY (aa_address) REFERENCES aa_addresses(address),
--	FOREIGN KEY (trigger_unit) REFERENCES units(unit)
--	FOREIGN KEY (response_unit) REFERENCES units(unit)
);
CREATE INDEX aaResponsesByTriggerAddress ON aa_responses(trigger_address);
CREATE INDEX aaResponsesByAAAddress ON aa_responses(aa_address);
CREATE INDEX aaResponsesByMci ON aa_responses(mci);

