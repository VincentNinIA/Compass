# Contrat Builder - T0 Socle exécutable — clôturé

## État

- Tranche T0 : close avec décision `pass` le 14 juillet 2026
- Cartes closes : T0-C01 à T0-C06
- Carte active : aucune
- Prochaine tranche à contractualiser : T1, en commençant par T1-C01
- Nature actuelle du dépôt : runtime, GeoGebra, route SDP et client WebRTC vérifiés

## Inclus dans T0

- T0-C02 : initialiser le runtime web.
- T0-C03 : prouver l'embed et l'API GeoGebra.
- T0-C04 : créer la route serveur SDP Realtime.
- T0-C05 : prouver une connexion WebRTC navigateur.
- T0-C06 : vérifier l'indépendance des deux spikes et clore la tranche.

## Hors périmètre actuel

- Adaptateur GeoGebra complet, événements et validation T1.
- Gateway d'outils et comportement vocal T2.
- Upload d'image et Responses API T3.
- Policy pédagogique T4, invariance T5 et hardening T6.
- Base de données, authentification, LMS et teacher mode.

## Fichiers probablement touchés pendant T0

- `apps/frontend/**`
- fichiers de configuration pnpm/Node à la racine si nécessaires
- `.env.example`
- documents pilotes lorsqu'une décision ou un état change réellement

## Vérification prévue

Scripts disponibles et vérifiés depuis T0-C02 :

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
```

Ajouter les smokes réels GeoGebra et Realtime décrits dans T0-C03 à T0-C06.

Résultat de clôture : les quatre scripts passent, le parcours Realtime live
atteint `response.done` avec audio distant, et les deux pannes croisées restent
isolées et nettoyables.

## Définition de fini T0

- Le runtime démarre depuis une installation fraîche.
- GeoGebra crée et relit A/B/AB indépendamment d'OpenAI.
- Realtime ouvre une session WebRTC indépendamment de GeoGebra.
- La clé API standard n'apparaît jamais côté navigateur.
- Les deux intégrations disposent d'erreurs récupérables et d'un cleanup.
- Les vérifications réellement exécutées sont consignées.
- `TODO_NEXT.md` pointe vers T1-C01 après clôture.

Tous ces critères sont satisfaits. Le périmètre T1 n'est pas ouvert par ce
document de clôture.
