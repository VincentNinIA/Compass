# T5 — Invariance et synthèse

Objectif : tester numériquement cinq positions sans altérer la construction élève, puis produire une synthèse hors conversation. Sortie : rollback, accessibilité et fallback prouvés avec le vrai applet.

Ordre d'exécution retenu : C01 → C02 → C03 → C04 → C05 → C06 → C07.

État au 15 juillet 2026 : C01 à C07 sont closes. Le gate final passe avec le
vrai applet, rollback/cleanup, annulation, fallback déconnecté, accessibilité et
smoke OOB credentialed texte-only sur le même candidat. La tranche active est
désormais close, comme T6. Le contre-audit QA T5 final passe après correction
de ce statut : 115/115 ciblés, 5/5 vrai applet et smoke OOB credentialed 1/1,
sans autre finding. Le gate global final du dépôt rend ensuite 573/573 Vitest
et 30/30 Playwright hors live.
