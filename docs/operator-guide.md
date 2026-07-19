# PhenoMetric operator guide

This document contains implementation and credential details that are
intentionally absent from the presentation interface and public product
overview.

## Environment

PhenoMetric uses a server-side OpenAI Responses API call for Clinical Synthesis.
The presentation application never receives the credential.

Create `/Users/logannye/Projects/phenometric/.env.local`:

```bash
cd /Users/logannye/Projects/phenometric
read -s "OPENAI_API_KEY?OpenAI API key: "
printf '\n'
umask 077
printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY" > .env.local
unset OPENAI_API_KEY
```

Never use a `VITE_` prefix for this value.

## Start and smoke test

```bash
cd /Users/logannye/Projects/phenometric
pnpm install
pnpm demo:smoke
pnpm dev
```

The smoke command makes one real request to the configured low-latency
`gpt-5.6-luna` synthesis service and validates the structured-output and
grounding contracts. Application readiness also performs one cached warm-up
request when the page first loads, moving connection and service initialization
before the encounter begins.

Automated browser tests set `PHENOMETRIC_SKIP_SYNTHESIS_WARMUP=1` because their
synthesis endpoint is intercepted with a deterministic response. Do not set
that variable for a live presentation.

## Presentation rehearsal

1. Use Chrome on `http://127.0.0.1:4173`.
2. Close other camera or microphone applications.
3. Sit approximately an arm’s length from the MacBook.
4. Use soft, even front lighting.
5. Run the five-second system check. Limited or unavailable quality will not
   prevent the timed assessment from starting.
6. During the first five seconds, remain centered and speak naturally.
7. Turn away while continuing to speak for three seconds.
8. Return to center, stop speaking, and relax the face for three seconds.
9. Smile comfortably and hold for four seconds.
10. Gently close the eyes, hold briefly, then reopen during the final four
    seconds.
11. Confirm that capture closes automatically at nineteen seconds and that the
   camera and microphone are released.
12. Confirm that the results workspace opens automatically. Grounded evidence
   appears immediately while the short narrative is prepared in place.
13. Confirm that both summary statements open a complete grounding trace and
    approval establishes Visit 1.

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

Append `&operator=1` to expose raw workflow events, internal thresholds,
calibration details, service timing, and version identifiers. Never use
operator mode in the presentation recording.

## Common failures

- **System check cannot begin:** confirm consent and verify that Chrome has
  camera and microphone permission.
- **Facial analysis unavailable:** verify that the local MediaPipe assets load
  and refresh Chrome.
- **Move closer persists:** position the face at least 180×220 pixels in the
  analyzed frame while leaving a visible margin around it.
- **Speech quality is limited:** reduce background noise if convenient; the
  assessment will still start when the five-second check ends.
- **Turn-away is not confirmed:** continue the assessment. The coordinator
  records the missed confirmation and advances on schedule without retrying.
- **A facial task is not confirmed:** finish the sequence. Only that task's
  measurements are withheld.

Operator diagnostics report requested and actual camera settings, analyzed
cadence, result gaps, processing latency, skipped frames, MediaPipe version,
delegate, and model digest. They never include camera identifiers, device
labels, native landmarks, transformation matrices, blendshapes, or media.
