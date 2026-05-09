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
  const text = await file.text();
  state.csvFilename = file.name;
  parseAndSetData(text, parseInt(interval.value));
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
  showPreview(values.slice(0, 10));
  notify(`Loaded ${values.length} data points from ${state.csvFilename || 'data'}`);
}

function showPreview(rows) {
  preview.hidden = false;
  previewTbl.innerHTML = `
    <table>
      <thead><tr><th>${timeCol.value}</th><th>${rainCol.value}</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr><td>${r.t}</td><td>${r.v.toFixed(2)}</td></tr>`).join('')}
      </tbody>
    </table>`;
}

// ─── MANUAL INPUT ───────────────────────────────────────────
manualArea.addEventListener('input', () => {
  const text = manualArea.value.trim();
  if (text) {
    parseAndSetData(text, parseInt(manualInt.value));
    state.csvFilename = 'typed-data';
  }
});

manualInt.addEventListener('change', () => {
  if (state.data) state.data.interval = parseInt(manualInt.value);
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

// ─── CALIBRATE ──────────────────────────────────────────────
btnCalib.addEventListener('click', async () => {
  if (!state.data) return notify('No data loaded');
  btnCalib.disabled = true; loaders.calib.hidden = false;

  // Compute demo parameters from data statistics
  const vals = state.data.values.map(v => v.v);
  const nonZero = vals.filter(v => v > 0);
  const meanIntensity = nonZero.length > 0
    ? nonZero.reduce((a,b) => a+b, 0) / nonZero.length
    : 0.1;
  const events = countEvents(vals);
  const totalHours = vals.length * state.data.interval / 60;

  state.params = {
    lambda: +((events / (totalHours / 24)) || 5).toFixed(1),
    beta:   +(Math.max(1, Math.round(events / Math.max(1, Math.ceil(vals.length / 24)))) || 3).toFixed(1),
    gamma:  +(1 / Math.max(1, vals.length * state.data.interval / events / 60) || 0.05).toFixed(3),
    eta:    +(0.1).toFixed(3),
    mu:     +(meanIntensity || 0.1).toFixed(3),
  };

  // Update UI
  Object.keys(state.params).forEach(id => {
    const slider = document.getElementById('param-' + id);
    const val    = document.getElementById('val-' + id);
    slider.value = state.params[id];
    val.textContent = state.params[id];
  });

  btnCalib.disabled = false; loaders.calib.hidden = true;
  notify('✅ Parameters calibrated from data');
  btnDisagg.disabled = false;
});

function countEvents(vals) {
  let count = 0, inEvent = false, dry = 0;
  for (const v of vals) {
    if (v > 0) {
      if (!inEvent) { count++; inEvent = true; }
      dry = 0;
    } else {
      dry++;
      if (dry >= 3 && inEvent) inEvent = false;
    }
  }
  return count || 1;
}

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
  const seed = disaggSeed.value ? parseInt(disaggSeed.value) : null;
  const coarseInterval = state.data.interval;
  const coarseData = state.data.values;

  // Simple client-side disaggregation (Bartlett-Lewis simulation)
  const disaggData = [];
  const rng = seedRandom(seed || Date.now());

  for (const row of coarseData) {
    const total = row.v;
    const steps = coarseInterval / targetMin;
    if (total === 0) {
      for (let i = 0; i < steps; i++) {
        disaggData.push({ t: row.t, v: 0 });
      }
    } else {
      // Simulate pulses
      const p = state.params;
      const nStorms = Math.max(1, Math.round(poisson(rng, p.lambda / 24 / 60 * targetMin * steps)));
      let fine = new Array(Math.ceil(steps)).fill(0);
      for (let s = 0; s < nStorms; s++) {
        const nPulses = Math.max(1, Math.round(poisson(rng, p.beta)));
        for (let pp = 0; pp < nPulses; pp++) {
          const start = Math.floor(rng.next() * fine.length);
          const dur = Math.max(1, Math.round(exponential(rng, 1 / p.eta) / targetMin));
          const intens = exponential(rng, p.mu);
          for (let i = start; i < Math.min(start + dur, fine.length); i++) {
            fine[i] += intens;
          }
        }
      }
      // Scale to match observed total
      const simTotal = fine.reduce((a,b) => a+b, 0);
      if (simTotal > 0) {
        fine = fine.map(f => f * total / simTotal);
      } else {
        fine = fine.map(() => total / fine.length);
      }
      const baseDate = new Date(row.t);
      for (let i = 0; i < fine.length; i++) {
        const d = new Date(baseDate.getTime() + i * targetMin * 60000);
        disaggData.push({
          t: d.toISOString().replace('T', ' ').slice(0, 19),
          v: +fine[i].toFixed(4),
        });
      }
    }
  }

  state.disagg = disaggData;
  btnDisagg.disabled = false; loaders.disagg.hidden = true;

  // Show results
  results.hidden = false;
  results.scrollIntoView({ behavior: 'smooth' });
  drawChart(coarseData, disaggData, targetMin);
  updateStats(coarseData, disaggData);
  notify('✅ Disaggregation complete!');
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
