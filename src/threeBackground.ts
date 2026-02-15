import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TarotTearEffect, TearScreenRect } from './game/render/TarotTearEffect';

export interface ThreeBgOptions {
  canvas: HTMLCanvasElement;
  modelPath: string;
  animate: boolean;
}

// Feature color map — dominant hue from each tarot cardback
const FEATURE_COLORS: Record<string, THREE.Color> = {
  'T_FOOL':      new THREE.Color(0.1, 0.85, 0.3),   // Green
  'T_CUPS':      new THREE.Color(0.3, 0.5, 1.0),    // Blue
  'T_LOVERS':    new THREE.Color(0.9, 0.2, 0.3),    // Red/Rose
  'T_PRIESTESS': new THREE.Color(0.6, 0.3, 0.9),    // Purple
  'T_DEATH':     new THREE.Color(0.9, 0.15, 0.1),   // Dark Red
};

/** JS-side smoothstep (0→1 for t in 0→1) */
function smoothstepJS(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

export class ThreeBackground {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private bgGroup: THREE.Group;
  private clock: THREE.Clock;
  private _animateCamera: boolean; // Reserved for future camera animation
  private animationId: number = 0;
  
  // Feature color tinting
  private featureColorUniform = { value: new THREE.Color(0, 0, 0) }; // Black = no color
  private featureIntensityUniform = { value: 0.0 }; // 0 = grayscale, 1 = full spread
  private featureOriginUniform = { value: new THREE.Vector3(0, 0, 0) }; // Spread origin (model space)
  private targetIntensity: number = 0.0;
  private targetColor: THREE.Color = new THREE.Color(0, 0, 0);

  // Active tear effects
  private activeTearEffects: TarotTearEffect[] = [];

  // FOND mesh (circular element to rotate on Z axis)
  private fondMesh: THREE.Object3D | null = null;

  // Model swap support
  private mainModel: THREE.Object3D | null = null;
  private mainMixer: THREE.AnimationMixer | null = null;
  private mainBaseY: number = 0.0; // Base Y position for float animation
  private mainAnimTime: number = 0;

  // Fool model (for Fool feature)
  private foolModel: THREE.Object3D | null = null;
  private foolMixer: THREE.AnimationMixer | null = null;
  private isFoolSwapped: boolean = false;
  private foolReady: boolean = false;
  private foolBaseY: number = -3.5; // Base Y position for float animation
  private foolHaloMat: THREE.MeshStandardMaterial | null = null; // Reference for glow animation
  private foolAnimTime: number = 0;

  // Sol model (appears during Cups feature only, right side)
  private solModel: THREE.Object3D | null = null;
  private solMixer: THREE.AnimationMixer | null = null;
  private isSolSwapped: boolean = false;
  private solReady: boolean = false; // True once model is fully compiled on GPU
  private solBaseY: number = 1.5; // Base Y position for float animation
  private solAnimTime: number = 0;

  // Sol glow effect (organic noisy sprite)
  private solGlow: THREE.Sprite | null = null;

  // Fool glow effect (organic noisy sprite)
  private foolGlow: THREE.Sprite | null = null;

  // Queen of Swords model (for High Priestess feature)
  private queenModel: THREE.Object3D | null = null;
  private queenMixer: THREE.AnimationMixer | null = null;
  private isQueenSwapped: boolean = false;
  private queenReady: boolean = false;

  // Queen glow effect (organic noisy sprite)
  private queenGlow: THREE.Sprite | null = null;

  // Death model (appears during Death feature only)
  private deathModel: THREE.Object3D | null = null;
  private deathMixer: THREE.AnimationMixer | null = null;
  private isDeathSwapped: boolean = false;
  private deathReady: boolean = false;

  // Death glow effect (organic noisy sprite)
  private deathGlow: THREE.Sprite | null = null;

  // Lovers model (appears during Lovers feature only)
  private loversModel: THREE.Object3D | null = null;
  private loversMixer: THREE.AnimationMixer | null = null;
  private isLoversSwapped: boolean = false;
  private loversReady: boolean = false;
  private loversBaseY: number = 0; // Set after loading
  private loversAnimTime: number = 0;

  // Lovers glow effect (organic noisy sprite)
  private loversGlow: THREE.Sprite | null = null;

  // Shared GLTF loader with Draco support
  private _gltfLoader!: GLTFLoader;

  // Promise that resolves when the main model is loaded (for loading screen)
  public readonly mainModelReady: Promise<void>;
  private _resolveMainModelReady!: () => void;

  // Promise that resolves when ALL 3D models are loaded and pre-compiled
  public readonly modelsReady: Promise<void>;
  private _resolveModelsReady!: () => void;
  private _modelsLoadedCount: number = 0;
  private static readonly TOTAL_MODELS = 6; // main + fool + sol + queen + death + lovers

  
  constructor(options: ThreeBgOptions) {
    this._animateCamera = options.animate;
    this.clock = new THREE.Clock();

    // Create promises for loading milestones
    this.mainModelReady = new Promise<void>(resolve => {
      this._resolveMainModelReady = resolve;
    });
    this.modelsReady = new Promise<void>(resolve => {
      this._resolveModelsReady = resolve;
    });

    // ── Renderer ──
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: true, // transparent so page bg shows if needed
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.syncSize();

    // ── Scene ──
    this.scene = new THREE.Scene();


    // ── Camera ──
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 500);
    this.camera.position.set(-4.5, 0.0, 36.5);
    this.camera.lookAt(0, 0, 0);

    // ── Lighting: soft ambient + gentle directional lights ──
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);

    // Left-side directional light (shadow-casting, softer)
    const dirLeft = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLeft.position.set(-20, 10, 15);
    dirLeft.castShadow = true;
    dirLeft.shadow.mapSize.width = 2048;
    dirLeft.shadow.mapSize.height = 2048;
    dirLeft.shadow.camera.near = 0.5;
    dirLeft.shadow.camera.far = 200;
    dirLeft.shadow.camera.left = -60;
    dirLeft.shadow.camera.right = 60;
    dirLeft.shadow.camera.top = 60;
    dirLeft.shadow.camera.bottom = -60;
    dirLeft.shadow.bias = -0.001;
    dirLeft.shadow.normalBias = 0.02;
    dirLeft.shadow.radius = 4; // Soft blur on shadow edges
    this.scene.add(dirLeft);

    // Right-side directional light (shadow-casting, softer, mirrored)
    const dirRight = new THREE.DirectionalLight(0xffffff, 0.3);
    dirRight.position.set(20, 10, 15);
    dirRight.castShadow = true;
    dirRight.shadow.mapSize.width = 2048;
    dirRight.shadow.mapSize.height = 2048;
    dirRight.shadow.camera.near = 0.5;
    dirRight.shadow.camera.far = 200;
    dirRight.shadow.camera.left = -60;
    dirRight.shadow.camera.right = 60;
    dirRight.shadow.camera.top = 60;
    dirRight.shadow.camera.bottom = -60;
    dirRight.shadow.bias = -0.001;
    dirRight.shadow.normalBias = 0.02;
    dirRight.shadow.radius = 4; // Soft blur on shadow edges
    this.scene.add(dirRight);

    // Subtle top fill for depth on upper features (no shadows)
    const dirTop = new THREE.DirectionalLight(0xffffff, 0.15);
    dirTop.position.set(0, 25, 10);
    this.scene.add(dirTop);

    // ── Background group ──
    this.bgGroup = new THREE.Group();
    this.scene.add(this.bgGroup);

    // ── Set up GLTF loader ──
    this._gltfLoader = new GLTFLoader();

    // ── Load main model (always visible) ──
    this.loadModel(options.modelPath);

    // ── Load fool model (appears during Fool feature) ──
    this.loadFoolModel('/assets/3d/the_fool.glb');

    // ── Load sol model (appears during Cups feature) ──
    this.loadSolModel('/assets/3d/sol.glb');

    // ── Load queen of swords model (appears during Priestess feature) ──
    this.loadQueenModel('/assets/3d/the_queen_of_swords.glb');

    // ── Load death model (appears during Death feature) ──
    this.loadDeathModel('/assets/3d/death.glb');

    // ── Load lovers model (appears during Lovers feature) ──
    this.loadLoversModel('/assets/3d/lovers.glb');

    // ── Resize handling ──
    window.addEventListener('resize', () => this.onResize());

    // ── Start render loop ──
    this.renderLoop();
  }

  private loadModel(path: string): void {
    this._gltfLoader.load(
      path,
      (gltf) => {
        const model = gltf.scene;

        // Compute bounding box for logging
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());

        // Performance: frustum culling + desaturate to black & white
        model.traverse((child) => {
          // Log all mesh names for debugging
          if ((child as THREE.Mesh).isMesh) {
            console.log(`📦 Mesh found: "${child.name}"`);
          }

          // Capture FOND mesh for Z-axis rotation (case-insensitive check)
          if (child.name.toUpperCase().includes('FOND')) {
            this.fondMesh = child;
            child.position.y -= 200; // shift FOND mesh lower vertically
            console.log(`🔄 Found FOND mesh: "${child.name}" — shifted down & will rotate on Z axis`);
          }

          if ((child as THREE.Mesh).isMesh) {
            child.frustumCulled = true;

            // Engraved tarot style: grayscale + crushed blacks + posterize + edge ink + grain
            const mesh = child as THREE.Mesh;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            
            for (const mat of materials) {
              const applyFeatureColor = true;
              
              mat.onBeforeCompile = (shader) => {
                // Inject uniforms for feature color tinting
                shader.uniforms.featureColor = this.featureColorUniform;
                shader.uniforms.featureIntensity = this.featureIntensityUniform;
                shader.uniforms.featureOrigin = this.featureOriginUniform;
                
                shader.fragmentShader = `uniform vec3 featureColor;\nuniform float featureIntensity;\nuniform vec3 featureOrigin;\n#define APPLY_FEATURE_COLOR ${applyFeatureColor ? '1' : '0'}\n` + shader.fragmentShader;
                
                // Inject varying for world position
                shader.vertexShader = 'varying vec3 vWorldPos;\n' + shader.vertexShader;
                shader.vertexShader = shader.vertexShader.replace(
                  '#include <worldpos_vertex>',
                  `#include <worldpos_vertex>
                  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
                );
                shader.fragmentShader = 'varying vec3 vWorldPos;\n' + shader.fragmentShader;
                
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

                  // 6. Feature color tint — only on actual model, not background
                  vec3 grayVec = vec3(gray);
                  
                  #if APPLY_FEATURE_COLOR == 1
                    // Subtle hue across entire model (darks get more color, brights less)
                    float darkMask = 1.0 - smoothstep(0.1, 0.85, gray);
                    vec3 tinted = mix(grayVec, grayVec * featureColor * 2.15, darkMask * 0.6);
                    
                    // Spread from random origin
                    float dist = length(vWorldPos - featureOrigin);
                    float spreadRadius = featureIntensity * 80.0;
                    float spreadMask = 1.0 - smoothstep(spreadRadius * 0.6, spreadRadius, dist);
                    
                    gl_FragColor.rgb = mix(grayVec, tinted, spreadMask * featureIntensity);
                  #else
                    // Background/radiant — stay grayscale only
                    gl_FragColor.rgb = grayVec;
                  #endif
                  `
                );
              };
            }
          }
        });

        this.bgGroup.add(model);
        this.mainModel = model;

        // Position the main model (not bgGroup, so swap models keep their own positions)
        model.position.set(11.5, 0.0, 12.0);
        this.mainBaseY = 0.0; // Store base Y for float animation
        model.rotation.set(0.02, -0.07, 0.06);
        model.scale.setScalar(10.0);

        // Detach FOND mesh from the main model so it stays visible during model swaps.
        // We need to update the matrix first so world transform is computed, then reparent.
        if (this.fondMesh) {
          model.updateMatrixWorld(true);
          // Reparent FOND to bgGroup while preserving its world transform
          const fond = this.fondMesh;
          const worldPos = new THREE.Vector3();
          const worldQuat = new THREE.Quaternion();
          const worldScale = new THREE.Vector3();
          fond.getWorldPosition(worldPos);
          fond.getWorldQuaternion(worldQuat);
          fond.getWorldScale(worldScale);

          fond.removeFromParent();
          this.bgGroup.add(fond);
          fond.position.copy(worldPos);
          fond.quaternion.copy(worldQuat);
          fond.scale.copy(worldScale);

          console.log('🔄 FOND mesh reparented to bgGroup — will persist across model swaps');
        }

        // ── Play animations if available ──
        if (gltf.animations && gltf.animations.length > 0) {
          this.mainMixer = new THREE.AnimationMixer(model);
          for (const clip of gltf.animations) {
            const action = this.mainMixer.clipAction(clip);
            action.play();
          }
          console.log(`🎬 Playing ${gltf.animations.length} animation(s): ${gltf.animations.map(a => a.name || 'unnamed').join(', ')}`);
        }

        console.log(
          `✅ 3D background loaded: ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)} → scaled ${scale.toFixed(3)}`
        );
        this._resolveMainModelReady();
        this._onModelLoaded();

      },
      (progress) => {
        if (progress.total > 0) {
          const pct = ((progress.loaded / progress.total) * 100).toFixed(0);
          console.log(`🔄 Loading 3D model: ${pct}%`);
        }
      },
      (error) => {
        console.error('❌ Failed to load 3D model:', error);
        // Resolve anyway so loading screen doesn't hang
        this._resolveMainModelReady();
        this._onModelLoaded();
      }
    );
  }

  private renderLoop = (): void => {
    this.animationId = requestAnimationFrame(this.renderLoop);

    const rawDelta = this.clock.getDelta();
    // Clamp delta to avoid animation speed-up after tab switch
    // (browsers pause requestAnimationFrame when tab is hidden, causing a huge delta spike on return)
    const delta = Math.min(rawDelta, 1 / 30);

    // Tick animation mixers — main model always runs
    if (this.mainMixer) {
      this.mainMixer.update(delta * 3);
    }
    // Main model (ancient woman) float up/down animation — always active
    if (this.mainModel) {
      this.mainAnimTime += delta;
      const floatOffset = Math.sin(this.mainAnimTime * 0.8) * 0.3;
      this.mainModel.position.y = this.mainBaseY + floatOffset;
    }
    // Fool model mixer — tick whenever visible
    if (this.foolMixer && this.foolModel?.visible) {
      this.foolMixer.update(delta * 1.0);
    }
    // Fool float + halo glow animation
    if (this.foolModel?.visible) {
      this.foolAnimTime += delta;
      // Gentle float up/down — small range, slow
      const floatOffset = Math.sin(this.foolAnimTime * 0.8) * 0.3;
      this.foolModel.position.y = this.foolBaseY + floatOffset;
      // Halo glow pulse — opacity oscillates gently
      if (this.foolHaloMat) {
        const pulse = 0.15 + 0.12 * Math.sin(this.foolAnimTime * 1.5);
        this.foolHaloMat.opacity = pulse;
      }
    }
    // Sol model mixer — only tick when visible during Cups feature
    if (this.solMixer && this.isSolSwapped) {
      this.solMixer.update(delta * 1.0);
    }
    // Sol float up/down animation
    if (this.solModel?.visible) {
      this.solAnimTime += delta;
      const floatOffset = Math.sin(this.solAnimTime * 0.8) * 0.3;
      this.solModel.position.y = this.solBaseY + floatOffset;
    }
    // Queen of Swords mixer — tick whenever the model is visible
    if (this.queenMixer && this.queenModel?.visible) {
      this.queenMixer.update(delta * 1.0);
    }
    // Death model mixer — tick only during Death feature (slow, dramatic pace)
    if (this.deathMixer && this.isDeathSwapped) {
      this.deathMixer.update(delta * 0.15);
    }
    // Lovers flipbook frame cycling + float + slow Y rotation
    if (this.loversModel?.visible) {
      this.loversAnimTime += delta;
      const floatOffset = Math.sin(this.loversAnimTime * 0.8) * 0.3;
      this.loversModel.position.y = this.loversBaseY + floatOffset;
      this.loversModel.rotation.y += delta * 0.15; // Slow constant Y rotation

      // Cycle flipbook frames
      const frames = (this.loversModel as any)._loversFrames as THREE.Object3D[] | undefined;
      if (frames && frames.length > 1) {
        const m = this.loversModel as any;
        m._loversFrameTimer += delta;
        const frameDuration = 0.25; // seconds per frame
        if (m._loversFrameTimer >= frameDuration) {
          m._loversFrameTimer -= frameDuration;
          frames[m._loversFrameIndex].visible = false;
          m._loversFrameIndex = (m._loversFrameIndex + 1) % frames.length;
          frames[m._loversFrameIndex].visible = true;
        }
      }
    }

    // Rotate FOND mesh around Z axis
    if (this.fondMesh) {
      this.fondMesh.rotation.z += delta * 0.08; // slow steady spin
    }

    // Smooth transition for feature color tinting
    const lerpSpeed = 2.0 * delta; // Smooth ~0.5s transition
    this.featureIntensityUniform.value += (this.targetIntensity - this.featureIntensityUniform.value) * Math.min(lerpSpeed, 1);
    this.featureColorUniform.value.lerp(this.targetColor, Math.min(lerpSpeed, 1));

    this.renderer.render(this.scene, this.camera);
  };

  /** Optional callback for external progress tracking (0..1) */
  public onModelProgress: ((progress: number) => void) | null = null;

  /** Track model load progress; resolve modelsReady when all are done */
  private _onModelLoaded(): void {
    this._modelsLoadedCount++;
    console.log(`🔄 3D models loaded: ${this._modelsLoadedCount}/${ThreeBackground.TOTAL_MODELS}`);
    this.onModelProgress?.(this._modelsLoadedCount / ThreeBackground.TOTAL_MODELS);
    if (this._modelsLoadedCount >= ThreeBackground.TOTAL_MODELS) {
      this._resolveModelsReady();
    }
  }

  private onResize(): void {
    this.syncSize();
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  private syncSize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** Tint the 3D model with the feature's cardback color, spreading from random origin */
  setFeatureColor(featureType: string): void {
    const color = FEATURE_COLORS[featureType];
    if (color) {
      this.targetColor = color.clone();
      this.targetIntensity = 1.0;
      
      // Pick random origin point on the model for spread effect
      const rx = (Math.random() - 0.5) * 40;
      const ry = (Math.random() - 0.5) * 40;
      const rz = (Math.random() - 0.5) * 20;
      this.featureOriginUniform.value.set(rx, ry, rz);
      
      console.log(`🎨 3D model tinting: ${featureType} from origin (${rx.toFixed(1)}, ${ry.toFixed(1)}, ${rz.toFixed(1)})`);
    }
  }

  /** Return model to grayscale */
  clearFeatureColor(): void {
    this.targetIntensity = 0.0;
    console.log('🎨 3D model returning to grayscale');
  }

  /**
   * Play tear effects for multiple tarot columns simultaneously.
   * Creates a temporary overlay canvas with its own Three.js renderer for the tear.
   * @param columns - Array of { imagePath, screenRect } for each tarot column
   * @param stagger - Delay in ms between each column tear (default 150)
   */
  async playTearEffects(
    columns: { imagePath: string; screenRect: TearScreenRect }[],
    stagger: number = 150,
    clipRect?: { x: number; y: number; width: number; height: number },
    onReady?: () => void
  ): Promise<void> {
    // Create a temporary overlay canvas for the tear effect
    const tearCanvas = document.createElement('canvas');
    tearCanvas.style.position = 'fixed';
    tearCanvas.style.top = '0';
    tearCanvas.style.left = '0';
    tearCanvas.style.width = '100vw';
    tearCanvas.style.height = '100vh';
    tearCanvas.style.zIndex = '10'; // Above PixiJS canvas
    tearCanvas.style.pointerEvents = 'none';

    // Clip to grid area so the tear doesn't overlap the frame
    if (clipRect) {
      const left = clipRect.x;
      const top = clipRect.y;
      const right = clipRect.x + clipRect.width;
      const bottom = clipRect.y + clipRect.height;
      tearCanvas.style.clipPath = `polygon(${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px)`;
    }

    document.body.appendChild(tearCanvas);

    // Create a dedicated renderer for the tear overlay
    const tearRenderer = new THREE.WebGLRenderer({
      canvas: tearCanvas,
      antialias: true,
      alpha: true, // Transparent background so only the tear is visible
    });
    tearRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    tearRenderer.setSize(window.innerWidth, window.innerHeight);
    tearRenderer.setClearColor(0x000000, 0); // Fully transparent
    tearRenderer.outputColorSpace = THREE.SRGBColorSpace;
    tearRenderer.toneMapping = THREE.NoToneMapping; // No tone mapping — texture is pre-styled

    // Create a dedicated scene and camera for the tear
    const tearScene = new THREE.Scene();
    const aspect = window.innerWidth / window.innerHeight;
    const tearCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 500);
    tearCamera.position.set(0, 0, 10); // Simple front-facing camera
    tearCamera.lookAt(0, 0, 0);

    // Ambient light — kept low to match the muted engraved PixiJS style
    const light = new THREE.AmbientLight(0xffffff, 1.0);
    tearScene.add(light);

    // Start a render loop for the tear scene
    let tearAnimating = true;
    const renderTear = () => {
      if (!tearAnimating) return;
      tearRenderer.render(tearScene, tearCamera);
      requestAnimationFrame(renderTear);
    };
    requestAnimationFrame(renderTear);

    try {
      // 1. Create all effects and start loading textures in parallel
      const effects: TarotTearEffect[] = [];
      for (const col of columns) {
        const effect = new TarotTearEffect(
          tearScene,
          tearCamera,
          col.imagePath,
          col.screenRect
        );
        effects.push(effect);
        this.activeTearEffects.push(effect);
      }

      // 2. Wait for ALL textures to be loaded
      await Promise.all(effects.map(e => e.ready));

      // 3. Position all tear cards in the scene (so they're visible on next render)
      for (const effect of effects) {
        effect.setup();
      }

      // 4. Render one frame so the Three.js tear cards are on screen
      tearRenderer.render(tearScene, tearCamera);

      // 5. NOW swap the PixiJS symbols — Three.js cards are already covering them
      if (onReady) onReady();

      // 5. Play tear animations with stagger
      const playPromises: Promise<void>[] = [];
      for (let i = 0; i < effects.length; i++) {
        const effect = effects[i];
        const delayMs = i * stagger;

        playPromises.push(
          new Promise<void>(resolve => setTimeout(resolve, delayMs)).then(async () => {
            try {
              await effect.play();
            } finally {
              effect.dispose();
              this.activeTearEffects = this.activeTearEffects.filter(e => e !== effect);
            }
          })
        );
      }

      await Promise.all(playPromises);
    } finally {
      // Tear down the overlay
      tearAnimating = false;
      tearRenderer.dispose();
      tearCanvas.remove();
    }
  }

  /**
   * Apply the engraved grayscale + feature color shader to all meshes in a model.
   */
  private applyEngravedShader(model: THREE.Object3D): void {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.frustumCulled = true;
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const oldMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

        // Replace every material with a fresh opaque MeshStandardMaterial,
        // preserving only the diffuse map (color texture) for the engraved shader.
        const newMaterials: THREE.Material[] = [];
        for (const oldMat of oldMaterials) {
          const oldStd = oldMat as THREE.MeshStandardMaterial;
          const newMat = new THREE.MeshStandardMaterial({
            map: oldStd.map || null,           // keep diffuse texture
            color: oldStd.color ? oldStd.color.clone() : new THREE.Color(0xffffff),
            normalMap: oldStd.normalMap || null,
            metalness: 0,
            roughness: 1.0,
            transparent: false,
            opacity: 1.0,
            depthWrite: true,
            side: THREE.FrontSide,
            alphaTest: 0,
            blending: THREE.NormalBlending,
          });
          newMaterials.push(newMat);
          oldMat.dispose(); // free old material
        }
        mesh.material = newMaterials.length === 1 ? newMaterials[0] : newMaterials;

        const materials = newMaterials;

        for (const mat of materials) {
          mat.onBeforeCompile = (shader) => {
            shader.uniforms.featureColor = this.featureColorUniform;
            shader.uniforms.featureIntensity = this.featureIntensityUniform;
            shader.uniforms.featureOrigin = this.featureOriginUniform;

            shader.fragmentShader = `uniform vec3 featureColor;\nuniform float featureIntensity;\nuniform vec3 featureOrigin;\n#define APPLY_FEATURE_COLOR 1\n` + shader.fragmentShader;

            shader.vertexShader = 'varying vec3 vWorldPos;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
              '#include <worldpos_vertex>',
              `#include <worldpos_vertex>
              vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
            );
            shader.fragmentShader = 'varying vec3 vWorldPos;\n' + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(
              '#include <dithering_fragment>',
              `
              #include <dithering_fragment>
              float gray = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
              gray = clamp(gray * 2.5, 0.0, 1.0);
              gray = pow(gray, 0.7);
              gray = smoothstep(0.05, 0.95, gray);
              float dx = dFdx(gray);
              float dy = dFdy(gray);
              float edge = sqrt(dx * dx + dy * dy);
              edge = smoothstep(0.02, 0.08, edge);
              gray = gray * (1.0 - edge * 0.4);
              vec2 uv = gl_FragCoord.xy;
              float noise = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
              noise = (noise - 0.5) * 0.04;
              gray = clamp(gray + noise, 0.0, 1.0);
              vec3 grayVec = vec3(gray);
              float darkMask = 1.0 - smoothstep(0.1, 0.85, gray);
              vec3 tinted = mix(grayVec, grayVec * featureColor * 2.15, darkMask * 0.6);
              float dist = length(vWorldPos - featureOrigin);
              float spreadRadius = featureIntensity * 80.0;
              float spreadMask = 1.0 - smoothstep(spreadRadius * 0.6, spreadRadius, dist);
              gl_FragColor.rgb = mix(grayVec, tinted, spreadMask * featureIntensity);
              `
            );
          };
        }
      }
    });
  }

  /**
   * Apply engraved shader while preserving alpha maps, alpha test, and transparency
   * from the original materials. Used for models with detailed textures (e.g. hair, clothing edges).
   */
  private applyEngravedShaderPreserveAlpha(model: THREE.Object3D): void {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.frustumCulled = true;
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const oldMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

        const newMaterials: THREE.Material[] = [];
        for (const oldMat of oldMaterials) {
          const oldStd = oldMat as THREE.MeshStandardMaterial;
          // Check if diffuse map uses alpha channel or if there's an explicit alpha map
          const hasAlpha = oldStd.alphaMap || oldStd.transparent || (oldStd.alphaTest && oldStd.alphaTest > 0);
          const newMat = new THREE.MeshStandardMaterial({
            map: oldStd.map || null,
            color: oldStd.color ? oldStd.color.clone() : new THREE.Color(0xffffff),
            normalMap: oldStd.normalMap || null,
            aoMap: oldStd.aoMap || null,
            emissiveMap: oldStd.emissiveMap || null,
            emissive: oldStd.emissive ? oldStd.emissive.clone() : new THREE.Color(0x000000),
            alphaMap: oldStd.alphaMap || null,
            alphaTest: oldStd.alphaTest || (hasAlpha ? 0.5 : 0),
            transparent: oldStd.transparent || false,
            opacity: oldStd.opacity !== undefined ? oldStd.opacity : 1.0,
            metalness: 0,
            roughness: 1.0,
            depthWrite: true,
            side: oldStd.side !== undefined ? oldStd.side : THREE.DoubleSide,
            blending: THREE.NormalBlending,
          });
          newMaterials.push(newMat);
          oldMat.dispose();
        }
        mesh.material = newMaterials.length === 1 ? newMaterials[0] : newMaterials;

        for (const mat of newMaterials) {
          mat.onBeforeCompile = (shader) => {
            shader.uniforms.featureColor = this.featureColorUniform;
            shader.uniforms.featureIntensity = this.featureIntensityUniform;
            shader.uniforms.featureOrigin = this.featureOriginUniform;

            shader.fragmentShader = `uniform vec3 featureColor;\nuniform float featureIntensity;\nuniform vec3 featureOrigin;\n#define APPLY_FEATURE_COLOR 1\n` + shader.fragmentShader;

            shader.vertexShader = 'varying vec3 vWorldPos;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
              '#include <worldpos_vertex>',
              `#include <worldpos_vertex>
              vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;`
            );
            shader.fragmentShader = 'varying vec3 vWorldPos;\n' + shader.fragmentShader;

            shader.fragmentShader = shader.fragmentShader.replace(
              '#include <dithering_fragment>',
              `
              #include <dithering_fragment>
              float gray = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
              gray = clamp(gray * 2.5, 0.0, 1.0);
              gray = pow(gray, 0.7);
              gray = smoothstep(0.05, 0.95, gray);
              float dx = dFdx(gray);
              float dy = dFdy(gray);
              float edge = sqrt(dx * dx + dy * dy);
              edge = smoothstep(0.02, 0.08, edge);
              gray = gray * (1.0 - edge * 0.4);
              vec2 uv = gl_FragCoord.xy;
              float noise = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
              noise = (noise - 0.5) * 0.04;
              gray = clamp(gray + noise, 0.0, 1.0);
              vec3 grayVec = vec3(gray);
              float darkMask = 1.0 - smoothstep(0.1, 0.85, gray);
              vec3 tinted = mix(grayVec, grayVec * featureColor * 2.15, darkMask * 0.6);
              float dist = length(vWorldPos - featureOrigin);
              float spreadRadius = featureIntensity * 80.0;
              float spreadMask = 1.0 - smoothstep(spreadRadius * 0.6, spreadRadius, dist);
              gl_FragColor.rgb = mix(grayVec, tinted, spreadMask * featureIntensity);
              `
            );
          };
        }
      }
    });
  }

  /**
   * Load the sol.glb model as a second always-present model.
   * Creates a debug slider panel for adjusting position, rotation, and scale.
   */
  private loadSolModel(path: string): void {
    this._gltfLoader.load(
      path,
      (gltf) => {
        const model = gltf.scene;

        // Remove unwanted meshes (like Plane001 if present)
        const toRemove: THREE.Object3D[] = [];
        model.traverse((child: THREE.Object3D) => {
          if (child.name === 'Plane001') {
            toRemove.push(child);
          }
          if ((child as THREE.Mesh).isMesh) {
            console.log(`📦 Sol mesh: "${child.name}"`);
          }
        });
        for (const obj of toRemove) obj.removeFromParent();

        // Apply the engraved shader
        this.applyEngravedShader(model);

        // Balance sol materials — lift dark reds but keep bottom from blooming
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
              const stdMat = mat as THREE.MeshStandardMaterial;
              if (stdMat.color) {
                stdMat.color.multiplyScalar(0.55);
                stdMat.needsUpdate = true;
              }
            }
          }
        });

        // Hardcoded transform values — starts hidden
        model.position.set(-17.0, 1.5, -5.5);
        model.rotation.set(0.15, 0.21, -0.03);
        model.scale.setScalar(0.1);
        model.visible = false;

        // Create organic glow sprite at sol's position for entrance/exit effect
        const glowTexture = this.generateGlowTexture();
        const glowMat = new THREE.SpriteMaterial({
          map: glowTexture,
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const glowSprite = new THREE.Sprite(glowMat);
        glowSprite.position.copy(model.position);
        glowSprite.scale.setScalar(0.1);
        glowSprite.visible = false;
        this.bgGroup.add(glowSprite);
        this.solGlow = glowSprite;

        this.bgGroup.add(model);
        this.solModel = model;

        // Set up animations if available
        if (gltf.animations && gltf.animations.length > 0) {
          this.solMixer = new THREE.AnimationMixer(model);
          for (const clip of gltf.animations) {
            this.solMixer.clipAction(clip).play();
          }
          console.log(`🎬 Sol: ${gltf.animations.length} animation(s)`);
        }

        // Pre-compile: render the model once (fully opaque, off-camera) to warm the GPU
        // This prevents the see-through glitch on first appearance
        model.visible = true;
        this.renderer.compile(this.scene, this.camera);
        this.renderer.render(this.scene, this.camera);
        model.visible = false;
        this.solReady = true;
        this._onModelLoaded();

        console.log(`✅ Sol model loaded & pre-compiled: ${path}`);
      },
      undefined,
      (error) => {
        console.error('❌ Failed to load Sol model:', error);
        this._onModelLoaded();
      }
    );
  }

  /**
   * Load the queen of swords model for the High Priestess feature.
   */
  private loadQueenModel(path: string): void {
    this._gltfLoader.load(
      path,
      (gltf) => {
        const model = gltf.scene;

        // Log all meshes and their materials for debugging
        model.traverse((child: THREE.Object3D) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
              const stdMat = mat as THREE.MeshStandardMaterial;
              console.log(`📦 Queen mesh: "${child.name}" | mat: "${mat.name}" | map: ${!!stdMat.map} | alphaMap: ${!!(stdMat as any).alphaMap} | alphaTest: ${(stdMat as any).alphaTest} | transparent: ${mat.transparent} | opacity: ${mat.opacity}`);
            }
          }
        });

        // Apply the engraved shader — preserve alpha maps for proper textures
        this.applyEngravedShaderPreserveAlpha(model);

        // No extra darkening — let the engraved shader + scene lighting
        // handle contrast naturally, same as the ancient woman model

        // Transform values — still visible for adjustments
        model.position.set(-19.0, -5.0, -6.5);
        model.rotation.set(0.06, 0.00, 0.00);
        model.scale.setScalar(0.1);
        model.visible = false; // Hidden by default, shown during Priestess feature

        // Create organic glow sprite at queen's position for entrance/exit effect
        const queenGlowTexture = this.generateGlowTexture();
        const queenGlowMat = new THREE.SpriteMaterial({
          map: queenGlowTexture,
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const queenGlowSprite = new THREE.Sprite(queenGlowMat);
        // Position glow at the visual center of the model (X/Z from position, Y at midpoint of bounding box)
        const queenBox = new THREE.Box3().setFromObject(model);
        const queenSize = queenBox.getSize(new THREE.Vector3());
        queenGlowSprite.position.set(model.position.x, model.position.y + queenSize.y * 0.75, model.position.z);
        queenGlowSprite.scale.setScalar(0.1);
        queenGlowSprite.visible = false;
        this.bgGroup.add(queenGlowSprite);
        this.queenGlow = queenGlowSprite;

        this.bgGroup.add(model);
        this.queenModel = model;

        // Set up animations — log durations and clamp to useful range
        if (gltf.animations && gltf.animations.length > 0) {
          this.queenMixer = new THREE.AnimationMixer(model);
          for (const clip of gltf.animations) {
            console.log(`🎬 Queen clip: "${clip.name}" duration: ${clip.duration.toFixed(2)}s tracks: ${clip.tracks.length}`);
            const action = this.queenMixer.clipAction(clip);
            action.setLoop(THREE.LoopPingPong, Infinity);
            action.play();
          }
          console.log(`🎬 Queen: ${gltf.animations.length} animation(s)`);
        }

        // Store target scale for entrance animation
        model.userData.targetScale = 0.1;

        // Pre-compile to avoid first-frame glitches
        model.visible = true;
        this.renderer.compile(this.scene, this.camera);
        this.renderer.render(this.scene, this.camera);
        model.visible = false;
        this.queenReady = true;
        this._onModelLoaded();

        console.log(`✅ Queen of Swords model loaded & pre-compiled: ${path}`);
      },
      undefined,
      (error) => {
        console.error('❌ Failed to load Queen model:', error);
        this._onModelLoaded();
      }
    );
  }

  /**
   * Load the death.glb model — always visible with debug slider panel for adjustments.
   */
  private loadDeathModel(path: string): void {
    this._gltfLoader.load(
      path,
      (gltf) => {
        const model = gltf.scene;

        // Log all meshes
        model.traverse((child: THREE.Object3D) => {
          if ((child as THREE.Mesh).isMesh) {
            console.log(`📦 Death mesh: "${child.name}"`);
          }
        });

        // Apply the engraved shader with alpha preservation
        this.applyEngravedShaderPreserveAlpha(model);

        // Darken materials slightly to match scene style
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
              const stdMat = mat as THREE.MeshStandardMaterial;
              if (stdMat.color) {
                stdMat.color.multiplyScalar(0.55);
                stdMat.needsUpdate = true;
              }
            }
          }
        });

        // Initial transform — hidden by default, shown during Death feature
        model.position.set(-15.0, -6.0, 5.0);
        model.rotation.set(0.00, 0.49, 0.00);
        model.scale.setScalar(1.0);
        model.visible = false;

        // Hard light to brighten the Death model
        const deathLight = new THREE.DirectionalLight(0xffffff, 1.5);
        deathLight.position.set(-15.0, 10.0, 20.0); // Aimed from front-above at the model
        deathLight.target = model;
        this.scene.add(deathLight);
        this.scene.add(deathLight.target);

        // Create organic glow sprite at death model's position for entrance/exit effect
        const deathGlowTexture = this.generateGlowTexture();
        const deathGlowMat = new THREE.SpriteMaterial({
          map: deathGlowTexture,
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const deathGlowSprite = new THREE.Sprite(deathGlowMat);
        deathGlowSprite.position.copy(model.position);
        deathGlowSprite.position.y += 3; // Center glow at roughly the model's visual center
        deathGlowSprite.scale.setScalar(0.1);
        deathGlowSprite.visible = false;
        this.bgGroup.add(deathGlowSprite);
        this.deathGlow = deathGlowSprite;

        this.bgGroup.add(model);
        this.deathModel = model;

        // Set up animations if available
        if (gltf.animations && gltf.animations.length > 0) {
          this.deathMixer = new THREE.AnimationMixer(model);
          for (const clip of gltf.animations) {
            console.log(`🎬 Death clip: "${clip.name}" duration: ${clip.duration.toFixed(2)}s tracks: ${clip.tracks.length}`);
            // Only loop the first 1 second of the animation
            const subClip = THREE.AnimationUtils.subclip(clip, clip.name + '_sub', 0, 30, 30);
            const action = this.deathMixer.clipAction(subClip);
            action.setLoop(THREE.LoopPingPong, Infinity);
            action.play();
          }
          console.log(`🎬 Death: ${gltf.animations.length} animation(s)`);
        }

        // Pre-compile to avoid first-frame glitches
        model.visible = true;
        this.renderer.compile(this.scene, this.camera);
        this.renderer.render(this.scene, this.camera);
        model.visible = false;
        this.deathReady = true;
        this._onModelLoaded();

        console.log(`✅ Death model loaded & pre-compiled: ${path}`);
      },
      undefined,
      (error) => {
        console.error('❌ Failed to load Death model:', error);
        this._onModelLoaded();
      }
    );
  }

  /**
   * Load the lovers.glb model for the Lovers feature.
   * Includes debug slider panel for positioning.
   */
  private loadLoversModel(path: string): void {
    this._gltfLoader.load(
      path,
      (gltf) => {
        const model = gltf.scene;

        // Log all meshes
        model.traverse((child: THREE.Object3D) => {
          if ((child as THREE.Mesh).isMesh) {
            console.log(`📦 Lovers mesh: "${child.name}"`);
          }
        });

        // Apply the engraved shader with alpha preservation
        this.applyEngravedShaderPreserveAlpha(model);

        // Darken materials slightly to match scene style
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
              const stdMat = mat as THREE.MeshStandardMaterial;
              if (stdMat.color) {
                stdMat.color.multiplyScalar(0.55);
                stdMat.needsUpdate = true;
              }
            }
          }
        });

        // Hardcoded transform — hidden by default, shown during Lovers feature
        model.position.set(-15.5, -3.0, 5.0);
        model.rotation.set(0.10, 12.38, 0.00);
        model.scale.setScalar(3.6);
        model.visible = false;

        this.loversBaseY = model.position.y;

        // Create organic glow sprite for entrance/exit effect
        const loversGlowTexture = this.generateGlowTexture();
        const loversGlowMat = new THREE.SpriteMaterial({
          map: loversGlowTexture,
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const loversGlowSprite = new THREE.Sprite(loversGlowMat);
        loversGlowSprite.position.copy(model.position);
        loversGlowSprite.position.y += 3;
        loversGlowSprite.scale.setScalar(0.1);
        loversGlowSprite.visible = false;
        this.bgGroup.add(loversGlowSprite);
        this.loversGlow = loversGlowSprite;

        this.bgGroup.add(model);
        this.loversModel = model;

        // The GLB contains 7 frame groups (frame_0 through frame_6) — same
        // sculpture at different stop-motion stages. We cycle through them
        // manually as a flipbook in the render loop.
        // Force all frame containers to scale 1, but hide all except the first.
        const loversFrames: THREE.Object3D[] = [];
        const frameNodeNames = ['Object_50', 'Object_42', 'Object_34', 'Object_26', 'Object_18', 'Object_10', 'Object_2'];
        model.traverse((child: THREE.Object3D) => {
          if (frameNodeNames.includes(child.name)) {
            child.scale.setScalar(1);
            child.visible = false;
            loversFrames.push(child);
          }
        });
        // Sort to match frame order (Object_50=frame_0, Object_42=frame_1, etc.)
        loversFrames.sort((a, b) => frameNodeNames.indexOf(a.name) - frameNodeNames.indexOf(b.name));
        if (loversFrames.length > 0) {
          loversFrames[0].visible = true;
        }
        // Store frames for render loop cycling
        (model as any)._loversFrames = loversFrames;
        (model as any)._loversFrameIndex = 0;
        (model as any)._loversFrameTimer = 0;
        console.log(`🎬 Lovers: ${loversFrames.length} flipbook frames set up for manual cycling`);

        // Pre-compile to avoid first-frame glitches
        model.visible = true;
        this.renderer.compile(this.scene, this.camera);
        this.renderer.render(this.scene, this.camera);
        model.visible = false;
        this.loversReady = true;
        this._onModelLoaded();

        console.log(`✅ Lovers model loaded & pre-compiled: ${path}`);
      },
      undefined,
      (error) => {
        console.error('❌ Failed to load Lovers model:', error);
        this._onModelLoaded();
      }
    );
  }


  /**
   * Bring in queen of swords for the High Priestess feature — scales up.
   */
  swapToQueen(): Promise<void> {
    return new Promise((resolve) => {
      if (this.isQueenSwapped && this.queenModel) {
        resolve();
        return;
      }

      if (!this.queenReady || !this.queenModel) {
        console.warn('⏳ Queen model not ready yet, waiting...');
        const checkInterval = setInterval(() => {
          if (this.queenReady && this.queenModel) {
            clearInterval(checkInterval);
            this.animateQueenEntrance().then(resolve);
          }
        }, 100);
        return;
      }

      this.animateQueenEntrance().then(resolve);
    });
  }

  /**
   * Animate queen entrance: glow builds up, model pops in fully opaque behind glow,
   * then glow fades to reveal the solid model. Matches Sol entrance style.
   */
  private animateQueenEntrance(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.queenModel || !this.queenGlow) { resolve(); return; }

      const model = this.queenModel;
      const glow = this.queenGlow;
      const glowMat = glow.material as THREE.SpriteMaterial;

      glow.visible = true;
      glow.scale.setScalar(0.1);
      glowMat.opacity = 0;
      model.visible = false;
      this.isQueenSwapped = true;

      const duration = 1800;
      const startTime = performance.now();
      const maxGlowScale = 10;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);

        if (t < 0.35) {
          const p = t / 0.35;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(0.1 + maxGlowScale * eased);
          glowMat.opacity = eased * 0.95;
        } else {
          if (!model.visible) {
            model.visible = true;
          }
          const p = (t - 0.35) / 0.65;
          const eased = p * p * p;
          glow.scale.setScalar(maxGlowScale * (1 - eased * 0.6));
          glowMat.opacity = 0.95 * (1 - eased);
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          glow.visible = false;
          glowMat.opacity = 0;
          model.visible = true;
          console.log('⚔️ Queen of Swords materialized from glow');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  /**
   * Animate queen exit: glow expands over the model, model hides behind glow,
   * then glow fades away. Matches Sol exit style.
   */
  restoreQueen(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isQueenSwapped || !this.queenModel) {
        resolve();
        return;
      }

      const model = this.queenModel;
      const glow = this.queenGlow;

      if (!glow) {
        model.visible = false;
        this.isQueenSwapped = false;
        resolve();
        return;
      }

      const glowMat = glow.material as THREE.SpriteMaterial;

      glow.visible = true;
      glow.scale.setScalar(0.1);
      glowMat.opacity = 0;

      const duration = 1200;
      const startTime = performance.now();
      const maxGlowScale = 10;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);

        if (t < 0.4) {
          const p = t / 0.4;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(0.1 + maxGlowScale * eased);
          glowMat.opacity = eased * 0.95;
        } else {
          if (model.visible) {
            model.visible = false;
          }
          const p = (t - 0.4) / 0.6;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(maxGlowScale * (1 - eased * 0.85));
          glowMat.opacity = 0.95 * (1 - eased);
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          glow.visible = false;
          glowMat.opacity = 0;
          model.visible = false;
          this.isQueenSwapped = false;
          console.log('⚔️ Queen of Swords dissolved into glow');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  /**
   * Load the fool model for the Fool feature.
   */
  private loadFoolModel(path: string): void {
    this._gltfLoader.load(
      path,
      (gltf) => {
        const model = gltf.scene;

        // Log all meshes
        model.traverse((child: THREE.Object3D) => {
          if ((child as THREE.Mesh).isMesh) {
            console.log(`📦 Fool mesh: "${child.name}"`);
          }
        });

        // Apply the engraved shader with alpha preservation
        this.applyEngravedShaderPreserveAlpha(model);

        // Darken to reduce bloom + make HaloRed mesh very transparent
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
              const stdMat = mat as THREE.MeshStandardMaterial;
              if (child.name.includes('HaloRed') || child.name.includes('haloRed') || child.name.includes('Halo')) {
                console.log(`🔴 Found halo mesh: "${child.name}" — white glow`);
                this.foolHaloMat = stdMat; // Save reference for glow animation
                stdMat.color = new THREE.Color(1.0, 1.0, 1.0);
                stdMat.emissive = new THREE.Color(0.3, 0.3, 0.3);
                stdMat.transparent = true;
                stdMat.opacity = 0.25;
                stdMat.depthWrite = false;
                stdMat.blending = THREE.AdditiveBlending;
                // White glow: filled center with soft faded edges
                stdMat.onBeforeCompile = (shader) => {
                  shader.vertexShader = 'varying vec2 vUv;\n' + shader.vertexShader;
                  shader.vertexShader = shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    '#include <begin_vertex>\nvUv = uv;'
                  );
                  shader.fragmentShader = 'varying vec2 vUv;\n' + shader.fragmentShader;
                  shader.fragmentShader = shader.fragmentShader.replace(
                    '#include <dithering_fragment>',
                    `#include <dithering_fragment>
                    // White glow: solid fill in center, soft fade at edges
                    float dist = length(vUv - vec2(0.5));
                    float glow = 1.0 - smoothstep(0.15, 0.5, dist);
                    gl_FragColor.rgb = vec3(1.0); // Force white
                    gl_FragColor.a *= glow;
                    `
                  );
                };
                stdMat.needsUpdate = true;
              } else if (stdMat.color) {
                stdMat.color.multiplyScalar(0.55);
                stdMat.needsUpdate = true;
              }
            }
          }
        });

        // Hardcoded transform values — starts hidden
        model.position.set(-11.5, -3.5, 12.5);
        model.rotation.set(0.00, 0.49, -0.00);
        model.scale.setScalar(4.4);
        model.visible = false; // Hidden by default, shown during Fool feature

        // Create organic glow sprite at fool's position for entrance/exit effect
        const foolGlowTexture = this.generateGlowTexture();
        const foolGlowMat = new THREE.SpriteMaterial({
          map: foolGlowTexture,
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const foolGlowSprite = new THREE.Sprite(foolGlowMat);
        // Position glow at the visual center of the model (X/Z from position, Y at midpoint of bounding box)
        const foolBox = new THREE.Box3().setFromObject(model);
        const foolSize = foolBox.getSize(new THREE.Vector3());
        foolGlowSprite.position.set(model.position.x, model.position.y + foolSize.y * 0.75, model.position.z);
        foolGlowSprite.scale.setScalar(0.1);
        foolGlowSprite.visible = false;
        this.bgGroup.add(foolGlowSprite);
        this.foolGlow = foolGlowSprite;

        this.bgGroup.add(model);
        this.foolModel = model;

        // Store target scale for entrance animation
        model.userData.targetScale = 4.4;

        // Set up animations with ping-pong
        if (gltf.animations && gltf.animations.length > 0) {
          this.foolMixer = new THREE.AnimationMixer(model);
          for (const clip of gltf.animations) {
            console.log(`🎬 Fool clip: "${clip.name}" duration: ${clip.duration.toFixed(2)}s`);
            const action = this.foolMixer.clipAction(clip);
            action.setLoop(THREE.LoopPingPong, Infinity);
            action.play();
          }
          console.log(`🎬 Fool: ${gltf.animations.length} animation(s)`);
        }

        // Pre-compile to avoid first-frame glitches
        model.visible = true;
        this.renderer.compile(this.scene, this.camera);
        this.renderer.render(this.scene, this.camera);
        model.visible = false;
        this.foolReady = true;
        this._onModelLoaded();

        console.log(`✅ Fool model loaded & pre-compiled: ${path}`);
      },
      undefined,
      (error) => {
        console.error('❌ Failed to load Fool model:', error);
        this._onModelLoaded();
      }
    );
  }

  /**
   * Bring in the fool model for the Fool feature — scales up.
   */
  swapToModel(): Promise<void> {
    return new Promise((resolve) => {
      if (this.isFoolSwapped && this.foolModel) {
        resolve();
        return;
      }

      if (!this.foolReady || !this.foolModel) {
        console.warn('⏳ Fool model not ready yet, waiting...');
        const checkInterval = setInterval(() => {
          if (this.foolReady && this.foolModel) {
            clearInterval(checkInterval);
            this.animateFoolEntrance().then(resolve);
          }
        }, 100);
        return;
      }

      this.animateFoolEntrance().then(resolve);
    });
  }

  /**
   * Animate fool entrance: glow builds up, model pops in fully opaque behind glow,
   * then glow fades to reveal the solid model. Matches Sol entrance style.
   */
  private animateFoolEntrance(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.foolModel || !this.foolGlow) { resolve(); return; }

      const model = this.foolModel;
      const glow = this.foolGlow;
      const glowMat = glow.material as THREE.SpriteMaterial;

      glow.visible = true;
      glow.scale.setScalar(0.1);
      glowMat.opacity = 0;
      model.visible = false;
      this.isFoolSwapped = true;

      const duration = 1800;
      const startTime = performance.now();
      const maxGlowScale = 10;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);

        if (t < 0.35) {
          const p = t / 0.35;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(0.1 + maxGlowScale * eased);
          glowMat.opacity = eased * 0.95;
        } else {
          if (!model.visible) {
            model.visible = true;
          }
          const p = (t - 0.35) / 0.65;
          const eased = p * p * p;
          glow.scale.setScalar(maxGlowScale * (1 - eased * 0.6));
          glowMat.opacity = 0.95 * (1 - eased);
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          glow.visible = false;
          glowMat.opacity = 0;
          model.visible = true;
          console.log('🃏 Fool materialized from glow');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  /**
   * Animate fool exit: glow expands over the model, model hides behind glow,
   * then glow fades away. Matches Sol exit style.
   */
  restoreModel(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isFoolSwapped || !this.foolModel) {
        resolve();
        return;
      }

      const model = this.foolModel;
      const glow = this.foolGlow;

      if (!glow) {
        model.visible = false;
        this.isFoolSwapped = false;
        resolve();
        return;
      }

      const glowMat = glow.material as THREE.SpriteMaterial;

      glow.visible = true;
      glow.scale.setScalar(0.1);
      glowMat.opacity = 0;

      const duration = 1200;
      const startTime = performance.now();
      const maxGlowScale = 10;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);

        if (t < 0.4) {
          const p = t / 0.4;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(0.1 + maxGlowScale * eased);
          glowMat.opacity = eased * 0.95;
        } else {
          if (model.visible) {
            model.visible = false;
          }
          const p = (t - 0.4) / 0.6;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(maxGlowScale * (1 - eased * 0.85));
          glowMat.opacity = 0.95 * (1 - eased);
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          glow.visible = false;
          glowMat.opacity = 0;
          model.visible = false;
          this.isFoolSwapped = false;
          console.log('🃏 Fool dissolved into glow');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  /**
   * Bring in the sol model for the Cups feature — drops in from above.
   * Ancient woman stays visible throughout.
   */
  swapToSol(): Promise<void> {
    return new Promise((resolve) => {
      if (this.isSolSwapped && this.solModel) {
        resolve();
        return;
      }

      if (!this.solReady || !this.solModel) {
        // Sol not loaded/compiled yet — wait until ready
        console.warn('⏳ Sol model not ready yet, waiting...');
        const checkInterval = setInterval(() => {
          if (this.solReady && this.solModel) {
            clearInterval(checkInterval);
            this.animateSolEntrance().then(resolve);
          }
        }, 100);
        return;
      }

      this.animateSolEntrance().then(resolve);
    });
  }

  /**
   * Animate sol entrance: glow builds up, model pops in fully opaque behind glow,
   * then glow fades to reveal the solid model. No transparency on the model at all.
   */
  private animateSolEntrance(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.solModel || !this.solGlow) { resolve(); return; }

      const model = this.solModel;
      const glow = this.solGlow;
      const glowMat = glow.material as THREE.SpriteMaterial;

      // Phase 1 (0→0.35): Glow grows and brightens. Model stays hidden.
      // Phase 2 (0.35→1.0): Model pops in. Glow lingers and fades very gradually.
      glow.visible = true;
      glow.scale.setScalar(0.1);
      glowMat.opacity = 0;
      model.visible = false;
      this.isSolSwapped = true;

      const duration = 1800; // ms — longer for smoother fade
      const startTime = performance.now();
      const maxGlowScale = 10;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);

        if (t < 0.35) {
          // Phase 1: Glow grows and brightens — model still hidden
          const p = t / 0.35;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(0.1 + maxGlowScale * eased);
          glowMat.opacity = eased * 0.95;
        } else {
          // Pop the model in fully opaque behind the bright glow
          if (!model.visible) {
            model.visible = true;
          }
          // Phase 2: Glow fades out very gradually over a long tail
          const p = (t - 0.35) / 0.65;
          // Slow ease — stays bright longer, then gently fades
          const eased = p * p * p; // cubic ease-in for gentle start, faster end
          glow.scale.setScalar(maxGlowScale * (1 - eased * 0.6));
          glowMat.opacity = 0.95 * (1 - eased);
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          glow.visible = false;
          glowMat.opacity = 0;
          model.visible = true;
          console.log('☀️ Sol materialized from glow');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  /**
   * Animate sol exit: glow expands over the model, model hides behind glow,
   * then glow fades away. No transparency on the model.
   */
  restoreSol(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isSolSwapped || !this.solModel || !this.solGlow) {
        resolve();
        return;
      }

      const model = this.solModel;
      const glow = this.solGlow;
      const glowMat = glow.material as THREE.SpriteMaterial;

      glow.visible = true;
      glow.scale.setScalar(1);
      glowMat.opacity = 0;

      const duration = 900; // ms
      const startTime = performance.now();
      const maxGlowScale = 10;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);

        if (t < 0.4) {
          // Phase 1: Glow grows and brightens over the model
          const p = t / 0.4;
          const eased = p * p;
          glow.scale.setScalar(1 + maxGlowScale * eased);
          glowMat.opacity = eased * 0.95;
        } else {
          // Hide model behind the bright glow
          if (model.visible) {
            model.visible = false;
          }
          // Phase 2: Glow shrinks and fades away
          const p = (t - 0.4) / 0.6;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(maxGlowScale * (1 - eased * 0.85));
          glowMat.opacity = 0.95 * (1 - eased);
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          glow.visible = false;
          glowMat.opacity = 0;
          model.visible = false;
          this.isSolSwapped = false;
          console.log('☀️ Sol dissolved into glow');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  /**
   * Bring in the death model for the Death feature — glow entrance.
   */
  swapToDeath(): Promise<void> {
    return new Promise((resolve) => {
      if (this.isDeathSwapped && this.deathModel) {
        resolve();
        return;
      }

      if (!this.deathReady || !this.deathModel) {
        console.warn('⏳ Death model not ready yet, waiting...');
        const checkInterval = setInterval(() => {
          if (this.deathReady && this.deathModel) {
            clearInterval(checkInterval);
            this.animateDeathEntrance().then(resolve);
          }
        }, 100);
        return;
      }

      this.animateDeathEntrance().then(resolve);
    });
  }

  /**
   * Animate death entrance: glow builds up, model pops in fully opaque behind glow,
   * then glow fades to reveal the solid model. Matches Sol entrance style.
   */
  private animateDeathEntrance(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.deathModel || !this.deathGlow) { resolve(); return; }

      const model = this.deathModel;
      const glow = this.deathGlow;
      const glowMat = glow.material as THREE.SpriteMaterial;

      glow.visible = true;
      glow.scale.setScalar(0.1);
      glowMat.opacity = 0;
      model.visible = false;
      this.isDeathSwapped = true;

      const duration = 1800;
      const startTime = performance.now();
      const maxGlowScale = 10;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);

        if (t < 0.35) {
          const p = t / 0.35;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(0.1 + maxGlowScale * eased);
          glowMat.opacity = eased * 0.95;
        } else {
          if (!model.visible) {
            model.visible = true;
          }
          const p = (t - 0.35) / 0.65;
          const eased = p * p * p;
          glow.scale.setScalar(maxGlowScale * (1 - eased * 0.6));
          glowMat.opacity = 0.95 * (1 - eased);
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          glow.visible = false;
          glowMat.opacity = 0;
          model.visible = true;
          console.log('💀 Death materialized from glow');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  /**
   * Animate death exit: glow expands over the model, model hides behind glow,
   * then glow fades away. Matches Sol exit style.
   */
  restoreDeath(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isDeathSwapped || !this.deathModel || !this.deathGlow) {
        resolve();
        return;
      }

      const model = this.deathModel;
      const glow = this.deathGlow;
      const glowMat = glow.material as THREE.SpriteMaterial;

      glow.visible = true;
      glow.scale.setScalar(1);
      glowMat.opacity = 0;

      const duration = 900;
      const startTime = performance.now();
      const maxGlowScale = 10;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);

        if (t < 0.4) {
          const p = t / 0.4;
          const eased = p * p;
          glow.scale.setScalar(1 + maxGlowScale * eased);
          glowMat.opacity = eased * 0.95;
        } else {
          if (model.visible) {
            model.visible = false;
          }
          const p = (t - 0.4) / 0.6;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(maxGlowScale * (1 - eased * 0.85));
          glowMat.opacity = 0.95 * (1 - eased);
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          glow.visible = false;
          glowMat.opacity = 0;
          model.visible = false;
          this.isDeathSwapped = false;
          console.log('💀 Death dissolved into glow');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  /**
   * Bring in the lovers model for the Lovers feature — glow entrance.
   */
  swapToLovers(): Promise<void> {
    return new Promise((resolve) => {
      if (this.isLoversSwapped && this.loversModel) {
        resolve();
        return;
      }

      if (!this.loversReady || !this.loversModel) {
        console.warn('⏳ Lovers model not ready yet, waiting...');
        const checkInterval = setInterval(() => {
          if (this.loversReady && this.loversModel) {
            clearInterval(checkInterval);
            this.animateLoversEntrance().then(resolve);
          }
        }, 100);
        return;
      }

      this.animateLoversEntrance().then(resolve);
    });
  }

  /**
   * Animate lovers entrance: glow builds up, model appears behind glow,
   * then glow fades to reveal the model.
   */
  private animateLoversEntrance(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.loversModel || !this.loversGlow) { resolve(); return; }

      const model = this.loversModel;
      const glow = this.loversGlow;
      const glowMat = glow.material as THREE.SpriteMaterial;

      glow.visible = true;
      glow.scale.setScalar(0.1);
      glowMat.opacity = 0;
      model.visible = false;
      this.isLoversSwapped = true;

      const duration = 1800;
      const startTime = performance.now();
      const maxGlowScale = 10;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);

        if (t < 0.35) {
          const p = t / 0.35;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(0.1 + maxGlowScale * eased);
          glowMat.opacity = eased * 0.95;
        } else {
          if (!model.visible) {
            model.visible = true;
          }
          const p = (t - 0.35) / 0.65;
          const eased = p * p * p;
          glow.scale.setScalar(maxGlowScale * (1 - eased * 0.6));
          glowMat.opacity = 0.95 * (1 - eased);
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          glow.visible = false;
          glowMat.opacity = 0;
          model.visible = true;
          console.log('💕 Lovers materialized from glow');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  /**
   * Animate lovers exit: glow covers model, model hides, glow fades.
   */
  restoreLovers(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isLoversSwapped || !this.loversModel || !this.loversGlow) {
        resolve();
        return;
      }

      const model = this.loversModel;
      const glow = this.loversGlow;
      const glowMat = glow.material as THREE.SpriteMaterial;

      glow.visible = true;
      glow.scale.setScalar(1);
      glowMat.opacity = 0;

      const duration = 900;
      const startTime = performance.now();
      const maxGlowScale = 10;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);

        if (t < 0.4) {
          const p = t / 0.4;
          const eased = p * p;
          glow.scale.setScalar(1 + maxGlowScale * eased);
          glowMat.opacity = eased * 0.95;
        } else {
          if (model.visible) {
            model.visible = false;
          }
          const p = (t - 0.4) / 0.6;
          const eased = 1 - Math.pow(1 - p, 2);
          glow.scale.setScalar(maxGlowScale * (1 - eased * 0.85));
          glowMat.opacity = 0.95 * (1 - eased);
        }

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          glow.visible = false;
          glowMat.opacity = 0;
          model.visible = false;
          this.isLoversSwapped = false;
          console.log('💕 Lovers dissolved into glow');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  /**
   * Generate a procedural noisy glow texture — organic, undefined edges.
   * Uses layered radial gradients with noise distortion.
   */
  private generateGlowTexture(): THREE.Texture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const cx = size / 2;
    const cy = size / 2;

    // Clear
    ctx.clearRect(0, 0, size, size);

    // Draw multiple offset radial gradients with varying sizes for organic feel
    const layers = 12;
    for (let i = 0; i < layers; i++) {
      // Random offset from center
      const ox = cx + (Math.random() - 0.5) * size * 0.15;
      const oy = cy + (Math.random() - 0.5) * size * 0.15;
      const radius = size * (0.25 + Math.random() * 0.25);

      const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
      grad.addColorStop(0, `rgba(255, 255, 255, ${0.15 + Math.random() * 0.1})`);
      grad.addColorStop(0.3 + Math.random() * 0.2, `rgba(255, 255, 240, ${0.08 + Math.random() * 0.05})`);
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }

    // Add pixel noise for grittiness
    const imageData = ctx.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const px = (i / 4) % size;
      const py = Math.floor((i / 4) / size);
      const distFromCenter = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) / (size / 2);

      // Noise that fades with distance
      const noise = (Math.random() - 0.5) * 40 * (1 - distFromCenter);
      data[i] = Math.min(255, Math.max(0, data[i] + noise));
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));

      // Feather alpha at edges with irregular falloff
      if (distFromCenter > 0.6) {
        const edgeFade = 1 - smoothstepJS((distFromCenter - 0.6) / 0.4);
        const irregularity = 0.7 + Math.random() * 0.3;
        data[i + 3] = Math.floor(data[i + 3] * edgeFade * irregularity);
      }
    }
    ctx.putImageData(imageData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }


  dispose(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', () => this.onResize());
    // Clean up any active tear effects
    for (const effect of this.activeTearEffects) {
      effect.dispose();
    }
    this.activeTearEffects = [];
    this.renderer.dispose();
  }
}
