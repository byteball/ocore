/*jslint node: true */
'use strict';
var async = require('async');
var db = require('../db.js');
var storage = require('../storage.js');
var aa_validation = require('../aa_validation.js');


var readGetterProps = function (aa_address, func_name, cb) {
	storage.readAAGetterProps(db, aa_address, func_name, cb);
};


db.query("SELECT address, definition, mci FROM aa_addresses ORDER BY rowid", rows => {
	async.eachSeries(
		rows,
		function (row, cb) {
			var arrDefinition = JSON.parse(row.definition);
			aa_validation.validateAADefinition(arrDefinition, readGetterProps, row.mci, err => {
				console.log(row.address, err);
				err ? cb("validation of " + row.address + " failed: " + err) : cb();
			});
		},
		function (err) {
			console.log('done, err = ', err);
			process.exit();
		}
	)
});
