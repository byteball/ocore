@{%
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
		comment: { match: /\/\*[^]*?\*\//, lineBreaks: true },
		bcpl_comment: /\/\/.*?$/,
		number: /(?:[0-9]|[1-9][0-9]+)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?\b/,
		assignment_with_op: ["+=", "-=", "/=", "%=", "*=", '||='],
		op: ["+", "-", "/", "*", "%", '^'],
		concat: '||',
		l: '(',
		r: ')',
		dollarBraceLeft: '${',
		braceLeft: '{',
		braceRight: '}',
		sl:'[',
		sr: ']',
		io: ['input', 'output'],
		data_feed: ['data_feed', 'in_data_feed'],
		attestation: 'attestation',
		balance: 'balance',
		address: 'address',
		amount: 'amount',
		asset: 'asset',
		attestors: 'attestors',
		ifseveral: 'ifseveral',
		ifnone: 'ifnone',
		type: 'type',
		boolean: ['true', 'false'],
		if: "if",
		else: "else",
		comparisonOperators: ["==", ">=", "<=", "!=", ">", "<", "="],
		dfParamsName: ['oracles', 'feed_name', 'min_mci', 'feed_value', 'what'],
		name: ['min', 'max', 'pi', 'e', 'sqrt', 'ln', 'ceil', 'floor', 'round', 'abs', 'hypot', 'is_valid_signed_package', 'sha256', 'json_parse', 'json_stringify', 'number_from_seed'],
		and: ['and', 'AND'],
		or: ['or', 'OR'],
		not: ['not', 'NOT', '!'],
		otherwise: ['otherwise', 'OTHERWISE'],
		quote: '"',
		ternary: ['?', ':'],
		base: 'base',
		var: 'var',
		mci: 'mci',
		timestamp: 'timestamp',
		this_address: 'this_address',
		mc_unit: 'mc_unit',
		response_unit: 'response_unit',
		response: 'response',
		bounce: 'bounce',
		return: 'return',
		addressValue: ['this address', 'other address', /\b[2-7A-Z]{32}\b/],
		trigger_address: /\btrigger\.address\b/,
		trigger_initial_address: /\btrigger\.initial_address\b/,
		trigger_unit: /\btrigger\.unit\b/,
		trigger_data: /\btrigger\.data\b/,
		trigger_output: /\btrigger\.output\b/,
		dotSelector: /\.[a-zA-Z]\w*/,
		local_var_name: /\$[a-zA-Z]\w*\b/,
		semi: ';',
		comma: ',',
		dot: '.',
	});

	var origNext = lexer.next;

    lexer.next = function () {
		var tok = origNext.call(this);
		if (tok) {
			switch (tok.type) {
				case 'WS':
				case 'comment':
				case 'bcpl_comment':
					return lexer.next();
			}
			return tok;
		}
		return undefined;
	};
%}

@lexer lexer

main -> statement:* expr:? {% function(d){ return ['main', d[0], d[1]]; } %}

statement -> local_var_assignment {% id %}
	| ifelse {% id %}
	| state_var_assignment {% id %}
	| response_var_assignment {% id %}
	| bounce_statement {% id %}
	| return_statement {% id %}
	| empty_return_statement {% id %}

ifelse -> "if" "(" expr ")" block ("else" block):?  {% function(d){  
	var else_block = d[5] ? d[5][1] : null;
	return ['ifelse', d[2], d[4], else_block];
} %}

block -> "{" statement:+ "}" {% function(d){ return ['block', d[1]]; } %}
	| statement {% id %}

bounce_expr -> "bounce" "(" expr ")"    {% function(d) { return ['bounce', d[2]]; } %}

bounce_statement -> bounce_expr ";"  {% function(d) { return d[0]; } %}

return_statement -> "return" expr ";"  {% function(d) { return ['return', d[1]]; } %}

empty_return_statement -> "return" ";"  {% function(d) { return ['return', null]; } %}

otherwise_expr -> expr %otherwise ternary_expr  {% function(d) { return ['otherwise', d[0], d[2]]; } %}
	| ternary_expr {% id %}

ternary_expr -> or_expr "?" expr ":" ternary_expr {% function(d) {return ['ternary', d[0], d[2], d[4]];}%}
	| or_expr {% id %}

or_expr -> or_expr %or and_expr {% function(d) {return ['or', d[0], d[2]];}%}
	| and_expr {% id %}

and_expr -> and_expr %and comp_expr {% function(d) {return ['and', d[0], d[2]];}%}
	| comp_expr {% id %}

expr -> otherwise_expr {% id %}

expr_list -> expr ("," expr):*  {% function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   } %}


comp_expr -> AS ("=="|"!="|">"|">="|"<"|"<=") AS {% function(d) { return ['comparison', d[1][0].value, d[0], d[2]];}%}
	| AS {% id %}

comparisonOperator -> %comparisonOperators {% function(d) { return d[0].value } %}

local_var_expr -> "${" expr "}" {% function(d) { return d[1]; }  %}

local_var -> (%local_var_name|local_var_expr) (%dotSelector|"[" expr "]"):*  {% function(d) {
	var v = d[0][0];
	if (v.type === 'local_var_name')
		v = v.value.substr(1);
	var selectors = null;
	if (d[1] && d[1].length)
		selectors = d[1].map(function(item){ return (item[0].type === 'dotSelector') ? item[0].value.substr(1) : item[1]; })
	return ['local_var', v, selectors];
}  %}

local_var_assignment -> local_var "=" expr ";" {% function(d) { return ['local_var_assignment', d[0], d[2]]; } %}

state_var_assignment -> "var" "[" expr "]" ("="|"+="|"-="|"*="|"/="|"%="|"||=") expr ";" {% function(d) { return ['state_var_assignment', d[2], d[5], d[4][0].value]; } %}

response_var_assignment -> "response" "[" expr "]" "=" expr ";" {% function(d) { return ['response_var_assignment', d[2], d[5]]; } %}

df_param ->  (%dfParamsName|%ifseveral|%ifnone|%type) comparisonOperator expr  {% function(d) { return [d[0][0].value, d[1], d[2]]; } %}
df_param_list -> df_param ("," df_param):*  {% function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   } %}

io_param ->  (%address|%amount|%asset) comparisonOperator (expr|%base|%addressValue)  {% function(d) {
		var value = d[2][0];
		if (value.type === 'base' || value.type === 'addressValue')
			value = value.value;
		return [d[0][0].value, d[1], value];
	} %}
io_param_list -> io_param ("," io_param):*  {% function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   } %}

attestation_param ->  (%attestors|%address|%ifseveral|%ifnone|%type) comparisonOperator (expr|%addressValue)  {% function(d) {
		var value = d[2][0];
		if (value.type === 'addressValue')
			value = value.value;
		return [d[0][0].value, d[1], value];
	} %}
attestation_param_list -> attestation_param ("," attestation_param):*  {% function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   } %}


P -> "(" expr ")" {% function(d) {return d[1]; } %}
    | N      {% id %}
	| string {% id %}

Exp -> P "^" Exp    {% function(d) {return ['^', d[0], d[2]]; } %}
    | P             {% id %}

unary_expr -> Exp {% id %}
	| %not unary_expr {% function(d) {return ['not', d[1]];}%}

MD -> MD "*" unary_expr  {% function(d) {return ['*', d[0], d[2]]; } %}
    | MD "/" unary_expr  {% function(d) {return ['/', d[0], d[2]]; } %}
    | MD "%" unary_expr  {% function(d) {return ['%', d[0], d[2]]; } %}
    | unary_expr             {% id %}

AS -> AS "+" MD {% function(d) {return ['+', d[0], d[2]]; } %}
    | AS "-" MD {% function(d) {return ['-', d[0], d[2]]; } %}
    | "-" MD {% function(d) {return ['-', new Decimal(0), d[1]]; } %}
    | AS %concat MD {% function(d) {return ['concat', d[0], d[2]]; } %}
    | MD            {% id %}

N -> float          {% id %}
	| boolean       {% id %}
	| local_var     {% id %}
    | "pi"          {% function(d) {return ['pi']; } %}
    | "e"           {% function(d) {return ['e']; } %}
    | "sqrt" "(" expr ")"    {% function(d) {return ['sqrt', d[2]]; } %}
    | "ln" "(" expr ")"    {% function(d) {return ['ln', d[2]]; } %}
    | "min" "(" expr_list ")"  {% function(d) {return ['min', d[2]]; }  %}
    | "max" "(" expr_list ")"  {% function(d) {return ['max', d[2]]; }  %}
    | "hypot" "(" expr_list ")"  {% function(d) {return ['hypot', d[2]]; }  %}
    | "number_from_seed" "(" expr_list ")"    {% function(d) {return ['number_from_seed', d[2]]; } %}
    | "ceil" "(" expr (%comma expr):? ")"    {% function(d) {return ['ceil', d[2], d[3] ? d[3][1] : null]; } %}
    | "floor" "(" expr (%comma expr):? ")"    {% function(d) {return ['floor', d[2], d[3] ? d[3][1] : null]; } %}
    | "round" "(" expr (%comma expr):? ")"    {% function(d) {return ['round', d[2], d[3] ? d[3][1] : null]; } %}
    | "abs" "(" expr ")"  {% function(d) {return ['abs', d[2]]; }  %}
    | "is_valid_signed_package" "(" expr "," expr ")"    {% function(d) {return ['is_valid_signed_package', d[2], d[4]]; } %}
    | "sha256" "(" expr ")"    {% function(d) {return ['sha256', d[2]]; } %}
    | "json_parse" "(" expr ")"    {% function(d) {return ['json_parse', d[2]]; } %}
    | "json_stringify" "(" expr ")"    {% function(d) {return ['json_stringify', d[2]]; } %}
    | bounce_expr    {% id %}
    | %data_feed ("[" "[") df_param_list ("]" "]") {% function (d, location, reject){
		var params = {};
		var arrParams = d[2];
		for(var i = 0; i < arrParams.length; i++){
			var name = arrParams[i][0];
			var operator = arrParams[i][1];
			var value = arrParams[i][2];
			if(params[name]) return reject;
			params[name] = {operator: operator, value: value};
		}
		return [d[0].value, params]
	}%}
    | %io ("[" "[") io_param_list ("]" "]")  %dotSelector {% function (d, location, reject){
		var params = {};
		var arrParams = d[2];
		for(var i = 0; i < arrParams.length; i++){
			var name = arrParams[i][0];
			var operator = arrParams[i][1];
			var value = arrParams[i][2];
			if(params[name]) return reject;
			params[name] = {operator: operator, value: value};
		}
		return [d[0].value, params, d[4].value.substr(1)]
	}%}
    | "attestation" ("[" "[") attestation_param_list ("]" "]") (%dotSelector|"[" expr "]"):? {% function (d, location, reject){
		var params = {};
		var arrParams = d[2];
		for(var i = 0; i < arrParams.length; i++){
			var name = arrParams[i][0];
			var operator = arrParams[i][1];
			var value = arrParams[i][2];
			if(params[name]) return reject;
			params[name] = {operator: operator, value: value};
		}
		var field = null;
		if (d[4])
			field = (d[4][0].type === 'dotSelector') ? d[4][0].value.substr(1) : d[4][1];
		return ["attestation", params, field];
	}%}
	| ("var"|"balance") "[" (expr|%addressValue|%base) "]" ("[" (expr|%base) "]"):?  {% function(d) {
		var first_value = d[2][0];
		if (first_value.type === 'addressValue' || first_value.type === 'base')
			first_value = first_value.value;
		var second_param = null;
		if (d[4]){
			second_param = d[4][1][0];
			if (second_param.type === 'base')
				second_param = second_param.value;
		}
		return [d[0][0].value, first_value, second_param];
	} %}
	| "asset" "[" expr "]" (%dotSelector|"[" expr "]")  {% function(d) {
		var field = d[4];
		if (field[0].type === 'dotSelector')
			field = field[0].value.substr(1);
		else
			field = field[1];
		return ['asset', d[2], field];
	} %}
	| "mci"  {% function(d) {return ['mci']; }  %}
	| "timestamp"  {% function(d) {return ['timestamp']; }  %}
	| "mc_unit"  {% function(d) {return ['mc_unit']; }  %}
	| "this_address"  {% function(d) {return ['this_address']; }  %}
	| "response_unit"  {% function(d) {return ['response_unit']; }  %}
	| "trigger.address"  {% function(d) {return ['trigger.address']; }  %}
	| "trigger.initial_address"  {% function(d) {return ['trigger.initial_address']; }  %}
	| "trigger.unit"  {% function(d) {return ['trigger.unit']; }  %}
	| "trigger.data" (%dotSelector|"[" expr "]"):*  {% function(d) { return ['trigger.data', d[1].map(function(item){ return (item[0].type === 'dotSelector') ? item[0].value.substr(1) : item[1]; })]; }  %}
	| "trigger.output" ("[" "[") "asset" comparisonOperator (expr|%base) ("]" "]") %dotSelector:?  {% function(d) {
		var value = d[4][0];
		var field = d[6] ? d[6].value.substr(1) : 'amount';
		if (value.type === 'base')
			value = value.value;
		return ['trigger.output', d[3], value, field];
	} %}

float -> %number           {% function(d) { return new Decimal(d[0].value).times(1); }%}

string -> %string        {% function(d) {return d[0].value; } %}

boolean -> %boolean        {% function(d) {return (d[0].value === 'true'); } %}
