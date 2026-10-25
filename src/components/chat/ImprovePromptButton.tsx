import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { ipc } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Review-only composer action: never submits, changes attachments or auto-replaces text. */
export function ImprovePromptButton({
  value,
  onApply,
  chatId,
  disabled = false,
}: {
  value: string;
  onApply: (original: string, improved: string) => void;
  chatId?: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [proposal, setProposal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<string | null>(null);
  const invalidate = useCallback(() => {
    const requestId = request.current;
    request.current = null;
    if (requestId)
      void ipc.prompt.cancelImprovement({ requestId }).catch(() => {});
  }, []);
  const close = useCallback(() => {
    invalidate();
    setOpen(false);
    setBusy(false);
  }, [invalidate]);
  useEffect(() => {
    close();
  }, [chatId, disabled, close]);
  useEffect(() => () => invalidate(), [invalidate]);

  async function generate() {
    if (request.current || disabled || !value.trim() || value.length > 12000)
      return;
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setSource(value);
    setProposal("");
    setError("");
    setBusy(true);
    try {
      const result = await ipc.prompt.improve({
        requestId,
        prompt: value,
        chatId,
      });
      if (request.current !== requestId) return;
      if (!result.prompt.trim() || result.prompt.length > 16000)
        throw new Error(
          "The model returned an invalid proposal. Your draft is unchanged.",
        );
      setProposal(result.prompt);
    } catch (cause) {
      if (request.current === requestId)
        setError(
          cause instanceof Error
            ? cause.message
            : "Prompt improvement failed. Your draft is unchanged.",
        );
    } finally {
      if (request.current === requestId) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  const stale = source !== value;
  const canGenerate = !disabled && !!value.trim() && value.length <= 12000;
  return (
    <>
      <button
        type="button"
        aria-label="Improve prompt"
        title={
          value.length > 12000
            ? "Prompt improvement supports up to 12,000 characters"
            : "Improve prompt"
        }
        disabled={!canGenerate}
        onClick={() => {
          setSource(value);
          setProposal("");
          setError("");
          setOpen(true);
        }}
        className="mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Sparkles size={20} aria-hidden="true" />
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Improve your prompt</DialogTitle>
            <DialogDescription>
              Clarify the outcome, constraints and acceptance criteria while
              preserving your intent. Review and edit the proposal before
              applying it.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Uses your selected {chatId ? "chat " : ""}model. Provider usage may
            incur charges. Only this draft is sent—not attachments or chat
            history. Nothing is sent as a chat message.
          </p>
          <label className="grid gap-2 text-sm">
            Original draft
            <textarea
              aria-label="Original draft"
              readOnly
              value={source}
              className="min-h-24 w-full rounded-md border bg-muted p-3"
            />
          </label>
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              Improving with your selected model…
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {proposal && (
            <label className="grid gap-2 text-sm">
              Proposed prompt — editable
              <textarea
                aria-label="Proposed prompt"
                value={proposal}
                onChange={(event) => setProposal(event.target.value)}
                maxLength={16000}
                className="min-h-48 w-full rounded-md border bg-background p-3"
              />
            </label>
          )}
          {stale && (
            <p role="alert" className="text-sm">
              Your draft changed. Generate a new proposal before applying; newer
              edits will not be overwritten.
            </p>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={close}>
              {busy ? "Cancel" : "Keep original"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !canGenerate}
              onClick={() => void generate()}
            >
              {proposal || error ? "Try again" : "Generate improvement"}
            </Button>
            <Button
              type="button"
              disabled={busy || disabled || stale || !proposal.trim()}
              onClick={() => {
                if (!disabled && !stale && proposal.trim()) {
                  onApply(source, proposal);
                  close();
                }
              }}
            >
              Apply to draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
