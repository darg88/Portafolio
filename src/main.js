import '../style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
//import { VRButton } from 'three/addons/webxr/VRButton.js';
//import { ARButton } from 'three/addons/webxr/ARButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { categoryPlanetData, whaleData } from './data.js';

// ============================================================
// INYECCIÓN DE CSS PARA LOS BLOQUES DE GLITCH SUTIL (PARCIAL)
// ============================================================
const style = document.createElement('style');
style.innerHTML = `
  .cyber-glitch-block {
    position: fixed;
    z-index: 9999;
    pointer-events: none; 
    background: transparent;
    mix-blend-mode: screen; 
    opacity: 0.8;
  }
`;
document.head.appendChild(style);

// Sistema global de Analíticas (Listo para Google Analytics en el futuro)
window.trackEvent = function(action, label) { 
  console.log(`[ANALÍTICAS 👁️] Acción: ${action} | Detalle: ${label}`); 
};

const scene = new THREE.Scene();
const ditherShader = {
  vertexShader: `
    varying vec3 vNormal;
    void main() {
      // Calculamos la normal 3D para que el planeta sepa dónde le da la luz
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 color;
    uniform vec3 lightDir;
    varying vec3 vNormal;

    void main() {
      // 1. Iluminación 3D básica (1.0 es luz total, 0.0 es sombra)
      float intensity = max(dot(vNormal, lightDir), 0.0);
      intensity = intensity * 0.9 + 0.1; // Evitamos sombra negra absoluta

      // 2. Matriz de Bayer 4x4 (El patrón retro de Gameboy/Mac OS)
      vec2 coord = gl_FragCoord.xy / 3.0; // "3.0" hace que el píxel retro se vea grueso y visible
      int x = int(mod(coord.x, 4.0));
      int y = int(mod(coord.y, 4.0));
      int index = x + y * 4;
      
      float threshold = 0.0;
      if(index==0) threshold=0.0/16.0; else if(index==1) threshold=8.0/16.0; else if(index==2) threshold=2.0/16.0; else if(index==3) threshold=10.0/16.0;
      else if(index==4) threshold=12.0/16.0; else if(index==5) threshold=4.0/16.0; else if(index==6) threshold=14.0/16.0; else if(index==7) threshold=6.0/16.0;
      else if(index==8) threshold=3.0/16.0; else if(index==9) threshold=11.0/16.0; else if(index==10) threshold=1.0/16.0; else if(index==11) threshold=9.0/16.0;
      else if(index==12) threshold=15.0/16.0; else if(index==13) threshold=7.0/16.0; else if(index==14) threshold=13.0/16.0; else if(index==15) threshold=5.0/16.0;

   // 3. LA MAGIA: Si la luz en este píxel es menor al umbral del patrón, lo destruimos
      if (intensity < threshold) {
        discard; 
      } else {
        // 🔥 LUZ LIBERADA: Multiplicamos el color x1.8 para que supere el umbral del Bloom (0.85).
        // Esto crea el efecto "Selective Bloom" hermoso del ejemplo de Three.js
      gl_FragColor = vec4(color * 3.5, 1.0);
      }
    }
  `
};
// Motor de Feedback Háptico
function vibrateDevice(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const userGroup = new THREE.Group();
userGroup.position.set(0, 0, 50); 
userGroup.add(camera);
scene.add(userGroup);
// 🔥 3. PREVENCIÓN DE ERRORES GRÁFICOS (UX)
try {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) throw new Error('WebGL no soportado');
} catch (e) {
  document.getElementById('loading-text').innerText = "> ERROR CRÍTICO: ACELERACIÓN GRÁFICA (WEBGL) NO DETECTADA EN ESTE DISPOSITIVO.";
  document.getElementById('loading-text').style.color = "#ff0000";
  // Detiene la ejecución para no crashear la pestaña
  throw new Error("Sistema abortado por falta de WebGL."); 
}
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#bg-canvas'), antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0); // 🔥 ARREGLO AR: Fondo 100% transparente
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;

// ==========================================
// 🔥 SISTEMA WEBXR NATIVO Y FUNCIONAL - CORREGIDO 🔥
// ==========================================

window.isARSession = false;
let hitTestSource = null;
let hitTestSourceRequested = false;
let currentXRSession = null;

// Configuración de botones AR/VR personalizados
const customVrBtn = document.createElement('button');
customVrBtn.id = 'VRButton';  // ✅ CORRECTO - Coincide con CSS
customVrBtn.innerText = 'VR';
customVrBtn.className = 'control-btn';
// 🔥 QUITA el style.cssText inline - el CSS lo manejará automáticamente
document.body.appendChild(customVrBtn);

const customArBtn = document.createElement('button');
customArBtn.id = 'ARButton';  // ✅ CORRECTO - Coincide con CSS
customArBtn.innerText = 'AR';
customArBtn.className = 'control-btn';
// 🔥 QUITA el style.cssText inline - el CSS lo manejará automáticamente
document.body.appendChild(customArBtn);
// ==========================================
// 🔥 INICIALIZACIÓN Y EVENTOS AR/VR - BLINDADOS 🔥
// ==========================================

// 1. Función centralizada y limpia para verificar soporte
async function checkXRSupport() {
    const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
    
    if (!navigator.xr) {
        if (customArBtn) customArBtn.style.display = 'none';
        if (customVrBtn) customVrBtn.style.display = 'none';
        return;
    }
    
    try {
        // Verificar AR
        const arSupported = await navigator.xr.isSessionSupported('immersive-ar');
        if (customArBtn) {
            if (arSupported && isMobile) {
                customArBtn.style.display = 'flex';
                customArBtn.title = 'Activar Realidad Aumentada';
            } else {
                customArBtn.style.display = 'none';
                // Mensaje elegante para PC
                if (!isMobile && !document.getElementById('ar-desktop-msg')) {
                    const arMsg = document.createElement('div');
                    arMsg.id = 'ar-desktop-msg';
                    arMsg.innerHTML = '📱 AR disponible SOLO en dispositivos móviles';
                    arMsg.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: rgba(0,0,0,0.85); color: #ffaa00; font-size: 0.7rem; padding: 8px 12px; border-left: 3px solid #ffaa00; font-family: monospace; z-index: 100000; pointer-events: none; backdrop-filter: blur(5px);';
                    document.body.appendChild(arMsg);
                }
            }
        }
        
        // Verificar VR
        const vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
        if (customVrBtn) customVrBtn.style.display = vrSupported ? 'flex' : 'none';
        
    } catch (error) {
        console.error("Error comprobando soporte XR:", error);
        if (customArBtn) customArBtn.style.display = 'none';
        if (customVrBtn) customVrBtn.style.display = 'none';
    }
}

// 2. Evento Botón VR
if (customVrBtn) {
    customVrBtn.addEventListener('click', async () => {
        try {
            if (renderer.xr.isPresenting) { await renderer.xr.getSession()?.end(); return; }
            window.isARSession = false;
            const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
            await renderer.xr.setSession(session);
            if (typeof playSound === 'function') playSound('levelup');
        } catch (error) {
            if (typeof showSystemToast === 'function') showSystemToast('❌ Error iniciando VR', '#ff0000');
        }
    });
}

// 3. Evento Botón AR - CORREGIDO PARA MÁXIMA COMPATIBILIDAD
// 3. Evento Botón AR - BLINDADO PARA ANDROID Y QUEST 3
if (customArBtn) {
    customArBtn.addEventListener('click', async () => {
        try {
            if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
                if (typeof showSystemToast === 'function') showSystemToast('⚠️ AR requiere HTTPS', '#ffaa00');
                return;
            }

            if (renderer.xr.isPresenting) { await renderer.xr.getSession()?.end(); return; }
            
            window.isARSession = true;
            console.log("🔥 Solicitando sesión AR nativa...");
            
            // 🔥 SOLUCIÓN 1: Mover TODO a optionalFeatures.
            // Esto evita que Quest 3 y Android rechacen la sesión por tecnicismos de tracking.
            const session = await navigator.xr.requestSession('immersive-ar', {
                optionalFeatures: ['local-floor', 'local', 'hit-test']
            });
            
            // 🔥 SOLUCIÓN 2: Forzar el espacio de referencia correcto para Quest 3
            renderer.xr.setReferenceSpaceType('local-floor');
            
            await renderer.xr.setSession(session);
            
            // 🔥 SOLUCIÓN 3: Limpiar fondos CSS que bloquean la cámara (Passthrough)
            document.documentElement.style.background = 'transparent';
            document.body.style.background = 'transparent';
            const cvs = document.getElementById('bg-canvas');
            if (cvs) cvs.style.background = 'transparent';
            
            renderer.setClearColor(0x000000, 0);
            scene.background = null;
            
            if (typeof playSound === 'function') playSound('levelup');
            
        } catch (error) {
            console.error("Error AR detallado:", error);
            window.isARSession = false;
            if (typeof showSystemToast === 'function') showSystemToast('❌ Error AR: Dispositivo no compatible o permisos denegados', '#ff0000');
        }
    });
}
// Reticle para apuntar en AR (más visible)
const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ 
        color: 0x00ff00, 
        emissive: 0x00ff00,
        emissiveIntensity: 0.5,
        transparent: true, 
        opacity: 0.9,
        side: THREE.DoubleSide
    })
);
// Añadir un círculo interior
const reticleInner = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 16).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 0.3 })
);
reticle.add(reticleInner);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// Función para escanear el entorno en AR (CORREGIDA PARA QUEST 3)
async function setupARHitTest(session) {
    try {
        // 🔥 SOLUCIÓN 4: Solo pedir hit-test si el dispositivo lo soporta 
        // (Quest 3 usa otros sistemas y crasheaba al exigirlo)
        if (session.requestHitTestSource) {
            const viewerSpace = await session.requestReferenceSpace('viewer');
            hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
            hitTestSourceRequested = true;
            console.log("✅ Escáner espacial (Hit-test) configurado.");
        } else {
            console.warn("⚠️ Hit-test no disponible. AR funcionará en modo flotante libre.");
        }
        
        session.addEventListener('end', () => {
            hitTestSourceRequested = false;
            if (hitTestSource) {
                hitTestSource.cancel();
                hitTestSource = null;
            }
            reticle.visible = false;
        });
        
    } catch (error) {
        console.error("Error configurando Hit Test (Ignorado para mantener AR):", error);
    }
}

// Manejo del INICIO de la sesión
renderer.xr.addEventListener('sessionstart', () => {
    if (typeof isGameStarted !== 'undefined') isGameStarted = true;
    renderer.setRenderTarget(null);
    
    currentXRSession = renderer.xr.getSession();
    
    if (window.isARSession) {
        scene.background = null;
        document.body.classList.add('ar-active'); // Usa la clase CSS que creamos antes
        if (customArBtn) customArBtn.innerText = 'SALIR AR';
        if (customVrBtn) customVrBtn.style.display = 'none';
        
        setupARHitTest(currentXRSession); // Inicia el escáner espacial
    } else {
        if (customVrBtn) customVrBtn.innerText = 'SALIR VR';
        if (customArBtn) customArBtn.style.display = 'none';
    }
    
    // Apagar la interfaz 2D para inmersión
    const crtOverlay = document.querySelector('.crt-overlay');
    if (crtOverlay) crtOverlay.style.display = 'none';
    if (typeof window.closeAllUIs === 'function') window.closeAllUIs();
    
    ['start-screen', 'portfolio-header', 'unified-hud', 'universe-legend', 'touch-controls', 'combat-toggle-btn', 'menu-toggle'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    
    if (window.isARSession) {
        if (typeof particlesMesh !== 'undefined') particlesMesh.visible = false;
        if (typeof ship !== 'undefined') ship.visible = false;
        if (typeof satelliteGroup !== 'undefined') satelliteGroup.visible = false;
        if (typeof constellationLine !== 'undefined') constellationLine.visible = false;
        if (typeof categoryPlanets !== 'undefined') categoryPlanets.forEach(p => p.visible = false);
        if (typeof asteroids !== 'undefined') asteroids.forEach(a => a.visible = false);
        if (typeof ambientWhales !== 'undefined') ambientWhales.forEach(w => w.visible = false);
        if (typeof discoveredVoyagers !== 'undefined') discoveredVoyagers.forEach(v => v.visible = false);
        if (typeof guardianCats !== 'undefined') guardianCats.forEach(c => c.visible = false);
        if (typeof scrollKeywords !== 'undefined') scrollKeywords.forEach(k => k.visible = false);
        if (typeof bossEntity !== 'undefined' && bossEntity) bossEntity.visible = false;
        
        userGroup.position.set(0, 0, 0);
    } else {
        userGroup.position.set(0, 0, 15);
        if (typeof ship !== 'undefined') {
            ship.position.set(0, -3, 0);
            ship.scale.set(0.3, 0.3, 0.3);
        }
    }
});

// Manejo del FIN de la sesión
renderer.xr.addEventListener('sessionend', () => {
    window.isARSession = false;
    document.body.classList.remove('ar-active');
    // 🔥 Restaurar los fondos CSS para que la web vuelva a la normalidad
    document.documentElement.style.background = '';
    document.body.style.background = '';
    const cvs = document.getElementById('bg-canvas');
    if (cvs) cvs.style.background = '';
    if (currentXRSession) currentXRSession = null;
    
    if (customVrBtn) customVrBtn.innerText = 'VR';
    if (customArBtn) customArBtn.innerText = 'AR';
    checkXRSupport(); // Restaura la visibilidad de los botones
    
    const crtOverlay = document.querySelector('.crt-overlay');
    if (crtOverlay) crtOverlay.style.display = 'block';
    
    ['portfolio-header', 'universe-legend'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'block';
    });
    ['unified-hud', 'menu-toggle', 'combat-toggle-btn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'flex';
    });
    
    if (typeof particlesMesh !== 'undefined') particlesMesh.visible = true;
    if (typeof ship !== 'undefined') ship.visible = true;
    if (typeof satelliteGroup !== 'undefined') satelliteGroup.visible = true;
    if (typeof categoryPlanets !== 'undefined') categoryPlanets.forEach(p => p.visible = true);
    if (typeof asteroids !== 'undefined') asteroids.forEach(a => a.visible = true);
    if (typeof ambientWhales !== 'undefined') ambientWhales.forEach(w => w.visible = true);
    if (typeof discoveredVoyagers !== 'undefined') discoveredVoyagers.forEach(v => v.visible = true);
    if (typeof guardianCats !== 'undefined') guardianCats.forEach(c => c.visible = true);
    if (typeof scrollKeywords !== 'undefined') scrollKeywords.forEach(k => k.visible = true);
    if (typeof bossEntity !== 'undefined' && bossEntity) bossEntity.visible = true;
    
    if (typeof isShooting !== 'undefined') isShooting = false;
    
    setTimeout(() => {
        renderer.xr.isPresenting = false;
        renderer.setRenderTarget(null);
        
        camera.fov = 75;
        camera.quaternion.identity();
        camera.position.set(0, 0, 0);
        camera.rotation.set(0, 0, 0);
        
        const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        userGroup.position.set(0, 0, (isTouch || window.innerWidth < 600) ? 30 : 50);
        userGroup.rotation.set(0, 0, 0);
        
        if (typeof ship !== 'undefined') {
            ship.position.set(0, -15, 0);
            ship.scale.set(0.6, 0.6, 0.6);
        }
        
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (typeof composer !== 'undefined') composer.setSize(window.innerWidth, window.innerHeight);
        
        const canvas = document.getElementById('bg-canvas');
        if (canvas) {
            canvas.style.display = 'block';
            canvas.style.opacity = '1';
        }
        
        window.dispatchEvent(new Event('resize'));
    }, 300);
});

// Comprobar soporte al cargar la página
checkXRSupport();
// 🔥 RESTAURACIÓN DEL MOTOR GRÁFICO Y VARIABLES GLOBALES 🔥
const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 2.5, 0.8, 0.85);
const composer = new EffectComposer(renderer); composer.addPass(renderScene); composer.addPass(bloomPass);

let isSoundEnabled = true; let audioCtx = null; 
let masterGain = null; let delayNode = null; let feedbackGain = null;

function playSound(type, targetPosition = null) {
  if (type === 'laser') vibrateDevice(20);         
  if (type === 'explosion') vibrateDevice(80);     
  if (type === 'damage') vibrateDevice(300);       
  if (type === 'boss_hit') vibrateDevice(50);      
  
  if (!isSoundEnabled) return;
  try {
    // 1. INICIALIZAR EL SISTEMA DE ECO ESPACIAL HÍBRIDO
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      delayNode = audioCtx.createDelay();
      feedbackGain = audioCtx.createGain();

      delayNode.delayTime.value = 0.35; // Tiempo del eco
      feedbackGain.gain.value = 0.25;   // Cola del eco

      masterGain.connect(delayNode);
      delayNode.connect(feedbackGain);
      feedbackGain.connect(delayNode);
      masterGain.connect(audioCtx.destination);
      delayNode.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const now = audioCtx.currentTime;
    let volumeBase = 0.5; 
    if (targetPosition && typeof ship !== 'undefined') {
      volumeBase = Math.max(0, 1 - (ship.position.distanceTo(targetPosition) / 40)); 
    }

    // 🔥 LA FÁBRICA DE CRISTAL (Para Interfaz y Exploración sutil)
    const playBell = (freq, timeOffset, duration, vol) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine'; 
      osc.frequency.setValueAtTime(freq, now + timeOffset);
      
      gain.gain.setValueAtTime(0, now + timeOffset);
      gain.gain.linearRampToValueAtTime(vol * volumeBase, now + timeOffset + 0.02); 
      gain.gain.exponentialRampToValueAtTime(0.001, now + timeOffset + duration); 
      
      osc.connect(gain); gain.connect(masterGain);
      osc.start(now + timeOffset); osc.stop(now + timeOffset + duration);
    };

    // ==========================================
    // 🎵 DISEÑO SONORO HÍBRIDO DEFINITIVO
    // ==========================================
    
    // --- 1. MODO EXPLORACIÓN (Estética 'Gris') ---
    if(type === 'ui') { 

      // 🔥 INTERFAZ ULTRA-SUTIL: Un "tick" de cristal mate cortísimo
      playBell(3500, 0, 0.05, 0.02); 
      playBell(4800, 0, 0.03, 0.01); 
    }
    else if(type === 'project_open') { 
      // Un respiro corto y elegante, similar al despertar del universo pero más breve
      const playPad = (freq, delay, attack, release, vol) => {
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + delay);
        gain.gain.linearRampToValueAtTime(vol * volumeBase, now + delay + attack);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + attack + release);
        osc.connect(gain); gain.connect(masterGain); 
        osc.start(now + delay); osc.stop(now + delay + attack + release);
      };
      playPad(523.25, 0.0, 0.3, 1.5, 0.08); // Do
      playPad(783.99, 0.1, 0.5, 1.5, 0.05); // Sol (Crea un aura abierta y positiva)
    }
    else if(type === 'pulse') { 
      // Planetas, Errática y Pincel Poético: Gota de agua prístina
      playBell(1200, 0, 0.3, 0.06); 
      playBell(2400, 0, 0.2, 0.02); 
    }
   else if(type === 'double_pulse') { 
      // 🔥 Gota de agua doble (Eco de sonar para el Planeta DAC)
      playBell(1200, 0, 0.3, 0.08); 
      playBell(2400, 0, 0.2, 0.02); 
      playBell(1200, 0.15, 0.4, 0.06); // Segunda onda desfasada 150ms
      playBell(2400, 0.15, 0.3, 0.02); 
    }
    else if(type === 'thud' || type === 'thud_soft' || type === 'step') {
      // Viajero: golpe grave con caída de tono. [f0, f1, tiempo de caída, volumen, duración]
      const P = { thud: [120, 38, 0.30, 0.7, 0.45], thud_soft: [140, 60, 0.15, 0.25, 0.2], step: [95, 48, 0.10, 0.14, 0.14] }[type];
      const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(P[0], now);
      osc.frequency.exponentialRampToValueAtTime(P[1], now + P[2]);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(P[3] * volumeBase, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + P[4]);
      osc.connect(gain); gain.connect(masterGain);
      osc.start(now); osc.stop(now + P[4] + 0.05);
    }
    else if(type === 'boss_hit') { 
      // Máquina de Fricción: Cuenco tibetano / Toque físico pesado
      playBell(220, 0, 1.2, 0.2);
      playBell(440, 0, 0.8, 0.1);
    }
   else if(type === 'levelup') { 
      // 🔥 RESPIRO ETÉREO (Acorde suspendido Cmaj9 estilo Ambient/Gris)
      const playPad = (freq, delay, attack, release, vol) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine'; // Onda pura
        osc.frequency.value = freq;
        
        gain.gain.setValueAtTime(0, now + delay);
        // Ataque lentísimo: el sonido "nace" de la nada como un viento
        gain.gain.linearRampToValueAtTime(vol * volumeBase, now + delay + attack);
        // Caída eterna que se mezcla con el eco
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + attack + release);
        
        osc.connect(gain);
        gain.connect(masterGain); 
        osc.start(now + delay);
        osc.stop(now + delay + attack + release);
      };

      // Las notas entran desfasadas creando una atmósfera expansiva y melancólica
      playPad(261.63, 0.0, 1.5, 3.0, 0.06); // Fundamental profunda (Do), entra lento
      playPad(392.00, 0.6, 2.0, 3.0, 0.04); // Quinta (Sol), entra después
      playPad(587.33, 1.2, 2.5, 3.5, 0.03); // Novena (Re), aporta el toque mágico/nostálgico
      playPad(659.25, 1.8, 3.0, 4.0, 0.02); // Tercera aguda (Mi), se queda flotando al final
    }

    // --- 2. MODO COMBATE (Arcade Retro + Eco Espacial) ---
    else if(type === 'laser') { 
      const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain(); const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 3000;
      osc.type = 'sawtooth'; // Láser cortante
      osc.frequency.setValueAtTime(1200, now); 
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.15); 
      gain.gain.setValueAtTime(0.05 * volumeBase, now); 
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15); 
      osc.connect(filter); filter.connect(gain); gain.connect(masterGain);
      osc.start(now); osc.stop(now + 0.15); 
    }
    else if(type === 'damage') { 
      const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain(); const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 3000;
      osc.type = 'square'; // Impacto eléctrico crudo
      osc.frequency.setValueAtTime(150, now); 
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.2); 
      gain.gain.setValueAtTime(0.2 * volumeBase, now); 
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2); 
      osc.connect(filter); filter.connect(gain); gain.connect(masterGain);
      osc.start(now); osc.stop(now + 0.2); 
    }
    else if(type === 'explosion') { 
      const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain(); const filter = audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      osc.type = 'sawtooth'; // Distorsión grave
      osc.frequency.setValueAtTime(100, now); 
      osc.frequency.linearRampToValueAtTime(10, now + 0.4); 
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.linearRampToValueAtTime(100, now + 0.4);
      gain.gain.setValueAtTime(0.3 * volumeBase, now); 
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4); 
      osc.connect(filter); filter.connect(gain); gain.connect(masterGain);
      osc.start(now); osc.stop(now + 0.4); 
    }

  } catch(e) { console.log(e); }
}

function showSystemToast(msg, color) {
  const toast = document.getElementById('system-toast');
  if(!toast) return;
  toast.innerText = msg;
  
  // 🔥 ESTILO ETÉREO Y CRISTALINO
  toast.style.color = color || '#ffffff';
  toast.style.textShadow = `0 0 15px ${color || '#ffffff'}80`; 
  toast.style.background = 'rgba(5, 5, 10, 0.25)';
  toast.style.backdropFilter = 'blur(12px)';
  toast.style.border = '1px solid rgba(255, 255, 255, 0.05)';
  toast.style.borderRadius = '8px';
  toast.style.padding = '12px 25px';
  toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
  toast.style.fontFamily = "'-apple-system', sans-serif";
  toast.style.fontWeight = '300';
  toast.style.letterSpacing = '3px';
  toast.style.textTransform = 'uppercase';
  
  toast.classList.remove('hidden');
  toast.style.opacity = '1';
  if(window.toastTimer) clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.classList.add('hidden'), 500);
  }, 3500);
}

let isGameStarted = false; let isPaused = false; let isUIOpen = false; let shakeIntensity = 0;
document.addEventListener('visibilitychange', () => { isPaused = document.hidden; });
// ==========================================
// 🔥 REFLEXIÓN POÉTICA CENTRAL (Panel de Cristal Translúcido)
// ==========================================
function showPoeticReflection(text, colorHex) {
  let el = document.getElementById('poetic-reflection');
  
  if (!el) {
    el = document.createElement('div');
    el.id = 'poetic-reflection';
    el.style.position = 'fixed';
    el.style.top = '50%';
    el.style.left = '50%';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.fontFamily = "'-apple-system', sans-serif";
    el.style.fontWeight = '300'; 
    el.style.fontSize = '1.15rem'; // Texto ligeramente más sutil
    el.style.lineHeight = '2';     // Más respiro entre líneas
    el.style.letterSpacing = '3px';
    el.style.textAlign = 'center';
    el.style.pointerEvents = 'none'; 
    el.style.zIndex = '999999';
    el.style.opacity = '0';
    el.style.transition = 'opacity 2.5s ease-in-out'; 
    el.style.maxWidth = '750px';
    el.style.width = '80%';
    
    // 🔥 EL NUEVO FONDO: Panel de cristal cuadrado, minimalista y etéreo
    el.style.background = 'rgba(5, 5, 10, 0.15)'; // Mucho más transparente
    el.style.backdropFilter = 'blur(15px)';       // El desenfoque hace el trabajo de lectura
    el.style.padding = '40px 60px';
    el.style.borderRadius = '0';                  // Cuadrado, corte arquitectónico
    el.style.border = '1px solid rgba(255, 255, 255, 0.03)'; // Borde base casi invisible
    el.style.borderTop = '1px solid rgba(255, 255, 255, 0.15)'; // Bisel de luz superior
    el.style.borderLeft = '1px solid rgba(255, 255, 255, 0.1)'; // Bisel de luz lateral
    el.style.boxShadow = '0 30px 60px rgba(0, 0, 0, 0.3)'; // Sombra difusa debajo del cristal
    
    document.body.appendChild(el);
  }
  
  el.innerHTML = `<span style="font-style: italic; opacity: 0.85;">"${text}"</span>`;
  el.style.color = colorHex;
  el.style.textShadow = `0 0 10px rgba(255,255,255,0.2)`; // Resplandor reducido

  setTimeout(() => { el.style.opacity = '1'; }, 100);
  if (el.hideTimeout) clearTimeout(el.hideTimeout);

  el.hideTimeout = setTimeout(() => {
    el.style.opacity = '0';
  }, 7000);
}
// 🔥 FIN DE LA RESTAURACIÓN 🔥

// ==========================================
// 🔥 MODO CONCENTRACIÓN (ATENUAR PLANETAS)
// ==========================================
function toggleCombatDimming(isCombat) {
  categoryPlanets.forEach(p => {
    // Verificamos el nuevo material liso
    if (p.material && p.material.color) {
      if (isCombat) {
        if (!p.userData.preCombatColor) p.userData.preCombatColor = p.material.color.getHex();
        p.material.color.setHex(0x111111); // Apagar luces
      } else {
        // Restaurar luces
        if (p.userData.preCombatColor) {
          p.material.color.setHex(p.userData.preCombatColor);
          p.userData.preCombatColor = null; 
        } else {
          // Re-aplicar el multiplicador de luz si no ha sido visitado
          const restColor = new THREE.Color(p.userData.visited ? 0x555555 : p.userData.originalColor);
          if (!p.userData.visited) restColor.multiplyScalar(3.5);
          p.material.color.copy(restColor);
        }
      }
    }
    // Ocultar textos
    if (p.children.length > 0) p.children[0].visible = !isCombat;
  });
  
  if (typeof satelliteGroup !== 'undefined') satelliteGroup.visible = !isCombat;
}
// ========================================================
// FUNCIÓN DE GLITCH SUTIL Y PARCIAL (CORREGIDA)
// ========================================================
function triggerSubtleGlitch() {
  if (!isGameStarted || isPaused || isUIOpen || renderer.xr.isPresenting) return;

  const numBlocks = Math.floor(Math.random() * 3) + 1;
  
  for (let i = 0; i < numBlocks; i++) {
    const block = document.createElement('div');
    block.classList.add('cyber-glitch-block');

    const width = Math.random() * 300 + 20; 
    const height = Math.random() * 10 + 2; // 🔥 CORREGIDO A 10 PÍXELES MÁXIMO

    const top = Math.random() * (window.innerHeight - height);
    const left = Math.random() * (window.innerWidth - width);

    const color = Math.random() > 0.5 ? '#00ffff' : '#ff00ff';

    block.style.width = `${width}px`;
    block.style.height = `${height}px`;
    block.style.top = `${top}px`;
    block.style.left = `${left}px`;
    block.style.boxShadow = `0 0 10px ${color}, 0 0 20px ${color}`;
    block.style.background = color;

    document.body.appendChild(block);

    setTimeout(() => {
      if (block.parentNode) block.parentNode.removeChild(block);
    }, 100);
  }
}

setInterval(() => {
  if (Math.random() > 0.6) { triggerSubtleGlitch(); }
}, 2000);

const foundProjects = new Set(); const totalProjects = 13; // 8 normales + 1 ballena + 1 voyager + 2 gatos

function updateProgress(id) { 
  if(!foundProjects.has(id)) { 
    foundProjects.add(id); 
    document.getElementById('progress-value').innerText = foundProjects.size; 
    
    // 🔥 SI LLEGA AL 100%, ENTREGAR PREMIO
    if(foundProjects.size === totalProjects) { 
      if (window.trackEvent) trackEvent('Logro', '100_Completado'); 
      unlockInvertedMode();
    } 
  } 
}

function unlockInvertedMode() {
showSystemToast('ANOMALÍA DETECTADA A TUS ESPALDAS', '#cc0000');  playSound('levelup');
  
  // Crear el botón de recompensa flotante
  const btn = document.createElement('button');
  btn.innerHTML = '☯ MODO INVERTIDO';
  btn.style.cssText = "position: fixed; bottom: 20px; left: 20px; z-index: 100000; background: #00ffff; color: #000; border: none; padding: 10px 15px; font-family: 'Share Tech Mono', monospace; font-weight: bold; cursor: pointer; box-shadow: 0 0 15px #00ffff;";
  
  btn.onclick = () => {
    document.body.classList.toggle('inverted-mode');
    playSound('ui');
    btn.innerHTML = document.body.classList.contains('inverted-mode') ? '☾ MODO OSCURO' : '☯ MODO INVERTIDO';
  };
  document.body.appendChild(btn);
}
// 🔥 2. ARRANQUE FORZADO ANTIBLOQUEOS
const manager = new THREE.LoadingManager(); 
manager.onLoad = function () { finishLoading(); };
manager.onError = function (url) { 
  console.warn("⚠️ Forzando inicio. Archivo faltante o lento:", url);
  finishLoading(); 
};
// Si el navegador se congela leyendo un archivo, a los 3 segundos arrancará el universo a la fuerza
setTimeout(finishLoading, 3000);


const gltfLoader = new GLTFLoader(manager);
let whaleModelTemplate = null; 
let voyagerModelTemplate = null; 
let gamberModelTemplate = null;
let chaplinModelTemplate = null;

function createTextSprite(message, colorHex = "#ffffff") { 
  const canvas = document.createElement('canvas'); 
  const context = canvas.getContext('2d'); 
  canvas.width = 1024; canvas.height = 256; 
  context.clearRect(0, 0, canvas.width, canvas.height);
  
  // 🔥 Tipografía más técnica y delgada
  context.font = "35px 'Share Tech Mono', monospace"; 
  context.textAlign = "center"; context.textBaseline = "middle"; 
  
  // 🔥 Quitamos las sombras pesadas
  context.shadowColor = "transparent"; context.shadowBlur = 0;
  
  // 🔥 Color blanco técnico
  context.fillStyle = "rgba(255, 255, 255, 0.85)"; 
  context.fillText(message, 512, 128); 
  
  const texture = new THREE.CanvasTexture(canvas); 
  texture.minFilter = THREE.LinearFilter; 
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.95 }); 
  const sprite = new THREE.Sprite(spriteMat); 
  sprite.scale.set(16, 4, 1); sprite.userData = { id: Math.random() }; 
  return sprite; 
}

function finishLoading() { 
  document.getElementById('loading-text').innerText = "> SISTEMA OPERATIVO LISTO_"; 
  document.getElementById('loading-bar').style.width = '100%'; 
  setTimeout(() => { 
    document.getElementById('start-btn').style.display = 'block'; 
    document.getElementById('skip-btn').style.display = 'block'; 
    document.getElementById('loading-screen').style.opacity = '0'; 
    setTimeout(() => { document.getElementById('loading-screen').style.display = 'none'; }, 500); 
  }, 1000); 
}

gltfLoader.load('ballena.glb', (gltf) => { 
  whaleModelTemplate = new THREE.Group(); 
  const shaderMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0x00ffff) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } },
    vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true
  });
  gltf.scene.traverse((child) => { 
    if (child.isMesh && child.geometry) { 
      const mesh = new THREE.Mesh(child.geometry, shaderMat);
      mesh.position.copy(child.position); mesh.rotation.copy(child.rotation); mesh.scale.copy(child.scale); 
      whaleModelTemplate.add(mesh); 
    } 
  }); 
});

gltfLoader.load('voyager.glb', (gltf) => { 
  voyagerModelTemplate = new THREE.Group(); 
  const shaderMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xaaff00) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } },
    vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true
  });
  gltf.scene.traverse((child) => { 
    if (child.isMesh && child.geometry) { 
      const mesh = new THREE.Mesh(child.geometry, shaderMat);
      mesh.position.copy(child.position); mesh.rotation.copy(child.rotation); mesh.scale.copy(child.scale); 
      voyagerModelTemplate.add(mesh); 
    } 
  }); 
  voyagerModelTemplate.scale.set(1, 1, 1); 
});

gltfLoader.load('gamber.glb', (gltf) => { 
  gamberModelTemplate = new THREE.Group(); 
  const shaderMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xff8800) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } },
    vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true
  });
  gltf.scene.traverse((child) => { 
    if (child.isMesh && child.geometry) { 
      const mesh = new THREE.Mesh(child.geometry, shaderMat);
      mesh.position.copy(child.position); mesh.rotation.copy(child.rotation); mesh.scale.copy(child.scale); 
      gamberModelTemplate.add(mesh); 
    } 
  }); 
  gamberModelTemplate.scale.set(0.1, 0.1, 0.1); 
  const text = createTextSprite('SYS_GAMBER', '#ff8800'); text.position.y = -2; text.scale.set(6, 1.5, 1); 
  gamberModelTemplate.add(text);
});

gltfLoader.load('chaplin.glb', (gltf) => { 
  chaplinModelTemplate = new THREE.Group(); 
  const shaderMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xaa00ff) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } },
    vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true
  });
  gltf.scene.traverse((child) => { 
    if (child.isMesh && child.geometry) { 
      const mesh = new THREE.Mesh(child.geometry, shaderMat);
      mesh.position.copy(child.position); mesh.rotation.copy(child.rotation); mesh.scale.copy(child.scale); 
      chaplinModelTemplate.add(mesh); 
    } 
  }); 
  chaplinModelTemplate.scale.set(0.7, 0.7, 0.7); 
  const text = createTextSprite('SYS_CHAPLIN', '#aa00ff'); text.position.y = -2; text.scale.set(1, 1.5, 1); 
  chaplinModelTemplate.add(text);
});

let hasMoved = false; let hasShot = false;
let isCombatActive = false; 
function checkOnboarding() { if(hasMoved && hasShot) document.getElementById('onboarding-ui')?.classList.add('hidden'); }

function initSystem(skip = false) { 
  // 🔥 1. Transición cinematográfica: Desvanece la pantalla negra
  const startScreen = document.getElementById('start-screen');
  if (startScreen) {
    startScreen.style.opacity = '0';
    setTimeout(() => { 
      startScreen.style.display = 'none'; 
      // 🔥 2. LANZAR TUTORIAL AL TERMINAR LA TRANSICIÓN
      if (!skip) {
        openUIWindow('tutorial-ui');
      }
    }, 1500); 
  }
  
  isGameStarted = true; 
  
  // 🔥 3. APARECER LOS BOTONES LATERALES
  const btnMenu = document.getElementById('menu-toggle');
  const btnCombat = document.getElementById('combat-toggle-btn');
  const btnGamepad = document.getElementById('gamepad-btn');
  if(btnMenu) btnMenu.style.display = 'flex';
  if(btnCombat) btnCombat.style.display = 'flex';
  if(btnGamepad) btnGamepad.style.display = 'flex';

  // 4. Empezar siempre en modo paz (Play verde)
  isCombatActive = false;
  if(btnCombat) {
    btnCombat.innerText = '▶'; 
    btnCombat.style.borderColor = '#00ff00';
    btnCombat.style.color = '#00ff00';
  }

  if(skip) { 
    document.getElementById('side-menu')?.classList.add('open'); 
    document.getElementById('onboarding-ui')?.classList.add('hidden'); 
  } 
  
  if(!skip) document.getElementById('scroll-hint')?.classList.remove('hidden');
  
  for(let i=0; i<3; i++) spawnAsteroid(); 
  setInterval(spawnAsteroid, 1000); 
}

document.getElementById('start-btn')?.addEventListener('click', (e) => { 
  e.stopPropagation(); // 🔥 Escudo protector: el clic no traspasa el fondo
  e.currentTarget.blur(); 
  playSound('levelup')
  initSystem(false); 
});
document.getElementById('skip-btn')?.addEventListener('click', (e) => { 
  e.stopPropagation(); 
  e.currentTarget.blur(); 
  initSystem(true); // Cierra la pantalla de inicio
  
  // 🔥 Espera medio segundo a que termine la animación de inicio y activa las anomalías
  setTimeout(() => {
    const combatBtn = document.getElementById('combat-toggle-btn');
    if (combatBtn) combatBtn.click();
  }, 500);
});
window.closeAllUIs = function() { 
  document.body.classList.remove('ui-active'); 
  document.getElementById('modal-overlay')?.classList.add('hidden');
  
  // 🔥 AQUÍ AGREGAMOS EL TUTORIAL A LA LISTA DE APAGADO
  document.getElementById('tutorial-ui')?.classList.add('hidden'); 
  document.getElementById('dac-microsite')?.classList.add('hidden');
  
  document.getElementById('portfolio-ui').classList.add('hidden'); 
  document.getElementById('about-ui').classList.add('hidden'); 
  document.getElementById('contact-ui').classList.add('hidden'); 
  document.getElementById('leaderboard-ui').classList.add('hidden'); 
  document.getElementById('blog-ui')?.classList.add('hidden');
  
  document.getElementById('project-media').innerHTML = ''; 
  document.getElementById('project-long-desc').innerHTML = ''; 
  document.getElementById('project-long-desc').classList.add('hidden'); 
  document.getElementById('portfolio-ui').classList.remove('expanded-modal'); 
  document.getElementById('faq-ui')?.classList.add('hidden');
  
  isUIOpen = false; 
  targetFov = 75; // 🔥 GARANTIZA QUE EL ZOOM SE DESTRABE SIEMPRE
  window.isZooming = false; // Libera el bloqueo de clics
  
  document.getElementById('bg-canvas').classList.remove('canvas-blurred'); 
}

function openUIWindow(elementId) { 
  // Cerrar todo primero
  window.closeAllUIs(); 
  
  // Asegurarse de que el modal overlay esté visible
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.classList.remove('hidden');
  
  // Mostrar la ventana solicitada
  const targetWindow = document.getElementById(elementId);
  if (targetWindow) {
    targetWindow.classList.remove('hidden');
  }
  
  document.body.classList.add('ui-active');
  isUIOpen = true; 
  
  const canvas = document.getElementById('bg-canvas');
  if (canvas) canvas.classList.add('canvas-blurred');
  
  playSound('ui'); 
}

const sideMenu = document.getElementById('side-menu'); 
document.getElementById('menu-toggle')?.addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); sideMenu.classList.toggle('open'); }); 
document.getElementById('menu-close')?.addEventListener('click', (e) => { e.stopPropagation(); sideMenu.classList.remove('open'); });

document.querySelectorAll('.menu-item').forEach(item => { 
  item.addEventListener('click', (e) => { 
    if(item.id === 'menu-mute' || item.id === 'menu-bloom' || item.id === 'menu-align' || item.id === 'custom-ar-btn' || item.id === 'custom-vr-btn') return; 
    e.preventDefault(); sideMenu.classList.remove('open'); 
    
    if (item.id === 'menu-about') { openUIWindow('about-ui'); return; } 
    if (item.id === 'menu-contact') { openUIWindow('contact-ui'); return; } 
    if (item.id === 'menu-leaderboard') { showLeaderboard(); return; } // 🔥 NUEVO BOTÓN
    if (item.id === 'menu-blog') { openUIWindow('blog-ui'); return; }
    if (item.id === 'menu-faq') { openUIWindow('tutorial-ui'); return; }
    
    const projectId = item.getAttribute('data-id'); 
    if (projectId) { 
      const projectData = categoryPlanetData.find(p => p.id === parseInt(projectId)); 
      if (projectData) openProjectPopup(projectData); 
    } 
  }); 
});

window.addEventListener('keydown', (e) => { if(e.key === 'Escape') { window.closeAllUIs(); sideMenu.classList.remove('open'); } });

// ==========================================
// 🔥 MEMORIA DE PREFERENCIAS DEL SISTEMA (UX)
// ==========================================
const sysPrefs = JSON.parse(localStorage.getItem('gamelab_prefs')) || { sound: true, bloom: true, lang: 'es' };

// 1. Cargar preferencias al iniciar
isSoundEnabled = sysPrefs.sound;
let isBloomEnabled = sysPrefs.bloom;
bloomPass.strength = isBloomEnabled ? 0.1 : 0; 

// 2. Aplicar aspecto visual a los botones según la memoria
const muteBtnInit = document.getElementById('global-mute-btn');
if(muteBtnInit) {
  muteBtnInit.innerText = isSoundEnabled ? '🔊' : '🔇'; 
  muteBtnInit.style.color = isSoundEnabled ? '#00ff00' : '#888'; 
  muteBtnInit.style.borderColor = isSoundEnabled ? '#00ff00' : '#888'; 
}
const bloomBtnInit = document.getElementById('menu-bloom');
if(bloomBtnInit) {
  bloomBtnInit.innerText = isBloomEnabled ? '[*]Efecto Neón: ON' : '[ ]Efecto Neón: OFF'; 
  bloomBtnInit.style.color = isBloomEnabled ? '#00ffaa' : '#888'; 
}

// 3. Evento Mute con Guardado
document.getElementById('global-mute-btn')?.addEventListener('click', (e) => { 
  e.preventDefault(); e.stopPropagation(); e.currentTarget.blur();
  isSoundEnabled = !isSoundEnabled; 
  e.currentTarget.innerText = isSoundEnabled ? '🔊' : '🔇'; 
  e.currentTarget.style.color = isSoundEnabled ? '#00ff00' : '#888'; 
  e.currentTarget.style.borderColor = isSoundEnabled ? '#00ff00' : '#888'; 
  
  sysPrefs.sound = isSoundEnabled;
  localStorage.setItem('gamelab_prefs', JSON.stringify(sysPrefs)); // Guarda la decisión
});

// 4. Evento Neón con Guardado
document.getElementById('menu-bloom')?.addEventListener('click', (e) => { 
  e.preventDefault(); e.stopPropagation(); 
  isBloomEnabled = !isBloomEnabled; 
  bloomPass.strength = isBloomEnabled ? 0.1 : 0; 
  e.currentTarget.innerText = isBloomEnabled ? '[*]Efecto Neón: ON' : '[ ]Efecto Neón: OFF'; 
  e.currentTarget.style.color = isBloomEnabled ? '#00ffaa' : '#888'; 
  
  sysPrefs.bloom = isBloomEnabled;
  localStorage.setItem('gamelab_prefs', JSON.stringify(sysPrefs)); // Guarda la decisión
});

// 🔥 LÓGICA PARA CAMBIAR ENTRE CARRUSEL Y CONSTELACIÓN
document.getElementById('menu-align')?.addEventListener('click', (e) => {
  e.preventDefault(); e.stopPropagation(); 
  const sideMenu = document.getElementById('side-menu');
  if (sideMenu) sideMenu.classList.remove('open');
  
  isAligned = !isAligned;
  
  if (window.currentLang === 'en') {
    e.currentTarget.innerText = isAligned ? '[O] View: 3D CAROUSEL' : '[O] View: CONSTELLATION';
  } else {
    e.currentTarget.innerText = isAligned ? '[O] Vista: CARRUSEL 3D' : '[O] Vista: CONSTELACIÓN';
  }
  
  playSound('ui');
  
  if (isAligned) { 
    userGroup.position.set(0, 0, 30); 
    userGroup.rotation.set(0, 0, 0);  
  } else { 
    userGroup.position.set(0, 0, 45); 
    categoryPlanets.forEach(p => {
      if (p.userData.randomPos) p.userData.targetPos = p.userData.randomPos.clone();
    });
  }
});
// 🔥 LÓGICA DEL MODO RETRO B&W
let isRetroMode = false; 
document.getElementById('menu-retro')?.addEventListener('click', (e) => { 
  e.preventDefault(); e.stopPropagation(); 
  isRetroMode = !isRetroMode; 
  
  // 1. Activar o desactivar la clase CSS en todo el cuerpo de la página
  document.body.classList.toggle('retro-mode', isRetroMode);
  
  // 2. Cambiar el texto del botón
  e.currentTarget.innerText = isRetroMode ? '▤ MODO: CYBERPUNK NEÓN' : '▤ MODO: RETRO B&W'; 
  
  // 3. Apagar el Neón (Bloom) obligatoriamente en modo retro para que se vea afilado
  if (isRetroMode) {
    bloomPass.strength = 0; 
  } else {
    bloomPass.strength = isBloomEnabled ? 0.1 : 0; 
  }
  
  playSound('ui'); 
  sideMenu.classList.remove('open');
});
document.getElementById('combat-toggle-btn')?.addEventListener('click', (e) => {
  e.preventDefault(); e.stopPropagation(); e.currentTarget.blur();
  isCombatActive = !isCombatActive;
  const btn = e.currentTarget;
  const touchControls = document.getElementById('touch-controls');
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
  
  if (isCombatActive) {
    btn.innerText = '⏸'; 
    btn.style.borderColor = '#ff0000';
    btn.style.color = '#ff0000';
    btn.title = 'Pausar / Volver a Modo Paz'; // Tooltip
    playSound('ui');
    showSystemToast('✧ ANOMALÍAS REVELADAS : SISTEMA INESTABLE ✧', '#ffffff');
    toggleCombatDimming(true); // Apagar luces
    if (isTouchDevice && touchControls) touchControls.style.display = 'flex';
  } else {
    toggleCombatDimming(false); // Encender luces
    btn.innerText = '▶'; 
    btn.style.borderColor = '#00ff00';
    btn.style.color = '#00ff00';
    btn.title = 'Activar Minijuego (Asteroides)'; // Tooltip
    asteroids.forEach(a => scene.remove(a)); asteroids.length = 0;
    enemyProjectiles.forEach(p => scene.remove(p)); enemyProjectiles.length = 0;
    if(bossEntity) { scene.remove(bossEntity); bossEntity = null; document.getElementById('boss-ui').classList.add('hidden'); }
    playSound('ui');
  showSystemToast('✧ ARMONÍA RESTAURADA ✧', '#00ffaa');
    if (touchControls) touchControls.style.display = 'none';
  }
});

// 🔥 ARREGLO DEL CRASH DE MEMORIA (PANTALLA NEGRA) - REDUCIDO A 1500 ESTRELLAS
const particlesGeo = new THREE.BufferGeometry(); 
// 1500 estrellas x 3 coordenadas (X, Y, Z) = 4500
const posArray = new Float32Array(4500); 
for(let i = 0; i < 4500; i++) {
  posArray[i] = (Math.random() - 0.5) * 100; 
}
particlesGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3)); 
// Las hacemos un poco más transparentes (0.5) y pequeñas (0.15) para que no distraigan
const particlesMesh = new THREE.Points(particlesGeo, new THREE.PointsMaterial({ size: 0.15, color: 0xffffff, transparent: true, opacity: 0.5 })); 
scene.add(particlesMesh);

const ship = new THREE.Group();
const shipBody = new THREE.Mesh(new THREE.ConeGeometry(1, 3, 4), new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(0x00ff00) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } }, vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true }));ship.add(shipBody); 
const shieldMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(2.4, 1), new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(0x00ffff) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } }, vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true }));shieldMesh.visible = false; ship.add(shieldMesh); ship.position.y = -15; ship.scale.set(0.6, 0.6, 0.6); scene.add(ship);




// 🔥 1. CREAR TEXTURA DE LED REDONDO (Se crea una sola vez para optimizar memoria)
const dotCanvas = document.createElement('canvas');
dotCanvas.width = 64; dotCanvas.height = 64;
const dotCtx = dotCanvas.getContext('2d');
dotCtx.beginPath();
dotCtx.arc(32, 32, 30, 0, Math.PI * 2);
dotCtx.fillStyle = '#ffffff';
dotCtx.fill();
const dotTexture = new THREE.CanvasTexture(dotCanvas);

// ==========================================================
// 🔥 EL MAGNÍFICO SHADER DE TRAMADO (ORDERED DITHERING 1-BIT)
// ==========================================================


const categoryPlanets = [];

// 🔥 1. LEER LA MEMORIA LOCAL DE LA CONSTELACIÓN
const savedConstellation = JSON.parse(localStorage.getItem('gamelab_constellation')) || {};

categoryPlanetData.forEach((proj, index) => { 
  
  // 1. Volvemos a crear esferas sólidas lisas
  let geo = proj.isFolder 
    ? new THREE.BoxGeometry(4, 2, 0.5) 
    : new THREE.SphereGeometry(3, 32, 32); 

// 2. MODO 'GRIS': Esferas lisas y etéreas de luz pura (MeshBasicMaterial)
  const baseColor = new THREE.Color(proj.color);
  const planetMat = new THREE.MeshBasicMaterial({
    // 🔥 MAGIA: Multiplicamos el color pastel x1.8 para forzar que sobrepase
    // el umbral del Bloom y genere ese brillo externo difuminado de tu imagen.
  color: baseColor.multiplyScalar(3.5),
    transparent: true, 
    opacity: 0.95 // Ligeramente translúcidos
  });

  const planet = new THREE.Mesh(geo, planetMat); 
  planet.scale.set(1.4, 1.4, 1.4); 
  // ASIGNAR userData COMPLETO
planet.userData = { 
  ...proj, 
  id: proj.id,  // ← Asegurar que el ID esté presente
  originalColor: proj.color, 
  vy: (Math.random()-0.5)*0.01
};
  
  // 🔥 2. APLICAR LA POSICIÓN GUARDADA SI EXISTE
  if (savedConstellation[proj.id]) {
    planet.position.set(savedConstellation[proj.id].x, savedConstellation[proj.id].y, savedConstellation[proj.id].z);
    planet.userData = { ...proj, originalColor: proj.color, vy: (Math.random()-0.5)*0.01, randomPos: planet.position.clone(), targetPos: planet.position.clone(), baseY: savedConstellation[proj.id].y }; 
  } else {
    planet.position.set((Math.random() - 0.5) * 75, (Math.random() - 0.5) * 45, (Math.random() - 0.5) * 30);
    planet.userData = { ...proj, originalColor: proj.color, vy: (Math.random()-0.5)*0.01 }; 
  }
  
  const hexColorStr = '#' + proj.color.toString(16).padStart(6, '0');
  const pTitle = typeof proj.title === 'object' ? proj.title[window.currentLang || 'es'] : proj.title;
  const label = createTextSprite(`> ${proj.id}. ${pTitle}`, hexColorStr);
  label.position.set(0, 5, 0); 
  planet.add(label); 

  scene.add(planet); categoryPlanets.push(planet);
  // 🔥 GAMEBOY CON EL MISMO EFECTO DE TRAMADO RETRO
  if (proj.id === 2) {
    planet.material.visible = false; 
    
    gltfLoader.load('gameboy.glb', (gltf) => {
      const gameboy = gltf.scene;
      gameboy.scale.set(14, 21, 21); 
      gameboy.rotation.x = 0.5;   
      
      const gbMat = new THREE.ShaderMaterial({
        uniforms: {
          color: { value: new THREE.Color(0x00aaff) }, // Gameboy Cyan
          lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() }
        },
        vertexShader: ditherShader.vertexShader,
        fragmentShader: ditherShader.fragmentShader,
        transparent: true
      });

      gameboy.traverse((child) => {
        if (child.isMesh) child.material = gbMat;
      });
      
      planet.add(gameboy); 
    }, 
    undefined, (error) => console.error(error));
  }
});



// ==========================================
// 🔥 SISTEMA DAC (Diseño, Arte y Ciencia) 🔥
// ==========================================

// 🔥 1. LUZ INTENSA: Subimos la intensidad para que el núcleo resalte sobre el resto del universo
const dacLight = new THREE.DirectionalLight( 0xffffff, 3.5 ); // Subimos de 1.0 a 3.5
dacLight.position.set( 1, 1, 1 ).normalize();
scene.add( dacLight );

// 2. EL NÚCLEO: Estética Caótica ESFÉRICA (BufferGeometry)
const dacTriangles = 1000; // Densidad
const dacCoreGeo = new THREE.BufferGeometry();
const dacPos = new Float32Array( dacTriangles * 3 * 3 );
const dacNorm = new Float32Array( dacTriangles * 3 * 3 );
const dacCol = new Float32Array( dacTriangles * 3 * 3 );

const dColor = new THREE.Color();
const radiusDAC = 5.5; // 🔥 Radio exacto de la esfera para contener el caos
const d = 2.8, d2 = d / 2; // Triángulos un poco más pequeños para definir mejor la curva

const pA = new THREE.Vector3(); const pB = new THREE.Vector3(); const pC = new THREE.Vector3();
const cb = new THREE.Vector3(); const ab = new THREE.Vector3();

for ( let i = 0; i < dacPos.length; i += 9 ) {
  // 🔥 MATEMÁTICA ESFÉRICA: En lugar de un cubo, generamos posiciones dentro de una esfera
  const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
  const dist = Math.cbrt(Math.random()) * radiusDAC; // Distribución volumétrica uniforme
  const x = dir.x * dist; 
  const y = dir.y * dist; 
  const z = dir.z * dist;
  
  // Posiciones de los 3 vértices
  const ax = x + Math.random() * d - d2; const ay = y + Math.random() * d - d2; const az = z + Math.random() * d - d2;
  const bx = x + Math.random() * d - d2; const by = y + Math.random() * d - d2; const bz = z + Math.random() * d - d2;
  const cx = x + Math.random() * d - d2; const cy = y + Math.random() * d - d2; const cz = z + Math.random() * d - d2;
  
  dacPos[ i ] = ax; dacPos[ i + 1 ] = ay; dacPos[ i + 2 ] = az;
  dacPos[ i + 3 ] = bx; dacPos[ i + 4 ] = by; dacPos[ i + 5 ] = bz;
  dacPos[ i + 6 ] = cx; dacPos[ i + 7 ] = cy; dacPos[ i + 8 ] = cz;
  
  // Calcular normales
  pA.set( ax, ay, az ); pB.set( bx, by, bz ); pC.set( cx, cy, cz );
  cb.subVectors( pC, pB ); ab.subVectors( pA, pB );
  cb.cross( ab ).normalize();
  
  dacNorm[ i ] = cb.x; dacNorm[ i + 1 ] = cb.y; dacNorm[ i + 2 ] = cb.z;
  dacNorm[ i + 3 ] = cb.x; dacNorm[ i + 4 ] = cb.y; dacNorm[ i + 5 ] = cb.z;
  dacNorm[ i + 6 ] = cb.x; dacNorm[ i + 7 ] = cb.y; dacNorm[ i + 8 ] = cb.z;
  
  // Color basado en el radio esférico (mantiene el degradado)
  dColor.setRGB( ( x / radiusDAC ) * 0.5 + 0.5, ( y / radiusDAC ) * 0.5 + 0.5, ( z / radiusDAC ) * 0.5 + 0.5 );
  
  dacCol[ i ] = dColor.r; dacCol[ i + 1 ] = dColor.g; dacCol[ i + 2 ] = dColor.b;
  dacCol[ i + 3 ] = dColor.r; dacCol[ i + 4 ] = dColor.g; dacCol[ i + 5 ] = dColor.b;
  dacCol[ i + 6 ] = dColor.r; dacCol[ i + 7 ] = dColor.g; dacCol[ i + 8 ] = dColor.b;
}

dacCoreGeo.setAttribute( 'position', new THREE.BufferAttribute( dacPos, 3 ) );
dacCoreGeo.setAttribute( 'normal', new THREE.BufferAttribute( dacNorm, 3 ) );
dacCoreGeo.setAttribute( 'color', new THREE.BufferAttribute( dacCol, 3 ) );

// 🔥 MATERIAL MATE: Apagamos 'specular' y 'shininess' para matar el brillo molesto
const dacMaterial = new THREE.MeshPhongMaterial({
  color: 0x888888, 
  specular: 0x888888, 
  shininess: 1000,
  side: THREE.DoubleSide, 
  vertexColors: true, 
  flatShading: false,
});

const planetaDAC = new THREE.Mesh( dacCoreGeo, dacMaterial );
planetaDAC.position.set(40, 0, -50); 
planetaDAC.name = "planeta_dac";

// Escudo invisible
const dacHitboxPlanet = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 16), new THREE.MeshBasicMaterial({visible: false}));
dacHitboxPlanet.name = "planeta_dac"; 
planetaDAC.add(dacHitboxPlanet);

// 2. LA TRÍADA DE MÁQUINAS (Atractores Matemáticos de Partículas)

function createAttractor(type, colorHex) {
  const particleCount = 6000;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(particleCount * 3);
  
  let x = 0.1, y = 0.1, z = 0.1;

  // Calculamos las posiciones usando ecuaciones del Caos
  for (let i = 0; i < particleCount; i++) {
    if (type === 'poetica') {
      // Atractor de Lorenz (Forma hermosa de alas de mariposa)
      const dt = 0.006;
      let dx = 10 * (y - x) * dt;
      let dy = (x * (28 - z) - y) * dt;
      let dz = (x * y - (8/3) * z) * dt;
      x += dx; y += dy; z += dz;
      
      pos[i*3] = x * 0.08;
      pos[i*3+1] = y * 0.08 - 2.0; 
      pos[i*3+2] = z * 0.08;
    } 
    else if (type === 'erratica') {
      // Atractor de Clifford (Fragmentado, caótico y afilado)
      let nx = Math.sin(-1.4 * y) + Math.cos(-1.4 * x);
      let ny = Math.sin(1.6 * x) + 0.7 * Math.cos(1.6 * y);
      let nz = Math.sin(1.0 * z) + Math.cos(x * y); 
      x = nx; y = ny; z = nz;
      
      pos[i*3] = x * 1.5;
      pos[i*3+1] = y * 1.5;
      pos[i*3+2] = z * 1.5;
    }
 else if (type === 'friccion') {
      // 🔥 Máquina de Fricción: Luna densa y pesada con anillos de escombros (Estructura Esférica)
      if (i < particleCount * 0.75) {
        // El 75% de las partículas forman un núcleo esférico masivo (Distribución de Fibonacci)
        const phi = Math.acos(-1 + (2 * i) / (particleCount * 0.75));
        const theta = Math.sqrt((particleCount * 0.75) * Math.PI) * phi;
        const r = 1.4 + (Math.random() * 0.15); // Superficie ligeramente rocosa/rugosa
        
        x = r * Math.cos(theta) * Math.sin(phi);
        y = r * Math.sin(theta) * Math.sin(phi);
        z = r * Math.cos(phi);
      } else {
        // El 25% restante forma un disco de acreción (anillos planetarios frotándose)
        const angle = Math.random() * Math.PI * 2;
        const r = 1.9 + Math.random() * 1.2; // Extensión del anillo
        x = Math.cos(angle) * r;
        y = (Math.random() - 0.5) * 0.25; // Anillo plano con un poco de grosor
        z = Math.sin(angle) * r;
      }
      
      pos[i*3] = x;
      pos[i*3+1] = y;
      pos[i*3+2] = z;
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  
  // Material luminoso tipo polvo cósmico
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(colorHex).multiplyScalar(2.0),
    size: 0.06,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  
  return new THREE.Points(geo, mat);
}

// 🔥 Máquina Poética: Nube de luz fluida
const lunaPoetica = createAttractor('poetica', 0xffffff);
lunaPoetica.position.set(12, 0, 0); 
lunaPoetica.name = "maquina_poetica";
const hitP = new THREE.Mesh(new THREE.BoxGeometry(3,3,3), new THREE.MeshBasicMaterial({visible:false})); lunaPoetica.add(hitP);

// 🔥 Máquina Errática: Tormenta de código rojo
const lunaErratica = createAttractor('erratica', 0xff3300);
lunaErratica.position.set(-8, 6, -8);
lunaErratica.name = "maquina_erratica";
const hitE = new THREE.Mesh(new THREE.BoxGeometry(3,3,3), new THREE.MeshBasicMaterial({visible:false})); lunaErratica.add(hitE);

// 🔥 Máquina de Fricción: Bloque denso amarillo
const lunaFriccion = createAttractor('friccion', 0xffff00);
lunaFriccion.position.set(0, -10, 8);
lunaFriccion.name = "maquina_friccion";
const hitF = new THREE.Mesh(new THREE.BoxGeometry(3,3,3), new THREE.MeshBasicMaterial({visible:false})); lunaFriccion.add(hitF);

// 3. ENSAMBLAJE
planetaDAC.add(lunaPoetica);
planetaDAC.add(lunaErratica);
planetaDAC.add(lunaFriccion);

scene.add(planetaDAC);
// Estados de la Tríada DAC
let isPoeticaActive = false;
let isErraticaActive = false;
let isFriccionActive = false;
// ==========================================
// 🔥 RED EPISTÉMICA DAC (NODOS Y LÍNEAS)
// ==========================================
const dacNetworkGroup = new THREE.Group();
planetaDAC.add(dacNetworkGroup); // Se ancla al planeta central

// 1. Los Nodos (🔥 Subimos a 200 partículas para llenar la nueva atmósfera gigante)
const dacParticleCount = 100;
const dacParticlesGeo = new THREE.BufferGeometry();
const dacParticlePositions = new Float32Array(dacParticleCount * 3);
const dacParticleData = [];

for (let i = 0; i < dacParticleCount; i++) {
  // 🔥 Volumen expandido de 15 a 55 para que fluyan libres en el espacio
  const x = (Math.random() - 0.5) * 10;
  const y = (Math.random() - 0.5) * 10;
  const z = (Math.random() - 0.5) * 10;
  dacParticlePositions[i*3] = x; dacParticlePositions[i*3+1] = y; dacParticlePositions[i*3+2] = z;
  dacParticleData.push({
    velocity: new THREE.Vector3((Math.random()-0.5)*0.04, (Math.random()-0.5)*0.04, (Math.random()-0.5)*0.04),
    baseX: x, baseY: y, baseZ: z
  });
}
dacParticlesGeo.setAttribute('position', new THREE.BufferAttribute(dacParticlePositions, 3));
const dacParticles = new THREE.Points(dacParticlesGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.5 }));
dacNetworkGroup.add(dacParticles);
// 2. El Pincel de Interacción
// 🔥 Devolvemos la esfera visual a un tamaño elegante y pequeño (0.2).
// El radio de luz seguirá siendo enorme gracias a las matemáticas del fondo.
const dacBrush = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true }));

// 🔥 ESCUDO FANTASMA: Desactivamos sus colisiones. Ahora los clics lo atraviesan
// y van directo a las lunas, sin importar dónde esté el ratón.
dacBrush.raycast = function() {}; 

dacNetworkGroup.add(dacBrush);

// 3. Las Conexiones Dinámicas (Líneas - ESTILO WEBGL_INTERACTIVE)
const dacLinesGeo = new THREE.BufferGeometry();
// 🔥 CORRECCIÓN: Memoria para miles de conexiones simultáneas entre partículas
const maxLines = 3000; 
const dacLinePositions = new Float32Array(maxLines * 6); 
const dacLineAttr = new THREE.BufferAttribute(dacLinePositions, 3);
try { if (dacLineAttr.setUsage) dacLineAttr.setUsage(THREE.DynamicDrawUsage); } catch(e){}
dacLinesGeo.setAttribute('position', dacLineAttr);

const dacLinesMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 });
const dacLines = new THREE.LineSegments(dacLinesGeo, dacLinesMat);
dacNetworkGroup.add(dacLines);

// 4. Las Palabras Clave de la Investigación
const dacConceptos = ["Autopoiesis", "Ana-arqueología", "Saber-del-cuerpo", "Fricción", "Glitch", "Cacharreo", "Soberanía"];
const dacWords = [];
dacConceptos.forEach(txt => {
  const sp = createTextSprite(txt, '#00ffff');
  // 🔥 ESPACIO: Aumentamos el área de aparición (50 de ancho, 35 de alto) para que rieguen por toda la pantalla
  sp.position.set((Math.random()-0.5)*50, (Math.random()-0.5)*35, 2);
  // 🔥 ESCALA CORREGIDA: Proporción 4:1 (32x8) exacta al canvas, para que dejen de verse aplastadas
  sp.scale.set(32, 8, 1);
  sp.material.depthTest = false; 
  sp.visible = false;
  sp.userData = { basePos: sp.position.clone() };
  dacNetworkGroup.add(sp);
  dacWords.push(sp);
});

dacNetworkGroup.visible = false;



const satelliteGroup = new THREE.Group(); 
const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.0, 16), new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(0xffaa00) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } }, vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true, side: THREE.DoubleSide }));satelliteGroup.add(ring); 
const innerShape = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2, 2, 2), new THREE.MeshBasicMaterial({ color: 0xffaa00, wireframe: true })); 
innerShape.rotation.z = Math.PI / 4; satelliteGroup.add(innerShape); const satHitbox = new THREE.Mesh(new THREE.CircleGeometry(2.5, 16), new THREE.MeshBasicMaterial({ visible: false })); satelliteGroup.add(satHitbox); satelliteGroup.position.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 30, -5); satelliteGroup.userData = { vx: (Math.random() > 0.5 ? 1 : -1) * 0.04, vy: (Math.random() > 0.5 ? 1 : -1) * 0.04 }; scene.add(satelliteGroup);

const guardianCats = []; 
let scrollSpeedBoost = 0; let lastSpawnTime = 0; 
const discoveredVoyagers = []; const ambientWhales = []; const scrollKeywords = [];
let score = 0; let currentLevel = 1; let weaponLevel = 1; let hasShield = false; let shipSpeed = 0.5; let combatCombo = 0; let comboTimer = null;
let isBossBattle = false; let hasFoughtBoss = false; let bossEntity = null; 
let bossMaxHealth = 150; let bossHealth = 150; // 🔥 Jefe mucho más resistente
let enemyProjectiles = []; const enemyProjGeo = new THREE.CapsuleGeometry(0.2, 1, 4, 8); const enemyProjMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
let playerLives = 3; 

function updateLivesUI() {
  const livesEl = document.getElementById('lives-value');
if (livesEl) livesEl.innerText = '■ '.repeat(Math.max(0, playerLives));}

// ==========================================
// 🔥 REPARACIÓN: GAME OVER BLINDADO (SIN CONGELAMIENTO)
// ==========================================
// ==========================================
// 🔥 GAME OVER CORREGIDO - GUARDA PUNTAJE
// ==========================================
function triggerGameOver() {
  try {
    playSound('explosion');
    createExplosion(ship.position.x, ship.position.y, ship.position.z);
    
    if(bossEntity) { 
      scene.remove(bossEntity); 
      bossEntity = null; 
    }
    document.getElementById('boss-ui')?.classList.add('hidden');
    isBossBattle = false;
    hasFoughtBoss = false; 
    
    // Salir del modo combate
    isCombatActive = false;
    
    // 🔥 GUARDAR PUNTAJE ANTES DE RESETEAR (CRÍTICO)
    const finalScoreValue = score;
    console.log("🎮 GAME OVER - Puntaje final:", finalScoreValue);
    
    // Limpiar todos los elementos de combate
    if(typeof asteroids !== 'undefined') { 
      asteroids.forEach(a => { try { scene.remove(a); } catch(e) {} }); 
      asteroids.length = 0; 
    }
    if(typeof enemyProjectiles !== 'undefined') { 
      enemyProjectiles.forEach(p => { try { scene.remove(p); } catch(e) {} }); 
      enemyProjectiles.length = 0; 
    }
    if(typeof fighters !== 'undefined') { 
      fighters.forEach(f => { try { scene.remove(f); } catch(e) {} }); 
      fighters.length = 0; 
    }
    if(typeof projectiles !== 'undefined') { 
      projectiles.forEach(p => { try { scene.remove(p); } catch(e) {} }); 
      projectiles.length = 0; 
    }
    
    // Restaurar botón de combate
    const btnCombat = document.getElementById('combat-toggle-btn');
    if(btnCombat) { 
      btnCombat.innerText = '▶'; 
      btnCombat.style.borderColor = '#00ff00'; 
      btnCombat.style.color = '#00ff00'; 
    }
    
    if(typeof toggleCombatDimming === 'function') toggleCombatDimming(false);
    
    // 🔥 REINICIO DE VARIABLES (DESPUÉS de guardar el score)
    score = 0; 
    currentLevel = 1;
    weaponLevel = 1; 
    playerLives = 3; 
    shipSpeed = 0.5; 
    hasShield = false;
    combatCombo = 0;
    scrollSpeedBoost = 0;
    bossHealth = bossMaxHealth;
    if (typeof comboTimer !== 'undefined') clearTimeout(comboTimer);
    
    if (typeof shieldMesh !== 'undefined' && shieldMesh) shieldMesh.visible = false;
    
    // Actualizar UI
    document.getElementById('score-value').innerText = score;
    document.getElementById('level-value').innerText = currentLevel;
    if(typeof updateLivesUI === 'function') updateLivesUI();
    
    // 🔥 MOSTRAR LEADERBOARD CON EL PUNTAJE GUARDADO
    setTimeout(() => {
      try {
        // Actualizar el display del score final
        const finalScoreDisplay = document.getElementById('final-score-display');
        if (finalScoreDisplay) {
          finalScoreDisplay.innerText = finalScoreValue;
          console.log("📊 Leaderboard muestra:", finalScoreValue);
        }
        
        // Abrir leaderboard
        openUIWindow('leaderboard-ui');
        
        // Actualizar la lista
        updateLeaderboardUI();
        
        showSystemToast('💀 GAME OVER! Puntaje: ' + finalScoreValue, '#ff0000');
      } catch(e) {
        console.error("Error mostrando leaderboard:", e);
        showSystemToast('GAME OVER! Puntaje: ' + finalScoreValue, '#ff0000');
      }
    }, 100);
    
  } catch (error) {
    console.error("Error en GameOver:", error);
  }
}
function updateScore(points) {
  score += points; document.getElementById('score-value').innerText = score;
  if (score >= 5000 && !isBossBattle && !hasFoughtBoss) { isBossBattle = true; spawnBoss(); playSound('explosion'); shakeIntensity = 1.0; } else if (!isBossBattle) { checkLevelUp(); }
}

function spawnBoss() {
  document.getElementById('boss-ui').classList.remove('hidden'); const bossGroup = new THREE.Group();
  const saucer = new THREE.Mesh(new THREE.TorusGeometry(5, 1.5, 8, 30), new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(0xff0000) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } }, vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true })); 

const dome = new THREE.Mesh(new THREE.SphereGeometry(3.5, 10, 10), new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(0xffffff) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } }, vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true }));
  dome.position.y = 1; saucer.rotation.x = Math.PI / 2; bossGroup.add(saucer); bossGroup.add(dome); bossGroup.position.set(0, 35, 0); scene.add(bossGroup); bossEntity = bossGroup;
}

function showLeaderboard() { openUIWindow('leaderboard-ui'); document.getElementById('final-score-display').innerText = score; updateLeaderboardUI(); }

// Agrega el ".json" al final de tu URL de Firebase (es obligatorio para que funcione sin instalar nada extra)
// 🔥 CONFIGURACIÓN DE FIREBASE (Asegúrate de pegar AQUÍ la URL que te dio Firebase)
// No olvides que DEBE terminar en /scores.json
const FIREBASE_URL = 'https://gamelab-portafolio-default-rtdb.firebaseio.com/scores.json'; 

const escapeHTML = (str) => String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function updateLeaderboardUI() {
  const list = document.getElementById('score-list');
  if(list) list.innerHTML = '<li>Estableciendo conexión satelital... 📡</li>'; 

  try {
    const response = await fetch(FIREBASE_URL);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    
    let scores = [];
    if (data) {
      for (let key in data) {
        scores.push(data[key]);
      }
    }

    scores.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));

    if (list) {
      if (scores.length === 0) {
        list.innerHTML = '<li>Aún no hay registros. ¡Sé el primero!</li>';
      } else {
        // Los nombres vienen de una base de datos pública: se escapan para evitar inyección de HTML
        list.innerHTML = scores.slice(0, 5).map((s, i) => 
          `<li style="padding: 5px 0; border-bottom: 1px dashed #333;">#${i+1} - <span style="color:#00ffff">${escapeHTML(s.name)}</span>: ${Number(s.score) || 0} pts</li>`
        ).join('');
      }
    }
  } catch (error) {
    console.error("Error al cargar Leaderboard:", error);
    if(list) list.innerHTML = '<li style="color:red;">Interferencia. No se pudieron cargar los datos.</li>';
  }
}

document.getElementById('score-form')?.addEventListener('submit', async (e) => { 
  e.preventDefault(); 
  
  const nameInput = document.getElementById('player-name');
  const name = nameInput ? (nameInput.value || 'Anónimo') : 'Anónimo'; 
  const submitBtn = e.target.querySelector('button'); 
  
  // 🔥 LA SOLUCIÓN: Leemos el puntaje congelado de la pantalla, no la variable del juego que ya se reseteó
  const finalScoreText = document.getElementById('final-score-display').innerText;
  const finalScoreToSend = parseInt(finalScoreText) || 0;
  
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = 'TRANSMITIENDO...';
  }
  
  try {
    await fetch(FIREBASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Enviamos el finalScoreToSend en lugar de la variable score
      body: JSON.stringify({ name: name, score: finalScoreToSend }) 
    });
    
    await updateLeaderboardUI(); 
    if (nameInput) nameInput.value = ''; 
    playSound('levelup');
    
  } catch (error) {
    console.error("Error al guardar:", error);
    showSystemToast('Error de conexión al guardar el puntaje', '#ff0000');
  }
  
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerText = 'GUARDAR PUNTAJE';
  }
});
function checkLevelUp() { 
  const expectedLevel = Math.floor(score / 500) + 1; 
  if(expectedLevel > currentLevel) { currentLevel = expectedLevel; document.getElementById('level-value').innerText = currentLevel; const anim = document.getElementById('level-up-anim'); anim.classList.remove('active'); void anim.offsetWidth; anim.classList.add('active'); playSound('levelup', ship.position); shakeIntensity = 0.6; hasShield = true; shieldMesh.visible = true; if (currentLevel === 2) { weaponLevel = 2; shipSpeed = 0.65; } else if (currentLevel >= 3) { weaponLevel = 3; shipSpeed = 0.8; } } 
}
const fighters = []; // Lista de naves menores
function spawnFighter() {
  if(!isCombatActive || isPaused || isUIOpen || isBossBattle) return;
  const fMat = new THREE.ShaderMaterial({ 
    uniforms: { color: { value: new THREE.Color(0xff0000) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } }, 
    vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true 
  });
  const obj = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2, 4), fMat);
  obj.rotation.x = Math.PI; // Apunta hacia abajo
  obj.position.set((Math.random()-0.5)*30, 40, 0);
  // HP: 3 Vidas. Hace un ZigZag con 'phase'
  obj.userData = { hp: 3, speedY: 0.05 + (currentLevel * 0.015), baseX: obj.position.x, phase: Math.random() * Math.PI * 2 };
  scene.add(obj); fighters.push(obj);
}

// Sobrescribimos spawnAsteroid para que llame ocasionalmente a los cazas
const originalSpawnAsteroid = spawnAsteroid;
spawnAsteroid = function() {
  originalSpawnAsteroid();
  if (Math.random() > 0.85) spawnFighter(); // 15% de probabilidad de que salga una nave
};
const asteroids = []; const explosionParticles = [];
function spawnAsteroid() { 
  // 1. Quitamos "isBossBattle" de aquí para que el sistema siga funcionando durante el jefe
  if(isPaused || isUIOpen || renderer.xr.isPresenting || !isCombatActive) return; 
  
  let isBounty = Math.random() > 0.85; 
  
  // 2. NUEVA LÓGICA DEL JEFE: Salen pocos, pero si salen, TODOS son botines azules
  if (isBossBattle) {
    if (Math.random() > 0.15) return; // 85% de las veces aborta para dejar la pantalla limpia
    isBounty = true; // Si pasa el filtro, 100% es azul
  }

  const size = Math.random() * 1.2 + 0.5; 
  const astColor = isBounty ? 0x00ffff : 0x444444; 
  
  const astMat = new THREE.ShaderMaterial({ 
    uniforms: { color: { value: new THREE.Color(astColor) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } }, 
    vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true 
  });
  
  const obj = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), astMat); 
  const baseSpeed = 0.03 + (currentLevel * 0.02); 
  
  // 3. Sorteamos qué premio dará (Escudo, Vida o Puntos)
  const possibleRewards = ['shield', 'life', 'points'];
  
  obj.userData = { 
    speedY: baseSpeed + (Math.random() * 0.08), 
    rotX: Math.random()*0.05, 
    rotY: Math.random()*0.05,
    radius: size,
    isBounty: isBounty,
    rewardType: possibleRewards[Math.floor(Math.random() * possibleRewards.length)] // 🔥 Asignamos el premio
  }; 
  
  obj.position.set((Math.random()-0.5)*40, 35, 0); 
  scene.add(obj); asteroids.push(obj); 
}

function createExplosion(x, y, z) { for(let i=0; i<8; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.3,0.3), new THREE.MeshBasicMaterial({color: 0xaaaaaa})); p.position.set(x,y,z); p.userData = { vx: (Math.random()-0.5)*0.8, vy: (Math.random()-0.5)*0.8, vz: (Math.random()-0.5)*0.8, life: 1.0 }; scene.add(p); explosionParticles.push(p); } }

function triggerScrollExploration() { 
  document.getElementById('scroll-hint')?.classList.add('hidden');
  if (!isGameStarted || isPaused || isUIOpen || renderer.xr.isPresenting || isBossBattle) return; 
  scrollSpeedBoost += 0.8; if (scrollSpeedBoost > 2.5) scrollSpeedBoost = 2.5; 
  const now = Date.now(); 
  if (now - lastSpawnTime > 400) { 
    lastSpawnTime = now; spawnAsteroid(); if(Math.random() > 0.5) spawnAsteroid(); 
    const rand = Math.random();
    
    if (rand > 0.9 && voyagerModelTemplate) { 
      const voyager = voyagerModelTemplate.clone(); voyager.position.set((Math.random() - 0.5) * 35, 40, (Math.random() - 0.5) * 20); voyager.rotation.x = Math.PI;
voyager.userData = { 
  id: 77, 
  title: { es: 'LOG_V0Y // SONDA', en: 'LOG_V0Y // PROBE' }, 
  desc: { es: 'El Proyecto Spuntik fue dado de baja hace décadas.', en: 'The Voyager Project was decommissioned decades ago.' }, 
  longDesc: { es: 'Sus fragmentos de código siguen vagando por el vacío. Aunque su misión original fue cancelada, aún transmite un eco débil a través de los puertos de red cerrados.', en: 'Its code fragments still wander the void. Although its original mission was canceled, it still transmits a weak echo through closed network ports.' }, 
  mediaType: 'image', 
  mediaSrc: '', 
  link: '', 
  isVoyager: true 
};       scene.add(voyager); discoveredVoyagers.push(voyager); 
    } else if (rand > 0.8 && whaleModelTemplate) { 
      const whale = whaleModelTemplate.clone(); whale.position.set((Math.random() - 0.5) * 40, 40, (Math.random() - 0.5) * 40 - 10); whale.userData = { speedY: 0.04 + (Math.random()*0.05) }; scene.add(whale); ambientWhales.push(whale);
    } else if (rand > 0.65 && gamberModelTemplate && chaplinModelTemplate) { 
      const baseX = (Math.random() - 0.5) * 30;
      const baseY = 40;
      const baseZ = (Math.random() - 0.5) * 20 - 5;
      const speedY = 0.06 + (Math.random()*0.05);

      const gamber = gamberModelTemplate.clone();
      gamber.position.set(baseX - 3, baseY, baseZ); 
      gamber.userData = { 
        speedY: speedY, rotY: (Math.random()-0.5)*0.03, isCat: true,
catData: { 
  id: 888, 
  title: { es: 'SYS_GAMBER // GUARDIÁN ALFA', en: 'SYS_GAMBER // ALPHA GUARDIAN' }, 
  desc: { es: 'Anomalía pacífica. Un rastro de afecto anclado en el código base.', en: 'Peaceful anomaly. A trace of affection anchored in the codebase.' }, 
  longDesc: { es: 'Esta subrutina patrulla los sectores principales buscando vulnerabilidades. Se dice que fue programada por el Creador para mantener a raya a los gusanos de memoria.', en: 'This subroutine patrols main sectors looking for vulnerabilities. It is said the Creator programmed it to keep memory worms at bay.' }, 
  mediaType: 'image', 
  mediaSrc: './img/gamber.png', 
  link: '' 
}      };
      scene.add(gamber); guardianCats.push(gamber);

      const chaplin = chaplinModelTemplate.clone();
      chaplin.position.set(baseX + 3, baseY + 1, baseZ - 1); 
      chaplin.userData = { 
        speedY: speedY * 1.05, rotY: (Math.random()-0.5)*0.03, isCat: true, 
catData: { 
  id: 889, 
  title: { es: 'SYS_CHAPLIN // GUARDIÁN BETA', en: 'SYS_CHAPLIN // BETA GUARDIAN' }, 
  desc: { es: 'Anomalía sigilosa. Se mueve entre los nodos de memoria olvidados.', en: 'Stealth anomaly. It moves between forgotten memory nodes.' }, 
  longDesc: { es: 'Su presencia estabiliza las caídas de framerate en las zonas más oscuras del servidor. Funciona en simbiosis con el Guardián Alfa.', en: 'Its presence stabilizes framerate drops in the darkest areas of the server. It works in symbiosis with the Alpha Guardian.' }, 
  mediaType: 'image', 
  mediaSrc: './img/chaplin.jpg', 
  link: '' 
}      };
      scene.add(chaplin); guardianCats.push(chaplin);

    } else if (rand > 0.4) { 
      const keywordList = ['SYS_ERROR', 'BUFFER_OVERFLOW', 'DATA_LINK', 'NULL_POINTER'];
      const kw = keywordList[Math.floor(Math.random() * keywordList.length)]; const sprite = createTextSprite(kw); sprite.position.set((Math.random() - 0.5) * 30, 40, (Math.random() - 0.5) * 20 - 5); scene.add(sprite); scrollKeywords.push(sprite); 
    }
  } 
}

window.addEventListener('wheel', (e) => { if (e.deltaY !== 0) triggerScrollExploration(); });

// 🔥 ELIMINAMOS LA DUPLICACIÓN DE VARIABLES QUE ROMPÍA LA PÁGINA
let mouseX = 0; let mouseY = 0; let mouseNDC = new THREE.Vector2(-2, -2); 
document.addEventListener('mousemove', (e) => { 
  mouseX = (e.clientX - (window.innerWidth/2)); 
  mouseY = (e.clientY - (window.innerHeight/2)); 
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1; 
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1; 
});
// 🔥 FUNCIÓN PARA GUARDAR LA CONSTELACIÓN EN EL DISCO DURO
function saveConstellationData() {
  const positions = {};
  categoryPlanets.forEach(p => {
    if (p.userData.id !== 999 && p.userData.randomPos) {
      positions[p.userData.id] = {
        x: p.userData.randomPos.x,
        y: p.userData.baseY !== undefined ? p.userData.baseY : p.userData.randomPos.y,
        z: p.userData.randomPos.z
      };
    }
  });
  localStorage.setItem('gamelab_constellation', JSON.stringify(positions));
  if (window.trackEvent) trackEvent('Interacción', 'Constelación_Guardada');
}

// 🔥 CONTROL DE MOUSE Y TOUCH - DRAG & DROP PURO COMO EN PROCESSING
let touchStartY = 0; let touchStartX = 0; 
let lastTouchX = 0; let lastTouchY = 0; 
let touchStartTime = 0; let lastTapTime = 0; 
let isMobileZoomed = false; 
window.isDraggingCanvas = false;

let targetCarouselAngle = 0; 
let draggedPlanet = null;
let isDraggingPlanet = false; 
window.justDropped = false;

const dragPlane = new THREE.Plane();
const dragIntersection = new THREE.Vector3();
const dragOffset = new THREE.Vector3();
const dragRaycaster = new THREE.Raycaster();

// ===============================================
// 🔥 INTERFAZ DE PINTURA Y CONTENEDOR
// ===============================================
const paintTools = document.createElement('div');
paintTools.id = 'paint-tools';
paintTools.style.cssText = "display:none; position:fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 100000; gap: 10px; pointer-events: auto;";
paintTools.innerHTML = `
  <button id="btn-clear-paint" style="background: rgba(10,10,10,0.9); color: #ff0055; border: 1px solid #ff0055; padding: 8px 15px; font-family: 'Share Tech Mono', monospace; cursor: pointer; text-transform: uppercase; font-size: 0.9rem; box-shadow: 0 0 10px rgba(255,0,85,0.3); transition: 0.3s;">[ DISOLVER MATERIA]</button>
  <button id="btn-save-paint" style="background: rgba(10,10,10,0.9); color: #00ffaa; border: 1px solid #00ffaa; padding: 8px 15px; font-family: 'Share Tech Mono', monospace; cursor: pointer; text-transform: uppercase; font-size: 0.9rem; box-shadow: 0 0 10px rgba(0,255,170,0.3); transition: 0.3s;">[ EXPORTAR ]</button>
`;
document.body.appendChild(paintTools);

const paintGroup = new THREE.Group();
scene.add(paintGroup);
const paintStrokes = [];

// 🔥 NUEVO: Matriz de líneas dinámicas para el efecto "Linked Particles"
const poeticaLinesGeo = new THREE.BufferGeometry();
const maxPoeticaLines = 6000; // Hasta 6000 conexiones vivas
const poeticaLinePositions = new Float32Array(maxPoeticaLines * 6);
poeticaLinesGeo.setAttribute('position', new THREE.BufferAttribute(poeticaLinePositions, 3));
const poeticaLinesMat = new THREE.LineBasicMaterial({ 
  color: 0xffffff, // Líneas Cyan eléctrico
  transparent: true, 
  opacity: 0.4, 
  blending: THREE.AdditiveBlending,
  depthWrite: false
});
const poeticaLinesMesh = new THREE.LineSegments(poeticaLinesGeo, poeticaLinesMat);
scene.add(poeticaLinesMesh);
// 🔥 NUEVO: Matriz de líneas para el efecto "Cristales Rotos / Relámpago" (ERRÁTICA)
const erraticaLinesGeo = new THREE.BufferGeometry();
const maxErraticaLines = 3000; // Relámpagos rojos
const erraticaLinePositions = new Float32Array(maxErraticaLines * 6);
erraticaLinesGeo.setAttribute('position', new THREE.BufferAttribute(erraticaLinePositions, 3));
const erraticaLinesMat = new THREE.LineBasicMaterial({ 
  color: 0xff0000, // Rojo Sangre / Error
  transparent: true, 
  opacity: 0.9, 
  blending: THREE.AdditiveBlending, // Brillo de relámpago
  depthWrite: false
});
const erraticaLinesMesh = new THREE.LineSegments(erraticaLinesGeo, erraticaLinesMat);
scene.add(erraticaLinesMesh);
document.getElementById('btn-clear-paint').onclick = (e) => {
  e.stopPropagation();
  paintStrokes.forEach(p => { paintGroup.remove(p); p.geometry.dispose(); p.material.dispose(); });
  paintStrokes.length = 0; 
 playSound('disolver');
};

document.getElementById('btn-save-paint').onclick = (e) => {
  e.stopPropagation();
  renderer.render(scene, camera);
  try {
    const link = document.createElement('a');
    link.download = 'dac_creacion.png';
    link.href = document.querySelector('#bg-canvas').toDataURL('image/png');
    link.click(); 
    playSound('levelup');
  } catch(err) { console.log(err); }
};

function startPointerDown(clientX, clientY) {
  // 🔥 Si hay una luna encendida, pasamos a MODO PINTURA PERMANENTE
  if (isPoeticaActive || isErraticaActive || isFriccionActive) {
    window.isPainting = true;
    document.getElementById('paint-tools').style.display = 'flex';
    return; 
  }

  window.isDraggingCanvas = false; 
  isDraggingPlanet = false; 
  const onboard = document.getElementById('onboarding-ui');
  if (onboard && !onboard.classList.contains('hidden')) onboard.classList.add('hidden');

  touchStartX = clientX; touchStartY = clientY; 
  lastTouchX = clientX; lastTouchY = clientY;
  
  if (!isGameStarted || isUIOpen || isBossBattle) return; 

  mouseNDC.x = (clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;
  dragRaycaster.setFromCamera(mouseNDC, camera);
  
  // Agregamos window.travelerGroup a los objetos agarrables
const grabTargets = [...categoryPlanets, ...ambientWhales, ...guardianCats, ...discoveredVoyagers, window.travelerGroup];
  const intersects = dragRaycaster.intersectObjects(grabTargets, true);
  
  if (intersects.length > 0) {
    let hit = intersects[0].object;
    while (hit && hit.parent && hit.parent.type !== 'Scene' && !grabTargets.includes(hit)) { hit = hit.parent; }
    if (hit && grabTargets.includes(hit)) {
      if (!(hit.userData.id === 999 && typeof secretDiscovered !== 'undefined' && !secretDiscovered)) {
        draggedPlanet = hit;
        
        if (navigator.vibrate) vibrateDevice(50);
      }
    }
  }
}

function handlePointerMove(clientX, clientY) {
  // 🔥 Si estamos pintando, solo actualizamos el cursor, NO giramos la cámara
  if (window.isPainting) {
    mouseNDC.x = (clientX / window.innerWidth) * 2 - 1;
    mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    lastTouchX = clientX; lastTouchY = clientY;
    return;
  }

  if (draggedPlanet) {
    const deltaX = Math.abs(clientX - touchStartX); const deltaY = Math.abs(clientY - touchStartY);
    if (deltaX > 3 || deltaY > 3) isDraggingPlanet = true;

    if (isDraggingPlanet) {
      const pixelDeltaY = clientY - lastTouchY;
      const pixelDeltaX = clientX - lastTouchX;
      
      // 🔥 LA CURA DEL ALEJAMIENTO: Traducimos el movimiento 2D de tu pantalla a la orientación 3D actual de la cámara
      const moveVector = new THREE.Vector3(pixelDeltaX * 0.05, -pixelDeltaY * 0.05, 0);
      moveVector.applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
      
      draggedPlanet.position.add(moveVector);
      draggedPlanet.userData.baseY = draggedPlanet.position.y;
      
      if (draggedPlanet.userData.randomPos) {
        draggedPlanet.userData.randomPos.copy(draggedPlanet.position);
      }
    }
  } 
  else {
    const deltaX = Math.abs(clientX - touchStartX); const deltaY = Math.abs(clientY - touchStartY);
    if (deltaX > 5 || deltaY > 5) window.isDraggingCanvas = true;

    if (window.isDraggingCanvas) {
      const dragResistance = isFriccionActive ? 0.0005 : 0.005; 
      if (isAligned) { 
        targetCarouselAngle += (clientX - lastTouchX) * dragResistance; 
      } else { 
        userGroup.rotation.y -= (clientX - lastTouchX) * dragResistance; 
        userGroup.rotation.x -= (clientY - lastTouchY) * dragResistance; 
        if(userGroup.rotation.x > 0.6) userGroup.rotation.x = 0.6; 
        if(userGroup.rotation.x < -0.6) userGroup.rotation.x = -0.6; 
      }
    }
  }
  lastTouchX = clientX; lastTouchY = clientY;
}

function handlePointerUp() {
  window.isPainting = false;
  if (draggedPlanet) {
    if (isDraggingPlanet) {
      playSound('ui'); window.justDropped = true; 
      
      // ===============================================
      // 🔥 NUEVO: LÓGICA DE ATERRIZAJE DEL VIAJERO
      // ===============================================
      if (draggedPlanet === window.travelerGroup) {
        let snapped = false;
        let closestPlanet = null;
        let minDistance = 35.0; // Radio magnético de atracción
        
        // Buscar el planeta más cercano
        categoryPlanets.forEach(p => {
          if(p.userData.id === 999) return; 
          const dist = window.travelerGroup.position.distanceTo(p.position);
          if (dist < minDistance) {
            minDistance = dist;
            closestPlanet = p;
          }
        });

      if (closestPlanet) {
          // 1. Lo anclamos magnéticamente al planeta
      window.startTravelerFall(closestPlanet);
          snapped = true;
          
          playSound('project_open');
          
          // 2. Diccionario de conocimiento del Oráculo (Tus líneas de investigación)
          const pId = closestPlanet.userData.id;
          const pTitle = typeof closestPlanet.userData.title === 'object' ? closestPlanet.userData.title[window.currentLang||'es'] : closestPlanet.userData.title;
          
          let phrase = "";
          // Frases dinámicas basadas en tu perfil (Se adaptan si agregas más IDs)
          if (pId === 1 || pTitle.includes("GameLab")) {
            phrase = window.currentLang === 'en' 
              ? "GameLab Tadeo: Where code becomes culture and social transformation." 
              : "GameLab Tadeo: Donde el código se vuelve cultura y transformación social.";
          } else if (pId === 2 || pTitle.includes("Media")) {
            phrase = window.currentLang === 'en' 
              ? "Media archaeology. Preserving the memory of what was once cutting-edge." 
              : "Arqueología de los medios. Preservando la memoria de lo que alguna vez fue vanguardia.";
          } else if (pId === 3 || pTitle.includes("Semillas") || pTitle.includes("Juegos Otros")) {
            phrase = window.currentLang === 'en' 
              ? "Other Games. Seeding disobedience and exploring decolonial mechanics." 
              : "Juegos Otros. Sembrando desobediencia y explorando mecánicas decoloniales.";
          } else if (pId === 4 || pTitle.includes("Domo")) {
            phrase = window.currentLang === 'en' 
              ? "Expanding the narrative to the celestial vault. Full-dome interaction." 
              : "Expandiendo la narrativa a la bóveda celeste. Interacción Fulldome.";
          } else if (pId === 5 || pTitle.includes("Accesi")) {
            phrase = window.currentLang === 'en' 
              ? "Universal design. Play is a right, accessible to all." 
              : "Diseño universal y accesibilidad. El juego es un territorio para todos.";
          } else {
            // Frase por defecto adaptada al título del planeta
            phrase = window.currentLang === 'en' 
              ? `Exploring the margins of [ ${pTitle} ].` 
              : `Explorando los márgenes de [ ${pTitle} ].`;
          }

          showPoeticReflection(phrase, "#00ffcc");
          
          // 3. Animación de "Conquista" (Levanta la espada)
          if (window.travelerSword && window.travelerSwordMat) {
            window.travelerSword.rotation.z = Math.PI / 4; 
            window.travelerSwordMat.color.setHex(0x00ffff); 
            window.travelerSwordMat.color.multiplyScalar(2.0);
            setTimeout(() => {
              window.travelerSword.rotation.z = Math.PI / -6;
              window.travelerSwordMat.color.setHex(0xffffff);
            }, 4000);
          }
        }
        
        // Si lo sueltas en el espacio profundo, se desvincula
        if (!snapped) {
          window.travelerGroup.userData.anchoredPlanet = null;
          window.travelerGroup.userData.baseY = window.travelerGroup.position.y;
          window.travelerGroup.userData.baseX = window.travelerGroup.position.x;
        }
      }
      // ===============================================
      // LÓGICA DE GUARDADO PARA LOS DEMÁS PLANETAS
      // ===============================================
      else if (!isAligned && draggedPlanet.userData.id !== undefined && draggedPlanet.userData.id !== 999) {
        if (!draggedPlanet.userData.randomPos) draggedPlanet.userData.randomPos = new THREE.Vector3();
        if (!draggedPlanet.userData.targetPos) draggedPlanet.userData.targetPos = new THREE.Vector3();
        
        let pIndex = categoryPlanets.indexOf(draggedPlanet);
        let sinOffset = (pIndex !== -1) ? Math.sin((Date.now()*0.001) + pIndex) * 0.5 : 0;
        
        draggedPlanet.userData.baseY = draggedPlanet.position.y - sinOffset;
        draggedPlanet.userData.randomPos.copy(draggedPlanet.position);
        draggedPlanet.userData.randomPos.y = draggedPlanet.userData.baseY;
        draggedPlanet.userData.targetPos.copy(draggedPlanet.userData.randomPos);
        
        saveConstellationData();
      }
      
      setTimeout(() => window.justDropped = false, 150);
    }
    draggedPlanet = null; isDraggingPlanet = false;
  }
  window.isDraggingCanvas = false;
}

// Escuchas de eventos
window.addEventListener('mousedown', (e) => { startPointerDown(e.clientX, e.clientY); });
window.addEventListener('mousemove', (e) => { if(e.buttons === 1) handlePointerMove(e.clientX, e.clientY); });
window.addEventListener('mouseup', handlePointerUp);

document.addEventListener('touchstart', (e) => { 
  if(e.touches.length > 0) { 
    startPointerDown(e.touches[0].clientX, e.touches[0].clientY);
    touchStartTime = Date.now();
    const currentTime = Date.now();
    const tapLength = currentTime - lastTapTime;
    if (tapLength < 300 && tapLength > 0 && !isUIOpen && !isBossBattle && !isAligned && !isDraggingPlanet) {
      isMobileZoomed = !isMobileZoomed;
      targetFov = isMobileZoomed ? 35 : 75; 
      playSound('ui');
    }
    lastTapTime = currentTime;
  } 
}, {passive: false}); // 🔥 FIX: passive:false permite preventDefault para el drag

document.addEventListener('touchmove', (e) => { 
  if(e.touches.length > 0) { 
    // 🔥 FIX: Bloqueamos el scroll nativo del browser solo cuando hay un planeta agarrado
    if (draggedPlanet) e.preventDefault();
    handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
    let touchY = e.touches[0].clientY;
    if (!draggedPlanet && (touchStartY - touchY > 40 || touchStartY - touchY < -40)) { 
      triggerScrollExploration(); touchStartY = touchY; 
    } 
  } 
}, {passive: false}); // 🔥 FIX: passive:false es necesario para poder llamar preventDefault

// 🔥 FIX Bug 3: touchcancel restaura la escala si el sistema operativo interrumpe el drag
document.addEventListener('touchcancel', () => {
  if (draggedPlanet) {
    if (draggedPlanet.userData._dragOriginalScale) {
      draggedPlanet.scale.copy(draggedPlanet.userData._dragOriginalScale);
      delete draggedPlanet.userData._dragOriginalScale;
    }
    draggedPlanet = null;
    isDraggingPlanet = false;
  }
  window.isDraggingCanvas = false;
});

document.addEventListener('touchend', (e) => {
  handlePointerUp();
  if (isAligned && e.changedTouches.length > 0 && !draggedPlanet && !isDraggingPlanet) {
    const touchEndX = e.changedTouches[0].clientX;
    const deltaX = touchEndX - touchStartX;
    const deltaTime = Date.now() - touchStartTime;
    
    // 🔥 CORRECCIÓN: Contamos 9 planetas reales para que el giro en móvil sea perfecto
    let activeCount = (typeof secretDiscovered !== 'undefined' && secretDiscovered) ? categoryPlanets.length : (categoryPlanets.length - 1);
    const angleStep = (Math.PI * 2) / activeCount;

    if (deltaTime < 300 && Math.abs(deltaX) > 40) {
      if (deltaX > 0) targetCarouselAngle += angleStep; 
      else targetCarouselAngle -= angleStep; 
    } 
    targetCarouselAngle = Math.round(targetCarouselAngle / angleStep) * angleStep;
  }
});

function openProjectPopup(data) {
  if (data.id) updateProgress(data.id);  
  openUIWindow('portfolio-ui');
  
  const getText = (prop) => (typeof prop === 'object' && prop !== null && !Array.isArray(prop)) ? (prop[window.currentLang] || prop.es) : prop;
  const getArray = (prop) => (typeof prop === 'object' && prop !== null && !Array.isArray(prop)) ? (prop[window.currentLang] || prop.es) : prop;

  const currentTitle = getText(data.title);
  const currentDesc = getText(data.desc);
  const currentLongDesc = getText(data.longDesc);
  const currentRole = getText(data.role);
  const currentTech = getArray(data.tech);
  const isEn = window.currentLang === 'en';

  if (window.trackEvent) window.trackEvent('Ver_Proyecto', currentTitle);

  if (!data.isVoyager && !data.isCat && data.id !== 99) {
    const planetMesh = categoryPlanets.find(p => p.userData.id === data.id);
    if (planetMesh && !planetMesh.userData.visited) {
      planetMesh.userData.visited = true;
      
      if (planetMesh.material.uniforms && planetMesh.material.uniforms.color) {
        planetMesh.material.uniforms.color.value.setHex(0x555555);
      } else if (planetMesh.material.color) {
        planetMesh.material.color.setHex(0x555555); 
      }
      
      planetMesh.material.opacity = 0.2;
      
      if (planetMesh.children.length > 0) {
        planetMesh.remove(planetMesh.children[0]);
        const viewedText = isEn ? ' [ VIEWED ]' : ' [ VISTO ]';
        const newLabel = createTextSprite(`> ${data.id}. ${currentTitle}${viewedText}`, '#555555');
        newLabel.position.set(0, 5, 0);
        planetMesh.add(newLabel);
      }
    }
  }

 // 🔥 CORRECCIÓN: Cálculo exacto del ángulo del carrusel para encuadrar la cámara
  if (isAligned) {
    const planetMesh = categoryPlanets.find(p => p.userData.id === data.id);
    if (planetMesh) {
      const pIndex = categoryPlanets.indexOf(planetMesh);
      let activeCount = (typeof secretDiscovered !== 'undefined' && secretDiscovered) ? categoryPlanets.length : (categoryPlanets.length - 1);
      if (pIndex !== -1) targetCarouselAngle = (Math.PI / 2) - ((pIndex / activeCount) * Math.PI * 2);
    }
  }
  
  document.getElementById('project-title').innerText = currentTitle; 
  
  const descEl = document.getElementById('project-desc');
  descEl.innerHTML = ''; 
  if(window.typewriterTimer) clearInterval(window.typewriterTimer); 
  
  const textToType = currentDesc;
  let charIndex = 0;
  
 const finishTyping = () => {
        if (window.typewriterTimer) {
          clearInterval(window.typewriterTimer);
          window.typewriterTimer = null;
          descEl.innerHTML = textToType; // Quitamos el guion bajo titilante
          document.removeEventListener('keydown', skipHandler);
          document.getElementById('portfolio-ui').removeEventListener('click', skipHandler);
        }
      };

      const skipHandler = (e) => { if (e.type === 'keydown' && e.code !== 'Space') return; finishTyping(); };
      document.addEventListener('keydown', skipHandler);
      document.getElementById('portfolio-ui').addEventListener('click', skipHandler);

      // Fade-in tipográfico mucho más suave
      window.typewriterTimer = setInterval(() => {
        descEl.innerHTML = textToType.substring(0, charIndex) + '<span style="opacity: 0.3; font-weight: 100;">|</span>';
        charIndex++;
        if (charIndex > textToType.length) finishTyping();
      }, 12); // Más rápido y fluido
      
      const longDescEl = document.getElementById('project-long-desc'); 
      const expandBtn = document.getElementById('project-expand-btn'); 
      const linkBtn = document.getElementById('project-link'); 
      const mediaContainer = document.getElementById('project-media'); 
      
      const roleEl = document.getElementById('project-role');
      if (currentRole) {
        roleEl.style.display = 'block';
        roleEl.innerText = currentRole.toUpperCase(); // Elegante, sin el "> ROL:"
      } else {
        roleEl.style.display = 'none';
      }

      const techEl = document.getElementById('project-tech-stack');
      techEl.innerHTML = '';
      if (currentTech && currentTech.length > 0) {
        techEl.style.display = 'flex';
        currentTech.forEach(tech => {
          const badge = document.createElement('span');
          badge.innerText = tech; // Limpio, sin los corchetes [ ]
          badge.style.padding = '6px 14px';
          badge.style.background = 'rgba(255,255,255,0.03)';
          badge.style.border = `1px solid rgba(255,255,255,0.1)`;
          badge.style.color = '#cccccc';
          badge.style.fontSize = '0.75rem';
          badge.style.fontFamily = "-apple-system, sans-serif";
          badge.style.borderRadius = '20px'; // Diseño de píldora
          badge.style.letterSpacing = '1px';
          techEl.appendChild(badge);
        });
      } else {
        techEl.style.display = 'none';
      }
      
      document.getElementById('project-title').style.color = '#ffffff';

      let finalGallery = data.gallery || [];
      let finalVideos = data.videos || [];
      if (data.videoSrc && finalVideos.length === 0) finalVideos = [data.videoSrc]; 
      
      let contenidoExpandido = "";
      if (currentLongDesc && currentLongDesc !== "") {
        contenidoExpandido += `<div style="text-align: left; padding-bottom: 15px;">${currentLongDesc}</div>`;
      }

      const renderVideoElement = (src) => {
        if (src.includes('.mp4') || src.includes('.webm')) {
          const noVideoStr = isEn ? 'Your browser does not support HTML5 video.' : 'Tu navegador no soporta videos HTML5.';
          return `<video width="100%" height="100%" controls style="border: none; border-radius: 8px; background: #000; object-fit: contain;">
              <source src="${src}" type="video/mp4">${noVideoStr}</video>`;
        } else {
          return `<iframe width="100%" height="100%" src="${src}" allowfullscreen style="border: none; border-radius: 8px; background: #000;"></iframe>`;
        }
      };
      
      if (finalVideos.length > 0) {
        const vidTitle = isEn ? 'VIDEOGRAPHIC RECORD' : 'REGISTRO VIDEOGRÁFICO';
        // Línea separadora sutil, nada de bordes punteados de neón
        contenidoExpandido += `<h3 style="color: #ffffff; font-weight: 300; font-family: -apple-system, sans-serif; font-size: 0.9rem; letter-spacing: 2px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-top: 20px; text-align: left;">${vidTitle}</h3>`;
        
        if (finalVideos.length === 1) {
          contenidoExpandido += `<div style="width: 100%; aspect-ratio: 16/9; margin-bottom: 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); overflow: hidden;">${renderVideoElement(finalVideos[0])}</div>`;
        } else {
          // Botones de video circulares de cristal transparente
          contenidoExpandido += `
            <div style="position: relative; width: 100%; aspect-ratio: 16/9; margin-bottom: 5px; background: rgba(0,0,0,0.3); border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; overflow: hidden;">
              <button id="btn-prev-vid" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); z-index: 10; background: rgba(0,0,0,0.5); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; backdrop-filter: blur(5px);">&lt;</button>
              <div id="video-content-wrapper" style="width: 100%; height: 100%; z-index: 5;">${renderVideoElement(finalVideos[0])}</div>
              <button id="btn-next-vid" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 10; background: rgba(0,0,0,0.5); color: #fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; backdrop-filter: blur(5px);">&gt;</button>
            </div>
            <div id="video-counter" style="color: #888899; font-size: 0.75rem; text-align: center; margin-bottom: 15px; letter-spacing: 1px;">Video 1</div>
          `;
        }
      }
      
      longDescEl.innerHTML = contenidoExpandido;

  if (finalVideos.length > 1) {
    window.currentVideoIndex = 0;
    window.videoList = finalVideos;
    const videoWrapper = document.getElementById('video-content-wrapper');
    const counter = document.getElementById('video-counter');

    document.getElementById('btn-prev-vid').onclick = () => {
      window.currentVideoIndex--;
      if(window.currentVideoIndex < 0) window.currentVideoIndex = window.videoList.length - 1;
      videoWrapper.innerHTML = renderVideoElement(window.videoList[window.currentVideoIndex]);
      counter.innerText = isEn ? `Video ${window.currentVideoIndex + 1} of ${window.videoList.length}` : `Video ${window.currentVideoIndex + 1} de ${window.videoList.length}`;
      playSound('ui'); 
    };

    document.getElementById('btn-next-vid').onclick = () => {
      window.currentVideoIndex++;
      if(window.currentVideoIndex >= window.videoList.length) window.currentVideoIndex = 0;
      videoWrapper.innerHTML = renderVideoElement(window.videoList[window.currentVideoIndex]);
      counter.innerText = isEn ? `Video ${window.currentVideoIndex + 1} of ${window.videoList.length}` : `Video ${window.currentVideoIndex + 1} de ${window.videoList.length}`;
      playSound('ui');
    };
  }

  if (data.link && data.link !== '') { 
    linkBtn.style.display = 'block'; 
    linkBtn.href = data.link; 
    
    const url = data.link.toLowerCase();
    if (url.includes('github.com')) { linkBtn.innerText = isEn ? 'VIEW GITHUB REPO ↗' : 'VER REPOSITORIO GITHUB ↗'; } 
    else if (url.includes('.pdf')) { linkBtn.innerText = isEn ? 'DOWNLOAD FILE (PDF) ⬇' : 'DESCARGAR ARCHIVO (PDF) ⬇'; } 
    else if (url.includes('instagram.com')) { linkBtn.innerText = isEn ? 'VIEW ON INSTAGRAM ↗' : 'VER EN INSTAGRAM ↗'; } 
    else if (url.includes('youtube.com') || url.includes('youtu.be')) { linkBtn.innerText = isEn ? 'VIEW EXTERNAL VIDEO ↗' : 'VER VIDEO EXTERNO ↗'; } 
    else { linkBtn.innerText = isEn ? 'VIEW EXTERNAL LINK ↗' : 'VER ENLACE EXTERNO ↗'; }
  } else { linkBtn.style.display = 'none'; }

mediaContainer.innerHTML = finalGallery.length === 0 ? '' : `<img id="gallery-img" src="${finalGallery[0]}" loading="lazy" style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in;">`;  if (finalGallery.length > 0) {
    mediaContainer.style.display = 'flex';
    
    const toggleFullscreen = (e) => {
      const isFullscreen = document.fullscreenElement || document.webkitFullscreenElement;
      if (!isFullscreen) {
        if(e.target.requestFullscreen) { e.target.requestFullscreen(); }
        else if(e.target.webkitRequestFullscreen) { e.target.webkitRequestFullscreen(); } 
      } else {
       if(document.exitFullscreen) { document.exitFullscreen(); }
        else if(document.webkitExitFullscreen) { document.webkitExitFullscreen(); }
      }
    };

    const tooltipStr = isEn ? 'Click for fullscreen' : 'Clic para pantalla completa';
    if (finalGallery.length === 1) {
      mediaContainer.innerHTML = finalGallery.length === 0 ? '' : `<img id="gallery-img" src="${finalGallery[0]}" style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in;" title="${tooltipStr}">`;
      document.getElementById('gallery-img').onclick = toggleFullscreen;
    } else {
      window.currentGallery = finalGallery; 
      window.currentGalleryIndex = 0; 
   mediaContainer.innerHTML = `
        <button class="carousel-btn left" id="btn-prev" style="position:absolute; left:15px; z-index:10; background:rgba(0,0,0,0.5); color:#fff; border:1px solid rgba(255,255,255,0.2); border-radius:50%; width:40px; height:40px; display:flex; align-items:center; justify-content:center; cursor:pointer; backdrop-filter:blur(5px); transition:0.3s;">&#10094;</button>
        <img id="gallery-img" src="${window.currentGallery[0]}" style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in;" title="${tooltipStr}">
        <button class="carousel-btn right" id="btn-next" style="position:absolute; right:15px; z-index:10; background:rgba(0,0,0,0.5); color:#fff; border:1px solid rgba(255,255,255,0.2); border-radius:50%; width:40px; height:40px; display:flex; align-items:center; justify-content:center; cursor:pointer; backdrop-filter:blur(5px); transition:0.3s;">&#10095;</button>
      `;
      document.getElementById('btn-prev').onclick = () => { window.currentGalleryIndex--; if(window.currentGalleryIndex<0) window.currentGalleryIndex = window.currentGallery.length-1; document.getElementById('gallery-img').src = window.currentGallery[window.currentGalleryIndex]; }; 
      document.getElementById('btn-next').onclick = () => { window.currentGalleryIndex++; if(window.currentGalleryIndex>=window.currentGallery.length) window.currentGalleryIndex = 0; document.getElementById('gallery-img').src = window.currentGallery[window.currentGalleryIndex]; }; 
      document.getElementById('gallery-img').onclick = toggleFullscreen;
    }
  } else {
    mediaContainer.style.display = 'none';
  }

  if (contenidoExpandido !== "") {
    expandBtn.style.display = 'block';
    expandBtn.innerText = isEn ? 'EXPAND INFO ↓' : 'EXPANDIR INFO ↓'; 
    expandBtn.onclick = () => { 
      longDescEl.classList.toggle('hidden'); 
      document.getElementById('portfolio-ui').classList.toggle('expanded-modal'); 
      
      const isHidden = longDescEl.classList.contains('hidden');
      if (isEn) { expandBtn.innerText = isHidden ? 'EXPAND INFO ↓' : 'COLLAPSE INFO ↑'; } 
      else { expandBtn.innerText = isHidden ? 'EXPANDIR INFO ↓' : 'CONTRAER INFO ↑'; }
      playSound('ui'); 
    };
  } else {
    expandBtn.style.display = 'none';
  }

  const prevBtn = document.getElementById('btn-prev-project');
  const nextBtn = document.getElementById('btn-next-project');
  const navBar = document.getElementById('project-nav-bar');
  const currentProjectIndex = categoryPlanetData.findIndex(p => p.id === data.id);

  if (currentProjectIndex !== -1) {
    navBar.style.display = 'flex'; 
  prevBtn.onmouseover = () => prevBtn.style.color = '#ffffff';
    prevBtn.onmouseout = () => prevBtn.style.color = '#888';
    nextBtn.onmouseover = () => nextBtn.style.color = '#ffffff';
    nextBtn.onmouseout = () => nextBtn.style.color = '#888';

    prevBtn.onclick = () => { let prevIndex = currentProjectIndex - 1; if (prevIndex < 0) prevIndex = categoryPlanetData.length - 1; playSound('ui'); openProjectPopup(categoryPlanetData[prevIndex]); };
    nextBtn.onclick = () => { let nextIndex = currentProjectIndex + 1; if (nextIndex >= categoryPlanetData.length) nextIndex = 0; playSound('ui'); openProjectPopup(categoryPlanetData[nextIndex]); };

    let restoreBtn = document.getElementById('btn-restore-planet');
    if (!restoreBtn) {
      restoreBtn = document.createElement('button');
      restoreBtn.id = 'btn-restore-planet';
      restoreBtn.style = "background: transparent; border: none; color: #ffaa00; font-family: 'Share Tech Mono'; cursor: pointer; font-size: 0.9rem; transition: 0.3s; text-decoration: underline;";
      navBar.insertBefore(restoreBtn, nextBtn);
    }
    
    const pMesh = categoryPlanets.find(p => p.userData.id === data.id);
    restoreBtn.style.display = (pMesh && pMesh.userData.visited) ? 'block' : 'none';
    restoreBtn.innerText = isEn ? '↺ MARK AS UNREAD' : '↺ MARCAR COMO NO LEÍDO';

    restoreBtn.onclick = () => {
      if (pMesh) {
        pMesh.userData.visited = false;
        
        if (pMesh.material.uniforms && pMesh.material.uniforms.color) {
          pMesh.material.uniforms.color.value.setHex(data.color);
        } else if (pMesh.material.color) {
          pMesh.material.color.setHex(data.color); 
        }
        
        pMesh.material.opacity = 0.7;
        
        if (pMesh.children.length > 0) {
          pMesh.remove(pMesh.children[0]);
          const hexStr = '#' + data.color.toString(16).padStart(6, '0');
          const origLabel = createTextSprite(`> ${data.id}. ${currentTitle}`, hexStr);
          origLabel.position.set(0, 5, 0);
          pMesh.add(origLabel);
        }
        
        playSound('ui');
        restoreBtn.innerText = isEn ? '✔ RESTORED' : '✔ RESTAURADO';
        setTimeout(() => restoreBtn.style.display = 'none', 1000); 
      }
    };
  } else {
    navBar.style.display = 'none';
  }
}

const keys = { left: false, right: false }; const projectiles = []; const projectileGeo = new THREE.CapsuleGeometry(0.1, 0.8, 4, 8); 

function fireLaser() {
  if(!isGameStarted || isUIOpen || (renderer.xr.isPresenting && hitTestSourceRequested)) return; 
  hasShot = true; checkOnboarding(); playSound('laser', ship.position); 
  
  // 🔥 ARMAS DINÁMICAS MÁS ACCESIBLES
  let dynamicWeapon = 1;
  if (typeof combatCombo !== 'undefined') {
    if (combatCombo >= 10) dynamicWeapon = 3; // 🔥 Arma triple al Combo x10 (antes 15)
    else if (combatCombo >= 4) dynamicWeapon = 2; // 🔥 Arma doble al Combo x4 (antes 5)
  }

  const laserColor = dynamicWeapon === 1 ? 0xffff00 : (dynamicWeapon === 2 ? 0x00ffff : 0xff00ff);
  const pMat = new THREE.MeshBasicMaterial({ color: laserColor });
  
  if (dynamicWeapon === 1) { 
    const l = new THREE.Mesh(projectileGeo, pMat); l.position.set(ship.position.x, ship.position.y + 1.5, ship.position.z); l.userData = {vx: 0, vy: 0.8}; scene.add(l); projectiles.push(l); 
  } else if (dynamicWeapon === 2) { 
    const l1 = new THREE.Mesh(projectileGeo, pMat); l1.position.set(ship.position.x - 0.6, ship.position.y + 1.5, ship.position.z); l1.userData = {vx: 0, vy: 0.8}; const l2 = new THREE.Mesh(projectileGeo, pMat); l2.position.set(ship.position.x + 0.6, ship.position.y + 1.5, ship.position.z); l2.userData = {vx: 0, vy: 0.8}; scene.add(l1); scene.add(l2); projectiles.push(l1, l2); 
  } else { 
    const l1 = new THREE.Mesh(projectileGeo, pMat); l1.position.set(ship.position.x, ship.position.y + 1.5, ship.position.z); l1.userData = {vx: 0, vy: 0.8}; const l2 = new THREE.Mesh(projectileGeo, pMat); l2.position.set(ship.position.x - 0.5, ship.position.y + 1.5, ship.position.z); l2.userData = {vx: -0.15, vy: 0.8}; l2.rotation.z = 0.2; const l3 = new THREE.Mesh(projectileGeo, pMat); l3.position.set(ship.position.x + 0.5, ship.position.y + 1.5, ship.position.z); l3.userData = {vx: 0.15, vy: 0.8}; l3.rotation.z = -0.2; scene.add(l1); scene.add(l2); scene.add(l3); projectiles.push(l1, l2, l3); 
  }
}

let isShooting = false; let lastShotTime = 0; const FIRE_COOLDOWN = 200; 
const btnLeft = document.getElementById('btn-left'); const btnRight = document.getElementById('btn-right'); const btnShoot = document.getElementById('btn-shoot');
function bindBtn(btn, onDown, onUp) { if(!btn) return; btn.addEventListener('touchstart', e => { e.preventDefault(); onDown(); }, {passive: false}); btn.addEventListener('touchend', e => { e.preventDefault(); onUp(); }, {passive: false}); btn.addEventListener('mousedown', e => { e.preventDefault(); onDown(); }); btn.addEventListener('mouseup', e => { e.preventDefault(); onUp(); }); btn.addEventListener('mouseleave', e => { e.preventDefault(); onUp(); }); }
bindBtn(btnLeft, () => { keys.left = true; hasMoved = true; checkOnboarding(); }, () => { keys.left = false; }); 
bindBtn(btnRight, () => { keys.right = true; hasMoved = true; checkOnboarding(); }, () => { keys.right = false; }); 
bindBtn(btnShoot, () => { isShooting = true; }, () => { isShooting = false; });

document.addEventListener('keydown', (e) => { 
  if (isUIOpen) {
    if ((e.key === 'ArrowRight' || e.key === 'd') && document.getElementById('btn-next')) document.getElementById('btn-next').click();
    if ((e.key === 'ArrowLeft' || e.key === 'a') && document.getElementById('btn-prev')) document.getElementById('btn-prev').click();
    
    if ((e.key === 'ArrowRight' || e.key === 'd') && document.getElementById('btn-next-vid')) document.getElementById('btn-next-vid').click();
    if ((e.key === 'ArrowLeft' || e.key === 'a') && document.getElementById('btn-prev-vid')) document.getElementById('btn-prev-vid').click();
    return; 
  }

  if(!isGameStarted) return; 

  // 🔥 NUEVO: Atajo 'S' para tomar una foto/captura del universo en cualquier momento
  if (e.key === 's' || e.key === 'S') {
    renderer.render(scene, camera); // Forzamos un render fresco para evitar que salga negro
    try {
      const link = document.createElement('a');
      link.download = 'dac_captura_' + Math.floor(Math.random() * 10000) + '.png';
      link.href = document.querySelector('#bg-canvas').toDataURL('image/png');
      link.click(); 
      playSound('levelup');
      if (typeof showSystemToast === 'function') showSystemToast('> CAPTURA GUARDADA EN TU DISCO', '#00ffaa');
    } catch(err) { console.log("Error al guardar la imagen", err); }
  }

  if(e.key === 'ArrowLeft' || e.key === 'a') { keys.left = true; hasMoved = true; checkOnboarding(); } 
  if(e.key === 'ArrowRight' || e.key === 'd') { keys.right = true; hasMoved = true; checkOnboarding(); } 
  if(e.code === 'Space') { e.preventDefault(); isShooting = true; } 
});
document.addEventListener('keyup', (e) => { if(e.key === 'ArrowLeft' || e.key === 'a') keys.left = false; if(e.key === 'ArrowRight' || e.key === 'd') keys.right = false; if(e.code === 'Space') { isShooting = false; }});

const raycaster = new THREE.Raycaster(); 
let targetFov = 75; 
window.addEventListener('click', (e) => {
  if (isUIOpen && !e.target.closest('.modal-ui') && !e.target.closest('.control-btn') && !e.target.closest('#side-menu') && !e.target.closest('.carousel-btn')) {
    window.closeAllUIs();
    return; 
  }
  if (sideMenu && sideMenu.classList.contains('open') && !e.target.closest('#side-menu') && !e.target.closest('#menu-toggle')) { sideMenu.classList.remove('open'); }
  
  if (window.isDraggingCanvas) {
    window.isDraggingCanvas = false; 
    return; 
  }
  
  if (window.justDropped) return;

  if(!isGameStarted || isUIOpen || renderer.xr.isPresenting || e.target.closest('.control-btn') || e.target.closest('.modal-ui') || e.target.closest('#side-menu') || e.target.closest('.xr-wrapper') || e.target.closest('#touch-controls')) return;
  raycaster.setFromCamera(mouseNDC, camera);
  
const handleProjectClick = (data) => {
    if (window.isZooming) return; 
    window.isZooming = true;
    targetFov = 25; 
    
    // 🔥 EL NUEVO SONIDO CORTO Y ETÉREO
    playSound('project_open'); 
    
    setTimeout(() => {
      openProjectPopup(data);
      targetFov = 75; 
      window.isZooming = false;
    }, 350); 
  };
// ==========================================
  // 🔥 EL ORÁCULO: Clic en el Viajero (Sabiduría Aleatoria)
  // ==========================================
  const intersectsViajero = raycaster.intersectObjects([window.travelerGroup], true);
  if (intersectsViajero.length > 0) {
    const clickedViajero = intersectsViajero.find(hit => hit.object.userData && hit.object.userData.name === "viajero");
    if (clickedViajero) {
      playSound('project_open'); // Sonido especial celestial
      
      // 🔥 MATRIZ DE PENSAMIENTOS DEL VIAJERO
      const oraculoFrases = [
        "Soy el arquitecto de este sistema. Aquí siembro ideas, y el tiempo las hace florecer.",
        "No somos meros espectadores. Cada interacción reescribe el código de este territorio digital.",
        "Existen 'Juegos Otros' ocultos en los márgenes de la memoria. Búscalos donde la luz no alcanza.",
        "El espacio no es una cuadrícula inerte, es una red palpitante de posibilidades infinitas.",
        "Somos código interactuando consigo mismo. En cada destello, el universo se reconoce.",
        "El glitch no es una falla; es el sistema revelando su verdadera y frágil naturaleza humana."
      ];
      
      // Escoge una frase al azar cada vez que haces clic
      const fraseElegida = oraculoFrases[Math.floor(Math.random() * oraculoFrases.length)];
      
      showPoeticReflection(fraseElegida, "#aaccff");
      
      // El viajero levanta la espada como saludo
      if (window.travelerSword && window.travelerSwordMat) {
        window.travelerSword.rotation.z = Math.PI / 4; 
        window.travelerSwordMat.color.setHex(0x00ffff); // Brillo azul
        window.travelerSwordMat.color.multiplyScalar(2.0);
        
        // Baja la espada después de 4 segundos
        setTimeout(() => {
          window.travelerSword.rotation.z = Math.PI / -6;
          window.travelerSwordMat.color.setHex(0xffffff);
        }, 4000);
      }
      return; // Detiene el código para que no seleccione un planeta por error
    }
  }
  // 🔥 INTERACCIÓN CON EL SISTEMA DAC (antes de todo lo demás)
  // 🔥 INTERACCIÓN ESPACIAL CON EL SISTEMA DAC
  const intersectsDAC = raycaster.intersectObjects([planetaDAC, lunaPoetica, lunaErratica, lunaFriccion], true);
  if (intersectsDAC.length > 0) {
    let dacObj = intersectsDAC[0].object;
    while (dacObj.parent && dacObj.parent.type !== 'Scene' && dacObj.name === '') dacObj = dacObj.parent;

    if (window.isZooming) return;

    switch (dacObj.name) {
case "planeta_dac":
        window.isZooming = true;
        
        // 1. Restauramos el zoom visual por si estaba bugeado
        targetFov = 75; 
        camera.fov = 75;
        camera.updateProjectionMatrix();

        if (planetaDAC.userData.isIsolated) {
          // ==========================================
          // ⬅️ SALIR DE LA ZONA AISLADA
          // ==========================================
          planetaDAC.userData.isIsolated = false;
          
          // Restaurar la cámara a la distancia normal de navegación
          const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
          userGroup.position.set(0, 0, isAligned ? 30 : (isTouch || window.innerWidth < 600 ? 30 : 45));
          
          // Encender todo el universo de nuevo
          categoryPlanets.forEach(p => { 
            // Evitamos encender la anomalía (999) si no ha sido descubierta
            if (p.userData.id === 999 && (typeof secretDiscovered === 'undefined' || !secretDiscovered)) return;
            p.visible = true; 
          });
          if (typeof satelliteGroup !== 'undefined') satelliteGroup.visible = true;
          if (typeof energyWebGroup !== 'undefined') energyWebGroup.visible = !isAligned;
          if (typeof constellationLine !== 'undefined') constellationLine.visible = !isAligned;
          
          // Devolver el DAC a donde estaba flotando originalmente
          if (planetaDAC.userData.savedPos) {
            planetaDAC.position.copy(planetaDAC.userData.savedPos);
          }
          
          if (typeof dacNetworkGroup !== 'undefined') dacNetworkGroup.visible = false;
          const pt = document.getElementById('paint-tools'); if (pt) pt.style.display = 'none';
          showSystemToast('> SALIENDO DEL NÚCLEO DAC: UNIVERSO RESTAURADO', '#00ffcc');
          
        } else {
          // ==========================================
          // 🌌 ENTRAR A LA ZONA ESPECIAL (AISLAMIENTO)
          // ==========================================
          planetaDAC.userData.isIsolated = true;
          
          // Guardar la posición actual del DAC para cuando salgamos
          planetaDAC.userData.savedPos = planetaDAC.position.clone();
          
          // Apagar TODO el universo (los planetas ya no estorbarán)
          categoryPlanets.forEach(p => p.visible = false);
          if (typeof satelliteGroup !== 'undefined') satelliteGroup.visible = false;
          if (typeof energyWebGroup !== 'undefined') energyWebGroup.visible = false;
          if (typeof constellationLine !== 'undefined') constellationLine.visible = false;
          
          // Mover el DAC al centro absoluto (0,0,0)
          planetaDAC.position.set(0, 0, 0);
          
          // Acercar la cámara físicamente frente al DAC (sin distorsionar el lente)
          userGroup.position.set(0, 0, 22); 
          userGroup.rotation.set(0, 0, 0);  // Enderezamos la vista por si estaba rotada
          
          if (typeof dacNetworkGroup !== 'undefined') dacNetworkGroup.visible = true;
          showSystemToast('> ESPACIO AISLADO: NÚCLEO DAC. SELECCIONE UNA LUNA', '#ff00ff');
        }
        
    // ==========================================
        // 🔥 EFECTO DE PULSO DOBLE VISUAL (EN EL VIAJERO)
        // ==========================================
        let pulseColor = 0x00ffff; // Cian por defecto
        if (isPoeticaActive) pulseColor = 0xffffff;       
        else if (isErraticaActive) pulseColor = 0xff3300; 
        else if (isFriccionActive) pulseColor = 0xffff00; 

        const createDoublePulse = (targetObj, hexColor) => {
          if (!targetObj) return;
          const pMat = new THREE.MeshBasicMaterial({ color: hexColor, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
          // Radio más pequeño, ajustado al cuerpo del Viajero
          const pGeo = new THREE.SphereGeometry(10, 32, 32); 
          const pulse1 = new THREE.Mesh(pGeo, pMat);
          const pulse2 = new THREE.Mesh(pGeo, pMat.clone());
          
          // Lo centramos en el cuerpo del Viajero (su capa está en y=0.5)
          pulse1.position.y = 0.5; pulse2.position.y = 0.5;

          targetObj.add(pulse1); targetObj.add(pulse2);

          let s1 = 1, o1 = 0.6, s2 = 1, o2 = 0.6;
          pulse2.visible = false;
          
          setTimeout(() => { if(pulse2) pulse2.visible = true; }, 150);

          const anim = setInterval(() => {
            if(pulse1) { s1 += 0.04; o1 -= 0.02; pulse1.scale.set(s1, s1, s1); pulse1.material.opacity = Math.max(0, o1); }
            if(pulse2 && pulse2.visible) { s2 += 0.04; o2 -= 0.02; pulse2.scale.set(s2, s2, s2); pulse2.material.opacity = Math.max(0, o2); }
            
            if(o1 <= 0 && o2 <= 0) {
              clearInterval(anim);
              targetObj.remove(pulse1); targetObj.remove(pulse2);
              pulse1.geometry.dispose(); pulse1.material.dispose();
              pulse2.geometry.dispose(); pulse2.material.dispose();
            }
          }, 16); 
        };

        // 🔥 AHORA SE LO APLICAMOS AL VIAJERO
        createDoublePulse(window.travelerGroup, pulseColor);
        playSound('double_pulse'); 
        
        setTimeout(() => { window.isZooming = false; }, 350); 
        break;

  // 🔥 MÁQUINA POÉTICA: Tonos grises y blancos con extra neón
  case "maquina_poetica":
    if (isPoeticaActive) {
      isPoeticaActive = false; playSound('ui');
    } else {
      isPoeticaActive = true; isErraticaActive = false; isFriccionActive = false;
      showPoeticReflection("Somos el cosmos organizándose a sí mismo; polvo de estrellas tejiendo una red de luz pura.", "#ffffff");
      playSound('project_open');
    }
    
    // 1. Restaurar todo a la normalidad primero (Seguro antibug)
    categoryPlanets.forEach(p => {
      if (p.userData.id !== 999 && p.material && p.material.color && p.userData.originalColor) {
        p.material.color.setHex(p.userData.visited ? 0x555555 : p.userData.originalColor);
        if (!p.userData.visited) p.material.color.multiplyScalar(1.8);
        p.material.opacity = 0.95;
      }
    });
 lunaPoetica.scale.set(1, 1, 1); lunaErratica.scale.set(1, 1, 1); lunaFriccion.scale.set(1, 1, 1);
    document.body.style.cursor = 'default';
    if(window.travelerSwordMat && window.travelerSword) {
      window.travelerSwordMat.color.setHex(0xffffff);
      window.travelerSword.rotation.z = Math.PI / -6;
    }

    // 2. Aplicar efecto si se encendió
    if (isPoeticaActive) {
      // Viajero Poético (Espada de Luz Blanca)
      if(window.travelerSwordMat) {
        window.travelerSwordMat.color.setHex(0xffffff);
        window.travelerSwordMat.color.multiplyScalar(3.0);
      }
      
      const poetiColors = [0xffffff, 0xdddddd, 0xaaaaaa]; 
      categoryPlanets.forEach((p, idx) => {
        if (p.userData.id !== 999 && p.material && p.material.color) {
          p.material.color.setHex(poetiColors[idx % 3]);
          p.material.color.multiplyScalar(2.5); // Brillo extra
        }
      });
      lunaPoetica.scale.set(1.15, 1.15, 1.15);
    }
    break;

  // 🔥 MÁQUINA ERRÁTICA: Tonos rojos y parpadeo
  case "maquina_erratica":
    if (isErraticaActive) {
      isErraticaActive = false; playSound('ui');
    } else {
      isErraticaActive = true; isPoeticaActive = false; isFriccionActive = false;
      showPoeticReflection("La entropía es nuestro destino ineludible. En el quiebre de la estructura, redescubrimos nuestra propia fragilidad.", "#ff6655");
      playSound('pulse');
      shakeIntensity = 1.5;
      for (let i = 0; i < 10; i++) { setTimeout(() => {if(typeof triggerSubtleGlitch==='function') triggerSubtleGlitch()}, i * 80); }
    }
    
    // 1. Restaurar todo
    categoryPlanets.forEach(p => {
      if (p.userData.id !== 999 && p.material && p.material.color && p.userData.originalColor) {
        p.material.color.setHex(p.userData.visited ? 0x555555 : p.userData.originalColor);
        if (!p.userData.visited) p.material.color.multiplyScalar(1.8);
        p.material.opacity = 0.95;
      }
    });
    lunaPoetica.scale.set(1, 1, 1); lunaErratica.scale.set(1, 1, 1); lunaFriccion.scale.set(1, 1, 1);
    document.body.style.cursor = 'default';
    if(window.travelerSwordMat && window.travelerSword) {
      window.travelerSwordMat.color.setHex(0xffffff);
      window.travelerSword.rotation.z = Math.PI / -6;
    }

    // 2. Aplicar efecto
    if (isErraticaActive) {
      // Viajero Errático (Espada Láser Roja)
      if(window.travelerSwordMat) {
        window.travelerSwordMat.color.setHex(0xff0000);
        window.travelerSwordMat.color.multiplyScalar(2.0);
      }
      
      const erratiColors = [0xff2200, 0xcc0000, 0x991100]; 
      categoryPlanets.forEach((p, idx) => {
        if (p.userData.id !== 999 && p.material && p.material.color) {
          p.material.color.setHex(erratiColors[idx % 3]);
          p.material.color.multiplyScalar(1.5);
        }
      });
     lunaErratica.scale.set(1.2, 1.2, 1.2);
    }
    break;

  // 🔥 MÁQUINA FRICCIÓN: Tonos pesados y lentitud
  case "maquina_friccion":
    if (isFriccionActive) {
      isFriccionActive = false; playSound('ui');
    } else {
      isFriccionActive = true; isPoeticaActive = false; isErraticaActive = false;
      showPoeticReflection("La inmensidad del tiempo se pliega ante el peso de la materia. Todo comienza a detenerse.", "#ddbb66");
      playSound('boss_hit');
    }
    
    // 1. Restaurar todo
    categoryPlanets.forEach(p => {
      if (p.userData.id !== 999 && p.material && p.material.color && p.userData.originalColor) {
        p.material.color.setHex(p.userData.visited ? 0x555555 : p.userData.originalColor);
        if (!p.userData.visited) p.material.color.multiplyScalar(1.8);
        p.material.opacity = 0.95;
      }
    });
  lunaPoetica.scale.set(1, 1, 1); lunaErratica.scale.set(1, 1, 1); lunaFriccion.scale.set(1, 1, 1);
    document.body.style.cursor = 'default';
    if(window.travelerSwordMat && window.travelerSword) {
      window.travelerSwordMat.color.setHex(0xffffff);
      window.travelerSword.rotation.z = Math.PI / -6;
    }

    // 2. Aplicar efecto
    if (isFriccionActive) {
      // Viajero con Fricción (Espada Apagada, apuntando abajo)
      if(window.travelerSwordMat && window.travelerSword) {
        window.travelerSwordMat.color.setHex(0x222222);
        window.travelerSword.rotation.z = Math.PI; // Apunta abajo
      }
      
      document.body.style.cursor = 'wait';
      categoryPlanets.forEach(p => {
        if (p.userData.id !== 999 && p.material && p.material.color) {
          p.material.color.setHex(0x332211); 
          p.material.opacity = 0.25; 
        }
      });
     lunaFriccion.scale.set(1.15, 1.15, 1.15);
    }
    break;
}
return;
  }

  const intersectsSat = raycaster.intersectObject(satHitbox); if (intersectsSat.length > 0) { playSound('levelup', satelliteGroup.position); ring.material.color.setHex(0xffffff); innerShape.material.color.setHex(0xffffff); setTimeout(() => { ring.material.color.setHex(0xffaa00); innerShape.material.color.setHex(0xffaa00); }, 200); updateScore(100); return; }
  
  const intersectsPlanets = raycaster.intersectObjects(categoryPlanets, true); 
  if (intersectsPlanets.length > 0) { 
    let obj = intersectsPlanets[0].object; while(obj.parent && obj.parent.type === 'Group') obj = obj.parent;
    if(obj.userData && obj.userData.title) handleProjectClick(obj.userData); return; 
  }
  
  const intersectsVoyager = raycaster.intersectObjects(discoveredVoyagers, true); 
  if (intersectsVoyager.length > 0) { 
    let obj = intersectsVoyager[0].object; while(obj.parent && obj.parent.type === 'Group') obj = obj.parent;
    handleProjectClick(obj.userData); return; 
  }
  
  const intersectsWhales = raycaster.intersectObjects(ambientWhales, true); 
  if (intersectsWhales.length > 0) { handleProjectClick(whaleData); return; }
  
  const intersectsCats = raycaster.intersectObjects(guardianCats, true); 
  if (intersectsCats.length > 0) { 
    let catObj = intersectsCats[0].object;
    while(catObj.parent && catObj.parent.type === 'Group') catObj = catObj.parent;
    if(catObj.userData && catObj.userData.catData) {
      playSound('levelup'); openProjectPopup(catObj.userData.catData); return; 
    }
  }

  const intersectsAsteroids = raycaster.intersectObjects(asteroids, true); if (intersectsAsteroids.length > 0) { let t = intersectsAsteroids[0].object; while(t.parent && t.parent.type === 'Group') t = t.parent; shakeIntensity = 0.4; playSound('explosion', t.position); createExplosion(t.position.x, t.position.y, t.position.z); updateScore(100); scene.remove(t); t.geometry.dispose(); t.material.dispose(); asteroids.splice(asteroids.indexOf(t), 1); }
});

const controllerModelFactory = new XRControllerModelFactory();

const xrController1 = renderer.xr.getController(0);
userGroup.add(xrController1); 
const grip1 = renderer.xr.getControllerGrip(0);
grip1.add(controllerModelFactory.createControllerModel(grip1));
userGroup.add(grip1); 

const xrController2 = renderer.xr.getController(1);
userGroup.add(xrController2); 
const grip2 = renderer.xr.getControllerGrip(1);
grip2.add(controllerModelFactory.createControllerModel(grip2));
userGroup.add(grip2); 

const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -20)]);
const laser = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8 }));
xrController1.add(laser.clone());
const laser2 = laser.clone();
laser2.material = new THREE.LineBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.8 });
xrController2.add(laser2);


let arModelIndex = 0; 
window.spawnedObjects = []; 

xrController1.addEventListener('select', (event) => {
  if (window.isARSession) {
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(xrController1.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(xrController1.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

   const intersects = raycaster.intersectObjects(window.spawnedObjects, true);
    if (intersects.length > 0) {
      let obj = intersects[0].object;
      while(obj.parent && obj.parent !== scene && !window.spawnedObjects.includes(obj)) obj = obj.parent;
      
      if (window.spawnedObjects.includes(obj)) {
        // 🔥 SISTEMA DE DOBLE TOQUE PARA BORRAR
        if (obj.userData.markedForDeletion) {
          // Segundo toque: Eliminar definitivamente
          scene.remove(obj);
          window.spawnedObjects.splice(window.spawnedObjects.indexOf(obj), 1);
          playSound('explosion'); 
          showSystemToast('OBJETO ELIMINADO', '#00ffaa');
        } else {
          // Primer toque: Marcar en rojo y avisar
          obj.userData.markedForDeletion = true;
          playSound('ui');
          showSystemToast('⚠️ TOCA DE NUEVO PARA CONFIRMAR ELIMINACIÓN', '#cc0000');
          
          // Cambiar color a rojo táctico temporalmente
          obj.traverse((child) => {
            if (child.isMesh && child.material.uniforms) {
              child.userData.originalColor = child.material.uniforms.color.value.getHex();
              child.material.uniforms.color.value.setHex(0xcc0000);
            }
          });

          // Si no lo vuelve a tocar en 3 segundos, se cancela la eliminación
          setTimeout(() => {
            if (obj.parent && obj.userData.markedForDeletion) {
              obj.userData.markedForDeletion = false;
              obj.traverse((child) => {
                if (child.isMesh && child.material.uniforms && child.userData.originalColor) {
                  child.material.uniforms.color.value.setHex(child.userData.originalColor);
                }
              });
            }
          }, 3000);
        }
        return; 
      }
    }

    if (reticle.visible) {
      // 🔥 AÑADIMOS AL VIAJERO AL MENÚ DE INVOCACIÓN DE AR
      const models = [window.travelerGroup, voyagerModelTemplate, whaleModelTemplate, gamberModelTemplate, chaplinModelTemplate];
      const activeModel = models[arModelIndex % models.length]; 
      
      if (activeModel) {
        let clone;
        if (activeModel === window.travelerGroup) {
          // El Viajero no se clona normal porque tiene físicas vivas, invocamos al original
          clone = window.travelerGroup;
          clone.scale.set(0.2, 0.2, 0.2); // Escala para la vida real
          // Simulamos una caída desde el techo físico
          clone.userData.dropY = reticle.position.y + 2.0; 
          clone.userData.vy = 0;
          clone.userData.anchoredPlanet = { position: reticle.position, userData: { isFolder: true }, visible: true }; 
        } else {
          clone = activeModel.clone();
          if(arModelIndex % models.length === 1) clone.scale.set(0.05, 0.05, 0.05);
          else clone.scale.set(0.15, 0.15, 0.15);
        }
        
        clone.position.setFromMatrixPosition(reticle.matrix);
        scene.add(clone);
        
        if (clone !== window.travelerGroup) window.spawnedObjects.push(clone); 
        
        if (typeof playSound === 'function') playSound('levelup', clone.position);
        arModelIndex++; 
      }
    }
  } else {
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(xrController1.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(xrController1.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects([...categoryPlanets, ...asteroids, satHitbox], true);
    if (intersects.length > 0) {
      let obj = intersects[0].object;
      while(obj.parent && obj.parent.type === 'Group') obj = obj.parent;
      if (obj.geometry && obj.geometry.type === "DodecahedronGeometry") {
        shakeIntensity = 0.4; playSound('explosion', obj.position);
        createExplosion(obj.position.x, obj.position.y, obj.position.z);
        scene.remove(obj); asteroids.splice(asteroids.indexOf(obj), 1);
        updateScore(100);
      }
    } else {
      isShooting = true; setTimeout(() => isShooting = false, 150);
    }
  }
}); 

let vrGrabbedObject = null; 

function handleGrabStart(event) {
  if (window.isARSession) return;
  
  const controller = event.target; 
  const tempMatrix = new THREE.Matrix4();
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

  const grabTargets = [...categoryPlanets, ...ambientWhales, ...guardianCats, ...discoveredVoyagers];
  const intersects = raycaster.intersectObjects(grabTargets, true);
  
  if (intersects.length > 0) {
    let obj = intersects[0].object;
    
    while (obj.parent && obj.parent !== scene && !grabTargets.includes(obj)) {
      obj = obj.parent;
    }
    
    vrGrabbedObject = obj;
    controller.attach(vrGrabbedObject); 
    
    vrGrabbedObject.position.set(0, 0, -0.2); 
    
    playSound('levelup'); 
  } else {
    playSound('ui'); 
  }
}
function handleGrabEnd(event) {
  if (vrGrabbedObject) {
    scene.attach(vrGrabbedObject); 
    
    // 🔥 MAGIA VR: Si soltamos al Viajero, evaluamos si cayó cerca de un planeta
    if (vrGrabbedObject === window.travelerGroup) {
      let closestPlanet = null;
      let minDistance = 25.0; // Radio magnético para VR
      
      categoryPlanets.forEach(p => {
        if(p.userData.id === 999) return; 
        const dist = window.travelerGroup.position.distanceTo(p.position);
        if (dist < minDistance) {
          minDistance = dist;
          closestPlanet = p;
        }
      });

      if (closestPlanet) {
        // Ejecutamos la misma física y sonido que programamos para el ratón
        window.startTravelerFall(closestPlanet);
        if (typeof playSound === 'function') playSound('project_open');
        
        // Efecto visual de conquista
        if (window.travelerSwordMat) {
          window.travelerSwordMat.color.setHex(0x00ffff);
          setTimeout(() => { window.travelerSwordMat.color.setHex(0xffffff); }, 4000);
        }
      } else {
        // Si lo lanzas al vacío espacial
        window.travelerGroup.userData.anchoredPlanet = null;
        window.travelerGroup.userData.baseY = window.travelerGroup.position.y;
        window.travelerGroup.userData.baseX = window.travelerGroup.position.x;
      }
    }
    
    vrGrabbedObject = null;
  }
}

xrController2.addEventListener('selectstart', handleGrabStart);
xrController2.addEventListener('selectend', handleGrabEnd);
xrController2.addEventListener('squeezestart', handleGrabStart);
xrController2.addEventListener('squeezeend', handleGrabEnd);

xrController1.addEventListener('selectstart', () => { 
  if (!window.isARSession) isShooting = true; 
}); 
xrController1.addEventListener('selectend', () => { 
  isShooting = false; 
});



//aqui
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; 
  camera.updateProjectionMatrix(); 
  renderer.setSize(window.innerWidth, window.innerHeight);
   composer.setSize(window.innerWidth, window.innerHeight); });

const secretGeo = new THREE.IcosahedronGeometry(2, 0); 
const secretMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
const secretPlanet = new THREE.Mesh(secretGeo, secretMat);
secretPlanet.position.set(0, 50, 0); 
secretPlanet.visible = false;
secretPlanet.userData = { 
  id: 999, 
  title: 'ANOMALÍA // 0xDEADBEEF', 
  desc: 'Has roto la simulación.', 
  longDesc: '<p style="color:#ff0000">> ALERTA: Acceso no autorizado.<br>Diste una vuelta completa al sistema y encontraste este archivo corrupto. Felicidades, explorador.</p>',
  tech: ['Easter Egg', 'Curiosidad', 'Hacking'],
  color: 0xff0000,
  gallery: [], videos: [], link: ''
};
const secretLabel = createTextSprite('> 999. ARCHIVO CORRUPTO', '#ff0000');
secretLabel.position.set(0, 4, 0);
secretPlanet.add(secretLabel);
scene.add(secretPlanet);
categoryPlanets.push(secretPlanet); 
let secretDiscovered = false;

let isAligned = false;
let carouselAngleOffset = 0; 

// ==========================================
// 🔥 RED DE ENERGÍA NEURAL (REEMPLAZA LA CONSTELACIÓN)
// ==========================================
const energyWebGroup = new THREE.Group();
scene.add(energyWebGroup);

const numWebLines = 5; // Hilos de energía
const webLines = [];

for (let i = 0; i < numWebLines; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(300 * 3), 3)); 
  
  // Colores Cyberpunk que brillan al superponerse
 const colorHex = i % 3 === 0 ? 0x6688ff : (i % 3 === 1 ? 0x88aaff : 0xaa66ff); 
  // 🔥 HIPER-LUZ: Multiplicamos el color x2 para que rompa el umbral del Bloom y estalle en Neón puro
  const mat = new THREE.LineBasicMaterial({ 
    color: new THREE.Color(colorHex).multiplyScalar(2.0), 
    transparent: true, 
    opacity: 0.8, // Subimos opacidad para que el rayo sea denso
    blending: THREE.AdditiveBlending, 
    depthWrite: false
  });
  
  const line = new THREE.LineSegments(geo, mat); 
  webLines.push(line);
  energyWebGroup.add(line);
}
// ==========================================
// 🔥 EL VIAJERO (Guardián del Sistema)
// ==========================================
window.travelerGroup = new THREE.Group();
window.travelerGroup.userData = { name: "viajero" }; 

// Cuerpo y capa usan el MISMO shader de tramado (dither 1-bit) que el resto del universo.
const makeTravelerDither = (hex) => new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(hex) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } },
  vertexShader: ditherShader.vertexShader,
  fragmentShader: ditherShader.fragmentShader,
  side: THREE.DoubleSide
});
const travelerHeadMat = makeTravelerDither(0xffffff);
const travelerCapeMat = makeTravelerDither(0xffffff);
// La espada sigue siendo MeshBasicMaterial: el resto del código le cambia el color
window.travelerSwordMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });

// 1. Cabeza (El Observador): octaedro girado 45° para que una ARISTA quede al frente, ahí va el visor
const headGeo = new THREE.OctahedronGeometry(0.4, 0);
headGeo.rotateY(Math.PI / 4);
window.travelerHead = new THREE.Mesh(headGeo, travelerHeadMat);
window.travelerHead.position.y = 1.75;
window.travelerHead.userData = { name: "viajero" }; // Etiqueta para el clic
window.travelerGroup.add(window.travelerHead);

// 1b. Visor negro + pupila brillante que sigue al ratón
const travelerVisor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0x000000 }));
travelerVisor.position.set(0, 0.02, 0.26);
travelerVisor.userData = { name: "viajero" };
window.travelerHead.add(travelerVisor);

const travelerPupilMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
travelerPupilMat.color.multiplyScalar(2.2); // pasa el umbral del Bloom
const travelerPupil = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.02), travelerPupilMat);
travelerPupil.position.set(0, 0.02, 0.32);
travelerPupil.userData = { name: "viajero" };
window.travelerHead.add(travelerPupil);
window.travelerEye = { pupil: travelerPupil, mat: travelerPupilMat, open: 1, mode: 'n' };

// 2. Capa de triángulos flotantes (una sola malla; se reescribe cada frame en updateTravelerCape)
const CAPE_N = 12;
const capeGeo = new THREE.BufferGeometry();
capeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAPE_N * 9), 3));
capeGeo.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(CAPE_N * 9), 3));
const travelerCapeMesh = new THREE.Mesh(capeGeo, travelerCapeMat);
travelerCapeMesh.frustumCulled = false;
travelerCapeMesh.userData = { name: "viajero" };
window.travelerGroup.add(travelerCapeMesh);
const travelerCape = { geo: capeGeo, pos: capeGeo.attributes.position.array, flare: 0 };

// 2b. Hitbox invisible: los triángulos dejan huecos y así es más fácil agarrarlo / hacerle clic
const travelerHitbox = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 3.2, 8), new THREE.MeshBasicMaterial({ visible: false }));
travelerHitbox.position.y = 0.8;
travelerHitbox.userData = { name: "viajero" };
window.travelerGroup.add(travelerHitbox);

// 3. Espada (Reactiva)
const swordGeo = new THREE.BoxGeometry(0.04, 3.0, 0.04);
window.travelerSword = new THREE.Mesh(swordGeo, window.travelerSwordMat); 
window.travelerSword.position.set(0.6, 0.2, 0.5); 
window.travelerSword.rotation.z = Math.PI / -6; 
window.travelerSword.rotation.x = Math.PI / 8; 
window.travelerSword.userData = { name: "viajero" };
window.travelerGroup.add(window.travelerSword);

window.travelerGroup.position.set(-8, -3, -15); 
window.travelerGroup.rotation.y = Math.PI / 3; 
scene.add(window.travelerGroup);
// ============================================================
// 🔥 VIAJERO CON PESO: gravedad radial (parado sobre los planetas)
// ------------------------------------------------------------
// DÓNDE PEGARLO en main.js:
//   Justo DESPUÉS de crear el viajero (tras `scene.add(window.travelerGroup);`,
//   línea ~3180) y ANTES de `renderer.setAnimationLoop(...)`.
//
// Y luego los 3 cambios de abajo (PASO 2, 3 y 4).
// ============================================================

const TRAVELER_FEET    = 0.6;  // del origen del grupo a la base de la capa (cono: y=0.5, alto 2.2 -> base en -0.6)
const TRAVELER_GRAVITY = 80;   // unidades/s². Súbelo para sentirlo más pesado
const TRAVELER_BOUNCE  = 0.3;  // 0 = se clava, 1 = rebote perfecto
const TRAVELER_RADIAL  = false; // false = cae en vertical y se para ENCIMA del planeta | true = gravedad hacia el centro (puede quedar de lado)

const _tvUp       = new THREE.Vector3(0, 1, 0);
const _tvTmp      = new THREE.Vector3();
const _tvCamPos   = new THREE.Vector3();
const _tvQuat     = new THREE.Quaternion();
const _tvFreeQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 3, 0)); // giro original (rotation.y = PI/3)
let _tvLastT  = performance.now();
let _tvSquash = 0; // aplastamiento por impacto

// ---- Estados conceptuales del viajero ----
const TRAVELER_STEP_SOUND = true; // false = camina en silencio (Fricción)
const _tvX = new THREE.Vector3(1, 0, 0);
const _tvZ = new THREE.Vector3(0, 0, 1);
const _tvSway = new THREE.Quaternion();
let _tvStretch = 0;  // estiramiento al caer
let _tvLandT   = 0;  // segundos que dura el estado "aterrizaje"
let _tvStep    = 0;  // fase del paso (Fricción)
const _tvLastMouse = { x: 0, y: 0, t: 0 };
const _tvGaze      = { x: 0, y: 0, tx: 0, ty: 0, next: 0 };

const _tvRingGeo  = new THREE.RingGeometry(0.8, 1.0, 32);
const _tvChipGeo  = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const _tvPrintGeo = new THREE.CircleGeometry(0.2, 10);
const _tvDust   = [];   // anillos y partículas del aterrizaje
const _tvPrints = [];   // huellas sobre el planeta
const POET_N = 48;      // partículas de la Máquina Poética
const _tvPoetGeo = new THREE.BufferGeometry();
_tvPoetGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POET_N * 3), 3));
_tvPoetGeo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(POET_N * 3), 3));
const _tvPoetData = Array.from({ length: POET_N }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0 }));
const _tvPoet = new THREE.Points(_tvPoetGeo, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
_tvPoet.frustumCulled = false;
_tvPoet.raycast = function () {};
scene.add(_tvPoet);
let _tvPoetAcc = 0;

// Radio de la "superficie" según la geometría real y la escala ACTUAL
// (el hover escala el planeta x1.2, así que no se puede usar un número fijo).
function getPlanetSurfaceRadius(p) {
  if (p.userData.isFolder) return 1 * p.scale.y; // caja 4x2x0.5 -> tapa superior a 1 * escala
  return 3 * p.scale.x;                          // SphereGeometry(3)
}

// Se llama al soltar al viajero cerca de un planeta.
window.startTravelerFall = function (planet) {
  const tg = window.travelerGroup;
  const st = tg.userData;
  const R  = getPlanetSurfaceRadius(planet);

  st.anchoredPlanet = planet;
  st.R    = R;
  st.lift = 0;
  st.vAlt = -2; // pequeño empujón inicial hacia el planeta

  if (TRAVELER_RADIAL) {
    // Gravedad hacia el centro: aterriza en el punto del planeta que mira hacia donde lo soltaste
    _tvTmp.copy(tg.position).sub(planet.position);
    const dist = _tvTmp.length();
    const dir  = dist > 0.001 ? _tvTmp.clone().divideScalar(dist) : new THREE.Vector3(0, 1, 0);
    camera.getWorldPosition(_tvCamPos);
    const toCam  = _tvCamPos.sub(planet.position).normalize();
    const facing = dir.dot(toCam);
    if (facing < 0.25) dir.addScaledVector(toCam, 0.25 - facing).normalize();
    st.dir = dir;
    st.off = new THREE.Vector3(0, 0, 0);
    st.alt = Math.max(dist - R - TRAVELER_FEET, 2);
  } else {
    // Gravedad "hacia abajo": cae en vertical y se para ENCIMA del planeta
    st.dir = new THREE.Vector3(0, 1, 0);
    st.off = new THREE.Vector3(tg.position.x - planet.position.x, 0, tg.position.z - planet.position.z);
    const topY = planet.position.y + R + TRAVELER_FEET;
    st.alt = Math.max(tg.position.y - topY, 8); // cae al menos 8 unidades: así se nota el peso
  }
};

// Anillo de polvo + 10 partículas, del color del planeta. Se llama al impactar.
function spawnTravelerDust(planet, up, point, strength) {
  const col = new THREE.Color(planet.userData.originalColor || 0x00ffff).multiplyScalar(1.8);

  const ringMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(_tvRingGeo, ringMat);
  ring.position.copy(point);
  ring.quaternion.setFromUnitVectors(_tvZ, up);
  ring.scale.setScalar(0.5);
  ring.raycast = function () {};
  scene.add(ring);
  _tvDust.push({ kind: 'ring', mesh: ring, age: 0, life: 0.6, size: 2.2 + strength * 3 });

  const burst = { mat: new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 1, depthWrite: false }), n: 10 };
  const a = new THREE.Vector3().crossVectors(up, Math.abs(up.z) < 0.9 ? _tvZ : _tvX).normalize();
  const b = new THREE.Vector3().crossVectors(up, a);
  for (let i = 0; i < 10; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = (2 + Math.random() * 3) * (0.5 + strength);
    const vel = new THREE.Vector3().addScaledVector(a, Math.cos(ang) * speed).addScaledVector(b, Math.sin(ang) * speed).addScaledVector(up, 1.5 + Math.random() * 2);
    const chip = new THREE.Mesh(_tvChipGeo, burst.mat);
    chip.position.copy(point);
    chip.raycast = function () {};
    scene.add(chip);
    _tvDust.push({ kind: 'chip', mesh: chip, age: 0, life: 0.7, vel, up: up.clone(), burst });
  }
}

function _tvRemovePrint(p) { p.planet.remove(p.mesh); p.mesh.material.dispose(); }

// Huella oscura pegada a la superficie (hija del planeta: gira con él). side: -1 izquierdo / +1 derecho
function spawnTravelerPrint(planet, dir, side) {
  if (planet.userData.isFolder) return;
  const R = getPlanetSurfaceRadius(planet);
  const w = new THREE.Vector3().copy(dir).multiplyScalar(R).addScaledVector(_tvZ, side * 0.2).normalize();
  const world = new THREE.Vector3().copy(planet.position).addScaledVector(w, R);
  planet.updateWorldMatrix(true, false);
  const n = planet.worldToLocal(world).normalize();
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  const m = new THREE.Mesh(_tvPrintGeo, mat);
  m.position.copy(n).multiplyScalar(3.03);   // radio local de la esfera = 3
  m.quaternion.setFromUnitVectors(_tvZ, n);
  m.scale.set(1, 1.6, 1);
  m.raycast = function () {};                // que no estorbe a los clics sobre el planeta
  planet.add(m);
  _tvPrints.push({ mesh: m, planet, age: 0, life: 14 });
  if (_tvPrints.length > 30) _tvRemovePrint(_tvPrints.shift());
}

// Polvo, huellas y partículas poéticas. emitting = Máquina Poética activa.
function updateTravelerFx(dt, emitting, tg) {
  for (let i = _tvDust.length - 1; i >= 0; i--) {
    const d = _tvDust[i]; d.age += dt;
    const k = Math.min(d.age / d.life, 1);
    if (d.kind === 'ring') {
      const ease = 1 - (1 - k) * (1 - k);
      d.mesh.scale.setScalar(0.5 + (d.size - 0.5) * ease);
      d.mesh.material.opacity = 0.9 * (1 - k);
    } else {
      d.vel.addScaledVector(d.up, -9 * dt);
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.scale.setScalar(Math.max(0.01, 1 - k));
      d.burst.mat.opacity = 1 - k;
    }
    if (k >= 1) {
      scene.remove(d.mesh);
      if (d.kind === 'ring') d.mesh.material.dispose(); else if (--d.burst.n === 0) d.burst.mat.dispose();
      _tvDust.splice(i, 1);
    }
  }

  for (let i = _tvPrints.length - 1; i >= 0; i--) {
    const p = _tvPrints[i]; p.age += dt;
    const f = p.age / p.life;
    p.mesh.material.opacity = 0.55 * (f < 0.6 ? 1 : Math.max(0, (1 - f) / 0.4));
    if (f >= 1) { _tvRemovePrint(p); _tvPrints.splice(i, 1); }
  }

  const pos = _tvPoetGeo.attributes.position.array, col = _tvPoetGeo.attributes.color.array;
  _tvPoetAcc = emitting ? _tvPoetAcc + dt * 28 : 0;
  for (let i = 0; i < POET_N; i++) {
    const p = _tvPoetData[i], k = i * 3;
    if (p.life <= 0 && _tvPoetAcc >= 1) {
      _tvPoetAcc -= 1;
      p.life = p.max = 1.2 + Math.random() * 0.8;
      pos[k]     = tg.position.x + (Math.random() - 0.5) * 1.2;
      pos[k + 1] = tg.position.y + (Math.random() - 0.5) * 1.6;
      pos[k + 2] = tg.position.z + (Math.random() - 0.5) * 1.2;
      p.vx = (Math.random() - 0.5) * 0.3; p.vy = 0.5 + Math.random() * 0.8; p.vz = (Math.random() - 0.5) * 0.3;
    }
    if (p.life > 0) {
      p.life -= dt;
      pos[k] += p.vx * dt; pos[k + 1] += p.vy * dt; pos[k + 2] += p.vz * dt;
      const f = Math.max(0, p.life / p.max) * 1.6; // en mezcla aditiva, color->0 = se desvanece
      col[k] = f; col[k + 1] = 0.55 * f; col[k + 2] = f;
    } else { col[k] = col[k + 1] = col[k + 2] = 0; }
  }
  _tvPoetGeo.attributes.position.needsUpdate = true;
  _tvPoetGeo.attributes.color.needsUpdate = true;
}

// Capa: 12 triángulos que cuelgan del cuello y flotan. flare 0..1 = se abre hacia arriba al caer; glitch = Máquina Errática
function updateTravelerCape(t, flare, glitch) {
  const pos = travelerCape.pos;
  let k = 0;
  for (let i = 0; i < CAPE_N; i++) {
    const a0 = (i / CAPE_N) * Math.PI * 2, a1 = ((i + 1) / CAPE_N) * Math.PI * 2, am = (a0 + a1) / 2;
    const long = (i % 2 === 0); // puntas largas y cortas alternadas = borde irregular (como pies/jirones)
    const sway = Math.sin(t * 1.7 + i * 1.3);
    const rTip = (long ? 0.85 : 0.7) * (1 + flare * 0.3) + sway * 0.05;
    const yTip = (long ? -0.6 : -0.1) + flare * (long ? 1.4 : 1.0) + Math.sin(t * 1.1 + i) * 0.04;
    let tx = Math.cos(am) * rTip, tz = Math.sin(am) * rTip;
    if (glitch && Math.random() > 0.9) { tx += (Math.random() - 0.5) * 0.5; tz += (Math.random() - 0.5) * 0.5; }
    // dos vértices arriba (anillo del cuello, con un pequeño hueco entre triángulos) + 1 punta abajo
    pos[k++] = Math.cos(a0 + 0.05) * 0.3; pos[k++] = 1.3; pos[k++] = Math.sin(a0 + 0.05) * 0.3;
    pos[k++] = Math.cos(a1 - 0.05) * 0.3; pos[k++] = 1.3; pos[k++] = Math.sin(a1 - 0.05) * 0.3;
    pos[k++] = tx; pos[k++] = yTip; pos[k++] = tz;
  }
  travelerCape.geo.attributes.position.needsUpdate = true;
  travelerCape.geo.computeVertexNormals();
  travelerCape.geo.computeBoundingSphere();
}

// Se llama UNA vez por frame, DESPUÉS de mover los planetas (para que no vaya un frame atrasado).
function updateTraveler() {
  const tg   = window.travelerGroup;
  const head = window.travelerHead;
  if (!tg || !head) return;

  const st   = tg.userData;
  const nowT = performance.now();
  const dt   = Math.min((nowT - _tvLastT) / 1000, 0.05); // tope para que un lag no lo "teletransporte"
  _tvLastT   = nowT;
  const t    = nowT * 0.001;

  const slow    = typeof isFriccionActive !== 'undefined' && isFriccionActive;
  const poetic  = typeof isPoeticaActive  !== 'undefined' && isPoeticaActive;
  const erratic = typeof isErraticaActive !== 'undefined' && isErraticaActive;
  // Solo cuenta como "arrastrando" cuando de verdad se movió el puntero (un clic simple no lo despega)
  const dragging = typeof draggedPlanet !== 'undefined' && draggedPlanet === tg &&
                   typeof isDraggingPlanet !== 'undefined' && isDraggingPlanet;
  let flareTarget = 0, falling = false, walking = false, lean = 0;

  if (dragging) {
    // ---- EN LA MANO DEL USUARIO ----
    st.anchoredPlanet = null;
    st.baseX = tg.position.x;
    st.baseY = tg.position.y;
    tg.quaternion.slerp(_tvFreeQuat, 0.15);
    flareTarget = 0.35; // la capa se agita cuando lo sostienes
    tg.scale.set(1, 1, 1); _tvSquash = 0; _tvStretch = 0;

  } else if (st.anchoredPlanet) {
    // ---- PARADO SOBRE UN PLANETA ----
    const planet = st.anchoredPlanet;

    // 1. Superficie actual, suavizada (el hover cambia la escala de golpe)
    st.R += (getPlanetSurfaceRadius(planet) - st.R) * Math.min(1, dt * 12);

    // 2. Caída con peso: gravedad hacia el centro + rebote que pierde energía
    const g = TRAVELER_GRAVITY * (slow ? 0.25 : 1); // Fricción = cámara lenta
    st.vAlt -= g * dt;
    st.alt  += st.vAlt * dt;
    if (st.alt <= 0) {
      st.alt = 0;
      const impact = -st.vAlt;
      if (impact > 6) {
        st.vAlt   = impact * TRAVELER_BOUNCE;
        _tvSquash = Math.min(impact / 70, 0.35);
        if (impact > 25 && typeof vibrateDevice === 'function') vibrateDevice(25);
        if (impact > 12) { // aterrizaje con peso: anillo de polvo + golpe grave
          const upV = planet.userData.isFolder ? _tvUp : st.dir;
          _tvTmp.copy(planet.position).addScaledVector(upV, st.R);
          spawnTravelerDust(planet, upV, _tvTmp, Math.min(impact / 70, 1));
          _tvLandT = 0.5;
          if (typeof playSound === 'function') playSound(impact > 40 ? 'thud' : 'thud_soft');
        }
      } else {
        st.vAlt = 0; // ya está quieto: pegado al suelo
      }
    }

    flareTarget = Math.min(1, Math.max(0, -st.vAlt / 50)); // al caer, la capa se abre hacia arriba
    falling = st.vAlt < -8;

    // CAÍDA: el cuerpo se estira
    _tvStretch += ((falling ? Math.min(0.25, -st.vAlt / 250) : 0) - _tvStretch) * Math.min(1, dt * 12);

    // FRICCIÓN: camina lento y pesado alrededor del planeta y deja huellas
    const grounded = (st.alt === 0 && st.vAlt === 0);
    walking = slow && grounded && !planet.userData.isFolder;
    if (walking) {
      if (st.walkDir === undefined) { st.walkDir = 1; st.walkNext = t + 5; }
      const phi = Math.atan2(-st.dir.x, st.dir.y);              // ángulo desde la cima (giro sobre el eje Z)
      if (Math.abs(phi) > 0.9) st.walkDir = phi > 0 ? -1 : 1;   // no se aleja demasiado de la cima
      else if (t > st.walkNext) { st.walkDir *= -1; st.walkNext = t + 6 + Math.random() * 4; }
      st.dir.applyAxisAngle(_tvZ, st.walkDir * 0.1 * dt).normalize();
      const prev = _tvStep;
      _tvStep += dt * Math.PI * 0.9;                            // un paso cada ~1.1 s
      lean = Math.sin(_tvStep) * 0.1;                           // se balancea al andar
      if (Math.floor(_tvStep / Math.PI) !== Math.floor(prev / Math.PI)) { // pisada
        spawnTravelerPrint(planet, st.dir, (Math.floor(_tvStep / Math.PI) % 2 === 0) ? -1 : 1);
        _tvSquash = Math.max(_tvSquash, 0.07);                  // el pisotón se siente
        if (TRAVELER_STEP_SOUND && typeof playSound === 'function') playSound('step');
      }
    }

    // 3. Máquina Poética: levita un poco SOBRE su superficie
    st.lift += ((poetic ? 0.8 : 0) - st.lift) * Math.min(1, dt * 3);

    // 4. Aplastamiento al caer (se recupera solo)
    _tvSquash *= Math.exp(-dt * 10);
    if (_tvSquash < 0.002) _tvSquash = 0;
    // IDLE: respira (solo cuando está quieto)
    const breath = (grounded && !walking) ? Math.sin(t * 2) * 0.012 : 0;
    const sy  = (1 - _tvSquash + _tvStretch) * (1 + breath);
    const sxz = 1 + _tvSquash * 0.5 - _tvStretch * 0.4 - breath * 0.5;
    tg.scale.set(sxz, sy, sxz);

    // 5. Posición: centro del planeta (YA actualizado este frame) + "arriba" * altura
    const up = planet.userData.isFolder ? _tvUp : st.dir; // la carpeta es plana: siempre arriba
    const h  = st.R + TRAVELER_FEET * sy + st.alt + st.lift + Math.sin(t * 2) * 0.2 * st.lift;
    st.off.multiplyScalar(Math.exp(-dt * 5)); // se va centrando sobre el planeta mientras cae
    tg.position.copy(planet.position).add(st.off).addScaledVector(up, h);

    // 6. Orientación: su "arriba" apunta lejos del centro (pies hacia el planeta)
    _tvSway.setFromAxisAngle(_tvZ, lean);
    _tvQuat.setFromUnitVectors(_tvUp, up).multiply(_tvSway).multiply(_tvFreeQuat);
    tg.quaternion.slerp(_tvQuat, 1 - Math.exp(-dt * 8));

    // 7. Glitch de la Máquina Errática + se oculta si el planeta se oculta
    let vis = planet.visible;
    if (erratic && Math.random() > 0.85) {
      tg.position.x += (Math.random() - 0.5) * 0.6;
      vis = vis && Math.random() > 0.2;
    }
    tg.visible = vis;

  } else {
    // ---- LIBRE EN EL ESPACIO (levitación original) ----
    if (st.baseY === undefined) { st.baseY = tg.position.y; st.baseX = tg.position.x; }
    let floatSpeed = 1.5, floatHeight = 0.3, baseY = st.baseY;
    if (slow)        { floatSpeed = 0.2; floatHeight = 0.05; }
    else if (poetic) { baseY += 0.8; floatSpeed = 2.0; }

    tg.position.y = baseY + Math.sin(t * floatSpeed) * floatHeight;
    if (erratic && Math.random() > 0.85) {
      tg.position.x = st.baseX + (Math.random() - 0.5) * 0.6;
      tg.visible = Math.random() > 0.2;
    } else {
      tg.position.x = st.baseX;
      tg.visible = true;
    }
    tg.quaternion.slerp(_tvFreeQuat, 0.1); // vuelve a ponerse derecho
    tg.scale.set(1, 1, 1); _tvSquash = 0; _tvStretch = 0;
  }

  // ---- EFECTOS Y ESTADO ----
  _tvLandT = Math.max(0, _tvLandT - dt);
  if (poetic && !dragging) flareTarget = Math.max(flareTarget, 0.25); // POÉTICA: la capa flota ingrávida
  updateTravelerFx(dt, poetic, tg);
  window.travelerState = dragging ? 'held'
    : !st.anchoredPlanet ? (poetic ? 'levitate' : 'free')
    : falling ? 'fall' : _tvLandT > 0 ? 'land' : walking ? 'walk' : poetic ? 'levitate' : 'idle';

  // ---- CAPA: se abre al caer y se asienta al aterrizar ----
  travelerCape.flare += (flareTarget - travelerCape.flare) * Math.min(1, dt * 10);
  updateTravelerCape(t, travelerCape.flare, erratic);

  // ---- EL OBSERVADOR: la cabeza gira un poco hacia el ratón y la pupila se mueve más ----
  // (-PI/3 compensa el giro del cuerpo para que al reposo el visor mire a la cámara)
  // IDLE: sigue al ratón; si no lo mueves en 3 s, mira alrededor por su cuenta
  if (Math.abs(mouseNDC.x - _tvLastMouse.x) + Math.abs(mouseNDC.y - _tvLastMouse.y) > 0.002) {
    _tvLastMouse.x = mouseNDC.x; _tvLastMouse.y = mouseNDC.y; _tvLastMouse.t = t;
  }
  let gx = mouseNDC.x, gy = mouseNDC.y;
  if (t - _tvLastMouse.t > 3) {
    if (t > _tvGaze.next) { _tvGaze.tx = (Math.random() * 2 - 1) * 0.9; _tvGaze.ty = (Math.random() * 2 - 1) * 0.5; _tvGaze.next = t + 1.2 + Math.random() * 2; }
    _tvGaze.x += (_tvGaze.tx - _tvGaze.x) * Math.min(1, dt * 3);
    _tvGaze.y += (_tvGaze.ty - _tvGaze.y) * Math.min(1, dt * 3);
    gx = _tvGaze.x; gy = _tvGaze.y;
  } else { _tvGaze.x = mouseNDC.x; _tvGaze.y = mouseNDC.y; }

  head.rotation.x += (-gy * 0.25 - head.rotation.x) * 0.08;
  head.rotation.y += ((-Math.PI / 3) + gx * 0.5 - head.rotation.y) * 0.08;

  const eye = window.travelerEye;
  if (eye) {
    eye.pupil.position.x += (Math.max(-1, Math.min(1, gx)) * 0.12 - eye.pupil.position.x) * 0.2;
    eye.pupil.position.y += (0.02 + Math.max(-1, Math.min(1, gy)) * 0.015 - eye.pupil.position.y) * 0.2;

    // ojo abierto/cerrado: parpadea cada ~4 s, se entrecierra al agarrarlo o al impactar, se abre grande al caer
    let target = 1;
    if ((t % 4.3) < 0.12) target = 0.1;
    else if (dragging) target = 0.6;
    else if (_tvSquash > 0.08) target = 0.15;
    else if (falling) target = 1.5;
    eye.open += (target - eye.open) * Math.min(1, dt * 20);
    eye.pupil.scale.set(1, eye.open, 1);

    // color de la pupila según la máquina activa
    const mode = erratic ? 'e' : poetic ? 'p' : slow ? 'f' : 'n';
    if (mode !== eye.mode) {
      eye.mode = mode;
      eye.mat.color.setHex(mode === 'e' ? 0xff0000 : mode === 'p' ? 0xffffff : mode === 'f' ? 0x444444 : 0x00ffff);
      eye.mat.color.multiplyScalar(2.2);
    }
  }
}



// ============================================================
// ==========================================
// 🔥 POTENCIA CREADORA: SISTEMA GLOBAL DE TRAZOS
// ==========================================

let frames = 0; let lastTime = performance.now(); let lowFPSCount = 0;
let totalRotated = 0; let prevAngle = 0;

renderer.setAnimationLoop((timestamp, frame) => {
 // 🔥 ANIMACIÓN DEL VIAJERO (Libre y Arrastrable)
   
  const isXR = renderer.xr.isPresenting;
  const session = isXR ? renderer.xr.getSession() : null;
  const isAR = isXR && window.isARSession; 

  if (!isXR) { 
    if (window.spawnedObjects) {
      window.spawnedObjects.forEach(obj => {
        if (typeof vrGrabbedObject === 'undefined' || obj !== vrGrabbedObject) { 
          obj.rotation.y += 0.01;
        }
      });
    }
    if (shakeIntensity > 0) { 
      camera.position.x = (Math.random() - 0.5) * shakeIntensity; 
      camera.position.y = (Math.random() - 0.5) * shakeIntensity; 
      shakeIntensity -= 0.05; 
    } else { 
      if (camera.fov > targetFov) {
        camera.fov -= 5;
        if (camera.fov < targetFov) camera.fov = targetFov;
        camera.updateProjectionMatrix();
      } else if (camera.fov < targetFov) {
        camera.fov += 5;
        if (camera.fov > targetFov) camera.fov = targetFov;
        camera.updateProjectionMatrix();
      }
      camera.position.x = 0; camera.position.y = 0; 
    } 
  }
 
  if (isPaused && !isXR) return; 
  
  const now = performance.now(); frames++;
  if (now >= lastTime + 1000) { if((frames * 1000 / (now - lastTime)) < 30) lowFPSCount++; 
    // 🔥 ACTUALIZADOR DEL HUD DE COMBO EN TIEMPO REAL
  const comboUi = document.getElementById('combo-value');
  if (comboUi) comboUi.innerText = 'x' + (typeof combatCombo !== 'undefined' ? combatCombo : 0);
    else lowFPSCount = 0; if(lowFPSCount > 3 && isBloomEnabled) { isBloomEnabled = false; bloomPass.strength = 0; 
      document.getElementById('menu-bloom').innerText = '✨ Efecto Neón: OFF'; 
      document.getElementById('menu-bloom').style.color = '#888'; } frames = 0; lastTime = now; }

  if (isShooting && isGameStarted && !isUIOpen && !isAR) { if (now - lastShotTime > FIRE_COOLDOWN) { fireLaser(); lastShotTime = now; } }

 // LÓGICA DE ACTUALIZACIÓN AR (CORREGIDA)
if (isAR && frame && hitTestSource) {
    const referenceSpace = renderer.xr.getReferenceSpace();
    if (referenceSpace) {
        const hitTestResults = frame.getHitTestResults(hitTestSource);
        if (hitTestResults && hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(referenceSpace);
            if (pose) {
                reticle.visible = true;
                reticle.matrix.fromArray(pose.transform.matrix);
                // Animación sutil del reticle
                const scale = 1 + Math.sin(Date.now() * 0.015) * 0.1;
                reticle.scale.set(scale, scale, scale);
            } else {
                reticle.visible = false;
            }
        } else {
            reticle.visible = false;
        }
    }
}

  if (!isAR) {
    // ===============================================
      // 🔥 ANIMACIÓN DEL SISTEMA DAC (Retórica Procedimental)
      // ===============================================
      if (typeof planetaDAC !== 'undefined' && planetaDAC) {
        planetaDAC.rotation.y += 0.002;
        planetaDAC.rotation.z += 0.001;

        // 🔥 NUEVO: INTEGRACIÓN CON EL CARRUSEL (COMO NÚCLEO CENTRAL)
        if (!planetaDAC.userData.isIsolated) {
          if (isAligned) {
            // MODO CARRUSEL: Se posiciona en el centro de la rueda (0, 0, -10)
            planetaDAC.position.lerp(new THREE.Vector3(0, 0, -10), 0.05);
            planetaDAC.scale.lerp(new THREE.Vector3(0.55, 0.55, 0.55), 0.05);
          } else {
            // MODO CONSTELACIÓN: Vuelve a su lugar flotante en el espacio
            let target = planetaDAC.userData.savedPos ? planetaDAC.userData.savedPos : new THREE.Vector3(40, 0, -50);
            planetaDAC.position.lerp(target, 0.05);
            planetaDAC.scale.lerp(new THREE.Vector3(1, 1, 1), 0.05);
          }
        } else {
          // MODO AISLADO (AL HACER CLIC): Se clava al frente de la cámara
          planetaDAC.position.lerp(new THREE.Vector3(0, 0, 0), 0.1);
          planetaDAC.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
        }

        
   // 1. Efecto Poética: Lenta y contemplativa
      lunaPoetica.rotation.x += isPoeticaActive ? 0.015 : 0.005;
      lunaPoetica.rotation.y += isPoeticaActive ? 0.02 : 0.008;

      // 2. Efecto Errática: Tartamudeo espacial y rotación caótica
      if (isErraticaActive) {
        lunaErratica.position.x = -8 + (Math.random() - 0.5) * 0.4;
        lunaErratica.position.y = 6 + (Math.random() - 0.5) * 0.4;
        lunaErratica.rotation.y += 0.05; // Gira locamente
        if (Math.random() > 0.95) triggerSubtleGlitch();
      } else {
        lunaErratica.position.set(-8, 6, -8);
        lunaErratica.rotation.x -= 0.008;
        lunaErratica.rotation.z += 0.01;
      }

      // 3. Efecto Fricción: Temblor constante en la cámara y rotación densa
      lunaFriccion.rotation.x += 0.004;
      lunaFriccion.rotation.y += 0.002;
      if (isFriccionActive) {
        shakeIntensity = 0.08; // Micro-temblor constante
      }
      // ===============================================
      // 🔥 MOTOR GEOMÉTRICO (RED INTERACTIVA) - Unificado
      // ===============================================
      if (typeof dacNetworkGroup !== 'undefined' && dacNetworkGroup.visible) {
        try {
          raycaster.setFromCamera(mouseNDC, camera);

          // Plano anclado al planeta DAC
          let cameraDir = new THREE.Vector3();
          camera.getWorldDirection(cameraDir);
          let planeDAC = new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDir, planetaDAC.position);
          let targetPos = new THREE.Vector3();

          if (raycaster.ray.intersectPlane(planeDAC, targetPos)) {
            planetaDAC.worldToLocal(targetPos);
          } else {
            targetPos.set(0, 0, 0);
          }

          // Retórica del Pincel según máquina activa
          if (isFriccionActive) {
            dacBrush.position.lerp(targetPos, 0.015); // Pesado
            dacLinesMat.color.setHex(0xffff00);
            dacBrush.material.color.setHex(0xffff00);
          } else if (isErraticaActive) {
            dacBrush.position.copy(targetPos).add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 0)); // Tiembla
            dacLinesMat.color.setHex(0xff3300);
            dacBrush.material.color.setHex(0xff3300);
          } else {
            dacBrush.position.lerp(targetPos, 0.15); // Fluido
            dacLinesMat.color.setHex(isPoeticaActive ? 0xff00ff : 0x00ffff);
            dacBrush.material.color.setHex(isPoeticaActive ? 0xff00ff : 0x00ffff);
          }

          // Matemáticas de Nodos y Líneas
          let lineIndex = 0;
          const positions = dacParticlesGeo.attributes.position.array;
          const linePosArray = dacLinesGeo.attributes.position.array;
          const maxLineIndex = linePosArray.length;

          // 1. MOVER NODOS Y APLICAR FRICCIÓN
          for (let i = 0; i < dacParticleCount; i++) {
            let px = positions[i * 3];
            let py = positions[i * 3 + 1];
            let pz = positions[i * 3 + 2];
            let pData = dacParticleData[i];

            if (isErraticaActive) {
              px = pData.baseX + (Math.random() - 0.5) * 1.5;
              py = pData.baseY + (Math.random() - 0.5) * 1.5;
            } else {
              px += pData.velocity.x;
              py += pData.velocity.y;
              pz += pData.velocity.z;
              if (px > 8 || px < -8) pData.velocity.x *= -1;
              if (py > 8 || py < -8) pData.velocity.y *= -1;
              if (pz > 8 || pz < -8) pData.velocity.z *= -1;
            }

            if (isFriccionActive) {
              let distToBrush = dacBrush.position.distanceTo(new THREE.Vector3(px, py, pz));
              if (distToBrush < 4) {
                px += (px - dacBrush.position.x) * 0.05;
                py += (py - dacBrush.position.y) * 0.05;
              }
            }

            positions[i * 3] = px;
            positions[i * 3 + 1] = py;
            positions[i * 3 + 2] = pz;
          }

          // 2. CONECTAR PARTÍCULAS ENTRE SÍ
          const connectDist = 5;
          const revealRadius = 15.0;

          for (let i = 0; i < dacParticleCount; i++) {
            let px1 = positions[i * 3];
            let py1 = positions[i * 3 + 1];
            let pz1 = positions[i * 3 + 2];
            let dist1ToMouse = dacBrush.position.distanceTo(new THREE.Vector3(px1, py1, pz1));

            if (dist1ToMouse < revealRadius) {
              for (let j = i + 1; j < dacParticleCount; j++) {
                let px2 = positions[j * 3];
                let py2 = positions[j * 3 + 1];
                let pz2 = positions[j * 3 + 2];

                let dx = px1 - px2;
                let dy = py1 - py2;
                let dz = pz1 - pz2;
                let distNodes = Math.sqrt(dx * dx + dy * dy + dz * dz);

                if (distNodes < connectDist && lineIndex < maxLineIndex) {
                  linePosArray[lineIndex++] = px1;
                  linePosArray[lineIndex++] = py1;
                  linePosArray[lineIndex++] = pz1;
                  linePosArray[lineIndex++] = px2;
                  linePosArray[lineIndex++] = py2;
                  linePosArray[lineIndex++] = pz2;
                }
              }
            }
          }

          dacParticlesGeo.attributes.position.needsUpdate = true;
          dacLinesGeo.setDrawRange(0, lineIndex / 3);
          dacLinesGeo.attributes.position.needsUpdate = true;

         // 🔥 Revelar Palabras (Conceptos)
          dacWords.forEach((word) => {
            let dx = dacBrush.position.x - word.userData.basePos.x;
            let dy = dacBrush.position.y - word.userData.basePos.y;
            let dist2D = Math.sqrt(dx * dx + dy * dy);

            // 🔥 Aumentamos el radio visual a 25 para iluminarlas desde más lejos
            if (dist2D < 25) {
              word.visible = true;
              word.position.y = word.userData.basePos.y + Math.sin(Date.now() * 0.002 + word.id) * 0.4;

              if (isErraticaActive) {
                word.material.rotation = (Math.random() - 0.5) * 0.5;
                word.material.opacity = Math.random();
                word.material.color.setHex(0xff3300);
              } else {
                word.material.rotation = 0;
                word.material.opacity = Math.max(0.4, 1 - (dist2D / 25)); // Adaptamos el fade de opacidad a 25
                word.material.color.setHex(isPoeticaActive ? 0xff00ff : 0x00ffff);
              }
            } else {
              word.visible = false;
            }
          });
        } catch (err) {
          console.log("Esperando renderizado seguro...");
        }
      }

      // ===============================================
      // 🔥 POTENCIA CREADORA: PINTAR EL UNIVERSO
      // ===============================================
      if (window.isPainting && !isUIOpen && (isPoeticaActive || isErraticaActive || isFriccionActive)) {
        raycaster.setFromCamera(mouseNDC, camera);
        let globalPos = new THREE.Vector3();
        
        // 🔥 MAGIA: Extraemos la pintura exactamente a 35 unidades de distancia frente a la cámara. 
        // Ya no usan un plano, así NUNCA nacerán adentro del planeta.
        raycaster.ray.at(35, globalPos);

        let paintChance = isPoeticaActive ? 1.0 : 0.3;

        if (Math.random() < paintChance) {
          let pGeo, pMat, stroke;

       if (isPoeticaActive) {
            // 🔥 POÉTICA: Nodos minúsculos que construirán la Red (Ahora en Blanco Elegante)
            pGeo = new THREE.SphereGeometry(0.08, 6, 6);
            pMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
            stroke = new THREE.Mesh(pGeo, pMat);
            stroke.position.copy(globalPos);
            // Mayor dispersión al nacer para abrir la red
            stroke.position.x += (Math.random() - 0.5) * 2.0;
            stroke.position.y += (Math.random() - 0.5) * 2.0;
            stroke.position.z += (Math.random() - 0.5) * 1.0;
            
            // Vida y movimiento en las 3 direcciones para que la red fluya sola
            stroke.userData = { 
              type: 'poetica', 
              vx: (Math.random() - 0.5) * 0.02, 
              vy: (Math.random() - 0.5) * 0.02,
              vz: (Math.random() - 0.5) * 0.02
            };
          }
       else if (isErraticaActive) {
            // 🔥 ERRÁTICA: Agujas rojas afiladas (Esquirlas de cristal corrupto)
            pGeo = new THREE.ConeGeometry(0.08, 2.0, 3); // Base mínima, muy largas y de 3 caras (Picos perfectos)
            pMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
            stroke = new THREE.Mesh(pGeo, pMat);
            stroke.position.copy(globalPos);
            // Dispersión explosiva al nacer
            stroke.position.x += (Math.random() - 0.5) * 3.0;
            stroke.position.y += (Math.random() - 0.5) * 3.0;
            stroke.position.z += (Math.random() - 0.5) * 2.0;
            
            stroke.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            
            // Velocidad caótica
            stroke.userData = { 
              type: 'erratica', 
              vx: (Math.random() - 0.5) * 0.15, 
              vy: (Math.random() - 0.5) * 0.15,
              vz: (Math.random() - 0.5) * 0.15,
              baseRot: stroke.rotation.clone()
            };
          }
          else if (isFriccionActive) {
            // FRICCIÓN: Materia prima brutalista
            pGeo = new THREE.DodecahedronGeometry(0.6, 0);
            pMat = new THREE.MeshPhongMaterial({ color: 0xffff00, flatShading: true, shininess: 0 });
            stroke = new THREE.Mesh(pGeo, pMat);
            stroke.position.copy(globalPos);
            stroke.position.x += (Math.random() - 0.5) * 1.5;
            stroke.position.y += (Math.random() - 0.5) * 1.5;
            stroke.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
            stroke.userData = { type: 'friccion', vy: -0.05, rot: (Math.random()-0.5)*0.2 };
          }

          if (stroke) {
            paintGroup.add(stroke);
            paintStrokes.push(stroke);
            if (paintStrokes.length > 3000) {
              let old = paintStrokes.shift();
              paintGroup.remove(old);
              old.geometry.dispose(); old.material.dispose();
            }
            
            // 🔥 SONIDO AL PINTAR (Pulso de agua sutil)
            if (isPoeticaActive) {
              if (!window.lastPaintTime) window.lastPaintTime = 0;
              // El limitador (120ms) evita que la avalancha de partículas rompa el audio
              if (performance.now() - window.lastPaintTime > 120) {
                playSound('pulse', globalPos); // El sonido se emite desde el pincel 3D
                window.lastPaintTime = performance.now();
              }
            }
          }
        }
      }

  // ===============================================
      // 🔥 ANIMAR LA OBRA CREADA (Y TEJER LAS REDES)
      // ===============================================
      const poeticaNodes = []; // Lista para la red fluida
      const erraticaNodes = []; // Lista para la red de relámpagos

      for (let i = paintStrokes.length - 1; i >= 0; i--) {
        let p = paintStrokes[i];
        
        if (p.userData.type === 'poetica') {
          p.position.x += p.userData.vx; p.position.y += p.userData.vy; p.position.z += p.userData.vz;
          poeticaNodes.push(p); 
        }
        else if (p.userData.type === 'erratica') {
          // Movimiento violento y nervioso (se mueve a tirones)
          if (Math.random() > 0.5) {
            p.position.x += p.userData.vx; 
            p.position.y += p.userData.vy; 
            p.position.z += p.userData.vz;
          }
          // Rotación espasmódica
          if (Math.random() > 0.8) {
            p.rotation.set(
              p.userData.baseRot.x + (Math.random() - 0.5) * 1.5, 
              p.userData.baseRot.y + (Math.random() - 0.5) * 1.5, 
              p.userData.baseRot.z + (Math.random() - 0.5) * 1.5
            );
          }
          p.visible = Math.random() > 0.1; // Parpadea
          erraticaNodes.push(p);
        }
        else if (p.userData.type === 'friccion') {
          if (p.position.y > planetaDAC.position.y - 15) {
             p.position.y += p.userData.vy;
             p.userData.vy -= 0.008; 
             p.rotation.z += p.userData.rot;
          }
          if (Math.random() > 0.99) p.material.color.setHex(0xff0000);
          else if (Math.random() > 0.95) p.material.color.setHex(0xffaa00);
          else p.material.color.setHex(0xffff00);
        }
      }

      // 🔥 ALGORITMO 1: "RED NEURONAL" (POÉTICA)
      let pLineIdx = 0;
      const pLinePositions = poeticaLinesGeo.attributes.position.array;
      const maxConnectDistSqP = 12.25; 

      for (let i = 0; i < poeticaNodes.length; i++) {
        const n1 = poeticaNodes[i].position;
        for (let j = i + 1; j < poeticaNodes.length; j++) {
          const n2 = poeticaNodes[j].position;
          if (n1.distanceToSquared(n2) < maxConnectDistSqP) {
            if (pLineIdx < maxPoeticaLines * 6) { 
              pLinePositions[pLineIdx++] = n1.x; pLinePositions[pLineIdx++] = n1.y; pLinePositions[pLineIdx++] = n1.z;
              pLinePositions[pLineIdx++] = n2.x; pLinePositions[pLineIdx++] = n2.y; pLinePositions[pLineIdx++] = n2.z;
            }
          }
        }
      }
      poeticaLinesGeo.setDrawRange(0, pLineIdx / 3);
      poeticaLinesGeo.attributes.position.needsUpdate = true;

      // 🔥 ALGORITMO 2: "ARCOS ELÉCTRICOS ROTOS" (ERRÁTICA)
      let eLineIdx = 0;
      const eLinePositions = erraticaLinesGeo.attributes.position.array;
      const maxConnectDistSqE = 25.0; // Conecta a mayor distancia que la Poética

      for (let i = 0; i < erraticaNodes.length; i++) {
        const n1 = erraticaNodes[i].position;
        
        // Solo intentamos conectar a veces para dar ese efecto de "glitch" o chispa rota
        if (Math.random() > 0.4) {
            for (let j = i + 1; j < erraticaNodes.length; j++) {
              // La conexión es muy inestable (85% de probabilidad de romperse el rayo este frame)
              if (Math.random() > 0.85) { 
                  const n2 = erraticaNodes[j].position;
                  if (n1.distanceToSquared(n2) < maxConnectDistSqE) {
                    if (eLineIdx < maxErraticaLines * 6) { 
                      eLinePositions[eLineIdx++] = n1.x; eLinePositions[eLineIdx++] = n1.y; eLinePositions[eLineIdx++] = n1.z;
                      eLinePositions[eLineIdx++] = n2.x; eLinePositions[eLineIdx++] = n2.y; eLinePositions[eLineIdx++] = n2.z;
                    }
                  }
              }
            }
        }
      }
      erraticaLinesGeo.setDrawRange(0, eLineIdx / 3);
      erraticaLinesGeo.attributes.position.needsUpdate = true;

    } // Cierra el "if (isPainting...)" principal

    // ===============================================
    // 🔥 HOVER DE OBJETOS EN EL CANVAS
    // ===============================================
    if (isGameStarted && !isUIOpen && !isXR) {
      raycaster.setFromCamera(mouseNDC, camera);
      
      // 1. Agregamos al Viajero a la lista de detección del ratón
      const hoverTargets = [...categoryPlanets, ...discoveredVoyagers, ...ambientWhales, ...guardianCats, satHitbox, ...asteroids, planetaDAC];
      if (window.travelerGroup) hoverTargets.push(window.travelerGroup);
      
      const intersects = raycaster.intersectObjects(hoverTargets, true);
      const canvasEl = document.getElementById('bg-canvas');
      
      if (intersects.length > 0 && !intersects[0].object.userData.isAsteroid) {
        let obj = intersects[0].object;
        if (obj.type === 'Sprite') obj = obj.parent;
        while (obj.parent && obj.parent.type === 'Group') obj = obj.parent;

        // 2. MAGIA: Cursor especial de doble círculo para el Viajero
        if (obj === window.travelerGroup || (obj.userData && obj.userData.name === "viajero")) {
          // Cursor SVG codificado (Anillo exterior blanco 70% transparente, núcleo cian puro)
          const svgCursor = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='none' stroke='%23ffffff' stroke-width='1.5' opacity='0.7'/%3E%3Ccircle cx='16' cy='16' r='4' fill='%2300ffff' opacity='0.9'/%3E%3C/svg%3E";
          if (canvasEl) canvasEl.style.cursor = `url("${svgCursor}") 16 16, pointer`;
        } else {
          // La clásica "manita" para los planetas normales
          if (canvasEl) canvasEl.style.cursor = 'pointer';
        }

        // 3. Efecto de "aumento" visual al señalar (Protegemos al Viajero para que no se deforme al mirarlo)
        if (obj !== window.travelerGroup) {
          if (window.hoveredObject !== obj) {
            if (window.hoveredObject && window.hoveredObject !== window.travelerGroup) {
              window.hoveredObject.scale.copy(window.hoveredObject.userData.baseScaleVector || window.hoveredObject.scale);
            }
            window.hoveredObject = obj;
            if (!window.hoveredObject.userData.baseScaleVector) {
              window.hoveredObject.userData.baseScaleVector = window.hoveredObject.scale.clone();
            }
            window.hoveredObject.scale.set(
              window.hoveredObject.userData.baseScaleVector.x * 1.2,
              window.hoveredObject.userData.baseScaleVector.y * 1.2,
              window.hoveredObject.userData.baseScaleVector.z * 1.2
            );
          }
        }
      } else {
        // Volver al cursor de cruz en el vacío espacial
        if (canvasEl) canvasEl.style.cursor = 'crosshair';
        
        // Restaurar el tamaño de los planetas si quitas el ratón
        if (window.hoveredObject && window.hoveredObject !== window.travelerGroup) {
          if (window.hoveredObject.userData.baseScaleVector) {
            window.hoveredObject.scale.copy(window.hoveredObject.userData.baseScaleVector);
          }
          window.hoveredObject = null;
        }
      }
    }

    let pX = typeof mouseX !== 'undefined' ? mouseX : 0;
    let pY = typeof mouseY !== 'undefined' ? mouseY : 0;
    let parallaxSpeed = isUIOpen ? 0.002 : 0.02; 
    if (isFriccionActive) parallaxSpeed *= 0.05; // 🔥 ESTRELLAS EN CÁMARA LENTA
    particlesMesh.rotation.y += parallaxSpeed * ((pX * 0.001) - particlesMesh.rotation.y); 
    particlesMesh.rotation.x += parallaxSpeed * ((pY * 0.001) - particlesMesh.rotation.x); 
    particlesMesh.rotation.z += (isUIOpen ? 0.00002 : 0.0002);    
    if(hasShield) { shieldMesh.rotation.x += 0.05; shieldMesh.rotation.y += 0.05; }

    if (!isUIOpen) {
      if (scrollSpeedBoost > 0) scrollSpeedBoost -= 0.02; if (scrollSpeedBoost < 0) scrollSpeedBoost = 0;
      const positions = particlesGeo.attributes.position.array; 
      for (let i = 0; i < 1500; i++) { 
        positions[i * 3 + 2] += 0.005 + (scrollSpeedBoost * 2.0); 
        if (positions[i * 3 + 2] > 51) { 
          positions[i * 3 + 2] = -60; 
          positions[i * 3] = (Math.random() - 0.5) * 100; 
          positions[i * 3 + 1] = (Math.random() - 0.5) * 100; 
        } 
      } 
      particlesGeo.attributes.position.needsUpdate = true;      
      satelliteGroup.rotation.x += 0.01; satelliteGroup.rotation.y += 0.005; satelliteGroup.position.x += satelliteGroup.userData.vx; satelliteGroup.position.y += satelliteGroup.userData.vy; if (satelliteGroup.position.x > 30 || satelliteGroup.position.x < -30) satelliteGroup.userData.vx *= -1; if (satelliteGroup.position.y > 20 || satelliteGroup.position.y < -15) satelliteGroup.userData.vy *= -1;

      if (isBossBattle && bossEntity) {
        bossEntity.position.y += (15 - bossEntity.position.y) * 0.05; bossEntity.position.x = Math.sin(Date.now() * 0.001) * 20; bossEntity.rotation.y += 0.05;
        if (Math.random() > 0.95 && bossEntity.position.y < 16) { const elaser = new THREE.Mesh(enemyProjGeo, enemyProjMat); elaser.position.set(bossEntity.position.x, bossEntity.position.y - 3, 0); scene.add(elaser); enemyProjectiles.push(elaser); playSound('boss_hit', bossEntity.position); }
      }
      
      for (let i = enemyProjectiles.length - 1; i >= 0; i--) { 
        const el = enemyProjectiles[i]; el.position.y -= 0.6; 
        if (el.position.distanceTo(ship.position) < 2.0) { 
          if(hasShield) { 
            hasShield = false; shieldMesh.visible = false; playSound('explosion', ship.position); shakeIntensity = 0.5; 
          } else { 
            shakeIntensity = 1.0; playSound('damage', ship.position); 
            shipBody.material.uniforms.color.value.setHex(0xff0000); setTimeout(() => shipBody.material.uniforms.color.value.setHex(0x00ff00), 200);
            score -= 20; document.getElementById('score-value').innerText = score; 
            playerLives--; updateLivesUI(); if(playerLives <= 0) triggerGameOver();
          } 
          createExplosion(el.position.x, el.position.y, el.position.z); scene.remove(el); enemyProjectiles.splice(i, 1); 
        } else if (el.position.y < -30) { scene.remove(el); enemyProjectiles.splice(i, 1); } 
      }
      
      for (let i = asteroids.length - 1; i >= 0; i--) { 
        const a = asteroids[i]; a.position.y -= (a.userData.speedY + (scrollSpeedBoost * 0.5)); a.rotation.x += a.userData.rotX; a.rotation.y += a.userData.rotY; 
        if (a.position.distanceTo(ship.position) < (a.userData.radius + 0.8)) {          
          if(hasShield) { 
            hasShield = false; shieldMesh.visible = false; playSound('explosion', ship.position); shakeIntensity = 0.5; createExplosion(a.position.x, a.position.y, a.position.z); scene.remove(a); asteroids.splice(i, 1); 
          } else { 
            shakeIntensity = 0.8; playSound('damage', ship.position); createExplosion(ship.position.x, ship.position.y, ship.position.z); 
showSystemToast('IMPACTO DETECTADO. DAÑO ESTRUCTURAL.', '#cc0000');
shipBody.material.uniforms.color.value.setHex(0xff0000); 
setTimeout(() => shipBody.material.uniforms.color.value.setHex(0xffffff), 200);            scene.remove(a); asteroids.splice(i, 1); 
            playerLives--; updateLivesUI(); if(playerLives <= 0) triggerGameOver();
          } 
          continue; 
        } 
        if (a.position.y < -20) { scene.remove(a); asteroids.splice(i, 1); } 
      }
      for (let i = discoveredVoyagers.length - 1; i >= 0; i--) { const v = discoveredVoyagers[i]; v.position.y -= (0.1 + (scrollSpeedBoost * 0.5)); v.rotation.y += 0.03; if (v.position.y < -30) { scene.remove(v); discoveredVoyagers.splice(i, 1); } }
      for (let i = ambientWhales.length - 1; i >= 0; i--) { const w = ambientWhales[i]; w.position.y -= (w.userData.speedY + (scrollSpeedBoost * 0.5)); w.rotation.x += 0.01; w.rotation.y += 0.005; if (w.position.y < -30) { scene.remove(w); ambientWhales.splice(i, 1); } }
      for (let i = scrollKeywords.length - 1; i >= 0; i--) { const kw = scrollKeywords[i]; kw.position.y -= (0.05 + (scrollSpeedBoost * 0.4)); kw.position.x += Math.sin(Date.now() * 0.002 + kw.userData.id) * 0.02; if (kw.position.y < -30) { scene.remove(kw); scrollKeywords.splice(i, 1); } }
      
      for (let i = guardianCats.length - 1; i >= 0; i--) { 
        const c = guardianCats[i]; c.position.y -= (c.userData.speedY + (scrollSpeedBoost * 0.5)); c.rotation.y += c.userData.rotY;
        c.position.x += Math.sin(Date.now() * 0.001 + i) * 0.01;
        if (c.position.y < -35) { scene.remove(c); guardianCats.splice(i, 1); } 
      }

      for (let i = explosionParticles.length - 1; i >= 0; i--) { const p = explosionParticles[i]; p.position.x += p.userData.vx; p.position.y += p.userData.vy; p.position.z += p.userData.vz; p.userData.life -= 0.03; const s = Math.max(p.userData.life, 0.01); p.scale.set(s, s, s); if (p.userData.life <= 0) { scene.remove(p); explosionParticles.splice(i, 1); } }
      
 // ========================================================
      // 🔥 REEMPLAZA TODO EL BUCLE DE PROYECTILES POR ESTO 🔥
      // ========================================================
      
      // 1. Mover Cazas Enemigos (ZigZag)
      for (let i = fighters.length - 1; i >= 0; i--) {
        const f = fighters[i];
        f.position.y -= f.userData.speedY;
        f.position.x = f.userData.baseX + Math.sin(Date.now() * 0.003 + f.userData.phase) * 6; 
        
        if (f.position.distanceTo(ship.position) < 1.5) {
          if(hasShield) { hasShield = false; if(typeof shieldMesh !== 'undefined' && shieldMesh) shieldMesh.visible = false; } 
          else { 
            shakeIntensity = 0.8; playSound('damage', ship.position); 
            shipBody.material.uniforms.color.value.setHex(0xff0000); setTimeout(() => shipBody.material.uniforms.color.value.setHex(0xffffff), 200);
            playerLives--; if(typeof updateLivesUI === 'function') updateLivesUI(); if(playerLives <= 0) triggerGameOver();
if (typeof combatCombo !== 'undefined') combatCombo = Math.max(0, combatCombo - 5);    
        showSystemToast('IMPACTO: POTENCIA DE ARMA REDUCIDA', '#cc0000');
          }
          createExplosion(f.position.x, f.position.y, f.position.z); scene.remove(f); fighters.splice(i, 1);
          continue;
        }
        if (f.position.y < -30) { scene.remove(f); fighters.splice(i, 1); }
      }

      // 2. Mover Láseres y Detectar Colisiones
      for (let i = projectiles.length - 1; i >= 0; i--) {
        const laser = projectiles[i]; 
        laser.position.x += laser.userData.vx; 
        laser.position.y += laser.userData.vy; 
        let hit = false; 
        
        // A. Láser vs Jefe Final
        if (isBossBattle && bossEntity && laser.position.distanceTo(bossEntity.position) < 5.0) { 
           hit = true; bossHealth -= 1; playSound('boss_hit', bossEntity.position); shakeIntensity = 0.2; 
           if (typeof showFloatingText === 'function') showFloatingText('-1', '#ffffff', laser.position.x, laser.position.y, laser.position.z);
           bossEntity.children[0].material.uniforms.color.value.setHex(0xffffff); setTimeout(() => {if(bossEntity) bossEntity.children[0].material.uniforms.color.value.setHex(0xff0000)}, 100);
           document.getElementById('boss-hp-fill').style.width = (bossHealth / bossMaxHealth * 100) + '%'; 
           if (bossHealth <= 0) { 
  hasFoughtBoss = true; 
  isBossBattle = false; 
  playSound('explosion'); 
  createExplosion(bossEntity.position.x, bossEntity.position.y, bossEntity.position.z); 
  
  let bossBonus = 500 + (typeof combatCombo !== 'undefined' ? combatCombo * 10 : 0);
  
  // 🔥 GUARDAR PUNTAJE ANTES DE RESETEAR
  const finalScoreValue = score + bossBonus;
  console.log("🏆 VICTORIA - Puntaje final:", finalScoreValue);
  
  updateScore(bossBonus); 
  
  if (typeof showFloatingText === 'function') showFloatingText('+' + bossBonus + ' PTS (COMBO BONUS!)', '#ffaa00', 0, 35, 0);   
  
  scene.remove(bossEntity); 
  bossEntity = null;       
  document.getElementById('boss-ui').classList.add('hidden'); 
  
  isCombatActive = false;
  
  // Limpiar enemigos
  try {
    asteroids.forEach(a => { try { scene.remove(a); } catch(e) {} });
    asteroids.length = 0;
  } catch(e) {}
  
  try {
    enemyProjectiles.forEach(p => { try { scene.remove(p); } catch(e) {} });
    enemyProjectiles.length = 0;
  } catch(e) {}
  
  try {
    fighters.forEach(f => { try { scene.remove(f); } catch(e) {} });
    fighters.length = 0;
  } catch(e) {}
  
  try {
    if (typeof projectiles !== 'undefined') {
      projectiles.forEach(p => { try { scene.remove(p); } catch(e) {} });
      projectiles.length = 0;
    }
  } catch(e) {}
  
  const btnCombat = document.getElementById('combat-toggle-btn'); 
  if(btnCombat) { 
    btnCombat.innerText = '▶'; 
    btnCombat.style.borderColor = '#00ff00'; 
    btnCombat.style.color = '#00ff00'; 
  }
  
  if (typeof toggleCombatDimming === 'function') toggleCombatDimming(false);
  
  // REINICIO (después de guardar)
  score = 0;
  currentLevel = 1;
  combatCombo = 0;
  scrollSpeedBoost = 0;
  bossHealth = bossMaxHealth;
  if (typeof comboTimer !== 'undefined') clearTimeout(comboTimer);
  
  document.getElementById('score-value').innerText = score;
  document.getElementById('level-value').innerText = currentLevel;
  
  showSystemToast('🎉 ¡VICTORIA! Puntaje: ' + finalScoreValue, '#00ff00');
  
  // Mostrar leaderboard
  setTimeout(() => {
    try {
      const finalScoreDisplay = document.getElementById('final-score-display');
      if (finalScoreDisplay) finalScoreDisplay.innerText = finalScoreValue;
      openUIWindow('leaderboard-ui');
      updateLeaderboardUI();
      isCombatActive = false;
    } catch(e) {
      console.error("Error mostrando victoria:", e);
      showSystemToast('¡VICTORIA! Puntaje: ' + finalScoreValue, '#00ff00');
    }
  }, 150);
}
        }
        
        // B. Láser vs Cazas Enemigos
        if (!hit) {
          for (let j = fighters.length - 1; j >= 0; j--) {
            if (laser.position.distanceTo(fighters[j].position) < 2.0) {
              hit = true; let f = fighters[j]; f.userData.hp--; playSound('boss_hit', f.position);
              
              if(f.material && f.material.uniforms) {
                f.material.uniforms.color.value.setHex(0xffffff);
                setTimeout(() => { if(f && f.material) f.material.uniforms.color.value.setHex(0xff0000); }, 100);
              }
              
              if (typeof showFloatingText === 'function') showFloatingText('-1', '#ffffff', laser.position.x, laser.position.y, laser.position.z);
              
              if (f.userData.hp <= 0) {
                playSound('explosion', f.position); createExplosion(f.position.x, f.position.y, f.position.z);
                scene.remove(f); fighters.splice(j, 1); updateScore(300);
                if (typeof showFloatingText === 'function') showFloatingText('+30', '#ff0000', f.position.x, f.position.y, f.position.z);
                if (typeof combatCombo !== 'undefined') { combatCombo++; clearTimeout(comboTimer); comboTimer = setTimeout(() => { combatCombo = 0; }, 2000); }
              }
              break;
            }
          }
        }

        // C. Láser vs Asteroides
        if (!hit) {
          for (let k = asteroids.length - 1; k >= 0; k--) { 
            if (laser.position.distanceTo(asteroids[k].position) < (asteroids[k].userData.radius + 0.5)) { 
              hit = true; shakeIntensity = 0.4;    
              playSound('explosion', asteroids[k].position); createExplosion(asteroids[k].position.x, asteroids[k].position.y, asteroids[k].position.z); 
              
              if (asteroids[k].userData.isBounty) {
                playSound('levelup'); const rType = asteroids[k].userData.rewardType;
                if (rType === 'shield') { hasShield = true; if (typeof shieldMesh !== 'undefined' && shieldMesh) shieldMesh.visible = true; if(typeof showFloatingText === 'function') showFloatingText('ESCUDO', '#00ffff', asteroids[k].position.x, asteroids[k].position.y, asteroids[k].position.z); updateScore(200); } 
                else if (rType === 'life') { if (playerLives < 5) playerLives++; if (typeof updateLivesUI === 'function') updateLivesUI(); if(typeof showFloatingText === 'function') showFloatingText('+1 VIDA', '#ff00ff', asteroids[k].position.x, asteroids[k].position.y, asteroids[k].position.z); updateScore(200); } 
                else if (rType === 'points') { if(typeof showFloatingText === 'function') showFloatingText('+1500 PTS', '#ffaa00', asteroids[k].position.x, asteroids[k].position.y, asteroids[k].position.z); updateScore(1500); }
              } else {
                if (typeof combatCombo !== 'undefined') {
                  combatCombo++; 
                  let bonusPoints = 10 + (combatCombo * 2); 
                  updateScore(bonusPoints);
                  
                  // Texto flotante en el 3D
                  if(typeof showFloatingText === 'function') showFloatingText(`+${bonusPoints}`, '#00ffaa', asteroids[k].position.x, asteroids[k].position.y, asteroids[k].position.z);
                  
                  // 🔥 ¡EL REGRESO DEL AVISO DE COMBO! 🔥
                  if (combatCombo > 1 && combatCombo !== 5 && combatCombo !== 4) {
                    showSystemToast(`COMBO x${combatCombo} [ +${bonusPoints} PTS ]`, '#00ffaa');
                  }
                  
                  // Avisos de mejora de arma
                  if (combatCombo === 5) showSystemToast('ARMA ACTUALIZADA: DISPARO DOBLE', '#00ffff');
                  if (combatCombo === 10) showSystemToast('ARMA MAXIMIZADA: DISPARO TRIPLE', '#ff00ff');
                  
                  clearTimeout(comboTimer); 
                  comboTimer = setTimeout(() => { combatCombo = 0; }, 2000);
                } else { 
                  updateScore(10); 
                }
              }
              scene.remove(asteroids[k]); asteroids.splice(k, 1); break; 
            } 
          }
        }
        
        // D. Eliminar láser obsoleto
        if (hit || laser.position.y > 40 || laser.position.x > 40 || laser.position.x < -40) { 
           scene.remove(laser); projectiles.splice(i, 1); 
        }
      }
    } // <--- 🔥 ¡ESTA ES LA LLAVE MÁGICA QUE FALTABA! Cierra el bloque de exploración.



    let isVRMoving = false;
    let isVRShooting = false;

   if (isXR && session && session.mode === 'immersive-vr') {
      session.inputSources.forEach((source) => {
        if (source.gamepad && source.gamepad.axes.length >= 4) {
          // Joystick Izquierdo/Derecho: Eje X (Giro/Strafe) y Eje Y (Avanzar/Retroceder)
          const xAxis = source.gamepad.axes[2] || source.gamepad.axes[0]; 
          const yAxis = source.gamepad.axes[3] || source.gamepad.axes[1]; 
          
          // 🔥 VUELO LIBRE: Usamos la dirección hacia donde mira el casco
          if (Math.abs(xAxis) > 0.1 || Math.abs(yAxis) > 0.1) {
            const lookDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            lookDirection.y = 0; // Mantenemos el vuelo nivelado (no vuela hacia arriba/abajo cruzado)
            lookDirection.normalize();
            
            const strafeDirection = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            strafeDirection.y = 0;
            strafeDirection.normalize();

            // Velocidad de vuelo VR
            const flightSpeed = 0.4;
            
            // Avanzar / Retroceder
            if (Math.abs(yAxis) > 0.1) {
              userGroup.position.addScaledVector(lookDirection, -yAxis * flightSpeed);
            }
            // Desplazamiento lateral (Strafe)
            if (Math.abs(xAxis) > 0.1) {
              userGroup.position.addScaledVector(strafeDirection, xAxis * flightSpeed);
            }
          }
          
          // Detectar gatillo para disparar
          if (source.gamepad.buttons.length > 0) {
            if ((source.gamepad.buttons[0] && source.gamepad.buttons[0].pressed) || 
                (source.gamepad.buttons[4] && source.gamepad.buttons[4].pressed)) { 
              isVRShooting = true;
            }
          }
        }
      });
    }
    if (isVRShooting && isGameStarted && !isUIOpen && !isAR) {
      const nowTime = performance.now();
      if (nowTime - lastShotTime > FIRE_COOLDOWN) { 
        fireLaser(); 
        lastShotTime = nowTime; 
      }
    }

    if (!isVRMoving) { 
      if (keys.left && ship.position.x > -25) { ship.position.x -= shipSpeed; ship.rotation.z = 0.2; } 
      else if (keys.right && ship.position.x < 25) { ship.position.x += shipSpeed; ship.rotation.z = -0.2; } 
      else { ship.rotation.z = 0; }
    }

   // 🔥 MODO ZEN Y CARRUSEL 3D
    let planetSpeed = (isUIOpen || isAligned) ? 0.00002 : 0.0003; 
    if (isFriccionActive) planetSpeed *= 0.05; // 🔥 CÁMARA LENTA (FRICCIÓN)
    
    if (isAligned && !isUIOpen && typeof pX !== 'undefined') {
      targetCarouselAngle += (pX * 0.000005); 
    }
    
    if (typeof window.totalRotated === 'undefined') { window.totalRotated = 0; window.prevAngle = 0; }
    window.totalRotated += Math.abs(carouselAngleOffset - window.prevAngle);
    window.prevAngle = carouselAngleOffset;

    carouselAngleOffset += (targetCarouselAngle - carouselAngleOffset) * 0.1;
    
    let mouseWorldPos = new THREE.Vector3(0,0,0);
    raycaster.setFromCamera(mouseNDC, camera);
    let planeZ = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    let intersectPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(planeZ, intersectPoint)) {
      mouseWorldPos.copy(intersectPoint);
    }


    categoryPlanets.forEach((planet, index) => { 
      if (!planet.userData.targetPos) {
         planet.userData.targetPos = planet.position.clone();
         planet.userData.randomPos = planet.position.clone();
         planet.userData.baseY = planet.position.y; // Inicializar ancla
      }

      // 🔥 EL PLANETA SECRETO (La Anomalía)
      if (planet.userData.id === 999) {
        
        if (typeof secretDiscovered !== 'undefined' && !secretDiscovered) {
           planet.visible = false;
           if (!isAligned && Math.abs(userGroup.rotation.y) > 2.6) {
             secretDiscovered = true; 
             planet.visible = true;
             playSound('boss_hit'); 
showSystemToast('ANOMALÍA DETECTADA A TUS ESPALDAS', '#cc0000');           }
        }

        if (!secretDiscovered) {
           planet.userData.targetPos.set(0, 0, 80);
        } else if (isAligned) {
           let angle = (index / categoryPlanets.length) * Math.PI * 2 + carouselAngleOffset;
           let radius = window.innerWidth < 600 ? 20 : 22; 
           planet.userData.targetPos.set(Math.cos(angle)*radius, Math.sin(Date.now()*0.001)*1.5, Math.sin(angle)*radius - 10);
        } else {
           if (planet.userData.randomPos) {
             planet.userData.targetPos.copy(planet.userData.randomPos);
           }
        }

        planet.rotation.x += planetSpeed * 1.5; 
        planet.rotation.y += planetSpeed * 2.5; 
        
        if (typeof draggedPlanet === 'undefined' || planet !== draggedPlanet) {
          planet.position.lerp(planet.userData.targetPos, 0.08);
        }
        return; 
      }

      // 🔥 PLANETAS NORMALES
      planet.rotation.x += planetSpeed; 
      planet.rotation.y += planetSpeed * 2; 

      if (isAligned) {
        let activeCount = (typeof secretDiscovered !== 'undefined' && secretDiscovered) ? categoryPlanets.length : (categoryPlanets.length - 1); 
        let angle = (index / activeCount) * Math.PI * 2 + carouselAngleOffset;
        let radius = window.innerWidth < 600 ? 20 : 22; 
        planet.userData.targetPos.x = Math.cos(angle) * radius;
        planet.userData.targetPos.y = 0; // Y base del carrusel
        planet.userData.targetPos.z = Math.sin(angle) * radius - 10;
      } else {
        if (planet.userData.randomPos) {
          planet.userData.targetPos.copy(planet.userData.randomPos);
        }
        if (planet.userData.baseY === undefined) {
          planet.userData.baseY = planet.userData.targetPos.y;
        }
      }

      let finalX = planet.userData.targetPos.x;
      let finalY = planet.userData.targetPos.y;
      let finalZ = planet.userData.targetPos.z;

      // 🔥 APLICAR FLOTACIÓN BASADA EN EL ANCLA (SOLUCIÓN DEEPSEEK)
      if(!isUIOpen) {
        if (isAligned) {
          finalY += Math.sin((Date.now()*0.001) + index) * 1.5; 
        } else {
          // En constelación, el flote respeta el baseY que escogiste con tu ratón
          finalY = planet.userData.baseY + (Math.sin((Date.now()*0.001) + index) * 0.5); 
        }
      }

      if (!isNaN(finalX) && !isNaN(finalY) && !isNaN(finalZ)) {
        if (typeof draggedPlanet === 'undefined' || planet !== draggedPlanet) {
          planet.position.lerp(new THREE.Vector3(finalX, finalY, finalZ), 0.08);
        }
      }
// 🔥 EFECTO PARPADEO: Máquina Errática
      if (isErraticaActive && planet.userData.id !== 999 && planet.material) {
        if (Math.random() > 0.92) {
           planet.material.opacity = Math.random() * 0.5 + 0.1; // Caídas bruscas de luz
           planet.material.color.setHex(Math.random() > 0.5 ? 0xff0000 : 0x770000);
           planet.material.color.multiplyScalar(1.8);
        } else {
           planet.material.opacity = 0.9;
        }
      } else if (!isFriccionActive && planet.material && planet.userData.id !== 999) {
        // Mantiene la opacidad estable si no hay máquinas distorsionando
        planet.material.opacity = 0.95; 
      }
     
    });
 updateTraveler();  
if (!isAR) {
  energyWebGroup.visible = !isAligned; 
  
  if (!isAligned) {
    const time = Date.now() * 0.001;
    const activeCount = (typeof secretDiscovered !== 'undefined' && secretDiscovered) 
      ? categoryPlanets.length 
      : (categoryPlanets.length - 1);
    
    const pCore = planetaDAC;
    const SUBDIVISIONS = 10;         // pedacitos por línea
    const MAX_DIST = 60;             // 🔥 distancia máxima para conectar dos planetas
    const MAX_DIST_CORE = 90;        // 🔥 distancia máxima planeta→DAC
    
    // Lista de planetas válidos
    const validPlanets = [];
    for (let i = 0; i < activeCount; i++) {
      const p = categoryPlanets[i];
      if (p.userData.id === 999 && !secretDiscovered) continue;
      validPlanets.push(p);
    }
    
    webLines.forEach((line, lineIdx) => {
      const positions = line.geometry.attributes.position.array;
      const maxFloats = positions.length;
      let posIdx = 0;
      
      const linePhase = lineIdx * 1.7;
      const lineFreq = 0.8 + lineIdx * 0.15;
      // Cada hilo se especializa: unos conectan cerca, otros lejos
      const distMultiplier = 0.6 + (lineIdx / 5) * 0.8;
      const localMaxDist = MAX_DIST * distMultiplier;
      
      const drawWavyLine = (from, to, strength = 1.0) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        
        const amp = Math.min(dist * 0.06, 1.2) * strength;
        
        const perpX = -dy / (dist || 1);
        const perpY = dx / (dist || 1);
        
        let prevX = from.x, prevY = from.y, prevZ = from.z;
        
        for (let s = 1; s <= SUBDIVISIONS; s++) {
          const t = s / SUBDIVISIONS;
          
          let bx = from.x + dx * t;
          let by = from.y + dy * t;
          let bz = from.z + dz * t;
          
          const wave = Math.sin(t * Math.PI * 3 + time * lineFreq + linePhase) * Math.sin(t * Math.PI) * amp;
          
          bx += perpX * wave;
          by += perpY * wave;
          bz += Math.cos(t * Math.PI * 2 + time * lineFreq * 0.7 + linePhase) * amp * 0.5;
          
          if (posIdx + 6 <= maxFloats) {
            positions[posIdx++] = prevX;
            positions[posIdx++] = prevY;
            positions[posIdx++] = prevZ;
            positions[posIdx++] = bx;
            positions[posIdx++] = by;
            positions[posIdx++] = bz;
          }
          
          prevX = bx; prevY = by; prevZ = bz;
        }
      };
      
      // 🔥 CONEXIÓN POR DISTANCIA REAL
      for (let i = 0; i < validPlanets.length; i++) {
        const p1 = validPlanets[i];
        
        // Conectar con TODOS los planetas cercanos (no solo vecinos de lista)
        for (let j = i + 1; j < validPlanets.length; j++) {
          const p2 = validPlanets[j];
          const dist = p1.position.distanceTo(p2.position);
          
          if (dist < localMaxDist) {
            // Fuerza según cercanía: cerca = fuerte, lejos = débil
            const strength = 1.0 - (dist / localMaxDist) * 0.6;
            drawWavyLine(p1.position, p2.position, strength);
          }
        }
        
        // Conectar al núcleo DAC
        if (pCore) {
          const distToCore = p1.position.distanceTo(pCore.position);
          if (distToCore < MAX_DIST_CORE) {
            drawWavyLine(p1.position, pCore.position, 0.8);
          }
        }
      }
      
      line.geometry.setDrawRange(0, posIdx / 3);
      line.geometry.attributes.position.needsUpdate = true;
    });
  }
}
}

  // 🔥 4. ESCUDO PROTECTOR DE RENDERIZADO

  // 🔥 4. ESCUDO PROTECTOR DE RENDERIZADO
if (isXR) { 
    renderer.render(scene, camera); 
  } else { 
    try { composer.render(); } 
    catch(e) { renderer.render(scene, camera); } 
  }
});


// ==========================================
// LÓGICA DEL FORMULARIO DE CONTACTO (AJAX)
// ==========================================
const contactForm = document.getElementById('hacker-contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', async function(e) {
    e.preventDefault(); 
    const statusText = document.getElementById('form-status');
    const submitBtn = document.getElementById('btn-submit-contacto');
    
    statusText.style.display = 'block';
    statusText.style.color = '#ffff00';
    statusText.innerText = '> Encriptando y enviando transmisión...';
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.5';

    const formData = new FormData(contactForm);
    
    try {
      const formspreeLink = 'https://formspree.io/f/xojngrry'; 
      const response = await fetch(formspreeLink, {
        method: 'POST',
        body: formData,
        headers: { 'Accept': 'application/json' }
      });
      
      if (response.ok) {
        if (window.trackEvent) window.trackEvent('Contacto', 'Mensaje_Enviado_Exito');
        statusText.style.color = '#00ff00';
        statusText.innerText = '> Transmisión exitosa. Cerrando canal...';
       playSound('levelup');
    
    // 🔥 CERRAR LA VENTANA AUTOMÁTICAMENTE DESPUÉS DE GUARDAR
    setTimeout(() => {
      window.closeAllUIs();
    }, 2000);
        contactForm.reset(); 
        
        setTimeout(() => {
          window.closeAllUIs();
          statusText.style.display = 'none';
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
        }, 2000);
      } else {
        throw new Error('Error en el servidor');
      }
    } catch (error) {
      statusText.style.color = '#ff0000';
      statusText.innerText = '> Error de conexión. Interferencia detectada.';
      submitBtn.disabled = false;
      submitBtn.style.opacity = '1';
    }
  });
}
// ==========================================
// 🔥 SISTEMA DE BOTONES DE RADAR Y AYUDA PERMANENTE - MODIFICADO (JS LIMPIO)
// ==========================================

// 1. Botón de Centrar Vista (Radar)
const recenterBtn = document.createElement('button');
recenterBtn.innerHTML = '⌖';
recenterBtn.title = 'Centrar Vista';
recenterBtn.id = 'btn-recenter';
// 🔥 ELIMINAMOS inline style.cssText. Todo se controla por CSS.
document.body.appendChild(recenterBtn);

// 🔥 Lógica al hacer clic (Mantenemos la lógica de centrado)
recenterBtn.addEventListener('click', () => {
  if (typeof playSound === 'function') playSound('ui');
  
  // 1. Enderezamos la cámara si estamos en modo Constelación
  if (typeof userGroup !== 'undefined') {
    userGroup.rotation.set(0, 0, 0); 
  }
  
  // 2. Devolvemos el Carrusel a la posición inicial (Planeta 1 al frente)
  if (typeof targetCarouselAngle !== 'undefined') {
    targetCarouselAngle = 0; 
  }
  
  // Notificación de sistema en el idioma correcto
  const msg = (typeof window.currentLang === 'undefined' || window.currentLang === 'en') ? '> VIEW RECENTERED' : '> VISTA RECENTRADA';
  if (typeof showSystemToast === 'function') showSystemToast(msg, '#00ff00');
});

// 2. Botón de Ayuda Permanente (UX)
const helpBtn = document.createElement('button');
helpBtn.innerHTML = '?';
helpBtn.title = 'Ayuda / Tutorial';
helpBtn.id = 'helpBtn'; // 🔥 ID único para CSS
helpBtn.className = 'control-btn'; // 🔥 Mantenemos la clase de control para JS, ID para CSS
// 🔥 ELIMINAMOS inline style.cssText. Todo se controla por CSS.
document.body.appendChild(helpBtn);

// 🔥 Lógica de hover se mueve a CSS. Comentamos o eliminamos aquí.
// helpBtn.onmouseover = ...; helpBtn.onmouseout = ...;

helpBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // 🔥 ESCUDO: El clic muere aquí y no cierra la ventana
  e.preventDefault();
  if (typeof playSound === 'function') playSound('ui');
  if (typeof openUIWindow === 'function') openUIWindow('tutorial-ui'); // Vuelve a abrir el tutorial
});
// Animación hover para PC
recenterBtn.onmouseover = () => recenterBtn.style.background = 'rgba(0, 255, 0, 0.3)';
recenterBtn.onmouseout = () => recenterBtn.style.background = 'rgba(0, 255, 0, 0.1)';

// Función al hacer clic
recenterBtn.addEventListener('click', () => {
  playSound('ui');
  
  // 1. Enderezamos la cámara si estamos en modo Constelación
  if (typeof userGroup !== 'undefined') {
    userGroup.rotation.set(0, 0, 0); 
  }
  
  // 2. Devolvemos el Carrusel a la posición inicial (Planeta 1 al frente)
  if (typeof targetCarouselAngle !== 'undefined') {
    targetCarouselAngle = 0; 
  }
  
  // Notificación de sistema en el idioma correcto
  const msg = window.currentLang === 'en' ? '> VIEW RECENTERED' : '> VISTA RECENTRADA';
  showSystemToast(msg, '#00ff00');
});
// ==========================================
// OPTIMIZACIÓN PARA DISPOSITIVOS MÓVILES
// ==========================================
function setupMobileExperience() {
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0);
  
  if (isTouchDevice || window.innerWidth < 600) {
    console.log("> Sistema Móvil Detectado. Entrando en Modo Carrusel Automático.");
    shipSpeed = 0.35; 
    
    userGroup.position.set(0, 0, 30); // 🔥 Zoom IN 
    isAligned = true; 
    const menuAlignBtn = document.getElementById('menu-align');
    if(menuAlignBtn) menuAlignBtn.innerText = '☷ Vista: CARRUSEL 3D';
    
    const onboardingText = document.getElementById('onboarding-ui');
    if(onboardingText) onboardingText.innerHTML = '> DESLIZA PARA GIRAR EL CARRUSEL<br><span style="color:#00ffff;">> TOCA UN PLANETA PARA EXPLORAR</span>';
  }
}
setupMobileExperience();

// ==========================================
// SISTEMA MULTILENGUAJE (ES / EN)
// ==========================================
window.currentLang = sysPrefs.lang || 'es';

const dict = {
  es: {
    startBtn: "> EXPLORAR PORTAFOLIO _",
    skipBtn: "[ JUGAR MINIJUEGO ARCADIA ]",
    files: "ARCHIVOS",
    menuSys: "SISTEMA",
    menuProfile: "> Perfil_Usuario",
    menuContact: "> Enviar Transmisión",
    menuLeaderboard: "> Salón_de_Fama",
    menuBloomOn: "[*] Efecto Neón: ON",
    menuBloomOff: "[ ] Efecto Neón: OFF",
    menuAlignCar: "[O] Vista: CARRUSEL 3D",
    menuAlignCon: "[O] Vista: CONSTELACIÓN",
    headerSub: "// PORTAFOLIO INTERACTIVO",
    legendTitle: "> LEYENDA",
    scrollHint: "[ DESLIZA / SCROLL PARA EXPLORAR ↓ ]",
    profileTitle: "> PERFIL_USUARIO",
    btnCV: "📄 DESCARGAR CV",
    btnConnect: "✉ INICIAR CONEXIÓN",
    profileContent: `
      <p><strong style="color:#00ffff;">Nombre:</strong> Daniel [Rodríguez García]</p>
      <p><strong style="color:#00ffff;">Ocupación:</strong> Profesor Diseño Interactivo | Dir. GameLab Tadeo</p>
      <p><strong style="color:#00ffff;">Background:</strong> Diseñador Industrial (PUJ) con Máster en Creación de Videojuegos (UPF). Candidato a Doctorado en Diseño, Arte y Ciencia. Ex-coordinador MediaLab Cinemateca y Coordinador/Tallerista de Territorios Digitales con Plataforma Bogotá.</p>
      <p><strong style="color:#00ffff;">About:</strong> Mi preparación se enfoca en el diseño, creación y producción de videojuegos y experiencias interactivas inmersivas (Fulldome, VR, AR). Exploro las dimensiones críticas y sociales a través de los "Juegos Otros" y la pedagogía lúdica, integrando tecnologías físicas (Arduino, Raspberry Pi) y lógicas de diseño universal para la accesibilidad.</p>
      <p><strong style="color:#00ffff;">Skills:</strong> Game Mechanics, Creative Coding, TouchDesigner, Processing, Unity, Blender, FMOD, Physical Computing.</p>
      <p><strong style="color:#00ffff;">Redes:</strong> 
        <a href="https://www.linkedin.com/in/dargdesigner/" target="_blank" style="color: #ffaa00; text-decoration: none;">[LinkedIn ↗]</a> | 
        <a href="https://github.com/darg88" target="_blank" style="color: #ffaa00; text-decoration: none;">[GitHub ↗]</a>
      </p>
    `
  },
  en: {
    startBtn: "> EXPLORE PORTFOLIO _",
    skipBtn: "[ PLAY ARCADIA MINIGAME ]",
    files: "FILES",
    menuSys: "SYSTEM",
    menuProfile: "> User_Profile",
    menuContact: "> Send Transmission",
    menuLeaderboard: "> Hall_of_Fame",
    menuBloomOn: "[*] Neon Effect: ON",
    menuBloomOff: "[ ] Neon Effect: OFF",
    menuAlignCar: "[O] View: 3D CAROUSEL",
    menuAlignCon: "[O] View: CONSTELLATION",
    headerSub: "// INTERACTIVE PORTFOLIO",
    legendTitle: "> LEGEND",
    scrollHint: "[ SWIPE / SCROLL TO EXPLORE ↓ ]",
    profileTitle: "> USER_PROFILE",
    btnCV: "📄 DOWNLOAD CV",
    btnConnect: "✉ START CONNECTION",
    profileContent: `
      <p><strong style="color:#00ffff;">Name:</strong> Daniel [Rodríguez García]</p>
      <p><strong style="color:#00ffff;">Role:</strong> Interactive Design Professor | Dir. Tadeo GameLab</p>
      <p><strong style="color:#00ffff;">Background:</strong> Industrial Designer (PUJ) with a Master's in Video Game Creation (UPF). PhD Candidate in Design, Art and Science. Former MediaLab Cinemateca coordinator and Workshop Facilitator/Coordinator for Digital Territories with Plataforma Bogotá.</p>
      <p><strong style="color:#00ffff;">About:</strong> My background focuses on the design, creation, and production of video games and immersive interactive experiences (Fulldome, VR, AR). I explore critical and social dimensions through "Other Games" and playful pedagogy, integrating physical computing (Arduino, Raspberry Pi) and universal design principles for accessibility.</p>
      <p><strong style="color:#00ffff;">Skills:</strong> Game Mechanics, Creative Coding, TouchDesigner, Processing, Unity, Blender, FMOD, Physical Computing.</p>
      <p><strong style="color:#00ffff;">Socials:</strong> 
        <a href="https://www.linkedin.com/in/dargdesigner/" target="_blank" style="color: #ffaa00; text-decoration: none;">[LinkedIn ↗]</a> | 
        <a href="https://github.com/darg88" target="_blank" style="color: #ffaa00; text-decoration: none;">[GitHub ↗]</a>
      </p>
    `
  }
};

document.getElementById('lang-toggle-btn')?.addEventListener('click', (e) => {
  e.preventDefault(); e.currentTarget.blur();
  window.currentLang = window.currentLang === 'es' ? 'en' : 'es';
  e.currentTarget.innerText = window.currentLang === 'es' ? 'EN' : 'ES';
  playSound('ui');
  // 🔥 GUARDAR IDIOMA EN MEMORIA
  sysPrefs.lang = window.currentLang;
  localStorage.setItem('gamelab_prefs', JSON.stringify(sysPrefs));
  const lang = dict[window.currentLang];
  if(document.getElementById('start-btn')) document.getElementById('start-btn').innerText = lang.startBtn;
  if(document.getElementById('skip-btn')) document.getElementById('skip-btn').innerText = lang.skipBtn;
  if(document.getElementById('label-lives')) document.getElementById('label-lives').innerText = lang.hudLives;
  if(document.getElementById('label-files')) document.getElementById('label-files').innerText = lang.hudFiles;  
  if(document.getElementById('menu-about')) document.getElementById('menu-about').innerText = lang.menuProfile;
  if(document.getElementById('menu-contact')) document.getElementById('menu-contact').innerText = lang.menuContact;
  if(document.getElementById('menu-leaderboard')) document.getElementById('menu-leaderboard').innerText = lang.menuLeaderboard; // 🔥 NUEVO
  if(document.getElementById('menu-bloom')) document.getElementById('menu-bloom').innerText = isBloomEnabled ? lang.menuBloomOn : lang.menuBloomOff;
  if(document.getElementById('menu-align')) document.getElementById('menu-align').innerText = isAligned ? lang.menuAlignCar : lang.menuAlignCon;

  const sysTitle = document.querySelector('#side-menu h2');
  if (sysTitle) sysTitle.innerText = lang.menuSys;

  document.querySelectorAll('.menu-item[data-id]').forEach(item => {
    const id = parseInt(item.getAttribute('data-id'));
    const proj = categoryPlanetData.find(p => p.id === id);
    if(proj) {
      const pTitle = typeof proj.title === 'object' ? proj.title[window.currentLang] : proj.title;
      item.innerText = `${id}. ${pTitle}`;
    }
  });

  categoryPlanets.forEach(p => {
    if (p.children.length > 0) {
      p.remove(p.children[0]); 
      const hexStr = '#' + p.userData.color.toString(16).padStart(6, '0');
      const pTitle = typeof p.userData.title === 'object' ? p.userData.title[window.currentLang] : p.userData.title;
      const statusStr = p.userData.visited ? (window.currentLang === 'es' ? ' [ VISTO ]' : ' [ VIEWED ]') : '';
      const newLabel = createTextSprite(`> ${p.userData.id}. ${pTitle}${statusStr}`, p.userData.visited ? '#555555' : hexStr);
      newLabel.position.set(0, 5, 0);
      p.add(newLabel);
    }
  });

  const headerSub = document.querySelector('#portfolio-header span');
  if (headerSub) headerSub.innerText = lang.headerSub;
  const legendTitle = document.querySelector('#legend-header span:first-child');
  if (legendTitle) legendTitle.innerText = lang.legendTitle;
  const scrollH = document.getElementById('scroll-hint');
  if (scrollH) scrollH.innerText = lang.scrollHint;

  const aboutTitle = document.querySelector('#about-ui h2');
  if (aboutTitle) aboutTitle.innerText = lang.profileTitle;
  const cvBtn = document.querySelector('#about-ui a[href*="CV_Daniel"]');
  if (cvBtn) cvBtn.innerText = lang.btnCV;

  document.querySelectorAll('#about-ui button').forEach(btn => {
    if(!btn.classList.contains('close-btn')) {
      btn.innerText = lang.btnConnect;
    }
  });

  const profileTextContainer = document.querySelector('#about-ui div[style*="color: #ddd"]');
  if (profileTextContainer) profileTextContainer.innerHTML = lang.profileContent;

  const contactTitle = document.querySelector('#contact-ui h2');
  if (contactTitle) contactTitle.innerText = window.currentLang === 'es' ? '> TRANSMISIÓN_ENTRANTE' : '> INCOMING_TRANSMISSION';
  const contactSubmit = document.getElementById('btn-submit-contacto');
  if (contactSubmit) contactSubmit.innerText = window.currentLang === 'es' ? 'ENVIAR PAQUETE' : 'SEND DATA PACKET';
});
// 🔥 EVENTO DEL BOTÓN DE AYUDA
document.getElementById('btn-help')?.addEventListener('click', (e) => {
  e.stopPropagation(); 
  e.preventDefault();
  playSound('ui');
  openUIWindow('tutorial-ui'); 
}); // <--- ¡Esta llave de cierre era la que faltaba!

// ==========================================
// 🔥 SISTEMA DE LEYENDA DESPLEGABLE (CORREGIDO Y FORZADO)
// ==========================================
const legendHeader = document.getElementById('legend-header');
if (legendHeader) {
  legendHeader.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation(); // 🔥 DETIENE EL CLIC: Evita que el 3D u otros elementos lo absorban
    
    // Obtenemos el elemento padre completo de la leyenda
    const legendParent = document.getElementById('universe-legend');
    if (!legendParent) return;

    // Conmutamos la clase que definimos en el CSS
    legendParent.classList.toggle('legend-open');
    
    // Actualizamos el icono [+] o [-]
    const icon = document.getElementById('legend-icon');
    if (icon) {
      if (legendParent.classList.contains('legend-open')) {
        icon.innerText = '[-]';
      } else {
        icon.innerText = '[+]';
      }
    }
    
    // Sonido
    if (typeof playSound === 'function') playSound('ui');
  });
}
// ==========================================
// 🔥 TEXTOS FLOTANTES Y ENEMIGOS MENORES
// ==========================================
function showFloatingText(msg, colorHex, x, y, z) {
  const el = document.createElement('div');
  el.innerText = msg;
  el.style.position = 'fixed';
  el.style.color = colorHex;
  
  // 🔥 Estilo artístico, tipografía delgada y resplandor sutil
  el.style.textShadow = `0 0 15px ${colorHex}80`;
  el.style.fontFamily = "'-apple-system', sans-serif";
  el.style.fontWeight = '300';
  el.style.letterSpacing = '2px';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '9999';
  el.style.transition = 'all 1.5s cubic-bezier(0.1, 0.8, 0.3, 1)';
  
  // Proyectar coordenadas 3D a la pantalla 2D
  const vector = new THREE.Vector3(x, y, z);
  vector.project(camera);
  const xPos = (vector.x * 0.5 + 0.5) * window.innerWidth;
  const yPos = (vector.y * -0.5 + 0.5) * window.innerHeight;
  
  el.style.left = `${xPos}px`;
  el.style.top = `${yPos}px`;
  document.body.appendChild(el);
  
  // Animar hacia arriba lentamente difuminándose
  setTimeout(() => { 
    el.style.top = `${yPos - 60}px`; 
    el.style.opacity = '0'; 
    el.style.transform = 'scale(1.1)';
  }, 50);
  setTimeout(() => { if(el.parentNode) el.parentNode.removeChild(el); }, 1550);
}


// ==========================================
// 🔥 VALIDACIÓN EN TIEMPO REAL (FORMULARIOS)
// ==========================================
const nameInput = document.querySelector('input[name="identificacion"]');
const emailInput = document.querySelector('input[name="email"]');
const msgInput = document.querySelector('textarea[name="mensaje"]');
const submitBtn = document.getElementById('btn-submit-contacto');

function validateContactForm() {
  if (!nameInput || !emailInput || !msgInput) return;
  
  // 🔥 El .trim() obliga a que sean letras reales, ignorando los espacios en blanco
  const isNameValid = nameInput.value.trim().length >= 3;
  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value.trim()); 
  const isMsgValid = msgInput.value.trim().length >= 10; 
  
  const applyStyle = (el, isValid) => {
    const color = isValid ? '#00ffaa' : (el.value.trim().length > 0 ? '#cc0000' : 'rgba(255,255,255,0.2)');
    el.style.setProperty('border-color', color, 'important');
    el.style.setProperty('box-shadow', isValid ? '0 0 5px rgba(0,255,170,0.3)' : 'none', 'important');
  };

  applyStyle(nameInput, isNameValid);
  applyStyle(emailInput, isEmailValid);
  applyStyle(msgInput, isMsgValid);
  
  if (isNameValid && isEmailValid && isMsgValid) {
    submitBtn.disabled = false;
    submitBtn.style.setProperty('opacity', '1', 'important');
    submitBtn.style.setProperty('border-color', '#00ffaa', 'important');
    submitBtn.style.setProperty('color', '#000000', 'important');
    submitBtn.style.setProperty('background', '#00ffaa', 'important');
  } else {
    submitBtn.disabled = true;
    submitBtn.style.setProperty('opacity', '0.4', 'important');
    submitBtn.style.setProperty('border-color', '#cc0000', 'important');
    submitBtn.style.setProperty('color', '#cc0000', 'important');
    submitBtn.style.setProperty('background', 'transparent', 'important');
  }
}

if (nameInput && emailInput && msgInput) {
  nameInput.addEventListener('input', validateContactForm);
  emailInput.addEventListener('input', validateContactForm);
  msgInput.addEventListener('input', validateContactForm);
  
  // 🔥 ESCUDO ANTI-JUEGO: Evita que el portafolio robe la tecla de espacio
  nameInput.addEventListener('keydown', (e) => e.stopPropagation());
  emailInput.addEventListener('keydown', (e) => e.stopPropagation());
  msgInput.addEventListener('keydown', (e) => e.stopPropagation());
  
  validateContactForm(); 
  
  // ==========================================
// 🔥 LÓGICA DE LA NUEVA BARRA IZQUIERDA (LEYENDA)
// ==========================================
const legendSidebar = document.getElementById('legend-sidebar');
const legendToggleBtn = document.getElementById('legend-toggle-btn');
const rightSideMenu = document.getElementById('side-menu');

if (legendToggleBtn && legendSidebar) {
  legendToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.currentTarget.blur();
    
    // Si la barra está cerrada, la abrimos
    if (legendSidebar.style.transform === 'translateX(-100%)' || legendSidebar.style.transform === '') {
      legendSidebar.style.transform = 'translateX(0)';
      legendToggleBtn.innerText = '[-] CERRAR';
      legendToggleBtn.style.background = 'rgba(200, 0, 0, 0.8)'; // Rojo táctico
      
      // Cerramos el menú derecho si estaba abierto para evitar choques
      if (rightSideMenu) rightSideMenu.classList.remove('open');
      
      if (typeof playSound === 'function') playSound('ui');
    } else {
      // Si está abierta, la cerramos
      legendSidebar.style.transform = 'translateX(-100%)';
      legendToggleBtn.innerText = '[+] LEYENDA';
      legendToggleBtn.style.background = 'rgba(0,0,0,0.8)';
      if (typeof playSound === 'function') playSound('ui');
    }
  });
}

// 🔥 Modificamos el click global para que cierre también las barras si tocas fuera
window.addEventListener('click', (e) => {
  // Cierra el menú derecho
  if (rightSideMenu && rightSideMenu.classList.contains('open') && !e.target.closest('#side-menu') && !e.target.closest('#menu-toggle')) { 
    rightSideMenu.classList.remove('open'); 
  }
  // Cierra la leyenda izquierda
  if (legendSidebar && legendSidebar.style.transform === 'translateX(0)' && !e.target.closest('#legend-sidebar') && !e.target.closest('#legend-toggle-btn')) {
    legendSidebar.style.transform = 'translateX(-100%)';
    if(legendToggleBtn) {
      legendToggleBtn.innerText = '[+] LEYENDA';
      legendToggleBtn.style.background = 'rgba(0,0,0,0.8)';
    }
  }
});
// ==========================================
// 🔥 MOTOR DE JUEGOS OTROS: RETÓRICA PROCEDIMENTAL
// ==========================================
const btnPoetica = document.getElementById('btn-maquina-poetica');
const btnErratica = document.getElementById('btn-maquina-erratica');
const btnFriccion = document.getElementById('btn-maquina-friccion');
const dacDisplay = document.getElementById('dac-display');
const dacStatus = document.getElementById('dac-status-text');
const rawCanvas = document.getElementById('dac-raw-canvas');
const heavyCursor = document.getElementById('dac-heavy-cursor');
const glitchTexts = document.querySelectorAll('.dac-glitch-text');
let erraticaTimer = null;



// Contexto de la matriz de datos crudos (Poética)
let rawCtx = null;
if (rawCanvas) {
  rawCanvas.width = rawCanvas.offsetWidth;
  rawCanvas.height = rawCanvas.offsetHeight;
  rawCtx = rawCanvas.getContext('2d');
}

// Lógica del Cursor Pesado (Fricción Somática)
let targetMouseX = 0, targetMouseY = 0;
let currentMouseX = 0, currentMouseY = 0;

document.getElementById('dac-microsite')?.addEventListener('mousemove', (e) => {
  const rect = document.getElementById('dac-microsite').getBoundingClientRect();
  targetMouseX = e.clientX - rect.left;
  targetMouseY = e.clientY - rect.top;

  // Si la máquina poética está activa, pintamos pixeles crudos
  if (isPoeticaActive && rawCtx) {
    rawCtx.fillStyle = `rgba(${Math.random()*255}, 0, ${Math.random()*255}, 0.8)`;
    rawCtx.fillRect(targetMouseX, targetMouseY - 150, Math.random()*20, Math.random()*20);
  }
});

function animateFriction() {
  if (isFriccionActive && heavyCursor) {
    // Lerp (retraso elástico) para simular inercia y peso material
    currentMouseX += (targetMouseX - currentMouseX) * 0.05;
    currentMouseY += (targetMouseY - currentMouseY) * 0.05;
    heavyCursor.style.transform = `translate(${currentMouseX}px, ${currentMouseY}px)`;
  }
  requestAnimationFrame(animateFriction);
}
animateFriction();

if (btnPoetica && btnErratica && btnFriccion) {
  
  // [1] MÁQUINA POÉTICA: Nube de puntos y afecto visual
  btnPoetica.addEventListener('click', () => {
    if (typeof playSound === 'function') playSound('ui');
    isPoeticaActive = !isPoeticaActive;
    
    if (isPoeticaActive) {
      dacStatus.innerHTML = "> MATRIZ DE DATOS CRUDOS EXPUESTA.<br>Dibuja sobre el vacío.";
      dacStatus.style.color = '#f0e2f0';
      btnPoetica.style.background = 'rgba(255, 0, 255, 0.2)';
    } else {
      btnPoetica.style.background = 'transparent';
      if(rawCtx) rawCtx.clearRect(0, 0, rawCanvas.width, rawCanvas.height);
    }
  });

  // [2] MÁQUINA ERRÁTICA: Glitch estructural y tartamudeo HTML
  btnErratica.addEventListener('mouseover', () => {
    // El botón huye del usuario (negativa a obedecer)
    if (isErraticaActive) {
      btnErratica.style.transform = `translate(${(Math.random()-0.5)*100}px, ${(Math.random()-0.5)*50}px)`;
    }
  });

  btnErratica.addEventListener('click', () => {
    if (typeof playSound === 'function') playSound('damage');
    isErraticaActive = !isErraticaActive;
    
    if (isErraticaActive) {
      btnErratica.style.background = 'rgba(255, 51, 0, 0.2)';
      dacStatus.innerHTML = "> ESTÉTICA DEL ERROR.<br>Interrupción de la invisibilidad de la mediación.";
      dacStatus.style.color = '#ff3300';
      
      // Inicia la corrupción de textos
      erraticaTimer = setInterval(() => {
        glitchTexts.forEach(el => {
          if(Math.random() > 0.7) {
            const original = el.innerText;
            const glitchChar = String.fromCharCode(33 + Math.random() * 94);
            const pos = Math.floor(Math.random() * original.length);
            el.innerText = original.substring(0, pos) + glitchChar + original.substring(pos + 1);
          }
        });
        if (typeof triggerSubtleGlitch === 'function') triggerSubtleGlitch();
      }, 150);
    } else {
      btnErratica.style.background = 'transparent';
      btnErratica.style.transform = 'none';
      clearInterval(erraticaTimer);
      // Forzar recarga de los textos originales cerrando y abriendo
      showSystemToast('> REINICIANDO CAJA NEGRA', '#00ffcc');
    }
  });

  // [3] MÁQUINA DE FRICCIÓN: Resistencia táctil y peso
  btnFriccion.addEventListener('click', () => {
    if (typeof playSound === 'function') playSound('boss_hit');
    isFriccionActive = !isFriccionActive;
    
    if (isFriccionActive) {
      btnFriccion.style.background = 'rgba(255, 255, 0, 0.2)';
      dacStatus.innerHTML = "> FRICCIÓN MATERIAL DETECTADA.<br>El sistema exige negociación somática.";
      dacStatus.style.color = '#ffff00';
      
      // Ocultar cursor del sistema, mostrar cursor pesado
      document.getElementById('dac-microsite').style.cursor = 'none';
      heavyCursor.style.display = 'block';
      if (typeof shakeIntensity !== 'undefined') shakeIntensity = 0.5;
    } else {
      btnFriccion.style.background = 'transparent';
      document.getElementById('dac-microsite').style.cursor = 'crosshair';
      heavyCursor.style.display = 'none';
    }
  });
}
}
// 🔥 EFECTO DE ONDA Y SONIDO GLOBAL AL HACER CLIC
window.addEventListener('click', (e) => {
  // 1. Crear el anillo visual (Onda de agua)
  const ripple = document.createElement('div');
  ripple.className = 'water-ripple';
  ripple.style.left = `${e.clientX}px`;
  ripple.style.top = `${e.clientY}px`;
  document.body.appendChild(ripple);
  
  // Limpiar el elemento después de la animación
  setTimeout(() => { if(ripple.parentNode) ripple.parentNode.removeChild(ripple); }, 800);
  
  // 2. Reproducir el sonido melódico
  // Solo suena si NO hiciste clic en un botón, para evitar que los sonidos se encimen
  if (!e.target.closest('button') && !e.target.closest('a') && !e.target.closest('.modal-ui')) {
    if (typeof playSound === 'function') playSound('ui'); 
  }
});