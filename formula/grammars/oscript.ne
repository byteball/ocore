@{%
	var Decimal = require('decimal.js');
	var moo = require("moo");

	var lexer = moo.compile({
		string: [
			{match: /"(?:[^"\\]|\\.)*"/, lineBreaks: true, value: function(v){
				return v.slice(1, -1).replace(/\\\"/g, '"').replace(/\\\\/g, '\\');
			}},
			{match: /'(?:[^'\\]|\\.)*'/, lineBreaks: true, value: function(v){
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
		arrow: '=>',
		comparisonOperators: ["==", ">=", "<=", "!=", ">", "<", "="],
		not: '!',
		quote: '"',
		ternary: ['?', ':'],
		addressValue: /\b[2-7A-Z]{32}\b/,
		trigger_address: /\btrigger\.address\b/,
		trigger_initial_address: /\btrigger\.initial_address\b/,
		trigger_unit: /\btrigger\.unit\b/,
		trigger_data: /\btrigger\.data\b/,
		trigger_output: /\btrigger\.output\b/,
		dotSelector: /\.\w+/,
		local_var_name: /\$[a-zA-Z_]\w*\b/,
	//	search_field: /[a-zA-Z]\w*\b/,
		semi: ';',
		comma: ',',
		dot: '.',
		IDEN: {
			match: /\b[a-zA-Z_]\w*\b/,
			type: moo.keywords({
				keyword: [
					'min', 'max', 'pi', 'e', 'sqrt', 'ln', 'ceil', 'floor', 'round', 'abs', 'hypot', 'is_valid_signed_package', 'is_valid_sig', 'vrf_verify', 'sha256', 'chash160', 'json_parse', 'json_stringify', 'number_from_seed', 'length', 'is_valid_address', 'starts_with', 'ends_with', 'contains', 'substring', 'timestamp_to_string', 'parse_date', 'is_aa', 'is_integer', 'is_valid_amount', 'is_array', 'is_assoc', 'array_length', 'index_of', 'to_upper', 'to_lower', 'exists', 'number_of_responses', 'is_valid_merkle_proof', 'replace', 'typeof',

					'timestamp', 'storage_size', 'mci', 'this_address', 'response_unit', 'mc_unit', 'params',

					'type', 'ifseveral', 'ifnone', 'attestors', 'address',
					'oracles', 'feed_name', 'min_mci', 'feed_value', 'what',
					'amount',

					'none', 'base',

					'true', 'false',
					'and', 'AND',
					'or', 'OR',
					'not', 'NOT',
					'otherwise', 'OTHERWISE',
					'asset',
					'var', 'response',
					'if', 'else', 'return', 'bounce',
					'unit', 'definition', 'balance',
					'attestation', 'data_feed', 'in_data_feed', 'input', 'output',
				],
			})
		},
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
	| func_call ";" {% id %}

ifelse -> "if" "(" expr ")" block ("else" block):?  {% function(d){
	var else_block = d[5] ? d[5][1] : null;
	return ['ifelse', d[2], d[4], else_block];
} %}

block -> "{" statement:* "}" {% function(d){ return ['block', d[1]]; } %}
	| statement {% id %}

bounce_expr -> "bounce" "(" expr ")"    {% function(d) { return ['bounce', d[2]]; } %}

bounce_statement -> bounce_expr ";"  {% function(d) { return d[0]; } %}

return_statement -> "return" expr ";"  {% function(d) { return ['return', d[1]]; } %}

empty_return_statement -> "return" ";"  {% function(d) { return ['return', null]; } %}

otherwise_expr -> expr ("otherwise"|"OTHERWISE") ternary_expr  {% function(d) { return ['otherwise', d[0], d[2]]; } %}
	| ternary_expr {% id %}

ternary_expr -> or_expr "?" expr ":" ternary_expr {% function(d) {return ['ternary', d[0], d[2], d[4]];}%}
	| or_expr {% id %}

or_expr -> or_expr ("or"|"OR") and_expr {% function(d) {return ['or', d[0], d[2]];}%}
	| and_expr {% id %}

and_expr -> and_expr ("and"|"AND") comp_expr {% function(d) {return ['and', d[0], d[2]];}%}
	| comp_expr {% id %}

expr -> otherwise_expr {% id %}

expr_list -> expr:? ("," expr):*  {% function(d) {
	var arr = d[0] ? [d[0]] : [];
	return arr.concat(d[1].map(function (item) {return item[1];}));
} %}


comp_expr -> AS ("=="|"!="|">"|">="|"<"|"<=") AS {% function(d) { return ['comparison', d[1][0].value, d[0], d[2]];}%}
	| AS {% id %}

comparisonOperator -> %comparisonOperators {% function(d) { return d[0].value } %}

local_var_expr -> "${" expr "}" {% function(d) { return d[1]; }  %}

# local_var -> (%local_var_name|local_var_expr) (%dotSelector|"[" "[" search_param_list "]" "]"|"[" expr "]"):*  {% function(d) {
local_var -> (%local_var_name|local_var_expr)  {% function(d) {
	var v = d[0][0];
	if (v.type === 'local_var_name')
		v = v.value.substr(1);
	var selectors = null;
	/*if (d[1] && d[1].length)
		selectors = d[1].map(function(item){
			if (item[0].type === 'dotSelector')
				return item[0].value.substr(1);
			else if (item.length === 5)
				return ['search_param_list', item[2]];
			else
				return item[1];
		});*/
	return ['local_var', v, selectors];
}  %}

local_var_assignment -> local_var "=" (expr|func_declaration) ";" {% function(d) { return ['local_var_assignment', d[0], d[2][0]]; } %}

state_var_assignment -> "var" "[" expr "]" ("="|"+="|"-="|"*="|"/="|"%="|"||=") expr ";" {% function(d) { return ['state_var_assignment', d[2], d[5], d[4][0].value]; } %}

response_var_assignment -> "response" "[" expr "]" "=" expr ";" {% function(d) { return ['response_var_assignment', d[2], d[5]]; } %}

search_fields -> (%dotSelector):+ {% function(d) {
/*	var fields = [d[0].value];
	if (d[1] && d[1].length)
		fields = fields.concat(d[1].map(field => field[0].value.substr(1)));
	return fields;*/
	return d[0].map(field => field[0].value.substr(1));
} %}

search_param ->  search_fields comparisonOperator (expr|"none")  {% function(d) { return [d[0], d[1], d[2][0]]; } %}

search_param_list -> search_param ("," search_param):*  {% function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   } %}


arguments_list -> %local_var_name:? ("," %local_var_name):*  {% function(d) {
	var arr = d[0] ? [d[0].value.substr(1)] : [];
	return arr.concat(d[1].map(function (item) {return item[1].value.substr(1);}));
} %}

func_declaration -> "(" arguments_list ")" "=>" "{" main "}" {% function(d) { return ['func_declaration', d[1], d[5]]; } %}

func_call -> %local_var_name "(" expr_list ")"    {% function(d) {return ['func_call', d[0].value.substr(1), d[2]]; } %}


trigger_data -> "trigger.data"  {% function(d) {return ['trigger.data']; }  %}
params -> "params"  {% function(d) {return ['params']; }  %}

unit -> "unit" "[" expr "]"   {% function(d) { return ['unit', d[2]]; } %}
definition -> "definition" "[" expr "]"   {% function(d) { return ['definition', d[2]]; } %}


with_selectors -> (func_call|local_var|trigger_data|params|unit|definition) (%dotSelector|"[" "[" search_param_list "]" "]"|"[" expr "]"):+  {% function(d) {
	var v = d[0][0];
	var selectors = d[1].map(function(item){
		if (item[0].type === 'dotSelector')
			return item[0].value.substr(1);
		else if (item.length === 5)
			return ['search_param_list', item[2]];
		else
			return item[1];
	});
	return ['with_selectors', v, selectors];
}  %}


df_param ->  ("oracles"|"feed_name"|"min_mci"|"feed_value"|"what"|"ifseveral"|"ifnone"|"type") comparisonOperator (expr | %addressValue)  {% function(d) {
	var value = d[2][0];
	if (value.type === 'addressValue')
		value = value.value;
	return [d[0][0].value, d[1], value];
} %}
df_param_list -> df_param ("," df_param):*  {% function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   } %}

io_param ->  ("address"|"amount"|"asset") comparisonOperator (expr|"base"|%addressValue)  {% function(d) {
		var value = d[2][0];
		if (value.value === 'base' || value.type === 'addressValue')
			value = value.value;
		return [d[0][0].value, d[1], value];
	} %}
io_param_list -> io_param ("," io_param):*  {% function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   } %}

attestation_param ->  ("attestors"|"address"|"ifseveral"|"ifnone"|"type") comparisonOperator (expr|%addressValue)  {% function(d) {
		var value = d[2][0];
		if (value.type === 'addressValue')
			value = value.value;
		return [d[0][0].value, d[1], value];
	} %}
attestation_param_list -> attestation_param ("," attestation_param):*  {% function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   } %}


array -> "[" expr_list ",":? "]" {% function(d) { return ['array', d[1]] } %}
dictionary -> "{" pair_list ",":? "}" {% function(d) { return ['dictionary', d[1]] } %}

pair_list -> pair:? ("," pair):*  {% function(d) {
	var arr = d[0] ? [d[0]] : [];
	return arr.concat(d[1].map(function (item) {return item[1];}));
} %}
pair -> (string|%IDEN|%keyword|%addressValue) ":" expr {% function(d) {
	var key = d[0][0];
	if (typeof key !== 'string')
		key = key.value;
	return [key, d[2]]; 
} %}


P -> "(" expr ")" {% function(d) {return d[1]; } %}
    | N      {% id %}
	| string {% id %}

Exp -> P "^" Exp    {% function(d) {return ['^', d[0], d[2]]; } %}
    | P             {% id %}

unary_expr -> Exp {% id %}
	| ("!"|"not"|"NOT") unary_expr {% function(d) {return ['not', d[1]];}%}

MD -> MD "*" unary_expr  {% function(d) {return ['*', d[0], d[2]]; } %}
    | MD "/" unary_expr  {% function(d) {return ['/', d[0], d[2]]; } %}
    | MD "%" unary_expr  {% function(d) {return ['%', d[0], d[2]]; } %}
    | unary_expr             {% id %}

AS -> AS "+" MD {% function(d) {return ['+', d[0], d[2]]; } %}
    | AS "-" MD {% function(d) {return ['-', d[0], d[2]]; } %}
    | "-" MD {% function(d) {return ['-', new Decimal(0), d[1]]; } %}
    | "+" MD {% function(d) {return ['+', new Decimal(0), d[1]]; } %}
    | AS %concat MD {% function(d) {return ['concat', d[0], d[2]]; } %}
    | MD            {% id %}

N -> float          {% id %}
	| boolean       {% id %}
	| array     {% id %}
	| dictionary     {% id %}
	| local_var     {% id %}
	| func_call     {% id %}
	| trigger_data     {% id %}
	| params     {% id %}
	| unit     {% id %}
	| definition     {% id %}
	| with_selectors     {% id %}
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
    | "is_valid_sig" "(" expr "," expr "," expr ")"    {% function(d) {return ['is_valid_sig', d[2], d[4], d[6]]; } %}
    | "vrf_verify" "(" expr "," expr "," expr ")"    {% function(d) {return ['vrf_verify', d[2], d[4], d[6]]; } %}
    | "is_valid_merkle_proof" "(" expr "," expr ")"    {% function(d) {return ['is_valid_merkle_proof', d[2], d[4]]; } %}
    | "sha256" "(" expr ("," expr):? ")"    {% function(d) {return ['sha256', d[2], d[3] ? d[3][1] : null]; } %}
    | "chash160" "(" expr ")"    {% function(d) {return ['chash160', d[2]]; } %}
    | "json_parse" "(" expr ")"    {% function(d) {return ['json_parse', d[2]]; } %}
    | "json_stringify" "(" expr ")"    {% function(d) {return ['json_stringify', d[2]]; } %}
    | "typeof" "(" expr ")"    {% function(d) {return ['typeof', d[2]]; } %}
    | "length" "(" expr ")"    {% function(d) {return ['length', d[2]]; } %}
    | "to_upper" "(" expr ")"    {% function(d) {return ['to_upper', d[2]]; } %}
    | "to_lower" "(" expr ")"    {% function(d) {return ['to_lower', d[2]]; } %}
    | "exists" "(" expr ")"    {% function(d) {return ['exists', d[2]]; } %}
    | "is_valid_address" "(" expr ")"    {% function(d) {return ['is_valid_address', d[2]]; } %}
    | "is_aa" "(" expr ")"    {% function(d) {return ['is_aa', d[2]]; } %}
    | "is_integer" "(" expr ")"    {% function(d) {return ['is_integer', d[2]]; } %}
    | "is_valid_amount" "(" expr ")"    {% function(d) {return ['is_valid_amount', d[2]]; } %}
    | "is_array" "(" expr ")"    {% function(d) {return ['is_array', d[2]]; } %}
    | "is_assoc" "(" expr ")"    {% function(d) {return ['is_assoc', d[2]]; } %}
    | "array_length" "(" expr ")"    {% function(d) {return ['array_length', d[2]]; } %}
    | "starts_with" "(" expr "," expr ")"    {% function(d) {return ['starts_with', d[2], d[4]]; } %}
    | "ends_with" "(" expr "," expr ")"    {% function(d) {return ['ends_with', d[2], d[4]]; } %}
    | "contains" "(" expr "," expr ")"    {% function(d) {return ['contains', d[2], d[4]]; } %}
    | "index_of" "(" expr "," expr ")"    {% function(d) {return ['index_of', d[2], d[4]]; } %}
    | "substring" "(" expr "," expr ("," expr):? ")"    {% function(d) {return ['substring', d[2], d[4], d[5] ? d[5][1] : null]; } %}
    | "replace" "(" expr "," expr "," expr ")"    {% function(d) {return ['replace', d[2], d[4], d[6]]; } %}
    | "timestamp_to_string" "(" expr ("," expr):? ")"    {% function(d) {return ['timestamp_to_string', d[2], d[3] ? d[3][1] : null]; } %}
    | "parse_date" "(" expr ")"    {% function(d) {return ['parse_date', d[2]]; } %}
    | bounce_expr    {% id %}
    | ("data_feed"|"in_data_feed") ("[" "[") df_param_list ("]" "]") {% function (d, location, reject){
		var params = {};
		var arrParams = d[2];
		for(var i = 0; i < arrParams.length; i++){
			var name = arrParams[i][0];
			var operator = arrParams[i][1];
			var value = arrParams[i][2];
			if(params[name]) return reject;
			params[name] = {operator: operator, value: value};
		}
		return [d[0][0].value, params]
	}%}
    | ("input"|"output") ("[" "[") io_param_list ("]" "]")  %dotSelector {% function (d, location, reject){
		var params = {};
		var arrParams = d[2];
		for(var i = 0; i < arrParams.length; i++){
			var name = arrParams[i][0];
			var operator = arrParams[i][1];
			var value = arrParams[i][2];
			if(params[name]) return reject;
			params[name] = {operator: operator, value: value};
		}
		return [d[0][0].value, params, d[4].value.substr(1)]
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
	| ("var"|"balance") "[" (expr|%addressValue|"base") "]" ("[" (expr|"base") "]"):?  {% function(d) {
		var first_value = d[2][0];
		if (first_value.type === 'addressValue' || first_value.value === 'base')
			first_value = first_value.value;
		var second_param = null;
		if (d[4]){
			second_param = d[4][1][0];
			if (second_param.value === 'base')
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
	| "storage_size"  {% function(d) {return ['storage_size']; }  %}
	| "mci"  {% function(d) {return ['mci']; }  %}
	| "timestamp"  {% function(d) {return ['timestamp']; }  %}
	| "mc_unit"  {% function(d) {return ['mc_unit']; }  %}
	| "number_of_responses"  {% function(d) {return ['number_of_responses']; }  %}
	| "this_address"  {% function(d) {return ['this_address']; }  %}
	| "response_unit"  {% function(d) {return ['response_unit']; }  %}
	| "trigger.address"  {% function(d) {return ['trigger.address']; }  %}
	| "trigger.initial_address"  {% function(d) {return ['trigger.initial_address']; }  %}
	| "trigger.unit"  {% function(d) {return ['trigger.unit']; }  %}
	| "trigger.output" ("[" "[") "asset" comparisonOperator (expr|"base") ("]" "]") %dotSelector:?  {% function(d) {
		var value = d[4][0];
		var field = d[6] ? d[6].value.substr(1) : 'amount';
		if (value.value === 'base')
			value = value.value;
		return ['trigger.output', d[3], value, field];
	} %}

float -> %number           {% function(d) { return new Decimal(d[0].value).times(1); }%}

string -> %string        {% function(d) {return d[0].value; } %}

boolean -> ("true"|"false")        {% function(d) {return (d[0][0].value === 'true'); } %}
