const { Database } = require("bun:sqlite");
let db;

const avg = { 
	run: { sum: 0, count: 0, max: 0 }, 
	all: { sum: 0, count: 0, max: 0 } 
};

function response(tag, data) {
	postMessage({ tag, data });
}

self.onmessage = async (event) => {
	const { name, params, tag } = event.data;
	let result;
	switch (name) {
		case 'init':
			result = init(params);
			break;
		case 'run':
			result = run(params.query, params.args);
			break;
		case 'all':
			result = all(params.query, params.args || []);
			break;
		default:
			return;
	}
	
	response(tag, result);
};

function init(path) {
	try {
		db = new Database(path);
	} catch (e) {
		return e;
	}
	console.log('init');
	return 0;
}

function run(query, args) {
	const d = Bun.nanoseconds();
	const r = db.prepare(query).get(...args);
	const c = (Bun.nanoseconds() - d) / 1000000;
	avg.run.sum += c;
	if (avg.run.max < c) {
		avg.run.max = c
	}
	avg.run.count++;
	if (avg.run.count === 1000) {
		console.error(`AVG:RUN: ${avg.run.sum / avg.run.count} ms, max: ${avg.run.max} ms`);
		avg.run = { sum: 0, count: 0, max: 0 };
	}
	return r;
}

function all(query, args) {
	const d = Bun.nanoseconds();
	const r = db.prepare(query).all(...args);
	const c = (Bun.nanoseconds() - d) / 1000000; 
	avg.all.sum += c;
	if (avg.all.max < c) {
		avg.all.max = c
	}
	avg.all.count++;
	if (avg.all.count === 1000) {
		console.error(`AVG:ALL: ${avg.all.sum / avg.all.count} ms, max: ${avg.all.max} ms`);
		avg.all = { sum: 0, count: 0, max: 0 };
	}
	return r;
}