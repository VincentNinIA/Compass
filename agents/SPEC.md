# Compass - Spécification produit

## Besoin

Compass est un tuteur scolaire multimodal et voice-first. Il lit un exercice
photographié, en restitue fidèlement l'énoncé pour confirmation, puis accompagne
l'élève pas à pas quelle que soit la matière lisible. Les modules spécialisés,
comme GeoGebra pour la géométrie, restent optionnels et ne peuvent revendiquer
une vérification que lorsqu'un contrat déterministe compatible est disponible.

## Utilisateurs

- Élève : comprendre un exercice sans recevoir immédiatement la solution,
  dans une interface rassurante qui lui indique toujours la prochaine action utile.
- Enseignant : disposer d'actions et de propriétés vérifiées, sans notation à enjeu élevé.
- Jury : observer une boucle multimodale fiable, visible et démontrable de bout en bout.

## Expérience élève

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

## Parcours principal

1. Depuis l'accueil, l'élève choisit d'ajouter un exercice et atteint un écran
   dédié à la galerie ou à la caméra.
2. L'application extrait la matière, le titre, l'énoncé et les tâches dans leur
   ordre, puis affiche un écran de vérification dédié.
3. Après confirmation seulement, Compass ouvre l'atelier et transmet cet
   exercice comme contexte non fiable au coach généraliste.
4. Le coach reste immédiatement accessible dans l'atelier, avec une action voix
   visible; il demande où l'élève en est, découpe le travail et fournit le plus
   petit indice utile sans donner immédiatement toute la solution.
5. Pour un exercice mathématique ou géométrique, GeoGebra occupe la surface
   principale de l'atelier. Le coach sait explicitement que l'élève travaille
   dans l'applet et n'évoque jamais de règle, compas ou rapporteur physiques.
6. À la demande explicite de l'élève, le coach peut inspecter l'inventaire borné
   du tableau ou créer une droite, une demi-droite ou un segment entre des points
   déjà présents via des outils sémantiques fermés. Il ne corrige ni ne note la
   construction et ne dispose d'aucune commande GeoGebra arbitraire.
7. L'atelier GeoGebra prend toute la largeur utile. Le coach forme une barre
   horizontale au-dessus du plan et les missions une barre horizontale sous le
   plan; aucune colonne latérale permanente ne réduit la zone de construction.
8. Après un premier geste explicite ouvrant la voix, Compass peut prononcer une
   courte introduction. L'application n'ouvre jamais le microphone seule.
9. Si aucun support ne correspond, l'interface reste honnête : elle
   accompagne par la conversation sans prétendre observer ou corriger un outil.
10. Le parcours historique médiatrice reste un module spécialisé interne et ne
   constitue plus le défaut de la surface publique.

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

## Contraintes

- Tout exercice lisible est accepté dans le mode général; un exercice illisible
  ou contradictoire demande une clarification ciblée.
- L'application, pas le modèle, possède l'autorité de prise de parole proactive.
- Aucune affirmation géométrique sans preuve déterministe.
- Aucun outil de commande GeoGebra arbitraire.
- Les hints sont temporaires ou restaurables; les actions destructives exigent une intention explicite.
- Les images, checkpoints et journaux restent en mémoire pour le prototype.
- Le prototype est non commercial et affiche l'attribution GeoGebra.
- Le changement de langue reste un état de session en mémoire et n'ajoute aucun
  stockage navigateur.
- Les animations de la mascotte utilisent des assets statiques locaux; ils n'ajoutent
  aucun appel modèle au runtime, aucun tracking et aucune autorité métier.

## Non-objectifs

- Garantir une vérification déterministe automatique pour toutes les matières.
- Générer ou exécuter automatiquement un outil spécialisé pour un exercice non
  reconnu par un contrat applicatif fermé.
- Construire un LMS, une authentification ou un dashboard enseignant complet.
- Fournir une notation à enjeu élevé.
- Garantir une licence GeoGebra commerciale ou une préparation production.
- Persister des données d'élèves ou des médias.

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
- À l'arrivée, l'élève identifie l'action de départ et les trois étapes du
  parcours sans devoir parcourir une documentation technique.
- Le parcours reste utilisable à 390 px, 768 px et 1440 px, au clavier et avec
  `prefers-reduced-motion`.
- Le changement EN/FR conserve le même parcours, les mêmes actions et les mêmes
  garanties d'accessibilité sans débordement dans les deux langues.
- La mascotte conserve une identité stable sur les neuf états, chaque animation
  possède exactement huit frames et `prefers-reduced-motion` affiche une pose
  fixe sans masquer l'état visible.
- Sur mobile, l'élève distingue le choix d'une image existante de l'ouverture
  de la caméra arrière; les deux sources suivent la même validation locale.
- Une photo lisible de géométrie multi-étapes, d'algèbre ou d'une autre matière
  atteint la confirmation sans statut `unsupported` lié au domaine.
- Après confirmation d'un exercice générique, aucune surface médiatrice,
  progression 0/2 ou expérience PA/PB n'est imposée; le coach reçoit le contexte
  borné et n'a accès à aucun outil GeoGebra.
- Depuis l'accueil, chaque action principale remplace l'écran courant; la photo,
  le résumé puis l'atelier ne sont jamais empilés dans une page longue.
- Après confirmation d'un exercice de mathématiques ou de géométrie, GeoGebra
  occupe toute la largeur utile entre le coach et les missions; sur mobile, le
  coach précède le tableau, puis les tâches, sans débordement.
- Le profil GeoGebra connaît l'énoncé confirmé et l'outil intégré, ne recommande
  aucun instrument physique, peut créer une seule droite/demi-droite/segment par
  tour à la demande explicite et échoue sans mutation si un point manque.

## Hypothèses validées

- Interface publique bilingue anglais/français; la langue des services vocaux
  reste gouvernée séparément par les contrats Realtime existants.
- Nom public : Compass. Les identifiants techniques historiques `GeoTutor` et
  `__GEOTUTOR_*` restent stables tant qu'ils ne sont pas visibles par l'élève.
- Application web Next.js avec petites routes serveur et sans base de données.
- Modèles : `gpt-realtime-2.1` pour la voix et `gpt-5.6-terra` pour l'extraction d'image.
