function parseRequestBody(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  try {
    const s = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Handler CommonJS (dossier `api/` avec `package.json` type commonjs → compatible Vercel + racine `"type":"module"`). */
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: { message: 'Missing ANTHROPIC_API_KEY' } });
  }

  const incoming = parseRequestBody(req.body);
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: { message: 'Invalid or empty JSON body' } });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(incoming)
  });

  const data = await response.json().catch(() => ({}));
  return res.status(response.status).json(data);
};
