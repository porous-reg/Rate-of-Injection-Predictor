const state = {
  catalog: null,
  loadedSingleRow: null,
  loadedBatchRows: [],
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
    "pressureInput",
    "durationInput",
    "apiBaseInput",
    "saveApiBaseButton",
    "clearApiBaseButton",
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
    "apiBaseNote",
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
  return window.ROI_FALLBACK_MODEL || null;
}

function currentCatalog() {
  return state.catalog || fallbackCatalog() || {};
}

function apiBaseCandidates() {
  const runtimeBase = (window.ROI_API_BASE || "").trim();
  const explicit = (new URLSearchParams(location.search).get("api") || localStorage.getItem("roiApiBase") || "").trim();
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (runtimeBase) candidates.push(runtimeBase);
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
  state.catalog = fallbackCatalog();
  renderSummaryCards(null);
  renderWaveform(null);
  renderBatchPreview([]);
  renderBatchResults([]);
  renderSupportedConditions();
  syncInputBounds();
  syncApiBaseField();
  bindProgramActions();
  setDemoDefaults(false);

  try {
    const liveCatalog = await fetchJson("/api/supported-conditions");
    state.catalog = liveCatalog;
    renderSupportedConditions();
    syncInputBounds();
    syncApiBaseField();
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

function getRanges() {
  const catalog = currentCatalog();
  const pressure = catalog.supported_pressure_range_bar || [100, 350];
  const duration = catalog.supported_duration_range_us || [250, 3000];
  const fixedContext = catalog.fixed_context || { injector_id: "800", temp_c: 30.0 };
  return { pressure, duration, fixedContext };
}

function syncInputBounds() {
  const { pressure, duration } = getRanges();
  if (ui.pressureInput) {
    ui.pressureInput.min = String(pressure[0]);
    ui.pressureInput.max = String(pressure[1]);
    ui.pressureInput.placeholder = `${pressure[0]}-${pressure[1]}`;
  }
  if (ui.durationInput) {
    ui.durationInput.min = String(duration[0]);
    ui.durationInput.max = String(duration[1]);
    ui.durationInput.placeholder = `${duration[0]}-${duration[1]}`;
  }
}

function setDemoDefaults(runPreview = false) {
  syncInputBounds();
  if (ui.pressureInput) ui.pressureInput.value = "200";
  if (ui.durationInput) ui.durationInput.value = "700";
  if (runPreview) {
    void runSinglePrediction();
  }
}

function bindProgramActions() {
  if (ui.saveApiBaseButton) {
    ui.saveApiBaseButton.addEventListener("click", () => {
      const base = (ui.apiBaseInput?.value || "").trim();
      if (!base) {
        localStorage.removeItem("roiApiBase");
        syncApiBaseField();
        showToast("Cleared backend URL.");
        return;
      }
      localStorage.setItem("roiApiBase", base);
      syncApiBaseField();
      showToast("Saved backend URL.");
    });
  }

  if (ui.clearApiBaseButton) {
    ui.clearApiBaseButton.addEventListener("click", () => {
      localStorage.removeItem("roiApiBase");
      if (ui.apiBaseInput) ui.apiBaseInput.value = "";
      syncApiBaseField();
      showToast("Cleared backend URL.");
    });
  }

  ui.demoButton.addEventListener("click", () => {
    setDemoDefaults(true);
  });

  ui.resetButton.addEventListener("click", () => {
    setDemoDefaults(false);
    state.lastPrediction = null;
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

function syncApiBaseField() {
  const saved = (localStorage.getItem("roiApiBase") || "").trim();
  if (ui.apiBaseInput) {
    ui.apiBaseInput.value = saved;
    ui.apiBaseInput.placeholder = "https://your-backend.example.com";
  }
  if (ui.apiBaseNote) {
    ui.apiBaseNote.textContent = saved
      ? `Backend URL saved: ${saved}`
      : "If the backend is hosted separately from this Cloudflare page, paste its base URL here.";
  }
}

function renderSummaryCards(result) {
  const { fixedContext } = getRanges();
  if (!ui.summaryCards) return;

  const cards = result
    ? [
        {
          label: "Fixed context",
          value: `Injector ${fixedContext.injector_id} / ${formatNumber(fixedContext.temp_c, 0)} C`,
          detail: "This release is fixed to the 800 injector and 30 C experiment context.",
        },
        {
          label: "Input",
          value: `${formatNumber(result.input.pressure_bar, 0)} bar`,
          detail: `Duration ${formatNumber(result.input.duration_us, 0)} us`,
        },
        {
          label: "Peak ROI",
          value: `${formatNumber(result.summary.peak_roi_mg_per_ms, 3)} mg/ms`,
          detail: `Peak at ${formatNumber(result.summary.peak_time_us, 1)} us`,
        },
        {
          label: "Waveform area",
          value: `${formatNumber(result.summary.roi_area_mg, 3)} mg`,
          detail: `Mean ${formatNumber(result.summary.mean_roi_mg_per_ms, 3)} mg/ms`,
        },
      ]
    : [
        {
          label: "Fixed context",
          value: `Injector ${fixedContext.injector_id} / ${formatNumber(fixedContext.temp_c, 0)} C`,
          detail: "Pressure and duration are the only runtime inputs in this release.",
        },
        {
          label: "Input",
          value: "Pressure + duration",
          detail: "Choose a pressure and an injection duration within the supported range.",
        },
        {
          label: "Output",
          value: "ROI waveform",
          detail: "The backend returns the full waveform and summary metrics.",
        },
        {
          label: "Future extension",
          value: "Geometry later",
          detail: "Hole count, hole pattern, and other geometry-aware fields will be added later.",
        },
      ];

  ui.summaryCards.innerHTML = cards
    .map(
      (card) => `
        <article class="metric-card">
          <div class="label">${escapeHtml(card.label)}</div>
          <div class="value">${escapeHtml(card.value)}</div>
          <div class="detail">${escapeHtml(card.detail)}</div>
        </article>
      `,
    )
    .join("");
}

function renderWaveform(result) {
  if (!ui.waveformPlot) return;
  if (!result) {
    ui.waveformPlot.innerHTML = '<div class="empty-state" style="min-height: 320px; display: grid; place-items: center;">No prediction yet. Load the demo or run a case to render the waveform.</div>';
    return;
  }
  if (!window.Plotly) {
    ui.waveformPlot.innerHTML = '<div class="empty-state">Plotly is unavailable.</div>';
    return;
  }

  const time = result.time_us || [];
  const roi = result.roi_mg_per_ms || [];
  const trace = {
    x: time,
    y: roi,
    type: "scatter",
    mode: "lines",
    line: { color: "#6fe3c2", width: 2.8 },
    fill: "tozeroy",
    fillcolor: "rgba(111, 227, 194, 0.08)",
    hovertemplate: "t=%{x:.0f} us<br>ROI=%{y:.3f} mg/ms<extra></extra>",
  };
  const layout = {
    margin: { l: 62, r: 24, t: 16, b: 56 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "#ecf2f8", family: "Inter, system-ui, sans-serif" },
    xaxis: {
      title: "Time [us]",
      gridcolor: "rgba(255,255,255,0.08)",
      zerolinecolor: "rgba(255,255,255,0.15)",
      tickfont: { color: "#97a6b9" },
    },
    yaxis: {
      title: "ROI [mg/ms]",
      gridcolor: "rgba(255,255,255,0.08)",
      zerolinecolor: "rgba(255,255,255,0.15)",
      tickfont: { color: "#97a6b9" },
    },
    showlegend: false,
  };
  const config = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };
  window.Plotly.newPlot(ui.waveformPlot, [trace], layout, config);
}

function renderSupportedConditions() {
  const root = ui.supportedConditions;
  if (!root) return;
  const catalog = currentCatalog();
  const { fixedContext, pressure, duration } = getRanges();
  const futureExtension = catalog.future_extension_note || "Geometry-aware inputs such as injector hole count will be added later.";

  root.innerHTML = [
    {
      title: "Fixed context",
      body: `Injector ${fixedContext.injector_id} at ${formatNumber(fixedContext.temp_c, 0)} C is fixed in this release.`,
    },
    {
      title: "Pressure range",
      body: `${formatNumber(pressure[0], 0)} to ${formatNumber(pressure[1], 0)} bar`,
    },
    {
      title: "Duration range",
      body: `${formatNumber(duration[0], 0)} to ${formatNumber(duration[1], 0)} us`,
    },
    {
      title: "Future extension",
      body: futureExtension,
    },
  ]
    .map(
      (card) => `
        <article class="support-card">
          <h3>${escapeHtml(card.title)}</h3>
          <p class="muted">${escapeHtml(card.body)}</p>
        </article>
      `,
    )
    .join("");
}

function currentPayloadFromForm() {
  return {
    pressure_bar: Number(ui.pressureInput.value),
    duration_us: Number(ui.durationInput.value),
  };
}

function validateCurrentPayload(payload) {
  const { pressure, duration } = getRanges();
  const pressureValue = Number(payload.pressure_bar);
  const durationValue = Number(payload.duration_us);
  const problems = [];
  if (!Number.isFinite(pressureValue)) problems.push("Pressure must be a number.");
  if (!Number.isFinite(durationValue)) problems.push("Duration must be a number.");
  if (pressureValue < pressure[0] || pressureValue > pressure[1]) {
    problems.push(`Pressure must be between ${pressure[0]} and ${pressure[1]} bar.`);
  }
  if (durationValue < duration[0] || durationValue > duration[1]) {
    problems.push(`Duration must be between ${duration[0]} and ${duration[1]} us.`);
  }
  if (problems.length) {
    throw new Error(problems.join(" "));
  }
  return { pressure_bar: pressureValue, duration_us: durationValue };
}

async function runSinglePrediction() {
  const payload = currentPayloadFromForm();
  try {
    const cleanPayload = validateCurrentPayload(payload);
    const result = await fetchJson("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cleanPayload),
    });
    state.lastPrediction = result;
    renderSummaryCards(result);
    renderWaveform(result);
    if (ui.plotMeta) {
      ui.plotMeta.textContent = `Pressure ${formatNumber(result.input.pressure_bar, 0)} bar / duration ${formatNumber(result.input.duration_us, 0)} us`;
    }
    showToast("Prediction complete.");
  } catch (error) {
    console.error(error);
    if (ui.plotMeta) {
      ui.plotMeta.textContent = `Request failed: ${error.message}`;
    }
    showToast(error.message, true);
  }
}

async function handleSingleCsvInput() {
  const file = ui.singleCsvInput.files?.[0];
  if (!file) {
    ui.singleCsvName.textContent = "No file selected";
    return;
  }
  ui.singleCsvName.textContent = file.name;
  const text = await file.text();
  const rows = parseCsvRows(text);
  state.loadedSingleRow = rows[0] || null;
  showToast(state.loadedSingleRow ? "Single row loaded." : "No usable row found.", !state.loadedSingleRow);
}

function applyLoadedSingleCsv() {
  const row = state.loadedSingleRow;
  if (!row) {
    showToast("Load a CSV row first.", true);
    return;
  }
  ui.pressureInput.value = String(row.pressure_bar);
  ui.durationInput.value = String(row.duration_us);
  showToast(`Applied ${row.case_id}.`);
}

async function handleBatchCsvInput() {
  const file = ui.batchCsvInput.files?.[0];
  if (!file) {
    ui.batchCsvName.textContent = "No file selected";
    return;
  }
  ui.batchCsvName.textContent = file.name;
  const text = await file.text();
  state.loadedBatchRows = parseCsvRows(text);
  renderBatchPreview(state.loadedBatchRows);
  updateBatchStatus();
  showToast(state.loadedBatchRows.length ? `Loaded ${state.loadedBatchRows.length} batch row(s).` : "No usable batch rows found.", !state.loadedBatchRows.length);
}

function parseBatchInput() {
  if (!state.loadedBatchRows.length) {
    showToast("Load a batch CSV first.", true);
    return;
  }
  renderBatchPreview(state.loadedBatchRows);
  updateBatchStatus();
}

async function runBatchPrediction() {
  if (!state.loadedBatchRows.length) {
    showToast("Load a batch CSV first.", true);
    return;
  }
  const cases = state.loadedBatchRows.map((row, idx) => ({
    case_id: row.case_id || `case_${idx + 1}`,
    pressure_bar: row.pressure_bar,
    duration_us: row.duration_us,
  }));
  try {
    const result = await fetchJson("/api/predict-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cases }),
    });
    state.loadedBatchResults = result.results || [];
    renderBatchResults(state.loadedBatchResults);
    updateBatchStatus();
    showToast(`Batch complete: ${state.loadedBatchResults.length} row(s).`);
  } catch (error) {
    console.error(error);
    showToast(error.message, true);
  }
}

function renderBatchPreview(rows) {
  if (!ui.batchPreviewBody) return;
  if (!rows.length) {
    ui.batchPreviewBody.innerHTML = '<tr><td colspan="5" class="empty-state">Load a batch CSV to preview rows.</td></tr>';
    return;
  }
  const { pressure, duration } = getRanges();
  ui.batchPreviewBody.innerHTML = rows
    .map((row, idx) => {
      const status = rowStatus(row, pressure, duration);
      return `
        <tr>
          <td>${escapeHtml(row.case_id || `case_${idx + 1}`)}</td>
          <td>${formatNumber(row.pressure_bar)}</td>
          <td>${formatNumber(row.duration_us)}</td>
          <td>${escapeHtml(status)}</td>
          <td><button class="ghost" data-use-row="${idx}">Apply</button></td>
        </tr>
      `;
    })
    .join("");
  ui.batchPreviewBody.querySelectorAll("[data-use-row]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-use-row"));
      const row = rows[index];
      if (!row) return;
      ui.pressureInput.value = String(row.pressure_bar);
      ui.durationInput.value = String(row.duration_us);
      showToast(`Applied ${row.case_id || `case_${index + 1}`}.`);
    });
  });
}

function renderBatchResults(results) {
  if (!ui.batchResultsBody) return;
  if (!results.length) {
    ui.batchResultsBody.innerHTML = '<tr><td colspan="8" class="empty-state">No batch results yet.</td></tr>';
    return;
  }
  ui.batchResultsBody.innerHTML = results
    .map((entry) => {
      if (!entry.ok) {
        return `
          <tr>
            <td>${escapeHtml(entry.case_id)}</td>
            <td colspan="2">-</td>
            <td colspan="3">${escapeHtml(entry.error || "Error")}</td>
            <td><span class="chip">failed</span></td>
            <td>-</td>
          </tr>
        `;
      }
      const result = entry.result;
      return `
        <tr>
          <td>${escapeHtml(entry.case_id)}</td>
          <td>${formatNumber(result.input.pressure_bar)}</td>
          <td>${formatNumber(result.input.duration_us)}</td>
          <td>${formatNumber(result.summary.peak_roi_mg_per_ms, 3)}</td>
          <td>${formatNumber(result.summary.peak_time_us, 1)}</td>
          <td>${formatNumber(result.summary.roi_area_mg, 3)}</td>
          <td><span class="chip">ok</span></td>
          <td><button class="ghost" data-view-result="${escapeAttr(entry.case_id)}">View</button></td>
        </tr>
      `;
    })
    .join("");

  ui.batchResultsBody.querySelectorAll("[data-view-result]").forEach((button) => {
    button.addEventListener("click", () => {
      const caseId = button.getAttribute("data-view-result");
      const entry = results.find((item) => item.case_id === caseId && item.ok);
      if (!entry) return;
      state.lastPrediction = entry.result;
      renderSummaryCards(entry.result);
      renderWaveform(entry.result);
      if (ui.plotMeta) {
        ui.plotMeta.textContent = `Batch case ${caseId}`;
      }
      ui.pressureInput.value = String(entry.result.input.pressure_bar);
      ui.durationInput.value = String(entry.result.input.duration_us);
    });
  });
}

function updateBatchStatus() {
  if (!ui.batchStatus) return;
  const rowCount = state.loadedBatchRows.length;
  const resultCount = state.loadedBatchResults.length;
  const allReady = rowCount > 0 && state.loadedBatchRows.every((row) => rowStatus(row, ...getRangesForStatus()).startsWith("Ready"));
  if (!rowCount) {
    ui.batchStatus.textContent = "No batch loaded";
    return;
  }
  if (resultCount) {
    ui.batchStatus.textContent = `${resultCount} prediction(s) finished`;
    return;
  }
  ui.batchStatus.textContent = `${rowCount} row(s) loaded${allReady ? "" : " - some rows need attention"}`;
}

function getRangesForStatus() {
  const { pressure, duration } = getRanges();
  return [pressure, duration];
}

function rowStatus(row, pressureRange, durationRange) {
  const pressure = Number(row.pressure_bar);
  const duration = Number(row.duration_us);
  if (!Number.isFinite(pressure) || !Number.isFinite(duration)) {
    return "Missing pressure or duration";
  }
  if (pressure < pressureRange[0] || pressure > pressureRange[1]) {
    return `Pressure out of range (${pressureRange[0]}-${pressureRange[1]} bar)`;
  }
  if (duration < durationRange[0] || duration > durationRange[1]) {
    return `Duration out of range (${durationRange[0]}-${durationRange[1]} us)`;
  }
  return "Ready";
}

function parseCsvRows(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const first = splitCsvLine(lines[0]);
  const hasHeader = first.some((token) => /pressure|duration|case/i.test(token));

  if (hasHeader) {
    const headers = first.map(normalizeHeader);
    return lines.slice(1).map((line, idx) => normalizeCsvRow(headers, splitCsvLine(line), idx));
  }

  return lines.map((line, idx) => {
    const values = splitCsvLine(line);
    if (values.length >= 2) {
      return normalizeCsvRow(["pressure_bar", "duration_us"], values, idx);
    }
    return normalizeCsvRow(["pressure_bar", "duration_us"], values, idx);
  });
}

function normalizeCsvRow(headers, values, idx) {
  const raw = {};
  headers.forEach((header, i) => {
    raw[header] = values[i] ?? "";
  });
  const caseId = raw.case_id || raw.id || raw.name || `case_${idx + 1}`;
  const pressure = toNumber(raw.pressure_bar ?? raw.pressure ?? raw.pressure_bar_bar);
  const duration = toNumber(raw.duration_us ?? raw.duration ?? raw.et_us);
  return {
    case_id: caseId,
    pressure_bar: pressure,
    duration_us: duration,
  };
}

function splitCsvLine(line) {
  return String(line)
    .split(",")
    .map((part) => part.trim());
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) {
    return "-";
  }
  return Number(value).toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function showToast(message, isError = false) {
  if (!message) return;
  if (ui.batchStatus) {
    ui.batchStatus.textContent = message;
    ui.batchStatus.classList.toggle("error", Boolean(isError));
  }
}
