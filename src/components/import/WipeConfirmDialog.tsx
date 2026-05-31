import { useState } from "react";
import { useStore } from "../../state/store";
import { resolveWipeConfirm } from "../../ipc/importer";
import { formatBytes } from "../../utils/format";

export function WipeConfirmDialog() {
  const importStatus = useStore((s) => s.importStatus);
  const req = useStore((s) => s.importWipeConfirm);
  const setImportStatus = useStore((s) => s.setImportStatus);
  const setImportWipeConfirm = useStore((s) => s.setImportWipeConfirm);

  const [busy, setBusy] = useState(false);

  if (importStatus !== "paused_wipe_confirm" || !req) return null;

  async function respond(wipe: boolean) {
    setBusy(true);
    // Re-arm the import event listeners (they re-subscribe while the
    // status is "running") before the backend resumes, then clear.
    setImportStatus("running");
    setImportWipeConfirm(null);
    try {
      await resolveWipeConfirm(wipe);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-6">
        <h2 className="mb-2 text-lg font-semibold text-neutral-100">
          Copy complete
        </h2>
        <p className="mb-4 text-sm text-neutral-300">
          Copied and verified{" "}
          <span className="font-semibold text-neutral-100">
            {req!.filesStaged} {req!.filesStaged === 1 ? "file" : "files"}
          </span>{" "}
          ({formatBytes(req!.bytesStaged)}) from{" "}
          <span className="font-medium">{req!.sourceLabel.toUpperCase()}</span>{" "}
          into your library.
        </p>
        <p className="mb-4 text-xs text-neutral-400">
          Do you want to erase the SD card now so it&rsquo;s ready to go back
          in your dashcam? If you keep it, nothing on the card is changed — the
          copies are already safe in your library.
        </p>

        <div className="flex justify-end gap-2">
          <button
            disabled={busy}
            onClick={() => respond(false)}
            className="rounded-md bg-neutral-700 px-4 py-2 text-sm font-medium text-neutral-100 hover:bg-neutral-600 disabled:opacity-50"
            title="Leave the SD card untouched."
          >
            Keep files on card
          </button>
          <button
            disabled={busy}
            onClick={() => respond(true)}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
            title="Erase the SD card now."
          >
            Erase SD card
          </button>
        </div>
      </div>
    </div>
  );
}
