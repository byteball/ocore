@{%
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
%}

@lexer lexer

main -> expr {% id %}


ternary_expr -> or_expr "?" expr ":" ternary_expr {% function(d) {return ['ternary', d[0], d[2], d[4]];}%}
	| or_expr {% id %}

or_expr -> or_expr %or and_expr {% function(d) {return ['or', d[0], d[2]];}%}
	| and_expr {% id %}

and_expr -> and_expr %and comp_expr {% function(d) {return ['and', d[0], d[2]];}%}
	| comp_expr {% id %}

expr -> ternary_expr {% id %}


comp_expr -> AS comparisonOperator AS {% function(d) {return ['comparison', d[1], d[0], d[2]];}%}
	| AS {% id %}

comparisonOperator -> %comparisonOperators {% function(d) { return d[0].value } %}

P -> %l expr %r {% function(d) {return d[1]; } %}
    | N      {% id %}
	| string {% id %}

E -> P "^" E    {% function(d) {return ['^', d[0], d[2]]; } %}
    | P             {% id %}

unary_expr -> E {% id %}
	| %not E {% function(d) {return ['not', d[1]];}%}

MD -> MD "*" unary_expr  {% function(d) {return ['*', d[0], d[2]]; } %}
    | MD "/" unary_expr  {% function(d) {return ['/', d[0], d[2]]; } %}
    | unary_expr             {% id %}

AS -> AS "+" MD {% function(d) {return ['+', d[0], d[2]]; } %}
    | AS "-" MD {% function(d) {return ['-', d[0], d[2]]; } %}
    | AS %concat MD {% function(d) {return ['concat', d[0], d[2]]; } %}
    | MD            {% id %}

N -> float          {% id %}
    | "pi"          {% function(d) {return ['pi']; } %}
    | "e"           {% function(d) {return ['e']; } %}
    | "sqrt" P    {% function(d) {return ['sqrt', d[1]]; } %}
    | "min" %l (AS %comma:*):+ %r  {% function(d) {var params = d[2].map(function(v){return v[0]});return ['min', params]; }  %}
    | "max" %l (AS %comma:*):+ %r  {% function(d) {var params = d[2].map(function(v){return v[0]});return ['max', params]; }  %}
    | "ceil" P    {% function(d) {return ['ceil', d[1]]; } %}
    | "floor" P    {% function(d) {return ['floor', d[1]]; } %}
    | "round" P    {% function(d) {return ['round', d[1]]; } %}
    | (%data_feed %sl ( %comma:* %dfParamsName %comparisonOperators (string|float)):* %sr) {% function (d, i, reject){
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
	}%}
    | (%io %sl ( %comma:* %ioParamsName %comparisonOperators (%ioParamValue|float)):* %sr ) %dot %ioParamsName {% function (d, i, reject){
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
	}%}

float -> %digits           {% function(d,l, reject) { return new BigNumber(d[0]); }%}

string -> %string        {% function(d) {return d[0].value; } %}