import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════
//  TarotTearEffect
//  Three.js paper-tearing animation for tarot card disappearance.
//  Adapted from the CodePen reference in public/txt.txt.
//
//  Usage:
//    const tear = new TarotTearEffect(scene, camera, renderer);
//    await tear.play(imagePath, screenRect);
//    tear.dispose();
// ═══════════════════════════════════════════════════════════════

// ── Vertex shader: bend each half of the card as it tears ──
const ripVertexShader = /* glsl */ `
  uniform float uTearAmount;
  uniform float uTearWidth;
  uniform float uTearXAngle;
  uniform float uTearYAngle;
  uniform float uTearZAngle;
  uniform float uTearXOffset;
  uniform float uXDirection;
  uniform float uRipSide;

  varying vec2 vUv;
  varying float vAmount;

  #define HEIGHT_VAL SHEET_HEIGHT
  #define WIDTH_VAL SHEET_HALF_WIDTH

  mat4 rotationX(in float angle) {
    return mat4(
      1.0, 0, 0, 0,
      0, cos(angle), -sin(angle), 0,
      0, sin(angle),  cos(angle), 0,
      0, 0, 0, 1
    );
  }

  mat4 rotationY(in float angle) {
    return mat4(
      cos(angle), 0, sin(angle), 0,
      0, 1.0, 0, 0,
      -sin(angle), 0, cos(angle), 0,
      0, 0, 0, 1
    );
  }

  mat4 rotationZ(in float angle) {
    return mat4(
      cos(angle), -sin(angle), 0, 0,
      sin(angle),  cos(angle), 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    );
  }

  void main() {
    float yAmount = max(0.0, (uTearAmount - (1.0 - uv.y)));
    float zRotate = uTearZAngle * yAmount;
    float xRotate = uTearXAngle * yAmount;
    float yRotate = uTearYAngle * yAmount;
    vec3 rotation = vec3(xRotate * yAmount, yRotate * yAmount, zRotate * yAmount);

    float halfHeight = HEIGHT_VAL * 0.5;
    float halfWidth = (WIDTH_VAL - uTearWidth * 0.5) * 0.5;

    vec4 vertex = vec4(
      position.x + (halfWidth * uXDirection) - halfWidth,
      position.y + halfHeight,
      position.z,
      1.0
    );

    vertex = vertex * rotationY(rotation.y) * rotationX(rotation.x) * rotationZ(rotation.z);
    vertex.x += uTearXOffset * yAmount + halfWidth;
    vertex.y -= halfHeight;

    vec4 modelPosition = modelMatrix * vertex;
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;

    gl_Position = projectedPosition;

    vUv = uv;
    vAmount = yAmount;
  }
`;

// ── Fragment shader: render the card texture with procedural rip edge ──
const ripFragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uShadeColor;
  uniform float uUvOffset;
  uniform float uRipSide;
  uniform float uTearXAngle;
  uniform float uShadeAmount;
  uniform float uTearWidth;
  uniform float uTearOffset;

  varying vec2 vUv;
  varying float vAmount;

  #define FULL_WIDTH_VAL SHEET_FULL_WIDTH
  #define WIDTH_VAL SHEET_HALF_WIDTH

  // Simple pseudo-random noise for procedural rip edge
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float ripNoise(vec2 uv) {
    float n = 0.0;
    n += 0.5 * noise(uv * 8.0);
    n += 0.25 * noise(uv * 16.0);
    n += 0.125 * noise(uv * 32.0);
    return n;
  }

  void main() {
    bool rightSide = uRipSide == 1.0;
    float widthOverlap = (uTearWidth * 0.5) + WIDTH_VAL;

    float xScale = widthOverlap / FULL_WIDTH_VAL;
    vec2 uvOffset = vec2(vUv.x * xScale + uUvOffset, vUv.y);
    vec4 textureColor = texture2D(uMap, uvOffset);

    // The tear edge zone is a narrow strip along the rip seam.
    // Outside this zone, the fragment is fully solid (alpha = 1).
    float ripRange = uTearWidth / widthOverlap;
    float ripStart = rightSide ? 0.0 : 1.0 - ripRange;
    float ripEnd = ripStart + ripRange;

    float alpha = 1.0;

    // Only apply rip noise within the tear edge zone
    bool inRipZone = vUv.x >= ripStart && vUv.x <= ripEnd;

    if (inRipZone) {
      float ripX = (vUv.x - ripStart) / ripRange; // 0..1 across the rip zone
      float ripY = vUv.y * 0.5 + (0.5 * uTearOffset);
      float ripValue = ripNoise(vec2(ripX * 3.0, ripY * 6.0));

      float threshold = 0.45;

      if (!rightSide && ripValue <= threshold) {
        // Check for torn paper edge coloring
        float edgeRip = ripNoise(vec2(ripX * 2.7, ripY * 5.8 - 0.02));
        if (edgeRip >= threshold) {
          textureColor = vec4(vec3(0.92), 1.0); // Torn paper edge (white-ish)
        } else {
          alpha = 0.0;
        }
      }
      if (rightSide && ripValue >= threshold) {
        alpha = 0.0;
      }
    }
    // Outside the rip zone: fully solid, no transparency

    // The texture is already pre-styled (colorful engraved) — render as-is.
    // Only apply shade on torn/curling parts for depth.
    gl_FragColor = mix(
      vec4(textureColor.rgb, alpha),
      vec4(uShadeColor, alpha),
      vAmount * uShadeAmount
    );
  }
`;

// ── Settings for the two halves ──
interface SideSettings {
  uvOffset: number;
  ripSide: number;
  tearXAngle: number;
  tearYAngle: number;
  tearZAngle: number;
  tearXOffset: number;
  direction: number;
  shadeColor: THREE.Color;
  shadeAmount: number;
}

interface SheetSettings {
  widthSegments: number;
  heightSegments: number;
  tearOffset: number;
  width: number;
  height: number;
  tearAmount: number;
  tearWidth: number;
  left: SideSettings;
  right: SideSettings;
}

interface SideMesh {
  id: 'left' | 'right';
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

export interface TearScreenRect {
  x: number;       // screen-space left (px)
  y: number;       // screen-space top (px)
  width: number;   // screen-space width (px)
  height: number;  // screen-space height (px)
}

export class TarotTearEffect {
  private group: THREE.Group;
  private sides: SideMesh[] = [];
  private sheetSettings: SheetSettings;
  private geometry: THREE.PlaneGeometry;
  private disposed = false;
  private animationFrameId: number = 0;
  /** Resolves when the texture is loaded and meshes are ready to render */
  public readonly ready: Promise<void>;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private cardTexturePath: string,
    private screenRect: TearScreenRect
  ) {
    this.group = new THREE.Group();

    // Derive card dimensions from the screen rect aspect ratio so the tear
    // matches the actual tarot column exactly.
    const aspect = screenRect.width / screenRect.height;
    const cardHeight = 4.5;
    const cardWidth = cardHeight * aspect;
    const tearWidth = cardWidth * 0.08; // thin tear relative to card width

    this.sheetSettings = {
      widthSegments: 30,
      heightSegments: 50,
      tearOffset: Math.random(),
      width: cardWidth,
      height: cardHeight,
      tearAmount: 0,
      tearWidth: tearWidth,
      left: {
        uvOffset: 0,
        ripSide: 0,
        tearXAngle: -0.01,
        tearYAngle: -0.1,
        tearZAngle: 0.05,
        tearXOffset: 0,
        direction: -1,
        shadeColor: new THREE.Color('white'),
        shadeAmount: 0.2,
      },
      right: {
        uvOffset: ((cardWidth - tearWidth) / cardWidth) * 0.5,
        ripSide: 1,
        tearXAngle: 0.2,
        tearYAngle: 0.1,
        tearZAngle: -0.1,
        tearXOffset: 0,
        direction: 1,
        shadeColor: new THREE.Color('black'),
        shadeAmount: 0.4,
      },
    };

    this.geometry = new THREE.PlaneGeometry(
      cardWidth / 2 + tearWidth / 2,
      cardHeight,
      this.sheetSettings.widthSegments,
      this.sheetSettings.heightSegments
    );

    // Load texture and build meshes — ready resolves when texture is loaded
    this.ready = this.buildMeshes();
  }

  private buildMeshes(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const textureLoader = new THREE.TextureLoader();
      textureLoader.load(
        this.cardTexturePath,
        (texture) => {
          // Don't set colorSpace — the custom shader outputs gl_FragColor directly,
          // so we skip the sRGB→linear→sRGB round-trip that darkens the image.
          this.createSideMeshes(texture);
          resolve();
        },
        undefined,
        (err) => {
          console.error('Failed to load tear texture:', err);
          reject(err);
        }
      );
    });
  }

  private createSideMeshes(texture: THREE.Texture): void {

    const sideIds: ('left' | 'right')[] = ['left', 'right'];

    for (const sideId of sideIds) {
      const settings = this.sheetSettings[sideId];
      const material = new THREE.ShaderMaterial({
        defines: {
          SHEET_HEIGHT: this.sheetSettings.height.toFixed(4),
          SHEET_HALF_WIDTH: (this.sheetSettings.width / 2).toFixed(4),
          SHEET_FULL_WIDTH: this.sheetSettings.width.toFixed(4),
        },
        uniforms: {
          uMap: { value: texture },
          uRipSide: { value: settings.ripSide },
          uTearWidth: { value: this.sheetSettings.tearWidth },
          uTearAmount: { value: this.sheetSettings.tearAmount },
          uTearOffset: { value: this.sheetSettings.tearOffset },
          uUvOffset: { value: settings.uvOffset },
          uTearXAngle: { value: settings.tearXAngle },
          uTearYAngle: { value: settings.tearYAngle },
          uTearZAngle: { value: settings.tearZAngle },
          uTearXOffset: { value: settings.tearXOffset },
          uXDirection: { value: settings.direction },
          uShadeColor: { value: settings.shadeColor },
          uShadeAmount: { value: settings.shadeAmount },
        },
        transparent: true,
        vertexShader: ripVertexShader,
        fragmentShader: ripFragmentShader,
        side: THREE.DoubleSide,
        depthTest: false,
      });

      const mesh = new THREE.Mesh(this.geometry, material);

      // Front sheet (right side with positive tearXAngle) sits slightly in front
      if (settings.tearXAngle > 0) {
        mesh.position.z += 0.001;
      }

      this.group.add(mesh);
      this.sides.push({ id: sideId, mesh, material });
    }
  }

  /** Convert screen-space rect to world-space position for the tear group */
  private positionInWorld(): void {
    const { x, y, width, height } = this.screenRect;

    // Screen center in NDC (-1 to 1)
    const ndcX = ((x + width / 2) / window.innerWidth) * 2 - 1;
    const ndcY = -((y + height / 2) / window.innerHeight) * 2 + 1;

    // The tear scene uses a simple camera at z=10 looking at origin
    // Place the tear card at z=0 (the look-at plane)
    const zDistFromCamera = this.camera.position.z; // distance from camera to z=0
    const fov = this.camera.fov * Math.PI / 180;
    const worldHeight = 2 * Math.tan(fov / 2) * zDistFromCamera;
    const worldWidth = worldHeight * this.camera.aspect;

    // Convert NDC to world position at z=0
    const worldX = ndcX * worldWidth / 2;
    const worldY = ndcY * worldHeight / 2;

    this.group.position.set(worldX, worldY, 0);

    // Scale to match screen rect size exactly (use separate X/Y to ensure pixel-perfect fit)
    const scaleX = (width / window.innerWidth) * worldWidth / this.sheetSettings.width;
    const scaleY = (height / window.innerHeight) * worldHeight / this.sheetSettings.height;
    this.group.scale.set(scaleX, scaleY, 1);
  }

  private updateUniforms(): void {
    for (const side of this.sides) {
      const uniforms = side.material.uniforms;
      const settings = this.sheetSettings[side.id];

      uniforms.uTearAmount.value = this.sheetSettings.tearAmount;
      uniforms.uTearOffset.value = this.sheetSettings.tearOffset;
      uniforms.uUvOffset.value = settings.uvOffset;
      uniforms.uTearXAngle.value = settings.tearXAngle;
      uniforms.uTearYAngle.value = settings.tearYAngle;
      uniforms.uTearZAngle.value = settings.tearZAngle;
      uniforms.uTearXOffset.value = settings.tearXOffset;
      uniforms.uXDirection.value = settings.direction;
      uniforms.uShadeColor.value = settings.shadeColor;
      uniforms.uShadeAmount.value = settings.shadeAmount;
    }
  }

  /** Position the card in the scene so it's visible. Call after texture is ready. */
  setup(): void {
    if (this.disposed) return;
    this.positionInWorld();
    this.scene.add(this.group);
  }

  /** Play the tear animation. Call after setup(). Returns a promise that resolves when done. */
  async play(): Promise<void> {
    if (this.disposed) return;

    // Wait for texture to be loaded before starting
    await this.ready;
    if (this.disposed) return;

    // Ensure we're in the scene (setup may have been called already)
    if (!this.group.parent) {
      this.positionInWorld();
      this.scene.add(this.group);
    }

    // Phase 1: Tear propagates top-to-bottom (tearAmount ramps from 0 → ~1.8)
    const tearDuration = 1000; // ms — slower for natural feel
    const fallDuration = 700;  // ms

    await this.tweenTear(tearDuration);

    // Phase 2: Halves peel away and fall
    await this.tweenFall(fallDuration);

    // Clean up
    this.removeFromScene();
  }

  private tweenTear(duration: number): Promise<void> {
    return new Promise(resolve => {
      const start = performance.now();
      const targetTear = 1.8 + Math.random() * 0.3;

      const animate = (now: number) => {
        if (this.disposed) { resolve(); return; }

        const elapsed = now - start;
        const t = Math.min(elapsed / duration, 1);
        // Ease in-out: starts slow, speeds up in middle, slows at end — feels like paper tearing
        const eased = t < 0.5
          ? 2 * t * t
          : 1 - Math.pow(-2 * t + 2, 2) / 2;

        this.sheetSettings.tearAmount = eased * targetTear;

        // Progressively increase the curl angles as the tear deepens
        const curlProgress = Math.min(t * 1.5, 1); // Curl starts early
        this.sheetSettings.left.tearXAngle = -0.01 - curlProgress * 0.08;
        this.sheetSettings.left.tearYAngle = -0.1 - curlProgress * 0.15;
        this.sheetSettings.left.tearXOffset = -curlProgress * 0.3;
        this.sheetSettings.right.tearXAngle = 0.2 + curlProgress * 0.1;
        this.sheetSettings.right.tearYAngle = 0.1 + curlProgress * 0.15;
        this.sheetSettings.right.tearXOffset = curlProgress * 0.3;

        this.updateUniforms();

        if (t < 1) {
          this.animationFrameId = requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  private tweenFall(duration: number): Promise<void> {
    return new Promise(resolve => {
      const start = performance.now();

      // Store initial positions
      const leftMesh = this.sides.find(s => s.id === 'left')?.mesh;
      const rightMesh = this.sides.find(s => s.id === 'right')?.mesh;
      if (!leftMesh || !rightMesh) { resolve(); return; }

      const leftStartY = leftMesh.position.y;
      const rightStartY = rightMesh.position.y;
      const leftStartX = leftMesh.position.x;
      const rightStartX = rightMesh.position.x;
      const leftStartRotZ = leftMesh.rotation.z;
      const rightStartRotZ = rightMesh.rotation.z;

      // Random fall parameters
      const leftFallDist = -(2 + Math.random() * 2);
      const rightFallDist = -(2 + Math.random() * 2);
      const leftDriftX = -(1 + Math.random() * 1.5);
      const rightDriftX = (1 + Math.random() * 1.5);
      const leftRotZ = -(0.5 + Math.random() * 1.0);
      const rightRotZ = (0.5 + Math.random() * 1.0);

      const animate = (now: number) => {
        if (this.disposed) { resolve(); return; }

        const elapsed = now - start;
        const t = Math.min(elapsed / duration, 1);
        // Ease in quad (accelerate as they fall)
        const eased = t * t;

        leftMesh.position.y = leftStartY + leftFallDist * eased;
        leftMesh.position.x = leftStartX + leftDriftX * eased;
        leftMesh.rotation.z = leftStartRotZ + leftRotZ * eased;

        rightMesh.position.y = rightStartY + rightFallDist * eased;
        rightMesh.position.x = rightStartX + rightDriftX * eased;
        rightMesh.rotation.z = rightStartRotZ + rightRotZ * eased;

        // Fade out
        const alpha = 1 - eased;
        (leftMesh.material as THREE.ShaderMaterial).opacity = alpha;
        (rightMesh.material as THREE.ShaderMaterial).opacity = alpha;

        if (t < 1) {
          this.animationFrameId = requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      this.animationFrameId = requestAnimationFrame(animate);
    });
  }

  private removeFromScene(): void {
    this.scene.remove(this.group);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrameId);
    this.removeFromScene();

    this.geometry.dispose();
    for (const side of this.sides) {
      side.material.dispose();
      // Dispose texture
      const tex = side.material.uniforms.uMap?.value as THREE.Texture | undefined;
      if (tex) tex.dispose();
    }
    this.sides = [];
  }
}
