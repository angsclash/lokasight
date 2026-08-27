// js/dashboard.js
console.log("dashboard.js LOKASIGHT - DISEASE + PEST HISTORY aktif");

// =========================
// LOGIN GUARD
// =========================
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

// =========================
// FIREBASE CONFIG
// =========================
const FIREBASE_DB_URL =
  "https://lokasight-90e41-default-rtdb.asia-southeast1.firebasedatabase.app/";


// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDYgLkk1l9efI1DKlAvEr48hOQ9h82Qazw",
  authDomain: "lokasight-90e41.firebaseapp.com",
  databaseURL: "https://lokasight-90e41-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "lokasight-90e41",
  storageBucket: "lokasight-90e41.firebasestorage.app",
  messagingSenderId: "929262769346",
  appId: "1:929262769346:web:a77154fa158e52b095975b",
  measurementId: "G-ER48LY4V6Q"
};


let firebaseAuth = null;

if (typeof firebase !== "undefined") {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  firebaseAuth = firebase.auth();
} else {
  console.error(
    "Firebase SDK belum dimuat. Pastikan firebase-app-compat.js dan firebase-auth-compat.js sudah dipanggil sebelum dashboard.js"
  );
}

const SENSOR_LATEST_URL = `${FIREBASE_DB_URL}/sensor/dht22/latest.json`;
const SENSOR_HISTORY_URL = `${FIREBASE_DB_URL}/sensor/dht22/history.json`;
const CAMERA_CAPTURES_URL = `${FIREBASE_DB_URL}/camera_captures.json`;
const CAMERA_CAPTURE_GROUPS = ["mobile", "depan", "belakang"];

const DISEASE_HISTORY_URL = `${FIREBASE_DB_URL}/inference_result/disease.json`;
const PEST_HISTORY_URL = `${FIREBASE_DB_URL}/inference_result/pest.json`;
const FIREBASE_NOTIFICATIONS_URL = `${FIREBASE_DB_URL}/notifications.json`;

const SENSOR_HISTORY_LIMIT = 20;
const CAMERA_LIVE_LIMIT = 2;
const CAMERA_HISTORY_LIMIT = 100;
const INFERENCE_LIVE_LIMIT = 12;
const INFERENCE_HISTORY_LIMIT = 100;
const HISTORY_PAGE_SIZE = 9;
const HEAVY_FIREBASE_POLL_INTERVAL_MS = 60000;

// =========================
// LOCAL FAILOVER CONFIG
// =========================
const LOCAL_LATEST_INFERENCE_URL = "data/latest.json";
const LOCAL_HISTORY_INFERENCE_URL = "data/history.json";
const PENDING_CAMERA_INDEX_URL = "cctv_capture/pending/index.json";

// =========================
// LOCAL STORAGE KEYS
// =========================
const SHOWN_NOTIF_KEY = "shownNotificationKeys";
const NOTIFICATION_CACHE_KEY = "dashboardNotifications";
const HANDLED_LOCAL_KEY = "handledLocalInference";
const DETECTION_NOTIF_CURSOR_KEY = "detectionNotificationSeenUntilMs";
const READ_NOTIF_KEY = "readNotificationKeys";

// =========================
// GLOBAL DATA
// =========================
let cameraShots = [];
let firebaseCameraShots = [];

let brokenCameraImageUrls = new Set(
  JSON.parse(localStorage.getItem("brokenCameraImageUrls") || "[]")
);

let diseaseItems = [];
let firebaseDiseaseItems = [];
let cameraHistoryPage = 1;
let cameraHistoryPages = [];
let cameraHistoryLoading = false;
let diseaseHistoryPage = 1;
let diseaseHistoryPages = [];
let diseaseHistoryLoading = false;
let activeDiseaseHistoryCategory = "disease";

let activeDiseaseAlert = {
  id: null,
  firebase_key: null,
  category: "disease",
  title: "Belum ada deteksi",
  time: "-",
  description: "Belum ada data hasil inference.",
  solution: "Jalankan proses capture dan inference terlebih dahulu.",
  confidence: 0,
  image: "assets/img/disease-preview.svg",
  handled: false,
  status: "unhandled",
  sync_status: null,
  display_source: null
};

let notifications = [
  {
    id: "dashboard-ready",
    title: "Local Dashboard Ready",
    message: "Dashboard lokal siap membaca data dari Raspberry Pi.",
    time: "Now",
    level: "low",
    icon: "leaf",
    iconColor: "#4caf50",
    unread: true
  }
];

// =========================
// SENSOR CONFIG
// =========================
const TEMP_LOW_LIMIT = 25;
const TEMP_HIGH_LIMIT = 28;
const HUMIDITY_LOW_LIMIT = 65;
const HUMIDITY_HIGH_LIMIT = 78;
const SENSOR_NOTIFICATION_MAX_AGE_MS = 10 * 60 * 1000;
const MAX_POINTS = 10;

let currentTemperature = NaN;
let currentHumidity = NaN;
let firebaseStatus = "offline";
let latestSensorTimestampMs = 0;
let cloudRetryAfterMs = 0;
let systemStatusCycleTimer = null;
let systemStatusCycleIndex = 0;
const loggedCameraE2EKeys = new Set();
const loggedDhtE2EKeys = new Set();
let dhtE2ELogReady = false;

let realtimeTempPoints = [];
let realtimeHumidityPoints = [];
let activeSensorChart = "temperature";

let shownNotificationKeys = new Set(
  JSON.parse(localStorage.getItem(SHOWN_NOTIF_KEY) || "[]")
);

let readNotificationKeys = new Set(
  JSON.parse(localStorage.getItem(READ_NOTIF_KEY) || "[]")
);

// =========================
// CAMERA CONFIG
// =========================
let camIndex = 0;

const cameraTabs = [
  {
    type: "mobile",
    title: "Mobile"
  },
  {
    type: "depan",
    title: "Depan"
  },
  {
    type: "belakang",
    title: "Belakang"
  }
];

// =========================
// STORAGE HELPERS
// =========================
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
    console.log("Cache notifikasi rusak, pakai default.");
  }
}

function saveCache(data) {
  localStorage.setItem("lastSensorData", JSON.stringify(data));
}

function loadCache() {
  const c = localStorage.getItem("lastSensorData");
  return c ? JSON.parse(c) : null;
}

function saveTempHistory() {
  localStorage.setItem("tempHistory", JSON.stringify(realtimeTempPoints));
}

function loadTempHistory() {
  const c = localStorage.getItem("tempHistory");
  return c ? JSON.parse(c) : [];
}

function saveHumidityHistory() {
  localStorage.setItem(
    "humidityHistory",
    JSON.stringify(realtimeHumidityPoints)
  );
}

function loadHumidityHistory() {
  const c = localStorage.getItem("humidityHistory");
  return c ? JSON.parse(c) : [];
}

function loadHandledLocalMap() {
  try {
    return JSON.parse(localStorage.getItem(HANDLED_LOCAL_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveHandledLocalMap(map) {
  localStorage.setItem(HANDLED_LOCAL_KEY, JSON.stringify(map));
}

function getHandledStorageKeys(item) {
  return [
    item?.id,
    item?.firebase_key,
    item?.raw?.id?.request_id,
    item?.raw?.request_id
  ].filter(Boolean);
}

function getFirebaseHandledStatus(value) {
  const status = value?.status;

  return (
    value?.handled === true ||
    status === "handled" ||
    status?.handled === true ||
    status?.status === "handled"
  );
}

function hasFirebaseHandledSignal(value) {
  const status = value?.status;

  return (
    typeof value?.handled === "boolean" ||
    typeof status === "string" ||
    typeof status?.handled === "boolean" ||
    typeof status?.status === "string"
  );
}

function getFirebaseHandledAt(value) {
  const status = value?.status;
  return status?.handled_at || value?.handled_at || null;
}

function syncHandledMapFromFirebase(items = []) {
  const localHandled = loadHandledLocalMap();
  let changed = false;

  items.forEach((item) => {
    if (!item || !isCloudItem(item)) return;

    const handled = getFirebaseHandledStatus(item.raw || item);
    const handledAt = getFirebaseHandledAt(item.raw || item) || item.handled_at || new Date().toISOString();
    const keys = getHandledStorageKeys(item);

    keys.forEach((key) => {
      if (!key) return;

      if (handled) {
        localHandled[key] = {
          handled: true,
          status: "handled",
          handled_at: handledAt,
          title: item.title || "Unknown Detection",
          source: item.display_source || item.sync_status || "firebase",
          category: item.category || "disease"
        };
        changed = true;
      } else if (hasFirebaseHandledSignal(item.raw || item)) {
        delete localHandled[key];
        changed = true;
      }
    });
  });

  if (changed) saveHandledLocalMap(localHandled);
}

function saveBrokenCameraImages() {
  localStorage.setItem(
    "brokenCameraImageUrls",
    JSON.stringify(Array.from(brokenCameraImageUrls))
  );
}

function retryFreshCameraImages(items = []) {
  let changed = false;

  items.forEach((item) => {
    if (!item?.image) return;
    if (!brokenCameraImageUrls.has(item.image)) return;

    brokenCameraImageUrls.delete(item.image);
    changed = true;
  });

  if (changed) saveBrokenCameraImages();
}

function markCameraImageBroken(url) {
  if (!url) return;

  brokenCameraImageUrls.add(url);
  saveBrokenCameraImages();

  cameraShots = cameraShots.filter((item) => item.image !== url);
  localStorage.setItem("cameraShots", JSON.stringify(cameraShots));
}

// =========================
// TEXT HELPERS
// =========================
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDisplayName(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTitleCase(value) {
  return formatDisplayName(value).replace(/\w\S*/g, (word) => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function shouldShowInDiseaseHistory(item) {
  if (!item) return false;

  const confidence = normalizeConfidence(item.confidence);
  if (confidence <= 0) return false;

  const title = String(item.title || "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim();

  const category = String(item.category || item.type || "")
    .toLowerCase()
    .trim();

  const invalidKeywords = [
    "healthy",
    "sehat",
    "normal",
    "unknown",
    "unknown disease",
    "unknown pest",
    "no detection",
    "no detections",
    "tidak terdeteksi",
    "none"
  ];

  if (category === "healthy" || category === "sehat") return false;

  return !invalidKeywords.some((keyword) => title.includes(keyword));
}

function normalizeHistoryKey(value) {
  return String(value || "").split("?")[0].trim().toLowerCase();
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function asPrimitiveText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function getRecordStatusData(value = {}) {
  const status = value?.status;
  return status && typeof status === "object" ? status : {};
}

function getCameraImageUrl(value = {}) {
  const imageInfo = asObject(value?.image_info);
  return (
    imageInfo.image_url ||
    value?.image ||
    value?.image_url ||
    value?.url ||
    value?.download_url ||
    value?.firebase_url ||
    ""
  );
}

function getCameraFilenameTime(value = {}) {
  const filename = asPrimitiveText(value?.filename || value?.id?.filename || value?.capture_id);
  const match = filename.match(/^(\d{8}_\d{6})/);
  return match ? match[1] : "";
}

function getCameraRawTime(value = {}) {
  const timeInfo = asObject(value?.time_info);
  const uploadDuration = asObject(value?.upload_duration);

  return (
    asPrimitiveText(timeInfo.display) ||
    asPrimitiveText(timeInfo.uploaded_at_iso) ||
    asPrimitiveText(timeInfo.uploaded_at) ||
    asPrimitiveText(value?.captured_at_iso) ||
    asPrimitiveText(value?.capture_time_iso) ||
    asPrimitiveText(uploadDuration.send_started_at_iso) ||
    asPrimitiveText(value?.time) ||
    asPrimitiveText(value?.timestamp) ||
    asPrimitiveText(value?.timestamp_iso) ||
    asPrimitiveText(value?.created_at_iso) ||
    asPrimitiveText(value?.created_at) ||
    asPrimitiveText(value?.uploaded_time) ||
    asPrimitiveText(value?.uploaded_at_iso) ||
    asPrimitiveText(value?.uploaded_at) ||
    getCameraFilenameTime(value) ||
    "-"
  );
}

function getCameraUploadedAtMs(value = {}) {
  const timeInfo = asObject(value?.time_info);
  const uploadDuration = asObject(value?.upload_duration);

  return getTimestampCandidateMs(
    timeInfo.uploaded_at,
    timeInfo.uploaded_at_ms,
    timeInfo.uploaded_at_iso,
    value?.uploaded_at,
    value?.uploaded_at_ms,
    value?.firebase_uploaded_at_ms,
    value?.uploaded_at_iso,
    value?.firebase_uploaded_at_iso,
    uploadDuration.send_finished_at_iso,
    value?.uploaded_time,
    value?.created_at_ms,
    value?.timestamp_ms,
    value?.time_ms
  );
}

function getCameraLabel(value = {}) {
  const sourceInfo = asObject(value?.source_info);
  const filename = asPrimitiveText(value?.filename || value?.id?.filename || value?.capture_id);
  const filenameParts = filename.replace(/\.[^.]+$/, "").split("_").filter(Boolean);
  const filenameLabel =
    filenameParts.length >= 4
      ? `${filenameParts[2]} ${filenameParts[3]}`
      : "";

  return (
    asPrimitiveText(sourceInfo.label) ||
    asPrimitiveText(value?.label) ||
    asPrimitiveText(value?.point) ||
    asPrimitiveText(value?.titik) ||
    filenameLabel ||
    asPrimitiveText(sourceInfo.source) ||
    asPrimitiveText(value?.source)
  );
}

function getCameraSource(value = {}) {
  const sourceInfo = asObject(value?.source_info);
  return asPrimitiveText(sourceInfo.source) || asPrimitiveText(value?.source);
}

function getCameraStoragePath(value = {}) {
  const imageInfo = asObject(value?.image_info);
  return imageInfo.storage_path || value?.storage_path || "";
}

function formatCameraTime(rawTime) {
  const date = parseLokasightTime(rawTime);
  if (!date) return asPrimitiveText(rawTime) || "-";

  const dateLabel = new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);

  return `${dateLabel} - ${timeLabel} WIB`;
}

function getInferenceImageUrl(value = {}, data = {}) {
  const imageData = asObject(value?.image);
  const legacyImage = typeof value?.image === "string" ? value.image : "";

  return (
    imageData.annotated_image_url ||
    imageData.image_url ||
    imageData.input_image_url ||
    value?.annotated_image_url ||
    value?.image_url ||
    legacyImage ||
    value?.url ||
    value?.firebase_url ||
    value?.download_url ||
    data?.annotated_image_url ||
    data?.image_url ||
    data?.image ||
    ""
  );
}

function getDiseaseDedupeKeys(item) {
  const raw = item?.raw || {};
  const imageData = raw?.image || {};

  return [
    item?.id,
    item?.firebase_key,
    raw?.id?.request_id,
    raw?.request_id,
    item?.image,
    raw?.annotated_image_url,
    raw?.image_url,
    raw?.input_image_url,
    raw?.result_json_url,
    imageData?.annotated_image_url,
    imageData?.image_url,
    imageData?.input_image_url,
    imageData?.result_json_url
  ]
    .map(normalizeHistoryKey)
    .filter(Boolean);
}

function mergeDuplicateDiseaseItem(oldItem = {}, newItem = {}) {
  const oldIsCloud = isCloudItem(oldItem);
  const newIsCloud = isCloudItem(newItem);
  const preferNew =
    (newIsCloud && !oldIsCloud) ||
    (newIsCloud === oldIsCloud &&
      getDetectionTimestampMs(newItem) >= getDetectionTimestampMs(oldItem));

  const cloudItem = newIsCloud ? newItem : oldIsCloud ? oldItem : null;
  const handled = cloudItem
    ? hasFirebaseHandledSignal(cloudItem.raw || cloudItem)
      ? getFirebaseHandledStatus(cloudItem.raw || cloudItem)
      : getItemHandledStatus(newItem) || getItemHandledStatus(oldItem)
    : getItemHandledStatus(newItem) || getItemHandledStatus(oldItem);
  const merged = preferNew ? { ...oldItem, ...newItem } : { ...newItem, ...oldItem };

  return {
    ...merged,
    handled: handled,
    status: handled ? "handled" : merged.status || "unhandled",
    handled_at:
      getFirebaseHandledAt(cloudItem?.raw || cloudItem) ||
      newItem.handled_at ||
      oldItem.handled_at ||
      null
  };
}

function dedupeDiseaseHistoryItems(items = []) {
  const mergedItems = [];
  const keyToIndex = new Map();

  items.forEach((item) => {
    if (!item || !item.id) return;

    const keys = getDiseaseDedupeKeys(item);
    const existingIndex = keys.find((key) => keyToIndex.has(key));

    if (existingIndex) {
      const index = keyToIndex.get(existingIndex);
      mergedItems[index] = mergeDuplicateDiseaseItem(mergedItems[index], item);
      getDiseaseDedupeKeys(mergedItems[index]).forEach((key) => {
        keyToIndex.set(key, index);
      });
      return;
    }

    const index = mergedItems.length;
    mergedItems.push(item);
    keys.forEach((key) => {
      keyToIndex.set(key, index);
    });
  });

  return mergedItems;
}

function cleanDiseaseHistoryItems(items = []) {
  const sourceItems = Array.isArray(items) ? items : [];
  const cleaned = sortDetectionsNewestFirst(
    dedupeDiseaseHistoryItems(sourceItems.filter(shouldShowInDiseaseHistory))
  ).slice(0, INFERENCE_HISTORY_LIMIT);

  if (cleaned.length !== sourceItems.length) {
    localStorage.setItem("diseaseItems", JSON.stringify(cleaned));
  }

  return cleaned;
}

// =========================
// TIME HELPERS - WIB
// =========================
const WIB_TIMEZONE = "Asia/Jakarta";

function parseLokasightTime(tsString) {
  if (!tsString) return null;

  const raw = String(tsString).trim();

  if (/^\d+$/.test(raw)) {
    const num = Number(raw);

    if (num > 1000000000000) return new Date(num);
    if (num > 1000000000) return new Date(num * 1000);
  }

  // Format: 20260513_012300
  // Ini dianggap sudah WIB/local time, bukan UTC.
  const compactMatch = raw.match(
    /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/
  );

  if (compactMatch) {
    const [, y, mo, d, h, mi, s] = compactMatch;

    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s)
    );
  }

  // Format: 2026-05-13 01:23:00
  // Ini juga dianggap sudah WIB/local time, bukan UTC.
  const mysqlLikeMatch = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
  );

  if (mysqlLikeMatch) {
    const [, y, mo, d, h, mi, s = "0"] = mysqlLikeMatch;

    return new Date(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s)
    );
  }

  const clean = raw.replace(/\.(\d{3})\d*/, ".$1");
  const date = new Date(clean);

  if (isNaN(date.getTime())) return null;
  return date;
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

  if (dateParts === nowParts) {
    return `${timeOnly} WIB`;
  }

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

function getTimestampCandidateMs(...values) {
  for (const value of values) {
    if (value && typeof value === "object") {
      const nested = getTimestampCandidateMs(
        value.time_info,
        value.created_at_ms,
        value.timestamp_ms,
        value.uploaded_at_ms,
        value.uploaded_at_iso,
        value.created_at_iso,
        value.timestamp_iso,
        value.created_at,
        value.timestamp,
        value.uploaded_at,
        value.time
      );

      if (nested > 0) return nested;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      if (numeric > 1000000000000) return numeric;
      if (numeric > 1000000000) return numeric * 1000;
    }

    const parsed = parseLokasightTime(value);
    if (parsed) return parsed.getTime();
  }

  return 0;
}

function formatDurationMs(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return "-";

  const roundedMs = Math.round(durationMs);
  const seconds = roundedMs / 1000;
  if (seconds < 60) return `${roundedMs} ms (${seconds.toFixed(3)} detik)`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${roundedMs} ms (${minutes} menit ${remainingSeconds.toFixed(3)} detik)`;
}

function formatE2ETimeMs(timestampMs) {
  const date = new Date(Number(timestampMs));
  if (isNaN(date.getTime())) return "-";

  const base = new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
  const milliseconds = String(date.getMilliseconds()).padStart(3, "0");

  return `${base}.${milliseconds} WIB`;
}

function getCurrentTimestampMs(rawTime) {
  if (rawTime && typeof rawTime === "object") {
    return getTimestampCandidateMs(rawTime);
  }

  const parsed = parseLokasightTime(rawTime);
  return parsed ? parsed.getTime() : 0;
}

function getDetectionTimestampMs(item) {
  const candidates = [
    item?.timestamp_ms,
    item?.uploaded_at_ms,
    item?.created_at_ms,
    item?.rawTime,
    item?.created_at_iso,
    item?.timestamp,
    item?.created_at,
    item?.uploaded_at,
    item?.time,
    item?.raw?.created_at_iso,
    item?.raw?.timestamp_iso,
    item?.raw?.created_at_ms,
    item?.raw?.timestamp_ms,
    item?.raw?.timestamp,
    item?.raw?.created_at,
    item?.raw?.uploaded_at,
    item?.raw?.time
  ];

  for (const candidate of candidates) {
    const ts = getCurrentTimestampMs(candidate);
    if (ts > 0) return ts;
  }

  return 0;
}

function sortDetectionsNewestFirst(items) {
  return [...items].sort((a, b) => getDetectionTimestampMs(b) - getDetectionTimestampMs(a));
}

function getLatestDetectionItem(items) {
  const sorted = sortDetectionsNewestFirst(items || []);
  return sorted.find((item) => !getItemHandledStatus(item)) || null;
}

function getDetectionNotificationCursorMs() {
  return Number(localStorage.getItem(DETECTION_NOTIF_CURSOR_KEY) || 0);
}

function saveDetectionNotificationCursorMs(timestampMs) {
  const current = getDetectionNotificationCursorMs();
  const next = Number(timestampMs) || 0;

  if (next > current) {
    localStorage.setItem(DETECTION_NOTIF_CURSOR_KEY, String(next));
  }
}

function initializeDetectionNotificationCursor() {
  if (localStorage.getItem(DETECTION_NOTIF_CURSOR_KEY)) return;

  saveDetectionNotificationCursorMs(Date.now());
}

function markDetectionsSeenForNotifications(items = []) {
  const timestamps = (Array.isArray(items) ? items : [])
    .map(getDetectionTimestampMs)
    .filter((timestampMs) => timestampMs > 0);

  if (!timestamps.length) return;

  saveDetectionNotificationCursorMs(Math.max(...timestamps));
}

function shouldNotifyDetectionItem(item) {
  if (!item || getItemHandledStatus(item)) return false;

  const timestampMs = getDetectionTimestampMs(item);
  if (timestampMs <= 0) return false;

  return timestampMs > getDetectionNotificationCursorMs();
}

// =========================
// CONFIDENCE HELPERS
// =========================
function getSafeConfidence(confidence) {
  const value = Number(confidence) || 0;
  return Math.min(Math.max(value, 0), 100);
}

function normalizeConfidence(confidence) {
  let value = Number(confidence) || 0;

  if (value > 0 && value <= 1) {
    value = value * 100;
  }

  return getSafeConfidence(value);
}

function getConfidenceBarColor(confidence) {
  const value = Number(confidence) || 0;

  if (value >= 80) return "#4caf50";
  if (value >= 50) return "#ff9800";
  return "#f44336";
}

function getSeverityFromConfidence(confidence) {
  const value = normalizeConfidence(confidence);

  if (value >= 80) return "High";
  if (value >= 50) return "Medium";
  return "Low";
}

// =========================
// DATA SOURCE HELPERS
// =========================
function isLocalItem(item) {
  const source = String(
    item?.display_source || item?.sync_status || ""
  ).toLowerCase();

  return (
    source.includes("local") ||
    source.includes("pending") ||
    source.includes("pi_local_cache") ||
    source.includes("local_failover")
  );
}

function isCloudItem(item) {
  return !isLocalItem(item) && Boolean(item?.id);
}

function isMobileSourceText(text) {
  const normalized = normalizeCameraText(text);

  return (
    normalized.includes("mobile") ||
    normalized.includes("handphone") ||
    normalized.includes("hp")
  );
}

function resolveCameraTypeFromText(text) {
  const normalized = normalizeCameraText(text);

  if (isMobileSourceText(normalized)) return "mobile";

  if (
    normalized.includes("depan") ||
    normalized.includes("front") ||
    normalized.includes("kamera depan") ||
    normalized.includes("camera depan") ||
    normalized.includes("titik depan")
  ) {
    return "depan";
  }

  if (
    normalized.includes("belakang") ||
    normalized.includes("back") ||
    normalized.includes("rear") ||
    normalized.includes("kamera belakang") ||
    normalized.includes("camera belakang") ||
    normalized.includes("titik belakang")
  ) {
    return "belakang";
  }

  return null;
}

function isPendingLocalItem(item) {
  const status = String(item?.sync_status || item?.status || "").toLowerCase();
  return (
    status.includes("pending") ||
    status.includes("unsynced") ||
    status.includes("failed")
  );
}

function mapPendingInferenceToCameraShot(item, index = 0) {
  if (!item || !isPendingLocalItem(item)) return null;

  const raw = item.raw || item;
  const image =
    item.image ||
    getInferenceImageUrl(raw) ||
    raw?.local_annotated_image_path ||
    raw?.local_image_path ||
    "";

  if (!image || brokenCameraImageUrls.has(image)) return null;

  const sourceText = [
    item.source,
    item.camera,
    item.garden,
    item.label,
    item.point,
    item.title,
    item.filename,
    item.id,
    raw?.source,
    raw?.camera,
    raw?.label,
    raw?.point,
    raw?.titik,
    raw?.filename,
    raw?.file_name,
    raw?.request_id,
    image
  ]
    .map(normalizeCameraText)
    .join(" ");

  const cameraType = resolveCameraTypeFromText(sourceText);

  // Pending dari mobile tidak ditampilkan di panel kamera utama.
  if (cameraType === "mobile") return null;

  // Hanya pending kamera depan/belakang yang ditampilkan.
  if (cameraType !== "depan" && cameraType !== "belakang") return null;

  const rawTime =
    item.rawTime ||
    raw?.timestamp ||
    raw?.time ||
    raw?.created_at ||
    raw?.uploaded_at ||
    "-";

  const title = cameraType === "depan" ? "Pending - Depan" : "Pending - Belakang";

  return {
    id: `pending-${item.id || raw?.request_id || cameraType}-${index}`,
    title: title,
    label: cameraType,
    source: cameraType,
    point: cameraType,
    time: formatSensorTime(rawTime) !== "--" ? formatSensorTime(rawTime) : rawTime,
    rawTime: rawTime,
    image: image,
    uploaded_at: Number(
      raw?.uploaded_at || raw?.created_at_ms || raw?.timestamp_ms || raw?.time_ms || 0
    ),
    filename: raw?.filename || raw?.file_name || "",
    sync_status: item.sync_status || raw?.sync_status || "pending",
    display_source: item.display_source || raw?.display_source || "local_failover",
    pending: true
  };
}

function mapPendingCaptureToCameraShot(item, index = 0) {
  if (!item || typeof item !== "object") return null;

  const filename = item.filename || item.file_name || "";
  const image =
    item.image_url ||
    item.image ||
    item.local_image_path ||
    (filename ? `cctv_capture/pending/${filename}` : "");

  if (!image || brokenCameraImageUrls.has(image)) return null;

  const sourceText = [
    item.source,
    item.label,
    item.point,
    item.titik,
    filename,
    image
  ]
    .map(normalizeCameraText)
    .join(" ");

  const cameraType = resolveCameraTypeFromText(sourceText);

  if (cameraType !== "depan" && cameraType !== "belakang") return null;

  const rawTime =
    item.created_at ||
    item.uploaded_at ||
    item.timestamp ||
    item.time ||
    "-";

  return {
    id: `pending-capture-${filename || item.created_at || index}`,
    title: cameraType === "depan" ? "Pending - Depan" : "Pending - Belakang",
    label: cameraType,
    source: cameraType,
    point: cameraType,
    time: formatSensorTime(rawTime) !== "--" ? formatSensorTime(rawTime) : String(item.time || rawTime),
    rawTime,
    image,
    uploaded_at: Number(item.created_at || item.uploaded_at || item.timestamp || 0),
    filename,
    sync_status: item.sync_status || "pending",
    display_source: item.display_source || "pending_capture",
    pending: true
  };
}

function mergeCameraShotsWithPending(pendingItems = []) {
  const pendingShots = pendingItems
    .map(mapPendingInferenceToCameraShot)
    .filter(Boolean);

  if (!pendingShots.length) return;

  const merged = [];
  const seen = new Set();

  [...pendingShots, ...cameraShots].forEach((item) => {
    if (!item?.image || brokenCameraImageUrls.has(item.image)) return;

    const key = item.image || item.id;
    if (seen.has(key)) return;

    seen.add(key);
    merged.push(item);
  });

  merged.sort((a, b) => {
    if (a.pending && !b.pending) return -1;
    if (!a.pending && b.pending) return 1;

    const timeA = Number(a.uploaded_at) || getCurrentTimestampMs(a.rawTime);
    const timeB = Number(b.uploaded_at) || getCurrentTimestampMs(b.rawTime);
    return timeB - timeA;
  });

  cameraShots = merged.slice(0, CAMERA_HISTORY_LIMIT);
  localStorage.setItem("cameraShots", JSON.stringify(cameraShots));
  renderCam();
}

function mergePendingCameraShots(pendingShots = []) {
  const validPending = pendingShots
    .filter(Boolean)
    .filter((item) => item.image && !brokenCameraImageUrls.has(item.image));

  if (!validPending.length) return;

  cameraShots = mergeCameraShots(cameraShots, validPending, CAMERA_HISTORY_LIMIT);
  localStorage.setItem("cameraShots", JSON.stringify(cameraShots));
  renderCam();
  refreshCameraHistoryModalIfOpen();
}

function mergeCameraShots(oldItems = [], newItems = [], limit = CAMERA_HISTORY_LIMIT) {
  const merged = [];
  const seen = new Set();

  [...newItems, ...oldItems].forEach((item) => {
    if (!item?.image || brokenCameraImageUrls.has(item.image)) return;

    const key = item.id || item.image;
    if (seen.has(key)) return;

    seen.add(key);
    merged.push(item);
  });

  merged.sort((a, b) => {
    const timeA = Number(a.uploaded_at) || getCurrentTimestampMs(a.rawTime);
    const timeB = Number(b.uploaded_at) || getCurrentTimestampMs(b.rawTime);
    return timeB - timeA;
  });

  return merged.slice(0, limit);
}

function getCameraE2EInfo(item) {
  const raw = item?.raw || {};
  const uploadDuration = raw?.upload_duration || {};
  const capturedMs = getTimestampCandidateMs(
    item?.captured_at_ms,
    raw?.captured_at_ms,
    raw?.capture_time_ms,
    raw?.captured_at_iso,
    raw?.capture_time_iso,
    raw?.captured_at,
    raw?.capture_time,
    uploadDuration?.send_started_at_iso,
    raw?.created_at_iso,
    raw?.timestamp_iso,
    raw?.timestamp,
    item?.rawTime
  );
  const uploadedMs = getTimestampCandidateMs(
    item?.uploaded_at_ms,
    item?.uploaded_at,
    raw?.uploaded_at_ms,
    raw?.firebase_uploaded_at_ms,
    raw?.uploaded_at_iso,
    raw?.firebase_uploaded_at_iso,
    uploadDuration?.send_finished_at_iso,
    raw?.uploaded_time,
    raw?.uploaded_at,
    raw?.created_at_ms,
    raw?.timestamp_ms,
    raw?.time_ms
  );
  const displayedMs = item?.displayed_at_ms || Date.now();
  const uploadDelayMs = capturedMs && uploadedMs ? uploadedMs - capturedMs : null;
  const webDelayMs = uploadedMs ? displayedMs - uploadedMs : null;
  const totalDelayMs = capturedMs ? displayedMs - capturedMs : null;
  const gcsUploadMs = Number.isFinite(Number(uploadDuration?.gcs_upload_seconds))
    ? Math.round(Number(uploadDuration.gcs_upload_seconds) * 1000)
    : null;
  const firebaseWriteMs = Number.isFinite(Number(uploadDuration?.firebase_write_seconds))
    ? Math.round(Number(uploadDuration.firebase_write_seconds) * 1000)
    : null;
  const raspiUntilFirebaseMs = Number.isFinite(Number(uploadDuration?.total_until_firebase_seconds))
    ? Math.round(Number(uploadDuration.total_until_firebase_seconds) * 1000)
    : null;

  return {
    capturedLabel: capturedMs ? formatE2ETimeMs(capturedMs) : "-",
    uploadedLabel: uploadedMs ? formatE2ETimeMs(uploadedMs) : "-",
    displayedLabel: formatE2ETimeMs(displayedMs),
    capturedMs: capturedMs || null,
    uploadedMs: uploadedMs || null,
    displayedMs: displayedMs || null,
    uploadDelayMs: uploadDelayMs !== null ? Math.round(uploadDelayMs) : null,
    webDelayMs: webDelayMs !== null ? Math.round(webDelayMs) : null,
    totalDelayMs: totalDelayMs !== null ? Math.round(totalDelayMs) : null,
    gcsUploadMs,
    firebaseWriteMs,
    raspiUntilFirebaseMs,
    uploadDelayLabel: uploadDelayMs !== null ? formatDurationMs(uploadDelayMs) : "-",
    webDelayLabel: webDelayMs !== null ? formatDurationMs(webDelayMs) : "-",
    totalDelayLabel: totalDelayMs !== null ? formatDurationMs(totalDelayMs) : "-",
    gcsUploadLabel: gcsUploadMs !== null ? formatDurationMs(gcsUploadMs) : "-",
    firebaseWriteLabel: firebaseWriteMs !== null ? formatDurationMs(firebaseWriteMs) : "-",
    raspiUntilFirebaseLabel: raspiUntilFirebaseMs !== null ? formatDurationMs(raspiUntilFirebaseMs) : "-"
  };
}

function getCameraE2ELogKey(item) {
  return [
    item?.id,
    item?.image,
    item?.raw?.id,
    item?.raw?.request_id,
    item?.raw?.image_url,
    item?.raw?.firebase_url,
    item?.raw?.download_url
  ].filter(Boolean).join("|");
}

function logCameraE2EInfo(items = []) {
  const freshItems = items.filter((item) => {
    const key = getCameraE2ELogKey(item);
    if (!key || loggedCameraE2EKeys.has(key)) return false;

    loggedCameraE2EKeys.add(key);
    return true;
  });

  const rows = freshItems.map((item) => {
    const e2eInfo = getCameraE2EInfo(item);

    return {
      id: item.id,
      title: item.title,
      source: item.source || item.label || item.point || "-",
      captured: e2eInfo.capturedLabel,
      uploadedFirebase: e2eInfo.uploadedLabel,
      displayedWeb: e2eInfo.displayedLabel,
      gcsUploadMs: e2eInfo.gcsUploadMs,
      firebaseWriteMs: e2eInfo.firebaseWriteMs,
      raspiUntilFirebaseMs: e2eInfo.raspiUntilFirebaseMs,
      uploadDelayMs: e2eInfo.uploadDelayMs,
      webDelayMs: e2eInfo.webDelayMs,
      totalDelayMs: e2eInfo.totalDelayMs,
      gcsUpload: e2eInfo.gcsUploadLabel,
      firebaseWrite: e2eInfo.firebaseWriteLabel,
      raspiUntilFirebase: e2eInfo.raspiUntilFirebaseLabel,
      uploadDelay: e2eInfo.uploadDelayLabel,
      webDelay: e2eInfo.webDelayLabel,
      totalDelay: e2eInfo.totalDelayLabel,
      image: item.image
    };
  });

  if (rows.length) {
    console.groupCollapsed(`[E2E Kamera] ${rows.length} gambar baru`);
    console.table(rows);
    console.groupEnd();
  }
}

function markCameraE2EItemsAsSeen(items = []) {
  items.forEach((item) => {
    const key = getCameraE2ELogKey(item);
    if (key) loggedCameraE2EKeys.add(key);
  });
}

function getDhtE2ELogKey(data) {
  return [
    data?.timestamp,
    data?.timestamp_iso,
    data?.created_at,
    data?.created_at_iso,
    data?.temperature,
    data?.humidity
  ].filter((value) => value !== undefined && value !== null).join("|");
}

function getDhtE2EInfo(data) {
  const sensorMs = getTimestampCandidateMs(
    data?.sensor_at_ms,
    data?.captured_at_ms,
    data?.timestamp_ms,
    data?.time_ms,
    data?.sensor_at_iso,
    data?.captured_at_iso,
    data?.timestamp_iso,
    data?.created_at_iso,
    data?.timestamp,
    data?.created_at,
    data?.time
  );
  const uploadedMs = getTimestampCandidateMs(
    data?.uploaded_at_ms,
    data?.firebase_uploaded_at_ms,
    data?.uploaded_at_iso,
    data?.firebase_uploaded_at_iso,
    data?.uploaded_at,
    data?.synced_at,
    data?.sync_time
  );
  const displayedMs = Date.now();
  const uploadDelayMs = sensorMs && uploadedMs ? uploadedMs - sensorMs : null;
  const webDelayMs = uploadedMs ? displayedMs - uploadedMs : null;
  const totalDelayMs = sensorMs ? displayedMs - sensorMs : null;

  return {
    sensorLabel: sensorMs ? formatE2ETimeMs(sensorMs) : "-",
    uploadedLabel: uploadedMs ? formatE2ETimeMs(uploadedMs) : "-",
    displayedLabel: formatE2ETimeMs(displayedMs),
    sensorMs: sensorMs || null,
    uploadedMs: uploadedMs || null,
    displayedMs,
    uploadDelayMs: uploadDelayMs !== null ? Math.round(uploadDelayMs) : null,
    webDelayMs: webDelayMs !== null ? Math.round(webDelayMs) : null,
    totalDelayMs: totalDelayMs !== null ? Math.round(totalDelayMs) : null,
    uploadDelayLabel: uploadDelayMs !== null ? formatDurationMs(uploadDelayMs) : "-",
    webDelayLabel: webDelayMs !== null ? formatDurationMs(webDelayMs) : "-",
    totalDelayLabel: totalDelayMs !== null ? formatDurationMs(totalDelayMs) : "-"
  };
}

function logDhtE2EInfo(data) {
  if (!data) return;

  const key = getDhtE2ELogKey(data);
  if (!key || loggedDhtE2EKeys.has(key)) return;

  loggedDhtE2EKeys.add(key);

  if (!dhtE2ELogReady) {
    dhtE2ELogReady = true;
    return;
  }

  const e2eInfo = getDhtE2EInfo(data);

  console.groupCollapsed("[E2E DHT] data baru");
  console.table([
    {
      temperature: data?.temperature ?? "-",
      humidity: data?.humidity ?? "-",
      sensorTime: e2eInfo.sensorLabel,
      uploadedFirebase: e2eInfo.uploadedLabel,
      displayedWeb: e2eInfo.displayedLabel,
      uploadDelayMs: e2eInfo.uploadDelayMs,
      webDelayMs: e2eInfo.webDelayMs,
      totalDelayMs: e2eInfo.totalDelayMs,
      uploadDelay: e2eInfo.uploadDelayLabel,
      webDelay: e2eInfo.webDelayLabel,
      totalDelay: e2eInfo.totalDelayLabel
    }
  ]);
  console.groupEnd();
}

function getItemHandledStatus(item) {
  if (!item) return false;

  const localHandled = loadHandledLocalMap();
  const status = item.status;
  const handledKeys = getHandledStorageKeys(item);

  if (
    item.handled === true ||
    status === "handled" ||
    status?.handled === true ||
    status?.status === "handled" ||
    item.raw?.status?.handled === true
  ) {
    return true;
  }

  if (handledKeys.some((key) => localHandled[key]?.handled === true)) {
    return true;
  }

  if (isCloudItem(item) && hasFirebaseHandledSignal(item.raw || item)) {
    return getFirebaseHandledStatus(item.raw || item);
  }

  return false;
}

function mergeDiseaseItems(oldItems = [], newItems = []) {
  return sortDetectionsNewestFirst(
    dedupeDiseaseHistoryItems([...oldItems, ...newItems])
  ).slice(
    0,
    INFERENCE_HISTORY_LIMIT
  );
}

// =========================
// NOTIFICATION CORE
// =========================
function requestBrowserNotificationPermission() {
  if (!("Notification" in window)) return;

  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function showBrowserNotification(title, message) {
  if (!("Notification" in window)) return;

  if (Notification.permission === "granted") {
    new Notification(title, {
      body: message
    });
  }
}

function getNowTimeLabel() {
  return new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isSensorThresholdNotification(item = {}) {
  const id = String(item.id || "");
  const title = String(item.title || "").toLowerCase();

  return (
    id.startsWith("suhu-") ||
    id.startsWith("kelembaban-") ||
    title.includes("peringatan suhu") ||
    title.includes("peringatan kelembaban")
  );
}

function clearSensorThresholdNotifications() {
  const nextNotifications = notifications.filter(
    (item) => !isSensorThresholdNotification(item)
  );

  if (nextNotifications.length === notifications.length) return;

  notifications = nextNotifications;
  saveNotifications();
  renderNotifications();
}

function isFreshSensorData(data = {}) {
  const timestampMs = getCurrentTimestampMs(data?.timestamp);
  return timestampMs > 0 && Date.now() - timestampMs <= SENSOR_NOTIFICATION_MAX_AGE_MS;
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

  const alreadyExists = notifications.some((item) => item.id === id);
  if (alreadyExists) return;

  const notif = {
    id,
    title,
    message,
    time,
    level,
    icon,
    iconColor,
    unread: !readNotificationKeys.has(id)
  };

  notifications.unshift(notif);
  notifications = notifications.slice(0, 30);

  saveNotifications();
  renderNotifications();

  if (popup && !shownNotificationKeys.has(id)) {
    shownNotificationKeys.add(id);
    saveShownNotificationKeys();
    showBrowserNotification(title, message);
  }
}

function notifyDiseaseItem(item, sourceLabel = "cloud") {
  if (!item) return;
  if (!shouldNotifyDetectionItem(item)) return;

  const notifId = `detection-${sourceLabel}-${item.id || item.rawTime || item.title}`;

  addNotification({
    id: notifId,
    title: `${item.title || "Deteksi"} Terdeteksi`,
    message: `Terdeteksi dari ${item.camera || item.garden || "Camera"} dengan confidence ${item.confidence || 0}%`,
    level: Number(item.confidence) >= 80 ? "high" : "medium",
    icon: item.category === "pest" ? "bug" : "leaf",
    iconColor: "#fb8c00",
    time: item.time || getNowTimeLabel()
  });

  saveDetectionNotificationCursorMs(getDetectionTimestampMs(item));
}

// =========================
// SYSTEM STATUS
// =========================
function renderSystemStatus(label, color) {
  const textEl = document.getElementById("systemStatusText");
  const dotEl = document.getElementById("systemStatusDot");

  if (!textEl || !dotEl) return;

  textEl.className = "flex items-center gap-1.5 font-medium";
  textEl.style.color = color;
  dotEl.className = "h-2.5 w-2.5 rounded-full";
  dotEl.style.backgroundColor = color;
  textEl.lastChild.textContent = ` ${label}`;
}

function stopSystemStatusCycle() {
  if (systemStatusCycleTimer) {
    clearInterval(systemStatusCycleTimer);
    systemStatusCycleTimer = null;
  }
}

function startOfflineFailoverStatusCycle() {
  const states = [
    { label: "Offline", color: "#f44336" },
    { label: "Local Failover", color: "#ff9800" }
  ];

  const renderNext = () => {
    const state = states[systemStatusCycleIndex % states.length];
    renderSystemStatus(state.label, state.color);
    systemStatusCycleIndex += 1;
  };

  renderNext();

  if (!systemStatusCycleTimer) {
    systemStatusCycleTimer = setInterval(renderNext, 5000);
  }
}

function updateSystemStatus(status) {
  const textEl = document.getElementById("systemStatusText");
  const dotEl = document.getElementById("systemStatusDot");

  if (!textEl || !dotEl) return;

  const normalized = String(status || "offline").toLowerCase();

  if (normalized === "online") {
    stopSystemStatusCycle();
    renderSystemStatus("Online", "#4caf50");
  } else if (normalized === "warning") {
    stopSystemStatusCycle();
    renderSystemStatus("Warning", "#ff9800");
  } else if (
    normalized === "local" ||
    normalized === "local_failover" ||
    normalized === "pi_local_cache"
  ) {
    startOfflineFailoverStatusCycle();
  } else {
    stopSystemStatusCycle();
    renderSystemStatus("Offline", "#f44336");
  }
}

function updateOnlineStatus() {
  if (!navigator.onLine) {
    updateSystemStatus("offline");
    return;
  }

  loadQoSFromKnownPaths().then((found) => {
    if (!found) updateSystemStatus("offline");
  });
}

function setLocalFailoverStatusIfNeeded() {
  updateOnlineStatus();
}

function shouldSkipCloudFetch() {
  return navigator.onLine === false || Date.now() < cloudRetryAfterMs;
}

function markCloudFetchFailed() {
  cloudRetryAfterMs = Date.now() + 30000;
  setLocalFailoverStatusIfNeeded();
  loadLocalFallbackData();
}

function markCloudFetchOk() {
  cloudRetryAfterMs = 0;
}

function loadLocalFallbackData() {
  fetchLocalInferenceLatest(true);
  fetchLocalInferenceHistory(true);
  fetchPendingCameraCaptures(true);
}

function updateDhtStatus() {
  const maxAgeMs = 10000;
  const hasFreshData =
    latestSensorTimestampMs > 0 && Date.now() - latestSensorTimestampMs <= maxAgeMs;

  setQosStatusText(
    "dhtStatus",
    hasFreshData ? "Online" : "Offline",
    hasFreshData
  );
}

// =========================
// FETCH HELPERS
// =========================
async function ensureFirebaseAuth() {
  if (!firebaseAuth) {
    throw new Error(
      "Firebase Auth belum siap. Cek urutan script Firebase SDK di HTML."
    );
  }

  if (firebaseAuth.currentUser) {
    return firebaseAuth.currentUser;
  }

  const result = await firebaseAuth.signInAnonymously();
  return result.user;
}

async function getFirebaseIdToken() {
  const user = await ensureFirebaseAuth();
  return await user.getIdToken(true);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return await res.json();
}

function buildFirebaseQueryUrl(baseUrl, params) {
  const url = new URL(baseUrl);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

function buildLimitToLastUrl(baseUrl, limit) {
  return buildFirebaseQueryUrl(baseUrl, {
    orderBy: '"$key"',
    limitToLast: String(limit)
  });
}

async function patchFirebaseJson(url, body) {
  const token = await getFirebaseIdToken();

  const separator = url.includes("?") ? "&" : "?";
  const authenticatedUrl = `${url}${separator}auth=${token}`;

  const res = await fetch(authenticatedUrl, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`PATCH gagal HTTP ${res.status}: ${errorText}`);
  }

  return await res.json();
}

async function fetchLocalJson(url) {
  const res = await fetch(`${url}?ts=${Date.now()}`, {
    method: "GET",
    cache: "no-store"
  });

  if (!res.ok) {
    throw new Error(`Local HTTP ${res.status}`);
  }

  return await res.json();
}

// =========================
// SENSOR CARD
// =========================
function updateMainSensorCard(data) {
  const tempEl = document.getElementById("tempValue");
  const tempUpdatedEl = document.getElementById("tempLastUpdated");

  const humidityEl = document.getElementById("humidityValue");
  const humidityUpdatedEl = document.getElementById("humidityLastUpdated");

  const rawTemp = data?.temperature;
  const rawHumidity = data?.humidity;
  const status = (data?.status || "online").toLowerCase();

  const parsedTemp = Number(rawTemp);
  const parsedHumidity = Number(rawHumidity);

  currentTemperature = Number.isFinite(parsedTemp) ? parsedTemp : NaN;
  currentHumidity = Number.isFinite(parsedHumidity) ? parsedHumidity : NaN;
  firebaseStatus = status;
  latestSensorTimestampMs = getCurrentTimestampMs(data?.timestamp);

  if (tempEl) {
    tempEl.textContent = Number.isFinite(currentTemperature)
      ? `${currentTemperature.toFixed(1)}°C`
      : "--°C";
  }

  if (humidityEl) {
    humidityEl.textContent = Number.isFinite(currentHumidity)
      ? `${currentHumidity.toFixed(1)}%`
      : "--%";
  }

  const formattedTime = formatSensorTime(data?.timestamp);

  if (tempUpdatedEl) tempUpdatedEl.textContent = formattedTime;
  if (humidityUpdatedEl) humidityUpdatedEl.textContent = formattedTime;

  checkSensorNotifications(data);
  updateDhtStatus();
}

function checkSensorNotifications(data) {
  if (!isFreshSensorData(data)) {
    clearSensorThresholdNotifications();
    return;
  }

  const temp = Number(data?.temperature);
  const humidity = Number(data?.humidity);

  const hourKey = new Date().toISOString().slice(0, 13);

  if (Number.isFinite(temp) && temp > TEMP_HIGH_LIMIT) {
    addNotification({
      id: `suhu-tinggi-${hourKey}`,
      title: "Peringatan Suhu Tinggi",
      message: `Suhu melebihi batas ideal: ${temp.toFixed(1)}°C. Batas ideal: ${TEMP_LOW_LIMIT}–${TEMP_HIGH_LIMIT}°C.`,
      level: "high",
      icon: "thermometer",
      iconColor: "#f44336",
      time: getNowTimeLabel()
    });
  }

  if (Number.isFinite(temp) && temp < TEMP_LOW_LIMIT) {
    addNotification({
      id: `suhu-rendah-${hourKey}`,
      title: "Peringatan Suhu Rendah",
      message: `Suhu berada di bawah batas ideal: ${temp.toFixed(1)}°C. Batas ideal: ${TEMP_LOW_LIMIT}–${TEMP_HIGH_LIMIT}°C.`,
      level: "medium",
      icon: "thermometer",
      iconColor: "#2196f3",
      time: getNowTimeLabel()
    });
  }

  if (Number.isFinite(humidity) && humidity > HUMIDITY_HIGH_LIMIT) {
    addNotification({
      id: `kelembaban-tinggi-${hourKey}`,
      title: "Peringatan Kelembaban Tinggi",
      message: `Kelembaban melebihi batas ideal: ${humidity.toFixed(1)}% RH. Batas ideal: ${HUMIDITY_LOW_LIMIT}–${HUMIDITY_HIGH_LIMIT}% RH.`,
      level: "high",
      icon: "droplets",
      iconColor: "#2196f3",
      time: getNowTimeLabel()
    });
  }

  if (Number.isFinite(humidity) && humidity < HUMIDITY_LOW_LIMIT) {
    addNotification({
      id: `kelembaban-rendah-${hourKey}`,
      title: "Peringatan Kelembaban Rendah",
      message: `Kelembaban berada di bawah batas ideal: ${humidity.toFixed(1)}% RH. Batas ideal: ${HUMIDITY_LOW_LIMIT}–${HUMIDITY_HIGH_LIMIT}% RH.`,
      level: "medium",
      icon: "droplets",
      iconColor: "#ff9800",
      time: getNowTimeLabel()
    });
  }
}

// =========================
// SENSOR FETCH
// =========================
async function fetchLatestSensor() {
  if (shouldSkipCloudFetch()) {
    updateOnlineStatus();
    updateDhtStatus();
    return;
  }

  try {
    const data = await fetchJson(SENSOR_LATEST_URL);
    markCloudFetchOk();

    if (!data) {
      updateOnlineStatus();
      updateDhtStatus();
      return;
    }

    updateMainSensorCard(data);
    logDhtE2EInfo(data);
    saveCache(data);
  } catch (error) {
    console.error("Gagal membaca latest sensor:", error);
    markCloudFetchFailed();
    updateDhtStatus();
  }
}

async function fetchSensorHistory() {
  if (shouldSkipCloudFetch()) {
    updateOnlineStatus();
    return;
  }

  try {
    const data = await fetchJson(
      buildLimitToLastUrl(SENSOR_HISTORY_URL, SENSOR_HISTORY_LIMIT)
    );
    markCloudFetchOk();
    if (!data) return;

    const items = Object.values(data);

    let tempPoints = items
      .filter((item) => item.temperature !== undefined && item.timestamp)
      .map((item) => {
        const date = parseLokasightTime(item.timestamp);

        return {
          time: date
            ? new Intl.DateTimeFormat("id-ID", {
                timeZone: WIB_TIMEZONE,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
              }).format(date)
            : "--",
          temp: Number(item.temperature),
          ts: date ? date.getTime() : 0
        };
      })
      .filter((item) => Number.isFinite(item.temp) && Number.isFinite(item.ts));

    let humidityPoints = items
      .filter((item) => item.humidity !== undefined && item.timestamp)
      .map((item) => {
        const date = parseLokasightTime(item.timestamp);

        return {
          time: date
            ? new Intl.DateTimeFormat("id-ID", {
                timeZone: WIB_TIMEZONE,
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
              }).format(date)
            : "--",
          humidity: Number(item.humidity),
          ts: date ? date.getTime() : 0
        };
      })
      .filter(
        (item) => Number.isFinite(item.humidity) && Number.isFinite(item.ts)
      );

    tempPoints.sort((a, b) => a.ts - b.ts);
    humidityPoints.sort((a, b) => a.ts - b.ts);

    realtimeTempPoints = tempPoints.slice(-MAX_POINTS);
    realtimeHumidityPoints = humidityPoints.slice(-MAX_POINTS);

    saveTempHistory();
    saveHumidityHistory();

    renderSensorChart();
  } catch (error) {
    console.error("Gagal membaca history sensor:", error);
  }
}

// =========================
// CAMERA FETCH
// =========================
function mapFirebaseCameraCapture(key, value) {
  if (!value || typeof value !== "object" || key === "compression_logs") {
    return null;
  }

  const displayedAtMs = Date.now();
  const rawTime = getCameraRawTime(value);
  const capturedAtMs = getTimestampCandidateMs(
    value?.captured_at_ms,
    value?.capture_time_ms,
    value?.captured_at_iso,
    value?.capture_time_iso,
    value?.captured_at,
    value?.capture_time,
    value?.created_at_iso,
    value?.timestamp_iso,
    value?.timestamp,
    rawTime
  );
  const uploadedAtMs = getCameraUploadedAtMs(value);
  const label = getCameraLabel(value);
  const imageUrl = getCameraImageUrl(value);

  return {
    id: key,
    firebase_key: value?.firebase_key || key,
    title: label ? `Camera - ${formatTitleCase(label)}` : "Camera",
    label: label,
    source: getCameraSource(value),
    point: value?.point || value?.titik || "",
    time: formatCameraTime(rawTime),
    rawTime: rawTime,
    image: imageUrl,
    uploaded_at: uploadedAtMs || capturedAtMs || 0,
    captured_at_ms: capturedAtMs,
    uploaded_at_ms: uploadedAtMs,
    displayed_at_ms: displayedAtMs,
    filename: value?.filename || value?.id?.filename || value?.file_name || "",
    raw: value
  };
}

function buildCameraCaptureGroupUrl(group) {
  return `${FIREBASE_DB_URL}/camera_captures/${group}.json`;
}

function buildCameraHistoryPageUrl(group, cursorKey = null) {
  const params = {
    orderBy: '"time_info/uploaded_at"',
    limitToLast: String(HISTORY_PAGE_SIZE + 1)
  };

  if (cursorKey !== null && cursorKey !== undefined) {
    params.endAt = String(cursorKey);
  }

  return buildFirebaseQueryUrl(buildCameraCaptureGroupUrl(group), params);
}

function buildCameraCapturesLimitUrl(group, limit) {
  return buildFirebaseQueryUrl(buildCameraCaptureGroupUrl(group), {
    orderBy: '"time_info/uploaded_at"',
    limitToLast: String(limit)
  });
}

function flattenCameraCapturesData(data) {
  const flattened = {};

  Object.entries(data || {}).forEach(([key, value]) => {
    if (!value || typeof value !== "object" || key === "compression_logs") return;

    if (getCameraImageUrl(value)) {
      flattened[key] = value;
      return;
    }

    if (CAMERA_CAPTURE_GROUPS.includes(key)) {
      Object.entries(value || {}).forEach(([childKey, childValue]) => {
        if (childValue && typeof childValue === "object" && getCameraImageUrl(childValue)) {
          flattened[childKey] = childValue;
        }
      });
    }
  });

  return flattened;
}

async function fetchCameraCapturesByGroups(limit) {
  const results = await Promise.allSettled(
    CAMERA_CAPTURE_GROUPS.map(async (group) => {
      const [timedResult, groupResult] = await Promise.allSettled([
        fetchJson(buildCameraCapturesLimitUrl(group, limit)),
        fetchJson(`${buildCameraCaptureGroupUrl(group)}?t=${Date.now()}`)
      ]);

      return {
        timed: timedResult.status === "fulfilled" ? timedResult.value : null,
        group: groupResult.status === "fulfilled" ? groupResult.value : null
      };
    })
  );
  const merged = {};

  results.forEach((result, index) => {
    if (result.status !== "fulfilled") {
      console.warn(
        `Query camera_captures/${CAMERA_CAPTURE_GROUPS[index]} gagal.`,
        result.reason
      );
      return;
    }

    const timedData = flattenCameraCapturesData(result.value?.timed || {});
    const groupItems = getSortedCameraItemsFromFirebaseData(
      flattenCameraCapturesData(result.value?.group || {})
    ).slice(0, limit);
    const groupData = Object.fromEntries(
      groupItems.map((item) => [item.firebase_key || item.id, item.raw])
    );

    Object.assign(merged, timedData, groupData);
  });

  return merged;
}

function getCameraChunkFromFirebaseData(data, cursorKey = null) {
  const rawEntries = Object.entries(data || {})
    .filter(([key, value]) => key !== "compression_logs" && getCameraImageUrl(value))
    .sort(([keyA, valueA], [keyB, valueB]) => {
      const timeA = getCameraUploadedAtMs(valueA) || getTimestampCandidateMs(getCameraRawTime(valueA));
      const timeB = getCameraUploadedAtMs(valueB) || getTimestampCandidateMs(getCameraRawTime(valueB));

      if (timeA !== timeB) return timeA - timeB;
      return keyA.localeCompare(keyB);
    })
    .reverse();
  const entries = rawEntries
    .filter(([, value]) => getCameraUploadedAtMs(value) !== cursorKey);

  const hasMore = rawEntries.length > HISTORY_PAGE_SIZE;
  const chunkEntries = entries.slice(0, HISTORY_PAGE_SIZE);
  const items = chunkEntries
    .map(([key, value]) => mapFirebaseCameraCapture(key, value))
    .filter(Boolean)
    .filter((item) => item.image)
    .filter((item) => !brokenCameraImageUrls.has(item.image));

  return {
    items,
    cursorKey: chunkEntries.length
      ? getCameraUploadedAtMs(chunkEntries[chunkEntries.length - 1][1])
      : cursorKey,
    hasMore
  };
}

function getSortedCameraItemsFromFirebaseData(data) {
  return Object.entries(data || {})
    .filter(([key, value]) => key !== "compression_logs" && getCameraImageUrl(value))
    .map(([key, value]) => mapFirebaseCameraCapture(key, value))
    .filter(Boolean)
    .filter((item) => item.image)
    .filter((item) => !brokenCameraImageUrls.has(item.image))
    .sort((a, b) => {
      const timeA = Number(a.uploaded_at) || getCurrentTimestampMs(a.rawTime);
      const timeB = Number(b.uploaded_at) || getCurrentTimestampMs(b.rawTime);
      return timeB - timeA;
    });
}

function getCameraHistoryPageFromFirebaseData(data, page = 1) {
  const items = getSortedCameraItemsFromFirebaseData(data);
  const start = (Math.max(Number(page) || 1, 1) - 1) * HISTORY_PAGE_SIZE;
  const pageItems = items.slice(start, start + HISTORY_PAGE_SIZE);

  return {
    items: pageItems,
    cursorKey: pageItems.length ? pageItems[pageItems.length - 1].uploaded_at : null,
    hasMore: items.length > start + HISTORY_PAGE_SIZE
  };
}

async function fetchCameraCapturesData(limit) {
  const groupedData = await fetchCameraCapturesByGroups(limit);

  if (Object.keys(groupedData).length) {
    markCloudFetchOk();
    return groupedData;
  }

  console.warn("Tidak ada data kamera dari query grup. Hindari fallback penuh agar download Firebase tetap ringan.");
  return {};
}

async function fetchPendingCameraCaptures(force = false) {
  if (!force && !shouldSkipCloudFetch()) return;

  try {
    const data = await fetchLocalJson(PENDING_CAMERA_INDEX_URL);
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : [];

    const pendingShots = list
      .map(mapPendingCaptureToCameraShot)
      .filter(Boolean);

    mergePendingCameraShots(pendingShots);
    if (pendingShots.length) {
      setLocalFailoverStatusIfNeeded();
    }
  } catch (error) {
    console.error("Gagal membaca pending camera index:", error);
  }
}

async function fetchCameraHistoryPage(page = 1, reset = false) {
  if (cameraHistoryLoading) return;

  const safePage = Math.max(Number(page) || 1, 1);

  if (reset) {
    cameraHistoryPages = [];
    cameraHistoryPage = 1;
  }

  if (shouldSkipCloudFetch()) {
    cameraHistoryPage = safePage;
    setLocalFailoverStatusIfNeeded();
    renderCameraHistoryGrid();
    return;
  }

  if (cameraHistoryPages[safePage - 1]) {
    cameraHistoryPage = safePage;
    renderCameraHistoryGrid();
    return;
  }

  const previousPage = safePage > 1 ? cameraHistoryPages[safePage - 2] : null;
  if (safePage > 1 && !previousPage) {
    const fallbackShots = getCameraHistoryShots();
    if (fallbackShots.length > (safePage - 1) * HISTORY_PAGE_SIZE) {
      cameraHistoryPage = safePage;
      renderCameraHistoryGrid();
    }
    return;
  }

  cameraHistoryLoading = true;
  cameraHistoryPage = safePage;
  renderCameraHistoryGrid();

  try {
    const pageFetchLimit = Math.max(CAMERA_HISTORY_LIMIT, safePage * HISTORY_PAGE_SIZE);
    const data = await fetchCameraCapturesData(pageFetchLimit);
    const pageData = getCameraHistoryPageFromFirebaseData(data, safePage);

    cameraHistoryPages[safePage - 1] = pageData;

    if (pageData.items.length) {
      cameraShots = mergeCameraShots(cameraShots, pageData.items);
      firebaseCameraShots = mergeCameraShots(firebaseCameraShots, pageData.items);
      localStorage.setItem("cameraShots", JSON.stringify(cameraShots));
      renderCam();
    }
  } catch (error) {
    console.error("Gagal membaca halaman riwayat kamera:", error);
    markCloudFetchFailed();
    cameraHistoryPages[safePage - 1] = {
      items: [],
      cursorKey: previousPage?.cursorKey || null,
      hasMore: false,
      error: true
    };
  } finally {
    cameraHistoryLoading = false;
    renderCameraHistoryGrid();
  }
}

async function fetchCameraCaptures(historyMode = false) {
  if (!historyMode && document.visibilityState === "hidden") return;
  if (shouldSkipCloudFetch()) {
    setLocalFailoverStatusIfNeeded();
    renderCam();
    refreshCameraHistoryModalIfOpen();
    return;
  }

  try {
    const limit = historyMode ? CAMERA_HISTORY_LIMIT : CAMERA_LIVE_LIMIT;
    const data = await fetchCameraCapturesData(limit);

    if (!data) {
      cameraShots = [];
      firebaseCameraShots = [];
      camIndex = 0;
      localStorage.removeItem("cameraShots");
      renderCam();
      refreshCameraHistoryModalIfOpen();
      return;
    }

    const items = getSortedCameraItemsFromFirebaseData(data);
    retryFreshCameraImages(items);

    // Tidak cek gambar satu-satu di awal supaya dashboard tetap cepat.
    // Gambar rusak akan dibuang lewat onerror di history dan tampilan utama.
    const pendingLocalShots = cameraShots.filter((item) => item?.pending === true);

    const fetchedCameraShots = items
      .filter((item) => item.image)
      .filter((item) => !brokenCameraImageUrls.has(item.image))
      .slice(0, CAMERA_HISTORY_LIMIT);

    if (fetchedCameraShots.length) {
      cameraShots = historyMode
        ? mergeCameraShots(pendingLocalShots, fetchedCameraShots)
        : mergeCameraShots(cameraShots, fetchedCameraShots);
      firebaseCameraShots = fetchedCameraShots;
    } else if (pendingLocalShots.length) {
      cameraShots = mergeCameraShots(cameraShots, pendingLocalShots);
    } else if (historyMode) {
      cameraShots = [];
      firebaseCameraShots = [];
    }

    logCameraE2EInfo(fetchedCameraShots.slice(0, 10));

    // Saat failover, foto pending lokal tetap diprioritaskan untuk kamera depan/belakang.
    mergeCameraShotsWithPending(pendingLocalShots);

    if (camIndex >= cameraTabs.length) {
      camIndex = 0;
    }

    localStorage.setItem("cameraShots", JSON.stringify(cameraShots));
    renderCam();
    refreshCameraHistoryModalIfOpen();
  } catch (error) {
    console.error("Gagal membaca camera_captures:", error);
    markCloudFetchFailed();

    const cached = localStorage.getItem("cameraShots");
    if (cached) {
      try {
        cameraShots = JSON.parse(cached).filter((item) => {
          return item.image && !brokenCameraImageUrls.has(item.image);
        });
        firebaseCameraShots = cameraShots;
      } catch {
        cameraShots = [];
        firebaseCameraShots = [];
      }

      renderCam();
    }
  }
}

// =========================
// FIREBASE DISEASE + PEST
// =========================
function getNestedInferenceData(value, category = "disease") {
  const lowerCategory = String(category).toLowerCase();
  const prediction = value?.prediction || value;

  if (lowerCategory === "pest") {
    if (prediction?.best_detection) {
      return prediction.best_detection;
    }

    if (Array.isArray(prediction?.detections) && prediction.detections.length > 0) {
      const sorted = [...prediction.detections].sort(
        (a, b) => Number(b?.confidence || 0) - Number(a?.confidence || 0)
      );

      return sorted[0];
    }

    if (Array.isArray(value?.pest) && value.pest.length > 0) {
      const sorted = [...value.pest].sort(
        (a, b) => Number(b?.confidence || 0) - Number(a?.confidence || 0)
      );

      return sorted[0];
    }

    const summaryText = [
      value?.recommendation?.summary,
      value?.recommendation_detail?.summary,
      value?.pest_recommendation?.summary,
      typeof value?.recommendation === "string" ? value.recommendation : ""
    ].filter(Boolean).join(" ");
    const summaryMatch = summaryText.match(/(?:hama terdeteksi pada citra|terdeteksi)\s*:\s*([^.,]+)/i);

    if (summaryMatch) {
      return {
        class_name: summaryMatch[1].trim(),
        confidence: 1,
        description: summaryText
      };
    }

    return value?.pest || value;
  }

  return value?.disease || prediction || value;
}

function getRecommendationText(value, data) {
  if (typeof value?.recommendation === "string") {
    return value.recommendation;
  }

  if (Array.isArray(value?.recommendation?.recommended_actions)) {
    return value.recommendation.recommended_actions.join(" ");
  }

  if (Array.isArray(value?.recommendation?.actions)) {
    return value.recommendation.actions.join(" ");
  }

  if (typeof data?.recommendation === "string") {
    return data.recommendation;
  }

  if (Array.isArray(data?.recommendation?.recommended_actions)) {
    return data.recommendation.recommended_actions.join(" ");
  }

  if (Array.isArray(data?.recommendation?.actions)) {
    return data.recommendation.actions.join(" ");
  }

  if (typeof value?.disease_recommendation === "string") {
    return value.disease_recommendation;
  }

  if (Array.isArray(value?.disease_recommendation?.recommended_actions)) {
    return value.disease_recommendation.recommended_actions.join(" ");
  }

  if (typeof value?.pest_recommendation === "string") {
    return value.pest_recommendation;
  }

  if (Array.isArray(value?.pest_recommendation?.recommended_actions)) {
    return value.pest_recommendation.recommended_actions.join(" ");
  }

  if (Array.isArray(value?.recommendation_detail?.recommended_actions)) {
    return value.recommendation_detail.recommended_actions.join(" ");
  }

  if (Array.isArray(value?.recommendation_detail?.actions)) {
    return value.recommendation_detail.actions.join(" ");
  }

  if (typeof value?.recommendation_detail?.summary === "string") {
    return value.recommendation_detail.summary;
  }

  return "";
}

function getNumberValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;

    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }

  return null;
}

function getInferenceEnvironment(value = {}) {
  const environment = asObject(value?.environment);
  const sensor = asObject(value?.sensor);
  const dht = asObject(value?.dht);
  const sourceData = environment.available === false ? {} : environment;

  const temperature = getNumberValue(
    sourceData.temperature,
    sourceData.temp,
    sourceData.suhu,
    sensor.temperature,
    sensor.temp,
    dht.temperature,
    value?.temperature,
    value?.temp
  );
  const humidity = getNumberValue(
    sourceData.humidity,
    sourceData.hum,
    sourceData.kelembaban,
    sensor.humidity,
    sensor.hum,
    dht.humidity,
    value?.humidity,
    value?.hum
  );
  const sensorTimestampMs = getTimestampCandidateMs(
    sourceData.sensor_timestamp_ms,
    sourceData.sensor_timestamp,
    sourceData.timestamp_ms,
    sourceData.timestamp,
    sensor.timestamp_ms,
    sensor.timestamp,
    dht.timestamp_ms,
    dht.timestamp,
    value?.sensor_timestamp_ms,
    value?.sensor_timestamp
  );

  return {
    available: environment.available === true || temperature !== null || humidity !== null,
    temperature,
    humidity,
    sensor_timestamp: sourceData.sensor_timestamp || sensor.timestamp || dht.timestamp || "",
    sensor_timestamp_ms: sensorTimestampMs || 0,
    match_method: sourceData.match_method || "",
    source: sourceData.source || ""
  };
}

function formatEnvironmentInfo(environment = {}) {
  if (!environment.available) return "";

  const parts = [];

  if (environment.temperature !== null && environment.temperature !== undefined) {
    parts.push(`Suhu: ${Number(environment.temperature).toFixed(1)}&deg;C`);
  }

  if (environment.humidity !== null && environment.humidity !== undefined) {
    parts.push(`Kelembaban: ${Number(environment.humidity).toFixed(1)}%`);
  }

  if (!parts.length) return "";

  const sensorTime =
    environment.sensor_timestamp_ms > 0
      ? formatSensorTime(new Date(environment.sensor_timestamp_ms).toISOString())
      : formatSensorTime(environment.sensor_timestamp);

  if (sensorTime && sensorTime !== "--") {
    parts.push(`Sensor: ${sensorTime}`);
  }

  return parts.join(" | ");
}

function mapFirebaseInferenceItem(key, value, category = "disease") {
  const lowerCategory = String(category).toLowerCase();
  const typeLabel = lowerCategory === "pest" ? "Pest" : "Disease";
  const data = getNestedInferenceData(value, lowerCategory);
  const prediction = value?.prediction || {};
  const imageData = value?.image || {};
  const statusData = value?.status || {};
  const legacyStatus = typeof value?.status === "string" ? value.status : "";
  const sourceInfo = value?.source_info || {};
  const timeData = value?.time || value?.timestamp || {};
  const firebaseHandled = getFirebaseHandledStatus(value);
  const firebaseHandledAt = getFirebaseHandledAt(value);

  const rawTitle =
    data?.class_name ||
    prediction?.class_name ||
    prediction?.detected_classes?.join?.(", ") ||
    data?.label ||
    data?.name ||
    data?.prediction ||
    data?.result ||
    data?.detected_class ||
    value?.class_name ||
    value?.label ||
    `Unknown ${typeLabel}`;

  const title = formatTitleCase(rawTitle);

  const confidenceRaw =
    data?.confidence ||
    prediction?.confidence ||
    data?.confidence_score ||
    data?.score ||
    data?.probability ||
    value?.confidence ||
    value?.confidence_score ||
    value?.score ||
    0;

  const confidence = normalizeConfidence(confidenceRaw);

  const image = getInferenceImageUrl(value, data) || "assets/img/disease-preview.svg";

  const rawTime =
    timeData?.created_at_iso ||
    timeData?.timestamp_iso ||
    timeData?.timestamp ||
    timeData?.created_at ||
    value?.created_at_iso ||
    value?.timestamp ||
    value?.time ||
    value?.created_at ||
    value?.uploaded_at ||
    value?.updated_at ||
    data?.created_at_iso ||
    data?.timestamp ||
    data?.created_at ||
    data?.time ||
    "-";
  const timestampMs = getTimestampCandidateMs(
    timeData?.created_at_ms,
    timeData?.timestamp_ms,
    value?.created_at_ms,
    value?.timestamp_ms,
    value?.uploaded_at_ms,
    value?.time_ms,
    timeData,
    value?.timestamp,
    rawTime
  );
  const timeLabel = timestampMs
    ? formatSensorTime(new Date(timestampMs).toISOString())
    : formatSensorTime(rawTime) !== "--"
      ? formatSensorTime(rawTime)
      : String(rawTime || "-");

  const recommendationText = getRecommendationText(value, data);
  const environmentInfo = getInferenceEnvironment(value);

  return {
    id: value?.id?.request_id || value?.request_id || `${lowerCategory}-${key}`,
    firebase_key: key,
    category: lowerCategory,
    title: title,
    type: typeLabel,
    severity: getSeverityFromConfidence(confidence),
    confidence: Number.isFinite(confidence) ? confidence.toFixed(1) : 0,
    garden: sourceInfo?.source || value?.source || value?.camera || typeLabel,
    camera: sourceInfo?.source || value?.source || value?.camera || typeLabel,
    time: timeLabel,
    environment: environmentInfo,
    environment_label: formatEnvironmentInfo(environmentInfo),
    image: image,
    rawTime: rawTime,
    timestamp_ms: timestampMs,
    description:
      data?.description ||
      value?.description ||
      value?.recommendation?.summary ||
      value?.disease_recommendation?.summary ||
      value?.pest_recommendation?.summary ||
      `Terdeteksi ${title} pada tanaman.`,
    solution:
      recommendationText ||
      data?.solution ||
      value?.solution ||
      "Lakukan pengecekan visual pada tanaman dan pantau kondisi lingkungan.",
    sync_status: statusData?.sync_status || value?.sync_status || "synced",
    display_source: sourceInfo?.display_source || value?.display_source || "cloud",
    handled: firebaseHandled,
    status: firebaseHandled ? "handled" : legacyStatus || statusData?.status || "unhandled",
    handled_at: firebaseHandledAt,
    raw: value
  };
}

function getInferenceHistorySources(category = "all") {
  if (category === "disease") {
    return [{ category: "disease", url: DISEASE_HISTORY_URL }];
  }

  if (category === "pest") {
    return [{ category: "pest", url: PEST_HISTORY_URL }];
  }

  return [
    { category: "disease", url: DISEASE_HISTORY_URL },
    { category: "pest", url: PEST_HISTORY_URL }
  ];
}

function getInferenceHistoryUrl(category) {
  return category === "pest" ? PEST_HISTORY_URL : DISEASE_HISTORY_URL;
}

function buildInferenceHistoryPageUrl(category, cursorKey = null) {
  const params = {
    orderBy: '"$key"',
    limitToLast: String(HISTORY_PAGE_SIZE + 1)
  };

  if (cursorKey) {
    params.endAt = JSON.stringify(cursorKey);
  }

  return buildFirebaseQueryUrl(getInferenceHistoryUrl(category), params);
}

function buildInferenceHistorySortedUrl(category) {
  return buildLimitToLastUrl(getInferenceHistoryUrl(category), INFERENCE_HISTORY_LIMIT);
}

function getInferenceChunkFromFirebaseData(data, category, cursorKey = null) {
  const rawEntries = Object.entries(data || {})
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .reverse();
  const entries = rawEntries
    .filter(([key]) => key !== cursorKey);

  const hasMore = rawEntries.length > HISTORY_PAGE_SIZE;
  const chunkEntries = entries.slice(0, HISTORY_PAGE_SIZE);
  const items = chunkEntries
    .map(([key, value]) => mapFirebaseInferenceItem(key, value, category))
    .filter(shouldShowInDiseaseHistory);

  return {
    items,
    cursorKey: chunkEntries.length ? chunkEntries[chunkEntries.length - 1][0] : cursorKey,
    hasMore
  };
}

function getInferenceHistoryPageFromFirebaseData(data, category, page = 1) {
  const items = Object.entries(data || {})
    .map(([key, value]) => mapFirebaseInferenceItem(key, value, category))
    .filter(shouldShowInDiseaseHistory);
  const sortedItems = sortDetectionsNewestFirst(items);
  const start = (Math.max(Number(page) || 1, 1) - 1) * HISTORY_PAGE_SIZE;
  const pageItems = sortedItems.slice(start, start + HISTORY_PAGE_SIZE);

  return {
    items: pageItems,
    cursorKey: pageItems.length ? pageItems[pageItems.length - 1].firebase_key : null,
    hasMore: sortedItems.length > start + HISTORY_PAGE_SIZE
  };
}

async function fetchInferenceHistoryPage(page = 1, reset = false) {
  if (diseaseHistoryLoading) return;

  const safePage = Math.max(Number(page) || 1, 1);

  if (reset) {
    diseaseHistoryPages = [];
    diseaseHistoryPage = 1;
  }

  if (shouldSkipCloudFetch()) {
    diseaseHistoryPage = safePage;
    setLocalFailoverStatusIfNeeded();
    renderDiseaseHistoryGrid();
    return;
  }

  if (diseaseHistoryPages[safePage - 1]) {
    diseaseHistoryPage = safePage;
    renderDiseaseHistoryGrid();
    return;
  }

  const previousPage = safePage > 1 ? diseaseHistoryPages[safePage - 2] : null;
  if (safePage > 1 && !previousPage) {
    const categoryItems = sortDetectionsNewestFirst(
      diseaseItems.filter((item) => item?.category === activeDiseaseHistoryCategory)
    );
    if (categoryItems.length > (safePage - 1) * HISTORY_PAGE_SIZE) {
      diseaseHistoryPage = safePage;
      renderDiseaseHistoryGrid();
    }
    return;
  }

  diseaseHistoryLoading = true;
  diseaseHistoryPage = safePage;
  renderDiseaseHistoryGrid();

  try {
    let pageData = null;

    try {
      const data = await fetchJson(
        buildInferenceHistorySortedUrl(activeDiseaseHistoryCategory)
      );
      pageData = getInferenceHistoryPageFromFirebaseData(
        data,
        activeDiseaseHistoryCategory,
        safePage
      );
    } catch (queryError) {
      console.warn(
        "Query riwayat inference gagal. Pakai cache lokal bila tersedia.",
        queryError
      );
    }

    if (!pageData || !pageData.items.length) {
      pageData = {
        items: [],
        cursorKey: previousPage?.cursorKey || null,
        hasMore: false,
        error: false
      };
    }

    diseaseHistoryPages[safePage - 1] = pageData;

    if (pageData.items.length) {
      markCloudFetchOk();
      syncHandledMapFromFirebase(pageData.items);
      firebaseDiseaseItems = mergeDiseaseItems(firebaseDiseaseItems, pageData.items);
      diseaseItems = cleanDiseaseHistoryItems(mergeDiseaseItems(diseaseItems, pageData.items));
      localStorage.setItem("diseaseItems", JSON.stringify(diseaseItems));
    }
  } catch (error) {
    console.error("Gagal membaca halaman riwayat disease/pest:", error);
    markCloudFetchFailed();
    diseaseHistoryPages[safePage - 1] = {
      items: [],
      cursorKey: previousPage?.cursorKey || null,
      hasMore: false,
      error: false
    };
  } finally {
    diseaseHistoryLoading = false;
    renderDiseaseHistoryGrid();
  }
}

async function fetchDiseaseHistory(historyMode = false, category = "all") {
  if (!historyMode && document.visibilityState === "hidden") return;
  if (shouldSkipCloudFetch()) {
    setLocalFailoverStatusIfNeeded();
    refreshDiseaseHistoryModalIfOpen();
    return;
  }

  try {
    const limit = historyMode ? INFERENCE_HISTORY_LIMIT : INFERENCE_LIVE_LIMIT;
    const sources = getInferenceHistorySources(category);
    const results = await Promise.allSettled(
      sources.map((source) => fetchJson(buildLimitToLastUrl(source.url, limit)))
    );

    let items = [];

    results.forEach((result, index) => {
      if (result.status !== "fulfilled" || !result.value) return;

      const source = sources[index];
      const sourceItems = Object.entries(result.value).map(([key, value]) =>
        mapFirebaseInferenceItem(key, value, source.category)
      );

      items = items.concat(sourceItems);
    });

    items = items.filter(shouldShowInDiseaseHistory);
    syncHandledMapFromFirebase(items);

    const firebaseHistoryLoaded = results.every(
      (result) => result.status === "fulfilled"
    );

    if (firebaseHistoryLoaded) {
      markCloudFetchOk();
    } else {
      markCloudFetchFailed();
    }

    if (!items.length && firebaseHistoryLoaded && historyMode) {
      refreshDiseaseHistoryModalIfOpen();
      return;
    }

    items = sortDetectionsNewestFirst(items);
    firebaseDiseaseItems = historyMode
      ? items
      : cleanDiseaseHistoryItems(mergeDiseaseItems(firebaseDiseaseItems, items));

    // PERBAIKAN:
    // Data Firebase disease + pest sekarang digabung dengan data yang sudah ada,
    // bukan mengganti semua diseaseItems.
    diseaseItems = cleanDiseaseHistoryItems(mergeDiseaseItems(diseaseItems, firebaseDiseaseItems));
    localStorage.setItem("diseaseItems", JSON.stringify(diseaseItems));
    refreshDiseaseHistoryModalIfOpen();

    const latestUnhandled = getLatestDetectionItem(diseaseItems);

    if (latestUnhandled) {
      setActiveAlertFromItem(latestUnhandled);
      renderDiseaseAlert();

      if (!getItemHandledStatus(latestUnhandled)) {
        notifyDiseaseItem(latestUnhandled, "cloud");
      }

      markDetectionsSeenForNotifications(items);
    } else {
      markDetectionsSeenForNotifications(items);
      setNoActiveDiseaseAlert();
      renderDiseaseAlert();
    }
  } catch (error) {
    console.error("Gagal membaca disease/pest history:", error);
    markCloudFetchFailed();

    const cached = localStorage.getItem("diseaseItems");

    if (cached) {
      try {
        diseaseItems = JSON.parse(cached);
      } catch {
        diseaseItems = [];
      }
    }
  }
}

// =========================
// LOCAL INFERENCE
// =========================
function getInferenceTitle(item) {
  const prediction = asObject(item?.prediction);

  if (prediction?.class_name) {
    return formatTitleCase(prediction.class_name);
  }

  if (prediction?.best_detection?.class_name) {
    return formatTitleCase(prediction.best_detection.class_name);
  }

  if (Array.isArray(prediction?.detected_classes) && prediction.detected_classes.length > 0) {
    return prediction.detected_classes.map(formatTitleCase).join(", ");
  }

  if (item?.disease?.class_name) {
    return formatTitleCase(item.disease.class_name);
  }

  if (Array.isArray(item?.pest) && item.pest.length > 0) {
    const names = [
      ...new Set(item.pest.map((p) => formatTitleCase(p.class_name)))
    ];

    return names.join(", ");
  }

  if (item?.pest?.class_name) {
    return formatTitleCase(item.pest.class_name);
  }

  return "No Detection";
}

function getInferenceCategory(item) {
  const prediction = asObject(item?.prediction);
  const firebaseCategory = String(item?.firebase_category || "").toLowerCase();

  if (firebaseCategory === "pest" || firebaseCategory === "healthy" || firebaseCategory === "disease") {
    return firebaseCategory;
  }

  if (prediction?.type === "pest") return "pest";
  if (prediction?.type === "healthy") return "healthy";

  if (Array.isArray(item?.pest) && item.pest.length > 0) return "pest";
  if (item?.pest?.class_name) return "pest";
  return "disease";
}

function getInferenceConfidence(item) {
  const prediction = asObject(item?.prediction);

  if (prediction?.confidence !== undefined) {
    return normalizeConfidence(prediction.confidence);
  }

  if (prediction?.best_detection?.confidence !== undefined) {
    return normalizeConfidence(prediction.best_detection.confidence);
  }

  if (item?.disease?.confidence !== undefined) {
    return normalizeConfidence(item.disease.confidence);
  }

  if (Array.isArray(item?.pest) && item.pest.length > 0) {
    const maxConf = Math.max(...item.pest.map((p) => Number(p.confidence || 0)));
    return normalizeConfidence(maxConf);
  }

  if (item?.pest?.confidence !== undefined) {
    return normalizeConfidence(item.pest.confidence);
  }

  return 0;
}

function getInferenceImage(item) {
  return (
    getInferenceImageUrl(item) ||
    item?.local_annotated_image_path ||
    item?.local_image_path ||
    "assets/img/disease-preview.svg"
  );
}

function getInferenceDescription(item) {
  if (item?.recommendation?.summary) {
    return item.recommendation.summary;
  }

  if (item?.disease_recommendation?.summary) {
    return item.disease_recommendation.summary;
  }

  if (item?.pest_recommendation?.summary) {
    return item.pest_recommendation.summary;
  }

  return `Terdeteksi ${getInferenceTitle(item)} pada tanaman.`;
}

function getInferenceSolution(item) {
  const rec =
    item?.recommendation ||
    item?.disease_recommendation ||
    item?.pest_recommendation;

  if (typeof rec === "string") {
    return rec;
  }

  if (rec?.recommended_actions && Array.isArray(rec.recommended_actions)) {
    return rec.recommended_actions.join(" ");
  }

  if (rec?.actions && Array.isArray(rec.actions)) {
    return rec.actions.join(" ");
  }

  return "Lakukan pengecekan visual pada tanaman dan pantau kondisi lingkungan.";
}

function mapInferenceToDiseaseItem(item, index = 0) {
  const category = getInferenceCategory(item);
  const id = item?.id?.request_id || item?.request_id || `local-${category}-${index}`;
  const title = getInferenceTitle(item);
  const confidence = getInferenceConfidence(item);
  const image = getInferenceImage(item);
  const timeData = asObject(item?.time);
  const sourceInfo = asObject(item?.source_info);
  const statusData = getRecordStatusData(item);
  const rawTime =
    timeData.created_at_iso ||
    timeData.timestamp_iso ||
    timeData.timestamp ||
    timeData.created_at ||
    item?.created_at_iso ||
    item?.timestamp ||
    item?.time ||
    item?.created_at ||
    item?.uploaded_at ||
    "-";

  const localHandled = loadHandledLocalMap();
  const handledInfo = localHandled[id];
  const environmentInfo = getInferenceEnvironment(item);

  return {
    id: id,
    firebase_key: null,
    category: category,
    title: title,
    type: category === "pest" ? "Pest" : "Disease",
    severity: getSeverityFromConfidence(confidence),
    confidence: Number.isFinite(confidence) ? confidence.toFixed(1) : 0,
    garden: sourceInfo?.source || item?.source || "Local",
    camera: sourceInfo?.source || item?.source || "Local",
    time: formatSensorTime(rawTime) !== "--" ? formatSensorTime(rawTime) : rawTime,
    environment: environmentInfo,
    environment_label: formatEnvironmentInfo(environmentInfo),
    image: image,
    rawTime: rawTime,
    timestamp_ms: Number(
      item?.created_at_ms ||
        item?.timestamp_ms ||
        item?.uploaded_at_ms ||
        item?.time_ms ||
        0
    ),
    description: getInferenceDescription(item),
    solution: getInferenceSolution(item),
    sync_status: statusData?.sync_status || item?.sync_status || "pending",
    display_source:
      sourceInfo?.display_source ||
      sourceInfo?.storage_type ||
      item?.display_source ||
      item?.storage_type ||
      "pi_local_cache",
    handled: handledInfo?.handled === true,
    status: handledInfo?.status || (handledInfo?.handled ? "handled" : "unhandled"),
    handled_at: handledInfo?.handled_at || null,
    raw: item
  };
}

function setActiveAlertFromItem(item) {
  if (!item) return;

  const handled = getItemHandledStatus(item);

  activeDiseaseAlert = {
    id: item.id,
    firebase_key: item.firebase_key || null,
    category: item.category || "disease",
    title: item.title || "Unknown Detection",
    time: item.time || "-",
    description:
      item.description || "Hasil deteksi dari sistem inference lokal.",
    solution:
      item.solution ||
      "Lakukan pengecekan visual pada tanaman dan pantau kondisi lingkungan.",
    confidence: item.confidence || 0,
    image: item.image || "assets/img/disease-preview.svg",
    handled: handled,
    status: handled ? "handled" : "unhandled",
    sync_status: item.sync_status,
    display_source: item.display_source
  };
}

function setNoActiveDiseaseAlert() {
  activeDiseaseAlert = {
    id: null,
    firebase_key: null,
    category: "disease",
    title: "Tidak ada peringatan aktif",
    time: "-",
    description: "Semua deteksi hama/penyakit sudah ditangani.",
    solution: "Tetap lakukan pemantauan kondisi tanaman secara berkala.",
    confidence: 0,
    image: "assets/img/disease-preview.svg",
    handled: true,
    status: "handled",
    sync_status: null,
    display_source: null
  };
}

function updateDashboardFromLocalInference(input) {
  let items = [];

  if (Array.isArray(input)) {
    items = input;
  } else if (input && typeof input === "object") {
    const looksLikeSingle =
      input.request_id ||
      input.mode ||
      input.disease ||
      input.pest ||
      input.recommendation;

    items = looksLikeSingle ? [input] : Object.values(input);
  }

  items = items.filter(Boolean);
  if (!items.length) return;

  let mappedItems = items.map((item, index) =>
    mapInferenceToDiseaseItem(item, index)
  );

  mergeCameraShotsWithPending(mappedItems);
  mappedItems = mappedItems.filter(shouldShowInDiseaseHistory);

  if (!mappedItems.length) {
    console.log(
      "Local inference healthy/unknown, tidak dimasukkan ke history hama penyakit."
    );
    return;
  }

  setLocalFailoverStatusIfNeeded();
  mappedItems = sortDetectionsNewestFirst(mappedItems);

  // PERBAIKAN:
  // Sebelumnya diseaseItems = mappedItems;
  // Itu membuat data lama dari Firebase tertimpa data local.
  // Sekarang data local digabung dengan data yang sudah ada.
  diseaseItems = cleanDiseaseHistoryItems(mergeDiseaseItems(diseaseItems, mappedItems));
  localStorage.setItem("diseaseItems", JSON.stringify(diseaseItems));

  if (firebaseDiseaseItems.length) {
    return;
  }

  const latestUnhandled = getLatestDetectionItem(diseaseItems);

  if (latestUnhandled) {
    setActiveAlertFromItem(latestUnhandled);
  } else {
    setNoActiveDiseaseAlert();
  }

  renderDiseaseAlert();

  if (latestUnhandled && !getItemHandledStatus(latestUnhandled)) {
    notifyDiseaseItem(latestUnhandled, "local");
  }

  markDetectionsSeenForNotifications(mappedItems);

  if (latestUnhandled?.sync_status === "pending") {
    setLocalFailoverStatusIfNeeded();
  }
}

async function fetchLocalInferenceLatest(force = false) {
  if (!force && !shouldSkipCloudFetch()) return;

  try {
    const latest = await fetchLocalJson(LOCAL_LATEST_INFERENCE_URL);
    if (!latest) return;

    updateDashboardFromLocalInference(latest);
  } catch (error) {
    console.error("Gagal membaca local latest inference:", error);
  }
}

async function fetchLocalInferenceHistory(force = false) {
  if (!force && !shouldSkipCloudFetch()) return;

  try {
    const history = await fetchLocalJson(LOCAL_HISTORY_INFERENCE_URL);
    if (!history) return;

    updateDashboardFromLocalInference(history);
  } catch (error) {
    console.error("Gagal membaca local history inference:", error);
  }
}

// =========================
// HANDLED ACTION
// =========================
async function markCloudDiseaseHandled(item) {
  if (!item?.firebase_key && !item?.id) {
    throw new Error("ID data cloud tidak ditemukan.");
  }

  const category = item?.category === "pest" ? "pest" : "disease";
  const firebaseKey = item?.firebase_key || item?.id;

  const url = `${FIREBASE_DB_URL}/inference_result/${category}/${firebaseKey}.json`;
  const now = new Date().toISOString();

  return await patchFirebaseJson(url, {
    "status/handled": true,
    "status/status": "handled",
    "status/handled_at": now
  });
}

function markLocalDiseaseHandled(item) {
  if (!item?.id) return;

  const localHandled = loadHandledLocalMap();
  const now = new Date().toISOString();

  const handledInfo = {
    handled: true,
    status: "handled",
    handled_at: now,
    title: item.title || "Unknown Detection",
    source: item.display_source || item.sync_status || "local_failover",
    category: item.category || "disease"
  };

  [
    item.id,
    item.firebase_key,
    item.raw?.id?.request_id,
    item.raw?.request_id
  ].filter(Boolean).forEach((key) => {
    localHandled[key] = handledInfo;
  });

  saveHandledLocalMap(localHandled);
}

function markDiseaseItemHandledInMemory(targetItem, handledAt) {
  const targetKeys = new Set(getHandledStorageKeys(targetItem));
  if (!targetKeys.size) return;

  const markItem = (item) => {
    const hasMatchingKey = getHandledStorageKeys(item).some((key) =>
      targetKeys.has(key)
    );

    if (!hasMatchingKey) return item;

    item.handled = true;
    item.status = "handled";
    item.handled_at = handledAt;

    if (item.raw && typeof item.raw === "object") {
      item.raw.handled = true;
      item.raw.status = {
        ...(typeof item.raw.status === "object" ? item.raw.status : {}),
        handled: true,
        status: "handled",
        handled_at: handledAt
      };
      item.raw.handled_at = handledAt;
    }

    return item;
  };

  diseaseItems = diseaseItems.map(markItem);
  firebaseDiseaseItems = firebaseDiseaseItems.map(markItem);
}

async function markDiseaseHandled() {
  const activeId = activeDiseaseAlert?.id;

  if (!activeId) {
    alert("Data deteksi tidak memiliki ID, status tidak bisa disimpan.");
    return;
  }

  const item = diseaseItems.find((d) => d.id === activeId);

  if (!item) {
    alert("Data deteksi tidak ditemukan di history.");
    return;
  }

  const handledBtn = document.getElementById("markHandledBtn");
  const handledAt = new Date().toISOString();

  try {
    if (handledBtn) {
      handledBtn.disabled = true;
      handledBtn.textContent = "Menyimpan...";
    }

    markLocalDiseaseHandled(item);
    markDiseaseItemHandledInMemory(item, handledAt);

    activeDiseaseAlert.handled = true;
    activeDiseaseAlert.status = "handled";

    localStorage.setItem("diseaseItems", JSON.stringify(diseaseItems));

    if (isCloudItem(item)) {
      markCloudDiseaseHandled(item).catch((error) => {
        console.warn(
          "Status ditandai lokal, tetapi sinkron status ke Firebase gagal:",
          error
        );
      });
    }

    addNotification({
      id: `handled-${item.id}`,
      title: "Deteksi Sudah Ditangani",
      message: `${item.title || "Deteksi"} telah ditandai sebagai sudah ditangani.`,
      level: "low",
      icon: "check-circle",
      iconColor: "#4caf50",
      time: getNowTimeLabel(),
      popup: false
    });

    const nextItem = getNextUnhandledDisease(item.id);
    animateToNextDiseaseAlert(nextItem);
  } catch (error) {
    console.error("Gagal menandai sudah ditangani:", error);

    markLocalDiseaseHandled(item);
    markDiseaseItemHandledInMemory(item, handledAt);

    activeDiseaseAlert.handled = true;
    activeDiseaseAlert.status = "handled";

    localStorage.setItem("diseaseItems", JSON.stringify(diseaseItems));

    const nextItem = getNextUnhandledDisease(item.id);
    animateToNextDiseaseAlert(nextItem);
  } finally {
    if (handledBtn) {
      handledBtn.disabled = false;
    }
  }
}

// =========================
// NOTIFICATIONS UI
// =========================
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
  } else {
    notifBadge.classList.remove("hidden");
  }

  let html = "";

  notifications.forEach((item) => {
    const unreadDot = item.unread
      ? `<span class="absolute right-5 top-6 h-3 w-3 rounded-full bg-[#4caf50]"></span>`
      : "";

    html += `
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
  });

  notifList.innerHTML = html;

  if (window.lucide) window.lucide.createIcons();
}

function closeNotifPanel() {
  const panel = document.getElementById("notifPanel");
  if (!panel) return;

  panel.classList.add("hidden");
}

function toggleNotifPanel() {
  const panel = document.getElementById("notifPanel");
  if (!panel) return;

  panel.classList.toggle("hidden");
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
    console.log("Firebase notifications belum bisa dibaca, pakai cache lokal.");
  }
}

// =========================
// QOS MONITORING
// =========================
const QOS_AUTO_PATHS = [
  "qos_history.json",
  "qos_live.json",
  "qos_latest.json",
  "qos/qos_history.json",
  "qos/qos_live.json",
  "qos/qos_latest.json",
  "data/qos_history.json",
  "data/qos_live.json",
  "data/qos_latest.json",
  "lokasight/qos_history.json",
  "lokasight/qos_live.json",
  "lokasight/qos_latest.json",
  "lokasight/data/qos_history.json",
  "lokasight/data/qos_live.json",
  "lokasight/data/qos_latest.json"
];

const qosSeriesConfig = [
  { key: "avg_latency_seconds", label: "Latency", unit: "s", color: "#2e7d32" },
  { key: "jitter_seconds", label: "Jitter", unit: "s", color: "#f57c00" },
  { key: "avg_packet_loss_percent", label: "Packet Loss", unit: "%", color: "#e53935" },
  { key: "avg_throughput_mbps", label: "Throughput", unit: "Mbps", color: "#1976d2" },
  { key: "avg_cpu_usage_percent", label: "CPU", unit: "%", color: "#7b1fa2" },
  { key: "avg_memory_usage_percent", label: "Memory", unit: "%", color: "#00897b" }
];

const QOS_FRESH_WINDOW_MS = 10 * 60 * 1000;
let qosPoints = [];
let qosManualMode = false;

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

function setQosStatusText(id, value, online = true) {
  const el = document.getElementById(id);
  if (!el) return;

  el.textContent = value;
  el.style.color = online ? "#2e7d32" : "#e53935";
}

function normalizeQoSRecord(raw, sourceLabel = "JSON QoS") {
  const source = raw?.current_average || raw?.average || raw?.metrics || raw?.latest || raw || {};
  const latest = raw?.latest || {};

  return {
    sourceLabel,
    time:
      raw?.timestamp ||
      raw?.time ||
      raw?.created_at ||
      latest?.timestamp ||
      latest?.time ||
      new Date().toISOString(),
    system_mode: raw?.system_mode || latest?.system_mode || "-",
    total_recorded: raw?.total_recorded,
    successful_requests: raw?.successful_requests,
    failed_requests: raw?.failed_requests,
    success_rate_percent: source.success_rate_percent ?? raw?.success_rate_percent,
    success: latest?.success ?? raw?.success,
    http_status: latest?.http_status ?? raw?.http_status,
    avg_latency_seconds:
      source.avg_latency_seconds ?? source.latency_seconds ?? source.latency ?? source.delay,
    jitter_seconds: source.jitter_seconds ?? source.jitter,
    avg_packet_loss_percent:
      source.avg_packet_loss_percent ?? source.packet_loss_percent ?? source.packet_loss,
    avg_throughput_mbps:
      source.avg_throughput_mbps ?? source.throughput_mbps ?? source.throughput,
    avg_cpu_usage_percent:
      source.avg_cpu_usage_percent ?? source.cpu_usage_percent ?? source.cpu,
    avg_memory_usage_percent:
      source.avg_memory_usage_percent ?? source.memory_usage_percent ?? source.memory,
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

  return list.map((item) => normalizeQoSRecord(item, sourceLabel));
}

function getQoSSystemState(point, isFresh = true) {
  if (!point || !isFresh) return "offline";

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

  const hasWarning =
    qosNumber(point.avg_latency_seconds) > 1 ||
    qosNumber(point.jitter_seconds) > 0.2 ||
    qosNumber(point.avg_packet_loss_percent) > 5 ||
    qosNumber(point.avg_throughput_mbps) < 1 ||
    !apiOnline ||
    !dhtOnline ||
    !raspberryOnline;

  return hasWarning ? "warning" : "online";
}

function updateSystemStatusFromQoS(point, isFresh = true) {
  updateSystemStatus(getQoSSystemState(point, isFresh));
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

  setQosStatusText("piStatus", raspberryOnline ? "Online" : "Offline", raspberryOnline);
  setQosStatusText("gcpStatus", apiOnline ? "Online" : "Offline", apiOnline);
  setQosStatusText("dhtStatus", dhtOnline ? "Online" : "Offline", dhtOnline);
  updateSystemStatusFromQoS(point, isFresh);
  updateDhtStatus();

  const latencyValue = document.getElementById("latencyValue");
  const jitterValue = document.getElementById("jitterValue");
  const packetLossValue = document.getElementById("packetLossValue");
  const throughputValue = document.getElementById("throughputValue");

  if (latencyValue) latencyValue.textContent = `${qosFormat(point.avg_latency_seconds, 3)} s`;
  if (jitterValue) jitterValue.textContent = `${qosFormat(point.jitter_seconds, 3)} s`;
  if (packetLossValue) packetLossValue.textContent = `${qosFormat(point.avg_packet_loss_percent)}%`;
  if (throughputValue) throughputValue.textContent = `${qosFormat(point.avg_throughput_mbps)} Mbps`;
}

function renderQoSChart() {
  const grid = document.getElementById("qosChartsGrid");
  const pointCount = document.getElementById("qosPointCount");
  if (!grid) return;

  if (pointCount) pointCount.textContent = `${qosPoints.length} data`;

  if (!qosPoints.length) {
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

  grid.innerHTML = qosSeriesConfig.map((series) => {
    const width = 360;
    const height = 190;
    const left = 42;
    const right = 336;
    const top = 18;
    const bottom = 142;
    const chartHeight = bottom - top;
    const stepX = qosPoints.length > 1 ? (right - left) / (qosPoints.length - 1) : 0;
    const values = qosPoints.map((point) => qosNumber(point[series.key]));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min || 1;
    const latestValue = values[values.length - 1];

    let svgHtml = "";

    for (let i = 0; i <= 3; i++) {
      const y = top + (chartHeight / 3) * i;
      svgHtml += `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#e3efe0" stroke-width="1" />`;
    }

    const coords = values.map((value, index) => {
      const x = qosPoints.length === 1 ? (left + right) / 2 : left + stepX * index;
      const y = bottom - ((value - min) / spread) * chartHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    svgHtml += `<polyline points="${coords.join(" ")}" fill="none" stroke="${series.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`;

    values.forEach((value, index) => {
      const x = qosPoints.length === 1 ? (left + right) / 2 : left + stepX * index;
      const y = bottom - ((value - min) / spread) * chartHeight;
      svgHtml += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${series.color}">
        <title>${series.label}: ${qosFormat(value, series.unit === "s" ? 3 : 2)} ${series.unit}</title>
      </circle>`;
    });

    const firstLabel = formatSensorTime(qosPoints[0]?.time);
    const lastLabel = formatSensorTime(qosPoints[qosPoints.length - 1]?.time);
    const decimals = series.unit === "s" ? 3 : 2;

    svgHtml += `
      <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="#cfe3cc" stroke-width="1.4" />
      <line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="#cfe3cc" stroke-width="1.4" />
      <text x="${left}" y="174" fill="#66bb6a" font-size="11" font-weight="700">${escapeHtml(firstLabel)}</text>
      <text x="${right}" y="174" fill="#66bb6a" font-size="11" font-weight="700" text-anchor="end">${escapeHtml(lastLabel)}</text>
      <text x="${left}" y="12" fill="#81c784" font-size="10" font-weight="700">${qosFormat(max, decimals)}</text>
      <text x="${left}" y="158" fill="#81c784" font-size="10" font-weight="700">${qosFormat(min, decimals)}</text>
    `;

    return `
      <div class="qos-mini-chart">
        <div class="qos-mini-chart-header">
          <h4 class="qos-mini-chart-title">${series.label}</h4>
          <span class="qos-mini-chart-value" style="color:${series.color}">
            ${qosFormat(latestValue, decimals)} ${series.unit}
          </span>
        </div>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafik ${series.label}">
          ${svgHtml}
        </svg>
      </div>
    `;
  }).join("");
}

function renderQoSAlerts(point) {
  const container = document.getElementById("alertContainer");
  if (!container || !point) return;

  if (!isQoSPointFresh(point)) {
    container.innerHTML = `
      <div class="qos-alert-item">
        Data QoS belum diperbarui. Jalankan monitoring jaringan untuk melihat peringatan terbaru.
      </div>
    `;
    return;
  }

  const alerts = [];

  if (qosNumber(point.avg_latency_seconds) > 1) alerts.push("Latency tinggi, lebih dari 1 detik.");
  if (qosNumber(point.jitter_seconds) > 0.2) alerts.push("Jitter tinggi, koneksi kurang stabil.");
  if (qosNumber(point.avg_packet_loss_percent) > 5) alerts.push("Packet loss tinggi, ada paket data yang hilang.");
  if (qosNumber(point.avg_throughput_mbps) < 1) alerts.push("Throughput rendah, transfer data melambat.");
  if (qosNumber(point.avg_cpu_usage_percent) > 85) alerts.push("CPU usage tinggi pada perangkat.");
  if (qosNumber(point.avg_memory_usage_percent) > 85) alerts.push("Memory usage tinggi pada perangkat.");

  if (!alerts.length) {
    container.innerHTML = "<p>No alerts</p>";
    return;
  }

  container.innerHTML = alerts.map((alert) => `<div class="qos-alert-item">${escapeHtml(alert)}</div>`).join("");
}

function renderQoSLegend() {
  const container = document.getElementById("qosLegend");
  if (!container) return;

  container.innerHTML = qosSeriesConfig.map((series) => `
    <span class="qos-legend-item">
      <span class="qos-legend-color" style="background:${series.color}"></span>
      ${escapeHtml(series.label)}
    </span>
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

  updateSystemStatusFromQoS(latest, latestIsFresh);

  if (latestIsFresh) {
    updateQoSCards(latest, latestIsFresh);
  } else {
    setQosStatusText("piStatus", "Data QoS lama", false);
    setQosStatusText("gcpStatus", "Data QoS lama", false);
    setQosStatusText("dhtStatus", "Data QoS lama", false);
  }
  renderQoSChart();
  renderQoSAlerts(latest);
  renderQoSLegend();
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

  if (bestRecords.length && applyQoSRecords(bestRecords, bestPath)) {
    return true;
  }

  setQosStatusText("piStatus", "JSON QoS belum ditemukan", false);
  setQosStatusText("gcpStatus", "Unknown", false);
  setQosStatusText("dhtStatus", "Unknown", false);
  updateSystemStatus("offline");
  return false;
}

function setupQoSFileInput() {
  const input = document.getElementById("qosFileInput");
  if (!input) return;

  input.addEventListener("change", async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;

    qosManualMode = true;
    const allRecords = [];

    for (const file of files) {
      try {
        const payload = JSON.parse(await file.text());
        allRecords.push(...extractQoSRecords(payload, file.name));
      } catch (error) {
        console.error("Gagal membaca JSON QoS:", file.name, error);
      }
    }

    applyQoSRecords(allRecords, files.map((file) => file.name).join(", "));
  });
}

function initQoSMonitoring() {
  if (!document.getElementById("qosSection")) return;

  renderQoSChart();
  updateDhtStatus();
  setupQoSFileInput();
  loadQoSFromKnownPaths();
  setInterval(() => {
    if (!qosManualMode) {
      loadQoSFromKnownPaths();
    }
  }, 5000);
  setInterval(updateDhtStatus, 1000);
}

// =========================
// SENSOR CHART
// =========================
function renderSensorChart() {
  const titleEl = document.getElementById("activeChartTitle");
  const subtitleEl = document.getElementById("activeChartSubtitle");

  if (activeSensorChart === "temperature") {
    if (titleEl) titleEl.textContent = "Riwayat Suhu";
    if (subtitleEl) subtitleEl.textContent = "Menampilkan riwayat suhu terbaru";

    renderLineChart({
      svgId: "sensor-chart-svg",
      points: realtimeTempPoints,
      valueKey: "temp",
      minDefault: 20,
      maxDefault: 32,
      suffix: "°C"
    });
  } else {
    if (titleEl) titleEl.textContent = "Riwayat kelembaban";
    if (subtitleEl) {
      subtitleEl.textContent = "Menampilkan riwayat kelembaban terbaru";
    }

    renderLineChart({
      svgId: "sensor-chart-svg",
      points: realtimeHumidityPoints,
      valueKey: "humidity",
      minDefault: 40,
      maxDefault: 90,
      suffix: "%"
    });
  }

  if (window.lucide) window.lucide.createIcons();
}

function switchSensorChart() {
  activeSensorChart =
    activeSensorChart === "temperature" ? "humidity" : "temperature";

  renderSensorChart();
}

function renderLineChart({
  svgId,
  points,
  valueKey,
  minDefault,
  maxDefault,
  suffix
}) {
  const chartSvgEl = document.getElementById(svgId);
  if (!chartSvgEl) return;

  if (!points.length) {
    chartSvgEl.innerHTML = `
      <text
        x="285"
        y="100"
        fill="#81c784"
        font-size="16px"
        font-weight="600"
        text-anchor="middle"
      >
        Belum ada data ${suffix}
      </text>
    `;
    return;
  }

  const labels = points.map((item) => item.time);
  const values = points.map((item) => Number(item[valueKey]));

  const minVal = Math.min(...values, minDefault);
  const maxVal = Math.max(...values, maxDefault);

  const yVals = [];
  const steps = 4;

  for (let i = 0; i <= steps; i++) {
    const value = minVal + ((maxVal - minVal) / steps) * i;
    yVals.push(Number(value.toFixed(1)));
  }

  const leftX = 70;
  const rightX = 510;
  const chartTop = 35;
  const chartBottom = 165;
  const chartHeight = chartBottom - chartTop;
  const stepX = values.length > 1 ? (rightX - leftX) / (values.length - 1) : 0;

  function mapY(value) {
    if (maxVal === minVal) return chartBottom - chartHeight / 2;
    return chartBottom - ((value - minVal) / (maxVal - minVal)) * chartHeight;
  }

  const dataPoints = values.map((value, i) => ({
    value,
    x: values.length === 1 ? (leftX + rightX) / 2 : leftX + stepX * i,
    y: mapY(value)
  }));

  let svgHTML = "";

  yVals.forEach((v) => {
    const y = mapY(v);
    svgHTML += `<line x1="${leftX}" y1="${y}" x2="${rightX}" y2="${y}" stroke="#DDE7DB" stroke-dasharray="4 4" />`;
    svgHTML += `<text x="55" y="${y + 5}" fill="#58B95D" font-size="11px" font-weight="500" text-anchor="end">${v}${suffix}</text>`;
  });

  dataPoints.forEach((p, i) => {
    svgHTML += `<line x1="${p.x}" y1="${chartTop}" x2="${p.x}" y2="${chartBottom}" stroke="#E2E7E1" stroke-dasharray="4 4" />`;
    svgHTML += `<text x="${p.x}" y="185" fill="#58B95D" font-size="11px" font-weight="500" text-anchor="middle">${labels[i]}</text>`;
  });

  svgHTML += `<line x1="${leftX}" y1="${chartTop}" x2="${leftX}" y2="${chartBottom}" stroke="#7BC67E" stroke-width="1.2" />`;
  svgHTML += `<line x1="${leftX}" y1="${chartBottom}" x2="${rightX}" y2="${chartBottom}" stroke="#7BC67E" stroke-width="1.2" />`;

  const pathD = dataPoints
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
    .join(" ");

  svgHTML += `<path fill="none" stroke="#48A84D" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="${pathD}" />`;

  dataPoints.forEach((p) => {
    svgHTML += `<circle cx="${p.x}" cy="${p.y}" r="5" fill="#48A84D" stroke="#48A84D" stroke-width="2" />`;

    svgHTML += `
      <text
        x="${p.x}"
        y="${Math.max(p.y - 12, 16)}"
        fill="#2e7d32"
        font-size="11px"
        font-weight="600"
        text-anchor="middle"
      >
        ${p.value}${suffix}
      </text>
    `;
  });

  chartSvgEl.setAttribute("viewBox", "0 0 571 200");
  chartSvgEl.innerHTML = svgHTML;
}

// =========================
// CAMERA PREVIEW WITH ARROWS
// =========================
function normalizeCameraText(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim();
}

function cameraItemText(item) {
  return [
    item?.label,
    item?.source,
    item?.point,
    item?.title,
    item?.filename,
    item?.id
  ]
    .map(normalizeCameraText)
    .join(" ");
}

function getCameraCandidatesByType(type) {
  const target = normalizeCameraText(type);

  return cameraShots.filter((item) => {
    if (!item?.image) return false;
    if (brokenCameraImageUrls.has(item.image)) return false;

    const text = cameraItemText(item);

    if (target === "mobile") {
      return (
        text.includes("mobile") ||
        text.includes("hp") ||
        text.includes("handphone")
      );
    }

    if (target === "depan") {
      return (
        text.includes("depan") ||
        text.includes("front") ||
        text.includes("titik depan") ||
        text.includes("kamera depan") ||
        text.includes("camera depan")
      );
    }

    if (target === "belakang") {
      return (
        text.includes("belakang") ||
        text.includes("back") ||
        text.includes("titik belakang") ||
        text.includes("kamera belakang") ||
        text.includes("camera belakang")
      );
    }

    return false;
  });
}

function findLatestCameraByType(type) {
  const candidates = getCameraCandidatesByType(type);
  return candidates[0] || null;
}

function getCameraHistoryShots() {
  const sourceShots = mergeCameraShots(cameraShots, firebaseCameraShots, CAMERA_HISTORY_LIMIT);

  return sourceShots
    .filter((item) => {
      return item?.image && !brokenCameraImageUrls.has(item.image);
    })
    .sort((a, b) => {
    const timeA = Number(a.uploaded_at) || getCurrentTimestampMs(a.rawTime);
    const timeB = Number(b.uploaded_at) || getCurrentTimestampMs(b.rawTime);
    return timeB - timeA;
    })
    .slice(0, CAMERA_HISTORY_LIMIT);
}

function renderCam() {
  const titleEl = document.getElementById("cam-title");
  const imgEl = document.getElementById("cam-img");
  const timeEl = document.getElementById("cam-time");
  const subtitleEl = document.getElementById("cam-subtitle");
  const emptyEl = document.getElementById("cam-empty");

  if (!titleEl || !imgEl || !timeEl) return;

  const activeTab = cameraTabs[camIndex] || cameraTabs[0];
  const item = findLatestCameraByType(activeTab.type);

  titleEl.textContent = activeTab.title;

  if (subtitleEl) {
    if (activeTab.type === "mobile") {
      subtitleEl.textContent = "Capture dari aplikasi mobile";
    } else {
      subtitleEl.textContent = `Capture dari kamera ${activeTab.title.toLowerCase()}`;
    }
  }

  imgEl.onload = null;
  imgEl.onerror = null;
  imgEl.onclick = null;
  imgEl.style.cursor = "default";

  if (!item || !item.image) {
    imgEl.style.display = "none";
    imgEl.removeAttribute("src");
    imgEl.alt = `Belum ada gambar ${activeTab.title}`;

    if (emptyEl) {
      emptyEl.style.display = "flex";
      emptyEl.textContent = `Belum ada gambar ${activeTab.title}`;
    }

    timeEl.textContent = "-";

    if (window.lucide) window.lucide.createIcons();
    return;
  }

  imgEl.style.display = "none";

  if (emptyEl) {
    emptyEl.style.display = "flex";
    emptyEl.textContent = "Memuat gambar...";
  }

  imgEl.onload = () => {
    imgEl.style.display = "block";
    imgEl.style.cursor = "pointer";

    if (emptyEl) {
      emptyEl.style.display = "none";
    }

    timeEl.textContent = item.time || "-";
  };

  imgEl.onerror = () => {
    markCameraImageBroken(item.image);

    const nextItem = findLatestCameraByType(activeTab.type);

    if (nextItem && nextItem.image !== item.image) {
      renderCam();
      return;
    }

    imgEl.style.display = "none";
    imgEl.removeAttribute("src");
    imgEl.onclick = null;
    imgEl.style.cursor = "default";

    if (emptyEl) {
      emptyEl.style.display = "flex";
      emptyEl.textContent = `Belum ada gambar ${activeTab.title} yang bisa dibuka`;
    }

    timeEl.textContent = "-";
  };

  imgEl.src = item.image;
  imgEl.alt = item.title || activeTab.title;
  imgEl.onclick = () => openImagePreview(item);

  if (window.lucide) window.lucide.createIcons();
}

function nextCamera() {
  camIndex = (camIndex + 1) % cameraTabs.length;
  renderCam();
}

function prevCamera() {
  camIndex = (camIndex - 1 + cameraTabs.length) % cameraTabs.length;
  renderCam();
}

// =========================
// IMAGE PREVIEW
// =========================
function ensureImagePreviewModal() {
  let overlay = document.getElementById("imagePreviewOverlay");

  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "imagePreviewOverlay";
  overlay.style.display = "none";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "2147483647";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.background = "rgba(0, 0, 0, 0.88)";
  overlay.style.padding = "16px";

  overlay.innerHTML = `
    <div style="position: relative; max-width: 95vw; max-height: 95vh;">
      <button
        id="closeImagePreview"
        type="button"
        style="
          position: absolute;
          right: -12px;
          top: -12px;
          z-index: 2147483647;
          width: 42px;
          height: 42px;
          border-radius: 9999px;
          border: none;
          background: white;
          color: #4caf50;
          font-size: 28px;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        "
      >
        ×
      </button>

      <img
        id="imagePreviewImg"
        src=""
        alt="Full Preview"
        style="
          display: block;
          max-width: 95vw;
          max-height: 90vh;
          object-fit: contain;
          border-radius: 18px;
          background: white;
          box-shadow: 0 20px 60px rgba(0,0,0,0.45);
        "
      />

      <div
        id="imagePreviewTitle"
        style="
          margin-top: 12px;
          text-align: center;
          color: white;
          font-size: 15px;
          font-weight: 600;
        "
      ></div>
    </div>
  `;

  document.body.appendChild(overlay);
  return overlay;
}

function openImagePreview(item) {
  if (!item || !item.image) {
    console.log("Item gambar kosong");
    return;
  }

  const overlay = ensureImagePreviewModal();
  const img = document.getElementById("imagePreviewImg");
  const title = document.getElementById("imagePreviewTitle");

  if (!overlay || !img || !title) return;

  const modalOverlay = document.getElementById("modal-overlay");

  if (modalOverlay) {
    modalOverlay.style.display = "none";
  }

  img.src = item.image;
  img.alt = item.title || "Preview image";
  title.textContent = `${item.title || "Preview"} - ${item.time || "-"}`;

  document.body.appendChild(overlay);
  overlay.style.display = "flex";
}

function closeImagePreview() {
  const overlay = document.getElementById("imagePreviewOverlay");
  const img = document.getElementById("imagePreviewImg");

  if (overlay) {
    overlay.style.display = "none";
  }

  if (img) {
    img.src = "";
  }

  const modalOverlay = document.getElementById("modal-overlay");
  const modalCamera = document.getElementById("modal-camera");
  const modalDisease = document.getElementById("modal-disease");

  const cameraOpen = modalCamera && !modalCamera.classList.contains("hidden");
  const diseaseOpen = modalDisease && !modalDisease.classList.contains("hidden");

  if (modalOverlay && (cameraOpen || diseaseOpen)) {
    modalOverlay.style.display = "flex";
  }
}

// =========================
// MODAL
// =========================
function openModal(type) {
  const modalOverlay = document.getElementById("modal-overlay");
  const modalCamera = document.getElementById("modal-camera");
  const modalDisease = document.getElementById("modal-disease");

  if (!modalOverlay) return;

  modalOverlay.classList.remove("hidden");
  modalOverlay.style.display = "flex";

  if (type === "camera") {
    if (modalCamera) modalCamera.classList.remove("hidden");
    if (modalDisease) modalDisease.classList.add("hidden");

    cameraHistoryPages = [];
    cameraHistoryPage = 1;
    renderCameraHistoryGrid();
    fetchCameraHistoryPage(1, true);
  } else {
    if (modalDisease) modalDisease.classList.remove("hidden");
    if (modalCamera) modalCamera.classList.add("hidden");

    activeDiseaseHistoryCategory = type === "pest" ? "pest" : "disease";
    diseaseHistoryPages = [];
    diseaseHistoryPage = 1;
    updateDiseaseHistoryTitle();
    renderDiseaseHistoryGrid();
    fetchInferenceHistoryPage(1, true);
  }

  if (window.lucide) window.lucide.createIcons();
}

function updateDiseaseHistoryTitle() {
  const title = document.getElementById("diseaseHistoryTitle");
  if (!title) return;

  title.textContent =
    activeDiseaseHistoryCategory === "pest" ? "Riwayat Hama" : "Riwayat Penyakit";
}

function getPagedItems(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / HISTORY_PAGE_SIZE));
  const safePage = Math.min(Math.max(Number(page) || 1, 1), totalPages);
  const startIndex = (safePage - 1) * HISTORY_PAGE_SIZE;

  return {
    items: items.slice(startIndex, startIndex + HISTORY_PAGE_SIZE),
    page: safePage,
    totalPages,
    startIndex,
    totalItems: items.length
  };
}

function renderHistoryPagination(type, pageInfo) {
  const isCamera = type === "camera";
  const pagination = document.getElementById(
    isCamera ? "cam-history-pagination" : "disease-history-pagination"
  );

  if (!pagination) return;

  if (!pageInfo.totalItems || pageInfo.totalPages <= 1) {
    pagination.innerHTML = "";
    return;
  }

  const buttonColor = isCamera ? "text-[#2e7d32] border-[#c5e1a5]" : "text-[#e65100] border-[#ffe0b2]";
  const disabledClass = "opacity-50 cursor-not-allowed";
  const prevDisabled = pageInfo.page <= 1;
  const nextDisabled = pageInfo.serverPaged
    ? !pageInfo.hasMore
    : pageInfo.page >= pageInfo.totalPages;
  const pageLabel = pageInfo.serverPaged
    ? `Halaman ${pageInfo.page}`
    : `Halaman ${pageInfo.page} dari ${pageInfo.totalPages} - ${pageInfo.totalItems} data`;

  pagination.innerHTML = `
    <button
      type="button"
      class="history-page-prev rounded-xl border bg-white px-4 py-2 text-sm font-semibold ${buttonColor} ${prevDisabled ? disabledClass : "hover:bg-[#f7fbf4]"}"
      ${prevDisabled ? "disabled" : ""}
    >
      Sebelumnya
    </button>
    <div class="text-sm font-semibold ${isCamera ? "text-[#2e7d32]" : "text-[#e65100]"}">
      ${pageLabel}
    </div>
    <button
      type="button"
      class="history-page-next rounded-xl border bg-white px-4 py-2 text-sm font-semibold ${buttonColor} ${nextDisabled ? disabledClass : "hover:bg-[#f7fbf4]"}"
      ${nextDisabled ? "disabled" : ""}
    >
      Berikutnya
    </button>
  `;

  pagination.querySelector(".history-page-prev")?.addEventListener("click", () => {
    if (isCamera) {
      fetchCameraHistoryPage(cameraHistoryPage - 1);
    } else {
      fetchInferenceHistoryPage(diseaseHistoryPage - 1);
    }
  });

  pagination.querySelector(".history-page-next")?.addEventListener("click", () => {
    if (isCamera) {
      fetchCameraHistoryPage(cameraHistoryPage + 1);
    } else {
      fetchInferenceHistoryPage(diseaseHistoryPage + 1);
    }
  });
}

function renderCameraHistoryGrid() {
  const grid = document.getElementById("cam-history-grid");
  if (!grid) return;

  let html = "";
  const currentPage = cameraHistoryPages[cameraHistoryPage - 1];
  const serverItems = currentPage?.items || [];
  const fallbackShots = getCameraHistoryShots();
  const fallbackStart = (Math.max(Number(cameraHistoryPage) || 1, 1) - 1) * HISTORY_PAGE_SIZE;
  const fallbackPageItems = fallbackShots.slice(
    fallbackStart,
    fallbackStart + HISTORY_PAGE_SIZE
  );
  const usingLocalFallback =
    !serverItems.length && !cameraHistoryLoading && fallbackPageItems.length > 0;
  const pageCameraShots = usingLocalFallback ? fallbackPageItems : serverItems;
  const pageInfo = {
    page: cameraHistoryPage,
    totalPages: usingLocalFallback
      ? Math.max(Math.ceil(fallbackShots.length / HISTORY_PAGE_SIZE), 1)
      : currentPage?.hasMore ? cameraHistoryPage + 1 : cameraHistoryPage,
    totalItems: pageCameraShots.length,
    hasMore: usingLocalFallback
      ? fallbackShots.length > fallbackStart + HISTORY_PAGE_SIZE
      : Boolean(currentPage?.hasMore),
    serverPaged: !usingLocalFallback
  };

  if (cameraHistoryLoading && !currentPage) {
    html = `
      <div class="col-span-full rounded-[16px] border border-[#e2ece0] bg-[#f1f8e9] p-6 text-center text-[#2e7d32]">
        Memuat riwayat kamera...
      </div>
    `;
  } else if (currentPage?.error) {
    html = `
      <div class="col-span-full rounded-[16px] border border-[#e2ece0] bg-[#f1f8e9] p-6 text-center text-[#2e7d32]">
        Gagal memuat halaman riwayat kamera
      </div>
    `;
  } else if (!pageCameraShots.length) {
    html = `
      <div class="col-span-full rounded-[16px] border border-[#e2ece0] bg-[#f1f8e9] p-6 text-center text-[#2e7d32]">
        Belum ada riwayat gambar kamera
      </div>
    `;
  } else {
    pageCameraShots.forEach((item, index) => {
      html += `
        <button
          type="button"
          class="camera-history-card cursor-pointer rounded-[16px] border border-[#e2ece0] bg-[#f1f8e9] overflow-hidden text-left transition hover:scale-[1.02] hover:shadow-lg"
          data-index="${index}"
        >
          <img
            src="${escapeHtml(item.image || "")}"
            class="camera-history-img h-40 w-full object-cover"
            alt="${escapeHtml(item.title || "Camera")}"
            loading="lazy"
          />
          <div class="p-4">
            <div class="font-semibold text-[#2e7d32] mb-1">${escapeHtml(item.title || "Camera")}</div>
            <div class="text-[13px] text-[#66bb6a]">${escapeHtml(item.time || "-")}</div>
            <div class="mt-2 text-[12px] font-semibold text-[#4caf50]">
              Klik untuk lihat gambar penuh
            </div>
          </div>
        </button>
      `;
    });
  }

  grid.innerHTML = html;
  renderHistoryPagination("camera", {
    ...pageInfo,
    totalItems: pageCameraShots.length || (cameraHistoryPage > 1 ? 1 : 0)
  });

  grid.querySelectorAll(".camera-history-card").forEach((card) => {
    const index = Number(card.dataset.index);
    const item = pageCameraShots[index];
    const img = card.querySelector(".camera-history-img");

    if (img) {
      img.addEventListener("error", () => {
        markCameraImageBroken(item?.image);
        card.remove();
        renderCam();

        if (!grid.querySelector(".camera-history-card")) {
          grid.innerHTML = `
            <div class="col-span-full rounded-[16px] border border-[#e2ece0] bg-[#f1f8e9] p-6 text-center text-[#2e7d32]">
              Belum ada riwayat gambar kamera yang bisa dibuka
            </div>
          `;
        }
      });
    }

    card.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!item || brokenCameraImageUrls.has(item.image)) return;

      openImagePreview(item);
    });
  });
}

function refreshCameraHistoryModalIfOpen() {
  const modalCamera = document.getElementById("modal-camera");

  if (modalCamera && !modalCamera.classList.contains("hidden")) {
    renderCameraHistoryGrid();
  }
}

function renderDiseaseHistoryGrid() {
  const diseaseGrid = document.getElementById("disease-history-grid");
  if (!diseaseGrid) return;

  let html = "";
  const currentPage = diseaseHistoryPages[diseaseHistoryPage - 1];
  const categoryItems = sortDetectionsNewestFirst(
    diseaseItems.filter((item) => item?.category === activeDiseaseHistoryCategory)
  );
  const fallbackStart = (Math.max(Number(diseaseHistoryPage) || 1, 1) - 1) * HISTORY_PAGE_SIZE;
  const fallbackPageItems = categoryItems.slice(
    fallbackStart,
    fallbackStart + HISTORY_PAGE_SIZE
  );
  const serverItems = sortDetectionsNewestFirst(currentPage?.items || []);
  const usingLocalFallback =
    !serverItems.length && !diseaseHistoryLoading && fallbackPageItems.length > 0;
  const pageDiseaseItems = usingLocalFallback ? fallbackPageItems : serverItems;
  const pageInfo = {
    page: diseaseHistoryPage,
    totalPages: usingLocalFallback
      ? Math.max(Math.ceil(categoryItems.length / HISTORY_PAGE_SIZE), 1)
      : currentPage?.hasMore
        ? diseaseHistoryPage + 1
        : diseaseHistoryPage,
    totalItems: pageDiseaseItems.length,
    hasMore: usingLocalFallback
      ? categoryItems.length > fallbackStart + HISTORY_PAGE_SIZE
      : Boolean(currentPage?.hasMore),
    serverPaged: !usingLocalFallback
  };
  const emptyLabel =
    activeDiseaseHistoryCategory === "pest" ? "hama" : "penyakit";

  if (diseaseHistoryLoading && !currentPage) {
    html = `
      <div class="col-span-full rounded-[16px] border border-[#ffe0b2] bg-white p-6 text-center text-[#e65100]">
        Memuat riwayat ${emptyLabel}...
      </div>
    `;
  } else if (currentPage?.error && !usingLocalFallback) {
    html = `
      <div class="col-span-full rounded-[16px] border border-[#ffe0b2] bg-white p-6 text-center text-[#e65100]">
        Gagal memuat halaman riwayat ${emptyLabel}
      </div>
    `;
  } else if (!pageDiseaseItems.length) {
    html = `
      <div class="col-span-full rounded-[16px] border border-[#ffe0b2] bg-white p-6 text-center text-[#e65100]">
        Belum ada riwayat ${emptyLabel}
      </div>
    `;
  } else {
    pageDiseaseItems.forEach((item, index) => {
      const handled = getItemHandledStatus(item);
      const handledLabel = handled ? "Sudah ditangani" : "Belum ditangani";
      const handledClass = handled ? "text-[#4caf50]" : "text-[#f57c00]";
      const environmentLabel =
        item.environment_label || formatEnvironmentInfo(item.environment || {});
      const environmentHtml = environmentLabel
        ? `
            <div class="mb-2 rounded-[10px] bg-[#f1f8e9] px-3 py-2 text-[12px] font-semibold text-[#2e7d32]">
              ${environmentLabel}
            </div>
          `
        : "";

      html += `
        <button
          type="button"
          class="disease-history-card cursor-pointer rounded-[16px] border border-[#ffe0b2] bg-white overflow-hidden shadow-sm text-left transition hover:scale-[1.02] hover:shadow-lg"
          data-index="${index}"
        >
          <img src="${escapeHtml(item.image || "assets/img/disease-preview.svg")}" class="h-40 w-full object-cover" alt="${escapeHtml(item.title || "Disease")}">

          <div class="p-4">
            <div class="font-bold text-[#e65100] mb-2">
              ${escapeHtml(item.title || "Unknown Detection")}
            </div>

            <div class="mb-2 inline-flex rounded-full bg-[#fff1e0] px-3 py-1 text-[12px] font-bold text-[#ef6c00]">
              ${escapeHtml(item.type || "Detection")}
            </div>

            <div class="text-[13px] text-[#fb8c00] mb-1">
              ${escapeHtml(item.time || "-")}
            </div>

            ${environmentHtml}

            <div class="text-[13px] text-[#757575] mb-2">
              ${escapeHtml(item.garden || item.camera || "Camera")}
            </div>

            <div class="mb-2 text-[13px] font-semibold text-[#2e7d32]">
              Confidence: ${escapeHtml(item.confidence || 0)}%
            </div>

            <div class="mb-2 text-[12px] font-semibold ${handledClass}">
              ${handledLabel}
            </div>

            <div class="text-[12px] font-semibold text-[#ff9800]">
              ${escapeHtml(item.sync_status || "-")}
            </div>
          </div>
        </button>
      `;
    });
  }

  diseaseGrid.innerHTML = html;
  renderHistoryPagination("disease", {
    ...pageInfo,
    totalItems: pageDiseaseItems.length || (diseaseHistoryPage > 1 ? 1 : 0)
  });

  diseaseGrid.querySelectorAll(".disease-history-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const index = Number(card.dataset.index);
      openImagePreview(pageDiseaseItems[index]);
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

function refreshDiseaseHistoryModalIfOpen() {
  const modalDisease = document.getElementById("modal-disease");

  if (modalDisease && !modalDisease.classList.contains("hidden")) {
    renderDiseaseHistoryGrid();
  }
}

function closeModal() {
  const modalOverlay = document.getElementById("modal-overlay");
  const modalCamera = document.getElementById("modal-camera");
  const modalDisease = document.getElementById("modal-disease");

  if (modalOverlay) {
    modalOverlay.classList.add("hidden");
    modalOverlay.style.display = "";
  }

  if (modalCamera) modalCamera.classList.add("hidden");
  if (modalDisease) modalDisease.classList.add("hidden");
}

// =========================
// ACTIVE ALERT UI
// =========================
function renderDiseaseAlert() {
  const section = document.getElementById("diseaseAlertSection");
  if (!section) return;

  const confidenceValue = getSafeConfidence(activeDiseaseAlert.confidence);
  const confidenceColor = getConfidenceBarColor(confidenceValue);

  const titleEl = document.getElementById("disease-title");
  const timeEl = document.getElementById("disease-time");
  const descEl = document.getElementById("disease-description");
  const solutionEl = document.getElementById("disease-solution");
  const imgEl = document.getElementById("disease-preview-img");
  const confidenceText = document.getElementById("disease-confidence-text");
  const confidenceBar = document.getElementById("disease-confidence-bar");

  if (titleEl) titleEl.textContent = activeDiseaseAlert.title || "Unknown Detection";
  if (timeEl) timeEl.textContent = activeDiseaseAlert.time || "-";

  if (descEl) {
    descEl.textContent =
      activeDiseaseAlert.description ||
      "Hasil deteksi penyakit/hama tanaman dari sistem inference.";
  }

  if (solutionEl) {
    solutionEl.textContent =
      activeDiseaseAlert.solution ||
      "Lakukan pengecekan visual pada tanaman dan pantau kondisi lingkungan.";
  }

  if (imgEl) {
    imgEl.src = activeDiseaseAlert.image || "assets/img/disease-preview.svg";
  }

  if (confidenceText) {
    confidenceText.textContent = `${confidenceValue}%`;
  }

  if (confidenceBar) {
    confidenceBar.style.width = `${confidenceValue}%`;
    confidenceBar.style.backgroundColor = confidenceColor;
    confidenceBar.style.transition = "width 0.4s ease";
  }

  const handledBtn = document.getElementById("markHandledBtn");

  if (!handledBtn) return;

  if (activeDiseaseAlert.handled) {
    handledBtn.disabled = true;
    handledBtn.innerHTML = `
      <i data-lucide="check-circle" class="h-5 w-5"></i>
      Ditangani
    `;
    handledBtn.className =
      "flex items-center gap-2 rounded-[16px] bg-[#81c784] px-8 py-4 text-[15px] font-semibold text-white shadow-md cursor-default";
  } else {
    handledBtn.disabled = false;
    handledBtn.innerHTML = `
      <i data-lucide="check-circle" class="h-5 w-5"></i>
      Sudah Ditangani
    `;
    handledBtn.className =
      "flex items-center gap-2 rounded-[16px] bg-[#4caf50] px-8 py-4 text-[15px] font-semibold text-white shadow-md hover:bg-[#43a047] transition";
  }

  if (window.lucide) window.lucide.createIcons();
}

function getNextUnhandledDisease(currentId) {
  return diseaseItems.find((item) => {
    return item.id !== currentId && !getItemHandledStatus(item);
  });
}

function animateToNextDiseaseAlert(nextItem) {
  const section = document.getElementById("diseaseAlertSection");
  if (!section) return;

  section.style.willChange = "transform, opacity";
  section.style.transition = "transform 0.28s ease, opacity 0.28s ease";
  section.style.transform = "translateX(-24px)";
  section.style.opacity = "0";

  setTimeout(() => {
    if (nextItem) {
      setActiveAlertFromItem(nextItem);
      renderDiseaseAlert();
    } else {
      setNoActiveDiseaseAlert();
      renderDiseaseAlert();
    }

    section.classList.remove("hidden");
    section.style.transition = "none";
    section.style.transform = "translateX(24px)";
    section.style.opacity = "0";

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        section.style.transition = "transform 0.28s ease, opacity 0.28s ease";
        section.style.transform = "translateX(0)";
        section.style.opacity = "1";
      });
    });
  }, 280);
}

function hideDiseaseAlert() {
  const section = document.getElementById("diseaseAlertSection");
  if (section) section.classList.add("hidden");
}

// =========================
// INIT
// =========================
document.addEventListener("DOMContentLoaded", () => {
  if (!shouldSkipCloudFetch()) {
    ensureFirebaseAuth()
      .then(() => {
        console.log("Firebase Auth aktif. Write auth != null siap digunakan.");
      })
      .catch((error) => {
        console.error("Gagal login Firebase Auth:", error);
      });
  }

  loadNotifications();
  initializeDetectionNotificationCursor();
  updateOnlineStatus();

  ensureImagePreviewModal();

  document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "closeImagePreview") {
      closeImagePreview();
    }

    if (e.target && e.target.id === "imagePreviewOverlay") {
      closeImagePreview();
    }
  });

  const cached = loadCache();

  if (cached) {
    updateMainSensorCard(cached);
  }

  realtimeTempPoints = loadTempHistory();
  realtimeHumidityPoints = loadHumidityHistory();

  const cachedCamera = localStorage.getItem("cameraShots");

  if (cachedCamera) {
    try {
      cameraShots = JSON.parse(cachedCamera).filter((item) => {
        return item?.image && !brokenCameraImageUrls.has(item.image);
      }).slice(0, CAMERA_HISTORY_LIMIT);
      firebaseCameraShots = cameraShots;
      markCameraE2EItemsAsSeen(cameraShots);
    } catch {
      cameraShots = [];
      firebaseCameraShots = [];
    }
  }

  const cachedDisease = localStorage.getItem("diseaseItems");

  if (cachedDisease) {
    try {
      diseaseItems = cleanDiseaseHistoryItems(JSON.parse(cachedDisease));

      if (diseaseItems.length > 0) {
        const latestUnhandled = getLatestDetectionItem(diseaseItems);

        if (latestUnhandled) {
          setActiveAlertFromItem(latestUnhandled);
        } else {
          setNoActiveDiseaseAlert();
        }

        markDetectionsSeenForNotifications(diseaseItems);
      }
    } catch {
      diseaseItems = [];
    }
  }

  renderSensorChart();
  initQoSMonitoring();
  renderCam();
  renderNotifications();
  fetchFirebaseNotifications();
  renderDiseaseAlert();

  fetchLocalInferenceLatest();
  fetchLocalInferenceHistory();
  fetchPendingCameraCaptures();

  fetchLatestSensor();
  fetchSensorHistory();
  fetchCameraCaptures();
  fetchDiseaseHistory();

  setInterval(fetchLocalInferenceLatest, 5000);
  setInterval(fetchLocalInferenceHistory, 10000);
  setInterval(fetchPendingCameraCaptures, 5000);

  setInterval(fetchLatestSensor, 5000);
  setInterval(fetchSensorHistory, 30000);
  setInterval(fetchFirebaseNotifications, 15000);
  setInterval(fetchCameraCaptures, HEAVY_FIREBASE_POLL_INTERVAL_MS);
  setInterval(fetchDiseaseHistory, HEAVY_FIREBASE_POLL_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;

    fetchCameraCaptures();
    fetchDiseaseHistory();
  });

  document
    .getElementById("switchChartBtn")
    ?.addEventListener("click", switchSensorChart);

  document.getElementById("nextCamBtn")?.addEventListener("click", nextCamera);
  document.getElementById("prevCamBtn")?.addEventListener("click", prevCamera);

  document
    .getElementById("openCameraModal")
    ?.addEventListener("click", () => openModal("camera"));

  document
    .getElementById("openDiseaseModal")
    ?.addEventListener("click", () => openModal("disease"));

  document
    .getElementById("openPestModal")
    ?.addEventListener("click", () => openModal("pest"));

  document.getElementById("closeModal")?.addEventListener("click", closeModal);

  document
    .getElementById("closeDiseaseModal")
    ?.addEventListener("click", closeModal);

  document
    .getElementById("markHandledBtn")
    ?.addEventListener("click", markDiseaseHandled);

  document
    .getElementById("closeDiseaseBtn")
    ?.addEventListener("click", hideDiseaseAlert);

  document
    .getElementById("closeDiseaseAlertBtn")
    ?.addEventListener("click", hideDiseaseAlert);

  document.getElementById("modal-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  });

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

  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);

  if (window.lucide) window.lucide.createIcons();
});
