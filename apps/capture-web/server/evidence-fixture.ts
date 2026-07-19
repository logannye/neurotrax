export const EVIDENCE_SMOKE_REQUEST = {
  containsPHI: false,
  visitId: "service-readiness",
  qualitySummary: {
    speechWindowCount: 1,
    faceWindowCount: 2,
    abstentionCount: 1,
    qualityTransitionCount: 4,
    audioFrameCount: 60,
    speechActiveFrameCount: 48,
    pitchedFrameCount: 42,
    pitchCoverage: 0.875,
    faceFrameCount: 60,
    usableFaceFrameCount: 48,
    usableFaceFraction: 0.8,
    faceWithholdingDurationMs: 1000,
    faceRecoveryObserved: true,
    postRecoveryFaceWindowCount: 1
  },
  outcomes: [
    {
      outcomeId: "outcome-speech-measured",
      status: "measured",
      measurementCode: "prototype.speech.pitch_variability",
      label: "Pitch variability",
      modality: "speech",
      statement:
        "Pitch variability was measured from a technically usable speech interval.",
      currentValue: 1.9,
      unit: "semitone-stddev",
      qualityFacts: { usableWindows: 1, pitchCoverage: 0.875 },
      supportRefs: ["speech-0"],
      eventIds: ["measurement-pitch"],
      allowedNumbers: ["1.9"]
    },
    {
      outcomeId: "outcome-face-measured",
      status: "measured",
      measurementCode: "prototype.face.expressivity",
      label: "Facial movement",
      modality: "face",
      statement:
        "Facial movement was measured before and after a quality-withheld interval.",
      currentValue: 0.04,
      unit: "motion-index",
      qualityFacts: { usableWindows: 2, recoveryConfirmed: true },
      supportRefs: ["face-0", "face-1"],
      eventIds: ["measurement-face", "face-restored"],
      allowedNumbers: ["0.04"]
    }
  ]
} as const;
