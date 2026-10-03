import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AppLayout } from '@/components/layouts/app-layout';
import { TokenGate } from '@/components/layouts/token-gate';
import { useThemePreference } from '@/components/ui/theme-preference';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  // Applies the stored theme on every screen and keeps System following the device.
  useThemePreference();
  return (
    <TooltipProvider>
      <ToastProvider>
        <TokenGate>
          <AppLayout>
            <Outlet />
          </AppLayout>
        </TokenGate>
      </ToastProvider>
    </TooltipProvider>
  );
}
