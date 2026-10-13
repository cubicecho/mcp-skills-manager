import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { BookMarked } from '@/components/app-icons';
import { ConnectCard } from '@/components/domain/connect-card';
import { NewSkillDialog } from '@/components/domain/skill/new-skill-dialog';
import { SkillFilters } from '@/components/domain/skill/skill-filters';
import { SkillsTable } from '@/components/domain/skill/skills-table';
import { EmptyState } from '@/components/page';
import { PageLayout } from '@/components/page-layout';
import { QueryState } from '@/components/query-state';
import { Button } from '@/components/ui/button';
import { Plus, Search } from '@/components/ui/icons';
import { mcpOrigin } from '@/lib/mcp';
import { useServerStatus, useSkills } from '@/lib/queries';
import { collectTags, filterAndSort, NO_FILTERS } from '@/lib/skill-list';

/** The `/` route: the skills page. */
export const Route = createFileRoute('/')({
  component: SkillsPage,
});

/** Every skill in a table that can be searched, filtered and sorted, with the endpoint that serves them all. */
function SkillsPage() {
  const skills = useSkills();
  const { data } = skills;
  const { data: status } = useServerStatus();
  const [newOpen, setNewOpen] = useState(false);
  const [chosen, setChosen] = useState(NO_FILTERS);

  const allTags = useMemo(() => (data ? collectTags(data) : []), [data]);
  // A previously selected tag can disappear when skills change — fall back to no tag filter.
  const tag = chosen.tag !== undefined && allTags.includes(chosen.tag) ? chosen.tag : undefined;
  const filters = useMemo(() => ({ ...chosen, tag }), [chosen, tag]);
  const visible = useMemo(() => (data ? filterAndSort(data, filters) : []), [data, filters]);
  const hasSkills = Boolean(data && data.length > 0);
  // The sort order is not a filter: clearing keeps it.
  const clearFilters = () => setChosen({ ...NO_FILTERS, sort: chosen.sort });

  const newSkillButton = <Button onClick={() => setNewOpen(true)} content="New skill" iconSlot={<Plus />} />;

  return (
    <>
      <PageLayout
        title="Skills"
        description="Markdown documents served to agents over MCP. Each is exposed as both a tool and a resource."
        actionSlot={newSkillButton}
        headerContentSlot={
          hasSkills ? (
            <SkillFilters
              filters={filters}
              tags={allTags}
              onChange={(change) => setChosen((current) => ({ ...current, ...change }))}
            />
          ) : undefined
        }
        contentSlot={
          <div className="flex flex-col gap-6 pb-6">
            <QueryState
              query={skills}
              what="skills"
              count={visible.length}
              emptySlot={
                hasSkills ? (
                  <EmptyState
                    icon={Search}
                    title="No skills match your filters"
                    actionSlot={<Button variant="outline" onClick={clearFilters} content="Clear filters" />}
                  />
                ) : (
                  <EmptyState
                    icon={BookMarked}
                    title="No skills yet"
                    description="Create one, or upload a folder or zip you already have."
                    actionSlot={newSkillButton}
                  />
                )
              }
            />

            {visible.length > 0 && <SkillsTable skills={visible} />}

            {hasSkills && (
              <ConnectCard
                endpoint={`${mcpOrigin(status?.port)}/mcp`}
                label="all skills"
                description="Point an MCP client at this endpoint to get every skill as a tool and a resource. Use a workspace endpoint (/mcp/w/<slug>) to serve a filtered subset."
              />
            )}
          </div>
        }
      />
      {newOpen && <NewSkillDialog open onOpenChange={setNewOpen} />}
    </>
  );
}
