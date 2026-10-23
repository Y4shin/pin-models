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

## Deployment

Pushes to `main` run `.github/workflows/deploy-pages.yml`. The workflow installs
dependencies, runs the checks and tests, builds the static site, and deploys it
to GitHub Pages:

https://y4shin.github.io/pin-models/

The GitHub Pages source is **GitHub Actions**. The workflow sets
`BASE_PATH=/<repository>` for the project-site URL. Local builds leave
`BASE_PATH` unset and use the site root.

## Architecture

```text
src/lib/cad/
  types.ts               generic config/model/form types
  config-form.ts         recursive UI generation, config building, validation
  models.ts              model registry (dropdown source and worker lookup)
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
  id: string;
  name: string;
  definition: { defaults: TConfig; metadata?: MetadataTree };
  generate(config: TConfig): ModelPart[];
  validate?(config: TConfig): ValidationIssue[];
}
```

The model dropdown is generated from `src/lib/cad/models.ts`. To add a model,
create its Replicad module and add it to the registry. The UI, worker selection,
preview, and export need no model-specific changes.

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
5. If you add a second model, register it in `src/lib/cad/models.ts`.

A numeric property added to the default configuration appears in the UI
automatically. Metadata is optional; it adds labels, units, bounds, steps,
descriptions, and optional field behavior.

### Current brooch configuration

```ts
watermelon: {
  width: 70,              // overall width across the flat back
  thickness: 3,
  appearance: {
    outerRindWidth: 3,
    innerRindWidth: 2,
  },
}
pin: {
  length: 22,
  width: 5.5,
  thickness: 0.6,
  clearance: 0,           // extra fit clearance per side
  retainingClip: true,
}
printer: {
  nozzleDiameter: 0.4,
  layerHeight: 0.2,
  bottomSlopes: true,     // printable lower lead-in slope
}
```

The detailed receptacle geometry is derived from these values in
`deriveGeometry`:

- Tab width and height: `2 × nozzleDiameter`.
- Bottom lead-in slope height: `tabWidth × layerHeight / nozzleDiameter`
  (0.4 mm for the defaults), or 0 when disabled.
- Retaining-clip side gap: at least one nozzle diameter and two layer heights.
- Clip thickness: two nozzle diameters. Clip cavity length stays 1.6 mm so it
  does not grow into the seed pattern.
- Pin offset from the flat back: derived, at least 1 mm.
- Seed angle 30°, seed depth 35% of the watermelon thickness.
- Side-insertion slot height: the pin channel depth only.

### Printer-aware constraints

Validation returns clear errors before geometry is generated. It includes:

- Positive finite dimensions and valid rind widths.
- A minimum top wall above the pin cavity.
- Retaining tabs and clip must fit across the pin slot.
- The retaining clip must have a side gap of at least one nozzle diameter.
- The retaining slot and clip must stay inside the red flesh. The straight
  side-insertion slot is intentionally allowed to cross the rind.
- Seed tips must be at least `2 × nozzleDiameter` wide and seed inserts at least
  three layers deep.
- A minimum red wall between the side-insertion slot and the seed recesses.
- The retaining slot and clip must stay clear of every seed whose Y range
  overlaps the pin slot.
- Layer height must not exceed the nozzle diameter.

### Optional and automatic fields (generic feature)

The generic UI still supports optional nested objects and calculated optional
numbers for other models. An optional nested object gets an enable checkbox and
retains its values while disabled. A calculated optional number uses metadata
`computeDefault` and is omitted from the generated config while its override is
off. A field that exists only in metadata must declare its type implicitly
through `computeDefault` or `defaultValue`.

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

- No configuration persistence; a page reload restores defaults. Switching
  models also resets the form to that model's defaults.
- No user-editable schema outside the model definition. TypeScript interfaces are
  not reflected at runtime.
- Metadata-only fields need an explicit `defaultValue` or `computeDefault`; a
  field absent from both defaults and metadata is not shown.
- Validation is analytic and printer-aware, but it is not a full print
  simulation. Geometry failures are still caught in the worker and reported
  without discarding the last valid preview.
- The straight side-insertion slot crosses the white/green rind by design. All
  complex retention and seed features are kept inside the red flesh.
- Preview tessellation is fixed at 0.08 mm / 0.35 rad tolerance. STL export uses
  finer tessellation (0.02 mm / 0.15 rad).
