import type { ReactNode } from 'react';
import { InputField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Button } from '@/components/ui/button';

const PATH_PROMPT_FORM_ID = 'path-prompt-form';

/** What a {@link PathPromptDialog} asks for, and what happens with the answer. */
export interface PathPrompt {
  title: string;
  description?: ReactNode;
  label: string;
  placeholder?: string;
  initial?: string;
  submitLabel: string;
  /** Returns an error message for a value that cannot be used; falsy passes. */
  validate?: (value: string) => string | undefined;
  /** Called with the cleaned value; resolve to close, throw to keep the dialog open. */
  onSubmit: (value: string) => Promise<unknown>;
}

/** Trim whitespace and surrounding slashes off a path relative to the skill root. */
export function cleanRelPath(raw: string): string {
  return raw.trim().replace(/^\/+|\/+$/g, '');
}

/**
 * A one-field dialog for a path or a name — the in-app replacement for `window.prompt`. Mount it
 * only while a prompt is pending so every opening starts from `initial`.
 */
export function PathPromptDialog({ prompt, onClose }: { prompt: PathPrompt; onClose: () => void }) {
  const initial = prompt.initial ?? '';
  const validate = ({ value }: { value: string }) => {
    const cleaned = cleanRelPath(value);
    if (!cleaned) {
      return `Enter a ${prompt.label.toLowerCase()}.`;
    }
    return prompt.validate?.(cleaned);
  };

  const form = useAppForm({
    defaultValues: { value: initial },
    onSubmit: async ({ value }) => {
      const cleaned = cleanRelPath(value.value);
      if (cleaned === cleanRelPath(initial)) {
        onClose();
        return;
      }
      try {
        await prompt.onSubmit(cleaned);
        onClose();
      } catch {
        // The caller reports the failure; the dialog stays open so the value can be corrected.
      }
    },
  });

  return (
    <form.AppForm>
      <DialogLayout
        open
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        size="sm"
        title={prompt.title}
        description={prompt.description}
        content={
          <form
            id={PATH_PROMPT_FORM_ID}
            className="py-1"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <InputField
              form={form}
              name="value"
              label={prompt.label}
              required
              autoFocus
              placeholder={prompt.placeholder}
              validators={{ onChange: validate, onSubmit: validate }}
            />
          </form>
        }
        footerActions={(close) => (
          <>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <form.SubmitButton form={PATH_PROMPT_FORM_ID} pendingLabel="Working…">
              {prompt.submitLabel}
            </form.SubmitButton>
          </>
        )}
      />
    </form.AppForm>
  );
}
