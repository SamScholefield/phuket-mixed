require('dotenv').config();
const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const SHEET_ID = process.env.SHEET_ID;
const API_KEY  = process.env.GOOGLE_SHEETS_API_KEY;

app.use(express.static(path.join(__dirname, 'public')));

// ── Sheets helper ─────────────────────────────────────────────────────────
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

// ── Single endpoint — fetches both sheets in parallel ─────────────────────
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

// ── Health check for Railway ──────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Tournament server running on :${PORT}`));
