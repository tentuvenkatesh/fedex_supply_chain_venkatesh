from flask import Flask, jsonify, request, render_template, send_file, make_response
from flask_cors import CORS
import pandas as pd
import numpy as np
import random, math, datetime, io, csv

app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)

def get_region(country):
    regions = {
        "United States":"North America","Canada":"North America","Mexico":"North America",
        "United Kingdom":"Europe","France":"Europe","Germany":"Europe","Spain":"Europe","Italy":"Europe",
        "Brazil":"South America","Australia":"Oceania","Japan":"Asia","South Korea":"Asia","India":"Asia","China":"Asia"
    }
    return regions.get(country,"Other")

def generate_synthetic_data(n=10000, seed=42):
    random.seed(seed); np.random.seed(seed)
    countries = ["United States","United Kingdom","France","Germany","Spain","Italy","Brazil","Mexico","Canada","Australia","Japan","South Korea","India","China"]
    categories = ["Technology","Furniture","Office Supplies","Clothing","Sports","Health & Beauty","Books","Automotive","Home & Garden","Electronics"]
    shipping_modes = ["Standard Class","First Class","Second Class","Same Day"]
    suppliers = ["Supplier A","Supplier B","Supplier C","Supplier D","Supplier E"]
    customer_segments = ["Consumer","Corporate","Home Office"]

    start_dt = datetime.datetime(2020,1,1)
    end_dt = datetime.datetime(2024,12,31)
    rows = []
    for _ in range(n):
        rand_ts = start_dt + datetime.timedelta(seconds=random.uniform(0, (end_dt - start_dt).total_seconds()))
        month = rand_ts.month
        country = random.choice(countries)
        shipping_mode = random.choice(shipping_modes)

        # shipping mode influences delay probability
        delay_prob = 0.15
        if shipping_mode == "Same Day": delay_prob = 0.05
        elif shipping_mode == "First Class": delay_prob = 0.08
        elif shipping_mode == "Second Class": delay_prob = 0.12
        elif shipping_mode == "Standard Class": delay_prob = 0.25

        if month in (12,1): delay_prob *= 1.5

        late_risk = 1 if random.random() < delay_prob else 0

        if late_risk == 1:
            delivery_status = "Late delivery" if random.random() < 0.8 else "Shipping canceled"
        else:
            r = random.random()
            delivery_status = "Shipping on time" if r < 0.7 else ("Advance shipping" if r < 0.85 else "Shipping canceled")

        if delivery_status == "Late delivery":
            shipping_delay_days = max(1, int(random.random()*15 + 1))
        elif delivery_status == "Advance shipping":
            shipping_delay_days = -int(random.random()*3 + 1)
        else:
            shipping_delay_days = 0

        base_profit_range = (50, 500)
        if delivery_status == "Late delivery":
            base_profit_range = (10, 200)
        elif delivery_status == "Advance shipping":
            base_profit_range = (100, 600)
        elif delivery_status == "Shipping canceled":
            base_profit_range = (-100, 50)

        order_profit = int(random.uniform(base_profit_range[0], base_profit_range[1]))
        benefit = int(order_profit * (0.8 + random.random()*0.4))
        rows.append({
            "date_orders": rand_ts.strftime("%Y-%m-%d"),
            "late_delivery_risk": late_risk,
            "delivery_status": delivery_status,
            "order_profit_per_order": order_profit,
            "benefit_per_order": benefit,
            "shipping_delay_days": shipping_delay_days,
            "customer_country": country,
            "category_name": random.choice(categories),
            "shipping_mode": shipping_mode,
            "region": get_region(country),
            "supplier_name": random.choice(suppliers),
            "customer_segment": random.choice(customer_segments),
            "order_status": "CANCELED" if delivery_status == "Shipping canceled" else "COMPLETE"
        })
    df = pd.DataFrame(rows)
    df.sort_values("date_orders", inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df

# build dataset once (memory-friendly for demo; replace with on-demand generation for huge data)
DATA_DF = generate_synthetic_data(10000)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/data", methods=["GET"])
def api_data():
    # return lightweight subset for initial load (if needed change)
    return jsonify(DATA_DF.to_dict(orient="records"))

def apply_filters(df, filters):
    d = df.copy()
    start = filters.get("startDate")
    end = filters.get("endDate")
    if start:
        d = d[d["date_orders"] >= start]
    if end:
        d = d[d["date_orders"] <= end]
    deliveryStatus = filters.get("deliveryStatus")
    if deliveryStatus:
        d = d[d["delivery_status"].isin(deliveryStatus)]
    late = filters.get("lateDeliveryRisk")
    if late in (0,1,"0","1"):
        d = d[d["late_delivery_risk"].astype(int) == int(late)]
    shippingMode = filters.get("shippingMode")
    if shippingMode:
        d = d[d["shipping_mode"].isin(shippingMode)]
    countries = filters.get("customerCountry")
    if countries:
        d = d[d["customer_country"].isin(countries)]
    categories = filters.get("category")
    if categories:
        d = d[d["category_name"].isin(categories)]
    return d

@app.route("/api/filter", methods=["POST"])
def api_filter():
    filters = request.json or {}
    filtered = apply_filters(DATA_DF, filters)
    total = int(filtered.shape[0])
    late = int((filtered["late_delivery_risk"]==1).sum()) if total>0 else 0
    late_pct = round(late/total*100,1) if total>0 else 0
    avg_delay = round(float(filtered["shipping_delay_days"].mean()),1) if total>0 else 0
    avg_profit = int(filtered["order_profit_per_order"].mean()) if total>0 else 0

    # monthly aggregates
    if total>0:
        monthly = filtered.copy()
        monthly["month"] = pd.to_datetime(monthly["date_orders"]).dt.to_period("M").astype(str)
        monthly_group = monthly.groupby("month")["shipping_delay_days"].mean().reindex().sort_index()
        labels = monthly_group.index.tolist()
        avg_delays = monthly_group.fillna(0).tolist()
    else:
        labels, avg_delays = [], []

    country_group = filtered.groupby("customer_country").agg(total=('late_delivery_risk','size'), late=('late_delivery_risk','sum'))
    countries = country_group.index.tolist()
    risk_percent = ((country_group['late'] / country_group['total'] * 100).fillna(0).tolist()) if len(countries)>0 else []

    interarrival = compute_interarrival(filtered)

    resp = {
        "filtered_records": filtered.to_dict(orient="records"),
        "kpis": {"total_orders": total, "late_delivery_percent": late_pct, "avg_shipping_delay": avg_delay, "avg_profit": avg_profit},
        "aggregates": {"monthly_labels": labels, "avg_delays": avg_delays},
        "country_risk": {"countries": countries, "risk_percentages": risk_percent},
        "inter_arrival_times": interarrival
    }
    return jsonify(resp)

def compute_interarrival(df):
    if df.shape[0] < 2:
        return []
    dates = pd.to_datetime(df["date_orders"]).sort_values()
    diffs = dates.diff().dropna().dt.days
    res = diffs[diffs>0].astype(int).tolist()
    return res

@app.route("/api/simulate", methods=["POST"])
def api_simulate():
    payload = request.json or {}
    num_sim = int(payload.get("numSimulations", 1000))
    horizon = int(payload.get("timeHorizon", 365))
    distribution = payload.get("distribution", "weibull")
    inter = payload.get("inter_arrival_times") or compute_interarrival(DATA_DF)
    if not inter:
        return jsonify({"error":"no interarrival data for fitting"}), 400
    inter = np.array(inter, dtype=float)
    mean = inter.mean()
    var = inter.var()
    cv = math.sqrt(var) / mean if mean>0 else 1.0
    # fit shape via heuristic (mirrors the JS approach)
    shape = max(0.1, cv ** -1.086)
    scale = mean / math.gamma(1 + 1.0/shape) if shape>0 else mean

    # estimate avg cost per disruption (coarse)
    late_df = DATA_DF[DATA_DF["late_delivery_risk"]==1]
    avg_cost = float(abs(late_df["order_profit_per_order"].apply(lambda x: min(0,x)).mean())) if not late_df.empty else 150.0
    if np.isnan(avg_cost): avg_cost = 150.0

    total_costs = []
    disruptions_list = []
    for _ in range(num_sim):
        t = 0.0
        disruptions = 0
        total_cost = 0.0
        while t < horizon:
            u = random.random()
            if distribution == "weibull":
                inter_t = scale * ((-math.log(1-u)) ** (1.0/shape))
            else:
                rate = 1.0/mean if mean>0 else 0.01
                inter_t = -math.log(1-u) / rate
            t += inter_t
            if t <= horizon:
                disruptions += 1
                # cost per disruption randomised a bit
                total_cost += avg_cost * (0.5 + random.random()*1.5)
        disruptions_list.append(disruptions)
        total_costs.append(total_cost)

    arr = np.array(total_costs)
    out = {
        "disruptionCounts": disruptions_list,
        "totalCosts": total_costs,
        "stats": {
            "meanDisruptions": float(np.mean(disruptions_list)),
            "stdDisruptions": float(np.std(disruptions_list)),
            "meanTotalCost": float(arr.mean()),
            "var95": float(np.quantile(arr,0.95)),
            "var99": float(np.quantile(arr,0.99)),
            "maxCost": float(arr.max())
        }
    }
    return jsonify(out)

@app.route("/download/data.csv", methods=["POST","GET"])
def download_data():
    # Accept optional filters in POST body
    if request.method == "POST":
        filters = request.json or {}
        df = apply_filters(DATA_DF, filters)
    else:
        df = DATA_DF
    stream = io.StringIO()
    df.to_csv(stream, index=False)
    mem = io.BytesIO()
    mem.write(stream.getvalue().encode("utf-8"))
    mem.seek(0)
    return send_file(mem, mimetype="text/csv", as_attachment=True, download_name="filtered_data.csv")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)