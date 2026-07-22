# Voice measurement foundation

## Active ambient pipeline

The shipping browser requests one unprocessed mono microphone stream at 48 kHz
with echo cancellation, noise suppression, and automatic gain control disabled.
An AudioWorklet emits 20 ms PCM blocks to a worker. The worker uses a bounded
two-second ring, 40 ms analysis windows, and a 10 ms hop.

PCM remains inside the worklet/worker boundary. The worker emits only
`VoiceSignalFrameV1` values containing timing, activity, periodicity, compact
pitch estimates, nucleus events, quality facts, track identity, and processor
provenance.

The ambient extractor produces exactly seven metrics:

- median F0 and F0 variability;
- speech-activity fraction;
- pause rate and median pause duration;
- median speech-run duration; and
- acoustic nucleus rate estimate.

Each metric requires its configured duration, coverage, segment/event count,
sample rate, SNR, clipping, DC offset, continuity, and estimator quality. A
failed requirement returns a specific abstention rather than zero or an
imputed value.

There are no sustained-vowel, reading, rapid-syllable, or other guided tasks in
the active browser workflow.

## Forbidden outputs

PCM, waveforms, spectral arrays, pitch cycles, cepstra, MFCCs, formant tracks,
spectrograms, transcripts, embeddings, voiceprints, and microphone identifiers
must not enter ObservationV3, reports, or the event journal.

## Optional WavLM research service

`services/voice-inference` retains the earlier loopback FastAPI adapter for
isolated research. It is disabled unless `PHENOMETRIC_WAVLM_ENABLED=1`, uses a
pinned local-only model revision and weight digest, and returns only layer
mean/standard-deviation summaries plus processor provenance.

The current browser has no client for this endpoint. WavLM summaries do not
enter active measurements, evidence, reports, or trajectory.
