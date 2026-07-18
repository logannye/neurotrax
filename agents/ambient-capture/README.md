# Ambient Capture

## Goal

Create one consented, versioned audiovisual observation from technically
measurable moments in a routine encounter without prompting or interrupting
the participant.

## Agentic behavior

- ingest derived audio and face primitives incrementally;
- open and close independent modality windows;
- route eligible windows to versioned deterministic extractors;
- publish quality transitions and reason-coded abstentions;
- reconcile results into one `EncounterObservation`; and
- release raw device access at encounter end.

The hero behavior is modality independence: the face lane withholds during a
turn-away while the speech lane continues, then face measurement recovers.

## Hard boundary

Ambient Capture does not interpret conversation content, diagnose, compare
history, generate narrative conclusions, or recommend action.
