// Generated automatically by nearley, version 2.16.0
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }


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

var grammar = {
    Lexer: lexer,
    ParserRules: [
    {"name": "start", "symbols": ["object"], "postprocess": (d) => d[0]},
    {"name": "start", "symbols": ["startWithAA"], "postprocess": (d) => d[0]},
    {"name": "startWithAA$macrocall$2", "symbols": [(lexer.has("autonomous_agent") ? {type: "autonomous_agent"} : autonomous_agent)]},
    {"name": "startWithAA$macrocall$1", "symbols": [{"literal":"'"}, "startWithAA$macrocall$2", {"literal":"'"}], "postprocess": quoted},
    {"name": "startWithAA$macrocall$1", "symbols": [{"literal":"`"}, "startWithAA$macrocall$2", {"literal":"`"}], "postprocess": quoted},
    {"name": "startWithAA$macrocall$1", "symbols": [{"literal":"\""}, "startWithAA$macrocall$2", {"literal":"\""}], "postprocess": quoted},
    {"name": "startWithAA", "symbols": ["_", {"literal":"["}, "_", "startWithAA$macrocall$1", {"literal":","}, "object", {"literal":"]"}, "_"], "postprocess": (d) => d[5]},
    {"name": "object$macrocall$2", "symbols": ["pair"]},
    {"name": "object$macrocall$1$ebnf$1", "symbols": [{"literal":","}], "postprocess": id},
    {"name": "object$macrocall$1$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "object$macrocall$1", "symbols": ["object$macrocall$2", "object$macrocall$1$ebnf$1"], "postprocess": commaOptionalSingle},
    {"name": "object$macrocall$1$ebnf$2$subexpression$1", "symbols": [{"literal":","}, "_", "object$macrocall$2"]},
    {"name": "object$macrocall$1$ebnf$2", "symbols": ["object$macrocall$1$ebnf$2$subexpression$1"]},
    {"name": "object$macrocall$1$ebnf$2$subexpression$2", "symbols": [{"literal":","}, "_", "object$macrocall$2"]},
    {"name": "object$macrocall$1$ebnf$2", "symbols": ["object$macrocall$1$ebnf$2", "object$macrocall$1$ebnf$2$subexpression$2"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "object$macrocall$1$ebnf$3", "symbols": [{"literal":","}], "postprocess": id},
    {"name": "object$macrocall$1$ebnf$3", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "object$macrocall$1", "symbols": ["object$macrocall$2", "object$macrocall$1$ebnf$2", "object$macrocall$1$ebnf$3"], "postprocess": commaOptionalMany},
    {"name": "object", "symbols": [{"literal":"{"}, "_", "object$macrocall$1", "_", {"literal":"}"}], "postprocess": objectP},
    {"name": "pair", "symbols": ["key", {"literal":":"}, "_", "value"], "postprocess": pair},
    {"name": "key", "symbols": ["str"], "postprocess": (d) => d[0]},
    {"name": "key$macrocall$2", "symbols": ["str"]},
    {"name": "key$macrocall$1", "symbols": [{"literal":"'"}, "key$macrocall$2", {"literal":"'"}], "postprocess": quoted},
    {"name": "key$macrocall$1", "symbols": [{"literal":"`"}, "key$macrocall$2", {"literal":"`"}], "postprocess": quoted},
    {"name": "key$macrocall$1", "symbols": [{"literal":"\""}, "key$macrocall$2", {"literal":"\""}], "postprocess": quoted},
    {"name": "key", "symbols": ["key$macrocall$1"], "postprocess": (d) => d[0]},
    {"name": "key", "symbols": ["formula"], "postprocess": (d) => d[0]},
    {"name": "key", "symbols": ["base64"], "postprocess": (d) => d[0]},
    {"name": "value", "symbols": ["formula"]},
    {"name": "value", "symbols": ["true"]},
    {"name": "value", "symbols": ["false"]},
    {"name": "value", "symbols": ["array"]},
    {"name": "value", "symbols": ["object"]},
    {"name": "value$macrocall$2", "symbols": ["str"]},
    {"name": "value$macrocall$1", "symbols": [{"literal":"'"}, "value$macrocall$2", {"literal":"'"}], "postprocess": quoted},
    {"name": "value$macrocall$1", "symbols": [{"literal":"`"}, "value$macrocall$2", {"literal":"`"}], "postprocess": quoted},
    {"name": "value$macrocall$1", "symbols": [{"literal":"\""}, "value$macrocall$2", {"literal":"\""}], "postprocess": quoted},
    {"name": "value", "symbols": ["value$macrocall$1"]},
    {"name": "value", "symbols": ["base64"]},
    {"name": "value", "symbols": ["decimal"]},
    {"name": "value$macrocall$4", "symbols": ["decimal"]},
    {"name": "value$macrocall$3", "symbols": [{"literal":"'"}, "value$macrocall$4", {"literal":"'"}], "postprocess": quoted},
    {"name": "value$macrocall$3", "symbols": [{"literal":"`"}, "value$macrocall$4", {"literal":"`"}], "postprocess": quoted},
    {"name": "value$macrocall$3", "symbols": [{"literal":"\""}, "value$macrocall$4", {"literal":"\""}], "postprocess": quoted},
    {"name": "value", "symbols": ["value$macrocall$3"], "postprocess": valueDecimal},
    {"name": "value$macrocall$6", "symbols": ["formula"]},
    {"name": "value$macrocall$5", "symbols": [{"literal":"'"}, "value$macrocall$6", {"literal":"'"}], "postprocess": quoted},
    {"name": "value$macrocall$5", "symbols": [{"literal":"`"}, "value$macrocall$6", {"literal":"`"}], "postprocess": quoted},
    {"name": "value$macrocall$5", "symbols": [{"literal":"\""}, "value$macrocall$6", {"literal":"\""}], "postprocess": quoted},
    {"name": "value", "symbols": ["value$macrocall$5"], "postprocess": quotedFormula},
    {"name": "array", "symbols": [{"literal":"["}, "_", "arrayContent", "_", {"literal":"]"}], "postprocess": array},
    {"name": "arrayContent$macrocall$2$subexpression$1", "symbols": ["object"]},
    {"name": "arrayContent$macrocall$2$subexpression$1", "symbols": ["formula"]},
    {"name": "arrayContent$macrocall$2$subexpression$1$macrocall$2", "symbols": ["str"]},
    {"name": "arrayContent$macrocall$2$subexpression$1$macrocall$1", "symbols": [{"literal":"'"}, "arrayContent$macrocall$2$subexpression$1$macrocall$2", {"literal":"'"}], "postprocess": quoted},
    {"name": "arrayContent$macrocall$2$subexpression$1$macrocall$1", "symbols": [{"literal":"`"}, "arrayContent$macrocall$2$subexpression$1$macrocall$2", {"literal":"`"}], "postprocess": quoted},
    {"name": "arrayContent$macrocall$2$subexpression$1$macrocall$1", "symbols": [{"literal":"\""}, "arrayContent$macrocall$2$subexpression$1$macrocall$2", {"literal":"\""}], "postprocess": quoted},
    {"name": "arrayContent$macrocall$2$subexpression$1", "symbols": ["arrayContent$macrocall$2$subexpression$1$macrocall$1"]},
    {"name": "arrayContent$macrocall$2$subexpression$1", "symbols": ["base64"]},
    {"name": "arrayContent$macrocall$2$subexpression$1", "symbols": ["array"]},
    {"name": "arrayContent$macrocall$2", "symbols": ["arrayContent$macrocall$2$subexpression$1"]},
    {"name": "arrayContent$macrocall$1$ebnf$1", "symbols": [{"literal":","}], "postprocess": id},
    {"name": "arrayContent$macrocall$1$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "arrayContent$macrocall$1", "symbols": ["arrayContent$macrocall$2", "arrayContent$macrocall$1$ebnf$1"], "postprocess": commaOptionalSingle},
    {"name": "arrayContent$macrocall$1$ebnf$2$subexpression$1", "symbols": [{"literal":","}, "_", "arrayContent$macrocall$2"]},
    {"name": "arrayContent$macrocall$1$ebnf$2", "symbols": ["arrayContent$macrocall$1$ebnf$2$subexpression$1"]},
    {"name": "arrayContent$macrocall$1$ebnf$2$subexpression$2", "symbols": [{"literal":","}, "_", "arrayContent$macrocall$2"]},
    {"name": "arrayContent$macrocall$1$ebnf$2", "symbols": ["arrayContent$macrocall$1$ebnf$2", "arrayContent$macrocall$1$ebnf$2$subexpression$2"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "arrayContent$macrocall$1$ebnf$3", "symbols": [{"literal":","}], "postprocess": id},
    {"name": "arrayContent$macrocall$1$ebnf$3", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "arrayContent$macrocall$1", "symbols": ["arrayContent$macrocall$2", "arrayContent$macrocall$1$ebnf$2", "arrayContent$macrocall$1$ebnf$3"], "postprocess": commaOptionalMany},
    {"name": "arrayContent", "symbols": ["arrayContent$macrocall$1"], "postprocess": arrayContent},
    {"name": "formula$ebnf$1", "symbols": [(lexer.has("formula") ? {type: "formula"} : formula)], "postprocess": id},
    {"name": "formula$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "formula", "symbols": [(lexer.has("formulaDoubleStart") ? {type: "formulaDoubleStart"} : formulaDoubleStart), "formula$ebnf$1", (lexer.has("formulaDoubleEnd") ? {type: "formulaDoubleEnd"} : formulaDoubleEnd)], "postprocess": formula},
    {"name": "formula$ebnf$2", "symbols": [(lexer.has("formula") ? {type: "formula"} : formula)], "postprocess": id},
    {"name": "formula$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "formula", "symbols": [(lexer.has("formulaSingleStart") ? {type: "formulaSingleStart"} : formulaSingleStart), "formula$ebnf$2", (lexer.has("formulaSingleEnd") ? {type: "formulaSingleEnd"} : formulaSingleEnd)], "postprocess": formula},
    {"name": "formula$ebnf$3", "symbols": [(lexer.has("formula") ? {type: "formula"} : formula)], "postprocess": id},
    {"name": "formula$ebnf$3", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "formula", "symbols": [(lexer.has("formulaBackStart") ? {type: "formulaBackStart"} : formulaBackStart), "formula$ebnf$3", (lexer.has("formulaBackEnd") ? {type: "formulaBackEnd"} : formulaBackEnd)], "postprocess": formula},
    {"name": "_", "symbols": []},
    {"name": "_$ebnf$1$subexpression$1", "symbols": [(lexer.has("comment") ? {type: "comment"} : comment), "_"]},
    {"name": "_$ebnf$1", "symbols": ["_$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "_$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "_", "symbols": [(lexer.has("space") ? {type: "space"} : space), "_$ebnf$1"], "postprocess": (d) => null},
    {"name": "_", "symbols": [(lexer.has("comment") ? {type: "comment"} : comment), "_"], "postprocess": (d) => null},
    {"name": "_", "symbols": ["_", (lexer.has("blockComment") ? {type: "blockComment"} : blockComment), "_"], "postprocess": (d) => null},
    {"name": "str", "symbols": [(lexer.has("str") ? {type: "str"} : str)], "postprocess": str},
    {"name": "true", "symbols": [(lexer.has("true") ? {type: "true"} : true)], "postprocess": trueP},
    {"name": "base64", "symbols": [(lexer.has("base64") ? {type: "base64"} : base64)], "postprocess": base64ToStr},
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
