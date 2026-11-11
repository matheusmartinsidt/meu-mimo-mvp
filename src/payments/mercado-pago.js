const { createHmac } = require("node:crypto");
const config = require("../config");
const { safeEqual } = require("../security");
const { WebhookAuthError } = require("./errors");

const API = "https://api.mercadopago.com";

function mapStatus(status) {
  if (status === "approved" || status === "accredited") return "paid";
  if (["cancelled", "rejected", "refunded", "charged_back"].includes(status)) return "canceled";
  return "pending";
}

async function getPayment(paymentId) {
  const response = await fetch(`${API}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Bearer ${config.mercadoPago.accessToken}` },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) return null;
  return response.json();
}

/** Valida o cabecalho x-signature (ts=...,v1=...) conforme a documentacao do Mercado Pago. */
function verifySignature({ headers, dataId }) {
  const secret = config.mercadoPago.webhookSecret;
  if (!secret) return true;
  const parts = Object.fromEntries(String(headers["x-signature"] || "").split(",").map((part) => part.trim().split("=")));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};request-id:${headers["x-request-id"] || ""};ts:${parts.ts};`;
  return safeEqual(parts.v1, createHmac("sha256", secret).update(manifest).digest("hex"));
}

module.exports = {
  id: "mercado-pago",
  label: "Mercado Pago",
  automatic: true,
  isConfigured: () => Boolean(config.mercadoPago.accessToken),
  mapStatus,
  verifySignature,

  async createPayment(order) {
    const [firstName, ...rest] = String(order.customerName || "Cliente").split(/\s+/);
    const response = await fetch(`${API}/v1/payments`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.mercadoPago.accessToken}`,
        "content-type": "application/json",
        "x-idempotency-key": order.id
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        transaction_amount: Number(order.total.toFixed(2)),
        description: `Pedido ${order.id}`,
        payment_method_id: "pix",
        external_reference: order.id,
        notification_url: `${config.publicBaseUrl}/api/webhooks/mercado-pago`,
        payer: { email: order.customerEmail, first_name: firstName, last_name: rest.join(" ") || undefined }
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || payload?.error || "Não foi possível criar o pagamento Pix.");
    const data = payload?.point_of_interaction?.transaction_data || {};
    return {
      paymentId: String(payload.id || ""),
      view: {
        message: "Pague com Pix para liberar seus arquivos. A confirmação é automática.",
        pixCopyPaste: data.qr_code || "",
        qrCode: data.qr_code_base64 ? `data:image/png;base64,${data.qr_code_base64}` : "",
        ticketUrl: data.ticket_url || ""
      }
    };
  },

  /** Nunca confia no corpo do webhook: usa so o id e consulta o pagamento na API oficial. */
  async parseWebhook({ headers, query, body }) {
    const type = body?.type || query.get("type") || query.get("topic") || "payment";
    const dataId = String(query.get("data.id") || body?.data?.id || query.get("id") || body?.id || "");
    if (!dataId || !/^[\w-]{1,64}$/.test(dataId)) return null;
    if (!verifySignature({ headers, dataId })) throw new WebhookAuthError("Assinatura do webhook inválida.");
    if (type !== "payment") return null;
    const payment = await getPayment(dataId);
    if (!payment?.external_reference) return null;
    return {
      orderId: String(payment.external_reference),
      paymentId: String(payment.id || dataId),
      status: mapStatus(payment.status),
      amount: Number(payment.transaction_amount || 0)
    };
  }
};
