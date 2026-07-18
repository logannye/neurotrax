# Neurotrax capture web

The runnable MacBook demo for all three Neurotrax capabilities: incremental
ambient capture, deterministic personal trajectory, and a required
model-backed Clinician Evidence Card.

Use only the presenter's own non-patient data. Do not mention PHI.

## Runtime responsibilities

- `src/main.ts` owns the one-screen state machine, ephemeral device session,
  workflow-event rail, trajectory reveal, evidence trace, and human review.
- `src/audio-features.ts` performs browser-local RMS, noise-floor calibration,
  VAD hysteresis, clipping, SNR, and pitch derivation.
- `src/face-worker.ts` runs MediaPipe Face Landmarker in a Web Worker at about
  10 FPS and returns only derived face primitives.
- `server/vite-evidence-plugin.ts` exposes server-local readiness and
  evidence-card endpoints without exposing the API key.
- `server/evidence-agent.ts` calls `gpt-5.6` with Structured Outputs, low
  reasoning effort, and low verbosity, then applies deterministic grounding.
- `e2e/fixture-demo.spec.ts` tests the complete disclosed fixture flow,
  including different Accept and Reject outcomes.

The app never uses `MediaRecorder`, never transcribes, and never persists raw
media.

## Run

From the repository root:

```bash
cp .env.example .env.local
# Set OPENAI_API_KEY in .env.local
pnpm install
pnpm demo:smoke
pnpm dev
```

Open `http://127.0.0.1:4173`. A missing key is a startup blocker by design.

For Chrome permission problems, enable Camera and Microphone for Chrome in
macOS System Settings, allow both devices for `127.0.0.1`, and reload.

## Test

```bash
pnpm --filter @neurotrax/capture-web test:unit
pnpm --filter @neurotrax/capture-web typecheck
pnpm --filter @neurotrax/capture-web build
pnpm --filter @neurotrax/capture-web test:browser
```

The browser test uses `/?fixture=1&fast=1`, which is visibly and persistently
labeled as fixture playback. Normal navigation remains live hardware capture.
