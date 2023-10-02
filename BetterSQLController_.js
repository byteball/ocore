const path = require('path');
const worker = new Worker(path.resolve(__dirname, 'betterSQL_worker.js'));



const assocTagToResolve = {};
let cbR = (data) => {
};
worker.onmessage = event => {
	const {tag, data} = event.data;
	if (!assocTagToResolve[tag]) {
		throw new Error('??');
	}
	assocTagToResolve[tag](data);
	delete assocTagToResolve[tag];
};

function defaultCB() {
	
}

function runTask(params, name) {
	return new Promise((resolve) => {
		const tag = Math.random()
			.toString(36)
			.substring(7);
		worker.postMessage({ params, name, tag });
		assocTagToResolve[tag] = resolve;
	});
}

async function awaitToCB(params, name, cb) {
	if (!cb && params.args) {
		cb = params.args;
		params = { query: params.query };
	}
	if (!cb && !params.args) {
		cb = defaultCB;
	}
	
	if (name === 'pragma') {
		cb = cb.bind({ changes: 0, lastID: 0 });
	}
	
	try {
		const result = await runTask(params, name);
		if (name === 'run') {
			cb = cb.bind(result);
		}
		cb(false, result);
	} catch (err) {
		cb(err);
	}
}

class BetterSQL {
	constructor(path, cb) {
		awaitToCB(path, 'init', cb);
	}
	
	run(query, args, cb) {
		awaitToCB({ query, args }, 'run', cb);
	}
	
	all(query, args, cb) {
		awaitToCB({ query, args }, 'all', cb);
	}
	
	close(cb) {
		cb();
	}
}

module.exports = BetterSQL;
