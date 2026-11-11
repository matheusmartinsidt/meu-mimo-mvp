const { readFile, writeFile, rename, mkdir } = require("node:fs/promises");
const { dirname } = require("node:path");
const config = require("./config");

const clone = (value) => JSON.parse(JSON.stringify(value));

async function readSeed() {
  const seed = JSON.parse(await readFile(config.seedPath, "utf8"));
  return {
    settings: seed.settings || {},
    pages: seed.pages || {},
    products: seed.products || [],
    orders: [],
    subscribers: []
  };
}

/** Armazenamento em arquivo para desenvolvimento local: memoria + gravacao atomica em fila. */
function createJsonStore() {
  let data = null;
  let writing = Promise.resolve();

  async function load() {
    if (data) return data;
    try {
      data = JSON.parse(await readFile(config.localDbPath, "utf8"));
      data.orders ||= [];
      data.subscribers ||= [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      data = await readSeed();
    }
    return data;
  }

  function persist() {
    const snapshot = `${JSON.stringify(data, null, 2)}\n`;
    writing = writing.catch(() => {}).then(async () => {
      await mkdir(dirname(config.localDbPath), { recursive: true });
      const temp = `${config.localDbPath}.tmp`;
      await writeFile(temp, snapshot, "utf8");
      await rename(temp, config.localDbPath);
    });
    return writing;
  }

  return {
    kind: "json",
    init: load,
    async ping() { await load(); },
    async getSettings() { const d = await load(); return clone({ settings: d.settings, pages: d.pages }); },
    async saveSettings(settings, pages) { const d = await load(); d.settings = settings; d.pages = pages; await persist(); },
    async listProducts() { return clone((await load()).products); },
    async createProduct(product) { (await load()).products.push(clone(product)); await persist(); return product; },
    async updateProduct(id, patch) {
      const product = (await load()).products.find((entry) => entry.id === id);
      if (!product) return null;
      Object.assign(product, clone(patch));
      await persist();
      return clone(product);
    },
    async listOrders() { return clone((await load()).orders).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); },
    async getOrder(id) { const order = (await load()).orders.find((entry) => entry.id === id); return order ? clone(order) : null; },
    async createOrder(order) { (await load()).orders.push(clone(order)); await persist(); return order; },
    async updateOrder(id, patch) {
      const order = (await load()).orders.find((entry) => entry.id === id);
      if (!order) return null;
      Object.assign(order, clone(patch));
      await persist();
      return clone(order);
    },
    async addSubscriber(email) {
      const d = await load();
      if (d.subscribers.some((entry) => entry.email === email)) return false;
      d.subscribers.push({ email, createdAt: new Date().toISOString() });
      await persist();
      return true;
    },
    async countSubscribers() { return (await load()).subscribers.length; },
    async close() { await writing.catch(() => {}); }
  };
}

const PRODUCT_COLUMNS = {
  slug: "slug", name: "name", category: "category", price: "price", compareAtPrice: "compare_at_price",
  featured: "featured", image: "image", gallery: "gallery", shortDescription: "short_description",
  description: "description", digitalDeliveryUrl: "digital_delivery_url", active: "active"
};
const ORDER_COLUMNS = {
  customerName: "customer_name", customerEmail: "customer_email", customerPhone: "customer_phone", status: "status",
  items: "items", subtotal: "subtotal", discount: "discount", total: "total", deliveryToken: "delivery_token",
  paymentProvider: "payment_provider", paymentId: "payment_id", paymentPayload: "payment_payload", paidAt: "paid_at"
};
const JSON_COLUMNS = new Set(["gallery", "items", "payment_payload"]);

function productFromRow(row) {
  return {
    id: row.id, slug: row.slug, name: row.name, category: row.category, price: Number(row.price),
    compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
    featured: row.featured, image: row.image, gallery: row.gallery || [],
    shortDescription: row.short_description, description: row.description,
    digitalDeliveryUrl: row.digital_delivery_url || "", active: row.active
  };
}

function orderFromRow(row) {
  const total = Number(row.total);
  return {
    id: row.id, customerName: row.customer_name, customerEmail: row.customer_email, customerPhone: row.customer_phone,
    status: row.status, items: row.items || [],
    subtotal: row.subtotal === null ? total : Number(row.subtotal), discount: Number(row.discount || 0), total,
    createdAt: new Date(row.created_at).toISOString(), paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
    deliveryToken: row.delivery_token || "", paymentProvider: row.payment_provider || "",
    paymentId: row.payment_id || "", paymentPayload: row.payment_payload || null
  };
}

function buildUpdate(columns, patch) {
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key];
    if (!column) continue;
    values.push(JSON_COLUMNS.has(column) && value !== null ? JSON.stringify(value) : value);
    sets.push(`${column} = $${values.length}`);
  }
  return { sets, values };
}

function createPgStore() {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: config.databaseUrl });
  pool.on("error", (error) => console.error("[db] erro em conexao ociosa:", error.message));
  let ready = null;

  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price NUMERIC(10,2) NOT NULL,
        compare_at_price NUMERIC(10,2),
        featured BOOLEAN NOT NULL DEFAULT TRUE,
        image TEXT NOT NULL,
        gallery JSONB NOT NULL DEFAULT '[]'::jsonb,
        short_description TEXT NOT NULL,
        description TEXT NOT NULL,
        digital_delivery_url TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customer_name TEXT,
        customer_email TEXT,
        customer_phone TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        items JSONB NOT NULL,
        total NUMERIC(10,2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_token TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_payload JSONB;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10,2);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount NUMERIC(10,2) NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
      CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    `);
    const seeded = await pool.query("SELECT 1 FROM settings WHERE key = 'seededAt'");
    const count = await pool.query("SELECT COUNT(*)::int AS total FROM products");
    if (seeded.rowCount || count.rows[0].total > 0) return;
    const seed = await readSeed();
    await pool.query(
      "INSERT INTO settings (key, value) VALUES ($1, $2), ($3, $4), ($5, $6) ON CONFLICT (key) DO NOTHING",
      ["settings", JSON.stringify(seed.settings), "pages", JSON.stringify(seed.pages), "seededAt", JSON.stringify(new Date().toISOString())]
    );
    for (const product of seed.products) await insertProduct(product, "ON CONFLICT (id) DO NOTHING");
  }

  function insertProduct(product, suffix = "") {
    return pool.query(
      `INSERT INTO products (id, slug, name, category, price, compare_at_price, featured, image, gallery, short_description, description, digital_delivery_url, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ${suffix}`,
      [product.id, product.slug, product.name, product.category, product.price, product.compareAtPrice || null, product.featured !== false,
        product.image, JSON.stringify(product.gallery || []), product.shortDescription, product.description, product.digitalDeliveryUrl || "", product.active !== false]
    );
  }

  const init = () => (ready ||= migrate().catch((error) => { ready = null; throw error; }));

  return {
    kind: "postgres",
    init,
    async ping() { await pool.query("SELECT 1"); },
    async getSettings() {
      await init();
      const result = await pool.query("SELECT key, value FROM settings WHERE key IN ('settings', 'pages')");
      const map = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
      return { settings: map.settings || {}, pages: map.pages || {} };
    },
    async saveSettings(settings, pages) {
      await init();
      await pool.query(
        "INSERT INTO settings (key, value) VALUES ($1, $2), ($3, $4) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        ["settings", JSON.stringify(settings), "pages", JSON.stringify(pages)]
      );
    },
    async listProducts() {
      await init();
      return (await pool.query("SELECT * FROM products ORDER BY created_at ASC, id ASC")).rows.map(productFromRow);
    },
    async createProduct(product) { await init(); await insertProduct(product); return product; },
    async updateProduct(id, patch) {
      await init();
      const { sets, values } = buildUpdate(PRODUCT_COLUMNS, patch);
      if (!sets.length) return null;
      values.push(id);
      const result = await pool.query(`UPDATE products SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length} RETURNING *`, values);
      return result.rowCount ? productFromRow(result.rows[0]) : null;
    },
    async listOrders() {
      await init();
      return (await pool.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 500")).rows.map(orderFromRow);
    },
    async getOrder(id) {
      await init();
      const result = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
      return result.rowCount ? orderFromRow(result.rows[0]) : null;
    },
    async createOrder(order) {
      await init();
      await pool.query(
        `INSERT INTO orders (id, customer_name, customer_email, customer_phone, status, items, subtotal, discount, total, created_at, delivery_token, payment_provider, payment_id, payment_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [order.id, order.customerName, order.customerEmail, order.customerPhone, order.status, JSON.stringify(order.items), order.subtotal, order.discount, order.total,
          order.createdAt, order.deliveryToken, order.paymentProvider || "", order.paymentId || "", order.paymentPayload ? JSON.stringify(order.paymentPayload) : null]
      );
      return order;
    },
    async updateOrder(id, patch) {
      await init();
      const { sets, values } = buildUpdate(ORDER_COLUMNS, patch);
      if (!sets.length) return null;
      values.push(id);
      const result = await pool.query(`UPDATE orders SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
      return result.rowCount ? orderFromRow(result.rows[0]) : null;
    },
    async addSubscriber(email) {
      await init();
      const result = await pool.query("INSERT INTO subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING", [email]);
      return result.rowCount > 0;
    },
    async countSubscribers() {
      await init();
      return (await pool.query("SELECT COUNT(*)::int AS total FROM subscribers")).rows[0].total;
    },
    async close() { await pool.end(); }
  };
}

function createStore() {
  return config.databaseUrl ? createPgStore() : createJsonStore();
}

module.exports = { createStore };
