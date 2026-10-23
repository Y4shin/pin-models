import type {
  ConfigDefinition,
  ConfigObject,
  ConfigValue,
  FieldMetadataNode,
  FormNode,
  MetadataTree,
  ValidationIssue,
} from "./types";

export function isPlainObject(value: unknown): value is ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

/** Turns `innerRindWidth` into "Inner rind width". */
export function humanizeLabel(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function labelForPath(definition: ConfigDefinition, path: string): string {
  const parts = path.split(".");
  let metadata: MetadataTree | undefined = definition.metadata;
  let defaults: ConfigValue | undefined = definition.defaults;
  let leafMetadata: FieldMetadataNode | undefined;
  let leafKey = parts[parts.length - 1] ?? path;

  for (const part of parts) {
    leafMetadata = metadata?.[part];
    leafKey = part;
    defaults = isPlainObject(defaults) ? defaults[part] : undefined;
    metadata = leafMetadata?.fields;
  }

  return leafMetadata?.label ?? humanizeLabel(leafKey);
}

export interface FormState {
  values: ConfigObject;
  /** Paths that are currently disabled and therefore omitted from the config. */
  disabled: Record<string, boolean>;
}

export interface ExportedField {
  path: string;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  optional: boolean;
}

/** Numeric paths in the definition, used for validation and tests. */
export function describeNumericFields(definition: ConfigDefinition): ExportedField[] {
  const result: ExportedField[] = [];

  function walk(
    values: ConfigObject,
    defaults: ConfigValue | undefined,
    metadata: MetadataTree | undefined,
    prefix: string,
  ) {
    for (const [key, value] of Object.entries(values)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const meta = metadata?.[key];
      const defaultNode = isPlainObject(defaults) ? defaults[key] : undefined;

      if (isPlainObject(value)) {
        walk(value, defaultNode, meta?.fields, path);
        continue;
      }

      const numeric =
        typeof defaultNode === "number" ||
        typeof meta?.defaultValue === "number" ||
        meta?.computeDefault !== undefined;

      if (!numeric) continue;

      result.push({
        path,
        label: meta?.label ?? humanizeLabel(key),
        unit: meta?.unit,
        min: meta?.min,
        max: meta?.max,
        step: meta?.step,
        optional: meta?.optional === true || !(isPlainObject(defaults) && key in defaults),
      });
    }
  }

  const state = createFormState(definition);
  walk(state.values, definition.defaults, definition.metadata, "");
  return result;
}

function safeComputeDefault(
  meta: FieldMetadataNode,
  parent: ConfigObject,
): number | undefined {
  if (!meta.computeDefault) return undefined;
  try {
    const value = meta.computeDefault(parent);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function initialValueForMissingField(
  meta: FieldMetadataNode | undefined,
  parent: ConfigObject,
): ConfigValue {
  if (!meta) return 0;
  if (meta.fields) return {};
  if (meta.computeDefault) {
    return safeComputeDefault(meta, parent) ?? 0;
  }
  if (meta.defaultValue !== undefined) return meta.defaultValue;
  return 0;
}

function applyMetadataDefaults(
  values: ConfigObject,
  metadata: MetadataTree | undefined,
  prefix: string,
  disabled: Record<string, boolean>,
) {
  if (!metadata) return;

  for (const [key, meta] of Object.entries(metadata)) {
    const path = prefix ? `${prefix}.${key}` : key;
    let value = values[key];

    if (value === undefined) {
      value = initialValueForMissingField(meta, values);
      values[key] = value;
      disabled[path] = true;
    }

    if (isPlainObject(value)) {
      applyMetadataDefaults(value, meta.fields, path, disabled);
    }
  }
}

/**
 * Builds the editable state from the definition. Fields that only exist in the
 * metadata (automatic or optional fields) are initialized and disabled, so the
 * generated configuration initially equals the model's default configuration.
 */
export function createFormState(definition: ConfigDefinition): FormState {
  const values = deepClone(definition.defaults) as ConfigObject;
  const disabled: Record<string, boolean> = {};
  applyMetadataDefaults(values, definition.metadata, "", disabled);
  return { values, disabled };
}

function parseNumber(value: ConfigValue | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return Number.NaN;
  if (typeof value !== "string" || value.trim() === "") return Number.NaN;
  return Number(value);
}

function expectsNumber(
  meta: FieldMetadataNode | undefined,
  defaultNode: ConfigValue | undefined,
): boolean {
  return (
    typeof defaultNode === "number" ||
    typeof meta?.defaultValue === "number" ||
    meta?.computeDefault !== undefined
  );
}

function buildNodes(
  values: ConfigObject,
  defaults: ConfigValue | undefined,
  metadata: MetadataTree | undefined,
  prefix: string,
  registeredDisabled: Record<string, boolean>,
): FormNode[] {
  const nodes: FormNode[] = [];

  for (const [key, value] of Object.entries(values)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const meta = metadata?.[key];
    const defaultNode = isPlainObject(defaults) ? defaults[key] : undefined;
    const common = {
      key,
      path,
      label: meta?.label ?? humanizeLabel(key),
      description: meta?.description,
      unit: meta?.unit,
    };

    if (isPlainObject(value)) {
      const optional = meta?.optional === true || !(isPlainObject(defaults) && key in defaults);
      nodes.push({
        ...common,
        kind: "group",
        optional,
        enabled: !registeredDisabled[path],
        children: buildNodes(value, defaultNode, meta?.fields, path, registeredDisabled),
      });
      continue;
    }

    if (expectsNumber(meta, defaultNode)) {
      const optional = meta?.optional === true || !(isPlainObject(defaults) && key in defaults);
      nodes.push({
        ...common,
        kind: "number",
        value: typeof value === "boolean" ? Number(value) : value,
        min: meta?.min,
        max: meta?.max,
        step: meta?.step,
        optional,
        overridden: !registeredDisabled[path],
        autoValue: meta ? safeComputeDefault(meta, values) : undefined,
      });
      continue;
    }

    if (typeof value === "boolean") {
      nodes.push({ ...common, kind: "boolean", value });
      continue;
    }

    nodes.push({ ...common, kind: "string", value: String(value) });
  }

  return nodes;
}

/** Builds the recursive UI tree. No model-specific knowledge is used. */
export function buildFormNodes(
  definition: ConfigDefinition,
  state: FormState,
): FormNode[] {
  return buildNodes(state.values, definition.defaults, definition.metadata, "", state.disabled);
}

function pruneDisabled(
  values: ConfigObject,
  disabled: Record<string, boolean>,
  prefix: string,
): ConfigObject {
  const result: ConfigObject = {};

  for (const [key, value] of Object.entries(values)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (disabled[path]) continue;

    if (isPlainObject(value)) {
      result[key] = pruneDisabled(value, disabled, path);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function coerce(
  value: ConfigValue,
  meta: FieldMetadataNode | undefined,
  defaultNode: ConfigValue | undefined,
): ConfigValue {
  if (isPlainObject(value)) {
    const result: ConfigObject = {};
    for (const [key, child] of Object.entries(value)) {
      const childDefault = isPlainObject(defaultNode) ? defaultNode[key] : undefined;
      result[key] = coerce(child, meta?.fields?.[key], childDefault);
    }
    return result;
  }

  if (expectsNumber(meta, defaultNode)) {
    const parsed = parseNumber(value);
    // NaN is kept so validation can report it instead of silently writing 0.
    return Number.isNaN(parsed) ? Number.NaN : parsed;
  }

  if (typeof defaultNode === "boolean") return Boolean(value);
  return typeof value === "string" ? value : String(value);
}

/**
 * Produces the JSON-serializable configuration passed to CAD generation:
 * disabled optional fields are removed, numeric inputs are parsed.
 */
export function buildEffectiveConfig(
  definition: ConfigDefinition,
  state: FormState,
): ConfigObject {
  const pruned = pruneDisabled(state.values, state.disabled, "");
  return coerce(pruned, { fields: definition.metadata }, definition.defaults) as ConfigObject;
}

/** Generic validation: finite numbers and optional metadata bounds. */
export function validateConfigValues(
  definition: ConfigDefinition,
  config: ConfigObject,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function walk(
    values: ConfigObject,
    metadata: MetadataTree | undefined,
    defaults: ConfigValue | undefined,
    prefix: string,
  ) {
    for (const [key, value] of Object.entries(values)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const meta = metadata?.[key];
      const defaultNode = isPlainObject(defaults) ? defaults[key] : undefined;
      const label = meta?.label ?? humanizeLabel(key);

      if (isPlainObject(value)) {
        walk(value, meta?.fields, defaultNode, path);
        continue;
      }

      if (!expectsNumber(meta, defaultNode)) continue;

      const parsed = parseNumber(value);
      const unit = meta?.unit ? ` ${meta.unit}` : "";

      if (!Number.isFinite(parsed)) {
        issues.push({ path, message: `${label} must be a finite number.` });
        continue;
      }

      if (meta?.min !== undefined && parsed < meta.min) {
        issues.push({
          path,
          message: `${label} must be at least ${meta.min}${unit}.`,
        });
      }

      if (meta?.max !== undefined && parsed > meta.max) {
        issues.push({
          path,
          message: `${label} must be at most ${meta.max}${unit}.`,
        });
      }
    }
  }

  walk(config, definition.metadata, definition.defaults, "");
  return issues;
}

export function labelForIssue(definition: ConfigDefinition, issue: ValidationIssue): string {
  return labelForPath(definition, issue.path);
}
