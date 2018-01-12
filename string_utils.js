/*jslint node: true */
const STRING_JOIN_CHAR = "\x00";

/**
 * Converts the argument into a string by mapping data types to a prefixed string and concatenating all fields together.
 * @param obj the value to be converted into a string
 * @returns {string} the string version of the value
 */
function getSourceString(obj) {
    const arrComponents = [];
    function extractComponents(variable){
        if (variable === null)
            throw Error(`null value in ${JSON.stringify(obj)}`);
        switch (typeof variable){
            case "string":
                arrComponents.push("s", variable);
                break;
            case "number":
                arrComponents.push("n", variable.toString());
                break;
            case "boolean":
                arrComponents.push("b", variable.toString());
                break;
            case "object":
                if (Array.isArray(variable)){
                    if (variable.length === 0)
                        throw Error(`empty array in ${JSON.stringify(obj)}`);
                    arrComponents.push('[');
                    for (let i=0; i<variable.length; i++)
                        extractComponents(variable[i]);
                    arrComponents.push(']');
                }
                else{
                    const keys = Object.keys(variable).sort();
                    if (keys.length === 0)
                        throw Error(`empty object in ${JSON.stringify(obj)}`);
                    keys.forEach(key => {
                        if (typeof variable[key] === "undefined")
                            throw Error(`undefined at ${key} of ${JSON.stringify(obj)}`);
                        arrComponents.push(key);
                        extractComponents(variable[key]);
                    });
                }
                break;
            default:
                throw Error(`hash: unknown type=${typeof variable} of ${variable}, object: ${JSON.stringify(obj)}`);
        }
    }

    extractComponents(obj);
    return arrComponents.join(STRING_JOIN_CHAR);
}

exports.STRING_JOIN_CHAR = STRING_JOIN_CHAR; // for tests
exports.getSourceString = getSourceString;


