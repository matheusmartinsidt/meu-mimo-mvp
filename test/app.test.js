const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { setupEnv, startApp } = require("./helpers");

const dataDir = setupEnv({ PIX_KEY: "teste@pix.com" });
let app;
let cookie;
const customer = { customerName: "Maria Silva", customerEmail: "maria@example.com", customerPhone: "(11) 99999-8888" };
const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(32)]).toString("base64")}`;

test.before(async () => { app = await startApp(); });
test.after(async () => { await app.close(); });
test.beforeEach(() => { Object.values(app.limiters).forEach((limiter) => limiter.clear()); });

test("paginas publicas respondem e trazem cabecalhos de seguranca", async () => {
  const health = await app.call("GET", "/health");
  assert.deepEqual(health.data, { ok: true, store: "json", payment: "manual" });
  const home = await app.call("GET", "/");
  assert.equal(home.status, 200);
  assert.match(home.text, /Molde - Tirinha de Fotos/);
  assert.match(home.headers["content-security-policy"], /script-src 'self'/);
  assert.equal(home.headers["x-frame-options"], "DENY");
  assert.doesNotMatch(home.text, /canva\.com/, "link de entrega nao pode vazar na home");
  for (const path of ["/carrinho", "/privacidade", "/produto/molde-tirinha-de-fotos", "/styles.css", "/app.js", "/robots.txt"]) {
    assert.equal((await app.call("GET", path)).status, 200, path);
  }
  assert.equal((await app.call("GET", "/cart")).status, 301);
  for (const path of ["/produto/nao-existe", "/qualquer", "/produto/%E0%A4%A", "/uploads/..%2F..%2Fstore.json", "/uploads/store.json", "/uploads/nao-existe.png", "/pedido/x/y"]) {
    assert.equal((await app.call("GET", path)).status, 404, path);
  }
  assert.equal((await app.call("POST", "/")).status, 405);
});

test("busca escapa HTML (sem XSS refletido)", async () => {
  const home = await app.call("GET", `/?q=${encodeURIComponent('"><script>alert(1)</script>')}`);
  assert.equal(home.status, 200);
  assert.doesNotMatch(home.text, /<script>alert/);
});

test("API da loja nao expoe link de entrega nem dados internos", async () => {
  const { data } = await app.call("GET", "/api/store");
  assert.equal(data.products.length, 2);
  assert.ok(data.products.every((product) => !("digitalDeliveryUrl" in product)));
  assert.equal(data.settings.pixDiscountPercent, 5);
  assert.equal(data.orders, undefined);
});

test("pedido: validacoes de entrada", async () => {
  const cart = [{ id: "prod_tirinha_fotos", quantity: 1 }];
  const bad = await app.call("POST", "/api/orders", { body: { customerName: "", customerEmail: "x", customerPhone: "123", cart } });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.data.fields).sort(), ["customerEmail", "customerName", "customerPhone"]);
  assert.equal((await app.call("POST", "/api/orders", { body: { ...customer, cart: [] } })).status, 400);
  assert.equal((await app.call("POST", "/api/orders", { body: { ...customer, cart: [{ id: "prod_tirinha_fotos", quantity: 999 }] } })).status, 400);
  assert.equal((await app.call("POST", "/api/orders", { body: { ...customer, cart: [{ id: "prod_tirinha_fotos", quantity: -3 }] } })).status, 400);
  const missing = await app.call("POST", "/api/orders", { body: { ...customer, cart: [{ id: "nao-existe", quantity: 1 }] } });
  assert.equal(missing.status, 409);
  assert.deepEqual(missing.data.unavailable, ["nao-existe"]);
  assert.equal((await app.call("POST", "/api/orders", { raw: "{nao e json" })).status, 400);
  assert.equal((await app.call("POST", "/api/orders", { raw: "[1,2]" })).status, 400);
  assert.equal((await app.call("POST", "/api/orders", { raw: JSON.stringify({ pad: "x".repeat(200_000) }) })).status, 413);
});

test("fluxo completo: pedido -> Pix -> confirmacao no painel -> entrega", async () => {
  const created = await app.call("POST", "/api/orders", {
    body: { ...customer, cart: [{ id: "prod_tirinha_fotos", quantity: 2, price: 0.01 }], total: 0.01 }
  });
  assert.equal(created.status, 201);
  const { order, payment, orderUrl } = created.data;
  assert.equal(order.subtotal, 9.98);
  assert.equal(order.discount, 0.5);
  assert.equal(order.total, 9.48, "preco enviado pelo navegador e ignorado");
  assert.equal(order.deliveryToken, undefined);
  assert.match(payment.pixCopyPaste, /^000201.*54049\.48/);
  assert.match(payment.qrCode, /^data:image\/png;base64,/);
  assert.match(order.id, /^MM-[A-Z0-9]+$/);

  const pending = await app.call("GET", orderUrl);
  assert.equal(pending.status, 200);
  assert.match(pending.text, /Aguardando pagamento/);
  assert.match(pending.text, /Pix copia e cola/);
  assert.doesNotMatch(pending.text, /canva\.com/, "arquivo nao pode aparecer antes do pagamento");
  assert.match(pending.text, /noindex/);

  const token = orderUrl.split("/").pop();
  assert.equal((await app.call("GET", `/pedido/${order.id}/token-errado`)).status, 404);
  assert.equal((await app.call("GET", `/api/orders/${order.id}?token=errado`)).status, 404);
  assert.equal((await app.call("GET", `/api/orders/${order.id}`)).status, 404);
  assert.deepEqual((await app.call("GET", `/api/orders/${order.id}?token=${token}`)).data, { id: order.id, status: "pending" });
  assert.equal((await app.call("GET", `/entrega/${order.id}/${token}`)).status, 301);

  // sem login nao muda status
  assert.equal((await app.call("POST", `/api/internal/orders/${order.id}/status`, { admin: true, body: { status: "paid" } })).status, 401);
  cookie = await app.login();
  assert.equal((await app.call("POST", `/api/internal/orders/${order.id}/status`, { admin: true, cookie, body: { status: "hackeado" } })).status, 400);
  assert.equal((await app.call("POST", "/api/internal/orders/MM-NAOEXISTE/status", { admin: true, cookie, body: { status: "paid" } })).status, 404);
  const paid = await app.call("POST", `/api/internal/orders/${order.id}/status`, { admin: true, cookie, body: { status: "paid" } });
  assert.deepEqual(paid.data, { order: { id: order.id, status: "paid" } });

  const delivered = await app.call("GET", orderUrl);
  assert.match(delivered.text, /Pagamento confirmado/);
  assert.match(delivered.text, /https:\/\/www\.canva\.com\//);
  assert.ok((await app.store.getOrder(order.id)).paidAt);

  await app.call("POST", `/api/internal/orders/${order.id}/status`, { admin: true, cookie, body: { status: "canceled" } });
  const canceled = await app.call("GET", orderUrl);
  assert.match(canceled.text, /cancelado/);
  assert.doesNotMatch(canceled.text, /canva\.com/);

  const panel = await app.call("GET", "/", { admin: true, cookie });
  assert.match(panel.text, new RegExp(order.id));
  assert.ok(existsSync(join(dataDir, "db.local.json")));
});

test("painel: isolado por host, login protegido e limitado", async () => {
  assert.equal((await app.call("POST", "/api/internal/login", { body: { adminEmail: "admin@loja.test", adminPassword: "senha-forte-de-teste" } })).status, 404, "host publico nao alcanca o painel");
  assert.doesNotMatch((await app.call("GET", "/")).text, /Painel/);
  const loginPage = await app.call("GET", "/", { admin: true });
  assert.match(loginPage.text, /Acesso interno/);
  assert.doesNotMatch(loginPage.text, /admin@loja\.test/, "e-mail do admin nao vem preenchido");

  assert.equal((await app.call("POST", "/api/internal/login", { admin: true, body: { adminEmail: "admin@loja.test", adminPassword: "errada" } })).status, 401);
  assert.equal((await app.call("POST", "/api/internal/login", { admin: true, body: {} })).status, 401);
  assert.equal((await app.call("POST", "/api/internal/products", { admin: true, cookie: "meu_mimo_session=admin:1:x.assinatura-falsa", body: {} })).status, 401);
  assert.equal((await app.call("POST", "/api/internal/login", { admin: true, raw: "a=b", headers: { "content-type": "application/x-www-form-urlencoded" } })).status, 415);
  assert.equal((await app.call("POST", "/api/internal/login", { admin: true, headers: { origin: "https://site-malicioso.com" }, body: {} })).status, 403);

  app.limiters.login.clear();
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    last = await app.call("POST", "/api/internal/login", { admin: true, body: { adminEmail: "admin@loja.test", adminPassword: "errada" } });
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers["retry-after"]) > 0);
  app.limiters.login.clear();

  const ok = await app.call("POST", "/api/internal/login", { admin: true, body: { adminEmail: "Admin@Loja.test", adminPassword: "senha-forte-de-teste" } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers["set-cookie"][0], /HttpOnly; SameSite=Strict/);
  const out = await app.call("POST", "/api/internal/logout", { admin: true, body: {} });
  assert.match(out.headers["set-cookie"][0], /Max-Age=0/);
});

test("painel: produtos com validacao, slug unico, upload e ocultar", async () => {
  cookie = await app.login();
  const post = (path, body) => app.call("POST", path, { admin: true, cookie, body });
  const base = { name: "Molde - Tirinha de Fotos", category: "Polaroid", price: "7,50", compareAtPrice: "15", shortDescription: "Card curto", description: "Texto completo", digitalDeliveryUrl: "https://drive.example.com/x", active: "on" };

  assert.equal((await post("/api/internal/uploads", { dataUrl: `data:image/png;base64,${Buffer.from("<html>").toString("base64")}` })).status, 400);
  const upload = await post("/api/internal/uploads", { dataUrl: PNG });
  assert.equal(upload.status, 201);
  assert.match(upload.data.url, /^\/uploads\/[\w-]+\.png$/);
  const served = await app.call("GET", upload.data.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers["content-type"], "image/png");

  const invalid = await post("/api/internal/products", { ...base, image: "javascript:alert(1)", price: "-1" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(Object.keys(invalid.data.fields).sort(), ["image", "price"]);

  const created = await post("/api/internal/products", { ...base, image: upload.data.url });
  assert.equal(created.status, 201);
  const product = created.data.product;
  assert.equal(product.slug, "molde-tirinha-de-fotos-2", "slug repetido ganha sufixo");
  assert.equal(product.price, 7.5);
  assert.equal(product.featured, false);
  assert.equal((await app.call("GET", `/produto/${product.slug}`)).status, 200);

  assert.equal((await post(`/api/internal/products/${product.id}`, { price: "20" })).status, 400, "preco novo acima do preco antigo");
  assert.equal((await post(`/api/internal/products/${product.id}`, { name: "" })).status, 400);
  assert.equal((await post("/api/internal/products/nao-existe", { name: "Outro" })).status, 404);
  const edited = await post(`/api/internal/products/${product.id}`, { ...base, name: "Molde Polaroid <b>", price: "8", image: upload.data.url, slug: "molde-tirinha-de-fotos", _form: "full" });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.product.slug, "molde-tirinha-de-fotos-2");
  assert.equal(edited.data.product.active, true);
  const page = await app.call("GET", `/produto/${product.slug}`);
  assert.match(page.text, /Molde Polaroid &lt;b&gt;/);
  assert.doesNotMatch(page.text, /Molde Polaroid <b>/);

  const hidden = await post(`/api/internal/products/${product.id}`, { active: false });
  assert.equal(hidden.data.product.active, false);
  assert.equal(hidden.data.product.name, "Molde Polaroid <b>", "ocultar nao altera os outros campos");
  assert.equal((await app.call("GET", `/produto/${product.slug}`)).status, 404);
  const blocked = await app.call("POST", "/api/orders", { body: { ...customer, cart: [{ id: product.id, quantity: 1 }] } });
  assert.equal(blocked.status, 409, "produto oculto nao pode ser comprado");
});

test("painel: dados da loja", async () => {
  cookie = await app.login();
  const post = (body) => app.call("POST", "/api/internal/settings", { admin: true, cookie, body });
  const base = { storeName: "Meu Mimo Digital", tagline: "Nova frase", whatsapp: "(11) 99999-0000", email: "contato@loja.com", instagram: "https://instagram.com/x", city: "Itu - SP", pixDiscountPercent: "10", about: "Sobre", faq: "Faq", privacy: "Privacidade nova" };
  assert.equal((await post({ ...base, pixDiscountPercent: "150" })).status, 400);
  assert.equal((await post({ ...base, email: "invalido" })).status, 400);
  assert.equal((await post({ ...base, instagram: "javascript:alert(1)" })).status, 400);
  assert.equal((await post({ ...base, storeName: "" })).status, 400);
  assert.equal((await post(base)).status, 200);
  const { data } = await app.call("GET", "/api/store");
  assert.equal(data.settings.pixDiscountPercent, 10);
  assert.equal(data.settings.whatsapp, "11999990000");
  assert.match((await app.call("GET", "/privacidade")).text, /Privacidade nova/);
  const order = await app.call("POST", "/api/orders", { body: { ...customer, cart: [{ id: "prod_quadro_musica", quantity: 1 }] } });
  assert.equal(order.data.order.total, 8.91);
});

test("newsletter: valida, deduplica e limita", async () => {
  assert.equal((await app.call("POST", "/api/newsletter", { body: { email: "invalido" } })).status, 400);
  assert.equal((await app.call("POST", "/api/newsletter", { body: { email: "Ana@Example.com" } })).status, 200);
  assert.equal((await app.call("POST", "/api/newsletter", { body: { email: "ana@example.com" } })).status, 200);
  assert.equal(await app.store.countSubscribers(), 1);
  app.limiters.newsletter.clear();
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) last = await app.call("POST", "/api/newsletter", { body: { email: `a${attempt}@example.com` } });
  assert.equal(last.status, 429);
});

test("webhooks: provedor desconhecido ou sem credenciais responde 404", async () => {
  assert.equal((await app.call("POST", "/api/webhooks/desconhecido", { body: {} })).status, 404);
  assert.equal((await app.call("POST", "/api/webhooks/mercado-pago", { body: { data: { id: "1" } } })).status, 404);
  assert.equal((await app.call("POST", "/api/webhooks/__proto__", { body: {} })).status, 404);
});
