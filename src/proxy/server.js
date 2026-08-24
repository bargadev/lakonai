'use strict';

// HTTP/HTTPS proxy server that intercepts LLM tool calls, compresses output, and tracks token usage to disk.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { compressRequest } = require('./compress');

const DEFAULT_PORT = 7474;
const DEFAULT_UPSTREAM = { host: 'api.anthropic.com', port: 443, protocol: 'https' };
const STATS_FILE = () => path.join(process.env.LAKON_HOME || path.join(os.homedir(), '.lakon'), 'proxy-stats.json');

function readStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE(), 'utf8')); } catch { return { rawTokens: 0, outTokens: 0, requests: 0, byType: {} }; }
}

function writeStats(stats) {
  try {
    const dir = path.dirname(STATS_FILE());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATS_FILE(), JSON.stringify(stats));
  } catch { /* best-effort */ }
}

function mergeStats(existing, delta) {
  existing.rawTokens += delta.rawTokens;
  existing.outTokens += delta.outTokens;
  existing.requests = (existing.requests || 0) + 1;
  for (const [type, s] of Object.entries(delta.byType || {})) {
    existing.byType[type] = existing.byType[type] || { raw: 0, out: 0, count: 0 };
    existing.byType[type].raw += s.raw;
    existing.byType[type].out += s.out;
    existing.byType[type].count += s.count;
  }
}

function createServer(port = DEFAULT_PORT, upstream = DEFAULT_UPSTREAM) {
  /* istanbul ignore next -- https branch requires SSL setup; tests use plain http upstream */
  const transport = upstream.protocol === 'http' ? http : https;

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      const isMessages = req.method === 'POST' && req.url === '/v1/messages';

      let bodyToSend = rawBody;

      if (isMessages) {
        try {
          const parsed = JSON.parse(rawBody.toString('utf8'));
          const { body: compressed, stats } = compressRequest(parsed);
          bodyToSend = Buffer.from(JSON.stringify(compressed), 'utf8');
          const existing = readStats();
          mergeStats(existing, stats);
          writeStats(existing);
        } catch {
          bodyToSend = rawBody;
        }
      }

      const headers = { ...req.headers };
      headers['host'] = upstream.host;
      headers['content-length'] = bodyToSend.length;
      delete headers['transfer-encoding'];
      delete headers['connection'];

      const upstreamReq = transport.request(
        { hostname: upstream.host, port: upstream.port, path: req.url, method: req.method, headers },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
          upstreamRes.pipe(res);
        }
      );

      upstreamReq.on('error', (err) => {
        /* istanbul ignore next */
        if (!res.headersSent) {
          res.writeHead(502);
          res.end(`lakonai proxy: upstream error: ${err.message}`);
        }
      });

      upstreamReq.write(bodyToSend);
      upstreamReq.end();
    });
  });

  return server;
}

/* istanbul ignore next */
function main() {
  const port = Number(process.env.LAKON_PROXY_PORT) || DEFAULT_PORT;
  const server = createServer(port);
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`lakonai proxy: listening on http://127.0.0.1:${port}\n`);
  });
  server.on('error', (err) => {
    process.stderr.write(`lakonai proxy error: ${err.message}\n`);
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = { createServer, readStats, writeStats, mergeStats, DEFAULT_PORT, DEFAULT_UPSTREAM };
