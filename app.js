"use strict";

const PREFIXES = ["IH", "IF", "IC", "IM"];
const TERMS = ["当月", "下月", "当季", "下季"];
const INDEX_NAMES = { IH: "上证50", IF: "沪深300", IC: "中证500", IM: "中证1000" };
const TERM_COLORS = { 当月: "#ff8a80", 下月: "#ff6b45", 当季: "#e34a42", 下季: "#8e5d58" };
const METRIC_LABELS = {
  annualizedRate: "年化升贴水率",
  adjustedAnnualizedRate: "年化升贴水率（剔除期内分红）",
  spotCumulativeValue: "指数累计值",
  termPremiumDiscountChangeCumulativeValue: "升贴水率变动累计值",
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
    <td class="${valueClass(row.premiumDiscountChangePct)}">${fmtPercent(row.premiumDiscountChangePct, 2, true)}</td>
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
  const usable = rows.filter((row) => row.premiumDiscountChangeCumulativeValue !== null
    && row.premiumDiscountChangeCumulativeValue !== undefined);
  if (!usable.length) return '<div class="empty-chart">该合约暂无可绘制的升贴水率变动累计值</div>';
  const width = 720;
  const height = 220;
  const pad = { left: 54, right: 20, top: 18, bottom: 36 };
  const dates = usable.map((row) => row.date);
  const values = usable.map((row) => Number(row.premiumDiscountChangeCumulativeValue));
  let min = Math.min(...values, 1);
  let max = Math.max(...values, 1);
  const spread = Math.max(max - min, .01);
  min -= spread * .14;
  max += spread * .14;
  const x = (index) => pad.left + (index / Math.max(dates.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + ((max - value) / (max - min)) * (height - pad.top - pad.bottom);
  const ticks = Array.from({ length: 5 }, (_, index) => max - ((max - min) * index) / 4);
  const grid = ticks.map((tick) => `<g>
    <line x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick)}" y2="${y(tick)}" class="grid-line"></line>
    <text x="${pad.left - 10}" y="${y(tick) + 4}" text-anchor="end" class="axis-label">${fmt(tick, 4)}</text>
  </g>`).join("");
  const coordinates = usable.map((row, index) => `${x(index)},${y(Number(row.premiumDiscountChangeCumulativeValue))}`).join(" ");
  const dots = usable.map((row, index) => {
    const pointValue = fmt(row.premiumDiscountChangeCumulativeValue, 6, false);
    const rateValue = fmtPercent(row.premiumDiscountRatePct, 4, true);
    const pointLabel = `${row.date} IC2612 升贴水率变动累计值 ${pointValue}`;
    return `<g class="chart-point-group">
      <circle class="chart-point-dot" cx="${x(index)}" cy="${y(Number(row.premiumDiscountChangeCumulativeValue))}"
        r="${dates.length === 1 ? 4 : 2.8}" fill="#7c3aed"></circle>
      <circle class="chart-point-hit" cx="${x(index)}" cy="${y(Number(row.premiumDiscountChangeCumulativeValue))}"
        r="11" tabindex="0" role="button" aria-label="${escapeHtml(pointLabel)}"
        data-date="${escapeHtml(row.date)}" data-term="IC2612"
        data-contract="IC2612" data-rate="${escapeHtml(rateValue)}"
        data-label="升贴水率变动累计值" data-value="${escapeHtml(pointValue)}"></circle>
    </g>`;
  }).join("");
  const baseline = `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(1)}" y2="${y(1)}" class="zero-line"></line>`;
  const labels = [0, Math.floor((dates.length - 1) / 2), dates.length - 1]
    .filter((value, index, array) => array.indexOf(value) === index)
    .map((index) => `<text x="${x(index)}" y="${height - 9}" text-anchor="middle" class="axis-label">${escapeHtml(dates[index])}</text>`).join("");
  return `<div class="chart-wrap detail-chart"><svg viewBox="0 0 ${width} ${height}" role="img"
    aria-label="IC2612 升贴水率变动累计值">${grid}${baseline}<polyline points="${coordinates}" fill="none"
    stroke="#7c3aed" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></polyline>${dots}${labels}</svg>
    <div class="chart-tooltip" role="status" hidden></div></div>`;
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
  section.innerHTML = `<div class="detail-head"><div><span class="section-kicker">CONTRACT DRILL-DOWN</span>
    <h3>${escapeHtml(contract)} 合约历史详情</h3>
    <p>${rows.length} 个日频观测；可悬停或点击曲线查看升贴水率变动累计值。具体日频数据保留在 Windows 本地数据库中。</p></div>
    <button id="close-contract-detail" type="button" class="detail-close">收起 ×</button></div>
    ${contractDetailChart(rows)}`;
  section.hidden = false;
  bindChartPointInteractions(section);
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

function sampleChartPoints(points, maxPoints = 180) {
  if (points.length <= maxPoints) return points;
  const required = new Set([0, points.length - 1]);
  points.forEach((row, index) => {
    if (index > 0 && row.contract !== points[index - 1].contract) {
      required.add(index - 1);
      required.add(index);
    }
  });
  const remaining = Math.max(maxPoints - required.size, 0);
  if (remaining > 0) {
    const step = (points.length - 1) / Math.max(remaining - 1, 1);
    for (let index = 0; index < remaining; index += 1) {
      required.add(Math.round(index * step));
    }
  }
  return [...required].sort((a, b) => a - b).map((index) => points[index]);
}

function chartSvg(rows, prefix) {
  const width = 720;
  const height = 300;
  const pad = { left: 54, right: 20, top: 20, bottom: 38 };
  const isIndexCumulative = state.metric === "spotCumulativeValue";
  const isPremiumCumulative = state.metric === "termPremiumDiscountChangeCumulativeValue";
  const isCumulative = isIndexCumulative || isPremiumCumulative;
  const localTerms = state.chartTerms[prefix];
  const series = isIndexCumulative
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
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const values = all.map((row) => Number(row[state.metric]));
  let min = isCumulative ? Math.min(...values, 1) : Math.min(...values, 0);
  let max = isCumulative ? Math.max(...values, 1) : Math.max(...values, 0);
  const spread = Math.max(max - min, isCumulative ? .01 : 1);
  min -= spread * .12;
  max += spread * .12;
  const x = (date) => pad.left + ((dateIndex.get(date) || 0) / Math.max(dates.length - 1, 1))
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
  const referenceLine = isCumulative
    ? `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(1)}" y2="${y(1)}" class="zero-line"></line>`
    : min < 0 && max > 0
      ? `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(0)}" y2="${y(0)}" class="zero-line"></line>` : "";
  const lines = series.map(({ term, color, points }) => {
    // “当月”等期限标签会随换月对应不同合约。累计值必须按
    // 具体合约分段画线，不能把旧合约末点与新合约首点直接相连。
    const segments = isPremiumCumulative
      ? [...points.reduce((groups, row) => {
        const contract = row.contract || "unknown";
        if (!groups.has(contract)) groups.set(contract, []);
        groups.get(contract).push(row);
        return groups;
      }, new Map()).values()]
      : [points];
    const paths = segments.map((segment) => {
      const coordinates = segment.map((row) => `${x(row.date)},${y(Number(row[state.metric]))}`).join(" ");
      return `<polyline points="${coordinates}" fill="none" stroke="${color}" stroke-width="2.4"
        stroke-linejoin="round" stroke-linecap="round"></polyline>`;
    }).join("");
    const dots = sampleChartPoints(points).map((row) => {
      const pointValue = isCumulative
        ? fmt(row[state.metric], isPremiumCumulative ? 6 : 4, false)
        : fmtPercent(row[state.metric], 2, true);
      const rateValue = isPremiumCumulative
        ? fmtPercent(row.premiumDiscountRatePct, 4, true) : "";
      const pointLabel = `${row.date} ${term} ${METRIC_LABELS[state.metric]} ${pointValue}`;
      return `<circle class="chart-point-hit interactive-dot" cx="${x(row.date)}" cy="${y(Number(row[state.metric]))}"
          r="${dates.length === 1 ? 4.5 : 3.2}" tabindex="0" role="button"
          style="fill:${color}" aria-label="${escapeHtml(pointLabel)}"
          data-date="${escapeHtml(row.date)}" data-term="${escapeHtml(term)}"
          data-contract="${escapeHtml(row.contract || "")}" data-rate="${escapeHtml(rateValue)}"
          data-value="${escapeHtml(pointValue)}"></circle>`;
    }).join("");
    return `${paths}${dots}`;
  }).join("");
  const dateLabels = dateTicks.map((date) =>
    `<text x="${x(date)}" y="${height - 10}" text-anchor="middle" class="axis-label">${escapeHtml(date)}</text>`
  ).join("");
  return `<div class="chart-wrap"><svg viewBox="0 0 ${width} ${height}" role="img"
    aria-label="${INDEX_NAMES[prefix]}${METRIC_LABELS[state.metric]}走势">${grid}${referenceLine}${lines}${dateLabels}</svg>
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
  const metricLabel = point.dataset.label || METRIC_LABELS[state.metric];
  tooltip.textContent = `${point.dataset.date} · ${point.dataset.term} · `
    + `${metricLabel} ${point.dataset.value}`
    + (point.dataset.contract ? ` · 合约 ${point.dataset.contract}` : "")
    + (point.dataset.rate ? ` · 非年化升贴水率 ${point.dataset.rate}` : "");
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

function bindChartPointInteractions(container = document) {
  container.querySelectorAll(".chart-point-hit").forEach((point) => {
    if (point.dataset.interactionBound === "1") return;
    point.dataset.interactionBound = "1";
    point.addEventListener("pointerenter", (event) => showChartTooltip(point, event));
    point.addEventListener("pointermove", (event) => showChartTooltip(point, event));
    point.addEventListener("focus", () => showChartTooltip(point));
    point.addEventListener("click", (event) => {
      event.stopPropagation();
      showChartTooltip(point, event);
    });
  });
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
  bindChartPointInteractions(document);
}

function renderCharts() {
  const isIndexCumulative = state.metric === "spotCumulativeValue";
  const isPremiumCumulative = state.metric === "termPremiumDiscountChangeCumulativeValue";
  byId("trend-title").textContent = isIndexCumulative
    ? "指数累计值走势"
    : isPremiumCumulative ? "IC、IM 升贴水率变动累计值" : "年化升贴水率走势";
  byId("trend-subtitle").textContent = isIndexCumulative
    ? "每个指数的首个 Wind 交易日为 1，后续按指数日涨跌幅逐日连乘。"
    : isPremiumCumulative
      ? "仅展示 IC、IM；为避免前日升贴水率接近0时比值失真，图表使用日度百分点差计算；表格仍显示相对变动率。各合约独立以1为基准，换合约时断线重置。"
      : "贴水显示在零轴下方；区间、指数与期限均可调整。";
  const rows = filteredRows();
  const selectedPrefixes = PREFIXES.filter((prefix) => state.prefixes.has(prefix)
    && (!isPremiumCumulative || ["IC", "IM"].includes(prefix)));
  if (!selectedPrefixes.length) {
    byId("chart-grid").innerHTML = '<div class="empty-chart">请至少选择一个指数</div>';
    return;
  }
  byId("chart-grid").innerHTML = selectedPrefixes.map((prefix) => {
    const localTerms = state.chartTerms[prefix];
    const isCumulative = isIndexCumulative || isPremiumCumulative;
    const count = rows.filter((row) => row.prefix === prefix
      && localTerms.has(row.term)
      && row[state.metric] !== null && row[state.metric] !== undefined).length;
    const legend = isIndexCumulative ? "" : TERMS.map((term) => {
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
        <small>${isCumulative ? new Set(rows.filter((row) => row.prefix === prefix && row[state.metric] != null).map((row) => row.date)).size : count} 个有效交易日${count > 0 && count <= 4 ? "（数据较少时显示为点）" : ""}</small></div>
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
  byId("updated-at").textContent = state.payload.updatedAt
    ? `更新时间：${new Date(state.payload.updatedAt).toLocaleString("zh-CN")}`
    : "尚未同步";
  byId("chart-grid").innerHTML = '<div class="empty-chart">正在绘制历史图表…</div>';
  requestAnimationFrame(() => renderCharts());
}

async function loadData() {
  try {
    setNotice("正在读取历史数据…");
    const response = await fetch(`./data/data.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    validatePayload(payload);
    state.payload = payload;
    resetDateRangeForMetric();
    byId("status-dot").className = payload.rows.length ? "status-dot live" : "status-dot";
    byId("status-text").textContent = payload.rows.length ? "数据已同步" : "等待首次发布";
    if (!payload.rows.length) {
      setNotice("公共 HTML 已就绪，请先在 Windows 运行“手动测试公网更新_windows.bat”。");
    } else {
      setNotice("");
    }
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
