# Live demonstration experience

## Presenter sequence

| Moment | Presenter action | Visible system behavior |
| --- | --- | --- |
| System check | Consent, remain quiet, then speak naturally. | Neurotrax prepares speech and facial analysis, then enables the assessment. |
| Signals established | Begin and keep speaking while centered. | Speech and facial windows open independently. |
| Facial branch paused | Turn away while continuing to speak. | Facial Analysis turns amber; Speech Analysis remains active. |
| Signal restored | Return to a centered position. | Facial Analysis reconnects and opens a new measurement window. |
| Summary | Continue briefly after returning to center. | The Coordinator completes capture and routes measured metrics to Clinical Synthesis. |
| Reveal | No additional presenter action is required. | The results workspace opens automatically with grounded metrics; the EHR-ready narrative fills in as soon as it is ready. |
| Review | Inspect a trace, copy the report if desired, and approve or dismiss. | Human review closes the workflow; approval establishes Visit 1 with empty future-visit placeholders. |

## Visual hierarchy

- The camera is the dominant surface during capture.
- Four milestones make the demonstration sequence legible at a glance.
- A live orchestration graph shows the coordinator, parallel measurement
  agents, synthesis, and review.
- Only the newest three concise agent decisions remain visible.
- Capture transitions into a dedicated clinician summary workspace rather than
  leaving the video interface partially visible.
- An event-backed handoff shows Signals analyzed → Evidence grounding →
  Clinician review.
- A ten-feature digital biomarker profile sits beside and inside the clinician
  note so the complete deliverable is understandable at a glance.
- Detailed provenance appears only when a primary statement or quantitative
  profile item is selected.

## Presentation behavior

- Only missing consent or denied camera/microphone access can block the flow.
- Technical acquisition classifications remain in operator diagnostics.
- The Encounter Coordinator keeps each assessment moving without asking the
  presenter to repeat a step.
- Measured metrics remain available for clinician review while the narrative
  refreshes.
- Live runs never substitute development data for captured measurements.
