import type { ReactNode } from 'react';
import { InputField, useAppForm } from '@/components/app-form';
import { DialogLayout } from '@/components/dialog-layout';
import { Button } from '@/components/ui/button';
import { FormElement } from '@/components/ui/form-element';

const PATH_PROMPT_FORM_ID = 'path-prompt-form';

/** What a {@link PathPromptDialog} asks for, and what happens with the answer. */
export interface PathPrompt {
  /** The dialog's title. */
  title: string;
  /** What is being asked, under the title. */
  description?: ReactNode;
  /** The field's label, also named in the error for an empty answer. */
  label: string;
  placeholder?: string;
  /** What the field starts with; submitting it unchanged closes the dialog without calling `onSubmit`. */
  initial?: string;
  /** The submit button's text. */
  submitLabel: string;
  /** Returns an error message for a cleaned value that cannot be used; `undefined` passes. */
  validate?: (value: string) => string | undefined;
  /** Called with the cleaned value; resolve to close, throw to keep the dialog open. */
  onSubmit: (value: string) => Promise<unknown>;
}

/**
 * Trims whitespace and surrounding slashes off a path relative to the skill root.
 *
 * @param raw - The path as typed.
 * @returns The cleaned path; empty when nothing but whitespace and slashes was typed.
 */
export function cleanRelPath(raw: string): string {
  return raw.trim().replace(/^\/+|\/+$/g, '');
}

/**
 * A one-field dialog for a path or a name — the in-app replacement for `window.prompt`.
 *
 * @remarks
 * Mount it only while a prompt is pending so every opening starts from `initial`.
 */
export function PathPromptDialog({
  prompt,
  onClose,
}: {
  /** What to ask, and what to do with the answer. */
  prompt: PathPrompt;
  /** Called when the dialog is dismissed, and after a submit that succeeded or changed nothing. */
  onClose: () => void;
}) {
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
        contentSlot={
          <FormElement id={PATH_PROMPT_FORM_ID} className="py-1" onSubmit={() => void form.handleSubmit()}>
            <InputField
              form={form}
              name="value"
              label={prompt.label}
              required
              autoFocus
              placeholder={prompt.placeholder}
              validators={{ onChange: validate, onSubmit: validate }}
            />
          </FormElement>
        }
        footerActionsSlot={(close) => (
          <>
            <Button type="button" variant="outline" onClick={close} content="Cancel" />
            <form.SubmitButton form={PATH_PROMPT_FORM_ID} pendingLabel="Working…" content={prompt.submitLabel} />
          </>
        )}
      />
    </form.AppForm>
  );
}
