# T3 — Exercice depuis une photo

Objectif : extraire un exercice supporté depuis une image, obtenir une confirmation humaine puis initialiser uniquement les données géométriques. Sortie : pipeline strict, transactionnel et sans stockage persistant.

Statut : `pass` après remédiation QA close le 15 juillet 2026. L'ordre C01 →
C04 → C06 → C07 → C08 a été respecté; C02, C03 et C05 sont restées closes et
leurs frontières ont été revalidées. Le candidat
`45333e47d8c846816083d00b06d2fd0c47bfd1bb` passe 171/171 tests `exercise`,
608/608 tests frontend, lint, typecheck, build, trois E2E T3 consécutifs 5/5 et
l'eval credentialed 7/7 avec les cinq invariants à `true`.
