/*jslint node: true */
"use strict";
var async = require('async');
var db = require('./db.js');
var graph = require('./graph.js');


// unit's MC index is earlier_mci
function buildProofChain(later_mci, earlier_mci, unit, arrBalls, onDone){
	if (earlier_mci === null)
		throw Error("earlier_mci=null, unit="+unit);
	if (later_mci === earlier_mci)
		return buildLastMileOfProofChain(earlier_mci, unit, arrBalls, onDone);
	buildProofChainOnMc(later_mci, earlier_mci, arrBalls, function(){
		buildLastMileOfProofChain(earlier_mci, unit, arrBalls, onDone);
	});
}

// later_mci is already known and not included in the chain
function buildProofChainOnMc(later_mci, earlier_mci, arrBalls, onDone){
	
	function addBall(mci){
		if (mci < 0)
			throw Error("mci<0, later_mci="+later_mci+", earlier_mci="+earlier_mci);
		db.query("SELECT unit, ball, content_hash FROM units JOIN balls USING(unit) WHERE main_chain_index=? AND is_on_main_chain=1", [mci], function(rows){
			if (rows.length !== 1)
				throw Error("no prev chain element? mci="+mci+", later_mci="+later_mci+", earlier_mci="+earlier_mci);
			var objBall = rows[0];
			if (objBall.content_hash)
				objBall.is_nonserial = true;
			delete objBall.content_hash;
			db.query(
				"SELECT ball FROM parenthoods LEFT JOIN balls ON parent_unit=balls.unit WHERE child_unit=? ORDER BY ball", 
				[objBall.unit],
				function(parent_rows){
					if (parent_rows.some(function(parent_row){ return !parent_row.ball; }))
						throw Error("some parents have no balls");
					if (parent_rows.length > 0)
						objBall.parent_balls = parent_rows.map(function(parent_row){ return parent_row.ball; });
					db.query(
						"SELECT ball, main_chain_index \n\
						FROM skiplist_units JOIN units ON skiplist_unit=units.unit LEFT JOIN balls ON units.unit=balls.unit \n\
						WHERE skiplist_units.unit=? ORDER BY ball", 
						[objBall.unit],
						function(srows){
							if (srows.some(function(srow){ return !srow.ball; }))
								throw Error("some skiplist units have no balls");
							if (srows.length > 0)
								objBall.skiplist_balls = srows.map(function(srow){ return srow.ball; });
							arrBalls.push(objBall);
							if (mci === earlier_mci)
								return onDone();
							if (srows.length === 0) // no skiplist
								return addBall(mci-1);
							var next_mci = mci - 1;
							for (var i=0; i<srows.length; i++){
								var next_skiplist_mci = srows[i].main_chain_index;
								if (next_skiplist_mci < next_mci && next_skiplist_mci >= earlier_mci)
									next_mci = next_skiplist_mci;
							}
							addBall(next_mci);
						}
					);
				}
			);
		});
	}
	
	if (earlier_mci > later_mci)
		throw Error("earlier > later");
	if (earlier_mci === later_mci)
		return onDone();
	addBall(later_mci - 1);
}

// unit's MC index is mci, find a path from mci unit to this unit
function buildLastMileOfProofChain(mci, unit, arrBalls, onDone){
	function addBall(_unit){
		db.query("SELECT unit, ball, content_hash FROM units JOIN balls USING(unit) WHERE unit=?", [_unit], function(rows){
			if (rows.length !== 1)
				throw Error("no unit?");
			var objBall = rows[0];
			if (objBall.content_hash)
				objBall.is_nonserial = true;
			delete objBall.content_hash;
			db.query(
				"SELECT ball FROM parenthoods LEFT JOIN balls ON parent_unit=balls.unit WHERE child_unit=? ORDER BY ball", 
				[objBall.unit],
				function(parent_rows){
					if (parent_rows.some(function(parent_row){ return !parent_row.ball; }))
						throw Error("some parents have no balls");
					if (parent_rows.length > 0)
						objBall.parent_balls = parent_rows.map(function(parent_row){ return parent_row.ball; });
					db.query(
						"SELECT ball \n\
						FROM skiplist_units JOIN units ON skiplist_unit=units.unit LEFT JOIN balls ON units.unit=balls.unit \n\
						WHERE skiplist_units.unit=? ORDER BY ball", 
						[objBall.unit],
						function(srows){
							if (srows.some(function(srow){ return !srow.ball; }))
								throw Error("last mile: some skiplist units have no balls");
							if (srows.length > 0)
								objBall.skiplist_balls = srows.map(function(srow){ return srow.ball; });
							arrBalls.push(objBall);
							if (_unit === unit)
								return onDone();
							findParent(_unit);
						}
					);
				}
			);
		});
	}
	
	function findParent(interim_unit){
		db.query(
			"SELECT parent_unit FROM parenthoods JOIN units ON parent_unit=unit WHERE child_unit=? AND main_chain_index=?", 
			[interim_unit, mci],
			function(parent_rows){
				var arrParents = parent_rows.map(function(parent_row){ return parent_row.parent_unit; });
				if (arrParents.indexOf(unit) >= 0)
					return addBall(unit);
				async.eachSeries(
					arrParents,
					function(parent_unit, cb){
						graph.determineIfIncluded(db, unit, [parent_unit], function(bIncluded){
							bIncluded ? cb(parent_unit) : cb();
						});
					},
					function(parent_unit){
						if (!parent_unit)
							throw Error("no parent that includes target unit");
						addBall(parent_unit);
					}
				)
			}
		);
	}
	
	// start from MC unit and go back in history
	db.query("SELECT unit FROM units WHERE main_chain_index=? AND is_on_main_chain=1", [mci], function(rows){
		if (rows.length !== 1)
			throw Error("no mc unit?");
		var mc_unit = rows[0].unit;
		if (mc_unit === unit)
			return onDone();
		findParent(mc_unit);
	});
}

exports.buildProofChain = buildProofChain;
exports.buildProofChainOnMc = buildProofChainOnMc;
