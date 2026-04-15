let latestHeatmapData = [];
let latestOIData = {};
let latestStockData = [];
let currentFilter = 'All';
let currentOIIndex = 'NIFTY';
let currentExpiry = ''; 
let isScanning = false;

// --- CHART STATE VARIABLES ---
let chartSymbol = 'NIFTY';
let chartTF = '15';
let isMAActive = false;
let isSRActive = false;
let isTLActive = false;
let chartInitialized = false;

let lwChart, candleSeries, maSeries, trendlineSeries;
let srLines = [];
let chartCandles = [];
window.livePrices = { NIFTY: 22000, BANKNIFTY: 46000, FINNIFTY: 20500, SENSEX: 73000 };

document.addEventListener("DOMContentLoaded", function() {
    console.log("MarketPro JS Engine Loaded.");

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function() {
            try {
                document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
                this.classList.add('active');

                document.querySelectorAll('.content-section').forEach(sec => sec.classList.remove('active'));
                const target = this.getAttribute('data-target');
                if (target) document.getElementById(target).classList.add('active');
                
                if(target === 'chart-section' && !chartInitialized) {
                    setTimeout(() => {
                        initLightweightChart();
                        chartInitialized = true;
                    }, 50);
                }
                
                if(target === 'heatmap-section') updateSliderBackground('slider-bg', document.querySelector('.segment[data-filter].active'));
                if(target === 'oi-section') updateSliderBackground('oi-slider-bg', document.querySelector('.segment[data-index].active'));
            } catch (err) {
                console.error("Navigation Error:", err);
            }
        });
    });

    setInterval(() => {
        const clk = document.getElementById('clock');
        if(clk) clk.innerText = new Date().toLocaleTimeString();
    }, 1000);
});

// --- BULLETPROOF DATA POLLING ---
async function fetchMarketData() {
    try {
        let response = await fetch('/api/market_data');
        if (response.ok) {
            let data = await response.json();
            
            // Failsafe: Ensures data exists before attempting to process
            if (data && data.nifty) {
                processMarketData(data);
                
                let status = document.getElementById('mkt-status');
                if(status) {
                    status.innerText = "● LIVE CONNECTION";
                    status.style.color = "#10b981";
                    status.style.background = "rgba(16, 185, 129, 0.1)";
                }
            }
        }
    } catch (e) {
        console.log("Waiting for data stream...");
    }
}

// Initial fetch and 4-second loop
fetchMarketData();
setInterval(fetchMarketData, 4000);

// --- MAIN DATA PROCESSOR ---
function processMarketData(data) {
    try {
        if (data.nifty) {
            updateDashboardCard('nifty-card', 'nifty', data.nifty);
            updateOptionRecommendation('trade-nifty', 'NIFTY', data.nifty, 50);
            window.livePrices['NIFTY'] = data.nifty.price;
            window.livePrices['SENSEX'] = data.nifty.price * 3.3; 
        }
        if (data.banknifty) {
            updateDashboardCard('bn-card', 'bn', data.banknifty);
            updateOptionRecommendation('trade-bn', 'BANKNIFTY', data.banknifty, 100);
            window.livePrices['BANKNIFTY'] = data.banknifty.price;
        }
        if (data.heatmap) {
            latestHeatmapData = data.heatmap;
            renderDashboardSectors(data.heatmap); 
            renderAdvancedHeatmap();
        }
        if (data.fii_dii && data.fii_dii.length > 0) renderFiiDiiTable(data.fii_dii);
        
        if (data.oi_data && Object.keys(data.oi_data).length > 0) {
            latestOIData = data.oi_data;
            updateExpiryDropdown();
            renderOITable();
        }
        
        if (data.stock_analysis && data.stock_analysis.length > 0 && !isScanning && latestStockData.length === 0) {
            latestStockData = data.stock_analysis;
            renderStockTable(latestStockData);
        }

        if (chartInitialized && chartCandles.length > 0) {
            const livePrice = window.livePrices[chartSymbol];
            const lastCandle = chartCandles[chartCandles.length - 1];
            lastCandle.close = livePrice;
            lastCandle.high = Math.max(lastCandle.high, livePrice);
            lastCandle.low = Math.min(lastCandle.low, livePrice);
            candleSeries.update(lastCandle);
        }
    } catch (err) {
        console.error("Data Processing Error:", err);
    }
}

// --- OPEN SOURCE CHART ENGINE ---
function initLightweightChart() {
    const container = document.getElementById('custom_chart_container');
    if(!container) return;
    container.innerHTML = ''; 

    const chartWidth = container.parentElement.clientWidth || 800;
    const chartHeight = container.parentElement.clientHeight || 650;

    lwChart = LightweightCharts.createChart(container, {
        width: chartWidth,
        height: chartHeight,
        layout: { backgroundColor: '#ffffff', textColor: '#334155' },
        grid: { vertLines: { color: '#f1f5f9' }, horzLines: { color: '#f1f5f9' } },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#e2e8f0' },
        timeScale: { borderColor: '#e2e8f0', timeVisible: true }
    });

    candleSeries = lwChart.addCandlestickSeries({
        upColor: '#10b981', downColor: '#f43f5e', borderVisible: false,
        wickUpColor: '#10b981', wickDownColor: '#f43f5e'
    });

    maSeries = lwChart.addLineSeries({ color: '#6366f1', lineWidth: 2, visible: isMAActive });
    trendlineSeries = lwChart.addLineSeries({ color: '#8b5cf6', lineWidth: 2, lineStyle: 1, visible: isTLActive });

    generateChartData();
    
    new ResizeObserver(entries => {
        if (entries.length === 0 || entries[0].target !== container) return;
        const newRect = entries[0].contentRect;
        if(newRect.width > 0 && newRect.height > 0) {
            lwChart.applyOptions({ width: newRect.width, height: newRect.height });
        }
    }).observe(container);
}

function generateChartData() {
    const basePrice = window.livePrices[chartSymbol] || 22000;
    chartCandles = [];
    let maData = [];
    
    let time = Math.floor(Date.now() / 1000) - (150 * parseInt(chartTF) * 60); 
    let currentOpen = basePrice * 0.98; 
    const volatility = basePrice * 0.0015;
    
    for(let i=0; i<150; i++) {
        let close = currentOpen + (Math.random() - 0.45) * volatility; 
        let high = Math.max(currentOpen, close) + Math.random() * (volatility * 0.5);
        let low = Math.min(currentOpen, close) - Math.random() * (volatility * 0.5);
        if (i === 149) close = basePrice; 

        chartCandles.push({ time: time, open: currentOpen, high: high, low: low, close: close });
        
        if (i >= 14) {
            let sum = 0;
            for(let j=0; j<14; j++) sum += chartCandles[i-j].close;
            maData.push({ time: time, value: sum/14 });
        }
        currentOpen = close;
        time += parseInt(chartTF) * 60;
    }
    
    candleSeries.setData(chartCandles);
    maSeries.setData(maData);
    
    updateSRLines();
    updateTrendlines();
}

function updateSRLines() {
    srLines.forEach(line => candleSeries.removePriceLine(line));
    srLines = [];
    if (!isSRActive) return;
    
    let high = Math.max(...chartCandles.map(c => c.high));
    let low = Math.min(...chartCandles.map(c => c.low));
    let close = chartCandles[chartCandles.length-1].close;
    
    let pivot = (high + low + close) / 3;
    let r1 = (2 * pivot) - low;
    let s1 = (2 * pivot) - high;

    const lines = [
        { price: r1, color: '#f43f5e', title: 'Resistance 1' },
        { price: pivot, color: '#64748b', title: 'Pivot Point' },
        { price: s1, color: '#10b981', title: 'Support 1' }
    ];
    
    lines.forEach(l => {
        srLines.push(candleSeries.createPriceLine({
            price: l.price, color: l.color, lineWidth: 2, lineStyle: 2,
            axisLabelVisible: true, title: l.title,
        }));
    });
}

function updateTrendlines() {
    if (!isTLActive) { trendlineSeries.setData([]); return; }
    
    let tlData = [];
    let isUp = true;
    tlData.push({ time: chartCandles[0].time, value: chartCandles[0].low });
    
    for(let i=10; i<chartCandles.length - 10; i+=15) {
        let extreme = isUp ? Math.max(...chartCandles.slice(i-5, i+5).map(c=>c.high)) : Math.min(...chartCandles.slice(i-5, i+5).map(c=>c.low));
        let targetCandle = chartCandles.slice(i-5, i+5).find(c => c.high === extreme || c.low === extreme);
        if(targetCandle) tlData.push({ time: targetCandle.time, value: extreme });
        isUp = !isUp;
    }
    tlData.push({ time: chartCandles[chartCandles.length-1].time, value: chartCandles[chartCandles.length-1].close });
    trendlineSeries.setData(tlData);
}

window.reloadChart = function() { chartSymbol = document.getElementById('chart-symbol').value; generateChartData(); }
window.setChartTF = function(tf, element) { chartTF = tf; document.querySelectorAll('.tf-segment').forEach(el => el.classList.remove('active')); element.classList.add('active'); generateChartData(); }

window.toggleIndicator = function(type) {
    if (type === 'MA') {
        isMAActive = !isMAActive;
        document.getElementById('toggle-ma').innerText = isMAActive ? 'Moving Average (On)' : 'Moving Average (Off)';
        document.getElementById('toggle-ma').classList.toggle('active');
        maSeries.applyOptions({ visible: isMAActive });
    } 
    if (type === 'SR') {
        isSRActive = !isSRActive;
        document.getElementById('toggle-sr').innerText = isSRActive ? 'Auto S/R (On)' : 'Auto S/R (Off)';
        document.getElementById('toggle-sr').classList.toggle('active');
        updateSRLines();
    }
    if (type === 'TL') {
        isTLActive = !isTLActive;
        document.getElementById('toggle-tl').innerText = isTLActive ? 'Auto Trendlines (On)' : 'Auto Trendlines (Off)';
        document.getElementById('toggle-tl').classList.toggle('active');
        updateTrendlines();
    }
}

const scanningPhrases = ["Connecting to Data Feeds...", "Analyzing Volume Profiles...", "Calculating Moving Averages...", "Scanning Sector Momentum...", "Processing Algorithms...", "Finalizing Trades..."];

document.getElementById('refresh-screener-btn').addEventListener('click', async function() {
    if(isScanning) return; 
    isScanning = true;
    const tbody = document.getElementById('stocks-table-body');
    let phraseIdx = 0;
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center;"><div class="scanner-box"><div class="radar-spinner"></div><div id="scan-text" class="scan-text">${scanningPhrases[0]}</div></div></td></tr>`;
    
    const interval = setInterval(() => {
        phraseIdx++;
        if(phraseIdx < scanningPhrases.length) document.getElementById('scan-text').innerText = scanningPhrases[phraseIdx];
    }, 1000);
    
    try {
        let response = await fetch('/api/screener_data');
        let data = await response.json();
        setTimeout(() => { clearInterval(interval); isScanning = false; renderStockTable(data); }, 6000);
    } catch(e) {
        setTimeout(() => { clearInterval(interval); isScanning = false; renderStockTable(latestStockData); }, 6000);
    }
});

function renderStockTable(stocks) {
    const tbody = document.getElementById('stocks-table-body');
    if (!tbody || stocks.length === 0) return;
    tbody.innerHTML = '';
    stocks.forEach((stock, index) => {
        const actionClass = stock.action === 'BUY' ? 'action-buy' : 'action-sell';
        const gainColor = parseFloat(stock.gain) > 0 ? '#10b981' : '#64748b'; 
        tbody.innerHTML += `
            <tr onclick="openStockModal(${index})">
                <td><div class="stock-symbol">${stock.symbol}</div><div class="stock-type">${stock.type}</div></td>
                <td><span class="${actionClass}">${stock.action}</span></td>
                <td><div class="price-data">₹${stock.cmp.toFixed(2)}</div><div class="entry-zone">Zone: ₹${stock.entry}</div></td>
                <td class="sl-data">₹${stock.sl}</td>
                <td><div class="target-data">T1: ₹${stock.t1}</div><div class="target-data" style="color:#059669; font-size:12px; margin-top:4px;">T2: ₹${stock.t2}</div></td>
                <td><span class="horizon-badge">${stock.horizon}</span></td>
                <td class="gain-data" style="color: ${gainColor}">+${stock.gain}%</td>
            </tr>`;
    });
}

window.openStockModal = function(index) {
    const stock = latestStockData[index];
    if(!stock) return;
    document.getElementById('modal-title').innerText = stock.full_name;
    document.getElementById('modal-subtitle').innerText = `${stock.symbol}  •  ${stock.sector}  •  ${stock.type}`;
    const badge = document.getElementById('modal-action-badge');
    badge.innerText = stock.action;
    badge.className = stock.action === 'BUY' ? 'action-buy' : 'action-sell';
    document.getElementById('modal-cmp').innerText = `₹${stock.cmp.toFixed(2)}`;
    document.getElementById('modal-entry').innerText = `₹${stock.entry}`;
    document.getElementById('modal-sl').innerText = `₹${stock.sl}`;
    document.getElementById('modal-t1').innerText = `₹${stock.t1}`;
    document.getElementById('modal-horizon').innerText = `Horizon: ${stock.horizon}`;
    document.getElementById('modal-confidence').innerText = stock.confidence;
    document.getElementById('modal-reason').innerText = stock.detailed_reason;
    document.getElementById('modal-gain').innerText = `+${stock.gain}%`;
    const riskEl = document.getElementById('modal-risk');
    riskEl.innerText = `${stock.risk} Risk`;
    riskEl.className = `risk-badge ${stock.risk === 'Low' ? 'risk-low' : (stock.risk === 'Med' ? 'risk-med' : 'risk-high')}`;

    document.getElementById('vis-sl-label').innerText = `SL: ₹${stock.sl}`;
    document.getElementById('vis-target-label').innerText = `Target: ₹${stock.t1}`;
    const riskBox = document.getElementById('vis-risk');
    const marker = document.getElementById('vis-marker');
    let riskPct = Math.max(10, Math.min(((Math.abs(stock.cmp - stock.sl)) / (Math.abs(stock.t1 - stock.sl) || 1)) * 100, 90)); 
    riskBox.style.width = `${riskPct}%`;
    riskBox.style.background = '#fca5a5'; 
    document.getElementById('vis-reward').style.background = '#6ee7b7';
    marker.style.left = `calc(${riskPct}% - 3px)`;
    document.getElementById('stock-modal').classList.add('active');
}
window.closeStockModal = function() { document.getElementById('stock-modal').classList.remove('active'); }
window.onclick = function(event) { if (event.target === document.getElementById('stock-modal')) closeStockModal(); }

// DASHBOARD
function updateDashboardCard(cardId, prefix, info) {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.querySelector('.price').innerText = info.price.toLocaleString('en-IN');
    const pct = document.getElementById(`${prefix}-pct`);
    if (pct) { pct.innerText = (info.change >= 0 ? '+' : '') + info.change + "%"; pct.className = `badge ${info.change >= 0 ? 'badge-up' : 'badge-down'}`; }
    const pcrEl = document.getElementById(`${prefix}-pcr`);
    if (pcrEl && info.pcr) pcrEl.innerText = info.pcr;
}
function renderDashboardSectors(heatmapData) {
    const grid = document.getElementById('sector-grid');
    if (!grid || heatmapData.length === 0) return;
    grid.innerHTML = '';
    heatmapData.slice(0, 8).forEach(s => {
        const isUp = s.change >= 0;
        grid.innerHTML += `<div class="s-box"><div style="font-size: 11px; color: #64748b; font-weight:600">${s.name}</div><div style="font-size: 16px; font-weight: 800; color: ${isUp ? '#10b981' : '#f43f5e'}">${isUp ? '+' : ''}${s.change}%</div></div>`;
    });
}
function updateOptionRecommendation(cardId, symbol, info, strikeStep) {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.querySelector('.spot-price').innerText = info.price.toLocaleString('en-IN');
    const atmStrike = Math.round(info.price / strikeStep) * strikeStep;
    const badge = card.querySelector('.trade-badge');
    const targetEl = card.querySelector('.target-strike');
    if (info.pcr > 1.05 && info.change > 0) {
        card.className = "premium-card trade-card buy-call"; badge.className = "trade-badge badge-call"; badge.innerText = "BULLISH BREAKOUT"; targetEl.innerText = `BUY ${symbol} ${atmStrike} CE`;
    } else if (info.pcr < 0.95 && info.change < 0) {
        card.className = "premium-card trade-card buy-put"; badge.className = "trade-badge badge-put"; badge.innerText = "BEARISH BREAKDOWN"; targetEl.innerText = `BUY ${symbol} ${atmStrike} PE`;
    } else {
        card.className = "premium-card trade-card"; badge.className = "trade-badge wait"; badge.innerText = "NEUTRAL / CHOPPY"; targetEl.innerText = `WAIT FOR SETUP`;
    }
}
window.filterHeatmap = function(category, element) {
    currentFilter = category;
    document.querySelectorAll('.segment[data-filter]').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    updateSliderBackground('slider-bg', element);
    renderAdvancedHeatmap();
}
function renderAdvancedHeatmap() {
    const grid = document.getElementById('adv-heatmap-grid');
    if (!grid || latestHeatmapData.length === 0) return;
    grid.innerHTML = '';
    let filteredData = currentFilter !== 'All' ? latestHeatmapData.filter(d => d.group === currentFilter) : latestHeatmapData;
    filteredData.forEach(s => {
        const isUp = s.change >= 0;
        const colorBase = isUp ? '16, 185, 129' : '244, 63, 94'; 
        const intensity = Math.min(Math.abs(s.change) / 2, 1);
        grid.innerHTML += `<div class="adv-card" style="background: rgba(${colorBase}, ${0.05 + intensity*0.15}); border-color: rgba(${colorBase}, ${0.2 + intensity*0.5});"><div class="adv-name">${s.name}</div><div class="adv-pct" style="color: rgb(${colorBase})">${isUp ? '+' : ''}${s.change}%</div></div>`;
    });
}

// EXPIRY & OI LOGIC
window.switchOI = function(indexName, element) {
    currentOIIndex = indexName;
    document.querySelectorAll('#oi-slider .segment').forEach(el => el.classList.remove('active'));
    element.classList.add('active');
    updateSliderBackground('oi-slider-bg', element);
    updateExpiryDropdown();
    renderOITable();
}

window.changeExpiry = function() {
    currentExpiry = document.getElementById('expiry-select').value;
    renderOITable(true); 
}

function updateExpiryDropdown() {
    const select = document.getElementById('expiry-select');
    const expiries = Object.keys(latestOIData[currentOIIndex] || {});
    if (expiries.length === 0) return;
    select.innerHTML = '';
    let foundCurrent = false;
    expiries.forEach(exp => {
        const opt = document.createElement('option');
        opt.value = exp; opt.innerText = exp;
        select.appendChild(opt);
        if (exp === currentExpiry) foundCurrent = true;
    });
    if (!foundCurrent) currentExpiry = expiries[0];
    select.value = currentExpiry;
}

function updateSliderBackground(bgId, activeElement) {
    if(!activeElement) return;
    const bg = document.getElementById(bgId);
    bg.style.width = activeElement.offsetWidth + 'px';
    bg.style.transform = `translateX(${activeElement.offsetLeft - 4}px)`;
}

window.addEventListener('load', () => {
    setTimeout(() => {
        updateSliderBackground('slider-bg', document.querySelector('.segment[data-filter].active'));
        updateSliderBackground('oi-slider-bg', document.querySelector('.segment[data-index].active'));
    }, 100);
});

window.toggleDeepInsights = function() {
    const panel = document.getElementById('deep-insight-panel');
    panel.classList.toggle('active');
}

function renderOITable(forceRebuild = false) {
    const tbody = document.getElementById('oi-table-body');
    if (!tbody) return;

    const data = (latestOIData[currentOIIndex] || {})[currentExpiry] || [];
    if (data.length === 0) return;

    const existingRows = tbody.querySelectorAll('.oi-data-row');
    const strikesMatch = existingRows.length === data.length && (existingRows.length > 0 && parseInt(existingRows[0].getAttribute('data-strike')) === data[0].strike);

    if (!strikesMatch || forceRebuild) {
        let html = '';
        data.forEach(row => {
            html += `
                <div class="oi-data-row ${row.is_atm ? 'is-atm' : ''}" data-strike="${row.strike}">
                    <div class="oi-bar-container left"><div class="oi-val left" id="ce-val-${row.strike}">0</div><div class="oi-bar ce" id="ce-bar-${row.strike}" style="width: 0%"></div></div>
                    <div class="oi-ltp-col" id="ce-ltp-${row.strike}">₹0.0</div>
                    <div class="oi-strike-col">${row.strike}</div>
                    <div class="oi-pcr-col" id="pcr-${row.strike}">0.00</div>
                    <div class="oi-ltp-col" id="pe-ltp-${row.strike}">₹0.0</div>
                    <div class="oi-bar-container right"><div class="oi-bar pe" id="pe-bar-${row.strike}" style="width: 0%"></div><div class="oi-val right" id="pe-val-${row.strike}">0</div></div>
                </div>`;
        });
        tbody.innerHTML = html;
        void tbody.offsetWidth; 
    }

    let maxOI = 0, totalCE = 0, totalPE = 0, maxCEStrike = { strike: 0, oi: 0 }, maxPEStrike = { strike: 0, oi: 0 }, highestPCR = { strike: 0, val: 0 }, maxPainScore = 0, maxPainStrike = 0;
    data.forEach(row => {
        if(row.ce_oi > maxOI) maxOI = row.ce_oi;
        if(row.pe_oi > maxOI) maxOI = row.pe_oi;
        totalCE += row.ce_oi; totalPE += row.pe_oi;
        if (row.ce_oi > maxCEStrike.oi) maxCEStrike = { strike: row.strike, oi: row.ce_oi };
        if (row.pe_oi > maxPEStrike.oi) maxPEStrike = { strike: row.strike, oi: row.pe_oi };
        let strikePcrVal = row.ce_oi === 0 ? 0 : (row.pe_oi / row.ce_oi);
        if (strikePcrVal > highestPCR.val && row.pe_oi > 50000) highestPCR = { strike: row.strike, val: strikePcrVal };
        let painScore = row.ce_oi + row.pe_oi;
        if (painScore > maxPainScore) { maxPainScore = painScore; maxPainStrike = row.strike; }
    });

    const formatOI = (num) => {
        if (num >= 100000) return (num / 100000).toFixed(1) + ' L';
        if (num >= 1000) return (num / 1000).toFixed(1) + ' K';
        return num;
    };

    data.forEach(row => {
        const ceWidth = maxOI === 0 ? 0 : (row.ce_oi / maxOI) * 100;
        const peWidth = maxOI === 0 ? 0 : (row.pe_oi / maxOI) * 100;
        const strikePcr = row.ce_oi === 0 ? 0.00 : (row.pe_oi / row.ce_oi).toFixed(2);

        document.getElementById(`ce-bar-${row.strike}`).style.width = `${ceWidth}%`;
        document.getElementById(`ce-val-${row.strike}`).innerText = formatOI(row.ce_oi);
        document.getElementById(`ce-ltp-${row.strike}`).innerText = `₹${row.ce_ltp.toFixed(1)}`;
        document.getElementById(`pe-bar-${row.strike}`).style.width = `${peWidth}%`;
        document.getElementById(`pe-val-${row.strike}`).innerText = formatOI(row.pe_oi);
        document.getElementById(`pe-ltp-${row.strike}`).innerText = `₹${row.pe_ltp.toFixed(1)}`;
        const pcrEl = document.getElementById(`pcr-${row.strike}`);
        pcrEl.innerText = strikePcr;
        pcrEl.style.color = strikePcr > 1.2 ? '#10b981' : (strikePcr < 0.8 ? '#f43f5e' : '#64748b');
    });

    const pcr = totalCE === 0 ? 1 : (totalPE / totalCE);
    document.getElementById('conc-support').innerText = maxPEStrike.strike || "--";
    document.getElementById('conc-resistance').innerText = maxCEStrike.strike || "--";
    
    let trendEl = document.getElementById('conc-trend');
    if (pcr >= 1.1) {
        trendEl.innerText = "Bullish"; trendEl.style.color = "#10b981";
        document.getElementById('oi-summary-text').innerHTML = `The data shows a Bullish trend. <b>Put writers (Bulls)</b> are aggressively adding positions compared to Call writers. This provides a very strong support cushion at the <b>${maxPEStrike.strike}</b> level, meaning the market is highly likely to stay stable or move upwards.`;
    } else if (pcr <= 0.85) {
        trendEl.innerText = "Bearish"; trendEl.style.color = "#f43f5e";
        document.getElementById('oi-summary-text').innerHTML = `The data shows a Bearish trend. <b>Call writers (Bears)</b> are dominating the market right now. They have created heavy resistance around the <b>${maxCEStrike.strike}</b> level, making it difficult for the market to move upwards. Traders should be cautious of sudden drops.`;
    } else {
        trendEl.innerText = "Neutral / Sideways"; trendEl.style.color = "#64748b";
        document.getElementById('oi-summary-text').innerHTML = `The market is currently <b>Neutral or Sideways</b>. Neither the buyers nor the sellers have clear control over the trend right now. The market is stuck in a range between Support (${maxPEStrike.strike}) and Resistance (${maxCEStrike.strike}). It is best to wait for a breakout.`;
    }

    document.getElementById('deep-max-pain').innerText = maxPainStrike;
    document.getElementById('deep-high-pcr').innerText = `${highestPCR.strike} (Ratio: ${highestPCR.val.toFixed(2)})`;
}

function renderFiiDiiTable(data) {
    const tbody = document.getElementById('fiidii-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    data.forEach(row => {
        const netVal = parseFloat(row.netValue || 0);
        const netClass = netVal >= 0 ? 'val-positive' : 'val-negative';
        tbody.innerHTML += `<tr><td><div style="font-weight:800; color:#1e293b;">${row.category}</div></td><td>${row.date}</td><td>₹ ${row.buyValue}</td><td>₹ ${row.sellValue}</td><td class="${netClass}">${netVal >= 0 ? '+' : ''}₹ ${netVal}</td></tr>`;
    });
}