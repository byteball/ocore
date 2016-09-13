/*jslint node: true */
"use strict";
var _ = require('lodash');
var async = require('async');
var storage = require('./storage.js');
var db = require('./db.js');
var profiler = require('./profiler.js');



function compareUnits(conn, unit1, unit2, handleResult){
	if (unit1 === unit2)
		return handleResult(0);
	conn.query(
		"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain, is_free FROM units WHERE unit IN(?)", 
		[[unit1, unit2]], 
		function(rows){
			if (rows.length !== 2)
				throw Error("not 2 rows");
			var objUnitProps1 = (rows[0].unit === unit1) ? rows[0] : rows[1];
			var objUnitProps2 = (rows[0].unit === unit2) ? rows[0] : rows[1];
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
	
	var objEarlierUnit = (objUnitProps1.level < objUnitProps2.level) ? objUnitProps1 : objUnitProps2;
	var objLaterUnit = (objUnitProps1.level < objUnitProps2.level) ? objUnitProps2 : objUnitProps1;
	var resultIfFound = (objUnitProps1.level < objUnitProps2.level) ? -1 : 1;
	
	// can be negative if main_chain_index === null but that doesn't matter
	var earlier_unit_delta = objEarlierUnit.main_chain_index - objEarlierUnit.latest_included_mc_index;
	var later_unit_delta = objLaterUnit.main_chain_index - objLaterUnit.latest_included_mc_index;
	
	function goUp(arrStartUnits){
		//console.log('compare', arrStartUnits);
		conn.query(
			"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain \n\
			FROM parenthoods JOIN units ON parent_unit=unit \n\
			WHERE child_unit IN(?)",
			[arrStartUnits],
			function(rows){
				var arrNewStartUnits = [];
				for (var i=0; i<rows.length; i++){
					var objUnitProps = rows[i];
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
			function(rows){
				var arrNewStartUnits = [];
				for (var i=0; i<rows.length; i++){
					var objUnitProps = rows[i];
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
	storage.readPropsOfUnits(conn, earlier_unit, arrLaterUnits, function(objEarlierUnitProps, arrLaterUnitProps){
		if (objEarlierUnitProps.is_free === 1)
			return handleResult(false);
		
		var max_later_limci = Math.max.apply(
			null, arrLaterUnitProps.map(function(objLaterUnitProps){ return objLaterUnitProps.latest_included_mc_index; }));
		//console.log("max limci "+max_later_limci+", earlier mci "+objEarlierUnitProps.main_chain_index);
		if (objEarlierUnitProps.main_chain_index !== null && max_later_limci >= objEarlierUnitProps.main_chain_index)
			return handleResult(true);
		
		var max_later_level = Math.max.apply(
			null, arrLaterUnitProps.map(function(objLaterUnitProps){ return objLaterUnitProps.level; }));
		if (max_later_level < objEarlierUnitProps.level)
			return handleResult(false);
		
		function goUp(arrStartUnits){
			//console.log('determine', earlier_unit, arrLaterUnits, arrStartUnits);
			conn.query(
				"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain \n\
				FROM parenthoods JOIN units ON parent_unit=unit \n\
				WHERE child_unit IN(?)",
				[arrStartUnits],
				function(rows){
					var arrNewStartUnits = [];
					for (var i=0; i<rows.length; i++){
						var objUnitProps = rows[i];
						if (objUnitProps.unit === earlier_unit)
							return handleResult(true);
						if (objUnitProps.is_on_main_chain === 0 && objUnitProps.level > objEarlierUnitProps.level)
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
function readDescendantUnitsByAuthorsBeforeMcIndex(conn, objEarlierUnitProps, arrAuthorAddresses, to_main_chain_index, handleUnits){
	
	var arrUnits = [];
	
	function goDown(arrStartUnits){
		profiler.start();
		conn.query(
			"SELECT units.unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain, unit_authors.address AS author_in_list \n\
			FROM parenthoods \n\
			JOIN units ON child_unit=units.unit \n\
			LEFT JOIN unit_authors ON unit_authors.unit=units.unit AND address IN(?) \n\
			WHERE parent_unit IN(?) AND latest_included_mc_index<? AND main_chain_index<=?",
			[arrAuthorAddresses, arrStartUnits, objEarlierUnitProps.main_chain_index, to_main_chain_index],
			function(rows){
				var arrNewStartUnits = [];
				for (var i=0; i<rows.length; i++){
					var objUnitProps = rows[i];
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
	conn.query(
		"SELECT unit FROM units JOIN unit_authors USING(unit) \n\
		WHERE latest_included_mc_index>=? AND main_chain_index>? AND main_chain_index<=? AND latest_included_mc_index<? AND address IN(?)", 
		[objEarlierUnitProps.main_chain_index, objEarlierUnitProps.main_chain_index, to_main_chain_index, to_main_chain_index, arrAuthorAddresses],
//        "SELECT unit FROM units WHERE latest_included_mc_index>=? AND main_chain_index<=?", 
//        [objEarlierUnitProps.main_chain_index, to_main_chain_index],
		function(rows){
			arrUnits = rows.map(function(row) { return row.unit; });
			profiler.stop('mc-wc-descendants-initial');
			goDown([objEarlierUnitProps.unit]);
		}
	);
}



// excludes earlier unit
function readDescendantUnitsBeforeLandingOnMc(conn, objEarlierUnitProps, arrLaterUnitProps, handleUnits){
	
	var max_later_limci = Math.max.apply(null, arrLaterUnitProps.map(function(objLaterUnitProps){ return objLaterUnitProps.latest_included_mc_index; }));
	var max_later_level = Math.max.apply(null, arrLaterUnitProps.map(function(objLaterUnitProps){ return objLaterUnitProps.level; }));
	var arrLandedUnits = []; // units that landed on MC before max_later_limci, they are already included in at least one of later units
	var arrUnlandedUnits = []; // direct shoots to later units, without touching the MC
	
	function goDown(arrStartUnits){
		conn.query(
			"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain \n\
			FROM parenthoods JOIN units ON child_unit=unit \n\
			WHERE parent_unit IN(?) AND latest_included_mc_index<? AND level<=?",
			[arrStartUnits, objEarlierUnitProps.main_chain_index, max_later_level],
			function(rows){
				var arrNewStartUnits = [];
				for (var i=0; i<rows.length; i++){
					var objUnitProps = rows[i];
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
	
	goDown([objEarlierUnitProps.unit]);
}

// includes later units
function readAscendantUnitsAfterTakingOffMc(conn, objEarlierUnitProps, arrLaterUnitProps, handleUnits){
	var arrLaterUnits = arrLaterUnitProps.map(function(objLaterUnitProps){ return objLaterUnitProps.unit; });
	var max_later_limci = Math.max.apply(null, arrLaterUnitProps.map(function(objLaterUnitProps){ return objLaterUnitProps.latest_included_mc_index; }));
	var arrLandedUnits = []; // units that took off MC after earlier unit's MCI, they already include the earlier unit
	var arrUnlandedUnits = []; // direct shoots from earlier units, without touching the MC
	
	arrLaterUnitProps.forEach(function(objUnitProps){
		if (objUnitProps.latest_included_mc_index >= objEarlierUnitProps.main_chain_index)
			arrLandedUnits.push(objUnitProps.unit);
		else
			arrUnlandedUnits.push(objUnitProps.unit);
	});
	
	function goUp(arrStartUnits){
		conn.query(
			"SELECT unit, level, latest_included_mc_index, main_chain_index, is_on_main_chain \n\
			FROM parenthoods JOIN units ON parent_unit=unit \n\
			WHERE child_unit IN(?) AND (main_chain_index>? OR main_chain_index IS NULL) AND level>=?",
			[arrStartUnits, max_later_limci, objEarlierUnitProps.level],
			function(rows){
				var arrNewStartUnits = [];
				for (var i=0; i<rows.length; i++){
					var objUnitProps = rows[i];
					//if (objUnitProps.main_chain_index <= max_later_limci)
					//    continue;
					//if (objUnitProps.level < objEarlierUnitProps.level)
					//    continue;
					arrNewStartUnits.push(objUnitProps.unit);
					if (objUnitProps.latest_included_mc_index >= objEarlierUnitProps.main_chain_index)
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
