
function toText(value) {
	if (value === null || value === undefined)
		return '';
	if (typeof value === 'string')
		return value;
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value);
	return '';
}

function pushLine(arrLines, line) {
	if (!line)
		return;
	arrLines.push(line);
}

function collectCallChain(chain, arrAddresses, seen) {
	if (!chain || typeof chain !== 'object' || seen.has(chain))
		return { node: null };
	seen.add(chain);

	var address = toText(chain.address);
	if (address)
		arrAddresses.push(address);

	var message = toText(chain.message);
	if (message)
		return { node: chain };

	return collectCallChain(chain.next, arrAddresses, seen);
}

function formatCallChain(callChain) {
	var arrAddresses = [];
	var res = collectCallChain(callChain, arrAddresses, new WeakSet());
	var arrLines = [];
	var tailNode = res.node;

	if (arrAddresses.length > 0)
		pushLine(arrLines, 'Call chain: ' + arrAddresses.join(' -> '));
	if (tailNode) {
		var cause = toText(tailNode.message);
		var context = toText(tailNode.formattedContext);
		var xpath = toText(tailNode.xpath);

		if (cause)
			pushLine(arrLines, 'Cause: ' + cause);
		if (context)
			pushLine(arrLines, 'Nested context: ' + context);
		if (xpath)
			pushLine(arrLines, 'Nested path: ' + xpath);

		formatCodeLines(tailNode.codeLines).forEach(function (line, index) {
			arrLines.push(index === 0 ? 'Nested ' + line.toLowerCase() : line);
		});
		formatTrace(tailNode.trace).forEach(function (line, index) {
			arrLines.push(index === 0 ? 'Nested ' + line.toLowerCase() : line);
		});
	}

	return arrLines;
}

function formatCodeLines(codeLines) {
	if (!Array.isArray(codeLines) || codeLines.length === 0)
		return [];

	var arrLines = ['Code:'];
	codeLines.forEach(function (item) {
		if (!item || typeof item !== 'object')
			return;
		var formula = toText(item.formula);
		var lineNumber = toText(item.lineNumber);
		if (formula && lineNumber)
			arrLines.push('  ' + lineNumber + ': ' + formula);
		else if (formula)
			arrLines.push('  ' + formula);
	});
	return arrLines;
}

function formatTrace(trace) {
	if (!Array.isArray(trace) || trace.length === 0)
		return [];

	var arrLines = ['Trace:'];
	trace.forEach(function (item) {
		if (!item || typeof item !== 'object')
			return;
		var arrParts = [];
		var type = toText(item.type);
		var name = toText(item.name);
		var aa = toText(item.aa);
		var xpath = toText(item.xpath);
		var line = toText(item.line);

		if (type)
			arrParts.push(type);
		if (name)
			arrParts.push(name);
		if (aa)
			arrParts.push(aa);
		if (xpath)
			arrParts.push(xpath + (line ? ':' + line : ''));
		else if (line)
			arrParts.push('line ' + line);

		if (arrParts.length > 0)
			arrLines.push('  ' + arrParts.join(' '));
	});

	return arrLines.length > 1 ? arrLines : [];
}

function collectFallbackDetails(value, arrLines, seen, path) {
	if (value === null || value === undefined)
		return;

	var type = typeof value;
	if (type === 'string' || type === 'number' || type === 'boolean') {
		var text = toText(value);
		if (text)
			arrLines.push(path ? path + ': ' + text : text);
		return;
	}

	if (type !== 'object' || seen.has(value))
		return;
	seen.add(value);

	if (Array.isArray(value)) {
		value.forEach(function (item, index) {
			collectFallbackDetails(item, arrLines, seen, path ? path + '[' + index + ']' : '[' + index + ']');
		});
		return;
	}

	Object.keys(value).forEach(function (key) {
		if (key === 'message' || key === 'formattedContext' || key === 'codeLines' || key === 'trace' || key === 'xpath' || key === 'callChain')
			return;
		collectFallbackDetails(value[key], arrLines, seen, path ? path + '.' + key : key);
	});
}

function errorToString(error) {
	if (typeof error === 'string')
		return error;

	if (!error || typeof error !== 'object')
		return toText(error);

	var arrLines = [];
	var message = toText(error.message);
	var formattedContext = toText(error.formattedContext);
	var xpath = toText(error.xpath);

	pushLine(arrLines, message);
	if (formattedContext)
		pushLine(arrLines, 'Context: ' + formattedContext);
	if (xpath)
		pushLine(arrLines, 'Path: ' + xpath);

	formatCodeLines(error.codeLines).forEach(function (line) {
		arrLines.push(line);
	});
	formatTrace(error.trace).forEach(function (line) {
		arrLines.push(line);
	});
	formatCallChain(error.callChain).forEach(function (line) {
		arrLines.push(line);
	});

	collectFallbackDetails(error, arrLines, new WeakSet(), '');
	return arrLines.join('\n');
}

module.exports = errorToString;
