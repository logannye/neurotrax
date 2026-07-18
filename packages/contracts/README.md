# Shared contracts

The minimum contract set:

- `EncounterManifest`
- `TaskInstance`
- `CaptureQuality`
- `EncounterObservation`
- `TrajectoryComparison`
- `EvidenceCard`
- `ReviewDecision`
- `EventEnvelope`

Contracts must preserve:

- consent and retention scope;
- live, cached-processor, fixture-playback, or recorded-demo source mode;
- task and prompt version;
- device and media properties;
- quality result;
- measurement and algorithm version;
- evidence provenance;
- review status.

`ReviewDecision.decision` is either `accepted` or `rejected`. An annotation is
optional and does not constitute a third decision state.

## Event envelope

`EventEnvelope` is the append-only audit contract that powers the visible agent
flight recorder. It records what was observed, decided, requested, produced, or
verified without exposing private chain-of-thought.

Every envelope contains:

- a unique `eventId`, encounter-local integer `sequence`, and `occurredAt`;
- the pseudonymous `encounterId` and `participantId`;
- a versioned, registered `actor`;
- a stable `type` and a registered product or review `stage`;
- concise `summary` text suitable for the demo interface;
- structured `payload` facts;
- optional causal links and evidence references.

The encounter's first event declares `captureMode`. `EncounterObservation`,
`TrajectoryComparison`, and `EvidenceCard` repeat the current-capture mode;
trajectory and card artifacts separately mark seeded history as
`synthetic-fixture`. A UI label must be generated from these fields rather than
from presentation state alone.

Events are immutable. Corrections and later outcomes are appended as new events
that point back to the earlier event or action. A projection may be rebuilt
from the ordered stream, but must never silently rewrite it.

The actor registry and lifecycle conventions live in
[the event-log package](../event-log/). The synthetic
[encounter event stream](../../examples/encounter-events.example.jsonl) shows
the full three-agent handoff.

The JSON files in [examples](../../examples/) illustrate the concepts and are
not final schemas.
