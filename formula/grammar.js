// Generated automatically by nearley, version 2.15.1
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }

	var BigNumber = require('bignumber.js');
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
		name: ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'min', 'max', 'pi', 'e', 'sqrt', 'ln', 'ceil', 'floor', 'round'],
		concat: '||',
		l: '(',
		r: ')',
		sl:'[',
		sr: ']',
		io: ['input', 'output'],
		data_feed: 'data_feed',
		comparisonOperators: ["==", ">=", "<=", "!=", ">", "<", "="],
		dfParamsName: ['oracles', 'feed_name', 'mci', 'feed_value', 'ifseveral', 'ifnone'],
		and: ['and', 'AND'],
		or: ['or', 'OR'],
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
    {"name": "ternary", "symbols": ["expr", {"literal":"?"}, "expr", {"literal":":"}, "expr"], "postprocess": function(d) {return ['ternary', d[0], d[2], d[4]];}},
    {"name": "OR", "symbols": ["expr2", (lexer.has("or") ? {type: "or"} : or), "expr"], "postprocess": function(d) {return ['or', d[0], d[2]];}},
    {"name": "AND", "symbols": ["expr2", (lexer.has("and") ? {type: "and"} : and), "expr"], "postprocess": function(d) {return ['and', d[0], d[2]];}},
    {"name": "expr$subexpression$1", "symbols": ["string"]},
    {"name": "expr$subexpression$1", "symbols": ["AS"]},
    {"name": "expr", "symbols": ["expr$subexpression$1", (lexer.has("concat") ? {type: "concat"} : concat), "expr"], "postprocess": function(d) {return ['concat', d[0][0], d[2]];}},
    {"name": "expr$subexpression$2", "symbols": ["AS"]},
    {"name": "expr$subexpression$2", "symbols": ["string"]},
    {"name": "expr$subexpression$3", "symbols": ["AS"]},
    {"name": "expr$subexpression$3", "symbols": ["string"]},
    {"name": "expr", "symbols": ["expr$subexpression$2", "comparisonOperator", "expr$subexpression$3"], "postprocess": function(d) {return ['comparison', d[1], d[0][0], d[2][0]];}},
    {"name": "expr", "symbols": ["AND"], "postprocess": id},
    {"name": "expr", "symbols": ["OR"], "postprocess": id},
    {"name": "expr", "symbols": ["ternary"], "postprocess": id},
    {"name": "expr", "symbols": ["AS"], "postprocess": id},
    {"name": "expr", "symbols": ["string"], "postprocess": id},
    {"name": "expr2", "symbols": ["AS", "comparisonOperator", "AS"], "postprocess": function(d) {return ['comparison', d[1], d[0], d[2]];}},
    {"name": "expr2", "symbols": ["AS"], "postprocess": id},
    {"name": "expr2", "symbols": ["string"], "postprocess": id},
    {"name": "comparisonOperator", "symbols": [(lexer.has("comparisonOperators") ? {type: "comparisonOperators"} : comparisonOperators)], "postprocess": function(d) { return d[0].value }},
    {"name": "P", "symbols": [(lexer.has("l") ? {type: "l"} : l), "expr", (lexer.has("r") ? {type: "r"} : r)], "postprocess": function(d) {return d[1]; }},
    {"name": "P", "symbols": ["N"], "postprocess": id},
    {"name": "E", "symbols": ["P", {"literal":"^"}, "E"], "postprocess": function(d) {return ['^', d[0], d[2]]; }},
    {"name": "E", "symbols": ["P"], "postprocess": id},
    {"name": "MD", "symbols": ["MD", {"literal":"*"}, "E"], "postprocess": function(d) {return ['*', d[0], d[2]]; }},
    {"name": "MD", "symbols": ["MD", {"literal":"/"}, "E"], "postprocess": function(d) {return ['/', d[0], d[2]]; }},
    {"name": "MD", "symbols": ["E"], "postprocess": id},
    {"name": "AS", "symbols": ["AS", {"literal":"+"}, "MD"], "postprocess": function(d) {return ['+', d[0], d[2]]; }},
    {"name": "AS", "symbols": ["AS", {"literal":"-"}, "MD"], "postprocess": function(d) {return ['-', d[0], d[2]]; }},
    {"name": "AS", "symbols": ["MD"], "postprocess": id},
    {"name": "N", "symbols": ["float"], "postprocess": id},
    {"name": "N", "symbols": [{"literal":"sin"}, "P"], "postprocess": function(d) {return ['sin', d[1]]; }},
    {"name": "N", "symbols": [{"literal":"cos"}, "P"], "postprocess": function(d) {return ['cos', d[1]]; }},
    {"name": "N", "symbols": [{"literal":"tan"}, "P"], "postprocess": function(d) {return ['tan', d[1]]; }},
    {"name": "N", "symbols": [{"literal":"asin"}, "P"], "postprocess": function(d) {return ['asin', d[1]]; }},
    {"name": "N", "symbols": [{"literal":"acos"}, "P"], "postprocess": function(d) {return ['acos', d[1]]; }},
    {"name": "N", "symbols": [{"literal":"atan"}, "P"], "postprocess": function(d) {return ['atan', d[1]]; }},
    {"name": "N", "symbols": [{"literal":"pi"}], "postprocess": function(d) {return ['pi']; }},
    {"name": "N", "symbols": [{"literal":"e"}], "postprocess": function(d) {return ['e']; }},
    {"name": "N", "symbols": [{"literal":"sqrt"}, "P"], "postprocess": function(d) {return ['sqrt', d[1]]; }},
    {"name": "N", "symbols": [{"literal":"ln"}, "P"], "postprocess": function(d) {return ['log', d[1]]; }},
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
        	return ['data_feed', params]
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
        		if(BigNumber.isBigNumber(value)){
        			params[name]['value'] = value;
        		}else{
        			params[name]['value'] = value.value;
        		}
        	}
        	return [d[0][0].value, params, d[2].value]
        }},
    {"name": "float", "symbols": [(lexer.has("digits") ? {type: "digits"} : digits)], "postprocess": function(d,l, reject) { return new BigNumber(d[0]); }},
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
