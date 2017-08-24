/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var assert = require('assert-plus');
var bignum = require('bignum');
var bunyan = require('bunyan');
var crypto = require('crypto');
var jsprim = require('jsprim');
var util = require('util');
var sprintf = util.format;
var verror = require('verror');

/*
 * Find the hashspace a specific vnode maps to by multiplying the vnode by
 * hashspaceInterval.
 * @param {Object} options The options object.
 * @param {String} options.vnode The vnode.
 * @param {Bignum} options.vnodeHashInterval The vnode hash interval.
 * @return {String} the hex representation of the beginning of the hashspace
 * the vnode maps to.
 */
function _findHashspace(options) {
    assert.object(options, 'options');
    assert.object(options.log, 'options.log');
    assert.object(options.vnodeHashInterval, 'options.vnodeHashinterval');
    assert.number(options.vnode, 'options.vnode');

    var log = options.log;
    var vnodeHashInterval = options.vnodeHashInterval;
    var vnode = options.vnode;

    log.debug({
        vnode: vnode,
        interval: vnodeHashInterval
    }, 'fash.findHashspace: entering');

    var hashspace = vnodeHashInterval.mul(vnode);

    log.debug({
        vnode: vnode,
        interval: vnodeHashInterval,
        hashspace: hashspace
    }, 'ConsistentHash.findHashspace: exiting');

    return hashspace.toString(16);
}

/*
 * Simply divide the hash by the number of vnodes to find which vnode maps to
 * this hash.
 * @param {Object} options The options object.
 * @param {String} options.hash the value of the hash string in hex.
 * @param {Bignum} options.vnodeHashInterval The vnode hash interval.
 * @return {Integer} the vnode.
 */
function _findVnode(options) {
    assert.object(options, 'options');
    assert.object(options.vnodeHashInterval, 'options.vnodeHashinterval');
    assert.string(options.hash, 'options.hash');
    return parseInt(bignum(options.hash, 16).
        div(options.vnodeHashInterval), 10);
}

/*
 * Parse vnode array elements to make sure they are valid integers.
 * Creates a new array.
 * @param {String} vnodes The vnodes, separated by spaces or commas.
 * @return {Array} newVnodeArray The numeric (parsed) array of vnodes.
 */
function _parseIntArray(vnodes) {
    assert.string(vnodes, 'vnodes');

    var vnodeArray = vnodes.split(/[, ]+/);
    var newVnodeArray = [];

    for (var i = 0; i < vnodeArray.length; i++) {
        var parsedElement = jsprim.parseInteger(vnodeArray[i]);
        var parsedElementIsError = parsedElement instanceof Error;
        if (parsedElementIsError) {
            continue;
        }

        vnodeArray[i] = parsedElement;
        if (!vnodeArray[i] || vnodeArray[i] === '' || vnodeArray[i] === ',') {
            continue;
        }
        newVnodeArray.push(vnodeArray[i]);
    }
    return newVnodeArray;
}

/*
 * exports
 */
module.exports = {
    findHashspace: _findHashspace,
    findVnode: _findVnode,
    parseIntArray: _parseIntArray
};
