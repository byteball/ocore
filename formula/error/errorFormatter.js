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
	return lines[line - 1] || formula;
}

function hasLineInFormula(formula, line) {
	if (!formula || line === undefined || line <= 0) return false;
	return line <= formula.split('\n').length;
}

function pickBestFormulaForLine(formulas, line, currentFormula) {
	if (!Array.isArray(formulas) || !formulas.length) {
		return currentFormula;
	}

	const withLine = formulas.filter(f => hasLineInFormula(f, line));
	const candidates = withLine.length ? withLine : formulas;

	const best = candidates.includes(currentFormula) ? currentFormula : candidates[0];
	return best || currentFormula;
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
	const { left = {}, right = {}, op = '' } = context;

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

function buildAAFrame(frame, nextFrame, traceLine, defaultXpath) {
	const aaFrame = { type: FRAME_TYPES.AA, aa: frame.aa };

	aaFrame.xpath = frame.xpath ?? defaultXpath;
	aaFrame.line = nextFrame?.call_line ?? traceLine;

	if (aaFrame.xpath === undefined) delete aaFrame.xpath;
	if (aaFrame.line === undefined) delete aaFrame.line;

	return aaFrame;
}

function buildGetterFrame(frame, getterFuncName, functionsAfterGetter, traceLine) {
	const getterFrame = {
		type: FRAME_TYPES.GETTER,
		aa: frame.aa,
		xpath: '/getters',
		name: getterFuncName ?? frame.name,
	};

	if (functionsAfterGetter.length > 1) {
		getterFrame.line = functionsAfterGetter[1]?.call_line ?? traceLine;
	} else {
		getterFrame.line = traceLine ?? frame.call_line;
	}

	if (getterFrame.name === undefined) delete getterFrame.name;
	if (getterFrame.line === undefined) delete getterFrame.line;

	return getterFrame;
}

function buildFunctionFrame(frame, nextFrame, traceLine) {
	const funcFrame = {
		type: FRAME_TYPES.FUNCTION,
		name: frame.name || '<anonymous>',
	};

	if (frame.def_xpath !== undefined) {
		funcFrame.xpath = frame.def_xpath;
	}

	const nextIsFunc = nextFrame?.type === FRAME_TYPES.FUNCTION;
	const hasNextCallLine = nextIsFunc && nextFrame.call_line !== undefined;
	funcFrame.line = hasNextCallLine ? nextFrame.call_line : traceLine;

	if (funcFrame.line === undefined) delete funcFrame.line;

	return funcFrame;
}

function buildTraceFromFrames(frames, traceLine, defaultXpath) {
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
				result.push(buildAAFrame(frame, frames[i + 1], traceLine, defaultXpath));
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
						xpath: '/getters',
					};
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

	state.inFunc = true;
	if (event.name) state.lastNamedFunc = event.name;
	if (event.name && event.formula) funcFormulas.set(event.name, event.formula);
	if (event.formula) funcFormulaStack.push(event.formula);

	framesStack.push({
		type: FRAME_TYPES.FUNCTION,
		name: event.name || '<anonymous>',
		aa: event.aa,
		def_xpath: event.xpath,
		call_line: event.call_line,
		call_xpath: event.call_xpath,
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
	state.inFunc = false;
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
		caller_aa: event.caller_aa,
		call_line: event.call_line,
		call_xpath: event.call_xpath,
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

function recordSnapshot(traceLine, state) {
	const { snapshotsByLine, framesStack, funcFormulas, funcFormulaStack } = state;

	let snapFormula = state.ownerFormula || state.lastFormula;
	
	if (funcFormulaStack.length) {
		snapFormula = funcFormulaStack.at(-1);
	} else if (state.namedFuncAtLastLine && funcFormulas.has(state.namedFuncAtLastLine)) {
		snapFormula = funcFormulas.get(state.namedFuncAtLastLine);
	}

	snapshotsByLine[traceLine] = {
		gettersAA: state.gettersAAAtLastLine,
		formula: snapFormula,
		frames: framesStack.slice(),
	};
}

function processTraceEvents(trace, state) {
	for (const traceEvent of trace) {
		if (traceEvent.line !== undefined) {
			state.lastTraceLine = traceEvent.line;
			state.gettersAAAtLastLine = state.lastGettersAA;
			state.namedFuncAtLastLine = state.lastNamedFunc;
			recordSnapshot(state.lastTraceLine, state);
		}
		processTraceEvent(traceEvent, state);
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
	if (state.inFunc) state.lastFormula = state.getters.get(state.lastAA) || state.lastFormula;

	return { line, allLinesFromArr };
}

function resolveTargetFormula(line, state) {
	const { snapshotsByLine, aaPath, gettersAA, aaFormulas, lastFormula } = state;

	let effectiveFormula = snapshotsByLine?.[line]?.formula || lastFormula;

	if (aaFormulas && line !== undefined) {
		if (hasLineInFormula(effectiveFormula, line)) {
			return effectiveFormula;
		}

		const targetAA = gettersAA || aaPath?.[0];
		if (targetAA && aaFormulas.has(targetAA)) {
			const formulasSet = aaFormulas.get(targetAA);
			const formulas = Array.isArray(formulasSet) ? formulasSet : Array.from(formulasSet);
			const found = pickBestFormulaForLine(formulas, line, effectiveFormula);
			if (hasLineInFormula(found, line)) {
				return found;
			}
		}

		for (const [, formulasSet] of aaFormulas) {
			const formulas = Array.isArray(formulasSet) ? formulasSet : Array.from(formulasSet);
			const found = formulas.find(f => hasLineInFormula(f, line));
			if (found) {
				return found;
			}
		}
	}

	return effectiveFormula;
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
		inFunc: false,
		dontShowFormat: false,
		lastGettersAA: undefined,
		gettersAAAtLastLine: undefined,
		snapshotsByLine: Object.create(null),
		lastNamedFunc: undefined,
		namedFuncAtLastLine: undefined,
		ownerAA: undefined,
		ownerFormula: undefined,
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
	const targetSnap = state.snapshotsByLine[line];
	const gettersAAAtTarget = targetSnap?.gettersAA || state.gettersAAAtLastLine;

	let lastFormulaAtTarget = resolveTargetFormula(line, {
		...state,
		gettersAA: gettersAAAtTarget,
	});

	const getterFormula = gettersAAAtTarget && state.getters.get(gettersAAAtTarget);
	if (getterFormula && hasLineInFormula(getterFormula, line)) {
		lastFormulaAtTarget = getterFormula;
	}

	return {
		aaPath: state.aaPath,
		lastFormula: lastFormulaAtTarget,
		line,
		allLinesFromArr,
		dontShowFormat: state.dontShowFormat,
		gettersAA: gettersAAAtTarget,
		snapshotsByLine: state.snapshotsByLine,
		aaFormulas: state.aaFormulas,
	};
}

function processNestedError(nestedError, line) {
	const { formattedContext } = nestedError;
	const codeLines = Array.isArray(nestedError.codeLines) ? nestedError.codeLines : undefined;
	const traceLine = codeLines?.[0]?.lineNumber ?? line;

	return { formattedContext, codeLines, traceLine };
}

function buildCodeLines(ctx) {
	const { allLinesFromArr, line, lastFormula, snapshotsByLine, aaPath, gettersAA, aaFormulas } = ctx;

	const formulaState = {
		snapshotsByLine,
		aaPath,
		gettersAA,
		aaFormulas,
		lastFormula,
	};
	const effectiveFormula = resolveTargetFormula(line, formulaState);

	const hasLines = allLinesFromArr.length > 0;
	const hasLine = line !== undefined;
	const linesToExtract = hasLines ? allLinesFromArr : (hasLine ? [line] : []);

	return linesToExtract.map(lineNum => {
		const formula = getFormulaByLine(effectiveFormula, lineNum);
		return { lineNumber: lineNum, formula };
	});
}

function extractFramesForTrace(snapshotsByLine, traceLine) {
	const snapshot = snapshotsByLine?.[traceLine];
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
	const { line, dontShowFormat, snapshotsByLine } = ctx;

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

	const framesForTrace = extractFramesForTrace(snapshotsByLine, traceLine);
	if (framesForTrace?.length) {
		result.trace = buildTraceFromFrames(framesForTrace, traceLine, errJson.xpath);
	}

	return result;
}

module.exports = formatError;
