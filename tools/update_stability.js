/*jslint node: true */
'use strict';
var db = require('../db.js');
var main_chain = require('../main_chain.js');

var args = process.argv.slice(2);
var earlier_unit = args[0];
var arrLaterUnits = args[1].split(',');

console.log("update stability of " + earlier_unit + " in " + arrLaterUnits);

db.executeInTransaction(function(conn, cb){
	main_chain.determineIfStableInLaterUnitsAndUpdateStableMcFlag(conn, earlier_unit, arrLaterUnits, false, function (bStable) {
		console.log('--- stable? ', bStable);
		cb();
	});
});
