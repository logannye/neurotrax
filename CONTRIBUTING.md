# Contributing

Thank you for contributing to Neuro Encounter.

## Before opening a change

1. Read the [architecture](docs/architecture.md) and
   [safety requirements](docs/safety.md).
2. State the intended use of the change.
3. Identify which of the three product capabilities it strengthens.
4. Document expected failures, quality requirements, and validation status.
5. Use synthetic data only.

## Pull requests

Every pull request should explain:

- the user or workflow problem;
- the affected system boundary;
- the data consumed and emitted;
- consent and retention implications;
- new clinical or safety claims, if any;
- how the change was checked.

If a change does not improve Guided Capture, Personal Trajectory, Clinician
Evidence Card, or a required safety foundation, leave it out of the MVP.

Changes introducing a consequential clinical decision must include a human
review gate and may not execute the decision automatically.

## Checks

```bash
npm run check
```

Implementation-specific test and lint commands will be added with each runnable
workspace.
