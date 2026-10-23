/**
 * Model registry.
 *
 * Add a model here to make it selectable in the configurator. Everything else
 * (form generation, preview, export) is driven by the ParametricModel contract.
 */
import { watermelonModel } from "./model/watermelon";
import type { AnyParametricModel } from "./types";

export const models: readonly AnyParametricModel[] = [watermelonModel];

export const defaultModel = watermelonModel;

export function findModel(id: string): AnyParametricModel | undefined {
  return models.find((model) => model.id === id);
}
