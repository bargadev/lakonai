'use strict';

const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.LAKON_PROXY_PORT) || 7474;

function lakonHome() {
  return process.env.LAKON_HOME || path.join(os.homedir(), '.lakon');
}

const pidFile = () => path.join(lakonHome(), 'proxy.pid');
const serverScript = path.join(__dirname, 'server.js');

function readPid() {
  try { return Number(fs.readFileSync(pidFile(), 'utf8').trim()); } catch { return null; }
}

function isRunning(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function status() {
  const pid = readPid();
  if (isRunning(pid)) return { running: true, pid, port: PORT };
  return { running: false, pid: null, port: PORT };
}

function start() {
  const s = status();
  if (s.running) return s;

  const child = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, LAKON_PROXY_PORT: String(PORT) },
  });
  child.unref();

  // Write PID
  try {
    fs.mkdirSync(lakonHome(), { recursive: true });
    fs.writeFileSync(pidFile(), String(child.pid));
  } catch { /* best-effort */ }

  return { running: true, pid: child.pid, port: PORT };
}

function stop() {
  const pid = readPid();
  if (!isRunning(pid)) {
    try { fs.unlinkSync(pidFile()); } catch { /* ok */ }
    return false;
  }
  try {
    process.kill(pid, 'SIGTERM');
    fs.unlinkSync(pidFile());
    return true;
  } catch {
    return false;
  }
}

// Shell rc line to set ANTHROPIC_BASE_URL when proxy is active.
function envLine() {
  return `export ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT}  # lakonai proxy`;
}

const LAKONAI_PROXY_MARKER = '# lakonai proxy';

function installEnv(rcFile) {
  try {
    const content = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, 'utf8') : '';
    if (content.includes(LAKONAI_PROXY_MARKER)) return false; // already installed
    fs.appendFileSync(rcFile, `\n${envLine()}\n`);
    return true;
  } catch {
    return false;
  }
}

function uninstallEnv(rcFile) {
  try {
    if (!fs.existsSync(rcFile)) return false;
    const content = fs.readFileSync(rcFile, 'utf8');
    const filtered = content.split('\n').filter((l) => !l.includes(LAKONAI_PROXY_MARKER)).join('\n');
    if (filtered === content) return false;
    fs.writeFileSync(rcFile, filtered);
    return true;
  } catch {
    return false;
  }
}

function rcFiles() {
  const home = os.homedir();
  return [
    path.join(home, '.zshrc'),
    path.join(home, '.bashrc'),
    path.join(home, '.bash_profile'),
  ].filter((f) => fs.existsSync(f));
}

module.exports = { start, stop, status, installEnv, uninstallEnv, rcFiles, envLine, pidFile, isRunning, readPid };
