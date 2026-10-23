import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import {
  makeBox,
  measureShapeVolumeProperties,
  setOC,
  type Shape3D,
} from "replicad";

import {
  buildEffectiveConfig,
  createFormState,
} from "../config-form";
import { buildStlExport, groupPartsByColor } from "../stl";
import type { ModelPart } from "../types";
import {
  deriveGeometry,
  generateWatermelon,
  pinRecpHeight,
  pinRecpNegative,
  validateWatermelonModel,
  watermelonModel,
  type WatermelonModelConfig,
} from "./watermelon";

function defaultConfig(): WatermelonModelConfig {
  const state = createFormState(watermelonModel.definition);
  return buildEffectiveConfig(
    watermelonModel.definition,
    state,
  ) as unknown as WatermelonModelConfig;
}

function generate(config: WatermelonModelConfig): ModelPart[] {
  return watermelonModel.generate(config);
}

function volume(shape: Shape3D): number {
  return measureShapeVolumeProperties(shape).volume;
}

function totalVolume(parts: ModelPart[]): number {
  return parts.reduce((sum, part) => sum + volume(part.shape), 0);
}

function partBoundingBox(parts: ModelPart[]) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const [low, high] = part.shape.boundingBox.bounds;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], low[axis]);
      max[axis] = Math.max(max[axis], high[axis]);
    }
  }
  return { min, max };
}

function stlTriangleCount(buffer: ArrayBuffer): number {
  return new DataView(buffer).getUint32(80, true);
}

function stlBoundingBox(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const count = stlTriangleCount(buffer);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let triangle = 0; triangle < count; triangle += 1) {
    const base = 84 + triangle * 50;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = base + 12 + vertex * 12;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = view.getFloat32(offset + axis * 4, true);
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  }

  return { min, max };
}

describe("watermelon Replicad model", () => {
  let baseConfig: WatermelonModelConfig;
  let baseParts: ModelPart[];

  beforeAll(async () => {
    const OC = await opencascade();
    setOC(OC as never);
    baseConfig = defaultConfig();
    baseParts = generate(baseConfig);
  });

  it("generates the expected parts from the simplified default configuration", () => {
    expect(baseParts.map((part) => part.id)).toEqual([
      "flesh",
      "rind-outer",
      "rind-inner",
      "seed-1",
      "seed-2",
      "seed-3",
      "seed-4",
      "seed-5",
    ]);

    const groups = groupPartsByColor(baseParts);
    expect(groups.map((group) => group.color)).toEqual([
      "red",
      "green",
      "white",
      "black",
    ]);
    expect(groups.find((group) => group.color === "black")?.parts).toHaveLength(5);

    for (const part of baseParts) {
      expect(volume(part.shape)).toBeGreaterThan(0);
    }

    const flesh = baseParts.find((part) => part.id === "flesh")!;
    const rind = baseParts.find((part) => part.id === "rind-outer")!;
    expect(flesh.shape.boundingBox.width).toBeCloseTo(31, 1);
    expect(rind.shape.boundingBox.width).toBeCloseTo(35, 1);
    expect(validateWatermelonModel(baseConfig)).toEqual([]);
  });

  it("derives the original receptacle dimensions from the printer defaults", () => {
    const derived = deriveGeometry(baseConfig);

    expect(derived.pinRecp.base).toEqual({
      length: 22,
      width: 5.5,
      depth: 0.6,
    });
    expect(derived.pinRecp.tabs.geometry.width).toBeCloseTo(0.8);
    expect(derived.pinRecp.tabs.geometry.tabHeight).toBeCloseTo(0.8);
    expect(derived.pinRecp.tabs.geometry.bottomSlopeHeight).toBeCloseTo(0.4);
    expect(derived.pinRecp.retainerClip?.depth).toBeCloseTo(0.6);
    expect(derived.pinRecp.retainerClip?.protrusion).toBeCloseTo(0.4);
    expect(derived.pinRecp.retainerClip?.clipThickness).toBeCloseTo(0.8);
    expect(derived.pinRecp.retainerClip?.cavityLength).toBeCloseTo(1.6);
    expect(derived.pinRecp.retainerClip?.wallDistance).toBeCloseTo(0.4);
    expect(derived.cutoutLength).toBeCloseTo(4.9, 6);
    expect(derived.pinRecpOffset).toBe(1);
    expect(pinRecpHeight(derived.pinRecp)).toBeCloseTo(2.4);
  });

  it("places all five seeds flush with the top of the flesh", () => {
    const seeds = baseParts.filter((part) => part.color === "black");
    expect(seeds).toHaveLength(5);

    for (const seed of seeds) {
      const [, max] = seed.shape.boundingBox.bounds;
      expect(max[2]).toBeCloseTo(baseConfig.watermelon.thickness, 2);
      expect(max[2] - seed.shape.boundingBox.bounds[0][2]).toBeGreaterThan(0.5);
    }

    const union = partBoundingBox(seeds);
    expect(union.min[0]).toBeLessThan(-5);
    expect(union.max[0]).toBeGreaterThan(5);
  });

  it("changes the geometry when the watermelon width changes", () => {
    const larger = generate({
      ...baseConfig,
      watermelon: { ...baseConfig.watermelon, width: 80 },
    });
    const flesh = larger.find((part) => part.id === "flesh")!;

    expect(flesh.shape.boundingBox.width).toBeCloseTo(76, 1);
    expect(totalVolume(larger)).toBeGreaterThan(totalVolume(baseParts));
  });

  it("changes the geometry when pin dimensions change", () => {
    const wider = generate({
      ...baseConfig,
      pin: { ...baseConfig.pin, width: 9 },
    });

    expect(totalVolume(wider)).toBeLessThan(totalVolume(baseParts));
  });

  it("uses a flat vertical tab face while keeping the lower slope", () => {
    const derived = deriveGeometry(baseConfig);
    const negative = pinRecpNegative(derived.pinRecp, 0);
    const widthAt = (z: number) => {
      const slice = negative.intersect(
        makeBox([-100, -0.05, z - 0.005], [100, 0.05, z + 0.005]),
      );
      return slice.boundingBox.width;
    };

    // The flat vertical tab face reaches all the way to the opening plane.
    expect(widthAt(0.01)).toBeCloseTo(5.5 - 2 * 0.8, 1);
    // The lower slope remains: the tab gets narrower toward its top.
    expect(widthAt(1.1)).toBeGreaterThan(widthAt(0.01));
    expect(widthAt(1.1)).toBeLessThan(5.5);
  });

  it("extends the side-insertion slot to the full cavity height", () => {
    const derived = deriveGeometry(baseConfig);
    const negative = pinRecpNegative(derived.pinRecp, derived.extraSpace)
      .rotate(90)
      .translateY(derived.pinRecpOffset + derived.pinRecp.base.width / 2);

    const volumeAt = (z: number) => {
      const slice = negative.intersect(
        makeBox([-25, 3.7, z - 0.01], [-15, 3.8, z + 0.01]),
      );
      return volume(slice);
    };

    expect(volumeAt(0.03)).toBeGreaterThan(0);
    expect(volumeAt(1.0)).toBeGreaterThan(0);
    expect(volumeAt(1.7)).toBeGreaterThan(0);
    expect(volumeAt(1.85)).toBeCloseTo(0, 3);
  });

  it("disables the bottom lead-in slope when requested", () => {
    const withoutSlopes: WatermelonModelConfig = {
      ...baseConfig,
      printer: { ...baseConfig.printer, bottomSlopes: false },
    };
    const derived = deriveGeometry(withoutSlopes);

    expect(derived.bottomSlopeHeight).toBe(0);
    expect(derived.openingHeight).toBeCloseTo(1.4);
    expect(derived.receptacleHeight).toBeCloseTo(2.0);
    expect(validateWatermelonModel(withoutSlopes)).toEqual([]);

    const parts = generate(withoutSlopes);
    expect(totalVolume(parts)).toBeGreaterThan(totalVolume(baseParts));
  });

  it("derives tab, slope, and clip dimensions from nozzle and layer height", () => {
    const largerNozzle: WatermelonModelConfig = {
      ...baseConfig,
      printer: { ...baseConfig.printer, nozzleDiameter: 0.6 },
    };
    const derived = deriveGeometry(largerNozzle);

    expect(derived.tabWidth).toBeCloseTo(1.2);
    expect(derived.tabHeight).toBeCloseTo(1.2);
    expect(derived.bottomSlopeHeight).toBeCloseTo(0.4);
    expect(derived.clipWallDistance).toBeCloseTo(0.6);
    expect(derived.pinRecp.retainerClip?.clipThickness).toBeCloseTo(1.2);
    expect(derived.pinRecp.retainerClip?.cavityLength).toBeCloseTo(1.6);

    // The default 3 mm thickness is no longer enough for a 0.6 mm nozzle.
    const issues = validateWatermelonModel(largerNozzle);
    expect(issues.some((issue) => issue.path === "watermelon.thickness")).toBe(true);
  });

  it("requires a side gap and printable width for the retaining clip", () => {
    const narrow: WatermelonModelConfig = {
      ...baseConfig,
      pin: { ...baseConfig.pin, width: 1.0 },
    };
    const issues = validateWatermelonModel(narrow);

    expect(issues.some((issue) => /retaining clip/i.test(issue.message))).toBe(true);
  });

  it("rejects layer heights larger than the nozzle diameter", () => {
    const issues = validateWatermelonModel({
      ...baseConfig,
      printer: { ...baseConfig.printer, layerHeight: 0.5 },
    });

    expect(issues).toContainEqual({
      path: "printer.layerHeight",
      message: "Layer height must not exceed the nozzle diameter.",
    });
  });

  it("rejects seeds that are too small for the nozzle", () => {
    const small: WatermelonModelConfig = {
      ...baseConfig,
      watermelon: { ...baseConfig.watermelon, width: 12 },
    };
    const issues = validateWatermelonModel(small);

    expect(issues.some((issue) => /Seed tips/i.test(issue.message))).toBe(true);
  });

  it("rejects a pin that is too thick for the top wall", () => {
    const thickPin: WatermelonModelConfig = {
      ...baseConfig,
      pin: { ...baseConfig.pin, thickness: 2.0 },
    };
    const issues = validateWatermelonModel(thickPin);

    expect(issues.some((issue) => /Thickness must be at least/i.test(issue.message))).toBe(
      true,
    );
  });

  it("requires one printed layer of red between a seed and the pin cavity", () => {
    const small: WatermelonModelConfig = {
      ...baseConfig,
      watermelon: {
        ...baseConfig.watermelon,
        width: 45,
        thickness: 3,
      },
    };
    const issues = validateWatermelonModel(small);

    expect(
      issues.some(
        (issue) =>
          /too close to the pin cavity/i.test(issue.message) &&
          /at least 4 mm/i.test(issue.message),
      ),
    ).toBe(true);

    expect(validateWatermelonModel(baseConfig)).toEqual([]);
  });

  it("accepts a larger nozzle when the part and pin are made thicker", () => {
    const largerNozzle: WatermelonModelConfig = {
      ...baseConfig,
      watermelon: { ...baseConfig.watermelon, thickness: 5.3 },
      pin: { ...baseConfig.pin, thickness: 0.8 },
      printer: { ...baseConfig.printer, nozzleDiameter: 0.6 },
    };

    expect(validateWatermelonModel(largerNozzle)).toEqual([]);
    expect(generate(largerNozzle)).toHaveLength(8);
  });

  it("rejects a retaining slot that reaches the rind", () => {
    const small: WatermelonModelConfig = {
      ...baseConfig,
      watermelon: { ...baseConfig.watermelon, width: 30 },
    };
    const issues = validateWatermelonModel(small);

    expect(issues.some((issue) => /retaining slot reaches/i.test(issue.message))).toBe(
      true,
    );
  });

  it("supports disabling the optional retaining clip", () => {
    const withoutClip: WatermelonModelConfig = {
      ...baseConfig,
      pin: { ...baseConfig.pin, retainingClip: false },
    };
    const derived = deriveGeometry(withoutClip);

    expect(derived.pinRecp.retainerClip).toBeUndefined();
    expect(pinRecpHeight(derived.pinRecp)).toBeCloseTo(1.8);

    const parts = generate(withoutClip);
    expect(parts).toHaveLength(8);
    expect(totalVolume(parts)).toBeGreaterThan(totalVolume(baseParts));
  });

  it("exports one binary STL per color with combined black seeds in one coordinate system", async () => {
    const files = await buildStlExport("Watermelon", baseParts);
    expect(files.map((file) => file.filename)).toEqual([
      "watermelon-red.stl",
      "watermelon-green.stl",
      "watermelon-white.stl",
      "watermelon-black.stl",
    ]);

    const byName = new Map(files.map((file) => [file.filename, file.data]));
    const seedBuffers = await Promise.all(
      baseParts
        .filter((part) => part.color === "black")
        .map(async (part) =>
          part.shape
            .blobSTL({ binary: true, tolerance: 0.02, angularTolerance: 0.15 })
            .arrayBuffer(),
        ),
    );

    const expectedSeedTriangles = seedBuffers.reduce(
      (sum, buffer) => sum + stlTriangleCount(buffer),
      0,
    );
    const black = byName.get("watermelon-black.stl")!;
    expect(stlTriangleCount(black)).toBe(expectedSeedTriangles);

    // Every exported part uses the same world coordinates as its CAD source.
    for (const [color, parts] of groupPartsByColor(baseParts).map(
      (group) => [group.color, group.parts] as const,
    )) {
      const data = byName.get(`watermelon-${color}.stl`);
      expect(data).toBeDefined();
      const stlBox = stlBoundingBox(data!);
      const cadBox = partBoundingBox(parts);
      for (let axis = 0; axis < 3; axis += 1) {
        expect(stlBox.min[axis]).toBeCloseTo(cadBox.min[axis], 1);
        expect(stlBox.max[axis]).toBeCloseTo(cadBox.max[axis], 1);
      }
    }

    const red = stlBoundingBox(byName.get("watermelon-red.stl")!);
    const green = stlBoundingBox(byName.get("watermelon-green.stl")!);
    expect(green.min[0]).toBeLessThan(red.min[0]);
    expect(green.max[0]).toBeGreaterThan(red.max[0]);
  });

  it("reports invalid geometry configurations instead of throwing", () => {
    const invalid: WatermelonModelConfig = {
      ...baseConfig,
      watermelon: { ...baseConfig.watermelon, width: 3 },
    };

    const issues = validateWatermelonModel(invalid);
    expect(
      issues.some((issue) => /rind widths leave no red flesh/i.test(issue.message)),
    ).toBe(true);

    expect(() => generate(invalid)).toThrow();
    expect(() => generateWatermelon(invalid)).toThrow();
  });
});
