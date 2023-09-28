const { Database } = require("bun:sqlite");
let db;

const defaultCB = () => {};

class BetterSQL {
	constructor(path, cb) {
		db = new Database(path);
		setImmediate(cb);
	}
	
	run(query, args, cb) {
		if (!cb && args) {
			cb = args;
			args = [];
		}
		if (!cb && !args) {
			cb = defaultCB;
		}
		
		const result = db.prepare(query).get(...args);
		cb = cb.bind(result);
		return cb(false, result);
	}
	
	all(query, args, cb) {
		if (!cb && args) {
			cb = args;
			args = [];
		}
		if (!cb && !args) {
			cb = defaultCB;
		}
		
		const result = db.prepare(query).all(...args);
		return cb(false, result);
	}
	
	close(cb) {
		db.close();
		cb();
	}
}

module.exports = BetterSQL;
