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

  const isTauri =
    typeof window !== "undefined" && typeof window.__TAURI__ !== "undefined";

  // Check for an update on mount (desktop only).
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    (async () => {
      try {
        const { check } = window.__TAURI__.updater;
        const found = await check();
        if (!cancelled && found && found.available) {
          setUpdate(found);
        }
      } catch (e) {
        // Network/endpoint errors are non-fatal — just skip the banner.
        console.warn("update check failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauri]);

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

  if (!isTauri || !update) return null;

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
