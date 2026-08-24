'use strict';

const fs = require('fs');
const path = require('path');
const { collectFiles } = require('./parser');

// Debounced incremental rebuild watcher using Node's built-in fs.watch.
// Calls onRebuild(changedFile) when a source file changes.
// Returns a { close() } handle.

function watchDir(rootDir, onRebuild, { debounceMs = 500 } = {}) {
  let timer = null;
  let pending = new Set();

  function scheduleRebuild(file) {
    pending.add(file);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const changed = [...pending];
      pending = new Set();
      timer = null;
      onRebuild(changed);
    }, debounceMs);
  }

  const watchers = [];

  // Watch the root dir recursively via fs.watch with recursive option (Node 19.1+).
  // Fall back to per-file watching on unsupported platforms.
  try {
    const w = fs.watch(rootDir, { recursive: true }, (event, filename) => {
      if (!filename) return;
      const fullPath = path.join(rootDir, filename);
      const ext = path.extname(filename).toLowerCase();
      // Only react to supported source files, not graph output
      if (!filename.startsWith('lakonai-graph') && ['.js','.ts','.tsx','.jsx','.py','.go','.rs'].includes(ext)) {
        scheduleRebuild(fullPath);
      }
    });
    watchers.push(w);
  } catch {
    /* istanbul ignore next -- fallback for platforms lacking recursive fs.watch */
    const files = collectFiles(rootDir);
    for (const f of files) {
      try {
        const w = fs.watch(f, () => scheduleRebuild(f));
        watchers.push(w);
      } catch { /* skip unreadable files */ }
    }
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      for (const w of watchers) { try { w.close(); } catch { /* ok */ } }
    },
  };
}

module.exports = { watchDir };
