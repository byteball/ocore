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
		leftParen: '(',
		rightParen: ')',
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
		trigger_initial_unit: /\btrigger\.initial_unit\b/,
		trigger_data: /\btrigger\.data\b/,
		trigger_outputs: /\btrigger\.outputs\b/,
		trigger_output: /\btrigger\.output\b/,
		dotSelector: /\.\w+/,
		local_var_name: /\$[a-zA-Z_]\w*\b/,
	//	search_field: /[a-zA-Z]\w*\b/,
		semi: ';',
		comma: ',',
		dot: '.',
		number_sign: '#',
		IDEN: {
			match: /\b[a-zA-Z_]\w*\b/,
			type: moo.keywords({
				keyword: [
					'min', 'max', 'pi', 'e', 'sqrt', 'ln', 'ceil', 'floor', 'round', 'abs', 'hypot', 'is_valid_signed_package', 'is_valid_sig', 'vrf_verify', 'sha256', 'chash160', 'json_parse', 'json_stringify', 'number_from_seed', 'length', 'is_valid_address', 'starts_with', 'ends_with', 'contains', 'substring', 'timestamp_to_string', 'parse_date', 'is_aa', 'is_integer', 'is_valid_amount', 'is_array', 'is_assoc', 'array_length', 'index_of', 'to_upper', 'to_lower', 'exists', 'number_of_responses', 'is_valid_merkle_proof', 'replace', 'typeof', 'delete', 'freeze', 'keys', 'foreach', 'map', 'filter', 'reduce', 'reverse', 'split', 'join', 'has_only',

					'timestamp', 'storage_size', 'mci', 'this_address', 'response_unit', 'mc_unit', 'params', 'previous_aa_responses',

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
					'var', 'response', 'log',
					'if', 'else', 'return', 'bounce', 'require',
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

	function addLocation(returnValue, d, context) {
		let token = null;
		for (let i = 0; i < d.length; i++) {
            if (token) break;

			if (d[i] && d[i].line !== undefined) {
				token = d[i];
				break;
			}

            if (Array.isArray(d[i])) {
                const insideD = d[i];
                for (let j = 0; j < insideD.length; j++) {
                    if (insideD[j] && insideD[j].line !== undefined) {
                        token = insideD[j];
                        break;
                    }
                }
            }
		}
		
		if (token) {        
			returnValue.line = token.line;
		}

		if (context) {
			returnValue.context = context;
		}
		
		return returnValue;
	}
%}

@lexer lexer

main -> statement:* expr:? {% function(d){ return ['main', d[0], d[1]]; } %}

statement -> local_var_assignment {% id %}
	| ifelse {% id %}
	| state_var_assignment {% id %}
	| response_var_assignment {% id %}
	| bounce_statement {% id %}
	| require_statement {% id %}
	| return_statement {% id %}
	| empty_return_statement {% id %}
	| log_statement {% id %}
	| func_call ";" {% id %}
	| remote_func_call ";" {% id %}
    | "delete" "(" local_var (%dotSelector|"[" expr "]"):* "," expr ")" ";"   {% function(d) {
			var selectors = d[3].map(function(item){
				if (item[0].type === 'dotSelector')
					return item[0].value.substr(1);
				else
					return item[1];
			});
			return addLocation(['delete', d[2][1], selectors, d[5]], d); 
		} %}
    | "freeze" "(" local_var ")" ";"   {% function(d) {return addLocation(['freeze', d[2][1]], d); } %}
    | "foreach" "(" expr "," (float|local_var) "," (func_declaration|local_var|remote_func) ")" ";"   {% function(d) {return addLocation(['foreach', d[2], d[4][0], d[6][0]], d); } %}

ifelse -> "if" "(" expr ")" block ("else" block):?  {% function(d){
	var else_block = d[5] ? d[5][1] : null;
	return addLocation(['ifelse', d[2], d[4], else_block], d);
} %}

block -> "{" statement:* "}" {% function(d){ return addLocation(['block', d[1]], d); } %}
	| statement {% id %}

bounce_expr -> "bounce" "(" expr ")"    {% function(d) { return addLocation(['bounce', d[2]], d); } %}

bounce_statement -> bounce_expr ";"  {% function(d) { return d[0]; } %}

require_statement -> "require" "(" expr "," expr ")" ";"   {% function(d) { return addLocation(['require', d[2], d[4]], d); } %}

return_statement -> "return" expr ";"  {% function(d) { return addLocation(['return', d[1]], d); } %}

empty_return_statement -> "return" ";"  {% function(d) { return addLocation(['return', null], d); } %}

log_statement -> "log" "(" expr_list ")" ";" {% function(d) {return addLocation(['log', d[2]], d); }  %}

otherwise_expr -> expr ("otherwise"|"OTHERWISE") ternary_expr  {% function(d) { return addLocation(['otherwise', d[0], d[2]], d); } %}
	| ternary_expr {% id %}

ternary_expr -> or_expr "?" expr ":" ternary_expr {% function(d) {return addLocation(['ternary', d[0], d[2], d[4]], d); }%}
	| or_expr {% id %}

or_expr -> or_expr ("or"|"OR") and_expr {% function(d) {return addLocation(['or', d[0], d[2]], d); }%}
	| and_expr {% id %}

and_expr -> and_expr ("and"|"AND") comp_expr {% function(d) {return addLocation(['and', d[0], d[2]], d); }%}
	| comp_expr {% id %}

expr -> otherwise_expr {% id %}

expr_list -> expr:? ("," expr):*  {% function(d) {
	var arr = d[0] ? [d[0]] : [];
	return arr.concat(d[1].map(function (item) {return item[1];}));
} %}


comp_expr -> AS ("=="|"!="|">"|">="|"<"|"<=") AS {% function(d) { return addLocation(['comparison', d[1][0].value, d[0], d[2]], d[1]); }%}
	| AS {% id %}

comparisonOperator -> %comparisonOperators {% function(d) { return d[0].value } %}

local_var_expr -> "${" expr "}" {% function(d) { return d[1]; }  %}

local_var -> (%local_var_name|local_var_expr)  {% function(d) {
	var v = d[0][0];
	if (v.type === 'local_var_name')
		v = v.value.substr(1);
	return addLocation(['local_var', v], d[0]);
}  %}

local_var_assignment -> local_var (%dotSelector|"[" expr:? "]"):* "=" (expr|func_declaration) ";" {% function(d) {
	var selectors = null;
	if (d[1] && d[1].length)
		selectors = d[1].map(function(item){
			if (item[0].type === 'dotSelector')
				return item[0].value.substr(1);
			else
				return item[1];
		});
	return addLocation(['local_var_assignment', d[0][1], d[3][0], selectors], d); 
} %}

state_var_assignment -> "var" "[" expr "]" ("="|"+="|"-="|"*="|"/="|"%="|"||=") expr ";" {% function(d) { return addLocation(['state_var_assignment', d[2], d[5], d[4][0].value], d); } %}

response_var_assignment -> "response" "[" expr "]" "=" expr ";" {% function(d) { return addLocation(['response_var_assignment', d[2], d[5]], d); } %}

search_fields -> (%dotSelector):+ {% function(d) {
/*	var fields = [d[0].value];
	if (d[1] && d[1].length)
		fields = fields.concat(d[1].map(field => field[0].value.substr(1)));
	return fields;*/
	return d[0].map(field => field[0].value.substr(1));
} %}

search_param ->  search_fields comparisonOperator (expr|"none")  {% function(d) { return addLocation([d[0], d[1], d[2][0]], d); } %}

search_param_list -> search_param ("," search_param):*  {% function(d) { return addLocation([d[0]].concat(d[1].map(function (item) {return item[1];})), d);   } %}


arguments_list -> %local_var_name:? ("," %local_var_name):*  {% function(d) {
	var arr = d[0] ? [d[0].value.substr(1)] : [];
	return arr.concat(d[1].map(function (item) {return item[1].value.substr(1);}));
} %}

func_declaration -> ("(" arguments_list ")" | arguments_list) "=>" (expr | "{" main "}") {% function(d, location, reject) {
		var arglist = d[0][0].type === 'leftParen' ? d[0][1] : d[0][0];
		var bBlock = d[2][0].type === 'braceLeft';
		var body = bBlock ? d[2][1] : d[2][0];
		if (!bBlock && body[0] === 'dictionary' && body[1].length === 0) // empty dictionary looks the same as empty function
			return reject;
		return addLocation(['func_declaration', arglist, body], d); 
	} %}

func_call -> %local_var_name "(" expr_list ")"    {% function(d) {return addLocation(['func_call', d[0].value.substr(1), d[2]], d); } %}
remote_func_call -> remote_func "(" expr_list ")"  {% function(d) {
	return addLocation(['remote_func_call', d[0][1], d[0][2], d[0][3], d[2]], d); 
} %}
remote_func 
	-> (%addressValue|local_var) "." %local_var_name  
	{% function(d) {
		var remote_aa = d[0][0];
		if (remote_aa.type === 'addressValue')
			remote_aa = remote_aa.value;
		return addLocation(['remote_func', remote_aa, null, d[2].value.substr(1)], d); 
	} %}
	| P "#" (%number|%addressValue|local_var) "." %local_var_name  
	{% function(d) {
		var remote_aa = d[0];
		var max_remote_complexity = d[2][0];
		if (max_remote_complexity.type === 'number')
			max_remote_complexity = new Decimal(max_remote_complexity.value).times(1);
		else if (max_remote_complexity.type === 'addressValue')
			max_remote_complexity = max_remote_complexity.value;
		return addLocation(['remote_func', remote_aa, max_remote_complexity, d[4].value.substr(1)], d); 
	} %}


trigger_outputs -> "trigger.outputs"  {% function(d) {return addLocation(['trigger.outputs'], d); }  %}
trigger_data -> "trigger.data"  {% function(d) {return addLocation(['trigger.data'], d); }  %}
params -> "params"  {% function(d) {return addLocation(['params'], d); }  %}
previous_aa_responses -> "previous_aa_responses"  {% function(d) {return addLocation(['previous_aa_responses'], d); }  %}

unit -> "unit" "[" expr "]"   {% function(d) { return addLocation(['unit', d[2]], d); } %}
definition -> "definition" "[" expr "]"   {% function(d) { return addLocation(['definition', d[2]], d); } %}


with_selectors -> (func_call|remote_func_call|local_var|trigger_outputs|trigger_data|params|previous_aa_responses|unit|definition) (%dotSelector|"[" "[" search_param_list "]" "]"|"[" expr "]"):+  {% function(d) {
	var v = d[0][0];
	let context = {selectorTypes: {}};
	var selectors = d[1].map(function(item, i){
		if (item[0].type === 'dotSelector'){
			context.selectorTypes[i] = 'dotSelector';
			return item[0].value.substr(1);
		} else if (item.length === 5){
			context.selectorTypes[i] = 'search_param_list';
			return addLocation(['search_param_list', item[2]], d);
		} else {
			context.selectorTypes[i] = 'arr';
			return addLocation(item[1], d);
		}
	});
	return addLocation(['with_selectors', v, selectors], d, context);
}  %}


df_param ->  ("oracles"|"feed_name"|"min_mci"|"feed_value"|"what"|"ifseveral"|"ifnone"|"type") comparisonOperator (expr | %addressValue)  {% function(d) {
	var value = d[2][0];
	if (value.type === 'addressValue')
		value = value.value;
	return addLocation([d[0][0].value, d[1], value], d);
} %}
df_param_list -> df_param ("," df_param):*  {% function(d) { return addLocation([d[0]].concat(d[1].map(function (item) {return item[1];})), d);   } %}

io_param ->  ("address"|"amount"|"asset") comparisonOperator (expr|"base"|%addressValue)  {% function(d) {
		var value = d[2][0];
		if (value.value === 'base' || value.type === 'addressValue')
			value = value.value;
		return addLocation([d[0][0].value, d[1], value], d);
	} %}
io_param_list -> io_param ("," io_param):*  {% function(d) { return addLocation([d[0]].concat(d[1].map(function (item) {return item[1];})), d);   } %}

attestation_param ->  ("attestors"|"address"|"ifseveral"|"ifnone"|"type") comparisonOperator (expr|%addressValue)  {% function(d) {
		var value = d[2][0];
		if (value.type === 'addressValue')
			value = value.value;
		return addLocation([d[0][0].value, d[1], value], d);
	} %}
attestation_param_list -> attestation_param ("," attestation_param):*  {% function(d) { return addLocation([d[0]].concat(d[1].map(function (item) {return item[1];})), d);   } %}


array -> "[" expr_list ",":? "]" {% function(d) { return addLocation(['array', d[1]], d); } %}
dictionary -> "{" pair_list ",":? "}" {% function(d) { return addLocation(['dictionary', d[1]], d); } %}

pair_list -> pair:? ("," pair):*  {% function(d) {
	var arr = d[0] ? [d[0]] : [];
	return arr.concat(d[1].map(function (item) {return item[1];}));
} %}
pair -> (string|%IDEN|%keyword|%addressValue) ":" expr {% function(d) {
	var key = d[0][0];
	if (typeof key !== 'string')
		key = key.value;
	return addLocation([key, d[2]], d); 
} %}


P -> "(" expr ")" {% function(d) {return addLocation(d[1], d); } %}
    | N      {% id %}
	| string {% id %}

Exp -> P "^" Exp    {% function(d) {return addLocation(['^', d[0], d[2]], d); } %}
    | P             {% id %}

unary_expr -> Exp {% id %}
	| ("!"|"not"|"NOT") unary_expr {% function(d) {return addLocation(['not', d[1]], d); }%}

MD -> MD "*" unary_expr  {% function(d) {return addLocation(['*', d[0], d[2]], d); } %}
    | MD "/" unary_expr  {% function(d) {return addLocation(['/', d[0], d[2]], d); } %}
    | MD "%" unary_expr  {% function(d) {return addLocation(['%', d[0], d[2]], d); } %}
    | unary_expr             {% id %}

AS -> AS "+" MD {% function(d) {return addLocation(['+', d[0], d[2]], d); } %}
    | AS "-" MD {% function(d) {return addLocation(['-', d[0], d[2]], d); } %}
    | "-" MD {% function(d) {return addLocation(['-', new Decimal(0), d[1]], d); } %}
    | "+" MD {% function(d) {return addLocation(['+', new Decimal(0), d[1]], d); } %}
    | AS %concat MD {% function(d) {return addLocation(['concat', d[0], d[2]], d); } %}
    | MD            {% id %}

N -> float          {% id %}
	| boolean       {% id %}
	| array     {% id %}
	| dictionary     {% id %}
	| local_var     {% id %}
	| func_call     {% id %}
	| remote_func_call     {% id %}
	| trigger_outputs     {% id %}
	| trigger_data     {% id %}
	| params     {% id %}
	| previous_aa_responses     {% id %}
	| unit     {% id %}
	| definition     {% id %}
	| with_selectors     {% id %}
    | "pi"          {% function(d) {return addLocation(['pi'], d); } %}
    | "e"           {% function(d) {return addLocation(['e'], d); } %}
    | "sqrt" "(" expr ")"    {% function(d) {return addLocation(['sqrt', d[2]], d); } %}
    | "ln" "(" expr ")"    {% function(d) {return addLocation(['ln', d[2]], d); } %}
    | "min" "(" expr_list ")"  {% function(d) {return addLocation(['min', d[2]], d); }  %}
    | "max" "(" expr_list ")"  {% function(d) {return addLocation(['max', d[2]], d); }  %}
    | "hypot" "(" expr_list ")"  {% function(d) {return addLocation(['hypot', d[2]], d); }  %}
    | "number_from_seed" "(" expr_list ")"    {% function(d) {return addLocation(['number_from_seed', d[2]], d); } %}
    | "ceil" "(" expr (%comma expr):? ")"    {% function(d) {return addLocation(['ceil', d[2], d[3] ? d[3][1] : null], d); } %}
    | "floor" "(" expr (%comma expr):? ")"    {% function(d) {return addLocation(['floor', d[2], d[3] ? d[3][1] : null], d); } %}
    | "round" "(" expr (%comma expr):? ")"    {% function(d) {return addLocation(['round', d[2], d[3] ? d[3][1] : null], d); } %}
    | "abs" "(" expr ")"  {% function(d) {return addLocation(['abs', d[2]], d); }  %}
    | "is_valid_signed_package" "(" expr "," expr ")"    {% function(d) {return addLocation(['is_valid_signed_package', d[2], d[4]], d); } %}
    | "is_valid_sig" "(" expr "," expr "," expr ")"    {% function(d) {return addLocation(['is_valid_sig', d[2], d[4], d[6]], d); } %}
    | "vrf_verify" "(" expr "," expr "," expr ")"    {% function(d) {return addLocation(['vrf_verify', d[2], d[4], d[6]], d); } %}
    | "is_valid_merkle_proof" "(" expr "," expr ")"    {% function(d) {return addLocation(['is_valid_merkle_proof', d[2], d[4]], d); } %}
    | "sha256" "(" expr ("," expr):? ")"    {% function(d) {return addLocation(['sha256', d[2], d[3] ? d[3][1] : null], d); } %}
    | "chash160" "(" expr ")"    {% function(d) {return addLocation(['chash160', d[2]], d); } %}
    | "json_parse" "(" expr ")"    {% function(d) {return addLocation(['json_parse', d[2]], d); } %}
    | "json_stringify" "(" expr ")"    {% function(d) {return addLocation(['json_stringify', d[2]], d); } %}
    | "typeof" "(" expr ")"    {% function(d) {return addLocation(['typeof', d[2]], d); } %}
    | "length" "(" expr ")"    {% function(d) {return addLocation(['length', d[2]], d); } %}
    | "to_upper" "(" expr ")"    {% function(d) {return addLocation(['to_upper', d[2]], d); } %}
    | "to_lower" "(" expr ")"    {% function(d) {return addLocation(['to_lower', d[2]], d); } %}
    | "exists" "(" expr ")"    {% function(d) {return addLocation(['exists', d[2]], d); } %}
    | "is_valid_address" "(" expr ")"    {% function(d) {return addLocation(['is_valid_address', d[2]], d); } %}
    | "is_aa" "(" expr ")"    {% function(d) {return addLocation(['is_aa', d[2]], d); } %}
    | "is_integer" "(" expr ")"    {% function(d) {return addLocation(['is_integer', d[2]], d); } %}
    | "is_valid_amount" "(" expr ")"    {% function(d) {return addLocation(['is_valid_amount', d[2]], d); } %}
    | "is_array" "(" expr ")"    {% function(d) {return addLocation(['is_array', d[2]], d); } %}
    | "is_assoc" "(" expr ")"    {% function(d) {return addLocation(['is_assoc', d[2]], d); } %}
    | "array_length" "(" expr ")"    {% function(d) {return addLocation(['array_length', d[2]], d); } %}
    | "keys" "(" expr ")"    {% function(d) {return addLocation(['keys', d[2]], d); } %}
    | "starts_with" "(" expr "," expr ")"    {% function(d) {return addLocation(['starts_with', d[2], d[4]], d); } %}
    | "ends_with" "(" expr "," expr ")"    {% function(d) {return addLocation(['ends_with', d[2], d[4]], d); } %}
    | "contains" "(" expr "," expr ")"    {% function(d) {return addLocation(['contains', d[2], d[4]], d); } %}
    | "has_only" "(" expr "," expr ")"    {% function(d) {return addLocation(['has_only', d[2], d[4]], d); } %}
    | "index_of" "(" expr "," expr ")"    {% function(d) {return addLocation(['index_of', d[2], d[4]], d); } %}
    | "substring" "(" expr "," expr ("," expr):? ")"    {% function(d) {return addLocation(['substring', d[2], d[4], d[5] ? d[5][1] : null], d); } %}
    | "replace" "(" expr "," expr "," expr ")"    {% function(d) {return addLocation(['replace', d[2], d[4], d[6]], d); } %}
    | "timestamp_to_string" "(" expr ("," expr):? ")"    {% function(d) {return addLocation(['timestamp_to_string', d[2], d[3] ? d[3][1] : null], d); } %}
    | "parse_date" "(" expr ")"    {% function(d) {return addLocation(['parse_date', d[2]], d); } %}
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
		return addLocation([d[0][0].value, params], d[0]);
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
		return addLocation([d[0][0].value, params, d[4].value.substr(1)], d);
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
		return addLocation(["attestation", params, field], d);
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
		return addLocation([d[0][0].value, first_value, second_param], d);
	} %}
	| "asset" "[" expr "]" (%dotSelector|"[" expr "]")  {% function(d) {
		var field = d[4];
		if (field[0].type === 'dotSelector')
			field = field[0].value.substr(1);
		else
			field = field[1];
		return addLocation(['asset', d[2], field], d);
	} %}
	| "storage_size"  {% function(d) {return addLocation(['storage_size'], d); }  %}
	| "mci"  {% function(d) {return addLocation(['mci'], d); }  %}
	| "timestamp"  {% function(d) {return addLocation(['timestamp'], d); }  %}
	| "mc_unit"  {% function(d) {return addLocation(['mc_unit'], d); }  %}
	| "number_of_responses"  {% function(d) {return addLocation(['number_of_responses'], d); }  %}
	| "this_address"  {% function(d) {return addLocation(['this_address'], d); }  %}
	| "response_unit"  {% function(d) {return addLocation(['response_unit'], d); }  %}
	| "trigger.address"  {% function(d) {return addLocation(['trigger.address'], d); }  %}
	| "trigger.initial_address"  {% function(d) {return addLocation(['trigger.initial_address'], d); }  %}
	| "trigger.unit"  {% function(d) {return addLocation(['trigger.unit'], d); }  %}
	| "trigger.initial_unit"  {% function(d) {return addLocation(['trigger.initial_unit'], d); }  %}
	| "trigger.output" ("[" "[") "asset" comparisonOperator (expr|"base") ("]" "]") %dotSelector:?  {% function(d) {
		var value = d[4][0];
		var field = d[6] ? d[6].value.substr(1) : 'amount';
		if (value.value === 'base')
			value = value.value;
		return addLocation(['trigger.output', d[3], value, field], d);
	} %}
	| ("map"|"filter") "(" expr "," (float|local_var) "," (func_declaration|local_var|remote_func) ")"  {% function(d) {return addLocation([d[0][0].value, d[2], d[4][0], d[6][0]], d); } %}
	| "reduce" "(" expr "," (float|local_var) "," (func_declaration|local_var|remote_func) "," expr ")"  {% function(d) {return addLocation(['reduce', d[2], d[4][0], d[6][0], d[8]], d); } %}
	| "reverse" "(" expr ")" {% function(d) { return addLocation(['reverse', d[2]], d); } %}
	| "split" "(" expr "," expr ("," expr):? ")" {% function(d) { return addLocation(['split', d[2], d[4], d[5] ? d[5][1] : null], d); } %}
	| "join" "(" expr "," expr ")" {% function(d) { return addLocation(['join', d[2], d[4]], d); } %}


float -> %number           {% function(d) { return addLocation(new Decimal(d[0].value).times(1), d); }%}

string -> %string        {% function(d) {return addLocation(d[0].value, d); } %}

boolean -> ("true"|"false")        {% function(d) {return addLocation(d[0][0].value === 'true', d); } %}