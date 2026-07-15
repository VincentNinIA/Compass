# Compass - Spécification produit

## Besoin

Compass est un tuteur de géométrie multimodal et voice-first qui associe une session OpenAI Realtime à une applet GeoGebra embarquée. Il lit un exercice photographié, prépare uniquement les données initiales, observe la construction réelle de l'élève, vérifie les propriétés de manière déterministe et intervient avec le plus petit niveau d'aide utile.

## Utilisateurs

- Élève : comprendre une construction sans recevoir immédiatement la solution,
  dans une interface rassurante qui lui indique toujours la prochaine action utile.
- Enseignant : disposer d'actions et de propriétés vérifiées, sans notation à enjeu élevé.
- Jury : observer une boucle multimodale fiable, visible et démontrable de bout en bout.

## Expérience élève

- L'interface publique parle d'exercice, de construction, d'aide et de progrès;
  elle n'expose pas les noms de tranches, les frontières techniques ou les
  métriques de qualification dans le parcours principal.
- Le parcours principal tient en trois étapes visibles : ajouter l'exercice,
  construire avec Compass, puis vérifier ce que l'on a compris.
- L'interface publique existe en français et en anglais. Un contrôle compact à
  drapeau, placé en haut à droite, bascule immédiatement toute la copie visible
  et annonce la langue cible au clavier comme au lecteur d'écran.
- Une seule action principale domine chaque étape. Les actions secondaires et
  diagnostics restent disponibles sans concurrencer cette action.
- Les états vides expliquent quoi faire avec des mots simples. Les détails
  techniques utiles à la démonstration sont regroupés dans une zone repliable.
- La direction visuelle est jeune, chaleureuse et expressive, tout en restant
  lisible au clavier, à 200 % et sur mobile.

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
- Le changement de langue reste un état de session en mémoire et n'ajoute aucun
  stockage navigateur.

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
- Aucun libellé de tranche (`T0` à `T6`), jargon WebRTC, identifiant de preuve ou
  budget de latence ne domine le parcours élève.
- À l'arrivée, l'élève identifie l'action de départ et les trois étapes du
  parcours sans devoir parcourir une documentation technique.
- Le parcours reste utilisable à 390 px, 768 px et 1440 px, au clavier et avec
  `prefers-reduced-motion`.
- Le changement EN/FR conserve le même parcours, les mêmes actions et les mêmes
  garanties d'accessibilité sans débordement dans les deux langues.

## Hypothèses validées

- Interface publique bilingue anglais/français; la langue des services vocaux
  reste gouvernée séparément par les contrats Realtime existants.
- Nom public : Compass. Les identifiants techniques historiques `GeoTutor` et
  `__GEOTUTOR_*` restent stables tant qu'ils ne sont pas visibles par l'élève.
- Application web Next.js avec petites routes serveur et sans base de données.
- Modèles : `gpt-realtime-2.1` pour la voix et `gpt-5.6-terra` pour l'extraction d'image.
