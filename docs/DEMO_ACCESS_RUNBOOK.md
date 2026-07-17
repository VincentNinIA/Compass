# Exploitation de l'accès démo Compass

## Autorités

La démo utilise deux autorités indépendantes et cumulatives :

1. l'application exige une session signée avant l'API métier, dont les trois
   routes OpenAI ;
2. Vercel WAF limite tous les `POST /api/*` avant l'exécution des fonctions.

Le cookie `compass_demo_session` est opaque, `HttpOnly`, `SameSite=Strict`,
`Secure` en Production et valide quatre heures au maximum. Il ne contient ni le
code d'accès, ni une identité, ni un contenu élève. Sa signature lie aussi
l'empreinte du hash du code : remplacer le hash ou le secret de session invalide
toutes les sessions après redéploiement.

## Configuration Production

Les quatre variables suivantes sont chiffrées dans le projet Vercel
`compass-geotutor-demo` pour l'environnement Production :

- `COMPASS_DEMO_PROTECTION_ENABLED=1` ;
- `COMPASS_DEMO_ACCESS_HASH`, dérivé par scrypt ;
- `COMPASS_DEMO_SESSION_SECRET`, aléatoire et long ;
- `COMPASS_DEMO_SESSION_TTL_SECONDS=14400`.

`VERCEL_ENV=production` impose l'échec fermé même si le flag est absent : une
configuration incomplète affiche l'indisponibilité et retourne 503 avant tout
appel modèle.

Générer le matériel local, ou le faire tourner explicitement :

```sh
pnpm --dir apps/frontend demo:access:generate
pnpm --dir apps/frontend demo:access:generate -- --rotate
```

Le script écrit une copie opérateur ignorée par Git, en mode `0600`, dans
`apps/frontend/.env.demo-access.local`. Le code en clair ne doit être transmis
qu'au jury ou aux testeurs autorisés, par un canal distinct de l'URL. Il ne doit
jamais être ajouté à une issue, un log, une capture ou un document versionné.

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

## Révocation et rollback

Le bouton « Fermer la démo » appelle `DELETE /api/demo/access`, expire le cookie
du navigateur et revient à l'écran verrouillé.

Révocation globale : générer un nouveau code, remplacer au minimum
`COMPASS_DEMO_ACCESS_HASH` et `COMPASS_DEMO_SESSION_SECRET` avec
`vercel env add ... production --sensitive --force`, puis créer une nouvelle
Production. Une variable Vercel modifiée ne change pas un déploiement déjà
construit.

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

Le candidat T22 protégé qualifié est
`dpl_GQtBPXN765XSqrPLyJpakyUZsfen`. Le dernier candidat T18 connu et qualifié
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
pas la porte d'accès applicative T24 : après un rollback d'urgence, limiter la
diffusion de l'URL et rétablir T22 corrigé dès que possible. Ne jamais utiliser
`alias set` vers un déploiement non inspecté.

## Vérifications

```sh
pnpm --dir apps/frontend test --run lib/demo-access/server.test.ts \
  components/demo-access-gate.test.tsx
pnpm --dir apps/frontend test:e2e:t24
```

Le test navigateur prouve écran fermé, 401 avant parsing sur les trois routes,
session valide et déconnexion. La preuve d'infrastructure envoie une rafale sur
un chemin inexistant sous `/api/` : les six premières requêtes atteignent le
404, les suivantes reçoivent 429, donc aucun exercice ni appel OpenAI n'est
impliqué.
