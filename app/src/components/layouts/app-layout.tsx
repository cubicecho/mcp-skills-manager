import type { SkillSummary } from '@mcp-skills/shared';
import { createLink, useLocation, useMatchRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { BookMarked, Layers } from '@/components/app-icons';
import { ServerStats } from '@/components/domain/server-stats';
import { NewSkillDialog } from '@/components/domain/skill/new-skill-dialog';
import { EmptyState } from '@/components/page';
import { QueryState } from '@/components/query-state';
import { BarNavItem, Sidebar, SidebarNavItem, type SidebarNavItemStatus, SidebarSection } from '@/components/sidebar';
import { SidebarLayout } from '@/components/split-layout';
import { FileText, Folder, Lock, Plus, Settings } from '@/components/ui/icons';
import { ThemePicker } from '@/components/ui/theme-picker';
import { clearToken, requireAuth } from '@/lib/auth';
import { useServerStatus, useSkills } from '@/lib/queries';
import { skillFileCount } from '@/lib/skill';
import { SKILL_STATUS, skillStatuses } from '@/lib/skill-status';
import type { SlotNode } from '@/lib/utils';

/** The pages beside the skills, which the phone bar links to and the sidebar keeps in its footer. */
const OTHER_PLACES = [
  { to: '/workspaces', label: 'Workspaces', icon: Layers },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

/** The places the phone bar links to; on a wide screen the sidebar lists the skills themselves instead. */
const NAV_ITEMS = [{ to: '/', label: 'Skills', icon: BookMarked }, ...OTHER_PLACES] as const;

/** A path the phone bar links to. */
type NavTo = (typeof NAV_ITEMS)[number]['to'];

/** A sidebar row that is a router link. */
const SidebarLink = createLink(SidebarNavItem);
/** A phone-bar item that is a router link. */
const BarLink = createLink(BarNavItem);

/**
 * Tells whether a place's nav item is lit for the current path.
 *
 * @param to - The place the item links to.
 * @param pathname - The current location's path.
 * @returns True when the path belongs to the place.
 *
 * @remarks
 * Skills owns the skill route too, so its button stays lit while a skill is open.
 */
function isActive(to: NavTo, pathname: string): boolean {
  if (to === '/') {
    return pathname === '/' || pathname.startsWith('/skills/');
  }
  // A whole segment, so `/settings-old` does not light Settings.
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** Clears the stored bearer token and brings the token gate back — for shared machines. */
function lock() {
  clearToken();
  requireAuth();
}

/** The app's mark and name. */
function Brand({
  compact = false,
}: {
  /** Keeps the name for screen readers only: the phone bar has no room for it beside the nav. */
  compact?: boolean;
}) {
  return (
    <span className="flex items-center gap-2 px-2 font-semibold">
      <BookMarked className="size-5" aria-hidden />
      <span className={compact ? 'sr-only' : undefined}>MCP Skills</span>
    </span>
  );
}

/**
 * Picks the one fact the rail adds about a skill.
 *
 * @param skill - The skill the row is for.
 * @returns The first status that holds for the skill, as a label and an icon; undefined when none does.
 *
 * @remarks
 * The fact is that it follows a git repo, that agents cannot change it, or that the root endpoint does not serve it.
 */
function skillStatus(skill: SkillSummary): SidebarNavItemStatus | undefined {
  const [first] = skillStatuses(skill);
  if (first === undefined) {
    return undefined;
  }
  const { hint, icon: Icon } = SKILL_STATUS[first];
  return { label: hint, iconSlot: <Icon /> };
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
        contentSlot={[
          <SidebarLink
            key="/"
            to="/"
            label="All skills"
            iconSlot={<BookMarked />}
            count={skills.data?.length}
            active={Boolean(matchRoute({ to: '/' }))}
          />,
        ]}
      />
      <SidebarSection
        as="nav"
        title="Skills"
        actionSlot={
          <ActionButton
            variant="ghost"
            size="icon-sm"
            label="New skill"
            side="right"
            onClick={() => setNewOpen(true)}
            iconSlot={<Plus />}
          />
        }
        status={
          <QueryState
            query={skills}
            what="the skills"
            count={list.length}
            compact
            rows={3}
            emptySlot={<EmptyState compact title="No skills yet." className="px-2" />}
          />
        }
        contentSlot={list.map((skill) => {
          const files = skillFileCount(skill);
          return (
            <SidebarLink
              key={skill.name}
              to="/skills/$name"
              params={{ name: skill.name }}
              label={skill.name}
              iconSlot={skill.format === 'dir' ? <Folder /> : <FileText />}
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

/** The app's frame: the sidebar of skills on a wide screen, a bar of places on a phone, and the page between. */
export function AppLayout({
  contentSlot,
}: {
  /** The page the current route draws. */
  contentSlot: SlotNode;
}) {
  const { data: status } = useServerStatus();
  const pathname = useLocation({ select: (location) => location.pathname });

  return (
    <SidebarLayout
      className="h-dvh"
      sidebarPosition="start"
      sidebarWidth="auto"
      divider="none"
      sidebarHideBelow="md"
      sidebarSlot={
        <Sidebar
          label="MCP Skills"
          headerSlot={<Brand />}
          contentSlot={<SkillNav />}
          footerSlot={
            <>
              <ServerStats />
              {OTHER_PLACES.map(({ to, label, icon: Icon }) => (
                <SidebarLink
                  key={to}
                  to={to}
                  label={label}
                  iconSlot={<Icon />}
                  count={to === '/workspaces' ? status?.workspaceCount : undefined}
                  active={isActive(to, pathname)}
                />
              ))}
              {status?.authEnabled && <SidebarNavItem label="Lock" iconSlot={<Lock />} onClick={lock} />}
              <ThemePicker variant="compact" />
            </>
          }
        />
      }
      brandSlot={<Brand compact />}
      navSlot={NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <BarLink key={to} to={to} label={label} iconSlot={<Icon />} active={isActive(to, pathname)} />
      ))}
      navLabel="Main"
      actionSlot={
        <>
          {status?.authEnabled && (
            <ActionButton
              variant="ghost"
              size="icon-sm"
              label="Lock"
              hint="Forget the stored token"
              onClick={lock}
              iconSlot={<Lock />}
            />
          )}
          <ThemePicker variant="compact" />
        </>
      }
      // Pages bring their own inset and scroll their own body (PageLayout). Under `md` a skill's file
      // list stacks over its preview, taller than the screen, so there main scrolls instead.
      contentSlot={<main className="h-full min-h-0 overflow-y-auto md:overflow-hidden">{contentSlot}</main>}
    />
  );
}
