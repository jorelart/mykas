const { normalizePhone } = require('./phone');

function evolutionReady() {
  return Boolean(process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY && process.env.EVOLUTION_INSTANCE);
}

async function sendWhatsApp(number, text) {
  const base = process.env.EVOLUTION_API_URL.replace(/\/$/, '');
  const instance = encodeURIComponent(process.env.EVOLUTION_INSTANCE);
  const response = await fetch(`${base}/message/sendText/${instance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_API_KEY },
    body: JSON.stringify({ number: normalizePhone(number), text }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Evolution API mengembalikan HTTP ${response.status}.`);
}

module.exports = { evolutionReady, sendWhatsApp };
