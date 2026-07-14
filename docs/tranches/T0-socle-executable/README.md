# T0 — Socle exécutable

Objectif atteint le 14 juillet 2026 : le runtime web est exécutable et les risques
GeoGebra et Realtime sont isolés dans deux spikes indépendants. T0-C01 à T0-C06
sont closes avec décision `pass`. Les preuves comprennent les quatre gates, les
parcours navigateur nominaux, les fallbacks, les pannes croisées et le cleanup.
Le candidat reproductible exact est
`e297a5282ea5d5a9ea8b504a2042820a4b06da90`; les commandes versionnées sont
`pnpm test:docs:t0`, `pnpm test:e2e:t0` et `pnpm test:e2e:t0:live`.

Ordre : C01 → C02 → (C03 et C04 → C05) → C06.
