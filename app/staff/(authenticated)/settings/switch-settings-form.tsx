"use client";

import { useState } from "react";
import { saveSwitch } from "./switch-settings-actions";
import type { SwitchState } from "./switches";

export default function SwitchSettingsForm({ initial }: { initial: SwitchState[] }) {
  const [state, setState] = useState(() => Object.fromEntries(initial.map((s) => [s.key, s.on])));
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function toggle(key: string, next: boolean) {
    const prev = state[key];
    setState((s) => ({ ...s, [key]: next }));
    setBusyKey(key); setMsg(null);
    const res = await saveSwitch(key, next);
    setBusyKey(null);
    if (!res.success) {
      setState((s) => ({ ...s, [key]: prev }));
      setMsg({ ok: false, text: res.error ?? "Couldn’t save." });
    } else {
      setMsg({ ok: true, text: "Saved." });
    }
  }

  return (
    <div className="card" id="automation-switches" style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 16, marginBottom: 6 }}>Automation switches</h2>
      <p className="muted-text" style={{ fontSize: 13, marginBottom: 12 }}>
        Each switch saves as soon as you click it. Turning one off takes effect immediately.
      </p>
      {initial.map((s) => (
        <div key={s.key} style={{ marginBottom: 12 }}>
          <label className="checkbox-item">
            <input type="checkbox" checked={!!state[s.key]} disabled={busyKey === s.key} onChange={(e) => toggle(s.key, e.target.checked)} />
            {s.label}
          </label>
          <p className="muted-text" style={{ fontSize: 12, margin: "2px 0 0 26px" }}>{s.help}</p>
        </div>
      ))}
      {msg && <p className={msg.ok ? "muted-text" : "error-text"} style={{ marginTop: 4 }}>{msg.text}</p>}
    </div>
  );
}
