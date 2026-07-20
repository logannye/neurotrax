# Capture web application

The web application owns protocol selection, the consented system check,
guided facial or microphone-only voice assessment, clinician encounter
summary, grounding trace, and human review.

## Runtime responsibilities

- Requests camera plus microphone for Facial Foundation or microphone only for
  Voice Foundation, then releases every track and processing resource.
- Calibrates room noise and continuous voice quality; facial mode additionally
  calibrates visual cadence, face geometry, illumination, and sharpness.
- Captures continuous 20 ms audio blocks in an `AudioWorklet`, transfers them
  to a dedicated worker, and analyzes 40 ms windows every 10 ms with bounded
  memory and explicit discontinuity handling.
- Runs two sustained vowels, reading, rapid syllables, and spontaneous response
  as completion-gated Voice Foundation tasks.
- Produces task-specific `prototype.voice.*` measurements and independent
  abstentions without retaining native audio observations.
- Schedules camera analysis from presented video frames with bounded
  latest-frame-wins backpressure.
- Runs MediaPipe facial inference in an isolated browser worker and keeps
  native landmarks, blendshapes, matrices, and media inside that boundary.
- Renders a full 478-point facial mesh directly to a transferred worker-owned
  canvas at no more than 12 Hz; native landmark coordinates and overlay pixels
  never return to the application thread or enter serialized artifacts.
- Streams only compact, versioned facial kinematics into the encounter
  coordinator with anatomical subject-left and subject-right labels.
- Advances the establishing, turn-away, neutral-face, smile, and eye-closure
  exercises only after their signal criteria are continuously satisfied,
  resetting a streak after a visual-result gap over 200 ms.
- Preserves only the final qualifying task interval for facial measurement;
  failed attempts remain transient and cannot alter the neutral baseline.
- Lets the participant end and discard capture at any time without producing
  a report.
- Sends bounded current-encounter facts to the server-side synthesis endpoint.
- Displays only deterministically grounded statements.

The optional loopback WavLM service is disabled by default. Representation
summaries remain transient; only processor provenance can enter the
observation. See
[`../../docs/voice-foundation.md`](../../docs/voice-foundation.md).

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
