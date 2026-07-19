# Protocol registry

Clinical applications will be represented as versioned protocol packs within
Ambient Capture, Personal Trajectory, and the Clinician Evidence Card.

The target `ClinicalProtocolPack` contract will define:

- intended use and target population;
- ambient and prompted capture contexts;
- required and optional modalities;
- measurement codes, algorithms, and units;
- quality, confound, uncertainty, and abstention rules;
- reference standard and validation evidence;
- permitted claims and prohibited extrapolations; and
- the required human-review workflow.

No clinical protocol pack is implemented or validated yet. The planned contract
and evidence requirements are described in
[`../docs/telehealth-platform-vision.md`](../docs/telehealth-platform-vision.md).

> **Legacy scripted protocol.** Ambient Capture does not prompt the patient to
> perform this task in the current live workflow. It is retained only as a
> historical demo fixture.

The MVP contains one non-clinical protocol:

`macbook-check-in.v0.1`

It captures:

1. a brief standardized speech sample;
2. a brief seated finger-tapping sample.

The protocol exists to test consent, capture, quality, provenance, comparison,
and review in the PhenoMetric demo spine. It is not a validated neurological
examination.
