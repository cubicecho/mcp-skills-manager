import type { SkillDetail } from '@mcp-skills/shared';
import type { ReactNode } from 'react';
import { ActionButton } from '@/components/action-button';
import { Layers, Lock } from '@/components/app-icons';
import { FileLoadState } from '@/components/domain/skill/editor/file-load-state';
import { isMarkdownPath, SKILL_MD_KEY } from '@/components/domain/skill/editor/file-tree';
import { MarkdownPreview } from '@/components/domain/skill/markdown-preview';
import { StickyHeaderContentFooter } from '@/components/header-content-footer';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Pencil } from '@/components/ui/icons';
import { formatBytes, formatCount, formatDate } from '@/lib/format';
import { useSkillFileContent } from '@/lib/queries';

/** The pane a file is read in: its name, path and facts pinned over a body that scrolls. */
function PreviewFrame({
  title,
  path,
  description,
  action,
  badges,
  content,
}: {
  title: string;
  path: string;
  description?: ReactNode;
  action?: ReactNode;
  badges?: ReactNode;
  content: ReactNode;
}) {
  return (
    <StickyHeaderContentFooter
      width="prose"
      header={
        <PageHeader
          title={title}
          breadcrumbs={<p className="break-all font-mono text-muted-foreground text-xs">{path}</p>}
          description={description}
          action={action}
          content={badges}
        />
      }
      contentClassName="pb-10"
      content={content}
    />
  );
}

function EditButton({ onEdit }: { onEdit: () => void }) {
  return (
    <ActionButton variant="ghost" size="icon-sm" label="Edit" onClick={onEdit}>
      <Pencil />
    </ActionButton>
  );
}

/** The skill's own Markdown, rendered: what an agent gets when it loads the skill. */
function SkillPreview({ skill, onEdit }: { skill: SkillDetail; onEdit: () => void }) {
  const facts = [
    `Updated ${formatDate(skill.updatedAt)}`,
    skill.usage.count > 0 ? `loaded ${formatCount(skill.usage.count, 'time')}` : 'never loaded',
  ].join(' · ');
  return (
    <PreviewFrame
      title={skill.name}
      path={skill.format === 'dir' ? `skills/${skill.name}/SKILL.md` : `skills/${skill.path}`}
      description={skill.description || undefined}
      action={<EditButton onEdit={onEdit} />}
      badges={
        <div className="flex flex-wrap items-center gap-1.5">
          {skill.readOnly && (
            <Badge variant="outline" className="gap-1 font-normal" title="Agents cannot modify this skill over MCP">
              <Lock className="size-3" /> Read-only
            </Badge>
          )}
          {!skill.global && (
            <Badge variant="outline" className="gap-1 font-normal" title="Hidden from the root /mcp endpoint">
              <Layers className="size-3" /> Workspace-scoped
            </Badge>
          )}
          {skill.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
          <span className="text-muted-foreground text-xs">{facts}</span>
        </div>
      }
      content={<MarkdownPreview content={skill.body} />}
    />
  );
}

/** A supporting file: Markdown rendered, any other text as written, a binary file as a notice. */
function SupportingFilePreview({ skill, path, onEdit }: { skill: SkillDetail; path: string; onEdit: () => void }) {
  const file = useSkillFileContent(skill.name, path);
  const { data } = file;
  const markdown = isMarkdownPath(path);
  return (
    <PreviewFrame
      title={path.slice(path.lastIndexOf('/') + 1)}
      path={`skills/${skill.name}/${path}`}
      description={data ? formatBytes(data.size) : undefined}
      action={
        markdown ? (
          <EditButton onEdit={onEdit} />
        ) : (
          <Badge variant="outline" title="Only Markdown (.md) files can be edited here">
            Read-only
          </Badge>
        )
      }
      content={
        <>
          <FileLoadState
            file={file}
            describeBinary={(size) => `${size}. Export the skill as a .zip to work with it.`}
          />
          {data &&
            !data.binary &&
            (markdown ? (
              <MarkdownPreview content={data.content} />
            ) : (
              <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
                {data.content}
              </pre>
            ))}
        </>
      }
    />
  );
}

/**
 * The selected file as it reads, with a button that opens it in the editor.
 * @param props.skill - The skill the file belongs to.
 * @param props.path - The file's path relative to the skill root, or `SKILL_MD_KEY` for the skill's own Markdown.
 * @param props.onEdit - Called when the reader asks to edit the file.
 */
export function FilePreview({ skill, path, onEdit }: { skill: SkillDetail; path: string; onEdit: () => void }) {
  return path === SKILL_MD_KEY ? (
    <SkillPreview skill={skill} onEdit={onEdit} />
  ) : (
    <SupportingFilePreview skill={skill} path={path} onEdit={onEdit} />
  );
}
