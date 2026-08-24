'use strict';

const { communityLabels } = require('./leiden');

// Palette for community colors (cycles if more than palette length)
const PALETTE = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
];

function buildHtml(graph) {
  const { nodes, edges } = graph;
  const communities = {};
  for (const n of nodes) communities[n.id] = n.community ?? 0;
  const commLabels = communityLabels(nodes, edges, communities);

  const numComm = Math.max(...Object.values(communities), 0) + 1;
  const colorMap = {};
  for (let i = 0; i < numComm; i++) colorMap[i] = PALETTE[i % PALETTE.length];

  // Encode data as JSON embedded in script
  const graphData = JSON.stringify({ nodes, edges, commLabels, colorMap });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>lakonai graph</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #1a1a2e; color: #eee; font-family: monospace; overflow: hidden; }
  #canvas { display: block; }
  #tooltip {
    position: fixed; background: rgba(0,0,0,.85); border: 1px solid #444;
    padding: 10px 14px; border-radius: 6px; font-size: 12px; pointer-events: none;
    max-width: 320px; display: none; line-height: 1.5; z-index: 10;
  }
  #legend {
    position: fixed; top: 12px; left: 12px; background: rgba(0,0,0,.7);
    padding: 10px; border-radius: 6px; font-size: 11px; line-height: 1.8;
  }
  #info {
    position: fixed; bottom: 12px; left: 12px; font-size: 11px; opacity: .5;
  }
  #search {
    position: fixed; top: 12px; right: 12px; background: rgba(0,0,0,.7);
    padding: 6px; border-radius: 6px;
  }
  #search input {
    background: #333; border: 1px solid #555; color: #eee;
    padding: 4px 8px; border-radius: 4px; font-size: 12px; width: 180px;
  }
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<div id="tooltip"></div>
<div id="legend"></div>
<div id="info">scroll to zoom · drag to pan · hover nodes</div>
<div id="search"><input id="searchInput" placeholder="search nodes…" /></div>
<script>
(function() {
const RAW = ${graphData};
const { nodes: rawNodes, edges: rawEdges, commLabels, colorMap } = RAW;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');
const legend = document.getElementById('legend');

// Layout
let W = canvas.width = window.innerWidth;
let H = canvas.height = window.innerHeight;
window.addEventListener('resize', () => {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  restart();
});

// Filter to show only file nodes + their symbols (cap at 400 for perf)
const MAX_NODES = 400;
const nodes = rawNodes.slice(0, MAX_NODES).map((n, i) => ({
  ...n,
  x: W/2 + (Math.random() - 0.5) * W * 0.6,
  y: H/2 + (Math.random() - 0.5) * H * 0.6,
  vx: 0, vy: 0,
}));
const nodeIdx = new Map(nodes.map((n, i) => [n.id, i]));

const edges = rawEdges.filter(e => nodeIdx.has(e.from) && nodeIdx.has(e.to));

// Radius by kind
function r(kind) {
  if (kind === 'file') return 9;
  if (kind === 'class' || kind === 'struct') return 7;
  return 5;
}

// Force simulation (simple spring + repulsion)
const REPULSION = 800;
const SPRING_LEN = 80;
const SPRING_K = 0.05;
const DAMPING = 0.85;
const DT = 0.6;

function tick() {
  const n = nodes.length;
  // Repulsion (O(n^2) capped by node count)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = nodes[j].x - nodes[i].x;
      const dy = nodes[j].y - nodes[i].y;
      const dist2 = dx*dx + dy*dy + 1;
      const force = REPULSION / dist2;
      const fx = force * dx / Math.sqrt(dist2);
      const fy = force * dy / Math.sqrt(dist2);
      nodes[i].vx -= fx; nodes[i].vy -= fy;
      nodes[j].vx += fx; nodes[j].vy += fy;
    }
  }
  // Spring
  for (const e of edges) {
    const a = nodes[nodeIdx.get(e.from)];
    const b = nodes[nodeIdx.get(e.to)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx*dx + dy*dy) || 1;
    const f = SPRING_K * (dist - SPRING_LEN);
    const fx = f * dx/dist, fy = f * dy/dist;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }
  // Center gravity
  for (const n of nodes) {
    n.vx += (W/2 - n.x) * 0.002;
    n.vy += (H/2 - n.y) * 0.002;
    n.vx *= DAMPING; n.vy *= DAMPING;
    n.x += n.vx * DT; n.y += n.vy * DT;
  }
}

// Camera
let camX = 0, camY = 0, camZ = 1;
function toScreen(wx, wy) { return [(wx + camX) * camZ + W/2, (wy + camY) * camZ + H/2]; }
function toWorld(sx, sy) { return [(sx - W/2) / camZ - camX, (sy - H/2) / camZ - camY]; }

// Draw
let highlighted = null;
let searchHit = null;

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();

  // Edges
  ctx.lineWidth = 0.8;
  for (const e of edges) {
    const a = nodes[nodeIdx.get(e.from)];
    const b = nodes[nodeIdx.get(e.to)];
    const [ax, ay] = toScreen(a.x, a.y);
    const [bx, by] = toScreen(b.x, b.y);
    const isHighlit = highlighted && (a.id === highlighted || b.id === highlighted);
    ctx.strokeStyle = isHighlit ? 'rgba(255,255,180,0.7)' : 'rgba(120,120,160,0.3)';
    ctx.lineWidth = isHighlit ? 1.5 : 0.8;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }

  // Nodes
  for (const n of nodes) {
    const [sx, sy] = toScreen(n.x, n.y);
    const radius = r(n.kind) * camZ;
    const col = colorMap[n.community ?? 0] || '#888';
    const isHit = n.id === searchHit;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(radius, 2), 0, Math.PI*2);
    ctx.fillStyle = isHit ? '#fff' : col;
    ctx.globalAlpha = highlighted && n.id !== highlighted ? 0.35 : 1;
    ctx.fill();
    if (n.kind === 'file' || n.id === highlighted || isHit) {
      ctx.fillStyle = '#eee';
      ctx.font = \`\${Math.max(9, 11*camZ)}px monospace\`;
      ctx.fillText(n.label, sx + radius + 2, sy + 4);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

let simRunning = true;
let frame = 0;

function loop() {
  if (simRunning) { tick(); frame++; if (frame > 300) simRunning = false; }
  draw();
  requestAnimationFrame(loop);
}

function restart() {
  simRunning = true; frame = 0;
  for (const n of nodes) { n.vx = 0; n.vy = 0; }
}

loop();

// Build legend
const seen = new Set();
let legendHtml = '<b>communities</b><br>';
for (const n of nodes) {
  const c = n.community ?? 0;
  if (!seen.has(c)) {
    seen.add(c);
    const col = colorMap[c] || '#888';
    legendHtml += \`<span style="color:\${col}">■</span> \${commLabels[c] || c}<br>\`;
  }
}
legend.innerHTML = legendHtml;

// Hover
canvas.addEventListener('mousemove', (ev) => {
  const [wx, wy] = toWorld(ev.clientX, ev.clientY);
  let found = null;
  for (const n of nodes) {
    const dx = n.x - wx, dy = n.y - wy;
    if (Math.sqrt(dx*dx+dy*dy) < r(n.kind) + 2) { found = n; break; }
  }
  highlighted = found ? found.id : null;
  if (found) {
    const outgoing = rawEdges.filter(e => e.from === found.id).slice(0, 6);
    const incoming = rawEdges.filter(e => e.to === found.id).slice(0, 6);
    tooltip.style.display = 'block';
    tooltip.style.left = (ev.clientX + 14) + 'px';
    tooltip.style.top = (ev.clientY - 10) + 'px';
    tooltip.innerHTML =
      \`<b>\${found.label}</b> [\${found.kind}]<br>\${found.file}:\${found.line}\` +
      (outgoing.length ? '<br><br><b>→</b> ' + outgoing.map(e=>e.to.split('#').pop()).join(', ') : '') +
      (incoming.length ? '<br><b>←</b> ' + incoming.map(e=>e.from.split('#').pop()).join(', ') : '');
  } else {
    tooltip.style.display = 'none';
  }
});

// Pan
let drag = false, dragStart = [0,0], camStart = [0,0];
canvas.addEventListener('mousedown', ev => { drag = true; dragStart = [ev.clientX, ev.clientY]; camStart = [camX, camY]; });
canvas.addEventListener('mouseup', () => drag = false);
canvas.addEventListener('mousemove', ev => {
  if (!drag) return;
  camX = camStart[0] + (ev.clientX - dragStart[0]) / camZ;
  camY = camStart[1] + (ev.clientY - dragStart[1]) / camZ;
});

// Zoom
canvas.addEventListener('wheel', ev => {
  ev.preventDefault();
  const factor = ev.deltaY > 0 ? 0.9 : 1.1;
  camZ = Math.max(0.1, Math.min(5, camZ * factor));
}, { passive: false });

// Search
document.getElementById('searchInput').addEventListener('input', ev => {
  const q = ev.target.value.toLowerCase();
  if (!q) { searchHit = null; return; }
  const hit = nodes.find(n => n.label.toLowerCase().includes(q) || n.file.toLowerCase().includes(q));
  if (hit) {
    searchHit = hit.id;
    camX = -hit.x; camY = -hit.y; camZ = 1.5;
  }
});

})();
</script>
</body>
</html>`;
}

module.exports = { buildHtml };
