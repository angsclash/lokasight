// js/qos.js
console.log("qos.js LOKASIGHT - NETWORK DASHBOARD aktif");

if (window.LokasightAuth?.requireLogin) {
  window.LokasightAuth.requireLogin();
} else if (localStorage.getItem("lokatani_login") !== "true") {
  window.location.replace("login.html");
}

function logout() {
  if (window.LokasightAuth?.logout) {
    window.LokasightAuth.logout();
  } else {
    localStorage.removeItem("lokatani_login");
    window.location.replace("login.html");
  }
}

const QOS_AUTO_PATHS = [
  "qos/qos_live.json",
  "qos/qos_history.json",
  "qos/qos_latest.json",
  "qos_live.json",
  "qos_history.json",
  "qos_latest.json",
  "data/qos_live.json",
  "data/qos_history.json",
  "data/qos_latest.json",
  "lokasight/qos_live.json",
  "lokasight/qos_history.json",
  "lokasight/qos_latest.json",
  "lokasight/data/qos_live.json",
  "lokasight/data/qos_history.json",
  "lokasight/data/qos_latest.json"
];

const qosSeriesConfig = [
  { key: "avg_latency_seconds", label: "Latency", unit: "s", color: "#2e7d32" },
  { key: "jitter_seconds", label: "Jitter", unit: "s", color: "#f57c00" },
  { key: "avg_packet_loss_percent", label: "Packet Loss", unit: "%", color: "#e53935" },
  { key: "avg_throughput_mbps", label: "Network Throughput", unit: "Mbps", color: "#1976d2" },
  { key: "avg_cpu_usage_percent", label: "CPU", unit: "%", color: "#7b1fa2" },
  { key: "avg_memory_usage_percent", label: "Memory", unit: "%", color: "#00897b" }
];

const WIB_TIMEZONE = "Asia/Jakarta";
const QOS_ANOMALY_LIMIT = 30;
const QOS_CHART_POINT_LIMIT = 10;
const QOS_FRESH_WINDOW_MS = 10 * 60 * 1000;
const FIREBASE_DB_URL = "https://lokasighthama-default-rtdb.asia-southeast1.firebasedatabase.app";
const FIREBASE_NOTIFICATIONS_URL = `${FIREBASE_DB_URL}/notifications.json`;
const SHOWN_NOTIF_KEY = "shownNotificationKeys";
const NOTIFICATION_CACHE_KEY = "dashboardNotifications";
const READ_NOTIF_KEY = "readNotificationKeys";
const QOS_ACTIVE_ALERTS_KEY = "qosActiveAlertKeys";

let notifications = [];
let shownNotificationKeys = new Set(
  JSON.parse(localStorage.getItem(SHOWN_NOTIF_KEY) || "[]")
);
let readNotificationKeys = new Set(
  JSON.parse(localStorage.getItem(READ_NOTIF_KEY) || "[]")
);
let qosActiveAlertKeys = new Set(
  JSON.parse(localStorage.getItem(QOS_ACTIVE_ALERTS_KEY) || "[]")
);

const qosAnomalyRules = [
  {
    key: "avg_latency_seconds",
    label: "Latency tinggi",
    unit: "s",
    threshold: 1,
    decimals: 3,
    isAnomaly: (value) => value > 1
  },
  {
    key: "jitter_seconds",
    label: "Jitter tinggi",
    unit: "s",
    threshold: 0.2,
    decimals: 3,
    isAnomaly: (value) => value > 0.2
  },
  {
    key: "avg_packet_loss_percent",
    label: "Packet loss tinggi",
    unit: "%",
    threshold: 5,
    decimals: 2,
    isAnomaly: (value) => value > 5
  },
  {
    key: "avg_throughput_mbps",
    label: "Network throughput rendah",
    unit: "Mbps",
    threshold: 1,
    decimals: 2,
    isAnomaly: (value) => value < 1
  },
  {
    key: "avg_cpu_usage_percent",
    label: "CPU usage tinggi",
    unit: "%",
    threshold: 85,
    decimals: 2,
    isAnomaly: (value) => value > 85
  },
  {
    key: "avg_memory_usage_percent",
    label: "Memory usage tinggi",
    unit: "%",
    threshold: 85,
    decimals: 2,
    isAnomaly: (value) => value > 85
  }
];

let qosPoints = [];
let latestDhtTimestampMs = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function saveShownNotificationKeys() {
  localStorage.setItem(
    SHOWN_NOTIF_KEY,
    JSON.stringify(Array.from(shownNotificationKeys))
  );
}

function saveReadNotificationKeys() {
  const keys = Array.from(readNotificationKeys).slice(-300);
  readNotificationKeys = new Set(keys);
  localStorage.setItem(READ_NOTIF_KEY, JSON.stringify(keys));
}

function saveQosActiveAlertKeys() {
  localStorage.setItem(
    QOS_ACTIVE_ALERTS_KEY,
    JSON.stringify(Array.from(qosActiveAlertKeys))
  );
}

function saveNotifications() {
  localStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify(notifications));
}

function loadNotifications() {
  const cached = localStorage.getItem(NOTIFICATION_CACHE_KEY);
  if (!cached) return;

  try {
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed)) {
      notifications = parsed.map((item) => ({
        ...item,
        unread: item?.id && readNotificationKeys.has(item.id) ? false : item.unread
      }));
    }
  } catch {
    notifications = [];
  }
}

function requestBrowserNotificationPermission() {
  if (!("Notification" in window)) return;

  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function showBrowserNotification(title, message) {
  if (!("Notification" in window)) return;

  if (Notification.permission === "granted") {
    new Notification(title, { body: message });
  }
}

function getNowTimeLabel() {
  return new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function addNotification({
  id,
  title,
  message,
  level = "medium",
  icon = "bell",
  iconColor = "#4caf50",
  time = "Now",
  popup = true
}) {
  if (!id) return;
  if (notifications.some((item) => item.id === id)) return;

  notifications.unshift({
    id,
    title,
    message,
    time,
    level,
    icon,
    iconColor,
    unread: !readNotificationKeys.has(id)
  });
  notifications = notifications.slice(0, 30);

  saveNotifications();
  renderNotifications();

  if (popup && !shownNotificationKeys.has(id)) {
    shownNotificationKeys.add(id);
    saveShownNotificationKeys();
    showBrowserNotification(title, message);
  }
}

function getUnreadCount() {
  return notifications.filter((item) => item.unread).length;
}

function getLevelBadgeClass(level) {
  if (level === "high") {
    return "border border-[#ff8a80] bg-[#fdeaea] text-[#e53935]";
  }

  if (level === "medium") {
    return "border border-[#ffb74d] bg-[#fff1e0] text-[#ef6c00]";
  }

  return "border border-[#f4d03f] bg-[#fff9db] text-[#c49000]";
}

function renderNotifications() {
  const notifList = document.getElementById("notifList");
  const notifBadge = document.getElementById("notifBadge");
  const notifCountPill = document.getElementById("notifCountPill");

  if (!notifList || !notifBadge || !notifCountPill) return;

  const unreadCount = getUnreadCount();
  notifBadge.textContent = unreadCount;
  notifCountPill.textContent = unreadCount;

  if (unreadCount === 0) {
    notifBadge.classList.add("hidden");
    notifBadge.classList.remove("flex");
  } else {
    notifBadge.classList.remove("hidden");
    notifBadge.classList.add("flex");
  }

  if (!notifications.length) {
    notifList.innerHTML = `
      <div class="px-5 py-6 text-center text-[15px] font-semibold text-[#66bb6a]">
        Belum ada notifikasi
      </div>
    `;
    return;
  }

  notifList.innerHTML = notifications.map((item) => {
    const unreadDot = item.unread
      ? `<span class="absolute right-5 top-6 h-3 w-3 rounded-full bg-[#4caf50]"></span>`
      : "";

    return `
      <div class="relative border-b border-[#d9e5d7] px-5 py-2">
        ${unreadDot}
        <div class="flex gap-4 pr-10">
          <div class="pt-1">
            <i data-lucide="${escapeHtml(item.icon)}" style="color:${escapeHtml(item.iconColor)}" class="h-6 w-6"></i>
          </div>
          <div class="min-w-0 flex-1">
            <div class="mb-1 text-[16px] font-semibold text-[#2e7d32]">${escapeHtml(item.title)}</div>
            <div class="mb-3 text-[15px] leading-relaxed text-[#2f6f33]">${escapeHtml(item.message)}</div>
            <div class="flex items-center justify-between gap-4">
              <div class="text-[14px] text-[#5dbb63]">${escapeHtml(item.time)}</div>
              <span class="rounded-full px-4 py-1 text-[14px] capitalize ${getLevelBadgeClass(item.level)}">
                ${escapeHtml(item.level)}
              </span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("");

  if (window.lucide) window.lucide.createIcons();
}

function closeNotifPanel() {
  const panel = document.getElementById("notifPanel");
  if (panel) panel.classList.add("hidden");
}

function toggleNotifPanel() {
  const panel = document.getElementById("notifPanel");
  if (panel) panel.classList.toggle("hidden");
}

function markAllNotificationsRead() {
  notifications = notifications.map((item) => ({
    ...item,
    unread: false
  }));

  notifications.forEach((item) => {
    if (item?.id) readNotificationKeys.add(item.id);
  });
  saveReadNotificationKeys();
  saveNotifications();
  renderNotifications();
}

function normalizeFirebaseNotification(key, value) {
  if (!value || typeof value !== "object") return null;
  const id = value.id || key;

  return {
    id: id,
    title: value.title || "Notifikasi",
    message: value.message || "",
    time: value.time || formatSensorTime(value.created_at || value.timestamp) || getNowTimeLabel(),
    level: value.level || "medium",
    icon: value.icon || (value.type === "qos" ? "activity" : "bell"),
    iconColor:
      value.iconColor ||
      (value.level === "high" ? "#e53935" : value.level === "medium" ? "#f57c00" : "#4caf50"),
    unread: value.read !== true && !readNotificationKeys.has(id),
    created_at: value.created_at || value.timestamp || null,
    source: "firebase"
  };
}

function getNotificationTimeMs(item) {
  const parsed = parseLokasightTime(item?.created_at);
  return parsed ? parsed.getTime() : 0;
}

function mergeNotifications(nextItems) {
  const existingById = new Map(notifications.map((item) => [item.id, item]));

  nextItems.forEach((item) => {
    const existing = existingById.get(item.id);
    const alreadyRead =
      readNotificationKeys.has(item.id) ||
      existing?.unread === false ||
      item.unread === false;

    if (alreadyRead) {
      readNotificationKeys.add(item.id);
    }

    existingById.set(item.id, {
      ...existing,
      ...item,
      unread: alreadyRead ? false : item.unread
    });
  });

  notifications = Array.from(existingById.values())
    .sort((a, b) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      return getNotificationTimeMs(b) - getNotificationTimeMs(a);
    })
    .slice(0, 30);

  saveReadNotificationKeys();
  saveNotifications();
  renderNotifications();
}

async function fetchFirebaseNotifications() {
  try {
    const response = await fetch(`${FIREBASE_NOTIFICATIONS_URL}?orderBy="$key"&limitToLast=30&t=${Date.now()}`, {
      cache: "no-store"
    });

    if (!response.ok) return;

    const payload = await response.json();
    const items = Object.entries(payload || {})
      .map(([key, value]) => normalizeFirebaseNotification(key, value))
      .filter(Boolean);

    if (items.length) mergeNotifications(items);
  } catch {
    // Local notification cache remains available when Firebase cannot be reached.
  }
}

function parseLokasightTime(tsString) {
  if (!tsString) return null;

  const raw = String(tsString).trim();

  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    if (num > 1000000000000) return new Date(num);
    if (num > 1000000000) return new Date(num * 1000);
  }

  const compactMatch = raw.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const [, y, mo, d, h, mi, s] = compactMatch;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  }

  const mysqlLikeMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (mysqlLikeMatch) {
    const [, y, mo, d, h, mi, s = "0"] = mysqlLikeMatch;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  }

  const clean = raw.replace(/\.(\d{3})\d*/, ".$1");
  const date = new Date(clean);
  return isNaN(date.getTime()) ? null : date;
}

function formatSensorTime(tsString) {
  const date = parseLokasightTime(tsString);
  if (!date) return "--";

  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WIB_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
  const nowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WIB_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const timeOnly = new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);

  if (dateParts === nowParts) return `${timeOnly} WIB`;

  const dateWithTime = new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB_TIMEZONE,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);

  return `${dateWithTime} WIB`;
}

function qosNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function qosFormat(value, decimals = 2) {
  return qosNumber(value).toFixed(decimals);
}

function getQoSPointTimeMs(point) {
  return parseLokasightTime(point?.time)?.getTime() || 0;
}

function isQoSPointFresh(point) {
  const timestampMs = getQoSPointTimeMs(point);
  return timestampMs > 0 && Date.now() - timestampMs <= QOS_FRESH_WINDOW_MS;
}

function hasQosValue(value) {
  return Number.isFinite(Number(value));
}

function qosFormatOptional(value, decimals = 2, unit = "") {
  if (!hasQosValue(value)) return "--";
  return `${Number(value).toFixed(decimals)}${unit ? ` ${unit}` : ""}`;
}

function formatUptime(seconds) {
  if (seconds === null || seconds === undefined || seconds === "") return "--";

  const totalSeconds = Math.floor(Number(seconds));
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "--";

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days} hari ${hours} jam`;
  if (hours > 0) return `${hours} jam ${minutes} menit`;
  return `${minutes} menit`;
}

function getPiUptimeSeconds(point, systemStatus) {
  const raw = point.raw || {};
  const latest = raw.latest || {};
  const candidates = [
    systemStatus.raspberry_pi_uptime_seconds,
    systemStatus.uptime_seconds,
    systemStatus.uptime,
    raw.raspberry_pi_uptime_seconds,
    raw.uptime_seconds,
    raw.uptime,
    latest.raspberry_pi_uptime_seconds,
    latest.uptime_seconds,
    latest.uptime,
    point.raspberry_pi_uptime_seconds,
    point.uptime_seconds,
    point.uptime
  ];

  for (const value of candidates) {
    if (hasQosValue(value)) return Number(value);
  }

  const bootTime =
    systemStatus.raspberry_pi_boot_time ||
    systemStatus.boot_time ||
    raw.raspberry_pi_boot_time ||
    raw.boot_time ||
    latest.raspberry_pi_boot_time ||
    latest.boot_time;
  const bootDate = parseLokasightTime(bootTime);

  return bootDate ? Math.max(0, (Date.now() - bootDate.getTime()) / 1000) : null;
}

function qosThresholdText(rule) {
  const prefix = rule.label.includes("rendah") ? "<" : ">";
  return `${prefix} ${Number(rule.threshold).toFixed(rule.decimals)} ${rule.unit}`;
}

function getQoSAlerts(point) {
  const alerts = [];

  if (qosNumber(point.avg_latency_seconds) > 1) {
    alerts.push({
      key: "latency-high",
      title: "Peringatan Latency Tinggi",
      message: "Latency tinggi, lebih dari 1 detik.",
      level: "high",
      iconColor: "#e53935"
    });
  }

  if (qosNumber(point.jitter_seconds) > 0.2) {
    alerts.push({
      key: "jitter-high",
      title: "Peringatan Jitter Tinggi",
      message: "Jitter tinggi, koneksi kurang stabil.",
      level: "medium",
      iconColor: "#f57c00"
    });
  }

  if (qosNumber(point.avg_packet_loss_percent) > 5) {
    alerts.push({
      key: "packet-loss-high",
      title: "Peringatan Packet Loss Tinggi",
      message: "Packet loss tinggi, ada paket data yang hilang.",
      level: "high",
      iconColor: "#e53935"
    });
  }

  if (qosNumber(point.avg_throughput_mbps) < 1) {
    alerts.push({
      key: "throughput-low",
      title: "Peringatan Throughput Rendah",
      message: "Network throughput rendah, transfer data melambat.",
      level: "medium",
      iconColor: "#f57c00"
    });
  }

  if (qosNumber(point.avg_cpu_usage_percent) > 85) {
    alerts.push({
      key: "cpu-high",
      title: "Peringatan CPU Tinggi",
      message: "CPU usage tinggi pada perangkat.",
      level: "high",
      iconColor: "#e53935"
    });
  }

  if (qosNumber(point.avg_memory_usage_percent) > 85) {
    alerts.push({
      key: "memory-high",
      title: "Peringatan Memory Tinggi",
      message: "Memory usage tinggi pada perangkat.",
      level: "high",
      iconColor: "#e53935"
    });
  }

  return alerts;
}

function notifyQoSAlerts(alerts) {
  const hourKey = new Date().toISOString().slice(0, 13);
  const activeKeys = new Set(alerts.map((alert) => alert.key));

  alerts.forEach((alert) => {
    if (qosActiveAlertKeys.has(alert.key)) return;

    addNotification({
      id: `qos-${alert.key}-${hourKey}`,
      title: alert.title,
      message: alert.message,
      level: alert.level,
      icon: "activity",
      iconColor: alert.iconColor,
      time: getNowTimeLabel()
    });
  });

  qosActiveAlertKeys = activeKeys;
  saveQosActiveAlertKeys();
}

function setStatusText(id, value, online = true) {
  const el = document.getElementById(id);
  if (!el) return;

  el.textContent = value;
  el.style.color = online ? "#2e7d32" : "#e53935";
}

function setNetworkStatus(status) {
  const textEl = document.getElementById("networkStatusText");
  const dotEl = document.getElementById("networkStatusDot");
  if (!textEl || !dotEl) return;

  if (status === "online") {
    textEl.className = "flex items-center gap-1.5 font-medium text-[#4caf50]";
    dotEl.className = "h-2.5 w-2.5 rounded-full bg-[#4caf50]";
    textEl.lastChild.textContent = " Online";
  } else if (status === "warning") {
    textEl.className = "flex items-center gap-1.5 font-medium text-[#ff9800]";
    dotEl.className = "h-2.5 w-2.5 rounded-full bg-[#ff9800]";
    textEl.lastChild.textContent = " Perlu Perhatian";
  } else {
    textEl.className = "flex items-center gap-1.5 font-medium text-[#f44336]";
    dotEl.className = "h-2.5 w-2.5 rounded-full bg-[#f44336]";
    textEl.lastChild.textContent = " Offline";
  }
}

function normalizeQoSRecord(raw, sourceLabel = "JSON QoS") {
  const source = raw?.current_average || raw?.average || raw?.metrics || raw?.latest || raw || {};
  const latest = raw?.latest || {};
  const time = raw?.timestamp || raw?.time || raw?.created_at || latest?.timestamp || latest?.time || new Date().toISOString();

  return {
    sourceLabel,
    time,
    total_recorded: raw?.total_recorded,
    successful_requests: raw?.successful_requests,
    failed_requests: raw?.failed_requests,
    success_rate_percent: source.success_rate_percent ?? raw?.success_rate_percent,
    success: latest?.success ?? raw?.success,
    http_status: latest?.http_status ?? raw?.http_status,
    avg_latency_seconds: source.avg_latency_seconds ?? source.latency_seconds ?? source.latency ?? source.delay,
    jitter_seconds: source.jitter_seconds ?? source.jitter,
    avg_packet_loss_percent: source.avg_packet_loss_percent ?? source.packet_loss_percent ?? source.packet_loss,
    avg_throughput_mbps: source.avg_throughput_mbps ?? source.throughput_mbps ?? source.throughput,
    avg_api_response_seconds: source.avg_api_response_seconds ?? source.api_response_seconds,
    avg_api_throughput_mbps: source.avg_api_throughput_mbps ?? source.api_throughput_mbps,
    avg_cpu_usage_percent: source.avg_cpu_usage_percent ?? source.cpu_usage_percent ?? source.cpu,
    avg_memory_usage_percent: source.avg_memory_usage_percent ?? source.memory_usage_percent ?? source.memory,
    raspberry_pi_uptime_seconds:
      source.raspberry_pi_uptime_seconds ??
      source.uptime_seconds ??
      raw?.raspberry_pi_uptime_seconds ??
      raw?.uptime_seconds ??
      latest?.raspberry_pi_uptime_seconds ??
      latest?.uptime_seconds,
    raw
  };
}

function extractQoSRecords(payload, sourceLabel = "JSON QoS") {
  const list =
    Array.isArray(payload) ? payload :
    Array.isArray(payload?.records) ? payload.records :
    Array.isArray(payload?.history) ? payload.history :
    Array.isArray(payload?.data) ? payload.data :
    Array.isArray(payload?.samples) ? payload.samples :
    [payload];

  const records = enrichQoSRecords(list.map((item) => normalizeQoSRecord(item, sourceLabel)));

  if (records.length && payload?.system_status) {
    records[records.length - 1].system_status = payload.system_status;
  }

  return records;
}

function enrichQoSRecords(records) {
  let previousLatency = null;

  return records.map((point) => {
    const latency = hasQosValue(point.avg_latency_seconds)
      ? Number(point.avg_latency_seconds)
      : null;

    if (!hasQosValue(point.jitter_seconds)) {
      point.jitter_seconds =
        previousLatency !== null && latency !== null
          ? Math.abs(latency - previousLatency)
          : 0;
    }

    if (latency !== null) previousLatency = latency;

    return point;
  });
}

function updateQoSCards(point, isFresh = true) {
  if (!point) return;

  const systemStatus = point.system_status || point.raw?.system_status || {};
  const raspberryOnline =
    systemStatus.raspberry_pi_online === true ||
    systemStatus.raspberry_pi_status === "online" ||
    point.raw?.system_mode === "online";
  const dhtOnline =
    systemStatus.dht_online === true ||
    systemStatus.dht_status?.online === true;
  const apiOnline =
    point.success === true ||
    Number(point.http_status) === 200 ||
    Number(point.successful_requests) > 0 ||
    Number(point.success_rate_percent) > 0;

  latestDhtTimestampMs =
    Number(systemStatus.dht_status?.timestampMillis) ||
    parseLokasightTime(systemStatus.dht_status?.timestamp_iso)?.getTime() ||
    parseLokasightTime(systemStatus.dht_status?.timestamp)?.getTime() ||
    0;

  setStatusText("piStatus", raspberryOnline ? "Online" : "Offline", raspberryOnline);
  setStatusText("piUptime", formatUptime(getPiUptimeSeconds(point, systemStatus)), raspberryOnline);
  setStatusText("gcpStatus", apiOnline ? "Online" : "Offline", apiOnline);
  setStatusText("dhtStatus", dhtOnline ? "Online" : "Offline", dhtOnline);

  const latency = qosNumber(point.avg_latency_seconds);
  const jitter = qosNumber(point.jitter_seconds);
  const packetLoss = qosNumber(point.avg_packet_loss_percent);
  const throughput = qosNumber(point.avg_throughput_mbps);

  document.getElementById("latencyValue").textContent = `${qosFormat(latency, 3)} s`;
  document.getElementById("jitterValue").textContent = `${qosFormat(jitter, 3)} s`;
  document.getElementById("packetLossValue").textContent = `${qosFormat(packetLoss)}%`;
  document.getElementById("throughputValue").textContent = `${qosFormat(throughput)} Mbps`;
  document.getElementById("cpuUsageValue").textContent = qosFormatOptional(point.avg_cpu_usage_percent, 2, "%");
  document.getElementById("memoryUsageValue").textContent = qosFormatOptional(point.avg_memory_usage_percent, 2, "%");

  if (!isFresh) {
    setNetworkStatus("offline");
    return;
  }

  const hasWarning = latency > 1 || jitter > 0.2 || packetLoss > 5 || throughput < 1 || !apiOnline || !dhtOnline || !raspberryOnline;
  setNetworkStatus(hasWarning ? "warning" : "online");
}

function renderQoSChart() {
  const grid = document.getElementById("qosChartsGrid");
  const pointCount = document.getElementById("qosPointCount");
  if (!grid) return;

  const chartPoints = qosPoints.slice(-QOS_CHART_POINT_LIMIT);

  if (pointCount) pointCount.textContent = `${chartPoints.length} data terakhir`;

  if (!chartPoints.length) {
    grid.innerHTML = `
      <div class="qos-mini-chart">
        <div class="qos-mini-chart-header">
          <h4 class="qos-mini-chart-title">Belum ada data QoS</h4>
        </div>
        <svg viewBox="0 0 360 180" role="img" aria-label="Belum ada data QoS">
          <text x="180" y="95" fill="#81c784" font-size="16" font-weight="700" text-anchor="middle">
            Belum ada data QoS
          </text>
        </svg>
      </div>
    `;
    return;
  }

  const visibleSeries = qosSeriesConfig.filter((series) =>
    chartPoints.some((point) => hasQosValue(point[series.key]))
  );

  grid.innerHTML = visibleSeries.map((series) => {
    const width = 360;
    const height = 190;
    const left = 42;
    const right = 336;
    const top = 18;
    const bottom = 142;
    const chartHeight = bottom - top;
    const stepX = chartPoints.length > 1 ? (right - left) / (chartPoints.length - 1) : 0;
    const values = chartPoints.map((point) => qosNumber(point[series.key]));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    const latestValue = values[values.length - 1];
    const decimals = series.unit === "s" ? 3 : 2;

    let svgHtml = "";

    for (let i = 0; i <= 3; i++) {
      const y = top + (chartHeight / 3) * i;
      svgHtml += `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#e3efe0" stroke-width="1" />`;
    }

    const coords = values.map((value, index) => {
      const x = chartPoints.length === 1 ? (left + right) / 2 : left + stepX * index;
      const y = bottom - ((value - min) / spread) * chartHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    svgHtml += `<polyline points="${coords.join(" ")}" fill="none" stroke="${series.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`;

    values.forEach((value, index) => {
      const x = chartPoints.length === 1 ? (left + right) / 2 : left + stepX * index;
      const y = bottom - ((value - min) / spread) * chartHeight;
      svgHtml += `
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="${series.color}">
          <title>${series.label}: ${qosFormat(value, decimals)} ${series.unit}</title>
        </circle>
      `;
    });

    const firstLabel = formatSensorTime(chartPoints[0]?.time);
    const lastLabel = formatSensorTime(chartPoints[chartPoints.length - 1]?.time);

    svgHtml += `
      <text x="${left}" y="12" fill="#81c784" font-size="10" font-weight="700">${qosFormat(max, decimals)}</text>
      <text x="${left}" y="158" fill="#81c784" font-size="10" font-weight="700">${qosFormat(min, decimals)}</text>
      <text x="${left}" y="176" fill="#81c784" font-size="10">${escapeHtml(firstLabel)}</text>
      <text x="${right}" y="176" fill="#81c784" font-size="10" text-anchor="end">${escapeHtml(lastLabel)}</text>
    `;

    return `
      <div class="qos-mini-chart">
        <div class="qos-mini-chart-header">
          <h4 class="qos-mini-chart-title">${escapeHtml(series.label)}</h4>
          <span class="qos-mini-chart-value" style="color:${series.color}">
            ${qosFormat(latestValue, decimals)} ${series.unit}
          </span>
        </div>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafik ${escapeHtml(series.label)}">
          ${svgHtml}
        </svg>
      </div>
    `;
  }).join("");
}

function renderQoSAlerts(point, shouldNotify = true) {
  const container = document.getElementById("alertContainer");
  if (!container || !point) return;

  if (!shouldNotify) {
    container.innerHTML = `
      <div class="qos-alert-item">
        Data QoS belum diperbarui. Jalankan monitoring jaringan untuk melihat peringatan terbaru.
      </div>
    `;
    qosActiveAlertKeys = new Set();
    saveQosActiveAlertKeys();
    return;
  }

  const alerts = getQoSAlerts(point);

  if (!alerts.length) {
    container.innerHTML = "<p>No alerts</p>";
    return;
  }

  notifyQoSAlerts(alerts);
  container.innerHTML = alerts.map((alert) => `<div class="qos-alert-item">${escapeHtml(alert.message)}</div>`).join("");
}

function getQoSAnomalies() {
  const anomalies = [];

  qosPoints.forEach((point) => {
    qosAnomalyRules.forEach((rule) => {
      if (!hasQosValue(point[rule.key])) return;

      const value = Number(point[rule.key]);
      if (!rule.isAnomaly(value)) return;

      anomalies.push({
        time: point.time,
        label: rule.label,
        value,
        unit: rule.unit,
        decimals: rule.decimals,
        threshold: qosThresholdText(rule)
      });
    });
  });

  return anomalies.slice(-QOS_ANOMALY_LIMIT).reverse();
}

function renderQoSAnomalyLog() {
  const tableBody = document.getElementById("qosAnomalyTableBody");
  const countEl = document.getElementById("qosAnomalyCount");
  if (!tableBody) return;

  const anomalies = getQoSAnomalies();
  if (countEl) countEl.textContent = `${anomalies.length} anomali`;

  if (!anomalies.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" class="qos-log-empty">Belum ada anomali</td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = anomalies.map((item) => `
    <tr>
      <td>${escapeHtml(formatSensorTime(item.time))}</td>
      <td>${escapeHtml(item.label)}</td>
      <td>${escapeHtml(item.value.toFixed(item.decimals))} ${escapeHtml(item.unit)}</td>
      <td>${escapeHtml(item.threshold)}</td>
      <td><span class="qos-log-badge">Anomali</span></td>
    </tr>
  `).join("");
}

function applyQoSRecords(records, sourceLabel) {
  const validRecords = records.filter((point) =>
    qosSeriesConfig.some((series) => Number.isFinite(Number(point[series.key])))
  );

  if (!validRecords.length) return false;

  qosPoints = validRecords.slice(-24);
  const latest = qosPoints[qosPoints.length - 1];
  const latestIsFresh = isQoSPointFresh(latest);
  const sourceEl = document.getElementById("qosDataSource");

  if (sourceEl) {
    sourceEl.textContent = latestIsFresh
      ? `Sumber data: ${sourceLabel}`
      : `Sumber data: ${sourceLabel} (data lama, monitoring belum berjalan)`;
  }

  updateQoSCards(latest, latestIsFresh);
  renderQoSChart();
  renderQoSAlerts(latest, latestIsFresh);
  renderQoSAnomalyLog();
  return true;
}

async function loadQoSFromKnownPaths() {
  let bestRecords = [];
  let bestPath = "";

  for (const path of QOS_AUTO_PATHS) {
    try {
      const response = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) continue;

      const payload = await response.json();
      const records = extractQoSRecords(payload, path);
      const validCount = records.filter((point) =>
        qosSeriesConfig.some((series) => Number.isFinite(Number(point[series.key])))
      ).length;

      if (validCount > bestRecords.length) {
        bestRecords = records;
        bestPath = path;
      }
    } catch {
      continue;
    }
  }

  if (bestRecords.length && applyQoSRecords(bestRecords, bestPath)) return true;

  setStatusText("piStatus", "JSON QoS belum ditemukan", false);
  setStatusText("piUptime", "--", false);
  setStatusText("gcpStatus", "Unknown", false);
  setStatusText("dhtStatus", "Unknown", false);
  setNetworkStatus("offline");
  return false;
}

document.addEventListener("DOMContentLoaded", () => {
  loadNotifications();
  renderNotifications();
  fetchFirebaseNotifications();
  renderQoSChart();
  loadQoSFromKnownPaths();
  setInterval(() => {
    loadQoSFromKnownPaths();
  }, 15000);
  setInterval(fetchFirebaseNotifications, 15000);

  document.getElementById("notifBellBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    requestBrowserNotificationPermission();
    toggleNotifPanel();
  });

  document
    .getElementById("closeNotifPanel")
    ?.addEventListener("click", closeNotifPanel);

  document
    .getElementById("markAllReadBtn")
    ?.addEventListener("click", markAllNotificationsRead);

  document.getElementById("notifPanel")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.addEventListener("click", closeNotifPanel);

  if (window.lucide) window.lucide.createIcons();
});
