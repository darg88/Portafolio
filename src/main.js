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
                    arMsg.innerHTML = 'AR disponible SOLO en dispositivos móviles';
                    arMsg.style.cssText = 'position: fixed; bottom: 20px; right: 20px; background: rgba(255,255,255,0.04); backdrop-filter: blur(6px); color: #cfcfd8; font-size: 0.7rem; padding: 8px 12px; border-left: 1px solid rgba(255,255,255,0.35); font-family: -apple-system, Helvetica, Arial, sans-serif; letter-spacing: 0.08em; font-weight: 300; z-index: 100000; pointer-events: none; backdrop-filter: blur(5px);';
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

// ==========================================
// ⚠️ AVISO DE SEGURIDAD AR / VR
//   Se muestra ANTES de pedir la sesión. La sesión se solicita desde el clic del botón "Entrar" del aviso (así se conserva
//   el gesto de usuario que exigen los navegadores). Sale con ESC o CANCELAR. Opción "no volver a mostrar en esta sesión".
// ==========================================
const XR_SAFETY = {
  ar: {
    es: { k: 'AVISO DE SEGURIDAD  ·  REALIDAD AUMENTADA', items: [
      'Revisa tu entorno. Despeja el espacio y evita escaleras, bordes, tráfico, agua y objetos frágiles.',
      'No camines mirando solo la pantalla. Detente cuando necesites mirar con atención.',
      'Sujeta el dispositivo con firmeza y mantén distancia de personas, animales y objetos.',
      'Esta experiencia incluye destellos y efectos de glitch. Si tienes sensibilidad a la luz, o sientes mareo o fatiga visual, detente.',
      'Haz pausas. Para salir en cualquier momento, toca de nuevo el botón AR.'] },
    en: { k: 'SAFETY NOTICE  ·  AUGMENTED REALITY', items: [
      'Look around you. Clear the space and avoid stairs, edges, traffic, water and fragile objects.',
      'Do not walk while looking only at the screen. Stop when you need to look carefully.',
      'Hold the device firmly and keep your distance from people, animals and objects.',
      'This experience includes flashes and glitch effects. If you are sensitive to light, or feel dizzy or eye strain, stop.',
      'Take breaks. To leave at any time, tap the AR button again.'] }
  },
  vr: {
    es: { k: 'AVISO DE SEGURIDAD  ·  REALIDAD VIRTUAL', items: [
      'Usa un área despejada y define el límite de seguridad de tu casco. Retira cables, muebles y objetos frágiles.',
      'Si eres propenso al mareo, usa la experiencia sentado/a: el movimiento virtual puede causar náuseas.',
      'No la uses cerca de escaleras, ventanas, mascotas o personas. Avisa a quienes estén cerca.',
      'Esta experiencia incluye destellos y efectos de glitch. Si tienes sensibilidad a la luz, o sientes mareo, náuseas o fatiga visual, quítate el casco y descansa.',
      'Haz pausas y respeta la edad mínima recomendada por el fabricante de tu casco. Para salir, usa el menú de tu casco.'] },
    en: { k: 'SAFETY NOTICE  ·  VIRTUAL REALITY', items: [
      'Use a clear area and set your headset\'s safety boundary. Remove cables, furniture and fragile objects.',
      'If you are prone to motion sickness, use the experience seated: virtual movement can cause nausea.',
      'Do not use it near stairs, windows, pets or people. Let those nearby know.',
      'This experience includes flashes and glitch effects. If you are sensitive to light, or feel dizzy, nauseous or eye strain, remove the headset and rest.',
      'Take breaks and respect the minimum age recommended by your headset\'s manufacturer. To leave, use your headset\'s menu.'] }
  }
};

function xrBlockedByGame() {                      // no se puede entrar a AR/VR en medio de un Juego Otro
  if (window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive || window.isMiniIntro || (window.MG && window.MG.pending)) {
    if (typeof showSystemToast === 'function') showSystemToast(window.currentLang === 'en' ? 'Leave the game before entering AR / VR' : 'Sal del juego antes de entrar a AR / VR', '#f7f4ed');
    return true;
  }
  return false;
}

function xrSafetyNotice(mode, onAccept) {
  try { if (sessionStorage.getItem('xr_ack_' + mode) === '1') { onAccept(); return; } } catch (e) {}
  const en = window.currentLang === 'en', T = XR_SAFETY[mode][en ? 'en' : 'es'];
  const veil = document.createElement('div');
  veil.setAttribute('role', 'dialog'); veil.setAttribute('aria-modal', 'true'); veil.setAttribute('aria-label', T.k);
  veil.style.cssText = 'position:fixed; inset:0; z-index:100060; display:flex; align-items:center; justify-content:center; padding:20px; box-sizing:border-box; ' +
    'opacity:0; transition:opacity .5s ease; color:#e7e4de; font-family:-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif; ' +
    'background:radial-gradient(ellipse at center, rgba(8,8,12,0.9), rgba(3,3,6,0.96)); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); overflow:auto;';
  const col = document.createElement('div');
  col.style.cssText = 'max-width:min(92vw,560px); margin:auto;';
  const kk = document.createElement('div'); kk.textContent = T.k;
  kk.style.cssText = 'font-size:0.64rem; font-weight:300; letter-spacing:0.36em; color:#d9c28a; text-align:center; line-height:1.8;';
  const tt = document.createElement('div'); tt.textContent = en ? 'Before you enter' : 'Antes de entrar';
  tt.style.cssText = 'margin:14px 0 22px; font-size:1.5rem; font-weight:200; letter-spacing:0.18em; text-align:center;';
  const list = document.createElement('div');
  list.style.cssText = 'display:flex; flex-direction:column; gap:12px;';
  T.items.forEach(s => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:12px; font-size:0.88rem; font-weight:300; line-height:1.75; letter-spacing:0.03em; color:#cfd0d4;';
    const dot = document.createElement('span'); dot.textContent = '—'; dot.style.cssText = 'color:#8a867f; flex:none;';
    const tx = document.createElement('span'); tx.textContent = s;
    row.appendChild(dot); row.appendChild(tx); list.appendChild(row);
  });
  const chkRow = document.createElement('label');
  chkRow.style.cssText = 'display:flex; align-items:center; gap:10px; margin-top:22px; font-size:0.72rem; font-weight:300; letter-spacing:0.08em; color:#8a867f; cursor:pointer;';
  const chk = document.createElement('input'); chk.type = 'checkbox';
  const chkTx = document.createElement('span'); chkTx.textContent = en ? 'Do not show again this session' : 'No volver a mostrar en esta sesión';
  chkRow.appendChild(chk); chkRow.appendChild(chkTx);
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-top:26px;';
  const mkBtn = (txt, primary) => {
    const b = document.createElement('button'); b.textContent = txt;
    b.style.cssText = 'font-family:inherit; font-size:0.68rem; font-weight:300; letter-spacing:0.26em; padding:12px 22px; cursor:pointer; border-radius:0; ' +
      (primary ? 'background:rgba(231,228,222,0.12); border:1px solid rgba(231,228,222,0.5); color:#e7e4de;' : 'background:transparent; border:1px solid rgba(255,255,255,0.16); color:#a8a49c;');
    return b;
  };
  const bOk = mkBtn(en ? 'UNDERSTOOD · ENTER' : 'ENTENDIDO · ENTRAR', true), bNo = mkBtn(en ? 'CANCEL' : 'CANCELAR', false);
  btns.appendChild(bNo); btns.appendChild(bOk);
  col.appendChild(kk); col.appendChild(tt); col.appendChild(list); col.appendChild(chkRow); col.appendChild(btns);
  veil.appendChild(col); document.body.appendChild(veil);
  requestAnimationFrame(() => { veil.style.opacity = '1'; try { bOk.focus(); } catch (e) {} });

  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    window.removeEventListener('keydown', onKey, true);
    veil.style.opacity = '0'; veil.style.pointerEvents = 'none';
    setTimeout(() => { if (veil.parentNode) veil.parentNode.removeChild(veil); }, 600);
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  window.addEventListener('keydown', onKey, true);
  bNo.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  bOk.addEventListener('click', (e) => {
    e.stopPropagation();
    try { if (chk.checked) sessionStorage.setItem('xr_ack_' + mode, '1'); } catch (x) {}
    close();
    onAccept();                                                                // requestSession se llama desde ESTE clic (gesto de usuario válido)
  });
  ['mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown', 'pointerup'].forEach(ev => veil.addEventListener(ev, (e) => e.stopPropagation()));
}
window.xrSafetyNotice = xrSafetyNotice;

// ---------- Salir de AR: botón en pantalla (dom-overlay, móviles) + botón 3D pegado a la cámara (gafas y móviles) ----------
async function endXRSession() { try { const ss = renderer.xr.getSession(); if (ss) await ss.end(); } catch (e) {} }
const arExitRoot = document.createElement('div');
arExitRoot.id = 'ar-exit-root';
arExitRoot.style.cssText = 'position:fixed; inset:0; pointer-events:none; display:none; background:transparent; z-index:2147483000;';
const arExitBtn = document.createElement('button');
arExitBtn.type = 'button'; arExitBtn.id = 'ar-exit-btn'; arExitBtn.textContent = 'SALIR AR';
arExitBtn.style.cssText = 'position:absolute; top:calc(14px + env(safe-area-inset-top,0px)); left:14px; pointer-events:auto; padding:12px 20px; font:300 0.8rem/1 monospace; letter-spacing:0.28em; color:#e7e4de; background:rgba(10,10,12,0.72); border:1px solid rgba(231,228,222,0.5); border-radius:2px; cursor:pointer;';
arExitBtn.addEventListener('beforexrselect', (e) => e.preventDefault());            // tocar el botón no debe colocar un modelo
arExitBtn.addEventListener('click', (e) => { e.stopPropagation(); endXRSession(); });
arExitRoot.appendChild(arExitBtn);
document.body.appendChild(arExitRoot);

const arExit3D = (() => {                                                        // botón flotante (sirve con el controlador, la mano o un toque en pantalla)
  const c = document.createElement('canvas'); c.width = 320; c.height = 110;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,10,12,0.82)'; g.fillRect(0, 0, 320, 110);
  g.strokeStyle = '#e7e4de'; g.lineWidth = 3; g.strokeRect(4, 4, 312, 102);
  g.fillStyle = '#e7e4de'; g.font = '300 38px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('SALIR AR', 160, 56);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.069), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  m.renderOrder = 9999; m.position.set(-0.16, 0.14, -0.5); m.visible = false; m.name = 'ar-exit-3d';
  camera.add(m);
  return m;
})();
window.arTryExit = function (ctrl) {                                             // ¿el controlador/toque apuntó al botón 3D?
  if (!window.isARSession || !renderer.xr.isPresenting || !arExit3D.visible || !ctrl) return false;
  const rc = new THREE.Raycaster(), rot = new THREE.Matrix4();
  rot.identity().extractRotation(ctrl.matrixWorld);
  rc.ray.origin.setFromMatrixPosition(ctrl.matrixWorld); rc.ray.direction.set(0, 0, -1).applyMatrix4(rot);
  camera.updateMatrixWorld(true); arExit3D.updateMatrixWorld(true);
  if (rc.intersectObject(arExit3D, false).length) { endXRSession(); return true; }
  return false;
};

// AR cambia muchas cosas (fondos CSS, Viajero reducido, modelos colocados, bloom…): se guardan al entrar y se restauran TODAS al salir
let arSaved = null;
function arSaveState() {
  const tg = window.travelerGroup;
  arSaved = {
    htmlBg: document.documentElement.style.background, bodyBg: document.body.style.background,
    cvsBg: (document.getElementById('bg-canvas') || { style: {} }).style.background,
    bg: scene.background,
    tg: tg ? { parent: tg.parent, pos: tg.position.clone(), scale: tg.scale.clone(), quat: tg.quaternion.clone(), vis: tg.visible,
               anchored: tg.userData.anchoredPlanet, hadDrop: 'dropY' in tg.userData, dropY: tg.userData.dropY, vy: tg.userData.vy } : null,
    bloom: (typeof isBloomEnabled !== 'undefined') ? isBloomEnabled : true
  };
}
function arRestoreState() {
  const S = arSaved; arSaved = null;
  try {
    (window.spawnedObjects || []).forEach(o => { try { o.traverse(c => { if (c.isMesh && c.material && c.material.uniforms && c.material.uniforms.color && c.userData.originalColor !== undefined) c.material.uniforms.color.value.setHex(c.userData.originalColor); }); } catch (e) {} scene.remove(o); });
    window.spawnedObjects = [];
  } catch (e) {}
  try {
    const tg = window.travelerGroup;
    if (S && S.tg && tg) {
      if (S.tg.parent && tg.parent !== S.tg.parent) S.tg.parent.add(tg);
      tg.position.copy(S.tg.pos); tg.scale.copy(S.tg.scale); tg.quaternion.copy(S.tg.quat); tg.visible = S.tg.vis;
      tg.userData.anchoredPlanet = S.tg.anchored;
      if (S.tg.hadDrop) { tg.userData.dropY = S.tg.dropY; tg.userData.vy = S.tg.vy; } else { delete tg.userData.dropY; delete tg.userData.vy; }
    }
  } catch (e) {}
  try {
    document.documentElement.style.background = S ? S.htmlBg : ''; document.body.style.background = S ? S.bodyBg : '';
    const cvs = document.getElementById('bg-canvas'); if (cvs) cvs.style.background = S ? S.cvsBg : '';
    scene.background = S ? S.bg : null;
    if (S && typeof isBloomEnabled !== 'undefined') { isBloomEnabled = S.bloom; bloomPass.strength = S.bloom ? 0.1 : 0; }
    if (typeof lowFPSCount !== 'undefined') lowFPSCount = 0;
    reticle.visible = false;
  } catch (e) {}
}

// 2. Evento Botón VR (con aviso de seguridad previo)
if (customVrBtn) {
    const startVR = async () => {
        try {
            window.isARSession = false;
            const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
            await renderer.xr.setSession(session);
            if (typeof playSound === 'function') playSound('levelup');
        } catch (error) {
            if (typeof showSystemToast === 'function') showSystemToast('❌ Error iniciando VR', '#ff0000');
        }
    };
    customVrBtn.addEventListener('click', async () => {
        if (renderer.xr.isPresenting) { try { await renderer.xr.getSession()?.end(); } catch (e) {} return; }
        if (xrBlockedByGame()) return;
        xrSafetyNotice('vr', startVR);
    });
}

// 3. Evento Botón AR - BLINDADO PARA ANDROID Y QUEST 3 (con aviso de seguridad previo)
if (customArBtn) {
    const startAR = async () => {
        try {
            window.isARSession = true;
            arSaveState();
            arExitRoot.style.display = 'block';
            console.log(" Solicitando sesión AR nativa...");

            // 🔥 SOLUCIÓN 1: Mover TODO a optionalFeatures.
            // Esto evita que Quest 3 y Android rechacen la sesión por tecnicismos de tracking.
            const session = await navigator.xr.requestSession('immersive-ar', {
                optionalFeatures: ['local-floor', 'local', 'hit-test', 'dom-overlay'],
                domOverlay: { root: arExitRoot }
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
            arExitRoot.style.display = 'none'; arRestoreState();
            if (typeof showSystemToast === 'function') showSystemToast('❌ Error AR: Dispositivo no compatible o permisos denegados', '#ff0000');
        }
    };
    customArBtn.addEventListener('click', async () => {
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
            if (typeof showSystemToast === 'function') showSystemToast(' AR requiere HTTPS', '#f7f4ed');
            return;
        }
        if (renderer.xr.isPresenting) { try { await renderer.xr.getSession()?.end(); } catch (e) {} return; }
        if (xrBlockedByGame()) return;
        xrSafetyNotice('ar', startAR);
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
        arExit3D.visible = true;
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
    const wasAR = window.isARSession;
    window.isARSession = false;
    arExit3D.visible = false; arExitRoot.style.display = 'none';
    document.body.classList.remove('ar-active');
    // 🔥 Restaurar TODO lo que AR cambió (fondos CSS exactos, Viajero, modelos colocados, bloom): antes se borraba y la web quedaba oscura
    arRestoreState();
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
        try { renderer.xr.isPresenting = false; } catch (e) {}                      // (si la versión de three no lo permite, no debe cortar la restauración)
        renderer.setRenderTarget(null);
        renderer.autoClear = true;
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        try { if (typeof composer !== 'undefined') composer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); } catch (e) {}
        
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
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.4, 0.9);
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
  toast.style.setProperty('color', '#f1f1f5', 'important');
  toast.style.setProperty('text-shadow', '0 0 18px rgba(255,255,255,0.18)', 'important'); 
  toast.style.background = 'rgba(5, 5, 10, 0.25)';
  toast.style.backdropFilter = 'blur(12px)';
  toast.style.border = '1px solid rgba(255, 255, 255, 0.05)';
  toast.style.borderRadius = '8px';
  toast.style.padding = '12px 25px';
  toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
  toast.style.fontFamily = "'-apple-system', sans-serif";
  toast.style.fontWeight = '300';
  toast.style.letterSpacing = '0.1em';
  toast.style.textTransform = 'none';
  toast.style.setProperty('text-transform', 'none', 'important');
  
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
const reduceMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
function triggerSubtleGlitch() {
  if (reduceMotionMQ.matches) return; // los destellos son JS, el CSS de movimiento reducido no los alcanza
  if (!isGameStarted || isPaused || isUIOpen || renderer.xr.isPresenting) return;

  const numBlocks = Math.floor(Math.random() * 3) + 1;
  
  for (let i = 0; i < numBlocks; i++) {
    const block = document.createElement('div');
    block.classList.add('cyber-glitch-block');

    const width = Math.random() * 300 + 20; 
    const height = Math.random() * 10 + 2; // 🔥 CORREGIDO A 10 PÍXELES MÁXIMO

    const top = Math.random() * (window.innerHeight - height);
    const left = Math.random() * (window.innerWidth - width);

    const color = Math.random() > 0.5 ? '#00f947' : '#08a0cf';

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

// Al llegar a 13/13 se otorga el logro «Cartógrafo»; su recompensa (modo invertido) vive en el menú lateral y el panel de logros.
function unlockInvertedMode() {
  unlockAchievement('cartographer');
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

function createTextSprite(message, colorHex = "#ffffff", fontPx = 35) { 
  const canvas = document.createElement('canvas'); 
  const context = canvas.getContext('2d'); 
  canvas.width = 1024; canvas.height = 256; 
  context.clearRect(0, 0, canvas.width, canvas.height);
  
// 🔥 FUENTE EJECUTIVA: Delgada, elegante y sin serifa
  context.font = `300 ${fontPx}px '-apple-system', 'Helvetica Neue', Helvetica, Arial, sans-serif`;  context.textAlign = "center"; context.textBaseline = "middle"; 

  // 🔥 LEGIBILIDAD: el texto era blanco puro sin contorno y desaparecía sobre planetas claros
  // (amarillo, gris, magenta). Un contorno oscuro redondeado + un halo suave lo separan de
  // cualquier fondo, sin cambiar la tipografía delgada.
  context.lineJoin = "round"; context.miterLimit = 2;
  context.shadowColor = "rgba(0, 0, 0, 0.8)"; context.shadowBlur = Math.round(fontPx * 0.22);
  context.lineWidth = Math.max(4, Math.round(fontPx * 0.2));
  context.strokeStyle = "rgba(0, 0, 0, 0.9)";
  context.strokeText(message, 512, 128);
  context.shadowBlur = 0;
  context.fillStyle = "rgba(255, 255, 255, 0.95)"; 
  context.fillText(message, 512, 128); 
  
  const texture = new THREE.CanvasTexture(canvas); 
  texture.minFilter = THREE.LinearFilter; 
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.95, depthTest: false });
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
  const text = createTextSprite('SYS_CHAPLIN', '#acf3b1'); text.position.y = -2; text.scale.set(1, 1.5, 1); 
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
    btnCombat.innerText = '▶'; btnCombat.classList.remove('is-combat'); 
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
// 🔥 ANCLAR VIAJERO AL PRIMER PLANETA
  setTimeout(() => {
    if (categoryPlanets.length > 0 && window.travelerGroup && !window.travelerGroup.userData.anchoredPlanet) {
      window.startTravelerFall(categoryPlanets[0]);
    }
  }, 1000);
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
  if (typeof window.stopDacMachines === 'function') window.stopDacMachines();
  
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
document.getElementById('menu-toggle')?.addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); sideMenu.classList.toggle('open'); if (sideMenu.classList.contains('open')) setTimeout(() => document.getElementById('menu-close')?.focus(), 60); }); 
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
    btn.innerText = '⏸'; btn.classList.add('is-combat'); 
    btn.style.borderColor = '#ff0000';
    btn.style.color = '#ff0000';
    btn.title = 'Pausar / Volver a Modo Paz'; // Tooltip
    playSound('ui');
    showSystemToast('ANOMALÍAS REVELADAS : SISTEMA INESTABLE ', '#ffffff');
    toggleCombatDimming(true); // Apagar luces
    if (isTouchDevice && touchControls) touchControls.style.display = 'flex';
  } else {
    toggleCombatDimming(false); // Encender luces
    btn.innerText = '▶'; btn.classList.remove('is-combat'); 
    btn.style.borderColor = '#00ff00';
    btn.style.color = '#00ff00';
    btn.title = 'Activar Minijuego (ARCADA)'; // Tooltip
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
// ✨ AHORA (Gris Sublime / Elegante y Mate):
  const planetMat = new THREE.MeshBasicMaterial({
    color: baseColor.lerp(new THREE.Color(0x888899), 0.75).multiplyScalar(1.2), // Desatura el color y lo fusiona con gris neutral
    transparent: true, 
    opacity: 0.75 // Más etéreo y translúcido
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
  label.position.set(0, 0, 0); 
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
const dacLight = new THREE.DirectionalLight( 0xffffff, 1.2 ); // Subimos de 1.0 a 3.5
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

// 🌐 Escudo Invisible D.A.C. (Mantiene el aspecto de basura electrónica libre y caótica)
const dacHitboxPlanet = new THREE.Mesh(
  new THREE.SphereGeometry(7.2, 16, 16),
  new THREE.MeshBasicMaterial({ 
    visible: false // Cero rastro visual, funciona únicamente para recibir el clic del ratón
  })
);
dacHitboxPlanet.name = "planeta_dac"; 
planetaDAC.add(dacHitboxPlanet);
// 🪐 ANILLOS ARQUITECTÓNICOS DEL NÚCLEO D.A.C. (NUBES DE PARTÍCULAS)
const dacRings = new THREE.Group();
dacRings.name = "dac_rings";
dacRings.rotation.x = Math.PI / 2.2; 
dacRings.rotation.y = Math.PI / 8;

// Función para forjar anillos de partículas (Efecto nube/polvo estelar)
const createDacRing = (radius, thickness, hexColor, alpha, isPoetica) => {
  const particleCount = isPoetica ? 3000 : 2000;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(particleCount * 3);
  const basePos = new Float32Array(particleCount * 3); // Para recordar forma original

  for (let i = 0; i < particleCount; i++) {
    const theta = Math.random() * Math.PI * 2; // Ángulo del anillo principal
    const phi = Math.random() * Math.PI * 2;   // Ángulo del tubo
    const r = thickness * Math.sqrt(Math.random()); // Distribución espesa al centro
    
    const x = (radius + r * Math.cos(phi)) * Math.cos(theta);
    const y = r * Math.sin(phi);
    const z = (radius + r * Math.cos(phi)) * Math.sin(theta);

    pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = z;
    basePos[i*3] = x; basePos[i*3+1] = y; basePos[i*3+2] = z;
  }
  
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('basePosition', new THREE.BufferAttribute(basePos, 3));

  // Glow sutil y elegante: Additive Blending + Multiplicar color base para activar el Neon
  const ringMat = new THREE.PointsMaterial({ 
    color: new THREE.Color(hexColor).multiplyScalar(1.5), 
    size: 0.05,
    transparent: true, 
    opacity: alpha,
    blending: THREE.AdditiveBlending,
    depthWrite: false 
  });

  const points = new THREE.Points(geo, ringMat);
  points.raycast = function() {}; // Inmune al ratón
  return points;
};

// 1. Anillo interno (Poética / Arte / Hueso perlado radiante)
const ringP = createDacRing(8.5, 0.25, 0xe7e4de, 0.5, true);
ringP.userData = { type: 'poetica', baseColor: 0xe7e4de };
dacRings.add(ringP);

// 2. Anillo medio (Errática / Ciencia / Gris pizarra tenue)
const ringE = createDacRing(9.8, 0.15, 0x8a867f, 0.35, false);
ringE.userData = { type: 'erratica', baseColor: 0x8a867f };
dacRings.add(ringE);

// 3. Anillo exterior (Fricción / Diseño / Coral profundo esparcido)
const ringF = createDacRing(11.2, 0.4, 0xff6644, 0.2, false);
ringF.userData = { type: 'friccion', baseColor: 0xff6644 };
dacRings.add(ringF);

planetaDAC.add(dacRings);
// Opcional: Dale una rotación contraria súper lenta para que se sienta como un mecanismo vivo
// En tu AnimationLoop puedes agregar: dacHitboxPlanet.rotation.y -= 0.0005;

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
      // 🔥 Máquina Errática: Monolito Cúbico de Datos
      // Distribuimos las partículas en las 6 caras de un cubo hueco
      const face = Math.floor(Math.random() * 3); 
      const val = (Math.random() > 0.5 ? 1.5 : -1.5);
      
      if (face === 0) {
        x = val;
        y = (Math.random() - 0.5) * 3.0;
        z = (Math.random() - 0.5) * 3.0;
      } else if (face === 1) {
        x = (Math.random() - 0.5) * 3.0;
        y = val;
        z = (Math.random() - 0.5) * 3.0;
      } else {
        x = (Math.random() - 0.5) * 3.0;
        y = (Math.random() - 0.5) * 3.0;
        z = val;
      }
      
      pos[i*3] = x;
      pos[i*3+1] = y;
      pos[i*3+2] = z;
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
  // Guardamos la forma perfecta para poder "curarla" o romperla después
  geo.setAttribute('basePosition', new THREE.BufferAttribute(new Float32Array(pos), 3));
  
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

// 🔥 TONOS "SUBLIMES" Y ETIQUETAS TÉCNICAS
const lunaPoetica = createAttractor('poetica', 0xdcdce2); 
lunaPoetica.position.set(12, 0, 0); lunaPoetica.name = "maquina_poetica";
const hitP = new THREE.Mesh(new THREE.BoxGeometry(3,3,3), new THREE.MeshBasicMaterial({visible:false})); lunaPoetica.add(hitP);
const labelP = createTextSprite('[ MÁQUINA POÉTICA ]', '#dcdce2', 26);
labelP.position.y = 3.5; labelP.visible = false; labelP.name = "dac_label";
lunaPoetica.add(labelP);

const lunaErratica = createAttractor('erratica', 0xcc5544); 
lunaErratica.position.set(-8, 6, -8); lunaErratica.name = "maquina_erratica";
const hitE = new THREE.Mesh(new THREE.BoxGeometry(3,3,3), new THREE.MeshBasicMaterial({visible:false})); lunaErratica.add(hitE);
const labelE = createTextSprite('[ MÁQUINA ERRÁTICA ]', '#cc5544', 26);
labelE.position.y = 3.5; labelE.visible = false; labelE.name = "dac_label";
lunaErratica.add(labelE);

const lunaFriccion = createAttractor('friccion', 0xb89947); 
lunaFriccion.position.set(0, -10, 8); lunaFriccion.name = "maquina_friccion";
const hitF = new THREE.Mesh(new THREE.BoxGeometry(3,3,3), new THREE.MeshBasicMaterial({visible:false})); lunaFriccion.add(hitF);
const labelF = createTextSprite('[ MÁQUINA DE FRICCIÓN ]', '#b89947', 26);
labelF.position.y = 3.5; labelF.visible = false; labelF.name = "dac_label";
lunaFriccion.add(labelF);

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

// 1. Los Nodos (Estética Sublime: puntos hueso translúcidos)
const dacParticleCount = 1000;
const dacParticlesGeo = new THREE.BufferGeometry();
const dacParticlePositions = new Float32Array(dacParticleCount * 8);
const dacParticleData = [];

for (let i = 0; i < dacParticleCount; i++) {
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
// 🔥 Puntos más pequeños (0.08) y menos opacos
const dacParticles = new THREE.Points(dacParticlesGeo, new THREE.PointsMaterial({ color: 0xe7e4de, size: 0.08, transparent: true, opacity: 0.35 }));
dacNetworkGroup.add(dacParticles);

// 2. El Pincel de Interacción
// 🔥 Pincel sutil, sin neón cian
const dacBrush = new THREE.Mesh(
  new THREE.SphereGeometry(0.15, 8, 8), 
  new THREE.MeshBasicMaterial({ color: 0xe7e4de, wireframe: true, transparent: true, opacity: 0.4 })
);
dacBrush.raycast = function() {}; 
dacNetworkGroup.add(dacBrush);

// 3. Las Conexiones Dinámicas (Líneas - ESTILO CAD)
const dacLinesGeo = new THREE.BufferGeometry();
const maxLines = 3000; 
const dacLinePositions = new Float32Array(maxLines * 6); 
const dacLineAttr = new THREE.BufferAttribute(dacLinePositions, 3);
try { if (dacLineAttr.setUsage) dacLineAttr.setUsage(THREE.DynamicDrawUsage); } catch(e){}
dacLinesGeo.setAttribute('position', dacLineAttr);

// 🔥 Líneas gris pizarra con opacidad muy baja para que no saturen la pantalla
const dacLinesMat = new THREE.LineBasicMaterial({ color: 0x8a867f, transparent: true, opacity: 0.18 });
const dacLines = new THREE.LineSegments(dacLinesGeo, dacLinesMat);
dacNetworkGroup.add(dacLines);

// 4. Las Palabras Clave de la Investigación
const dacConceptos = ["Autopoiesis", "An-arqueología", "Saber-del-cuerpo", "Fricción", "Glitch", "Cacharreo", "Soberanía"];
const dacWords = [];
dacConceptos.forEach(txt => {
  const sp = createTextSprite(txt, '#e7e4de', 56); // Tono hueso sublime
  sp.position.set((Math.random()-0.5)*50, (Math.random()-0.5)*35, 2);
  sp.scale.set(32, 8, 1);
  sp.material.depthTest = false; 
  sp.visible = false;
  sp.userData = { basePos: sp.position.clone() };
  sp.raycast = function() {}; // 🔥 ESCUDO: Evita que el ratón las detecte y agrande
  dacNetworkGroup.add(sp);
  dacWords.push(sp);
});

// 🔥 Reparte las palabras clave por TODA la pantalla mientras se está dentro del planeta DAC.
// Antes nacían en posiciones aleatorias dentro del planeta (se amontonaban y se pisaban) y, como
// son hijas del planeta, giraban con él. Ahora se calcula, en cada cuadro, una posición fija en
// pantalla (casillas repartidas por el borde, o en zigzag en vertical) y se convierte a
// coordenadas locales del planeta: la rotación del DAC no las mueve.
const _dacTmp = { cam: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), w: new THREE.Vector3() };
function layoutDacWords() {
  if (!dacWords.length) return null;
  planetaDAC.updateWorldMatrix(true, false);
  camera.updateWorldMatrix(true, false);
  const t = _dacTmp;
  camera.getWorldPosition(t.cam);
  camera.getWorldDirection(t.fwd);
  t.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  t.up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const depth = Math.max(8, t.cam.distanceTo(planetaDAC.position) - 2);
  const hH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * depth;
  const hW = hH * camera.aspect;
  const portrait = camera.aspect < 1;
  const slots = portrait
    ? [[-0.38, 0.78], [0.38, 0.52], [-0.38, 0.26], [0.38, 0.0], [-0.38, -0.26], [0.38, -0.52], [-0.38, -0.78]]
    : [[-0.6, 0.62], [0.02, 0.8], [0.62, 0.6], [-0.76, 0.0], [0.76, 0.04], [-0.5, -0.66], [0.48, -0.72]];
  const W = portrait ? hW * 2.0 : Math.min(hW * 0.95, hH * 2.2); // ancho del sprite (4:1)
  const k = 1 / (planetaDAC.scale.x || 1);
  dacWords.forEach((word, i) => {
    const s = slots[i % slots.length];
    t.w.copy(t.cam).addScaledVector(t.fwd, depth).addScaledVector(t.right, s[0] * hW * 0.92).addScaledVector(t.up, s[1] * hH * 0.92);
    planetaDAC.worldToLocal(t.w);
    word.userData.basePos.copy(t.w);
    word.position.x = t.w.x;
    word.position.z = t.w.z;
    word.scale.set(W * k, (W / 4) * k, 1);
  });
  return { hW, hH };
}

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
let bossMaxHealth = 120; let bossHealth = 120; // 🔥 Jefe mucho más resistente
let enemyProjectiles = []; 
const enemyProjGeo = new THREE.TetrahedronGeometry(0.3, 0); // ⚠️ Fragmento de Glitch
const enemyProjMat = new THREE.MeshBasicMaterial({ color: 0xff6644, wireframe: true });let playerLives = 3; 

function updateLivesUI() {
  const livesEl = document.getElementById('lives-value');
if (livesEl) livesEl.innerText = '■ '.repeat(Math.max(0, playerLives));}

// ==========================================
// 🔥 REPARACIÓN: GAME OVER BLINDADO (SIN CONGELAMIENTO)
// ==========================================
// ==========================================
// 🔥 GAME OVER CORREGIDO - GUARDA PUNTAJE
// ==========================================
// 🔥 CAUSA DEL CONGELAMIENTO AL PERDER: triggerGameOver() se llama DENTRO de los bucles de colisión del cuadro y vaciaba
// aquí mismo las listas (asteroids.length = 0, fighters…). El bucle seguía con el siguiente índice, leía un elemento
// undefined, lanzaba una excepción y three.js dejaba de programar cuadros: todo congelado. Ahora el game over se
// APLAZA hasta que termine el cuadro y se ignora si ya hay uno en curso (varias colisiones en el mismo cuadro).
let gameOverQueued = false;
function triggerGameOver() {
  if (gameOverQueued) return;
  gameOverQueued = true;
  setTimeout(() => {
    try { performGameOver(); }
    finally { gameOverQueued = false; }
  }, 0);
}

function performGameOver() {
  try {
    playSound('explosion');
    createExplosion(ship.position.x, ship.position.y, ship.position.z, 1.6, 0xff8888);
    
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
      btnCombat.innerText = '▶'; btnCombat.classList.remove('is-combat'); 
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
        armScoreForm(finalScoreValue, true); // partida nueva terminada: habilita UN registro
        
        // Abrir leaderboard
        openUIWindow('leaderboard-ui');
        
        // Actualizar la lista
        updateLeaderboardUI();
        
        showSystemToast(' GAME OVER! Puntaje: ' + finalScoreValue, '#cef4c0');
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
  if (score >= 5000 && !isBossBattle && !hasFoughtBoss) { isBossBattle = true; spawnBoss(); playSound('double_pulse'); shakeIntensity = 1.0; } else if (!isBossBattle) { checkLevelUp(); }
}

// ============================================================
// 🔥 JEFE FINAL: "NÚCLEO CORRUPTO"
// Un monolito cúbico de datos (como la Máquina Errática) con una jaula de
// aristas, un ojo que sigue a tu nave y esquirlas triangulares en órbita.
// Usa el mismo shader de tramado (dither) que el resto del universo.
// ============================================================

// La barra de vida quedaba DETRÁS del HUD (z-index 10 frente a 10000, y en la misma franja
// de la pantalla). Se baja debajo del HUD y de los botones, y se sube su capa.
(function injectBossStyle() {
  if (document.getElementById('boss-ui-style')) return;
  const s = document.createElement('style');
  s.id = 'boss-ui-style';
  s.textContent = `
    #boss-ui { top: 86px !important; width: min(92vw, 340px) !important; z-index: 10002 !important; pointer-events: none; }
    #boss-title { font-size: 16px !important; letter-spacing: 4px !important; margin-bottom: 6px !important; text-shadow: 0 0 8px rgba(255, 0, 0, 0.5); }
    #boss-hp-bg { height: 10px !important; }
    #boss-hp-fill { box-shadow: 0 0 10px rgba(255, 0, 0, 0.55); }
    @media (max-width: 768px) {
      #boss-ui { top: 128px !important; }   /* bajo el HUD (25-82px) y la fila de botones (80-120px) */
      #boss-title { font-size: 13px !important; letter-spacing: 3px !important; }
    }
  `;
  document.head.appendChild(s);
})();

function makeBossMaterial(hex) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(hex) }, lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } },
    vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader, transparent: true
  });
}

function spawnBoss() {
  document.getElementById('boss-ui').classList.remove('hidden');
  const bossTitle = document.getElementById('boss-title');
  if (bossTitle) bossTitle.textContent = (window.currentLang === 'en') ? 'CORRUPTED CORE' : 'NÚCLEO CORRUPTO';

  const bossGroup = new THREE.Group();

  // children[0]: el cuerpo. El destello de impacto (blanco → rojo) actúa sobre este hijo.
  const core = new THREE.Mesh(new THREE.BoxGeometry(5.2, 5.2, 5.2), makeBossMaterial(0xff0000));
  core.rotation.set(0.5, 0, Math.PI / 4); // girado 45° para leerse como un diamante
  bossGroup.add(core);

  // Jaula de aristas (la "caja negra" que contiene al núcleo)
  const cage = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(6.4, 1)),
    new THREE.LineBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.5 })
  );
  bossGroup.add(cage);

  // Ojo flotante delante del cuerpo: pupila + anillo
  const eye = new THREE.Group();
  eye.position.set(0, 0, 4.8);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 12), makeBossMaterial(0xffffff));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.12, 6, 40), makeBossMaterial(0xffffff));
  eye.add(pupil);
  eye.add(ring);
  bossGroup.add(eye);

  // Esquirlas triangulares en órbita (eco de la capa del viajero)
  const shards = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2;
    const r = 7.6 + (i % 2) * 0.9;
    const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.8, 0), makeBossMaterial(i % 2 ? 0xffffff : 0xff0000));
    shard.position.set(Math.cos(ang) * r, Math.sin(ang) * r, ((i % 3) - 1) * 0.7);
    shard.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    shards.add(shard);
  }
  bossGroup.add(shards);

  bossGroup.userData.parts = { core, cage, eye, pupil, ring, shards };
  bossGroup.userData.rage = 0;
  bossGroup.position.set(0, 35, 0);
  scene.add(bossGroup);
  bossEntity = bossGroup;
}

// Se llama en cada cuadro mientras dura el combate contra el jefe
function animateBoss(boss) {
  const parts = boss && boss.userData && boss.userData.parts;
  if (!parts) return;
  const { core, cage, eye, ring, shards } = parts;
  const t = Date.now();
  const hp = Math.max(0, bossHealth / bossMaxHealth);
  const rage = hp < 0.25 ? 2 : (hp < 0.5 ? 1 : 0);

  // Fases: al bajar la vida el núcleo se desestabiliza
  if (rage > boss.userData.rage) {
    boss.userData.rage = rage;
    if (typeof showSystemToast === 'function') {
      const en = window.currentLang === 'en';
      showSystemToast(rage === 1 ? (en ? 'THE CORE DESTABILIZES' : 'EL NÚCLEO SE DESESTABILIZA')
                                 : (en ? 'CRITICAL CORRUPTION' : 'CORRUPCIÓN CRÍTICA'), '#fef9f9');
    }
  }

  core.rotation.y = Math.sin(t * 0.0009) * 0.5;                     // vaivén lento
  core.scale.setScalar(1 + Math.sin(t * 0.004) * 0.025 * (1 + rage)); // respira
  cage.rotation.y += 0.004 + rage * 0.004;
  cage.rotation.x -= 0.0025;
  shards.rotation.z += 0.02 + rage * 0.015;
  for (let i = 0; i < shards.children.length; i++) {
    shards.children[i].rotation.x += 0.03 + i * 0.002;
    shards.children[i].rotation.y += 0.04;
  }
  ring.rotation.z += 0.02;

  // El ojo sigue a la nave del jugador
  if (typeof ship !== 'undefined' && ship) {
    const tx = Math.max(-1, Math.min(1, (ship.position.x - boss.position.x) / 20)) * 1.1;
    const ty = Math.max(-1, Math.min(1, (ship.position.y - boss.position.y) / 20)) * 1.1;
    eye.position.x += (tx - eye.position.x) * 0.1;
    eye.position.y += (ty - eye.position.y) * 0.1;
  }

  // Última fase: tiembla como un archivo corrupto
  if (rage === 2 && Math.random() > 0.9) {
    core.position.set((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0);
  } else {
    core.position.x *= 0.8; core.position.y *= 0.8;
  }
}

function showLeaderboard() { openUIWindow('leaderboard-ui'); document.getElementById('final-score-display').innerText = score; armScoreForm(score, false); updateLeaderboardUI(); }

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

// 🔥 Un solo registro por puntaje. Antes, al terminar de enviar se reactivaba el botón y se podía guardar el mismo
// récord una y otra vez. Ahora cada partida terminada ("armScoreForm(puntaje, true)") habilita UN envío; después el
// formulario queda bloqueado. Desde el menú solo se vuelve a habilitar si el puntaje actual es distinto al ya enviado.
const scoreSubmission = { value: 0, done: false, sending: false, label: null };
function applyScoreFormState() {
  const form = document.getElementById('score-form'); if (!form) return;
  const btn = form.querySelector('button[type="submit"]'), input = document.getElementById('player-name');
  if (btn && scoreSubmission.label === null) scoreSubmission.label = btn.innerText;
  const locked = scoreSubmission.done || scoreSubmission.sending || scoreSubmission.value <= 0;
  const en = window.currentLang === 'en';
  if (btn) {
    btn.disabled = locked;
    btn.style.opacity = locked ? '0.55' : '';
    btn.style.cursor = locked ? 'default' : '';
    btn.innerText = scoreSubmission.sending ? (en ? 'SENDING...' : 'TRANSMITIENDO...')
                  : scoreSubmission.done ? (en ? 'SCORE SAVED ✓' : 'PUNTAJE REGISTRADO ✓')
                  : (scoreSubmission.label || 'GUARDAR');
  }
  if (input) input.disabled = scoreSubmission.done || scoreSubmission.sending;
}
function armScoreForm(value, newRun) {
  const v = parseInt(value) || 0;
  if (newRun || v !== scoreSubmission.value) { scoreSubmission.value = v; scoreSubmission.done = false; }
  applyScoreFormState();
}

document.getElementById('score-form')?.addEventListener('submit', async (e) => { 
  e.preventDefault(); 
  if (scoreSubmission.done || scoreSubmission.sending || scoreSubmission.value <= 0) {
    if (scoreSubmission.done && typeof showSystemToast === 'function') showSystemToast(window.currentLang === 'en' ? 'This score is already saved' : 'Este puntaje ya está registrado', '#f4f4f7');
    return;
  }
  
  const nameInput = document.getElementById('player-name');
  const name = nameInput ? (nameInput.value.trim() || 'Anónimo') : 'Anónimo'; 
  // 🔥 Se envía el puntaje congelado de la partida terminada, no la variable del juego que ya se reseteó
  const finalScoreToSend = scoreSubmission.value;
  
  scoreSubmission.sending = true;
  applyScoreFormState();
  
  try {
    const res = await fetch(FIREBASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, score: finalScoreToSend }) 
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    
    scoreSubmission.done = true;
    if (nameInput) nameInput.value = ''; 
    playSound('levelup');
    unlockAchievement('hall');
    await updateLeaderboardUI(); 
  } catch (error) {
    console.error("Error al guardar:", error);
    showSystemToast('Error de conexión al guardar el puntaje', '#f4f4f7');
  } finally {
    scoreSubmission.sending = false;
    applyScoreFormState();   // si falló, el botón vuelve a estar disponible para reintentar; si salió bien, queda bloqueado
  }
});
applyScoreFormState(); // al cargar: bloqueado hasta que termine una partida
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

// ============================================================
// 🔥 PULSOS en lugar de explosiones
// Cada impacto lanza un destello suave y anillos que se expanden y se desvanecen
// (el mismo lenguaje del "doble pulso" del viajero). Se mantiene el nombre
// createExplosion para no tocar los puntos de llamada; size y hex son opcionales.
// ============================================================
const pulseFX = [];
let pulseRingGeo = null, pulseDiscGeo = null;

function createExplosion(x, y, z, size = 1, hex = 0xbfefff) {
  if (!pulseRingGeo) { pulseRingGeo = new THREE.RingGeometry(0.965, 1.0, 56); pulseDiscGeo = new THREE.CircleGeometry(1, 24); }
  const now = performance.now();
  const mk = (geo, delay, dur, from, max, alpha) => {
    const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.setScalar(Math.max(0.01, from));
    m.visible = false;
    scene.add(m);
    pulseFX.push({ mesh: m, born: now + delay, dur, from, max, alpha });
  };
  mk(pulseDiscGeo, 0, 260, 0.1 * size, 0.9 * size, 0.9); // destello central
  const rings = size > 1.5 ? 3 : 2;
  for (let i = 0; i < rings; i++) mk(pulseRingGeo, 90 + i * 130, 620 + i * 140, 0.2 * size, (2.6 + i * 1.5) * size, 0.8 - i * 0.15);
}

function updatePulseFX() {
  if (!pulseFX.length) return;
  const now = performance.now();
  for (let i = pulseFX.length - 1; i >= 0; i--) {
    const f = pulseFX[i], k = (now - f.born) / f.dur;
    if (k < 0) continue; // aún en retardo
    if (k >= 1) {
      scene.remove(f.mesh); f.mesh.material.dispose();
      if (f.ownGeo) f.mesh.geometry.dispose();
      pulseFX.splice(i, 1);
      continue;
    }
    f.mesh.visible = true;
    const e = 1 - Math.pow(1 - k, 3); // frena al final, como una onda que se apaga
    f.mesh.scale.setScalar(Math.max(0.01, f.from + (f.max - f.from) * e));
    f.mesh.material.opacity = (1 - k) * f.alpha;
  }
}

function triggerScrollExploration() { 
  document.getElementById('scroll-hint')?.classList.add('hidden');
  if (!isGameStarted || isPaused || isUIOpen || renderer.xr.isPresenting || isBossBattle || window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive || window.isMiniIntro) return; 
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
  mediaSrc: '/imge/gamber.png', 
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
  mediaSrc: '/imge/chaplin.jpg', 
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
  // 🎮 JUEGOS OTROS: cada minijuego maneja su propio puntero
  if (window.isWiringGameActive) { window.wiringDown(clientX, clientY); return; }
  if (window.isTuningGameActive || window.isHogueraActive) { window.MG.setPointer(clientX, clientY); return; }   // (en la Hoguera el toque se resuelve al soltar: ver hgCamBind)

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
  
  const grabTargets = [...categoryPlanets, ...ambientWhales, ...guardianCats, ...discoveredVoyagers, window.travelerGroup];
  const intersects = dragRaycaster.intersectObjects(grabTargets, true);
  
  if (typeof planetaDAC !== 'undefined' && !planetaDAC.userData.isIsolated && !isAligned) {
    const dacHit = dragRaycaster.intersectObject(dacHitboxPlanet, false);
    if (dacHit.length > 0 && (intersects.length === 0 || dacHit[0].distance < intersects[0].distance)) {
      draggedPlanet = planetaDAC;
      if (navigator.vibrate) vibrateDevice(50);
      return;
    }
  }
  
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
  // 🎮 JUEGOS OTROS
  if (window.isWiringGameActive) { window.wiringMove(clientX, clientY); return; }
  if (window.isTuningGameActive || window.isHogueraActive) { window.MG.setPointer(clientX, clientY); return; }

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
      
      const moveVector = new THREE.Vector3(pixelDeltaX * 0.05, -pixelDeltaY * 0.05, 0);
      moveVector.applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
      
      draggedPlanet.position.add(moveVector);
      draggedPlanet.userData.baseY = draggedPlanet.position.y;
      if (typeof planetaDAC !== 'undefined' && draggedPlanet === planetaDAC) { 
        if (!planetaDAC.userData.savedPos) planetaDAC.userData.savedPos = new THREE.Vector3();
        planetaDAC.userData.savedPos.copy(planetaDAC.position);
        planetaDAC.userData.homePos = planetaDAC.position.clone(); 
      }
      
      if (draggedPlanet.userData.randomPos) {
        draggedPlanet.userData.randomPos.copy(draggedPlanet.position);
      }
    }
  } 
  else {
    const deltaX = Math.abs(clientX - touchStartX); const deltaY = Math.abs(clientY - touchStartY);
    if (deltaX > 5 || deltaY > 5) window.isDraggingCanvas = true;

    if (window.isDraggingCanvas) {
      const dragResistance = typeof isFriccionActive !== 'undefined' && isFriccionActive ? 0.0005 : 0.005; 
      
      if (typeof planetaDAC !== 'undefined' && planetaDAC.userData.isIsolated) {
        planetaDAC.rotation.y += (clientX - lastTouchX) * dragResistance * 2;
        planetaDAC.rotation.x += (clientY - lastTouchY) * dragResistance * 2;
        if (typeof _dacSpin !== 'undefined') {
          _dacSpin.vy = (clientX - lastTouchX) * dragResistance * 0.8; 
          _dacSpin.vx = (clientY - lastTouchY) * dragResistance * 0.8;
        }
      }
      else if (isAligned) { 
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
  // 🎮 JUEGOS OTROS
  if (window.isWiringGameActive) { window.wiringUp(); return; }
  if (window.isTuningGameActive || window.isHogueraActive) return;

  window.isPainting = false;
  if (draggedPlanet) {
    if (isDraggingPlanet) {
      playSound('ui'); window.justDropped = true; 
      
      if (draggedPlanet === window.travelerGroup) {
        let snapped = false;
        let closestPlanet = null;
        let minDistance = 35.0; 
        
        categoryPlanets.forEach(p => {
          if(p.userData.id === 999) return; 
          const dist = window.travelerGroup.position.distanceTo(p.position);
          if (dist < minDistance) {
            minDistance = dist;
            closestPlanet = p;
          }
        });

        if (closestPlanet) {
          window.startTravelerFall(closestPlanet);
          snapped = true;
          playSound('project_open');
          
          const pId = closestPlanet.userData.id;
          const pTitle = typeof closestPlanet.userData.title === 'object' ? closestPlanet.userData.title[window.currentLang||'es'] : closestPlanet.userData.title;
          
          let phrase = "";
          if (pId === 1 || pTitle.includes("GameLab")) {
            phrase = window.currentLang === 'en' ? "GameLab Tadeo: Where code becomes culture and social transformation." : "GameLab Tadeo: Donde el código se vuelve cultura y transformación social.";
          } else if (pId === 2 || pTitle.includes("Media")) {
            phrase = window.currentLang === 'en' ? "Media archaeology. Preserving the memory of what was once cutting-edge." : "Arqueología de los medios. Preservando la memoria de lo que alguna vez fue vanguardia.";
          } else if (pId === 3 || pTitle.includes("Semillas") || pTitle.includes("Juegos Otros")) {
            phrase = window.currentLang === 'en' ? "Other Games. Seeding disobedience and exploring decolonial mechanics." : "Juegos Otros. Sembrando desobediencia y explorando mecánicas decoloniales.";
          } else if (pId === 4 || pTitle.includes("Domo")) {
            phrase = window.currentLang === 'en' ? "Expanding the narrative to the celestial vault. Full-dome interaction." : "Expandiendo la narrativa a la bóveda celeste. Interacción Fulldome.";
          } else if (pId === 5 || pTitle.includes("Accesi")) {
            phrase = window.currentLang === 'en' ? "Universal design. Play is a right, accessible to all." : "Diseño universal y accesibilidad. El juego es un territorio para todos.";
          } else {
            phrase = window.currentLang === 'en' ? `Exploring the margins of [ ${pTitle} ].` : `Explorando los márgenes de [ ${pTitle} ].`;
          }

          if (typeof showPoeticReflection === 'function') showPoeticReflection(phrase, "#00ffcc");
          
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
        
        if (!snapped) {
          window.travelerGroup.userData.anchoredPlanet = null;
          window.travelerGroup.userData.baseY = window.travelerGroup.position.y;
          window.travelerGroup.userData.baseX = window.travelerGroup.position.x;
        }
      }
      else if (!isAligned && draggedPlanet.userData.id !== undefined && draggedPlanet.userData.id !== 999) {
        if (!draggedPlanet.userData.randomPos) draggedPlanet.userData.randomPos = new THREE.Vector3();
        if (!draggedPlanet.userData.targetPos) draggedPlanet.userData.targetPos = new THREE.Vector3();
        
        let pIndex = categoryPlanets.indexOf(draggedPlanet);
        let sinOffset = (pIndex !== -1) ? Math.sin((Date.now()*0.001) + pIndex) * 0.5 : 0;
        
        draggedPlanet.userData.baseY = draggedPlanet.position.y - sinOffset;
        draggedPlanet.userData.randomPos.copy(draggedPlanet.position);
        draggedPlanet.userData.randomPos.y = draggedPlanet.userData.baseY;
        draggedPlanet.userData.targetPos.copy(draggedPlanet.userData.randomPos);
        
        if (typeof saveConstellationData === 'function') saveConstellationData();
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
    if (tapLength < 300 && tapLength > 0 && !window.isTuningGameActive && !window.isWiringGameActive && !window.isHogueraActive && !isUIOpen && !isBossBattle && !isAligned && !isDraggingPlanet) {
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
    if (!draggedPlanet && !window.isTuningGameActive && !window.isWiringGameActive && !window.isHogueraActive && (touchStartY - touchY > 40 || touchStartY - touchY < -40)) { 
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
  if (isAligned && e.changedTouches.length > 0 && !draggedPlanet && !isDraggingPlanet && !window.isTuningGameActive && !window.isWiringGameActive && !window.isHogueraActive && !window.isMiniIntro) {   // un lanzamiento de ofrenda no debe girar el carrusel
    const touchEndX = e.changedTouches[0].clientX;
    const deltaX = touchEndX - touchStartX;
    const deltaTime = Date.now() - touchStartTime;
    
    const angleStep = (Math.PI * 2) / carouselSlots(); // incluye al DAC (y a la anomalía si ya apareció)

    if (deltaTime < 300 && Math.abs(deltaX) > 40) {
      if (deltaX > 0) targetCarouselAngle += angleStep; 
      else targetCarouselAngle -= angleStep; 
    } 
    targetCarouselAngle = carouselSnap(targetCarouselAngle);
  }
});
// ============================================================
// 🌱 MOTOR BOTÁNICO: FLORA DE DATOS (INSTANCING SCATTER)
// ============================================================
function spawnPlanetFlora(planetMesh) {
  if (!planetMesh.userData.floraMesh) {
    // 🔥 Geometría Suave: Esporas / Brotes redondeados (CERO púas)
    // Una cápsula es como una píldora con puntas perfectamente redondas
    const flowerGeo = new THREE.CapsuleGeometry(0.05, 0.15, 4, 12);
    flowerGeo.translate(0, 0.15, 0); // Anclamos desde la base
    flowerGeo.rotateX(Math.PI / 2);  // Apuntamos hacia afuera

    // Material: Verde salvia muy tenue y elegante
    const flowerMat = new THREE.MeshBasicMaterial({ 
      color: 0xb9c8b0, 
      transparent: true, 
      opacity: 0, 
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    // Subimos la cantidad pero los hacemos más pequeños (efecto musgo)
    const count = 140; 
    const instancedMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, count);
    instancedMesh.name = "flora";
    
    const dummy = new THREE.Object3D();
    const radius = 3.0; // Radio del planeta

    // Distribución esférica uniforme
    for (let i = 0; i < count; i++) {
      const phi = Math.acos(-1 + (2 * i) / count);
      const theta = Math.sqrt(count * Math.PI) * phi;
      
      dummy.position.set(
        radius * Math.cos(theta) * Math.sin(phi),
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(phi)
      );
      
      // Que miren hacia afuera
      const normal = dummy.position.clone().normalize();
      dummy.lookAt(dummy.position.clone().add(normal));
      
      // Tamaño aleatorio sutil. 
      // Al escalar más en "X" que en "Z", aplanamos la cápsula para que parezca una hojita suave
      const s = 0.3 + Math.random() * 0.6;
      dummy.scale.set(s * 1.6, s, s * 0.6);

      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    
    planetMesh.add(instancedMesh);
    planetMesh.userData.floraMesh = instancedMesh;
  }
  
  // 🔥 Animación de Florecer (Fade-In)
  const flora = planetMesh.userData.floraMesh;
  flora.visible = true;
  let opacity = flora.material.opacity;
  if (flora.fadeAnim) clearInterval(flora.fadeAnim);
  
  flora.fadeAnim = setInterval(() => {
    opacity += 0.03;
    flora.material.opacity = Math.min(opacity, 0.65);
    if (opacity >= 0.65) clearInterval(flora.fadeAnim);
  }, 50);
}

// Para cuando el usuario hace clic en "Marcar como no leído"
function removePlanetFlora(planetMesh) {
  const flora = planetMesh.userData.floraMesh;
  if (!flora) return;
  
  // Animación de Marchitarse (Fade-Out)
  let opacity = flora.material.opacity;
  if (flora.fadeAnim) clearInterval(flora.fadeAnim);
  
  flora.fadeAnim = setInterval(() => {
    opacity -= 0.05;
    flora.material.opacity = Math.max(opacity, 0);
    if (opacity <= 0) {
      flora.visible = false;
      clearInterval(flora.fadeAnim);
    }
  }, 30);
}
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

  if (!data.isVoyager && !data.isCat && data.id !== 98) {
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
        newLabel.position.set(0, 0, 0);
        planetMesh.add(newLabel);
      }
      if (typeof spawnPlanetFlora === 'function') spawnPlanetFlora(planetMesh);
    }
  }

 // 🔥 CORRECCIÓN: Cálculo exacto del ángulo del carrusel para encuadrar la cámara
  if (isAligned) {
    const planetMesh = categoryPlanets.find(p => p.userData.id === data.id);
    if (planetMesh) {
      const slot = carouselSlotOf(planetMesh);
      if (slot !== -1) {
        let a = (Math.PI / 2) - ((slot / carouselSlots()) * Math.PI * 2);
        a += Math.round((targetCarouselAngle - a) / (Math.PI * 2)) * (Math.PI * 2); // equivalente más cercano: sin dar vueltas de más
        targetCarouselAngle = a;
      }
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

      let finalGallery = data.gallery || (data.mediaSrc ? [data.mediaSrc] : []); // ballena y gatos usan mediaSrc
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
      restoreBtn.style = "background: transparent; border: none; color: #b9b9c4; font-family: -apple-system, Helvetica, Arial, sans-serif; letter-spacing: 0.08em; font-weight: 300; cursor: pointer; font-size: 0.85rem; transition: 0.3s; text-decoration: underline;";
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
          origLabel.position.set(0, 0, 0);
          pMesh.add(origLabel);
        }
        if (typeof removePlanetFlora === 'function') removePlanetFlora(pMesh);
        
        playSound('ui');
        restoreBtn.innerText = isEn ? '✔ RESTORED' : '✔ RESTAURADO';
        setTimeout(() => restoreBtn.style.display = 'none', 1000); 
      }
    };
  } else {
    navBar.style.display = 'none';
  }
}

const keys = { left: false, right: false }; const projectiles = []; 
const projectileGeo = new THREE.TorusGeometry(0.3, 0.05, 4, 16); // 📡 Onda de Ping de datos
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
// ==========================================
// 🔥 MUTADOR DE HUD (JUEGOS OTROS)
// ==========================================
const originalHUD = {
  lives: 'SEÑAL', level: 'NIVEL', files: 'ARCHIVOS', combo: 'COMBO'
};

function morphHUD(mode) {
  const lblLives = document.getElementById('label-lives');
  const lblLevel = document.getElementById('label-level');
  const lblFiles = document.getElementById('label-files');
  const lblCombo = document.getElementById('label-combo');

  if (mode === 'sintonizar') {
    if (lblLives) lblLives.innerText = 'RUIDO';
    if (lblLevel) lblLevel.innerText = 'FRECUENCIA';
    if (lblFiles) lblFiles.innerText = 'AMPLITUD';
    if (lblCombo) lblCombo.innerText = 'RESONANCIA';
  } 
  else if (mode === 'enrutar') {
    if (lblLives) lblLives.innerText = 'TENSIÓN';
    if (lblLevel) lblLevel.innerText = 'NODOS';
    if (lblFiles) lblFiles.innerText = 'FLUJO';
    if (lblCombo) lblCombo.innerText = 'RESISTENCIA';
  }
  else if (mode === 'renunciar') {
    if (lblLives) lblLives.innerText = 'CARGA';
    if (lblLevel) lblLevel.innerText = 'ENTROPÍA';
    if (lblFiles) lblFiles.innerText = 'DESCARTADO';
    if (lblCombo) lblCombo.innerText = 'AGILIDAD';
  }
  else if (mode === 'normal') {
    // Restaura respetando si el usuario está en Inglés o Español
    const lang = dict[window.currentLang];
    if (lblLives) lblLives.innerText = lang.hudLives || originalHUD.lives;
    if (lblLevel) lblLevel.innerText = originalHUD.level;
    if (lblFiles) lblFiles.innerText = lang.hudFiles || originalHUD.files;
    if (lblCombo) lblCombo.innerText = originalHUD.combo;
  }
}
const raycaster = new THREE.Raycaster(); 
let targetFov = 75; 
window.addEventListener('click', (e) => {
  if (window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive) return; // 🎮 el raycaster ignora .visible: sin esto se abrían planetas ocultos
  if (isUIOpen && !e.target.closest('.modal-ui') && !e.target.closest('.control-btn') && !e.target.closest('#side-menu') && !e.target.closest('.carousel-btn') && !e.target.closest('#ach-panel') && !e.target.closest('#sov-ceremony')) {
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
    
    // 🔥 1. INTERCEPTOR DE ANOMALÍA (Juego: Sintonización)
    if (data.id === 999) {
      window.isZooming = true;
      playSound('boss_hit'); // Cuenco grave y suave al entrar (antes: 'damage', un golpe eléctrico áspero)
      
      if (typeof window.startTuningGame === 'function') window.startTuningGame(data);
      
      setTimeout(() => { window.isZooming = false; }, 350);
      return; // CRÍTICO: Evita que se abra el modal 2D normal
    }

    // 🔥 2. INTERCEPTOR DE OTROS "JUEGOS OTROS" (Para el futuro)
    const techArray = data.tech && typeof data.tech === 'object' ? (data.tech.es || data.tech) : [];
    if (techArray.includes('Juegos Otros')) {
      // Futuros juegos (Telar, Renuncia) irán aquí
    }
// 🔥 2. INTERCEPTOR DE GALERÍA (Juego: Cacharreo / Telar)
    if (data.id === 7) {
      window.isZooming = true;
      playSound('boss_hit'); // Sonido pesado de hardware
      if (typeof window.startWiringGame === 'function') window.startWiringGame(data);
      setTimeout(() => { window.isZooming = false; }, 350);
      return; 
    }
    // 🌌 3. COMPORTAMIENTO NORMAL
    window.isZooming = true;
    targetFov = 25; 
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
      // 🔥 Si flota LIBRE en el vacío (no anclado a un planeta): arranca La Hoguera de Datos
      //    En el modo CARRUSEL el Viajero nunca queda libre (siempre hay un planeta a <35 u), así que allí se desbloquea con la pista del Oráculo:
      //    tras el susurro, el siguiente toque abre la hoguera.
      if ((!window.travelerGroup.userData.anchoredPlanet || window._hogueraReady) && window.startHogueraGame && !window.isHogueraActive) { window._hogueraReady = false; window.startHogueraGame(); return; }
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
      // Cada 4º clic susurra cómo llegar a su secreto
      window._oraculoClicks = (window._oraculoClicks || 0) + 1;
      const pistaHoguera = isAligned
        ? (window.currentLang === 'en' ? "Stay with me a moment. A fire burns beside me: touch me once more." : "Quédate un momento conmigo. Junto a mí arde una hoguera: tócame una vez más.")
        : (window.currentLang === 'en' ? "Take me far from every planet, where no light reaches. Perhaps I will light a fire." : "Llévame lejos de todo planeta, donde la luz no alcanza. Quizá encienda una hoguera.");
      if (window._oraculoClicks % 4 === 0 && isAligned) window._hogueraReady = true;
      const fraseElegida = (window._oraculoClicks % 4 === 0) ? pistaHoguera : oraculoFrases[Math.floor(Math.random() * oraculoFrases.length)];
      
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
xrController2.addEventListener('select', () => { if (window.arTryExit) window.arTryExit(xrController2); });   // el segundo controlador también puede pulsar SALIR AR


let arModelIndex = 0; 
window.spawnedObjects = []; 

xrController1.addEventListener('select', (event) => {
  if (window.isARSession) {
    if (window.arTryExit && window.arTryExit(xrController1)) return;               // botón SALIR AR flotante
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
          // Segundo toque: Eliminar definitivamente (el material es COMPARTIDO con la plantilla: se devuelve su color antes)
          obj.traverse((child) => {
            if (child.isMesh && child.material && child.material.uniforms && child.material.uniforms.color && child.userData.originalColor !== undefined) child.material.uniforms.color.value.setHex(child.userData.originalColor);
          });
          obj.userData.markedForDeletion = false;
          scene.remove(obj);
          window.spawnedObjects.splice(window.spawnedObjects.indexOf(obj), 1);
          playSound('explosion'); 
          showSystemToast('OBJETO ELIMINADO', '#00ffaa');
        } else {
          // Primer toque: Marcar en rojo y avisar
          obj.userData.markedForDeletion = true;
          playSound('ui');
          showSystemToast('⚠️ TOCA DE NUEVO PARA CONFIRMAR ELIMINACIÓN', '#fffcfc');
          
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

// ============================================================
// 🎠 CARRUSEL 3D: una "ranura" por objeto del anillo
//   0..N-1  planetas normales  |  N  planeta D.A.C.  |  N+1  anomalía (solo tras descubrirla)
// ============================================================
function carouselNormalCount() { return categoryPlanets.length - 1; } // la anomalía (id 999) es siempre la última
function carouselSlots() {
  const found = typeof secretDiscovered !== 'undefined' && secretDiscovered;
  return carouselNormalCount() + 1 + (found ? 1 : 0);
}
function carouselSlotOf(obj) {
  if (obj === planetaDAC) return carouselNormalCount();
  if (obj && obj.userData && obj.userData.id === 999) return carouselNormalCount() + 1;
  return categoryPlanets.indexOf(obj);
}
// Ajusta el ángulo para que UNA ranura quede exactamente al frente (π/2), no entre dos planetas
function carouselSnap(angle) {
  const step = (Math.PI * 2) / carouselSlots();
  return Math.PI / 2 - Math.round((Math.PI / 2 - angle) / step) * step;
}

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
// ⚔ ESPADA DE PULSOS — se desbloquea al derrotar al Núcleo corrupto
// ------------------------------------------------------------
//  • Hoja piramidal con filo luminoso, guarda de alas triangulares, anillos de pulso que
//    suben por la hoja y esquirlas en órbita (mismo tramado que el cuerpo del viajero).
//  • Con ella, el TAJO (tecla Q o el botón de la espada) APAGA el modo creativo activo:
//    Máquina Poética / Errática / Fricción y el modo Retro B&W, con una onda de pulsos.
//  • El desbloqueo se guarda en localStorage ('gamelab_unlocks').
// ============================================================
const UNLOCKS_KEY = 'gamelab_unlocks';
function readUnlocks() { try { return JSON.parse(localStorage.getItem(UNLOCKS_KEY)) || {}; } catch (e) { return {}; } }
function writeUnlocks(o) { try { localStorage.setItem(UNLOCKS_KEY, JSON.stringify(o)); } catch (e) {} }
window.pulseSword = { unlocked: !!readUnlocks().pulseSword, equipped: false, parts: null, slash: null };

function buildPulseSword() {
  const sword = new THREE.Group();
  const glow = (mult) => {
    const m = new THREE.MeshBasicMaterial({ color: 0x66f5ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    m.color.multiplyScalar(mult); // pasa el umbral del Bloom
    return m;
  };

  // Hoja: pirámide de 4 caras, punta arriba. Comparte material con la espada original,
  // así sus animaciones de color (saludo, máquinas) siguen funcionando.
  const bladeGeo = new THREE.ConeGeometry(0.16, 3.3, 4);
  bladeGeo.rotateY(Math.PI / 4);
  const blade = new THREE.Mesh(bladeGeo, window.travelerSwordMat);
  blade.position.y = 0.35;
  sword.add(blade);

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bladeGeo), new THREE.LineBasicMaterial({ color: 0x9ffaff, transparent: true, opacity: 0.9 }));
  edges.position.y = 0.35;
  sword.add(edges);

  const core = new THREE.Mesh(new THREE.BoxGeometry(0.035, 3.0, 0.035), glow(2.6));
  core.position.y = 0.35;
  sword.add(core);

  // Guarda: dos alas triangulares y pomo octaédrico
  const wingGeo = new THREE.ConeGeometry(0.17, 1.15, 3);
  [-1, 1].forEach(s => {
    const w = new THREE.Mesh(wingGeo, makeTravelerDither(0xffffff));
    w.rotation.z = -s * Math.PI / 2;
    w.position.set(s * 0.58, -1.3, 0);
    sword.add(w);
  });
  const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.19, 0), makeTravelerDither(0xffffff));
  pommel.position.y = -1.85;
  sword.add(pommel);

  // Anillos de pulso que ascienden por la hoja
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.014, 6, 40), glow(2.2));
    r.rotation.x = Math.PI / 2;
    sword.add(r);
    rings.push(r);
  }

  // Esquirlas en órbita
  const orbit = new THREE.Group();
  orbit.position.y = 0.35;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.085, 0), makeTravelerDither(i % 2 ? 0xffffff : 0x66f5ff));
    s.position.set(Math.cos(a) * 0.55, ((i % 3) - 1) * 0.7, Math.sin(a) * 0.55);
    orbit.add(s);
  }
  sword.add(orbit);

  // Clic sobre la espada = clic sobre el viajero
  sword.traverse(o => { o.userData = Object.assign({}, o.userData, { name: 'viajero' }); });
  sword.userData.parts = { blade, edges, core, rings, orbit };
  return sword;
}

function equipPulseSword() {
  const tg = window.travelerGroup, ps = window.pulseSword;
  if (!tg || ps.equipped) return;
  const old = window.travelerSword;
  const sword = buildPulseSword();
  if (old) { sword.position.copy(old.position); sword.rotation.copy(old.rotation); tg.remove(old); }
  else { sword.position.set(0.6, 0.2, 0.5); sword.rotation.set(Math.PI / 8, 0, Math.PI / -6); }
  tg.add(sword);
  window.travelerSword = sword;
  ps.equipped = true;
  ps.parts = sword.userData.parts;
}

// Se llama en cada cuadro desde la actualización del viajero
function updateSwordFX(t) {
  updatePulseFX();
  const ps = window.pulseSword;
  if (!ps || !ps.equipped || !ps.parts) return;
  const { rings, orbit, core } = ps.parts;
  for (let i = 0; i < rings.length; i++) {
    const k = (t * 0.55 + i / rings.length) % 1;
    const s = Math.sin(k * Math.PI);
    rings[i].position.y = -1.1 + k * 3.0;
    rings[i].scale.setScalar(0.7 + s * 0.9);
    rings[i].material.opacity = s * 0.85;
  }
  orbit.rotation.y = t * 1.7;
  core.material.opacity = 0.75 + Math.sin(t * 4) * 0.2;
  if (ps.slash) { // el tajo barre un arco y la espada vuelve a su pose
    const k = Math.min(1, (performance.now() - ps.slash.start) / ps.slash.dur);
    if (window.travelerSword) window.travelerSword.rotation.z = ps.slash.base - Math.sin(k * Math.PI) * 2.4;
    if (k >= 1) ps.slash = null;
  }
}

// Apaga el modo creativo activo y devuelve la lista de los que estaban encendidos
function deactivateCreativeModes() {
  const off = [];
  if (isPoeticaActive) off.push('poetica');
  if (isErraticaActive) off.push('erratica');
  if (isFriccionActive) off.push('friccion');
  if (isRetroMode) off.push('retro');
  if (!off.length) return off;

  isPoeticaActive = false; isErraticaActive = false; isFriccionActive = false;
  if (typeof window.stopDacMachines === 'function') { try { window.stopDacMachines(); } catch (e) {} }

  // Mismo "seguro antibug" que usan las lunas al apagarse
  categoryPlanets.forEach(p => {
    if (p.userData.id !== 999 && p.material && p.material.color && p.userData.originalColor) {
      p.material.color.setHex(p.userData.visited ? 0x555555 : p.userData.originalColor);
      if (!p.userData.visited) p.material.color.multiplyScalar(1.8);
      p.material.opacity = 0.95;
    }
  });
  lunaPoetica.scale.set(1, 1, 1); lunaErratica.scale.set(1, 1, 1); lunaFriccion.scale.set(1, 1, 1);
  document.body.style.cursor = 'default';
  if (window.travelerSwordMat) window.travelerSwordMat.color.setHex(0xffffff);
  if (window.travelerSword) window.travelerSword.rotation.z = Math.PI / -6;
  if (isRetroMode) { const r = document.getElementById('menu-retro'); if (r) r.click(); }
  return off;
}

function performSwordSlash() {
  const ps = window.pulseSword;
  if (!ps || !ps.unlocked || !window.travelerGroup) return;
  // evita apilar tajos, pero nunca se queda bloqueado si la animación dejó de actualizarse (pausa, modo ejecutivo…)
  if (ps.slash && performance.now() - ps.slash.start < ps.slash.dur + 120) return;
  ps.slash = null;
  if (!ps.equipped) equipPulseSword();
  const off = deactivateCreativeModes();
  unlockAchievement('slash');
  if (off.length) unlockAchievement('dispel');
  const sw = window.travelerSword;
  ps.slash = { start: performance.now(), dur: 520, base: sw ? sw.rotation.z : Math.PI / -6 };

  const p = new THREE.Vector3();
  window.travelerGroup.getWorldPosition(p);
  p.y += 0.8;
  createExplosion(p.x, p.y, p.z, off.length ? 2.2 : 1.1, off.length ? 0x9ffaff : 0xffffff);

  // Arco del tajo, de cara a la cámara
  const arcMat = new THREE.MeshBasicMaterial({ color: 0x9ffaff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.06, 6, 48, Math.PI * 0.85), arcMat);
  arc.position.copy(p);
  if (typeof camera !== 'undefined' && camera.getWorldQuaternion) camera.getWorldQuaternion(arc.quaternion);
  arc.rotateZ(Math.PI * 0.55);
  arc.visible = false;
  scene.add(arc);
  pulseFX.push({ mesh: arc, born: performance.now(), dur: 520, from: 0.5, max: 1.25, alpha: 0.9, ownGeo: true });

  if (typeof playSound === 'function') playSound(off.length ? 'double_pulse' : 'pulse');
  if (typeof showSystemToast === 'function') {
    const en = window.currentLang === 'en';
    const names = { poetica: en ? 'Poetic Machine' : 'Máquina Poética', erratica: en ? 'Erratic Machine' : 'Máquina Errática',
                    friccion: en ? 'Friction Machine' : 'Máquina Fricción', retro: 'Retro B&W' };
    showSystemToast(off.length
      ? `⚔ ${en ? 'SLASH · DISPELLED' : 'TAJO · SE DISIPA'}: ${off.map(k => names[k]).join(', ')}`
      : (en ? '⚔ No creative mode is active' : '⚔ Ningún modo creativo activo'), '#9ffaff');
  }
}

function ensureSwordButton() {
  if (!window.pulseSword.unlocked) return null;
  let b = document.getElementById('btn-sword');
  if (b) return b;
  b = document.createElement('button');
  b.id = 'btn-sword';
  b.type = 'button';
  const en = window.currentLang === 'en';
  b.title = en ? 'Pulse slash (Q): dispels the active creative mode' : 'Tajo de pulso (Q): disipa el modo creativo activo';
  b.setAttribute('aria-label', b.title);
// 🔥 ICONO GEOMÉTRICO (Estilo Antena / Resonador)
  b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="pointer-events:none"><g transform="rotate(45 12 12)"><path d="M12 .9l1 4.2v10.5h-2V5.1z" fill="currentColor" fill-opacity=".12"/><path d="M12 5.8v8.8" opacity=".5"/><path d="M6.8 16.3h10.4M6.8 16.3q-.1-1 .9-1.3M17.2 16.3q.1-1-.9-1.3"/><path d="M11.3 16.8h1.4v3.3h-1.4z"/><circle cx="12" cy="21.3" r=".95"/></g></svg>';  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); b.blur(); performSwordSlash(); });
  document.body.appendChild(b);
  // brilla cuando hay algún modo creativo que se pueda disipar
  setInterval(() => b.classList.toggle('is-ready', !!(isPoeticaActive || isErraticaActive || isFriccionActive || isRetroMode)), 400);
  return b;
}

function unlockPulseSword() {
  const ps = window.pulseSword;
  if (ps.unlocked) return;
  ps.unlocked = true;
  const u = readUnlocks(); u.pulseSword = true; writeUnlocks(u);
  unlockAchievement('boss');
  setTimeout(() => {
    equipPulseSword();
    ensureSwordButton();
    if (window.travelerGroup) {
      const p = new THREE.Vector3();
      window.travelerGroup.getWorldPosition(p);
      createExplosion(p.x, p.y + 0.8, p.z, 2.6, 0x9ffaff);
    }
    if (typeof playSound === 'function') playSound('double_pulse');
    if (typeof showSystemToast === 'function') {
      const en = window.currentLang === 'en';
      showSystemToast(en ? '⚔ PULSE SWORD UNLOCKED · press Q to dispel a creative mode' : '⚔ ESPADA DE PULSOS DESBLOQUEADA · pulsa Q para disipar un modo creativo', '#9ffaff');
    }
  }, 2200);
}

window.addEventListener('keydown', (e) => {
  if ((e.key === 'q' || e.key === 'Q') && window.pulseSword.unlocked) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (typeof isTerminalMode !== 'undefined' && isTerminalMode) return;
    performSwordSlash();
  }
});


// ============================================================
// ✦ LOGROS
// ------------------------------------------------------------
//  • Reúnen lo que antes eran premios sueltos: el MODO INVERTIDO (antes un botón cian flotante que
//    aparecía al encontrar los 13 archivos) y la ESPADA DE PULSOS (al vencer al Núcleo corrupto).
//    Ahora son las recompensas de dos logros y se gestionan desde el menú lateral y el panel.
//  • Se guardan en localStorage ('gamelab_unlocks' → ach). Los de estado se detectan cada 700 ms
//    sin tocar los manejadores existentes; los de evento (tajo, jefe intacto, ranking, modo
//    ejecutivo) se avisan desde su propio punto del código.
// ============================================================
const ACHIEVEMENTS = [
  { id: 'first',        es: ['Primer contacto', 'Abre tu primer archivo.'],                          en: ['First contact', 'Open your first file.'] },
  { id: 'cartographer', es: ['Cartógrafo', 'Encuentra los 13 archivos del universo.'],               en: ['Cartographer', 'Find all 13 files in the universe.'],
    reward: { es: 'Recompensa: Modo invertido', en: 'Reward: Inverted mode' } },
  { id: 'anomaly', secret: true, es: ['A tus espaldas', 'Descubre la anomalía.'],                     en: ['Behind you', 'Discover the anomaly.'] },
  { id: 'core',         es: ['Dentro del núcleo', 'Entra al planeta D.A.C.'],                        en: ['Inside the core', 'Enter the D.A.C. planet.'] },
  { id: 'poetica',      es: ['Poeta', 'Activa la Máquina Poética.'],                                  en: ['Poet', 'Activate the Poetic Machine.'] },
  { id: 'erratica',     es: ['Error fértil', 'Activa la Máquina Errática.'],                          en: ['Fertile error', 'Activate the Erratic Machine.'] },
  { id: 'friccion',     es: ['Peso propio', 'Activa la Máquina Fricción.'],                           en: ['Own weight', 'Activate the Friction Machine.'] },
  { id: 'trio',         es: ['Tres máquinas', 'Activa las tres máquinas creativas.'],                 en: ['Three machines', 'Activate all three creative machines.'] },
  { id: 'retro',        es: ['Fósforo', 'Activa el modo Retro B&W.'],                                 en: ['Phosphor', 'Activate Retro B&W mode.'] },
  { id: 'painter',      es: ['Pintor del vacío', 'Pinta sobre el espacio.'],                          en: ['Painter of the void', 'Paint on empty space.'] },
{ id: 'combo',        es: ['Ritmo', 'Logra una sincronización x10.'],                                 en: ['Rhythm', 'Reach a x10 sync.'] },
  { id: 'boss',         es: ['Núcleo calibrado', 'Estabiliza el Núcleo Descalibrado.'],                 en: ['Core calibrated', 'Stabilize the Uncalibrated Core.'],
    reward: { es: 'Recompensa: Emisor de Pulsos', en: 'Reward: Pulse Emitter' } },
  { id: 'untouched',    es: ['Señal prístina', 'Calibra el núcleo sin perder integridad de red.'],      en: ['Pristine signal', 'Calibrate the core without losing network integrity.'] },
  { id: 'slash',        es: ['Resonancia', 'Usa el Emisor de Pulsos.'],                                 en: ['Resonance', 'Use the Pulse Emitter.'] },
  { id: 'dispel',       es: ['Disipación', 'Apaga un modo creativo con el emisor.'],                    en: ['Dispelled', 'Turn off a creative mode with the emitter.'] },  { id: 'hall',         es: ['Salón de la Fama', 'Registra tu puntaje.'],                             en: ['Hall of Fame', 'Register your score.'] },
  { id: 'twoWorlds',    es: ['Dos mundos', 'Recorre el archivo ejecutivo y el universo 3D.'],         en: ['Two worlds', 'Explore both the executive archive and the 3D universe.'] },
  { id: 'reader',       es: ['Lector atento', 'Lee tres proyectos en el archivo ejecutivo.'],         en: ['Attentive reader', 'Read three projects in the executive archive.'] },
  { id: 'polyglot',     es: ['Políglota', 'Cambia el idioma del universo.'],                          en: ['Polyglot', 'Change the universe language.'] },
  { id: 'sovereignty', secret: true, es: ['Soberanía', 'Alcanza la madurez del sistema (100%).'], en: ['Sovereignty', 'Reach system maturity (100%).'], reward: { es: 'Insignia de Sistema', en: 'System Badge' } }
];
const ACH = { got: Object.assign({}, readUnlocks().ach), initialLang: null, toggles: 0, open: false, lastLang: null };
if (window.pulseSword.unlocked && !ACH.got.boss) ACH.got.boss = Date.now();            // quien ya tenía la espada, ya tiene el logro
if (readUnlocks().invertedMode && !ACH.got.cartographer) ACH.got.cartographer = Date.now();

const achEsc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const achCount = () => ACHIEVEMENTS.filter(a => ACH.got[a.id]).length;

// ---------- Siluetas y categorías ----------
// Cada logro tiene su silueta propia (rejilla 24×24, trazo fino y relleno tenue): bloqueado se ve apagada y
// desbloqueado brilla; en el aviso emergente el contorno se dibuja trazo a trazo.
const ACH_ICONS = {
  first:        '<path d="M7 3h7l4 4v14H7z" fill="currentColor" fill-opacity=".12"/><path d="M14 3v4h4"/><circle cx="12.5" cy="14.5" r="1.7"/>',
  cartographer: '<circle cx="12" cy="12" r="9"/><path d="M15.8 8.2 13.6 13.6 8.2 15.8 10.4 10.4z" fill="currentColor" fill-opacity=".2"/><circle cx="12" cy="12" r=".8" fill="currentColor"/><path d="M12 3v1.8M12 19.2V21M3 12h1.8M19.2 12H21"/>',
  anomaly:      '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="currentColor" fill-opacity=".1"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><path d="M12 1.8v1.9M5 3.8l1.2 1.5M19 3.8l-1.2 1.5"/>',
  core:         '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.2" fill="currentColor" fill-opacity=".1"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/>',
  poetica:      '<path d="M12 4 20 18H4z" fill="currentColor" fill-opacity=".1"/><path d="M12 4v9.6M4 18l8-4.4M20 18l-8-4.4"/><circle cx="12" cy="4" r="1.5" fill="currentColor"/><circle cx="20" cy="18" r="1.5" fill="currentColor"/><circle cx="4" cy="18" r="1.5" fill="currentColor"/>',
  erratica:     '<path d="M5 5.5h8.5v5.5H5z"/><path d="M10.5 13h8.5v5.5h-8.5z" fill="currentColor" fill-opacity=".16"/><path d="M2.5 9h2M17 8h4M6 20.5h3M14 3h4"/>',
  friccion:     '<path d="M4.5 20.5h15"/><path d="m7 20.5 1.6-7.5h6.8l1.6 7.5z" fill="currentColor" fill-opacity=".14"/><path d="M10.2 13a1.8 1.8 0 0 1 3.6 0"/><path d="M12 3v5.5M9.5 6.5 12 9l2.5-2.5"/>',
  trio:         '<circle cx="9" cy="10" r="5"/><circle cx="15" cy="10" r="5"/><circle cx="12" cy="15.5" r="5"/>',
  retro:        '<rect x="3" y="4" width="18" height="13" rx="2" fill="currentColor" fill-opacity=".08"/><path d="M6.5 8h11M6.5 11h11M6.5 14h7"/><path d="M9 20.5h6M12 17v3.5"/>',
  painter:      '<path d="M3.5 17c3.2-9.5 6.3 3 9.3-5.5s5.2 2 7.2-4"/><circle cx="20" cy="6" r="1.7" fill="currentColor"/><path d="M4 21h8" opacity=".5"/>',
  combo:        '<path d="M4 12v0.1M7.3 8.5v7M10.6 4.5v15M13.9 8v8M17.2 6v12M20.2 11v2"/>',
  boss:         '<path d="M12 2.5 21.5 12 12 21.5 2.5 12z" fill="currentColor" fill-opacity=".1"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
  untouched:    '<path d="M12 3 19.5 6v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" fill="currentColor" fill-opacity=".1"/><path d="m8.8 12 2.4 2.4 4.2-4.8"/>',
slash:        '<g transform="rotate(45 12 12)"><path d="M12 .9l1 4.2v10.5h-2V5.1z" fill="currentColor" fill-opacity=".12"/><path d="M12 5.8v8.8" opacity=".5"/><path d="M6.8 16.3h10.4M6.8 16.3q-.1-1 .9-1.3M17.2 16.3q.1-1-.9-1.3"/><path d="M11.3 16.8h1.4v3.3h-1.4z"/><circle cx="12" cy="21.3" r=".95"/></g>',  dispel:       '<path d="M12 3a9 9 0 0 1 8.4 5.9"/><path d="M20.9 13.6a9 9 0 0 1-6.6 6.9"/><path d="M9.4 20.6A9 9 0 0 1 3.3 10.4"/><circle cx="12" cy="12" r="2.3" fill="currentColor"/><path d="M12 7v1.6M12 15.4V17M7 12h1.6M15.4 12H17"/>',
  hall:         '<path d="M8 4h8v5a4 4 0 0 1-8 0z" fill="currentColor" fill-opacity=".1"/><path d="M8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5A3 3 0 0 1 16 10.5"/><path d="M12 13v4M10 17h4v3.5h-4zM8.5 20.5h7"/>',
  twoWorlds:    '<circle cx="8.5" cy="12" r="5.5"/><circle cx="15.5" cy="12" r="5.5" fill="currentColor" fill-opacity=".12"/>',
  reader:       '<path d="M3.5 5.5C6 4.5 9.5 4.5 12 6c2.5-1.5 6-1.5 8.5-.5V19c-2.5-1-6-1-8.5.5-2.5-1.5-6-1.5-8.5-.5z" fill="currentColor" fill-opacity=".08"/><path d="M12 6v13.5"/>',
  polyglot:     '<path d="M3.5 4.5h11v8H8.5l-3 3v-3h-2z" fill="currentColor" fill-opacity=".1"/><path d="M9.5 14.5v1.5h5l3 3v-3h3v-8h-5"/>',
    sovereignty:  '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>', // Geometría sublime apilada
  secret:       '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.6a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1 .9-1 1.8"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
  trophy:       '<path d="M8 4h8v5a4 4 0 0 1-8 0z" fill="currentColor" fill-opacity=".1"/><path d="M8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5A3 3 0 0 1 16 10.5"/><path d="M12 13v4M10 17h4v3.5h-4zM8.5 20.5h7"/>'

};

const ACH_CATS = {
  first: 'explore', cartographer: 'explore', anomaly: 'explore', core: 'explore',
  poetica: 'create', erratica: 'create', friccion: 'create', trio: 'create', retro: 'create', painter: 'create',
  combo: 'combat', boss: 'combat', untouched: 'combat', slash: 'combat', dispel: 'combat',
  hall: 'system', twoWorlds: 'system', reader: 'system', polyglot: 'system', sovereignty: 'system'
};
const ACH_CAT_LABEL = {
  explore: { es: 'Exploración', en: 'Exploration' }, create: { es: 'Creación', en: 'Creation' },
  combat:  { es: 'Sincronización', en: 'Sync' },     system: { es: 'Sistema',   en: 'System' } // 🔥 Pasó de "Combate" a "Sincronización"
};
function achIconSVG(id) {
  const inner = (ACH_ICONS[id] || ACH_ICONS.trophy).replace(/<(path|circle|rect|line|ellipse|polyline|polygon)\b/g, '<$1 pathLength="1"');
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
}

// ---------- Aviso emergente (estilo Steam, con la estética del universo) ----------
const achToast = { queue: [], busy: false, overflow: 0 };
function queueAchievementPopup(def) {
  if (achToast.queue.length >= 3) { achToast.overflow++; return; } // si llegan muchos de golpe, se resumen en uno
  achToast.queue.push({ def });
  pumpAchievementPopups();
}
function buildAchievementToast(item) {
  const en = window.currentLang === 'en';
  let id, name, desc, cat, reward = '';
  if (item.summary) {
    id = 'trophy'; cat = 'system';
    name = en ? `+${item.summary} more achievements` : `+${item.summary} logros más`;
    desc = en ? 'Open the panel to see them.' : 'Abre el panel para verlos.';
  } else {
    const d = item.def; id = d.id; cat = ACH_CATS[id] || 'system';
    [name, desc] = en ? d.en : d.es;
    if (d.reward) reward = en ? d.reward.en : d.reward.es;
  }
  const el = document.createElement('div');
  el.className = 'ach-toast' + (reward ? ' is-reward' : '');
  el.setAttribute('role', 'status');
  el.dataset.id = item.summary ? '' : id;
  el.innerHTML = `<div class="ach-ico">${achIconSVG(id)}</div>
    <div class="ach-t-body">
      <span class="ach-t-kicker">${en ? 'Achievement unlocked' : 'Logro desbloqueado'}<span class="ach-t-cat"> · ${achEsc(ACH_CAT_LABEL[cat][en ? 'en' : 'es'])}</span></span>
      <strong>${achEsc(name)}</strong>
      <span class="ach-t-desc">${achEsc(desc)}</span>
      ${reward ? `<em class="ach-t-reward">${achEsc(reward)}</em>` : ''}
    </div>
    <span class="ach-t-count">${achCount()}/${ACHIEVEMENTS.length}</span><i class="ach-t-bar"></i>`;
  return el;
}
function pumpAchievementPopups() {
  if (achToast.busy) return;
  let next = achToast.queue.shift();
  if (!next && achToast.overflow > 0) { next = { summary: achToast.overflow }; achToast.overflow = 0; }
  if (!next) return;
  achToast.busy = true;
  const el = buildAchievementToast(next);
  const life = (next.def && next.def.reward) ? 6800 : 5200;
  el.style.setProperty('--life', life + 'ms');
  document.body.appendChild(el);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    el.classList.add('is-out');
    setTimeout(() => { el.remove(); achToast.busy = false; pumpAchievementPopups(); }, 450);
  };
  el.addEventListener('click', () => { const id = el.dataset.id; close(); openAchievements(id || undefined); });
  setTimeout(close, life);
}

(function injectAchievementsStyle() {
  if (document.getElementById('ach-style')) return;
  const s = document.createElement('style');
  s.id = 'ach-style';
  s.textContent = `
    #ach-panel { position: fixed; inset: 0; z-index: 100020; display: flex; align-items: center; justify-content: center; padding: 20px;
      background: rgba(3,3,6,0.78); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    #ach-panel[hidden] { display: none; }
    #ach-panel .ach-box { position: relative; width: min(640px, 100%); max-height: 88vh; overflow-y: auto; padding: 38px 34px 30px; border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.12); background: rgba(10,10,14,0.94); color: #d9d9e0; touch-action: pan-y; user-select: text; -webkit-user-select: text;
      font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 300; scrollbar-width: thin; scrollbar-color: #2a2a2a transparent; }

    /* Silueta (marco + dibujo) compartida por el panel y el aviso */
    .ach-ico { flex: none; display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; border-radius: 14px; color: #fff;
      border: 1px solid rgba(255,255,255,0.24); background: rgba(255,255,255,0.03); box-shadow: 0 0 18px rgba(255,255,255,0.13), inset 0 0 14px rgba(255,255,255,0.06); }
    .ach-ico svg { width: 30px; height: 30px; fill: none; stroke: currentColor; stroke-width: 1.15; stroke-linecap: round; stroke-linejoin: round; overflow: visible; }

    /* Aviso emergente: abajo al centro en escritorio; en móvil, sobre los controles táctiles y sin tapar la columna de botones de la derecha */
    .ach-toast { position: fixed; left: 50%; bottom: 54px; z-index: 100030; width: min(440px, 92vw); box-sizing: border-box; display: flex; align-items: center; gap: 14px;
      padding: 14px 18px 17px 14px; border-radius: 16px; overflow: hidden; cursor: pointer; transform: translateX(-50%);
      border: 1px solid rgba(255,255,255,0.14); background: rgba(8,8,12,0.9); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      box-shadow: 0 18px 50px rgba(0,0,0,0.55), 0 0 30px rgba(255,255,255,0.06);
      color: #d9d9e0; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 300;
      animation: achIn .7s cubic-bezier(.2,.9,.2,1) both; }
    .ach-toast.is-out { animation: achOut .45s ease-in both; }
    .ach-toast.is-reward { border-color: rgba(160,250,255,0.4); box-shadow: 0 18px 50px rgba(0,0,0,0.55), 0 0 40px rgba(120,240,255,0.16); }
    .ach-toast::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.1) 50%, transparent 65%);
      transform: translateX(-120%); animation: achShine 1.6s ease-out .5s 1 both; }
    .ach-toast .ach-ico { animation: achGlow 2.6s ease-in-out .9s 2; }
    .ach-toast .ach-ico svg * { stroke-dasharray: 1; stroke-dashoffset: 1; animation: achDraw .95s ease-out .35s forwards; }
    .ach-t-body { min-width: 0; flex: 1; }
    .ach-t-kicker { display: block; font-size: .6rem; letter-spacing: .24em; text-transform: uppercase; color: #8c8c99; margin-bottom: 2px; }
    .ach-toast strong { display: block; font-weight: 300; font-size: 1.05rem; letter-spacing: .1em; color: #fff; text-shadow: 0 0 18px rgba(255,255,255,0.25); }
    .ach-t-desc { display: block; font-size: .8rem; color: #9a9aa8; line-height: 1.35; }
    .ach-t-reward { display: block; margin-top: 4px; font-style: normal; font-size: .72rem; letter-spacing: .1em; color: #9ffaff; }
    .ach-t-count { align-self: flex-start; font-size: .62rem; letter-spacing: .18em; color: #77778a; }
    .ach-t-bar { position: absolute; left: 0; bottom: 0; height: 2px; width: 100%; background: rgba(255,255,255,0.7); transform-origin: left; animation: achBar var(--life, 5200ms) linear forwards; }
    @keyframes achIn { from { opacity: 0; transform: translate(-50%, 24px) scale(.97); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
    @keyframes achOut { to { opacity: 0; transform: translate(-50%, 14px) scale(.98); } }
    @keyframes achShine { to { transform: translateX(120%); } }
    @keyframes achDraw { to { stroke-dashoffset: 0; } }
    @keyframes achGlow { 0%, 100% { box-shadow: 0 0 18px rgba(255,255,255,0.13), inset 0 0 14px rgba(255,255,255,0.06); } 50% { box-shadow: 0 0 34px rgba(255,255,255,0.4), inset 0 0 18px rgba(255,255,255,0.14); } }
    @keyframes achBar { to { transform: scaleX(0); } }
    @media (max-width: 768px) {
      .ach-toast { left: 12px; right: 72px; bottom: 118px; width: auto; transform: none; }
      .ach-t-kicker { font-size: .56rem; letter-spacing: .16em; white-space: nowrap; }
      .ach-t-cat { display: none; } /* en móvil no cabe la categoría junto al rótulo */
      @keyframes achIn { from { opacity: 0; transform: translateY(24px) scale(.97); } to { opacity: 1; transform: none; } }
      @keyframes achOut { to { opacity: 0; transform: translateY(14px) scale(.98); } }
    }
    @media (prefers-reduced-motion: reduce) {
      .ach-toast, .ach-toast *, .ach-toast::after { animation: none !important; }
      .ach-toast .ach-ico svg * { stroke-dashoffset: 0; }
    }

    #ach-panel .ach-eyebrow { margin: 0 0 .6rem; font-size: .7rem; letter-spacing: .3em; text-transform: uppercase; color: #888899; }
    #ach-panel h2 { margin: 0 0 .3rem; font-weight: 300; font-size: 1.6rem; letter-spacing: .22em; text-transform: uppercase; color: #fff; text-shadow: 0 0 24px rgba(255,255,255,.14); }
    #ach-panel .ach-sub { margin: 0 0 1.4rem; color: #8c8c99; font-size: .85rem; letter-spacing: .06em; }
    #ach-panel .ach-count { margin: 0; font-size: .74rem; letter-spacing: .2em; text-transform: uppercase; color: #a9a9b6; }
    #ach-panel .ach-bar { height: 2px; margin: .5rem 0 1.4rem; background: rgba(255,255,255,0.1); }
    #ach-panel .ach-bar i { display: block; height: 100%; background: #fff; box-shadow: 0 0 12px rgba(255,255,255,0.6); transition: width .5s ease; }
    #ach-panel ul { list-style: none; margin: 0; padding: 0; }
    #ach-panel .ach-item { display: grid; grid-template-columns: 52px 1fr; gap: 0 .95rem; align-items: center; padding: .8rem 0; border-top: 1px solid rgba(255,255,255,0.07); opacity: .5; transition: opacity .3s; }
    #ach-panel .ach-item:not(.is-got) .ach-ico { color: #7d7d8a; border-color: rgba(255,255,255,0.09); box-shadow: none; }
    #ach-panel .ach-item.is-flash { animation: achFlash 1.8s ease-out 1; }
    @keyframes achFlash { 0% { background: rgba(255,255,255,0.16); } 100% { background: transparent; } }
    #ach-panel .ach-item.is-got { opacity: 1; }
    #ach-panel strong { display: block; font-weight: 400; letter-spacing: .08em; color: #f2f2f6; }
    #ach-panel .ach-item span.ach-desc { display: block; font-size: .85rem; color: #9a9aa8; }
    #ach-panel .ach-item em { display: block; margin-top: .2rem; font-style: normal; font-size: .76rem; letter-spacing: .08em; color: #9ffaff; }
    #ach-panel h3.ach-cat { display: flex; justify-content: space-between; }
    #ach-panel h3.ach-cat span { letter-spacing: .12em; color: #6d6d7a; }
    #ach-panel h3 { margin: 1.8rem 0 .4rem; font-weight: 300; font-size: .72rem; letter-spacing: .26em; text-transform: uppercase; color: #888899; }
    #ach-panel .ach-reward { display: grid; grid-template-columns: 1.6rem 1fr auto; gap: 0 .6rem; align-items: center; padding: .8rem 0; border-top: 1px solid rgba(255,255,255,0.07); }
    #ach-panel .ach-reward small { display: block; color: #8c8c99; font-size: .8rem; }
    #ach-panel button { font-family: inherit !important; font-weight: 300 !important; cursor: pointer; }
    #ach-panel .ach-act { background: transparent !important; border: 1px solid rgba(255,255,255,0.3) !important; border-radius: 999px !important; color: #e7e7ee !important;
      padding: .5rem 1.1rem !important; font-size: .72rem !important; letter-spacing: .18em !important; text-transform: uppercase; box-shadow: none !important; }
    #ach-panel .ach-act:hover { background: rgba(255,255,255,0.08) !important; border-color: rgba(255,255,255,0.6) !important; }
    #ach-panel .ach-close { position: absolute; top: 12px; right: 14px; width: 36px; height: 36px; padding: 0 !important; background: transparent !important; border: 0 !important;
      color: #9a9aa6 !important; font-size: 1.5rem !important; line-height: 1; box-shadow: none !important; }
    #ach-panel .ach-close:hover { color: #fff !important; }
    #ach-panel :focus-visible { outline: 1px solid rgba(255,255,255,0.6); outline-offset: 3px; }
    @media (max-width: 520px) { #ach-panel .ach-box { padding: 34px 20px 24px; } #ach-panel h2 { font-size: 1.3rem; } }
  `;
  document.head.appendChild(s);
})();

// ---------- Desbloqueo ----------
function unlockAchievement(id) {
  const def = ACHIEVEMENTS.find(a => a.id === id);
  if (!def || ACH.got[id]) return false;
  ACH.got[id] = Date.now();
  const u = readUnlocks(); u.ach = ACH.got; writeUnlocks(u);
  const en = window.currentLang === 'en';
  if (id === 'sovereignty') setTimeout(runSovereigntyCeremony, 1500); // la ceremonia reemplaza al aviso normal
  else queueAchievementPopup(def);
  if (typeof playSound === 'function') playSound('levelup');
  if (window.trackEvent) window.trackEvent('Logro', id);
  if (id === 'cartographer') grantInvertedMode();
  updateAchievementsMenu();
  if (ACH.open) renderAchievementsPanel();
  return true;
}

// Recompensa del logro "Cartógrafo": el modo invertido (antes, un botón cian flotante)
function grantInvertedMode() {
  const u = readUnlocks(); u.invertedMode = true; writeUnlocks(u);
  ensureInvertedMenu();
  setTimeout(() => {
    if (typeof showSystemToast === 'function') showSystemToast(window.currentLang === 'en' ? '☯ INVERTED MODE UNLOCKED · side menu' : '☯ MODO INVERTIDO DESBLOQUEADO · menú lateral', '#ffffff');
  }, 1800);
}
function toggleInvertedMode() {
  document.body.classList.toggle('inverted-mode');
  if (typeof playSound === 'function') playSound('ui');
  updateInvertedMenu();
  if (ACH.open) renderAchievementsPanel();
}

// ---------- Menú lateral ----------
function menuList() { const r = document.getElementById('menu-retro'); return r ? { ul: r.closest('ul'), retroLi: r.closest('li') } : null; }
function ensureAchievementsMenu() {
  const m = menuList(); if (!m || !m.ul || document.getElementById('menu-achievements')) return;
  const li = document.createElement('li');
  li.innerHTML = '<a href="#" id="menu-achievements" class="social-item"></a>';
  m.ul.insertBefore(li, m.retroLi);
  li.firstChild.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (typeof sideMenu !== 'undefined') sideMenu.classList.remove('open');
    openAchievements();
  });
  updateAchievementsMenu();
}
function updateAchievementsMenu() {
  const a = document.getElementById('menu-achievements');
  if (a) a.textContent = `✦ ${window.currentLang === 'en' ? 'Achievements' : 'Logros'} · ${achCount()}/${ACHIEVEMENTS.length}`;
}
function ensureInvertedMenu() {
  const m = menuList(); if (!m || !m.ul || document.getElementById('menu-inverted')) return;
  const li = document.createElement('li');
  li.innerHTML = '<a href="#" id="menu-inverted" class="social-item"></a>';
  m.ul.insertBefore(li, m.retroLi.nextSibling);
  li.firstChild.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (typeof sideMenu !== 'undefined') sideMenu.classList.remove('open');
    toggleInvertedMode();
  });
  updateInvertedMenu();
}
function updateInvertedMenu() {
  const a = document.getElementById('menu-inverted'); if (!a) return;
  const on = document.body.classList.contains('inverted-mode'), en = window.currentLang === 'en';
  a.textContent = on ? (en ? '☾ Back to dark mode' : '☾ Volver al modo oscuro') : (en ? '☯ Inverted mode' : '☯ Modo invertido');
}

// ---------- Panel ----------
function buildAchievementsPanel() {
  let p = document.getElementById('ach-panel');
  if (p) return p;
  p = document.createElement('div');
  p.id = 'ach-panel'; p.hidden = true;
  p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true'); p.setAttribute('aria-labelledby', 'ach-title');
  document.body.appendChild(p);
  p.addEventListener('click', (e) => {
    if (e.target === p || e.target.closest('.ach-close')) { closeAchievements(); return; }
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'inverted') toggleInvertedMode();
  });
  // el panel no debe disparar acciones del juego (arrastre, clics sobre planetas)
  ['touchstart', 'touchmove', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel'].forEach(evt => p.addEventListener(evt, (e) => e.stopPropagation(), { passive: true }));
  return p;
}
function renderAchievementsPanel() {
  const p = document.getElementById('ach-panel'); if (!p) return;
  const en = window.currentLang === 'en';
  const got = achCount(), total = ACHIEVEMENTS.length;
  const rowHTML = (a) => {
    const has = !!ACH.got[a.id], hidden = a.secret && !has;
    const [name, desc] = en ? a.en : a.es;
    const reward = a.reward ? (en ? a.reward.en : a.reward.es) : '';
    return `<li class="ach-item${has ? ' is-got' : ''}" data-id="${a.id}"><span class="ach-ico" aria-hidden="true">${achIconSVG(hidden ? 'secret' : a.id)}</span><div>
      <strong>${achEsc(hidden ? '???' : name)}</strong><span class="ach-desc">${achEsc(hidden ? (en ? 'A secret of the universe.' : 'Un secreto del universo.') : desc)}</span>${reward ? `<em>${achEsc(reward)}</em>` : ''}</div></li>`;
  };
  const rows = ['explore', 'create', 'combat', 'system'].map(cat => {
    const items = ACHIEVEMENTS.filter(a => ACH_CATS[a.id] === cat);
    const n = items.filter(a => ACH.got[a.id]).length;
    return `<h3 class="ach-cat">${achEsc(ACH_CAT_LABEL[cat][en ? 'en' : 'es'])} <span>${n}/${items.length}</span></h3><ul>${items.map(rowHTML).join('')}</ul>`;
  }).join('');
  const inverted = document.body.classList.contains('inverted-mode');
  const rewards = [];
  if (ACH.got.cartographer) rewards.push(`<li class="ach-reward"><span aria-hidden="true">☯</span><div><strong>${en ? 'Inverted mode' : 'Modo invertido'}</strong></div>
      <button type="button" class="ach-act" data-act="inverted">${inverted ? (en ? 'Dark mode' : 'Modo oscuro') : (en ? 'Activate' : 'Activar')}</button></li>`);
  if (ACH.got.sovereignty) rewards.push(`<li class="ach-reward"><span class="sov-emblem" style="width:1.6rem;height:1.6rem;display:block" aria-hidden="true">${sovereignEmblemSVG(false)}</span><div><strong>${en ? 'System Badge' : 'Insignia de Sistema'}</strong>
      <small>${en ? 'Shown in the header; a crown of pulses follows the Traveler.' : 'Se muestra en la cabecera; una corona de pulsos acompaña al Viajero.'}</small></div><span></span></li>`);
  if (window.pulseSword.unlocked) rewards.push(`<li class="ach-reward"><span aria-hidden="true">⚔</span><div><strong>${en ? 'Pulse sword' : 'Espada de pulsos'}</strong>
      <small>${en ? 'Press Q or the sword button: dispels the active creative mode.' : 'Pulsa Q o el botón de la espada: disipa el modo creativo activo.'}</small></div><span></span></li>`);
  p.innerHTML = `<div class="ach-box">
      <button type="button" class="ach-close" aria-label="${en ? 'Close' : 'Cerrar'}">×</button>
      <p class="ach-eyebrow">✦</p>
      <h2 id="ach-title">${en ? 'Achievements' : 'Logros'}</h2>
      <p class="ach-sub">${en ? 'What the universe remembers about you.' : 'Lo que el universo recuerda de ti.'}</p>
      <p class="ach-count">${got} / ${total}</p><div class="ach-bar"><i style="width:${Math.round((got / total) * 100)}%"></i></div>
      ${rows}
      ${rewards.length ? `<h3>${en ? 'Rewards' : 'Recompensas'}</h3><ul>${rewards.join('')}</ul>` : ''}
    </div>`;
}
function openAchievements(focusId) {
  const p = buildAchievementsPanel();
  if (!ACH.open) {
    ACH.open = true; isUIOpen = true;
    renderAchievementsPanel();
    p.hidden = false;
    const c = p.querySelector('.ach-close'); if (c) c.focus();
    if (typeof playSound === 'function') playSound('ui');
  }
  if (focusId) { // desde el aviso: lleva al logro y lo resalta
    const li = p.querySelector(`.ach-item[data-id="${focusId}"]`);
    if (li) { li.scrollIntoView({ block: 'center' }); li.classList.remove('is-flash'); void li.offsetWidth; li.classList.add('is-flash'); }
  }
}
function closeAchievements() {
  const p = document.getElementById('ach-panel');
  if (p) p.hidden = true;
  ACH.open = false; isUIOpen = false;
  if (typeof playSound === 'function') playSound('ui');
}
document.addEventListener('keydown', (e) => {
  if (ACH.open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAchievements(); }
}, true);

// ---------- Detección ----------
const ACH_CHECKS = {
  first:        () => foundProjects.size >= 1,
  cartographer: () => foundProjects.size >= totalProjects,
  anomaly:      () => secretDiscovered === true,
  core:         () => planetaDAC.userData.isIsolated === true,
  poetica:      () => isPoeticaActive,
  erratica:     () => isErraticaActive,
  friccion:     () => isFriccionActive,
  trio:         () => !!(ACH.got.poetica && ACH.got.erratica && ACH.got.friccion),
  retro:        () => isRetroMode,
  painter:      () => !!window.isPainting,
  combo:        () => combatCombo >= 10,
  boss:         () => !!window.pulseSword.unlocked,
 polyglot:     () => !!ACH.initialLang && window.currentLang !== ACH.initialLang,
  sovereignty:  () => achCount() >= ACHIEVEMENTS.length - 1
};
setInterval(() => {
  if (document.hidden) return;
  if (!ACH.initialLang && window.currentLang) ACH.initialLang = window.currentLang;
  for (const id in ACH_CHECKS) {
    if (ACH.got[id]) continue;
    try { if (ACH_CHECKS[id]()) unlockAchievement(id); } catch (e) { /* variable aún sin inicializar */ }
  }
  if (ACH.lastLang !== window.currentLang) { ACH.lastLang = window.currentLang; updateAchievementsMenu(); updateInvertedMenu(); if (ACH.open) renderAchievementsPanel(); }
  
// 🔥 INSIGNIA DE SOBERANÍA (100% COMPLETADO): emblema en cabecera + corona sobre el Viajero
  if (ACH.got['sovereignty']) { ensureSovereigntyBadge(); ensureSovereignCrown(); }
}, 700);

// ============================================================
// ✦ INSIGNIA DE SOBERANÍA — se obtiene con TODOS los logros
// ------------------------------------------------------------
//  • EMBLEMA: anillo de marcas giratorio + tres arcos con los colores de las tres máquinas creativas
//    (hueso = Poética, coral = Errática, ámbar = Fricción) alrededor de un diamante con núcleo pulsante.
//  • CEREMONIA: pantalla completa, una sola vez, al desbloquearla (clic / Esc / 14 s para cerrar).
//  • CABECERA: el emblema queda fijo bajo el título; al tocarlo abre el panel de logros.
//  • CORONA DE PULSOS: tres anillos orbitales, un diamante y esquirlas flotan sobre la cabeza del Viajero,
//    para siempre (se restaura sola en cada visita porque el logro se guarda en localStorage).
// ============================================================
(function injectSovereigntyStyle() {
  if (document.getElementById('sov-style')) return;
  const s = document.createElement('style');
  s.id = 'sov-style';
  s.textContent = `
    .sov-emblem { display: block; filter: drop-shadow(0 0 6px rgba(255,102,68,0.55)); }
    .sov-emblem svg { display: block; width: 100%; height: 100%; overflow: visible; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .sov-emblem .sv-ring  { stroke: #e7e4de; stroke-width: 1; opacity: .55; stroke-dasharray: 1.2 3.4; transform-box: fill-box; transform-origin: center; animation: svSpin 48s linear infinite; }
    .sov-emblem .sv-arcs  { transform-box: fill-box; transform-origin: center; animation: svSpinR 36s linear infinite; }
    .sov-emblem .sv-arc   { stroke-width: 3.4; stroke-dasharray: 30 70; }
    .sov-emblem .sv-a1 { stroke: #e7e4de; } .sov-emblem .sv-a2 { stroke: #ff6644; } .sov-emblem .sv-a3 { stroke: #b89947; }
    .sov-emblem .sv-dia   { stroke: #fff; stroke-width: 1.5; fill: rgba(255,102,68,0.12); }
    .sov-emblem .sv-cross { stroke: #e7e4de; stroke-width: 1.2; opacity: .8; }
    .sov-emblem .sv-core  { fill: #ff6644; stroke: none; transform-box: fill-box; transform-origin: center; animation: svPulse 2.8s ease-in-out infinite; }
    .sov-emblem .sv-draw  { stroke-dasharray: 1; stroke-dashoffset: 1; animation: svDraw 1.3s .45s ease-out forwards; }
    @keyframes svSpin  { to { transform: rotate(360deg); } }
    @keyframes svSpinR { to { transform: rotate(-360deg); } }
    @keyframes svPulse { 0%, 100% { transform: scale(1); opacity: .95; } 50% { transform: scale(1.55); opacity: .55; } }
    @keyframes svDraw  { to { stroke-dashoffset: 0; } }

/* Emblema integrado en la cabecera (Adaptable a PC y Móvil) */
    #portfolio-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-start; }
    
    #portfolio-header .sov-badge { 
      display: inline-flex; align-items: center; gap: 6px;
      white-space: nowrap; pointer-events: auto; cursor: pointer; 
      color: #ff6644; font-size: 0.6rem; font-weight: 300; letter-spacing: 0.25em; text-shadow: none;
      padding: 3px 10px 3px 4px; border: 1px solid rgba(255,102,68,0.32); border-radius: 999px; 
      background: rgba(8,8,12,0.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); 
      animation: svBadgeGlow 3.4s ease-in-out infinite;
    }
    #portfolio-header .sov-badge:hover, #portfolio-header .sov-badge:focus-visible { border-color: rgba(255,102,68,0.7); outline: none; }
    @keyframes svBadgeGlow { 0%, 100% { box-shadow: 0 0 0 rgba(255,102,68,0); } 50% { box-shadow: 0 0 16px rgba(255,102,68,0.35); } }

    /* Ajuste específico para pantallas pequeñas (móviles) */
    @media (max-width: 768px) {
      #portfolio-header { 
        flex-wrap: nowrap; /* Mantiene a DANIEL_OS y la insignia rígidamente en la misma línea */
        gap: 6px;
      }
      #portfolio-header > span:not(.sov-badge) { 
        display: none !important; /* Oculta el "// PORTAFOLIO..." en móvil para hacerle espacio a la insignia */
      }
      #portfolio-header .sov-badge { 
        position: static !important; /* Anula posiciones fijas */
        transform: scale(0.85); /* Reduce la insignia sutilmente para móvil */
        transform-origin: left center;
        margin: 0;
      }
    }

    /* Ceremonia */
    #sov-ceremony { position: fixed; inset: 0; z-index: 100060; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; text-align: center; cursor: pointer;
      background: radial-gradient(ellipse at center, rgba(46,16,10,0.84) 0%, rgba(3,3,6,0.95) 72%); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 300; color: #d9d9e0; animation: svFadeIn .8s ease both; }
    #sov-ceremony.is-out { animation: svFadeOut .5s ease both; }
    #sov-ceremony .sov-big { position: relative; width: min(56vw, 230px); height: min(56vw, 230px); animation: svEmblemIn 1.4s cubic-bezier(.2,.9,.2,1) both; }
    #sov-ceremony .sov-big .sov-emblem { width: 100%; height: 100%; filter: drop-shadow(0 0 22px rgba(255,102,68,0.6)); }
    #sov-ceremony .sov-halo { position: absolute; inset: 0; border-radius: 50%; border: 1px solid rgba(255,102,68,0.55); opacity: 0; pointer-events: none; animation: svHalo 3.3s ease-out infinite; }
    #sov-ceremony .sov-c-kicker { margin: 34px 0 0; font-size: .66rem; letter-spacing: .3em; text-transform: uppercase; color: #8c8c99; animation: svRise .9s .8s ease both; }
    #sov-ceremony h2 { margin: 10px 0 8px; font-weight: 300; font-size: clamp(1.4rem, 5.2vw, 2.3rem); letter-spacing: .55em; text-indent: .55em; text-transform: uppercase; color: #fff;
      text-shadow: 0 0 28px rgba(255,102,68,0.5); animation: svRise .9s 1s ease both; }
    #sov-ceremony .sov-c-sub { margin: 0; font-size: .95rem; letter-spacing: .08em; color: #c9c9d3; animation: svRise .9s 1.2s ease both; }
    #sov-ceremony .sov-c-reward { margin: 16px 0 0; font-size: .76rem; letter-spacing: .12em; color: #9ffaff; max-width: 34em; line-height: 1.6; animation: svRise .9s 1.5s ease both; }
    #sov-ceremony .sov-c-hint { margin: 30px 0 0; font-size: .62rem; letter-spacing: .3em; text-transform: uppercase; color: #6d6d7a; animation: svRise .9s 2.2s ease both, svBlink 2.4s 3s ease-in-out infinite; }
    @keyframes svFadeIn  { from { opacity: 0; } to { opacity: 1; } }
    @keyframes svFadeOut { to { opacity: 0; } }
    @keyframes svEmblemIn { from { opacity: 0; transform: scale(.55) rotate(-25deg); } to { opacity: 1; transform: none; } }
    @keyframes svHalo  { 0% { transform: scale(.6); opacity: .9; } 100% { transform: scale(2.4); opacity: 0; } }
    @keyframes svRise  { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
    @keyframes svBlink { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .sov-emblem *, #sov-ceremony, #sov-ceremony *, #portfolio-header .sov-badge { animation: none !important; }
      .sov-emblem .sv-draw { stroke-dasharray: none; stroke-dashoffset: 0; }
      #sov-ceremony .sov-halo { display: none; }
    }
  `;
  document.head.appendChild(s);
})();

function sovereignEmblemSVG(draw) {
  const d = draw ? ' sv-draw' : '';
  return `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle class="sv-ring" cx="60" cy="60" r="56"/>
    <g class="sv-arcs">
      <circle class="sv-arc sv-a1" cx="60" cy="60" r="46" pathLength="100" transform="rotate(-90 60 60)"/>
      <circle class="sv-arc sv-a2" cx="60" cy="60" r="46" pathLength="100" transform="rotate(30 60 60)"/>
      <circle class="sv-arc sv-a3" cx="60" cy="60" r="46" pathLength="100" transform="rotate(150 60 60)"/>
    </g>
    <path class="sv-dia${d}" pathLength="1" d="M60 26 94 60 60 94 26 60Z"/>
    <path class="sv-cross${d}" pathLength="1" d="M60 12v10M60 98v10M12 60h10M98 60h10"/>
    <circle class="sv-core" cx="60" cy="60" r="7"/>
  </svg>`;
}

// ---------- Emblema permanente en la cabecera ----------
function ensureSovereigntyBadge() {
  const header = document.getElementById('portfolio-header');
  if (!header) return;
  const en = window.currentLang === 'en';
  let b = document.getElementById('soberania-badge');
  if (!b) {
    b = document.createElement('span');
    b.id = 'soberania-badge';
    b.className = 'sov-badge';
    b.setAttribute('role', 'button');
    b.tabIndex = 0;
    b.innerHTML = `<span class="sov-emblem" style="width:26px;height:26px">${sovereignEmblemSVG(false)}</span><span class="sov-b-label"></span>`;
    const open = (e) => { e.preventDefault(); e.stopPropagation(); openAchievements('sovereignty'); };
    b.addEventListener('click', open);
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
    // el emblema no debe iniciar arrastres ni clics sobre el universo que hay detrás
    ['mousedown', 'mouseup', 'touchstart', 'touchend', 'pointerdown'].forEach(evt => b.addEventListener(evt, (e) => e.stopPropagation(), { passive: true }));
    header.appendChild(b);
  }
  const txt = `[ ${en ? 'SOVEREIGNTY' : 'SOBERANÍA'} ]`;
  const lbl = b.querySelector('.sov-b-label');
  if (lbl && lbl.textContent !== txt) lbl.textContent = txt;
  const tip = en ? 'System Badge · all achievements' : 'Insignia de Sistema · todos los logros';
  if (b.title !== tip) { b.title = tip; b.setAttribute('aria-label', tip); }
}

// ---------- Corona de pulsos sobre el Viajero ----------
function ensureSovereignCrown() {
  const tg = window.travelerGroup;
  if (!tg || window.sovereignCrown) return;
  const glow = (hex, mult, op) => {
    const m = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    m.color.multiplyScalar(mult); // pasa el umbral del Bloom
    return m;
  };
  const group = new THREE.Group();
  group.position.y = 2.6;

  // Tres anillos finos e inclinados: hueso / coral / ámbar
  const rings = [0xe7e4de, 0xff6644, 0xb89947].map((hex, i) => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.62 + i * 0.13, 0.013, 6, 64), glow(hex, 2.2, 0.85));
    r.userData.baseTilt = Math.PI / 2 + (i - 1) * 0.38;
    r.rotation.x = r.userData.baseTilt;
    r.rotation.y = i * 0.7;
    group.add(r);
    return r;
  });

  // Diamante central (eco del Núcleo corrupto, ahora en coral)
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), makeTravelerDither(0xff6644));
  gem.position.y = 0.04;
  group.add(gem);

  // Esquirlas en órbita
  const shards = new THREE.Group();
  const shardColors = [0xe7e4de, 0xff6644, 0xb89947];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const sh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.065, 0), glow(shardColors[i % 3], 2.4, 0.95));
    sh.position.set(Math.cos(a) * 0.98, ((i % 3) - 1) * 0.28, Math.sin(a) * 0.98);
    shards.add(sh);
  }
  group.add(shards);

  // Un clic en la corona cuenta como clic en el Viajero
  group.traverse(o => { o.userData = Object.assign({}, o.userData, { name: 'viajero' }); });
  tg.add(group);
  window.sovereignCrown = { group, rings, gem, shards };
}

function updateSovereignCrown(t) {
  const c = window.sovereignCrown;
  if (!c) return;
  c.group.position.y = 2.6 + Math.sin(t * 1.6) * 0.06;
  c.group.rotation.y = t * 0.5;
  c.rings.forEach((r, i) => {
    r.rotation.x = r.userData.baseTilt + Math.sin(t * 1.2 + i * 1.7) * 0.22;
    r.material.opacity = 0.62 + Math.sin(t * 2 + i * 1.7) * 0.25;
  });
  c.gem.rotation.y = t * 1.6;
  c.gem.rotation.x = t * 0.7;
  c.shards.rotation.y = -t * 1.15;
}

// ---------- Ceremonia de desbloqueo ----------
function runSovereigntyCeremony() {
  if (document.getElementById('sov-ceremony')) return;
  const en = window.currentLang === 'en';
  const total = ACHIEVEMENTS.length;
  const el = document.createElement('div');
  el.id = 'sov-ceremony';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', en ? 'Sovereignty unlocked' : 'Soberanía desbloqueada');
  el.innerHTML = `
    <div class="sov-big"><i class="sov-halo"></i><i class="sov-halo" style="animation-delay:1.1s"></i><i class="sov-halo" style="animation-delay:2.2s"></i>
      <span class="sov-emblem">${sovereignEmblemSVG(true)}</span></div>
    <p class="sov-c-kicker">${en ? 'Achievement unlocked' : 'Logro desbloqueado'} · ${total} / ${total}</p>
    <h2>${en ? 'Sovereignty' : 'Soberanía'}</h2>
    <p class="sov-c-sub">${en ? 'You reached the maturity of the system.' : 'Alcanzaste la madurez del sistema.'}</p>
    <p class="sov-c-reward">${en ? 'System Badge unlocked · a crown of pulses now floats above the Traveler.' : 'Insignia de Sistema desbloqueada · una corona de pulsos flota ahora sobre el Viajero.'}</p>
    <p class="sov-c-hint">${en ? 'tap to continue' : 'toca para continuar'}</p>`;
  document.body.appendChild(el);
  isUIOpen = true;
  ensureSovereigntyBadge();
  ensureSovereignCrown();

  if (typeof playSound === 'function') {
    setTimeout(() => playSound('double_pulse'), 350);
    setTimeout(() => playSound('pulse'), 1300);
    setTimeout(() => playSound('levelup'), 1900);
  }

  let closed = false, autoClose = null;
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); close(); } };
  function close() {
    if (closed) return; closed = true;
    clearTimeout(autoClose);
    document.removeEventListener('keydown', onKey, true);
    el.classList.add('is-out');
    setTimeout(() => {
      el.remove();
      isUIOpen = document.body.classList.contains('ui-active') || !!ACH.open;
      // tres pulsos (hueso, coral, ámbar) desde el Viajero: el universo "reconoce" la insignia
      const tg = window.travelerGroup;
      if (tg && typeof createExplosion === 'function') {
        const p = new THREE.Vector3(); tg.getWorldPosition(p);
        [[0xe7e4de, 0], [0xff6644, 260], [0xb89947, 520]].forEach(([hex, delay]) => setTimeout(() => createExplosion(p.x, p.y + 1.4, p.z, 3.0, hex), delay));
        shakeIntensity = 0.3;
      }
    }, 500);
  }
  el.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  ['touchstart', 'touchmove', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel'].forEach(evt => el.addEventListener(evt, (e) => e.stopPropagation(), { passive: true }));
  document.addEventListener('keydown', onKey, true);
  autoClose = setTimeout(close, 14000);
}

// Eventos sueltos

ensureAchievementsMenu();
if (ACH.got.cartographer) ensureInvertedMenu();

// Si ya se había desbloqueado en una visita anterior, el viajero nace con ella
if (window.pulseSword.unlocked) { equipPulseSword(); ensureSwordButton(); }


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

  if (window.isHogueraActive && window.hgPose) {
    // ---- LA HOGUERA DE DATOS: el evento controla su pose (de espaldas a la cámara, junto al fuego) ----
    tg.position.copy(window.hgPose.pos);
    tg.quaternion.setFromEuler(_hgEuler.set(0, window.hgPose.yaw, 0));
    const hb = 1 + Math.sin(t * 1.8) * 0.012;
    tg.scale.set(1, hb, 1); tg.visible = true; flareTarget = 0.12;
  } else if (dragging) {
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
  updateSwordFX(t);
  updateSovereignCrown(t);

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
  // 🛟 Red de seguridad: three.js solo programa el SIGUIENTE cuadro si el actual termina sin lanzar. Un solo error
  // (p. ej. leer un elemento que ya se borró de una lista) dejaba el juego congelado para siempre.
  // Ahora el error se registra y el bucle sigue vivo.
  try {
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
    if (reduceMotionMQ.matches) shakeIntensity = 0; // sin sacudidas de cámara con movimiento reducido
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
  // 🎮 Motor de los minijuegos (Sintonización y Telar de circuitos)
  if ((window.isWiringGameActive || window.isTuningGameActive || window.isHogueraActive) && window.updateMiniGames) window.updateMiniGames();
  const now = performance.now(); frames++;
  if (now >= lastTime + 1000) { if((frames * 1000 / (now - lastTime)) < 30) lowFPSCount++; else lowFPSCount = 0;
    // 🔥 ACTUALIZADOR DEL HUD DE COMBO EN TIEMPO REAL
  const comboUi = document.getElementById('combo-value');
  if (comboUi && !window.isTuningGameActive && !window.isWiringGameActive && !window.isHogueraActive) comboUi.innerText = 'x' + (typeof combatCombo !== 'undefined' ? combatCombo : 0);
    if(lowFPSCount > 3 && isBloomEnabled && !isXR) { isBloomEnabled = false; bloomPass.strength = 0; 
      document.getElementById('menu-bloom').innerText = '✨ Efecto Neón: OFF'; 
      document.getElementById('menu-bloom').style.color = '#888'; } frames = 0; lastTime = now; }

  if (isShooting && isGameStarted && !isUIOpen && !isAR && !window.isTuningGameActive && !window.isWiringGameActive && !window.isHogueraActive) { if (now - lastShotTime > FIRE_COOLDOWN) { fireLaser(); lastShotTime = now; } }

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

        // 🔥 Rotación y Reacciones Procedimentales de los Anillos D.A.C.
        const rings = planetaDAC.getObjectByName("dac_rings");
        if (rings) {
          rings.rotation.z -= 0.0035; 

          rings.children.forEach((ring) => {
            const pos = ring.geometry.attributes.position.array;
            const base = ring.geometry.attributes.basePosition.array;
            let needsUpdate = false;

            // Reacción Máquina Poética
            if (ring.userData.type === 'poetica') {
              if (typeof isPoeticaActive !== 'undefined' && isPoeticaActive) {
                ring.scale.setScalar(1.05 + Math.sin(Date.now() * 0.003) * 0.02);
                ring.material.opacity = 0.85;
                ring.material.color.setHex(0xffffff);
                ring.material.color.multiplyScalar(2.0); // Más glow
                ring.rotation.x += 0.015; 
              } else {
                ring.scale.setScalar(1.0);
                ring.material.opacity = 0.5;
                ring.material.color.setHex(ring.userData.baseColor);
                ring.material.color.multiplyScalar(1.5);
              }
            }
            // Reacción Máquina Errática (Tartamudeo real de partículas)
            else if (ring.userData.type === 'erratica') {
              if (typeof isErraticaActive !== 'undefined' && isErraticaActive) {
                ring.material.color.setHex(0xff6644); // Coral brillante
                ring.material.color.multiplyScalar(2.0);
                ring.material.opacity = 0.8;
                
                // Explotar partículas individualmente
                for(let i=0; i<pos.length; i+=3) {
                   if(Math.random() > 0.85) {
                      pos[i] = base[i] * (1 + (Math.random()-0.5)*0.15);
                      pos[i+1] = base[i+1] + (Math.random()-0.5)*0.8;
                      pos[i+2] = base[i+2] * (1 + (Math.random()-0.5)*0.15);
                   } else {
                      pos[i] += (base[i] - pos[i]) * 0.3;
                      pos[i+1] += (base[i+1] - pos[i+1]) * 0.3;
                      pos[i+2] += (base[i+2] - pos[i+2]) * 0.3;
                   }
                }
                needsUpdate = true;
              } else {
                ring.material.opacity = 0.35;
                ring.material.color.setHex(ring.userData.baseColor);
                ring.material.color.multiplyScalar(1.5);
                
                // Curar partículas magnéticamente a su origen
                for(let i=0; i<pos.length; i+=3) {
                   if (Math.abs(pos[i] - base[i]) > 0.01) {
                      pos[i] += (base[i] - pos[i]) * 0.1;
                      pos[i+1] += (base[i+1] - pos[i+1]) * 0.1;
                      pos[i+2] += (base[i+2] - pos[i+2]) * 0.1;
                      needsUpdate = true;
                   }
                }
              }
            }
            // Reacción Máquina de Fricción (Densidad y pesadez)
            else if (ring.userData.type === 'friccion') {
              if (typeof isFriccionActive !== 'undefined' && isFriccionActive) {
                ring.scale.setScalar(0.96); 
                ring.material.color.setHex(0xb89947); 
                ring.material.color.multiplyScalar(1.8);
                ring.material.opacity = 0.5;
                ring.rotation.y -= 0.02; 
              } else {
                ring.scale.setScalar(1.0);
                ring.material.color.setHex(ring.userData.baseColor);
                ring.material.color.multiplyScalar(1.5);
                ring.material.opacity = 0.2;
              }
            }
            
            if(needsUpdate) ring.geometry.attributes.position.needsUpdate = true;
          });
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
      // ===============================================
        // 🔥 REACCIONES FÍSICAS DE LAS LUNAS (Atractores)
        // ===============================================
        [lunaPoetica, lunaErratica, lunaFriccion].forEach(luna => {
          if (!luna || !luna.geometry || !luna.geometry.attributes.basePosition) return;
          
          const pos = luna.geometry.attributes.position.array;
          const base = luna.geometry.attributes.basePosition.array;
          let needsUpdate = false;
          
          if (luna.name === "maquina_poetica") {
            if (typeof isPoeticaActive !== 'undefined' && isPoeticaActive) {
              // Fluye y respira orgánicamente
              for(let i=0; i<pos.length; i+=3) {
                pos[i] = base[i] + Math.sin(Date.now()*0.0015 + base[i+1])*0.15;
                pos[i+1] = base[i+1] + Math.cos(Date.now()*0.0015 + base[i])*0.15;
                pos[i+2] = base[i+2] + Math.sin(Date.now()*0.0015 + base[i+2])*0.15;
              }
              needsUpdate = true;
            } else {
              // Regresa a su forma original
              for(let i=0; i<pos.length; i+=3) {
                if (Math.abs(pos[i] - base[i]) > 0.01) {
                  pos[i] += (base[i] - pos[i]) * 0.1;
                  pos[i+1] += (base[i+1] - pos[i+1]) * 0.1;
                  pos[i+2] += (base[i+2] - pos[i+2]) * 0.1;
                  needsUpdate = true;
                }
              }
            }
          }
          else if (luna.name === "maquina_erratica") {
            if (typeof isErraticaActive !== 'undefined' && isErraticaActive) {
              // 🔥 GLITCH EXAGERADO (Desgarro en bandas y ruido estático)
              for(let i=0; i<pos.length; i+=3) {
                if (Math.random() > 0.4) { 
                  // Desgarro en bloques horizontales violentos
                  const glitchBand = Math.sin(base[i+1] * 10 + Date.now() * 0.01) > 0 ? 1 : -1;
                  const spread = Math.random() * 8; // Expansión masiva
                  pos[i] = base[i] + (Math.random() > 0.7 ? glitchBand * spread : (Math.random()-0.5)*1.5);
                  pos[i+1] = base[i+1] + (Math.random()-0.5)*1.0;
                  pos[i+2] = base[i+2] + (Math.random() > 0.7 ? glitchBand * spread : (Math.random()-0.5)*1.5);
                } else if (Math.random() > 0.95) {
                  // Puntos perdidos estallando por todo el espacio (Ruido)
                  pos[i] = (Math.random() - 0.5) * 30;
                  pos[i+1] = (Math.random() - 0.5) * 30;
                  pos[i+2] = (Math.random() - 0.5) * 30;
                } else {
                  // Temblores bruscos cerca del cubo original
                  pos[i] = base[i] + (Math.random()-0.5)*0.5;
                  pos[i+1] = base[i+1] + (Math.random()-0.5)*0.5;
                  pos[i+2] = base[i+2] + (Math.random()-0.5)*0.5;
                }
              }
              needsUpdate = true;
            } else {
              // Curación magnética (vuelven a formar el cubo perfecto)
              for(let i=0; i<pos.length; i+=3) {
                if (Math.abs(pos[i] - base[i]) > 0.01) {
                  pos[i] += (base[i] - pos[i]) * 0.2;
                  pos[i+1] += (base[i+1] - pos[i+1]) * 0.2;
                  pos[i+2] += (base[i+2] - pos[i+2]) * 0.2;
                  needsUpdate = true;
                }
              }
            }
          }
          else if (luna.name === "maquina_friccion") {
            if (typeof isFriccionActive !== 'undefined' && isFriccionActive) {
              // Compresión pesada (simula alta gravedad)
              for(let i=0; i<pos.length; i+=3) {
                const dist = Math.sqrt(base[i]*base[i] + base[i+1]*base[i+1] + base[i+2]*base[i+2]);
                const force = 1 - (0.3 * Math.sin(Date.now()*0.005 + dist)); // Pulso de densidad
                pos[i] = base[i] * force;
                pos[i+1] = base[i+1] * force;
                pos[i+2] = base[i+2] * force;
              }
              needsUpdate = true;
            } else {
              for(let i=0; i<pos.length; i+=3) {
                if (Math.abs(pos[i] - base[i]) > 0.01) {
                  pos[i] += (base[i] - pos[i]) * 0.1;
                  pos[i+1] += (base[i+1] - pos[i+1]) * 0.1;
                  pos[i+2] += (base[i+2] - pos[i+2]) * 0.1;
                  needsUpdate = true;
                }
              }
            }
          }
          
          if (needsUpdate) luna.geometry.attributes.position.needsUpdate = true;
        });
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
// Retórica del Pincel según máquina activa (SIN NEONES)
          if (isFriccionActive) {
            dacBrush.position.lerp(targetPos, 0.015); // Pesado
            dacLinesMat.color.setHex(0xb89947);       // Ámbar bruñido
            dacBrush.material.color.setHex(0xb89947);
          } else if (isErraticaActive) {
            dacBrush.position.copy(targetPos).add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 0)); // Tiembla
            dacLinesMat.color.setHex(0xff6644);       // Coral apagado
            dacBrush.material.color.setHex(0xff6644);
          } else {
            dacBrush.position.lerp(targetPos, 0.15);  // Fluido
            // Gris pizarra para reposo, Blanco perla para la Máquina Poética
            dacLinesMat.color.setHex(isPoeticaActive ? 0xdcdce2 : 0x8a867f);
            dacBrush.material.color.setHex(isPoeticaActive ? 0xffffff : 0xe7e4de);
            // Eliminamos los "multiplyScalar(2.2)" que generaban el brillo cegador
          }

          // Opacidad general mucho más fina y arquitectónica
          dacLinesMat.opacity = (isPoeticaActive && !isFriccionActive && !isErraticaActive) ? 0.35 : 0.18;
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
              const fdx = px - dacBrush.position.x, fdy = py - dacBrush.position.y, fdz = pz - dacBrush.position.z; // sin crear vectores por partícula
              if (fdx * fdx + fdy * fdy + fdz * fdz < 16) {
                px += (px - dacBrush.position.x) * 0.05;
                py += (py - dacBrush.position.y) * 0.05;
              }
            }

            positions[i * 3] = px;
            positions[i * 3 + 1] = py;
            positions[i * 3 + 2] = pz;
          }

          // 2. CONECTAR PARTÍCULAS ENTRE SÍ
          // El búfer de líneas tiene tope (maxLines). Antes, una vez lleno, el doble bucle seguía comparando
          // ~500.000 pares por cuadro sin dibujar nada, y creaba un Vector3 por partícula. Ahora todo es
          // aritmética escalar y se sale en cuanto el búfer se llena (el resultado visible es el mismo).
          const connectDistSq = 5 * 5;
          const revealRadiusSq = 15.0 * 15.0;
          const brX = dacBrush.position.x, brY = dacBrush.position.y, brZ = dacBrush.position.z;
          dacLinks:
          for (let i = 0; i < dacParticleCount; i++) {
            const px1 = positions[i * 3], py1 = positions[i * 3 + 1], pz1 = positions[i * 3 + 2];
            const bdx = px1 - brX, bdy = py1 - brY, bdz = pz1 - brZ;
            if (bdx * bdx + bdy * bdy + bdz * bdz >= revealRadiusSq) continue;

            for (let j = i + 1; j < dacParticleCount; j++) {
              const dx = px1 - positions[j * 3], dy = py1 - positions[j * 3 + 1], dz = pz1 - positions[j * 3 + 2];
              if (dx * dx + dy * dy + dz * dz < connectDistSq) {
                if (lineIndex + 6 > maxLineIndex) break dacLinks; // búfer lleno: no tiene sentido seguir
                linePosArray[lineIndex++] = px1;
                linePosArray[lineIndex++] = py1;
                linePosArray[lineIndex++] = pz1;
                linePosArray[lineIndex++] = positions[j * 3];
                linePosArray[lineIndex++] = positions[j * 3 + 1];
                linePosArray[lineIndex++] = positions[j * 3 + 2];
              }
            }
          }

          dacParticlesGeo.attributes.position.needsUpdate = true;
          dacLinesGeo.setDrawRange(0, lineIndex / 3);
          dacLinesGeo.attributes.position.needsUpdate = true;

         // 🔥 Revelar Palabras (Conceptos)
          const dacDim = layoutDacWords();
          const revealR = dacDim ? Math.max(25, Math.max(dacDim.hW, dacDim.hH) * 1.1) : 25; // el radio de revelado crece con la pantalla
          dacWords.forEach((word) => {
            let dx = dacBrush.position.x - word.userData.basePos.x;
            let dy = dacBrush.position.y - word.userData.basePos.y;
            let dist2D = Math.sqrt(dx * dx + dy * dy);

            // 🔥 Aumentamos el radio visual a 25 para iluminarlas desde más lejos
            if (dist2D < revealR) {
              word.visible = true;
              word.position.y = word.userData.basePos.y + Math.sin(Date.now() * 0.002 + word.id) * 0.4;

              if (isErraticaActive) {
                word.material.rotation = (Math.random() - 0.5) * 0.5;
                word.material.opacity = Math.random();
                word.material.color.setHex(0xff3300);
              } else {
                word.material.rotation = 0;
                word.material.opacity = Math.max(0.6, 1 - (dist2D / revealR)); // Adaptamos el fade de opacidad a 25
                word.material.color.setHex(isPoeticaActive ? 0xffffff : 0x00ffff);
                if (isPoeticaActive) word.material.color.multiplyScalar(1.6); // blanco un poco más brillante
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
            // 🔥 ERRÁTICA (DIBUJO): Artefactos de código (Wireframes corruptos)
            pGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4); 
            pMat = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
            stroke = new THREE.Mesh(pGeo, pMat);
            
            // Efecto "Snap to Grid": Forzamos a que el dibujo se encaje matemáticamente en una cuadrícula
            const gridSize = 0.6;
            stroke.position.x = Math.round(globalPos.x / gridSize) * gridSize;
            stroke.position.y = Math.round(globalPos.y / gridSize) * gridSize;
            stroke.position.z = Math.round(globalPos.z / gridSize) * gridSize;
            
            // Rotaciones secas de 90 grados para mantener el aspecto de bloque de sistema
            stroke.rotation.set(Math.floor(Math.random()*4)*(Math.PI/2), Math.floor(Math.random()*4)*(Math.PI/2), 0);
            
            stroke.userData = { 
              type: 'erratica', 
              baseX: stroke.position.x, 
              baseY: stroke.position.y, 
              baseZ: stroke.position.z,
              timer: Math.floor(Math.random() * 100)
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
          p.userData.timer++;
          
          // Glitch de forma y posición (Espasmos violentos pero secos)
          if (p.userData.timer % 10 === 0) {
            if (Math.random() > 0.6) {
              // Se estira exageradamente como un error de RAM (Squash/Stretch roto)
              p.scale.set(Math.random() > 0.5 ? Math.random() * 5 : 1, Math.random() > 0.5 ? Math.random() * 5 : 1, Math.random() > 0.5 ? Math.random() * 5 : 1);
              
              // Se teletransporta levemente fuera de la cuadrícula
              p.position.set(
                p.userData.baseX + (Math.random() > 0.8 ? (Math.random()-0.5)*2 : 0),
                p.userData.baseY + (Math.random() > 0.8 ? (Math.random()-0.5)*2 : 0),
                p.userData.baseZ + (Math.random() > 0.8 ? (Math.random()-0.5)*2 : 0)
              );
            } else {
              // Vuelve a la normalidad (Se cura)
              p.scale.set(1, 1, 1);
              p.position.set(p.userData.baseX, p.userData.baseY, p.userData.baseZ);
            }
          }
          
          p.visible = Math.random() > 0.1; // 10% de probabilidad de hacerse invisible (parpadeo duro)
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
        
        // 1. Si tocamos la caja invisible (hitbox) de una luna, redirigimos el foco a la luna real
        if (obj.parent && obj.parent.name && obj.parent.name.startsWith('maquina_')) {
           obj = obj.parent;
        } else {
           while (obj.parent && obj.parent.type === 'Group') obj = obj.parent;
        }

        // 2. Cursor especial de doble círculo para el Viajero
        if (obj === window.travelerGroup || (obj.userData && obj.userData.name === "viajero")) {
          const svgCursor = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='none' stroke='%23ffffff' stroke-width='1.5' opacity='0.7'/%3E%3Ccircle cx='16' cy='16' r='4' fill='%2300ffff' opacity='0.9'/%3E%3C/svg%3E";
          if (canvasEl) canvasEl.style.cursor = `url("${svgCursor}") 16 16, pointer`;
        } else {
          if (canvasEl) canvasEl.style.cursor = 'pointer';
        }

        // 3. Efectos visuales de foco (Hover)
        if (obj !== window.travelerGroup && obj !== planetaDAC) {
          if (window.hoveredObject !== obj) {
            
            // A. APAGAR EL ANTERIOR
            if (window.hoveredObject && window.hoveredObject !== window.travelerGroup) {
              if (!window.hoveredObject.name || !window.hoveredObject.name.startsWith('maquina_')) {
                // Restaurar tamaño si era un planeta normal
                window.hoveredObject.scale.copy(window.hoveredObject.userData.baseScaleVector || window.hoveredObject.scale);
              } else {
                // Si era una Luna DAC, ocultar etiqueta y apagar brillo extra
                const lbl = window.hoveredObject.children.find(c => c.name === 'dac_label');
                if (lbl) lbl.visible = false;
                window.hoveredObject.material.color.multiplyScalar(1/1.5); 
              }
            }

            window.hoveredObject = obj;
            
            // B. ENCENDER EL NUEVO
            if (!window.hoveredObject.userData.baseScaleVector) {
              window.hoveredObject.userData.baseScaleVector = window.hoveredObject.scale.clone();
            }

            if (window.hoveredObject.name && window.hoveredObject.name.startsWith('maquina_')) {
              // Si es Luna DAC: Mostrar texto técnico y dar brillo (sin deformar tamaño)
              const lbl = window.hoveredObject.children.find(c => c.name === 'dac_label');
              if (lbl) lbl.visible = true;
              window.hoveredObject.material.color.multiplyScalar(1.5); 
            } else {
              // Si es planeta normal: Efecto elástico clásico
              window.hoveredObject.scale.set(
                window.hoveredObject.userData.baseScaleVector.x * 1.2,
                window.hoveredObject.userData.baseScaleVector.y * 1.2,
                window.hoveredObject.userData.baseScaleVector.z * 1.2
              );
            }
          }
        }
      } else {
        // Volver al cursor de cruz en el vacío espacial
        if (canvasEl) canvasEl.style.cursor = 'crosshair';
        
        // APAGAR TODO AL SALIR AL VACÍO
        if (window.hoveredObject && window.hoveredObject !== window.travelerGroup) {
          if (!window.hoveredObject.name || !window.hoveredObject.name.startsWith('maquina_')) {
             window.hoveredObject.scale.copy(window.hoveredObject.userData.baseScaleVector);
          } else {
             const lbl = window.hoveredObject.children.find(c => c.name === 'dac_label');
             if (lbl) lbl.visible = false;
             window.hoveredObject.material.color.multiplyScalar(1/1.5);
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
        bossEntity.position.y += (15 - bossEntity.position.y) * 0.05; bossEntity.position.x = Math.sin(Date.now() * 0.001) * 20; animateBoss(bossEntity);
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
            shakeIntensity = 0.8; playSound('damage', ship.position); createExplosion(ship.position.x, ship.position.y, ship.position.z, 1.6, 0xff8888); 
showSystemToast('> INTERFERENCIA: PÉRDIDA DE SEÑAL', '#fcf6f6');
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

      updatePulseFX(); for (let i = explosionParticles.length - 1; i >= 0; i--) { const p = explosionParticles[i]; p.position.x += p.userData.vx; p.position.y += p.userData.vy; p.position.z += p.userData.vz; p.userData.life -= 0.03; const s = Math.max(p.userData.life, 0.01); p.scale.set(s, s, s); if (p.userData.life <= 0) { scene.remove(p); explosionParticles.splice(i, 1); } }
      
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
        showSystemToast('> RUIDO DE RED: ANCHO DE BANDA REDUCIDO', '#f8f0f0');
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
  hasFoughtBoss = true; if (playerLives >= 3) unlockAchievement('untouched'); unlockPulseSword(); 
  isBossBattle = false; 
  playSound('double_pulse'); 
  createExplosion(bossEntity.position.x, bossEntity.position.y, bossEntity.position.z, 3.2, 0xffffff); 
  
  let bossBonus = 500 + (typeof combatCombo !== 'undefined' ? combatCombo * 10 : 0);
  
  // 🔥 GUARDAR PUNTAJE ANTES DE RESETEAR
  const finalScoreValue = score + bossBonus;
  console.log(" VICTORIA - Puntaje final:", finalScoreValue);
  
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
    btnCombat.innerText = '▶'; btnCombat.classList.remove('is-combat'); 
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
  
  showSystemToast(' SISTEMA CALIBRADO Puntaje: ' + finalScoreValue, '#e0ede0');
  
  // Mostrar leaderboard
  setTimeout(() => {
    try {
      const finalScoreDisplay = document.getElementById('final-score-display');
      if (finalScoreDisplay) finalScoreDisplay.innerText = finalScoreValue;
      armScoreForm(finalScoreValue, true); // victoria: habilita UN registro
      openUIWindow('leaderboard-ui');
      updateLeaderboardUI();
      isCombatActive = false;
    } catch(e) {
      console.error("Error mostrando victoria:", e);
      showSystemToast('¡VICTORIA! Puntaje: ' + finalScoreValue, '#ddf2dd');
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
                playSound('pulse', f.position); createExplosion(f.position.x, f.position.y, f.position.z);
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
              playSound('pulse', asteroids[k].position); createExplosion(asteroids[k].position.x, asteroids[k].position.y, asteroids[k].position.z); 
              
              if (asteroids[k].userData.isBounty) {
                playSound('levelup'); const rType = asteroids[k].userData.rewardType;
                if (rType === 'shield') { hasShield = true; if (typeof shieldMesh !== 'undefined' && shieldMesh) shieldMesh.visible = true; if(typeof showFloatingText === 'function') showFloatingText('ESCUDO', '#cff5cf', asteroids[k].position.x, asteroids[k].position.y, asteroids[k].position.z); updateScore(200); } 
                else if (rType === 'life') { if (playerLives < 5) playerLives++; if (typeof updateLivesUI === 'function') updateLivesUI(); if(typeof showFloatingText === 'function') showFloatingText('+1 VIDA', '#f7edf7', asteroids[k].position.x, asteroids[k].position.y, asteroids[k].position.z); updateScore(200); } 
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
                  if (combatCombo === 5) showSystemToast('ACTUALIZADA: PING DOBLE', '#d8f1ce');
                  if (combatCombo === 10) showSystemToast('MAXIMIZADA: PING TRIPLE', '#bac1be');
                  
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
           // Constelación: dar la vuelta a la cámara. Carrusel (móvil por defecto): una vuelta completa del anillo
           if ((!isAligned && Math.abs(userGroup.rotation.y) > 2.6) || (isAligned && window.totalRotated > Math.PI * 2)) {
             secretDiscovered = true; 
             planet.visible = true;
             playSound('boss_hit'); 
showSystemToast('ANOMALÍA DETECTADA A TUS ESPALDAS', '#efeaea');           }
        }

        if (!secretDiscovered) {
           planet.userData.targetPos.set(0, 0, 80);
        } else if (isAligned) {
            const angle = (carouselSlotOf(planet) / carouselSlots()) * Math.PI * 2 + carouselAngleOffset;
            const radius = window.innerWidth < 600 ? 20 : 22;
            planet.userData.targetPos.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius - 10);
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
        let angle = (index / carouselSlots()) * Math.PI * 2 + carouselAngleOffset;
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
    // 🔥 EL PLANETA D.A.C. TAMBIÉN GIRA EN EL CARRUSEL
    // (antes su posición no se actualizaba nunca: se quedaba fijo en (40, 0, -50))
    if (typeof planetaDAC !== 'undefined' && planetaDAC) {
      if (planetaDAC.userData.isIsolated) {
        if (planetaDAC.scale.x !== 1) planetaDAC.scale.setScalar(1); // dentro del núcleo siempre a tamaño completo
      } else if (typeof draggedPlanet === 'undefined' || draggedPlanet !== planetaDAC) {
        if (!planetaDAC.userData.homePos) planetaDAC.userData.homePos = planetaDAC.position.clone();
        const dacTarget = new THREE.Vector3();
        let dacScale = 1;
        if (isAligned) {
          const slot = carouselSlotOf(planetaDAC);
          const angle = (slot / carouselSlots()) * Math.PI * 2 + carouselAngleOffset;
          const radius = window.innerWidth < 600 ? 20 : 22;
          dacTarget.set(Math.cos(angle) * radius, Math.sin(Date.now() * 0.001 + slot) * 1.5, Math.sin(angle) * radius - 10);
          dacScale = 0.5; // sus anillos miden ~23 unidades: a escala 1 pisarían a los planetas vecinos
        } else {
          dacTarget.copy(planetaDAC.userData.homePos);
        }
        planetaDAC.position.lerp(dacTarget, 0.08);
        planetaDAC.scale.setScalar(planetaDAC.scale.x + (dacScale - planetaDAC.scale.x) * 0.08);
      }
    }
    updateTraveler();  
if (!isAR && !(window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive)) {   // la red de energía no debe reaparecer dentro de un Juego Otro
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

  } catch (err) {
    window.__loopErrors = (window.__loopErrors || 0) + 1;
    if (window.__loopErrors <= 5 || window.__loopErrors % 300 === 0) console.error('Error en el bucle de animación (el juego sigue):', err);
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
  skipBtn: "[ INICIAR EXTRACCIÓN DE DATOS ]",
    files: "ARCHIVOS",
    hudLives: "SEÑAL",
    hudFiles: "ARCHIVOS",
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
  skipBtn: "[ START DATA EXTRACTION ]",
    files: "FILES",
    hudLives: "SIGNAL",
    hudFiles: "FILES",
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

// Aplica el idioma activo a TODA la interfaz. Se llama al cargar y al pulsar el botón EN/ES.
function applyLanguage() {
  const lang = dict[window.currentLang];
  if(document.getElementById('start-btn')) document.getElementById('start-btn').innerText = lang.startBtn;
  if(document.getElementById('skip-btn')) document.getElementById('skip-btn').innerText = lang.skipBtn;
  if(document.getElementById('label-lives')) document.getElementById('label-lives').innerText = lang.hudLives || 'VIDAS';
  if(document.getElementById('label-files')) document.getElementById('label-files').innerText = lang.hudFiles || 'ARCHIVOS';  
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
      newLabel.position.set(0, 0, 0);
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
}

document.getElementById('lang-toggle-btn')?.addEventListener('click', (e) => {
  e.preventDefault(); e.currentTarget.blur();
  window.currentLang = window.currentLang === 'es' ? 'en' : 'es';
  e.currentTarget.innerText = window.currentLang === 'es' ? 'EN' : 'ES';
  playSound('ui');
  // 🔥 GUARDAR IDIOMA EN MEMORIA
  sysPrefs.lang = window.currentLang;
  localStorage.setItem('gamelab_prefs', JSON.stringify(sysPrefs));
  applyLanguage();
});
// Al cargar: antes el idioma guardado NO se aplicaba (quien dejó la web en inglés veía el HTML en español,
// y los textos de menú/inicio solo cambiaban tras pulsar el botón dos veces).
{ const lb = document.getElementById('lang-toggle-btn'); if (lb) lb.innerText = window.currentLang === 'es' ? 'EN' : 'ES'; }
applyLanguage();
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
  
  // 🔥 FILTRO SUBLIME: Limpiar emojis del combate
  let cleanMsg = msg.replace(/[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{2384}\u{2B50}\u{2694}\u{262F}\u{26A0}\u{1F480}\u{1F389}\u{2728}☯✧💀🎉⚔⚠️📡]/gu, '').trim();
  
  let sublimeColor = colorHex;
  if (colorHex === '#ff0000' || colorHex === '#ff3333') sublimeColor = '#ff6644';
  else if (colorHex === '#00ffaa' || colorHex === '#00ff00') sublimeColor = '#b9c8b0';
  else if (colorHex === '#00ffff' || colorHex === '#00ffcc') sublimeColor = '#dfd9cf';
  else if (colorHex === '#ff00ff' || colorHex === '#ffaa00') sublimeColor = '#e6f4df';
  else if (colorHex === '#ffffff') sublimeColor = '#e7e4de';

  el.innerText = cleanMsg;
  el.style.position = 'fixed';
  el.style.color = sublimeColor;
  el.style.textShadow = 'none'; // Sin efecto neón
  el.style.border = `1px solid ${sublimeColor}50`;
  el.style.background = 'rgba(10,10,12,0.85)';
  el.style.padding = '3px 8px';
  el.style.borderRadius = '2px';
  el.style.fontFamily = "'-apple-system', sans-serif";
  el.style.fontWeight = '300';
  el.style.letterSpacing = '1px';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '9999';
  el.style.transition = 'all 1.5s cubic-bezier(0.1, 0.8, 0.3, 1)';
  
  const vector = new THREE.Vector3(x, y, z);
  vector.project(camera);
  const xPos = (vector.x * 0.5 + 0.5) * window.innerWidth;
  const yPos = (vector.y * -0.5 + 0.5) * window.innerHeight;
  
  el.style.left = `${xPos}px`;
  el.style.top = `${yPos}px`;
  document.body.appendChild(el);
  
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
    const color = isValid ? '#00ffaa' : (el.value.trim().length > 0 ? '#f6efef' : 'rgba(255,255,255,0.2)');
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
    submitBtn.style.setProperty('border-color', '#f1eaea', 'important');
    submitBtn.style.setProperty('color', '#fcf6f6', 'important');
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
// (los textos a corromper se consultan al activar la Errática; el texto de estado se excluye)
let erraticaTimer = null;



const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const dacMicrosite = document.getElementById('dac-microsite');

// Qué máquinas se encendieron desde el modal (las lunas 3D comparten las mismas banderas)
const modalOwned = { poetica: false, erratica: false, friccion: false };

// Contexto de la matriz de datos crudos (Poética)
// El modal está oculto al cargar, así que el tamaño se ajusta cuando el canvas es visible
const rawCtx = rawCanvas ? rawCanvas.getContext('2d') : null;
function resizeRawCanvas() {
  if (!rawCanvas) return;
  const w = rawCanvas.offsetWidth, h = rawCanvas.offsetHeight;
  if (w > 0 && h > 0 && (rawCanvas.width !== w || rawCanvas.height !== h)) {
    rawCanvas.width = w; rawCanvas.height = h;
  }
}
if (rawCanvas && 'ResizeObserver' in window) new ResizeObserver(resizeRawCanvas).observe(rawCanvas);
window.addEventListener('resize', resizeRawCanvas);

// Lógica del Cursor Pesado (Fricción Somática)
let targetMouseX = 0, targetMouseY = 0;
let currentMouseX = 0, currentMouseY = 0;

// pointermove cubre ratón, lápiz y dedo (antes solo funcionaba con ratón)
dacMicrosite?.addEventListener('pointermove', (e) => {
  const rect = dacMicrosite.getBoundingClientRect();
  targetMouseX = e.clientX - rect.left;
  targetMouseY = e.clientY - rect.top;

  // Si la máquina poética está activa, pintamos pixeles crudos justo bajo el puntero
  if (isPoeticaActive && rawCtx && rawCanvas) {
    resizeRawCanvas();
    const c = rawCanvas.getBoundingClientRect();
    const px = e.clientX - c.left, py = e.clientY - c.top;
    if (px < 0 || py < 0 || px > c.width || py > c.height) return;
    rawCtx.fillStyle = `rgba(${Math.random()*255}, 0, ${Math.random()*255}, 0.8)`;
    rawCtx.fillRect(px, py, Math.random()*20, Math.random()*20);
  }
});

// Inercia independiente de los cuadros por segundo (antes dependía de la pantalla)
let lastFrictionTime = performance.now();
function animateFriction(now) {
  const dt = Math.min(((now || performance.now()) - lastFrictionTime) / 1000, 0.1);
  lastFrictionTime = now || performance.now();
  if (isFriccionActive && heavyCursor) {
    const k = 1 - Math.pow(1 - 0.05, dt * 60); // equivale a 0.05 por frame a 60 fps
    currentMouseX += (targetMouseX - currentMouseX) * k;
    currentMouseY += (targetMouseY - currentMouseY) * k;
    heavyCursor.style.transform = `translate(${currentMouseX}px, ${currentMouseY}px)`;
  }
  requestAnimationFrame(animateFriction);
}
requestAnimationFrame(animateFriction);

// --- Errática: corrupción reversible de textos ---
const glitchTargets = () => document.querySelectorAll('.dac-glitch-text:not(#dac-status-text)');
let erraticaFleeCount = 0;
const MAX_FLEES = 4; // después de 4 huidas el botón se deja atrapar: siempre se puede apagar

function corruptText(original, howMany) {
  let out = original;
  for (let i = 0; i < howMany; i++) {
    const pos = Math.floor(Math.random() * out.length);
    out = out.substring(0, pos) + String.fromCharCode(33 + Math.random() * 94) + out.substring(pos + 1);
  }
  return out;
}

function stopErratica() {
  if (erraticaTimer) { clearInterval(erraticaTimer); erraticaTimer = null; }
  glitchTargets().forEach(el => {
    if (el.dataset.original !== undefined) { el.innerText = el.dataset.original; delete el.dataset.original; }
  });
  if (btnErratica) { btnErratica.style.transform = 'none'; btnErratica.style.background = 'transparent'; }
  erraticaFleeCount = 0;
}

function startErratica() {
  // Guardamos el texto original para poder restaurarlo siempre
  glitchTargets().forEach(el => { el.dataset.original = el.innerText; });

  if (prefersReducedMotion.matches) {
    // Sin parpadeo: una sola corrupción estática
    glitchTargets().forEach(el => { el.innerText = corruptText(el.dataset.original, 2); });
    return;
  }
  erraticaTimer = setInterval(() => {
    glitchTargets().forEach(el => {
      const original = el.dataset.original ?? el.innerText;
      // Cada tic parte del original: el texto parpadea pero no se degrada acumulando errores
      el.innerText = Math.random() > 0.7 ? corruptText(original, 1 + Math.floor(Math.random() * 2)) : original;
    });
    if (typeof triggerSubtleGlitch === 'function') triggerSubtleGlitch();
  }, 150);
}

function stopFriccion() {
  if (btnFriccion) btnFriccion.style.background = 'transparent';
  if (dacMicrosite) dacMicrosite.style.cursor = 'crosshair';
  if (heavyCursor) heavyCursor.style.display = 'none';
}

// Apaga las máquinas encendidas desde el modal (se llama al cerrar cualquier ventana)
window.stopDacMachines = function() {
  if (modalOwned.erratica) { isErraticaActive = false; modalOwned.erratica = false; }
  stopErratica(); // siempre: limpia temporizador y restaura textos
  if (modalOwned.poetica) {
    isPoeticaActive = false; modalOwned.poetica = false;
    if (btnPoetica) btnPoetica.style.background = 'transparent';
    if (rawCtx && rawCanvas) rawCtx.clearRect(0, 0, rawCanvas.width, rawCanvas.height);
  }
  if (modalOwned.friccion) { isFriccionActive = false; modalOwned.friccion = false; stopFriccion(); }
};

if (btnPoetica && btnErratica && btnFriccion) {
  
  // [1] MÁQUINA POÉTICA: Nube de puntos y afecto visual
  btnPoetica.addEventListener('click', () => {
    if (typeof playSound === 'function') playSound('ui');
    isPoeticaActive = !isPoeticaActive;
    modalOwned.poetica = isPoeticaActive;
    
    if (isPoeticaActive) {
      resizeRawCanvas();
      dacStatus.innerHTML = "> MATRIZ DE DATOS CRUDOS EXPUESTA.<br>Dibuja sobre el vacío.";
      dacStatus.style.color = '#f0e2f0';
      btnPoetica.style.background = 'rgba(255, 0, 255, 0.2)';
    } else {
      btnPoetica.style.background = 'transparent';
      if(rawCtx) rawCtx.clearRect(0, 0, rawCanvas.width, rawCanvas.height);
    }
  });

  // [2] MÁQUINA ERRÁTICA: Glitch estructural y tartamudeo HTML
  // El botón huye del puntero (negativa a obedecer), solo con ratón y un número limitado de veces
  btnErratica.addEventListener('pointerenter', (e) => {
    if (!isErraticaActive || e.pointerType !== 'mouse' || prefersReducedMotion.matches) return;
    if (erraticaFleeCount >= MAX_FLEES) { btnErratica.style.transform = 'none'; return; }
    erraticaFleeCount++;
    btnErratica.style.transform = `translate(${(Math.random()-0.5)*100}px, ${(Math.random()-0.5)*50}px)`;
  });

  btnErratica.addEventListener('click', () => {
    if (typeof playSound === 'function') playSound('damage');
    isErraticaActive = !isErraticaActive;
    modalOwned.erratica = isErraticaActive;
    
    if (isErraticaActive) {
      btnErratica.style.background = 'rgba(255, 51, 0, 0.2)';
      const aviso = prefersReducedMotion.matches
        ? "Movimiento reducido: corrupción estática."
        : "ADVERTENCIA: texto parpadeante. Vuelve a pulsar para detener.";
      dacStatus.innerHTML = `> ESTÉTICA DEL ERROR.<br>Interrupción de la invisibilidad de la mediación.<br><small>${aviso}</small>`;
      dacStatus.style.color = '#ff3300';
      startErratica();
    } else {
      stopErratica();
      showSystemToast('> REINICIANDO CAJA NEGRA', '#00ffcc');
    }
  });

  // [3] MÁQUINA DE FRICCIÓN: Resistencia táctil y peso
  btnFriccion.addEventListener('click', () => {
    if (typeof playSound === 'function') playSound('boss_hit');
    isFriccionActive = !isFriccionActive;
    modalOwned.friccion = isFriccionActive;
    
    if (isFriccionActive) {
      btnFriccion.style.background = 'rgba(255, 255, 0, 0.2)';
      dacStatus.innerHTML = "> FRICCIÓN MATERIAL DETECTADA.<br>El sistema exige negociación somática.";
      dacStatus.style.color = '#ffff00';
      
      // Ocultar cursor del sistema, mostrar cursor pesado (parte desde donde está el puntero)
      currentMouseX = targetMouseX; currentMouseY = targetMouseY;
      dacMicrosite.style.cursor = 'none';
      heavyCursor.style.display = 'block';
      if (typeof shakeIntensity !== 'undefined') shakeIntensity = 0.5;
    } else {
      stopFriccion();
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
// ============================================================
// 🌫 PIEL SUBLIME DEL MODO INMERSIVO
// Los botones, la cabecera, la leyenda y los controles táctiles conservaban el tono
// antiguo (cajas cuadradas, verde/amarillo/rojo neón, monoespaciada). Ahora hablan el mismo
// idioma que el menú inicial: cristal tenue, línea fina, tipografía ligera.
// Todo va por CSS con !important para no tocar el HTML ni style.css.
// ============================================================
(function injectSublimeSkin() {
  if (document.getElementById('sublime-skin')) return;
  const s = document.createElement('style');
  s.id = 'sublime-skin';
  s.textContent = `
    /* =========================================================
       0. FIX AR/VR DOBLE TEXTO: Apagamos el ::after de style.css
       ========================================================= */
    #ARButton::after, #VRButton::after {
      content: none !important;
      display: none !important;
    }

    /* =========================================================
       1. MENÚ HAMBURGUESA DESDE LA DERECHA (3D HOLOGRÁFICO)
       ========================================================= */
    #side-menu {
      left: auto !important;
      right: -400px !important;
      border-radius: 25px 0 0 25px !important;
      border-right: none !important;
      border-left: 1px solid rgba(255, 255, 255, 0.15) !important;
      box-shadow: -30px 0 50px rgba(0,0,0,0.6), inset 1px 0 20px rgba(255,255,255,0.02) !important;
      transform: perspective(1000px) rotateY(-15deg) translateY(-50%) !important;
      transform-origin: right center !important;
      transition: right 0.6s cubic-bezier(0.1, 0.8, 0.3, 1), transform 0.6s !important;
    }
    #side-menu.open {
      left: auto !important;
      right: 0 !important;
      transform: perspective(1000px) rotateY(-4deg) translateY(-50%) !important;
    }

    /* =========================================================
       2. ESTILO BASE SUBLIME (ESCRITORIO Y GENERAL)
       ========================================================= */
    #menu-toggle, #lang-toggle-btn, #combat-toggle-btn, #ARButton, #VRButton {
      background: rgba(255,255,255,0.02) !important;
      border: 1px solid rgba(255,255,255,0.16) !important;
      border-radius: 50% !important;
      color: #dcdce2 !important;
      font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif !important;
      font-weight: 300 !important; font-size: 0.72rem !important; letter-spacing: 0.12em !important;
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      box-shadow: none !important;
      transition: background .35s ease, border-color .35s ease, box-shadow .35s ease !important;
    }
    #menu-toggle:hover, #lang-toggle-btn:hover, #combat-toggle-btn:hover, #ARButton:hover, #VRButton:hover,
    body:not(.ex-mode-active) #mode-toggle-btn:hover, #universe-legend:hover {
      background: rgba(255,255,255,0.09) !important; color: #ffffff !important;
      border-color: rgba(255,255,255,0.5) !important; box-shadow: 0 0 24px rgba(255,255,255,0.12) !important;
    }
    #combat-toggle-btn.is-combat { border-color: rgba(255,150,150,0.6) !important; color: #ffd0d0 !important; box-shadow: 0 0 22px rgba(255,90,90,0.22) !important; }

    #portfolio-header { color: #f4f4f7 !important; font-weight: 300 !important; font-size: 0.95rem !important; letter-spacing: 0.32em !important;
      text-shadow: 0 0 24px rgba(255,255,255,0.18) !important; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif !important; }
    #portfolio-header span { color: #8c8c99 !important; letter-spacing: 0.24em !important; font-size: 0.68rem !important; }

    #universe-legend { background: rgba(255,255,255,0.025) !important; border: 1px solid rgba(255,255,255,0.12) !important; border-radius: 14px !important;
      box-shadow: none !important; backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important; }
    #universe-legend, #universe-legend * { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif !important; letter-spacing: 0.1em; }
    #universe-legend #legend-header * { color: #aaaab6 !important; }

    /* =========================================================
       2B. EN ESCRITORIO (>= 769px): EJECUTIVO AL LADO DE LEYENDA
       ========================================================= */
    @media (min-width: 769px) {
      #universe-legend {
        top: 72px !important;
        left: 20px !important;
        padding: 8px 14px !important;
        border-radius: 18px !important;
      }
      body:not(.ex-mode-active) #mode-toggle-btn {
        position: fixed !important;
        top: 72px !important;
        left: 235px !important;
        right: auto !important;
        bottom: auto !important;
        transform: none !important;
        padding: 8px 16px !important;
        font-size: 0.72rem !important;
        letter-spacing: 0.14em !important;
        border-radius: 18px !important;
        background: rgba(255,255,255,0.025) !important;
        border: 1px solid rgba(255,255,255,0.12) !important;
        color: #aaaab6 !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        box-shadow: none !important;
      }
    }

    /* =========================================================
       3. BARRA DE PESTAÑAS EDITORIAL (SOLO EN MÓVIL <= 768px)
       ========================================================= */
 @media (max-width: 768px) {
      /* Contenedor unificado de pestañas en top: 76px (ALTURA EXACTA CLAVADA) */
      #universe-legend,
      body:not(.ex-mode-active) #mode-toggle-btn,
      #ARButton,
      #VRButton,
      #combat-toggle-btn,
      #lang-toggle-btn,
      #menu-toggle {
        position: fixed !important;
        top: 76px !important;
        bottom: auto !important;
        box-sizing: border-box !important; /* 🔥 CLAVE: hace que el div y los buttons midan exactamente igual con bordes */
        height: 36px !important;
        min-height: 36px !important;
        max-height: 36px !important;
        line-height: 1 !important;
        margin: 0 !important;
        padding: 0 !important;
        border-radius: 0 !important;
        background: rgba(12, 12, 16, 0.72) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        border: none !important;
        border-top: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.14) !important;
        border-right: 1px solid rgba(255, 255, 255, 0.07) !important;
        box-shadow: none !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif !important;
        font-size: 0.62rem !important;
        font-weight: 300 !important;
        letter-spacing: 0.14em !important;
        color: #cfd0d8 !important;
        transform: none !important;
        z-index: 10002 !important;
      }

      /* 1. Pestaña LEYENDA (0% a 22%) */
      #universe-legend {
        left: 0 !important;
        width: 22vw !important;
        max-width: 22vw !important;
        border-bottom-left-radius: 10px !important;
      }
  #universe-legend #legend-header {
        width: 100% !important;
        height: 100% !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 4px !important;
      }
      #universe-legend #legend-header span:first-child { font-size: 0 !important; }
      #universe-legend #legend-header span:first-child::after {
        content: 'LEYENDA'; font-size: 0.58rem !important; letter-spacing: 0.1em !important;
      }
      #universe-legend #legend-icon { font-size: 0.6rem !important; color: #8c8c99 !important; }

      #universe-legend #legend-content {
        position: fixed !important;
        top: 112px !important;
        left: 8px !important;
        width: 190px !important;
        background: rgba(10, 10, 14, 0.95) !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        border-radius: 10px !important;
        padding: 10px 12px !important;
        margin-top: 0 !important;
        box-shadow: 0 14px 30px rgba(0,0,0,0.7) !important;
        z-index: 10005 !important;
      }

      /* 2. Pestaña ARCHIVO 2D (22% a 46%) */
      body:not(.ex-mode-active) #mode-toggle-btn {
        left: 22vw !important;
        right: auto !important;
        width: 24vw !important;
        min-width: 24vw !important;
        font-size: 0 !important;
      }
      body:not(.ex-mode-active) #mode-toggle-btn::after {
        content: 'ARCHIVO';
        font-size: 0.58rem !important;
        letter-spacing: 0.12em !important;
        color: #e7e4de !important;
      }

      /* 3. Pestaña AR (46% a 58%) */
      #ARButton {
        left: 46vw !important;
        right: auto !important;
        width: 12vw !important;
        min-width: 12vw !important;
      }
      /* 4. Pestaña VR (58% a 70%) */
      #VRButton {
        left: 58vw !important;
        right: auto !important;
        width: 12vw !important;
        min-width: 12vw !important;
      }
      #ARButton[style*="display: none"] ~ #VRButton {
        left: 46vw !important;
        width: 24vw !important;
      }

      /* 5. Pestaña PLAY / COMBATE (70% a 80%) */
      #combat-toggle-btn {
        left: 70vw !important;
        right: auto !important;
        width: 10vw !important;
        min-width: 10vw !important;
      }

      /* 6. Pestaña IDIOMA EN/ES (80% a 90%) */
      #lang-toggle-btn {
        left: 80vw !important;
        right: auto !important;
        width: 10vw !important;
        min-width: 10vw !important;
      }

      /* 7. Pestaña MENÚ HAMBURGUESA (90% a 100%) */
      #menu-toggle {
        left: 90vw !important;
        right: 0 !important;
        width: 10vw !important;
        min-width: 10vw !important;
        border-right: none !important;
        border-bottom-right-radius: 10px !important;
      }
      #menu-toggle svg { width: 17px !important; height: 17px !important; }
    }

    /* Botones flotantes inferiores */
    #btn-recenter, #helpBtn {
      position: fixed !important; right: 20px !important;
      width: 40px !important; height: 40px !important; z-index: 9999 !important; 
      display: flex !important; align-items: center !important; justify-content: center !important;
      border-radius: 50% !important; background: rgba(255,255,255,0.03) !important; border: 1px solid rgba(255,255,255,0.16) !important;
      color: #dcdce2 !important; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif !important; font-weight: 300 !important;
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); transition: background .35s ease, border-color .35s ease, box-shadow .35s ease !important;
    }
    #btn-recenter { bottom: 85px !important; }
    #helpBtn { bottom: 35px !important; }
    #scroll-hint { bottom: 45px !important; z-index: 9998 !important; pointer-events: none; }

    #btn-recenter:hover, #helpBtn:hover { background: rgba(255,255,255,0.09) !important; border-color: rgba(255,255,255,0.5) !important; box-shadow: 0 0 24px rgba(255,255,255,0.12) !important; }

    #btn-left, #btn-right, #btn-shoot {
      background: rgba(255,255,255,0.04) !important; border: 1px solid rgba(255,255,255,0.22) !important; color: #e6e6ec !important;
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); box-shadow: 0 0 26px rgba(255,255,255,0.05) !important;
      transition: background .2s ease, box-shadow .2s ease !important;
    }
    #btn-shoot { background: rgba(255,255,255,0.09) !important; border-color: rgba(255,255,255,0.4) !important; }
    #btn-left:active, #btn-right:active { background: rgba(255,255,255,0.18) !important; }
    #btn-shoot:active { background: rgba(255,255,255,0.28) !important; box-shadow: 0 0 34px rgba(255,255,255,0.22) !important; }

    @media (max-width: 520px) {
      #unified-hud { box-sizing: border-box !important; min-width: 0 !important; width: 100vw !important; max-width: 100vw !important; padding: 5px 10px !important; justify-content: space-between !important; gap: 0 !important; border-radius: 0 !important; }
      #unified-hud .hud-item { padding: 0 3px !important; margin: 0 !important; min-width: 0 !important; }
      #unified-hud .hud-item:last-child { padding-left: 8px !important; margin-left: 2px !important; }
      #unified-hud .hud-label { letter-spacing: 1px !important; font-size: 0.5rem !important; }
      #unified-hud .hud-val { font-size: 0.8rem !important; letter-spacing: 0 !important; }
      #portfolio-header { font-size: 0.8rem !important; letter-spacing: 0.18em !important; white-space: nowrap; }
      #portfolio-header span { font-size: 0.58rem !important; letter-spacing: 0.14em !important; }
    }

    #btn-sword { position: fixed; right: 25px; bottom: 205px; box-sizing: border-box; width: 40px !important; height: 40px !important; min-width: 0 !important; padding: 0 !important; display: flex; align-items: center; justify-content: center;
      border-radius: 50% !important; background: rgba(255,255,255,0.03) !important; border: 1px solid rgba(160,250,255,0.35) !important; color: #bff9ff !important;
      cursor: pointer; z-index: 10001; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      transition: box-shadow .3s ease, border-color .3s ease, background .3s ease !important; }
    @media (max-width: 768px) { #btn-sword { bottom: 145px !important; } } 
    #btn-sword svg { flex: none; width: 20px; height: 20px; }
    #btn-sword:hover { background: rgba(160,250,255,0.12) !important; }
    #btn-sword.is-ready { border-color: rgba(160,250,255,0.9) !important; animation: swordReady 2.2s ease-in-out infinite alternate; }
    @keyframes swordReady { from { box-shadow: 0 0 8px rgba(120,240,255,0.2); } to { box-shadow: 0 0 26px rgba(120,240,255,0.6); } }
    @media (prefers-reduced-motion: reduce) { #btn-sword.is-ready { animation: none; box-shadow: 0 0 18px rgba(120,240,255,0.5); } }
  `;
  document.head.appendChild(s);
})();
// ============================================================
// 🔥 MODO EJECUTIVO 2D — lectura autónoma, estética sobria
// ------------------------------------------------------------
// Reescrito. Cambios clave frente a la versión anterior:
//  • Ya NO llama a openProjectPopup (ligado a la escena 3D: recolorea
//    planetas, mueve la cámara, usa typewriter y capas con z-index).
//    Cada proyecto se abre en una vista de detalle propia, dentro del
//    mismo contenedor 2D, con Esc / ← → para navegar.
//  • El botón de idioma del juego queda DETRÁS del contenedor (z-index
//    10001 < 99990), así que el modo trae su propio selector ES/EN.
//  • El contenedor aísla los eventos táctiles/ratón/rueda: el 3D no los ve.
//  • Estética: papel negro, tipografía serif ligera, líneas finas, sin neón.
// ============================================================

// ============================================================
// 🔥 MODO EJECUTIVO 2D — lectura autónoma, estética sobria
// ============================================================

const EX_CSS = `
  #terminal-container { box-sizing: border-box; background: #0a0a0a !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
    padding: 0 !important; color: #bdb9b1; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-weight: 300; line-height: 1.75; user-select: text; -webkit-user-select: text; touch-action: pan-y; overscroll-behavior: contain;
    scrollbar-width: thin; scrollbar-color: #2a2a2a transparent; -webkit-text-size-adjust: 100%; }
  #terminal-container *, #terminal-container *::before, #terminal-container *::after { box-sizing: border-box; }
  #terminal-container ::selection { background: rgba(255,255,255,.18); }
  #terminal-container a:focus-visible, #terminal-container button:focus-visible { outline: 1px solid rgba(255,255,255,.6); outline-offset: 4px; }
  #mode-toggle-btn { z-index: 100000 !important; }
  .ex-wrap { max-width: 46rem; margin: 0 auto; padding: 5.5rem 1.5rem 7rem; }
  .ex-bar { display: flex; align-items: center; gap: 1.6rem; margin-bottom: 5rem; min-height: 2rem; }
  .ex-mark { font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; color: #77746e; }
  .ex-lang, .ex-back { background: none; border: 0; border-bottom: 1px solid transparent; color: #8a867f; font: inherit; font-size: .72rem; letter-spacing: .22em;
    text-transform: uppercase; cursor: pointer; padding: .4rem 0; transition: color .25s, border-color .25s; }
  .ex-lang:hover, .ex-back:hover { color: #f1eee8; border-bottom-color: rgba(255,255,255,.3); }
  .ex-label { font-size: .7rem; letter-spacing: .24em; text-transform: uppercase; color: #77746e; font-weight: 400; margin: 0 0 1.4rem; }
  .ex-name, .ex-d-title, .ex-title, .ex-pager-title { font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 300; }
  .ex-name { font-size: clamp(1.7rem, 5.4vw, 3rem); line-height: 1.25; letter-spacing: .16em; text-transform: uppercase; color: #fff; margin: 0 0 1rem; text-shadow: 0 0 30px rgba(255,255,255,.14); animation: exDriftA 11s ease-in-out infinite alternate; }
  .ex-eyebrow { color: #888899 !important; letter-spacing: .3em !important; animation: exGlow 4s ease-in-out infinite alternate; }
  .ex-sub { margin: -1.6rem 0 2.4rem; color: #77746e; font-size: .82rem; letter-spacing: .26em; text-transform: uppercase; animation: exDriftC 16s ease-in-out infinite alternate; }
  @keyframes exDriftA { 0% { transform: translate3d(0,0,0) rotateZ(0deg); } 100% { transform: translate3d(6px,-8px,0) rotateZ(.25deg); } }
  @keyframes exDriftB { 0% { transform: translate3d(0,0,0) rotateZ(0deg); } 100% { transform: translate3d(-7px,5px,0) rotateZ(-.3deg); } }
  @keyframes exDriftC { 0% { transform: translate3d(0,0,0) rotateZ(0deg); } 100% { transform: translate3d(5px,6px,0) rotateZ(.2deg); } }
  @keyframes exGlow { from { opacity: .35; text-shadow: 0 0 0 rgba(255,255,255,0); } to { opacity: 1; text-shadow: 0 0 15px rgba(255,255,255,.4); } }
  .ex-role { color: #a9a59d; font-size: 1.05rem; letter-spacing: .06em; margin: 0 0 2.4rem; animation: exDriftB 14s ease-in-out infinite alternate; }
  .ex-text { margin: 0 0 1.1rem; max-width: 38rem; color: #bdb9b1; font-size: 1.02rem; }
  .ex-skills { margin: 1.8rem 0 0; color: #77746e; font-size: .85rem; letter-spacing: .04em; }
  .ex-links { display: flex; flex-wrap: wrap; gap: .7rem 1.8rem; margin-top: 2.4rem; }
  .ex-links a { color: #d9d5cc; text-decoration: none; font-size: .74rem; letter-spacing: .2em; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,.25); padding-bottom: .25rem; transition: border-color .25s, color .25s; }
  .ex-links a:hover { color: #fff; border-bottom-color: #fff; }
  .ex-note { margin: 3rem 0 0; padding-top: 1.4rem; border-top: 1px solid rgba(255,255,255,.08); color: #8a867f; font-size: .88rem; max-width: 34rem; }
  .ex-note a { color: #d9d5cc; text-decoration: none; border-bottom: 1px solid rgba(255,255,255,.25); padding-bottom: .15rem; white-space: nowrap; transition: border-color .25s, color .25s; }
  .ex-note a:hover { color: #fff; border-bottom-color: #fff; }
  .ex-section { margin-top: 6.5rem; }
  .ex-list { list-style: none; margin: 0; padding: 0; border-bottom: 1px solid rgba(255,255,255,.08); }
  .ex-list li { border-top: 1px solid rgba(255,255,255,.08); }
  .ex-row { display: grid; grid-template-columns: 2.6rem 1fr 1.4rem; align-items: center; width: 100%; margin: 0; padding: 1.7rem 0; background: none; border: 0;
    color: inherit; font: inherit; text-align: left; cursor: pointer; transition: opacity .3s; }
  .ex-num { grid-row: 1 / 3; align-self: start; padding-top: .65rem; color: #55524d; font-size: .72rem; letter-spacing: .18em; }
  .ex-title { font-size: clamp(1.05rem, 2.6vw, 1.35rem); line-height: 1.35; letter-spacing: .08em; color: #eae7e0; transition: color .25s; }
  .ex-meta { grid-column: 2; margin-top: .25rem; color: #77746e; font-size: .82rem; }
  .ex-arrow { grid-column: 3; grid-row: 1 / 3; justify-self: end; color: #55524d; transition: transform .3s, color .3s; }
  .ex-list:hover .ex-row:not(:hover) { opacity: .4; }
  .ex-row:hover .ex-title, .ex-row:focus-visible .ex-title { color: #fff; }
  .ex-row:hover .ex-arrow, .ex-row:focus-visible .ex-arrow { transform: translateX(5px); color: #e7e4de; }
  .ex-row:focus-visible { outline: 1px solid rgba(255,255,255,.5); outline-offset: 4px; }
  .ex-d-title { font-size: clamp(1.5rem, 4.6vw, 2.5rem); line-height: 1.25; letter-spacing: .14em; text-transform: uppercase; color: #fff; margin: 0 0 .9rem; outline: none; text-shadow: 0 0 30px rgba(255,255,255,.14); animation: exDriftA 12s ease-in-out infinite alternate; }
  .ex-lead { font-size: 1.2rem; letter-spacing: .03em; color: #d3cfc6; margin: 2rem 0; max-width: 38rem; animation: exDriftC 15s ease-in-out infinite alternate; }
  .ex-long { color: #bdb9b1; font-size: 1.02rem; max-width: 38rem; }
  .ex-long p, .ex-long li { color: #bdb9b1 !important; text-align: left !important; }
  .ex-long p { margin: 0 0 1.1rem !important; }
  .ex-long ul { padding-left: 1.1rem; margin: 0 0 1.1rem; }
  .ex-long b, .ex-long strong { color: #e7e4de; font-weight: 400; }
  .ex-long-wide { max-width: 100%; margin: 2.4rem 0; }
  .ex-quote { border-left: 2px solid #ff6644; padding: .4rem 0 .4rem 1.2rem; margin: 2rem 0 2.5rem; }
  .ex-quote p { font-size: 1.25rem; color: #f1eee8 !important; margin: 0 0 .35rem !important; letter-spacing: .02em; }
  .ex-quote small { display: block; font-size: .72rem; letter-spacing: .2em; text-transform: uppercase; color: #8a867f; }
  .ex-triad { display: grid; grid-template-columns: repeat(auto-fit, minmax(13.5rem, 1fr)); gap: 1rem; margin: 1.8rem 0 2.4rem; }
  .ex-card { border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.015); padding: 1.15rem; }
  .ex-card-kicker { font-size: .65rem; letter-spacing: .22em; text-transform: uppercase; color: #ff6644; margin-bottom: .4rem; display: block; }
  .ex-card strong { display: block; color: #fff; font-weight: 400; letter-spacing: .06em; margin-bottom: .5rem; font-size: .98rem; }
  .ex-card p { font-size: .88rem !important; line-height: 1.6; margin: 0 !important; color: #bdb9b1 !important; }
  .ex-table-wrap { overflow-x: auto; margin: 1.8rem 0 2.6rem; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.01); }
  .ex-table { width: 100%; border-collapse: collapse; font-size: .84rem; line-height: 1.6; text-align: left; min-width: 38rem; }
  .ex-table th, .ex-table td { padding: .95rem 1rem; border-bottom: 1px solid rgba(255,255,255,.08); border-right: 1px solid rgba(255,255,255,.06); vertical-align: top; }
  .ex-table th:last-child, .ex-table td:last-child { border-right: 0; }
  .ex-table th { font-size: .66rem; letter-spacing: .2em; text-transform: uppercase; color: #8a867f; font-weight: 400; background: rgba(255,255,255,.025); }
  .ex-table td ul { margin: 0; padding-left: 1rem; }
  .ex-table td li { margin-bottom: .35rem; }
  .ex-gap { margin-top: 4rem; }
  .ex-videos, .ex-gallery { display: grid; gap: 1.4rem; }
  .ex-videos iframe, .ex-videos video { width: 100%; aspect-ratio: 16 / 9; border: 0; background: #000; display: block; }
  
  /* 🔥 ESTILOS DEL VISOR AMPLIADO (LIGHTBOX) PARA TODAS LAS IMÁGENES 🔥 */
  .ex-gallery .ex-schema-card { background: #0d0d10; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; padding: 10px; cursor: zoom-in; transition: transform .3s ease; }
  .ex-gallery .ex-schema-card:hover { transform: scale(1.01); border-color: rgba(255,255,255,0.3); }
  .ex-gallery .ex-schema-card img { width: 100%; height: auto; display: block; filter: saturate(.92); pointer-events: none; }
  
  #ex-lightbox { position: fixed; inset: 0; z-index: 100050; display: flex; align-items: center; justify-content: center; padding: 3vw; background: rgba(5,5,8,0.92); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); cursor: zoom-out; animation: exLbIn 0.3s ease forwards; }
  #ex-lightbox[hidden] { display: none; }
  #ex-lightbox img { max-width: 94vw; max-height: 90vh; object-fit: contain; border: 1px solid rgba(255,255,255,0.18); box-shadow: 0 30px 90px rgba(0,0,0,0.8); background: #0d0d10; border-radius: 4px; }
  @keyframes exLbIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }

  .ex-btn, .ex-send { display: inline-block; margin-top: 2.5rem; background: none; border: 1px solid rgba(255,255,255,.3); color: #e7e4de; text-decoration: none;
    padding: .9rem 1.8rem; font: inherit; font-size: .74rem; letter-spacing: .22em; text-transform: uppercase; cursor: pointer; transition: background .25s, border-color .25s; }
  .ex-btn:hover, .ex-send:hover { background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.6); }
  .ex-send { margin-top: 0; }
  .ex-send:disabled { opacity: .5; cursor: wait; }
  .ex-pager { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 6rem; padding-top: 2rem; border-top: 1px solid rgba(255,255,255,.08); }
  .ex-pager button { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .ex-pager button:last-child { text-align: right; }
  .ex-pager .ex-label { display: block; margin-bottom: .4rem; }
  .ex-pager-title { display: block; font-size: 1.05rem; letter-spacing: .06em; color: #d3cfc6; transition: color .25s; }
  .ex-pager button:hover .ex-pager-title { color: #fff; }
  .ex-form { display: grid; gap: 1.8rem; max-width: 34rem; margin-top: 1.6rem; }
  .ex-field { display: grid; gap: .2rem; font-size: .7rem; letter-spacing: .2em; text-transform: uppercase; color: #77746e; }
  .ex-field input, .ex-field textarea { background: transparent; border: 0; border-bottom: 1px solid rgba(255,255,255,.18); border-radius: 0; color: #f1eee8; padding: .6rem 0;
    font: inherit; font-size: 1.05rem; letter-spacing: normal; text-transform: none; outline: none; resize: vertical; width: 100%; transition: border-color .25s; }
  .ex-field input:focus, .ex-field textarea:focus { border-bottom-color: rgba(255,255,255,.7); }
  .ex-status { min-height: 1.4em; margin: 0; font-size: .9rem; color: #a9a59d; }
  .ex-status[data-state="ok"] { color: #b9c8b0; }
  .ex-status[data-state="err"] { color: #d1a6a0; }
  .ex-foot { margin-top: 7rem; color: #55524d; font-size: .72rem; letter-spacing: .18em; text-transform: uppercase; }
  @media (max-width: 768px) {
    .ex-wrap { padding: 5.2rem 1.25rem 5rem; }
    .ex-mark { display: none; }
    .ex-bar { margin-bottom: 3rem; }
    .ex-section { margin-top: 4.5rem; }
    body.ex-mode-active #mode-toggle-btn { 
      top: 18px !important; right: 16px !important; left: auto !important; width: auto !important;
      transform: none !important; font-size: 0.68rem !important; padding: 8px 16px !important;
      border-radius: 20px !important; background: rgba(18,18,22,0.9) !important; border: 1px solid rgba(255,255,255,0.22) !important;
    }
  }
  @media (prefers-reduced-motion: reduce) { #terminal-container * { transition: none !important; animation: none !important; scroll-behavior: auto !important; } }
`;

const executiveStyle = document.createElement('style');
executiveStyle.id = 'ex-style';
executiveStyle.innerHTML = EX_CSS;
document.head.appendChild(executiveStyle);

let isTerminalMode = false;
const exState = { view: 'index', id: null, scroll: 0 };
const exSaved = {}; 

const EX_TEXT = {
  es: { eyebrow: 'Archivo en calma…', sub: 'Un archivo para leer despacio.', projects: 'Proyectos', cv: 'Currículum', contact: 'Contacto', contactSub: 'Para proyectos, invitaciones o colaboraciones.',
        toArchive: 'Archivo ejecutivo', toImmersive: 'Universo 3D', startBtn: 'Archivo ejecutivo',
        soundOn: 'Sonido: sí', soundOff: 'Sonido: no',
        note: 'Existe otra manera de recorrer este archivo: un universo inmersivo e interactivo, con juego y sonido.', noteLink: 'Despertar el universo →',
        hint3d: 'Universo 3D: exploración inmersiva e interactiva, con sonido. Usa más recursos.', hintExec: 'Archivo ejecutivo: lectura rápida de los proyectos.',
        back: 'Volver', prev: 'Anterior', next: 'Siguiente', visit: 'Visitar enlace externo', video: 'Video', images: 'Galería',
        fName: 'Nombre', fMail: 'Correo', fMsg: 'Mensaje', send: 'Enviar', sending: 'Enviando…', sent: 'Mensaje enviado. Gracias.', failed: 'No se pudo enviar. Inténtalo de nuevo.', expandImg: 'Clic para ampliar imagen' },
  en: { eyebrow: 'Archive at rest…', sub: 'An archive to be read slowly.', projects: 'Projects', cv: 'Résumé', contact: 'Contact', contactSub: 'For projects, invitations or collaborations.',
        toArchive: 'Executive archive', toImmersive: '3D universe', startBtn: 'Executive archive',
        soundOn: 'Sound: on', soundOff: 'Sound: off',
        note: 'There is another way to wander through this archive: an immersive, interactive universe, with a game and sound.', noteLink: 'Awaken the universe →',
        hint3d: '3D universe: immersive, interactive exploration, with sound. Uses more resources.', hintExec: 'Executive archive: a quick read of the projects.',
        back: 'Back', prev: 'Previous', next: 'Next', visit: 'Visit external link', video: 'Video', images: 'Gallery',
        fName: 'Name', fMail: 'Email', fMsg: 'Message', send: 'Send', sending: 'Sending…', sent: 'Message sent. Thank you.', failed: 'Could not send. Please try again.', expandImg: 'Click to expand' }
};

const EX_PROFILE = {
  name: 'Daniel Rodríguez García',
  role: { es: 'Profesor de Diseño Interactivo · Director del GameLab Tadeo', en: 'Interactive Design Professor · Director, Tadeo GameLab' },
  background: {
    es: 'Diseñador Industrial (PUJ) con Máster en Creación de Videojuegos (UPF). Candidato a Doctorado en Diseño, Arte y Ciencia. Ex-coordinador del MediaLab Cinemateca y coordinador/tallerista de Territorios Digitales con Plataforma Bogotá.',
    en: "Industrial Designer (PUJ) with a Master's in Video Game Creation (UPF). PhD candidate in Design, Art and Science. Former coordinator of MediaLab Cinemateca and coordinator/workshop facilitator for Digital Territories with Plataforma Bogotá."
  },
  about: {
    es: 'Mi preparación se enfoca en el diseño, creación y producción de videojuegos y experiencias interactivas inmersivas (Fulldome, VR, AR). Exploro las dimensiones críticas y sociales a través de los “Juegos Otros” y la pedagogía lúdica, integrando tecnologías físicas (Arduino, Raspberry Pi) y lógicas de diseño universal para la accesibilidad.',
    en: 'My background focuses on the design, creation and production of video games and immersive interactive experiences (Fulldome, VR, AR). I explore critical and social dimensions through “Other Games” and playful pedagogy, integrating physical computing (Arduino, Raspberry Pi) and universal design principles for accessibility.'
  },
  skills: ['Game Mechanics', 'Creative Coding', 'TouchDesigner', 'Processing', 'Unity', 'Blender', 'FMOD', 'Physical Computing'],
  cv: '/docs/CV_Daniel.pdf',
  links: [
    { label: 'LinkedIn', url: 'https://www.linkedin.com/in/dargdesigner/' },
    { label: 'GitHub', url: 'https://github.com/darg88' },
    { label: 'Instagram', url: 'https://www.instagram.com/danielrodgarc/' },
    { label: 'YouTube', url: 'https://www.youtube.com/@GameLabTadeo' }
  ]
};

// ============================================================
// 📐 LÁMINAS DIAGRAMÁTICAS DEL MARCO DOCTORAL D.A.C. (SVG EMBEBIDO)
// ============================================================
const dacSlideSvg = (inner) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 430">
    <rect width="800" height="430" fill="#0d0d10"/>
    <rect x="1" y="1" width="798" height="428" fill="none" stroke="#ffffff" stroke-opacity="0.09"/>
    <g stroke="#ffffff" stroke-opacity="0.22" stroke-width="1">
      <path d="M16 26h14M23 19v14M770 26h14M777 19v14M16 404h14M23 397v14M770 404h14M777 397v14"/>
    </g>
    ${inner}
  </svg>`
);

const DAC_FIG_BUCLE = dacSlideSvg(`
  <text x="38" y="42" fill="#8a867f" font-family="monospace" font-size="11" letter-spacing="2.5">LÁMINA I // EL BUCLE D.A.C. — RECHAZO AL DETERMINISMO Y PENSAMIENTO PERIFÉRICO</text>
  <g fill="none" stroke="#e7e4de" stroke-width="1.2" stroke-opacity="0.72">
    <circle cx="400" cy="165" r="78"/><circle cx="400" cy="165" r="62" stroke-opacity="0.25" stroke-dasharray="3 3"/>
    <circle cx="340" cy="260" r="78"/><circle cx="340" cy="260" r="62" stroke-opacity="0.25" stroke-dasharray="3 3"/>
    <circle cx="460" cy="260" r="78"/><circle cx="460" cy="260" r="62" stroke-opacity="0.25" stroke-dasharray="3 3"/>
  </g>
  <circle cx="400" cy="228" r="25" fill="#ff6644" fill-opacity="0.16" stroke="#ff6644" stroke-width="1.2"/>
  <circle cx="400" cy="228" r="3" fill="#ff6644"/>
  <text x="400" y="128" fill="#ffffff" font-family="sans-serif" font-weight="300" font-size="13" letter-spacing="4" text-anchor="middle">ARTE · ETHOS</text>
  <text x="292" y="290" fill="#ffffff" font-family="sans-serif" font-weight="300" font-size="13" letter-spacing="3" text-anchor="middle">CIENCIA · LOGOS</text>
  <text x="508" y="290" fill="#ffffff" font-family="sans-serif" font-weight="300" font-size="13" letter-spacing="3" text-anchor="middle">DISEÑO · PATHOS</text>
  <text x="55" y="88" fill="#e7e4de" font-family="monospace" font-size="10">SUSTRATO: PENSAMIENTO PERIFÉRICO (KENTRIDGE)</text>
  <text x="55" y="104" fill="#8a867f" font-family="monospace" font-size="9.5">Operación: Ana-arqueología y desmantelamiento de la caja negra</text>
  <text x="55" y="348" fill="#e7e4de" font-family="monospace" font-size="10">SUSTRATO: BIOLOGÍA DEL CONOCIMIENTO (MATURANA / VARELA)</text>
  <text x="55" y="364" fill="#8a867f" font-family="monospace" font-size="9.5">Operación: Autopoiesis y acoplamiento estructural activo</text>
  <text x="745" y="348" fill="#e7e4de" font-family="monospace" font-size="10" text-anchor="end">SUSTRATO: RETÓRICA PROCEDIMENTAL (BOGOST)</text>
  <text x="745" y="364" fill="#8a867f" font-family="monospace" font-size="9.5" text-anchor="end">Operación: El hardware como enunciador persuasivo</text>
  <text x="400" y="404" fill="#77746e" font-family="monospace" font-size="10" letter-spacing="2" text-anchor="middle">LA CIENCIA NO SOLO MIDE · EL ARTE NO SOLO EXPRESA · EL DISEÑO NO SOLO SOLUCIONA</text>
`);

const DAC_FIG_ERRATICA = dacSlideSvg(`
  <text x="38" y="42" fill="#8a867f" font-family="monospace" font-size="11" letter-spacing="2.5">LÁMINA II // LOGOS · LA MÁQUINA ERRÁTICA Y EL GLITCH COMO MANIFIESTO</text>
  <g fill="none" stroke="#8a867f" stroke-width="1">
    <rect x="60" y="105" width="210" height="210" stroke-opacity="0.4"/>
    <path d="M95 105v210M155 105v210M215 105v210M60 155h210M60 210h210M60 265h210" stroke-opacity="0.2"/>
  </g>
  <polyline points="270,210 330,210 348,180 368,245 388,162 408,234 424,210 500,210" fill="none" stroke="#ff6644" stroke-width="2.2"/>
  <g transform="translate(580,210) rotate(45)" fill="none" stroke="#e7e4de" stroke-width="1.2">
    <rect x="-65" y="-65" width="130" height="130"/>
    <rect x="-42" y="-42" width="84" height="84" stroke-opacity="0.45"/>
    <rect x="-18" y="-18" width="36" height="36" stroke="#ff6644" fill="#ff6644" fill-opacity="0.16"/>
  </g>
  <circle cx="580" cy="210" r="3.5" fill="#ff6644"/>
  <text x="388" y="135" fill="#ff6644" font-family="monospace" font-size="10.5" letter-spacing="1.5" text-anchor="middle">EL FALLO NO ES UN DEFECTO A OPTIMIZAR: ES UN ARGUMENTO PERSUASIVO</text>
  <text x="165" y="348" fill="#bdb9b1" font-family="monospace" font-size="10" text-anchor="middle">CIRCUITO CERRADO (CAJA HERMÉTICA)</text>
  <text x="580" y="348" fill="#bdb9b1" font-family="monospace" font-size="10" text-anchor="middle">REVELACIÓN DE LA ARQUITECTURA DEL SILICIO</text>
  <text x="400" y="404" fill="#77746e" font-family="monospace" font-size="10" letter-spacing="2" text-anchor="middle">EL «ERRAR» Y LA INFERENCIA ABDUCTIVA EN LA INVESTIGACIÓN-CREACIÓN (I+C)</text>
`);

const DAC_FIG_POETICA = dacSlideSvg(`
  <text x="38" y="42" fill="#8a867f" font-family="monospace" font-size="11" letter-spacing="2.5">LÁMINA III // ETHOS · LA MÁQUINA POÉTICA — DESCALIBRACIÓN COMO PRODUCCIÓN ESTÉTICA</text>
  <g stroke="#ffffff" stroke-opacity="0.16" stroke-width="1">
    <path d="M65 92h260v240H65z" fill="none"/>
    <path d="M117 92v240M169 92v240M221 92v240M273 92v240M65 140h260M65 188h260M65 236h260M65 284h260"/>
  </g>
  <line x1="382" y1="80" x2="382" y2="344" stroke="#ff6644" stroke-width="1.2" stroke-dasharray="4 4"/>
  <g fill="#e7e4de" fill-opacity="0.75">
    <circle cx="440" cy="120" r="2"/><circle cx="485" cy="108" r="1.5"/><circle cx="520" cy="145" r="2.2"/><circle cx="570" cy="118" r="1.8"/>
    <circle cx="625" cy="135" r="2"/><circle cx="670" cy="112" r="1.5"/><circle cx="458" cy="185" r="1.8"/><circle cx="545" cy="195" r="2.2"/>
    <circle cx="605" cy="178" r="1.6"/><circle cx="685" cy="195" r="2"/><circle cx="435" cy="248" r="2"/><circle cx="508" cy="260" r="1.5"/>
    <circle cx="590" cy="245" r="2.2"/><circle cx="648" cy="268" r="1.8"/><circle cx="470" cy="308" r="1.6"/><circle cx="555" cy="312" r="2"/>
  </g>
  <g stroke="#ff6644" stroke-opacity="0.55" stroke-width="1" fill="none">
    <path d="M490 142 L585 162 L532 238 L468 218 Z"/><line x1="585" y1="162" x2="645" y2="225"/><line x1="532" y1="238" x2="645" y2="225"/>
  </g>
  <g fill="#ff6644">
    <circle cx="490" cy="142" r="5"/><circle cx="585" cy="162" r="5"/><circle cx="532" cy="238" r="5"/><circle cx="468" cy="218" r="5"/><circle cx="645" cy="225" r="5"/>
  </g>
  <text x="195" y="365" fill="#8a867f" font-family="monospace" font-size="10" text-anchor="middle">CUADRÍCULA PULCRA CORPORATIVA</text>
  <text x="565" y="365" fill="#e7e4de" font-family="monospace" font-size="10" text-anchor="middle">MATRIZ DE DATOS CRUDOS (NUBE DE PUNTOS) COMO LIENZO</text>
  <text x="400" y="404" fill="#77746e" font-family="monospace" font-size="10" letter-spacing="2" text-anchor="middle">SUBVERSIÓN DEL SENTIDO · ABANDONO DE LA LÓGICA INSTRUMENTAL · CREACIÓN DE MUNDOS</text>
`);

const DAC_FIG_SABER = dacSlideSvg(`
  <text x="38" y="42" fill="#8a867f" font-family="monospace" font-size="11" letter-spacing="2.5">LÁMINA IV // PATHOS · SABER SITUADO Y EL PLANO DE LA FRICCIÓN</text>
  <circle cx="130" cy="220" r="16" fill="#ff6644" fill-opacity="0.18" stroke="#ff6644" stroke-width="1.5"/>
  <circle cx="130" cy="220" r="4" fill="#ff6644"/>
  <text x="130" y="258" fill="#ffffff" font-family="sans-serif" font-weight="300" font-size="12" letter-spacing="2" text-anchor="middle">EL ARTEFACTO</text>
  <text x="130" y="275" fill="#8a867f" font-family="monospace" font-size="10" text-anchor="middle">DISPOSITIVO EPISTÉMICO</text>
  <g fill="none" stroke="#e7e4de" stroke-opacity="0.55" stroke-width="1.2">
    <path d="M146 214 C 255 210, 285 115, 410 115"/>
    <path d="M146 220 L 410 220"/>
    <path d="M146 226 C 255 230, 285 325, 410 325"/>
  </g>
  <circle cx="410" cy="115" r="4" fill="#ff6644"/><circle cx="410" cy="220" r="4" fill="#ff6644"/><circle cx="410" cy="325" r="4" fill="#ff6644"/>
  <text x="430" y="110" fill="#ffffff" font-family="sans-serif" font-weight="400" font-size="11.5" letter-spacing="1.8">1. EL SABER-DEL-CUERPO / DIMENSIÓN SOMÁTICA</text>
  <text x="430" y="128" fill="#bdb9b1" font-family="monospace" font-size="9.5">Reactivación propioceptiva · Negociación táctil con la ruina tecnológica</text>
  <text x="430" y="215" fill="#ffffff" font-family="sans-serif" font-weight="400" font-size="11.5" letter-spacing="1.8">2. LUDOACTIVISMO / DIMENSIÓN PROCEDIMENTAL</text>
  <text x="430" y="233" fill="#bdb9b1" font-family="monospace" font-size="9.5">El juego desobediente · Auditar y subvertir reglas opacas</text>
  <text x="430" y="320" fill="#ffffff" font-family="sans-serif" font-weight="400" font-size="11.5" letter-spacing="1.8">3. LABORATORIOS ITINERANTES / DIMENSIÓN TERRITORIAL</text>
  <text x="430" y="338" fill="#bdb9b1" font-family="monospace" font-size="9.5">GameLab Tadeo → Mercados de pulgas → Periferia de la basura electrónica</text>
  <text x="400" y="404" fill="#77746e" font-family="monospace" font-size="10" letter-spacing="2" text-anchor="middle">LA PRÁCTICA DEL CACHARREO COMO ARTICULADOR DE LA TRÍADA</text>
`);

const EX_DAC = {
  id: 99,
  title: { es: 'D.A.C. // Retórica Procedimental Material', en: 'D.A.C. // Material Procedural Rhetoric' },
  desc: { es: 'El diseño de «Juegos Otros» como dispositivo epistémico para la soberanía tecnológica situada.', en: 'The design of "Other Games" as an epistemic device for situated technological sovereignty.' },
  role: { es: 'Postura Epistémica · Doctorado en Diseño, Arte y Ciencia', en: 'Epistemic Posture · PhD in Design, Art, and Science' },
  tech: { es: ['Diseñarticienciar', 'Retórica Material', 'Juegos Otros', 'Ana-arqueología', 'Cacharreo', 'Ludoactivismo', 'Soberanía Tecnológica'], en: ['Diseñarticienciar', 'Material Rhetoric', 'Other Games', 'Media An-archaeology', 'Cacharreo', 'Ludo-activism', 'Tech Sovereignty'] },
  longDesc: {
    es: `
      <div class="ex-quote">
        <p>«La usabilidad sin fricción es una anestesia cognitiva.»</p>
        <small>Diseñarticienciar · Retórica Procedimental Material en el Bucle D.A.C.</small>
      </div>
      <h3 class="ex-label" style="margin-top:2.4rem">I. La Máquina Hermética vs. El Imperativo Material</h3>
      <p>El paradigma comercial contemporáneo descansa sobre tres mecanismos de domesticación: una <b>interfaz pulcra estandarizada</b>, la <b>ilusión de inmaterialidad</b> y el <b>acoplamiento pasivo del usuario</b>. Su costo somático es profundo: el ocultamiento de la arquitectura física del dispositivo, el letargo del cuerpo frente a la pantalla y la automatización de la cognición del sujeto.</p>
      <p>Frente a ello, el imperativo del proyecto doctoral consiste en <b>desmantelar la máquina hermética</b> y reintroducir la resistencia material intencional frente al diseño aséptico.</p>
      <h3 class="ex-label" style="margin-top:2.6rem">II. La Poética del Error y la Retórica Material</h3>
      <p>En esta postura epistémica, <b>el fallo técnico no es un defecto a optimizar; es un argumento persuasivo</b>. La investigación opera desde tres premisas:</p>
      <ul>
        <li><b>El Glitch como Manifiesto:</b> La inestabilidad introducida obliga al sistema cerrado a confesar su propia física, materialidad y arquitectura oculta.</li>
        <li><b>Procedimientos Persuasivos:</b> Las mecánicas del hardware y las resistencias del circuito no son neutrales; argumentan, orientan y moldean activamente la conducta.</li>
        <li><b>Revelación de la Materia:</b> La falla destruye la magia tecnológica inmaterial. La materia técnica deja de ser un reproductor silencioso para convertirse en una enunciadora.</li>
      </ul>
      <h3 class="ex-label" style="margin-top:2.6rem">III. Juegos Otros: Diseñar para el Errar</h3>
      <p>Asumir <b>la fricción material como método proyectual</b> implica diseñar desde la inestabilidad para transformar el vínculo entre sujeto y artefacto en tres niveles:</p>
      <ul>
        <li><b>1. Negociación Física:</b> Sistemas lúdicos construidos desde la precariedad (hardware abierto, residuos y <em>E-waste</em>) que exigen una participación táctil, inestable y no automatizada.</li>
        <li><b>2. Conciencia Somática:</b> La resistencia material del dispositivo opera como una perturbación intencional en el ecosistema del usuario para despertar el <em>«saber-del-cuerpo»</em>.</li>
        <li><b>3. Agencia Crítica:</b> Transición del letargo del consumidor a la reorganización activa. Al exigir una adaptación constante, se recupera la soberanía frente al dispositivo.</li>
      </ul>
      <div class="ex-long-wide">
        <h3 class="ex-label" style="margin-top:2.8rem">IV. El Bucle D.A.C. y la Tríada de Máquinas (Discrepancia como Motor Ontológico)</h3>
        <p style="max-width:38rem; margin-bottom:1.2rem;">El Bucle D.A.C. rechaza el determinismo disciplinar: <b>la ciencia no solo mide, el arte no solo expresa, el diseño no solo soluciona</b>. Articuladas por la práctica del <b>Cacharreo</b>, tres máquinas configuran el motor ontológico de la investigación:</p>
        <div class="ex-triad">
          <div class="ex-card">
            <span class="ex-card-kicker">Modo Pathos · Diseño</span>
            <strong>Máquina de Fricción</strong>
            <p><b>Función:</b> Perturbación material intencional.<br><b>Concepto:</b> Resistencia física, basura electrónica y ruptura de la hiper-usabilidad.<br><b>Sustrato:</b> Retórica Procedimental Material (Bogost) — el hardware como enunciador persuasivo.</p>
          </div>
          <div class="ex-card">
            <span class="ex-card-kicker">Modo Ethos · Arte</span>
            <strong>Máquina Poética</strong>
            <p><b>Función:</b> Subversión del sentido.<br><b>Concepto:</b> Poética digital de la descalibración; la matriz de datos crudos (nube de puntos) como lienzo de expresión frente a la representación pulcra corporativa.<br><b>Sustrato:</b> Pensamiento Periférico (Kentridge) y Ana-arqueología de medios.</p>
          </div>
          <div class="ex-card">
            <span class="ex-card-kicker">Modo Logos · Ciencia</span>
            <strong>Máquina Errática</strong>
            <p><b>Función:</b> El glitch y la inestabilidad.<br><b>Concepto:</b> El «errar» y la inferencia abductiva en la Investigación-Creación (I+C). El tartamudeo de la materia técnica revela la arquitectura interna del silicio.<br><b>Sustrato:</b> Biología del Conocimiento (Maturana / Varela) — autopoiesis y acoplamiento estructural.</p>
          </div>
        </div>
      </div>
      <h3 class="ex-label" style="margin-top:2.4rem">V. Saber Situado: El Plano de la Fricción</h3>
      <p>El artefacto («Juego Otro») se despliega como dispositivo epistémico en tres dimensiones situadas:</p>
      <ul>
        <li><b>El Saber-del-Cuerpo (Dimensión Somática):</b> Reactivación propioceptiva y negociación táctil con la ruina tecnológica. Validación: quiebre de la anestesia cognitiva mediante el acoplamiento activo.</li>
        <li><b>Ludoactivismo (Dimensión Procedimental):</b> El juego desobediente. Validación: soberanía tecnológica y capacidad de auditar y subvertir reglas opacas.</li>
        <li><b>Laboratorios Itinerantes (Dimensión Territorial):</b> <em>GameLab Tadeo → Mercados de pulgas → Redes populares</em>. Validación: transformación micropolítica en la periferia de la basura electrónica.</li>
      </ul>
      <div class="ex-long-wide">
        <h3 class="ex-label" style="margin-top:2.8rem">VI. Matriz Epistémica del Marco Doctoral</h3>
        <div class="ex-table-wrap">
          <table class="ex-table">
            <thead>
              <tr>
                <th>Esfera D.A.C. &amp; Modo Retórico</th>
                <th>Subdisciplinas / Prácticas Específicas</th>
                <th>Operación en el Artefacto («Juego Otro»)</th>
                <th>Autores Marco Doctoral</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong style="color:#fff;">DISEÑO</strong><br><span style="color:#ff6644; font-size:.75rem;">[MODO PATHOS]</span><br><small style="color:#8a867f;">Máquina de Fricción</small></td>
                <td>
                  <ul>
                    <li><b>Diseño de «Juegos Otros» y Ludoactivismo:</b> Subversión de reglas y mecánicas regionales.</li>
                    <li><b>Diseño Interactivo y Computación Física:</b> Prototipado con hardware libre y <em>E-waste</em>.</li>
                    <li><b>Retórica Procedimental Material:</b> El objeto físico como argumento persuasivo.</li>
                    <li><b>Diseño Ontológico y Ecoproyectualidad:</b> Autonomía y reparación frente al proyecto «vulgar».</li>
                  </ul>
                </td>
                <td>Materializa la crítica en interfaces tangibles e indóciles. Introduce fricción física (soldaduras expuestas, latón oxidado, sensores descalibrados) para quebrar la hiper-usabilidad de la <em>caja hermética</em>, exigiendo una negociación somática que despierta el <b>«saber-del-cuerpo»</b>.</td>
                <td>Ian Bogost · Arturo Escobar · Blanca Callén · Durgan A. Nallar · William Gaver · Donald Norman (crítica) · Y.M.M. Martínez / P.C. Herrera</td>
              </tr>
              <tr>
                <td><strong style="color:#fff;">ARTE</strong><br><span style="color:#ff6644; font-size:.75rem;">[MODO ETHOS]</span><br><small style="color:#8a867f;">Máquina Poética</small></td>
                <td>
                  <ul>
                    <li><b>Artes Electrónicas y Media Arts:</b> Intervención estética de señales y circuitos.</li>
                    <li><b>Arte del Glitch y Estética del Error:</b> La falla técnica como lenguaje insubordinado.</li>
                    <li><b>Tecnopoéticas Latinoamericanas:</b> Desestabilización de regímenes de representación.</li>
                    <li><b>Ecología de la Mirada:</b> Pensamiento periférico frente a la visión central corporativa.</li>
                  </ul>
                </td>
                <td>Abandona la funcionalidad utilitaria para abrir mundos. Subvierte la imagen pulcra proyectando matrices de datos crudos (nubes de puntos inestables) y dota a la ruina electrónica de un carácter ético, poético y decolonial situado en el Sur Global.</td>
                <td>Claudia Kozak · Rosa Menkman · William Kentridge · Fernando Suárez-Carballo · Suely Rolnik &amp; Félix Guattari</td>
              </tr>
              <tr>
                <td><strong style="color:#fff;">CIENCIA</strong><br><span style="color:#ff6644; font-size:.75rem;">[MODO LOGOS]</span><br><small style="color:#8a867f;">Máquina Errática</small></td>
                <td>
                  <ul>
                    <li><b>Biología del Conocimiento y Cibernética:</b> Autopoiesis y acoplamiento estructural.</li>
                    <li><b>Ana-arqueología y Geología de Medios:</b> Excavación física y mineral del hardware.</li>
                    <li><b>Física Electrónica y Lógica Inferencial:</b> Voltajes, sensores y método abductivo.</li>
                    <li><b>Pensamiento Sistémico y Epistemologías del Sur:</b> Ecología profunda e IAPT sentipensante.</li>
                  </ul>
                </td>
                <td>Provee modelos de observación rigurosa y validación. Mediante la inferencia abductiva, convierte el comportamiento errático del silicio y el ruido eléctrico en regla del sistema, revelando la arquitectura física interna de la máquina.</td>
                <td>H. Maturana &amp; F. Varela · Jussi Parikka / Sean Cubitt · Siegfried Zielinski / W. Ernst · Timothy Morton · Bruno Latour / D. Haraway · Orlando Fals Borda · Paola Ricaurte / A. Quijano</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p style="margin-top:2rem; padding-top:1.2rem; border-top:1px solid rgba(255,255,255,0.1); color:#e7e4de;">
        → Para experimentar el simulador espacial de las tres máquinas (Poética, Errática y de Fricción), cambia al <b>Universo 3D</b> con el botón superior derecho y toca el núcleo D.A.C.
      </p>
    `,
    en: `
      <div class="ex-quote">
        <p>"Frictionless usability is a cognitive anesthesia."</p>
        <small>Diseñarticienciar · Material Procedural Rhetoric in the D.A.C. Loop</small>
      </div>
      <h3 class="ex-label" style="margin-top:2.4rem">I. The Hermetic Machine vs. The Material Imperative</h3>
      <p>The contemporary commercial paradigm rests on three domesticating mechanisms: a <b>standardized spotless interface</b>, the <b>illusion of immateriality</b>, and <b>passive user coupling</b>. Its somatic cost is profound: concealing the physical architecture of the device, bodily lethargy in front of the screen, and the automation of the subject's cognition.</p>
      <p>Against this, the imperative of this doctoral research is to <b>dismantle the hermetic machine</b> and reintroduce intentional material resistance against aseptic design.</p>
      <h3 class="ex-label" style="margin-top:2.6rem">II. Poetics of Error and Material Rhetoric</h3>
      <p>Within this epistemic posture, <b>technical failure is not a defect to optimize; it is a persuasive argument</b>. The research operates from three premises:</p>
      <ul>
        <li><b>Glitch as Manifesto:</b> Introduced instability forces the closed system to confess its own physics, materiality, and hidden architecture.</li>
        <li><b>Persuasive Procedures:</b> Hardware mechanics and circuit resistances are not neutral; they actively argue, orient, and shape behavior.</li>
        <li><b>Revelation of Matter:</b> Failure shatters immaterial technological magic. Technical matter ceases to be a silent player to become an enunciator.</li>
      </ul>
      <h3 class="ex-label" style="margin-top:2.6rem">III. Other Games: Designing for Erring</h3>
      <p>Embracing <b>material friction as a design method</b> entails designing from instability to transform the bond between subject and artifact across three levels:</p>
      <ul>
        <li><b>1. Physical Negotiation:</b> Playful systems built from precarity (open hardware, residues, and <em>E-waste</em>) demanding tactile, unstable, and non-automated participation.</li>
        <li><b>2. Somatic Awareness:</b> The device's material resistance acts as an intentional perturbation in the user's ecosystem to awaken <em>"body-knowledge"</em>.</li>
        <li><b>3. Critical Agency:</b> Transitioning from consumer lethargy to active reorganization. Demanding constant adaptation reclaims sovereignty over the device.</li>
      </ul>
      <div class="ex-long-wide">
        <h3 class="ex-label" style="margin-top:2.8rem">IV. The D.A.C. Loop and the Triad of Machines (Discrepancy as Ontological Engine)</h3>
        <p style="max-width:38rem; margin-bottom:1.2rem;">The D.A.C. Loop rejects disciplinary determinism: <b>science does not only measure, art does not only express, design does not only solve</b>. Articulated through the practice of <b>Cacharreo</b>, three machines form the ontological engine of the research:</p>
        <div class="ex-triad">
          <div class="ex-card">
            <span class="ex-card-kicker">Pathos Mode · Design</span>
            <strong>Friction Machine</strong>
            <p><b>Function:</b> Intentional material perturbation.<br><b>Concept:</b> Physical resistance, electronic waste, and rupture of hyper-usability.<br><b>Substrate:</b> Material Procedural Rhetoric (Bogost) — hardware as a persuasive enunciator.</p>
          </div>
          <div class="ex-card">
            <span class="ex-card-kicker">Ethos Mode · Art</span>
            <strong>Poetic Machine</strong>
            <p><b>Function:</b> Subversion of meaning.<br><b>Concept:</b> Digital poetics of miscalibration; raw data matrices (point clouds) as an expressive canvas against corporate spotless representation.<br><b>Substrate:</b> Peripheral Thinking (Kentridge) and Media An-archaeology.</p>
          </div>
          <div class="ex-card">
            <span class="ex-card-kicker">Logos Mode · Science</span>
            <strong>Erratic Machine</strong>
            <p><b>Function:</b> Glitch and instability.<br><b>Concept:</b> "Erring" and abductive inference in Research-Creation. The stuttering of technical matter reveals silicon's internal architecture.<br><b>Substrate:</b> Biology of Cognition (Maturana / Varela) — autopoiesis and structural coupling.</p>
          </div>
        </div>
      </div>
      <h3 class="ex-label" style="margin-top:2.4rem">V. Situated Knowledge: The Plane of Friction</h3>
      <p>The artifact ("Other Game") unfolds as an epistemic device across three situated dimensions:</p>
      <ul>
        <li><b>Body-Knowledge (Somatic Dimension):</b> Proprioceptive reactivation and tactile negotiation with technological ruins. Validation: breaking cognitive anesthesia through active coupling.</li>
        <li><b>Ludo-activism (Procedural Dimension):</b> Disobedient play. Validation: technological sovereignty and the ability to audit and subvert opaque rules.</li>
        <li><b>Itinerant Laboratories (Territorial Dimension):</b> <em>GameLab Tadeo → Flea markets → Popular networks</em>. Validation: micropolitical transformation in the periphery of electronic waste.</li>
      </ul>
      <div class="ex-long-wide">
        <h3 class="ex-label" style="margin-top:2.8rem">VI. Doctoral Framework Epistemic Matrix</h3>
        <div class="ex-table-wrap">
          <table class="ex-table">
            <thead>
              <tr>
                <th>D.A.C. Sphere &amp; Rhetorical Mode</th>
                <th>Subdisciplines / Specific Practices</th>
                <th>Artifact Operation ("Other Game")</th>
                <th>Doctoral Framework Authors</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong style="color:#fff;">DESIGN</strong><br><span style="color:#ff6644; font-size:.75rem;">[PATHOS MODE]</span><br><small style="color:#8a867f;">Friction Machine</small></td>
                <td>
                  <ul>
                    <li><b>"Other Games" Design &amp; Ludo-activism:</b> Subverting rules and regional mechanics.</li>
                    <li><b>Interactive Design &amp; Physical Computing:</b> Prototyping with open hardware and <em>E-waste</em>.</li>
                    <li><b>Material Procedural Rhetoric:</b> The physical object as a persuasive argument.</li>
                    <li><b>Ontological &amp; Eco-design:</b> Autonomy and repair against the "vulgar" project.</li>
                  </ul>
                </td>
                <td>Materializes critique into tangible, unruly interfaces. Introduces physical friction (exposed solder joints, oxidized brass, uncalibrated sensors) to shatter the hyper-usability of the <em>hermetic box</em>, demanding somatic negotiation that awakens <b>"body-knowledge"</b>.</td>
                <td>Ian Bogost · Arturo Escobar · Blanca Callén · Durgan A. Nallar · William Gaver · Donald Norman (critique) · Y.M.M. Martínez / P.C. Herrera</td>
              </tr>
              <tr>
                <td><strong style="color:#fff;">ART</strong><br><span style="color:#ff6644; font-size:.75rem;">[ETHOS MODE]</span><br><small style="color:#8a867f;">Poetic Machine</small></td>
                <td>
                  <ul>
                    <li><b>Electronic &amp; Media Arts:</b> Aesthetic intervention of signals and circuits.</li>
                    <li><b>Glitch Art &amp; Aesthetics of Error:</b> Technical failure as insubordinate language.</li>
                    <li><b>Latin American Technopoetics:</b> Destabilizing regimes of representation.</li>
                    <li><b>Ecology of the Gaze:</b> Peripheral thinking against corporate central vision.</li>
                  </ul>
                </td>
                <td>Abandons utilitarian functionality to open worlds. Subverts spotless imagery by projecting raw data matrices (unstable point clouds) and endows electronic ruins with an ethical, poetic, and decolonial character situated in the Global South.</td>
                <td>Claudia Kozak · Rosa Menkman · William Kentridge · Fernando Suárez-Carballo · Suely Rolnik &amp; Félix Guattari</td>
              </tr>
              <tr>
                <td><strong style="color:#fff;">SCIENCE</strong><br><span style="color:#ff6644; font-size:.75rem;">[LOGOS MODE]</span><br><small style="color:#8a867f;">Erratic Machine</small></td>
                <td>
                  <ul>
                    <li><b>Biology of Cognition &amp; Cybernetics:</b> Autopoiesis and structural coupling.</li>
                    <li><b>Media An-archaeology &amp; Geology:</b> Physical and mineral excavation of hardware.</li>
                    <li><b>Electronic Physics &amp; Inferential Logic:</b> Voltages, sensors, and abductive method.</li>
                    <li><b>Systems Thinking &amp; Epistemologies of the South:</b> Deep ecology and feeling-thinking PAR.</li>
                  </ul>
                </td>
                <td>Provides rigorous observation and validation models. Through abductive inference, it turns erratic silicon behavior and electrical noise into system rules, revealing the machine's internal physical architecture.</td>
                <td>H. Maturana &amp; F. Varela · Jussi Parikka / Sean Cubitt · Siegfried Zielinski / W. Ernst · Timothy Morton · Bruno Latour / D. Haraway · Orlando Fals Borda · Paola Ricaurte / A. Quijano</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p style="margin-top:2rem; padding-top:1.2rem; border-top:1px solid rgba(255,255,255,0.1); color:#e7e4de;">
        → To experience the spatial simulator of the three machines (Poetic, Erratic, and Friction), switch to the <b>3D Universe</b> using the top-right button and click on the D.A.C. core.
      </p>
    `
  },
  videos: [],
  gallery: [DAC_FIG_BUCLE, DAC_FIG_ERRATICA, DAC_FIG_POETICA, DAC_FIG_SABER],
  link: ''
};

const exEsc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const exTr = (v, lang) => (v && typeof v === 'object' && !Array.isArray(v)) ? (v[lang] ?? v.es) : v;
const exLang = () => (window.currentLang === 'en' ? 'en' : 'es');
const exIsRealImg = (s) => typeof s === 'string' && s !== '' && !s.includes('via.placeholder.com') && (!s.startsWith('data:') || s.length > 400);
const exVideos = (p) => [...new Set([...(p.videos || []), p.videoSrc].filter(Boolean))];

function exProjects() {
  const base = (typeof categoryPlanetData !== 'undefined' ? categoryPlanetData : []).filter(p => p && p.id !== 999);
  return [...base, EX_DAC];
}

function exVideoHTML(src, title) {
  if (/\.(mp4|webm)(\?|$)/i.test(src)) return `<video src="${exEsc(src)}" controls preload="none" playsinline></video>`;
  const safe = String(src).replace('www.youtube.com/embed', 'www.youtube-nocookie.com/embed');
  return `<iframe src="${exEsc(safe)}" title="${exEsc(title)}" loading="lazy" allow="fullscreen; picture-in-picture" allowfullscreen></iframe>`;
}

// ---------- Vistas ----------
function exBar(leftHTML) {
  const lang = exLang(), T = EX_TEXT[lang];
  const snd = (typeof isSoundEnabled === 'undefined') || isSoundEnabled;
  return `<header class="ex-bar">${leftHTML}<button type="button" class="ex-lang" data-ex="lang" aria-label="Language / Idioma">${lang === 'es' ? 'EN' : 'ES'}</button><button type="button" class="ex-lang" data-ex="sound" aria-pressed="${snd}">${snd ? T.soundOn : T.soundOff}</button></header>`;
}

function exRenderIndex() {
  const lang = exLang(), T = EX_TEXT[lang], P = EX_PROFILE, list = exProjects();
  const rows = list.map((p, i) => {
    const meta = exTr(p.role, lang) || exTr(p.desc, lang) || '';
    return `<li><button type="button" class="ex-row" data-ex="open" data-id="${exEsc(p.id)}">
        <span class="ex-num">${String(i + 1).padStart(2, '0')}</span>
        <span class="ex-title">${exEsc(exTr(p.title, lang))}</span>
        <span class="ex-meta">${exEsc(meta)}</span>
        <span class="ex-arrow" aria-hidden="true">→</span>
      </button></li>`;
  }).join('');
  return `<div class="ex-wrap">
    ${exBar(`<span class="ex-mark">${exEsc(P.name)}</span>`)}
    <section class="ex-intro">
      <p class="ex-label ex-eyebrow">${T.eyebrow}</p>
      <h1 class="ex-name">${exEsc(P.name)}</h1>
      <p class="ex-role">${exEsc(P.role[lang])}</p>
      <p class="ex-sub">${T.sub}</p>
      <p class="ex-text">${exEsc(P.background[lang])}</p>
      <p class="ex-text">${exEsc(P.about[lang])}</p>
      <p class="ex-skills">${P.skills.map(exEsc).join(' · ')}</p>
      <nav class="ex-links">
        <a href="${exEsc(P.cv)}" target="_blank" rel="noopener">${T.cv}</a>
        ${P.links.map(l => `<a href="${exEsc(l.url)}" target="_blank" rel="noopener">${exEsc(l.label)}</a>`).join('')}
        <a href="#ex-contact" data-ex="goto-contact">${T.contact}</a>
      </nav>
      <p class="ex-note">${T.note} <a href="#" data-ex="to3d">${T.noteLink}</a></p>
    </section>
    <section class="ex-section" aria-labelledby="ex-h-projects">
      <h2 class="ex-label" id="ex-h-projects">${T.projects}</h2>
      <ol class="ex-list">${rows}</ol>
    </section>
    <section class="ex-section" id="ex-contact">
      <h2 class="ex-label">${T.contact}</h2>
      <p class="ex-text">${T.contactSub}</p>
      <form class="ex-form" id="ex-form">
        <label class="ex-field">${T.fName}<input type="text" name="identificacion" required autocomplete="name"></label>
        <label class="ex-field">${T.fMail}<input type="email" name="email" required autocomplete="email"></label>
        <label class="ex-field">${T.fMsg}<textarea name="mensaje" rows="4" required></textarea></label>
        <input type="text" name="_gotcha" tabindex="-1" autocomplete="off" style="display:none">
        <button type="submit" class="ex-send">${T.send}</button>
        <p class="ex-status" role="status" aria-live="polite"></p>
      </form>
    </section>
    <footer class="ex-foot">© ${new Date().getFullYear()} ${exEsc(P.name)}</footer>
  </div>`;
}

function exRenderDetail(id) {
  const lang = exLang(), T = EX_TEXT[lang], list = exProjects();
  const idx = list.findIndex(p => String(p.id) === String(id));
  if (idx < 0) { exState.view = 'index'; return exRenderIndex(); }
  const p = list[idx], n = list.length;
  const prev = list[(idx - 1 + n) % n], next = list[(idx + 1) % n];
  const title = exTr(p.title, lang), role = exTr(p.role, lang), desc = exTr(p.desc, lang);
  const tech = exTr(p.tech, lang) || [], longDesc = exTr(p.longDesc, lang) || '';
  const imgs = (p.gallery || []).filter(exIsRealImg), vids = exVideos(p);

  return `<div class="ex-wrap">
    ${exBar(`<button type="button" class="ex-back" data-ex="back">← ${T.back}</button>`)}
    <article aria-labelledby="ex-d-title">
      <p class="ex-label">${String(idx + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}</p>
      <h1 class="ex-d-title" id="ex-d-title" tabindex="-1">${exEsc(title)}</h1>
      ${role ? `<p class="ex-role" style="margin-bottom:.6rem">${exEsc(role)}</p>` : ''}
      ${tech.length ? `<p class="ex-skills" style="margin-top:0">${tech.map(exEsc).join(' · ')}</p>` : ''}
      ${desc ? `<p class="ex-lead">${exEsc(desc)}</p>` : ''}
      ${longDesc ? `<div class="ex-long">${longDesc}</div>` : ''}
      ${vids.length ? `<h2 class="ex-label ex-gap">${T.video}</h2><div class="ex-videos">${vids.map(v => exVideoHTML(v, title)).join('')}</div>` : ''}
      ${imgs.length ? `
        <h2 class="ex-label ex-gap">${T.images}</h2>
        <div class="ex-gallery">
          ${imgs.map((s, imgIdx) => `
            <div class="ex-schema-card" data-src="${exEsc(s)}" style="background: #0d0d10; border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; padding: 10px; cursor: zoom-in;" title="${lang === 'en' ? 'Click to expand' : 'Clic para ampliar imagen'}">
              <img src="${exEsc(s)}" alt="${exEsc(title)} - Imagen ${imgIdx + 1}" loading="lazy" style="width: 100%; height: auto; pointer-events: none;">
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${p.link ? `<a class="ex-btn" href="${exEsc(p.link)}" target="_blank" rel="noopener">${T.visit} ↗</a>` : ''}
    </article>
    <nav class="ex-pager" aria-label="Navegación entre proyectos">
      <button type="button" data-ex="open" data-id="${exEsc(prev.id)}"><span class="ex-label">← ${T.prev}</span><span class="ex-pager-title">${exEsc(exTr(prev.title, lang))}</span></button>
      <button type="button" data-ex="open" data-id="${exEsc(next.id)}"><span class="ex-label">${T.next} →</span><span class="ex-pager-title">${exEsc(exTr(next.title, lang))}</span></button>
    </nav>
  </div>`;
}

function exRender(opts = {}) {
  const c = document.getElementById('terminal-container');
  if (!c) return;
  const keep = opts.keepScroll ? c.scrollTop : null;
  c.innerHTML = exState.view === 'detail' ? exRenderDetail(exState.id) : exRenderIndex();
  if (keep !== null) c.scrollTop = keep;
  else c.scrollTop = exState.view === 'index' ? exState.scroll : 0;
  if (!opts.keepScroll && exState.view === 'detail') c.querySelector('.ex-d-title')?.focus({ preventScroll: true });
}

// ---------- Navegación ----------
window.openProjectFromTerminal = (id) => {
  const c = document.getElementById('terminal-container');
  if (!c || !isTerminalMode) return;
  const p = exProjects().find(x => String(x.id) === String(id));
  if (!p) return;
  const fromIndex = exState.view === 'index';
  if (fromIndex) exState.scroll = c.scrollTop;
  exState.view = 'detail';
  exState.id = p.id;
  exRender();
  exState.readIds = exState.readIds || new Set();
  exState.readIds.add(String(p.id));
  if (exState.readIds.size >= 3) unlockAchievement('reader');
  if (typeof playSound === 'function') playSound(fromIndex ? 'project_open' : 'ui');
  if (window.trackEvent) window.trackEvent('Ver_Proyecto', exTr(p.title, exLang()));
};

function exBack() {
  if (exState.view !== 'detail') return;
  exState.view = 'index';
  exState.id = null;
  exRender();
  if (typeof playSound === 'function') playSound('ui');
}

function exStep(delta) {
  const list = exProjects();
  const idx = list.findIndex(p => String(p.id) === String(exState.id));
  if (idx < 0) return;
  window.openProjectFromTerminal(list[(idx + delta + list.length) % list.length].id);
}

// Interruptor de sonido del modo ejecutivo
function exToggleSound() {
  const muteBtn = document.getElementById('global-mute-btn');
  if (muteBtn) muteBtn.click();
  else if (typeof isSoundEnabled !== 'undefined') {
    isSoundEnabled = !isSoundEnabled;
    if (typeof sysPrefs !== 'undefined') { sysPrefs.sound = isSoundEnabled; try { localStorage.setItem('gamelab_prefs', JSON.stringify(sysPrefs)); } catch (e) {} }
  }
  if (typeof playSound === 'function') playSound('ui'); 
}

function exRenderStartHint() {
  const hint = document.getElementById('ex-start-hint');
  if (!hint) return;
  const T = EX_TEXT[exLang()];
  hint.innerHTML = exEsc(T.hint3d) + '<br>' + exEsc(T.hintExec);
}

async function exSubmitContact(form) {
  const T = EX_TEXT[exLang()];
  const status = form.querySelector('.ex-status'), btn = form.querySelector('button[type="submit"]');
  status.dataset.state = ''; status.textContent = T.sending; btn.disabled = true;
  try {
    const res = await fetch('https://formspree.io/f/xojngrry', { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    status.dataset.state = 'ok'; status.textContent = T.sent; form.reset();
    if (window.trackEvent) window.trackEvent('Contacto', 'Mensaje_Enviado_Exito');
  } catch (err) {
    status.dataset.state = 'err'; status.textContent = T.failed;
  } finally { btn.disabled = false; }
}

window.renderTerminalGrid = exRender; 

// ---------- Cambio de modo ----------
window.toggleTerminalMode = function() {
  const c = document.getElementById('terminal-container');
  if (!c) return;
  isTerminalMode = !isTerminalMode;
  document.body.classList.toggle('ex-mode-active', isTerminalMode);
  if (typeof playSound === 'function') playSound('ui');
  ACH.toggles++;
  if (ACH.toggles >= 2) unlockAchievement('twoWorlds'); 

  const uiElements = ['portfolio-header', 'unified-hud', 'universe-legend', 'touch-controls', 'legend-sidebar', 'dac-microsite', 'legend-toggle-btn', 'btn-sword'];
  const modeBtn = document.getElementById('mode-toggle-btn');
  const T = EX_TEXT[exLang()];

  if (isTerminalMode) {
    if (typeof window.closeAllUIs === 'function') { try { window.closeAllUIs(); } catch (e) {} }
    exState.view = 'index'; exState.id = null; exState.scroll = 0;
    exRender();
    c.style.display = 'block';
    c.scrollTop = 0;
    if (modeBtn) { modeBtn.textContent = T.toImmersive; modeBtn.style.top = '24px'; modeBtn.style.display = 'block'; }
    if (typeof isPaused !== 'undefined') isPaused = true;
    uiElements.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      exSaved[id] = { display: el.style.display, opacity: el.style.opacity };
      el.style.display = 'none';
    });
  } else {
    c.style.display = 'none';
    c.innerHTML = '';
    if (modeBtn) { modeBtn.textContent = T.toArchive; modeBtn.style.top = '90px'; }
    if (typeof isPaused !== 'undefined') isPaused = false;
    uiElements.forEach(id => {
      const el = document.getElementById(id);
      if (!el || !exSaved[id]) return;
      el.style.display = exSaved[id].display;   
      el.style.opacity = exSaved[id].opacity;
      delete exSaved[id];
    });
  }
};

function initTerminalMode() {
  const startBtn = document.getElementById('start-btn');
  const skipBtn = document.getElementById('skip-btn');
  const startScreenContainer = startBtn ? startBtn.parentElement : null;
  const T0 = () => EX_TEXT[exLang()];

  // 1. Botón en la pantalla de inicio
  if (startBtn && startScreenContainer && !document.getElementById('terminal-start-btn')) {
    if (typeof dict !== 'undefined') {
      dict.es.startBtn = '[ DESPERTAR UNIVERSO 3D ]';
      dict.en.startBtn = '[ AWAKEN 3D UNIVERSE ]';
    }
    startBtn.innerText = (window.currentLang === 'en') ? dict.en.startBtn : dict.es.startBtn;

    const terminalStartBtn = document.createElement('button');
    terminalStartBtn.id = 'terminal-start-btn';
    terminalStartBtn.innerText = T0().startBtn;
    terminalStartBtn.className = startBtn.className;
    terminalStartBtn.style.cssText = 'border: 1px solid rgba(255,255,255,0.25); background: transparent; color: #e7e4de; padding: 15px 30px; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 0.78rem; font-weight: 300; text-transform: uppercase; cursor: pointer; letter-spacing: 0.22em; transition: background 0.3s; margin-top: 15px; display: none; border-radius: 0; animation: driftText1 8s ease-in-out infinite alternate;';
    terminalStartBtn.onmouseover = () => { terminalStartBtn.style.background = 'rgba(255,255,255,0.07)'; };
    terminalStartBtn.onmouseout = () => { terminalStartBtn.style.background = 'transparent'; };
    terminalStartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      terminalStartBtn.blur();
      if (typeof playSound === 'function') playSound('ui');
      const startScreen = document.getElementById('start-screen');
      if (startScreen) {
        startScreen.style.opacity = '0';
        setTimeout(() => { startScreen.style.display = 'none'; }, 1000);
      }
      if (typeof isGameStarted !== 'undefined') isGameStarted = true;
      if (!isTerminalMode) window.toggleTerminalMode();
    });
    startScreenContainer.appendChild(terminalStartBtn);

    const startHint = document.createElement('p');
    startHint.id = 'ex-start-hint';
    startHint.style.cssText = 'display: none; max-width: 30rem; margin: 18px auto 0; text-align: center; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; font-weight: 300; font-size: 0.78rem; line-height: 1.7; letter-spacing: 0.04em; color: #8a867f; animation: driftText2 12s ease-in-out infinite alternate;';
    startScreenContainer.appendChild(startHint);
    exRenderStartHint();

    const syncInterval = setInterval(() => {
      if (startBtn.style.display === 'block') {
        terminalStartBtn.style.display = 'block';
        startHint.style.display = 'block';
        if (skipBtn) skipBtn.style.display = 'none';
        clearInterval(syncInterval);
      }
    }, 100);
  }

  // 2. Botón para cambiar entre los dos modos
  let toggleBtn = document.getElementById('mode-toggle-btn');
  if (!toggleBtn) {
    toggleBtn = document.createElement('button');
    toggleBtn.id = 'mode-toggle-btn';
    toggleBtn.textContent = T0().toArchive;
    toggleBtn.style.cssText = 'position: fixed; top: 90px; right: 20px; z-index: 100000; background: rgba(10,10,12,0.55); border: 1px solid rgba(255,255,255,0.2); color: #e7e4de; padding: 9px 16px; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 0.7rem; font-weight: 300; cursor: pointer; transition: 0.3s; backdrop-filter: blur(10px); text-transform: uppercase; letter-spacing: 0.2em; border-radius: 0; display: none;';
    toggleBtn.onmouseover = () => { toggleBtn.style.background = 'rgba(255,255,255,0.08)'; toggleBtn.style.borderColor = 'rgba(255,255,255,0.45)'; };
    toggleBtn.onmouseout = () => { toggleBtn.style.background = 'rgba(10,10,12,0.55)'; toggleBtn.style.borderColor = 'rgba(255,255,255,0.2)'; };
    document.body.appendChild(toggleBtn);

    const btnInterval = setInterval(() => {
      if (typeof isGameStarted !== 'undefined' && isGameStarted) {
        toggleBtn.style.display = 'block';
        clearInterval(btnInterval);
      }
    }, 500);
  }
  toggleBtn.onclick = window.toggleTerminalMode;

  // 3. Contenedor 2D
  let terminalContainer = document.getElementById('terminal-container');
  if (!terminalContainer) {
    terminalContainer = document.createElement('div');
    terminalContainer.id = 'terminal-container';
    terminalContainer.setAttribute('role', 'region');
    terminalContainer.setAttribute('aria-label', 'Archivo ejecutivo');
    terminalContainer.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 99990; overflow-y: auto; display: none;';
    document.body.appendChild(terminalContainer);

    // Contenedor flotante para ampliar esquemas y fotos (Lightbox)
    let lightbox = document.getElementById('ex-lightbox');
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.id = 'ex-lightbox';
      lightbox.hidden = true;
      lightbox.innerHTML = `<img src="" alt="Esquema ampliado">`;
      lightbox.addEventListener('click', () => { lightbox.hidden = true; });
      document.body.appendChild(lightbox);
    }

    // Aislar el contenedor de la escena 3D:
    ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown', 'mouseup', 'mousemove',
     'pointerdown', 'pointerup', 'pointermove', 'wheel', 'click', 'dblclick', 'keydown', 'keyup']
      .forEach(evt => terminalContainer.addEventListener(evt, (e) => e.stopPropagation(), { passive: true }));

    // 🔥 Delegación de eventos (incluyendo el visor de imágenes infalible)
    terminalContainer.addEventListener('click', (e) => {
      // Detección de clic en una imagen
      const schemaCard = e.target.closest('.ex-schema-card');
      if (schemaCard) {
        const lb = document.getElementById('ex-lightbox');
        if (lb && schemaCard.dataset.src) {
          lb.querySelector('img').src = schemaCard.dataset.src;
          lb.hidden = false;
          if (typeof playSound === 'function') playSound('ui');
        }
        return; // Detenemos el clic aquí
      }

      // Resto de la lógica del archivo
      const el = e.target.closest('[data-ex]');
      if (!el) return;
      const act = el.dataset.ex;
      if (act === 'open') window.openProjectFromTerminal(el.dataset.id);
      else if (act === 'back') exBack();
      else if (act === 'lang') {
        const gameLangBtn = document.getElementById('lang-toggle-btn');
        if (gameLangBtn) gameLangBtn.click(); 
        else { window.currentLang = exLang() === 'es' ? 'en' : 'es'; exRender({ keepScroll: true }); }
      } else if (act === 'sound') {
        exToggleSound();
        exRender({ keepScroll: true });
      } else if (act === 'to3d') {
        e.preventDefault();
        if (isTerminalMode) window.toggleTerminalMode();
      } else if (act === 'goto-contact') {
        e.preventDefault();
        const target = terminalContainer.querySelector('#ex-contact');
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (target) target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        terminalContainer.querySelector('#ex-form input')?.focus({ preventScroll: true });
      }
    });

    terminalContainer.addEventListener('submit', (e) => {
      if (e.target && e.target.id === 'ex-form') { e.preventDefault(); exSubmitContact(e.target); }
    });
  }

  // 4. Teclado: Esc vuelve al índice; ← → recorren proyectos
  document.addEventListener('keydown', (e) => {
    if (!isTerminalMode || exState.view !== 'detail') return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exBack(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); exStep(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); exStep(-1); }
  }, true);

  // 5. El botón de idioma del juego
  document.getElementById('lang-toggle-btn')?.addEventListener('click', () => {
    const T = EX_TEXT[exLang()];
    const btn = document.getElementById('mode-toggle-btn');
    if (btn) btn.textContent = isTerminalMode ? T.toImmersive : T.toArchive;
    const sb = document.getElementById('terminal-start-btn');
    if (sb) sb.innerText = T.startBtn;
    exRenderStartHint();
    if (isTerminalMode) exRender({ keepScroll: true });
  });
}

setTimeout(initTerminalMode, 1000);
// ============================================================
// 🔥 SISTEMA GLOBAL DE ACCESIBILIDAD Y TOOLTIPS (UX SUBLIME)
// ============================================================
function syncAccessibilityTooltips() {
  const en = window.currentLang === 'en';
  
  // Función inyectora: Aplica title (Tooltip visual nativo) y aria-label (Lector de pantalla)
  const setTT = (id, textEs, textEn) => {
    const el = document.getElementById(id);
    if (el) {
      const txt = en ? textEn : textEs;
      el.title = txt;
      el.setAttribute('aria-label', txt);
    }
  };

  // 1. Botones Principales de Navegación
  setTT('menu-toggle', 'Menú del Sistema', 'System Menu');
  setTT('lang-toggle-btn', 'Cambiar Idioma (ES/EN)', 'Change Language (ES/EN)');
  setTT('btn-recenter', 'Centrar Vista de Cámara', 'Recenter Camera View');
  setTT('helpBtn', 'Manual de Usuario / Ayuda', 'User Manual / Help');
  setTT('legend-toggle-btn', 'Mostrar / Ocultar Leyenda', 'Toggle Legend');
  
  // 2. Botones de Estado Dinámico (Cambian según lo que esté pasando en el universo)
  const muteBtn = document.getElementById('global-mute-btn');
  if (muteBtn) {
    setTT('global-mute-btn', 
      typeof isSoundEnabled !== 'undefined' && isSoundEnabled ? 'Silenciar Audio' : 'Activar Audio', 
      typeof isSoundEnabled !== 'undefined' && isSoundEnabled ? 'Mute Audio' : 'Enable Audio'
    );
  }

  const combatBtn = document.getElementById('combat-toggle-btn');
  if (combatBtn) {
    setTT('combat-toggle-btn', 
      typeof isCombatActive !== 'undefined' && isCombatActive ? 'Abortar Simulación (Modo Paz)' : 'Activar Anomalías (Minijuego)', 
      typeof isCombatActive !== 'undefined' && isCombatActive ? 'Abort Simulation (Peace Mode)' : 'Activate Anomalies (Minigame)'
    );
  }

  const modeBtn = document.getElementById('mode-toggle-btn');
  if (modeBtn) {
    setTT('mode-toggle-btn', 
      typeof isTerminalMode !== 'undefined' && isTerminalMode ? 'Despertar Universo 3D' : 'Cambiar a Archivo Ejecutivo 2D', 
      typeof isTerminalMode !== 'undefined' && isTerminalMode ? 'Awaken 3D Universe' : 'Switch to 2D Executive Archive'
    );
  }
  
  // 3. Herramientas, Armas y Realidad Extendida
  setTT('btn-sword', 'Tajo de Pulso (Tecla Q): Disipa la anomalía o modo creativo activo', 'Pulse Slash (Q Key): Dispels active creative mode or anomaly');
  setTT('ARButton', 'Activar Realidad Aumentada', 'Activate Augmented Reality');
  setTT('VRButton', 'Activar Realidad Virtual', 'Activate Virtual Reality');

  // 4. Opciones del Menú Lateral
  setTT('menu-bloom', 'Alternar filtro de neón', 'Toggle neon filter');
  setTT('menu-align', 'Cambiar distribución del espacio', 'Change space layout');
  setTT('menu-retro', 'Alternar estética retro', 'Toggle retro aesthetics');
}

// Ejecutar el motor al terminar de cargar la página
setTimeout(syncAccessibilityTooltips, 1500);

// Escucha global: Ejecutar automáticamente cada vez que el usuario hace clic en CUALQUIER BOTÓN.
// Esto mantiene los tooltips perfectamente sincronizados si cambias de idioma, pausas o sacas la espada.
window.addEventListener('click', (e) => {
  if (e.target.closest('button') || e.target.closest('a')) {
    setTimeout(syncAccessibilityTooltips, 50); // Retraso de 50ms para dejar que el juego cambie sus variables primero
  }
});
// ============================================================
// 🔥 INTEGRACIÓN DEL NÚCLEO D.A.C. AL MENÚ LATERAL Y RUTEO 2D/3D
// ============================================================
function setupDacMenu() {
  // 1. Inyectar D.A.C. en el menú HTML si no existe
  const menuList = document.querySelector('#side-menu ul');
  if (menuList && !document.querySelector('.menu-item[data-id="99"]')) {
    const dacLi = document.createElement('li');
    dacLi.innerHTML = `<a href="#" class="menu-item" data-id="99" style="color:#e7e4de;">> 99. D.A.C. // MARCO DOCTORAL</a>`;
    
    // Insertarlo justo antes del separador o sección "Acerca de"
    const aboutItem = document.getElementById('menu-about');
    if (aboutItem && aboutItem.parentElement) {
      menuList.insertBefore(dacLi, aboutItem.parentElement);
    } else {
      menuList.appendChild(dacLi);
    }
  }

  // 2. Interceptar el clic en el menú para el proyecto 99
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const projectId = item.getAttribute('data-id');
      if (projectId === '99') {
        e.preventDefault();
        e.stopPropagation();
        const sideMenu = document.getElementById('side-menu');
        if(sideMenu) sideMenu.classList.remove('open');
        showDacChoiceUI(); // Lanzar la decisión 2D/3D
      }
    });
  });
}

// 3. Modal Elegante de Elección D.A.C. (Diseño Pizarra/Hueso/Coral)
function showDacChoiceUI() {
  let ui = document.getElementById('dac-choice-ui');
  if (!ui) {
    ui = document.createElement('div');
    ui.id = 'dac-choice-ui';
    ui.className = 'modal-ui';
    ui.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); z-index:100050; background:rgba(10,10,12,0.92); border:1px solid rgba(255,255,255,0.15); padding:35px 40px; border-radius:2px; text-align:center; color:#e7e4de; font-family:-apple-system, sans-serif; backdrop-filter:blur(15px); -webkit-backdrop-filter:blur(15px); display:flex; flex-direction:column; gap:20px; box-shadow:0 30px 60px rgba(0,0,0,0.8); min-width: 320px;';
    
    ui.innerHTML = `
      <h3 style="margin:0; font-weight:300; letter-spacing:0.2em; font-size:1.15rem; color:#fff; text-transform:uppercase;" id="dac-ch-title">ACCESO D.A.C.</h3>
      <p style="margin:0; font-size:0.75rem; color:#8a867f; letter-spacing:0.08em; text-transform:uppercase;" id="dac-ch-sub">Selecciona la vía de exploración:</p>
      <div style="display:flex; flex-direction:column; gap:12px; margin-top:15px;">
        <button id="btn-dac-2d" style="background:transparent; border:1px solid rgba(255,255,255,0.15); padding:14px; color:#e7e4de; cursor:pointer; font-family:inherit; font-weight:300; letter-spacing:0.12em; transition:0.3s; text-transform:uppercase; font-size:0.72rem;">📄 LEER ARCHIVO EJECUTIVO (2D)</button>
        <button id="btn-dac-3d" style="background:transparent; border:1px solid rgba(255,255,255,0.15); padding:14px; color:#e7e4de; cursor:pointer; font-family:inherit; font-weight:300; letter-spacing:0.12em; transition:0.3s; text-transform:uppercase; font-size:0.72rem;">🌌 VISITAR PLANETA NÚCLEO (3D)</button>
        <button id="btn-dac-close" style="background:transparent; border:none; color:#77746e; margin-top:10px; cursor:pointer; font-family:inherit; text-decoration:underline; font-size:0.7rem; letter-spacing:0.15em; transition:0.3s;">CANCELAR</button>
      </div>
    `;
    document.body.appendChild(ui);

    const b1 = document.getElementById('btn-dac-2d');
    const b2 = document.getElementById('btn-dac-3d');
    const bClose = document.getElementById('btn-dac-close');
    
    b1.onmouseover = () => { b1.style.background = 'rgba(255,255,255,0.06)'; b1.style.borderColor = 'rgba(255,255,255,0.4)'; };
    b1.onmouseout = () => { b1.style.background = 'transparent'; b1.style.borderColor = 'rgba(255,255,255,0.15)'; };
    b2.onmouseover = () => { b2.style.background = 'rgba(255,255,255,0.06)'; b2.style.borderColor = 'rgba(255,255,255,0.4)'; };
    b2.onmouseout = () => { b2.style.background = 'transparent'; b2.style.borderColor = 'rgba(255,255,255,0.15)'; };
    bClose.onmouseover = () => { bClose.style.color = '#e7e4de'; };
    bClose.onmouseout = () => { bClose.style.color = '#77746e'; };

    bClose.onclick = () => {
      ui.style.display = 'none';
      if (typeof playSound === 'function') playSound('ui');
    };

    // OPCIÓN 2D: Abre el Archivo Ejecutivo directo en la página 99
    b1.onclick = () => {
      ui.style.display = 'none';
      if (typeof playSound === 'function') playSound('ui');
      if (typeof isTerminalMode !== 'undefined' && !isTerminalMode) window.toggleTerminalMode();
      setTimeout(() => { if (typeof openProjectFromTerminal === 'function') openProjectFromTerminal(99); }, 150);
    };

    // OPCIÓN 3D: Aísla el planeta D.A.C. y viaja a él directamente
    b2.onclick = () => {
      ui.style.display = 'none';
      if (typeof playSound === 'function') playSound('project_open');
      if (typeof isTerminalMode !== 'undefined' && isTerminalMode) window.toggleTerminalMode();
      
      setTimeout(() => {
        if (typeof planetaDAC !== 'undefined' && planetaDAC) {
          if (!planetaDAC.userData.isIsolated) planetaDAC.userData.savedPos = planetaDAC.position.clone();
          planetaDAC.userData.isIsolated = true;
          
          if (typeof categoryPlanets !== 'undefined') categoryPlanets.forEach(p => p.visible = false);
          if (typeof satelliteGroup !== 'undefined') satelliteGroup.visible = false;
          if (typeof energyWebGroup !== 'undefined') energyWebGroup.visible = false;
          
          planetaDAC.position.set(0, 0, 0);
          if (typeof userGroup !== 'undefined') {
            userGroup.position.set(0, 0, 22);
            userGroup.rotation.set(0, 0, 0);
          }
          
          if (typeof dacNetworkGroup !== 'undefined') dacNetworkGroup.visible = true;
          if (typeof showSystemToast === 'function') showSystemToast('> ESPACIO AISLADO: NÚCLEO DAC', '#ff6644');
        }
      }, 150);
    };
  }
  
  // Soporte bilingüe en tiempo real para el modal
  const en = (typeof window.currentLang !== 'undefined' && window.currentLang === 'en');
  document.getElementById('dac-ch-title').innerText = en ? 'D.A.C. ACCESS' : 'ACCESO D.A.C.';
  document.getElementById('dac-ch-sub').innerText = en ? 'Select exploration path:' : 'Selecciona la vía de exploración:';
  document.getElementById('btn-dac-2d').innerText = en ? '📄 READ EXECUTIVE ARCHIVE (2D)' : '📄 LEER ARCHIVO EJECUTIVO (2D)';
  document.getElementById('btn-dac-3d').innerText = en ? '🌌 VISIT CORE PLANET (3D)' : '🌌 VISITAR PLANETA NÚCLEO (3D)';
  document.getElementById('btn-dac-close').innerText = en ? 'CANCEL' : 'CANCELAR';
  
  ui.style.display = 'flex';
  if (typeof playSound === 'function') playSound('project_open');
}

// Inyectar el menú 1.5 segundos después de cargar la página
setTimeout(setupDacMenu, 1500);
// ============================================================
// 🔥 ATAJO DE DESARROLLADOR: TECLA "H" PARA VER CEREMONIA
// ============================================================
window.addEventListener('keydown', (e) => {
  // 1. Evitamos que se active si estás escribiendo la letra "h" en el formulario de contacto
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  
  // 2. Si presionas H y no estás leyendo el Archivo 2D, lanzamos la ceremonia
  if (e.key === 'h' || e.key === 'H') {
    if (typeof isTerminalMode !== 'undefined' && isTerminalMode) return;
    
    if (typeof runSovereigntyCeremony === 'function') {
      runSovereigntyCeremony();
    }
  }
});
// ============================================================
// 🎮 JUEGOS OTROS — LENGUAJE SUBLIME
//   Paleta apagada (hueso, ceniza, salvia, niebla, ocre, malva), partículas suaves de luz,
//   viñeta y fundidos lentos, y un sonido de campanas de seno con eco (el mismo bus que el resto del portafolio).
// ============================================================
const PAL = { bone: 0xe7e4de, ash: 0x8a867f, rose: 0xc9786b, sage: 0xb9c8b0, mist: 0xa9c4e8, gold: 0xd9c28a, mauve: 0xcfa3c4 };
const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _fxc = new THREE.Color();
const _wp = new THREE.Vector3();

// ---------- Partículas: puntos de luz con caída suave (tamaño y alfa por partícula) ----------
const GLOW_SCALE = { value: 400 };
const GLOW_VS = `
  attribute vec3 aCol; attribute float aSize; attribute float aAlpha;
  uniform float uScale; varying vec3 vC; varying float vA;
  void main() {
    vC = aCol; vA = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const GLOW_FS = `
  uniform vec3 uTint; uniform float uOpacity; varying vec3 vC; varying float vA;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float a = smoothstep(0.5, 0.0, d); a *= a;
    gl_FragColor = vec4(vC * uTint, a * vA * uOpacity);
  }`;

function mkGlowPoints(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uScale: GLOW_SCALE, uTint: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 1 } },
    vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

let _glowTex = null;
function glowTex() {
  if (_glowTex) return _glowTex;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    _glowTex = new THREE.CanvasTexture(c);
  } catch (e) { _glowTex = null; }
  return _glowTex;
}
function mkHalo(hex, size, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: hex, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1);
  return s;
}

// Emisor de motas (ráfagas, estelas, brasas)
function makeFX(cap) {
  const pts = mkGlowPoints(cap);
  const at = pts.geometry.attributes;
  const P = at.position.array, C = at.aCol.array, S = at.aSize.array, A = at.aAlpha.array;
  const V = new Float32Array(cap * 3), L = new Float32Array(cap), ML = new Float32Array(cap).fill(1);
  const A0 = new Float32Array(cap), S0 = new Float32Array(cap), D = new Float32Array(cap);
  let head = 0;
  return {
    pts,
    emit(x, y, z, vx, vy, vz, life, hex, size, alpha, drag) {
      const i = head; head = (head + 1) % cap;
      _fxc.setHex(hex);
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
      V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz;
      C[i * 3] = _fxc.r; C[i * 3 + 1] = _fxc.g; C[i * 3 + 2] = _fxc.b;
      L[i] = life; ML[i] = life; A0[i] = alpha; S0[i] = size; D[i] = (drag === undefined ? 0.8 : drag);
    },
    burst(x, y, z, count, speed, life, hex, size, alpha) {
      for (let k = 0; k < count; k++) {
        const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1), sp = speed * (0.3 + Math.random() * 0.7);
        this.emit(x, y, z, Math.sin(ph) * Math.cos(th) * sp, Math.sin(ph) * Math.sin(th) * sp, Math.cos(ph) * sp * 0.5,
          life * (0.6 + Math.random() * 0.4), hex, size * (0.6 + Math.random() * 0.8), alpha, 1.4);
      }
    },
    update(dt) {
      for (let i = 0; i < cap; i++) {
        if (L[i] <= 0) continue;
        L[i] -= dt;
        if (L[i] <= 0) { A[i] = 0; S[i] = 0; continue; }
        const k = 1 - L[i] / ML[i], f = Math.max(0, 1 - D[i] * dt);
        V[i * 3] *= f; V[i * 3 + 1] *= f; V[i * 3 + 2] *= f;
        P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
        A[i] = A0[i] * Math.min(1, k * 10) * (1 - k);
        S[i] = S0[i] * (1 - 0.4 * k);
      }
      at.position.needsUpdate = true; at.aCol.needsUpdate = true; at.aSize.needsUpdate = true; at.aAlpha.needsUpdate = true;
    },
    dispose() { pts.geometry.dispose(); pts.material.dispose(); }
  };
}

// Polvo a la deriva: el fondo "respira"
function makeDust(n, hw, hh) {
  const pts = mkGlowPoints(n);
  const at = pts.geometry.attributes;
  const P = at.position.array, C = at.aCol.array, S = at.aSize.array;
  const base = new Float32Array(n * 3), ph = new Float32Array(n * 2);
  const cols = [PAL.bone, PAL.ash, PAL.sage, PAL.mist];
  for (let i = 0; i < n; i++) {
    base[i * 3] = (Math.random() * 2 - 1) * hw; base[i * 3 + 1] = (Math.random() * 2 - 1) * hh; base[i * 3 + 2] = -5 + Math.random() * 8;
    ph[i * 2] = Math.random() * 6.28; ph[i * 2 + 1] = Math.random() * 6.28;
    _fxc.setHex(cols[Math.floor(Math.random() * cols.length)]);
    C[i * 3] = _fxc.r; C[i * 3 + 1] = _fxc.g; C[i * 3 + 2] = _fxc.b;
    S[i] = 0.10 + Math.random() * 0.26;
  }
  return {
    pts,
    update(t, calm) {
      const A = at.aAlpha.array, amp = calm ? 0.15 : 1;
      for (let i = 0; i < n; i++) {
        P[i * 3]     = base[i * 3]     + Math.sin(t * 0.11 + ph[i * 2]) * 0.8 * amp;
        P[i * 3 + 1] = base[i * 3 + 1] + Math.cos(t * 0.09 + ph[i * 2 + 1]) * 0.6 * amp;
        P[i * 3 + 2] = base[i * 3 + 2];
        A[i] = 0.10 + 0.22 * (0.5 + 0.5 * Math.sin(t * 0.45 + ph[i * 2] * 3));
      }
      at.position.needsUpdate = true; at.aAlpha.needsUpdate = true;
    },
    dispose() { pts.geometry.dispose(); pts.material.dispose(); }
  };
}

// ---------- Sonido: campanas de seno + pads, por el mismo bus con eco del resto del portafolio ----------
const MGS = {
  NOTES: [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5],        // pentatónica de Do: nada puede sonar "mal"
  ok() {
    if (!isSoundEnabled) return false;
    try { if (!audioCtx) playSound('ui'); } catch (e) {}
    return !!(audioCtx && masterGain);
  },
  bell(freq, delay, dur, vol) {
    if (!this.ok()) return;
    const now = audioCtx.currentTime + (delay || 0);
    [[1, 1], [2.01, 0.28], [3.0, 0.1]].forEach(([m, g]) => {
      const o = audioCtx.createOscillator(), gn = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = freq * m;
      gn.gain.setValueAtTime(0, now);
      gn.gain.linearRampToValueAtTime(vol * g, now + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, now + dur / m);
      o.connect(gn); gn.connect(masterGain);
      o.start(now); o.stop(now + dur + 0.05);
    });
  },
  arpeggio(idx, step, dur, vol) { idx.forEach((n, i) => this.bell(this.NOTES[n], i * step, dur, vol)); },
  knock() {                                                         // un golpe amortiguado, no un impacto eléctrico
    if (!this.ok()) return;
    const now = audioCtx.currentTime, o = audioCtx.createOscillator(), gn = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, now); o.frequency.exponentialRampToValueAtTime(62, now + 0.4);
    gn.gain.setValueAtTime(0, now); gn.gain.linearRampToValueAtTime(0.11, now + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    o.connect(gn); gn.connect(masterGain); o.start(now); o.stop(now + 0.6);
    this.bell(466.16, 0.02, 0.9, 0.012);                            // sombra levemente disonante
    vibrateDevice(35);
  }
};

// ============================================================
// 🎮 INFRAESTRUCTURA COMPARTIDA
//   · Guarda y restaura EXACTAMENTE el estado del universo (visibilidad, cámara, rotación, zoom)
//   · Botón ABORTAR + tecla ESC
//   · Fundido de entrada con viñeta, polvo a la deriva, ondas y ráfagas de motas
// ============================================================
const MG = window.MG = {
  saved: null, ui: null, keyHandler: null, lastT: 0, time: 0,
  fx: null, dust: null, rings: [], plane: null,

  isEN() { return window.currentLang === 'en'; },
  isTouch() { return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0); },
  tick() {
    const n = performance.now();
    const d = this.lastT ? Math.min(0.05, (n - this.lastT) / 1000) : 0.016;
    this.lastT = n;
    return d;
  },
  setPointer(cx, cy) {
    mouseNDC.x = (cx / window.innerWidth) * 2 - 1;
    mouseNDC.y = -(cy / window.innerHeight) * 2 + 1;
  },
  pointerWorld(out) {
    dragRaycaster.setFromCamera(mouseNDC, camera);
    return dragRaycaster.ray.intersectPlane(this.plane, out);
  },

  _targets() {
    const t = [];
    if (typeof satelliteGroup !== 'undefined') t.push(satelliteGroup);
    if (typeof energyWebGroup !== 'undefined') t.push(energyWebGroup);
    if (typeof particlesMesh !== 'undefined') t.push(particlesMesh);
    if (typeof planetaDAC !== 'undefined') t.push(planetaDAC);
    if (typeof dacHitboxPlanet !== 'undefined') t.push(dacHitboxPlanet);
    if (typeof ship !== 'undefined') t.push(ship);
    if (window.travelerGroup) t.push(window.travelerGroup);
    [typeof ambientWhales !== 'undefined' ? ambientWhales : null,
     typeof guardianCats !== 'undefined' ? guardianCats : null,
     typeof discoveredVoyagers !== 'undefined' ? discoveredVoyagers : null,
     typeof asteroids !== 'undefined' ? asteroids : null].forEach(arr => { if (Array.isArray(arr)) arr.forEach(o => t.push(o)); });
    categoryPlanets.forEach(p => t.push(p));
    return t;
  },

  enter(camZ) {
    this.lastT = 0; this.time = 0;
    if (!this.plane) this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const objs = this._targets();
    this.saved = {
      objs: objs.map(o => [o, o.visible]),
      pos: userGroup.position.clone(), rot: userGroup.rotation.clone(),
      fov: camera.fov, targetFov: targetFov, zoomed: isMobileZoomed,
      hud: ['lives-value', 'level-value', 'files-value', 'combo-value'].reduce((o, id) => { const el = document.getElementById(id); o[id] = el ? el.innerText : ''; return o; }, {})
    };
    objs.forEach(o => { o.visible = false; });
    userGroup.rotation.set(0, 0, 0);          // la vista podía estar girada: los juegos asumen cámara de frente
    userGroup.position.set(0, 0, camZ);
    targetFov = 75; camera.fov = 75; camera.updateProjectionMatrix();
    isMobileZoomed = false;

    // Atmósfera: polvo + motas + ondas
    const halfH = Math.tan(THREE.MathUtils.degToRad(75 / 2)) * camZ, aspect = window.innerWidth / window.innerHeight;
    this.fx = makeFX(520); scene.add(this.fx.pts);
    this.dust = makeDust(110, halfH * aspect * 1.15, halfH * 1.15); scene.add(this.dust.pts);
    this.rings = [];
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.96, 1, 72),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      mesh.visible = false; scene.add(mesh);
      this.rings.push({ mesh, age: 1, life: 1, s0: 1, s1: 1, op: 0 });
    }
  },

  pulse(x, y, hex, s0, s1, life, op, groundZ) {       // onda circular; si s0 > s1 converge. Con groundZ, yace sobre el suelo (vista isométrica)
    const r = this.rings.find(q => q.age >= 1) || this.rings[0];
    r.age = 0; r.life = life; r.s0 = s0; r.s1 = s1; r.op = op;
    if (groundZ !== undefined) { r.mesh.rotation.set(-Math.PI / 2, 0, 0); r.mesh.position.set(x, y, groundZ); }
    else { r.mesh.rotation.set(0, 0, 0); r.mesh.position.set(x, y, 0); }
    r.mesh.material.color.setHex(hex); r.mesh.visible = true;
  },

  fxUpdate(dt) {
    this.time += dt;
    GLOW_SCALE.value = renderer.domElement.height * 0.5 * Math.tan(THREE.MathUtils.degToRad(37.5)) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));   // el tamaño en mundo no depende del FOV
    if (this.fx) this.fx.update(dt);
    if (this.dust) this.dust.update(this.time, reduceMotionMQ.matches);
    this.rings.forEach(r => {
      if (r.age >= 1) return;
      r.age += dt / r.life;
      if (r.age >= 1) { r.mesh.visible = false; return; }
      const e = 1 - Math.pow(1 - r.age, 2);
      r.mesh.scale.setScalar(r.s0 + (r.s1 - r.s0) * e);
      r.mesh.material.opacity = r.op * Math.sin(Math.PI * r.age);
    });
  },

  exit() {
    const s = this.saved; if (!s) return;
    s.objs.forEach(([o, v]) => { o.visible = v; });
    userGroup.position.copy(s.pos); userGroup.rotation.copy(s.rot);
    camera.fov = s.fov; targetFov = s.targetFov; camera.updateProjectionMatrix();
    isMobileZoomed = s.zoomed;
    for (const id in s.hud) { const el = document.getElementById(id); if (el) el.innerText = s.hud[id]; }   // devuelve los valores reales del HUD
    this.saved = null;
    if (this.fx) { scene.remove(this.fx.pts); this.fx.dispose(); this.fx = null; }
    if (this.dust) { scene.remove(this.dust.pts); this.dust.dispose(); this.dust = null; }
    this.rings.forEach(r => { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); });
    this.rings = [];
    this.removeUI();
    morphHUD('normal');
    shakeIntensity = 0;
  },

  buildUI(hintText) {
    this.removeUI();
    const en = this.isEN();
    const root = document.createElement('div');
    root.id = 'minigame-ui';
    root.style.cssText = 'position:fixed; inset:0; z-index:100020; pointer-events:none; color:#e7e4de; opacity:0; transition:opacity 1.4s ease; ' +
      'font-family:-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif; ' +
      'background:radial-gradient(ellipse at center, rgba(5,5,10,0) 45%, rgba(5,5,10,0.45) 100%);';

    const extra = document.createElement('div');
    extra.style.cssText = 'position:absolute; top:78px; left:50%; transform:translateX(-50%); text-align:center; width:min(92vw,520px);';

    const bottom = document.createElement('div');
    bottom.style.cssText = 'position:absolute; bottom:calc(22px + env(safe-area-inset-bottom,0px)); left:50%; transform:translateX(-50%); display:flex; flex-direction:column; align-items:center; gap:14px; width:min(92vw,560px);';

    const hint = document.createElement('div');
    hint.textContent = hintText;
    hint.style.cssText = 'font-size:0.74rem; font-weight:300; letter-spacing:0.05em; line-height:1.7; text-align:center; color:#8a867f; text-shadow:0 0 14px rgba(0,0,0,0.9);';

    const btn = document.createElement('button');
    btn.textContent = en ? 'LET GO  ·  ESC' : 'SOLTAR  ·  ESC';
    btn.style.cssText = 'pointer-events:auto; background:rgba(10,10,12,0.35); border:1px solid rgba(255,255,255,0.14); color:#a8a49c; padding:9px 20px; font-family:inherit; font-size:0.66rem; font-weight:300; letter-spacing:0.28em; cursor:pointer; border-radius:0; backdrop-filter:blur(10px); transition:color .3s, border-color .3s;';
    btn.addEventListener('mouseenter', () => { btn.style.color = '#e7e4de'; btn.style.borderColor = 'rgba(255,255,255,0.35)'; });
    btn.addEventListener('mouseleave', () => { btn.style.color = '#a8a49c'; btn.style.borderColor = 'rgba(255,255,255,0.14)'; });
    btn.addEventListener('click', (e) => { e.stopPropagation(); MG.abort(); });
    ['mousedown', 'touchstart', 'mouseup', 'touchend'].forEach(ev => btn.addEventListener(ev, (e) => e.stopPropagation()));

    bottom.appendChild(hint); bottom.appendChild(btn);
    root.appendChild(extra); root.appendChild(bottom);
    document.body.appendChild(root);
    requestAnimationFrame(() => { root.style.opacity = '1'; });
    this.ui = { root, extra, hint };

    this.keyHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); MG.abort(); }
    };
    window.addEventListener('keydown', this.keyHandler, true);
    return this.ui;
  },

  removeUI() {
    if (this.ui && this.ui.root.parentNode) this.ui.root.parentNode.removeChild(this.ui.root);
    this.ui = null;
    if (this.keyHandler) { window.removeEventListener('keydown', this.keyHandler, true); this.keyHandler = null; }
  },

  abort() {
    if (window.isTuningGameActive) window.abortTuningGame();
    else if (window.isWiringGameActive) window.abortWiringGame();
    else if (window.isHogueraActive) window.abortHogueraGame();
  },

  setHUD(ids) {
    for (const id in ids) { const el = document.getElementById(id); if (el) el.innerText = ids[id]; }
  }
};

window.updateMiniGames = function() {
  const dt = MG.tick();
  MG.fxUpdate(dt);
  if (window.isTuningGameActive) tgUpdate(dt);
  if (window.isWiringGameActive) wgUpdate(dt);
  if (window.isHogueraActive) hgUpdate(dt);
};

// ============================================================
// 📜 REFLEXIÓN TEÓRICA: el marco D.A.C. detrás de cada Juego Otro
//   Un velo oscuro con texto fino abre y cierra cada juego. El universo sigue visible detrás.
//   Se cierra con clic / toque / Enter / Espacio. Al abrir, ESC cancela y vuelve al universo.
// ============================================================
const REFL = {
  tuning: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  MÁQUINA ERRÁTICA', t: 'Sintonía',
        p: ['El glitch no es un fallo: es el tartamudeo de la materia técnica, que deja ver la arquitectura interna del silicio.',
            'Aquí no se corrige el error. Se aprende a escuchar dónde se aquieta: sintonizar es acoplamiento estructural, y quien busca la señal cambia con ella.'] },
      outro: { k: 'MÁQUINA ERRÁTICA', t: 'Errar como método',
        p: ['Lo que parecía un archivo corrupto era una forma de conocimiento que solo aparece al errar.',
            'La inferencia abductiva empieza donde la herramienta deja de obedecer.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  ERRATIC MACHINE', t: 'Attunement',
        p: ['The glitch is not a failure: it is the stammering of technical matter, revealing the inner architecture of silicon.',
            'Here the error is not corrected. You learn to listen for where it settles: tuning is structural coupling, and whoever seeks the signal changes with it.'] },
      outro: { k: 'ERRATIC MACHINE', t: 'Erring as method',
        p: ['What looked like a corrupted file was a form of knowledge that only appears by erring.',
            'Abductive inference begins where the tool stops obeying.'] }
    }
  },
  wiring: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  TELAR Y QUIPU', t: 'Tejer es pensar',
        p: ['El telar es una tecnología para producir relaciones, patrones, memoria y conocimiento: cada cruce de hilos pone en relación lo que estaba separado, y la repetición con variación hace patrón.',
            'Dos fases, inspiradas en los tejidos jalq\'a —seres simétricos, rojos y negros, que narran la creación de mundos— y en el quipu, donde el nudo guarda la memoria y se lee con las manos.'] },
      outro: { k: 'MÁQUINA DE FRICCIÓN  ·  SABER-DEL-CUERPO', t: 'Memoria hecha de hilo',
        p: ['Tejer fue una de las primeras formas de programar —las tarjetas perforadas del telar de Jacquard son ancestro del computador— y mucho antes el quipu ya guardaba datos en nudos.',
            'Un patrón no es adorno: es conocimiento que un cuerpo escribe y otro cuerpo puede leer.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  LOOM AND QUIPU', t: 'Weaving is thinking',
        p: ['The loom is a technology for producing relations, patterns, memory and knowledge: every crossing of threads relates what was separate, and repetition with variation makes a pattern.',
            'Two phases, inspired by jalq\'a textiles —symmetrical red and black beings that tell of the creation of worlds— and by the quipu, where the knot keeps memory and is read with the hands.'] },
      outro: { k: 'FRICTION MACHINE  ·  KNOWING-OF-THE-BODY', t: 'Memory made of thread',
        p: ['Weaving was one of the first forms of programming —the punched cards of the Jacquard loom are ancestors of the computer— and long before, the quipu already kept data in knots.',
            'A pattern is not decoration: it is knowledge that one body writes and another body can read.'] }
    }
  },
  hoguera: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  SUFICIENCIA Y RENUNCIA', t: 'La hoguera de datos',
        p: ['Frente a la caja negra del progreso —la máquina que nunca dice basta— el diseño de suficiencia propone lo contrario: decidir qué merece arder.',
            'Renunciar no es perder. Es recuperar la capacidad de auditar y subvertir reglas opacas: un fuego pequeño, un viajero y un monumento de pantallas obsoletas.'] },
      outro: { k: 'ANA-ARQUEOLOGÍA  ·  SUFICIENCIA', t: 'Lo suficiente',
        p: ['Lo que quemaste no vuelve. Lo que escuchaste, sí.',
            'La ana-arqueología no excava para acumular: escucha lo que la ruina todavía tiene que decir.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  SUFFICIENCY AND RENUNCIATION', t: 'The data bonfire',
        p: ['Against the black box of progress —the machine that never says enough— sufficiency design proposes the opposite: deciding what deserves to burn.',
            'To renounce is not to lose. It is to recover the capacity to audit and subvert opaque rules: a small fire, a traveler and a monument of obsolete screens.'] },
      outro: { k: 'AN-ARCHAEOLOGY  ·  SUFFICIENCY', t: 'Enough',
        p: ['What you burned does not return. What you listened to, does.',
            'An-archaeology does not dig to accumulate: it listens to what the ruin still has to say.'] }
    }
  }
};

MG.text = function(game, which) { return REFL[game][this.isEN() ? 'en' : 'es'][which]; };
MG.pending = false;
window.isMiniIntro = false;

MG.reflect = function(R, onDone, opts) {
  opts = opts || {};
  const en = this.isEN();
  window.isMiniIntro = true;

  const veil = document.createElement('div');
  veil.id = 'minigame-reflect';
  veil.style.cssText = 'position:fixed; inset:0; z-index:100040; display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box; ' +
    'opacity:0; transition:opacity 1.4s ease; cursor:pointer; user-select:none; -webkit-user-select:none; color:#e7e4de; ' +
    'font-family:-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif; ' +
    'background:radial-gradient(ellipse at center, rgba(8,8,12,0.80), rgba(3,3,6,0.93)); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);';
  const col = document.createElement('div');
  col.style.cssText = 'max-width:min(88vw,620px); text-align:center;';

  const mkLine = (css, text, i) => {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText = css + `opacity:0; transform:translateY(8px); transition:opacity 1.6s ease ${0.3 + i * 0.55}s, transform 1.6s ease ${0.3 + i * 0.55}s;`;
    col.appendChild(d); return d;
  };
  const lines = [];
  lines.push(mkLine('font-size:0.66rem; font-weight:300; letter-spacing:0.42em; color:#8a867f; margin-bottom:22px;', R.k, 0));
  lines.push(mkLine('font-size:1.7rem; font-weight:200; letter-spacing:0.18em; margin-bottom:26px; text-shadow:0 0 24px rgba(231,228,222,0.18);', R.t, 1));
  const rule = mkLine('width:44px; height:1px; background:rgba(231,228,222,0.35); margin:0 auto 26px;', '', 2); lines.push(rule);
  R.p.forEach((txt, i) => lines.push(mkLine('font-size:0.95rem; font-weight:300; line-height:2; letter-spacing:0.04em; color:#cfd0d4; margin-bottom:16px;', txt, 3 + i)));
  const prompt = document.createElement('div');
  prompt.textContent = opts.cancelable
    ? (en ? 'TAP TO ENTER   ·   ESC TO RETURN' : 'TOCA PARA ENTRAR   ·   ESC PARA VOLVER')
    : (en ? 'TAP TO CONTINUE' : 'TOCA PARA CONTINUAR');
  prompt.style.cssText = 'margin-top:34px; font-size:0.62rem; font-weight:300; letter-spacing:0.36em; color:#8a867f; opacity:0; transition:opacity 1.4s ease;';
  col.appendChild(prompt);
  veil.appendChild(col);
  document.body.appendChild(veil);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    veil.style.opacity = '1';
    lines.forEach(l => { l.style.opacity = '1'; l.style.transform = 'translateY(0)'; });
  }));

  let ready = false, closed = false, keyH = null;
  setTimeout(() => { ready = true; prompt.style.opacity = '1'; }, 2200);       // evita cerrarlo con el mismo clic que lo abrió

  const close = (accept, force) => {
    if (closed || (!ready && !force)) return;
    closed = true;
    window.isMiniIntro = false;
    if (keyH) window.removeEventListener('keydown', keyH, true);
    veil.style.pointerEvents = 'none'; veil.style.opacity = '0';
    setTimeout(() => { if (veil.parentNode) veil.parentNode.removeChild(veil); }, 1500);
    if (accept) { if (onDone) onDone(); } else if (opts.onCancel) opts.onCancel();
  };

  ['mousedown', 'mouseup', 'touchstart', 'pointerdown', 'pointerup', 'contextmenu'].forEach(ev => veil.addEventListener(ev, (e) => e.stopPropagation()));
  veil.addEventListener('touchend', (e) => { e.stopPropagation(); close(true); });
  veil.addEventListener('click', (e) => { e.stopPropagation(); close(true); });
  veil.addEventListener('wheel', (e) => { e.stopPropagation(); e.preventDefault(); }, { passive: false });

  keyH = (e) => {
    e.stopImmediatePropagation();                                              // ninguna otra tecla (p. ej. espacio = disparo) pasa mientras se lee
    if (e.key === 'Escape') { e.preventDefault(); if (opts.cancelable) close(false, true); else close(true); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(true); }
  };
  window.addEventListener('keydown', keyH, true);
};


function mgDispose(o) {
  scene.remove(o);
  o.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) { if (c.material.map && c.material.map !== _glowTex) c.material.map.dispose(); c.material.dispose(); }
  });
}

// ==========================================
// 🌫 JUEGO OTRO: SINTONIZACIÓN (ANOMALÍA 999 · ARCHIVO CORRUPTO)
//   Una señal se deshace en el ruido. Tres fases: busca dónde se aquieta y sostén el gesto.
//   Fuera de sintonía: ruido, polvo disperso, ondas que se alejan y dos tonos que "baten".
//   En sintonía: los tonos se funden en unísono y quinta, el polvo se reúne y las ondas regresan al centro.
// ==========================================
window.isTuningGameActive = false;
let tuningData = null;
const TG = {
  stage: 0, stages: 3, tx: 0, ty: 0, hold: 0, res: 0, finale: 0, rt: 0, trailT: 0, uiT: 0,
  group: null, debris: null, halo: null, dirs: null, radii: null, phase: null,
  tone: null, msg: '', els: {}
};
const TG_GLYPHS = '·∙░▒▓+×∴';

function tgPickTarget() {
  const aspect = window.innerWidth / window.innerHeight;
  let x = 0, y = 0, tries = 0;
  do {
    x = Math.random() * 1.5 - 0.75;
    y = Math.random() * 1.3 - 0.65;
    tries++;
  } while (tries < 25 && Math.hypot((x - TG.tx) * aspect, y - TG.ty) < 0.7);
  TG.tx = x; TG.ty = y;
}

// Drone: dos voces casi iguales (el batido se calma al sintonizar) + quinta y octava que florecen + hiss que se apaga
function tgToneStart() {
  if (!MGS.ok()) return;
  try {
    const ctx = audioCtx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(1, t + 2.0);
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 300; filt.Q.value = 0.5;
    filt.connect(out); out.connect(masterGain);
    const mk = (f, g) => {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; gn.gain.value = g;
      o.connect(gn); gn.connect(filt); o.start();
      return { o, gn };
    };
    const a = mk(196, 0.035), b = mk(196 * 1.03, 0.035), c = mk(294, 0), d = mk(392, 0);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.value = 0;
    src.connect(bp); bp.connect(ng); ng.connect(out); src.start();
    TG.tone = { ctx, out, filt, a, b, c, d, src, ng };
  } catch (e) { TG.tone = null; }
}
function tgToneUpdate(r) {
  const T = TG.tone; if (!T) return;
  try {
    const t = T.ctx.currentTime;
    T.b.o.frequency.setTargetAtTime(196 * (1 + (1 - r) * 0.03), t, 0.1);
    T.c.gn.gain.setTargetAtTime(r * 0.035, t, 0.15);
    T.d.gn.gain.setTargetAtTime(r * r * 0.022, t, 0.15);
    T.filt.frequency.setTargetAtTime(280 + r * 2400, t, 0.15);
    T.ng.gain.setTargetAtTime((1 - r) * 0.010, t, 0.1);
    if (!isSoundEnabled) T.out.gain.setTargetAtTime(0, t, 0.1);
  } catch (e) {}
}
function tgToneStop() {
  const T = TG.tone; if (!T) return;
  TG.tone = null;
  try {
    const t = T.ctx.currentTime;
    T.out.gain.cancelScheduledValues(t);
    T.out.gain.setTargetAtTime(0, t, 0.3);
    [T.a, T.b, T.c, T.d].forEach(v => v.o.stop(t + 1.8)); T.src.stop(t + 1.8);
  } catch (e) {}
}

function tgBuildScene() {
  TG.group = new THREE.Group();
  scene.add(TG.group);

  const N = 160;
  TG.dirs = new Float32Array(N * 3); TG.radii = new Float32Array(N); TG.phase = new Float32Array(N);
  TG.debris = mkGlowPoints(N);
  const at = TG.debris.geometry.attributes;
  for (let i = 0; i < N; i++) {
    const th = Math.random() * Math.PI * 2, z = Math.random() * 2 - 1, s = Math.sqrt(1 - z * z);
    TG.dirs[i * 3] = s * Math.cos(th); TG.dirs[i * 3 + 1] = s * Math.sin(th); TG.dirs[i * 3 + 2] = z;
    TG.radii[i] = 4.5 + Math.random() * 6;
    TG.phase[i] = Math.random() * Math.PI * 2;
    _fxc.setHex(Math.random() > 0.5 ? PAL.bone : PAL.mist);
    at.aCol.array[i * 3] = _fxc.r; at.aCol.array[i * 3 + 1] = _fxc.g; at.aCol.array[i * 3 + 2] = _fxc.b;
    at.aSize.array[i] = 0.12 + Math.random() * 0.2;
  }
  TG.group.add(TG.debris);

  TG.halo = mkHalo(PAL.rose, 9, 0.15);
  TG.halo.position.z = -1;
  TG.group.add(TG.halo);
}

function tgBuildUI() {
  const en = MG.isEN();
  const ui = MG.buildUI(en
    ? 'Move your cursor or finger slowly. When the signal settles, hold still.'
    : 'Mueve el cursor o el dedo despacio. Cuando la señal se aquiete, sostén el gesto.');

  const msg = document.createElement('div');
  msg.style.cssText = 'font-size:1rem; font-weight:300; letter-spacing:0.32em; text-shadow:0 0 18px rgba(231,228,222,0.25);';
  const done = document.createElement('span'); done.style.color = '#e7e4de';
  const rest = document.createElement('span'); rest.style.cssText = 'color:#8a867f; opacity:0.6;';
  msg.appendChild(done); msg.appendChild(rest);
  const info = document.createElement('div');
  info.style.cssText = 'margin-top:10px; font-size:0.66rem; font-weight:300; letter-spacing:0.3em; color:#8a867f;';
  ui.extra.appendChild(msg); ui.extra.appendChild(info);

  // Retícula fina con anillo de progreso
  const ret = document.createElement('div');
  ret.style.cssText = 'position:absolute; left:0; top:0; width:30px; height:30px; border-radius:50%; border:1px solid rgba(231,228,222,0.4); box-sizing:border-box; display:none; will-change:transform;';
  const prog = document.createElement('div');
  prog.style.cssText = 'position:absolute; inset:-5px; border-radius:50%; -webkit-mask:radial-gradient(circle, transparent 18px, #000 19px); mask:radial-gradient(circle, transparent 18px, #000 19px);';
  const dot = document.createElement('div');
  dot.style.cssText = 'position:absolute; left:50%; top:50%; width:3px; height:3px; margin:-1.5px 0 0 -1.5px; border-radius:50%; background:#e7e4de;';
  ret.appendChild(prog); ret.appendChild(dot);
  ui.root.appendChild(ret);

  TG.els = { done, rest, info, ret, prog, dot };
}

function tgStart(data) {
  if (window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive) return;
  const en = MG.isEN();
  window.isTuningGameActive = true;
  tuningData = data;
  TG.stage = 0; TG.hold = 0; TG.res = 0; TG.uiT = 0; TG.rt = 0; TG.trailT = 0; TG.finale = 0; TG.tx = 0; TG.ty = 0;
  TG.msg = en ? 'CORRUPTED_FILE.dat' : 'ARCHIVO_CORRUPTO.dat';

  MG.enter(12);

  secretPlanet.userData.isIsolated = true;
  secretPlanet.userData.savedPos = secretPlanet.position.clone();
  secretPlanet.visible = true;
  secretPlanet.position.set(0, 0, 0);
  secretPlanet.scale.set(1, 1, 1);
  if (secretPlanet.children.length > 0) secretPlanet.children[0].visible = false;

  tgPickTarget();
  tgBuildScene();
  tgBuildUI();
  tgToneStart();

  morphHUD('sintonizar');
  showSystemToast(en ? 'A signal dissolves into noise. Listen for where it settles.'
                     : 'Una señal se deshace en el ruido. Escucha dónde se aquieta.', '#e7e4de');
}
window.startTuningGame = function(data) {
  if (MG.pending || window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive) return;
  MG.pending = true;
  MG.reflect(MG.text('tuning', 'intro'), () => { MG.pending = false; tgStart(data); }, { cancelable: true, onCancel: () => { MG.pending = false; } });
};

function tgAdvance() {
  const en = MG.isEN();
  TG.stage++; TG.hold = 0;
  MG.fx.burst(0, 0, 0, 70, 4, 2.2, PAL.mist, 0.26, 0.8);
  MG.pulse(0, 0, PAL.bone, 2.8, 12, 1.8, 0.4);
  if (TG.stage >= TG.stages) { tgStartFinale(); return; }
  MGS.arpeggio([TG.stage - 1, TG.stage + 1], 0.16, 2.2, 0.05);
  shakeIntensity = 0.2;
  showSystemToast(en ? 'Something settles. Another frequency breathes further away.'
                     : 'Algo se aquieta. Otra frecuencia respira más lejos.', '#e7e4de');
  tgPickTarget();
  TG.res = 0;
}

function tgStartFinale() {
  TG.finale = 1.8;
  MG.fx.burst(0, 0, 0, 150, 5.5, 3.0, PAL.bone, 0.3, 0.9);
  MG.pulse(0, 0, PAL.mist, 2.8, 20, 2.2, 0.4);
  playSound('levelup');
  MGS.arpeggio([0, 2, 3, 5], 0.2, 2.6, 0.045);
  tgToneStop();
  if (TG.els.done) { TG.els.done.textContent = TG.msg; TG.els.rest.textContent = ''; }
  if (TG.els.ret) TG.els.ret.style.display = 'none';
}

function tgUpdate(dt) {
  const en = MG.isEN();
  const calm = reduceMotionMQ.matches;
  const E = TG.els;
  const t = MG.time;

  // ----- Final: la señal queda limpia -----
  if (TG.finale > 0) {
    TG.finale -= dt;
    const k = 1 - Math.max(0, TG.finale) / 1.8;
    secretPlanet.position.set(0, 0, 0);
    secretPlanet.material.wireframe = false;
    secretPlanet.material.color.setHex(PAL.bone).multiplyScalar(1 + k * 0.8);
    secretPlanet.rotation.y += dt * 0.35;
    TG.halo.material.opacity = 0.5 + 0.4 * k;
    TG.halo.scale.set(10 + k * 8, 10 + k * 8, 1);
    TG.halo.material.color.setHex(PAL.mist);
    TG.debris.material.uniforms.uOpacity.value = 1 - k;
    if (TG.finale <= 0) window.endTuningGame();
    return;
  }

  const aspect = window.innerWidth / window.innerHeight;
  const hasPointer = mouseNDC.x > -1.5;
  const d = hasPointer ? Math.hypot((mouseNDC.x - TG.tx) * aspect, mouseNDC.y - TG.ty) : 9;
  const lockR = MG.isTouch() ? 0.24 : 0.16;
  const target = Math.pow(Math.max(0, 1 - Math.max(0, d - lockR) / 1.0), 2);
  const locked = d <= lockR;

  TG.res += (target - TG.res) * Math.min(1, dt * 10);
  const r = TG.res;

  if (locked) TG.hold = Math.min(1, TG.hold + dt / 1.2);
  else TG.hold = Math.max(0, TG.hold - dt * 1.5);

  _c1.setHex(PAL.rose); _c2.setHex(PAL.mist);
  _c1.lerp(_c2, r);                                   // rosa apagado → niebla clara
  const hexNow = _c1.getHex();

  // --- Planeta: respira en vez de temblar ---
  if (r < 0.85) {
    const wob = (1 - r) * 0.28 * (calm ? 0.2 : 1);
    secretPlanet.position.set(Math.sin(t * 7.3) * wob + (Math.random() - 0.5) * wob * 0.5,
                              Math.cos(t * 6.1) * wob + (Math.random() - 0.5) * wob * 0.5, 0);
    secretPlanet.material.wireframe = true;
    secretPlanet.material.color.copy(_c1);
    if (!calm && Math.random() < 0.015 * (1 - r)) {   // un parpadeo ocasional de ceniza
      secretPlanet.material.color.setHex(PAL.ash);
      if (r < 0.4 && Math.random() > 0.7 && typeof triggerSubtleGlitch === 'function') triggerSubtleGlitch();
    }
  } else {
    secretPlanet.position.set(0, 0, 0);
    secretPlanet.material.wireframe = false;
    secretPlanet.material.color.copy(_c1).multiplyScalar(1 + TG.hold * 0.8);
  }
  secretPlanet.rotation.x += dt * (0.35 + (1 - r) * 1.2);
  secretPlanet.rotation.y += dt * (0.5 + (1 - r) * 1.2);

  // --- Halo ---
  TG.halo.material.color.copy(_c1);
  TG.halo.material.opacity = 0.12 + r * 0.33 + TG.hold * 0.25;
  const hs = 8 + r * 2 + Math.sin(t * 1.6) * 0.3;
  TG.halo.scale.set(hs, hs, 1);

  // --- Polvo de señal: se reúne en órbita al sintonizar ---
  const at = TG.debris.geometry.attributes, pos = at.position.array, al = at.aAlpha.array;
  const tight = r * r, wob2 = (1 - r) * (calm ? 0.2 : 0.9), n = TG.radii.length;
  for (let i = 0; i < n; i++) {
    const rad = THREE.MathUtils.lerp(TG.radii[i], 2.9 + 0.25 * Math.sin(t * 2 + TG.phase[i]), tight);
    pos[i * 3]     = TG.dirs[i * 3]     * rad + Math.sin(t * 3 + TG.phase[i] * 5) * wob2;
    pos[i * 3 + 1] = TG.dirs[i * 3 + 1] * rad + Math.cos(t * 2.4 + TG.phase[i] * 3) * wob2;
    pos[i * 3 + 2] = TG.dirs[i * 3 + 2] * rad;
    al[i] = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.6 + TG.phase[i] * 3)) + r * 0.3;
  }
  at.position.needsUpdate = true; at.aAlpha.needsUpdate = true;
  TG.debris.rotation.y += dt * (0.15 + r * 0.6);
  TG.debris.rotation.x += dt * 0.08;
  TG.debris.material.uniforms.uTint.value.copy(_c1);

  // --- Ondas: se alejan si hay ruido, regresan al centro si hay sintonía ---
  TG.rt += dt * (0.45 + r * 1.1) * (calm ? 0.5 : 1);
  if (TG.rt >= 1) {
    TG.rt = 0;
    const inward = r > 0.55;
    MG.pulse(0, 0, hexNow, inward ? 9 : 2.8, inward ? 2.8 : 9, 2.4, 0.16 + 0.3 * r);
  }

  // --- Estela de motas tras el cursor ---
  TG.trailT -= dt;
  if (hasPointer && !calm && TG.trailT <= 0 && MG.pointerWorld(_wp)) {
    TG.trailT = 0.025;
    MG.fx.emit(_wp.x, _wp.y, 0, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5 + 0.15, 0, 1.1, hexNow, 0.2, 0.5, 1.2);
  }

  // --- Sonido ---
  tgToneUpdate(r);

  // --- Retícula ---
  if (E.ret) {
    if (hasPointer) {
      const px = (mouseNDC.x + 1) / 2 * window.innerWidth, py = (1 - mouseNDC.y) / 2 * window.innerHeight;
      const col = `rgb(${Math.round(_c1.r * 255)},${Math.round(_c1.g * 255)},${Math.round(_c1.b * 255)})`;
      E.ret.style.display = 'block';
      E.ret.style.transform = `translate(${px - 15}px, ${py - 15}px)`;
      E.ret.style.borderColor = col; E.dot.style.background = col;
      E.prog.style.background = `conic-gradient(${col} ${TG.hold * 360}deg, rgba(231,228,222,0.07) 0)`;
    } else E.ret.style.display = 'none';
  }

  // --- Texto que se descifra + HUD ---
  TG.uiT += dt;
  if (TG.uiT > 0.1 && E.done) {
    TG.uiT = 0;
    const len = TG.msg.length, shown = Math.floor(len * ((TG.stage + TG.hold) / TG.stages));
    let s = '';
    for (let i = shown; i < len; i++) s += TG_GLYPHS[Math.floor(Math.random() * TG_GLYPHS.length)];
    E.done.textContent = TG.msg.slice(0, shown);
    E.rest.textContent = s;
    E.info.textContent = `${en ? 'PHASE' : 'FASE'} ${TG.stage + 1} / ${TG.stages}   ·   ${en ? 'SIGNAL' : 'SEÑAL'} ${Math.round(r * 100)}%`;
  }
  MG.setHUD({
    'lives-value': Math.floor(100 - r * 100) + '%',
    'level-value': Math.floor(Math.abs(mouseNDC.x * 1000)) + ' Hz',
    'files-value': Math.floor(Math.abs(mouseNDC.y * 1000)) + ' dB',
    'combo-value': Math.floor(r * 100) + '%'
  });

  if (TG.hold >= 1) tgAdvance();
}

function tgTeardown() {
  window.isTuningGameActive = false;
  tgToneStop();
  if (TG.group) { mgDispose(TG.group); TG.group = null; }
  TG.debris = null; TG.halo = null; TG.els = {};
  secretPlanet.userData.isIsolated = false;
  if (secretPlanet.userData.savedPos) secretPlanet.position.copy(secretPlanet.userData.savedPos);
  secretPlanet.material.wireframe = false;
  secretPlanet.material.color.setHex(0xff0000);
  secretPlanet.scale.set(1, 1, 1);
  if (secretPlanet.children.length > 0) secretPlanet.children[0].visible = true;
}

window.endTuningGame = function() {
  if (!window.isTuningGameActive) return;
  const en = MG.isEN();
  tgTeardown();
  MG.exit();
  showSystemToast(en ? '✧ The file becomes legible again ✧' : '✧ El archivo vuelve a ser legible ✧', '#e7e4de');
  setTimeout(() => { MG.reflect(MG.text('tuning', 'outro'), () => openProjectPopup(tuningData)); }, 700);
};

window.abortTuningGame = function() {
  if (!window.isTuningGameActive) return;
  const en = MG.isEN();
  tgTeardown();
  MG.exit();
  setTimeout(() => { MG.reflect(MG.text('tuning', 'outro'), () => {}); }, 700);          // salir sin jugar: la reflexión llega igual
};

// ==========================================
// 🧵 JUEGO OTRO: TELAR Y QUIPU (CACHARREO · GALERÍA)
//   El telar como tecnología para producir RELACIONES (cruzar hilos), PATRONES (repetición con variación),
//   MEMORIA (el tejido y el nudo guardan) y CONOCIMIENTO (se leen).
//
//   FASE I · EL TELAR — crear mundos. Tres rondas = los tres mundos andinos (Uku Pacha, Kay Pacha, Hanan Pacha) con
//   4 → 6 → 8 hilos. Cada hilo que conectas (nodo con su gemelo: mismo color y forma) se TEJE en una tela rojo y negro
//   inspirada en los tejidos jalq'a: figuras simétricas (aves, cuadrúpedos, un árbol, una máscara con serpientes) que
//   se forman de abajo hacia arriba, mundo a mundo. Tres enredos desanudan solo el mundo en curso.
//
//   FASE II · EL QUIPU — el nudo. Cada hilo tejido vuelve como una cuerda de su mismo color, colgando de un cordón principal.
//   Su nudo guarda lo tejido (decenas arriba, unidades abajo, como en los quipus). Se lee con las manos: pasa el dedo
//   o el cursor por cada cuerda y los nudos se anudan, cada uno con su nota.
// ==========================================
window.isWiringGameActive = false;
window.wiringData = null;
window.wiringNodes = [];
window.maxConnections = 4;
window.currentConnections = 0;

const WG_PAIRS = [
  { id: { es: 'URDIMBRE', en: 'WARP' },     color: PAL.gold,  geo: () => new THREE.OctahedronGeometry(1.2, 0) },
  { id: { es: 'TRAMA',    en: 'WEFT' },     color: PAL.mist,  geo: () => new THREE.BoxGeometry(1.6, 1.6, 1.6) },
  { id: { es: 'PEINE',    en: 'COMB' },     color: PAL.mauve, geo: () => new THREE.TetrahedronGeometry(1.5, 0) },
  { id: { es: 'LIZO',     en: 'HEDDLE' },   color: PAL.sage,  geo: () => new THREE.IcosahedronGeometry(1.2, 0) },
  { id: { es: 'PEDAL',    en: 'TREADLE' },  color: 0xe3a98f,  geo: () => new THREE.DodecahedronGeometry(1.15, 0) },
  { id: { es: 'NUDO',     en: 'KNOT' },     color: 0x8fd0c4,  geo: () => new THREE.ConeGeometry(1.1, 2.0, 5) },
  { id: { es: 'ORILLO',   en: 'SELVEDGE' }, color: 0xb7a6e0,  geo: () => new THREE.CylinderGeometry(0.9, 0.9, 1.8, 6) },
  { id: { es: 'HUSO',     en: 'SPINDLE' },  color: 0xc8d08a,  geo: () => new THREE.TorusGeometry(0.9, 0.32, 6, 12) },
  { id: { es: 'TELAR',    en: 'LOOM' },     color: 0x9fb0bd,  geo: () => new THREE.SphereGeometry(1.1, 7, 5) }
];
const WG_WORLDS = [
  { name: 'UKU PACHA',   sub: { es: 'el mundo de abajo · lo que germina',     en: 'the world below · what germinates' } },
  { name: 'KAY PACHA',   sub: { es: 'este mundo · lo que habitamos',          en: 'this world · what we inhabit' } },
  { name: 'HANAN PACHA', sub: { es: 'el mundo de arriba · lo que nos mira',   en: 'the world above · what watches us' } }
];
const WG_COLS = 44, WG_ROWS = 72, WG_SEG = 24, WG_MOTES = 36, WG_QSEG = 40;
const WG = {
  nodes: window.wiringNodes, hits: [], cables: [], fading: [], pairs: [], threads: [],
  drag: null, hover: null, lastHover: null, shorts: 0, maxShorts: 3, state: 'idle', next: 'advance', phase: 1,
  round: 0, rounds: [4, 6, 8], total: 18, woven: 0, roundConn: 0, pairsNow: 4,
  resetT: 0, roundT: 0, introT: 0, winT: 0, t: 0, scale: 1, emberT: 0, trailT: 0, uiDirty: true, cloth: null, quipu: null,
  els: {}, card: null, ptr: new THREE.Vector3(), prevPtr: new THREE.Vector3()
};
const _wgTmp = new THREE.Vector3(), _wgTmp2 = new THREE.Vector3();

// ---------- Patrón jalq'a-like (44×72, simétrico): franjas de abajo arriba = Uku Pacha 16 · Kay Pacha 24 · Hanan Pacha 32 filas ----------
//   0 fondo · 1 rojo · 2 rojo claro · 3 hueso · 4 punto tenue
function wgPattern() {
  const COLS = WG_COLS, ROWS = WG_ROWS, g = new Uint8Array(COLS * ROWS);
  const put = (c, r, v) => { if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return; g[r * COLS + c] = v; g[r * COLS + (COLS - 1 - c)] = v; };
  const putOne = (c, r, v) => { if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return; g[r * COLS + c] = v; };
  const sprite = (rows, c0, r0, flip) => {
    rows.forEach((s, j) => [...s].forEach((ch, i) => {
      const v = ch === '#' ? 1 : ch === 'o' ? 2 : ch === 'e' ? 3 : 0; if (!v) return;
      putOne(flip ? c0 + (s.length - 1 - i) : c0 + i, r0 + j, v);
    }));
  };
  const spriteM = (rows, c0, r0) => { sprite(rows, c0, r0, false); sprite(rows, COLS - c0 - rows[0].length, r0, true); };
  const zig = (r, amp, per, v) => { for (let c = 0; c < COLS / 2; c++) { const ph = c % per, tri = ph < per / 2 ? ph : per - ph; for (let k = 0; k < amp; k++) put(c, r + (amp - 1 - Math.min(amp - 1, Math.floor(tri * amp / (per / 2)))), v || 1); } };
  const step = (r, v) => { for (let c = 0; c < COLS / 2; c++) { if (((c >> 1) & 1) === 0) put(c, r, v || 1); else put(c, r + 1, v || 1); } };
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS / 2; c++) if ((c % 4 === 1) && (r % 4 === 2)) put(c, r, 4);   // lattice tenue

  const BIRD = ['#...........#', '##....#....##', '.###..#..###.', '..#########..', '...#######...', '....#.#.#....'];
  const LLAMA = ['.........##...', '........####..', '.......#e####.', '.......#####..', '..########....', '.###########..', '.###########..', '.##.##..##.##.', '.#..#....#..#.'];
  const SMALL = ['..##...', '.####e.', '#####..', '#.#.#..'];
  const MASK = ['#....#..#....#', '##...####...##', '.##.######.##.', '..##########..', '..#e######e#..', '..##########..', '...########...', '...#.#..#.#...', '...#..##..#...', '....#....#....'];
  const DIAM = ['..##..', '.####.', '.####.', '..##..'];
  const CHAK = ['....oo....', '....##....', '..######..', '###oooo###', '###oooo###', '..######..', '....##....', '....oo....'];

  // ===== HANAN PACHA · mundo de arriba (filas 0–31) =====
  zig(0, 2, 4);
  CHAK.forEach((s, j) => [...s].forEach((ch, i) => { const v = ch === '#' ? 1 : ch === 'o' ? 2 : 0; if (v) putOne(17 + i, 3 + j, v); }));
  spriteM(BIRD, 1, 4); spriteM(BIRD, 1, 12);
  for (let k = 0; k < 3; k++) spriteM(SMALL, 1 + k * 7, 19);
  zig(24, 2, 4);
  for (let k = 0; k < 3; k++) spriteM(DIAM, 2 + k * 7, 27);
  step(31);

  // ===== KAY PACHA · este mundo (filas 32–55) =====
  for (let i = 0; i < 21; i++) {
    const hw = 1 + Math.floor(i / 5), tooth = (i % 3 === 0) ? 2 : (i % 3 === 1 ? 1 : 0);
    for (let k = 0; k <= hw + tooth; k++) put(21 - k, 34 + i, k <= 0 ? ((i % 2) ? 2 : 1) : (k > hw ? 2 : 1));
  }
  spriteM(LLAMA, 0, 34); spriteM(LLAMA, 0, 45);
  step(55);

  // ===== UKU PACHA · mundo de abajo (filas 56–71) =====
  spriteM(MASK, 15, 58);
  for (let r = 58; r < 70; r++) {
    const c = 5 + Math.round(3 * Math.sin((r - 58) * 0.6));
    for (let k = 0; k < 3; k++) put(c + k, r, k === 1 ? 2 : 1);
    if ((r % 5) === 0) put(c + 3, r, 3);
  }
  for (let r = 60; r < 68; r++) { const c = 11 + Math.round(2 * Math.sin((r - 60) * 0.8 + 2)); put(c, r, 1); put(c + 1, r, 1); }
  zig(70, 2, 4);
  return g;
}

const WG_PAL = [[26, 12, 15], [200, 50, 43], [232, 96, 78], [236, 222, 200], [84, 26, 28]];
const WG_STY = WG_PAL.map(c => [0.8, 1].map(k => `rgb(${(c[0] * k) | 0},${(c[1] * k) | 0},${(c[2] * k) | 0})`));   // [valor][por debajo/por encima]

function wgRounds() { return (window.innerWidth / window.innerHeight < 0.8) ? [3, 4, 5] : [4, 6, 8]; }   // en vertical caben menos nodos

function wgBounds() {
  const aspect = window.innerWidth / window.innerHeight;
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * userGroup.position.z;
  const hh = halfH * 0.62;
  const hw = Math.min(halfH * aspect * 0.8, hh * 1.9);
  return { hw, hh, halfH, aspect };
}

function wgSample(n, hw, hh, minD) {
  const pts = []; let d = minD, tries = 0;
  while (pts.length < n && tries < 6000) {
    tries++;
    if (tries % 120 === 0) d *= 0.9;
    const p = new THREE.Vector3((Math.random() * 2 - 1) * hw, (Math.random() * 2 - 1) * hh, 0);
    if (pts.every(q => q.distanceTo(p) >= d)) pts.push(p);
  }
  for (let i = pts.length; i < n; i++) pts.push(new THREE.Vector3(((i % 5) - 2) * hw / 2.5, (Math.floor(i / 5) - 1.5) * hh / 1.5, 0));
  return pts;
}

function wgClear() {
  WG.nodes.forEach(mgDispose); WG.nodes.length = 0; WG.hits.length = 0;
  WG.cables.forEach(c => { mgDispose(c.line); mgDispose(c.motes); }); WG.cables.length = 0;
  WG.fading.forEach(f => mgDispose(f.line)); WG.fading.length = 0;
  if (WG.drag) { mgDispose(WG.drag.line); WG.drag = null; }
  WG.hover = null; WG.lastHover = null;
}

function wgNewLine(hex, opacity, n) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(((n || WG_SEG) + 1) * 3), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity }));
  line.frustumCulled = false;
  scene.add(line);
  return line;
}

function wgBez(a, b, t, out) {                   // curva con caída suave, como un hilo colgante
  const sag = Math.min(a.distanceTo(b) * 0.18, 3);
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 - sag, cz = (a.z + b.z) / 2, u = 1 - t;
  return out.set(u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y, u * u * a.z + 2 * u * t * cz + t * t * b.z);
}
function wgUpdateLine(line, a, b) {
  const arr = line.geometry.attributes.position.array;
  for (let i = 0; i <= WG_SEG; i++) { wgBez(a, b, i / WG_SEG, _wgTmp); arr[i * 3] = _wgTmp.x; arr[i * 3 + 1] = _wgTmp.y; arr[i * 3 + 2] = _wgTmp.z; }
  line.geometry.attributes.position.needsUpdate = true;
}

// ---------- La tela: un canvas vertical (como un tejido colgado) que se teje de abajo hacia arriba ----------
function wgHexRgb(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }

// Filas del patrón (0 = arriba) que teje el hilo g: se reparten de abajo hacia arriba entre todos los hilos
function wgThreadRows(g) {
  const T = WG.total, a = Math.round(g * WG_ROWS / T), b = Math.round((g + 1) * WG_ROWS / T) - 1;
  return [WG_ROWS - 1 - b, WG_ROWS - 1 - a];
}

function wgBuildCloth() {
  const W = 640, H = 1024;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.25, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.position.z = -0.8;
  scene.add(mesh);
  WG.cloth = { canvas, ctx, tex, mat, mesh, W, H, data: [], accT: 0, op: 0.25, sc: 1, glow: 0, pat: wgPattern() };
  wgDrawCloth(0);
}

function wgDrawCloth(t) {
  const C = WG.cloth; if (!C) return;
  const g = C.ctx, W = C.W, H = C.H, X0 = 56, Y0 = 80, CS = 12, pat = C.pat, glow = C.glow;
  g.globalAlpha = 1;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(8,4,6,0.72)'; g.fillRect(0, 0, W, H);
  // bastidor: postes y vigas
  g.fillStyle = 'rgba(231,228,222,0.22)';
  g.fillRect(14, 20, 16, H - 40); g.fillRect(W - 30, 20, 16, H - 40);
  g.fillRect(14, 26, W - 28, 18); g.fillRect(14, H - 44, W - 28, 18);
  // urdimbre: hilos verticales por los que corren datos
  for (let c = 0; c < WG_COLS; c++) {
    const x = X0 + (c + 0.5) * CS, a = 0.16 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.5 - c * 0.35));
    g.fillStyle = `rgba(231,228,222,${a})`; g.fillRect(x - 0.7, 48, 1.4, H - 96);
    g.fillStyle = 'rgba(231,228,222,0.5)';
    g.beginPath(); g.arc(x, 38, 2.2, 0, 6.2832); g.fill(); g.beginPath(); g.arc(x, H - 34, 2.2, 0, 6.2832); g.fill();
  }
  // regla: un tramo por hilo, en el color vivo del hilo cuando ya está tejido
  for (let k = 0; k < WG.total; k++) {
    const rr = wgThreadRows(k), e = C.data.find(d => d.t === k && d.removeT < 0);
    g.fillStyle = e ? `rgb(${e.vivid[0]},${e.vivid[1]},${e.vivid[2]})` : 'rgba(231,228,222,0.14)';
    g.fillRect(34, Y0 + rr[0] * CS + 1, 9, (rr[1] - rr[0] + 1) * CS - 2);
  }
  // trama tejida: sarga suave; rojo y negro, con acentos claros y hueso
  for (let i = 0; i < C.data.length; i++) {
    const e = C.data[i], fade = e.removeT >= 0 ? 1 - e.removeT : 1;
    if (fade <= 0) continue;
    g.globalAlpha = fade;
    const upto = Math.min(WG_COLS, Math.ceil(e.p * WG_COLS - 1e-6));
    for (let r = e.r0; r <= e.r1; r++) {
      const y = Y0 + r * CS;
      for (let c = 0; c < upto; c++) {
        const v = pat[r * WG_COLS + c], over = ((c + r) & 3) !== 0 ? 1 : 0;
        let sty = WG_STY[v][over];
        if (glow > 0 && (v === 1 || v === 2)) {                              // el patrón pulsa al terminar
          const br = 1 + glow * 0.28 * (0.5 + 0.5 * Math.sin(t * 3 - (r + c) * 0.35)), col = WG_PAL[v], k = over ? 1 : 0.82;
          sty = `rgb(${Math.min(255, col[0] * br * k) | 0},${Math.min(255, col[1] * br * k) | 0},${Math.min(255, col[2] * br * k) | 0})`;
        }
        g.fillStyle = sty; g.fillRect(X0 + c * CS + 0.4, y + 0.4, CS - 0.8, CS - 0.8);
      }
    }
    const hgt = (e.r1 - e.r0 + 1) * CS, yy = Y0 + e.r0 * CS;
    if (upto > 0) { g.fillStyle = `rgb(${e.vivid[0]},${e.vivid[1]},${e.vivid[2]})`; g.fillRect(46, yy + 2, 8, hgt - 4); }          // orillo vivo
    if (e.p >= 1) { g.fillStyle = `rgb(${e.vivid[0]},${e.vivid[1]},${e.vivid[2]})`; g.fillRect(W - 54, yy + 2, 8, hgt - 4); }
    if (e.flash > 0 && upto > 0) { g.fillStyle = `rgba(255,255,255,${e.flash * 0.3})`; g.fillRect(X0, yy, upto * CS, hgt); }
    if (e.p < 1) {                                                              // la lanzadera cruza la urdimbre
      const sx = X0 + e.p * WG_COLS * CS;
      g.shadowColor = '#fff0d2'; g.shadowBlur = 14;
      g.fillStyle = 'rgba(255,240,210,0.95)'; g.fillRect(sx - 8, yy + 3, 16, hgt - 6);
      g.shadowBlur = 0;
    }
  }
  g.globalAlpha = 1;
  C.tex.needsUpdate = true;
}

function wgUpdateCloth(dt, calm) {
  const C = WG.cloth; if (!C) return;
  let busy = false;
  for (let i = C.data.length - 1; i >= 0; i--) {
    const r = C.data[i];
    if (r.p < 1) { r.p = Math.min(1, r.p + dt / 0.9); busy = true; }
    if (r.flash > 0) { r.flash = Math.max(0, r.flash - dt * 1.5); busy = true; }
    if (r.removeT >= 0) { r.removeT += dt / 0.8; busy = true; if (r.removeT >= 1) C.data.splice(i, 1); }
  }
  C.glow = WG.state === 'quipuWon' ? Math.min(1, WG.winT / 1.5) : 0;
  C.accT += dt;
  if (busy || C.glow > 0) { C.accT = 0; wgDrawCloth(WG.t); }
  else if (!calm && C.accT > 0.12) { C.accT = 0; wgDrawCloth(WG.t); }          // brillo suave que recorre la urdimbre
  const fill = WG.woven / Math.max(1, WG.total);
  const tgt = WG.state === 'quipuWon' ? 0.85 : (WG.phase === 2 ? 0.3 : (WG.state === 'roundWon' || WG.state === 'leave' ? 0.75 : 0.22 + 0.32 * fill));
  C.op += (tgt - C.op) * Math.min(1, dt * 2.5);
  C.mat.opacity = C.op;
  const b = wgBounds(), ch = Math.min(b.halfH * 2 * 0.92, (2 * b.halfH * b.aspect * 0.94) / 0.625);   // tejido colgado: vertical, 5:8
  const tsc = WG.state === 'quipuWon' ? 1.04 : 1;
  C.sc += (tsc - C.sc) * Math.min(1, dt * 1.5);
  C.mesh.scale.set(ch * 0.625 * C.sc, ch * C.sc, 1);
}

function wgMakeNode(pair, pi, p, s) {
  const en = MG.isEN();
  const node = new THREE.Group();
  const geo = pair.geo();
  const mat = new THREE.MeshBasicMaterial({ color: pair.color, wireframe: true, transparent: true, opacity: 0.8 });
  const fillMat = new THREE.MeshBasicMaterial({ color: pair.color, transparent: true, opacity: 0.08, depthWrite: false });
  const body = new THREE.Mesh(geo, mat);          // solo el cuerpo gira: la etiqueta no orbita
  const fill = new THREE.Mesh(geo, fillMat); fill.scale.setScalar(0.97);
  body.add(fill);
  node.add(body);
  const halo = mkHalo(pair.color, 5.5, 0.2); halo.position.z = -0.4; node.add(halo);
  const label = createTextSprite(pair.id[en ? 'en' : 'es'], '#' + pair.color.toString(16).padStart(6, '0'), 24);
  label.position.set(0, -2.1, 0); node.add(label);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(2.3, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData.node = node; node.add(hit);
  node.position.copy(p); node.scale.setScalar(0.001);
  node.userData = { pair: pi, connected: false, base: p.clone(), phase: Math.random() * 6.28, mat, fillMat, body, halo, flash: 0, pop: 0, appear: -Math.random() * 0.4, baseColor: new THREE.Color(pair.color) };
  scene.add(node);
  WG.nodes.push(node); WG.hits.push(hit);
}

function wgBuild() {
  wgClear();
  const n = WG.rounds[WG.round];
  WG.pairsNow = n;
  const idx = WG_PAIRS.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, n);   // n tipos distintos al azar
  WG.pairs = idx.map(i => WG_PAIRS[i]);
  const b = wgBounds();
  WG.scale = Math.max(0.5, Math.min(1, b.hw / 8)) * (n > 7 ? 0.9 : 1);
  const minD = Math.min(4.2, Math.sqrt((b.hw * 2 * b.hh * 2) / (n * 2)) * 0.75);
  const pool = wgSample(n * 2, b.hw, b.hh, minD);
  WG.pairs.forEach((pair, pi) => {
    const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    pool.sort((p, q) => q.distanceTo(a) - p.distanceTo(a));
    const c = pool.splice(Math.floor(Math.random() * Math.ceil(pool.length / 2)), 1)[0];
    wgMakeNode(pair, pi, a, WG.scale); wgMakeNode(pair, pi, c, WG.scale);
  });
  window.currentConnections = 0; window.maxConnections = n;
  WG.roundConn = 0; WG.shorts = 0; WG.state = 'play'; WG.uiDirty = true;
}

function wgPick() {
  dragRaycaster.setFromCamera(mouseNDC, camera);
  const hits = dragRaycaster.intersectObjects(WG.hits, false);
  return hits.length ? hits[0].object.userData.node : null;
}
function wgPointerWorld() { MG.pointerWorld(WG.ptr); }

window.wiringDown = function(cx, cy) {
  if (WG.phase === 2) {                                   // quipu: un nuevo toque no debe "arrastrar" desde el toque anterior
    MG.setPointer(cx, cy); wgPointerWorld(); WG.prevPtr.copy(WG.ptr); return;
  }
  if (WG.state !== 'play' || WG.drag) return;
  MG.setPointer(cx, cy);
  const node = wgPick();
  if (!node || node.userData.connected || node.userData.appear < 0.6) return;
  WG.drag = { node, line: wgNewLine(node.userData.baseColor.getHex(), 0.75), end: node.position.clone() };
  wgPointerWorld();
  MGS.bell(MGS.NOTES[node.userData.pair % 6] * 2, 0, 0.6, 0.022);
  MG.pulse(node.position.x, node.position.y, node.userData.baseColor.getHex(), 1.4, 4.2, 0.9, 0.4);
};

window.wiringMove = function(cx, cy) {
  if (WG.phase === 2) { MG.setPointer(cx, cy); wgPointerWorld(); return; }
  if (!WG.drag) return;
  MG.setPointer(cx, cy);
  wgPointerWorld();
  const n = wgPick();
  WG.hover = (n && n !== WG.drag.node && !n.userData.connected) ? n : null;
  if (WG.hover && WG.hover !== WG.lastHover) MGS.bell(1568, 0, 0.4, 0.012);
  WG.lastHover = WG.hover;
};

window.wiringUp = function() {
  if (WG.phase === 2) return;
  const d = WG.drag; if (!d) return;
  const n = wgPick();
  const tgt = (n && n !== d.node && !n.userData.connected) ? n : null;
  WG.drag = null; WG.hover = null; WG.lastHover = null;
  if (!tgt) { mgDispose(d.line); return; }                 // soltar en el vacío: sin penalización
  if (tgt.userData.pair === d.node.userData.pair) wgConnect(d.node, tgt, d.line);
  else wgShort(d.node, tgt, d.line, d.end);
};

function wgConnect(a, b, line) {
  const pi = a.userData.pair, hex = WG.pairs[pi].color;
  line.material.opacity = 0.5;
  line.material.color.setHex(hex);
  const motes = mkGlowPoints(WG_MOTES);
  const at = motes.geometry.attributes;
  _fxc.setHex(hex);
  for (let i = 0; i < WG_MOTES; i++) { at.aCol.array[i * 3] = _fxc.r; at.aCol.array[i * 3 + 1] = _fxc.g; at.aCol.array[i * 3 + 2] = _fxc.b; }
  scene.add(motes);
  WG.cables.push({ a, b, line, motes, flow: Math.random(), speed: 0.12 });
  [a, b].forEach(n => {
    const u = n.userData; u.connected = true; u.pop = 1;
    u.mat.wireframe = false; u.mat.opacity = 0.95; u.mat.color.copy(u.baseColor).multiplyScalar(1.2);
    MG.fx.burst(n.position.x, n.position.y, 0, 22, 2.4, 1.8, hex, 0.24, 0.85);
    MG.pulse(n.position.x, n.position.y, hex, 1.2, 5.2, 1.3, 0.5);
  });
  // el hilo se teje: sus filas del patrón aparecen (de abajo hacia arriba). Lo tejido se recordará como un nudo.
  const g = WG.woven, rr = wgThreadRows(g), vivid = wgHexRgb(hex), pat = WG.cloth.pat;
  let red = 0; for (let r = rr[0]; r <= rr[1]; r++) for (let c = 0; c < WG_COLS; c++) { const v = pat[r * WG_COLS + c]; if (v === 1 || v === 2) red++; }
  WG.threads[g] = { hex, vivid, v10: Math.round(red / (rr[1] - rr[0] + 1)), round: WG.round };      // 0–44: promedio de rojo por fila
  WG.cloth.data.push({ t: g, r0: rr[0], r1: rr[1], vivid, p: 0, flash: 1, removeT: -1, round: WG.round });
  WG.woven++; WG.roundConn++;
  window.currentConnections = WG.roundConn; WG.uiDirty = true;
  const note = MGS.NOTES[g % 6] * (g >= 9 ? 2 : 1);                                // la melodía sube con la tela
  MGS.bell(note, 0, 2.4, 0.055);
  MGS.bell(note * 1.5, 0.09, 1.8, 0.025);
  if (WG.roundConn >= WG.pairsNow) wgRoundDone();
}

function wgShort(a, b, line, end) {
  const en = MG.isEN();
  WG.shorts++;
  for (let i = 0; i < 30; i++) {
    wgBez(a.position, end, Math.random(), _wgTmp);
    MG.fx.emit(_wgTmp.x, _wgTmp.y, 0, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6 + 0.3, 0, 1.2 + Math.random() * 0.8, PAL.rose, 0.26, 0.7, 1.2);
  }
  line.material.color.setHex(PAL.rose);
  WG.fading.push({ line, life: 0.45 });
  a.userData.flash = 0.6; b.userData.flash = 0.6;
  MG.pulse(a.position.x, a.position.y, PAL.rose, 1.2, 4.5, 1.1, 0.4);
  MG.pulse(b.position.x, b.position.y, PAL.rose, 1.2, 4.5, 1.1, 0.4);
  shakeIntensity = 0.25;
  MGS.knock();
  showSystemToast(en ? `The threads tangle (${WG.shorts}/${WG.maxShorts})` : `Los hilos se enredan (${WG.shorts}/${WG.maxShorts})`, '#e7e4de');
  if (WG.shorts >= WG.maxShorts) {
    // el mundo en curso se desanuda: sus filas se deshacen; los mundos anteriores quedan tejidos
    WG.cloth.data.forEach(r => { if (r.round === WG.round && r.removeT < 0) { r.removeT = 0; WG.woven--; } });
    WG.threads.length = WG.woven;
    WG.roundConn = 0; WG.uiDirty = true;
    WG.state = 'leave'; WG.next = 'reset'; WG.resetT = 1.0;
    setTimeout(() => showSystemToast(en ? 'The world unravels. Weave it again.' : 'El mundo se desanuda. Vuelve a tejerlo.', '#e7e4de'), 450);
  }
}

function wgRoundDone() {
  const en = MG.isEN(), last = WG.round >= WG.rounds.length - 1;
  WG.state = 'roundWon'; WG.roundT = 0; WG.next = last ? 'phase2' : 'advance';
  WG.cables.forEach(c => { c.speed = 0.5; });
  WG.nodes.forEach(n => MG.fx.burst(n.position.x, n.position.y, 0, 14, 2.6, 2.0, WG.pairs[n.userData.pair].color, 0.26, 0.85));
  MG.pulse(0, 0, PAL.bone, 2, 18, 1.8, 0.3);
  MGS.arpeggio(last ? [0, 2, 3, 5] : [0, 2, 3], 0.14, 2.2, 0.04);
  showSystemToast(last ? (en ? 'The three worlds are woven' : 'Los tres mundos están tejidos')
                       : (en ? `${WG_WORLDS[WG.round].name}: woven` : `${WG_WORLDS[WG.round].name}: tejido`), '#e7e4de');
}

// ---------- Tarjetas de fase: aparecen un momento y se desvanecen (no bloquean el juego) ----------
function wgCard(kicker, title, text, secs) {
  const c = WG.els.card; if (!c) return;
  c.k.textContent = kicker; c.t.textContent = title; c.p.textContent = text;
  c.el.style.opacity = '1'; WG.card = { t: secs };
}
function wgWorldCard(first) {
  const en = MG.isEN(), w = WG_WORLDS[WG.round];
  wgCard(`${en ? 'PHASE I · THE LOOM · WORLD' : 'FASE I · EL TELAR · MUNDO'} ${WG.round + 1} / ${WG.rounds.length}`, w.name,
    (first ? (en ? 'Crossing threads creates relations; repeated, relations make a pattern.  ' : 'Cruzar hilos crea relaciones; repetidas, hacen patrón.  ') : '') + w.sub[en ? 'en' : 'es'], first ? 6.5 : 4);
}

function wgSyncUI() {
  const en = MG.isEN(), E = WG.els; if (!E.round) return;
  if (WG.phase === 1) {
    const w = WG_WORLDS[WG.round];
    E.kicker.textContent = en ? 'PHASE I  ·  THE LOOM' : 'FASE I  ·  EL TELAR';
    E.round.textContent = `${w.name}   ·   ${WG.woven} / ${WG.total} ${en ? 'THREADS' : 'HILOS'}`;
    E.fill.style.width = (WG.woven / Math.max(1, WG.total) * 100).toFixed(1) + '%';
  } else {
    const Q = WG.quipu;
    E.kicker.textContent = en ? 'PHASE II  ·  THE QUIPU' : 'FASE II  ·  EL QUIPU';
    E.round.textContent = `${Q ? Q.tiedCords : 0} / ${Q ? Q.cords.length : 0} ${en ? 'CORDS READ' : 'CUERDAS LEÍDAS'}   ·   ${Q ? Q.tiedKnots : 0} / ${Q ? Q.totalKnots : 0} ${en ? 'KNOTS' : 'NUDOS'}`;
    E.fill.style.width = (Q && Q.totalKnots ? Q.tiedKnots / Q.totalKnots * 100 : 0).toFixed(1) + '%';
  }
  WG.uiDirty = false;
}

// ==========================================
// FASE II · EL QUIPU
//   Un cordón principal (anillo) del que cuelgan las cuerdas de los hilos tejidos, en abanico. El valor de cada hilo
//   (promedio de rojo por fila, 0–44) se anuda como en un quipu: DECENAS = nudos simples más cerca del cordón principal;
//   UNIDADES = un nudo largo cerca del extremo libre (más vueltas = nudo más largo).
// ==========================================
function wgCircleLine(r, hex, opacity) {
  const n = 64, line = wgNewLine(hex, opacity, n), arr = line.geometry.attributes.position.array;
  for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; arr[i * 3] = Math.cos(a) * r; arr[i * 3 + 1] = Math.sin(a) * r; arr[i * 3 + 2] = 0; }
  line.geometry.attributes.position.needsUpdate = true;
  return line;
}

function wgBuildQuipu() {
  const b = wgBounds(), N = WG.threads.length;
  const Q = { group: new THREE.Group(), cords: [], sites: [], tiedCords: 0, tiedKnots: 0, totalKnots: 0, time: 0, grow: 0,
              ringC: new THREE.Vector3(0, b.hh * 0.45, 0), ringR: Math.max(0.8, Math.min(1.25, b.hw * 0.1)), hitR: MG.isTouch() ? 0.9 : 0.7 };
  scene.add(Q.group);
  // cordón principal: anillo de varias vueltas + halo
  [0, 0.18, 0.36].forEach((d, i) => { const l = wgCircleLine(Q.ringR + d * 0.5, 0xe7e4de, 0.75 - i * 0.2); l.position.copy(Q.ringC); Q.group.add(l); scene.remove(l); });
  const halo = mkHalo(0xe7e4de, Q.ringR * 5, 0.14); halo.position.copy(Q.ringC); Q.group.add(halo); Q.halo = halo;
  const rx = b.hw * 1.02, yTop = b.hh * 1.05, yBot = -b.hh * 1.12;
  for (let i = 0; i < N; i++) {
    const th = (-150 + 300 * (i + 0.5) / N) * Math.PI / 180, dx = Math.sin(th), dy = -Math.cos(th);
    let L = 1e9;
    if (Math.abs(dx) > 1e-3) L = Math.min(L, ((dx > 0 ? rx : -rx) - Q.ringC.x) / dx);
    if (Math.abs(dy) > 1e-3) L = Math.min(L, ((dy > 0 ? yTop : yBot) - Q.ringC.y) / dy);
    L = Math.max(3.2, L * 0.93);
    const S = new THREE.Vector3(Q.ringC.x + dx * Q.ringR, Q.ringC.y + dy * Q.ringR, 0);
    const E = new THREE.Vector3(Q.ringC.x + dx * L, Q.ringC.y + dy * L - 0.04 * L * Math.abs(dx), 0);
    const Cc = new THREE.Vector3((S.x + E.x) / 2, (S.y + E.y) / 2 - 0.06 * L, 0);
    const th0 = WG.threads[i], hex = th0.hex;
    const line = wgNewLine(hex, 0.45, WG_QSEG); Q.group.add(line); scene.remove(line);
    const twist = mkGlowPoints(30), ta = twist.geometry.attributes;
    _fxc.setHex(hex); for (let k = 0; k < 30; k++) { ta.aCol.array[k * 3] = _fxc.r; ta.aCol.array[k * 3 + 1] = _fxc.g; ta.aCol.array[k * 3 + 2] = _fxc.b; ta.aSize.array[k] = 0.1; }
    Q.group.add(twist);
    const cord = { i, hex, S, E, C: Cc, L, line, twist, sites: [], tied: 0, done: false, glow: 0, growth: 0 };
    // nudos: decenas (simples) cerca del cordón principal; unidades (largo) cerca del extremo libre
    let tens = Math.min(4, Math.floor(th0.v10 / 10)), unit = th0.v10 % 10;
    if (tens === 0 && unit === 0) unit = 1;
    for (let k = 0; k < tens; k++) cord.sites.push({ cord, k, kind: 'tens', t: 0.34 + k * 0.1, turns: 1 });
    if (unit > 0) cord.sites.push({ cord, k: tens, kind: 'unit', t: 0.86, turns: unit });
    cord.sites.forEach(s => {
      s.pos = new THREE.Vector3(); s.tied = false; s.appear = 0;
      const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.95 });
      s.knot = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), mat); s.knot.scale.setScalar(0.001); Q.group.add(s.knot);
      s.ghost = mkHalo(hex, 1.5, 0.2); Q.group.add(s.ghost);
      Q.sites.push(s); Q.totalKnots++;
    });
    Q.cords.push(cord);
  }
  WG.quipu = Q;
}

function wgCordPt(c, s, time, out) {                       // punto de la cuerda en s∈[0,1] (con crecimiento y vaivén)
  const g = c.growth, Ex = c.S.x + (c.E.x - c.S.x) * g, Ey = c.S.y + (c.E.y - c.S.y) * g, Cx = c.S.x + (c.C.x - c.S.x) * g, Cy = c.S.y + (c.C.y - c.S.y) * g, u = 1 - s;
  const x = u * u * c.S.x + 2 * u * s * Cx + s * s * Ex, y = u * u * c.S.y + 2 * u * s * Cy + s * s * Ey;
  const tx = Ex - c.S.x, ty = Ey - c.S.y, tl = Math.hypot(tx, ty) || 1;
  const sw = Math.sin(time * 0.9 + c.i * 0.8 + s * 5) * 0.05 * s * Math.min(c.L, 10) * (1 + c.glow * 2);
  return out.set(x - ty / tl * sw, y + tx / tl * sw, 0);
}

function wgTie(site) {
  const Q = WG.quipu, cord = site.cord, p = site.pos;
  site.tied = true; site.appear = 0; cord.tied++; Q.tiedKnots++; WG.uiDirty = true;
  MG.fx.burst(p.x, p.y, 0, 12, 1.6, 1.4, cord.hex, 0.2, 0.85);
  MG.pulse(p.x, p.y, cord.hex, 0.5, 2.6, 0.9, 0.4);
  const n = MGS.NOTES[(cord.i + site.k * 2) % 6];
  if (site.kind === 'unit') MGS.bell(n * 0.5, 0, 2.8, 0.05); else MGS.bell(n, 0, 1.8, 0.04);      // el nudo largo suena grave y largo
  if (cord.tied >= cord.sites.length) {                                                         // cuerda leída
    cord.done = true; cord.glow = 1; Q.tiedCords++; WG.uiDirty = true;
    MGS.arpeggio([cord.i % 6, (cord.i + 2) % 6], 0.12, 2.2, 0.03);
    if (Q.tiedCords >= Q.cords.length) wgQuipuWin();
  }
}

function wgQuipuWin() {
  const en = MG.isEN(), Q = WG.quipu;
  WG.state = 'quipuWon'; WG.winT = 0;
  Q.cords.forEach(c => MG.fx.burst(c.E.x, c.E.y, 0, 14, 2.4, 2.4, c.hex, 0.26, 0.85));
  MG.pulse(Q.ringC.x, Q.ringC.y, PAL.bone, 1.5, 24, 2.6, 0.4);
  playSound('levelup');
  MGS.arpeggio([0, 1, 2, 3, 5, 4], 0.16, 2.8, 0.04);
  showSystemToast(en ? '✧ What was woven is now remembered ✧' : '✧ Lo tejido ahora se recuerda ✧', '#e7e4de');
}

function wgStartQuipu() {
  const en = MG.isEN();
  wgClear();
  WG.phase = 2; WG.state = 'quipuIntro'; WG.introT = 0; WG.winT = 0;
  wgBuildQuipu();
  if (MG.ui && MG.ui.hint) MG.ui.hint.textContent = en
    ? 'Run your finger (or cursor) along each cord. The knot keeps what was woven — it is read with the hands.'
    : 'Pasa el dedo (o el cursor) por cada cuerda. El nudo guarda lo tejido: se lee con las manos.';
  wgCard(en ? 'PHASE II · THE QUIPU' : 'FASE II · EL QUIPU', en ? 'The knot' : 'El nudo',
    en ? 'Every thread returns as a cord. The knot turns pattern into memory.' : 'Cada hilo vuelve como cuerda. El nudo convierte el patrón en memoria.', 6);
  MGS.arpeggio([2, 0], 0.3, 3, 0.04);
  WG.uiDirty = true;
}

function wgQuipuUpdate(dt, calm) {
  const Q = WG.quipu; if (!Q) return;
  Q.time += dt;
  const t = Q.time;
  if (WG.state === 'quipuIntro') {
    WG.introT += dt; Q.grow = Math.min(1, WG.introT / 2.4);
    if (WG.introT > 2.6) WG.state = 'quipu';
  } else Q.grow = 1;
  const ge = 1 - Math.pow(1 - Q.grow, 3);
  Q.halo.material.opacity = 0.14 + 0.1 * Math.sin(t * 1.2) + (WG.state === 'quipuWon' ? 0.3 : 0);

  // lectura: cualquier nudo que el puntero roce (el segmento entre cuadros) se anuda
  if (WG.state === 'quipu') {
    if (mouseNDC.x > -1.5) {
      wgPointerWorld();
      const a = WG.prevPtr, b = WG.ptr, abx = b.x - a.x, aby = b.y - a.y, ab2 = abx * abx + aby * aby;
      Q.sites.forEach(s => {
        if (s.tied) return;
        const px = s.pos.x - a.x, py = s.pos.y - a.y, k = ab2 > 1e-9 ? Math.max(0, Math.min(1, (px * abx + py * aby) / ab2)) : 0;
        if (Math.hypot(s.pos.x - (a.x + abx * k), s.pos.y - (a.y + aby * k)) < Q.hitR && s.cord.growth > 0.9) wgTie(s);
      });
      a.copy(b);
    }
  }

  Q.cords.forEach(c => {
    c.growth = ge; c.glow = Math.max(0, c.glow - dt * 0.8);
    const la = c.line.geometry.attributes.position.array;
    for (let i = 0; i <= WG_QSEG; i++) { wgCordPt(c, i / WG_QSEG, t, _wgTmp); la[i * 3] = _wgTmp.x; la[i * 3 + 1] = _wgTmp.y; la[i * 3 + 2] = 0; }
    c.line.geometry.attributes.position.needsUpdate = true;
    c.line.material.opacity = (c.done ? 0.85 : 0.4) + c.glow * 0.15;
    const ta = c.twist.geometry.attributes, tp = ta.position.array, tal = ta.aAlpha.array;
    for (let k = 0; k < 30; k++) { wgCordPt(c, (k + 0.5) / 30, t, _wgTmp); tp[k * 3] = _wgTmp.x; tp[k * 3 + 1] = _wgTmp.y; tp[k * 3 + 2] = 0; tal[k] = (0.22 + 0.2 * Math.sin(t * 2 + k * 0.7 + c.i)) * (c.done ? 1.6 : 1) * ge; }
    ta.position.needsUpdate = true; ta.aAlpha.needsUpdate = true;
    c.sites.forEach(s => {
      wgCordPt(c, s.t, t, s.pos);
      const vis = Math.max(0, Math.min(1, (c.growth - s.t) * 6));
      if (s.tied) s.appear = Math.min(1, s.appear + dt * 3.5);
      const e = s.tied ? 1 - Math.pow(1 - s.appear, 3) * (1 + 0.6 * (1 - s.appear)) : 0;      // aparece con un pequeño rebote
      wgCordPt(c, Math.min(1, s.t + 0.03), t, _wgTmp); wgCordPt(c, Math.max(0, s.t - 0.03), t, _wgTmp2);
      const ang = Math.atan2(_wgTmp.y - _wgTmp2.y, _wgTmp.x - _wgTmp2.x);
      s.knot.position.copy(s.pos); s.knot.rotation.z = ang;
      const len = s.kind === 'unit' ? 1 + 0.35 * s.turns : 1;                                   // nudo largo: más vueltas, más largo
      s.knot.scale.set(Math.max(0.001, e * len), Math.max(0.001, e), Math.max(0.001, e));
      s.ghost.position.copy(s.pos);
      s.ghost.material.opacity = s.tied ? 0 : vis * (0.16 + 0.12 * Math.sin(t * 2 + s.cord.i * 0.7 + s.k));
    });
  });
}

function wgUpdate(dt) {
  WG.t += dt;
  const calm = reduceMotionMQ.matches;
  const amp = calm ? 0 : (0.25 + 0.08 * WG.round) * WG.scale;                       // los mundos avanzados se agitan más
  const leaving = WG.state === 'leave';

  WG.nodes.forEach(n => {
    const u = n.userData;
    u.appear = leaving ? Math.max(0, u.appear - dt * 1.4) : Math.min(1, u.appear + dt / 0.9);
    const ap = Math.max(0, u.appear), ease = 1 - Math.pow(1 - ap, 3);
    n.position.set(u.base.x + Math.sin(WG.t * 0.9 + u.phase) * amp, u.base.y + Math.cos(WG.t * 0.7 + u.phase) * amp, 0);
    if (!calm) { u.body.rotation.x += dt * 0.5; u.body.rotation.y += dt * 1.0; }
    let sc = WG.scale * ease;
    if (u.pop > 0) { u.pop = Math.max(0, u.pop - dt * 3); sc *= 1 + Math.sin(u.pop * Math.PI) * 0.35; }
    const isHover = WG.hover === n;
    n.scale.setScalar(Math.max(0.001, sc * (isHover ? 1.2 : 1)));
    if (u.flash > 0) {
      u.flash -= dt;
      u.mat.color.copy(u.baseColor).lerp(_c2.setHex(PAL.rose), Math.min(1, u.flash / 0.6));
    } else if (!u.connected) {
      u.mat.color.copy(u.baseColor);
      if (isHover) u.mat.color.multiplyScalar(1.5);
    }
    u.halo.material.opacity = (u.connected ? 0.38 + 0.12 * Math.sin(WG.t * 2 + u.phase) : (isHover ? 0.42 : 0.2)) * ease;
    u.fillMat.opacity = u.connected ? 0.32 : 0.08;
  });

  // Hilos conectados + motas que fluyen
  const cfade = leaving ? Math.max(0, WG.resetT) : 1;
  WG.cables.forEach(c => {
    wgUpdateLine(c.line, c.a.position, c.b.position);
    c.flow = (c.flow + dt * c.speed) % 1;
    const at = c.motes.geometry.attributes, P = at.position.array, S = at.aSize.array, A = at.aAlpha.array;
    for (let i = 0; i < WG_MOTES; i++) {
      const tt = (i / WG_MOTES + c.flow) % 1;
      wgBez(c.a.position, c.b.position, tt, _wgTmp);
      P[i * 3] = _wgTmp.x; P[i * 3 + 1] = _wgTmp.y; P[i * 3 + 2] = _wgTmp.z;
      S[i] = 0.18 + 0.12 * Math.sin(Math.PI * tt);
      A[i] = 0.85 * Math.sin(Math.PI * tt);
    }
    at.position.needsUpdate = true; at.aSize.needsUpdate = true; at.aAlpha.needsUpdate = true;
    c.motes.material.uniforms.uOpacity.value = cfade; c.line.material.opacity = 0.5 * cfade;
  });

  // Hilo en mano: sigue al cursor y deja una estela
  if (WG.drag) {
    const d = WG.drag, hov = WG.hover;
    d.end.lerp(hov ? hov.position : WG.ptr, Math.min(1, dt * 18));
    wgUpdateLine(d.line, d.node.position, d.end);
    const ok = hov && hov.userData.pair === d.node.userData.pair;
    if (hov) d.line.material.color.setHex(ok ? WG.pairs[d.node.userData.pair].color : PAL.rose);
    else d.line.material.color.copy(d.node.userData.baseColor);
    WG.trailT -= dt;
    if (!calm && WG.trailT <= 0) {
      WG.trailT = 0.03;
      MG.fx.emit(d.end.x, d.end.y, 0, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5 + 0.2, 0, 1.0, d.node.userData.baseColor.getHex(), 0.2, 0.55, 1.3);
    }
  }

  for (let i = WG.fading.length - 1; i >= 0; i--) {
    const f = WG.fading[i]; f.life -= dt;
    f.line.material.opacity = Math.max(0, f.life / 0.45) * 0.6;
    if (f.life <= 0) { mgDispose(f.line); WG.fading.splice(i, 1); }
  }

  // Brasas: cada tanto un nodo suelta una mota que sube despacio
  WG.emberT -= dt;
  if (!calm && WG.emberT <= 0 && WG.nodes.length && !leaving) {
    WG.emberT = 0.22;
    const n = WG.nodes[Math.floor(Math.random() * WG.nodes.length)];
    MG.fx.emit(n.position.x + (Math.random() - 0.5), n.position.y + (Math.random() - 0.5), 0, (Math.random() - 0.5) * 0.3, 0.35 + Math.random() * 0.3, 0,
      2.6, WG.pairs[n.userData.pair].color, 0.18, n.userData.connected ? 0.7 : 0.4, 0.2);
  }

  // Máquina de estados. Fase I: jugando → mundo completo → nodos se desvanecen → siguiente mundo (o reinicio) · Fase II: quipu
  if (WG.state === 'roundWon') {
    WG.roundT += dt;
    if (WG.roundT > 1.5) { WG.state = 'leave'; WG.resetT = 1.0; }
  } else if (WG.state === 'leave') {
    WG.resetT -= dt;
    if (WG.resetT <= 0) {
      if (WG.next === 'advance') { WG.round++; wgBuild(); wgWorldCard(false); }
      else if (WG.next === 'phase2') wgStartQuipu();
      else wgBuild();
    }
  } else if (WG.state === 'quipuWon') {
    WG.winT += dt;
    if (WG.winT > 5.2) { wgQuipuUpdate(dt, calm); wgUpdateCloth(dt, calm); window.endWiringGame(); return; }
  }

  if (WG.phase === 2) wgQuipuUpdate(dt, calm);
  wgUpdateCloth(dt, calm);
  if (WG.card) { WG.card.t -= dt; if (WG.card.t <= 0 && WG.els.card) { WG.els.card.el.style.opacity = '0'; WG.card = null; } }
  if (WG.uiDirty) wgSyncUI();

  if (WG.phase === 1) MG.setHUD({
    'lives-value': WG.shorts + '/' + WG.maxShorts,
    'level-value': WG.woven + '/' + WG.total,
    'files-value': (WG.woven * 25) + ' Mbps',
    'combo-value': (WG.drag ? WG.drag.node.position.distanceTo(WG.drag.end) * 0.8 : 0).toFixed(2) + ' Ω'
  });
  else { const Q = WG.quipu; MG.setHUD({
    'lives-value': '—',
    'level-value': (Q ? Q.tiedCords : 0) + '/' + (Q ? Q.cords.length : 0),
    'files-value': (Q ? Q.tiedKnots : 0) + '/' + (Q ? Q.totalKnots : 0),
    'combo-value': '—'
  }); }
}

function wgStart(data) {
  if (window.isWiringGameActive || window.isTuningGameActive || window.isHogueraActive) return;
  const en = MG.isEN();
  window.isWiringGameActive = true;
  window.wiringData = data;
  MG.enter(15);
  const ui = MG.buildUI(en
    ? 'Draw a thread from each node to its twin — same colour, same shape. Every thread you connect is woven into the world.'
    : 'Lleva un hilo de cada nodo hasta su gemelo — mismo color, misma forma. Cada hilo que conectas se teje en el mundo.');
  const kicker = document.createElement('div');
  kicker.style.cssText = 'font-size:0.66rem; font-weight:300; letter-spacing:0.34em; color:#a8a49c;';
  const round = document.createElement('div');
  round.style.cssText = 'margin-top:8px; font-size:0.62rem; font-weight:300; letter-spacing:0.26em; color:#8a867f;';
  const prog = document.createElement('div'); prog.style.cssText = 'margin:12px auto 0; width:min(60vw,240px); height:1px; background:rgba(231,228,222,0.15); position:relative;';
  const fill = document.createElement('div'); fill.style.cssText = 'position:absolute; left:0; top:0; height:1px; width:0%; background:#e7e4de; box-shadow:0 0 8px rgba(231,228,222,0.6); transition:width .6s ease;';
  prog.appendChild(fill); ui.extra.appendChild(kicker); ui.extra.appendChild(round); ui.extra.appendChild(prog);
  // tarjeta de fase (centro, se desvanece sola)
  const cardEl = document.createElement('div');
  cardEl.style.cssText = 'position:absolute; left:50%; top:24%; transform:translateX(-50%); width:min(86vw,560px); text-align:center; opacity:0; transition:opacity 1.4s ease; text-shadow:0 0 18px rgba(0,0,0,0.9);';
  const ck = document.createElement('div'); ck.style.cssText = 'font-size:0.62rem; font-weight:300; letter-spacing:0.38em; color:#a8a49c;';
  const ct = document.createElement('div'); ct.style.cssText = 'margin:12px 0; font-size:1.6rem; font-weight:200; letter-spacing:0.22em; color:#e7e4de;';
  const cp = document.createElement('div'); cp.style.cssText = 'font-size:0.85rem; font-weight:300; letter-spacing:0.06em; line-height:1.9; color:#cfd0d4;';
  cardEl.appendChild(ck); cardEl.appendChild(ct); cardEl.appendChild(cp); ui.root.appendChild(cardEl);
  WG.els = { kicker, round, fill, card: { el: cardEl, k: ck, t: ct, p: cp } };

  WG.rounds = wgRounds(); WG.total = WG.rounds.reduce((a, b) => a + b, 0);
  WG.round = 0; WG.woven = 0; WG.roundConn = 0; WG.winT = 0; WG.phase = 1; WG.threads = []; WG.quipu = null; WG.card = null;
  wgBuildCloth();
  wgBuild();
  wgWorldCard(true);
  morphHUD('enrutar');
}
window.startWiringGame = function(data) {
  if (MG.pending || window.isWiringGameActive || window.isTuningGameActive || window.isHogueraActive) return;
  MG.pending = true;
  MG.reflect(MG.text('wiring', 'intro'), () => { MG.pending = false; wgStart(data); }, { cancelable: true, onCancel: () => { MG.pending = false; } });
};

function wgTeardown() {
  window.isWiringGameActive = false; WG.state = 'idle'; WG.phase = 1;
  wgClear();
  if (WG.quipu) { mgDispose(WG.quipu.group); WG.quipu = null; }
  if (WG.cloth) { mgDispose(WG.cloth.mesh); WG.cloth = null; }
  WG.els = {}; WG.card = null;
}

window.endWiringGame = function() {
  if (!window.isWiringGameActive) return;
  wgTeardown();
  MG.exit();
  setTimeout(() => { MG.reflect(MG.text('wiring', 'outro'), () => openProjectPopup(window.wiringData)); }, 700);
};

window.abortWiringGame = function() {
  if (!window.isWiringGameActive) return;
  wgTeardown();
  MG.exit();
  setTimeout(() => { MG.reflect(MG.text('wiring', 'outro'), () => {}); }, 700);
};

// ==========================================
// 🔥 JUEGO OTRO: LA HOGUERA DE DATOS (EL VIAJERO · DISEÑO DE SUFICIENCIA Y RENUNCIA)
//   Evento nómada: se activa al hacer clic en el Viajero cuando flota libre en el vacío.
//   Plano lejano, casi inmóvil: un viajero diminuto, una hoguera, dos animales dormidos y, al fondo,
//   un Coloso humanoide de monitores CRT (ditherShader + glitch rojo) que irradia frío y se inclina hacia el fuego.
//   Para seguir escuchando su caja negra hay que RENUNCIAR: arrastrar tus propios puntos (SCORE, COMBO,
//   ARCHIVOS) y lanzarlos al fuego. Cuanto más frío, más pesado se vuelve el gesto.
//   La cámara se retira lentamente mientras escuchas: el final es el plano más amplio.
// ==========================================
window.isHogueraActive = false;
window.hgPose = null;
const _hgEuler = new THREE.Euler();
const _hgV = new THREE.Vector3();
const HG_LISTEN_SECS = 45;
const HG_FS = 0.9;                                   // escala de llamas (la escena es una maqueta pequeña)
const HG_ISO = { yaw: 0.785, pitch: 0.56, dist: 88, fov: 30, target: new THREE.Vector3(-14, 5, 1) };   // cámara isométrica (casi ortográfica)
const HG_COLOSSUS = { x: -36.8, z: 5.6, scale: 0.42, yaw: 1.4 };       // serpiente emplumada de ~9 veces la altura del Viajero, con la cabeza hacia el fuego
const HG = {
  phase: 'idle', heat: 0.7, cold: 0, coldS: 0, listen: 0, listenS: 0, outT: 0, winT: 0, discarded: 0, files: 0,
  subT: 0, subIdx: 0, flashV: 0, calmV: 0, emberT: 0, filesNote: false,
  growlIn: 10, meowIn: 15, growlP: 1, growlAmp: 0, growlDur: 2, growlG: 0,
  idleT: 0, menaceP: 0, menaceSub: false, rattleIn: 6,
  group: null, ground: null, bodyMat: null, screenMat: null, fx: null, fireHalo: null, glowDisc: null,
  colos: null, sigil: null, stars: null, fog: null, snow: null, moon: null, eyes: [], pets: [], chips: [], els: {}, tone: null, saved: null,
  fire: new THREE.Vector3(0.8, 0.9, 0.0), fireScreen: { x: 0, y: 0 }
};
const HG_FIRE_COLS = [0xffd08a, 0xff8a3d, 0xe0482e];

// ---------- Monitores fusionados en mallas (cada parte del Coloso es un par cuerpo+pantalla) ----------
function hgBoxData(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  const F = [
    [[0, 0, 1],  [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]],
    [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]],
    [[1, 0, 0],  [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]]],
    [[-1, 0, 0], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]]],
    [[0, 1, 0],  [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]]],
    [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]]]
  ];
  const p = [], n = [], u = [], i = []; let o = 0;
  F.forEach(([nn, vs]) => {
    vs.forEach((v, k) => { p.push(v[0], v[1], v[2]); n.push(nn[0], nn[1], nn[2]); u.push(k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0); });
    i.push(o, o + 1, o + 2, o, o + 2, o + 3); o += 4;
  });
  return { p, n, u, i };
}
function hgPlaneData(w, h, z) {
  return { p: [-w / 2, -h / 2, z, w / 2, -h / 2, z, w / 2, h / 2, z, -w / 2, h / 2, z],
           n: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], u: [0, 0, 1, 0, 1, 1, 0, 1], i: [0, 1, 2, 0, 2, 3] };
}
function hgPush(acc, data, cx, cy, cz, ry, rz, seed, rx) {
  const base = acc.p.length / 3, cY = Math.cos(ry), sY = Math.sin(ry), cZ = Math.cos(rz), sZ = Math.sin(rz), cX = Math.cos(rx || 0), sX = Math.sin(rx || 0);
  const rot = (x, y, z) => {                                                   // primero inclinación (X), luego Z, luego giro (Y)
    const y0 = y * cX - z * sX, z0 = y * sX + z * cX;
    const x1 = x * cZ - y0 * sZ, y1 = x * sZ + y0 * cZ;
    return [x1 * cY + z0 * sY, y1, -x1 * sY + z0 * cY];
  };
  for (let k = 0; k < data.p.length; k += 3) {
    const r = rot(data.p[k], data.p[k + 1], data.p[k + 2]); acc.p.push(r[0] + cx, r[1] + cy, r[2] + cz);
    const m = rot(data.n[k], data.n[k + 1], data.n[k + 2]); acc.n.push(m[0], m[1], m[2]);
    acc.s.push(seed);
  }
  for (let k = 0; k < data.u.length; k++) acc.u.push(data.u[k]);
  for (let k = 0; k < data.i.length; k++) acc.i.push(data.i[k] + base);
}
function hgToGeo(acc) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(acc.p), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(acc.n), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(acc.u), 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(acc.s), 1));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(acc.i), 1));
  return g;
}

// ---------- El Coloso: una serpiente emplumada hecha de monitores CRT ----------
//   Cobra de cuello en S con capucha abierta, dos alas de plumas-monitor, medallones concéntricos en los flancos, patas de ave con garras
//   y la cola enroscada con un cascabel. Cada parte es un conjunto de monitores fusionados (cuerpo + pantalla) con su propio pivote.
//   Cuando el jugador no hace nada, la bestia se yergue, abre la capucha y las alas, y su voz se vuelve más grave y más larga.
const HG_CS = 3.0;                                                       // tamaño de celda (un monitor): pocos y grandes, no una masa
function hgCell(out, x, y, z, w, h, d, ry, rz, rx, rune) { out.push({ x, y, z, w, h, d, ry: ry || 0, rz: rz || 0, rx: rx || 0, rune: !!rune }); }
function hgSurf(out, x, y, z, n, w, h, d, rune) {                         // celda cuya pantalla mira hacia la normal n
  const l = Math.hypot(n[0], n[1], n[2]) || 1, nx = n[0] / l, ny = n[1] / l, nz = n[2] / l;
  hgCell(out, x, y, z, w, h, d, Math.atan2(nx, nz) + (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.05,
         -Math.asin(Math.max(-1, Math.min(1, ny))) + (Math.random() - 0.5) * 0.06, rune);
}
function hgShell(out, cx, cy, cz, w, h, d, faces, miss) {                // recubre las caras de una caja con monitores
  const cs = HG_CS, dep = cs * 0.75, ms = miss === undefined ? 0.03 : miss;
  const N = (a) => Math.max(1, Math.round(a / cs));
  const nxw = N(w), nyh = N(h), nzd = N(d);
  faces.forEach(f => {
    if (f === '+z' || f === '-z') {
      const s = f === '+z' ? 1 : -1;
      for (let i = 0; i < nxw; i++) for (let j = 0; j < nyh; j++) { if (Math.random() < ms) continue;
        hgSurf(out, cx - w / 2 + (i + 0.5) * w / nxw, cy - h / 2 + (j + 0.5) * h / nyh, cz + s * (d / 2 - dep / 2), [0, 0, s], w / nxw * 0.94, h / nyh * 0.9, dep); }
    } else if (f === '+x' || f === '-x') {
      const s = f === '+x' ? 1 : -1;
      for (let i = 0; i < nzd; i++) for (let j = 0; j < nyh; j++) { if (Math.random() < ms) continue;
        hgSurf(out, cx + s * (w / 2 - dep / 2), cy - h / 2 + (j + 0.5) * h / nyh, cz - d / 2 + (i + 0.5) * d / nzd, [s, 0, 0], d / nzd * 0.94, h / nyh * 0.9, dep); }
    } else if (f === '+y') {
      for (let i = 0; i < nxw; i++) for (let j = 0; j < nzd; j++) { if (Math.random() < ms) continue;
        hgSurf(out, cx - w / 2 + (i + 0.5) * w / nxw, cy + h / 2 - dep / 2, cz - d / 2 + (j + 0.5) * d / nzd, [0, 1, 0], w / nxw * 0.94, d / nzd * 0.9, dep); }
    }
  });
}
function hgDome(out, cx, cy, cz, Rx, Ry, Rz, phiMax, runeRings, miss) {       // caparazón: media elipsoide cubierta de monitores
  const cs = HG_CS, avg = (Rx + Rz) / 2, nR = Math.max(3, Math.round(phiMax * avg / cs)), arc = phiMax * avg / nR;
  for (let i = 0; i < nR; i++) {
    const phi = (i + 0.5) / nR * phiMax, sp = Math.sin(phi), cp = Math.cos(phi);
    const circ = 2 * Math.PI * sp * Math.sqrt((Rx * Rx + Rz * Rz) / 2), n = Math.max(1, Math.round(circ / cs));
    for (let j = 0; j < n; j++) {
      if (Math.random() < (miss === undefined ? 0.03 : miss)) continue;
      const th = (j + (i % 2) * 0.5) / n * Math.PI * 2, x = Rx * sp * Math.cos(th), y = Ry * cp, z = Rz * sp * Math.sin(th);
      const rune = runeRings.indexOf(i) >= 0 && (j % 5) < 3;           // franjas de runas que se encienden al escuchar
      hgSurf(out, cx + x, cy + y, cz + z, [x / (Rx * Rx), y / (Ry * Ry), z / (Rz * Rz)], Math.max(1.2, circ / n * 0.95), arc * 0.95, cs * 0.7, rune);
    }
  }
}
function hgSpike(out, x, y, z, dir, n, w, h, nrm) {                      // pila de monitores que se afina, como una espina de hueso
  for (let k = 0; k < n; k++) { const s = 1 - k * 0.14; hgSurf(out, x + dir[0] * k * h * 0.9, y + dir[1] * k * h * 0.9, z + dir[2] * k * h * 0.9, nrm, w * s, h * s, w * s, false); }
}
function hgPart(cells, pivot, parentPivot) {                             // fusiona celdas en 2 mallas y devuelve un Group con su pivote
  const body = { p: [], n: [], u: [], i: [], s: [] }, scr = { p: [], n: [], u: [], i: [], s: [] };
  cells.forEach(c => {
    const seed = c.rune ? 0.02 : 0.06 + Math.random() * 0.94, x = c.x - pivot[0], y = c.y - pivot[1], z = c.z - pivot[2];
    hgPush(body, hgBoxData(c.w, c.h, c.d), x, y, z, c.ry, c.rz, seed, c.rx);
    hgPush(scr, hgPlaneData(c.w * 0.8, c.h * 0.78, c.d / 2 + 0.02), x, y, z, c.ry, c.rz, seed, c.rx);
  });
  const g = new THREE.Group();
  const bm = new THREE.Mesh(hgToGeo(body), HG.bodyMat), sm = new THREE.Mesh(hgToGeo(scr), HG.screenMat);
  bm.frustumCulled = false; sm.frustumCulled = false;
  g.add(bm); g.add(sm);
  g.position.set(pivot[0] - parentPivot[0], pivot[1] - parentPivot[1], pivot[2] - parentPivot[2]);
  return g;
}

// Curva Catmull-Rom para el cuello y la cola, y una cadena de monitores que la recorre
function hgCR(P, u) {
  const n = P.length - 1, f = Math.min(n - 1e-6, Math.max(0, u * n)), i = Math.floor(f), t = f - i;
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)], t2 = t * t, t3 = t2 * t;
  return [0, 1, 2].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}
function hgChain(out, P, step, rad0, rad1, sides, size0, size1, runeEvery) {      // sides: F = frente/arriba, L/R = lados, A = lado alterno
  let len = 0, prev = hgCR(P, 0);
  for (let i = 1; i <= 40; i++) { const q = hgCR(P, i / 40); len += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]); prev = q; }
  const N = Math.max(2, Math.round(len / step));
  for (let i = 0; i <= N; i++) {
    const u = i / N, c = hgCR(P, u), a = hgCR(P, Math.max(0, u - 0.02)), b = hgCR(P, Math.min(1, u + 0.02));
    let T = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const tl = Math.hypot(T[0], T[1], T[2]) || 1; T = [T[0] / tl, T[1] / tl, T[2] / tl];
    const ref = Math.abs(T[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
    let S = [T[1] * ref[2] - T[2] * ref[1], T[2] * ref[0] - T[0] * ref[2], T[0] * ref[1] - T[1] * ref[0]];
    const sl = Math.hypot(S[0], S[1], S[2]) || 1; S = [S[0] / sl, S[1] / sl, S[2] / sl];
    const Fv = [S[1] * T[2] - S[2] * T[1], S[2] * T[0] - S[0] * T[2], S[0] * T[1] - S[1] * T[0]];
    const r = rad0 + (rad1 - rad0) * u, sz = size0 + (size1 - size0) * u, rune = !!runeEvery && (i % runeEvery === 0);
    for (let k = 0; k < sides.length; k++) {
      let ch = sides[k]; if (ch === 'A') ch = (i % 2 === 0) ? 'L' : 'R';
      const d = ch === 'F' ? Fv : (ch === 'L' ? [-S[0], -S[1], -S[2]] : S);
      hgSurf(out, c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r, d, sz, Math.max(sz * 0.9, step * 1.02), sz * 0.8, rune && ch === 'F');
    }
  }
  return hgCR(P, 1);
}
function hgFeather(out, x, y, z, dir, n, w, h, nrm) {                           // pluma: pila de monitores que se afina muy despacio
  for (let k = 0; k < n; k++) { const f = 1 - k * 0.075; hgSurf(out, x + dir[0] * k * h * 0.95, y + dir[1] * k * h * 0.95, z + dir[2] * k * h * 0.95, nrm, w * f, h * f, w * 0.6, false); }
}
function hgMedallion(out, s, D, my, mz) {                                       // discos concéntricos sobre el flanco (siguen la curva del cuerpo)
  const put = (dy, dz, w, rune) => {
    const ny = dy / D.Ry, nz = dz / D.Rz, q = 1 - ny * ny - nz * nz; if (q < 0.04) return;
    const x = s * D.Rx * Math.sqrt(q) * 1.03;
    hgSurf(out, D.cx + x, my + dy, D.cz + mz + dz, [x / (D.Rx * D.Rx), (my + dy - D.cy) / (D.Ry * D.Ry), (mz + dz) / (D.Rz * D.Rz)], w, w, 1.8, rune);
  };
  put(0, 0, 2.8, true);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; put(Math.cos(a) * 3.3, Math.sin(a) * 3.3, 2.3, k % 2 === 0); }
  for (let k = 0; k < 11; k++) { const a = k / 11 * Math.PI * 2 + 0.28; put(Math.cos(a) * 6.4, Math.sin(a) * 6.4, 2.1, false); }
}

// Plano de la serpiente: devuelve las partes como datos puros {cells, pivot, parent} (hgBuildColossus las convierte en mallas)
function hgSerpentSpec() {
  const FACES = ['+z', '-z', '+x', '-x'], RUNES = [1, 3], O = [0, 0, 0];
  const SP = {};

  // BASE (inmóvil): chatarra caída alrededor
  const base = [];
  for (let k = 0; k < 10; k++) {
    const sz = HG_CS * (0.5 + Math.random() * 0.5), a = Math.random() * 6.28, r = 16 + Math.random() * 24;
    hgCell(base, Math.cos(a) * r * 1.2, sz * 0.4, -8 + Math.sin(a) * r, sz * 1.1, sz * 0.85, sz * 0.7, Math.random() * 6.28, (Math.random() - 0.5) * 0.6, 0, false);
  }
  SP.base = { cells: base, pivot: O, parent: null };

  // CUERPO: huevo de monitores con runas y un medallón concéntrico en cada flanco (respira)
  const D = { cx: 0, cy: 15, cz: -6, Rx: 9.5, Ry: 9.5, Rz: 12 }, BODY_P = [0, 15, -6], MED = { y: 16, z: -5 };
  let bc = [];
  hgDome(bc, D.cx, D.cy, D.cz, D.Rx, D.Ry, D.Rz, 1.75, RUNES, 0.12);
  bc = bc.filter(c => !(Math.abs(c.x) > 4.5 && Math.hypot(c.y - MED.y, c.z - MED.z) < 7.8));
  [-1, 1].forEach(sd => hgMedallion(bc, sd, D, MED.y, MED.z));
  [-13, -6, 1].forEach((z, i) => {                                               // plumas dorsales
    const yt = D.cy + D.Ry * Math.sqrt(Math.max(0.05, 1 - Math.pow((z - D.cz) / D.Rz, 2)));
    hgSpike(bc, 0, yt + 0.6, z, [0, 1, -0.5], 2 + (i === 1 ? 1 : 0), 2.0, 2.8, [0, 0.4, 1]);
  });
  SP.body = { cells: bc, pivot: BODY_P, parent: 'root' };

  // CUELLO en S (cadena de monitores sobre una curva)
  const NECK_P = [0, 16, 3], nc = [];
  hgChain(nc, [[0, 16, 3], [0, 19.5, 8.5], [0, 26, 11], [0, 32.5, 10], [0, 38, 12.5], [0, 41.5, 15.5]], 3.0, 2.1, 1.7, 'FLR', 3.6, 3.0, 0);
  SP.neck = { cells: nc, pivot: NECK_P, parent: 'root' };

  // CABEZA de cobra: cráneo, hocico, cresta de plumas, cuernos, colmillos y órbitas huecas para los ojos
  const HEAD_P = [0, 43, 16];
  let hc = [];
  hgShell(hc, 0, 43.5, 19.5, 6, 5, 9, ['+z', '+x', '-x', '+y'], 0.0);
  hgShell(hc, 0, 42, 26, 4, 3, 5, ['+z', '+x', '-x', '+y'], 0.0);
  [-1, 0, 1].forEach(i => hgSpike(hc, i * 2.2, 46.4, 17.5, [i * 0.35, 0.8, -0.55], 3, 2.0, 2.8, [0, 0.5, 1]));
  [-1, 1].forEach(sd => hgSpike(hc, sd * 3.6, 44.5, 17, [sd * 0.9, 0.3, -0.5], 2, 1.8, 2.4, [sd, 0.3, 0.5]));
  [-1, 1].forEach(sd => hgSpike(hc, sd * 1.5, 40.4, 27.6, [0, -1, 0.15], 2, 1.2, 2.4, [0, 0, 1]));           // colmillos superiores
  hc = hc.filter(c => !(c.z > 20 && Math.abs(c.y - 44.4) < 1.6 && Math.abs(Math.abs(c.x) - 3) < 1.3));
  SP.head = { cells: hc, pivot: HEAD_P, parent: 'neck' };

  // MANDÍBULA (bisagra bajo el cráneo) con colmillos hacia arriba
  const JAW_P = [0, 41, 17], jc = [];
  hgShell(jc, 0, 40.2, 22.5, 4.2, 1.6, 9, ['+z', '-y', '+x', '-x'], 0.0);
  [-1, 1].forEach(sd => hgSpike(jc, sd * 1.4, 41.3, 26.8, [0, 1, 0.15], 2, 1.1, 2.2, [0, 0, 1]));
  SP.jaw = { cells: jc, pivot: JAW_P, parent: 'head' };

  // CAPUCHA de cobra: abanico de monitores tras la cabeza, con un ojo-sello de runas en el centro
  const HOOD_P = [0, 40, 13.2], hd = [], prof = [2, 3, 4, 3];
  for (let j = 0; j < 4; j++) for (let i = -prof[j]; i <= prof[j]; i++) {
    hgSurf(hd, i * 2.3, 38.5 + j * 2.9, 13.2 - Math.abs(i) * 0.5, [i * 0.22, 0.05, 1], 2.2, 2.7, 1.8, (j === 1 || j === 2) && Math.abs(i) <= 1 && ((i + j) % 2 === 0));
  }
  SP.hood = { cells: hd, pivot: HOOD_P, parent: 'head' };

  // PATAS de ave: muslo, caña, pie y tres garras
  [-1, 1].forEach(sd => {
    const lc = [];
    hgShell(lc, sd * 6.5, 9.5, 2, 4.2, 6, 4.2, ['+z', '+x', '-x'], 0.05);
    hgShell(lc, sd * 6.5, 4.5, 4.5, 3.2, 5, 3.2, ['+z', '+x', '-x'], 0.05);
    hgShell(lc, sd * 6.5, 1.2, 7, 6, 2.4, 6, ['+y', '+z'], 0.0);
    for (let k = -1; k <= 1; k++) hgSpike(lc, sd * 6.5 + k * 2.1, 1.0, 10.4, [k * 0.2, -0.1, 1], 2, 1.5, 2.4, [0, 0.4, 1]);
    SP['leg' + (sd > 0 ? 'R' : 'L')] = { cells: lc, pivot: [sd * 6.5, 12, 1], parent: 'root' };
  });

  // ALAS: hueso, coberteras y nueve plumas en abanico (las interiores caen, las exteriores apuntan hacia fuera y arriba)
  [-1, 1].forEach(sd => {
    const wc = [], SH = [sd * 7.5, 21, -3], WR = [sd * 21, 31, -5.5], LEN = [6, 7, 7, 7, 7, 6, 5];
    for (let k = 0; k <= 3; k++) {
      const u = k / 3;
      hgSurf(wc, SH[0] + (WR[0] - SH[0]) * u, SH[1] + (WR[1] - SH[1]) * u, SH[2] + (WR[2] - SH[2]) * u, [0, 1, 0.25], 3.8 - u * 0.8, 3.6, 2.4, k === 1 || k === 3);
    }
    for (let k = 0; k < 7; k++) {
      const u = 0.12 + 0.88 * k / 6, e = (-30 + 85 * k / 6) * Math.PI / 180;
      const ox = SH[0] + (WR[0] - SH[0]) * u, oy = SH[1] + (WR[1] - SH[1]) * u, oz = SH[2] + (WR[2] - SH[2]) * u;
      hgSurf(wc, ox, oy - 1.4, oz, [0, 1, 0.2], 3.8, 3.4, 2.0, false);
      hgFeather(wc, ox, oy - 3, oz - 2.2, [sd * Math.cos(e), Math.sin(e), -0.28 - 0.12 * Math.cos(e)], LEN[k], 3.4, 3.4, [0, 1, 0.3]);
    }
    SP['wing' + (sd > 0 ? 'R' : 'L')] = { cells: wc, pivot: SH, parent: 'root' };
  });

  // COLA enroscada en espiral con cascabel
  const TAIL_P = [0, 12, -16], tl = [], CX = 0, CZ = -31, tp = [[0, 12, -16], [0, 7.5, -18]];
  for (let k = 0; k <= 13; k++) {
    const t = k / 13, th = Math.PI / 2 + t * Math.PI * 2 * 1.3, r = 11 - 5.5 * t;
    tp.push([CX + Math.cos(th) * r, 2.6 + 3.4 * t, CZ + Math.sin(th) * r]);
  }
  const tipPt = tp[tp.length - 1]; tp.push([tipPt[0] * 0.9, tipPt[1] + 3.5, tipPt[2] * 0.97 + CZ * 0.03]);
  const tipEnd = hgChain(tl, tp, 3.2, 1.8, 1.2, 'FA', 3.7, 2.0, 0);
  SP.tail = { cells: tl, pivot: TAIL_P, parent: 'root' };
  const rc = [];
  for (let k = 0; k < 3; k++) hgSurf(rc, tipEnd[0], tipEnd[1] + 1.2 + k * 1.8, tipEnd[2], [0, 0.3, 1], 1.7 - k * 0.25, 1.9, 1.5, k === 2);
  SP.rattle = { cells: rc, pivot: [tipEnd[0], tipEnd[1], tipEnd[2]], parent: 'tail' };
  return SP;
}

function hgBuildColossus() {
  const cs = HG_CS;
  HG.bodyMat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0x5c635c) }, lightDir: { value: new THREE.Vector3(0.45, 0.5, 0.8).normalize() } },
    vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader
  });
  HG.screenMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCold: { value: 0 }, uCalm: { value: 0 }, uRune: { value: 0.25 } },
    vertexShader: `
      attribute float aSeed; varying vec2 vUv; varying float vSeed;
      void main() { vUv = uv; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uCold; uniform float uCalm; uniform float uRune; varying vec2 vUv; varying float vSeed;
      float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
      float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      void main() {
        vec2 e = min(vUv, 1.0 - vUv);
        if (vSeed < 0.05) {                                                       // RUNAS: luz fija y suave que crece al escuchar
          if (min(e.x, e.y) < 0.12) discard;
          float p = 0.5 + 0.5 * sin(uTime * 1.3 + vUv.x * 6.0 + vUv.y * 3.0);
          gl_FragColor = vec4(vec3(0.55, 0.78, 0.92) * (0.25 + uRune * (0.6 + 0.5 * p)), 1.0);
          return;
        }
        vec2 g = floor(vUv * vec2(7.0, 5.0));
        float tick = floor(uTime * (6.0 + uCold * 8.0) + vSeed * 40.0);
        float n = h21(g + vec2(tick, vSeed * 13.0));
        float scan = 0.65 + 0.35 * step(0.5, fract(vUv.y * 5.0 + uTime * 0.6 * (0.5 + uCold)));
        vec3 col = vec3(0.18, 0.22, 0.24) * (0.35 + 0.65 * n) * scan;
        float gl = h11(floor(uTime * (1.5 + uCold * 3.0) + vSeed * 91.0));
        float on = step(1.0 - (0.08 + 0.55 * uCold), gl) * (1.0 - uCalm);
        vec3 red = vec3(0.85, 0.18, 0.12) * (0.5 + 0.8 * h21(g * 1.7 + tick));
        col = mix(col, red, on * (0.55 + 0.45 * n));
        col += step(0.985, n) * vec3(0.5) * (0.4 + uCold) * (1.0 - uCalm);
        col = mix(col, vec3(0.55, 0.70, 0.80) * (0.55 + 0.35 * n), uCalm);
        vec2 q = floor(gl_FragCoord.xy / 2.0);
        float th = mod(q.x + 2.0 * mod(q.y, 2.0), 4.0) / 4.0;
        if (dot(col, vec3(0.33)) < th * 0.22) discard;
        if (min(e.x, e.y) < 0.05) discard;
        gl_FragColor = vec4(col * (0.8 + 0.8 * uCold), 1.0);
      }`
  });

  const root = new THREE.Group(), SP = hgSerpentSpec(), G = { root }, P = { root: [0, 0, 0] };
  ['base', 'body', 'neck', 'head', 'jaw', 'hood', 'legR', 'legL', 'wingR', 'wingL', 'tail', 'rattle'].forEach(k => {   // el orden garantiza que el padre exista
    const sp = SP[k], par = sp.parent ? sp.parent : 'root';
    G[k] = hgPart(sp.cells, sp.pivot, k === 'base' ? [0, 0, 0] : P[par]); P[k] = sp.pivot;
    (k === 'base' ? root : G[par]).add(G[k]);
  });
  HG.eyes = [-1, 1].map(sd => { const e = mkHalo(0xffa24d, 4.2, 0); e.position.set(sd * 3.3, 1.2, 3.8); G.head.add(e); return e; });
  HG.sigil = mkHalo(0xbfe6ff, 7, 0.1); HG.sigil.position.set(0, 9.8, -1.5); G.body.add(HG.sigil);   // sello luminoso sobre el lomo

  root.scale.setScalar(HG_COLOSSUS.scale);
  root.position.set(HG_COLOSSUS.x, 0, HG_COLOSSUS.z);
  root.rotation.y = HG_COLOSSUS.yaw;
  HG.colos = { root, body: G.body, neck: G.neck, head: G.head, jaw: G.jaw, hood: G.hood, wingR: G.wingR, wingL: G.wingL, tail: G.tail, rattle: G.rattle, legFR: G.legR, legFL: G.legL };
  return root;
}

// La serpiente respira, ondula el cuello y responde despacio al frío. Con la AMENAZA (el jugador no hace nada) se yergue,
// abre la capucha y las alas, entreabre la mandíbula y agita el cascabel.
function hgAnimateColossus(t, c, calm) {
  const C = HG.colos; if (!C) return;
  const sw = calm ? 0.2 : 1, g = HG.growlG || 0, m = HG.menaceP || 0, w = HG.calmV;
  C.root.scale.setScalar(HG_COLOSSUS.scale * (1 + 0.05 * m));
  C.body.scale.y = 1 + Math.sin(t * 0.5) * 0.008 * sw + g * 0.012 + m * 0.012 * Math.sin(t * 2.3) * sw;
  C.body.rotation.z = Math.sin(t * 0.21) * 0.012 * sw;
  C.neck.rotation.x = -0.04 - m * 0.17 + c * 0.05 + Math.sin(t * 0.4) * 0.025 * sw;
  C.neck.rotation.y = Math.sin(t * 0.23) * 0.10 * sw * (1 - m * 0.6) + Math.sin(t * 1.7) * 0.02 * m * sw;
  C.neck.rotation.z = Math.sin(t * 0.31 + 1) * 0.03 * sw;
  C.head.rotation.x = 0.06 + c * 0.20 + w * 0.10 + m * 0.24 + g * 0.10 + Math.sin(t * 0.45) * 0.012 * sw;
  C.head.rotation.y = Math.sin(t * 0.13) * 0.06 * sw;
  C.jaw.rotation.x = 0.04 + g * 0.55 + m * 0.20 + (m > 0.5 ? Math.sin(t * 9) * 0.03 * m * sw : 0);
  C.hood.scale.x = 1 + Math.sin(t * 0.6) * 0.05 * sw + m * 0.34 + g * 0.16;
  C.hood.scale.y = 1 + m * 0.10 + g * 0.05;
  const lift = 0.05 + Math.sin(t * 0.5) * 0.02 * sw + m * 0.5 + g * 0.22 + c * 0.1 - w * 0.08;
  C.wingR.rotation.z = lift; C.wingL.rotation.z = -lift;
  C.wingR.rotation.y = -m * 0.12 + Math.sin(t * 0.37) * 0.02 * sw; C.wingL.rotation.y = m * 0.12 - Math.sin(t * 0.37) * 0.02 * sw;
  C.tail.rotation.y = Math.sin(t * 0.35) * 0.04 * sw;
  C.rattle.rotation.z = calm ? 0 : Math.sin(t * 41) * 0.16 * m * m;
  C.rattle.rotation.x = calm ? 0 : Math.sin(t * 37 + 1) * 0.12 * m * m;
  C.legFR.rotation.x = -(0.03 + c * 0.3 + m * 0.10) + Math.sin(t * 0.6) * 0.01 * sw;
  C.legFL.rotation.x = -(0.02 + c * 0.10 + m * 0.05);
}

// ---------- Suelo: retícula isométrica punteada, una pequeña isla que se desvanece en el negro ----------
function hgBuildGround() {
  const pts = [], seeds = [], S = 1.6, R = 46, N = Math.ceil(R / S), cx = HG_ISO.target.x, cz = HG_ISO.target.z;
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
    const x = cx + i * S, z = cz + j * S;
    if (Math.hypot(x - cx, z - cz) > R) continue;
    pts.push(x, 0, z); seeds.push(Math.random());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seeds), 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHeat: { value: 0.7 }, uCold: { value: 0 }, uScale: GLOW_SCALE, uFire: { value: HG.fire.clone() }, uCenter: { value: HG_ISO.target.clone() }, uR: { value: R } },
    vertexShader: `
      attribute float aSeed; uniform float uTime; uniform float uHeat; uniform float uCold; uniform float uScale; uniform float uR;
      uniform vec3 uFire; uniform vec3 uCenter; varying float vA; varying vec3 vC;
      void main() {
        vec3 p = position;
        float dF = distance(p.xz, uFire.xz);
        p.y += sin(p.x * 0.45 + uTime * 0.7) * cos(p.z * 0.4 + uTime * 0.5) * 0.35 * uCold * smoothstep(8.0, 30.0, dF);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float warm = smoothstep(9.0, 0.0, dF) * uHeat;
        vC = mix(vec3(0.37, 0.66, 0.42), vec3(1.0, 0.55, 0.22), warm);
        float fade = smoothstep(uR, uR * 0.45, distance(p.xz, uCenter.xz));
        float tw = 0.75 + 0.25 * sin(uTime * 1.3 + aSeed * 20.0);
        vA = (0.42 + warm * 0.55 + 0.1 * uCold) * fade * tw;
        gl_PointSize = (0.16 + warm * 0.14) * uScale / max(0.1, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA; varying vec3 vC;
      void main() { float d = length(gl_PointCoord - vec2(0.5)); float a = smoothstep(0.5, 0.25, d); gl_FragColor = vec4(vC, a * vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false;
  HG.ground = p;
  return p;
}

// ---------- Atmósfera: bruma baja y nieve de datos que caen dentro de la maqueta ----------
function hgBuildSky() {
  const sky = new THREE.Group();
  const FN = 140, fg = mkGlowPoints(FN), fa = fg.geometry.attributes, fv = new Float32Array(FN), fbase = new Float32Array(FN), fph = new Float32Array(FN);
  for (let i = 0; i < FN; i++) {
    const camp = i > 90;                                                        // unas pocas sobre el campamento, el resto al pie del Coloso
    fa.position.array[i * 3] = camp ? -6 + Math.random() * 14 : -52 + Math.random() * 30;
    fa.position.array[i * 3 + 1] = 0.3 + Math.random() * (camp ? 1.2 : 2.5);
    fa.position.array[i * 3 + 2] = camp ? -5 + Math.random() * 13 : -8 + Math.random() * 28;
    _fxc.setHex(Math.random() > 0.4 ? 0x9fb4c8 : PAL.ash);
    fa.aCol.array[i * 3] = _fxc.r; fa.aCol.array[i * 3 + 1] = _fxc.g; fa.aCol.array[i * 3 + 2] = _fxc.b;
    fa.aSize.array[i] = camp ? 2.0 + Math.random() * 2 : 3.0 + Math.random() * 3;
    fv[i] = 0.25 + Math.random() * 0.5; fbase[i] = 0.05 + Math.random() * 0.05; fph[i] = Math.random() * 6.28;
  }
  HG.fog = { pts: fg, v: fv, base: fbase, ph: fph };
  sky.add(fg);
  const SN = 200, sn = mkGlowPoints(SN), sa = sn.geometry.attributes, sv = new Float32Array(SN), sph = new Float32Array(SN);
  for (let i = 0; i < SN; i++) {
    sa.position.array[i * 3] = -50 + Math.random() * 70; sa.position.array[i * 3 + 1] = Math.random() * 30; sa.position.array[i * 3 + 2] = -28 + Math.random() * 56;
    _fxc.setHex(Math.random() > 0.5 ? PAL.bone : PAL.mist);
    sa.aCol.array[i * 3] = _fxc.r; sa.aCol.array[i * 3 + 1] = _fxc.g; sa.aCol.array[i * 3 + 2] = _fxc.b;
    sa.aSize.array[i] = 0.14 + Math.random() * 0.16; sa.aAlpha.array[i] = 0.3 + Math.random() * 0.35;
    sv[i] = 0.35 + Math.random() * 0.6; sph[i] = Math.random() * 6.28;
  }
  HG.snow = { pts: sn, v: sv, ph: sph };
  sky.add(sn);
  return sky;
}
function hgUpdateAtmos(dt, t, calm) {
  const F = HG.fog, fp = F.pts.geometry.attributes.position.array, fal = F.pts.geometry.attributes.aAlpha.array, k = 0.7 + 0.9 * HG.coldS;
  for (let i = 0; i < F.v.length; i++) {
    if (!calm) fp[i * 3] += F.v[i] * dt;
    if (fp[i * 3] > 24) fp[i * 3] = -54;
    fal[i] = F.base[i] * k * (0.7 + 0.3 * Math.sin(t * 0.3 + F.ph[i]));
  }
  F.pts.geometry.attributes.position.needsUpdate = true; F.pts.geometry.attributes.aAlpha.needsUpdate = true;
  const N = HG.snow, np = N.pts.geometry.attributes.position.array;
  for (let i = 0; i < N.v.length; i++) {
    np[i * 3 + 1] -= N.v[i] * dt * (calm ? 0.3 : 1);
    np[i * 3] += Math.sin(t * 0.5 + N.ph[i]) * 0.2 * dt;
    if (np[i * 3 + 1] < 0) np[i * 3 + 1] = 30;
  }
  N.pts.geometry.attributes.position.needsUpdate = true;
}

function hgBuildFire() {
  const f = new THREE.Group();
  const mkM = (hex) => new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(hex) }, lightDir: { value: new THREE.Vector3(0, 1, 0.3).normalize() } }, vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 5), mkM(0xff7a30)); cone.position.y = 0.35; f.add(cone);
  [0, 1.05, 2.1].forEach(a => { const l = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.14, 0.14), mkM(0x6b3a22)); l.position.y = 0.09; l.rotation.y = a; f.add(l); });
  HG.fireHalo = mkHalo(0xff8a3d, 3, 0.4); HG.fireHalo.position.y = 0.9; f.add(HG.fireHalo);
  HG.glowDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xff7a30, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
  HG.glowDisc.rotation.x = -Math.PI / 2; HG.glowDisc.position.y = 0.04; f.add(HG.glowDisc);
  f.position.set(HG.fire.x, 0, HG.fire.z);
  return f;
}

function hgAddPets() {
  // Las plantillas de los gatos son enormes respecto al Viajero: se miden y se reescalan a un tamaño pequeño (< Viajero ≈ 2.2)
  const meshBox = (o) => {
    const box = new THREE.Box3(); o.updateMatrixWorld(true);
    o.traverse(c => { if (c.isMesh && c.geometry) { if (!c.geometry.boundingBox) c.geometry.computeBoundingBox(); box.union(c.geometry.boundingBox.clone().applyMatrix4(c.matrixWorld)); } });
    return box;
  };
  const mk = (tpl, x, z, ry, lay, target) => {
    if (!tpl) return;
    const o = tpl.clone(); o.userData = {};
    o.traverse(c => { if (c.isSprite) c.visible = false; });                      // sin rótulos: a esta escala serían ruido
    o.position.set(0, 0, 0); o.rotation.set(0, ry, lay); o.visible = true;
    let box = meshBox(o); const size = box.getSize(new THREE.Vector3());
    const s = target / Math.max(size.x, size.y, size.z, 1e-6);
    o.scale.multiplyScalar(s);
    box = meshBox(o);
    o.position.set(x, -box.min.y + 0.02, z);                                       // apoyado en el suelo
    o.userData.ph = Math.random() * 6; o.userData.kind = HG.pets.length;
    scene.add(o); HG.pets.push(o);                                                 // comparten geometría con la plantilla: NO se liberan
  };
  mk(chaplinModelTemplate, 2.7, 1.2, -0.6, 1.25, 1.3);                            // un poco más grandes que antes, sin pasar la altura del Viajero
  mk(gamberModelTemplate, 0.1, 2.4, 0.9, -1.25, 1.1);
}

// ---------- Cámara del jugador: girar alrededor de la maqueta (distancia fija) y zoom ----------
//   Arrastrar sobre el espacio vacío gira la escena (con inercia) y la inclina un poco; la distancia NO cambia al girar.
//   Pellizco (móvil) o rueda (escritorio) acercan y alejan dentro de un rango acotado. Flechas / +,- como alternativa de teclado.
//   Un toque corto (sin arrastre) sigue siendo un toque: un gato maúlla o el Coloso gruñe.
const HG_CAM = { yaw: 0, yawT: 0, yawV: 0, pit: 0, pitT: 0, zoom: 1, zoomT: 1, ptrs: new Map(), pinchD: 0, tapOK: true, moved: 0, t0: 0, bound: false, fns: null, saved: null };
const HG_ZOOM = [0.55, 1.4], HG_PITCH = [-0.3, 0.5];
function hgCamReset() { const C = HG_CAM; C.yaw = C.yawT = C.yawV = C.pit = C.pitT = 0; C.zoom = C.zoomT = 1; C.ptrs.clear(); C.pinchD = 0; C.tapOK = true; C.moved = 0; }
function hgCamClampZ(z) { return Math.max(HG_ZOOM[0], Math.min(HG_ZOOM[1], z)); }
function hgCamBind() {
  const C = HG_CAM; if (C.bound || typeof window.addEventListener !== 'function') return;
  const skip = (e) => !window.isHogueraActive || window.isMiniIntro || (e.target && e.target.closest && e.target.closest('button, a, input, textarea'));
  const down = (e) => {
    if (skip(e) || HG.chips.some(c => c.state === 'drag')) return;
    C.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (C.ptrs.size === 1) { C.tapOK = true; C.moved = 0; C.t0 = performance.now(); C.yawV = 0; }
    else { C.tapOK = false; const p = [...C.ptrs.values()]; C.pinchD = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
  };
  const move = (e) => {
    const p = C.ptrs.get(e.pointerId); if (!p || !window.isHogueraActive) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (C.ptrs.size >= 2) {
      const q = [...C.ptrs.values()], d = Math.hypot(q[0].x - q[1].x, q[0].y - q[1].y);
      if (C.pinchD > 1 && d > 1) C.zoomT = hgCamClampZ(C.zoomT * (C.pinchD / d));
      C.pinchD = d; return;
    }
    C.moved += Math.abs(dx) + Math.abs(dy);
    if (C.moved < 8) return;                                                       // todavía es un toque
    const k = 5.2 / Math.max(320, window.innerWidth);
    C.yawT -= dx * k * 1.1; C.pitT = Math.max(HG_PITCH[0], Math.min(HG_PITCH[1], C.pitT + dy * k * 0.5));
    C.yawV = -dx * k * 1.1 * 40 * 0.5 + C.yawV * 0.5;
  };
  const up = (e) => {
    if (!C.ptrs.has(e.pointerId)) return;
    const was = C.ptrs.size; C.ptrs.delete(e.pointerId);
    if (was === 1 && C.tapOK && C.moved < 8 && performance.now() - C.t0 < 500 && e.type === 'pointerup' && window.hgTap) window.hgTap(e.clientX, e.clientY);
    if (C.ptrs.size === 0) { C.tapOK = true; C.yawV = Math.max(-2.5, Math.min(2.5, C.yawV)); if (C.moved < 8) C.yawV = 0; }
  };
  const wheel = (e) => { if (skip(e)) return; e.preventDefault(); C.zoomT = hgCamClampZ(C.zoomT * Math.exp(e.deltaY * 0.0012)); };
  const key = (e) => {
    if (!window.isHogueraActive || window.isMiniIntro) return;
    if (e.key === 'ArrowLeft') C.yawT += 0.09; else if (e.key === 'ArrowRight') C.yawT -= 0.09;
    else if (e.key === 'ArrowUp') C.pitT = Math.min(HG_PITCH[1], C.pitT + 0.05); else if (e.key === 'ArrowDown') C.pitT = Math.max(HG_PITCH[0], C.pitT - 0.05);
    else if (e.key === '+' || e.key === '=') C.zoomT = hgCamClampZ(C.zoomT * 0.92); else if (e.key === '-' || e.key === '_') C.zoomT = hgCamClampZ(C.zoomT / 0.92);
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  };
  const tm = (e) => { if (window.isHogueraActive && !window.isMiniIntro && e.touches && e.touches.length >= 2) e.preventDefault(); };   // sin pellizco de página
  const gs = (e) => { if (window.isHogueraActive) e.preventDefault(); };                  // Safari iOS: gesto de zoom de página
  C.fns = { down, move, up, wheel, key, tm, gs };
  window.addEventListener('pointerdown', down); window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  window.addEventListener('wheel', wheel, { passive: false }); window.addEventListener('keydown', key, true);
  window.addEventListener('touchmove', tm, { passive: false }); window.addEventListener('gesturestart', gs, { passive: false });
  try { C.saved = { ta: document.body.style.touchAction, ob: document.documentElement.style.overscrollBehavior }; document.body.style.touchAction = 'none'; document.documentElement.style.overscrollBehavior = 'none'; } catch (x) {}
  C.bound = true;
}
function hgCamUnbind() {
  const C = HG_CAM; if (!C.bound) return;
  const f = C.fns;
  window.removeEventListener('pointerdown', f.down); window.removeEventListener('pointermove', f.move);
  window.removeEventListener('pointerup', f.up); window.removeEventListener('pointercancel', f.up);
  window.removeEventListener('wheel', f.wheel); window.removeEventListener('keydown', f.key, true);
  window.removeEventListener('touchmove', f.tm); window.removeEventListener('gesturestart', f.gs);
  try { if (C.saved) { document.body.style.touchAction = C.saved.ta || ''; document.documentElement.style.overscrollBehavior = C.saved.ob || ''; } } catch (x) {}
  C.bound = false; C.fns = null; C.ptrs.clear();
}

// ---------- Sonido: el frío es un zumbido grave; el fuego, una brasa que cruje ----------
function hgToneStart() {
  if (!MGS.ok()) return;
  try {
    const ctx = audioCtx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(1, t + 2.5); out.connect(masterGain);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.connect(out);
    const mk = (f, dest, type) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type || 'sine'; o.frequency.value = f; g.gain.value = 0; o.connect(g); g.connect(dest); o.start(); return { o, g }; };
    const c1 = mk(55, lp), c2 = mk(55 * 1.006, lp), c3 = mk(82.41, lp);
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 130; lp2.Q.value = 4; lp2.connect(out);
    const d1 = mk(41.2, lp2, 'sawtooth'), d2 = mk(43.65, lp2, 'sawtooth');            // un semitono: batido áspero que anuncia la amenaza
    const w1 = mk(261.63, out), w2 = mk(392, out);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const purr = [0, 1].map(i => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 140 + i * 30; lpf.Q.value = 1;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 23 + i * 2.5;            // el pulso del ronroneo
      const ld = ctx.createGain(); ld.gain.value = 0; lfo.connect(ld); ld.connect(g.gain);
      src.connect(lpf); lpf.connect(g); g.connect(out); src.start(); lfo.start();
      return { src, g, ld, lfo };
    });
    HG.tone = { ctx, out, lp, c1, c2, c3, d1, d2, w1, w2, noise: buf, purr };
  } catch (e) { HG.tone = null; }
}
function hgToneUpdate(heat, cold, menace) {
  const T = HG.tone; if (!T) return;
  try {
    const t = T.ctx.currentTime;
    T.c1.g.gain.setTargetAtTime(0.02 + cold * 0.04, t, 0.3);
    T.c2.g.gain.setTargetAtTime(0.02 + cold * 0.04, t, 0.3);
    T.c3.g.gain.setTargetAtTime(cold * 0.03, t, 0.3);
    const mn = menace || 0;
    T.lp.frequency.setTargetAtTime(160 + cold * 260 + mn * 180, t, 0.3);
    T.d1.g.gain.setTargetAtTime(mn * mn * 0.05, t, 0.6);
    T.d2.g.gain.setTargetAtTime(mn * mn * 0.045, t, 0.6);
    T.w1.g.gain.setTargetAtTime(heat * 0.014 * (1 - mn * 0.7), t, 0.3);
    T.w2.g.gain.setTargetAtTime(heat * heat * 0.010, t, 0.3);
    const pr = HG.phase === 'out' ? 0 : Math.min(0.4, heat * 0.4);                    // los gatos ronronean con el calor y callan sin fuego
    T.purr.forEach(p => { p.g.gain.setTargetAtTime(pr * 0.5, t, 0.4); p.ld.gain.setTargetAtTime(pr * 0.5, t, 0.4); });
    if (!isSoundEnabled) T.out.gain.setTargetAtTime(0, t, 0.1);
  } catch (e) {}
}
function hgToneStop() {
  const T = HG.tone; if (!T) return;
  HG.tone = null;
  try {
    const t = T.ctx.currentTime;
    T.out.gain.cancelScheduledValues(t); T.out.gain.setTargetAtTime(0, t, 0.35);
    [T.c1, T.c2, T.c3, T.d1, T.d2, T.w1, T.w2].forEach(v => v.o.stop(t + 2.2));
    T.purr.forEach(p => { p.src.stop(t + 2.2); p.lfo.stop(t + 2.2); });
  } catch (e) {}
}
function hgNoise(kind, vol, freq, dur) {
  const T = HG.tone; if (!T || !MGS.ok()) return;
  try {
    const ctx = T.ctx, t = ctx.currentTime, src = ctx.createBufferSource();
    src.buffer = T.noise;
    const f = ctx.createBiquadFilter(); f.type = kind; f.frequency.value = freq; f.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(masterGain);
    src.start(t, Math.random() * 1.4); src.stop(t + dur + 0.05);
  } catch (e) {}
}

// ---------- Ofrendas: tus propios puntos, arrastrables y lanzables ----------
const HG_CHIP_W = 116, HG_CHIP_H = 52;
function hgChipValue(kind) {
  if (kind === 'score') return String(score);
  if (kind === 'combo') return 'x' + combatCombo;
  return HG.files + ' / 13';
}
function hgMakeChip(kind, label, root) {
  const el = document.createElement('div');
  el.style.cssText = `position:absolute; left:0; top:0; width:${HG_CHIP_W}px; height:${HG_CHIP_H}px; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; ` +
    'border:1px solid rgba(231,228,222,0.28); background:rgba(10,10,12,0.5); backdrop-filter:blur(8px); pointer-events:auto; touch-action:none; cursor:grab; user-select:none; will-change:transform; transition:opacity .6s;';
  const l = document.createElement('div'); l.textContent = label;
  l.style.cssText = 'font-size:0.55rem; font-weight:300; letter-spacing:0.32em; color:#8a867f;';
  const v = document.createElement('div');
  v.style.cssText = 'font-size:1.05rem; font-weight:300; letter-spacing:0.12em; color:#e7e4de;';
  el.appendChild(l); el.appendChild(v); root.appendChild(el);
  const c = { kind, el, valEl: v, w: HG_CHIP_W, h: HG_CHIP_H, state: 'idle', pos: { x: -999, y: -999 }, slot: { x: 0, y: 0 }, target: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, rot: 0, hist: [], burnT: 0, cool: 0 };
  v.textContent = hgChipValue(kind);
  ['mousedown', 'touchstart'].forEach(ev => el.addEventListener(ev, (e) => e.stopPropagation()));
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); hgChipDown(c, e.clientX, e.clientY); try { el.setPointerCapture(e.pointerId); } catch (x) {} });
  el.addEventListener('pointermove', (e) => hgChipMove(c, e.clientX, e.clientY));
  el.addEventListener('pointerup', () => hgChipUp(c));
  el.addEventListener('pointercancel', () => hgChipUp(c));
  return c;
}
function hgChipDown(c, x, y) {
  if (HG.phase === 'won' || (c.state !== 'idle' && c.state !== 'return')) return;
  HG.idleT = 0;
  c.state = 'drag'; c.target.x = x; c.target.y = y; c.hist = [{ x, y, t: performance.now() }];
  c.el.style.cursor = 'grabbing'; c.el.style.zIndex = 5;
  MGS.bell(880, 0, 0.5, 0.012);
}
function hgChipMove(c, x, y) {
  if (c.state !== 'drag') return;
  c.target.x = x; c.target.y = y;
  const now = performance.now();
  c.hist.push({ x, y, t: now });
  while (c.hist.length > 2 && now - c.hist[0].t > 110) c.hist.shift();
}
function hgChipUp(c) {
  if (c.state !== 'drag') return;
  c.el.style.cursor = 'grab'; c.el.style.zIndex = '';
  const R = 84 * Math.min(1.3, Math.max(0.7, window.innerHeight / 800));
  const fx = HG.fireScreen.x, fy = HG.fireScreen.y;
  if (Math.hypot(c.pos.x - fx, c.pos.y - fy) < R * 1.1 || Math.hypot(c.target.x - fx, c.target.y - fy) < R * 0.8) { hgBurn(c); return; }
  const a = c.hist[0], b = c.hist[c.hist.length - 1], dt = Math.max(0.016, (b.t - a.t) / 1000);
  let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
  const sp = Math.hypot(vx, vy);
  if (sp > 1800) { vx *= 1800 / sp; vy *= 1800 / sp; }
  if (sp < 150) { c.state = 'return'; return; }
  c.vel.x = vx; c.vel.y = vy; c.state = 'fly';
  MGS.bell(1318.5, 0, 0.4, 0.014);
}

function hgBurn(c) {
  const en = MG.isEN();
  HG.idleT = 0;
  c.state = 'burn'; c.burnT = 0;
  let fuel = 0.16;
  if (c.kind === 'score') {
    const v = score; fuel += 0.14 * Math.min(1, v / 300); HG.discarded += v;
    score = 0; const el = document.getElementById('score-value'); if (el) el.innerText = 0;
  } else if (c.kind === 'combo') {
    const v = combatCombo; fuel += 0.10 * Math.min(1, v / 10); HG.discarded += v;
    combatCombo = 0; clearTimeout(comboTimer);
  } else {
    fuel += 0.04 * Math.min(1, HG.files / 13);
    if (!HG.filesNote) { HG.filesNote = true; showSystemToast(en ? 'Files do not burn. They are remembered.' : 'Los archivos no se queman. Se recuerdan.', '#e7e4de'); }
  }
  HG.heat = Math.min(1, HG.heat + fuel);
  if (HG.phase === 'out') hgRelight();
  const f = HG.fire;
  HG.fx.burst(f.x, f.y - 0.3, f.z, 40, 3.2, 1.6, 0xffb066, 0.26 * HG_FS, 0.9);
  HG.fx.burst(f.x, f.y - 0.3, f.z, 18, 2.2, 1.4, 0xe0482e, 0.3 * HG_FS, 0.9);
  MG.pulse(f.x, 0.05, 0xff8a3d, 0.5, 4.5, 1.2, 0.5, f.z);   // onda sobre el suelo
  hgNoise('lowpass', 0.07, 900, 0.5);
  MGS.bell(MGS.NOTES[0] / 2, 0, 2.6, 0.05);
  MGS.bell(MGS.NOTES[3] / 2, 0.1, 2.2, 0.03);
  vibrateDevice(25);
}

// ---------- Voces: el Coloso gruñe; los gatos maúllan y ronronean ----------
//   Gruñido: una sierra grave que desciende (64→36 Hz) con un sub, modulada en amplitud a ~20 Hz (el "gruñir"), filtrada
//   hacia lo oscuro y con ráfagas de estática de CRT. 'idle' = de vez en cuando; 'click' = al tocarlo; 'angry' = si el fuego muere;
//   'sigh' = un largo suspiro al terminar. Cada gruñido también mueve la cabeza, enciende los ojos y suelta aliento de ceniza.
function hgGrowl(kind) {
  const calm = reduceMotionMQ.matches;
  const menace = kind === 'menace';
  const loud = menace ? 1.5 : kind === 'click' ? 1 : kind === 'angry' ? 1.2 : kind === 'sigh' ? 0.5 : 0.7;
  const dur = menace ? 3.6 + Math.random() * 1.4 : kind === 'click' ? 2.2 : kind === 'angry' ? 2.8 : kind === 'sigh' ? 3.2 : 1.8 + Math.random();
  HG.growlP = 0; HG.growlAmp = loud; HG.growlDur = dur;
  if (HG.colos && HG.fx) {
    _hgV.set(0, -3, 10); HG.colos.head.localToWorld(_hgV);
    HG.fx.burst(_hgV.x, _hgV.y, _hgV.z, kind === 'sigh' ? 10 : menace ? 34 : 18, menace ? 2.4 : 1.6, 2.0, menace ? 0x7a828c : 0x59616b, 0.32, 0.5);        // aliento de ceniza
    if (kind === 'click' || kind === 'angry' || menace) MG.pulse(HG_COLOSSUS.x, 0.05, 0xd64a3a, 2, 16, 1.8, 0.35, HG_COLOSSUS.z);   // onda sobre el suelo
  }
  if (!calm && (kind === 'click' || kind === 'angry' || menace)) { shakeIntensity = Math.max(shakeIntensity, menace ? 0.16 : 0.1); HG.flashV = Math.max(HG.flashV, menace ? 0.8 : 0.5); }
  if (menace) { hgHiss(); setTimeout(() => hgRattle(1), 500); }
  if (!MGS.ok()) return;
  try {
    const ctx = audioCtx, t = ctx.currentTime, sigh = kind === 'sigh';
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime((menace ? 0.10 : 0.11) * loud, t + (sigh ? 0.9 : menace ? 0.5 : 0.25));
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(sigh ? 180 : 280, t); lp.frequency.exponentialRampToValueAtTime(100, t + dur);
    lp.connect(out); out.connect(masterGain);
    let dst = lp;
    if (menace) {                                                                  // saturación: la voz se vuelve áspera y dentada
      const sh = ctx.createWaveShaper(), cv = new Float32Array(256);
      for (let i = 0; i < 256; i++) cv[i] = Math.tanh((i / 255 * 2 - 1) * 3.4);
      sh.curve = cv; sh.connect(lp); dst = sh;
      lp.frequency.cancelScheduledValues(t); lp.frequency.setValueAtTime(420, t); lp.frequency.exponentialRampToValueAtTime(90, t + dur);
    }
    const f0 = sigh ? 78 : menace ? 50 + Math.random() * 8 : 64 + Math.random() * 12, f1 = sigh ? 44 : menace ? 22 : 36, ends = t + dur + 0.1;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(f0, t); o1.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const am = ctx.createGain(); am.gain.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = menace ? 26 + Math.random() * 8 : 17 + Math.random() * 9;
    if (menace) lfo.frequency.linearRampToValueAtTime(11, t + dur);               // el gruñido se arrastra y se vuelve más lento
    const lg = ctx.createGain(); lg.gain.value = sigh ? 0 : menace ? 0.6 : 0.45; lfo.connect(lg); lg.connect(am.gain);
    o1.connect(am); am.connect(dst);
    const o2 = ctx.createOscillator(); o2.type = 'sine';
    o2.frequency.setValueAtTime(f0 / 2, t); o2.frequency.exponentialRampToValueAtTime(f1 / 2, t + dur);
    const g2 = ctx.createGain(); g2.gain.value = 0.8; o2.connect(g2); g2.connect(menace ? dst : lp);
    [o1, o2, lfo].forEach(o => { o.start(t); o.stop(ends); });
    if (menace) {                                                                  // segunda garganta desafinada: batido que hace temblar el pecho
      const o4 = ctx.createOscillator(); o4.type = 'sawtooth';
      o4.frequency.setValueAtTime(f0 * 1.013, t); o4.frequency.exponentialRampToValueAtTime(f1 * 1.013, t + dur);
      const g4 = ctx.createGain(); g4.gain.value = 0.5; o4.connect(g4); g4.connect(dst); o4.start(t); o4.stop(ends);
    }
    if (loud >= 1) {                                                              // rugido: una voz más áspera por encima
      const o3 = ctx.createOscillator(); o3.type = 'square';
      o3.frequency.setValueAtTime(f0 * 1.8, t); o3.frequency.exponentialRampToValueAtTime(f1 * 1.6, t + dur);
      const g3 = ctx.createGain(); g3.gain.value = 0.12; o3.connect(g3); g3.connect(dst); o3.start(t); o3.stop(ends);
    }
  } catch (e) {}
  for (let i = 0; i < (menace ? 10 : 5); i++) setTimeout(() => hgNoise('bandpass', 0.012 * loud, 1400 + Math.random() * 2600, 0.06), Math.random() * dur * 700);   // estática de CRT
}
// Siseo de cobra: ráfaga de aire agudo que se abre y se cierra
function hgHiss() {
  hgNoise('highpass', 0.045, 4200, 1.5);
  setTimeout(() => hgNoise('bandpass', 0.035, 6800, 1.1), 120);
}
// Cascabel de la cola: una ráfaga de chasquidos secos que se acelera
function hgRattle(amt) {
  const n = Math.round(16 + 12 * amt);
  let at = 0;
  for (let i = 0; i < n; i++) { at += 46 - 22 * (i / n) + Math.random() * 10; setTimeout(() => hgNoise('bandpass', 0.016 + 0.014 * amt, 4300 + Math.random() * 1800, 0.028), at); }
  if (HG.colos && HG.fx) { _hgV.set(0, 3, 0); HG.colos.rattle.localToWorld(_hgV); HG.fx.burst(_hgV.x, _hgV.y, _hgV.z, 8, 0.9, 1.2, 0x9aa3ad, 0.16, 0.5); }
}

function hgMeow(idx, loud) {                                                      // 0 = Chaplin (grave, largo), 1 = Gamber (agudo, corto)
  const p = HG.pets[idx]; if (!p) return;
  p.userData.pulse = 1;
  if (HG.fx) HG.fx.burst(p.position.x, p.position.y + 0.6, p.position.z, 8, 0.8, 1.4, 0xffd08a, 0.18, 0.8);
  if (!MGS.ok()) return;
  try {
    const ctx = audioCtx, t = ctx.currentTime, dur = idx === 0 ? 0.8 : 0.55, base = idx === 0 ? 430 : 560, v = loud ? 0.05 : 0.03;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 0.85, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.7, t + dur * 0.25);
    o.frequency.exponentialRampToValueAtTime(base * 0.95, t + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = 6.5;
    const vg = ctx.createGain(); vg.gain.value = 9; vib.connect(vg); vg.connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2.5;      // la "a" del maullido: una formante que sube y baja
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(1900, t + dur * 0.3); f.frequency.exponentialRampToValueAtTime(1000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.06); g.gain.setValueAtTime(v, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(masterGain);
    [o, vib].forEach(n => { n.start(t); n.stop(t + dur + 0.05); });
  } catch (e) {}
}

window.hgTap = function(cx, cy) {                                                 // toque en la escena: un gato maúlla, el Coloso gruñe
  if (!window.isHogueraActive || window.isMiniIntro || !HG.colos) return;
  HG.idleT = 0;
  const W = window.innerWidth, H = window.innerHeight;
  let best = -1, bd = 1e9;
  HG.pets.forEach((p, i) => {                                                     // gatos: por cercanía en pantalla (son diminutos)
    _hgV.set(p.position.x, p.position.y + 0.4, p.position.z).project(camera);
    const d = Math.hypot((_hgV.x + 1) / 2 * W - cx, (1 - _hgV.y) / 2 * H - cy);
    if (d < bd) { bd = d; best = i; }
  });
  if (best >= 0 && bd < 42 * Math.min(1.3, Math.max(0.7, H / 800))) { hgMeow(best, true); return; }
  if (HG.growlP < 0.5) return;                                                    // no encadenar gruñidos
  MG.setPointer(cx, cy);
  dragRaycaster.setFromCamera(mouseNDC, camera);
  if (dragRaycaster.intersectObjects([HG.colos.root], true).length) hgGrowl('click');
};

function hgFireOut() {
  const en = MG.isEN();
  HG.phase = 'out'; HG.outT = 3.5;
  MGS.knock();
  hgGrowl('angry');
  setTimeout(() => hgMeow(0, true), 600); setTimeout(() => hgMeow(1, true), 1300);          // los gatos se inquietan
  HG.fx.burst(HG.fire.x, HG.fire.y, HG.fire.z, 30, 1.2, 2.4, 0x8a867f, 0.4 * HG_FS, 0.5);
  showSystemToast(en ? 'The fire goes out. The cold listens.' : 'El fuego se apaga. El frío escucha.', '#e7e4de');
}
function hgRelight() {
  const en = MG.isEN();
  HG.phase = 'play'; HG.heat = Math.max(HG.heat, 0.35); HG.listen = Math.max(0, HG.listen - 0.2);
  MGS.arpeggio([0, 2], 0.18, 2.2, 0.04);
  showSystemToast(en ? 'A spark returns.' : 'Una chispa vuelve.', '#e7e4de');
}

function hgSub(text) {
  const el = HG.els.sub; if (!el) return;
  el.textContent = text; el.style.opacity = '1'; HG.subT = 6;
}
const HG_MENACE_SUB = { es: '…la inercia también es una forma de alimentar a la máquina…', en: '…inertia is also a way of feeding the machine…' };
const HG_SUBS = {
  es: ['…el progreso es una máquina que nunca dice basta…',
       '…cada punto que acumulas es calor que le quitas al fuego…',
       '…renunciar no es perder: es decidir qué merece arder…',
       '…suficiente: un fuego pequeño, un viajero, dos animales dormidos.'],
  en: ['…progress is a machine that never says enough…',
       '…every point you hoard is warmth taken from the fire…',
       '…to renounce is not to lose: it is to decide what deserves to burn…',
       '…enough: a small fire, a traveler, two sleeping animals.']
};

function hgBuildUI() {
  const en = MG.isEN();
  const ui = MG.buildUI(en
    ? 'The machine\'s cold puts your fire out. Drag your own points — SCORE, COMBO, FILES — and throw them into the flames. Renounce, to listen. Drag empty space to turn around the scene; pinch to zoom.'
    : 'El frío de la máquina apaga tu fuego. Arrastra tus propios puntos —SCORE, COMBO, ARCHIVOS— y lánzalos a la hoguera. Renuncia para escuchar. Arrastra el espacio vacío para girar la escena; pellizca para acercar.');
  const cold = document.createElement('div');
  cold.style.cssText = 'position:absolute; inset:0; pointer-events:none; opacity:0; background:radial-gradient(ellipse at 30% 30%, rgba(120,170,220,0.22), rgba(120,170,220,0) 60%), radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(214,74,58,0.2) 100%);';
  const flash = document.createElement('div');
  flash.style.cssText = 'position:absolute; inset:0; pointer-events:none; opacity:0; background:rgba(214,74,58,0.16);';
  // franjas de cine: el plano se siente contemplado, no jugado
  const bar = (pos) => { const b = document.createElement('div'); b.style.cssText = `position:absolute; left:0; right:0; ${pos}:0; height:0; background:#000; pointer-events:none; transition:height 3s ease;`; return b; };
  const barT = bar('top'), barB = bar('bottom');
  ui.root.insertBefore(barB, ui.root.firstChild); ui.root.insertBefore(barT, ui.root.firstChild);
  ui.root.insertBefore(flash, ui.root.firstChild); ui.root.insertBefore(cold, ui.root.firstChild);
  requestAnimationFrame(() => requestAnimationFrame(() => { barT.style.height = '4.5vh'; barB.style.height = '4.5vh'; }));

  const title = document.createElement('div');
  title.textContent = en ? 'LISTENING TO THE BLACK BOX' : 'ESCUCHANDO LA CAJA NEGRA';
  title.style.cssText = 'font-size:0.66rem; font-weight:300; letter-spacing:0.34em; color:#a8a49c;';
  const prog = document.createElement('div'); prog.style.cssText = 'margin:12px auto 0; width:min(60vw,240px); height:1px; background:rgba(231,228,222,0.15); position:relative;';
  const fill = document.createElement('div'); fill.style.cssText = 'position:absolute; left:0; top:0; height:1px; width:0%; background:#e7e4de; box-shadow:0 0 8px rgba(231,228,222,0.6);';
  prog.appendChild(fill); ui.extra.appendChild(title); ui.extra.appendChild(prog);

  const sub = document.createElement('div');
  sub.style.cssText = 'position:absolute; left:50%; bottom:calc(150px + env(safe-area-inset-bottom,0px)); transform:translateX(-50%); width:min(90vw,640px); text-align:center; font-size:0.95rem; font-weight:300; letter-spacing:0.12em; line-height:1.8; color:#cfd8e3; opacity:0; transition:opacity 1.4s ease; text-shadow:0 0 14px rgba(0,0,0,0.9), 1px 0 rgba(214,74,58,0.35);';
  ui.root.appendChild(sub);

  HG.chips = [hgMakeChip('score', 'SCORE', ui.root), hgMakeChip('combo', 'COMBO', ui.root), hgMakeChip('files', en ? 'FILES' : 'ARCHIVOS', ui.root)];
  HG.els = { cold, flash, fill, sub };
}

function hgStart() {
  if (window.isHogueraActive || window.isTuningGameActive || window.isWiringGameActive) return;
  const en = MG.isEN();
  window.isHogueraActive = true;
  MG.enter(24);
  camera.fov = HG_ISO.fov; targetFov = HG_ISO.fov; camera.updateProjectionMatrix();   // lente muy cerrada: casi ortográfica, como un diorama isométrico
  userGroup.rotation.order = 'YXZ';                                                  // giro (yaw) y luego inclinación (pitch)
  const tg = window.travelerGroup;
  HG.saved = { pos: tg.position.clone(), quat: tg.quaternion.clone(), scale: tg.scale.clone() };
  const feet = (typeof TRAVELER_FEET !== 'undefined') ? TRAVELER_FEET : 0.6;
  window.hgPose = { pos: new THREE.Vector3(-1.6, feet, 0.4), yaw: Math.atan2(HG_COLOSSUS.x + 1.6, HG_COLOSSUS.z - 0.4) };   // mira al Coloso
  tg.visible = true; tg.position.copy(window.hgPose.pos);

  HG.phase = 'play'; HG.heat = 0.7; HG.cold = 0; HG.coldS = 0; HG.listen = 0; HG.listenS = 0; HG.outT = 0; HG.winT = 0; HG.discarded = 0;
  HG.subT = 0; HG.subIdx = 0; HG.flashV = 0; HG.calmV = 0; HG.emberT = 0; HG.filesNote = false;
  HG.growlIn = 7 + Math.random() * 5; HG.meowIn = 12 + Math.random() * 8; HG.growlP = 1; HG.growlAmp = 0; HG.growlG = 0;
  HG.idleT = 0; HG.menaceP = 0; HG.menaceSub = false; HG.rattleIn = 6;
  hgCamReset(); hgCamBind();
  HG.files = parseInt((MG.saved && MG.saved.hud && MG.saved.hud['files-value']) || '0', 10) || 0;

  if (MG.dust) MG.dust.pts.position.set(HG_ISO.target.x, 6, HG_ISO.target.z);
  HG.group = new THREE.Group();
  HG.group.add(hgBuildSky()); HG.group.add(hgBuildGround()); HG.group.add(hgBuildColossus()); HG.group.add(hgBuildFire());
  scene.add(HG.group);
  HG.fx = makeFX(1600); scene.add(HG.fx.pts);
  hgAddPets();
  hgBuildUI();
  hgToneStart();

  morphHUD('renunciar');
  showSystemToast(en ? 'A fire, a traveler, and a monument that gives off cold.' : 'Un fuego, un viajero y un monumento que irradia frío.', '#e7e4de');
}
window.startHogueraGame = function() {
  if (MG.pending || window.isHogueraActive || window.isTuningGameActive || window.isWiringGameActive) return;
  MG.pending = true;
  MG.reflect(MG.text('hoguera', 'intro'), () => { MG.pending = false; hgStart(); }, { cancelable: true, onCancel: () => { MG.pending = false; } });
};

function hgWin() {
  HG.phase = 'won'; HG.winT = 0;
  hgGrowl('sigh');                                                                 // el Coloso exhala: ya fue escuchado
  hgSub(HG_SUBS[MG.isEN() ? 'en' : 'es'][3]);
  hgToneStop();
  playSound('levelup');
  MGS.arpeggio([0, 2, 3, 5, 4], 0.25, 3, 0.045);
  HG.fx.burst(HG.fire.x, HG.fire.y, HG.fire.z, 80, 3, 3.2, 0xffd08a, 0.3 * HG_FS, 0.9);
}

function hgUpdateChips(dt) {
  const W = window.innerWidth, H = window.innerHeight;
  _hgV.copy(HG.fire).project(camera);
  HG.fireScreen.x = (_hgV.x + 1) / 2 * W; HG.fireScreen.y = (1 - _hgV.y) / 2 * H;
  const fx = HG.fireScreen.x, fy = HG.fireScreen.y;
  const R = 84 * Math.min(1.3, Math.max(0.7, H / 800));
  const lag = 8 - HG.cold * 4.5;
  const slotY = Math.max(150, H * 0.19);

  HG.chips.forEach((c, i) => {
    c.slot.x = W / 2 + (i - 1) * (c.w + 12); c.slot.y = slotY;
    if (c.pos.x < -900) { c.pos.x = c.slot.x; c.pos.y = c.slot.y; }
    let scale = 1, op = 1;
    if (c.state === 'idle' || c.state === 'return') {
      const k = 1 - Math.exp(-dt * 7);
      c.pos.x += (c.slot.x - c.pos.x) * k; c.pos.y += (c.slot.y - c.pos.y) * k; c.rot *= 1 - k;
      if (c.state === 'return' && Math.hypot(c.slot.x - c.pos.x, c.slot.y - c.pos.y) < 3) c.state = 'idle';
    } else if (c.state === 'drag') {
      const k = 1 - Math.exp(-dt * lag);
      const px = c.pos.x;
      c.pos.x += (c.target.x - c.pos.x) * k; c.pos.y += (c.target.y - c.pos.y) * k;
      c.rot += (Math.max(-0.35, Math.min(0.35, (c.target.x - px) * 0.01)) - c.rot) * 0.2;
      scale = 1.08;
    } else if (c.state === 'fly') {
      const dx = fx - c.pos.x, dy = fy - c.pos.y, dist = Math.hypot(dx, dy), sp = Math.hypot(c.vel.x, c.vel.y);
      if (sp > 1) {
        const cosA = (c.vel.x * dx + c.vel.y * dy) / (sp * dist + 1e-6);
        if (cosA > 0.55) { const k2 = Math.min(1, dt * 3.5); c.vel.x += (dx / dist * sp - c.vel.x) * k2; c.vel.y += (dy / dist * sp - c.vel.y) * k2; }
      }
      c.vel.y += 380 * dt;
      const f = Math.max(0, 1 - 0.5 * dt); c.vel.x *= f; c.vel.y *= f;
      c.pos.x += c.vel.x * dt; c.pos.y += c.vel.y * dt; c.rot += dt * 3;
      if (dist < R) hgBurn(c);
      else if (sp < 120 || c.pos.x < -200 || c.pos.x > W + 200 || c.pos.y < -200 || c.pos.y > H + 200) c.state = 'return';
    }
    if (c.state === 'burn') {
      c.burnT += dt / 0.5;
      const k = 1 - Math.exp(-dt * 10);
      c.pos.x += (fx - c.pos.x) * k; c.pos.y += (fy - c.pos.y) * k;
      scale = Math.max(0, 1 - c.burnT); op = scale; c.rot += dt * 6;
      if (c.burnT >= 1) { c.state = 'cool'; c.cool = 6; c.el.style.pointerEvents = 'none'; }
    } else if (c.state === 'cool') {
      op = 0; c.cool -= dt;
      if (c.cool <= 0) { c.valEl.textContent = hgChipValue(c.kind); c.pos.x = c.slot.x; c.pos.y = c.slot.y; c.state = 'idle'; c.el.style.pointerEvents = 'auto'; }
    }
    c.el.style.opacity = String(op);
    c.el.style.transform = `translate(${c.pos.x - c.w / 2}px, ${c.pos.y - c.h / 2}px) rotate(${c.rot}rad) scale(${scale})`;
  });
}

function hgUpdate(dt) {
  const en = MG.isEN(), calm = reduceMotionMQ.matches, t = MG.time, E = HG.els;

  // ----- Fuego, frío y escucha -----
  if (HG.phase === 'play') {
    HG.heat = Math.max(0, HG.heat - (0.025 + 0.03 * HG.listen) * dt);
    HG.cold = Math.pow(1 - HG.heat, 1.2);
    if (HG.heat > 0.12) HG.listen = Math.min(1, HG.listen + dt / HG_LISTEN_SECS);
    const th = [0.2, 0.45, 0.7];
    if (HG.subIdx < 3 && HG.listen >= th[HG.subIdx]) {
      hgSub(HG_SUBS[en ? 'en' : 'es'][HG.subIdx]); MGS.bell(130.81, 0, 3, 0.05); HG.subIdx++;
    }
    if (HG.heat <= 0) hgFireOut();
    else if (HG.listen >= 1) hgWin();
  } else if (HG.phase === 'out') {
    HG.outT -= dt; HG.cold = Math.min(1, HG.cold + dt * 0.5);
    if (HG.outT <= 0) hgRelight();
  } else if (HG.phase === 'won') {
    HG.winT += dt; HG.cold = Math.max(0, HG.cold - dt * 0.6);
    HG.heat = Math.min(1, HG.heat + dt * 0.25);
    if (HG.winT > 4.2) { window.endHogueraGame(); return; }
  }
  HG.calmV += ((HG.phase === 'won' ? 1 : 0) - HG.calmV) * Math.min(1, dt * 1.5);
  HG.coldS += (HG.cold - HG.coldS) * Math.min(1, dt * 0.9);                      // el Coloso reacciona despacio
  HG.listenS += (HG.listen - HG.listenS) * Math.min(1, dt * 0.8);

  // ----- Amenaza: si el jugador no hace nada, la bestia se yergue, abre las alas y la capucha, y su voz se vuelve más grave -----
  if (HG.phase === 'play' || HG.phase === 'out') HG.idleT += dt; else HG.idleT = 0;
  const mT = HG.phase === 'won' ? 0 : Math.max(Math.min(1, Math.max(0, HG.idleT - 7) / 16), HG.phase === 'out' ? 0.9 : Math.max(0, HG.coldS - 0.3) * 1.1);      // el frío alto también inquieta a la bestia
  HG.menaceP += (mT - HG.menaceP) * Math.min(1, dt * (mT > HG.menaceP ? 0.5 : 1.6));      // sube despacio; baja rápido en cuanto actúas
  if (HG.menaceP > 0.5 && !HG.menaceSub) { HG.menaceSub = true; hgSub(HG_MENACE_SUB[en ? 'en' : 'es']); }
  if (HG.menaceP < 0.15) HG.menaceSub = false;

  // ----- Cámara isométrica: casi ortográfica; se retira y gira apenas mientras escuchas (el final es el plano más amplio) -----
  const sw = calm ? 0 : 1, L = HG.listenS, W = Math.min(1, HG.winT / 4.2) * (HG.phase === 'won' ? 1 : 0), CM = HG_CAM;
  if (!CM.ptrs.size) { CM.yawT += CM.yawV * dt; CM.yawV *= Math.exp(-dt * 3.2); }                  // inercia al soltar
  const kc = 1 - Math.exp(-dt * 9);
  CM.yaw += (CM.yawT - CM.yaw) * kc; CM.pit += (CM.pitT - CM.pit) * kc; CM.zoom += (CM.zoomT - CM.zoom) * kc;
  const asp = window.innerWidth / window.innerHeight, fit = Math.max(1, 1.5 / asp);        // en vertical se aleja para que quepa toda la maqueta
  const D = (HG_ISO.dist + 14 * L + 8 * W) * fit * CM.zoom;                                // la distancia solo cambia con el zoom, nunca al girar
  const psi = HG_ISO.yaw + CM.yaw + 0.08 * L + Math.sin(t * 0.05) * 0.02 * sw, phi = Math.max(0.2, Math.min(1.1, HG_ISO.pitch + CM.pit + 0.03 * L));
  const T = HG_ISO.target;
  userGroup.position.set(T.x + D * Math.sin(psi) * Math.cos(phi), T.y + D * Math.sin(phi), T.z + D * Math.cos(psi) * Math.cos(phi));
  userGroup.rotation.set(-phi, psi, 0);
  if (!calm && HG.cold > 0.7 && Math.random() < dt * 0.5) shakeIntensity = Math.max(shakeIntensity, 0.04);

  // ----- Llama, brasas y halo (escalados: la cámara está lejos) -----
  const heat = HG.heat, f = HG.fire;
  const nF = Math.round((heat > 0.01 ? 1 + heat * 5 : 0) * (calm ? 0.5 : 1) * Math.min(2, dt * 60));
  for (let i = 0; i < nF; i++) {
    const r = Math.random(), hex = r < 0.3 ? HG_FIRE_COLS[0] : (r < 0.7 ? HG_FIRE_COLS[1] : HG_FIRE_COLS[2]);
    HG.fx.emit(f.x + (Math.random() - 0.5) * 0.5 * (0.5 + heat), f.y - 0.6 + Math.random() * 0.2, f.z + (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.35, 0.8 + Math.random() * 1.2 * (0.5 + heat), (Math.random() - 0.5) * 0.2,
      0.8 + Math.random() * 0.8, hex, (0.22 + Math.random() * 0.3) * (0.6 + heat * 0.6) * HG_FS, 0.8, 0.5);
  }
  if (heat <= 0.01 && Math.random() < dt * 3) HG.fx.emit(f.x, f.y - 0.6, f.z, 0, 0.3, 0, 1.2, PAL.rose, 0.16 * HG_FS, 0.4, 0.4);
  const flick = 1 + Math.sin(t * 17) * 0.06 + Math.sin(t * 9.3) * 0.05;
  HG.fireHalo.material.opacity = (0.06 + heat * 0.5) * flick;
  HG.fireHalo.scale.set((1.4 + heat * 2.6) * flick, (1.4 + heat * 2.6) * flick, 1);
  HG.glowDisc.material.opacity = heat * 0.35 * flick;
  HG.glowDisc.scale.set(2.5 + heat * 5, 2.5 + heat * 5, 1);

  // ----- Frío que viaja desde el Coloso hasta el campamento -----
  HG.emberT -= dt;
  if (HG.emberT <= 0 && HG.cold > 0.02) {
    HG.emberT = Math.max(0.06, 0.45 - HG.cold * 0.35);
    const dx = f.x - HG_COLOSSUS.x, dz = f.z - HG_COLOSSUS.z, dl = Math.hypot(dx, dz), sp = 3;
    HG.fx.emit(HG_COLOSSUS.x + (Math.random() - 0.5) * 22, 0.2 + Math.random() * 0.6, HG_COLOSSUS.z + (Math.random() - 0.5) * 22,
      dx / dl * sp, 0, dz / dl * sp, 12, 0x9fc1e0, 0.32, 0.4, 0.03);
  }

  // ----- Suelo, cielo y Coloso -----
  const gu = HG.ground.material.uniforms;
  gu.uTime.value = t; gu.uHeat.value = heat; gu.uCold.value = HG.coldS;
  const cm = Math.max(HG.coldS, HG.menaceP * 0.85);
  HG.screenMat.uniforms.uTime.value = t; HG.screenMat.uniforms.uCold.value = cm; HG.screenMat.uniforms.uCalm.value = HG.calmV;
  HG.bodyMat.uniforms.color.value.setHex(0x5c635c).multiplyScalar(0.6 + 0.9 * cm);
  HG.screenMat.uniforms.uRune.value = 0.25 + HG.listenS * 0.75 + HG.calmV * 0.3 + HG.growlG * 0.4 + HG.menaceP * 0.25;          // las runas se encienden al escuchar su caja negra
  if (HG.growlP < 1) HG.growlP = Math.min(1, HG.growlP + dt / HG.growlDur);                  // envolvente del gruñido: ataque rápido y caída
  HG.growlG = HG.growlAmp * Math.min(1, HG.growlP / 0.1) * (1 - HG.growlP);
  if (HG.growlG > 0.3 && !calm) shakeIntensity = Math.max(shakeIntensity, HG.growlG * 0.05);
  hgAnimateColossus(t, HG.coldS, calm);
  HG.eyes.forEach(e => { e.material.opacity = Math.min(1, 0.3 + HG.coldS * 0.45 + HG.growlG * 0.5 + HG.menaceP * 0.45) * (0.85 + 0.15 * Math.sin(t * 3)) * (1 - HG.calmV * 0.4); if (e.material.color && e.material.color.setHex) e.material.color.setHex(HG.menaceP > 0.5 ? 0xff3a2a : 0xffa24d); });   // ojos de brasa: arden más cuando el fuego muere
  // pluma de ceniza que el viento arrastra desde la corona (como el penacho negro del coloso)
  if (HG.colos && !calm) {
    _hgV.set(0, 5.5, -3); HG.colos.head.localToWorld(_hgV);
    const nA = Math.round((1.2 + HG.menaceP * 1.5) * Math.min(2, dt * 60));
    for (let i = 0; i < nA; i++) HG.fx.emit(_hgV.x + (Math.random() - 0.5) * 0.4, _hgV.y, _hgV.z + (Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 0.8, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4, 3.5 + Math.random() * 2, 0x59616b, 0.28 + Math.random() * 0.2, 0.45, 0.3);
  }
  HG.sigil.material.opacity = 0.10 + HG.listenS * 0.45 + 0.12 * Math.sin(t * (1.2 + HG.listenS * 2)) + HG.calmV * 0.3;   // el sello late más al escuchar
  hgUpdateAtmos(dt, t, calm);

  // ----- Mascotas dormidas respirando -----
  HG.pets.forEach(p => { const b = 1 + Math.sin(t * 1.4 + p.userData.ph) * 0.02, pu = p.userData.pulse || 0; p.userData.pulse = Math.max(0, pu - dt * 1.6); p.scale.y = (p.userData.sy || (p.userData.sy = p.scale.y)) * b * (1 + pu * 0.1); });

  // ----- Glitch rojo en pantalla: más frecuente con el frío -----
  HG.flashV = Math.max(0, HG.flashV - dt * 3);
  if (!calm && HG.phase !== 'won' && Math.random() < dt * (0.15 + HG.cold * 2.2)) {
    HG.flashV = 0.4 + HG.cold * 0.6;
    if (HG.cold > 0.5 && typeof triggerSubtleGlitch === 'function') triggerSubtleGlitch();
  }

  // ----- Voces: el Coloso gruñe de vez en cuando (más seguido con el frío); los gatos maúllan bajito -----
  if (HG.phase !== 'won') {
    const mn = HG.menaceP;
    HG.growlIn -= dt;
    if (HG.growlIn <= 0) { hgGrowl(mn > 0.55 ? 'menace' : 'idle'); HG.growlIn = Math.max(4, 16 - 9 * HG.coldS - 8 * mn) + Math.random() * 10 * (1 - 0.6 * mn); }
    if (mn > 0.3) { HG.rattleIn -= dt; if (HG.rattleIn <= 0) { hgRattle(mn); HG.rattleIn = 9 - 5 * mn + Math.random() * 4; } } else HG.rattleIn = Math.max(HG.rattleIn, 4);
  }
  if (HG.phase === 'play') { HG.meowIn -= dt; if (HG.meowIn <= 0) { hgMeow(Math.random() < 0.5 ? 0 : 1, HG.heat < 0.2); HG.meowIn = (HG.heat < 0.2 ? 6 : 22) + Math.random() * 12; } }

  // ----- Crujidos del fuego -----
  if (Math.random() < heat * dt * 9) hgNoise('bandpass', (0.02 + Math.random() * 0.03) * (0.4 + heat), 900 + Math.random() * 2600, 0.05 + Math.random() * 0.05);
  hgToneUpdate(heat, HG.cold, HG.menaceP);

  // ----- Ofrendas, interfaz y HUD ('renunciar': CARGA, ENTROPÍA, DESCARTADO, AGILIDAD) -----
  HG.fx.update(dt);
  hgUpdateChips(dt);
  if (E.fill) {
    E.fill.style.width = (HG.listen * 100).toFixed(1) + '%';
    E.cold.style.opacity = String(Math.min(1, HG.cold * 1.1) * (1 - HG.calmV));
    E.flash.style.opacity = String(HG.flashV * 0.5);
    if (HG.subT > 0) { HG.subT -= dt; if (HG.subT <= 0 && HG.phase !== 'won') E.sub.style.opacity = '0'; }
  }
  MG.setHUD({
    'lives-value': Math.round(heat * 100) + '%',
    'level-value': Math.round(HG.cold * 100) + '%',
    'files-value': HG.discarded + ' pts',
    'combo-value': Math.round((8 - HG.cold * 4.5) / 8 * 100) + '%'
  });
}

function hgTeardown() {
  window.isHogueraActive = false; window.hgPose = null; HG.phase = 'idle';
  hgCamUnbind();
  hgToneStop();
  HG.pets.forEach(p => scene.remove(p)); HG.pets = [];
  if (HG.group) { mgDispose(HG.group); HG.group = null; }
  if (HG.fx) { scene.remove(HG.fx.pts); HG.fx.dispose(); HG.fx = null; }
  const tg = window.travelerGroup;
  if (tg && HG.saved) { tg.position.copy(HG.saved.pos); tg.quaternion.copy(HG.saved.quat); tg.scale.copy(HG.saved.scale); }
  HG.saved = null; HG.chips = []; HG.els = {}; HG.eyes = []; HG.ground = null; HG.bodyMat = null; HG.screenMat = null;
  HG.colos = null; HG.sigil = null; HG.fog = null; HG.snow = null;
}

window.endHogueraGame = function() {
  if (!window.isHogueraActive) return;
  hgTeardown();
  MG.exit();
  setTimeout(() => { MG.reflect(MG.text('hoguera', 'outro'), () => {}); }, 700);   // reflexión final sobre el universo restaurado
};

window.abortHogueraGame = function() {
  if (!window.isHogueraActive) return;
  const en = MG.isEN();
  hgTeardown();
  MG.exit();
  setTimeout(() => { MG.reflect(MG.text('hoguera', 'outro'), () => {}); }, 700);
};
