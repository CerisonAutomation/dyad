import { ModelPicker } from "./ModelPicker";
import { Agent2SourceSelector } from "./Agent2SourceSelector";
import { ChatModeSelector } from "./ChatModeSelector";

export function ChatInputControls() {
  return (
    <div className="flex items-center">
      <ChatModeSelector />
      <div className="w-1.5"></div>
      <ModelPicker />
      <Agent2SourceSelector />
    </div>
  );
}
