// KEITH Pronos — routine quotidienne (GitHub Actions, Node 20, sans dépendances)
//
// 1. Lit le days.json existant et conserve tous les pronostics déjà publiés
//    (appariés par identifiant de match, sinon par date + noms d'équipes).
// 2. Récupère les matchs d'hier, d'aujourd'hui et de demain chez API-Football
//    (secret API_FOOTBALL_KEY) : logos, scores mi-temps et finaux.
// 3. Retient les 15 plus grands matchs de chaque jour.
// 4. Génère les pronostics manquants via APInex (secret APINEX_API_KEY,
//    optionnel : si absent ou en échec, les matchs restent sans pronostic
//    plutôt qu'avec un pronostic inventé).
// 5. Valide les pronostics des matchs terminés (✓ gagné / ✗ perdu).
// 6. Réécrit days.json à la racine du dépôt.

import { readFile, writeFile } from "node:fs/promises";

const MARKETS = [
  "BTTS Oui",
  "BTTS Non",
  "+1,5 but dans le match",
  "+2,5 buts dans le match",
  "+0,5 but en 1re mi-temps",
  "+1,5 but en 2e mi-temps",
];
const MAX_MATCHES_PER_DAY = 15;
const COMPETITION_WEIGHT = {
  2: 100, 1: 100, 4: 98, 39: 95, 140: 92, 135: 88, 78: 88, 61: 85, 3: 80,
  94: 78, 88: 76, 71: 76, 128: 74, 203: 74, 848: 72, 307: 72, 253: 70,
  45: 70, 143: 68, 137: 66, 262: 66, 66: 64, 98: 62,
};
// Seuil : en dessous, le match n'entre pas dans la sélection du jour
// (mieux vaut 9 grands matchs que 15 matchs quelconques).
const MIN_PRESTIGE = 62;
// Niveau des clubs (bonus) — appliqué uniquement dans les compétitions
// connues ci-dessus, pour éviter les homonymes (ex. « Arsenal » de Biélorussie).
const TIER1 = new Set([
  "bayern munich", "paris saint germain", "real madrid", "barcelona",
  "manchester city", "liverpool", "arsenal", "inter", "manchester united",
  "chelsea",
]);
const TIER2 = new Set([
  "tottenham", "atletico madrid", "borussia dortmund", "rb leipzig",
  "bayer leverkusen", "eintracht frankfurt", "napoli", "ac milan", "juventus",
  "as roma", "marseille", "monaco", "lille", "benfica", "fc porto",
  "sporting cp", "ajax", "psv eindhoven", "newcastle", "aston villa",
  "sevilla", "galatasaray", "fenerbahce", "celtic", "rangers",
]);
function tierOf(name, leagueId) {
  if (!(leagueId in COMPETITION_WEIGHT)) return 0;
  const n = (name || "").toLowerCase();
  if (TIER1.has(n)) return 12;
  if (TIER2.has(n)) return 6;
  return 0;
}

const dayKey = (d) => d.toISOString().slice(0, 10);
const offsetDay = (base, n) => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};
const normName = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(fc|ac|as|us|rc|sc|afc|club|olympique de)\s+/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+(united|city|town|county|wanderers|rovers|albion|hotspur)$/g, "")
    .trim();
const matchKey = (date, home, away) =>
  `${date}|${normName(home)}|${normName(away)}`;

/* ---------- API-Football ---------- */
async function fetchFixtures(dateStr) {
  const res = await fetch(
    `https://v3.football.api-sports.io/fixtures?date=${dateStr}&timezone=UTC`,
    { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } }
  );
  if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length)
    throw new Error(`API-Football ${JSON.stringify(data.errors)}`);
  return data.response || [];
}

const FINISHED = new Set(["FT", "AET", "PEN"]);
const LIVE = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE"]);

function normalize(m) {
  const short = m.fixture.status.short;
  const s =
    (COMPETITION_WEIGHT[m.league.id] || 40) +
    tierOf(m.teams.home.name, m.league.id) +
    tierOf(m.teams.away.name, m.league.id);
  return {
    id: m.fixture.id,
    competition: m.league.name,
    leagueId: m.league.id,
    emblem: m.league.logo || null,
    flag: null,
    utcDate: m.fixture.date,
    status: FINISHED.has(short) ? "FINISHED" : LIVE.has(short) ? "IN_PLAY" : "TIMED",
    statusShort: short,
    homeTeam: m.teams.home.name,
    awayTeam: m.teams.away.name,
    homeCrest: m.teams.home.logo || null,
    awayCrest: m.teams.away.logo || null,
    homeGoals: m.goals.home,
    awayGoals: m.goals.away,
    homeGoalsHT: m.score.halftime.home,
    awayGoalsHT: m.score.halftime.away,
    prestige: s,
    prediction: null,
    predictionAlt: null,
    result: null,
  };
}

/* ---------- Validation ---------- */
function checkPrediction(prediction, m) {
  if (m.homeGoals == null || m.awayGoals == null) return null;
  const total = m.homeGoals + m.awayGoals;
  const htKnown = m.homeGoalsHT != null && m.awayGoalsHT != null;
  const htTotal = htKnown ? m.homeGoalsHT + m.awayGoalsHT : null;
  switch (prediction) {
    case "BTTS Oui": return m.homeGoals > 0 && m.awayGoals > 0 ? "won" : "lost";
    case "BTTS Non": return m.homeGoals === 0 || m.awayGoals === 0 ? "won" : "lost";
    case "+1,5 but dans le match": return total >= 2 ? "won" : "lost";
    case "+2,5 buts dans le match": return total >= 3 ? "won" : "lost";
    case "+0,5 but en 1re mi-temps":
      if (!htKnown) return "unknown";
      return htTotal >= 1 ? "won" : "lost";
    case "+1,5 but en 2e mi-temps":
      if (!htKnown) return "unknown";
      return total - htTotal >= 2 ? "won" : "lost";
    default: return "unknown";
  }
}

/* ---------- APInex (secours automatique) ---------- */
const SYSTEM_PROMPT = `Tu es KEITH, analyste football professionnel (données + marchés de buts).
Pour chaque match reçu, choisis UN SEUL pronostic parmi cette liste fermée :
"BTTS Oui", "BTTS Non", "+1,5 but dans le match", "+2,5 buts dans le match",
"+0,5 but en 1re mi-temps", "+1,5 but en 2e mi-temps".
Règles strictes :
- Aucun autre marché.
- Variété : un même marché au maximum MAXPAR fois dans ta réponse.
- Choisis le marché le plus probable pour chaque match, et classe les 6 marchés
  du meilleur au moins bon dans "ranking" (les 6, sans doublon).
- Réponds UNIQUEMENT en JSON valide, sans texte autour :
{"picks":[{"id":123,"pick":"BTTS Oui","ranking":["BTTS Oui","+2,5 buts dans le match","..."]}]}
avec exactement un élément par match reçu, dans le même ordre.`;

async function askApinex(matches) {
  const maxPer = Math.max(1, Math.ceil(matches.length / 6));
  const res = await fetch("https://api.apinex.bond/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.APINEX_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.APINEX_MODEL || "free/glm-5.3-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT.replace("MAXPAR", String(maxPer)) },
        {
          role: "user",
          content:
            `Voici ${matches.length} matchs. Maximum ${maxPer} fois le même marché.\n` +
            JSON.stringify(matches.map((m) => ({ id: m.id, competition: m.competition, date: m.utcDate, home: m.homeTeam, away: m.awayTeam }))),
        },
      ],
      temperature: 0.3,
      max_tokens: 2500,
    }),
  });
  if (!res.ok) throw new Error(`APInex HTTP ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  return parsed.picks || [];
}

function applyPicks(matches, picks) {
  const maxPer = Math.max(1, Math.ceil(matches.length / 6));
  const byId = new Map(picks.map((p) => [Number(p.id), p]));
  const counts = new Map();
  for (const m of matches) {
    const p = byId.get(Number(m.id));
    if (!p) continue;
    const ranking = []
      .concat([p.pick], Array.isArray(p.ranking) ? p.ranking : [], [p.alt])
      .filter((x, i, a) => MARKETS.includes(x) && a.indexOf(x) === i);
    const pick = ranking.find((r) => (counts.get(r) || 0) < maxPer) || null;
    if (pick) {
      m.prediction = pick;
      m.predictionAlt = ranking.find((r) => r !== pick) || null;
      counts.set(pick, (counts.get(pick) || 0) + 1);
    }
  }
}

/* ---------- Routine ---------- */
async function main() {
  const now = new Date();
  const offsets = [
    { n: -1, label: "Hier" },
    { n: 0, label: "Aujourd'hui" },
    { n: 1, label: "Demain" },
  ];
  const dates = offsets.map((o) => ({ ...o, date: dayKey(offsetDay(now, o.n)) }));

  let previous = { days: [] };
  try {
    previous = JSON.parse(await readFile("days.json", "utf8"));
  } catch (_) { /* premier lancement */ }
  const prevById = new Map();
  const prevByKey = new Map();
  for (const d of previous.days || []) {
    for (const m of d.matches || []) {
      if (!m.prediction) continue;
      prevById.set(Number(m.id), m);
      prevByKey.set(matchKey(d.date, m.homeTeam, m.awayTeam), m);
    }
  }
  const prevDayByDate = new Map((previous.days || []).map((d) => [d.date, d]));

  const outDays = [];
  for (const d of dates) {
    let matches = null;
    try {
      const raw = await fetchFixtures(d.date);
      matches = raw
        .filter((m) => (m.fixture.date || "").slice(0, 10) === d.date)
        .map(normalize)
        .filter((m) => m.prestige >= MIN_PRESTIGE)
        .sort((a, b) => b.prestige - a.prestige || a.utcDate.localeCompare(b.utcDate))
        .slice(0, MAX_MATCHES_PER_DAY)
        .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
    } catch (e) {
      console.log(`API-Football indisponible pour ${d.date} : ${e.message} — journée précédente conservée`);
      if (prevDayByDate.has(d.date)) outDays.push(prevDayByDate.get(d.date));
      continue;
    }
    // Conserver les pronostics déjà publiés
    for (const m of matches) {
      const old =
        prevById.get(Number(m.id)) ||
        prevByKey.get(matchKey(d.date, m.homeTeam, m.awayTeam));
      if (old) {
        m.prediction = old.prediction;
        m.predictionAlt = old.predictionAlt || null;
      }
    }
    // Générer les manquants
    const missing = matches.filter((m) => !m.prediction);
    if (missing.length && process.env.APINEX_API_KEY) {
      try {
        applyPicks(matches, await askApinex(missing));
        console.log(`${d.date} : ${missing.length} pronostics demandés à APInex`);
      } catch (e) {
        console.log(`${d.date} : APInex en échec (${e.message}) — pronostics laissés vides`);
      }
    }
    // Valider
    for (const m of matches) {
      if (m.status === "FINISHED" && m.prediction) m.result = checkPrediction(m.prediction, m);
    }
    console.log(`${d.date} : ${matches.length} matchs, ${matches.filter((m) => m.prediction).length} avec pronostic`);
    outDays.push({ date: d.date, label: d.label, matches });
  }

  const payload = { generatedAt: now.toISOString(), days: outDays };
  await writeFile("days.json", JSON.stringify(payload, null, 2) + "\n");
  console.log("days.json mis à jour.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
