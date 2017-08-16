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
var sprintf = require('util').format;
var verror = require('verror');

module.exports = {
    create: function create(options, callback) {
        assert.object(options, 'options');
        assert.string(options.algorithm, 'options.algorithm');
        options.algorithm = getAlgorithm(options.algorithm);
        assert.number(options.vnodes, 'options.vnodes');
        assert.arrayOfString(options.pnodes, 'options.pnodes');
        assert.string(options.backend, 'options.backend');
        assert.optionalFunc(callback, 'callback');
        assert.optionalObject(options.leveldbCfg, 'options.leveldbCfg');
        var backend = require(options.backend);
        return new backend(options, callback);
    },
    deserialize: function deserialize(options, callback) {
        assert.object(options, 'options');
        assert.string(options.backend, 'options.backend');
        var backend = require(options.backend);
        assert.string(options.topology, 'options.topology');
        options.topology = JSON.parse(options.topology);
        assert.object(options.topology.pnodeToVnodeMap,
                      'options.topology.pnodeToVnodeMap');
        assert.number(options.topology.vnodes, 'options.topology.vnodes');
        assert.object(options.topology.algorithm, 'options.topology.algorithm');
        options.algorithm = options.topology.algorithm;
        options.algorithm.VNODE_HASH_INTERVAL =
            bignum(options.algorithm.VNODE_HASH_INTERVAL, 16);
        assertVersion(options.topology.version);
        assert.optionalObject(options.leveldbCfg, 'options.leveldbCfg');
        assert.optionalFunc(callback, 'callback');
        return new backend(options, callback);
    },
    load: function load(options, callback) {
        assert.object(options, 'options');
        assert.optionalObject(options.leveldbCfg, 'options.leveldbCfg');
        assert.string(options.backend, 'options.backend');
        var backend = require(options.backend);
        assert.string(options.location, 'options.location');
        options.loadFromDb = true;
        return new backend(options, callback);
    },
    ALGORITHMS: {
        SHA256: {
            NAME: 'sha256',
            MAX: 'FFFFFFFF' + 'FFFFFFFF' + 'FFFFFFFF' + 'FFFFFFFF' +
                 'FFFFFFFF' + 'FFFFFFFF' + 'FFFFFFFF' + 'FFFFFFFF'
        },
        SHA1: {
            NAME: 'sha1',
            MAX: 'FFFFFFFF' + 'FFFFFFFF' + 'FFFFFFFF' + 'FFFFFFFF' +
                 'FFFFFFFF'
        },
        MD5: {
            NAME: 'md5',
            MAX: 'FFFFFFFF' + 'FFFFFFFF' + 'FFFFFFFF' + 'FFFFFFFF'
        }
    },
    BACKEND: {
        IN_MEMORY: './backend/in_memory',
        LEVEL_DB: './backend/leveldb'
    },
    VERSION: '2.1.0',
    assertVersion: assertVersion
};

/*
 * disallow newer versions
 */
function assertVersion(version) {
    assert.string(version, 'options.topology.version');
    var FASH_VERSION = module.exports.VERSION.split('.');
    var versionArray = version.split('.');

    var msg = sprintf('version %s is not compatible with current ' +
                      'version %s', version, FASH_VERSION);
    if (versionArray.length > FASH_VERSION.length) {
        throw new verror.VError(msg);
    }
    for (var i = 0; i < FASH_VERSION.length; i++) {
        var fVersion = parseInt(FASH_VERSION[i], 10);
        var v;
        if (versionArray.length > i) {
            v = parseInt(versionArray[i], 10);
        }

        if (fVersion < v) {
            throw new verror.VError(msg);
        } else {
            continue;
        }
    }
}

function getAlgorithm(algo) {
    switch (algo) {
        case 'sha256':
        case 'sha-256':
        case 'SHA256':
        case 'SHA-256':
            return JSON.parse(JSON.stringify(module.exports.ALGORITHMS.SHA256));
        case 'sha1':
        case 'sha-1':
        case 'SHA1':
        case 'SHA-1':
            return JSON.parse(JSON.stringify(module.exports.ALGORITHMS.SHA1));
        case 'md5':
        case 'MD5':
            return JSON.parse(JSON.stringify(module.exports.ALGORITHMS.MD5));
        default:
            throw new verror.VError('algorithm %s is not supported', algo);
    }
}
