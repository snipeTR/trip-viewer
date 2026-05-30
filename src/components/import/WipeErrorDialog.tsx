import { useState } from "react";
import { useStore } from "../../state/store";
import { resolveWipeError } from "../../ipc/importer";
import type { WipeErrorAction } from "../../types/import";

export function WipeErrorDialog() {
  const importStatus = useStore((s) => s.importStatus);
  const wipeError = useStore((s) => s.importWipeError);
  const setImportStatus = useStore((s) => s.setImportStatus);
  const setImportWipeError = useStore((s) => s.setImportWipeError);

  const [busy, setBusy] = useState(false);

  if (importStatus !== "paused_wipe_error" || !wipeError) return null;

  async function respond(action: WipeErrorAction) {
    setBusy(true);
    // Re-arm listeners (the effect re-subscribes when status === "running")
    // before the backend resumes emitting, then clear the error.
    setImportStatus("running");
    setImportWipeError(null);
    try {
      await resolveWipeError(action);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-6">
        <h2 className="mb-2 text-lg font-semibold text-neutral-100">
          Couldn't delete a file while wiping
        </h2>
        <p className="mb-3 text-xs text-neutral-400">
          Your footage was already copied and verified — it's safe. This file
          on the card couldn't be deleted during the wipe. Choose how to
          proceed.
        </p>

        <div className="mb-4 rounded-md bg-neutral-800 px-3 py-2">
          <div
            className="truncate text-sm text-neutral-200"
            title={wipeError!.path}
          >
            {wipeError!.path}
          </div>
          <div className="mt-1 text-xs text-red-400" title={wipeError!.error}>
            {wipeError!.error}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            disabled={busy}
            onClick={() => respond("cancel")}
            className="rounded-md px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
            title="Stop wiping. The rest of the card is left intact; copied footage is kept."
          >
            Cancel wipe
          </button>
          <button
            disabled={busy}
            onClick={() => respond("skip")}
            className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-100 hover:bg-neutral-600 disabled:opacity-50"
            title="Leave this file on the card and continue wiping the rest."
          >
            Skip
          </button>
          <button
            disabled={busy}
            onClick={() => respond("retry")}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            title="Try deleting this file again."
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
