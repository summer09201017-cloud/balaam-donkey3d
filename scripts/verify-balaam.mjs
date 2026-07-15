// balaam-donkey3d 端到端驗證:巴蘭之路全綠區(零罰分=驢兒忠心)→ 全程不按(挨打罰分)→ 換毛色
// 用法:node scripts/verify-balaam.mjs <url> <outDir>
import { chromium } from "playwright";

const [url, outDir] = process.argv.slice(2);
const EXE = process.env.CHROME_EXE ||
  "C:/Users/agape250/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe";
const errors = [];
const results = {};
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "load", timeout: 25000 });
await page.bringToFront();
await page.waitForTimeout(1200);

const G = "__balaamDonkey3d";

// 掛一個「完美驢」自動駕駛:每幀檢查,理想避讓點進綠區就 jump()
const runCourse = (mode, autopilot) => page.evaluate(async ([g, m, auto]) => {
  const game = window[g];
  // 走真 UI 選模式卡+開始
  document.querySelector(`.mode-card[data-mode="${m}"]`).click();
  document.querySelector("#startMatchButton").click();
  await new Promise((r) => setTimeout(r, 300));
  game.jump(); // 出發
  const t0 = performance.now();
  const endless = m === "practice";
  while (game.phase !== "ended" && performance.now() - t0 < (endless ? 15000 : 120000)) {
    if (auto && game.phase === "riding") {
      const fence = game.fences[game.fenceIdx];
      if (fence) {
        const dtf = fence.dist - game.dist;
        const err = Math.abs(dtf - 2.6) / Math.max(game.speed, 1);
        if (dtf <= 14 && err <= 0.08) game.jump(); // 比最窄綠區還準
      }
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  return {
    phase: game.phase,
    faults: game.faults,
    clears: game.clears,
    elapsed: Math.round(game.elapsed * 10) / 10,
    overlay: { ...game.overlay },
    fenceCount: game.fences.length,
  };
}, [G, mode, autopilot]);

// —— 場景巡禮截圖(選單軌道鏡頭) ——
await page.waitForTimeout(800);
await page.screenshot({ path: outDir + "/bd-menu.png" });

// —— 巴蘭之路:完美驢 → 應零罰分「驢兒忠心!牠救了主人的命!」(含終局天使現形演出) ——
results.clearRun = await runCourse("standard", true);
await page.screenshot({ path: outDir + "/bd-finish-clear.png" });

// —— 回首頁,全程不按 → 驢自己撐,應吃挨打罰分,但一樣走得完 ——
await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
await page.waitForTimeout(400);
results.knockRun = await runCourse("standard", false);
await page.screenshot({ path: outDir + "/bd-finish-knock.png" });

// —— 行進中截圖(重新開一場,跑 4 秒抓跟隨視角+天使站) ——
await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
await page.waitForTimeout(400);
// 換毛色(深灰)再開一場——驗 setHorseCoat 生效
await page.selectOption("#horseCoatSelect", "darkgrey");
results.coatAfterSelect = await page.evaluate((g) => window[g].coatId, G);
await page.evaluate((g) => {
  document.querySelector('.mode-card[data-mode="standard"]').click();
  document.querySelector("#startMatchButton").click();
  setTimeout(() => window[g].jump(), 200);
}, G);
await page.waitForTimeout(4200);
await page.screenshot({ path: outDir + "/bd-riding.png" });
// 抓避讓瞬間:等進 approach 再跳,於半空截圖(天使+驢同框)
await page.evaluate(async (g) => {
  const game = window[g];
  const t0 = performance.now();
  while (game.phase === "riding" && performance.now() - t0 < 30000) {
    const fence = game.fences[game.fenceIdx];
    if (fence && fence.dist - game.dist <= 3.2) { game.jump(); break; }
    await new Promise((r) => setTimeout(r, 16));
  }
  await new Promise((r) => setTimeout(r, 180)); // 半空
}, G);
await page.screenshot({ path: outDir + "/bd-airborne.png" });

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
