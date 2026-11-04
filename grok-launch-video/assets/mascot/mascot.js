// Mascot: a three.js head (sphere + eyes) that wears one accessory from MascotAccessories.
// Rendered flat (unlit) with an orthographic camera, so it reads like the source's vector art.
//
// Head-local units: radius 1, x right, y DOWN, z toward the viewer (same as the tracking data).
// The scene root flips y once, so geometry and poses never deal with three's y-up.
//
//   const m = Mascot.create({ canvas, width: 1280, height: 720 })
//   const head = m.add({ palette: "dark" })
//   head.pose({ x, y, R, yaw, pitch, roll, blink, accessory: true })
//   m.render()
;(function () {
  const PALETTES = {
    dark: { body: "#000000", eye: "#f5f6f0" },
    light: { body: "#ffffff", eye: "#000000" },
  }
  const EYE_W = 0.25
  const EYE_H = 0.54
  const EYE_DIRS = [
    [-0.3, -0.1],
    [0.3, -0.1],
  ]

  // Rz(roll) * Rx(pitch) * Ry(yaw), the convention the pose fitting script uses.
  function poseMatrix(yaw = 0, pitch = 0, roll = 0) {
    const e = new THREE.Euler(pitch, yaw, roll, "ZXY")
    return new THREE.Matrix4().makeRotationFromEuler(e)
  }

  function flat(color, extra) {
    return new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, ...extra })
  }

  function capsuleShape(w, h) {
    const r = w / 2
    const s = new THREE.Shape()
    s.moveTo(-r, -h / 2 + r)
    s.lineTo(-r, h / 2 - r)
    s.absarc(0, h / 2 - r, r, Math.PI, 0, true)
    s.lineTo(r, -h / 2 + r)
    s.absarc(0, -h / 2 + r, r, 0, Math.PI, true)
    return s
  }

  function createHead({ palette, accessory, stencil }) {
    const colors = typeof palette === "string" ? PALETTES[palette] : palette
    const root = new THREE.Group() // placed at (x, y) and scaled by R in canvas px
    const squash = new THREE.Group() // squash & stretch along an angle while flying
    const unsquash = new THREE.Group()
    const head = new THREE.Group() // posed by yaw / pitch / roll
    head.matrixAutoUpdate = false
    root.add(squash)
    squash.add(unsquash)
    unsquash.add(head)

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32),
      flat(colors.body, {
        stencilWrite: true,
        stencilRef: stencil,
        stencilZPass: THREE.ReplaceStencilOp,
      }),
    )
    head.add(body)

    // eyes are flat capsules on the sphere's tangent plane, clipped to the head silhouette
    const eyeGeo = new THREE.ShapeGeometry(capsuleShape(EYE_W, EYE_H), 16)
    const eyeMat = flat(colors.eye, {
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: stencil,
      stencilFunc: THREE.EqualStencilFunc,
    })
    const eyes = EYE_DIRS.map(([ex, ey]) => {
      const n = new THREE.Vector3(ex, ey, Math.sqrt(1 - ex * ex - ey * ey))
      const right = new THREE.Vector3(n.z, 0, -n.x).normalize()
      const down = new THREE.Vector3().crossVectors(n, right)
      const holder = new THREE.Group()
      holder.matrixAutoUpdate = false
      holder.matrix.makeBasis(right, down, n).setPosition(n)
      const mesh = new THREE.Mesh(eyeGeo, eyeMat)
      mesh.renderOrder = 1
      holder.add(mesh)
      head.add(holder)
      return { holder, mesh, normal: n }
    })

    let acc = null
    const accHolder = new THREE.Group() // detached accessory placement (flying in)
    accHolder.matrixAutoUpdate = false
    function setAccessory(name) {
      if (acc) acc.parent.remove(acc)
      acc = name ? window.MascotAccessories[name]() : null
      if (acc) acc.traverse((o) => o.isMesh && (o.renderOrder = 2))
    }
    setAccessory(accessory)

    const tmp = new THREE.Vector3()
    // s: { x, y, R, L?, W?, ang?, yaw, pitch, roll, blink, hidden, accessory: bool,
    //      detached?: { x, y, R, yaw, pitch, roll } } (canvas px, radians)
    function pose(s) {
      root.visible = !s.hidden
      if (s.hidden) return
      root.position.set(s.x, s.y, 0)
      root.scale.setScalar(s.R)

      const a = ((s.ang || 0) * Math.PI) / 180
      squash.rotation.z = a
      unsquash.rotation.z = -a
      squash.scale.set((s.L || s.R) / s.R, (s.W || s.R) / s.R, 1)

      head.matrix.copy(poseMatrix(s.yaw, s.pitch, s.roll))
      head.matrixWorldNeedsUpdate = true

      const blink = Math.min(1, Math.max(0.08, ((s.blink == null ? 1 : s.blink) - 0.3) / 0.6))
      for (const eye of eyes) {
        eye.mesh.scale.set(1 + (1 - blink) * 0.12, blink, 1)
        tmp.copy(eye.normal).applyMatrix4(head.matrix)
        eye.mesh.visible = tmp.z > -0.05
      }

      if (!acc) return
      acc.visible = !!s.accessory
      if (s.detached) {
        const d = s.detached
        accHolder.matrix
          .copy(poseMatrix(d.yaw, d.pitch, d.roll))
          .premultiply(new THREE.Matrix4().makeScale(d.R / s.R, d.R / s.R, d.R / s.R))
          .setPosition((d.x - s.x) / s.R, (d.y - s.y) / s.R, 0)
        accHolder.matrixWorldNeedsUpdate = true
        if (acc.parent !== accHolder) accHolder.add(acc)
        if (accHolder.parent !== root) root.add(accHolder)
      } else if (acc.parent !== head) {
        head.add(acc)
      }
    }

    return { root, pose, setAccessory }
  }

  function create({ canvas, width, height, pixelRatio = 1.5 }) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    renderer.setClearColor(0x000000, 0)
    const scene = new THREE.Scene()
    const world = new THREE.Group()
    world.scale.y = -1 // canvas px with y down
    scene.add(world)
    const camera = new THREE.OrthographicCamera(0, width, 0, -height, -1000, 1000)
    let heads = 0
    return {
      add({ palette = "dark", accessory = window.MASCOT_CONFIG.accessory } = {}) {
        const h = createHead({ palette, accessory, stencil: ++heads })
        world.add(h.root)
        return h
      },
      render() {
        renderer.render(scene, camera)
      },
    }
  }

  window.Mascot = { create, PALETTES }
})()
