# Workflow Builder GeoTutor

## Ordre obligatoire

1. Lire les documents pilotes indiqués dans `AGENTS.md`.
2. Vérifier l'état réel avec `rg --files`, `git status --short` et des lectures ciblées.
3. Corriger d'abord `agents/CONTRACT.md` si la tranche active ne correspond plus au travail demandé.
4. Exécuter une seule carte à la fois, en respectant ses dépendances et son périmètre.
5. Exécuter les vérifications inscrites dans la carte et conserver des preuves factuelles.
6. Mettre à jour les documents pilotes avant de déclarer une carte ou une tranche close.

## Rôles des documents

- `agents/SPEC.md` : besoin produit, contraintes, hypothèses et critères globaux.
- `agents/CONTRACT.md` : tranche active uniquement, inclus/exclus, fichiers, vérifications et définition de fini.
- `agents/DECISIONS.md` : décisions structurelles validées, avec raison et impact.
- `agents/TODO_NEXT.md` : prochaine action réelle, blocages et dette immédiate uniquement.
- `docs/ROADMAP.md` : ordre des tranches, cartes et traçabilité PRD.
- `docs/tranches/**/cards/*.md` : contrats exécutables carte par carte.
- `HANDOFF.md` : état de reprise si le travail reste partiel ou bloqué.

## Règles de preuve

- Un build réussi ne suffit pas à clore une carte fonctionnelle.
- Ne jamais déclarer une commande, un smoke ou une répétition comme réussi sans l'avoir exécuté.
- Toute propriété géométrique annoncée doit être reliée à une preuve déterministe.
- Une dépendance credentialed non disponible doit être nommée explicitement.

## Vérifications par défaut

Lorsque le runtime frontend existera :

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
```

Les cartes peuvent ajouter des tests plus ciblés. Les commandes absentes du dépôt ne doivent pas être prétendues exécutables avant T0-C02.

