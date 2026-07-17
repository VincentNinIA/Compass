# Contrat Builder — T20-C01 Redéploiement Vercel du candidat T18 — close `pass`

## État

- T20-C01 est close `pass` au 17 juillet 2026 sur autorisation explicite du
  porteur.
- T18-C01 et T19-C01 restent closes `pass`; le candidat source à publier est le
  SHA Git `e1efc28b06fddf54af07a8797f91601357266d52` de la pull request #2.

## Tranche contractualisée — T20-C01

### Objectif

Redéployer le candidat T18 exact dans le projet Vercel isolé
`compass-geotutor-demo`, qualifier l'alias public puis aligner la documentation
Devpost sans soumettre la participation OpenAI Build Week.

### Inclus

- Construire et déployer depuis un worktree Git propre au SHA `e1efc28`, sans
  embarquer les artefacts locaux non commités du workspace principal.
- Réutiliser uniquement le projet Vercel existant `compass-geotutor-demo`, son
  preset Next.js et ses variables serveur déjà configurées.
- Vérifier l'état `READY`, l'alias stable, les headers de sécurité, la page, le
  catalogue professeur et les parcours publics accueil/professeur/GeoGebra.
- Contrôler le navigateur aux formats desktop et mobile, sans mutation durable
  du catalogue ni ouverture automatique du microphone.
- Retirer de Devpost et des documents la réserve disant que l'alias sert encore
  T17; conserver les limites mémoire, la PR source et l'absence de soumission.
- Consigner deployment ID, URL immuable, alias et preuves dans les pilotes.

### Hors périmètre

- Aucun nouveau projet Vercel, domaine, plan payant, merge GitHub, changement de
  secret, base de données, code d'accès, rate limit ou modification produit.
- Aucun appel de soumission Devpost, vidéo, feedback, licence ou retours humains.
- Aucun smoke vocal physique ni dépense modèle nécessaire à la qualification;
  les routes OpenAI ne sont pas appelées avec une charge réelle.
- Pas de `QA_REPORT.md` Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm install --frozen-lockfile
pnpm test:docs:t0
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm dlx vercel whoami
# déploiement Production, inspect READY, HTTP/headers/routes et smoke navigateur
```

### Définition de fini

- L'alias `https://compass-geotutor-demo.vercel.app/` pointe sur un déploiement
  Production `READY` construit depuis le SHA T18 convenu.
- Accueil, espace professeur et démonstration GeoGebra chargent sans erreur
  applicative bloquante sur desktop et mobile; les routes publiques attendues
  répondent avec leurs headers fermés.
- Devpost et les pilotes décrivent T18 comme le candidat live tout en gardant
  `submitted_at: null` et toutes les limites du prototype.

### Preuves de clôture

- Un worktree détaché propre au SHA
  `e1efc28b06fddf54af07a8797f91601357266d52` a reçu l'installation pnpm figée.
  Le candidat passe 70 cartes historiques, lint, typecheck, build et 677/677
  tests Vitest sur 64 fichiers. Le build expose la page et quatre routes
  dynamiques attendues.
- La CLI Vercel 56.3.1 est authentifiée comme `vincent-3604` et liée uniquement
  à `vincent-nin-ia-s-projects/compass-geotutor-demo`. Le réglage projet est
  maintenant `framework: nextjs`, `nodeVersion: 22.x`, sans root directory
  distant imposé.
- Un premier envoi depuis la racine a échoué avant promotion car Vercel ne
  trouvait pas Next.js dans le package monorepo. L'envoi depuis
  `apps/frontend` a produit T18; deux reconstructions Node 22 ont ensuite subi
  un `fetch failed` fournisseur. La voie précompilée locale a finalement été
  acceptée côté serveur malgré le même message terminal du client.
- L'inspection autoritative après ces erreurs montre le déploiement final
  `dpl_3ng7jmgj727Yy1Mu8w9SABuXv7R5` en Production `READY`, URL immuable
  `https://compass-geotutor-demo-dxr8xcxtq-vincent-nin-ia-s-projects.vercel.app`
  et alias stable `https://compass-geotutor-demo.vercel.app/` attaché.
- L'alias final répond 200 sur `/`, `/?demo=geogebra`,
  `/api/teacher/exercises` et l'icône. Les headers conservent HSTS,
  `microphone=(self), camera=(self)`, `nosniff`, `SAMEORIGIN`; le catalogue
  répond JSON `private, no-store`.
- Le smoke Playwright CLI final à 390 × 844 charge GeoGebra, ses six missions et
  la note de démarche obligatoire avant les 10 XP. L'espace professeur affiche
  son formulaire et replace le focus/scroll en tête. `scrollWidth` vaut 375 pour
  390 px et la console rend zéro erreur et zéro warning sur les deux surfaces.
- Devpost Compass a été mis à jour en version 5 : la phrase T17 obsolète est
  remplacée par le candidat T18 live au commit `e1efc28`. La page reste
  `published`, OpenAI Build Week reste `submitted_at: null` et aucun appel de
  soumission n'a été exécuté.

## Archive — T19-C01

# Contrat Builder — T19-C01 Publication GitHub et fiche Devpost — close `pass`

## État

- T19-C01 est close `pass` au 16 juillet 2026 sur autorisation explicite du
  porteur.
- T18-C01 reste close `pass`; son candidat, ses limites et ses preuves doivent
  être publiés sans altération fonctionnelle.

## Tranche contractualisée — T19-C01

### Objectif

Publier le candidat T18 dans GitHub sur une branche dédiée avec une pull request
brouillon, puis synchroniser la fiche Devpost Education existante sans soumettre
la participation au hackathon et sans présenter T18 comme déjà déployé sur Vercel.

### Inclus

- Créer et pousser `codex/t18-education-candidate` avec le code, les tests, la
  documentation et les quatre captures de preuve finales T18.
- Exclure les anciens artefacts Playwright régénérés et les audits de travail qui
  ne constituent pas le dossier final.
- Ouvrir une pull request brouillon vers `main` et conserver un historique Git
  lisible et vérifié.
- Renseigner le brouillon Devpost `Compass` avec le positionnement Education, la
  description anglaise, les technologies et les liens GitHub/démo documentés.
- Consigner les URLs et l'état distant réel dans les pilotes et la roadmap.

### Hors périmètre

- Aucun merge, soumission Devpost, vidéo, retour humain, identifiant `/feedback`,
  choix de licence, changement de visibilité ou publication définitive.
- Aucun déploiement Vercel : l'alias public reste le candidat T17 tant qu'une
  autorisation de redéploiement distincte n'est pas exécutée et qualifiée.
- Aucun changement fonctionnel, aucun artefact d'audit généré et aucune ancienne
  capture Playwright régénérée par les gates.
- Pas de `QA_REPORT.md` Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm test:docs:t0
git diff --cached --check
git diff --check
# contrôle du scope indexé et absence de secret avant commit/push
# relecture du projet Devpost après mise à jour, état submission_draft conservé
```

### Définition de fini

- La branche distante et sa pull request brouillon exposent le candidat T18
  reproductible sans les sorties de test historiques hors périmètre.
- La fiche Devpost contient une description Education cohérente, les technologies
  et les liens utiles; la participation OpenAI Build Week reste non soumise.
- Les pilotes nomment exactement ce qui a été publié et les actions humaines ou
  de déploiement qui restent à réaliser.

### Preuves de clôture

- Le commit `8e25994` publie 61 fichiers du candidat sur la branche distante
  `codex/t18-education-candidate`; la pull request brouillon est
  `https://github.com/VincentNinIA/Compass/pull/2` vers `main`.
- Le scope indexé contient sources, tests, pilotes, dossier Devpost et quatre
  captures T18 finales. `next-env.d.ts`, `output/audit/`, anciennes captures
  régénérées et doublons T18 restent hors commit. Le scan de motifs secrets et
  les deux contrôles `git diff --check` ne rapportent rien.
- `pnpm test:docs:t0` passe avec 70 cartes alignées sur la roadmap.
- Devpost Compass 1327494, version 4, expose la tagline, la description
  Education, neuf technologies et trois liens. L'enregistrement complet a fait
  passer automatiquement la page projet à `published`; aucune opération de
  soumission n'a été appelée et OpenAI Build Week reste `submitted_at: null`.
- L'URL Devpost est `https://devpost.com/software/compass-tedvqs`. La description
  indique explicitement que la démo Vercel est encore T17 et que le candidat T18
  complet se trouve dans la pull request. Aucun déploiement n'a été exécuté.

## Archive — T18-C01

# Contrat Builder — T18-C01 Candidat Education démontrable — close `pass`

## État

- T18-C01 est close `pass` au 16 juillet 2026. Elle répond au contre-audit Devpost
  Education sans dépendre des retours humains, que le porteur du projet collecte
  séparément.
- T17-C01 reste close `pass`; son URL HTTPS et ses limites éphémères sont
  préservées. Les changements locaux T14 à T17 appartiennent au candidat et ne
  doivent pas être écrasés.

## Tranche contractualisée — T18-C01

### Objectif

Rendre le candidat Compass plus jugeable et pédagogiquement crédible : demander
une trace de raisonnement avant une auto-déclaration, fermer l'exercice par une
question de transfert, rendre au professeur un bilan anonyme strictement
factuel de la session courante, corriger les principaux défauts responsive et
restaurer un gate reproductible accompagné d'un dossier Devpost prêt à remplir.

### Inclus

- Réinitialiser scroll et focus à chaque changement d'écran; empêcher la
  mascotte mobile et le rail GeoGebra de masquer une action ou une mission.
- Exiger une note courte sur la démarche avant les 10 XP auto-déclarés et poser
  une question de transfert après la dernière mission, sans noter le texte.
- Produire uniquement pour les exercices professeur un bilan anonyme de session
  contenant compteurs de missions terminées/vérifiées, XP et statuts de
  réflexion, sans réponse libre, identité, note ni persistance.
- Rendre ces bilans dans l'espace professeur et conserver en mémoire React les
  publications créées dans l'onglet afin que le parcours de démo résiste aux
  changements d'instance serverless.
- Renommer et reformuler les trois contrôles de relecture selon leurs preuves
  réelles; renforcer le contrat du coach GeoGebra avant une mutation demandée.
- Corriger la densité de la relecture professeur, la bibliothèque, la scène
  mobile et les assertions Playwright devenues obsolètes.
- Réparer le validateur documentaire, actualiser README, `.env.example`, pilotes
  et préparer la description, le script vidéo et la matrice de preuves Devpost.

### Hors périmètre

- Aucun compte, classe, élève nommé, affectation, note, analytics distant, base
  de données, cookie, localStorage/sessionStorage ou synchronisation inter-appareil.
- Aucune vérification automatique nouvelle hors des preuves déterministes déjà
  disponibles et aucune transmission du texte de réflexion au professeur.
- Aucun changement de modèle, nouvelle boucle agentique, outil GeoGebra libre,
  déploiement, commit, push ou mutation du brouillon Devpost distant.
- Les retours humains, la vidéo finale, l'identifiant `/feedback`, le choix de
  licence et la soumission Devpost restent à la charge du porteur du projet.
- Pas de `QA_REPORT.md` Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm test:docs:t0
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend exec playwright test --grep-invert @live
# navigateur réel : 390/768/1440, élève → bilan professeur, zéro overflow/console
```

### Définition de fini

- Un élève ne peut plus obtenir 10 XP par un clic nu : il indique d'abord ce
  qu'il a essayé, puis répond à une question de transfert en fin d'exercice.
- Le professeur voit un bilan anonyme exact de la session courante et comprend
  explicitement qu'il ne s'agit ni d'une note ni d'un suivi persistant.
- Les contrôles publiés ne prétendent plus certifier une progression didactique,
  une adaptation ou une sécurité globale qu'ils ne calculent pas.
- Accueil, studio, bibliothèque et atelier démarrent en haut de leur écran; à
  390 px, aucune mascotte, mission ou action primaire n'est masquée.
- Les gates documentaires, unitaires, build et Playwright hors live passent sur
  le même worktree; les réserves credentialed historiques restent nommées.
- README et dossier Devpost décrivent le produit actuel, son architecture, ses
  limites et les preuves à montrer sans inventer de traction humaine.

### Preuves de clôture

- `pnpm test:docs:t0` passe : les 69 cartes correspondent exactement au registre
  de roadmap; IDs, dépendances, références structurées et deux formats de carte
  sont validés. `git diff --check` passe.
- Lint, typecheck et build Next.js passent; Vitest rend 677/677 sur 64 fichiers.
  Le build expose la page statique et les quatre fonctions dynamiques attendues.
- Playwright hors live rend 36/36 en 1 min 12 sur le même build. Le nouveau
  scénario T18 publie en manuel, résiste à un GET catalogue vide, exige une
  démarche avant XP, ferme le transfert, remet scroll/focus en tête et affiche
  un bilan professeur sans texte libre, sans overflow ni erreur console à 390 px.
- `learning_session_report.v1` est strict : un champ identité/réponse inconnu et
  des compteurs impossibles sont rejetés; le professeur ne reçoit que titre,
  matière, compteurs, XP, statuts et timestamp.
- Les contrôles visibles s'appellent désormais `Step structure`, `Support
  context` et `Risk wording scan`; leur copie décrit les règles locales réelles.
  Le prompt GeoGebra refuse une mutation tant que labels et relation/action ne
  sont pas explicités dans le tour courant.
- Les captures `output/playwright/T18-final-landing-390x844.png`,
  `T18-proof-geogebra-390x844.png`, `T18-proof-teacher-review-1440x900.png` et
  `T18-proof-teacher-report-1440x900.png` ont été inspectées. Mascotte et CTA ne
  se chevauchent plus; le plan reste visible; la checklist est compacte; le
  bilan anonyme tient dans le viewport. Le CLI rapporte zéro erreur/warning.
- README, `.env.example` et `docs/DEVPOST_SUBMISSION.md` décrivent modèles,
  parcours jury, script vidéo, limites et actions humaines restantes. Le
  candidat T18 local n'a volontairement pas été redéployé ni envoyé à Devpost;
  l'URL publique reste le candidat T17 jusqu'à autorisation de publication.

## Archive — T17-C01

# Contrat Builder — T17-C01 Déploiement Vercel de démonstration — close `pass`

## État

- T17-C01 est close `pass` au 16 juillet 2026. Le premier déploiement CLI d'un projet
  Vercel neuf a créé automatiquement sa première Production et son alias stable;
  aucun projet Vercel préexistant n'a été modifié.
- T16-C02 reste close `pass`; ses changements locaux non committés doivent être
  inclus dans le candidat sans être écrasés, réordonnés ni publiés dans Git.

## Tranche contractualisée — T17-C01

### Objectif

Déployer le prototype non commercial actuel dans un projet Vercel HTTPS isolé,
avec la clé OpenAI exclusivement côté serveur, puis vérifier le parcours de
démonstration sans créer de persistance ni modifier les autorités produit.

### Inclus

- Vérifier le build production du workspace courant et l'absence de secret dans
  les sorties statiques.
- Utiliser la CLI Vercel depuis le dépôt, lier ou créer un projet sous l'équipe
  Hobby déjà authentifiée et conserver `.vercel/` hors de Git.
- Configurer `OPENAI_API_KEY` comme secret Vercel Preview et Production sans
  imprimer sa valeur.
- Qualifier la première Production créée automatiquement pour ce nouveau projet,
  puis vérifier la page, les headers de sécurité et les routes dynamiques
  nécessaires au parcours live.
- Consigner l'URL, le candidat réellement envoyé et les preuves factuelles.

### Hors périmètre

- Aucun domaine personnalisé, achat, migration de compte, changement de plan ou
  mutation des Productions `rfi-meg-memory-client` et `novency-vocal`.
- Aucune base de données, persistance, authentification, classe ou modification
  du catalogue éphémère et du ledger XP mémoire.
- Aucun commit, push Git ou réécriture des changements locaux existants.
- Pas de `QA_REPORT.md` Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm dlx vercel whoami
# déploiement du projet isolé, contrôle HTTP/HTTPS, smoke navigateur et scan secret
```

### Définition de fini

- L'URL HTTPS stable du projet isolé charge le build courant et le parcours reste
  utilisable sans erreur console bloquante.
- La route Realtime et la route d'analyse voient la configuration serveur sans
  qu'aucune clé n'apparaisse dans le HTML, JavaScript ou les logs rapportés.
- GeoGebra, caméra et microphone conservent leurs permissions same-origin et
  les limites éphémères du prototype restent inchangées.
- L'URL de démonstration et les gates réellement exécutés sont consignés; les
  deux projets Vercel préexistants demeurent intacts.

### Preuves de clôture

- La CLI Vercel 56.2.1 est authentifiée comme `vincent-3604` sous l'équipe
  `vincent-nin-ia-s-projects`. Le projet isolé `compass-geotutor-demo` a été
  créé sans modifier `rfi-meg-memory-client` ni `novency-vocal`.
- Lint, typecheck et build passent; Vitest rend 672/672 sur 63 fichiers. Le scan
  des sorties `.next/static` et `.next/server` ne retrouve pas la clé locale.
- Le premier build générique exécutait `next build` mais ne publiait aucune
  route. Le preset projet a été corrigé explicitement en `nextjs`; le candidat
  final `dpl_3AgnMLhpicQ6uwfVPNXupcerBTHe` est `READY` avec les routes statiques
  et les quatre fonctions dynamiques.
- `https://compass-geotutor-demo.vercel.app/` répond HTTP 200 avec HTTPS, HSTS,
  `microphone=(self)`, `camera=(self)`, `nosniff` et `SAMEORIGIN`. Le catalogue
  répond 200, JSON valide et `private, no-store`.
- `OPENAI_API_KEY` est chiffrée pour Preview et Production. Un brouillon réel
  déployé répond 200 avec `teacher_exercise.v1`, `publishable:true` et exactement
  un appel modèle; aucune valeur de secret n'est imprimée.
- Dans le navigateur réel, l'accueil se rend, la bascule française met
  `document.lang` à `fr`, puis `?demo=geogebra` charge le coach, l'applet, les
  six missions et les compteurs XP. Aucun log erreur/warning d'origine Compass
  n'est relevé.
- Les URLs immuables restent sous SSO d'équipe, mais l'alias stable `.vercel.app`
  est public. Cette tranche reste une démo non commerciale; un accès applicatif
  et un rate limit sont requis avant toute diffusion large.
- Le contrôle supplémentaire `pnpm test:docs:t0` reste rouge pour une dette
  antérieure à T17 : le script attend 49 cartes alors que le dépôt en contient
  56. `git diff --check` passe; ce compteur documentaire ne touche ni le build,
  ni les routes, ni le candidat Vercel qualifié ci-dessus.

## Archive — T16-C02

# Contrat Builder — T16-C02 Interface professeur orientée usage — close `pass`

## État

- T16-C02 est close `pass` au 16 juillet 2026. Aucune carte Builder n'est active.
- T16-C01 reste close `pass`; ses contrats, routes et limites internes sont à
  préserver.

## Tranche contractualisée — T16-C02

### Objectif

Faire de l'espace professeur un outil immédiatement compréhensible par un
enseignant : expliquer quoi fournir, comment adapter l'exercice et quand il sera
partagé, sans exposer le modèle, les appels, le serveur ou les contrôles internes.

### Inclus

- Remplacer le préambule technique par une consigne courte et trois étapes
  concrètes : choisir un point de départ, préciser les besoins, relire et partager.
- Nommer les trois modes selon la tâche professeur : partir d'un thème, importer
  une fiche ou saisir soi-même l'exercice.
- Ajouter des exemples et aides de saisie directement dans les champs utiles.
- Présenter le brouillon comme une relecture avant partage; traduire les contrôles
  utiles en critères enseignants et masquer entièrement le contrôle de coût.
- Supprimer de l'interface professeur et de la bibliothèque les mentions de
  modèle, nombre d'appels, API, serveur, contrat fermé ou limite de prototype.
- Conserver EN/FR, états vide/chargement/erreur/succès et reflow mobile.

### Hors périmètre

- Aucun changement de modèle, route, schéma, plafond d'appel, store, contexte
  Realtime, authentification, classe ou persistance.
- Aucun ajout de dépendance visuelle ni refonte du parcours élève existant.
- Pas de `QA_REPORT.md` Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
# navigateur réel : espace professeur EN/FR, vide et brouillon à 390/1440 px
```

### Définition de fini

- Un professeur comprend les trois étapes et les trois points de départ sans
  connaître l'architecture de Compass.
- Aucun nom de modèle ni nombre d'appels n'est visible dans l'espace professeur.
- Les libellés expliquent quoi écrire et donnent des exemples utiles sans long
  paragraphe introductif.
- La relecture affiche seulement progression, adaptation et sécurité sous des
  mots enseignants; le partage et son succès sont explicites.
- Les tests, gates et contrôles responsive passent sans modifier le backend T16.

### Preuves de clôture

- `lint`, `typecheck` et le build Next.js passent; Vitest rend 672/672 sur
  63 fichiers, avec un test dédié à la bibliothèque sans copie technique.
- L'espace professeur expose trois verbes — choisir, préciser, partager — puis
  trois entrées métier et des exemples directement dans les champs EN/FR.
- La relecture affiche uniquement `Progression claire`, `Aide adaptée` et
  `Prêt à partager`; le contrôle de coût reste exécuté mais n'est pas rendu.
- Le navigateur réel confirme le formulaire puis un brouillon manuel en
  français. Aucun nom de modèle ni compteur d'appel n'apparaît dans le snapshot.
- Le document mesure 375 px dans un viewport de 390 px et 1425 px dans un
  viewport de 1440 px; la console rend zéro erreur et zéro avertissement.
- Les routes, schémas, store, modèle et contexte Realtime de T16-C01 ne sont
  pas modifiés par cette tranche de présentation.

## Archive — T16-C01

# Contrat Builder — T16-C01 Espace professeur frugal — close `pass`

## État

- T16-C01 est close `pass` au 16 juillet 2026. Aucune carte Builder n'est active.
- T15-C01 est close `pass`; T14 reste la base GeoGebra à préserver.

## Tranche contractualisée — T16-C01

### Objectif

Ajouter un espace professeur qui transforme une image ou un brief pédagogique
en exercice publiable, puis rendre ces exercices accessibles depuis un second
parcours élève, avec une orchestration IA explicitement bornée en coût.

### Inclus

- Un bouton professeur en haut à droite et deux départs élève sur l'accueil :
  devoir personnel ou exercices préparés.
- Un contrat `teacher_exercise.v1` strict : exercice général, objectif,
  consignes professeur, difficultés ciblées, obstacles probables et aides.
- Un atelier professeur bilingue avec deux entrées : photo ou brief
  matière/niveau/thème/difficultés; brouillon visible et éditable avant publish.
- Un seul appel Responses `gpt-5.6-luna`, effort faible, `store:false`, outils
  vides et Structured Outputs. Les contrôles didactique, difficulté, sécurité
  et coût sont locaux et exposent leurs verdicts sans appel supplémentaire.
- Un catalogue mémoire serveur borné à 64 publications, accessible par GET et
  POST, sans base de données ni notion de classe.
- Une bibliothèque élève avec vide/chargement/erreur, puis lancement direct dans
  l'atelier existant. Les consignes professeur rejoignent le contexte coach
  comme données non fiables et ne donnent aucune permission.
- Un fallback manuel : sans clé ou en cas d'échec amont, le professeur peut
  saisir et publier lui-même un exercice conforme.

### Hors périmètre

- Pas d'authentification, de classe, d'affectation nominative, de rôle sécurisé,
  de base de données ou de garantie de persistance après redémarrage.
- Pas de multi-agent Responses bêta, d'Agents SDK, de conversation entre
  modèles, de web search ou de boucle autonome.
- Pas de correction ou de notation par le modèle et pas d'élargissement des
  permissions Realtime/GeoGebra.
- Pas de `QA_REPORT.md` Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
# navigateur réel : professeur publie → élève voit → lance → coach reçoit les consignes
```

### Définition de fini

- À 390, 768 et 1440 px, le header, les deux choix élève et l'espace professeur
  restent utilisables en EN/FR, au clavier et sans débordement.
- Une photo ou un brief produit au plus un appel modèle et un brouillon fermé;
  les arguments hors contrat et les sorties invalides sont rejetés.
- Le professeur peut modifier le brouillon puis publier; un autre onglet voit
  la publication et ouvre l'atelier sans nouvelle analyse modèle.
- Le contexte Realtime contient les consignes professeur délimitées, mais les
  profils et outils existants restent identiques.
- Sans API, la saisie manuelle et la publication fonctionnent; le catalogue
  annonce sa nature éphémère. Les gates et le scénario réel passent.

### Preuves de clôture

- `lint`, `typecheck` et le build Next.js passent; Vitest rend 671/671 sur
  62 fichiers, dont schéma fermé, revue locale, store borné, fallback manuel,
  publication client et transmission minimale au coach.
- Le build expose les deux routes dynamiques `/api/teacher/draft` et
  `/api/teacher/exercises`; l'appel Responses est unique, sans retry SDK, à
  effort faible, outils vides, `store:false` et sortie plafonnée.
- Dans Chromium, le professeur crée sans modèle un exercice d'histoire,
  conserve quatre contrôles locaux au vert et reçoit un succès HTTP 201. Un
  second onglet élève le retrouve depuis le second choix de l'accueil puis
  ouvre directement ses trois missions dans l'atelier.
- Le parcours réel ne produit aucune erreur console. Accueil, bibliothèque et
  atelier professeur rendent une largeur de document de 375 px dans un
  viewport de 390 px; l'atelier professeur rend 1425 px dans 1440 px.
- Les consignes professeur sont copiées dans le contexte borné et délimitées
  comme données non fiables. Les profils, outils, permissions de mutation et
  règles de preuve Realtime historiques restent inchangés.

## Archive — T15-C01

# Contrat Builder — T15-C01 Gamification transversale — close `pass`

## Preuves de clôture

- Ledger idempotent : 10 XP déclarés, upgrade à 20 XP vérifiés, cumul multi-
  exercice et rejet des identités invalides.
- `lint`, `typecheck` et build passent; Vitest rend 657/657 sur 58 fichiers lors
  du gate d'ouverture T16, complété par 17/17 tests gamification ciblés.
- Dans Chromium à 390 px, un exercice d'histoire à deux missions passe de 0 à
  10 puis 20 XP; seule la mission active est actionnable, les libellés
  `terminé` et `vérifié` restent distincts et la console rend 0 erreur.
- L'intégration GeoGebra crédite 20 XP une fois, conserve le crédit lorsque la
  preuve courante disparaît et refuse le bouton déclaratif dans le workbench.
- Le catalogue XP reste mémoire uniquement et un rechargement du scénario
  `?demo=gamification` remet les deux compteurs à zéro.

## Archive — T14-C02

# Contrat Builder — T14-C02 Monde GeoGebra vivant — close `pass`

## État

- T14-C02 est close `pass` au 16 juillet 2026. Aucune carte Builder n'est active.
- T14-C01 et T13 restent les bases d'interface et de sécurité à préserver.

## Tranche contractualisée — T14-C02

### Objectif

Relier l'état réel de GeoGebra au coach, étendre ses actions sémantiques sûres
et transformer les missions vérifiables en progression honnête avec XP, tout en
donnant à Compass une voix adulte cohérente avec son personnage.

### Inclus

- Produire un snapshot initial borné du tableau puis des mises à jour
  stabilisées sur ajout, retrait, renommage, déplacement et style; publier ce
  contexte dans la session Realtime active sans déclencher une réponse modèle à
  chaque événement.
- Vérifier de manière déterministe les relations géométriques disponibles pour
  l'exercice confirmé; attribuer 20 XP une seule fois par mission effectivement
  satisfaite et conserver les tâches non démontrables dans l'état `à faire`.
- Étendre la palette fermée avec création et déplacement de point, renommage,
  style, cercle et polygone, en plus de l'inventaire, droite, demi-droite et
  segment existants.
- Conserver la demande explicite, les schémas stricts, l'idempotence et le
  budget d'une mutation maximum par tour; aucune commande GeoGebra libre.
- Utiliser la voix Realtime `cedar` avec une consigne de tuteur adulte,
  chaleureuse et posée, en voix comme en texte.

### Hors périmètre

- Pas de commande `evalCommand` fournie librement au modèle, de suppression
  arbitraire, d'exécution de code ou d'accès aux primitives GeoGebra non
  contractualisées.
- Pas de validation par le modèle, de score inventé, de note scolaire ni de
  validation automatique d'une réponse écrite non observable sur le tableau.
- Pas d'ouverture automatique du microphone et pas de modification destructive
  des modules spécialisés T1 à T6.
- Pas de `QA_REPORT.md` Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
# navigateur réel : progression 0 → 20 XP après E/F/G non alignés
```

### Définition de fini

- Le coach reçoit un état initial borné puis une mise à jour significative sans
  `response.create` automatique et peut décrire les objets réellement présents.
- La mission 1 de l'exercice utilisateur passe à `vérifié` seulement lorsque
  E, F et G existent et ne sont pas alignés; l'affichage passe alors à 20 XP.
- Le gateway renomme un objet existant et couvre les nouvelles actions sans
  permettre d'argument supplémentaire, de label invalide ou de deuxième
  mutation dans le même tour.
- Les profils Realtime publient `cedar`; le prompt demande un timbre adulte,
  chaleureux et naturel sans revendiquer une garantie de genre du fournisseur.
- Les gates passent et le parcours réel confirme GeoGebra cliquable, mission
  validée et score mis à jour.

### Preuves de clôture

- `lint`, `typecheck` et le build Next.js passent; Vitest rend 650/650 sur
  57 fichiers.
- Les tests prouvent le snapshot/delta sans `response.create`, les relations
  géométriques, la borne de quarante objets, le renommage, le rejet des actions
  libres et le budget d'une mutation par tour.
- Dans le vrai applet connecté en texte, Compass crée successivement E, F et G;
  le rail passe alors à la mission 2, affiche ✓ sur la mission 1 et 20 XP.
- Le renommage réel E → A retire immédiatement la preuve et remet le score à
  zéro; A → E restaure 20 XP. Un nouvel onglet chargé à froid ne rapporte aucune
  erreur console.
- Les configurations serveur, session et E2E attendent toutes `cedar`. L'essai
  audio physique reste un contrôle humain soumis à permission microphone, pas
  un gate automatique.

## Archive — T14-C01

# Contrat Builder — T14 Atelier GeoGebra panoramique — close `pass`

## État

- T14-C01 est close `pass` au 15 juillet 2026. Aucune carte Builder n'est active.
- La direction visuelle retenue par l'utilisateur est l'option 1 : barre coach
  horizontale, plan GeoGebra pleine largeur et rail de missions horizontal.
- T13 reste la base fonctionnelle à préserver; aucune capacité fermée Realtime
  existante ne doit régresser.

## Tranche contractualisée — T14-C01 — close

### Objectif

Rendre l'atelier immédiatement jouable : corriger les contrôles GeoGebra
neutralisés, donner au plan toute la largeur utile, déplacer le coach au-dessus
et les six missions sous le plan, puis remplacer la boucle permanente de la
mascotte par des réactions finies ancrées aux événements réels.

### Inclus

- Corriger la garde d'accessibilité afin qu'un contrôle GeoGebra visible portant
  `aria-hidden` reste cliquable, tout en gardant les sous-arbres réellement
  masqués inertes.
- Vérifier dans un navigateur réel le parcours outil Point → clic plan → objet
  créé, ainsi que clavier et absence de contrôle bloqué.
- Supprimer la colonne latérale du workbench : coach horizontal compact,
  GeoGebra pleine largeur et hauteur liée au viewport, rail de six missions
  horizontal sous le canevas.
- Transformer les missions en états `à faire`, `en cours` et `vérifié` sans
  revendiquer une validation lorsque le runtime déterministe ne la fournit pas.
- Jouer les huit frames d'une activité de mascotte au plus une fois, conserver
  une pose de repos stable et respecter `prefers-reduced-motion`.
- Intégrer un asset propre de la mascotte dans la barre panoramique sans
  réutiliser visuellement l'atlas complet.

### Hors périmètre de C01

- Le flux de deltas GeoGebra injecté dans la conversation Realtime et les
  nouvelles actions sémantiques appartiennent à T14-C02.
- Pas d'ouverture automatique du microphone, de commande GeoGebra libre, de
  validation modèle, de score inventé ou de notation à enjeu élevé.
- Aucun changement destructif des modules spécialisés T1 à T6.
- Pas de `QA_REPORT.md` Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
# parcours réel dans le navigateur choisi : Point → clic plan → Undo actif
```

### Définition de fini

- À 1440 px, aucun panneau latéral ne réduit GeoGebra; le coach précède le plan
  et le rail de missions le suit sur toute la largeur.
- À 390 et 768 px, la même hiérarchie reste utilisable sans débordement et les
  contrôles persistants ne masquent pas le plan.
- Un test navigateur sur le vrai applet sélectionne Point et crée un objet par
  clic; la garde continue à neutraliser un vrai sous-arbre masqué.
- La mascotte ne boucle plus indéfiniment : une réaction atteint sa pose finale
  puis revient au repos; mouvement réduit reste immobile.
- Les gates passent et le contrôle visuel contre la cible sélectionnée conclut
  `final result: passed` dans `design-qa.md`.

### Preuves de clôture

- `lint`, `typecheck` et le build Next.js passent; Vitest rend 642/642 sur
  56 fichiers.
- Dans le navigateur intégré sur le vrai applet, l'outil Point devient actif,
  un clic sur le canevas crée un objet et réactive Undo. Le test de la garde
  confirme qu'un outil visible portant `aria-hidden` ne reçoit plus `inert`.
- Les captures desktop et mobile confirment coach horizontal, plan sans colonne
  latérale et rail compact. Les collisions trouvées au premier passage ont été
  corrigées; `design-qa.md` conclut `final result: passed`.
- La réaction non idle de la mascotte joue une séquence finie puis reste sur la
  pose de repos; les tests reduced motion et cleanup passent.

## Tranche candidate — T14-C02 — monde GeoGebra temps réel

- Publier un snapshot initial borné et des deltas significatifs stabilisés vers
  la session active.
- Étendre la palette par actions sémantiques fermées : point, focus/highlight,
  choix d'outil, centrage/zoom, couleur et primitives autorisées.
- Conserver demande explicite, budget, idempotence, annulation et absence de
  commande arbitraire.

## Archive — T13

# Contrat Builder — T13 Atelier GeoGebra assisté — close `pass`

## État

- T13-C01 est close `pass` au 15 juillet 2026. Aucune carte Builder n'est active.
- Cette tranche remédie le retour de test utilisateur : GeoGebra devient la
  surface principale, le coach comprend le contexte de l'applet et peut aider à
  tracer avec une surface d'outils fermée.

## Tranche contractualisée — T13-C01 — close

### Objectif

Transformer l'atelier mathématique en poste de travail GeoGebra clair : grand
canevas, coach compact et contextualisé, aide vocale ou textuelle capable de
créer une droite, une demi-droite ou un segment entre des points existants à la
demande explicite de l'élève.

### Inclus

- Une composition grand écran où GeoGebra reçoit au moins 65 % de la largeur du
  workbench et une hauteur utile liée au viewport; le coach et les tâches
  occupent une colonne secondaire.
- Sur mobile, l'ordre coach → GeoGebra → tâches, sans débordement horizontal.
- Un profil Realtime `geogebra_tutor` qui reçoit l'exercice confirmé comme donnée
  non fiable, sait que l'élève est dans GeoGebra et bannit toute recommandation
  d'instrument physique.
- Quatre outils de fonction fermés : inventaire borné, droite par deux points,
  demi-droite par deux points et segment par deux points.
- Un gateway local validant noms, arguments, phase, autorité, idempotence et
  budget d'une mutation maximum par tour. Aucun point manquant n'est créé.
- Une copie élève honnête : Compass peut regarder l'inventaire et tracer sur
  demande, mais ne valide ni ne note automatiquement la construction.

### Hors périmètre

- Aucune commande GeoGebra libre, génération de code, suppression, déplacement
  ou création arbitraire de point par le modèle.
- Aucune preuve de correction, notation ou vérification déterministe générale.
- Aucun changement destructif des modules spécialisés T1 à T6 ou du profil
  général sans outil utilisé pour les autres matières.
- Pas de `QA_REPORT.md` Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend exec playwright test --grep-invert @live
```

### Définition de fini

- À 1440 px, le canevas GeoGebra occupe au moins 65 % de la largeur du workbench
  et reste visible avec le coach compact sans long préambule vertical.
- À 390 et 768 px, le coach vient avant le tableau puis les tâches, sans
  débordement ni contrôle inaccessible.
- Les configurations voix et texte du profil `geogebra_tutor` exposent
  exactement les quatre outils fermés avec `tool_choice:"auto"`; le profil
  `general_tutor` conserve `tools:[]` et `tool_choice:"none"`.
- Sur le vrai applet, F et G existants permettent de créer une droite verte;
  un point absent échoue sans mutation, un `callId` rejoué est idempotent et une
  deuxième mutation du même tour est refusée.
- Un replay Realtime publie le `function_call_output` puis une seule continuation.
- Le prompt système interdit explicitement les instruments physiques et décrit
  les clics de barre d'outils lorsque l'élève préfère construire lui-même.

### Preuves de clôture

- Lint, typecheck et build passent; Vitest rend 639/639 tests sur 55 fichiers.
- Playwright hors `@live` rend 34/34. Le scénario T13 couvre les quatre écrans,
  l'applet réellement prêt, l'ordre mobile/tablette et la largeur desktop.
- À 1440 × 900, GeoGebra occupe 72,0 % des 1320 px du workbench; à 390 × 844
  et 768 × 1024, l'ordre est coach → tableau → tâches et l'overflow vaut zéro.
- Le replay credentialed réel sur l'exercice utilisateur a connecté
  `geogebra_tutor` en texte, inspecté F/G, créé `compassLineFG`, puis répondu en
  français. L'API retourne exactement `Line[F, G]` et la couleur `#2E7D32`.
- Les tests du gateway prouvent point absent sans mutation, idempotence du
  `callId`, une mutation par tour, arguments stricts et rejet d'un outil libre.
- Les captures finales sont
  `output/playwright/T13-geogebra-live-line-1440x900.png`,
  `T13-geogebra-assisted-768x1024.png` et
  `T13-geogebra-assisted-390x844.png`.

## Archive — T12

# Contrat Builder — T12 Parcours en écrans et atelier contextualisé — close `pass`

## État de clôture

- T12-C01 est close `pass` le 15 juillet 2026. Aucune carte Builder n'est active.
- Le parcours public rend quatre écrans exclusifs et ouvre l'atelier uniquement
  après confirmation. Pour la capture utilisateur, le coach vocal précède un
  GeoGebra vierge puis les six tâches sur mobile.

## Tranche contractualisée — T12-C01 — close

### Objectif

Remplacer la page élève empilée par quatre écrans successifs — accueil, photo,
vérification, atelier — et garder dans l'atelier le coach vocal au-dessus du
support de travail. Pour un exercice mathématique ou géométrique générique,
GeoGebra est un tableau libre et non un validateur spécialisé.

### Inclus

- Une machine de navigation locale en mémoire qui conserve le draft entre les
  écrans et n'affiche qu'une étape métier à la fois.
- Un bouton d'accueil qui ouvre l'acquisition, l'analyse qui ouvre immédiatement
  la vérification, puis la confirmation qui ouvre l'atelier.
- Des retours explicites vers l'étape précédente ou l'accueil, un focus déplacé
  au nouveau titre et une progression accessible EN/FR.
- Un atelier avec mascotte et coach Realtime en tête; l'action voix reste visible
  dès l'ouverture et le contexte confirmé demeure l'unique contexte du coach.
- Un tableau GeoGebra vierge pour les exercices de mathématiques/géométrie, sans
  bootstrap A/B/AB, mutation par le modèle, observation, score ou validation
  automatique. Les autres matières gardent l'espace de tâches général.
- Le mode `?specialist=geometry` historique reste un banc compatible avec les
  preuves T1 à T6 et n'est pas confondu avec le parcours public.
- Qualification à 390, 768 et 1440 px, clavier, EN/FR et absence de débordement.

### Hors périmètre

- Aucun routage matière vers un outil arbitraire, aucune génération de commande
  GeoGebra et aucune promesse de correction automatique du tableau libre.
- Aucun changement des contrats `general_exercise.v1`, Realtime ou des autorités
  spécialisées T1 à T6; aucun stockage persistant.
- Pas de `QA_REPORT.md` Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend exec playwright test --grep-invert @live
```

### Définition de fini

- Le parcours nominal passe de l'accueil à la photo, puis à la vérification et
  à l'atelier sans ancre ni long scroll entre ces étapes.
- La capture utilisateur de géométrie ouvre un atelier où le coach, la voix,
  les six tâches et un tableau GeoGebra vierge restent simultanément accessibles.
- L'atelier ne contient aucune copie médiatrice/AB/PA-PB ni fausse validation et
  le profil général conserve `tools:[]` et `tool_choice:"none"`.
- Les modes erreur, clarification, nouvelle photo et retour sont utilisables au
  clavier; les gates et les trois viewports passent sans débordement.

### Preuves de clôture

- Lint, typecheck et build passent; Vitest rend 630/630 tests sur 54 fichiers.
- Playwright hors `@live` rend 34/34. Le scénario T12 attend un applet réellement
  `ready`, six tâches, le coach et la voix, puis vérifie 390, 768 et 1440 px sans
  débordement ainsi que les retours nouvel exercice et accueil.
- La capture `output/playwright/T12-four-screen-workspace-390x844.png` montre
  l'ordre mobile coach → GeoGebra → tâches, sans médiatrice, A/B/AB ni PA/PB.
- L'applet générique contient des enfants injectés mais aucun bootstrap, listener
  métier, score ou outil Realtime; le profil général reste sans outil.

## Archive — T11

# Contrat Builder — T11 Tuteur généraliste — close `pass`

## État de clôture

- T11-C01 est close `pass` le 15 juillet 2026. Aucune carte Builder n'est
  active.
- La surface publique accepte tout exercice scolaire lisible dans
  `general_exercise.v1`, demande une confirmation fidèle, puis active un coach
  sans outil spécialisé.
- Le module médiatrice historique est absent du parcours par défaut; un mode
  spécialiste explicite le conserve pour les tests et les modules compatibles.

## Tranche contractualisée — T11-C01 — close

### Objectif

Retirer la médiatrice comme exercice imposé sur la surface publique et permettre
à Compass d'accompagner tout exercice scolaire lisible. La confirmation reste
obligatoire; le coach général ne possède aucun outil spécialisé et ne revendique
aucune vérification automatique.

### Inclus

- Ajouter une enveloppe `general_exercise.v1` stricte et bornée contenant langue,
  matière, titre, énoncé, tâches ordonnées et notions, avec seulement les issues
  `ready` et `needs_clarification`.
- Modifier la route photo réelle afin qu'elle ne classe plus une matière ou un
  type d'exercice en `unsupported`; seuls l'illisibilité, l'incomplétude ou les
  contradictions demandent une précision.
- Afficher et faire confirmer le contenu générique avant toute activation du
  coach, sans convertir le texte modèle en commande, permission ou preuve.
- Remplacer le canevas médiatrice public par un espace d'accompagnement
  générique. Le module historique peut rester disponible au code et aux tests,
  mais il n'est ni monté ni annoncé pour un exercice général.
- Ouvrir les sessions Realtime publiques avec le profil `general_tutor` sans
  outil, transmettre l'exercice confirmé comme item utilisateur délimité, puis
  permettre la voix ou le texte avec une pédagogie socratique concise.
- Qualifier la capture réelle fournie par l'utilisateur, au moins deux autres
  matières, EN/FR, clavier, reflow et l'absence de copie médiatrice dans le
  parcours général.

### Hors périmètre

- Pas de commande GeoGebra générique, de code arbitraire, de notation à enjeu
  élevé ni de promesse de correction déterministe hors module spécialisé.
- Pas de stockage du média ou de l'énoncé; le contexte reste en mémoire de
  session et `store:false` demeure requis pour l'extraction.
- Pas de changement destructif des contrats T1 à T10 ni de leurs preuves.
- Pas de `QA_REPORT.md` Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend exec playwright test --grep-invert @live
```

### Preuves de clôture

- La capture française réelle fournie par l'utilisateur retourne HTTP 200 en
  `ready_general`, avec le titre `Exercice 1`, les six consignes dans l'ordre et
  les notions droite, demi-droite, segment et appartenance.
- Les contrats couvrent aussi histoire et langue étrangère par la même issue
  `ready`; les instructions répétées sont conservées et une image illisible
  reste en `needs_clarification` sans contexte coach.
- Lint, typecheck et build passent; Vitest rend 629/629 tests sur 54 fichiers.
- Playwright hors `@live` rend 34/34. Le scénario T11 à 390 × 844 confirme les
  six étapes, la bascule EN/FR, le coach activé après confirmation, l'absence de
  médiatrice publique et l'absence de débordement horizontal.
- Le profil Realtime général est qualifié en voix et en texte avec `tools:[]`,
  `tool_choice:"none"` et un seul item utilisateur de contexte, sans
  `response.create` automatique.

### Définition de fini

- La capture française multi-étapes de l'utilisateur atteint `ready` avec ses
  six tâches dans l'ordre et sans statut `unsupported`.
- Une image lisible d'une autre matière atteint la même confirmation; une image
  illisible demande une précision et ne crée aucun contexte coach.
- L'exercice confirmé est le seul contexte transmis au profil général, qui
  expose `tools:[]` et `tool_choice:"none"`; l'item de contexte ne déclenche pas
  seul une réponse.
- La surface publique ne montre plus la médiatrice, AB, 0/2 ou PA/PB pour un
  exercice général et reste utilisable à 390, 768 et 1440 px.
- Les gates ci-dessus passent et les documents pilote reflètent les preuves.

## Archive — T10

# Contrat Builder — T10 Acquisition photo fiable — close `pass`

## État de clôture

- T10-C01 est close `pass` le 15 juillet 2026. Aucune carte Builder n'est active.
- La galerie utilise une entrée sans `capture`; la caméra possède une entrée
  distincte `image/*` avec `capture="environment"`.
- `pnpm dev` charge le `.env` racine avant Next.js et la route image réelle
  répond `ready` sans exposer la clé au client.

## Tranche contractualisée — T10-C01 — close

### Inclus

- Séparer l'entrée fichier de l'entrée caméra afin que l'élève puisse choisir
  explicitement une image existante ou ouvrir la caméra arrière de son mobile.
- Conserver une validation, un aperçu et un nettoyage identiques quelle que
  soit la source de l'image.
- Faire charger au script `pnpm dev` la configuration serveur `.env` située à
  la racine, comme les gates live existants, sans jamais l'exposer au client.
- Qualifier les deux entrées, la bascule EN/FR et une lecture d'image réelle.

### Hors périmètre

- Aucun changement de modèle, prompt, schéma d'extraction, politique
  pédagogique, stockage, géométrie, Realtime ou animation de mascotte.
- Aucune demande automatique de permission caméra au chargement : le navigateur
  la demande uniquement après l'action explicite de l'élève.
- Pas de `QA_REPORT.md` côté Builder et pas de `HANDOFF.md` sans reprise réelle.

### Gates requis

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend exec playwright test --grep-invert @live
```

### Preuves de clôture

- 36/36 tests ciblés photo/confirmation/minimisation, puis 615/615 tests Vitest
  sur 52 fichiers; lint, typecheck et build passent.
- Playwright hors `@live` passe 33/33. Le scénario mobile vérifie les deux
  entrées, leurs attributs, leur ordre clavier et la validation locale.
- L'eval OpenAI credentialed rend 7/7; deux appels à la route locale lancée avec
  l'environnement corrigé renvoient `ready`, dont un via la commande racine.
- La page ouverte bascule EN → FR et expose les deux actions traduites; la
  caméra est inactive tant que l'élève ne l'actionne pas.

## Archive — T9

## État de clôture

- T9 est close `pass` le 15 juillet 2026. Aucune carte Builder n'est active.
- L'ordre contractuel reste T9-C01 identité et atlas → T9-C02 intégration et
  événements → T9-C03 responsive, accessibilité et qualification navigateur.
- T9-C01 est close `pass` : atlas RGBA 8 × 9, 72 cellules non vides, scripts de
  validation et planche de contact inspectée. T9-C02 est close `pass` :
  contrôleur prioritaire, mappings fermés et 6/6 tests ciblés. T9-C03 est close
  `pass` après qualification responsive, mouvement réduit, EN/FR et navigateur.

## Périmètre vérifié

- Qualifier la présence flottante aux viewports 390, 768 et 1440 px sans
  débordement horizontal ni action principale masquée.
- Vérifier les libellés anglais/français et l'absence d'annonce live redondante.
- Figer la première pose de chaque état sous `prefers-reduced-motion: reduce`.
- Ajouter un scénario navigateur des neuf états et rejouer les gates historiques.

## Hors périmètre préservé

- Aucun changement de modèle, prompt produit, policy pédagogique, whitelist
  d'outils, géométrie, stockage, journal de preuve ou langue vocale.
- Pas de `QA_REPORT.md` côté Builder et pas de `HANDOFF.md` sans reprise réelle.

## Gates T9-C03

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend exec playwright test --grep-invert @live
```

## Preuves de clôture T9

- Les validateurs d'atlas passent avec 9 états, 8 frames par état, 72 cellules
  non vides, transparence RGBA et dimensions 1 536 × 1 872 px.
- Lint, typecheck et build passent; Vitest rend 615/615 tests sur 52 fichiers.
- Playwright hors `@live` rend 33/33, dont 3/3 scénarios T9 : neuf états sans
  modèle, bascule EN/FR, Axe ciblé sans violation, pose 0 sous mouvement réduit
  et reflow à 390 × 844, 768 × 1 024 et 1 440 × 900.
- Les captures `output/playwright/T9-mascot-hinting-*.png` ont été inspectées :
  mascotte entière, `pointer-events: none`, action principale utilisable et
  aucun débordement horizontal. Les preuves historiques T5/T6 ont été restaurées
  après le replay afin de ne pas les remplacer par des captures T9.

## Définition de fini T9

- C01 livre l'atlas et ses preuves visuelles; C02 branche les événements réels
  sans créer une nouvelle autorité métier; C03 qualifie reflow, clavier,
  mouvement réduit, EN/FR et non-régression des gates historiques.
- Le runtime n'appelle aucun modèle pour animer la mascotte et ne déduit jamais
  un état depuis un texte libre.
- Les événements tardifs, reset et unmount rendent la mascotte à un état sûr;
  une priorité déterministe empêche les animations concurrentes de clignoter.
- Les gates finaux restent lint, typecheck, Vitest, build et Playwright hors
  `@live`, complétés par une inspection à 390, 768 et 1440 px.

## Archive — T8

- T8 est close le 15 juillet 2026 avec verdict `pass`; Compass reste la seule
  marque publique et l'interface EN/FR éphémère demeure inchangée.
- L'ordre T8-C01 → T8-C02 → T8-C03 et les preuves consignées ci-dessous restent
  autoritatifs.

## Clôture de T8

- T8-C01 est close `pass` : les métadonnées, la marque et toute copie publique
  portent `Compass`; `LanguageProvider` garde un état EN/FR éphémère, met à
  jour `document.documentElement.lang` et affiche le drapeau de la langue cible
  en haut à droite. Les packages, globals et contrats internes GeoTutor restent
  stables.
- T8-C02 est close `pass` : shell, parcours, photo/confirmation, canvas,
  progrès, invariance, coach, fallbacks, diagnostics et mentions légales ont
  leurs variantes EN/FR. L'anglais reste le défaut déterministe; sortie libre
  du modèle et langue vocale restent hors périmètre.
- T8-C03 est close `pass` : lint, typecheck, build et 609/609 tests Vitest sur
  51 fichiers passent. Playwright collecte 37 scénarios, en ignore 7 `@live` et
  maintient les 30/30 scénarios historiques. Le test unitaire du switch couvre
  le retour EN et les valeurs `lang="fr"` puis `lang="en"`.
- Le CLI Playwright sur le build production valide le français à 390 × 844,
  768 × 1024 et 1440 × 900 sans débordement horizontal, avec zéro erreur et
  zéro avertissement console. Le parcours clavier atteint le switch, l'active,
  puis avance vers `Ajouter mon exercice`; les contrôles anglais de reflow,
  Axe et clavier restent couverts par le gate historique.
- Les captures `output/playwright/T8-Compass-fr-390x844.png`,
  `T8-Compass-fr-768x1024.png` et `T8-Compass-fr-1440x900.png` montrent la
  marque Compass et le bouton `🇬🇧 EN`. Aucun `QA_REPORT.md` ni `HANDOFF.md`
  Builder n'est créé.

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
