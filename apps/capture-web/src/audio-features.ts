export interface DerivedAudioFeature {
  rms: number;
  pitchHz: number | null;
  pitchConfidence: number;
  voiced: boolean;
  clipped: boolean;
  snrDb: number;
}

export interface VoiceCalibration {
  medianNoiseRms: number;
  noiseP90Rms: number;
  entryThresholdRms: number;
  exitThresholdRms: number;
}

export const MIN_VOICE_ENTRY_RMS = 0.008;
export const MIN_VOICE_EXIT_RMS = 0.006;
export const VOICE_TO_NOISE_RATIO = 2.8;
export const VOICE_EXIT_TO_NOISE_RATIO = 1.6;
const MIN_PITCH_HZ = 70;
const MAX_PITCH_HZ = 350;
const MIN_PITCH_CORRELATION = 0.55;
const SPEECH_HANGOVER_FRAMES = 3;

export function calculateRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let sumOfSquares = 0;
  for (const sample of samples) {
    sumOfSquares += sample * sample;
  }
  return Math.sqrt(sumOfSquares / samples.length);
}

export interface PitchEstimate {
  hz: number | null;
  confidence: number;
}

export function estimatePitch(
  samples: Float32Array,
  sampleRate: number
): PitchEstimate {
  if (
    samples.length < 2 ||
    calculateRms(samples) < MIN_VOICE_EXIT_RMS
  ) {
    return { hz: null, confidence: 0 };
  }

  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;

  const minLag = Math.max(1, Math.floor(sampleRate / MAX_PITCH_HZ));
  const maxLag = Math.min(
    samples.length - 2,
    Math.floor(sampleRate / MIN_PITCH_HZ)
  );

  let bestLag = 0;
  let bestCorrelation = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let numerator = 0;
    let energyA = 0;
    let energyB = 0;
    const limit = samples.length - lag;

    for (let index = 0; index < limit; index += 1) {
      const a = samples[index] - mean;
      const b = samples[index + lag] - mean;
      numerator += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const denominator = Math.sqrt(energyA * energyB);
    const correlation = denominator === 0 ? 0 : numerator / denominator;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (
    bestLag === 0 ||
    bestLag >= maxLag - 1 ||
    bestCorrelation < MIN_PITCH_CORRELATION
  ) {
    return { hz: null, confidence: Math.max(0, bestCorrelation) };
  }
  return {
    hz: sampleRate / bestLag,
    confidence: Math.min(1, Math.max(0, bestCorrelation))
  };
}

export function estimatePitchHz(
  samples: Float32Array,
  sampleRate: number
): number | null {
  return estimatePitch(samples, sampleRate).hz;
}

export function deriveAudioFeature(
  samples: Float32Array,
  sampleRate: number,
  noiseFloorRms: number,
  currentlyVoiced = false
): DerivedAudioFeature {
  const rms = calculateRms(samples);
  const pitch = estimatePitch(samples, sampleRate);
  const voiceThreshold = Math.max(
    currentlyVoiced ? MIN_VOICE_EXIT_RMS : MIN_VOICE_ENTRY_RMS,
    noiseFloorRms *
      (currentlyVoiced
        ? VOICE_EXIT_TO_NOISE_RATIO
        : VOICE_TO_NOISE_RATIO)
  );
  const safeNoiseFloor = Math.max(noiseFloorRms, 0.0001);
  const snrDb =
    rms === 0 ? 0 : Math.max(0, 20 * Math.log10(rms / safeNoiseFloor));

  let peak = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
  }

  return {
    rms,
    pitchHz: pitch.hz,
    pitchConfidence: pitch.confidence,
    voiced:
      rms >= voiceThreshold &&
      (currentlyVoiced ||
        (pitch.hz !== null &&
          pitch.confidence >= MIN_PITCH_CORRELATION)),
    clipped: peak >= 0.98,
    snrDb
  };
}

export interface VoiceActivityTracker {
  derive(samples: Float32Array, sampleRate: number): DerivedAudioFeature;
  reset(): void;
  getNoiseFloorRms(): number;
  calibrate(noiseRmsSamples: number[]): VoiceCalibration;
  getCalibration(): VoiceCalibration;
}

export function createVoiceActivityTracker(
  initialNoiseFloorRms = 0.006
): VoiceActivityTracker {
  let noiseFloorRms = initialNoiseFloorRms;
  let calibration: VoiceCalibration = {
    medianNoiseRms: initialNoiseFloorRms,
    noiseP90Rms: initialNoiseFloorRms,
    entryThresholdRms: Math.max(
      MIN_VOICE_ENTRY_RMS,
      initialNoiseFloorRms * VOICE_TO_NOISE_RATIO
    ),
    exitThresholdRms: Math.max(
      MIN_VOICE_EXIT_RMS,
      initialNoiseFloorRms * VOICE_EXIT_TO_NOISE_RATIO
    )
  };
  let voiced = false;
  let hangoverFrames = 0;

  const percentile = (values: number[], fraction: number): number => {
    if (values.length === 0) return initialNoiseFloorRms;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
    ];
  };

  return {
    derive(samples, sampleRate) {
      const rms = calculateRms(samples);
      const pitch = estimatePitch(samples, sampleRate);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      const clipped = peak >= 0.98;
      const hasPitch =
        pitch.hz !== null &&
        pitch.confidence >= MIN_PITCH_CORRELATION;

      if (!voiced) {
        voiced = rms >= calibration.entryThresholdRms && hasPitch;
        hangoverFrames = voiced ? SPEECH_HANGOVER_FRAMES : 0;
      } else if (rms >= calibration.exitThresholdRms) {
        hangoverFrames = SPEECH_HANGOVER_FRAMES;
      } else if (hangoverFrames > 0) {
        hangoverFrames -= 1;
      } else {
        voiced = false;
      }

      const safeNoiseFloor = Math.max(noiseFloorRms, 0.0001);
      const feature: DerivedAudioFeature = {
        rms,
        pitchHz: pitch.hz,
        pitchConfidence: pitch.confidence,
        voiced,
        clipped,
        snrDb:
          rms === 0
            ? 0
            : Math.max(0, 20 * Math.log10(rms / safeNoiseFloor))
      };

      if (!voiced && rms > 0 && !clipped) {
        const cappedSample = Math.min(
          rms,
          Math.max(MIN_VOICE_ENTRY_RMS, noiseFloorRms * 1.5)
        );
        noiseFloorRms = Math.max(
          0.0005,
          noiseFloorRms * 0.94 + cappedSample * 0.06
        );
      }
      return feature;
    },
    reset() {
      noiseFloorRms = calibration.medianNoiseRms;
      voiced = false;
      hangoverFrames = 0;
    },
    getNoiseFloorRms() {
      return noiseFloorRms;
    },
    calibrate(noiseRmsSamples) {
      const usable = noiseRmsSamples.filter(
        (value) => Number.isFinite(value) && value >= 0
      );
      const medianNoiseRms = percentile(usable, 0.5);
      const noiseP90Rms = percentile(usable, 0.9);
      noiseFloorRms = Math.max(0.0005, medianNoiseRms);
      calibration = {
        medianNoiseRms: noiseFloorRms,
        noiseP90Rms,
        entryThresholdRms: Math.max(
          MIN_VOICE_ENTRY_RMS,
          noiseP90Rms * VOICE_TO_NOISE_RATIO
        ),
        exitThresholdRms: Math.max(
          MIN_VOICE_EXIT_RMS,
          noiseP90Rms * VOICE_EXIT_TO_NOISE_RATIO
        )
      };
      voiced = false;
      hangoverFrames = 0;
      return { ...calibration };
    },
    getCalibration() {
      return { ...calibration };
    }
  };
}
