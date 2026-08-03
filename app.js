"use strict";

const PREFIXES = ["IH", "IF", "IC", "IM"];
const TERMS = ["当月", "下月", "当季", "下季"];
const INDEX_NAMES = { IH: "上证50", IF: "沪深300", IC: "中证500", IM: "中证1000" };
const TERM_COLORS = { 当月: "#ff8a80", 下月: "#ff6b45", 当季: "#e34a42", 下季: "#8e5d58" };
const METRIC_LABELS = {
  annualizedRate: "年化升贴水率",
  adjustedAnnualizedRate: "年化升贴水率（剔除期内分红）",
  spotCumulativeValue: "指数累计值",
};
const PREFIX_COLORS = { IH: "#2563eb", IF: "#0891b2", IC: "#7c3aed", IM: "#ea580c" };
const state = {
  payload: { schemaVersion: 1, updatedAt: "", sourceDate: "", status: "awaiting-first-upload", rows: [] },
  prefixes: new Set(PREFIXES),
  terms: new Set(TERMS),
  chartTerms: Object.fromEntries(PREFIXES.map((prefix) => [prefix, new Set(TERMS)])),
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

  document.querySelectorAll("#prefix-chips [data-prefix]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.prefix;
      state.prefixes.has(value) ? state.prefixes.delete(value) : state.prefixes.add(value);
      renderChips();
      renderCharts();
    });
  });
  document.querySelectorAll("#term-chips [data-term]").forEach((button) => {
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
    const spotMoveAvailable = nearest
      && nearest.spotChange !== null && nearest.spotChange !== undefined
      && nearest.spotChangePct !== null && nearest.spotChangePct !== undefined;
    const spotMove = spotMoveAvailable
      ? `指数 ${fmt(nearest.spotChange, 2, true)} · ${fmtPercent(nearest.spotChangePct, 2, true)}`
      : "指数日涨跌等待 Wind";
    return `<article class="index-card">
      <div class="card-top"><h3>${INDEX_NAMES[prefix]}</h3><span class="prefix-badge">${prefix}</span></div>
      <span class="eyebrow">现货指数</span>
      <strong class="spot">${nearest ? fmt(nearest.spotPrice) : "—"}</strong>
      <div class="card-foot">
        <span class="${spotMoveAvailable ? valueClass(nearest.spotChange) : "unavailable"}"
          title="对应现货指数日涨跌">
          ${nearest ? spotMove : "等待数据"}
        </span>
      </div>
    </article>`;
  }).join("");
}

function renderTable(rows) {
  const body = byId("latest-table-body");
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="11" class="empty-cell">等待 Windows 采集机发布首批数据</td></tr>';
    return;
  }
  body.innerHTML = rows.map((row) => `<tr>
    <td>${row.contract === "IC2612"
      ? '<button type="button" class="contract-link" data-contract="IC2612" title="查看 IC2612 历史详情">IC2612</button>'
      : `<strong>${escapeHtml(row.contract)}</strong>`}<small>${escapeHtml(row.term)}</small></td>
    <td>${fmt(row.futuresPrice)}</td>
    <td class="${valueClass(row.priceChange)}">${fmt(row.priceChange, 2, true)}</td>
    <td class="${valueClass(row.priceChangePct)}">${fmtPercent(row.priceChangePct, 2, true)}</td>
    <td class="${valueClass(row.basis)}">${fmt(row.basis, 2, true)}</td>
    <td class="${valueClass(row.basisChangePct)}">${fmtPercent(row.basisChangePct, 2, true)}</td>
    <td>${fmtPercent(row.annualizedRate, 2, true)}</td>
    <td class="adjusted">${fmtPercent(row.adjustedAnnualizedRate, 2, true)}</td>
    <td>${fmt(row.periodDividend, 4)}</td>
    <td>${escapeHtml(row.remainingDays)}</td>
    <td>${escapeHtml(row.expiryDate)}</td>
  </tr>`).join("");
  document.querySelectorAll("[data-contract='IC2612']").forEach((button) => {
    button.addEventListener("click", () => renderContractDetail("IC2612"));
  });
}

function contractDetailChart(rows) {
  const usable = rows.filter((row) => row.priceChangePct !== null && row.priceChangePct !== undefined);
  if (!usable.length) return '<div class="empty-chart">该合约暂无可绘制的 Wind 日涨跌幅</div>';
  const width = 720;
  const height = 220;
  const pad = { left: 54, right: 20, top: 18, bottom: 36 };
  const dates = usable.map((row) => row.date);
  const values = usable.map((row) => Number(row.priceChangePct));
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
  const spread = Math.max(max - min, .5);
  min -= spread * .14;
  max += spread * .14;
  const x = (index) => pad.left + (index / Math.max(dates.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + ((max - value) / (max - min)) * (height - pad.top - pad.bottom);
  const coordinates = usable.map((row, index) => `${x(index)},${y(Number(row.priceChangePct))}`).join(" ");
  const dots = usable.map((row, index) => `<circle cx="${x(index)}" cy="${y(Number(row.priceChangePct))}"
    r="3.4" fill="#7c3aed"><title>${escapeHtml(row.date)} 合约涨跌幅 ${fmtPercent(row.priceChangePct, 2, true)}</title></circle>`).join("");
  const zero = `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(0)}" y2="${y(0)}" class="zero-line"></line>`;
  const labels = [0, Math.floor((dates.length - 1) / 2), dates.length - 1]
    .filter((value, index, array) => array.indexOf(value) === index)
    .map((index) => `<text x="${x(index)}" y="${height - 9}" text-anchor="middle" class="axis-label">${escapeHtml(dates[index])}</text>`).join("");
  return `<div class="chart-wrap detail-chart"><svg viewBox="0 0 ${width} ${height}" role="img"
    aria-label="IC2612 合约历史涨跌幅">${zero}<polyline points="${coordinates}" fill="none"
    stroke="#7c3aed" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></polyline>${dots}${labels}</svg></div>`;
}

function renderContractDetail(contract) {
  const section = byId("contract-detail");
  const rows = state.payload.rows.filter((row) => row.contract === contract)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) {
    section.hidden = false;
    section.innerHTML = '<div class="empty-chart">IC2612 尚无历史数据</div>';
    return;
  }
  const visibleRows = rows.slice(-120);
  section.innerHTML = `<div class="detail-head"><div><span class="section-kicker">CONTRACT DRILL-DOWN</span>
    <h3>${escapeHtml(contract)} 历史详情（试验）</h3>
    <p>${rows.length} 个日频观测；曲线为 Wind 合约涨跌幅，表格最多展示最近 120 条。</p></div>
    <button id="close-contract-detail" type="button" class="detail-close">收起 ×</button></div>
    ${contractDetailChart(rows)}
    <div class="table-scroll"><table class="detail-table"><thead><tr><th>日期</th><th>合约收盘</th>
    <th>合约涨跌幅</th><th>指数收盘</th><th>指数涨跌幅</th><th>基差</th>
    <th>基差涨跌幅</th><th>年化升贴水率</th><th>年化升贴水率（剔除分红）</th></tr></thead>
    <tbody>${visibleRows.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${fmt(row.futuresPrice)}</td>
    <td class="${valueClass(row.priceChangePct)}">${fmtPercent(row.priceChangePct, 2, true)}</td>
    <td>${fmt(row.spotPrice)}</td><td class="${valueClass(row.spotChangePct)}">${fmtPercent(row.spotChangePct, 2, true)}</td>
    <td class="${valueClass(row.basis)}">${fmt(row.basis, 2, true)}</td>
    <td class="${valueClass(row.basisChangePct)}">${fmtPercent(row.basisChangePct, 2, true)}</td>
    <td>${fmtPercent(row.annualizedRate, 2, true)}</td><td>${fmtPercent(row.adjustedAnnualizedRate, 2, true)}</td></tr>`).join("")}</tbody></table></div>`;
  section.hidden = false;
  byId("close-contract-detail").addEventListener("click", () => { section.hidden = true; });
  section.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const isCumulative = state.metric === "spotCumulativeValue";
  const localTerms = state.chartTerms[prefix];
  const series = isCumulative
    ? [{
      term: INDEX_NAMES[prefix],
      color: PREFIX_COLORS[prefix],
      points: rows.filter((row) => row.prefix === prefix
        && row[state.metric] !== null && row[state.metric] !== undefined)
        .sort((a, b) => a.date.localeCompare(b.date))
        .filter((row, index, array) => index === 0 || row.date !== array[index - 1].date),
    }]
    : TERMS.filter((term) => state.terms.has(term) && localTerms.has(term)).map((term) => ({
      term,
      color: TERM_COLORS[term],
      points: rows.filter((row) =>
        row.prefix === prefix && row.term === term
        && row[state.metric] !== null && row[state.metric] !== undefined
      ).sort((a, b) => a.date.localeCompare(b.date)),
    })).filter((item) => item.points.length);
  const all = series.flatMap((item) => item.points);
  if (!all.length) return '<div class="empty-chart">该区间暂无可绘制数据</div>';

  const dates = [...new Set(all.map((row) => row.date))].sort();
  const values = all.map((row) => Number(row[state.metric]));
  let min = isCumulative ? Math.min(...values) : Math.min(...values, 0);
  let max = isCumulative ? Math.max(...values) : Math.max(...values, 0);
  const spread = Math.max(max - min, isCumulative ? .01 : 1);
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
    <text x="${pad.left - 10}" y="${y(tick) + 4}" text-anchor="end" class="axis-label">${isCumulative ? fmt(tick, 4) : fmt(tick, 1) + "%"}</text>
  </g>`).join("");
  const zero = !isCumulative && min < 0 && max > 0
    ? `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(0)}" y2="${y(0)}" class="zero-line"></line>` : "";
  const lines = series.map(({ term, color, points }) => {
    const coordinates = points.map((row) => `${x(row.date)},${y(Number(row[state.metric]))}`).join(" ");
    const dots = points.map((row) => {
      const pointValue = isCumulative
        ? fmt(row[state.metric], 4, false)
        : fmtPercent(row[state.metric], 2, true);
      const pointLabel = `${row.date} ${term} ${METRIC_LABELS[state.metric]} ${pointValue}`;
      return `<g class="chart-point-group">
        <circle class="chart-point-dot" cx="${x(row.date)}" cy="${y(Number(row[state.metric]))}"
          r="${dates.length === 1 ? 4 : 2.3}" fill="${color}"></circle>
        <circle class="chart-point-hit" cx="${x(row.date)}" cy="${y(Number(row[state.metric]))}"
          r="11" tabindex="0" role="button" aria-label="${escapeHtml(pointLabel)}"
          data-date="${escapeHtml(row.date)}" data-term="${escapeHtml(term)}"
          data-value="${escapeHtml(pointValue)}"></circle>
      </g>`;
    }).join("");
    return `<polyline points="${coordinates}" fill="none" stroke="${color}" stroke-width="2.4"
      stroke-linejoin="round" stroke-linecap="round"></polyline>${dots}`;
  }).join("");
  const dateLabels = dateTicks.map((date) =>
    `<text x="${x(date)}" y="${height - 10}" text-anchor="middle" class="axis-label">${escapeHtml(date)}</text>`
  ).join("");
  return `<div class="chart-wrap"><svg viewBox="0 0 ${width} ${height}" role="img"
    aria-label="${INDEX_NAMES[prefix]}${METRIC_LABELS[state.metric]}走势">${grid}${zero}${lines}${dateLabels}</svg>
    <div class="chart-tooltip" role="status" hidden></div></div>`;
}

function hideChartTooltips(except = null) {
  document.querySelectorAll(".chart-tooltip").forEach((tooltip) => {
    if (tooltip !== except) tooltip.hidden = true;
  });
}

function showChartTooltip(point, event = null) {
  const wrap = point.closest(".chart-wrap");
  const tooltip = wrap ? wrap.querySelector(".chart-tooltip") : null;
  if (!wrap || !tooltip) return;
  hideChartTooltips(tooltip);
  tooltip.textContent = `${point.dataset.date} · ${point.dataset.term} · `
    + `${METRIC_LABELS[state.metric]} ${point.dataset.value}`;
  tooltip.hidden = false;

  const wrapRect = wrap.getBoundingClientRect();
  const pointRect = point.getBoundingClientRect();
  const clientX = event && Number.isFinite(event.clientX) && event.clientX
    ? event.clientX : pointRect.left + pointRect.width / 2;
  const clientY = event && Number.isFinite(event.clientY) && event.clientY
    ? event.clientY : pointRect.top + pointRect.height / 2;
  const preferredLeft = clientX - wrapRect.left + 12;
  const preferredTop = clientY - wrapRect.top - tooltip.offsetHeight - 12;
  tooltip.style.left = `${Math.max(8, Math.min(preferredLeft, wrapRect.width - tooltip.offsetWidth - 8))}px`;
  tooltip.style.top = `${Math.max(8, preferredTop)}px`;
}

function bindChartInteractions() {
  document.querySelectorAll("[data-legend-term]").forEach((button) => {
    button.addEventListener("click", () => {
      const prefix = button.dataset.chartPrefix;
      const term = button.dataset.legendTerm;
      const localTerms = state.chartTerms[prefix];
      localTerms.has(term) ? localTerms.delete(term) : localTerms.add(term);
      renderCharts();
    });
  });
  document.querySelectorAll(".chart-point-hit").forEach((point) => {
    point.addEventListener("pointerenter", (event) => showChartTooltip(point, event));
    point.addEventListener("pointermove", (event) => showChartTooltip(point, event));
    point.addEventListener("focus", () => showChartTooltip(point));
    point.addEventListener("click", (event) => {
      event.stopPropagation();
      showChartTooltip(point, event);
    });
  });
}

function renderCharts() {
  const isCumulativeMetric = state.metric === "spotCumulativeValue";
  byId("trend-title").textContent = isCumulativeMetric ? "指数累计值走势" : "年化升贴水率走势";
  byId("trend-subtitle").textContent = isCumulativeMetric
    ? "每个指数的首个 Wind 交易日为 1，后续按指数日涨跌幅逐日连乘。"
    : "贴水显示在零轴下方；区间、指数与期限均可调整。";
  const rows = filteredRows();
  const selectedPrefixes = PREFIXES.filter((prefix) => state.prefixes.has(prefix));
  if (!selectedPrefixes.length) {
    byId("chart-grid").innerHTML = '<div class="empty-chart">请至少选择一个指数</div>';
    return;
  }
  byId("chart-grid").innerHTML = selectedPrefixes.map((prefix) => {
    const localTerms = state.chartTerms[prefix];
    const isCumulative = state.metric === "spotCumulativeValue";
    const count = rows.filter((row) => row.prefix === prefix
      && localTerms.has(row.term)
      && row[state.metric] !== null && row[state.metric] !== undefined).length;
    const legend = isCumulative ? "" : TERMS.map((term) => {
      const globallyEnabled = state.terms.has(term);
      const active = globallyEnabled && localTerms.has(term);
      return `<button type="button" class="legend-item ${active ? "active" : ""}"
        data-chart-prefix="${prefix}" data-legend-term="${term}"
        aria-pressed="${active}" ${globallyEnabled ? "" : "disabled"}
        title="${globallyEnabled ? `仅在${prefix}图中显示或隐藏${term}` : `请先在上方期限筛选中启用${term}`}">
        <i style="background:${TERM_COLORS[term]}"></i>${term}</button>`;
    }).join("");
    return `<article class="chart-card">
      <div class="chart-title"><div><strong>${prefix} · ${INDEX_NAMES[prefix]}</strong>
        <small>${isCumulative ? new Set(rows.filter((row) => row.prefix === prefix && row.spotCumulativeValue != null).map((row) => row.date)).size : count} 个有效交易日${count > 0 && count <= 4 ? "（数据较少时显示为点）" : ""}</small></div>
        <div class="legend">${legend}</div>
      </div>${chartSvg(rows, prefix)}
    </article>`;
  }).join("");
  bindChartInteractions();
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
  byId("chart-grid").addEventListener("click", (event) => {
    if (!event.target.closest(".chart-point-hit")) hideChartTooltips();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  applyTheme(localStorage.getItem("indexBasisTheme") || "blue");
  renderChips();
  loadData();
});
