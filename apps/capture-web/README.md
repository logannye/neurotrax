# Capture web application

The web application owns the consented system check, guided audiovisual
assessment, clinician encounter summary, grounding trace, and human review.

## Runtime responsibilities

- Requests and releases camera and microphone access.
- Calibrates room noise, speech thresholds, face geometry, and illumination.
- Runs facial inference in an isolated browser thread.
- Streams only derived primitives into the encounter coordinator.
- Enforces the guided withholding-and-recovery milestones.
- Sends bounded current-encounter facts to the server-side synthesis endpoint.
- Displays only deterministically grounded statements.

## Commands

```bash
pnpm dev
pnpm test:unit
pnpm test:browser
pnpm typecheck
pnpm build
```

Credential configuration, the service smoke test, and operator-only capture
testing are documented in [`../../docs/operator-guide.md`](../../docs/operator-guide.md).
