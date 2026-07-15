# TODO Next

## Prochaine action

Préparer la machine jury : certificat de confiance, microphone physique,
connectivité aux services externes et répétition du runbook. T8 est close; ne
rouvrir une tranche produit que sur nouvelle contractualisation explicite.

## Dépendances

- T0 et T1 sont closes avec décision `pass`.
- T2-C02/C04/C05/C06 sont closes après remédiation déterministe : 81/81 tests
  ciblés, 420/420 tests frontend partagés, lint, typecheck et build passent.
- La réserve live T2-C01 reste ouverte : le gate credentialed final du 15 juillet
  rend 2/4; VAD multi-tour et continuation après outil expirent.
- T3-C01, T3-C04, T3-C06, T3-C07 et T3-C08 ont été refermées après le
  contre-audit; T3-C02, T3-C03 et T3-C05 sont restées closes. La tranche T3
  rend 171/171 tests `exercise`, 608/608 frontend, trois E2E 5/5 et une eval
  credentialed 7/7 sur le candidat `45333e47d8c846816083d00b06d2fd0c47bfd1bb`.
  T4-C01 à T4-C08 restent closes et doivent être préservées.
- T7-C01 à T7-C03 sont closes : 608/608 Vitest, lint, typecheck, build et 30/30
  Playwright hors live passent; Axe est sans violation et les quatre viewports
  de qualification ne débordent pas.
- T8-C01 à T8-C03 sont closes `pass` : Compass est la seule marque publique, le
  switch éphémère 🇫🇷/🇬🇧 synchronise `document.lang` et toute la surface élève
  possède ses variantes EN/FR. Le gate rend 609/609 Vitest sur 51 fichiers,
  lint, typecheck, build et 30/30 Playwright historiques; les trois viewports
  français ne débordent pas et le CLI ne rapporte aucune erreur console.
- T5-C01 à T5-C07 sont closes dans l'ordre. Le gate final du 15 juillet 2026
  passe avec lint, typecheck, build, 480/480 tests frontend et 18/18 Playwright
  hors live.
- Le vrai applet prouve 5/5 nominal, candidate incorrecte sans synthèse,
  collision, annulation, cleanup et fallback avec hashes, empreinte élève,
  inventaire et listeners identiques avant/après.
- Le smoke credentialed OOB passe 1/1 : `conversation:"none"`, texte-only,
  `tools:[]`, aucun item de conversation et aucun événement audio. Une
  configuration audio de session éventuellement ré-émise par `response.done`
  ne vaut pas sortie audio; modalités et parts restent strictement textuelles.
- La documentation officielle OpenAI OOB, `response.create`, `response.done` et
  WebRTC a été vérifiée pour les frontières T5/T6.
- T6-C01 est close : 75/75 tests ciblés, 487/487 tests Vitest sur 44 fichiers,
  lint, typecheck et build passent; Playwright hors live passe 20/20, dont 2/2
  scénarios reset/recovery sur le vrai applet. L'epoch précède les annulations,
  la restauration vérifie hash/inventaire/registre/listeners, et seul le plan
  confirmé autorise le fallback A/B/AB.
- T6-C02 est close : 61/61 tests ciblés, 507/507 tests Vitest sur 45 fichiers,
  lint, typecheck et build passent; Playwright hors live rend 24/24 et le smoke
  credentialed typed-live 1/1. Local émet zéro requête modèle, texte fonctionne
  sans micro/audio, voix exige la piste distante et aucune panne ne reconnecte
  automatiquement.
- T6-C03 est close : 70/70 tests ciblés, 538/538 tests Vitest sur 46 fichiers,
  lint, typecheck et build passent ; Playwright hors live rend 25/25. Les 24
  permutations appliquent reset > parole > action > outil, les quatre frontières
  revalident token/epoch/révision, les tardifs sont quarantainés et le registre
  finit sans pending, y compris sur le vrai applet ralenti.
- T6-C04 est close : 101/101 tests ciblés, 541/541 tests Vitest sur 46 fichiers,
  lint, typecheck et build passent; Playwright hors live rend 26/26. Le vrai
  parcours relie SILENT/SPEAK aux actions et preuves, les quatre frontières
  portent leur operation ID, les fixtures sensibles sont expurgées et Reset
  vide le buffer/dropped tout en changeant de run.
- T6-C05 est close : 123/123 tests ciblés, 559/559 tests Vitest sur 49 fichiers,
  lint, typecheck et build passent; Playwright hors live rend 27/27. Les erreurs
  applicatives sont fermées, 401/403/429 ne sont pas retentés automatiquement,
  5xx a un unique retry, les cinq budgets publient p50/p95 et fallback, et les
  scans bundle/env/logs/réponses ne trouvent aucun secret ni payload brut.
- T6-C06 est close : 563/563 tests Vitest sur 50 fichiers, lint, typecheck et
  build passent; Playwright hors live rend 29/29 et le candidat HTTPS 2/2. Axe
  A/AA et Lighthouse accessibilité/bonnes pratiques rendent 0 violation/1,00,
  les quatre viewports reflow, le refus micro reste local/typed explicite et
  attribution/licence non commerciale restent visibles.
- T6-C07 est close après contre-audit : le préflight final passe lint,
  typecheck, build, 573/573 Vitest et 30/30 Playwright hors live. La série QA
  `series_f4ec3e800c0c0dfa76455a24` passe 3/3 live, sans retry, sur le candidat
  `candidate_e9d7884f850fb105e3cc290c` et l'environnement
  `environment_0f52328722a31843a91e9d4b`. Les trois parcours couvrent photo,
  confirmation, SILENT, voix/SPEAK, correction, invariance 5/5, synthèse OOB,
  reset exact et cleanup terminal. Les preuves finales sont un inventaire fermé
  de 6 JSON, 3 PNG et 3 WEBM, sans secret, trace réseau, ZIP ni SDP.
- Le QA T5 passe après correction d'un README stale : 115/115 ciblés, 5/5 vrai
  applet, smoke OOB credentialed 1/1 et aucun autre finding. Le QA T6 a fermé
  quatre findings sur l'annulation Realtime, les mutations reset, l'identité
  d'environnement et les artefacts, puis a revalidé 3/3 sur un candidat neuf.

## Blocages actuels

Aucun blocage déterministe produit connu. Le candidat T3 est figé dans Git;
T7, T8 et leurs preuves doivent être préservées. Le gate automatisé C07 a utilisé une clé valide,
une piste micro synthétique et un certificat local auto-signé. Le micro physique,
le certificat de confiance et les services externes restent à contrôler sur la
machine jury. La réserve live T2-C01 reste ouverte et ne doit pas être confondue
avec le gate C07 réussi.

## Hors périmètre immédiat

Ne pas modifier le périmètre fonctionnel T1 à T6. SLA production, analytics
persistants, IndexedDB, historique distant, commande GeoGebra générique et
second exercice restent hors périmètre. La langue de la voix et la traduction
de texte modèle libre restent hors T8.
