import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AppLayout } from '@/components/layouts/app-layout';
import { TokenGate } from '@/components/layouts/token-gate';
import { useThemePreference } from '@/components/ui/theme-preference';
import { ToastProvider } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';

/** The root route: the shell every page is drawn in. */
export const Route = createRootRoute({
  component: RootComponent,
});

/** The app shell: tooltips, toasts and the token gate around the layout that holds the current page. */
function RootComponent() {
  // Applies the stored theme on every screen and keeps System following the device.
  useThemePreference();
  return (
    <TooltipProvider>
      <ToastProvider>
        <TokenGate contentSlot={<AppLayout contentSlot={<Outlet />} />} />
      </ToastProvider>
    </TooltipProvider>
  );
}
