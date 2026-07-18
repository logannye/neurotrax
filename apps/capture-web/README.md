# Neurotrax capture web sidecar

> **Superseded application brief.** This file preserves the earlier prompted
> Guided Capture concept. The next application slice is consented, ephemeral,
> non-interrupting browser ingestion for the accepted ambient-capture design.

The browser sidecar for Neurotrax's **Guided Capture** capability. The first
prototype uses a MacBook camera and microphone beside a simulated telehealth
encounter; it does not provide live calling.

> Research prototype only. Use synthetic identities and the developer's own
> explicitly consented recordings. Do not use patient data or make clinical
> decisions.

## Demo surface

The capture view uses a stable 70/30 layout:

- the left 70% keeps the live self-facing camera visually dominant;
- the right 30% is an Agent Activity rail;
- a persistent footer states whether camera and microphone access is active,
  whether recording is active, where media is retained, and whether the
  encounter uses live or fixture data.

The camera overlay contains only task-relevant guidance: framing guides, the
current prompt, a countdown, a restrained microphone waveform, and quality
feedback. It must never imply diagnosis, disease severity, emotion, intent, or
clinical interpretation.

## Agent Activity rail

The rail is a human-readable projection of real, timestamped workflow events.
It is not chain-of-thought, model reasoning, or decorative agent conversation.
Each item exposes one of three states:

1. `observed` — a quality or workflow condition was measured;
2. `acted` — the Guided Capture Agent changed the workflow;
3. `verified` — the outcome of that action was checked.

Example:

```text
10:04:12  observed  Hand visibility below task threshold
10:04:12  acted     Capture paused; reposition requested
10:04:15  verified  Full hand visible; capture resumed
```

The UI may animate an event from pending to complete, but it must be backed by
an audit event such as:

```text
consent.recorded
device.preflight.passed
task.capture.started
capture.quality.failed
agent.action.requested
action.outcome.verified
task.capture.resumed
task.capture.completed
encounter-observation.created
```

## Guided Capture state machine

```text
idle
  -> consent-required
  -> permission-required
  -> preflight
  -> speech-ready
  -> speech-recording
  -> speech-complete
  -> tapping-ready
  -> tapping-recording
  -> framing-blocked
  -> reposition-requested
  -> framing-verified
  -> tapping-recording
  -> capture-complete
  -> handoff
```

Every recording state has an obvious stop control. Withdrawing consent,
revoking permission, or stopping capture moves directly to a non-recording
state and prevents downstream comparison.

## The one visible agent intervention

The stage demo intentionally begins the seated finger-tapping task with the
presenter's hand partly outside a visible guide. A deterministic hand-visibility
rule pauses capture, requests repositioning, verifies recovery, and resumes.
The intervention demonstrates a closed loop:

```text
observe -> decide -> act -> verify
```

This rule should be deliberately simple and inspectable. The first slice allows
one correction attempt; a second failure returns `not measurable`. No model is
allowed to invent a successful quality result.

## First implementation slice

- explicit consent and visible recording state;
- MacBook camera and microphone permission;
- local preview and microphone meter;
- seated speech and finger-tapping instructions;
- local, task-bound recording;
- one deterministic hand-framing correction;
- pass, one retry, or `not measurable`;
- versioned encounter observation handoff;
- local media deletion.

After `encounter-observation.created`, the camera tile contracts into the
current-encounter tile while the same shell advances to Personal Trajectory and
then the Clinician Evidence Card. The full transition and stage timing are
defined in [the demo experience](../../docs/demo-experience.md).

## Demo reliability

Stage mode uses the real MacBook camera and microphone for the current encounter
and deterministic, clearly labeled synthetic fixtures for prior history.

- Run camera, microphone, lighting, and browser checks before presenting.
- Cache all assets locally; the demo must not require network access.
- Warm up the hand-landmark detector before entering the tapping task.
- Pin the browser and capture settings used during rehearsal.
- Provide a fixture-playback fallback if media permission or hardware fails.
- Label fallback output `FIXTURE PLAYBACK — NOT LIVE CAPTURE`.
- If the framing detector must be fixture-driven, emit a
  `fixture.capture.quality.failed` event and keep the fixture label visible.

Fixture mode preserves the UI sequence; it never masquerades as a live
measurement.

## Non-goals

- live telehealth calling;
- continuous or ambient recording;
- diagnosis or disease classification;
- longitudinal interpretation inside the capture agent;
- clinical recommendations;
- hidden inference or chain-of-thought display.
