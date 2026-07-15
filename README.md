# Compass · GeoTutor

Compass est un prototype de tuteur de géométrie vocal qui combine une scène
GeoGebra observable et une session OpenAI Realtime. Le produit suit la
construction de l’élève, vérifie localement des propriétés géométriques et rend
la progression visible sans déléguer les décisions déterministes au modèle.

## État du projet

Les tranches T0 à T6 sont closes avec décision `pass` au 15 juillet 2026.

- T0–T3 fournissent le runtime, GeoGebra observable, Realtime WebRTC, gateway
  fermé et extraction photo confirmée avant initialisation.
- T4 garde la pédagogie local-first : SILENT/QUEUE/SPEAK, aides progressives,
  preuves et annulations sont déterministes et stale-safe.
- T5 exécute cinq mesures d’invariance réversibles et produit une synthèse
  Realtime OOB texte-only, avec fallback local identique.
- T6 ferme reset/recovery, modes dégradés, courses, observabilité, erreurs,
  latences et présentation HTTPS accessible. Son gate final passe trois golden
  journeys live consécutifs, sans retry, sur le même candidat et environnement.

Le détail des cartes et des preuves se trouve dans la
[roadmap](docs/ROADMAP.md) et les [contrats de tranches](docs/tranches/).

## Architecture actuelle

L’application web vit dans `apps/frontend`. La façade GeoGebra centralise cycle
de vie, listeners, ownership, checkpoints et invariance; preuves géométriques,
progression et décision pédagogique sont évaluées localement. Un arbitre unique
protège mutations GeoGebra, commits UI, émissions Realtime et outputs outils.

La voix utilise WebRTC dans le navigateur et une route Next.js serveur qui
transmet l’offre SDP à `/v1/realtime/calls`. La clé `OPENAI_API_KEY` reste
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
pnpm --dir apps/frontend exec playwright test --grep-invert @live
```

Le gate OpenAI réel est volontairement opt-in et requiert certificat/clé HTTPS
hors dépôt ainsi que la variable serveur `OPENAI_API_KEY` :

```sh
GEOTUTOR_TLS_CERT=/path/to/cert.pem \
GEOTUTOR_TLS_KEY=/path/to/key.pem \
pnpm gate:t6:live
```

Les preuves navigateur se trouvent dans `output/playwright/`. Le verdict C07
final comprend 569/569 tests Vitest, 29/29 Playwright hors live et trois
parcours live consécutifs avec manifests, captures et vidéos expurgés. Le
[runbook jury](docs/DEMO_RUNBOOK.md) distingue le harness local du certificat de
confiance et du microphone physique à vérifier avant présentation.

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
l’ordre des cartes. Les prochaines actions sont les contre-audits QA T5/T6 et
la préparation de la machine jury.
