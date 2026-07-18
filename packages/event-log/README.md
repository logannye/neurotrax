# Append-only encounter event log

> **Legacy demo-spine taxonomy.** This package documents the earlier scripted
> `neurotrax.event-envelope.v0.1` lifecycle. The implemented ambient core uses
> the separate `neurotrax.ambient-event.v0.1` contract in
> `@neurotrax/contracts`.

This package will hold the small event-store abstraction behind Neurotrax's
agent flight recorder. The first implementation can persist newline-delimited
JSON locally in the browser or demo server; the contract is intentionally
portable to a durable event store later.

The event log has two jobs:

1. make the live agent workflow legible to a hackathon audience; and
2. preserve enough provenance to audit how an evidence card was assembled.

It is not a transcript of model reasoning. The interface renders concise,
human-readable summaries of real observations, decisions, actions, and
verified outcomes.

## Envelope

Each line is one immutable `EventEnvelope`:

```json
{
  "schemaVersion": "neurotrax.event-envelope.v0.1",
  "eventId": "evt-007-action-requested",
  "sequence": 7,
  "occurredAt": "2026-07-18T16:00:23.200Z",
  "encounterId": "demo-encounter-002",
  "participantId": "synthetic-participant-001",
  "actor": {
    "kind": "agent",
    "id": "guided-capture",
    "version": "0.1.0"
  },
  "type": "agent.action.requested",
  "stage": "guided-capture",
  "correlationId": "tap-correction-001",
  "causedByEventId": "evt-006-hand-framing-failed",
  "summary": "Capture paused: move your hand into the guide.",
  "payload": {},
  "evidenceRefs": []
}
```

Required envelope fields are `schemaVersion`, `eventId`, `sequence`,
`occurredAt`, `encounterId`, `participantId`, `actor`, `type`, `stage`,
`correlationId`, `summary`, `payload`, and `evidenceRefs`.
`causedByEventId` is present when an event is a direct response to an earlier
event.

## Registered actors

| `actor.kind` | `actor.id` | Responsibility |
| --- | --- | --- |
| `application` | `capture-web` | Consent and browser media capture |
| `agent` | `guided-capture` | Quality gating and bounded coaching |
| `agent` | `personal-trajectory` | Compatibility selection and comparison |
| `agent` | `evidence-card` | Drafting and grounding the clinician card |
| `human-interface` | `clinician-review` | Human disposition boundary |

Only three actors are agents. Applications and human interfaces remain
explicitly distinct so the flight recorder never presents ordinary software or
a pending human decision as autonomous intelligence.

## Product stages

Events use exactly these stages:

- `guided-capture`
- `personal-trajectory`
- `evidence-card`
- `human-review`

The first three correspond to the three product capabilities. `human-review`
is a safety boundary, not a fourth agent.

## Canonical event types

The successful demo fixture uses:

```text
consent.recorded
device.preflight.passed
task.capture.started
task.capture.completed
capture.quality.failed
agent.action.requested
action.outcome.verified
task.capture.resumed
encounter-observation.created
trajectory.compatibility.assessed
trajectory.comparison.completed
evidence-card.drafted
evidence-claim.grounded
human-review.pending
evidence.trace.opened
human-review.accepted
```

Registered alternate outcomes are `evidence-claim.rejected` and
`human-review.rejected`. Fixture fallbacks preserve the underlying type with a
`fixture.` prefix and carry a non-live capture mode. Documentation and UI
projections must use this taxonomy rather than inventing aliases.

## Lifecycle conventions

- Sequences start at `1`, increase by one, and are unique within an encounter.
- Event IDs are globally unique and timestamps never move backward.
- An observation does not disappear when corrected. The log appends the
  requested action and its verified outcome.
- A retry policy is recorded before an agent requests a correction. The demo
  permits one hand-framing correction; the agent cannot silently loop.
- Guided Capture appends `encounter-observation.created` before Personal
  Trajectory begins, making the first agent handoff explicit.
- Trajectory selection records both included and excluded encounter IDs plus
  machine-readable reasons.
- Every generated claim is followed by a grounding event containing its
  measurement and source references.
- `evidence.trace.opened` records the clinician inspecting a grounded claim.
- `human-review.pending` records the handoff to the clinician. The final demo
  event is exactly one `human-review.accepted` or `human-review.rejected`
  disposition; the pending event remains in the audit history.

## Data minimization

The first consent event declares `captureMode` as `live`,
`cached-processor`, `fixture-playback`, or `recorded-demo`. Every downstream
artifact repeats that mode, and the UI projects it as a persistent disclosure.

Event payloads contain derived facts and opaque evidence references, not raw
frames, audio, transcripts, access tokens, or hidden reasoning. Evidence
references resolve through the encounter's retention policy. The example
stream and history are synthetic and contain no protected health information.

## Flight-recorder projection

The demo UI should project events into simple cards:

```text
Observed  → Hand framing failed
Acted     → One reposition request issued
Verified  → Hand visibility recovered
Compared  → 3 compatible encounters; 1 excluded
Grounded  → 2 of 2 evidence-card claims linked to source evidence
Awaiting  → Clinician review
Accepted  → Clinician added the card to synthetic history
```

This projection is disposable and rebuildable. The JSONL stream is the source
of truth.

See the complete synthetic
[encounter event stream](../../examples/encounter-events.example.jsonl) and
[demo patient history](../../examples/demo-patient-history.example.json).
