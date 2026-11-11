const test = require("node:test");
const assert = require("node:assert/strict");
const { setupEnv, startApp } = require("./helpers");

setupEnv({ RESEND_API_KEY: "re_test", EMAIL_FROM: "Loja <loja@loja.test>", PIX_KEY: "teste@pix.com" });

// Simula a API do Resend: nenhum e-mail real e enviado.
const sent = [];
let failing = false;
global.fetch = async (url, options) => {
  if (failing) throw new Error("rede fora");
  sent.push({ url, auth: options.headers.authorization, body: JSON.parse(options.body) });
  return { ok: true, status: 200, json: async () => ({}) };
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

test("e-mails de pedido recebido e pagamento confirmado; falha de envio nao derruba o pedido", async () => {
  const app = await startApp();
  try {
    const body = { customerName: "Maria <b>Silva</b>", customerEmail: "maria@example.com", customerPhone: "11999998888", cart: [{ id: "prod_tirinha_fotos", quantity: 1 }] };
    const created = await app.call("POST", "/api/orders", { body });
    assert.equal(created.status, 201);
    await flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "https://api.resend.com/emails");
    assert.equal(sent[0].auth, "Bearer re_test");
    assert.deepEqual(sent[0].body.to, ["maria@example.com"]);
    assert.equal(sent[0].body.from, "Loja <loja@loja.test>");
    assert.match(sent[0].body.subject, /Recebemos seu pedido MM-/);
    assert.ok(sent[0].body.html.includes(`http://loja.test${created.data.orderUrl}`));
    assert.doesNotMatch(sent[0].body.html, /<b>Silva/, "nome do cliente e escapado no HTML");

    const cookie = await app.login();
    const setStatus = (status) => app.call("POST", `/api/internal/orders/${created.data.order.id}/status`, { admin: true, cookie, body: { status } });
    await setStatus("paid");
    await flush();
    assert.equal(sent.length, 2);
    assert.match(sent[1].body.subject, /Pagamento confirmado/);
    await setStatus("delivered");
    await setStatus("paid");
    await flush();
    assert.equal(sent.length, 2, "nao reenvia a confirmacao para pedido ja pago");

    failing = true;
    assert.equal((await app.call("POST", "/api/orders", { body })).status, 201);
    await flush();
  } finally {
    failing = false;
    await app.close();
  }
});
