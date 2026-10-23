<script lang="ts">
  import { onMount } from "svelte";

  import ConfigPanel from "../lib/components/ConfigPanel.svelte";
  import ModelViewer from "../lib/components/ModelViewer.svelte";
  import {
    buildEffectiveConfig,
    buildFormNodes,
    createFormState,
    validateConfigValues,
  } from "../lib/cad/config-form";
  import { downloadStlZip } from "../lib/cad/export";
  import { groupPartsByColor } from "../lib/cad/stl";
  import type { ConfigObject, FormNode } from "../lib/cad/types";
  import type { PreviewPart } from "../lib/cad/preview";
  import { CadWorkerClient } from "../lib/cad/worker-client";
  import { defaultModel, findModel, models } from "../lib/cad/models";

  let selectedModelId = $state(defaultModel.id);
  const model = $derived(findModel(selectedModelId) ?? defaultModel);
  let formState = $state(createFormState(defaultModel.definition));

  let previewParts = $state<PreviewPart[]>([]);
  let lastGeneratedKey = $state<string | null>(null);
  let updating = $state(false);
  let generationError = $state<string | null>(null);
  let exportError = $state<string | null>(null);
  let exporting = $state(false);
  let workerReady = $state(false);

  let client: CadWorkerClient | null = null;

  const formNodes = $derived(
    buildFormNodes(model.definition, formState),
  );
  const effectiveConfig = $derived(
    buildEffectiveConfig(model.definition, formState),
  );
  const configKey = $derived(`${model.id}::${JSON.stringify(effectiveConfig)}`);

  const genericIssues = $derived(
    validateConfigValues(model.definition, effectiveConfig),
  );
  const modelIssues = $derived(
    genericIssues.length > 0 ? [] : (model.validate?.(effectiveConfig) ?? []),
  );
  const issues = $derived([...genericIssues, ...modelIssues]);

  const canDownload = $derived(
    previewParts.length > 0 &&
      issues.length === 0 &&
      lastGeneratedKey !== null &&
      lastGeneratedKey === configKey,
  );

  const legend = $derived(
    groupPartsByColor(previewParts).map((group) => ({
      color: group.color,
      count: group.parts.length,
    })),
  );

  const triangleCount = $derived(
    previewParts.reduce((sum, part) => sum + part.indices.length / 3, 0),
  );

  function setValueAtPath(path: string, value: string | number | boolean) {
    const keys = path.split(".");
    let target: Record<string, unknown> = formState.values;
    for (let index = 0; index < keys.length - 1; index += 1) {
      const next = target[keys[index]];
      if (typeof next !== "object" || next === null) return;
      target = next as Record<string, unknown>;
    }
    target[keys[keys.length - 1]] = value;
  }

  function findNode(nodes: FormNode[], path: string): FormNode | undefined {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.kind === "group") {
        const found = findNode(node.children, path);
        if (found) return found;
      }
    }
    return undefined;
  }

  function handleNumber(path: string, rawValue: string) {
    setValueAtPath(path, rawValue);
  }

  function handleBoolean(path: string, value: boolean) {
    setValueAtPath(path, value);
  }

  function handleString(path: string, value: string) {
    setValueAtPath(path, value);
  }

  function handleToggle(path: string, enabled: boolean) {
    if (enabled) {
      const node = findNode(formNodes, path);
      if (node?.kind === "number" && node.optional && node.autoValue !== undefined) {
        // Start an override from the current automatic value, without
        // floating point noise such as 1.0499999999999998.
        setValueAtPath(path, Number(node.autoValue.toPrecision(12)));
      }
    }
    formState.disabled[path] = !enabled;
  }

  function handleModelChange(event: Event) {
    const nextId = (event.currentTarget as HTMLSelectElement).value;
    if (nextId === selectedModelId) return;
    const nextModel = findModel(nextId);
    if (!nextModel) return;

    selectedModelId = nextModel.id;
    formState = createFormState(nextModel.definition);
    lastGeneratedKey = null;
    generationError = null;
    exportError = null;
  }

  async function handleDownload() {
    if (!client || !canDownload || exporting) return;
    exporting = true;
    exportError = null;
    try {
      const files = await client.requestStlExport();
      if (!files.length) throw new Error("The export produced no STL files.");
      await downloadStlZip(model.name, files);
    } catch (error) {
      exportError = error instanceof Error ? error.message : String(error);
    } finally {
      exporting = false;
    }
  }

  $effect(() => {
    if (!workerReady || !client) return;

    // Read the reactive config values so this effect reruns on every edit.
    const snapshot = $state.snapshot(effectiveConfig) as ConfigObject;
    const key = configKey;

    if (issues.length > 0) {
      generationError = null;
      return;
    }

    generationError = null;
    const timer = setTimeout(() => {
      updating = true;
      client?.requestGeneration(model.id, snapshot, key);
    }, 200);

    return () => clearTimeout(timer);
  });

  onMount(() => {
    client = new CadWorkerClient({
      onPreview(parts, key) {
        previewParts = parts;
        lastGeneratedKey = key;
        generationError = null;
        updating = false;
      },
      onGenerationError(message) {
        generationError = message;
        updating = false;
      },
      onWorkerError(message) {
        generationError = message;
        updating = false;
      },
    });
    workerReady = true;

    return () => {
      workerReady = false;
      client?.terminate();
      client = null;
    };
  });
</script>

<svelte:head>
  <title>{model.name} Configurator</title>
</svelte:head>

<div class="app">
  <aside class="sidebar">
    <header class="sidebar-header">
      <h1>{model.name} configurator</h1>
      <p>Parametric, print-ready parts generated locally in your browser.</p>

      <div class="model-picker">
        <label for="model-select">Model</label>
        <select
          id="model-select"
          value={selectedModelId}
          onchange={handleModelChange}
        >
          {#each models as option (option.id)}
            <option value={option.id}>{option.name}</option>
          {/each}
        </select>
      </div>
    </header>

    <div class="sidebar-scroll">
      <ConfigPanel
        nodes={formNodes}
        onNumber={handleNumber}
        onBoolean={handleBoolean}
        onString={handleString}
        onToggle={handleToggle}
      />

      {#if issues.length > 0}
        <section class="messages error" aria-live="polite">
          <h2>Check the configuration</h2>
          <ul>
            {#each issues as issue (issue.path + issue.message)}
              <li>{issue.message}</li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if exportError}
        <section class="messages error" aria-live="polite">
          <h2>Export failed</h2>
          <p>{exportError}</p>
        </section>
      {/if}
    </div>

    <footer class="sidebar-footer">
      <button
        class="download-button"
        type="button"
        disabled={!canDownload || exporting}
        onclick={handleDownload}
      >
        {#if exporting}
          <span class="spinner" aria-hidden="true"></span>
          Preparing STLs…
        {:else}
          Download STLs
        {/if}
      </button>
      <p class="download-hint">
        {#if issues.length > 0}
          Fix the configuration errors to enable export.
        {:else if previewParts.length === 0}
          Waiting for the first model to be generated.
        {:else if lastGeneratedKey !== configKey}
          The preview is updating to match the current values.
        {:else}
          ZIP with one binary STL per color, aligned in the same coordinate system.
        {/if}
      </p>
    </footer>
  </aside>

  <main class="viewport">
    <ModelViewer parts={previewParts} />

    <div class="viewport-top">
      <div class="status-pill" class:busy={updating}>
        {#if updating}
          <span class="spinner" aria-hidden="true"></span>
          Generating geometry…
        {:else}
          <span class="status-dot" aria-hidden="true"></span>
          {previewParts.length > 0 ? "Preview ready" : "Starting CAD engine…"}
        {/if}
      </div>

      {#if legend.length > 0}
        <ul class="legend" aria-label="Model colors">
          {#each legend as entry (entry.color)}
            <li>
              <span
                class="swatch"
                style={`background: ${entry.color}`}
                aria-hidden="true"
              ></span>
              {entry.color}
              {#if entry.count > 1}<span class="count">×{entry.count}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if generationError}
      <div class="viewport-error" role="alert">
        <strong>Geometry generation failed</strong>
        <span>{generationError}</span>
      </div>
    {/if}

    {#if previewParts.length === 0 && !updating}
      <div class="empty-state">
        <p>Preparing the CAD engine and the default model…</p>
      </div>
    {/if}

    <div class="viewport-bottom">
      <span>
        {previewParts.length} parts · {Math.round(triangleCount).toLocaleString()} triangles
      </span>
      <span class="hint">Drag to rotate · scroll to zoom · right-drag to pan</span>
    </div>
  </main>
</div>

<style>
  :global(:root) {
    --bg: #f4f6f8;
    --surface: #ffffff;
    --surface-raised: #f8fafb;
    --border: #d5dce3;
    --border-soft: #e4e9ee;
    --text: #1f2933;
    --text-muted: #52606d;
    --text-faint: #7b8794;
    --accent: #0f766e;
    --accent-hover: #0b5d56;
    --error: #b42318;
    --error-bg: #fef3f2;
    --input-bg: #ffffff;
    --input-disabled-bg: #f1f4f6;

    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      Helvetica,
      Arial,
      sans-serif;
    color: var(--text);
    background: var(--bg);
    font-synthesis: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  :global(html, body) {
    margin: 0;
    padding: 0;
    height: 100%;
  }

  :global(body) {
    overflow: hidden;
  }

  .app {
    display: grid;
    grid-template-columns: minmax(320px, 1fr) minmax(0, 2fr);
    height: 100dvh;
    min-height: 0;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    border-right: 1px solid var(--border);
    box-shadow: 8px 0 24px rgb(15 23 42 / 4%);
    z-index: 2;
  }

  .sidebar-header {
    padding: 20px 20px 14px;
    border-bottom: 1px solid var(--border-soft);
  }

  .sidebar-header h1 {
    margin: 0;
    font-size: 1.2rem;
    font-weight: 680;
    letter-spacing: -0.01em;
  }

  .sidebar-header p {
    margin: 6px 0 0;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .model-picker {
    display: grid;
    gap: 5px;
    margin-top: 13px;
  }

  .model-picker label {
    font-size: 0.72rem;
    font-weight: 650;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .model-picker select {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--input-bg);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .model-picker select:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    border-color: transparent;
  }

  .sidebar-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 14px 18px 8px;
  }

  .sidebar-footer {
    padding: 14px 18px 18px;
    border-top: 1px solid var(--border-soft);
    background: linear-gradient(to bottom, rgb(255 255 255 / 70%), var(--surface) 30%);
  }

  .download-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    width: 100%;
    padding: 12px 16px;
    border: none;
    border-radius: 9px;
    background: var(--accent);
    color: #ffffff;
    font: inherit;
    font-size: 0.95rem;
    font-weight: 650;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition:
      background 120ms ease,
      transform 120ms ease,
      box-shadow 120ms ease;
    box-shadow: 0 1px 2px rgb(15 23 42 / 12%);
  }

  .download-button:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 4px 12px rgb(15 118 110 / 25%);
  }

  .download-button:active:not(:disabled) {
    transform: translateY(1px);
  }

  .download-button:disabled {
    background: #c7d0d8;
    color: #ffffff;
    cursor: not-allowed;
    box-shadow: none;
  }

  .download-hint {
    min-height: 2.4em;
    margin: 9px 2px 0;
    font-size: 0.74rem;
    line-height: 1.4;
    color: var(--text-faint);
  }

  .messages {
    margin-top: 14px;
    padding: 12px 14px;
    border-radius: 9px;
    font-size: 0.8rem;
    line-height: 1.45;
  }

  .messages.error {
    border: 1px solid #f4c7c3;
    background: var(--error-bg);
    color: #7a271a;
  }

  .messages h2 {
    margin: 0 0 6px;
    font-size: 0.82rem;
    font-weight: 650;
  }

  .messages p {
    margin: 0;
  }

  .messages ul {
    margin: 0;
    padding-left: 18px;
  }

  .messages li + li {
    margin-top: 3px;
  }

  .viewport {
    position: relative;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #e9edf2;
  }

  .viewport-top {
    position: absolute;
    top: 14px;
    left: 14px;
    right: 14px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    pointer-events: none;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    border: 1px solid rgb(255 255 255 / 80%);
    border-radius: 999px;
    background: rgb(255 255 255 / 82%);
    color: var(--text-muted);
    font-size: 0.76rem;
    font-weight: 550;
    backdrop-filter: blur(8px);
    box-shadow: 0 2px 8px rgb(15 23 42 / 6%);
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #12b76a;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px 12px;
    margin: 0;
    padding: 7px 12px;
    list-style: none;
    border: 1px solid rgb(255 255 255 / 80%);
    border-radius: 9px;
    background: rgb(255 255 255 / 78%);
    color: var(--text-muted);
    font-size: 0.74rem;
    font-weight: 550;
    backdrop-filter: blur(8px);
  }

  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-transform: capitalize;
  }

  .swatch {
    width: 10px;
    height: 10px;
    border: 1px solid rgb(15 23 42 / 18%);
    border-radius: 3px;
  }

  .count {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }

  .viewport-error {
    position: absolute;
    top: 62px;
    left: 50%;
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: min(560px, calc(100% - 40px));
    padding: 11px 15px;
    border: 1px solid #f4c7c3;
    border-radius: 9px;
    background: rgb(254 243 242 / 96%);
    color: #7a271a;
    font-size: 0.8rem;
    line-height: 1.4;
    transform: translateX(-50%);
    box-shadow: 0 6px 20px rgb(15 23 42 / 10%);
  }

  .empty-state {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-faint);
    font-size: 0.86rem;
    pointer-events: none;
  }

  .viewport-bottom {
    position: absolute;
    right: 14px;
    bottom: 12px;
    left: 14px;
    display: flex;
    justify-content: space-between;
    gap: 16px;
    color: var(--text-faint);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }

  .viewport-bottom .hint {
    text-align: right;
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgb(255 255 255 / 35%);
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 700ms linear infinite;
  }

  .status-pill .spinner {
    border-color: rgb(82 96 109 / 25%);
    border-top-color: var(--text-muted);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 900px) {
    :global(body) {
      overflow: auto;
    }

    .app {
      display: flex;
      flex-direction: column;
      height: auto;
      min-height: 100dvh;
    }

    /* Keep the model visible while the configuration scrolls underneath. */
    .viewport {
      order: -1;
      position: sticky;
      top: 0;
      z-index: 2;
      height: 42dvh;
      min-height: 240px;
      max-height: 420px;
      flex: 0 0 auto;
      z-index: 3;
      border-bottom: 1px solid var(--border);
      box-shadow: 0 8px 24px rgb(15 23 42 / 12%);
    }

    .sidebar {
      order: 0;
      z-index: 1;
      border-right: none;
      border-bottom: none;
      max-height: none;
    }

    .sidebar-scroll {
      overflow: visible;
    }

    .sidebar-footer {
      position: static;
    }
  }

  @media (max-width: 600px) {
    .sidebar-header {
      padding: 16px 16px 12px;
    }

    .sidebar-scroll {
      padding: 12px 14px 6px;
    }

    .sidebar-footer {
      padding: 12px 14px 14px;
    }

    .viewport-bottom .hint {
      display: none;
    }

    .legend {
      display: none;
    }
  }
</style>
