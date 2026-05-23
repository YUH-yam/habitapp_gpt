import assert from "node:assert/strict";
import { chromium } from "/Users/yuh_y/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const errors = [];
const baseUrl = process.argv[2] ?? "http://127.0.0.1:4174/";
const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--no-sandbox"],
});

try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
  });

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.addInitScript(() => {
    localStorage.clear();
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#todayRoot");
  await page.screenshot({ path: "/private/tmp/habitapp-mobile-home.png", fullPage: false });

  await page.getByRole("button", { name: "日記を1行書く" }).click();
  await page.screenshot({ path: "/private/tmp/habitapp-mobile-design.png", fullPage: false });
  await page.getByRole("button", { name: "保存" }).click();
  await page.waitForSelector(".ritual-board");

  const savedState = await page.evaluate(() => JSON.parse(localStorage.getItem("habitapp-gpt-state-v1")));
  assert.equal(savedState.habits.length, 1);
  assert.equal(savedState.habits[0].name, "日記を1行書く");

  await page.getByLabel("見送る理由").selectOption("tired");
  await page.getByRole("button", { name: "今日は無理" }).click();
  const missedState = await page.evaluate(() => JSON.parse(localStorage.getItem("habitapp-gpt-state-v1")));
  assert.equal(missedState.logs.length, 1);
  assert.equal(missedState.logs[0].status, "missed");
  assert.equal(missedState.logs[0].reason, "tired");

  await page.getByRole("button", { name: "最小版で完了", exact: true }).click();
  await page.screenshot({ path: "/private/tmp/habitapp-mobile-after-log.png", fullPage: false });

  const loggedState = await page.evaluate(() => JSON.parse(localStorage.getItem("habitapp-gpt-state-v1")));
  assert.equal(loggedState.logs.length, 1);
  assert.equal(loggedState.logs[0].status, "tiny");

  await page.getByRole("button", { name: "調整" }).click();
  await page.waitForSelector("#reviewRoot");
  await page.waitForTimeout(2700);
  await page.screenshot({ path: "/private/tmp/habitapp-mobile-insights.png", fullPage: false });

  const checks = await page.evaluate(() => ({
    title: document.title,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    hasInsights: document.body.textContent.includes("7日"),
    hasPrivacyText: document.body.textContent.includes("このブラウザ"),
  }));

  assert.equal(checks.title, "余白習慣");
  assert.equal(checks.overflowX, false);
  assert.equal(checks.hasInsights, true);
  assert.equal(checks.hasPrivacyText, true);
  assert.deepEqual(errors, []);

  console.log(JSON.stringify({
    ok: true,
    screenshots: [
      "/private/tmp/habitapp-mobile-home.png",
      "/private/tmp/habitapp-mobile-design.png",
      "/private/tmp/habitapp-mobile-after-log.png",
      "/private/tmp/habitapp-mobile-insights.png",
    ],
    checks,
  }, null, 2));
} finally {
  await browser.close();
}
