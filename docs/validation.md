# Validation

## Automated coverage

The unit suite covers:

- quiet-room calibration and voice hysteresis;
- rejection of unpitched room energy;
- bounded pause detection;
- speech initiation latency, voiced-time fraction, pause rate, pitch coverage,
  pitch center, and normalized pitch variability;
- duration- and coverage-based facial calibration;
- face visibility, size, margins, pose, illumination, clipping, sharpness,
  cadence, skipped-frame fraction, and frame-gap quality boundaries;
- anatomical left-right mapping and geometry invariance under translation,
  scale, in-plane rotation, and CSS preview mirroring;
- bilateral smile excursion and eye-closure fraction, their asymmetries, and
  task-specific abstention;
- acquisition timestamp preservation, latest-frame-wins backpressure,
  stale-result rejection, cadence calculation, and bounded worker restart;
- completion-gated phase progression, every gate boundary, continuous-streak
  reset, and criterion-specific assistance after twelve seconds;
- proof that elapsed time, technical withholding, and unfinished tasks cannot
  advance the workflow;
- exact accepted-interval clipping, neutral dependency, smile hold, and
  same-eye close-then-reopen recognition;
- eight-frame strong voice calibration and limited calibration;
- repeated failed attempts followed by successful completion, processor-change
  rewind, and cancellation without an observation or report;
- full-mesh drawing, 12 Hz throttling, finite-coordinate rejection,
  task-region accents, and renderer clearing;
- automatic capture finalization and synthesis prefetch;
- measured and withheld modality outcome creation;
- deterministic claim and boundary assembly;
- schema, refusal, retry, timeout, grounding, and clinical-language rejection.

The browser suite covers:

- local facial analysis readiness;
- a blank-bitmap MediaPipe worker initialization smoke test;
- presentation-copy cleanup;
- system check and guided capture;
- no advancement for an unfinished task and corrective guidance without skip;
- speech continuity through facial withholding;
- facial recovery followed by neutral, smile, and eye-closure task windows;
- cancellation confirmation, immediate device release, and no report;
- cancellation winning over pending auto-finalization, late media acquisition
  being stopped after consent withdrawal, and replacement of a transferred
  mesh canvas after discard;
- mesh/video CSS alignment, worker-restart canvas reattachment, and mesh
  hiding on intentional withholding, camera unavailability, and a hidden tab;
- automatic results reveal while synthesis is still pending;
- an eleven-measurement quantitative encounter profile;
- two primary current-encounter statements;
- primary-claim and quantitative-profile trace opening;
- summary approval and dismissal;
- synthesis failure with evidence-only review;
- approval establishing Visit 1 with empty future placeholders.

CI runs `pnpm test` and the Playwright browser suite as separate required jobs,
keeping contract, unit, type, and build feedback independent from the slower
Chrome path.

## Commands

```bash
pnpm test:unit
pnpm typecheck
pnpm build
pnpm test:browser
pnpm demo:smoke
pnpm test
```

## Manual acceptance

Run five consecutive Chrome rehearsals on the presentation MacBook. Each run
must:

1. complete the system check;
2. request 1280×720 at an ideal 30 fps;
3. remain on every exercise until its signal criterion is satisfied, with no
   timeout or skip;
4. advance within 500 ms after each gate becomes satisfied;
5. analyze at a median cadence of at least 24 Hz, with p95 result gaps no
   greater than 100 ms and a busy-drop fraction no greater than 10%;
6. preserve monotonic acquisition timestamps with no regressions;
7. pass a manual subject-left and subject-right eye verification independent of
   the mirrored preview;
8. render all 478 mesh points aligned with the preview and accent the active
   task regions at no more than 12 Hz;
9. clear the mesh immediately during turn-away, hidden/muted/ended capture,
   worker outage, epoch reset, consent withdrawal, and media release;
10. recognize same-eye closure followed by reopening;
11. produce one honest outcome for speech and one for facial analysis;
12. visibly withhold only facial analysis during intentional turn-away;
13. visibly restore facial analysis for the prompted tasks;
14. make two grounded outcomes available immediately and complete the
    clinician-readable narrative within 20 seconds under the demo network
    conditions;
15. open both traces;
16. record a human review decision and establish Visit 1 after approval;
17. release camera and microphone access;
18. cancel a separate run without creating a report; and
19. serialize no media, landmarks, mesh connections, overlay pixels,
    blendshapes, transformation matrices, or camera identifiers.
