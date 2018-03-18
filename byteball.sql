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
	CONSTRAINT unitsByLastBallUnit FOREIGN KEY byLastBallUnit(last_ball_unit) REFERENCES units(unit),
	FOREIGN KEY byBestParentUnit(best_parent_unit) REFERENCES units(unit),
	CONSTRAINT unitsByWitnessListUnit FOREIGN KEY byWitnessList(witness_list_unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE balls (
	ball CHAR(44) BINARY NOT NULL PRIMARY KEY, -- sha256 in base64
	creation_date timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	unit CHAR(44) BINARY NOT NULL UNIQUE, -- sha256 in base64
--  count_witnesses TINYINT NOT NULL DEFAULT 0,
	count_paid_witnesses TINYINT NULL,
	KEY byCountPaidWitnesses(count_paid_witnesses),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE skiplist_units (
	unit CHAR(44) BINARY NOT NULL,
	skiplist_unit CHAR(44) BINARY NOT NULL, -- only for MC units with MCI divisible by 10: previous MC units divisible by 10
	PRIMARY KEY (unit, skiplist_unit),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit),
	FOREIGN KEY bySkiplistUnit(skiplist_unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;




-- must be sorted by parent_unit
CREATE TABLE parenthoods (
	child_unit CHAR(44) BINARY NOT NULL,
	parent_unit CHAR(44) BINARY NOT NULL,
	PRIMARY KEY (parent_unit, child_unit),
	CONSTRAINT parenthoodsByChild FOREIGN KEY byChildUnit(child_unit) REFERENCES units(unit),
	CONSTRAINT parenthoodsByParent FOREIGN KEY byParentUnit(parent_unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;



CREATE TABLE definitions (
	definition_chash CHAR(32) NOT NULL PRIMARY KEY,
	definition TEXT NOT NULL,
	has_references TINYINT NOT NULL
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


-- current list of all known from-addresses
CREATE TABLE addresses (
	address CHAR(32) NOT NULL PRIMARY KEY,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


-- must be sorted by address
CREATE TABLE unit_authors (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) NOT NULL,
	definition_chash CHAR(32) NULL, -- only with 1st ball from this address, and with next ball after definition change
	_mci INT NULL,
	PRIMARY KEY (unit, address),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit),
	CONSTRAINT unitAuthorsByAddress FOREIGN KEY byAddress(address) REFERENCES addresses(address),
	KEY unitAuthorsIndexByAddressDefinitionChash (address, definition_chash),
	KEY unitAuthorsIndexByAddressMci (address, _mci),
	FOREIGN KEY byDefinition(definition_chash) REFERENCES definitions(definition_chash)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


CREATE TABLE authentifiers (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) NOT NULL,
	path VARCHAR(40) NOT NULL,
	authentifier VARCHAR(4096) NOT NULL,
	PRIMARY KEY (unit, address, path),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit),
	CONSTRAINT authentifiersByAddress FOREIGN KEY byAddress(address) REFERENCES addresses(address)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- must be sorted by address
CREATE TABLE unit_witnesses (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) NOT NULL,
	PRIMARY KEY (unit, address),
	KEY byAddress(address), -- no foreign key as the address might not be used yet
	FOREIGN KEY byUnit(unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE witness_list_hashes (
	witness_list_unit CHAR(44) BINARY NOT NULL PRIMARY KEY,
	witness_list_hash CHAR(44) NOT NULL UNIQUE,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY byUnit(witness_list_unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


-- if this ball wins headers commission from at least one of the included balls, how it is distributed
-- required if more than one author
-- if one author, all commission goes to the author by default
CREATE TABLE earned_headers_commission_recipients (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) NOT NULL,
	earned_headers_commission_share INT NOT NULL, -- percentage
	PRIMARY KEY (unit, address),
	KEY byAddress(address), -- no foreign key as the address might not be used yet
	FOREIGN KEY byUnit(unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


CREATE TABLE messages (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	app VARCHAR(30) NOT NULL,
	payload_location ENUM('inline','uri','none') NOT NULL,
	payload_hash CHAR(44) NOT NULL,
	payload TEXT NULL,
	payload_uri_hash CHAR(44) NULL,
	payload_uri VARCHAR(500) NULL,
	PRIMARY KEY (unit, message_index),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- must be sorted by spend_proof
CREATE TABLE spend_proofs (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	spend_proof_index TINYINT NOT NULL,
	spend_proof CHAR(44) NOT NULL,
	address CHAR(32) NOT NULL,
	PRIMARY KEY (unit, message_index, spend_proof_index),
	UNIQUE KEY bySpendProof(spend_proof, unit),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit),
	CONSTRAINT spendProofsByAddress FOREIGN KEY byAddress(address) REFERENCES addresses(address)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


-- -------------------------
-- Specific message types


CREATE TABLE address_definition_changes (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	address CHAR(32) NOT NULL,
	definition_chash CHAR(32) NOT NULL, -- might not be defined in definitions yet (almost always, it is not defined)
	PRIMARY KEY (unit, message_index),
	UNIQUE KEY byAddressUnit(address, unit),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit),
	CONSTRAINT addressDefinitionChangesByAddress FOREIGN KEY byAddress(address) REFERENCES addresses(address)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


CREATE TABLE data_feeds (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	feed_name VARCHAR(64) BINARY NOT NULL,
--    type ENUM('string', 'number') NOT NULL,
	`value` VARCHAR(64) BINARY NULL,
	`int_value` BIGINT NULL,
	PRIMARY KEY (unit, feed_name),
	KEY byNameStringValue(feed_name, `value`),
	KEY byNameIntValue(feed_name, `int_value`),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE polls (
	unit CHAR(44) BINARY NOT NULL PRIMARY KEY,
	message_index TINYINT NOT NULL,
	question VARCHAR(4096) NOT NULL,
	FOREIGN KEY byUnit(unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE poll_choices (
	unit CHAR(44) BINARY NOT NULL,
	choice_index TINYINT NOT NULL,
	choice VARCHAR(32) BINARY NOT NULL,
	PRIMARY KEY (unit, choice_index),
	UNIQUE KEY (unit, choice),
	FOREIGN KEY byPoll(unit) REFERENCES polls(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE votes (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	poll_unit CHAR(44) BINARY NOT NULL,
	choice VARCHAR(32) BINARY NOT NULL,
	PRIMARY KEY (unit, message_index),
	UNIQUE KEY (unit, choice),
	CONSTRAINT votesByChoice FOREIGN KEY byChoice(poll_unit, choice) REFERENCES poll_choices(unit, choice),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE attestations (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	attestor_address CHAR(32) NOT NULL,
	address CHAR(32) NOT NULL,
--	name VARCHAR(44) NOT NULL,
	PRIMARY KEY (unit, message_index),
	KEY byAddress(address),
	CONSTRAINT attestationsByAttestorAddress FOREIGN KEY byAttestorAddress(attestor_address) REFERENCES addresses(address),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


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
	transfer_condition TEXT NULL,
	FOREIGN KEY byUnit(unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE asset_denominations (
	asset CHAR(44) BINARY NOT NULL,
	denomination INT NOT NULL,
	count_coins BIGINT NULL,
	max_issued_serial_number BIGINT NOT NULL DEFAULT 0,
	PRIMARY KEY (asset, denomination),
	FOREIGN KEY byAsset(asset) REFERENCES assets(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE asset_attestors (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	asset CHAR(44) BINARY NOT NULL, -- in the initial attestor list: same as unit 
	attestor_address CHAR(32) NOT NULL,
	PRIMARY KEY (unit, message_index),
	UNIQUE KEY byAssetAttestorUnit(asset, attestor_address, unit),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit),
	CONSTRAINT assetAttestorsByAsset FOREIGN KEY byAsset(asset) REFERENCES assets(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


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
	address CHAR(32) NOT NULL,
	PRIMARY KEY (unit, message_index, input_index),
	UNIQUE KEY bySrcOutput(src_unit, src_message_index, src_output_index, is_unique), -- UNIQUE guarantees there'll be no double spend for type=transfer
	UNIQUE KEY byIndexAddress(type, from_main_chain_index, address, is_unique), -- UNIQUE guarantees there'll be no double spend for type=hc/witnessing
	UNIQUE KEY byAssetDenominationSerialAddress(asset, denomination, serial_number, address, is_unique), -- UNIQUE guarantees there'll be no double issue
	KEY byAssetType(asset, type),
	KEY byAddressTypeToMci(address, type, to_main_chain_index),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit),
	CONSTRAINT inputsBySrcUnit FOREIGN KEY bySrcUnit(src_unit) REFERENCES units(unit),
	CONSTRAINT inputsByAddress FOREIGN KEY byAddress(address) REFERENCES addresses(address),
	CONSTRAINT inputsByAsset FOREIGN KEY byAsset(asset) REFERENCES assets(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
	
CREATE TABLE outputs (
	output_id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	output_index TINYINT NOT NULL,
	asset CHAR(44) BINARY NULL,
	denomination INT NOT NULL DEFAULT 1,
	address CHAR(32) NULL, -- NULL if hidden by output_hash
	amount BIGINT NOT NULL,
	blinding CHAR(16) NULL,
	output_hash CHAR(44) NULL,
	is_serial TINYINT NULL, -- NULL if not stable yet
	is_spent TINYINT NOT NULL DEFAULT 0,
	UNIQUE KEY (unit, message_index, output_index),
	KEY byAddressSpent(address, is_spent),
	KEY bySerial(is_serial),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit),
	CONSTRAINT outputsByAsset FOREIGN KEY byAsset(asset) REFERENCES assets(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- ------------
-- Commissions

-- updated immediately after main chain is updated
CREATE TABLE headers_commission_contributions (
	unit CHAR(44) BINARY NOT NULL, -- parent unit that pays commission
	address CHAR(32) NOT NULL, -- address of the commission receiver: author of child unit or address named in earned_headers_commission_recipients
	amount BIGINT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (unit, address),
	KEY byAddress(address),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE headers_commission_outputs (
	main_chain_index INT NOT NULL,
	address CHAR(32) NOT NULL, -- address of the commission receiver
	amount BIGINT NOT NULL,
	is_spent TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (main_chain_index, address),
	UNIQUE (address, main_chain_index),
	UNIQUE (address, is_spent, main_chain_index)
--	KEY byAddressSpent(address, is_spent)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE paid_witness_events (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) NOT NULL, -- witness address
--    witnessed_in_ball CHAR(44) NOT NULL, -- if expired, MC ball next after expiry. Or NULL?
	delay TINYINT NULL, -- NULL if expired
	PRIMARY KEY (unit, address),
	FOREIGN KEY byUnit(unit) REFERENCES units(unit),
	FOREIGN KEY byWitnessAddress(address) REFERENCES addresses(address)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE witnessing_outputs (
	main_chain_index INT NOT NULL,
	address CHAR(32) NOT NULL,
	amount BIGINT NOT NULL,
	is_spent TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (main_chain_index, address),
	UNIQUE (address, main_chain_index),
	UNIQUE (address, is_spent, main_chain_index),
--	KEY byWitnessAddressSpent(address, is_spent),
	FOREIGN KEY byWitnessAddress(address) REFERENCES addresses(address)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;



-- ---------------------------------------
-- Networking

CREATE TABLE dependencies (
	unit CHAR(44) BINARY NOT NULL,
	depends_on_unit CHAR(44) BINARY NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY (depends_on_unit, unit),
	KEY byUnit(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE unhandled_joints (
	unit CHAR(44) BINARY NOT NULL PRIMARY KEY,
	peer VARCHAR(100) NOT NULL,
	json LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE archived_joints (
	unit CHAR(44) BINARY NOT NULL PRIMARY KEY,
	reason ENUM('uncovered', 'voided') NOT NULL,
--    is_retrievable TINYINT NOT NULL,
	json LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


CREATE TABLE known_bad_joints (
	joint CHAR(44) BINARY NULL UNIQUE,
	unit CHAR(44) BINARY NULL UNIQUE,
	json LONGTEXT NOT NULL,
	error TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE joints (
	unit CHAR(44) BINARY NOT NULL PRIMARY KEY,
	json LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE unhandled_private_payments (
	unit CHAR(44) BINARY NOT NULL,
	message_index TINYINT NOT NULL,
	output_index TINYINT NOT NULL,
	json LONGTEXT NOT NULL,
	peer VARCHAR(100) NOT NULL,
	linked TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (unit, message_index, output_index)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- ------------------
-- Catching up

CREATE TABLE hash_tree_balls (
	ball_index INT NOT NULL PRIMARY KEY AUTO_INCREMENT, -- in increasing level order
	ball CHAR(44) BINARY NOT NULL UNIQUE,
	unit CHAR(44) BINARY NOT NULL UNIQUE
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE catchup_chain_balls (
	member_index INT NOT NULL PRIMARY KEY AUTO_INCREMENT, -- in increasing level order
	ball CHAR(44) BINARY NOT NULL UNIQUE
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


-- ------------------------
-- Peers

CREATE TABLE peer_hosts (
	peer_host VARCHAR(100) NOT NULL PRIMARY KEY, -- domain or IP
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	count_new_good_joints INT NOT NULL DEFAULT 0,
	count_invalid_joints INT NOT NULL DEFAULT 0,
	count_nonserial_joints INT NOT NULL DEFAULT 0
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE peers (
	peer VARCHAR(100) NOT NULL PRIMARY KEY, -- wss:// address
	peer_host VARCHAR(100) NOT NULL, -- domain or IP
	learnt_from_peer_host VARCHAR(100) NULL, -- domain or IP
	is_self TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY byLearntFromPeerHost(learnt_from_peer_host) REFERENCES peer_hosts(peer_host),
	FOREIGN KEY byPeerHost(peer_host) REFERENCES peer_hosts(peer_host)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- INSERT INTO peer_hosts SET peer_host='127.0.0.1';
-- INSERT INTO peers SET peer_host='127.0.0.1', peer='ws://127.0.0.1:8081';

CREATE TABLE peer_events (
	peer_host VARCHAR(100) NOT NULL, -- domain or IP
	event_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	event ENUM('new_good', 'invalid', 'nonserial', 'known_good', 'known_bad') NOT NULL,
	FOREIGN KEY byPeerHost(peer_host) REFERENCES peer_hosts(peer_host)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- self advertised urls
-- only inbound peers can advertise their urls
CREATE TABLE peer_host_urls (
	peer_host VARCHAR(100) NOT NULL, -- IP
	url VARCHAR(100) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	is_active TINYINT NULL DEFAULT 1,
	revocation_date TIMESTAMP NULL,
	UNIQUE KEY byHostActive(peer_host, is_active),
	FOREIGN KEY byPeerHost(peer_host) REFERENCES peer_hosts(peer_host)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;






-- -----------------------
-- wallet tables

-- wallets composed of BIP44 keys, the keys live on different devices, each device knows each other's extended public key
CREATE TABLE wallets (
	wallet CHAR(44) NOT NULL PRIMARY KEY,
	account INT NOT NULL,
	definition_template TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	full_approval_date TIMESTAMP NULL, -- when received xpubkeys from all members
	ready_date TIMESTAMP NULL -- when all members notified me that they saw the wallet fully approved
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- BIP44 addresses. Coin type and account are fixed and stored in credentials in localstorage.
-- derivation path is m/44'/0'/account'/is_change/address_index
CREATE TABLE my_addresses (
	address CHAR(32) NOT NULL PRIMARY KEY,
	wallet CHAR(44) NOT NULL,
	is_change TINYINT NOT NULL,
	address_index INT NOT NULL,
	definition TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY byWalletPath(wallet, is_change, address_index),
	FOREIGN KEY byWallet(wallet) REFERENCES wallets(wallet)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE my_witnesses (
	address CHAR(32) NOT NULL PRIMARY KEY
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


-- --------------------
-- hub tables

CREATE TABLE devices (
	device_address CHAR(33) NOT NULL PRIMARY KEY,
	pubkey CHAR(44) NOT NULL,
	temp_pubkey_package TEXT NULL, -- temporary pubkey signed by the permanent pubkey
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE device_messages (
	message_hash CHAR(44) NOT NULL PRIMARY KEY,
	device_address CHAR(33) NOT NULL, -- the device this message is addressed to
	message LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY byAddress(device_address) REFERENCES devices(device_address)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


-- --------------------
-- hub client tables

CREATE TABLE correspondent_devices (
	device_address CHAR(33) NOT NULL PRIMARY KEY,
	name VARCHAR(100) NOT NULL,
	pubkey CHAR(44) NOT NULL,
	hub VARCHAR(100) NOT NULL, -- domain name of the hub this address is subscribed to
	is_confirmed TINYINT NOT NULL DEFAULT 0,
	is_indirect TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE pairing_secrets (
	pairing_secret VARCHAR(40) NOT NULL PRIMARY KEY,
	is_permanent TINYINT NOT NULL DEFAULT 0,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	expiry_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP  -- DEFAULT for newer mysql versions (never used)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

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
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE wallet_signing_paths (
	wallet CHAR(44) NOT NULL, -- no FK because xpubkey may arrive earlier than the wallet is approved by the user and written to the db
	signing_path VARCHAR(255) NULL, -- NULL if xpubkey arrived earlier than the wallet was approved by the user
	device_address CHAR(33) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY byWalletSigningPath(wallet, signing_path),
	FOREIGN KEY byWallet(wallet) REFERENCES wallets(wallet)
	-- own address is not present in correspondents
--    FOREIGN KEY byDeviceAddress(device_address) REFERENCES correspondent_devices(device_address)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

-- addresses composed of several other addresses (such as ["and", [["address", "ADDRESS1"], ["address", "ADDRESS2"]]]), 
-- member addresses live on different devices, member addresses themselves may be composed of several keys
CREATE TABLE shared_addresses (
	shared_address CHAR(32) NOT NULL PRIMARY KEY,
	definition TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE pending_shared_addresses (
	definition_template_chash CHAR(32) NOT NULL PRIMARY KEY,
	definition_template TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE pending_shared_address_signing_paths (
	definition_template_chash CHAR(32) NOT NULL,
	device_address CHAR(33) NOT NULL,
	signing_path VARCHAR(255) NOT NULL, -- path from root to member address
	address CHAR(32) NULL, -- member address
	device_addresses_by_relative_signing_paths TEXT NULL, -- json
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	approval_date TIMESTAMP NULL,
	PRIMARY KEY (definition_template_chash, signing_path),
	-- own address is not present in correspondents
--    FOREIGN KEY byDeviceAddress(device_address) REFERENCES correspondent_devices(device_address),
	FOREIGN KEY byTemplate(definition_template_chash) REFERENCES pending_shared_addresses(definition_template_chash)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE shared_address_signing_paths (
	shared_address CHAR(32) NOT NULL,
	signing_path VARCHAR(255) NULL, -- full path to signing key which is a member of the member address
	address CHAR(32) NOT NULL, -- member address
	member_signing_path VARCHAR(255) NULL, -- path to signing key from root of the member address
	device_address CHAR(33) NOT NULL, -- where this signing key lives or is reachable through
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY bySharedAddressSigningPath(shared_address, signing_path),
	FOREIGN KEY bySharedAddress(shared_address) REFERENCES shared_addresses(shared_address)
	-- own address is not present in correspondents
--    FOREIGN KEY byDeviceAddress(device_address) REFERENCES correspondent_devices(device_address)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


CREATE TABLE outbox (
	message_hash CHAR(44) NOT NULL PRIMARY KEY,
	`to` CHAR(33) NOT NULL, -- the device this message is addressed to, no FK because of pairing case
	message LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_error TEXT NULL
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


-- light clients

CREATE TABLE watched_light_addresses (
	peer VARCHAR(100) NOT NULL,
	address CHAR(32) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (peer, address),
	KEY byAddress(address)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


ALTER TABLE `units` ADD INDEX `bySequence` (`sequence`);

DROP TABLE IF EXISTS paid_witness_events;

CREATE TABLE IF NOT EXISTS push_registrations (
    registrationId VARCHAR(200), 
    device_address CHAR(33) NOT NULL, 
    PRIMARY KEY (device_address)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE chat_messages (
	id INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
	correspondent_address CHAR(33) NOT NULL, -- the device this message is came from
	message LONGTEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	is_incoming TINYINT NOT NULL,
	type CHAR(15) NOT NULL DEFAULT 'text',
	FOREIGN KEY byAddress(correspondent_address) REFERENCES correspondent_devices(device_address) ON DELETE CASCADE
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
CREATE INDEX chatMessagesIndexByDeviceAddress ON chat_messages(correspondent_address, id);
ALTER TABLE correspondent_devices ADD COLUMN my_record_pref INTEGER DEFAULT 1;
ALTER TABLE correspondent_devices ADD COLUMN peer_record_pref INTEGER DEFAULT 1;

CREATE TABLE watched_light_units (
	peer VARCHAR(100) NOT NULL,
	unit CHAR(44) BINARY NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (peer, unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
CREATE INDEX wlabyUnit ON watched_light_units(unit);

CREATE TABLE bots (
	id INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
	rank INTEGER NOT NULL DEFAULT 0,
	name VARCHAR(100) NOT NULL UNIQUE,
	pairing_code VARCHAR(200) NOT NULL,
	description LONGTEXT NOT NULL
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE asset_metadata (
	asset CHAR(44) BINARY NOT NULL PRIMARY KEY,
	metadata_unit CHAR(44) BINARY NOT NULL,
	registry_address CHAR(32) NULL, -- filled only on the hub
	suffix VARCHAR(20) NULL, -- added only if the same name is registered by different registries for different assets, equal to registry name
	name VARCHAR(20) NULL,
	decimals TINYINT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE byNameRegistry(name, registry_address),
	FOREIGN KEY byAsset(asset) REFERENCES assets(unit),
	FOREIGN KEY byMetadataUnit(metadata_unit) REFERENCES units(unit)
--	FOREIGN KEY byRegistryAddress(registry_address) REFERENCES addresses(address) -- addresses is not always filled on light
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE sent_mnemonics (
	unit CHAR(44) BINARY NOT NULL,
	address CHAR(32) NOT NULL,
	mnemonic VARCHAR(107) NOT NULL,
	textAddress VARCHAR(120) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
CREATE INDEX sentByAddress ON sent_mnemonics(address);

CREATE TABLE private_profiles (
	private_profile_id INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT,
	unit CHAR(44) BINARY NOT NULL,
	payload_hash CHAR(44) NOT NULL,
	attestor_address CHAR(32) NOT NULL,
	address CHAR(32) NOT NULL,
	src_profile TEXT NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

CREATE TABLE private_profile_fields (
	private_profile_id INTEGER NOT NULL ,
	`field` VARCHAR(50) NOT NULL,
	`value` VARCHAR(50) NOT NULL,
	blinding CHAR(16) NOT NULL,
	creation_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE byProfileIdField(private_profile_id, `field`),
	FOREIGN KEY (private_profile_id) REFERENCES private_profiles(private_profile_id)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
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
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
CREATE INDEX attestedFieldsByAttestorFieldValue ON attested_fields(attestor_address, `field`, `value`);
CREATE INDEX attestedFieldsByAddressField ON attested_fields(address, `field`);


-- user enters an email address (it is original address) and it is translated to BB address
CREATE TABLE original_addresses (
	unit CHAR(44) NOT NULL,
	address CHAR(32) NOT NULL,
	original_address VARCHAR(100) NOT NULL, -- email
	PRIMARY KEY (unit, address),
	FOREIGN KEY (unit) REFERENCES units(unit)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
