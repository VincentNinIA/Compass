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

## D-031 - Invariance fermée sous autorité 2/2 courante

- Décision : garder `run_invariance_test` comme composite applicatif interne et
  versionner cinq paramètres normalisés `[-1,-0.5,0,0.5,1]`. L'opération relit
  avant et après chaque sample le candidat, la révision, le score 2/2, les deux
  preuves passantes et leurs tuples canoniques. Elle ne publie un tableau que
  lorsqu'il contient cinq samples finis, corrélés et d'IDs uniques; stale,
  exception et annulation retournent un tableau vide.
- Raison : ni le modèle ni un résultat partiel ne doivent pouvoir choisir les
  positions, prolonger une ancienne validation ou produire une réussite
  géométrique plausible mais non fondée.
- Impact : C02 et C03 implémentent la scène puis les mesures derrière le délégué
  fermé sans modifier l'entrée publique. Toute évolution des cinq paramètres
  exige une nouvelle version et de nouvelles fixtures. C04 ne peut généraliser
  qu'un résultat `completed` de cinq samples; l'exposition Realtime éventuelle
  reste hors de C01 et ne peut jamais introduire de commande GeoGebra libre.

## D-032 - Scène d'invariance restaurée avant tout résultat

- Décision : exécuter les cinq délégations C01 dans un scope unique dont les
  labels normalisent le `runId` en namespace GeoGebra
  `gtInv_<runId_normalisé>_*` et dont chaque helper est pré-enregistré
  `owner:"temporary"`. Capturer avant mutation Base64, inventaire, hash,
  registre, empreinte élève et listeners, puis suspendre le bridge jusqu'au
  cleanup et à leur comparaison exacte.
- Raison : un namespace seul n'empêche ni collision avec le travail élève, ni
  suppression partielle, ni reclassification par listener. Le résultat ne doit
  quitter la scène qu'après preuve que la construction observée est identique.
- Impact : le succès nominal supprime les helpers en `finally` sans reload;
  collision, exception, annulation, divergence élève ou cleanup incomplet
  forcent `setBase64`, reconstruction du registre et réconciliation des quatre
  listeners. Un fallback invérifiable échoue fermé. C03 reçoit le scope mais
  reste seul propriétaire de P, des positions et des mesures PA/PB.
- Compatibilité vérifiée : le préfixe réservé commence par une lettre, car le
  vrai applet GeoGebra 5.4.920.0 refuse les labels commençant par `_` lors de
  `evalCommand`; ce garde est couvert par test et smoke navigateur.

## D-033 - Positions d'invariance projetées et mesures bornées

- Décision : positionner P à partir de
  `ClosestPoint(candidate,Midpoint(A,B)) + parameter × Distance(A,B) ×
  UnitVector(candidate)`, avec la version
  `projected-midpoint-distance-ab-v1`. Après `setCoords`, accepter uniquement
  deux lectures consécutives concordantes à `1e-9` dans une fenêtre de huit;
  utiliser la tolérance PA/PB `absolute-distance-v1` de `1e-6`.
- Raison : le path parameter brut `Point(line,parameter)` ne produit pas cinq
  coordonnées finies pour `[-1,-0.5,0,0.5,1]` sur le vrai applet, tandis que la
  projection garde aussi une candidate incorrecte sur sa propre droite et
  adapte l'expérience à l'échelle de AB.
- Impact : chaque sample conserve paramètre, coordonnées, PA, PB, delta et
  versions; NaN, point hors droite, instabilité, stale ou annulation échouent
  tout-ou-rien. Une candidate incorrecte peut rendre cinq samples finis mais
  ne passe jamais l'agrégation 5/5.

## D-034 - Généralisation local-first derrière la policy partagée

- Décision : recevoir le résultat C03 dans un coordinator sans transport,
  acquitter d'abord un view-model local des mesures, puis relire run, révision,
  autorité 2/2 et cinq evidence IDs avant de créer une directive fermée v1 L1
  `generalize_invariance`. Le guard dédié est rejouable avant dispatch.
- Raison : les cinq mesures doivent rester visibles même sans réseau, tandis
  qu'un résultat partiel, stale ou dupliqué ne doit jamais acquérir une autorité
  de parole. La directive T4 ne peut pas être détournée : son evidence scope est
  celui des deux preuves de médiatrice, pas celui des cinq samples.
- Impact : C04 appelle seulement `onDirectiveReady`; aucun `response.create`
  n'est envoyé. Une intervention déjà ouverte garde la priorité. `QUEUE` ne
  finalise ni ne matérialise rien et doit être recalculé sur un floor courant;
  au plus une directive est remise par run et signature de cinq preuves.

## D-035 - Synthèse Realtime OOB fermée avec fallback identique

- Décision : demander la synthèse par un unique `response.create` sans item de
  conversation, avec `conversation:"none"`, un `input` neuf contenant seulement
  les cinq tuples mesure/preuve, `output_modalities:["text"]`, `tools:[]`,
  `tool_choice:"none"` et metadata string kind/runId/revision. Conserver deux
  maps event ID/response ID, router ces événements avant les owners voix, puis
  accepter uniquement un `response.done` completed, hors conversation et
  composé exclusivement de texte après revalidation du guard C04.
- Raison : une session Realtime peut produire plusieurs réponses OOB en
  parallèle et échoit metadata jusqu'au terminal; le contexte implicite de la
  conversation, une modalité audio ou un outil élargiraient inutilement les
  données et les effets autorisés. `response.done` existe aussi pour les états
  cancelled, failed et incomplete, qui ne sont donc jamais assimilés à un
  succès.
- Impact : timeout, erreur corrélée, send impossible, fermeture, statut non
  completed, texte vide, payload invalide ou autorité stale rendent le même
  résumé local déterministe, construit mot pour mot à partir des cinq mesures.
  Le run et sa signature de preuves sont dédupliqués; aucune sortie modèle ne
  touche le flux audio, le gateway d'outils ou la conversation par défaut. C06
  reste seule propriétaire de la surface accessible qui affiche cette sortie.

## D-036 - Surface d'invariance pilotée par un handle fermé

- Décision : exposer à React une interface `start(observer)` qui retourne le
  handle C01 et ne devient disponible qu'avec une validation locale 2/2
  courante. Le workspace compose cette interface avec la scène C02 et le sampler
  C03; `onResult` et `summary` restent les points d'injection de C04/C05.
- Raison : la progression et l'annulation doivent refléter une exécution réelle
  sans donner à l'UI une commande GeoGebra générique, recréer la policy C04 ou
  présenter une synthèse modèle fictive. Un résultat ancien ne doit pas survivre
  à la disparition de son autorité.
- Impact : Cancel appelle directement le handle courant; reset, stale et unmount
  l'annulent aussi. La surface groupe les annonces à start/3 sur 5/terminal,
  déduplique samples et messages, retire toute sortie partielle, place le focus
  sur l'issue et supprime son seul mouvement décoratif sous reduced motion. C07
  peut brancher les coordinateurs existants sans changer ce contrat UI.

## D-037 - Acquittement terminal avant synthèse OOB texte-only

- Décision : composer C04, C05 et C06 par interfaces relayées dans le workspace,
  puis attendre un acquittement React du résultat terminal avant la policy et la
  requête OOB. Le renderer relit run et révision avant d'afficher; reset, action,
  perte d'autorité et unmount invalident tout contexte en vol. Une réponse OOB
  n'est acceptée que si `conversation_id` est nul, `output_modalities` vaut
  exactement `["text"]` et toutes ses parts sont `output_text`; la présence
  éventuelle d'une configuration audio de session ré-émise dans `response.done`
  n'est pas une sortie audio.
- Raison : l'ordre local-first doit être prouvé par le commit de rendu, pas par
  le seul calcul du résultat, et une session créée avant le runtime GeoGebra ne
  doit pas figer une référence absente. Le smoke credentialed montre que le
  serveur peut échoir sa configuration audio tout en respectant une réponse
  exclusivement textuelle.
- Impact : la session utilise un proxy vers le runtime courant; la voie
  déconnectée traverse la même méthode et tombe sur le fallback `send_failed`.
  Aucun item de conversation, outil ou événement audio n'est créé. Le gate T5
  vérifie sur le vrai applet que les réponses tardives ne ressuscitent pas une
  synthèse et que scène, objets élève et listeners sont restaurés avant rendu.

## D-038 - Reset global ordonné, vérifié et reconstructible

- Décision : faire de `ExerciseInitializationService.reset(reason)` l'unique
  autorité de reset, derrière le mutex d'initialisation. Avancer l'epoch avant
  toute annulation, attendre la fin des opérations, réponses/audio/outils,
  aides et pipelines, puis suspendre le bridge avant `setBase64`. N'accepter la
  restauration qu'après égalité du hash checkpoint et de l'inventaire/registre,
  puis réconciliation exacte des quatre listeners.
- Raison : un reset visuellement terminé ne suffit pas si un effet ancien peut
  encore écrire, parler ou rendre une synthèse, et un accusé `setBase64` ne
  prouve pas que l'état élève a été restauré. Le même ordre doit couvrir clic
  utilisateur et retry de recovery, y compris deux demandes simultanées.
- Impact : un checkpoint absent, silencieusement corrompu ou divergent déclenche
  uniquement une reconstruction A/B/AB depuis un `ExercisePlanV1` confirmé en
  mémoire. Le checkpoint reconstruit est recapturé, réécrit, revérifié puis
  promu; sans plan confirmé ou si les deux voies échouent, l'UI reçoit un état
  `fatal` explicite et `retryable:true`, sans callback de succès. Les réponses
  OOB connues reçoivent `response.cancel`, l'audio est ensuite vidé et leurs
  terminaux tardifs sont ignorés, conformément à la séquence Realtime officielle.

## D-039 - Autorité de capacité fermée et reprises explicitement manuelles

- Décision : conserver une seule autorité visible
  `CapabilityMode{kind,reason,since}` avec exactement `live_voice`, `typed_live`
  et `scripted_local`. Une montée live n'est publiée qu'après clic utilisateur,
  état pédagogique sûr, data channel ouvert et profil de session vérifié;
  `live_voice` exige en plus microphone et piste audio distante.
- Raison : l'état `RTCPeerConnection` ou un simple SDP accepté ne prouve ni la
  voix ni le texte réellement utilisable. Une panne ne doit pas se déguiser en
  live ni relancer silencieusement des requêtes sur une machine jury.
- Impact : `scripted_local` est le défaut sans transport modèle et préserve les
  opérations GeoGebra/invariance locales. `typed_live` réutilise
  `/api/realtime/session` et `oai-events` sans `getUserMedia`; il configure
  `output_modalities:["text"]`, `tools:[]` et `tool_choice:"none"`. Le endpoint
  `/v1/realtime/calls` exige en pratique une offre avec m-line audio et data :
  le client ajoute donc une transceiver audio `inactive`, sans piste ni sortie,
  et échoue fermé si une piste distante apparaît. Les échecs redescendent en
  local avec backoff observable 1/2/4/5 s, plafonné à 5 s; aucun timer n'ouvre
  de session et seule une nouvelle action utilisateur peut retenter.

## D-040 - Arbitre local unique aux quatre frontières d'effet

- Décision : partager un `OperationArbiter` mémoire entre GeoGebra et Realtime.
  Il ne connaît que reset, parole utilisateur, drag/action et outil, avec la
  priorité totale 400 > 300 > 200 > 100. Chaque lease porte un token immuable
  `{id,kind,epoch,revision,priority,abort}` et doit être revalidé avant mutation
  GeoGebra, commit UI, émission Realtime et publication d'output outil.
- Raison : les annulations spécialisées existantes coupent bien leurs propres
  effets, mais ne prouvent pas un ordre total lorsqu'un reset, une parole, un
  drag et un outil se chevauchent. Attendre une promesse non coopérative après
  abort laisserait aussi un pending sans borne.
- Impact : une autorité supérieure abort et retire les inférieures ; une
  opération inférieure arrivée sous autorité supérieure est rejetée et son
  résultat n'est jamais rejoué. Reset reste dédupliqué, parole vit de
  `speech_started` à `speech_stopped`, action garde le pipeline local-first et
  outil compose son signal avec le gateway. Timeout et watchdog abandonnent les
  tardifs sans les attendre. La trace read-only est allowlistée, bornée à 512
  entrées et ne contient aucun payload ; T6-C04 reste propriétaire du journal
  de preuve de démonstration complet.

## D-041 - Journal de démonstration fermé, borné et éphémère

- Décision : n'exporter qu'un événement v1 fermé
  `{timestamp,runId,actionId?,revision,kind,correlationIds,status,durationMs}`.
  Les corrélations ne représentent que operation, directive, response, call et
  evidence IDs; les décisions sont des kinds distincts SILENT/QUEUE/SPEAK.
- Raison : une allowlist structurelle empêche qu'un transcript, nom, audio,
  image, SDP, secret ou payload outil libre devienne un champ de log, tout en
  rendant la chaîne action → décision → réponse → outil → preuve inspectable.
- Impact : le buffer mémoire et ses spans sont bornés à 512 entrées, les listes
  de preuves à 32 IDs et chaque éviction incrémente `dropped`. Réponse et outil
  mesurent leur durée entre start et terminal; les quatre frontières de
  l'arbitre conservent leur operation ID. Un Reset réussi ou la fin d'une
  session Realtime vide entrées, spans et compteur puis crée un nouveau run.
  L'export debug est volontaire, immuable, sans persistance ni envoi distant.

## D-042 - Erreurs fermées et budgets de latence à fallback exécutable

- Décision : normaliser les pannes des routes image et Realtime derrière
  `AppError{domain,code,retryable,userMessage,correlationId}`, sans diagnostic
  amont. Ne jamais retenter 401/403/429 automatiquement, transmettre sur 429 un
  backoff `Retry-After` borné 1–5 s et limiter 5xx à un retry après 50 ms sous
  timeout global.
- Raison : la machine jury doit distinguer configuration, quota, indisponibilité
  et timeout sans recevoir de clé, corps provider ou message arbitraire. Un
  retry SDK implicite rendrait aussi les délais et le nombre d'appels
  impossibles à prouver.
- Impact : un moniteur mémoire conserve au plus 64 durées par budget, calcule
  p50/p95 et n'exporte que nom, durée, seuil, statut et fallback. Les seuils
  sont image 20 s, feedback local 250 ms, session 12 s, premier audio 5 s et
  outil 2 s. Session et premier audio ferment le live en dépassement; l'outil
  applique son plafond au lot avant output/continuation. La surface accessible
  annonce tout fallback et laisse les chemins non mesurés à `unmeasured`.

## D-043 - Candidat HTTPS et garde d'accessibilité du codebase épinglé

- Décision : servir le build jury en HTTPS/TLS 1.2 avec certificat et clé lus à
  l'exécution hors bundle, permissions microphone/camera same-origin et aucun
  secret public. Conserver une garde d'intégration dédiée au codebase GeoGebra
  5.4.920.0 : sous-arbres `aria-hidden` inert, tabindex positifs normalisés,
  disabled natifs, icônes décoratives sans tab stop et panneau scrollable nommé
  et atteignable au clavier; restaurer chaque attribut au cleanup.
- Raison : microphone/camera exigent un contexte sécurisé et une permission
  explicite. Le vrai DOM GeoGebra épinglé expose sinon des contrôles cachés
  focalisables, un ordre tab positif et une région scrollable inaccessible dans
  Safari, ce qui échoue axe/Lighthouse malgré une surface React conforme.
- Impact : le harness local peut utiliser un certificat SAN auto-signé avec
  ignore explicite, mais le jury exige un certificat de confiance. Le build
  envoie les headers de permission/sécurité, les attributions GeoGebra et la
  limite non-commerciale restent visibles, et tout upgrade GeoGebra doit
  rejouer axe, Lighthouse, clavier et les tests de restauration de la garde.

## D-044 - Profil Realtime réaffirmé et gate live lié au candidat

- Décision : qualifier T6 par un runner qui empreinte les sources exécutables et
  l'environnement, exécute le préflight, puis exige trois runs live isolés,
  séquentiels et sans retry. Le compteur est lié aux deux identités et revient à
  zéro sur erreur, étape/preuve manquante ou dérive. Pour la voix, si le premier
  `session.created` diverge uniquement parce que `create_response` vaut sa
  valeur serveur par défaut `true`, émettre une unique `session.update` avec le
  profil VAD exact (`create_response:false`, `interrupt_response:true`, seuil,
  padding et silence verrouillés), puis attendre un `session.updated` strict.
- Raison : la référence Realtime rend `create_response` optionnel et vrai par
  défaut; l'offre `/v1/realtime/calls` peut donc établir le transport avant que
  le profil applicatif demandé soit effectivement confirmé. Accepter la valeur
  initiale créerait une réponse automatique contraire à l'autorité locale,
  tandis qu'un échec immédiat empêcherait de négocier le profil par l'événement
  client prévu à cet effet. Une preuve live n'est reproductible que si code,
  runtime, neuf étapes et compteur appartiennent au même candidat.
- Impact : toute autre divergence de session, ou une divergence qui persiste
  après réaffirmation, échoue fermé. Le gate prouve SILENT sans réponse, SPEAK L1
  au bloc répété, audio distant, 2/2, invariance 5/5, synthèse OOB texte-only,
  reset exact et cleanup. Les manifests sont allowlistés et les seuls binaires
  conservés sont PNG/WEBM; les traces réseau Playwright sont désactivées car
  elles contiennent le SDP brut. Le harness automatisé documente honnêtement sa
  piste micro synthétique et son certificat local, distincts des contrôles jury.

## D-045 - Le contre-audit propage l'annulation et ferme l'identité des preuves

- Décision : publier une autorité d'annulation Realtime distincte dès la
  création de toute session, puis faire du Reset un terminal qui annule la
  réponse, ferme transport/micro/audio et rejette tout événement tardif.
  Propager aussi le lease reset dans `CheckpointService` et le revalider avant
  et après chaque attente puis avant toute mutation, listener ou promotion.
- Raison : l'autorité proactive n'existait qu'après promotion `live_voice`, ce
  qui laissait `typed_live` et la connexion voix initiale hors du reset. Une
  garde posée seulement avant l'I/O ne bloquait pas non plus les mutations
  suivant l'expiration du watchdog.
- Décision de preuve : recalculer candidat et environnement après préflight et
  avant/après chaque run; l'identité opaque inclut la configuration credential
  sans l'exposer. Accepter exactement 12 artefacts : 6 JSON schématisés,
  3 PNG et 3 WEBM. Supprimer `.last-run.json`; tout fichier, champ ou durée
  inattendu remet le compteur à zéro.
- Impact : les deux premières séries du contre-audit T6 sont invalidées sans
  retry. La série QA `series_f4ec3e800c0c0dfa76455a24` requalifie 3/3 le
  candidat `candidate_e9d7884f850fb105e3cc290c` et l'environnement
  `environment_0f52328722a31843a91e9d4b`, avec 573/573 Vitest, 30/30 hors live
  et aucun finding restant.

## D-046 - La surface élève masque la complexité sans retirer les preuves

- Décision : organiser l'expérience publique autour de trois verbes — ajouter,
  construire, comprendre — avec une seule action principale par étape. Employer
  un langage élève dans les titres et états, puis placer transport, fiabilité et
  preuves techniques dans des zones secondaires repliables mais inspectables.
- Raison : les frontières T1 à T6 sont nécessaires à la sûreté et à la
  démonstration, mais leur exposition permanente faisait lire le prototype
  comme un banc développeur. La hiérarchie produit doit rendre la prochaine
  action évidente sans affaiblir le contrôle jury.
- Impact : le shell, la palette, les composants photo/canvas/coach et les états
  vides forment une surface responsive unique. Les noms accessibles utiles aux
  gates restent stables lorsque le libellé visible est simplifié. Aucun contrat
  d'exercice, modèle, permission, autorité pédagogique, stockage ou protocole
  Realtime n'est modifié par T7; tout changement visuel doit encore passer Axe,
  clavier, reduced motion, 200 % et les viewports 390/768/1440.

## D-047 - Compass bilingue par contexte client éphémère

- Décision : adopter `Compass` comme seule marque publique et fournir EN/FR par
  un contexte React client partagé. Le contrôle de langue est un bouton à
  drapeau dans le header; il met aussi à jour l'attribut `lang` du document.
- Raison : le prototype possède une page et une session mémoire uniques. Une
  infrastructure de routes localisées ou une dépendance i18n ajouterait de la
  complexité sans bénéfice pour ce périmètre, tandis qu'un contexte typé garde
  la copie cohérente dans les composants déjà montés.
- Impact : l'anglais reste la valeur initiale déterministe, le français est
  activé explicitement et aucune préférence n'est persistée. La marque interne,
  les packages `@geotutor/*`, les globals `__GEOTUTOR_*`, les payloads, preuves
  et textes libres issus des modèles ne sont pas renommés ni traduits. Toute
  nouvelle copie publique doit fournir ses deux variantes et passer les mêmes
  gates responsive/accessibilité.

## D-048 - Mascotte pilotée par événements applicatifs fermés

- Décision : représenter Compass par un mentor humain original et un atlas local
  8 × 9 contenant huit frames pour chacun des états `idle`, `receiving`,
  `thinking`, `listening`, `speaking`, `modifying`, `hinting`, `celebrating` et
  `error`. Le contrôleur de présentation reçoit seulement des événements fermés
  émis aux frontières React existantes.
- Raison : une présence visuelle rend la session plus incarnée, mais une
  animation déduite d'un transcript, d'un timer arbitraire ou d'un état réseau
  approximatif pourrait mentir à l'élève sur ce que fait réellement Compass.
- Impact : l'atlas est statique et local; il ne déplace aucune autorité T1 à T8.
  Les sources photo, Realtime, outil et hint publient des signaux bornés avec
  priorité et cleanup. `prefers-reduced-motion` conserve la première frame et
  un libellé bilingue rend l'état compréhensible sans mouvement.

## D-049 - Deux entrées photo et configuration locale chargée par le lanceur

- Décision : afficher une action de choix de fichier sans attribut `capture` et
  une action caméra distincte portant `capture="environment"`; les deux entrées
  convergent vers la même validation et le même aperçu en mémoire. Le script
  racine `pnpm dev` charge `.env` avant de lancer Next.js.
- Raison : un contrôle unique avec `capture` varie selon le navigateur mobile et
  rend le choix galerie/caméra ambigu. Next.js lancé depuis `apps/frontend` ne
  charge pas automatiquement le `.env` de la racine, ce qui faisait échouer la
  route image malgré une clé valide.
- Impact : la permission caméra reste déclenchée par le navigateur après un geste
  explicite. `OPENAI_API_KEY` demeure exclusivement dans l'environnement serveur;
  aucun média, choix de langue ou secret n'est persisté.

## D-050 - Mode généraliste par défaut et modules spécialisés optionnels

- Décision : la route photo publique produit une enveloppe générique bornée pour
  tout exercice scolaire lisible. La matière n'est jamais un motif de rejet;
  seules l'illisibilité, l'incomplétude ou une contradiction déclenchent une
  clarification. Après confirmation, le profil Realtime `general_tutor` reçoit
  l'énoncé comme item utilisateur délimité et fonctionne avec `tools:[]`.
- Raison : remplacer la médiatrice par une autre liste de templates déplacerait
  seulement le blocage. Un socle conversationnel général donne une continuité à
  l'élève, tandis que les modules déterministes gardent leur valeur lorsqu'ils
  correspondent réellement à l'exercice.
- Impact : le module médiatrice historique, ses preuves et ses tests restent
  conservés mais ne sont plus la surface publique par défaut. Le coach général
  ne peut ni lire une construction, ni muter GeoGebra, ni affirmer une validation
  automatique. Le texte extrait reste une donnée non fiable, bornée et en mémoire.

## D-051 - Quatre écrans et support contextualisé non autoritaire

- Décision : faire de l'accueil, de l'acquisition, de la vérification et de
  l'atelier quatre états de navigation locaux exclusifs. L'atelier place la
  mascotte et le coach en tête, puis choisit un support à partir de l'enveloppe
  confirmée. Les mathématiques et la géométrie obtiennent un applet GeoGebra
  vierge distinct du module médiatrice.
- Raison : l'empilement de toutes les étapes dans une page longue masque la
  transition de l'analyse vers l'action et fait disparaître visuellement le
  canevas lorsque la voix démarre. Un support libre est utile à l'élève sans
  transformer la matière en permission d'outil ou en preuve.
- Impact : la navigation, le focus et le reflow appartiennent uniquement à la
  présentation. Le profil général reste sans outil et ne lit pas l'applet. Le
  tableau libre ne crée ni A/B/AB, ni score, ni listener métier; seul le mode
  explicite `?specialist=geometry` monte les autorités spécialisées historiques.

## D-052 - Profil GeoGebra contextuel et outils sémantiques fermés

- Décision : introduire un profil Realtime `geogebra_tutor` distinct du profil
  général. Il sait que l'élève travaille dans l'applet intégrée et peut appeler
  seulement `inspect_geogebra_workspace`, `draw_geogebra_line`,
  `draw_geogebra_ray` ou `draw_geogebra_segment`. Les mutations exigent deux
  points existants, une demande explicite et un budget d'une action par tour.
- Raison : une conversation qui recommande une règle physique ou qui ne peut
  agir quand l'élève demande « trace la droite » rompt la continuité entre le
  coach et l'outil visible. Une commande GeoGebra générique serait inversement
  trop large et impossible à qualifier.
- Impact : l'application exécute les outils et renvoie leur résultat via la
  boucle Realtime existante. L'inventaire est borné; les arguments, labels,
  couleurs, phase, autorité, budget et idempotence sont validés localement.
  L'outil peut assister une construction mais ne produit aucune preuve de
  correction et ne crée, déplace, supprime ou renomme jamais un point élève.

## D-053 - Scène panoramique, missions honnêtes et réactions finies

- Décision : composer l'atelier GeoGebra en une seule colonne pleine largeur :
  coach horizontal au-dessus, applet dominant puis rail de missions persistant.
  Un contrôle GeoGebra visible n'est jamais neutralisé au seul motif que sa
  bibliothèque lui donne `aria-hidden`; seuls les sous-arbres réellement
  masqués deviennent inertes. La mascotte panoramique utilise une image propre,
  regarde le plan et les animations de la présence flottante jouent une fois.
- Raison : le split vertical réduisait la surface de manipulation, la boucle de
  sprite paraissait mécanique et la garde d'accessibilité bloquait les vrais
  outils. Le rail doit encourager l'exploration sans simuler une réussite.
- Impact : les missions peuvent être consultées librement, mais `vérifié` et XP
  ne progressent que depuis un ensemble d'indices déterministes. Le navigateur
  garde un geste explicite pour le micro. L'observation live du monde GeoGebra
  et les actions supplémentaires restent séparées dans T14-C02.

## D-054 - Monde GeoGebra borné, progression déterministe et voix Compass

- Décision : publier au profil `geogebra_tutor` un snapshot initial de quarante
  objets maximum puis des deltas stabilisés, sans `response.create` implicite.
  Étendre le gateway à dix fonctions sémantiques fermées, dont création et
  déplacement de point, renommage, style, cercle et polygone. Les missions
  observables sont vérifiées dans l'ordre et rapportent 20 XP chacune.
- Raison : le coach devait connaître le plan réel, pouvoir renommer un objet et
  récompenser une relation effectivement construite. Confier ces décisions au
  modèle ou exposer `evalCommand` aurait rendu l'état, le score et les mutations
  non qualifiables.
- Impact : le monde transmis est une observation applicative non injonctive; il
  ne déclenche aucune réponse. Le budget reste d'une mutation par tour et les
  arguments supplémentaires sont rejetés. La sixième tâche écrite de l'exercice
  reste non vérifiée tant qu'aucune preuve structurée n'existe. La voix Realtime
  devient `cedar`, recommandée par le fournisseur, avec une consigne de tuteur
  adulte chaleureuse; aucun genre n'est présenté comme une garantie du modèle.

## D-055 - XP transversal comme ledger monotone de session

- Décision : indexer chaque crédit par confirmation et tâche, accorder 10 XP à
  une mission déclarée terminée et remplacer ce palier par 20 XP lorsqu'une
  preuve déterministe existe. Un crédit acquis n'est jamais retiré en session.
- Raison : rendre la progression motivante dans toutes les matières sans
  confondre effort déclaré, correction et notation.
- Impact : aucun modèle n'attribue de points; le ledger reste mémoire,
  idempotent, cumulatif entre exercices et vide après rechargement.

## D-056 - Équipe pédagogique virtuelle sans multiplication des appels

- Décision : utiliser un unique appel Responses `gpt-5.6-luna` à effort faible,
  `store:false`, sans outil et avec sortie structurée. Les rôles didacticien,
  adaptateur de difficulté, contrôleur de sécurité et contrôleur de coût sont
  des validateurs locaux appliqués au même brouillon.
- Raison : une conversation multi-agent ou plusieurs passes modèle augmentent
  coût et latence sans être nécessaires pour un exercice borné et relu par le
  professeur. Luna vise les charges sensibles au coût et supporte texte, image
  et Structured Outputs.
- Impact : une action professeur déclenche au plus un appel. Toute validation
  locale échouée garde le brouillon non publié et affiche les corrections à
  effectuer; aucune boucle autonome ne relance le modèle.

## D-057 - Catalogue professeur partagé mais éphémère

- Décision : stocker au plus 64 exercices publiés dans la mémoire du processus
  Next.js et les exposer par un contrat GET/POST fermé, sans authentification.
- Raison : démontrer le passage professeur → élève sans anticiper le modèle de
  classes, d'identité ou la base de données exclu de cette tranche.
- Impact : tous les visiteurs du même processus voient le même catalogue; un
  redémarrage l'efface. L'UI annonce cette limite et aucune donnée personnelle
  d'élève n'est demandée.

## D-058 - Les mécanismes IA restent invisibles dans la surface professeur

- Décision : conserver modèle, budget d'appels, schémas et validateurs dans le
  backend et la documentation, mais présenter au professeur uniquement trois
  actions métier, des aides de saisie et trois critères de relecture utiles.
- Raison : un enseignant doit savoir quoi fournir et ce qui sera partagé, pas
  comprendre l'orchestration ou le coût unitaire de l'infrastructure.
- Impact : la sécurité et la frugalité de T16-C01 ne changent pas. Le contrôle
  de coût reste exécuté mais n'est pas rendu; les mentions de serveur,
  prototype, modèle et appels disparaissent des surfaces professeur et élève.
  Cette décision remplace uniquement l'obligation d'annonce UI de D-057.

## D-059 - Démo Vercel isolée et éphémère

- Décision : héberger les démonstrations non commerciales dans le projet Vercel
  isolé `compass-geotutor-demo`, avec le preset `nextjs` explicite et la clé
  OpenAI chiffrée uniquement dans les environnements serveur Preview et
  Production. `.vercel/`, `.env.local` et les jetons de liaison restent ignorés.
- Raison : obtenir une URL HTTPS gratuite compatible caméra, microphone,
  fonctions Next.js et WebRTC, sans modifier les deux projets Vercel existants
  ni ajouter une base de données au prototype.
- Impact : l'alias stable `.vercel.app` est public alors que les URLs immuables
  restent sous le SSO de l'équipe. Catalogue professeur, XP et contexte restent
  éphémères; l'URL ne doit pas être diffusée largement avant ajout d'un code
  d'accès et d'un rate limit applicatifs sur les routes payantes.

## D-060 - Boucle d'apprentissage anonyme de session

- Décision : conditionner les 10 XP auto-déclarés à une note locale de démarche,
  conclure l'exercice par une question de transfert et n'exporter vers l'espace
  professeur qu'un `learning_session_report.v1` fermé. Ce bilan contient
  uniquement exercice professeur, compteurs terminé/vérifié, XP, nombre de
  démarches et statut du transfert; les textes libres ne quittent pas le
  workspace élève.
- Raison : un clic nu mesure mal l'effort, tandis qu'un historique nominatif ou
  le contenu des réponses dépasserait le prototype et augmenterait le risque
  données. Le jury doit néanmoins pouvoir observer une boucle pédagogique
  complète et honnête dans une démonstration locale.
- Impact : aucun modèle ne note, ne résume ou n'attribue les XP. Les rapports et
  publications de secours vivent seulement dans l'état React de l'onglet; le
  catalogue serveur reste disponible mais n'est plus l'unique chemin de la démo
  sur une plateforme serverless. L'UI annonce explicitement session courante,
  anonymat, absence de note et absence de persistance.

## D-061 - Les contrôles professeur nomment leurs preuves réelles

- Décision : présenter les validateurs locaux comme structure des étapes,
  contexte d'accompagnement et scan de formulations à risque, avec une copie
  décrivant exactement la règle calculée. Le coach GeoGebra demande en outre au
  learner d'identifier les objets et la relation visée avant une mutation.
- Raison : `progression claire`, `aide adaptée` et `prêt à partager` suggéraient
  une évaluation pédagogique ou de sécurité plus large que les tests réellement
  exécutés.
- Impact : le schéma, le plafond d'un appel et les permissions ne changent pas.
  Une validation locale autorise toujours la publication, mais ne devient ni une
  certification didactique, ni une garantie de niveau, ni une modération globale.
