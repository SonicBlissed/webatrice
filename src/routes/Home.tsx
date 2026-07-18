import RoomList from "@/components/home/RoomList";
import PlayerList from "@/components/home/PlayerList";
import ChatPanel from "@/components/home/ChatPanel";

export default function Home() {
  return (
    <div
      className="relative grid h-full"
      style={{
        gridTemplateColumns: "1fr 280px",
        gridTemplateRows: "1fr 280px",
      }}
    >
      <div className="min-h-0 p-6 overflow-hidden">
        <RoomList />
      </div>
      <div className="row-span-2 min-h-0">
        <PlayerList />
      </div>
      <div className="min-h-0">
        <ChatPanel />
      </div>
    </div>
  );
}
