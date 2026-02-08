import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface ThreeBgOptions {
  canvas: HTMLCanvasElement;
  modelPath: string;
  animate: boolean;
}

export class ThreeBackground {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private bgGroup: THREE.Group;
  private clock: THREE.Clock;
  private animateCamera: boolean;
  private animationId: number = 0;
  private mixer: THREE.AnimationMixer | null = null;

  constructor(options: ThreeBgOptions) {
    this.animateCamera = options.animate;
    this.clock = new THREE.Clock();

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: true, // transparent so page bg shows if needed
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.syncSize();

    // ── Scene ──
    this.scene = new THREE.Scene();

    // ── Background image ──
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('/assets/symbols_original/screen_blurred.jpg', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = texture;
      console.log('✅ Three.js background image loaded');
    });

    // ── Camera ──
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 500);
    this.camera.position.set(0, 2, 25);
    this.camera.lookAt(0, 0, 0);

    // ── Lighting: hard 50/50 split — one half lit, one half pure shadow ──
    // Near-zero ambient so unlit side goes black
    const ambient = new THREE.AmbientLight(0xffffff, 0.01);
    this.scene.add(ambient);

    // Key light from pure left side (no forward wrap) — hard edge down the middle
    const key = new THREE.DirectionalLight(0xffffff, 4.0);
    key.position.set(-15, 2, 0); // pure side, slightly above
    key.castShadow = false;
    this.scene.add(key);

    // ── Background group ──
    this.bgGroup = new THREE.Group();
    this.scene.add(this.bgGroup);

    // ── Load model ──
    this.loadModel(options.modelPath);

    // ── Resize handling ──
    window.addEventListener('resize', () => this.onResize());

    // ── Start render loop ──
    this.renderLoop();
  }

  private loadModel(path: string): void {
    const loader = new GLTFLoader();
    loader.load(
      path,
      (gltf) => {
        const model = gltf.scene;

        // Auto-center and auto-scale
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Center at origin
        model.position.sub(center);

        // Scale so max dimension ≈ 20 units
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = 17;
        const scale = targetSize / maxDim;
        model.scale.setScalar(scale);

        // Shift model up so its BOTTOM sits at y=0 of the group
        const scaledBox = new THREE.Box3().setFromObject(model);
        const bottomY = scaledBox.min.y;
        model.position.y -= bottomY; // lifts bottom to y=0

        // Performance: frustum culling + desaturate to black & white
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.frustumCulled = true;

            // Engraved tarot style: grayscale + crushed blacks + posterize + edge ink + grain
            const mesh = child as THREE.Mesh;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of materials) {
              mat.onBeforeCompile = (shader) => {
                shader.fragmentShader = shader.fragmentShader.replace(
                  '#include <dithering_fragment>',
                  `
                  #include <dithering_fragment>

                  // 1. Grayscale + brightness boost
                  float gray = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
                  gray = clamp(gray * 2.5, 0.0, 1.0);

                  // 2. Crush blacks — gamma curve pushes mids darker
                  gray = pow(gray, 0.7);

                  // 3. S-curve contrast
                  gray = smoothstep(0.05, 0.95, gray);

                  // 4. Edge detection via screen-space derivatives (subtle ink lines)
                  float dx = dFdx(gray);
                  float dy = dFdy(gray);
                  float edge = sqrt(dx * dx + dy * dy);
                  edge = smoothstep(0.02, 0.08, edge);
                  gray = gray * (1.0 - edge * 0.4); // subtle edge darkening

                  // 5. Very light grain
                  vec2 uv = gl_FragCoord.xy;
                  float noise = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
                  noise = (noise - 0.5) * 0.04;
                  gray = clamp(gray + noise, 0.0, 1.0);

                  gl_FragColor.rgb = vec3(gray);
                  `
                );
              };
            }
          }
        });

        this.bgGroup.add(model);

        // Position: right border of grid, bottom aligned with grid bottom
        // Grid bottom in 3D space is roughly y ≈ -6
        this.bgGroup.position.set(18, -7.7, -15);

        // ── Play animations if available ──
        if (gltf.animations && gltf.animations.length > 0) {
          this.mixer = new THREE.AnimationMixer(model);
          for (const clip of gltf.animations) {
            const action = this.mixer.clipAction(clip);
            action.play();
          }
          console.log(`🎬 Playing ${gltf.animations.length} animation(s): ${gltf.animations.map(a => a.name || 'unnamed').join(', ')}`);
        }

        console.log(
          `✅ 3D background loaded: ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)} → scaled ${scale.toFixed(3)}`
        );
      },
      (progress) => {
        if (progress.total > 0) {
          const pct = ((progress.loaded / progress.total) * 100).toFixed(0);
          console.log(`🔄 Loading 3D model: ${pct}%`);
        }
      },
      (error) => {
        console.error('❌ Failed to load 3D model:', error);
      }
    );
  }

  private renderLoop = (): void => {
    this.animationId = requestAnimationFrame(this.renderLoop);

    const delta = this.clock.getDelta();

    // Tick animation mixer
    if (this.mixer) {
      this.mixer.update(delta);
    }

    if (this.animateCamera) {
      const elapsed = this.clock.getElapsedTime();
      // Very slow subtle drift
      this.camera.position.x = Math.sin(elapsed * 0.08) * 1.5;
      this.camera.position.y = 2 + Math.sin(elapsed * 0.05) * 0.5;
      this.camera.lookAt(0, 0, -15);
    }

    this.renderer.render(this.scene, this.camera);
  };

  private onResize(): void {
    this.syncSize();
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private syncSize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', () => this.onResize());
    this.renderer.dispose();
  }
}
