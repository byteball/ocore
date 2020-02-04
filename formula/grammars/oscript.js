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
		none: 'none',
		typeof: 'typeof',
		type: 'type',
		boolean: ['true', 'false'],
		if: "if",
		else: "else",
		comparisonOperators: ["==", ">=", "<=", "!=", ">", "<", "="],
		dfParamsName: ['oracles', 'feed_name', 'min_mci', 'feed_value', 'what'],
		name: ['min', 'max', 'pi', 'e', 'sqrt', 'ln', 'ceil', 'floor', 'round', 'abs', 'hypot', 'is_valid_signed_package', 'is_valid_sig', 'vrf_verify', 'sha256', 'json_parse', 'json_stringify', 'number_from_seed', 'length', 'is_valid_address', 'starts_with', 'ends_with', 'contains', 'substring', 'timestamp_to_string', 'parse_date', 'is_aa', 'is_integer', 'is_valid_amount', 'is_array', 'is_assoc', 'array_length', 'index_of', 'to_upper', 'to_lower', 'exists', 'number_of_responses', 'is_valid_merkle_proof'],
		and: ['and', 'AND'],
		or: ['or', 'OR'],
		not: ['not', 'NOT', '!'],
		otherwise: ['otherwise', 'OTHERWISE'],
		quote: '"',
		ternary: ['?', ':'],
		base: 'base',
		var: 'var',
		storage_size: 'storage_size',
		mci: 'mci',
		timestamp: 'timestamp',
		this_address: 'this_address',
		mc_unit: 'mc_unit',
		response_unit: 'response_unit',
		unit: 'unit',
		definition: 'definition',
		response: 'response',
		bounce: 'bounce',
		return: 'return',
		params: 'params',
		addressValue: /\b[2-7A-Z]{32}\b/,
		trigger_address: /\btrigger\.address\b/,
		trigger_initial_address: /\btrigger\.initial_address\b/,
		trigger_unit: /\btrigger\.unit\b/,
		trigger_data: /\btrigger\.data\b/,
		trigger_output: /\btrigger\.output\b/,
		dotSelector: /\.\w+/,
		local_var_name: /\$[a-zA-Z]\w*\b/,
	//	search_field: /[a-zA-Z]\w*\b/,
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
    {"name": "statement", "symbols": ["return_statement"], "postprocess": id},
    {"name": "statement", "symbols": ["empty_return_statement"], "postprocess": id},
    {"name": "ifelse$ebnf$1$subexpression$1", "symbols": [{"literal":"else"}, "block"]},
    {"name": "ifelse$ebnf$1", "symbols": ["ifelse$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "ifelse$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "ifelse", "symbols": [{"literal":"if"}, {"literal":"("}, "expr", {"literal":")"}, "block", "ifelse$ebnf$1"], "postprocess":  function(d){
        	var else_block = d[5] ? d[5][1] : null;
        	return ['ifelse', d[2], d[4], else_block];
        } },
    {"name": "block$ebnf$1", "symbols": []},
    {"name": "block$ebnf$1", "symbols": ["block$ebnf$1", "statement"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "block", "symbols": [{"literal":"{"}, "block$ebnf$1", {"literal":"}"}], "postprocess": function(d){ return ['block', d[1]]; }},
    {"name": "block", "symbols": ["statement"], "postprocess": id},
    {"name": "bounce_expr", "symbols": [{"literal":"bounce"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) { return ['bounce', d[2]]; }},
    {"name": "bounce_statement", "symbols": ["bounce_expr", {"literal":";"}], "postprocess": function(d) { return d[0]; }},
    {"name": "return_statement", "symbols": [{"literal":"return"}, "expr", {"literal":";"}], "postprocess": function(d) { return ['return', d[1]]; }},
    {"name": "empty_return_statement", "symbols": [{"literal":"return"}, {"literal":";"}], "postprocess": function(d) { return ['return', null]; }},
    {"name": "otherwise_expr", "symbols": ["expr", (lexer.has("otherwise") ? {type: "otherwise"} : otherwise), "ternary_expr"], "postprocess": function(d) { return ['otherwise', d[0], d[2]]; }},
    {"name": "otherwise_expr", "symbols": ["ternary_expr"], "postprocess": id},
    {"name": "ternary_expr", "symbols": ["or_expr", {"literal":"?"}, "expr", {"literal":":"}, "ternary_expr"], "postprocess": function(d) {return ['ternary', d[0], d[2], d[4]];}},
    {"name": "ternary_expr", "symbols": ["or_expr"], "postprocess": id},
    {"name": "or_expr", "symbols": ["or_expr", (lexer.has("or") ? {type: "or"} : or), "and_expr"], "postprocess": function(d) {return ['or', d[0], d[2]];}},
    {"name": "or_expr", "symbols": ["and_expr"], "postprocess": id},
    {"name": "and_expr", "symbols": ["and_expr", (lexer.has("and") ? {type: "and"} : and), "comp_expr"], "postprocess": function(d) {return ['and', d[0], d[2]];}},
    {"name": "and_expr", "symbols": ["comp_expr"], "postprocess": id},
    {"name": "expr", "symbols": ["otherwise_expr"], "postprocess": id},
    {"name": "expr_list$ebnf$1", "symbols": []},
    {"name": "expr_list$ebnf$1$subexpression$1", "symbols": [{"literal":","}, "expr"]},
    {"name": "expr_list$ebnf$1", "symbols": ["expr_list$ebnf$1", "expr_list$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "expr_list", "symbols": ["expr", "expr_list$ebnf$1"], "postprocess": function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   }},
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":"=="}]},
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":"!="}]},
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":">"}]},
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":">="}]},
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":"<"}]},
    {"name": "comp_expr$subexpression$1", "symbols": [{"literal":"<="}]},
    {"name": "comp_expr", "symbols": ["AS", "comp_expr$subexpression$1", "AS"], "postprocess": function(d) { return ['comparison', d[1][0].value, d[0], d[2]];}},
    {"name": "comp_expr", "symbols": ["AS"], "postprocess": id},
    {"name": "comparisonOperator", "symbols": [(lexer.has("comparisonOperators") ? {type: "comparisonOperators"} : comparisonOperators)], "postprocess": function(d) { return d[0].value }},
    {"name": "local_var_expr", "symbols": [{"literal":"${"}, "expr", {"literal":"}"}], "postprocess": function(d) { return d[1]; }},
    {"name": "local_var$subexpression$1", "symbols": [(lexer.has("local_var_name") ? {type: "local_var_name"} : local_var_name)]},
    {"name": "local_var$subexpression$1", "symbols": ["local_var_expr"]},
    {"name": "local_var$ebnf$1", "symbols": []},
    {"name": "local_var$ebnf$1$subexpression$1", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "local_var$ebnf$1$subexpression$1", "symbols": [{"literal":"["}, {"literal":"["}, "search_param_list", {"literal":"]"}, {"literal":"]"}]},
    {"name": "local_var$ebnf$1$subexpression$1", "symbols": [{"literal":"["}, "expr", {"literal":"]"}]},
    {"name": "local_var$ebnf$1", "symbols": ["local_var$ebnf$1", "local_var$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "local_var", "symbols": ["local_var$subexpression$1", "local_var$ebnf$1"], "postprocess":  function(d) {
        	var v = d[0][0];
        	if (v.type === 'local_var_name')
        		v = v.value.substr(1);
        	var selectors = null;
        	if (d[1] && d[1].length)
        		selectors = d[1].map(function(item){
        			if (item[0].type === 'dotSelector')
        				return item[0].value.substr(1);
        			else if (item.length === 5)
        				return ['search_param_list', item[2]];
        			else
        				return item[1];
        		});
        	return ['local_var', v, selectors];
        }  },
    {"name": "local_var_assignment", "symbols": ["local_var", {"literal":"="}, "expr", {"literal":";"}], "postprocess": function(d) { return ['local_var_assignment', d[0], d[2]]; }},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"+="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"-="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"*="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"/="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"%="}]},
    {"name": "state_var_assignment$subexpression$1", "symbols": [{"literal":"||="}]},
    {"name": "state_var_assignment", "symbols": [{"literal":"var"}, {"literal":"["}, "expr", {"literal":"]"}, "state_var_assignment$subexpression$1", "expr", {"literal":";"}], "postprocess": function(d) { return ['state_var_assignment', d[2], d[5], d[4][0].value]; }},
    {"name": "response_var_assignment", "symbols": [{"literal":"response"}, {"literal":"["}, "expr", {"literal":"]"}, {"literal":"="}, "expr", {"literal":";"}], "postprocess": function(d) { return ['response_var_assignment', d[2], d[5]]; }},
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
    {"name": "search_param", "symbols": ["search_fields", "comparisonOperator", "search_param$subexpression$1"], "postprocess": function(d) { return [d[0], d[1], d[2][0]]; }},
    {"name": "search_param_list$ebnf$1", "symbols": []},
    {"name": "search_param_list$ebnf$1$subexpression$1", "symbols": [{"literal":","}, "search_param"]},
    {"name": "search_param_list$ebnf$1", "symbols": ["search_param_list$ebnf$1", "search_param_list$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "search_param_list", "symbols": ["search_param", "search_param_list$ebnf$1"], "postprocess": function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   }},
    {"name": "df_param$subexpression$1", "symbols": [(lexer.has("dfParamsName") ? {type: "dfParamsName"} : dfParamsName)]},
    {"name": "df_param$subexpression$1", "symbols": [(lexer.has("ifseveral") ? {type: "ifseveral"} : ifseveral)]},
    {"name": "df_param$subexpression$1", "symbols": [(lexer.has("ifnone") ? {type: "ifnone"} : ifnone)]},
    {"name": "df_param$subexpression$1", "symbols": [(lexer.has("type") ? {type: "type"} : type)]},
    {"name": "df_param$subexpression$2", "symbols": ["expr"]},
    {"name": "df_param$subexpression$2", "symbols": [(lexer.has("addressValue") ? {type: "addressValue"} : addressValue)]},
    {"name": "df_param", "symbols": ["df_param$subexpression$1", "comparisonOperator", "df_param$subexpression$2"], "postprocess":  function(d) {
        	var value = d[2][0];
        	if (value.type === 'addressValue')
        		value = value.value;
        	return [d[0][0].value, d[1], value];
        } },
    {"name": "df_param_list$ebnf$1", "symbols": []},
    {"name": "df_param_list$ebnf$1$subexpression$1", "symbols": [{"literal":","}, "df_param"]},
    {"name": "df_param_list$ebnf$1", "symbols": ["df_param_list$ebnf$1", "df_param_list$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "df_param_list", "symbols": ["df_param", "df_param_list$ebnf$1"], "postprocess": function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   }},
    {"name": "io_param$subexpression$1", "symbols": [(lexer.has("address") ? {type: "address"} : address)]},
    {"name": "io_param$subexpression$1", "symbols": [(lexer.has("amount") ? {type: "amount"} : amount)]},
    {"name": "io_param$subexpression$1", "symbols": [(lexer.has("asset") ? {type: "asset"} : asset)]},
    {"name": "io_param$subexpression$2", "symbols": ["expr"]},
    {"name": "io_param$subexpression$2", "symbols": [(lexer.has("base") ? {type: "base"} : base)]},
    {"name": "io_param$subexpression$2", "symbols": [(lexer.has("addressValue") ? {type: "addressValue"} : addressValue)]},
    {"name": "io_param", "symbols": ["io_param$subexpression$1", "comparisonOperator", "io_param$subexpression$2"], "postprocess":  function(d) {
        	var value = d[2][0];
        	if (value.type === 'base' || value.type === 'addressValue')
        		value = value.value;
        	return [d[0][0].value, d[1], value];
        } },
    {"name": "io_param_list$ebnf$1", "symbols": []},
    {"name": "io_param_list$ebnf$1$subexpression$1", "symbols": [{"literal":","}, "io_param"]},
    {"name": "io_param_list$ebnf$1", "symbols": ["io_param_list$ebnf$1", "io_param_list$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "io_param_list", "symbols": ["io_param", "io_param_list$ebnf$1"], "postprocess": function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   }},
    {"name": "attestation_param$subexpression$1", "symbols": [(lexer.has("attestors") ? {type: "attestors"} : attestors)]},
    {"name": "attestation_param$subexpression$1", "symbols": [(lexer.has("address") ? {type: "address"} : address)]},
    {"name": "attestation_param$subexpression$1", "symbols": [(lexer.has("ifseveral") ? {type: "ifseveral"} : ifseveral)]},
    {"name": "attestation_param$subexpression$1", "symbols": [(lexer.has("ifnone") ? {type: "ifnone"} : ifnone)]},
    {"name": "attestation_param$subexpression$1", "symbols": [(lexer.has("type") ? {type: "type"} : type)]},
    {"name": "attestation_param$subexpression$2", "symbols": ["expr"]},
    {"name": "attestation_param$subexpression$2", "symbols": [(lexer.has("addressValue") ? {type: "addressValue"} : addressValue)]},
    {"name": "attestation_param", "symbols": ["attestation_param$subexpression$1", "comparisonOperator", "attestation_param$subexpression$2"], "postprocess":  function(d) {
        	var value = d[2][0];
        	if (value.type === 'addressValue')
        		value = value.value;
        	return [d[0][0].value, d[1], value];
        } },
    {"name": "attestation_param_list$ebnf$1", "symbols": []},
    {"name": "attestation_param_list$ebnf$1$subexpression$1", "symbols": [{"literal":","}, "attestation_param"]},
    {"name": "attestation_param_list$ebnf$1", "symbols": ["attestation_param_list$ebnf$1", "attestation_param_list$ebnf$1$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "attestation_param_list", "symbols": ["attestation_param", "attestation_param_list$ebnf$1"], "postprocess": function(d) { return [d[0]].concat(d[1].map(function (item) {return item[1];}));   }},
    {"name": "P", "symbols": [{"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return d[1]; }},
    {"name": "P", "symbols": ["N"], "postprocess": id},
    {"name": "P", "symbols": ["string"], "postprocess": id},
    {"name": "Exp", "symbols": ["P", {"literal":"^"}, "Exp"], "postprocess": function(d) {return ['^', d[0], d[2]]; }},
    {"name": "Exp", "symbols": ["P"], "postprocess": id},
    {"name": "unary_expr", "symbols": ["Exp"], "postprocess": id},
    {"name": "unary_expr", "symbols": [(lexer.has("not") ? {type: "not"} : not), "unary_expr"], "postprocess": function(d) {return ['not', d[1]];}},
    {"name": "MD", "symbols": ["MD", {"literal":"*"}, "unary_expr"], "postprocess": function(d) {return ['*', d[0], d[2]]; }},
    {"name": "MD", "symbols": ["MD", {"literal":"/"}, "unary_expr"], "postprocess": function(d) {return ['/', d[0], d[2]]; }},
    {"name": "MD", "symbols": ["MD", {"literal":"%"}, "unary_expr"], "postprocess": function(d) {return ['%', d[0], d[2]]; }},
    {"name": "MD", "symbols": ["unary_expr"], "postprocess": id},
    {"name": "AS", "symbols": ["AS", {"literal":"+"}, "MD"], "postprocess": function(d) {return ['+', d[0], d[2]]; }},
    {"name": "AS", "symbols": ["AS", {"literal":"-"}, "MD"], "postprocess": function(d) {return ['-', d[0], d[2]]; }},
    {"name": "AS", "symbols": [{"literal":"-"}, "MD"], "postprocess": function(d) {return ['-', new Decimal(0), d[1]]; }},
    {"name": "AS", "symbols": [{"literal":"+"}, "MD"], "postprocess": function(d) {return ['+', new Decimal(0), d[1]]; }},
    {"name": "AS", "symbols": ["AS", (lexer.has("concat") ? {type: "concat"} : concat), "MD"], "postprocess": function(d) {return ['concat', d[0], d[2]]; }},
    {"name": "AS", "symbols": ["MD"], "postprocess": id},
    {"name": "N", "symbols": ["float"], "postprocess": id},
    {"name": "N", "symbols": ["boolean"], "postprocess": id},
    {"name": "N", "symbols": ["local_var"], "postprocess": id},
    {"name": "N", "symbols": [{"literal":"pi"}], "postprocess": function(d) {return ['pi']; }},
    {"name": "N", "symbols": [{"literal":"e"}], "postprocess": function(d) {return ['e']; }},
    {"name": "N", "symbols": [{"literal":"sqrt"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['sqrt', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"ln"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['ln', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"min"}, {"literal":"("}, "expr_list", {"literal":")"}], "postprocess": function(d) {return ['min', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"max"}, {"literal":"("}, "expr_list", {"literal":")"}], "postprocess": function(d) {return ['max', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"hypot"}, {"literal":"("}, "expr_list", {"literal":")"}], "postprocess": function(d) {return ['hypot', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"number_from_seed"}, {"literal":"("}, "expr_list", {"literal":")"}], "postprocess": function(d) {return ['number_from_seed', d[2]]; }},
    {"name": "N$ebnf$1$subexpression$1", "symbols": [(lexer.has("comma") ? {type: "comma"} : comma), "expr"]},
    {"name": "N$ebnf$1", "symbols": ["N$ebnf$1$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"ceil"}, {"literal":"("}, "expr", "N$ebnf$1", {"literal":")"}], "postprocess": function(d) {return ['ceil', d[2], d[3] ? d[3][1] : null]; }},
    {"name": "N$ebnf$2$subexpression$1", "symbols": [(lexer.has("comma") ? {type: "comma"} : comma), "expr"]},
    {"name": "N$ebnf$2", "symbols": ["N$ebnf$2$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$2", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"floor"}, {"literal":"("}, "expr", "N$ebnf$2", {"literal":")"}], "postprocess": function(d) {return ['floor', d[2], d[3] ? d[3][1] : null]; }},
    {"name": "N$ebnf$3$subexpression$1", "symbols": [(lexer.has("comma") ? {type: "comma"} : comma), "expr"]},
    {"name": "N$ebnf$3", "symbols": ["N$ebnf$3$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$3", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"round"}, {"literal":"("}, "expr", "N$ebnf$3", {"literal":")"}], "postprocess": function(d) {return ['round', d[2], d[3] ? d[3][1] : null]; }},
    {"name": "N", "symbols": [{"literal":"abs"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['abs', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"is_valid_signed_package"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return ['is_valid_signed_package', d[2], d[4]]; }},
    {"name": "N", "symbols": [{"literal":"is_valid_sig"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return ['is_valid_sig', d[2], d[4], d[6]]; }},
    {"name": "N", "symbols": [{"literal":"vrf_verify"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return ['vrf_verify', d[2], d[4], d[6]]; }},
    {"name": "N", "symbols": [{"literal":"is_valid_merkle_proof"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return ['is_valid_merkle_proof', d[2], d[4]]; }},
    {"name": "N$ebnf$4$subexpression$1", "symbols": [{"literal":","}, "expr"]},
    {"name": "N$ebnf$4", "symbols": ["N$ebnf$4$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$4", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"sha256"}, {"literal":"("}, "expr", "N$ebnf$4", {"literal":")"}], "postprocess": function(d) {return ['sha256', d[2], d[3] ? d[3][1] : null]; }},
    {"name": "N", "symbols": [{"literal":"json_parse"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['json_parse', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"json_stringify"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['json_stringify', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"typeof"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['typeof', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"length"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['length', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"to_upper"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['to_upper', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"to_lower"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['to_lower', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"exists"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['exists', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"is_valid_address"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['is_valid_address', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"is_aa"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['is_aa', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"is_integer"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['is_integer', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"is_valid_amount"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['is_valid_amount', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"is_array"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['is_array', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"is_assoc"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['is_assoc', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"array_length"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['array_length', d[2]]; }},
    {"name": "N", "symbols": [{"literal":"starts_with"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return ['starts_with', d[2], d[4]]; }},
    {"name": "N", "symbols": [{"literal":"ends_with"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return ['ends_with', d[2], d[4]]; }},
    {"name": "N", "symbols": [{"literal":"contains"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return ['contains', d[2], d[4]]; }},
    {"name": "N", "symbols": [{"literal":"index_of"}, {"literal":"("}, "expr", {"literal":","}, "expr", {"literal":")"}], "postprocess": function(d) {return ['index_of', d[2], d[4]]; }},
    {"name": "N$ebnf$5$subexpression$1", "symbols": [{"literal":","}, "expr"]},
    {"name": "N$ebnf$5", "symbols": ["N$ebnf$5$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$5", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"substring"}, {"literal":"("}, "expr", {"literal":","}, "expr", "N$ebnf$5", {"literal":")"}], "postprocess": function(d) {return ['substring', d[2], d[4], d[5] ? d[5][1] : null]; }},
    {"name": "N$ebnf$6$subexpression$1", "symbols": [{"literal":","}, "expr"]},
    {"name": "N$ebnf$6", "symbols": ["N$ebnf$6$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$6", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"timestamp_to_string"}, {"literal":"("}, "expr", "N$ebnf$6", {"literal":")"}], "postprocess": function(d) {return ['timestamp_to_string', d[2], d[3] ? d[3][1] : null]; }},
    {"name": "N", "symbols": [{"literal":"parse_date"}, {"literal":"("}, "expr", {"literal":")"}], "postprocess": function(d) {return ['parse_date', d[2]]; }},
    {"name": "N", "symbols": ["bounce_expr"], "postprocess": id},
    {"name": "N$subexpression$1", "symbols": [{"literal":"["}, {"literal":"["}]},
    {"name": "N$subexpression$2", "symbols": [{"literal":"]"}, {"literal":"]"}]},
    {"name": "N", "symbols": [(lexer.has("data_feed") ? {type: "data_feed"} : data_feed), "N$subexpression$1", "df_param_list", "N$subexpression$2"], "postprocess":  function (d, location, reject){
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
        }},
    {"name": "N$subexpression$3", "symbols": [{"literal":"["}, {"literal":"["}]},
    {"name": "N$subexpression$4", "symbols": [{"literal":"]"}, {"literal":"]"}]},
    {"name": "N", "symbols": [(lexer.has("io") ? {type: "io"} : io), "N$subexpression$3", "io_param_list", "N$subexpression$4", (lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)], "postprocess":  function (d, location, reject){
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
        }},
    {"name": "N$subexpression$5", "symbols": [{"literal":"["}, {"literal":"["}]},
    {"name": "N$subexpression$6", "symbols": [{"literal":"]"}, {"literal":"]"}]},
    {"name": "N$ebnf$7$subexpression$1", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "N$ebnf$7$subexpression$1", "symbols": [{"literal":"["}, "expr", {"literal":"]"}]},
    {"name": "N$ebnf$7", "symbols": ["N$ebnf$7$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$7", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"attestation"}, "N$subexpression$5", "attestation_param_list", "N$subexpression$6", "N$ebnf$7"], "postprocess":  function (d, location, reject){
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
        }},
    {"name": "N$subexpression$7", "symbols": [{"literal":"var"}]},
    {"name": "N$subexpression$7", "symbols": [{"literal":"balance"}]},
    {"name": "N$subexpression$8", "symbols": ["expr"]},
    {"name": "N$subexpression$8", "symbols": [(lexer.has("addressValue") ? {type: "addressValue"} : addressValue)]},
    {"name": "N$subexpression$8", "symbols": [(lexer.has("base") ? {type: "base"} : base)]},
    {"name": "N$ebnf$8$subexpression$1$subexpression$1", "symbols": ["expr"]},
    {"name": "N$ebnf$8$subexpression$1$subexpression$1", "symbols": [(lexer.has("base") ? {type: "base"} : base)]},
    {"name": "N$ebnf$8$subexpression$1", "symbols": [{"literal":"["}, "N$ebnf$8$subexpression$1$subexpression$1", {"literal":"]"}]},
    {"name": "N$ebnf$8", "symbols": ["N$ebnf$8$subexpression$1"], "postprocess": id},
    {"name": "N$ebnf$8", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": ["N$subexpression$7", {"literal":"["}, "N$subexpression$8", {"literal":"]"}, "N$ebnf$8"], "postprocess":  function(d) {
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
        } },
    {"name": "N$subexpression$9", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "N$subexpression$9", "symbols": [{"literal":"["}, "expr", {"literal":"]"}]},
    {"name": "N", "symbols": [{"literal":"asset"}, {"literal":"["}, "expr", {"literal":"]"}, "N$subexpression$9"], "postprocess":  function(d) {
        	var field = d[4];
        	if (field[0].type === 'dotSelector')
        		field = field[0].value.substr(1);
        	else
        		field = field[1];
        	return ['asset', d[2], field];
        } },
    {"name": "N$subexpression$10", "symbols": [{"literal":"unit"}]},
    {"name": "N$subexpression$10", "symbols": [{"literal":"definition"}]},
    {"name": "N$ebnf$9", "symbols": []},
    {"name": "N$ebnf$9$subexpression$1", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "N$ebnf$9$subexpression$1", "symbols": [{"literal":"["}, {"literal":"["}, "search_param_list", {"literal":"]"}, {"literal":"]"}]},
    {"name": "N$ebnf$9$subexpression$1", "symbols": [{"literal":"["}, "expr", {"literal":"]"}]},
    {"name": "N$ebnf$9", "symbols": ["N$ebnf$9", "N$ebnf$9$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N", "symbols": ["N$subexpression$10", {"literal":"["}, "expr", {"literal":"]"}, "N$ebnf$9"], "postprocess":  function(d) {
        var selectors = null;
        if (d[4] && d[4].length){
        	selectors = d[4].map(function(item){
        		if (item[0].type === 'dotSelector')
        			return item[0].value.substr(1);
        		else if (item.length === 5)
        			return ['search_param_list', item[2]];
        		else
        			return item[1];
        	});
        }
        return [d[0][0].value, d[2], selectors]; }
        	},
    {"name": "N", "symbols": [{"literal":"storage_size"}], "postprocess": function(d) {return ['storage_size']; }},
    {"name": "N", "symbols": [{"literal":"mci"}], "postprocess": function(d) {return ['mci']; }},
    {"name": "N", "symbols": [{"literal":"timestamp"}], "postprocess": function(d) {return ['timestamp']; }},
    {"name": "N", "symbols": [{"literal":"mc_unit"}], "postprocess": function(d) {return ['mc_unit']; }},
    {"name": "N", "symbols": [{"literal":"number_of_responses"}], "postprocess": function(d) {return ['number_of_responses']; }},
    {"name": "N", "symbols": [{"literal":"this_address"}], "postprocess": function(d) {return ['this_address']; }},
    {"name": "N", "symbols": [{"literal":"response_unit"}], "postprocess": function(d) {return ['response_unit']; }},
    {"name": "N", "symbols": [{"literal":"trigger.address"}], "postprocess": function(d) {return ['trigger.address']; }},
    {"name": "N", "symbols": [{"literal":"trigger.initial_address"}], "postprocess": function(d) {return ['trigger.initial_address']; }},
    {"name": "N", "symbols": [{"literal":"trigger.unit"}], "postprocess": function(d) {return ['trigger.unit']; }},
    {"name": "N$subexpression$11", "symbols": [{"literal":"trigger.data"}]},
    {"name": "N$subexpression$11", "symbols": [{"literal":"params"}]},
    {"name": "N$ebnf$10", "symbols": []},
    {"name": "N$ebnf$10$subexpression$1", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)]},
    {"name": "N$ebnf$10$subexpression$1", "symbols": [{"literal":"["}, {"literal":"["}, "search_param_list", {"literal":"]"}, {"literal":"]"}]},
    {"name": "N$ebnf$10$subexpression$1", "symbols": [{"literal":"["}, "expr", {"literal":"]"}]},
    {"name": "N$ebnf$10", "symbols": ["N$ebnf$10", "N$ebnf$10$subexpression$1"], "postprocess": function arrpush(d) {return d[0].concat([d[1]]);}},
    {"name": "N", "symbols": ["N$subexpression$11", "N$ebnf$10"], "postprocess":  function(d) {
        var selectors = d[1].map(function(item){
        	if (item[0].type === 'dotSelector')
        		return item[0].value.substr(1);
        	else if (item.length === 5)
        		return ['search_param_list', item[2]];
        	else
        		return item[1];
        });
        return [d[0][0].value, selectors]; }
        	},
    {"name": "N$subexpression$12", "symbols": [{"literal":"["}, {"literal":"["}]},
    {"name": "N$subexpression$13", "symbols": ["expr"]},
    {"name": "N$subexpression$13", "symbols": [(lexer.has("base") ? {type: "base"} : base)]},
    {"name": "N$subexpression$14", "symbols": [{"literal":"]"}, {"literal":"]"}]},
    {"name": "N$ebnf$11", "symbols": [(lexer.has("dotSelector") ? {type: "dotSelector"} : dotSelector)], "postprocess": id},
    {"name": "N$ebnf$11", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "N", "symbols": [{"literal":"trigger.output"}, "N$subexpression$12", {"literal":"asset"}, "comparisonOperator", "N$subexpression$13", "N$subexpression$14", "N$ebnf$11"], "postprocess":  function(d) {
        	var value = d[4][0];
        	var field = d[6] ? d[6].value.substr(1) : 'amount';
        	if (value.type === 'base')
        		value = value.value;
        	return ['trigger.output', d[3], value, field];
        } },
    {"name": "float", "symbols": [(lexer.has("number") ? {type: "number"} : number)], "postprocess": function(d) { return new Decimal(d[0].value).times(1); }},
    {"name": "string", "symbols": [(lexer.has("string") ? {type: "string"} : string)], "postprocess": function(d) {return d[0].value; }},
    {"name": "boolean", "symbols": [(lexer.has("boolean") ? {type: "boolean"} : boolean)], "postprocess": function(d) {return (d[0].value === 'true'); }}
]
  , ParserStart: "main"
}
if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {
   module.exports = grammar;
} else {
   window.grammar = grammar;
}
})();
