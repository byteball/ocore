@{%

const moo = require('moo')

const lexer = moo.states({
	main: {
		space: {match: /\s+/, lineBreaks: true},
		comment: /\/\/.*$/,
		blockComment: { match: /\/\*[^]*?\*\//, lineBreaks: true },
		formulaDoubleStart: { match: '"{', push: 'formulaDouble' },
		formulaSingleStart: { match: "'{", push: 'formulaSingle' },
		formulaBackStart: { match: '`{', push: 'formulaBack' },
		decimal: /(?:[+-])?(?:[0-9]*[.])?[0-9]+/,
		word: {
			match: /[a-zA-Z0-9_]+/,
			type: moo.keywords({
        false: 'false',
        true: 'true',
    	}),
		},
		autonomous_agent: [
			/'autonomous agent'/,
			/"autonomous agent"/,
			/`autonomous agent`/,
		],
		quotedString: [
			/'(?:[^'\\\n]|\\.)*'/,
			/"(?:[^"\\\n]|\\.)*"/,
			/`(?:[^`\\\n]|\\.)*`/,
		],
		'{': '{',
		'}': '}',
		'[': '[',
		']': ']',
		':': ':',
		',': ','
	},
	formulaDouble: {
		formulaDoubleEnd: { match: '}"', pop: 1 },
		formula: {match: /[\s\S]+?(?=}")/, lineBreaks: true},
	},
	formulaSingle: {
		formulaSingleEnd: { match: "}'", pop: 1 },
		formula: {match: /[\s\S]+?(?=}')/, lineBreaks: true},
	},
	formulaBack: {
		formulaBackEnd: { match: '}`', pop: 1 },
		formula: {match: /[\s\S]+?(?=}`)/, lineBreaks: true},
	},
})

var origNext = lexer.next;
	lexer.next = function () {
	var tok = origNext.call(this);
	if (tok) {
		switch (tok.type) {
			case 'space':
			case 'comment':
			case 'blockComment':
				return lexer.next();
		}
		return tok;
	}
	return undefined;
};

const TYPES = {
	STR: 'STR',
	PAIR: 'PAIR',
	TRUE: 'TRUE',
	FALSE: 'FALSE',
	ARRAY: 'ARRAY',
	OBJECT: 'OBJECT',
	DECIMAL: 'DECIMAL',
	FORMULA: 'FORMULA',
}

const c = (token) => ({
	col: token.col,
	line: token.line,
	offset: token.offset,
	lineBreaks: token.lineBreaks,
})

const formula = (d) => ({
	type: TYPES.FORMULA,
	value: d[1] ? d[1].text : '',
	context: d[1] ? c(d[1]) : c(d[0])
})

const pair = (d) => ({
	type: TYPES.PAIR,
	key: d[0],
	value: d[2][0],
	context: c(d[1])
})

const objectP = (d) => ({
	type: TYPES.OBJECT,
	value: d[1],
	context: c(d[0])
})

const array = (d) => ({
	type: TYPES.ARRAY,
	value: d[1].map(e => e[0]),
	context: c(d[0])
})

const decimal = (d) => ({
	type: TYPES.DECIMAL,
	value: parseFloat(d[0].text),
	context: c(d[0])
})

const word = (d) => ({
	type: TYPES.STR,
	value: d[0].text,
	context: c(d[0])
})

const quotedString = (d) => ({
	type: TYPES.STR,
	value: d[0].text.slice(1, -1),
	context: c(d[0])
})

const trueP = (d) => ({
	type: TYPES.TRUE,
	value: true,
	context: c(d[0])
})

const falseP = (d) => ({
	type: TYPES.FALSE,
	value: false,
	context: c(d[0])
})

const commaOptionalSingle = (d) => d[0]
const commaOptionalMany = (d) => {
	let array = d[1].map(e => e[1][0])
	array.unshift(d[0][0])
	return array
}

const log = cb => {
	return (d) => {
		console.log('d', d)
		return cb(d)
	}
}

%}

@lexer lexer

commaOptional[X] ->
		$X ",":?							{% commaOptionalSingle %}
	| $X ("," $X):+ ",":?	{% commaOptionalMany %}

start -> object {% (d) => d[0] %}
	| startWithAA {% (d) => d[0] %}

startWithAA -> "[" %autonomous_agent "," object "]" {% (d) => d[3] %}

object -> "{" commaOptional[pair] "}" {% objectP %}

pair -> key ":" value {% pair %}

key ->
		word 				{% (d) => d[0] %}
	| str					{% (d) => d[0] %}
	| formula			{% (d) => d[0] %}

value ->
		formula
	| true
	| false
	| array
	| object
	| decimal
	| str

array -> "[" commaOptional[value] "]" {% array %}

formula ->
		%formulaDoubleStart %formula:? %formulaDoubleEnd {% formula %}
	|	%formulaSingleStart %formula:? %formulaSingleEnd {% formula %}
	|	%formulaBackStart %formula:? %formulaBackEnd		 {% formula %}

word ->
		%word {% word %}
	| %true {% word %}
	| %false {% word %}

str ->
		%quotedString {% quotedString %}
	|	%autonomous_agent {% quotedString %}
true -> %true {% trueP %}
false -> %false {% falseP %}
decimal -> %decimal {% decimal %}
