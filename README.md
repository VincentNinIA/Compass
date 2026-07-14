# GeoTutor

GeoTutor is a voice-first geometry tutor prototype. Tranche T0 is closed with
an executable Next.js shell plus independent GeoGebra and OpenAI Realtime spikes.

## Requirements

- Node.js 22.17.x (see `.nvmrc`)
- pnpm 10.6.3

## Setup

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:3000>.

The visual GeoGebra spike needs no secret. To exercise the Realtime session
route against OpenAI, copy `.env.example` to `apps/frontend/.env.local` and set
the server-only `OPENAI_API_KEY`. The standard key is never returned to the
browser.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Pilot documents and executable card contracts live under `agents/` and
`docs/tranches/`.
