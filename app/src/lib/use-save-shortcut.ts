import { useEffect, useRef } from 'react';

/**
 * Saves on Cmd/Ctrl+S.
 *
 * @param onSave - Saves the open document; the latest callback is always the one called.
 * @param enabled - Whether the shortcut saves, e.g. only when there are unsaved edits and no save is in flight.
 *
 * @remarks
 * The browser's own save dialog is suppressed even while `enabled` is false.
 */
export function useSaveShortcut(onSave: () => void, enabled: boolean): void {
  // Held in a ref so the listener calls the callback from the latest render without re-subscribing.
  const latestSave = useRef(onSave);
  useEffect(() => {
    latestSave.current = onSave;
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Caps Lock reports the key as `S`; Shift makes it another chord, which is left to the browser.
      const isSaveChord =
        (event.metaKey || event.ctrlKey) && event.shiftKey === false && event.key.toLowerCase() === 's';
      if (isSaveChord === false) {
        return;
      }
      event.preventDefault();
      if (enabled) {
        latestSave.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
}
