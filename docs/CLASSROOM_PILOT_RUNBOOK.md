# Runbook du pilote classe

## Portée

Ce runbook met en service T25-C02 et T25-C03 : identité professeur limitée,
classes, codes rotatifs, élèves pseudonymes, groupes et affectation du contrat
Varignon exact issu de `math.pdf`. La réception élève est un accusé de contrat;
elle ne lance pas encore GeoGebra et ne restaure aucun checkpoint avant T25-C04.

Le runtime échoue fermé. Lorsque le pilote est activé, l'absence de secret ou de
base ne déclenche jamais de fallback mémoire. Le driver mémoire est accepté
uniquement avec `COMPASS_CLASSROOM_TEST_MODE=1` et est refusé en Vercel
Production.

## Pré-requis

- PostgreSQL 16 joignable depuis le runtime Next.js ;
- un rôle de migration capable de créer/modifier les tables `compass_*` ;
- un rôle runtime limité aux lectures et écritures sur ces tables ;
- une sauvegarde et une fenêtre de rollback validées par l'opérateur ;
- la protection de démo T24 toujours distincte de l'accès professeur T25.

Le dépôt ne provisionne ni base ni secret. Ne jamais ajouter une URL de base,
un code clair ou un secret de session dans Git, les logs ou une variable
`NEXT_PUBLIC_*`.

## 1. Générer les secrets

Depuis la racine :

```sh
pnpm --dir apps/frontend classroom:secrets:generate
```

Le fichier ignoré `apps/frontend/.env.classroom.local` est créé en mode `0600`.
Il contient le code professeur à transmettre hors bande, son hash scrypt et le
secret de session. `COMPASS_PILOT_TEACHER_SUBJECT` est un identifiant technique
stable sans donnée personnelle : le conserver pour que les classes gardent le
même propriétaire. Une rotation explicite remplace code, hash et secret de
session, mais pas ce sujet stable; elle invalide les sessions existantes :

```sh
pnpm --dir apps/frontend classroom:secrets:generate -- --rotate
```

## 2. Appliquer les migrations

Appliquer les migrations dans l'ordre avec le rôle de migration :

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/frontend/migrations/0001_classroom_v1.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/frontend/migrations/0002_classroom_pilot.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/frontend/migrations/0003_class_assignments.up.sql
```

`0002` ajoute un verrou transactionnel de rotation/jonction et rend le
pseudonyme unique sans tenir compte de la casse dans chaque classe. `0003` rend
le nom de groupe unique par classe et ajoute le snapshot immuable
affectation/alias. Les scripts `down` sont réservés à une base vide contrôlée ;
ils ne remplacent ni la purge ni une restauration de sauvegarde.

## 3. Configurer le runtime

Variables serveur requises :

```dotenv
COMPASS_CLASSROOM_ENABLED=1
COMPASS_PILOT_TEACHER_ACCESS_HASH=scrypt-v1$…
COMPASS_PILOT_TEACHER_SUBJECT=pilot-teacher-1
COMPASS_CLASSROOM_SESSION_SECRET=…
DATABASE_URL=postgresql://…
```

Ne pas définir `COMPASS_CLASSROOM_STORE=memory` ni
`COMPASS_CLASSROOM_TEST_MODE=1` en Production. Conserver
`COMPASS_DEMO_ACCESS_HASH` et `COMPASS_DEMO_SESSION_SECRET` séparés : le code de
démo n'accorde aucun droit professeur.

## 4. Qualifier avant activation publique

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend test:e2e:t25
```

Puis vérifier sur l'environnement candidat :

1. le professeur ouvre son espace avec le code pilote ;
2. il crée une classe et copie le code affiché une seule fois ;
3. un navigateur privé rejoint avec un pseudonyme ;
4. le roster n'est visible que dans la session professeur ;
5. la rotation invalide immédiatement l'ancien code ;
6. le retrait de l'alias invalide sa session au prochain chargement ;
7. le professeur prévisualise les neuf missions de `math.pdf`, crée un groupe
   et affecte Varignon avec le hash affiché ;
8. seuls les aliases déjà résolus voient l'accusé pendant la fenêtre; un alias
   arrivé après l'affectation ne le voit pas ;
9. le retrait de l'affectation la fait disparaître immédiatement côté élève ;
10. l'archivage invalide le dernier code et révoque les affectations ouvertes.

Pour préparer la classe de démonstration unique après déploiement, exécuter :

```sh
pnpm --dir apps/frontend classroom:demo:seed
```

Le script crée ou réutilise `Test Varignon`, renouvelle son code, recrée
l'alias `Demo`, affecte le contrat exact et vérifie sa lecture élève. Les codes
restent uniquement dans `apps/frontend/.env.classroom-demo.local`, ignoré par
Git et écrit en mode `0600`; aucune valeur secrète n'est imprimée.

La règle WAF T24 actuelle limite globalement `POST /api/*`. Avant d'activer un
pilote multi-élèves derrière le même NAT scolaire, l'opérateur doit la remplacer
par des limites distinctes pour l'accès de démo, la jonction de classe et les
routes coûteuses. T25-C02 n'autorise pas cette mutation Vercel.

## 5. Révocation et incident

- Code de classe compromis : générer un nouveau code ; l'ancien hash est
  remplacé atomiquement.
- Alias à retirer : utiliser le roster professeur ; la suppression cascade vers
  ses snapshots, faits et checkpoints; les autres destinataires restent isolés.
- Affectation erronée : utiliser « Retirer »; le statut devient `revoked`,
  l'élève ne reçoit plus le contrat et l'audit minimal reste conservé jusqu'à
  expiration.
- Accès professeur compromis : régénérer les secrets, remplacer le hash et le
  secret de session, puis redéployer.
- Base indisponible ou migration absente : désactiver
  `COMPASS_CLASSROOM_ENABLED` ou restaurer la base ; ne jamais basculer vers la
  mémoire.

Les codes clairs ne sont récupérables ni depuis PostgreSQL ni depuis l'API. Une
perte du code se résout uniquement par rotation.
