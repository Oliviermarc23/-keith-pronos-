// KEITH Pronos — application (PWA)
// Présentation en 5 vues (Accueil, Matchs, Pronostics, Ligues, Profil).
// Données : days.json hébergé avec le site (ou Worker via config.js : KEITH_API_BASE).
// Si aucune donnée n'est joignable, mode démonstration sur dates réelles.

const state = {
  data: null,
  demo: false,
  view: "accueil",
  dayIndex: 1,
  leagueFilter: null,
  matchFilter: "tous",
  query: "",
};

/* ---------- Utilitaires ---------- */
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const initials = (name) =>
  String(name || "?")
    .replace(/^(FC|AS|US|RC|Olympique de|Club)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

function crestHtml(url, name) {
  if (url) {
    return `<img class="crest" src="${esc(url)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;crest-fallback&quot;>${initials(name)}</div>'">`;
  }
  return `<div class="crest-fallback">${initials(name)}</div>`;
}

const fmtDate = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long",
  });
const fmtDayShort = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
    day: "numeric", month: "short",
  });
const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

const LIVE_SHORT = ["1H", "2H", "HT", "ET", "BT", "P", "LIVE"];
const FIN_SHORT = ["FT", "AET", "PEN"];
const isLive = (m) =>
  m.status === "IN_PLAY" || m.status === "PAUSED" || LIVE_SHORT.includes(m.statusShort);
const isFinished = (m) => m.status === "FINISHED" || FIN_SHORT.includes(m.statusShort);

function dayMatches(i) {
  const days = (state.data && state.data.days) || [];
  return (days[i] && days[i].matches) || [];
}
function todayIndex() {
  const days = (state.data && state.data.days) || [];
  const i = days.findIndex((d) => d.label === "Aujourd'hui");
  return i >= 0 ? i : Math.min(1, Math.max(0, days.length - 1));
}

/* ---------- Bilan réel (calculé sur les pronostics affichés) ---------- */
function bilan() {
  let won = 0, lost = 0, unknown = 0, total = 0;
  for (const d of (state.data && state.data.days) || []) {
    for (const m of d.matches || []) {
      if (!m.prediction) continue;
      total++;
      if (m.result === "won") won++;
      else if (m.result === "lost") lost++;
      else if (m.result === "unknown") unknown++;
    }
  }
  const decided = won + lost;
  return { won, lost, unknown, total, decided, pct: decided ? Math.round((won / decided) * 100) : null };
}

/* ---------- Vue Accueil ---------- */
function renderAccueil() {
  const el = document.getElementById("view-accueil");
  const days = (state.data && state.data.days) || [];
  const ti = todayIndex();
  const today = dayMatches(ti);
  const pronosToday = today.filter((m) => m.prediction).length;
  const b = bilan();

  // Match à ne pas manquer : plus grand prestige, sinon le plus tardif
  const focus = [...today].sort(
    (a, z) => (z.prestige || 0) - (a.prestige || 0) || String(z.utcDate).localeCompare(String(a.utcDate))
  )[0];

  // Championnats du jour
  const leagues = new Map();
  for (const m of today) {
    const L = leagues.get(m.competition) || { name: m.competition, flag: m.flag, emblem: m.emblem, n: 0 };
    L.n++;
    leagues.set(m.competition, L);
  }

  const preview = today.filter((m) => m.prediction).slice(0, 3);

  el.innerHTML = `
    <div class="hero">
      <div class="kicker">Analyses du jour</div>
      <h2>Les plus grands matchs,<br>chiffres en main</h2>
      <p>Chaque jour, une sélection des plus grands matchs, un pronostic par match — puis le verdict automatique au coup de sifflet final.</p>
      <div class="hero-stats">
        <div class="hero-stat"><b>${pronosToday}</b><span>pronostics aujourd'hui</span></div>
        <div class="hero-stat"><b>1</b><span>pronostic par match</span></div>
        <div class="hero-stat"><b>${b.pct != null ? b.pct + " %" : "✓/✗"}</b><span>${b.pct != null ? "de réussite (bilan affiché)" : "validation automatique"}</span></div>
      </div>
      <button class="hero-cta" id="ctaPronos">Voir les pronostics du jour</button>
    </div>

    ${focus ? `
    <div class="section-title">Match à ne pas manquer</div>
    <div class="focus-card">
      <span class="focus-tag">⭐ L'affiche du jour</span>
      <div class="focus-teams">
        <div class="focus-team">${crestHtml(focus.homeCrest, focus.homeTeam)}<div class="team-name">${esc(focus.homeTeam)}</div></div>
        <div class="focus-vs">
          <div class="vs-time">${isFinished(focus) ? `${focus.homeGoals} - ${focus.awayGoals}` : isLive(focus) ? `${focus.homeGoals ?? 0} - ${focus.awayGoals ?? 0}` : fmtTime(focus.utcDate)}</div>
          <div class="vs-date">${esc(focus.competition)} · ${fmtDayShort(days[ti].date)}</div>
        </div>
        <div class="focus-team">${crestHtml(focus.awayCrest, focus.awayTeam)}<div class="team-name">${esc(focus.awayTeam)}</div></div>
      </div>
      ${focus.prediction ? `<div class="pick-banner ${focus.result === "won" ? "won" : focus.result === "lost" ? "lost" : ""}">${esc(focus.prediction)}${focus.result === "won" ? " ✓" : focus.result === "lost" ? " ✗" : ""}</div>` : ""}
    </div>` : ""}

    ${leagues.size ? `
    <div class="section-title">Championnats du jour <button class="link" id="ctaLigues">Tout voir</button></div>
    <div class="leagues-scroll">
      ${[...leagues.values()].map((L) => `
        <div class="league-card" data-league="${esc(L.name)}">
          ${L.emblem ? `<img src="${esc(L.emblem)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;lflag&quot;>${L.flag || "🏆"}</div>'">` : `<div class="lflag">${L.flag || "🏆"}</div>`}
          <b>${esc(L.name)}</b><span>${L.n} match${L.n > 1 ? "s" : ""}</span>
        </div>`).join("")}
    </div>` : ""}

    ${preview.length ? `
    <div class="section-title">Pronostics du jour <button class="link" id="ctaTous">Tous</button></div>
    ${preview.map(matchCard).join("")}` : ""}

    <div class="section-title">Bilan réel</div>
    ${bilanHtml(b)}
    <p class="updated">${state.demo ? "Mode démonstration — " : ""}${state.data && state.data.generatedAt ? "Mis à jour le " + new Date(state.data.generatedAt).toLocaleString("fr-FR") : ""}</p>`;

  const go = (v) => () => switchView(v);
  const cta = document.getElementById("ctaPronos");
  if (cta) cta.addEventListener("click", () => { state.dayIndex = todayIndex(); renderPronostics(); switchView("pronostics"); });
  const ct = document.getElementById("ctaTous");
  if (ct) ct.addEventListener("click", () => { state.dayIndex = todayIndex(); renderPronostics(); switchView("pronostics"); });
  const cl = document.getElementById("ctaLigues");
  if (cl) cl.addEventListener("click", go("ligues"));
  el.querySelectorAll(".league-card").forEach((c) =>
    c.addEventListener("click", () => openLeague(c.dataset.league))
  );
}

/* ---------- Cartes et lignes de match ---------- */
function verdictHtml(m) {
  if (isFinished(m) && m.homeGoals != null) {
    const score = `<div class="score">${m.homeGoals} <span class="score-sep">-</span> ${m.awayGoals}</div>`;
    let badge = "";
    if (m.result === "won") badge = `<div class="verdict won">✓</div>`;
    else if (m.result === "lost") badge = `<div class="verdict lost">✗</div>`;
    else if (m.result === "unknown") badge = `<div class="verdict unknown">?</div>`;
    const ht = m.homeGoalsHT != null ? `<div class="ht">MT : ${m.homeGoalsHT}-${m.awayGoalsHT}</div>` : "";
    return score + badge + ht;
  }
  if (isLive(m)) {
    return `<div class="score">${m.homeGoals ?? 0} <span class="score-sep">-</span> ${m.awayGoals ?? 0}</div><div class="live-dot">● EN DIRECT</div>`;
  }
  return `<div class="vs">${fmtTime(m.utcDate)}</div>`;
}

function matchCard(m) {
  const flag = m.flag ? `<span class="flag">${m.flag}</span>` : "";
  const emblem = m.emblem ? `<img src="${esc(m.emblem)}" alt="" loading="lazy" onerror="this.remove()">` : "";
  const pickClass = m.result === "won" ? "won" : m.result === "lost" ? "lost" : "pending";
  const pick = m.prediction ? `<div class="pick-banner ${pickClass}">${esc(m.prediction)}</div>` : "";
  return `<article class="card">
    <div class="card-head">
      <div class="league">${emblem}${flag}<span>${esc(m.competition)}</span></div>
      <div class="kickoff">${new Date(m.utcDate).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</div>
    </div>
    <div class="teams">
      <div class="team">${crestHtml(m.homeCrest, m.homeTeam)}<div class="team-name">${esc(m.homeTeam)}</div></div>
      <div class="center-col">${verdictHtml(m)}</div>
      <div class="team">${crestHtml(m.awayCrest, m.awayTeam)}<div class="team-name">${esc(m.awayTeam)}</div></div>
    </div>
    ${pick}
  </article>`;
}

function matchRow(m) {
  const fin = isFinished(m), live = isLive(m);
  const time = fin
    ? `<div class="mtime">${m.homeGoals ?? 0} – ${m.awayGoals ?? 0}<small>Terminé</small></div>`
    : live
      ? `<div class="mtime" style="color:var(--lost)">●<small>Direct</small></div>`
      : `<div class="mtime">${fmtTime(m.utcDate)}</div>`;
  const score = fin
    ? `<div class="mscore"><span>${m.homeGoals ?? ""}</span><span>${m.awayGoals ?? ""}</span>${m.homeGoalsHT != null ? `<small>MT ${m.homeGoalsHT}-${m.awayGoalsHT}</small>` : ""}</div>`
    : live
      ? `<div class="mscore"><span>${m.homeGoals ?? 0}</span><span>${m.awayGoals ?? 0}</span></div>`
      : `<div class="mscore"></div>`;
  const verdict = m.prediction && fin
    ? `<div class="mini-verdict ${m.result || "unknown"}">${m.result === "won" ? "✓" : m.result === "lost" ? "✗" : "?"}</div>`
    : `<div class="mini-verdict"></div>`;
  return `<div class="mrow">
    ${time}
    <div class="mteams">
      <div class="mteam">${crestHtml(m.homeCrest, m.homeTeam)}<span>${esc(m.homeTeam)}</span></div>
      <div class="mteam">${crestHtml(m.awayCrest, m.awayTeam)}<span>${esc(m.awayTeam)}</span></div>
    </div>
    ${score}${verdict}
  </div>`;
}

/* ---------- Chips de jours (partagés Matchs / Pronostics) ---------- */
function dayChipsHtml() {
  const days = (state.data && state.data.days) || [];
  return `<div class="chips">${days.map((d, i) => `
    <button class="chip ${i === state.dayIndex ? "active" : ""}" data-day="${i}">${esc(d.label)}<small>${fmtDayShort(d.date)}</small></button>`).join("")}
  </div>`;
}
function bindDayChips(root, rerender) {
  root.querySelectorAll("[data-day]").forEach((b) =>
    b.addEventListener("click", () => { state.dayIndex = Number(b.dataset.day); rerender(); })
  );
}

/* ---------- Vue Matchs ---------- */
function filteredMatches() {
  let list = dayMatches(state.dayIndex);
  if (state.leagueFilter) list = list.filter((m) => m.competition === state.leagueFilter);
  if (state.matchFilter === "direct") list = list.filter(isLive);
  else if (state.matchFilter === "termines") list = list.filter(isFinished);
  else if (state.matchFilter === "avenir") list = list.filter((m) => !isLive(m) && !isFinished(m));
  if (state.query) {
    const q = state.query.toLowerCase();
    list = list.filter((m) =>
      (m.homeTeam + " " + m.awayTeam + " " + m.competition).toLowerCase().includes(q));
  }
  return list;
}

function renderMatchsList() {
  const box = document.getElementById("matchsList");
  if (!box) return;
  const list = filteredMatches();
  if (!list.length) {
    box.innerHTML = `<div class="empty">Aucun match à afficher pour cette sélection.</div>`;
    return;
  }
  const groups = new Map();
  for (const m of list) {
    if (!groups.has(m.competition)) groups.set(m.competition, { flag: m.flag, emblem: m.emblem, rows: [] });
    groups.get(m.competition).rows.push(m);
  }
  box.innerHTML = [...groups.entries()].map(([name, g]) => `
    <div class="match-group-head">
      ${g.emblem ? `<img src="${esc(g.emblem)}" alt="" loading="lazy" onerror="this.remove()">` : `<span>${g.flag || "🏆"}</span>`}
      <span>${esc(name)}</span><span class="count">${g.rows.length} match${g.rows.length > 1 ? "s" : ""}</span>
    </div>
    <div class="match-rows">${g.rows.map(matchRow).join("")}</div>`).join("");
}

function renderMatchs() {
  const el = document.getElementById("view-matchs");
  const filters = [["tous", "Tous"], ["direct", "En direct"], ["termines", "Terminés"], ["avenir", "À venir"]];
  el.innerHTML = `
    ${dayChipsHtml()}
    <input class="search" id="matchSearch" type="search" placeholder="Rechercher un match, une équipe…" value="${esc(state.query)}">
    <div class="chips">${filters.map(([k, l]) => `<button class="chip ${state.matchFilter === k ? "active" : ""}" data-filter="${k}">${l}</button>`).join("")}</div>
    ${state.leagueFilter ? `<div class="chips"><button class="chip active" id="clearLeague">Ligue : ${esc(state.leagueFilter)} ✕</button></div>` : ""}
    <div id="matchsList"></div>`;
  bindDayChips(el, renderMatchs);
  el.querySelectorAll("[data-filter]").forEach((b) =>
    b.addEventListener("click", () => { state.matchFilter = b.dataset.filter; renderMatchs(); })
  );
  const cl = document.getElementById("clearLeague");
  if (cl) cl.addEventListener("click", () => { state.leagueFilter = null; renderMatchs(); });
  const search = document.getElementById("matchSearch");
  search.addEventListener("input", () => { state.query = search.value; renderMatchsList(); });
  renderMatchsList();
}

/* ---------- Vue Pronostics ---------- */
function renderPronostics() {
  const el = document.getElementById("view-pronostics");
  const matches = dayMatches(state.dayIndex).filter((m) => m.prediction);
  const won = matches.filter((m) => m.result === "won").length;
  const lost = matches.filter((m) => m.result === "lost").length;
  const pending = matches.length - won - lost -
    matches.filter((m) => m.result === "unknown").length;
  el.innerHTML = `
    ${dayChipsHtml()}
    ${matches.length ? `
    <div class="day-summary">
      <div><b>${matches.length}</b>pronostics</div>
      <div class="w"><b>${won}</b>gagnés ✓</div>
      <div class="l"><b>${lost}</b>perdus ✗</div>
      <div><b>${pending}</b>en attente</div>
    </div>
    ${matches.map(matchCard).join("")}` : `
    <div class="empty">Aucun pronostic publié pour ce jour pour le moment.<br>Les pronostics arrivent chaque matin.</div>`}`;
  bindDayChips(el, renderPronostics);
}

/* ---------- Vue Ligues ---------- */
function leaguesAgg() {
  const map = new Map();
  for (const d of (state.data && state.data.days) || []) {
    for (const m of d.matches || []) {
      const L = map.get(m.competition) || { name: m.competition, flag: m.flag, emblem: m.emblem, n: 0, pronos: 0, won: 0, lost: 0 };
      L.n++;
      if (m.prediction) {
        L.pronos++;
        if (m.result === "won") L.won++;
        else if (m.result === "lost") L.lost++;
      }
      map.set(m.competition, L);
    }
  }
  return [...map.values()].sort((a, z) => z.n - a.n);
}
function leagueCardHtml(L) {
  const rec = L.won + L.lost
    ? `<div class="lrecord"><span class="w">${L.won} ✓</span> · <span class="l">${L.lost} ✗</span></div>` : "";
  return `<div class="league-card" data-league="${esc(L.name)}">
    ${L.emblem ? `<img src="${esc(L.emblem)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;lflag&quot;>${L.flag || "🏆"}</div>'">` : `<div class="lflag">${L.flag || "🏆"}</div>`}
    <b>${esc(L.name)}</b><span>${L.n} match${L.n > 1 ? "s" : ""} · ${L.pronos} prono${L.pronos > 1 ? "s" : ""}</span>${rec}
  </div>`;
}
function openLeague(name) {
  state.leagueFilter = name;
  // Jour où cette ligue a le plus de matchs
  const days = (state.data && state.data.days) || [];
  let best = state.dayIndex, bestN = -1;
  days.forEach((d, i) => {
    const n = (d.matches || []).filter((m) => m.competition === name).length;
    if (n > bestN) { bestN = n; best = i; }
  });
  state.dayIndex = best;
  state.matchFilter = "tous";
  renderMatchs();
  switchView("matchs");
}
function renderLigues() {
  const el = document.getElementById("view-ligues");
  const leagues = leaguesAgg();
  el.innerHTML = `
    <div class="section-title">Championnats</div>
    ${leagues.length ? `<div class="leagues-grid">${leagues.map(leagueCardHtml).join("")}</div>
    <p class="bilan-note">Touche un championnat pour voir ses matchs. Les ✓/✗ sont le bilan réel des pronostics KEITH sur les journées affichées.</p>`
    : `<div class="empty">Aucun championnat pour le moment.</div>`}`;
  el.querySelectorAll(".league-card").forEach((c) =>
    c.addEventListener("click", () => openLeague(c.dataset.league))
  );
}

/* ---------- Bilan + Vue Profil ---------- */
function bilanHtml(b) {
  if (!b.decided) {
    return `<div class="bilan-band"><p class="bilan-note" style="margin:0">Le bilan s'affichera ici dès les premiers matchs terminés : chaque pronostic est validé automatiquement, sans retouche.</p></div>`;
  }
  return `<div class="bilan-band">
    <div class="bilan-nums">
      <div><b>${b.pct} %</b><span>de réussite</span></div>
      <div><b style="color:var(--won)">${b.won}</b><span>gagnés ✓</span></div>
      <div><b style="color:var(--lost)">${b.lost}</b><span>perdus ✗</span></div>
      <div><b>${b.total}</b><span>pronostics</span></div>
    </div>
    <p class="bilan-note">Calculé automatiquement sur les pronostics terminés des journées affichées — aucun chiffre retouché, aucun pronostic effacé.</p>
  </div>`;
}

function renderProfil() {
  const el = document.getElementById("view-profil");
  const b = bilan();
  el.innerHTML = `
    <div class="section-title">KEITH Pronos</div>
    <div class="profil-card">
      <h3>La méthode</h3>
      <p>Chaque jour, les plus grands matchs sont analysés un par un (forme des équipes, statistiques, contexte), avec un seul pronostic par match choisi parmi des marchés simples : les deux équipes marquent, le nombre de buts, les buts par mi-temps.</p>
      <p style="margin-top:8px">Après les matchs, chaque pronostic est validé automatiquement à partir des scores officiels — mi-temps comprise. Le bilan ci-dessous est le bilan réel, sans retouche.</p>
    </div>
    <div class="profil-card">
      <h3>Bilan général</h3>
      ${bilanHtml(b)}
    </div>
    <div class="profil-card">
      <h3>L'application sur ton téléphone</h3>
      <p>Installe KEITH Pronos sur ton écran d'accueil pour l'ouvrir comme une vraie application.</p>
      <button id="installBtn" class="install-btn" hidden>📲 Installer l'application</button>
      <p class="updated">${state.demo ? "Mode démonstration — " : ""}${state.data && state.data.generatedAt ? "Données mises à jour le " + new Date(state.data.generatedAt).toLocaleString("fr-FR") : ""}</p>
    </div>`;
  const btn = document.getElementById("installBtn");
  if (btn) {
    if (deferredPrompt) btn.hidden = false;
    btn.addEventListener("click", installApp);
  }
}

/* ---------- Navigation ---------- */
const VIEWS = ["accueil", "matchs", "pronostics", "ligues", "profil"];
function switchView(v) {
  state.view = v;
  for (const name of VIEWS) {
    document.getElementById("view-" + name).hidden = name !== v;
  }
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === v)
  );
  window.scrollTo(0, 0);
}
document.querySelectorAll(".nav-btn").forEach((b) =>
  b.addEventListener("click", () => switchView(b.dataset.view))
);

function renderAll() {
  renderAccueil();
  renderMatchs();
  renderPronostics();
  renderLigues();
  renderProfil();
  switchView(state.view);
}

/* ---------- Données de démonstration (dates relatives à aujourd'hui) ---------- */
function demoData() {
  const d = (n) => {
    const x = new Date();
    x.setDate(x.getDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const at = (date, h) => `${date}T${h}:00.000Z`;
  const M = (o) => Object.assign({ emblem: null, homeCrest: null, awayCrest: null, homeGoals: null, awayGoals: null, homeGoalsHT: null, awayGoalsHT: null, prestige: 0, prediction: null, result: null, status: "TIMED", statusShort: "NS" }, o);
  return {
    generatedAt: new Date().toISOString(),
    days: [
      {
        date: d(-1), label: "Hier",
        matches: [
          M({ id: 1, competition: "Ligue des Nations", flag: "🏴󐁧󐁢󐁥󐁮󐁧󐁿", utcDate: at(d(-1), "18:45"), homeTeam: "Angleterre", awayTeam: "Tchéquie", status: "FINISHED", statusShort: "FT", homeGoals: 3, awayGoals: 0, homeGoalsHT: 1, awayGoalsHT: 0, prediction: "+1,5 but dans le match", result: "won" }),
          M({ id: 2, competition: "Ligue des Nations", flag: "🇭🇷", utcDate: at(d(-1), "18:45"), homeTeam: "Croatie", awayTeam: "Espagne", status: "FINISHED", statusShort: "FT", homeGoals: 1, awayGoals: 2, homeGoalsHT: 0, awayGoalsHT: 1, prediction: "BTTS Oui", result: "won" }),
        ],
      },
      {
        date: d(0), label: "Aujourd'hui",
        matches: [
          M({ id: 3, competition: "La Liga", flag: "🇪🇸", utcDate: at(d(0), "19:00"), homeTeam: "Málaga", awayTeam: "Espanyol", prediction: "+0,5 but en 1re mi-temps" }),
          M({ id: 4, competition: "Ligue 1", flag: "🇫🇷", utcDate: at(d(0), "18:45"), homeTeam: "Lens", awayTeam: "Lyon", prediction: "+2,5 buts dans le match" }),
          M({ id: 5, competition: "Bundesliga", flag: "🇩🇪", utcDate: at(d(0), "18:30"), homeTeam: "Dortmund", awayTeam: "Werder Brême", prediction: "BTTS Oui" }),
        ],
      },
      {
        date: d(1), label: "Demain",
        matches: [
          M({ id: 6, competition: "Premier League", flag: "🏴󐁧󐁢󐁥󐁮󐁧󐁿", utcDate: at(d(1), "11:30"), homeTeam: "Arsenal", awayTeam: "Leeds United", prestige: 95, prediction: "+1,5 but dans le match" }),
          M({ id: 7, competition: "Premier League", flag: "🏴󐁧󐁢󐁥󐁮󐁧󐁿", utcDate: at(d(1), "16:30"), homeTeam: "Manchester United", awayTeam: "Tottenham", prestige: 95, prediction: "+1,5 but dans le match" }),
          M({ id: 8, competition: "La Liga", flag: "🇪🇸", utcDate: at(d(1), "19:00"), homeTeam: "Real Madrid", awayTeam: "Villarreal", prestige: 92, prediction: "+2,5 buts dans le match" }),
          M({ id: 9, competition: "Serie A", flag: "🇮🇹", utcDate: at(d(1), "16:00"), homeTeam: "Inter", awayTeam: "Parme", prestige: 88, prediction: "+0,5 but en 1re mi-temps" }),
          M({ id: 10, competition: "Ligue 1", flag: "🇫🇷", utcDate: at(d(1), "18:45"), homeTeam: "PSG", awayTeam: "Le Mans", prestige: 85, prediction: "BTTS Oui" }),
        ],
      },
    ],
  };
}

async function load() {
  const base = (window.KEITH_API_BASE || "").replace(/\/$/, "");
  const url = base ? base + "/api/days" : "days.json";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.days) && data.days.length) {
        state.data = data;
        state.dayIndex = todayIndex();
        renderAll();
        return;
      }
    }
  } catch (e) {
    /* on bascule sur la démo */
  }
  state.demo = true;
  state.data = demoData();
  state.dayIndex = todayIndex();
  renderAll();
}

/* ---------- Installation (PWA) ---------- */
let deferredPrompt = null;
async function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  const btn = document.getElementById("installBtn");
  if (btn) btn.hidden = true;
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById("installBtn");
  if (btn) btn.hidden = false;
});
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
if (isIos && !isStandalone) {
  const hint = document.getElementById("iosInstallHint");
  if (hint) {
    hint.hidden = false;
    document.getElementById("iosHintClose").addEventListener("click", () => (hint.hidden = true));
  }
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

load();
