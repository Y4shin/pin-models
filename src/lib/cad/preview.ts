import type { ConfigObject } from "./types";
import type { StlFile } from "./stl";

export interface PreviewPart {
  id: string;
  color: string;
  positions: Float32Array;
  /** Per-vertex normals; null when the tessellation did not provide them. */
  normals: Float32Array | null;
  indices: Uint32Array;
}

export interface GenerateRequest {
  kind: "generate";
  requestId: number;
  configKey: string;
  config: ConfigObject;
}

export interface ExportRequest {
  kind: "export";
  requestId: number;
}

export type WorkerRequest = GenerateRequest | ExportRequest;

export interface PreviewResponse {
  kind: "preview";
  requestId: number;
  configKey: string;
  parts: PreviewPart[];
  elapsedMs: number;
}

export interface GenerationErrorResponse {
  kind: "generation-error";
  requestId: number;
  configKey: string;
  message: string;
}

export interface ExportResponse {
  kind: "export-result";
  requestId: number;
  files: StlFile[];
}

export interface ExportErrorResponse {
  kind: "export-error";
  requestId: number;
  message: string;
}

export type WorkerResponse =
  | PreviewResponse
  | GenerationErrorResponse
  | ExportResponse
  | ExportErrorResponse;
