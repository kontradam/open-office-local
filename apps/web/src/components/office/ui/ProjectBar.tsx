"use client";

import { useOfficeStore } from "@/store/office-store";
import type { Project } from "@/store/office-store";
import { useCallback, useMemo } from "react";
import { sendCommand } from "@/lib/connection";
import { useConfirm } from "./ConfirmModal";

interface ProjectBarProps {
  onNewProject: () => void;
  onHireAgent?: () => void;
}

/**
 * ProjectBar — Tab-style project switcher at top of workspace.
 * Shows active projects as tabs, with [+] for new project.
 * Empty state shows a prominent "New Project" CTA.
 * Phase 1 of project-centric architecture.
 */
export default function ProjectBar({ onNewProject, onHireAgent }: ProjectBarProps) {
  const projects = useOfficeStore((s) => s.projects);
  const activeProjectId = useOfficeStore((s) => s.activeProjectId);
  const agents = useOfficeStore((s) => s.agents);
  const setActiveProject = useOfficeStore((s) => s.setActiveProject);
  const archiveProject = useOfficeStore((s) => s.archiveProject);
  const { confirm, modal: confirmModal } = useConfirm();

  // Closing a tab fires the project's agents (the whole team, if any) and archives the project; files stay
  const handleClose = useCallback(async (p: Project) => {
    const present = p.agentIds.filter((id) => agents.has(id));
    const hasTeam = present.some((id) => !!agents.get(id)?.teamId);
    const msg = `Close project "${p.name}"? `
      + (present.length ? `Its agents (${present.length}) will be fired${hasTeam ? ", together with the whole team" : ""}. ` : "")
      + "Files in the folder stay.";
    if (!(await confirm(msg))) return;
    if (hasTeam) sendCommand({ type: "FIRE_TEAM" });
    for (const id of present) {
      if (!agents.get(id)?.teamId) sendCommand({ type: "FIRE_AGENT", agentId: id });
    }
    archiveProject(p.id);
  }, [agents, archiveProject, confirm]);

  const activeProjects = useMemo(() => {
    const list: Project[] = [];
    for (const [, p] of projects) {
      if (p.status === "active") list.push(p);
    }
    list.sort((a, b) => a.createdAt - b.createdAt);
    return list;
  }, [projects]);

  const handleTabClick = useCallback(
    (projectId: string) => {
      setActiveProject(projectId);
    },
    [setActiveProject]
  );

  // Empty state: no projects yet — show prominent CTA
  if (activeProjects.length === 0) {
    return (
      <div className="pbar pbar-empty">
        <button
          className="pbar-cta"
          onClick={onNewProject}
        >
          <span className="pbar-cta-icon">+</span>
          <span className="pbar-cta-label">New Project</span>
          <span className="pbar-cta-hint">Select a directory, then add agents</span>
        </button>
      </div>
    );
  }

  return (
    <div className="pbar">
      {confirmModal}
      <div className="pbar-tabs">
        {activeProjects.map((p) => {
          const isActive = p.id === activeProjectId;
          const agentCount = p.agentIds.filter((id) => agents.has(id)).length;
          return (
            <button
              key={p.id}
              className={`pbar-tab${isActive ? " pbar-tab-active" : ""}`}
              onClick={() => handleTabClick(p.id)}
              title={p.directory}
            >
              <span className="pbar-tab-name">{p.name}</span>
              <span className="pbar-tab-count">{agentCount}</span>
              <span
                role="button"
                aria-label={`Close project ${p.name}`}
                title="Close project"
                onClick={(e) => { e.stopPropagation(); handleClose(p); }}
                style={{ marginLeft: 2, padding: "0 4px", opacity: 0.55, cursor: "pointer", lineHeight: 1 }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.55"; }}
              >×</span>
            </button>
          );
        })}
        <button
          className="pbar-tab pbar-tab-new"
          onClick={onNewProject}
          title="New Project"
        >
          +
        </button>
      </div>
      {/* Right-aligned: Add Agent button when a project is active */}
      {activeProjectId && onHireAgent && (
        <button
          className="pbar-hire"
          onClick={onHireAgent}
          title="Add agent to project"
        >
          <span className="pbar-hire-icon">+</span>
          <span className="pbar-hire-label">Agent</span>
        </button>
      )}
    </div>
  );
}
