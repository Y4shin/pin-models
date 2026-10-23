<script lang="ts">
  import type { FormNode } from "../cad/types";
  import ConfigField from "./ConfigField.svelte";

  interface Props {
    nodes: FormNode[];
    onNumber: (path: string, rawValue: string) => void;
    onBoolean: (path: string, value: boolean) => void;
    onString: (path: string, value: string) => void;
    onToggle: (path: string, enabled: boolean) => void;
  }

  let { nodes, onNumber, onBoolean, onString, onToggle }: Props = $props();
</script>

<div class="config-panel">
  {#each nodes as node (node.path)}
    <ConfigField {node} {onNumber} {onBoolean} {onString} {onToggle} />
  {/each}
</div>

<style>
  .config-panel {
    display: grid;
    gap: 14px;
    padding: 4px 2px 12px;
  }
</style>
