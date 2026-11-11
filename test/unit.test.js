const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { setupEnv } = require("./helpers");

setupEnv({ MERCADO_PAGO_WEBHOOK_SECRET: "whsec" });
const validation = require("../src/validation");
const security = require("../src/security");
const { buildPixPayload, crc16, normalizePixKey } = require("../src/payments/pix");
const mercadoPago = require("../src/payments/mercado-pago");
const { calculateOrder, uniqueSlug } = require("../src/server");

test("telefone: aceita formatos brasileiros e rejeita invalidos", () => {
  assert.equal(validation.normalizePhone("(11) 99999-8888"), "11999998888");
  assert.equal(validation.normalizePhone("+55 11 3468-3618"), "1134683618");
  assert.equal(validation.normalizePhone("5511999998888"), "11999998888");
  assert.equal(validation.normalizePhone("99999-8888"), null);
  assert.equal(validation.normalizePhone("abc"), null);
  assert.equal(validation.normalizePhone("(10) 99999-8888"), null);
});

test("e-mail e cliente", () => {
  assert.ok(validation.isEmail("maria@example.com"));
  for (const bad of ["maria", "maria@", "a@b", "a b@c.com", "<x>@c.com", ""]) assert.equal(validation.isEmail(bad), false, bad);
  assert.throws(() => validation.validateCustomer({ customerName: "A", customerEmail: "x", customerPhone: "1" }), (error) => {
    assert.deepEqual(Object.keys(error.fields).sort(), ["customerEmail", "customerName", "customerPhone"]);
    return true;
  });
  assert.deepEqual(validation.validateCustomer({ customerName: " Maria Silva ", customerEmail: "Maria@Example.com", customerPhone: "11 99999-8888" }),
    { customerName: "Maria Silva", customerEmail: "maria@example.com", customerPhone: "11999998888" });
});

test("carrinho: une duplicados e barra quantidades invalidas", () => {
  assert.deepEqual(validation.validateCart([{ id: "a", quantity: 1 }, { id: "a", quantity: 2 }]), [{ id: "a", quantity: 3 }]);
  for (const bad of [[], null, "x", [{ id: "a", quantity: 0 }], [{ id: "a", quantity: -1 }], [{ id: "a", quantity: 1.5 }], [{ id: "a", quantity: 21 }], [{ quantity: 1 }], [{ id: "a", quantity: "x" }]]) {
    assert.throws(() => validation.validateCart(bad), validation.ValidationError, JSON.stringify(bad));
  }
});

test("preco: aceita virgula e rejeita lixo", () => {
  assert.equal(validation.parsePrice("4,99"), 4.99);
  assert.equal(validation.parsePrice("1.234,50"), 1234.5);
  assert.equal(validation.parsePrice("9.90"), 9.9);
  assert.equal(validation.parsePrice(""), null);
  assert.ok(Number.isNaN(validation.parsePrice("abc")));
});

test("produto: campos obrigatorios, URLs e precos", () => {
  const base = { name: "Molde", category: "Polaroid", price: "4,99", image: "https://x.com/a.png", shortDescription: "Descricao curta", description: "Descricao longa", active: "on" };
  const ok = validation.validateProduct(base);
  assert.equal(ok.price, 4.99);
  assert.equal(ok.active, true);
  assert.equal(ok.featured, false);
  assert.throws(() => validation.validateProduct({ ...base, image: "javascript:alert(1)" }), /Imagem/);
  assert.throws(() => validation.validateProduct({ ...base, digitalDeliveryUrl: "javascript:alert(1)" }), /entrega/);
  assert.throws(() => validation.validateProduct({ ...base, price: "0" }), /Preço/);
  assert.throws(() => validation.validateProduct({ ...base, price: "-5" }), /Preço/);
  assert.throws(() => validation.validateProduct({ ...base, compareAtPrice: "3" }), /antigo/);
  assert.throws(() => validation.validateProduct({ ...base, name: "" }), /Nome/);
  assert.throws(() => validation.validateProduct({ ...base, gallery: "https://ok.com/a.png\nnao-e-url" }), /Galeria/);
  assert.equal(validation.validateProduct({ ...base, image: "/uploads/a-1.png" }).image, "/uploads/a-1.png");
  assert.deepEqual(validation.validateProduct({ active: false }, { partial: true }), { active: false });
  assert.throws(() => validation.validateProduct({ name: "" }, { partial: true }), /Nome/);
});

test("upload: confere o conteudo real da imagem", () => {
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(16)]).toString("base64");
  assert.equal(validation.parseImageDataUrl(`data:image/png;base64,${png}`).ext, "png");
  const fake = Buffer.from("<script>alert(1)</script>").toString("base64");
  assert.throws(() => validation.parseImageDataUrl(`data:image/png;base64,${fake}`), /imagem válida/);
  assert.throws(() => validation.parseImageDataUrl("data:text/html;base64,AAAA"), /inválida/);
  assert.throws(() => validation.parseImageDataUrl("data:image/svg+xml;base64,AAAA"), /inválida/);
});

test("slug", () => {
  assert.equal(validation.createSlug("Molde - Tirinha de Fotos Ção!"), "molde-tirinha-de-fotos-cao");
  assert.equal(uniqueSlug("a", [{ id: "1", slug: "a" }, { id: "2", slug: "a-2" }]), "a-3");
  assert.equal(uniqueSlug("a", [{ id: "1", slug: "a" }], "1"), "a");
});

test("pedido: total calculado no servidor com desconto Pix", () => {
  const products = [{ id: "p1", name: "A", price: 4.99, active: true }, { id: "p2", name: "B", price: 9.9, active: false }];
  const calc = calculateOrder(products, [{ id: "p1", quantity: 2 }, { id: "p2", quantity: 1 }, { id: "nope", quantity: 1 }], { pixDiscountPercent: 5 });
  assert.equal(calc.subtotal, 9.98);
  assert.equal(calc.discount, 0.5);
  assert.equal(calc.total, 9.48);
  assert.deepEqual(calc.missing, ["p2", "nope"]);
  assert.equal(calculateOrder(products, [{ id: "p1", quantity: 1 }], {}).total, 4.99);
});

test("pix: CRC16 e payload copia e cola", () => {
  assert.equal(crc16("123456789"), "29B1");
  const payload = buildPixPayload({ key: "teste@pix.com", merchantName: "Meu Mimo Digitál Ltda Nome Longo", merchantCity: "Itu", amount: 9.48, txid: "MM-ABC123" });
  assert.match(payload, /^000201/);
  assert.ok(payload.includes("0014br.gov.bcb.pix0113teste@pix.com"));
  assert.ok(payload.includes("54049.48"));
  assert.ok(payload.includes("0508MMABC123"));
  assert.ok(payload.includes("5925Meu Mimo Digital Ltda Nom"));
  assert.equal(payload.slice(-4), crc16(payload.slice(0, -4)));
  assert.equal(normalizePixKey("123.456.789-09"), "12345678909");
  assert.equal(normalizePixKey("+55 (11) 99999-8888"), "+5511999998888");
});

test("TOTP: vetor da RFC 6238 e janela de tolerancia", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(security.hotp(secret, 1), "287082");
  assert.ok(security.verifyTotp("287082", secret, 59_000));
  assert.ok(security.verifyTotp("287082", secret, 89_000));
  assert.equal(security.verifyTotp("287082", secret, 200_000), false);
  assert.equal(security.verifyTotp("000000", "", 59_000), false);
  assert.equal(security.verifyTotp("12345", secret, 59_000), false);
});

test("sessao: assinatura e expiracao", () => {
  const now = Date.now();
  const value = security.createSessionValue(now);
  assert.ok(security.isValidSession(value, now + 1000));
  assert.equal(security.isValidSession(value, now + 9 * 60 * 60 * 1000), false);
  assert.equal(security.isValidSession(`${value}x`, now), false);
  assert.equal(security.isValidSession(value.replace("admin:", "admin2:"), now), false);
  assert.equal(security.isValidSession("", now), false);
});

test("rate limiter", () => {
  const limiter = security.createRateLimiter({ limit: 2, windowMs: 60_000 });
  assert.equal(limiter.hit("a"), 0);
  assert.equal(limiter.hit("a"), 0);
  assert.ok(limiter.hit("a") > 0);
  assert.equal(limiter.hit("b"), 0);
  limiter.reset("a");
  assert.equal(limiter.hit("a"), 0);
});

test("mercado pago: status e assinatura do webhook", () => {
  assert.equal(mercadoPago.mapStatus("approved"), "paid");
  assert.equal(mercadoPago.mapStatus("refunded"), "canceled");
  assert.equal(mercadoPago.mapStatus("in_process"), "pending");
  const ts = "1700000000";
  const v1 = createHmac("sha256", "whsec").update(`id:123;request-id:req-1;ts:${ts};`).digest("hex");
  const headers = { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-1" };
  assert.ok(mercadoPago.verifySignature({ headers, dataId: "123" }));
  assert.equal(mercadoPago.verifySignature({ headers, dataId: "124" }), false);
  assert.equal(mercadoPago.verifySignature({ headers: {}, dataId: "123" }), false);
});
