# Neurotrax operator guide

This document contains implementation and credential details that are
intentionally absent from the presentation interface and public product
overview.

## Environment

Neurotrax uses a server-side OpenAI Responses API call for Clinical Synthesis.
The presentation application never receives the credential.

Create `/Users/logannye/Projects/neurotrax/.env.local`:

```bash
cd /Users/logannye/Projects/neurotrax
read -s "OPENAI_API_KEY?OpenAI API key: "
printf '\n'
umask 077
printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY" > .env.local
unset OPENAI_API_KEY
```

Never use a `VITE_` prefix for this value.

## Start and smoke test

```bash
cd /Users/logannye/Projects/neurotrax
pnpm install
pnpm demo:smoke
pnpm dev
```

The smoke command makes one real request to the configured low-latency
`gpt-5.6-luna` synthesis service and validates the structured-output and
grounding contracts. Application readiness also performs one cached warm-up
request when the page first loads, moving connection and service initialization
before the encounter begins.

Automated browser tests set `NEUROTRAX_SKIP_SYNTHESIS_WARMUP=1` because their
synthesis endpoint is intercepted with a deterministic response. Do not set
that variable for a live presentation.

## Presentation rehearsal

1. Use Chrome on `http://127.0.0.1:4173`.
2. Close other camera or microphone applications.
3. Sit approximately an arm’s length from the MacBook.
4. Use soft, even front lighting.
5. Run the system check and wait for every lane to reach Ready.
6. During capture, keep speaking through the turn-away interval.
7. Return to the original calibrated position until Signal restored appears.
8. Confirm that capture closes automatically after the final valid facial
   window and that the camera and microphone are released.
9. Select **View measured evidence** or **View encounter summary**. Summary
   synthesis begins before this action, so a completed card may already be
   waiting.
10. Confirm that both summary statements open a complete grounding trace.

Clinical Synthesis uses priority processing, no reasoning pass, and a bounded
response size. Request timing is written only to the browser operator console
and the `Server-Timing` response header.

## Operator-only test capture

Automated browser tests use a development-only derived-frame adapter:

```text
http://127.0.0.1:4173/?testCapture=1&fast=1
```

It is not linked from the presentation interface and is not used as a fallback
for a live assessment.

## Common failures

- **System check cannot begin:** verify the server credential and restart the
  development server.
- **Facial analysis unavailable:** verify that the local MediaPipe assets load
  and refresh Chrome.
- **Move closer persists:** position the face so it occupies at least 14% of
  frame width.
- **Speech verification stalls:** reduce background noise and speak naturally
  for another two seconds.
- **Assessment does not close automatically:** follow the current on-screen
  cue; the flow requires initial measurement, withholding, recovery, and a
  final facial window.
