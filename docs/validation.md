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
- fixed nineteen-second phase progression and timeout ordering;
- eight-frame strong voice calibration and limited calibration;
- missed turn-away and missed facial-task handling;
- twenty varied deterministic encounter replays;
- automatic capture finalization and synthesis prefetch;
- measured and withheld modality outcome creation;
- deterministic claim and boundary assembly;
- schema, refusal, retry, timeout, grounding, and clinical-language rejection.

The browser suite covers:

- local facial analysis readiness;
- a blank-bitmap MediaPipe worker initialization smoke test;
- presentation-copy cleanup;
- system check and guided capture;
- speech continuity through facial withholding;
- facial recovery followed by neutral, smile, and eye-closure task windows;
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
3. finish capture after the fixed nineteen-second sequence and reach results
   within 35 seconds;
4. analyze at a median cadence of at least 24 Hz, with p95 result gaps no
   greater than 100 ms and a busy-drop fraction no greater than 10%;
5. preserve monotonic acquisition timestamps with no regressions;
6. pass a manual subject-left and subject-right eye verification independent of
   the mirrored preview;
7. produce one honest outcome for speech and one for facial analysis;
8. visibly withhold only facial analysis during turn-away;
9. visibly restore facial analysis for the prompted tasks;
10. make two grounded outcomes available immediately and complete the
    clinician-readable narrative within 20 seconds under the demo network
    conditions;
11. open both traces;
12. record a human review decision and establish Visit 1 after approval;
13. release camera and microphone access; and
14. serialize no media, landmarks, blendshapes, transformation matrices, or
    camera identifiers.
