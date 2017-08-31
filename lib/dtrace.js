/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var PROBES = {
    'new-start': [],
    // err, method
    'new-done': ['char *', 'char *'],
    // key
    'getnode-start': ['char *'],
    // key, value, pnode, vnode, data
    'getnode-done': ['char *', 'char *', 'char *', 'char *', 'char *'],
    //
    'serialize-start': [],
    // err
    'serialize-done': ['char *'],
    // vnode, data
    'adddata-start': ['int', 'char *'],
    // err, vnode, data
    'adddata-done': ['char *', 'int', 'char *'],
    // newPnode, vnode
    'remapvnode-start': ['char *', 'int'],
    // err, newPnode, oldPnode, vnode
    'remapvnode-done': ['char *', 'char *', 'char *', 'int'],
    // pnode
    'removepnode-start': ['char *'],
    // err, pnode
    'removepnode-done': ['char *', 'char *']
};
var PROVIDER;


///--- API

module.exports = function exportStaticProvider() {
    if (!PROVIDER) {
        try {
            var dtrace = require('dtrace-provider');
            PROVIDER = dtrace.createDTraceProvider('node-fash');
        } catch (e) {
            PROVIDER = {
                fire: function () {},
                enable: function () {},
                addProbe: function () {
                    var p = {
                        fire: function () {}
                    };
                    return (p);
                },
                removeProbe: function () {},
                disable: function () {}
            };
        }

        PROVIDER._fash_probes = {};

        Object.keys(PROBES).forEach(function (p) {
            var args = PROBES[p].splice(0);
            args.unshift(p);

            var probe = PROVIDER.addProbe.apply(PROVIDER, args);
            PROVIDER._fash_probes[p] = probe;
        });

        PROVIDER.enable();
    }

    return (PROVIDER);
}();
