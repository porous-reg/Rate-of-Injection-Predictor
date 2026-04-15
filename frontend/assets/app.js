const state = {
  catalog: null,
  loadedSingleRow: null,
  selectedBatchRows: [],
  loadedBatchResults: [],
  lastPrediction: null,
};

const ui = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheUi();
  bindTabs();
  if (document.body.dataset.page === "program") {
    await initProgramPage();
  }
}

function cacheUi() {
  const ids = [
    "injectorSelect",
    "pressureInput",
    "tempInput",
    "etInput",
    "demoButton",
    "resetButton",
    "predictButton",
    "singleCsvButton",
    "singleCsvInput",
    "singleCsvName",
    "applySingleCsvButton",
    "batchCsvButton",
    "batchCsvInput",
    "batchCsvName",
    "parseBatchButton",
    "runBatchButton",
    "summaryCards",
    "waveformPlot",
    "plotMeta",
    "supportedConditions",
    "batchPreviewBody",
    "batchResultsBody",
    "batchStatus",
  ];
  for (const id of ids) {
    ui[id] = document.getElementById(id);
  }
}

function bindTabs() {
  const here = location.pathname.replace(/\/+$/, "") || "/";
  document.querySelectorAll(".tabs a").forEach((anchor) => {
    const target = anchor.getAttribute("href");
    if (target && (here === target || (here === "/" && target === "/index.html"))) {
      anchor.classList.add("active");
    }
  });
}

function fallbackCatalog() {
  return window.ROI_FALLBACK_CATALOG || null;
}

function apiBaseCandidates() {
  const explicit = (new URLSearchParams(location.search).get("api") || localStorage.getItem("roiApiBase") || "").trim();
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (location.protocol === "http:" || location.protocol === "https:") {
    candidates.push(location.origin);
  } else {
    candidates.push("http://127.0.0.1:8000");
    candidates.push("http://127.0.0.1:8013");
  }
  return [...new Set(candidates)];
}

async function fetchJson(path, options) {
  let lastError = null;
  const candidates = apiBaseCandidates();
  for (let i = 0; i < candidates.length; i += 1) {
    const base = candidates[i];
    try {
      const response = await fetch(new URL(path, base).href, options);
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        return payload;
      }
      if (response.status === 404 && i < candidates.length - 1) {
        lastError = new Error(payload.detail || payload.error || response.statusText);
        continue;
      }
      throw new Error(payload.detail || payload.error || response.statusText);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Request failed");
}

async function initProgramPage() {
  renderSummaryCards(null);
  renderWaveform(null);
  renderBatchPreview([]);
  renderBatchResults([]);
  if (ui.plotMeta) {
    ui.plotMeta.textContent = "No prediction yet";
  }

  state.catalog = fallbackCatalog();
  if (!state.catalog) {
    if (ui.supportedConditions) {
      ui.supportedConditions.innerHTML = `
        <article class="support-card">
          <h3>Catalog unavailable</h3>
          <p class="muted">Fallback catalog is missing.</p>
        </article>
      `;
    }
    return;
  }

  renderSupportedConditions();
  populateSelectors();
  setDemoDefaults();
  bindProgramActions();

  try {
    const liveCatalog = await fetchJson("/api/supported-conditions");
    state.catalog = liveCatalog;
    renderSupportedConditions();
    populateSelectors();
    setDemoDefaults();
    if (ui.plotMeta) {
      ui.plotMeta.textContent = "Backend connected";
    }
  } catch (error) {
    console.warn(`Using fallback catalog: ${error.message}`);
    if (ui.plotMeta) {
      ui.plotMeta.textContent = "Backend unavailable. Inputs remain editable.";
    }
  }
}

function populateSelectors() {
  const catalog = state.catalog.supported_conditions;
  const injectorIds = Object.keys(catalog).sort();
  ui.injectorSelect.innerHTML = injectorIds.map((id) => `<option value="${id}">Injector ${id}</option>`).join("");
  ui.injectorSelect.value = injectorIds.includes("800") ? "800" : injectorIds[0];
  updateInputHints(ui.injectorSelect.value);
}

function updateInputHints(injectorId) {
  const grid = state.catalog.supported_conditions[injectorId];
  if (!grid) return;
  const pressureMin = Math.min(...grid.pressure_bar);
  const pressureMax = Math.max(...grid.pressure_bar);
  const tempMin = Math.min(...grid.temp_c);
  const tempMax = Math.max(...grid.temp_c);
  const etMin = Math.min(...grid.et_us);
  const etMax = Math.max(...grid.et_us);

  ui.pressureInput.min = pressureMin;
  ui.pressureInput.max = pressureMax;
  ui.tempInput.min = tempMin;
  ui.tempInput.max = tempMax;
  ui.etInput.min = etMin;
  ui.etInput.max = etMax;

  ui.pressureInput.placeholder = `${pressureMin}-${pressureMax}`;
  ui.tempInput.placeholder = `${tempMin}-${tempMax}`;
  ui.etInput.placeholder = `${etMin}-${etMax}`;
}

function setDemoDefaults() {
  ui.injectorSelect.value = "800";
  updateInputHints(ui.injectorSelect.value);
  ui.pressureInput.value = "200";
  ui.tempInput.value = "30";
  ui.etInput.value = "700";
}

function bindProgramActions() {
  ui.injectorSelect.addEventListener("change", () => {
    updateInputHints(ui.injectorSelect.value);
  });

  ui.demoButton.addEventListener("click", () => {
    setDemoDefaults();
    void runSinglePrediction();
  });

  ui.resetButton.addEventListener("click", () => {
    setDemoDefaults();
    renderSummaryCards(null);
    renderWaveform(null);
    if (ui.plotMeta) ui.plotMeta.textContent = "No prediction yet";
  });

  ui.predictButton.addEventListener("click", () => void runSinglePrediction());
  ui.singleCsvButton.addEventListener("click", () => ui.singleCsvInput.click());
  ui.singleCsvInput.addEventListener("change", () => handleSingleCsvInput());
  ui.applySingleCsvButton.addEventListener("click", () => applyLoadedSingleCsv());
  ui.batchCsvButton.addEventListener("click", () => ui.batchCsvInput.click());
  ui.batchCsvInput.addEventListener("change", () => handleBatchCsvInput());
  ui.parseBatchButton.addEventListener("click", () => parseBatchInput());
  ui.runBatchButton.addEventListener("click", () => void runBatchPrediction());
}

async function runSinglePrediction() {
  const payload = currentPayloadFromForm();
  try {
    const result = await fetchJson("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.lastPrediction = result;
    renderSummaryCards(result);
    renderWaveform(result);
    if (ui.plotMeta) ui.plotMeta.textContent = `Injector ${result.injector_id}`;
  } catch (error) {
    showToast(error.message);
  }
}

function currentPayloadFromForm() {
  return {
    injector_id: ui.injectorSelect.value,
    pressure_bar: Number(ui.pressureInput.value),
    temp_c: Number(ui.tempInput.value),
    et_us: Number(ui.etInput.value),
  };
}

function renderSummaryCards(result) {
  if (!ui.summaryCards) return;
  if (!result) {
    ui.summaryCards.innerHTML = [
      summaryCard("Injector", "—", "Waiting for a prediction."),
      summaryCard("Peak ROI", "—", "Waiting for a prediction."),
      summaryCard("Peak time", "—", "Waiting for a prediction."),
      summaryCard("Integral", "—", "Waiting for a prediction."),
    ].join("");
    return;
  }
  ui.summaryCards.innerHTML = [
    summaryCard("Injector", result.injector_id, "Selected condition set"),
    summaryCard("Peak ROI", formatNumber(result.summary.peak_roi_mg_per_ms), `Mean ${formatNumber(result.summary.mean_roi_mg_per_ms)}`),
    summaryCard("Peak time", `${formatNumber(result.summary.peak_time_us)} us`, `Half-peak duration ${formatNumber(result.summary.duration_above_half_peak_us)} us`),
    summaryCard("Integral", formatNumber(result.summary.roi_area_mg), `10% duration ${formatNumber(result.summary.duration_above_10pct_peak_us)} us`),
  ].join("");
}

function summaryCard(label, value, detail) {
  return `
    <article class="metric-card">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      <div class="detail">${detail}</div>
    </article>
  `;
}

function renderWaveform(result) {
  if (!ui.waveformPlot) return;
  if (typeof Plotly === "undefined") {
    ui.waveformPlot.innerHTML = `
      <div class="empty-state">
        <strong>Plot library unavailable</strong>
        <div>Load the local Plotly bundle to render the ROI waveform.</div>
      </div>
    `;
    return;
  }

  if (!result) {
    Plotly.newPlot(
      ui.waveformPlot,
      [{ x: [0, 1], y: [0, 0], mode: "lines", line: { color: "#6fe3c2", width: 2 }, hoverinfo: "skip", name: "ROI" }],
      plotLayout("Waiting for a prediction"),
      { displayModeBar: false, responsive: true }
    );
    return;
  }

  const x = result.time_us;
  const y = result.roi_mg_per_ms;
  const peakIndex = y.indexOf(Math.max(...y));
  const peakTrace = {
    x: [x[peakIndex]],
    y: [y[peakIndex]],
    mode: "markers",
    marker: { color: "#ffcf6b", size: 10 },
    name: "Peak",
    hovertemplate: "Peak<br>%{x:.1f} us<br>%{y:.4f} mg/ms<extra></extra>",
  };

  Plotly.newPlot(
    ui.waveformPlot,
    [
      {
        x,
        y,
        mode: "lines",
        line: { color: "#6fe3c2", width: 2.5 },
        fill: "tozeroy",
        fillcolor: "rgba(111, 227, 194, 0.10)",
        hovertemplate: "t=%{x:.1f} us<br>ROI=%{y:.4f} mg/ms<extra></extra>",
        name: "ROI",
      },
      peakTrace,
    ],
    plotLayout(`Injector ${result.injector_id}`),
    { displayModeBar: true, responsive: true }
  );
}

function plotLayout(title) {
  return {
    title: { text: title, font: { color: "#ecf2f8", size: 14 } },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    margin: { l: 54, r: 22, t: 32, b: 48 },
    xaxis: {
      title: { text: "Time [us]", font: { color: "#97a6b9" } },
      gridcolor: "rgba(255,255,255,0.08)",
      zerolinecolor: "rgba(255,255,255,0.12)",
      color: "#cfe0ee",
    },
    yaxis: {
      title: { text: "ROI [mg/ms]", font: { color: "#97a6b9" } },
      gridcolor: "rgba(255,255,255,0.08)",
      zerolinecolor: "rgba(255,255,255,0.12)",
      color: "#cfe0ee",
    },
    font: { family: "Inter, sans-serif", color: "#ecf2f8" },
    showlegend: false,
  };
}

async function handleSingleCsvInput() {
  const file = ui.singleCsvInput.files?.[0];
  if (!file) {
    ui.singleCsvName.textContent = "No file selected";
    return;
  }
  ui.singleCsvName.textContent = file.name;
  const rows = parseCsv(await file.text());
  state.loadedSingleRow = rows[0] || null;
  if (!state.loadedSingleRow) showToast("The CSV does not contain a valid row.");
}

function applyLoadedSingleCsv() {
  if (!state.loadedSingleRow) {
    showToast("Load a one-row CSV first.");
    return;
  }
  const row = state.loadedSingleRow;
  ui.injectorSelect.value = String(row.injector_id);
  updateInputHints(ui.injectorSelect.value);
  ui.pressureInput.value = String(row.pressure_bar);
  ui.tempInput.value = String(row.temp_c);
  ui.etInput.value = String(row.et_us);
  showToast(`Applied ${row.injector_id} row.`);
}

async function handleBatchCsvInput() {
  const file = ui.batchCsvInput.files?.[0];
  if (!file) {
    ui.batchCsvName.textContent = "No file selected";
    return;
  }
  ui.batchCsvName.textContent = file.name;
}

async function parseBatchInput() {
  const file = ui.batchCsvInput.files?.[0];
  if (!file) {
    showToast("Choose a batch CSV first.");
    return;
  }
  const text = await file.text();
  state.selectedBatchRows = parseCsv(text).map((row, idx) => ({
    case_id: row.case_id || row.id || `case_${idx + 1}`,
    injector_id: String(row.injector_id),
    pressure_bar: Number(row.pressure_bar),
    temp_c: Number(row.temp_c),
    et_us: Number(row.et_us),
  }));
  renderBatchPreview(state.selectedBatchRows);
  if (ui.batchStatus) ui.batchStatus.textContent = `${state.selectedBatchRows.length} row(s) loaded`;
}

async function runBatchPrediction() {
  if (!state.selectedBatchRows.length) {
    showToast("Load a batch CSV first.");
    return;
  }
  try {
    const response = await fetchJson("/api/predict-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cases: state.selectedBatchRows }),
    });
    state.loadedBatchResults = response.results || [];
    renderBatchResults(state.loadedBatchResults);
    if (ui.batchStatus) ui.batchStatus.textContent = `${state.loadedBatchResults.length} result(s) returned`;
  } catch (error) {
    showToast(error.message);
  }
}

function renderBatchPreview(rows) {
  if (!ui.batchPreviewBody) return;
  if (!rows.length) {
    ui.batchPreviewBody.innerHTML = '<tr><td colspan="7" class="empty-state">Load a batch CSV to preview rows.</td></tr>';
    return;
  }
  ui.batchPreviewBody.innerHTML = rows
    .map((row, index) => {
      const validation = validateRowClientSide(row);
      return `
        <tr>
          <td>${escapeHtml(row.case_id)}</td>
          <td>${escapeHtml(row.injector_id)}</td>
          <td>${formatNumber(row.pressure_bar)}</td>
          <td>${formatNumber(row.temp_c)}</td>
          <td>${formatNumber(row.et_us)}</td>
          <td>${validation.ok ? "ready" : `<span style="color: var(--error)">${escapeHtml(validation.message)}</span>`}</td>
          <td><button class="ghost" data-use-row="${index}">Use</button></td>
        </tr>
      `;
    })
    .join("");
  ui.batchPreviewBody.querySelectorAll("[data-use-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = rows[Number(button.dataset.useRow)];
      ui.injectorSelect.value = String(row.injector_id);
      updateInputHints(ui.injectorSelect.value);
      ui.pressureInput.value = String(row.pressure_bar);
      ui.tempInput.value = String(row.temp_c);
      ui.etInput.value = String(row.et_us);
      showToast(`Applied ${row.case_id}.`);
    });
  });
}

function renderBatchResults(results) {
  if (!ui.batchResultsBody) return;
  if (!results.length) {
    ui.batchResultsBody.innerHTML = '<tr><td colspan="7" class="empty-state">No batch results yet.</td></tr>';
    return;
  }
  ui.batchResultsBody.innerHTML = results
    .map((entry, index) => {
      if (!entry.ok) {
        return `
          <tr>
            <td>${escapeHtml(entry.case_id)}</td>
            <td>—</td>
            <td colspan="3" style="color: var(--error)">${escapeHtml(entry.error)}</td>
            <td>failed</td>
            <td><button class="ghost" disabled>View</button></td>
          </tr>
        `;
      }
      const result = entry.result;
      return `
        <tr>
          <td>${escapeHtml(entry.case_id)}</td>
          <td>${escapeHtml(result.injector_id)}</td>
          <td>${formatNumber(result.summary.peak_roi_mg_per_ms)}</td>
          <td>${formatNumber(result.summary.peak_time_us)}</td>
          <td>${formatNumber(result.summary.roi_area_mg)}</td>
          <td>ok</td>
          <td><button class="ghost" data-view-result="${index}">View</button></td>
        </tr>
      `;
    })
    .join("");
  ui.batchResultsBody.querySelectorAll("[data-view-result]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = results[Number(button.dataset.viewResult)];
      if (entry?.ok) {
        state.lastPrediction = entry.result;
        renderSummaryCards(entry.result);
        renderWaveform(entry.result);
        if (ui.plotMeta) ui.plotMeta.textContent = `Batch case ${entry.case_id}`;
      }
    });
  });
}

function validateRowClientSide(row) {
  const catalog = state.catalog.supported_conditions[String(row.injector_id)];
  if (!catalog) return { ok: false, message: "unsupported injector" };
  const checks = [
    catalog.pressure_bar.includes(Number(row.pressure_bar)),
    catalog.temp_c.includes(Number(row.temp_c)),
    catalog.et_us.includes(Number(row.et_us)),
  ];
  if (checks.every(Boolean)) return { ok: true, message: "ready" };
  return { ok: false, message: "outside supported grid" };
}

function renderSupportedConditions() {
  const root = ui.supportedConditions;
  root.innerHTML = Object.entries(state.catalog.supported_conditions)
    .map(([injectorId, grid]) => {
      return `
        <article class="support-card">
          <h3>Injector ${injectorId}</h3>
          <div class="chips">
            <span class="chip">Pressure: ${grid.pressure_bar.join(", ")} bar</span>
            <span class="chip">Temp: ${grid.temp_c.join(", ")} degC</span>
            <span class="chip">ET count: ${grid.et_us.length}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  const num = Number(value);
  if (Math.abs(num) >= 100) return num.toFixed(1);
  if (Math.abs(num) >= 10) return num.toFixed(2);
  if (Math.abs(num) >= 1) return num.toFixed(3);
  return num.toFixed(4);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showToast(message) {
  console.log(message);
  if (ui.plotMeta) {
    ui.plotMeta.textContent = message;
  }
}
