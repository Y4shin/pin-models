/**
 * Parametric watermelon brooch model.
 *
 * This file is the model-specific part of the configurator. The geometry is the
 * Replicad implementation from the original `example.ts`, with the pin
 * receptacle adapted for a simplified, printer-aware configuration.
 */
import { draw, drawRectangle, type Drawing, type Shape3D } from "replicad";
import type {
  ConfigDefinition,
  ModelPart,
  ParametricModel,
  ValidationIssue,
} from "../types";

// ---------------------------------------------------------------------------
// Public configuration
// ---------------------------------------------------------------------------

export type WatermelonConfig = {
  /** Overall width across the flat back. Height is half of this value. */
  width: number;
  thickness: number;
  appearance: {
    outerRindWidth: number;
    innerRindWidth: number;
  };
};

export type PinConfig = {
  length: number;
  width: number;
  thickness: number;
  /** Extra clearance per side around the pin. */
  clearance: number;
  retainingClip: boolean;
};

export type PrinterConfig = {
  nozzleDiameter: number;
  layerHeight: number;
  /** Adds the printable lower lead-in slope to the retaining tabs. */
  bottomSlopes: boolean;
};

export type WatermelonModelConfig = {
  watermelon: WatermelonConfig;
  pin: PinConfig;
  printer: PrinterConfig;
};

// ---------------------------------------------------------------------------
// Internal geometry configuration
// ---------------------------------------------------------------------------

export type BaseConfig = {
  length: number;
  width: number;
  depth: number;
};

export type TabGeometry = {
  width: number;
  /** Height of the flat, vertical tab face above the lower lead-in slope. */
  tabHeight: number;
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

export type WatermelonGeometryConfig = {
  thickness: number;
  radius: number;
  rindWidth: number;
  innerRindWidth: number;
  seedAngle?: number;
  seedDepth?: number;
};

// ---------------------------------------------------------------------------
// Derived geometry and print rules
// ---------------------------------------------------------------------------

export const DEFAULT_SEED_ANGLE = 30;
const SEED_DEPTH_FRACTION = 0.35;
const SEED_ROW_RADIUS_FRACTION = 0.66;
const SEED_COUNT = 5;
const SEED_START_ANGLE = 18;
const SEED_STEP_ANGLE = 36;
const DEFAULT_CUTOUT_LENGTH = 4.9;
const DEFAULT_CLIP_CAVITY_LENGTH = 1.6;
const DEFAULT_CUTOUT_PIN_LENGTH = 22;
const CUTOUT_RATIO = DEFAULT_CUTOUT_LENGTH / DEFAULT_CUTOUT_PIN_LENGTH;

/** Default seed depth, relative to the watermelon thickness. */
export function defaultSeedDepth(thickness: number): number {
  return thickness * SEED_DEPTH_FRACTION;
}

export interface SeedProfileMetrics {
  sideHeight: number;
  baseHalfWidth: number;
  tipHalfWidth: number;
  tipWidth: number;
  sideAngle: number;
  capRise: number;
  /** Conservative distance from the seed centre to its furthest point. */
  maxRadius: number;
}

/** Metrics of the seed profile, shared by geometry and validation. */
export function seedProfileMetrics(
  fleshRadius: number,
  seedAngle = DEFAULT_SEED_ANGLE,
): SeedProfileMetrics {
  const halfAngle = (seedAngle * Math.PI) / 360;
  const sideHeight = fleshRadius * 0.24;
  const baseHalfWidth =
    1.35 * (fleshRadius * 0.008 + sideHeight * Math.tan(halfAngle));
  const tipHalfWidth = baseHalfWidth * 0.55;
  const sideAngle = Math.atan2(baseHalfWidth - tipHalfWidth, sideHeight);
  const capRise = tipHalfWidth * (1 / Math.cos(sideAngle) - Math.tan(sideAngle));

  return {
    sideHeight,
    baseHalfWidth,
    tipHalfWidth,
    tipWidth: tipHalfWidth * 2,
    sideAngle,
    capRise,
    maxRadius: Math.hypot(baseHalfWidth, sideHeight / 2 + capRise),
  };
}

type Vec2 = [number, number];

function sampleArcThroughPoints(
  start: Vec2,
  mid: Vec2,
  end: Vec2,
  steps = 48,
): Vec2[] {
  const [bx, by] = start;
  const [cx, cy] = end;
  const [mx, my] = mid;
  const d = 2 * (bx * (cy - my) + cx * (my - by) + mx * (by - cy));

  if (Math.abs(d) < 1e-12) return [start, mid, end];

  const ux =
    ((bx * bx + by * by) * (cy - my) +
      (cx * cx + cy * cy) * (my - by) +
      (mx * mx + my * my) * (by - cy)) /
    d;
  const uy =
    ((bx * bx + by * by) * (mx - cx) +
      (cx * cx + cy * cy) * (bx - mx) +
      (mx * mx + my * my) * (cx - bx)) /
    d;
  const radius = Math.hypot(bx - ux, by - uy);
  const startAngle = Math.atan2(by - uy, bx - ux);
  const endAngle = Math.atan2(cy - uy, cx - ux);
  const midAngle = Math.atan2(my - uy, mx - ux);

  const normalize = (angle: number) => {
    let value = angle;
    while (value < 0) value += 2 * Math.PI;
    while (value >= 2 * Math.PI) value -= 2 * Math.PI;
    return value;
  };

  let sweep = normalize(endAngle - startAngle);
  if (normalize(midAngle - startAngle) > sweep) {
    sweep -= 2 * Math.PI;
  }

  const points: Vec2[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + (sweep * index) / steps;
    points.push([
      ux + radius * Math.cos(angle),
      uy + radius * Math.sin(angle),
    ]);
  }
  return points;
}

function sampleCubicBezier(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  steps = 48,
): Vec2[] {
  const points: Vec2[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const u = 1 - t;
    points.push([
      u * u * u * p0[0] +
        3 * u * u * t * p1[0] +
        3 * u * t * t * p2[0] +
        t * t * t * p3[0],
      u * u * u * p0[1] +
        3 * u * u * t * p1[1] +
        3 * u * t * t * p2[1] +
        t * t * t * p3[1],
    ]);
  }
  return points;
}

function seedProfileSamples(metrics: SeedProfileMetrics): Vec2[] {
  const { sideHeight, baseHalfWidth, tipHalfWidth, sideAngle, capRise } = metrics;
  const bottomY = -sideHeight / 2;
  const topY = sideHeight / 2;
  const handleLength = baseHalfWidth * 2;
  const handleX = handleLength * Math.sin(sideAngle);
  const handleY = handleLength * Math.cos(sideAngle);

  const baseLeft: Vec2 = [-baseHalfWidth, bottomY];
  const tipLeft: Vec2 = [-tipHalfWidth, topY];
  const tipRight: Vec2 = [tipHalfWidth, topY];
  const baseRight: Vec2 = [baseHalfWidth, bottomY];

  return [
    baseLeft,
    ...sampleArcThroughPoints(tipLeft, [0, topY + capRise], tipRight),
    baseRight,
    ...sampleCubicBezier(
      baseRight,
      [baseHalfWidth + handleX, bottomY - handleY],
      [-baseHalfWidth - handleX, bottomY - handleY],
      baseLeft,
    ),
  ];
}

/**
 * World-space X/Y bounds of one seed. Used to keep the retaining slot and clip
 * away from the seed recesses without running CAD during validation.
 */
export function seedWorldBounds(
  fleshRadius: number,
  seedAngle: number,
  angleDegrees: number,
  rowFraction = SEED_ROW_RADIUS_FRACTION,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const samples = seedProfileSamples(seedProfileMetrics(fleshRadius, seedAngle));
  const rotation = ((angleDegrees + 90) * Math.PI) / 180;
  const radians = (angleDegrees * Math.PI) / 180;
  const rowRadius = fleshRadius * rowFraction;
  const centerX = rowRadius * Math.cos(radians);
  const centerY = rowRadius * Math.sin(radians);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const [x, y] of samples) {
    const worldX = centerX + x * cos - y * sin;
    const worldY = centerY + x * sin + y * cos;
    minX = Math.min(minX, worldX);
    maxX = Math.max(maxX, worldX);
    minY = Math.min(minY, worldY);
    maxY = Math.max(maxY, worldY);
  }

  return { minX, maxX, minY, maxY };
}

export interface DerivedGeometry {
  radius: number;
  seedAngle: number;
  seedDepth: number;
  pinRecp: PinRecpConfig;
  pinRecpOffset: number;
  extraSpace: number;
  slotWidth: number;
  slotDepth: number;
  tabWidth: number;
  tabHeight: number;
  bottomSlopeHeight: number;
  openingHeight: number;
  receptacleHeight: number;
  clipWidth: number;
  clipWallDistance: number;
  cutoutLength: number;
  minTopWall: number;
  minColorWall: number;
  minSeedWall: number;
}

/**
 * Expands the user-facing configuration into the detailed receptacle geometry.
 * The constants are chosen so the original defaults are preserved for a
 * 0.4 mm nozzle and 0.2 mm layer height.
 */
export function deriveGeometry(config: WatermelonModelConfig): DerivedGeometry {
  const { watermelon, pin, printer } = config;

  const nozzle = printer.nozzleDiameter;
  const layer = printer.layerHeight;

  const slotWidth = pin.width + 2 * pin.clearance;
  const slotDepth = pin.thickness + 2 * pin.clearance;

  const tabWidth = 2 * nozzle;
  const tabHeight = 2 * nozzle;
  // Derived from all three print dimensions; the defaults give 0.4 mm.
  const bottomSlopeHeight = printer.bottomSlopes
    ? Number(((tabWidth * layer) / nozzle).toFixed(12))
    : 0;

  const openingHeight = slotDepth + tabHeight + bottomSlopeHeight;

  const clipWallDistance = Math.max(nozzle, 2 * layer);
  const clipDepth = Math.max(3 * layer, slotDepth);

  const retainerClip: RetainerClipConfig | undefined = pin.retainingClip
    ? {
        depth: clipDepth,
        protrusion: nozzle,
        clipThickness: 2 * nozzle,
        cavityLength: DEFAULT_CLIP_CAVITY_LENGTH,
        wallDistance: clipWallDistance,
      }
    : undefined;

  const cutoutLength = Math.min(
    DEFAULT_CUTOUT_LENGTH,
    Math.max(2.0, pin.length * CUTOUT_RATIO),
  );

  const pinRecp: PinRecpConfig = {
    base: {
      length: pin.length,
      width: slotWidth,
      depth: slotDepth,
    },
    tabs: {
      cutoutLength,
      geometry: {
        width: tabWidth,
        tabHeight,
        bottomSlopeHeight,
      },
    },
    retainerClip,
  };

  const minColorWall = Math.max(2 * nozzle, 5 * layer);
  const pinRecpOffset = Math.max(1, minColorWall);

  return {
    radius: watermelon.width / 2,
    seedAngle: DEFAULT_SEED_ANGLE,
    seedDepth: defaultSeedDepth(watermelon.thickness),
    pinRecp,
    pinRecpOffset,
    extraSpace: watermelon.width / 2,
    slotWidth,
    slotDepth,
    tabWidth,
    tabHeight,
    bottomSlopeHeight,
    openingHeight,
    receptacleHeight: openingHeight + (retainerClip ? clipDepth : 0),
    clipWidth: slotWidth - 2 * clipWallDistance,
    clipWallDistance,
    cutoutLength,
    minTopWall: Math.max(3 * layer, 1.5 * nozzle),
    minColorWall,
    minSeedWall: Math.max(2 * nozzle, 3 * layer),
  };
}

/**
 * Gives the total height of the pin receptacle (including the cavity for the
 * retaining clip).
 */
export function pinRecpHeight(config: PinRecpConfig): number {
  const { base, tabs } = config;
  let res = base.depth + tabs.geometry.tabHeight + tabs.geometry.bottomSlopeHeight;
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
    base.depth + tabs.geometry.tabHeight + tabs.geometry.bottomSlopeHeight;

  let baseBody = drawRectangle(base.width, base.length)
    .sketchOnPlane("XY")
    .extrude(openingHeight)
    .asShape3D();

  if (extraSpace > 0) {
    // The side insertion slot only needs to pass the pin. Keeping it at the
    // channel depth avoids cutting into the seed recesses and the rind.
    // The negative is flipped after construction, so the short extension must
    // start at the local top to end up at the opening plane after the flip.
    const extension = drawRectangle(base.width, extraSpace)
      .translate(0, -(base.length + extraSpace) / 2)
      .sketchOnPlane("XY", openingHeight - base.depth)
      .extrude(base.depth)
      .asShape3D();

    baseBody = baseBody.fuse(extension);
  }

  // Remove the retaining tab volumes from the negative.
  // The tab has a printable lower lead-in slope, then a flat vertical face.
  const tabTop =
    base.depth + tabs.geometry.bottomSlopeHeight + tabs.geometry.tabHeight;
  const tabCutoutProfile = draw([-base.width / 2, base.depth])
    .line(tabs.geometry.width, tabs.geometry.bottomSlopeHeight)
    .lineTo([-base.width / 2 + tabs.geometry.width, tabTop])
    .lineTo([-base.width / 2, tabTop])
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

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

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
export function watermelon(config: WatermelonGeometryConfig): ModelPart[] {
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
    const {
      sideHeight,
      baseHalfWidth,
      tipHalfWidth,
      sideAngle,
      capRise,
    } = seedProfileMetrics(fleshRadius, seedAngle);

    const bottomY = -sideHeight / 2;
    const topY = sideHeight / 2;

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
  const rowRadius = fleshRadius * SEED_ROW_RADIUS_FRACTION;
  const epsilon = thickness * 0.001;
  const seedBodies: ModelPart[] = [];

  for (let index = 0; index < SEED_COUNT; index++) {
    const angle = SEED_START_ANGLE + index * SEED_STEP_ANGLE;
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
  const derived = deriveGeometry(config);
  const negative = pinRecpNegative(derived.pinRecp, derived.extraSpace)
    .rotate(90)
    .translateY(
      derived.pinRecpOffset + derived.pinRecp.base.width / 2,
    );

  return watermelon({
    radius: derived.radius,
    thickness: config.watermelon.thickness,
    rindWidth: config.watermelon.appearance.outerRindWidth,
    innerRindWidth: config.watermelon.appearance.innerRindWidth,
    seedAngle: derived.seedAngle,
    seedDepth: derived.seedDepth,
  }).map((part) => ({
    ...part,
    shape: part.shape.cut(negative),
  }));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EPSILON = 1e-6;

function mm(value: number): string {
  return `${Number(value.toFixed(2))} mm`;
}

export function validateWatermelonModel(
  config: WatermelonModelConfig,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { watermelon, pin, printer } = config;

  const outerRind = watermelon.appearance.outerRindWidth;
  const innerRind = watermelon.appearance.innerRindWidth;
  const nozzle = printer.nozzleDiameter;
  const layer = printer.layerHeight;

  let basicsValid = true;

  const positive = (value: number, path: string, label: string) => {
    if (!Number.isFinite(value) || value <= 0) {
      issues.push({ path, message: `${label} must be a positive number.` });
      basicsValid = false;
    }
  };

  const nonNegative = (value: number, path: string, label: string) => {
    if (!Number.isFinite(value) || value < 0) {
      issues.push({ path, message: `${label} must be zero or greater.` });
      basicsValid = false;
    }
  };

  positive(watermelon.width, "watermelon.width", "Watermelon width");
  positive(watermelon.thickness, "watermelon.thickness", "Watermelon thickness");
  positive(
    outerRind,
    "watermelon.appearance.outerRindWidth",
    "Outer rind width",
  );
  positive(
    innerRind,
    "watermelon.appearance.innerRindWidth",
    "Inner rind width",
  );
  positive(pin.length, "pin.length", "Pin length");
  positive(pin.width, "pin.width", "Pin width");
  positive(pin.thickness, "pin.thickness", "Pin thickness");
  nonNegative(pin.clearance, "pin.clearance", "Fit clearance");
  positive(nozzle, "printer.nozzleDiameter", "Nozzle diameter");
  positive(layer, "printer.layerHeight", "Layer height");

  if (!basicsValid) return issues;

  if (layer > nozzle + EPSILON) {
    issues.push({
      path: "printer.layerHeight",
      message: "Layer height must not exceed the nozzle diameter.",
    });
  }

  const radius = watermelon.width / 2;
  const fleshRadius = radius - outerRind - innerRind;

  if (fleshRadius <= EPSILON) {
    issues.push({
      path: "watermelon.appearance.outerRindWidth",
      message:
        "The rind widths leave no red flesh. Reduce a rind width or increase the watermelon width.",
    });
    return issues;
  }

  const derived = deriveGeometry(config);
  const thickness = watermelon.thickness;

  // The receptacle must leave a printable top wall.
  const minimumThickness = derived.receptacleHeight + derived.minTopWall;
  if (thickness + EPSILON < minimumThickness) {
    issues.push({
      path: "watermelon.thickness",
      message: `Thickness must be at least ${mm(minimumThickness)} for this pin and printer. It must leave ${mm(derived.minTopWall)} of material above the cavity.`,
    });
  }

  // The tabs and clip must fit across the slot.
  const minimumPinWidthForTabs =
    2 * derived.tabWidth + 2 * nozzle - 2 * pin.clearance;
  if (derived.slotWidth + EPSILON < minimumPinWidthForTabs) {
    issues.push({
      path: "pin.width",
      message: `Pin width is too small for the retaining tabs. It must be at least ${mm(minimumPinWidthForTabs)}.`,
    });
  }

  if (pin.retainingClip) {
    if (derived.clipWallDistance + EPSILON < nozzle) {
      issues.push({
        path: "pin.width",
        message:
          "The retaining clip needs a side gap of at least one nozzle diameter so it can bend down.",
      });
    }

    const minimumPinWidthForClip =
      2 * derived.clipWallDistance + 2 * nozzle - 2 * pin.clearance;
    if (derived.clipWidth + EPSILON < 2 * nozzle) {
      issues.push({
        path: "pin.width",
        message: `Pin width is too small for the retaining clip and its side gaps. It must be at least ${mm(minimumPinWidthForClip)}.`,
      });
    }

    const clip = derived.pinRecp.retainerClip!;
    if (derived.slotDepth + EPSILON < clip.protrusion + layer) {
      issues.push({
        path: "pin.thickness",
        message:
          "The pin slot is too shallow for the retaining clip. Increase the pin thickness.",
      });
    }
  }

  // The retaining slot and clip must stay inside the red flesh. The straight
  // side-insertion slot is deliberately allowed to cross the rind.
  const yFar = derived.pinRecpOffset + derived.slotWidth;
  const xEnd =
    pin.length / 2 + (derived.pinRecp.retainerClip?.cavityLength ?? 0);
  const chord =
    xEnd < fleshRadius
      ? Math.sqrt(fleshRadius * fleshRadius - xEnd * xEnd)
      : 0;
  if (
    xEnd >= fleshRadius ||
    yFar + derived.minColorWall > chord + EPSILON
  ) {
    issues.push({
      path: "watermelon.width",
      message:
        "The retaining slot reaches the white rind. Increase the watermelon width, shorten the pin, or reduce the rind widths.",
    });
  }

  // Seed printability. Seeds scale with the flesh radius.
  const seedDepth = defaultSeedDepth(thickness);
  const seedMetrics = seedProfileMetrics(fleshRadius, DEFAULT_SEED_ANGLE);
  const minimumSeedFeature = 2 * nozzle;

  if (seedMetrics.tipWidth + EPSILON < minimumSeedFeature) {
    issues.push({
      path: "watermelon.width",
      message: `Seed tips are ${mm(seedMetrics.tipWidth)} wide. A ${mm(nozzle)} nozzle needs at least ${mm(minimumSeedFeature)}. Increase the watermelon width or reduce the rind widths.`,
    });
  }

  const minimumSeedDepth = 3 * layer;
  if (seedDepth + EPSILON < minimumSeedDepth) {
    issues.push({
      path: "watermelon.thickness",
      message: `Seed inserts are ${mm(seedDepth)} deep. A ${mm(layer)} layer height needs at least ${mm(minimumSeedDepth)}. Increase the watermelon thickness.`,
    });
  }

  const seedOuterRadius =
    fleshRadius * SEED_ROW_RADIUS_FRACTION + seedMetrics.maxRadius;
  if (seedOuterRadius + derived.minColorWall > fleshRadius + EPSILON) {
    issues.push({
      path: "watermelon.width",
      message:
        "The seeds reach the white rind. Increase the watermelon width or reduce the rind widths.",
    });
  }

  // Complex retaining geometry must not touch the seeds. The slot and clip
  // envelope must be horizontally clear of every seed whose Y range overlaps
  // the pin slot.
  const clipLength = derived.pinRecp.retainerClip?.cavityLength ?? 0;
  const retentionMinX = -pin.length / 2 - clipLength;
  const retentionMaxX = pin.length / 2 + clipLength;

  for (let index = 0; index < SEED_COUNT; index += 1) {
    const seed = seedWorldBounds(
      fleshRadius,
      DEFAULT_SEED_ANGLE,
      SEED_START_ANGLE + index * SEED_STEP_ANGLE,
    );

    const overlapsSlotY =
      seed.maxY + derived.minSeedWall > derived.pinRecpOffset &&
      seed.minY - derived.minSeedWall <
        derived.pinRecpOffset + derived.slotWidth;
    if (!overlapsSlotY) continue;

    const clearLeft =
      seed.maxX + derived.minSeedWall <= retentionMinX + EPSILON;
    const clearRight =
      seed.minX - derived.minSeedWall >= retentionMaxX - EPSILON;
    if (!clearLeft && !clearRight) {
      issues.push({
        path: "watermelon.width",
        message:
          "A seed is too close to the retaining slot or clip. Increase the watermelon width, shorten the pin, or reduce the rind widths.",
      });
      break;
    }
  }

  // The side insertion slot runs beneath the seed pattern. Keep a printable
  // wall between the slot ceiling and the seed recess.
  const sideSlotGap = thickness - seedDepth - derived.slotDepth;
  if (sideSlotGap + EPSILON < derived.minSeedWall) {
    issues.push({
      path: "watermelon.thickness",
      message: `Only ${mm(sideSlotGap)} remains between the side insertion slot and the seed recess. A minimum of ${mm(derived.minSeedWall)} is required. Increase the watermelon thickness or reduce the pin thickness.`,
    });
  }

  // There must be a usable retaining tab region.
  const minimumTabLength = Math.max(3, 4 * nozzle);
  if (pin.length - derived.cutoutLength + EPSILON < minimumTabLength) {
    issues.push({
      path: "pin.length",
      message: `Pin is too short for a reliable retaining tab. It must be at least ${mm(derived.cutoutLength + minimumTabLength)}.`,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Runtime schema
// ---------------------------------------------------------------------------

/**
 * The runtime configuration schema. Adding a numeric property here makes it
 * appear in the configurator automatically.
 */
const definition: ConfigDefinition<WatermelonModelConfig> = {
  defaults: {
    watermelon: {
      width: 70,
      // Original arithmetic expression, kept as-is (evaluates to 3).
      thickness: 1 + 0.2 + 0.8 + 0.4 + 0.6,
      appearance: {
        outerRindWidth: 3,
        innerRindWidth: 2,
      },
    },
    pin: {
      length: 22,
      width: 5.5,
      thickness: 0.6,
      clearance: 0,
      retainingClip: true,
    },
    printer: {
      nozzleDiameter: 0.4,
      layerHeight: 0.2,
      bottomSlopes: true,
    },
  },
  metadata: {
    watermelon: {
      label: "Watermelon",
      fields: {
        width: {
          label: "Width",
          unit: "mm",
          step: 1,
          description:
            "Overall width across the flat back. The height is half of this value.",
        },
        thickness: {
          label: "Thickness",
          unit: "mm",
          step: 0.1,
        },
        appearance: {
          label: "Appearance",
          fields: {
            outerRindWidth: {
              label: "Outer rind width",
              unit: "mm",
              step: 0.1,
            },
            innerRindWidth: {
              label: "Inner rind width",
              unit: "mm",
              step: 0.1,
            },
          },
        },
      },
    },
    pin: {
      label: "Brooch pin",
      fields: {
        length: {
          label: "Pin length",
          unit: "mm",
          step: 1,
          description: "Length of the flat pin backing.",
        },
        width: {
          label: "Pin width",
          unit: "mm",
          step: 0.1,
          description: "Width of the flat pin backing.",
        },
        thickness: {
          label: "Pin thickness",
          unit: "mm",
          step: 0.05,
          description: "Thickness of the flat pin backing.",
        },
        clearance: {
          label: "Fit clearance",
          unit: "mm",
          step: 0.05,
          description:
            "Extra clearance per side. Try 0.1-0.2 mm if the pin is tight.",
        },
        retainingClip: {
          label: "Retaining clip",
          description:
            "Adds the rear retaining clip. Its side gaps are derived from the nozzle diameter.",
        },
      },
    },
    printer: {
      label: "Printer",
      fields: {
        nozzleDiameter: {
          label: "Nozzle diameter",
          unit: "mm",
          step: 0.05,
          description:
            "Used to derive minimum feature sizes and the retaining clip gaps.",
        },
        layerHeight: {
          label: "Layer height",
          unit: "mm",
          step: 0.05,
          description:
            "Used to derive minimum wall thicknesses and the bottom lead-in slope.",
        },
        bottomSlopes: {
          label: "Bottom lead-in slopes",
          description:
            "Adds the printable lower slope. Disable it for a more secure pin fit if your printer handles the overhang.",
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
