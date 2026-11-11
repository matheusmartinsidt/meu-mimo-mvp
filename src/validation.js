const config = require("./config");

const ORDER_STATUSES = ["pending", "paid", "delivered", "canceled"];
const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/;

class ValidationError extends Error {
  constructor(fields) {
    const first = Object.values(fields)[0] || "Dados invalidos.";
    super(first);
    this.name = "ValidationError";
    this.fields = fields;
  }
}

function cleanText(value, max) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

function isEmail(value) {
  return typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** Aceita telefone brasileiro com DDD (10 ou 11 digitos), com ou sem +55. */
function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (Number(digits.slice(0, 2)) < 11) return null;
  return digits;
}

function parsePrice(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).trim().replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  if (!Number.isFinite(number)) return NaN;
  return Math.round(number * 100) / 100;
}

function isSafeUrl(value, { allowRelativeUploads = false } = {}) {
  if (typeof value !== "string" || value.length > 2000) return false;
  if (allowRelativeUploads && /^\/uploads\/[a-zA-Z0-9._-]+$/.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function toBoolean(value) {
  return value === true || value === "on" || value === "true" || value === 1 || value === "1";
}

function createSlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 80);
}

function validateCustomer(body = {}) {
  const errors = {};
  const customerName = cleanText(body.customerName, 120);
  const customerEmail = cleanText(body.customerEmail, 254).toLowerCase();
  const customerPhone = normalizePhone(body.customerPhone);
  if (customerName.length < 3 || !/\p{L}{2,}/u.test(customerName)) errors.customerName = "Informe seu nome completo.";
  if (!isEmail(customerEmail)) errors.customerEmail = "Informe um e-mail válido.";
  if (!customerPhone) errors.customerPhone = "Informe um WhatsApp válido com DDD.";
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { customerName, customerEmail, customerPhone };
}

/** Normaliza o carrinho enviado pelo navegador: so ids e quantidades, nunca precos. */
function validateCart(cart) {
  if (!Array.isArray(cart) || !cart.length) throw new ValidationError({ cart: "Seu carrinho está vazio." });
  if (cart.length > config.limits.maxCartLines) throw new ValidationError({ cart: "Carrinho com itens demais." });
  const merged = new Map();
  for (const line of cart) {
    const id = cleanText(line?.id, 80);
    const quantity = Number(line?.quantity ?? 1);
    if (!id) throw new ValidationError({ cart: "Carrinho com item inválido." });
    if (!Number.isInteger(quantity) || quantity < 1) throw new ValidationError({ cart: "Quantidade inválida no carrinho." });
    merged.set(id, (merged.get(id) || 0) + quantity);
  }
  for (const quantity of merged.values()) {
    if (quantity > config.limits.maxQuantity) throw new ValidationError({ cart: `Quantidade máxima por item: ${config.limits.maxQuantity}.` });
  }
  return [...merged].map(([id, quantity]) => ({ id, quantity }));
}

/**
 * Valida os campos de produto vindos do painel.
 * Com `partial`, campos ausentes sao ignorados (edicao); caso contrario sao obrigatorios (cadastro).
 */
function validateProduct(body = {}, { partial = false } = {}) {
  const errors = {};
  const out = {};
  const has = (key) => body[key] !== undefined;
  const required = (key, label, max, min = 2) => {
    if (partial && !has(key)) return;
    const value = cleanText(body[key], max);
    if (value.length < min) errors[key] = `${label}: preencha este campo.`;
    else out[key] = value;
  };

  required("name", "Nome", 120);
  required("category", "Categoria", 60);
  required("shortDescription", "Descrição curta", 240, 5);
  required("description", "Descrição completa", 4000, 5);

  if (!partial || has("price")) {
    const price = parsePrice(body.price);
    if (price === null || Number.isNaN(price) || price <= 0 || price > 99999) errors.price = "Preço: informe um valor maior que zero.";
    else out.price = price;
  }
  if (!partial || has("compareAtPrice")) {
    const compare = parsePrice(body.compareAtPrice);
    if (Number.isNaN(compare) || (compare !== null && (compare <= 0 || compare > 99999))) errors.compareAtPrice = "Preço antigo inválido.";
    else out.compareAtPrice = compare;
  }
  if (!partial || has("image")) {
    const image = cleanText(body.image, 2000);
    if (!isSafeUrl(image, { allowRelativeUploads: true })) errors.image = "Imagem: envie um arquivo ou cole um link http(s) válido.";
    else out.image = image;
  }
  if (!partial || has("gallery")) {
    const list = (Array.isArray(body.gallery) ? body.gallery : String(body.gallery || "").split(/\r?\n/))
      .map((url) => cleanText(url, 2000))
      .filter(Boolean);
    if (list.length > 8) errors.gallery = "Galeria: no máximo 8 imagens.";
    else if (list.some((url) => !isSafeUrl(url, { allowRelativeUploads: true }))) errors.gallery = "Galeria: há um link inválido.";
    else out.gallery = list;
  }
  if (!partial || has("digitalDeliveryUrl")) {
    const delivery = cleanText(body.digitalDeliveryUrl, 2000);
    if (delivery && !isSafeUrl(delivery)) errors.digitalDeliveryUrl = "Link de entrega: use um link http(s) válido.";
    else out.digitalDeliveryUrl = delivery;
  }
  if (has("slug") && cleanText(body.slug, 80)) {
    const slug = createSlug(body.slug);
    if (!slug) errors.slug = "Link curto inválido.";
    else out.slug = slug;
  }
  // Checkbox desmarcado não vem no formulario: em cadastro/edicao completa, ausencia = false.
  if (!partial || has("featured") || body._form === "full") out.featured = toBoolean(body.featured);
  if (!partial || has("active") || body._form === "full") out.active = toBoolean(body.active);

  if (out.price !== undefined && out.compareAtPrice && out.compareAtPrice <= out.price) {
    errors.compareAtPrice = "Preço antigo deve ser maior que o preço de venda.";
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return out;
}

function validateSettings(body = {}) {
  const errors = {};
  const settings = {
    storeName: cleanText(body.storeName, 80),
    tagline: cleanText(body.tagline, 200),
    whatsapp: String(body.whatsapp || "").replace(/\D/g, ""),
    instagram: cleanText(body.instagram, 300),
    email: cleanText(body.email, 254),
    city: cleanText(body.city, 80),
    pixDiscountPercent: Number(String(body.pixDiscountPercent ?? 0).replace(",", "."))
  };
  const pages = {
    about: cleanText(body.about, 2000),
    faq: cleanText(body.faq, 2000),
    privacy: cleanText(body.privacy, 6000)
  };
  if (settings.storeName.length < 2) errors.storeName = "Informe o nome da loja.";
  if (settings.whatsapp && (settings.whatsapp.length < 10 || settings.whatsapp.length > 13)) errors.whatsapp = "WhatsApp: use DDI + DDD + número (ex: 5511999999999).";
  if (settings.email && !isEmail(settings.email)) errors.email = "E-mail de contato inválido.";
  if (settings.instagram && !isSafeUrl(settings.instagram)) errors.instagram = "Instagram: use o link completo (https://...).";
  if (!Number.isFinite(settings.pixDiscountPercent) || settings.pixDiscountPercent < 0 || settings.pixDiscountPercent > 90) errors.pixDiscountPercent = "Desconto Pix deve ficar entre 0 e 90.";
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { settings, pages };
}

/** Confere tipo e conteudo real (magic bytes) de uma imagem enviada como data URL. */
function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new ValidationError({ image: "Imagem inválida. Use PNG, JPG, WEBP ou GIF." });
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw new ValidationError({ image: "Imagem vazia." });
  if (buffer.length > config.limits.uploadImageBytes) throw new ValidationError({ image: "Imagem muito grande (máximo 5 MB)." });
  const hex = buffer.subarray(0, 12).toString("hex");
  let ext = null;
  if (hex.startsWith("89504e470d0a1a0a")) ext = "png";
  else if (hex.startsWith("ffd8ff")) ext = "jpg";
  else if (hex.startsWith("474946383761") || hex.startsWith("474946383961")) ext = "gif";
  else if (hex.startsWith("52494646") && hex.slice(16, 24) === "57454250") ext = "webp";
  if (!ext) throw new ValidationError({ image: "O arquivo enviado não é uma imagem válida." });
  return { buffer, ext };
}

module.exports = {
  ORDER_STATUSES,
  ValidationError,
  cleanText,
  isEmail,
  normalizePhone,
  parsePrice,
  isSafeUrl,
  toBoolean,
  createSlug,
  validateCustomer,
  validateCart,
  validateProduct,
  validateSettings,
  parseImageDataUrl
};
