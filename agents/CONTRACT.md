# Contrat Builder — T7 Expérience étudiant — en cours

## État actif

- Le besoin produit prioritaire devient une application destinée à l'élève,
  extrêmement simple et intuitive, avec une direction visuelle jeune, moderne
  et engageante. La surface actuelle de démonstration technique doit être
  transformée sans modifier les autorités pédagogiques T1 à T6.
- Ordre : T7-C01 architecture d'information et langage élève → T7-C02 système
  visuel et composition responsive → T7-C03 finition des états, diagnostics
  repliables et qualification navigateur.
- Carte active : T7-C01. Une carte est relue et vérifiée avant d'ouvrir la
  suivante.
- La remédiation QA T3 préexistante reste une dette conservée : T3-C01 et
  T3-C04 sont closes; T3-C06 était la prochaine carte. Elle n'est pas déclarée
  résolue par T7.

## Périmètre contractualisé

- Remplacer la page de démonstration technique par un shell produit destiné à
  l'élève : marque, promesse claire, progression en trois étapes et action de
  départ immédiatement identifiable.
- Réécrire les titres, aides et états visibles en langage simple sans supprimer
  les noms accessibles et contrats dont dépendent les parcours automatisés.
- Recomposer photo, confirmation, GeoGebra, progrès, aide, expérience
  d'équidistance et coach vocal dans une hiérarchie cohérente.
- Déplacer fiabilité, transport, preuves et détails de qualification dans des
  zones secondaires repliables, toujours inspectables pour le jury.
- Définir un système visuel responsive dans la stack CSS existante : typographie
  expressive, palette chaude à accent unique, profondeur légère, interactions,
  focus, reduced motion et états vides soignés.

## Hors périmètre actif

- Nouveau template d'exercice, changement de modèle, nouvelle capacité
  T1/T2/T3/T4/T5/T6, persistance, commande GeoGebra arbitraire et résolution de
  la réserve live T2-C01 ou de la remédiation T3 reportée.
- `QA_REPORT.md` côté Builder et `HANDOFF.md` sans reprise réelle.

## Gates de clôture

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend exec playwright test --grep-invert @live
```

La clôture exige aussi une inspection réelle à 390 × 844, 768 × 1024 et
1440 × 900, un parcours clavier, l'absence de débordement horizontal et des
captures montrant l'arrivée et le workspace. Les détails techniques restent
présents mais ne doivent plus dominer l'expérience élève.

## Archive — état T6 avant réouverture T3

- T5-C01 à T5-C07 sont closes le 15 juillet 2026 avec verdict `pass`.
- Le gate final commun passe avec le vrai applet, restauration exacte, fallback
  déconnecté, accessibilité et smoke credentialed OOB texte-only.
- T6 est close le 15 juillet 2026 avec verdict `pass`. L'ordre T6-C01 →
  T6-C02 → T6-C03 → T6-C04 → T6-C05 → T6-C06 → T6-C07 a été respecté.
- T6-C01 est close avec verdict `pass` : autorité unique de reset, annulations
  attendues, restauration vérifiée, fallback depuis le plan confirmé et fatal
  réessayable. Les gates rendent 487/487 tests Vitest et 20/20 Playwright hors
  live, dont 2/2 scénarios T6-C01 sur le vrai applet.
- T6-C02 est close avec verdict `pass` : les trois modes sont visibles et
  fermés, le texte live fonctionne sans micro/audio, le local n'appelle aucun
  modèle et les reconnexions restent manuelles, sûres et bornées.
- T6-C03 est close avec verdict `pass` : registre central, priorité totale,
  guards aux quatre frontières d'effet, quarantaine et watchdog borné. Les
  gates rendent 538/538 Vitest et 25/25 Playwright hors live.
- T6-C04 est close avec verdict `pass` : schéma fermé, corrélations, durées,
  allowlist/redaction, ring buffer et lifecycle reset/session. Les gates rendent
  541/541 Vitest et 26/26 Playwright hors live.
- T6-C05 est close avec verdict `pass` : erreurs fermées, retry/timeouts bornés,
  distributions p50/p95 et fallbacks explicites, scans secrets et preuve de
  reflow. Les gates rendent 559/559 Vitest et 27/27 Playwright hors live.
- T6-C06 est close avec verdict `pass` : candidat HTTPS reproductible,
  permissions cohérentes, accessibilité A/AA, attributions visibles et parcours
  dégradés honnêtes. Les gates rendent 563/563 Vitest, 29/29 Playwright hors
  live et 2/2 sur le serveur HTTPS.
- T6-C07 est close avec verdict `pass` : le gate lie candidat et environnement,
  exécute le préflight complet, puis exige trois golden journeys live isolés,
  séquentiels et sans retry. La série finale passe 3/3.
- Les contre-audits QA indépendants T5 et T6 sont clos avec verdict `pass`.
  T5 a corrigé un statut README stale. T6 a corrigé l'annulation des sessions
  avant promotion/typed, les guards de mutation reset, la dérive d'environnement
  et l'inventaire fermé des preuves, puis a requalifié une série neuve 3/3.
- Chaque carte est confiée à un sous-agent distinct, puis relue et vérifiée par
  le Builder principal avant ouverture de la suivante.
- T0 à T4 restent implémentées. La réserve live T2-C01 demeure ouverte : après
  migration du banc vers l'entrée texte explicite, le gate credentialed du
  15 juillet rend 2/4 (`response.done`/cleanup et Stop passent; VAD multi-tour
  et continuation outil expirent). Elle ne bloque pas les gates déterministes T5.

## Tranche contractualisée — T6-C07 — close

### Inclus

- Protocole fermé de golden journey live photo → confirmation → construction →
  voix → invariance → synthèse → reset, avec manifest expurgé par run.
- Trois parcours complets consécutifs, liés au même commit et au même
  environnement; tout échec, flake, changement ou preuve manquante remet le
  compteur à zéro.
- Vrais GeoGebra et services configurés, sans `scripted_local`; préflight,
  captures, evidence logs et verdict final inspectables.

### Hors périmètre

- Conformité commerciale GeoGebra, SLA production, analytics persistants,
  interface enseignant et refonte des frontières T6-C01 à T6-C05.
- IndexedDB, historique persistant, commande GeoGebra générique et second
  exercice. Aucun run partiel n'est toléré dans le compteur.

### Gates requis avant clôture

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend exec playwright test --grep-invert @live
```

Les conditions de clôture sont satisfaites : trois manifests live consécutifs
sur le même candidat, captures/vidéos et journaux expurgés, absence de secret,
verdict final de T6 et pilotes resynchronisés.

## Archive du contrat T6-C07

### Inclus et vérifié

- `pnpm gate:t6:live` calcule une empreinte déterministe des sources exécutables
  et une identité d'environnement expurgée, exécute les cinq gates de préflight,
  puis lance trois processus Playwright `@live` isolés, un worker, zéro retry.
  Un échec, une preuve manquante ou une dérive d'identité remet le compteur à
  zéro et interdit le verdict.
- Chaque run utilise la route image réelle, le vrai applet GeoGebra, une session
  WebRTC Realtime avec piste micro navigateur, une intervention vocale avec
  audio distant, puis une synthèse OOB texte-only. Les neuf étapes exigent
  SILENT sans `response.create`, SPEAK L1 au bloc répété, correction 2/2,
  invariance 5/5, reset A/B/AB exact et ressources fermées.
- Le profil Realtime reste strict. Si le serveur annonce initialement seulement
  `create_response:true` au lieu du `false` demandé, le client réaffirme une
  unique fois le profil VAD verrouillé par `session.update`, attend un
  `session.updated` strict, puis échoue fermé pour toute autre divergence.
- Les manifests n'acceptent que des preuves fermées. Les traces réseau
  Playwright sont désactivées car elles embarquent le SDP brut; les artefacts
  autorisés sont JSON, PNG et WEBM.

### Preuves obtenues le 15 juillet 2026

- Série QA finale `series_f4ec3e800c0c0dfa76455a24`, 3/3 consécutifs sans
  retry, candidat `candidate_e9d7884f850fb105e3cc290c`, empreinte source
  `71820d78ab32b0f45ea5ce936e1e3dab1030b3d46ace637ab49dcbe429890bbc`
  sur 153 fichiers, environnement `environment_0f52328722a31843a91e9d4b`.
- Base HEAD `9692a31f0a397b3936667ed3685145c6a66a6b83`, arbre local non commité.
  Le préflight passe lint, typecheck, build, 573/573 tests Vitest sur 51 fichiers
  et 30/30 scénarios Playwright hors live.
- `output/playwright/T6-C07/` contient trois manifests complets, le verdict et
  l'état de série, trois captures et trois vidéos. L'inventaire fermé de 12
  fichiers (6 JSON, 3 PNG, 3 WEBM) trouve 0 motif secret et 0 trace/ZIP/SDP;
  la capture terminale montre A/B/AB, progression 0/2 et transport/micro déjà
  fermés par le Reset terminal.
- Le harness est une qualification automatisée locale avec piste micro
  synthétique et certificat auto-signé. Le certificat de confiance et le micro
  physique demeurent des contrôles de préparation jury, sans remettre en cause
  le gate candidat automatisé.

## Archive du contrat T6-C06

### Inclus et vérifié

- Le candidat production possède un serveur HTTPS TLS 1.2 reproductible qui
  exige certificat/clé hors bundle. Les headers limitent microphone et caméra
  au same-origin; le runbook sépare certificat local de test et certificat de
  confiance jury.
- Skip-link, focus, statuts, reflow, reduced motion, quatre viewports et modes
  dégradés sont testés. Le refus microphone reste local, propose le texte et ne
  provoque aucun retry modèle automatique.
- La garde GeoGebra réversible rend inertes les sous-arbres cachés, normalise
  tab order, vrais disabled, icônes décoratives et panneau scrollable; axe
  inspecte le vrai applet sans exclusion.
- Attribution GeoGebra, licence et mention non-commerciale sont permanentes;
  l'usage commercial reste bloqué avant accord séparé.

### Preuves obtenues le 15 juillet 2026

- 563/563 tests Vitest sur 50 fichiers, lint, typecheck et build passent.
  Playwright hors `@live` passe 29/29; le candidat HTTPS passe 2/2 avec axe
  A/AA, arbre ARIA, clavier, permission refusée et viewports jury/mobile.
- Lighthouse indicatif rend accessibilité 1,00, bonnes pratiques 1,00 et
  performance 0,73 (FCP 963 ms, LCP 2,80 s, TBT 952 ms, CLS 0). HTML et bundle
  statique ne contiennent ni secret, jeton, ni variable serveur.
- Les captures `output/playwright/T6-C06-*.png`, le snapshot ARIA et
  `docs/DEMO_RUNBOOK.md` consignent environnement et limites. Base HEAD
  `9692a31f0a397b3936667ed3685145c6a66a6b83`, arbre local non commité; le
  certificat auto-signé n'est pas présenté comme certificat jury.
- Le gate credentialed 3/3, les vrais manifests live et le verdict final restent
  explicitement T6-C07.

## Archive du contrat T6-C05

### Inclus et vérifié

- Les deux routes serveur renvoient une enveloppe `AppError` fermée contenant
  seulement domaine, code, retryabilité, message sûr et correlation ID. Aucun
  corps amont n'est lu sur erreur ni propagé au client ou aux logs.
- 401/403 et 429 ne sont jamais retentés automatiquement. 429 expose un
  `Retry-After` borné 1–5 s; 5xx a au plus un retry après 50 ms. Les timeouts
  globaux restent 20 s pour Responses/image et 12 s pour Realtime/session.
- `LatencyBudgetMonitor` garde au plus 64 durées par chemin et expose p50/p95
  pour image 20 s, feedback local 250 ms, session 12 s, premier audio 5 s et
  outils 2 s, avec un fallback fermé par budget et aucun payload.
- Le dépassement session/first audio ferme la ressource live et revient dans un
  mode explicite. Le plafond outil couvre le lot complet et interdit output ou
  continuation tardifs. La surface accessible ne présente jamais un chemin non
  mesuré comme réussi.

### Preuves obtenues le 15 juillet 2026

- 123/123 tests ciblés, 559/559 tests Vitest sur 49 fichiers, lint sans
  avertissement, typecheck et build passent. Playwright hors `@live` passe
  27/27; le CLI Playwright sur le build production rapporte zéro erreur console.
- Le vrai parcours navigateur mesure image 28 ms, feedback 0 ms, session 15 ms
  et premier audio 5 001 ms, puis rend le fallback `typed_live` et la raison
  `latency_budget_exceeded`. Le test outil à 2 001 ms publie zéro output et zéro
  continuation.
- Le scan du bundle statique, de la clé configurée dans les bundles, des noms
  d'environnement publics et des logs de production passe. Les tests de route
  injectent des corps amont sensibles sans les retrouver dans réponse ou log.
- Capture inspectée :
  `output/playwright/T6-C05-latency-fallback-zoom-200.png`. Le parcours live
  credentialed et le gate 3/3 restent explicitement T6-C07. Arbre de travail
  local non commité au moment de ces preuves.

## Archive du contrat T6-C04

### Inclus et vérifié

- `EvidenceLogEntry` expose exactement timestamp, run, action optionnelle,
  révision, kind, corrélations, statut et durée. Les décisions SILENT/QUEUE/SPEAK
  sont des kinds fermés; directive, réponse, call, opération et preuves restent
  uniquement des IDs allowlistés.
- Les spans réponse/outil calculent leur durée; action, décision, preuve,
  annulation, modes de capacité et quatre frontières de l'arbitre partagent le
  même run. L'export debug est volontaire, immuable et versionné.
- Le ring buffer mémoire est borné à 512 entrées, borne aussi les spans et les
  listes de preuve, compte chaque entrée dropped, puis se vide et change de run
  après reset réussi ou fin de session Realtime.
- Les inconnus et payloads libres ne sont jamais copiés; champs requis invalides
  sont rejetés et IDs optionnels trop longs sont retirés sans bloquer la preuve.

### Preuves obtenues le 15 juillet 2026

- 101/101 tests ciblés, 541/541 tests Vitest sur 46 fichiers, lint, typecheck et
  build passent. Playwright hors `@live` passe 26/26.
- Le scénario C04 sur le vrai applet produit SILENT puis SPEAK, relie chaque
  décision à une action et deux preuves, observe les operation IDs aux commits
  UI/Realtime puis un export vide, dropped zéro et nouveau run après Reset.
- Les fixtures sensibles injectent texte élève, nom, audio, image/data URL, SDP,
  clé et payload outil brut; le scan de l'export ne retrouve aucun de ces champs
  ou contenus. Aucun stockage persistant ni envoi distant n'est ajouté.
- Arbre de travail local non commité au moment de ces preuves.

## Archive du contrat T6-C03

### Inclus et vérifié

- `OperationArbiter` délivre des
  `OperationToken{id,kind,epoch,revision,priority,abort}` immuables et applique
  reset > parole utilisateur > drag/action > outil sans file ni reprise
  implicite. Une priorité supérieure abort les inférieures ; une arrivée
  inférieure est rejetée.
- Les frontières `geogebra_mutation`, `ui_commit`, `realtime_emit` et
  `tool_publish` revalident autorité, epoch et révision. Le workspace partage
  la même instance entre GeoGebra et Realtime.
- Drag/action garde validation, rendu et émission proactive. Parole garde ses
  commits du start au stop. La boucle outil compose le signal, garde handler,
  output et continuation. Reset est dédupliqué et possède l'autorité maximale.
- Un handler non coopératif ne bloque plus le timeout ; résultat tardif et token
  oublié sont quarantainés, puis le watchdog rend le registre sans pending.

### Preuves obtenues le 15 juillet 2026

- 70/70 tests ciblés, 538/538 tests Vitest sur 46 fichiers, lint, typecheck et
  build passent.
- Playwright hors `@live` passe 25/25. Le scénario C03 sur le vrai applet
  ralentit `setBase64`, injecte une mutation tardive, reconstruit exactement
  A/B/AB et observe `pending:[]` avec les commits reset attendus.
- Les 24 permutations, délais variables, quatre frontières, stale, priorité
  égale, quarantaine et watchdog sont couverts. Aucun secret, texte, audio,
  image, SDP ou payload outil brut n'entre dans la trace.
- Arbre de travail local non commité au moment de ces preuves.

## Archive du contrat T6-C02

### Inclus et vérifié

- `CapabilityMode{kind,reason,since}` ne possède que `live_voice`, `typed_live`
  et `scripted_local`; toute montée live suit une action utilisateur et une
  session effectivement vérifiée.
- `live_voice` exige peer, data channel, microphone et piste audio distante.
  `typed_live` réutilise le peer et `oai-events`, sans `getUserMedia`, avec une
  m-line audio inactive de compatibilité transport et une session
  `output_modalities:["text"]`, `tools:[]`, `tool_choice:"none"`.
- `scripted_local` est le mode par défaut et n'ouvre aucun transport modèle. La
  construction, la validation, l'invariance et leurs fallbacks locaux restent
  disponibles lors des pannes, refus micro et offline.
- Une panne redescend en local sans nouvelle requête. Les boutons live exigent
  une action, un état pédagogique sûr et le backoff observable 1/2/4/5 s,
  plafonné à 5 s sans boucle automatique.

### Preuves obtenues le 15 juillet 2026

- 61/61 tests ciblés finaux, 507/507 tests Vitest sur 45 fichiers, lint,
  typecheck et build passent.
- Playwright hors `@live` passe 24/24, dont 4/4 scénarios C02 : zéro réseau
  local, requête typed réelle, permission micro refusée, panne de route,
  offline, perte du channel et absence de retry automatique.
- Le smoke credentialed `typed_live` passe 1/1 : aucun appel micro, une réponse
  `response.done` texte-only, aucun événement audio et aucun flux attaché. Une
  première offre data-only rejetée `invalid_offer` a conduit à la m-line audio
  inactive confirmée par le schéma officiel `/v1/realtime/calls` et le live.
- Les trois badges ont été capturés sous `output/playwright/T6-C02-*.png`; le
  CLI Playwright headed confirme aussi le mode local permanent et ses preuves.
- Arbre de travail local non commité au moment de ces preuves; aucun secret,
  SDP complet, texte utilisateur ou donnée sensible n'est consigné.

## Archive du contrat T6-C01

### Inclus et vérifié

- `reset(reason)` partage le mutex d'initialisation, avance l'epoch avant toute
  annulation et attend opérations, réponses/audio/outils, aides et pipeline
  pédagogique avant restauration.
- Le bridge suspend ses listeners autour de `setBase64`; la voie exacte exige
  hash, inventaire et registre identiques puis exactement quatre listeners.
- Un checkpoint absent ou corrompu déclenche seulement la reconstruction
  canonique A/B/AB depuis le plan confirmé, suivie d'une recapture, réécriture,
  revalidation et promotion du checkpoint.
- Si restauration et reconstruction échouent, ou si aucun plan confirmé ne peut
  autoriser le fallback, l'état est `fatal`, explicite et `retryable:true`.
- Les réponses OOB en vol sont annulées par ID, puis l'audio est vidé; un
  terminal tardif ne rend ni résumé modèle ni fallback après le reset.

### Preuves obtenues le 15 juillet 2026

- 75/75 tests ciblés, 487/487 tests Vitest sur 44 fichiers, lint, typecheck et
  build passent.
- Playwright hors `@live` passe 20/20. Deux scénarios T6-C01 sur le vrai applet
  couvrent double reset pendant une opération active et corruption volontaire
  de la première restauration avec fallback confirmé.
- Le contrôle interactif via le CLI Playwright confirme l'applet chargée, le
  bouton Reset accessible et le retour visible au contexte initial.
- Arbre de travail local non commité au moment de ces preuves; aucune donnée
  sensible ni secret n'est consigné.

## Archive du contrat T5

### Inclus

- T5-C01 : opération applicative fermée `run_invariance_test`, cinq paramètres
  fixes, préconditions score 2/2, révision et preuves courantes.
- T5-C02 : scène temporaire namespacée, checkpoint, cleanup et restauration
  exacte du travail élève sur succès, erreur ou annulation.
- T5-C03 : cinq mesures finies PA/PB, tolérance versionnée, preuve par sample et
  agrégation vraie uniquement pour 5/5.
- T5-C04 : verbalisation de généralisation uniquement après un 5/5 courant,
  complet et non stale.
- T5-C05 : synthèse texte Realtime hors conversation avec
  `conversation:"none"`, `output_modalities:["text"]`, `tools:[]`, metadata de
  routage et fallback déterministe.
- T5-C06 : progression accessible 1/5–5/5, tableau des mesures, annulation
  clavier et respect de `prefers-reduced-motion`.
- T5-C07 : gate de fermeture réunissant vrai applet, rollback, cleanup, OOB,
  fallback et accessibilité sur le même candidat.

### Hors périmètre

- Échantillonnage ou commande GeoGebra arbitraire choisis par le modèle.
- Preuve symbolique universelle de l'invariance.
- Persistance des helpers, images, checkpoints, mesures ou synthèses.
- Reconnexion globale, arbitre exhaustif des courses, déploiement jury et gate
  live 3/3, qui appartiennent à T6.
- Refonte UI générale, dashboard enseignant ou second exercice.

### Fichiers touchés ou vérifiés

- `apps/frontend/lib/invariance/**`
- `apps/frontend/lib/geogebra/{adapter,checkpoint,scene,snapshot}*`
- `apps/frontend/lib/realtime/**`
- `apps/frontend/lib/pedagogy/{directive,evidence-log,cancellation}*`
- `apps/frontend/components/**` et `apps/frontend/e2e/**`
- cartes T5, pilotes, roadmap et architecture

### Documentation OpenAI vérifiée

- Guide Realtime « Create responses outside the default conversation » : une
  réponse OOB utilise `response.conversation:"none"`, peut fournir un contexte
  `input` propre et se route via `metadata` jusqu'à `response.done`.
- Référence `response.create` : `output_modalities:["text"]` désactive l'audio,
  `tools:[]` remplace les outils de session pour cette réponse et `event_id`
  peut corréler l'événement client.
- Référence `response.done` : l'événement est toujours émis; seul le statut
  `completed` est un succès, les statuts cancelled/failed/incomplete imposent
  le fallback.
- Guide WebRTC : la clé standard reste côté serveur et les événements applicatifs
  transitent par le data channel `oai-events`.

### Vérification prévue

Pour chaque carte : tests ciblés, puis gates applicables avant passage à la
suivante. Le gate T5 final comprend au minimum :

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend exec playwright test --grep-invert @live
```

Les preuves doivent couvrir 5/5 nominal, médiatrice incorrecte, NaN/instabilité,
collision helper, exception, annulation, hash avant/après, réponse OOB concurrente,
stale, panne Realtime, clavier, reduced motion et zoom 200 %. Les scénarios
credentialed et vrai applet sont rapportés factuellement; une dépendance amont
manquante ou instable ne doit jamais être présentée comme passée.

### Vérification obtenue

- T5-C01 : l'opération interne relit candidat, révision, score 2/2, preuves et
  tuples canoniques avant/après chaque sample. Le nominal retourne cinq samples
  et cinq IDs uniques; un sample métier faux produit cinq samples avec
  `pass:false`; entrée invalide, stale, NaN, corrélation invalide, exception et
  annulation retournent `samples:[]`, `evidenceIds:[]` et `pass:false`.
- Le 15 juillet 2026, 22/22 tests ciblés, 420/420 tests frontend sur 39 fichiers,
  lint, typecheck et build passent. La carte ne revendique ni scène GeoGebra,
  checkpoint, mesure réelle PA/PB, UI ou smoke navigateur, qui commencent en
  C02/C03/C06.
- T5-C02 : `InvarianceSceneService` capture Base64, hash, inventaire, registre,
  empreinte stricte des objets élève et quatre listeners avant de suspendre le
  bridge. Le scope fermé ne crée que des helpers `gtInv_<runId_normalisé>_*`
  pré-enregistrés `owner:"temporary"`; son `finally` supprime en ordre inverse,
  compare tous les invariants puis réconcilie les listeners. Collision,
  exception, annulation, mutation élève ou suppression incomplète restaurent le
  checkpoint par `setBase64`, reconstruisent le registre et réinscrivent les
  listeners avant de laisser C01 échouer ou s'annuler sans résultat partiel.
- Le 15 juillet 2026, 29/29 tests invariance ciblés passent sur deux fichiers,
  la suite frontend passe à 427/427 sur 40 fichiers, et lint, typecheck, build
  ainsi que 13/13 scénarios Playwright hors live passent. Le Playwright charge
  le vrai applet et protège les parcours T0–T4; C02 n'a pas encore de surface
  navigateur déclenchable, donc son rollback sur vrai applet reste une preuve
  attendue du gate T5-C07 et n'est pas revendiqué ici.
- T5-C03 : `GeoGebraInvarianceSampler` crée dans le scope C02 P contraint à la
  candidate, PA/PB, la distance à la candidate, l'origine projetée du milieu,
  le vecteur unitaire et l'échelle `Distance(A,B)`. Il applique les cinq
  paramètres C01 dans l'ordre avec `setCoords`, exige deux lectures stables à
  `1e-9` dans une fenêtre de huit lectures, puis dérive delta et pass sous la
  tolérance `absolute-distance-v1` de `1e-6`. Le contrat C01 rejette aussi tout
  delta, pass, tolérance ou version incohérent.
- L'intégration sur le vrai applet a remédié le préfixe C02 en `gtInv_` parce
  que GeoGebra 5.4.920.0 refuse les labels commençant par `_`; elle a aussi
  remplacé le path parameter non fini d'une droite par la position versionnée
  `projected-midpoint-distance-ab-v1`. La médiatrice correcte donne 5/5, une
  candidate décalée donne 0/5 et l'inventaire retrouve exactement A/B/AB.
- Le 15 juillet 2026, 43/43 tests invariance ciblés, 441/441 tests frontend sur
  41 fichiers, lint, typecheck et build passent. Le smoke T5-C03 vrai applet
  passe 1/1 et la suite Playwright hors live passe 14/14. NaN, point hors
  droite, instabilité, stale et annulation échouent tout-ou-rien avec
  restauration C02. C03 n'ajoute aucune UI, verbalisation ou synthèse.
- T5-C04 : `InvarianceVerbalizationCoordinator` valide le résultat C03,
  acquitte son view-model local, relit l'autorité puis consulte
  `decideInvarianceGeneralization`. La directive fermée v1 conserve run,
  révision, snapshot, action source, deux preuves d'autorité et cinq preuves de
  samples; elle est L1, sans outil, et possède un guard rejouable avant dispatch.
  `QUEUE` ne crée ni ne finalise de directive et peut être recalculé; une
  intervention prioritaire, un stale, 0–4/5, failed, cancelled ou duplicate
  reste silencieux. C04 n'envoie aucun événement Realtime.
- Le 15 juillet 2026, 16/16 tests C04, 92/92 tests invariance/policy/directives
  et 457/457 tests frontend sur 42 fichiers passent, ainsi que lint, typecheck
  et build. C04 n'ajoute ni synthèse OOB, UI C06 ni smoke navigateur.
- T5-C05 : `InvarianceOobSummaryCoordinator` exige le résultat C03 5/5 et la
  directive C04 concordante, re-gardée avant envoi puis avant rendu. Il émet
  uniquement `response.create` avec `event_id`, `conversation:"none"`, contexte
  neuf limité aux cinq mesures/preuves, `output_modalities:["text"]`,
  `tools:[]`, `tool_choice:"none"` et metadata string kind/runId/revision. Les
  maps event/response ID routent `response.created` et `response.done` sans
  passer par les owners audio existants. Le done doit être `completed`,
  conversation nulle, modalité texte et uniquement des parts `output_text`.
- Timeout, erreur corrélée, send impossible, fermeture, statut non completed,
  texte vide, payload invalide ou stale rendent le même fallback exact issu des
  cinq mesures. Aucun item de conversation, audio ou outil n'est produit; le
  contexte n'embarque ni snapshot/hash, deux preuves d'autorité, candidat ou
  transcript. Un run en vol ou terminal est dédupliqué.
- Le 15 juillet 2026, 16/16 tests C05, 42/42 tests C05 + WebRTC et 474/474 tests
  frontend sur 43 fichiers passent, ainsi que lint, typecheck, build et 14/14
  Playwright hors `@live`. Aucun scénario C05 credentialed n'est revendiqué;
  l'UI accessible et l'annulation visible commencent en C06.
- T5-C06 : `InvarianceExperiment` possède les états idle, running, completed,
  failed et cancelled. Il reçoit une interface runtime fermée dont `start`
  retourne le handle C01 et dont l'observer reçoit les samples finis C03. Le
  workspace compose réellement `RunInvarianceTestOperation`,
  `InvarianceSceneService` et `GeoGebraInvarianceSampler` avec le validator,
  checkpoint et bridge courants; Run reste désactivé sans autorité locale 2/2.
- La progression textuelle 1/5–5/5 accompagne un élément `progress`, et le
  tableau expose position, PA, PB, delta et pass. Les annonces live sont limitées
  au démarrage, à 3/5 et à l'issue, avec déduplication. Cancel appelle le handle
  C01; reset, stale et unmount annulent aussi. Le résultat final reçoit le focus,
  les sorties partielles sont retirées, et une transition seulement décorative
  est supprimée sous `prefers-reduced-motion`.
- Le 15 juillet 2026, 64/64 tests ciblés C06 + spike + invariance et 478/478
  tests frontend sur 44 fichiers passent, ainsi que lint, typecheck et build.
  Les 15/15 scénarios Playwright hors live passent. Le scénario C06 charge le
  vrai applet, crée une médiatrice, lance et annule au clavier, vérifie reduced
  motion, focus, annonce, reflow 200 % et absence de débordement. La capture est
  `output/playwright/T5-C06-completed-zoom-200.png`.
- T5-C07 : le workspace acquitte le rendu terminal C06 avant la policy C04,
  route la directive vers la méthode de session C05 et revalide run/révision
  avant affichage. Reset, nouvelle action, perte d'autorité et unmount retirent
  contexte et synthèse; une réponse tardive ne peut pas les ressusciter.
- Le vrai applet rend cinq mesures 5/5 puis restaure hash global, empreinte
  élève, inventaire et quatre listeners; les sept helpers temporaires sont
  absents. Candidate incorrecte, collision, annulation et transport fermé ne
  publient aucun faux succès et le fallback reste déterministe.
- Le 15 juillet 2026, lint, typecheck et build passent, Vitest rend 480/480 sur
  44 fichiers et Playwright hors live 18/18. Le smoke credentialed OOB ciblé
  passe 1/1 : réponse completed hors conversation, sortie exclusivement
  `output_text`, outils vides, aucun item de conversation ni événement audio.
  Une configuration audio de session ré-émise dans `response.done` n'est pas
  traitée comme une sortie audio.

### Définition de fini T5 — satisfaite

- Les sept cartes sont exécutées dans l'ordre avec un sous-agent distinct par
  carte et des preuves consignées.
- Exactement cinq samples finis et corrélés sont nécessaires au résultat 5/5.
- Toute sortie partielle, stale, annulée ou technique reste silencieuse et ne
  peut produire ni réussite ni synthèse modèle.
- Le snapshot/hash élève, l'ownership et les listeners sont identiques avant et
  après chaque voie nominale ou dégradée.
- La synthèse OOB reste texte-only, sans outil ni item dans la conversation; son
  échec produit un fallback déterministe fondé sur les cinq mesures.
- L'UI reste utilisable au clavier, à 200 % et sans mouvement requis.
- Les tests ciblés, suite frontend, lint, typecheck, build et scénarios navigateur
  applicables passent; les limites live sont nommées.
- Cartes, `CONTRACT.md`, `TODO_NEXT.md`, `ROADMAP.md`, `DECISIONS.md` et
  `ARCHITECTURE.md` reflètent l'état réel avant ouverture de T6.
