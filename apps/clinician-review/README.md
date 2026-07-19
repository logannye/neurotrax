# Clinician review surface

The active review surface is implemented inside
`apps/capture-web/src/main.ts` to preserve PhenoMetric's continuous one-screen
demo.

It renders:

- a quantitative current-encounter profile;
- two selected, precomputed face and voice outcomes;
- a bounded GPT-5.6 narrative when synthesis is available;
- a claim trace through aggregate, measurement window, quality/confounds, and
  workflow events; and
- human approval or dismissal.

Approval establishes a visible Visit 1 baseline concept. It does not persist
the observation or connect the internal trajectory package. Neither decision
persists across reload, writes an EHR, or makes a clinical determination.

No retained clips are part of this MVP.
