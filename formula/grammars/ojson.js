// Generated automatically by nearley, version 2.16.0
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }


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

var grammar = {
    Lexer: lexer,
    ParserRules: [
    {"name": "start", "symbols": ["object"], "postprocess": (d) => d[0]},
    {"name": "start", "symbols": ["startWithAA"], "postprocess": (d) => d[0]},
    {"name": "startWithAA", "symbols": [{"literal":"["}, (lexer.has("autonomous_agent") ? {type: "autonomous_agent"} : autonomous_agent), {"literal":","}, "object", {"literal":"]"}], "postprocess": (d) => d[3]},
    {"name": "object$macrocall$2", "symbols": ["pair"]},
    {"name": "object$macrocall$1$ebnf$1", "symbols": [{"literal":","}], "postprocess": id},
    {"name": "object$macrocall$1$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "object$macrocall$1", "symbols": ["object$macrocall$2", "object$macrocall$1$ebnf$1"], "postprocess": commaOptionalSingle},
    {"name": "object$macrocall$1$ebnf$2$subexpression$1", "symbols": [{"literal":","}, "object$macrocall$2"]},
    {"name": "object$macrocall$1$ebnf$2", "symbols": ["object$macrocall$1$ebnf$2$subexpression$1"]},
    {"name": "object$macrocall$1$ebnf$2$subexpression$2", "symbols": [{"literal":","}, "object$macrocall$2"]},
    {"name": "object$macrocall$1$ebnf$2", "symbols": ["object$macrocall$1$ebnf$2", "object$macrocall$1$ebnf$2$subexpression$2"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "object$macrocall$1$ebnf$3", "symbols": [{"literal":","}], "postprocess": id},
    {"name": "object$macrocall$1$ebnf$3", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "object$macrocall$1", "symbols": ["object$macrocall$2", "object$macrocall$1$ebnf$2", "object$macrocall$1$ebnf$3"], "postprocess": commaOptionalMany},
    {"name": "object", "symbols": [{"literal":"{"}, "object$macrocall$1", {"literal":"}"}], "postprocess": objectP},
    {"name": "pair", "symbols": ["key", {"literal":":"}, "value"], "postprocess": pair},
    {"name": "key", "symbols": ["word"], "postprocess": (d) => d[0]},
    {"name": "key", "symbols": ["str"], "postprocess": (d) => d[0]},
    {"name": "key", "symbols": ["formula"], "postprocess": (d) => d[0]},
    {"name": "value", "symbols": ["formula"]},
    {"name": "value", "symbols": ["true"]},
    {"name": "value", "symbols": ["false"]},
    {"name": "value", "symbols": ["array"]},
    {"name": "value", "symbols": ["object"]},
    {"name": "value", "symbols": ["decimal"]},
    {"name": "value", "symbols": ["str"]},
    {"name": "array$macrocall$2", "symbols": ["value"]},
    {"name": "array$macrocall$1$ebnf$1", "symbols": [{"literal":","}], "postprocess": id},
    {"name": "array$macrocall$1$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "array$macrocall$1", "symbols": ["array$macrocall$2", "array$macrocall$1$ebnf$1"], "postprocess": commaOptionalSingle},
    {"name": "array$macrocall$1$ebnf$2$subexpression$1", "symbols": [{"literal":","}, "array$macrocall$2"]},
    {"name": "array$macrocall$1$ebnf$2", "symbols": ["array$macrocall$1$ebnf$2$subexpression$1"]},
    {"name": "array$macrocall$1$ebnf$2$subexpression$2", "symbols": [{"literal":","}, "array$macrocall$2"]},
    {"name": "array$macrocall$1$ebnf$2", "symbols": ["array$macrocall$1$ebnf$2", "array$macrocall$1$ebnf$2$subexpression$2"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "array$macrocall$1$ebnf$3", "symbols": [{"literal":","}], "postprocess": id},
    {"name": "array$macrocall$1$ebnf$3", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "array$macrocall$1", "symbols": ["array$macrocall$2", "array$macrocall$1$ebnf$2", "array$macrocall$1$ebnf$3"], "postprocess": commaOptionalMany},
    {"name": "array", "symbols": [{"literal":"["}, "array$macrocall$1", {"literal":"]"}], "postprocess": array},
    {"name": "formula$ebnf$1", "symbols": [(lexer.has("formula") ? {type: "formula"} : formula)], "postprocess": id},
    {"name": "formula$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "formula", "symbols": [(lexer.has("formulaDoubleStart") ? {type: "formulaDoubleStart"} : formulaDoubleStart), "formula$ebnf$1", (lexer.has("formulaDoubleEnd") ? {type: "formulaDoubleEnd"} : formulaDoubleEnd)], "postprocess": formula},
    {"name": "formula$ebnf$2", "symbols": [(lexer.has("formula") ? {type: "formula"} : formula)], "postprocess": id},
    {"name": "formula$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "formula", "symbols": [(lexer.has("formulaSingleStart") ? {type: "formulaSingleStart"} : formulaSingleStart), "formula$ebnf$2", (lexer.has("formulaSingleEnd") ? {type: "formulaSingleEnd"} : formulaSingleEnd)], "postprocess": formula},
    {"name": "formula$ebnf$3", "symbols": [(lexer.has("formula") ? {type: "formula"} : formula)], "postprocess": id},
    {"name": "formula$ebnf$3", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "formula", "symbols": [(lexer.has("formulaBackStart") ? {type: "formulaBackStart"} : formulaBackStart), "formula$ebnf$3", (lexer.has("formulaBackEnd") ? {type: "formulaBackEnd"} : formulaBackEnd)], "postprocess": formula},
    {"name": "word", "symbols": [(lexer.has("word") ? {type: "word"} : word)], "postprocess": word},
    {"name": "word", "symbols": [(lexer.has("true") ? {type: "true"} : true)], "postprocess": word},
    {"name": "word", "symbols": [(lexer.has("false") ? {type: "false"} : false)], "postprocess": word},
    {"name": "str", "symbols": [(lexer.has("quotedString") ? {type: "quotedString"} : quotedString)], "postprocess": quotedString},
    {"name": "str", "symbols": [(lexer.has("autonomous_agent") ? {type: "autonomous_agent"} : autonomous_agent)], "postprocess": quotedString},
    {"name": "true", "symbols": [(lexer.has("true") ? {type: "true"} : true)], "postprocess": trueP},
    {"name": "false", "symbols": [(lexer.has("false") ? {type: "false"} : false)], "postprocess": falseP},
    {"name": "decimal", "symbols": [(lexer.has("decimal") ? {type: "decimal"} : decimal)], "postprocess": decimal}
]
  , ParserStart: "start"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
