import { describe, expect, it } from "vitest";
import {
  buildEffectiveConfig,
  buildFormNodes,
  createFormState,
  describeNumericFields,
  validateConfigValues,
} from "./config-form";
import type { ConfigDefinition, ConfigObject, FormNode } from "./types";
import { watermelonModel } from "./model/watermelon";

function flatten(nodes: FormNode[]): FormNode[] {
  return nodes.flatMap((node) =>
    node.kind === "group" ? [node, ...flatten(node.children)] : [node],
  );
}

describe("generic configuration UI", () => {
  it("generates inputs for every field in the default configuration", () => {
    const state = createFormState(watermelonModel.definition);
    const nodes = flatten(buildFormNodes(watermelonModel.definition, state));
    const paths = nodes.map((node) => node.path);

    expect(paths).toContain("pinRecp.base.length");
    expect(paths).toContain("pinRecp.tabs.geometry.topSlopeHeight");
    expect(paths).toContain("watermelon.radius");
    expect(paths).toContain("watermelon.seedAngle");
    expect(paths).toContain("watermelon.seedDepth");

    const seedDepth = nodes.find((node) => node.path === "watermelon.seedDepth");
    expect(seedDepth?.kind).toBe("number");
    if (seedDepth?.kind === "number") {
      expect(seedDepth.autoValue).toBeCloseTo(1.05);
      expect(seedDepth.overridden).toBe(false);
    }

    const clip = nodes.find(
      (node) => node.path === "pinRecp.retainerClip",
    );
    expect(clip?.kind).toBe("group");
    if (clip?.kind === "group") {
      expect(clip.optional).toBe(true);
      expect(clip.enabled).toBe(true);
    }
  });

  it("preserves the original default values and effective optional behavior", () => {
    const state = createFormState(watermelonModel.definition);
    const config = buildEffectiveConfig(watermelonModel.definition, state);

    expect(config.watermelon).toEqual({
      thickness: 3,
      radius: 35,
      rindWidth: 3,
      innerRindWidth: 2,
      pinRecpOffset: 1,
      seedAngle: 30,
    });
    expect((config.watermelon as ConfigObject).seedDepth).toBeUndefined();
    expect(config.pinRecp).toHaveProperty("retainerClip");
  });

  it("removes disabled optional objects and keeps their values", () => {
    const state = createFormState(watermelonModel.definition);
    state.disabled["pinRecp.retainerClip"] = true;

    const config = buildEffectiveConfig(watermelonModel.definition, state);
    expect(config.pinRecp).not.toHaveProperty("retainerClip");

    state.disabled["pinRecp.retainerClip"] = false;
    const restored = buildEffectiveConfig(watermelonModel.definition, state);
    expect(restored.pinRecp).toHaveProperty("retainerClip.wallDistance", 0.4);
  });

  it("converts automatic optional values into explicit overrides", () => {
    const state = createFormState(watermelonModel.definition);
    (state.values.watermelon as ConfigObject).thickness = 4;

    const nodes = flatten(buildFormNodes(watermelonModel.definition, state));
    const seedDepth = nodes.find((node) => node.path === "watermelon.seedDepth");
    if (seedDepth?.kind !== "number") throw new Error("seedDepth node missing");
    expect(seedDepth.autoValue).toBeCloseTo(1.4);

    state.values["watermelon"] = {
      ...(state.values.watermelon as ConfigObject),
      seedDepth: 1.4,
    };
    state.disabled["watermelon.seedDepth"] = false;

    const config = buildEffectiveConfig(watermelonModel.definition, state);
    expect((config.watermelon as ConfigObject).seedDepth).toBe(1.4);
  });

  it("validates finite numbers and keeps invalid values visible to the UI", () => {
    const state = createFormState(watermelonModel.definition);
    (state.values.watermelon as ConfigObject).radius = "not-a-number";

    const config = buildEffectiveConfig(watermelonModel.definition, state);
    const issues = validateConfigValues(watermelonModel.definition, config);

    expect(issues).toContainEqual({
      path: "watermelon.radius",
      message: "Radius must be a finite number.",
    });
  });

  it("describes all numeric fields including metadata-only fields", () => {
    const fields = describeNumericFields(watermelonModel.definition);
    const paths = fields.map((field) => field.path);

    expect(paths).toContain("watermelon.seedDepth");
    expect(paths).toContain("pinRecp.retainerClip.wallDistance");
  });

  it("adapts to a new nested numeric field without UI changes", () => {
    type Extended = { group: { existing: number; added: number } };
    const definition: ConfigDefinition<Extended & ConfigObject> = {
      defaults: { group: { existing: 1, added: 2.5 } },
      metadata: {
        group: {
          label: "Group",
          fields: {
            existing: { unit: "mm" },
            added: { label: "Added field", unit: "mm" },
          },
        },
      },
    };

    const state = createFormState(definition);
    const nodes = flatten(buildFormNodes(definition, state));
    const added = nodes.find((node) => node.path === "group.added");

    expect(added?.kind).toBe("number");
    if (added?.kind === "number") {
      expect(added.value).toBe(2.5);
      expect(added.label).toBe("Added field");
    }

    (state.values.group as ConfigObject).added = 7.25;
    const config = buildEffectiveConfig(definition, state);
    expect((config.group as ConfigObject).added).toBe(7.25);
  });
});
