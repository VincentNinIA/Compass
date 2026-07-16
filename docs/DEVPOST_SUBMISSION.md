# Compass — dossier Devpost Education

La fiche Compass a été synchronisée le 16 juillet 2026 sur
`https://devpost.com/software/compass-tedvqs`. L'enregistrement d'une fiche
complète a publié automatiquement la page projet, mais la participation OpenAI
Build Week reste non soumise (`submitted_at: null`). Les retours humains, la
vidéo finale, la session `/feedback`, la licence, le choix Education et la
soumission restent à compléter par le porteur.

## Positionnement recommandé

- **Catégorie :** Education
- **Nom :** Compass
- **Tagline :** Turn any school exercise into guided practice—without taking the thinking away.
- **URL de test :** `https://compass-geotutor-demo.vercel.app/`
- **Dépôt :** `https://github.com/VincentNinIA/Compass`
- **Candidat T18 :** `https://github.com/VincentNinIA/Compass/pull/2`
- **Promesse précise :** conversation guidée pour toute matière lisible;
  observation, action et vérification automatiques uniquement dans les ateliers
  spécialisés dont Compass possède un contrat déterministe, aujourd'hui GeoGebra.

La catégorie Education est pertinente parce que le produit organise une boucle
pédagogique complète : le professeur prépare l'intention et l'aide, l'élève
essaie et explicite sa démarche, Compass fournit le plus petit indice utile, les
preuves locales restent séparées des déclarations, puis le professeur retrouve
un bilan anonyme factuel de la session.

## Description prête à adapter (anglais)

Compass turns a worksheet, homework photo, or teacher brief into guided practice
that keeps the learner in charge. A student confirms the extracted exercise,
works through ordered missions, explains what they tried before claiming
progress, and closes with a short transfer reflection. Compass can coach by voice
or text across subjects, but it never pretends that a general conversation is an
automatic grade.

For compatible geometry work, the experience becomes instrumented: Compass
observes a bounded GeoGebra world, can explain the exact click sequence, and can
perform one explicitly requested semantic action at a time. Five demo relations
are checked locally rather than by the model. That is why the XP language is
deliberate: learner-completed progress and deterministically verified progress
are visibly different.

Teachers can start from a topic, a worksheet image, or their own exercise. One
cost-bounded GPT-5.6 call prepares an editable draft; local checks report only
what they truly inspect before the teacher publishes. The student opens the
exercise from the shared library, and the same browser session can return an
anonymous factual summary—missions completed, missions verified, reflection
status, and XP—with no learner name, answer text, grade, or persistent profile.

OpenAI powers three deliberately separated responsibilities. GPT-5.6 Terra
reads student exercise images into strict Structured Outputs. GPT-5.6 Luna
creates one frugal teacher draft with no tools and `store:false`.
`gpt-realtime-2.1` provides low-latency voice and text coaching over WebRTC. The
application—not the model—owns tool permissions, turn-taking, cancellation,
deterministic geometry checks, and verified rewards.

We used Codex as an engineering and review collaborator: to keep product specs,
runtime contracts and tests synchronized; implement the end-to-end surfaces;
and run adversarial product, education and technical audits. The repository
includes deterministic unit tests, browser journeys, accessibility/reflow
checks, live-gate tooling, and explicit documentation of what remains
prototype-only.

Compass is designed to make one-on-one guidance more available without replacing
the learner's work or the teacher's judgment. The current prototype is bilingual,
memory-only and non-commercial. It does not include accounts, classes, grades or
production persistence.

## Parcours jury recommandé (2 minutes)

1. Ouvrir **Professor** → **Write it myself**.
2. Saisir un exercice d'histoire à une mission, prévisualiser puis montrer les
   trois contrôles factuels : structure, contexte d'accompagnement, scan de
   formulations à risque.
3. Publier → **See it in the student library** → démarrer l'exercice.
4. Montrer que **Complete mission** est désactivé jusqu'à la note de démarche.
5. Terminer la mission et répondre à la question de transfert.
6. Revenir dans **Professor** et montrer le bilan anonyme; souligner que la
   réponse libre n'apparaît pas.
7. Ouvrir ensuite `/?demo=geogebra` pour montrer le contraste entre progression
   déclarée et missions vérifiées automatiquement dans GeoGebra.

Avant la démo, redéployer T18 : l'alias actuel correspond au dernier candidat T17
qualifié tant qu'un nouveau déploiement n'a pas été effectué et contrôlé.

## Script vidéo — cible 2 min 45

### 0:00–0:20 — Problème

Voix : “Students often need help at the exact moment they are stuck, but a chat
answer can easily take the thinking away. Compass turns the exercise itself into
guided practice.”

Image : accueil, deux départs élève, bascule EN/FR.

### 0:20–0:55 — Parcours professeur

Voix : “A teacher starts from a topic, a worksheet, or a manual exercise. One
frugal GPT-5.6 Luna call can prepare a structured draft. The teacher edits every
field and confirms publication; local checks describe only what they actually
inspect.”

Image : formulaire, brouillon, contrôles renommés, publication.

### 0:55–1:35 — Apprentissage élève

Voix : “The learner sees ordered missions and can ask Compass by voice or text.
Before earning progress XP, they record what they tried. At the end, a transfer
question asks where the idea could be reused. The answer stays private in the
workspace.”

Image : bibliothèque, atelier d'histoire, bouton d'abord désactivé, réflexion,
transfert.

### 1:35–2:05 — Preuve GeoGebra

Voix : “In compatible geometry, Compass goes further without giving the model
un arbitrary command line. It observes a bounded GeoGebra world and exposes only
semantic, budgeted actions. Verified XP comes from deterministic application
checks—not from the model saying the work looks right.”

Image : `/?demo=geogebra`, monde, mission qui passe à vérifiée, 20 XP.

### 2:05–2:30 — Boucle professeur et sécurité

Voix : “Back in the teacher space, Compass reports only anonymous session facts:
completed and verified missions, reflection status, and XP. No learner name,
answer text, grade, or persistent profile.”

Image : bilan professeur.

### 2:30–2:45 — Codex et conclusion

Voix : “We used Codex to build and challenge the product end to end—contracts,
tests, accessibility, browser gates, and adversarial reviews. Compass makes help
more available while keeping the learner's thinking and the teacher's judgment
at the center.”

Image : tests verts puis logo Compass.

## Matrice de jugement /100

| Critère | Preuve à montrer | Réserve honnête |
|---|---|---|
| Technological implementation | Trois modèles séparés, WebRTC, Structured Outputs, gateway sémantique, preuves locales, gates | Rejouer le live credentialed et déployer le candidat final |
| Design | Quatre écrans, studio professeur, mobile 390, clavier, EN/FR, mouvement réduit | Contrôler les captures finales après déploiement |
| Potential impact | Boucle professeur-élève-professeur, aide graduée, bilan anonyme, toute matière | Ajouter les retours humains collectés par le porteur; ne pas inventer de traction |
| Quality of idea | Distinction conversation/instrumentation et terminé/vérifié, frugalité professeur | GeoGebra est aujourd'hui le seul environnement spécialisé instrumenté |

## Checklist avant soumission

- [ ] Redéployer le worktree T18 et rejouer le parcours jury sur l'URL publique.
- [x] Ajouter l'URL de dépôt à Devpost.
- [ ] Choisir **Education**.
- [ ] Enregistrer une vidéo avec voix off, durée strictement inférieure à 3 min,
      mentionnant explicitement Codex et GPT-5.6.
- [ ] Ajouter l'identifiant de session obtenu via `/feedback`.
- [ ] Ajouter les retours humains et seulement les observations réellement reçues.
- [ ] Si le dépôt est public, choisir et ajouter une licence validée par le
      porteur. Si le dépôt reste privé, partager l'accès aux comptes de test
      indiqués par le règlement (`testing@devpost.com` et
      `build-week-event@openai.com`).
- [ ] Vérifier que la description Devpost, la vidéo et l'URL décrivent le même
      candidat et les mêmes limites.
- [ ] Soumettre le projet; la page projet publique n'est pas une soumission
      OpenAI Build Week tant que `submitted_at` reste nul.
