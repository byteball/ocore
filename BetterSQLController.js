const { Database } = require("bun:sqlite");
let db;

const defaultCB = () => {};

class BetterSQL {
	constructor(path, cb) {
		process.nextTick(() => {
			db = new Database(path);
			cb();
		})
	}
	
	run(query, args, cb) {
		process.nextTick(() => {
			if (!cb && args) {
				cb = args;
				args = [];
			}
			if (!cb && !args) {
				cb = defaultCB;
			}
			
			if (query.startsWith("PRAGMA")) {
				const result = db.exec(query);
				cb = cb.bind(result);
				return cb(false, result);
			}
			
			const result = db.query(query).get(...args);
			cb = cb.bind(result);
			return cb(false, result);
		});
	}
	
	all(query, args, cb) {
		process.nextTick(() => {
			if (!cb && args) {
				cb = args;
				args = [];
			}
			if (!cb && !args) {
				cb = defaultCB;
			}
			
			const result = db.query(query).all(...args);
			return cb(false, result);
		})
	}
	
	close(cb) {
		process.nextTick(() => {
			db.close();
			cb();
		})
	}
}

module.exports = BetterSQL;
