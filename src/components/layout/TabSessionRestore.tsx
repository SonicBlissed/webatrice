import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useTabs } from "@/lib/tabs";
import { fetchMyActiveRooms } from "@/lib/rooms";

/**
 * On sign-in, look up every open room the user is still a member of and
 * reopen its tab. This is the reconnection story: closing the browser, losing
 * power, or refreshing does NOT leave a room — only the explicit Leave button
 * does — so a returning user should find their seat waiting for them.
 *
 * Renders no UI; runs once per authenticated user.
 */
export default function TabSessionRestore() {
  const { user } = useAuth();
  const { restore } = useTabs();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchMyActiveRooms(user.id)
      .then((rooms) => {
        if (cancelled) return;
        for (const r of rooms) {
          // Use `restore` (not `openOrFocus`) so a mid-refresh discovery of
          // a room-membership doesn't yank the user off whatever tab they
          // actually had active before refresh.
          restore({
            id: `game-${r.roomId}`,
            type: "game",
            title: r.name,
            data: { roomId: r.roomId },
          });
        }
      })
      .catch((e) => {
        console.error("[TabSessionRestore] failed to restore rooms:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, restore]);

  return null;
}
