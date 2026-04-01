require('dotenv').config();
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const SHEET_ID  = process.env.SHEET_ID;
const API_KEY   = process.env.GOOGLE_SHEETS_API_KEY;
const SCORE_PIN = process.env.SCORE_ENTRY_PIN;
const SA_CREDS  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
                    ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
                    : null;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

// ── Read endpoint ───────────────────────────────────────────────────────────
app.get('/api/data', async (req, res) => {
  try {
    const [fixtures, scores] = await Promise.all([
      fetchRange('Fixtures!A:I'),   // MatchID|Type|Pool|Home|Away|Time|Pitch|Ref1|Ref2
      fetchRange('Scores!A:D'),     // Timestamp|MatchID|HomeScore|AwayScore
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({ fixtures, scores });
  } catch (err) {
    console.error('[/api/data]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PIN verification ────────────────────────────────────────────────────────
app.post('/api/verify-pin', (req, res) => {
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
app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Tournament server running on :${PORT}`));
