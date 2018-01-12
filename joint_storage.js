/*jslint node: true */
const _ = require('lodash');
const async = require('async');
const storage = require('./storage.js');
const archiving = require('./archiving.js');
const db = require('./db.js');
const constants = require("./constants.js");
const objectHash = require("./object_hash.js");
const mutex = require('./mutex.js');
const conf = require('./conf.js');
const breadcrumbs = require('./breadcrumbs.js');



function checkIfNewUnit(unit, callbacks) {
	if (storage.isKnownUnit(unit))
		return callbacks.ifKnown();
	db.query("SELECT 1 FROM units WHERE unit=?", [unit], ({length}) => {
		if (length > 0){
			storage.setUnitIsKnown(unit);
			return callbacks.ifKnown();
		}
		db.query("SELECT 1 FROM unhandled_joints WHERE unit=?", [unit], ({length}) => {
			if (length > 0)
				return callbacks.ifKnownUnverified();
			db.query("SELECT error FROM known_bad_joints WHERE unit=?", [unit], bad_rows => {
				(bad_rows.length === 0) ? callbacks.ifNew() : callbacks.ifKnownBad(bad_rows[0].error);
			});
		});
	});
}

function checkIfNewJoint(objJoint, callbacks) {
	checkIfNewUnit(objJoint.unit.unit, {
		ifKnown: callbacks.ifKnown,
		ifKnownUnverified: callbacks.ifKnownUnverified,
		ifKnownBad: callbacks.ifKnownBad,
		ifNew() {
			db.query("SELECT error FROM known_bad_joints WHERE joint=?", [objectHash.getJointHash(objJoint)], bad_rows => {
				(bad_rows.length === 0) ? callbacks.ifNew() : callbacks.ifKnownBad(bad_rows[0].error);
			});
		}
	});
}


function removeUnhandledJointAndDependencies(unit, onDone){
	db.takeConnectionFromPool(conn => {
		const arrQueries = [];
		conn.addQuery(arrQueries, "BEGIN");
		conn.addQuery(arrQueries, "DELETE FROM unhandled_joints WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "DELETE FROM dependencies WHERE unit=?", [unit]);
		conn.addQuery(arrQueries, "COMMIT");
		async.series(arrQueries, () => {
			conn.release();
			if (onDone)
				onDone();
		});
	});
}

function saveUnhandledJointAndDependencies(objJoint, arrMissingParentUnits, peer, onDone){
	db.takeConnectionFromPool(conn => {
		const unit = objJoint.unit.unit;
		const sql = `INSERT ${conn.getIgnore()} INTO dependencies (unit, depends_on_unit) VALUES ${arrMissingParentUnits.map(missing_unit => `(${conn.escape(unit)}, ${conn.escape(missing_unit)})`).join(", ")}`;
		const arrQueries = [];
		conn.addQuery(arrQueries, "BEGIN");
		conn.addQuery(arrQueries, "INSERT INTO unhandled_joints (unit, json, peer) VALUES (?, ?, ?)", [unit, JSON.stringify(objJoint), peer]);
		conn.addQuery(arrQueries, sql);
		conn.addQuery(arrQueries, "COMMIT");
		async.series(arrQueries, () => {
			conn.release();
			if (onDone)
				onDone(); 
		});
	});
}


// handleDependentJoint called for each dependent unit
function readDependentJointsThatAreReady(unit, handleDependentJoint){
	//console.log("readDependentJointsThatAreReady "+unit);
	const t=Date.now();
	const from = unit ? "FROM dependencies AS src_deps JOIN dependencies USING(unit)" : "FROM dependencies";
	const where = unit ? `WHERE src_deps.depends_on_unit=${db.escape(unit)}` : "";
	mutex.lock(["dependencies"], unlock => {
		db.query(
			`SELECT dependencies.unit, unhandled_joints.unit AS unit_for_json, \n\
                SUM(CASE WHEN units.unit IS NULL THEN 1 ELSE 0 END) AS count_missing_parents \n\
            ${from} \n\
            JOIN unhandled_joints ON dependencies.unit=unhandled_joints.unit \n\
            LEFT JOIN units ON dependencies.depends_on_unit=units.unit \n\
            ${where} \n\
            GROUP BY dependencies.unit \n\
            HAVING count_missing_parents=0 \n\
            ORDER BY NULL`, 
			rows => {
				//console.log(rows.length+" joints are ready");
				//console.log("deps: "+(Date.now()-t));
				rows.forEach(({unit_for_json}) => {
					db.query(`SELECT json, peer, ${db.getUnixTimestamp("creation_date")} AS creation_ts FROM unhandled_joints WHERE unit=?`, [unit_for_json], internal_rows => {
						internal_rows.forEach(({json, creation_ts, peer}) => {
							handleDependentJoint(JSON.parse(json), parseInt(creation_ts), peer);
						});
					});
				});
				unlock();
			}
		);
	});
}

function findLostJoints(handleLostJoints){
	//console.log("findLostJoints");
	db.query(
		`SELECT DISTINCT depends_on_unit \n\
        FROM dependencies \n\
        LEFT JOIN unhandled_joints ON depends_on_unit=unhandled_joints.unit \n\
        LEFT JOIN units ON depends_on_unit=units.unit \n\
        WHERE unhandled_joints.unit IS NULL AND units.unit IS NULL AND dependencies.creation_date < ${db.addTime("-8 SECOND")}`, 
		rows => {
			//console.log(rows.length+" lost joints");
			if (rows.length === 0)
				return;
			handleLostJoints(rows.map(({depends_on_unit}) => depends_on_unit)); 
		}
	);
}

// onPurgedDependentJoint called for each purged dependent unit
function purgeJointAndDependencies(objJoint, error, onPurgedDependentJoint, onDone){
	db.takeConnectionFromPool(conn => {
		const unit = objJoint.unit.unit;
		const arrQueries = [];
		conn.addQuery(arrQueries, "BEGIN");
		conn.addQuery(arrQueries, "INSERT INTO known_bad_joints (unit, json, error) VALUES (?,?,?)", [unit, JSON.stringify(objJoint), error]);
		conn.addQuery(arrQueries, "DELETE FROM unhandled_joints WHERE unit=?", [unit]); // if any
		conn.addQuery(arrQueries, "DELETE FROM dependencies WHERE unit=?", [unit]);
		collectQueriesToPurgeDependentJoints(conn, arrQueries, unit, error, onPurgedDependentJoint, () => {
			conn.addQuery(arrQueries, "COMMIT");
			async.series(arrQueries, () => {
				conn.release();
				if (onDone)
					onDone();
			})
		});
	});
}

// onPurgedDependentJoint called for each purged dependent unit
function purgeDependencies(unit, error, onPurgedDependentJoint, onDone){
	db.takeConnectionFromPool(conn => {
		const arrQueries = [];
		conn.addQuery(arrQueries, "BEGIN");
		collectQueriesToPurgeDependentJoints(conn, arrQueries, unit, error, onPurgedDependentJoint, () => {
			conn.addQuery(arrQueries, "COMMIT");
			async.series(arrQueries, () => {
				conn.release();
				if (onDone)
					onDone();
			})
		});
	});
}

// onPurgedDependentJoint called for each purged dependent unit
function collectQueriesToPurgeDependentJoints(conn, arrQueries, unit, error, onPurgedDependentJoint, onDone){
	conn.query("SELECT unit, peer FROM dependencies JOIN unhandled_joints USING(unit) WHERE depends_on_unit=?", [unit], rows => {
		if (rows.length === 0)
			return onDone();
		//conn.addQuery(arrQueries, "DELETE FROM dependencies WHERE depends_on_unit=?", [unit]);
		const arrUnits = rows.map(row => row.unit);
		conn.addQuery(arrQueries, `INSERT ${conn.getIgnore()} INTO known_bad_joints (unit, json, error) \n\
            SELECT unit, json, ? FROM unhandled_joints WHERE unit IN(?)`, [error, arrUnits]);
		conn.addQuery(arrQueries, "DELETE FROM unhandled_joints WHERE unit IN(?)", [arrUnits]);
		conn.addQuery(arrQueries, "DELETE FROM dependencies WHERE unit IN(?)", [arrUnits]);
		async.eachSeries(
			rows,
			(row, cb) => {
				if (onPurgedDependentJoint)
					onPurgedDependentJoint(row.unit, row.peer);
				collectQueriesToPurgeDependentJoints(conn, arrQueries, row.unit, error, onPurgedDependentJoint, cb);
			},
			onDone
		);
	});
}

function purgeUncoveredNonserialJointsUnderLock(){
	mutex.lockOrSkip(["purge_uncovered"], unlock => {
		purgeUncoveredNonserialJoints(false, unlock);
	});
}

function purgeUncoveredNonserialJoints(bByExistenceOfChildren, onDone){
	const cond = bByExistenceOfChildren ? "(SELECT 1 FROM parenthoods WHERE parent_unit=unit LIMIT 1) IS NULL" : "is_free=1";
	const order_column = (conf.storage === 'mysql') ? 'creation_date' : 'rowid'; // this column must be indexed!
	const byIndex = (bByExistenceOfChildren && conf.storage === 'sqlite') ? 'INDEXED BY bySequence' : '';
	// the purged units can arrive again, no problem
	db.query( // purge the bad ball if we've already received at least 7 witnesses after receiving the bad ball
		`SELECT unit FROM units ${byIndex} \n\
        WHERE ${cond} AND sequence IN('final-bad','temp-bad') AND content_hash IS NULL \n\
            AND NOT EXISTS (SELECT * FROM dependencies WHERE depends_on_unit=units.unit) \n\
            AND NOT EXISTS (SELECT * FROM balls WHERE balls.unit=units.unit) \n\
            AND (units.creation_date < ${db.addTime('-10 SECOND')} OR EXISTS ( \n\
                SELECT DISTINCT address FROM units AS wunits CROSS JOIN unit_authors USING(unit) CROSS JOIN my_witnesses USING(address) \n\
                WHERE wunits.${order_column} > units.${order_column} \n\
                LIMIT 0,1 \n\
            )) \n\
            /* AND NOT EXISTS (SELECT * FROM unhandled_joints) */`, 
		rows => {
			async.eachSeries(
				rows,
				({unit}, cb) => {
					breadcrumbs.add(`--------------- archiving uncovered unit ${unit}`);
					storage.readJoint(db, unit, {
						ifNotFound() {
							throw Error("nonserial unit not found?");
						},
						ifFound(objJoint) {
							db.takeConnectionFromPool(conn => {
								mutex.lock(["write"], unlock => {
									const arrQueries = [];
									conn.addQuery(arrQueries, "BEGIN");
									archiving.generateQueriesToArchiveJoint(conn, objJoint, 'uncovered', arrQueries, () => {
										conn.addQuery(arrQueries, "COMMIT");
										async.series(arrQueries, () => {
											unlock();
											conn.release();
											breadcrumbs.add(`------- done archiving ${unit}`);
											storage.forgetUnit(unit);
											cb();
										});
									});
								});
							});
						}
					});
				},
				() => {
					if (rows.length > 0)
						return purgeUncoveredNonserialJoints(true, onDone); // to clean chains of bad units
					if (!bByExistenceOfChildren)
						return onDone();
					// else 0 rows and bByExistenceOfChildren
					db.query(
						"UPDATE units SET is_free=1 WHERE is_free=0 AND is_stable=0 \n\
						AND (SELECT 1 FROM parenthoods WHERE parent_unit=unit LIMIT 1) IS NULL",
						() => {
							onDone();
						}
					);
				}
			);
		}
	);
}

// handleJoint is called for every joint younger than mci
function readJointsSinceMci(mci, handleJoint, onDone){
	db.query(
		"SELECT units.unit FROM units LEFT JOIN archived_joints USING(unit) \n\
		WHERE (is_stable=0 AND main_chain_index>=? OR main_chain_index IS NULL OR is_free=1) AND archived_joints.unit IS NULL \n\
		ORDER BY +level", 
		[mci], 
		rows => {
			async.eachSeries(
				rows, 
				({unit}, cb) => {
					storage.readJoint(db, unit, {
						ifNotFound() {
						//	throw Error("unit "+row.unit+" not found");
							breadcrumbs.add(`unit ${unit} not found`);
							cb();
						},
						ifFound(objJoint) {
							handleJoint(objJoint);
							cb();
						}
					});
				},
				onDone
			);
		}
	);
}






exports.checkIfNewUnit = checkIfNewUnit;
exports.checkIfNewJoint = checkIfNewJoint;

exports.saveUnhandledJointAndDependencies = saveUnhandledJointAndDependencies;
exports.removeUnhandledJointAndDependencies = removeUnhandledJointAndDependencies;
exports.readDependentJointsThatAreReady = readDependentJointsThatAreReady;
exports.findLostJoints = findLostJoints;
exports.purgeJointAndDependencies = purgeJointAndDependencies;
exports.purgeDependencies = purgeDependencies;
exports.purgeUncoveredNonserialJointsUnderLock = purgeUncoveredNonserialJointsUnderLock;
exports.readJointsSinceMci = readJointsSinceMci;
