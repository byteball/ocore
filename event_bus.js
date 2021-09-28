/*jslint node: true */
"use strict";
require('./enforce_singleton.js');

var EventEmitter = require('events').EventEmitter;

var eventEmitter = new EventEmitter();
eventEmitter.setMaxListeners(40);

module.exports = eventEmitter;
