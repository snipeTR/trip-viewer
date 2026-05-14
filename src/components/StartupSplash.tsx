import type { StartupSnapshot, StartupTask } from "../ipc/startup";

function pickActive(tasks: StartupTask[]): StartupTask | null {
  if (tasks.length === 0) return null;
  return (
    tasks.find((t) => t.status === "running") ??
    tasks.find((t) => t.status === "pending") ??
    tasks[tasks.length - 1]
  );
}

function statusGlyph(status: StartupTask["status"]): string {
  switch (status) {
    case "done":
      return "✓";
    case "running":
      return "●";
    case "failed":
      return "✕";
    default:
      return "○";
  }
}

function statusColor(status: StartupTask["status"]): string {
  switch (status) {
    case "done":
      return "text-emerald-400";
    case "running":
      return "text-blue-400";
    case "failed":
      return "text-red-400";
    default:
      return "text-neutral-500";
  }
}

export function StartupSplash({ snapshot }: { snapshot: StartupSnapshot }) {
  const active = pickActive(snapshot.tasks);
  const determinate =
    active && active.total != null && active.total > 0
      ? Math.min(100, Math.round((active.current / active.total) * 100))
      : null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-neutral-950">
      <div className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-900 p-8 shadow-2xl">
        <h1 className="text-center text-2xl font-semibold text-neutral-100">
          Trip Viewer
        </h1>
        <p className="mt-1 text-center text-sm text-neutral-400">
          Preparing archive…
        </p>

        {active && (
          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-neutral-200">
                {active.label}
              </span>
              {active.total != null && (
                <span className="text-xs tabular-nums text-neutral-400">
                  {active.current} / {active.total}
                </span>
              )}
            </div>

            <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
              {determinate != null ? (
                <div
                  className="h-full bg-blue-500 transition-all duration-200"
                  style={{ width: `${determinate}%` }}
                />
              ) : (
                <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500" />
              )}
            </div>

            {determinate != null && (
              <div className="mt-1 text-right text-xs tabular-nums text-neutral-500">
                {determinate}%
              </div>
            )}

            <p className="mt-3 text-xs leading-relaxed text-neutral-400">
              {active.description}
            </p>
          </div>
        )}

        {snapshot.tasks.length > 1 && (
          <ul className="mt-6 space-y-1.5 border-t border-neutral-800 pt-4">
            {snapshot.tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 text-xs text-neutral-400"
              >
                <span
                  className={`w-3 text-center ${statusColor(t.status)}`}
                  aria-hidden
                >
                  {statusGlyph(t.status)}
                </span>
                <span
                  className={
                    t.status === "done" ? "text-neutral-500 line-through" : ""
                  }
                >
                  {t.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
