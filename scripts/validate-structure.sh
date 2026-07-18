#!/usr/bin/env bash

set -euo pipefail

required_files=(
  "README.md"
  "AGENTS.md"
  "SECURITY.md"
  "docs/architecture.md"
  "docs/demo-experience.md"
  "docs/safety.md"
  "docs/validation.md"
  "apps/capture-web/README.md"
  "apps/clinician-review/README.md"
  "agents/guided-capture/README.md"
  "agents/personal-trajectory/README.md"
  "agents/evidence-card/README.md"
  "packages/contracts/README.md"
  "packages/event-log/README.md"
  "protocols/macbook-check-in.v0.1.json"
  "examples/prior-encounter-observation.example.json"
  "examples/encounter-observation.example.json"
  "examples/trajectory-comparison.example.json"
  "examples/evidence-card.example.json"
  "examples/demo-patient-history.example.json"
  "examples/encounter-events.example.jsonl"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

node <<'NODE'
  const fs = require("node:fs");

  const jsonFiles = [
    "package.json",
    "protocols/macbook-check-in.v0.1.json",
    "examples/prior-encounter-observation.example.json",
    "examples/encounter-observation.example.json",
    "examples/trajectory-comparison.example.json",
    "examples/evidence-card.example.json",
    "examples/demo-patient-history.example.json"
  ];

  for (const file of jsonFiles) {
    JSON.parse(fs.readFileSync(file, "utf8"));
  }

  const eventFile = "examples/encounter-events.example.jsonl";
  const lines = fs
    .readFileSync(eventFile, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const events = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${eventFile}:${index + 1}: ${error.message}`);
    }
  });

  if (events.length === 0) {
    throw new Error("Encounter event example must contain at least one event.");
  }

  const knownActors = new Map([
    ["capture-web", "application"],
    ["guided-capture", "agent"],
    ["personal-trajectory", "agent"],
    ["evidence-card", "agent"],
    ["clinician-review", "human-interface"]
  ]);
  const expectedAgents = new Set([
    "guided-capture",
    "personal-trajectory",
    "evidence-card"
  ]);
  const observedAgents = new Set();
  const eventIds = new Set();
  const knownStages = new Set([
    "guided-capture",
    "personal-trajectory",
    "evidence-card",
    "human-review"
  ]);
  const knownEventTypes = new Set([
    "consent.recorded",
    "device.preflight.passed",
    "task.capture.started",
    "task.capture.completed",
    "capture.quality.failed",
    "agent.action.requested",
    "action.outcome.verified",
    "task.capture.resumed",
    "encounter-observation.created",
    "trajectory.compatibility.assessed",
    "trajectory.comparison.completed",
    "evidence-card.drafted",
    "evidence-claim.grounded",
    "evidence-claim.rejected",
    "human-review.pending",
    "evidence.trace.opened",
    "human-review.accepted",
    "human-review.rejected"
  ]);
  const requiredEnvelopeFields = [
    "schemaVersion",
    "eventId",
    "sequence",
    "occurredAt",
    "encounterId",
    "participantId",
    "actor",
    "type",
    "stage",
    "correlationId",
    "summary",
    "payload",
    "evidenceRefs"
  ];
  let previousTimestamp = -Infinity;

  for (const [index, event] of events.entries()) {
    for (const field of requiredEnvelopeFields) {
      if (!(field in event)) {
        throw new Error(`Event ${index + 1} is missing envelope field: ${field}`);
      }
    }
    const expectedSequence = index + 1;
    if (event.sequence !== expectedSequence) {
      throw new Error(
        `Expected event sequence ${expectedSequence}; found ${event.sequence}.`
      );
    }
    if (eventIds.has(event.eventId)) {
      throw new Error(`Duplicate eventId: ${event.eventId}`);
    }
    eventIds.add(event.eventId);

    const actorKind = knownActors.get(event.actor?.id);
    if (!actorKind || actorKind !== event.actor?.kind) {
      throw new Error(
        `Unknown actor or actor kind: ${JSON.stringify(event.actor)}`
      );
    }
    if (event.actor.kind === "agent") {
      observedAgents.add(event.actor.id);
    }
    if (!knownStages.has(event.stage)) {
      throw new Error(`Unknown event stage: ${event.stage}`);
    }
    if (!knownEventTypes.has(event.type)) {
      throw new Error(`Unknown event type: ${event.type}`);
    }
    if (
      event.causedByEventId &&
      !eventIds.has(event.causedByEventId)
    ) {
      throw new Error(
        `Event ${event.eventId} must reference an earlier causal event.`
      );
    }

    const timestamp = Date.parse(event.occurredAt);
    if (!Number.isFinite(timestamp) || timestamp < previousTimestamp) {
      throw new Error(
        `Invalid or decreasing occurredAt on event ${event.eventId}.`
      );
    }
    previousTimestamp = timestamp;
  }

  for (const agentId of expectedAgents) {
    if (!observedAgents.has(agentId)) {
      throw new Error(`Missing events from agent: ${agentId}`);
    }
  }

  const requiredLifecycle = [
    "consent.recorded",
    "device.preflight.passed",
    "task.capture.started",
    "capture.quality.failed",
    "agent.action.requested",
    "action.outcome.verified",
    "task.capture.resumed",
    "task.capture.completed",
    "encounter-observation.created",
    "trajectory.compatibility.assessed",
    "trajectory.comparison.completed",
    "evidence-card.drafted",
    "evidence-claim.grounded",
    "human-review.pending",
    "evidence.trace.opened"
  ];
  let lifecycleCursor = -1;
  for (const eventType of requiredLifecycle) {
    lifecycleCursor = events.findIndex(
      (event, index) => index > lifecycleCursor && event.type === eventType
    );
    if (lifecycleCursor === -1) {
      throw new Error(`Missing or misordered event type: ${eventType}`);
    }
  }

  const compatibilityEvent = events.find(
    (event) => event.type === "trajectory.compatibility.assessed"
  );
  if (
    compatibilityEvent.payload?.includedEncounterIds?.length !== 3 ||
    compatibilityEvent.payload?.excludedEncounters?.length !== 1
  ) {
    throw new Error(
      "Compatibility event must include 3 encounters and exclude 1 encounter."
    );
  }

  const correctionEvent = events.find(
    (event) => event.type === "agent.action.requested"
  );
  const captureQualityEvent = events.find(
    (event) => event.type === "capture.quality.failed"
  );
  const recoveryEvent = events.find(
    (event) => event.type === "action.outcome.verified"
  );
  if (
    correctionEvent.payload?.attempt !== 1 ||
    correctionEvent.payload?.retryPolicy?.maxAttempts !== 1
  ) {
    throw new Error("Guided-capture correction must be bounded to one attempt.");
  }
  if (
    !captureQualityEvent.payload?.processor?.id ||
    !captureQualityEvent.payload?.processor?.version ||
    !captureQualityEvent.payload?.rule?.id ||
    !captureQualityEvent.payload?.rule?.version ||
    recoveryEvent.payload?.processor?.id !==
      captureQualityEvent.payload.processor.id ||
    recoveryEvent.payload?.processor?.version !==
      captureQualityEvent.payload.processor.version ||
    recoveryEvent.payload?.rule?.id !== captureQualityEvent.payload.rule.id ||
    recoveryEvent.payload?.rule?.version !==
      captureQualityEvent.payload.rule.version
  ) {
    throw new Error(
      "Quality failure and verified recovery must share versioned processor and rule provenance."
    );
  }

  const pendingReviewEvents = events.filter(
    (event) => event.type === "human-review.pending"
  );
  const reviewDispositionEvents = events.filter((event) =>
    ["human-review.accepted", "human-review.rejected"].includes(event.type)
  );
  if (
    pendingReviewEvents.length !== 1 ||
    reviewDispositionEvents.length !== 1 ||
    events.at(-1).eventId !== reviewDispositionEvents[0].eventId ||
    reviewDispositionEvents[0].causedByEventId !== pendingReviewEvents[0].eventId
  ) {
    throw new Error(
      "One pending human review must be followed by exactly one final disposition."
    );
  }
  const evidenceTraceEvents = events.filter(
    (event) => event.type === "evidence.trace.opened"
  );
  if (
    evidenceTraceEvents.length !== 1 ||
    evidenceTraceEvents[0].causedByEventId !== pendingReviewEvents[0].eventId
  ) {
    throw new Error(
      "The demo must record exactly one evidence trace opened after review becomes pending."
    );
  }

  const history = JSON.parse(
    fs.readFileSync("examples/demo-patient-history.example.json", "utf8")
  );
  const compatible = history.history.filter(
    (encounter) =>
      encounter.reviewStatus === "accepted" &&
      encounter.trajectoryEligibility?.status === "compatible"
  );
  const excluded = history.history.filter(
    (encounter) => encounter.trajectoryEligibility?.status === "excluded"
  );
  const everyEncounterIsSynthetic = history.history.every(
    (encounter) => encounter.synthetic === true
  );
  if (
    history.synthetic !== true ||
    history.captureMode !== "synthetic-fixture" ||
    history.containsPHI !== false ||
    history.participant?.synthetic !== true ||
    !everyEncounterIsSynthetic ||
    compatible.length !== 3 ||
    excluded.length !== 1 ||
    excluded[0].trajectoryEligibility.reasons?.[0]?.code !==
      "prompt-version-mismatch"
  ) {
    throw new Error(
      "Demo history must be synthetic with 3 accepted compatible encounters and 1 prompt-version exclusion."
    );
  }

  const includedHistoryIds = new Set(
    compatibilityEvent.payload.includedEncounterIds
  );
  const compatibleHistoryIds = new Set(
    compatible.map((encounter) => encounter.encounterId)
  );
  if (
    includedHistoryIds.size !== compatibleHistoryIds.size ||
    [...includedHistoryIds].some((id) => !compatibleHistoryIds.has(id)) ||
    compatibilityEvent.payload.excludedEncounters[0].encounterId !==
      excluded[0].encounterId
  ) {
    throw new Error(
      "Compatibility event selections must match the synthetic history fixture."
    );
  }

  const packageManifest = JSON.parse(
    fs.readFileSync("package.json", "utf8")
  );
  const protocol = JSON.parse(
    fs.readFileSync("protocols/macbook-check-in.v0.1.json", "utf8")
  );
  const priorObservation = JSON.parse(
    fs.readFileSync(
      "examples/prior-encounter-observation.example.json",
      "utf8"
    )
  );
  const currentObservation = JSON.parse(
    fs.readFileSync("examples/encounter-observation.example.json", "utf8")
  );
  const comparison = JSON.parse(
    fs.readFileSync("examples/trajectory-comparison.example.json", "utf8")
  );
  const card = JSON.parse(
    fs.readFileSync("examples/evidence-card.example.json", "utf8")
  );

  if (packageManifest.name !== "neurotrax") {
    throw new Error("The package name must be neurotrax.");
  }

  const consentEvent = events.find(
    (event) => event.type === "consent.recorded"
  );
  const allowedCurrentCaptureModes = new Set([
    "live",
    "cached-processor",
    "fixture-playback",
    "recorded-demo"
  ]);
  if (
    !allowedCurrentCaptureModes.has(consentEvent.payload?.captureMode) ||
    currentObservation.captureMode !== consentEvent.payload.captureMode ||
    comparison.currentCaptureMode !== currentObservation.captureMode ||
    card.currentCaptureMode !== currentObservation.captureMode ||
    comparison.historyMode !== history.captureMode ||
    card.historyMode !== history.captureMode ||
    priorObservation.captureMode !== history.captureMode
  ) {
    throw new Error(
      "Capture and history modes must be explicit and consistent across the event stream and artifacts."
    );
  }

  const protocolPrompts = new Map(
    protocol.tasks.map((task) => [task.id, task.promptVersion])
  );
  for (const [taskId, promptVersion] of Object.entries(
    history.compatibilityPolicy.requiredTaskVersions
  )) {
    if (protocolPrompts.get(taskId) !== promptVersion) {
      throw new Error(
        `Protocol prompt version does not match demo history for ${taskId}.`
      );
    }
  }

  const tappingTask = currentObservation.tasks.find(
    (task) => task.taskId === "seated-finger-tap.v0.1"
  );
  const tappingProtocol = protocol.tasks.find(
    (task) => task.id === "seated-finger-tap.v0.1"
  );
  if (
    tappingTask?.retryCount !== 1 ||
    tappingTask.qualityAttempts?.length !== 2 ||
    tappingTask.qualityAttempts[0].status !== "retry" ||
    tappingTask.qualityAttempts[1].status !== "pass" ||
    tappingTask.quality?.status !== "pass"
  ) {
    throw new Error(
      "Current encounter must show one bounded framing correction and final passing quality."
    );
  }
  if (
    tappingProtocol?.demoQualityPolicy?.id !==
      captureQualityEvent.payload.rule.id ||
    tappingProtocol.demoQualityPolicy.version !==
      captureQualityEvent.payload.rule.version ||
    tappingProtocol.demoQualityPolicy.processorId !==
      captureQualityEvent.payload.processor.id ||
    tappingProtocol.demoQualityPolicy.processorVersion !==
      captureQualityEvent.payload.processor.version ||
    tappingTask.qualityAttempts.some(
      (attempt) =>
        attempt.ruleId !== tappingProtocol.demoQualityPolicy.id ||
        attempt.ruleVersion !== tappingProtocol.demoQualityPolicy.version ||
        attempt.processorVersion !==
          tappingProtocol.demoQualityPolicy.processorVersion
    )
  ) {
    throw new Error(
      "Protocol, quality events, and encounter attempts must share rule and processor versions."
    );
  }

  const comparisonIncludedIds = new Set(comparison.includedEncounterIds);
  if (
    comparison.currentEncounterId !== currentObservation.encounterId ||
    comparisonIncludedIds.size !== compatibleHistoryIds.size ||
    [...comparisonIncludedIds].some((id) => !compatibleHistoryIds.has(id)) ||
    comparison.excludedEncounters?.[0]?.encounterId !==
      excluded[0].encounterId ||
    comparison.excludedEncounters?.[0]?.reasonCode !==
      "prompt-version-mismatch"
  ) {
    throw new Error(
      "Trajectory comparison must match the current observation and demo history fixture."
    );
  }

  const expectedComparisonIds = new Set(comparison.includedEncounterIds);
  const cardComparisonIds = new Set(card.comparisonEncounterIds);
  if (
    card.encounterId !== currentObservation.encounterId ||
    card.trajectoryComparisonId !== comparison.comparisonId ||
    cardComparisonIds.size !== expectedComparisonIds.size ||
    [...cardComparisonIds].some((id) => !expectedComparisonIds.has(id))
  ) {
    throw new Error(
      "Evidence card must reference the same current and comparison encounters."
    );
  }

  const assetIds = new Set(
    [...priorObservation.tasks, ...currentObservation.tasks].map(
      (task) => task.asset.assetId
    )
  );
  const cardEvidenceRefs = card.items.flatMap((item) => item.evidence);
  if (cardEvidenceRefs.some((id) => !assetIds.has(id))) {
    throw new Error("Evidence card contains an unknown source-clip reference.");
  }

  const cardEventRefs = [
    ...card.captureQuality.sourceEventIds,
    card.compatibility.sourceEventId,
    ...card.items.map((item) => item.groundingEventId),
    ...card.summarySupport.eventIds,
    card.review.sourceEventId,
    ...comparison.sourceEventIds
  ];
  if (cardEventRefs.some((id) => !eventIds.has(id))) {
    throw new Error("Card or comparison contains an unknown event reference.");
  }

  const groundedClaimIds = new Set(
    events
      .filter((event) => event.type === "evidence-claim.grounded")
      .map((event) => event.payload.claimId)
  );
  if (
    card.items.some(
      (item) =>
        item.groundingStatus !== "pass" ||
        !groundedClaimIds.has(item.claimId)
    )
  ) {
    throw new Error("Every evidence-card claim must have a grounding event.");
  }
  if (!groundedClaimIds.has(evidenceTraceEvents[0].payload?.claimId)) {
    throw new Error("The opened evidence trace must target a grounded claim.");
  }
  const cardClaimIds = new Set(card.items.map((item) => item.claimId));
  const groundedSummaryClaims = [
    ...card.headlineClaimIds,
    ...card.summarySupport.claimIds
  ];
  if (
    groundedSummaryClaims.some(
      (claimId) =>
        !cardClaimIds.has(claimId) || !groundedClaimIds.has(claimId)
    )
  ) {
    throw new Error(
      "Evidence-card headline and summary must reference grounded item claims."
    );
  }

  const finalDisposition = reviewDispositionEvents[0];
  if (
    card.review.decision !== finalDisposition.payload.decision ||
    card.review.acceptedIntoHistory !==
      finalDisposition.payload.acceptedIntoHistory ||
    card.review.reviewer !== finalDisposition.payload.reviewerId
  ) {
    throw new Error(
      "Evidence-card review must match the final human-review event."
    );
  }
NODE

agent_count="$(find agents -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
if [[ "$agent_count" != "3" ]]; then
  echo "Expected exactly 3 top-level agents; found $agent_count." >&2
  exit 1
fi

if find . -type f \
  \( -name "*.wav" -o -name "*.mp3" -o -name "*.m4a" -o -name "*.mp4" -o -name "*.mov" -o -name "*.webm" \) \
  -print -quit | grep -q .; then
  echo "Captured media must not be committed." >&2
  exit 1
fi

echo "Neurotrax structure and event stream are valid."
