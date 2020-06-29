var _ = require('lodash');
var nearley = require('nearley');
var ojsonGrammar = require('./grammars/ojson.js');
var oscriptGrammar = require('./grammars/oscript.js');
var ValidationUtils = require("../validation_utils.js");

var TYPES = {
	STR: 'STR',
	PAIR: 'PAIR',
	TRUE: 'TRUE',
	FALSE: 'FALSE',
	ARRAY: 'ARRAY',
	OBJECT: 'OBJECT',
	DECIMAL: 'DECIMAL',
	FORMULA: 'FORMULA'
};



function validateFormula (formula, parserResults, context) {
	function searchNewlineRecursive (st) {
		if (_.isArray(st)) {
			for (var i = 0; i < st.length; i++) {
				searchNewlineRecursive(st[i])
			}
		} else if (st && _.isPlainObject(st)) {
			var keys = Object.keys(st)
			for (var i = 0; i < keys.length; i++) {
				searchNewlineRecursive(st[keys[i]])
			}
		} else if (_.isString(st) && st.includes('\n')) {
			throw new Error(`Error parsing formula starting at line ${context.line} col ${context.col}: newline is not allowed in string '${st}'`)
		}
	}

	if (!_.isArray(parserResults)) {
		throw new Error(`Error parsing formula starting at line ${context.line} col ${context.col}`)
	} else if (parserResults.length !== 1) {
		throw new Error(`Error parsing formula starting at line ${context.line} col ${context.col}: ambiguous parser result`)
	} else {
		searchNewlineRecursive(parserResults[0])
	}
}

exports.parse = function (text, callback) {
	var parser = {};
	try {
		parser = new nearley.Parser(nearley.Grammar.fromCompiled(ojsonGrammar));
		parser.feed(text);
	} catch (e) {
		return callback('ojson parsing failed: ' + e, null);
	}

	if (!_.isArray(parser.results)) {
		return callback('parserResult should be Array');
	}
	if (parser.results.length !== 1) {
		return callback('parserResult should be Array of length 1');
	}

	try {
		var result = processTree(parser.results[0]);
		return callback(null, ['autonomous agent', result]);
	} catch (e) {
		return callback(e.message);
	}

	function processTree (tree) {
		if (tree.type === TYPES.ARRAY) {
			return processAsArray(tree);
		} else if (tree.type === TYPES.STR) {
			return tree.value;
		} else if (tree.type === TYPES.TRUE) {
			return tree.value;
		} else if (tree.type === TYPES.FALSE) {
			return tree.value;
		} else if (tree.type === TYPES.DECIMAL) {
			return tree.value;
		} else if (tree.type === TYPES.FORMULA) {
			var formula = tree.value;
			try {
				parser = new nearley.Parser(nearley.Grammar.fromCompiled(oscriptGrammar));
				parser.feed(formula);
				validateFormula(formula, parser.results, tree.context)
				return '{' + formula + '}';
			} catch (e) {
				var msg = e.message;
				var match = msg.match(/invalid syntax at line ([\d]+) col ([\d]+):([\s\S]+)/m);
				if (match) {
					throw new Error(`Invalid formula syntax at line ${tree.context.line + Number(match[1]) - 1} col ${tree.context.col + Number(match[2]) - 1}:${match[3]}`);
				} else if (msg.startsWith('Error parsing formula starting at line')) {
					throw new Error(msg)
			  } else {
					throw new Error(`Invalid formula starting at line ${tree.context.line} col ${tree.context.col}`);
				}
			}
		} else if (tree.type === TYPES.OBJECT) {
			return processAsObject(tree);
		} else if (tree.type === TYPES.PAIR) {
			return { [processTree(tree.key)]: processTree(tree.value) };
		} else {
			throw new Error(`Unknown ojson node type ${tree.type}`);
		}
	}

	function processAsObject (tree) {
		var obj = {};
		for (var i = 0; i < tree.value.length; i++) {
			var st = tree.value[i];
			var res = processTree(st);
			var key = Object.keys(res)[0];
			var value = _.values(res)[0];
			if (ValidationUtils.hasOwnProperty(obj, key)) {
				throw new Error(`Duplicate key '${key}' at line ${st.context.line} col ${st.context.col}`);
			}
			obj[key] = value;
		}
		return obj;
	}
	function processAsArray (tree) {
		var arr = [];
		for (var i = 0; i < tree.value.length; i++) {
			var st = tree.value[i];
			var res = processTree(st);
			arr.push(res);
		}
		return arr;
	}
};
