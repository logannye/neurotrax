# Validation and demo-readiness plan

The validation target is agentic infrastructure and evidence fidelity—not a
neurological biomarker claim.

## Automated checks

### Ambient Capture

- calibrated VAD and entry/exit hysteresis;
- 300–2,000 ms pause counting;
- semitone-normalized pitch variability;
- face visibility, framing, yaw, blendshape proxies, and normalized motion;
- 750 ms facial withhold/recovery thresholds;
- incremental window open/close lifecycle;
- monotonic event ordering and unique event IDs;
- aggregate confound and confidence propagation;
- explicit abstention rather than a fabricated value.

The deterministic turn-away replay proves that face analysis abstains, speech
continues, face analysis recovers, and no face measurement overlaps the
unusable interval.

### Personal Trajectory

- accepted-state, participant, code, context, and algorithm compatibility;
- every SNR, framing, frame-rate, and illumination tolerance;
- three included synthetic encounters and one algorithm-version exclusion;
- median, range, median absolute deviation, delta, and direction;
- session-only Accept mutation and Reject non-mutation.

### Evidence Agent

- strict request and response schemas;
- known claim IDs and exact pre-grounded statements;
- measurement/window/event provenance;
- unsupported numbers and prohibited clinical language;
- model refusal or missing parsed output;
- API timeout;
- one grounding retry and second-failure block;
- blank or absent server credential;
- no deterministic prose fallback.

### Browser state machine

Playwright runs a persistently disclosed derived-frame fixture through consent,
facial abstention and recovery, trajectory inclusion/exclusion, evidence-card
assembly, claim tracing, Accept, and Reject. Genuine hardware remains the
default route and is not simulated by this test.

## Commands

```bash
pnpm test
pnpm test:browser
pnpm demo:smoke
```

`pnpm test` runs structure validation, all unit tests, all workspace
typechecks, and the production build. `pnpm test:browser` uses installed Chrome.
`pnpm demo:smoke` makes a real GPT-5.6 request and therefore requires a key and
network access.

## Manual hardware rehearsal

Use the presentation MacBook, Chrome, seat position, resolution, and lighting:

1. confirm the startup readiness bar;
2. grant camera/microphone permission;
3. verify a mirrored live preview and approximately 10 facial FPS;
4. speak for at least three seconds and confirm the speech lane turns teal;
5. keep speaking, turn away for at least one second, and confirm only the face
   lane turns amber;
6. return for at least one second and confirm face recovery;
7. run for 20–30 seconds total, then end;
8. verify both audio and facial aggregates;
9. verify three synthetic inclusions and one exact version exclusion;
10. require a grounded Evidence Card within 20 seconds;
11. open every claim trace;
12. test both Accept and Reject across two encounters;
13. verify the Chrome camera indicator turns off after each encounter.

## Demo-ready gate

The build is ready when the manual path reliably:

- shows real live media by default;
- performs the facial abstention/recovery moment while speech continues;
- creates both audio and facial measurements;
- labels every historical point `SYNTHETIC`;
- excludes the old algorithm encounter by its exact rule;
- produces a grounded required-model card within 20 seconds;
- traces every displayed claim to structured evidence;
- visibly distinguishes Accept from Reject; and
- makes no diagnostic, progression, causal, or treatment claim.

## Current limitation

Passing these gates validates software behavior only. It does not validate any
`prototype.*` signal as a clinical biomarker or establish clinical utility.
