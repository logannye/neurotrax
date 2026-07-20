import { describe, expect, it } from "vitest";
import {
  createVoiceGuidedController,
  type VoiceGateSignal
} from "./voice-guided-demo.js";

function signal(
  tMs: number,
  overrides: Partial<VoiceGateSignal> = {}
): VoiceGateSignal {
  return {
    tMs,
    voiced: true,
    periodicityReliable: true,
    syllabicNucleus: false,
    qualityUsable: true,
    quietPauseUsable: true,
    processorRef: "browser-voice-dsp@1.0",
    ...overrides
  };
}

function drive(
  controller: ReturnType<typeof createVoiceGuidedController>,
  startMs: number,
  endMs: number,
  overrides: (tMs: number) => Partial<VoiceGateSignal> = () => ({})
): void {
  for (let tMs = startMs; tMs <= endMs; tMs += 10) {
    controller.observe(signal(tMs, overrides(tMs)));
  }
}

describe("voice completion gates", () => {
  it("never advances from elapsed time alone", () => {
    const controller = createVoiceGuidedController();
    expect(controller.tick(60_000).phase).toBe("sustained-vowel-1");
    expect(controller.snapshot().needsAssistance).toBe(true);
  });

  it("requires three seconds and 80% periodicity for each vowel", () => {
    const controller = createVoiceGuidedController();
    drive(controller, 0, 2_990);
    expect(controller.snapshot().phase).toBe("sustained-vowel-1");
    controller.observe(signal(3_000));
    expect(controller.snapshot().phase).toBe("sustained-vowel-2");
    drive(controller, 3_010, 6_010, (tMs) => ({
      periodicityReliable: tMs % 40 !== 0
    }));
    expect(controller.snapshot().phase).toBe("sustained-vowel-2");
  });

  it("resets only the current gate on a quality break", () => {
    const controller = createVoiceGuidedController();
    drive(controller, 0, 3_000);
    drive(controller, 3_010, 4_000);
    controller.observe(signal(4_010, { qualityUsable: false }));
    drive(controller, 4_020, 7_010);
    expect(controller.snapshot().phase).toBe("sustained-vowel-2");
    controller.observe(signal(7_020));
    expect(controller.snapshot().phase).toBe("standardized-reading");
    expect(controller.snapshot().acceptedEvidenceIntervals).toHaveLength(2);
  });

  it("requires six nuclei during rapid syllables", () => {
    const controller = createVoiceGuidedController();
    drive(controller, 0, 3_000);
    drive(controller, 3_010, 6_010);
    drive(controller, 6_020, 10_020);
    expect(controller.snapshot().phase).toBe("rapid-syllables");
    drive(controller, 10_030, 14_030, (tMs) => ({
      syllabicNucleus: (tMs - 10_030) % 900 === 0
    }));
    expect(controller.snapshot().phase).toBe("rapid-syllables");
    controller.resetCurrentGate(14_040);
    drive(controller, 14_050, 18_050, (tMs) => ({
      syllabicNucleus: tMs % 500 === 0
    }));
    expect(controller.snapshot().phase).toBe("spontaneous-response");
  });

  it("permits natural pauses in the spontaneous response", () => {
    const controller = createVoiceGuidedController();
    drive(controller, 0, 3_000);
    drive(controller, 3_010, 6_010);
    drive(controller, 6_020, 10_020);
    drive(controller, 10_030, 14_030, (tMs) => ({
      syllabicNucleus: tMs % 500 === 0
    }));
    const start = 14_040;
    drive(controller, start, start + 8_000, (tMs) => {
      const pause = (tMs - start) % 1_000 >= 700;
      return {
        voiced: !pause,
        qualityUsable: !pause,
        quietPauseUsable: true,
        periodicityReliable: !pause
      };
    });
    expect(controller.snapshot().canComplete).toBe(true);
  });

  it("resets on processor changes and stores only final intervals", () => {
    const controller = createVoiceGuidedController();
    drive(controller, 0, 1_500);
    controller.observe(
      signal(1_510, { processorRef: "browser-voice-dsp@1.1" })
    );
    expect(controller.snapshot().progress.usableEvidenceMs).toBe(0);
    drive(controller, 1_520, 4_520, () => ({
      processorRef: "browser-voice-dsp@1.1"
    }));
    expect(
      controller.snapshot().acceptedEvidenceIntervals[0]
    ).toMatchObject({
      startMs: 1_510,
      endMs: 4_510,
      processorRef: "browser-voice-dsp@1.1"
    });
  });
});
