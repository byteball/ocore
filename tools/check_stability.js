/*jslint node: true */
'use strict';
var db = require('../db.js');
var main_chain = require('../main_chain.js');

var args = process.argv.slice(2);
var earlier_unit = args[0];
var arrLaterUnits = args[1].split(',');

console.log("checking stability of " + earlier_unit + " in " + arrLaterUnits);

main_chain.determineIfStableInLaterUnits(db, earlier_unit, arrLaterUnits, function (bStable) {
	console.log('--- stable? ', bStable);
});
