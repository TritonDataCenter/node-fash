#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2017, Joyent, Inc.
#

#
# Makefile.defs defines variables used as part of the build process.
#
include ./tools/mk/Makefile.defs

#
# Makefile.node_modules.defs provides a common target for installing modules
# with NPM from a dependency specification in a "package.json" file.  By
# including this Makefile, we can depend on $(STAMP_NODE_MODULES) to drive "npm
# install" correctly.
#
include ./tools/mk/Makefile.node_modules.defs

NODE =					node
NPM =					npm

#
# Configuration used by Makefile.defs and Makefile.targ to generate
# "check" targets.
#
JSON_FILES =				package.json
JS_FILES :=				$(shell find lib bin -name '*.js')
JSL_FILES_NODE =			$(JS_FILES)
JSSTYLE_FILES =				$(JS_FILES) \
					$(shell find test lib bin -name '*.js')

JSL_CONF_NODE =				tools/jsl.node.conf
JSSTYLE_FLAGS =				-f tools/jsstyle.conf

#
# The LevelDB tests support three different hashing algorithms. However,
# the test suite is not built to run tests for all of them in sequence -- at
# the time of writing, it is not performant enough to complete. In the past,
# of the three, sha256 has been the default assigned to new hash rings in the
# codebase. It is assigned here in the interest of backward compatibility.
#
export LEVELDB_TEST_ALGORITHM =		sha256


.PHONY: all
all: $(STAMP_NODE_MODULES)

.PHONY: test
test: $(STAMP_NODE_MODULES)
	$(NODE) ./node_modules/.bin/nodeunit test/*.test.js

#
# Target definitions.  This is where we include the target Makefiles for
# the "defs" Makefiles we included above.
#
include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.targ
include ./tools/mk/Makefile.node_modules.targ
