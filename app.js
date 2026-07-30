"use strict";

const PREFIXES = ["IH", "IF", "IC", "IM"];
const TERMS = ["当月", "下月", "当季", "下季"];
const INDEX_NAMES = { IH: "上证50", IF: "沪深300", IC: "中证500", IM: "中证1000" };
const TERM_COLORS = { 当月: "#ff8a80", 下月: "#ff6b45", 当季: "#e34a42", 下季: "#8e5d58" };
const state = {
  payload: { schemaVersion: 1, updatedAt: "", sourceDate: "", status: "awaiting-first-upload", rows: [] },
  prefixes: new Set(PREFIXES),
  terms: new Set(TERMS),
  metric: "annualizedRate",
  startDate: "",
  endDate: "",
};

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
})[char]);
const fmt = (value, digits = 2, sign = false) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const number = Number(value);
  const text = number.toFixed(digits);
  return sign && number > 0 ? `+${text}` : text;
};
const fmtPercent = (value, digits = 2, sign = false) =>
  value === null || value === undefined ? "—" : `${fmt(value, digits, sign)}%`;
const valueClass = (value) => Number(value) >= 0 ? "positive" : "negative";

function setNotice(message, isError = false) {
  const notice = byId("notice");
  notice.hidden = !message;
  notice.textContent = message;
  notice.classList.toggle("error", isError);
}

function validatePayload(payload) {
  if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.rows)) {
    throw new Error("data.json 格式不正确");
  }
  for (const row of payload.rows) {
    if (!PREFIXES.includes(row.prefix) || !TERMS.includes(row.term)) {
      throw new Error(`发现未知指数或期限：${row.prefix}/${row.term}`);
    }
    if (row.spotPrice !== null && row.futuresPrice !== null && row.basis !== null) {
      const expected = Number(row.futuresPrice) - Number(row.spotPrice);
      if (Math.abs(Number(row.basis) - expected) > 0.051) {
        throw new Error(`基差校验失败：${row.contract}`);
      }
    }
  }
}

function applyTheme(theme) {
  const safeTheme = theme === "red" ? "red" : "blue";
  document.documentElement.dataset.theme = safeTheme;
  localStorage.setItem("indexBasisTheme", safeTheme);
  byId("theme-blue").classList.toggle("active", safeTheme === "blue");
  byId("theme-red").classList.toggle("active", safeTheme === "red");
}

function validMetricDates() {
  return state.payload.rows
    .filter((row) => row[state.metric] !== null && row[state.metric] !== undefined)
    .map((row) => row.date)
    .sort();
}

function resetDateRangeForMetric() {
  const dates = validMetricDates();
  state.startDate = dates[0] || "";
  state.endDate = dates[dates.length - 1] || "";
  byId("start-date").value = state.startDate;
  byId("end-date").value = state.endDate;
  byId("start-date").min = dates[0] || "";
  byId("start-date").max = dates[dates.length - 1] || "";
  byId("end-date").min = dates[0] || "";
  byId("end-date").max = dates[dates.length - 1] || "";
}

function renderChips() {
  byId("prefix-chips").innerHTML = PREFIXES.map((prefix) =>
    `<button type="button" class="chip ${state.prefixes.has(prefix) ? "active" : ""}" data-prefix="${prefix}">${prefix} · ${INDEX_NAMES[prefix]}</button>`
  ).join("");
  byId("term-chips").innerHTML = TERMS.map((term) =>
    `<button type="button" class="chip ${state.terms.has(term) ? "active" : ""}" data-term="${term}">${term}</button>`
  ).join("");

  document.querySelectorAll("[data-prefix]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.prefix;
      state.prefixes.has(value) ? state.prefixes.delete(value) : state.prefixes.add(value);
      renderChips();
      renderCharts();
    });
  });
  document.querySelectorAll("[data-term]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.term;
      state.terms.has(value) ? state.terms.delete(value) : state.terms.add(value);
      renderChips();
      renderCharts();
    });
  });
}

function latestRows() {
  const dates = state.payload.rows.map((row) => row.date).sort();
  const latestDate = dates[dates.length - 1] || "";
  return state.payload.rows
    .filter((row) => row.date === latestDate)
    .sort((a, b) => PREFIXES.indexOf(a.prefix) - PREFIXES.indexOf(b.prefix)
      || Number(a.remainingDays) - Number(b.remainingDays));
}

function renderCards(rows) {
  byId("card-grid").innerHTML = PREFIXES.map((prefix) => {
    const nearest = rows.filter((row) => row.prefix === prefix)
      .sort((a, b) => Number(a.remainingDays) - Number(b.remainingDays))[0];
    const ratio = nearest && Number(nearest.spotPrice)
      ? Number(nearest.basis) / Number(nearest.spotPrice) * 100 : null;
    return `<article class="index-card">
      <div class="card-top"><h3>${INDEX_NAMES[prefix]}</h3><span class="prefix-badge">${prefix}</span></div>
      <span class="eyebrow">现货指数</span>
      <strong class="spot">${nearest ? fmt(nearest.spotPrice) : "—"}</strong>
      <div class="card-foot">
        <span class="${nearest ? valueClass(nearest.basis) : ""}">
          ${nearest ? `${fmt(nearest.basis, 2, true)} · ${fmtPercent(ratio, 2, true)}` : "等待数据"}
        </span>
        <small>${nearest ? `${escapeHtml(nearest.contract)} · ${escapeHtml(nearest.term)}` : prefix}</small>
      </div>
    </article>`;
  }).join("");
}

function renderTable(rows) {
  const body = byId("latest-table-body");
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="10" class="empty-cell">等待 Windows 采集机发布首批数据</td></tr>';
    return;
  }
  body.innerHTML = rows.map((row) => `<tr>
    <td><strong>${escapeHtml(row.contract)}</strong><small>${escapeHtml(row.term)}</small></td>
    <td>${fmt(row.futuresPrice)}</td>
    <td class="${valueClass(row.priceChange)}">${fmt(row.priceChange, 2, true)}</td>
    <td class="${valueClass(row.priceChangePct)}">${fmtPercent(row.priceChangePct, 2, true)}</td>
    <td class="${valueClass(row.basis)}">${fmt(row.basis, 2, true)}</td>
    <td>${fmtPercent(row.annualizedRate, 2, true)}</td>
    <td class="adjusted">${fmtPercent(row.adjustedAnnualizedRate, 2, true)}</td>
    <td>${fmt(row.periodDividend, 4)}</td>
    <td>${escapeHtml(row.remainingDays)}</td>
    <td>${escapeHtml(row.expiryDate)}</td>
  </tr>`).join("");
}

function filteredRows() {
  return state.payload.rows.filter((row) =>
    state.prefixes.has(row.prefix)
    && state.terms.has(row.term)
    && (!state.startDate || row.date >= state.startDate)
    && (!state.endDate || row.date <= state.endDate)
  );
}

function chartSvg(rows, prefix) {
  const width = 720;
  const height = 300;
  const pad = { left: 54, right: 20, top: 20, bottom: 38 };
  const series = TERMS.filter((term) => state.terms.has(term)).map((term) => ({
    term,
    points: rows.filter((row) =>
      row.prefix === prefix && row.term === term
      && row[state.metric] !== null && row[state.metric] !== undefined
    ).sort((a, b) => a.date.localeCompare(b.date)),
  })).filter((item) => item.points.length);
  const all = series.flatMap((item) => item.points);
  if (!all.length) return '<div class="empty-chart">该区间暂无可绘制数据</div>';

  const dates = [...new Set(all.map((row) => row.date))].sort();
  const values = all.map((row) => Number(row[state.metric]));
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
  const spread = Math.max(max - min, 1);
  min -= spread * .12;
  max += spread * .12;
  const x = (date) => pad.left + (dates.indexOf(date) / Math.max(dates.length - 1, 1))
    * (width - pad.left - pad.right);
  const y = (value) => pad.top + ((max - value) / (max - min))
    * (height - pad.top - pad.bottom);
  const ticks = Array.from({ length: 5 }, (_, index) => max - ((max - min) * index) / 4);
  const dateTicks = [dates[0], dates[Math.floor((dates.length - 1) / 2)], dates[dates.length - 1]]
    .filter((value, index, array) => value && array.indexOf(value) === index);

  const grid = ticks.map((tick) => `<g>
    <line x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}" class="grid-line"></line>
    <text x="${pad.left - 10}" y="${y(tick) + 4}" text-anchor="end" class="axis-label">${fmt(tick, 1)}%</text>
  </g>`).join("");
  const zero = min < 0 && max > 0
    ? `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(0)}" y2="${y(0)}" class="zero-line"></line>` : "";
  const lines = series.map(({ term, points }) => {
    const coordinates = points.map((row) => `${x(row.date)},${y(Number(row[state.metric]))}`).join(" ");
    const dots = points.map((row) =>
      `<circle cx="${x(row.date)}" cy="${y(Number(row[state.metric]))}" r="${dates.length === 1 ? 4 : 2.3}" fill="${TERM_COLORS[term]}">
        <title>${escapeHtml(row.date)} ${escapeHtml(term)} ${fmtPercent(row[state.metric], 2, true)}</title>
      </circle>`
    ).join("");
    return `<polyline points="${coordinates}" fill="none" stroke="${TERM_COLORS[term]}" stroke-width="2.4"
      stroke-linejoin="round" stroke-linecap="round"></polyline>${dots}`;
  }).join("");
  const dateLabels = dateTicks.map((date) =>
    `<text x="${x(date)}" y="${height - 10}" text-anchor="middle" class="axis-label">${escapeHtml(date)}</text>`
  ).join("");
  return `<div class="chart-wrap"><svg viewBox="0 0 ${width} ${height}" role="img"
    aria-label="${INDEX_NAMES[prefix]}年化升贴水率走势">${grid}${zero}${lines}${dateLabels}</svg></div>`;
}

function renderCharts() {
  const rows = filteredRows();
  const selectedPrefixes = PREFIXES.filter((prefix) => state.prefixes.has(prefix));
  if (!selectedPrefixes.length) {
    byId("chart-grid").innerHTML = '<div class="empty-chart">请至少选择一个指数</div>';
    return;
  }
  byId("chart-grid").innerHTML = selectedPrefixes.map((prefix) => {
    const count = rows.filter((row) => row.prefix === prefix
      && row[state.metric] !== null && row[state.metric] !== undefined).length;
    const legend = TERMS.filter((term) => state.terms.has(term)).map((term) =>
      `<span><i style="background:${TERM_COLORS[term]}"></i>${term}</span>`
    ).join("");
    return `<article class="chart-card">
      <div class="chart-title"><div><strong>${prefix} · ${INDEX_NAMES[prefix]}</strong>
        <small>${count} 条有效日频记录${count > 0 && count <= 4 ? "（数据较少时显示为点）" : ""}</small></div>
        <div class="legend">${legend}</div>
      </div>${chartSvg(rows, prefix)}
    </article>`;
  }).join("");
}

function renderAll() {
  renderChips();
  const rows = latestRows();
  renderCards(rows);
  renderTable(rows);
  renderCharts();
  byId("updated-at").textContent = state.payload.updatedAt
    ? `更新时间：${new Date(state.payload.updatedAt).toLocaleString("zh-CN")}`
    : "尚未同步";
}

async function loadData() {
  try {
    const response = await fetch(`./data/data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    validatePayload(payload);
    state.payload = payload;
    resetDateRangeForMetric();
    byId("status-dot").className = payload.rows.length ? "status-dot live" : "status-dot";
    byId("status-text").textContent = payload.rows.length ? "数据已同步" : "等待首次发布";
    if (!payload.rows.length) setNotice("公共 HTML 已就绪，请先在 Windows 运行“手动测试公网更新_windows.bat”。");
    renderAll();
  } catch (error) {
    byId("status-dot").className = "status-dot error";
    byId("status-text").textContent = "数据读取失败";
    setNotice(`无法读取 data/data.json：${error.message}`, true);
    renderAll();
  }
}

function bindEvents() {
  byId("theme-blue").addEventListener("click", () => applyTheme("blue"));
  byId("theme-red").addEventListener("click", () => applyTheme("red"));
  byId("start-date").addEventListener("change", (event) => {
    state.startDate = event.target.value;
    renderCharts();
  });
  byId("end-date").addEventListener("change", (event) => {
    state.endDate = event.target.value;
    renderCharts();
  });
  byId("metric-select").addEventListener("change", (event) => {
    state.metric = event.target.value;
    resetDateRangeForMetric();
    renderCharts();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  applyTheme(localStorage.getItem("indexBasisTheme") || "blue");
  renderChips();
  loadData();
});
