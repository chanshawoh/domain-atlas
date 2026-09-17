import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Settings, X } from 'lucide-react';
import { setLocale, t, useLocale, type Locale } from './i18n';
import { setTheme, useTheme, type Theme } from './theme';

export type Density = 'compact' | 'medium';
const storageKey = 'domainatlas.ui.density';

function initialDensity(): Density {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'compact' || saved === 'medium') return saved;
  } catch { /* Browser storage may be disabled. */ }
  return 'medium';
}

let density = initialDensity();
const listeners = new Set<() => void>();
export const getDensity = () => density;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const useDensity = () => useSyncExternalStore(subscribe, getDensity);

function applyDensity() {
  document.documentElement.dataset.density = density;
}
applyDensity();

export function setDensity(next: Density) {
  density = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Keep the session choice. */ }
  applyDensity();
  listeners.forEach(listener => listener());
}

function Choice<T extends string>({ id, label, value, options, onChange }: {
  id: string;
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return <div className="settings-field">
    <span id={id}>{label}</span>
    <div className="segmented settings-choices" role="radiogroup" aria-labelledby={id}>
      {options.map(option => <button key={option.id} type="button" role="radio" aria-checked={value === option.id}
        className={value === option.id ? 'active' : ''} onClick={() => onChange(option.id)}>{option.label}</button>)}
    </div>
  </div>;
}

function SettingsDialog({ close }: { close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const theme = useTheme();
  const locale = useLocale();
  const densityValue = useDensity();
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="settings-dialog" onCancel={close} aria-labelledby="settings-title">
    <div className="panel-heading">
      <h2 id="settings-title">{t('设置')}</h2>
      <button className="icon-button" autoFocus onClick={close} aria-label={t('关闭设置')}><X /></button>
    </div>
    <div className="settings-body">
      <Choice<Theme> id="settings-theme" label={t('外观')} value={theme} onChange={setTheme} options={[
        { id: 'dark', label: t('暗色') },
        { id: 'light', label: t('亮色') },
      ]} />
      <Choice<Locale> id="settings-language" label={t('语言')} value={locale} onChange={setLocale} options={[
        { id: 'zh', label: '中文' },
        { id: 'en', label: 'English' },
      ]} />
      <Choice<Density> id="settings-density" label={t('界面密度')} value={densityValue} onChange={setDensity} options={[
        { id: 'compact', label: t('紧凑') },
        { id: 'medium', label: t('中等') },
      ]} />
      <p className="muted">{t('紧凑风格减少留白，便于一屏浏览更多内容。中等为默认。')}</p>
    </div>
  </dialog>;
}

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return <>
    <button className="icon-button settings-button" aria-label={t('设置')} title={t('设置')} onClick={() => setOpen(true)}>
      <Settings />
    </button>
    {open && <SettingsDialog close={() => setOpen(false)} />}
  </>;
}
