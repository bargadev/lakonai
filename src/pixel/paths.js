'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// Agent skill directories to scan.
// Each entry: { agent, dir } — dir may not exist (checked at runtime).
function skillDirs(home = null) {
  const h = home || process.env.HOME || os.homedir();
  const cwd = process.cwd();
  const claudeConfig = process.env.CLAUDE_CONFIG_DIR || path.join(h, '.claude');

  return [
    { agent: 'claude-code', dir: path.join(claudeConfig, 'commands') },
    { agent: 'claude-code', dir: path.join(cwd, '.claude', 'commands') },
    { agent: 'codex',       dir: path.join(h, '.codex', 'skills') },
    { agent: 'gemini',      dir: path.join(h, '.gemini', 'skills') },
  ];
}

// Recursively collect .md files from a directory.
function collectMd(dir, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectMd(full, files);
    else if (e.isFile() && e.name.endsWith('.md') && !e.name.endsWith('.orig.md')) {
      files.push(full);
    }
  }
  return files;
}

// Return all installed skill files, tagged with their agent.
function findInstalledSkills({ home = null, agent = null } = {}) {
  const dirs = skillDirs(home);
  const results = [];
  for (const { agent: ag, dir } of dirs) {
    if (agent && ag !== agent) continue;
    for (const file of collectMd(dir)) {
      results.push({ file, agent: ag });
    }
  }
  return results;
}

// Parse frontmatter + body from a skill markdown file.
// Returns { frontmatter, body, raw } or null if unreadable.
function parseSkill(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return null; }

  if (!raw.startsWith('---')) return { frontmatter: '', body: raw, raw };

  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: '', body: raw, raw };

  const frontmatter = raw.slice(0, end + 4); // includes closing ---
  const body = raw.slice(end + 4).replace(/^\n/, '');
  return { frontmatter, body, raw };
}

// Backup path for original skill file (byte-identical restore).
function origPath(filePath) {
  return filePath.replace(/\.md$/, '.orig.md');
}

module.exports = { skillDirs, findInstalledSkills, parseSkill, origPath, collectMd };
