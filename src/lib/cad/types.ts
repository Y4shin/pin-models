import type { Shape3D } from "replicad";

/**
 * A plain, JSON-serializable configuration value.
 * Configuration objects mirror the shape of the model's default configuration.
 */
export type ConfigPrimitive = number | boolean | string;

export type ConfigValue = ConfigPrimitive | ConfigObject;

export interface ConfigObject {
  [key: string]: ConfigValue;
}

/**
 * Optional metadata for a configuration field.
 *
 * Metadata is deliberately optional: a numeric field that is present in the
 * default configuration gets a numeric input without any metadata. Metadata only
 * adds presentation hints and describes fields that are not part of the default
 * configuration (for example automatic or optional values).
 */
export interface FieldMetadata {
  /** Human readable label. Defaults to a label derived from the property name. */
  label?: string;
  description?: string;
  /** Unit shown next to the field, for example "mm" or "°". */
  unit?: string;
  /** Lower bound for numeric inputs. */
  min?: number;
  /** Upper bound for numeric inputs. */
  max?: number;
  /** Step for numeric inputs. Defaults to "any". */
  step?: number;
  /** Optional control hint for numeric fields. */
  control?: "number" | "slider";
  /**
   * Marks an object or number as optional. Optional objects get an
   * enable/disable checkbox. Optional numbers get an override checkbox and are
   * omitted from the generated configuration while the override is disabled.
   */
  optional?: boolean;
  /**
   * Fallback value for a field that is not present in the default configuration.
   * Ignored when the field has a `computeDefault`.
   */
  defaultValue?: ConfigPrimitive;
  /**
   * Computes an automatic value for an optional number. Called with the
   * enclosing configuration object.
   */
  computeDefault?: (parent: ConfigObject) => number;
}

export interface FieldMetadataNode extends FieldMetadata {
  /** Child metadata for nested configuration objects. */
  fields?: MetadataTree;
}

export type MetadataTree = Record<string, FieldMetadataNode>;

/** The runtime configuration schema: default values plus optional metadata. */
export interface ConfigDefinition<TConfig extends ConfigObject = ConfigObject> {
  defaults: TConfig;
  metadata?: MetadataTree;
}

export interface ValidationIssue {
  /** Dot separated configuration path, for example "watermelon.radius". */
  path: string;
  message: string;
}

/** One generated CAD part with a stable identifier and a color assignment. */
export interface ModelPart {
  id: string;
  color: string;
  shape: Shape3D;
}

/**
 * A parametric model. `definition` is the single source of truth for the
 * configuration and the generated UI; `generate` is the only model-specific
 * CAD entry point.
 */
export interface ParametricModel<TConfig extends ConfigObject = ConfigObject> {
  /** Stable, URL-safe identifier used to select the model in the UI and worker. */
  id: string;
  name: string;
  definition: ConfigDefinition<TConfig>;
  generate(config: TConfig): ModelPart[];
  /** Optional extra validation. Called only when generic validation passed. */
  validate?(config: TConfig): ValidationIssue[];
}

/** Heterogeneous model handle used by the generic UI and worker. */
export type AnyParametricModel = ParametricModel<any>;

export interface FormNodeBase {
  key: string;
  path: string;
  label: string;
  description?: string;
  unit?: string;
}

export interface FormGroupNode extends FormNodeBase {
  kind: "group";
  optional: boolean;
  enabled: boolean;
  children: FormNode[];
}

export interface FormNumberNode extends FormNodeBase {
  kind: "number";
  value: number | string;
  control: "number" | "slider";
  min?: number;
  max?: number;
  step?: number;
  optional: boolean;
  overridden: boolean;
  /** Automatic value for optional numbers, when a computeDefault is defined. */
  autoValue?: number;
}

export interface FormBooleanNode extends FormNodeBase {
  kind: "boolean";
  value: boolean;
}

export interface FormStringNode extends FormNodeBase {
  kind: "string";
  value: string;
}

export type FormNode = FormGroupNode | FormNumberNode | FormBooleanNode | FormStringNode;
