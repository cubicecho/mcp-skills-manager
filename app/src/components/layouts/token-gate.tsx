import { useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAppForm } from '@/components/app-form';
import { CenteredLayout } from '@/components/centered-layout';
import { PasswordField } from '@/components/password-field';
import { Code } from '@/components/ui/code';
import { KeyRound } from '@/components/ui/icons';
import { setToken, useNeedsAuth } from '@/lib/auth';

const TOKEN_FORM_ID = 'token-gate-form';

/**
 * Renders its children normally; when any API call has come back 401 it swaps
 * in a token-entry screen. Submitting stores the token in localStorage and
 * refetches everything.
 */
export function TokenGate({ children }: { children: ReactNode }) {
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
  const isBlank = useStore(form.store, (state) => state.values.token.trim() === '');

  if (!needsAuth) {
    return children;
  }

  return (
    <form.AppForm>
      <CenteredLayout
        level={1}
        icon={<KeyRound />}
        title="Authentication required"
        description={
          <>
            Enter the server token (from <Code>MCP_SKILLS_TOKEN</Code> or <Code>settings.json</Code>).
          </>
        }
        content={
          <form
            id={TOKEN_FORM_ID}
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <PasswordField form={form} name="token" label="Token" autoFocus placeholder="Bearer token" />
          </form>
        }
        footerActions={
          <form.SubmitButton form={TOKEN_FORM_ID} disabled={isBlank} pendingLabel="Unlocking…">
            Unlock
          </form.SubmitButton>
        }
      />
    </form.AppForm>
  );
}
