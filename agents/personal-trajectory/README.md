# Personal Trajectory Agent

> **Ambient re-key pending.** The capability boundary remains current, but
> prompt/task compatibility below must be replaced by detected measurement
> context, confound tolerance, and algorithm-version compatibility.

## Goal

Compare the current usable observation with compatible observations from the
same person.

## Agentic behavior

- choose the comparison set using explicit compatibility rules;
- exclude failed or incompatible observations;
- estimate provisional change and uncertainty;
- surface context differences and modality disagreement.

## Demo-visible receipt

The demo uses clearly labeled synthetic history so selection is deterministic.
The agent should visibly report:

```text
4 prior encounters found
  → 3 compatible encounters included
  → 1 excluded because its prompt version differs
```

The current encounter remains genuinely live. The agent reports compatibility,
not diagnosis or population-normal status.

## Hard boundary

This agent does not diagnose progression or infer why a change occurred.
