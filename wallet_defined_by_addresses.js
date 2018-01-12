/*jslint node: true */
const async = require('async');
const db = require('./db.js');
const constants = require('./constants.js');
const conf = require('./conf.js');
const composer = require('./composer.js');
const objectHash = require('./object_hash.js');
const _ = require('lodash');
const network = require('./network.js');
const device = require('./device.js');
const walletGeneral = require('./wallet_general.js');
const eventBus = require('./event_bus.js');
const Definition = require("./definition.js");
const ValidationUtils = require("./validation_utils.js");
const indivisibleAsset = require('./indivisible_asset.js');
const divisibleAsset = require('./divisible_asset.js');

const MAX_INT32 = Math.pow(2, 31) - 1;



// unused
function sendOfferToCreateNewSharedAddress(device_address, arrAddressDefinitionTemplate){
	device.sendMessageToDevice(device_address, "create_new_shared_address", {address_definition_template: arrAddressDefinitionTemplate});
}

// called from UI (unused)
function sendApprovalOfNewSharedAddress(device_address, address_definition_template_chash, address, assocDeviceAddressesByRelativeSigningPaths){
	device.sendMessageToDevice(device_address, "approve_new_shared_address", {
		address_definition_template_chash, 
		address, 
		device_addresses_by_relative_signing_paths: assocDeviceAddressesByRelativeSigningPaths
	});
}

// called from UI (unused)
function sendRejectionOfNewSharedAddress(device_address, address_definition_template_chash){
	device.sendMessageToDevice(device_address, "reject_new_shared_address", {
		address_definition_template_chash
	});
}

function sendNewSharedAddress(device_address, address, arrDefinition, assocSignersByPath, bForwarded){
	device.sendMessageToDevice(device_address, "new_shared_address", {
		address, definition: arrDefinition, signers: assocSignersByPath, forwarded: bForwarded
	});
}





// called from UI (unused)
// my address is not filled explicitly, it is specified as variable in the template like external addresses
// assocMyDeviceAddressesByRelativeSigningPaths points to my device addresses that hold the actual signing keys
function createNewSharedAddressByTemplate(arrAddressDefinitionTemplate, my_address, assocMyDeviceAddressesByRelativeSigningPaths){
	validateAddressDefinitionTemplate(arrAddressDefinitionTemplate, device.getMyDeviceAddress(), (err, assocMemberDeviceAddressesBySigningPaths) => {
		if(err) {
			throw Error(err);
		}

		// assocMemberDeviceAddressesBySigningPaths are keyed by paths from root to member addresses (not all the way to signing keys)
		const arrMemberSigningPaths = Object.keys(assocMemberDeviceAddressesBySigningPaths);
		const address_definition_template_chash = objectHash.getChash160(arrAddressDefinitionTemplate);
		db.query(
			"INSERT INTO pending_shared_addresses (definition_template_chash, definition_template) VALUES(?,?)", 
			[address_definition_template_chash, JSON.stringify(arrAddressDefinitionTemplate)],
			() => {
				async.eachSeries(
					arrMemberSigningPaths, 
					(signing_path, cb) => {
						const device_address = assocMemberDeviceAddressesBySigningPaths[signing_path];
						let fields = "definition_template_chash, device_address, signing_path";
						let values = "?,?,?";
						const arrParams = [address_definition_template_chash, device_address, signing_path];
						if (device_address === device.getMyDeviceAddress()){
							fields += ", address, device_addresses_by_relative_signing_paths, approval_date";
							values += `,?,?,${db.getNow()}`;
							arrParams.push(my_address, JSON.stringify(assocMyDeviceAddressesByRelativeSigningPaths));
						}
						db.query(`INSERT INTO pending_shared_address_signing_paths (${fields}) VALUES(${values})`, arrParams, () => {
							cb();
						});
					},
					() => {
						const arrMemberDeviceAddresses = _.uniq(_.values(assocMemberDeviceAddressesBySigningPaths));
						arrMemberDeviceAddresses.forEach(device_address => {
							if (device_address !== device.getMyDeviceAddress())
								sendOfferToCreateNewSharedAddress(device_address, arrAddressDefinitionTemplate);
						})
					}
				);
			}
		);
	});
}

// unused
// received approval from co-signer address
function approvePendingSharedAddress(address_definition_template_chash, from_address, address, assocDeviceAddressesByRelativeSigningPaths){
	db.query( // may update several rows if the device is referenced multiple times from the definition template
		`UPDATE pending_shared_address_signing_paths SET address=?, device_addresses_by_relative_signing_paths=?, approval_date=${db.getNow()} \n\
        WHERE definition_template_chash=? AND device_address=?`, 
		[address, JSON.stringify(assocDeviceAddressesByRelativeSigningPaths), address_definition_template_chash, from_address], 
		() => {
			// check if this is the last required approval
			db.query(
				"SELECT device_address, signing_path, address, device_addresses_by_relative_signing_paths \n\
				FROM pending_shared_address_signing_paths \n\
				WHERE definition_template_chash=?",
				[address_definition_template_chash],
				rows => {
					if (rows.length === 0) // another device rejected the address at the same time
						return;
					if (rows.some(row => !row.address)) // some devices haven't approved yet
						return;
					// all approvals received
					const params = {};
					rows.forEach(row => { // the same device_address can be mentioned in several rows
						params[`address@${row.device_address}`] = row.address;
					});
					db.query(
						"SELECT definition_template FROM pending_shared_addresses WHERE definition_template_chash=?", 
						[address_definition_template_chash],
						templ_rows => {
							if (templ_rows.length !== 1)
								throw Error("template not found");
							const arrAddressDefinitionTemplate = JSON.parse(templ_rows[0].definition_template);
							const arrDefinition = Definition.replaceInTemplate(arrAddressDefinitionTemplate, params);
							const shared_address = objectHash.getChash160(arrDefinition);
							db.query(
								"INSERT INTO shared_addresses (shared_address, definition) VALUES (?,?)", 
								[shared_address, JSON.stringify(arrDefinition)], 
								() => {
									const arrQueries = [];
									const assocSignersByPath = {};
									rows.forEach(row => {
										const assocDeviceAddressesByRelativeSigningPaths = JSON.parse(row.device_addresses_by_relative_signing_paths);
										for (const member_signing_path in assocDeviceAddressesByRelativeSigningPaths){
											const signing_device_address = assocDeviceAddressesByRelativeSigningPaths[member_signing_path];
											// this is full signing path, from root of shared address (not from root of member address)
											const full_signing_path = row.signing_path + member_signing_path.substring(1);
											// note that we are inserting row.device_address (the device we requested approval from), not signing_device_address 
											// (the actual signer), because signing_device_address might not be our correspondent. When we need to sign, we'll
											// send unsigned unit to row.device_address and it'll forward the request to signing_device_address (subject to 
											// row.device_address being online)
											db.addQuery(arrQueries, 
												"INSERT INTO shared_address_signing_paths \n\
												(shared_address, address, signing_path, member_signing_path, device_address) VALUES(?,?,?,?,?)", 
												[shared_address, row.address, full_signing_path, member_signing_path, row.device_address]);
											assocSignersByPath[full_signing_path] = {
												device_address: row.device_address, 
												address: row.address, 
												member_signing_path
											};
										}
									});
									async.series(arrQueries, () => {
										deletePendingSharedAddress(address_definition_template_chash);
										// notify all other member-devices about the new shared address they are a part of
										rows.forEach(({device_address}) => {
											if (device_address !== device.getMyDeviceAddress())
												sendNewSharedAddress(device_address, shared_address, arrDefinition, assocSignersByPath);
										});
										forwardNewSharedAddressToCosignersOfMyMemberAddresses(shared_address, arrDefinition, assocSignersByPath);
										if (conf.bLight)
											network.addLightWatchedAddress(shared_address);
									});
								}
							);
						}
					);
				}
			);
		}
	);
}

// unused
function deletePendingSharedAddress(address_definition_template_chash){
	db.query("DELETE FROM pending_shared_address_signing_paths WHERE definition_template_chash=?", [address_definition_template_chash], () => {
		db.query("DELETE FROM pending_shared_addresses WHERE definition_template_chash=?", [address_definition_template_chash], () => {});
	});
}

// called from network after the initiator collects approvals from all members of the address and then sends the completed address to all members
// member_signing_path is now deprecated and unused
// shared_address_signing_paths.signing_path is now path to member-address, not full path to a signing key
function addNewSharedAddress(address, arrDefinition, assocSignersByPath, bForwarded, onDone){
//	network.addWatchedAddress(address);
	db.query(
		`INSERT ${db.getIgnore()} INTO shared_addresses (shared_address, definition) VALUES (?,?)`, 
		[address, JSON.stringify(arrDefinition)], 
		() => {
			const arrQueries = [];
			for (const signing_path in assocSignersByPath){
				const signerInfo = assocSignersByPath[signing_path];
				db.addQuery(arrQueries, 
					`INSERT ${db.getIgnore()} INTO shared_address_signing_paths \n\
                    (shared_address, address, signing_path, member_signing_path, device_address) VALUES (?,?,?,?,?)`, 
					[address, signerInfo.address, signing_path, signerInfo.member_signing_path, signerInfo.device_address]);
			}
			async.series(arrQueries, () => {
				console.log(`added new shared address ${address}`);
				eventBus.emit(`new_address-${address}`);
				if (conf.bLight)
					network.addLightWatchedAddress(address);
				if (!bForwarded)
					forwardNewSharedAddressToCosignersOfMyMemberAddresses(address, arrDefinition, assocSignersByPath);
				if (onDone)
					onDone();
			});
		}
	);
}

function includesMyDeviceAddress(assocSignersByPath){
	for (const signing_path in assocSignersByPath){
		const signerInfo = assocSignersByPath[signing_path];
		if (signerInfo.device_address === device.getMyDeviceAddress())
			return true;
	}
	return false;
}

// Checks if any of my payment addresses is mentioned.
// It is possible that my device address is not mentioned in the definition if I'm a member of multisig address, one of my cosigners is mentioned instead
function determineIfIncludesMeAndRewriteDeviceAddress(assocSignersByPath, handleResult){
	const assocMemberAddresses = {};
	let bHasMyDeviceAddress = false;
	for (const signing_path in assocSignersByPath){
		const signerInfo = assocSignersByPath[signing_path];
		if (signerInfo.device_address === device.getMyDeviceAddress())
			bHasMyDeviceAddress = true;
		if (signerInfo.address)
			assocMemberAddresses[signerInfo.address] = true;
	}
	const arrMemberAddresses = Object.keys(assocMemberAddresses);
	if (arrMemberAddresses.length === 0)
		return handleResult("no member addresses?");
	db.query(
		"SELECT address, 'my' AS type FROM my_addresses WHERE address IN(?) \n\
		UNION \n\
		SELECT shared_address AS address, 'shared' AS type FROM shared_addresses WHERE shared_address IN(?)", 
		[arrMemberAddresses, arrMemberAddresses],
		rows => {
		//	handleResult(rows.length === arrMyMemberAddresses.length ? null : "Some of my member addresses not found");
			if (rows.length === 0)
				return handleResult("I am not a member of this shared address");
			const arrMyMemberAddresses = rows.filter(({type}) => type === 'my').map(({address}) => address);
			// rewrite device address for my addresses
			if (!bHasMyDeviceAddress){
				for (const signing_path in assocSignersByPath){
					const signerInfo = assocSignersByPath[signing_path];
					if (signerInfo.address && arrMyMemberAddresses.indexOf(signerInfo.address) >= 0)
						signerInfo.device_address = device.getMyDeviceAddress();
				}
			}
			handleResult();
		}
	);
}

function forwardNewSharedAddressToCosignersOfMyMemberAddresses(address, arrDefinition, assocSignersByPath){
	const assocMyMemberAddresses = {};
	for (const signing_path in assocSignersByPath){
		const signerInfo = assocSignersByPath[signing_path];
		if (signerInfo.device_address === device.getMyDeviceAddress() && signerInfo.address)
			assocMyMemberAddresses[signerInfo.address] = true;
	}
	const arrMyMemberAddresses = Object.keys(assocMyMemberAddresses);
	if (arrMyMemberAddresses.length === 0)
		throw Error("my member addresses not found");
	db.query(
		"SELECT DISTINCT device_address FROM my_addresses JOIN wallet_signing_paths USING(wallet) WHERE address IN(?) AND device_address!=?", 
		[arrMyMemberAddresses, device.getMyDeviceAddress()],
		rows => {
			rows.forEach(({device_address}) => {
				sendNewSharedAddress(device_address, address, arrDefinition, assocSignersByPath, true);
			});
		}
	);
}

// {address: "BASE32", definition: [...], signers: {...}}
function handleNewSharedAddress({definition, signers, address, forwarded}, callbacks) {
	if (!ValidationUtils.isArrayOfLength(definition, 2))
		return callbacks.ifError("invalid definition");
	if (typeof signers !== "object" || Object.keys(signers).length === 0)
		return callbacks.ifError("invalid signers");
	if (address !== objectHash.getChash160(definition))
		return callbacks.ifError("definition doesn't match its c-hash");
	for (const signing_path in signers){
		const signerInfo = signers[signing_path];
		if (signerInfo.address && !ValidationUtils.isValidAddress(signerInfo.address))
			return callbacks.ifError(`invalid member address: ${signerInfo.address}`);
	}
	determineIfIncludesMeAndRewriteDeviceAddress(signers, err => {
		if (err)
			return callbacks.ifError(err);
		validateAddressDefinition(definition, err => {
			if (err)
				return callbacks.ifError(err);
			addNewSharedAddress(address, definition, signers, forwarded, callbacks.ifOk);
		});
	});
}

function createNewSharedAddress(arrDefinition, assocSignersByPath, callbacks){
	if (!includesMyDeviceAddress(assocSignersByPath))
		return callbacks.ifError("my device address not mentioned");
	const address = objectHash.getChash160(arrDefinition);
	handleNewSharedAddress({address, definition: arrDefinition, signers: assocSignersByPath}, {
		ifError: callbacks.ifError,
		ifOk() {
			// share the new address with all cosigners
			const arrDeviceAddresses = [];
			for (const signing_path in assocSignersByPath){
				const signerInfo = assocSignersByPath[signing_path];
				if (signerInfo.device_address !== device.getMyDeviceAddress() && arrDeviceAddresses.indexOf(signerInfo.device_address) === -1)
					arrDeviceAddresses.push(signerInfo.device_address);
			}
			arrDeviceAddresses.forEach(device_address => {
				sendNewSharedAddress(device_address, address, arrDefinition, assocSignersByPath);
			});
			callbacks.ifOk(address);
		}
	});
}

function getMemberDeviceAddressesBySigningPaths(arrAddressDefinitionTemplate){
	function evaluate(arr, path){
		const op = arr[0];
		const args = arr[1];
		if (!args)
			return;
		switch (op){
			case 'or':
			case 'and':
				for (var i=0; i<args.length; i++)
					evaluate(args[i], `${path}.${i}`);
				break;
			case 'r of set':
				if (!ValidationUtils.isNonemptyArray(args.set))
					return;
				for (var i=0; i<args.set.length; i++)
					evaluate(args.set[i], `${path}.${i}`);
				break;
			case 'weighted and':
				if (!ValidationUtils.isNonemptyArray(args.set))
					return;
				for (var i=0; i<args.set.length; i++)
					evaluate(args.set[i].value, `${path}.${i}`);
				break;
			case 'address':
				const address = args;
				const prefix = '$address@';
				if (!ValidationUtils.isNonemptyString(address) || address.substr(0, prefix.length) !== prefix)
					return;
				const device_address = address.substr(prefix.length);
				assocMemberDeviceAddressesBySigningPaths[path] = device_address;
				break;
			case 'definition template':
				throw Error(`${op} not supported yet`);
			// all other ops cannot reference device address
		}
	}
	var assocMemberDeviceAddressesBySigningPaths = {};
	evaluate(arrAddressDefinitionTemplate, 'r');
	return assocMemberDeviceAddressesBySigningPaths;
}

function validateAddressDefinitionTemplate(arrDefinitionTemplate, from_address, handleResult){
	const assocMemberDeviceAddressesBySigningPaths = getMemberDeviceAddressesBySigningPaths(arrDefinitionTemplate);
	const arrDeviceAddresses = _.uniq(_.values(assocMemberDeviceAddressesBySigningPaths));
	if (arrDeviceAddresses.length < 2)
		return handleResult("less than 2 member devices");
	if (arrDeviceAddresses.indexOf(device.getMyDeviceAddress()) === - 1)
		return handleResult("my device address not mentioned in the definition");
	if (arrDeviceAddresses.indexOf(from_address) === - 1)
		return handleResult("sender device address not mentioned in the definition");
	
	const params = {};
	// to fill the template for validation, assign my device address (without leading 0) to all member devices 
	// (we need just any valid address with a definition)
	const fake_address = device.getMyDeviceAddress().substr(1);
	arrDeviceAddresses.forEach(device_address => {
		params[`address@${device_address}`] = fake_address;
	});
	try{
		var arrFakeDefinition = Definition.replaceInTemplate(arrDefinitionTemplate, params);
	}
	catch(e){
		return handleResult(e.toString());
	}
	const objFakeUnit = {authors: [{address: fake_address, definition: ["sig", {pubkey: device.getMyDevicePubKey()}]}]};
	const objFakeValidationState = {last_ball_mci: MAX_INT32};
	Definition.validateDefinition(db, arrFakeDefinition, objFakeUnit, objFakeValidationState, null, false, err => {
		if (err)
			return handleResult(err);
		handleResult(null, assocMemberDeviceAddressesBySigningPaths);
	});
}

// fix:
// 1. check that my address is referenced in the definition
function validateAddressDefinition(arrDefinition, handleResult){
	const objFakeUnit = {authors: []};
	const objFakeValidationState = {last_ball_mci: MAX_INT32, bAllowUnresolvedInnerDefinitions: true};
	Definition.validateDefinition(db, arrDefinition, objFakeUnit, objFakeValidationState, null, false, err => {
		if (err)
			return handleResult(err);
		handleResult();
	});
}


function forwardPrivateChainsToOtherMembersOfAddresses(arrChains, arrAddresses, conn = db, onSaved) {
    conn.query(
		"SELECT device_address FROM shared_address_signing_paths WHERE shared_address IN(?) AND device_address!=?", 
		[arrAddresses, device.getMyDeviceAddress()], 
		rows => {
			console.log(`shared address devices: ${rows.length}`);
			const arrDeviceAddresses = rows.map(({device_address}) => device_address);
			walletGeneral.forwardPrivateChainsToDevices(arrDeviceAddresses, arrChains, true, conn, onSaved);
		}
	);
}

function readAllControlAddresses(conn = db, arrAddresses, handleLists) {
    conn.query(
		"SELECT DISTINCT address, shared_address_signing_paths.device_address, (correspondent_devices.device_address IS NOT NULL) AS have_correspondent \n\
		FROM shared_address_signing_paths LEFT JOIN correspondent_devices USING(device_address) WHERE shared_address IN(?)", 
		[arrAddresses], 
		rows => {
			if (rows.length === 0)
				return handleLists([], []);
			const arrControlAddresses = rows.map(({address}) => address);
			const arrControlDeviceAddresses = rows.filter(({have_correspondent}) => have_correspondent).map(({device_address}) => device_address);
			readAllControlAddresses(conn, arrControlAddresses, (arrControlAddresses2, arrControlDeviceAddresses2) => {
				handleLists(_.union(arrControlAddresses, arrControlAddresses2), _.union(arrControlDeviceAddresses, arrControlDeviceAddresses2));
			});
		}
	);
}


/*
function readRequiredCosigners(shared_address, arrSigningDeviceAddresses, handleCosigners){
	db.query(
		"SELECT shared_address_signing_paths.address \n\
		FROM shared_address_signing_paths \n\
		LEFT JOIN unit_authors USING(address) \n\
		WHERE shared_address=? AND device_address IN(?) AND unit_authors.address IS NULL",
		[shared_address, arrSigningDeviceAddresses],
		function(rows){
			handleCosigners(rows.map(function(row){ return row.address; }));
		}
	);
}*/

function readSharedAddressDefinition(shared_address, handleDefinition){
	db.query(
		`SELECT definition, ${db.getUnixTimestamp("creation_date")} AS creation_ts FROM shared_addresses WHERE shared_address=?`, 
		[shared_address], 
		rows => {
			if (rows.length !== 1)
				throw Error(`shared definition not found ${shared_address}`);
			const arrDefinition = JSON.parse(rows[0].definition);
			handleDefinition(arrDefinition, rows[0].creation_ts);
		}
	);
}

// returns information about cosigner devices
function readSharedAddressCosigners(shared_address, handleCosigners){
	db.query(
		`SELECT DISTINCT shared_address_signing_paths.device_address, name, ${db.getUnixTimestamp("shared_addresses.creation_date")} AS creation_ts \n\
        FROM shared_address_signing_paths \n\
        JOIN shared_addresses USING(shared_address) \n\
        LEFT JOIN correspondent_devices USING(device_address) \n\
        WHERE shared_address=? AND device_address!=?`,
		[shared_address, device.getMyDeviceAddress()],
		rows => {
			if (rows.length === 0)
				throw Error(`no cosigners found for shared address ${shared_address}`);
			handleCosigners(rows);
		}
	);
}

// returns list of payment addresses of peers
function readSharedAddressPeerAddresses(shared_address, handlePeerAddresses){
	db.query(
		"SELECT DISTINCT address FROM shared_address_signing_paths WHERE shared_address=? AND device_address!=?",
		[shared_address, device.getMyDeviceAddress()],
		rows => {
			// no problem if no peers found: the peer can be part of our multisig address and his device address will be rewritten to ours
		//	if (rows.length === 0)
		//		throw Error("no peers found for shared address "+shared_address);
			const arrPeerAddresses = rows.map(({address}) => address);
			handlePeerAddresses(arrPeerAddresses);
		}
	);
}

function getPeerAddressesFromSigners(assocSignersByPath){
	const assocPeerAddresses = {};
	for (const path in assocSignersByPath){
		const signerInfo = assocSignersByPath[path];
		if (signerInfo.device_address !== device.getMyDeviceAddress())
			assocPeerAddresses[signerInfo.address] = true;
	}
	const arrPeerAddresses = Object.keys(assocPeerAddresses);
	return arrPeerAddresses;
}

function determineIfHasMerkle(shared_address, handleResult){
	db.query(
		"SELECT 1 FROM shared_address_signing_paths WHERE shared_address=? AND device_address=? AND address=''",
		[shared_address, device.getMyDeviceAddress()],
		({length}) => {
			handleResult(length > 0);
		}
	);
}




exports.validateAddressDefinitionTemplate = validateAddressDefinitionTemplate;
exports.approvePendingSharedAddress = approvePendingSharedAddress;
exports.deletePendingSharedAddress = deletePendingSharedAddress;
exports.validateAddressDefinition = validateAddressDefinition;
exports.handleNewSharedAddress = handleNewSharedAddress;
exports.forwardPrivateChainsToOtherMembersOfAddresses = forwardPrivateChainsToOtherMembersOfAddresses;
exports.readSharedAddressCosigners = readSharedAddressCosigners;
exports.readSharedAddressPeerAddresses = readSharedAddressPeerAddresses;
exports.getPeerAddressesFromSigners = getPeerAddressesFromSigners;
exports.readSharedAddressDefinition = readSharedAddressDefinition;
exports.determineIfHasMerkle = determineIfHasMerkle;
exports.createNewSharedAddress = createNewSharedAddress;
exports.createNewSharedAddressByTemplate = createNewSharedAddressByTemplate;
exports.readAllControlAddresses = readAllControlAddresses;
