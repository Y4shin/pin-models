import type { StlFile } from "./stl";
import type { ConfigObject } from "./types";
import type { PreviewPart, WorkerRequest, WorkerResponse } from "./preview";

export interface CadWorkerHandlers {
  onPreview(parts: PreviewPart[], configKey: string, elapsedMs: number): void;
  onGenerationError(message: string, configKey: string): void;
  onWorkerError(message: string): void;
}

interface PendingExport {
  resolve(files: StlFile[]): void;
  reject(error: Error): void;
}

/**
 * Owns the single CAD worker and the request bookkeeping. Generation responses
 * for superseded requests are ignored.
 */
export class CadWorkerClient {
  private readonly worker: Worker;
  private readonly handlers: CadWorkerHandlers;
  private readonly pendingExports = new Map<number, PendingExport>();
  private nextRequestId = 1;
  private latestGenerationId = 0;
  private terminated = false;

  constructor(handlers: CadWorkerHandlers) {
    this.handlers = handlers;
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      this.handleMessage(event.data);
    });

    this.worker.addEventListener("error", (event) => {
      if (this.terminated) return;
      this.handlers.onWorkerError(
        event.message || "The geometry worker failed to start or crashed.",
      );
    });

    this.worker.addEventListener("messageerror", () => {
      if (this.terminated) return;
      this.handlers.onWorkerError("The geometry worker sent an unreadable message.");
    });
  }

  private handleMessage(message: WorkerResponse) {
    switch (message.kind) {
      case "preview":
        if (message.requestId !== this.latestGenerationId) return;
        this.handlers.onPreview(message.parts, message.configKey, message.elapsedMs);
        return;
      case "generation-error":
        if (message.requestId !== this.latestGenerationId) return;
        this.handlers.onGenerationError(message.message, message.configKey);
        return;
      case "export-result": {
        const pending = this.pendingExports.get(message.requestId);
        if (!pending) return;
        this.pendingExports.delete(message.requestId);
        pending.resolve(message.files);
        return;
      }
      case "export-error": {
        const pending = this.pendingExports.get(message.requestId);
        if (!pending) return;
        this.pendingExports.delete(message.requestId);
        pending.reject(new Error(message.message));
        return;
      }
    }
  }

  /** Sends a generation request. Only the newest request's response is reported. */
  requestGeneration(modelId: string, config: ConfigObject, configKey: string): void {
    if (this.terminated) return;
    const requestId = this.nextRequestId++;
    this.latestGenerationId = requestId;
    const request: WorkerRequest = {
      kind: "generate",
      requestId,
      modelId,
      configKey,
      config,
    };
    this.worker.postMessage(request);
  }

  requestStlExport(): Promise<StlFile[]> {
    if (this.terminated) {
      return Promise.reject(new Error("The geometry worker is not available."));
    }
    const requestId = this.nextRequestId++;
    return new Promise<StlFile[]>((resolve, reject) => {
      this.pendingExports.set(requestId, { resolve, reject });
      const request: WorkerRequest = { kind: "export", requestId };
      this.worker.postMessage(request);
    });
  }

  terminate(): void {
    if (this.terminated) return;
    this.terminated = true;
    for (const pending of this.pendingExports.values()) {
      pending.reject(new Error("The geometry worker is not available."));
    }
    this.pendingExports.clear();
    this.worker.terminate();
  }
}
