# Contrat de données de la classe pilote

## Frontière

T25 persiste uniquement ce qui est nécessaire pour affecter une activité
approuvée, reprendre un état sûr et rendre un bilan factuel. La classe et ses
aliases ne dépendent d'aucun exercice. Le store n'est ni un dossier scolaire,
ni un historique de conversation, ni une base GeoGebra brute.

La première version est `classroom_store.v1`. Les schémas exécutables vivent
dans `apps/frontend/lib/classroom/contracts.ts`; toute écriture passe par leur
parsing strict et par le scanner de données interdites. Les publications
professeur conservent le contrat Varignon exact approuvé. Les données élève ne
conservent que faits, statuts et compteurs allowlistés.

## Stockage retenu

L'autorité persistante cible est PostgreSQL 16, derrière un port
`ClassroomStoreV1` appelé uniquement côté serveur. Ce choix apporte transactions,
clés étrangères, unicité et `ON DELETE CASCADE`, tout en restant disponible dans
un runtime serverless via un fournisseur PostgreSQL managé.

Le dépôt ne provisionne aucun fournisseur et ne place aucune URL de base dans
Git ou Vercel. T25-C02 branche `PostgresClassroomPilotStoreV1` sur le port
serveur. `MemoryClassroomPilotStoreV1` est réservé aux tests explicites et est
refusé en Vercel Production. Les migrations `0001_classroom_v1`,
`0002_classroom_pilot` puis `0003_class_assignments` sont exécutées avec `pg-mem`; le runbook opérateur est
`docs/CLASSROOM_PILOT_RUNBOOK.md`.

Le catalogue professeur éphémère T22 reste distinct. Une publication n'entre
dans le store de classe qu'après création explicite d'un `ClassActivityTemplateV1`;
aucun mélange silencieux ou fallback vers la mémoire globale n'est autorisé.

## Entités

| Entité | Autorité | Finalité | Expiration maximale |
|---|---|---|---|
| `TeacherIdentityV1` | système | Propriétaire pseudonyme des classes, sans email stocké | 180 jours |
| `ClassroomV1` | professeur | Classe pilote, état et hash du code rotatif | 90 jours; hash 24 h maximum |
| `ClassroomGroupV1` | professeur | Sous-ensemble d'aliases pour une affectation | durée de la classe |
| `LearnerAliasV1` | élève puis professeur pour révocation | Pseudonyme local à une classe | 90 jours |
| `ClassActivityTemplateV1` | professeur | Publication Varignon exacte et hashée | 90 jours |
| `ClassAssignmentV1` | professeur | Cible, fenêtre et politique d'aide immuables | clôture + 30 jours |
| `assignment_recipient` | système | Snapshot dédupliqué des aliases destinataires au moment de l'affectation | durée de l'affectation ou de l'alias |
| `LearningEvidenceV1` | runtime déterministe | Missions, faits, configurations, aides, complétions et XP | 30 jours |
| `SessionCheckpointV1` | runtime déterministe | État Varignon sémantique court et vérifiable | 7 jours |

Le catalogue exhaustif champ → finalité → autorité → rétention est
`PERSISTED_FIELD_CATALOG_V1`. Il couvre chaque champ de premier niveau et les
sous-champs persistés de cible, politique d'aide, faits, compteurs et checkpoint.
La publication approuvée est couverte comme valeur versionnée
`teacher_exercise_publication.v2`, dont le schéma strict reste l'autorité. Un
test vérifie la couverture minimale, les chemins imbriqués et les doublons.

## Checkpoint sûr

Le checkpoint ne contient pas de `ggbBase64`, XML, image ni scène arbitraire. Il
contient seulement :

- les coordonnées bornées de A, B, C et D ;
- les milieux E à H et segments EF, FG, GH, HE réellement construits, sous forme
  d'enums sémantiques ;
- la mission active et ses statuts ;
- le hash du contrat et le hash du monde attendu.

À la reprise, T25-C04 devra revalider activité, contrat, propriétaire et hash,
reconstruire via le gateway existant puis refuser tout écart. Le professeur ne
lit pas ce checkpoint; il reçoit uniquement la projection factuelle.

## Matrice d'accès

Toute décision utilise `authorizeClassroomAccessV1` et part de `deny`. Une
absence de ressource, un acteur expiré, une cible fermée ou une référence de
classe divergente échoue sans fallback.

| Action | Professeur propriétaire | Autre professeur | Alias destinataire | Autre alias | Système |
|---|---:|---:|---:|---:|---:|
| Lire/gérer la classe | oui | non | non | non | non |
| Lire roster/groupe | oui | non | non | non | non |
| Lire template/affectation | oui | non | affectation ouverte seulement | non | non |
| Lire bilan factuel | oui | non | son propre enregistrement | non | non |
| Écrire faits/checkpoint | non | non | son affectation ouverte seulement | non | non |
| Lire checkpoint | non | non | propriétaire seulement | non | non |
| Supprimer la classe | oui | non | non | non | non |
| Retirer un alias | oui | non | non | non | non |
| Migrer | non | non | non | non | but `migration` seulement |
| Purger | non | non | non | non | but `retention` seulement |

Une cible `classroom` résout les aliases actifs de cette classe au moment de
l'affectation. Une cible `group` résout alors uniquement ses membres actifs; une
cible `learner` résout un seul alias. Cette résolution est persistée dans
`compass_assignment_recipients` et n'est pas élargie par une jonction tardive.
La fenêtre `opensAt ≤ now < closesAt`, l'état `active`, l'appartenance au
snapshot et l'expiration sont tous requis pour une lecture ou écriture élève.

## Données interdites

Les objets sont stricts à chaque niveau. Le scanner exécuté avant le store
rejette notamment :

- nom légal, email, date de naissance ou identifiant administratif ;
- réponse, conjecture, justification, transfert ou autre texte libre élève ;
- audio, image, photo, média, transcript ou payload brut ;
- note, grade, score ou classement ;
- clé OpenAI, prompt système/modèle ou override, XML GeoGebra, data URL ou
  Base64. Les champs pédagogiques `prompt` du contrat Varignon restent autorisés.

Les booléens `conjectureCompleted` et `transferCompleted` ne contiennent aucune
formulation. `exerciseXp` reprend le ledger ludique borné et ne devient jamais
une note.

## Intégrité et migrations

Le schéma applicatif vérifie les références et durées avant le driver. Le schéma
SQL ajoute clés étrangères, unicité classe/pseudonyme insensible à la casse, unicité
affectation/alias, fenêtres temporelles et cascades. Le hash de contrat doit être
identique dans template, affectation, faits et checkpoint; la politique d'aide
de l'affectation doit être celle de la publication approuvée. Les identifiants
de mission, de fait déterministe et d'étape de justification doivent exister
dans cette publication exacte; un alias doit aussi appartenir à la cible.
La clé d'idempotence est incorporée à l'identifiant d'affectation : une nouvelle
tentative avec la même intention rend le même enregistrement, tandis qu'une
réutilisation divergente échoue sans écriture. Template, affectation et snapshot
des destinataires sont committés dans une seule transaction.

La montée `classroom_store.v0 → v1` part obligatoirement d'un store vide, car
T24 ne persistait aucune donnée de classe. La descente applicative refuse
`migration_would_drop_classroom_data` dès qu'un enregistrement existe. Le SQL
`down` est réservé au rollback d'un environnement vide vérifié; il ne constitue
jamais une commande de purge.

La jonction et la rotation incrémentent sous transaction la ligne singleton de
`compass_classroom_control`. Elles sérialisent ainsi la recherche de collisions,
la vérification scrypt et l'écriture. Le code clair n'est renvoyé qu'après
création ou rotation; l'élève et les lectures ultérieures ne reçoivent jamais
le hash.

## Suppression et expiration

- Supprimer un professeur supprime classes, groupes, aliases, templates,
  affectations, faits et checkpoints associés.
- À expiration du code rotatif, la purge met atomiquement hash, émission et
  échéance à `null` sans supprimer la classe; une classe archivée ou révoquée ne
  peut conserver de hash.
- Supprimer une classe conserve les templates du professeur mais supprime tous
  ses groupes, aliases, affectations, faits et checkpoints.
- Retirer, révoquer puis purger, ou expirer un alias supprime ses faits et checkpoints; une
  affectation directe disparaît et un groupe devenu vide disparaît avec ses
  affectations.
- Supprimer ou expirer un template ou une affectation supprime faits et
  checkpoints dépendants.
- Faits et checkpoints possèdent aussi leur expiration courte indépendante.

Chaque opération produit un `ClassroomCascadeReportV1` composé uniquement de
compteurs par table. Il ne contient aucun identifiant ou contenu élève.

## Suite autorisée

T25-C03 est close : le professeur prévisualise et affecte la publication
Varignon exacte issue de `math.pdf`; classe, groupe et alias sont résolus sous
transaction, et seuls les destinataires figés reçoivent le contrat pendant sa
fenêtre. T25-C04 peut brancher cette file sur le runtime et le checkpoint sûr;
elle devra revalider destinataire, statut, fenêtre et hash avant toute ouverture
ou reprise.
