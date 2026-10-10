import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

// 3D educational sky view: stars, constellations, Sun, Moon, planets, and a skyline horizon.
export function createSkyMap(container, onObject) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#050b1d');
  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, .1, 300); camera.position.set(0, 6, 14);
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(container.clientWidth, container.clientHeight); container.appendChild(renderer.domElement);
  const controls = new MapControls(camera, renderer.domElement); controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 7; controls.maxDistance = 22; controls.maxPolarAngle = Math.PI * .49;
  scene.add(new THREE.AmbientLight('#233b6a', 1.2));
  const stars = []; const starGeometry = new THREE.BufferGeometry(); const positions = new Float32Array(900 * 3); for (let i = 0; i < 900; i++) { const theta = Math.random() * Math.PI * 2; const phi = Math.acos(Math.random() * .9); const r = 80; positions[i * 3] = r * Math.sin(phi) * Math.cos(theta); positions[i * 3 + 1] = r * Math.cos(phi); positions[i * 3 + 2] = -r * Math.sin(phi) * Math.sin(theta); } starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#f5f3df', size: .36, sizeAttenuation: false })));
  const horizon = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, .2, 48), new THREE.MeshBasicMaterial({ color: '#14263d', transparent: true, opacity: .85 })); horizon.position.y = -.1; scene.add(horizon);
  const skyline = new THREE.Mesh(new THREE.CylinderGeometry(8.3, 8.3, 2, 32, 1, true), new THREE.MeshBasicMaterial({ color: '#07101d', side: THREE.DoubleSide })); skyline.position.y = .4; scene.add(skyline);
  const objects = []; const objectByName = new Map();
  const addObject = (name, color, position, size = .25) => { const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 8), new THREE.MeshBasicMaterial({ color })); mesh.position.set(...position); mesh.userData = { name }; scene.add(mesh); objects.push(mesh); objectByName.set(name, mesh); return mesh; };
  const sun = addObject('Sun · seasonal path', '#f6b84b', [4, 6, -7], .48); const moon = addObject('Moon · observation target', '#dbeafe', [-5, 5, -8], .3); addObject('Mars · planet candidate', '#e4575b', [7, 3.5, -5], .22); addObject('ISS · satellite pass', '#35e69a', [-7, 2.8, -4], .16);
  const constellations = new THREE.Group(); scene.add(constellations);
  const constellationData = [
    ['ORION', [[-3, 5, -8], [-2, 4, -8], [-1, 5, -8], [0, 4, -8], [-1, 3, -8], [-2, 3.5, -8]]],
    ['BIG DIPPER', [[3, 6, -7], [4, 5.5, -7], [5, 5.8, -7], [5.7, 5, -7], [4.8, 4.4, -7], [3.8, 4.6, -7], [3, 5, -7]]],
    ['CASSIOPEIA', [[-5, 7, -6], [-4, 7.6, -6], [-3, 7, -6], [-2, 7.6, -6], [-1, 7, -6]]],
  ];
  const constellationLabels = [];
  for (const [name, points] of constellationData) { const geometry = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p))); const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#67e8f9', transparent: true, opacity: .8 })); constellations.add(line); for (const p of points) { const star = new THREE.Mesh(new THREE.SphereGeometry(.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#d8ffff' })); star.position.set(...p); constellations.add(star); } const label = document.createElement('div'); label.textContent = name; label.className = 'constellation-label'; label.dataset.name = name; constellationLabels.push(label); }
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); const click = (event) => { const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(objects)[0]; if (hit) onObject?.(hit.object.userData.name); }; renderer.domElement.addEventListener('click', click);
  let frame; const animate = () => { controls.update(); sun.rotation.y += .01; renderer.render(scene, camera); frame = requestAnimationFrame(animate); }; frame = requestAnimationFrame(animate);
  const resize = () => { camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight); }; window.addEventListener('resize', resize);
  return { setAltitude(value) { const a = (+value / 80) * 1.3; sun.position.set(Math.sin(a) * 7, Math.max(1, Math.cos(a) * 7), -6); }, setLocation(latitude, longitude) { constellations.rotation.y = (longitude / 180) * Math.PI; constellations.rotation.x = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(latitude, -70, 70) * .28); }, selectObject(name) { const mesh = objectByName.get(name); if (mesh) onObject?.(name); }, dispose() { cancelAnimationFrame(frame); renderer.domElement.removeEventListener('click', click); window.removeEventListener('resize', resize); controls.dispose(); renderer.dispose(); container.replaceChildren(); } };
}
