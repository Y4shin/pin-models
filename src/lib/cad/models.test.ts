import { describe, expect, it } from "vitest";
import { watermelonModel } from "./model/watermelon";
import { defaultModel, findModel, models } from "./models";

describe("model registry", () => {
  it("registers the watermelon model as the default", () => {
    expect(models).toContain(watermelonModel);
    expect(defaultModel).toBe(watermelonModel);
    expect(defaultModel.id).toBe("watermelon");
    expect(findModel("watermelon")).toBe(watermelonModel);
  });

  it("uses unique model identifiers and names", () => {
    const ids = models.map((model) => model.id);
    const names = models.map((model) => model.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns undefined for unknown model identifiers", () => {
    expect(findModel("missing-model")).toBeUndefined();
  });
});
