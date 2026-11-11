const config = require("./config");

const isConfigured = () => Boolean(config.email.resendApiKey && config.email.from);

/**
 * Envio de e-mail transacional opcional (Resend). Sem RESEND_API_KEY/EMAIL_FROM nada e enviado.
 * Falhas nunca derrubam o pedido: sao apenas registradas no log.
 */
async function sendMail({ to, subject, html }) {
  if (!isConfigured()) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.email.resendApiKey}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ from: config.email.from, to: [to], subject, html })
    });
    if (!response.ok) console.error(`[email] falha ao enviar (${response.status})`);
    return response.ok;
  } catch (error) {
    console.error("[email] falha ao enviar:", error.message);
    return false;
  }
}

module.exports = { sendMail, isConfigured };
