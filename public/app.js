// ═══════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════
function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const toggle = document.getElementById("theme-toggle");
  if (toggle)
    toggle.setAttribute("aria-checked", theme === "light" ? "true" : "false");
}

function toggleTheme() {
  const isLight =
    document.documentElement.getAttribute("data-theme") === "light";
  const next = isLight ? "dark" : "light";
  localStorage.setItem("theme", next);
  applyTheme(next);
}

(function initTheme() {
  const stored = localStorage.getItem("theme");
  applyTheme(
    stored ||
      (window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"),
  );
  window
    .matchMedia("(prefers-color-scheme: light)")
    .addEventListener("change", function (e) {
      if (!localStorage.getItem("theme"))
        applyTheme(e.matches ? "light" : "dark");
    });
})();

// ═══════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════
const REFRESH_MS = 15000;

const FC = {
  ID: 0,
  TYPE: 1,
  POOL: 2,
  HOME: 3,
  AWAY: 4,
  TIME: 5,
  PITCH: 6,
  REF1: 7,
  REF2: 8,
};
const SC = { TS: 0, ID: 1, HOME: 2, AWAY: 3 };

const KO_TYPES = new Set(["csf", "psf", "cup", "plate", "bowl"]);

const KO_LABELS = {
  psf: "Plate SF",
  csf: "Cup SF",
  bowl: "Bowl Final",
  plate: "Plate Final",
  cup: "Cup Final",
};

const COMP_OF = {
  csf: "cup",
  psf: "plate",
  cup: "cup",
  plate: "plate",
  bowl: "bowl",
};

const BREAKS = {
  "13:30": "Mid Pool Stage Break + Pitch Change  ·  13:45",
  "14:55": "Pool Stage Complete — Knockout Phase  ·  15:10 Break",
  "16:00": "Mid Knockout Stage Break  ·  16:20",
};

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
let FIXTURES = [];
let SCORE_MAP = {};
let standingsCache = {};
let activePage = "schedule";

// ═══════════════════════════════════════════════════
// NAV
// ═══════════════════════════════════════════════════
function showPage(name, el) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".nav-btn")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById("page-" + name).classList.add("active");
  if (el) el.classList.add("active");
  activePage = name;
  if (name === "schedule") renderSchedule();
  if (name === "tables") renderTables();
  if (name === "sponsors" && !sponsorsLoaded) renderSponsors();
}

// ═══════════════════════════════════════════════════
// FETCH & PARSE
// ═══════════════════════════════════════════════════
async function fetchData() {
  const res = await fetch("/api/data");
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`,
    );
  return res.json();
}

function parseFixtures(rows) {
  return rows
    .slice(1)
    .filter((r) => r[FC.HOME] && r[FC.AWAY])
    .map((r) => ({
      id: (r[FC.ID] || "").trim().toUpperCase(),
      type: (r[FC.TYPE] || "").trim().toLowerCase(),
      pool: parseInt(r[FC.POOL]) || 0,
      home: (r[FC.HOME] || "").trim(),
      away: (r[FC.AWAY] || "").trim(),
      time: (r[FC.TIME] || "").trim(),
      pitch: (r[FC.PITCH] || "").trim(),
      ref1: (r[FC.REF1] || "").trim(),
      ref2: (r[FC.REF2] || "").trim(),
    }));
}

function parseScores(rows) {
  const map = {};
  rows.slice(1).forEach((r) => {
    const id = (r[SC.ID] || "").trim().toUpperCase();
    if (!id) return;
    const h = parseInt(r[SC.HOME]),
      a = parseInt(r[SC.AWAY]);
    if (isNaN(h) || isNaN(a)) return;
    map[id] = { home: h, away: a };
  });
  return map;
}

// ═══════════════════════════════════════════════════
// STANDINGS
// ═══════════════════════════════════════════════════
function calcStandings(poolNum) {
  if (standingsCache[poolNum]) return standingsCache[poolNum];
  const pf = FIXTURES.filter(
    (f) => f.pool === poolNum && !KO_TYPES.has(f.type),
  );
  const teams = [...new Set(pf.flatMap((f) => [f.home, f.away]))];
  const st = {};
  teams.forEach((t) => {
    st[t] = { team: t, p: 0, w: 0, d: 0, l: 0, pf: 0, pa: 0, pts: 0, h2h: {} };
  });

  pf.forEach((f) => {
    const s = SCORE_MAP[f.id];
    if (!s) return;
    const [h, a] = [s.home, s.away];
    const ht = st[f.home],
      at = st[f.away];
    if (!ht || !at) return;
    ht.p++;
    at.p++;
    ht.pf += h;
    ht.pa += a;
    at.pf += a;
    at.pa += h;
    if (h > a) {
      ht.w++;
      ht.pts += 3;
      at.l++;
    } else if (h < a) {
      at.w++;
      at.pts += 3;
      ht.l++;
    } else {
      ht.d++;
      ht.pts += 1;
      at.d++;
      at.pts += 1;
    }
    ht.h2h[f.away] = (ht.h2h[f.away] || 0) + (h - a);
    at.h2h[f.home] = (at.h2h[f.home] || 0) + (a - h);
  });

  const arr = Object.values(st);

  // Phase 1: sort by points to identify tied groups
  arr.sort((a, b) => b.pts - a.pts);

  // Phase 2: compute H2H differential within each tied group
  // This avoids non-transitive pairwise H2H in circular ties (e.g. A>B, B>C, C>A)
  let i = 0;
  while (i < arr.length) {
    let j = i;
    while (j < arr.length && arr[j].pts === arr[i].pts) j++;
    const group = arr.slice(i, j);
    if (group.length > 1) {
      const names = new Set(group.map((t) => t.team));
      group.forEach((t) => {
        t.h2hGroup = Object.entries(t.h2h)
          .filter(([opp]) => names.has(opp))
          .reduce((sum, [, diff]) => sum + diff, 0);
      });
    } else {
      group[0].h2hGroup = 0;
    }
    i = j;
  }

  // Phase 3: final sort — pts → h2h within group → points scored → points diff
  standingsCache[poolNum] = arr.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.h2hGroup !== a.h2hGroup) return b.h2hGroup - a.h2hGroup;
    if (b.pf !== a.pf) return b.pf - a.pf;
    return b.pf - b.pa - (a.pf - a.pa);
  });
  return standingsCache[poolNum];
}

function poolComplete(p) {
  return FIXTURES.filter((f) => f.pool === p && !KO_TYPES.has(f.type)).every(
    (f) => SCORE_MAP[f.id],
  );
}

const POOL_POS_RE = /^(\d+)(?:st|nd|rd|th) Pool (\d+)$/i;
const WINNER_OF_RE = /^Winner (.+)$/i;

function resolveTeam(raw) {
  if (!raw) return null;
  const pp = raw.match(POOL_POS_RE);
  if (pp) {
    if (!poolComplete(parseInt(pp[2]))) return null;
    return calcStandings(parseInt(pp[2]))[parseInt(pp[1]) - 1]?.team || null;
  }
  const wo = raw.match(WINNER_OF_RE);
  if (wo) return getKOWinner(wo[1].trim().toUpperCase());
  return raw;
}

function getKOWinner(matchId) {
  const s = SCORE_MAP[matchId];
  if (!s) return null;
  const f = FIXTURES.find((x) => x.id === matchId);
  if (!f) return null;
  if (s.home > s.away) return resolveTeam(f.home);
  if (s.away > s.home) return resolveTeam(f.away);
  return null;
}

function displayName(raw) {
  return resolveTeam(raw) || raw;
}
function isResolved(raw) {
  return resolveTeam(raw) !== null;
}

// ═══════════════════════════════════════════════════
// SCHEDULE
// ═══════════════════════════════════════════════════
function renderSchedule() {
  const q = (document.getElementById("team-search").value || "")
    .trim()
    .toLowerCase();
  const con = document.getElementById("schedule-container");
  const times = [...new Set(FIXTURES.map((f) => f.time))].sort();
  let html = "",
    any = false;

  times.forEach((t) => {
    const filtered = FIXTURES.filter((f) => {
      if (f.time !== t) return false;
      if (!q) return true;
      return (
        displayName(f.home).toLowerCase().includes(q) ||
        displayName(f.away).toLowerCase().includes(q) ||
        f.id.toLowerCase().includes(q)
      );
    });
    if (!filtered.length) return;

    html += `<div class="time-group"><span class="time-label">${t}</span></div>`;
    html += `<div class="match-list">`;
    filtered.forEach((f) => {
      const isPool = !KO_TYPES.has(f.type);
      html += isPool ? buildPoolCard(f, q) : buildKOCard(f, q);
      any = true;
    });
    html += `</div>`;

    if (BREAKS[t] && !q) {
      html += `<div class="break-block"><div class="break-text">${esc(BREAKS[t])}</div></div>`;
    }
  });

  if (!any) {
    html = `<div class="empty-msg">No matches found${q ? ` for "${esc(q)}"` : ""}</div>`;
  }
  con.innerHTML = html;
}

function buildPoolCard(f, q) {
  const s = SCORE_MAP[f.id];
  const hi =
    q && (f.home.toLowerCase().includes(q) || f.away.toLowerCase().includes(q));
  let scoreHtml,
    hwon = false,
    awon = false;
  if (s) {
    hwon = s.home > s.away;
    awon = s.away > s.home;
    scoreHtml = `<div class="score">${s.home}&nbsp;–&nbsp;${s.away}</div>`;
  } else {
    scoreHtml = `<div class="score vs">VS</div>`;
  }
  return `
  <div class="match${hi ? " highlight" : ""}">
    <div class="match-top">
      <span class="match-id">${esc(f.id)}</span>
      <span class="match-label">Pool ${f.pool}</span>
      <span class="match-badge badge-pool">P${f.pool}</span>
    </div>
    <div class="match-body">
      <div class="team home${hwon ? " won" : ""}">${esc(f.home)}</div>
      <div class="score-block">${scoreHtml}</div>
      <div class="team away${awon ? " won" : ""}">${esc(f.away)}</div>
    </div>
    <div class="match-foot">
      <span class="match-foot-item">${esc(f.time)}${f.pitch ? " · Pitch " + esc(f.pitch) : ""}</span>
      ${f.ref1 || f.ref2 ? `<span class="match-foot-item">${esc([f.ref1, f.ref2].filter(Boolean).join(" / "))}</span>` : ""}
    </div>
  </div>`;
}

function buildKOCard(f, q) {
  const hName = displayName(f.home),
    aName = displayName(f.away);
  const hRes = isResolved(f.home),
    aRes = isResolved(f.away);
  const s = SCORE_MAP[f.id];
  const hi =
    q && (hName.toLowerCase().includes(q) || aName.toLowerCase().includes(q));
  const comp = COMP_OF[f.type] || "cup";
  let scoreHtml,
    hwon = false,
    awon = false;
  if (s && hRes && aRes) {
    hwon = s.home > s.away;
    awon = s.away > s.home;
    scoreHtml = `<div class="score">${s.home}&nbsp;–&nbsp;${s.away}</div>`;
  } else {
    scoreHtml = `<div class="score vs">VS</div>`;
  }
  const label = KO_LABELS[f.type] || f.type.toUpperCase();
  return `
  <div class="match${hi ? " highlight" : ""}">
    <div class="match-top">
      <span class="match-id">${esc(f.id)}</span>
      <span class="match-label">${esc(label)}</span>
      <span class="match-badge badge-${comp}">${comp.toUpperCase()}</span>
    </div>
    <div class="match-body">
      <div class="team home${hwon ? " won" : ""}${!hRes ? " tbd" : ""}">${esc(hName)}</div>
      <div class="score-block">${scoreHtml}</div>
      <div class="team away${awon ? " won" : ""}${!aRes ? " tbd" : ""}">${esc(aName)}</div>
    </div>
    <div class="match-foot">
      <span class="match-foot-item">${esc(f.time)}${f.pitch ? " · Pitch " + esc(f.pitch) : ""}</span>
      ${f.ref1 || f.ref2 ? `<span class="match-foot-item">${esc([f.ref1, f.ref2].filter(Boolean).join(" / "))}</span>` : ""}
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════
// TABLES
// ═══════════════════════════════════════════════════
function renderTables() {
  [1, 2].forEach((p) => {
    const st = calcStandings(p);
    const done = poolComplete(p);
    document.getElementById(`pool${p}-badge`).innerHTML = done
      ? '<span class="complete-tag">Complete</span>'
      : "";

    const posCls = (i) =>
      i < 2 ? "pos-cup" : i < 4 ? "pos-plate" : "pos-bowl";
    document.getElementById(`tbody-pool${p}`).innerHTML = st
      .map((t, i) => {
        const diff = t.pf - t.pa;
        const diffStr =
          diff === 0
            ? '<span style="color:var(--muted)">0</span>'
            : diff > 0
              ? `<span class="diff-pos">+${diff}</span>`
              : `<span class="diff-neg">${diff}</span>`;
        return `<tr>
        <td class="td-pos"><span class="pos-num ${posCls(i)}">${i + 1}</span></td>
        <td style="text-align:left;font-family:'Barlow',sans-serif;font-weight:600;font-size:13px;color:var(--text)">${esc(t.team)}</td>
        <td>${t.p}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td>
        <td>${t.pf}</td><td>${t.pa}</td><td>${diffStr}</td>
        <td class="td-pts">${t.pts}</td>
      </tr>`;
      })
      .join("");
  });
  renderBracket();
}

function renderBracket() {
  const groups = [
    { label: "Cup", cls: "cup", ids: ["CSF1", "CSF2", "CUP"] },
    { label: "Plate", cls: "plate", ids: ["PSF1", "PSF2", "PLATE"] },
    { label: "Bowl", cls: "bowl", ids: ["BOWL"] },
  ];

  const html = groups
    .map((g) => {
      const matches = g.ids
        .map((id) => FIXTURES.find((f) => f.id === id))
        .filter(Boolean);
      if (!matches.length) return "";
      return `
    <div class="bracket-wrap">
      <div class="bracket-comp-head ${g.cls}">${g.label}</div>
      ${matches.map((m, i) => buildKOCard(m, "")).join("")}
    </div>`;
    })
    .join("");

  document.getElementById("finals-bracket").innerHTML = html;
}

// ═══════════════════════════════════════════════════
// SPONSORS
// ═══════════════════════════════════════════════════
const SPONSORS = [
  {
    name: "Asia Center Foundation",
    img: "/sponsors/ACF Logo.jpg",
    url: "https://asiacenterfoundation.org/",
  },
  {
    name: "Alan Cooke Ground",
    img: "/sponsors/ACG.PNG",
    url: "https://www.acg-phuket.com/",
  },
  {
    name: "Bangtao Boat Club",
    img: "/sponsors/Bangtao Boat Club logo.jpg",
    url: "https://www.instagram.com/bangtaoboatclubphk/",
  },
  {
    name: "Delta",
    img: "/sponsors/Delta logo (low res).PNG",
    url: "https://delta55fit.com/",
  },
  {
    name: "Go Fresh",
    img: "/sponsors/Go fresh logo.PNG",
    url: "https://gofreshfuel.com/",
  },
  {
    name: "The Litter Club",
    img: "/sponsors/Litter club logo.PNG",
    url: "https://thelitterclub.org/about/",
  },
  {
    name: "Nomad Beach Club",
    img: "/sponsors/Nomad Logo 2.jpg",
    url: "https://www.nomadbeachclubphuket.com/",
  },
  {
    name: "DOPA Sauna & Wellness Club",
    img: "/sponsors/Orange Logo (Transparent).png",
    url: "https://www.instagram.com/dopa.phuket/?hl=en",
  },
  {
    name: "Phuket Scaffolding Solutions",
    img: "/sponsors/Phuket Scaffolding logo.jpg",
    url: "https://www.instagram.com/phuketscaffoldingsolutions/",
  },
  {
    name: "Physio First",
    img: "/sponsors/Physio First Logo.png",
    url: "https://physiofirstphuket.com/",
  },
  {
    name: "Simba Sea Trips",
    img: "/sponsors/Simba Sea Trips Teal Logo Square_White.png",
    url: "https://simbaseatrips.com/",
  },
  {
    name: "Tour de Phuket Hotel",
    img: "/sponsors/Tour de Phuket Logo.jpg",
    url: "https://www.tourdephukethotel.com/",
  },
  {
    name: "White Claw",
    img: "/sponsors/White Claw_Logo Black.PNG",
    url: "https://www.whiteclaw.com/",
  },
];

let sponsorsLoaded = false;

function renderSponsors() {
  const grid = document.getElementById("sponsors-grid");
  if (!SPONSORS.length) {
    grid.innerHTML =
      '<p style="padding:0 20px;color:var(--muted)">Sponsors coming soon.</p>';
    sponsorsLoaded = true;
    return;
  }
  grid.innerHTML = SPONSORS.map(
    (s) => `
    <a href="${esc(s.url)}" target="_blank" rel="noopener" class="sponsor-card">
      <img src="${esc(s.img)}" loading="lazy" alt="${esc(s.name)}">
      <span class="sponsor-name">${esc(s.name)}</span>
    </a>
  `,
  ).join("");
  sponsorsLoaded = true;
}

// ═══════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════
function setStatus(state, msg) {
  document.getElementById("pulse").className =
    "pulse-dot" + (state === "live" ? " live" : "");
  document.getElementById("status-text").textContent = msg;
}

// ═══════════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════════
async function refresh() {
  try {
    const { fixtures: fRows, scores: sRows } = await fetchData();
    FIXTURES = parseFixtures(fRows);
    SCORE_MAP = parseScores(sRows);
    standingsCache = {};
    const played = Object.keys(SCORE_MAP).length;
    const total = FIXTURES.length;
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    setStatus("live", `${played}/${total} · ${time}`);
    if (activePage === "schedule") renderSchedule();
    if (activePage === "tables") renderTables();
    document.getElementById("schedule-error").innerHTML = "";
    document.getElementById("tables-error").innerHTML = "";
    document.getElementById("search-wrap").style.display = "";
  } catch (err) {
    setStatus("err", "offline");
    const e = `<div class="error-strip">⚠ ${esc(err.message)}</div>`;
    document.getElementById("schedule-error").innerHTML = e;
    document.getElementById("tables-error").innerHTML = e;
  }
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

refresh();
setInterval(refresh, REFRESH_MS);
