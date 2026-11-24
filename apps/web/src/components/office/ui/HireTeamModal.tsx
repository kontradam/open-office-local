"use client";

import { useState } from "react";
import { nanoid } from "nanoid";
import type { AgentDefinition } from "@office/shared";
import { sendCommand } from "@/lib/connection";
import { folderPickCallbacks } from "@/store/office-store";
import { BACKEND_OPTIONS, DEFAULT_BACKEND } from "./office-constants";
import { TERM_PANEL, TERM_SURFACE, TERM_DIM, TERM_TEXT_BRIGHT, TERM_BORDER, TERM_BG, TERM_GREEN, TERM_SEM_YELLOW } from "./termTheme";
import SpriteAvatar from "./SpriteAvatar";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";
import TermInput from "./primitives/TermInput";
import FileBrowser from "./FileBrowser";

function HireTeamModal({ agentDefs, onCreateTeam, onClose, assetsReady, detectedBackends, projectDir }: {
  agentDefs: AgentDefinition[];
  onCreateTeam: (leadId: string, memberIds: string[], backends: Record<string, string>, workDir?: string, autoApprove?: boolean, names?: Record<string, string>) => void;
  onClose: () => void;
  assetsReady?: boolean;
  detectedBackends?: string[];
  /** When set, directory is locked to project directory (project-centric mode) */
  projectDir?: string;
}) {
  const leader = agentDefs.find((a) => a.teamRole === "leader");
  const reviewer = agentDefs.find((a) => a.teamRole === "reviewer");
  const devAgents = agentDefs.filter((a) => a.teamRole === "dev");

  const [selectedDevId, setSelectedDevId] = useState<string>(devAgents[0]?.id ?? "");
  const [backends, setBackends] = useState<Record<string, string>>({});
  const [workDir, setWorkDir] = useState<string>(projectDir ?? "");
  const [autoApprove, setAutoApprove] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const nameField = (def: AgentDefinition) => (
    <TermInput type="text" value={names[def.id] ?? ""} maxLength={20} placeholder={`name: ${def.name}`}
      onClick={(e) => e.stopPropagation()} onChange={(e) => setNames((p) => ({ ...p, [def.id]: e.target.value }))}
      style={{ width: "100%", marginTop: 4, fontSize: 12, padding: "3px 6px" }} />
  );
  const dirLocked = !!projectDir;

  const handleCreate = () => {
    if (!leader) return;
    const memberIds: string[] = [];
    if (selectedDevId) memberIds.push(selectedDevId);
    if (reviewer) memberIds.push(reviewer.id);
    const customNames = Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.trim()]).filter(([k, v]) => v && (k === leader.id || memberIds.includes(k))));
    onCreateTeam(leader.id, memberIds, backends, workDir || undefined, autoApprove, Object.keys(customNames).length ? customNames : undefined);
  };

  const fixedRows: { def: AgentDefinition; label: string }[] = [];
  if (leader) fixedRows.push({ def: leader, label: "LEAD" });
  if (reviewer) fixedRows.push({ def: reviewer, label: "REVIEWER" });

  return (
    <TermModal
      open={true}
      onClose={onClose}
      maxWidth={540}
      zIndex={100}
      title="Hire Team"
      footer={
        <>
          <TermButton variant="primary" onClick={handleCreate} disabled={!leader} style={{ flex: 1, fontWeight: 700 }}>Create Team</TermButton>
          <TermButton variant="dim" onClick={onClose}>Cancel</TermButton>
        </>
      }
    >
      {/* Working directory picker */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: TERM_DIM, marginBottom: 5, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>
          PROJECT DIRECTORY{dirLocked && <span style={{ opacity: 0.5, marginLeft: 6 }}>(project)</span>}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <TermInput
            type="text"
            value={workDir}
            onChange={(e) => !dirLocked && setWorkDir(e.target.value)}
            placeholder="Paste path or click Browse"
            style={{ flex: 1, opacity: dirLocked ? 0.6 : 1 }}
            readOnly={dirLocked}
          />
          {!dirLocked && (
            <TermButton
              variant="dim"
              onClick={() => {
                setShowFiles(true);
              }}
            >Browse</TermButton>
          )}
        </div>
        {!dirLocked && (
          <div style={{ fontSize: 10, color: TERM_DIM, marginTop: 3, fontFamily: "var(--font-mono)", opacity: 0.7 }}>
            Empty = default workspace
          </div>
        )}
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 12, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12, color: autoApprove ? TERM_SEM_YELLOW : TERM_DIM }}>
        <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} style={{ marginTop: 2 }} />
        <span>
          Unattended mode: no plan approval
          <span style={{ display: "block", fontSize: 10, opacity: 0.75, marginTop: 2 }}>The lead asks no questions and the team starts right after the plan. Describe the goal precisely in the first message.</span>
        </span>
      </label>
      <div style={{ fontSize: 12, color: TERM_DIM, marginBottom: 6, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>SELECT TEAM MEMBERS</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
        {/* Fixed rows: leader and reviewer */}
        {fixedRows.map(({ def, label }) => (
          <div
            key={def.id}
            title={def.skills ? `Skills: ${def.skills}` : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
              border: `1px solid ${TERM_SEM_YELLOW}70`,
              backgroundColor: TERM_SURFACE,
              textAlign: "left",
            }}
          >
            <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: TERM_TEXT_BRIGHT }}>
                {def.name} <span style={{ color: TERM_SEM_YELLOW, fontSize: 11, fontFamily: "var(--font-mono)" }}>{label}</span>
              </div>
              <div style={{ fontSize: 13, color: TERM_DIM }}>{def.role}</div>
              {nameField(def)}
            </div>
            <select
              value={backends[def.id] ?? DEFAULT_BACKEND}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setBackends((prev) => ({ ...prev, [def.id]: e.target.value }))}
              style={{
                padding: "3px 6px", border: `1px solid ${TERM_BORDER}`,
                backgroundColor: TERM_BG, color: TERM_DIM, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-mono)",
              }}
            >
              {BACKEND_OPTIONS.map((b) => (
                <option key={b.id} value={b.id}>{b.name}{detectedBackends && detectedBackends.length > 0 && !detectedBackends.includes(b.id) ? " (?)" : ""}</option>
              ))}
            </select>
          </div>
        ))}

        {/* Dev cards */}
        <div style={{ fontSize: 12, color: TERM_DIM, marginTop: 4, marginBottom: 4, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>DEV AGENT (pick 1)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
          {devAgents.map((def) => {
            const selected = selectedDevId === def.id;
            return (
              <button
                key={def.id}
                onClick={() => setSelectedDevId(def.id)}
                title={def.skills ? `Skills: ${def.skills}` : undefined}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  padding: "12px 6px 10px",
                  border: selected ? `1px solid ${TERM_GREEN}60` : `1px solid ${TERM_BORDER}`,
                  backgroundColor: selected ? `${TERM_GREEN}0a` : "transparent",
                  cursor: "pointer", textAlign: "center",
                  opacity: selected ? 1 : 0.5,
                  transition: "opacity 0.15s, border-color 0.15s, background-color 0.15s",
                }}
              >
                <SpriteAvatar palette={def.palette} zoom={2} ready={assetsReady} />
                <div style={{ fontSize: 14, fontWeight: 700, color: TERM_TEXT_BRIGHT, marginTop: 6, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.name}</div>
                <div style={{ fontSize: 12, color: TERM_DIM, marginTop: 2, width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.role}</div>
                <select
                  value={backends[def.id] ?? DEFAULT_BACKEND}
                  onClick={(e) => { e.stopPropagation(); setSelectedDevId(def.id); }}
                  onChange={(e) => { setSelectedDevId(def.id); setBackends((prev) => ({ ...prev, [def.id]: e.target.value })); }}
                  style={{
                    marginTop: 6, padding: "3px 6px", border: `1px solid ${TERM_BORDER}`,
                    backgroundColor: TERM_BG, color: TERM_DIM, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-mono)",
                  }}
                >
                  {BACKEND_OPTIONS.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}{detectedBackends && detectedBackends.length > 0 && !detectedBackends.includes(b.id) ? " (?)" : ""}</option>
                  ))}
                </select>
              </button>
            );
          })}
        </div>
        {devAgents.find((d) => d.id === selectedDevId) && (
          <div style={{ marginTop: 4 }}>{nameField(devAgents.find((d) => d.id === selectedDevId)!)}</div>
        )}
      </div>
      <FileBrowser open={showFiles} onClose={() => setShowFiles(false)} mode="pick" startPath={workDir} onPick={(p) => setWorkDir(p)} />
    </TermModal>
  );
}

export default HireTeamModal;
