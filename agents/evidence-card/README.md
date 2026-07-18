# Clinician Evidence Card

## Goal

Draft one concise, inspectable review artifact from structured non-PHI
observation and comparison facts.

## Agentic behavior

- call required `gpt-5.6` through the server-side Responses API;
- require Structured Output with at most two precomputed claim IDs;
- deterministically validate each returned claim and its provenance;
- retry one grounding failure with explicit errors;
- expose model, refusal, schema, timeout, or grounding failure without fallback;
- publish pending-review state; and
- record the human Accept or Reject decision.

The model cannot create measurements, change the comparison set, or write
history. Only human acceptance updates the current page session.

## Hard boundary

The Evidence Agent cannot diagnose, classify progression, infer cause, propose
treatment, sign, order, prescribe, message a patient, or execute an action.
