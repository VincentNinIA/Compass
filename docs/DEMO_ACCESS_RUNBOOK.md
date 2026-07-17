# Exploitation de la démo publique Compass

## Autorités

L'alias Vercel ouvre directement Compass sans code ni cookie de démo. La
protection budgétaire restante est Vercel WAF, qui limite tous les
`POST /api/*` avant l'exécution des fonctions. Les sessions professeur et alias
de T25 restent séparées et ne doivent pas être confondues avec l'ancienne
session de diffusion T24.

## Configuration Production

Les variables `COMPASS_DEMO_PROTECTION_ENABLED`, `COMPASS_DEMO_ACCESS_HASH`,
`COMPASS_DEMO_SESSION_SECRET` et `COMPASS_DEMO_SESSION_TTL_SECONDS` sont absentes
de Production. `VERCEL_ENV=production` n'active pas la garde. Une activation
privée exige explicitement `COMPASS_DEMO_PROTECTION_ENABLED=1`; elle ne doit pas
être appliquée à l'alias public sans nouvelle décision du porteur.

## Quota Vercel actif

- Projet : `compass-geotutor-demo`.
- Règle : `Compass demo POST budget`.
- ID : `rule_compass_demo_post_budget_5Uw2fO`.
- Conditions : méthode `POST` et chemin commençant par `/api/`.
- Limite : fenêtre fixe, 6 requêtes par 60 secondes et par IP.
- Dépassement : HTTP 429 JSON, `private, no-store`.

Inspection sans mutation :

```sh
pnpm dlx vercel@56.3.1 firewall rules inspect \
  rule_compass_demo_post_budget_5Uw2fO --project compass-geotutor-demo
pnpm dlx vercel@56.3.1 firewall diff --project compass-geotutor-demo
pnpm dlx vercel@56.3.1 env ls production
```

La documentation Vercel confirme que le WAF s'applique globalement, avant les
fonctions, et que le rate limiting à fenêtre fixe est disponible sur tous les
plans :

- <https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting>
- <https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration>
- <https://vercel.com/docs/vercel-firewall/firewall-api>

## Incident et rollback

Rollback du quota uniquement en cas d'incident confirmé :

```sh
pnpm dlx vercel@56.3.1 firewall rules disable \
  rule_compass_demo_post_budget_5Uw2fO --project compass-geotutor-demo
pnpm dlx vercel@56.3.1 firewall publish --project compass-geotutor-demo --yes
```

La désactivation retire une protection budgétaire : elle doit être temporaire,
consignée et suivie d'une règle corrigée. Pour couper les coûts en urgence,
retirer ou faire tourner `OPENAI_API_KEY` reste prioritaire.

### Rollback de la Production

Le candidat public sans code qualifié est
`dpl_HkMUiXBgafn1JvJWRGAahhwhzwh7`. Le dernier candidat T18 connu et qualifié
est `dpl_3ng7jmgj727Yy1Mu8w9SABuXv7R5`, à l'URL immuable
`https://compass-geotutor-demo-dxr8xcxtq-vincent-nin-ia-s-projects.vercel.app`.

En cas d'incident confirmé sur T22 :

```sh
pnpm dlx vercel@56.3.1 rollback \
  dpl_3ng7jmgj727Yy1Mu8w9SABuXv7R5 --yes
pnpm dlx vercel@56.3.1 inspect \
  https://compass-geotutor-demo.vercel.app
```

Le rollback de déploiement ne retire pas la règle WAF du projet. T18 ne porte
pas de porte d'accès applicative, mais il perd les fonctions T22/T25 : rétablir
le candidat public courant dès que possible. Ne jamais utiliser `alias set`
vers un déploiement non inspecté.

## Vérifications

```sh
pnpm --dir apps/frontend test --run lib/demo-access/server.test.ts
pnpm dlx vercel@56.3.1 inspect https://compass-geotutor-demo.vercel.app
curl -fsS https://compass-geotutor-demo.vercel.app/
curl -fsS https://compass-geotutor-demo.vercel.app/api/teacher/exercises
```

La racine et le catalogue doivent répondre 200 sans cookie; la page ne doit
contenir ni « Access code » ni « Code d'accès ». L'ancienne route
`/api/demo/access` doit annoncer `status:"disabled"`. Le WAF doit rester activé
sans draft et les variables de Production ne doivent plus lister de nom
`COMPASS_DEMO_*`.
