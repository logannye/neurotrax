# Clinician Evidence Card Agent

> **Ambient input update pending.** The evidence-card boundary remains current,
> but its source model must be re-keyed from scripted tasks to ambient windows,
> measurements, confounds, abstentions, and any governed evidence snippets.

## Goal

Turn one encounter and its personal comparison into an inspectable review card.

## Agentic behavior

- summarize successful and failed observations;
- link every statement to quality, context, or a source clip;
- present uncertainty and warnings;
- draft concise review language.
- reject unsupported generated claims before clinician review.

## Demo-visible receipt

The final card should show one provisional change, one stable observation, and
the capture or compatibility context needed to understand them. A clinician can
select a claim and trace it to its measurement, timestamped source clip, and
originating agent event.

The agent may draft and ground the card. Only the clinician may accept or reject
it and optionally annotate the decision.

## Hard boundary

This agent cannot sign, diagnose, order, prescribe, alert a patient, or execute
an action.
