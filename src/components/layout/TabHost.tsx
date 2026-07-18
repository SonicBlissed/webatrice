import { useTabs, type Tab } from "@/lib/tabs";
import Home from "@/routes/Home";
import MyDecks from "@/routes/MyDecks";
import DeckEditor from "@/routes/DeckEditor";
import GameRoom from "@/routes/GameRoom";
import Profile from "@/routes/Profile";

function TabContent({ tab }: { tab: Tab }) {
  switch (tab.type) {
    case "lobby":
      return <Home />;
    case "my-decks":
      return <MyDecks />;
    case "deck": {
      const deckId = tab.data?.deckId as string | undefined;
      if (!deckId) return null;
      return <DeckEditor deckId={deckId} tabId={tab.id} />;
    }
    case "game": {
      const roomId = tab.data?.roomId as string | undefined;
      if (!roomId) return null;
      return <GameRoom roomId={roomId} title={tab.title} tabId={tab.id} />;
    }
    case "profile":
      return <Profile />;
  }
}

export default function TabHost() {
  const { tabs, activeTabId } = useTabs();

  // Render every tab so its state survives switching away and coming back.
  // Only the active one is visible; others are `hidden` (display: none).
  return (
    <div className="h-full relative">
      {tabs.map((tab) => (
        <div key={tab.id} hidden={tab.id !== activeTabId} className="h-full">
          <TabContent tab={tab} />
        </div>
      ))}
    </div>
  );
}
