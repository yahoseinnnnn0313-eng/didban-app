// api/opensky.js
const https = require('https');

let cachedToken = null;
let tokenExpiry = 0;

function request(urlStr, opts = {}) {
  const { method = 'GET', headers = {}, body = null, timeout = 6000 } = opts;
  return new Promise((resolve, reject) => {
    const req = https.request(urlStr, { method, headers, family: 4 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('Timeout')));
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;

  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('credentials not set');

  const postData = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: id,
    client_secret: secret,
  }).toString();

  const r = await request(
    'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
      body: postData,
      timeout: 5000,
    }
  );
  if (r.status < 200 || r.status >= 300) throw new Error('token HTTP ' + r.status);
  const data = JSON.parse(r.body);
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in - 300) * 1000;
  return cachedToken;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { lamin, lomin, lamax, lomax, debug } = req.query;
  const info = { tokenOk: false, tokenError: null, mode: null };

  let token = null;
  try {
    token = await getToken();
    info.tokenOk = true;
  } catch (e) {
    info.tokenError = e.message;
  }

  const url = new URL('https://opensky-network.org/api/states/all');
  if (lamin) url.searchParams.set('lamin', lamin);
  if (lomin) url.searchParams.set('lomin', lomin);
  if (lamax) url.searchParams.set('lamax', lamax);
  if (lomax) url.searchParams.set('lomax', lomax);

  try {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    info.mode = token ? 'token' : 'anonymous';
    const r = await request(url.toString(), { headers, timeout: 7000 });

    if (debug) {
      return res.status(200).json({ info, status: r.status, sample: r.body.slice(0, 200) });
    }
    if (r.status < 200 || r.status >= 300) {
      return res.status(r.status).json({ error: r.body.slice(0, 300), info });
    }
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).send(r.body);
  } catch (e) {
    return res.status(504).json({ error: 'OpenSky unreachable: ' + e.message, info });
  }
};