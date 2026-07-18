# Face Landmarker model

`face_landmarker.task` is the official MediaPipe Face Landmarker float16 task
bundle downloaded from:

`https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`

It is used locally by the browser worker and is not patient data or captured
media. MediaPipe Tasks code is distributed under the Apache License 2.0; retain
upstream notices when redistributing the model bundle.

Reviewed SHA-256:

```text
64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff
```

The sibling `public/mediapipe` directory contains the WASM files copied from
the pinned `@mediapipe/tasks-vision@0.10.35` package so live facial inference
does not depend on a runtime CDN.
