# Roadmap GeoTutor

## État de référence

Cette roadmap décrit le travail à réaliser. Au 15 juillet 2026, T0, les sept
cartes de T1 et les six cartes de T2 sont closes. Le runtime, les deux spikes,
l'observation et la validation GeoGebra, le gateway fermé, les tours vocaux, la
boucle d'outil et l'interruption disposent de replays et de smokes navigateur.
T3 est close `pass` après remédiation QA séquentielle de C01, C04, C06, C07 et
C08 : textes modèle fermés, entrée HTTP bornée, confirmations drainées, plans
pending nettoyés et preuves reproductibles. C02, C03 et C05 sont restées closes
et ont été revalidées sur le commit
`45333e47d8c846816083d00b06d2fd0c47bfd1bb` avec 171/171 tests `exercise`,
608/608 tests frontend, trois E2E 5/5 consécutifs et une eval 7/7.
T4 est close après exécution ordonnée de ses huit cartes : reducer et delta
déterministes, policy locale, feedback avant réseau, directives stale-safe,
deux chemins Realtime, aide L1–L4 réversible et annulations corrélées. T5 est
close : ses sept cartes passent sur un candidat commun avec cinq mesures 5/5,
restauration exacte du vrai applet, synthèse OOB texte-only ou fallback,
annulation et accessibilité. T6 est close : C01-C06 fiabilisent reset, modes,
courses, preuves, latences et présentation HTTPS; C07 qualifie le même candidat
sur trois golden journeys live consécutifs, sans retry, avec preuves expurgées.
Les contre-audits indépendants T5/T6 sont clos `pass`; la requalification T6
finale rend 573/573 Vitest, 30/30 hors live et 3/3 live sur un inventaire fermé.
T7 est close `pass` : ses trois cartes transforment la surface jury en parcours
élève en trois étapes, appliquent le système visuel responsive et replient les
diagnostics sans modifier les autorités T1 à T6. Le gate rend 608/608 Vitest et
30/30 Playwright hors live, Axe sans violation et aucun débordement aux quatre
viewports de qualification.

Ordre de dépendance : `T0 → T1 → (T2 et T3 en parallèle possible) → T4 → T5 → T6 → T7`.

## Vue d'ensemble

| Tranche | Objectif | Cartes | Gate de sortie |
|---|---|---:|---|
| T0 | Obtenir un socle web et deux spikes indépendants | 6 | Runtime vérifié, applet GeoGebra relu, boucle WebRTC établie |
| T1 | Observer et valider localement la construction | 7 | Progrès 0/2–2/2 et reset exact sans modèle |
| T2 | Ajouter le tutorat vocal et un gateway fermé | 6 | Un tour vocal et une boucle d'outil sûrs, interruption prouvée |
| T3 | Transformer une photo confirmée en exercice minimal | 8 | Extraction stricte, confirmation humaine et initialisation transactionnelle |
| T4 | Piloter des interventions pédagogiques sélectives | 8 | Décisions déterministes, immédiates et protégées contre le stale |
| T5 | Prouver l'invariance et produire la synthèse | 7 | Test 5/5 réversible et résumé hors conversation |
| T6 | Fiabiliser la démonstration | 7 | Trois parcours live consécutifs sur le même commit |
| T7 | Transformer le prototype en expérience élève | 3 | Parcours simple, responsive, accessible et diagnostics secondaires |

## Registre des cartes

| ID | Statut | Dépend de | Résultat central |
|---|---|---|---|
| T0-C01 | done | — | Pilotage documentaire Nin-IA synchronisé |
| T0-C02 | done | T0-C01 | Runtime Next.js TypeScript vérifiable |
| T0-C03 | done | T0-C02 | Spike GeoGebra A, B, AB relu par l'API |
| T0-C04 | done | T0-C02 | Route SDP serveur sans exposition de clé |
| T0-C05 | done | T0-C04 | Spike WebRTC audio et data channel nettoyable |
| T0-C06 | done | T0-C03, T0-C05 | Fermeture factuelle des deux spikes |
| T1-C01 | done | T0-C06 | Adaptateur GeoGebra typé et idempotent |
| T1-C02 | done | T1-C01 | Registre A/B/AB avec ownership explicite |
| T1-C03 | done | T1-C02 | Snapshot et hash non localisés stables |
| T1-C04 | done | T1-C03 | Événement d'action terminée stabilisé |
| T1-C05 | done | T1-C03 | Preuves séparées de médiatrice |
| T1-C06 | done | T1-C04, T1-C05 | Progrès local 0/2–2/2 |
| T1-C07 | done | T1-C06 | Checkpoint/reset exact et listeners réconciliés |
| T2-C01 | done | T0-C06 | Session Realtime protégée |
| T2-C02 | done | T2-C01 | Commit VAD unique et autorité unique du tour |
| T2-C03 | done | T1-C07, T2-C01 | Gateway fermé relié à la phase réelle |
| T2-C04 | done | T2-C03 | Outils cœur aux arguments sémantiques fermés |
| T2-C05 | done | T2-C02, T2-C04 | Boucle Realtime abortable et toujours terminale |
| T2-C06 | done | T2-C05 | Barge-in et Stop fail-safe malgré erreur réseau |
| T3-C01 | done | T0-C06 | Messages client fermés et plan canonique versionné |
| T3-C02 | done | T3-C01 | Capture validée avec aperçu local |
| T3-C03 | done | T3-C02 | Image normalisée et métadonnées retirées |
| T3-C04 | done | T3-C03 | Entrée HTTP bornée et extraction Responses stricte |
| T3-C05 | done | T3-C04 | Clarification et confirmation obligatoires |
| T3-C06 | done | T1-C07, T3-C05 | Initialisation transactionnelle avec drain sérialisé |
| T3-C07 | done | T3-C04, T3-C05 | Flux pending nettoyé sans stockage persistant |
| T3-C08 | done | T3-C01 à T3-C07 | Candidat Git, fixtures et evals reproductibles |
| T4-C01 | done | T1-C07, T2-C06, T3-C06 | Reducer pédagogique unique |
| T4-C02 | done | T4-C01 | Delta significatif construction/faits |
| T4-C03 | done | T4-C02 | Policy pure SILENT/QUEUE/SPEAK |
| T4-C04 | done | T4-C03 | Feedback local avant réseau |
| T4-C05 | done | T4-C03 | Directives liées aux preuves et révisions |
| T4-C06 | done | T4-C05, T2-C06 | Deux chemins Realtime séparés |
| T4-C07 | done | T4-C06 | Assistance L1–L4 réversible |
| T4-C08 | done | T4-C04, T4-C07 | Annulations et absence de stale prouvées |
| T5-C01 | done | T4-C08 | Contrat composite à cinq échantillons |
| T5-C02 | done | T5-C01 | Scène temporaire restaurable |
| T5-C03 | done | T5-C02 | Mesures PA/PB et preuves pour cinq positions |
| T5-C04 | done | T5-C03 | Verbalisation uniquement après 5/5 |
| T5-C05 | done | T5-C04 | Synthèse texte hors conversation |
| T5-C06 | done | T5-C03 | UI accessible et annulable |
| T5-C07 | done | T5-C05, T5-C06 | Fermeture réelle, rollback et fallback |
| T6-C01 | done | T5-C07 | Reset et recovery mémoire/fixture |
| T6-C02 | done | T6-C01 | Modes de repli honnêtes |
| T6-C03 | done | T6-C02 | Arbitrage des courses par epoch/révision |
| T6-C04 | done | T6-C03 | Journal de preuves corrélé et expurgé |
| T6-C05 | done | T6-C04 | Erreurs, secrets et latences maîtrisés |
| T6-C06 | done | T6-C05 | Présentation HTTPS, accessible et attribuée |
| T6-C07 | done | T6-C06 | Gate live 3/3 sur le même candidat et environnement |
| T7-C01 | done | T6-C07 | Architecture d'information et langage élève en trois étapes |
| T7-C02 | done | T7-C01 | Système visuel jeune, responsive et accessible |
| T7-C03 | done | T7-C02 | États finis, diagnostics repliables et qualification navigateur |

## Matrice de traçabilité PRD

| Exigence | Cartes de réalisation | Preuve finale attendue |
|---|---|---|
| FR-01 — Exercise input | T3-C02, T3-C03, T6-C06 | Upload/capture JPEG, PNG ou WebP validé avant envoi |
| FR-02 — Exercise extraction | T3-C01, T3-C04, T3-C05, T3-C06 | Givens, cible, concept et plan stricts, confirmés avant initialisation |
| FR-03 — Realtime voice | T0-C04, T0-C05, T2-C01, T2-C02, T2-C05, T2-C06, T4-C06, T6-C02 | Audio bidirectionnel, préambules brefs, barge-in et annulation explicite |
| FR-04 — GeoGebra embedding | T0-C03, T1-C01, T1-C02 | Applet Geometry embarqué et API JavaScript obtenue |
| FR-05 — Construction observation | T1-C04, T4-C02 | Add/remove/click et mouvements terminés sont coalescés sans appel par pixel |
| FR-06 — State serialization | T1-C03, T2-C04 | État canonique des objets, définitions, valeurs et actions disponible |
| FR-07 — Tool execution | T2-C03, T2-C04, T2-C05 | Gateway whitelisté, schémas stricts et appels GeoGebra validés |
| FR-08 — Geometric validation | T1-C05, T2-C04 | Relations et complétion sont vérifiées par preuves déterministes |
| FR-09 — Progressive hints | T4-C03, T4-C07 | Assistance question → concept → visuel → démonstration confirmée |
| FR-10 — Invariance test | T5-C01 à T5-C07 | Une propriété est mesurée sur cinq positions et restituée sans altération |
| FR-11 — Undo/checkpoint | T1-C07, T5-C02, T5-C07, T6-C01 | Checkpoint avant action matérielle et restauration exacte/fallback |
| FR-12 — Learning summary | T5-C05, T5-C07, T6-C04 | Synthèse concise fondée sur actions, mesures et preuves corrélées |
| FR-13 — Teacher mode | T6-C04 | Extension seulement : journal inspectable; aucune interface enseignant dans le MVP |
| FR-14 — Multiple exercises | T3-C01, T3-C08 | Extension seulement : contrats versionnés; second template non implémenté |
| FR-15 — Turn-taking policy | T4-C01, T4-C02, T4-C03, T4-C05, T4-C06 | Machine locale SILENT/QUEUE/SPEAK avant toute réponse proactive |
| FR-16 — Immediate visual feedback | T1-C06, T4-C04 | Progrès local rendu avant tout aller-retour modèle |
| FR-17 — Intervention cancellation | T2-C02, T2-C06, T4-C05, T4-C06, T4-C08, T6-C01, T6-C03 | Pending annulé au drag et audio interrompu à la reprise de parole |

## Matrice des critères d'acceptation du PRD

| Scénario PRD | Cartes | Pass condition tracée |
|---|---|---|
| Image claire | T3-C02 à T3-C04, T3-C08 | Aucun objet inventé; JSON conforme au schéma strict |
| Image ambiguë | T3-C04, T3-C05, T3-C08 | Une clarification ciblée; aucune initialisation automatique |
| Initialisation de la scène | T3-C05, T3-C06 | Seuls les givens A, B et AB sont créés; la solution est absente |
| Mauvaise droite perpendiculaire | T1-C05, T1-C06, T4-C04 | Une propriété vraie, le passage au milieu manquant, feedback ciblé sans solution |
| Demande d'indice | T2-C04, T4-C07 | Helper de milieu temporaire et réversible, aucun objet élève déplacé |
| Correction de la figure | T1-C05, T1-C06 | Les deux relations sont vraies et rattachées à deux preuves distinctes |
| Point P animé/déplacé | T5-C01 à T5-C04 | Cinq mesures PA/PB passent la tolérance et retournent leurs evidence IDs |
| Commande non supportée | T2-C03, T2-C04 | Rejet structuré, aucune mutation GeoGebra |
| Déconnexion Realtime | T6-C02 | Construction intacte, mode dégradé honnête et contrôle de reconnexion visible |
| Première tentative incorrecte | T4-C02 à T4-C04 | Décision SILENT; progrès visuel local éventuellement mis à jour |
| Même blocage répété | T4-C03, T4-C05, T4-C06 | Une question L1, un item et un `response.create`, aucune solution complète |
| Drag avant parole en file | T4-C05, T4-C08, T6-C03 | Pending annulé; aucun audio; état revalidé après mouvement terminé |
| Interruption du tutor | T2-C06, T4-C08 | Réponse annulée, buffer vidé et aucun chevauchement audio |

Chaque condition est déclinée en Given/When/Then dans les cartes concernées. La fermeture globale exige en plus le gate T6-C07.

## Règle de progression

Une carte ne passe à `done` qu'après obtention et consignation de ses preuves. Un build réussi ne suffit pas. `agents/CONTRACT.md` et `agents/TODO_NEXT.md` sont mis à jour à chaque changement de tranche active.
