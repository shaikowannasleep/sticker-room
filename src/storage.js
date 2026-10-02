const KEY = 'sticker-room-v1';

const defaults = () => ({
  coins: 100,
  stars: {},
  hintsUsedFree: {},
  tutorialDone: false,
  settings: { sound: true, music: true, haptics: true, saver: false },
});

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = defaults();
      const s = JSON.parse(raw);
      return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) } };
    }
  } catch (e) {
    /* storage may be blocked */
  }
  return defaults();
}

let timer = 0;
export function writeSave(save) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(save));
    } catch (e) {
      /* ignore */
    }
  }, 150);
}
