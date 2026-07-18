export interface DerivedAudioFeature {
  rms: number;
  pitchHz: number | null;
  voiced: boolean;
  clipped: boolean;
  snrDb: number;
}

export const MIN_VOICE_RMS = 0.012;
export const VOICE_TO_NOISE_RATIO = 2.5;
export const VOICE_EXIT_TO_NOISE_RATIO = 1.7;
const MIN_PITCH_HZ = 70;
const MAX_PITCH_HZ = 350;
const MIN_PITCH_CORRELATION = 0.55;

export function calculateRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;

  let sumOfSquares = 0;
  for (const sample of samples) {
    sumOfSquares += sample * sample;
  }
  return Math.sqrt(sumOfSquares / samples.length);
}

export function estimatePitchHz(
  samples: Float32Array,
  sampleRate: number
): number | null {
  if (samples.length < 2 || calculateRms(samples) < MIN_VOICE_RMS) return null;

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

  if (bestLag === 0 || bestCorrelation < MIN_PITCH_CORRELATION) return null;
  return sampleRate / bestLag;
}

export function deriveAudioFeature(
  samples: Float32Array,
  sampleRate: number,
  noiseFloorRms: number,
  currentlyVoiced = false
): DerivedAudioFeature {
  const rms = calculateRms(samples);
  const pitchHz = estimatePitchHz(samples, sampleRate);
  const voiceThreshold = Math.max(
    currentlyVoiced ? MIN_VOICE_RMS * 0.72 : MIN_VOICE_RMS,
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
    pitchHz,
    voiced: rms >= voiceThreshold,
    clipped: peak >= 0.98,
    snrDb
  };
}

export interface VoiceActivityTracker {
  derive(samples: Float32Array, sampleRate: number): DerivedAudioFeature;
  reset(): void;
  getNoiseFloorRms(): number;
}

export function createVoiceActivityTracker(
  initialNoiseFloorRms = 0.006
): VoiceActivityTracker {
  let noiseFloorRms = initialNoiseFloorRms;
  let voiced = false;

  return {
    derive(samples, sampleRate) {
      const feature = deriveAudioFeature(
        samples,
        sampleRate,
        noiseFloorRms,
        voiced
      );
      voiced = feature.voiced;
      if (!feature.voiced && feature.rms > 0 && !feature.clipped) {
        const cappedSample = Math.min(
          feature.rms,
          Math.max(MIN_VOICE_RMS, noiseFloorRms * 1.5)
        );
        noiseFloorRms = Math.max(
          0.0005,
          noiseFloorRms * 0.94 + cappedSample * 0.06
        );
      }
      return feature;
    },
    reset() {
      noiseFloorRms = initialNoiseFloorRms;
      voiced = false;
    },
    getNoiseFloorRms() {
      return noiseFloorRms;
    }
  };
}
