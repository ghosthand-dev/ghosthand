// Accessories the mascot can wear. Each one is a function returning a THREE.Group in head-local
// units (head radius 1, x right, y down, z toward the viewer). Pick one in MASCOT_CONFIG.accessory
// (index.html). To add one, register a new builder here; a glTF model works too: load it into
// a Group and scale it to head units.
;(function () {
  const GREEN = "#0aa263"
  const mat = (color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })

  function headset({ color = GREEN } = {}) {
    const m = mat(color)
    const g = new THREE.Group()

    // band: an arc around the top of the head, in the plane of both ears
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.17, 0.1, 12, 64, (208 * Math.PI) / 180), m)
    band.rotation.z = Math.PI - (14 * Math.PI) / 180 // y is down: arc from below the left ear over the top
    band.position.y = -0.03
    g.add(band)

    // ear cups: flattened ellipsoids facing out of each ear
    for (const side of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), m)
      cup.scale.set(0.2, 0.52, 0.34)
      cup.position.set(side * 1.15, 0.06, 0)
      g.add(cup)
    }

    // mic boom from the left cup to a capsule in front of the mouth
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-1.02, 0.24, 0.12),
      new THREE.Vector3(-0.8, 0.4, 0.5),
      new THREE.Vector3(-0.46, 0.36, 0.8),
    )
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.045, 8), m))
    const mic = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), m)
    mic.scale.set(0.22, 0.14, 0.14)
    mic.position.copy(curve.getPoint(1))
    mic.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), curve.getTangent(1))
    g.add(mic)
    return g
  }

  // example swap: a baseball cap with the brim over the eyes
  function cap({ color = GREEN } = {}) {
    const m = mat(color)
    const g = new THREE.Group()
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.04, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.42), m)
    crown.rotation.x = Math.PI + 0.35 // y is down: dome on top, tipped back
    g.add(crown)
    const brim = new THREE.Mesh(new THREE.CircleGeometry(0.62, 40, 0, Math.PI), m)
    brim.rotation.x = Math.PI / 2 + 0.3 // the half disc sticks out forward, tipped down
    brim.position.set(0, -0.5, 0.86)
    g.add(brim)
    return g
  }

  // a gold crown sitting on top of the head, tipped back a little
  function crown({ color = "#f6c324", inner = "#c98d0c", gem = "#e5484d" } = {}) {
    const front = new THREE.MeshBasicMaterial({ color, side: THREE.FrontSide })
    const back = new THREE.MeshBasicMaterial({ color: inner, side: THREE.BackSide })
    const g = new THREE.Group()
    const RING_R = 0.68
    const RING_H = 0.3
    const SPIKES = 8

    const ring = new THREE.CylinderGeometry(RING_R, RING_R * 0.92, RING_H, 48, 1, true)
    const band = new THREE.Group()
    band.add(new THREE.Mesh(ring, front), new THREE.Mesh(ring, back))
    g.add(band)

    // y is down: spikes point toward -y, standing on the ring's top edge
    for (let i = 0; i < SPIKES; i++) {
      const a = (i / SPIKES) * Math.PI * 2
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 4, 1, true), front)
      spike.rotation.set(Math.PI, a, 0)
      spike.position.set(Math.sin(a) * RING_R, -RING_H / 2 - 0.2, Math.cos(a) * RING_R)
      g.add(spike)
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), front)
      ball.position.set(Math.sin(a) * RING_R, -RING_H / 2 - 0.43, Math.cos(a) * RING_R)
      g.add(ball)
      // gems sit on the outside of the band, between spikes
      const b = a + Math.PI / SPIKES
      const stone = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 10), new THREE.MeshBasicMaterial({ color: gem }))
      stone.scale.z = 0.5
      stone.position.set(Math.sin(b) * RING_R * 1.0, 0, Math.cos(b) * RING_R * 1.0)
      stone.lookAt(stone.position.clone().multiplyScalar(2))
      g.add(stone)
    }

    g.position.y = -0.82
    g.rotation.x = 0.3
    return g
  }

  function roundedRect(w, h, r) {
    const s = new THREE.Shape()
    const x = -w / 2
    const y = -h / 2
    s.moveTo(x + r, y)
    s.lineTo(x + w - r, y)
    s.quadraticCurveTo(x + w, y, x + w, y + r)
    s.lineTo(x + w, y + h - r)
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    s.lineTo(x + r, y + h)
    s.quadraticCurveTo(x, y + h, x, y + h - r)
    s.lineTo(x, y + r)
    s.quadraticCurveTo(x, y, x + r, y)
    return s
  }

  // an iPhone floating beside the head, screen toward the viewer
  function phone({ body = "#d9dbe2", screen = "#15151d" } = {}) {
    const g = new THREE.Group()
    const device = new THREE.Group()
    const W = 0.6
    const H = 1.2
    const D = 0.08

    const shell = new THREE.ExtrudeGeometry(roundedRect(W, H, 0.14), { depth: D, bevelEnabled: false, curveSegments: 10 })
    shell.translate(0, 0, -D / 2)
    device.add(new THREE.Mesh(shell, mat(body)))
    const face = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(W - 0.06, H - 0.06, 0.11), 10), mat(screen))
    face.position.z = D / 2 + 0.003
    device.add(face)
    const island = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(0.17, 0.05, 0.025), 6), mat("#000000"))
    island.position.set(0, -H / 2 + 0.08, D / 2 + 0.006)
    device.add(island)

    // home screen: a 4x4 grid of app tiles and a dock (TikTok, WhatsApp, Instagram, YouTube...)
    const TILES = ["#fe2c55", "#25d366", "#e1306c", "#ff3b30", "#34c759", "#ffcc00", "#8e8e93", "#0a84ff", "#6b63f2", "#ff9f0a", "#5ac8fa", "#ffffff", "#af52de", "#30d158", "#ff375f", "#64d2ff"]
    const tile = new THREE.ShapeGeometry(roundedRect(0.095, 0.095, 0.026), 4)
    TILES.forEach((color, k) => {
      const m = new THREE.Mesh(tile, mat(color))
      m.position.set(-0.195 + (k % 4) * 0.13, -0.36 + Math.floor(k / 4) * 0.15, D / 2 + 0.006)
      device.add(m)
    })
    const dock = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(0.5, 0.15, 0.06), 6), mat("#2a2a36"))
    dock.position.set(0, 0.47, D / 2 + 0.005)
    device.add(dock)

    device.rotation.set(-0.12, -0.42, 0.22) // leaning in, screen turned toward the face and the viewer
    device.position.set(1.02, 0.28, 0.62) // floats close to the head, overlapping its edge
    device.scale.setScalar(1.12)
    g.add(device)
    return g
  }

  window.MascotAccessories = { headset, cap, crown, phone }
})()
