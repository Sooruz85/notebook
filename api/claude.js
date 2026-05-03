export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: { message: 'Missing ANTHROPIC_API_KEY' } });
  }

  const body =
    req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === 'string'
        ? (() => {
            try {
              return JSON.parse(req.body || '{}');
            } catch {
              return null;
            }
          })()
        : null;

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: { message: 'Invalid JSON body' } });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(response.status).json(data);
}
