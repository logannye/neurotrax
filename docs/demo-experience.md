# Neurotrax demo experience

## One screen, three acts

The live camera occupies roughly two-thirds of the screen and the event-driven
agent rail occupies the remainder. At encounter end, the capture region
contracts and the same page reveals personal trajectory and the final Evidence
Card. There is no agent chat and no hidden reasoning.

## Recommended 90-second presentation

| Time | Presenter | Visible system behavior |
| --- | --- | --- |
| 0:00–0:10 | Explain the non-PHI self-demo and consent. | Startup verifies local face inference and server-side GPT-5.6 readiness. |
| 0:10–0:30 | Begin, face the camera, and speak naturally. | Speech and face lanes independently turn teal; real events open windows. |
| 0:30–0:34 | Continue speaking while turning away. | Face becomes amber `Withheld`; speech stays teal. |
| 0:34–0:40 | Face the camera again and continue. | Face recovers after stable framing; abstention is preserved. |
| 0:40–0:50 | End the encounter. | Media tracks release; the observation and compatible history appear. |
| 0:50–1:05 | Point to three synthetic inclusions and one dimmed exclusion. | Exact algorithm-version rule is visible; at most two trajectories appear. |
| 1:05–1:20 | Let the Evidence Agent assemble the card. | Real request, response, grounding, and pending-review events appear. |
| 1:20–1:30 | Open a claim trace and Accept or Reject. | Claim provenance opens; the page-session history outcome is explicit. |

## Visual semantics

- Teal: active, measurable, grounded, or complete.
- Amber: modality-specific technical-quality withholding or transparent model
  failure.
- Muted gray: synthetic encounter excluded by a deterministic rule.
- `LIVE`: genuine camera and microphone capture.
- `FIXTURE PLAYBACK · NOT LIVE`: disclosed deterministic browser fixture.

The application never uses red as a biomarker direction and never animates
tokens, brains, risk scores, or agents talking to one another.

## Hero behavior

The presenter is never coached or interrupted. The product demonstrates
agency through bounded, observable decisions:

```text
face signal acceptable
  -> open measurable face window
presenter turns away while continuing to speak
  -> close only face window
  -> publish face-quality withholding event
  -> preserve no-value abstention
speech remains usable
  -> speech window continues
presenter returns
  -> verify 750 ms stable framing
  -> reopen face measurement
```

## Failure behavior

- Missing key: startup remains blocked before device access.
- Camera/microphone denial: clear permission error and no downstream result.
- Face model failure: facial readiness blocks the live demo.
- No compatible comparison: no unsupported trajectory claim is created.
- Model/API/refusal/schema/grounding failure: show `Retry evidence synthesis`;
  no fallback prose appears.
- Fixture use: the fixture label remains persistent and no hardware access is
  requested.

## Claim trace

Selecting a claim opens:

```text
claim
  -> precomputed comparison fact
  -> current aggregate
  -> per-window measurements and time ranges
  -> quality and median confounds
  -> compatible synthetic reference measurements
  -> versioned workflow events
```

No retained clip is necessary for this MVP. Timestamped derived windows provide
traceability without creating a raw-media retention path.
