# Shared contracts

The minimum contract set:

- `EncounterManifest`
- `TaskInstance`
- `CaptureQuality`
- `EncounterObservation`
- `TrajectoryComparison`
- `EvidenceCard`
- `ReviewDecision`

Contracts must preserve:

- consent and retention scope;
- task and prompt version;
- device and media properties;
- quality result;
- measurement and algorithm version;
- evidence provenance;
- review status.

`ReviewDecision.decision` is either `accepted` or `rejected`. An annotation is
optional and does not constitute a third decision state.

The JSON files in [examples](../../examples/) illustrate the concepts and are
not final schemas.
