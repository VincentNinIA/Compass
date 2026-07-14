# Contrat Builder - T4 Boucle pédagogique sélective — close

## État

- Tranche T4 ouverte puis close le 14 juillet 2026 après clôture corrective
  `pass` de T3.
- Ordre obligatoire : T4-C01 → T4-C02 → T4-C03 → T4-C04 → T4-C05 →
  T4-C06 → T4-C07 → T4-C08.
- Carte active : aucune. T5 n'est pas ouverte par ce contrat.
- T4-C01 est close après correction et revalidation `pass` du sous-agent :
  20/20 tests ciblés, 263/263 tests frontend, lint, typecheck et build passent.
- T4-C02 est close : 48/48 tests ciblés, 280/280 tests frontend, lint,
  typecheck et build passent; l'ownership absent ou falsifié échoue fermé.
- T4-C03 est close après revue sous-agent `pass` : 55/55 tests ciblés,
  298/298 tests frontend, lint, typecheck et build passent; la policy est pure,
  `QUEUE` réévaluable et toute intervention proactive reste L1 sans outil.
- T4-C04 est close après revue sous-agent `pass` : 12/12 tests cœur, 67/67
  tests d'intégration T4, 309/309 tests frontend, lint, typecheck, build et 8/8
  parcours navigateur déterministes passent; 4 smokes `@live` restent ignorés.
- T4-C05 est close après revue sous-agent `pass` : 38/38 tests ciblés,
  324/324 tests frontend, lint, typecheck et build passent; les trois guards
  stale et le gateway bloquent les réponses/outils tardifs avant tout handler.
- T4-C06 est close après revue sous-agent `pass` : 49/49 tests ciblés, 345/345 tests frontend, lint,
  typecheck, build et 8/8 Playwright déterministes passent; 4 smokes `@live`
  restent ignorés faute d'opt-in. Le gate partagé prouve un seul owner de réponse.
- T4-C07 est close : 92/92 tests ciblés, 365/365 tests frontend, lint,
  typecheck, build et 8/8 Playwright déterministes passent; L3/L4 restaurent
  styles et helpers, L4 exige une confirmation révisionnée one-shot.
- T4-C08 est close après revue sous-agent `pass` : 107/107 tests ciblés,
  383/383 tests frontend, lint, typecheck, build et `git diff --check` passent;
  le Playwright global rend 13 déterministes passés et 4 `@live` ignorés. Les
  annulations sont scopées, le clear défaillant bloque les envois et le journal
  reste corrélé et expurgé.
- Une seule carte est implémentée et vérifiée à la fois; chaque carte est confiée
  à un sous-agent distinct puis revue par le Builder principal avant la suivante.
- Le candidat de clôture regroupe les implémentations T2/T3/T4 préservées et
  constitue le runtime réel d'intégration.

## Inclus dans la tranche

- T4-C01 : état pédagogique unique, reducer pur, événements typés, invariants et
  sélecteurs stale-safe.
- T4-C02 : meaningful delta construction/faits et détection idempotente du même
  blocage après deux actions significatives.
- T4-C03 : policy pure `SILENT | QUEUE | SPEAK`, priorité métier, garde du floor
  et plafond proactif L1.
- T4-C04 : progrès local 0/2–2/2 et annonces accessibles calculés uniquement à
  partir des preuves courantes, avant tout réseau.
- T4-C05 : directives ancrées à epoch/étape/révision/hash/action/preuves et
  guards avant item, réponse et outil.
- T4-C06 : séparation du tour vocal explicite et de l'intervention proactive,
  avec un seul propriétaire de réponse actif.
- T4-C07 : assistance L1–L4 contrôlée par l'application, L3/L4 temporaire,
  autorisée, confirmée lorsque requis et restaurable.
- T4-C08 : annulations drag/parole/Stop/stale, journal de preuves expurgé et
  scénarios de bout en bout prouvant l'absence d'audio ou d'outil tardif.

## Hors périmètre

- Expérience d'invariance, verbalisation et synthèse T5.
- Reconnexion, fallback global, arbitrage exhaustif des courses et gate live 3/3
  de T6.
- Persistance, commande GeoGebra arbitraire, nouveau template d'exercice,
  changement de modèle ou semantic VAD.
- Refonte visuelle générale, dashboard enseignant ou traduction française.
- Résolution de la réserve amont T2-C01 au-delà du fail-closed déjà en place.

## Fichiers probablement touchés

- `apps/frontend/lib/pedagogy/**`
- `apps/frontend/lib/realtime/{voice-turn,tool-loop,webrtc-session}*`
- `apps/frontend/lib/tools/{runtime,gateway,handlers,contracts}*`
- `apps/frontend/lib/geogebra/{action-bridge,progress,checkpoint,scene}*`
- `apps/frontend/components/{tutor-workspace,geogebra-spike}*`
- `apps/frontend/e2e/t4-pedagogy.spec.ts` et tests ciblés T4
- documents pilotes, architecture, roadmap et cartes T4

## Vérification prévue

Pour chaque carte, exécuter d'abord ses tests ciblés puis les gates applicables
avant de passer à la suivante. Le gate final T4 comprend :

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend exec playwright test
```

Les smokes live Realtime restent opt-in et dépendent de `OPENAI_API_KEY`. Si la
credential manque ou si le profil amont divergent est refusé, la carte consigne
la dépendance sans présenter le parcours comme passé. Les preuves déterministes
doivent couvrir au minimum SILENT puis SPEAK L1, UI avant réseau, stale aux trois
gates, ordre cancel/clear, cleanup L3/L4 et outil tardif sans mutation.

## Vérification obtenue

- Documentation pilote, huit cartes T4, PRD v1.1 et références techniques
  OpenAI, GeoGebra, WCAG et Playwright consultés avant modification du runtime.
- T4-C01 : 20/20 tests ciblés et 263/263 tests frontend passent, ainsi que lint,
  typecheck et build. Après correction des invariants signalés, la revalidation
  dédiée rend `pass` sans blocker.
- T4-C02 : 48/48 tests ciblés et 280/280 tests frontend passent, ainsi que lint,
  typecheck et build. Add/remove/drag, bruit, hints, ownership, facts,
  idempotence A → B → A, succès, étape, epoch et cascade 30 updates sont couverts.
- T4-C03 : 55/55 tests ciblés et 298/298 tests frontend passent, ainsi que lint,
  typecheck et build. La matrice de priorité, le golden path SILENT → SPEAK L1,
  les trois floors occupés, l'unicité action/demande, `QUEUE` non finalisant et
  l'absence de réseau, timer ou horloge sont couverts; revue dédiée `pass`.
- T4-C04 : le view model 0/2–2/2 échoue fermé sur preuve stale ou incohérente;
  l'unique annonce live est dédupliquée. La trace reducer → DOM → policy → réseau,
  un réseau pending/rejeté, une policy en erreur et la garde epoch/Reset sont
  couverts. Les gates rendent 12/12 cœur, 67/67 intégration, 309/309 global,
  lint/typecheck/build et 8/8 Playwright déterministes; revue dédiée `pass`.
- T4-C05 : le schéma v1 fermé et immuable, chaque anchor stale, la transition
  unique, la trace directive/event/item/response/call et la concordance des
  preuves sont couvertes. Une révision changée n'émet pas de réponse et le
  gateway retourne `rejected_stale` avant handler; 38/38 ciblés, 324/324
  globaux, lint/typecheck/build et revue dédiée `pass`.
- T4-C06 : `session.updated` verrouille server VAD sans auto-réponse. Le tour
  explicite s'ancre à `speech_stopped` et répond une fois à l'item audio commité;
  le proactif SPEAK envoie item compact, attend l'ack, re-garde puis demande une
  réponse. Un `ResponseGate` partagé, les owners et event IDs empêchent les
  doubles réponses. Après correction du transfert d'ownership des continuations
  et du pending `busy`, les gates rendent 49/49 ciblés, 345/345 global,
  lint/typecheck/build et 8/8 Playwright déterministes; 4 live sont ignorés;
  la revue dédiée rend `pass`.
- T4-C07 : la matrice applicative choisit le niveau le plus bas utile, force le
  proactif à L1 sans outil et réserve L4 à une confirmation liée à la directive
  et la révision. L3 et L4 utilisent des objets `owner:"hint"` réservés,
  restaurent en `finally` et n'emploient le checkpoint qu'en fallback si le
  travail élève n'a pas changé. Les gates rendent 92/92 ciblés, 365/365 global,
  lint/typecheck/build et 8/8 Playwright déterministes.
- T4-C08 : un coordinateur unique couvre les six raisons avec idempotence
  incluant le scope transport, annule pending/réponse/hint/outils et ordonne
  cancel avant clear. Les réponses et deltas tardifs sont ignorés; un clear en
  échec coupe l'audio et ferme les nouveaux envois jusqu'à cohérence. Le journal
  allowlisté relie action, décision, directive, response, call et evidence IDs
  sans payload libre. Les gates rendent 107/107 ciblés, 383/383 global,
  lint/typecheck/build, 5/5 Playwright T4 et 13/13 déterministes globaux; 4
  `@live` sont ignorés faute d'opt-in. Les cinq tests T4 utilisent le runner
  Playwright sans fixture `page`; cette limite est consignée sans revendication
  de smoke audio live.

## Définition de fini T4

- Les huit cartes T4 sont exécutées dans l'ordre, chacune avec un sous-agent
  distinct et des preuves consignées.
- Une suite d'événements produit un état pédagogique déterministe; toute donnée
  d'ancien epoch/révision/hash est rejetée sans effet.
- La première erreur significative reste silencieuse; le second blocage identique
  déclenche au plus une question proactive L1.
- Le progrès local est rendu avant tout aller-retour Realtime.
- `SILENT` et `QUEUE` n'envoient aucun item ni réponse; le chemin proactif
  `SPEAK` envoie un item compact puis une réponse unique.
- Drag, parole, Stop, reset et nouvelle révision invalident les interventions;
  un outil tardif ne modifie jamais GeoGebra.
- L3 et L4 ne touchent pas le travail élève et restaurent styles, helpers et
  checkpoint sur succès, annulation ou erreur.
- Les tests ciblés, la suite frontend, lint, typecheck, build et les smokes
  navigateur applicables passent, ou toute dépendance live manquante est nommée.
- `CONTRACT.md`, `DECISIONS.md`, `TODO_NEXT.md`, `ROADMAP.md`, architecture et
  cartes décrivent exactement l'état réel du dépôt.
