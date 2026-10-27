/*jslint node: true */
"use strict";
const fs = require('fs');
const { Readable } = require('stream');
const rocksdb_js = require('@harperfast/rocksdb-js');
const { RocksDatabase } = rocksdb_js;
const app_data_dir = require('./desktop_app.js').getAppDataDir();
let path = app_data_dir + '/rocksdb';

try{
	fs.statSync(app_data_dir);
}
catch(e){
	const mode = parseInt('700', 8);
	const parent_dir = require('path').dirname(app_data_dir);
	try { fs.mkdirSync(parent_dir, mode); } catch(e){}
	try { fs.mkdirSync(app_data_dir, mode); } catch(e){}
}

if (process.platform === 'win32') {
	process.chdir(app_data_dir); // workaround non-latin characters in path
	path = 'rocksdb';
}

// raw utf8 keys and values, byte-compatible with the data written by the old rocksdb binding
const db_options = { keyEncoding: 'binary', encoding: 'binary' };

let db;
try {
	db = RocksDatabase.open(path, db_options);
}
catch (e) {
	throw Error("rocksdb open failed (is the app already running?): " + e);
}
if (!db)
	throw Error("no rocksdb instance");

process.on('exit', () => {
	try {
		rocksdb_js.shutdown();
	}
	catch (e) {
		console.error('rocksdb shutdown failed', e);
	}
});

function bufferToString(buf) {
	return Buffer.isBuffer(buf) ? buf.toString('utf8') : buf;
}

// translates level-style range options (gt, gte, lt, lte, limit) to rocksdb-js options
function toRangeOptions(options = {}) {
	if (options.reverse)
		throw Error("reverse iteration is not supported");
	const range = {};
	if (options.gte !== undefined)
		range.start = options.gte;
	else if (options.gt !== undefined) {
		range.start = options.gt;
		range.exclusiveStart = true;
	}
	if (options.lte !== undefined) {
		range.end = options.lte;
		range.inclusiveEnd = true;
	}
	else if (options.lt !== undefined)
		range.end = options.lt;
	if (options.limit !== undefined && options.limit >= 0)
		range.limit = options.limit;
	return range;
}

function createStream(options, bKeysOnly) {
	const range = toRangeOptions(options);
	const iterator = (bKeysOnly ? db.getKeys(range) : db.getRange(range))[Symbol.iterator]();
	return new Readable({
		objectMode: true,
		read() {
			try {
				while (true) {
					const item = iterator.next();
					if (item.done)
						return this.push(null);
					const data = bKeysOnly
						? bufferToString(item.value)
						: { key: bufferToString(item.value.key), value: bufferToString(item.value.value) };
					if (!this.push(data))
						return;
				}
			}
			catch (e) {
				this.destroy(e);
			}
		},
		destroy(err, cb) {
			try {
				if (iterator.return)
					iterator.return();
			}
			catch (e) {}
			cb(err);
		}
	});
}

function createBatch() {
	let ops = [];
	let bWritten = false;
	const checkNotWritten = () => {
		if (bWritten)
			throw Error("batch already written");
	};
	const batch = {
		put: (key, val) => {
			checkNotWritten();
			ops.push({ key, val });
			return batch;
		},
		del: (key) => {
			checkNotWritten();
			ops.push({ key, bDel: true });
			return batch;
		},
		clear: () => {
			checkNotWritten();
			ops = [];
			return batch;
		},
		// sync is honored only when the installed rocksdb-js exposes syncWal() (added after 2.12.0)
		write: (options, cb) => {
			if (typeof options === 'function')
				cb = options;
			checkNotWritten();
			bWritten = true;
			const arrOps = ops;
			const bSync = options && options.sync && typeof db.syncWal === 'function';
			db.transaction(txn => {
				arrOps.forEach(op => {
					if (op.bDel)
						txn.removeSync(op.key);
					else
						txn.putSync(op.key, op.val);
				});
			})
			.then(() => bSync ? db.syncWal() : undefined)
			.then(
				() => setImmediate(cb),
				err => setImmediate(cb, err)
			);
		}
	};
	return batch;
}

module.exports = {
	get: (key, cb) => {
		const onError = err => {
			setImmediate(() => {
				throw Error("get " + key + " failed: " + err);
			});
		};
		const onValue = val => {
			const str = bufferToString(val); // convert right away, the buffer may be reused
			setImmediate(() => cb(str));
		};
		let res;
		try {
			res = db.get(key);
		}
		catch (e) {
			return onError(e);
		}
		if (res instanceof Promise)
			res.then(onValue, onError);
		else
			onValue(res);
	},
	
	put: (key, val, cb) => {
		db.put(key, val).then(
			() => setImmediate(cb),
			err => setImmediate(() => {
				throw Error("put " + key + " = " + val + " failed: " + err);
			})
		);
	},
	
	del: (key, cb) => {
		db.remove(key).then(
			() => {
				if (cb)
					setImmediate(cb);
			},
			err => setImmediate(() => {
				throw Error("del " + key + " failed: " + err);
			})
		);
	},
	
	batch: createBatch,
	
	createReadStream: options => createStream(options, false),
	
	createKeyStream: options => createStream(options, true),
	
	open: cb => {
		if (db.isOpen()) return cb('already open');
		try {
			db.open();
		}
		catch (e) {
			return cb(e.toString());
		}
		cb();
	},

	close: cb => {
		if (!db.isOpen()) return cb('already closed');
		try {
			db.close();
		}
		catch (e) {
			return cb(e.toString());
		}
		cb();
	}
};
