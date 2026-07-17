# Blueprint produit — Varignon comme activité adaptative de référence

## Source

- Document fourni : `/Users/vincentloreaux/Downloads/math.pdf`
- Empreinte SHA-256 :
  `4f10c5862107d5f0aa256678851d353c1c1d9c7e1eca6aaa78019801a0d61b03`
- Deux pages A4, vérifiées textuellement et visuellement le 17 juillet 2026.
- Énoncé central : identifier le polygone obtenu en joignant les milieux des
  côtés d'un quadrilatère quelconque.

Le document insiste sur le mot « quelconque » : l'élève doit dépasser une
figure statique, explorer des quadrilatères convexes, concaves et croisés,
conjecturer que le quadrilatère des milieux reste un parallélogramme, puis le
démontrer.

## Décision pédagogique

Varignon reste l'unique activité géométrique de référence jusqu'au pilote T27.
La profondeur prime sur l'élargissement du catalogue : Compass doit être capable
d'adapter le même problème à plusieurs difficultés d'élèves sans inventer une
nouvelle construction ni modifier l'autorité mathématique du harnais T22.

Une « variante » Varignon est une recette versionnée qui choisit uniquement :

- un niveau d'étayage ;
- une difficulté pédagogique ciblée ;
- un preset initial valide ;
- des formulations parmi un ensemble fermé ;
- une politique d'aide compatible avec O0 à O5 ;
- une question de transfert fermée.

Elle compile toujours vers le contrat `geometry_investigation.v1` et le template
`varignon.v1`. Le modèle ne produit ni commande GeoGebra, ni relation nouvelle,
ni mission libre.

## Ce que le harnais T22 couvre déjà

Le candidat `0c8e3f4` contient dans
`apps/frontend/lib/geometry-investigation/varignon.ts` :

| Besoin du PDF | Réalisation T22 |
|---|---|
| Construire les quatre milieux | V1 et quatre faits `midpoint` fondés sur les dépendances |
| Relier les milieux | V2 et observation du quadrilatère EFGH |
| Dépasser une figure statique | V3 à V5 avec drag et captures distinctes |
| Quadrilatère convexe | Classification et capture `convex` |
| Quadrilatère concave | Classification et capture `concave` |
| Quadrilatère croisé | Classification et capture `crossed` |
| Identifier le résultat | V6, conjecture locale de l'élève |
| Confirmer par manipulation | V7, deux parallélismes sur les trois captures |
| Démontrer | V8, sept étapes guidées par le théorème des milieux |
| Prolonger le raisonnement | V9, question de transfert sur les diagonales |

Les actions d'assistance déjà disponibles permettent d'observer, activer
l'outil Milieu, mettre en évidence les objets, classer la configuration,
vérifier une relation, capturer, restaurer et démontrer après consentement.

## Contrat pédagogique invariant

Chaque variante conserve les neuf missions dans le même ordre :

1. construire E, F, G et H comme milieux exacts de AB, BC, CD et DA ;
2. former EFGH ;
3. capturer un cas convexe ;
4. capturer un cas concave ;
5. capturer un cas croisé ;
6. formuler la conjecture ;
7. vérifier les deux paires de côtés opposés sur les trois captures ;
8. justifier avec le théorème des milieux ;
9. traiter une question de transfert.

Les invariants mathématiques restent :

- E, F, G et H possèdent une vraie dépendance `Midpoint` ;
- les configurations dégénérées ne sont pas créditées ;
- EF est parallèle à GH et FG est parallèle à HE dans chaque capture ;
- une capture est une preuve expérimentale, pas la démonstration universelle ;
- l'élève produit la conjecture et les étapes de justification ;
- une démonstration assistant ne crédite jamais une action élève.

## Matrice de variantes fermées

### Niveau d'étayage

| Recette | Politique | Comportement attendu |
|---|---|---|
| `varignon.guided.v1` | renforcée | questions fréquentes, activation d'outil permise, highlights temporaires, démonstration seulement après consentement |
| `varignon.standard.v1` | standard | premier blocage silencieux, aide progressive L1 à L4 selon répétition ou demande |
| `varignon.challenge.v1` | légère | aucune aide proactive matérielle, questions conceptuelles sur demande, démonstration finale après tentative |

### Difficulté ciblée

| Cible | Signal factuel | Adaptation autorisée |
|---|---|---|
| Milieu construit « à vue » | point sans dépendance `Midpoint` | insister sur l'outil et la dépendance, jamais corriger automatiquement |
| Généralisation trop rapide | conjecture avant les trois captures | demander les configurations manquantes et restaurer une capture si nécessaire |
| Confusion convexe/concave/croisé | classifications ou captures manquantes | questionner intersections et position du sommet, proposer une variation après consentement |
| Parallélisme non identifié | faits opposés manquants | mettre en évidence une paire de côtés puis demander le lien avec AC ou BD |
| Démonstration bloquée | étapes du théorème des milieux incomplètes | guider triangle par triangle, puis faire conclure l'élève |
| Transfert difficile | réflexion non complétée | choisir une question plus directe parmi les transferts fermés |

L'absence de signal signifie `inconnu`; elle ne devient jamais une difficulté
supposée.

### Presets initiaux

Les presets sont définis dans le produit, jamais par coordonnées modèle :

- `convex_default` : quadrilatère convexe non particulier et bien cadré ;
- `convex_asymmetric` : forme convexe moins prototypique ;
- `concave_start` : réservé à un parcours de reprise ou de remédiation ;
- `crossed_start` : réservé à un parcours de classification avancée.

Chaque preset doit être non dégénéré, classé par le moteur, contenu dans le
viewport sûr et permettre d'atteindre les trois configurations par déplacement
d'un seul sommet.

### Questions de transfert

Les côtés de EFGH sont parallèles aux diagonales du quadrilatère initial et
mesurent la moitié de leur longueur. Trois transferts peuvent donc être choisis
sans ajouter de commande arbitraire :

| ID | Question | Faits attendus |
|---|---|---|
| `transfer_rectangle.v1` | Quand EFGH est-il un rectangle ? | AC perpendiculaire à BD |
| `transfer_rhombus.v1` | Quand EFGH est-il un losange ? | AC et BD de même longueur |
| `transfer_square.v1` | Quand EFGH est-il un carré ? | AC perpendiculaire à BD et AC = BD |

Le transfert reste une réflexion élève dans le premier pilote. Une future
validation automatique ne pourra être ajoutée qu'avec un contrat déterministe
et des critères d'acceptation dédiés.

## Parcours professeur cible

1. Choisir Varignon dans la bibliothèque de référence.
2. Choisir classe, groupe ou élève pseudonyme.
3. Sélectionner ou accepter une difficulté issue de faits explicables.
4. Laisser Compass proposer recette, preset, politique d'aide et transfert.
5. Compiler et préflighter la variante sur le vrai harnais.
6. Prévisualiser les neuf missions et les aides autorisées.
7. Approuver puis affecter le contrat exact.
8. Consulter ensuite faits, captures, assistance et progression sans texte libre
   ni note.

## Parcours élève cible

1. Ouvrir l'affectation Varignon dans sa file de travail.
2. Construire les milieux et EFGH dans GeoGebra.
3. Transformer le quadrilatère initial et capturer les trois familles de formes.
4. Conjecturer le parallélogramme invariant.
5. Vérifier expérimentalement les parallélismes.
6. Démontrer avec les triangles ABC, CDA, BCD et DAB.
7. Répondre au transfert choisi par le professeur.
8. Reprendre plus tard depuis un checkpoint sûr si nécessaire.

## Écarts restant à construire

| Écart | Carte |
|---|---|
| Candidat T22 intégré à `main` et protégé, mais non déployé | T24-C03 |
| Classe, pseudonymes et affectations absents | T25-C01 à T25-C03 |
| File élève, reprise et bilan persistant absents | T25-C04 à T25-C06 |
| Registre de recettes Varignon absent | T26-C01 |
| Difficulté factuelle non calculée entre sessions | T26-C02 |
| Proposition structurée de variante absente | T26-C03 |
| Compilation et préflight de variante absents | T26-C04 |
| Approbation puis affectation adaptative absentes | T26-C05 |
| Gate couvrant la matrice de variantes absent | T26-C06 |

## Gate Varignon adaptatif

Le gate T26 exige au minimum :

- trois recettes d'étayage sur le même runtime et le même gateway ;
- les trois presets principaux classés sans état dégénéré ;
- les trois questions de transfert rendues depuis une allowlist ;
- proposition identique pour les mêmes faits et la même seed ;
- rejet de tout template, paramètre, relation ou commande inconnu ;
- préflight avec zéro helper, listener ou checkpoint orphelin ;
- aucune publication ni affectation sans approbation professeur ;
- trois golden journeys consécutifs sur le même candidat ;
- FR/EN, clavier, mouvement réduit et viewports 390/768/1440.

## Hors périmètre avant le pilote

- ajouter un second théorème ou un second template géométrique ;
- générer librement des missions ou des commandes GeoGebra ;
- modifier les tolérances mathématiques depuis l'interface professeur ;
- déduire une maîtrise, convertir les XP en niveau ou noter l'élève ;
- transmettre au professeur les formulations libres de conjecture ou de preuve ;
- laisser le modèle choisir des coordonnées, publier ou affecter seul.
