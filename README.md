# Parametric model configurator

Static SvelteKit configurator for the Replicad watermelon model. All CAD work,
tessellation, preview rendering, and STL export happen in the browser.

## Commands

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # Svelte + TypeScript checks
npm test         # geometry, validation, and export tests
npm run build    # static output in build/
npm run preview  # serve the production build
```

The production build is a static site (`@sveltejs/adapter-static`). No backend
or CAD service is required.

## Architecture

```text
src/lib/cad/
  types.ts               generic config/model/form types
  config-form.ts         recursive UI generation, config building, validation
  model/watermelon.ts    Replicad geometry, runtime schema, model metadata
  worker.ts              OpenCascade init, generation, tessellation, STL export
  worker-client.ts       single worker, request IDs, stale-response filtering
  stl.ts                 color grouping, filename generation, STL combination
  export.ts              ZIP packaging and browser download
src/lib/components/
  ConfigPanel.svelte     generic recursive config UI
  ConfigField.svelte     field renderer
  ModelViewer.svelte     Three.js orbit/zoom/pan preview
src/routes/+page.svelte  page state, debouncing, status, export action
```

The application only knows the generic `ParametricModel` contract:

```ts
interface ParametricModel<TConfig> {
  name: string;
  definition: { defaults: TConfig; metadata?: MetadataTree };
  generate(config: TConfig): ModelPart[];
  validate?(config: TConfig): ValidationIssue[];
}
```

`ModelPart` has `{ id, color, shape }`. The preview renders every returned part,
and the exporter groups parts by color. Adding parts, colors, or changing their
count does not require UI or export changes.

## Updating the model

1. Edit the geometry and configuration in Replicad Studio.
2. Copy the geometry functions and default configuration into
   `src/lib/cad/model/watermelon.ts`.
3. Keep the exported model object compatible with `ParametricModel`.
4. Adjust the optional metadata block if the update adds fields that are absent
   from the default configuration.

A numeric property added to the default configuration appears in the UI
automatically. Metadata is optional; it adds labels, units, bounds, steps,
descriptions, and optional field behavior.

### Optional and automatic fields

- An optional nested object (for example `retainerClip`) stays in the defaults
  and gets an enable checkbox. Disabling it removes it from the generated config
  while its values remain in the UI state.
- An optional number with a calculated default (for example `seedDepth`) is
  declared in metadata with `computeDefault` and is omitted from the generated
  config while its override checkbox is off. This keeps the calculation tied to
  the current values (35% of thickness).
- A field that exists only in metadata must declare its type implicitly through
  `computeDefault` or `defaultValue`; TypeScript types are not available at
  runtime.

## Export

The **Download STLs** button produces a ZIP with one binary STL per distinct
color. Parts of the same color are combined into one STL as disconnected shells.
For the current model this yields:

```text
watermelon-red.stl
watermelon-green.stl
watermelon-white.stl
watermelon-black.stl   # all five seeds
```

All files come from the CAD solids of the last successful generation, use the
same origin and coordinate system, and are not repositioned. The button is
disabled while the displayed configuration differs from the last successfully
generated geometry or while validation fails.

## Limitations

- No configuration persistence; a page reload restores defaults.
- No user-editable schema outside the model definition. TypeScript interfaces are
  not reflected at runtime.
- Metadata-only fields need an explicit `defaultValue` or `computeDefault`; a
  field absent from both defaults and metadata is not shown.
- Validation is intentionally lightweight. Geometry failures are still caught in
  the worker and reported without discarding the last valid preview.
- Preview tessellation is fixed at 0.08 mm / 0.35 rad tolerance. STL export uses
  finer tessellation (0.02 mm / 0.15 rad).
