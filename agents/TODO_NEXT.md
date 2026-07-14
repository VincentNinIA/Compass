# TODO Next

## Prochaine action

T4 est close : T4-C01 à T4-C08 sont `done`, chacune après revue d'un
sous-agent distinct. Ne pas commencer T5 sans nouveau contrat Builder. Le
candidat courant passe 383/383 tests frontend, lint, typecheck, build,
`git diff --check` et 13/13 scénarios Playwright déterministes. Les quatre
smokes `@live` restent ignorés faute d'opt-in credentialed.

## Dépendances

- T0 et T1 sont closes avec décision `pass`.
- La remédiation T2-C02 à T2-C06 est close; T2-C01 conserve une réserve live
  amont sans bloquer la remédiation déterministe T3.
- T3-C01 à T3-C08 sont closes avec verdict correctif `pass`. La suite globale,
  le build, les scans, l'eval live 7/7 avec request IDs et les trois smokes 5/5
  portent sur le candidat commun documenté dans T3-C08.
- La version GeoGebra reste épinglée sur `5.4.920.0`.

## Blocages actuels

Aucun blocage Builder dans la tranche close. Le smoke audio WebRTC credentialed
de C08 n'a pas été exécuté et aucune preuve live n'est revendiquée; la réserve
live T2-C01 reste documentée hors de T4.

## Hors périmètre immédiat

Ne pas ouvrir T5, T6 ou un nouveau chantier sans contractualisation. Préserver
le candidat de clôture T2/T3/T4 désormais versionné dans l'historique Git.
