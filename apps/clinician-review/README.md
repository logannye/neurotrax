# Neurotrax clinician review

The review surface for Neurotrax's **Clinician Evidence Card** capability. It is
the final reveal of the demo: one compact, inspectable artifact assembled from
Guided Capture and Personal Trajectory outputs.

> The card contains provisional technical observations from a research
> prototype. It is not a diagnosis, disease-progression assessment, treatment
> recommendation, or substitute for clinical judgment.

## Transition from capture

The experience remains in one application shell. After capture:

1. the live camera contracts into a current-encounter tile;
2. the Agent Activity rail records compatible-history selection;
3. the trajectory view shows which synthetic encounters were included and why
   one incompatible encounter was excluded;
4. the card assembles section by section from structured, cited facts;
5. review controls unlock only after every displayed claim passes grounding.

The prior history is deterministic synthetic data and is always labeled
`SYNTHETIC HISTORY`. The current encounter is labeled `LIVE CAPTURE` unless the
transparent fixture fallback was used.

## Evidence Card

The single-screen card answers:

1. Was today's capture usable?
2. What changed relative to compatible personal history?
3. What remained stable?
4. What evidence supports each statement?
5. How uncertain and comparable is the observation?

The first slice contains:

- a plain-language headline with no disease or treatment claim;
- capture quality and any correction performed;
- two compact longitudinal sparklines;
- current value, prior range, uncertainty, and units;
- medication, device, protocol, or context differences;
- current and prior source clips;
- a claim-provenance drawer;
- `Accept into history` and `Reject` controls;
- an optional clinician annotation.

Only an accepted observation enters longitudinal history. Rejection preserves
the audit event but does not update the comparison baseline.

## Claim-to-clip traceability

Every narrative statement is clickable. Selecting it highlights the structured
measurement and opens the exact supporting media segment. The trace drawer
shows:

```text
claim
  -> measurement and uncertainty
  -> current task and source-clip time range
  -> compatible prior observation references
  -> capture-quality result
  -> protocol, processor, and algorithm versions
  -> context and comparability warnings
```

A claim without all required references is withheld from the card and recorded
as `evidence-claim.rejected`. The interface must not generate a citation after
the fact or display a claim based only on model prose.

## Agent Activity rail

The rail continues the audit narrative from capture. It displays real events,
not chain-of-thought:

```text
trajectory.compatibility.assessed
trajectory.comparison.completed
evidence-card.drafted
evidence-claim.grounded
human-review.pending
evidence.trace.opened
human-review.accepted
human-review.rejected
```

Each exclusion exposes its rule, such as `prompt version mismatch`. Each card
claim exposes the IDs of its supporting measurements and clips. Model prompts,
private scratch work, and invented agent dialogue never appear.

## Review states

```text
capture-handoff
  -> selecting-compatible-history
  -> comparing
  -> drafting-card
  -> validating-claims
  -> review-ready
  -> accepted | rejected
```

Failure to load history produces a current-encounter-only card rather than a
fabricated trend. Failure to ground a claim removes that claim. Capture-quality
failure produces `not measurable`.

## Demo reliability

- Seed versioned synthetic history locally for a fixed demo identity.
- Include three compatible prior encounters and one deliberately incompatible
  encounter so selection behavior is guaranteed to be visible.
- Precompute fixture comparisons, but replay the same real audit events the
  live orchestration would emit.
- Keep all clips and comparison data local and available offline.
- If current capture falls back to a fixture, retain the
  `FIXTURE PLAYBACK — NOT LIVE CAPTURE` label on the final card.
- Never change a clinical-looking value merely to improve the stage narrative.

See [the demo experience](../../docs/demo-experience.md) for the complete
two-and-a-half-minute choreography.

## Non-goals

- diagnosis or disease-progression classification;
- treatment recommendations;
- autonomous clinical action;
- order entry;
- patient messaging;
- EHR integration;
- ungrounded narrative generation.
