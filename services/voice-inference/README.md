# Voice representation sidecar

This optional Python 3.11 service exposes transient WavLM Large layer summaries
for research adapter development. It binds to loopback, is disabled by default,
does not log request bodies, and retains neither audio nor embeddings.

```bash
uv sync --extra dev
uv run --extra dev pytest
```

For a manual real-model smoke, install the optional checkpoint runtime and
place the pinned `microsoft/wavlm-large` revision in the local Hugging Face
cache. Start the service in one terminal:

```bash
PHENOMETRIC_WAVLM_ENABLED=1 uv run --extra wavlm \
  uvicorn phenometric_voice.app:app --host 127.0.0.1 --port 8765 --no-access-log
```

Then run generated-audio smoke in a second terminal:

```bash
uv run python -m phenometric_voice.manual_smoke
```

The browser endpoint is
`http://127.0.0.1:8765/v1/voice/representations`. Do not bind the milestone
service to a non-loopback interface. The service accepts no file paths or URLs,
does not write audio, and returns only layer mean/std summaries plus processor
provenance.

Enable the otherwise-disabled browser adapter when launching the root demo:

```bash
VITE_VOICE_REPRESENTATION_ENDPOINT=http://127.0.0.1:8765/v1/voice/representations pnpm dev
```

The pinned model revision is
`c1423ed94bb01d80a3f5ce5bc39f6026a0f4828c`; the reviewed
`pytorch_model.bin` SHA-256 is
`fdee460e529396ddb2f8c8e8ce0ad74cfb747b726bc6f612e666c7c1e1963c9d`.
