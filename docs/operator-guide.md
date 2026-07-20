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

## Facial Foundation rehearsal

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
15. Confirm that the primary statement and quantitative items open complete
    grounding traces and approval establishes Visit 1.
16. In a separate run, choose **End assessment**, dismiss the confirmation once,
    then accept it and confirm that devices release without creating a report.

## Voice Foundation rehearsal

1. Select **Voice Foundation** before consent and confirm that the camera stays
   off.
2. Remain quiet for two seconds, then provide 1.5 seconds of natural speech.
3. Complete two comfortable sustained “ah” trials.
4. Read the displayed sentence.
5. Repeat “pa-ta-ka” until the criterion completes.
6. Describe a familiar routine; brief pauses are allowed.
7. Confirm that level, pitch coverage, SNR, quality, and progress update without
   exposing a waveform or transcript.
8. Confirm that the voice-only evidence card appears and that the microphone
   releases.
9. Run a separate voice assessment, choose **End assessment**, and confirm that
   no report is created.

Optional WavLM representations are not required for the demo. To exercise the
loopback research adapter, start the service as documented in
[`../services/voice-inference/README.md`](../services/voice-inference/README.md)
and set:

```bash
VITE_VOICE_REPRESENTATION_ENDPOINT=http://127.0.0.1:8765/v1/voice/representations
```

This value is an endpoint, not a secret. The sidecar remains disabled unless
`PHENOMETRIC_WAVLM_ENABLED=1` is set for the Python process.

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
  voice system check requires continuous usable natural speech.
- **Fine voice values abstain:** verify actual sample rate, reduce background
  noise, avoid clipping, and confirm Chrome did not force echo cancellation,
  noise suppression, or automatic gain control. Timing values may remain.
- **A voice task does not complete:** follow the criterion-specific prompt.
  Time alone never advances a task, and reading/phoneme accuracy is not
  inferred.
- **WavLM is unavailable:** browser measurements and reporting should continue;
  the optional representation lane abstains independently.
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

Operator diagnostics report privacy-safe requested and actual capture settings,
audio loss/gaps/latency, visual cadence/gaps, processor provenance, and model
digests. They never include device identifiers or labels, media, native visual
observations, PCM, native acoustic arrays, transcripts, or embeddings.
