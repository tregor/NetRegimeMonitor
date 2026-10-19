// Порт canvas-графиков dashboard.js (фреймворк-независимые функции).
export const COLORS = { ru: '#3b82f6', global: '#10b981', restricted: '#f59e0b' };
export const STATE_COLORS = { OUTAGE: '#ef4444', ALLOWLIST: '#f59e0b', FILTERED: '#f97316', OPEN: '#10b981', MIXED: '#64748b', FOREIGN: '#8b5cf6', CHECKING: '#3b82f6' };

export function fmtShort(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
export function fmtTime(ts) { return new Date(ts).toLocaleString('ru-RU'); }
export function groupAvail(rec, g) {
  const arr = rec.groups[g] || [];
  if (!arr.length) return null;
  const ok = arr.filter((x) => !x.loading && x.ok).length;
  const total = arr.filter((x) => !x.loading).length || arr.length;
  return total ? (ok / total) * 100 : 0;
}
export function groupLatency(rec, g) {
  const arr = (rec.groups[g] || []).filter((x) => !x.loading && x.ok && x.latency);
  if (!arr.length) return null;
  return Math.round(arr.reduce((s, x) => s + x.latency, 0) / arr.length);
}
export function pearson(a, b) {
  if (a.length !== b.length || a.length < 3) return null;
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const xa = a[i] - ma, yb = b[i] - mb; num += xa * yb; da += xa * xa; db += yb * yb; }
  const den = Math.sqrt(da * db);
  if (den === 0) return 0;
  return Math.max(-1, Math.min(1, num / den));
}

function clearCanvas(c) { const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); return ctx; }

export function drawLineChart(canvas, series, opts = {}) {
  if (!canvas) return;
  const ctx = clearCanvas(canvas);
  const W = canvas.width, H = canvas.height;
  const pad = { l: 40, r: 10, t: 10, b: 24 };
  const w = W - pad.l - pad.r, h = H - pad.t - pad.b;
  ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (h * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = '#64748b'; ctx.font = '10px system-ui';
    ctx.fillText((100 - i * 25).toFixed(0) + '%', 2, y + 3);
  }
  if (opts.yMaxLatency) {
    ctx.clearRect(0, 0, 40, H);
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (h * i) / 4;
      const val = opts.yMaxLatency - (i * opts.yMaxLatency) / 4;
      ctx.fillStyle = '#64748b'; ctx.font = '10px system-ui';
      ctx.fillText(Math.round(val) + 'мс', 2, y + 3);
      ctx.strokeStyle = '#1e293b'; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    }
  }
  const n = series[0]?.data.length || 0;
  if (!n) return;
  const xStep = w / Math.max(1, n - 1);
  if (opts.labels) {
    ctx.fillStyle = '#475569'; ctx.font = '9px system-ui';
    const step = Math.ceil(n / 8);
    opts.labels.forEach((lb, i) => { if (i % step === 0) { const x = pad.l + i * xStep; ctx.fillText(lb, x - 12, H - 4); } });
  }
  series.forEach((s) => {
    ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.beginPath();
    s.data.forEach((v, i) => {
      const x = pad.l + i * xStep;
      let y;
      if (opts.yMaxLatency !== undefined) { const max = opts.yMaxLatency || 1; y = pad.t + h * (1 - Math.min(v, max) / max); }
      else y = pad.t + h * (1 - (v === null ? 0 : v) / 100);
      if (v === null) ctx.moveTo(x, y);
      else if (i === 0 || s.data[i - 1] === null) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
}

export function drawStateDist(canvas, counts, total) {
  if (!canvas) return;
  const ctx = clearCanvas(canvas);
  const W = canvas.width, H = canvas.height;
  const count = total ?? Object.values(counts).reduce((s, v) => s + v, 0);
  const t = count || 1; // denominator only; never display an invented check
  const y = H / 2, r = Math.min(90, H * 0.35);
  let start = -Math.PI / 2;
  for (const [code, cnt] of Object.entries(counts)) {
    const ang = (cnt / t) * 2 * Math.PI;
    ctx.fillStyle = STATE_COLORS[code] || '#64748b';
    ctx.beginPath(); ctx.moveTo(W * 0.32, y); ctx.arc(W * 0.32, y, r, start, start + ang); ctx.closePath(); ctx.fill();
    start += ang;
  }
  ctx.fillStyle = '#0b1222'; ctx.beginPath(); ctx.arc(W * 0.32, y, r * 0.55, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(count + ' проверок', W * 0.32, y + 4);
}

export function drawHeatmap(canvas, ordered) {
  if (!canvas) return;
  const ctx = clearCanvas(canvas);
  const W = canvas.width, H = canvas.height;
  const pad = { l: 40, r: 10, t: 10, b: 24 };
  const w = W - pad.l - pad.r, h = H - pad.t - pad.b;
  const n = ordered.length || 1;
  const colW = w / n;
  ['ru', 'global', 'restricted'].forEach((g, gi) => {
    const y0 = pad.t + gi * (h / 3) + 2;
    const rh = h / 3 - 4;
    ordered.forEach((rec, i) => {
      const v = groupAvail(rec, g);
      const x = pad.l + i * colW;
      let col = '#334155';
      if (v !== null) { if (v >= 80) col = COLORS[g]; else if (v >= 40) col = '#f59e0b'; else col = '#ef4444'; }
      ctx.fillStyle = col;
      ctx.fillRect(x, y0, Math.max(1, colW - 1), rh);
    });
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px system-ui'; ctx.fillText(g, 6, y0 + rh / 2 + 3);
  });
  ctx.fillStyle = '#475569'; ctx.font = '9px system-ui';
  const step = Math.ceil(n / 12);
  ordered.forEach((rec, i) => { if (i % step === 0) { const x = pad.l + i * colW; ctx.fillText(fmtShort(rec.at), x - 10, H - 6); } });
}
