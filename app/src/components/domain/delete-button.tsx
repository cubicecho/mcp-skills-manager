import { ConfirmButton } from '@/components/confirm-button';
import { Trash2 } from '@/components/ui/icons';

/** The delete button at the end of a table row, which asks before it deletes. */
export function DeleteButton({
  name,
  title,
  description,
  onConfirm,
}: {
  /** What the row holds, as the button is named: "Delete <name>". */
  name: string;
  /** The question asked. */
  title: string;
  /** What is lost, and what is kept. */
  description: string;
  onConfirm: () => void;
}) {
  return (
    <ConfirmButton
      variant="ghost"
      size="icon-sm"
      label={`Delete ${name}`}
      title={title}
      description={description}
      onConfirm={onConfirm}
      iconSlot={<Trash2 />}
    />
  );
}
