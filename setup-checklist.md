# Phuket Mixed Touch Rugby 2026 — Setup Checklist

---

## 1. Google Sheet

- [ ] Create a new Google Sheet at [sheets.google.com](https://sheets.google.com)
- [ ] Rename the default tab to `Fixtures`
- [ ] Import `Fixtures.csv` → File → Import → Upload → Replace current sheet → Comma separator
- [ ] Add a second tab, rename it `Scores`
- [ ] Import `Scores.csv` into the Scores tab the same way
- [ ] Select column C (Pool) in Fixtures → Format → Number → Number (ensures it's not treated as text)
- [ ] Share the sheet → Anyone with the link → **Viewer**
- [ ] Copy the Sheet ID from the URL: `docs.google.com/spreadsheets/d/`**`COPY_THIS`**`/edit`

---

## 2. Google Cloud — API Key

- [ ] Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project
- [ ] Search "Google Sheets API" → Enable it
- [ ] Credentials → Create Credentials → API Key
- [ ] Copy the API key somewhere safe
- [ ] *(Optional now, required before Railway)* Click Restrict Key → restrict to Google Sheets API only

---

## 3. Google Form — Score Entry

- [ ] Go to [forms.google.com](https://forms.google.com) → Blank form → title it **"Enter Match Score"**
- [ ] Add Question 1: **Match ID** — type Dropdown, add all IDs:
  ```
  P1M1, P1M2, P1M3, P1M4, P1M5, P1M6, P1M7, P1M8, P1M9, P1M10
  P2M1, P2M2, P2M3, P2M4, P2M5, P2M6, P2M7, P2M8, P2M9, P2M10
  PSF1, PSF2, CSF1, CSF2, BOWL, PLATE, CUP
  ```
  Mark as **Required**
- [ ] Add Question 2: **Home Score** — Short answer, number validation (≥ 0) — mark Required
- [ ] Add Question 3: **Away Score** — Short answer, same validation — mark Required
- [ ] Click the green Sheets icon (Link to Sheets) → Select existing spreadsheet → pick your tournament sheet → select the **Scores** tab
- [ ] Submit one test entry and confirm a row appears in the Scores tab
- [ ] Delete the test row from the Scores tab

---

## 4. Local Dev

- [ ] Unzip `tournament-site.zip`
- [ ] `cd tournament-site`
- [ ] `cp .env.example .env`
- [ ] Open `.env` and fill in both values:
  ```
  GOOGLE_SHEETS_API_KEY=your_key_here
  SHEET_ID=your_sheet_id_here
  ```
- [ ] `npm install`
- [ ] `npm run dev`
- [ ] Open [http://localhost:3000](http://localhost:3000)
- [ ] Check fixtures load correctly in the Schedule view
- [ ] Enter a test score via the Google Form → wait 30 seconds → confirm it appears on the site
- [ ] Check standings update correctly from the test score
- [ ] Delete the test score row from the Scores tab

---

## 5. Railway Deploy

- [ ] Create a GitHub repo and push the contents of `tournament-site/` to the repo root (not the folder itself — `server.js` should be at root)
- [ ] Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → select your repo
- [ ] Wait for first deploy to complete
- [ ] Go to the service → **Variables** tab → add:
  - `GOOGLE_SHEETS_API_KEY`
  - `SHEET_ID`
- [ ] Service will redeploy automatically after adding vars
- [ ] Settings → Networking → Generate Domain → copy your public URL
- [ ] Visit the URL and confirm it works identically to local
- [ ] *(Recommended)* Upgrade to Starter plan (~$5/mo) to prevent cold starts on tournament day

---

## 6. Day-Before Check

- [ ] Visit the live Railway URL and confirm Schedule and Tables load
- [ ] Submit a score via the Form → confirm it appears on the live site within 30 seconds
- [ ] Delete the test score
- [ ] Protect the Fixtures tab: right-click tab → Protect Sheet → restrict editing to yourself only
- [ ] Share the Form link with all referees and confirm they can open it on their phones
- [ ] Share the Railway URL with players and spectators
