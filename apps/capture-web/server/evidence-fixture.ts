export const EVIDENCE_SMOKE_REQUEST = {
  containsPHI: false,
  rawMediaRetained: false,
  nativeVisualObservationsRetained: false,
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
      measurementCode: "prototype.face.smile_excursion.asymmetry",
      label: "Smile-excursion asymmetry",
      modality: "face",
      statement:
        "Smile-excursion asymmetry was measured across accepted neutral and smile task windows.",
      currentValue: 0.04,
      unit: "inter-eye-normalized-distance",
      qualityFacts: {
        usableWindows: 2,
        usableFraction: 0.8,
        processorRef:
          "mediapipe-face-landmarker:0.10.35:64184e229b26:bilateral-geometry-v1:gpu"
      },
      supportRefs: ["face-neutral", "face-smile"],
      eventIds: ["measurement-face", "measurement-smile"],
      allowedNumbers: ["0.04"]
    }
  ]
} as const;
