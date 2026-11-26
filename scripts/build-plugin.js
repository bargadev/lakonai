#!/usr/bin/env node
'use strict';

// Regenerate the Claude Code plugin files (plugin/hooks.json, plugin/commands/,
// the version in .claude-plugin/*.json) from the tables `lakonai install` uses.
const { writeGenerated, PLUGIN_ROOT } = require('../src/plugin');
const written = writeGenerated(PLUGIN_ROOT);
process.stdout.write(`lakonai plugin: wrote ${written.length} files + manifests\n`);
