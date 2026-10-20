import { useRef, useState } from "react";
import { BodyText, GdsBox, GdsInline, GdsStack, InlineAlert, MetadataText, SemanticButton } from "@sovereignsquad/gds";
import { fetchJson, type ApiError } from "../../api/client";

export type Attached = { id: string; name: string; size: number };

// The service's limits (docs/CORE_SENDING.md): shown here only to refuse early; the service checks them again.
export const MAX_FILE_MB = 20;
export const MAX_FILES = 5;
export const MAX_TOTAL_MB = 25;

export const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Files for iMessage and Mail: each is uploaded when picked (waits in the service until sent, removed or an hour passes).
export function Attachments({ files, onChange, disabled }: { files: Attached[]; onChange: (f: Attached[]) => void; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setError(null);
    setBusy(true);
    let next = files;
    for (const file of Array.from(list)) {
      if (next.length >= MAX_FILES) { setError(`At most ${MAX_FILES} files can be sent at once.`); break; }
      if (file.size > MAX_FILE_MB * 1024 * 1024) { setError(`${file.name} is over ${MAX_FILE_MB} MB.`); continue; }
      if (file.size === 0) { setError(`${file.name} is empty.`); continue; }
      if (next.reduce((n, f) => n + f.size, file.size) > MAX_TOTAL_MB * 1024 * 1024) { setError(`Together the files can be at most ${MAX_TOTAL_MB} MB.`); break; }
      const r = await fetchJson<Attached>(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file, timeoutMs: 120_000 });
      if (!r.ok) { setError((r.error as ApiError).message); continue; }
      next = [...next, r.data];
      onChange(next);
    }
    setBusy(false);
    if (input.current) input.current.value = "";
  };

  const remove = async (f: Attached) => {
    onChange(files.filter((x) => x.id !== f.id));
    await fetchJson(`/api/uploads/${encodeURIComponent(f.id)}`, { method: "DELETE" }); // best effort: it expires anyway
  };

  return (
    <GdsStack gap="xs">
      <GdsBox>
        <input ref={input} type="file" multiple hidden aria-label="Choose files to attach" onChange={(e) => void pick(e.currentTarget.files)} />
        <SemanticButton action="add" label="Attach files" variant="default" loading={busy} disabled={disabled || busy || files.length >= MAX_FILES} onClick={() => input.current?.click()} />
      </GdsBox>
      {error ? <InlineAlert severity="warning" title="A file was not attached" message={error} /> : null}
      {files.length > 0 ? (
        <GdsStack component="ul" gap="xs" aria-label="Attached files">
          {files.map((f) => (
            <GdsBox component="li" key={f.id}>
              <GdsInline gap="sm" align="center">
                <BodyText>{f.name}</BodyText>
                <MetadataText>{sizeLabel(f.size)}</MetadataText>
                <SemanticButton action="reset" label={`Remove ${f.name}`} variant="default" disabled={disabled} onClick={() => void remove(f)} />
              </GdsInline>
            </GdsBox>
          ))}
        </GdsStack>
      ) : null}
    </GdsStack>
  );
}
