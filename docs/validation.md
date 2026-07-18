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
- guided completion milestones;
- current-encounter fact selection;
- schema, refusal, retry, timeout, grounding, and clinical-language rejection.

The browser suite covers:

- local facial analysis readiness;
- presentation-copy cleanup;
- system check and guided capture;
- speech continuity through facial withholding;
- facial recovery and a second window;
- two current-encounter statements;
- measurement trace opening;
- summary approval and dismissal.

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

Run three consecutive Chrome rehearsals on the presentation MacBook. Each run
must:

1. complete the system check;
2. finish capture within 30 seconds;
3. produce speech and facial measurements;
4. visibly withhold only facial analysis during turn-away;
5. visibly restore facial analysis after return;
6. produce two grounded statements within 20 seconds;
7. open both traces;
8. record a human review decision;
9. release camera and microphone access;
10. retain no raw media.
