# Guided Capture Agent

## Goal

Produce one consented, correctly labeled, technically usable audiovisual
observation from the MacBook camera and microphone.

## Agentic behavior

- coach framing and microphone setup;
- decide pass, bounded retry, or fail from explicit rules;
- guide the approved task;
- pause a task when evidence is not measurable;
- verify whether a requested correction recovered quality;
- attach complete provenance.

## Demo-visible receipt

The interface projects actual events as `observed → acted → verified`. A useful
demo branch is:

```text
hand visibility failed
  → reposition requested
  → hand visibility recovered
```

The receipt is not chain-of-thought. Each line must resolve to a versioned event
and processor result.

## Hard boundary

This agent never interprets disease, history, or treatment.
