/*jslint node: true */
const conf = require('./conf.js');

if (conf.storage === 'mysql'){
	const mysql = require('mysql');
	const mysql_pool_constructor = require('./mysql_pool.js');
	const pool  = mysql.createPool({
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
	const sqlitePool = require('./sqlite_pool.js');
	module.exports = sqlitePool(conf.database.filename, conf.database.max_connections, conf.database.bReadOnly);
}

function executeInTransaction(doWork, onDone){
	module.exports.takeConnectionFromPool(conn => {
		conn.query("BEGIN", () => {
			doWork(conn, err => {
				conn.query(err ? "ROLLBACK" : "COMMIT", () => {
					conn.release();
					onDone(err);
				});
			});
		});
	});
}

module.exports.executeInTransaction = executeInTransaction;
