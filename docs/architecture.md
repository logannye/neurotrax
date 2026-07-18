# Three-capability architecture

## Scope

Neuro Encounter has three capabilities:

1. Guided Capture
2. Personal Trajectory
3. Clinician Evidence Card

Consent, provenance, retention, and human sign-off are shared foundations. They
are not separate product features.

## Data flow

```text
MacBook camera and microphone
  -> Guided Capture Agent
  -> quality-controlled encounter observation
  -> Personal Trajectory Agent
  -> Clinician Evidence Card Agent
  -> clinician decision: accepted or rejected, with optional annotation
  -> accepted longitudinal history
```

## 1. Guided Capture Agent

### Responsibility

Create one trustworthy encounter observation.

### Inputs

- consent and retention scope;
- approved check-in protocol;
- MacBook camera and microphone;
- optional confirmed medication and context fields.

### Behavior

- request browser media permission;
- show visible capture state;
- run audio and video preflight;
- guide the speech and finger-tapping samples;
- capture short local clips;
- attach device, task, and time metadata;
- pass, request one retry, or return `not measurable`.

### Output

A quality-controlled `EncounterObservation`.

### Boundary

The agent does not diagnose, compare longitudinal history, or recommend an
action.

## 2. Personal Trajectory Agent

### Responsibility

Compare today's accepted-quality observation with the patient's own compatible
history.

### Compatibility rules

- exact protocol, task, and prompt versions;
- compatible capture adapter;
- passing quality;
- known measurement version;
- medication and context differences made visible.

### Output

A provisional `TrajectoryComparison` containing:

- included and excluded observations;
- change estimate;
- uncertainty;
- comparability warnings;
- current and prior evidence references.

### Boundary

The agent cannot declare disease progression, infer a cause, or generate a
treatment plan.

## 3. Clinician Evidence Card Agent

### Responsibility

Compress the encounter and comparison into an inspectable clinician artifact.

### Card contents

- successful and failed measurements;
- current value and prior range;
- provisional change and uncertainty;
- context and comparability warnings;
- current and prior clips;
- an `accepted` or `rejected` decision with an optional annotation.

### Boundary

The agent drafts. The clinician interprets and signs. Only accepted observations
enter history.

## Shared contracts

The first contract set contains:

- `EncounterManifest`
- `TaskInstance`
- `CaptureQuality`
- `EncounterObservation`
- `TrajectoryComparison`
- `EvidenceCard`
- `ReviewDecision`

These are described in [packages/contracts](../packages/contracts/).

## Deployment

The first prototype may run entirely in one local browser application. Logical
agent boundaries should still be preserved so later device and service adapters
can replace local implementations without changing the workflow.

## What is intentionally absent

- protocol marketplace;
- autonomous clinical reasoning;
- EHR write agent;
- background ambient agent;
- foundation model;
- forecasting service;
- disease classifier;
- patient alerting service;
- separate microservice per signal modality.
