/* 🫏 小驢造型近拍(tsum 換皮的截圖驗收專用)。
 *
 * 為什麼要另外一支:`verify-donkey.mjs` 驗的是**玩法**(零罰分/罰分/毛色切換),
 * 它證明「沒壞」,但證不了「好不好看」。0730 大衛打獅熊那三輪的教訓:
 * **自動測試全綠之後,截圖照樣抓到五個畫面錯**。
 *
 * ★ 這一站的特殊之處:預設鏡頭在**驢的後方**(updateCamera view 0 = `p - t*8.6`),
 *   所以玩家最常看到的是臀部/尾巴/豎起的大長耳 —— 背面那張才是最該檢查的。
 *   同時要確認**騎者(巴蘭)還穩穩坐在鞍上**:身體一加高就會把鞍座和騎者吞進背裡。
 *
 * 跑法:先 `npx vite preview --port 5210`,再
 *   CHROME_EXE=<chrome> node scripts/shot-donkey-closeup.mjs http://localhost:5210/ <outDir>
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [url, outDir = "scripts/shots"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G = "__balaamDonkey3d";

const browser = await chromium.launch({ executablePath: process.env.CHROME_EXE });
// deviceScaleFactor 3:裁切框是 CSS 像素、輸出 3 倍 → 耳朵/高光/騎者的腿有沒有埋進去才看得出來
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 3 });
const errs = [];
page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });

await page.goto(url, { waitUntil: "load", timeout: 25000 });
await page.bringToFront();
await sleep(1200);

// 開一局並讓牠跑起來(靜止的驢看不出腿與尾巴的姿態)
await page.evaluate((g) => {
  document.querySelector('.mode-card[data-mode="course"]')?.click();
  document.querySelector("#startMatchButton")?.click();
}, G);
await sleep(500);
await page.evaluate((g) => window[g].jump(), G);
await sleep(1800);

/* 把驢(含騎者)的 bounding box 投影到螢幕算裁切框。
   ★ 一定要連**騎者**一起框進來:這次換皮最怕的就是「身體變高把騎者的腿吞掉」,
     只框驢的話正好把證據裁掉。 */
async function clipOf(withRider) {
  return await page.evaluate(([g, wr]) => {
    const game = window[g];
    const objs = [game.horse.group];
    if (wr && game.rider) objs.push(game.rider.group);
    const cam = game.camera;
    const W = window.innerWidth, H = window.innerHeight;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const obj of objs) {
      obj.updateWorldMatrix(true, true);
      obj.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
          const v = new obj.position.constructor(x, y, z);
          v.applyMatrix4(o.matrixWorld).project(cam);
          const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H;
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx);
          y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
      });
    }
    const pw = (x1 - x0) * 0.14, ph = (y1 - y0) * 0.14;
    x0 = Math.max(0, x0 - pw); y0 = Math.max(0, y0 - ph);
    x1 = Math.min(W, x1 + pw); y1 = Math.min(H, y1 + ph);
    return { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
  }, [G, withRider]);
}

async function shot(name, view) {
  await page.evaluate(([g, v]) => { window[g].cameraView = v; }, [G, view]);
  await sleep(1400);                        // 等鏡頭 lerp 到位
  const clip = await clipOf(true);
  if (clip.width < 8 || clip.height < 8) { console.log("skip", name, JSON.stringify(clip)); return; }
  await page.screenshot({ path: `${outDir}/${name}.png`, clip });
  console.log(name, JSON.stringify(clip));
}

await shot("donkey-rear", 0);   // ★ 玩家預設看到的角度(後方)
await shot("donkey-side", 1);   // 側面:看剖面圓不圓、騎者坐得對不對
await shot("donkey-top", 2);    // 俯視:看耳朵與臀部的輪廓

/* 鞍座/騎者對位的**數字**證據(截圖之外再加一層:眼睛會被角度騙) */
const fit = await page.evaluate((g) => {
  const game = window[g], THREEV = game.horse.group.position.constructor;
  const saddle = game.horse.saddle.getWorldPosition(new THREEV());
  const bodyBox = { top: null };
  game.horse.body.geometry.computeBoundingBox();
  const bb = game.horse.body.geometry.boundingBox;
  const topLocal = new THREEV(0, bb.max.y, 0).applyMatrix4(game.horse.body.matrixWorld);
  bodyBox.top = +topLocal.y.toFixed(3);
  const rider = game.rider ? game.rider.group.getWorldPosition(new THREEV()) : null;
  return { saddleY: +saddle.y.toFixed(3), bodyTopY: bodyBox.top, riderY: rider ? +rider.y.toFixed(3) : null };
}, G);
console.log("\n鞍座/身體/騎者對位:", JSON.stringify(fit));
console.log(fit.bodyTopY <= fit.saddleY + 0.02
  ? "  🟢 身體頂面沒有高過鞍座 → 鞍與騎者不會被吞進背裡"
  : `  🔴 身體頂面 ${fit.bodyTopY} 高過鞍座 ${fit.saddleY} → 鞍/騎者會被吞掉`);

console.log("\npageerrors/console errors:", errs.length);
for (const e of errs.slice(0, 5)) console.log("  ✗", e.slice(0, 180));
await browser.close();

