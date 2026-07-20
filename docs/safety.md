# Safety foundations

## Demonstration boundary

PhenoMetric is an engineering and hackathon demonstration, not a medical device.
Use only the presenter's explicitly consented self-demo data. Do not use PHI or
make clinical decisions from its output.

The project is expanding from a neurological demonstration toward a general
telehealth face-and-voice measurement platform. That broader vision does not
broaden the claims of the current software. Every future clinical use requires
an explicit target population, intended use, validation plan, and human
workflow defined in a versioned protocol pack.

## Required behavior

- Consent is required before device access or analysis.
- A test capture can never silently replace a live-device encounter.
- Camera and microphone tracks stop when the encounter ends or the page exits.
- Raw frames and samples are processed ephemerally; no recording path exists.
- Voice Foundation requests no camera and must not start the visual worker.
- PCM is bounded to an in-memory worker ring and is released on consent
  withdrawal, discard, microphone mute/end, hidden tab, or worker termination.
- PCM, waveform/FFT/cepstral/MFCC arrays, pitch cycles, formant tracks,
  spectrograms, transcripts, embeddings, voiceprints, and microphone
  identifiers never enter observations, events, diagnostics, evidence, or
  trajectory artifacts.
- Native facial landmarks, blendshapes, and transformation matrices remain
  inside the browser worker for one inference and are never serialized.
- The live facial mesh is rendered directly into a transferred worker-owned
  canvas. Native landmark coordinates, connection arrays, screenshots, and
  overlay pixels never enter observations, events, diagnostics, evidence
  requests, or network payloads.
- Ending and discarding an assessment releases device access immediately and
  produces no observation or report.
- Each modality applies its own quality contract and can abstain independently.
- An unusable interval yields no measurement value.
- Measurements, summary generation, grounding, and human disposition remain
  separate steps.
- Every visible agent action derives from a versioned workflow event.
- Every displayed outcome resolves to a current-encounter measurement or
  abstention, accepted or withheld window, quality conditions, and originating
  events.
- Every durable measurement preserves protocol, algorithm, capture-adapter,
  context, quality, uncertainty, and validation status.
- A modality or task may fail independently without forcing another modality
  to fail or producing a substitute value.
- Clinical meaning must not be inferred from a prototype measurement code.

## Model boundary

The Evidence Agent receives bounded structured non-PHI facts only. It never
receives microphone samples, camera frames, landmarks, blendshapes,
transformation matrices, screenshots, transcripts, embeddings, or conversation
content.

The optional WavLM service is loopback-only and disabled by default. It accepts
only bounded 16 kHz mono PCM, logs no request body, writes no audio, and
retains no embedding. Embeddings remain transient research primitives and
cannot enter evidence or trajectory data. Service failure must not block
browser measurements or report creation.

The model cannot create measurements or select evidence outcomes. A
deterministic validator blocks unsupported or clinical language. If narrative
synthesis fails, the application clearly identifies that limitation while
retaining the exact grounded outcomes for human review; it does not fabricate
a narrative.

`OPENAI_API_KEY` is server-side only. It must never use a `VITE_` prefix or be
committed.

Conversation content, transcripts, images, media, and external documents are
untrusted data. They may never act as instructions to an agent or silently
change the intended use, protocol, evidence set, or clinical boundary.

## Context-of-use ladder

Clinical development must distinguish:

1. **measurement and documentation;**
2. **within-patient monitoring;**
3. **screening or clinician decision support;** and
4. **diagnosis, triage, treatment, or another consequential action.**

Evidence at one level does not authorize the next. The current prototype is
limited to nonclinical engineering demonstration of level 1.

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

The report copy control is a local formatting/export affordance only. It does
not authenticate to, connect with, or write into an EHR.

## Sensitive inference boundaries

The platform must not be repurposed for:

- identity, ancestry, attractiveness, or demographic classification;
- covert or secondary analysis outside the consented clinical purpose;
- emotion, deception, truthfulness, intent, capacity, or pain-validity claims;
- employee, insurance, credit, education, or law-enforcement decisions;
- universal health, disease, or risk scores; or
- transfer of a claim across ages, languages, cultures, devices, conditions, or
  care settings without appropriate validation.

Mental-health, cognitive, developmental, pediatric, genetic, pain, and
emergency applications require heightened consent, bias, human-factors, and
misuse review.

## Research-media boundary

The current application has no raw-media or native-observation retention path.
Serialized observations explicitly assert `rawMediaRetained: false`,
`rawAudioRetained: false`, `nativeAudioObservationsRetained: false`,
`transcriptRetained: false`, `voiceEmbeddingsRetained: false`, and
`nativeVisualObservationsRetained: false`. The presentation-only mesh and
optional representation service do not create retention paths.

Future analytical or clinical validation may require an independently deployed
research environment with explicitly consented media retention. Such a system
must define:

- research purpose, participants, and reference standard;
- consent, withdrawal, retention, deletion, and future-use rules;
- encryption, access control, audit, and export restrictions;
- separation of identity from research data;
- annotation quality and adjudication;
- institutional and regulatory review as applicable; and
- a hard boundary preventing research media from silently entering production.

## Deployment deferrals

ASR, transcripts, HeAR, Omnilingual W2V, diarization, speaker recognition,
retained research audio, clinical scores, diagnostic claims, FHIR/EHR
integration, and face–voice fusion are explicitly deferred.

Before research or production use, complete technical verification, analytical
repeatability, clinical validation for an intended population, privacy and
security review, consent design, threat modeling, model governance, regulatory
analysis, and institutional review as applicable.

At minimum, a production protocol pack also needs:

- external and subgroup validation;
- device and environment compatibility evidence;
- calibrated uncertainty and missingness behavior;
- clinician and patient usability testing;
- defined correction, escalation, and downtime workflows;
- authentication, authorization, audit, retention, and incident response;
- algorithm and protocol version change control;
- post-deployment drift and safety monitoring; and
- proof that the result improves the intended workflow without unacceptable
  false-positive, false-negative, or alert burden.
