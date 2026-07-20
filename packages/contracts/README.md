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
- `EncounterObservation` v2 adds selected protocol, occurrence time,
  capture-adapter, visual/audio/model provenance, privacy-safe camera and
  microphone settings, stream diagnostics, aggregate confounds, quality
  summary, windows, measurements, and abstentions.
- `neutral-face`, `smile`, and `eye-closure` are explicit measurement
  contexts. Anatomical subject-left and subject-right do not depend on preview
  mirroring.
- `VoiceSignalFrameV1` carries timing, epoch/sequence, absolute sample index,
  task, compact voicing/acoustic primitives, quality reasons, and processor
  reference. It carries no PCM or native arrays.
- Voice task contexts include quiet calibration, natural-speech check, two
  sustained vowels, standardized reading, rapid syllables, and spontaneous
  response. Accepted task intervals are explicit conductor inputs.
- Observation privacy assertions require `containsPHI: false`,
  `rawMediaRetained: false`, `rawAudioRetained: false`,
  `nativeAudioObservationsRetained: false`, `transcriptRetained: false`,
  `voiceEmbeddingsRetained: false`, and
  `nativeVisualObservationsRetained: false`.

Visual and repeatable voice measurements use median-absolute-deviation
uncertainty. Repeated vowels use between-trial MAD. Non-repeatable values use
`not-estimated` with an explicit reason; neither form implies clinical
validation.

## Personal Trajectory

- `TrajectoryPolicy` contains explicit SNR, framing, frame-rate, and
  illumination tolerances.
- `CompatibilityDecision` makes inclusion and exclusion inspectable.
- `TrajectoryComparison` preserves robust personal-reference statistics,
  nonclinical direction, evidence references, and the provisional claim
  boundary.
- Compatible measurements exactly match algorithm and modality processor
  reference. Voice also exact-matches browser-processing state and sample-rate
  class. A new processor begins a new baseline.

## Evidence and review

- `EvidenceClaimFact` is a pre-grounded fact the application attaches to the
  final summary.
- `EvidenceNarrativeDraft` permits only a headline and short summary from the
  synthesis service.
- `EvidenceCardDraft` attaches one or more unique participating-modality claim
  references and the review boundary in application code. Current protocols
  each send one outcome.
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
