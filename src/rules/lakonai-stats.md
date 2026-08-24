---
description: Show lakonai token savings — filters, proxy, and graph combined.
allowed-tools: Bash(lakonai gain:*), Bash(node:*)
---

Run the following and show output verbatim. Do not summarize.

```bash
lakonai gain
```

Then run this to show proxy compression stats by content type:

```bash
node -e "
const fs = require('fs'), os = require('os'), path = require('path');
const f = path.join(process.env.LAKON_HOME || path.join(os.homedir(), '.lakon'), 'proxy-stats.json');
try {
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  const pct = s.rawTokens ? Math.round((1 - s.outTokens / s.rawTokens) * 100) : 0;
  console.log('\nproxy: ' + s.requests + ' requests  ' + s.rawTokens + ' → ' + s.outTokens + ' tok  (-' + pct + '%)');
  for (const [t, v] of Object.entries(s.byType || {})) {
    const p = v.raw ? Math.round((1 - v.out / v.raw) * 100) : 0;
    console.log('  ' + t.padEnd(8) + v.raw + ' → ' + v.out + ' tok  (-' + p + '%)  [' + v.count + ' blocks]');
  }
} catch { console.log('proxy: no data yet (starts after first API call through proxy)'); }
"
```
