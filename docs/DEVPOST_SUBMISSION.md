# Compass — dossier Devpost Education

La fiche Compass est publiée sur
`https://devpost.com/software/compass-tedvqs`. Le contrôle du 21 juillet 2026
confirme que la participation OpenAI Build Week est enregistrée et soumise, que
la démo publique répond et que la vidéo YouTube publique dure 2 min 56.

La page publique ne permet pas de relire la catégorie privée, l'identifiant de
session `/feedback` ou les éventuels retours humains. Ces trois champs restent
à vérifier depuis le formulaire authentifié sans les inventer dans ce dossier.

## Positionnement recommandé

- **Catégorie :** Education
- **Nom :** Compass
- **Tagline :** Turn any school exercise into guided practice—without taking the thinking away.
- **URL de test :** `https://compass-geotutor-demo.vercel.app/`
- **Dépôt :** `https://github.com/VincentNinIA/Compass`
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

Avant la démo, ouvrir l'alias T18 et rejouer ce parcours court; ne pas dépendre
d'une URL immuable Vercel, qui peut rester protégée par le SSO d'équipe.

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
| Technological implementation | Trois modèles séparés, WebRTC, Structured Outputs, gateway sémantique, preuves locales, gates | T18 est déployé; rejouer le live credentialed juste avant le jury |
| Design | Quatre écrans, studio professeur, mobile 390, clavier, EN/FR, mouvement réduit | Smoke final 390/1440 qualifié; enregistrer la vidéo sur le même alias |
| Potential impact | Boucle professeur-élève-professeur, aide graduée, bilan anonyme, toute matière | Ajouter les retours humains collectés par le porteur; ne pas inventer de traction |
| Quality of idea | Distinction conversation/instrumentation et terminé/vérifié, frugalité professeur | GeoGebra est aujourd'hui le seul environnement spécialisé instrumenté |

## Checklist finale

- [x] Redéployer le worktree T18 et rejouer le parcours jury sur l'URL publique.
- [x] Ajouter l'URL de dépôt à Devpost.
- [x] Publier une vidéo publique strictement inférieure à 3 min (2 min 56).
- [x] Ajouter une licence non commerciale explicite au dépôt public et séparer
      les conditions tierces de GeoGebra.
- [x] Retirer des liens Devpost la PR no 2 devenue obsolète; conserver uniquement
      le dépôt public et la démo stable.
- [x] Soumettre la participation OpenAI Build Week; le connecteur confirme
      l'état `registered` et `submitted` au 21 juillet 2026.
- [ ] Choisir **Education**.
- [ ] Ajouter l'identifiant de session obtenu via `/feedback`.
- [ ] Ajouter les retours humains et seulement les observations réellement reçues.
- [ ] Vérifier que la description Devpost, la vidéo et l'URL décrivent le même
      candidat et les mêmes limites.
