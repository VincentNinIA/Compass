# Compass - Spécification produit

## Besoin

Compass est un tuteur scolaire multimodal et voice-first. Il lit un exercice
photographié, en restitue fidèlement l'énoncé pour confirmation, puis accompagne
l'élève pas à pas quelle que soit la matière lisible. Son différenciateur
Education prioritaire devient l'investigation géométrique dynamique pilotée par
le professeur : l'élève construit, explore, conjecture et justifie dans
GeoGebra. Après le harnais T22, Compass doit relier cette investigation à une
boucle de classe limitée : affectation ciblée, reprise élève, bilan factuel et
proposition d'une prochaine variante approuvée par le professeur. Les autres
modules spécialisés restent optionnels et ne peuvent
revendiquer une vérification que lorsqu'un contrat déterministe compatible est
disponible.

## Utilisateurs

- Élève : comprendre un exercice sans recevoir immédiatement la solution,
  dans une interface rassurante qui lui indique toujours la prochaine action utile.
- Enseignant : préparer ou générer des exercices adaptés, transmettre des
  consignes pédagogiques au coach, régler l'autonomie et les aides d'une
  investigation GeoGebra, puis publier après prévisualisation.
- Jury : observer une boucle multimodale fiable, visible et démontrable de bout en bout.

## Expérience élève

- Dans la démonstration hackathon publique, l'accueil présente une seule action
  élève : lancer l'investigation Varignon préparée par le professeur. Aucun
  code de classe, pseudonyme, compte, ajout de devoir ou choix de bibliothèque
  ne précède l'ouverture de GeoGebra.
- Les parcours d'acquisition d'un devoir, de bibliothèque et de jonction à une
  classe restent des capacités internes ou pilotes; ils ne concurrencent plus
  le golden path montré au jury.
- L'interface publique parle d'exercice, de démarche, d'aide et de progrès;
  elle n'expose pas les noms de tranches, les frontières techniques ou les
  métriques de qualification dans le parcours principal.
- Le parcours principal tient dans quatre écrans successifs : accueil, ajout
  de la photo, vérification de la lecture, puis atelier avec Compass. Un seul
  écran métier est visible à la fois; aucun scroll n'est nécessaire pour
  découvrir l'étape suivante.
- L'interface publique existe en français et en anglais. Un contrôle compact à
  drapeau, placé en haut à droite, bascule immédiatement toute la copie visible
  et annonce la langue cible au clavier comme au lecteur d'écran.
- Une seule action principale domine chaque étape. Les actions secondaires et
  diagnostics restent disponibles sans concurrencer cette action.
- Les états vides expliquent quoi faire avec des mots simples. Les détails
  techniques utiles à la démonstration sont regroupés dans une zone repliable.
- La direction visuelle est jeune, chaleureuse et expressive, tout en restant
  lisible au clavier, à 200 % et sur mobile.
- Une mascotte humaine originale donne une présence visible à Compass. Ses
  animations reflètent uniquement des états applicatifs réels — réception de
  l'exercice, réflexion, écoute, parole, outil, indice, réussite ou erreur — et
  ne prétendent jamais qu'une action modèle est en cours lorsqu'elle ne l'est pas.
  Dans l'atelier GeoGebra, elle reste au repos entre deux événements, oriente
  son regard vers le dernier objet manipulé et joue des réactions finies plutôt
  qu'une boucle permanente.
- Chaque exercice confirmé devient une suite de missions jouables, quelle que
  soit la matière. Un compteur compact garde visibles les XP gagnés pendant la
  session et la prochaine mission à accomplir.
- Dans la boucle classe du pilote, l'élève rejoint un groupe par code sous un
  pseudonyme, voit uniquement ses affectations et peut reprendre un état sûr.

## Expérience enseignant

- Un bouton `Espace professeur` reste disponible en haut à droite sans
  concurrencer le parcours élève.
- L'interface s'adresse à l'enseignant avec des verbes d'action et un mode
  d'emploi en trois étapes. Elle n'affiche ni modèle, API, budget d'appel,
  schéma, serveur ou jargon de contrôle interne.
- Le professeur peut partir d'une photo d'exercice ou d'un bref décrivant la
  matière, le niveau, la thématique et les difficultés de l'élève.
- Compass produit un brouillon structuré : énoncé, missions ordonnées, objectif,
  obstacles probables et stratégie d'accompagnement. Le professeur relit et
  peut modifier le brouillon avant toute publication.
- L'assistance agentique est frugale : un seul appel de génération borné, puis
  des contrôles locaux spécialisés jouent les rôles de didacticien, adaptateur
  de difficulté, contrôleur de sécurité et contrôleur de coût. Cette mécanique
  reste interne; la surface montre seulement les résultats utiles à la relecture.
- Le catalogue partagé éphémère reste l'état T22. La phase suivante ajoute une
  identité professeur limitée, des classes à élèves pseudonymes et des
  affectations par classe, groupe ou élève, sans construire un LMS complet.
- Pour une investigation GeoGebra, le professeur choisit une activité validée,
  le niveau, les difficultés ciblées et la politique d'aide. Il prévisualise le
  vrai parcours avant publication; il ne modifie ni les tolérances, ni les
  permissions, ni les commandes internes.
- Le théorème de Varignon est l'activité unique de référence jusqu'au pilote,
  avec exploration de quadrilatères convexes, concaves et croisés. L'adaptation
  porte sur l'étayage, la difficulté, le preset et le transfert, pas sur un autre
  théorème.

## Parcours principal

1. Depuis l'accueil public de démonstration, l'élève lance l'exercice Varignon
   du professeur avec une seule action visible.
2. L'application construit localement la publication v2 validée et ouvre le
   vrai atelier GeoGebra sans code, pseudonyme, cookie élève ou écriture serveur.
3. L'élève suit les neuf missions, manipule la figure et demande une aide à
   Compass si nécessaire.
4. Le retour à la démo retrouve le même accueil simplifié. L'acquisition photo,
   la bibliothèque et la classe restent disponibles hors de ce golden path.
5. Le coach reste immédiatement accessible dans l'atelier, avec une action voix
   visible; il demande où l'élève en est, découpe le travail et fournit le plus
   petit indice utile sans donner immédiatement toute la solution.
6. Pour un exercice mathématique ou géométrique, GeoGebra occupe la surface
   principale de l'atelier. Le coach sait explicitement que l'élève travaille
   dans l'applet et n'évoque jamais de règle, compas ou rapporteur physiques.
7. À la demande explicite de l'élève, le coach peut inspecter l'inventaire borné
   du tableau ou créer une droite, une demi-droite ou un segment entre des points
   déjà présents via des outils sémantiques fermés. Il ne corrige ni ne note la
   construction et ne dispose d'aucune commande GeoGebra arbitraire.
8. L'atelier GeoGebra prend toute la largeur utile. Le coach forme une barre
   horizontale au-dessus du plan et les missions une barre horizontale sous le
   plan; aucune colonne latérale permanente ne réduit la zone de construction.
9. Après un premier geste explicite ouvrant la voix, Compass peut prononcer une
   courte introduction. L'application n'ouvre jamais le microphone seule.
10. Si aucun support ne correspond, l'interface reste honnête : elle
   accompagne par la conversation sans prétendre observer ou corriger un outil.
11. Le parcours historique médiatrice reste un module spécialisé interne et ne
    constitue plus le défaut de la surface publique.
12. Une publication `geometry_investigation.v1` initialise un scaffold approuvé,
    observe les dépendances, vérifie les relations compatibles, capture plusieurs
    états expérimentaux et guide séparément conjecture puis démonstration.
13. Dans le pilote de classe, le professeur affecte le contrat exact à des
    destinataires pseudonymes; l'élève le retrouve, le reprend et le termine.
14. Les faits déterministes et aides effectivement livrées alimentent un bilan
    minimal; le professeur décide ensuite de l'activité suivante.
15. Une proposition adaptative ne peut choisir qu'une recette versionnée sous
    `varignon.v1` et ses paramètres bornés. Compilation, préflight et
    approbation précèdent toujours l'affectation.

## Exigences fonctionnelles

| ID | Exigence |
|---|---|
| FR-01 | Accepter une image via deux actions explicites : choisir un fichier ou ouvrir la caméra arrière de l'appareil. |
| FR-02 | Extraire instruction, données, cible, relations et objectif dans un contrat validé. |
| FR-03 | Fournir une conversation vocale bidirectionnelle avec interruption. |
| FR-04 | Embarquer GeoGebra Geometry et obtenir son API JavaScript. |
| FR-05 | Observer add/remove/click et les mouvements terminés sans appel modèle par pixel. |
| FR-06 | Sérialiser un état normalisé des objets et actions. |
| FR-07 | Exposer uniquement des outils produit whitelistés et validés. |
| FR-08 | Vérifier perpendicularité, milieu, appartenance et égalité de longueurs. |
| FR-09 | Fournir une échelle d'aide progressive et réversible. |
| FR-10 | Tester numériquement une propriété sur plusieurs positions. |
| FR-11 | Créer des checkpoints et restaurer sans perdre le travail élève. |
| FR-12 | Produire une synthèse concise fondée sur le journal de preuves. |
| FR-13 | Rendre inspectables les niveaux d'aide et propriétés vérifiées en extension. |
| FR-14 | Permettre un second template en extension, sans le construire dans le MVP. |
| FR-15 | Décider localement `SILENT`, `QUEUE` ou `SPEAK`. |
| FR-16 | Mettre à jour le progrès visuel sans aller-retour modèle. |
| FR-17 | Annuler une intervention pending ou active lorsque l'élève reprend la main. |
| FR-18 | Afficher une mascotte animée corrélée aux événements réels du parcours, avec huit frames par animation, des séquences finies sans boucle permanente et un état immobile accessible sous mouvement réduit. |
| FR-19 | Accepter tout exercice scolaire lisible sans branche de rejet liée à la matière. |
| FR-20 | Confirmer un résumé générique borné avant de transmettre l'exercice au coach. |
| FR-21 | Fournir un mode de tutorat général sans outil ni fausse validation spécialisée. |
| FR-22 | Séparer l'accueil, l'acquisition, la vérification et l'atelier en quatre écrans sans long scroll métier. |
| FR-23 | Dans l'atelier mathématique, garder le coach et la voix en tête puis fournir un tableau GeoGebra vierge sans revendiquer d'observation automatique. |
| FR-24 | Dans l'atelier mathématique, donner à GeoGebra au moins 65 % de la largeur utile sur grand écran et ordonner coach, tableau puis tâches sur mobile. |
| FR-25 | Fournir un profil Realtime conscient de GeoGebra avec inventaire borné et création sémantique de droite, demi-droite ou segment, sans commande arbitraire ni validation implicite. |
| FR-26 | Dans l'atelier GeoGebra, réserver toute la largeur utile au plan entre une barre coach supérieure et un rail de missions inférieur. |
| FR-27 | Publier vers le coach un état initial borné puis des deltas stabilisés sur ajout, suppression, renommage, style, clic et fin de déplacement, sans appel modèle par pixel. |
| FR-28 | Exposer des actions GeoGebra supplémentaires uniquement par fonctions sémantiques fermées, explicites, budgétées, annulables et sans commande libre. |
| FR-29 | Afficher une progression de missions et des récompenses uniquement à partir de relations déterministes disponibles pour l'exercice courant. |
| FR-30 | Transformer toutes les tâches confirmées, quelle que soit la matière, en missions séquentielles pouvant être déclarées terminées par l'élève sans être présentées comme vérifiées. |
| FR-31 | Conserver en mémoire un ledger XP cumulatif et idempotent pour la session : 10 XP par mission déclarée terminée, portés à 20 XP lorsqu'une preuve déterministe compatible existe, sans retrait des points déjà acquis. |
| FR-32 | Afficher le total XP de session dans l'atelier et le score de l'exercice courant, avec des libellés distincts pour `terminé` et `vérifié`. |
| FR-33 | Afficher en haut à droite un accès professeur et proposer à l'élève, sur l'accueil hackathon, un unique départ vers l'exercice Varignon préparé. |
| FR-34 | Permettre au professeur de fournir soit une image d'exercice, soit un brief matière/niveau/thématique/difficultés avec des consignes pédagogiques optionnelles. |
| FR-35 | Produire en un appel modèle maximum un brouillon structuré, éditable et non publié par défaut, avec missions, objectif, obstacles et aides graduées. |
| FR-36 | Publier un exercice validé par le professeur dans un catalogue serveur borné et éphémère, lisible par le parcours élève sans notion de classe. |
| FR-37 | Transmettre au coach les consignes professeur comme contexte pédagogique non fiable, sans élargir les outils, permissions ou affirmations de vérification. |
| FR-38 | Garantir une orchestration frugale : modèle `gpt-5.6-luna`, effort faible, `store:false`, outils vides, sortie structurée et aucune conversation inter-agent. |
| FR-39 | Demander une trace courte de démarche avant tout crédit XP auto-déclaré, puis une réponse de transfert à la fin de l'exercice, sans noter ni publier les textes saisis. |
| FR-40 | Pour un exercice professeur, rendre dans le même onglet un bilan anonyme et factuel de session limité aux comptes terminé/vérifié, aux XP et aux statuts de réflexion. |
| FR-41 | Réinitialiser scroll et focus à chaque écran et garantir qu'à 390 px mascotte, rail de missions et éléments décoratifs ne masquent aucune action principale. |
| FR-42 | Valider un contrat fermé `geometry_investigation.v1` décrivant scaffold, missions, relations, aides, démonstration et transfert. |
| FR-43 | Publier un monde GeoGebra v2 borné avec commandes, parents, ownership, événements terminaux, faits, epoch, révision et hash. |
| FR-44 | Permettre au coach d'activer un outil autorisé, recentrer la vue et mettre temporairement en évidence des objets sans créer de construction. |
| FR-45 | Initialiser un scaffold approuvé et créer, après consentement, une variation convexe, concave ou croisée choisie par intention sémantique plutôt que coordonnées modèle. |
| FR-46 | Classer déterministement un quadrilatère ordonné en convexe, concave, croisé ou dégénéré avec tolérance versionnée. |
| FR-47 | Vérifier par faits déterministes milieu, parallélisme, perpendicularité, égalité de longueurs, appartenance, non-alignement et parallélogramme. |
| FR-48 | Capturer en mémoire un état expérimental tout-ou-rien avec checkpoint, snapshot, hash, configuration, provenance et evidence IDs. |
| FR-49 | Restaurer exactement une capture et rejouer une démonstration temporaire avec pause, arrêt et cleanup vérifié. |
| FR-50 | Appliquer les niveaux d'autorité O0 à O5, budgets, consent tokens, idempotence, annulation et rejet du stale à toutes les actions du harnais. |
| FR-51 | Piloter missions, tentatives, aides L1 à L4 et progression depuis le contrat d'activité plutôt que depuis un exercice codé en dur. |
| FR-52 | Livrer Varignon comme parcours golden : quatre milieux exacts, trois configurations capturées, deux parallélismes par état, conjecture, justification et transfert. |
| FR-53 | Permettre au professeur de configurer, prévisualiser et publier Varignon puis recevoir un bilan factuel sans identité, texte libre ou note. |
| FR-54 | Unifier le harnais public en réutilisant adapter, snapshots, ownership, checkpoints, highlights, preuves, policy et arbitre historiques sans créer un runtime parallèle durable. |
| FR-55 | Qualifier le nouveau harnais sur trois golden journeys consécutifs, EN/FR, clavier, mouvement réduit, zoom 200 % et viewports 390/768/1440. |
| FR-56 | Intégrer le candidat T22 dans la branche de référence, déployer son artefact exact et conserver une identité source/build/runtime vérifiable. |
| FR-57 | Ouvrir la démonstration publique sans code applicatif, limiter les écritures API coûteuses par le WAF et ne jamais exposer secret, token ou contenu élève. |
| FR-58 | Permettre à un professeur authentifié dans le pilote de créer, archiver et administrer une classe limitée. |
| FR-59 | Permettre à un élève de rejoindre une classe par code rotatif sous un pseudonyme, sans compte nominatif ni accès au roster. |
| FR-60 | Affecter une activité versionnée à une classe, un groupe ou un élève pseudonyme avec dates et politique d'aide bornées. |
| FR-61 | Afficher à l'élève ses affectations et restaurer un checkpoint sûr après vérification d'activité, version, hash et ownership. |
| FR-62 | Persister uniquement les faits, missions, configurations, aides et statuts nécessaires à un bilan professeur factuel. |
| FR-63 | Définir et appliquer isolation, minimisation, expiration, révocation et suppression en cascade pour toutes les données de classe. |
| FR-64 | Publier un registre de recettes Varignon versionnées, paramétrées et compilables vers le template exact `varignon.v1` de `geometry_investigation.v1`. |
| FR-65 | Produire un profil de difficultés explicable uniquement à partir de faits déterministes, en conservant l'état `inconnu` lorsque les preuves manquent. |
| FR-66 | Proposer en un appel modèle maximum une recette Varignon et ses paramètres structurés, sans autre template, commande GeoGebra, texte libre élève ni publication automatique. |
| FR-67 | Compiler et préflighter localement chaque variante sur le vrai harnais avant de la rendre prévisualisable. |
| FR-68 | Exiger la prévisualisation et l'approbation explicite du professeur avant toute affectation d'une variante générée. |
| FR-69 | Livrer une matrice Varignon fermée avec trois niveaux d'étayage, des presets locaux sûrs et les transferts rectangle, losange ou carré, sans modifier les neuf missions ni les relations invariantes. |
| FR-70 | Qualifier la boucle classe et la fabrique adaptative par golden journeys, puis par un pilote avec un professeur et au moins trois élèves pseudonymes. |
| FR-71 | Dans l'atelier Varignon public, rendre Compass animé dans le coach pendant les états voix/outils et par apparitions finies dans le plan lors des actions élève, aides, changements de mission et preuves vérifiées, avec interpolation visuelle des huit frames, aucune réaction négative à la première erreur et aucune obstruction des contrôles. |
| FR-73 | Pour éviter tout effet diaporama, rendre chaque activité de Compass avec une pose d'atlas stable et des micro-mouvements CSS composités; la parole live peut consommer uniquement un niveau d'énergie audio éphémère, avec fallback déterministe, sans boucle de frames React, transcript ou stockage audio. |
| FR-72 | Dans une investigation GeoGebra, laisser Compass choisir spontanément une question, un conseil ou une action d'interface O2 réversible à partir du monde borné et de la mission courante, notamment à la connexion, après une mission franchie ou sur un blocage qualifié, sans exiger une demande d'aide préalable et sans étendre son autorité aux mutations, preuves ou scores. |
| FR-74 | Pour toute action O2 choisie par Compass, localiser la cible sémantique dans le vrai applet et montrer temporairement le bouton d'outil, l'objet, le segment ou la zone concernés par un halo, un pointeur et un texte accessible, sans coordonnée modèle, interception de pointeur ni effet persistant. |
| FR-75 | Lorsqu'un élève manipule GeoGebra pendant une réponse, préempter immédiatement la voix depuis le geste brut, puis n'autoriser un nouveau feedback que depuis le monde doublement stabilisé qui porte activité, epoch, révision et hash courants. |

## Contraintes

- Tout exercice lisible est accepté dans le mode général; un exercice illisible
  ou contradictoire demande une clarification ciblée.
- L'application, pas le modèle, possède l'autorité de prise de parole proactive.
- Aucune affirmation géométrique sans preuve déterministe.
- Une capture dynamique est nommée preuve expérimentale et ne devient jamais
  automatiquement une démonstration universelle.
- Aucun outil de commande GeoGebra arbitraire.
- Les hints sont temporaires ou restaurables; les actions destructives exigent une intention explicite.
- Jusqu'à T24 inclus, images, checkpoints, journaux et XP restent en mémoire.
  T25 ne persiste ensuite que les champs explicitement allowlistés par FR-62 et
  FR-63, avec durée de conservation et suppression testées.
- Le catalogue professeur est borné et conservé uniquement dans la mémoire du
  processus serveur; un redémarrage l'efface. Cette limite technique ne domine
  pas le parcours enseignant ou élève.
- Un brouillon enseignant ne déclenche jamais plus d'un appel modèle. Les rôles
  de contrôle supplémentaires sont des validateurs locaux sans coût modèle.
- Les textes de démarche et de transfert restent dans le composant élève : le
  bilan professeur n'en expose que le statut complété ou en attente.
- Les textes de démarche, transfert, audio, images, transcripts et checkpoints
  Base64 ne sont jamais persistés dans le dossier d'apprentissage ni transmis
  au modèle de génération adaptative.
- Les variantes adaptatives restent sous `varignon.v1`, dans des recettes
  versionnées et avec les capacités déterministes réellement présentes dans le
  harnais. Aucun second template n'est ouvert avant le pilote.
- Le prototype est non commercial et affiche l'attribution GeoGebra.
- Le changement de langue reste un état de session en mémoire et n'ajoute aucun
  stockage navigateur.
- Les animations de la mascotte utilisent des assets statiques locaux; ils n'ajoutent
  aucun appel modèle au runtime, aucun tracking et aucune autorité métier.

## Non-objectifs

- Garantir une vérification déterministe automatique pour toutes les matières.
- Générer ou exécuter automatiquement un outil spécialisé pour un exercice non
  reconnu par un contrat applicatif fermé.
- Construire un LMS complet, un SSO établissement, une administration scolaire,
  un compte élève nominatif, un portail parent ou une facturation.
- Fournir une notation à enjeu élevé.
- Garantir une licence GeoGebra commerciale ou une préparation production.
- Persister des médias, textes libres, transcripts, identités réelles ou un
  historique élève non borné.
- Transmettre au professeur le texte libre saisi par l'élève, inférer sa maîtrise
  ou convertir les XP en note.
- Générer universellement toute activité GeoGebra depuis un brief libre, utiliser
  le CAS ou la 3D, ou prouver symboliquement tout théorème dans le MVP Varignon.
- Ajouter un second théorème ou un second template d'investigation avant le
  pilote Varignon T27.

## Critères globaux

- Trois démonstrations live consécutives sur le même build.
- Première erreur : aucune parole proactive.
- Seconde action avec même blocage : une intervention L1 et une seule.
- Zéro exécution d'outil hors whitelist.
- Toutes les affirmations géométriques du parcours golden sont liées à des preuves.
- Reset exact vers A/B/AB et suppression de tous les helpers.
- Un fallback explicite existe pour micro ou API indisponible, sans se présenter comme live.
- Aucun libellé de tranche (`T0` à `T6`), jargon WebRTC, identifiant de preuve ou
  budget de latence ne domine le parcours élève.
- À l'arrivée, l'élève identifie immédiatement l'unique action de départ vers
  Varignon, sans documentation, compte, code de classe ou choix concurrent.
- Le parcours reste utilisable à 390 px, 768 px et 1440 px, au clavier et avec
  `prefers-reduced-motion`.
- Le changement EN/FR conserve le même parcours, les mêmes actions et les mêmes
  garanties d'accessibilité sans débordement dans les deux langues.
- La mascotte conserve une identité stable sur les neuf états et l'atlas source
  possède exactement huit cellules par état. Le runtime sélectionne une pose
  stable plutôt que de faire défiler ces cellules; `prefers-reduced-motion`
  force la cellule zéro et masque les accents sans retirer l'état visible.
- Dans Varignon, la présence coach reste visible au repos; parler, écouter,
  réfléchir, modifier et guider sont perceptibles pendant l'état applicatif
  exact. Le dernier objet élève stabilisé oriente une apparition silencieuse;
  une mission ne reçoit une épingle et une célébration qu'à son premier passage
  déterministe à `verified`, jamais sur un simple statut `completed`.
- Les actions `activate_geometry_tool`, `highlight_geometry_objects` et
  `focus_geometry_view` ne requièrent ni consentement, ni actor assistant, ni
  déclaration par mission : elles restent non mutantes, allowlistées, ancrées à
  la révision, budgétées et annulables. Toute action O3–O5 conserve ses
  confirmations et tentatives préalables.
- Chaque geste O2 rend sa cible compréhensible : le vrai contrôle GeoGebra est
  révélé et entouré, un objet ou segment est pointé depuis le monde et ses
  dépendances, et une zone cadrée reçoit un repère temporaire. Le modèle ne
  fournit aucun pixel; texte, cleanup, mouvement réduit et `pointer-events:none`
  restent obligatoires.
- Une occasion proactive n'est ouverte qu'à la connexion, lors d'une transition
  de mission ou d'un blocage qualifié. Elle transporte un événement fermé et
  courant; le modèle choisit la formulation et l'éventuelle action O2, tandis
  qu'un geste ou une parole élève annule immédiatement le travail en cours.
- Le geste learner brut annule réponse, outils, file et audio avant la fenêtre
  de coalescence. Il ne vaut jamais preuve : seul le commit à deux snapshots
  peut avancer la mission, et tout tour coach ancré sur un monde antérieur est
  supprimé avant émission ou rejeté à son retour.
- Sur mobile, l'élève distingue le choix d'une image existante de l'ouverture
  de la caméra arrière; les deux sources suivent la même validation locale.
- Une photo lisible de géométrie multi-étapes, d'algèbre ou d'une autre matière
  atteint la confirmation sans statut `unsupported` lié au domaine.
- Après confirmation d'un exercice générique, aucune surface médiatrice,
  progression 0/2 ou expérience PA/PB n'est imposée; le coach reçoit le contexte
  borné et n'a accès à aucun outil GeoGebra.
- Depuis l'accueil de démo, l'unique action principale remplace l'écran courant
  par l'atelier Varignon; les parcours historiques ne sont pas empilés dessous.
- Après confirmation d'un exercice de mathématiques ou de géométrie, GeoGebra
  occupe toute la largeur utile entre le coach et les missions; sur mobile, le
  coach précède le tableau, puis les tâches, sans débordement.
- Le profil GeoGebra connaît l'énoncé confirmé et l'outil intégré, ne recommande
  aucun instrument physique, peut créer une seule droite/demi-droite/segment par
  tour à la demande explicite et échoue sans mutation si un point manque.
- Pour un exercice de toute matière avec plusieurs tâches, l'élève peut avancer
  mission par mission et gagner 10 XP de progression par tâche. Une preuve
  déterministe porte la récompense de cette même tâche à 20 XP, sans double
  crédit; le total de session reste visible lorsqu'un nouvel exercice commence.
- Un professeur peut générer ou extraire un brouillon, le corriger puis le
  publier; un nouvel élève voit cet exercice dans la bibliothèque et le lance
  avec les consignes pédagogiques transmises au coach.
- Le coût d'un brouillon reste borné à un appel `gpt-5.6-luna` sans outil ni
  boucle agentique, avec un fallback manuel lorsque l'API n'est pas disponible.
- Pour une mission auto-déclarée, le bouton de crédit reste inactif tant que
  l'élève n'a pas décrit brièvement sa démarche; après la dernière mission, une
  question de transfert est proposée et son texte ne quitte pas le workspace.
- Après un exercice publié par un professeur, le même onglet peut afficher dans
  l'espace professeur un bilan anonyme exact des missions terminées/vérifiées,
  des XP et des statuts de réflexion, sans nom, réponse libre, note ou stockage.
- Chaque transition `landing/upload/confirm/work/teacher/library` replace le
  viewport en haut et le focus sur le titre; à 390 px la mascotte flottante et
  le rail de missions laissent les appels à l'action lisibles et activables.
- Pour Varignon, un point libre placé visuellement au milieu ne satisfait pas la
  mission; les quatre points doivent dépendre exactement de leurs extrémités.
- Les configurations convexe, concave et croisée sont classées et capturées sur
  des révisions distinctes, tandis qu'un état dégénéré demande un nouveau drag.
- Chaque capture Varignon porte deux faits de parallélisme et une provenance
  élève; une démonstration assistant ne crédite pas une manipulation élève.
- L'activation de l'outil Milieu et un highlight L3 ne créent aucun objet et
  restaurent outil, couleurs, épaisseurs et viewport au cleanup.
- Une restauration de capture réconcilie hash, inventaire, ownership et
  listeners; tout échec ferme la voie avant publication d'un faux succès.
- Le bilan professeur indique configurations, milieux, parallélismes, niveau
  d'aide et statuts de conjecture/justification/transfert, sans texte libre,
  identité ni note.
- Une publication `geometry_investigation.v1` ouvre publiquement le harnais v2
  exact sans flag et fournit au coach seulement le monde borné, la mission, les
  preuves manquantes et le niveau d'aide autorisé ; l'application seule avance
  les missions et attribue les XP.
- Trois parcours Varignon consécutifs sans retry doivent conserver le même
  candidat/environnement, restaurer hash/inventaire/ownership/listeners, finir
  sans helper ni ressource, et produire uniquement des manifests fermés.
- Un professeur peut créer une classe pilote, affecter le même contrat exact à
  un groupe ou à un alias et consulter ensuite un bilan factuel isolé.
- Deux élèves pseudonymes ne peuvent lire ni affectations, checkpoints ou faits
  l'un de l'autre; révocation, expiration et suppression sont observables.
- Une variante adaptative invalide ne dépasse jamais le compilateur; une variante
  valide n'est affectée qu'après prévisualisation et approbation professeur.
- Les recettes `guided`, `standard` et `challenge`, les presets sûrs et les
  trois transferts Varignon passent le même golden sans runtime, gateway ou
  autorité parallèle.

## Hypothèses validées

- Interface publique bilingue anglais/français; la langue des services vocaux
  reste gouvernée séparément par les contrats Realtime existants.
- Nom public : Compass. Les identifiants techniques historiques `GeoTutor` et
  `__GEOTUTOR_*` restent stables tant qu'ils ne sont pas visibles par l'élève.
- Application web Next.js avec petites routes serveur. L'état T22 reste sans
  base; T25 retient PostgreSQL 16 derrière un port serveur après fermeture des
  contrats, accès, migrations, rétention et suppression. Aucun fournisseur
  cloud n'est provisionné par T25-C01.
- Le contrat Varignon v1 reste le seul template jusqu'au pilote. T26 ajoute des
  recettes d'étayage, presets et transferts fermés basés sur les faits
  déterministes déjà disponibles.
- Le pilote utilise une identité professeur limitée et des élèves pseudonymes;
  aucune identité scolaire réelle n'est nécessaire à la validation produit.
- Modèles : `gpt-realtime-2.1` pour la voix, `gpt-5.6-terra` pour l'extraction
  d'exercice élève et `gpt-5.6-luna` pour le brouillon professeur frugal.
