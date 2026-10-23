<script lang="ts">
  import type { FormNode } from "../cad/types";
  import Self from "./ConfigField.svelte";

  interface Props {
    node: FormNode;
    onNumber: (path: string, rawValue: string) => void;
    onBoolean: (path: string, value: boolean) => void;
    onString: (path: string, value: string) => void;
    onToggle: (path: string, enabled: boolean) => void;
  }

  let { node, onNumber, onBoolean, onString, onToggle }: Props = $props();

  const inputId = $derived(`field-${node.path.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
  const displayValue = $derived(
    node.kind !== "number"
      ? ""
      : node.optional && !node.overridden
        ? node.autoValue !== undefined && Number.isFinite(node.autoValue)
          ? formatNumber(node.autoValue)
          : node.value
        : node.value,
  );
  const automatic = $derived(
    node.kind === "number" && node.optional && !node.overridden,
  );

  function formatNumber(value: number | undefined): string {
    if (value === undefined || !Number.isFinite(value)) return "—";
    // Avoid floating point noise such as 1.0499999999999998 in the input.
    return String(Number(value.toPrecision(12)));
  }
</script>

{#if node.kind === "group"}
  <fieldset
    class="group"
    class:optional={node.optional}
    class:off={node.optional && !node.enabled}
    class:nested={node.path.includes(".")}
  >
    <legend class="group-title">
      {#if node.optional}
        <label class="toggle">
          <input
            type="checkbox"
            checked={node.enabled}
            onchange={(event) => onToggle(node.path, event.currentTarget.checked)}
          />
          <span>{node.label}</span>
        </label>
      {:else}
        <span>{node.label}</span>
      {/if}
    </legend>

    {#if node.description}
      <p class="description">{node.description}</p>
    {/if}

    <div class="group-body">
      {#each node.children as child (child.path)}
        <Self
          node={child}
          {onNumber}
          {onBoolean}
          {onString}
          {onToggle}
        />
      {/each}
    </div>
  </fieldset>
{:else if node.kind === "number"}
  <div class="field" class:automatic>
    <div class="field-head">
      <label class="field-label" for={inputId}>
        {node.label}
        {#if node.unit}<span class="unit">{node.unit}</span>{/if}
      </label>

      {#if node.optional}
        <label class="override">
          <input
            type="checkbox"
            checked={node.overridden}
            onchange={(event) => onToggle(node.path, event.currentTarget.checked)}
          />
          <span>Override</span>
        </label>
      {/if}
    </div>

    {#if node.control === "slider"}
      <div class="range-row">
        <input
          id={inputId}
          class="range-input"
          type="range"
          step={node.step ?? 1}
          min={node.min ?? 0}
          max={node.max ?? 100}
          value={displayValue}
          disabled={automatic}
          oninput={(event) => onNumber(node.path, event.currentTarget.value)}
        />
        <output class="range-value" for={inputId}>
          {displayValue}{node.unit ? `${node.unit}` : ""}
        </output>
      </div>
    {:else}
      <input
        id={inputId}
        class="number-input"
        type="number"
        inputmode="decimal"
        step={node.step ?? "any"}
        min={node.min}
        max={node.max}
        value={displayValue}
        disabled={automatic}
        oninput={(event) => onNumber(node.path, event.currentTarget.value)}
      />
    {/if}

    {#if automatic}
      <p class="hint">
        Automatic value: {formatNumber(node.autoValue)}{node.unit ? ` ${node.unit}` : ""}
      </p>
    {/if}

    {#if node.description}
      <p class="description">{node.description}</p>
    {/if}
  </div>
{:else if node.kind === "boolean"}
  <label class="field checkbox-field">
    <input
      type="checkbox"
      checked={node.value}
      onchange={(event) => onBoolean(node.path, event.currentTarget.checked)}
    />
    <span class="field-label">{node.label}</span>
    {#if node.description}<span class="description">{node.description}</span>{/if}
  </label>
{:else}
  <div class="field">
    <label class="field-label" for={inputId}>
      {node.label}
      {#if node.unit}<span class="unit">{node.unit}</span>{/if}
    </label>
    <input
      id={inputId}
      class="text-input"
      type="text"
      value={node.value}
      oninput={(event) => onString(node.path, event.currentTarget.value)}
    />
    {#if node.description}
      <p class="description">{node.description}</p>
    {/if}
  </div>
{/if}

<style>
  .group {
    border: 1px solid var(--border);
    border-radius: 10px;
    margin: 0;
    padding: 14px 14px 12px;
    background: var(--surface);
    min-width: 0;
  }

  .group.nested {
    background: var(--surface-raised);
    border-color: var(--border-soft);
    padding: 12px;
  }

  .group.off {
    opacity: 0.62;
  }

  .group-title {
    padding: 0 6px;
    font-size: 0.82rem;
    font-weight: 650;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .group-body {
    display: grid;
    gap: 12px;
    margin-top: 4px;
  }

  .field {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .field-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .field-label {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-size: 0.86rem;
    font-weight: 550;
    color: var(--text);
  }

  .unit {
    color: var(--text-faint);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .number-input,
  .text-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--input-bg);
    color: var(--text);
    font: inherit;
    font-variant-numeric: tabular-nums;
    font-size: 0.9rem;
  }

  .range-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .range-input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .range-value {
    min-width: 3.6em;
    color: var(--text-muted);
    font-size: 0.84rem;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .number-input:focus,
  .text-input:focus,
  .range-input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-color: transparent;
  }

  .number-input:disabled {
    color: var(--text-faint);
    background: var(--input-disabled-bg);
    cursor: not-allowed;
  }

  .override,
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 0.78rem;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
  }

  .override input,
  .toggle input {
    margin: 0;
    accent-color: var(--accent);
  }

  .toggle {
    font-size: 0.82rem;
    font-weight: 650;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .checkbox-field {
    grid-template-columns: auto 1fr;
    align-items: center;
    column-gap: 10px;
  }

  .checkbox-field input {
    accent-color: var(--accent);
  }

  .checkbox-field .description {
    grid-column: 2;
  }

  .description,
  .hint {
    margin: 0;
    font-size: 0.76rem;
    line-height: 1.4;
    color: var(--text-faint);
  }

  .hint {
    font-variant-numeric: tabular-nums;
  }
</style>
