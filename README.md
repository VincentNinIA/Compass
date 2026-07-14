# Compass · GeoTutor

Compass est un prototype de tuteur de géométrie vocal qui combine une scène
GeoGebra observable et une session OpenAI Realtime. Le produit suit la
construction de l’élève, vérifie localement des propriétés géométriques et rend
la progression visible sans déléguer les décisions déterministes au modèle.

## État du projet

Les tranches T0 et T1 sont closes avec décision `pass` au 14 juillet 2026.

- T0 fournit le runtime Next.js et deux spikes indépendants : GeoGebra et
  OpenAI Realtime en WebRTC.
- T1 fournit l’adaptateur GeoGebra typé, la scène A/B/AB, les snapshots
  canoniques, le bridge d’actions stabilisées, les preuves de médiatrice, la
  progression locale 0/2–2/2 et le reset exact avec recovery.
- Les trois défauts bloquants de requalification T1 sont couverts : rupture de
  stabilité sur snapshot incomplet, progression remise à zéro après suppression
  et rejet d’un reset contenant un objet parasite ou un callback silencieux.
- La prochaine unité séquentielle est T2-C01, après contractualisation de T2.

Le détail des cartes et des preuves se trouve dans la
[roadmap](docs/ROADMAP.md) et les [contrats de tranches](docs/tranches/).

## Architecture actuelle

L’application web vit dans `apps/frontend`. La façade GeoGebra centralise le
cycle de vie, les listeners et l’ownership des objets. Les snapshots et les deux
preuves de médiatrice sont évalués localement. Le checkpoint Base64 reste en
mémoire et restaure la fixture canonique A/B/AB si l’inventaire ou le hash
diverge.

Le spike vocal utilise WebRTC dans le navigateur et une route Next.js serveur
qui transmet l’offre SDP à `/v1/realtime/calls`. La clé `OPENAI_API_KEY` reste
exclusivement côté serveur, conformément au
[guide Realtime officiel](https://developers.openai.com/api/docs/guides/realtime).

Voir [l’architecture détaillée](docs/ARCHITECTURE.md) et les
[décisions techniques](agents/DECISIONS.md).

## Prérequis

- Node.js 22.17.x (voir `.nvmrc`)
- pnpm 10.6.3

## Installation

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Ouvrir <http://localhost:3000>. Le parcours GeoGebra ne demande aucun secret.

Pour le smoke Realtime live, copier `.env.example` vers
`apps/frontend/.env.local` ou définir `OPENAI_API_KEY` dans l’environnement du
processus. Ne jamais préfixer cette variable par `NEXT_PUBLIC_`.

## Vérification

Les gates reproductibles du dépôt sont :

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:docs:t0
pnpm test:e2e:t0
```

Le smoke OpenAI réel est volontairement opt-in :

```sh
pnpm test:e2e:t0:live
```

Les preuves navigateur versionnées se trouvent dans `output/playwright/`. La
requalification T1 comprend 39 tests ciblés, 59 tests complets, le lint, le
typecheck, le build Next.js et les smokes GeoGebra réels.

## Organisation du dépôt

```text
agents/                 contrats et état pilote Nin-IA
apps/frontend/          application Next.js, tests Vitest et Playwright
docs/                   architecture, roadmap et cartes exécutables
output/playwright/      captures de preuve des smokes réels
prompts/                règles de collaboration Builder
scripts/                validations reproductibles du dépôt
```

Les changements doivent respecter `AGENTS.md`, le contrat de tranche actif et
l’ordre des cartes. T2, T3 et les tranches suivantes restent hors périmètre tant
qu’elles ne sont pas contractualisées.
