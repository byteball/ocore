@{%

const moo = require('moo')

let lexer = moo.states({
	main: {
		space: {match: /\s+/, lineBreaks: true},
		comment: /\/\/.*$/,
		blockComment: { match: /\/\*[^]*?\*\//, lineBreaks: true },
		formulaDoubleStart: { match: '"{', push: 'formulaDouble' },
		formulaSingleStart: { match: "'{", push: 'formulaSingle' },
		formulaBackStart: { match: '`{', push: 'formulaBack' },
		'{': '{',
		'}': '}',
		'[': '[',
		']': ']',
		':': ':',
		',': ',',
		true: 'true',
		false: 'false',
		base64: [
			/'(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})'/,
			/"(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})"/,
			/`(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})`/,
		],
		'"': '"',
		"'": "'",
		'`': '`',
		decimal: /(?:[+-])?(?:[0-9]*[.])?[0-9]+/,
		autonomous_agent: 'autonomous agent',
		str: /[a-zA-Z_0-9 =+*/@-]+/,
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
	value: d[3][0],
	context: c(d[1])
})

const objectP = (d) => ({
	type: TYPES.OBJECT,
	value: d[2],
	context: c(d[0])
})

const array = (d) => ({
	type: TYPES.ARRAY,
	value: d[2],
	context: c(d[0])
})

const arrayContent = (d) => d[0].map(e => e[0])

const decimal = (d) => ({
	type: TYPES.DECIMAL,
	value: parseFloat(d[0].text),
	context: c(d[0])
})

const valueDecimal = (d) => ([{
	type: TYPES.STR,
	value: '' + d[0].value,
	context: d[0].context
}])

const quotedFormula = (d) => ([{
	type: TYPES.STR,
	value: "'{" + d[0].value + "}'",
	context: d[0].contex
}])

const str = (d) => ({
	type: TYPES.STR,
	value: d[0].text,
	context: c(d[0])
})

const base64ToStr = (d) => ({
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
	let array = d[1].map(e => e[2][0])
	array.unshift(d[0][0])
	return array
}

const quoted = (d) => d[1][0]

const log = cb => {
	return (d) => {
		console.log('d', d)
		return cb(d)
	}
}

%}

@lexer lexer

quoted[X] ->
		"'" $X "'" 		{% quoted %}
	| "`" $X "`" 		{% quoted %}
	| "\"" $X "\"" 	{% quoted %}

commaOptional[X] ->
		$X ",":?							{% commaOptionalSingle %}
	| $X ("," _ $X):+ ",":?	{% commaOptionalMany %}

start -> _ object _ {% (d) => d[1] %}
	| startWithAA {% (d) => d[0] %}

startWithAA -> _ "[" _ quoted[%autonomous_agent] "," _ object _ "]" _ {% (d) => d[6] %}

object -> "{" _ commaOptional[pair] _ "}" {% objectP %}

pair -> key ":" _ value {% pair %}

key ->
		str 				{% (d) => d[0] %}
	| quoted[str]	{% (d) => d[0] %}
	| formula			{% (d) => d[0] %}
	| base64			{% (d) => d[0] %}

value ->
		formula
	| true
	| false
	| array
	| object
	| quoted[str]
	| base64
	| decimal
	| quoted[decimal] {% valueDecimal %}
	| quoted[formula] {% quotedFormula %}

array -> "[" _ arrayContent _ "]" {% array %}
arrayContent -> commaOptional[(object | formula | quoted[str] | base64 | array)] {% arrayContent %}

formula ->
		%formulaDoubleStart %formula:? %formulaDoubleEnd {% formula %}
	|	%formulaSingleStart %formula:? %formulaSingleEnd {% formula %}
	|	%formulaBackStart %formula:? %formulaBackEnd		 {% formula %}

_ -> null
	| %space (%comment _):? {% (d) => null %}
	| %comment _ {% (d) => null %}
	| _ %blockComment _ {% (d) => null %}

str ->
		%str {% str %}
	| %autonomous_agent {% str %}
true -> %true {% trueP %}
base64 -> %base64 {% base64ToStr %}
false -> %false {% falseP %}
decimal -> %decimal {% decimal %}
