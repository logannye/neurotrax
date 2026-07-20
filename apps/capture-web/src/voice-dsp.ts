export interface VoiceWindowAnalysis {
  rms: number;
  intensityDbfs: number;
  dcOffset: number;
  clippedSampleFraction: number;
  f0Hz: number | null;
  f0Confidence: number;
  estimatorAgreement: number;
  periodicity: number;
  cppsDb: number | null;
  hnrDb: number | null;
  jitterLocal: number | null;
  shimmerLocal: number | null;
  spectralFlux: number;
  formantF1Hz: number | null;
  formantF2Hz: number | null;
}

export class BoundedPcmRingBuffer {
  readonly capacity: number;
  private readonly samples: Float32Array;
  private writeIndex = 0;
  private size = 0;

  constructor(capacitySamples: number) {
    if (!Number.isInteger(capacitySamples) || capacitySamples <= 0) {
      throw new Error("Ring-buffer capacity must be a positive integer.");
    }
    this.capacity = capacitySamples;
    this.samples = new Float32Array(capacitySamples);
  }

  clear(): void {
    this.samples.fill(0);
    this.writeIndex = 0;
    this.size = 0;
  }

  push(block: Float32Array): void {
    for (const sample of block) {
      this.samples[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.size = Math.min(this.capacity, this.size + 1);
    }
  }

  availableSamples(): number {
    return this.size;
  }

  latest(count: number): Float32Array | null {
    return this.endingBeforeLatest(count, 0);
  }

  endingBeforeLatest(
    count: number,
    trailingSampleCount: number
  ): Float32Array | null {
    if (
      count <= 0 ||
      trailingSampleCount < 0 ||
      count + trailingSampleCount > this.size
    ) {
      return null;
    }
    const result = new Float32Array(count);
    let index =
      (
        this.writeIndex -
        trailingSampleCount -
        count +
        this.capacity * 2
      ) % this.capacity;
    for (let offset = 0; offset < count; offset += 1) {
      result[offset] = this.samples[index];
      index = (index + 1) % this.capacity;
    }
    return result;
  }
}

export function calculateRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function downsample(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number
): Float32Array {
  if (sourceRate <= targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const result = new Float32Array(
    Math.max(1, Math.floor(samples.length / ratio))
  );
  for (let index = 0; index < result.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(
      samples.length,
      Math.max(start + 1, Math.floor((index + 1) * ratio))
    );
    let sum = 0;
    for (let source = start; source < end; source += 1) {
      sum += samples[source];
    }
    result[index] = sum / Math.max(1, end - start);
  }
  return result;
}

interface PitchCandidate {
  hz: number | null;
  confidence: number;
}

function autocorrelationPitch(
  samples: Float32Array,
  sampleRate: number
): PitchCandidate {
  const minLag = Math.max(1, Math.floor(sampleRate / 700));
  const maxLag = Math.min(
    samples.length - 2,
    Math.ceil(sampleRate / 50)
  );
  let bestLag = 0;
  let best = Number.NEGATIVE_INFINITY;
  const correlations: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let cross = 0;
    let energyA = 0;
    let energyB = 0;
    for (let index = 0; index < samples.length - lag; index += 1) {
      const a = samples[index];
      const b = samples[index + lag];
      cross += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    const correlation =
      cross / Math.max(1e-12, Math.sqrt(energyA * energyB));
    correlations[lag] = correlation;
    if (correlation > best) {
      best = correlation;
      bestLag = lag;
    }
  }
  if (
    correlations[minLag] >= best * 0.92 &&
    correlations[minLag] >= correlations[minLag + 1]
  ) {
    bestLag = minLag;
    best = correlations[minLag];
  }
  for (let lag = minLag + 1; lag < maxLag && bestLag !== minLag; lag += 1) {
    if (
      correlations[lag] >= best * 0.92 &&
      correlations[lag] >= correlations[lag - 1] &&
      correlations[lag] >= correlations[lag + 1]
    ) {
      bestLag = lag;
      best = correlations[lag];
      break;
    }
  }
  if (bestLag === 0 || best < 0.35) {
    return { hz: null, confidence: Math.max(0, best) };
  }
  return {
    hz: sampleRate / bestLag,
    confidence: Math.min(1, Math.max(0, best))
  };
}

function amdfPitch(
  samples: Float32Array,
  sampleRate: number
): PitchCandidate {
  const minLag = Math.max(1, Math.floor(sampleRate / 700));
  const maxLag = Math.min(
    samples.length - 2,
    Math.ceil(sampleRate / 50)
  );
  let bestLag = 0;
  let best = Number.POSITIVE_INFINITY;
  let meanDifference = 0;
  let count = 0;
  const differences: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let difference = 0;
    for (let index = 0; index < samples.length - lag; index += 1) {
      difference += Math.abs(samples[index] - samples[index + lag]);
    }
    difference /= Math.max(1, samples.length - lag);
    differences[lag] = difference;
    meanDifference += difference;
    count += 1;
    if (difference < best) {
      best = difference;
      bestLag = lag;
    }
  }
  const baseline = meanDifference / Math.max(1, count);
  if (
    differences[minLag] <= best + baseline * 0.08 &&
    differences[minLag] <= differences[minLag + 1]
  ) {
    bestLag = minLag;
    best = differences[minLag];
  }
  for (let lag = minLag + 1; lag < maxLag && bestLag !== minLag; lag += 1) {
    if (
      differences[lag] <= best + baseline * 0.08 &&
      differences[lag] <= differences[lag - 1] &&
      differences[lag] <= differences[lag + 1]
    ) {
      bestLag = lag;
      best = differences[lag];
      break;
    }
  }
  const confidence =
    baseline <= 1e-9 ? 0 : Math.max(0, 1 - best / baseline);
  if (bestLag === 0 || confidence < 0.2) {
    return { hz: null, confidence };
  }
  return { hz: sampleRate / bestLag, confidence };
}

function zeroCrossingPitch(
  samples: Float32Array,
  sampleRate: number
): PitchCandidate {
  const crossings: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index - 1] <= 0 && samples[index] > 0) {
      const span = samples[index] - samples[index - 1];
      crossings.push(
        index - 1 + (span === 0 ? 0 : -samples[index - 1] / span)
      );
    }
  }
  if (crossings.length < 2) return { hz: null, confidence: 0 };
  const periods = crossings
    .slice(1)
    .map((crossing, index) => crossing - crossings[index])
    .filter((period) => period > 0);
  const sorted = [...periods].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  const hz = sampleRate / median;
  const mean =
    periods.reduce((sum, period) => sum + period, 0) /
    Math.max(1, periods.length);
  const deviation = Math.sqrt(
    periods.reduce(
      (sum, period) => sum + (period - mean) ** 2,
      0
    ) / Math.max(1, periods.length)
  );
  const confidence = Math.max(0, 1 - deviation / Math.max(1, mean));
  // Keep a narrow numerical margin around the configured search bounds; the
  // final estimator pair still constrains the reported value.
  if (hz < 48 || hz > 720 || confidence < 0.6) {
    return { hz: null, confidence };
  }
  return { hz, confidence };
}

function cyclePerturbation(
  samples: Float32Array,
  sampleRate: number,
  f0Hz: number | null
): { jitterLocal: number | null; shimmerLocal: number | null } {
  if (f0Hz === null) {
    return { jitterLocal: null, shimmerLocal: null };
  }
  const crossings: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index - 1] <= 0 && samples[index] > 0) {
      const span = samples[index] - samples[index - 1];
      crossings.push(
        index - 1 + (span === 0 ? 0 : -samples[index - 1] / span)
      );
    }
  }
  const periods = crossings
    .slice(1)
    .map((crossing, index) => (crossing - crossings[index]) / sampleRate)
    .filter((period) => {
      const expected = 1 / f0Hz;
      return period >= expected * 0.6 && period <= expected * 1.6;
    });
  const amplitudes: number[] = [];
  for (let index = 0; index < crossings.length - 1; index += 1) {
    const start = Math.max(0, Math.ceil(crossings[index]));
    const end = Math.min(
      samples.length,
      Math.floor(crossings[index + 1])
    );
    if (end <= start) continue;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (let sample = start; sample <= end; sample += 1) {
      minimum = Math.min(minimum, samples[sample]);
      maximum = Math.max(maximum, samples[sample]);
    }
    const amplitude = maximum - minimum;
    if (Number.isFinite(amplitude) && amplitude > 1e-6) {
      amplitudes.push(amplitude);
    }
  }
  const local = (values: number[]): number | null => {
    if (values.length < 3) return null;
    const mean =
      values.reduce((sum, value) => sum + value, 0) / values.length;
    if (mean <= 0) return null;
    const differences = values
      .slice(1)
      .map((value, index) => Math.abs(value - values[index]));
    return (
      differences.reduce((sum, value) => sum + value, 0) /
      differences.length /
      mean
    );
  };
  return {
    jitterLocal: local(periods),
    shimmerLocal: local(amplitudes)
  };
}

function resolvePitch(
  autocorrelation: PitchCandidate,
  amdf: PitchCandidate,
  zeroCrossing: PitchCandidate
): {
  hz: number | null;
  confidence: number;
  agreement: number;
  periodicity: number;
} {
  if (autocorrelation.hz === null || amdf.hz === null) {
    return {
      hz: null,
      confidence: Math.min(
        autocorrelation.confidence,
        amdf.confidence
      ),
      agreement: 0,
      periodicity: autocorrelation.confidence
    };
  }
  const ratio = Math.max(
    autocorrelation.hz,
    amdf.hz
  ) / Math.min(autocorrelation.hz, amdf.hz);
  const octaveRelated =
    Math.abs(ratio - 2) <= 0.12 ||
    Math.abs(ratio - 0.5) <= 0.06;
  const relativeDifference =
    Math.abs(autocorrelation.hz - amdf.hz) /
    Math.max(autocorrelation.hz, amdf.hz);
  // At the upper end of the supported range, one downsampled lag is a
  // meaningful fraction of a pitch period (700 Hz is roughly 11.4 samples at
  // 8 kHz). Permit the two independent estimators to land on adjacent lags,
  // while continuing to reject octave-related and materially divergent
  // candidates.
  if (octaveRelated && zeroCrossing.hz !== null) {
    const candidates = [autocorrelation, amdf].filter(
      (candidate) =>
        candidate.hz !== null &&
        Math.abs(candidate.hz - zeroCrossing.hz!) /
          Math.max(candidate.hz, zeroCrossing.hz!) <=
          0.12
    );
    if (candidates.length === 1) {
      const selected = candidates[0];
      return {
        hz: (selected.hz! + zeroCrossing.hz) / 2,
        confidence: Math.min(
          selected.confidence,
          zeroCrossing.confidence
        ),
        agreement: 0.8,
        periodicity: autocorrelation.confidence
      };
    }
  }
  if (relativeDifference > 0.12 || octaveRelated) {
    return {
      hz: null,
      confidence: Math.min(
        autocorrelation.confidence,
        amdf.confidence
      ),
      agreement: Math.max(0, 1 - relativeDifference),
      periodicity: autocorrelation.confidence
    };
  }
  return {
    hz: (autocorrelation.hz + amdf.hz) / 2,
    confidence: Math.min(
      autocorrelation.confidence,
      amdf.confidence
    ),
    agreement: Math.max(0, 1 - relativeDifference / 0.3),
    periodicity: autocorrelation.confidence
  };
}

function bandEnergies(
  samples: Float32Array,
  bands = 16
): number[] {
  const result = new Array<number>(bands).fill(0);
  for (let band = 0; band < bands; band += 1) {
    const frequency =
      ((band + 1) / (bands + 1)) * Math.PI;
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const angle = frequency * index;
      real += samples[index] * Math.cos(angle);
      imaginary -= samples[index] * Math.sin(angle);
    }
    result[band] =
      (real * real + imaginary * imaginary) /
      Math.max(1, samples.length);
  }
  return result;
}

function fft(
  real: Float64Array,
  imaginary: Float64Array,
  inverse = false
): void {
  const size = real.length;
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [
        real[reversed],
        real[index]
      ];
      [imaginary[index], imaginary[reversed]] = [
        imaginary[reversed],
        imaginary[index]
      ];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle =
      ((inverse ? 2 : -2) * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let index = 0; index < length / 2; index += 1) {
        const even = offset + index;
        const odd = even + length / 2;
        const oddReal =
          real[odd] * twiddleReal -
          imaginary[odd] * twiddleImaginary;
        const oddImaginary =
          real[odd] * twiddleImaginary +
          imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal =
          twiddleReal * stepReal -
          twiddleImaginary * stepImaginary;
        twiddleImaginary =
          twiddleReal * stepImaginary +
          twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      real[index] /= size;
      imaginary[index] /= size;
    }
  }
}

function cepstralPeakProminence(
  samples: Float32Array,
  sampleRate: number,
  f0Hz: number | null
): number | null {
  if (f0Hz === null || samples.length < 32) return null;
  let size = 1;
  while (size < samples.length) size <<= 1;
  const real = new Float64Array(size);
  const imaginary = new Float64Array(size);
  for (let index = 0; index < samples.length; index += 1) {
    const hann =
      samples.length === 1
        ? 1
        : 0.5 -
          0.5 *
            Math.cos(
              (2 * Math.PI * index) / (samples.length - 1)
            );
    real[index] = samples[index] * hann;
  }
  fft(real, imaginary);
  for (let index = 0; index < size; index += 1) {
    const logPower = Math.log(
      Math.max(
        1e-18,
        real[index] * real[index] +
          imaginary[index] * imaginary[index]
      )
    );
    real[index] = logPower;
    imaginary[index] = 0;
  }
  fft(real, imaginary, true);

  const minimumLag = Math.max(1, Math.floor(sampleRate / 700));
  const maximumLag = Math.min(
    Math.ceil(sampleRate / 50),
    Math.floor(size / 2) - 1
  );
  const expectedLag = sampleRate / f0Hz;
  const searchStart = Math.max(
    minimumLag,
    Math.floor(expectedLag * 0.8)
  );
  const searchEnd = Math.min(
    maximumLag,
    Math.ceil(expectedLag * 1.2)
  );
  if (searchEnd <= searchStart) return null;

  const cepstrumDb = new Float64Array(maximumLag + 1);
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    cepstrumDb[lag] =
      20 * Math.log10(Math.max(1e-12, Math.abs(real[lag])));
  }
  let peakLag = searchStart;
  for (let lag = searchStart + 1; lag <= searchEnd; lag += 1) {
    if (cepstrumDb[lag] > cepstrumDb[peakLag]) peakLag = lag;
  }

  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let lag = minimumLag; lag <= maximumLag; lag += 1) {
    if (Math.abs(lag - peakLag) <= 2) continue;
    const x = lag / sampleRate;
    const y = cepstrumDb[lag];
    count += 1;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const denominator = count * sumXX - sumX * sumX;
  if (count < 2 || Math.abs(denominator) < 1e-12) return null;
  const slope = (count * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / count;
  const baseline = intercept + slope * (peakLag / sampleRate);
  const prominence = cepstrumDb[peakLag] - baseline;
  return Number.isFinite(prominence)
    ? Math.max(0, prominence)
    : null;
}

function levinsonDurbin(
  autocorrelation: number[],
  order: number
): number[] | null {
  if (autocorrelation[0] <= 1e-12) return null;
  const coefficients = new Array<number>(order + 1).fill(0);
  coefficients[0] = 1;
  let error = autocorrelation[0];
  for (let index = 1; index <= order; index += 1) {
    let sum = 0;
    for (let j = 1; j < index; j += 1) {
      sum += coefficients[j] * autocorrelation[index - j];
    }
    const reflection = -(autocorrelation[index] + sum) / error;
    const prior = [...coefficients];
    coefficients[index] = reflection;
    for (let j = 1; j < index; j += 1) {
      coefficients[j] =
        prior[j] + reflection * prior[index - j];
    }
    error *= 1 - reflection * reflection;
    if (!Number.isFinite(error) || error <= 1e-12) return null;
  }
  return coefficients;
}

function estimateFormants(
  input: Float32Array,
  sampleRate: number
): [number | null, number | null] {
  const source = downsample(input, sampleRate, 16_000);
  const emphasized = new Float32Array(source.length);
  for (let index = 1; index < source.length; index += 1) {
    emphasized[index] = source[index] - 0.97 * source[index - 1];
  }
  const order = 12;
  const autocorrelation = new Array<number>(order + 1).fill(0);
  for (let lag = 0; lag <= order; lag += 1) {
    for (
      let index = 0;
      index < emphasized.length - lag;
      index += 1
    ) {
      autocorrelation[lag] +=
        emphasized[index] * emphasized[index + lag];
    }
  }
  const coefficients = levinsonDurbin(autocorrelation, order);
  if (!coefficients) return [null, null];

  const response: Array<{ hz: number; power: number }> = [];
  for (let hz = 150; hz <= 4_000; hz += 25) {
    const omega = (2 * Math.PI * hz) / 16_000;
    let real = 1;
    let imaginary = 0;
    for (let index = 1; index < coefficients.length; index += 1) {
      real += coefficients[index] * Math.cos(-omega * index);
      imaginary += coefficients[index] * Math.sin(-omega * index);
    }
    response.push({
      hz,
      power: 1 / Math.max(1e-12, real * real + imaginary * imaginary)
    });
  }
  const peaks = response
    .flatMap((point, index) => {
      if (
        index === 0 ||
        index === response.length - 1 ||
        point.power <= response[index - 1].power ||
        point.power <= response[index + 1].power
      ) {
        return [];
      }
      const halfPower = point.power / 2;
      let left = index;
      let right = index;
      while (left > 0 && response[left].power > halfPower) left -= 1;
      while (
        right < response.length - 1 &&
        response[right].power > halfPower
      ) {
        right += 1;
      }
      const bandwidthHz = response[right].hz - response[left].hz;
      return bandwidthHz >= 25 && bandwidthHz <= 700
        ? [{ ...point, bandwidthHz }]
        : [];
    })
    .sort((left, right) => left.hz - right.hz);
  const f1 = peaks.find(
    (peak) => peak.hz >= 200 && peak.hz <= 1_200
  )?.hz;
  const f2 = peaks.find(
    (peak) =>
      peak.hz >= Math.max(700, (f1 ?? 0) + 250) &&
      peak.hz <= 3_500
  )?.hz;
  return [f1 ?? null, f2 ?? null];
}

export function analyzeVoiceWindow(
  samples: Float32Array,
  sampleRate: number,
  priorBandEnergies: readonly number[] | null
): VoiceWindowAnalysis & { bandEnergies: number[] } {
  let mean = 0;
  let clipped = 0;
  for (const sample of samples) {
    mean += sample;
    if (Math.abs(sample) >= 0.98) clipped += 1;
  }
  mean /= Math.max(1, samples.length);
  const centered = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    centered[index] = samples[index] - mean;
  }
  const rms = calculateRms(centered);
  const pitchInput = downsample(centered, sampleRate, 8_000);
  const autocorrelation = autocorrelationPitch(pitchInput, 8_000);
  const amdf = amdfPitch(pitchInput, 8_000);
  const zeroCrossing = zeroCrossingPitch(pitchInput, 8_000);
  const pitch = resolvePitch(autocorrelation, amdf, zeroCrossing);
  const perturbation = cyclePerturbation(
    pitchInput,
    8_000,
    pitch.hz
  );
  const currentBands = bandEnergies(pitchInput);
  const spectralFlux =
    priorBandEnergies === null
      ? 0
      : Math.sqrt(
          currentBands.reduce((sum, energy, index) => {
            const prior = priorBandEnergies[index] ?? 0;
            const delta =
              Math.log1p(energy) - Math.log1p(prior);
            return sum + Math.max(0, delta) ** 2;
          }, 0) / currentBands.length
        );
  const harmonicRatio = Math.min(0.999, Math.max(0, pitch.periodicity));
  const hnrDb =
    pitch.hz === null
      ? null
      : 10 *
        Math.log10(
          Math.max(1e-6, harmonicRatio) /
            Math.max(1e-6, 1 - harmonicRatio)
        );
  const cppsDb = cepstralPeakProminence(
    pitchInput,
    8_000,
    pitch.hz
  );
  const [formantF1Hz, formantF2Hz] =
    pitch.hz === null
      ? [null, null]
      : estimateFormants(centered, sampleRate);
  return {
    rms,
    intensityDbfs: 20 * Math.log10(Math.max(1e-8, rms)),
    dcOffset: mean,
    clippedSampleFraction: clipped / Math.max(1, samples.length),
    f0Hz: pitch.hz,
    f0Confidence: pitch.confidence,
    estimatorAgreement: pitch.agreement,
    periodicity: pitch.periodicity,
    cppsDb,
    hnrDb,
    jitterLocal: perturbation.jitterLocal,
    shimmerLocal: perturbation.shimmerLocal,
    spectralFlux,
    formantF1Hz,
    formantF2Hz,
    bandEnergies: currentBands
  };
}
