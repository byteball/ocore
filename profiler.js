/*jslint node: true */
let count = 0;
const times = {};
let start_ts = 0;

const timers = {};
const timers_results = {};
const profiler_start_ts = Date.now();

function mark_start(tag, id) {
	return;
	if (!id) id = 0;
	if (!timers[tag]) timers[tag] = {};
	if (timers[tag][id])
		throw Error(`multiple start marks for ${tag}[${id}]`);
	timers[tag][id] = Date.now();
}

function mark_end(tag, id) {
	return;
	if (!timers[tag]) return;
	if (!id) id = 0;
	if (!timers_results[tag])
		timers_results[tag] = [];
	timers_results[tag].push(Date.now() - timers[tag][id]);
	timers[tag][id] = 0;
}

function start(){
	if (start_ts)
		throw Error("profiler already started");
	start_ts = Date.now();
}

function stop(tag){
	if (!start_ts)
		throw Error("profiler not started");
	if (!times[tag])
		times[tag] = 0;
	times[tag] += Date.now() - start_ts;
	start_ts = 0;
}

function print(){
	console.log("\nProfiling results:");
	let total = 0;
	for (var tag in times)
		total += times[tag];
	for (var tag in times){
		console.log(
			`${pad_right(`${tag}: `, 33) + 
pad_left(times[tag], 5)}, ${pad_left((times[tag]/count).toFixed(2), 5)} per unit, ${pad_left((100*times[tag]/total).toFixed(2), 5)}%`
		);
	}
	console.log(`total: ${total}`);
	console.log(`${total/count} per unit`);
}

function print_results() {
	console.log("\nBenchmarking results:");
	for (const tag in timers_results) {
        const results = timers_results[tag];
        let sum = 0;
        let max = 0;
        let min = 999999999999;
        for (let i = 0; i < results.length; i++) {
			const v = results[i];
			sum += v;
			if (v > max) max = v;
			if (v < min) min = v;
		}
        console.log(`${tag.padding(50)}: avg:${Math.round(sum / results.length).toString().padding(8)}max:${Math.round(max).toString().padding(8)}min:${Math.round(min).toString().padding(8)}records:${results.length}`);
    }
	console.log(`\n\nStart time: ${profiler_start_ts}, End time: ${Date.now()} Elapsed ms:${Date.now() - profiler_start_ts}`);
}

function pad_right(str, len){
	if (str.length >= len)
		return str;
	return str + ' '.repeat(len - str.length);
}

function pad_left(str, len){
	str = `${str}`;
	if (str.length >= len)
		return str;
	return ' '.repeat(len - str.length) + str;
}

function increment(){
	count++;
}

process.on('SIGINT', () => {
	console.log = clog;
	console.log("received sigint");
	//print();
	print_results();
	process.exit();
});

String.prototype.padding = function(n, c)
{
        const val = this.valueOf();
        if ( Math.abs(n) <= val.length ) {
                return val;
        }
        const m = Math.max((Math.abs(n) - this.length) || 0, 0);
        const pad = Array(m + 1).join(String(c || ' ').charAt(0));
//      var pad = String(c || ' ').charAt(0).repeat(Math.abs(n) - this.length);
        return (n < 0) ? pad + val : val + pad;
//      return (n < 0) ? val + pad : pad + val;
};

var clog = console.log;
//console.log = function(){};

//exports.start = start;
//exports.stop = stop;
//exports.increment = increment;
exports.print = print;
exports.mark_start = mark_start;
exports.mark_end = mark_end;


exports.start = () => {};
exports.stop = () => {};
exports.increment = () => {};
//exports.print = function(){};