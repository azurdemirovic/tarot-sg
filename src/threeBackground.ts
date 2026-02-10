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

export class ThreeBackground {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private bgGroup: THREE.Group;
  private clock: THREE.Clock;
  private _animateCamera: boolean; // Reserved for future camera animation
  private animationId: number = 0;
  private mixer: THREE.AnimationMixer | null = null;
  
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

  
  constructor(options: ThreeBgOptions) {
    this._animateCamera = options.animate;
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


    // ── Camera ──
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 500);
    this.camera.position.set(-4.5, 0.0, 36.5);
    this.camera.lookAt(0, 0, 0);

    // ── Lighting: even ambient only (directional key removed — was causing bright strip on right border) ──
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(ambient);

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

        // Auto-scale only (no centering or shifting — position set via bgGroup)
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());

        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = 164;
        const scale = targetSize / maxDim;
        model.scale.setScalar(scale);

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

        // Position the model
        this.bgGroup.position.set(11.5, 0.5, 12.0);

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
      this.mixer.update(delta*3);
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
