const functions = require('./functions');
const renderOp = require('./opRender');

const TRACE_EVENTS = {
	ENTER_FUNC: 'enter to func',
	EXIT_FUNC: 'exit from func',
	ENTER_AA: 'enter to aa',
	ENTER_GETTERS: 'enter to getters',
	EXIT_GETTERS: 'exit from getters',
};

const FRAME_TYPES = {
	AA: 'aa',
	GETTER: 'getter',
	FUNCTION: 'function',
};

const SPECIAL_OPS = {
	BOUNCE: 'bounce',
	REQUIRE: 'require',
	COMPARISON: 'comparison',
};

function getFormulaByLine(formula, line) {
	if (!formula) return '';
	const lines = formula.split('\n').map(l => l.trim());
	return lines[line - 1] || '';
}

function hasLineInFormula(formula, line) {
	if (!formula || line === undefined || line <= 0) return false;
	return line <= formula.split('\n').length;
}

function pickBestFormulaForLine(formulas, line, currentFormula) {
	if (!Array.isArray(formulas) || !formulas.length) return undefined;

	const withLine = formulas.filter(f => hasLineInFormula(f, line));
	if (!withLine.length) return undefined;

	return withLine.includes(currentFormula) ? currentFormula : withLine[0];
}

function getErrorMessage(error) {
	if (!error) return error;
	if (error.message !== undefined) return error.message;
	if (error.bounce_message !== undefined) return error.bounce_message;
	return error;
}

function unwrapAstNode(node) {
	if (Array.isArray(node)) return node;
	if (!node || !Array.isArray(node.value)) return node;

	const arr = node.value.slice();
	if (node.context !== undefined) arr.context = node.context;
	if (node.line !== undefined) arr.line = node.line;
	return arr;
}

function formatComparisonContext(context) {
	const { left, right, op } = context;
	if (!left || !right || !op) return '';

	const leftCode = renderOp(unwrapAstNode(left.var_name));
	const rightCode = renderOp(unwrapAstNode(right.var_name));

	const leftVal = `${left.val}(${left.type})`;
	const rightVal = `${right.val}(${right.type})`;

	return `${leftCode} ${op} ${rightCode}\n${leftVal} ${op} ${rightVal}`;
}

function formatErrorContext(context) {
	if (!context?.arr) return '';

	const arr = unwrapAstNode(context.arr);
	const op = Array.isArray(arr) ? arr[0] : undefined;

	if (op === SPECIAL_OPS.BOUNCE) return '';
	if (op === SPECIAL_OPS.COMPARISON) return formatComparisonContext(context);
	if (functions.has(op)) return op;

	return renderOp(arr);
}

function findGetterIndex(frames) {
	return frames.findIndex(f => f?.type === FRAME_TYPES.GETTER);
}

function collectFunctionsAfterGetter(frames, getterIndex) {
	const functionsAfterGetter = frames
		.slice(getterIndex + 1)
		.filter(f => f?.type === FRAME_TYPES.FUNCTION);

	const getterFuncName = functionsAfterGetter.find(f => f.name)?.name;

	return { functionsAfterGetter, getterFuncName };
}

function buildAAFrame(frame, nextFrame, traceLine) {
	const aaFrame = { type: FRAME_TYPES.AA, aa: frame.aa };

	if (frame.xpath !== undefined) aaFrame.xpath = frame.xpath;

	const line = nextFrame?.call_line ?? traceLine;
	if (line !== undefined) aaFrame.line = line;

	return aaFrame;
}

function buildGetterFrame(frame, getterFuncName, functionsAfterGetter, traceLine) {
	const getterFrame = {
		type: FRAME_TYPES.GETTER,
		aa: frame.aa,
	};

	const name = getterFuncName ?? frame.name;
	if (name !== undefined) getterFrame.name = name;
	if (frame.xpath !== undefined) getterFrame.xpath = frame.xpath;

	if (functionsAfterGetter.length > 1) {
		const line = functionsAfterGetter[1]?.call_line ?? traceLine;
		if (line !== undefined) getterFrame.line = line;
	} else {
		const line = traceLine ?? frame.call_line;
		if (line !== undefined) getterFrame.line = line;
	}

	return getterFrame;
}

function buildFunctionFrame(frame, nextFrame, traceLine) {
	const funcFrame = {
		type: FRAME_TYPES.FUNCTION,
		name: frame.name || '<anonymous>',
	};

	if (frame.def_xpath !== undefined) funcFrame.xpath = frame.def_xpath;

	if (nextFrame?.type === FRAME_TYPES.FUNCTION && nextFrame.call_line !== undefined) {
		funcFrame.line = nextFrame.call_line;
	} else if (traceLine !== undefined) {
		funcFrame.line = traceLine;
	}

	return funcFrame;
}

function buildTraceFromFrames(frames, traceLine) {
	if (!Array.isArray(frames) || !frames.length) return null;

	const getterIndex = findGetterIndex(frames);
	const hasGetter = getterIndex !== -1;
	const { functionsAfterGetter, getterFuncName } = hasGetter
		? collectFunctionsAfterGetter(frames, getterIndex)
		: { functionsAfterGetter: [], getterFuncName: undefined };

	const result = [];
	const added = { aa: false, getter: false };

	for (let i = 0; i < frames.length; i++) {
		const frame = frames[i];
		if (!frame || typeof frame !== 'object') continue;

		switch (frame.type) {
			case FRAME_TYPES.AA:
				if (added.aa) break;
				added.aa = true;
				result.push(buildAAFrame(frame, frames[i + 1], traceLine));
				break;

			case FRAME_TYPES.GETTER:
				if (added.getter) break;
				added.getter = true;
				result.push(buildGetterFrame(frame, getterFuncName, functionsAfterGetter, traceLine));

				if (functionsAfterGetter.length > 1) {
					const lastFunc = functionsAfterGetter.at(-1);
					const funcFrame = {
						type: FRAME_TYPES.FUNCTION,
						name: lastFunc.name || '<anonymous>',
					};
					if (lastFunc.def_xpath !== undefined) funcFrame.xpath = lastFunc.def_xpath;
					if (traceLine !== undefined) funcFrame.line = traceLine;
					result.push(funcFrame);
				}
				break;

			case FRAME_TYPES.FUNCTION:
				if (getterIndex === -1) {
					result.push(buildFunctionFrame(frame, frames[i + 1], traceLine));
				}
				break;
		}
	}

	return result.length ? result : null;
}

function collectLinesFromArr(arr, lines = new Set()) {
	if (!arr) return lines;

	if (arr.line !== undefined) {
		lines.add(arr.line);
	}

	if (Array.isArray(arr)) {
		for (const item of arr) {
			collectLinesFromArr(item, lines);
		}
	} else if (typeof arr === 'object') {
		for (const key in arr) {
			if (Object.hasOwn(arr, key) && key !== 'line') {
				collectLinesFromArr(arr[key], lines);
			}
		}
	}

	return lines;
}

function handleEnterFunc(event, state) {
	const { framesStack, funcFormulas, funcFormulaStack } = state;

	if (event.name) state.lastNamedFunc = event.name;
	if (event.name && event.formula) funcFormulas.set(event.name, event.formula);
	if (event.formula) funcFormulaStack.push(event.formula);

	framesStack.push({
		type: FRAME_TYPES.FUNCTION,
		name: event.name || '<anonymous>',
		aa: event.aa,
		def_xpath: event.xpath,
		call_line: event.call_line,
	});
}

function removeLastFrameByType(framesStack, type, matchAA) {
	for (let j = framesStack.length - 1; j >= 0; j--) {
		const f = framesStack[j];
		if (f.type === type && (matchAA === undefined || f.aa === matchAA)) {
			framesStack.splice(j, 1);
			return;
		}
	}
}

function handleExitFunc(_, state) {
	state.lastNamedFunc = undefined;
	if (state.funcFormulaStack.length) state.funcFormulaStack.pop();
	removeLastFrameByType(state.framesStack, FRAME_TYPES.FUNCTION);
}

function handleEnterAA(event, state) {
	const { framesStack, aaPath, aaFormulas } = state;

	state.lastAA = event.aa;
	state.lastFormula = event.formula;
	state.ownerAA = event.aa;
	state.ownerFormula = event.formula;

	framesStack.push({ type: FRAME_TYPES.AA, aa: event.aa, xpath: event.xpath });

	if (!aaFormulas.has(event.aa)) {
		aaFormulas.set(event.aa, new Set());
	}
	aaFormulas.get(event.aa).add(event.formula);

	if (aaPath.at(-1) !== event.aa) {
		aaPath.push(event.aa);
	}
}

function handleEnterGetters(event, state) {
	const { framesStack, gettersStack, getters } = state;

	getters.set(event.aa, event.formula);
	gettersStack.push(event.aa);
	state.lastGettersAA = gettersStack.at(-1);

	framesStack.push({
		type: FRAME_TYPES.GETTER,
		aa: event.aa,
		name: event.getter || event.name,
		call_line: event.call_line,
		xpath: event.xpath,
	});
}

function handleExitGetters(event, state) {
	const { framesStack, gettersStack, aaPath, aaFormulas } = state;

	const idxStack = gettersStack.lastIndexOf(event.aa);
	if (idxStack !== -1) gettersStack.splice(idxStack, 1);

	state.lastGettersAA = gettersStack.at(-1);
	removeLastFrameByType(framesStack, FRAME_TYPES.GETTER, event.aa);

	const idx = aaPath.lastIndexOf(event.aa);
	if (idx > 0) {
		state.ownerAA = aaPath[idx - 1];
	} else if (aaPath.length) {
		state.ownerAA = aaPath[0];
	} else {
		state.ownerAA = state.lastAA;
	}

	if (state.ownerAA && aaFormulas.has(state.ownerAA)) {
		const formulasSet = aaFormulas.get(state.ownerAA);
		const firstFormula = [...formulasSet][0];
		if (firstFormula) state.ownerFormula = firstFormula;
	}
}

const TRACE_HANDLERS = {
	[TRACE_EVENTS.ENTER_FUNC]: handleEnterFunc,
	[TRACE_EVENTS.EXIT_FUNC]: handleExitFunc,
	[TRACE_EVENTS.ENTER_AA]: handleEnterAA,
	[TRACE_EVENTS.ENTER_GETTERS]: handleEnterGetters,
	[TRACE_EVENTS.EXIT_GETTERS]: handleExitGetters,
};

function processTraceEvent(event, state) {
	TRACE_HANDLERS[event.system]?.(event, state);
}


function selectBestSnapshot(snapshots, criteria) {
	if (!Array.isArray(snapshots) || snapshots.length === 0) return undefined;

	let candidates = snapshots;

	if (criteria?.preferFatal) {
		const fatal = candidates.filter(s => s.isFatal);
		if (fatal.length) candidates = fatal;
	}

	if (criteria?.aa !== undefined) {
		const sameAA = candidates.filter(s => s.aa === criteria.aa);
		if (sameAA.length) candidates = sameAA;
	}

	if (criteria?.xpath !== undefined) {
		const sameXpath = candidates.filter(s => s.xpath === criteria.xpath);
		if (sameXpath.length) candidates = sameXpath;
	}

	return candidates.at(-1);
}

function recordSnapshot(traceLine, traceEvent, state) {
	const { snapshotsByLine, framesStack, funcFormulas, funcFormulaStack } = state;
	if (traceLine === undefined) return;

	let snapFormula = state.ownerFormula || state.lastFormula;
	if (funcFormulaStack.length) {
		snapFormula = funcFormulaStack.at(-1);
	} else if (state.namedFuncAtLastLine && funcFormulas.has(state.namedFuncAtLastLine)) {
		snapFormula = funcFormulas.get(state.namedFuncAtLastLine);
	}

	if (!Array.isArray(snapshotsByLine[traceLine])) {
		snapshotsByLine[traceLine] = [];
	}

	const snapshot = {
		gettersAA: state.gettersAAAtLastLine,
		formula: snapFormula,
		frames: framesStack.slice(),
		aa: traceEvent?.aa,
		xpath: traceEvent?.xpath,
		isFatal: traceEvent?.system === 'fatal error',
	};

	const list = snapshotsByLine[traceLine];
	const last = list.at(-1);
	const lastTop = last?.frames?.at(-1);
	const snapTop = snapshot.frames.at(-1);
	const isSameTop = !!lastTop && !!snapTop && lastTop.type === snapTop.type && lastTop.name === snapTop.name && lastTop.aa === snapTop.aa;
	const isSame = last && last.formula === snapshot.formula && isSameTop && last.isFatal === snapshot.isFatal;
	if (!isSame) list.push(snapshot);
}

function processTraceEvents(trace, state) {
	for (const traceEvent of trace) {
		processTraceEvent(traceEvent, state);
		if (traceEvent.line !== undefined) {
			if (traceEvent.system === 'fatal error') {
				state.fatalError = { line: traceEvent.line, aa: traceEvent.aa, xpath: traceEvent.xpath };
			}
			state.lastTraceLine = traceEvent.line;
			state.gettersAAAtLastLine = state.lastGettersAA;
			state.namedFuncAtLastLine = state.lastNamedFunc;
			recordSnapshot(state.lastTraceLine, traceEvent, state);
		}
	}
}

function resolveErrorLine(errJson, state) {
	let line = errJson?.context?.arr?.line;
	const allLinesFromArr = Array.from(collectLinesFromArr(errJson?.context?.arr)).sort((a, b) => a - b);

	if (errJson.error === 'return value missing') {
		state.dontShowFormat = true;
		const actualContext = errJson.context?.arr?.[1]?.at(-1);
		if (actualContext) {
			line = actualContext.line;
			errJson.context = { arr: actualContext };
		}
	}

	if (line === undefined) line = state.lastTraceLine;

	return { line, allLinesFromArr };
}

function resolveTargetFormula(line, state) {
	const { snapshotsByLine, gettersAA, aaFormulas, lastFormula, targetSnapshot } = state;

	let effectiveFormula = targetSnapshot?.formula || lastFormula;
	if (!effectiveFormula && snapshotsByLine?.[line]) {
		effectiveFormula = selectBestSnapshot(snapshotsByLine[line])?.formula;
	}

	if (!aaFormulas || line === undefined) return effectiveFormula;

	if (hasLineInFormula(effectiveFormula, line)) return effectiveFormula;

	if (gettersAA && aaFormulas.has(gettersAA)) {
		const formulasSet = aaFormulas.get(gettersAA);
		const formulas = Array.isArray(formulasSet) ? formulasSet : Array.from(formulasSet);
		const found = pickBestFormulaForLine(formulas, line, effectiveFormula);
		if (hasLineInFormula(found, line)) return found;
	}

	for (const [, formulasSet] of aaFormulas) {
		const formulas = Array.isArray(formulasSet) ? formulasSet : Array.from(formulasSet);
		const found = formulas.find(f => hasLineInFormula(f, line));
		if (found) return found;
	}

	return undefined;
}

function createInitialState() {
	return {
		aaPath: [],
		getters: new Map(),
		gettersStack: [],
		aaFormulas: new Map(),
		lastAA: '',
		lastFormula: '',
		lastTraceLine: undefined,
		dontShowFormat: false,
		lastGettersAA: undefined,
		gettersAAAtLastLine: undefined,
		snapshotsByLine: Object.create(null),
		lastNamedFunc: undefined,
		namedFuncAtLastLine: undefined,
		ownerAA: undefined,
		ownerFormula: undefined,
		fatalError: undefined,
		funcFormulas: new Map(),
		funcFormulaStack: [],
		framesStack: [],
	};
}

function buildContext(errJson) {
	const state = createInitialState();
	const trace = Array.isArray(errJson.trace) ? errJson.trace : [];

	processTraceEvents(trace, state);

	const { line, allLinesFromArr } = resolveErrorLine(errJson, state);
	const desired = state.fatalError && state.fatalError.line === line
		? { ...state.fatalError, preferFatal: true }
		: { aa: state.lastAA, xpath: errJson?.xpath };
	const targetSnap = selectBestSnapshot(state.snapshotsByLine[line], desired);
	const gettersAAAtTarget = targetSnap?.gettersAA || state.gettersAAAtLastLine;

	let lastFormulaAtTarget = resolveTargetFormula(line, {
		...state,
		gettersAA: gettersAAAtTarget,
		targetSnapshot: targetSnap,
	});

	const getterFormula = gettersAAAtTarget && state.getters.get(gettersAAAtTarget);
	if (getterFormula && hasLineInFormula(getterFormula, line)) {
		lastFormulaAtTarget = getterFormula;
	}

	return {
		lastFormula: lastFormulaAtTarget,
		line,
		allLinesFromArr,
		dontShowFormat: state.dontShowFormat,
		gettersAA: gettersAAAtTarget,
		snapshotsByLine: state.snapshotsByLine,
		aaFormulas: state.aaFormulas,
		targetSnapshot: targetSnap,
		fatalError: state.fatalError,
	};
}

function processNestedError(nestedError, line) {
	const { formattedContext } = nestedError;
	const codeLines = Array.isArray(nestedError.codeLines) ? nestedError.codeLines : undefined;
	const traceLine = codeLines?.[0]?.lineNumber ?? line;

	return { formattedContext, codeLines, traceLine };
}

function buildCodeLines(ctx) {
	const { allLinesFromArr, line, lastFormula, snapshotsByLine, gettersAA, aaFormulas, targetSnapshot } = ctx;

	const effectiveFormula = resolveTargetFormula(line, {
		snapshotsByLine,
		gettersAA,
		aaFormulas,
		lastFormula,
		targetSnapshot,
	});

	const hasLines = allLinesFromArr.length > 0;
	const hasLine = line !== undefined;
	const linesToExtract = hasLines ? allLinesFromArr : (hasLine ? [line] : []);

	return linesToExtract.map(lineNum => {
		const formula = getFormulaByLine(effectiveFormula, lineNum);
		return { lineNumber: lineNum, formula };
	});
}

function extractFramesForTrace(snapshotsByLine, traceLine, criteria) {
	const snapshots = snapshotsByLine?.[traceLine];
	const snapshot = selectBestSnapshot(snapshots, criteria);
	return Array.isArray(snapshot?.frames) ? snapshot.frames : undefined;
}

function clearContextForSpecialOps(result, errJson) {
	let arr = errJson?.context?.arr;
	if (!arr) return;

	if (!Array.isArray(arr) && Array.isArray(arr.value)) {
		arr = arr.value;
	}

	if (Array.isArray(arr) && (arr[0] === SPECIAL_OPS.BOUNCE || arr[0] === SPECIAL_OPS.REQUIRE)) {
		result.formattedContext = '';
	}
}

function formatError(errJson) {
	const ctx = buildContext(errJson);
	const { line, dontShowFormat, snapshotsByLine, fatalError } = ctx;

	const message = getErrorMessage(errJson.error);
	const nestedError = typeof errJson?.error === 'object' ? errJson.error : null;
	const hasNested = nestedError && (Array.isArray(nestedError.codeLines) || nestedError.formattedContext !== undefined);

	let formattedContext;
	let codeLines;
	let traceLine = line;

	if (hasNested) {
		const nestedErrorResult = processNestedError(nestedError, line);
		formattedContext = nestedErrorResult.formattedContext;
		codeLines = nestedErrorResult.codeLines;
		traceLine = nestedErrorResult.traceLine;
	} else {
		formattedContext = dontShowFormat ? undefined : formatErrorContext(errJson.context);
		codeLines = buildCodeLines(ctx);
	}

	const result = { message, formattedContext, codeLines };
	clearContextForSpecialOps(result, errJson);

	const traceCriteria = fatalError && fatalError.line === traceLine
		? { ...fatalError, preferFatal: true }
		: { aa: undefined, xpath: undefined };
	const framesForTrace = extractFramesForTrace(snapshotsByLine, traceLine, traceCriteria);
	if (framesForTrace?.length) {
		result.trace = buildTraceFromFrames(framesForTrace, traceLine);
	}

	return result;
}

module.exports = formatError;
