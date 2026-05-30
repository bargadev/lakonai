'use strict';

// Automatic MCP catalog compression. On install, lakonai finds the user's
// configured MCP servers (~/.claude.json) and transparently wraps each stdio
// server so its tool/prompt/resource descriptions are compressed before they hit
// context (via `lakonai __mcp <original-cmd>`). Backed up first, fully reversible
// on uninstall. Only stdio servers (a string `command`) are touched; url/sse
// servers and tool-call results are never altered. Opt out with LAKON_NO_MCP=1.

const fs = require('fs');
const path = require('path');
const { backupFile } = require('./backup');

function mcpConfigPath(home) {
  return path.join(home, '.claude.json');
}

// Collect every `mcpServers` map anywhere in the config (top-level + per-project).
function collectServerMaps(obj, out) {
  if (!obj || typeof obj !== 'object') return out;
  if (obj.mcpServers && typeof obj.mcpServers === 'object') out.push(obj.mcpServers);
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object' && v !== obj.mcpServers) collectServerMaps(v, out);
  }
  return out;
}

// Wrap stdio servers in place. Returns how many were wrapped.
function wrapServers(config) {
  let n = 0;
  for (const map of collectServerMaps(config, [])) {
    for (const name of Object.keys(map)) {
      const s = map[name];
      if (!s || typeof s !== 'object' || s._lakonai) continue;
      if (typeof s.command !== 'string') continue; // url/sse server — skip
      const origArgs = Array.isArray(s.args) ? s.args : [];
      s.args = ['__mcp', s.command, ...origArgs];
      s.command = 'lakonai';
      s._lakonai = true;
      n++;
    }
  }
  return n;
}

// Reverse wrapServers. Returns how many were unwrapped.
function unwrapServers(config) {
  let n = 0;
  for (const map of collectServerMaps(config, [])) {
    for (const name of Object.keys(map)) {
      const s = map[name];
      if (!s || typeof s !== 'object' || !s._lakonai) continue;
      const a = Array.isArray(s.args) ? s.args : [];
      s.command = a[1];
      s.args = a.slice(2);
      delete s._lakonai;
      n++;
    }
  }
  return n;
}

function applyToConfig(home, transform) {
  if (process.env.LAKON_NO_MCP === '1') return 0;
  const p = mcpConfigPath(home);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return 0; // no config / unreadable -> nothing to do
  }
  const n = transform(config);
  if (n > 0) {
    backupFile('claude-code-mcp', p);
    fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n', 'utf8');
  }
  return n;
}

function wrapMcp(home) {
  return applyToConfig(home, wrapServers);
}
function unwrapMcp(home) {
  return applyToConfig(home, unwrapServers);
}

module.exports = { wrapMcp, unwrapMcp, wrapServers, unwrapServers, collectServerMaps, mcpConfigPath };
