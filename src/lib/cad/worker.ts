/// <reference lib="webworker" />
import { setOC } from "replicad";
import opencascade from "replicad-opencascadejs";
import opencascadeWasmUrl from "replicad-opencascadejs/wasm?url";

import { findModel } from "./models";
import { buildStlExport } from "./stl";
import type { AnyParametricModel, ModelPart } from "./types";
import type { PreviewPart, WorkerRequest, WorkerResponse } from "./preview";

const PREVIEW_TOLERANCE = 0.08;
const PREVIEW_ANGULAR_TOLERANCE = 0.35;

let initPromise: Promise<void> | null = null;
let lastResult: { model: AnyParametricModel; parts: ModelPart[] } | null = null;

function initOpenCascade(): Promise<void> {
  if (!initPromise) {
    initPromise = opencascade({
      locateFile: (path: string) => (path.endsWith(".wasm") ? opencascadeWasmUrl : path),
    })
      .then((OC) => {
        setOC(OC as never);
      })
      .catch((error: unknown) => {
        // Allow a later request to retry initialization.
        initPromise = null;
        throw error;
      });
  }
  return initPromise;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown geometry error.";
}

function tessellate(part: ModelPart): PreviewPart {
  const mesh = part.shape.mesh({
    tolerance: PREVIEW_TOLERANCE,
    angularTolerance: PREVIEW_ANGULAR_TOLERANCE,
  });

  const positions = new Float32Array(mesh.vertices);
  const indices = new Uint32Array(mesh.triangles);
  const normals =
    mesh.normals.length === positions.length ? new Float32Array(mesh.normals) : null;

  return {
    id: part.id,
    color: part.color,
    positions,
    normals,
    indices,
  };
}

function respond(message: WorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as {
    postMessage(message: WorkerResponse, transfer: Transferable[]): void;
  }).postMessage(message, transfer);
}

async function handleGenerate(request: Extract<WorkerRequest, { kind: "generate" }>) {
  const startedAt = performance.now();
  try {
    await initOpenCascade();

    const model = findModel(request.modelId);
    if (!model) {
      throw new Error(`Unknown model "${request.modelId}".`);
    }

    const parts = model.generate(request.config);

    if (!parts.length) {
      throw new Error("The model generated no parts.");
    }

    const previewParts = parts.map(tessellate);
    lastResult = { model, parts };

    const transfer: Transferable[] = [];
    for (const part of previewParts) {
      transfer.push(part.positions.buffer, part.indices.buffer);
      if (part.normals) transfer.push(part.normals.buffer);
    }

    respond(
      {
        kind: "preview",
        requestId: request.requestId,
        configKey: request.configKey,
        parts: previewParts,
        elapsedMs: performance.now() - startedAt,
      },
      transfer,
    );
  } catch (error) {
    respond({
      kind: "generation-error",
      requestId: request.requestId,
      configKey: request.configKey,
      message: errorMessage(error),
    });
  }
}

async function handleExport(request: Extract<WorkerRequest, { kind: "export" }>) {
  try {
    await initOpenCascade();

    if (!lastResult) {
      throw new Error("No generated model is available for export.");
    }

    const files = await buildStlExport(lastResult.model.name, lastResult.parts);
    const transfer = files.map((file) => file.data);

    respond({ kind: "export-result", requestId: request.requestId, files }, transfer);
  } catch (error) {
    respond({
      kind: "export-error",
      requestId: request.requestId,
      message: errorMessage(error),
    });
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.kind === "generate") {
    void handleGenerate(request);
  } else if (request.kind === "export") {
    void handleExport(request);
  }
});
