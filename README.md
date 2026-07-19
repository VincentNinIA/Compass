# Compass

Compass is a bilingual, real-time AI learning tutor. In its flagship geometry
experience, students investigate the Varignon theorem in GeoGebra while an
animated voice coach observes a bounded world, verifies supported relations
deterministically, and provides contextual guidance through closed semantic
actions.

Compass is an Education prototype designed to support students without taking
control away from them. The public demo opens a teacher-prepared Varignon
investigation in one click: students construct, explore, conjecture, and justify
inside the real GeoGebra applet with a voice or text coach that can point to the
exact tool, object, or region it is discussing.

**[Open the public demo](https://compass-geotutor-demo.vercel.app/)**

![Compass points to the Midpoint tool in GeoGebra](output/playwright/T74-midpoint-guidance-1440x900.png)

## What the demo shows

- **Immediate access:** one action opens the exact Varignon activity, with no
  account, classroom code, pseudonym, or server write required beforehand.
- **Nine progressive missions:** construct the four midpoints, explore convex,
  concave, and crossed cases, form a conjecture, justify it, and transfer it.
- **A real bounded GeoGebra world:** objects, dependencies, ownership, epoch,
  revision, and facts are stabilized before any pedagogical decision.
- **Honest validation:** the application computes supported relations. The
  model does not verify geometry or award XP.
- **A coach with measured initiative:** at connection time, after a mission, or
  when a qualified block occurs, Compass may ask a question, offer advice, or
  select a reversible O2 interface action.
- **Precise visual guidance:** a halo, pointer, and callout target the real
  GeoGebra control, point, segment, or region. Screen coordinates are derived
  from the DOM and geometry world; they never come from the model.
- **A fluid, factual mascot:** a stable pose and composited CSS micro-motion
  replace frame-by-frame playback. Listening, thinking, speaking, tool use,
  hinting, and celebration only reflect real application states.
- **An accessible experience:** EN/FR interface, keyboard navigation, 200% zoom,
  reduced motion, and layouts qualified at 390, 768, and 1440 px.

## Trust boundaries

Compass strictly separates conversation, visible actions, and evidence.

| Level | Examples | Authority |
|---|---|---|
| Dialogue | Question, explanation, short prompt | The model chooses the wording; the application decides when an opportunity to speak exists |
| O2 guidance | Activate a tool, highlight, frame, or point | Closed, non-constructive, budgeted, cancellable actions restored during cleanup |
| O3 bounded move | Preview or move one A–D vertex toward an approved configuration | The model chooses the semantic gesture; the application computes coordinates, verifies, rolls back, and never awards evidence |
| O4–O5 privileged mutation | Restore, demonstration | Visible confirmation, closed targets, rollback, and deterministic verification |
| Evidence and XP | Midpoint, parallelism, configuration, progress | Application only; model output can never complete a mission |

The model receives eleven semantic actions, plus one system-only initialization
action, across authority levels O0 through O5. There is no arbitrary GeoGebra
command, unrestricted DOM click, or
model-selected screen coordinate. A student gesture or resumed speech cancels
the coach's in-flight work.

## Capabilities outside the golden path

The public page stays intentionally simple, while the repository also contains:

- a general photo workflow that reads a school exercise, requests human
  confirmation, and opens an honest conversational tutoring experience;
- a teacher studio that produces at most one structured AI draft, keeps it
  editable, and requires review before publication;
- an ephemeral exercise catalog and factual session report with no name, free
  text response, or grade;
- a classroom pilot with limited teacher identity, rotating codes, pseudonymous
  students, targeted Varignon assignments, and PostgreSQL 16;
- historical specialist harnesses for perpendicular bisectors, invariance,
  reset, and exact restoration, retained for internal qualification.

These capabilities are not stacked onto the jury landing page and do not turn
Compass into an LMS.

## Model responsibilities

| Need | Model | Boundary |
|---|---|---|
| Read a student's exercise photo | `gpt-5.6-terra` | One server call, in-memory image, `store:false`, no tools, strict output |
| Prepare a teacher draft | `gpt-5.6-luna` | At most one call, low effort, `store:false`, no tools, strict output |
| Voice and text tutoring | `gpt-realtime-2.1` | WebRTC; general profile without tools or investigation profile with closed functions |
| Relations, evidence, and XP | No model | Deterministic TypeScript engine, versioned contracts, and local ledger |

Teacher instructions, extracted text, and GeoGebra observations remain
untrusted data. They cannot change the system prompt, permissions, evidence, or
scoring rules.

## Architecture

The runtime is a Next.js App Router TypeScript application under
`apps/frontend`. Server routes keep secrets out of the browser; the client
orchestrates GeoGebra, WebRTC, progress, and cancellation controllers. The
adapter, gateway, fact engine, checkpoints, policy, and arbiter remain separate
authorities behind closed Zod contracts.

The direct demo locally creates a validated `geometry_investigation.v1`
publication and mounts the same `GeometryInvestigationRuntime` used by the
teacher workflow. It uses neither a parallel runtime nor a validation shortcut.
Remote audio may feed one local, ephemeral RMS value into Compass's mouth
animation; no sample, transcript, or audio history is stored.

Memory remains the default for the demo, media, XP, and reports. PostgreSQL is
reserved for the classroom pilot and fails closed when its configuration is
missing. Persistent semantic checkpoint restoration remains a separate,
unfinished slice.

See the [detailed architecture](docs/ARCHITECTURE.md),
[roadmap](docs/ROADMAP.md), [decisions](agents/DECISIONS.md), and
[classroom data contract](docs/CLASSROOM_DATA_CONTRACT.md).

## Local setup

Requirements: Node.js 22.17.x and pnpm 10.6.3.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Open <http://localhost:3000>. `OPENAI_API_KEY` is optional for local,
deterministic paths, but required for photo reading, teacher drafts, and
Realtime sessions. It must remain server-only: never prefix it with
`NEXT_PUBLIC_` or commit it.

The classroom pilot is disabled by default. Enabling it requires PostgreSQL,
migrations, and the secrets described in the
[classroom runbook](docs/CLASSROOM_PILOT_RUNBOOK.md); no in-memory fallback is
allowed in Production.

## Reproducible verification

```sh
pnpm test:docs:t0
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --dir apps/frontend exec playwright test --grep-invert @live
```

The latest qualified functional candidate passes 102 documentation cards,
899/899 Vitest tests across 106 files, lint, typecheck, and build. The targeted
direct-demo and mascot gate passes 5/5 Playwright scenarios.

Credentialed gates remain separate. They require an API key, a certificate,
and an audio track that are not stored in the repository.

```sh
GEOTUTOR_TLS_CERT=/path/to/cert.pem \
GEOTUTOR_TLS_KEY=/path/to/key.pem \
pnpm gate:t6:live
```

The [demo runbook](docs/DEMO_RUNBOOK.md) distinguishes the local harness,
physical microphone, and trusted certificate. Historical live reservations
remain explicit in `agents/TODO_NEXT.md`.

## Public production

The isolated Vercel project `compass-geotutor-demo` serves the stable HTTPS
alias: [compass-geotutor-demo.vercel.app](https://compass-geotutor-demo.vercel.app/).
The animated, visually guided release is READY under deployment
`dpl_62Q7d7DXTQoyaT3LtSmSkndPZMNz`.

The alias opens without an application access code. A Vercel WAF rule still
limits `POST /api/*` to six requests per fixed 60-second window per IP before
functions execute. Teacher and student pilot sessions remain separate
authentication boundaries. See the
[public access runbook](docs/DEMO_ACCESS_RUNBOOK.md).

## Known limitations

- Compass only verifies relations covered by a compatible deterministic
  contract; elsewhere, tutoring remains conversational.
- The public demo is not an LMS, a high-stakes grading system, or a persistent
  student record.
- The classroom pilot exists, but persistent GeoGebra progress restoration is
  not yet qualified, and the global WAF quota must be segmented before a
  multi-student pilot behind one NAT.
- Reasoning and transfer text is neither graded nor sent to the teacher; media,
  transcripts, and Base64 checkpoints are not persisted.
- Live features depend on credentials, browser capabilities, a microphone, and
  external services; fallbacks never present themselves as a live session.
- GeoGebra is used with attribution for this non-commercial prototype. Any
  commercial use requires a separate agreement.

## Submission materials

The adaptable submission package is available in
[`docs/DEVPOST_SUBMISSION.md`](docs/DEVPOST_SUBMISSION.md). It includes the
submission copy, jury journey, a video script under three minutes, and the
checklist of actions that remain under human responsibility.
