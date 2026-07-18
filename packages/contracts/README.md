# Ambient core contracts

`@neurotrax/contracts` contains the deterministic data boundaries implemented
by the headless Ambient Capture core. These are research-prototype contracts,
not clinical schemas.

## Exported contracts

### Capture provenance

`CaptureMode` distinguishes:

- `live`
- `cached-processor`
- `fixture-playback`
- `recorded-demo`

The current runnable path uses only `fixture-playback`.

### Measurement context

`MeasurableWindow` identifies a candidate speech or face interval and carries a
detected `MeasurementContext`:

- context kind, such as `spontaneous-speech` or `listening-expressive`;
- audio signal-to-noise ratio;
- face-framing fraction;
- observed frame rate; and
- relative illumination.

The name is a versioned contract term. Detection creates a candidate window;
the matching extractor still applies its quality gates and may return an
`Abstention`.

### Measurements and abstentions

Every `Measurement` includes:

- a stable prototype code, label, value, and unit;
- confidence and placeholder uncertainty;
- algorithm version and `clinicalValidation: "none"`;
- its source window and time range; and
- an optional future evidence-snippet reference.

An `Abstention` records the modality, window, reason code, and human-readable
detail. A failed quality contract never produces a substitute value.

### Per-visit observation

`EncounterObservation` is the output of the Capture Conductor. It preserves:

- synthetic/PHI status and capture mode;
- visit and participant identifiers;
- candidate windows and their confound envelopes;
- raw per-window measurements;
- robust biomarker-and-context aggregates;
- abstentions; and
- the total measurement count.

The current `FrameStream` contract accepts only `containsPHI: false`, making the
implemented core explicitly synthetic-only. Live patient or PHI-bearing input
requires a future, separately reviewed contract.

### Ambient event envelope

`EventEnvelope` is the ordered trace consumed by the future multi-lane flight
recorder. Each event has:

- deterministic encounter-local sequence and event ID;
- visit, participant, and actor-lane identity;
- a stable ambient event type and stage;
- a concise summary plus structured payload; and
- optional evidence references.

The current headless core returns an in-memory ordered event trace. A durable,
append-only event store is future work.

## Deliberate boundaries

- Measurement code is deterministic; a language model never creates or gates a
  value.
- All measurement uncertainty is explicitly a placeholder.
- No contract represents diagnosis, progression, treatment, or emergency
  action.
- Context and algorithm version are preserved so future longitudinal logic can
  reject incompatible comparisons.
- Media and transcripts remain untrusted inputs and are not embedded in these
  contracts.

The earlier task-bound JSON examples and event-log documentation remain as
legacy demo-spine references. They use a separate
`neurotrax.event-envelope.v0.1` taxonomy and are not the ambient core's
`neurotrax.ambient-event.v0.1` schema.
