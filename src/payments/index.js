/**
 * Camada de pagamento. Para integrar um novo gateway, crie um arquivo nesta pasta
 * exportando o mesmo contrato e registre-o em `providers`:
 *
 *   id, label           identificacao (o id tambem e o caminho do webhook: /api/webhooks/<id>)
 *   automatic           true quando o gateway confirma o pagamento sozinho (webhook)
 *   isConfigured()      true quando as credenciais necessarias estao no ambiente
 *   createPayment(order)  -> { paymentId, view: { message, pixCopyPaste?, qrCode?, ticketUrl? } }
 *   parseWebhook({ headers, query, body, rawBody })
 *                       -> { orderId, paymentId, status: "paid"|"pending"|"canceled", amount } | null
 *                          (lance WebhookAuthError quando a assinatura nao conferir)
 */
const config = require("../config");
const manual = require("./manual");
const mercadoPago = require("./mercado-pago");
const { WebhookAuthError } = require("./errors");

const providers = { [manual.id]: manual, [mercadoPago.id]: mercadoPago };

function getProvider(id) {
  return Object.hasOwn(providers, id) ? providers[id] : null;
}

/** Provedor ativo; cai no modo manual se o escolhido nao existir ou estiver sem credenciais. */
function activeProvider() {
  const provider = getProvider(config.paymentProvider);
  return provider && provider.isConfigured() ? provider : manual;
}

module.exports = { getProvider, activeProvider, providers, WebhookAuthError };
