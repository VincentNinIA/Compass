# Contrat Builder - T1 Construction observable et vérifiable — clôturé

## État

- Tranche T1 : décision `pass` restaurée le 14 juillet 2026 après correction et
  requalification des trois défauts bloquants C04, C06 et C07.
- Cartes à exécuter dans l'ordre : T1-C01 → T1-C02 → T1-C03 → T1-C04 →
  T1-C05 → T1-C06 → T1-C07.
- Cartes closes : T1-C01 à T1-C07.
- Carte active : aucune.
- Prochaine tranche séquentielle à contractualiser : T2, en commençant par T2-C01.
- Dépendance d'entrée : T0-C06 close avec décision `pass`.

## Inclus dans T1

- T1-C01 : façade GeoGebra typée, cycle de vie et listeners centralisés.
- T1-C02 : scène minimale A/B/AB et registre d'ownership transactionnel.
- T1-C03 : snapshot canonique non localisé, hash stable et révision.
- T1-C04 : coalescence des événements en actions terminées stables.
- T1-C05 : preuves indépendantes de perpendicularité et de passage au milieu.
- T1-C06 : progrès local accessible 0/2–2/2 sans modèle ni réseau.
- T1-C07 : checkpoint mémoire, reset exact, recovery et réconciliation listeners.

## Correctifs bloquants contractualisés

- C04 : un snapshot incomplet casse obligatoirement la série de stabilité; seules
  deux captures complètes consécutives de même hash peuvent émettre une action.
- C06 : l'action conserve l'ownership étudiant au moment de l'événement et la
  suppression de la dernière candidate remet immédiatement le progrès à 0/2.
- C07 : le reset compare l'inventaire exhaustif de l'applet au checkpoint, refuse
  tout objet parasite et borne l'attente du callback `setBase64` par un timeout.

## Hors périmètre actuel

- Session vocale, outils Realtime et gateway T2.
- Capture, Responses API et initialisation depuis une photo T3.
- Policy pédagogique proactive T4 et expérience d'invariance T5.
- Persistance, authentification, LMS et préparation production.
- Commande GeoGebra arbitraire exposée à un modèle.

## Fichiers probablement touchés pendant T1

- `apps/frontend/types/geogebra.ts`
- `apps/frontend/lib/geogebra/**`
- `apps/frontend/components/geogebra-spike.tsx`
- tests frontend associés
- styles de l'interface si le progrès ou Reset les exigent
- `docs/ROADMAP.md`, cartes T1 et documents pilotes

## Vérification prévue

Pour chaque carte, exécuter ses tests ciblés. Avant clôture de tranche :

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
```

Ajouter un smoke navigateur réel pour l'applet : initialisation A/B/AB, action
stable, séquence 0/2–2/2 hors réseau, reset avec égalité du hash initial et un
seul listener réenregistré.

Résultat de requalification : 39/39 régressions T1 ciblées, lint, typecheck,
59/59 tests complets et build passent. Les smokes réels prouvent suppression
2/2→0/2, recovery d'un objet parasite et timeout `setBase64`.

## Définition de fini T1

- Chaque carte T1-C01 à T1-C07 est marquée `done` avec preuves réellement
  exécutées et limites explicites.
- L'adaptateur refuse les appels hors état `ready` et son cleanup est idempotent.
- Le registre ne publie A/B/AB qu'après une création transactionnelle complète.
- Les snapshots sont non localisés, triés et stables; la révision ne change que
  lorsque le hash change.
- Un drag à updates multiples produit une seule action après deux snapshots égaux.
- Les deux propriétés de médiatrice ont des preuves et evidence IDs distincts.
- Le progrès local traverse 0/2, 1/2 et 2/2 sans appel modèle ou réseau.
- Reset restaure le hash initial, remet le progrès à zéro et laisse chaque listener
  inscrit exactement une fois; le chemin de recovery est testé.
- `TODO_NEXT.md`, `docs/ROADMAP.md`, l'architecture et les cartes reflètent l'état
  réel avant décision de clôture.

Tous ces critères sont de nouveau satisfaits. Aucun travail T2 ou T3 n'a été commencé.
