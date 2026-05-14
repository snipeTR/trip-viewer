import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type StartupTaskStatus = "pending" | "running" | "done" | "failed";

export interface StartupTask {
  id: string;
  label: string;
  description: string;
  current: number;
  /** `null` for indeterminate work (frontend shows a spinner). */
  total: number | null;
  status: StartupTaskStatus;
}

export interface StartupSnapshot {
  tasks: StartupTask[];
  done: boolean;
}

export function getStartupStatus(): Promise<StartupSnapshot> {
  return invoke<StartupSnapshot>("get_startup_status");
}

export function onStartupProgress(
  cb: (s: StartupSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<StartupSnapshot>("startup:task-progress", (e) => cb(e.payload));
}

export function onStartupDone(
  cb: (s: StartupSnapshot) => void,
): Promise<UnlistenFn> {
  return listen<StartupSnapshot>("startup:done", (e) => cb(e.payload));
}
