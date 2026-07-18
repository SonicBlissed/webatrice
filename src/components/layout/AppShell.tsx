import { TabsProvider } from "@/lib/tabs";
import { BuddyChatProvider } from "@/lib/buddyChat";
import TopBar from "./TopBar";
import TabHost from "./TabHost";
import TabSessionRestore from "./TabSessionRestore";
import BuddyChatManager from "@/components/home/BuddyChatManager";

export default function AppShell() {
  return (
    <TabsProvider>
      <BuddyChatProvider>
        <TabSessionRestore />
        <div className="flex h-full flex-col bg-bg-base bg-purple-radial">
          <TopBar />
          <main className="flex-1 min-h-0 overflow-hidden">
            <TabHost />
          </main>
        </div>
        {/* Floating chat windows + dock live at the shell level so they
            persist across tab switches and render above every page. */}
        <BuddyChatManager />
      </BuddyChatProvider>
    </TabsProvider>
  );
}
