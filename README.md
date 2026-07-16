# Compass

Compass est un prototype de tuteur scolaire bilingue qui transforme un exercice
pris en photo ou préparé par un professeur en parcours guidé. L'élève travaille
mission par mission avec un coach vocal ou texte; les mathématiques compatibles
ouvrent un atelier GeoGebra instrumenté, tandis que les autres matières restent
dans un tutorat conversationnel sans fausse promesse de vérification.

Démo HTTPS : [compass-geotutor-demo.vercel.app](https://compass-geotutor-demo.vercel.app/)

> L'URL publique correspond au dernier candidat Vercel qualifié. Après une
> modification locale, redéployer et rejouer le smoke avant de présenter la
> nouvelle fonctionnalité comme disponible en ligne.

## Ce que montre le prototype

- Parcours élève en quatre écrans : accueil, photo, confirmation, atelier.
- Lecture d'exercice scolaire par GPT-5.6 avec Structured Outputs et
  confirmation humaine avant tutorat.
- Coach OpenAI Realtime en voix ou texte, avec fallback local explicite.
- Atelier GeoGebra panoramique : monde borné, dix actions sémantiques fermées et
  cinq relations vérifiées localement sur l'exercice de démonstration.
- Progression honnête : 10 XP après une note de démarche élève, 20 XP seulement
  lorsqu'une preuve déterministe compatible existe.
- Question de transfert en fin d'exercice; son texte reste dans le workspace.
- Studio professeur : thème, fiche ou saisie manuelle, brouillon éditable,
  publication et bibliothèque élève.
- Bilan professeur anonyme de l'onglet courant : comptes terminé/vérifié, XP et
  statuts de réflexion, sans nom, réponse libre ni note.
- Interface EN/FR, responsive, clavier, mouvement réduit et diagnostics
  techniques repliables.

## Rôle des modèles

| Besoin | Modèle | Frontière |
|---|---|---|
| Lire une photo d'exercice élève | `gpt-5.6-terra` | Un appel serveur, image en mémoire, `store:false`, outils vides, sortie stricte |
| Préparer un brouillon professeur | `gpt-5.6-luna` | Un appel maximum, effort faible, `store:false`, outils vides, sortie stricte |
| Tutorat voix/texte | `gpt-realtime-2.1` | WebRTC; profil général sans outil ou profil GeoGebra à fonctions fermées |
| Validation et XP vérifiés | Aucun modèle | Calculs applicatifs déterministes et ledger mémoire |

Les consignes du professeur, le texte extrait et les observations GeoGebra sont
traités comme des données non fiables. Ils ne peuvent pas modifier le prompt
système, les permissions ou les règles de preuve.

## Architecture

Le runtime Next.js App Router TypeScript vit dans `apps/frontend`. Les petites
routes serveur protègent la clé standard `OPENAI_API_KEY`. Le navigateur possède
la scène GeoGebra, les états de session et les contrôleurs Realtime; les
mutations, réponses et preuves sont protégées par des contrats fermés, des
budgets, une autorité d'annulation et un arbitre d'opérations.

Le catalogue professeur côté serveur est borné à 64 éléments et éphémère. Pour
la continuité de la démo serverless, une publication créée dans l'onglet reste
aussi dans l'état React de cet onglet. Les bilans d'apprentissage suivent la
même règle : mémoire seulement, aucun compte ou dossier élève.

Voir [l'architecture détaillée](docs/ARCHITECTURE.md), la
[roadmap](docs/ROADMAP.md) et les [décisions](agents/DECISIONS.md).

## Installation locale

Prérequis : Node.js 22.17.x et pnpm 10.6.3.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Ouvrir <http://localhost:3000>. Sans clé, les chemins déterministes et la saisie
manuelle professeur restent utilisables; les appels OpenAI affichent leur
fallback au lieu de simuler une session live.

`OPENAI_API_KEY` est une variable serveur unique utilisée par les routes de
lecture photo, de brouillon professeur et de session Realtime. Ne jamais la
préfixer par `NEXT_PUBLIC_` ni la committer.

## Vérification reproductible

```sh
pnpm test:docs:t0
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --dir apps/frontend exec playwright test --grep-invert @live
```

Le gate live credentialed est séparé; il exige une clé, un certificat et une
piste audio hors dépôt :

```sh
GEOTUTOR_TLS_CERT=/path/to/cert.pem \
GEOTUTOR_TLS_KEY=/path/to/key.pem \
pnpm gate:t6:live
```

Dernier gate local T18 : 69 cartes documentaires, 677/677 tests Vitest sur
64 fichiers, build Next.js et 36/36 scénarios Playwright hors live.

Le [runbook de démonstration](docs/DEMO_RUNBOOK.md) distingue le harness local,
le microphone physique et le certificat de confiance. Les réserves live
historiques restent documentées dans `agents/TODO_NEXT.md` et ne doivent pas être
présentées comme résolues par un build local.

## Limites assumées

- Pas d'authentification, classes, affectations, profils ou synchronisation.
- Pas de base de données; catalogue, XP et bilans disparaissent au rechargement
  ou au redémarrage du processus concerné.
- Pas de note ni de vérification automatique générale : hors module spécialisé,
  « terminé » reste une déclaration élève accompagnée d'une trace de démarche.
- Les textes de démarche et de transfert ne sont pas transmis au professeur.
- La démo Vercel publique n'a pas encore de code d'accès ni de rate limit
  applicatif; éviter une diffusion large avant ce durcissement.
- GeoGebra est utilisé dans le cadre de ce prototype non commercial avec son
  attribution; un usage commercial exige un accord distinct.

## Candidature

Le dossier prêt à adapter se trouve dans
[`docs/DEVPOST_SUBMISSION.md`](docs/DEVPOST_SUBMISSION.md). Il contient la copie
de soumission, le parcours jury, un script vidéo inférieur à trois minutes et la
checklist des éléments qui restent sous responsabilité humaine.
