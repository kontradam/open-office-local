"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { nanoid } from "nanoid";
import type { DirListedEvent, FileReadEvent } from "@office/shared";
import { sendCommand } from "@/lib/connection";
import { dirListCallbacks, fileReadCallbacks } from "@/store/office-store";
import { TERM_DIM, TERM_BORDER, TERM_BG, TERM_GREEN, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_SEM_RED, TERM_SEM_YELLOW } from "./termTheme";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";

type Entry = DirListedEvent["entries"][number];

const ROOT_LABEL = process.env.NEXT_PUBLIC_WORKSPACE_LABEL || "workspace";

function formatSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDate(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function FileBrowser({ open, onClose, mode, startPath, onPick, zIndex }: {
  open: boolean;
  onClose: () => void;
  mode: "pick" | "view";
  startPath?: string;
  onPick?: (path: string) => void;
  zIndex?: number;
}) {
  const [listing, setListing] = useState<DirListedEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<FileReadEvent | null>(null);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);   // null = input hidden
  const [folderError, setFolderError] = useState<string | null>(null);

  const openDir = useCallback((p?: string) => {
    const rid = nanoid(8);
    setLoading(true);
    dirListCallbacks.set(rid, (ev) => { setListing(ev); setLoading(false); });
    sendCommand({ type: "LIST_DIR", requestId: rid, path: p });
  }, []);

  const createFolder = useCallback(() => {
    if (!listing || newFolder === null || !newFolder.trim()) return;
    const rid = nanoid(8);
    setLoading(true);
    dirListCallbacks.set(rid, (ev) => {
      setLoading(false);
      if (ev.created) {
        setNewFolder(null); setFolderError(null); setFile(null);
        openDir(ev.created);
      } else {
        setListing(ev); setFolderError(ev.error ?? "Could not create the folder");
      }
    });
    sendCommand({ type: "MAKE_DIR", requestId: rid, path: listing.path, name: newFolder.trim() });
  }, [listing, newFolder, openDir]);

  const openFile = useCallback((p: string) => {
    const rid = nanoid(8);
    setLoadingFile(p);
    fileReadCallbacks.set(rid, (ev) => { setFile(ev); setLoadingFile(null); });
    sendCommand({ type: "READ_FILE", requestId: rid, path: p });
  }, []);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    openDir(startPath && startPath.trim() ? startPath.trim() : undefined);
  }, [open, startPath, openDir]);

  const crumbs = useMemo(() => {
    if (!listing) return [];
    const rel = listing.path === listing.root ? "" : listing.path.slice(listing.root.length + 1);
    const parts = rel ? rel.split("/") : [];
    const out = [{ label: ROOT_LABEL, path: listing.root }];
    let s = listing.root;
    for (const c of parts) { s = `${s}/${c}`; out.push({ label: c, path: s }); }
    return out;
  }, [listing]);

  const entries = useMemo(
    () => (listing?.entries ?? []).filter((w) => showHidden || !w.name.startsWith(".")),
    [listing, showHidden],
  );
  const hiddenCount = (listing?.entries.length ?? 0) - entries.length;
  const parent = listing && listing.path !== listing.root ? listing.path.slice(0, listing.path.lastIndexOf("/")) : null;

  const select = (w: Entry) => {
    if (!listing) return;
    const p = `${listing.path}/${w.name}`;
    if (w.dir) { setFile(null); openDir(p); } else openFile(p);
  };

  const row: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "4px 8px",
    background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
    fontFamily: "var(--font-mono)", fontSize: 12, color: TERM_TEXT,
  };

  return (
    <TermModal
      open={open}
      onClose={onClose}
      maxWidth={file ? 1100 : 640}
      zIndex={zIndex ?? 20000}
      title={mode === "pick" ? "Choose a working folder" : `Files in ${ROOT_LABEL}`}
      footer={
        <>
          <span style={{ flex: 1, fontSize: 10, color: TERM_DIM, fontFamily: "var(--font-mono)", opacity: 0.8 }}>
            You can create folders here; files cannot be changed or deleted.
          </span>
          <TermButton variant="dim" onClick={onClose}>{mode === "pick" ? "Cancel" : "Close"}</TermButton>
          {mode === "pick" && (
            <TermButton
              variant="primary"
              disabled={!listing || !!listing.error}
              onClick={() => { if (listing) { onPick?.(listing.path); onClose(); } }}
            >Use this folder</TermButton>
          )}
        </>
      }
    >
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 2, marginBottom: 6, fontFamily: "var(--font-mono)", fontSize: 12 }}>
        {crumbs.map((o, i) => (
          <span key={o.path} style={{ display: "inline-flex", alignItems: "center" }}>
            {i > 0 && <span style={{ color: TERM_DIM, margin: "0 2px" }}>/</span>}
            <button
              onClick={() => { setFile(null); openDir(o.path); }}
              style={{ background: "none", border: "none", padding: "1px 3px", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit",
                color: i === crumbs.length - 1 ? TERM_TEXT_BRIGHT : TERM_GREEN }}
            >{o.label}</button>
          </span>
        ))}
        {loading && <span style={{ color: TERM_DIM, marginLeft: 6 }}>loading…</span>}
        <span style={{ flex: 1 }} />
        {newFolder === null && listing && !listing.error && (
          <TermButton variant="dim" onClick={() => { setNewFolder(""); setFolderError(null); }}>+ New folder</TermButton>
        )}
      </div>
      {newFolder !== null && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
          <input
            autoFocus
            value={newFolder}
            onChange={(e) => { setNewFolder(e.target.value); setFolderError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setNewFolder(null); }}
            placeholder="new folder name, e.g. my-project"
            maxLength={80}
            style={{ flex: "1 1 200px", padding: "4px 8px", fontFamily: "var(--font-mono)", fontSize: 12, background: TERM_BG,
              color: TERM_TEXT_BRIGHT, border: `1px solid ${TERM_BORDER}`, outline: "none" }}
          />
          <TermButton variant="primary" disabled={!newFolder.trim()} onClick={createFolder}>Create</TermButton>
          <TermButton variant="dim" onClick={() => { setNewFolder(null); setFolderError(null); }}>Cancel</TermButton>
          {folderError && <span style={{ width: "100%", color: TERM_SEM_RED, fontSize: 11 }}>{folderError}</span>}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
                <div style={{ flex: "1 1 280px", minWidth: 240, maxHeight: "60vh", overflowY: "auto", border: `1px solid ${TERM_BORDER}`, background: TERM_BG }}>
          {listing?.error && <div style={{ padding: 8, color: TERM_SEM_RED, fontSize: 12 }}>{listing.error}</div>}
          {parent && (
            <button style={row} onClick={() => { setFile(null); openDir(parent); }}>
              <span style={{ width: 16, color: TERM_DIM }}>↑</span><span style={{ color: TERM_DIM }}>..</span>
            </button>
          )}
          {entries.map((w) => {
            const active = !w.dir && file?.path === `${listing?.path}/${w.name}`;
            return (
              <button
                key={w.name}
                style={{ ...row, background: active ? TERM_GREEN + "20" : "transparent" }}
                onClick={() => select(w)}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = TERM_GREEN + "10"; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                title={`${w.name}\nmodified: ${formatDate(w.mtime)}`}
              >
                <span style={{ width: 16, color: w.dir ? TERM_SEM_YELLOW : TERM_DIM }}>{w.dir ? "▸" : "·"}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: w.dir ? TERM_TEXT_BRIGHT : TERM_TEXT }}>
                  {w.name}{w.dir ? "/" : ""}
                </span>
                {!w.dir && <span style={{ color: TERM_DIM, fontSize: 10 }}>{loadingFile === `${listing?.path}/${w.name}` ? "…" : formatSize(w.size)}</span>}
              </button>
            );
          })}
          {listing && !listing.error && entries.length === 0 && (
            <div style={{ padding: 8, color: TERM_DIM, fontSize: 12 }}>Empty folder</div>
          )}
          {(hiddenCount > 0 || showHidden) && (
            <button style={{ ...row, color: TERM_DIM, fontSize: 10 }} onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? "hide hidden files" : `show hidden files (${hiddenCount})`}
            </button>
          )}
          {listing?.truncated && <div style={{ padding: 8, color: TERM_DIM, fontSize: 10 }}>Showing the first 3000 entries.</div>}
        </div>

                {file && (
          <div style={{ flex: "2 1 420px", minWidth: 280, maxHeight: "60vh", display: "flex", flexDirection: "column", border: `1px solid ${TERM_BORDER}`, background: TERM_BG }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderBottom: `1px solid ${TERM_BORDER}`, fontFamily: "var(--font-mono)", fontSize: 11 }}>
              <span style={{ flex: 1, color: TERM_TEXT_BRIGHT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.path.split("/").pop()}</span>
              <span style={{ color: TERM_DIM }}>{formatSize(file.size)}</span>
              <button onClick={() => setFile(null)} style={{ background: "none", border: "none", color: TERM_DIM, cursor: "pointer" }} aria-label="Close preview">×</button>
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              {file.error ? (
                <div style={{ padding: 8, color: TERM_SEM_RED, fontSize: 12 }}>{file.error}</div>
              ) : file.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`data:${file.mime};base64,${file.content}`} alt={file.path} style={{ maxWidth: "100%", display: "block", margin: "8px auto" }} />
              ) : file.kind === "binary" ? (
                <div style={{ padding: 8, color: TERM_DIM, fontSize: 12 }}>Binary file: cannot be shown as text.</div>
              ) : (
                <>
                  <pre style={{ margin: 0, padding: 8, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.45, color: TERM_TEXT, whiteSpace: "pre", tabSize: 4 }}>
                    {(file.content ?? "").split("\n").map((l, i) => (
                      <div key={i} style={{ display: "flex" }}>
                        <span style={{ width: 44, flexShrink: 0, color: TERM_DIM, opacity: 0.6, textAlign: "right", paddingRight: 10, userSelect: "none" }}>{i + 1}</span>
                        <span>{l || " "}</span>
                      </div>
                    ))}
                  </pre>
                  {file.truncated && <div style={{ padding: 8, color: TERM_SEM_YELLOW, fontSize: 11 }}>Showing the first 512 KB of the file.</div>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </TermModal>
  );
}
