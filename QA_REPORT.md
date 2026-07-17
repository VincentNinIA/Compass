# QA_REPORT — Contre-audit final T22-C08

Date : 17 juillet 2026
Rôle : QA indépendant, framework Nin-IA Project skill
Référentiel : pilotes imposés par `AGENTS.md`, architecture, PRD T22, sources,
tests et preuves courantes de `output/playwright/T22-C08`.

## Verdict

**PASS** — QA-T22-01 à QA-T22-07, la course de restauration L4, le checkpoint
mixed-case et l'accessibilité applet sont requalifiés. Aucun P1/P2 ne reste
ouvert. T22-C08 peut être synchronisée à `done` avec la tranche T22.

## Course replay / restore

La restauration possède désormais deux phases fermées :

1. **Avant l'écriture atomique.**
   `GeometryCheckpointControllerV1.restore()` publie
   `onRestoreStatus(true)`, attend `waitForRestoreBarrier`, puis revalide le
   signal avant `setBase64` (`checkpoint-v2.ts:164-182`). Une annulation à la
   barrière retourne `cancelled`, ne suspend pas les listeners, ne publie aucun
   monde restauré et conserve notamment `A=[42,24]` dans le test dédié.
2. **Après engagement de `setBase64`.**
   Le signal n'interrompt plus une écriture partielle. La barrière reste active
   jusqu'à la vérification du hash, de l'inventaire, de l'ownership et des
   listeners (`checkpoint-v2.ts:191-242`). Le test qui abort pendant le callback
   retourne exactement `ok:true` et retrouve le checkpoint, conformément à
   cette atomicité.

Pendant la barrière, le canvas public porte `inert`, `aria-busy=true` et
`data-checkpoint-restoring=true`; le CSS applique `pointer-events:none` et un
overlay visible `role=status` couvre la scène
(`geogebra-scratchpad.tsx:1056-1071`, `globals.css:4035-4051`). Le golden observe
réellement cette barrière lors de l'arrêt explicite.

`student_action` et `student_speech` traversent la même primitive
`preserveLearnerWorld:true`; timeout et arrêt de session ne l'utilisent pas.
L'arrêt explicite conserve au contraire le restore du checkpoint. Les résultats
`cancelled` ne contiennent plus `demonstration_viewed`, ne créent aucun evidence
ID et ne sont plus crédités par le scratchpad. Seul un replay `completed` émet
la provenance `assistant_demo`.

## Golden public L4

Le parcours final exécute bien, via l'UI publique :

- une tentative V8 puis les demandes L1 → L4 ;
- le consentement explicite ;
- pause, reprise et arrêt de la démonstration ;
- le restore exact après arrêt explicite ;
- la provenance `assistant_demo` sans crédit de justification learner ;
- un vrai `page.mouse` drag pendant L4, dont coordonnées, hash, inventaire,
  ownership et listeners restent identiques après annulation ;
- la barrière inert/`aria-busy` pendant le restore.

Les trois manifests valident `complete` et rendent tous les champs qualité
requis à `true`, dont :

- `consentedDemonstrationObserved` ;
- `replayControlsObserved` ;
- `replayStopRestored` ;
- `restoreInputBarrierObserved` ;
- `assistantDemoProvenanceObserved` ;
- `l4LearnerDragPreserved`.

Les garanties antérieures restent fermées : studio → preview réelle →
publication → élève, toolbar/canvas sans mutation de test, trois captures,
9/9, 160 XP, six parallélismes, restore mixed-case exact, zéro helper, zéro
global, Axe incluant l'applet, zéro overflow et zéro erreur console.

## Série, candidat et environnement

| Élément | Valeur vérifiée |
|---|---|
| Série | `series_0c8aa73859c9ed347b7b62b0` |
| Candidat | `candidate_b3bc38db342b359299dd3400` |
| Build ID | `1HKICbkdn6ZYn3IF3DIw6` |
| Source digest | `6b8e132b2be473e220b92ddd47e5836b28f238ac9185376fb3d2b53a6e6d8653` |
| Artifact digest | `c7178b2497542bf8f842504e2adbf41add110eb65631b48d2177c20d1ffd7059` |
| Environnement | `environment_1cb73222a3ee6a86fddc5fe0` |
| Navigateur | `Google Chrome for Testing 149.0.7827.55` |

Le recalcul read-only de sources + `.next` + navigateur correspond exactement
à `candidate.json` et `environment.json`. `verdict.json` rend
`identityStable:true`, trois runs consécutifs, zéro retry et trois publications
distinctes. Chaque PNG existe en 1440 × 2596. Le scan des JSON ne trouve aucun
secret, Base64, texte élève, identité ou note.

## Pilotes Nin-IA

`agents/CONTRACT.md`, `agents/TODO_NEXT.md` et la carte T22-C08 citent désormais
829 tests, la série et le candidat courants. `docs/ARCHITECTURE.md` décrit C01 à
C07 closes et C08 requalifiée mais encore `in_progress` jusqu'au présent verdict.
Cet état est cohérent : la prochaine action est maintenant la synchronisation
documentaire C08/T22 à `done`.

## Vérifications exécutées par QA

| Vérification | Résultat |
|---|---|
| `pnpm --dir apps/frontend test --run` | PASS — 91 fichiers, 829 tests |
| `pnpm --dir apps/frontend lint` | PASS |
| `pnpm --dir apps/frontend typecheck` | PASS |
| `pnpm --dir apps/frontend test:gate:t22` | PASS — 2/2 |
| `pnpm test:docs:t0` | PASS — 80 cartes cohérentes |
| `git diff --check` | PASS |
| Validation read-only des manifests | PASS — `complete` 3/3 |
| Recalcul candidat/environnement | PASS — identité exacte |

Les preuves Builder Playwright hors live 43/47 avec quatre skips attendus,
Realtime credentialed 1/1 et golden public 3/3 ont été inspectées mais ne sont
pas revendiquées comme rejouées par QA. Conformément à la mission, QA n'a lancé
ni build, ni serveur, ni Playwright, ni golden et n'a modifié ni `.next` ni
`output`.

## Clôture

Le contre-audit indépendant autorise la fermeture de T22-C08 et de T22. Vidéo,
licence commerciale, redéploiement, merge, push et soumission restent des
actions porteur distinctes et ne sont pas implicites dans ce verdict.
