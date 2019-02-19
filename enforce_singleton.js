/*jslint node: true */
"use strict";

if (global._bOcoreLoaded)
	throw Error("Looks like you are loading multiple copies of ocore, which is not supported.\nRunning 'npm dedupe' might help.");

global._bOcoreLoaded = true;
