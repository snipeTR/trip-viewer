import { useState } from "react";

/** localStorage flag: when "1", the shortcuts overlay does NOT auto-open
 *  on startup. Toggled by the checkbox in this dialog. */
export const SKIP_SHORTCUTS_KEY = "tripviewer.skipShortcutsOnStartup";

interface Props {
  onClose: () => void;
}

const shortcuts = [
  { keys: "Space", action: "Play / Pause" },
  { keys: "\u2190 / \u2192", action: "Seek 5 seconds" },
  { keys: "Shift + \u2190 / \u2192", action: "Seek 30 seconds" },
  { keys: "[ / ]", action: "Decrease / Increase speed" },
  { keys: "D", action: "Toggle drift HUD" },
];

const interactions = [
  { gesture: "Click side video", action: "Make it the main view" },
  { gesture: "Double-click main video", action: "Toggle fullscreen" },
  { gesture: "Escape", action: "Exit fullscreen" },
];

export function KeyboardShortcutsHelp({ onClose }: Props) {
  const [skipOnStartup, setSkipOnStartup] = useState(
    () =>
      typeof localStorage !== "undefined" &&
      localStorage.getItem(SKIP_SHORTCUTS_KEY) === "1",
  );

  function toggleSkip(next: boolean) {
    setSkipOnStartup(next);
    try {
      if (next) localStorage.setItem(SKIP_SHORTCUTS_KEY, "1");
      else localStorage.removeItem(SKIP_SHORTCUTS_KEY);
    } catch {
      // localStorage unavailable (private mode / disabled) — the dialog
      // just falls back to showing every startup, which is harmless.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-100">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-300"
          >
            &times;
          </button>
        </div>

        <table className="w-full text-xs">
          <tbody>
            {shortcuts.map((s) => (
              <tr key={s.keys} className="border-b border-neutral-800">
                <td className="py-1.5 pr-4">
                  <kbd className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-neutral-300">
                    {s.keys}
                  </kbd>
                </td>
                <td className="py-1.5 text-neutral-400">{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-2 mt-4 text-xs font-semibold text-neutral-400">
          Mouse
        </h3>
        <table className="w-full text-xs">
          <tbody>
            {interactions.map((s) => (
              <tr key={s.gesture} className="border-b border-neutral-800">
                <td className="py-1.5 pr-4 text-neutral-300">{s.gesture}</td>
                <td className="py-1.5 text-neutral-400">{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={skipOnStartup}
            onChange={(e) => toggleSkip(e.target.checked)}
            className="h-3.5 w-3.5 accent-blue-600"
          />
          Don&rsquo;t show this automatically on startup
        </label>
      </div>
    </div>
  );
}
