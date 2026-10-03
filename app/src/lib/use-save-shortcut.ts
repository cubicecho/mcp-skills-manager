import { useEffect, useRef } from 'react';

/**
 * Save on Cmd/Ctrl+S. The browser's own save dialog is suppressed even while saving is disabled.
 * @param onSave - Saves the open document; the latest callback is always the one called.
 * @param enabled - Whether the shortcut saves, e.g. only when there are unsaved edits and no save is in flight.
 */
export function useSaveShortcut(onSave: () => void, enabled: boolean): void {
  // Held in a ref so the listener calls the callback from the latest render without re-subscribing.
  const latestSave = useRef(onSave);
  useEffect(() => {
    latestSave.current = onSave;
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isSaveChord = (event.metaKey || event.ctrlKey) && event.key === 's';
      if (!isSaveChord) {
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
