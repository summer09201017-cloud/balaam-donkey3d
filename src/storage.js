const SETTINGS_KEY = "balaam-donkey3d-settings-v1";
const SAVE_KEY = "balaam-donkey3d-save-v1";

const defaultSettings = {
  difficulty: "normal",
  modeId: "standard",
  horseCoat: "greybrown",
  /* 騎者畫風(0730 使用者點名):auto=依年齡分級(幼兒/兒童→圓萌)/ tsum / real。
     ★ 政策=動物一律 tsum、**人物按年齡分級**,所以人物給三態不是開關。 */
  riderStyle: "auto",
  audioEnabled: true,
};

function parseValue(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function loadSettings() {
  return {
    ...defaultSettings,
    ...parseValue(localStorage.getItem(SETTINGS_KEY), {}),
  };
}

export function saveSettings(settings) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      ...defaultSettings,
      ...settings,
    }),
  );
}

export function loadSavedGame() {
  return parseValue(localStorage.getItem(SAVE_KEY), null);
}

export function saveGameState(snapshot) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
}

export function hasSavedGame() {
  return localStorage.getItem(SAVE_KEY) !== null;
}
