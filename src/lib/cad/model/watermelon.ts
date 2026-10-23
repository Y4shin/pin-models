/**
 * Parametric watermelon model.
 *
 * This file is the model-specific part of the configurator. The geometry is the
 * Replicad implementation from the original `example.ts` and is kept intact.
 * Everything else in the application (UI, worker, viewer, export) only depends
 * on the generic `ParametricModel` contract.
 */
import { draw, drawRectangle, type Drawing, type Shape3D } from "replicad";
import type {
  ConfigDefinition,
  ModelPart,
  ParametricModel,
  ValidationIssue,
} from "../types";

export type BaseConfig = {
  length: number;
  width: number;
  depth: number;
};

export type TabGeometry = {
  width: number;
  topSlopeHeight: number;
  bottomSlopeHeight: number;
};

export type TabsConfig = {
  cutoutLength: number;
  geometry: TabGeometry;
};

export type RetainerClipConfig = {
  depth: number;
  protrusion: number;
  clipThickness: number;
  cavityLength: number;
  wallDistance: number;
};

export type PinRecpConfig = {
  base: BaseConfig;
  tabs: TabsConfig;
  retainerClip?: RetainerClipConfig;
};

export type WatermelonConfig = {
  thickness: number;
  radius: number;
  rindWidth: number;
  innerRindWidth: number;
  pinRecpOffset: number;
  seedAngle?: number;
  seedDepth?: number;
};

export type WatermelonModelConfig = {
  pinRecp: PinRecpConfig;
  watermelon: WatermelonConfig;
};

export const DEFAULT_SEED_ANGLE = 30;

/** Default seed depth, relative to the watermelon thickness. */
export function defaultSeedDepth(thickness: number): number {
  return thickness * 0.35;
}

/**
 * Gives the total height of the pin receptacle (including the cavity for the
 * retaining clip).
 */
export function pinRecpHeight(config: PinRecpConfig): number {
  const { base, tabs } = config;
  let res = base.depth + tabs.geometry.topSlopeHeight + tabs.geometry.bottomSlopeHeight;
  if (config.retainerClip) {
    res += config.retainerClip.depth;
  }
  return res;
}

/**
 * Creates an upside-down pin receptacle negative.
 * The opening faces downward at Z = 0, and the cavity extends upward.
 */
export function pinRecpNegative(config: PinRecpConfig, extraSpace = 0): Shape3D {
  if (!Number.isFinite(extraSpace) || extraSpace < 0) {
    throw new RangeError("extraSpace must be a non-negative number.");
  }

  const { base, tabs, retainerClip } = config;

  const openingHeight =
    base.depth + tabs.geometry.topSlopeHeight + tabs.geometry.bottomSlopeHeight;

  let baseBody = drawRectangle(base.width, base.length)
    .sketchOnPlane("XY")
    .extrude(openingHeight)
    .asShape3D();

  if (extraSpace > 0) {
    const extension = drawRectangle(base.width, extraSpace)
      .translate(0, -(base.length + extraSpace) / 2)
      .sketchOnPlane("XY")
      .extrude(openingHeight)
      .asShape3D();

    baseBody = baseBody.fuse(extension);
  }

  // Remove the retaining tab volumes from the negative.
  const tabCutoutProfile = draw([-base.width / 2, base.depth])
    .line(tabs.geometry.width, tabs.geometry.bottomSlopeHeight)
    .line(-tabs.geometry.width, tabs.geometry.topSlopeHeight)
    .close();

  const mirroredTabCutoutProfile = tabCutoutProfile
    .clone()
    .mirror([0, 1], [0, 0], "plane");

  const cutouts = [tabCutoutProfile, mirroredTabCutoutProfile].map((profile) =>
    profile
      .sketchOnPlane("XZ", -base.length / 2)
      .extrude(base.length - tabs.cutoutLength)
      .asShape3D(),
  );

  let shape = cutouts.reduce((acc, cutout) => acc.cut(cutout), baseBody).asShape3D();

  if (retainerClip) {
    const clip = retainerClip;

    const clipCavity = drawRectangle(base.width, clip.cavityLength)
      .translate(0, -(base.length + clip.cavityLength) / 2)
      .sketchOnPlane("XY")
      .extrude(-clip.depth)
      .asShape3D();

    shape = shape.fuse(clipCavity);

    const clipWidth = base.width - 2 * clip.wallDistance;
    const rearY = -base.length / 2 - clip.cavityLength;
    const frontY = -base.length / 2;

    // Drawing coordinates on YZ correspond to [world Y, world Z].
    const clipSideProfile = draw([rearY, -clip.depth])
      .lineTo([rearY, 0])
      .lineTo([frontY - clip.clipThickness, clip.protrusion])
      .lineTo([frontY, clip.protrusion])
      .close();

    const retainingClip = clipSideProfile
      .sketchOnPlane("YZ", -clipWidth / 2)
      .extrude(clipWidth)
      .asShape3D();

    shape = shape.cut(retainingClip);
  }

  // Turn upside down, then align the opening with Z = 0.
  // Rotating around X also reverses the direction along Y.
  return shape.rotate(180, [0, 0, 0], [1, 0, 0]).translateZ(openingHeight);
}

function halfDisc(r: number): Drawing {
  return draw([-r, 0]).threePointsArcTo([r, 0], [0, r]).close();
}

function halfRing(outerR: number, innerR: number): Drawing {
  return draw([-outerR, 0])
    .threePointsArcTo([outerR, 0], [0, outerR])
    .lineTo([innerR, 0])
    .threePointsArcTo([-innerR, 0], [0, innerR])
    .close();
}

function extrudeBody(profile: Drawing, thickness: number): Shape3D {
  return profile.sketchOnPlane("XY").extrude(thickness).asShape3D();
}

/**
 * Creates a flat half-watermelon with five black seed bodies fitted into
 * matching recesses in the flesh.
 */
export function watermelon(config: WatermelonConfig): ModelPart[] {
  const {
    radius,
    thickness,
    rindWidth,
    innerRindWidth,
    seedAngle = DEFAULT_SEED_ANGLE,
    seedDepth = defaultSeedDepth(thickness),
  } = config;

  const fleshRadius = radius - rindWidth - innerRindWidth;

  if (
    ![radius, thickness, rindWidth, innerRindWidth].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    fleshRadius <= 0
  ) {
    throw new RangeError(
      "Dimensions must be positive, and combined rind widths must be less than radius.",
    );
  }

  if (!Number.isFinite(seedAngle) || seedAngle <= 0 || seedAngle >= 90) {
    throw new RangeError("seedAngle must be between 0 and 90 degrees.");
  }

  if (!Number.isFinite(seedDepth) || seedDepth <= 0 || seedDepth > thickness) {
    throw new RangeError("seedDepth must be positive and at most thickness.");
  }

  function createSeedProfile(): Drawing {
    const halfAngle = (seedAngle * Math.PI) / 360;
    // Make the seed slightly longer.
    const sideHeight = fleshRadius * 0.24;

    // Widen the broad end by 35%.
    const baseHalfWidth =
      1.35 * (fleshRadius * 0.008 + sideHeight * Math.tan(halfAngle));

    // Keep a rounded, moderately tapered narrow end.
    const tipHalfWidth = baseHalfWidth * 0.55;

    // Calculate the actual side angle for the rounded connections.
    const sideAngle = Math.atan2(baseHalfWidth - tipHalfWidth, sideHeight);

    const bottomY = -sideHeight / 2;
    const topY = sideHeight / 2;

    const capRise = tipHalfWidth * (1 / Math.cos(sideAngle) - Math.tan(sideAngle));

    const handleLength = baseHalfWidth * 2;
    const handleX = handleLength * Math.sin(sideAngle);
    const handleY = handleLength * Math.cos(sideAngle);

    return draw([-baseHalfWidth, bottomY])
      .lineTo([-tipHalfWidth, topY])
      .threePointsArcTo([tipHalfWidth, topY], [0, topY + capRise])
      .lineTo([baseHalfWidth, bottomY])
      .cubicBezierCurveTo(
        [-baseHalfWidth, bottomY],
        [baseHalfWidth + handleX, bottomY - handleY],
        [-baseHalfWidth - handleX, bottomY - handleY],
      )
      .close();
  }

  const whiteOuterRadius = radius - rindWidth;

  const rindBody = extrudeBody(halfRing(radius, whiteOuterRadius), thickness);

  const innerRindBody = extrudeBody(halfRing(whiteOuterRadius, fleshRadius), thickness);

  let fleshBody = extrudeBody(halfDisc(fleshRadius), thickness);

  const seedProfile = createSeedProfile();
  const rowRadius = fleshRadius * 0.62;
  const epsilon = thickness * 0.001;
  const seedBodies: ModelPart[] = [];

  for (let index = 0; index < 5; index++) {
    const angle = 18 + index * 36;
    const radians = (angle * Math.PI) / 180;

    const positionedProfile = seedProfile
      .clone()
      .rotate(angle + 90)
      .translate(rowRadius * Math.cos(radians), rowRadius * Math.sin(radians));

    // Black insert ends flush with the top of the flesh.
    const seedBody = positionedProfile
      .clone()
      .sketchOnPlane("XY", thickness - seedDepth)
      .extrude(seedDepth)
      .asShape3D();

    // Extend the cutter slightly above the top face.
    const seedCutter = positionedProfile
      .sketchOnPlane("XY", thickness - seedDepth)
      .extrude(seedDepth + epsilon)
      .asShape3D();

    fleshBody = fleshBody.cut(seedCutter);
    seedBodies.push({
      id: `seed-${index + 1}`,
      shape: seedBody,
      color: "black",
    });
  }

  return [
    { id: "flesh", shape: fleshBody, color: "red" },
    { id: "rind-outer", shape: rindBody, color: "green" },
    { id: "rind-inner", shape: innerRindBody, color: "white" },
    ...seedBodies,
  ];
}

/**
 * Model entry point: generates the watermelon and subtracts the pin receptacle
 * negative from every part, exactly as the original `main()` did.
 */
export function generateWatermelon(config: WatermelonModelConfig): ModelPart[] {
  const negative = pinRecpNegative(config.pinRecp, config.watermelon.radius)
    .rotate(90)
    .translateY(
      config.watermelon.pinRecpOffset + config.pinRecp.base.width / 2,
    );

  return watermelon(config.watermelon).map((part) => ({
    ...part,
    shape: part.shape.cut(negative),
  }));
}

export function validateWatermelonModel(
  config: WatermelonModelConfig,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { pinRecp, watermelon: melon } = config;

  const positive = (value: number, path: string, label: string) => {
    if (!Number.isFinite(value) || value <= 0) {
      issues.push({ path, message: `${label} must be a positive number.` });
    }
  };

  const nonNegative = (value: number, path: string, label: string) => {
    if (!Number.isFinite(value) || value < 0) {
      issues.push({ path, message: `${label} must be zero or greater.` });
    }
  };

  // Pin receptacle base.
  positive(pinRecp.base.length, "pinRecp.base.length", "Receptacle length");
  positive(pinRecp.base.width, "pinRecp.base.width", "Receptacle width");
  positive(pinRecp.base.depth, "pinRecp.base.depth", "Receptacle depth");

  // Tabs.
  positive(pinRecp.tabs.geometry.width, "pinRecp.tabs.geometry.width", "Tab width");
  nonNegative(
    pinRecp.tabs.geometry.topSlopeHeight,
    "pinRecp.tabs.geometry.topSlopeHeight",
    "Top slope height",
  );
  nonNegative(
    pinRecp.tabs.geometry.bottomSlopeHeight,
    "pinRecp.tabs.geometry.bottomSlopeHeight",
    "Bottom slope height",
  );
  if (
    !Number.isFinite(pinRecp.tabs.cutoutLength) ||
    pinRecp.tabs.cutoutLength < 0 ||
    (Number.isFinite(pinRecp.base.length) &&
      pinRecp.tabs.cutoutLength >= pinRecp.base.length)
  ) {
    issues.push({
      path: "pinRecp.tabs.cutoutLength",
      message:
        "Cutout length must be zero or greater and smaller than the receptacle length.",
    });
  }

  // Retaining clip.
  const clip = pinRecp.retainerClip;
  if (clip) {
    positive(clip.depth, "pinRecp.retainerClip.depth", "Clip depth");
    nonNegative(
      clip.protrusion,
      "pinRecp.retainerClip.protrusion",
      "Clip protrusion",
    );
    positive(
      clip.clipThickness,
      "pinRecp.retainerClip.clipThickness",
      "Clip thickness",
    );
    positive(
      clip.cavityLength,
      "pinRecp.retainerClip.cavityLength",
      "Clip cavity length",
    );
    if (!Number.isFinite(clip.wallDistance) || clip.wallDistance < 0) {
      issues.push({
        path: "pinRecp.retainerClip.wallDistance",
        message: "Clip wall distance must be zero or greater.",
      });
    } else if (
      Number.isFinite(pinRecp.base.width) &&
      2 * clip.wallDistance >= pinRecp.base.width
    ) {
      issues.push({
        path: "pinRecp.retainerClip.wallDistance",
        message: "Clip wall distance must be less than half of the receptacle width.",
      });
    }
  }

  // Watermelon.
  positive(melon.radius, "watermelon.radius", "Radius");
  positive(melon.thickness, "watermelon.thickness", "Thickness");
  positive(melon.rindWidth, "watermelon.rindWidth", "Outer rind width");
  positive(melon.innerRindWidth, "watermelon.innerRindWidth", "Inner rind width");

  const fleshRadius =
    melon.radius - melon.rindWidth - melon.innerRindWidth;
  if (
    [melon.radius, melon.rindWidth, melon.innerRindWidth].every(Number.isFinite) &&
    fleshRadius <= 0
  ) {
    issues.push({
      path: "watermelon.rindWidth",
      message:
        "Combined rind widths must be smaller than the watermelon radius.",
    });
  }

  const seedAngle = melon.seedAngle ?? DEFAULT_SEED_ANGLE;
  if (!Number.isFinite(seedAngle) || seedAngle <= 0 || seedAngle >= 90) {
    issues.push({
      path: "watermelon.seedAngle",
      message: "Seed angle must be greater than 0 and less than 90 degrees.",
    });
  }

  const seedDepth = melon.seedDepth ?? defaultSeedDepth(melon.thickness);
  if (
    !Number.isFinite(seedDepth) ||
    seedDepth <= 0 ||
    (Number.isFinite(melon.thickness) && seedDepth > melon.thickness)
  ) {
    issues.push({
      path: "watermelon.seedDepth",
      message: "Seed depth must be positive and at most the watermelon thickness.",
    });
  }

  return issues;
}

/**
 * The runtime configuration schema. Adding a numeric property here makes it
 * appear in the configurator automatically.
 */
const definition: ConfigDefinition<WatermelonModelConfig> = {
  defaults: {
    pinRecp: {
      base: {
        length: 22.0,
        width: 5.5,
        depth: 0.6,
      },
      tabs: {
        cutoutLength: 4.9,
        geometry: {
          width: 0.8,
          topSlopeHeight: 0.8,
          bottomSlopeHeight: 0.4,
        },
      },
      retainerClip: {
        depth: 0.6,
        protrusion: 0.4,
        clipThickness: 0.8,
        cavityLength: 1.6,
        wallDistance: 0.4,
      },
    },
    watermelon: {
      // Original arithmetic expression, kept as-is (evaluates to 3).
      thickness: 1 + 0.2 + 0.8 + 0.4 + 0.6,
      radius: 35,
      rindWidth: 3,
      innerRindWidth: 2,
      pinRecpOffset: 1,
      seedAngle: DEFAULT_SEED_ANGLE,
    },
  },
  metadata: {
    pinRecp: {
      label: "Pin receptacle",
      fields: {
        base: {
          label: "Base",
          fields: {
            length: { unit: "mm", step: 0.1 },
            width: { unit: "mm", step: 0.1 },
            depth: { unit: "mm", step: 0.1 },
          },
        },
        tabs: {
          label: "Tabs",
          fields: {
            cutoutLength: { label: "Cutout length", unit: "mm", step: 0.1 },
            geometry: {
              label: "Tab geometry",
              fields: {
                width: { label: "Tab width", unit: "mm", step: 0.1 },
                topSlopeHeight: {
                  label: "Top slope height",
                  unit: "mm",
                  step: 0.1,
                },
                bottomSlopeHeight: {
                  label: "Bottom slope height",
                  unit: "mm",
                  step: 0.1,
                },
              },
            },
          },
        },
        retainerClip: {
          label: "Retaining clip",
          description:
            "Optional retaining clip cavity and protrusion in the receptacle.",
          optional: true,
          fields: {
            depth: { unit: "mm", step: 0.1 },
            protrusion: { unit: "mm", step: 0.1 },
            clipThickness: { label: "Clip thickness", unit: "mm", step: 0.1 },
            cavityLength: { label: "Cavity length", unit: "mm", step: 0.1 },
            wallDistance: { label: "Wall distance", unit: "mm", step: 0.1 },
          },
        },
      },
    },
    watermelon: {
      label: "Watermelon",
      fields: {
        thickness: { unit: "mm", step: 0.1 },
        radius: { unit: "mm", step: 0.5 },
        rindWidth: { label: "Outer rind width", unit: "mm", step: 0.1 },
        innerRindWidth: { label: "Inner rind width", unit: "mm", step: 0.1 },
        pinRecpOffset: { label: "Pin receptacle offset", unit: "mm", step: 0.1 },
        seedAngle: {
          label: "Seed angle",
          unit: "°",
          step: 1,
          description: "Angle of the seed sides.",
        },
        seedDepth: {
          label: "Seed depth",
          unit: "mm",
          step: 0.05,
          optional: true,
          description:
            "Automatic value is 35% of the watermelon thickness. Enable the override to set a fixed depth.",
          computeDefault: (parent) => defaultSeedDepth(Number(parent.thickness)),
        },
      },
    },
  },
};

export const watermelonModel: ParametricModel<WatermelonModelConfig> = {
  id: "watermelon",
  name: "Watermelon",
  definition,
  generate: generateWatermelon,
  validate: validateWatermelonModel,
};
