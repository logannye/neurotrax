# Personal Trajectory

## Goal

Compare each current biomarker only with accepted, compatible observations from
the same synthetic person.

## Agentic behavior

- match participant, measurement code, detected context, and algorithm version;
- enforce SNR, face-framing, frame-rate, and illumination tolerances;
- include or exclude prior data with exact reason codes;
- compute median, range, median absolute deviation, and current delta; and
- emit a nonclinical direction.

The checked-in fixture contains three compatible accepted visits and one
algorithm-version exclusion. Every seeded point remains visibly `SYNTHETIC`.

## Hard boundary

Personal Trajectory does not use population norms, diagnose progression, infer
cause, or recommend treatment.
