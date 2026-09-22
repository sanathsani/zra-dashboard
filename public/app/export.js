/* =========================================================================
   export — one deck model, two renderers (PowerPoint and PDF)
   Both are drawn natively: real text, real tables, real charts. No screenshots.
   ========================================================================= */
const CDN = {
  pptx: 'https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
};
function loadScript(src) {
  return new Promise((ok, no) => {
    if ([...document.scripts].some(s => s.src === src)) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => no(new Error('offline'));
    document.head.appendChild(s);
  });
}

const EX = {
  ink: '14161A', ink2: '4A5058', mute: '7D848D', line: 'E4E4E0', soft: 'F5F5F3',
  accent: '2A78D6', accentSoft: 'D8E6FA', mark: '9AA1AA', warn: 'FAB219', crit: 'D03B3B', good: '0CA30C',
  ord: ['86B6EF', '5598E7', '2A78D6', '1C5CAB', '1C5CAB'],
};

function deckModel() {
  const s = D.summary, sla = D.sla;
  const period = `${fmtDate(D.from)} – ${fmtDate(D.to)}`;
  const n = id => (NOTES[noteKey(id)] || '').trim();
  const resL1 = sla.resL1Cust + sla.resL1Auto, resL3 = sla.resL3Cust + sla.resL3Auto;
  const slides = [];

  slides.push({ kind: 'cover', title: 'Skild-Fetch <> Awign', sub: period,
    line: 'Call Support Operations — Performance Review', foot: 'Awign Enterprises' });

  slides.push({
    title: 'Current metrics', sub: period,
    kpis: [
      { label: 'Created tickets', value: num(s.total) },
      { label: 'Solved tickets', value: num(s.solved) },
      { label: 'Solved Tickets - L1', value: num(s.l1Solved) },
      { label: 'Solved Tickets - L3', value: num(s.l3Solved) },
      { label: 'Resolution rate', value: pct1(s.solved, s.total) + '%' },
    ],
    kpis2: [
      { label: 'Unsolved tickets', value: num(s.open) },
      { label: 'Unsolved Tickets - L1', value: num(s.l1Open) },
      { label: 'Unsolved Tickets - L3', value: num(s.l3Open) },
      { label: 'Customer tickets', value: num(s.cust) },
      { label: 'Auto-generated tickets', value: num(s.auto) },
    ],
    bullets: [
      `The team handled ${num(s.total)} support tickets (${period}), achieving an overall resolution rate of ${pct2(s.solved, s.total)}%, with ${num(s.solved)} tickets resolved during the reporting period.`,
      `${pct2(s.l1Solved, s.total)}% of tickets were resolved at L1, while ${pct2(s.l3Solved, s.total)}% required L3 support.`,
      s.open
        ? `At the end of the reporting period ${num(s.open)} tickets (${pct2(s.open, s.total)}%) remained open and are under active investigation.`
        : 'No tickets remained open at the end of the reporting period.',
    ],
    note: n('s1'),
  });

  slides.push({
    title: 'Tickets by status', sub: 'All tickets, L1 and L3 counted separately',
    table: {
      head: ['', 'Solved', 'In progress', 'Pending', 'Total', 'Resolution rate'],
      w: [0.24, 0.16, 0.16, 0.14, 0.14, 0.16],
      align: ['l', 'r', 'r', 'r', 'r', 'r'],
      rows: [
        ['All tickets', num(s.solved), num(s.progress), num(s.pending), num(s.total), pct1(s.solved, s.total) + '%'],
        ['L1 tickets', num(s.l1Solved), num(s.l1Progress), num(s.l1Pending), num(s.l1), pct1(s.l1Solved, s.l1) + '%'],
        ['L3 tickets', num(s.l3Solved), num(s.l3Progress), num(s.l3Pending), num(s.l3), pct1(s.l3Solved, s.l3) + '%'],
      ],
    },
    note: n('s2'),
  });

  slides.push({
    title: 'Ticket issue category summary', sub: `${D.cats.length} categories · ${period}`,
    table: {
      head: ['#', 'Issue category', 'No. of tickets', '% of total', 'L1 resolved', 'L3 resolved', 'Pending L1', 'Pending L3'],
      w: [0.05, 0.31, 0.11, 0.12, 0.13, 0.13, 0.075, 0.075],
      align: ['l', 'l', 'r', 'r', 'r', 'r', 'r', 'r'],
      rows: D.cats.map((c, i) => [String(i + 1), c.name, num(c.total), pct2(c.total, D.total) + '%',
        String(c.l1Solved), String(c.l3Solved), String(c.l1Open), String(c.l3Open)]),
      total: ['', 'Total', num(D.total), '100.00%',
        num(D.cats.reduce((a, c) => a + c.l1Solved, 0)), num(D.cats.reduce((a, c) => a + c.l3Solved, 0)),
        num(D.cats.reduce((a, c) => a + c.l1Open, 0)), num(D.cats.reduce((a, c) => a + c.l3Open, 0))],
    },
    note: n('s3'),
  });

  /* customers × categories — split so a slide never carries more than 14 rows */
  {
    const cats = D.cats.slice().sort((a, b) => a.name.localeCompare(b.name));
    const rows = D.customersShown.filter(c => c.total > 0);
    const w = [0.04, 0.2].concat(cats.map(() => (1 - 0.24 - 0.08) / cats.length)).concat([0.08]);
    const align = ['l', 'l'].concat(cats.map(() => 'r')).concat(['r']);
    const head = ['#', 'Customers'].concat(cats.map(c => c.name)).concat(['Total']);
    const PER = 14;
    for (let i = 0; i < rows.length; i += PER) {
      const chunk = rows.slice(i, i + PER);
      const body = chunk.map((c, j) => [String(i + j + 1), c.name]
        .concat(cats.map(cat => String(c.cats[cat.id] || 0))).concat([num(c.total)]));
      const last = i + PER >= rows.length;
      slides.push({
        title: 'Customers by issue category',
        sub: `${i + 1}–${Math.min(i + PER, rows.length)} of ${rows.length} accounts`,
        table: {
          head, w, align, rows: body,
          total: last ? ['', 'Grand total']
            .concat(cats.map(cat => String(rows.reduce((a, c) => a + (c.cats[cat.id] || 0), 0))))
            .concat([num(rows.reduce((a, c) => a + c.total, 0))]) : null,
        },
        note: i === 0 ? n('s4') : '',
      });
    }
  }

  slides.push({
    title: 'Tickets by customer', sub: `Top 10 accounts · ${period}`,
    bars: { labels: D.customersShown.slice(0, 10).map(c => c.name),
            values: D.customersShown.slice(0, 10).map(c => c.total), horizontal: true },
    note: n('s5'),
  });

  slides.push({
    title: 'Shift-wise load', sub: 'Ticket arrival by shift window · IST',
    table: {
      head: ['#', 'Shift name', 'Window (IST)', 'Ticket count', 'Percentage', 'Resolved', 'Resolution rate'],
      w: [0.06, 0.17, 0.22, 0.14, 0.14, 0.13, 0.14],
      align: ['l', 'l', 'l', 'r', 'r', 'r', 'r'],
      rows: D.shifts.map((x, i) => [String(i + 1), x.name, x.time, num(x.tickets),
        pct2(x.tickets, D.total) + '%', num(x.solved), pct1(x.solved, x.tickets) + '%']),
      total: ['', 'Total', '', num(D.total), '100.00%', num(s.solved), pct1(s.solved, D.total) + '%'],
    },
    note: n('s6'),
  });

  const pk = D.peak;
  slides.push({
    title: 'Hourly ticket volume analysis', sub: 'Arrival hour · IST',
    bullets: [
      `Total volume: ${num(D.total)} tickets were received during ${period}.`,
      pk ? `Peak window: the primary surge occurs between ${String(pk.start).padStart(2, '0')}:00 and ${String(pk.end).padStart(2, '0')}:00 IST — that is ${istToPst(pk.start)} – ${istToPst(pk.end)} PST — carrying ${num(pk.tickets)} tickets (${pct1(pk.tickets, D.total)}% of the period) in ${pk.len} of 24 hours.`
         : 'Volume is evenly spread across the day with no pronounced peak.',
    ],
    bars: { labels: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')),
      values: D.byHour.slice(), highlight: pk ? Array.from({ length: pk.len }, (_, i) => (pk.start + i) % 24) : [] },
    note: n('s7'),
  });

  if (s.open) slides.push({
    title: 'Unresolved tickets aging distribution',
    sub: `${num(s.open)} open · age measured at ${fmtDate(D.ageAt)}`,
    table: {
      head: ['Age bracket', 'Overall', 'L1 tickets', 'L3 engineering queue'],
      w: [0.34, 0.22, 0.22, 0.22], align: ['l', 'r', 'r', 'r'],
      rows: D.age.filter(a => a.all > 0).map(a => [a.label, String(a.all), String(a.l1), String(a.l3)]),
      total: ['Total', String(s.open), String(s.l1Open), String(s.l3Open)],
    },
    note: n('s8'),
  });

  slides.push({
    title: 'Target restoration time by time bracket', sub: `${num(s.solved)} solved tickets · created to solved`,
    bars: { labels: D.resTime.map(b => b.label), values: D.resTime.map(b => b.count), horizontal: true, ordinal: true },
    note: n('s9'),
  });

  slides.push({
    title: 'SLA compliance', sub: period,
    kpis: [
      { label: 'First Response SLA Compliance %', value: pct1(sla.frClocks - sla.fr, sla.frClocks) + '%' },
      { label: 'First Response SLA breached tickets', value: num(sla.fr) },
      { label: 'Resolution SLA Compliance %', value: pct1(sla.resClocks - sla.res, sla.resClocks) + '%' },
      { label: 'Resolution SLA breached tickets - L1', value: num(resL1) },
      { label: 'Resolution SLA breached tickets - L3', value: num(resL3) },
    ],
    table: {
      head: ['Ticket type', '1st Response SLA breached', 'L1 - Resolution SLA breached', 'L3 - Resolution SLA breached'],
      w: [0.28, 0.24, 0.24, 0.24], align: ['l', 'r', 'r', 'r'],
      rows: [
        ['Customer tickets', num(sla.frCust), num(sla.resL1Cust), num(sla.resL3Cust)],
        ['Auto-generated tickets', num(sla.frAuto), num(sla.resL1Auto), num(sla.resL3Auto)],
      ],
      total: ['Total', num(sla.fr), num(resL1), num(resL3)],
    },
    note: n('s10'),
  });

  slides.push({
    title: 'Agent contribution', sub: `${D.owners.length} agents active in period`,
    table: {
      head: ['Agent', 'Role', 'Tickets', 'L1', 'L3', 'Resolved', 'Resolution rate'],
      w: [0.22, 0.18, 0.12, 0.12, 0.12, 0.12, 0.12], align: ['l', 'l', 'r', 'r', 'r', 'r', 'r'],
      rows: D.owners.map(o => [o.name, o.role, num(o.total), num(o.l1), num(o.l3), num(o.solved),
        pct1(o.solved, o.total) + '%']),
    },
    foot: D.dormant.length ? `On the roster but no tickets in this period: ${D.dormant.join(', ')}.` : '',
    note: n('s11'),
  });

  slides.push({ kind: 'end', title: 'Thank you' });
  return slides;
}

/* ── PowerPoint ──────────────────────────────────────────────────────── */
async function toPptx(slides, name) {
  await loadScript(CDN.pptx);
  const p = new PptxGenJS();
  p.layout = 'LAYOUT_16x9';               // 10 × 5.625 in
  p.author = 'Awign Enterprises';
  p.title = 'Skild-Fetch <> Awign — Performance Review';
  const W = 10, M = 0.55;

  slides.forEach(sp => {
    const s = p.addSlide();
    if (sp.kind === 'cover') {
      s.addShape(p.ShapeType.rect, { x: 0, y: 0, w: W, h: 5.625, fill: { color: EX.ink } });
      s.addText(sp.title, { x: M, y: 2.0, w: W - 2 * M, h: .6, fontSize: 34, bold: true, color: 'FFFFFF' });
      s.addText(sp.sub, { x: M, y: 2.62, w: W - 2 * M, h: .34, fontSize: 15, color: 'B9BEC6' });
      s.addText(sp.line, { x: M, y: 3.0, w: W - 2 * M, h: .34, fontSize: 13, color: '8E959E' });
      s.addText(sp.foot, { x: M, y: 4.8, w: W - 2 * M, h: .3, fontSize: 11, color: '8E959E' });
      return;
    }
    if (sp.kind === 'end') {
      s.addText(sp.title, { x: 0, y: 2.5, w: W, h: .6, fontSize: 26, bold: true, color: EX.ink, align: 'center' });
      return;
    }
    /* header */
    s.addText(sp.title, { x: M, y: .34, w: W - 2 * M - 1.6, h: .4, fontSize: 18, bold: true, color: EX.ink });
    if (sp.sub) s.addText(sp.sub, { x: W - M - 2.6, y: .4, w: 2.6, h: .3, fontSize: 10, color: EX.mute, align: 'right' });
    s.addShape(p.ShapeType.line, { x: M, y: .82, w: W - 2 * M, h: 0, line: { color: EX.line, width: 1 } });
    s.addText('Awign Enterprises', { x: M, y: 5.24, w: 3, h: .25, fontSize: 8, color: EX.mute });

    let y = 1.02;
    if (sp.kpis) {
      const n = sp.kpis.length, gap = .12, w = (W - 2 * M - gap * (n - 1)) / n;
      sp.kpis.forEach((k, i) => {
        const x = M + i * (w + gap);
        s.addShape(p.ShapeType.rect, { x, y, w, h: .92, fill: { color: EX.soft }, line: { color: EX.line, width: .6 } });
        s.addText(k.label.toUpperCase(), { x: x + .1, y: y + .08, w: w - .2, h: .2, fontSize: 7.5, bold: true, color: EX.mute, charSpacing: .6 });
        s.addText(String(k.value), { x: x + .1, y: y + .28, w: w - .2, h: .38, fontSize: 19, bold: true, color: EX.ink });
        if (k.note) s.addText(k.note, { x: x + .1, y: y + .66, w: w - .2, h: .2, fontSize: 8, color: EX.mute });
      });
      y += 1.04;
    }
    if (sp.kpis2) {
      const n = sp.kpis2.length, gap = .12, w = (W - 2 * M - gap * (n - 1)) / n;
      sp.kpis2.forEach((k, i) => {
        const x = M + i * (w + gap);
        s.addShape(p.ShapeType.rect, { x, y, w, h: .92, fill: { color: EX.soft }, line: { color: EX.line, width: .6 } });
        s.addText(k.label.toUpperCase(), { x: x + .1, y: y + .08, w: w - .2, h: .2, fontSize: 7.5, bold: true, color: EX.mute, charSpacing: .6 });
        s.addText(String(k.value), { x: x + .1, y: y + .28, w: w - .2, h: .38, fontSize: 19, bold: true, color: EX.ink });
      });
      y += 1.04;
    }
    if (sp.bullets) {
      s.addText(sp.bullets.map(b => ({ text: b, options: { bullet: { code: '2022' }, breakLine: true } })),
        { x: M, y, w: W - 2 * M, h: Math.min(1.5, .3 * sp.bullets.length + .2), fontSize: 11, color: EX.ink2, lineSpacing: 17 });
      y += Math.min(1.5, .3 * sp.bullets.length + .2) + .12;
    }
    if (sp.bars) {
      const b = sp.bars;
      const room = (sp.note ? 4.45 : 5.15) - y;
      const h = Math.min(room, b.horizontal ? Math.max(.34 * b.labels.length + .3, 1.6) : 3.4);
      s.addChart(b.horizontal ? p.ChartType.bar : p.ChartType.bar,
        [{ name: 'Tickets', labels: b.labels, values: b.values }], {
          x: M, y, w: W - 2 * M, h: Math.max(1.4, h),
          barDir: b.horizontal ? 'bar' : 'col',
          barGapWidthPct: b.horizontal ? 45 : 35,
          chartColors: b.highlight
            ? b.labels.map((_, i) => (b.highlight.includes(i) ? EX.accent : 'DFE2E6'))
            : b.ordinal ? b.labels.map((_, i) => EX.ord[Math.min(i, 4)])
            : [b.color || EX.accent],
          varyColors: !!(b.highlight || b.ordinal),
          showLegend: false, showValue: true,
          dataLabelColor: EX.ink2, dataLabelFontSize: 8,
          catAxisLabelColor: EX.mute, catAxisLabelFontSize: 8, catAxisLineShow: false,
          valAxisLabelColor: EX.mute, valAxisLabelFontSize: 8, valGridLine: { color: EX.line, style: 'solid' },
          catGridLine: { style: 'none' }, valAxisHidden: b.horizontal,
        });
      y += Math.max(1.4, h) + .1;
    }
    if (sp.table) {
      const t = sp.table, tw = W - 2 * M;
      const head = t.head.map((h, i) => ({ text: h, options: {
        bold: true, fontSize: 8, color: EX.mute, align: t.align[i] === 'r' ? 'right' : 'left',
        fill: { color: 'FFFFFF' }, border: [{ type: 'none' }, { type: 'none' }, { pt: 1, color: EX.line }, { type: 'none' }] } }));
      const body = t.rows.map((r, ri) => r.map((cell, i) => ({ text: String(cell), options: {
        fontSize: 8.5, color: i === 1 || i === 0 ? EX.ink : EX.ink2, align: t.align[i] === 'r' ? 'right' : 'left',
        fill: { color: ri % 2 ? 'FBFBFA' : 'FFFFFF' } } })));
      const rows = [head, ...body];
      if (t.total) rows.push(t.total.map((cell, i) => ({ text: String(cell), options: {
        fontSize: 8.5, bold: true, color: EX.ink, align: t.align[i] === 'r' ? 'right' : 'left',
        fill: { color: 'F2F2EF' } } })));
      s.addTable(rows, { x: M, y, w: tw, colW: t.w.map(f => f * tw),
        rowH: .2, valign: 'middle', border: { pt: .5, color: 'EEEEEA' }, autoPage: false });
      y += .2 * rows.length + .12;
    }
    if (sp.foot) { s.addText(sp.foot, { x: M, y: Math.min(y, 4.85), w: W - 2 * M, h: .26, fontSize: 8.5, color: EX.mute, italic: true }); y += .3; }
    if (sp.note) {
      const ny = Math.min(Math.max(y, 4.1), 4.52);
      s.addShape(p.ShapeType.rect, { x: M, y: ny, w: W - 2 * M, h: .68, fill: { color: 'FBFBFA' }, line: { color: EX.line, width: .6, dashType: 'dash' } });
      s.addText('COMMENTARY', { x: M + .1, y: ny + .04, w: 2, h: .18, fontSize: 7, bold: true, color: EX.mute, charSpacing: .6 });
      s.addText(sp.note, { x: M + .1, y: ny + .21, w: W - 2 * M - .2, h: .42, fontSize: 9, color: EX.ink2 });
    }
  });
  await p.writeFile({ fileName: name + '.pptx' });
}

/* ── PDF ─────────────────────────────────────────────────────────────── */
async function toPdf(slides, name) {
  await loadScript(CDN.jspdf);
  const { jsPDF } = window.jspdf;
  const W = 960, H = 540, M = 52;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [W, H] });
  const hex = h => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const fill = h => doc.setFillColor(...hex(h));
  const stroke = h => doc.setDrawColor(...hex(h));
  const ink = h => doc.setTextColor(...hex(h));
  const clip = (t, w, size) => {
    doc.setFontSize(size);
    let s = String(t);
    while (s.length > 2 && doc.getTextWidth(s) > w) s = s.slice(0, -2);
    return s === String(t) ? s : s + '…';
  };

  slides.forEach((sp, si) => {
    if (si) doc.addPage([W, H], 'landscape');
    doc.setFont('helvetica', 'normal');

    if (sp.kind === 'cover') {
      fill(EX.ink); doc.rect(0, 0, W, H, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(34); ink('FFFFFF');
      doc.text(sp.title, M, 250);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(15); ink('B9BEC6');
      doc.text(sp.sub, M, 282);
      doc.setFontSize(12); ink('8E959E'); doc.text(sp.line, M, 306);
      doc.setFontSize(10); doc.text(sp.foot, M, H - 44);
      return;
    }
    if (sp.kind === 'end') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(26); ink(EX.ink);
      doc.text(sp.title, W / 2, H / 2, { align: 'center' });
      return;
    }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); ink(EX.ink);
    doc.text(clip(sp.title, W - 2 * M - 220, 17), M, 54);
    if (sp.sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); ink(EX.mute);
      doc.text(sp.sub, W - M, 54, { align: 'right' }); }
    stroke(EX.line); doc.setLineWidth(.8); doc.line(M, 68, W - M, 68);
    doc.setFontSize(7.5); ink(EX.mute); doc.text('Awign Enterprises', M, H - 22);
    doc.text(String(si), W - M, H - 22, { align: 'right' });

    let y = 92;
    if (sp.kpis) {
      const n = sp.kpis.length, gap = 10, w = (W - 2 * M - gap * (n - 1)) / n;
      sp.kpis.forEach((k, i) => {
        const x = M + i * (w + gap);
        fill(EX.soft); stroke(EX.line); doc.setLineWidth(.6);
        doc.roundedRect(x, y, w, 62, 5, 5, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); ink(EX.mute);
        doc.text(k.label.toUpperCase(), x + 10, y + 16);
        doc.setFontSize(19); ink(EX.ink); doc.text(String(k.value), x + 10, y + 40);
        if (k.note) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); ink(EX.mute);
          doc.text(clip(k.note, w - 20, 7.6), x + 10, y + 53); }
      });
      y += 72;
    }
    if (sp.kpis2) {
      const n = sp.kpis2.length, gap = 10, w = (W - 2 * M - gap * (n - 1)) / n;
      sp.kpis2.forEach((k, i) => {
        const x = M + i * (w + gap);
        fill(EX.soft); stroke(EX.line); doc.setLineWidth(.6);
        doc.roundedRect(x, y, w, 62, 5, 5, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); ink(EX.mute);
        doc.text(clip(k.label.toUpperCase(), w - 20, 6.6), x + 10, y + 16);
        doc.setFontSize(19); ink(EX.ink); doc.text(String(k.value), x + 10, y + 40);
      });
      y += 72;
    }
    if (sp.bullets) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); ink(EX.ink2);
      sp.bullets.forEach(b => {
        const lines = doc.splitTextToSize(b, W - 2 * M - 14);
        fill(EX.accent); doc.circle(M + 3, y - 3.4, 1.8, 'F');
        doc.text(lines, M + 14, y);
        y += lines.length * 13 + 6;
      });
      y += 4;
    }
    if (sp.bars) {
      const b = sp.bars, max = Math.max(...b.values, 1);
      const avail = (sp.note ? H - 118 : H - 46) - y;
      if (b.horizontal) {
        const rowH = Math.min(34, Math.max(14, avail / b.labels.length));
        const labW = 168, barX = M + labW + 10, barW = W - M - barX - 46;
        b.labels.forEach((lab, i) => {
          const cy = y + i * rowH;
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); ink(EX.ink2);
          doc.text(clip(lab, labW, 8.5), M, cy + rowH / 2 + 3);
          fill('EEEEEA'); doc.roundedRect(barX, cy + rowH / 2 - 4.5, barW, 9, 4, 4, 'F');
          const w = Math.max(3, (b.values[i] / max) * barW);
          fill(b.color || (b.ordinal ? EX.ord[Math.min(i, 4)] : EX.accent));
          doc.roundedRect(barX, cy + rowH / 2 - 4.5, w, 9, 4, 4, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); ink(EX.ink);
          doc.text(num(b.values[i]), W - M, cy + rowH / 2 + 3, { align: 'right' });
        });
        y += rowH * b.labels.length + 8;
      } else {
        const ch = Math.min(290, avail - 30), slot = (W - 2 * M) / b.labels.length, bw = Math.min(slot - 6, 26);
        b.values.forEach((v, i) => {
          const h = (v / max) * ch, x = M + i * slot + (slot - bw) / 2;
          const hot = !b.highlight || b.highlight.includes(i);
          fill(hot ? EX.accent : 'DFE2E6');
          doc.roundedRect(x, y + ch - h, bw, Math.max(2, h), 3, 3, 'F');
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7); ink(EX.mute);
          doc.text(b.labels[i], x + bw / 2, y + ch + 12, { align: 'center' });
          if (hot && v > 0) { doc.setFontSize(7); ink(EX.ink2);
            doc.text(String(v), x + bw / 2, y + ch - h - 4, { align: 'center' }); }
        });
        stroke(EX.line); doc.line(M, y + ch, W - M, y + ch);
        y += ch + 26;
      }
    }
    if (sp.table) {
      const t = sp.table, tw = W - 2 * M, cols = t.w.map(f => f * tw);
      const xs = cols.reduce((a, c, i) => (a.push((a[i - 1] || M) + (i ? cols[i - 1] : 0)), a), []);
      const rowH = Math.min(19, Math.max(13, ((sp.note ? H - 120 : H - 54) - y) / (t.rows.length + 2)));
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); ink(EX.mute);
      t.head.forEach((h, i) => {
        const right = t.align[i] === 'r';
        doc.text(clip(h.toUpperCase(), cols[i] - 6, 7), right ? xs[i] + cols[i] - 4 : xs[i], y + 9, { align: right ? 'right' : 'left' });
      });
      stroke(EX.line); doc.setLineWidth(.8); doc.line(M, y + 13, W - M, y + 13);
      y += 13;
      t.rows.forEach((r, ri) => {
        if (ri % 2) { fill('FBFBFA'); doc.rect(M, y, tw, rowH, 'F'); }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
        r.forEach((cell, i) => {
          ink(i <= 1 ? EX.ink : EX.ink2);
          const right = t.align[i] === 'r';
          doc.text(clip(cell, cols[i] - 6, 8), right ? xs[i] + cols[i] - 4 : xs[i], y + rowH / 2 + 3, { align: right ? 'right' : 'left' });
        });
        stroke('F0F0EC'); doc.setLineWidth(.4); doc.line(M, y + rowH, W - M, y + rowH);
        y += rowH;
      });
      if (t.total) {
        fill('F2F2EF'); doc.rect(M, y, tw, rowH, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); ink(EX.ink);
        t.total.forEach((cell, i) => {
          const right = t.align[i] === 'r';
          doc.text(clip(cell, cols[i] - 6, 8), right ? xs[i] + cols[i] - 4 : xs[i], y + rowH / 2 + 3, { align: right ? 'right' : 'left' });
        });
        y += rowH;
      }
      y += 10;
    }
    if (sp.foot) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8); ink(EX.mute);
      doc.text(clip(sp.foot, W - 2 * M, 8), M, y + 8); y += 18;
    }
    if (sp.note) {
      const ny = Math.min(Math.max(y, H - 112), H - 96);
      stroke(EX.line); fill('FBFBFA'); doc.setLineWidth(.7);
      doc.setLineDashPattern([3, 3], 0);
      doc.roundedRect(M, ny, W - 2 * M, 56, 5, 5, 'FD');
      doc.setLineDashPattern([], 0);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(6.6); ink(EX.mute);
      doc.text('COMMENTARY', M + 10, ny + 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); ink(EX.ink2);
      doc.text(doc.splitTextToSize(sp.note, W - 2 * M - 20).slice(0, 3), M + 10, ny + 27);
    }
  });
  doc.save(name + '.pdf');
}

async function exportDeck(kind) {
  const name = `Skild-Fetch_Awign_Review_${D.from}_to_${D.to}`;
  toast(`Building the ${kind === 'pptx' ? 'PowerPoint' : 'PDF'}…`);
  try {
    const model = deckModel();
    if (kind === 'pptx') await toPptx(model, name); else await toPdf(model, name);
    toast(`${model.length} slides exported. Commentary you typed is carried into the deck.`);
  } catch (err) {
    toast('Export needs the internet to pull the generator library. ' + (err && err.message ? err.message : ''));
  }
}

