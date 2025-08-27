let RAW_DATA = [];
let FILTERED = [];
const charts = {};
let ACTIVE_TAB = "overview";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await loadData();
  populateControls();
  attachEvents();
  await applyFiltersAndRender(); // initial render
  // ensure we draw charts for default (overview) tab
  updateChartsForTab("overview");
}

/* -------------------- Data -------------------- */

async function loadData() {
  const r = await fetch("/api/data");
  RAW_DATA = await r.json();
}

function populateControls() {
  // Delivery Status options (unique from RAW_DATA)
  const statuses = [...new Set(RAW_DATA.map(d => d.delivery_status))].filter(Boolean).sort();
  const ds = document.getElementById("deliveryStatus");
  ds.innerHTML = statuses.map(s => `<option value="${s}" selected>${s}</option>`).join("");

  // Countries
  const countries = [...new Set(RAW_DATA.map(d => d.customer_country))].filter(Boolean).sort();
  document.getElementById("customerCountry").innerHTML =
    countries.map(c => `<option value="${c}" selected>${c}</option>`).join("");

  // Categories
  const cats = [...new Set(RAW_DATA.map(d => d.category_name))].filter(Boolean).sort();
  document.getElementById("category").innerHTML =
    cats.map(c => `<option value="${c}" selected>${c}</option>`).join("");
}

function attachEvents() {
  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      if (target === ACTIVE_TAB) return;
      ACTIVE_TAB = target;

      // button states
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      // content visibility
      document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
      document.getElementById(target).classList.add("active");

      // draw only what this tab needs
      updateChartsForTab(target);
    });
  });

  // Filters
  document.getElementById("applyFilters").addEventListener("click", applyFiltersAndRender);
  document.getElementById("resetFilters").addEventListener("click", resetFilters);
  document.getElementById("downloadData").addEventListener("click", downloadCSV);

  // Simulation
  document.getElementById("runSimulation").addEventListener("click", runSimulation);
}

function resetFilters() {
  document.getElementById("startDate").value = "2020-01-01";
  document.getElementById("endDate").value = "2024-12-31";
  ["deliveryStatus", "customerCountry", "category"].forEach(id => {
    const el = document.getElementById(id);
    [...el.options].forEach(o => (o.selected = true));
  });
  applyFiltersAndRender();
}

async function applyFiltersAndRender() {
  const filters = {
    startDate: document.getElementById("startDate").value,
    endDate: document.getElementById("endDate").value,
    deliveryStatus: [...document.getElementById("deliveryStatus").selectedOptions].map(o => o.value),
    customerCountry: [...document.getElementById("customerCountry").selectedOptions].map(o => o.value),
    category: [...document.getElementById("category").selectedOptions].map(o => o.value)
  };

  const resp = await fetch("/api/filter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(filters)
  });
  const payload = await resp.json();

  FILTERED = payload.filtered_records || [];
  updateKPIs(payload.kpis);

  // cache for other tabs
  window._aggregates = payload.aggregates || { monthly_labels: [], avg_delays: [] };
  window._countryRisk = payload.country_risk || { countries: [], risk_percentages: [] };
  window._interArrival = payload.inter_arrival_times || [];

  // refresh current tab's charts only
  updateChartsForTab(ACTIVE_TAB);
}

/* -------------------- KPIs -------------------- */

function updateKPIs(kpis) {
  document.getElementById("totalOrders").textContent = (kpis.total_orders || 0).toLocaleString();
  document.getElementById("lateDeliveryPercent").textContent = `${kpis.late_delivery_percent || 0}%`;
  document.getElementById("avgShippingDelay").textContent = kpis.avg_shipping_delay || 0;
  document.getElementById("avgProfit").textContent = `$${(kpis.avg_profit || 0).toLocaleString()}`;
}

/* -------------------- Tabs dispatcher -------------------- */

function updateChartsForTab(tab) {
  switch (tab) {
    case "overview":
      drawOverviewCharts(window._aggregates, window._countryRisk);
      break;
    case "frequency":
      drawFrequencyCharts(window._interArrival);
      break;
    case "severity":
      drawSeverityCharts(FILTERED);
      break;
    case "simulation":
      // nothing until user presses Run Simulation
      break;
  }
}

/* -------------------- Overview -------------------- */

function drawOverviewCharts(aggregates, countryRisk) {
  const labels = aggregates?.monthly_labels || [];
  const data = aggregates?.avg_delays || [];

  // Delay Trends
  if (!charts.delayTrends) {
    charts.delayTrends = new Chart(document.getElementById("delayTrendsChart"), {
      type: "line",
      data: {
        labels,
        datasets: [{ label: "Avg delay (days)", data, borderColor: "#2563eb", backgroundColor: "#93c5fd", tension: 0.35, fill: true, pointRadius: 3 }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  } else {
    charts.delayTrends.data.labels = labels;
    charts.delayTrends.data.datasets[0].data = data;
    charts.delayTrends.update();
  }

  // Delivery Status
  const statusCounts = {};
  for (const r of FILTERED) statusCounts[r.delivery_status] = (statusCounts[r.delivery_status] || 0) + 1;
  const sLabels = Object.keys(statusCounts);
  const sData = sLabels.map(k => statusCounts[k]);

  if (!charts.deliveryStatus) {
    charts.deliveryStatus = new Chart(document.getElementById("deliveryStatusChart"), {
      type: "bar",
      data: { labels: sLabels, datasets: [{ label: "Orders", data: sData, backgroundColor: "#16a34a" }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  } else {
    charts.deliveryStatus.data.labels = sLabels;
    charts.deliveryStatus.data.datasets[0].data = sData;
    charts.deliveryStatus.update();
  }

  // Country Risk (horizontal)
  const countries = countryRisk?.countries || [];
  const risk = countryRisk?.risk_percentages || [];

  if (!charts.countryRisk) {
    charts.countryRisk = new Chart(document.getElementById("countryRiskChart"), {
      type: "bar",
      data: { labels: countries, datasets: [{ label: "% Late", data: risk, backgroundColor: "#f59e0b" }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: "y", scales: { x: { min: 0, max: 100 } } }
    });
  } else {
    charts.countryRisk.data.labels = countries;
    charts.countryRisk.data.datasets[0].data = risk;
    charts.countryRisk.update();
  }
}

/* -------------------- Frequency -------------------- */

function drawFrequencyCharts(interArrivals) {
  if (!interArrivals || !interArrivals.length) {
    if (charts.interArrival) charts.interArrival.destroy(), delete charts.interArrival;
    return;
  }

  const bins = 20;
  const min = Math.min(...interArrivals);
  const max = Math.max(...interArrivals);
  const width = Math.max(1e-6, (max - min) / bins);
  const counts = new Array(bins).fill(0);

  interArrivals.forEach(v => {
    const idx = Math.min(Math.floor((v - min) / width), bins - 1);
    counts[idx]++;
  });
  const labels = counts.map((_, i) => (min + i * width).toFixed(1));

  if (!charts.interArrival) {
    charts.interArrival = new Chart(document.getElementById("interArrivalChart"), {
      type: "bar",
      data: { labels, datasets: [{ label: "Frequency", data: counts, backgroundColor: "#2563eb" }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  } else {
    charts.interArrival.data.labels = labels;
    charts.interArrival.data.datasets[0].data = counts;
    charts.interArrival.update();
  }
}

/* -------------------- Severity -------------------- */

function drawSeverityCharts(rows) {
  if (!rows || !rows.length) {
    ["profitBox", "profitDensity"].forEach(k => { if (charts[k]) { charts[k].destroy(); delete charts[k]; }});
    return;
  }

  // Profit by status (median)
  const bucket = {};
  for (const r of rows) {
    (bucket[r.delivery_status] ||= []).push(Number(r.order_profit_per_order) || 0);
  }
  const labels = Object.keys(bucket);
  const medians = labels.map(k => {
    const arr = bucket[k].sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
    });

  if (!charts.profitBox) {
    charts.profitBox = new Chart(document.getElementById("profitBoxChart"), {
      type: "bar",
      data: { labels, datasets: [{ label: "Median Profit", data: medians, backgroundColor: "#9333ea" }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  } else {
    charts.profitBox.data.labels = labels;
    charts.profitBox.data.datasets[0].data = medians;
    charts.profitBox.update();
  }

  // Profit density (simple KDE)
  const profits = rows.map(r => Number(r.order_profit_per_order) || 0).sort((a, b) => a - b);
  const pmin = profits[0], pmax = profits[profits.length - 1];
  const steps = 50, bw = Math.max(1e-6, (pmax - pmin) / 10);
  const xs = [], ys = [];
  for (let i = 0; i <= steps; i++) {
    const x = pmin + (i * (pmax - pmin)) / steps;
    let d = 0;
    for (const p of profits) {
      const u = (x - p) / bw;
      d += Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
    }
    xs.push(x.toFixed(0));
    ys.push(d / (profits.length * bw));
  }

  if (!charts.profitDensity) {
    charts.profitDensity = new Chart(document.getElementById("profitDensityChart"), {
      type: "line",
      data: { labels: xs, datasets: [{ label: "Profit Density", data: ys, borderColor: "#ef4444", fill: true, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  } else {
    charts.profitDensity.data.labels = xs;
    charts.profitDensity.data.datasets[0].data = ys;
    charts.profitDensity.update();
  }
}

/* -------------------- Simulation -------------------- */

async function runSimulation() {
  const payload = {
    numSimulations: Number(document.getElementById("numSimulations").value) || 1000,
    timeHorizon: Number(document.getElementById("timeHorizon").value) || 365,
    distribution: document.getElementById("distribution").value || "weibull",
    inter_arrival_times: window._interArrival || []
  };

  const r = await fetch("/api/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const res = await r.json();

  if (res.error) {
    document.getElementById("simulationResult").innerText = res.error;
    return;
  }

  // Disruption counts — draw histogram of counts
  const counts = res.disruptionCounts;
  const labels = counts.map((_, i) => i + 1);
  if (!charts.simCount) {
    charts.simCount = new Chart(document.getElementById("simulationCountChart"), {
      type: "bar",
      data: { labels, datasets: [{ label: "Disruptions", data: counts, backgroundColor: "#16a34a" }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  } else {
    charts.simCount.data.labels = labels;
    charts.simCount.data.datasets[0].data = counts;
    charts.simCount.update();
  }

  // Total cost distribution
  const costs = res.totalCosts;
  const costLabels = costs.map((_, i) => i + 1);
  if (!charts.simCost) {
    charts.simCost = new Chart(document.getElementById("simulationCostChart"), {
      type: "line",
      data: { labels: costLabels, datasets: [{ label: "Total Cost", data: costs, borderColor: "#f59e0b", fill: false, pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false }
    });
  } else {
    charts.simCost.data.labels = costLabels;
    charts.simCost.data.datasets[0].data = costs;
    charts.simCost.update();
  }

  document.getElementById("simulationResult").innerText =
    `Mean disruptions: ${res.stats.meanDisruptions.toFixed(2)} | ` +
    `Std: ${res.stats.stdDisruptions.toFixed(2)} | ` +
    `Mean cost: $${res.stats.meanTotalCost.toFixed(0)} | ` +
    `95% VaR: $${res.stats.var95.toFixed(0)} | 99% VaR: $${res.stats.var99.toFixed(0)} | ` +
    `Max cost: $${res.stats.maxCost.toFixed(0)}`;
}

/* -------------------- Download -------------------- */

function downloadCSV() {
  const filters = {
    startDate: document.getElementById("startDate").value,
    endDate: document.getElementById("endDate").value,
    deliveryStatus: [...document.getElementById("deliveryStatus").selectedOptions].map(o => o.value),
    customerCountry: [...document.getElementById("customerCountry").selectedOptions].map(o => o.value),
    category: [...document.getElementById("category").selectedOptions].map(o => o.value)
  };

  fetch("/download/data.csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(filters)
  })
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "filtered_data.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
}