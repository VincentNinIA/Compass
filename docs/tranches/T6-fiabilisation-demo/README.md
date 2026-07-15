# T6 — Fiabilisation et démo

Objectif : rendre les reprises, courses, erreurs et modes dégradés explicites, puis qualifier la démonstration. Sortie : trois parcours live consécutifs sur le même commit, tout échec remettant le compteur à zéro.

Ordre : C01 → C02 → C03 → C04 → C05 → C06 → C07.

État au 15 juillet 2026 : T5 et T6 sont closes avec verdict `pass`.
T6-C01 est close avec reset/recovery exact, fallback depuis le plan confirmé,
487/487 tests Vitest et 20/20 scénarios Playwright hors live. T6-C02 est close :
les trois modes restent honnêtes, le texte live fonctionne sans micro/audio et
les reprises sont manuelles, sûres et sans boucle. Les gates rendent 507/507
Vitest, 24/24 Playwright hors live et 1/1 smoke credentialed typed-live.
T6-C03 est close : l'arbitre partagé applique reset > parole > action > outil,
garde les quatre frontières d'effet et quarantine les tardifs. Les gates rendent
538/538 Vitest et 25/25 Playwright hors live, dont le vrai applet ralenti avec
reconstruction A/B/AB et zéro pending. T6-C04 est close : journal fermé et
borné, corrélations/durées, redaction stricte, export volontaire et lifecycle
reset/session passent 541/541 Vitest et 26/26 Playwright hors live. T6-C05 est
close : erreurs fermées, retries/timeouts bornés, cinq distributions p50/p95,
fallbacks visibles et scans secrets passent 559/559 Vitest et 27/27 Playwright
hors live. T6-C06 est close : build HTTPS et permissions reproductibles,
accessibilité A/AA sur le vrai applet, quatre viewports, modes dégradés et
attributions passent 563/563 Vitest, 29/29 Playwright hors live et 2/2 HTTPS.
T6-C07 est close : le runner lié au candidat exécute les gates déterministes,
puis trois parcours live séquentiels sans retry. Après corrections et relances
du contre-audit, la série `series_f4ec3e800c0c0dfa76455a24` passe 3/3 sur le
candidat `candidate_e9d7884f850fb105e3cc290c` et l'environnement
`environment_0f52328722a31843a91e9d4b`. Les trois manifests couvrent photo,
confirmation A/B/AB, silence au premier bloc, aide vocale au bloc répété,
correction 2/2, invariance 5/5, synthèse OOB texte-only, reset exact et cleanup.
Les 6 JSON, 3 PNG et 3 WEBM sont expurgés; aucune trace réseau n'est conservée
car une trace Playwright embarquerait le SDP brut. Le préflight final rend
573/573 Vitest et 30/30 Playwright hors live avec lint, typecheck et build.
