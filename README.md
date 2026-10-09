# KEITH Pronos — PWA de pronostics (budget zéro)

Application installable (iPhone, Android, PC) qui affiche chaque jour les
**plus grands matchs du jour** (15 maximum), **1 pronostic par match** parmi
6 marchés, et la **validation automatique** du pronostic (✓ vert / ✗ rouge)
avec le score final et le score à la mi-temps.

## Qui fait quoi

| Rôle | Qui |
| --- | --- |
| Analyse des matchs et pronostics | **Muse** chaque jour ; génération automatique de secours par **APInex** |
| Matchs, logos, scores (mi-temps et finaux) | **API-Football** (gratuit, 100 requêtes/jour) |
| Mise à jour quotidienne (matchs → scores → verdicts) | **GitHub Actions** (gratuit) : 05:30 et 23:30 UTC |
| Affichage pour tous les utilisateurs | Ce dépôt, via **GitHub Pages** : l'app lit le fichier `days.json` |

Règle d'or : **un pronostic publié n'est jamais réécrit**. La routine
conserve les pronostics existants et ne fait qu'actualiser les scores et les
verdicts.

## Les 6 marchés autorisés

« BTTS Oui » · « BTTS Non » · « +1,5 but dans le match » · « +2,5 buts dans le
match » · « +0,5 but en 1re mi-temps » · « +1,5 but en 2e mi-temps »
Variété : un même marché apparaît au maximum ⌈N/6⌉ fois par journée.
Sélection : les matchs sont classés par prestige (compétition + niveau des
clubs) ; en dessous d'un seuil, un match n'entre pas dans la sélection —
mieux vaut 9 grands matchs que 15 matchs quelconques.

## Réglages (une seule fois)

### 1. Secrets du dépôt (Settings → Secrets and variables → Actions)

- `API_FOOTBALL_KEY` — clé gratuite API-Football
  (https://dashboard.api-football.com/profile). ✅ testée : plan Free,
  100 requêtes/jour, la routine en utilise ~6 à 10.
- `APINEX_API_KEY` — clé APInex (https://apinex.bond/keys, connexion Google
  @gmail.com, copier la clé complète `sk-apx…` à sa création : affichage
  unique). Sert uniquement de génération de secours automatique.
  Adresse API : `https://api.apinex.bond/v1` (compatible OpenAI), modèle
  par défaut `free/glm-5.3-flash`, limites gratuites : 5 req/min,
  1 000 000 tokens/jour.

⚠️ Ne jamais écrire une clé dans le code ou dans un fichier du dépôt :
uniquement dans les secrets GitHub ci-dessus.

### 2. GitHub Pages (Settings → Pages)

Source : « Deploy from a branch » → branche `main`, dossier `/ (root)`.
L'application est alors en ligne sur
`https://<utilisateur>.github.io/keith-pronos/`.

### 3. Lancer la routine à la main

Onglet **Actions** → « KEITH Pronos — routine quotidienne » →
« Run workflow ». Elle met à jour `days.json` (matchs du jour, logos,
scores, verdicts) et le publie automatiquement.

## Fonctionnement quotidien

- **05:30 UTC** : la routine récupère hier / aujourd'hui / demain chez
  API-Football, sélectionne les plus grands matchs, conserve les pronostics
  publiés, génère les manquants (via APInex si la clé est présente) et
  valide les matchs d'hier.
- **Dans la journée**, Muse peut déposer son analyse KEITH approfondie
  (forme, absences, styles, cotes) : ses pronostics remplacent ceux de
  secours avant le coup d'envoi, puis ne bougent plus.
- **23:30 UTC** : la routine repasse et valide les matchs du jour terminés.
  Si le score de mi-temps manque, le verdict des marchés de mi-temps
  affiche « ? » plutôt qu'un résultat inventé.

## Installer l'application

- **iPhone** : ouvrir l'adresse dans Safari → Partager →
  « Sur l'écran d'accueil » → Ajouter.
- **Android** : ouvrir dans Chrome → bouton « 📲 Installer » dans l'app
  (ou menu ⋮ → « Installer l'application »).
- **PC** : Chrome ou Edge → icône d'installation dans la barre d'adresse.

## Fichiers

- `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`,
  `icons/` — la PWA
- `days.json` — les données publiées (généré automatiquement)
- `pipeline/generate.mjs` — la routine quotidienne (Node, sans dépendances)
- `.github/workflows/keith-daily.yml` — la planification GitHub Actions
- `worker/` — variante Cloudflare Workers (option avancée, non requise)

---

⚠️ Aucun résultat n'est garanti. Ne mise que ce que tu peux te permettre de
perdre. Paris sportifs interdits aux moins de 18 ans.
