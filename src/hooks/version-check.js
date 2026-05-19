'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;
const REGISTRY_URL = 'https://registry.npmjs.org/lakonai/latest';

function lakonHome() {
  /* c8 ignore next */
  return process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
}

function cachePath() {
  return path.join(lakonHome(), 'version.json');
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    fs.mkdirSync(lakonHome(), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify(data));
    /* c8 ignore next 3 */
  } catch {
    // never let cache write break anything
  }
}

function installedVersionMarkerPath() {
  return path.join(lakonHome(), 'installed-version.json');
}

function currentVersion() {
  try {
    return JSON.parse(fs.readFileSync(installedVersionMarkerPath(), 'utf8')).version;
  } catch {
    // ignore — fall through to package.json lookup
  }
  try {
    return require('../../package.json').version;
    /* c8 ignore next 3 */
  } catch {
    return null;
  }
}

function writeInstalledVersionMarker(version) {
  try {
    fs.mkdirSync(lakonHome(), { recursive: true });
    fs.writeFileSync(installedVersionMarkerPath(), JSON.stringify({ version }));
    /* c8 ignore next 3 */
  } catch {
    // never let marker write break install
  }
}

function semverCmp(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/* c8 ignore next */
function fetchLatest(url = process.env.LAKON_REGISTRY_URL || REGISTRY_URL, timeout = FETCH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      /* c8 ignore next */
      const client = url.startsWith('http://') ? http : https;
      const req = client.get(url, { timeout }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish(null);
          return;
        }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            /* c8 ignore next */
            finish(JSON.parse(body).version || null);
          } catch {
            finish(null);
          }
        });
      });
      req.on('error', () => finish(null));
      req.on('timeout', () => {
        try { req.destroy(); /* c8 ignore next */ } catch {}
        finish(null);
      });
      /* c8 ignore next 3 */
    } catch {
      finish(null);
    }
  });
}

function isDisabled() {
  return process.env.LAKON_NO_UPDATE_CHECK === '1';
}

async function checkForUpdate({ force = false } = {}) {
  if (isDisabled()) return null;
  const current = currentVersion();
  /* c8 ignore next */
  if (!current) return null;

  const cache = readCache();
  const now = Date.now();
  const fresh = cache && typeof cache.t === 'number' && now - cache.t < CHECK_TTL_MS;

  if (!force && fresh) {
    if (cache.latest && semverCmp(cache.latest, current) > 0) {
      return { current, latest: cache.latest, available: true };
    }
    return null;
  }

  const latest = await fetchLatest();
  if (latest) writeCache({ t: now, latest });
  if (latest && semverCmp(latest, current) > 0) {
    return { current, latest, available: true };
  }
  return null;
}

function getCachedUpdate() {
  if (isDisabled()) return null;
  const current = currentVersion();
  /* c8 ignore next */
  if (!current) return null;
  const cache = readCache();
  if (!cache || !cache.latest) return null;
  if (semverCmp(cache.latest, current) > 0) {
    return { current, latest: cache.latest, available: true };
  }
  return null;
}

function formatNotice(info) {
  return `lakonai ${info.latest} available (you have ${info.current}). Update: npm i -g lakonai@latest`;
}

module.exports = {
  checkForUpdate,
  getCachedUpdate,
  formatNotice,
  semverCmp,
  currentVersion,
  cachePath,
  fetchLatest,
  writeInstalledVersionMarker,
  installedVersionMarkerPath,
};
