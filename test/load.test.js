/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019 Joyent, Inc.
 */

var fash = require('../lib');
var Logger = require('bunyan');
var os = require('os');
var path = require('path');
var restify = require('restify');
var verror = require('verror');

var LOG = new Logger({
    name: 'fash-load-test',
    level: process.env.LOG_LEVEL || 'warn'
});

var LVL_CFG = {
    createIfMissing: true,
    errorIfExists: true,
    compression: false,
    cacheSize: 800 * 1024 * 1024,
    keyEncoding: 'utf8',
    valueEncoding: 'json'
};

var DB_LOCATION = process.env.DB_LOCATION || path.join(os.tmpdir(), 'fash-db');

var RING = fash.load({
    log: LOG,
    backend: fash.BACKEND.LEVEL_DB,
    location: DB_LOCATION,
    leveldbCfg: LVL_CFG
}, function (err) {
    if (err) {
        throw new verror.VError(err, 'unable to load ring from disk');
    }
});

var server = restify.createServer();
server.use(restify.plugins.bodyParser());
server.post('/hash', function (req, res, next) {
    RING.getNode(req.params.key, function (err, val) {
        if (err) {
            LOG.error({err: err, key: req.params.key}, 'unable to hash key');
            return next(err);
        } else {
            LOG.info({key: req.params.key, val: val}, 'finished hash');
            res.send();
            return next();
        }
    });
});

server.listen(12345, function () {
    console.log('server started.');
});
