# Safety foundations

## Demonstration boundary

Neurotrax is an engineering and hackathon demonstration, not a medical device.
Use only the presenter's explicitly consented self-demo data. Do not use PHI or
make clinical decisions from its output.

## Required behavior

- Consent is required before device access or analysis.
- A test capture can never silently replace a live-device encounter.
- Camera and microphone tracks stop when the encounter ends or the page exits.
- Raw frames and samples are processed ephemerally; no recording path exists.
- Each modality applies its own quality contract and can abstain independently.
- An unusable interval yields no measurement value.
- Measurements, summary generation, grounding, and human disposition remain
  separate steps.
- Every visible agent action derives from a versioned workflow event.
- Every narrative claim resolves to a precomputed current-encounter fact,
  aggregate, measurement window, quality/confound envelope, and originating
  events.

## Model boundary

The Evidence Agent receives bounded structured non-PHI facts only. It never
receives microphone samples, camera frames, landmarks, screenshots,
transcripts, or conversation content.

The model cannot create measurements or select evidence facts. A deterministic
validator blocks unsupported or clinical language. Failure is shown openly and
must be retried; the application does not replace it with apparently
successful canned prose.

`OPENAI_API_KEY` is server-side only. It must never use a `VITE_` prefix or be
committed.

## Forbidden MVP behavior

- diagnosis, disease classification, or progression inference;
- treatment, medication, or clinical recommendations;
- emergency, fall, swallowing, or respiratory-risk prediction;
- emotion, truthfulness, intent, capacity, or cognition inference;
- interpretation of conversation content;
- patient alerts or autonomous communication;
- EHR writes or other consequential actions;
- PHI, patient data, or real clinical use;
- raw-media recording, screenshots, transcripts, or retained clips;
- hidden fixture substitution;
- fabricated agent activity, progress, confidence, or reasoning.

## Deployment deferrals

Before research or production use, complete technical verification, analytical
repeatability, clinical validation for an intended population, privacy and
security review, consent design, threat modeling, model governance, regulatory
analysis, and institutional review as applicable.
