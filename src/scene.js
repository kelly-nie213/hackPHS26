// three.js city scene. World axes: x = east, y = up, z = south (three.js is right-handed, y-up).
// All inputs are in local meters (east, north) from geo.js.

import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const toWorld = (east, north, up = 0) => new THREE.Vector3(east, up, -north);

// Shapes are built in the (east, north) plane and extruded along +z; this turns that into y-up.
const LAY_FLAT = new THREE.Matrix4().makeRotationX(-Math.PI / 2);

const HEIGHT_COLORS = [
  [0, '#ece8df'],
  [100, '#d6cdbf'],
  [180, '#f0a35e'],
  [300, '#e4572e'],
  [450, '#a4161a'],
].map(([h, c]) => [h, new THREE.Color(c)]);

export function heightColor(height, out = new THREE.Color()) {
  for (let i = 1; i < HEIGHT_COLORS.length; i++) {
    const [h0, c0] = HEIGHT_COLORS[i - 1];
    const [h1, c1] = HEIGHT_COLORS[i];
    if (height <= h1) return out.lerpColors(c0, c1, Math.max(0, (height - h0) / (h1 - h0)));
  }
  return out.copy(HEIGHT_COLORS[HEIGHT_COLORS.length - 1][1]);
}

function ringToPoints(ring) {
  const pts = ring.map(([x, y]) => new THREE.Vector2(x, y));
  if (pts.length > 1 && pts[0].equals(pts[pts.length - 1])) pts.pop();
  return pts;
}

function polygonToShape(poly) {
  const shape = new THREE.Shape(ringToPoints(poly[0]));
  for (const hole of poly.slice(1)) shape.holes.push(new THREE.Path(ringToPoints(hole)));
  return shape;
}

function extrudeBuilding(b) {
  const g = new THREE.ExtrudeGeometry(b.polygons.map(polygonToShape), { depth: b.height, bevelEnabled: false });
  return g.applyMatrix4(LAY_FLAT);
}

/**
 * @param container DOM element to render into
 * @param radius    meters from the origin that the study area covers (sizes shadows, fog, sky)
 */
export function createCityScene(container, radius) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8ec5ff');
  scene.fog = new THREE.Fog(scene.background, radius * 1.2, radius * 4);

  const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 5, radius * 10);
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
  controls.minDistance = 100;
  controls.maxDistance = radius * 3;

  // Lighting: a sky/ground fill light plus the sun, which casts all the shadows.
  const hemi = new THREE.HemisphereLight('#dfefff', '#8a8170', 1);
  const sunLight = new THREE.DirectionalLight('#ffffff', 2.5);
  sunLight.castShadow = true;
  const mapSize = Math.min(4096, renderer.capabilities.maxTextureSize);
  sunLight.shadow.mapSize.set(mapSize, mapSize);
  Object.assign(sunLight.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 10, far: radius * 4 });
  sunLight.shadow.camera.updateProjectionMatrix();
  sunLight.shadow.bias = -0.0003;
  sunLight.shadow.normalBias = 1.5;
  scene.add(hemi, sunLight, sunLight.target);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 8, radius * 8),
    new THREE.MeshLambertMaterial({ color: '#d9d6cf' }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // The sun itself, drawn on a dome, plus today's path across the sky.
  const domeRadius = radius * 1.6;
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.035, 24, 16),
    new THREE.MeshBasicMaterial({ color: '#ffd34d', fog: false }),
  );
  const sunArc = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: '#ffcf5c', transparent: true, opacity: 0.7, fog: false }),
  );
  scene.add(sunDisc, sunArc);

  // Selected-building highlight: outline of the tower + its analytic ground shadow.
  const accent = new THREE.Color('#7c3aed');
  const selectionEdges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: accent }));
  const shadowFill = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      // Stay above the parks, which are themselves offset above the ground.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
  const shadowOutline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: accent }));
  shadowFill.position.y = shadowOutline.position.y = 1;
  scene.add(selectionEdges, shadowFill, shadowOutline);

  let buildingsMesh = null;
  let buildingStarts = []; // first vertex index of each building in the merged geometry
  let onFrame = null;

  function addParks(parks) {
    const geoms = parks.map((p) => new THREE.ShapeGeometry(p.polygons.map(polygonToShape)));
    const merged = mergeGeometries(geoms).applyMatrix4(LAY_FLAT);
    geoms.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(
      merged,
      new THREE.MeshLambertMaterial({ color: '#7cb36b', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    mesh.position.y = 0.05;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  /** Builds every footprint into one merged mesh (one draw call) colored by height. */
  function addBuildings(buildings) {
    const geoms = [];
    const color = new THREE.Color();
    let vertexCount = 0;
    buildingStarts = [];
    for (const b of buildings) {
      let g;
      try {
        g = extrudeBuilding(b);
      } catch {
        g = new THREE.BufferGeometry(); // malformed footprint: keep indices aligned, draw nothing
      }
      const n = g.attributes.position?.count ?? 0;
      heightColor(b.height, color);
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) color.toArray(colors, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      buildingStarts.push(vertexCount);
      vertexCount += n;
      if (n) geoms.push(g);
    }
    const merged = mergeGeometries(geoms);
    geoms.forEach((g) => g.dispose());
    buildingsMesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
    buildingsMesh.castShadow = true;
    buildingsMesh.receiveShadow = true;
    scene.add(buildingsMesh);
  }

  /**
   * @param dir       unit vector toward the sun {east, north, up}
   * @param lighting  {sun, ambient, sunColor, sky} intensities and THREE.Color values
   */
  function setSun(dir, lighting) {
    const toSun = toWorld(dir.east, dir.north, dir.up);
    sunLight.position.copy(toSun).multiplyScalar(radius * 2);
    sunLight.intensity = lighting.sun;
    sunLight.color.copy(lighting.sunColor);
    hemi.intensity = lighting.ambient;
    scene.background.copy(lighting.sky);
    scene.fog.color.copy(lighting.sky);
    sunDisc.position.copy(toSun).multiplyScalar(domeRadius);
    sunDisc.visible = dir.up > -0.02;
  }

  /** dirs: unit vectors toward the sun through the day (only those above the horizon are drawn). */
  function setSunPath(dirs) {
    const pts = dirs.filter((d) => d.up > -0.02).map((d) => toWorld(d.east, d.north, d.up).multiplyScalar(domeRadius));
    sunArc.geometry.dispose();
    sunArc.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  /** Outline the given buildings (empty array clears). */
  function setSelectedBuildings(list) {
    selectionEdges.geometry.dispose();
    if (!list.length) {
      selectionEdges.geometry = new THREE.BufferGeometry();
      return;
    }
    const edges = list.map((b) => {
      const solid = extrudeBuilding(b);
      const e = new THREE.EdgesGeometry(solid, 20);
      solid.dispose();
      return e;
    });
    selectionEdges.geometry = mergeGeometries(edges);
    edges.forEach((e) => e.dispose());
  }

  /** Draw ground polygons, each [[east, north], ...] (empty array clears). */
  function setShadowHighlight(rings) {
    shadowFill.geometry.dispose();
    shadowOutline.geometry.dispose();
    rings = rings.filter((r) => r.length >= 3);
    const shapes = rings.map((ring) => new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, y))));
    shadowFill.geometry = new THREE.ShapeGeometry(shapes).applyMatrix4(LAY_FLAT);
    // Closed outlines as segment pairs.
    const pts = rings.flatMap((ring) => ring.flatMap((p, i) => [toWorld(...p), toWorld(...ring[(i + 1) % ring.length])]));
    shadowOutline.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  /** Index of the building under a screen point, or -1. */
  const raycaster = new THREE.Raycaster();
  function pickBuilding(clientX, clientY) {
    if (!buildingsMesh) return -1;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(buildingsMesh)[0];
    if (!hit) return -1;
    // Binary search: last building whose first vertex is <= the hit vertex.
    let lo = 0;
    let hi = buildingStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (buildingStarts[mid] <= hit.face.a) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function lookAt(east, north, offset) {
    controls.target.copy(toWorld(east, north));
    camera.position.copy(controls.target).add(new THREE.Vector3(...offset));
    controls.update();
  }

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  renderer.setAnimationLoop((time) => {
    controls.update();
    onFrame?.(time);
    renderer.render(scene, camera);
  });

  return {
    canvas: renderer.domElement,
    addParks,
    addBuildings,
    setSun,
    setSunPath,
    setSelectedBuildings,
    setShadowHighlight,
    pickBuilding,
    lookAt,
    set onFrame(fn) {
      onFrame = fn;
    },
  };
}
