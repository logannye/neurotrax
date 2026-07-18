import { expect, test, type Page } from "@playwright/test";

const boundary =
  "Engineering demonstration only. No disease progression, diagnosis, cause, or treatment inference was made.";

async function installEvidenceMock(page: Page): Promise<void> {
  await page.route("**/api/model-readiness", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ready: true,
        model: "gpt-5.6",
        credentialSource: "fixture-browser-test"
      })
    });
  });
  await page.route("**/api/evidence-card", async (route) => {
    const payload = route.request().postDataJSON() as {
      facts: Array<{
        claimId: string;
        label: string;
        statement: string;
      }>;
    };
    const facts = payload.facts.slice(0, 2);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        draft: {
          headline: "A grounded personal comparison is ready",
          summary: `${facts.map((fact) => fact.label).join(
            " and "
          )} were compared with compatible synthetic personal history.`,
          claims: facts.map((fact) => ({
            claimId: fact.claimId,
            statement: fact.statement
          })),
          boundaryStatement: boundary
        },
        grounding: {
          status: "pass",
          errors: [],
          groundedClaimIds: facts.map((fact) => fact.claimId)
        },
        model: "gpt-5.6-sol",
        promptVersion: "evidence-card-grounded.v0.1",
        responseId: "fixture-browser-response",
        attemptCount: 1
      })
    });
  });
}

async function runFixture(page: Page): Promise<void> {
  await installEvidenceMock(page);
  await page.goto("/?fixture=1&fast=1");
  await expect(page.locator("#capture-mode-badge")).toContainText(
    "FIXTURE PLAYBACK"
  );
  await expect(page.locator("#readiness-title")).toHaveText(
    "Demo systems ready"
  );
  await page.locator("#consent-checkbox").check();
  await page.locator("#start-button").click();
  await expect(page.locator("#evidence-card")).toBeVisible();
}

test("runs the complete disclosed fixture and accepts the observation", async ({
  page
}) => {
  await runFixture(page);

  await expect(page.locator("#event-list")).toContainText(
    "Face measurement withheld"
  );
  await expect(page.locator("#event-list")).toContainText(
    "Face signal is measurable"
  );
  await expect(page.locator("#trajectory-summary")).toContainText(
    "3 compatible encounters included"
  );
  await expect(page.locator("#exclusion-list")).toContainText(
    "algorithm version mismatch"
  );
  await expect(page.locator(".trajectory-points").first()).toContainText(
    "SYNTHETIC"
  );

  await page.locator(".evidence-claim").first().click();
  await expect(page.locator("#trace-drawer")).toBeVisible();
  await expect(page.locator("#trace-content")).toContainText(
    "Quality and aggregate confounds"
  );
  await page.locator("#trace-close-button").click();
  await page.locator("#accept-button").click();
  await expect(page.locator("#review-outcome")).toContainText(
    "Accepted for this browser session"
  );
});

test("reject keeps the live observation out of session history", async ({
  page
}) => {
  await runFixture(page);
  await page.locator("#reject-button").click();
  await expect(page.locator("#review-outcome")).toHaveText(
    "Rejected · no live observation added to session history"
  );
});
