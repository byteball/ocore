// Run by formula.test.js under a reduced --stack-size: parses the largest inputs the nesting/chain/depth caps accept
// and fails on any RangeError (stack overflow), which would make validity depend on the node's stack.
require('../desktop_app.js').getAppRootDir = () => __dirname + '/..'; // no package.json next to the main module
const { parseFormula } = require('../formula/common.js');
const parseOjson = require('../formula/parse_ojson.js').parse;

const rep = (s, n) => s.repeat(n);
const nested = (open, close, inner, n) => rep(open, n) + inner + rep(close, n);

// [name, formula, whether the caps must accept it]; only the new grammar is tested, the frozen old one has no caps
const formulas = [
	['chain of binary ops', '1' + rep('+1', 2000), true],
	['chain of not ops', rep('!', 2000) + '1', true],
	['chain of and', 'true' + rep(' and true', 2000), true],
	['100 nested parens', nested('(', ')', '1', 100), true],
	['100 nested arrays', nested('[', ']', '1', 100), true],
	['100 nested dictionaries', nested('{a: ', '}', '1', 100), true],
	['100 nested selectors', nested('$a[', ']', '1', 100), true],
	['100 nested local var exprs', nested('${', '}', '1', 100), true],
	['100 nested function calls', nested('abs(', ')', '1', 100), true],
	['100 nested function bodies', nested('map(1, 1, ($x) => ', ')', '1', 99), true],
	['50 nested search params', nested('$a[[.b= ', ']]', '1', 49), true],
	['parens x not chains', nested(rep('!', 19) + '(', ')', '1', 99), true],
	['parens x binary chains', nested('1' + rep('+1', 19) + '+(', ')', '1', 99), true],
	['parens x not chains at the AST depth cap', nested(rep('!', 21) + '(', ')', '1', 99), false],
	['parens x not chains over the AST depth cap', nested(rep('!', 25) + '(', ')', '1', 99), false],
	['100 unbraced ifs', rep('if(1)', 100) + '$a=1;' + rep('else $a=2;', 100), true],
	['101 unbraced ifs', rep('if(1)', 101) + '$a=1;' + rep('else $a=2;', 101), false],
	['100 else-ifs', 'if(1)$a=1;' + rep('else if(1)$a=1;', 100) + 'else $a=2;', true],
	['1000 statements', rep('$a=1;', 1000) + '1', true],
	['99 nested blocks', rep('if(1){', 99) + '$a=1;' + rep('}', 99), true],
	['100 ternaries', rep('1?1:', 100) + '1', true],
	['100 exponents', rep('2^', 100) + '2', true],
	['many comments', rep('/* c */ ', 50000) + '1', true],
	['many line comments', rep('// c\n', 50000) + '1', true],
	['long whitespace', rep(' ', 1e6) + '1', true],
];

let failed = 0;

function check(name, bMustParse, f) {
	let error = null;
	try {
		f();
	}
	catch (e) {
		error = e;
	}
	if (error instanceof RangeError || (error && /call stack/i.test(error.message))) {
		failed++;
		console.log('FAIL (stack overflow): ' + name);
	}
	else if (error && bMustParse) {
		failed++;
		console.log('FAIL (rejected): ' + name + ': ' + error.message.slice(0, 200));
	}
}

formulas.forEach(([name, formula, bMustParse]) => {
	check(name, bMustParse, () => parseFormula(formula, true));
});

[
	['200 nested ojson arrays', '{ a: ' + nested('[', ']', '1', 199) + ' }'],
	['200 nested ojson objects', nested('{ a: ', ' }', '1', 200)],
	['ojson with a deep formula', '{ a: \'{' + nested('(', ')', '1', 100) + '}\' }'],
].forEach(([name, text]) => {
	check(name, true, () => {
		let error = null;
		parseOjson(text, err => { error = err; });
		if (error)
			throw new Error(error);
	});
});

console.log(failed ? failed + ' failed' : 'ok');
process.exit(failed ? 1 : 0);
