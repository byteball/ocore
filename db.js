/*jslint node: true */
"use strict";
var conf = require('./conf.js');

if (conf.storage === 'mysql'){
	var mysql = require('mysql');
	var mysql_pool_constructor = require('./mysql_pool.js');
	var pool  = mysql.createPool({
	//var pool  = mysql.createConnection({
		connectionLimit : conf.database.max_connections,
		host     : conf.database.host,
		user     : conf.database.user,
		password : conf.database.password,
		charset  : 'UTF8_UNICODE_CI',
		database : conf.database.name
	});

	module.exports = mysql_pool_constructor(pool);
}
else if (conf.storage === 'sqlite'){
	var sqlitePool = require('./sqlite_pool.js');
	module.exports = sqlitePool(conf.database.filename, conf.database.max_connections, conf.database.bReadOnly);
}

