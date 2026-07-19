# Capture web application

The web application owns the consented system check, guided audiovisual
assessment, clinician encounter summary, grounding trace, and human review.

## Runtime responsibilities

- Requests and releases camera and microphone access.
- Calibrates room noise, speech thresholds, visual cadence, face geometry,
  illumination, and sharpness.
- Schedules camera analysis from presented video frames with bounded
  latest-frame-wins backpressure.
- Runs MediaPipe facial inference in an isolated browser worker and keeps
  native landmarks, blendshapes, matrices, and media inside that boundary.
- Streams only compact, versioned facial kinematics into the encounter
  coordinator with anatomical subject-left and subject-right labels.
- Enforces the nineteen-second establishing, turn-away, neutral-face, smile,
  and eye-closure sequence.
- Sends bounded current-encounter facts to the server-side synthesis endpoint.
- Displays only deterministically grounded statements.

## Commands

```bash
pnpm dev
pnpm test:unit
pnpm test:browser
pnpm typecheck
pnpm build
```

Credential configuration, the service smoke test, and operator-only capture
testing are documented in [`../../docs/operator-guide.md`](../../docs/operator-guide.md).
