import { beforeAll, describe, expect, it } from "vitest";
import opencascade from "replicad-opencascadejs";
import { measureShapeVolumeProperties, setOC, type Shape3D } from "replicad";

import {
  buildEffectiveConfig,
  createFormState,
} from "../config-form";
import { buildStlExport, groupPartsByColor } from "../stl";
import type { ModelPart } from "../types";
import {
  pinRecpHeight,
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

  it("generates the expected parts from the default configuration", () => {
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
    expect(flesh.shape.boundingBox.width).toBeCloseTo(60, 1);
    expect(rind.shape.boundingBox.width).toBeCloseTo(70, 1);
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

  it("changes the geometry when the watermelon radius changes", () => {
    const larger = generate({
      ...baseConfig,
      watermelon: { ...baseConfig.watermelon, radius: 40 },
    });
    const flesh = larger.find((part) => part.id === "flesh")!;

    expect(flesh.shape.boundingBox.width).toBeCloseTo(70, 1);
    expect(totalVolume(larger)).toBeGreaterThan(totalVolume(baseParts));
  });

  it("changes the geometry when pin receptacle dimensions change", () => {
    const wider = generate({
      ...baseConfig,
      pinRecp: {
        ...baseConfig.pinRecp,
        base: { ...baseConfig.pinRecp.base, width: 9 },
      },
    });

    expect(totalVolume(wider)).toBeLessThan(totalVolume(baseParts));
  });

  it("supports disabling the optional retaining clip", () => {
    const withoutClip: WatermelonModelConfig = {
      ...baseConfig,
      pinRecp: {
        base: baseConfig.pinRecp.base,
        tabs: baseConfig.pinRecp.tabs,
      },
    };

    const parts = generate(withoutClip);
    expect(parts).toHaveLength(8);
    expect(totalVolume(parts)).toBeGreaterThan(totalVolume(baseParts));
    expect(pinRecpHeight(withoutClip.pinRecp)).toBeLessThan(
      pinRecpHeight(baseConfig.pinRecp),
    );
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
    const invalid = {
      ...baseConfig,
      watermelon: {
        ...baseConfig.watermelon,
        radius: 4,
        rindWidth: 3,
        innerRindWidth: 2,
      },
    } satisfies WatermelonModelConfig;

    const issues = validateWatermelonModel(invalid);
    expect(issues.some((issue) => issue.path === "watermelon.rindWidth")).toBe(true);

    expect(() => generate(invalid)).toThrow();
  });
});
