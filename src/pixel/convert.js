'use strict';

const fs = require('fs');
const path = require('path');
const { findInstalledSkills, parseSkill, origPath } = require('./paths');
const { estimateSavings } = require('./estimate');
const { renderSkillToPng, tryCanvas } = require('./render');
const { imageTokens } = require('./estimate');

const PIXEL_MARKER = '<!-- lakonai-pixel:';

// Check if a skill file has already been pixelated.
function isPixelated(raw) {
  return raw.includes(PIXEL_MARKER);
}

// Generate the pixelated skill content.
function buildPixelatedContent(frontmatter, pngPath, relPngPath) {
  const marker = `${PIXEL_MARKER} ${path.basename(origPath(pngPath.replace('-body.png', '.md')))} -->`;
  return `${frontmatter}\n\n${marker}\n![skill-body](${relPngPath})\n`;
}

// Restore from .orig.md backup — byte-identical.
// Returns { restored, reason }.
function revertSkill(filePath) {
  const orig = origPath(filePath);
  if (!fs.existsSync(orig)) return { restored: false, reason: 'no .orig.md backup found' };
  try {
    const content = fs.readFileSync(orig);
    fs.writeFileSync(filePath, content);
    // Clean up PNG file if present
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, '.md');
    const png = path.join(dir, base + '-body.png');
    try { if (fs.existsSync(png)) fs.unlinkSync(png); } catch { /* ok */ }
    fs.unlinkSync(orig);
    return { restored: true, reason: null };
  } catch (err) {
    return { restored: false, reason: err.message };
  }
}

// Dry-run: list all skills with token math, no writes.
// Returns array of { file, agent, textTokens, imgTokens, saved, savePct, profitable, pixelated }.
function dryRun({ agent = null, home = null } = {}) {
  const skills = findInstalledSkills({ agent, home });
  const results = [];
  for (const { file, agent: ag } of skills) {
    const parsed = parseSkill(file);
    if (!parsed) continue;
    const pixelated = isPixelated(parsed.raw);
    const estimate = estimateSavings(parsed.body);
    results.push({ file, agent: ag, ...estimate, pixelated });
  }
  return results;
}

// Convert profitable skills to pixel mode.
// Returns array of { file, status, reason }.
function convert({ agent = null, home = null } = {}) {
  const canvasAvail = !!tryCanvas();
  const results = [];
  const skills = findInstalledSkills({ agent, home });

  for (const { file } of skills) {
    const parsed = parseSkill(file);
    if (!parsed) { results.push({ file, status: 'skip', reason: 'unreadable' }); continue; }

    if (isPixelated(parsed.raw)) {
      results.push({ file, status: 'skip', reason: 'already pixelated' });
      continue;
    }

    const estimate = estimateSavings(parsed.body);
    if (!estimate.profitable) {
      results.push({ file, status: 'skip', reason: `not profitable (${estimate.textTokens} text → ${estimate.imgTokens} img)` });
      continue;
    }

    if (!canvasAvail) {
      results.push({ file, status: 'skip', reason: 'canvas not installed (run: npm install canvas)' });
      continue;
    }

    /* istanbul ignore next -- canvas rendering: native binary required, not available in CI */
    try {
      const orig = origPath(file);
      if (!fs.existsSync(orig)) fs.copyFileSync(file, orig);

      const { pngPath, width, height } = renderSkillToPng(parsed.body, file);
      const relPng = './' + path.basename(pngPath);
      const imgTok = imageTokens(width, height);

      const newContent = buildPixelatedContent(parsed.frontmatter, pngPath, relPng);
      fs.writeFileSync(file, newContent);

      results.push({
        file,
        status: 'converted',
        textTokens: estimate.textTokens,
        imgTokens: imgTok,
        saved: estimate.textTokens - imgTok,
        reason: null,
      });
    } catch (err) {
      results.push({ file, status: 'error', reason: err.message });
    }
  }
  return results;
}

// Revert all pixelated skills.
// Returns array of { file, restored, reason }.
function revertAll({ agent = null, home = null } = {}) {
  const skills = findInstalledSkills({ agent, home });
  const results = [];
  for (const { file } of skills) {
    const parsed = parseSkill(file);
    if (!parsed || !isPixelated(parsed.raw)) continue;
    const r = revertSkill(file);
    results.push({ file, ...r });
  }
  return results;
}

// Format dry-run results as a human-readable table.
function formatDryRun(results) {
  if (!results.length) return 'no skills found\n';
  const lines = ['', 'lakonai pixel --dry-run', '─'.repeat(60)];
  let totalText = 0, totalImg = 0;
  for (const r of results) {
    const label = path.relative(process.env.HOME || '', r.file);
    const status = r.pixelated
      ? '[pixelated]'
      : r.profitable
        ? `${r.textTokens} → ${r.imgTokens} tok  (-${r.savePct}%)`
        : `${r.textTokens} tok  (skip — not profitable)`;
    lines.push(`  ${label}`);
    lines.push(`    ${status}`);
    if (!r.pixelated) {
      totalText += r.textTokens;
      totalImg += r.imgTokens;
    }
  }
  if (totalText > 0) {
    const pct = Math.round(((totalText - totalImg) / totalText) * 100);
    lines.push('', `  total: ${totalText} → ${totalImg} tok  (-${pct}%) across unconverted skills`);
  }
  return lines.join('\n') + '\n';
}

// Format convert results.
function formatConvert(results) {
  if (!results.length) return 'no skills found\n';
  const lines = ['', 'lakonai pixel', '─'.repeat(50)];
  for (const r of results) {
    const label = path.relative(process.env.HOME || '', r.file);
    if (r.status === 'converted') {
      lines.push(`  ✅ ${label}  ${r.textTokens} → ${r.imgTokens} tok  (-${r.saved})`);
    } else {
      lines.push(`  ⏭  ${label}  ${r.reason}`);
    }
  }
  return lines.join('\n') + '\n';
}

// Format revert results.
function formatRevert(results) {
  if (!results.length) return 'no pixelated skills found\n';
  const lines = ['', 'lakonai pixel --revert', '─'.repeat(50)];
  for (const r of results) {
    const label = path.relative(process.env.HOME || '', r.file);
    lines.push(r.restored ? `  ✅ ${label}` : `  ❌ ${label}  ${r.reason}`);
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  dryRun, convert, revertAll, revertSkill, isPixelated, buildPixelatedContent,
  formatDryRun, formatConvert, formatRevert,
};
