// Generated automatically by nearley, version 2.16.0
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }

	var Decimal = require('decimal.js');
	var moo = require("moo");

	var lexer = moo.compile({
		string: [
			{match: /"(?:\\["\\rn]|[\\\rn]|[^"\\])*?"/, lineBreaks: true, value: function(v){
				return v.slice(1, -1).replace(/\\\"/g, '"').replace(/\\\\/g, '\\');
			}},
			{match: /'(?:\\['\\rn]|[\\\rn]|[^'\\])*?'/, lineBreaks: true, value: function(v){
				return v.slice(1, -1).replace(/\\\'/g, "'").replace(/\\\\/g, '\\');
			}}
		],
		WS: {match: /[\s]+/, lineBreaks: true},
		digits: /-?(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?\b/,
		op: ["+", "-", "/", "*", '^'],
		concat: '||',
		l: '(',
		r: ')',
		sl:'[',
		sr: ']',
		io: ['input', 'output'],
		data_feed: ['data_feed', 'in_data_feed'],
		comparisonOperators: ["==", ">=", "<=", "!=", ">", "<", "="],
		dfParamsName: ['oracles', 'feed_name', 'min_mci', 'feed_value', 'ifseveral', 'ifnone', 'what'],
		name: ['min', 'max', 'pi', 'e', 'sqrt', 'ceil', 'floor', 'round'],
		and: ['and', 'AND'],
		or: ['or', 'OR'],
		not: ['not', 'NOT', '!'],
		ioParamsName: ['address', 'amount', 'asset'],
		quote: '"',
		ternary: ['?', ':'],
		ioParamValue: /[\w\ \/=+]+/,
		comma: ',',
		dot: '.',
	});

	var origNext = lexer.next;

    lexer.next = function () {
		var tok = origNext.call(this);
		if (tok) {
			switch (tok.type) {
				case 'WS':
					return lexer.next();
			}
			return tok;
		}
		return undefined;
	};
var grammar = {
    Lexer: lexer,
    ParserRules: [
    {"name": "main", "symbols": ["expr"], "postprocess": id},
    {"name": "ternary_expr", "symbols": ["or_expr", {"literal":"?"}, "expr", {"literal":":"}, "ternary_expr"], "postprocess": function(d) {return ['ternary', d[0], d[2], d[4]];}},
    {"name": "ternary_expr", "symbols": ["or_expr"], "postprocess": id},
    {"name": "or_expr", "symbols": ["or_expr", (lexer.has("or") ? {type: "or"} : or), "and_expr"], "postprocess": function(d) {return ['or', d[0], d[2]];}},
    {"name": "or_expr", "symbols": ["and_expr"], "postprocess": id},
    {"name": "and_expr", "symbols": ["and_expr", (lexer.has("and") ? {type: "and"} : and), "comp_expr"], "postprocess": function(d) {return ['and', d[0], d[2]];}},
    {"name": "and_expr", "symbols": ["comp_expr"], "postprocess": id},
    {"name": "expr", "symbols": ["ternary_expr"], "postprocess": id},
    {"name": "comp_expr", "symbols": ["AS", "comparisonOperator", "AS"], "postprocess": function(d) {return ['comparison', d[1], d[0], d[2]];}},
    {"name": "comp_expr", "symbols": ["AS"], "postprocess": id},
    {"name": "comparisonOperator", "symbols": [(lexer.has("comparisonOperators") ? {type: "comparisonOperators"} : comparisonOperators)], "postprocess": function(d) { return d[0].value }},
    {"name": "P", "symbols": [(lexer.has("l") ? {type: "l"} : l), "expr", (lexer.has("r") ? {type: "r"} : r)], "postprocess": function(d) {return d[1]; }},
    {"name": "P", "symbols": ["N"], "postprocess": id},
    {"name": "P", "symbols": ["string"], "postprocess": id},
    {"name": "E", "symbols": ["P", {"literal":"^"}, "E"], "postprocess": function(d) {return ['^', d[0], d[2]]; }},
    {"name": "E", "symbols": ["P"], "postprocess": id},
    {"name": "unary_expr", "symbols": ["E"], "postprocess": id},
    {"name": "unary_expr", "symbols": [(lexer.has("not") ? {type: "not"} : not), "E"], "postprocess": function(d) {return ['not', d[1]];}},
    {"name": "MD", "symbols": ["MD", {"literal":"*"}, "unary_expr"], "postprocess": function(d) {return ['*', d[0], d[2]]; }},
    {"name": "MD", "symbols": ["MD", {"literal":"/"}, "unary_expr"], "postprocess": function(d) {return ['/', d[0], d[2]]; }},
    {"name": "MD", "symbols": ["unary_expr"], "postprocess": id},
    {"name": "AS", "symbols": ["AS", {"literal":"+"}, "MD"], "postprocess": function(d) {return ['+', d[0], d[2]]; }},
    {"name": "AS", "symbols": ["AS", {"literal":"-"}, "MD"], "postprocess": function(d) {return ['-', d[0], d[2]]; }},
    {"name": "AS", "symbols": ["AS", (lexer.has("concat") ? {type: "concat"} : concat), "MD"], "postprocess": function(d) {return ['concat', d[0], d[2]]; }},
    {"name": "AS", "symbols": ["MD"], "postprocess": id},
    {"name": "N", "symbols": ["float"], "postprocess": id},
    {"name": "N", "symbols": [{"literal":"pi"}], "postprocess": function(d) {return ['pi']; }},
    {"name": "N", "symbols": [{"literal":"e"}], "postprocess": function(d) {return ['e']; }},
    {"name": "N", "symbols": [{"literal":"sqrt"}, "P"], "postprocess": function(d) {return ['sqrt', d[1]]; }},
    {"name": "N$ebnf$1$subexpression$1$ebnf$1", "symbols": []},
    {"name": "N$ebnf$1$subexpression$1$ebnf$1", "symbols": ["N$ebnf$1$subexpression$1$ebnf$1", (lexer.has("comma") ? {type: "comma"} : comma)], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N$ebnf$1$subexpression$1", "symbols": ["AS", "N$ebnf$1$subexpression$1$ebnf$1"]},
    {"name": "N$ebnf$1", "symbols": ["N$ebnf$1$subexpression$1"]},
    {"name": "N$ebnf$1$subexpression$2$ebnf$1", "symbols": []},
    {"name": "N$ebnf$1$subexpression$2$ebnf$1", "symbols": ["N$ebnf$1$subexpression$2$ebnf$1", (lexer.has("comma") ? {type: "comma"} : comma)], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N$ebnf$1$subexpression$2", "symbols": ["AS", "N$ebnf$1$subexpression$2$ebnf$1"]},
    {"name": "N$ebnf$1", "symbols": ["N$ebnf$1", "N$ebnf$1$subexpression$2"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N", "symbols": [{"literal":"min"}, (lexer.has("l") ? {type: "l"} : l), "N$ebnf$1", (lexer.has("r") ? {type: "r"} : r)], "postprocess": function(d) {var params = d[2].map(function(v){return v[0]});return ['min', params]; }},
    {"name": "N$ebnf$2$subexpression$1$ebnf$1", "symbols": []},
    {"name": "N$ebnf$2$subexpression$1$ebnf$1", "symbols": ["N$ebnf$2$subexpression$1$ebnf$1", (lexer.has("comma") ? {type: "comma"} : comma)], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N$ebnf$2$subexpression$1", "symbols": ["AS", "N$ebnf$2$subexpression$1$ebnf$1"]},
    {"name": "N$ebnf$2", "symbols": ["N$ebnf$2$subexpression$1"]},
    {"name": "N$ebnf$2$subexpression$2$ebnf$1", "symbols": []},
    {"name": "N$ebnf$2$subexpression$2$ebnf$1", "symbols": ["N$ebnf$2$subexpression$2$ebnf$1", (lexer.has("comma") ? {type: "comma"} : comma)], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N$ebnf$2$subexpression$2", "symbols": ["AS", "N$ebnf$2$subexpression$2$ebnf$1"]},
    {"name": "N$ebnf$2", "symbols": ["N$ebnf$2", "N$ebnf$2$subexpression$2"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N", "symbols": [{"literal":"max"}, (lexer.has("l") ? {type: "l"} : l), "N$ebnf$2", (lexer.has("r") ? {type: "r"} : r)], "postprocess": function(d) {var params = d[2].map(function(v){return v[0]});return ['max', params]; }},
    {"name": "N", "symbols": [{"literal":"ceil"}, "P"], "postprocess": function(d) {return ['ceil', d[1]]; }},
    {"name": "N", "symbols": [{"literal":"floor"}, "P"], "postprocess": function(d) {return ['floor', d[1]]; }},
    {"name": "N", "symbols": [{"literal":"round"}, "P"], "postprocess": function(d) {return ['round', d[1]]; }},
    {"name": "N$subexpression$1$ebnf$1", "symbols": []},
    {"name": "N$subexpression$1$ebnf$1$subexpression$1$ebnf$1", "symbols": []},
    {"name": "N$subexpression$1$ebnf$1$subexpression$1$ebnf$1", "symbols": ["N$subexpression$1$ebnf$1$subexpression$1$ebnf$1", (lexer.has("comma") ? {type: "comma"} : comma)], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N$subexpression$1$ebnf$1$subexpression$1$subexpression$1", "symbols": ["string"]},
    {"name": "N$subexpression$1$ebnf$1$subexpression$1$subexpression$1", "symbols": ["float"]},
    {"name": "N$subexpression$1$ebnf$1$subexpression$1", "symbols": ["N$subexpression$1$ebnf$1$subexpression$1$ebnf$1", (lexer.has("dfParamsName") ? {type: "dfParamsName"} : dfParamsName), (lexer.has("comparisonOperators") ? {type: "comparisonOperators"} : comparisonOperators), "N$subexpression$1$ebnf$1$subexpression$1$subexpression$1"]},
    {"name": "N$subexpression$1$ebnf$1", "symbols": ["N$subexpression$1$ebnf$1", "N$subexpression$1$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N$subexpression$1", "symbols": [(lexer.has("data_feed") ? {type: "data_feed"} : data_feed), (lexer.has("sl") ? {type: "sl"} : sl), "N$subexpression$1$ebnf$1", (lexer.has("sr") ? {type: "sr"} : sr)]},
    {"name": "N", "symbols": ["N$subexpression$1"], "postprocess":  function (d, i, reject){
        	var params = {};
        	var arrParams = d[0][2];
        	for(var i = 0; i < arrParams.length; i++){
        		var name = arrParams[i][1].value;
        		var operator = arrParams[i][2].value
        		var value = arrParams[i][3][0];
        		if(params[name]) return reject;
        		params[name] = {};
        		params[name]['operator'] = operator;
        		params[name]['value'] = value;
        	}
        	return [d[0][0].value, params]
        }},
    {"name": "N$subexpression$2$ebnf$1", "symbols": []},
    {"name": "N$subexpression$2$ebnf$1$subexpression$1$ebnf$1", "symbols": []},
    {"name": "N$subexpression$2$ebnf$1$subexpression$1$ebnf$1", "symbols": ["N$subexpression$2$ebnf$1$subexpression$1$ebnf$1", (lexer.has("comma") ? {type: "comma"} : comma)], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N$subexpression$2$ebnf$1$subexpression$1$subexpression$1", "symbols": [(lexer.has("ioParamValue") ? {type: "ioParamValue"} : ioParamValue)]},
    {"name": "N$subexpression$2$ebnf$1$subexpression$1$subexpression$1", "symbols": ["float"]},
    {"name": "N$subexpression$2$ebnf$1$subexpression$1", "symbols": ["N$subexpression$2$ebnf$1$subexpression$1$ebnf$1", (lexer.has("ioParamsName") ? {type: "ioParamsName"} : ioParamsName), (lexer.has("comparisonOperators") ? {type: "comparisonOperators"} : comparisonOperators), "N$subexpression$2$ebnf$1$subexpression$1$subexpression$1"]},
    {"name": "N$subexpression$2$ebnf$1", "symbols": ["N$subexpression$2$ebnf$1", "N$subexpression$2$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N$subexpression$2", "symbols": [(lexer.has("io") ? {type: "io"} : io), (lexer.has("sl") ? {type: "sl"} : sl), "N$subexpression$2$ebnf$1", (lexer.has("sr") ? {type: "sr"} : sr)]},
    {"name": "N", "symbols": ["N$subexpression$2", (lexer.has("dot") ? {type: "dot"} : dot), (lexer.has("ioParamsName") ? {type: "ioParamsName"} : ioParamsName)], "postprocess":  function (d, i, reject){
        	var params = {};
        	var arrParams = d[0][2];
        	for(var i = 0; i < arrParams.length; i++){
        		var name = arrParams[i][1].value;
        		var operator = arrParams[i][2].value
        		var value = arrParams[i][3][0];
        		if(params[name]) return reject;
        		params[name] = {};
        		params[name]['operator'] = operator;
        		if(Decimal.isDecimal(value)){
        			params[name]['value'] = value;
        		}else{
        			params[name]['value'] = value.value;
        		}
        	}
        	return [d[0][0].value, params, d[2].value]
        }},
    {"name": "float", "symbols": [(lexer.has("digits") ? {type: "digits"} : digits)], "postprocess": function(d,l, reject) { debugger; return new Decimal(d[0].value); }},
    {"name": "string", "symbols": [(lexer.has("string") ? {type: "string"} : string)], "postprocess": function(d) {return d[0].value; }}
]
  , ParserStart: "main"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
