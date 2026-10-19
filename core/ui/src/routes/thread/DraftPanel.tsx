import { useEffect, useRef, useState } from "react";
import { BodyText, GdsBox, GdsDialog, GdsInline, GdsStack, InlineAlert, LabelText, MetadataText, SemanticButton, TextInput } from "@sovereignsquad/gds";
import { suggestDraft, useDraftCapabilities, type DraftCapabilities } from "../../api/queries";
import type { ApiError } from "../../api/client";
import type { Channel } from "../../api/types.gen";

export const ERROR_COPY: Record<string, string> = {
  drafting_disabled: "Drafting is turned off. Enable a local model to use it.",
  model_unavailable: "The local model is not reachable. Start Ollama and try again.",
  draft_timeout: "The model took too long. Try again or write the reply yourself.",
  timeout: "The model took too long. Try again or write the reply yourself.",
  empty_draft: "The model returned nothing. Try again.",
  draft_busy: "A draft is already being written.",
  contact_not_found: "This contact no longer exists. It may have been merged into another one.",
  network_error: "Reply Core could not be reached.",
};
// A missing model is "model_unavailable" but not retryable: the service message then says which model to pull.
export const draftErrorText = (e: ApiError) => (e.code === "model_unavailable" && !e.retryable ? e.message : (ERROR_COPY[e.code] ?? e.message));

export function offReason(c: DraftCapabilities | undefined): string {
  if (!c) return "Checking whether drafting is available…";
  if (c.reason === "model_missing") return `The model ${c.model ?? ""} is not installed. Run: ollama pull ${c.model ?? "<model>"}`;
  if (c.reason === "unreachable") return "The local model is not reachable. Start Ollama.";
  return "Drafting is turned off. To use it, install Ollama, pull a model and start Reply Core with REPLY_CORE_LLM=ollama and REPLY_CORE_OLLAMA_MODEL set (see docs/CORE_DRAFTING.md).";
}

type State = { status: "idle" | "loading" | "ready" | "error"; draft?: string; model?: string; error?: ApiError };

export function DraftPanel({ contactId, channel, composerText, onInsert }: { contactId: string; channel: Channel; composerText: string; onInsert: (text: string) => void }) {
  const caps = useDraftCapabilities();
  const [instruction, setInstruction] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [asking, setAsking] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const region = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []); // unmount, route change and contact switch all end here

  const model = caps.data?.model;
  const enabled = caps.data?.enabled === true;

  const run = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setState({ status: "loading", model });
    const r = await suggestDraft({ contactId, channel, ...(instruction.trim() ? { instruction: instruction.trim() } : {}) }, ctl.signal);
    if (ctl.signal.aborted) return; // discarded, or a newer request took over
    if (r.ok && r.data.draft.trim() === "") { setState({ status: "error", error: { code: "empty_draft", message: ERROR_COPY.empty_draft, requestId: "", retryable: false, status: 0 } }); return; }
    setState(r.ok ? { status: "ready", draft: r.data.draft, model: r.data.model } : { status: "error", error: r.error });
  };
  useEffect(() => { if (state.status === "ready") region.current?.focus(); }, [state.status]);

  const discard = () => { abort.current?.abort(); setState({ status: "idle" }); };
  const insert = (mode: "replace" | "append") => {
    const d = state.draft ?? "";
    onInsert(mode === "append" && composerText.trim() ? `${composerText}\n\n${d}` : d);
    setAsking(false);
    setState({ status: "idle" });
  };

  return (
    <GdsStack gap="sm" component="section" aria-label="Suggested reply">
      <GdsInline gap="sm" align="end" wrap="wrap">
        <TextInput label="What should the reply say? (optional)" maxLength={300} value={instruction} disabled={!enabled} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInstruction(e.currentTarget.value)} />
        <SemanticButton action="draft" label="Suggest a reply" brandVariant="outline-accent" disabled={!enabled || state.status === "loading"} onClick={() => void run()} />
      </GdsInline>
      {caps.data && !enabled ? <MetadataText>{offReason(caps.data)}</MetadataText> : null}

      <GdsBox component="output">{state.status === "loading" ? `Writing a draft${model ? ` with ${model}` : ""}…` : state.status === "ready" ? "A suggested reply is ready to review." : ""}</GdsBox>

      {state.status === "loading" ? <SemanticButton action="cancel" variant="default" onClick={discard} /> : null}

      {state.status === "error" && state.error ? (
        <InlineAlert severity="error" title="No draft was written" message={draftErrorText(state.error)} action={<SemanticButton action="refresh" label="Try again" onClick={() => void run()} />} />
      ) : null}

      {state.status === "ready" ? (
        <GdsStack gap="sm">
          <div ref={region} tabIndex={-1} role="region" aria-label="Suggested reply (AI-generated). Review before sending.">
            <GdsStack gap="xs">
              <LabelText>AI-generated draft. Review before sending.</LabelText>
              <MetadataText>{`Written by the local model ${state.model ?? ""}; nothing was inserted or sent.`}</MetadataText>
              {(state.draft ?? "").split("\n").filter((l) => l.trim() !== "").map((l, i) => <BodyText key={i}>{l}</BodyText>)}
            </GdsStack>
          </div>
          <GdsInline gap="sm">
            <SemanticButton action="add" label="Insert" onClick={() => (composerText.trim() ? setAsking(true) : insert("replace"))} />
            <SemanticButton action="refresh" label="Regenerate" variant="default" onClick={() => void run()} />
            <SemanticButton action="delete" label="Discard" variant="default" onClick={discard} />
          </GdsInline>
        </GdsStack>
      ) : null}

      <GdsDialog id="draft-insert" opened={asking} onClose={() => setAsking(false)} title="Insert the suggested reply" centered closeButtonProps={{ "aria-label": "Close" }}>
        <GdsStack gap="lg">
          <BodyText>You already wrote something. What should happen to it?</BodyText>
          <GdsInline justify="end" gap="sm" wrap="wrap">
            <SemanticButton action="cancel" variant="default" onClick={() => setAsking(false)} />
            <SemanticButton action="add" label="Add below my text" variant="default" onClick={() => insert("append")} />
            <SemanticButton action="confirm" label="Replace my text" onClick={() => insert("replace")} />
          </GdsInline>
        </GdsStack>
      </GdsDialog>
    </GdsStack>
  );
}
