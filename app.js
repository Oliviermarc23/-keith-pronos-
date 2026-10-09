// KEITH Pronos — application (PWA)
// Charge les journées depuis le Worker (config.js : KEITH_API_BASE).
// Si le Worker n'est pas encore branché, affiche des données de démonstration
// construites sur les dates réelles (hier / aujourd'hui / demain).

const state = { data: null, dayIndex: 1, demo: false };

const fmtDate = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

const initials = (name) =>
  name
    .replace(/^(FC|AS|US|RC|Olympique de|Club)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

function crestHtml(url, name) {
  if (url) {
    return `<img class="crest" src="${url}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;crest-fallback&quot;>${initials(name)}</div>'">`;
  }
  return `<div class="crest-fallback">${initials(name)}</div>`;
}

function verdictHtml(m) {
  if (m.status === "FINISHED" && m.homeGoals != null) {
    const score = `<div class="score">${m.homeGoals} <span class="score-sep">-</span> ${m.awayGoals}</div>`;
    let badge = "";
    if (m.result === "won") badge = `<div class="verdict won">✓</div>`;
    else if (m.result === "lost") badge = `<div class="verdict lost">✗</div>`;
    else if (m.result === "unknown") badge = `<div class="verdict unknown">?</div>`;
    const ht =
      m.homeGoalsHT != null
        ? `<div class="ht">MT : ${m.homeGoalsHT}-${m.awayGoalsHT}</div>`
        : "";
    return score + badge + ht;
  }
  if (m.status === "IN_PLAY" || m.status === "PAUSED") {
    return `<div class="score">${m.homeGoals ?? 0} <span class="score-sep">-</span> ${m.awayGoals ?? 0}</div><div class="ht">En cours</div>`;
  }
  const time = new Date(m.utcDate).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `<div class="vs">${time}</div>`;
}

function matchCard(m) {
  const flag = m.flag ? `<span class="flag">${m.flag}</span>` : "";
  const emblem = m.emblem
    ? `<img src="${m.emblem}" alt="" loading="lazy" onerror="this.remove()">`
    : "";
  const pickClass =
    m.result === "won" ? "won" : m.result === "lost" ? "lost" : "pending";
  const pick = m.prediction
    ? `<div class="pick-banner ${pickClass}">${m.prediction}</div>`
    : "";
  return `<article class="card">
    <div class="card-head">
      <div class="league">${emblem}${flag}<span>${m.competition}</span></div>
      <div class="kickoff">${new Date(m.utcDate).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</div>
    </div>
    <div class="teams">
      <div class="team">${crestHtml(m.homeCrest, m.homeTeam)}<div class="team-name">${m.homeTeam}</div></div>
      <div class="center-col">${verdictHtml(m)}</div>
      <div class="team">${crestHtml(m.awayCrest, m.awayTeam)}<div class="team-name">${m.awayTeam}</div></div>
    </div>
    ${pick}
  </article>`;
}

function render() {
  const days = state.data.days || [];
  const tabs = document.getElementById("dayTabs");
  tabs.innerHTML = days
    .map(
      (d, i) =>
        `<button data-i="${i}" class="${i === state.dayIndex ? "active" : ""}">${d.label}</button>`
    )
    .join("");
  tabs.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      state.dayIndex = Number(b.dataset.i);
      render();
    })
  );
  const day = days[state.dayIndex] || days[0];
  document.getElementById("datePill").innerHTML = day
    ? `<span>${fmtDate(day.date)}</span>`
    : "";
  const list = document.getElementById("matchList");
  list.innerHTML =
    day && day.matches.length
      ? day.matches.map(matchCard).join("")
      : `<div class="empty">Aucun match publié pour ce jour pour le moment.<br>Les pronostics arrivent chaque matin.</div>`;
  document.getElementById("updatedAt").textContent =
    (state.demo ? "Mode démonstration — " : "") +
    (state.data.generatedAt
      ? "Mis à jour le " +
        new Date(state.data.generatedAt).toLocaleString("fr-FR")
      : "");
}

/* ---------- Données de démonstration (dates toujours relatives à aujourd'hui) ---------- */
function demoData() {
  const d = (n) => {
    const x = new Date();
    x.setDate(x.getDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const at = (date, h) => `${date}T${h}:00.000Z`;
  const M = (o) => Object.assign({ emblem: null, homeCrest: null, awayCrest: null, homeGoals: null, awayGoals: null, homeGoalsHT: null, awayGoalsHT: null, prediction: null, result: null, status: "TIMED" }, o);
  return {
    generatedAt: new Date().toISOString(),
    days: [
      {
        date: d(-1), label: "Hier",
        matches: [
          M({ id: 1, competition: "Ligue des Nations", flag: "🏴󐁧󐁢󐁥󐁮󐁧󐁿", utcDate: at(d(-1), "18:45"), homeTeam: "Angleterre", awayTeam: "Tchéquie", status: "FINISHED", homeGoals: 3, awayGoals: 0, homeGoalsHT: 1, awayGoalsHT: 0, prediction: "+1,5 but dans le match", result: "won" }),
          M({ id: 2, competition: "Ligue des Nations", flag: "🇭🇷", utcDate: at(d(-1), "18:45"), homeTeam: "Croatie", awayTeam: "Espagne", status: "FINISHED", homeGoals: 1, awayGoals: 2, homeGoalsHT: 0, awayGoalsHT: 1, prediction: "BTTS Oui", result: "won" }),
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
          M({ id: 6, competition: "Premier League", flag: "🏴󐁧󐁢󐁥󐁮󐁧󐁿", utcDate: at(d(1), "11:30"), homeTeam: "Arsenal", awayTeam: "Leeds United", prediction: "+1,5 but dans le match" }),
          M({ id: 7, competition: "Premier League", flag: "🏴󐁧󐁢󐁥󐁮󐁧󐁿", utcDate: at(d(1), "16:30"), homeTeam: "Manchester United", awayTeam: "Tottenham", prediction: "+1,5 but dans le match" }),
          M({ id: 8, competition: "La Liga", flag: "🇪🇸", utcDate: at(d(1), "19:00"), homeTeam: "Real Madrid", awayTeam: "Villarreal", prediction: "+2,5 buts dans le match" }),
          M({ id: 9, competition: "Serie A", flag: "🇮🇹", utcDate: at(d(1), "16:00"), homeTeam: "Inter", awayTeam: "Parme", prediction: "+0,5 but en 1re mi-temps" }),
          M({ id: 10, competition: "Ligue 1", flag: "🇫🇷", utcDate: at(d(1), "18:45"), homeTeam: "PSG", awayTeam: "Le Mans", prediction: "BTTS Oui" }),
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
        state.dayIndex = Math.min(1, data.days.length - 1);
        render();
        return;
      }
    }
  } catch (e) {
    /* on bascule sur la démo */
  }
  state.demo = true;
  state.data = demoData();
  state.dayIndex = 1;
  render();
}

/* ---------- Installation (PWA) ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById("installBtn").hidden = false;
});
document.getElementById("installBtn").addEventListener("click", async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    document.getElementById("installBtn").hidden = true;
  }
});
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
if (isIos && !isStandalone) {
  const hint = document.getElementById("iosInstallHint");
  hint.hidden = false;
  document.getElementById("iosHintClose").addEventListener("click", () => (hint.hidden = true));
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

load();
