#!/usr/bin/env node

/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2017, Joyent, Inc.
 */

var bunyan = require('bunyan');
var cmdln = require('cmdln');
var common = require('../lib/common');
var fash = require('../lib/index');
var fs = require('fs');
var sprintf = require('util').format;
var util = require('util');
var vasync = require('vasync');
var verror = require('verror');

var Cmdln = cmdln.Cmdln;
var BACKENDS = {
    LEVEL_DB: 'leveldb',
    IN_MEMORY: 'memory'
};

function Fash() {
    Cmdln.call(this, {
        name: 'fash',
        desc: 'fash cmdline tool',
        // Custom options. By default you get -h/--help.
        options: [
            {names: ['help', 'h'], type: 'bool',
                help: 'Print help and exit.'},
                {name: 'version', type: 'bool',
                    help: 'Print version and exit.'}
        ]
    });

    this.log = new bunyan({
        name: 'fash',
        level: process.env.LOG_LEVEL || 'warn'
    });
}
util.inherits(Fash, Cmdln);

Fash.prototype.do_create = function (subcmd, opts, args, callback) {
    var self = this;

    if (opts.help || args.length !== 0 || !opts.v || !opts.p) {
        this.do_help('help', {}, [subcmd], function (err) {
            return callback(err ? err : true);
        });
    }

    var pnodes = opts.p.split(/[, ]+/);
    var pnodeArray = [];

    for (var i = 0; i < pnodes.length; i++) {
        if (!pnodes[i] || pnodes[i] === '' || pnodes[i] === ',') {
            continue;
        }
        pnodeArray.push(pnodes[i]);
    }

    switch (opts.b) {
        case BACKENDS.IN_MEMORY:
            opts.b = fash.BACKEND.IN_MEMORY;
        break;
        case BACKENDS.LEVEL_DB:
            opts.b = fash.BACKEND.LEVEL_DB;
        break;
        default:
            opts.b = fash.BACKEND.IN_MEMORY;
        break;
    }
    fash.create({
        log: self.log,
        algorithm: opts.a || 'sha256',
        pnodes: pnodeArray,
        vnodes: opts.v,
        backend: opts.b,
        location: opts.l
    }, function (err, chash) {
        if (err) {
            console.error(err);
            return callback(err);
        }

        if (opts.o) {
            chash.serialize(function (_err, sh) {
                if (_err) {
                    console.error(_err);
                    return callback(_err);
                }
                if (opts.o) {
                    console.log(sh);
                }
                return (callback());
            });
        } else {
            return (callback());
        }
    });

    return (undefined);
};
Fash.prototype.do_create.options = [ {
    names: [ 'v', 'vnode' ],
    type: 'number',
    help: 'number of vnodes'
}, {
    names: [ 'p', 'pnode' ],
    type: 'string',
    help: 'physical node names'
}, {
    names: [ 'a', 'algorithm' ],
    type: 'string',
    help: 'the algorithm to use'
}, {
    names: [ 'b', 'backend' ],
    type: 'string',
    help: 'the backend to use one of (memory, leveldb)'
}, {
    names: [ 'l', 'location' ],
    type: 'string',
    help: 'the (optional) location to store the topology --' +
          ' only applies to the leveldb backend'
}, {
    names: [ 'o', 'output' ],
    type: 'bool',
    help: 'serialize and print out the resulting hash to stdout'
}];
Fash.prototype.do_create.help = (
    'create a consistent hash ring.\n'
    + '\n'
    + 'usage:\n'
    + '     fash create [options] \n'
    + '\n'
    + '{{options}}'
);

Fash.prototype.do_deserialize_ring = function (subcmd, opts, args, callback) {
    var self = this;

    if (opts.help || args.length !== 0 || !opts.l) {
        this.do_help('help', {}, [subcmd], function (err) {
            return callback(err ? err : true);
        });
    }

    var hashOptions = {
        log: self.log,
        backend: fash.BACKEND.LEVEL_DB,
        location: opts.l
    };

    vasync.pipeline({funcs: [
        function prepInput(_, cb) {
            if (opts.f) {
                hashOptions.topology = fs.readFileSync(opts.f, 'utf8');
                return cb();
            } else { // read from stdin
                hashOptions.topology = '';
                process.stdin.resume();
                process.stdin.setEncoding('utf8');

                process.stdin.on('data', function (chunk) {
                    hashOptions.topology += chunk;
                });

                process.stdin.on('end', function () {
                    return cb();
                });
            }
            return (undefined);
        },
        function loadRing(_, cb) {
            fash.deserialize(hashOptions, cb);
        }
    ], arg: {}}, function (err) {
        if (err) {
            console.error(err);
        }
        return callback(err);
    });
    return (undefined);
};
Fash.prototype.do_deserialize_ring.options = [ {
    names: [ 'l', 'location' ],
    type: 'string',
    help: 'the level db path where the ring is to be stored'
}, {
    names: [ 'f', 'file' ],
    type: 'string',
    help: 'the optional location of the serialized topology'
}];
Fash.prototype.do_deserialize_ring.help = (
    'load a hash ring into leveldb. Accepts input over stdin or via a file.\n'
    + '\n'
    + 'usage:\n'
    + '     fash deserialize-ring [options] \n'
    + '     cat /tmp/example_ring.json | fash deserialize-ring [options] \n'
    + '\n'
    + '{{options}}'
);

Fash.prototype.do_add_data = function (subcmd, opts, args, callback) {
    var self = this;

    if (opts.help || args.length !== 0 || !opts.v || !opts.b) {
        this.do_help('help', {}, [subcmd], function (err) {
            return callback(err ? err : true);
        });
    }

    if (opts.b !== BACKENDS.IN_MEMORY && opts.b !== BACKENDS.LEVEL_DB) {
        console.error(sprintf('backend must be one of %s or %s',
                              BACKENDS.IN_MEMORY,
                              BACKENDS.LEVEL_DB));
        return callback(new Error());
    }

    var hashOptions = {
        log: self.log
    };
    var hash;
    var constructor;

    vasync.pipeline({funcs: [
        function prepInput(_, cb) {
            if (opts.b === BACKENDS.IN_MEMORY) {
                hashOptions.backend = fash.BACKEND.IN_MEMORY;
                constructor = fash.deserialize;
                if (opts.l) {
                    hashOptions.topology = fs.readFileSync(opts.l, 'utf8');
                    return cb();
                } else {
                    hashOptions.topology = '';
                    process.stdin.resume();
                    process.stdin.setEncoding('utf8');

                    process.stdin.on('data', function (chunk) {
                        hashOptions.topology += chunk;
                    });

                    process.stdin.on('end', function () {
                        return cb();
                    });
                }
            } else if (opts.b === BACKENDS.LEVEL_DB) {
                hashOptions.backend = fash.BACKEND.LEVEL_DB;
                constructor = fash.load;
                if (!opts.l) {
                    console.error('leveldb backend requires a location');
                    this.do_help('help', {}, [subcmd], function (err) {
                        return callback(err ? err : true);
                    });
                } else {
                    hashOptions.location = opts.l;
                    return cb();
                }
            }
            return (undefined);
        },
        function loadRing(_, cb) {
            hash = constructor(hashOptions, cb);
        },
        function getVnodeArray(_, cb) {
            var vnodes = common.parseIntArray(opts.v);
            _.vnodes = vnodes;
            return cb();
        },
        function addData(_, cb) {
            var count = 0;
            hash.addData(parseInt(_.vnodes[count], 10), opts.d, addDataCb);
            function addDataCb(err) {
                if (err) {
                    return cb(err);
                }
                if (++count === _.vnodes.length) {
                    return cb();
                } else {
                    hash.addData(parseInt(_.vnodes[count], 10),
                                 opts.d, addDataCb);
                }
                return (undefined);
            }
            return (undefined);
        },
        function printRing(_, cb) {
            if (opts.o) {
                hash.serialize(function (_err, sh) {
                    if (_err) {
                        return cb(new verror.VError(_err,
                                                    'unable to print hash'));
                    }
                    if (opts.o) {
                        console.log(sh);
                    }
                    return cb();
                });
            } else {
                return cb();
            }
        }
    ], arg: {}}, function (err) {
        if (err) {
            console.error(err);
        }
        return callback(err);
    });
    return (undefined);
};

Fash.prototype.do_add_data.options = [ {
    names: [ 'v', 'vnode' ],
    type: 'string',
    help: 'the vnode(s) to add the data to'
}, {
    names: [ 'd', 'data' ],
    type: 'string',
    help: 'the data to add, optional, if empty, removes data from the node'
}, {
    names: [ 'b', 'backend' ],
    type: 'string',
    help: 'the backend to use'
}, {
    names: [ 'l', 'location' ],
    type: 'string',
    help: 'the location of the topology, if using the in_memory backend, \n' +
          'this is the location of the serialized ring on disk, if using \n ' +
          'the leveldb backend, this is the path to the leveldb on disk.'
}, {
    names: [ 'o', 'output' ],
    type: 'bool',
    help: 'serialize and print out the resulting hash to stdout \n' +
          'WARNING: may consume a large quantity of memory.'
}];
Fash.prototype.do_add_data.help = (
    'add data to a vnode.\n'
    + '\n'
    + 'usage:\n'
    + '     fash add-data [options] \n'
    + '\n'
    + '{{options}}'
);

Fash.prototype.do_remap_vnode = function (subcmd, opts, args, callback) {
    var self = this;

    if (opts.help || args.length !== 0 || !opts.v || !opts.p || !opts.b) {
        this.do_help('help', {}, [subcmd], function (err) {
            return callback(err ? err : true);
        });
    }

    if (opts.b !== BACKENDS.IN_MEMORY && opts.b !== BACKENDS.LEVEL_DB) {
        console.error(sprintf('backend must be one of %s or %s',
                              BACKENDS.IN_MEMORY,
                              BACKENDS.LEVEL_DB));
        return callback(new Error());
    }

    var hashOptions = {
        log: self.log
    };
    var hash;
    var constructor;

    vasync.pipeline({funcs: [
        function prepInput(_, cb) {
            if (opts.b === BACKENDS.IN_MEMORY) {
                hashOptions.backend = fash.BACKEND.IN_MEMORY;
                constructor = fash.deserialize;
                if (opts.l) {
                    hashOptions.topology = fs.readFileSync(opts.l, 'utf8');
                    return cb();
                } else {
                    hashOptions.topology = '';
                    process.stdin.resume();
                    process.stdin.setEncoding('utf8');

                    process.stdin.on('data', function (chunk) {
                        hashOptions.topology += chunk;
                    });

                    process.stdin.on('end', function () {
                        return cb();
                    });
                }
            } else if (opts.b === BACKENDS.LEVEL_DB) {
                hashOptions.backend = fash.BACKEND.LEVEL_DB;
                constructor = fash.load;
                if (!opts.l) {
                    console.error('leveldb backend requires a location');
                    this.do_help('help', {}, [subcmd], function (err) {
                        return callback(err ? err : true);
                    });
                } else {
                    hashOptions.location = opts.l;
                    return cb();
                }
            }
            return (undefined);
        },
        function loadRing(_, cb) {
            hash = constructor(hashOptions, cb);
        },
        function getVnodeArray(_, cb) {
            var vnodes = common.parseIntArray(opts.v);
            _.vnodes = vnodes;
            return cb();
        },
        function remap(_, cb) {
            var count = 0;
            hash.remapVnode(opts.p, parseInt(_.vnodes[count], 10), remapCb);
            function remapCb(err) {
                if (err) {
                    return cb(err);
                }
                if (++count === _.vnodes.length) {
                    return cb();
                } else {
                    hash.remapVnode(opts.p, parseInt(_.vnodes[count], 10),
                                    remapCb);
                }
                return (undefined);
            }
        },
        function printRing(_, cb) {
            if (opts.o) {
                hash.serialize(function (_err, sh) {
                    if (_err) {
                        return cb(new verror.VError(_err,
                                                    'unable to print hash'));
                    }
                    if (opts.o) {
                        console.log(sh);
                    }
                    return cb();
                });
            } else {
                return cb();
            }
        }
    ], arg: {}}, function (err) {
        if (err) {
            console.error(err);
        }
        return callback(err);
    });
    return (undefined);
};
Fash.prototype.do_remap_vnode.options = [ {
    names: [ 'v', 'vnode' ],
    type: 'string',
    help: 'the vnode(s) to remap'
}, {
    names: [ 'b', 'backend' ],
    type: 'string',
    help: 'the backend to use'
}, {
    names: [ 'p', 'pnode' ],
    type: 'string',
    help: 'the pnode to remap the vnode(s) to'
}, {
    names: [ 'l', 'location' ],
    type: 'string',
    help: 'the location of the topology, if using the in_memory backend, \n' +
          'this is the location of the serialized ring on disk, if using \n ' +
          'the leveldb backend, this is the path to the leveldb on disk.'
}, {
    names: [ 'o', 'output' ],
    type: 'bool',
    help: 'serialize and print out the resulting hash to stdout \n' +
          'WARNING: may consume a large quantity of memory.'
}];
Fash.prototype.do_remap_vnode.help = (
    'remap a vnode to a different pnode.\n'
    + '\n'
    + 'usage:\n'
    + '     fash remap-vnode [options] \n'
    + '\n'
    + '{{options}}'
);

Fash.prototype.do_remove_pnode = function (subcmd, opts, args, callback) {
    var self = this;

    if (opts.help || args.length !== 0 || !opts.p || !opts.b) {
        this.do_help('help', {}, [subcmd], function (err) {
            return callback(err ? err : true);
        });
    }

    if (opts.b !== BACKENDS.IN_MEMORY && opts.b !== BACKENDS.LEVEL_DB) {
        console.error(sprintf('backend must be one of %s or %s',
                              BACKENDS.IN_MEMORY,
                              BACKENDS.LEVEL_DB));
        return callback(new Error());
    }

    var hashOptions = {
        log: self.log
    };
    var hash;
    var constructor;

    vasync.pipeline({funcs: [
        function prepInput(_, cb) {
            if (opts.b === BACKENDS.IN_MEMORY) {
                hashOptions.backend = fash.BACKEND.IN_MEMORY;
                constructor = fash.deserialize;
                if (opts.l) {
                    hashOptions.topology = fs.readFileSync(opts.l, 'utf8');
                    return cb();
                } else {
                    hashOptions.topology = '';
                    process.stdin.resume();
                    process.stdin.setEncoding('utf8');

                    process.stdin.on('data', function (chunk) {
                        hashOptions.topology += chunk;
                    });

                    process.stdin.on('end', function () {
                        return cb();
                    });
                }
            } else if (opts.b === BACKENDS.LEVEL_DB) {
                hashOptions.backend = fash.BACKEND.LEVEL_DB;
                constructor = fash.load;
                if (!opts.l) {
                    console.error('leveldb backend requires a location');
                    this.do_help('help', {}, [subcmd], function (err) {
                        return callback(err ? err : true);
                    });
                } else {
                    hashOptions.location = opts.l;
                    return cb();
                }
            }
            return (undefined);
        },
        function loadRing(_, cb) {
            hash = constructor(hashOptions, cb);
        },
        function remove(_, cb) {
            hash.removePnode(opts.p, cb);
        },
        function printRing(_, cb) {
            if (opts.o) {
                hash.serialize(function (_err, sh) {
                    if (_err) {
                        return cb(new verror.VError(_err,
                            'unable to print hash'));
                    }
                    if (opts.o) {
                        console.log(sh);
                    }
                    return cb();
                });
            } else {
                return cb();
            }
        }
    ], arg: {}}, function (err) {
        if (err) {
            console.error(err);
        }
        return callback(err);
    });

    return (undefined);
};
Fash.prototype.do_remove_pnode.options = [ {
    names: [ 'l', 'location' ],
    type: 'string',
    help: 'the location of the topology, if using the in_memory backend, \n' +
          'this is the location of the serialized ring on disk, if using \n ' +
          'the leveldb backend, this is the path to the leveldb on disk.'
}, {
    names: [ 'p', 'pnode' ],
    type: 'string',
    help: 'the pnode to remap the vnode(s) to'
}, {
    names: [ 'b', 'backend' ],
    type: 'string',
    help: 'the backend to use'
}, {
    names: [ 'o', 'output' ],
    type: 'bool',
    help: 'serialize and print out the resulting hash to stdout'
}];
Fash.prototype.do_remove_pnode.help = (
    'remove a pnode'
    + '\n'
    + 'usage:\n'
    + '     fash remove-pnode [options] \n'
    + '\n'
    + '{{options}}'
);

Fash.prototype.do_get_pnodes = function (subcmd, opts, args, callback) {
    var self = this;
    if (opts.help || !opts.b) {
        this.do_help('help', {}, [subcmd], function (err) {
            return callback(err ? err : true);
        });
    }

    if (opts.b !== BACKENDS.IN_MEMORY && opts.b !== BACKENDS.LEVEL_DB) {
        console.error(sprintf('backend must be one of %s or %s',
                              BACKENDS.IN_MEMORY,
                              BACKENDS.LEVEL_DB));
        return callback(new Error());
    }

    var hashOptions = {
        log: self.log
    };
    var hash;
    var constructor;

    vasync.pipeline({funcs: [
        function prepInput(_, cb) {
            if (opts.b === BACKENDS.IN_MEMORY) {
                hashOptions.backend = fash.BACKEND.IN_MEMORY;
                constructor = fash.deserialize;
                if (opts.l) {
                    hashOptions.topology = fs.readFileSync(opts.l, 'utf8');
                    return cb();
                } else {
                    hashOptions.topology = '';
                    process.stdin.resume();
                    process.stdin.setEncoding('utf8');

                    process.stdin.on('data', function (chunk) {
                        hashOptions.topology += chunk;
                    });

                    process.stdin.on('end', function () {
                        return cb();
                    });
                }
            } else if (opts.b === BACKENDS.LEVEL_DB) {
                hashOptions.backend = fash.BACKEND.LEVEL_DB;
                constructor = fash.load;
                if (!opts.l) {
                    console.error('leveldb backend requires a location');
                    this.do_help('help', {}, [subcmd], function (err) {
                        return callback(err ? err : true);
                    });
                } else {
                    hashOptions.location = opts.l;
                    return cb();
                }
            }
            return (undefined);
        },
        function loadRing(_, cb) {
            hash = constructor(hashOptions, cb);
        },
        function getPnodes(_, cb) {
            hash.getPnodes(function (err, pnodes) {
                if (err) {
                    return cb(err);
                }

                console.log(pnodes);
                return cb();
            });
        }
    ], arg: {}}, function (err) {
        if (err) {
            console.error(err);
        }
        return callback(err);
    });

    return (undefined);
};
Fash.prototype.do_get_pnodes.options = [ {
    names: [ 'l', 'location' ],
    type: 'string',
    help: 'the location of the topology, if using the in_memory backend, \n' +
          'this is the location of the serialized ring on disk, if using \n ' +
          'the leveldb backend, this is the path to the leveldb on disk.'
}, {
    names: [ 'b', 'backend' ],
    type: 'string',
    help: 'the backend to use'
}];
Fash.prototype.do_get_pnodes.help = (
    'get all the pnodes in the ring'
    + '\n'
    + 'usage:\n'
    + '     fash get-pnodes [options]\n'
    + '\n'
    + '{{options}}'
);

Fash.prototype.do_get_vnodes = function (subcmd, opts, args, callback) {
    var self = this;
    if (opts.help || !opts.b || args.length !== 1) {
        this.do_help('help', {}, [subcmd], function (err) {
            return callback(err ? err : true);
        });
    }

    if (opts.b !== BACKENDS.IN_MEMORY && opts.b !== BACKENDS.LEVEL_DB) {
        console.error(sprintf('backend must be one of %s or %s',
                              BACKENDS.IN_MEMORY,
                              BACKENDS.LEVEL_DB));
        return callback(new Error());
    }

    var hashOptions = {
        log: self.log
    };
    var hash;
    var constructor;

    vasync.pipeline({funcs: [
        function prepInput(_, cb) {
            if (opts.b === BACKENDS.IN_MEMORY) {
                hashOptions.backend = fash.BACKEND.IN_MEMORY;
                constructor = fash.deserialize;
                if (opts.l) {
                    hashOptions.topology = fs.readFileSync(opts.l, 'utf8');
                    return cb();
                } else {
                    hashOptions.topology = '';
                    process.stdin.resume();
                    process.stdin.setEncoding('utf8');

                    process.stdin.on('data', function (chunk) {
                        hashOptions.topology += chunk;
                    });

                    process.stdin.on('end', function () {
                        return cb();
                    });
                }
            } else if (opts.b === BACKENDS.LEVEL_DB) {
                hashOptions.backend = fash.BACKEND.LEVEL_DB;
                constructor = fash.load;
                if (!opts.l) {
                    console.error('leveldb backend requires a location');
                    this.do_help('help', {}, [subcmd], function (err) {
                        return callback(err ? err : true);
                    });
                } else {
                    hashOptions.location = opts.l;
                    return cb();
                }
            }
            return (undefined);
        },
        function loadRing(_, cb) {
            hash = constructor(hashOptions, cb);
        },
        function getVnodes(_, cb) {
            hash.getVnodes(args[0], function (err, vnodes) {
                if (err) {
                    return cb(err);
                }

                console.log(vnodes);
                return cb();
            });
        }
    ], arg: {}}, function (err) {
        if (err) {
            console.error(err);
        }
        return callback(err);
    });

    return (undefined);
};
Fash.prototype.do_get_vnodes.options = [ {
    names: [ 'l', 'location' ],
    type: 'string',
    help: 'the location of the topology, if using the in_memory backend, \n' +
          'this is the location of the serialized ring on disk, if using \n ' +
          'the leveldb backend, this is the path to the leveldb on disk.'
}, {
    names: [ 'b', 'backend' ],
    type: 'string',
    help: 'the backend to use'
}];
Fash.prototype.do_get_vnodes.help = (
    'get the vnodes owned by a pnode'
    + '\n'
    + 'usage:\n'
    + '     fash get-vnodes [options] pnode\n'
    + '\n'
    + '{{options}}'
);

Fash.prototype.do_get_vnode_pnode_and_data =
    function (subcmd, opts, args, callback) {
    var self = this;

    if (opts.help || !opts.v) {
        this.do_help('help', {}, [subcmd], function (err) {
            return callback(err ? err : true);
        });
    }

    var hashOptions = {
        log: self.log
    };
    var hash;
    var constructor;

    vasync.pipeline({funcs: [
        function prepInput(_, cb) {
            if (!opts.l) {
                console.error('leveldb backend requires a location');
                self.do_help('help', {}, [subcmd], function (err) {
                    return callback(err ? err : true);
                });
            } else {
                hashOptions.location = opts.l;
                return cb();
            }
            return (undefined);
        },
        function loadRing(_, cb) {
            // We choose not to support an IN_MEMORY backend.
            hashOptions.backend = fash.BACKEND.LEVEL_DB;
            constructor = fash.load;
            hash = constructor(hashOptions, cb);
        },
        function getVnodeArray(_, cb) {
            var vnodes = common.parseIntArray(opts.v);
            _.vnodes = vnodes;
            return cb();
        },
        function getVnodePnodeAndData(_, cb) {
            var dataHash = {};
            function getResults(input, _cb) {
                hash.getVnodePnodeAndData(input,
                    function (err, pnode, vnodeData) {
                    if (err) {
                        return _cb(verror.VError(err,
                            'unable to get pnode and data for for vnode ',
                            input));
                    }
                    dataHash[input] = {};
                    dataHash[input]['pnode'] = pnode;
                    dataHash[input]['vnodeData'] = vnodeData;
                    return _cb(err, null);
                });
            }

            vasync.forEachPipeline({
                'inputs': _.vnodes,
                'func': getResults
            }, function (err) {
                if (err) {
                    return console.error(new verror.VError(err,
                        'unable to construct hash for vnode '));
                }
                console.log('vnodes: ', dataHash);
            });
        }
    ], arg: {}}, function (err) {
        if (err)
            console.error(new verror.VError(err));
    });

    return (undefined);
};
Fash.prototype.do_get_vnode_pnode_and_data.options = [ {
    names: [ 'v', 'vnodes' ],
    type: 'string',
    help: 'the vnode(s) to inspect'
}, {
    names: [ 'l', 'location' ],
    type: 'string',
    help: 'the location of the topology, assuming a leveldb backend, \n' +
          'this is the path to the leveldb on disk.'
}];
Fash.prototype.do_get_vnode_pnode_and_data.help = (
    'get the data and pnode(s) associated with a set of vnodes'
    + '\n'
    + 'usage:\n'
    + '     fash get-vnode-pnode-and-data [options]\n'
    + '\n'
    + '{{options}}'
);

Fash.prototype.do_get_node = function (subcmd, opts, args, callback) {
    var self = this;

    if (opts.help || !opts.b || args.length !== 1) {
        this.do_help('help', {}, [subcmd], function (err) {
            return callback(err ? err : true);
        });
    }

    if (opts.b !== BACKENDS.IN_MEMORY && opts.b !== BACKENDS.LEVEL_DB) {
        console.error(sprintf('backend must be one of %s or %s',
                              BACKENDS.IN_MEMORY,
                              BACKENDS.LEVEL_DB));
        return callback(new Error());
    }

    var hashOptions = {
        log: self.log
    };
    var hash;
    var constructor;

    vasync.pipeline({funcs: [
        function prepInput(_, cb) {
            if (!opts.b || opts.b === BACKENDS.IN_MEMORY) {
                hashOptions.backend = fash.BACKEND.IN_MEMORY;
                constructor = fash.deserialize;
                if (opts.l) {
                    hashOptions.topology = fs.readFileSync(opts.l, 'utf8');
                    return cb();
                } else {
                    hashOptions.topology = '';
                    process.stdin.resume();
                    process.stdin.setEncoding('utf8');

                    process.stdin.on('data', function (chunk) {
                        hashOptions.topology += chunk;
                    });

                    process.stdin.on('end', function () {
                        return cb();
                    });
                }
            } else if (opts.b === BACKENDS.LEVEL_DB) {
                hashOptions.backend = fash.BACKEND.LEVEL_DB;
                constructor = fash.load;
                if (!opts.l) {
                    console.error('leveldb backend requires a location');
                    this.do_help('help', {}, [subcmd], function (err) {
                        return callback(err ? err : true);
                    });
                } else {
                    hashOptions.location = opts.l;
                    return cb();
                }
            }
            return (undefined);
        },
        function loadRing(_, cb) {
            hash = constructor(hashOptions, cb);
        },
        function getNode(_, cb) {
            hash.getNode(args[0], function (err, node) {
                if (err) {
                    return cb(err);
                }
                console.log(node);
                return cb();
            });
        }
    ], arg: {}}, function (err) {
        if (err) {
            console.error(err);
        }
        return callback(err);
    });

    return (undefined);
};
Fash.prototype.do_get_node.options = [ {
    names: [ 'l', 'location' ],
    type: 'string',
    help: 'the location of the topology, if using the in_memory backend, \n' +
          'this is the location of the serialized ring on disk, if using \n ' +
          'the leveldb backend, this is the path to the leveldb on disk.'
}, {
    names: [ 'b', 'backend' ],
    type: 'string',
    help: 'the backend to use'
}];
Fash.prototype.do_get_node.help = (
    'hash a value to its spot on the ring'
    + '\n'
    + 'usage:\n'
    + '     fash get-node [options] value\n'
    + '\n'
    + '{{options}}'
);

Fash.prototype.do_print_hash = function (subcmd, opts, args, callback) {
    var self = this;
    if (opts.help || !opts.b) {
        this.do_help('help', {}, [subcmd], function (err) {
            return callback(err ? err : true);
        });
    }

    if (opts.b !== BACKENDS.IN_MEMORY && opts.b !== BACKENDS.LEVEL_DB) {
        console.error(sprintf('backend must be one of %s or %s',
                              BACKENDS.IN_MEMORY,
                              BACKENDS.LEVEL_DB));
        return callback(new Error());
    }

    var hashOptions = {
        log: self.log
    };
    var hash;
    var constructor;

    vasync.pipeline({funcs: [
        function prepInput(_, cb) {
            if (opts.b === BACKENDS.IN_MEMORY) {
                hashOptions.backend = fash.BACKEND.IN_MEMORY;
                constructor = fash.deserialize;
                if (opts.l) {
                    hashOptions.topology = fs.readFileSync(opts.l, 'utf8');
                    return cb();
                } else {
                    hashOptions.topology = '';
                    process.stdin.resume();
                    process.stdin.setEncoding('utf8');

                    process.stdin.on('data', function (chunk) {
                        hashOptions.topology += chunk;
                    });

                    process.stdin.on('end', function () {
                        return cb();
                    });
                }
            } else if (opts.b === BACKENDS.LEVEL_DB) {
                hashOptions.backend = fash.BACKEND.LEVEL_DB;
                constructor = fash.load;
                if (!opts.l) {
                    console.error('leveldb backend requires a location');
                    this.do_help('help', {}, [subcmd], function (err) {
                        return callback(err ? err : true);
                    });
                } else {
                    hashOptions.location = opts.l;
                    return cb();
                }
            }
            return (undefined);
        },
        function loadRing(_, cb) {
            hash = constructor(hashOptions, cb);
        },
        function printRing(_, cb) {
            hash.serialize(function (_err, sh) {
                if (_err) {
                    return cb(new verror.VError(_err,
                                                'unable to print hash'));
                }
                console.log(sh);
                return cb();
            });
        }
    ], arg: {}}, function (err) {
        if (err) {
            console.error(err);
        }
        return callback(err);
    });

    return (undefined);
};
Fash.prototype.do_print_hash.options = [ {
    names: [ 'l', 'location' ],
    type: 'string',
    help: 'the location of the topology, if using the in_memory backend, \n' +
          'this is the location of the serialized ring on disk, if using \n ' +
          'the leveldb backend, this is the path to the leveldb on disk.'
}, {
    names: [ 'b', 'backend' ],
    type: 'string',
    help: 'the backend to use'
}];
Fash.prototype.do_print_hash.help = (
    'print out the hash ring, WARNING: may consume a large quantity of memory.'
    + '\n'
    + 'usage:\n'
    + '     fash print-hash [options] value\n'
    + '\n'
    + '{{options}}'
);

Fash.prototype.do_diff = function (subcmd, opts, args, callback) {
    var self = this;

    if (opts.help || args.length !== 2 ||
        (args[0] === '-' && args[1] === '-')) {

        this.do_help('help', {}, [subcmd], function (err) {
            return callback(err ? err : true);
        });
    }

    function chooseBackend(b) {
        if (b === BACKENDS.IN_MEMORY) {
            return (fash.BACKEND.IN_MEMORY);
        } else if (b === BACKENDS.LEVEL_DB) {
            return (fash.BACKEND.LEVEL_DB);
        } else {
            console.error('one of %j must be specified if not passing ' +
                          'topology via stdin', BACKENDS);
            return (callback(true));
        }
    }

    function chooseConstructor(b) {
        if (b === BACKENDS.IN_MEMORY) {
            return (fash.deserialize);
        } else if (b === BACKENDS.LEVEL_DB) {
            return (fash.load);
        } else {
            console.error('one of %j must be specified if not passing ' +
                          'topology via stdin', BACKENDS);
            return (callback(true));
        }
    }

    function loadHash(hashOptions, l, cb) {
        if (hashOptions.backend === fash.BACKEND.IN_MEMORY) {
            if (l === '-') {
                hashOptions.topology = '';
                process.stdin.resume();
                process.stdin.setEncoding('utf8');

                process.stdin.on('data', function (chunk) {
                    hashOptions.topology += chunk;
                });

                process.stdin.on('end', function () {
                    return (cb(null, hashOptions));
                });
                return (undefined);
            } else {
                hashOptions.topology = fs.readFileSync(l, 'utf8');
                return (cb(null, hashOptions));
            }
        } else if (hashOptions.backend === fash.BACKEND.LEVEL_DB) {
                hashOptions.location = l;
                return (cb(null, hashOptions));
        } else {
            console.error('one of %j must be specified if not passing ' +
                          'topology via stdin', BACKENDS);
            return (callback(true));
        }
    }

    var pnodes, constructor1, constructor2, hash1, hash2, opts_i;
    var hashOptions1 = { log: self.log };
    var hashOptions2 = { log: self.log };
    var diff = {};

    if (!opts.b) {
        hashOptions1.backend = fash.BACKEND.IN_MEMORY;
        hashOptions2.backend = fash.BACKEND.IN_MEMORY;
        constructor1 = fash.deserialize;
        constructor2 = fash.deserialize;
    } else {
        opts_i = 0;
        while (opts_i < opts._order.length) {
            if (opts._order[opts_i].key === 'b') {
                hashOptions1.backend = chooseBackend(opts._order[opts_i].value);
                constructor1 = chooseConstructor(opts._order[opts_i].value);
                hashOptions2.backend = chooseBackend(opts._order[opts_i].value);
                constructor2 = chooseConstructor(opts._order[opts_i].value);
                opts_i++;
                break;
            }
            opts_i++;
        }
        while (opts_i < opts._order.length) {
            if (opts._order[opts_i].key === 'b') {
                hashOptions2.backend = chooseBackend(opts._order[opts_i].value);
                constructor2 = chooseConstructor(opts._order[opts_i].value);
                break;
            }
            opts_i++;
        }
    }

    vasync.pipeline({funcs: [
        function load1(_, cb) {
            loadHash(hashOptions1, args[0], function (err, hashOptions) {
                hash1 = constructor1(hashOptions, cb);
            });
        },
        function load2(_, cb) {
            loadHash(hashOptions2, args[1], function (err, hashOptions) {
                hash2 = constructor2(hashOptions, cb);
            });
        },
        function getPnodes1(_, cb) {
            hash1.getPnodes(function (err, pnodes1) {
                if (err) {
                    return (cb(err));
                }
                pnodes = pnodes1;
                return (cb());
            });
        },
        function getPnodes2(_, cb) {
            hash2.getPnodes(function (err, pnodes2) {
                if (err) {
                    return (cb(err));
                }
                pnodes = pnodes.concat(pnodes2);
                return (cb());
            });
        },
        function doDiff(_, cb) {

            function compare(pnode, comparecb) {
                var vnodes1, vnodes2;
                vasync.pipeline({funcs: [
                    function getVnodes1(__, subcb) {
                        hash1.getVnodes(pnode, function (err, vnodes) {
                            if (err) {
                                vnodes1 = null;
                                return (subcb());
                            }
                            vnodes1 = vnodes;
                            return (subcb());
                        });
                    },
                    function getVnodes2(__, subcb) {
                        hash2.getVnodes(pnode, function (err, vnodes) {
                            if (err) {
                                vnodes2 = null;
                                return (subcb());
                            }
                            vnodes2 = vnodes;
                            return (subcb());
                        });
                    }
                ]}, function (err, results) {
                    if (!vnodes1) {
                        diff[pnode] = diff[pnode] || {};
                        diff[pnode]['added'] = vnodes2;
                    } else if (!vnodes2) {
                        diff[pnode] = diff[pnode] || {};
                        diff[pnode]['removed'] = vnodes1;
                    } else {
                        function mergeDiff(a, b) {
                            var i = 0;
                            var j = 0;
                            var difference = [];
                            while (i < a.length && j < b.length) {
                                if (a[i] === b[j]) {
                                    i++;
                                    j++;
                                } else if (a[i] < b[j]) {
                                    difference.push(a[i]);
                                    i++;
                                } else {
                                    j++;
                                }
                            }

                            while (i < a.length) {
                                difference.push(a[i]);
                                i++;
                            }

                            return (difference);
                        }

                        var removed = mergeDiff(vnodes1, vnodes2);
                        var added = mergeDiff(vnodes2, vnodes1);
                        if (removed.length || added.length) {
                            diff[pnode] = diff[pnode] || {};
                            if (removed.length) {
                                diff[pnode]['removed'] = removed;
                            }
                            if (added.length) {
                                diff[pnode]['added'] = added;
                            }
                        }
                    }
                    return (comparecb());
                });
            }

            vasync.forEachParallel({
                func: compare,
                inputs: pnodes
            }, function (err, results) {
                if (Object.keys(diff).length) {
                    console.log(JSON.stringify(diff));
                }
                return (cb());
            });
        }
    ]}, function (err) {
        if (err) {
            console.error(err);
            return callback(err);
        }
    });
    return (undefined);
};
Fash.prototype.do_diff.options = [ {
    names: ['b', 'backend'],
    type: 'string',
    help: 'the backend to use'
}];
Fash.prototype.do_diff.help = (
    'compare two topologies'
    + '\n'
    + 'usage:\n'
    + '     fash diff [options] FILE1 FILE2\n'
    + '     cat ring1.json | fash diff - ring2.json\n'
    + '     fash diff -b leveldb ring1.json ring2.json\n'
    + '\n'
    + '{{options}}'
    + '\n'
    + 'If FILE1 or FILE2 is \'-\', read standard input (in memory only).\n'
    + 'You can use different backends for each input by specifying -b twice:\n'
    + '    fash diff -b leveldb -b memory leveldbdir ring.json'
);

var cli = new Fash();
cli.main(process.argv, function (err, subcmd) {
    if (err) {
        console.error(err);
        process.exit(1);
    } else {
        process.exit(0);
    }
});
