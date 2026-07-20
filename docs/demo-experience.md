# Live demonstration experience

Choose a protocol before consent. Facial Foundation requests camera and
microphone; Voice Foundation is microphone-only.

## Facial Foundation presenter sequence

| Moment | Presenter action | Visible system behavior |
| --- | --- | --- |
| System check | Consent, remain quiet, then speak naturally. | PhenoMetric prepares speech and facial analysis, then enables the assessment. |
| Signals established | Begin and keep speaking while centered. | Speech and facial windows open independently. |
| Facial branch paused | Turn away while continuing to speak. | Facial Analysis turns amber; Speech Analysis remains active. |
| Neutral baseline | Return to center, stop speaking, and hold a quiet neutral reference. | Facial Analysis reconnects and collects a task-specific reference without claiming to detect relaxation. |
| Smile | Smile comfortably and hold. | Left and right mouth-corner excursion are measured only from usable frames. |
| Eye closure | Gently close the eyes, hold briefly, then reopen. | The same-eye close-then-reopen sequence is confirmed before left and right closure fractions are measured independently. |
| Summary | No additional action is required. | The Coordinator completes capture and routes measured metrics to Clinical Synthesis. |
| Reveal | No additional presenter action is required. | The results workspace opens automatically with grounded metrics; the EHR-ready narrative fills in as soon as it is ready. |
| Review | Inspect a trace, copy the report if desired, and approve or dismiss. | Human review closes the workflow; approval establishes Visit 1 with empty future-visit placeholders. |

## Visual hierarchy

- The camera is the dominant surface during capture.
- Five completion-gated phases make the demonstration sequence legible at a
  glance; progress reflects the current signal criterion, not the session
  clock.
- A live 478-point mesh makes the visual sensing surface inspectable while
  remaining explicitly labeled as display-only and not stored.
- A live orchestration graph shows the coordinator, parallel measurement
  agents, synthesis, and review.
- Only the newest three concise agent decisions remain visible.
- Capture transitions into a dedicated clinician summary workspace rather than
  leaving the video interface partially visible.
- An event-backed handoff shows Signals analyzed → Evidence grounding →
  Clinician review.
- A six-measurement facial profile sits beside and inside the clinician note.
- Detailed provenance appears only when a primary statement or quantitative
  profile item is selected.

## Voice Foundation presenter sequence

| Moment | Presenter action | Visible system behavior |
| --- | --- | --- |
| System check | Remain quiet for two seconds, then speak naturally. | PhenoMetric calibrates room noise, confirms continuous voice quality, and keeps the camera off. |
| Vowel 1 | Sustain a comfortable `/a/` for three seconds. | Progress reflects continuous voicing and reliable periodicity. |
| Vowel 2 | Repeat the same task. | A second accepted trial supports between-trial uncertainty. |
| Reading | Read the displayed nonclinical sentence. | Four seconds of usable voiced evidence are accepted without claiming reading accuracy. |
| Rapid syllables | Repeat `/pa-ta-ka/`. | Progress requires four seconds plus six estimated envelope nuclei. |
| Spontaneous response | Describe a familiar routine. | Eight seconds of usable evidence are collected while brief natural pauses remain allowed. |
| Summary | Review the voice profile. | A single primary voice outcome is grounded; task-specific measurements and abstentions remain inspectable. |

Live engineering feedback shows microphone level, pitch coverage, SNR, quality,
and criterion progress. It is display-only. The optional WavLM path is not
required for completion and does not expose embeddings in the report.

## Presentation behavior

- Every guided exercise must be recognized before the next begins. There is no
  timeout, automatic skip, or elapsed-time advancement.
- Technical acquisition classifications remain in operator diagnostics.
- A quality break resets only the current continuous evidence streak. Facial
  mode also resets on a visual-result gap over 200 ms; voice mode resets on an
  audio block gap over 40 ms. The
  presenter retries by repeating the action, and criterion-specific guidance
  appears after twelve seconds without completion.
- **End assessment** remains available throughout capture. Confirming it
  releases media immediately, discards the session, and creates no report.
- Only the final qualifying interval for each task contributes to the report;
  failed attempts cannot contaminate the neutral reference or task metrics.
- Facial task outcomes are descriptive engineering measurements, not clinical
  scores or interpretations.
- Measured metrics remain available for clinician review while the narrative
  refreshes.
- Live runs never substitute development data for captured measurements.
