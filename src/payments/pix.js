/** Gera o "Pix copia e cola" estatico (BR Code / EMV) sem depender de gateway. */

function field(id, value) {
  const text = String(value);
  return `${id}${String(text.length).padStart(2, "0")}${text}`;
}

function crc16(payload) {
  let crc = 0xffff;
  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function ascii(value, max) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .slice(0, max);
}

/** Aceita CPF/CNPJ, e-mail, telefone ou chave aleatoria e devolve no formato esperado pelo BR Code. */
function normalizePixKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  if (raw.includes("@")) return raw.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return raw.toLowerCase();
  if (raw.startsWith("+")) return `+${raw.replace(/\D/g, "")}`;
  return raw.replace(/[.\-/\s()]/g, "");
}

function buildPixPayload({ key, merchantName, merchantCity, amount, txid }) {
  const pixKey = normalizePixKey(key);
  if (!pixKey) throw new Error("Chave Pix nao configurada.");
  const account = field("00", "br.gov.bcb.pix") + field("01", pixKey);
  const reference = String(txid || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const payload =
    field("00", "01") +
    field("26", account) +
    field("52", "0000") +
    field("53", "986") +
    (amount ? field("54", Number(amount).toFixed(2)) : "") +
    field("58", "BR") +
    field("59", ascii(merchantName, 25) || "LOJA") +
    field("60", ascii(merchantCity, 15) || "BRASIL") +
    field("62", field("05", reference)) +
    "6304";
  return payload + crc16(payload);
}

module.exports = { buildPixPayload, normalizePixKey, crc16 };
