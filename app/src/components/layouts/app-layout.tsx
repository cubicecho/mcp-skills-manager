import { createLink, Link, useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ActionButton } from '@/components/action-button';
import { BookMarked, Layers, Lock } from '@/components/app-icons';
import { Sidebar, SidebarNavItem, SidebarSection } from '@/components/sidebar';
import { SidebarLayout } from '@/components/split-layout';
import { Settings } from '@/components/ui/icons';
import { ThemePicker } from '@/components/ui/theme-picker';
import { clearToken, requireAuth } from '@/lib/auth';
import { useServerStatus } from '@/lib/queries';

const NAV_ITEMS = [
  { to: '/', label: 'Skills', icon: BookMarked },
  { to: '/workspaces', label: 'Workspaces', icon: Layers },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

type NavTo = (typeof NAV_ITEMS)[number]['to'];

const SidebarLink = createLink(SidebarNavItem);

/** Skills owns the editor route too, so its row stays lit while a skill is open. */
function isActive(to: NavTo, pathname: string): boolean {
  return to === '/' ? pathname === '/' || pathname.startsWith('/skills/') : pathname.startsWith(to);
}

/** Clears the stored bearer token and brings the token gate back — for shared machines. */
function lock() {
  clearToken();
  requireAuth();
}

/** `compact` keeps the name for screen readers only: the phone bar has no room for it beside the nav. */
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2 px-2 font-semibold">
      <BookMarked className="size-5" aria-hidden />
      <span className={compact ? 'sr-only' : undefined}>MCP Skills</span>
    </span>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { data: status } = useServerStatus();
  const pathname = useLocation({ select: (location) => location.pathname });
  const counts: Partial<Record<NavTo, number>> = {
    '/': status?.skillCount,
    '/workspaces': status?.workspaceCount,
  };

  return (
    <SidebarLayout
      className="h-dvh"
      sidebarPosition="start"
      sidebarWidth="auto"
      divider="none"
      sidebarHideBelow="md"
      sidebar={
        <Sidebar
          label="MCP Skills"
          header={<Brand />}
          content={
            <SidebarSection
              as="nav"
              label="Main"
              content={NAV_ITEMS.map(({ to, label, icon: Icon }) => (
                <SidebarLink
                  key={to}
                  to={to}
                  label={label}
                  icon={<Icon />}
                  count={counts[to]}
                  active={isActive(to, pathname)}
                />
              ))}
            />
          }
          footer={
            <>
              {status?.authEnabled && <SidebarNavItem label="Lock" icon={<Lock />} onClick={lock} />}
              <ThemePicker variant="compact" />
            </>
          }
        />
      }
      brand={<Brand compact />}
      nav={NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <ActionButton
          key={to}
          asChild
          variant={isActive(to, pathname) ? 'secondary' : 'ghost'}
          size="icon-sm"
          label={label}
        >
          <Link to={to}>
            <Icon />
          </Link>
        </ActionButton>
      ))}
      navLabel="Main"
      action={
        <>
          {status?.authEnabled && (
            <ActionButton variant="ghost" size="icon-sm" label="Lock" hint="Forget the stored token" onClick={lock}>
              <Lock />
            </ActionButton>
          )}
          <ThemePicker variant="compact" />
        </>
      }
      // Pages bring their own inset and scroll their own body (PageLayout), so main only divides the height.
      content={<main className="h-full min-h-0 overflow-hidden">{children}</main>}
    />
  );
}
