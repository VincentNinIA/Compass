# GeoTutor jury environment

## Candidate build

The jury candidate is the production Next.js build, not the development server.
Prepare it from a clean machine with the repository lockfile:

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/frontend build
```

The application needs a server runtime because the exercise and Realtime routes
hold the OpenAI credential on the server. A static export is not a valid
candidate. This matches the [Next.js deployment guidance](https://nextjs.org/docs/app/getting-started/deploying),
where a Node.js server supports all Next.js features.

## HTTPS and secrets

Provision a certificate trusted by the jury browser. Keep the certificate and
private key outside the repository and client bundle, then start the built app:

```sh
GEOTUTOR_TLS_CERT=/run/secrets/geotutor-cert.pem \
GEOTUTOR_TLS_KEY=/run/secrets/geotutor-key.pem \
GEOTUTOR_HTTPS_HOST=0.0.0.0 \
GEOTUTOR_HTTPS_PORT=3443 \
pnpm --dir apps/frontend start:https
```

`OPENAI_API_KEY` is a server-only variable. Never prefix it with `NEXT_PUBLIC_`
or place it in HTML. The candidate sends `Permissions-Policy:
microphone=(self), camera=(self)`. Browsers require a secure context and an
explicit user grant for microphone/camera access; see the
[getUserMedia privacy and security guidance](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia#privacy_and_security).

The self-signed certificate used by the automated C06 qualification is only a
local harness. It must not replace a browser-trusted certificate on the jury
machine.

## Jury machine checklist

1. Open the HTTPS URL in a new browser profile with no stored permission.
2. Confirm the page reports a secure context and the current capability badge is
   `scripted_local` before any explicit live action.
3. Select a JPEG, PNG or WebP exercise image, analyze it, review it and confirm
   before the canvas changes.
4. Allow microphone only after choosing **Start voice**. Confirm the browser
   input indicator appears and remote audio is attached before describing the
   mode as live voice.
5. If microphone permission is denied, choose **Use live text**. If Realtime is
   unavailable, continue in the visibly labelled local mode; never describe the
   fallback as live.
6. Verify Reset, keyboard focus, reduced-motion behavior and the permanent
   GeoGebra attribution before presenting.

The reference viewport is 1440 × 900. The application is also qualified at
768 × 1024, 390 × 844 and at the 640 CSS-pixel equivalent of 200% zoom. Tables
and the geometry workspace may use their own two-dimensional region, but the
document itself must not gain horizontal scrolling.

## Accessibility and attribution

The application targets the applicable WCAG 2.2 A/AA requirements for keyboard,
focus, contrast, resize/reflow, status messages and reduced motion. Automated
axe and Lighthouse results support the review but do not replace the keyboard
and visual checks in this runbook. The pinned GeoGebra applet receives a local,
reversible accessibility guard for hidden controls, tab order, decorative
icons and its scrollable panel.

GeoTutor is a non-commercial prototype. GeoGebra attribution and the
[GeoGebra license](https://www.geogebra.org/license) remain visible in the page.
Commercial use is blocked until a separate GeoGebra license and collaboration
agreement is obtained.

## Qualification commands

```sh
pnpm --dir apps/frontend lint
pnpm --dir apps/frontend typecheck
pnpm --dir apps/frontend test --run
pnpm --dir apps/frontend build
pnpm --dir apps/frontend exec playwright test --grep-invert @live

# With certificate paths outside the repository:
GEOTUTOR_TLS_CERT=/path/to/cert.pem \
GEOTUTOR_TLS_KEY=/path/to/key.pem \
pnpm --dir apps/frontend test:e2e:https
```

Record the exact commit or, for a pre-commit worktree candidate, the base HEAD
and the fact that the worktree is dirty. Never report the local self-signed URL
as a remotely deployable jury URL.

## T6 live qualification gate

The automated live gate uses the same production HTTPS entry point, real
GeoGebra, the configured exercise and Realtime services, and one isolated
browser process per run. It deliberately supplies a synthetic browser
`MediaStream` audio track so that microphone input is deterministic; this does
not replace the physical microphone check in the jury checklist.

With the server credential loaded and certificate paths outside the repository:

```sh
GEOTUTOR_TLS_CERT=/path/to/cert.pem \
GEOTUTOR_TLS_KEY=/path/to/key.pem \
pnpm gate:t6:live
```

The command first runs lint, typecheck, Vitest, the production build and all
non-live Playwright scenarios. It then requires three complete live journeys on
one source/environment identity, sequentially and with zero retries. Any failed
step, missing evidence or identity drift resets the counter to zero.

The final independent QA qualification on 15 July 2026 passed 3/3 as
`series_f4ec3e800c0c0dfa76455a24`, candidate
`candidate_e9d7884f850fb105e3cc290c`, environment
`environment_0f52328722a31843a91e9d4b`. Evidence is under
`output/playwright/T6-C07/`: exactly six schema-validated JSON files, one PNG
and one WEBM per run. Any unexpected file invalidates the gate. Network traces
are disabled by design because a Playwright trace can
retain raw SDP. Never add traces, HAR files, SDP, credentials, image payloads or
transcripts to the retained evidence.

This qualification used a local self-signed certificate and proves the
application candidate, not browser trust on a jury machine. Before presenting,
repeat the trusted-certificate and physical-microphone checks above without
changing or mislabelling the automated 3/3 verdict.
