import type { SkillSummary } from '@mcp-skills/shared';
import { createLink, Link, useLocation, useMatchRoute } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { BookMarked, FileText, Folder, Layers, Lock } from '@/components/app-icons';
import { ServerStats } from '@/components/domain/server-stats';
import { NewSkillDialog } from '@/components/domain/skill/new-skill-dialog';
import { EmptyState } from '@/components/page';
import { QueryState } from '@/components/query-state';
import { Sidebar, SidebarNavItem, type SidebarNavItemStatus, SidebarSection } from '@/components/sidebar';
import { SidebarLayout } from '@/components/split-layout';
import { Plus, Settings } from '@/components/ui/icons';
import { ThemePicker } from '@/components/ui/theme-picker';
import { clearToken, requireAuth } from '@/lib/auth';
import { useServerStatus, useSkills } from '@/lib/queries';

/** The places the phone bar links to; on a wide screen the sidebar lists the skills themselves instead. */
const NAV_ITEMS = [
  { to: '/', label: 'Skills', icon: BookMarked },
  { to: '/workspaces', label: 'Workspaces', icon: Layers },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

type NavTo = (typeof NAV_ITEMS)[number]['to'];

const SidebarLink = createLink(SidebarNavItem);

/** Skills owns the skill route too, so its button stays lit while a skill is open. */
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

/** The one fact the rail adds about a skill: agents cannot change it, or the root endpoint does not serve it. */
function skillStatus(skill: SkillSummary): SidebarNavItemStatus | undefined {
  if (skill.readOnly) {
    return { label: 'read-only for agents', icon: <Lock /> };
  }
  return skill.global ? undefined : { label: 'workspace-scoped', icon: <Layers /> };
}

/** Every skill as a row that opens it, under a row for the full list with its filters. */
function SkillNav() {
  const matchRoute = useMatchRoute();
  const skills = useSkills();
  const [newOpen, setNewOpen] = useState(false);
  const list = [...(skills.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <SidebarSection
        as="nav"
        label="Main"
        content={[
          <SidebarLink
            key="/"
            to="/"
            label="All skills"
            icon={<BookMarked />}
            count={skills.data?.length}
            active={Boolean(matchRoute({ to: '/' }))}
          />,
        ]}
      />
      <SidebarSection
        as="nav"
        title="Skills"
        action={
          <ActionButton variant="ghost" size="icon-sm" label="New skill" side="right" onClick={() => setNewOpen(true)}>
            <Plus />
          </ActionButton>
        }
        status={
          <QueryState
            query={skills}
            what="the skills"
            count={list.length}
            compact
            rows={3}
            empty={<EmptyState compact title="No skills yet." className="px-2" />}
          />
        }
        content={list.map((skill) => {
          // The skill's own Markdown counts, so a number here always means more than one file.
          const files = skill.files.filter((file) => file.type === 'file').length + 1;
          return (
            <SidebarLink
              key={skill.name}
              to="/skills/$name"
              params={{ name: skill.name }}
              label={skill.name}
              icon={skill.format === 'dir' ? <Folder /> : <FileText />}
              count={files > 1 ? files : undefined}
              status={skillStatus(skill)}
              title={skill.description || undefined}
              active={Boolean(matchRoute({ to: '/skills/$name', params: { name: skill.name } }))}
            />
          );
        })}
      />
      {newOpen && <NewSkillDialog open onOpenChange={setNewOpen} />}
    </>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { data: status } = useServerStatus();
  const pathname = useLocation({ select: (location) => location.pathname });

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
          content={<SkillNav />}
          footer={
            <>
              <ServerStats />
              <SidebarLink
                to="/workspaces"
                label="Workspaces"
                icon={<Layers />}
                count={status?.workspaceCount}
                active={isActive('/workspaces', pathname)}
              />
              <SidebarLink
                to="/settings"
                label="Settings"
                icon={<Settings />}
                active={isActive('/settings', pathname)}
              />
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
      // Pages bring their own inset and scroll their own body (PageLayout). Under `md` a skill's file
      // list stacks over its preview, taller than the screen, so there main scrolls instead.
      content={<main className="h-full min-h-0 overflow-y-auto md:overflow-hidden">{children}</main>}
    />
  );
}
