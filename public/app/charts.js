/* =========================================================================
   charts — inline SVG, hairline chrome, hue only where it means something
   ========================================================================= */
const TIP = document.createElement('div');
TIP.className = 'tip';
document.body.appendChild(TIP);
function tipShow(e, html) {
  TIP.innerHTML = html;
  TIP.classList.add('tip--on');
  const pad = 14, w = TIP.offsetWidth, h = TIP.offsetHeight;
  let x = e.clientX + pad, y = e.clientY - h - 10;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y < 8) y = e.clientY + pad;
  TIP.style.left = x + 'px'; TIP.style.top = y + 'px';
}
function tipHide() { TIP.classList.remove('tip--on'); }
document.addEventListener('scroll', tipHide, true);

const svgNS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, parent) {
  const n = document.createElementNS(svgNS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function niceMax(v) {
  if (v <= 5) return 5;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  for (const s of steps) if (v <= s * mag) return s * mag;
  return 10 * mag;
}
/* rounded only at the data end, anchored to the baseline */
function barPath(x, y, w, h, r, dir) {
  r = Math.min(r, h / 2, w / 2);
  if (h <= 0.4) return `M${x} ${y + h} h${w}`;
  if (dir === 'up')
    return `M${x} ${y + h} V${y + r} a${r} ${r} 0 0 1 ${r} ${-r} h${w - 2 * r} a${r} ${r} 0 0 1 ${r} ${r} V${y + h} Z`;
  return `M${x} ${y} h${w - r} a${r} ${r} 0 0 1 ${r} ${r} v${h - 2 * r} a${r} ${r} 0 0 1 ${-r} ${r} H${x} Z`;
}

/* ── area + line: volume over time ───────────────────────────────────── */
function hostW(host, min) {
  return Math.max(min || 320, Math.round(host.getBoundingClientRect().width) || 1000);
}
function chartArea(host, series, opts = {}) {
  const W = hostW(host), H = opts.height || 210, P = { t: 12, r: 8, b: 26, l: 34 };
  host.innerHTML = '';
  if (!series.length) { host.innerHTML = '<div class="empty">No tickets in this range.</div>'; return; }
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, host);
  svg.style.height = H + 'px';
  const max = niceMax(Math.max(...series.map(d => d.total), 1));
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const X = i => P.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
  const Y = v => P.t + ih - (v / max) * ih;

  for (let g = 0; g <= 4; g++) {
    const y = P.t + (g / 4) * ih;
    el('line', { x1: P.l, x2: W - P.r, y1: y, y2: y, class: 'grid-line' }, svg);
    el('text', { x: P.l - 7, y: y + 3.5, 'text-anchor': 'end', class: 'axis-label' }, svg)
      .textContent = Math.round(max - (g / 4) * max);
  }
  const line = series.map((d, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(d.total).toFixed(1)}`).join(' ');
  el('path', { d: `${line} L${X(series.length - 1)} ${P.t + ih} L${X(0)} ${P.t + ih} Z`,
    fill: 'var(--s1)', opacity: .1 }, svg);
  el('path', { d: line, fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);

  const ticks = Math.min(W < 560 ? 4 : 7, series.length);
  for (let i = 0; i < ticks; i++) {
    const idx = Math.round((i / (ticks - 1 || 1)) * (series.length - 1));
    el('text', { x: X(idx), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === ticks - 1 ? 'end' : 'middle',
      class: 'axis-label' }, svg).textContent = series[idx].label;
  }
  const cross = el('line', { y1: P.t, y2: P.t + ih, class: 'axis-line', opacity: 0 }, svg);
  const dot = el('circle', { r: 3.5, fill: 'var(--s1)', stroke: 'var(--card)', 'stroke-width': 2, opacity: 0 }, svg);
  const hit = el('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' }, svg);
  hit.addEventListener('mousemove', e => {
    const bb = svg.getBoundingClientRect();
    const rel = ((e.clientX - bb.left) / bb.width) * W;
    const i = Math.max(0, Math.min(series.length - 1,
      Math.round(((rel - P.l) / iw) * (series.length - 1))));
    const d = series[i];
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('opacity', 1);
    dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(d.total)); dot.setAttribute('opacity', 1);
    tipShow(e, `<div>${fmtDate(d.date)}</div><b>${d.total}</b> tickets · ${d.solved} solved`);
  });
  hit.addEventListener('mouseleave', () => { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); tipHide(); });
}

/* ── columns: hourly load, peak window emphasised ────────────────────── */
function chartHours(host, byHour, peak, opts = {}) {
  const W = hostW(host), narrow = W < 620;
  const H = opts.height || (narrow ? 210 : 230), P = { t: 14, r: 8, b: narrow ? 46 : 40, l: 34 };
  host.innerHTML = '';
  const total = byHour.reduce((a, b) => a + b, 0);
  if (!total) { host.innerHTML = '<div class="empty">No tickets in this range.</div>'; return; }
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, host);
  svg.style.height = H + 'px';
  const max = niceMax(Math.max(...byHour));
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const slot = iw / 24, bw = Math.max(3, Math.min(slot - (narrow ? 2 : 6), 30));
  const Y = v => P.t + ih - (v / max) * ih;
  const inPeak = h => {
    if (!peak) return false;
    const n = (h - peak.start + 24) % 24;
    return n < peak.len;
  };

  for (let g = 0; g <= 4; g++) {
    const y = P.t + (g / 4) * ih;
    el('line', { x1: P.l, x2: W - P.r, y1: y, y2: y, class: 'grid-line' }, svg);
    el('text', { x: P.l - 7, y: y + 3.5, 'text-anchor': 'end', class: 'axis-label' }, svg)
      .textContent = Math.round(max - (g / 4) * max);
  }
  if (peak && peak.len < 24) {
    const runs = [];
    let s = peak.start;
    if (peak.start + peak.len <= 24) runs.push([peak.start, peak.len]);
    else { runs.push([peak.start, 24 - peak.start]); runs.push([0, peak.len - (24 - peak.start)]); }
    runs.forEach(([st, ln]) => {
      el('rect', { x: P.l + st * slot, y: P.t - 4, width: ln * slot, height: ih + 4,
        fill: 'var(--s1)', opacity: .08, rx: 4 }, svg);
    });
  }
  byHour.forEach((v, h) => {
    const x = P.l + h * slot + (slot - bw) / 2, y = Y(v), hh = P.t + ih - y;
    const hot = inPeak(h);
    /* every hour is coloured; the peak window simply runs darker */
    el('path', { d: barPath(x, y, bw, hh, 4, 'up'),
      fill: hot ? 'var(--ord4)' : 'var(--ord2)' }, svg);
    const r = el('rect', { x: P.l + h * slot, y: P.t, width: slot, height: ih, fill: 'transparent' }, svg);
    r.addEventListener('mousemove', e => tipShow(e,
      `<div>${String(h).padStart(2, '0')}:00 – ${String((h + 1) % 24).padStart(2, '0')}:00 IST</div>
       <b>${v}</b> tickets · ${pct1(v, total)}% of range<div style="opacity:.7">${istToPst(h)} PST</div>`));
    r.addEventListener('mouseleave', tipHide);
  });
  const every = slot < 20 ? (slot < 13 ? 4 : 2) : 1;
  for (let h = 0; h < 24; h++) {
    if (h % every) continue;
    el('text', { x: P.l + h * slot + slot / 2, y: H - (narrow ? 30 : 24), 'text-anchor': 'middle', class: 'axis-label' }, svg)
      .textContent = String(h).padStart(2, '0');
  }
  el('text', { x: P.l, y: H - (narrow ? 16 : 8), class: 'axis-label' }, svg).textContent = 'Hour of day · IST';
  if (peak) {
    const label = `Peak ${String(peak.start).padStart(2, '0')}:00–${String(peak.end).padStart(2, '0')}:00 IST · ${istToPst(peak.start)}–${istToPst(peak.end)} PST`;
    el('text', narrow ? { x: P.l, y: H - 2, class: 'mark-label' }
                      : { x: W - P.r, y: H - 8, 'text-anchor': 'end', class: 'mark-label' }, svg)
      .textContent = label;
  }
}

/* ── horizontal bars: one series, one colour ─────────────────────────── */
function chartBars(host, items, opts = {}) {
  host.innerHTML = '';
  if (!items.length) { host.innerHTML = `<div class="empty">${opts.empty || 'Nothing to show.'}</div>`; return; }
  const max = Math.max(...items.map(d => d.value), 1);
  const wrap = document.createElement('div');
  wrap.style.display = 'grid';
  wrap.style.gap = opts.gap || '7px';
  items.forEach(d => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:' + (opts.labelWidth || '148px') +
      ' 1fr auto;gap:10px;align-items:center;';
    const lab = document.createElement('div');
    lab.style.cssText = 'font-size:12.5px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    lab.textContent = d.label; lab.title = d.label;
    const track = document.createElement('div');
    track.style.cssText = 'height:9px;border-radius:4px;background:var(--line2);overflow:hidden';
    const fill = document.createElement('i');
    fill.style.cssText = `display:block;height:100%;border-radius:4px;width:${(d.value / max) * 100}%;background:${d.color || 'var(--s1)'}`;
    track.appendChild(fill);
    const val = document.createElement('div');
    val.style.cssText = 'font-size:12px;font-weight:640;font-variant-numeric:tabular-nums;min-width:64px;text-align:right';
    val.innerHTML = `${num(d.value)}${d.sub ? ` <span style="color:var(--ink3);font-weight:400">${d.sub}</span>` : ''}`;
    row.append(lab, track, val);
    row.addEventListener('mousemove', e => tipShow(e, d.tip || `<div>${d.label}</div><b>${num(d.value)}</b>`));
    row.addEventListener('mouseleave', tipHide);
    wrap.appendChild(row);
  });
  host.appendChild(wrap);
}

/* ── stacked columns by month ────────────────────────────────────────── */
function chartMonths(host, months, opts = {}) {
  const W = hostW(host), H = opts.height || 200, P = { t: 14, r: 8, b: 32, l: 38 };
  host.innerHTML = '';
  if (!months.length) { host.innerHTML = '<div class="empty">No tickets in this range.</div>'; return; }
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, host);
  svg.style.height = H + 'px';
  const max = niceMax(Math.max(...months.map(m => m.total)));
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const slot = iw / months.length, bw = Math.max(10, Math.min(slot - 26, 74));
  const Y = v => P.t + ih - (v / max) * ih;
  for (let g = 0; g <= 4; g++) {
    const y = P.t + (g / 4) * ih;
    el('line', { x1: P.l, x2: W - P.r, y1: y, y2: y, class: 'grid-line' }, svg);
    el('text', { x: P.l - 7, y: y + 3.5, 'text-anchor': 'end', class: 'axis-label' }, svg)
      .textContent = Math.round(max - (g / 4) * max);
  }
  months.forEach((m, i) => {
    const x = P.l + i * slot + (slot - bw) / 2;
    const segs = [
      { v: m.solved,   c: 'var(--s1)',   n: 'Solved' },
      { v: m.progress, c: 'var(--mark)', n: 'In progress' },
      { v: m.pending,  c: 'var(--warn)', n: 'Pending' },
    ].filter(s => s.v > 0);
    let acc = 0;
    segs.forEach((s, si) => {
      const y0 = Y(acc + s.v), y1 = Y(acc);
      const h = Math.max(1, y1 - y0 - (si < segs.length - 1 ? 2 : 0));
      el('path', { d: barPath(x, y0, bw, h, si === segs.length - 1 ? 4 : 0, 'up'), fill: s.c }, svg);
      acc += s.v;
    });
    el('text', { x: x + bw / 2, y: Y(m.total) - 7, 'text-anchor': 'middle', class: 'mark-label' }, svg)
      .textContent = num(m.total);
    el('text', { x: x + bw / 2, y: H - 12, 'text-anchor': 'middle', class: 'axis-label' }, svg)
      .textContent = m.label;
    const hit = el('rect', { x: P.l + i * slot, y: P.t, width: slot, height: ih, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', e => tipShow(e,
      `<div>${fmtMonth(m.key, true)}</div><b>${m.total}</b> tickets<div style="opacity:.75">${m.solved} solved · ${m.progress} in progress · ${m.pending} pending</div>`));
    hit.addEventListener('mouseleave', tipHide);
  });
}

/* ── grouped bars: L1 vs L3 per agent ────────────────────────────────── */
function chartAgents(host, owners) {
  host.innerHTML = '';
  if (!owners.length) { host.innerHTML = '<div class="empty">No agent handled a ticket in this range.</div>'; return; }
  const max = Math.max(...owners.map(o => o.total), 1);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:grid;gap:9px';
  owners.forEach(o => {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:86px 1fr auto;gap:10px;align-items:center';
    const lab = document.createElement('div');
    lab.style.cssText = 'font-size:12.5px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    lab.textContent = o.name;
    const track = document.createElement('div');
    track.style.cssText = 'display:flex;gap:2px;height:10px;align-items:stretch';
    const a = document.createElement('i');
    a.style.cssText = `display:block;background:var(--s1);border-radius:4px 0 0 4px;width:${(o.l1 / max) * 100}%`;
    const b = document.createElement('i');
    b.style.cssText = `display:block;background:var(--s2);border-radius:0 4px 4px 0;width:${(o.l3 / max) * 100}%`;
    if (!o.l3) a.style.borderRadius = '4px';
    if (!o.l1) b.style.borderRadius = '4px';
    track.append(a, b);
    const val = document.createElement('div');
    val.style.cssText = 'font-size:12px;font-weight:640;font-variant-numeric:tabular-nums;min-width:40px;text-align:right';
    val.textContent = num(o.total);
    row.append(lab, track, val);
    row.addEventListener('mousemove', e => tipShow(e,
      `<div>${o.name}</div><b>${o.total}</b> tickets<div style="opacity:.75">${o.l1} handled at L1 · ${o.l3} escalated to L3</div>`));
    row.addEventListener('mouseleave', tipHide);
    wrap.appendChild(row);
  });
  host.appendChild(wrap);
  const lg = document.createElement('div');
  lg.className = 'legend';
  lg.innerHTML = `<span><i class="swatch" style="background:var(--s1)"></i>L1 · self-served</span>
                  <span><i class="swatch" style="background:var(--s2)"></i>L3 · escalated</span>`;
  host.appendChild(lg);
}

/* ── ordinal buckets (ordered categories → one-hue ramp) ─────────────── */
const ORD = ['var(--ord2)', 'var(--ord3)', 'var(--ord4)', 'var(--ord5)', 'var(--ord5)'];
function chartOrdinal(host, items, opts = {}) {
  chartBars(host, items.map((d, i) => ({ ...d, color: ORD[Math.min(i, ORD.length - 1)] })),
    { labelWidth: opts.labelWidth || '96px', gap: '8px' });
}

/* ── donut: part-to-whole, labelled inside the ring ──────────────────── */
function chartDonut(host, segs, opts = {}) {
  host.innerHTML = '';
  const total = segs.reduce((a, s) => a + s.value, 0);
  if (!total) { host.innerHTML = '<div class="empty">Nothing to show.</div>'; return; }
  const W = Math.max(340, Math.round(host.getBoundingClientRect().width) || 460);
  const H = opts.height || 330;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, host);
  svg.style.height = H + 'px';
  const cx = W / 2, cy = H / 2;
  /* every label sits outside on a leader — a name + number + share is wider
     than any ring band, so inside labels clip on the arc */
  const ro = Math.max(60, Math.min(W / 2 - 104, H / 2 - 30));
  const ri = ro * 0.56;
  const pt = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

  let a0 = -Math.PI / 2;
  segs.forEach(s => {
    const frac = s.value / total, a1 = a0 + frac * Math.PI * 2, big = frac > .5 ? 1 : 0;
    const [x0, y0] = pt(ro, a0), [x1, y1] = pt(ro, a1);
    const [u0, v0] = pt(ri, a1), [u1, v1] = pt(ri, a0);
    const path = el('path', {
      d: `M${x0} ${y0} A${ro} ${ro} 0 ${big} 1 ${x1} ${y1} L${u0} ${v0} A${ri} ${ri} 0 ${big} 0 ${u1} ${v1} Z`,
      fill: s.color, stroke: 'var(--card)', 'stroke-width': 3,
    }, svg);
    path.addEventListener('mousemove', e => tipShow(e,
      `<div>${esc(s.label)}</div><b>${num(s.value)}</b> tickets · ${pct1(s.value, total)}%`));
    path.addEventListener('mouseleave', tipHide);

    const am = (a0 + a1) / 2, right = Math.cos(am) >= 0;
    const [ex, ey] = pt(ro + 4, am), [mx, my] = pt(ro + 18, am);
    const tx = right ? Math.min(mx + 14, W - 6) : Math.max(mx - 14, 6);
    const anchor = right ? 'start' : 'end';
    el('path', { d: `M${ex} ${ey} L${mx} ${my} L${right ? tx - 7 : tx + 7} ${my}`,
      fill: 'none', stroke: 'var(--line)', 'stroke-width': 1.5 }, svg);
    el('circle', { cx: right ? tx - 4 : tx + 4, cy: my, r: 3.5, fill: s.color }, svg);

    const g = el('g', {}, svg);
    el('text', { x: tx, y: my - 17, 'text-anchor': anchor, fill: 'var(--ink2)',
      'font-size': 11.5, 'font-weight': 600 }, g).textContent = s.label;
    el('text', { x: tx, y: my + 5, 'text-anchor': anchor, fill: 'var(--ink)',
      'font-size': 21, 'font-weight': 680, style: 'font-variant-numeric:tabular-nums' }, g)
      .textContent = num(s.value);
    el('text', { x: tx, y: my + 22, 'text-anchor': anchor, fill: 'var(--ink3)',
      'font-size': 12.5, 'font-weight': 600 }, g).textContent = pct1(s.value, total) + '%';
    a0 = a1;
  });

  el('text', { x: cx, y: cy - 6, 'text-anchor': 'middle', fill: 'var(--ink3)',
    'font-size': 10.5, 'font-weight': 700, style: 'letter-spacing:.08em' }, svg)
    .textContent = (opts.centreLabel || 'TOTAL').toUpperCase();
  el('text', { x: cx, y: cy + 18, 'text-anchor': 'middle', fill: 'var(--ink)',
    'font-size': 23, 'font-weight': 680, style: 'font-variant-numeric:tabular-nums' }, svg)
    .textContent = num(total);
}

/* ── time brackets: Explore's bar, value inside the bar, empties dropped ── */
function chartBracket(host, rows, colour, opts = {}) {
  host.innerHTML = '';
  const live = rows.filter(r => r.count > 0).sort((a, b) => a.count - b.count);
  if (!live.length) {
    host.innerHTML = `<div class="empty">${opts.empty || 'Nothing in this bracket yet.'}</div>`;
    return;
  }
  const max = Math.max(...live.map(r => r.count));
  const total = rows.reduce((a, r) => a + r.count, 0);
  const wrap = document.createElement('div');
  live.forEach((r, i) => {
    const pct = (r.count / max) * 100, inside = pct > 15;
    const row = document.createElement('div');
    row.className = 'brow';
    row.innerHTML = `<span class="blab">${esc(r.label)}</span>
      <span class="btrack">
        <i class="bfill" style="--w:${pct}%;background:${colour};animation-delay:${i * 60}ms">${inside ? num(r.count) : ''}</i>
        ${inside ? '' : `<b class="bout" style="left:calc(${pct}% + 10px)">${num(r.count)}</b>`}
      </span>`;
    row.addEventListener('mousemove', e => tipShow(e,
      `<div>${esc(r.label)}</div><b>${num(r.count)}</b> tickets · ${pct1(r.count, total)}%`));
    row.addEventListener('mouseleave', tipHide);
    wrap.appendChild(row);
  });
  host.appendChild(wrap);
}

