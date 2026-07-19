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
5. Run the bounded system check.
6. Remain centered and speak naturally until the first criterion completes.
7. Turn away while continuing to speak until the coordinator advances.
8. Return to center, stop speaking, and hold a quiet neutral reference.
9. Smile comfortably and hold until the smile criterion completes.
10. Gently close the eyes, hold briefly, then reopen them fully.
11. If corrective guidance appears, adjust or repeat the current action.
    Elapsed time never advances or skips an unfinished exercise.
12. Confirm that the 478-point mesh aligns with the mirrored preview while the
    face is usable and disappears during turn-away or other withholding.
13. Confirm that capture closes automatically only after all five criteria and
    that camera and microphone access is released.
14. Confirm that the results workspace opens automatically. Grounded evidence
   appears immediately while the short narrative is prepared in place.
15. Confirm that both summary statements open a complete grounding trace and
    approval establishes Visit 1.
16. In a separate run, choose **End assessment**, dismiss the confirmation once,
    then accept it and confirm that devices release without creating a report.

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
- **Turn-away does not complete:** keep speaking and turn farther until the face
  is not visible or pose leaves the measurement range. Camera, worker, tab,
  blur, lighting, cadence, and frame-gap failures do not count as the exercise.
- **Neutral does not complete:** face the camera and remain quiet; this captures
  a quiet reference and does not claim to detect a relaxed expression.
- **Smile does not complete:** remain quiet, smile comfortably, and hold.
- **Eye closure does not complete:** remain quiet, close either eye or both
  eyes, hold briefly, and reopen fully. Closure and recovery must occur on the
  same eye.
- **A quality interruption occurs:** correct the visible issue and repeat the
  current action. Only the current continuous streak resets.

Operator diagnostics report requested and actual camera settings, analyzed
cadence, result gaps, processing latency, skipped frames, MediaPipe version,
delegate, and model digest. They never include camera identifiers, device
labels, native landmarks, transformation matrices, blendshapes, or media.
