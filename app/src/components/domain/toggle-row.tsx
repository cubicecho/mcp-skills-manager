import type { ReactNode } from 'react';
import { SettingRow } from '@/components/setting-row';
import { Switch } from '@/components/ui/switch';

/** A setting that is on or off: what it is called and does, with the switch named and described by them. */
export function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: ReactNode;
  description: ReactNode;
  checked: boolean;
  /** Set while the change is being saved, so a second one cannot start. */
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <SettingRow
      title={title}
      description={description}
      actionSlot={({ titleId, descriptionId }) => (
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        />
      )}
    />
  );
}
