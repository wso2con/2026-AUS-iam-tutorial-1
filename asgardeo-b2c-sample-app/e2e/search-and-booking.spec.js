import { expect, test } from "@playwright/test";
import { mockWayfinderApi } from "./mocks/api-mocks.js";

test.beforeEach(async ({ page }) => {
  await mockWayfinderApi(page);
});

test("searches for flights and opens flight details", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("wayfinder:e2e:isSignedIn", "false");
  });

  await page.goto("/flights");

  const searchPanel = page.getByRole("region", { name: "Search travel" }).first();
  await searchPanel.getByLabel("From").fill("New York");
  await searchPanel.getByLabel("To").fill("Los Angeles");
  await searchPanel.getByRole("button", { name: "Search" }).click();

  await expect(page).toHaveURL(/\/results\?/);
  await expect(page.getByText("Showing search results for New York to Los Angeles")).toBeVisible();
  await expect(page.getByRole("heading", { name: "New York to Los Angeles" })).toBeVisible();
  await expect(page.getByText("Skyline Air · Nonstop")).toBeVisible();

  await page.getByRole("button", { name: "Book flight" }).click();

  await expect(page).toHaveURL(/\/flights\/wf-101/);
  await expect(page.getByRole("heading", { name: "New York to Los Angeles" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Flight information" })).toContainText("$268");
});

test("completes payment and opens the confirmed booking", async ({ page }) => {
  await page.goto("/flights/wf-101?category=flights&from=New%20York&to=Los%20Angeles&travelers=2%20adults");

  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page).toHaveURL(/\/payment\/flight\/wf-101/);
  await expect(page.getByRole("heading", { name: "Complete payment" })).toBeVisible();

  await page.getByRole("button", { name: "Show CVC" }).click();
  await expect(page.getByRole("textbox", { name: "CVC" })).toHaveAttribute("type", "text");

  await page.getByRole("button", { name: "Pay and confirm booking" }).click();

  await expect(page).toHaveURL(/\/bookings\/booking-e2e-new/);
  await expect(page.getByRole("heading", { name: "New York to Los Angeles" })).toBeVisible();
  await expect(page.getByText("Reference E2E101")).toBeVisible();
  await expect(page.getByRole("region", { name: "Booking information" })).toContainText("2 travelers");
  await expect(page.getByRole("region", { name: "AI travel assistant" })).toContainText(
    "Want me to watch for a better deal for New York to Los Angeles?"
  );
});

test("updates the signed-in profile", async ({ page }) => {
  await page.goto("/profile");

  await expect(page.getByRole("heading", { level: 1, name: "Mira Stone" })).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("First name").fill("Mina");
  await page.getByLabel("Last name").fill("Rivera");
  await page.getByLabel("Email").fill("mina.rivera@example.com");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("status")).toContainText("Profile updated in Asgardeo.");
  await expect(page.getByRole("heading", { level: 1, name: "Mina Rivera" })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "mina.rivera@example.com" })).toBeVisible();
});

test("opens a booking and cancels it", async ({ page }) => {
  await page.goto("/bookings");

  await page.getByRole("link", { name: /Los Angeles to Tokyo/ }).click();
  await expect(page).toHaveURL(/\/bookings\/booking-e2e-existing/);
  await expect(page.getByRole("heading", { name: "Los Angeles to Tokyo" })).toBeVisible();

  await page.getByRole("button", { name: "Cancel booking" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Cancel booking E2E202?");
  await page.getByRole("button", { name: "Confirm cancellation" }).click();

  await expect(page.getByRole("region", { name: "Booking information" })).toContainText("canceled");
});

test("makes a canceled flight available in search results again", async ({ page }) => {
  await page.goto("/bookings");

  await page.getByRole("link", { name: /Los Angeles to Tokyo/ }).click();
  await page.getByRole("button", { name: "Cancel booking" }).click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(page.getByRole("region", { name: "Booking information" })).toContainText("canceled");

  await page.goto("/results?category=flights&from=Los%20Angeles&to=Tokyo&travelers=2%20adults");

  await expect(page.getByRole("heading", { name: "Los Angeles to Tokyo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Book flight" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Booked" })).toHaveCount(0);
});
