# Safety foundations

## Prototype boundary

Neuro Encounter is not a medical device and must not be used with real patient
data or for clinical decisions.

## Required behavior

- Obtain explicit consent before device access or capture.
- Keep recording state visible.
- Stop capture immediately on pause or withdrawal.
- Capture only the approved short task.
- Minimize raw-media retention.
- Return `not measurable` when quality fails.
- Keep measurement, interpretation, and action separate.
- Require human acceptance before updating longitudinal history.
- Treat media and transcripts as untrusted data.
- Record task, quality, device, context, and algorithm provenance.

## Forbidden MVP behavior

- diagnosis;
- treatment or medication advice;
- emergency prediction;
- continuous listening;
- emotion, intent, capacity, or truthfulness inference;
- rigidity, aspiration, respiratory-failure, or fall-risk claims;
- silent model training on captured media;
- automated patient communication;
- use of protected health information.

## Movement safety

The initial check-in is seated. It does not include walking, balance challenges,
swallowing, medication withholding, or exertion.

## Privacy

The preferred prototype mode is local:

- synthetic identifiers;
- local media references;
- explicit deletion;
- no Git-tracked media;
- no cloud upload by default.

Before any production or research deployment, complete a formal threat model,
privacy review, consent design, security controls, and applicable regulatory and
institutional review.
