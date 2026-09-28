import pandas as pd
import yfinance as yf
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
JOBS = [("XAUUSD_5M.csv","5m","60d"),("XAUUSD_15M.csv","15m","60d"),
        ("XAUUSD_30M.csv","30m","60d"),("XAUUSD_1H.csv","60m","730d"),
        ("XAUUSD_4H.csv","60m","730d")]
TICKER = "GC=F"

def read_last_date(path):
    if not path.exists(): return None
    last_line = None
    with open(path) as f:
        for last_line in f: pass
    if not last_line: return None
    raw = last_line.split(",")[0].strip().replace(".", "-")
    try: return pd.Timestamp(raw)
    except Exception: return None

def fetch(interval, period):
    df = yf.download(TICKER, interval=interval, period=period, progress=False)
    if df.empty:
        print(f"  no data for interval={interval} period={period}")
        return df
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[0] for c in df.columns]
    df = df.reset_index()
    time_col = "Datetime" if "Datetime" in df.columns else "Date"
    df = df.rename(columns={time_col: "Date"})
    df["Date"] = pd.to_datetime(df["Date"]).dt.strftime("%Y.%m.%d %H:%M")
    df["Volume"] = df.get("Volume", 0).fillna(0).astype(int)
    return df[["Date","Open","High","Low","Close","Volume"]]

def append_new_rows(csv_name, df):
    path = DATA_DIR / csv_name
    if df.empty or "Date" not in df.columns:
        print(f"{csv_name}: no new rows.")
        return
    last_date = read_last_date(path)
    if last_date is not None:
        df = df[pd.to_datetime(df["Date"], format="%Y.%m.%d %H:%M") > last_date]
    if df.empty:
        print(f"{csv_name}: no new rows.")
        return
    df.to_csv(path, mode="a", header=not path.exists(), index=False, float_format="%.2f")
    print(f"{csv_name}: appended {len(df)} rows, now up to {df['Date'].iloc[-1]}")

def main():
    base_1h = fetch("60m", "730d")
    for csv_name, interval, period in JOBS:
        if csv_name == "XAUUSD_4H.csv":
            if base_1h.empty:
                print(f"{csv_name}: no new rows.")
                continue
            tmp = base_1h.copy()
            tmp["Date"] = pd.to_datetime(tmp["Date"], format="%Y.%m.%d %H:%M")
            tmp = tmp.set_index("Date").resample("4h").agg(
                {"Open":"first","High":"max","Low":"min","Close":"last","Volume":"sum"}
            ).dropna().reset_index()
            tmp["Date"] = tmp["Date"].dt.strftime("%Y.%m.%d %H:%M")
            append_new_rows(csv_name, tmp)
        elif csv_name == "XAUUSD_1H.csv":
            append_new_rows(csv_name, base_1h)
        else:
            append_new_rows(csv_name, fetch(interval, period))

if __name__ == "__main__":
    main()
