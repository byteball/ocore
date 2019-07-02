-- light client stores only a subset of the full database, some foreign key constraints would stand in the way

-- this is for mysql only, sqlite doesn't support DROP FOREIGN KEY

ALTER TABLE units
	DROP FOREIGN KEY unitsByLastBallUnit,
	DROP FOREIGN KEY unitsByWitnessListUnit;

ALTER TABLE parenthoods
	DROP FOREIGN KEY parenthoodsByChild,
	DROP FOREIGN KEY parenthoodsByParent;

ALTER TABLE unit_authors
	DROP FOREIGN KEY unitAuthorsByAddress;

ALTER TABLE authentifiers
	DROP FOREIGN KEY authentifiersByAddress;

ALTER TABLE inputs
	 -- in light we allow NULL because address is copied from previous output which might not be known to light client
	CHANGE COLUMN address address CHAR(32) NULL,
	DROP FOREIGN KEY inputsBySrcUnit,
	DROP FOREIGN KEY inputsByAddress,
	DROP FOREIGN KEY inputsByAsset;

ALTER TABLE outputs
	DROP FOREIGN KEY outputsByAsset;

ALTER TABLE spend_proofs
	DROP FOREIGN KEY spendProofsByAddress;

ALTER TABLE address_definition_changes
	DROP FOREIGN KEY addressDefinitionChangesByAddress;

ALTER TABLE votes
	DROP FOREIGN KEY votesByChoice;

ALTER TABLE attestations
	DROP FOREIGN KEY attestationsByAttestorAddress;

ALTER TABLE asset_attestors
	DROP FOREIGN KEY assetAttestorsByAsset;

ALTER TABLE aa_addresses
	CHANGE COLUMN unit unit CHAR(44) NULL,
	CHANGE COLUMN mci mci INT NULL;

