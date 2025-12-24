// Generated automatically by nearley, version 2.16.0
// http://github.com/Hardmath123/nearley
(function () {
function id(x) { return x[0]; }

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
var grammar = {
    Lexer: lexer,
    ParserRules: [
    {"name": "main$ebnf$1", "symbols": []},
    {"name": "main$ebnf$1", "symbols": ["main$ebnf$1", "statement"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "main$ebnf$2", "symbols": ["expr"], "postprocess": id},
    {"name": "main$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "main", "symbols": ["main$ebnf$1", "main$ebnf$2"], "postprocess": function(d){ return ['main', d[0], d[1]]; }},
    {"name": "statement", "symbols": ["local_var_assignment"], "postprocess": id},
    {"name": "statement", "symbols": ["ifelse"], "postprocess": id},
    {"name": "statement", "symbols": ["state_var_assignment"], "postprocess": id},
    {"name": "statement", "symbols": ["response_var_assignment"], "postprocess": id},
    {"name": "statement", "symbols": ["bounce_statement"], "postprocess": id},
    {"name": "statement", "symbols": ["require_statement"], "postprocess": id},
    {"name": "statement", "symbols": ["return_statement"], "postprocess": id},
    {"name": "statement", "symbols": ["empty_return_statement"], "postprocess": id},
    {"name": "statement", "symbols": ["log_statement"], "postprocess": id},
    {"name": "statement", "symbols": ["func_call", {"literal":";"}], "postprocess": id},
    {"name": "statement", "symbols": ["remote_func_call", {"literal":";"}], "postprocess": id},
    {"name": "statement$ebnf$1", "symbols": []},
    {"name": "statement$ebnf$1$subexpression$1", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "statement$ebnf$1$subexpression$1", "symbols": [{"literal":"["}, "expr", {"literal":"]"}]},
    {"name": "statement$ebnf$1", "symbols": ["statement$ebnf$1", "statement$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "statement", "symbols": [{"literal":"delete"}, {"literal":"("}, "local_var", "statement$ebnf$1", {"literal":","}, "expr", {"literal":")"}, {"literal":";"}], "postprocess":  function(d) {
        	var selectors = d[3].map(function(item){
        		if (item[0].type === 'dotSelector')
        			return item[0].value.substr(1);
        		else
        			return item[1];
        	});
        	return addLocation(['delete', d[2][1], selectors, d[5]], d); 
        } },
    {"name": "statement", "symbols": [{"literal":"freeze"}, {"literal":"("}, "local_var", {"literal":")"}, {"literal":";"}], "postprocess": function(d) {return addLocation(['freeze', d[2][1]], d); }},
    {"name": "statement$subexpression$1", "symbols": ["float"]},
    {"name": "statement$subexpression$1", "symbols": ["local_var"]},
    {"name": "statement$subexpression$2", "symbols": ["func_declaration"]},
    {"name": "statement$subexpression$2", "symbols": ["local_var"]},
    {"name": "statement$subexpression$2", "symbols": ["remote_func"]},
    {"name": "statement", "symbols": [{"literal":"foreach"}, {"literal":"("}, "expr", {"literal":","}, "statement$subexpression$1", {"literal":","}, "statement$subexpression$2", {"literal":")"}, {"literal":";"}], "postprocess": function(d) {return addLocation(['foreach', d[2], d[4][0], d[6][0]], d); }},
    {"name": "ifelse$ebnf$1$subexpression$1", "symbols": [{"literal":"else"}, "block"]},
    {"name": "ifelse$ebnf$1", "symbols": ["ifelse$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "ifelse$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "ifelse", "symbols": [{"literal":"if"}, {"literal":"("}, "expr", {"literal":")"}, "block", "ifelse$ebnf$1"], "postprocess":  function(d){
        	var else_block = d[5] ? d[5][1] : null;
        	return addLocation(['ifelse', d[2], d[4], else_block], d);
        } },
    {"name": "block$ebnf$1", "symbols": []},
    {"name": "block$ebnf$1", "symbols": ["block$ebnf$1", "statement"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "block", "symbols": [{"literal":"{"}, "block$ebnf$1", {"literal":"}"}], "postprocess": function(d){ return addLocation(['block', d[1]], d); }},
    {"name": "block", "symbols": ["statement"], "postprocess": id},
    {"name": "bounce_expr", "symbols": [{"literal":"bounce"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) { return addLocation(['bounce', d[2]], d); }},
    {"name": "bounce_statement", "symbols": ["bounce_expr", {"literal":";"}], "postprocess": function(d) { return d[0]; }},
    {"name": "require_statement", "symbols": [{"literal":"require"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}, {"literal":";"}], "postprocess": function(d) { return addLocation(['require', d[2], d[4]], d); }},
    {"name": "return_statement", "symbols": [{"literal":"return"}, "expr", {"literal":";"}], "postprocess": function(d) { return addLocation(['return', d[1]], d); }},
    {"name": "empty_return_statement", "symbols": [{"literal":"return"}, {"literal":";"}], "postprocess": function(d) { return addLocation(['return', null], d); }},
    {"name": "log_statement", "symbols": [{"literal":"log"}, {"literal":"("}, "expr_list", {"literal":")"}, {"literal":";"}], "postprocess": function(d) {return addLocation(['log', d[2]], d); }},
    {"name": "otherwise_expr$subexpression$1", "symbols": [{"literal":"otherwise"}]},
    {"name": "otherwise_expr$subexpression$1", "symbols": [{"literal":"OTHERWISE"}]},
    {"name": "otherwise_expr", "symbols": ["expr", "otherwise_expr$subexpression$1", "ternary_expr"], "postprocess": function(d) { return addLocation(['otherwise', d[0], d[2]], d); }},
    {"name": "otherwise_expr", "symbols": ["ternary_expr"], "postprocess": id},
    {"name": "ternary_expr", "symbols": ["or_expr", {"literal":"?"}, "expr", {"literal":":"}, "ternary_expr"], "postprocess": function(d) {return addLocation(['ternary', d[0], d[2], d[4]], d); }},
    {"name": "ternary_expr", "symbols": ["or_expr"], "postprocess": id},
    {"name": "or_expr$subexpression$1", "symbols": [{"literal":"or"}]},
    {"name": "or_expr$subexpression$1", "symbols": [{"literal":"OR"}]},
    {"name": "or_expr", "symbols": ["or_expr", "or_expr$subexpression$1", "and_expr"], "postprocess": function(d) {return addLocation(['or', d[0], d[2]], d); }},
    {"name": "or_expr", "symbols": ["and_expr"], "postprocess": id},
    {"name": "and_expr$subexpression$1", "symbols": [{"literal":"and"}]},
    {"name": "and_expr$subexpression$1", "symbols": [{"literal":"AND"}]},
    {"name": "and_expr", "symbols": ["and_expr", "and_expr$subexpression$1", "comp_expr"], "postprocess": function(d) {return addLocation(['and', d[0], d[2]], d); }},
    {"name": "and_expr", "symbols": ["comp_expr"], "postprocess": id},
    {"name": "expr", "symbols": ["otherwise_expr"], "postprocess": id},
    {"name": "expr_list$ebnf$1", "symbols": ["expr"], "postprocess": id},
    {"name": "expr_list$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "expr_list$ebnf$2", "symbols": []},
    {"name": "expr_list$ebnf$2$subexpression$1", "symbols": [{"literal":","}, "expr"]},
    {"name": "expr_list$ebnf$2", "symbols": ["expr_list$ebnf$2", "expr_list$ebnf$2$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "expr_list", "symbols": ["expr_list$ebnf$1", "expr_list$ebnf$2"], "postprocess":  function(d) {
        	var arr = d[0] ? [d[0]] : [];
        	return arr.concat(d[1].map(function (item) {return item[1];}));
        } },
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":"=="}]},
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":"!="}]},
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":">"}]},
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":">="}]},
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":"<"}]},
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":"<="}]},
    {"name": "comp_expr", "symbols": ["AS", "comp_expr$subexpression$1", "AS"], "postprocess": function(d) { return addLocation(['comparison', d[1][0].value, d[0], d[2]], d[1]); }},
    {"name": "comp_expr", "symbols": ["AS"], "postprocess": id},
    {"name": "comparisonOperator", "symbols": [(lexer.has("comparisonOperators") ? {type: "comparisonOperators"} : comparisonOperators)], "postprocess": function(d) { return d[0].value }},
    {"name": "local_var_expr", "symbols": [{"literal":"${"}, "expr", {"literal":"}"}], "postprocess": function(d) { return d[1]; }},
    {"name": "local_var$subexpression$1", "symbols": [(lexer.has("local_var_name") ? {type: "local_var_name"} : local_var_name)]},
    {"name": "local_var$subexpression$1", "symbols": ["local_var_expr"]},
    {"name": "local_var", "symbols": ["local_var$subexpression$1"], "postprocess":  function(d) {
        	var v = d[0][0];
        	if (v.type === 'local_var_name')
        		v = v.value.substr(1);
        	return addLocation(['local_var', v], d[0]);
        }  },
    {"name": "local_var_assignment$ebnf$1", "symbols": []},
    {"name": "local_var_assignment$ebnf$1$subexpression$1", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "local_var_assignment$ebnf$1$subexpression$1$ebnf$1", "symbols": ["expr"], "postprocess": id},
    {"name": "local_var_assignment$ebnf$1$subexpression$1$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "local_var_assignment$ebnf$1$subexpression$1", "symbols": [{"literal":"["}, "local_var_assignment$ebnf$1$subexpression$1$ebnf$1", {"literal":"]"}]},
    {"name": "local_var_assignment$ebnf$1", "symbols": ["local_var_assignment$ebnf$1", "local_var_assignment$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "local_var_assignment$subexpression$1", "symbols": ["expr"]},
    {"name": "local_var_assignment$subexpression$1", "symbols": ["func_declaration"]},
    {"name": "local_var_assignment", "symbols": ["local_var", "local_var_assignment$ebnf$1", {"literal":"="}, "local_var_assignment$subexpression$1", {"literal":";"}], "postprocess":  function(d) {
        	var selectors = null;
        	if (d[1] && d[1].length)
        		selectors = d[1].map(function(item){
        			if (item[0].type === 'dotSelector')
        				return item[0].value.substr(1);
        			else
        				return item[1];
        		});
        	return addLocation(['local_var_assignment', d[0][1], d[3][0], selectors], d); 
        } },
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"+="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"-="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"*="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"/="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"%="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"||="}]},
    {"name": "state_var_assignment", "symbols": [{"literal":"var"}, {"literal":"["}, "expr", {"literal":"]"}, "state_var_assignment$subexpression$1", "expr", {"literal":";"}], "postprocess": function(d) { return addLocation(['state_var_assignment', d[2], d[5], d[4][0].value], d); }},
    {"name": "response_var_assignment", "symbols": [{"literal":"response"}, {"literal":"["}, "expr", {"literal":"]"}, {"literal":"="}, "expr", {"literal":";"}], "postprocess": function(d) { return addLocation(['response_var_assignment', d[2], d[5]], d); }},
    {"name": "search_fields$ebnf$1$subexpression$1", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "search_fields$ebnf$1", "symbols": ["search_fields$ebnf$1$subexpression$1"]},
    {"name": "search_fields$ebnf$1$subexpression$2", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "search_fields$ebnf$1", "symbols": ["search_fields$ebnf$1", "search_fields$ebnf$1$subexpression$2"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "search_fields", "symbols": ["search_fields$ebnf$1"], "postprocess":  function(d) {
        /*	var fields = [d[0].value];
        	if (d[1] && d[1].length)
        		fields = fields.concat(d[1].map(field => field[0].value.substr(1)));
        	return fields;*/
        	return d[0].map(field => field[0].value.substr(1));
        } },
    {"name": "search_param$subexpression$1", "symbols": ["expr"]},
    {"name": "search_param$subexpression$1", "symbols": [{"literal":"none"}]},
    {"name": "search_param", "symbols": ["search_fields", "comparisonOperator", "search_param$subexpression$1"], "postprocess": function(d) { return addLocation([d[0], d[1], d[2][0]], d); }},
    {"name": "search_param_list$ebnf$1", "symbols": []},
    {"name": "search_param_list$ebnf$1$subexpression$1", "symbols": [{"literal":","}, "search_param"]},
    {"name": "search_param_list$ebnf$1", "symbols": ["search_param_list$ebnf$1", "search_param_list$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "search_param_list", "symbols": ["search_param", "search_param_list$ebnf$1"], "postprocess": function(d) { return addLocation([d[0]].concat(d[1].map(function (item) {return item[1];})), d);   }},
    {"name": "arguments_list$ebnf$1", "symbols": [(lexer.has("local_var_name") ? {type: "local_var_name"} : local_var_name)], "postprocess": id},
    {"name": "arguments_list$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "arguments_list$ebnf$2", "symbols": []},
    {"name": "arguments_list$ebnf$2$subexpression$1", "symbols": [{"literal":","}, (lexer.has("local_var_name") ? {type: "local_var_name"} : local_var_name)]},
    {"name": "arguments_list$ebnf$2", "symbols": ["arguments_list$ebnf$2", "arguments_list$ebnf$2$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "arguments_list", "symbols": ["arguments_list$ebnf$1", "arguments_list$ebnf$2"], "postprocess":  function(d) {
        	var arr = d[0] ? [d[0].value.substr(1)] : [];
        	return arr.concat(d[1].map(function (item) {return item[1].value.substr(1);}));
        } },
    {"name": "func_declaration$subexpression$1", "symbols": [{"literal":"("}, "arguments_list", {"literal":")"}]},
    {"name": "func_declaration$subexpression$1", "symbols": ["arguments_list"]},
    {"name": "func_declaration$subexpression$2", "symbols": ["expr"]},
    {"name": "func_declaration$subexpression$2", "symbols": [{"literal":"{"}, "main", {"literal":"}"}]},
    {"name": "func_declaration", "symbols": ["func_declaration$subexpression$1", {"literal":"=>"}, "func_declaration$subexpression$2"], "postprocess":  function(d, location, reject) {
        	var arglist = d[0][0].type === 'leftParen' ? d[0][1] : d[0][0];
        	var bBlock = d[2][0].type === 'braceLeft';
        	var body = bBlock ? d[2][1] : d[2][0];
        	if (!bBlock && body[0] === 'dictionary' && body[1].length === 0) // empty dictionary looks the same as empty function
        		return reject;
        	return addLocation(['func_declaration', arglist, body], d); 
        } },
    {"name": "func_call", "symbols": [(lexer.has("local_var_name") ? {type: "local_var_name"} : local_var_name), {"literal":"("}, "expr_list", {"literal":")"}], "postprocess": function(d) {return addLocation(['func_call', d[0].value.substr(1), d[2]], d); }},
    {"name": "remote_func_call", "symbols": ["remote_func", {"literal":"("}, "expr_list", {"literal":")"}], "postprocess":  function(d) {
        	return addLocation(['remote_func_call', d[0][1], d[0][2], d[0][3], d[2]], d); 
        } },
    {"name": "remote_func$subexpression$1", "symbols": [(lexer.has("addressValue") ? {type: "addressValue"} : addressValue)]},
    {"name": "remote_func$subexpression$1", "symbols": ["local_var"]},
    {"name": "remote_func", "symbols": ["remote_func$subexpression$1", {"literal":"."}, (lexer.has("local_var_name") ? {type: "local_var_name"} : local_var_name)], "postprocess":  function(d) {
        	var remote_aa = d[0][0];
        	if (remote_aa.type === 'addressValue')
        		remote_aa = remote_aa.value;
        	return addLocation(['remote_func', remote_aa, null, d[2].value.substr(1)], d); 
        } },
    {"name": "remote_func$subexpression$2", "symbols": [(lexer.has("number") ? {type: "number"} : number)]},
    {"name": "remote_func$subexpression$2", "symbols": [(lexer.has("addressValue") ? {type: "addressValue"} : addressValue)]},
    {"name": "remote_func$subexpression$2", "symbols": ["local_var"]},
    {"name": "remote_func", "symbols": ["P", {"literal":"#"}, "remote_func$subexpression$2", {"literal":"."}, (lexer.has("local_var_name") ? {type: "local_var_name"} : local_var_name)], "postprocess":  function(d) {
        	var remote_aa = d[0];
        	var max_remote_complexity = d[2][0];
        	if (max_remote_complexity.type === 'number')
        		max_remote_complexity = new Decimal(max_remote_complexity.value).times(1);
        	else if (max_remote_complexity.type === 'addressValue')
        		max_remote_complexity = max_remote_complexity.value;
        	return addLocation(['remote_func', remote_aa, max_remote_complexity, d[4].value.substr(1)], d); 
        } },
    {"name": "trigger_outputs", "symbols": [{"literal":"trigger.outputs"}], "postprocess": function(d) {return addLocation(['trigger.outputs'], d); }},
    {"name": "trigger_data", "symbols": [{"literal":"trigger.data"}], "postprocess": function(d) {return addLocation(['trigger.data'], d); }},
    {"name": "params", "symbols": [{"literal":"params"}], "postprocess": function(d) {return addLocation(['params'], d); }},
    {"name": "previous_aa_responses", "symbols": [{"literal":"previous_aa_responses"}], "postprocess": function(d) {return addLocation(['previous_aa_responses'], d); }},
    {"name": "unit", "symbols": [{"literal":"unit"}, {"literal":"["}, "expr", {"literal":"]"}], "postprocess": function(d) { return addLocation(['unit', d[2]], d); }},
    {"name": "definition", "symbols": [{"literal":"definition"}, {"literal":"["}, "expr", {"literal":"]"}], "postprocess": function(d) { return addLocation(['definition', d[2]], d); }},
    {"name": "with_selectors$subexpression$1", "symbols": ["func_call"]},
    {"name": "with_selectors$subexpression$1", "symbols": ["remote_func_call"]},
    {"name": "with_selectors$subexpression$1", "symbols": ["local_var"]},
    {"name": "with_selectors$subexpression$1", "symbols": ["trigger_outputs"]},
    {"name": "with_selectors$subexpression$1", "symbols": ["trigger_data"]},
    {"name": "with_selectors$subexpression$1", "symbols": ["params"]},
    {"name": "with_selectors$subexpression$1", "symbols": ["previous_aa_responses"]},
    {"name": "with_selectors$subexpression$1", "symbols": ["unit"]},
    {"name": "with_selectors$subexpression$1", "symbols": ["definition"]},
    {"name": "with_selectors$ebnf$1$subexpression$1", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "with_selectors$ebnf$1$subexpression$1", "symbols": [{"literal":"["}, {"literal":"["}, "search_param_list", {"literal":"]"}, {"literal":"]"}]},
    {"name": "with_selectors$ebnf$1$subexpression$1", "symbols": [{"literal":"["}, "expr", {"literal":"]"}]},
    {"name": "with_selectors$ebnf$1", "symbols": ["with_selectors$ebnf$1$subexpression$1"]},
    {"name": "with_selectors$ebnf$1$subexpression$2", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "with_selectors$ebnf$1$subexpression$2", "symbols": [{"literal":"["}, {"literal":"["}, "search_param_list", {"literal":"]"}, {"literal":"]"}]},
    {"name": "with_selectors$ebnf$1$subexpression$2", "symbols": [{"literal":"["}, "expr", {"literal":"]"}]},
    {"name": "with_selectors$ebnf$1", "symbols": ["with_selectors$ebnf$1", "with_selectors$ebnf$1$subexpression$2"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "with_selectors", "symbols": ["with_selectors$subexpression$1", "with_selectors$ebnf$1"], "postprocess":  function(d) {
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
        }  },
    {"name": "df_param$subexpression$1", "symbols": [{"literal":"oracles"}]},
    {"name": "df_param$subexpression$1", "symbols": [{"literal":"feed_name"}]},
    {"name": "df_param$subexpression$1", "symbols": [{"literal":"min_mci"}]},
    {"name": "df_param$subexpression$1", "symbols": [{"literal":"feed_value"}]},
    {"name": "df_param$subexpression$1", "symbols": [{"literal":"what"}]},
    {"name": "df_param$subexpression$1", "symbols": [{"literal":"ifseveral"}]},
    {"name": "df_param$subexpression$1", "symbols": [{"literal":"ifnone"}]},
    {"name": "df_param$subexpression$1", "symbols": [{"literal":"type"}]},
    {"name": "df_param$subexpression$2", "symbols": ["expr"]},
    {"name": "df_param$subexpression$2", "symbols": [(lexer.has("addressValue") ? {type: "addressValue"} : addressValue)]},
    {"name": "df_param", "symbols": ["df_param$subexpression$1", "comparisonOperator", "df_param$subexpression$2"], "postprocess":  function(d) {
        	var value = d[2][0];
        	if (value.type === 'addressValue')
        		value = value.value;
        	return addLocation([d[0][0].value, d[1], value], d);
        } },
    {"name": "df_param_list$ebnf$1", "symbols": []},
    {"name": "df_param_list$ebnf$1$subexpression$1", "symbols": [{"literal":","}, "df_param"]},
    {"name": "df_param_list$ebnf$1", "symbols": ["df_param_list$ebnf$1", "df_param_list$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "df_param_list", "symbols": ["df_param", "df_param_list$ebnf$1"], "postprocess": function(d) { return addLocation([d[0]].concat(d[1].map(function (item) {return item[1];})), d);   }},
    {"name": "io_param$subexpression$1", "symbols": [{"literal":"address"}]},
    {"name": "io_param$subexpression$1", "symbols": [{"literal":"amount"}]},
    {"name": "io_param$subexpression$1", "symbols": [{"literal":"asset"}]},
    {"name": "io_param$subexpression$2", "symbols": ["expr"]},
    {"name": "io_param$subexpression$2", "symbols": [{"literal":"base"}]},
    {"name": "io_param$subexpression$2", "symbols": [(lexer.has("addressValue") ? {type: "addressValue"} : addressValue)]},
    {"name": "io_param", "symbols": ["io_param$subexpression$1", "comparisonOperator", "io_param$subexpression$2"], "postprocess":  function(d) {
        	var value = d[2][0];
        	if (value.value === 'base' || value.type === 'addressValue')
        		value = value.value;
        	return addLocation([d[0][0].value, d[1], value], d);
        } },
    {"name": "io_param_list$ebnf$1", "symbols": []},
    {"name": "io_param_list$ebnf$1$subexpression$1", "symbols": [{"literal":","}, "io_param"]},
    {"name": "io_param_list$ebnf$1", "symbols": ["io_param_list$ebnf$1", "io_param_list$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "io_param_list", "symbols": ["io_param", "io_param_list$ebnf$1"], "postprocess": function(d) { return addLocation([d[0]].concat(d[1].map(function (item) {return item[1];})), d);   }},
    {"name": "attestation_param$subexpression$1", "symbols": [{"literal":"attestors"}]},
    {"name": "attestation_param$subexpression$1", "symbols": [{"literal":"address"}]},
    {"name": "attestation_param$subexpression$1", "symbols": [{"literal":"ifseveral"}]},
    {"name": "attestation_param$subexpression$1", "symbols": [{"literal":"ifnone"}]},
    {"name": "attestation_param$subexpression$1", "symbols": [{"literal":"type"}]},
    {"name": "attestation_param$subexpression$2", "symbols": ["expr"]},
    {"name": "attestation_param$subexpression$2", "symbols": [(lexer.has("addressValue") ? {type: "addressValue"} : addressValue)]},
    {"name": "attestation_param", "symbols": ["attestation_param$subexpression$1", "comparisonOperator", "attestation_param$subexpression$2"], "postprocess":  function(d) {
        	var value = d[2][0];
        	if (value.type === 'addressValue')
        		value = value.value;
        	return addLocation([d[0][0].value, d[1], value], d);
        } },
    {"name": "attestation_param_list$ebnf$1", "symbols": []},
    {"name": "attestation_param_list$ebnf$1$subexpression$1", "symbols": [{"literal":","}, "attestation_param"]},
    {"name": "attestation_param_list$ebnf$1", "symbols": ["attestation_param_list$ebnf$1", "attestation_param_list$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "attestation_param_list", "symbols": ["attestation_param", "attestation_param_list$ebnf$1"], "postprocess": function(d) { return addLocation([d[0]].concat(d[1].map(function (item) {return item[1];})), d);   }},
    {"name": "array$ebnf$1", "symbols": [{"literal":","}], "postprocess": id},
    {"name": "array$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "array", "symbols": [{"literal":"["}, "expr_list", "array$ebnf$1", {"literal":"]"}], "postprocess": function(d) { return addLocation(['array', d[1]], d); }},
    {"name": "dictionary$ebnf$1", "symbols": [{"literal":","}], "postprocess": id},
    {"name": "dictionary$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "dictionary", "symbols": [{"literal":"{"}, "pair_list", "dictionary$ebnf$1", {"literal":"}"}], "postprocess": function(d) { return addLocation(['dictionary', d[1]], d); }},
    {"name": "pair_list$ebnf$1", "symbols": ["pair"], "postprocess": id},
    {"name": "pair_list$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "pair_list$ebnf$2", "symbols": []},
    {"name": "pair_list$ebnf$2$subexpression$1", "symbols": [{"literal":","}, "pair"]},
    {"name": "pair_list$ebnf$2", "symbols": ["pair_list$ebnf$2", "pair_list$ebnf$2$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "pair_list", "symbols": ["pair_list$ebnf$1", "pair_list$ebnf$2"], "postprocess":  function(d) {
        	var arr = d[0] ? [d[0]] : [];
        	return arr.concat(d[1].map(function (item) {return item[1];}));
        } },
    {"name": "pair$subexpression$1", "symbols": ["string"]},
    {"name": "pair$subexpression$1", "symbols": [(lexer.has("IDEN") ? {type: "IDEN"} : IDEN)]},
    {"name": "pair$subexpression$1", "symbols": [(lexer.has("keyword") ? {type: "keyword"} : keyword)]},
    {"name": "pair$subexpression$1", "symbols": [(lexer.has("addressValue") ? {type: "addressValue"} : addressValue)]},
    {"name": "pair", "symbols": ["pair$subexpression$1", {"literal":":"}, "expr"], "postprocess":  function(d) {
        	var key = d[0][0];
        	if (typeof key !== 'string')
        		key = key.value;
        	return addLocation([key, d[2]], d); 
        } },
    {"name": "P", "symbols": [{"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(d[1], d); }},
    {"name": "P", "symbols": ["N"], "postprocess": id},
    {"name": "P", "symbols": ["string"], "postprocess": id},
    {"name": "Exp", "symbols": ["P", {"literal":"^"}, "Exp"], "postprocess": function(d) {return addLocation(['^', d[0], d[2]], d); }},
    {"name": "Exp", "symbols": ["P"], "postprocess": id},
    {"name": "unary_expr", "symbols": ["Exp"], "postprocess": id},
    {"name": "unary_expr$subexpression$1", "symbols": [{"literal":"!"}]},
    {"name": "unary_expr$subexpression$1", "symbols": [{"literal":"not"}]},
    {"name": "unary_expr$subexpression$1", "symbols": [{"literal":"NOT"}]},
    {"name": "unary_expr", "symbols": ["unary_expr$subexpression$1", "unary_expr"], "postprocess": function(d) {return addLocation(['not', d[1]], d); }},
    {"name": "MD", "symbols": ["MD", {"literal":"*"}, "unary_expr"], "postprocess": function(d) {return addLocation(['*', d[0], d[2]], d); }},
    {"name": "MD", "symbols": ["MD", {"literal":"/"}, "unary_expr"], "postprocess": function(d) {return addLocation(['/', d[0], d[2]], d); }},
    {"name": "MD", "symbols": ["MD", {"literal":"%"}, "unary_expr"], "postprocess": function(d) {return addLocation(['%', d[0], d[2]], d); }},
    {"name": "MD", "symbols": ["unary_expr"], "postprocess": id},
    {"name": "AS", "symbols": ["AS", {"literal":"+"}, "MD"], "postprocess": function(d) {return addLocation(['+', d[0], d[2]], d); }},
    {"name": "AS", "symbols": ["AS", {"literal":"-"}, "MD"], "postprocess": function(d) {return addLocation(['-', d[0], d[2]], d); }},
    {"name": "AS", "symbols": [{"literal":"-"}, "MD"], "postprocess": function(d) {return addLocation(['-', new Decimal(0), d[1]], d); }},
    {"name": "AS", "symbols": [{"literal":"+"}, "MD"], "postprocess": function(d) {return addLocation(['+', new Decimal(0), d[1]], d); }},
    {"name": "AS", "symbols": ["AS", (lexer.has("concat") ? {type: "concat"} : concat), "MD"], "postprocess": function(d) {return addLocation(['concat', d[0], d[2]], d); }},
    {"name": "AS", "symbols": ["MD"], "postprocess": id},
    {"name": "N", "symbols": ["float"], "postprocess": id},
    {"name": "N", "symbols": ["boolean"], "postprocess": id},
    {"name": "N", "symbols": ["array"], "postprocess": id},
    {"name": "N", "symbols": ["dictionary"], "postprocess": id},
    {"name": "N", "symbols": ["local_var"], "postprocess": id},
    {"name": "N", "symbols": ["func_call"], "postprocess": id},
    {"name": "N", "symbols": ["remote_func_call"], "postprocess": id},
    {"name": "N", "symbols": ["trigger_outputs"], "postprocess": id},
    {"name": "N", "symbols": ["trigger_data"], "postprocess": id},
    {"name": "N", "symbols": ["params"], "postprocess": id},
    {"name": "N", "symbols": ["previous_aa_responses"], "postprocess": id},
    {"name": "N", "symbols": ["unit"], "postprocess": id},
    {"name": "N", "symbols": ["definition"], "postprocess": id},
    {"name": "N", "symbols": ["with_selectors"], "postprocess": id},
    {"name": "N", "symbols": [{"literal":"pi"}], "postprocess": function(d) {return addLocation(['pi'], d); }},
    {"name": "N", "symbols": [{"literal":"e"}], "postprocess": function(d) {return addLocation(['e'], d); }},
    {"name": "N", "symbols": [{"literal":"sqrt"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['sqrt', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"ln"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['ln', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"min"}, {"literal":"("}, "expr_list", {"literal":")"}], "postprocess": function(d) {return addLocation(['min', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"max"}, {"literal":"("}, "expr_list", {"literal":")"}], "postprocess": function(d) {return addLocation(['max', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"hypot"}, {"literal":"("}, "expr_list", {"literal":")"}], "postprocess": function(d) {return addLocation(['hypot', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"number_from_seed"}, {"literal":"("}, "expr_list", {"literal":")"}], "postprocess": function(d) {return addLocation(['number_from_seed', d[2]], d); }},
    {"name": "N$ebnf$1$subexpression$1", "symbols": [(lexer.has("comma") ? {type: "comma"} : comma), "expr"]},
    {"name": "N$ebnf$1", "symbols": ["N$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"ceil"}, {"literal":"("}, "expr", "N$ebnf$1", {"literal":")"}], "postprocess": function(d) {return addLocation(['ceil', d[2], d[3] ? d[3][1] : null], d); }},
    {"name": "N$ebnf$2$subexpression$1", "symbols": [(lexer.has("comma") ? {type: "comma"} : comma), "expr"]},
    {"name": "N$ebnf$2", "symbols": ["N$ebnf$2$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"floor"}, {"literal":"("}, "expr", "N$ebnf$2", {"literal":")"}], "postprocess": function(d) {return addLocation(['floor', d[2], d[3] ? d[3][1] : null], d); }},
    {"name": "N$ebnf$3$subexpression$1", "symbols": [(lexer.has("comma") ? {type: "comma"} : comma), "expr"]},
    {"name": "N$ebnf$3", "symbols": ["N$ebnf$3$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$3", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"round"}, {"literal":"("}, "expr", "N$ebnf$3", {"literal":")"}], "postprocess": function(d) {return addLocation(['round', d[2], d[3] ? d[3][1] : null], d); }},
    {"name": "N", "symbols": [{"literal":"abs"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['abs', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"is_valid_signed_package"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['is_valid_signed_package', d[2], d[4]], d); }},
    {"name": "N", "symbols": [{"literal":"is_valid_sig"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['is_valid_sig', d[2], d[4], d[6]], d); }},
    {"name": "N", "symbols": [{"literal":"vrf_verify"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['vrf_verify', d[2], d[4], d[6]], d); }},
    {"name": "N", "symbols": [{"literal":"is_valid_merkle_proof"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['is_valid_merkle_proof', d[2], d[4]], d); }},
    {"name": "N$ebnf$4$subexpression$1", "symbols": [{"literal":","}, "expr"]},
    {"name": "N$ebnf$4", "symbols": ["N$ebnf$4$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$4", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"sha256"}, {"literal":"("}, "expr", "N$ebnf$4", {"literal":")"}], "postprocess": function(d) {return addLocation(['sha256', d[2], d[3] ? d[3][1] : null], d); }},
    {"name": "N", "symbols": [{"literal":"chash160"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['chash160', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"json_parse"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['json_parse', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"json_stringify"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['json_stringify', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"typeof"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['typeof', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"length"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['length', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"to_upper"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['to_upper', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"to_lower"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['to_lower', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"exists"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['exists', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"is_valid_address"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['is_valid_address', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"is_aa"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['is_aa', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"is_integer"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['is_integer', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"is_valid_amount"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['is_valid_amount', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"is_array"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['is_array', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"is_assoc"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['is_assoc', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"array_length"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['array_length', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"keys"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['keys', d[2]], d); }},
    {"name": "N", "symbols": [{"literal":"starts_with"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['starts_with', d[2], d[4]], d); }},
    {"name": "N", "symbols": [{"literal":"ends_with"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['ends_with', d[2], d[4]], d); }},
    {"name": "N", "symbols": [{"literal":"contains"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['contains', d[2], d[4]], d); }},
    {"name": "N", "symbols": [{"literal":"has_only"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['has_only', d[2], d[4]], d); }},
    {"name": "N", "symbols": [{"literal":"index_of"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['index_of', d[2], d[4]], d); }},
    {"name": "N$ebnf$5$subexpression$1", "symbols": [{"literal":","}, "expr"]},
    {"name": "N$ebnf$5", "symbols": ["N$ebnf$5$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$5", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"substring"}, {"literal":"("}, "expr", {"literal":","}, "expr", "N$ebnf$5", {"literal":")"}], "postprocess": function(d) {return addLocation(['substring', d[2], d[4], d[5] ? d[5][1] : null], d); }},
    {"name": "N", "symbols": [{"literal":"replace"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['replace', d[2], d[4], d[6]], d); }},
    {"name": "N$ebnf$6$subexpression$1", "symbols": [{"literal":","}, "expr"]},
    {"name": "N$ebnf$6", "symbols": ["N$ebnf$6$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$6", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"timestamp_to_string"}, {"literal":"("}, "expr", "N$ebnf$6", {"literal":")"}], "postprocess": function(d) {return addLocation(['timestamp_to_string', d[2], d[3] ? d[3][1] : null], d); }},
    {"name": "N", "symbols": [{"literal":"parse_date"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['parse_date', d[2]], d); }},
    {"name": "N", "symbols": ["bounce_expr"], "postprocess": id},
    {"name": "N$subexpression$1", "symbols": [{"literal":"data_feed"}]},
    {"name": "N$subexpression$1", "symbols": [{"literal":"in_data_feed"}]},
    {"name": "N$subexpression$2", "symbols": [{"literal":"["}, {"literal":"["}]},
    {"name": "N$subexpression$3", "symbols": [{"literal":"]"}, {"literal":"]"}]},
    {"name": "N", "symbols": ["N$subexpression$1", "N$subexpression$2", "df_param_list", "N$subexpression$3"], "postprocess":  function (d, location, reject){
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
        }},
    {"name": "N$subexpression$4", "symbols": [{"literal":"input"}]},
    {"name": "N$subexpression$4", "symbols": [{"literal":"output"}]},
    {"name": "N$subexpression$5", "symbols": [{"literal":"["}, {"literal":"["}]},
    {"name": "N$subexpression$6", "symbols": [{"literal":"]"}, {"literal":"]"}]},
    {"name": "N", "symbols": ["N$subexpression$4", "N$subexpression$5", "io_param_list", "N$subexpression$6", (lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)], "postprocess":  function (d, location, reject){
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
        }},
    {"name": "N$subexpression$7", "symbols": [{"literal":"["}, {"literal":"["}]},
    {"name": "N$subexpression$8", "symbols": [{"literal":"]"}, {"literal":"]"}]},
    {"name": "N$ebnf$7$subexpression$1", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "N$ebnf$7$subexpression$1", "symbols": [{"literal":"["}, "expr", {"literal":"]"}]},
    {"name": "N$ebnf$7", "symbols": ["N$ebnf$7$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$7", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"attestation"}, "N$subexpression$7", "attestation_param_list", "N$subexpression$8", "N$ebnf$7"], "postprocess":  function (d, location, reject){
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
        }},
    {"name": "N$subexpression$9", "symbols": [{"literal":"var"}]},
    {"name": "N$subexpression$9", "symbols": [{"literal":"balance"}]},
    {"name": "N$subexpression$10", "symbols": ["expr"]},
    {"name": "N$subexpression$10", "symbols": [(lexer.has("addressValue") ? {type: "addressValue"} : addressValue)]},
    {"name": "N$subexpression$10", "symbols": [{"literal":"base"}]},
    {"name": "N$ebnf$8$subexpression$1$subexpression$1", "symbols": ["expr"]},
    {"name": "N$ebnf$8$subexpression$1$subexpression$1", "symbols": [{"literal":"base"}]},
    {"name": "N$ebnf$8$subexpression$1", "symbols": [{"literal":"["}, "N$ebnf$8$subexpression$1$subexpression$1", {"literal":"]"}]},
    {"name": "N$ebnf$8", "symbols": ["N$ebnf$8$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$8", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": ["N$subexpression$9", {"literal":"["}, "N$subexpression$10", {"literal":"]"}, "N$ebnf$8"], "postprocess":  function(d) {
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
        } },
    {"name": "N$subexpression$11", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "N$subexpression$11", "symbols": [{"literal":"["}, "expr", {"literal":"]"}]},
    {"name": "N", "symbols": [{"literal":"asset"}, {"literal":"["}, "expr", {"literal":"]"}, "N$subexpression$11"], "postprocess":  function(d) {
        	var field = d[4];
        	if (field[0].type === 'dotSelector')
        		field = field[0].value.substr(1);
        	else
        		field = field[1];
        	return addLocation(['asset', d[2], field], d);
        } },
    {"name": "N", "symbols": [{"literal":"storage_size"}], "postprocess": function(d) {return addLocation(['storage_size'], d); }},
    {"name": "N", "symbols": [{"literal":"mci"}], "postprocess": function(d) {return addLocation(['mci'], d); }},
    {"name": "N", "symbols": [{"literal":"timestamp"}], "postprocess": function(d) {return addLocation(['timestamp'], d); }},
    {"name": "N", "symbols": [{"literal":"mc_unit"}], "postprocess": function(d) {return addLocation(['mc_unit'], d); }},
    {"name": "N", "symbols": [{"literal":"number_of_responses"}], "postprocess": function(d) {return addLocation(['number_of_responses'], d); }},
    {"name": "N", "symbols": [{"literal":"this_address"}], "postprocess": function(d) {return addLocation(['this_address'], d); }},
    {"name": "N", "symbols": [{"literal":"response_unit"}], "postprocess": function(d) {return addLocation(['response_unit'], d); }},
    {"name": "N", "symbols": [{"literal":"trigger.address"}], "postprocess": function(d) {return addLocation(['trigger.address'], d); }},
    {"name": "N", "symbols": [{"literal":"trigger.initial_address"}], "postprocess": function(d) {return addLocation(['trigger.initial_address'], d); }},
    {"name": "N", "symbols": [{"literal":"trigger.unit"}], "postprocess": function(d) {return addLocation(['trigger.unit'], d); }},
    {"name": "N", "symbols": [{"literal":"trigger.initial_unit"}], "postprocess": function(d) {return addLocation(['trigger.initial_unit'], d); }},
    {"name": "N$subexpression$12", "symbols": [{"literal":"["}, {"literal":"["}]},
    {"name": "N$subexpression$13", "symbols": ["expr"]},
    {"name": "N$subexpression$13", "symbols": [{"literal":"base"}]},
    {"name": "N$subexpression$14", "symbols": [{"literal":"]"}, {"literal":"]"}]},
    {"name": "N$ebnf$9", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)], "postprocess": id},
    {"name": "N$ebnf$9", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"trigger.output"}, "N$subexpression$12", {"literal":"asset"}, "comparisonOperator", "N$subexpression$13", "N$subexpression$14", "N$ebnf$9"], "postprocess":  function(d) {
        	var value = d[4][0];
        	var field = d[6] ? d[6].value.substr(1) : 'amount';
        	if (value.value === 'base')
        		value = value.value;
        	return addLocation(['trigger.output', d[3], value, field], d);
        } },
    {"name": "N$subexpression$15", "symbols": [{"literal":"map"}]},
    {"name": "N$subexpression$15", "symbols": [{"literal":"filter"}]},
    {"name": "N$subexpression$16", "symbols": ["float"]},
    {"name": "N$subexpression$16", "symbols": ["local_var"]},
    {"name": "N$subexpression$17", "symbols": ["func_declaration"]},
    {"name": "N$subexpression$17", "symbols": ["local_var"]},
    {"name": "N$subexpression$17", "symbols": ["remote_func"]},
    {"name": "N", "symbols": ["N$subexpression$15", {"literal":"("}, "expr", {"literal":","}, "N$subexpression$16", {"literal":","}, "N$subexpression$17", {"literal":")"}], "postprocess": function(d) {return addLocation([d[0][0].value, d[2], d[4][0], d[6][0]], d); }},
    {"name": "N$subexpression$18", "symbols": ["float"]},
    {"name": "N$subexpression$18", "symbols": ["local_var"]},
    {"name": "N$subexpression$19", "symbols": ["func_declaration"]},
    {"name": "N$subexpression$19", "symbols": ["local_var"]},
    {"name": "N$subexpression$19", "symbols": ["remote_func"]},
    {"name": "N", "symbols": [{"literal":"reduce"}, {"literal":"("}, "expr", {"literal":","}, "N$subexpression$18", {"literal":","}, "N$subexpression$19", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return addLocation(['reduce', d[2], d[4][0], d[6][0], d[8]], d); }},
    {"name": "N", "symbols": [{"literal":"reverse"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) { return addLocation(['reverse', d[2]], d); }},
    {"name": "N$ebnf$10$subexpression$1", "symbols": [{"literal":","}, "expr"]},
    {"name": "N$ebnf$10", "symbols": ["N$ebnf$10$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$10", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"split"}, {"literal":"("}, "expr", {"literal":","}, "expr", "N$ebnf$10", {"literal":")"}], "postprocess": function(d) { return addLocation(['split', d[2], d[4], d[5] ? d[5][1] : null], d); }},
    {"name": "N", "symbols": [{"literal":"join"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) { return addLocation(['join', d[2], d[4]], d); }},
    {"name": "float", "symbols": [(lexer.has("number") ? {type: "number"} : number)], "postprocess": function(d) { return addLocation(new Decimal(d[0].value).times(1), d); }},
    {"name": "string", "symbols": [(lexer.has("string") ? {type: "string"} : string)], "postprocess": function(d) {return addLocation(d[0].value, d); }},
    {"name": "boolean$subexpression$1", "symbols": [{"literal":"true"}]},
    {"name": "boolean$subexpression$1", "symbols": [{"literal":"false"}]},
    {"name": "boolean", "symbols": ["boolean$subexpression$1"], "postprocess": function(d) {return addLocation(d[0][0].value === 'true', d); }}
]
  , ParserStart: "main"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
