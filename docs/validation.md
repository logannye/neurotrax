# Validation

## Automated coverage

The unit suite covers:

- quiet-room calibration and voice hysteresis;
- rejection of unpitched room energy;
- bounded pause detection;
- pitch coverage and normalized pitch variability;
- adaptive facial baseline creation;
- face visibility, geometry, pose, and illumination guidance;
- facial withholding and recovery;
- fixed-duration phase progression and timeout ordering;
- eight-frame strong voice calibration and limited calibration;
- missed turn-away and missed recovery handling;
- twenty varied deterministic encounter replays;
- automatic capture finalization and synthesis prefetch;
- measured and withheld modality outcome creation;
- deterministic claim and boundary assembly;
- schema, refusal, retry, timeout, grounding, and clinical-language rejection.

The browser suite covers:

- local facial analysis readiness;
- presentation-copy cleanup;
- system check and guided capture;
- speech continuity through facial withholding;
- facial recovery and a second window;
- automatic results reveal while synthesis is still pending;
- two current-encounter statements;
- measurement trace opening;
- summary approval and dismissal.
- synthesis failure with evidence-only review;
- approval establishing Visit 1 with empty future placeholders.

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
2. finish capture after the fixed twenty-four-second sequence and reach results
   within 35 seconds;
3. produce one honest outcome for speech and one for facial analysis;
4. visibly withhold only facial analysis during turn-away;
5. visibly restore facial analysis after return;
6. make two grounded outcomes available immediately and complete the
   clinician-readable narrative within 20 seconds under the demo network
   conditions;
7. open both traces;
8. record a human review decision and establish Visit 1 after approval;
9. release camera and microphone access;
10. retain no raw media.
