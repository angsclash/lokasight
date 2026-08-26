// api/qos-live.js
// Vercel Serverless Function — generate data dummy QoS "fresh" setiap kali di-fetch,
// jadi dashboard TIDAK PERNAH menganggapnya basi (beda dengan file JSON statis).
//
// Setelah file ini ada di repo (folder /api di root project), Vercel otomatis
// mendeploy-nya sebagai endpoint: https://<domain-kamu>.vercel.app/api/qos-live

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function mean(arr) {
  const v = arr.filter((x) => x !== null && x !== undefined);
  if (!v.length) return null;
  return Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(6));
}

function buildRow(index, ts, anomaly) {
  const wave = Math.sin(index / 6) * 0.5 + 0.5;

  let latency = Number((0.03 + wave * 0.03 + (Math.random() * 0.03 - 0.01)).toFixed(4));
  let packetLoss = Number(clamp(0.6 + (Math.random() - 0.5) * 1.2, 0, 4).toFixed(2));
  let throughput = Number((8 + wave * 10 + (Math.random() * 4 - 2)).toFixed(3));
  let cpu = Number(clamp(28 + wave * 20 + (Math.random() * 10 - 5), 5, 95).toFixed(2));
  let memory = Number(clamp(45 + wave * 15 + (Math.random() * 10 - 5), 10, 95).toFixed(2));
  let apiLatency = Number((latency + Math.random() * 0.02 + 0.01).toFixed(4));

  if (anomaly === "latency") {
    latency = Number((1.05 + Math.random() * 0.75).toFixed(4));
    apiLatency = Number((latency + 0.02).toFixed(4));
  } else if (anomaly === "packet_loss") {
    packetLoss = Number((6 + Math.random() * 6).toFixed(2));
  } else if (anomaly === "throughput") {
    throughput = Number((0.2 + Math.random() * 0.7).toFixed(3));
  } else if (anomaly === "cpu") {
    cpu = Number((86 + Math.random() * 11).toFixed(2));
  } else if (anomaly === "memory") {
    memory = Number((87 + Math.random() * 9).toFixed(2));
  }

  return {
    timestamp: ts.toISOString(),
    date: ts.toISOString().slice(0, 10),
    time: ts.toTimeString().slice(0, 8),
    request_number: index + 1,
    system_mode: "online",
    api_url: "https://lokasight-api.example.com/health",
    ping_target: "8.8.8.8",
    throughput_test_url: "https://lokasight-api.example.com/throughput-test",
    cpu_usage_percent: cpu,
    memory_usage_percent: memory,
    packet_loss_percent: packetLoss,
    network_latency_seconds: latency,
    latency_seconds: apiLatency,
    throughput_mbps: throughput,
    throughput_MBps: Number((throughput / 8).toFixed(4)),
    success: true,
    http_status: 200,
    error: ""
  };
}

export default function handler(req, res) {
  const now = new Date();
  const NUM_POINTS = 40;
  const INTERVAL_MIN = 2.5;
  const anomalySlots = { 6: "latency", 14: "packet_loss", 21: "cpu", 27: "throughput", 33: "memory" };

  const start = new Date(now.getTime() - INTERVAL_MIN * 60 * 1000 * (NUM_POINTS - 1));
  const rows = [];

  for (let i = 0; i < NUM_POINTS; i++) {
    const ts = new Date(start.getTime() + i * INTERVAL_MIN * 60 * 1000);
    rows.push(buildRow(i, ts, anomalySlots[i]));
  }

  // Titik terakhir dibuat sehat & sangat baru
  rows[NUM_POINTS - 1] = buildRow(NUM_POINTS - 1, new Date(now.getTime() - 5000));
  rows[NUM_POINTS - 1].network_latency_seconds = 0.065; // sedikit jitter demo

  const latencies = rows.map((r) => r.latency_seconds);
  const throughputs = rows.map((r) => r.throughput_mbps);
  const cpuValues = rows.map((r) => r.cpu_usage_percent);
  const memValues = rows.map((r) => r.memory_usage_percent);
  const packetLossValues = rows.map((r) => r.packet_loss_percent);

  const diffs = rows.slice(1).map((r, i) => Math.abs(r.network_latency_seconds - rows[i].network_latency_seconds));
  const jitter = mean(diffs) ?? 0;

  const summary = {
    avg_latency_seconds: mean(latencies),
    avg_throughput_mbps: mean(throughputs),
    avg_packet_loss_percent: mean(packetLossValues),
    avg_cpu_usage_percent: mean(cpuValues),
    avg_memory_usage_percent: mean(memValues),
    jitter_seconds: jitter
  };

  const dhtTs = new Date(now.getTime() - 20000);

  const live = {
    updated_at: now.toISOString(),
    system_mode: "online",
    api_url: "https://lokasight-api.example.com/health",
    ping_target: "8.8.8.8",
    raspberry_pi_uptime_seconds: 267340,
    system_status: {
      raspberry_pi_online: true,
      raspberry_pi_status: "online",
      raspberry_pi_uptime_seconds: 267340,
      dht_online: true,
      dht_status: {
        online: true,
        temperature: Number((24 + Math.random() * 5).toFixed(1)),
        humidity: Number((55 + Math.random() * 20).toFixed(1)),
        timestamp: dhtTs.toISOString().slice(0, 19).replace("T", " "),
        timestamp_iso: dhtTs.toISOString(),
        timestampMillis: dhtTs.getTime()
      }
    },
    total_recorded: rows.length,
    successful_requests: rows.length,
    failed_requests: 0,
    success_rate_percent: 100,
    latest: rows[rows.length - 1],
    current_average: summary,
    history: rows
  };

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(200).json(live);
}
