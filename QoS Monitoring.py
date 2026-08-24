#!/usr/bin/env python3

import csv
import json
import os
import platform
import re
import statistics
import subprocess
import time
from datetime import datetime
from pathlib import Path

import psutil
import requests


# =========================================================
# LOAD CONFIG
# =========================================================

# CONFIG_PATH = "/home/lokasight/qos_monitor/config_qos.json"
BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config_qos.json"

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    CONFIG = json.load(f)

GCP_API_URL = CONFIG["gcp_api_url"]
LOCAL_API_URL = CONFIG["local_api_url"]

PING_TARGET_ONLINE = CONFIG["ping_target_online"]
PING_TARGET_OFFLINE = CONFIG["ping_target_offline"]
THROUGHPUT_TEST_URL_ONLINE = CONFIG.get(
    "throughput_test_url_online",
    "https://speed.cloudflare.com/__down?bytes=1000000"
)
THROUGHPUT_TEST_URL_OFFLINE = CONFIG.get("throughput_test_url_offline")
THROUGHPUT_TEST_BYTES = CONFIG.get("throughput_test_bytes", 1000000)
DHT_FRESH_SECONDS = CONFIG.get("dht_fresh_seconds", 60)

MODE = CONFIG["mode"]
SOURCE = CONFIG["source"]

TOTAL_REQUESTS = CONFIG["total_requests"]
DELAY_BETWEEN_REQUESTS = CONFIG["delay_between_requests"]

def config_bool(name, default=False):
    value = CONFIG.get(name, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "y", "on")
    return bool(value)


RUN_FOREVER = config_bool("run_forever", True)
MAX_HISTORY_POINTS = CONFIG.get("max_history_points", 120)
FIREBASE_DATABASE_URL = str(CONFIG.get("firebase_database_url", "")).rstrip("/")
FIREBASE_AUTH_TOKEN = str(
    os.getenv("FIREBASE_AUTH_TOKEN") or CONFIG.get("firebase_auth_token") or ""
).strip()
FIREBASE_API_KEY = str(
    os.getenv("FIREBASE_API_KEY") or CONFIG.get("firebase_api_key") or ""
).strip()
FIREBASE_AUTH_EMAIL = str(
    os.getenv("FIREBASE_AUTH_EMAIL") or CONFIG.get("firebase_auth_email") or ""
).strip()
FIREBASE_AUTH_PASSWORD = str(
    os.getenv("FIREBASE_AUTH_PASSWORD") or CONFIG.get("firebase_auth_password") or ""
).strip()
FIREBASE_NOTIFICATIONS_ENABLED = config_bool("firebase_notifications_enabled", False)
FIREBASE_NOTIFICATIONS_PATH = str(CONFIG.get("firebase_notifications_path", "notifications")).strip("/")
NOTIFICATION_COOLDOWN_MINUTES = CONFIG.get("notification_cooldown_minutes", 60)
PI_HEARTBEAT_ENABLED = config_bool("pi_heartbeat_enabled", False)
PI_HEARTBEAT_PATH = str(CONFIG.get("pi_heartbeat_path", "system/raspberry_pi")).strip("/")
firebase_id_token = FIREBASE_AUTH_TOKEN
firebase_refresh_token = ""
firebase_token_expires_at = 0

def resolve_config_path(value):
    path = Path(value)
    return path if path.is_absolute() else BASE_DIR / path


def resolve_result_dir(value):
    if value in (None, "", "."):
        return BASE_DIR / "qos"

    return resolve_config_path(value)


RESULT_DIR = resolve_result_dir(CONFIG.get("result_dir", "qos"))
IMAGE_DIR = resolve_config_path(CONFIG["image_dir"])
DHT_STATUS_PATH = resolve_config_path(CONFIG.get("dht_status_path", str(RESULT_DIR / "dht_latest.json")))

RESULT_DIR.mkdir(parents=True, exist_ok=True)


# =========================================================
# OUTPUT FILES
# =========================================================

TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")

CSV_OUTPUT = RESULT_DIR / f"qos_raw_{TIMESTAMP}.csv"
SUMMARY_OUTPUT = RESULT_DIR / f"qos_summary_{TIMESTAMP}.txt"

LATEST_JSON = RESULT_DIR / "qos_latest.json"
ALERT_JSON = RESULT_DIR / "qos_alerts.json"
LIVE_JSON = RESULT_DIR / "qos_live.json"
HISTORY_JSON = RESULT_DIR / "qos_history.json"
NOTIFICATION_STATE_JSON = RESULT_DIR / "qos_notification_state.json"


# =========================================================
# INTERNET CHECK
# =========================================================

def has_internet():
    try:
        requests.get("https://www.google.com", timeout=5)
        return True
    except:
        return False


def get_firebase_auth_token():
    global firebase_id_token, firebase_refresh_token, firebase_token_expires_at

    if firebase_id_token and time.time() < firebase_token_expires_at:
        return firebase_id_token

    if firebase_id_token and not firebase_refresh_token:
        return firebase_id_token

    if firebase_refresh_token:
        refresh_url = f"https://securetoken.googleapis.com/v1/token?key={FIREBASE_API_KEY}"
        payload = {
            "grant_type": "refresh_token",
            "refresh_token": firebase_refresh_token
        }

        try:
            response = requests.post(refresh_url, data=payload, timeout=10)
            response.raise_for_status()
            data = response.json()
            firebase_id_token = data["id_token"]
            firebase_refresh_token = data["refresh_token"]
            firebase_token_expires_at = time.time() + int(data.get("expires_in", 3600)) - 60
            return firebase_id_token
        except Exception as e:
            print(f"firebase token refresh failed: {e}")

    if not (FIREBASE_API_KEY and FIREBASE_AUTH_EMAIL and FIREBASE_AUTH_PASSWORD):
        return firebase_id_token

    sign_in_url = (
        "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
        f"?key={FIREBASE_API_KEY}"
    )
    payload = {
        "email": FIREBASE_AUTH_EMAIL,
        "password": FIREBASE_AUTH_PASSWORD,
        "returnSecureToken": True
    }

    try:
        response = requests.post(sign_in_url, json=payload, timeout=10)
        response.raise_for_status()
        data = response.json()
        firebase_id_token = data["idToken"]
        firebase_refresh_token = data["refreshToken"]
        firebase_token_expires_at = time.time() + int(data.get("expiresIn", 3600)) - 60
        return firebase_id_token
    except Exception as e:
        print(f"firebase sign-in failed: {e}")
        return firebase_id_token


def firebase_rest_url(path):
    token = get_firebase_auth_token()
    url = f"{FIREBASE_DATABASE_URL}/{path.strip('/')}.json"
    if token:
        return f"{url}?auth={token}"
    return url


# =========================================================
# SELECT MODE
# =========================================================

ACTIVE_API_URL = None
ACTIVE_PING_TARGET = None
ACTIVE_MODE_NAME = None
ACTIVE_THROUGHPUT_TEST_URL = None


def refresh_active_mode():
    global ACTIVE_API_URL, ACTIVE_PING_TARGET, ACTIVE_MODE_NAME, ACTIVE_THROUGHPUT_TEST_URL

    if has_internet():
        ACTIVE_API_URL = GCP_API_URL
        ACTIVE_PING_TARGET = PING_TARGET_ONLINE
        ACTIVE_MODE_NAME = "online"
        ACTIVE_THROUGHPUT_TEST_URL = THROUGHPUT_TEST_URL_ONLINE
    else:
        ACTIVE_API_URL = LOCAL_API_URL
        ACTIVE_PING_TARGET = PING_TARGET_OFFLINE
        ACTIVE_MODE_NAME = "offline"
        ACTIVE_THROUGHPUT_TEST_URL = THROUGHPUT_TEST_URL_OFFLINE


# =========================================================
# GET IMAGES
# =========================================================

def get_images():
    exts = [".jpg", ".jpeg", ".png", ".webp"]

    images = []

    for p in sorted(IMAGE_DIR.iterdir()):
        if p.suffix.lower() in exts:
            images.append(p)

    if not images:
        raise Exception("No images found")

    latest_image = max(images, key=lambda p: p.stat().st_mtime)

    return [latest_image]


# =========================================================
# CONTENT TYPE
# =========================================================

def get_content_type(path: Path):

    ext = path.suffix.lower()

    if ext in [".jpg", ".jpeg"]:
        return "image/jpeg"

    if ext == ".png":
        return "image/png"

    if ext == ".webp":
        return "image/webp"

    return "application/octet-stream"


# =========================================================
# PING METRICS
# =========================================================

def parse_packet_loss(output):
    patterns = [
        r"(\d+(?:\.\d+)?)%\s*packet loss",
        r"(\d+(?:\.\d+)?)%\s*loss",
        r"\((\d+(?:\.\d+)?)%\s*loss\)",
        r"\((\d+(?:\.\d+)?)%\s*hilang\)",
        r"(\d+(?:\.\d+)?)%\s*kehilangan"
    ]

    for pattern in patterns:
        match = re.search(pattern, output)
        if match:
            return float(match.group(1))

    return None


def parse_ping_latency_seconds(output):
    linux_match = re.search(r"=\s*[\d.]+/([\d.]+)/[\d.]+/[\d.]+\s*ms", output)
    if linux_match:
        return round(float(linux_match.group(1)) / 1000, 6)

    windows_match = re.search(r"average\s*=\s*(\d+(?:\.\d+)?)ms", output)
    if windows_match:
        return round(float(windows_match.group(1)) / 1000, 6)

    localized_match = re.search(r"(?:rata-rata|average)[^\d]*(\d+(?:\.\d+)?)\s*ms", output)
    if localized_match:
        return round(float(localized_match.group(1)) / 1000, 6)

    times = [float(value) for value in re.findall(r"time[=<]\s*(\d+(?:\.\d+)?)\s*ms", output)]
    if times:
        return round(statistics.mean(times) / 1000, 6)

    return None


def get_ping_metrics(host):

    try:

        system = platform.system().lower()

        if system == "windows":
            cmd = ["ping", "-n", "5", host]
        else:
            cmd = ["ping", "-c", "5", host]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True
        )

        output = result.stdout.lower()

        return {
            "packet_loss_percent": parse_packet_loss(output),
            "network_latency_seconds": parse_ping_latency_seconds(output)
        }

    except:
        return {
            "packet_loss_percent": None,
            "network_latency_seconds": None
        }


# =========================================================
# NETWORK THROUGHPUT
# =========================================================

def get_network_throughput(url, max_bytes):
    if not url:
        return {
            "throughput_mbps": None,
            "throughput_MBps": None,
            "bytes_received": 0,
            "duration_seconds": None,
            "error": "throughput test url not configured"
        }

    bytes_received = 0
    start = time.perf_counter()

    try:
        with requests.get(url, stream=True, timeout=30) as response:
            response.raise_for_status()

            for chunk in response.iter_content(chunk_size=65536):
                if not chunk:
                    continue

                bytes_received += len(chunk)

                if bytes_received >= max_bytes:
                    break

        duration = time.perf_counter() - start

        if duration <= 0 or bytes_received <= 0:
            return {
                "throughput_mbps": None,
                "throughput_MBps": None,
                "bytes_received": bytes_received,
                "duration_seconds": round(duration, 6),
                "error": "invalid throughput sample"
            }

        megabytes = bytes_received / (1024 * 1024)
        throughput_MBps = megabytes / duration

        return {
            "throughput_mbps": round(throughput_MBps * 8, 6),
            "throughput_MBps": round(throughput_MBps, 6),
            "bytes_received": bytes_received,
            "duration_seconds": round(duration, 6),
            "error": ""
        }

    except Exception as e:
        duration = time.perf_counter() - start

        return {
            "throughput_mbps": None,
            "throughput_MBps": None,
            "bytes_received": bytes_received,
            "duration_seconds": round(duration, 6),
            "error": str(e)
        }


# =========================================================
# DEVICE METRICS
# =========================================================

def get_cpu_usage():
    return psutil.cpu_percent(interval=None)


def get_memory_usage():
    mem = psutil.virtual_memory()
    return mem.percent


def get_raspberry_pi_uptime_seconds():
    return round(time.time() - psutil.boot_time())


# =========================================================
# JITTER
# =========================================================

def calculate_jitter(latencies):

    if len(latencies) < 2:
        return 0.0

    diffs = []

    for i in range(1, len(latencies)):
        diff = abs(latencies[i] - latencies[i - 1])
        diffs.append(diff)

    return statistics.mean(diffs)


def update_row_jitter(rows):
    previous_latency = None

    for row in rows:
        latency = row.get("latency_seconds")

        if latency is None:
            row["jitter_seconds"] = None
            continue

        row["jitter_seconds"] = (
            round(abs(latency - previous_latency), 6)
            if previous_latency is not None
            else 0.0
        )
        previous_latency = latency


# =========================================================
# SAFE STATS
# =========================================================

def safe_mean(data):
    data = [x for x in data if x is not None]
    return statistics.mean(data) if data else None


def safe_min(data):
    data = [x for x in data if x is not None]
    return min(data) if data else None


def safe_max(data):
    data = [x for x in data if x is not None]
    return max(data) if data else None


def safe_std(data):
    data = [x for x in data if x is not None]

    if len(data) <= 1:
        return 0.0

    return statistics.stdev(data)


# =========================================================
# JSON HELPERS
# =========================================================

def write_json(path, data):
    temp_path = path.with_suffix(path.suffix + ".tmp")

    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)

    os.replace(temp_path, path)


def load_json_file(path, default):
    if not path.exists():
        return default

    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return default


def load_history():
    if not HISTORY_JSON.exists():
        return []

    try:
        with open(HISTORY_JSON, "r", encoding="utf-8") as f:
            data = json.load(f)

        if isinstance(data, list):
            return data[-MAX_HISTORY_POINTS:]
    except:
        pass

    return []


def parse_timestamp_ms(value):
    if value is None:
        return None

    try:
        number = float(value)
        if number > 1000000000000:
            return int(number)
        if number > 1000000000:
            return int(number * 1000)
    except (TypeError, ValueError):
        pass

    text = str(value).strip()
    if not text:
        return None

    try:
        return int(datetime.fromisoformat(text).timestamp() * 1000)
    except ValueError:
        pass

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y%m%d_%H%M%S"):
        try:
            return int(datetime.strptime(text, fmt).timestamp() * 1000)
        except ValueError:
            continue

    return None


def load_dht_status():
    if not DHT_STATUS_PATH.exists():
        return {
            "online": False,
            "reason": "dht status file not found",
            "path": str(DHT_STATUS_PATH)
        }

    try:
        with open(DHT_STATUS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        return {
            "online": False,
            "reason": f"failed to read dht status: {e}",
            "path": str(DHT_STATUS_PATH)
        }

    temperature = data.get("temperature")
    humidity = data.get("humidity")
    timestamp_ms = (
        parse_timestamp_ms(data.get("timestampMillis"))
        or parse_timestamp_ms(data.get("timestamp_iso"))
        or parse_timestamp_ms(data.get("timestamp"))
    )
    age_seconds = ((time.time() * 1000) - timestamp_ms) / 1000 if timestamp_ms else None

    has_sensor_values = isinstance(temperature, (int, float)) and isinstance(humidity, (int, float))
    fresh = age_seconds is not None and age_seconds <= DHT_FRESH_SECONDS
    online = data.get("status") == "online" and has_sensor_values and fresh

    return {
        "online": online,
        "status": "online" if online else "offline",
        "temperature": temperature,
        "humidity": humidity,
        "timestamp": data.get("timestamp"),
        "timestamp_iso": data.get("timestamp_iso"),
        "timestampMillis": timestamp_ms,
        "age_seconds": round(age_seconds, 2) if age_seconds is not None else None,
        "fresh_threshold_seconds": DHT_FRESH_SECONDS,
        "path": str(DHT_STATUS_PATH),
        "reason": "" if online else "dht data missing, stale, or offline"
    }


# =========================================================
# SINGLE REQUEST
# =========================================================

def send_request(request_number: int):

    timestamp = datetime.now()

    date_str = timestamp.strftime("%Y-%m-%d")
    time_str = timestamp.strftime("%H:%M:%S")

    cpu_usage = get_cpu_usage()
    memory_usage = get_memory_usage()

    ping_metrics = get_ping_metrics(ACTIVE_PING_TARGET)
    network_throughput = get_network_throughput(
        ACTIVE_THROUGHPUT_TEST_URL,
        THROUGHPUT_TEST_BYTES
    )

    result = {
        "timestamp": timestamp.isoformat(),
        "date": date_str,
        "time": time_str,

        "request_number": request_number,

        "system_mode": ACTIVE_MODE_NAME,
        "api_url": ACTIVE_API_URL,
        "ping_target": ACTIVE_PING_TARGET,
        "throughput_test_url": ACTIVE_THROUGHPUT_TEST_URL,

        "image_name": "health_check",
        "image_size_bytes": 0,
        "image_size_mb": 0,

        "cpu_usage_percent": cpu_usage,
        "memory_usage_percent": memory_usage,

        "packet_loss_percent": ping_metrics["packet_loss_percent"],
        "network_latency_seconds": ping_metrics["network_latency_seconds"],

        "latency_seconds": None,
        "throughput_mbps": network_throughput["throughput_mbps"],
        "throughput_MBps": network_throughput["throughput_MBps"],
        "throughput_test_bytes": network_throughput["bytes_received"],
        "throughput_test_seconds": network_throughput["duration_seconds"],
        "throughput_test_error": network_throughput["error"],

        "success": False,
        "http_status": None,

        "error": ""
    }

    try:

        start = time.perf_counter()

        response = requests.get(
            ACTIVE_API_URL,
            timeout=30
        )

        end = time.perf_counter()

        result["latency_seconds"] = round(end - start, 6)
        result["http_status"] = response.status_code

        if response.status_code == 200:

            result["success"] = True

        else:
            result["error"] = response.text[:300]

    except Exception as e:
        result["error"] = str(e)

    return result


# =========================================================
# CSV
# =========================================================

def save_csv(rows):

    fieldnames = [
        "timestamp",
        "date",
        "time",

        "request_number",

        "system_mode",
        "api_url",
        "ping_target",
        "throughput_test_url",

        "image_name",
        "image_size_bytes",
        "image_size_mb",

        "cpu_usage_percent",
        "memory_usage_percent",

        "packet_loss_percent",
        "network_latency_seconds",

        "latency_seconds",
        "jitter_seconds",

        "throughput_mbps",
        "throughput_MBps",
        "throughput_test_bytes",
        "throughput_test_seconds",
        "throughput_test_error",

        "success",
        "http_status",

        "error"
    ]

    with open(CSV_OUTPUT, "w", newline="", encoding="utf-8") as f:

        writer = csv.DictWriter(
            f,
            fieldnames=fieldnames
        )

        writer.writeheader()
        writer.writerows(
            {field: row.get(field) for field in fieldnames}
            for row in rows
        )


# =========================================================
# SUMMARY
# =========================================================

def build_summary(rows):

    success_rows = [r for r in rows if r["success"]]

    latencies = [
        r["latency_seconds"]
        for r in rows
        if r["latency_seconds"] is not None
    ]

    throughputs = [
        r["throughput_mbps"]
        for r in rows
        if r.get("throughput_mbps") is not None
    ]

    cpu_values = [
        r["cpu_usage_percent"]
        for r in rows
    ]

    mem_values = [
        r["memory_usage_percent"]
        for r in rows
    ]

    packet_loss_values = [
        r["packet_loss_percent"]
        for r in rows
        if r["packet_loss_percent"] is not None
    ]

    jitter = calculate_jitter(latencies)

    success_rate = (len(success_rows) / len(rows)) * 100 if rows else 0

    request_loss = 100 - success_rate

    summary = {

        "timestamp": datetime.now().isoformat(),

        "system_mode": ACTIVE_MODE_NAME,
        "api_url": ACTIVE_API_URL,
        "ping_target": ACTIVE_PING_TARGET,
        "raspberry_pi_uptime_seconds": get_raspberry_pi_uptime_seconds(),

        "total_requests": len(rows),
        "successful_requests": len(success_rows),
        "failed_requests": len(rows) - len(success_rows),

        "success_rate_percent": success_rate,
        "request_loss_percent": request_loss,

        "avg_latency_seconds": safe_mean(latencies),
        "min_latency_seconds": safe_min(latencies),
        "max_latency_seconds": safe_max(latencies),
        "std_latency_seconds": safe_std(latencies),

        "jitter_seconds": jitter,

        "avg_throughput_mbps": safe_mean(throughputs),
        "min_throughput_mbps": safe_min(throughputs),
        "max_throughput_mbps": safe_max(throughputs),
        "std_throughput_mbps": safe_std(throughputs),

        "avg_cpu_usage_percent": safe_mean(cpu_values),
        "min_cpu_usage_percent": safe_min(cpu_values),
        "max_cpu_usage_percent": safe_max(cpu_values),
        "std_cpu_usage_percent": safe_std(cpu_values),

        "avg_memory_usage_percent": safe_mean(mem_values),
        "min_memory_usage_percent": safe_min(mem_values),
        "max_memory_usage_percent": safe_max(mem_values),
        "std_memory_usage_percent": safe_std(mem_values),

        "avg_packet_loss_percent": safe_mean(packet_loss_values),
        "min_packet_loss_percent": safe_min(packet_loss_values),
        "max_packet_loss_percent": safe_max(packet_loss_values),
        "std_packet_loss_percent": safe_std(packet_loss_values)
    }

    return summary


# =========================================================
# SUMMARY TXT
# =========================================================

def save_summary(summary):

    with open(SUMMARY_OUTPUT, "w") as f:

        f.write("===== LOKASIGHT QOS SUMMARY =====\n\n")

        for k, v in summary.items():
            f.write(f"{k}: {v}\n")


# =========================================================
# LATEST JSON
# =========================================================

def save_latest(summary):

    write_json(LATEST_JSON, summary)


# =========================================================
# REALTIME JSON
# =========================================================

def save_history(rows):
    write_json(HISTORY_JSON, rows[-MAX_HISTORY_POINTS:])


def build_live(rows, summary):
    latest = rows[-1] if rows else None
    dht_status = load_dht_status()
    raspberry_pi_online = ACTIVE_MODE_NAME == "online"
    raspberry_pi_uptime_seconds = get_raspberry_pi_uptime_seconds()

    return {
        "updated_at": datetime.now().isoformat(),
        "system_mode": ACTIVE_MODE_NAME,
        "api_url": ACTIVE_API_URL,
        "ping_target": ACTIVE_PING_TARGET,
        "raspberry_pi_uptime_seconds": raspberry_pi_uptime_seconds,
        "system_status": {
            "raspberry_pi_online": raspberry_pi_online,
            "raspberry_pi_status": "online" if raspberry_pi_online else "offline",
            "raspberry_pi_uptime_seconds": raspberry_pi_uptime_seconds,
            "dht_online": dht_status["online"],
            "dht_status": dht_status
        },
        "total_recorded": len(rows),
        "successful_requests": summary["successful_requests"],
        "failed_requests": summary["failed_requests"],
        "success_rate_percent": summary["success_rate_percent"],
        "latest": latest,
        "current_average": {
            "avg_latency_seconds": summary["avg_latency_seconds"],
            "avg_throughput_mbps": summary["avg_throughput_mbps"],
            "avg_packet_loss_percent": summary["avg_packet_loss_percent"],
            "avg_cpu_usage_percent": summary["avg_cpu_usage_percent"],
            "avg_memory_usage_percent": summary["avg_memory_usage_percent"],
            "jitter_seconds": summary["jitter_seconds"]
        },
        "history": rows[-MAX_HISTORY_POINTS:]
    }


def save_live(rows, summary):
    write_json(LIVE_JSON, build_live(rows, summary))


# =========================================================
# ALERTS
# =========================================================

def build_alerts(summary):

    alerts = []

    latency = summary["avg_latency_seconds"]
    cpu = summary["avg_cpu_usage_percent"]
    mem = summary["avg_memory_usage_percent"]
    packet_loss = summary["avg_packet_loss_percent"]
    jitter = summary["jitter_seconds"]
    throughput = summary["avg_throughput_mbps"]
    now_iso = datetime.now().isoformat()

    if latency is not None and latency > 1:
        alerts.append({
            "type": "high_latency",
            "title": "Peringatan Latency Tinggi",
            "message": "Latency tinggi, lebih dari 1 detik.",
            "level": "high",
            "value": latency,
            "threshold": 1,
            "unit": "s",
            "timestamp": now_iso
        })

    if jitter is not None and jitter > 0.2:
        alerts.append({
            "type": "high_jitter",
            "title": "Peringatan Jitter Tinggi",
            "message": "Jitter tinggi, koneksi kurang stabil.",
            "level": "medium",
            "value": jitter,
            "threshold": 0.2,
            "unit": "s",
            "timestamp": now_iso
        })

    if throughput is not None and throughput < 1:
        alerts.append({
            "type": "low_throughput",
            "title": "Peringatan Throughput Rendah",
            "message": "Network throughput rendah, transfer data melambat.",
            "level": "medium",
            "value": throughput,
            "threshold": 1,
            "unit": "Mbps",
            "timestamp": now_iso
        })

    if cpu is not None and cpu > 85:
        alerts.append({
            "type": "high_cpu_usage",
            "title": "Peringatan CPU Tinggi",
            "message": "CPU usage tinggi pada perangkat.",
            "level": "high",
            "value": cpu,
            "threshold": 85,
            "unit": "%",
            "timestamp": now_iso
        })

    if mem is not None and mem > 85:
        alerts.append({
            "type": "high_memory_usage",
            "title": "Peringatan Memory Tinggi",
            "message": "Memory usage tinggi pada perangkat.",
            "level": "high",
            "value": mem,
            "threshold": 85,
            "unit": "%",
            "timestamp": now_iso
        })

    if packet_loss is not None and packet_loss > 5:
        alerts.append({
            "type": "high_packet_loss",
            "title": "Peringatan Packet Loss Tinggi",
            "message": "Packet loss tinggi, ada paket data yang hilang.",
            "level": "high",
            "value": packet_loss,
            "threshold": 5,
            "unit": "%",
            "timestamp": now_iso
        })

    return alerts


def save_alerts(alerts):

    write_json(ALERT_JSON, alerts)


def sanitize_firebase_key(value):
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(value or "").strip())


def get_notification_id(alert):
    cooldown_seconds = max(int(NOTIFICATION_COOLDOWN_MINUTES), 1) * 60
    bucket = int(time.time() // cooldown_seconds)
    return f"qos_{sanitize_firebase_key(alert.get('type'))}_{bucket}"


def build_qos_notification(alert, notification_id):
    return {
        "schema_version": 1,
        "id": notification_id,
        "type": "qos",
        "subtype": alert.get("type"),
        "title": alert.get("title", "Peringatan QoS"),
        "message": alert.get("message", "Kualitas jaringan membutuhkan perhatian."),
        "level": alert.get("level", "medium"),
        "source": "raspberry_pi",
        "source_id": notification_id,
        "created_at": alert.get("timestamp") or datetime.now().isoformat(),
        "read": False,
        "handled": False,
        "metric": {
            "value": alert.get("value"),
            "threshold": alert.get("threshold"),
            "unit": alert.get("unit", "")
        }
    }


def send_qos_notifications(alerts):
    if not FIREBASE_NOTIFICATIONS_ENABLED:
        return

    if not FIREBASE_DATABASE_URL or not FIREBASE_NOTIFICATIONS_PATH:
        return

    state = load_json_file(NOTIFICATION_STATE_JSON, {})
    changed = False

    for alert in alerts:
        notification_id = get_notification_id(alert)

        if state.get(alert["type"]) == notification_id:
            continue

        url = firebase_rest_url(f"{FIREBASE_NOTIFICATIONS_PATH}/{notification_id}")
        payload = build_qos_notification(alert, notification_id)

        try:
            response = requests.put(url, json=payload, timeout=8)
            response.raise_for_status()
            state[alert["type"]] = notification_id
            changed = True
            print(f"notif={notification_id} sent")
        except Exception as e:
            print(f"notif={notification_id} failed: {e}")

    if changed:
        write_json(NOTIFICATION_STATE_JSON, state)


def send_pi_heartbeat():
    if not PI_HEARTBEAT_ENABLED:
        return

    if not FIREBASE_DATABASE_URL or not PI_HEARTBEAT_PATH:
        return

    now = datetime.now()
    payload = {
        "status": "online",
        "last_seen_ms": int(time.time() * 1000),
        "last_seen_iso": now.isoformat(),
        "source": "qos_monitor",
        "mode": ACTIVE_MODE_NAME,
        "api_url": ACTIVE_API_URL,
        "ping_target": ACTIVE_PING_TARGET,
        "raspberry_pi_uptime_seconds": get_raspberry_pi_uptime_seconds()
    }

    url = firebase_rest_url(PI_HEARTBEAT_PATH)

    try:
        response = requests.patch(url, json=payload, timeout=8)
        response.raise_for_status()
    except Exception as e:
        print(f"heartbeat failed: {e}")


# =========================================================
# MAIN
# =========================================================

def main():

    rows = load_history()
    psutil.cpu_percent(interval=None)
    refresh_active_mode()

    print("===== LOKASIGHT QOS MONITOR =====")

    print(f"Script Path     : {Path(__file__).resolve()}")
    print(f"Config Path     : {CONFIG_PATH}")
    print(f"Result Dir      : {RESULT_DIR}")
    print(f"DHT Status File : {DHT_STATUS_PATH}")
    print(f"Mode            : {ACTIVE_MODE_NAME}")
    print(f"API URL         : {ACTIVE_API_URL}")
    print(f"Ping Target     : {ACTIVE_PING_TARGET}")

    print("Check Type      : GET health/root endpoint")
    print(f"Total Requests  : {'continuous' if RUN_FOREVER else TOTAL_REQUESTS}")
    print(f"Run Forever     : {RUN_FOREVER}")
    print(f"Delay           : {DELAY_BETWEEN_REQUESTS}s")
    print(f"History Limit   : {MAX_HISTORY_POINTS}")

    print()

    request_number = len(rows) + 1
    completed_this_run = 0

    try:
        while RUN_FOREVER or completed_this_run < TOTAL_REQUESTS:
            previous_mode = ACTIVE_MODE_NAME
            refresh_active_mode()

            if ACTIVE_MODE_NAME != previous_mode:
                print(f"Mode changed     : {ACTIVE_MODE_NAME}")

            total_label = "continuous" if RUN_FOREVER else str(TOTAL_REQUESTS)

            print(
                f"[{request_number}/{total_label}] "
                f"health_check"
            )

            row = send_request(
                request_number=request_number
            )

            rows.append(row)
            rows = rows[-MAX_HISTORY_POINTS:]
            update_row_jitter(rows)

            summary = build_summary(rows)
            alerts = build_alerts(summary)

            save_history(rows)
            save_live(rows, summary)
            save_latest(summary)
            save_alerts(alerts)
            send_qos_notifications(alerts)
            send_pi_heartbeat()
            save_csv(rows)
            save_summary(summary)

            print(
                f"success={row['success']} | "
                f"http_status={row['http_status']} | "
                f"api_latency={row['latency_seconds']} | "
                f"network_latency={row['network_latency_seconds']} | "
                f"throughput={row['throughput_mbps']} | "
                f"cpu={row['cpu_usage_percent']} | "
                f"ram={row['memory_usage_percent']}"
            )

            if not row["success"] and row["error"]:
                print(f"error={row['error']}")

            request_number += 1
            completed_this_run += 1

            if RUN_FOREVER or completed_this_run < TOTAL_REQUESTS:
                time.sleep(DELAY_BETWEEN_REQUESTS)

    except KeyboardInterrupt:
        print("\nStopped by user.")

    print()

    print("===== DONE =====")

    print(f"CSV      : {CSV_OUTPUT}")
    print(f"SUMMARY  : {SUMMARY_OUTPUT}")
    print(f"LATEST   : {LATEST_JSON}")
    print(f"LIVE     : {LIVE_JSON}")
    print(f"HISTORY  : {HISTORY_JSON}")
    print(f"ALERTS   : {ALERT_JSON}")


if __name__ == "__main__":
    main()
