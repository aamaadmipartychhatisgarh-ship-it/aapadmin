"use client";

// In-app auto-updater UI.
//
// Runs only inside the Tauri desktop shell (detected via window.__TAURI__,
// exposed because tauri.conf.json has app.withGlobalTauri = true). In a plain
// browser it renders nothing.
//
// On mount it asks the updater plugin whether a newer signed release exists
// (endpoint = GitHub Releases latest.json). If so it shows a banner with an
// "Accept & Install" button. Clicking downloads + installs the update, then
// relaunches the app via the process plugin.

import { useEffect, useState, useCallback } from "react";

export default function UpdateChecker() {
  const [update, setUpdate] = useState(null); // the Update object when one is available
  const [status, setStatus] = useState("idle"); // idle | downloading | error | done
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(""); // transient message for manual checks

  const isTauri =
    typeof window !== "undefined" && typeof window.__TAURI__ !== "undefined";

  // Core check. `manual` = triggered by the sidebar button (shows feedback
  // even when no update / on error). Auto checks stay silent unless one is found.
  const runCheck = useCallback(
    async (manual) => {
      if (!isTauri) {
        if (manual) {
          setToast("Updates are only available in the desktop app.");
          setTimeout(() => setToast(""), 4000);
        }
        return;
      }
      try {
        if (manual) setToast("Checking for updates…");
        const { check } = window.__TAURI__.updater;
        const found = await check();
        if (found && found.available) {
          setToast("");
          setUpdate(found);
        } else if (manual) {
          // check() returned null/no-update → already current.
          setToast("You’re on the latest version.");
          setTimeout(() => setToast(""), 4000);
        }
      } catch (e) {
        const msg = String(e?.message || e || "");
        console.warn("update check failed:", e);
        if (manual) {
          // Some updater versions throw (instead of returning null) when there
          // is no newer release. Treat those as up-to-date.
          const upToDate =
            /up to date|no update|latest|could not fetch a valid release|no release/i.test(
              msg
            );
          // Otherwise surface the real error so failures are diagnosable.
          setToast(
            upToDate ? "You’re on the latest version." : `Update check error: ${msg}`
          );
          setTimeout(() => setToast(""), 8000);
        }
      }
    },
    [isTauri]
  );

  // Auto-check once on mount (silent).
  useEffect(() => {
    runCheck(false);
  }, [runCheck]);

  // Manual trigger: any component can dispatch window event "check-for-updates".
  useEffect(() => {
    const handler = () => runCheck(true);
    window.addEventListener("check-for-updates", handler);
    return () => window.removeEventListener("check-for-updates", handler);
  }, [runCheck]);

  const install = useCallback(async () => {
    if (!update) return;
    setStatus("downloading");
    setError("");
    try {
      let total = 0;
      let downloaded = 0;
      // downloadAndInstall streams progress events.
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data?.contentLength || 0;
            break;
          case "Progress":
            downloaded += event.data?.chunkLength || 0;
            if (total) setProgress(Math.round((downloaded / total) * 100));
            break;
          case "Finished":
            setProgress(100);
            break;
          default:
            break;
        }
      });
      setStatus("done");
      // Relaunch into the new version.
      const { relaunch } = window.__TAURI__.process;
      await relaunch();
    } catch (e) {
      console.error("update install failed:", e);
      setError(String(e?.message || e));
      setStatus("error");
    }
  }, [update]);

  // No update banner, but maybe a transient toast (from a manual check).
  if (!update) {
    if (!toast) return null;
    return (
      <div
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 9999,
          maxWidth: "calc(100vw - 32px)",
          background: "#111827",
          color: "#fff",
          borderRadius: 10,
          boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
          padding: "12px 16px",
          fontSize: 13,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {toast}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        width: 360,
        maxWidth: "calc(100vw - 32px)",
        background: "#0B3A82",
        color: "#fff",
        borderRadius: 12,
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        padding: 16,
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
        Update available
      </div>
      <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 12 }}>
        Version {update.version} is ready to install.
        {update.body ? (
          <div style={{ marginTop: 6, opacity: 0.8 }}>{update.body}</div>
        ) : null}
      </div>

      {status === "downloading" && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              height: 6,
              background: "rgba(255,255,255,0.25)",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: "100%",
                background: "#fff",
                transition: "width 0.2s",
              }}
            />
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Downloading… {progress}%
          </div>
        </div>
      )}

      {status === "error" && (
        <div style={{ fontSize: 12, color: "#ffd2d2", marginBottom: 8 }}>
          Update failed: {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {status !== "downloading" && status !== "done" && (
          <button
            onClick={() => setUpdate(null)}
            style={{
              background: "transparent",
              color: "#cfe0ff",
              border: "1px solid rgba(255,255,255,0.35)",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Later
          </button>
        )}
        <button
          onClick={install}
          disabled={status === "downloading" || status === "done"}
          style={{
            background: "#fff",
            color: "#0B3A82",
            border: "none",
            borderRadius: 8,
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 700,
            cursor:
              status === "downloading" || status === "done"
                ? "default"
                : "pointer",
            opacity: status === "downloading" || status === "done" ? 0.7 : 1,
          }}
        >
          {status === "done"
            ? "Restarting…"
            : status === "downloading"
            ? "Installing…"
            : "Accept & Install"}
        </button>
      </div>
    </div>
  );
}
