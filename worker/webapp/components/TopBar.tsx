import React from "react";
import { ENTITY_CODES, ENTITY_LABELS, type CfoDailyCloseRow, type EntitySelection, type Grain, type Preset } from "../types";
import { CloseBadge } from "./CloseBadge";

interface TopBarProps {
  entity: EntitySelection;
  onEntity: (e: EntitySelection) => void;
  grain: Grain;
  onGrain: (g: Grain) => void;
  preset: Preset;
  onPreset: (p: Preset) => void;
  asOf: string | null;
  closeLatest: CfoDailyCloseRow | null;
  onOpenChat: () => void;
}

const ENTITY_OPTIONS: Array<{ value: EntitySelection; label: string }> = [
  { value: "all", label: "All business" },
  ...ENTITY_CODES.map((c) => ({ value: c, label: ENTITY_LABELS[c] })),
];

export function TopBar({ entity, onEntity, grain, onGrain, preset, onPreset, asOf, closeLatest, onOpenChat }: TopBarProps) {
  const isPersonal = entity === "ariel_personal";
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="topbar-brand">
          <h1>Everest CFO Agent</h1>
          {asOf && <p className="topbar-asof">Live from finance.* &mdash; as of {new Date(asOf).toLocaleString()}</p>}
          <div>
            <CloseBadge latest={closeLatest} />
          </div>
        </div>
        <button type="button" className="chat-open-btn" onClick={onOpenChat} aria-label="Open CFO chat">
          Ask the CFO
        </button>
      </div>
      <div className="topbar-controls">
        <label className="control-group">
          <span className="control-label">Entity</span>
          <select value={entity} onChange={(e) => onEntity(e.target.value as EntitySelection)} aria-label="Entity">
            {ENTITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {isPersonal && <span className="badge badge-personal">PERSONAL</span>}
        </label>

        <div className="control-group" role="group" aria-label="Time grain">
          <span className="control-label">Grain</span>
          <div className="segmented">
            {(["day", "week", "month"] as Grain[]).map((g) => (
              <button key={g} type="button" aria-pressed={grain === g} className={grain === g ? "toggle-active" : ""} onClick={() => onGrain(g)}>
                {g[0].toUpperCase() + g.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group" role="group" aria-label="Date range preset">
          <span className="control-label">Range</span>
          <div className="segmented">
            {(["30d", "90d", "ytd", "all"] as Preset[]).map((p) => (
              <button key={p} type="button" aria-pressed={preset === p} className={preset === p ? "toggle-active" : ""} onClick={() => onPreset(p)}>
                {p.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
