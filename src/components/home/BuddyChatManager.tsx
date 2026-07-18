import { useBuddyChat } from "@/lib/buddyChat";
import BuddyChatWindow from "./BuddyChatWindow";
import BuddyChatDock from "./BuddyChatDock";

/** Cascading default position for a freshly-opened window that has no
 *  persisted position yet. Each successive un-minimized window shifts
 *  down + right so they don't stack directly. */
function defaultPositionFor(index: number): { x: number; y: number } {
  const OFFSET_X = 32;
  const OFFSET_Y = 32;
  // Anchor the first window ~380px from the right edge so it doesn't
  // overlap the dock, and 80px from the top.
  const baseX = window.innerWidth - 380 - 80;
  const baseY = 80;
  return {
    x: baseX - index * OFFSET_X,
    y: baseY + index * OFFSET_Y,
  };
}

/**
 * Renders every non-minimized chat window plus the always-visible dock.
 * Windows are top-level fixed elements (positioned via inline style)
 * and independently draggable — no parent layout concerns.
 */
export default function BuddyChatManager() {
  const { openChats } = useBuddyChat();
  const visible = openChats.filter((c) => !c.minimized);

  return (
    <>
      {visible.map((c, i) => (
        <BuddyChatWindow
          key={c.buddyId}
          buddyId={c.buddyId}
          messages={c.messages}
          defaultPosition={defaultPositionFor(i)}
        />
      ))}
      <BuddyChatDock />
    </>
  );
}
