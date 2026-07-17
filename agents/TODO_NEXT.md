# TODO Next

## Prochaine action

Prendre uniquement T24-C02 : protéger l'accès à la démo et limiter les routes
OpenAI coûteuses. T24-C01 est close `pass` sur le merge `4ea885f` et le candidat
`candidate_e6b5349451db363138d6d24b` après 829/829 tests, 43 Playwright hors
live, golden 3/3 et smoke Realtime credentialed 1/1.

T23-C01 et T23-C02 sont closes `pass` après audit, replanning et recentrage sur
le PDF Varignon. La séquence décidée est :

1. T24 — intégrer, protéger et déployer T22 ;
2. T25 — classe pilote, pseudonymes, affectations, reprise et bilan persistant ;
3. T26 — recettes Varignon, profil factuel et variantes approuvées ;
4. T27 — durcissement, instrumentation, pilote réel et candidat final.

Ne pas ouvrir T25 tant que T24-C01 à T24-C03 ne sont pas closes. Vidéo,
licence et soumission restent des actions distinctes exigeant l'autorité du
porteur.

## Dépendances

- T0 et T1 sont closes avec décision `pass`.
- T21-C01 et T22-C01 à T22-C08 sont closes `pass`; le contre-audit final T22
  ne laisse aucun P1/P2 ouvert.
- T23-C01, T23-C02 et T24-C01 sont closes `pass`; T24-C02 est la seule carte
  Builder ouvrable. T24-C03 à T27-C04 restent `backlog` derrière leurs dépendances.
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

Aucun blocage déterministe produit connu. T9-C01 à T9-C03 sont closes `pass` et
le runtime de mascotte n'effectue aucun appel modèle. Le candidat T3 est figé dans Git;
T7, T8 et leurs preuves doivent être préservées. Le gate automatisé C07 a utilisé une clé valide,
une piste micro synthétique et un certificat local auto-signé. Le micro physique,
le certificat de confiance et les services externes restent à contrôler sur la
machine jury. La réserve live T2-C01 reste ouverte et ne doit pas être confondue
avec le gate C07 réussi. T11-C01 est close avec 629/629 Vitest, 34/34
Playwright hors live et la lecture réelle de la capture utilisateur en six tâches.
T12-C01 est close avec 630/630 Vitest, 34/34 Playwright hors live, build, trois
viewports sans débordement et un applet générique réellement prêt. Son choix
historique `general_tutor` sans outil pour GeoGebra est explicitement remplacé
par T13 dans l'atelier mathématique public.
T13-C01 est close avec 639/639 Vitest, 34/34 Playwright hors live, build et zéro
overflow aux trois viewports. Le replay credentialed réel crée
`compassLineFG = Line(F,G)` en vert après une demande explicite.
T14-C01 est close avec 642/642 Vitest, lint, typecheck et build. Le navigateur
intégré prouve Point → clic canevas → Undo actif; le contrôle visuel desktop et
mobile contre l'option 1 est `passed`. Les deltas temps réel et la palette
élargie sont désormais livrés par T14-C02.
T14-C02 est close avec 650/650 Vitest sur 57 fichiers, lint, typecheck et build.
Le vrai applet en session texte a créé E, F et G, avancé la mission 1 à ✓ et le
score à 20 XP; le renommage E → A a retiré la preuve puis A → E l'a restaurée.
Un chargement navigateur propre ne rapporte aucune erreur console.
T15-C01 est close avec un ledger 10/20 XP idempotent, 657/657 tests au gate
d'ouverture T16 et un parcours Chromium 0 → 10 → 20 XP sans erreur console.
T16-C01 est close avec 671/671 Vitest sur 62 fichiers, lint, typecheck et build.
Le parcours Chromium professeur → publication → nouvel onglet élève →
bibliothèque → atelier passe sans erreur; aucun débordement n'apparaît à 390 ou
1440 px. Le catalogue reste volontairement éphémère et partagé par processus.
T16-C02 est close avec 672/672 Vitest sur 63 fichiers, lint, typecheck et build.
Le navigateur confirme le guide enseignant, le brouillon manuel et trois
critères de relecture sans jargon technique, sans débordement à 390/1440 px et
sans erreur console.

T18-C01 ne dépendait pas des retours humains et est close avec 677/677 Vitest,
36/36 Playwright hors live, build et 69 cartes documentaires valides. La vidéo
finale, l'identifiant `/feedback`, la licence éventuelle, le redéploiement et la
soumission Devpost restent des actions du porteur du projet ou nécessitent son
autorisation explicite.

T19-C01 est close : commit candidat `8e25994`, branche distante
`codex/t18-education-candidate`, pull request brouillon #2 et fiche Devpost
Compass version 4. La page projet est `published`, conséquence automatique de
l'enregistrement d'une fiche complète; la participation au hackathon reste non
soumise et aucun appel de soumission n'a été exécuté.

T20-C01 est close : le candidat exact `e1efc28` passe 677/677 Vitest, lint,
typecheck et build dans un worktree propre. La Production Vercel finale
`dpl_3ng7jmgj727Yy1Mu8w9SABuXv7R5` est READY sous Node 22.x et sert l'alias
stable. Le smoke public desktop/mobile, les routes et les headers passent; la
fiche Devpost version 6 reste non soumise.

## Hors périmètre immédiat

Ne pas modifier les contrats spécialisés T1 à T6. SLA production, analytics
persistants, IndexedDB, historique distant, commande GeoGebra générique,
création arbitraire de points et vérification automatique de toutes les matières
restent hors périmètre. Le LMS complet, le SSO établissement et les comptes
élèves nominatifs restent également hors périmètre. T25 autorise seulement une
identité professeur limitée, des classes à pseudonymes et des affectations
bornées après fermeture des contrats de données, accès, rétention et suppression.

T22 est intégré et qualifié dans `main` local par le merge `4ea885f`; la
production publique reste néanmoins sur T18. T24-C02 doit protéger la démo avant
que T24-C03 ne déploie le candidat T22.

Avant de diffuser largement l'URL Vercel, ajouter une protection applicative de
démo et une limitation de débit sur les routes OpenAI. Pour les seules démos
live actuelles, garder l'URL peu diffusée, surveiller l'usage du projet OpenAI et
retirer ou faire tourner la clé lorsque la période de démonstration se termine.

La dette du compteur documentaire T17 est résolue : le validateur ne porte plus
de nombre magique et compare chaque carte au registre roadmap.
