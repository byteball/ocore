/*jslint node: true */
"use strict";
require('./enforce_singleton.js');

var EventEmitter = require('events').EventEmitter;

module.exports = new EventEmitter();
