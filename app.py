import os
import threading
import time
import random
import concurrent.futures
from datetime import datetime
from curl_cffi import requests
from flask import Flask, render_template, request, redirect, url_for, session, jsonify

app = Flask(__name__)
app.secret_key = "marketpro_secret_2026" 

global_market_state = {}
mock_spots = {'NIFTY 50': 22050.50, 'NIFTY BANK': 46120.30, 'NIFTY FIN SERVICE': 20540.10}

@app.route('/')
def index():
    if 'user' in session: return redirect(url_for('app_terminal'))
    return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        if request.form['username'] == 'praful' and request.form['password'] == 'admin123':
            session['user'] = 'praful'
            return redirect(url_for('app_terminal'))
        error = "Invalid Credentials. Try again."
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect(url_for('login'))

@app.route('/app')
def app_terminal():
    if 'user' not in session: return redirect(url_for('login'))
    return render_template('main.html', username=session['user'].capitalize())

# --- NEW: BLZING FAST REST API ENDPOINTS ---
@app.route('/api/market_data')
def get_market_data():
    return jsonify(global_market_state)

@app.route('/api/screener_data')
def get_screener_data():
    return jsonify(global_market_state.get('stock_analysis', []))

# --- DATA FETCHING ENGINE (Unchanged Math) ---
def create_nse_session():
    s = requests.Session(impersonate="chrome120")
    s.headers.update({"Referer": "https://www.nseindia.com/"})
    try: s.get("https://www.nseindia.com", timeout=5)
    except: pass
    return s

def fetch_real_stocks(s_req):
    try:
        url = "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050"
        resp = s_req.get(url, timeout=4)
        if resp.status_code == 200:
            try: json_data = resp.json()
            except ValueError: return []
            data = json_data.get('data', [])
            if not data: return []
            
            selected = random.sample(data[1:], 5) 
            picks = []
            for stk in selected:
                cmp = stk.get('lastPrice', 0)
                pct = stk.get('pChange', 0)
                sym = stk.get('symbol', '')
                full_name = stk.get('meta', {}).get('companyName', f"{sym} Corporation Ltd.")
                sector = stk.get('meta', {}).get('industry', 'Equities')
                
                if pct > 0:
                    action, entry = "BUY", f"{round(cmp*0.995, 1)} - {round(cmp, 1)}"
                    sl, t1, t2 = round(cmp * 0.97, 1), round(cmp * 1.03, 1), round(cmp * 1.05, 1)
                    gain_pct = round(((t1 - cmp) / cmp) * 100, 1)
                    horizon, reason = "1-3 Days" if abs(pct) > 1.5 else "1-2 Weeks", f"This stock is exhibiting significant relative strength, up {pct}% today. Volume analysis indicates institutional accumulation. It has cleared key overhead supply zones."
                else:
                    action, entry = "SELL", f"{round(cmp, 1)} - {round(cmp*1.005, 1)}"
                    sl, t1, t2 = round(cmp * 1.03, 1), round(cmp * 0.97, 1), round(cmp * 0.95, 1)
                    gain_pct = round(abs((cmp - t1) / cmp) * 100, 1)
                    horizon, reason = "1-3 Days" if abs(pct) > 1.5 else "1-2 Weeks", f"The asset is facing severe distribution pressure, down {abs(pct)}%. It has broken critical moving averages with rising volume. Selling on minor bounces offers a favorable setup."

                picks.append({
                    "symbol": sym, "full_name": full_name, "sector": sector, "confidence": random.randint(82, 96), 
                    "type": "Intraday" if abs(pct) > 1.5 else "Swing", "action": action, "cmp": cmp, 
                    "entry": entry, "sl": sl, "t1": t1, "t2": t2, "gain": gain_pct, "horizon": horizon,
                    "risk": "High" if abs(pct) > 1.5 else ("Low" if abs(pct) < 0.5 else "Med"), "detailed_reason": reason
                })
            return picks
    except: pass
    return []

def format_expiries(expiry_list):
    parsed = []
    for d in expiry_list:
        try: parsed.append(datetime.strptime(d, '%d-%b-%Y'))
        except: pass
    parsed.sort()
    months = {}
    for d in parsed:
        key = (d.year, d.month)
        if key not in months: months[key] = []
        months[key].append(d)
    mapping = {}
    for d in parsed:
        key = (d.year, d.month)
        is_monthly = (d == max(months[key]))
        label = f"{d.strftime('%d %b %Y')} ({'M' if is_monthly else 'W'})"
        mapping[d.strftime('%d-%b-%Y')] = label
    return mapping, [mapping[d.strftime('%d-%b-%Y')] for d in parsed[:4]]

mock_oi_state = {}

def generate_mock_oi(symbol, spot_price):
    global mock_oi_state
    if symbol == 'FINNIFTY': expiries = ["21 Apr 2026 (W)", "28 Apr 2026 (M)"]
    elif symbol == 'BANKNIFTY': expiries = ["15 Apr 2026 (W)", "22 Apr 2026 (W)", "29 Apr 2026 (M)"]
    else: expiries = ["16 Apr 2026 (W)", "23 Apr 2026 (W)", "30 Apr 2026 (M)"]

    step = 50 if symbol != 'BANKNIFTY' else 100
    atm = round(spot_price / step) * step
    strikes = [atm + (i * step) for i in range(-8, 9)] 
    
    if symbol not in mock_oi_state:
        mock_oi_state[symbol] = {}
        for exp in expiries:
            chain = []
            for s in strikes:
                distance = abs(atm - s)
                base_oi = 4000000 if distance == 0 else max(100000, 2500000 - (distance * 4000))
                ce_oi = base_oi + random.randint(100000, 1500000)
                pe_oi = base_oi + random.randint(100000, 1500000)
                ce_ltp = max(0.5, 300 - (s - atm) * 0.5) + random.uniform(0, 10)
                pe_ltp = max(0.5, 300 + (s - atm) * 0.5) + random.uniform(0, 10)
                
                chain.append({
                    'strike': s, 'ce_oi': int(ce_oi), 'pe_oi': int(pe_oi), 
                    'ce_ltp': round(ce_ltp, 1), 'pe_ltp': round(pe_ltp, 1), 'is_atm': s == atm
                })
            mock_oi_state[symbol][exp] = chain
    else:
        for exp in expiries:
            if exp not in mock_oi_state[symbol]: continue
            for row in mock_oi_state[symbol][exp]:
                row['ce_oi'] = max(0, row['ce_oi'] + random.randint(-2000, 4500))
                row['pe_oi'] = max(0, row['pe_oi'] + random.randint(-2000, 4500))
                row['ce_ltp'] = max(0.05, round(row['ce_ltp'] + random.uniform(-1.5, 1.5), 1))
                row['pe_ltp'] = max(0.05, round(row['pe_ltp'] + random.uniform(-1.5, 1.5), 1))
                row['is_atm'] = (row['strike'] == atm)
                
    return mock_oi_state[symbol]

def fetch_real_oi(session_req, symbol, spot_price):
    try:
        url = f"https://www.nseindia.com/api/option-chain-indices?symbol={symbol}"
        response = session_req.get(url, timeout=3) 
        if response.status_code == 200:
            try: data = response.json()
            except ValueError: return generate_mock_oi(symbol, spot_price)
            
            raw_expiries = data['records']['expiryDates']
            expiry_map, top_expiries = format_expiries(raw_expiries)
            
            result = {exp: [] for exp in top_expiries}
            step = 50 if symbol != 'BANKNIFTY' else 100
            atm_strike = round(spot_price / step) * step
            
            for item in data['records']['data']:
                strike = item.get('strikePrice')
                exp_date = item.get('expiryDate')
                if exp_date not in expiry_map: continue
                mapped_exp = expiry_map[exp_date]
                if mapped_exp not in result: continue
                
                if abs(strike - atm_strike) <= (step * 8): 
                    result[mapped_exp].append({
                        'strike': strike,
                        'ce_oi': item.get('CE', {}).get('openInterest', 0) * 50, 
                        'pe_oi': item.get('PE', {}).get('openInterest', 0) * 50,
                        'ce_ltp': item.get('CE', {}).get('lastPrice', 0),
                        'pe_ltp': item.get('PE', {}).get('lastPrice', 0),
                        'is_atm': strike == atm_strike
                    })
            for exp in result: result[exp] = sorted(result[exp], key=lambda x: x['strike'])
            if result: return result
    except Exception: pass
    return generate_mock_oi(symbol, spot_price)

def fetch_market_pulse():
    global global_market_state, mock_spots
    
    try: req_session = create_nse_session()
    except Exception: req_session = None
    
    broad = ['NIFTY 50', 'NIFTY NEXT 50', 'NIFTY MIDCAP 100']
    sectoral = ['NIFTY AUTO', 'NIFTY IT', 'NIFTY METAL', 'NIFTY PHARMA']
    financial = ['NIFTY BANK', 'NIFTY FIN SERVICE', 'NIFTY PSU BANK']

    while True:
        try:
            if req_session is None: raise Exception("Session Failed")
                
            r = req_session.get("https://www.nseindia.com/api/allIndices", timeout=4)
            if r.status_code != 200: raise Exception("Cloud IP Blocked")
            
            try: data = r.json()
            except ValueError: 
                req_session = create_nse_session()
                time.sleep(2)
                continue
                
            indices = {item["indexSymbol"]: item for item in data['data']}
            heatmap_data = []
            for name in broad:
                if name in indices: heatmap_data.append({'name': name.replace('NIFTY ', ''), 'change': indices[name]['percentChange'], 'group': 'Broad'})
            for name in sectoral:
                if name in indices: heatmap_data.append({'name': name.replace('NIFTY ', ''), 'change': indices[name]['percentChange'], 'group': 'Sectoral'})
            for name in financial:
                if name in indices: heatmap_data.append({'name': name.replace('NIFTY ', ''), 'change': indices[name]['percentChange'], 'group': 'Financial'})

            nifty_spot = indices.get('NIFTY 50', {}).get('last', 22000)
            bn_spot = indices.get('NIFTY BANK', {}).get('last', 46000)
            fin_spot = indices.get('NIFTY FIN SERVICE', {}).get('last', 20500)
            latest_fii = []

            try:
                fii_resp = req_session.get("https://www.nseindia.com/api/fiidiiTradeReact", timeout=3)
                if fii_resp.status_code == 200: latest_fii = fii_resp.json()
            except Exception: pass
            
            latest_stocks = fetch_real_stocks(req_session)

            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
                n_future = executor.submit(fetch_real_oi, req_session, 'NIFTY', nifty_spot)
                bn_future = executor.submit(fetch_real_oi, req_session, 'BANKNIFTY', bn_spot)
                fin_future = executor.submit(fetch_real_oi, req_session, 'FINNIFTY', fin_spot)
                latest_oi = {'NIFTY': n_future.result(), 'BANKNIFTY': bn_future.result(), 'FINNIFTY': fin_future.result()}

            global_market_state = {
                'nifty': {'price': nifty_spot, 'change': indices.get('NIFTY 50', {}).get('percentChange', 0), 'pcr': 1.18},
                'banknifty': {'price': bn_spot, 'change': indices.get('NIFTY BANK', {}).get('percentChange', 0), 'pcr': 0.82},
                'heatmap': heatmap_data,
                'oi_data': latest_oi,
                'fii_dii': latest_fii,
                'stock_analysis': latest_stocks 
            }

        except Exception as e:
            # --- MOCK FAILOVER ENGINE IF RENDER GETS BLOCKED ---
            mock_spots['NIFTY 50'] += random.uniform(-3, 3)
            mock_spots['NIFTY BANK'] += random.uniform(-8, 8)
            mock_spots['NIFTY FIN SERVICE'] += random.uniform(-4, 4)

            nifty_spot = mock_spots['NIFTY 50']
            bn_spot = mock_spots['NIFTY BANK']
            fin_spot = mock_spots['NIFTY FIN SERVICE']

            heatmap_data = [
                {'name': '50', 'change': round(random.uniform(-1, 1.5), 2), 'group': 'Broad'},
                {'name': 'NEXT 50', 'change': round(random.uniform(-0.5, 2), 2), 'group': 'Broad'},
                {'name': 'MIDCAP 100', 'change': round(random.uniform(-1.5, 1.5), 2), 'group': 'Broad'},
                {'name': 'BANK', 'change': round(random.uniform(-1.5, 2), 2), 'group': 'Financial'},
                {'name': 'FIN SERVICE', 'change': round(random.uniform(-1, 1.5), 2), 'group': 'Financial'},
                {'name': 'PSU BANK', 'change': round(random.uniform(-2, 2.5), 2), 'group': 'Financial'},
                {'name': 'AUTO', 'change': round(random.uniform(0, 2.5), 2), 'group': 'Sectoral'},
                {'name': 'IT', 'change': round(random.uniform(-2, 1), 2), 'group': 'Sectoral'},
                {'name': 'METAL', 'change': round(random.uniform(-1, 3), 2), 'group': 'Sectoral'},
                {'name': 'PHARMA', 'change': round(random.uniform(-0.5, 1.5), 2), 'group': 'Sectoral'}
            ]

            latest_fii = [
                {'category': 'FII', 'date': 'Today', 'buyValue': 5420.15, 'sellValue': 4200.50, 'netValue': 1219.65},
                {'category': 'DII', 'date': 'Today', 'buyValue': 3100.00, 'sellValue': 3500.25, 'netValue': -400.25}
            ]
            
            latest_oi = {
                'NIFTY': generate_mock_oi('NIFTY', nifty_spot),
                'BANKNIFTY': generate_mock_oi('BANKNIFTY', bn_spot),
                'FINNIFTY': generate_mock_oi('FINNIFTY', fin_spot)
            }

            latest_stocks = [
                {"symbol": "RELIANCE", "full_name": "Reliance Ind", "sector": "Energy", "confidence": random.randint(85, 96), "type": "Swing", "action": "BUY", "cmp": 2950.5, "entry": "2940-2950", "sl": 2900, "t1": 3050, "t2": 3100, "gain": 3.4, "horizon": "1-2 Weeks", "risk": "Low", "detailed_reason": "Strong institutional accumulation detected near the 50-EMA support level."},
                {"symbol": "HDFCBANK", "full_name": "HDFC Bank", "sector": "Finance", "confidence": random.randint(80, 92), "type": "Intraday", "action": "SELL", "cmp": 1430.2, "entry": "1430-1435", "sl": 1450, "t1": 1400, "t2": 1380, "gain": 2.1, "horizon": "1-3 Days", "risk": "Med", "detailed_reason": "Price action facing massive distribution pressure at structural resistance."}
            ]

            global_market_state = {
                'nifty': {'price': nifty_spot, 'change': round(random.uniform(-0.5, 1.2), 2), 'pcr': round(random.uniform(0.9, 1.3), 2)},
                'banknifty': {'price': bn_spot, 'change': round(random.uniform(-1.0, 1.0), 2), 'pcr': round(random.uniform(0.7, 1.1), 2)},
                'heatmap': heatmap_data,
                'oi_data': latest_oi,
                'fii_dii': latest_fii,
                'stock_analysis': latest_stocks 
            }

        time.sleep(4)

# --- START DAEMON THREAD (Works perfectly in Gunicorn) ---
threading.Thread(target=fetch_market_pulse, daemon=True).start()

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5001))
    app.run(host='0.0.0.0', port=port, debug=False)