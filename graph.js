/*jslint node: true */
const _ = require('lodash');
const async = require('async');
const storage = require('./storage.js');
const db = require('./db.js');
const profiler = require('./profiler.js');



function compareUnits(conn, unit1, unit2, handleResult){
	if (unit1 === unit2)
		return handleResult(0);
	conn.query(
		"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain, is_free FROM units WHERE unit IN(?)", 
		[[unit1, unit2]], 
		rows => {
			if (rows.length !== 2)
				throw Error("not 2 rows");
			const objUnitProps1 = (rows[0].unit === unit1) ? rows[0] : rows[1];
			const objUnitProps2 = (rows[0].unit === unit2) ? rows[0] : rows[1];
			compareUnitsByProps(conn, objUnitProps1, objUnitProps2, handleResult);
		}
	);
}

function compareUnitsByProps(conn, objUnitProps1, objUnitProps2, handleResult){
	if (objUnitProps1.unit === objUnitProps2.unit)
		return handleResult(0);
	if (objUnitProps1.level === objUnitProps2.level)
		return handleResult(null);
	if (objUnitProps1.is_free === 1 && objUnitProps2.is_free === 1) // free units
		return handleResult(null);
	
	// genesis
	if (objUnitProps1.latest_included_mc_index === null)
		return handleResult(-1);
	if (objUnitProps2.latest_included_mc_index === null)
		return handleResult(+1);
	
	if (objUnitProps1.latest_included_mc_index >= objUnitProps2.main_chain_index && objUnitProps2.main_chain_index !== null)
		return handleResult(+1);
	if (objUnitProps2.latest_included_mc_index >= objUnitProps1.main_chain_index && objUnitProps1.main_chain_index !== null)
		return handleResult(-1);
	
	if (objUnitProps1.level <= objUnitProps2.level 
		&& objUnitProps1.latest_included_mc_index <= objUnitProps2.latest_included_mc_index 
		&& (objUnitProps1.main_chain_index <= objUnitProps2.main_chain_index 
			&& objUnitProps1.main_chain_index !== null && objUnitProps2.main_chain_index !== null 
			|| objUnitProps1.main_chain_index === null || objUnitProps2.main_chain_index === null)
		||
		objUnitProps1.level >= objUnitProps2.level 
		&& objUnitProps1.latest_included_mc_index >= objUnitProps2.latest_included_mc_index 
		&& (objUnitProps1.main_chain_index >= objUnitProps2.main_chain_index
		   && objUnitProps1.main_chain_index !== null && objUnitProps2.main_chain_index !== null 
			|| objUnitProps1.main_chain_index === null || objUnitProps2.main_chain_index === null)
	){
		// still can be comparable
	}
	else
		return handleResult(null);
	
	const objEarlierUnit = (objUnitProps1.level < objUnitProps2.level) ? objUnitProps1 : objUnitProps2;
	const objLaterUnit = (objUnitProps1.level < objUnitProps2.level) ? objUnitProps2 : objUnitProps1;
	const resultIfFound = (objUnitProps1.level < objUnitProps2.level) ? -1 : 1;
	
	// can be negative if main_chain_index === null but that doesn't matter
	const earlier_unit_delta = objEarlierUnit.main_chain_index - objEarlierUnit.latest_included_mc_index;
	const later_unit_delta = objLaterUnit.main_chain_index - objLaterUnit.latest_included_mc_index;
	
	function goUp(arrStartUnits){
		//console.log('compare', arrStartUnits);
		conn.query(
			"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain \n\
			FROM parenthoods JOIN units ON parent_unit=unit \n\
			WHERE child_unit IN(?)",
			[arrStartUnits],
			rows => {
				const arrNewStartUnits = [];
				for (let i=0; i<rows.length; i++){
					const objUnitProps = rows[i];
					if (objUnitProps.unit === objEarlierUnit.unit)
						return handleResult(resultIfFound);
					if (objUnitProps.is_on_main_chain === 0 && objUnitProps.level > objEarlierUnit.level)
						arrNewStartUnits.push(objUnitProps.unit);
				}
				(arrNewStartUnits.length > 0) ? goUp(arrNewStartUnits) : handleResult(null);
			}
		);
	}
	
	function goDown(arrStartUnits){
		conn.query(
			"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain \n\
			FROM parenthoods JOIN units ON child_unit=unit \n\
			WHERE parent_unit IN(?)",
			[arrStartUnits],
			rows => {
				const arrNewStartUnits = [];
				for (let i=0; i<rows.length; i++){
					const objUnitProps = rows[i];
					if (objUnitProps.unit === objLaterUnit.unit)
						return handleResult(resultIfFound);
					if (objUnitProps.is_on_main_chain === 0 && objUnitProps.level < objLaterUnit.level)
						arrNewStartUnits.push(objUnitProps.unit);
				}
				(arrNewStartUnits.length > 0) ? goDown(arrNewStartUnits) : handleResult(null);
			}
		);
	}
	
	(later_unit_delta > earlier_unit_delta) ? goUp([objLaterUnit.unit]) : goDown([objEarlierUnit.unit]);
}


// determines if earlier_unit is included by at least one of arrLaterUnits 
function determineIfIncluded(conn, earlier_unit, arrLaterUnits, handleResult){
	if (!earlier_unit)
		throw Error("no earlier_unit");
	if (storage.isGenesisUnit(earlier_unit))
		return handleResult(true);
	storage.readPropsOfUnits(conn, earlier_unit, arrLaterUnits, ({is_free, main_chain_index, level}, arrLaterUnitProps) => {
		if (is_free === 1)
			return handleResult(false);
		
		const max_later_limci = Math.max.apply(
			null, arrLaterUnitProps.map(({latest_included_mc_index}) => latest_included_mc_index));
		//console.log("max limci "+max_later_limci+", earlier mci "+objEarlierUnitProps.main_chain_index);
		if (main_chain_index !== null && max_later_limci >= main_chain_index)
			return handleResult(true);
		
		const max_later_level = Math.max.apply(
			null, arrLaterUnitProps.map(({level}) => level));
		if (max_later_level < level)
			return handleResult(false);
		
		function goUp(arrStartUnits){
			//console.log('determine', earlier_unit, arrLaterUnits, arrStartUnits);
			conn.query(
				"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain \n\
				FROM parenthoods JOIN units ON parent_unit=unit \n\
				WHERE child_unit IN(?)",
				[arrStartUnits],
				rows => {
					const arrNewStartUnits = [];
					for (let i=0; i<rows.length; i++){
						const objUnitProps = rows[i];
						if (objUnitProps.unit === earlier_unit)
							return handleResult(true);
						if (objUnitProps.is_on_main_chain === 0 && objUnitProps.level > level)
							arrNewStartUnits.push(objUnitProps.unit);
					}
					(arrNewStartUnits.length > 0) ? goUp(_.uniq(arrNewStartUnits)) : handleResult(false);
				}
			);
		}
		
		goUp(arrLaterUnits);
	
	});
}

function determineIfIncludedOrEqual(conn, earlier_unit, arrLaterUnits, handleResult){
	if (arrLaterUnits.indexOf(earlier_unit) >= 0)
		return handleResult(true);
	determineIfIncluded(conn, earlier_unit, arrLaterUnits, handleResult);
}


// excludes earlier unit
function readDescendantUnitsByAuthorsBeforeMcIndex(
    conn,
    {main_chain_index, unit},
    arrAuthorAddresses,
    to_main_chain_index,
    handleUnits
) {
	
	let arrUnits = [];
	
	function goDown(arrStartUnits){
		profiler.start();
		conn.query(
			"SELECT units.unit, unit_authors.address AS author_in_list \n\
			FROM parenthoods \n\
			JOIN units ON child_unit=units.unit \n\
			LEFT JOIN unit_authors ON unit_authors.unit=units.unit AND address IN(?) \n\
			WHERE parent_unit IN(?) AND latest_included_mc_index<? AND main_chain_index<=?",
			[arrAuthorAddresses, arrStartUnits, main_chain_index, to_main_chain_index],
			rows => {
				const arrNewStartUnits = [];
				for (let i=0; i<rows.length; i++){
					const objUnitProps = rows[i];
					arrNewStartUnits.push(objUnitProps.unit);
					if (objUnitProps.author_in_list)
						arrUnits.push(objUnitProps.unit);
				}
				profiler.stop('mc-wc-descendants-goDown');
				(arrNewStartUnits.length > 0) ? goDown(arrNewStartUnits) : handleUnits(arrUnits);
			}
		);
	}
	
	profiler.start();

	conn.query( // _left_ join forces use of indexes in units
		`SELECT unit FROM units ${db.forceIndex("byMcIndex")} LEFT JOIN unit_authors USING(unit) \n\
        WHERE latest_included_mc_index>=? AND main_chain_index>? AND main_chain_index<=? AND latest_included_mc_index<? AND address IN(?)`, 
		[main_chain_index, main_chain_index, to_main_chain_index, to_main_chain_index, arrAuthorAddresses],
rows => {
			arrUnits = rows.map(({unit}) => unit);
			profiler.stop('mc-wc-descendants-initial');
			goDown([unit]);
		}
	);
}



// excludes earlier unit
function readDescendantUnitsBeforeLandingOnMc(conn, {main_chain_index, unit}, arrLaterUnitProps, handleUnits) {
	
	const max_later_limci = Math.max.apply(null, arrLaterUnitProps.map(({latest_included_mc_index}) => latest_included_mc_index));
	const max_later_level = Math.max.apply(null, arrLaterUnitProps.map(({level}) => level));
	const arrLandedUnits = []; // units that landed on MC before max_later_limci, they are already included in at least one of later units
	const arrUnlandedUnits = []; // direct shoots to later units, without touching the MC
	
	function goDown(arrStartUnits){
		conn.query(
			"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain \n\
			FROM parenthoods JOIN units ON child_unit=unit \n\
			WHERE parent_unit IN(?) AND latest_included_mc_index<? AND level<=?",
			[arrStartUnits, main_chain_index, max_later_level],
			rows => {
				const arrNewStartUnits = [];
				for (let i=0; i<rows.length; i++){
					const objUnitProps = rows[i];
					//if (objUnitProps.latest_included_mc_index >= objEarlierUnitProps.main_chain_index)
					//    continue;
					//if (objUnitProps.level > max_later_level)
					//    continue;
					arrNewStartUnits.push(objUnitProps.unit);
					if (objUnitProps.main_chain_index !== null && objUnitProps.main_chain_index <= max_later_limci) // exclude free balls!
						arrLandedUnits.push(objUnitProps.unit);
					else
						arrUnlandedUnits.push(objUnitProps.unit);
				}
				(arrNewStartUnits.length > 0) ? goDown(arrNewStartUnits) : handleUnits(arrLandedUnits, arrUnlandedUnits);
			}
		);
	}
	
	goDown([unit]);
}

// includes later units
function readAscendantUnitsAfterTakingOffMc(conn, {main_chain_index, level}, arrLaterUnitProps, handleUnits) {
	const arrLaterUnits = arrLaterUnitProps.map(({unit}) => unit);
	const max_later_limci = Math.max.apply(null, arrLaterUnitProps.map(({latest_included_mc_index}) => latest_included_mc_index));
	const arrLandedUnits = []; // units that took off MC after earlier unit's MCI, they already include the earlier unit
	const arrUnlandedUnits = []; // direct shoots from earlier units, without touching the MC
	
	arrLaterUnitProps.forEach(({latest_included_mc_index, unit}) => {
		if (latest_included_mc_index >= main_chain_index)
			arrLandedUnits.push(unit);
		else
			arrUnlandedUnits.push(unit);
	});
	
	function goUp(arrStartUnits){
		conn.query(
			"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain \n\
			FROM parenthoods JOIN units ON parent_unit=unit \n\
			WHERE child_unit IN(?) AND (main_chain_index>? OR main_chain_index IS NULL) AND level>=?",
			[arrStartUnits, max_later_limci, level],
			rows => {
				const arrNewStartUnits = [];
				for (let i=0; i<rows.length; i++){
					const objUnitProps = rows[i];
					//if (objUnitProps.main_chain_index <= max_later_limci)
					//    continue;
					//if (objUnitProps.level < objEarlierUnitProps.level)
					//    continue;
					arrNewStartUnits.push(objUnitProps.unit);
					if (objUnitProps.latest_included_mc_index >= main_chain_index)
						arrLandedUnits.push(objUnitProps.unit);
					else
						arrUnlandedUnits.push(objUnitProps.unit);
				}
				(arrNewStartUnits.length > 0) ? goUp(arrNewStartUnits) : handleUnits(arrLandedUnits, arrUnlandedUnits);
			}
		);
	}
	
	goUp(arrLaterUnits);
}


exports.compareUnitsByProps = compareUnitsByProps;
exports.compareUnits = compareUnits;

exports.determineIfIncluded = determineIfIncluded;
exports.determineIfIncludedOrEqual = determineIfIncludedOrEqual;

exports.readDescendantUnitsByAuthorsBeforeMcIndex = readDescendantUnitsByAuthorsBeforeMcIndex;

// used only in majority_witnessing.js which is not used itself
exports.readDescendantUnitsBeforeLandingOnMc = readDescendantUnitsBeforeLandingOnMc;
exports.readAscendantUnitsAfterTakingOffMc = readAscendantUnitsAfterTakingOffMc;
