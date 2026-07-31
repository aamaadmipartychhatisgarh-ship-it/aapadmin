"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

// Day/Night toggle. Persists the choice and applies `.dark` on <html>. A tiny
// inline script in the root layout applies the saved theme before paint to avoid
// a flash, so this component just keeps the class in sync with the toggle.
export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle dark mode"
      className="w-10 h-10 rounded-full flex items-center justify-center text-gray-500 hover:text-[#164FA3] hover:bg-gray-100 transition-colors shrink-0"
    >
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  );
}
