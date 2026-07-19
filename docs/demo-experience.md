# Live demonstration experience

## Presenter sequence

| Moment | Presenter action | Visible system behavior |
| --- | --- | --- |
| System check | Consent, remain quiet, then speak naturally. | A five-second check classifies each signal as strong, limited, or unavailable, then enables the assessment. |
| Signals established | Begin and keep speaking while centered. | Speech and facial windows open independently. |
| Quality withheld | Turn away while continuing to speak. | Facial Analysis turns amber; Speech Analysis remains active. |
| Signal restored | Return to the calibrated position. | Facial Analysis returns to teal and opens a second window. |
| Summary | Continue briefly after returning to center. | Capture closes automatically at fourteen seconds and creates one honest outcome per modality. |
| Reveal | No additional presenter action is required. | The results workspace opens automatically with grounded metrics; the EHR-ready narrative fills in as soon as it is ready. |
| Review | Inspect a trace, copy the report if desired, and approve or dismiss. | Human review closes the workflow; approval establishes Visit 1 with empty future-visit placeholders. |

## Visual hierarchy

- The camera is the dominant surface during capture.
- Four milestones make the demonstration sequence legible at a glance.
- A live orchestration graph shows the coordinator, parallel measurement
  agents, synthesis, and review.
- Only four concise agent decisions remain visible.
- Results contain exactly two measured-or-withheld modality outcomes and the
  clinician encounter summary.
- Detailed provenance appears only when a statement is selected.

## Failure behavior

- Only missing consent or denied camera/microphone access can block the flow.
- Calibration quality is preserved as strong, limited, or unavailable.
- Every phase advances on time; missed targets are recorded as not confirmed.
- A synthesis failure preserves deterministic grounded outcomes for human
  review and offers a narrative retry.
- The system never falls back to test-derived measurements during a live run.
