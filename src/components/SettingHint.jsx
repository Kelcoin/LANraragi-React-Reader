import React from 'react';
import { Tooltip } from '@base-ui/react/tooltip';

export default function SettingHint({ text, children, className = 'settings-row-title' }) {
  if (!text) return <span className={className}>{children}</span>;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        delay={260}
        closeDelay={80}
        render={<span className="settings-hint-wrap" tabIndex={0} />}
      >
        <span className={className}>{children}</span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner
          className="settings-hint-positioner"
          side="top"
          align="start"
          sideOffset={8}
          positionMethod="fixed"
          collisionPadding={16}
        >
          <Tooltip.Popup className="settings-hint-bubble settings-hint-bubble-portal is-visible">
            {text}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
