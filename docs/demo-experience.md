# Live demonstration experience

The current demonstration is one ambient local session. It contains no guided
exercise sequence or operator-only synthetic capture mode.

## 1. Welcome and consent

The opening page states that the application is a nonclinical prototype, uses
local processing, saves no recording, and does not verify identity or provide
clinical interpretation. The setup button remains disabled until consent and
the local-participant assertion are checked.

## 2. Independent setup

The browser requests microphone and camera separately. Each lane displays its
own requesting, calibrating, ready, or not-measurable state. A camera failure
does not invalidate a usable voice lane, and vice versa.

Audio calibration asks for a brief quiet moment. Face calibration asks for one
well-lit, frontal face. Setup is bounded to 15 seconds.

## 3. Ambient session

When at least one lane qualifies—or a capture-capable lane reaches the bounded
setup timeout—the interface switches to **Ambient session**. The participant
continues the ordinary conversation without prompts. The session ends manually
or at five minutes.

When one face is visible, the camera preview shows all 478 MediaPipe landmarks,
the full tessellation, and the eye, iris, brow, lip, and face-oval contours.
This mesh is drawn inside the face worker, follows the mirrored preview, and is
never retained or returned as landmark coordinates.

The panel beside the video shows an eight-second rolling energy and periodic
pitch display plus current level, pitch, SNR, F0 confidence, estimator
agreement, activity state, and signal-quality codes. These are presentation
views of existing derived frames, not provisional report metrics. Nonperiodic
speech or noise moves the energy trace while leaving a gap in the pitch trace.

## 4. Local finalization

The interface explicitly shows that devices and processors are being stopped.
Only after disposal does it build the ObservationV3 and report.

## 5. Report

The report has eight sections and 16 metric outcomes. Each metric is a measured
engineering value or `Not measurable`, with technical evidence and provenance
details. It states that results are not identity-verified, clinically
validated, longitudinally comparable, or intended for medical decisions.

There is no narrative generation, approval/dismissal control, persistence,
export, or baseline creation.

## Honest failure demonstrations

- Deny one device and show that the other lane continues.
- Deny both devices and show that no report is created.
- End a short session and show specific reason-coded abstentions.
- Discard mid-session (the in-session consent-withdrawal path) and show that
  devices turn off without a report.
- Reset after a report and show that session memory is cleared.
- Make voiced sound, unvoiced sound, and background noise and show the live
  voice state and traces changing without creating a recording.
- Move within the camera frame and show the dense mesh tracking one face; add a
  second face and show the presentation clearing rather than choosing an
  identity.
