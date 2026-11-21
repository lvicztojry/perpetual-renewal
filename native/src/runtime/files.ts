import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

export async function saveLocalFile(blob: Blob, suggestedName: string) {
  const name = suggestedName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 160) || "renewal-export.json";
  const path = await save({ defaultPath: name });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}
export function installNativeDownloads() {
  if (!isTauri()) return;
  const blobs = new Map<string, Blob>();
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = value => { const url = create(value); if (value instanceof Blob) blobs.set(url, value); return url; };
  URL.revokeObjectURL = url => { blobs.delete(url); revoke(url); };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const blob = this.download ? blobs.get(this.href) : null;
    if (!blob) { click.call(this); return; }
    void saveLocalFile(blob, this.download).catch(() => window.dispatchEvent(new Event("native-file-save-error")));
  };
}
