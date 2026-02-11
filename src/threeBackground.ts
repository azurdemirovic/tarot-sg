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

  // Model swap support (e.g. Fool feature → jester model)
  private mainModel: THREE.Object3D | null = null;
  private mainMixer: THREE.AnimationMixer | null = null;
  private jesterModel: THREE.Object3D | null = null;  // Single jester model (left side)
  private swapMixer: THREE.AnimationMixer | null = null;
  private isSwapped: boolean = false;

  // Jester slide animation state
  private jesterTargetX: number = -10;   // Final resting X position
  private jesterOffscreenX: number = -35; // Offscreen left X position
  private jesterExitX: number = 0;        // Slides just behind the grid (center-ish) to fake exit

  
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

    // ── Lighting: ambient base + symmetric directional lights for sculpted look ──
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    // Left-side directional light
    const dirLeft = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLeft.position.set(-20, 5, 15);
    this.scene.add(dirLeft);

    // Right-side directional light (mirrored)
    const dirRight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirRight.position.set(20, 5, 15);
    this.scene.add(dirRight);

    // Subtle top fill for depth on upper features
    const dirTop = new THREE.DirectionalLight(0xffffff, 0.25);
    dirTop.position.set(0, 20, 10);
    this.scene.add(dirTop);

    // ── Background group ──
    this.bgGroup = new THREE.Group();
    this.scene.add(this.bgGroup);

    // ── Load main model (always visible, swapped out during Fool feature) ──
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
        this.mainModel = model;

        // Position the main model (not bgGroup, so swap models keep their own positions)
        model.position.set(11.5, 0.5, 12.0);

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

    // Tick animation mixers — main model always runs
    if (this.mainMixer) {
      this.mainMixer.update(delta * 3);
    }
    // Jester mixer runs at 0.5× for a slower, eerie feel
    if (this.swapMixer && this.isSwapped) {
      this.swapMixer.update(delta * 0.5);
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

  /**
   * Apply the engraved grayscale + feature color shader to all meshes in a model.
   */
  private applyEngravedShader(model: THREE.Object3D): void {
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.frustumCulled = true;
        const mesh = child as THREE.Mesh;
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
   * Prepare a loaded GLTF model: remove unwanted meshes, apply shader.
   */
  private prepareModel(gltf: any, removeMeshNames: string[]): THREE.Object3D {
    const model = gltf.scene;

    // Remove unwanted meshes/nodes
    const toRemove: THREE.Object3D[] = [];
    model.traverse((child: THREE.Object3D) => {
      if (removeMeshNames.includes(child.name)) {
        toRemove.push(child);
        console.log(`🗑️ Removing mesh: "${child.name}"`);
      }
    });
    for (const obj of toRemove) {
      obj.removeFromParent();
    }

    // Apply the engraved grayscale + feature color shader
    this.applyEngravedShader(model);

    return model;
  }

  /**
   * Bring in the jester model from the left side with a slide animation.
   * Ancient woman stays visible throughout.
   * @param modelPath - Path to the jester GLB model
   * @param removeMeshNames - Mesh/node names to remove from the loaded model (e.g. ['Plane001'])
   */
  swapToModel(modelPath: string, removeMeshNames: string[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      // If already swapped, just resolve
      if (this.isSwapped && this.jesterModel) {
        resolve();
        return;
      }

      // If jester was previously loaded, reuse it — animate entrance
      if (this.jesterModel) {
        this.animateJesterEntrance().then(resolve);
        return;
      }

      const loader = new GLTFLoader();

      const loadOne = (): Promise<{ scene: THREE.Object3D; animations: THREE.AnimationClip[] }> =>
        new Promise((res, rej) => {
          loader.load(
            modelPath,
            (gltf) => res({ scene: gltf.scene, animations: gltf.animations || [] }),
            undefined,
            (error) => rej(error)
          );
        });

      loadOne()
        .then((gltf1) => {
          // ── Single jester (left side) ──
          const model = this.prepareModel(gltf1, removeMeshNames);
          model.position.set(this.jesterOffscreenX, -3.5, 13.5); // Start offscreen left
          model.rotation.set(0, 0, 9.0 * Math.PI / 180);
          model.scale.set(-4.480, 4.480, 4.480); // Flip X axis to face right
          model.visible = false;

          this.bgGroup.add(model);
          this.jesterModel = model;

          // Set up animations
          if (gltf1.animations.length > 0) {
            this.swapMixer = new THREE.AnimationMixer(model);
            for (const clip of gltf1.animations) {
              this.swapMixer.clipAction(clip).play();
            }
            console.log(`🎬 Jester: ${gltf1.animations.length} animation(s)`);
          }

          console.log(`✅ Jester model loaded: ${modelPath}`);

          // Animate entrance
          this.animateJesterEntrance().then(resolve);
        })
        .catch((error) => {
          console.error('❌ Failed to load jester model:', error);
          reject(error);
        });
    });
  }

  /** Animate jester sliding in from the left */
  private animateJesterEntrance(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.jesterModel) { resolve(); return; }

      const model = this.jesterModel;
      model.position.x = this.jesterOffscreenX;
      model.visible = true;
      this.isSwapped = true;

      const startX = this.jesterOffscreenX;
      const endX = this.jesterTargetX;
      const duration = 800; // ms
      const startTime = performance.now();

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Ease out back for a playful overshoot
        const c1 = 1.70158;
        const c3 = c1 + 1;
        const eased = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);

        model.position.x = startX + (endX - startX) * eased;

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          model.position.x = endX;
          console.log('🃏 Jester slid in from the left');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
  }

  /** Animate jester sliding out to the right, then hide */
  restoreModel(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isSwapped || !this.jesterModel) {
        resolve();
        return;
      }

      const model = this.jesterModel;
      const startX = model.position.x;
      const endX = this.jesterExitX;
      const duration = 600; // ms
      const startTime = performance.now();

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        // Ease in quad — accelerates out
        const eased = t * t;

        model.position.x = startX + (endX - startX) * eased;

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          model.visible = false;
          model.position.x = this.jesterOffscreenX; // Reset for next entrance
          this.isSwapped = false;
          console.log('🃏 Jester slid out to the right');
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
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
