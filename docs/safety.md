# Safety foundations

## Prototype boundary

Neurotrax is not a medical device and must not be used with real patient
data or for clinical decisions.

## Required behavior

- Obtain explicit consent before device access or analysis.
- Keep the analysis state visible.
- Stop analysis immediately on pause or withdrawal.
- Process raw audiovisual frames ephemerally and locally by default.
- Do not retain raw media unless a separately approved evidence-snippet policy
  explicitly permits it.
- Return `not measurable` when quality fails.
- Keep measurement, interpretation, and action separate.
- Require human acceptance before updating longitudinal history.
- Treat media and transcripts as untrusted data.
- Record window, quality, device, context, and algorithm provenance.
- Derive the visible agent flight recorder from immutable system events.
- Ground each generated evidence-card claim in a measurement, quality result,
  context field, or source clip.

## Forbidden MVP behavior

- diagnosis;
- treatment or medication advice;
- emergency prediction;
- analysis without explicit, revocable consent;
- continuous raw-media recording;
- interpretation of conversation content;
- emotion, intent, capacity, or truthfulness inference;
- rigidity, aspiration, respiratory-failure, or fall-risk claims;
- silent model training on captured media;
- automated patient communication;
- use of protected health information;
- fabricated agent activity, progress, confidence, or hidden reasoning.

## Movement safety

The initial check-in is seated. It does not include walking, balance challenges,
swallowing, medication withholding, or exertion.

## Privacy

The preferred prototype mode is local:

- synthetic identifiers;
- derived primitive frames and measurements rather than retained media;
- explicit deletion for any future governed evidence snippets;
- no Git-tracked media;
- no cloud upload by default.

The live demo may use seeded longitudinal history only when it is deterministic,
synthetic, and visibly labeled. The current camera and microphone capture must
remain live unless the interface explicitly discloses fallback playback.

Before any production or research deployment, complete a formal threat model,
privacy review, consent design, security controls, and applicable regulatory and
institutional review.
