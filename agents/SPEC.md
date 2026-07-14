# GeoTutor - Spécification produit

## Besoin

GeoTutor est un tuteur de géométrie multimodal et voice-first qui associe une session OpenAI Realtime à une applet GeoGebra embarquée. Il lit un exercice photographié, prépare uniquement les données initiales, observe la construction réelle de l'élève, vérifie les propriétés de manière déterministe et intervient avec le plus petit niveau d'aide utile.

## Utilisateurs

- Élève : comprendre une construction sans recevoir immédiatement la solution.
- Enseignant : disposer d'actions et de propriétés vérifiées, sans notation à enjeu élevé.
- Jury : observer une boucle multimodale fiable, visible et démontrable de bout en bout.

## Golden path

1. L'élève photographie un exercice de médiatrice.
2. L'application extrait une proposition structurée et demande confirmation.
3. GeoTutor crée seulement A, B et AB.
4. L'élève produit une droite perpendiculaire qui ne passe pas par le milieu.
5. La première erreur reste silencieuse; l'UI affiche le progrès local.
6. Une seconde action significative avec le même blocage déclenche une question réflexive.
7. Un indice visuel temporaire peut être demandé.
8. La correction est vérifiée par deux preuves indépendantes.
9. Une expérience déplace P sur la médiatrice et mesure PA/PB sur cinq positions.
10. L'élève verbalise l'invariant et reçoit une synthèse fondée sur les preuves.

## Exigences fonctionnelles

| ID | Exigence |
|---|---|
| FR-01 | Accepter une image par upload ou capture appareil. |
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

## Contraintes

- Une seule activité MVP : médiatrice et équidistance.
- L'application, pas le modèle, possède l'autorité de prise de parole proactive.
- Aucune affirmation géométrique sans preuve déterministe.
- Aucun outil de commande GeoGebra arbitraire.
- Les hints sont temporaires ou restaurables; les actions destructives exigent une intention explicite.
- Les images, checkpoints et journaux restent en mémoire pour le prototype.
- Le prototype est non commercial et affiche l'attribution GeoGebra.

## Non-objectifs

- Couvrir tout le programme de géométrie.
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

## Hypothèses validées

- Interface et voix principales en anglais; français en extension.
- Nom de travail : GeoTutor.
- Application web Next.js avec petites routes serveur et sans base de données.
- Modèles : `gpt-realtime-2.1` pour la voix et `gpt-5.6-terra` pour l'extraction d'image.
