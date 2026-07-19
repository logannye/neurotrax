# Personal Trajectory

## Goal

Compare each current measurement only with accepted, compatible observations
from the same person.

## Agentic behavior

- match participant, measurement code, detected context, and algorithm version;
- match protocol, task, capture-adapter, and approved clinical context as those
  contracts are introduced;
- enforce SNR, face-framing, frame-rate, and illumination tolerances;
- include or exclude prior data with exact reason codes;
- compute median, range, median absolute deviation, and current delta; and
- emit a nonclinical direction.

The checked-in fixture contains three compatible accepted visits and one
algorithm-version exclusion. Every seeded point remains visibly `SYNTHETIC`.
The live application does not yet persist or compare real multi-visit history.

## Hard boundary

Personal Trajectory does not use population norms, diagnose progression, infer
cause, or recommend treatment. A change in a measurement is not a change in
disease state unless an independently validated protocol pack permits that
interpretation.
