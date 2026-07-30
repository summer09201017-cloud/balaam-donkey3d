import * as THREE from "three";
import { InputManager } from "./input.js";
import { loadSettings, saveSettings, loadSavedGame, saveGameState } from "./storage.js";

// —— 巴蘭騎驢(balaam-donkey3d)——聖經皮騎乘遊戲(民數記 22:21-33)。
// fork 自 donkey-jerusalem3d(騎驢進耶路撒冷);引擎判定原封不動,只換語意與皮。
// ★玩家=驢——全場「唯一看得見耶和華的使者站在路上、手裡有拔出來的刀」的角色;
//   巴蘭(騎在背上的先知)看不見,驢避讓慢了就挨巴蘭的杖(演出溫柔化:揮杖+驢委屈搖頭,不血腥)。
// 玩法核心:驢沿曠野土路自動前行(CatmullRom 閉環),玩家只管兩件事——
//   ①節奏控速(按住 W/↑ 或「快步」鈕=快步,放開=收步)②天使擋路時抓綠區「及時避讓」。
// 三幕照經文順序:①田間寬路(驢轉入田間)②葡萄園窄路兩邊有牆(貼牆)③極窄之處(臥下)。
// ★判定=畫面(鐵則4):按下當下就用時機誤差算出「及時避讓/挨打」,再演出來;
//   巴蘭的杖在判定之後才揮下——畫面說不通的罰分=bug。
// ★溫柔規則:永不會輸——再多罰分也走得完;終局=天使現形+巴蘭眼開俯伏下拜。

// ---------- 可調量值 ----------
// window=起跳時機窗(秒,skijump 綠區同款);boost=加速增量;timeAllowed=容許時間(超時每 4 秒+1 罰分)
export const DIFFICULTY_PRESETS = {
  // 07-15 使用者回報「太容易」→ 全檔收緊:窗更窄、馬更快、時間更緊(幼兒保持友善)
  kids: { baseSpeed: 7.0, boost: 2.5, window: 0.32, fences: 6, timeAllowed: 999, assist: 0.5 },
  child: { baseSpeed: 8.2, boost: 3.0, window: 0.21, fences: 7, timeAllowed: 105, assist: 0.3 },
  easy: { baseSpeed: 9.4, boost: 3.6, window: 0.15, fences: 8, timeAllowed: 82, assist: 0.12 },
  normal: { baseSpeed: 10.6, boost: 4.2, window: 0.105, fences: 9, timeAllowed: 66, assist: 0 },
  hard: { baseSpeed: 11.8, boost: 5.0, window: 0.075, fences: 11, timeAllowed: 56, assist: 0 },
};

export const DIFFICULTY_LABELS = {
  kids: "幼兒(超簡單)",
  child: "兒童(簡單)",
  easy: "入門",
  normal: "標準",
  hard: "職業",
};

export const GAME_MODES = {
  standard: {
    label: "巴蘭之路",
    description: "馱著巴蘭走完曠野之路——天使擋路時及時避讓;遲疑=挨巴蘭的杖 +4 罰分;零罰分=驢兒忠心!",
    goal: "及時避讓路上的天使",
  },
  practice: {
    label: "練習小路",
    endless: true,
    description: "無限圈數自由練——熟悉節奏與綠區避讓的手感。",
    goal: "純練手感,不計勝負",
  },
};

export function getModeConfig(modeId) {
  return GAME_MODES[modeId] || GAME_MODES.standard;
}

// ---------- 驢駒的毛色(灰褐/深灰/淺棕三檔) ----------
export const HORSE_COATS = {
  greybrown: { label: "灰褐", coat: 0x8a7f72, mane: 0x4a4038 },
  darkgrey: { label: "深灰", coat: 0x5f5a54, mane: 0x2e2a26 },
  lightbrown: { label: "淺棕", coat: 0xa89070, mane: 0x5a4a36 },
};

// ---------- 場地常數 ----------
const TAKEOFF_D = 2.6; // 理想避讓點:天使站前 2.6m(判定用時間域 err=|distToFence-TAKEOFF_D|/speed)
const JUMP_SPAN = 4.4; // 一次穩步通過的路徑長(m)
const APPROACH_M = 14; // 進入「備妥」提示的距離
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- 人物(照抄 archery3d makePerson:臉部鐵則+關節人物鐵則+長腿) ----------
function createLimb({ upperMaterial, lowerMaterial, endMaterial, upperLen, lowerLen, upperRadius, lowerRadius, end = "hand", thumbSide = 1 }) {
  const pivot = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(upperRadius, upperLen, 4, 8), upperMaterial);
  upper.position.y = -upperLen / 2;
  pivot.add(upper);
  const joint = new THREE.Group();
  joint.position.y = -upperLen;
  pivot.add(joint);
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(lowerRadius, lowerLen, 4, 8), lowerMaterial);
  lower.position.y = -lowerLen / 2;
  joint.add(lower);
  let endMesh;
  if (end === "foot") {
    endMesh = new THREE.Mesh(new THREE.BoxGeometry(lowerRadius * 2.1, lowerRadius, lowerRadius * 3.4), endMaterial);
    endMesh.position.set(0, -lowerLen - lowerRadius * 0.4, lowerRadius * 0.9);
  } else {
    const r = lowerRadius;
    endMesh = new THREE.Group();
    endMesh.position.y = -lowerLen - r * 0.2;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, r * 1.7, r * 1.0), endMaterial);
    palm.position.y = -r * 0.85;
    endMesh.add(palm);
    for (let i = 0; i < 4; i += 1) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(r * 0.44, r * 1.25, r * 0.55), endMaterial);
      finger.position.set((i - 1.5) * r * 0.54, -r * 2.1, 0);
      finger.rotation.x = 0.14;
      endMesh.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 1.0, r * 0.55), endMaterial);
    thumb.position.set(thumbSide * r * 1.3, -r * 0.95, r * 0.1);
    thumb.rotation.z = thumbSide * -0.55;
    endMesh.add(thumb);
  }
  joint.add(endMesh);
  return { pivot, upper, joint, lower, end: endMesh };
}

const HAIR_COLORS = [0x2b2119, 0x4a3120, 0x151515, 0x5e4630, 0x7a5636, 0x3a3a45];

function makePerson({ shirt = 0x2f6f4e, pants = 0x2a3550, skin = 0xf3cca6, hair = 0x2b2119, gender = "m", scale = 1 } = {}) {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.72 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.78, emissive: 0x8a7355, emissiveIntensity: 0.5 });

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.76, 0.32), shirtMat);
  chest.position.y = 1.42;
  rig.add(chest);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.2, 12), skinMat);
  neck.position.y = 1.88;
  rig.add(neck);
  const waist = new THREE.Group();
  waist.position.y = 1.16;
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.27), shirtMat);
  belly.position.y = -0.05;
  waist.add(belly);
  const hip = new THREE.Mesh(
    gender === "f" ? new THREE.BoxGeometry(0.48, 0.22, 0.3) : new THREE.BoxGeometry(0.42, 0.2, 0.27),
    pantsMat,
  );
  hip.position.y = -0.26;
  waist.add(hip);
  const beltLine = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.06, 0.28), new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.6 }));
  beltLine.position.y = -0.15;
  waist.add(beltLine);
  rig.add(waist);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 18), skinMat);
  head.position.y = 2.12;
  rig.add(head);
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), skinMat);
  earL.scale.set(0.45, 1, 0.8);
  earL.position.set(-0.245, 2.11, 0);
  rig.add(earL);
  const earR = earL.clone();
  earR.position.x = 0.245;
  rig.add(earR);

  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85 });
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.265, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), hairMat);
  hairCap.position.y = 2.13;
  hairCap.rotation.x = -0.22;
  rig.add(hairCap);
  const hairBack = new THREE.Mesh(
    new THREE.SphereGeometry(0.255, 16, 8, Math.PI, Math.PI, Math.PI * 0.35, Math.PI * (gender === "f" ? 0.38 : 0.22)),
    hairMat,
  );
  hairBack.position.y = 2.12;
  rig.add(hairBack);

  const faceDark = new THREE.MeshBasicMaterial({ color: 0x25201a });
  const faceWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhite);
  eyeL.position.set(-0.09, 2.18, 0.21);
  rig.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.09;
  rig.add(eyeR);
  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), faceDark);
  pupilL.position.set(-0.09, 2.18, 0.25);
  rig.add(pupilL);
  const pupilR = pupilL.clone();
  pupilR.position.x = 0.09;
  rig.add(pupilR);
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), faceDark);
  browL.position.set(-0.09, 2.26, 0.22);
  browL.rotation.z = 0.16;
  rig.add(browL);
  const browR = browL.clone();
  browR.position.x = 0.09;
  browR.rotation.z = -0.16;
  rig.add(browR);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 14, Math.PI), faceDark);
  smile.position.set(0, 2.04, 0.21);
  smile.rotation.z = Math.PI;
  rig.add(smile);
  // smile 一併回傳:角色皮要換嘴(如金牙)時把原生嘴關掉,避免雙嘴

  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.85 });
  const mkArm = (x) => {
    const arm = createLimb({
      upperMaterial: shirtMat, lowerMaterial: skinMat, endMaterial: skinMat,
      upperLen: 0.27, lowerLen: 0.26, upperRadius: 0.07, lowerRadius: 0.058,
      end: "hand", thumbSide: x < 0 ? 1 : -1,
    });
    arm.pivot.position.set(x, 1.72, 0);
    arm.joint.rotation.x = -0.18;
    rig.add(arm.pivot);
    return arm;
  };
  const leftArm = mkArm(-0.4);
  const rightArm = mkArm(0.4);
  const mkLeg = (x) => {
    const leg = createLimb({
      upperMaterial: pantsMat, lowerMaterial: pantsMat, endMaterial: shoeMat,
      upperLen: 0.40, lowerLen: 0.38, upperRadius: 0.09, lowerRadius: 0.072,
      end: "foot",
    });
    leg.pivot.position.set(x, 1.0, 0);
    leg.pivot.rotation.x = -0.05;
    leg.joint.rotation.x = 0.1;
    rig.add(leg.pivot);
    return leg;
  };
  const leftLeg = mkLeg(-0.15);
  const rightLeg = mkLeg(0.15);

  group.scale.setScalar(scale);
  return { group, rig, head, waist, leftArm, rightArm, leftLeg, rightLeg, smile };
}

/* ══════════════════════════════════════════════════════════════════════════════
   🧸 tsum 圓萌人偶(2026-07-30 使用者點名:「把耶穌/巴蘭也做圓萌版(也做成年齡分級的可選項)」)
   ★ 全艦隊畫風政策=**動物一律 tsum、人物按年齡分級** ⇒ 人物不是開關而是**三態**
     (auto 依年齡 / tsum / real),見 storage.js 的 riderStyle 與下面的 resolveRiderTsum()。
   ★★ **神學界線(使用者在尋羊記親自定的,這裡更嚴格)**:圓萌版**刻意不加腮紅**。
      尋羊記的牧人代表主耶穌,使用者當時的話是「可愛可以、做成玩偶就過頭」;
      ★ 本站的騎者是**巴蘭**(先知,不是主)⇒ **不受那條限制,圓萌版有腮紅**。
      同一份工具在姊妹站 donkey-jerusalem3d 是給主耶穌用的,那邊 blush 一律 false。
   ★ 接口與 makePerson **完全一樣**:{ group, rig, head, waist, leftArm, rightArm, leftLeg, rightLeg, smile }
     —— poseBalaamOnDonkey() 直接在寫 leftLeg.pivot.rotation / rightArm.joint.rotation 這些路徑,
     少一個鍵就整個坐姿壞掉。
   ★ **所有 y 值與原版一字不差**(chest 1.42 / waist 1.16 / head 2.12 / 手 1.72 / 腿 1.0):
     騎者的 group 位置是相對鞍座算的,骨架一挪就浮空或陷進驢背。
     圓萌只改「積木形狀 + 頭放大 + 臉」,不改骨架。
   ★ 四肢**沿用 createLimb**(它本來就是膠囊=圓的),只把半徑加粗 ⇒ pivot/joint 結構自動保住。
   ══════════════════════════════════════════════════════════════════════════════ */
function makeTsumPerson({ shirt = 0x2f6f4e, pants = 0x2a3550, skin = 0xf3cca6, hair = 0x2b2119,
  gender = "m", scale = 1, blush = false } = {}) {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.72 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.78, emissive: 0x8a7355, emissiveIntensity: 0.5 });
  const bl = (r, mat, sx = 1, sy = 1, sz = 1, seg = 14) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat);
    m.scale.set(sx, sy, sz);
    return m;
  };

  // 圓團上身(取代方塊 chest);半深 ≈0.19 → 披肩布片(z=0.17)仍貼在身上不浮空
  const chest = bl(0.30, shirtMat, 1.0, 1.28, 0.64);
  chest.position.y = 1.42;
  rig.add(chest);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.2, 12), skinMat);
  neck.position.y = 1.88;
  rig.add(neck);
  const waist = new THREE.Group();          // ★ y=1.16 不動
  waist.position.y = 1.16;
  waist.add(bl(0.25, shirtMat, 1.0, 0.68, 0.62));                       // 圓肚
  const hip = bl(gender === "f" ? 0.26 : 0.24, pantsMat, 1.0, 0.5, 0.62);
  hip.position.y = -0.26;
  waist.add(hip);
  const beltLine = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.028, 6, 18), new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.6 }));
  beltLine.position.y = -0.15;
  beltLine.rotation.x = Math.PI / 2;        // 腰帶環一圈(圓身就用環,不用方塊條)
  waist.add(beltLine);
  rig.add(waist);

  // 頭:tsum 要大(原版 0.25 → 0.32);★ y=2.12 不動
  const HR = 0.32;
  const head = new THREE.Mesh(new THREE.SphereGeometry(HR, 18, 18), skinMat);
  head.position.y = 2.12;
  rig.add(head);
  for (const x of [-1, 1]) {                // 小圓耳(貼在放大後的頭側)
    const ear = bl(0.055, skinMat, 0.5, 1, 0.85, 10);
    ear.position.set(x * HR * 0.96, 2.11, 0);
    rig.add(ear);
  }
  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85 });
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(HR * 1.06, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat);
  hairCap.position.y = 2.13;
  hairCap.rotation.x = -0.2;
  rig.add(hairCap);
  const hairBack = new THREE.Mesh(
    new THREE.SphereGeometry(HR * 1.02, 16, 8, Math.PI, Math.PI, Math.PI * 0.32, Math.PI * (gender === "f" ? 0.42 : 0.26)),
    hairMat,
  );
  hairBack.position.y = 2.12;
  rig.add(hairBack);

  /* 圓萌臉:大眼 + 水潤雙高光 + 深笑。★ 刻意**沒有眉毛** —— 眉毛是寫實版的表情零件,
     配大眼會變成生氣臉;tsum 的溫柔靠大眼+深笑。 */
  const faceDark = new THREE.MeshBasicMaterial({ color: 0x25201a });
  const faceWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const front = HR * 0.84, eyeR = 0.085;
  for (const x of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 12, 12), faceWhite);
    eye.position.set(x * 0.115, 2.17, front);
    rig.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.68, 10, 10), faceDark);
    pupil.position.set(x * 0.115, 2.17, front + eyeR * 0.42);
    rig.add(pupil);
    const hi = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.3, 8, 8), faceWhite);
    hi.position.set(x * (0.115 + eyeR * 0.28), 2.17 + eyeR * 0.4, front + eyeR * 0.6);
    rig.add(hi);
    const hi2 = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.15, 6, 6), faceWhite);
    hi2.position.set(x * (0.115 - eyeR * 0.3), 2.17 - eyeR * 0.42, front + eyeR * 0.58);
    rig.add(hi2);
    if (blush) {                            // ★ 主耶穌一律 false(見檔頭神學界線)
      const b = bl(0.055, new THREE.MeshStandardMaterial({ color: 0xdf9a92, roughness: 0.9 }), 1, 0.7, 0.45, 8);
      b.position.set(x * 0.2, 2.09, front * 0.86);
      rig.add(b);
    }
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 14, Math.PI), faceDark);
  smile.position.set(0, 2.02, front * 0.96);
  smile.rotation.z = Math.PI;
  rig.add(smile);

  // 四肢:結構與所有 y 值同原版,只把膠囊加粗(tsum 的短胖手腳)
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.85 });
  const mkArm = (x) => {
    const arm = createLimb({
      upperMaterial: shirtMat, lowerMaterial: skinMat, endMaterial: skinMat,
      upperLen: 0.27, lowerLen: 0.26, upperRadius: 0.095, lowerRadius: 0.078,
      end: "hand", thumbSide: x < 0 ? 1 : -1,
    });
    arm.pivot.position.set(x, 1.72, 0);
    arm.joint.rotation.x = -0.18;
    rig.add(arm.pivot);
    return arm;
  };
  const leftArm = mkArm(-0.4);
  const rightArm = mkArm(0.4);
  const mkLeg = (x) => {
    const leg = createLimb({
      upperMaterial: pantsMat, lowerMaterial: pantsMat, endMaterial: shoeMat,
      upperLen: 0.40, lowerLen: 0.38, upperRadius: 0.115, lowerRadius: 0.092,
      end: "foot",
    });
    leg.pivot.position.set(x, 1.0, 0);
    leg.pivot.rotation.x = -0.05;
    leg.joint.rotation.x = 0.1;
    rig.add(leg.pivot);
    return leg;
  };
  const leftLeg = mkLeg(-0.15);
  const rightLeg = mkLeg(0.15);

  group.scale.setScalar(scale);
  return { group, rig, head, waist, leftArm, rightArm, leftLeg, rightLeg, smile };
}

/* 騎者畫風三態 → 要不要走圓萌。auto=依年齡分級(幼兒/兒童→圓萌)。
   ★ 政策白話:小小孩看圓萌的比較不怕、比較親;大孩子與青少年看寫實的比較不幼稚。 */
function resolveRiderTsum(riderStyle, difficulty) {
  if (riderStyle === "tsum") return true;
  if (riderStyle === "real") return false;
  return difficulty === "kids" || difficulty === "child";   // auto
}


// ---------- 巴蘭(引擎控 NPC:玩家操控的是驢,巴蘭只是騎在背上——他看不見天使) ----------
// 先知裝:土黃/褐袍+頭巾+深色大鬍;右手握木杖(挨打演出用,揮杖不血腥)。
function makeBalaamRider(tsum = false) {
  /* 🧸 圓萌版走 makeTsumPerson,接口與所有 y 值一樣 ⇒ 下面的頭巾/鬍子/木杖座標兩版共用。
     ★ 巴蘭是先知不是主 ⇒ 圓萌版**有腮紅**(對照姊妹站的主耶穌一律 false,見那邊的神學界線)。*/
  const rider = (tsum ? makeTsumPerson : makePerson)({
    shirt: 0xb08d4a, // 土黃袍
    pants: 0x7a5c34, // 褐色袍擺
    hair: 0x2b2119,
    gender: "m",
    scale: 0.95,
    blush: true,
  });
  /* 頭巾/額帶/垂布/大鬍的尺寸是為**寫實頭(半徑 0.25)**調的;圓萌頭放大到 0.32
     ⇒ 不跟著放大就會「頭巾戴不下、鬍子浮在臉外面」。用一個倍率一次調完。*/
  const HW = tsum ? 1.28 : 1;
  // 頭巾:淺褐布罩住頭頂+額帶+腦後垂布(先知裝)
  const clothMat = new THREE.MeshStandardMaterial({ color: 0xd8c49a, roughness: 0.9 });
  const wrap = new THREE.Mesh(new THREE.SphereGeometry(0.285 * HW, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), clothMat);
  wrap.position.y = 2.12;
  rider.rig.add(wrap);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.26 * HW, 0.035, 8, 18), new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 }));
  band.position.y = 2.22;
  band.rotation.x = Math.PI / 2;
  rider.rig.add(band);
  const drape = new THREE.Mesh(tsum ? new THREE.SphereGeometry(0.2, 14, 12) : new THREE.BoxGeometry(0.34, 0.44, 0.08), clothMat);
  if (tsum) drape.scale.set(1.0, 1.25, 0.42);   // 圓身配圓布:方塊垂布在圓頭後面會變成一塊看板
  drape.position.set(0, 1.98, tsum ? -0.24 : -0.21);
  rider.rig.add(drape);
  // 深色大鬍(先知感);原生笑嘴關掉避免和鬍子打架
  rider.smile.visible = false;
  const beardMat = new THREE.MeshStandardMaterial({ color: 0x2b2119, roughness: 0.9 });
  const beard = new THREE.Mesh(tsum ? new THREE.SphereGeometry(0.135, 14, 12) : new THREE.BoxGeometry(0.21, 0.2, 0.1), beardMat);
  if (tsum) beard.scale.set(1.05, 0.9, 0.7);    // 圓萌鬍=一團圓蓬毛,不是方塊
  beard.position.set(0, tsum ? 1.94 : 1.96, tsum ? 0.21 : 0.16);
  rider.rig.add(beard);
  /* 小鬍:寫實版是一條方塊 Box。★ 圓萌版改成**兩顆小圓球** ——
     0730 截圖驗收看到的:一條直橫槓橫在圓臉上非常違和
     (和「方塊披肩套在圓身上變成紅色相框」是同一族的問題:配件形狀要跟著身體形狀走)。*/
  const mustache = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.045, 0.05), beardMat);
  mustache.position.set(0, 2.07, 0.22);
  mustache.visible = !tsum;
  rider.rig.add(mustache);
  if (tsum) {
    for (const x of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), beardMat);
      m.scale.set(1.15, 0.75, 0.7);
      m.position.set(x * 0.055, 2.05, 0.27);
      rider.rig.add(m);
    }
  }
  // 右手木杖(挨打演出):細長木 Box 掛在右前臂末端,隨揮杖擺動
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
  const staff = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.35, 0.05), woodMat);
  staff.position.set(0.02, -0.5, 0.08);
  staff.rotation.x = 0.4;
  rider.rightArm.joint.add(staff);
  rider.staff = staff;
  return rider;
}

// 巴蘭坐姿(沿用騎乘引擎坐姿 rotation;鞍布較低,group y 依鞍高調整);右臂持杖略抬
function poseBalaamOnDonkey(rider) {
  rider.leftLeg.pivot.rotation.x = -1.25;
  rider.leftLeg.pivot.rotation.z = 0.5;
  rider.leftLeg.joint.rotation.x = 1.5;
  rider.rightLeg.pivot.rotation.x = -1.25;
  rider.rightLeg.pivot.rotation.z = -0.5;
  rider.rightLeg.joint.rotation.x = 1.5;
  rider.leftArm.pivot.rotation.x = -0.95;
  rider.leftArm.joint.rotation.x = -0.5;
  rider.rightArm.pivot.rotation.x = -1.15; // 持杖手略抬
  rider.rightArm.joint.rotation.x = -0.35;
  rider.group.position.set(0, 0.62, 0.1); // 驢鞍布高 1.42 → 騎者 group y≈0.62
  rider.group.scale.setScalar(0.95);
}

// ---------- 耶和華的使者(民22:23「站在路上,手裡有拔出來的刀」)——只有驢(玩家)看得見 ----------
// 白袍+白光暈(半透明 Sphere)+頭上光環+雙翼(兩片白 Plane)+手持發亮的刀;
// 微微上下浮動+光暈脈動由 update 驅動(fence.angel 引用)。
// pose="low"(天使站):半跪低姿+整體縮小+雙翼橫展+刀前斜——含刀含光環總高 ≈1.35 世界單位,
//   搭配高弧跳(1.6+)絕不穿模;pose="stand"(終局現形):站立全高,驢已停步不會交會。
function makeAngel({ pose = "low" } = {}) {
  const angel = makePerson({ shirt: 0xf6f3ea, pants: 0xf6f3ea, hair: 0xe8dcb8, gender: "m", scale: 1.06 });
  // 光暈:半透明白球包住全身(超自然感,和普通人一眼區分)
  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(1.05, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  aura.scale.set(1, 1.55, 1);
  aura.position.y = 1.35;
  angel.rig.add(aura);
  // 頭上光環(微傾,正面也看得出圓環)
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.035, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }));
  halo.position.y = 2.6;
  halo.rotation.x = Math.PI / 2 - 0.5;
  angel.rig.add(halo);
  // 雙翼:兩片白 Plane 從背後展開(微發光)
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide, emissive: 0xcfd8e8, emissiveIntensity: 0.4 });
  const wings = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 1.55), wingMat);
    wing.position.set(side * 0.44, 1.78, -0.22);
    wing.rotation.z = side * 0.55;
    wing.rotation.y = side * 0.35;
    angel.rig.add(wing);
    wings.push(wing);
  }
  // 手裡拔出來的刀:發亮白/金細長 Box+光暈片,右臂高舉外展(刀舉在頭旁邊,正面清楚可見)
  angel.rightArm.pivot.rotation.x = -2.2;
  angel.rightArm.pivot.rotation.z = -0.55;
  angel.rightArm.joint.rotation.x = -0.15;
  const swordGlowMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.95 });
  const sword = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.05), swordGlowMat);
  blade.position.y = -0.72;
  sword.add(blade);
  const bladeHalo = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 1.5),
    new THREE.MeshBasicMaterial({ color: 0xffedb0, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
  );
  bladeHalo.position.y = -0.72;
  sword.add(bladeHalo);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.06), new THREE.MeshStandardMaterial({ color: 0xd9a94a, roughness: 0.35 }));
  guard.position.y = -0.1;
  sword.add(guard);
  sword.position.set(0, -0.3, 0);
  // 不翻轉:前臂高舉後局部 -y 已指向天,刀身沿 -y 延伸=刀尖朝上(實拍校正 07-16)
  angel.rightArm.joint.add(sword);
  if (pose === "low") {
    // 壓低身位(防穿模):半跪(雙膝折疊)+rig 下沉+整體 0.72,雙翼往橫向展、光環貼頭、刀改前斜
    angel.group.scale.setScalar(0.72);
    angel.rig.position.y = -0.55;
    for (const leg of [angel.leftLeg, angel.rightLeg]) {
      leg.pivot.rotation.x = -1.35;
      leg.joint.rotation.x = 2.2;
    }
    halo.position.y = 2.34;
    for (let w = 0; w < wings.length; w += 1) {
      wings[w].rotation.z = (w === 0 ? -1 : 1) * 1.3; // 橫展,不往上豎
      wings[w].position.y = 1.55;
    }
    angel.rightArm.pivot.rotation.x = -1.5; // 刀前斜低舉,刀尖不超過頭頂
    angel.rightArm.pivot.rotation.z = -0.7;
  }
  angel.aura = aura;
  angel.wings = wings;
  angel.wingBase = wings.map((w) => w.rotation.z); // 翼的基準角(update 擺動疊加用,別蓋掉姿勢)
  angel.swordGlowMat = swordGlowMat;
  return angel;
}

/* ══════════════════════════════════════════════════════════════════════════════
   🧸 tsum 圓萌小驢(2026-07-30;使用者拍板的全艦隊畫風政策:**動物一律 tsum**)
   ★ 這一隻**兩站共用**:騎驢進耶路撒冷(本站)與巴蘭騎驢(balaam-donkey3d)的 makeDonkey
     去掉註解後**逐行相同**(實測 100/100 行),所以做一次、兩邊各自貼上=改一次改兩站。
   ★ tsum-3d-kit 沒有現成的驢(只有獅/熊/狼/羊)⇒ 這是新做的,照那包的鐵則走:
     **輪廓線索**=🫏 **大長耳**(而且「尖」的東西一定要用圓錐,拉長的球前端還是圓的),
     加上白肚白鼻、短鬃、尾末一撮 —— 拿掉顏色只看剪影也要認得出是驢不是小馬。
   ★★ 這一隻**最硬的約束是「不能往上長」**:鞍座在 y=1.42,而騎者(耶穌／巴蘭)的位置
      是**相對鞍座**算出來的。身體一加高就會把鞍座和騎者的腿吞進背裡。
      ⇒ 變圓只能**往下、往兩側**長,身體頂面維持 1.40。
      (這和 2D 大衛打獅熊那次「加高身體→幾乎坐在地上」是同一條教訓的另一面:
        圓不是靠加高,是靠改剖面比例。)
   ★ 以下一律不動(動了就會出事):
       · **鞍座/鞍布 y=1.42 / 1.39** → 騎者會浮空或陷進背裡;
       · 四腿 pivot 的 x/y/z(0.95 / ±0.17 / +0.54,-0.58)與 upperLen/lowerLen → 蹄會離地或穿地;
       · `neckPivot` 的位置(0,1.35,0.8)與 head 的位置(0,0.44,0.36) → 點頭動畫吃它;
       · `tail.rotation.x = 0.55` → 甩尾動畫寫的是 `0.55 + sin(...)`,基準改了尾巴會歪掉;
       · 回傳的 { group, rig, body, neckPivot, head, tail, legs, saddle, coatMat, maneMat } 接口;
       · **coatMat / maneMat 必須是真的貼在身上的那兩個材質** → setHorseCoat 換毛色靠改它們的 color。
   ★ 視角事實(影響取捨):預設鏡頭在**驢的後方**(`p - t*8.6`)⇒ 玩家最常看到的是
     **臀部、尾巴、豎起的大長耳**。所以背面剪影優先做圓;臉(大眼/腮紅/笑嘴)在選單繞場
     與側視角才看得到,但仍照 tsum 標準做齊。
   ★ 沒有加眨眼/Q 彈呼吸:這隻是**騎乘用**,遊戲自己每幀在寫 `rig.position.y`(顛動)與
     `neckPivot.rotation.x`(點頭)—— tsum-3d-kit 鐵則④說 Q 彈只能動 scale、不可佔用那兩個,
     而這站沒有可掛的待機迴圈,硬加會和顛動打架。牠一直在動,不缺生氣。
   ★ TSUM_MOUNT=false 一鍵回到寫實版;寫實 makeDonkey **刻意保留不刪**(日後接年齡分級用)。
   ══════════════════════════════════════════════════════════════════════════════ */
const TSUM_MOUNT = true;

// 壓扁/拉長的球:tsum 造型的主要積木
function tblob(r, mat, sx = 1, sy = 1, sz = 1, seg = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat);
  m.scale.set(sx, sy, sz);
  return m;
}

/* 🧸 圓萌臉,做在 **+z**(本站的驢頭朝 +z)。
   ★ 眼睛保留「白+瞳」兩層(臉部鐵則);白色高光另外標記,將來若加黑化模式才不會被一起染色。 */
function tsumFacePlusZ(parent, o) {
  const R = o.r, front = R * 0.9, eyeR = R * o.eye;
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const darkMat = new THREE.MeshBasicMaterial({ color: o.pupil ?? 0x1c1712 });
  for (const sx of [-1, 1]) {
    const white = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 12, 12), whiteMat);
    white.position.set(sx * R * o.eyeGap, R * 0.12, front * 0.62);
    parent.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.7, 10, 10), darkMat);
    pupil.position.set(sx * R * o.eyeGap, R * 0.12, front * 0.62 + eyeR * 0.42);
    parent.add(pupil);
    const hi = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.3, 8, 8), whiteMat);   // 水潤高光①
    hi.position.set(sx * (R * o.eyeGap + eyeR * 0.28), R * 0.12 + eyeR * 0.4, front * 0.62 + eyeR * 0.62);
    hi.userData.tsumHilite = true;
    parent.add(hi);
    const hi2 = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.15, 6, 6), whiteMat);  // 水潤高光②
    hi2.position.set(sx * (R * o.eyeGap - eyeR * 0.3), R * 0.12 - eyeR * 0.42, front * 0.62 + eyeR * 0.6);
    hi2.userData.tsumHilite = true;
    parent.add(hi2);
    if (o.blush) {                                                                     // 腮紅
      const bl = tblob(R * 0.16, new THREE.MeshStandardMaterial({ color: o.blush, roughness: 0.9 }), 1, 0.7, 0.45, 8);
      bl.position.set(sx * R * (o.eyeGap + 0.36), -R * 0.1, front * 0.5);
      parent.add(bl);
    }
  }
  return parent;
}

/* 🧸 圓萌小驢(tsum)。骨架、鞍高、腿的關節與回傳接口全部照寫實版,只換積木形狀。 */
function makeDonkeyTsum({ coat = 0x8a7f72, mane = 0x4a4038 } = {}) {
  const group = new THREE.Group();                 // 原點=地面、+z 朝前
  const coatMat = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.72 });
  const maneMat = new THREE.MeshStandardMaterial({ color: mane, roughness: 0.85 });
  // ★ 材質共用:setHorseCoat 只改這兩個的 color,全身(含頸/頭/腿)一起換 —— 別另開材質
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 });  // 白肚白鼻(驢特徵)
  const hoofMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6 });

  const rig = new THREE.Group();
  group.add(rig);

  /* 圓團身體。★ 頂面**必須**維持 1.40(鞍座 1.42 就坐在上面):
     半徑 0.44、y 縮到 0.68 ⇒ 半高 0.30、中心壓低到 1.10 ⇒ 頂 1.40 ✓、底 0.80。
     剖面 0.29(寬)×0.30(高)= 圓的;長 ±0.625 ≈ 寫實版的 ±0.65(不改變被騎的量感)。*/
  const body = tblob(0.44, coatMat, 0.66, 0.68, 1.42);
  body.position.set(0, 1.10, 0);
  rig.add(body);
  const chestCap = tblob(0.30, coatMat, 0.9, 0.9, 0.8);
  chestCap.position.set(0, 1.14, 0.66);
  rig.add(chestCap);
  const rump = tblob(0.33, coatMat, 0.92, 0.92, 0.86);   // ★ 後方視角最常看到牠 → 做圓一點
  rump.position.set(0, 1.10, -0.70);
  rig.add(rump);
  const belly = tblob(0.30, whiteMat, 0.8, 0.62, 1.2);   // 白肚(驢特徵)
  belly.position.set(0, 0.92, 0);
  rig.add(belly);

  // 頸(斜上)+頭 —— neckPivot / head 的位置與寫實版一字不差(點頭動畫吃它)
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.35, 0.8);
  rig.add(neckPivot);
  /* 頸:**短而粗**。⚠ 第一版做 0.17 粗、y 拉長 1.7 → 截圖一看是**羊駝不是驢**
     (細長頸+圓身=駱駝科的剪影)。驢的頸子短、和身體幾乎連成一塊。*/
  const neck = tblob(0.20, coatMat, 1, 1.32, 1);
  neck.rotation.x = 0.7;
  neck.position.set(0, 0.16, 0.12);
  neckPivot.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.44, 0.36);
  neckPivot.add(head);
  const HR = 0.27;                                  // tsum:頭做大(寫實版 skull 只有半寬 0.11)
  const skull = tblob(HR, coatMat, 1, 0.98, 1.06);
  skull.rotation.x = 0.2;
  head.add(skull);
  const muzzle = tblob(HR * 0.6, whiteMat, 1, 0.82, 1.15, 12);   // 白鼻(驢特徵)
  muzzle.position.set(0, -HR * 0.46, HR * 0.86);
  head.add(muzzle);
  const nostrilMat = new THREE.MeshBasicMaterial({ color: 0x3a332c });
  for (const sx of [-1, 1]) {
    const n = tblob(HR * 0.07, nostrilMat, 1, 1.2, 1, 6);
    n.position.set(sx * HR * 0.18, -HR * 0.44, HR * 1.4);
    head.add(n);
  }
  tsumFacePlusZ(head, { r: HR, eye: 0.33, eyeGap: 0.4, blush: 0xdf9a92, pupil: 0x1c1712 });
  // 深笑(半圈甜甜圈,開口朝下=笑);貼在白鼻表面外一點,別埋進去
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(HR * 0.17, HR * 0.04, 6, 14, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x6b5a4a, roughness: 0.9 }),
  );
  smile.position.set(0, -HR * 0.62, HR * 1.24);
  smile.rotation.z = Math.PI;
  head.add(smile);
  /* 🫏 **大長耳=驢的身分證**(tsum 化最容易漏的「一眼認得的輪廓線索」)。
     比寫實版再放大一號(0.06/0.34 → 0.078/0.44):後方視角看不到臉,
     一對豎在圓頭上的長耳朵就是唯一能讓人認出「這是驢」的東西。
     ★ 一定要用圓錐(rTop≈0)—— 拉長的球前端還是圓的,做不出尖耳(狼那次被退件的主因)。*/
  /* 🫏 大長耳=驢的身分證。放大到 0.082×0.46、推到 ±0.19(仍在頭的半寬 0.27 之內=還長在頭上)、
     往外撇 -0.5 ⇒ 側視/俯視/選單繞場都很搶眼。
     ⚠ **實測結論(別再為這件事調數字)**:預設鏡頭在驢的**正後方**,騎者比驢頭更靠近鏡頭,
       角張得更大 ⇒ **耳朵從正後方一定看不到**,除非把耳朵做得比頭還寬(那就變形了)。
       我試過從 ±0.135 推到 ±0.19,背面依舊被騎者完全遮住 —— 這是這個鏡頭+騎者配置的**幾何必然**,
       寫實版本來也一樣。背面能讀到的是**圓臀 + 尾末一撮**,那兩處已經做圓做足;
       想看整隻驢,遊戲本來就有側視(view 1)、俯視(view 2)與選單繞場。 */
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.082, 0.46, 8), coatMat);
    ear.position.set(side * 0.19, 0.34, -0.05);
    ear.rotation.z = side * -0.5;                   // 往外撇(比寫實版再撇一點,背面才露得出來)
    ear.rotation.x = -0.15;
    head.add(ear);
    const earInner = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.28, 6), whiteMat);
    earInner.position.set(side * 0.198, 0.33, -0.015);
    earInner.rotation.z = side * -0.5;
    earInner.rotation.x = -0.15;
    head.add(earInner);
  }
  /* 短鬃(驢的鬃毛短短一排立著,不像馬那樣長披)→ tsum 版用一排小毛球。
     ⚠ 第一版把毛球直接掛在 neckPivot 上、座標自己算 → 頸子是**斜的**(rotation.x=0.7),
       毛球卻沿著垂直方向排 ⇒ 兩條線發散,截圖看到的是「一串珠子飄在頸子旁邊」。
     正解=開一個**和頸子同一個旋轉**的 Group,毛球沿它的 local +y 排,就一定貼著頸背。
     (同一條坑:配件座標要跟著它依附的部位算,不能自己另起一套。) */
  const maneRail = new THREE.Group();
  maneRail.position.copy(neck.position);
  maneRail.rotation.x = neck.rotation.x;
  neckPivot.add(maneRail);
  for (let i = 0; i < 5; i += 1) {
    const f = i / 4;
    const tuft = tblob(0.058 - f * 0.008, maneMat, 1, 1.15, 1, 8);
    tuft.position.set(0, -0.2 + f * 0.5, -0.16);     // 沿頸的軸線排、往頸背(-z)貼
    maneRail.add(tuft);
  }
  const forelock = tblob(0.07, maneMat, 1.1, 0.9, 0.8, 8);
  forelock.position.set(0, HR * 0.9, HR * 0.1);
  head.add(forelock);

  /* 細尾+末端一撮(驢特徵)。★ rotation.x = 0.55 是**動畫基準**,不可改
     (甩尾寫的是 `0.55 + sin(...)`)。tsum 版把細桿換成兩顆球+一撮蓬毛。*/
  const tail = new THREE.Group();
  tail.position.set(0, 1.12, -0.92);
  tail.rotation.x = 0.55;
  [0.30, 0.62].forEach((f, i) => {
    const b = tblob(0.052 - i * 0.006, coatMat, 1, 1, 1, 8);
    b.position.y = -0.42 * f;
    tail.add(b);
  });
  const tailTuft = tblob(0.105, maneMat, 1, 1.25, 1, 10);   // 尾末一撮(驢特徵)
  tailTuft.position.y = -0.44;
  tail.add(tailTuft);
  rig.add(tail);

  /* 四腿:**關節結構、長度、pivot 位置全部與寫實版一字不差**(奔跑循環與蹄貼地靠它),
     只把膠囊加粗成 tsum 的短胖腿。蹄(方塊)刻意保留 —— 驢有蹄,換成肉球就不是驢了。*/
  const mkLeg = (x, z) => {
    const leg = createLimb({
      upperMaterial: coatMat,
      lowerMaterial: coatMat,
      endMaterial: hoofMat,
      upperLen: 0.42, lowerLen: 0.4,
      upperRadius: 0.088, lowerRadius: 0.072,   // 寫實版 0.065 / 0.05
      end: "foot",
    });
    leg.pivot.position.set(x, 0.95, z);
    rig.add(leg.pivot);
    return leg;
  };
  const legs = [mkLeg(-0.17, 0.54), mkLeg(0.17, 0.54), mkLeg(-0.17, -0.58), mkLeg(0.17, -0.58)];

  // 鞍=巴蘭自己備上驢的鞍布(民22:21)★ y 一律不動:騎者的位置是相對它算的
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.66), new THREE.MeshStandardMaterial({ color: 0x8a3b28, roughness: 0.9 }));
  saddle.position.set(0, 1.42, 0.05);
  rig.add(saddle);
  const cloth2 = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.04, 0.56), new THREE.MeshStandardMaterial({ color: 0xb06a3c, roughness: 0.9 }));
  cloth2.position.set(0, 1.39, 0.05);
  rig.add(cloth2);

  return { group, rig, body, neckPivot, head, tail, legs, saddle, coatMat, maneMat };
}

// ---------- 小驢駒(矩形身體鐵則的四足版,整體比馬小;介面與馬相同) ----------
// 驢特徵:大長耳往外撇、灰褐毛、白肚白鼻、短鬃、細尾末端一撮。
function makeDonkey({ coat = 0x8a7f72, mane = 0x4a4038 } = {}) {
  const group = new THREE.Group(); // 原點=地面、+z 朝前
  const coatMat = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.7 });
  const maneMat = new THREE.MeshStandardMaterial({ color: mane, roughness: 0.85 });
  // 材質共用:setHorseCoat 只要改這兩個材質的 color,全身(含頸/頭/腿)一起換
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 }); // 白肚白鼻
  const hoofMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6 });

  const rig = new THREE.Group();
  group.add(rig);

  // 軀幹:矩形箱體(小驢駒,比馬小一號),不用圓筒
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1.3), coatMat);
  body.position.set(0, 1.15, 0);
  rig.add(body);
  const chestCap = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.4, 0.32), coatMat);
  chestCap.position.set(0, 1.18, 0.72);
  rig.add(chestCap);
  const rump = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.4, 0.34), coatMat);
  rump.position.set(0, 1.16, -0.72);
  rig.add(rump);
  // 白肚(驢特徵)
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 1.0), whiteMat);
  belly.position.set(0, 0.94, 0);
  rig.add(belly);

  // 頸(斜上)+頭(兩側眼睛=臉部鐵則動物版)+大長耳
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.35, 0.8);
  rig.add(neckPivot);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.52, 0.28), coatMat);
  neck.rotation.x = 0.7;
  neck.position.set(0, 0.18, 0.14);
  neckPivot.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.44, 0.36);
  neckPivot.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.42), coatMat);
  skull.rotation.x = 0.35;
  head.add(skull);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.19, 0.26), whiteMat); // 白鼻(驢特徵)
  muzzle.position.set(0, -0.1, 0.28);
  muzzle.rotation.x = 0.35;
  head.add(muzzle);
  const faceWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const faceDarkMat = new THREE.MeshBasicMaterial({ color: 0x1c1712 });
  for (const side of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), faceWhiteMat);
    eyeWhite.position.set(side * 0.12, 0.06, 0.12);
    head.add(eyeWhite);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), faceDarkMat);
    pupil.position.set(side * 0.142, 0.06, 0.13);
    head.add(pupil);
    // 大長耳(驢的招牌):細長圓錐往外撇
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.34, 6), coatMat);
    ear.position.set(side * 0.11, 0.3, -0.04);
    ear.rotation.z = side * -0.42; // 往外撇
    ear.rotation.x = -0.15;
    head.add(ear);
    const earInner = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.2, 6), whiteMat);
    earInner.position.set(side * 0.115, 0.29, -0.01);
    earInner.rotation.z = side * -0.42;
    earInner.rotation.x = -0.15;
    head.add(earInner);
  }
  // 短鬃(驢的鬃毛短短一排立著,不像馬那樣長披)
  const maneCrest = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.56, 0.14), maneMat);
  maneCrest.rotation.x = 0.7;
  maneCrest.position.set(0, 0.26, -0.03);
  neckPivot.add(maneCrest);
  const forelock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.1), maneMat);
  forelock.position.set(0, 0.2, 0.06);
  head.add(forelock);

  // 細尾+末端一撮(驢特徵)
  const tail = new THREE.Group();
  tail.position.set(0, 1.12, -0.92);
  tail.rotation.x = 0.55;
  const tailShaft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.05), coatMat);
  tailShaft.position.y = -0.18;
  tail.add(tailShaft);
  const tailTuft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), maneMat);
  tailTuft.position.y = -0.44;
  tail.add(tailTuft);
  rig.add(tail);

  // 四腿(雙節+蹄):pivot=肩/髖(短腿=小驢駒)
  const mkLeg = (x, z) => {
    const leg = createLimb({
      upperMaterial: coatMat,
      lowerMaterial: coatMat,
      endMaterial: hoofMat,
      upperLen: 0.42, lowerLen: 0.4, upperRadius: 0.065, lowerRadius: 0.05,
      end: "foot",
    });
    leg.pivot.position.set(x, 0.95, z);
    rig.add(leg.pivot);
    return leg;
  };
  const legs = [
    mkLeg(-0.17, 0.54),
    mkLeg(0.17, 0.54),
    mkLeg(-0.17, -0.58),
    mkLeg(0.17, -0.58),
  ];

  // 鞍=鋪在驢背上的布(民22:21 巴蘭備驢):褐布兩層,沒有馬鞍
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.05, 0.66), new THREE.MeshStandardMaterial({ color: 0x8a3b28, roughness: 0.9 }));
  saddle.position.set(0, 1.42, 0.05);
  rig.add(saddle);
  const cloth2 = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.04, 0.56), new THREE.MeshStandardMaterial({ color: 0xb06a3c, roughness: 0.9 }));
  cloth2.position.set(0, 1.39, 0.05);
  rig.add(cloth2);

  return { group, rig, body, neckPivot, head, tail, legs, saddle, coatMat, maneMat };
}

export class BalaamDonkeyGame {
  constructor({ canvas, touchRoot }) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;

    const settings = loadSettings();
    this.difficulty = DIFFICULTY_PRESETS[settings.difficulty] ? settings.difficulty : "normal";
    this.modeId = GAME_MODES[settings.modeId] ? settings.modeId : "standard";
    this.mode = getModeConfig(this.modeId);
    this.coatId = HORSE_COATS[settings.horseCoat] ? settings.horseCoat : "greybrown";
    // 騎者畫風三態(auto/tsum/real);auto 依年齡分級決定 —— 見 resolveRiderTsum()
    this.riderStyle = ["auto", "tsum", "real"].includes(settings.riderStyle) ? settings.riderStyle : "auto";

    this.input = new InputManager();
    this.input.bindTouchButtons(this.touchRoot);

    this.onHudUpdate = null;
    this.onEvent = null;

    this.running = false; // ★只給主迴圈 RAF 用(athletics this.running 撞名事故鐵則)
    this.time = 0;
    this.phase = "menu"; // menu | gate | riding | jumping | finale(天使現形) | ended
    this.message = "在首頁選擇模式與難度後開始。";
    this.cameraView = 0; // 0 跟隨 1 側面轉播 2 高空 3 驢背視角
    this.autoSaveTimer = 0;

    // 賽況
    this.dist = 0;
    this.speed = 0;
    this.elapsed = 0;
    this.faults = 0;
    this.clears = 0;
    this.fenceIdx = 0;
    this.lastResult = null; // 'clear' | 'knock' | 'early' | null
    this.jumpAnim = null; // {t, dur, quality, height, fence}
    this.gallopT = 0;
    this.finishDist = 0;
    this.lap = 1;
    this.knockAnims = [];

    this.overlay = { visible: false, eyebrow: "", title: "", text: "", canResume: false };

    // ---- three ----
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fc4e8);
    this.scene.fog = new THREE.Fog(0x9fd0ee, 60, 160);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 240);
    this.camPos = new THREE.Vector3(0, 6, -14);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.camera.position.copy(this.camPos);

    this.clock = new THREE.Clock();

    this.buildCourse();
    this.setupScene();
    this.setupInput();

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.pushHud();
  }

  emitEvent(type, payload = {}) {
    if (this.onEvent) this.onEvent({ type, ...payload });
  }

  // ---------- 賽道(閉環樣條)+障礙 ----------
  buildCourse() {
    const pts = [];
    const RX = 30, RZ = 21;
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      const w = i % 2 === 0 ? 1.0 : 1.14; // 交錯外凸=直線與彎道交替的有機環
      pts.push(new THREE.Vector3(Math.cos(a) * RX * w, 0, Math.sin(a) * RZ * w));
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
    this.courseLen = this.curve.getLength();
  }

  posAt(dist) {
    const u = (((dist % this.courseLen) + this.courseLen) % this.courseLen) / this.courseLen;
    return this.curve.getPointAt(u);
  }

  tangentAt(dist) {
    const u = (((dist % this.courseLen) + this.courseLen) % this.courseLen) / this.courseLen;
    return this.curve.getTangentAt(u);
  }

  // 天使站(原欄架,判定不動只換皮):每站一位耶和華的使者站在路中——只有驢(玩家)看得見。
  // 站分三幕(照經文順序):前 1/3=田間寬路、中 1/3=葡萄園窄路、後 1/3=極窄山道。
  rebuildFences() {
    if (this.fenceGroup) this.scene.remove(this.fenceGroup);
    this.fenceGroup = new THREE.Group();
    this.fences = [];
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const n = preset.fences;
    for (let i = 0; i < n; i += 1) {
      const d = this.courseLen * ((i + 1) / (n + 1));
      const act = Math.min(2, Math.floor(((i + 1) / (n + 1)) * 3)); // 0 田間 1 葡萄園 2 極窄之處(用里程比對齊場景,邊界站不錯幕)
      const p = this.posAt(d);
      const t = this.tangentAt(d);
      const yaw = Math.atan2(t.x, t.z);
      const g = new THREE.Group();
      g.position.copy(p);
      g.rotation.y = yaw;
      const angel = makeAngel({ pose: "low" }); // 低姿防穿模(高弧跳得過,低弧祂會閃身)
      angel.group.rotation.y = Math.PI; // 面向來路(驢迎面而來)
      g.add(angel.group);
      this.fenceGroup.add(g);
      this.fences.push({ dist: d, group: g, angel, act, knocked: false, resolved: false, phaseSeed: i * 1.7 });
    }
    this.scene.add(this.fenceGroup);
    this.knockAnims = [];
  }

  // ---------- 場景 ----------
  setupScene() {
    const sun = new THREE.HemisphereLight(0xffffff, 0x557040, 1.3);
    this.scene.add(sun);
    const key = new THREE.DirectionalLight(0xfff2d4, 1.9);
    key.position.set(30, 50, -20);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ccbff, 0.6);
    rim.position.set(-25, 30, 25);
    this.scene.add(rim);

    // 摩押曠野:乾土原+土路(無城牆、無群眾——路上只有驢、巴蘭,和只有驢看得見的使者)
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshStandardMaterial({ color: 0xa89468, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.02;
    this.scene.add(grass);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(96, 72), new THREE.MeshStandardMaterial({ color: 0xc9b088, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    this.scene.add(sand);

    // 土路帶(把路線畫在地上,孩子一眼看懂要走哪)
    const laneMat = new THREE.MeshBasicMaterial({ color: 0xd8c49a });
    for (let i = 0; i < 120; i += 1) {
      const d = (i / 120) * this.courseLen;
      const p = this.posAt(d);
      const t = this.tangentAt(d);
      const dot = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), laneMat);
      dot.rotation.order = "YXZ"; // 先繞 y 對齊路徑方向,再倒平到地面(XYZ 順序會變鋸齒)
      dot.rotation.y = Math.atan2(t.x, t.z);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(p.x, 0.012, p.z);
      this.scene.add(dot);
    }

    // 驢+騎在背上的巴蘭(玩家操控驢;巴蘭是引擎控 NPC——他看不見天使);毛色照設定
    const coat = HORSE_COATS[this.coatId] || HORSE_COATS.greybrown;
    /* 🧸 動物一律 tsum(0730 使用者拍板的全艦隊畫風政策)。
       這隻驢與 donkey-jerusalem3d **共用同一份程式碼**(兩站的 makeDonkey 去註解後逐行相同),
       所以造型改一次、兩站一起換。TSUM_MOUNT=false 回寫實;寫實版刻意保留不刪。 */
    this.horse = (TSUM_MOUNT ? makeDonkeyTsum : makeDonkey)({ coat: coat.coat, mane: coat.mane });
    this.scene.add(this.horse.group);
    this.rider = makeBalaamRider(resolveRiderTsum(this.riderStyle, this.difficulty));
    poseBalaamOnDonkey(this.rider);
    this.horse.rig.add(this.rider.group);

    this.buildActScenery();
    this.rebuildFences();

    // 橄欖樹(曠野稀疏幾棵,遠離路)
    const oliveMat = new THREE.MeshStandardMaterial({ color: 0x708a5a, roughness: 1 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b533a, roughness: 0.95 });
    for (const [x, z] of [[-62, 20], [60, 24], [-30, 55], [40, -55]]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 2.4, 8), trunkMat);
      trunk.position.set(x, 1.2, z);
      this.scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 10), oliveMat);
      crown.scale.set(1.15, 0.8, 1.15);
      crown.position.set(x, 3.6, z);
      this.scene.add(crown);
    }

    // 遠山(摩押曠野天際線,霧裡遠望)
    const hillMat = new THREE.MeshStandardMaterial({ color: 0x9a866a, roughness: 1 });
    for (const [x, z, r, h] of [[-70, -70, 26, 14], [10, -85, 34, 18], [80, -60, 24, 12], [90, 40, 28, 15], [-90, 50, 30, 13], [-20, 80, 30, 16]]) {
      const hill = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), hillMat);
      hill.position.set(x, h / 2 - 0.5, z);
      this.scene.add(hill);
    }

    this.placeHorse();
  }

  // 三幕場景沿賽道鋪設(照經文順序,對應天使站的 act):
  // ①里程 0~L/3=田間寬路(路旁綠斑莊稼田,民22:23「驢就從路上跨進田間」)
  // ②L/3~2L/3=葡萄園窄路(民22:24「葡萄園的窄路上,這邊有牆,那邊也有牆」)
  // ③2L/3~L=極窄之處(民22:26「左右都沒有轉折的地方」,兩側高石壁)
  buildActScenery() {
    const L = this.courseLen;
    const sideOf = (t) => new THREE.Vector3(t.z, 0, -t.x);
    // ① 田間:路旁大片綠斑
    const fieldMat = new THREE.MeshStandardMaterial({ color: 0x6f9a4e, roughness: 1 });
    for (let i = 0; i < 26; i += 1) {
      const d = (i / 26) * (L / 3);
      const p = this.posAt(d);
      const s = sideOf(this.tangentAt(d));
      for (const sd of [-1, 1]) {
        const off = 3.2 + ((i * 7 + (sd > 0 ? 3 : 0)) % 5);
        const patch = new THREE.Mesh(new THREE.CircleGeometry(1.6 + ((i + (sd > 0 ? 1 : 0)) % 3) * 0.7, 10), fieldMat);
        patch.rotation.x = -Math.PI / 2;
        patch.position.set(p.x + s.x * sd * off, 0.015, p.z + s.z * sd * off);
        this.scene.add(patch);
      }
    }
    // ② 葡萄園窄路:兩側矮石牆+牆外葡萄藤(木樁+一串串綠 Box)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xa89a80, roughness: 0.95 });
    const vineMat = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.9 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x6b533a, roughness: 0.95 });
    for (let i = 0; i < 40; i += 1) {
      const d = L / 3 + (i / 40) * (L / 3);
      const p = this.posAt(d);
      const t = this.tangentAt(d);
      const s = sideOf(t);
      const yaw = Math.atan2(t.x, t.z);
      for (const sd of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 3.4), wallMat);
        wall.position.set(p.x + s.x * sd * 2.3, 0.4, p.z + s.z * sd * 2.3);
        wall.rotation.y = yaw;
        this.scene.add(wall);
        if (i % 2 === 0) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.12), postMat);
          post.position.set(p.x + s.x * sd * 4.2, 0.7, p.z + s.z * sd * 4.2);
          this.scene.add(post);
          for (let k = 0; k < 3; k += 1) {
            const vine = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.34), vineMat);
            vine.position.set(p.x + s.x * sd * 4.2, 1.15 - k * 0.34, p.z + s.z * sd * 4.2 + (k % 2 ? 0.18 : -0.18));
            this.scene.add(vine);
          }
        }
      }
    }
    // ③ 極窄之處:兩側高石壁(高低錯落的山道)
    const cliffMat = new THREE.MeshStandardMaterial({ color: 0x8d7f6a, roughness: 1 });
    for (let i = 0; i < 40; i += 1) {
      const d = (2 * L) / 3 + (i / 40) * (L / 3);
      const p = this.posAt(d);
      const t = this.tangentAt(d);
      const s = sideOf(t);
      const yaw = Math.atan2(t.x, t.z);
      for (const sd of [-1, 1]) {
        const h = 2.2 + ((i * 3 + (sd > 0 ? 1 : 0)) % 3) * 0.7;
        const cliff = new THREE.Mesh(new THREE.BoxGeometry(1.1, h, 3.4), cliffMat);
        cliff.position.set(p.x + s.x * sd * 1.9, h / 2, p.z + s.z * sd * 1.9);
        cliff.rotation.y = yaw;
        this.scene.add(cliff);
      }
    }
  }

  placeHorse() {
    const p = this.posAt(this.dist);
    const t = this.tangentAt(this.dist);
    this.horse.group.position.set(p.x, this.jumpY(), p.z);
    this.horse.group.rotation.y = Math.atan2(t.x, t.z);
  }

  jumpY() {
    if (!this.jumpAnim) return 0;
    const k = clamp(this.jumpAnim.t, 0, 1);
    // 防穿模幾何:弧峰對齊「與天使交會點」(k0=起跳當下距站里程/跳程)——
    // 乾淨高弧在天使正上方時 jumpY=height(1.6+),必大於天使總高 1.35+0.2 餘量。
    const k0 = this.jumpAnim.k0 ?? 0.5;
    const s = k <= k0
      ? Math.sin((Math.PI / 2) * (k / Math.max(k0, 0.01)))
      : Math.sin((Math.PI / 2) * ((1 - k) / Math.max(1 - k0, 0.01)));
    return s * this.jumpAnim.height;
  }

  // ---------- 輸入 ----------
  setupInput() {
    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.jump();
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  // ---------- 局面控制 ----------
  applyPresentation({ difficulty, modeId, horseCoat, riderStyle }) {
    if (difficulty && DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    if (modeId && GAME_MODES[modeId]) {
      this.modeId = modeId;
      this.mode = getModeConfig(modeId);
    }
    if (horseCoat && HORSE_COATS[horseCoat]) this.setHorseCoat(horseCoat);
    if (riderStyle && ["auto", "tsum", "real"].includes(riderStyle)) this.riderStyle = riderStyle;
    /* ★ 難度也要觸發重建:riderStyle=auto 時畫風是難度決定的。*/
    this.rebuildRider();
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId, riderStyle: this.riderStyle });
    this.message = `${this.mode.label} · ${DIFFICULTY_LABELS[this.difficulty]} · ${HORSE_COATS[this.coatId].label}驢 已設定。`;
    this.pushHud();
  }

  // 換毛色:全身共用 coatMat/maneMat,改材質色即可(不重建驢駒)
  /* 換騎者畫風:騎者是一整個模型,只能**重建**。
     ★ 重建後一定要重跑 poseBalaamOnDonkey():坐姿寫在四肢 rotation 上,不重跑會「站在驢背上」。*/
  rebuildRider() {
    if (!this.horse) return;
    const wantTsum = resolveRiderTsum(this.riderStyle, this.difficulty);
    if (this.rider) {
      this.horse.rig.remove(this.rider.group);
      this.rider.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.rider = makeBalaamRider(wantTsum);
    poseBalaamOnDonkey(this.rider);
    this.horse.rig.add(this.rider.group);
  }

  setRiderStyle(style) {
    if (!["auto", "tsum", "real"].includes(style)) return;
    this.riderStyle = style;
    this.rebuildRider();
  }

  setHorseCoat(coatId) {
    if (!HORSE_COATS[coatId]) return;
    this.coatId = coatId;
    if (this.horse) {
      this.horse.coatMat.color.setHex(HORSE_COATS[coatId].coat);
      this.horse.maneMat.color.setHex(HORSE_COATS[coatId].mane);
    }
  }

  openHomeMenu() {
    this.phase = "menu";
    if (this.confetti) {
      for (const c of this.confetti) this.scene.remove(c.mesh);
      this.confetti = [];
    }
    this.message = "在首頁選擇模式與難度後開始。";
    this.overlay.visible = false;
    this.pushHud();
  }

  startSelectedMatch() {
    this.dist = 0;
    this.speed = 0;
    this.elapsed = 0;
    this.faults = 0;
    this.clears = 0;
    this.fenceIdx = 0;
    this.lastResult = null;
    this.jumpAnim = null;
    this.lap = 1;
    this.rebuildFences();
    this.finishDist = this.fences.length ? this.fences[this.fences.length - 1].dist + 22 : this.courseLen;
    this.knockSlowT = 9;
    this.beatT = 9; // 巴蘭揮杖演出計時(9=閒置)
    this.headShakeT = 9; // 驢委屈搖頭計時
    this.finaleT = 0;
    if (this.finaleAngel) {
      this.scene.remove(this.finaleAngel.group);
      this.finaleAngel = null;
    }
    if (this.rider) this.rider.rig.rotation.x = 0; // 終局俯伏姿勢還原
    this.placeHorse();
    // 出發鏡頭直接切到驢駒後方(joash 教訓:lerp 穿場=整幀糊掉)
    const t0 = this.tangentAt(0);
    const p0 = this.posAt(0);
    this.camPos.set(p0.x - t0.x * 9, 4.6, p0.z - t0.z * 9);
    this.camLook.set(p0.x, 1.4, p0.z);
    this.phase = "gate";
    this.message = "按「避讓鍵」出發!沿曠野土路前行,天使擋路時抓綠區及時避讓!";
    this.emitEvent("match-start", { mode: this.mode.label });
    this.pushHud();
  }

  // 出發/穩步共用(空白鍵/點畫面/觸控穩步鍵)
  jump() {
    if (this.overlay.visible) return;
    if (this.phase === "gate") {
      this.phase = "riding";
      this.speed = DIFFICULTY_PRESETS[this.difficulty].baseSpeed * 0.6;
      this.message = "出發!按住「快步」提速——路上的使者只有你看得見。";
      this.emitEvent("gate", {});
      this.pushHud();
      return;
    }
    if (this.phase !== "riding") return;
    const fence = this.fences[this.fenceIdx];
    if (!fence) return;
    const distToFence = fence.dist - this.dist;
    if (distToFence > APPROACH_M) {
      // 離天使還遠就按=小碎步一下,不罰但提示(溫柔)
      this.startJump(fence, 0.35, true);
      this.lastResult = "early";
      this.message = "太早了——等天使靠近、時機條進綠區再避讓!";
      this.emitEvent("fence-early", {});
      this.pushHud();
      return;
    }
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const err = Math.abs(distToFence - TAKEOFF_D) / Math.max(this.speed, 1);
    let quality = clamp(1 - err / (preset.window * 2.2), 0, 1); // skijump 綠區同款判定式
    quality = clamp(quality + preset.assist * (1 - quality), 0, 1); // 幼兒輔助:往綠區拉
    this.startJump(fence, quality, false);
  }

  startJump(fence, quality, hop) {
    const dur = (hop ? JUMP_SPAN * 0.6 : JUMP_SPAN) / Math.max(this.speed, 3);
    const clean = !hop && quality >= 0.5;
    const d0 = fence ? fence.dist - this.dist : JUMP_SPAN * 0.5;
    this.jumpAnim = {
      t: 0,
      dur,
      quality,
      // 防穿模:乾淨避讓=高弧(1.6+q*0.5,峰值>天使總高1.35+餘量);
      // 弱跳/遲疑=低弧(0.4+q*0.25)——低弧交會時天使會閃身讓開(update 內),一樣不穿模。
      height: hop ? 0.3 : clean ? 1.6 + quality * 0.5 : 0.4 + quality * 0.25,
      k0: hop || !fence ? 0.5 : clamp(d0 / JUMP_SPAN, 0.2, 0.8),
      fence: hop ? null : fence,
    };
    this.phase = "jumping";
    this.emitEvent("jump", { quality, hop });
  }

  resolveFence(fence, quality) {
    fence.resolved = true;
    const clean = quality >= 0.5; // 引擎判定不動:門檻 0.5
    // 三幕避讓文案照經文順序(民22:23/24-25/26-27)
    const ACT_CLEAR = [
      "驢轉入田間,避開了使者的刀!",
      "窄路兩邊有牆——驢貼著牆擠過去了!",
      "極窄之處無法轉身——驢臥下讓過,護住了主人!",
    ];
    if (clean) {
      this.clears += 1;
      this.lastResult = "clear";
      const perfect = quality >= 0.88;
      this.message = (perfect ? "完美!" : "") + ACT_CLEAR[fence.act ?? 0];
      this.knockAnims.push({ fence, t: 0, type: "avoid" }); // 判定=畫面:及時避讓=天使光暈柔和一閃
      this.emitEvent("fence-clear", { idx: this.fenceIdx + 1, perfect, act: fence.act ?? 0 });
    } else {
      fence.knocked = true;
      this.faults += 4;
      this.lastResult = "knock";
      this.knockSlowT = 0; // 驢受驚踉蹌減速一下
      this.beatT = 0; // 巴蘭揮杖(溫柔化演出:輕揮兩下,不血腥)
      this.headShakeT = 0; // 驢委屈搖頭
      this.message = "驢遲疑了——巴蘭的杖落下!+4 罰分(他看不見天使啊)。";
      this.knockAnims.push({ fence, t: 0, type: "flare" }); // 判定=畫面:遲疑=天使光暈急促閃動
      this.emitEvent("fence-knock", { idx: this.fenceIdx + 1, faults: this.faults, act: fence.act ?? 0 });
    }
    this.fenceIdx += 1;
    // 練習小路:走完一輪重置天使站再來一圈(站點里程推進到下一圈)
    if (this.mode.endless && this.fenceIdx >= this.fences.length) {
      this.fenceIdx = 0;
      this.lap += 1;
      for (const f of this.fences) {
        f.resolved = false;
        f.knocked = false;
        f.dist += this.courseLen;
      }
      this.finishDist += this.courseLen;
    }
  }

  // 零罰分慶祝(07-15 使用者提議:天上掉彩花/花瓣/彩帶):
  // 尊重 prefers-reduced-motion;彩紙+花瓣+彩帶三種形狀,7 秒自然落完
  spawnConfetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!this.confetti) this.confetti = [];
    const colors = [0xffd24a, 0xff6b81, 0x7de08c, 0x6ec6ff, 0xc890ff, 0xffa050, 0xf5f0e0];
    const p = this.posAt(this.dist);
    for (let i = 0; i < 160; i += 1) {
      const kind = i % 3; // 0 彩紙方片 1 花瓣圓片 2 彩帶長條
      const geo = kind === 0
        ? new THREE.PlaneGeometry(0.16, 0.16)
        : kind === 1
          ? new THREE.CircleGeometry(0.1, 6)
          : new THREE.PlaneGeometry(0.06, 0.5);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true, opacity: 0.95,
      }));
      mesh.position.set(p.x + (Math.random() * 2 - 1) * 14, 8 + Math.random() * 7, p.z + (Math.random() * 2 - 1) * 14);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(mesh);
      this.confetti.push({
        mesh,
        vy: 1.2 + Math.random() * 1.6,
        swayA: Math.random() * Math.PI * 2,
        swayF: 1.5 + Math.random() * 2,
        spin: (Math.random() * 2 - 1) * 3,
        t: 0,
      });
    }
  }

  finishCourse() {
    // 終局演出(民22:31,overlay 前簡短即可):耶和華使巴蘭的眼目明亮——
    // 大天使現形在路中、全場天使光暈增亮,巴蘭漸漸低頭俯伏,3.4 秒後才進結算。
    this.phase = "finale";
    this.finaleT = 0;
    const p = this.posAt(this.dist + 7);
    const t = this.tangentAt(this.dist + 7);
    const angel = makeAngel({ pose: "stand" }); // 終局站立全高(驢已停步,不會交會穿模)
    angel.group.position.set(p.x, 0, p.z);
    angel.group.rotation.y = Math.atan2(t.x, t.z) + Math.PI; // 面向驢與巴蘭
    angel.group.scale.setScalar(1.25);
    this.scene.add(angel.group);
    this.finaleAngel = angel;
    this.message = "當時，耶和華使巴蘭的眼目明亮，他就看見耶和華的使者站在路上，手裡有拔出來的刀，巴蘭便低頭俯伏在地。(民數記 22:31)";
    this.emitEvent("finale", {});
    this.pushHud();
  }

  // 結算(終局演出後):零罰分=驢兒忠心(民22:33);有罰分=驢開口(民22:28)。永不會輸。
  showFinishOverlay() {
    this.phase = "ended";
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const overTime = Math.max(0, this.elapsed - preset.timeAllowed);
    const timeFaults = preset.timeAllowed >= 999 ? 0 : Math.ceil(overTime / 4);
    const total = this.faults + timeFaults;
    const timeText = `${this.elapsed.toFixed(1)} 秒`;
    const clearRound = total === 0;
    this.overlay = {
      visible: true,
      eyebrow: clearRound ? "驢兒忠心!" : "走完了",
      title: clearRound ? "牠救了主人的命!" : `挨打 ${this.faults / 4} 次`,
      text: clearRound
        ? `完美的一程!${timeText},一次都沒挨打。「驢看見我就三次從我面前偏過去；驢若沒有偏過去，我早把你殺了，留牠存活。」(民數記 22:33)`
        : `挨打 ${this.faults / 4} 次${timeFaults ? ` + 超時 ${timeFaults} 罰分` : ""},用時 ${timeText}。耶和華叫驢開口，對巴蘭說：「我向你行了甚麼，你竟打我這三次呢？」(民數記 22:28)——再走一趟,及時避讓護主人!`,
      canResume: false,
    };
    if (clearRound) this.spawnConfetti();
    this.emitEvent("finish", { faults: total, elapsed: this.elapsed, clearRound });
    this.message = `走完曠野之路——罰分 ${total},${timeText}。`;
    this.saveGame(true);
    this.pushHud();
  }

  togglePause() {
    if (this.phase === "menu" || this.phase === "ended" || this.phase === "finale") return;
    if (this.overlay.visible) {
      this.resume();
    } else {
      this.overlay = { visible: true, eyebrow: "暫停中", title: "喘口氣", text: "驢也歇歇蹄,準備好再繼續。", canResume: true };
      this.pushHud();
    }
  }

  resume() {
    if (!this.overlay.canResume) return;
    this.overlay.visible = false;
    this.pushHud();
  }

  cycleCameraView() {
    this.cameraView = (this.cameraView + 1) % 4;
    const names = ["跟隨視角", "側面視角", "高空俯瞰", "驢背視角"];
    this.message = `視角:${names[this.cameraView]}。`;
    this.pushHud();
  }

  // ---------- 主迴圈 ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.update(delta);
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height || 1.6;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  update(delta) {
    this.time += delta;
    const paused = this.overlay.visible;

    if (!paused && (this.phase === "riding" || this.phase === "jumping")) {
      this.elapsed += delta;
      const preset = DIFFICULTY_PRESETS[this.difficulty];
      const boosting = this.input.isDown("up") || this.input.isDown("sprint");
      const slowing = this.input.isDown("down");
      let target = preset.baseSpeed + (boosting ? preset.boost : 0) - (slowing ? 2.2 : 0);
      this.knockSlowT = (this.knockSlowT ?? 9) + delta;
      if (this.knockSlowT < 1.2) target *= 0.6; // 受驚=小踉蹌收步,馬上穩回來
      this.speed += (Math.max(3, target) - this.speed) * Math.min(1, delta * 1.8);
      this.dist += this.speed * delta;
      this.gallopT += delta * (this.speed / 8);

      if (this.phase === "jumping" && this.jumpAnim) {
        this.jumpAnim.t += delta / this.jumpAnim.dur;
        if (this.jumpAnim.t >= 1) {
          const jump = this.jumpAnim;
          this.jumpAnim = null;
          this.phase = "riding";
          if (jump.fence) this.resolveFence(jump.fence, jump.quality);
        }
      } else if (this.phase === "riding") {
        // 沒按避讓就衝到使者跟前=驢自己撐一下(溫柔:不停不摔,但多半遲疑挨打)
        const fence = this.fences[this.fenceIdx];
        if (fence && fence.dist - this.dist <= 0.5 && !fence.resolved) {
          this.startJump(fence, 0.18, false);
          this.message = "來不及避讓——驢自己撐了一下!";
        }
      }

      if (!this.mode.endless && this.dist >= this.finishDist && this.phase !== "ended") {
        this.finishCourse();
      }
    }

    // 終局演出:驢緩緩停步、巴蘭漸漸俯伏(updateHorsePose 內),3.4 秒後進結算
    if (!paused && this.phase === "finale") {
      this.finaleT += delta;
      this.speed += (0 - this.speed) * Math.min(1, delta * 2.2);
      this.dist += this.speed * delta;
      this.gallopT += delta * (this.speed / 8);
      if (this.finaleT >= 3.4) this.showFinishOverlay();
    }

    // 天使:微微上下浮動+光暈/刀光脈動+雙翼輕擺(只有驢看得見的超自然感)
    if (this.fences) {
      for (const f of this.fences) {
        const a = f.angel;
        if (!a) continue;
        const boost = this.phase === "finale" ? 0.1 : 0; // 終局:全場天使增亮
        a.group.position.y = 0.12 + Math.sin(this.time * 1.6 + f.phaseSeed) * 0.08;
        a.aura.material.opacity = 0.13 + boost + (Math.sin(this.time * 2.3 + f.phaseSeed) + 1) * 0.045;
        a.swordGlowMat.opacity = 0.75 + (Math.sin(this.time * 3.1 + f.phaseSeed) + 1) * 0.12;
        for (let w = 0; w < a.wings.length; w += 1) {
          a.wings[w].rotation.z = a.wingBase[w] + (w === 0 ? -1 : 1) * Math.sin(this.time * 1.9 + f.phaseSeed) * 0.08;
        }
        // 防穿模②:低弧(弱跳/沒跳)交會時,天使「閃身讓開」1.2 單位+白光一閃
        // (民22 使者的主動性:攔路的是祂,讓路的也是祂);高弧(乾淨避讓)祂站定,驢從正上方越過。
        const df = f.dist - this.dist;
        const meeting = (this.phase === "riding" || this.phase === "jumping") && Math.abs(df) < 2.8;
        const lowArc = !this.jumpAnim || (this.jumpAnim.height ?? 0) < 1.55;
        const dodgeTarget = meeting && lowArc ? 1 : 0;
        f.dodge01 = f.dodge01 ?? 0;
        if (dodgeTarget === 1 && f.dodge01 < 0.04) f.flashT = 0; // 閃身起手=白光(靈體顯現語意)
        f.dodge01 += (dodgeTarget - f.dodge01) * Math.min(1, delta * 14);
        a.group.position.x = f.dodge01 * 1.2;
        f.flashT = (f.flashT ?? 9) + delta;
        if (f.flashT < 0.35) a.aura.material.opacity += 0.5 * (1 - f.flashT / 0.35);
      }
    }
    if (this.finaleAngel) {
      const a = this.finaleAngel;
      a.group.position.y = 0.12 + Math.sin(this.time * 1.6) * 0.1;
      a.aura.material.opacity = 0.2 + (Math.sin(this.time * 2.3) + 1) * 0.05;
      a.swordGlowMat.opacity = 0.8 + (Math.sin(this.time * 3.1) + 1) * 0.1;
      for (let w = 0; w < a.wings.length; w += 1) {
        a.wings[w].rotation.z = a.wingBase[w] + (w === 0 ? -1 : 1) * Math.sin(this.time * 1.9) * 0.1;
      }
    }
    // 判定=畫面:及時避讓=天使光暈柔和一閃;遲疑挨打=光暈急促閃動(天使不動手,刀始終只是「拔出來的」)
    for (const k of this.knockAnims) {
      k.t += delta;
      const decay = Math.max(0, 1 - k.t / 1.4);
      const freq = k.type === "avoid" ? 6 : 15;
      const amp = k.type === "avoid" ? 0.12 : 0.18;
      if (k.fence.angel) {
        k.fence.angel.aura.material.opacity = 0.14 + Math.abs(Math.sin(k.t * freq)) * amp * decay + 0.05 * decay;
      }
    }
    this.knockAnims = this.knockAnims.filter((k) => k.t < 1.4);

    // 挨打演出(溫柔化,不血腥):巴蘭右臂輕揮杖兩下+驢委屈搖頭低頭
    this.beatT = (this.beatT ?? 9) + delta;
    if (this.rider) {
      if (this.beatT < 1.0) {
        const k = this.beatT / 1.0;
        const swing = Math.max(0, Math.sin(k * Math.PI * 4)) * 0.85 * (1 - k * 0.5);
        this.rider.rightArm.pivot.rotation.x = -1.15 - swing;
      } else {
        this.rider.rightArm.pivot.rotation.x = -1.15; // 收杖回持杖姿
      }
    }
    this.headShakeT = (this.headShakeT ?? 9) + delta;
    if (this.horse) {
      if (this.headShakeT < 1.2) {
        const decay = 1 - this.headShakeT / 1.2;
        this.horse.head.rotation.z = Math.sin(this.headShakeT * 14) * 0.3 * decay;
        this.horse.head.rotation.x = 0.18 * decay; // 低頭委屈
      } else {
        this.horse.head.rotation.z = 0;
        this.horse.head.rotation.x = 0;
      }
    }

    // 彩花飄落(零罰分慶祝):左右搖曳+自旋,7 秒淡出回收
    if (this.confetti && this.confetti.length) {
      for (const c of this.confetti) {
        c.t += delta;
        c.mesh.position.y -= c.vy * delta;
        c.mesh.position.x += Math.sin(c.swayA + c.t * c.swayF) * delta * 1.2;
        c.mesh.rotation.x += c.spin * delta;
        c.mesh.rotation.z += c.spin * 0.7 * delta;
        if (c.t > 5.5) c.mesh.material.opacity = Math.max(0, 0.95 * (1 - (c.t - 5.5) / 1.5));
      }
      this.confetti = this.confetti.filter((c) => {
        if (c.t >= 7 || c.mesh.position.y < -0.5) {
          this.scene.remove(c.mesh);
          return false;
        }
        return true;
      });
    }

    this.handleKeys();
    this.updateHorsePose();
    this.placeHorse();
    this.updateCamera(delta);

    this.autoSaveTimer += delta;
    if (this.autoSaveTimer > 5) {
      this.autoSaveTimer = 0;
      this.saveGame(true);
    }

    this.input.endFrame();
    this.pushHud();
  }

  handleKeys() {
    if (this.input.consumePress("camera")) this.cycleCameraView();
    if (this.input.consumePress("pause")) this.togglePause();
    if (this.overlay.visible) return;
    if (this.input.consumePress("shoot")) this.jump();
  }

  updateHorsePose() {
    const h = this.horse;
    if (!h) return;
    if (this.phase === "jumping" && this.jumpAnim) {
      // 起跳:前腿收、後腿蹬、身體沿弧線俯仰;騎手前傾(two-point 跳姿)
      const k = clamp(this.jumpAnim.t, 0, 1);
      const pitch = Math.cos(Math.PI * k) * 0.35;
      h.rig.rotation.x = -pitch;
      h.rig.position.y = 0;
      const tuck = Math.sin(Math.PI * k);
      h.legs[0].pivot.rotation.x = -1.3 * tuck;
      h.legs[1].pivot.rotation.x = -1.3 * tuck;
      h.legs[0].joint.rotation.x = 1.8 * tuck;
      h.legs[1].joint.rotation.x = 1.8 * tuck;
      h.legs[2].pivot.rotation.x = 0.85 * tuck;
      h.legs[3].pivot.rotation.x = 0.85 * tuck;
      h.legs[2].joint.rotation.x = 0.5 * tuck;
      h.legs[3].joint.rotation.x = 0.5 * tuck;
      h.neckPivot.rotation.x = -0.25 + pitch * 0.4;
      if (this.rider) this.rider.rig.rotation.x = 0.4 * tuck;
      return;
    }
    // 奔跑循環:相位錯開的四腿擺動(簡化 canter)
    const sp = this.phase === "riding" ? this.speed : 0;
    const amp = clamp(sp / 14, 0, 0.62);
    const t = this.gallopT * Math.PI * 2;
    const phases = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
    h.legs.forEach((leg, i) => {
      leg.pivot.rotation.x = Math.sin(t + phases[i]) * amp;
      leg.joint.rotation.x = Math.max(0, Math.sin(t + phases[i] + 0.8)) * amp * 1.3;
    });
    h.rig.rotation.x = 0;
    h.rig.position.y = Math.abs(Math.sin(t)) * amp * 0.14;
    h.neckPivot.rotation.x = Math.sin(t) * amp * 0.12;
    h.tail.rotation.x = 0.55 + Math.sin(t * 0.9) * 0.15;
    if (this.rider) {
      // 終局(民22:31):巴蘭看見天使,漸漸低頭俯伏;平時=隨步伐微前傾
      this.rider.rig.rotation.x = this.phase === "finale"
        ? Math.min(0.95, (this.finaleT || 0) * 0.55)
        : amp * 0.18;
    }
  }

  updateCamera(delta) {
    const p = this.posAt(this.dist);
    const t = this.tangentAt(this.dist);
    const y = this.jumpY();
    let desiredPos;
    let desiredLook;
    if (this.phase === "menu") {
      // 選單:慢速繞場巡禮
      const a = this.time * 0.08;
      desiredPos = new THREE.Vector3(Math.cos(a) * 40, 12, Math.sin(a) * 40);
      desiredLook = new THREE.Vector3(0, 1, 0);
    } else if (this.phase === "finale") {
      // 終局:側面取景讓「驢+俯伏的巴蘭」和「現形的大天使」同框;進場瞬間硬切(切場面硬切鐵則)
      const sideV = new THREE.Vector3(t.z, 0, -t.x);
      desiredPos = new THREE.Vector3(p.x + sideV.x * 8 + t.x * 2.8, 3.4, p.z + sideV.z * 8 + t.z * 2.8);
      desiredLook = new THREE.Vector3(p.x + t.x * 3.2, 1.5, p.z + t.z * 3.2);
      if (this.finaleT < 0.1) {
        this.camPos.copy(desiredPos);
        this.camLook.copy(desiredLook);
      }
    } else if (this.cameraView === 0) {
      desiredPos = new THREE.Vector3(p.x - t.x * 8.6, 4.4 + y * 0.5, p.z - t.z * 8.6);
      desiredLook = new THREE.Vector3(p.x + t.x * 7, 1.3 + y, p.z + t.z * 7);
    } else if (this.cameraView === 1) {
      const side = new THREE.Vector3(t.z, 0, -t.x);
      desiredPos = new THREE.Vector3(p.x + side.x * 13, 3.6, p.z + side.z * 13);
      desiredLook = new THREE.Vector3(p.x, 1.2 + y, p.z);
    } else if (this.cameraView === 2) {
      desiredPos = new THREE.Vector3(p.x + 3, 26, p.z + 3);
      desiredLook = new THREE.Vector3(p.x + t.x * 6, 0.5, p.z + t.z * 6);
    } else {
      desiredPos = new THREE.Vector3(p.x - t.x * 0.6, 2.5 + y, p.z - t.z * 0.6);
      desiredLook = new THREE.Vector3(p.x + t.x * 12, 1.2 + y, p.z + t.z * 12);
    }
    const k = 1 - Math.exp(-delta * 3.2);
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // ---------- HUD ----------
  pushHud() {
    if (!this.onHudUpdate) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const fence = this.fences && this.fences[this.fenceIdx];
    const distToFence = fence ? Math.max(0, fence.dist - this.dist) : null;
    // 避讓時機條:進 APPROACH_M 內開始充,到理想避讓點=滿;err<window=綠區
    let approach01 = 0;
    let inWindow = false;
    if ((this.phase === "riding" || this.phase === "jumping") && fence && distToFence !== null && distToFence <= APPROACH_M) {
      approach01 = clamp(1 - (distToFence - TAKEOFF_D) / (APPROACH_M - TAKEOFF_D), 0, 1);
      const err = Math.abs(distToFence - TAKEOFF_D) / Math.max(this.speed, 1);
      inWindow = err <= preset.window;
    }
    const phaseLabels = { menu: "主選單", gate: "出發點", riding: "前行", jumping: "避讓", finale: "天使現形", ended: "結局" };
    const mins = Math.floor(this.elapsed / 60);
    const secs = (this.elapsed % 60).toFixed(1).padStart(4, "0");
    this.onHudUpdate({
      faults: this.faults,
      clears: this.clears,
      fenceIdx: this.fences && this.fences.length ? Math.min(this.fenceIdx + 1, this.fences.length) : 1,
      fenceCount: this.fences ? this.fences.length : 0,
      lap: this.lap,
      endless: !!this.mode.endless,
      timeText: `${mins}:${secs}`,
      timeAllowed: preset.timeAllowed >= 999 ? "不限時" : preset.timeAllowed + " 秒",
      modeLabel: this.mode.label,
      difficultyLabel: DIFFICULTY_LABELS[this.difficulty],
      phaseLabel: phaseLabels[this.phase] || "",
      message: this.message,
      speed01: clamp(this.speed / (preset.baseSpeed + preset.boost), 0, 1),
      speedText: `${(this.speed * 3.6).toFixed(0)} km/h`,
      approach01,
      inWindow,
      nextFenceText: distToFence === null ? "—" : distToFence > 90 ? "終點在望!" : `${distToFence.toFixed(0)} m`,
      lastResult: this.lastResult,
      overlay: { ...this.overlay },
    });
  }

  // ---------- 存讀檔(記最佳成績,不存賽中進度) ----------
  saveGame(silent = false) {
    const prev = loadSavedGame() || {};
    const snapshot = { difficulty: this.difficulty, modeId: this.modeId, bestFaults: prev.bestFaults, bestTime: prev.bestTime };
    if (this.phase === "ended" && !this.mode.endless) {
      const better =
        prev.bestFaults === undefined ||
        this.faults < prev.bestFaults ||
        (this.faults === prev.bestFaults && this.elapsed < (prev.bestTime ?? Infinity));
      if (better) {
        snapshot.bestFaults = this.faults;
        snapshot.bestTime = this.elapsed;
      }
    }
    saveGameState(snapshot);
    if (!silent) {
      this.message = "已存檔。";
      this.pushHud();
    }
  }

  loadGame() {
    const snap = loadSavedGame();
    if (!snap) return false;
    if (DIFFICULTY_PRESETS[snap.difficulty]) this.difficulty = snap.difficulty;
    if (GAME_MODES[snap.modeId]) {
      this.modeId = snap.modeId;
      this.mode = getModeConfig(snap.modeId);
    }
    this.openHomeMenu();
    this.message = snap.bestFaults !== undefined
      ? `最佳成績:罰分 ${snap.bestFaults}、${(snap.bestTime || 0).toFixed(1)} 秒——挑戰它!`
      : "尚無最佳成績,先跑一場吧!";
    this.pushHud();
    return true;
  }
}
