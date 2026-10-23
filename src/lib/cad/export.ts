import JSZip from "jszip";
import type { StlFile } from "./stl";
import { slugify } from "./stl";

export async function createStlZip(files: StlFile[]): Promise<Blob> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.filename, file.data);
  }
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadStlZip(modelName: string, files: StlFile[]): Promise<void> {
  const zip = await createStlZip(files);
  downloadBlob(zip, `${slugify(modelName)}-stls.zip`);
}
