# Live demonstration experience

## Presenter sequence

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
- An eleven-measurement encounter profile sits beside and inside the clinician
  note so the complete deliverable is understandable at a glance.
- Detailed provenance appears only when a primary statement or quantitative
  profile item is selected.

## Presentation behavior

- Every guided exercise must be recognized before the next begins. There is no
  timeout, automatic skip, or elapsed-time advancement.
- Technical acquisition classifications remain in operator diagnostics.
- A quality break or visual-result gap over 200 ms resets only the current
  continuous evidence streak. The
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
