const { createHmac, createHash, timingSafeEqual, randomUUID } = require("node:crypto");
const config = require("./config");

/** Comparacao em tempo constante para strings de qualquer tamanho. */
function safeEqual(a, b) {
  const left = createHash("sha256").update(String(a)).digest();
  const right = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(left, right);
}

function sign(value) {
  return createHmac("sha256", config.sessionSecret).update(value).digest("hex");
}

function base32Decode(value = "") {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of value.replace(/=+$/g, "")) {
    const index = alphabet.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function verifyTotp(token = "", secret = "", now = Date.now()) {
  const normalized = String(token).replace(/\D/g, "");
  if (!secret || normalized.length !== 6) return false;
  const currentStep = Math.floor(now / 30_000);
  try {
    for (let offset = -1; offset <= 1; offset += 1) {
      if (safeEqual(normalized, hotp(secret, currentStep + offset))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function createSessionValue(now = Date.now()) {
  const payload = `admin:${now}:${randomUUID()}`;
  return `${payload}.${sign(payload)}`;
}

function isValidSession(value = "", now = Date.now()) {
  const index = value.lastIndexOf(".");
  if (index === -1) return false;
  const payload = value.slice(0, index);
  if (!safeEqual(value.slice(index + 1), sign(payload))) return false;
  const [role, issuedAt] = payload.split(":");
  const age = now - Number(issuedAt);
  return role === "admin" && Number.isFinite(age) && age >= 0 && age <= config.sessionMaxAgeSeconds * 1000;
}

function parseCookies(request) {
  const cookies = {};
  for (const part of String(request.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    try {
      cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      // cookie malformado: ignora
    }
  }
  return cookies;
}

function isHttps(request) {
  return Boolean(request.socket.encrypted) || (config.trustProxy && request.headers["x-forwarded-proto"] === "https") || config.publicBaseUrl.startsWith("https://");
}

function sessionCookie(request, value, maxAge) {
  return `meu_mimo_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(request) ? "; Secure" : ""}`;
}

function clientIp(request) {
  if (config.trustProxy) {
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return request.socket.remoteAddress || "unknown";
}

/** Limitador simples em memoria (janela fixa). Suficiente para uma unica instancia. */
function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  timer.unref();
  return {
    /** Registra uma tentativa; devolve segundos de espera quando o limite estourou, senao 0. */
    hit(key) {
      const now = Date.now();
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return entry.count > limit ? Math.ceil((entry.resetAt - now) / 1000) : 0;
    },
    reset(key) { hits.delete(key); },
    clear() { hits.clear(); }
  };
}

module.exports = { safeEqual, hotp, verifyTotp, createSessionValue, isValidSession, parseCookies, sessionCookie, clientIp, createRateLimiter };
