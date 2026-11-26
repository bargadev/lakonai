#!/usr/bin/env node
'use strict';

// Plugin hook runner: `node plugin/hook.js <name>`. The logic is in src/plugin.js.
/* istanbul ignore file -- thin launcher; plan()/runEnv() are unit-tested */

const Module = require('module');
const { plan, runEnv } = require('../src/plugin');

const decision = plan(process.argv[2]);
if (decision.action !== 'run') process.exit(0);
Object.assign(process.env, runEnv(process.env));
// Load as the main module so the hook's `require.main === module` guard runs it.
Module._load(decision.src, null, true);
