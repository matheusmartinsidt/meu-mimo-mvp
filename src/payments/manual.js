const QRCode = require("qrcode");
const config = require("../config");
const { buildPixPayload } = require("./pix");

/**
 * Provedor sem gateway: o pedido fica pendente e a equipe confirma no painel.
 * Com PIX_KEY configurada, gera Pix copia e cola + QR Code estaticos com o valor do pedido.
 */
module.exports = {
  id: "manual",
  label: "Pix manual",
  automatic: false,
  isConfigured: () => true,

  async createPayment(order) {
    if (!config.pix.key) {
      return {
        paymentId: "",
        view: { message: "Pedido criado! Fale com a gente no WhatsApp para combinar o pagamento. Assim que confirmarmos, seus arquivos aparecem nesta página." }
      };
    }
    const pixCopyPaste = buildPixPayload({
      key: config.pix.key,
      merchantName: config.pix.merchantName,
      merchantCity: config.pix.merchantCity,
      amount: order.total,
      txid: order.id
    });
    return {
      paymentId: "",
      view: {
        message: "Pague com Pix e envie o comprovante pelo WhatsApp. Assim que confirmarmos, seus arquivos aparecem nesta página.",
        pixCopyPaste,
        qrCode: await QRCode.toDataURL(pixCopyPaste, { margin: 1, width: 440 })
      }
    };
  },

  async parseWebhook() {
    return null;
  }
};
