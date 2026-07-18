# Validation plan

The first validation target is the infrastructure, not a disease biomarker.

## Question 1: Can Guided Capture create a repeatable observation?

Measure:

- permission and consent completion;
- successful first-pass capture;
- bounded retry behavior;
- audio clipping and noise detection;
- video framing and observed frame rate;
- correct task labeling;
- asset hash and metadata completeness.

## Question 2: Can Personal Trajectory select comparable history?

Test:

- inclusion of matching protocol and measurement versions;
- exclusion of failed-quality observations;
- visibility of device or context changes;
- deterministic comparison selection;
- uncertainty propagation;
- no progression claim from one deviation.

## Question 3: Can the Evidence Card support fast, correct review?

Measure:

- time to understand the result;
- ability to inspect source clips;
- correctness of the accepted-or-rejected decision;
- usefulness and fidelity of optional annotations;
- whether rejected observations remain out of history;
- note-edit burden;
- reviewer trust and comprehension.

## Demo-readiness gate

The hackathon build is ready to present only when:

- the complete consent-to-review path runs locally in under three minutes;
- every Agent Activity entry resolves to an immutable event envelope;
- poor hand framing pauses capture, requests at most one correction, verifies
  recovery, and can still end as `not measurable`;
- the current camera and microphone capture is live or unmistakably labeled as
  fixture playback;
- all prior encounters remain visibly labeled synthetic;
- the same deterministic fixture yields three included encounters and one
  prompt-version exclusion;
- every generated claim resolves to a measurement, source clip, and grounding
  event;
- acceptance and rejection produce different history outcomes; and
- the interface makes no diagnosis, progression, cause, or treatment claim.

Rehearse the preferred live path and every labeled fallback described in
[the demo experience](demo-experience.md). Demo smoothness cannot come from
fabricated agent activity or hidden fixture substitution.

## Later validation

Only after the three-capability loop works should a measurement advance through:

1. technical verification;
2. analytical repeatability;
3. clinical validation in an intended population;
4. responsiveness to meaningful change;
5. clinical utility;
6. economic evaluation.

Extractability is not validity, and sensitivity is not a surrogate endpoint.
