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
		charset  : 'UTF8MB4_UNICODE_520_CI', // https://github.com/mysqljs/mysql/blob/master/lib/protocol/constants/charsets.js
		database : conf.database.name
	});

	module.exports = mysql_pool_constructor(pool);
}
else if (conf.storage === 'sqlite'){
	// var sqlitePool = require('./sqlite_pool.js');
	// module.exports = sqlitePool(conf.database.filename, conf.database.max_connections, conf.database.bReadOnly);
} else if(conf.storage === 'better') {
	const betterPool = require('./better_sqlite_pool.js');
	module.exports = betterPool(conf.database.filename, conf.database.max_connections, conf.database.bReadOnly);
}

function executeInTransaction(doWork, onDone){
	module.exports.takeConnectionFromPool(function(conn){
		conn.query("BEGIN", function(){
			doWork(conn, function(err){
				conn.query(err ? "ROLLBACK" : "COMMIT", function(){
					conn.release();
					if (onDone)
						onDone(err);
				});
			});
		});
	});
}

module.exports.executeInTransaction = executeInTransaction;
