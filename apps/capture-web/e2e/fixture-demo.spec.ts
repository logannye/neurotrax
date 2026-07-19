import { expect, test, type Page } from "@playwright/test";

const boundary =
  "For clinician review. This summary does not provide a diagnosis or treatment recommendation.";
const forbiddenSerializedData =
  /deviceId|deviceLabel|faceLandmarks|landmarks|meshConnections|overlayPixels|offscreenCanvas|screenshot|blendshapes|transformationMatrix|bitmap|mediaStream/i;

async function expectCleanPresentationCopy(page: Page): Promise<void> {
  const body = (await page.locator("body").innerText()).toLowerCase();
  for (const forbidden of [
    "synthetic",
    "prototype",
    "gpt",
    "openai",
    "api key",
    "worker",
    "adapter version",
    "speech-acoustic",
    "facial-expressivity",
    "simulated",
    "fixture",
    "limited",
    "insufficient",
    "unavailable",
    "withheld",
    "abstention",
    "not confirmed",
    "timed",
    "deterministic"
  ]) {
    expect(body).not.toContain(forbidden);
  }
}

async function installReadinessMock(page: Page): Promise<void> {
  await page.route("**/api/model-readiness", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ready: true,
        model: "service-ready",
        credentialSource: "browser-test"
      })
    });
  });
}

async function installEvidenceMock(
  page: Page,
  onEvidenceRequest?: () => void
): Promise<void> {
  await installReadinessMock(page);
  await page.route("**/api/evidence-card", async (route) => {
    onEvidenceRequest?.();
    const payload = route.request().postDataJSON() as {
      containsPHI: boolean;
      rawMediaRetained: boolean;
      nativeVisualObservationsRetained: boolean;
      outcomes: Array<{
        outcomeId: string;
        label: string;
        modality: "speech" | "face";
        status: "measured" | "withheld";
        statement: string;
      }>;
    };
    expect(payload.containsPHI).toBe(false);
    expect(payload.rawMediaRetained).toBe(false);
    expect(payload.nativeVisualObservationsRetained).toBe(false);
    expect(JSON.stringify(payload)).not.toMatch(forbiddenSerializedData);
    expect(payload.outcomes).toHaveLength(2);
    expect(
      new Set(payload.outcomes.map((outcome) => outcome.modality)).size
    ).toBe(2);
    const reportable = payload.outcomes.filter(
      (outcome) => outcome.status === "measured"
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        draft: {
          headline: "Two encounter signals are ready for review",
          summary:
            reportable.length === 2
              ? "Pitch variability and bilateral facial task measurements were captured during technically usable portions of the encounter."
              : `${reportable[0]?.label ?? "No audiovisual metric"} was included in the encounter report.`,
          claims: reportable.map((outcome) => ({
            claimId: outcome.outcomeId,
            modality: outcome.modality,
            status: outcome.status,
            statement: outcome.statement
          })),
          boundaryStatement: boundary
        },
        grounding: {
          status: "pass",
          errors: [],
          groundedClaimIds: reportable.map(
            (outcome) => outcome.outcomeId
          )
        },
        model: "service-response",
        promptVersion: "test-contract",
        responseId: "test-response",
        attemptCount: 1,
        timing: {
          totalMs: 120,
          modelMs: 116,
          validationMs: 1
        }
      })
    });
  });
}

async function runGuidedCapture(
  page: Page,
  scenario = "hero"
): Promise<void> {
  await installEvidenceMock(page);
  await page.goto(`/?testCapture=1&fast=1&scenario=${scenario}`);
  await expect(page.locator("#face-lane-state")).toHaveText("Ready");
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await expect(page.locator("#start-button")).toHaveText("Begin assessment");
  await page.locator("#start-button").click();
  await expect(
    page.locator('[data-milestone="withheld"]')
  ).toHaveClass(/is-complete/);
  await expect(
    page.locator('[data-milestone="neutral"]')
  ).toHaveClass(/is-complete/);
  await expect(
    page.locator('[data-milestone="smile"]')
  ).toHaveClass(/is-complete/);
  await expect(
    page.locator('[data-milestone="eye-closure"]')
  ).toHaveClass(/is-complete/);
  await expect(page.locator("#results-panel")).toBeVisible({
    timeout: 10_000
  });
  await expect(page.locator("#evidence-card")).toBeVisible();
  await expect(page.locator(".evidence-claim")).toHaveCount(2);
  await expect(page.locator("#evidence-status-chip")).toContainText(
    "grounded"
  );
}

test("loads the local facial analysis and keeps presentation copy clean", async ({
  page
}) => {
  await installReadinessMock(page);
  await page.goto("/");
  await expect(page.locator("#face-lane-state")).toHaveText("Ready", {
    timeout: 15_000
  });
  await expect(page.locator("#page-title")).toHaveText(
    "Ambient face and voice measurement"
  );
  await expectCleanPresentationCopy(page);
});

test("runs local visual worker inference on a generated blank bitmap", async ({
  page
}) => {
  await installReadinessMock(page);
  await page.goto("/?visualWorkerSmoke=1&operator=1");
  await expect(page.locator("body")).toHaveAttribute(
    "data-visual-worker-smoke",
    "complete",
    { timeout: 15_000 }
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-visual-worker-smoke-face",
    "not-visible"
  );
  const diagnostics = JSON.parse(
    (await page.locator("#operator-output").textContent()) ?? "{}"
  ) as {
    visualPipeline: {
      mediaPipeVersion: string;
      modelSha256: string;
      delegate: string;
    };
    videoCaptureSettings: {
      requested: { width: number; height: number; frameRate: number };
    };
    latestVisualResult: {
      analyzedFrameRate: number;
      interResultGapMs: number | null;
      processingLatencyMs: number;
    };
  };
  expect(diagnostics.visualPipeline.mediaPipeVersion).toBe("0.10.35");
  expect(diagnostics.visualPipeline.modelSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(["GPU", "CPU"]).toContain(diagnostics.visualPipeline.delegate);
  expect(diagnostics.videoCaptureSettings.requested).toEqual({
    width: 1280,
    height: 720,
    frameRate: 30
  });
  expect(diagnostics.latestVisualResult.analyzedFrameRate).toBe(0);
  expect(diagnostics.latestVisualResult.interResultGapMs).toBeNull();
  expect(diagnostics.latestVisualResult.processingLatencyMs).toBeGreaterThanOrEqual(
    0
  );
  expect(JSON.stringify(diagnostics)).not.toMatch(
    forbiddenSerializedData
  );
});

test("keeps the opening focused and reports device privacy accurately", async ({
  page
}) => {
  await installReadinessMock(page);
  await page.goto("/?testCapture=1&fast=1");
  await expect(page.locator("#header-privacy-state")).toContainText(
    "Devices off"
  );
  await expect(page.locator("button:visible")).toHaveCount(1);
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await expect(page.locator("#header-privacy-state")).toContainText(
    "Processing in session"
  );
  await expect(page.locator("#start-button")).toHaveText("Begin assessment");
  await expect(page.locator("#conductor-status")).toHaveText(
    "Ready to begin."
  );
  await expect(page.locator("button:visible")).toHaveCount(1);
  await expect(page.locator(".signal-meta").first()).toBeHidden();
  await expect(page.locator(".meter-track").first()).toBeHidden();
  await expect(page.locator("#speech-signal-caption")).toHaveText(
    "Analysis prepared"
  );
});

test("consent withdrawal stops a media request that resolves late", async ({
  page
}) => {
  await installReadinessMock(page);
  await page.addInitScript(() => {
    let resolveRequest: ((stream: MediaStream) => void) | null = null;
    const state = { stoppedTracks: 0 };
    const track = () => ({
      readyState: "live",
      muted: false,
      stop() {
        state.stoppedTracks += 1;
        this.readyState = "ended";
      },
      getSettings: () => ({}),
      addEventListener: () => undefined
    });
    const videoTrack = track();
    const audioTrack = track();
    const stream = {
      getTracks: () => [videoTrack, audioTrack],
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [audioTrack]
    } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => {
            resolveRequest = resolve;
          })
      }
    });
    Object.assign(window, {
      __resolveDelayedMedia: () => resolveRequest?.(stream),
      __delayedMediaState: state
    });
  });
  await page.goto("/");
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-capture-state",
    "requesting"
  );

  await page.locator("#consent-checkbox").uncheck();
  await page.evaluate(() => {
    (
      window as typeof window & {
        __resolveDelayedMedia: () => void;
      }
    ).__resolveDelayedMedia();
  });

  await expect(page.locator("body")).toHaveAttribute(
    "data-capture-state",
    "idle"
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __delayedMediaState: { stoppedTracks: number };
            }
          ).__delayedMediaState.stoppedTracks
      )
    )
    .toBe(2);
  await expect(page.locator("#camera-preview")).toHaveJSProperty(
    "srcObject",
    null
  );
});

test("consent withdrawal stops tracks while video playback is still pending", async ({
  page
}) => {
  await installReadinessMock(page);
  await page.addInitScript(() => {
    let resolvePlay: (() => void) | null = null;
    const state = { playStarted: false, stoppedTracks: 0 };
    const track = () => {
      let readyState: MediaStreamTrackState = "live";
      return {
        get readyState() {
          return readyState;
        },
        muted: false,
        stop() {
          if (readyState === "ended") return;
          readyState = "ended";
          state.stoppedTracks += 1;
        },
        getSettings: () => ({}),
        addEventListener: () => undefined
      };
    };
    const videoTrack = track();
    const audioTrack = track();
    const stream = {
      getTracks: () => [videoTrack, audioTrack],
      getVideoTracks: () => [videoTrack],
      getAudioTracks: () => [audioTrack]
    } as unknown as MediaStream;
    const attachedStreams = new WeakMap<HTMLMediaElement, MediaStream | null>();
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get() {
        return attachedStreams.get(this) ?? null;
      },
      set(value: MediaStream | null) {
        attachedStreams.set(this, value);
      }
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => stream
      }
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: () =>
        new Promise<void>((resolve) => {
          state.playStarted = true;
          resolvePlay = resolve;
        })
    });
    Object.assign(window, {
      __resolveDelayedPlay: () => resolvePlay?.(),
      __delayedPlayState: state
    });
  });

  await page.goto("/");
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __delayedPlayState: { playStarted: boolean };
            }
          ).__delayedPlayState.playStarted
      )
    )
    .toBe(true);

  await page.locator("#consent-checkbox").uncheck();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __delayedPlayState: { stoppedTracks: number };
            }
          ).__delayedPlayState.stoppedTracks
      )
    )
    .toBe(2);
  await expect(page.locator("body")).toHaveAttribute(
    "data-capture-state",
    "idle"
  );
  await expect(page.locator("#camera-preview")).toHaveJSProperty(
    "srcObject",
    null
  );

  await page.evaluate(() => {
    (
      window as typeof window & {
        __resolveDelayedPlay: () => void;
      }
    ).__resolveDelayedPlay();
  });
});

test("runs guided capture, traces both claims, and approves the summary", async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          sessionStorage.setItem("copied-report", text);
        }
      }
    });
  });
  await runGuidedCapture(page);
  await expect(page.locator("#result-summary")).toContainText(
    "11 encounter biomarkers"
  );
  await expect(page.getByRole("heading", {
    name: "Clinician encounter summary"
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Digital biomarker profile"
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "Clinician note"
  })).toBeVisible();
  await expect(page.locator(".assessment-shell")).toBeHidden();
  await expect(page.locator("#capture-handoff")).toHaveClass(
    /is-complete/
  );
  await expect(page.locator("#capture-handoff")).toHaveAttribute(
    "data-event-id",
    /coordinator\.decision\.recorded/
  );
  await expect(page.locator("#grounding-handoff")).toHaveClass(
    /is-complete/
  );
  await expect(page.locator("#grounding-handoff")).toHaveAttribute(
    "data-event-id",
    /evidence\.grounding\.completed/
  );
  await expect(page.locator("#review-handoff")).toHaveAttribute(
    "data-event-id",
    /human-review\.pending/
  );
  await expectCleanPresentationCopy(page);
  await page.locator(".evidence-claim").first().click();
  await expect(page.locator("#trace-drawer")).toBeVisible();
  await expect(page.locator("#trace-backdrop")).toBeVisible();
  await expect(page.locator("#trace-content")).toContainText(
    "Signal quality"
  );
  await expect(page.locator("#trace-content")).toContainText(
    "Source interval"
  );
  await expect(page.locator("#trace-content")).not.toContainText(
    "pitchCoverage"
  );
  await expect(page.locator("#trace-content")).not.toContainText(" ms");
  await expect(page.locator("#trace-content")).not.toContainText("#1");
  await page.locator("#trace-close-button").click();
  await page.locator(".report-metric").first().click();
  await expect(page.locator("#trace-title")).toHaveText(
    "Speech initiation latency"
  );
  await expect(page.locator("#trace-content")).toContainText(
    "speech timing + fluency"
  );
  await expect(page.locator("#trace-content")).not.toContainText(
    "speech-acoustic"
  );
  await page.locator("#trace-close-button").click();
  await page.locator("#accept-button").click();
  await expect(page.locator("#approval-confirmation")).toContainText(
    "Approved for this encounter · Visit 1 established"
  );
  await expect(page.locator("#approval-confirmation")).toHaveAttribute(
    "data-event-id",
    /human-review\.accepted/
  );
  await expect(page.locator("#accept-button")).toBeHidden();
  await expect(page.locator("#reject-button")).toBeHidden();
  await expect(page.locator("#copy-report-button")).toBeVisible();
  await page.locator("#copy-report-button").click();
  const copiedReport = await page.evaluate(() =>
    sessionStorage.getItem("copied-report")
  );
  expect(copiedReport).not.toBeNull();
  expect(copiedReport ?? "").not.toMatch(forbiddenSerializedData);
  await expect(page.locator("#baseline-panel")).toBeVisible();
  await expect(page.locator("#baseline-panel")).toHaveAttribute(
    "data-event-id",
    /baseline\.established/
  );
  await expect(page.locator("#baseline-panel")).toContainText(
    "Today establishes Visit 1"
  );
  await expect(page.locator(".visit-future")).toHaveCount(2);
  await expect(page.locator("#header-mode")).toHaveText("Complete");
  await expect(page.locator("#header-privacy-state")).toContainText(
    "Devices released"
  );
});

test("dismiss completes review without approving the summary", async ({
  page
}) => {
  await runGuidedCapture(page);
  await page.locator("#reject-button").click();
  await expect(page.locator("#review-outcome")).toHaveText(
    "Summary dismissed."
  );
  await expect(page.locator("#review-state")).toHaveText("Dismissed");
});

test("prefetches synthesis and exposes measured evidence during service latency", async ({
  page
}) => {
  await installReadinessMock(page);
  let requestStarted = false;
  await page.route("**/api/evidence-card", async (route) => {
    requestStarted = true;
    const payload = route.request().postDataJSON() as {
      outcomes: Array<{
        outcomeId: string;
        modality: "speech" | "face";
        status: "measured" | "withheld";
        statement: string;
      }>;
    };
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        draft: {
          headline: "Two encounter signals are ready for review",
          summary:
            "Pitch variability and bilateral facial task measurements were captured during technically usable portions of the encounter.",
          claims: payload.outcomes.map((outcome) => ({
            claimId: outcome.outcomeId,
            modality: outcome.modality,
            status: outcome.status,
            statement: outcome.statement
          })),
          boundaryStatement: boundary
        },
        grounding: {
          status: "pass",
          errors: [],
          groundedClaimIds: payload.outcomes.map(
            (outcome) => outcome.outcomeId
          )
        },
        model: "service-response",
        promptVersion: "test-contract",
        responseId: "delayed-test-response",
        attemptCount: 1,
        timing: {
          totalMs: 2_000,
          modelMs: 1_996,
          validationMs: 1
        }
      })
    });
  });

  await page.goto("/?testCapture=1&fast=1");
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await expect(page.locator("#start-button")).toHaveText("Begin assessment");
  await page.locator("#start-button").click();
  await expect.poll(() => requestStarted).toBe(true);
  await expect(page.locator("#results-panel")).toBeVisible();
  await expect(page.locator("#results-panel")).toHaveAttribute(
    "data-event-id",
    /coordinator\.decision\.recorded/
  );
  await expect(page.locator(".aggregate-card")).toHaveCount(11);
  await expect(page.locator("#evidence-loading")).toBeVisible();
  await expect(page.locator("#evidence-loading")).toHaveAttribute(
    "data-event-id",
    /evidence-card\.requested/
  );
  await expect(page.locator(".skeleton-claim")).toHaveCount(2);
  await expect(page.locator("#evidence-card")).toBeHidden();
  await expect(page.locator("#evidence-card")).toBeVisible({
    timeout: 5_000
  });
  await expect(page.locator("#evidence-headline")).toHaveText(
    "Two encounter signals are ready for review"
  );
  await expect(page.locator("#evidence-card")).toHaveAttribute(
    "data-event-id",
    /evidence-card\.drafted/
  );
  await expect(page.locator(".report-metric")).toHaveCount(11);
});

test("shows facial analysis pausing while speech continues", async ({ page }) => {
  await installEvidenceMock(page);
  await page.goto(
    "/?testCapture=1&fast=1&observe=1&scenario=unfinished-smile"
  );
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await page.locator("#start-button").click();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        face: document.querySelector("#face-lane-state")?.textContent,
        speech: document.querySelector("#speech-state")?.textContent,
        decision:
          document.querySelector("#coordinator-decision")?.textContent,
        decisionEvent:
          document
            .querySelector("#coordinator-decision")
            ?.getAttribute("data-event-id"),
        callout: document.querySelector("#camera-callout")?.textContent,
        calloutEvent:
          document
            .querySelector("#camera-callout")
            ?.getAttribute("data-event-id"),
        faceEvent:
          document
            .querySelector('[data-lane="facial-expressivity"]')
            ?.getAttribute("data-event-id")
      }))
    )
    .toMatchObject({
      face: "Paused",
      speech: "Active",
      decision: "Facial Analysis paused · Speech continues",
      decisionEvent: expect.stringMatching(/capture\.quality\.changed/),
      callout: expect.stringContaining(
        "Facial Analysis paused · Speech continues"
      ),
      calloutEvent: expect.stringMatching(/capture\.quality\.changed/),
      faceEvent: expect.stringMatching(/capture\.quality\.changed/)
    });
  await expect(page.locator("#face-lane-state")).toHaveText("Connected", {
    timeout: 5_000
  });
  await expect(page.locator("#agent-graph")).toHaveAttribute(
    "data-face-path",
    "connected"
  );
  await expect(page.locator("#coordinator-decision")).toContainText(
    "Facial Analysis reconnected"
  );
  await expect(page.locator("#camera-callout")).toHaveAttribute(
    "data-event-id",
    /capture\.quality\.changed/
  );
  const visibleDecisions = page.locator("#event-list .event-item");
  await expect(visibleDecisions).toHaveCount(3);
});

test("corrective guidance appears without skipping and a later retry succeeds", async ({
  page
}) => {
  await installEvidenceMock(page);
  await page.goto(
    "/?testCapture=1&fast=1&observe=1&scenario=missed-turn"
  );
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await page.locator("#start-button").click();
  await expect(page.locator("#guidance-detail")).toContainText(
    "Keep speaking while turning far enough away"
  );
  await expect(
    page.locator('[data-milestone="withheld"]')
  ).not.toHaveClass(/is-complete/);
  await expect(page.locator("#coordinator-decision")).toContainText(
    "needs a little adjustment"
  );
  await expect(
    page.locator('[data-milestone="withheld"]')
  ).toHaveClass(/is-complete/);
  await expect(page.locator("#results-panel")).toBeVisible();
  await expectCleanPresentationCopy(page);
});

test("elapsed time alone never advances an unfinished exercise", async ({
  page
}) => {
  await installEvidenceMock(page);
  await page.goto("/?testCapture=1&fast=1&scenario=unfinished-task");
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await page.locator("#start-button").click();

  await expect(page.locator("#guidance-step")).toHaveText("Step 2 of 5");
  await expect(page.locator("#guidance-detail")).toContainText(
    "Keep speaking while turning far enough away"
  );
  await expect(
    page.locator('[data-milestone="withheld"]')
  ).not.toHaveClass(/is-complete/);
  await expect(page.locator("#results-panel")).toBeHidden();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#stop-button").click();
});

test("technical visual withholding cannot satisfy intentional turn-away", async ({
  page
}) => {
  await installEvidenceMock(page);
  await page.goto(
    "/?testCapture=1&fast=1&scenario=technical-turn-away"
  );
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await page.locator("#start-button").click();

  await expect(page.locator("#face-lane-state")).toHaveText("Paused");
  await expect(page.locator("#guidance-step")).toHaveText("Step 2 of 5");
  await expect(page.locator("#guidance-detail")).toContainText(
    "Camera, lighting, and connection problems do not count"
  );
  await expect(
    page.locator('[data-milestone="withheld"]')
  ).not.toHaveClass(/is-complete/);
  await expect(page.locator("#results-panel")).toBeHidden();
});

test("end assessment requires confirmation and discards without a report", async ({
  page
}) => {
  let evidenceRequestCount = 0;
  await installEvidenceMock(page, () => {
    evidenceRequestCount += 1;
  });
  await page.goto(
    "/?testCapture=1&fast=1&operator=1&scenario=unfinished-smile"
  );
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await page.locator("#start-button").click();
  await expect(page.locator("#guidance-step")).toHaveText("Step 4 of 5");
  await expect(page.locator("#stop-button")).toBeVisible();
  const originalOverlay =
    await page.locator("#landmark-overlay").elementHandle();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("#stop-button").click();
  await expect(page.locator("#header-mode")).toHaveText("Assessment live");

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#stop-button").click();
  await expect(page.locator("#header-mode")).toHaveText("Ready");
  await expect(page.locator("#header-privacy-state")).toContainText(
    "Devices off"
  );
  await expect(page.locator("#consent-checkbox")).not.toBeChecked();
  await expect(page.locator("#results-panel")).toBeHidden();
  await expect(page.locator(".evidence-claim")).toHaveCount(0);
  await expect(page.locator("#event-list .event-item")).toHaveCount(0);
  await expect(page.locator("#operator-output")).toHaveText("");
  expect(evidenceRequestCount).toBe(0);
  const replacementOverlay =
    await page.locator("#landmark-overlay").elementHandle();
  expect(
    await originalOverlay!.evaluate(
      (original, replacement) => original !== replacement,
      replacementOverlay
    )
  ).toBe(true);
});

test("discard wins over the completion handoff and creates no report", async ({
  page
}) => {
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...arguments_: unknown[]
    ) =>
      nativeSetTimeout(
        handler,
        timeout === 320 ? 2_000 : timeout,
        ...arguments_
      )) as typeof window.setTimeout;
  });
  let evidenceRequestCount = 0;
  await installEvidenceMock(page, () => {
    evidenceRequestCount += 1;
  });
  await page.goto("/?testCapture=1&fast=1");
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await page.locator("#start-button").click();
  await expect(
    page.locator('[data-milestone="eye-closure"]')
  ).toHaveClass(/is-complete/);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#stop-button").click();
  await page.waitForTimeout(500);

  await expect(page.locator("body")).toHaveAttribute(
    "data-capture-state",
    "idle"
  );
  await expect(page.locator("#header-mode")).toHaveText("Ready");
  await expect(page.locator("#results-panel")).toBeHidden();
  expect(evidenceRequestCount).toBe(0);
});

test("a processor change after completion rewinds to neutral before finalization", async ({
  page
}) => {
  let evidenceRequestCount = 0;
  await installEvidenceMock(page, () => {
    evidenceRequestCount += 1;
  });
  await page.goto(
    "/?testCapture=1&observe=1&scenario=processor-change-after-completion"
  );
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await page.locator("#start-button").click();

  await expect(page.locator("body")).toHaveAttribute(
    "data-test-processor-change-rewound",
    "true"
  );
  await expect(page.locator("#guidance-step")).toHaveText("Step 3 of 5");
  await expect(
    page.locator('[data-milestone="eye-closure"]')
  ).not.toHaveClass(/is-complete/);
  expect(evidenceRequestCount).toBe(0);

  await expect(page.locator("#results-panel")).toBeVisible({
    timeout: 10_000
  });
  await expect(page.locator(".aggregate-card")).toHaveCount(11);
  expect(evidenceRequestCount).toBe(1);
});

test("labels, mirrors, and restores the worker-only mesh across lifecycle boundaries", async ({
  page
}) => {
  await installEvidenceMock(page);
  await page.goto(
    "/?testCapture=1&fast=1&scenario=technical-turn-away"
  );
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await page.locator("#start-button").click();
  await expect(page.locator("#mesh-disclosure")).toContainText(
    "Live 478-point facial mesh · display only · not stored"
  );
  await expect(page.locator("#mesh-disclosure")).toBeVisible();
  const transforms = await page.evaluate(() => ({
    preview: getComputedStyle(
      document.querySelector("#camera-preview")!
    ).transform,
    mesh: getComputedStyle(
      document.querySelector("#landmark-overlay")!
    ).transform,
    box: getComputedStyle(
      document.querySelector("#face-overlay")!
    ).transform,
    meshLayer: Number(
      getComputedStyle(
        document.querySelector("#landmark-overlay")!
      ).zIndex
    ),
    boxLayer: Number(
      getComputedStyle(
        document.querySelector("#face-overlay")!
      ).zIndex
    )
  }));
  expect(transforms.mesh).toBe(transforms.preview);
  expect(transforms.box).toBe(transforms.preview);
  expect(transforms.meshLayer).toBeGreaterThan(transforms.boxLayer);

  await expect
    .poll(() =>
      page.evaluate(() => ({
        face: document.querySelector("#face-lane-state")?.textContent,
        meshHidden:
          (document.querySelector("#mesh-disclosure") as HTMLElement)
            ?.hidden ?? false
      }))
    )
    .toEqual({ face: "Paused", meshHidden: true });

  await page.goto(
    "/?testCapture=1&fast=1&scenario=unfinished-smile"
  );
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await page.locator("#start-button").click();
  await expect(page.locator("#guidance-step")).toHaveText("Step 4 of 5");
  await expect(page.locator("#face-lane-state")).toHaveText("Connected");
  await expect(page.locator("#mesh-disclosure")).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#mesh-disclosure")).toBeHidden();
  await expect(page.locator("#landmark-overlay")).toBeHidden();

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator("#mesh-disclosure")).toBeVisible();

  const overlayBeforeRestart =
    await page.locator("#landmark-overlay").elementHandle();
  const workerFailure = await page.evaluate(() =>
    (
      window as typeof window & {
        __phenometricVisualLifecycleTest: {
          simulateWorkerFailure(): {
            canvasReplaced: boolean;
            overlayHidden: boolean;
          };
        };
      }
    ).__phenometricVisualLifecycleTest.simulateWorkerFailure()
  );
  expect(workerFailure).toEqual({
    canvasReplaced: true,
    overlayHidden: true
  });
  const overlayAfterRestart =
    await page.locator("#landmark-overlay").elementHandle();
  expect(
    await overlayBeforeRestart!.evaluate(
      (previous, replacement) => previous !== replacement,
      overlayAfterRestart
    )
  ).toBe(true);
  await expect(page.locator("#mesh-disclosure")).toBeVisible({
    timeout: 15_000
  });

  const cameraUnavailable = await page.evaluate(() =>
    (
      window as typeof window & {
        __phenometricVisualLifecycleTest: {
          simulateCameraUnavailable(): {
            overlayHidden: boolean;
          };
        };
      }
    ).__phenometricVisualLifecycleTest.simulateCameraUnavailable()
  );
  expect(cameraUnavailable.overlayHidden).toBe(true);
  await expect(page.locator("#mesh-disclosure")).toBeHidden();
  await expect(page.locator("#landmark-overlay")).toBeHidden();
});

test("narrative failure preserves grounded evidence and approval", async ({
  page
}) => {
  await installReadinessMock(page);
  await page.route("**/api/evidence-card", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Service unavailable" })
    });
  });
  await page.goto("/?testCapture=1&fast=1");
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await page.locator("#start-button").click();
  await expect(page.locator("#evidence-card")).toBeVisible();
  await expect(page.locator("#evidence-status-chip")).toContainText(
    "narrative pending"
  );
  await expect(page.locator("#accept-button")).toBeEnabled();
  await expectCleanPresentationCopy(page);
});

test("bounded system check enables the assessment without technical classifications", async ({
  page
}) => {
  await installEvidenceMock(page);
  await page.goto(
    "/?testCapture=1&fast=1&scenario=limited-calibration"
  );
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await expect(page.locator("#start-button")).toHaveText(
    "Begin assessment"
  );
  await expect(page.locator("#speech-state")).toHaveText("Ready");
  await expect(page.locator("#face-lane-state")).toHaveText("Ready");
  await expectCleanPresentationCopy(page);
});

test("presentation capture stage fits judge display sizes without scrolling", async ({
  page
}) => {
  await installReadinessMock(page);
  for (const viewport of [
    { width: 1_280, height: 720 },
    { width: 1_440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const layout = await page.evaluate(() => {
      const capture = document.querySelector(".capture-panel");
      return {
        documentOverflows:
          document.documentElement.scrollHeight >
          document.documentElement.clientHeight,
        captureOverflows:
          capture instanceof HTMLElement &&
          capture.scrollHeight > capture.clientHeight
      };
    });
    expect(layout.captureOverflows).toBe(false);
    expect(layout.documentOverflows).toBe(false);
  }
});

test("keeps the results workspace aligned at judge display sizes", async ({
  page
}) => {
  await page.setViewportSize({ width: 1_280, height: 720 });
  await runGuidedCapture(page);
  for (const viewport of [
    { width: 1_280, height: 720 },
    { width: 1_440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const results = document.querySelector("#results-panel");
      const report = document.querySelector("#evidence-panel");
      const metrics = document.querySelector(".result-section");
      const insideViewport = (element: Element | null) => {
        if (!(element instanceof HTMLElement)) return false;
        const bounds = element.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= window.innerWidth;
      };
      return {
        horizontalOverflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        resultsAligned: insideViewport(results),
        reportAligned: insideViewport(report),
        metricsAligned: insideViewport(metrics)
      };
    });
    expect(layout).toEqual({
      horizontalOverflow: false,
      resultsAligned: true,
      reportAligned: true,
      metricsAligned: true
    });
  }
});

test("respects reduced-motion presentation preferences", async ({ page }) => {
  await installReadinessMock(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?testCapture=1&fast=1");
  const motion = await page.locator(".assessment-shell").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationDuration: style.animationDuration,
      transitionDuration: style.transitionDuration
    };
  });
  expect(motion.animationDuration).toBe("0.001s");
  expect(motion.transitionDuration).toBe("0.001s");
});
