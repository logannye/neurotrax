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
  "apps/capture-web/server/evidence-agent.ts"
  "apps/capture-web/src/face-worker.ts"
  "apps/capture-web/public/voice-capture-worklet.js"
  "apps/capture-web/src/voice-worker.ts"
  "packages/ambient-core/src/voice-analysis.ts"
  "apps/capture-web/public/models/face_landmarker.task"
  "apps/capture-web/public/mediapipe/vision_wasm_internal.wasm"
  "apps/clinician-review/README.md"
  "agents/ambient-capture/README.md"
  "agents/personal-trajectory/README.md"
  "agents/evidence-card/README.md"
  "packages/contracts/README.md"
  "packages/contracts/src/trajectory.ts"
  "packages/contracts/src/evidence.ts"
  "packages/trajectory-core/fixtures/synthetic-history.json"
  "packages/evidence-core/src/evidence.ts"
  "packages/event-log/README.md"
  "protocols/macbook-check-in.v0.1.json"
  "protocols/voice-foundation.v0.1.json"
  "services/voice-inference/pyproject.toml"
  "services/voice-inference/phenometric_voice/app.py"
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
    "protocols/voice-foundation.v0.1.json",
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
    correctionEvent.payload?.retryPolicy?.maxAttempts !== null ||
    correctionEvent.payload?.retryPolicy?.onExhaustion !==
      "remain-on-current-task"
  ) {
    throw new Error(
      "Guided-capture correction must permit repetition without timeout or skip."
    );
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

  const packageManifest = JSON.parse(
    fs.readFileSync("package.json", "utf8")
  );
  const protocol = JSON.parse(
    fs.readFileSync("protocols/macbook-check-in.v0.1.json", "utf8")
  );
  const voiceProtocol = JSON.parse(
    fs.readFileSync("protocols/voice-foundation.v0.1.json", "utf8")
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

  if (packageManifest.name !== "phenometric") {
    throw new Error("The package name must be phenometric.");
  }

  const history = JSON.parse(
    fs.readFileSync("examples/demo-patient-history.example.json", "utf8")
  );
  const consentEvent = events.find(
    (event) => event.type === "consent.recorded"
  );
  const privacySafe = (artifact) =>
    artifact.containsPHI === false &&
    artifact.rawMediaRetained === false &&
    artifact.rawAudioRetained === false &&
    artifact.nativeAudioObservationsRetained === false &&
    artifact.transcriptRetained === false &&
    artifact.voiceEmbeddingsRetained === false &&
    artifact.nativeVisualObservationsRetained === false;
  if (
    consentEvent.payload?.captureMode !== "live" ||
    currentObservation.captureMode !== consentEvent.payload.captureMode ||
    card.captureMode !== currentObservation.captureMode ||
    priorObservation.captureMode !== history.captureMode ||
    history.captureMode !== "fixture-playback" ||
    !privacySafe(consentEvent.payload) ||
    !privacySafe(currentObservation) ||
    !privacySafe(priorObservation) ||
    !privacySafe(comparison) ||
    !privacySafe(card) ||
    !privacySafe(history)
  ) {
    throw new Error(
      "Capture artifacts must use explicit live/fixture modes and assert ephemeral non-PHI processing."
    );
  }

  const expectedPhases = [
    ["establishing", 1500],
    ["turn-away", 750],
    ["neutral-face", 1500],
    ["smile", 1500],
    ["eye-closure", 1500]
  ];
  const expectedFaceCodes = [
    "prototype.face.smile_excursion.left",
    "prototype.face.smile_excursion.right",
    "prototype.face.smile_excursion.asymmetry",
    "prototype.face.eye_closure_fraction.left",
    "prototype.face.eye_closure_fraction.right",
    "prototype.face.eye_closure_fraction.asymmetry"
  ];
  const expectedVoiceCodes = [
    "prototype.voice.f0.median",
    "prototype.voice.f0.variability",
    "prototype.voice.cpps",
    "prototype.voice.hnr",
    "prototype.voice.intensity.variability",
    "prototype.voice.voiced_fraction",
    "prototype.voice.pause_rate",
    "prototype.voice.pause_duration.median",
    "prototype.voice.speech_run_duration.median",
    "prototype.voice.syllabic_rate_estimate",
    "prototype.voice.jitter.local",
    "prototype.voice.shimmer.local",
    "prototype.voice.phonation_break_fraction",
    "prototype.voice.formant.f1_median",
    "prototype.voice.formant.f2_median",
    "prototype.voice.ddk.rate",
    "prototype.voice.ddk.interval_variability",
    "prototype.voice.onset_latency"
  ];
  if (
    protocol.id !== "facial-foundation.v1" ||
    protocol.sequence?.length !== expectedPhases.length ||
    protocol.sequence.some(
      (phase, index) =>
        phase.phase !== expectedPhases[index][0] ||
        phase.evidenceDurationMs !== expectedPhases[index][1] ||
        phase.assistanceAfterMs !== 12000 ||
        "durationSeconds" in phase
    ) ||
    protocol.sequence[3].adherenceHoldMs !== 500 ||
    protocol.sequence[4].closureHoldMs !== 300 ||
    protocol.sequence[4].recoveryHoldMs !== 300 ||
    protocol.advancement?.mode !== "signal-gated" ||
    protocol.advancement?.maximumContinuousSignalGapMs !== 200 ||
    protocol.advancement?.timeoutBehavior !== "never-auto-advance" ||
    protocol.advancement?.skipAvailable !== false ||
    protocol.advancement?.acceptedEvidence !==
      "final-qualifying-interval-only" ||
    "speechMeasurements" in protocol ||
    JSON.stringify(protocol.facialMeasurements) !==
      JSON.stringify(expectedFaceCodes)
  ) {
    throw new Error(
      "Facial protocol must retain its completion-gated exercises and exact six facial measurements without legacy speech metrics."
    );
  }
  const expectedVoicePhases = [
    ["sustained-vowel-1", 3000],
    ["sustained-vowel-2", 3000],
    ["standardized-reading", 4000],
    ["rapid-syllables", 4000],
    ["spontaneous-response", 8000]
  ];
  if (
    voiceProtocol.id !== "voice-foundation.v1" ||
    voiceProtocol.cameraRequested !== false ||
    voiceProtocol.systemCheck?.[0]?.phase !== "quiet-calibration" ||
    voiceProtocol.systemCheck?.[0]?.evidenceDurationMs !== 2000 ||
    voiceProtocol.systemCheck?.[1]?.phase !== "natural-speech-check" ||
    voiceProtocol.systemCheck?.[1]?.evidenceDurationMs !== 1500 ||
    voiceProtocol.sequence?.length !== expectedVoicePhases.length ||
    voiceProtocol.sequence.some(
      (phase, index) =>
        phase.phase !== expectedVoicePhases[index][0] ||
        phase.evidenceDurationMs !== expectedVoicePhases[index][1] ||
        phase.assistanceAfterMs !== 12000
    ) ||
    voiceProtocol.sequence[0].requiredPeriodicityCoverage !== 0.8 ||
    voiceProtocol.sequence[1].requiredPeriodicityCoverage !== 0.8 ||
    voiceProtocol.sequence[3].requiredSyllabicNuclei !== 6 ||
    voiceProtocol.sequence[4].permitsNaturalPauses !== true ||
    voiceProtocol.advancement?.mode !== "signal-gated" ||
    voiceProtocol.advancement?.timeoutBehavior !== "never-auto-advance" ||
    voiceProtocol.advancement?.skipAvailable !== false ||
    JSON.stringify(voiceProtocol.voiceMeasurements) !==
      JSON.stringify(expectedVoiceCodes) ||
    voiceProtocol.clinicalClaims?.length !== 0
  ) {
    throw new Error(
      "Voice protocol must define the exact microphone-only gated battery and eighteen prototype.voice measurements."
    );
  }
  if (
    protocol.processing?.rawMediaRetained !== false ||
    protocol.processing?.rawAudioRetained !== false ||
    protocol.processing?.nativeAudioObservationsRetained !== false ||
    protocol.processing?.transcriptRetained !== false ||
    protocol.processing?.voiceEmbeddingsRetained !== false ||
    protocol.processing?.nativeVisualObservationsRetained !== false ||
    protocol.processing?.mediaPipeVersion !== "0.10.35" ||
    protocol.processing?.lateralityConvention !== "subject-anatomical" ||
    protocol.processing?.coordinateSpace !==
      "normalized-unmirrored-image" ||
    protocol.processing?.liveOverlay?.landmarkCount !== 478 ||
    protocol.processing?.liveOverlay?.maximumRenderRateHz !== 12 ||
    protocol.processing?.liveOverlay?.renderedInsideVisualWorker !== true ||
    protocol.processing?.liveOverlay?.displayOnly !== true ||
    protocol.processing?.liveOverlay?.stored !== false ||
    protocol.clinicalClaims?.length !== 0
  ) {
    throw new Error(
      "Protocol processing must remain local, versioned, anatomical, ephemeral, and nonclinical."
    );
  }
  if (
    voiceProtocol.processing?.rawMediaRetained !== false ||
    voiceProtocol.processing?.rawAudioRetained !== false ||
    voiceProtocol.processing?.nativeAudioObservationsRetained !== false ||
    voiceProtocol.processing?.transcriptRetained !== false ||
    voiceProtocol.processing?.voiceEmbeddingsRetained !== false ||
    voiceProtocol.processing?.analysisWindowMs !== 40 ||
    voiceProtocol.processing?.analysisHopMs !== 10 ||
    voiceProtocol.processing?.pcmBlockMs !== 20 ||
    voiceProtocol.processing?.ringBufferSeconds !== 30 ||
    voiceProtocol.processing?.requestedAudio?.sampleRate !== 48000 ||
    voiceProtocol.processing?.optionalRepresentationProcessor
      ?.enabledByDefault !== false ||
    voiceProtocol.processing?.optionalRepresentationProcessor
      ?.serviceBinding !== "127.0.0.1" ||
    voiceProtocol.processing?.optionalRepresentationProcessor?.stored !==
      false
  ) {
    throw new Error(
      "Voice processing must remain continuous, local, bounded, optional, ephemeral, and nonclinical."
    );
  }

  const observationCodes = new Set(
    currentObservation.measurements.map((measurement) => measurement.code)
  );
  const aggregateCodes = new Set(
    currentObservation.aggregates.map((aggregate) => aggregate.code)
  );
  const observationContexts = new Set(
    currentObservation.windows.map((window) => window.context.kind)
  );
  if (
    currentObservation.schemaVersion !==
      "phenometric.encounter-observation.v2" ||
    currentObservation.selectedProtocolId !== "facial-foundation.v1" ||
    currentObservation.measurementCount !== 6 ||
    observationCodes.size !== 6 ||
    aggregateCodes.size !== 6 ||
    expectedFaceCodes.some(
      (code) => !observationCodes.has(code) || !aggregateCodes.has(code)
    ) ||
    [...observationCodes].some((code) => code.startsWith("prototype.speech.")) ||
    ["neutral-face", "smile", "eye-closure"].some(
      (context) => !observationContexts.has(context)
    )
  ) {
    throw new Error(
      "Current facial observation must expose exactly six facial task measurements and no removed prototype.speech metrics."
    );
  }

  const visualProcessorRef = currentObservation.visualPipeline?.processorRef;
  if (
    !visualProcessorRef ||
    currentObservation.visualPipeline.mediaPipeVersion !== "0.10.35" ||
    currentObservation.visualPipeline.modelSha256 !==
      "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff" ||
    currentObservation.visualPipeline.geometryVersion !==
      "bilateral-geometry-v1" ||
    currentObservation.videoCaptureSettings?.lateralityConvention !==
      "subject-anatomical" ||
    currentObservation.videoCaptureSettings?.coordinateSpace !==
      "normalized-unmirrored-image"
  ) {
    throw new Error(
      "Observation must carry pinned visual provenance and unmirrored anatomical capture settings."
    );
  }

  const forbiddenSerializedKeys = new Set([
    "deviceId",
    "deviceLabel",
    "groupId",
    "pcm",
    "waveform",
    "pitchCycles",
    "fftBins",
    "cepstra",
    "mfccs",
    "formantCandidates",
    "formantTracks",
    "transcript",
    "spectrogram",
    "embeddings",
    "voiceprint",
    "landmarks",
    "faceLandmarks",
    "blendshapes",
    "faceBlendshapes",
    "matrices",
    "transformationMatrix",
    "facialTransformationMatrixes",
    "bitmap",
    "mediaStream",
    "meshConnections",
    "overlayPixels",
    "offscreenCanvas",
    "screenshot"
  ]);
  const findForbiddenKey = (value) => {
    if (!value || typeof value !== "object") return null;
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenSerializedKeys.has(key)) return key;
      const nested = findForbiddenKey(child);
      if (nested) return nested;
    }
    return null;
  };
  for (const [name, artifact] of [
    ["observation", currentObservation],
    ["prior observation", priorObservation],
    ["history", history],
    ["comparison", comparison],
    ["evidence card", card],
    ["event stream", events]
  ]) {
    const forbidden = findForbiddenKey(artifact);
    if (forbidden) {
      throw new Error(`${name} serializes forbidden native audio/visual key: ${forbidden}`);
    }
  }

  const everyEncounterIsSynthetic = history.history.every(
    (encounter) =>
      encounter.synthetic === true &&
      encounter.containsPHI === false &&
      encounter.reviewStatus === "accepted"
  );
  const compatible = history.history.filter((encounter) =>
    encounter.aggregates
      .filter((aggregate) => aggregate.code.startsWith("prototype.face."))
      .every(
        (aggregate) =>
          aggregate.algorithmVersion ===
            history.compatibilityPolicy.requiredVisualAlgorithmVersion &&
          aggregate.processorRef ===
            history.compatibilityPolicy.requiredVisualProcessorRef
      )
  );
  const excluded = history.history.filter(
    (encounter) => !compatible.includes(encounter)
  );
  if (
    history.synthetic !== true ||
    history.participant?.synthetic !== true ||
    !everyEncounterIsSynthetic ||
    compatible.length !== 3 ||
    excluded.length !== 1
  ) {
    throw new Error(
      "Demo history must contain three exact visual-pipeline matches and one incompatible baseline."
    );
  }

  const compatibleHistoryIds = new Set(
    compatible.map((encounter) => encounter.visitId)
  );
  const comparisonIncludedIds = new Set(comparison.includedEncounterIds);
  const eventIncludedIds = new Set(
    compatibilityEvent.payload.includedEncounterIds
  );
  const excludedId = excluded[0].visitId;
  if (
    comparison.currentVisitId !== currentObservation.visitId ||
    comparisonIncludedIds.size !== compatibleHistoryIds.size ||
    [...compatibleHistoryIds].some(
      (id) =>
        !comparisonIncludedIds.has(id) ||
        !eventIncludedIds.has(id)
    ) ||
    comparison.excludedEncounters?.[0]?.encounterId !== excludedId ||
    !comparison.excludedEncounters?.[0]?.reasonCodes?.includes(
      "visual-processor-mismatch"
    ) ||
    compatibilityEvent.payload.excludedEncounters?.[0]?.encounterId !==
      excludedId
  ) {
    throw new Error(
      "Trajectory artifacts must agree on exact processor-compatible history selections."
    );
  }

  const groundedClaimIds = new Set(
    events
      .filter((event) => event.type === "evidence-claim.grounded")
      .map((event) => event.payload.claimId)
  );
  if (
    card.visitId !== currentObservation.visitId ||
    card.claims.length !== 1 ||
    card.claims.some((claim) => !groundedClaimIds.has(claim.claimId)) ||
    card.claims.find((claim) => claim.modality === "face")
      ?.measurementCode !==
      "prototype.face.smile_excursion.asymmetry" ||
    card.claims.find((claim) => claim.modality === "face")
      ?.processorRef !== visualProcessorRef
  ) {
    throw new Error(
      "Facial evidence card must contain one grounded primary facial task outcome."
    );
  }
  if (!groundedClaimIds.has(evidenceTraceEvents[0].payload?.claimId)) {
    throw new Error("The opened evidence trace must target a grounded claim.");
  }

  const finalDisposition = reviewDispositionEvents[0];
  if (
    card.review.decision !== finalDisposition.payload.decision ||
    card.review.approvedForSession !== true ||
    card.review.reviewer !== finalDisposition.payload.reviewerId
  ) {
    throw new Error(
      "Evidence-card review must match the final human-review event."
    );
  }

  const currentHistory = JSON.parse(
    fs.readFileSync(
      "packages/trajectory-core/fixtures/synthetic-history.json",
      "utf8"
    )
  );
  const currentCapturePackage = JSON.parse(
    fs.readFileSync("apps/capture-web/package.json", "utf8")
  );
  const modern = currentHistory.filter((record) =>
    record.aggregates.every((aggregate) =>
      ["facial-task-kinematics-1.0"].includes(
        aggregate.algorithmVersion
      )
    )
  );
  const oldAlgorithm = currentHistory.filter((record) =>
    record.aggregates.some((aggregate) =>
      !["facial-task-kinematics-1.0"].includes(
        aggregate.algorithmVersion
      ) ||
      (aggregate.code.startsWith("prototype.face.") &&
        aggregate.processorRef !==
          currentHistory[0].aggregates.find((candidate) =>
            candidate.code.startsWith("prototype.face.")
          )?.processorRef)
    )
  );
  if (
    currentHistory.length !== 4 ||
    modern.length !== 3 ||
    oldAlgorithm.length !== 1 ||
    currentHistory.some(
      (record) =>
        record.containsPHI !== false ||
        record.synthetic !== true ||
        record.source !== "synthetic-fixture" ||
        record.reviewStatus !== "accepted"
    )
  ) {
    throw new Error(
      "Current trajectory fixture must contain three compatible synthetic visits and one algorithm/processor exclusion."
    );
  }
  if (
    currentCapturePackage.dependencies["@mediapipe/tasks-vision"] !==
      "0.10.35" ||
    currentCapturePackage.dependencies.openai !== "6.48.0" ||
    currentCapturePackage.dependencies.zod !== "4.4.3"
  ) {
    throw new Error(
      "MediaPipe, OpenAI, and Zod must remain pinned to the demo-reviewed versions."
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

expected_model_hash="64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
actual_model_hash="$(
  shasum -a 256 apps/capture-web/public/models/face_landmarker.task |
    awk '{print $1}'
)"
if [[ "$actual_model_hash" != "$expected_model_hash" ]]; then
  echo "Face Landmarker model hash does not match the reviewed asset." >&2
  exit 1
fi

echo "PhenoMetric structure, assets, fixtures, and event stream are valid."
