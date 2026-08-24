// Local-only auth helper for offline dashboard access.
// This improves casual security, but client-side auth can still be bypassed by a determined user.
(function () {
  const SESSION_KEY = "lokasight_auth_session";
  const LOCK_KEY = "lokasight_login_lock";
  const USERS = [
    {
      username: "admin",
      passwordHash: "0fH94cZZvkx+jRymMNkezX4StonaZ6/GAjNp6Nz/YdI="
    },
    {
      username: "lokasight",
      passwordHash: "96YhG2kJB1fJgriUImmkKAKtOUcJ0Trld2MSooG6ajo="
    }
  ];
  const PASSWORD_SALT = "lokasight-web-login-v1";
  const HASH_ITERATIONS = 10000;
  const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
  const MAX_FAILED_ATTEMPTS = 5;
  const LOCK_DURATION_MS = 30 * 1000;

  function now() {
    return Date.now();
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function stringToBytes(value) {
    if (window.TextEncoder) {
      return Array.from(new TextEncoder().encode(value));
    }

    const bytes = [];
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else {
        bytes.push(
          0xe0 | (code >> 12),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f)
        );
      }
    }
    return bytes;
  }

  function rightRotate(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
  }

  function sha256(inputBytes) {
    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
      0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
      0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
      0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
      0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
      0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];
    const bytes = inputBytes.slice();
    const bitLength = bytes.length * 8;

    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);

    for (let i = 7; i >= 0; i -= 1) {
      bytes.push((bitLength / (2 ** (i * 8))) & 0xff);
    }

    for (let chunk = 0; chunk < bytes.length; chunk += 64) {
      const words = new Array(64);

      for (let i = 0; i < 16; i += 1) {
        const offset = chunk + i * 4;
        words[i] =
          ((bytes[offset] << 24) |
            (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) |
            bytes[offset + 3]) >>> 0;
      }

      for (let i = 16; i < 64; i += 1) {
        const s0 =
          rightRotate(words[i - 15], 7) ^
          rightRotate(words[i - 15], 18) ^
          (words[i - 15] >>> 3);
        const s1 =
          rightRotate(words[i - 2], 17) ^
          rightRotate(words[i - 2], 19) ^
          (words[i - 2] >>> 10);
        words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
      }

      let [a, b, c, d, e, f, g, h] = hash;

      for (let i = 0; i < 64; i += 1) {
        const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + s1 + ch + constants[i] + words[i]) >>> 0;
        const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }

    return hash.flatMap((word) => [
      (word >>> 24) & 0xff,
      (word >>> 16) & 0xff,
      (word >>> 8) & 0xff,
      word & 0xff
    ]);
  }

  function hmacSha256(keyBytes, messageBytes) {
    let key = keyBytes.slice();
    if (key.length > 64) key = sha256(key);
    while (key.length < 64) key.push(0);

    const outerKey = key.map((byte) => byte ^ 0x5c);
    const innerKey = key.map((byte) => byte ^ 0x36);
    return sha256(outerKey.concat(sha256(innerKey.concat(messageBytes))));
  }

  function pbkdf2Sha256Fallback(password, salt, iterations) {
    const passwordBytes = stringToBytes(password);
    const saltBytes = stringToBytes(salt).concat([0, 0, 0, 1]);
    let block = hmacSha256(passwordBytes, saltBytes);
    const output = block.slice();

    for (let i = 1; i < iterations; i += 1) {
      block = hmacSha256(passwordBytes, block);
      for (let j = 0; j < output.length; j += 1) {
        output[j] ^= block[j];
      }
    }

    return bytesToBase64(output);
  }

  async function hashPassword(password) {
    if (!crypto?.subtle) {
      return pbkdf2Sha256Fallback(password, PASSWORD_SALT, HASH_ITERATIONS);
    }

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: encoder.encode(PASSWORD_SALT),
        iterations: HASH_ITERATIONS,
        hash: "SHA-256"
      },
      keyMaterial,
      256
    );

    return bytesToBase64(new Uint8Array(bits));
  }

  function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;

    let mismatch = 0;
    for (let i = 0; i < a.length; i += 1) {
      mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return mismatch === 0;
  }

  function getLockState() {
    const lock = readJson(LOCK_KEY, { failedAttempts: 0, lockedUntil: 0 });

    if (Number(lock.lockedUntil || 0) <= now()) {
      return {
        failedAttempts: Number(lock.failedAttempts || 0),
        lockedUntil: 0
      };
    }

    return lock;
  }

  function clearLock() {
    localStorage.removeItem(LOCK_KEY);
  }

  function registerFailedAttempt() {
    const lock = getLockState();
    const failedAttempts = Number(lock.failedAttempts || 0) + 1;
    const shouldLock = failedAttempts >= MAX_FAILED_ATTEMPTS;

    writeJson(LOCK_KEY, {
      failedAttempts,
      lockedUntil: shouldLock ? now() + LOCK_DURATION_MS : 0
    });
  }

  function createSession(username) {
    writeJson(SESSION_KEY, {
      username,
      loginAt: now(),
      expiresAt: now() + SESSION_TTL_MS
    });
  }

  function getSession() {
    const session = readJson(SESSION_KEY, null);
    if (!session || Number(session.expiresAt || 0) <= now()) {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem("lokatani_login");
      return null;
    }

    return session;
  }

  async function login(username, password) {
    const lock = getLockState();

    if (lock.lockedUntil && lock.lockedUntil > now()) {
      return {
        ok: false,
        reason: "locked",
        retryAfterSeconds: Math.ceil((lock.lockedUntil - now()) / 1000)
      };
    }

    const normalizedUsername = String(username || "").trim();
    const passwordHash = await hashPassword(String(password || ""));
    const user = USERS.find((item) => item.username === normalizedUsername);
    const isValid = Boolean(
      user && timingSafeEqual(passwordHash, user.passwordHash)
    );

    if (!isValid) {
      registerFailedAttempt();
      return {
        ok: false,
        reason: "invalid"
      };
    }

    clearLock();
    createSession(normalizedUsername);
    localStorage.setItem("lokatani_login", "true");

    return {
      ok: true
    };
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("lokatani_login");
    window.location.replace("login.html");
  }

  function requireLogin() {
    if (!getSession()) {
      window.location.replace("login.html");
      return false;
    }

    return true;
  }

  window.LokasightAuth = {
    getSession,
    login,
    logout,
    requireLogin
  };
})();
