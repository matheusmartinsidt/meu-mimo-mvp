const { join } = require("node:path");
const { randomBytes } = require("node:crypto");

const env = process.env;
const ROOT = process.cwd();
const DATA_DIR = env.DATA_DIR || join(ROOT, "data");
const ADMIN_PORT = env.ADMIN_PORT || "3001";
const ADMIN_2FA_SECRET = String(env.ADMIN_2FA_SECRET || "").replace(/\s+/g, "").toUpperCase();

const warnings = [];
let sessionSecret = env.SESSION_SECRET || "";
if (!sessionSecret) {
  sessionSecret = randomBytes(32).toString("hex");
  warnings.push("SESSION_SECRET nao definido: usando segredo aleatorio (as sessoes do painel caem a cada reinicio).");
}
if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
  warnings.push("ADMIN_EMAIL/ADMIN_PASSWORD nao definidos: o login do painel fica desativado.");
} else if (env.ADMIN_PASSWORD === "troque-essa-senha") {
  warnings.push("ADMIN_PASSWORD esta com o valor padrao. Troque antes de publicar.");
}

const paymentProvider = (env.PAYMENT_PROVIDER || (env.MERCADO_PAGO_ACCESS_TOKEN ? "mercado-pago" : "manual")).trim().toLowerCase();

module.exports = {
  port: Number(env.PORT || 3000),
  host: env.HOST || "0.0.0.0",
  seedPath: join(DATA_DIR, "store.json"),
  localDbPath: join(DATA_DIR, "db.local.json"),
  uploadDir: join(DATA_DIR, "uploads"),
  publicDir: join(__dirname, "public"),
  databaseUrl: env.DATABASE_URL || "",
  sessionSecret,
  sessionMaxAgeSeconds: 8 * 60 * 60,
  adminPath: env.ADMIN_PATH || "/",
  adminEmail: env.ADMIN_EMAIL || "",
  adminPassword: env.ADMIN_PASSWORD || "",
  admin2faSecret: ADMIN_2FA_SECRET,
  admin2faRequired: env.ADMIN_2FA_REQUIRED === "true" || Boolean(ADMIN_2FA_SECRET),
  adminHosts: (env.ADMIN_HOSTS || `localhost:${ADMIN_PORT},127.0.0.1:${ADMIN_PORT}`)
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
  publicBaseUrl: (env.PUBLIC_STORE_URL || env.BASE_URL || "http://localhost:3000").replace(/\/+$/g, ""),
  trustProxy: env.TRUST_PROXY === "true",
  paymentProvider,
  mercadoPago: {
    accessToken: env.MERCADO_PAGO_ACCESS_TOKEN || "",
    webhookSecret: env.MERCADO_PAGO_WEBHOOK_SECRET || ""
  },
  pix: {
    key: (env.PIX_KEY || "").trim(),
    merchantName: env.PIX_MERCHANT_NAME || env.STORE_NAME || "Meu Mimo Digital",
    merchantCity: env.PIX_MERCHANT_CITY || "Itu"
  },
  email: {
    resendApiKey: env.RESEND_API_KEY || "",
    from: env.EMAIL_FROM || ""
  },
  limits: {
    jsonBodyBytes: 100 * 1024,
    uploadBodyBytes: 8 * 1024 * 1024,
    uploadImageBytes: 5 * 1024 * 1024,
    maxCartLines: 30,
    maxQuantity: 20
  },
  warnings
};
