const { createServer } = require("node:http");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { join } = require("node:path");
const { randomBytes, randomUUID } = require("node:crypto");

const config = require("./config");
const { createStore } = require("./store");
const security = require("./security");
const validation = require("./validation");
const payments = require("./payments");
const mailer = require("./mailer");
const views = require("./views");

const { ValidationError } = validation;

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const STATIC_FILES = {
  "/app.js": { file: "app.js", type: "application/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" }
};
const IMAGE_TYPES = { png: "image/png", webp: "image/webp", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg" };
const PUBLIC_SETTINGS = ["storeName", "tagline", "whatsapp", "instagram", "email", "city", "pixDiscountPercent"];

const round2 = (value) => Math.round(value * 100) / 100;

function securityHeaders(request, type) {
  const headers = {
    "content-type": type,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()"
  };
  if (config.publicBaseUrl.startsWith("https://")) headers["strict-transport-security"] = "max-age=15552000";
  if (type.startsWith("text/html")) {
    headers["cache-control"] = "no-store";
    headers["content-security-policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
  }
  return headers;
}

function send(request, response, status, body, type = "text/html; charset=utf-8", extraHeaders = {}) {
  response.writeHead(status, { ...securityHeaders(request, type), ...extraHeaders });
  response.end(body);
}

function json(request, response, status, body, extraHeaders = {}) {
  send(request, response, status, JSON.stringify(body), "application/json; charset=utf-8", { "cache-control": "no-store", ...extraHeaders });
}

function redirect(request, response, location, status = 302) {
  send(request, response, status, "", "text/plain; charset=utf-8", { location });
}

async function readJsonBody(request, limit = config.limits.jsonBodyBytes) {
  if (Number(request.headers["content-length"] || 0) > limit) throw new HttpError(413, "Envio grande demais.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Envio grande demais.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(400, "Corpo da requisição inválido.");
  return parsed;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function uniqueSlug(base, products, ignoreId = null) {
  const root = base || "item";
  const taken = new Set(products.filter((product) => product.id !== ignoreId).map((product) => product.slug));
  let slug = root;
  for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${root}-${suffix}`;
  return slug;
}

/** Recalcula o pedido no servidor: precos e descontos nunca vem do navegador. */
function calculateOrder(products, cart, settings) {
  const items = [];
  const missing = [];
  for (const line of cart) {
    const product = products.find((entry) => entry.id === line.id && entry.active !== false);
    if (!product) {
      missing.push(line.id);
      continue;
    }
    items.push({ productId: product.id, name: product.name, quantity: line.quantity, unitPrice: product.price, total: round2(product.price * line.quantity) });
  }
  const subtotal = round2(items.reduce((sum, item) => sum + item.total, 0));
  const percent = Math.min(90, Math.max(0, Number(settings.pixDiscountPercent || 0)));
  const discount = round2((subtotal * percent) / 100);
  return { items, missing, subtotal, discount, total: round2(subtotal - discount) };
}

function createApp() {
  const store = createStore();
  const limiters = {
    login: security.createRateLimiter({ limit: 5, windowMs: 15 * 60_000 }),
    orders: security.createRateLimiter({ limit: 10, windowMs: 10 * 60_000 }),
    newsletter: security.createRateLimiter({ limit: 5, windowMs: 10 * 60_000 }),
    orderLookup: security.createRateLimiter({ limit: 120, windowMs: 60_000 })
  };

  const isAdmin = (request) => security.isValidSession(security.parseCookies(request).meu_mimo_session);
  const isAdminHost = (request) => config.adminHosts.includes(String(request.headers.host || "").toLowerCase());
  const orderUrl = (order) => `${config.publicBaseUrl}/pedido/${encodeURIComponent(order.id)}/${encodeURIComponent(order.deliveryToken)}`;

  function rateLimit(limiter, request) {
    const wait = limiter.hit(security.clientIp(request));
    if (wait) throw new HttpError(429, "Muitas tentativas. Aguarde alguns minutos e tente de novo.", { headers: { "retry-after": String(wait) } });
  }

  /** Protecao CSRF do painel: so JSON e, quando o navegador informa a origem, ela precisa ser o proprio painel. */
  function assertSameOrigin(request) {
    if (!String(request.headers["content-type"] || "").startsWith("application/json")) throw new HttpError(415, "Use content-type application/json.");
    const origin = request.headers.origin;
    if (!origin) return;
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      // origem inválida cai na comparacao abaixo
    }
    if (originHost !== String(request.headers.host || "").toLowerCase()) throw new HttpError(403, "Origem não permitida.");
  }

  function notifyOrder(order, ctx, kind) {
    if (!order.customerEmail) return;
    const name = views.escapeHtml(String(order.customerName || "").split(" ")[0] || "Olá");
    const link = views.escapeHtml(orderUrl(order));
    const storeName = views.escapeHtml(ctx.settings.storeName || "Meu Mimo Digital");
    const content = kind === "paid"
      ? { subject: `Pagamento confirmado - pedido ${order.id}`, text: "Seu pagamento foi confirmado e seus arquivos digitais já estão liberados." , cta: "Acessar meus arquivos" }
      : { subject: `Recebemos seu pedido ${order.id}`, text: `Recebemos seu pedido no valor de ${views.money(order.total)}. Assim que o pagamento for confirmado, seus arquivos ficam liberados no link abaixo.`, cta: "Ver meu pedido" };
    mailer.sendMail({
      to: order.customerEmail,
      subject: `${content.subject} | ${ctx.settings.storeName || "Meu Mimo Digital"}`,
      html: `<div style="font-family:Arial,sans-serif;color:#382c2a;max-width:520px"><h2>${storeName}</h2><p>${name}, ${content.text}</p><p><a href="${link}" style="background:#c86d7c;color:#fff;padding:12px 22px;border-radius:99px;text-decoration:none;display:inline-block">${content.cta}</a></p><p style="font-size:12px;color:#786966">Se o botão não abrir, copie este link: ${link}</p></div>`
    });
  }

  /** Aplica uma mudanca de status respeitando as transicoes validas e registra a data do pagamento. */
  async function applyOrderStatus(order, status, extra = {}) {
    if (order.status === status && !Object.keys(extra).length) return order;
    const patch = { ...extra, status };
    if (status === "paid" && !order.paidAt) patch.paidAt = new Date().toISOString();
    const updated = await store.updateOrder(order.id, patch);
    if (updated && status === "paid" && order.status !== "paid" && order.status !== "delivered") {
      notifyOrder(updated, await store.getSettings(), "paid");
    }
    return updated;
  }

  async function handleApi(request, response, url) {
    const { pathname } = url;
    const method = request.method;

    if (method === "GET" && pathname === "/api/store") {
      const [ctx, products] = await Promise.all([store.getSettings(), store.listProducts()]);
      return json(request, response, 200, {
        settings: Object.fromEntries(PUBLIC_SETTINGS.map((key) => [key, ctx.settings[key]])),
        products: products.filter((product) => product.active !== false).map(({ digitalDeliveryUrl, ...product }) => product)
      });
    }

    if (method === "POST" && pathname === "/api/orders") {
      rateLimit(limiters.orders, request);
      const body = await readJsonBody(request);
      const customer = validation.validateCustomer(body);
      const cart = validation.validateCart(body.cart);
      const [ctx, products] = await Promise.all([store.getSettings(), store.listProducts()]);
      const calc = calculateOrder(products, cart, ctx.settings);
      if (calc.missing.length) {
        return json(request, response, 409, { error: "Um item do carrinho não está mais disponível. Revise o carrinho e tente de novo.", unavailable: calc.missing });
      }
      if (calc.total <= 0) throw new HttpError(400, "Total do pedido inválido.");
      const provider = payments.activeProvider();
      const order = {
        id: `MM-${Date.now().toString(36).toUpperCase()}${randomBytes(2).toString("hex").toUpperCase()}`,
        ...customer,
        status: "pending",
        items: calc.items,
        subtotal: calc.subtotal,
        discount: calc.discount,
        total: calc.total,
        createdAt: new Date().toISOString(),
        paidAt: null,
        deliveryToken: randomBytes(24).toString("base64url"),
        paymentProvider: provider.id,
        paymentId: "",
        paymentPayload: null
      };
      let payment;
      try {
        payment = await provider.createPayment(order);
      } catch (error) {
        console.error(`[pagamento] ${provider.id}:`, error.message);
        throw new HttpError(502, "Não foi possível gerar o pagamento agora. Tente novamente em instantes.");
      }
      order.paymentId = payment.paymentId || "";
      order.paymentPayload = { view: payment.view || {} };
      await store.createOrder(order);
      notifyOrder(order, ctx, "created");
      return json(request, response, 201, {
        order: { id: order.id, status: order.status, subtotal: order.subtotal, discount: order.discount, total: order.total, items: order.items },
        payment: { provider: provider.id, ...order.paymentPayload.view },
        orderUrl: `/pedido/${encodeURIComponent(order.id)}/${encodeURIComponent(order.deliveryToken)}`
      });
    }

    const orderLookup = pathname.match(/^\/api\/orders\/([^/]+)$/);
    if (method === "GET" && orderLookup) {
      rateLimit(limiters.orderLookup, request);
      const order = await store.getOrder(safeDecode(orderLookup[1]));
      const token = url.searchParams.get("token") || "";
      if (!order || !token || !security.safeEqual(order.deliveryToken, token)) throw new HttpError(404, "Pedido não encontrado.");
      return json(request, response, 200, { id: order.id, status: order.status });
    }

    if (method === "POST" && pathname === "/api/newsletter") {
      rateLimit(limiters.newsletter, request);
      const body = await readJsonBody(request);
      const email = validation.cleanText(body.email, 254).toLowerCase();
      if (!validation.isEmail(email)) throw new ValidationError({ email: "Informe um e-mail válido." });
      await store.addSubscriber(email);
      return json(request, response, 200, { ok: true });
    }

    const webhook = pathname.match(/^\/api\/webhooks\/([a-z0-9-]+)$/);
    if (method === "POST" && webhook) {
      const provider = payments.getProvider(webhook[1]);
      if (!provider || !provider.isConfigured()) throw new HttpError(404, "Rota não encontrada.");
      const body = await readJsonBody(request).catch(() => ({}));
      let event;
      try {
        event = await provider.parseWebhook({ headers: request.headers, query: url.searchParams, body });
      } catch (error) {
        if (error instanceof payments.WebhookAuthError) throw new HttpError(401, error.message);
        throw error;
      }
      if (event?.orderId) {
        const order = await store.getOrder(event.orderId);
        if (order && order.paymentProvider === provider.id) {
          const extra = { paymentId: event.paymentId || order.paymentId };
          if (event.status === "paid") {
            if (event.amount + 0.005 < order.total) console.error(`[webhook] valor pago (${event.amount}) menor que o pedido ${order.id} (${order.total}); ignorado.`);
            else if (order.status !== "delivered") await applyOrderStatus(order, "paid", extra);
          } else if (event.status === "canceled") {
            await applyOrderStatus(order, "canceled", extra);
          }
        }
      }
      return json(request, response, 200, { received: true });
    }

    // ---- Painel interno: so responde no host do painel ----
    if (!pathname.startsWith("/api/internal/") || !isAdminHost(request) || method !== "POST") throw new HttpError(404, "Rota não encontrada.");
    assertSameOrigin(request);

    if (pathname === "/api/internal/login") {
      rateLimit(limiters.login, request);
      const body = await readJsonBody(request);
      const configured = Boolean(config.adminEmail && config.adminPassword);
      const emailOk = security.safeEqual(String(body.adminEmail || "").trim().toLowerCase(), config.adminEmail.toLowerCase());
      const passwordOk = security.safeEqual(String(body.adminPassword || ""), config.adminPassword);
      const otpOk = !config.admin2faRequired || security.verifyTotp(body.otpCode, config.admin2faSecret);
      if (!configured || !emailOk || !passwordOk || !otpOk) throw new HttpError(401, "Credenciais inválidas.");
      limiters.login.reset(security.clientIp(request));
      return json(request, response, 200, { ok: true }, { "set-cookie": security.sessionCookie(request, security.createSessionValue(), config.sessionMaxAgeSeconds) });
    }

    if (pathname === "/api/internal/logout") {
      return json(request, response, 200, { ok: true }, { "set-cookie": security.sessionCookie(request, "", 0) });
    }

    if (!isAdmin(request)) throw new HttpError(401, "Sessão expirada. Entre novamente.");

    if (pathname === "/api/internal/uploads") {
      const body = await readJsonBody(request, config.limits.uploadBodyBytes);
      const { buffer, ext } = validation.parseImageDataUrl(body.dataUrl);
      await mkdir(config.uploadDir, { recursive: true });
      const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
      await writeFile(join(config.uploadDir, fileName), buffer);
      return json(request, response, 201, { url: `/uploads/${fileName}` });
    }

    if (pathname === "/api/internal/products") {
      const body = await readJsonBody(request);
      const fields = validation.validateProduct(body);
      const products = await store.listProducts();
      const product = {
        id: `prod_${randomUUID().slice(0, 8)}`,
        ...fields,
        slug: uniqueSlug(fields.slug || validation.createSlug(fields.name), products)
      };
      await store.createProduct(product);
      return json(request, response, 201, { product });
    }

    const productUpdate = pathname.match(/^\/api\/internal\/products\/([^/]+)$/);
    if (productUpdate) {
      const id = safeDecode(productUpdate[1]);
      const products = await store.listProducts();
      const current = products.find((entry) => entry.id === id);
      if (!current) throw new HttpError(404, "Produto não encontrado.");
      const body = await readJsonBody(request);
      const patch = validation.validateProduct(body, { partial: true });
      const price = patch.price ?? current.price;
      const compare = patch.compareAtPrice === undefined ? current.compareAtPrice : patch.compareAtPrice;
      if (compare && compare <= price) throw new ValidationError({ compareAtPrice: "Preço antigo deve ser maior que o preço de venda." });
      if (patch.slug) patch.slug = uniqueSlug(patch.slug, products, id);
      if (!Object.keys(patch).length) throw new HttpError(400, "Nada para atualizar.");
      return json(request, response, 200, { product: await store.updateProduct(id, patch) });
    }

    const orderStatus = pathname.match(/^\/api\/internal\/orders\/([^/]+)\/status$/);
    if (orderStatus) {
      const order = await store.getOrder(safeDecode(orderStatus[1]));
      if (!order) throw new HttpError(404, "Pedido não encontrado.");
      const body = await readJsonBody(request);
      if (!validation.ORDER_STATUSES.includes(body.status)) throw new HttpError(400, "Status inválido.");
      const updated = await applyOrderStatus(order, body.status);
      return json(request, response, 200, { order: { id: updated.id, status: updated.status } });
    }

    if (pathname === "/api/internal/settings") {
      const body = await readJsonBody(request);
      const { settings, pages } = validation.validateSettings(body);
      const current = await store.getSettings();
      await store.saveSettings({ ...current.settings, ...settings }, { ...current.pages, ...pages });
      return json(request, response, 200, { ok: true });
    }

    throw new HttpError(404, "Rota não encontrada.");
  }

  async function handlePage(request, response, url) {
    const { pathname } = url;
    if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Método não permitido.");

    const staticFile = STATIC_FILES[pathname];
    if (staticFile) {
      return send(request, response, 200, await readFile(join(config.publicDir, staticFile.file)), staticFile.type, { "cache-control": "public, max-age=300" });
    }
    if (pathname === "/robots.txt") {
      return send(request, response, 200, "User-agent: *\nDisallow: /pedido/\nDisallow: /carrinho\nDisallow: /api/\n", "text/plain; charset=utf-8");
    }
    if (pathname.startsWith("/uploads/")) {
      const fileName = safeDecode(pathname.slice("/uploads/".length));
      const ext = fileName.split(".").pop()?.toLowerCase();
      if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(fileName) || !IMAGE_TYPES[ext]) throw new HttpError(404, "Arquivo não encontrado.");
      try {
        return send(request, response, 200, await readFile(join(config.uploadDir, fileName)), IMAGE_TYPES[ext], { "cache-control": "public, max-age=31536000, immutable" });
      } catch (error) {
        if (error.code === "ENOENT") throw new HttpError(404, "Arquivo não encontrado.");
        throw error;
      }
    }

    const ctx = await store.getSettings();
    const html = (status, body) => send(request, response, status, body);

    if (isAdminHost(request)) {
      if (pathname !== "/" && pathname !== config.adminPath) return html(404, views.notFoundPage(ctx, true));
      if (!isAdmin(request)) return html(200, views.adminLoginPage(ctx));
      const [products, orders, subscribers] = await Promise.all([store.listProducts(), store.listOrders(), store.countSubscribers()]);
      return html(200, views.adminPage(ctx, { products, orders, subscribers, provider: payments.activeProvider() }));
    }

    if (pathname === "/") return html(200, views.homePage(ctx, await store.listProducts(), validation.cleanText(url.searchParams.get("q"), 80)));
    if (pathname === "/carrinho") return html(200, views.cartPage(ctx));
    if (pathname === "/cart") return redirect(request, response, "/carrinho", 301);
    if (pathname === "/privacidade") return html(200, views.textPage(ctx, "Política de privacidade", ctx.pages.privacy));

    const orderMatch = pathname.match(/^\/(pedido|entrega)\/([^/]+)\/([^/]+)$/);
    if (orderMatch) {
      if (orderMatch[1] === "entrega") return redirect(request, response, `/pedido/${orderMatch[2]}/${orderMatch[3]}`, 301);
      rateLimit(limiters.orderLookup, request);
      const order = await store.getOrder(safeDecode(orderMatch[2]));
      if (!order || !security.safeEqual(order.deliveryToken, safeDecode(orderMatch[3]))) return html(404, views.notFoundPage(ctx));
      return html(200, views.orderPage(ctx, order, await store.listProducts()));
    }

    if (pathname.startsWith("/produto/")) {
      const slug = safeDecode(pathname.slice("/produto/".length));
      const products = (await store.listProducts()).filter((product) => product.active !== false);
      const product = products.find((entry) => entry.slug === slug);
      if (!product) return html(404, views.notFoundPage(ctx));
      const others = products.filter((entry) => entry.id !== product.id);
      const related = [...others.filter((entry) => entry.category === product.category), ...others.filter((entry) => entry.category !== product.category)].slice(0, 4);
      return html(200, views.productPage(ctx, product, related));
    }

    return html(404, views.notFoundPage(ctx));
  }

  async function handleRequest(request, response) {
    let isApi = false;
    try {
      const url = new URL(request.url, "http://localhost");
      isApi = url.pathname.startsWith("/api/");
      if (url.pathname === "/health") {
        try {
          await store.ping();
          return json(request, response, 200, { ok: true, store: store.kind, payment: payments.activeProvider().id });
        } catch {
          return json(request, response, 503, { ok: false });
        }
      }
      if (isApi) return await handleApi(request, response, url);
      return await handlePage(request, response, url);
    } catch (error) {
      if (response.headersSent) return response.end();
      request.resume();
      if (error instanceof ValidationError) return json(request, response, 400, { error: error.message, fields: error.fields });
      if (error instanceof HttpError) {
        if (isApi) return json(request, response, error.status, { error: error.message }, error.extra.headers);
        return send(request, response, error.status, error.message, "text/plain; charset=utf-8", error.extra.headers);
      }
      console.error(error);
      if (isApi) return json(request, response, 500, { error: "Erro interno no servidor." });
      return send(request, response, 500, "Erro interno no servidor.", "text/plain; charset=utf-8");
    }
  }

  const server = createServer(handleRequest);
  server.requestTimeout = 30_000;
  return { server, store, limiters };
}

if (require.main === module) {
  const { server, store } = createApp();
  for (const warning of config.warnings) console.warn(`[aviso] ${warning}`);
  store.init()
    .then(() => {
      server.listen(config.port, config.host, () => {
        console.log(`Meu Mimo rodando em http://${config.host}:${config.port} (dados: ${store.kind}, pagamento: ${payments.activeProvider().id})`);
      });
    })
    .catch((error) => {
      console.error("Falha ao iniciar o armazenamento:", error.message);
      process.exit(1);
    });
  const shutdown = () => server.close(() => store.close().finally(() => process.exit(0)));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = { createApp, calculateOrder, uniqueSlug };
