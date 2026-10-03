import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { KeyRound } from '@/components/app-icons';
import { CenteredLayout } from '@/components/centered-layout';
import { FormField } from '@/components/form-field';
import { PasswordInput } from '@/components/password-input';
import { Button } from '@/components/ui/button';
import { Code } from '@/components/ui/code';
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
  const [value, setValue] = useState('');

  if (!needsAuth) {
    return children;
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const token = value.trim();
    if (!token) {
      return;
    }
    setToken(token);
    setValue('');
    queryClient.invalidateQueries();
  };

  return (
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
        <form id={TOKEN_FORM_ID} onSubmit={handleSubmit}>
          <FormField
            label="Token"
            control={
              <PasswordInput
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="Bearer token"
              />
            }
          />
        </form>
      }
      footerActions={
        <Button type="submit" form={TOKEN_FORM_ID} disabled={!value.trim()}>
          Unlock
        </Button>
      }
    />
  );
}
