/*jslint node: true */
"use strict";

if (global._bByteballCoreLoaded)
	throw Error("Looks like you are loading multiple copies of byteballcore, which is not supported.\nRunning 'npm dedupe' might help.");

global._bByteballCoreLoaded = true;
