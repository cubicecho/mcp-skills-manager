import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { cleanRelPath, type PathPrompt, PathPromptDialog } from './path-prompt-dialog';

const basePrompt = (overrides: Partial<PathPrompt> = {}): PathPrompt => ({
  title: 'New file',
  label: 'Path',
  submitLabel: 'Create file',
  onSubmit: vi.fn(async () => {}),
  ...overrides,
});

describe('cleanRelPath', () => {
  it('trims whitespace and surrounding slashes', () => {
    expect(cleanRelPath('  /docs/intro.md/ ')).toBe('docs/intro.md');
    expect(cleanRelPath(' / ')).toBe('');
  });
});

describe('PathPromptDialog', () => {
  it('submits the cleaned value and closes', async () => {
    const prompt = basePrompt();
    const onClose = vi.fn();
    render(<PathPromptDialog prompt={prompt} onClose={onClose} />);

    await userEvent.type(screen.getByLabelText(/Path/), '/docs/intro.md');
    await userEvent.click(screen.getByRole('button', { name: 'Create file' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(prompt.onSubmit).toHaveBeenCalledWith('docs/intro.md');
  });

  it('refuses an empty value and a value the caller rejects', async () => {
    const prompt = basePrompt({ validate: (value) => (value.includes(' ') ? 'No spaces.' : undefined) });
    const onClose = vi.fn();
    render(<PathPromptDialog prompt={prompt} onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Create file' }));
    expect(await screen.findByText('Enter a path.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/Path/), 'bad name');
    expect(await screen.findByText('No spaces.')).toBeInTheDocument();
    expect(prompt.onSubmit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays open when the request fails', async () => {
    const onClose = vi.fn();
    const prompt = basePrompt({
      onSubmit: vi.fn(async () => {
        throw new Error('exists');
      }),
    });
    render(<PathPromptDialog prompt={prompt} onClose={onClose} />);

    await userEvent.type(screen.getByLabelText(/Path/), 'a.md');
    await userEvent.click(screen.getByRole('button', { name: 'Create file' }));

    await waitFor(() => expect(prompt.onSubmit).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
