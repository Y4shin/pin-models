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

  let lastDiagonal = 0;
  let frameId: number | null = null;
  const lastCenter = new THREE.Vector3();

  // Render on demand instead of running a continuous animation loop. This keeps
  // an idle viewer from consuming CPU/GPU time.
  function scheduleRender() {
    if (!renderer || !scene || !camera || !controls) return;
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      if (!renderer || !scene || !camera || !controls) return;
      const damping = controls.update();
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
        roughness: 0.52,
        metalness: 0.02,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = part.id;
      modelGroup.add(mesh);
    }

    frameModel(false);
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
    lastCenter.copy(sphere.center);

    const fov = THREE.MathUtils.degToRad(camera.fov);
    const direction = new THREE.Vector3(0.7, -1.05, 1.45).normalize();

    // Fit the projected bounding box, not the bounding sphere, so a flat part
    // fills the available viewport instead of looking tiny.
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), direction);
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
    distance *= 1.08;

    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    camera.near = Math.max(distance / 500, 0.01);
    camera.far = distance * 50;
    camera.updateProjectionMatrix();

    controls.target.copy(sphere.center);
    controls.minDistance = Math.max(sphere.radius * 0.05, 0.01);
    controls.maxDistance = distance * 20;
    controls.update();
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
    element.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9edf2);

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

    scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8595, 2.1));
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(60, -90, 120);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdfe8ff, 1.1);
    fillLight.position.set(-80, 70, 40);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.7);
    rimLight.position.set(20, 100, -60);
    scene.add(rimLight);

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
    };
  });
</script>

<div class="viewer" bind:this={container}></div>

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
</style>
