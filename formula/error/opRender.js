const functions = require('./functions');

const rawOps = new Set([
    'this_address',
    'timestamp',
    'trigger.address',
    'trigger.initial_address'
]);

module.exports = function renderOp(arr, format = true) {
	if(Array.isArray(arr) && arr.length === 1) {
		arr = arr[0];
	}

	if (!Array.isArray(arr) && arr && Array.isArray(arr.value)) {
		arr = arr.value;
	}

    if (typeof arr === 'boolean') {
        return arr;
    }
	
	if (typeof arr === 'object' && !Array.isArray(arr)) {
		if (!Number.isNaN(Number(arr))) {
			return arr.toString();
		}
	}

    if (typeof arr === 'string') {
        if (!Number.isNaN(Number(arr))) {
            return Number(arr);
        }
        
        if (rawOps.has(arr)) {
            return arr;
        }

        if (format) {
            return `'${arr}'`;
        }
		return arr;
	}

    if (!arr) return '';
    const op = arr[0];

    if (functions.has(op)){
        return op;
    }
    
	switch (op) {
        case '+':
		case '-':
		case '*':
		case '/':
		case '%':
		case '^':
            return '';
		case 'var':
            const value = arr.slice(1).filter(v => v !== null).map(v => `[${renderOp(v)}]`).join('');
			return `var` + value;
		case 'local_var':
			return `$${renderOp(arr[1], false)}`;
		case 'with_selectors':
            const selector = arr.context.typeSelectors['0'];
            if (selector === 'dotSelector') {
                const vars = Array.isArray(arr[2]) ? arr[2].map(v => renderOp(v, false)).join('.') : renderOp(arr[2], false);
                return `${renderOp(arr[1], false)}.${vars}`;
            }

            const vars = Array.isArray(arr[2]) ? arr[2].map(v => `[${renderOp(v)}]`).join('') : renderOp(arr[2], false);
			return `${renderOp(arr[1], false)}${vars}`;

           case 'concat':
		return `${renderOp(arr[1])} || ${renderOp(arr[2])}`;
        case 'local_var_assignment':
		    return `$${arr[1]}`;
        case 'state_var_assignment':
		    return `var[${renderOp(arr[1])}]`;
        case 'response_var_assignment':
		    return `response[${renderOp(arr[1])}] = ${renderOp(arr[2])}`;
        case 'trigger.output':
		    return `trigger.output[[...]]`;
        case 'data_feed':
		    return `data_feed[[...]]`;
        case 'attestation':
		    return 'attestation[[...]]';
        case 'in_data_feed':
            return 'in_data_feed[[...]]';
        case 'asset':
            return 'asset[[...]]';
        case 'definition':
            return 'definition[[...]]';
        case 'balance':
		    return `balance[${renderOp(arr[1])}]`;
        case 'unit':
		    return `unit[${renderOp(arr[1])}]`;
        case 'input':
            return 'input[[...]]';
        case 'output':
            return 'output[[...]]';
        case 'remote_func_call':
		    return `$${renderOp(arr[3], false)}`;
		default:
			console.error('unknown op render', arr);
			return op;
	}

}
