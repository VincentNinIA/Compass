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

## D-012 - Snapshot canonique T1

- Décision : utiliser `getCommandString(name,false)`, trier les objets, normaliser
  les nombres à `1e-9` et hacher la représentation versionnée avec FNV-1a 32.
- Raison : supprimer la locale, l'ordre de lecture et le bruit flottant des
  décisions de progression.
- Impact : la révision ne change que lorsque le hash canonique change; toute
  évolution de la normalisation exige une nouvelle version et les fixtures T1.

## D-013 - Deux preuves indépendantes de médiatrice

- Décision : lire `ArePerpendicular(candidate,AB)` séparément de la distance
  entre `Midpoint(A,B)` et la candidate, avec tolérance `1e-6` pour la distance.
- Raison : ne jamais confondre une perpendiculaire décalée avec une médiatrice.
- Impact : le progrès 0/2–2/2 possède toujours deux evidence IDs de la même
  révision; les helpers `gtR…` sont temporaires et supprimés après mesure.

## D-014 - Reset transactionnel en mémoire

- Décision : capturer `getBase64` et l'inventaire exhaustif après A/B/AB,
  suspendre le bridge pendant `setBase64`, borner son callback à 3 s, comparer
  inventaire et hash initial puis reconstruire la fixture en fallback.
- Raison : restaurer exactement la scène sans persistance et sans callbacks
  anciens ou listeners dupliqués.
- Impact : chaque reset incrémente l'epoch, remet le progrès à zéro et doit
  terminer avec A/B/AB et quatre listeners uniques.

## D-015 - Tours vocaux pilotés par le commit VAD

- Décision : configurer côté serveur `server_vad` avec seuil `0.2`, préfixe
  `300 ms`, silence `400 ms`, `create_response:false` et
  `interrupt_response:true`; `VoiceTurnManager` est l'unique producteur de
  `response.create`. Il crée la réponse initiale après commit utilisateur et la
  continuation seulement après publication de tous les outputs d'outils.
- Raison : rendre les tours assez sensibles pour la voix de démonstration tout
  en supprimant les producteurs de réponse concurrents et les doublons réseau.
- Impact : `item_id` est l'identité de tour et voyage dans la metadata
  `geotutor_turn_id`; une réponse sans cette corrélation n'obtient jamais
  l'autorité du tour. Un seul tour est actif jusqu'à son terminal et les suivants
  restent en attente locale.

## D-016 - Schémas Realtime fermés et validation applicative stricte

- Décision : publier quatre fonctions dont les objets ont
  `additionalProperties:false` et tous les champs requis, sans envoyer le champ
  `strict` non accepté par `/v1/realtime/calls`; reparcourir ensuite chaque
  payload dans le gateway local avant tout handler.
- Raison : la Function Calling générale recommande `strict:true`, mais le live
  Realtime rejette actuellement ce champ dans une définition de session alors
  que les mêmes schémas fermés sans ce champ sont acceptés.
- Impact : la conformité transport aide le modèle, mais l'autorité de sécurité
  reste le parseur local, puis les contrôles de phase, révision, budget et
  idempotence par `call_id`.

## D-017 - Highlight par couleur restaurée

- Décision : `highlight_objects` modifie uniquement la couleur d'objets
  existants, mémorise leur RGB initial, refuse un highlight chevauchant sur le
  même objet et restaure au TTL ou au cleanup.
- Raison : rendre l'indice visible sans créer de helper, déplacer un objet ou
  rendre l'empilement de timers ambigu.
- Impact : le snapshot et l'inventaire géométriques restent identiques; un nom
  absent ou déjà actif échoue avant une seconde mutation.

## D-018 - Annulation audio applicative corrélée

- Décision : suivre l'identifiant de la réponse active et, sur reprise de parole
  ou Stop, annuler aussi un tour pending ou en outils. Envoyer `response.cancel`
  ciblé si l'identifiant est connu, sinon l'événement non ciblé, puis
  `output_audio_buffer.clear`, avant de suspendre l'audio local et d'invalider
  tours et outils en vol.
- Raison : `interrupt_response:true` protège le flux serveur, mais l'application
  doit aussi rendre l'ordre, le cleanup local et le rejet des événements tardifs
  observables et déterministes.
- Impact : une réponse annulée reste dans un ensemble local jusqu'à fermeture de
  session; ses événements ultérieurs sont ignorés. Une réponse créée ou terminée
  tardivement doit aussi porter le `geotutor_turn_id` encore actif, sinon elle est
  annulée ou ignorée avant toute exécution d'outil.

## D-019 - Extraction modèle séparée du plan exécutable

- Décision : valider la sortie vision dans `ExerciseExtractionWireV1`, puis
  dériver exclusivement par code un `ExercisePlanV1` canonique; le JSON Schema
  Structured Outputs est généré depuis Zod, fermé et normalisé pour remplacer
  les tuples `prefixItems` par des tableaux homogènes de longueur fixe.
- Raison : empêcher le modèle de choisir coordonnées, commandes, permissions ou
  objets tout en gardant types TypeScript et schéma transport synchronisés.
- Impact : seule une extraction `ready` sémantiquement cohérente produit le plan
  A(-3,0), B(3,0), AB; tout nouveau template ou changement de schéma exige une
  nouvelle version et des tests de compatibilité Structured Outputs.

## D-020 - Baseline d'exercice promue après transaction GeoGebra

- Décision : capturer un checkpoint éphémère avant l'initialisation photo,
  arrêter le bridge pendant les mutations, restaurer Base64, inventaire,
  registre et hash au premier échec, puis promouvoir une nouvelle baseline de
  Reset avec owners `exercise` seulement après postconditions et listeners
  réconciliés. Initialisation, rollback, Reset UI et récupération empruntent
  tous la même file de `ExerciseInitializationService`; l'UI n'appelle jamais
  directement `CheckpointService.reset()`.
- Raison : le bootstrap T1 A(-2,0)/B(2,0) doit rester restaurable tant que la
  transaction A(-3,0)/B(3,0)/AB n'est pas entièrement validée, sans coder le
  registre `system` en dur ni compter les écritures applicatives comme actions
  élève.
- Impact : seuls un canevas vide ou le bootstrap exact sont remplaçables; tout
  travail élève ou objet rogue est refusé sans clear/delete. Après succès, Reset
  restaure les givens `exercise`; un rollback invérifiable bloque les écritures
  jusqu'à une récupération explicite par le checkpoint T1. Un Reset demandé
  pendant une transaction attend sa fin, y compris la vérification du rollback.

## D-021 - Corpus photo synthétique et eval live non promotionnelle

- Décision : versionner les neuf fixtures énumérées par T3-C08 dans un manifeste
  `FixtureExpectationV1`, les produire par un générateur Sharp déterministe et
  séparer l'eval OpenAI credentialed de la suite CI. L'eval réutilise exactement
  le profil, le prompt et le format de la route, n'envoie que les sept images
  décodables autorisées et ne modifie jamais les attentes golden.
- Raison : fixer explicitement les neuf fixtures autoritatives, garantir une
  provenance sans donnée personnelle et distinguer une preuve live
  variable des protections déterministes du pipeline.
- Impact : tout changement de fixture, schéma, prompt ou modèle exige une revue
  explicite du manifeste et une nouvelle eval; les rapports live restent
  expurgés aux IDs de requête, outcomes et invariants, sans image ni texte.

## D-022 - Autorité de workflow partagée entre outils et interface

- Décision : la phase, le plan confirmé et l'initialisation d'exercice sont
  exposés par une autorité runtime unique détenue par `TutorWorkspace`.
  `initialize_exercise` consomme exclusivement un `ExerciseConfirmedV1` réel et
  délègue à la transaction GeoGebra T3.
- Raison : empêcher le gateway de déclarer artificiellement `constructing` ou de
  recréer l'ancien bootstrap T1 à la place du plan explicitement confirmé.
- Impact : les transitions observables sont `idle → exercise_confirmed →
  constructing`; un plan absent ou divergent échoue sans mutation, et le succès
  T3 crée seulement A(-3,0), B(3,0) et AB.

## D-023 - État pédagogique réduit par événements atomiques

- Décision : centraliser epoch, exercice, étape, révision, hash élève, faits,
  preuves, tentatives, aide, interactions, directive, réponse et hint dans un
  reducer TypeScript pur sous `lib/pedagogy`. Les preuves d'une action validée
  sont commitées atomiquement avec sa révision et son hash.
- Raison : rendre une même suite d'événements entièrement déterministe et
  rejeter les événements stale ou hors ordre sans effet réseau, GeoGebra, audio
  ou horloge dans le reducer.
- Impact : les adaptateurs T1/T2/T3 publient des `PedagogyEvent`; les futures
  policies et orchestrateurs lisent les sélecteurs et restent seuls responsables
  des effets externes. Les rejets sont inspectables dans un journal déterministe.

## D-024 - Delta pédagogique fondé sur les seuls objets élève et faits

- Décision : dériver séparément une empreinte canonique versionnée des objets
  `owner:"student"` et une signature triée des faits déterministes; une action
  n'est significative que si l'une change après un événement stabilisé et si
  l'ownership réel concorde avec l'action publiée.
- Raison : empêcher bruit flottant, style, viewport, givens et helpers temporaires
  d'être comptés comme nouveaux essais pédagogiques.
- Impact : le compteur de blocage conserve tous les `actionId` traités par étape,
  démarre à 1 sur une nouvelle signature manquante, atteint 2 seulement après une
  seconde action significative, et revient à 0 au succès, au changement d'étape
  ou au reset d'epoch.

## D-025 - Décision pédagogique pure avant tout effet

- Décision : ordonner les intentions `succès → aide explicite → blocage répété →
  progrès partiel → première erreur → absence de delta`, puis appliquer le garde
  du floor à toute intention de parler. Une décision `QUEUE` ne finalise jamais
  sa source et doit être recalculée sur l'état courant.
- Raison : rendre la prise de parole déterministe, explicable et indépendante de
  l'horloge, du réseau ou d'un modèle, tout en empêchant les doublons par action
  et par demande d'aide.
- Impact : C03 plafonne toute aide à L1 sans outil; C07 reste seule responsable
  du calcul du plus bas niveau utile L1–L4. Une source finalisée ou une preuve
  incohérente retourne `SILENT:invalid_or_duplicate_context`.

## D-026 - Progrès local acquitté avant les effets distants

- Décision : dériver le score et les deux propriétés exclusivement de l'état
  pédagogique courant, puis attendre l'acquittement du rendu React avant
  d'évaluer la policy. L'effet réseau éventuel est lancé après cet ordre mais sa
  promesse ne sérialise jamais les validations locales suivantes.
- Raison : une connexion lente, absente ou rejetée ne doit ni masquer ni retarder
  une correction déjà prouvée par GeoGebra, et une annonce accessible ne doit pas
  répéter des faits inchangés.
- Impact : les marqueurs `validation_committed → progress_rendered →
  policy_evaluated → network_requested` sont ordonnés. Preuve stale, structure
  incohérente ou contradiction `status/pass` affiche `unknown`; Reset/epoch,
  erreur policy et échec réseau ne restaurent jamais un ancien progrès.

## D-027 - Directive immuable gardée aux trois frontières

- Décision : matérialiser chaque intention de parole dans un objet v1 fermé et
  gelé, corrélé aux events, item, réponse et calls, puis répéter le même contrôle
  d'epoch/exercice/étape/révision/hash/source/preuves avant item, réponse et outil.
- Raison : une décision correcte peut devenir fausse entre deux frontières
  asynchrones; un contrôle unique à la création ne protège ni la réponse tardive
  ni une mutation GeoGebra déclenchée par un `call_id` ancien.
- Impact : toute invalidation est terminale et une réévaluation crée un nouvel
  ID. `ToolGateway` accepte une autorisation de directive calculée à l'instant de
  l'appel et retourne `rejected_stale` avant handler; C06 reste propriétaire de
  l'orchestration effective `conversation.item.create`/`response.create`.

## D-028 - Un gate partagé pour deux chemins Realtime disjoints

- Décision : conserver l'item audio serveur pour le tour explicite et ancrer son
  unique `response.create` à l'`event_id` de `speech_stopped`; pour le proactif,
  injecter seulement un item compact issu d'une directive SPEAK, attendre son
  accusé puis re-garder avant le `response.create`. Les deux chemins réservent le
  même `ResponseGate` avec un owner local explicite ou proactif.
- Raison : `create_response:false` transfère l'autorité de réponse à
  l'application; recréer l'item audio, répondre avant l'ack ou posséder deux
  gates réintroduirait doublons, stale et chevauchement audio.
- Impact : `session.updated` doit confirmer server VAD, auto-réponse désactivée
  et interruption activée. Chaque événement client porte un `event_id`, chaque
  réponse renvoie son owner et ses ancres, SILENT/QUEUE n'émettent rien, et un
  tour explicite annule le proactif avant de reprendre le floor.

## D-029 - Assistance graduée livrée par composites applicatifs restaurables

- Décision : fixer une matrice fermée L1–L4 dans l'application. L1/L2 ne mutent
  pas GeoGebra; L3 applique un highlight borné et un milieu temporaire; L4 crée
  une démonstration guidée uniquement après consommation d'un token lié à la
  directive et la révision. Tous les helpers utilisent `gtHint_*` et
  `owner:"hint"`.
- Raison : le modèle ne doit ni choisir son niveau, ni élever une aide proactive,
  ni produire une solution persistante. Une confirmation générique ou un objet
  temporaire reclassé étudiant rendrait l'escalade non contrôlable.
- Impact : le proactif reste L1 sans outil; l'explicite avance d'un seul niveau
  après livraison réussie. L3/L4 restaurent couleurs et inventaire en `finally`;
  le checkpoint L4 n'est qu'un fallback conditionné à une empreinte élève
  inchangée. Toute nouvelle action annule le hint et rend le contrôle à l'élève.

## D-030 - Annulation unifiée et journal de preuves expurgé

- Décision : router drag, parole, Stop, reset, nouvelle révision et erreur de
  réponse dans un `CancellationCoordinator` unique. Sa clé d'idempotence inclut
  l'ancre pédagogique et le scope transport courant; une annulation active envoie
  `response.cancel` avant `output_audio_buffer.clear`, invalide effets et outils,
  puis ferme le reducer. Journaliser uniquement l'allowlist
  `EvidenceLogEntry` dans une séquence append-only en mémoire.
- Raison : un simple flag par révision confondrait deux tours successifs et un
  cleanup distribué laisserait passer audio, réponse ou outil tardif. Un journal
  libre risquerait d'embarquer transcription, image, SDP ou secret.
- Impact : un doublon du même événement est no-op, mais un nouveau tour au même
  epoch/révision reste annulable. Si le clear échoue, l'audio local est coupé et
  les envois sont bloqués jusqu'à l'acquittement de cohérence. L'export volontaire
  corrèle seulement IDs, ancres, outcome et reason; il n'est ni persistant ni
  distant et exclut tout payload libre.
