# Neurotrax live capture

The first runnable browser adapter for Neurotrax Ambient Capture. It uses the
MacBook's self-facing camera and microphone for a consented developer self-demo.

> Research prototype only. Use your own non-patient data, do not mention PHI,
> and do not use the output for a clinical decision.

## What it does

1. requires an explicit self-demo consent acknowledgement;
2. requests browser camera and microphone permission;
3. shows a genuinely live, mirrored camera preview;
4. derives audio RMS, voice activity, clipping, estimated SNR, and pitch in the
   browser every 100 milliseconds;
5. retains those derived feature frames only in memory during the encounter;
6. releases the camera and microphone when the user ends the encounter;
7. runs the deterministic Capture Conductor over the collected features; and
8. renders the versioned event trace and final `EncounterObservation`.

It does not use `MediaRecorder`, persist raw media, upload media, transcribe the
conversation, or call a language model.

## Run locally

From the repository root:

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:4173`.

Use flow:

1. Check **I consent to this self-demo**.
2. Choose **Begin live encounter**.
3. Allow camera and microphone access.
4. Speak naturally for 8–12 seconds.
5. Choose **End & analyze**.
6. Inspect the structured event trace, placeholder aggregates, and observation
   JSON.

If no value is produced, repeat the encounter and speak continuously for at
least two seconds. The core deliberately returns no value when it cannot find a
candidate window that passes its current quality contract.

## Current truth boundary

- The camera is live but is used for local preview only.
- Live facial landmarks and facial measurements are not connected.
- The Speech Acoustic and Capture Conductor lanes are real deterministic code.
- Events appear only after `runConductor()` emits them at encounter end.
- All visible live telemetry comes directly from current browser audio frames.
- All measurements remain `prototype.*` engineering placeholders with
  `clinicalValidation: "none"`.

## Browser permissions

Localhost is a permitted secure context for `getUserMedia`. If access fails:

- confirm the browser has camera and microphone permission in macOS System
  Settings;
- confirm the browser site permission for `127.0.0.1`;
- close other applications holding the camera if necessary; and
- reload the page after changing permission.

## Checks

```bash
pnpm --filter @neurotrax/capture-web test:unit
pnpm --filter @neurotrax/capture-web typecheck
pnpm --filter @neurotrax/capture-web build
```

The next capture slice adds a local face-landmark adapter and incremental
Conductor events while preserving the no-recording boundary.
