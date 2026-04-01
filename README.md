# Phuket Mixed Touch Rugby 2026 — Tournament Site

Live standings and fixtures, updated every 30 seconds. Read-only public UI on Railway. Data managed entirely in Google Sheets.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Google Sheets (you manage this)                    │
│                                                     │
│  ┌──────────────┐      ┌──────────────┐             │
│  │  Fixtures    │      │   Scores     │◄── Google   │
│  │  (static)    │      │  (Form rows) │    Form     │
│  └──────┬───────┘      └──────┬───────┘             │
└─────────┼────────────────────┼─────────────────────┘
          │  Sheets API (read) │
          ▼                    ▼
┌─────────────────────────────────────────────────────┐
│  Express server on Railway                          │
│  · Holds API key in env vars (never exposed)        │
│  · Joins both sheets into one /api/data response    │
│  · No auth — purely read proxy                      │
└─────────────────────┬───────────────────────────────┘
                      │  JSON
                      ▼
┌─────────────────────────────────────────────────────┐
│  Browser (anyone with the Railway URL)              │
│  · Fetches /api/data every 30 seconds               │
│  · Computes standings client-side                   │
│  · Renders schedule, tables, bracket                │
│  · No login required — fully public read-only       │
└─────────────────────────────────────────────────────┘
```

---

## Step 1 — Create the Google Spreadsheet

Create a new Google Sheet. It needs **two tabs** named exactly as shown.

### Tab 1: `Fixtures`

Pre-fill before the tournament. **Row 1 is the header — the app skips it.**

Columns A–H:

| MatchID | Type  | Pool | Home                   | Away                  | Time  | Pitch | Refs             |
|---------|-------|------|------------------------|-----------------------|-------|-------|------------------|
| P1M1    | pool  | 1    | The Hickeys            | Pattaya Panthers      | 12:30 | 1     | Russell / Damian |
| P2M1    | pool  | 2    | Phuket Piranha OGs     | Bin Juice             | 12:30 | 2     | Chris / Rafael   |
| P1M2    | pool  | 1    | Bangkok Southerners    | Hat Yai Pretty Mammoth| 12:45 | 1     | Jim / Suj        |
| P2M2    | pool  | 2    | Outrigger              | Vagabonds Academy     | 12:45 | 2     | Russell / Jacob  |
| P1M3    | pool  | 1    | The Kings              | The Hickeys           | 13:00 | 1     | Chris / Ivan     |
| P2M3    | pool  | 2    | Barbarians             | Phuket Piranha OGs    | 13:00 | 2     | Jim / Mod        |
| P1M4    | pool  | 1    | Pattaya Panthers       | Bangkok Southerners   | 13:15 | 1     | Russell / James  |
| P2M4    | pool  | 2    | Bin Juice              | Outrigger             | 13:15 | 2     | Chris / Harry    |
| P1M5    | pool  | 1    | Hat Yai Pretty Mammoth | The Kings             | 13:30 | 1     | Jim / Grace      |
| P2M5    | pool  | 2    | Vagabonds Academy      | Barbarians            | 13:30 | 2     | Russell / Ruth   |
| P2M6    | pool  | 2    | Phuket Piranha OGs     | Outrigger             | 13:55 | 1     | Chris / Mod      |
| P1M6    | pool  | 1    | The Hickeys            | Bangkok Southerners   | 13:55 | 2     | Jim / Tom        |
| P2M7    | pool  | 2    | Bin Juice              | Vagabonds Academy     | 14:10 | 1     | Russell / Jacob  |
| P1M7    | pool  | 1    | Pattaya Panthers       | Hat Yai Pretty Mammoth| 14:10 | 2     | Chris / Suj      |
| P2M8    | pool  | 2    | Outrigger              | Barbarians            | 14:25 | 1     | Jim / Harry      |
| P1M8    | pool  | 1    | Bangkok Southerners    | The Kings             | 14:25 | 2     | Russell / James  |
| P2M9    | pool  | 2    | Vagabonds Academy      | Phuket Piranha OGs    | 14:40 | 1     | Chris / Ruth     |
| P1M9    | pool  | 1    | Hat Yai Pretty Mammoth | The Hickeys           | 14:40 | 2     | Jim / Damian     |
| P2M10   | pool  | 2    | Barbarians             | Bin Juice             | 14:55 | 1     | Russell / Cam    |
| P1M10   | pool  | 1    | The Kings              | Pattaya Panthers      | 14:55 | 2     | Chris / Ivan     |
| PSF1    | psf   |      | 3rd Pool 1             | 4th Pool 2            | 15:40 | 1     | Jim / TBC        |
| PSF2    | psf   |      | 3rd Pool 2             | 4th Pool 1            | 15:40 | 2     | Russell / TBC    |
| CSF1    | csf   |      | 1st Pool 1             | 2nd Pool 2            | 16:00 | 1     | Chris / TBC      |
| CSF2    | csf   |      | 1st Pool 2             | 2nd Pool 1            | 16:00 | 2     | Jim / TBC        |
| BOWL    | bowl  |      | 5th Pool 1             | 5th Pool 2            | 16:50 | 1     | Russell / Chris  |
| PLATE   | plate |      | Winner PSF1            | Winner PSF2           | 17:10 | 1     | Jim / Russell    |
| CUP     | cup   |      | Winner CSF1            | Winner CSF2           | 17:30 | 1     | Chris / Jim      |

**Type values** (must be lowercase):

| Type    | Meaning            |
|---------|--------------------|
| `pool`  | Pool stage match   |
| `psf`   | Plate semi-final   |
| `csf`   | Cup semi-final     |
| `bowl`  | Bowl final         |
| `plate` | Plate final        |
| `cup`   | Cup final          |

**Knockout slot labels** (Home/Away columns for knockout matches) — the app resolves these automatically once pool stage is complete:

| Label pattern    | Meaning                                 |
|------------------|-----------------------------------------|
| `1st Pool 1`     | 1st place finisher in Pool 1            |
| `2nd Pool 2`     | 2nd place finisher in Pool 2            |
| `Winner PSF1`    | Winner of the PSF1 match                |

**Protect this tab** once filled: right-click the tab → Protect sheet → restrict to editors only. Prevents accidental edits during the tournament.

---

### Tab 2: `Scores`

**Do not fill this in manually.** It is populated automatically by your Google Form (see Step 2).

The app expects these columns in row 1 (Google Form creates them automatically):

| A         | B       | C          | D          |
|-----------|---------|------------|------------|
| Timestamp | MatchID | HomeScore  | AwayScore  |

If a score is entered incorrectly, just submit the form again with the right score — **the last entry for each MatchID always wins.**

---

## Step 2 — Create the Google Form (score entry)

This is what referees use on their phones after each match.

1. Go to [forms.google.com](https://forms.google.com) → **Blank form**
2. Title it: **"Enter Match Score"**
3. Add these three questions:

   **Question 1 — Match ID**
   - Type: Dropdown
   - Options (one per line):
     ```
     P1M1, P1M2, P1M3, P1M4, P1M5, P1M6, P1M7, P1M8, P1M9, P1M10
     P2M1, P2M2, P2M3, P2M4, P2M5, P2M6, P2M7, P2M8, P2M9, P2M10
     PSF1, PSF2, CSF1, CSF2, BOWL, PLATE, CUP
     ```
   - Mark as **Required**

   **Question 2 — Home Score** (team listed on left / first)
   - Type: Short answer
   - Validation: Number → Greater than or equal to → 0
   - Mark as **Required**

   **Question 3 — Away Score** (team listed on right / second)
   - Type: Short answer
   - Same validation as above
   - Mark as **Required**

4. Click the **green Sheets icon** (Link to Sheets) → Select existing spreadsheet → choose your tournament sheet → select the **Scores** tab
5. Send the form link to all referees. Bookmark it on their phones before the tournament.

**Tip:** Add a note to the form description: *"Home team = team listed FIRST on the schedule / pitch board."*

---

## Step 3 — Google Sheets API setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. "Phuket Touch Rugby")
3. Search for **Google Sheets API** → Enable it
4. Go to **Credentials** → **Create Credentials** → **API Key**
5. Click **Restrict Key**:
   - API restrictions → Restrict to: **Google Sheets API**
   - Application restrictions → HTTP referrers → add your Railway domain (e.g. `your-app.railway.app/*`)
6. Copy the API key — you'll need it in Step 5

**Make the spreadsheet public (read access):**
- In your Google Sheet: Share → Anyone with the link → **Viewer**
- Copy the Sheet ID from the URL:
  `https://docs.google.com/spreadsheets/d/`**`THIS_LONG_ID`**`/edit`

---

## Step 4 — Local development (optional)

```bash
cp .env.example .env
# Edit .env and fill in GOOGLE_SHEETS_API_KEY and SHEET_ID

npm install
npm run dev
# Open http://localhost:3000
```

---

## Step 5 — Deploy to Railway

1. Push this folder to a **GitHub repository**
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select your repo
3. Once deployed, go to the service → **Variables** tab → add:
   ```
   GOOGLE_SHEETS_API_KEY = (your key from Step 3)
   SHEET_ID             = (your sheet ID from Step 3)
   ```
4. Railway detects Node.js and runs `npm start` automatically
5. Go to **Settings** → **Networking** → **Generate Domain** to get your public URL

**Important — prevent cold starts:**
Railway's free tier sleeps after inactivity. On tournament day you want instant response.
- Upgrade to the Starter plan (~$5/month) OR
- Go to Settings → Deploy → set **Restart Policy** to keep alive

Share the Railway URL with players and spectators. That's it.

---

## Day-of checklist

- [ ] Fixtures tab filled and protected in Google Sheet
- [ ] Scores tab empty (will fill via Form)
- [ ] Google Form tested — submit one dummy score and verify it appears in Scores tab
- [ ] Railway service deployed and accessible
- [ ] Form link bookmarked on referee phones
- [ ] Venue has mobile data / wifi (have a hotspot as backup)
- [ ] Test full flow: enter score in Form → check Railway site updates within 30s

---

## Updating knockout teams

When pool stage ends, update the Home/Away cells in the Fixtures sheet for the knockout matches (PSF1, PSF2, CSF1, CSF2, BOWL) with the actual team names — or leave the slot labels in (e.g. "1st Pool 1") and the site resolves them automatically once all pool scores are in.

The site will auto-populate team names in the bracket and schedule as soon as both pools are complete.
