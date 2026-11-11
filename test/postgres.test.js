const test = require("node:test");
const assert = require("node:assert/strict");
const { setupEnv, startApp } = require("./helpers");

// Roda so quando TEST_DATABASE_URL aponta para um PostgreSQL descartavel.
const url = process.env.TEST_DATABASE_URL;

test("PostgreSQL: seed, pedido, status, produto e configuracoes", { skip: !url && "defina TEST_DATABASE_URL para rodar" }, async () => {
  setupEnv({ DATABASE_URL: url, PIX_KEY: "teste@pix.com" });
  const app = await startApp();
  try {
    assert.equal((await app.call("GET", "/health")).data.store, "postgres");
    assert.equal((await app.store.listProducts()).length >= 2, true);
    await app.store.init();

    const created = await app.call("POST", "/api/orders", {
      body: { customerName: "Maria Silva", customerEmail: "maria@example.com", customerPhone: "11999998888", cart: [{ id: "prod_tirinha_fotos", quantity: 2 }] }
    });
    assert.equal(created.status, 201);
    const stored = await app.store.getOrder(created.data.order.id);
    assert.equal(stored.total, 9.48);
    assert.equal(stored.subtotal, 9.98);
    assert.equal(stored.discount, 0.5);
    assert.equal(stored.items[0].quantity, 2);
    assert.match(stored.paymentPayload.view.pixCopyPaste, /^000201/);

    const cookie = await app.login();
    await app.call("POST", `/api/internal/orders/${stored.id}/status`, { admin: true, cookie, body: { status: "paid" } });
    const paid = await app.store.getOrder(stored.id);
    assert.equal(paid.status, "paid");
    assert.ok(paid.paidAt);
    assert.match((await app.call("GET", created.data.orderUrl)).text, /canva\.com/);
    assert.ok((await app.store.listOrders()).some((order) => order.id === stored.id));

    const product = await app.call("POST", "/api/internal/products", { admin: true, cookie, body: { name: "Molde - Tirinha de Fotos", category: "Teste", price: "3,50", image: "https://x.com/a.png", gallery: "https://x.com/b.png", shortDescription: "Curta aqui", description: "Longa aqui", active: "on" } });
    assert.equal(product.status, 201);
    assert.notEqual(product.data.product.slug, "molde-tirinha-de-fotos");
    const edited = await app.call("POST", `/api/internal/products/${product.data.product.id}`, { admin: true, cookie, body: { active: false, gallery: "" } });
    assert.equal(edited.data.product.active, false);
    assert.deepEqual(edited.data.product.gallery, []);
    assert.equal(edited.data.product.price, 3.5);

    assert.equal(await app.store.addSubscriber(`a${Date.now()}@example.com`), true);
    const settings = await app.store.getSettings();
    await app.store.saveSettings({ ...settings.settings, pixDiscountPercent: 0 }, settings.pages);
    assert.equal((await app.store.getSettings()).settings.pixDiscountPercent, 0);
    await app.store.saveSettings(settings.settings, settings.pages);
  } finally {
    await app.close();
  }
});
