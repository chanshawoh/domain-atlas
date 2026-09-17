import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const storageKey = 'domainatlas.ui.theme';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Browser storage may be disabled. */ }
  // DomainAtlas is dark-first; light is an explicit opt-in that is then remembered.
  return 'dark';
}

let theme = initialTheme();
const listeners = new Set<() => void>();
export const getTheme = () => theme;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const useTheme = () => useSyncExternalStore(subscribe, getTheme);

// The attribute drives the token override; color-scheme keeps native controls in step.
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
applyTheme();

export function setTheme(next: Theme) {
  theme = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Keep the session choice. */ }
  applyTheme();
  listeners.forEach(listener => listener());
}
