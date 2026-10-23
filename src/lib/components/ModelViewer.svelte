<script lang="ts">
  import { onMount } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  import type { PreviewPart } from "../cad/preview";

  interface Props {
    parts: PreviewPart[];
  }

  let { parts = [] }: Props = $props();

  let container: HTMLDivElement;
  let ready = $state(false);

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: OrbitControls | null = null;
  let modelGroup: THREE.Group | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let keyLight: THREE.DirectionalLight | null = null;
  let fillLight: THREE.DirectionalLight | null = null;
  let rimLight: THREE.DirectionalLight | null = null;
  let headLight: THREE.DirectionalLight | null = null;
  let bounceLight: THREE.DirectionalLight | null = null;

  let lastDiagonal = 0;
  let lastRadius = 1;
  let frameId: number | null = null;
  const lastCenter = new THREE.Vector3();
  const viewDirection = new THREE.Vector3(0.7, -1.05, 1.45).normalize();

  type ViewPreset = "iso" | "front" | "back" | "side" | "cavity";

  const viewPresets: { id: ViewPreset; label: string; direction: [number, number, number] }[] = [
    { id: "iso", label: "Iso", direction: [0.7, -1.05, 1.45] },
    { id: "front", label: "Front", direction: [0, -0.18, 1] },
    { id: "back", label: "Back", direction: [0, 0.18, -1] },
    { id: "side", label: "Side", direction: [1, 0.12, 0.22] },
    { id: "cavity", label: "Cavity", direction: [0.55, 0.2, -1] },
  ];

  let activeView = $state<ViewPreset | null>("iso");

  function setView(preset: ViewPreset) {
    const entry = viewPresets.find((item) => item.id === preset);
    if (!entry || !camera) return;
    viewDirection.set(...entry.direction).normalize();
    activeView = preset;
    const faceView =
      preset === "front" || preset === "back" || preset === "cavity";
    camera.up.set(0, faceView ? 1 : 0, faceView ? 0 : 1);
    if (preset === "cavity") {
      frameCavity();
    } else {
      frameModel(true);
    }
    scheduleRender();
  }

  /**
   * Keep the key light on the visible side, offset up and left so cavities
   * receive cast shadows instead of flat ambient fill.
   */
  function updateLights(center: THREE.Vector3, radius: number) {
    if (
      !camera ||
      !controls ||
      !keyLight ||
      !fillLight ||
      !rimLight ||
      !headLight ||
      !bounceLight
    ) {
      return;
    }

    const view = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, view);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(view, right).normalize();

    const keyDirection = view
      .clone()
      .addScaledVector(up, 0.72)
      .addScaledVector(right, 0.48)
      .normalize();
    keyLight.position.copy(center).addScaledVector(keyDirection, radius * 3);
    keyLight.target.position.copy(center);
    keyLight.target.updateMatrixWorld();

    const shadowExtent = radius * 1.45;
    keyLight.shadow.camera.left = -shadowExtent;
    keyLight.shadow.camera.right = shadowExtent;
    keyLight.shadow.camera.top = shadowExtent;
    keyLight.shadow.camera.bottom = -shadowExtent;
    keyLight.shadow.camera.near = Math.max(radius * 0.05, 0.01);
    keyLight.shadow.camera.far = radius * 8;
    keyLight.shadow.camera.updateProjectionMatrix();

    fillLight.position
      .copy(center)
      .addScaledVector(view, -radius * 2.4)
      .addScaledVector(right, -radius * 1.6)
      .addScaledVector(up, radius * 0.5);
    fillLight.target.position.copy(center);
    fillLight.target.updateMatrixWorld();

    rimLight.position
      .copy(center)
      .addScaledVector(view, -radius * 1.2)
      .addScaledVector(up, radius * 2.2)
      .addScaledVector(right, -radius * 0.4);
    rimLight.target.position.copy(center);
    rimLight.target.updateMatrixWorld();

    // A weak camera-side fill keeps the inside of the pin cavity readable
    // without flattening the cast shadows from the key light.
    headLight.position.copy(center).addScaledVector(view, radius * 2.2);
    headLight.target.position.copy(center);
    headLight.target.updateMatrixWorld();

    // Bounce light for the flat chord face, which faces away from the key.
    bounceLight.position
      .copy(center)
      .add(new THREE.Vector3(0, -1, 0.35).normalize().multiplyScalar(radius * 2.4));
    bounceLight.target.position.copy(center);
    bounceLight.target.updateMatrixWorld();
  }

  // Render on demand instead of running a continuous animation loop. This keeps
  // an idle viewer from consuming CPU/GPU time.
  function scheduleRender() {
    if (!renderer || !scene || !camera || !controls) return;
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      if (!renderer || !scene || !camera || !controls) return;
      const damping = controls.update();
      updateLights(controls.target, lastRadius);
      renderer.render(scene, camera);
      if (damping) scheduleRender();
    });
  }

  function disposeModel() {
    if (!modelGroup) return;
    for (const child of [...modelGroup.children]) {
      modelGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) material.dispose();
      }
    }
  }

  function updateModel(nextParts: PreviewPart[]) {
    if (!modelGroup) return;
    disposeModel();

    if (nextParts.length === 0) {
      lastDiagonal = 0;
      return;
    }

    for (const part of nextParts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(part.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(part.indices, 1));

      if (part.normals && part.normals.length === part.positions.length) {
        geometry.setAttribute("normal", new THREE.BufferAttribute(part.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color().set(part.color),
        roughness: 0.6,
        metalness: 0,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = part.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      modelGroup.add(mesh);
    }

    frameModel(false);
    if (activeView === "cavity") frameCavity();
    scheduleRender();
  }

  function frameModel(force: boolean) {
    if (!modelGroup || !camera || !controls) return;

    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const diagonal = size.length();
    const centerShift = sphere.center.distanceTo(lastCenter);

    const sizeChanged =
      lastDiagonal === 0 ||
      Math.abs(diagonal - lastDiagonal) / Math.max(lastDiagonal, 1e-6) > 0.1;
    const moved = lastDiagonal === 0 || centerShift > Math.max(lastDiagonal * 0.1, 0.5);

    if (!force && !sizeChanged && !moved) return;

    lastDiagonal = diagonal;
    lastRadius = sphere.radius;
    lastCenter.copy(sphere.center);

    const fov = THREE.MathUtils.degToRad(camera.fov);
    const direction = viewDirection.clone().normalize();

    // Fit the projected bounding box, not the bounding sphere, so a flat part
    // fills the available viewport instead of looking tiny.
    const right = new THREE.Vector3().crossVectors(camera.up, direction);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const tanVertical = Math.tan(fov / 2);
    const tanHorizontal = tanVertical * Math.max(camera.aspect, 0.1);

    let distance = 0;
    const corner = new THREE.Vector3();
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z).sub(sphere.center);
          const along = corner.dot(direction);
          distance = Math.max(
            distance,
            along + Math.abs(corner.dot(up)) / tanVertical,
            along + Math.abs(corner.dot(right)) / tanHorizontal,
          );
        }
      }
    }
    distance *= 1.18;

    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    camera.near = Math.max(distance / 500, 0.01);
    camera.far = distance * 50;
    camera.updateProjectionMatrix();

    controls.target.copy(sphere.center);
    controls.minDistance = Math.max(sphere.radius * 0.05, 0.01);
    controls.maxDistance = distance * 20;
    controls.update();
    updateLights(sphere.center, sphere.radius);
  }

  function frameCavity() {
    if (!modelGroup || !camera || !controls) return;

    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const focus = new THREE.Vector3(
      center.x,
      box.min.y + size.y * 0.13,
      box.min.z + size.z * 0.35,
    );
    const radius = Math.max(size.x * 0.24, size.y * 0.14, 10);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const distance = (radius / Math.tan(fov / 2)) * 1.35;
    const direction = new THREE.Vector3(0.2, 0.12, -1).normalize();

    camera.position.copy(focus).addScaledVector(direction, distance);
    camera.near = Math.max(distance / 500, 0.01);
    camera.far = distance * 50;
    camera.updateProjectionMatrix();

    controls.target.copy(focus);
    controls.minDistance = Math.max(radius * 0.1, 0.01);
    controls.maxDistance = distance * 10;
    controls.update();

    lastDiagonal = size.length();
    lastRadius = radius;
    lastCenter.copy(center);
    updateLights(focus, radius);
    scheduleRender();
  }

  $effect(() => {
    const currentParts = parts;
    if (!ready) return;
    updateModel(currentParts);
  });

  onMount(() => {
    const element = container;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(element.clientWidth, element.clientHeight, false);
    renderer.domElement.className = "viewer-canvas";
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    element.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe4e8ee);

    camera = new THREE.PerspectiveCamera(
      38,
      Math.max(element.clientWidth, 1) / Math.max(element.clientHeight, 1),
      0.1,
      100000,
    );
    camera.up.set(0, 0, 1);
    camera.position.set(80, -110, 90);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.zoomSpeed = 0.9;
    controls.target.set(0, 0, 0);
    controls.addEventListener("change", scheduleRender);
    controls.addEventListener("start", () => {
      activeView = null;
    });

    scene.add(new THREE.HemisphereLight(0xffffff, 0x4b5563, 0.4));
    scene.add(new THREE.AmbientLight(0xffffff, 0.16));

    keyLight = new THREE.DirectionalLight(0xfff2df, 2.6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0002;
    keyLight.shadow.normalBias = 0.02;
    keyLight.target = new THREE.Object3D();
    scene.add(keyLight.target);
    scene.add(keyLight);

    fillLight = new THREE.DirectionalLight(0xdfe8ff, 0.42);
    fillLight.target = new THREE.Object3D();
    scene.add(fillLight.target);
    scene.add(fillLight);

    rimLight = new THREE.DirectionalLight(0xffffff, 0.28);
    rimLight.target = new THREE.Object3D();
    scene.add(rimLight.target);
    scene.add(rimLight);

    headLight = new THREE.DirectionalLight(0xffffff, 0.5);
    headLight.target = new THREE.Object3D();
    scene.add(headLight.target);
    scene.add(headLight);

    bounceLight = new THREE.DirectionalLight(0xffe8d6, 0.32);
    bounceLight.target = new THREE.Object3D();
    scene.add(bounceLight.target);
    scene.add(bounceLight);

    modelGroup = new THREE.Group();
    scene.add(modelGroup);

    const resize = () => {
      if (!renderer || !camera) return;
      const width = Math.max(element.clientWidth, 1);
      const height = Math.max(element.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      scheduleRender();
    };

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element);

    scheduleRender();
    ready = true;

    return () => {
      ready = false;
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      controls?.removeEventListener("change", scheduleRender);
      disposeModel();
      controls?.dispose();
      controls = null;
      renderer?.dispose();
      renderer?.domElement.remove();
      renderer = null;
      scene = null;
      camera = null;
      modelGroup = null;
      keyLight = null;
      fillLight = null;
      rimLight = null;
      headLight = null;
      bounceLight = null;
    };
  });
</script>

<div class="viewer" bind:this={container}>
  <div class="view-presets" aria-label="Camera views">
    {#each viewPresets as preset (preset.id)}
      <button
        type="button"
        data-view={preset.id}
        class:active={activeView === preset.id}
        onclick={() => setView(preset.id)}
      >
        {preset.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .viewer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    touch-action: none;
  }

  .viewer :global(canvas.viewer-canvas) {
    display: block;
    width: 100%;
    height: 100%;
    outline: none;
  }

  .view-presets {
    position: absolute;
    top: 54px;
    left: 14px;
    display: flex;
    gap: 4px;
    padding: 4px;
    border: 1px solid rgb(255 255 255 / 80%);
    border-radius: 8px;
    background: rgb(255 255 255 / 78%);
    box-shadow: 0 2px 8px rgb(15 23 42 / 6%);
    backdrop-filter: blur(8px);
    z-index: 2;
  }

  .view-presets button {
    min-width: 42px;
    padding: 5px 8px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
  }

  .view-presets button:hover {
    background: rgb(15 23 42 / 6%);
    color: var(--text);
  }

  .view-presets button.active {
    background: var(--accent);
    color: #ffffff;
  }

  .view-presets button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  @media (max-width: 600px) {
    .view-presets {
      top: 48px;
      left: 10px;
    }

    .view-presets button {
      min-width: 0;
      padding: 5px 7px;
    }
  }
</style>
