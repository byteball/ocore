/*jslint node: true */
'use strict';
var async = require('async');
var constants = require('../constants.js');
var db = require('../db.js');
var storage = require('../storage.js');
var aa_validation = require('../aa_validation.js');


var readGetterProps = function (aa_address, func_name, cb) {
	storage.readAAGetterProps(db, aa_address, func_name, cb);
};


db.query("SELECT address, definition, mci, unit FROM aa_addresses ORDER BY rowid", rows => {
	async.eachSeries(
		rows,
		function (row, cb) {
			if (constants.bTestnet && ['BD7RTYgniYtyCX0t/a/mmAAZEiK/ZhTvInCMCPG5B1k=', 'EHEkkpiLVTkBHkn8NhzZG/o4IphnrmhRGxp4uQdEkco=', 'bx8VlbNQm2WA2ruIhx04zMrlpQq3EChK6o3k5OXJ130=', '08t8w/xuHcsKlMpPWajzzadmMGv+S4AoeV/QL1F3kBM='].indexOf(row.unit) >= 0) {
				console.log(row.address, 'skipped');
				return cb();
			}
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
