import * as THREE from 'three';

export function createOrbitWatch(container, onSelect) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#050b18');
  const camera = new THREE.PerspectiveCamera(42, container.clientWidth / container.clientHeight, .1, 100); camera.position.set(0, 2.5, 8);
  const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(container.clientWidth, container.clientHeight); container.appendChild(renderer.domElement);
  scene.add(new THREE.AmbientLight('#7896b4', 1.6)); const earth = new THREE.Mesh(new THREE.SphereGeometry(2, 40, 24), new THREE.MeshPhongMaterial({ color: '#174a70', emissive: '#06192b', shininess: 15 })); scene.add(earth);
  const grid = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(2.04, 16, 8)), new THREE.LineBasicMaterial({ color: '#45b6ca', transparent: true, opacity: .24 })); scene.add(grid);
  const groups = { active: new THREE.Group(), debris: new THREE.Group(), station: new THREE.Group() }; Object.values(groups).forEach((g) => scene.add(g));
  const items = []; const colors = { active: '#35e69a', debris: '#f05d67', station: '#f6b84b' };
  for (let i = 0; i < 110; i++) { const type = i % 7 === 0 ? 'debris' : i % 31 === 0 ? 'station' : 'active'; const orbit = 2.55 + (i % 9) * .16; const dot = new THREE.Mesh(new THREE.SphereGeometry(type === 'station' ? .075 : .035, 7, 5), new THREE.MeshBasicMaterial({ color: colors[type] })); const angle = (i * 2.41) % (Math.PI * 2); dot.position.set(Math.cos(angle) * orbit, Math.sin(angle * 1.7) * .55, Math.sin(angle) * orbit); dot.userData = { id: type === 'debris' ? `DEB-${441 + i}` : type === 'station' ? 'ISS' : `SAT-${1000 + i}`, type, altitude: Math.round((orbit - 2) * 300 + 250) }; groups[type].add(dot); items.push(dot); }
  const trails = [2.7, 3.1, 3.5].map((r, i) => { const pts = []; for (let n = 0; n <= 64; n++) { const a = (n / 64) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a * (i + 1)) * .5, Math.sin(a) * r)); } const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: colors[i === 1 ? 'debris' : 'active'], transparent: true, opacity: .18 })); scene.add(line); return line; });
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); const click = (event) => { const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(items)[0]; if (hit) onSelect?.(hit.object.userData); }; renderer.domElement.addEventListener('click', click);
  let speed = 1, frame; const animate = () => { earth.rotation.y += .0015 * speed; grid.rotation.y += .0015 * speed; Object.values(groups).forEach((g, gi) => { g.rotation.y += (.002 + gi * .001) * speed; }); renderer.render(scene, camera); frame = requestAnimationFrame(animate); }; frame = requestAnimationFrame(animate);
  const resize = () => { camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight); }; window.addEventListener('resize', resize);
  const setSpeed = (v) => { speed = +v; }; const setFilter = (type, visible) => { groups[type].visible = visible; };
  const loadLiveCatalog = async () => {
    const ids = [25544, 20580, 44713, 43013];
    const records = await Promise.all(ids.map(async (id) => {
      const response = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=JSON`);
      if (!response.ok) throw new Error(`CelesTrak HTTP ${response.status}`);
      const json = await response.json();
      return Array.isArray(json) ? json : [json];
    }));
    return records.flat();
  };
  return { setSpeed, setFilter, loadLiveCatalog, items, dispose() { cancelAnimationFrame(frame); renderer.domElement.removeEventListener('click', click); window.removeEventListener('resize', resize); renderer.dispose(); container.replaceChildren(); } };
}
