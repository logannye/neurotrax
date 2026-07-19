# PhenoMetric shared contracts

`@phenometric/contracts` defines the boundaries among the three implemented
capabilities. These are research-prototype contracts, not clinical schemas.

The generalized platform will add a versioned `ClinicalProtocolPack` and
measurement registry before any condition-specific interpretation is connected
to these contracts. Planned fields and validation responsibilities are defined
in
[`../../docs/telehealth-platform-vision.md`](../../docs/telehealth-platform-vision.md).

## Ambient Capture

- `MeasurableWindow` carries modality, time range, detected context, and
  a discriminated speech or visual quality/confound envelope.
- `Measurement` carries a `prototype.*` code, value, unit, confidence,
  algorithm version, structured uncertainty, `processorRef`, and all
  `sourceWindowRefs`. A facial task measurement can therefore cite both its
  neutral reference and active-task window.
- `Abstention` preserves a reason-coded no-value interval.
- `EncounterObservation` adds its schema version, occurrence time,
  capture-adapter and visual-pipeline provenance, privacy-safe camera settings,
  aggregate confounds, quality summary, windows, measurements, and abstentions.
- `neutral-face`, `smile`, and `eye-closure` are explicit measurement
  contexts. Anatomical subject-left and subject-right do not depend on preview
  mirroring.
- Observation privacy assertions require `containsPHI: false`,
  `rawMediaRetained: false`, and
  `nativeVisualObservationsRetained: false`. Camera identifiers, device labels,
  media, landmarks, blendshapes, and transformation matrices are not contract
  fields.

Visual measurements use `estimated` uncertainty derived from within-task
median absolute deviation. Existing speech measurements use `not-estimated`
with an explicit reason; neither form implies clinical validation.

## Personal Trajectory

- `TrajectoryPolicy` contains explicit SNR, framing, frame-rate, and
  illumination tolerances.
- `CompatibilityDecision` makes inclusion and exclusion inspectable.
- `TrajectoryComparison` preserves robust personal-reference statistics,
  nonclinical direction, evidence references, and the provisional claim
  boundary.
- Compatible measurements must exactly match both algorithm version and visual
  processor reference. A new visual processor begins a new baseline.

## Evidence and review

- `EvidenceClaimFact` is a pre-grounded fact the application attaches to the
  final summary.
- `EvidenceNarrativeDraft` permits only a headline and short summary from the
  synthesis service.
- `EvidenceCardDraft` attaches exactly two pre-grounded claim references and
  the review boundary in application code.
- `EvidenceSynthesisTiming` records total, service, and validation latency for
  operator diagnostics.
- `GroundingResult` records deterministic pass/fail and errors.
- `ReviewDecision` records human approval or dismissal for the current session.

## Workflow events

`EventEnvelope` is the append-only
`phenometric.workflow-event.v0.2` contract shared by `ambient-capture`,
`personal-trajectory`, `evidence-card`, and `human-review`. Visible UI activity
must resolve to one of these real events.

No contract represents diagnosis, disease progression, clinical normality,
treatment, emergency action, or retained raw media.
