/* ══════════════════════════════════════════════════════════════
   lildrip — application logic
   ══════════════════════════════════════════════════════════════ */

// ─── STATE ──────────────────────────────────────────────────
const state = {
  data: null,          // parsed coarse series (via upload / manual / demo)
  params: null,        // calibration params
  disagg: null,        // disaggregated result
  csvFilename: null,
  chart: null,
};

// ─── DOM REFS ───────────────────────────────────────────────
const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => p.querySelectorAll(s);

const tabs       = $$('.tab');
const panes      = $$('.tab-pane');
const dropZone   = $('#dropZone');
const fileInput  = $('#fileInput');
const timeCol    = $('#timeCol');
const rainCol    = $('#rainCol');
const colSelector= $('#colSelector');
const interval   = $('#intervalMin');
const manualArea = $('#manualData');
const manualInt  = $('#manualInterval');
const btnDemo    = $('#btnDemo');
const btnCalib   = $('#btnCalibrate');
const btnManual  = $('#btnManualParams');
const btnDisagg  = $('#btnDisaggregate');
const btnDown    = $('#btnDownload');
const btnCopy    = $('#btnCopy');
const preview    = $('#preview');
const previewTbl = $('#previewTable');
const paramsDiv  = $('#params');
const chartCanvas= $('#chart');
const inputChartCanvas = $('#inputChart');
const inputChartWrap = $('#inputChartWrap');
const results    = $('#step-results');
const disaggInt  = $('#disaggInterval');
const disaggSeed = $('#disaggSeed');

const paramIds   = ['lambda','beta','gamma','eta','mu'];
const loaders    = {
  demo: $('#demoLoader'),
  calib: $('#calibrateLoader'),
  disagg: $('#disaggLoader'),
};

// ─── API BASE ──────────────────────────────────── ☆ ──────
// Use the Oracle-hosted API or fallback to built-in JS model
const API = 'https://oracle-agent.duckdns.org:8001';

// ─── TABS ───────────────────────────────────────────────────
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    panes.forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('pane-' + tab.dataset.tab).classList.add('active');
  });
});

// ─── SLIDERS ────────────────────────────────────────────────
paramIds.forEach(id => {
  const slider = document.getElementById('param-' + id);
  const val    = document.getElementById('val-' + id);
  slider.addEventListener('input', () => {
    val.textContent = parseFloat(slider.value).toFixed(slider.step.includes('001') ? 3 : 1);
  });
});

// ─── DROP ZONE ──────────────────────────────────────────────
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', e => {
  e.preventDefault(); dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) loadCSV(file);
});

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) loadCSV(e.target.files[0]);
});

async function loadCSV(file) {
  const name = file.name.toLowerCase();
  state.csvFilename = file.name;

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    // Parse Excel with SheetJS
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      // Infer interval from timestamps
      const lines = csv.trim().split('\n');
      let inferredInterval = parseInt(interval.value) || 60;
      if (lines.length >= 3) {
        const t1 = lines[1].split(',')[0]?.trim();
        const t2 = lines[2].split(',')[0]?.trim();
        if (t1 && t2) {
          const d1 = new Date(t1);
          const d2 = new Date(t2);
          if (!isNaN(d1) && !isNaN(d2)) {
            inferredInterval = Math.round((d2 - d1) / 60000) || 60;
          }
        }
      }
      parseAndSetData(csv, inferredInterval);
    } catch (e) {
      notify('❌ Failed to parse Excel file: ' + e.message);
    }
  } else {
    const text = await file.text();
    parseAndSetData(text, parseInt(interval.value));
  }
}

function populateColumnSelectors(headers, rawCsv) {
  const timeSel = timeCol;
  const rainSel = rainCol;
  timeSel.innerHTML = '';
  rainSel.innerHTML = '';
  headers.forEach(h => {
    const opt1 = document.createElement('option');
    opt1.value = h; opt1.textContent = h;
    if (h.toLowerCase().includes('time') || h.toLowerCase().includes('date') || h.toLowerCase().includes('timestamp') || h === headers[0]) {
      opt1.selected = true;
    }
    timeSel.appendChild(opt1);
    const opt2 = document.createElement('option');
    opt2.value = h; opt2.textContent = h;
    if (h.toLowerCase().includes('rain') || h.toLowerCase().includes('chuva') || h.toLowerCase().includes('precip') || h.toLowerCase().includes('mm') || h === headers[1] || (!h.toLowerCase().includes('time') && !h.toLowerCase().includes('date') && !h.toLowerCase().includes('timestamp'))) {
      if (!h.toLowerCase().includes('time') && !h.toLowerCase().includes('date') && !h.toLowerCase().includes('timestamp')) {
        opt2.selected = true;
      }
    }
    rainSel.appendChild(opt2);
  });
  colSelector.hidden = false;

  // Re-parse when selection changes
  timeSel.onchange = () => reparseFromRaw();
  rainSel.onchange = () => reparseFromRaw();

  // Parse with auto-detected columns
  const tc = timeSel.value;
  const rc = rainSel.value;
  const tIdx = headers.indexOf(tc);
  const rIdx = headers.indexOf(rc);
  if (tIdx >= 0 && rIdx >= 0) {
    const values = state._rawRows.map(row => ({ t: row[tIdx], v: parseFloat(row[rIdx]) })).filter(r => !isNaN(r.v));
    const ts1 = new Date(values[0]?.t);
    const ts2 = new Date(values[1]?.t);
    const inferredInterval = (!isNaN(ts1) && !isNaN(ts2)) ? Math.round((ts2 - ts1) / 60000) || 60 : 60;
    interval.value = inferredInterval;
    showPreview(values.slice(0, 5));
    state.data = { values, interval: inferredInterval };
    btnCalib.disabled = false;
    drawInputChart(values, inferredInterval);
    notify(`Loaded ${values.length} data points`);
  }
}

function reparseFromRaw() {
  if (!state._rawHeaders || !state._rawRows) return;
  const tc = timeCol.value;
  const rc = rainCol.value;
  const tIdx = state._rawHeaders.indexOf(tc);
  const rIdx = state._rawHeaders.indexOf(rc);
  if (tIdx < 0 || rIdx < 0) return notify('Select both columns');
  const values = state._rawRows.map(row => ({ t: row[tIdx], v: parseFloat(row[rIdx]) })).filter(r => !isNaN(r.v));
  const ts1 = new Date(values[0]?.t);
  const ts2 = new Date(values[1]?.t);
  const inferredInterval = (!isNaN(ts1) && !isNaN(ts2)) ? Math.round((ts2 - ts1) / 60000) || 60 : 60;
  interval.value = inferredInterval;
  showPreview(values.slice(0, 5));
  state.data = { values, interval: inferredInterval };
  btnCalib.disabled = false;
  drawInputChart(values, inferredInterval);
  notify(`Loaded ${values.length} data points`);
}

function parseAndSetData(text, intervalMin) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const tc = timeCol.value.trim();
  const rc = rainCol.value.trim();

  const tIdx = headers.indexOf(tc);
  const rIdx = headers.indexOf(rc);
  if (tIdx < 0) return notify(`Column "${tc}" not found`);
  if (rIdx < 0) return notify(`Column "${rc}" not found`);

  const values = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const ts = parts[tIdx]?.trim();
    const val = parseFloat(parts[rIdx]);
    if (ts && !isNaN(val)) values.push({ t: ts, v: val });
  }

  state.data = { values, interval: intervalMin };
  btnCalib.disabled = false;
  showPreview(values.slice(0, 5));
  drawInputChart(values, intervalMin);
  notify(`Loaded ${values.length} data points from ${state.csvFilename || 'data'}`);
}

function showPreview(rows) {
  preview.hidden = false;
  const total = state.data ? state.data.values.length : 0;
  const more = total > rows.length ? ` <span class="more-hint">… and ${total - rows.length} more</span>` : '';
  previewTbl.innerHTML = `
    <table>
      <thead><tr><th>Timestamp</th><th>Rainfall (mm)</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr><td>${r.t}</td><td>${r.v.toFixed(2)}</td></tr>`).join('')}
      </tbody>
    </table>
    <p class="row-count">${rows.length} of ${total} rows${more}</p>`;
}

// ─── MANUAL INPUT ───────────────────────────────────────────
manualArea.addEventListener('input', () => {
  const text = manualArea.value.trim();
  if (text) {
    // Infer interval from the first two timestamps
    const lines = text.split('\n').filter(l => l.trim());
    let inferredInterval = 60;
    if (lines.length >= 3) {
      const t1 = lines[1].split(',')[0]?.trim();
      const t2 = lines[2].split(',')[0]?.trim();
      if (t1 && t2) {
        const d1 = new Date(t1);
        const d2 = new Date(t2);
        if (!isNaN(d1) && !isNaN(d2)) {
          inferredInterval = Math.round((d2 - d1) / 60000) || 60;
        }
      }
    }
    parseAndSetData(text, inferredInterval);
    state.csvFilename = 'typed-data';
  }
});

// ─── GENERATE DEMO ──────────────────────────────────────────
btnDemo.addEventListener('click', async () => {
  btnDemo.disabled = true; loaders.demo.hidden = false;
  try {
    const resp = await fetch(`${API}/demo`);
    if (!resp.ok) throw new Error('API unavailable, using client-side generation');
    const data = await resp.json();
    const csvText = ['timestamp,rainfall_mm',
      ...data.coarse.map(r => `${r.t},${r.v}`)
    ].join('\n');
    parseAndSetData(csvText, 60);
    state.csvFilename = 'demo-data';
    // Enable manual params with demo defaults
    document.getElementById('param-lambda').value = data.params?.lambda || 17.5;
    document.getElementById('param-beta').value = data.params?.beta || 5;
    document.getElementById('param-gamma').value = data.params?.gamma || 0.05;
    document.getElementById('param-eta').value = data.params?.eta || 0.1;
    document.getElementById('param-mu').value = data.params?.mu || 0.12;
    paramIds.forEach(id => {
      document.getElementById('val-' + id).textContent =
        document.getElementById('param-' + id).value;
    });
    notify('✨ Demo data loaded!');
  } catch (e) {
    notify('🔄 Generating demo locally…');
    // Client-side fallback
    const rng = seedRandom(42);
    const fine = [];
    for (let i = 0; i < 144; i++) {
      fine.push(rng.next() < 0.15 ? +(rng.next() * 3).toFixed(2) : 0);
    }
    const coarse = [];
    for (let i = 0; i < 6; i++) {
      const sum = fine.slice(i*24, (i+1)*24).reduce((a,b) => a+b, 0);
      const ts = `2023-01-01 ${String(i).padStart(2,'0')}:00:00`;
      coarse.push({ t: ts, v: +sum.toFixed(2) });
    }
    const csvText = ['timestamp,rainfall_mm',
      ...coarse.map(r => `${r.t},${r.v}`)
    ].join('\n');
    parseAndSetData(csvText, 60);
    state.csvFilename = 'demo-data';
    notify('📊 Demo data ready!');
  } finally {
    btnDemo.disabled = false; loaders.demo.hidden = true;
  }
});

// Simple seeded RNG fallback
function seedRandom(seed) {
  let s = seed;
  return {
    next: () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; }
  };
}

// ─── HELPERS ────────────────────────────────────────────────
function dataToCSV() {
  if (!state.data) return null;
  const headers = 'timestamp,rainfall_mm';
  const rows = state.data.values.map(r => `${r.t},${r.v}`);
  return new Blob([headers + '\n' + rows.join('\n')], { type: 'text/csv' });
}

// ─── CALIBRATE ──────────────────────────────────────────────
btnCalib.addEventListener('click', async () => {
  if (!state.data) return notify('No data loaded');
  btnCalib.disabled = true; loaders.calib.hidden = false;

  try {
    const csvBlob = dataToCSV();
    if (!csvBlob) throw new Error('No data to calibrate');
    const formData = new FormData();
    formData.append('arquivo', csvBlob, 'data.csv');
    formData.append('time_column', 'timestamp');
    formData.append('rainfall_column', 'rainfall_mm');
    formData.append('interval_minutes', String(state.data.interval));

    const resp = await fetch(API + '/calibrar', { method: 'POST', body: formData });
    if (!resp.ok) throw new Error(await resp.text());
    state.params = await resp.json();

    // Update UI sliders
    Object.keys(state.params).forEach(id => {
      const slider = document.getElementById('param-' + id);
      const val    = document.getElementById('val-' + id);
      const v = state.params[id];
      slider.value = v;
      val.textContent = typeof v === 'number' ? v.toFixed(v < 0.1 ? 3 : 1) : v;
    });

    notify('✅ Parameters calibrated from data via API');
    btnDisagg.disabled = false;
  } catch (e) {
    notify('❌ Calibration failed: ' + e.message);
    // Fallback: use slider defaults
    state.params = {};
    ['lambda','beta','gamma','eta','mu'].forEach(id => {
      state.params[id] = parseFloat(document.getElementById('param-' + id).value);
    });
    btnDisagg.disabled = false;
  } finally {
    btnCalib.disabled = false; loaders.calib.hidden = true;
  }
});

// ─── MANUAL PARAMS BUTTON ───────────────────────────────────
btnManual.addEventListener('click', () => {
  paramsDiv.scrollIntoView({ behavior: 'smooth' });
  btnDisagg.disabled = false;
  // Collect current slider values as params
  state.params = {};
  paramIds.forEach(id => {
    state.params[id] = parseFloat(document.getElementById('param-' + id).value);
  });
  notify('✏️ Adjust parameters and run disaggregation');
});

// ─── DISAGGREGATE ───────────────────────────────────────────
btnDisagg.addEventListener('click', async () => {
  if (!state.data) return notify('No data loaded');

  // Gather params from sliders
  state.params = {};
  paramIds.forEach(id => {
    state.params[id] = parseFloat(document.getElementById('param-' + id).value);
  });

  btnDisagg.disabled = true; loaders.disagg.hidden = false;
  const targetMin = parseInt(disaggInt.value) || 10;
  const coarseData = state.data.values;
  const coarseInterval = state.data.interval;

  try {
    const csvBlob = dataToCSV();
    if (!csvBlob) throw new Error('No data');
    const formData = new FormData();
    formData.append('arquivo', csvBlob, 'coarse.csv');
    formData.append('params', JSON.stringify(state.params));
    formData.append('time_column', 'timestamp');
    formData.append('rainfall_column', 'rainfall_mm');
    formData.append('disagg_interval_minutes', String(targetMin));

    const resp = await fetch(API + '/desagregar', { method: 'POST', body: formData });
    if (!resp.ok) throw new Error(await resp.text());
    const csvText = await resp.text();

    // Parse returned CSV
    const lines = csvText.trim().split('\n').filter(l => l.trim());
    const parsed = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 2) {
        const t = parts[0].trim();
        const v = parseFloat(parts[1]);
        if (t && !isNaN(v)) parsed.push({ t, v });
      }
    }
    state.disagg = parsed;
    results.hidden = false;
    results.scrollIntoView({ behavior: 'smooth' });
    drawChart(coarseData, parsed, targetMin);
    updateStats(coarseData, parsed);
    notify('✅ Disaggregation complete via API!');
  } catch (e) {
    notify('❌ API disaggregation failed, using local fallback: ' + e.message);
    // Client-side fallback
    const disaggData = [];
    const rng = seedRandom(Date.now());
    for (const row of coarseData) {
      const total = row.v;
      const steps = coarseInterval / targetMin;
      if (total === 0) {
        for (let i = 0; i < steps; i++) disaggData.push({ t: row.t, v: 0 });
      } else {
        const p = state.params;
        const nStorms = Math.max(1, Math.round(poisson(rng, p.lambda / 24 / 60 * targetMin * steps)));
        let fine = new Array(Math.ceil(steps)).fill(0);
        for (let s = 0; s < nStorms; s++) {
          const nPulses = Math.max(1, Math.round(poisson(rng, p.beta)));
          for (let pp = 0; pp < nPulses; pp++) {
            const start = Math.floor(rng.next() * fine.length);
            const dur = Math.max(1, Math.round(exponential(rng, 1 / p.eta) / targetMin));
            const intens = exponential(rng, p.mu);
            for (let i = start; i < Math.min(start + dur, fine.length); i++) fine[i] += intens;
          }
        }
        const simTotal = fine.reduce((a,b) => a+b, 0);
        if (simTotal > 0) fine = fine.map(f => f * total / simTotal);
        else fine = fine.map(() => total / fine.length);
        const baseDate = new Date(row.t);
        for (let i = 0; i < fine.length; i++) {
          const d = new Date(baseDate.getTime() + i * targetMin * 60000);
          disaggData.push({ t: d.toISOString().replace('T', ' ').slice(0, 19), v: +fine[i].toFixed(4) });
        }
      }
    }
    state.disagg = disaggData;
    results.hidden = false;
    results.scrollIntoView({ behavior: 'smooth' });
    drawChart(coarseData, disaggData, targetMin);
    updateStats(coarseData, disaggData);
  } finally {
    btnDisagg.disabled = false; loaders.disagg.hidden = true;
  }
});

function poisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p >= L);
  return k - 1;
}

function exponential(rng, scale) {
  return -Math.log(1 - rng.next()) * scale;
}

// ─── INPUT CHART ────────────────────────────────────────────
function drawInputChart(values, intervalMin) {
  if (state.inputChart) { state.inputChart.destroy(); state.inputChart = null; }
  if (typeof Chart === 'undefined') return;

  inputChartWrap.hidden = false;
  const labels = values.map(r => r.t.slice(0, 16));
  const data = values.map(r => r.v);

  try {
    state.inputChart = new Chart(inputChartCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: `Rainfall (${intervalMin} min intervals)`,
          data,
          backgroundColor: 'rgba(102, 126, 234, 0.5)',
          borderColor: 'rgba(102, 126, 234, 0.7)',
          borderWidth: 1,
          borderRadius: 2,
        }],
      },
      options: {
        responsive: true,
        animation: { duration: 400 },
        plugins: {
          legend: {
            labels: { color: '#c8c0e8', font: { size: 10, family: 'Inter' } },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#5a5280', font: { size: 8, family: 'Inter' },
              maxTicksLimit: 10, maxRotation: 45,
            },
            grid: { color: 'rgba(255,255,255,.04)' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#5a5280', font: { size: 9, family: 'Inter' } },
            grid: { color: 'rgba(255,255,255,.04)' },
            title: {
              display: true, text: 'Rainfall (mm)',
              color: '#5a5280', font: { size: 10, family: 'Inter' },
            },
          },
        },
      },
    });
    // Scroll to the chart
    inputChartWrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    notify('❌ Chart error: ' + e.message);
  }
}

// ─── CHART ──────────────────────────────────────────────────
function drawChart(orig, disagg, interval) {
  if (state.chart) { state.chart.destroy(); state.chart = null; }

  if (typeof Chart === 'undefined') {
    return notify('❌ Chart.js failed to load. Check your internet connection.');
  }

  const fineInt = interval;
  const coarseInt = state.data.interval;

  // Build coarse bars aligned to their time windows
  const coarseBars = [];
  const coarseLabelSet = new Set();
  orig.forEach(r => {
    const label = r.t.slice(0, 16);
    coarseLabelSet.add(label);
  });

  const disaggLabels = disagg.map(r => r.t.slice(0, 16));

  try {
    state.chart = new Chart(chartCanvas, {
      type: 'bar',
      data: {
        labels: disaggLabels,
        datasets: [
          {
            label: `Disaggregated (${fineInt} min)`,
            data: disagg.map(r => r.v),
            backgroundColor: 'rgba(102, 126, 234, 0.5)',
            borderColor: 'rgba(102, 126, 234, 0.8)',
            borderWidth: 1,
            borderRadius: 2,
            barPercentage: 0.9,
            categoryPercentage: 1.0,
            order: 2,
          },
          {
            label: `Original (${coarseInt} min)`,
            data: disaggLabels.map(label => {
              const match = orig.find(r => r.t.slice(0, 16) === label);
              return match ? match.v : null;
            }),
            backgroundColor: 'rgba(234, 102, 138, 0.4)',
            borderColor: 'rgba(234, 102, 138, 0.7)',
            borderWidth: 1,
            borderRadius: 2,
            barPercentage: 0.9,
            categoryPercentage: 1.0,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#c8c0e8', font: { size: 11, family: 'Inter' } },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#5a5280', font: { size: 9, family: 'Inter' },
              maxTicksLimit: 15,
              maxRotation: 45,
            },
            grid: { color: 'rgba(255,255,255,.04)' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#5a5280', font: { size: 9, family: 'Inter' } },
            grid: { color: 'rgba(255,255,255,.04)' },
            title: {
              display: true,
              text: 'Rainfall (mm)',
              color: '#5a5280',
              font: { size: 10, family: 'Inter' },
            },
          },
        },
      },
    });
  } catch (e) {
    notify('❌ Chart error: ' + e.message);
  }
}

function updateStats(orig, disagg) {
  const origTotal = orig.reduce((a,b) => a+b.v, 0);
  const disaggTotal = disagg.reduce((a,b) => a+b.v, 0);
  document.getElementById('statOriginalTotal').textContent = origTotal.toFixed(2);
  document.getElementById('statDisaggTotal').textContent = disaggTotal.toFixed(2);
  document.getElementById('statOriginalPts').textContent = orig.length;
  document.getElementById('statDisaggPts').textContent = disagg.length;
}

// ─── DOWNLOAD ───────────────────────────────────────────────
btnDown.addEventListener('click', () => {
  if (!state.disagg) return;
  const headers = 'timestamp,rainfall_mm';
  const rows = state.disagg.map(r => `${r.t},${r.v}`);
  const csv = [headers, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'disaggregated_rainfall.csv'; a.click();
  URL.revokeObjectURL(url);
  notify('📥 CSV downloaded!');
});

// ─── COPY STATS ─────────────────────────────────────────────
btnCopy.addEventListener('click', () => {
  const text = `lildrip results
Original: ${document.getElementById('statOriginalTotal').textContent} mm (${document.getElementById('statOriginalPts').textContent} points)
Disaggregated: ${document.getElementById('statDisaggTotal').textContent} mm (${document.getElementById('statDisaggPts').textContent} points)`;
  navigator.clipboard?.writeText(text).then(() => notify('📋 Stats copied!')).catch(() => {});
});

// ─── NOTIFICATION ───────────────────────────────────────────
function notify(msg) {
  const el = document.createElement('div');
  el.className = 'notif'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─── KEYBOARD SHORTCUT ──────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'Enter') btnDisaggregate.click();
});
