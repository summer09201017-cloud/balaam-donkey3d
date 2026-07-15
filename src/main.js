import "./styles.css";
import { BalaamDonkeyGame, GAME_MODES } from "./game.js";
import { AudioManager } from "./audio.js";
import { speakLine, setVoiceEnabled } from "./voice.js";
import { SCRIPTURES } from "./voicePhrases.js";
import { hasSavedGame, loadSettings, saveSettings } from "./storage.js";

const ui = {
  canvas: document.querySelector("#gameCanvas"),
  cameraButton: document.querySelector("#cameraButton"),
  faultsLabel: document.querySelector("#faultsLabel"),
  clearsLabel: document.querySelector("#clearsLabel"),
  modeCode: document.querySelector("#modeCode"),
  fenceLabel: document.querySelector("#fenceLabel"),
  timeLabel: document.querySelector("#timeLabel"),
  lastFenceLabel: document.querySelector("#lastFenceLabel"),
  phaseLabel: document.querySelector("#phaseLabel"),
  statusMessage: document.querySelector("#statusMessage"),
  modeLabel: document.querySelector("#modeLabel"),
  difficultyLabel: document.querySelector("#difficultyLabel"),
  timeAllowedLabel: document.querySelector("#timeAllowedLabel"),
  nextFenceLabel: document.querySelector("#nextFenceLabel"),
  speedLabel: document.querySelector("#speedLabel"),
  audioStatus: document.querySelector("#audioStatus"),
  saveStatus: document.querySelector("#saveStatus"),
  installButton: document.querySelector("#installButton"),
  installHint: document.querySelector("#installHint"),
  loadButton: document.querySelector("#loadButton"),
  menuButton: document.querySelector("#menuButton"),
  audioButton: document.querySelector("#audioButton"),
  pauseButton: document.querySelector("#pauseButton"),
  touchControls: document.querySelector("#touchControls"),
  speedMeterFill: document.querySelector("#speedMeterFill"),
  speedMeterText: document.querySelector("#speedMeterText"),
  approachFill: document.querySelector("#approachFill"),
  approachValue: document.querySelector("#approachValue"),
  matchOverlay: document.querySelector("#matchOverlay"),
  overlayEyebrow: document.querySelector("#overlayEyebrow"),
  overlayTitle: document.querySelector("#overlayTitle"),
  overlayText: document.querySelector("#overlayText"),
  resumeButton: document.querySelector("#resumeButton"),
  overlayMenuButton: document.querySelector("#overlayMenuButton"),
  homeScreen: document.querySelector("#homeScreen"),
  modeCardGrid: document.querySelector("#modeCardGrid"),
  modeDescription: document.querySelector("#modeDescription"),
  menuDifficultySelect: document.querySelector("#menuDifficultySelect"),
  horseCoatSelect: document.querySelector("#horseCoatSelect"),
  audioSelect: document.querySelector("#audioSelect"),
  modeMetaTitle: document.querySelector("#modeMetaTitle"),
  modeMetaGoal: document.querySelector("#modeMetaGoal"),
  startMatchButton: document.querySelector("#startMatchButton"),
  commentaryBar: document.querySelector("#commentaryBar"),
  continueSavedButton: document.querySelector("#continueSavedButton"),
};

const settings = loadSettings();
const audio = new AudioManager();
audio.setEnabled(settings.audioEnabled !== false);

const game = new BalaamDonkeyGame({
  canvas: ui.canvas,
  touchRoot: ui.touchControls,
});
window.__balaamDonkey3d = game; // dev hook:Playwright 凍結畫面/數值驗證用
window.__game = game; // /smoke3d 通用鉤子

let selectedModeId = game.modeId;
let selectedDifficulty = game.difficulty;
let selectedCoat = game.coatId;
let audioEnabled = settings.audioEnabled !== false;

function persistSettings() {
  saveSettings({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    horseCoat: selectedCoat,
    audioEnabled,
  });
}

function setMeterFill(element, value) {
  element.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`;
}

function setAudioState(enabled) {
  audioEnabled = enabled;
  audio.setEnabled(enabled);
  setVoiceEnabled(enabled);
  ui.audioStatus.textContent = enabled ? "開啟" : "靜音";
  ui.audioButton.textContent = enabled ? "音效開啟" : "音效靜音";
  ui.audioSelect.value = enabled ? "on" : "off";
  persistSettings();
}

function syncMenuCards() {
  for (const button of ui.modeCardGrid.querySelectorAll(".mode-card")) {
    button.classList.toggle("selected", button.dataset.mode === selectedModeId);
  }
  const mode = GAME_MODES[selectedModeId];
  ui.modeDescription.textContent = mode.description;
  ui.modeMetaTitle.textContent = mode.label;
  ui.modeMetaGoal.textContent = mode.goal;
}

function syncMenuControls() {
  ui.menuDifficultySelect.value = selectedDifficulty;
  ui.horseCoatSelect.value = selectedCoat;
  syncMenuCards();
}

function syncGameConfigurationToMenu() {
  selectedModeId = game.modeId;
  selectedDifficulty = game.difficulty;
  selectedCoat = game.coatId;
  syncMenuControls();
}

function syncOverlay(overlay) {
  ui.matchOverlay.classList.toggle("visible", overlay.visible);
  ui.overlayEyebrow.textContent = overlay.eyebrow;
  ui.overlayTitle.textContent = overlay.title;
  ui.overlayText.textContent = overlay.text;
  ui.resumeButton.hidden = !overlay.canResume;
}

function openHomeScreen() {
  game.openHomeMenu();
  audio.stopCrowd();
  syncGameConfigurationToMenu();
  ui.homeScreen.classList.add("visible");
}

function closeHomeScreen() {
  ui.homeScreen.classList.remove("visible");
}

function unlockAudio() {
  audio.unlock();
}

// —— 中文播報:畫面字幕條+預烤 mp3 人聲同步唸(人聲鐵律:沒烤過的句子只出字幕) ——
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function pushCommentary(text, tone = "info", spoken = text) {
  const bar = ui.commentaryBar;
  if (!bar || !text) return;
  bar.hidden = false;
  bar.dataset.tone = tone;
  bar.textContent = text;
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = "";
  speakLine(spoken);
}

function handleGameEvent(event) {
  switch (event.type) {
    case "match-start": {
      audio.whistle();
      audio.vibrate(18); // 曠野寂靜:不開群眾環境音(路上只有驢、巴蘭與使者)
      pushCommentary("歡迎來到巴蘭之路!你是那頭驢,全場只有你看得見天使!");
      break;
    }
    case "gate": {
      audio.buzzer();
      audio.vibrate(14);
      pushCommentary("出發!路上有耶和華的使者,只有你看得見!");
      break;
    }
    case "jump":
      audio.swish();
      audio.vibrate(12);
      break;
    case "fence-clear": {
      audio.scoreSting();
      audio.vibrate([25, 15, 35]);
      // 三幕避讓文案照經文順序(民22:23/24-25/26-27)
      const ACT_LINES = [
        { sub: `第 ${event.idx} 站——驢轉入田間,避開了!`, say: "避開了!驢轉進田間,躲開了使者的刀!" },
        { sub: `第 ${event.idx} 站——驢貼著牆擠過去了!`, say: "好險!驢貼著牆,擠了過去!" },
        { sub: `第 ${event.idx} 站——極窄之處,驢臥下讓過!`, say: "驢臥下了!在極窄的路上守住了主人!" },
      ];
      const line = event.perfect
        ? { sub: `第 ${event.idx} 站——完美避讓!及時救了主人!`, say: "漂亮!及時避讓,做得好!" }
        : ACT_LINES[event.act ?? 0];
      pushCommentary(line.sub, event.perfect ? "hot" : "info", line.say);
      break;
    }
    case "fence-knock": {
      audio.thud(0.8);
      audio.vibrate([50, 30, 50]);
      pushCommentary(`第 ${event.idx} 站驢遲疑——巴蘭的杖落下!罰分 ${event.faults}。`, "cool", "哎呀,驢遲疑了,巴蘭的杖落下來了!");
      break;
    }
    case "fence-early": {
      audio.rebound();
      pushCommentary("太早了——等時機條進綠區再避讓!", "cool", "太早了,等天使靠近再避讓。");
      break;
    }
    case "finale": {
      // 終局演出(民22:31):天使現形全場、巴蘭俯伏下拜(短句雲哲;經文由結算曉臻唸)
      audio.horn();
      audio.vibrate([60, 30, 60]);
      pushCommentary("耶和華使巴蘭的眼目明亮——他看見天使了!(民22:31)", "hot", "天使現形了!巴蘭俯伏在地!");
      break;
    }
    case "finish": {
      audio.horn();
      audio.vibrate([110, 50, 120]);
      // 結算引經文(曉臻唸和合本):零罰分=民22:33(驢救了主人);其餘=民22:28(驢開口)
      pushCommentary(
        event.clearRound
          ? `驢兒忠心!牠救了主人的命!零罰分,${event.elapsed.toFixed(1)} 秒!`
          : `走完了!罰分 ${event.faults},${event.elapsed.toFixed(1)} 秒。`,
        event.clearRound ? "hot" : "info",
        event.clearRound ? SCRIPTURES[2] : SCRIPTURES[0],
      );
      ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";
      break;
    }
    default:
      break;
  }
}

game.onEvent = handleGameEvent;

game.onHudUpdate = (state) => {
  ui.faultsLabel.textContent = String(state.faults);
  ui.clearsLabel.textContent = String(state.clears);
  ui.modeCode.textContent = ({ 巴蘭之路: "巴蘭", 練習小路: "練習" })[state.modeLabel] || state.modeLabel;
  ui.fenceLabel.textContent = state.endless ? `${state.fenceIdx}/${state.fenceCount}·圈${state.lap}` : `${state.fenceIdx}/${state.fenceCount}`;
  ui.timeLabel.textContent = state.timeText;
  ui.lastFenceLabel.textContent =
    state.lastResult === null ? "—" : state.lastResult === "clear" ? "避開!" : state.lastResult === "knock" ? "挨打" : "早了";
  ui.phaseLabel.textContent = state.phaseLabel;
  ui.statusMessage.textContent = state.message;
  ui.modeLabel.textContent = state.modeLabel;
  ui.difficultyLabel.textContent = state.difficultyLabel;
  ui.timeAllowedLabel.textContent = state.timeAllowed;
  ui.nextFenceLabel.textContent = state.nextFenceText;
  ui.speedLabel.textContent = state.speedText;
  ui.speedMeterText.textContent = state.speedText;
  setMeterFill(ui.speedMeterFill, state.speed01);
  ui.approachValue.textContent = state.approach01 > 0 ? (state.inWindow ? "綠區!避讓!" : "接近中…") : "—";
  setMeterFill(ui.approachFill, state.approach01);
  { // 中下方大時機條(07-14 拍板規格):接近欄架才顯示;進綠區=full 發光
    const bp = document.getElementById("bigPower"), bf = document.getElementById("bigPowerFill");
    if (bp) {
      bp.hidden = !(state.approach01 > 0);
      bf.style.transform = `scaleX(${Math.min(1, state.approach01)})`;
      bf.classList.toggle("full", state.inWindow);
    }
  }
  syncOverlay(state.overlay);
};

syncGameConfigurationToMenu();
setAudioState(audioEnabled);
ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";

ui.modeCardGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".mode-card");
  if (!button) return;
  unlockAudio();
  audio.uiTap();
  selectedModeId = button.dataset.mode;
  syncMenuCards();
  persistSettings();
});

ui.menuDifficultySelect.addEventListener("change", (event) => {
  selectedDifficulty = event.target.value;
  persistSettings();
});

ui.horseCoatSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  selectedCoat = event.target.value;
  game.setHorseCoat(selectedCoat); // 立即換色(選單背景就看得到)
  persistSettings();
});

ui.audioSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  setAudioState(event.target.value === "on");
});

ui.startMatchButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.applyPresentation({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    horseCoat: selectedCoat,
  });
  game.startSelectedMatch();
  closeHomeScreen();
});

function loadIntoUi() {
  const loaded = game.loadGame();
  syncGameConfigurationToMenu();
  ui.saveStatus.textContent = loaded && hasSavedGame() ? "已記錄" : "尚無";
}

ui.continueSavedButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  loadIntoUi();
});

ui.loadButton.addEventListener("click", loadIntoUi);

ui.menuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.overlayMenuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.cameraButton.addEventListener("click", () => {
  game.cycleCameraView();
});

ui.audioButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  setAudioState(!audioEnabled);
});

ui.pauseButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.togglePause();
});

ui.resumeButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.resume();
});

window.addEventListener("pointerdown", unlockAudio, { passive: true });
window.addEventListener("keydown", unlockAudio, { passive: true });

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  ui.installButton.hidden = false;
  ui.installHint.textContent = "已偵測到可安裝版本，點一下就能加入主畫面。";
});

ui.installButton.addEventListener("click", async () => {
  unlockAudio();
  audio.uiTap();
  if (!deferredInstallPrompt) {
    ui.installHint.textContent = "如果是 iPhone，請用分享選單的「加入主畫面」。";
    return;
  }
  deferredInstallPrompt.prompt();
  const outcome = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  ui.installButton.hidden = true;
  ui.installHint.textContent =
    outcome.outcome === "accepted" ? "安裝要求已送出。" : "你可以之後再安裝。";
});

window.addEventListener("appinstalled", () => {
  ui.installButton.hidden = true;
  ui.installHint.textContent = "已安裝到裝置。";
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game.saveGame(true);
  }
});

// dev(localhost)不註冊 SW——SW 快取會讓每次改動都吃到「上一版」(07-11 踩雷)
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      ui.installHint.textContent = "Service Worker 註冊失敗，但仍可直接遊玩。";
    });
  });
}

game.start();
