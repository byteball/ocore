/*jslint node: true */
const mysql = require('mysql');

module.exports = connection_or_pool => {

	console.log("constructor");
	const safe_connection = connection_or_pool;
	safe_connection.original_query = safe_connection.query;
	safe_connection.original_release = safe_connection.release;
	
	// this is a hack to make all errors throw exception that would kill the program
	safe_connection.query = function(...args) {
		let last_arg = args[args.length - 1];
		const bHasCallback = (typeof last_arg === 'function');
		if (!bHasCallback){ // no callback
			last_arg = () => {};
			//return connection_or_pool.original_query.apply(connection_or_pool, arguments);
		}
		const count_arguments_without_callback = bHasCallback ? (args.length-1) : args.length;
		const new_args = [];
		let q;
		
		for (let i=0; i<count_arguments_without_callback; i++) // except callback
			new_args.push(args[i]);
		
		// add callback with error handling
		new_args.push((err, results, fields) => {
			if (err){
				console.error(`\nfailed query: ${q.sql}`);
				/*
				//console.error("code: "+(typeof err.code));
				if (false && err.code === 'ER_LOCK_DEADLOCK'){
					console.log("deadlock, will retry later");
					setTimeout(function(){
						console.log("retrying deadlock query "+q.sql+" after timeout ...");
						connection_or_pool.original_query.apply(connection_or_pool, new_args);
					}, 100);
					return;
				}*/
				throw err;
			}
			last_arg(results, fields);
		});
		//console.log(new_args);
		q = connection_or_pool.original_query(...new_args);
		//console.log(q.sql);
		return q;
	};

	//safe_connection.escape = connection_or_pool.escape;
	
	safe_connection.release = () => {
		//console.log("releasing connection");
		connection_or_pool.original_release();
	};

	safe_connection.addQuery = function (arr) {
		const query_args = [];
		for (let i=1; i<arguments.length; i++) // except first, which is array
			query_args.push(arguments[i]);
		arr.push(callback => { // add callback for async.series() member tasks
			if (typeof query_args[query_args.length-1] !== 'function')
				query_args.push(() => {callback();}); // add mysql callback
			else{
				const f = query_args[query_args.length-1];
				query_args[query_args.length-1] = function(...args) {
					f.apply(f, args);
					callback();
				}
			}
			safe_connection.query(...query_args);
		});
	};

	// this is for pool only
	safe_connection.takeConnectionFromPool = handleConnection => {
		connection_or_pool.getConnection((err, new_connection) => {
			if (err)
				throw err;
			console.log("got connection from pool");
			handleConnection(new_connection.original_query ? new_connection : module.exports(new_connection));
		});
	};
	
	safe_connection.getCountUsedConnections = () => safe_connection._allConnections.length - safe_connection._freeConnections.length;
	
	safe_connection.close = cb => {
		connection_or_pool.end(cb);
	};
	
	safe_connection.addTime = interval => `NOW() + INTERVAL ${interval}`;

	safe_connection.getNow = () => "NOW()";

	safe_connection.getFromUnixTime = ts => `FROM_UNIXTIME(${ts})`;

	safe_connection.getRandom = () => "RAND()";

	safe_connection.forceIndex = index => `FORCE INDEX (${index})`;

	safe_connection.dropTemporaryTable = table => `DROP TEMPORARY TABLE IF EXISTS ${table}`;

	safe_connection.getIgnore = () => "IGNORE";

	safe_connection.getUnixTimestamp = date => `UNIX_TIMESTAMP(${date})`;

	return safe_connection;
};
