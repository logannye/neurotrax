# Neurotrax shared contracts

`@neurotrax/contracts` defines the boundaries among the three implemented
capabilities. These are research-prototype contracts, not clinical schemas.

## Ambient Capture

- `MeasurableWindow` carries modality, time range, detected context, and
  quality/confound envelope.
- `Measurement` carries a `prototype.*` code, value, unit, confidence,
  algorithm version, placeholder uncertainty, and source-window reference.
- `Abstention` preserves a reason-coded no-value interval.
- `EncounterObservation` adds occurrence time, capture-adapter provenance,
  aggregate confounds, quality summary, windows, measurements, and abstentions.

## Personal Trajectory

- `TrajectoryPolicy` contains explicit SNR, framing, frame-rate, and
  illumination tolerances.
- `CompatibilityDecision` makes inclusion and exclusion inspectable.
- `TrajectoryComparison` preserves robust personal-reference statistics,
  nonclinical direction, evidence references, and the provisional claim
  boundary.

## Evidence and review

- `EvidenceClaimFact` is a pre-grounded fact the model may select.
- `EvidenceCardDraft` permits one headline, one short summary, and at most two
  exact claim references.
- `GroundingResult` records deterministic pass/fail and errors.
- `ReviewDecision` records human Accept or Reject and whether page-session
  history changed.

## Workflow events

`EventEnvelope` is the append-only
`neurotrax.workflow-event.v0.2` contract shared by `ambient-capture`,
`personal-trajectory`, `evidence-card`, and `human-review`. Visible UI activity
must resolve to one of these real events.

No contract represents diagnosis, disease progression, clinical normality,
treatment, emergency action, or retained raw media.
