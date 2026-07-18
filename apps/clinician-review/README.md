# Clinician review surface

The active review surface is implemented inside
`apps/capture-web/src/main.ts` to preserve Neurotrax's continuous one-screen
demo.

It renders:

- at most two compatible personal-trajectory claims;
- visible `SYNTHETIC` labels and exact exclusion reasons;
- the required GPT-5.6 Evidence Card;
- a claim trace through aggregate, measurement window, quality/confounds, and
  workflow events; and
- human Accept or Reject.

Accept adds the current structured observation to page-session history. Reject
does not. Neither action persists across reload, writes an EHR, or makes a
clinical determination.

No retained clips are part of this MVP.
