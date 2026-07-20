import {
  createConductorSession,
  createNeutralFacialBaseline,
  evaluateEyeClosureAdherence,
  evaluateSmileAdherence,
  syntheticFacialFrame,
  syntheticFrameStream,
  syntheticVoiceFrame,
  type FacialKinematicsFrameV1
} from "@phenometric/ambient-core";
import { describe, expect, it } from "vitest";
import {
  createGuidedDemoController,
  type GuidedGateSignal
} from "./guided-demo.js";
import { createVoiceGuidedController } from "./voice-guided-demo.js";

function times(startMs: number, endMs: number): number[] {
  const result: number[] = [];
  for (let tMs = startMs; tMs < endMs; tMs += 50) {
    result.push(tMs);
  }
  result.push(endMs);
  return result;
}

describe("guided controller and conductor integration", () => {
  it("clips final facial measurements to controller-produced successful intervals", () => {
    const source = syntheticFrameStream();
    const { audio: _audio, face: _face, ...identity } = source;
    const session = createConductorSession(identity, { baseTimeMs: 0 });
    const controller = createGuidedDemoController();
    const processorRef = identity.visualPipeline!.processorRef;

    const observe = (
      tMs: number,
      overrides: Partial<GuidedGateSignal> = {}
    ) =>
      controller.observe({
        tMs,
        audioAvailable: true,
        audioVoiced: false,
        audioClipped: false,
        visualUsable: true,
        visualReasonCodes: [],
        processorRef,
        ...overrides
      });

    for (const tMs of times(0, 1_500)) {
      session.ingestAudio(
        syntheticVoiceFrame(tMs, {
          taskContext: "natural-speech-check",
          f0Hz: 125
        })
      );
      observe(tMs, { audioVoiced: true });
    }
    for (const tMs of times(1_600, 2_350)) {
      session.ingestAudio(
        syntheticVoiceFrame(tMs, {
          taskContext: "natural-speech-check",
          f0Hz: 130
        })
      );
      observe(tMs, {
        audioVoiced: true,
        visualUsable: false,
        visualReasonCodes: ["face-not-visible"]
      });
    }

    for (const tMs of times(2_450, 2_950)) {
      const failed = syntheticFacialFrame(tMs, "neutral-face", {
        imageQuality: {
          illuminationMean: 0.55,
          darkClippingFraction: 0.02,
          brightClippingFraction: 0.02,
          sharpness: 0.0001
        },
        qualityReasons: ["blur"]
      });
      session.ingestFace(failed);
      observe(tMs, {
        visualUsable: false,
        visualReasonCodes: ["blur"]
      });
    }

    const neutralFrames: FacialKinematicsFrameV1[] = [];
    for (const tMs of times(3_050, 4_550)) {
      const frame = syntheticFacialFrame(tMs, "neutral-face");
      neutralFrames.push(frame);
      session.ingestFace(frame);
      observe(tMs);
    }
    expect(controller.snapshot().phase).toBe("smile");
    const baseline = createNeutralFacialBaseline(neutralFrames);

    for (const tMs of times(4_650, 6_650)) {
      const frame = syntheticFacialFrame(tMs, "smile");
      session.ingestFace(frame);
      const adherence = evaluateSmileAdherence(baseline, [frame]);
      observe(tMs, {
        smile: {
          leftAdherent: adherence.adherent.left,
          rightAdherent: adherence.adherent.right
        }
      });
    }
    const smileBreak = syntheticFacialFrame(6_700, "smile", {
      imageQuality: {
        illuminationMean: 0.55,
        darkClippingFraction: 0.02,
        brightClippingFraction: 0.02,
        sharpness: 0.0001
      },
      qualityReasons: ["blur"]
    });
    session.ingestFace(smileBreak);
    observe(6_700, {
      visualUsable: false,
      visualReasonCodes: ["blur"]
    });
    const acceptedSmileTimes = [
      6_750,
      6_917,
      7_083,
      7_250,
      ...Array.from({ length: 100 }, (_, index) => 7_251 + index * 10),
      8_250
    ];
    for (const tMs of acceptedSmileTimes) {
      const smiling = tMs <= 7_250;
      const frame = syntheticFacialFrame(tMs, "smile", {
        mouthCorners: smiling
          ? {
              left: { x: 0.34, y: 0.1 },
              right: { x: -0.34, y: 0.1 }
            }
          : {
              left: { x: 0.3, y: 0.1 },
              right: { x: -0.3, y: 0.1 }
            }
      });
      session.ingestFace(frame);
      const adherence = evaluateSmileAdherence(baseline, [frame]);
      observe(tMs, {
        smile: {
          leftAdherent: adherence.adherent.left,
          rightAdherent: adherence.adherent.right
        }
      });
    }
    expect(controller.snapshot().phase).toBe("eye-closure");

    for (const tMs of times(8_350, 8_550)) {
      const frame = syntheticFacialFrame(tMs, "eye-closure", {
        eyeAperture: { left: 0.15, right: 0.3 }
      });
      session.ingestFace(frame);
      const adherence = evaluateEyeClosureAdherence(baseline, [frame]);
      observe(tMs, {
        eyeClosure: {
          left: {
            closed: adherence.closed.left,
            recovered: adherence.recovered.left
          },
          right: {
            closed: adherence.closed.right,
            recovered: adherence.recovered.right
          }
        }
      });
    }
    const eyeBreak = syntheticFacialFrame(8_600, "eye-closure", {
      imageQuality: {
        illuminationMean: 0.55,
        darkClippingFraction: 0.02,
        brightClippingFraction: 0.02,
        sharpness: 0.0001
      },
      qualityReasons: ["blur"]
    });
    session.ingestFace(eyeBreak);
    observe(8_600, {
      visualUsable: false,
      visualReasonCodes: ["blur"]
    });
    const acceptedEyeTimes = [
      8_650,
      8_800,
      8_950,
      9_100,
      9_250,
      ...Array.from({ length: 90 }, (_, index) => 9_251 + index * 10),
      10_150
    ];
    for (const tMs of acceptedEyeTimes) {
      const aperture =
        tMs >= 8_950 && tMs <= 9_250 ? 0.15 : 0.3;
      const frame = syntheticFacialFrame(tMs, "eye-closure", {
        eyeAperture: { left: aperture, right: 0.3 }
      });
      session.ingestFace(frame);
      const adherence = evaluateEyeClosureAdherence(baseline, [frame]);
      observe(tMs, {
        eyeClosure: {
          left: {
            closed: adherence.closed.left,
            recovered: adherence.recovered.left
          },
          right: {
            closed: adherence.closed.right,
            recovered: adherence.recovered.right
          }
        }
      });
    }
    const snapshot = controller.snapshot();
    expect(snapshot.phase).toBe("complete");

    session.setGuidedTaskEvidenceIntervals(
      snapshot.acceptedEvidenceIntervals
    );
    const { observation } = session.complete();
    expect(
      observation.windows
        .filter((window) => window.modality === "face")
        .map((window) => [
          window.context.kind,
          window.startMs,
          window.endMs
        ])
    ).toEqual([
      ["neutral-face", 3_050, 4_550],
      ["smile", 6_750, 8_250],
      ["eye-closure", 8_650, 10_150]
    ]);
    expect(
      observation.measurements.filter((measurement) =>
        measurement.code.startsWith("prototype.face.")
      )
    ).toHaveLength(6);
    expect(
      observation.measurements.find(
        (measurement) =>
          measurement.code === "prototype.face.smile_excursion.left"
      )?.value
    ).toBeCloseTo(0.04);
    expect(
      observation.measurements.find(
        (measurement) =>
          measurement.code ===
          "prototype.face.eye_closure_fraction.left"
      )?.value
    ).toBeCloseTo(0.5);
  });

  it("routes exact accepted voice intervals without starting the facial lane", () => {
    const source = syntheticFrameStream({
      selectedProtocolId: "voice-foundation.v1",
      visualPipeline: null,
      videoCaptureSettings: null,
      audioPipeline: {
        processorRef: "browser-voice-dsp@1.0",
        runtime: "audio-worklet-voice-worker",
        workletSchemaVersion: "phenometric.voice-worklet-message.v1",
        workerSchemaVersion: "phenometric.voice-worker-message.v1",
        signalFrameSchemaVersion: "phenometric.voice-signal-frame.v1",
        analysisWindowMs: 40,
        analysisHopMs: 10,
        ringBufferSeconds: 30,
        algorithmVersion: "voice-analysis-1.0"
      },
      audioCaptureSettings: {
        requested: {
          channelCount: 1,
          sampleRate: 48_000,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        actual: {
          channelCount: 1,
          sampleRate: 48_000,
          browserProcessing: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        }
      }
    });
    const { audio: _audio, face: _face, ...identity } = source;
    const session = createConductorSession(identity, { baseTimeMs: 0 });
    const controller = createVoiceGuidedController();
    let tMs = 0;
    let sequence = 0;

    while (!controller.snapshot(tMs).canComplete && tMs < 30_000) {
      const snapshot = controller.snapshot(tMs);
      if (snapshot.phase === "complete") break;
      const naturalPause =
        snapshot.phase === "spontaneous-response" &&
        snapshot.phaseElapsedMs % 1_600 >= 1_250;
      const voiced = !naturalPause;
      const syllabicNucleus =
        snapshot.phase === "rapid-syllables" &&
        snapshot.phaseElapsedMs % 400 === 0;
      sequence += 1;
      const frame = syntheticVoiceFrame(tMs, {
        taskContext: snapshot.phase,
        sequence,
        absoluteSampleIndex: sequence * 480,
        voiced,
        f0Hz: voiced ? 180 + Math.sin(tMs / 300) * 5 : null,
        f0Confidence: voiced ? 0.93 : 0,
        cppsDb: voiced ? 14 + Math.sin(tMs / 500) : null,
        hnrDb: voiced ? 22 + Math.sin(tMs / 600) : null,
        syllabicNucleus
      });
      session.ingestAudio(frame);
      controller.observe({
        tMs,
        voiced,
        periodicityReliable: voiced,
        syllabicNucleus,
        qualityUsable: voiced,
        quietPauseUsable: true,
        processorRef: frame.processorRef
      });
      tMs += 10;
    }

    const snapshot = controller.snapshot(tMs);
    expect(snapshot.canComplete).toBe(true);
    expect(snapshot.acceptedEvidenceIntervals).toHaveLength(5);
    session.setGuidedVoiceTaskEvidenceIntervals(
      snapshot.acceptedEvidenceIntervals
    );
    const { observation } = session.complete();
    expect(observation.selectedProtocolId).toBe("voice-foundation.v1");
    expect(observation.visualPipeline).toBeNull();
    expect(observation.videoCaptureSettings).toBeNull();
    expect(observation.windows).toHaveLength(5);
    expect(
      observation.windows.every(
        (window) => window.modality === "speech"
      )
    ).toBe(true);
    expect(
      new Set(
        observation.measurements.map((measurement) => measurement.code)
      ).size
    ).toBe(18);
    expect(
      observation.measurements.some((measurement) =>
        measurement.code.startsWith("prototype.speech.")
      )
    ).toBe(false);
    const sustainedWindowIds = new Set(
      observation.windows
        .filter((window) => window.context.kind === "sustained-vowel")
        .map((window) => window.windowId)
    );
    const repeatedCpps = observation.measurements.filter(
      (measurement) =>
        measurement.code === "prototype.voice.cpps" &&
        sustainedWindowIds.has(measurement.contextRef) &&
        measurement.uncertainty.kind === "estimated"
    );
    expect(repeatedCpps).toHaveLength(2);
    expect(
      observation.aggregates.find(
        (aggregate) =>
          aggregate.code === "prototype.voice.cpps" &&
          aggregate.contextKind === "sustained-vowel"
      )?.sourceWindowRefs
    ).toHaveLength(2);
    expect(JSON.stringify(observation)).not.toMatch(
      /"(?:pcm|waveform|pitchCycles|fftBins|cepstra|mfccs|formantTracks|transcript|spectrogram|embeddings|voiceprint)"\s*:/
    );
  });
});
