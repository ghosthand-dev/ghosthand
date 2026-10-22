// 3D world of the launch video: toon-shaded Mac mini, iPhone SE on a wooden stand, USB cable.
// Models are built from code (1 unit = 1 cm). Frames go through an ink pass: Sobel edges on
// normals and depth draw the outlines, then paper grain is added, like an illustration.
//
//   scene ──color pass──> colorRT ─┐
//   scene ──normal pass──> normalRT + depth ─┴──> ink shader (outlines, wobble, grain) ──> canvas

import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const PALETTE = {
  paper: '#f3eadb',
  paperLight: '#fbf6ec',
  ink: '#3a2a20',
  terra: '#d97757',
  terraDark: '#b85c3e',
  sage: '#9cb08a',
  mustard: '#e8b65a',
  muted: '#8a7867',
  alu: '#dcd8d2',
  rubber: '#5a4b40',
  glass: '#2a221d',
  wood: '#d4a06a',
  cable: '#fbf7f0',
}

/** Objects on this layer get no outline (ground shadow, glowing beads). */
const NO_INK = 1
/** Supersampling: the canvas renders at 2x and the browser scales it down. */
const SS = 2

// ---------------------------------------------------------------- materials

const RAMP = (() => {
  const tex = new THREE.DataTexture(new Uint8Array([95, 150, 210, 255]), 4, 1, THREE.RedFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return tex
})()

const toon = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: RAMP })

// ---------------------------------------------------------------- geometry

function roundedRectShape(w: number, h: number, r: number) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  s.lineTo(x + w, y + h - r)
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  s.lineTo(x + r, y + h)
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(x, y + r)
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
  return s
}

/** Rounded rectangle w×h with corner radius r, `depth` thick along z, edges softened by `bevel`. Centered. */
function slab({ w, h, depth, r, bevel }: { w: number; h: number; depth: number; r: number; bevel: number }) {
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(w - 2 * bevel, h - 2 * bevel, Math.max(0.01, r - bevel)), {
    depth: Math.max(0.001, depth - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 6,
    curveSegments: 20,
  })
  geo.translate(0, 0, -(depth - 2 * bevel) / 2)
  // smooth normals across caps and bevels, else every facet gets an outline
  geo.deleteAttribute('uv')
  geo.deleteAttribute('normal')
  const smooth = mergeVertices(geo, 1e-4)
  smooth.computeVertexNormals()
  return smooth
}

/** Slab lying flat: w along x, h along z, depth along y. */
function flatSlab(opts: Parameters<typeof slab>[0]) {
  return slab(opts).rotateX(-Math.PI / 2)
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, pos: [number, number, number] = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, material)
  m.position.set(...pos)
  m.castShadow = true
  return m
}

// ---------------------------------------------------------------- models

export const MAC = { w: 12.7, h: 5, base: 0.45 }

/** Mac mini (M4 size), front face toward +z. Origin at the center of its footprint. */
function macMini() {
  const group = new THREE.Group()
  const bodyH = MAC.h - MAC.base
  group.add(mesh(flatSlab({ w: 10.6, h: 10.6, depth: MAC.base + 0.1, r: 2, bevel: 0.08 }), toon(PALETTE.rubber), [0, (MAC.base + 0.1) / 2, 0]))
  group.add(mesh(flatSlab({ w: MAC.w, h: MAC.w, depth: bodyH, r: 2.6, bevel: 0.55 }), toon(PALETTE.alu), [0, MAC.base + bodyH / 2, 0]))

  const front = MAC.w / 2
  const portY = MAC.base + 1.55
  const dark = toon('#3b302a')
  for (const x of [-4.3, -3.1]) group.add(mesh(slab({ w: 0.86, h: 0.32, depth: 0.12, r: 0.16, bevel: 0.02 }), dark, [x, portY, front]))
  group.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 24).rotateX(Math.PI / 2), dark, [-1.9, portY, front]))
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), new THREE.MeshBasicMaterial({ color: '#fff4d6', toneMapped: false }))
  led.position.set(4.6, portY, front + 0.02)
  group.add(led)
  return { group, led, port: new THREE.Vector3(-4.3, portY, front) }
}

export const PHONE = { w: 6.73, h: 13.84, d: 0.73, screenW: 5.84, screenH: 10.38 }
/** The iPhone leans back on its stand by this angle (radians). */
const TILT = 0.2

/** iPhone SE (2nd gen) on a small wooden stand. Screen faces +z. */
function iphone(screenTexture: THREE.Texture) {
  const phone = new THREE.Group()
  phone.add(mesh(slab({ w: PHONE.w, h: PHONE.h, depth: PHONE.d, r: 0.95, bevel: 0.22 }), toon(PALETTE.terra)))
  phone.add(mesh(slab({ w: PHONE.w - 0.16, h: PHONE.h - 0.16, depth: 0.06, r: 0.88, bevel: 0.025 }), toon(PALETTE.glass), [0, 0, PHONE.d / 2 - 0.01]))

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(PHONE.screenW, PHONE.screenH),
    new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false }),
  )
  screen.position.set(0, 0.05, PHONE.d / 2 + 0.03)
  phone.add(screen)

  const z = PHONE.d / 2 + 0.03
  const trim = toon('#6d6058')
  phone.add(mesh(new THREE.TorusGeometry(0.5, 0.045, 10, 40), trim, [0, -6.03, z]))
  phone.add(mesh(new THREE.CircleGeometry(0.46, 40), toon('#221b17'), [0, -6.03, z - 0.005]))
  phone.add(mesh(slab({ w: 1.0, h: 0.13, depth: 0.03, r: 0.065, bevel: 0.01 }), trim, [0, 6.05, z]))
  phone.add(mesh(new THREE.CircleGeometry(0.13, 20), toon('#463a33'), [-1.05, 6.05, z]))
  const port = mesh(slab({ w: 0.75, h: 0.24, depth: 0.1, r: 0.12, bevel: 0.02 }).rotateX(Math.PI / 2), toon('#3b302a'), [0, -PHONE.h / 2, 0])
  phone.add(port)

  // stand: base plate, tilted back rest, two front lips the phone sits on (cable goes between them)
  const stand = new THREE.Group()
  const wood = toon(PALETTE.wood)
  stand.add(mesh(flatSlab({ w: 8.6, h: 6.2, depth: 0.7, r: 0.8, bevel: 0.18 }), wood, [0, 0.35, 0]))
  const rest = mesh(slab({ w: 7.4, h: 10, depth: 0.7, r: 0.8, bevel: 0.18 }), wood, [0, 5.4, -0.55])
  rest.rotation.x = -TILT
  stand.add(rest)
  for (const x of [-2.6, 2.6]) stand.add(mesh(slab({ w: 1.6, h: 1.7, depth: 1.1, r: 0.35, bevel: 0.16 }), wood, [x, 1.35, 1.2]))

  phone.position.set(0, 2.2 + PHONE.h / 2 * Math.cos(TILT), 1.2 - PHONE.h / 2 * Math.sin(TILT) - 0.35)
  phone.rotation.x = -TILT

  const group = new THREE.Group()
  group.add(stand, phone)
  return { group, phone, screen, stand }
}

/** USB-C plug or Lightning plug: a white rounded body with a metal tip, pointing along +y. */
function plug(tip: 'usbc' | 'lightning') {
  const group = new THREE.Group()
  const white = toon(PALETTE.cable)
  group.add(mesh(slab({ w: 1.0, h: 2.0, depth: 0.55, r: 0.27, bevel: 0.12 }), white, [0, -1.0, 0]))
  const metal = toon('#b8b0a6')
  const tipGeo = tip === 'usbc' ? slab({ w: 0.82, h: 0.8, depth: 0.27, r: 0.13, bevel: 0.03 }) : slab({ w: 0.68, h: 0.8, depth: 0.15, r: 0.07, bevel: 0.02 })
  group.add(mesh(tipGeo, metal, [0, 0.35, 0]))
  return group
}

// ---------------------------------------------------------------- world

export type World = ReturnType<typeof createWorld>

export function createWorld({ canvas, width, height, screenTexture }: { canvas: HTMLCanvasElement; width: number; height: number; screenTexture: THREE.Texture }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(SS)
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = paperBackground()
  const camera = new THREE.PerspectiveCamera(30, width / height, 1, 600)
  camera.layers.enable(NO_INK)

  scene.add(new THREE.HemisphereLight('#fff6e8', '#e7c9a8', 1.15))
  const sun = new THREE.DirectionalLight('#fff1dc', 2.6)
  sun.position.set(-40, 50, 25)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.camera.left = -40
  sun.shadow.camera.right = 40
  sun.shadow.camera.top = 40
  sun.shadow.camera.bottom = -40
  sun.shadow.radius = 3
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.02
  scene.add(sun)

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ color: '#7a4a2c', opacity: 0.16 }))
  ground.receiveShadow = true
  ground.layers.set(NO_INK)
  scene.add(ground)

  const mac = macMini()
  mac.group.position.set(-10, 0, 0)
  const phone = iphone(screenTexture)
  phone.group.position.set(9, 0, 1)
  phone.group.rotation.y = -0.32
  scene.add(mac.group, phone.group)

  const cable = createCable({ scene, mac, phone })

  // ink pass
  const rtSize = new THREE.Vector2(width * SS, height * SS)
  const colorRT = new THREE.WebGLRenderTarget(rtSize.x, rtSize.y, { samples: 4, type: THREE.HalfFloatType })
  const normalRT = new THREE.WebGLRenderTarget(rtSize.x, rtSize.y, { type: THREE.HalfFloatType })
  normalRT.depthTexture = new THREE.DepthTexture(rtSize.x, rtSize.y)
  const normalMaterial = new THREE.MeshNormalMaterial()
  const ink = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: colorRT.texture },
      tNormal: { value: normalRT.texture },
      tDepth: { value: normalRT.depthTexture },
      res: { value: rtSize },
      near: { value: camera.near },
      far: { value: camera.far },
      lineW: { value: 2.6 },
      seed: { value: 0 },
      inkColor: { value: new THREE.Color(PALETTE.ink) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: INK_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ink)
  quad.frustumCulled = false
  const post = new THREE.Scene()
  post.add(quad)

  function render(t: number) {
    camera.updateMatrixWorld()
    ink.uniforms.near.value = camera.near
    ink.uniforms.far.value = camera.far
    // line boil: outlines shift a little 8 times per second, like hand-drawn frames
    ink.uniforms.seed.value = Math.floor(t * 8) * 7.31

    renderer.setRenderTarget(colorRT)
    renderer.render(scene, camera)

    const background = scene.background
    scene.background = null
    scene.overrideMaterial = normalMaterial
    camera.layers.disable(NO_INK)
    renderer.setRenderTarget(normalRT)
    renderer.setClearColor('#000000', 0)
    renderer.clear()
    renderer.render(scene, camera)
    camera.layers.enable(NO_INK)
    scene.overrideMaterial = null
    scene.background = background

    renderer.setRenderTarget(null)
    renderer.render(post, camera)
  }

  const projected = new THREE.Vector3()
  /** Screen position in CSS px of a world point. Takes the camera view offset into account. */
  function project(p: THREE.Vector3) {
    projected.copy(p).project(camera)
    return { x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height }
  }

  return { renderer, scene, camera, mac, phone, cable, render, project }
}

/** Warm paper with a lighter center, drawn once as the scene background. */
function paperBackground() {
  const c = document.createElement('canvas')
  c.width = 960
  c.height = 540
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(480, 230, 40, 480, 270, 620)
  g.addColorStop(0, PALETTE.paperLight)
  g.addColorStop(1, PALETTE.paper)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, c.width, c.height)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const INK_FRAGMENT = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;
  uniform vec2 res;
  uniform float near;
  uniform float far;
  uniform float lineW;
  uniform float seed;
  uniform vec3 inkColor;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float viewZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }

  void main() {
    vec2 px = 1.0 / res;
    vec2 p = gl_FragCoord.xy;
    vec2 wobble = vec2(noise(p * 0.006 + seed), noise(p * 0.006 + seed + 31.7)) - 0.5;
    vec2 uv = vUv + wobble * px * lineW * 1.6;

    float d0 = viewZ(uv);
    vec4 n0 = texture2D(tNormal, uv);
    float depthEdge = 0.0;
    float normalEdge = 0.0;
    float coverEdge = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      vec2 o = vec2(cos(a), sin(a)) * px * lineW;
      float d = viewZ(uv + o);
      depthEdge = max(depthEdge, abs(d - d0) / min(d, d0));
      vec4 n = texture2D(tNormal, uv + o);
      normalEdge = max(normalEdge, length(n.rgb - n0.rgb));
      coverEdge = max(coverEdge, abs(n.a - n0.a));
    }
    float edge = max(max(smoothstep(0.012, 0.03, depthEdge), smoothstep(0.32, 0.55, normalEdge)), coverEdge);

    vec3 col = texture2D(tColor, vUv).rgb;
    float grain = noise(p * 0.55) * 0.6 + noise(p * 0.11) * 0.4;
    float fiber = noise(p * vec2(0.012, 0.22));
    col *= 1.0 - 0.05 * (grain - 0.5) - 0.025 * (fiber - 0.5);
    col = mix(col, inkColor, edge * 0.92);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

// ---------------------------------------------------------------- cable

const CABLE_SEGMENTS = 240
const CABLE_RADIAL = 12

/** USB cable from the Mac's front port to the iPhone's Lightning port. grow(p) draws it from the Mac end. */
function createCable({ scene, mac, phone }: { scene: THREE.Scene; mac: ReturnType<typeof macMini>; phone: ReturnType<typeof iphone> }) {
  scene.updateMatrixWorld(true)
  const macPort = mac.group.localToWorld(mac.port.clone())
  const phonePort = phone.phone.localToWorld(new THREE.Vector3(0, -PHONE.h / 2, 0))
  const phoneDown = new THREE.Vector3(0, -1, 0).transformDirection(phone.phone.matrixWorld)

  const plugLen = 2.0
  const macPlugEnd = macPort.clone().add(new THREE.Vector3(0, 0, plugLen))
  const phonePlugEnd = phonePort.clone().addScaledVector(phoneDown, plugLen)
  const curve = new THREE.CatmullRomCurve3(
    [
      macPlugEnd,
      macPlugEnd.clone().add(new THREE.Vector3(0.3, -0.6, 1.6)),
      new THREE.Vector3(macPort.x + 2.5, 0.25, macPort.z + 6.5),
      new THREE.Vector3(-1, 0.25, 11),
      new THREE.Vector3(phonePort.x - 3.5, 0.25, phonePort.z + 6),
      phonePlugEnd.clone().add(new THREE.Vector3(-0.2, -0.9, 1.6)),
      phonePlugEnd,
    ],
    false,
    'centripetal',
  )
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, CABLE_SEGMENTS, 0.17, CABLE_RADIAL, false), toon(PALETTE.cable))
  tube.castShadow = true
  scene.add(tube)

  const macPlug = plug('usbc')
  const phonePlug = plug('lightning')
  scene.add(macPlug, phonePlug)

  const glowMaterial = new THREE.MeshBasicMaterial({ color: PALETTE.terra, toneMapped: false })
  const beads = Array.from({ length: 7 }, () => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), glowMaterial)
    b.layers.set(NO_INK)
    scene.add(b)
    return b
  })

  const up = new THREE.Vector3(0, 1, 0)
  const tmp = new THREE.Vector3()
  /** Points the plug's +y axis along `dir` with its tip at `tip`. */
  function placePlug(p: THREE.Object3D, tip: THREE.Vector3, dir: THREE.Vector3) {
    p.position.copy(tip)
    p.quaternion.setFromUnitVectors(up, tmp.copy(dir).normalize())
  }

  /**
   * p: 0..1 how much of the cable is drawn. macIn / phoneIn: 0..1 how far each plug is pushed in.
   * flow: phase of the beads that run from the iPhone to the Mac (0 hides them).
   */
  function update({ p, macIn, phoneIn, flow, flowOpacity }: { p: number; macIn: number; phoneIn: number; flow: number; flowOpacity: number }) {
    tube.visible = p > 0.001
    tube.geometry.setDrawRange(0, Math.floor(p * CABLE_SEGMENTS) * CABLE_RADIAL * 6)

    macPlug.visible = p > 0.001
    const macOut = new THREE.Vector3(0, 0, -1)
    placePlug(macPlug, macPort.clone().add(new THREE.Vector3(0, 0, (1 - macIn) * 2.2)), macOut)

    phonePlug.visible = p > 0.02
    if (p < 1) {
      // the Lightning plug rides the growing end of the cable
      const head = curve.getPointAt(p)
      const dir = curve.getTangentAt(p)
      placePlug(phonePlug, head.clone().addScaledVector(dir, plugLen), dir)
    } else {
      placePlug(phonePlug, phonePort.clone().addScaledVector(phoneDown, (1 - phoneIn) * 1.6), phoneDown.clone().negate())
    }

    beads.forEach((b, i) => {
      const u = 1 - ((flow + i / beads.length) % 1)
      b.visible = flowOpacity > 0.01 && flow > 0
      b.position.copy(curve.getPointAt(u))
      b.scale.setScalar(flowOpacity * (0.6 + 0.4 * Math.sin(u * Math.PI)))
    })
  }

  return { curve, update, macPort, phonePort }
}
