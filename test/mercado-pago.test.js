const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { setupEnv, startApp } = require("./helpers");

setupEnv({ MERCADO_PAGO_ACCESS_TOKEN: "TEST-token", MERCADO_PAGO_WEBHOOK_SECRET: "whsec" });

// Simula a API do Mercado Pago: nenhum teste sai para a internet.
const gateway = { payments: new Map(), calls: [], nextId: 9000 };
global.fetch = async (url, options = {}) => {
  const { pathname, hostname } = new URL(url);
  gateway.calls.push({ hostname, pathname, options });
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (hostname !== "api.mercadopago.com") return reply(500, {});
  if (options.method === "POST" && pathname === "/v1/payments") {
    if (gateway.failNext) { gateway.failNext = false; return reply(400, { message: "invalid payer" }); }
    const body = JSON.parse(options.body);
    const payment = { id: gateway.nextId += 1, status: "pending", external_reference: body.external_reference, transaction_amount: body.transaction_amount,
      point_of_interaction: { transaction_data: { qr_code: "00020126PIXMP", qr_code_base64: "QUJD", ticket_url: "https://mp.example/ticket" } } };
    gateway.payments.set(String(payment.id), payment);
    return reply(201, payment);
  }
  const payment = gateway.payments.get(pathname.split("/").pop());
  return payment ? reply(200, payment) : reply(404, {});
};

let app;
const customer = { customerName: "Maria Silva", customerEmail: "maria@example.com", customerPhone: "(11) 99999-8888" };
const cart = [{ id: "prod_tirinha_fotos", quantity: 1 }];

function signed(paymentId, secret = "whsec") {
  const ts = String(Date.now());
  const v1 = createHmac("sha256", secret).update(`id:${paymentId};request-id:req-1;ts:${ts};`).digest("hex");
  return { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-1" };
}
const notify = (paymentId, headers = signed(paymentId)) =>
  app.call("POST", `/api/webhooks/mercado-pago?data.id=${paymentId}&type=payment`, { body: { type: "payment", data: { id: String(paymentId) } }, headers });

test.before(async () => { app = await startApp(); });
test.after(async () => { await app.close(); });
test.beforeEach(() => { Object.values(app.limiters).forEach((limiter) => limiter.clear()); });

test("cria Pix no gateway e confirma pelo webhook assinado", async () => {
  assert.equal((await app.call("GET", "/health")).data.payment, "mercado-pago");
  const created = await app.call("POST", "/api/orders", { body: { ...customer, cart } });
  assert.equal(created.status, 201);
  const { order, payment, orderUrl } = created.data;
  assert.equal(payment.pixCopyPaste, "00020126PIXMP");
  assert.equal(payment.qrCode, "data:image/png;base64,QUJD");
  const sent = JSON.parse(gateway.calls[0].options.body);
  assert.equal(sent.transaction_amount, 4.74);
  assert.equal(sent.notification_url, "http://loja.test/api/webhooks/mercado-pago");
  assert.equal(gateway.calls[0].options.headers["x-idempotency-key"], order.id);
  const paymentId = (await app.store.getOrder(order.id)).paymentId;

  // assinatura invalida ou ausente: recusado e pedido segue pendente
  assert.equal((await notify(paymentId, signed(paymentId, "segredo-errado"))).status, 401);
  assert.equal((await notify(paymentId, {})).status, 401);
  // webhook assinado, mas o gateway ainda diz pendente
  assert.equal((await notify(paymentId)).status, 200);
  assert.equal((await app.store.getOrder(order.id)).status, "pending");

  // corpo dizendo "approved" nao vale nada: so a consulta na API oficial conta
  await app.call("POST", `/api/webhooks/mercado-pago?data.id=${paymentId}&type=payment`, { body: { type: "payment", status: "approved", data: { id: String(paymentId), status: "approved" } }, headers: signed(paymentId) });
  assert.equal((await app.store.getOrder(order.id)).status, "pending");

  gateway.payments.get(paymentId).status = "approved";
  assert.equal((await notify(paymentId)).status, 200);
  const paid = await app.store.getOrder(order.id);
  assert.equal(paid.status, "paid");
  assert.ok(paid.paidAt);
  assert.match((await app.call("GET", orderUrl)).text, /canva\.com/);

  // reenvio do mesmo webhook e idempotente; estorno cancela o acesso
  await notify(paymentId);
  assert.equal((await app.store.getOrder(order.id)).paidAt, paid.paidAt);
  gateway.payments.get(paymentId).status = "refunded";
  await notify(paymentId);
  assert.equal((await app.store.getOrder(order.id)).status, "canceled");
  assert.doesNotMatch((await app.call("GET", orderUrl)).text, /canva\.com/);
});

test("pagamento com valor menor que o pedido nao libera a entrega", async () => {
  const created = await app.call("POST", "/api/orders", { body: { ...customer, cart: [{ id: "prod_quadro_musica", quantity: 1 }] } });
  const paymentId = (await app.store.getOrder(created.data.order.id)).paymentId;
  Object.assign(gateway.payments.get(paymentId), { status: "approved", transaction_amount: 0.01 });
  assert.equal((await notify(paymentId)).status, 200);
  assert.equal((await app.store.getOrder(created.data.order.id)).status, "pending");
});

test("pedido entregue nao volta para pago; pagamento desconhecido e ignorado", async () => {
  const created = await app.call("POST", "/api/orders", { body: { ...customer, cart } });
  const id = created.data.order.id;
  const paymentId = (await app.store.getOrder(id)).paymentId;
  const cookie = await app.login();
  await app.call("POST", `/api/internal/orders/${id}/status`, { admin: true, cookie, body: { status: "delivered" } });
  gateway.payments.get(paymentId).status = "approved";
  await notify(paymentId);
  assert.equal((await app.store.getOrder(id)).status, "delivered");
  assert.equal((await notify("777")).status, 200);
});

test("falha do gateway vira erro amigavel e nao grava pedido", async () => {
  gateway.failNext = true;
  const before = (await app.store.listOrders()).length;
  const failed = await app.call("POST", "/api/orders", { body: { ...customer, cart } });
  assert.equal(failed.status, 502);
  assert.doesNotMatch(failed.data.error, /invalid payer/);
  assert.equal((await app.store.listOrders()).length, before);
});
