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
    node.kind === "group" ? [node, ...flatten(node.children)] : node,
  );
}

describe("generic configuration UI", () => {
  it("generates inputs for every field in the default configuration", () => {
    const state = createFormState(watermelonModel.definition);
    const nodes = flatten(buildFormNodes(watermelonModel.definition, state));
    const paths = nodes.map((node) => node.path);

    expect(paths).toContain("watermelon.width");
    expect(paths).toContain("watermelon.thickness");
    expect(paths).toContain("watermelon.appearance.outerRindWidth");
    expect(paths).toContain("watermelon.appearance.innerRindWidth");
    expect(paths).toContain("pin.length");
    expect(paths).toContain("pin.width");
    expect(paths).toContain("pin.thickness");
    expect(paths).toContain("pin.clearance");
    expect(paths).toContain("pin.retainingClip");
    expect(paths).toContain("printer.nozzleDiameter");
    expect(paths).toContain("printer.layerHeight");
    expect(paths).toContain("printer.bottomSlopes");

    expect(paths).not.toContain("watermelon.radius");
    expect(paths).not.toContain("watermelon.seedAngle");
    expect(paths).not.toContain("pinRecp.base.width");

    const clip = nodes.find((node) => node.path === "pin.retainingClip");
    expect(clip?.kind).toBe("boolean");
    if (clip?.kind === "boolean") expect(clip.value).toBe(true);

    const slopes = nodes.find((node) => node.path === "printer.bottomSlopes");
    expect(slopes?.kind).toBe("boolean");
    if (slopes?.kind === "boolean") expect(slopes.value).toBe(true);
  });

  it("preserves the simplified default values", () => {
    const state = createFormState(watermelonModel.definition);
    const config = buildEffectiveConfig(watermelonModel.definition, state);

    expect(config.watermelon).toEqual({
      width: 70,
      thickness: 3,
      appearance: {
        outerRindWidth: 3,
        innerRindWidth: 2,
      },
    });
    expect(config.pin).toEqual({
      length: 22,
      width: 5.5,
      thickness: 0.6,
      clearance: 0,
      retainingClip: true,
    });
    expect(config.printer).toEqual({
      nozzleDiameter: 0.4,
      layerHeight: 0.2,
      bottomSlopes: true,
    });
  });

  it("supports optional objects and calculated optionals for future models", () => {
    type OptionalModel = {
      group: { value: number };
      auto?: number;
      clip?: { depth: number };
    };
    const definition: ConfigDefinition<OptionalModel & ConfigObject> = {
      defaults: {
        group: { value: 2 },
      },
      metadata: {
        group: { label: "Group", fields: { value: {} } },
        auto: {
          optional: true,
          computeDefault: (parent) =>
            Number((parent.group as ConfigObject).value) * 2,
        },
        clip: {
          optional: true,
          fields: { depth: { unit: "mm", defaultValue: 0 } },
        },
      },
    };

    const state = createFormState(definition);
    const config = buildEffectiveConfig(definition, state);
    expect(config).not.toHaveProperty("auto");
    expect(config).not.toHaveProperty("clip");

    state.disabled["auto"] = false;
    state.values.auto = 4;
    state.disabled["clip"] = false;
    state.disabled["clip.depth"] = false;
    const restored = buildEffectiveConfig(definition, state);
    expect(restored.auto).toBe(4);
    expect(restored.clip).toEqual({ depth: 0 });
  });

  it("validates finite numbers and keeps invalid values visible to the UI", () => {
    const state = createFormState(watermelonModel.definition);
    (state.values.watermelon as ConfigObject).width = "not-a-number";

    const config = buildEffectiveConfig(watermelonModel.definition, state);
    const issues = validateConfigValues(watermelonModel.definition, config);

    expect(issues).toContainEqual({
      path: "watermelon.width",
      message: "Width must be a finite number.",
    });
  });

  it("describes all numeric fields", () => {
    const fields = describeNumericFields(watermelonModel.definition);
    const paths = fields.map((field) => field.path);

    expect(paths).toContain("watermelon.width");
    expect(paths).toContain("watermelon.appearance.outerRindWidth");
    expect(paths).toContain("pin.width");
    expect(paths).toContain("printer.nozzleDiameter");
    expect(paths).toContain("printer.layerHeight");
    expect(paths).not.toContain("pin.retainingClip");
    expect(paths).not.toContain("printer.bottomSlopes");
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
