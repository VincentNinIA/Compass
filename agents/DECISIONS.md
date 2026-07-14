# Décisions durables

## D-001 - Application web unique

- Décision : Next.js App Router et TypeScript sous `apps/frontend`, gérés par pnpm.
- Raison : une application navigateur et de petites routes serveur suffisent au prototype.
- Impact : aucune base de données ni backend séparé dans le MVP.

## D-002 - Un seul exercice golden

- Décision : médiatrice d'un segment défini par deux points.
- Raison : privilégier la fiabilité et la profondeur pédagogique.
- Impact : les autres exercices retournent `unsupported` en T3.

## D-003 - Deux modèles pour deux responsabilités

- Décision : `gpt-realtime-2.1` pour la voix; `gpt-5.6-terra` via Responses pour la vision structurée.
- Raison : séparer la conversation temps réel de l'extraction validable.
- Impact : deux routes et contrats distincts, une seule clé serveur.

## D-004 - WebRTC unifié

- Décision : le navigateur poste son SDP à une route serveur qui appelle `/v1/realtime/calls`.
- Raison : chemin simple sans exposer la clé standard.
- Impact : le serveur reste dans le chemin d'initialisation de la session.

## D-005 - Autorité locale de prise de parole

- Décision : `server_vad`, `create_response:false`, `interrupt_response:true`; la policy locale crée les réponses.
- Raison : permettre silence, queue et annulation déterministes tout en gardant le barge-in WebRTC.
- Impact : aucun événement GeoGebra ne déclenche directement le modèle.

## D-006 - Gateway fermé

- Décision : aucun `execute_any_geogebra_command`; seuls des outils produit stricts sont exposés.
- Raison : protéger le travail élève et rendre les effets testables.
- Impact : permissions, budgets, révisions et idempotence obligatoires.

## D-007 - Géométrie déterministe

- Décision : tolérances et preuves appartiennent à l'application, jamais au modèle.
- Raison : éviter les affirmations plausibles mais non fondées.
- Impact : toute réponse géométrique est corrélée à des `evidenceIds`.

## D-008 - Données en mémoire

- Décision : pas de base, Files API, localStorage, IndexedDB ou journal distant dans le MVP.
- Raison : minimisation des données et simplicité hackathon.
- Impact : reload et reset effacent image, contexte local et journaux.

## D-009 - Invariance observée sur cinq positions

- Décision : cinq échantillons déterministes; ne pas appeler ce résultat une preuve universelle.
- Raison : effet visuel fiable et mesurable.
- Impact : une preuve symbolique reste hors MVP.

## D-010 - Cadre GeoGebra

- Décision : prototype non commercial avec attribution visible; commercialisation bloquée avant accord adapté.
- Raison : respecter les conditions d'utilisation actuelles.
- Impact : la licence reste un risque explicite de production.

## D-011 - Version GeoGebra épinglée pour le spike

- Décision : charger le codebase CDN GeoGebra `5.4.920.0` explicitement après
  `deployggb.js`.
- Raison : rendre le spike T0 reproductible et éviter qu'une version flottante
  invalide les preuves A/B/AB.
- Impact : toute montée de version devra rejouer le smoke navigateur et les
  lectures `exists`, `isDefined` et `getCommandString`.
