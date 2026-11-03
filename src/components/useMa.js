"use client";
import { useEffect, useState, useCallback } from "react";

// Is Amount & Expenses currently shown (Admin's MA switch)? Fresh on mount, on focus and on demand.
export function useMa() {
  const [state, setState] = useState({ enabled: null, canManage: false });
  const load = useCallback(() => {
    fetch("/api/ma", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setState({ enabled: !!d.enabled, canManage: !!d.can_manage }); }).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const on = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("focus", on); document.addEventListener("visibilitychange", on);
    return () => { window.removeEventListener("focus", on); document.removeEventListener("visibilitychange", on); };
  }, [load]);
  return { ...state, reload: load, setEnabled: (v) => setState((s) => ({ ...s, enabled: v })) };
}
