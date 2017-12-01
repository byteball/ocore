/*jslint node: true */
'use strict';

/*
Used for debugging long sequences of calls not captured by stack traces.
Should be included with bug reports.
*/

var MAX_LENGTH = 200;
var arrBreadcrumbs = [];

function add(breadcrumb){
	if (arrBreadcrumbs.length > MAX_LENGTH)
		arrBreadcrumbs.shift(); // forget the oldest breadcrumbs
	arrBreadcrumbs.push(Date().toString() + ': ' + breadcrumb);
	console.log(breadcrumb);
}

function get(){
	return arrBreadcrumbs;
}

exports.add = add;
exports.get = get;
