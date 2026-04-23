/*jslint node: true */
"use strict";
var fs = require("fs");

/**
 * Remove a test data directory (cross-platform; replaces rm -rf).
 */
function removeTestdataDir(dir) {
	fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Copy a test data tree (cross-platform; replaces cp -r). Requires Node 16.7+.
 */
function copyTestdataDir(src, dest) {
	fs.cpSync(src, dest, { recursive: true });
}

module.exports = {
	removeTestdataDir: removeTestdataDir,
	copyTestdataDir: copyTestdataDir
};
