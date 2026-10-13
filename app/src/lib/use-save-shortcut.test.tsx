import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSaveShortcut } from './use-save-shortcut';

function Editor({ onSave }: { onSave: () => void }) {
  useSaveShortcut(onSave, true);
  return null;
}

describe('useSaveShortcut', () => {
  it('saves on Ctrl+S and Cmd+S, with Caps Lock on as well', () => {
    const onSave = vi.fn();
    render(<Editor onSave={onSave} />);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    fireEvent.keyDown(window, { key: 'S', ctrlKey: true });
    expect(onSave).toHaveBeenCalledTimes(3);
  });

  it('leaves the Shift chord and a bare key alone', () => {
    const onSave = vi.fn();
    render(<Editor onSave={onSave} />);
    fireEvent.keyDown(window, { key: 'S', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: 's' });
    expect(onSave).not.toHaveBeenCalled();
  });
});
