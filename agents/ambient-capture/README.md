# Ambient Capture

## Goal

Create one consented, versioned audiovisual observation from technically
measurable moments in a routine encounter. A protocol may use natural
conversation, brief prompted microtasks, or both.

## Agentic behavior

- ingest coordinate/media-free `VoiceSignalFrameV1` and versioned
  facial-kinematics primitives
  incrementally;
- apply a versioned protocol and capture context without interpreting disease;
- open and close independent modality windows;
- route eligible windows to versioned deterministic extractors;
- publish quality transitions and reason-coded abstentions;
- reconcile results into one `EncounterObservation`; and
- release raw device access at encounter end.

The hero behavior is modality and task independence: the face lane withholds
during a turn-away while the speech lane continues, then facial quality
recovers for neutral-face, smile, and eye-closure tasks. Failure of one task
resets that task's live evidence streak; a guided assessment advances only when
the task criterion is satisfied. Final extraction receives only the last
qualifying interval, preventing failed attempts from contaminating the neutral
reference or facial measurements.

Voice Foundation is a separate microphone-only route within this same
capability. It accepts only final qualifying intervals for two sustained
vowels, standardized reading, rapid syllables, and spontaneous response. It
routes task-specific voice measurements and abstentions without starting the
facial lane. Cross-modal synchronization and fusion are not responsibilities
of this milestone.

Prompted tasks remain inside Ambient Capture. They do not bypass quality gates,
make a modality mandatory at the platform level, or create clinical meaning.

## Hard boundary

Ambient Capture does not interpret conversation content, diagnose, compare
history, generate narrative conclusions, or recommend action.

Native MediaPipe landmarks, blendshapes, transformation matrices, and video
frames do not cross the browser-worker boundary. The live full-face mesh is
drawn on a worker-owned canvas and is presentation-only. Only compact derived
geometry, quality, timing, and processor provenance may enter the coordinator.

PCM, waveform and spectral arrays, pitch cycles, cepstra, MFCCs, formant
tracks, spectrograms, transcripts, WavLM embeddings, voiceprints, and
microphone identifiers also remain outside coordinator contracts. Optional
WavLM results contribute processor provenance only.
