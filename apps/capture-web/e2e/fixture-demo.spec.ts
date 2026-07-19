import { expect, test, type Page } from "@playwright/test";

const boundary =
  "For clinician review. This summary does not provide a diagnosis or treatment recommendation.";

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

async function installEvidenceMock(page: Page): Promise<void> {
  await installReadinessMock(page);
  await page.route("**/api/evidence-card", async (route) => {
    const payload = route.request().postDataJSON() as {
      outcomes: Array<{
        outcomeId: string;
        label: string;
        modality: "speech" | "face";
        status: "measured" | "withheld";
        statement: string;
      }>;
    };
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
              ? "Pitch variability and facial movement were measured during technically usable portions of the encounter."
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
    page.locator('[data-milestone="recovered"]')
  ).toHaveClass(/is-complete/);
  await expect(page.locator("#results-panel")).toBeVisible({
    timeout: 10_000
  });
  await expect(page.locator("#evidence-card")).toBeVisible();
  await expect(page.locator(".evidence-claim")).toHaveCount(
    ["missing-face", "missing-speech"].includes(scenario) ? 1 : 2
  );
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

test("runs guided capture, traces both claims, and approves the summary", async ({
  page
}) => {
  await runGuidedCapture(page);
  await expect(page.locator("#result-summary")).toContainText(
    "10 encounter biomarkers"
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
            "Pitch variability and facial movement were measured during technically usable portions of the encounter.",
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
  await expect(page.locator(".aggregate-card")).toHaveCount(10);
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
  await expect(page.locator(".report-metric")).toHaveCount(10);
});

test("shows facial analysis pausing while speech continues", async ({ page }) => {
  await installEvidenceMock(page);
  await page.goto("/?testCapture=1&fast=1&observe=1");
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await page.locator("#start-button").click();
  await expect(page.locator("#evidence-packet")).toBeVisible();
  await expect(page.locator("#evidence-packet")).toHaveAttribute(
    "data-event-id",
    /capture\.window\.opened/
  );
  await expect(page.locator("#face-lane-state")).toHaveText("Paused");
  await expect(page.locator("#speech-state")).toHaveText("Active");
  await expect(page.locator("#coordinator-decision")).toContainText(
    "Speech continues"
  );
  await expect(page.locator("#coordinator-decision")).toHaveAttribute(
    "data-event-id",
    /capture\.quality\.changed/
  );
  await expect(page.locator("#camera-callout")).toContainText(
    "Facial Analysis paused · Speech continues"
  );
  await expect(page.locator("#camera-callout")).toHaveAttribute(
    "data-event-id",
    /capture\.quality\.changed/
  );
  await expect(
    page.locator('[data-lane="facial-expressivity"]')
  ).toHaveAttribute("data-event-id", /capture\.quality\.changed/);
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

test("missed turn-away advances without exposing acquisition detail", async ({
  page
}) => {
  await runGuidedCapture(page, "missed-turn");
  await expect(
    page.locator('[data-milestone="withheld"]')
  ).toHaveClass(/is-complete/);
  await expect(page.locator("#results-panel")).toBeVisible();
  await expectCleanPresentationCopy(page);
});

test("a modality without a metric is omitted from the encounter report", async ({
  page
}) => {
  await runGuidedCapture(page, "missing-face");
  await expect(page.locator(".aggregate-card")).toHaveCount(5);
  await expect(
    page.locator('.aggregate-card[data-measurement-code$="pitch_variability"]')
  ).toContainText("Pitch variability");
  await expect(page.locator(".evidence-claim")).toHaveCount(1);
  await expectCleanPresentationCopy(page);
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
