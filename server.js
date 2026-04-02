require('dotenv').config();
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // Railway runs behind a reverse proxy

const SHEET_ID  = process.env.SHEET_ID;
const API_KEY   = process.env.GOOGLE_SHEETS_API_KEY;
const SCORE_PIN = process.env.SCORE_ENTRY_PIN;
const SA_CREDS  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
                    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
                    : null;

// ── Security headers ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.json());

// ── Rate limiter (PIN brute-force prevention) ───────────────────────────────
const pinAttempts = new Map(); // ip -> { count, resetAt }
const PIN_RATE_WINDOW = 60 * 1000; // 1 minute
const PIN_RATE_MAX    = 5;         // max attempts per window

function checkPinRate(req, res) {
  const ip = req.ip;
  const now = Date.now();
  let entry = pinAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + PIN_RATE_WINDOW };
    pinAttempts.set(ip, entry);
  }

  entry.count++;
  if (entry.count > PIN_RATE_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({ error: `Too many attempts. Try again in ${retryAfter}s` });
    return false;
  }
  return true;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of pinAttempts) {
    if (now > entry.resetAt) pinAttempts.delete(ip);
  }
}, 5 * 60 * 1000);

// ── Sheets read helper ──────────────────────────────────────────────────────
async function fetchRange(range) {
  if (!API_KEY || !SHEET_ID) {
    throw new Error('Missing GOOGLE_SHEETS_API_KEY or SHEET_ID env vars');
  }
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}` +
    `/values/${encodeURIComponent(range)}?key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Sheets API ${res.status}`);
  }
  const data = await res.json();
  return data.values || [];
}

// ── Google Service Account JWT auth (no external libs) ──────────────────────
function base64url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let tokenCache = null;

async function getGoogleAccessToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.token;
  }

  if (!SA_CREDS) throw new Error('Service account not configured');

  const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const claims = base64url(Buffer.from(JSON.stringify({
    iss: SA_CREDS.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })));

  const signInput = `${header}.${claims}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = base64url(signer.sign(SA_CREDS.private_key));

  const jwt = `${signInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description || `Token exchange failed: ${res.status}`);
  }

  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return tokenCache.token;
}

// ── Sheets write helper ─────────────────────────────────────────────────────
async function appendToSheet(range, values) {
  const token = await getGoogleAccessToken();
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}` +
    `/values/${encodeURIComponent(range)}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Sheets append failed: ${res.status}`);
  }
  return res.json();
}

// ── Server-side response cache ───────────────────────────────────────────────
const DATA_CACHE_TTL = 10 * 1000; // 10 seconds
let dataCache = null;   // { data, expiresAt }
let dataFlight = null;  // in-flight promise (prevents thundering herd)

function invalidateDataCache() { dataCache = null; }

async function getCachedData() {
  if (dataCache && Date.now() < dataCache.expiresAt) return dataCache.data;
  if (dataFlight) return dataFlight;

  dataFlight = Promise.all([
    fetchRange('Fixtures!A:I'),
    fetchRange('Scores!A:D'),
  ]).then(([fixtures, scores]) => {
    const data = { fixtures, scores };
    dataCache = { data, expiresAt: Date.now() + DATA_CACHE_TTL };
    dataFlight = null;
    return data;
  }).catch(err => {
    dataFlight = null;
    throw err;
  });

  return dataFlight;
}

// ── Read endpoint ───────────────────────────────────────────────────────────
app.get('/api/data', async (req, res) => {
  try {
    const data = await getCachedData();
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) {
    console.error('[/api/data]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PIN verification ────────────────────────────────────────────────────────
app.post('/api/verify-pin', (req, res) => {
  if (!checkPinRate(req, res)) return;
  if (!SCORE_PIN) return res.status(500).json({ error: 'Score entry not configured' });
  if (req.body.pin === SCORE_PIN) return res.json({ ok: true });
  res.status(403).json({ error: 'Invalid PIN' });
});

// ── Score submission ────────────────────────────────────────────────────────
app.post('/api/score', async (req, res) => {
  try {
    const { matchId, homeScore, awayScore, pin } = req.body;

    if (!SCORE_PIN) return res.status(500).json({ error: 'Score entry not configured' });
    if (pin !== SCORE_PIN) return res.status(403).json({ error: 'Invalid PIN' });

    if (!matchId || typeof matchId !== 'string')
      return res.status(400).json({ error: 'Missing match ID' });
    const h = parseInt(homeScore), a = parseInt(awayScore);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0)
      return res.status(400).json({ error: 'Invalid scores' });

    const timestamp = new Date().toISOString();
    await appendToSheet('Scores!A:D', [[timestamp, matchId.trim().toUpperCase(), h, a]]);
    invalidateDataCache();

    res.json({ ok: true, matchId: matchId.trim().toUpperCase(), homeScore: h, awayScore: a });
  } catch (err) {
    console.error('[POST /api/score]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Score entry page ────────────────────────────────────────────────────────
app.get('/score', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'score.html'));
});

// ── Health check for Railway ────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  ok: true,
  sheetsConfigured: !!(API_KEY && SHEET_ID),
  scoreEntryConfigured: !!(SCORE_PIN && SA_CREDS),
}));

// ── Start server ────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => console.log(`Tournament server running on :${PORT}`));

// ── Graceful shutdown ───────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`${signal} received — closing server`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000); // force exit after 5s
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
