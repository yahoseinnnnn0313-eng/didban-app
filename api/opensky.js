// api/opensky.js
const https = require('https');
const { URL } = require('url');

let cachedToken = null;
let tokenExpiry = 0;

// تابع کمکی برای درخواست با پشتیبانی از IPv4 و تلاش مجدد
function fetchWithIPv4(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { ...options, family: 4 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: () => Promise.resolve(data), json: () => Promise.resolve(JSON.parse(data)) }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getOpenSkyToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const clientId = process.env.OPENSKY_CLIENT_ID;
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('OpenSky credentials not configured');
  }

  const tokenUrl = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
  const postData = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  let lastError = null;
  // ۳ بار تلاش مجدد با فاصله
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchWithIPv4(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
        body: postData,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      cachedToken = data.access_token;
      tokenExpiry = now + (data.expires_in - 300) * 1000;
      return cachedToken;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 1000 * attempt)); // ۱ ثانیه، ۲ ثانیه، ۳ ثانیه صبر می‌کند
    }
  }
  throw new Error(`OpenSky token fetch failed after 3 attempts: ${lastError.message}`);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = await getOpenSkyToken();
    const { lamin, lomin, lamax, lomax } = req.query;

    const url = new URL('https://opensky-network.org/api/states/all');
    if (lamin) url.searchParams.set('lamin', lamin);
    if (lomin) url.searchParams.set('lomin', lomin);
    if (lamax) url.searchParams.set('lamax', lamax);
    if (lomax) url.searchParams.set('lomax', lomax);

    // درخواست API با IPv4
    const apiResponse = await fetchWithIPv4(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!apiResponse.ok) {
      const text = await apiResponse.text();
      return res.status(apiResponse.status).json({ error: text });
    }

    const data = await apiResponse.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};