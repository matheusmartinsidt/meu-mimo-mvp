const http = require("node:http");
const { mkdtempSync, copyFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const ADMIN_HOST = "painel.test";

/** Prepara o ambiente (antes de carregar o app) com um diretorio de dados descartavel. */
function setupEnv(extra = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "meu-mimo-test-"));
  copyFileSync(join(__dirname, "..", "data", "store.json"), join(dataDir, "store.json"));
  for (const key of ["DATABASE_URL", "PAYMENT_PROVIDER", "MERCADO_PAGO_ACCESS_TOKEN", "MERCADO_PAGO_WEBHOOK_SECRET", "PIX_KEY", "RESEND_API_KEY", "ADMIN_2FA_SECRET", "ADMIN_2FA_REQUIRED"]) delete process.env[key];
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    ADMIN_HOSTS: ADMIN_HOST,
    ADMIN_EMAIL: "admin@loja.test",
    ADMIN_PASSWORD: "senha-forte-de-teste",
    SESSION_SECRET: "segredo-de-teste",
    PUBLIC_STORE_URL: "http://loja.test",
    ...extra
  });
  return dataDir;
}

async function startApp() {
  const { createApp } = require("../src/server");
  const app = createApp();
  await app.store.init();
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;

  function call(method, path, { body, admin = false, cookie, headers = {}, raw } = {}) {
    return new Promise((resolve, reject) => {
      const payload = raw ?? (body === undefined ? null : JSON.stringify(body));
      const request = http.request({
        host: "127.0.0.1", port, method, path,
        headers: {
          host: admin ? ADMIN_HOST : "loja.test",
          ...(payload !== null ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers
        }
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try { data = JSON.parse(text); } catch { /* nao e JSON */ }
          resolve({ status: response.statusCode, headers: response.headers, text, data });
        });
      });
      request.on("error", reject);
      if (payload !== null) request.write(payload);
      request.end();
    });
  }

  async function login() {
    const response = await call("POST", "/api/internal/login", { admin: true, body: { adminEmail: "admin@loja.test", adminPassword: "senha-forte-de-teste" } });
    return String(response.headers["set-cookie"]?.[0] || "").split(";")[0];
  }

  async function close() {
    await new Promise((resolve) => app.server.close(resolve));
    await app.store.close();
  }

  return { ...app, call, login, close };
}

module.exports = { setupEnv, startApp, ADMIN_HOST };
