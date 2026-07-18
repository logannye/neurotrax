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
    "facial-expressivity"
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
      facts: Array<{
        claimId: string;
        label: string;
        modality: "speech" | "face";
        statement: string;
      }>;
    };
    expect(payload.facts).toHaveLength(2);
    expect(new Set(payload.facts.map((fact) => fact.modality)).size).toBe(2);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        draft: {
          headline: "Two encounter signals are ready for review",
          summary:
            "Pitch variability and facial movement were measured during technically usable portions of the encounter.",
          claims: payload.facts.map((fact) => ({
            claimId: fact.claimId,
            statement: fact.statement
          })),
          boundaryStatement: boundary
        },
        grounding: {
          status: "pass",
          errors: [],
          groundedClaimIds: payload.facts.map((fact) => fact.claimId)
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

async function runGuidedCapture(page: Page): Promise<void> {
  await installEvidenceMock(page);
  await page.goto("/?testCapture=1&fast=1");
  await expect(page.locator("#face-lane-state")).toHaveText("Ready");
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await expect(page.locator("#start-button")).toHaveText("Begin assessment");
  await page.locator("#start-button").click();
  await expect(page.locator("#stop-button")).toHaveText(/View/, {
    timeout: 10_000
  });
  await expect(
    page.locator('[data-milestone="withheld"]')
  ).toHaveClass(/is-complete/);
  await expect(
    page.locator('[data-milestone="recovered"]')
  ).toHaveClass(/is-complete/);
  await expect(page.locator("#stop-button")).toBeEnabled();
  await page.locator("#stop-button").click();
  await expect(page.locator("#evidence-card")).toBeVisible();
  await expect(page.locator(".evidence-claim")).toHaveCount(2);
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
    "Ambient telehealth neuro assessment"
  );
  await expectCleanPresentationCopy(page);
});

test("runs guided capture, traces both claims, and approves the summary", async ({
  page
}) => {
  await runGuidedCapture(page);
  await expect(page.locator("#result-summary")).toContainText(
    "2 facial windows"
  );
  await expectCleanPresentationCopy(page);
  await page.locator(".evidence-claim").first().click();
  await expect(page.locator("#trace-drawer")).toBeVisible();
  await expect(page.locator("#trace-content")).toContainText(
    "Quality conditions"
  );
  await page.locator("#trace-close-button").click();
  await page.locator("#accept-button").click();
  await expect(page.locator("#review-outcome")).toHaveText(
    "Summary approved for this session."
  );
  await expect(page.locator("#header-mode")).toHaveText("Complete");
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
      facts: Array<{
        claimId: string;
        statement: string;
      }>;
    };
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        draft: {
          headline: "Two encounter signals are ready for review",
          summary:
            "Pitch variability and facial movement were measured during technically usable portions of the encounter.",
          claims: payload.facts,
          boundaryStatement: boundary
        },
        grounding: {
          status: "pass",
          errors: [],
          groundedClaimIds: payload.facts.map((fact) => fact.claimId)
        },
        model: "service-response",
        promptVersion: "test-contract",
        responseId: "delayed-test-response",
        attemptCount: 1,
        timing: {
          totalMs: 600,
          modelMs: 596,
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
  await expect(page.locator("#stop-button")).toHaveText(
    "View measured evidence"
  );
  await page.locator("#stop-button").click();
  await expect(page.locator("#evidence-headline")).toHaveText(
    "Measured evidence assembled"
  );
  await expect(page.locator(".evidence-claim")).toHaveCount(2);
  await expect(page.locator("#evidence-headline")).toHaveText(
    "Two encounter signals are ready for review"
  );
});
