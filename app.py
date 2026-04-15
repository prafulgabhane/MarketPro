import os
import threading
import time
import random
from datetime import datetime
import requests
from flask import Flask, render_template, request, redirect, url_for, session, jsonify

app = Flask(__name__)
app.secret_key = "marketpro_secret_2026" 

# Base anchor points for the market
mock_spots = {'NIFTY 50': 22050.50, 'NIFTY BANK': 46120.30, 'NIFTY FIN SERVICE': 20540.10}
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

def generate_live_mock_state():
    """Generates the flawlessly ticking simulated data package"""
    global mock_spots
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

    return {
        'nifty': {'price': nifty_spot, 'change': round(random.uniform(-0.5, 1.2), 2), 'pcr': round(random.uniform(0.9, 1.3), 2)},
        'banknifty': {'price': bn_spot, 'change': round(random.uniform(-1.0, 1.0), 2), 'pcr': round(random.uniform(0.7, 1.1), 2)},
        'heatmap': heatmap_data,
        'oi_data': latest_oi,
        'fii_dii': latest_fii,
        'stock_analysis': latest_stocks 
    }

# PRE-LOAD DATA SO THE UI NEVER HANGS
global_market_state = generate_live_mock_state()

# --- ROUTES ---
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

@app.route('/api/market_data')
def get_market_data():
    return jsonify(global_market_state)

@app.route('/api/screener_data')
def get_screener_data():
    return jsonify(global_market_state.get('stock_analysis', []))

# --- BACKGROUND ENGINE ---
def market_engine():
    """Runs safely in the background, updating the global state dict"""
    global global_market_state
    while True:
        try:
            # We skip the heavy NSE fetches on Render to prevent IP ban lockups.
            # Directly updates the global state with flawlessly ticking simulation data.
            global_market_state = generate_live_mock_state()
        except Exception as e:
            pass
        time.sleep(4)

# Start the background thread
threading.Thread(target=market_engine, daemon=True).start()

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5001))
    app.run(host='0.0.0.0', port=port, debug=False)