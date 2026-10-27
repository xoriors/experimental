import { useEffect, useState } from "react";
import type { ArtifactMeta } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { ArtifactFrame } from "./ArtifactFrame.tsx";

interface Props {
  artifactId: string;
  /** The newest version this chat knows of; a change reloads the metadata and shows it. */
  latestKnown?: number;
  uid: string | undefined;
  onClose?: () => void;
  fullPage?: boolean;
}

export function ArtifactPanel({ artifactId, latestKnown, uid, onClose, fullPage }: Props) {
  const [meta, setMeta] = useState<Omit<ArtifactMeta, "chatId"> | null>(null);
  const [version, setVersion] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .artifact(artifactId)
      .then((m) => {
        if (cancelled) return;
        setMeta(m);
        setVersion(m.latest);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [artifactId, latestKnown]);

  if (error) return <div className="panel-empty">Could not load this artifact: {error}</div>;
  if (!meta || version === undefined) return <div className="panel-empty">Loading…</div>;
  const entry = meta.versions.find((v) => v.version === version) ?? meta.versions[meta.versions.length - 1];
  const servers = entry.manifest.mcp?.servers ?? [];

  return (
    <section className={fullPage ? "artifact-panel full" : "artifact-panel"}>
      <header className="artifact-bar">
        <div className="artifact-title">
          <strong>{meta.title}</strong>
          {servers.length > 0 && <span className="pill live">live · {servers.map((s) => s.server).join(", ")}</span>}
        </div>
        <div className="artifact-actions">
          <select value={entry.version} onChange={(e) => setVersion(Number(e.target.value))} aria-label="Version">
            {[...meta.versions].reverse().map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.version === meta.latest ? " (latest)" : ""}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setReloads((n) => n + 1)} title="Reload the page">
            ↻
          </button>
          {!fullPage && (
            <a className="button" href={`/a/${meta.id}`} target="_blank" rel="noreferrer" title="Open on its own page to share">
              ↗
            </a>
          )}
          {onClose && (
            <button type="button" onClick={onClose} title="Close the preview">
              ✕
            </button>
          )}
        </div>
      </header>
      <ArtifactFrame key={reloads} artifactId={meta.id} version={entry.version} manifest={entry.manifest} uid={uid} title={meta.title} />
    </section>
  );
}
