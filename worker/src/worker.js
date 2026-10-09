// KEITH Pronos — Worker d'automatisation (Cloudflare Workers, offre gratuite)
//
// Rôle :
//  1. Récupère les matchs d'hier, d'aujourd'hui et de demain (API-Football,
//     offre gratuite 100 requêtes/jour : grandes compétitions, logos officiels
//     des équipes et des ligues, scores mi-temps et finaux).
//  2. Retient les 15 plus grands matchs de chaque jour (pondération par
//     compétition + bonus grandes équipes).
//  3. Demande les pronostics à APInex (API d'IA gratuite, compatible OpenAI) :
//     1 seul pronostic par match, parmi 6 marchés fermés, avec limite de
//     variété ⌈N/6⌉ par marché. La clé APInex reste côté serveur (secret).
//  4. Valide automatiquement les pronostics des matchs terminés
//     (✓ gagné / ✗ perdu) à partir des scores réels (mi-temps incluse).
//  5. Sert le résultat en JSON à la PWA (GET /api/days).
//
// Secrets à configurer dans Cloudflare (jamais dans le code) :
//   APINEX_API_KEY    — clé APInex (commence par « sk-apx »)
//   API_FOOTBALL_KEY  — clé gratuite API-Football (api-sports.io)
//   ADMIN_SECRET      — mot de passe pour déclencher /run à la main
//                       et recevoir les journées de Muse (/admin/day)
// Binding KV requis : PREDICTIONS_KV
// Variables optionnelles : APINEX_MODEL (défaut « free/glm-5.3-flash »)

const MARKETS = [
  "BTTS Oui",
  "BTTS Non",
  "+1,5 but dans le match",
  "+2,5 buts dans le match",
  "+0,5 but en 1re mi-temps",
  "+1,5 but en 2e mi-temps",
];
const MAX_MATCHES_PER_DAY = 15;

// Prestige des compétitions (identifiants de ligue API-Football)
const COMPETITION_WEIGHT = {
  2: 100, // Ligue des champions
  1: 100, // Coupe du monde
  4: 98, // Euro
  39: 95, // Premier League
  140: 92, // La Liga
  135: 88, // Serie A
  78: 88, // Bundesliga
  61: 85, // Ligue 1
  3: 80, // Ligue Europa
  94: 78, // Primeira Liga
  88: 76, // Eredivisie
  848: 72, // Conference League
  45: 70, // FA Cup
  143: 68, // Coupe du Roi
  137: 66, // Coupe d'Italie
  66: 64, // Coupe de France
  203: 74, // Süper Lig (Turquie)
  307: 72, // Saudi Pro League
  253: 70, // MLS
};
// Bonus pour les très grands clubs (noms tels que renvoyés par API-Football, en minuscules)
const BIG_TEAMS = new Set([
  "arsenal", "chelsea", "liverpool", "manchester city", "manchester united",
  "tottenham", "newcastle", "aston villa",
  "barcelona", "real madrid", "atletico madrid", "sevilla",
  "inter", "ac milan", "juventus", "napoli", "as roma",
  "bayern munich", "borussia dortmund", "rb leipzig", "bayer leverkusen",
  "paris saint germain", "marseille", "monaco", "lille",
  "fc porto", "benfica", "sporting cp", "ajax", "psv eindhoven",
]);

const dayKey = (d) => d.toISOString().slice(0, 10);
function offsetDay(base, n) {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/* ---------- 1. Données football ---------- */

async function fetchMatchesForDate(env, dateStr) {
  const url =
    `https://v3.football.api-sports.io/fixtures?date=${dateStr}&timezone=UTC`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": env.API_FOOTBALL_KEY },
  });
  if (!res.ok) {
    throw new Error(`API-Football : HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length) {
    throw new Error(`API-Football : ${JSON.stringify(data.errors)}`);
  }
  return data.response || [];
}

const FINISHED_SHORT = new Set(["FT", "AET", "PEN"]);
const LIVE_SHORT = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE"]);

export function normalizeMatch(m) {
  const short = m.fixture.status.short;
  const status = FINISHED_SHORT.has(short)
    ? "FINISHED"
    : LIVE_SHORT.has(short)
      ? "IN_PLAY"
      : "TIMED";
  return {
    id: m.fixture.id,
    competition: m.league.name,
    leagueId: m.league.id,
    emblem: m.league.logo || null,
    flag: null,
    utcDate: m.fixture.date,
    status,
    statusShort: short,
    homeTeam: m.teams.home.name,
    awayTeam: m.teams.away.name,
    homeCrest: m.teams.home.logo || null,
    awayCrest: m.teams.away.logo || null,
    homeGoals: m.goals.home,
    awayGoals: m.goals.away,
    homeGoalsHT: m.score.halftime.home,
    awayGoalsHT: m.score.halftime.away,
    prestige: prestigeScore(m),
    prediction: null, // rempli par Muse ou par APInex
    predictionAlt: null,
    result: null, // "won" | "lost" | "unknown" | null (en attente)
  };
}

function prestigeScore(m) {
  let s = COMPETITION_WEIGHT[m.league.id] || 40;
  if (BIG_TEAMS.has((m.teams.home.name || "").toLowerCase())) s += 6;
  if (BIG_TEAMS.has((m.teams.away.name || "").toLowerCase())) s += 6;
  return s;
}

function topMatchesOfDay(matches, dateStr) {
  return matches
    .filter((m) => (m.fixture.date || "").slice(0, 10) === dateStr)
    .map(normalizeMatch)
    .sort((a, b) => b.prestige - a.prestige || a.utcDate.localeCompare(b.utcDate))
    .slice(0, MAX_MATCHES_PER_DAY)
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
}

/* ---------- 2. Validation déterministe des pronostics ---------- */

export function checkPrediction(prediction, m) {
  if (m.homeGoals == null || m.awayGoals == null) return null; // pas terminé
  const total = m.homeGoals + m.awayGoals;
  const htKnown = m.homeGoalsHT != null && m.awayGoalsHT != null;
  const htTotal = htKnown ? m.homeGoalsHT + m.awayGoalsHT : null;
  switch (prediction) {
    case "BTTS Oui":
      return m.homeGoals > 0 && m.awayGoals > 0 ? "won" : "lost";
    case "BTTS Non":
      return m.homeGoals === 0 || m.awayGoals === 0 ? "won" : "lost";
    case "+1,5 but dans le match":
      return total >= 2 ? "won" : "lost";
    case "+2,5 buts dans le match":
      return total >= 3 ? "won" : "lost";
    case "+0,5 but en 1re mi-temps":
      if (!htKnown) return "unknown";
      return htTotal >= 1 ? "won" : "lost";
    case "+1,5 but en 2e mi-temps":
      if (!htKnown) return "unknown";
      return total - htTotal >= 2 ? "won" : "lost";
    default:
      return "unknown";
  }
}

/* ---------- 3. Analyse par APInex ---------- */

const SYSTEM_PROMPT = `Tu es KEITH, analyste football professionnel (données + marchés de buts).
Pour chaque match reçu, choisis UN SEUL pronostic parmi cette liste fermée :
"BTTS Oui", "BTTS Non", "+1,5 but dans le match", "+2,5 buts dans le match",
"+0,5 but en 1re mi-temps", "+1,5 but en 2e mi-temps".
Règles strictes :
- Aucun autre marché.
- Variété : un même marché au maximum MAXPAR fois dans ta réponse.
- Choisis le marché le plus probable pour chaque match (forme des équipes,
  style de jeu, enjeux), et classe les 6 marchés du meilleur au moins bon
  dans "ranking" (les 6, sans doublon).
- Réponds UNIQUEMENT en JSON valide, sans texte autour :
{"picks":[{"id":123,"pick":"BTTS Oui","ranking":["BTTS Oui","+2,5 buts dans le match","..."]}]}
avec exactement un élément par match reçu, dans le même ordre.`;

async function askApinex(env, matches) {
  const maxPer = Math.max(1, Math.ceil(matches.length / 6));
  const payload = matches.map((m) => ({
    id: m.id,
    competition: m.competition,
    date: m.utcDate,
    home: m.homeTeam,
    away: m.awayTeam,
  }));
  const res = await fetch("https://api.apinex.bond/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.APINEX_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.APINEX_MODEL || "free/glm-5.3-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT.replace("MAXPAR", String(maxPer)) },
        {
          role: "user",
          content:
            `Voici ${matches.length} matchs. Maximum ${maxPer} fois le même marché.\n` +
            JSON.stringify(payload),
        },
      ],
      temperature: 0.3,
      max_tokens: 2500,
    }),
  });
  if (!res.ok) {
    throw new Error(`APInex : HTTP ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const content =
    data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
  const jsonText = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  const parsed = JSON.parse(jsonText);
  return parsed.picks || [];
}

// Applique les pronostics en respectant la liste fermée et le plafond de variété :
// en cas de dépassement, on bascule sur le choix alternatif du match.
export function applyPicks(matches, picks) {
  const maxPer = Math.max(1, Math.ceil(matches.length / 6));
  const byId = new Map(picks.map((p) => [Number(p.id), p]));
  const counts = new Map();
  for (const m of matches) {
    const p = byId.get(Number(m.id));
    if (!p) continue;
    // Ordre de préférence du modèle : pick, puis ranking, puis alt
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
  return matches;
}

/* ---------- 4. Pipeline quotidienne ---------- */

async function runPipeline(env) {
  const now = new Date();
  const days = [
    { offset: -1, label: "Hier" },
    { offset: 0, label: "Aujourd'hui" },
    { offset: 1, label: "Demain" },
  ].map((d) => ({ ...d, date: dayKey(offsetDay(now, d.offset)) }));

  // Conserver les pronostics déjà générés (ne jamais réécrire un pronostic publié)
  const previousRaw = await env.PREDICTIONS_KV.get("days");
  const previous = previousRaw ? JSON.parse(previousRaw) : { days: [] };
  const prevByMatchId = new Map();
  for (const d of previous.days || []) {
    for (const m of d.matches || []) {
      if (m.prediction) prevByMatchId.set(Number(m.id), m);
    }
  }

  // 3 appels API-Football (1 par jour) — largement dans l'offre gratuite (100/jour)
  const raw = [];
  for (const d of days) {
    raw.push(...(await fetchMatchesForDate(env, d.date)));
  }

  const outDays = [];
  for (const d of days) {
    const matches = topMatchesOfDay(raw, d.date);
    // Réinjecter les anciens pronostics quand ils existent
    for (const m of matches) {
      const old = prevByMatchId.get(Number(m.id));
      if (old) {
        m.prediction = old.prediction;
        m.predictionAlt = old.predictionAlt || null;
      }
    }
    // Générer les pronostics manquants (1 appel APInex par jour concerné)
    const missing = matches.filter((m) => !m.prediction);
    if (missing.length) {
      try {
        const picks = await askApinex(env, missing);
        applyPicks(matches, picks);
      } catch (e) {
        console.log(`Génération des pronostics impossible pour ${d.date} : ${e.message}`);
      }
    }
    // Valider les matchs terminés
    for (const m of matches) {
      if (m.status === "FINISHED" && m.prediction) {
        m.result = checkPrediction(m.prediction, m);
      }
    }
    outDays.push({ date: d.date, label: d.label, matches });
  }

  const payload = { generatedAt: now.toISOString(), days: outDays };
  await env.PREDICTIONS_KV.put("days", JSON.stringify(payload));
  return payload;
}

/* ---------- 5. Points d'entrée ---------- */

export default {
  // Déclencheurs planifiés (Cron) : voir wrangler.toml
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPipeline(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/days") {
      const cached = await env.PREDICTIONS_KV.get("days");
      return new Response(cached || JSON.stringify({ generatedAt: null, days: [] }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
    if (url.pathname === "/admin/day" && request.method === "POST") {
      // Réception d'une journée préparée par Muse (analyse quotidienne) :
      // { date, label, matches: [...] } — remplace la journée de même date.
      // Ces pronostics sont ensuite conservés par la pipeline (jamais réécrits)
      // et validés automatiquement avec les scores de l'API football.
      if (!env.ADMIN_SECRET || request.headers.get("X-Admin-Secret") !== env.ADMIN_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      let day;
      try {
        day = await request.json();
      } catch (_) {
        return new Response("Bad request", { status: 400 });
      }
      if (!day.date || !Array.isArray(day.matches)) {
        return new Response("Bad request", { status: 400 });
      }
      const raw = await env.PREDICTIONS_KV.get("days");
      const store = raw ? JSON.parse(raw) : { generatedAt: null, days: [] };
      store.days = (store.days || []).filter((d) => d.date !== day.date);
      store.days.push({ date: day.date, label: day.label || "", matches: day.matches });
      store.days.sort((a, b) => a.date.localeCompare(b.date));
      store.generatedAt = new Date().toISOString();
      await env.PREDICTIONS_KV.put("days", JSON.stringify(store));
      return new Response(JSON.stringify({ ok: true, date: day.date, matches: day.matches.length }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.pathname === "/run") {
      if (!env.ADMIN_SECRET || url.searchParams.get("key") !== env.ADMIN_SECRET) {
        return new Response("Forbidden", { status: 403 });
      }
      const payload = await runPipeline(env);
      return new Response(JSON.stringify({ ok: true, generatedAt: payload.generatedAt }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("KEITH Pronos Worker — voir /api/days", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
