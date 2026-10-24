let cachedToken = null;
let tokenExpiry = 0;

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

  const response = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenSky token error: ${response.status}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in - 300) * 1000;
  return cachedToken;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const token = await getOpenSkyToken();
    const { lamin, lomin, lamax, lomax } = req.query;

    const url = new URL('https://opensky-network.org/api/states/all');
    if (lamin) url.searchParams.set('lamin', lamin);
    if (lomin) url.searchParams.set('lomin', lomin);
    if (lamax) url.searchParams.set('lamax', lamax);
    if (lomax) url.searchParams.set('lomax', lomax);

    const apiResponse = await fetch(url.toString(), {
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