import { useQueryClient } from '@tanstack/react-query';
import { useAppForm } from '@/components/app-form';
import { CenteredLayout } from '@/components/centered-layout';
import { PasswordField } from '@/components/password-field';
import { Alert } from '@/components/ui/alert';
import { Code } from '@/components/ui/code';
import { FormElement } from '@/components/ui/form-element';
import { KeyRound } from '@/components/ui/icons';
import { getToken, setToken, useNeedsAuth } from '@/lib/auth';
import type { SlotNode } from '@/lib/utils';

const TOKEN_FORM_ID = 'token-gate-form';

/**
 * Shows the app, or a token-entry screen once any API call has come back 401.
 *
 * @remarks
 * Submitting stores the token in localStorage and refetches everything. A token the server refuses brings
 * the screen back, saying so.
 */
export function TokenGate({
  contentSlot,
}: {
  /** The app, shown while no call has been refused. */
  contentSlot: SlotNode;
}) {
  const needsAuth = useNeedsAuth();
  const queryClient = useQueryClient();
  const form = useAppForm({
    defaultValues: { token: '' },
    onSubmit: ({ value }) => {
      const token = value.token.trim();
      if (!token) {
        return;
      }
      setToken(token);
      form.reset();
      queryClient.invalidateQueries();
    },
  });

  if (!needsAuth) {
    return contentSlot;
  }

  // A refusal with a token stored is a refusal of that token; with none stored, nothing has been tried yet.
  const rejected = getToken() !== null;

  return (
    <form.AppForm>
      <CenteredLayout
        level={1}
        iconSlot={<KeyRound />}
        title="Authentication required"
        description={
          <>
            Enter the server token (from <Code>MCP_SKILLS_TOKEN</Code> or <Code>settings.json</Code>).
          </>
        }
        contentSlot={
          <FormElement id={TOKEN_FORM_ID} onSubmit={() => void form.handleSubmit()}>
            <PasswordField form={form} name="token" label="Token" autoFocus placeholder="Bearer token" />
            {rejected && (
              <Alert
                variant="destructive"
                title="The server did not accept that token"
                description="Check it against the server’s token and enter it again."
              />
            )}
          </FormElement>
        }
        footerActionsSlot={
          <form.Subscribe selector={(state) => state.values.token.trim() === ''}>
            {(isBlank) => (
              <form.SubmitButton form={TOKEN_FORM_ID} disabled={isBlank} pendingLabel="Unlocking…" content="Unlock" />
            )}
          </form.Subscribe>
        }
      />
    </form.AppForm>
  );
}
