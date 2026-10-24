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
  if (window.isTuningGameActive || window.isWiringGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive)) || window.isMiniIntro || (window.MG && window.MG.pending)) {
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
const arQBtn = document.createElement('button');
arQBtn.type = 'button'; arQBtn.id = 'ar-quipu-btn'; arQBtn.textContent = 'QUIPU';
arQBtn.style.cssText = 'position:absolute; top:calc(66px + env(safe-area-inset-top,0px)); left:14px; pointer-events:auto; padding:12px 20px; font:300 0.8rem/1 monospace; letter-spacing:0.28em; color:#e7e4de; background:rgba(10,10,12,0.72); border:1px solid rgba(231,228,222,0.5); border-radius:2px; cursor:pointer;';
arQBtn.addEventListener('beforexrselect', (e) => e.preventDefault());
arQBtn.addEventListener('click', (e) => { e.stopPropagation(); if (window.arQuipuToggle) window.arQuipuToggle(); });
arExitRoot.appendChild(arQBtn);
const arTBtn = document.createElement('button');
arTBtn.type = 'button'; arTBtn.id = 'ar-turtle-btn'; arTBtn.textContent = 'TORTUGA'; window.arTBtn = arTBtn;
arTBtn.style.cssText = arQBtn.style.cssText; arTBtn.style.top = 'calc(118px + env(safe-area-inset-top,0px))';
arTBtn.addEventListener('beforexrselect', (e) => e.preventDefault());
arTBtn.addEventListener('click', (e) => { e.stopPropagation(); if (window.arTurtleToggle) window.arTurtleToggle(); });
arExitRoot.appendChild(arTBtn);
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
function arBtnTexture(label) {
  const c = document.createElement('canvas'); c.width = 320; c.height = 110;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,10,12,0.82)'; g.fillRect(0, 0, 320, 110);
  g.strokeStyle = '#e7e4de'; g.lineWidth = 3; g.strokeRect(4, 4, 312, 102);
  g.fillStyle = '#e7e4de'; g.font = '300 38px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 160, 56);
  return new THREE.CanvasTexture(c);
}
const arQuipu3D = (() => {                                                       // segundo botón flotante: QUIPU / MODELOS
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.069), new THREE.MeshBasicMaterial({ map: arBtnTexture('QUIPU'), transparent: true, depthTest: false, toneMapped: false }));
  m.renderOrder = 9999; m.position.set(-0.16, 0.06, -0.5); m.visible = false; m.name = 'ar-quipu-3d';
  camera.add(m);
  return m;
})();
const arTurtle3D = (() => {                                                      // tercer botón flotante: TORTUGA / MODELOS
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.069), new THREE.MeshBasicMaterial({ map: arBtnTexture('TORTUGA'), transparent: true, depthTest: false, toneMapped: false }));
  m.renderOrder = 9999; m.position.set(-0.16, -0.02, -0.5); m.visible = false; m.name = 'ar-turtle-3d';
  camera.add(m); window.arTurtle3D = m;
  return m;
})();
function arQuipuSetLabel(on) {
  arQBtn.textContent = on ? 'MODELOS' : 'QUIPU';
  if (arQuipu3D.material.map) arQuipu3D.material.map.dispose();
  arQuipu3D.material.map = arBtnTexture(on ? 'MODELOS' : 'QUIPU'); arQuipu3D.material.needsUpdate = true;
}
window.arTryExit = function (ctrl) {                                             // ¿el controlador/toque apuntó al botón 3D?
  if (!window.isARSession || !renderer.xr.isPresenting || !arExit3D.visible || !ctrl) return false;
  const rc = new THREE.Raycaster(), rot = new THREE.Matrix4();
  rot.identity().extractRotation(ctrl.matrixWorld);
  rc.ray.origin.setFromMatrixPosition(ctrl.matrixWorld); rc.ray.direction.set(0, 0, -1).applyMatrix4(rot);
  camera.updateMatrixWorld(true); arExit3D.updateMatrixWorld(true);
  if (rc.intersectObject(arExit3D, false).length) { endXRSession(); return true; }
  arQuipu3D.updateMatrixWorld(true);
  if (arQuipu3D.visible && rc.intersectObject(arQuipu3D, false).length) { if (window.arQuipuToggle) window.arQuipuToggle(); return true; }
  arTurtle3D.updateMatrixWorld(true);
  if (arTurtle3D.visible && rc.intersectObject(arTurtle3D, false).length) { if (window.arTurtleToggle) window.arTurtleToggle(); return true; }
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
        arExit3D.visible = true; arQuipu3D.visible = true; arTurtle3D.visible = true;
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
    arExit3D.visible = false; arQuipu3D.visible = false; arTurtle3D.visible = false; if (window.arQuipuStop) window.arQuipuStop(); if (window.arTurtleStop) window.arTurtleStop(); arExitRoot.style.display = 'none';
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

const foundProjects = new Set(); const totalProjects = 13; // 8 normales + 1 ballena + 1 sputnik + 2 gatos

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
  if (!isGameStarted || isPaused || isUIOpen || renderer.xr.isPresenting || isBossBattle || window.isTuningGameActive || window.isWiringGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive)) || window.isMiniIntro) return; 
  scrollSpeedBoost += 0.8; if (scrollSpeedBoost > 2.5) scrollSpeedBoost = 2.5; 
  const now = Date.now(); 
  if (now - lastSpawnTime > 400) { 
    lastSpawnTime = now; spawnAsteroid(); if(Math.random() > 0.5) spawnAsteroid(); 
    const rand = Math.random();
    
    if (rand > 0.9 && voyagerModelTemplate) { 
      const voyager = voyagerModelTemplate.clone(); voyager.position.set((Math.random() - 0.5) * 35, 40, (Math.random() - 0.5) * 20); voyager.rotation.x = Math.PI;
voyager.userData = { 
  id: 77, 
  title: { es: 'LOG_SPUTNIK // SONDA', en: 'LOG_SPUTNIK // PROBE' }, 
  desc: { es: 'El Proyecto Sputnik fue dado de baja hace décadas.', en: 'The Sputnik Project was decommissioned decades ago.' }, 
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
  if (window.isTuningGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) { window.MG.setPointer(clientX, clientY); return; }   // (en la Hoguera el toque se resuelve al soltar: ver hgCamBind)

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
  if (window.isTuningGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) { window.MG.setPointer(clientX, clientY); return; }

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
  if (window.isTuningGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) return;

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
    if (tapLength < 300 && tapLength > 0 && !window.isTuningGameActive && !window.isWiringGameActive && !(window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive)) && !isUIOpen && !isBossBattle && !isAligned && !isDraggingPlanet) {
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
    if (!draggedPlanet && !window.isTuningGameActive && !window.isWiringGameActive && !(window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive)) && (touchStartY - touchY > 40 || touchStartY - touchY < -40)) { 
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
  if (isAligned && e.changedTouches.length > 0 && !draggedPlanet && !isDraggingPlanet && !window.isTuningGameActive && !window.isWiringGameActive && !(window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive)) && !window.isMiniIntro) {   // un lanzamiento de ofrenda no debe girar el carrusel
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
  else if (mode === 'tejer') {
    if (lblLives) lblLives.innerText = 'ENREDOS';
    if (lblLevel) lblLevel.innerText = 'HILOS';
    if (lblFiles) lblFiles.innerText = 'PASADAS';
    if (lblCombo) lblCombo.innerText = 'PASADA';
  }
  else if (mode === 'renunciar') {
    if (lblLives) lblLives.innerText = 'CARGA';
    if (lblLevel) lblLevel.innerText = 'ENTROPÍA';
    if (lblFiles) lblFiles.innerText = 'DESCARTADO';
    if (lblCombo) lblCombo.innerText = 'AGILIDAD';
  }
  else if (mode === 'resonar') {
    if (lblLives) lblLives.innerText = 'SOLEDAD';
    if (lblLevel) lblLevel.innerText = 'CANTO';
    if (lblFiles) lblFiles.innerText = 'ECOS';
    if (lblCombo) lblCombo.innerText = 'SINTONÍA';
  }
  else if (mode === 'sputnik') {
    if (lblLives) lblLives.innerText = 'CAPÍTULO';
    if (lblLevel) lblLevel.innerText = 'CONSERVADO';
    if (lblFiles) lblFiles.innerText = 'LLEVAS';
    if (lblCombo) lblCombo.innerText = 'BIP';
  }
  else if (mode === 'coloso') {
    const L = window.__colHud || ['', '', '', ''];
    if (lblLives) lblLives.innerText = L[0];
    if (lblLevel) lblLevel.innerText = L[1];
    if (lblFiles) lblFiles.innerText = L[2];
    if (lblCombo) lblCombo.innerText = L[3];
  }
  else if (mode === 'tortuga') {
    if (lblLives) lblLives.innerText = 'PASOS';
    if (lblLevel) lblLevel.innerText = 'BROTES';
    if (lblFiles) lblFiles.innerText = 'FLORES';
    if (lblCombo) lblCombo.innerText = 'SEMILLAS';
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
  if (window.isTuningGameActive || window.isWiringGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) return; // 🎮 el raycaster ignora .visible: sin esto se abrían planetas ocultos
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

    // 🛰️ JUEGO OTRO: SPUTNIK (clic en la pequeña nave)
    if (data && data.isVoyager && window.startSputnikGame) {
      window.isZooming = true;
      playSound('boss_hit');
      window.startSputnikGame(data);
      setTimeout(() => { window.isZooming = false; }, 350);
      return;
    }

    // 🐋 JUEGO OTRO: LA BALLENA (clic en una ballena del universo)
    if (data === whaleData && window.startWhaleGame) {
      window.isZooming = true;
      playSound('boss_hit');
      window.startWhaleGame(data);
      setTimeout(() => { window.isZooming = false; }, 350);
      return;
    }
    
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
    // 🐾 JUEGOS OTROS de colosos, uno por sección (1 árbol · 2 escarabajo · 3 catarina · 4 cóndor · 5 oso · 6 medusa)
    const COL_BY_ID = { 1: 'arbol', 2: 'escarabajo', 3: 'mariquita', 4: 'condor', 5: 'colibri', 6: 'medusa' };
    if (data && COL_BY_ID[data.id] && window.startColossusGame) {
      window.isZooming = true;
      playSound('boss_hit');
      window.startColossusGame(COL_BY_ID[data.id], data);
      setTimeout(() => { window.isZooming = false; }, 350);
      return;
    }
    // 🐢 JUEGO OTRO: LA TORTUGA-PLANETA (sección 8 · Módulo WebAR)
    if (data.id === 8 && window.startTortugaGame) {
      window.isZooming = true;
      playSound('boss_hit');
      window.startTortugaGame(data);
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
      if (window._whaleReady && window.startWhaleGame && !window.isWhaleActive && !window.isHogueraActive) { window._whaleReady = false; window.startWhaleGame(whaleData); return; }
      if ((!window.travelerGroup.userData.anchoredPlanet || window._hogueraReady) && window.startHogueraGame && !(window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) { window._hogueraReady = false; window.startHogueraGame(); return; }
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
      const pistaBallena = window.currentLang === 'en' ? "Listen: something enormous sings beneath the silence. Touch me again and answer it." : "Escucha: bajo el silencio canta algo enorme. Tócame otra vez y respóndele.";
      if (window._oraculoClicks % 7 === 0 && window._oraculoClicks % 4 !== 0) window._whaleReady = true;
      const fraseElegida = (window._oraculoClicks % 4 === 0) ? pistaHoguera : (window._oraculoClicks % 7 === 0 ? pistaBallena : oraculoFrases[Math.floor(Math.random() * oraculoFrases.length)]);
      
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

// ==========================================
// 🧶 QUIPU EN EL AIRE (AR)
//   Un cordón principal en anillo rodea al usuario a la altura de la cabeza y de él cuelgan nueve cuerdas con nudos.
//   Se leen con las manos: pasar la mano o el controlador cerca de un nudo (o rozarlo con el rayo, o con el dedo sobre la pantalla)
//   lo anuda. Al leer todos los nudos de una cuerda, esta revela un concepto del marco teórico. Sin movimiento artificial: el
//   usuario no se desplaza, las cuerdas están a su alcance. Se activa con el botón QUIPU dentro de la sesión AR.
// ==========================================
const AR_Q_DATA = [
  { v: 12, hex: 0xe7e4de, es: ['SINTONÍA', 'Escuchar es cambiar con lo que se escucha.'], en: ['ATTUNEMENT', 'To listen is to change with what is heard.'] },
  { v: 25, hex: 0xc9786b, es: ['GLITCH', 'El error es la materia técnica dejando ver su arquitectura.'], en: ['GLITCH', 'The error is technical matter revealing its architecture.'] },
  { v: 7,  hex: 0xb9c8b0, es: ['FRICCIÓN', 'Lo que resiste también enseña: saber del cuerpo.'], en: ['FRICTION', 'What resists also teaches: knowing of the body.'] },
  { v: 31, hex: 0xa9c4e8, es: ['TELAR', 'Una tecnología para producir relaciones, patrones y memoria.'], en: ['LOOM', 'A technology for producing relations, patterns and memory.'] },
  { v: 18, hex: 0xd9c28a, es: ['QUIPU', 'El nudo guarda lo tejido y se lee con las manos.'], en: ['QUIPU', 'The knot keeps what was woven and is read with the hands.'] },
  { v: 40, hex: 0xcfa3c4, es: ['SUFICIENCIA', 'Decidir qué merece arder.'], en: ['SUFFICIENCY', 'Deciding what deserves to burn.'] },
  { v: 3,  hex: 0xe7e4de, es: ['ALTERIDAD', 'El otro seguirá siendo otro, y aun así se responde.'], en: ['ALTERITY', 'The other will remain other, and still we answer.'] },
  { v: 22, hex: 0xc9786b, es: ['ANA-ARQUEOLOGÍA', 'Escuchar lo que la ruina todavía tiene que decir.'], en: ['AN-ARCHAEOLOGY', 'Listening to what the ruin still has to say.'] },
  { v: 36, hex: 0xa9c4e8, es: ['MEMORIA', 'Lo que quemaste no vuelve. Lo que escuchaste, sí.'], en: ['MEMORY', 'What you burned does not return. What you listened to, does.'] }
];
const AR_Q_LEN = [0.8, 0.7, 0.95, 0.65, 0.9, 0.75, 1.0, 0.68, 0.85];
const AR_Q = { active: false, group: null, cords: [], sites: [], done: 0, t: 0, last: 0, won: false, captions: [], hint: null, hintT: 0, winT: 0, ring: null, R: 0.75 };
window.arQuipu = AR_Q;
const _arP = new THREE.Vector3(), _arO = new THREE.Vector3(), _arD = new THREE.Vector3(), _arM = new THREE.Matrix4();


// Puntos de luz con tamaño en metros: en XR el lienzo y el FOV cambian por ojo, así que se usa la proyección y la altura del framebuffer.
const AR_FH = { value: 1080 };
const AR_PVS = `attribute vec3 aCol; attribute float aSize; attribute float aAlpha; uniform float uFH; varying vec3 vC; varying float vA;
  void main() { vC = aCol; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uFH * 0.5 * projectionMatrix[1][1] / max(0.05, -mv.z), 1.0, 56.0); gl_Position = projectionMatrix * mv; }`;
const AR_PFS = `uniform float uOpacity; varying vec3 vC; varying float vA;
  void main() { float d = length(gl_PointCoord - vec2(0.5)); float a = smoothstep(0.5, 0.0, d); a *= a; gl_FragColor = vec4(vC, a * vA * uOpacity); }`;
function arPoints(n, fn) {
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), sz = new Float32Array(n), al = new Float32Array(n), o = { x: 0, y: 0, z: 0, r: 1, g: 1, b: 1, s: 0.01, a: 1 };
  for (let i = 0; i < n; i++) {
    o.r = o.g = o.b = 1; o.a = 1; o.s = 0.01; fn(i, o);
    pos[i * 3] = o.x; pos[i * 3 + 1] = o.y; pos[i * 3 + 2] = o.z; col[i * 3] = o.r; col[i * 3 + 1] = o.g; col[i * 3 + 2] = o.b; sz[i] = o.s; al[i] = o.a;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(al, 1));
  const m = new THREE.ShaderMaterial({ uniforms: { uFH: AR_FH, uOpacity: { value: 1 } }, vertexShader: AR_PVS, fragmentShader: AR_PFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const p = new THREE.Points(g, m); p.frustumCulled = false; return p;
}
function arRGB(hex) { return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]; }
function arFHUpdate() {                                                      // altura real del framebuffer del ojo
  try { const ss = renderer.xr.getSession(), bl = ss && ss.renderState && ss.renderState.baseLayer; AR_FH.value = (bl && bl.framebufferHeight) || renderer.domElement.height || 1080; } catch (e) { AR_FH.value = 1080; }
}

function arQuipuLang() { return window.currentLang === 'en' ? 'en' : 'es'; }
function arHaptic(ctrl, strength, ms) {                                      // vibración en el controlador si existe; si no, en el dispositivo
  try {
    const src = ctrl && ctrl.userData && ctrl.userData.src, gp = src && src.gamepad;
    const act = gp && gp.hapticActuators && gp.hapticActuators[0];
    if (act && act.pulse) { act.pulse(strength, ms); return; }
    if (gp && gp.vibrationActuator && gp.vibrationActuator.playEffect) { gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength }); return; }
  } catch (e) {}
  vibrateDevice(ms);
}
function arTextSprite(title, text, w, h) {                                  // rótulo con título y texto ajustado a 2–3 líneas
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h / w);
  const g = c.getContext('2d'), W = c.width;
  g.clearRect(0, 0, W, c.height); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  const draw = (str, y, px, weight, col, ls) => {
    g.font = `${weight} ${px}px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif`;
    if ('letterSpacing' in g) g.letterSpacing = (ls || 0) + 'px';
    g.lineWidth = Math.max(6, px * 0.22); g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(str, W / 2, y);
    g.fillStyle = col; g.fillText(str, W / 2, y);
  };
  let y = 70;
  if (title) { draw(title, y, 46, 300, '#bfc3cc', 10); y += 84; }
  const words = text.split(' '), lines = []; let cur = '';
  g.font = '300 58px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
  words.forEach(wd => { const t = cur ? cur + ' ' + wd : wd; if (g.measureText(t).width > W * 0.92 && cur) { lines.push(cur); cur = wd; } else cur = t; });
  if (cur) lines.push(cur);
  lines.forEach((ln, i) => draw(ln, y + i * 76, 58, 300, '#f3f1ec', 0));
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, toneMapped: false }));
  sp.scale.set(w, h, 1); sp.renderOrder = 9990;
  return sp;
}
function arQuipuHint(text, secs) {                                           // aviso pegado a la cámara (visible también en gafas, donde no hay DOM)
  if (AR_Q.hint) { camera.remove(AR_Q.hint); if (AR_Q.hint.material.map) AR_Q.hint.material.map.dispose(); AR_Q.hint.material.dispose(); }
  const sp = arTextSprite('', text, 0.5, 0.17); sp.position.set(0, -0.14, -0.55); camera.add(sp);
  AR_Q.hint = sp; AR_Q.hintT = secs || 6;
}

function arQuipuStart() {
  if (AR_Q.active || !window.isARSession || !renderer.xr.isPresenting) return;
  if (window.arTurtleStop) window.arTurtleStop();
  const L = arQuipuLang();
  camera.updateMatrixWorld(true);
  const cp = new THREE.Vector3(); camera.getWorldPosition(cp);
  const fw = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld); fw.y = 0;
  if (fw.lengthSq() < 1e-4) fw.set(0, 0, -1); fw.normalize();
  const yaw = Math.atan2(-fw.x, -fw.z), y0 = cp.y - 0.02, R = AR_Q.R;
  Object.assign(AR_Q, { active: true, done: 0, t: 0, last: performance.now(), won: false, winT: 0, captions: [], cords: [], sites: [], fxN: 0 });
  const grp = new THREE.Group(); grp.position.set(cp.x, 0, cp.z); AR_Q.group = grp; scene.add(grp);
  // el cordón principal: dos hilos de luz que se trenzan, y un polvo que sube alrededor de quien lee
  const ringPts = arPoints(520, (i, o) => { const a = i / 520 * 6.2832, w = (i % 2 ? 1 : -1) * 0.012 * Math.sin(a * 24); o.x = Math.cos(a) * (R + w); o.z = Math.sin(a) * (R + w); o.y = y0 + (i % 2 ? 1 : -1) * 0.008 * Math.cos(a * 24);
    o.s = 0.007 + Math.random() * 0.006; o.a = 0.55 + Math.random() * 0.4; o.r = 0.92; o.g = 0.9; o.b = 0.84; });
  grp.add(ringPts); AR_Q.ring = ringPts;
  AR_Q.motes = arPoints(220, (i, o) => { const a = Math.random() * 6.2832, r = 0.25 + Math.random() * 0.95; o.x = Math.cos(a) * r; o.z = Math.sin(a) * r; o.y = y0 - 0.9 + Math.random() * 1.8;
    o.s = 0.003 + Math.random() * 0.006; o.a = 0.15 + Math.random() * 0.35; o.r = 0.7; o.g = 0.82; o.b = 1; });
  AR_Q.motes.userData.y0 = y0; grp.add(AR_Q.motes);
  AR_Q.fx = { n: 200, life: new Float32Array(200), vel: new Float32Array(600), pts: null }; // chispas al atar
  AR_Q.fx.pts = arPoints(200, (i, o) => { o.a = 0; o.s = 0.008; }); grp.add(AR_Q.fx.pts);
  AR_Q_DATA.forEach((d, i) => {
    const a = yaw + (-120 + 240 * i / (AR_Q_DATA.length - 1)) * Math.PI / 180, sx = -Math.sin(a), sz = -Math.cos(a), len = AR_Q_LEN[i];
    const cg = new THREE.Group(); cg.position.set(sx * R, y0 - 0.01, sz * R); grp.add(cg);
    const [cr, cgc, cb] = arRGB(d.hex);
    const mat = new THREE.MeshBasicMaterial({ color: d.hex, toneMapped: false, transparent: true, opacity: 0.3 });             // núcleo tenue: se ve la cuerda aun sin puntos
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, len, 5), mat); line.position.y = -len / 2; cg.add(line);
    const thread = arPoints(Math.round(len / 0.011), (k, o) => { const u = k / Math.round(len / 0.011), q = u * 38 + i; o.x = Math.cos(q) * 0.0045; o.z = Math.sin(q) * 0.0045; o.y = -u * len;
      o.s = 0.0052 + 0.0025 * Math.sin(u * 40); o.a = 0.5 + 0.45 * (1 - u * 0.5); o.r = cr; o.g = cgc; o.b = cb; });                // un hilo que se enrosca, más tenue hacia la punta
    cg.add(thread);
    const anchor = mkHalo(d.hex, 0.05, 0.5); cg.add(anchor);
    const cord = { i, d, cg, len, mat, thread, sites: [], tied: 0, done: false, glow: 0, dir: new THREE.Vector3(sx, 0, sz), phase: i * 1.3 };
    const tens = Math.min(4, Math.floor(d.v / 10)), unit = d.v % 10;
    const add = (k, kind, t, turns) => {
      const kg = new THREE.Group(); kg.position.y = -t * len; kg.scale.setScalar(0.001); cg.add(kg);
      const core = new THREE.Mesh(new THREE.SphereGeometry(kind === 'unit' ? 0.009 : 0.011, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })); kg.add(core);
      const halo = mkHalo(d.hex, 0.09, 0.7); kg.add(halo);
      let deco;
      if (kind === 'tens') deco = arPoints(20, (j, o) => { const q = j / 20 * 6.2832; o.x = Math.cos(q) * 0.022; o.z = Math.sin(q) * 0.022; o.y = Math.sin(q * 2) * 0.004; o.s = 0.005; o.a = 0.95; o.r = cr; o.g = cgc; o.b = cb; });          // corona del nudo simple
      else { const n = Math.min(64, 12 + turns * 7), hh = 0.012 + turns * 0.0075;
             deco = arPoints(n, (j, o) => { const u = j / n, q = u * turns * 6.2832; o.x = Math.cos(q) * 0.016; o.z = Math.sin(q) * 0.016; o.y = (0.5 - u) * hh * 2; o.s = 0.0045; o.a = 0.95; o.r = cr; o.g = cgc; o.b = cb; }); }  // espiral del nudo largo: una vuelta por unidad
      kg.add(deco);
      const ghost = mkHalo(d.hex, 0.11, 0.0); ghost.position.y = -t * len; cg.add(ghost);
      const s = { cord, k, kind, t, turns, knot: kg, core, halo, deco, ghost, tied: false, appear: 0 };
      cord.sites.push(s); AR_Q.sites.push(s);
    };
    for (let k = 0; k < tens; k++) add(k, 'tens', 0.26 + k * 0.12, 1);
    if (unit > 0) add(tens, 'unit', 0.84, unit);
    AR_Q.cords.push(cord);
  });
  arQuipuSetLabel(true);
  arQuipuHint(L === 'en' ? 'Pass your hand or controller over the knots to read them' : 'Pasa la mano o el controlador sobre los nudos para leerlos', 7);
  MGS.arpeggio([2, 0], 0.3, 3, 0.04);
}
function arQuipuStop() {
  if (!AR_Q.active) return;
  AR_Q.active = false;
  if (AR_Q.group) { mgDispose(AR_Q.group); AR_Q.group = null; }
  if (AR_Q.hint) { camera.remove(AR_Q.hint); if (AR_Q.hint.material.map) AR_Q.hint.material.map.dispose(); AR_Q.hint.material.dispose(); AR_Q.hint = null; }
  AR_Q.cords = []; AR_Q.sites = []; AR_Q.captions = []; AR_Q.ring = null; AR_Q.motes = null; AR_Q.fx = null;
  arQuipuSetLabel(false);
}
function arQuipuToggle() { if (AR_Q.active) arQuipuStop(); else arQuipuStart(); }

function arSpark(x, y, z, hex, n) {                                         // chispas de luz al atar un nudo
  const F = AR_Q.fx; if (!F) return;
  const A = F.pts.geometry.attributes, [r, g, b] = arRGB(hex);
  for (let k = 0; k < n; k++) {
    const i = F.n ? (AR_Q.fxN = (AR_Q.fxN + 1) % F.n) : 0, a = Math.random() * 6.2832, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u), v = 0.12 + Math.random() * 0.25;
    A.position.array[i * 3] = x; A.position.array[i * 3 + 1] = y; A.position.array[i * 3 + 2] = z;
    F.vel[i * 3] = Math.cos(a) * s * v; F.vel[i * 3 + 1] = u * v + 0.05; F.vel[i * 3 + 2] = Math.sin(a) * s * v; F.life[i] = 1;
    A.aCol.array[i * 3] = r; A.aCol.array[i * 3 + 1] = g; A.aCol.array[i * 3 + 2] = b; A.aSize.array[i] = 0.006 + Math.random() * 0.006;
  }
}
function arQuipuTie(site, ctrl) {
  const c = site.cord, L = arQuipuLang();
  site.tied = true; site.appear = 0; c.tied++; c.glow = 1;
  site.knot.getWorldPosition(_arP); AR_Q.group.worldToLocal(_arP);
  arSpark(_arP.x, _arP.y, _arP.z, c.d.hex, site.kind === 'unit' ? 26 : 14);
  const n = MGS.NOTES[(c.i + site.k * 2) % 6];
  if (site.kind === 'unit') MGS.bell(n * 0.5, 0, 2.8, 0.05); else MGS.bell(n, 0, 1.8, 0.04);        // el nudo largo suena grave y largo
  arHaptic(ctrl, site.kind === 'unit' ? 0.6 : 0.35, site.kind === 'unit' ? 70 : 35);
  if (c.tied >= c.sites.length) {                                                                    // cuerda leída: revela su concepto
    c.done = true; AR_Q.done++;
    MGS.arpeggio([c.i % 6, (c.i + 2) % 6], 0.12, 2.2, 0.03); arHaptic(ctrl, 0.8, 120);
    const sp = arTextSprite(c.d[L][0], c.d[L][1], 0.46, 0.2), R = AR_Q.R * 0.78;
    sp.position.set(c.dir.x * R, c.cg.position.y + 0.17 + (c.i % 2) * 0.07, c.dir.z * R); AR_Q.group.add(sp);
    AR_Q.captions.push({ sp, age: 0 });
    c.sites.forEach(s => arSpark(c.cg.position.x, c.cg.position.y - s.t * c.len, c.cg.position.z, c.d.hex, 10));
    if (AR_Q.done >= AR_Q_DATA.length) {
      AR_Q.won = true; AR_Q.winT = 0; playSound('levelup'); MGS.arpeggio([0, 1, 2, 3, 5, 4], 0.16, 2.8, 0.04);
      for (let k = 0; k < 90; k++) { const a = Math.random() * 6.2832; arSpark(Math.cos(a) * AR_Q.R, AR_Q.ring.geometry.attributes.position.array[1], Math.sin(a) * AR_Q.R, 0xe7e4de, 1); }
      arQuipuHint(L === 'en' ? 'What was woven is now remembered' : 'Lo tejido ahora se recuerda', 9);
    }
  }
}
function arQuipuTick() {                                                     // cada cuadro, durante la sesión AR
  if (!AR_Q.active || !AR_Q.group) return;
  arFHUpdate();
  const now = performance.now(), dt = Math.min(0.05, (now - AR_Q.last) / 1000); AR_Q.last = now; AR_Q.t += dt;
  const t = AR_Q.t, reduce = reduceMotionMQ.matches;
  AR_Q.group.updateMatrixWorld(true);

  // punteros: los dos controladores (o el dedo sobre la pantalla, que llega como controlador con rayo mientras se toca)
  const ptrs = [];
  [xrController1, xrController2].forEach(ct => {
    if (!ct.visible) return;
    ct.updateMatrixWorld(true);
    _arO.setFromMatrixPosition(ct.matrixWorld); _arM.identity().extractRotation(ct.matrixWorld); _arD.set(0, 0, -1).applyMatrix4(_arM).normalize();
    ptrs.push({ ct, o: _arO.clone(), d: _arD.clone(), pressed: !!ct.userData.sel });
  });
  AR_Q.sites.forEach(s => {
    if (s.tied) return;
    s.knot.getWorldPosition(_arP);
    for (const p of ptrs) {
      const near = p.o.distanceTo(_arP) < 0.085;                                                      // la mano / el controlador toca el nudo
      const v = _arP.clone().sub(p.o), along = v.dot(p.d), perp = v.sub(p.d.clone().multiplyScalar(along)).length();
      if (near || (p.pressed && along > 0 && perp < 0.06)) { arQuipuTie(s, p.ct); break; }           // o el rayo (dedo/gatillo) roza el nudo
    }
  });

  AR_Q.cords.forEach(c => {
    c.glow = Math.max(0, c.glow - dt * 1.2);
    const amp = (reduce ? 0.004 : 0.03) * (1 + c.glow * 2.5);
    c.cg.rotation.x = Math.sin(t * 0.8 + c.phase) * amp; c.cg.rotation.z = Math.cos(t * 0.6 + c.phase * 1.3) * amp;
    c.mat.opacity = c.done ? 0.65 : 0.3 + c.glow * 0.4;
    c.thread.material.uniforms.uOpacity.value = (c.done ? 1 : 0.75) + c.glow * 0.5;
    c.sites.forEach(s => {
      if (s.tied) s.appear = Math.min(1, s.appear + dt * 3.5);
      const e = s.tied ? 1 - Math.pow(1 - s.appear, 3) * (1 + 0.6 * (1 - s.appear)) : 0;            // aparece con un pequeño rebote
      const len = s.kind === 'unit' ? 1 + 0.22 * s.turns : 1;                                          // nudo largo: más vueltas, más largo
      s.knot.scale.set(Math.max(0.001, e), Math.max(0.001, e * (s.kind === 'unit' ? 1 + 0.1 * s.turns : 1) * (len > 1 ? 1 : 1)), Math.max(0.001, e));
      if (s.tied) { s.deco.rotation.y += dt * (reduce ? 0.2 : 0.9) * (s.kind === 'unit' ? -1 : 1); s.halo.material.opacity = 0.4 + 0.25 * Math.sin(t * 2 + c.i) + c.glow * 0.4; }
      s.ghost.material.opacity = s.tied ? 0 : 0.22 + 0.14 * Math.sin(t * 2.2 + c.i * 0.7 + s.k);
    });
  });
  // polvo que asciende despacio; chispas con su gravedad invertida
  const MA = AR_Q.motes.geometry.attributes.position.array, y0 = AR_Q.motes.userData.y0;
  if (!reduce) for (let i = 0; i < MA.length; i += 3) { MA[i + 1] += dt * (0.015 + (i % 7) * 0.003); if (MA[i + 1] > y0 + 0.9) MA[i + 1] = y0 - 0.9; }
  AR_Q.motes.geometry.attributes.position.needsUpdate = true;
  const F = AR_Q.fx, FA = F.pts.geometry.attributes;
  for (let i = 0; i < F.n; i++) {
    if (F.life[i] <= 0) { FA.aAlpha.array[i] = 0; continue; }
    F.life[i] -= dt * 0.9; const k = Math.max(0, F.life[i]);
    FA.position.array[i * 3] += F.vel[i * 3] * dt; FA.position.array[i * 3 + 1] += F.vel[i * 3 + 1] * dt; FA.position.array[i * 3 + 2] += F.vel[i * 3 + 2] * dt;
    F.vel[i * 3] *= 0.97; F.vel[i * 3 + 1] *= 0.97; F.vel[i * 3 + 2] *= 0.97; FA.aAlpha.array[i] = k;
  }
  FA.position.needsUpdate = FA.aAlpha.needsUpdate = FA.aSize.needsUpdate = FA.aCol.needsUpdate = true;
  AR_Q.captions.forEach((cp, idx, arr) => {                                                           // solo las 3 últimas se ven; las antiguas se desvanecen
    cp.age += dt; const newest = idx >= arr.length - 3;
    cp.sp.material.opacity += ((newest ? Math.min(1, cp.age * 1.2) : 0) - cp.sp.material.opacity) * Math.min(1, dt * 3);
  });
  AR_Q.ring.rotation.y += dt * 0.02 * (reduce ? 0 : 1);
  if (AR_Q.won) { AR_Q.winT += dt; AR_Q.ring.material.uniforms.uOpacity.value = 1.1 + 0.5 * Math.sin(AR_Q.winT * 3); AR_Q.ring.scale.setScalar(1 + 0.012 * Math.sin(AR_Q.winT * 2)); if (!reduce && Math.random() < 0.3) { const a = Math.random() * 6.2832; arSpark(Math.cos(a) * AR_Q.R, AR_Q.ring.geometry.attributes.position.array[1], Math.sin(a) * AR_Q.R, 0xe7e4de, 1); } }
  if (AR_Q.hint) {
    AR_Q.hintT -= dt;
    AR_Q.hint.material.opacity += ((AR_Q.hintT > 0 ? 1 : 0) - AR_Q.hint.material.opacity) * Math.min(1, dt * 3);
    if (AR_Q.hintT < -1) { camera.remove(AR_Q.hint); if (AR_Q.hint.material.map) AR_Q.hint.material.map.dispose(); AR_Q.hint.material.dispose(); AR_Q.hint = null; }
  }
}
window.arQuipuTick = arQuipuTick;

// los controladores guardan su fuente (para la vibración) y si el gatillo/dedo está pulsado (para leer con el rayo)
[xrController1, xrController2].forEach(ct => {
  ct.addEventListener('connected', (e) => { ct.userData.src = e.data; });
  ct.addEventListener('disconnected', () => { ct.userData.src = null; ct.userData.sel = false; });
  ct.addEventListener('selectstart', () => { ct.userData.sel = true; });
  ct.addEventListener('selectend', () => { ct.userData.sel = false; });
});

window.arQuipuToggle = arQuipuToggle; window.arQuipuStop = arQuipuStop;


let arModelIndex = 0; 
window.spawnedObjects = []; 

xrController1.addEventListener('select', (event) => {
  if (window.isARSession) {
    if (window.arTryExit && window.arTryExit(xrController1)) return;               // botón SALIR AR flotante
    if (window.arQuipu && window.arQuipu.active) return;                            // en modo quipu el toque lee nudos, no coloca modelos
    if (window.arTurtle && window.arTurtle.active) return;                          // en modo tortuga el toque siembra y riega
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
  { id: 'colossus',     es: ['Primer coloso', 'Encuentra tu primer coloso.'],                       en: ['First colossus', 'Find your first colossus.'] },
  { id: 'bestiary',     es: ['Colección de colosos', 'Encuentra los nueve colosos del universo.'],   en: ['Colossi collection', 'Find all nine colossi of the universe.'],
    reward: { es: 'Recompensa: la Colección completa', en: 'Reward: the complete Collection' } },
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
  colossus:     '<path d="M3 18c2-6 5-9 9-9s7 3 9 9z" fill="currentColor" fill-opacity=".12"/><circle cx="12" cy="6.5" r="1.8"/><path d="M9 18v-3M15 18v-3"/>',
  bestiary:     '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" fill="currentColor" fill-opacity=".1"/><path d="M5 17a3 3 0 0 1 3-3h11"/><circle cx="12" cy="9" r="1.6"/><path d="M9 9h.1M15 9h.1"/>',
  secret:       '<circle cx="12" cy="12" r="9"/><path d="M9.4 9.6a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1 .9-1 1.8"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>',
  trophy:       '<path d="M8 4h8v5a4 4 0 0 1-8 0z" fill="currentColor" fill-opacity=".1"/><path d="M8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5A3 3 0 0 1 16 10.5"/><path d="M12 13v4M10 17h4v3.5h-4zM8.5 20.5h7"/>'

};

const ACH_CATS = {
  first: 'explore', cartographer: 'explore', anomaly: 'explore', core: 'explore',
  poetica: 'create', erratica: 'create', friccion: 'create', trio: 'create', retro: 'create', painter: 'create',
  combo: 'combat', boss: 'combat', untouched: 'combat', slash: 'combat', dispel: 'combat',
  colossus: 'colossi', bestiary: 'colossi',
  hall: 'system', twoWorlds: 'system', reader: 'system', polyglot: 'system', sovereignty: 'system'
};
const ACH_CAT_LABEL = {
  explore: { es: 'Exploración', en: 'Exploration' }, create: { es: 'Creación', en: 'Creation' },
  colossi: { es: 'Colosos', en: 'Colossi' },
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
  try { updateCollectionMenu(); } catch (e) {}
}
function ensureCollectionMenu() {
  const m = menuList(); if (!m || !m.ul || document.getElementById('menu-collection')) return;
  const li = document.createElement('li');
  li.innerHTML = '<a href="#" id="menu-collection" class="social-item"></a>';
  const ach = document.getElementById('menu-achievements'), ref = ach ? ach.closest('li') : m.retroLi;
  m.ul.insertBefore(li, ref && ref.nextSibling ? ref.nextSibling : m.retroLi);
  li.firstChild.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (typeof sideMenu !== 'undefined') sideMenu.classList.remove('open'); if (window.openBestiary) window.openBestiary(); });
  const dm = document.createElement('li'); dm.innerHTML = '<a href="#" id="menu-dome" class="social-item"></a>'; m.ul.insertBefore(dm, li.nextSibling);
  dm.firstChild.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (typeof sideMenu !== 'undefined') sideMenu.classList.remove('open'); if (window.domeToggle) window.domeToggle(true); });
  updateCollectionMenu();
}
function ensureCollectionButton() {                                                   // botón directo en la pantalla principal: aparece al encontrar el primer coloso
  const n = (typeof colossiCount === 'function') ? colossiCount() : 0; let b = document.getElementById('btn-collection'); const en = window.currentLang === 'en';
  if (n < 1) { if (b) b.style.display = 'none'; return; }
  if (!b) {
    if (!document.getElementById('btn-collection-style')) { const st = document.createElement('style'); st.id = 'btn-collection-style';
      st.textContent = `#btn-collection{position:fixed;right:25px;bottom:255px;box-sizing:border-box;width:40px;height:40px;padding:0;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,.03);border:1px solid rgba(201,168,92,.55);color:#e7d9b4;cursor:pointer;z-index:10001;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font-size:17px;line-height:1;transition:box-shadow .3s ease,background .3s ease}
        #btn-collection:hover{background:rgba(201,168,92,.14)} #btn-collection small{position:absolute;right:-4px;bottom:-5px;font:600 .52rem/1 -apple-system,Helvetica,Arial,sans-serif;letter-spacing:.04em;background:#0b0c10;border:1px solid rgba(201,168,92,.55);border-radius:9px;padding:2px 4px;color:#e7d9b4}
        #btn-collection.is-new{animation:colNew 2s ease-in-out infinite alternate} @keyframes colNew{from{box-shadow:0 0 6px rgba(201,168,92,.2)}to{box-shadow:0 0 24px rgba(201,168,92,.75)}}
        @media (max-width:768px){#btn-collection{bottom:195px}} @media (prefers-reduced-motion:reduce){#btn-collection.is-new{animation:none;box-shadow:0 0 16px rgba(201,168,92,.6)}}`; document.head.appendChild(st); }
    b = document.createElement('button'); b.id = 'btn-collection'; b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); window._colNewUntil = 0; if (window.openBestiary) window.openBestiary(); });
    ['mousedown', 'touchstart', 'pointerdown'].forEach(ev => b.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
    document.body.appendChild(b);
    setInterval(() => { const busy = window.isColossusActive || window.isTortugaActive || window.isWhaleActive || window.isHogueraActive || window.isSputnikActive || window.isTuningGameActive || window.isWiringGameActive || window._bstOpen || window.isMiniIntro || document.body.classList.contains('terminal-mode');
      b.style.display = busy ? 'none' : 'flex'; b.classList.toggle('is-new', !!(window._colNewUntil && Date.now() < window._colNewUntil)); }, 500);
  }
  b.title = en ? 'Colossi collection' : 'Colección de colosos'; b.setAttribute('aria-label', b.title); b.innerHTML = '🐾<small>' + n + '/9</small>';
}
function updateCollectionMenu() { try { ensureCollectionButton(); } catch (e) {} const dm = document.getElementById('menu-dome'); if (dm) dm.textContent = (window.currentLang === 'en' ? '◐ Dome mode' : '◐ Modo Domo') + '  ·  Ctrl+Shift+D'; const a = document.getElementById('menu-collection'); if (a) a.textContent = `🐾 ${window.currentLang === 'en' ? 'Colossi collection' : 'Colección de colosos'} · ${typeof colossiCount === 'function' ? colossiCount() : 0}/9`; }
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
    if (act && act.dataset.act === 'bestiary' && window.openBestiary) window.openBestiary();
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
  const rows = ['explore', 'create', 'colossi', 'combat', 'system'].map(cat => {
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
  if (colossiCount() >= 1) rewards.push(`<li class="ach-reward"><span aria-hidden="true">🐾</span><div><strong>${en ? 'Colossi collection' : 'Colección de colosos'} · ${colossiCount()}/${COLOSSI.length}</strong>
      <small>${colossiCount() >= COLOSSI.length ? (en ? 'Complete: with the concept map.' : 'Completo: con el mapa de conceptos.') : (en ? 'Each colossus adds its entry; the concept map appears when all nine are found.' : 'Cada coloso suma su ficha; el mapa de conceptos aparece al encontrar los nueve.')}</small></div>
      <button type="button" class="ach-act" data-act="bestiary">${en ? 'Open' : 'Abrir'}</button></li>`);
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
  colossus:     () => colossiCount() >= 1,
  bestiary:     () => colossiCount() >= COLOSSI.length,
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

ensureAchievementsMenu(); try { ensureCollectionMenu(); } catch (e) {}
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

  if ((window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive)) && window.hgPose) {
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

// ==========================================================================================
// ◐ MODO DOMO — domemaster (fisheye azimutal equidistante 1:1) en vivo
//   Se renderiza la escena en un cubemap desde la cámara y un shader la convierte en el círculo del domo.
//   Centro de la imagen = cenit; arriba de la imagen = frente del domo. Para Amateras/NDI: abre la página en una fuente
//   «Navegador» de OBS de 2048×2048 con  ?domo=1  y emite esa fuente por NDI (DistroAV).
//   Teclas: Ctrl+Shift+D entra/sale · G cuadrícula · M espejo · Esc sale (si no hay un juego abierto).
// ==========================================================================================
const DOME = { on: false, fov: 180, elev: 0, res: 1024, grid: false, flip: false, rt: null, cam: null, quat: null, scene: null, ortho: null, mat: null, ui: null, idleT: 0, styled: false };
function domeBuild() {
  if (DOME.scene) return;
  DOME.scene = new THREE.Scene(); DOME.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  DOME.mat = new THREE.ShaderMaterial({
    uniforms: { tCube: { value: null }, uFov: { value: Math.PI }, uElev: { value: 0 }, uGrid: { value: 0 }, uFlip: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `precision highp float; uniform samplerCube tCube; uniform float uFov, uElev, uGrid, uFlip; varying vec2 vUv;
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float r = length(p);
        if (r > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
        float th = r * uFov * 0.5, ph = atan(p.x, p.y);
        vec3 d = vec3(sin(th) * sin(ph), cos(th), -sin(th) * cos(ph));
        float c = cos(uElev), s = sin(uElev); d = vec3(d.x, d.y * c + d.z * s, -d.y * s + d.z * c);
        d.x *= uFlip;
        vec3 col = textureCube(tCube, d).rgb;
        if (uGrid > 0.5) {
          float deg = th * 57.29578, md = ph * 57.29578, lw = max(fwidth(deg), 0.0001), lm = min(max(fwidth(md), 0.0001), 3.0);
          float par = 1.0 - smoothstep(0.0, lw * 1.6, abs(fract(deg / 15.0 + 0.5) - 0.5) * 15.0);
          float mer = (1.0 - smoothstep(0.0, lm * 1.6, abs(fract(md / 30.0 + 0.5) - 0.5) * 30.0)) * smoothstep(0.0, 6.0, deg);
          float hor = 1.0 - smoothstep(0.0, lw * 2.2, abs(deg - 90.0)), edge = 1.0 - smoothstep(0.0, lw * 2.0, abs(r - 1.0) * uFov * 28.6479);
          float front = (1.0 - smoothstep(0.0, lm * 2.4, abs(md))) * step(p.y, 0.0 + 1.0) * smoothstep(0.0, 6.0, deg);
          col = mix(col, vec3(0.25, 0.9, 1.0), 0.55 * max(par, mer)); col = mix(col, vec3(1.0, 0.8, 0.2), hor * 0.85); col = mix(col, vec3(1.0, 0.35, 0.2), front * 0.9); col = mix(col, vec3(1.0), edge * 0.7);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthTest: false, depthWrite: false
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), DOME.mat); quad.frustumCulled = false; DOME.scene.add(quad);
}
function domeCube() {
  if (DOME.rt && DOME.rt.width === DOME.res) return;
  if (DOME.rt) DOME.rt.dispose();
  DOME.rt = new THREE.WebGLCubeRenderTarget(DOME.res, { generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  if (!DOME.cam) { DOME.cam = new THREE.CubeCamera(0.1, 1000, DOME.rt); camera.add(DOME.cam); } else DOME.cam.renderTarget = DOME.rt;
  DOME.mat.uniforms.tCube.value = DOME.rt.texture;
}
function domeRender() {
  domeCube();
  const u = DOME.mat.uniforms; u.uFov.value = DOME.fov * Math.PI / 180; u.uElev.value = DOME.elev * Math.PI / 180; u.uGrid.value = DOME.grid ? 1 : 0; u.uFlip.value = DOME.flip ? -1 : 1;
  const keep = GLOW_SCALE.value; GLOW_SCALE.value = DOME.res * 0.5 * Math.tan(THREE.MathUtils.degToRad(37.5));      // tamaño de los puntos en píxeles de cada cara del cubo
  camera.updateMatrixWorld(true); DOME.cam.update(renderer, scene);
  GLOW_SCALE.value = keep;
  const w = window.innerWidth, h = window.innerHeight, side = Math.min(w, h);
  renderer.setRenderTarget(null); renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h); renderer.setClearColor(0x000000, 1); renderer.clear();
  renderer.setViewport((w - side) / 2, (h - side) / 2, side, side); renderer.render(DOME.scene, DOME.ortho);
  renderer.setViewport(0, 0, w, h);
}
function domeToggle(on) {
  on = on === undefined ? !DOME.on : !!on; if (on === DOME.on) return;
  DOME.on = window.__dome = on;
  if (!DOME.styled) { DOME.styled = true; const st = document.createElement('style');
    st.textContent = `body.dome-mode{background:#000 !important;overflow:hidden} body.dome-mode #bg-canvas{position:fixed !important;inset:0 !important;width:100vw !important;height:100vh !important;z-index:2147483100 !important;background:#000 !important} body.dome-mode.dome-idle{cursor:none}
      #dome-ui{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483300;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;max-width:94vw;padding:10px 14px;background:rgba(8,9,12,.82);border:1px solid rgba(231,228,222,.18);color:#e7e4de;font:300 .7rem -apple-system,Helvetica,Arial,sans-serif;letter-spacing:.08em;transition:opacity .5s ease}
      #dome-ui.hide{opacity:0;pointer-events:none} #dome-ui button,#dome-ui select{background:rgba(231,228,222,.06);border:1px solid rgba(231,228,222,.22);color:#e7e4de;font:inherit;padding:5px 10px;cursor:pointer} #dome-ui button.on{border-color:#c9a85c;color:#e7d9b4} #dome-ui input{width:90px}`;
    document.head.appendChild(st); }
  document.body.classList.toggle('dome-mode', on);
  if (on) { domeBuild(); DOME.prevSize = [window.innerWidth, window.innerHeight]; domeUI(); domeUIShow(); }
  else { if (DOME.ui) DOME.ui.remove(), DOME.ui = null; renderer.setClearColor(0x000000, 0); renderer.setViewport(0, 0, window.innerWidth, window.innerHeight); document.body.classList.remove('dome-idle'); }
}
function domeUI() {
  const en = window.currentLang === 'en', ui = document.createElement('div'); ui.id = 'dome-ui'; DOME.ui = ui;
  const btn = (txt, on, fn) => { const b = document.createElement('button'); b.textContent = txt; if (on) b.classList.add('on'); b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); }); return b; };
  const grp = (label) => { const s = document.createElement('span'); s.textContent = label + ' '; s.style.opacity = '.6'; return s; };
  ui.appendChild(grp(en ? 'DOME' : 'DOMO'));
  const fovs = [180, 200, 220].map(v => btn(v + '°', v === DOME.fov, () => { DOME.fov = v; fovs.forEach((b, i) => b.classList.toggle('on', [180, 200, 220][i] === v)); })); fovs.forEach(b => ui.appendChild(b));
  ui.appendChild(grp(en ? 'ELEV.' : 'ELEV.')); const el = document.createElement('input'); el.type = 'range'; el.min = 0; el.max = 60; el.value = DOME.elev; const ev = document.createElement('span'); ev.textContent = DOME.elev + '°';
  el.addEventListener('input', () => { DOME.elev = +el.value; ev.textContent = el.value + '°'; }); ui.appendChild(el); ui.appendChild(ev);
  ui.appendChild(grp(en ? 'FACE' : 'CARA')); const rs = [512, 1024, 2048].map(v => btn(v === 512 ? '0.5K' : v === 1024 ? '1K' : '2K', v === DOME.res, () => { DOME.res = v; rs.forEach((b, i) => b.classList.toggle('on', [512, 1024, 2048][i] === v)); })); rs.forEach(b => ui.appendChild(b));
  ui.appendChild(btn(en ? 'GRID (G)' : 'CUADRÍCULA (G)', DOME.grid, (b) => { DOME.grid = !DOME.grid; b.classList.toggle('on', DOME.grid); }));
  ui.appendChild(btn(en ? 'MIRROR (M)' : 'ESPEJO (M)', DOME.flip, (b) => { DOME.flip = !DOME.flip; b.classList.toggle('on', DOME.flip); }));
  const sel = document.createElement('select'); sel.innerHTML = '<option value="">' + (en ? 'Colossus…' : 'Coloso…') + '</option>' + COLOSSI.map(c => `<option value="${c.id}">${c[en ? 'en' : 'es'][0]}</option>`).join('');
  sel.addEventListener('change', () => { const id = sel.value; sel.value = ''; if (id) colVisit(id, true); }); ui.appendChild(sel);
  ui.appendChild(btn(en ? 'CLOSE COLOSSUS' : 'CERRAR COLOSO', false, () => { try { MG.abort(); } catch (e) {} }));
  ui.appendChild(btn(en ? 'EXIT DOME' : 'SALIR DEL DOMO', false, () => domeToggle(false)));
  const hint = document.createElement('div'); hint.style.cssText = 'width:100%;text-align:center;opacity:.55;font-size:.62rem'; hint.textContent = en ? 'Top of the image = dome front · centre = zenith · OBS Browser Source 2048×2048 → NDI' : 'Arriba de la imagen = frente del domo · centro = cenit · OBS Fuente Navegador 2048×2048 → NDI'; ui.appendChild(hint);
  ['mousedown', 'touchstart', 'pointerdown', 'pointerup', 'wheel'].forEach(e2 => ui.addEventListener(e2, (e) => e.stopPropagation(), { passive: true }));
  document.body.appendChild(ui);
}
function domeUIShow() { DOME.idleT = 0; if (DOME.ui) DOME.ui.classList.remove('hide'); document.body.classList.remove('dome-idle'); }
window.addEventListener('mousemove', () => { if (DOME.on) domeUIShow(); }, { passive: true });
window.addEventListener('touchstart', () => { if (DOME.on) domeUIShow(); }, { passive: true });
setInterval(() => { if (!DOME.on) return; DOME.idleT += 0.5; if (DOME.idleT > 4 && DOME.ui && !DOME.ui.matches(':hover')) { DOME.ui.classList.add('hide'); document.body.classList.add('dome-idle'); } }, 500);
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) { e.preventDefault(); e.stopImmediatePropagation(); domeToggle(); return; }
  if (!DOME.on || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'g' || e.key === 'G') { DOME.grid = !DOME.grid; if (DOME.ui) DOME.ui.querySelectorAll('button').forEach(b => { if (/^(CUADR|GRID)/.test(b.textContent)) b.classList.toggle('on', DOME.grid); }); domeUIShow(); }
  else if (e.key === 'm' || e.key === 'M') { DOME.flip = !DOME.flip; if (DOME.ui) DOME.ui.querySelectorAll('button').forEach(b => { if (/^(ESPEJO|MIRROR)/.test(b.textContent)) b.classList.toggle('on', DOME.flip); }); domeUIShow(); }
  else if (e.key === 'Escape' && !window.isColossusActive && !window.isHogueraActive && !window.isWhaleActive && !window.isTortugaActive && !window.isMiniIntro) { e.preventDefault(); domeToggle(false); }
}, true);
window.domeToggle = domeToggle; window.domeRender = domeRender; window.DOME = DOME;
if (/[?&]domo=1\b/.test(location.search)) { let kicked = false; const waitDome = setInterval(() => {                         // arranque automático para la fuente Navegador de OBS: entra solo y activa el domo
  const sb = document.getElementById('start-btn');
  if (!kicked && sb && sb.style.display === 'block' && !isGameStarted && typeof initSystem === 'function') { kicked = true; try { initSystem(true); } catch (e) {} }
  if (isGameStarted) { clearInterval(waitDome); setTimeout(() => domeToggle(true), 1200); } }, 600); }

renderer.setAnimationLoop((timestamp, frame) => {
  // 🛟 Red de seguridad: three.js solo programa el SIGUIENTE cuadro si el actual termina sin lanzar. Un solo error
  // (p. ej. leer un elemento que ya se borró de una lista) dejaba el juego congelado para siempre.
  // Ahora el error se registra y el bucle sigue vivo.
  try {
 // 🔥 ANIMACIÓN DEL VIAJERO (Libre y Arrastrable)
   
  const isXR = renderer.xr.isPresenting;
  const session = isXR ? renderer.xr.getSession() : null;
  const isAR = isXR && window.isARSession; 
  if (isAR && window.arQuipuTick) window.arQuipuTick();
  if (isAR && window.arTurtleTick) window.arTurtleTick();

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
  if ((window.isWiringGameActive || window.isTuningGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) && window.updateMiniGames) window.updateMiniGames();
  const now = performance.now(); frames++;
  if (now >= lastTime + 1000) { if((frames * 1000 / (now - lastTime)) < 30) lowFPSCount++; else lowFPSCount = 0;
    // 🔥 ACTUALIZADOR DEL HUD DE COMBO EN TIEMPO REAL
  const comboUi = document.getElementById('combo-value');
  if (comboUi && !window.isTuningGameActive && !window.isWiringGameActive && !(window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) comboUi.innerText = 'x' + (typeof combatCombo !== 'undefined' ? combatCombo : 0);
    if(lowFPSCount > 3 && isBloomEnabled && !isXR) { isBloomEnabled = false; bloomPass.strength = 0; 
      document.getElementById('menu-bloom').innerText = '✨ Efecto Neón: OFF'; 
      document.getElementById('menu-bloom').style.color = '#888'; } frames = 0; lastTime = now; }

  if (isShooting && isGameStarted && !isUIOpen && !isAR && !window.isTuningGameActive && !window.isWiringGameActive && !(window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) { if (now - lastShotTime > FIRE_COOLDOWN) { fireLaser(); lastShotTime = now; } }

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
if (!isAR && !(window.isTuningGameActive || window.isWiringGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive)))) {   // la red de energía no debe reaparecer dentro de un Juego Otro
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
  } else if (window.__dome) {
    try { domeRender(); } catch (e) { console.error('Modo Domo:', e); domeToggle(false); }
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

  const uiElements = ['portfolio-header', 'unified-hud', 'universe-legend', 'touch-controls', 'legend-sidebar', 'dac-microsite', 'legend-toggle-btn', 'btn-sword', 'btn-collection'];
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
  _b: null,
  bus() {                                                           // bus común: todo pasa por una sala grande y oscura (cola de ~3 s)
    if (this._b && this._b.ctx === audioCtx) return this._b;
    try {
      const ctx = audioCtx, input = ctx.createGain(), wet = ctx.createGain(), conv = ctx.createConvolver();
      const sr = ctx.sampleRate, len = Math.floor(sr * 3.2), buf = ctx.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.22; d[i] = lp * Math.pow(1 - i / len, 2.4) * 1.8; } }
      conv.buffer = buf; wet.gain.value = 0.55;
      input.connect(masterGain); input.connect(conv); conv.connect(wet); wet.connect(masterGain);
      return (this._b = { ctx, input, wet });
    } catch (e) { return (this._b = { ctx: audioCtx, input: masterGain, wet: null }); }
  },
  bell(freq, delay, dur, vol) {                                     // voz de cuerdas: dos arcos desafinados + un chelo una octava abajo, ataque suave y caída larga
    if (!this.ok()) return;
    const ctx = audioCtx, B = this.bus(), now = ctx.currentTime + (delay || 0), atk = Math.min(0.28, 0.035 + dur * 0.05), end = now + Math.max(dur, atk + 0.2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(Math.min(2600, freq * 1.5), now); lp.frequency.linearRampToValueAtTime(Math.min(3600, freq * 3.4), now + atk * 1.4); lp.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 1.3), end);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(vol * 0.85, now + atk); g.gain.exponentialRampToValueAtTime(0.0001, end);
    lp.connect(g); g.connect(B.input);
    let vg = null;
    if (dur > 1.1) {                                                // vibrato lento que se abre a medida que la nota respira
      const vib = ctx.createOscillator(); vib.frequency.value = 4.6 + Math.random() * 0.8; vg = ctx.createGain();
      vg.gain.setValueAtTime(0, now); vg.gain.linearRampToValueAtTime(freq * 0.0045, now + Math.min(1.2, dur * 0.5)); vib.connect(vg); vib.start(now); vib.stop(end + 0.1);
    }
    [['sawtooth', 1, 0.0042, 0.34], ['sawtooth', 1, -0.0047, 0.34], ['triangle', 0.5, 0, 0.3], ['sine', 2, 0, 0.1]].forEach(([type, m, dt, gain]) => {
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = freq * m * (1 + dt); og.gain.value = gain;
      if (vg) vg.connect(o.frequency);
      o.connect(og); og.connect(lp); o.start(now); o.stop(end + 0.1);
    });
  },
  ping(freq, delay, dur, vol) {                                     // una nota pura y lejana (el bip del Sputnik): seno con eco de sala
    if (!this.ok()) return;
    const ctx = audioCtx, B = this.bus(), now = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq; g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(vol, now + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(B.input); o.start(now); o.stop(now + dur + 0.05);
  },
  arpeggio(idx, step, dur, vol) { idx.forEach((n, i) => this.bell(this.NOTES[n], i * step, dur, vol)); },
  knock() {                                                         // un golpe amortiguado, no un impacto eléctrico
    if (!this.ok()) return;
    const now = audioCtx.currentTime, o = audioCtx.createOscillator(), gn = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, now); o.frequency.exponentialRampToValueAtTime(62, now + 0.4);
    gn.gain.setValueAtTime(0, now); gn.gain.linearRampToValueAtTime(0.11, now + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    o.connect(gn); gn.connect(masterGain); o.start(now); o.stop(now + 0.6);
    this.bell(233.08, 0.02, 1.6, 0.02);                             // sombra grave, levemente disonante
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
    else if (window.isWhaleActive) window.abortWhaleGame();
    else if (window.isSputnikActive) window.abortSputnikGame();
    else if (window.isTortugaActive) window.abortTortugaGame();
    else if (window.isColossusActive) window.abortColossusGame();
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
  if (window.isWhaleActive) whUpdate(dt);
  if (window.isSputnikActive) sptUpdate(dt);
  if (window.isTortugaActive) trpUpdate(dt);
  if (window.isColossusActive) colUpdate(dt);
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
  },
  sputnik: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  MATERIA Y MEMORIA', t: 'Un compañero de viaje',
        p: ['Sputnik significa «compañero de viaje». Era una esfera pulida de 58 centímetros, con cuatro antenas y un transmisor que solo decía bip. Radioaficionados lo siguieron desde sus patios; duró 92 días en el cielo y se quemó al volver.',
            'Una sonda dada de baja no es una máquina muerta: es un archivo que decide qué guarda, una voz que llega tarde y un cuerpo que se deja llevar. Encajar, transmitir, soltar.'] },
      outro: { k: 'ANA-ARQUEOLOGÍA  ·  MEMORIA', t: 'Lo que se lleva',
        p: ['Encajar lo roto, elegir qué enviar antes de que se apague, hablar con retraso y dejar ir: la memoria técnica no es almacenar, es cuidar con pérdida.',
            'Una sonda dada de baja sigue diciendo algo mientras alguien se tome el tiempo de escuchar el bip.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  MATTER AND MEMORY', t: 'A fellow traveler',
        p: ['Sputnik means "fellow traveler". It was a polished 58-centimetre sphere with four antennae and a transmitter that only said beep. Radio amateurs followed it from their yards; it lasted 92 days in the sky and burned up on its return.',
            'A decommissioned probe is not a dead machine: it is an archive that decides what to keep, a voice that arrives late and a body that lets itself be carried. Fit, transmit, let go.'] },
      outro: { k: 'AN-ARCHAEOLOGY  ·  MEMORY', t: 'What is carried',
        p: ['Fitting what is broken, choosing what to send before it goes dark, speaking with delay and letting go: technical memory is not storing, it is caring with loss.',
            'A decommissioned probe keeps saying something as long as someone takes the time to listen to the beep.'] }
    }
  },
  condor: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  PEDAGOGÍA DEL PERMISO', t: 'Pedir permiso',
        p: ['Un cóndor de ceniza vigila desde un risco. No se le puede perseguir: se aleja. Solo deja que te acerques cuando mira a otro lado, y solo si, mientras te mira, sabes quedarte quieto.', 'Enseñar y aprender también son umbrales: no se cruzan por empuje, se cruzan cuando el otro lo permite.'] },
      outro: { k: 'DISEÑO DE SUFICIENCIA  ·  UMBRAL', t: 'Lo que se concede',
        p: ['La confianza no se gana avanzando, se gana esperando bien. Una pluma de ceniza es lo que queda cuando alguien aceptó ser acompañado.', 'Una clase es un lugar donde alguien te deja acercarte a lo que sabe.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  PEDAGOGY OF PERMISSION', t: 'Asking permission',
        p: ['An ash condor watches from a cliff. It cannot be chased: it moves away. It lets you come near only when it looks elsewhere, and only if, while it looks at you, you can stay still.', 'Teaching and learning are thresholds too: they are not crossed by pushing, but when the other allows it.'] },
      outro: { k: 'DESIGN OF SUFFICIENCY  ·  THRESHOLD', t: 'What is granted',
        p: ['Trust is not earned by advancing, but by waiting well. A feather of ash is what remains when someone accepted company.', 'A class is a place where someone lets you come close to what they know.'] }
    }
  },
  arbol: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  MUTUALISMO', t: 'Una red de cuidado',
        p: ['Un pewen —la araucaria sagrada del pueblo mapuche-pehuenche— cuyas raíces son racks de servidores alimenta sus ramas con esporas. Nadie puede encender todas a la vez: cada rama se apaga sola si no se la atiende.', 'Un laboratorio de investigación también es un ecosistema: lo que brilla, brilla porque otros alimentan lo que no se ve.'] },
      outro: { k: 'ANA-ARQUEOLOGÍA  ·  CUIDADO', t: 'Nada brilla solo',
        p: ['Repartir el cuidado es una forma de diseño. La red no se enciende con un gran gesto, sino con muchos pequeños y a tiempo.', 'Una investigación es una red que se mantiene viva mientras alguien la alimenta.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  MUTUALISM', t: 'A network of care',
        p: ['A pewen —the sacred araucaria of the Mapuche-Pehuenche people— whose roots are server racks feeds its branches with spores. Nobody can light them all at once: each branch dims on its own unless it is tended.', 'A research lab is also an ecosystem: what shines, shines because others feed what cannot be seen.'] },
      outro: { k: 'ANA-ARCHAEOLOGY  ·  CARE', t: 'Nothing shines alone',
        p: ['Sharing care is a form of design. The network is not lit by one grand gesture, but by many small ones, on time.', 'Research is a network that stays alive as long as someone feeds it.'] }
    }
  },
  escarabajo: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  HARDWARE COMO LENGUAJE', t: 'Cerrar el circuito',
        p: ['Un escarabajo de componentes llega sin manual. Sus seis patas se ponen de acuerdo solo cuando alguien prueba, se equivoca y vuelve a probar hasta que aparece un compás común.', 'Construir hardware desde cero es aprender a escuchar a la materia: el error no es un fallo, es una pregunta.'] },
      outro: { k: 'RETÓRICA PROCEDIMENTAL MATERIAL  ·  PRUEBA Y ERROR', t: 'Un compás común',
        p: ['El argumento de un objeto no está en lo que dice, sino en lo que se puede hacer con él. Aquí, el paso es la tesis.', 'Una consola portátil es una frase escrita con cobre.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  HARDWARE AS LANGUAGE', t: 'Closing the circuit',
        p: ['A beetle of components arrives without a manual. Its six legs agree only when someone tries, errs, and tries again until a shared beat appears.', 'Building hardware from scratch is learning to listen to matter: error is not a failure, it is a question.'] },
      outro: { k: 'MATERIAL PROCEDURAL RHETORIC  ·  TRIAL AND ERROR', t: 'A shared beat',
        p: ['An object\'s argument is not in what it says but in what can be done with it. Here, the step is the thesis.', 'A portable console is a sentence written in copper.'] }
    }
  },
  mariquita: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  CURADURÍA Y EMERGENCIA', t: 'Curar sin controlar',
        p: ['Un enjambre de fotogramas toma forma de catarina cuando recibe variedad de tonos: cada fotograma le pinta una mota. Tú invitas, pero no diriges: ella decide su rumbo y, cuando está completa, abre los élitros y se va.', 'Curar es elegir qué entra, y aceptar que lo curado ya no te pertenece.'] },
      outro: { k: 'CO-CREACIÓN  ·  SUFICIENCIA', t: 'Dejar ir',
        p: ['Una cinemateca guarda imágenes para que sigan vivas fuera de ella. La curaduría termina cuando la obra vuela.', 'Co-crear es dar forma junto a otros sin decidir el vuelo.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  CURATION AND EMERGENCE', t: 'Curating without controlling',
        p: ['A swarm of frames takes the shape of a ladybug when it receives a variety of tones: each frame paints it a spot. You invite, but you do not steer: it chooses its course and, when whole, it opens its shell and leaves.', 'To curate is to choose what comes in, and to accept that what is curated no longer belongs to you.'] },
      outro: { k: 'CO-CREATION  ·  SUFFICIENCY', t: 'Letting go',
        p: ['A film archive keeps images so that they stay alive outside it. Curation ends when the work flies.', 'To co-create is to shape together with others without deciding the flight.'] }
    }
  },
  colibri: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  EMPATÍA Y MEDIACIÓN', t: 'Escuchar el conflicto',
        p: ['Un barbudito del páramo —colibrí de cresta erizada, tan pequeño en la vida real como colosal aquí— chilla entre la niebla porque tres voces a su alrededor no se oyen: la familia, el agua y la máquina. No se le vence: se escucha a cada voz, una a la vez, y mientras escuchas a una, las otras se tensan donde no miras.', 'Resolver un conflicto es repartir la atención de forma justa, y confiar en que quien es escuchado empieza a escuchar.'] },
      outro: { k: 'GAMES FOR CHANGE  ·  ATENCIÓN EQUITATIVA', t: 'Nadie fue vencido',
        p: ['Los juegos para el cambio no ganan contra el conflicto: lo acompañan hasta que cada parte puede descansar.', 'Un colibrí que canta bajito sobre un frailejón en flor es una regla que aprendiste a cumplir con cuidado.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  EMPATHY AND MEDIATION', t: 'Listening to the conflict',
        p: ['A páramo helmetcrest —a hummingbird with a bristling crest, as tiny in life as it is colossal here— shrieks in the mist because three voices around it cannot hear each other: the family, the water and the machine. He is not defeated: each voice is listened to, one at a time, and while you listen to one, the others tense where you are not looking.', 'To resolve a conflict is to share attention fairly, and to trust that whoever is heard begins to listen.'] },
      outro: { k: 'GAMES FOR CHANGE  ·  EQUITABLE ATTENTION', t: 'No one was defeated',
        p: ['Games for change do not win against conflict: they accompany it until each party can rest.', 'A hummingbird that sings softly on a blooming frailejón is a rule you learned to keep with care.'] }
    }
  },
  medusa: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  ESPACIO PARAMÉTRICO', t: 'Explorar un cuerpo posible',
        p: ['Una medusa-leviatán es una función de tres perillas: frecuencia, densidad y fase. Entre las ciento veinticinco formas posibles, solo tres resuenan.', 'Trabajar con nodos y parámetros es explorar un espacio: no se busca la forma correcta, se escucha cuál se sostiene sola.'] },
      outro: { k: 'MATERIA Y MEMORIA  ·  RESONANCIA', t: 'Entre muchas formas',
        p: ['Lo paramétrico no es infinito, es habitable: algunas combinaciones cantan y las demás enseñan por contraste.', 'Una realidad virtual es un espacio de perillas donde el cuerpo aprende a escuchar.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  PARAMETRIC SPACE', t: 'Exploring a possible body',
        p: ['A leviathan jellyfish is a function of three dials: frequency, density and phase. Among a hundred and twenty-five possible shapes, only three resonate.', 'Working with nodes and parameters is exploring a space: you do not look for the right shape, you listen for the one that holds itself.'] },
      outro: { k: 'MATTER AND MEMORY  ·  RESONANCE', t: 'Among many shapes',
        p: ['The parametric is not infinite, it is inhabitable: some combinations sing and the others teach by contrast.', 'A virtual reality is a space of dials where the body learns to listen.'] }
    }
  },
  tortuga: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  ANCLAJE Y TIEMPO LENTO', t: 'Un jardín a cuestas',
        p: ['Anclar es hacer que algo digital se quede en un lugar. En AR se hace con una superficie y una cámara; aquí, con tiempo. Una tortuga-planeta camina un paso cada treinta segundos y lleva un jardín en el caparazón.',
            'No se puede acelerar. Se siembra, se da un sorbo de agua y se espera: demasiada agua también detiene. Lo que crece, crece también mientras no se mira, y es la misma tortuga que puede quedarse un rato sobre tu mesa.'] },
      outro: { k: 'DISEÑO DE SUFICIENCIA  ·  CUIDADO', t: 'Lo que crece sin prisa',
        p: ['Anclar una geometría al mundo no es clavarla: es acompañarla el tiempo que necesita. El cuidado es una mecánica de espera.',
            'Una tortuga que ya floreció sigue caminando. El jardín no era para terminarlo, sino para que alguien lo atendiera.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  ANCHORING AND SLOW TIME', t: 'A garden on its back',
        p: ['To anchor is to make something digital stay in a place. In AR it takes a surface and a camera; here, it takes time. A turtle-planet takes one step every thirty seconds and carries a garden on its shell.',
            'It cannot be hurried. You sow, give a sip of water and wait: too much water also stops it. What grows, grows even when nobody looks, and it is the same turtle that can rest for a while on your table.'] },
      outro: { k: 'DESIGN OF SUFFICIENCY  ·  CARE', t: 'What grows without hurry',
        p: ['Anchoring a geometry to the world is not nailing it down: it is keeping it company for as long as it needs. Care is a mechanic of waiting.',
            'A turtle that has bloomed keeps walking. The garden was never meant to be finished, only tended.'] }
    }
  },
  ballena: {
    es: {
      intro: { k: 'JUEGO OTRO  ·  ECO Y ALTERIDAD', t: 'Un canto sin respuesta',
        p: ['Se habló de una ballena que cantaba a 52 hercios, una frecuencia distinta a la de las demás, y se la llamó «la más solitaria del mundo». Quizá no estaba sola: estaba mal escuchada.',
            'La empatía no es parecerse al otro ni adivinarlo: es sintonía, un acoplamiento en el que ambos cambian. Una máquina puede simular consuelo; escuchar, en cambio, exige un cuerpo que espera.'] },
      outro: { k: 'ALTERIDAD  ·  SINTONÍA', t: 'Hacer lugar',
        p: ['Lo que sonó entre ustedes no fue una traducción: fue un ritmo compartido. La ballena no se volvió humana, ni tú ballena.',
            'Escuchar de verdad es aceptar que el otro seguirá siendo otro, y aun así responder.'] }
    },
    en: {
      intro: { k: 'OTHER GAME  ·  ECHO AND ALTERITY', t: 'A song without an answer',
        p: ['There was talk of a whale that sang at 52 hertz, a frequency unlike the others\', and it was called "the loneliest whale in the world". Perhaps it was not alone: it was poorly listened to.',
            'Empathy is not resembling the other or guessing them: it is attunement, a coupling in which both change. A machine can simulate comfort; listening, instead, demands a body that waits.'] },
      outro: { k: 'ALTERITY  ·  ATTUNEMENT', t: 'Making room',
        p: ['What sounded between you was not a translation: it was a shared rhythm. The whale did not become human, nor you a whale.',
            'To truly listen is to accept that the other will remain other, and still answer.'] }
    }
  }
};

MG.text = function(game, which) { return Object.assign({}, REFL[game][this.isEN() ? 'en' : 'es'][which], { _g: game, _w: which }); };
function reflSeen(g, w) { try { return !!((readUnlocks().refl || {})[g + '.' + w]); } catch (e) { return false; } }
function reflMark(g, w) { try { const u = readUnlocks(); u.refl = Object.assign({}, u.refl, { [g + '.' + w]: 1 }); writeUnlocks(u); } catch (e) {} }
MG.pending = false;
window.isMiniIntro = false;

MG.reflect = function(R, onDone, opts) {
  opts = opts || {};
  if (R && R._g && !opts.force && reflSeen(R._g, R._w)) { if (onDone) onDone(); return; }          // las reflexiones se leen la primera vez; después viven en la Colección
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
    if (accept && R && R._g && !opts.force) reflMark(R._g, R._w);
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
  if (window.isTuningGameActive || window.isWiringGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) return;
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
  if (MG.pending || window.isTuningGameActive || window.isWiringGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) return;
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

// ---------- El telar de partículas ----------
//   La urdimbre son hilos verticales de luz fijos al bastidor; la lanzadera lleva la trama de lado a lado y cada pasada teje una fila,
//   alternando sentido como en un telar de verdad. El patrón jalq'a aparece mientras se teje: la trama nace del color del hilo
//   (caliente, brillante) y se asienta en rojo y negro. Los enredos de la urdimbre piden atención: se sueltan con un toque.
function wgHexRgb(h) { return [(h >> 16) & 255, (h >> 8) & 255, h & 255]; }

// Filas del patrón (0 = arriba) que teje el hilo g: se reparten de abajo hacia arriba entre todos los hilos
function wgThreadRows(g) {
  const T = WG.total, a = Math.round(g * WG_ROWS / T), b = Math.round((g + 1) * WG_ROWS / T) - 1;
  return [WG_ROWS - 1 - b, WG_ROWS - 1 - a];
}

const WG_CC = WG_PAL.map(c => [c[0] / 255, c[1] / 255, c[2] / 255]);
const WG_NW = 90;                                                                // partículas por hilo de urdimbre
const WG_TN = 28;                                                                // partículas por enredo

function wgBuildCloth() {
  const b = wgBounds(), N = WG_COLS * WG_ROWS;
  const H = Math.min(b.halfH * 2 * 0.84, (2 * b.halfH * b.aspect * 0.88) / 0.62), cs = H / WG_ROWS, W = cs * WG_COLS;
  const grp = new THREE.Group(); grp.position.z = -0.8; scene.add(grp);
  const L = { grp, cs, W, H, left: -W / 2, right: W / 2, top: H / 2, bottom: -H / 2, pat: wgPattern(), op: 0.3, sc: 1, glow: 0, t: 0, phase2: false,
    rowP: new Float32Array(WG_ROWS), prevP: new Float32Array(WG_ROWS).fill(-1), rowDir: new Int8Array(WG_ROWS).fill(1), rowFade: new Float32Array(WG_ROWS), prevF: new Float32Array(WG_ROWS).fill(-1),
    rowVivid: new Float32Array(WG_ROWS * 3).fill(1), tangles: [], unr: null, combFlash: 0, trailT: 0, glowPrev: 0,
    sh: { j: 0, k: 0, passN: 0, active: false, row: WG_ROWS - 1, dir: 1, p: 0, wait: 1.2, tick: 0 }, label: null, labelKey: -1 };
  // trama: una partícula por celda (se llena al tejer)
  L.weft = mkGlowPoints(N);
  const wp = L.weft.geometry.attributes.position.array;
  for (let r = 0; r < WG_ROWS; r++) for (let c = 0; c < WG_COLS; c++) { const i = r * WG_COLS + c; wp[i * 3] = L.left + (c + 0.5) * cs; wp[i * 3 + 1] = L.top - (r + 0.5) * cs; wp[i * 3 + 2] = 0; }
  // urdimbre: hilos verticales de partículas
  const NWT = WG_COLS * WG_NW;
  L.warp = mkGlowPoints(NWT);
  const ap = L.warp.geometry.attributes, sp = (H + cs * 2.4) / WG_NW; L.warpRow = new Uint8Array(WG_NW); L.warpX = new Float32Array(WG_COLS);
  for (let k = 0; k < WG_NW; k++) { const y = L.top + cs * 1.2 - (k + 0.5) * sp; L.warpRow[k] = Math.max(0, Math.min(WG_ROWS - 1, Math.floor((L.top - y) / cs))); }
  for (let c = 0; c < WG_COLS; c++) { L.warpX[c] = L.left + (c + 0.5) * cs; for (let k = 0; k < WG_NW; k++) { const i = c * WG_NW + k; ap.position.array[i * 3] = L.warpX[c]; ap.position.array[i * 3 + 1] = L.top + cs * 1.2 - (k + 0.5) * sp; ap.position.array[i * 3 + 2] = -0.1; ap.aCol.array[i * 3] = 0.9; ap.aCol.array[i * 3 + 1] = 0.89; ap.aCol.array[i * 3 + 2] = 0.84; ap.aSize.array[i] = cs * 0.34; } }
  // bastidor: postes y vigas como hilos de puntos tenues
  const m = cs * 2.4, x0 = L.left - m, x1 = L.right + m, y0 = L.bottom - m, y1 = L.top + m, st = cs * 0.55;
  const pts = [];
  for (let y = y0; y <= y1; y += st) { pts.push([x0, y]); pts.push([x1, y]); }
  for (let x = x0; x <= x1; x += st) { pts.push([x, y0]); pts.push([x, y1]); }
  L.frame = mkGlowPoints(pts.length);
  const fa = L.frame.geometry.attributes;
  pts.forEach((p, i) => { fa.position.array[i * 3] = p[0]; fa.position.array[i * 3 + 1] = p[1]; fa.position.array[i * 3 + 2] = -0.2; fa.aCol.array[i * 3] = 0.9; fa.aCol.array[i * 3 + 1] = 0.88; fa.aCol.array[i * 3 + 2] = 0.82; fa.aSize.array[i] = cs * 0.5; fa.aAlpha.array[i] = 0.2 + 0.1 * ((i * 7) % 5) / 5; });
  // peine (marca de la fila en curso)
  L.comb = mkGlowPoints(WG_COLS * 2);
  for (let i = 0; i < WG_COLS * 2; i++) { const c = i >> 1; L.comb.geometry.attributes.position.array[i * 3] = L.left + (c + 0.25 + 0.5 * (i & 1)) * cs; L.comb.geometry.attributes.aCol.array[i * 3] = 1; L.comb.geometry.attributes.aCol.array[i * 3 + 1] = 0.95; L.comb.geometry.attributes.aCol.array[i * 3 + 2] = 0.85; L.comb.geometry.attributes.aSize.array[i] = cs * 0.5; L.comb.geometry.attributes.aAlpha.array[i] = 0; }
  // enredos (hasta 3 a la vez)
  L.tang = mkGlowPoints(3 * WG_TN);
  for (let i = 0; i < 3 * WG_TN; i++) { const a = L.tang.geometry.attributes; a.aCol.array[i * 3] = 1; a.aCol.array[i * 3 + 1] = 0.45; a.aCol.array[i * 3 + 2] = 0.55; a.aSize.array[i] = cs * 0.55; a.aAlpha.array[i] = 0; }
  // lanzadera: un núcleo de luz con cola de puntos
  const sh = new THREE.Group(); L.shGroup = sh;
  L.shHalo = mkHalo(0xffffff, cs * 6, 0.9); sh.add(L.shHalo);
  L.shCore = mkGlowPoints(10);
  for (let i = 0; i < 10; i++) { const a = L.shCore.geometry.attributes; a.aCol.array[i * 3] = a.aCol.array[i * 3 + 1] = a.aCol.array[i * 3 + 2] = 1; a.aSize.array[i] = cs * (1.1 - i * 0.08); a.aAlpha.array[i] = 1 - i * 0.09; }
  sh.add(L.shCore);
  [L.weft, L.warp, L.frame, L.comb, L.tang, sh].forEach(o => grp.add(o));
  WG.cloth = L; L.mesh = grp;
  wgPaintRows(true);
}

function wgRowY(L, r) { return L.top - (r + 0.5) * L.cs; }

// Recalcula el color/tamaño de las celdas de una fila (solo si cambió su progreso o su desvanecido)
function wgPaintRows(force) {
  const L = WG.cloth; if (!L) return; const A = L.weft.geometry.attributes, cs = L.cs, pat = L.pat, gl = L.glow, t = L.t; let dirty = false;
  for (let r = 0; r < WG_ROWS; r++) {
    const P = L.rowP[r], F = L.rowFade[r];
    if (!force && P === L.prevP[r] && F === L.prevF[r] && gl <= 0 && L.glowPrev <= 0) continue;
    L.prevP[r] = P; L.prevF[r] = F; dirty = true;
    const dir = L.rowDir[r], vr = L.rowVivid[r * 3], vg = L.rowVivid[r * 3 + 1], vb = L.rowVivid[r * 3 + 2];
    for (let c = 0; c < WG_COLS; c++) {
      const i = r * WG_COLS + c, frac = dir > 0 ? (c + 0.5) / WG_COLS : (WG_COLS - c - 0.5) / WG_COLS, v = pat[i];
      if (frac > P + 1e-4 || F >= 1) { A.aAlpha.array[i] = 0; continue; }                          // aún sin tejer
      const heat = Math.max(0, 1 - (P - frac) / 0.16), over = ((c + r) & 3) !== 0, cc = WG_CC[v];
      let k = over ? 1 : 0.78;
      if (gl > 0 && (v === 1 || v === 2)) k *= 1 + gl * 0.3 * (0.5 + 0.5 * Math.sin(t * 3 - (r + c) * 0.35));
      const hm = heat * 0.85;
      A.aCol.array[i * 3] = Math.min(1.4, cc[0] * k) * (1 - hm) + vr * hm; A.aCol.array[i * 3 + 1] = Math.min(1.4, cc[1] * k) * (1 - hm) + vg * hm; A.aCol.array[i * 3 + 2] = Math.min(1.4, cc[2] * k) * (1 - hm) + vb * hm;
      A.aSize.array[i] = cs * (over ? 1.18 : 0.92) * (1 + 0.45 * heat);
      A.aAlpha.array[i] = (v === 0 ? 0.62 : 0.9) * (1 - F);
    }
  }
  L.glowPrev = gl;
  if (dirty) { A.aCol.needsUpdate = A.aSize.needsUpdate = A.aAlpha.needsUpdate = true; }
}

// La partida: la lanzadera avanza hacia donde apunta el puntero, con su propio ritmo; los enredos la detienen si no se soltaron
function wgBeginPass() {
  const L = WG.cloth, S = L.sh, g = WG.roundStart + S.j, pair = WG.pairs[S.j], rows = wgThreadRows(g);
  S.row = rows[1] - S.k; S.dir = (S.passN % 2 === 0) ? 1 : -1; S.p = 0; S.active = true; S.tick = 0;
  const v = wgHexRgb(pair.color); L.rowVivid[S.row * 3] = v[0] / 255; L.rowVivid[S.row * 3 + 1] = v[1] / 255; L.rowVivid[S.row * 3 + 2] = v[2] / 255;
  L.rowDir[S.row] = S.dir; L.rowP[S.row] = 0;
  if (L.labelKey !== g) {                                                                           // el nombre del hilo acompaña a la lanzadera
    if (L.label) { L.shGroup.remove(L.label); mgDispose(L.label); }
    L.label = createTextSprite(pair.id[MG.isEN() ? 'en' : 'es'], '#' + pair.color.toString(16).padStart(6, '0'), 30); L.label.scale.set(6, 1.5, 1); L.label.position.set(0, L.cs * 3, 0); L.shGroup.add(L.label); L.labelKey = g;
  }
  L.tangles.length = 0;
  const R = Math.min(2, WG.round), first = WG.woven === 0;
  let n = first ? (S.k === 2 ? 1 : 0) : (Math.random() < [0.22, 0.34, 0.46][R] ? 1 : 0) + (Math.random() < [0, 0.12, 0.28][R] ? 1 : 0);
  const fs = [];
  for (let i = 0; i < n; i++) { let f = 0.2 + Math.random() * 0.62, tries = 0; while (fs.some(q => Math.abs(q - f) < 0.22) && tries++ < 20) f = 0.2 + Math.random() * 0.62; fs.push(f); }
  fs.sort((a, b) => a - b).forEach(f => {
    const x = S.dir > 0 ? L.left + f * L.W : L.right - f * L.W;
    L.tangles.push({ f, x, y: wgRowY(L, S.row), state: 'live', a: 0, snagT: 0, ph: Math.random() * 6 });
  });
}

function wgUntangle(t) {
  t.state = 'gone';
  MG.fx.burst(t.x, t.y, 0, 16, 2.2, 1.4, PAL.gold, 0.22, 0.85); MG.pulse(t.x, t.y, PAL.gold, 0.6, 3, 0.9, 0.4);
  MGS.bell(MGS.NOTES[4] * 2, 0, 1.0, 0.03); vibrateDevice(12);
}

function wgThreadDone() {
  const L = WG.cloth, S = L.sh, g = WG.woven, pair = WG.pairs[S.j], hex = pair.color, vivid = wgHexRgb(hex), rr = wgThreadRows(g), pat = L.pat;
  let red = 0; for (let r = rr[0]; r <= rr[1]; r++) for (let c = 0; c < WG_COLS; c++) { const v = pat[r * WG_COLS + c]; if (v === 1 || v === 2) red++; }
  WG.threads[g] = { hex, vivid, v10: Math.round(red / (rr[1] - rr[0] + 1)), round: WG.round };       // 0–44: promedio de rojo por fila
  const yc = (wgRowY(L, rr[0]) + wgRowY(L, rr[1])) / 2;
  for (let i = 0; i < 7; i++) MG.fx.burst(L.left + (i + 0.5) / 7 * L.W, yc, 0, 6, 2, 1.6, hex, 0.24, 0.85);
  MG.pulse(0, yc, hex, 1.5, 9, 1.4, 0.4);
  WG.woven++; WG.roundConn++; S.j++; S.k = 0;
  window.currentConnections = WG.roundConn; WG.uiDirty = true;
  const note = MGS.NOTES[g % 6] * (g >= 9 ? 2 : 1);                                                // la melodía sube con la tela
  MGS.bell(note, 0, 2.4, 0.055); MGS.bell(note * 1.5, 0.09, 1.8, 0.025);
  if (WG.roundConn >= WG.pairsNow) wgRoundDone();
}

function wgLoomPlay(dt, calm) {
  const L = WG.cloth, S = L.sh; if (!L) return;
  L.combFlash = Math.max(0, L.combFlash - dt * 2.5);
  L.tangles.forEach(t => {
    t.a = t.state === 'gone' ? Math.max(0, t.a - dt * 3) : Math.min(1, t.a + dt * 1.8);
    if (t.state === 'snag') { t.snagT -= dt; if (t.snagT <= 0) { t.state = 'gone'; MG.fx.burst(t.x, t.y, 0, 10, 1.6, 1.0, PAL.rose, 0.2, 0.7); } }
  });
  if (WG.state !== 'play') return;
  if (!S.active) {
    S.wait -= dt;
    if (S.wait <= 0 && S.j < WG.pairsNow) wgBeginPass();
    return;
  }
  const before = S.p;
  if (WG.pull) {
    const want = Math.max(0, Math.min(1, S.dir > 0 ? (WG.ptr.x - L.left) / L.W : (L.right - WG.ptr.x) / L.W));
    if (want > S.p) S.p = Math.min(want, S.p + 1.15 * dt);                                              // la lanzadera lleva su propio ritmo
  }
  for (const t of L.tangles) {                                                                          // un enredo sin soltar detiene la lanzadera
    if (t.state === 'gone' || t.f < before - 0.02) continue;
    if (S.p >= t.f - 0.012) { S.p = t.f - 0.012; if (t.state === 'live') { t.state = 'snag'; t.snagT = 0.6; wgShort(t.x, t.y); } }
    break;
  }
  if (S.p > before) {
    const col = Math.floor(S.p * WG_COLS);
    if (col >= S.tick + 5) { S.tick = col; MGS.bell(MGS.NOTES[(S.row + col) % 6] * (S.dir > 0 ? 1 : 0.5), 0, 0.5, 0.007); }
    L.trailT -= dt;
    if (!calm && L.trailT <= 0 && WG.pairs[S.j]) { L.trailT = 0.028; const x = S.dir > 0 ? L.left + S.p * L.W : L.right - S.p * L.W; MG.fx.emit(x, wgRowY(L, S.row), 0, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.9, 0, 1.0, WG.pairs[S.j].color, 0.2, 0.6, 1.4); }
  }
  L.rowP[S.row] = S.p;
  if (S.p >= 0.995) {                                                                                   // pasada completa: el peine golpea la fila
    L.rowP[S.row] = 1; S.active = false; S.passN++; S.k++; S.wait = 0.32; L.combFlash = 1;
    MGS.bell(MGS.NOTES[(S.row) % 6] / 2, 0, 0.9, 0.02);
    MG.pulse(0, wgRowY(L, S.row), 0xe7e4de, 1.5, 6, 0.7, 0.18);
    const g = WG.roundStart + S.j, rows = wgThreadRows(g);
    if (S.k >= rows[1] - rows[0] + 1) wgThreadDone();
  }
}

function wgUpdateCloth(dt, calm) {
  const L = WG.cloth; if (!L) return;
  L.t += dt; const t = L.t, S = L.sh, cs = L.cs;
  if (WG.phase === 1) wgLoomPlay(dt, calm);
  const phase1 = WG.phase === 1;
  if (L.unr) { L.unr.t = Math.min(1, L.unr.t + dt / 0.8); for (let r = L.unr.r0; r <= L.unr.r1; r++) L.rowFade[r] = L.unr.t; }      // el mundo se desanuda
  L.glow = WG.state === 'quipuWon' ? Math.min(1, WG.winT / 1.5) : 0;
  wgPaintRows(false);
  const tgt = WG.state === 'quipuWon' ? 0.9 : (phase1 ? (WG.state === 'roundWon' || WG.state === 'leave' ? 0.95 : 0.85) : 0.3);
  L.op += (tgt - L.op) * Math.min(1, dt * 2.5);
  L.weft.material.uniforms.uOpacity.value = L.op; L.warp.material.uniforms.uOpacity.value = L.op; L.frame.material.uniforms.uOpacity.value = L.op * 0.8;
  L.sc += ((WG.state === 'quipuWon' ? 1.04 : 1) - L.sc) * Math.min(1, dt * 1.5); L.grp.scale.set(L.sc, L.sc, 1);

  // urdimbre: corre una luz suave por los hilos; la tejida se atenúa; cerca de la lanzadera los hilos se agitan
  const A = L.warp.geometry.attributes, colF = S.active ? (S.dir > 0 ? S.p * WG_COLS : (1 - S.p) * WG_COLS) : -99;
  for (let c = 0; c < WG_COLS; c++) {
    const fr = (c + 0.5) / WG_COLS, near = Math.abs(c - colF) < 4;
    for (let k = 0; k < WG_NW; k++) {
      const i = c * WG_NW + k, r = L.warpRow[k], dir = L.rowDir[r], frac = dir > 0 ? fr : 1 - fr, woven = frac <= L.rowP[r] + 1e-4 && L.rowP[r] > 0 && L.rowFade[r] < 1;
      let a = 0.14 + (calm ? 0 : 0.12 * Math.sin(t * 1.4 - c * 0.35 + k * 0.13));
      if (woven) a *= 0.3;
      A.aAlpha.array[i] = a;
      A.position.array[i * 3] = L.warpX[c] + ((near && Math.abs(r - S.row) <= 1 && !calm) ? Math.sin(t * 14 + k * 2 + c) * cs * 0.18 * (1 - Math.abs(c - colF) / 4) : 0);
    }
  }
  A.aAlpha.needsUpdate = A.position.needsUpdate = true;

  // peine, enredos y lanzadera
  const CA = L.comb.geometry.attributes, show = phase1 && WG.state === 'play';
  for (let i = 0; i < WG_COLS * 2; i++) { CA.position.array[i * 3 + 1] = wgRowY(L, S.row) + cs * 0.55; CA.aAlpha.array[i] = show ? (0.18 + 0.1 * Math.sin(t * 3 + i * 0.4) + L.combFlash * 0.7) : 0; }
  CA.position.needsUpdate = CA.aAlpha.needsUpdate = true;
  const TA = L.tang.geometry.attributes;
  for (let n = 0; n < 3; n++) {
    const tg = L.tangles[n];
    for (let j = 0; j < WG_TN; j++) {
      const i = n * WG_TN + j;
      if (!tg || !phase1) { TA.aAlpha.array[i] = 0; continue; }
      const a = j / WG_TN * 6.2832 * 2 + t * (1.4 + (j % 3) * 0.5) + tg.ph, rr = cs * (0.5 + 1.4 * ((j * 7) % 11) / 11) * (tg.state === 'snag' ? 1.4 : 1);
      TA.position.array[i * 3] = tg.x + Math.cos(a) * rr; TA.position.array[i * 3 + 1] = tg.y + Math.sin(a * 1.3) * rr * 0.8; TA.position.array[i * 3 + 2] = 0.2;
      TA.aAlpha.array[i] = tg.a * (0.45 + 0.4 * Math.sin(t * 5 + j)) * (tg.state === 'snag' ? 1 : 0.9);
    }
  }
  TA.position.needsUpdate = TA.aAlpha.needsUpdate = true;
  const pair = WG.pairs[S.j], hex = pair ? pair.color : 0xffffff, sv = wgHexRgb(hex);
  const sx = S.dir > 0 ? L.left + S.p * L.W : L.right - S.p * L.W, idleX = (S.passN % 2 === 0) ? L.left : L.right;
  L.shGroup.visible = phase1 && !!pair;
  const wantX = S.active ? sx : idleX, wantY = wgRowY(L, S.active ? S.row : Math.max(0, S.row - (S.k === 0 && S.j > 0 ? 0 : 0)));
  L.shGroup.position.x += (wantX - L.shGroup.position.x) * Math.min(1, dt * 10); L.shGroup.position.y += (wantY - L.shGroup.position.y) * Math.min(1, dt * 10);
  L.shHalo.material.color.setHex(hex); L.shHalo.material.opacity = 0.55 + 0.25 * Math.sin(t * 5) + (WG.pull ? 0.2 : 0);
  const CP = L.shCore.geometry.attributes;
  for (let i = 0; i < 10; i++) { CP.position.array[i * 3] = -S.dir * i * cs * 0.55; CP.position.array[i * 3 + 1] = Math.sin(t * 9 + i) * cs * 0.18; CP.aCol.array[i * 3] = 0.6 + 0.4 * sv[0] / 255; CP.aCol.array[i * 3 + 1] = 0.6 + 0.4 * sv[1] / 255; CP.aCol.array[i * 3 + 2] = 0.6 + 0.4 * sv[2] / 255; }
  CP.position.needsUpdate = CP.aCol.needsUpdate = true;
}

function wgBuild() {
  wgClear();
  const L = WG.cloth, n = WG.rounds[WG.round];
  WG.pairsNow = n;
  const idx = WG_PAIRS.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, n);   // n tipos distintos al azar: sus nombres y colores son los de cada hilo
  WG.pairs = idx.map(i => WG_PAIRS[i]);
  WG.scale = 1;
  WG.roundStart = WG.rounds.slice(0, WG.round).reduce((a, b) => a + b, 0);
  const r0 = wgThreadRows(WG.roundStart + n - 1)[0], r1 = wgThreadRows(WG.roundStart)[1];     // filas de este mundo: se reinician si se desanuda
  for (let r = r0; r <= r1; r++) { L.rowP[r] = 0; L.rowFade[r] = 0; }
  L.unr = null; L.tangles.length = 0; L.labelKey = -1;
  L.sh.j = 0; L.sh.k = 0; L.sh.active = false; L.sh.wait = 0.9; L.sh.p = 0; L.sh.row = r1;
  window.currentConnections = 0; window.maxConnections = n;
  WG.roundConn = 0; WG.shorts = 0; WG.pull = false; WG.state = 'play'; WG.uiDirty = true;
}

window.wiringDown = function(cx, cy) {
  MG.setPointer(cx, cy); wgPointerWorld();
  if (WG.phase === 2) { WG.prevPtr.copy(WG.ptr); return; }                    // quipu: un nuevo toque no debe "arrastrar" desde el toque anterior
  const L = WG.cloth; if (WG.state !== 'play' || !L) return;
  const R = MG.isTouch() ? 2.4 : 1.7;
  let best = null, bd = R;
  L.tangles.forEach(t => { if (t.state !== 'live') return; const d = Math.hypot(t.x - WG.ptr.x, t.y - WG.ptr.y); if (d < bd) { bd = d; best = t; } });
  if (best) { wgUntangle(best); return; }                                      // tocar un enredo lo suelta
  WG.pull = true;
};

window.wiringMove = function(cx, cy) { MG.setPointer(cx, cy); wgPointerWorld(); };

window.wiringUp = function() { WG.pull = false; };

function wgShort(x, y) {                                                       // la lanzadera se enreda
  const en = MG.isEN();
  WG.shorts++;
  for (let i = 0; i < 30; i++) MG.fx.emit(x + (Math.random() - 0.5) * 2, y + (Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6 + 0.3, 0, 1.2 + Math.random() * 0.8, PAL.rose, 0.26, 0.7, 1.2);
  MG.pulse(x, y, PAL.rose, 1.2, 4.5, 1.1, 0.4);
  shakeIntensity = 0.25;
  MGS.knock();
  showSystemToast(en ? `The threads tangle (${WG.shorts}/${WG.maxShorts})` : `Los hilos se enredan (${WG.shorts}/${WG.maxShorts})`, '#e7e4de');
  if (WG.shorts >= WG.maxShorts) {
    // el mundo en curso se desanuda: sus filas se deshacen; los mundos anteriores quedan tejidos
    const L = WG.cloth, n = WG.pairsNow;
    L.unr = { t: 0, r0: wgThreadRows(WG.roundStart + n - 1)[0], r1: wgThreadRows(WG.roundStart)[1] };
    WG.woven -= WG.roundConn; WG.threads.length = WG.woven;
    WG.roundConn = 0; WG.uiDirty = true; WG.pull = false; L.sh.active = false;
    WG.state = 'leave'; WG.next = 'reset'; WG.resetT = 1.0;
    setTimeout(() => showSystemToast(en ? 'The world unravels. Weave it again.' : 'El mundo se desanuda. Vuelve a tejerlo.', '#e7e4de'), 450);
  }
}

function wgRoundDone() {
  const en = MG.isEN(), last = WG.round >= WG.rounds.length - 1, L = WG.cloth;
  WG.state = 'roundWon'; WG.roundT = 0; WG.next = last ? 'phase2' : 'advance'; WG.pull = false;
  const r0 = wgThreadRows(WG.roundStart + WG.pairsNow - 1)[0], r1 = wgThreadRows(WG.roundStart)[1], yc = (wgRowY(L, r0) + wgRowY(L, r1)) / 2;
  WG.pairs.forEach((p, i) => MG.fx.burst(L.left + (i + 0.5) / WG.pairs.length * L.W, yc, 0, 14, 2.6, 2.0, p.color, 0.26, 0.85));
  MG.pulse(0, yc, PAL.bone, 2, 18, 1.8, 0.3);
  MGS.arpeggio(last ? [0, 2, 3, 5] : [0, 2, 3], 0.14, 2.2, 0.04);
  showSystemToast(last ? (en ? 'The three worlds are woven' : 'Los tres mundos están tejidos')
                       : (en ? `${WG_WORLDS[WG.round].name}: woven` : `${WG_WORLDS[WG.round].name}: tejido`), '#e7e4de');
}

function wgPointerWorld() { MG.pointerWorld(WG.ptr); }
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
  WG.phase = 2; WG.state = 'quipuIntro'; WG.introT = 0; WG.winT = 0; WG.pull = false;
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
    'files-value': (WG.cloth ? WG.cloth.sh.passN : 0) + '',
    'combo-value': (WG.cloth ? Math.round(WG.cloth.sh.p * 100) : 0) + '%'
  });
  else { const Q = WG.quipu; MG.setHUD({
    'lives-value': '—',
    'level-value': (Q ? Q.tiedCords : 0) + '/' + (Q ? Q.cords.length : 0),
    'files-value': (Q ? Q.tiedKnots : 0) + '/' + (Q ? Q.totalKnots : 0),
    'combo-value': '—'
  }); }
}

function wgStart(data) {
  if (window.isWiringGameActive || window.isTuningGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) return;
  const en = MG.isEN();
  window.isWiringGameActive = true;
  window.wiringData = data;
  MG.enter(15);
  const ui = MG.buildUI(en
    ? 'Drag the shuttle from side to side: every pass weaves one row. If a pink tangle appears, touch it to loosen it before the shuttle gets there. Weaving asks for rhythm, not haste.'
    : 'Arrastra la lanzadera de lado a lado: cada pasada teje una fila. Si aparece un enredo rosa, tócalo para soltarlo antes de que llegue la lanzadera. Tejer pide ritmo, no prisa.');
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
  morphHUD('tejer');
}
window.startWiringGame = function(data) {
  if (MG.pending || window.isWiringGameActive || window.isTuningGameActive || (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive))) return;
  MG.pending = true;
  MG.reflect(MG.text('wiring', 'intro'), () => { MG.pending = false; wgStart(data); }, { cancelable: true, onCancel: () => { MG.pending = false; } });
};

function wgTeardown() {
  window.isWiringGameActive = false; WG.state = 'idle'; WG.phase = 1; WG.pull = false;
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
function hgPart(cells, pivot, parentPivot, mats) {                             // fusiona celdas en 2 mallas y devuelve un Group con su pivote
  const body = { p: [], n: [], u: [], i: [], s: [] }, scr = { p: [], n: [], u: [], i: [], s: [] };
  cells.forEach(c => {
    const seed = c.rune ? 0.02 : 0.06 + Math.random() * 0.94, x = c.x - pivot[0], y = c.y - pivot[1], z = c.z - pivot[2];
    hgPush(body, hgBoxData(c.w, c.h, c.d), x, y, z, c.ry, c.rz, seed, c.rx);
    hgPush(scr, hgPlaneData(c.w * 0.8, c.h * 0.78, c.d / 2 + 0.02), x, y, z, c.ry, c.rz, seed, c.rx);
  });
  const g = new THREE.Group();
  const bm = new THREE.Mesh(hgToGeo(body), mats ? mats.body : HG.bodyMat), sm = new THREE.Mesh(hgToGeo(scr), mats ? mats.screen : HG.screenMat);
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

// Materiales de los monitores: carcasa con tramado y pantalla con glitch/runas (los usan el Coloso y la Ballena)
function hgMakeMats(bodyHex) {
  const body = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(bodyHex || 0x5c635c) }, lightDir: { value: new THREE.Vector3(0.45, 0.5, 0.8).normalize() } },
    vertexShader: ditherShader.vertexShader, fragmentShader: ditherShader.fragmentShader
  });
  const screen = new THREE.ShaderMaterial({
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
  return { body, screen };
}

function hgBuildColossus() {
  const cs = HG_CS;
  const M = hgMakeMats(); HG.bodyMat = M.body; HG.screenMat = M.screen;

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

function hgAddPets(L) {
  L = L || { a: [2.7, 1.2], b: [0.1, 2.4] };
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
  mk(chaplinModelTemplate, L.a[0], L.a[1], -0.6, 1.25, 1.3);                            // un poco más grandes que antes, sin pasar la altura del Viajero
  mk(gamberModelTemplate, L.b[0], L.b[1], 0.9, -1.25, 1.1);
}

// ---------- Cámara del jugador: girar alrededor de la maqueta (distancia fija) y zoom ----------
//   Arrastrar sobre el espacio vacío gira la escena (con inercia) y la inclina un poco; la distancia NO cambia al girar.
//   Pellizco (móvil) o rueda (escritorio) acercan y alejan dentro de un rango acotado. Flechas / +,- como alternativa de teclado.
//   Un toque corto (sin arrastre) sigue siendo un toque: un gato maúlla o el Coloso gruñe.
const HG_CAM = { yaw: 0, yawT: 0, yawV: 0, pit: 0, pitT: 0, zoom: 1, zoomT: 1, ptrs: new Map(), pinchD: 0, tapOK: true, moved: 0, t0: 0, bound: false, fns: null, saved: null };
const HG_ZOOM = [0.55, 1.4], HG_PITCH = [-0.3, 0.5];
function hgCamReset() { const C = HG_CAM; C.yaw = C.yawT = C.yawV = C.pit = C.pitT = 0; C.zoom = C.zoomT = 1; C.ptrs.clear(); C.pinchD = 0; C.tapOK = true; C.moved = 0; }
function hgCamClampZ(z) { return Math.max(HG_ZOOM[0], Math.min(HG_ZOOM[1], z)); }
function hgCamLive() { return !!(window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive)); }
function hgCamBind() {
  const C = HG_CAM; if (C.bound || typeof window.addEventListener !== 'function') return;
  const skip = (e) => !hgCamLive() || window.isMiniIntro || (e.target && e.target.closest && e.target.closest('button, a, input, textarea'));
  const down = (e) => {
    if (skip(e) || HG.chips.some(c => c.state === 'drag')) return;
    if (window.isWhaleActive && window.whDown) window.whDown();
    if (window.isColossusActive && window.colDown) window.colDown(e.clientX, e.clientY);
    C.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (C.ptrs.size === 1) { C.tapOK = true; C.moved = 0; C.t0 = performance.now(); C.yawV = 0; }
    else { C.tapOK = false; const p = [...C.ptrs.values()]; C.pinchD = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
  };
  const move = (e) => {
    const p = C.ptrs.get(e.pointerId); if (!p || !hgCamLive()) return;
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
    if (window.isWhaleActive && window.whUp) window.whUp();
    if (window.isColossusActive && window.colUp) window.colUp();
    const was = C.ptrs.size; C.ptrs.delete(e.pointerId);
    if (was === 1 && C.tapOK && C.moved < 8 && performance.now() - C.t0 < 500 && e.type === 'pointerup') { if (window.isSputnikActive) { if (window.sptTap) window.sptTap(e.clientX, e.clientY); } else if (window.isTortugaActive) { if (window.trtTap) window.trtTap(e.clientX, e.clientY); } else if (window.isColossusActive) { if (window.colTap) window.colTap(e.clientX, e.clientY); } else if (window.isWhaleActive) { if (window.whTap) window.whTap(e.clientX, e.clientY); } else if (window.hgTap) window.hgTap(e.clientX, e.clientY); }
    if (C.ptrs.size === 0) { C.tapOK = true; C.yawV = Math.max(-2.5, Math.min(2.5, C.yawV)); if (C.moved < 8) C.yawV = 0; }
  };
  const wheel = (e) => { if (skip(e)) return; e.preventDefault(); C.zoomT = hgCamClampZ(C.zoomT * Math.exp(e.deltaY * 0.0012)); };
  const key = (e) => {
    if (!hgCamLive() || window.isMiniIntro) return;
    if (e.key === 'ArrowLeft') C.yawT += 0.09; else if (e.key === 'ArrowRight') C.yawT -= 0.09;
    else if (e.key === 'ArrowUp') C.pitT = Math.min(HG_PITCH[1], C.pitT + 0.05); else if (e.key === 'ArrowDown') C.pitT = Math.max(HG_PITCH[0], C.pitT - 0.05);
    else if (e.key === '+' || e.key === '=') C.zoomT = hgCamClampZ(C.zoomT * 0.92); else if (e.key === '-' || e.key === '_') C.zoomT = hgCamClampZ(C.zoomT / 0.92);
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  };
  const tm = (e) => { if (hgCamLive() && !window.isMiniIntro && e.touches && e.touches.length >= 2) e.preventDefault(); };   // sin pellizco de página
  const gs = (e) => { if (hgCamLive()) e.preventDefault(); };                  // Safari iOS: gesto de zoom de página
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
  const loud = menace ? 1.9 : kind === 'click' ? 1 : kind === 'angry' ? 1.2 : kind === 'sigh' ? 0.5 : 0.7;
  const dur = menace ? 3.6 + Math.random() * 1.4 : kind === 'click' ? 2.2 : kind === 'angry' ? 2.8 : kind === 'sigh' ? 3.2 : 1.8 + Math.random();
  HG.growlP = 0; HG.growlAmp = loud; HG.growlDur = dur;
  if (HG.colos && HG.fx) {
    _hgV.set(0, -3, 10); HG.colos.head.localToWorld(_hgV);
    HG.fx.burst(_hgV.x, _hgV.y, _hgV.z, kind === 'sigh' ? 10 : menace ? 34 : 18, menace ? 2.4 : 1.6, 2.0, menace ? 0x7a828c : 0x59616b, 0.32, 0.5);        // aliento de ceniza
    if (kind === 'click' || kind === 'angry' || menace) MG.pulse(HG_COLOSSUS.x, 0.05, 0xd64a3a, 2, 16, 1.8, 0.35, HG_COLOSSUS.z);   // onda sobre el suelo
  }
  if (!calm && (kind === 'click' || kind === 'angry' || menace)) { shakeIntensity = Math.max(shakeIntensity, menace ? 0.3 : 0.1); HG.flashV = Math.max(HG.flashV, menace ? 1 : 0.5); }
  if (menace) { vibrateDevice(220); [0, 450, 900].forEach(d => setTimeout(() => { if (window.isHogueraActive) MG.pulse(HG_COLOSSUS.x, 0.05, 0xd64a3a, 2, 22, 1.6, 0.4, HG_COLOSSUS.z); }, d)); }
  if (menace) { setTimeout(hgHiss, 700); setTimeout(() => hgRattle(1), 1300); }
  if (!MGS.ok()) return;
  if (menace) { hgRoar(dur); for (let i = 0; i < 14; i++) setTimeout(() => hgNoise('bandpass', 0.016, 1400 + Math.random() * 2600, 0.06), Math.random() * dur * 700); return; }
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
// RUGIDO: garganta de tres sierras que sube y cae, saturada y pasada por formantes que van de «aaa» a «ooo»,
// un sub que hace vibrar el pecho y un aliento ronco; todo con la cola de una sala grande. Es la voz que ya no se puede ignorar.
function hgRoar(dur) {
  try {
    const ctx = audioCtx, t = ctx.currentTime, end = t + dur + 0.25, B = MGS.bus();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.5, t + 0.14); out.gain.setValueAtTime(0.42, t + dur * 0.4); out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(comp); comp.connect(masterGain); comp.connect(B.input);
    const sh = ctx.createWaveShaper(), cv = new Float32Array(512);
    for (let i = 0; i < 512; i++) cv[i] = Math.tanh((i / 511 * 2 - 1) * 5);
    sh.curve = cv; sh.oversample = '2x';
    [[720, 300, 3, 1.0], [1250, 620, 4, 0.7], [2700, 1100, 5, 0.32]].forEach(([f0, f1, q, g]) => {            // vocal que se cierra: «aaa» → «ooo»
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const gg = ctx.createGain(); gg.gain.value = g; sh.connect(f); f.connect(gg); gg.connect(out);
    });
    const amp = ctx.createGain(); amp.gain.value = 0.55; amp.connect(sh);
    const lfo = ctx.createOscillator(); lfo.frequency.setValueAtTime(30, t); lfo.frequency.exponentialRampToValueAtTime(8, t + dur);
    const lg = ctx.createGain(); lg.gain.value = 0.45; lfo.connect(lg); lg.connect(amp.gain); lfo.start(t); lfo.stop(end);       // el gruñido se arrastra y se vuelve lento
    const f0 = 44 + Math.random() * 8;
    [1, 1.011, 0.5].forEach((m, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'square' : 'sawtooth';
      o.frequency.setValueAtTime(f0 * m * 0.8, t); o.frequency.exponentialRampToValueAtTime(f0 * m * 1.8, t + dur * 0.2); o.frequency.exponentialRampToValueAtTime(f0 * m * 0.55, t + dur);
      const gn = ctx.createGain(); gn.gain.value = i === 2 ? 0.25 : 0.5; o.connect(gn); gn.connect(amp); o.start(t); o.stop(end);
    });
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(40, t); sub.frequency.exponentialRampToValueAtTime(21, t + dur);
    const sg = ctx.createGain(); sg.gain.value = 0.7; sub.connect(sg); sg.connect(out); sub.start(t); sub.stop(end);
    const nb = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.8; nf.frequency.setValueAtTime(1000, t); nf.frequency.exponentialRampToValueAtTime(260, t + dur);
    const ng = ctx.createGain(); ng.gain.value = 0.28; ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(end);
  } catch (e) {}
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
  if (window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive) || window.isTuningGameActive || window.isWiringGameActive) return;
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
window.startHogueraGame = function(view) {
  if (MG.pending || window.isHogueraActive || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive) || window.isTuningGameActive || window.isWiringGameActive) return;
  if (view) { HG.view = true; hgStart(); HG.phase = 'won'; HG.winT = 0; HG.listen = HG.listenS = 1; hgGrowl('sigh'); HG.vT = 7; colViewBar(() => { HG.vk = (HG.vk || 0) + 1; hgGrowl(['sigh', 'idle', 'click'][HG.vk % 3]); }); return; }
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
    if (HG.view) { HG.vT -= dt; if (HG.vT <= 0) { HG.vT = 9 + Math.random() * 6; hgGrowl(Math.random() < 0.5 ? 'sigh' : 'idle'); } }
    else if (HG.winT > 4.2) { window.endHogueraGame(); return; }
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
  if (HG.growlG > 0.3 && !calm) shakeIntensity = Math.max(shakeIntensity, HG.growlG * (HG.growlAmp >= 1.8 ? 0.13 : 0.05));
  if (HG.growlAmp >= 1.8 && HG.growlG > 0.2) HG.flashV = Math.max(HG.flashV, 0.35 + 0.4 * HG.growlG);
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
  window.isHogueraActive = false; window.hgPose = null; HG.phase = 'idle'; HG.view = false;
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
  if (!window.isHogueraActive || HG.view) return;
  hgTeardown();
  MG.exit();
  colossusFound('serpiente');
  setTimeout(() => { MG.reflect(MG.text('hoguera', 'outro'), () => { if (window.colMaybeBestiary) window.colMaybeBestiary(); }); }, 700);   // reflexión final sobre el universo restaurado
};

window.abortHogueraGame = function() {
  if (!window.isHogueraActive) return;
  const en = MG.isEN();
  const v = HG.view; hgTeardown();
  MG.exit();
  if (!v) setTimeout(() => { MG.reflect(MG.text('hoguera', 'outro'), () => {}); }, 700);
};

// ==========================================
// 🐋 JUEGO OTRO: LA BALLENA (EMPATÍA)
//   Una ballena-coloso de monitores canta en pulsos que recorren el agua como ondas. El jugador no la vence ni la resuelve:
//   escucha y responde con el mismo ritmo. Si la ignora, su canto se vuelve más grave y solitario; si falla, ella espera y
//   se adapta (más lento, más simple). En la última ronda se invierte: el jugador canta y la ballena le devuelve SU ritmo.
//   La empatía como sintonía recíproca (acoplamiento), no como imitación ni como "ponerse en el lugar" del otro.
// ==========================================
window.isWhaleActive = false;
const WH_ISO = { yaw: 0.785, pitch: 0.5, dist: 84, fov: 30, target: new THREE.Vector3(-6, 5, 0) };
const WH_POS = { x: -21, z: -1, yaw: 1.5708, scale: 0.4, trav: { x: 12.5, z: 2.5 } };
const WH_ROUNDS = 6;                                           // 3 llamadas de ritmo + 2 notas sostenidas + 1 de reciprocidad
const WH_HOLD = [3.2, 5.2];                                    // segundos de las dos notas largas
const WH = {
  st: 'idle', t: 0, round: 0, att: 0, attS: 0, lone: 0, loneS: 0, fails: 0, idleT: 0, talk: 0, echoes: 0, pulsesN: 0,
  pat: null, beats: [], notes: [], bi: 0, ct: 0, at: 0, vt: 0, ft: 0, fSil: 0, fin: 0, taps: [], lit: 0, recall: false, lastP: 0, rise: 0,
  sing: 0, subT: 0, ok: false, q: 0, echoT: 0, echoList: [], ei: 0, finBurst: 0,
  pulses: [], pslot: 0, group: null, ocean: null, mats: null, whale: null, eyes: [], halo: null, spec: null,
  tone: null, els: {}, saved: null, keyFn: null, keyUpFn: null, pose: null,
  hold: 0, hfails: 0, holding: false, hHeld: 0, hdur: 3, hSung: false, ht: 0, hpass: false, choir: [], plank: null, holdTone: null
};

// ---------- Plano de la ballena: partes como datos puros {cells, pivot, parent} ----------
function hgWhaleSpec() {
  const SPN = [[0, 5, -46], [0, 6.5, -36], [0, 8.5, -24], [0, 10.5, -11], [0, 11.5, 2], [0, 11, 14], [0, 9.5, 25], [0, 8, 33]];
  const R = (u) => u < 0.62 ? 1.4 + 7.4 * Math.pow(Math.sin(Math.PI / 2 * u / 0.62), 0.9) : 8.8 - 3.6 * Math.pow((u - 0.62) / 0.38, 2);
  const body = [], tail = [], jaw = [], SP = {};
  // muestras repartidas por longitud de arco; el paso crece con el radio para que las celdas sean cuadradas y cubran el cuerpo
  const S = 240, arcL = [0]; let prev = hgCR(SPN, 0);
  for (let i = 1; i <= S; i++) { const q = hgCR(SPN, i / S); arcL.push(arcL[i - 1] + Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])); prev = q; }
  const total = arcL[S], uAt = (len) => { let i = 0; while (i < S && arcL[i] < len) i++; return i / S; };
  let pos = 0, idx = 0, blow = null; const eyes = [];
  while (pos <= total) {
    const u = uAt(pos), r = R(u), step = Math.max(3, r * 0.7);
    const c = hgCR(SPN, u), a = hgCR(SPN, Math.max(0, u - 0.02)), b = hgCR(SPN, Math.min(1, u + 0.02));
    let T = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const tl = Math.hypot(T[0], T[1], T[2]) || 1; T = [T[0] / tl, T[1] / tl, T[2] / tl];
    const Sd = [T[2] * -1, 0, T[0]], sl = Math.hypot(Sd[0], Sd[1], Sd[2]) || 1, Sx = [Sd[0] / sl, Sd[1] / sl, Sd[2] / sl];
    const Fv = [Sx[1] * T[2] - Sx[2] * T[1], Sx[2] * T[0] - Sx[0] * T[2], Sx[0] * T[1] - Sx[1] * T[0]];
    const dst = u < 0.3 ? tail : body, n = Math.max(3, Math.round(4.54 * r / step)), arc = 4.54 * r / n;
    for (let k = 0; k < n; k++) {
      const an = (-130 + 260 * (k + 0.5) / n) * Math.PI / 180, d = [Fv[0] * Math.cos(an) + Sx[0] * Math.sin(an), Fv[1] * Math.cos(an) + Sx[1] * Math.sin(an), Fv[2] * Math.cos(an) + Sx[2] * Math.sin(an)];
      const flank = Math.abs(Math.sin(an)) > 0.55 && Math.abs(Math.sin(an)) < 0.95;
      hgSurf(dst, c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r, d, arc * 0.95, arc * 0.95, arc * 0.6, flank && idx % 3 === 0);   // luces bioluminiscentes en los flancos
    }
    if (u > 0.68) {                                                              // mandíbula inferior
      const m = Math.max(2, Math.round(1.6 * r / step)), arcJ = 1.6 * r / m;
      for (let k = 0; k < m; k++) {
        const an = (140 + 80 * (k + 0.5) / m) * Math.PI / 180, d = [Fv[0] * Math.cos(an) + Sx[0] * Math.sin(an), Fv[1] * Math.cos(an) + Sx[1] * Math.sin(an), Fv[2] * Math.cos(an) + Sx[2] * Math.sin(an)];
        hgSurf(jaw, c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r, d, arcJ * 0.95, arcJ * 0.95, arcJ * 0.6, false);
      }
    }
    if (u > 0.78 && u < 0.86 && !blow) blow = [c[0], c[1] + Fv[1] * r, c[2]];
    if (u > 0.86 && eyes.length === 0) [-1, 1].forEach(sd => eyes.push([c[0] + Sx[0] * r * sd * 0.98, c[1] + Sx[1] * r * 0.98 * sd - 0.3, c[2] + Sx[2] * r * sd * 0.98]));
    pos += step; idx++;
  }
  SP.body = { cells: body, pivot: [0, 11, 0], parent: 'root' };
  // cola: pedúnculo + dos lóbulos del aleta caudal
  [-1, 1].forEach(sd => [0, -4.2].forEach(dz => hgChain(tail, [[0, 5.2, -42 + dz], [sd * 6, 5.4, -47 + dz], [sd * 13, 5.2, -53 + dz], [sd * 19, 5.2, -58 + dz]], 3.8, 0, 0, 'F', 5.6 - (dz ? 0.8 : 0), 2.8, 0)));   // dos filas: la aleta se lee como una hoja
  SP.tail = { cells: tail, pivot: [0, 8.5, -24], parent: 'body' };
  SP.jaw = { cells: jaw, pivot: [0, 8.5, 18], parent: 'body' };
  [-1, 1].forEach(sd => {                                                          // aletas pectorales
    const fc = []; [0, -3.8].forEach(dz => hgChain(fc, [[sd * 7.5, 9, 10 + dz], [sd * 13, 6.5, 6 + dz], [sd * 18.5, 3.8, 0 + dz], [sd * 22, 2, -5 + dz]], 3.8, 0, 0, 'F', 5.4 - (dz ? 0.8 : 0), 2.6, 0));
    SP[sd > 0 ? 'finR' : 'finL'] = { cells: fc, pivot: [sd * 7.5, 9, 10], parent: 'body' };
  });
  SP.eyes = eyes; SP.blow = blow || [0, 19, 14];
  return SP;
}

// ---------- Mar: retícula punteada que se ondula con los pulsos (hasta 8 ondas a la vez) ----------
function whBuildOcean() {
  const pts = [], seeds = [], S = 1.6, R = 48, N = Math.ceil(R / S), cx = WH_ISO.target.x, cz = WH_ISO.target.z;
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) {
    const x = cx + i * S, z = cz + j * S;
    if (Math.hypot(x - cx, z - cz) > R) continue;
    pts.push(x, 0, z); seeds.push(Math.random());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seeds), 1));
  const P = [], C = [];
  for (let i = 0; i < 8; i++) { P.push(new THREE.Vector4(0, 0, -1, 0)); C.push(new THREE.Vector3(1, 1, 1)); }
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCalm: { value: 0 }, uLone: { value: 0 }, uScale: GLOW_SCALE, uCenter: { value: WH_ISO.target.clone() }, uR: { value: R }, uP: { value: P }, uC: { value: C } },
    vertexShader: `
      attribute float aSeed; uniform float uTime; uniform float uCalm; uniform float uLone; uniform float uScale; uniform float uR;
      uniform vec3 uCenter; uniform vec4 uP[8]; uniform vec3 uC[8]; varying float vA; varying vec3 vC;
      void main() {
        vec3 p = position; float lift = 0.0; float gl = 0.0; vec3 glow = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float age = uP[i].z;
          if (age < 0.0 || age > 7.0) continue;
          float d = distance(p.xz, uP[i].xy), r = age * 13.0, w = 2.4 + age * 0.8;
          float k = exp(-pow((d - r) / w, 2.0)) * uP[i].w * exp(-age * 0.4);
          lift += k * 0.9 * cos((d - r) * 1.1); gl += k; glow += uC[i] * k;
        }
        p.y += lift + sin(p.x * 0.35 + uTime * 0.6) * cos(p.z * 0.3 + uTime * 0.45) * 0.14;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec3 base = mix(vec3(0.30, 0.52, 0.62), vec3(0.62, 0.80, 0.90), uCalm);
        base = mix(base, vec3(0.50, 0.30, 0.34), uLone * 0.55);
        vC = base + glow * 1.1;
        float fade = smoothstep(uR, uR * 0.45, distance(p.xz, uCenter.xz));
        float tw = 0.75 + 0.25 * sin(uTime * 1.3 + aSeed * 20.0);
        vA = (0.36 + min(1.0, gl) * 0.7) * fade * tw * (1.0 - uLone * 0.35);
        gl_PointSize = (0.16 + min(1.0, gl) * 0.32) * uScale / max(0.1, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA; varying vec3 vC;
      void main() { float d = length(gl_PointCoord - vec2(0.5)); float a = smoothstep(0.5, 0.25, d); gl_FragColor = vec4(vC, a * vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false;
  return p;
}

function whBuildWhale() {
  const SP = hgWhaleSpec(), root = new THREE.Group(), G = { root }, P = { root: [0, 0, 0] };
  WH.mats = hgMakeMats(0x4f6272);
  ['body', 'tail', 'jaw', 'finR', 'finL'].forEach(k => {
    const sp = SP[k]; G[k] = hgPart(sp.cells, sp.pivot, P[sp.parent], WH.mats); P[k] = sp.pivot; G[sp.parent].add(G[k]);
  });
  WH.eyes = SP.eyes.map(e => { const h = mkHalo(0xbfe6ff, 4.0, 0); h.position.set(e[0] - 0, e[1] - 11, e[2]); G.body.add(h); return h; });   // relativo al pivote del cuerpo
  WH.blow = SP.blow;
  root.scale.setScalar(WH_POS.scale); root.position.set(WH_POS.x, 0, WH_POS.z); root.rotation.y = WH_POS.yaw;
  WH.whale = Object.assign(G, { root });
  return root;
}

// ---------- Pulsos: ondas sobre el agua (de la ballena en azul pálido, del jugador en cálido) ----------
const WH_C_WHALE = [0.55, 0.78, 1.0], WH_C_YOU = [1.0, 0.82, 0.55], WH_C_MUTE = [0.5, 0.5, 0.55];
function whEmit(x, z, amp, col, hex) {
  const p = WH.pulses[WH.pslot % 8] || (WH.pulses[WH.pslot % 8] = {});
  p.x = x; p.z = z; p.age = 0; p.amp = amp; p.col = col; WH.pslot++; WH.pulsesN++;
  MG.pulse(x, 0.05, hex, 0.6, 9 + amp * 4, 2.4, 0.3 + 0.15 * amp, z);
}
function whMouth(out) { out.set(0, -2, 38); WH.whale.body.localToWorld(out); return out; }          // boca (relativa al pivote del cuerpo)
const _whM = new THREE.Vector3();

// ---------- Sonido: voz de ballena (senoidal con glissando, armónicos y vibrato) + lecho de mar ----------
function whSing(freq, dur, vol, low) {
  if (!MGS.ok()) return;
  try {
    const ctx = audioCtx, t = ctx.currentTime, f = freq * (low ? 0.8 : 1);
    const out = ctx.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(vol, t + 0.22); out.gain.setValueAtTime(vol, t + dur * 0.55); out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = low ? 520 : 900; lp.Q.value = 0.7; lp.connect(out); out.connect(MGS.bus().input);
    const vib = ctx.createOscillator(); vib.frequency.value = low ? 3.6 : 4.8; const vg = ctx.createGain(); vg.gain.value = f * 0.014; vib.connect(vg);
    [[1, 1, 'sine'], [2, 0.32, 'sine'], [0.5, 0.45, 'triangle']].forEach(([m, g, type]) => {
      const o = ctx.createOscillator(), gn = ctx.createGain(); o.type = type; gn.gain.value = g;
      o.frequency.setValueAtTime(f * m * 0.82, t); o.frequency.exponentialRampToValueAtTime(f * m, t + dur * 0.28); o.frequency.exponentialRampToValueAtTime(f * m * (low ? 0.86 : 0.93), t + dur);
      vg.connect(o.frequency); o.connect(gn); gn.connect(lp); o.start(t); o.stop(t + dur + 0.1);
    });
    vib.start(t); vib.stop(t + dur + 0.1);
  } catch (e) {}
}
function whToneStart() {
  if (!MGS.ok()) return;
  try {
    const ctx = audioCtx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(1, t + 2.5); out.connect(masterGain);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.connect(out);
    const mk = (f) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.value = 0; o.connect(g); g.connect(lp); o.start(); return { o, g }; };
    const a = mk(55), b = mk(55 * 1.008), c = mk(82.41), d = mk(110.0);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 380; const ng = ctx.createGain(); ng.gain.value = 0.02;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.12; const lg = ctx.createGain(); lg.gain.value = 0.014; lfo.connect(lg); lg.connect(ng.gain);
    src.connect(bp); bp.connect(ng); ng.connect(out); src.start(); lfo.start();
    WH.tone = { ctx, out, lp, a, b, c, d, src, lfo, noise: buf };
  } catch (e) { WH.tone = null; }
}
function whToneUpdate(att, lone) {
  const T = WH.tone; if (!T) return;
  try {
    const t = T.ctx.currentTime;
    T.a.g.gain.setTargetAtTime(0.025 + lone * 0.03, t, 0.5);
    T.b.g.gain.setTargetAtTime(0.02 + lone * 0.035, t, 0.5);                       // el batido se acentúa con la soledad
    T.b.o.frequency.setTargetAtTime(55 * (1 + 0.008 + lone * 0.012 * (1 - att)), t, 0.6);
    T.c.g.gain.setTargetAtTime(att * 0.03, t, 0.8);                                // la quinta florece al sintonizar
    T.d.g.gain.setTargetAtTime(att * att * 0.022, t, 0.8);
    T.lp.frequency.setTargetAtTime(200 + att * 300, t, 0.6);
    if (!isSoundEnabled) T.out.gain.setTargetAtTime(0, t, 0.1);
  } catch (e) {}
}
function whToneStop() {
  const T = WH.tone; if (!T) return;
  WH.tone = null;
  try {
    const t = T.ctx.currentTime;
    T.out.gain.cancelScheduledValues(t); T.out.gain.setTargetAtTime(0, t, 0.4);
    [T.a, T.b, T.c, T.d].forEach(v => v.o.stop(t + 2.4)); T.src.stop(t + 2.4); T.lfo.stop(t + 2.4);
  } catch (e) {}
}

// ---------- Textos y reglas ----------
const WH_TXT = {
  es: { listen: '…escucha…', answer: '…responde con el mismo ritmo…', ok: '…te escuchó…', retry: '…no importa. Ella espera. Escucha otra vez, más despacio…',
        over: '…aún cantaba. Primero, escucha…', lone: '…el silencio también es una respuesta, pero no la que ella espera…', free: '…ahora canta tú. Ella escuchará…',
        hold: '…ahora sostiene una sola nota…', holdAns: '…sostén tú también, el mismo tiempo. Respira con ella…', holdOk: '…respiraron juntos…', holdRetry: '…no hace falta medir. Escucha cuánto dura, y acompáñala…', holdLone: '…ella sigue sosteniendo la nota…',
        echo: '…te devuelve tu propio ritmo…', end: '…nadie estaba sola: faltaba quien escuchara.', gentle: '…te acompaña igualmente…' },
  en: { listen: '…listen…', answer: '…answer with the same rhythm…', ok: '…she heard you…', retry: '…it does not matter. She waits. Listen again, slower…',
        over: '…she was still singing. Listen first…', lone: '…silence is also an answer, but not the one she waits for…', free: '…now you sing. She will listen…',
        hold: '…now she holds a single note…', holdAns: '…hold too, for as long. Breathe with her…', holdOk: '…you breathed together…', holdRetry: '…no need to measure. Listen to how long it lasts, and keep her company…', holdLone: '…she keeps holding the note…',
        echo: '…she gives you back your own rhythm…', end: '…no one was alone: someone to listen was missing.', gentle: '…she keeps you company all the same…' }
};
function whText(k) { return WH_TXT[MG.isEN() ? 'en' : 'es'][k]; }
function whSub(text, secs) { const el = WH.els.sub; if (!el) return; el.textContent = text; el.style.opacity = '1'; WH.subT = secs || 6; }

function whPattern(round, fails) {
  const base = [[0, 0.6, 1.8], [0, 0.6, 1.2, 2.6], [0, 0.5, 1.0, 2.2, 3.0]][round], notes = [[0, 2, 4], [1, 3, 2, 4], [0, 2, 3, 1, 4]][round];
  const times = base.slice(), nn = notes.slice();
  if (fails >= 2 && times.length > 2) { times.pop(); nn.pop(); }              // tras dos intentos, la ballena simplifica su canto
  const slow = 1 + 0.18 * Math.min(fails, 3);
  return { times: times.map(x => x * slow), notes: nn };
}
// Compara el RITMO (proporciones entre pausas), no el tempo: se puede responder más rápido o más lento
function whJudge(exp, taps) {
  if (taps.length !== exp.length) return { ok: false, q: 0 };
  if (exp.length < 2) return { ok: taps.length === 1, q: 1 };
  const gaps = (a) => a.slice(1).map((v, i) => v - a[i]);
  const ge = gaps(exp), gp = gaps(taps);
  if (gp.some(v => v < 0.12)) return { ok: false, q: 0 };                      // doble toque accidental
  if (ge.length === 1) { const r = gp[0] / ge[0]; return { ok: r > 0.5 && r < 2, q: Math.max(0, 1 - Math.abs(Math.log2(r)) / 0.9) }; }
  const se = ge.reduce((a, b) => a + b, 0), sp = gp.reduce((a, b) => a + b, 0);
  let err = 0; for (let i = 0; i < ge.length; i++) err += Math.abs(ge[i] / se - gp[i] / sp);
  err /= ge.length;
  const q = Math.max(0, 1 - err / 0.12);
  return { ok: q >= 0.3 && sp > 0.4, q };
}

// ---------- Interfaz ----------
function whDots(n, lit) {
  const box = WH.els.dots; if (!box) return;
  while (box.children.length < n) { const d = document.createElement('div'); d.style.cssText = 'width:9px; height:9px; border-radius:50%; border:1px solid rgba(231,228,222,0.5); box-sizing:border-box; transition:background .25s, box-shadow .25s;'; box.appendChild(d); }
  while (box.children.length > n) box.removeChild(box.lastChild);
  for (let i = 0; i < box.children.length; i++) { const on = i < lit; box.children[i].style.background = on ? '#e7e4de' : 'transparent'; box.children[i].style.boxShadow = on ? '0 0 10px rgba(231,228,222,0.7)' : 'none'; }
}
function whBuildUI() {
  const en = MG.isEN();
  const ui = MG.buildUI(en
    ? 'The whale sings in pulses. Listen, then answer with the same rhythm: tap, or press Space. Sometimes she holds a single note: press and hold. Drag empty space to turn around the scene; pinch to zoom.'
    : 'La ballena canta en pulsos. Escucha y responde con el mismo ritmo: toca, o pulsa Espacio. A veces sostiene una sola nota: mantén pulsado. Arrastra el espacio vacío para girar la escena; pellizca para acercar.');
  const title = document.createElement('div');
  title.textContent = en ? 'LISTENING TO A WHALE' : 'ESCUCHANDO A UNA BALLENA';
  title.style.cssText = 'font-size:0.66rem; font-weight:300; letter-spacing:0.34em; color:#a8a49c;';
  const dots = document.createElement('div'); dots.style.cssText = 'display:flex; gap:10px; justify-content:center; margin:14px auto 0; min-height:9px;';
  const prog = document.createElement('div'); prog.style.cssText = 'margin:14px auto 0; width:min(60vw,240px); height:1px; background:rgba(231,228,222,0.15); position:relative;';
  const fill = document.createElement('div'); fill.style.cssText = 'position:absolute; left:0; top:0; height:1px; width:0%; background:#bfe6ff; box-shadow:0 0 8px rgba(191,230,255,0.6);';
  prog.appendChild(fill); ui.extra.appendChild(title); ui.extra.appendChild(dots); ui.extra.appendChild(prog);
  const sub = document.createElement('div');
  sub.style.cssText = 'position:absolute; left:50%; bottom:calc(150px + env(safe-area-inset-bottom,0px)); transform:translateX(-50%); width:min(90vw,640px); text-align:center; font-size:0.95rem; font-weight:300; letter-spacing:0.12em; line-height:1.8; color:#cfd8e3; opacity:0; transition:opacity 1.4s ease; text-shadow:0 0 14px rgba(0,0,0,0.9);';
  ui.root.appendChild(sub);
  const cold = document.createElement('div');
  cold.style.cssText = 'position:absolute; inset:0; pointer-events:none; opacity:0; background:radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(120,70,90,0.28) 100%); transition:opacity .4s;';
  ui.root.insertBefore(cold, ui.root.firstChild);
  const bars = [['top'], ['bottom']].map(([pos]) => { const b = document.createElement('div'); b.style.cssText = `position:absolute; left:0; right:0; ${pos}:0; height:0; background:#000; pointer-events:none; transition:height 3s ease;`; ui.root.insertBefore(b, ui.root.firstChild); return b; });
  requestAnimationFrame(() => requestAnimationFrame(() => bars.forEach(b => { b.style.height = '4.5vh'; })));
  WH.els = { title, dots, fill, sub, cold };
}

// ---------- Inicio y fin ----------
function whStart() {
  if (window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive) || window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive) return;
  const en = MG.isEN();
  window.isWhaleActive = true;
  MG.enter(24);
  camera.fov = WH_ISO.fov; targetFov = WH_ISO.fov; camera.updateProjectionMatrix();
  userGroup.rotation.order = 'YXZ';
  const tg = window.travelerGroup;
  WH.saved = { pos: tg.position.clone(), quat: tg.quaternion.clone(), scale: tg.scale.clone() };
  const feet = (typeof TRAVELER_FEET !== 'undefined') ? TRAVELER_FEET : 0.6, tx = WH_POS.trav.x, tz = WH_POS.trav.z;
  window.hgPose = { pos: new THREE.Vector3(tx, feet, tz), yaw: Math.atan2(WH_POS.x - tx, WH_POS.z - tz) };   // mira a la ballena
  tg.visible = true; tg.position.copy(window.hgPose.pos);

  Object.assign(WH, { st: 'arrive', t: 0, round: 0, att: 0, attS: 0, lone: 0, loneS: 0, fails: 0, idleT: 0, talk: 0, echoes: 0, pulsesN: 0, taps: [], lit: 0, rise: 0, sing: 0, fin: 0, subT: 0, recall: false, lastP: 0, pslot: 0, pulses: [], echoList: [], hold: 0, hfails: 0, holding: false, hHeld: 0, hdur: 3, hSung: false, ht: 0, hpass: false });
  if (MG.dust) MG.dust.pts.position.set(WH_ISO.target.x, 6, WH_ISO.target.z);
  WH.group = new THREE.Group();
  WH.ocean = whBuildOcean(); WH.group.add(WH.ocean);
  WH.group.add(whBuildWhale());
  WH.group.add(whBuildChoir()); WH.group.add(whBuildPlankton());
  WH.halo = mkHalo(0xffd9a8, 4, 0.2); WH.halo.position.set(tx, 0.8, tz); WH.group.add(WH.halo);     // el calor del Viajero: late con cada respuesta tuya
  scene.add(WH.group);
  hgAddPets({ a: [tx + 2.4, tz - 1.8], b: [tx + 0.4, tz + 2.2] });
  whBuildUI();
  whToneStart();
  hgCamReset(); hgCamBind();
  WH.keyFn = (e) => { if (!window.isWhaleActive || window.isMiniIntro) return; if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) { if (WH.st === 'hcall' || WH.st === 'hanswer') whDown(); else whPulse(); } } };
  window.addEventListener('keydown', WH.keyFn, true);
  WH.keyUpFn = (e) => { if (window.isWhaleActive && (e.key === ' ' || e.key === 'Enter')) whUp(); };
  window.addEventListener('keyup', WH.keyUpFn, true);

  morphHUD('resonar');
  showSystemToast(en ? 'Something enormous sings beneath the silence.' : 'Algo enorme canta bajo el silencio.', '#e7e4de');
}
window.startWhaleGame = function(data, view) {
  if (MG.pending || window.isWhaleActive || (window.isSputnikActive || window.isTortugaActive || window.isColossusActive) || window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive) return;
  if (view) { WH.view = true; whStart(); WH.st = 'finale'; WH.fin = 0; WH.att = 1; WH.lone = 0; WH.finBurst = 0; WH.vT = 9; colViewBar(() => { WH.vk = (WH.vk || 0) + 1; whBeat([0, 2, 4, 3][WH.vk % 4], false); if (WH.vk % 2) whChoirSing(1.0); }); return; }
  MG.pending = true;
  MG.reflect(MG.text('ballena', 'intro'), () => { MG.pending = false; whStart(); },
    { cancelable: true, onCancel: () => { MG.pending = false; if (data && typeof openProjectPopup === 'function') openProjectPopup(data); } });   // al volver, la ballena conserva su ficha original
};

function whTeardown() {
  window.isWhaleActive = false; window.hgPose = null; WH.st = 'idle'; WH.view = false;
  hgCamUnbind(); whToneStop();
  whHoldTone(false);
  if (WH.keyFn) { window.removeEventListener('keydown', WH.keyFn, true); WH.keyFn = null; }
  if (WH.keyUpFn) { window.removeEventListener('keyup', WH.keyUpFn, true); WH.keyUpFn = null; }
  HG.pets.forEach(p => scene.remove(p)); HG.pets = [];
  if (WH.group) { mgDispose(WH.group); WH.group = null; }
  const tg = window.travelerGroup;
  if (tg && WH.saved) { tg.position.copy(WH.saved.pos); tg.quaternion.copy(WH.saved.quat); tg.scale.copy(WH.saved.scale); }
  WH.saved = null; WH.choir = []; WH.plank = null; WH.holding = false; WH.whale = null; WH.ocean = null; WH.mats = null; WH.eyes = []; WH.halo = null; WH.els = {}; WH.pulses = [];
}
window.endWhaleGame = function() {
  if (!window.isWhaleActive || WH.view) return;
  whTeardown(); MG.exit();
  colossusFound('ballena');
  setTimeout(() => { MG.reflect(MG.text('ballena', 'outro'), () => { if (window.colMaybeBestiary) window.colMaybeBestiary(); }); }, 700);
};
window.abortWhaleGame = function() {
  if (!window.isWhaleActive) return;
  const v = WH.view; whTeardown(); MG.exit();
  if (!v) setTimeout(() => { MG.reflect(MG.text('ballena', 'outro'), () => {}); }, 700);
};

// ---------- Lógica: la ballena canta, tú respondes ----------
function whBeat(noteIdx, soft) {                                               // un pulso de la ballena
  const f = MGS.NOTES[noteIdx % MGS.NOTES.length] / 4, low = WH.recall || soft;
  whSing(f, low ? 2.2 : 1.7, soft ? 0.05 : 0.09, WH.recall);
  whMouth(_whM); whEmit(_whM.x, _whM.z, soft ? 0.7 : 1.0, WH_C_WHALE, 0x9fd0ff);
  WH.sing = 1;
  if (MG.fx) { const b = WH.blow; _hgV.set(b[0], b[1] - 11, b[2]); WH.whale.body.localToWorld(_hgV); MG.fx.burst(_hgV.x, _hgV.y, _hgV.z, 10, 1.6, 1.8, 0xbfe6ff, 0.22, 0.7); }
  vibrateDevice(18);
}
function whStartCall() {
  const P = whPattern(WH.round, WH.fails);
  WH.pat = P; WH.beats = P.times; WH.notes = P.notes; WH.bi = 0; WH.ct = -0.9; WH.talk = 0; WH.taps = []; WH.lit = 0;
  WH.st = 'call'; whDots(P.times.length, 0); whSub(whText('listen'), 4);
}
function whPulse() {                                                           // el jugador responde (toque o Espacio)
  if (!window.isWhaleActive || window.isMiniIntro) return;
  const now = performance.now();
  if (now - WH.lastP < 90) return;
  WH.lastP = now;
  const tx = WH_POS.trav.x, tz = WH_POS.trav.z, st = WH.st;
  if (st === 'hcall' || st === 'hanswer' || st === 'hverdict') return;                    // en las notas largas importa la duración, no el toque
  if (st === 'call') {                                                          // hablar encima de ella: onda gris y un tono apagado
    WH.talk++; whEmit(tx, tz, 0.5, WH_C_MUTE, 0x888890); MGS.bell(MGS.NOTES[0] / 2, 0, 0.8, 0.012); WH.halo.material.opacity = 0.35; return;
  }
  if (st === 'answer') {
    const i = WH.taps.length; WH.taps.push(WH.at); WH.idleT = 0;
    const n = WH.notes[Math.min(i, WH.notes.length - 1)];
    MGS.bell(MGS.NOTES[n] * 1.0, 0, 1.8, 0.055); whEmit(tx, tz, 0.9, WH_C_YOU, 0xffd9a8); WH.lit = Math.min(WH.pat.times.length, WH.lit + 1); whDots(WH.pat.times.length, WH.lit);
    WH.halo.material.opacity = 0.7; return;
  }
  if (st === 'free') {
    const i = WH.taps.length; WH.taps.push(WH.ft); WH.fSil = 0; WH.idleT = 0;
    MGS.bell(MGS.NOTES[(i * 2) % 6], 0, 1.8, 0.055); whEmit(tx, tz, 0.9, WH_C_YOU, 0xffd9a8); whDots(Math.max(3, WH.taps.length), WH.taps.length);
    WH.halo.material.opacity = 0.7; return;
  }
  whEmit(tx, tz, 0.5, WH_C_YOU, 0xffd9a8); MGS.bell(MGS.NOTES[2], 0, 1.4, 0.03);      // fuera de turno: un pulso suave, sin consecuencias
}
window.whTap = function(cx, cy) { whPulse(); };

// ---------- Nota sostenida: la ballena canta una sola nota larga y se responde con el mismo aliento ----------
function whHoldBegin() { WH.st = 'hcall'; WH.ht = -0.8; WH.hSung = false; WH.holding = false; WH.hHeld = 0; whDots(0, 0); whSub(whText('hold'), 5); }
function whHoldTone(on) {                                                       // la voz del jugador: una nota cálida que dura lo que dura la presión
  if (!on) {
    const T = WH.holdTone; if (!T) return; WH.holdTone = null;
    try { const t = T.ctx.currentTime; T.g.gain.cancelScheduledValues(t); T.g.gain.setTargetAtTime(0, t, 0.22); T.os.forEach(o => o.stop(t + 1.3)); } catch (e) {}
    return;
  }
  if (WH.holdTone || !MGS.ok()) return;
  try {
    const ctx = audioCtx, t = ctx.currentTime, B = MGS.bus(), f = MGS.NOTES[WH.hold ? 3 : 2] / 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 760; lp.connect(g); g.connect(B.input);
    const os = [['triangle', 1, 0], ['sawtooth', 1, 0.004], ['sine', 2, 0]].map(([type, m, d]) => { const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = f * m * (1 + d); og.gain.value = type === 'sawtooth' ? 0.22 : 0.5; o.connect(og); og.connect(lp); o.start(t); return o; });
    WH.holdTone = { ctx, g, os };
  } catch (e) {}
}
window.whDown = function() {
  if (!window.isWhaleActive || window.isMiniIntro || WH.holding) return;
  if (WH.st !== 'hcall' && WH.st !== 'hanswer') return;
  WH.holding = true; if (WH.st === 'hanswer') WH.hHeld = 0; whHoldTone(true);
};
window.whUp = function() {
  if (!window.isWhaleActive || !WH.holding) return;
  WH.holding = false; whHoldTone(false);
  if (WH.st !== 'hanswer' || WH.hHeld < 0.3) { if (WH.st === 'hanswer') WH.hHeld = 0; return; }       // un toque suelto no cuenta
  const r = WH.hHeld / WH.hdur;
  whHoldVerdict(r >= 0.6 && r <= 1.7);
};
function whHoldVerdict(ok) {
  WH.st = 'hverdict'; WH.vt = 0;
  if (ok || WH.hfails >= 2) {
    WH.att = Math.max(WH.att, [0.78, 0.92][WH.hold]); WH.lone = Math.max(0, WH.lone - 0.3); WH.echoes++; WH.hpass = true; WH.hfails = 0; WH.hold++;
    whSub(ok ? whText('holdOk') : whText('gentle'), 5);
    MGS.arpeggio([0, 2, 4], 0.25, 3.2, 0.035); whSing(MGS.NOTES[2] / 4, 3.6, 0.05, false);
    whMouth(_whM); whEmit(_whM.x, _whM.z, 1.3, WH_C_WHALE, 0xbfe6ff); whEmit(WH_POS.trav.x, WH_POS.trav.z, 1.3, WH_C_WHALE, 0xbfe6ff);
    WH.sing = 1; hgMeow(0, false); setTimeout(() => hgMeow(1, false), 700);
    if (WH.hold >= 2) whChoirSing(1);                                           // al completar la segunda nota, a lo lejos otras ballenas responden
  } else {
    WH.hfails++; WH.lone = Math.min(1, WH.lone + 0.08); WH.hpass = false; whSub(whText('holdRetry'), 6);
  }
}

// ---------- Coro lejano: otras ballenas, apenas siluetas de puntos, que se unen cuando hay sintonía ----------
function whBuildChoir() {
  const g = new THREE.Group(); WH.choir = [];
  [[-44, -5, -22, 0.5, 1.0], [-52, -5, 24, 2.7, 0.85], [-14, -5, -36, 5.0, 0.7]].forEach(([x, y, z, yaw, sc], k) => {
    const n = 200, p = mkGlowPoints(n), A = p.geometry.attributes;
    for (let i = 0; i < n; i++) {
      let px, py, pz;
      if (i < 160) { const u = Math.random(), r = 2.0 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.04)), 0.6) * (1 - 0.55 * u), a = Math.random() * 6.2832; px = -9 + 15 * u; py = r * Math.sin(a) * 0.8; pz = r * Math.cos(a); }
      else { const u = Math.random(); px = 6 + u * 3.6; py = (Math.random() - 0.5) * 0.3; pz = (Math.random() < 0.5 ? -1 : 1) * u * 2.8 * Math.random(); }
      A.position.array[i * 3] = px * sc; A.position.array[i * 3 + 1] = py * sc; A.position.array[i * 3 + 2] = pz * sc;
      A.aCol.array[i * 3] = 0.62; A.aCol.array[i * 3 + 1] = 0.8; A.aCol.array[i * 3 + 2] = 1; A.aSize.array[i] = 0.22 * sc; A.aAlpha.array[i] = 0.7;
    }
    p.material.uniforms.uOpacity.value = 0;
    const holder = new THREE.Group(); holder.add(p); holder.position.set(x, y, z); holder.rotation.y = yaw; g.add(holder);
    WH.choir.push({ holder, pts: p, x, z, ph: k * 2.1, sc });
  });
  return g;
}
function whChoirSing(amp) {                                                     // acorde lejano, suave: cada ballena una nota
  (WH.choir || []).forEach((c, i) => setTimeout(() => {
    if (!window.isWhaleActive) return;
    whSing(MGS.NOTES[[0, 2, 3][i % 3]] / 4, 4.2, 0.03 * amp, i === 1);
    whEmit(c.x, c.z, 0.9 * amp, WH_C_WHALE, 0x9fd0ff); c.glow = 1;
  }, i * 650));
}
function whBuildPlankton() {                                                     // plancton bioluminiscente: nubes de motas que respiran con la sintonía
  const n = 240, p = mkGlowPoints(n), A = p.geometry.attributes; WH.plank = { p, seeds: [] };
  for (let i = 0; i < n; i++) {
    const x = WH_ISO.target.x + (Math.random() - 0.5) * 80, z = (Math.random() - 0.5) * 60, y = 1 + Math.random() * 15;
    A.position.array[i * 3] = x; A.position.array[i * 3 + 1] = y; A.position.array[i * 3 + 2] = z; WH.plank.seeds.push(Math.random() * 6.28);
    A.aCol.array[i * 3] = 0.55; A.aCol.array[i * 3 + 1] = 0.85; A.aCol.array[i * 3 + 2] = 0.95; A.aSize.array[i] = 0.12 + Math.random() * 0.18; A.aAlpha.array[i] = 0;
  }
  return p;
}

function whVerdict(res) {                                                       // la ballena escucha tu respuesta
  WH.st = 'verdict'; WH.vt = 0; WH.ok = res.ok; WH.q = res.q;
  const en = MG.isEN();
  if (res.ok || WH.fails >= 2) {
    const gentle = !res.ok;                                                     // tras tres intentos, ella se acerca igualmente: no hay castigo
    WH.att = Math.max(WH.att, [0.2, 0.4, 0.6][WH.round]); WH.lone = Math.max(0, WH.lone - 0.3); WH.fails = 0; WH.echoes++;
    whSub(gentle ? whText('gentle') : whText('ok'), 5);
    [0, 2, 4].forEach((n, i) => whSing(MGS.NOTES[n] / 4, 3.2, 0.05, false));
    MGS.arpeggio([2, 3, 5], 0.18, 2.2, 0.04);
    whMouth(_whM); whEmit(_whM.x, _whM.z, 1.2, WH_C_WHALE, 0xbfe6ff); whEmit(WH_POS.trav.x, WH_POS.trav.z, 1.2, WH_C_WHALE, 0xbfe6ff);
    WH.sing = 1; hgMeow(0, false); setTimeout(() => hgMeow(1, false), 700);
    WH.pass = true;
  } else {
    WH.fails++; WH.lone = Math.min(1, WH.lone + 0.08);
    whSub(WH.talk > 0 ? whText('over') : whText('retry'), 6);
    WH.pass = false;
  }
}

function whUpdate(dt) {
  const en = MG.isEN(), calm = reduceMotionMQ.matches, t = MG.time, E = WH.els;
  WH.t += dt; WH.sing = Math.max(0, WH.sing - dt / 1.6);
  WH.halo.material.opacity += (0.2 + 0.3 * WH.attS - WH.halo.material.opacity) * Math.min(1, dt * 2);

  // ----- Máquina de estados -----
  switch (WH.st) {
    case 'arrive':
      WH.rise = Math.min(1, WH.t / 3.5);
      if (WH.t > 4) whStartCall();
      break;
    case 'call': {
      WH.ct += dt;
      while (WH.bi < WH.beats.length && WH.ct >= WH.beats[WH.bi]) { whBeat(WH.notes[WH.bi]); WH.bi++; WH.lit = WH.bi; whDots(WH.beats.length, WH.lit); }
      if (WH.bi >= WH.beats.length && WH.ct >= WH.beats[WH.beats.length - 1] + 1.4) {
        WH.st = 'answer'; WH.at = 0; WH.taps = []; WH.idleT = 0; WH.lit = 0; whDots(WH.beats.length, 0); whSub(whText('answer'), 6);
      }
      break; }
    case 'answer': {
      WH.at += dt; WH.idleT += dt;
      const last = WH.taps.length ? WH.taps[WH.taps.length - 1] : 0, since = WH.at - last;
      if (WH.taps.length && ((WH.taps.length >= WH.beats.length && since > 0.8) || since > 3.2)) {
        const exp = WH.beats, rel = WH.taps.map(x => x - WH.taps[0]);
        whVerdict(whJudge(exp, rel));
      } else if (!WH.taps.length && WH.idleT > 10) {                            // ignorada: canta otra vez, más grave y más sola
        WH.lone = Math.min(1, WH.lone + 0.18); WH.recall = true; whSub(whText('lone'), 7); whStartCall(); WH.idleT = 0;
      }
      break; }
    case 'verdict':
      WH.vt += dt;
      if (WH.vt > 2.6) {
        if (WH.pass) {
          WH.round++;
          if (WH.round >= 3) { WH.recall = false; WH.hold = 0; WH.hfails = 0; whHoldBegin(); }
          else { WH.recall = false; whStartCall(); }
        } else { WH.recall = false; whStartCall(); }
      }
      break;
    case 'hcall': {
      WH.ht += dt;
      if (!WH.hSung && WH.ht >= 0) {
        WH.hSung = true; WH.hdur = WH_HOLD[Math.min(1, WH.hold)] * (1 + 0.12 * Math.min(WH.hfails, 3));
        whSing(MGS.NOTES[WH.hold ? 1 : 0] / 4, WH.hdur + 1.0, 0.075, WH.recall);
        whMouth(_whM); whEmit(_whM.x, _whM.z, 1.1, WH_C_WHALE, 0x9fd0ff);
      }
      if (WH.hSung) WH.sing = Math.max(WH.sing, Math.max(0, Math.min(1, 1 - (WH.ht - WH.hdur) / 0.9)));          // la boca sigue abierta mientras dura la nota
      if (WH.hSung && WH.ht >= WH.hdur + 1.4) { WH.st = 'hanswer'; WH.at = 0; WH.idleT = 0; WH.hHeld = 0; whSub(whText('holdAns'), 7); }
      break; }
    case 'hanswer': {
      WH.at += dt; WH.idleT += dt;
      if (WH.holding) { WH.hHeld += dt; WH.halo.material.opacity = Math.max(WH.halo.material.opacity, 0.3 + Math.min(0.5, WH.hHeld * 0.1)); WH.idleT = 0; if (WH.hHeld > WH.hdur * 2.2) { window.whUp(); } }
      else if (WH.idleT > 11) { WH.lone = Math.min(1, WH.lone + 0.18); WH.recall = true; whSub(whText('holdLone'), 6); WH.st = 'hcall'; WH.ht = -0.8; WH.hSung = false; WH.idleT = 0; }
      break; }
    case 'hverdict':
      WH.vt += dt;
      if (WH.vt > 2.8) {
        WH.recall = false;
        if (WH.hpass) {
          if (WH.hold >= 2) { WH.st = 'free'; WH.ft = 0; WH.taps = []; WH.fSil = 0; WH.idleT = 0; whDots(3, 0); whSub(whText('free'), 7); }
          else whHoldBegin();
        } else whHoldBegin();
      }
      break;
    case 'free': {
      WH.ft += dt; WH.idleT += dt; WH.fSil += dt;
      const n = WH.taps.length;
      if ((n >= 3 && WH.fSil > 1.9) || n >= 7) {
        const base = WH.taps[0]; WH.echoList = WH.taps.map(x => Math.min(x - base, 99));
        for (let i = 1; i < WH.echoList.length; i++) { const g = WH.echoList[i] - WH.echoList[i - 1]; if (g > 2.2) { const cut = g - 2.2; for (let j = i; j < WH.echoList.length; j++) WH.echoList[j] -= cut; } }   // las pausas largas se acortan
        WH.st = 'echo'; WH.echoT = -0.6; WH.ei = 0; WH.recall = false; whSub(whText('echo'), 8);
      } else if (n < 3 && WH.idleT > 12) { WH.lone = Math.min(1, WH.lone + 0.12); whBeat(2, true); WH.idleT = 6; }
      break; }
    case 'echo': {
      WH.echoT += dt;
      while (WH.ei < WH.echoList.length && WH.echoT >= WH.echoList[WH.ei]) { whBeat([0, 2, 4, 3, 1, 5, 2][WH.ei % 7], false); WH.ei++; }
      if (WH.ei >= WH.echoList.length && WH.echoT >= WH.echoList[WH.echoList.length - 1] + 1.8) { WH.st = 'finale'; WH.fin = 0; WH.att = 1; WH.lone = 0; WH.finBurst = 0; whSub(whText('end'), 12); }
      break; }
    case 'finale':
      WH.fin += dt; WH.rise = 1 + Math.min(1, WH.fin / 5) * 0.8;
      if (WH.fin > 0.6 && WH.finBurst < 4 && WH.fin > 0.6 + WH.finBurst * 1.2) {
        WH.finBurst++; whMouth(_whM); whEmit(_whM.x, _whM.z, 1.4, WH_C_WHALE, 0xbfe6ff); whEmit(WH_POS.trav.x, WH_POS.trav.z, 1.4, WH_C_YOU, 0xffd9a8);
        MGS.arpeggio([0, 2, 3, 5], 0.2, 3, 0.04); whSing(MGS.NOTES[WH.finBurst % 4] / 4, 3, 0.07, false); WH.sing = 1;
        if (WH.finBurst === 1 || WH.finBurst === 3) whChoirSing(1.1);
        if (MG.fx) MG.fx.burst(WH_POS.x, 12, WH_POS.z, 40, 3, 2.6, 0xbfe6ff, 0.3, 0.9);
      }
      if (WH.view) { if (WH.fin > 9.5) { WH.vT -= dt; if (WH.vT <= 0) { WH.vT = 9; WH.vk = (WH.vk || 0) + 1; whBeat([0, 2, 4, 3][WH.vk % 4], true); whChoirSing(0.8); } } }
      else if (WH.fin > 9.5) { window.endWhaleGame(); return; }
      break;
  }
  if (!window.isWhaleActive) return;

  // soledad y sintonía (suavizadas)
  if (WH.st === 'answer' || WH.st === 'free') WH.lone = Math.max(WH.lone, Math.min(1, WH.idleT / 26));
  else if (WH.st !== 'verdict') WH.lone = Math.max(0, WH.lone - dt * 0.04);
  WH.attS += (WH.att - WH.attS) * Math.min(1, dt * 0.9); WH.loneS += (WH.lone - WH.loneS) * Math.min(1, dt * 0.7);
  const A = WH.attS, Ls = WH.loneS, sw = calm ? 0 : 1;

  // ----- Cámara: giro libre con distancia fija + zoom (mismo manejo que la Hoguera) -----
  const CM = HG_CAM;
  if (!CM.ptrs.size) { CM.yawT += CM.yawV * dt; CM.yawV *= Math.exp(-dt * 3.2); }
  const kc = 1 - Math.exp(-dt * 9);
  CM.yaw += (CM.yawT - CM.yaw) * kc; CM.pit += (CM.pitT - CM.pit) * kc; CM.zoom += (CM.zoomT - CM.zoom) * kc;
  const asp = window.innerWidth / window.innerHeight, fit = Math.max(1, 1.5 / asp);
  const D = (WH_ISO.dist + 6 * A) * fit * CM.zoom;
  const psi = WH_ISO.yaw + CM.yaw + Math.sin(t * 0.04) * 0.02 * sw, phi = Math.max(0.2, Math.min(1.1, WH_ISO.pitch + CM.pit));
  const Tg = WH_ISO.target;
  userGroup.position.set(Tg.x + D * Math.sin(psi) * Math.cos(phi), Tg.y + D * Math.sin(phi), Tg.z + D * Math.cos(psi) * Math.cos(phi));
  userGroup.rotation.set(-phi, psi, 0);

  // ----- Ballena: aparece desde el fondo, respira, abre la mandíbula al cantar y se acerca al sintonizar -----
  const W = WH.whale;
  W.root.position.set(WH_POS.x + 5 * A - 3 * Ls, -9 * (1 - Math.min(1, WH.rise)) + Math.max(0, WH.rise - 1) * 5 + Math.sin(t * 0.5) * 0.25 * sw, WH_POS.z);
  W.root.rotation.y = WH_POS.yaw + Math.sin(t * 0.17) * 0.04 * sw;
  W.body.scale.y = 1 + Math.sin(t * 0.55) * 0.012 * sw + WH.sing * 0.02;
  W.body.rotation.x = -0.02 + Math.sin(t * 0.4) * 0.015 * sw - Ls * 0.05;
  W.tail.rotation.x = Math.sin(t * 0.8) * 0.10 * sw * (1 - Ls * 0.6);
  W.jaw.rotation.x = 0.03 + WH.sing * 0.34;
  W.finR.rotation.z = -(0.12 + Math.sin(t * 0.7) * 0.07 * sw + A * 0.15); W.finL.rotation.z = 0.12 + Math.sin(t * 0.7 + 1) * 0.07 * sw + A * 0.15;
  WH.eyes.forEach(e => { e.material.opacity = (0.25 + 0.5 * A + 0.6 * WH.sing) * (0.85 + 0.15 * Math.sin(t * 2.4)); });
  const mu = WH.mats.screen.uniforms;
  mu.uTime.value = t; mu.uCold.value = Ls * 0.9; mu.uCalm.value = A; mu.uRune.value = 0.2 + 0.7 * A + 0.5 * WH.sing;
  WH.mats.body.uniforms.color.value.setHex(0x4f6272).multiplyScalar(0.7 + 0.7 * A + 0.3 * WH.sing);

  // ----- Mar: ondas -----
  const ou = WH.ocean.material.uniforms; ou.uTime.value = t; ou.uCalm.value = A; ou.uLone.value = Ls;
  for (let i = 0; i < 8; i++) {
    const p = WH.pulses[i], u = ou.uP.value[i], c = ou.uC.value[i];
    if (p) { p.age += dt; u.set(p.x, p.z, p.age, p.amp); c.set(p.col[0], p.col[1], p.col[2]); } else u.set(0, 0, -1, 0);
  }
  if (MG.fx && !calm && Math.random() < dt * (3 + 6 * A)) {                       // motas bioluminiscentes que suben de la ballena
    const wx = W.root.position.x + (Math.random() - 0.5) * 26, wz = W.root.position.z + (Math.random() - 0.5) * 7;
    MG.fx.emit(wx, 6 + Math.random() * 8, wz, (Math.random() - 0.5) * 0.3, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3, 2.5 + Math.random() * 2, Math.random() > 0.5 ? 0xbfe6ff : 0xe7e4de, 0.2, 0.6, 0.3);
  }
  HG.pets.forEach(p => { const b = 1 + Math.sin(t * 1.4 + p.userData.ph) * 0.02; p.scale.y = (p.userData.sy || (p.userData.sy = p.scale.y)) * b; });

  // ----- Coro lejano y plancton -----
  WH.choir.forEach((c, i) => {
    c.glow = Math.max(0, (c.glow || 0) - dt * 0.5);
    const target = Math.max(0, (A - 0.3) / 0.7) * 0.55 + c.glow * 0.45 + (WH.st === 'finale' ? 0.3 : 0);
    const u = c.pts.material.uniforms.uOpacity; u.value += (Math.min(1, target) - u.value) * Math.min(1, dt * 1.2);
    c.holder.position.y = -5 + Math.sin(t * 0.3 + c.ph) * 0.5 * sw; c.holder.rotation.z = Math.sin(t * 0.22 + c.ph) * 0.05 * sw;
    c.holder.position.x = c.x + Math.sin(t * 0.05 + c.ph) * 2 * sw;
  });
  if (WH.plank) {
    const PA = WH.plank.p.geometry.attributes, boost = 0.1 + 0.5 * A + 0.5 * WH.sing;
    for (let i = 0; i < PA.aAlpha.array.length; i++) {
      PA.position.array[i * 3 + 1] += dt * (0.18 + 0.1 * Math.sin(WH.plank.seeds[i])) * sw; if (PA.position.array[i * 3 + 1] > 16) PA.position.array[i * 3 + 1] = 1;
      PA.aAlpha.array[i] = boost * (0.4 + 0.6 * Math.sin(t * 0.8 + WH.plank.seeds[i] * 3) * Math.sin(t * 0.8 + WH.plank.seeds[i] * 3));
    }
    PA.position.needsUpdate = PA.aAlpha.needsUpdate = true;
  }

  // ----- Sonido, interfaz y HUD -----
  whToneUpdate(A, Ls);
  if (E.fill) {
    E.fill.style.width = (A * 100).toFixed(1) + '%';
    E.cold.style.opacity = String(Math.min(1, Ls * 1.1) * (1 - A));
    if (WH.subT > 0) { WH.subT -= dt; if (WH.subT <= 0 && WH.st !== 'finale') E.sub.style.opacity = '0'; }
  }
  MG.setHUD({
    'lives-value': Math.round(Ls * 100) + '%',
    'level-value': (WH.st === 'hcall' || WH.st === 'hanswer' || WH.st === 'hverdict' ? 4 + Math.min(1, WH.hold) : (WH.st === 'free' || WH.st === 'echo' || WH.st === 'finale' ? WH_ROUNDS : Math.min(3, WH.round + 1))) + ' / ' + WH_ROUNDS,
    'files-value': String(WH.echoes),
    'combo-value': Math.round(A * 100) + '%'
  });
}

// ==========================================
// 🛰️ JUEGO OTRO: SPUTNIK — «compañero de viaje» (3 capítulos)
//   I   ENCAJAR    Seis piezas rotas, cada una con una constelación; cada lugar de la sonda guarda la suya. Se calzan; nada se castiga.
//   II  TRANSMITIR Su disco se apaga. Cada fragmento enviado a la Tierra tarda más que el anterior (la Tierra se aleja); solo caben cuatro.
//   III DERIVA     Tú eres la sonda y no eliges rumbo: solo aferras o sueltas lo que pasa. Lo que llevas decide el final.
//   Memoria técnica como cuidado con pérdida (ana-arqueología), no como almacenamiento.
// ==========================================
window.isSputnikActive = false;
const SPT_ISO = { yaw: 0.55, pitch: 0.32, dist: 21, fov: 42, target: new THREE.Vector3(0, 0, 0) };
const SPT_FR = [                                              // fragmentos del archivo (hechos del Sputnik 1) y lo que la sonda «recuerda»
  { es: 'Lanzado el 4 de octubre de 1957.', en: 'Launched on 4 October 1957.', eEs: 'Sé la fecha en que empecé a sonar.', eEn: 'I know the date I began to sound.' },
  { es: 'Esfera de aluminio pulido, 58 cm.', en: 'Polished aluminium sphere, 58 cm.', eEs: 'Todavía recuerdo mi forma.', eEn: 'I still remember my shape.' },
  { es: 'Cuatro antenas hacia atrás.', en: 'Four antennae swept back.', eEs: 'Tengo cuatro brazos que no abrazan a nadie.', eEn: 'I have four arms that embrace no one.' },
  { es: 'Su nombre significa «compañero de viaje».', en: 'Its name means "fellow traveler".', eEs: 'Me llamaron compañero. No sé de quién.', eEn: 'They called me companion. I do not know of whom.' },
  { es: 'Transmitía en 20,005 MHz.', en: 'It transmitted on 20.005 MHz.', eEs: 'Mi voz vive en una frecuencia exacta.', eEn: 'My voice lives on an exact frequency.' },
  { es: 'Solo decía: bip.', en: 'It only said: beep.', eEs: 'Solo supe decir una cosa.', eEn: 'I only knew how to say one thing.' },
  { es: 'No llevaba instrumentos de ciencia.', en: 'It carried no science instruments.', eEs: 'No medí nada. Solo estuve.', eEn: 'I measured nothing. I was simply there.' },
  { es: 'Los radioaficionados lo siguieron desde sus patios.', en: 'Radio amateurs followed it from their yards.', eEs: 'Alguien me escuchaba desde un patio.', eEn: 'Someone listened to me from a yard.' },
  { es: 'Para unos fue esperanza; para otros, amenaza.', en: 'For some it was hope; for others, a threat.', eEs: 'Me oyeron de maneras que no elegí.', eEn: 'I was heard in ways I did not choose.' },
  { es: 'Orbitó 92 días.', en: 'It orbited for 92 days.', eEs: 'Tuve noventa y dos días de cielo.', eEn: 'I had ninety-two days of sky.' },
  { es: 'Se quemó al volver, el 4 de enero de 1958.', en: 'It burned up on return, on 4 January 1958.', eEs: 'Volver también es una forma de irse.', eEn: 'Coming back is also a way of leaving.' },
  { es: 'Arriba quedan miles de satélites sin voz.', en: 'Thousands of voiceless satellites remain above.', eEs: 'Hay muchos como yo, callados.', eEn: 'There are many like me, silent.' }
];
const SPT_ITEMS = {                                            // lo que pasa a la deriva (capítulo IV)
  ruin: { es: 'un trozo de ruina', en: 'a piece of ruin', hex: 0x9a9fa8 },
  voice: { es: 'una voz', en: 'a voice', hex: 0xffd9a8 },
  light: { es: 'una luz lejana', en: 'a distant light', hex: 0xbfe6ff },
  silence: { es: 'un silencio', en: 'a silence', hex: 0xcfa3c4 },
  name: { es: 'un nombre', en: 'a name', hex: 0xd9c28a }
};
const SPT_TXT = {
  es: {
    c1: 'I · ENCAJAR', c2: 'II · TRANSMITIR', c3: 'III · DERIVA',
    h1: 'Toca una pieza y luego el lugar que le corresponde: cada pieza lleva una constelación, y cada lugar guarda la suya. Arrastra el espacio vacío para girar; pellizca para acercar.',
    h2: 'El disco se apaga. Toca un fragmento para enviarlo a la Tierra: cada envío tarda más que el anterior, y solo caben cuatro. Lo que no envíes se perderá.',
    h3: 'No eliges el rumbo. Toca lo que pase cerca para aferrarlo; toca lo que llevas para soltarlo. Solo caben tres.',
    s1: '…llega en pedazos. Cada uno recuerda su lugar…', s1b: '…aún no encaja. Mira su constelación…', s1ok: '…encaja. Y empieza a sonar.',
    s2: '…su disco se apaga…', s2full: 'Solo caben cuatro envíos.', s2end: '…lo que no se envió ya no está.', s2late: '…la Tierra se aleja. Cada mensaje tarda más…',
    s3: '…ahora eres tú quien deriva…', s3far: '…aún está lejos…', s3full: '…ya llevas lo que puedes llevar…', s3burn: '…vuelve. Y se quema.',
    close: 'CERRAR EL ARCHIVO', you: 'ENVÍAS', probe: 'SONDA', kept: 'enviado',
    end1: 'Se quemó el 4 de enero de 1958.', endNone: 'No llevaba nada, y aun así alguien lo escuchó.', carry: 'Llevaba', and: 'y', saved: (n) => n === 0 ? 'Del archivo no se envió nada.' : n === 1 ? 'Del archivo se envió un fragmento.' : `Del archivo se enviaron ${n} fragmentos.`,
    toast: 'Una esfera pulida sigue diciendo bip.', title: 'COMPAÑERO DE VIAJE'
  },
  en: {
    c1: 'I · FITTING', c2: 'II · TRANSMITTING', c3: 'III · DRIFT',
    h1: 'Tap a piece, then the place that belongs to it: each piece carries a constellation, and each place keeps its own. Drag empty space to turn; pinch to zoom.',
    h2: 'The disk is dying. Tap a fragment to send it to Earth: each send takes longer than the last, and only four fit. What you do not send will be lost.',
    h3: 'You do not choose the course. Tap what passes near to hold it; tap what you carry to let it go. Only three fit.',
    s1: '…it arrives in pieces. Each remembers its place…', s1b: '…not yet. Look at its constellation…', s1ok: '…it fits. And begins to sound.',
    s2: '…its disk is dying…', s2full: 'Only four sends fit.', s2end: '…what was not sent is no longer there.', s2late: '…Earth is drifting away. Each message takes longer…',
    s3: '…now you are the one who drifts…', s3far: '…still far…', s3full: '…you already carry what you can carry…', s3burn: '…it returns. And it burns.',
    close: 'CLOSE THE ARCHIVE', you: 'YOU SEND', probe: 'PROBE', kept: 'sent',
    end1: 'It burned up on 4 January 1958.', endNone: 'It carried nothing, and still someone listened.', carry: 'It carried', and: 'and', saved: (n) => n === 0 ? 'Nothing from the archive was sent.' : n === 1 ? 'One fragment of the archive was sent.' : `${n} fragments of the archive were sent.`,
    toast: 'A polished sphere is still saying beep.', title: 'FELLOW TRAVELER'
  }
};
function sptT(k) { return SPT_TXT[MG.isEN() ? 'en' : 'es'][k]; }
const SPT = {
  st: 'idle', ch: 0, t: 0, ct: 0, group: null, tilt: null, probe: null, wire: null, halo: null, earth: null, stars: null,
  els: {}, subT: 0, bip: false, bipT: 0, pieces: [], sockets: [], sel: -1, holdT: 0, warnT: 0, idle1: 0, nextCh: 0,
  fr: [], kept: [], diskMax: 56, msgs: [], sent: 0, arrived: 0, log: null, closing: false, hintK: -1, hintT: 0, miss: 0, items: [], held: [], spawnT: 0, spawned: 0, burnT: 0, endT: 0, saved: null
};
const _sptV = new THREE.Vector3(), _sptRC = new THREE.Raycaster();

function sptSub(text, secs) { const el = SPT.els.sub; if (!el) return; el.textContent = text; el.style.opacity = '1'; SPT.subT = secs || 6; }
function sptShuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sptBip(vol) { MGS.ping(1480, 0, 0.5, (vol || 0.035) * 0.7); MG.pulse(0, 0, 0xbfe6ff, 1.2, 10, 2.4, 0.14, 0); }

// ---------- Escena ----------
//   Todo se hace con la misma materia que el resto del universo: monitores CRT que fallan y puntos de luz. Nada es liso.
function sptPoints(n, fn) {                                     // nube de puntos luminosos; fn(i, o) rellena {x,y,z,r,g,b,s,a}
  const p = mkGlowPoints(n), A = p.geometry.attributes, o = { x: 0, y: 0, z: 0, r: 1, g: 1, b: 1, s: 0.2, a: 1 };
  for (let i = 0; i < n; i++) {
    o.r = o.g = o.b = 1; o.a = 1; fn(i, o);
    A.position.array[i * 3] = o.x; A.position.array[i * 3 + 1] = o.y; A.position.array[i * 3 + 2] = o.z;
    A.aCol.array[i * 3] = o.r; A.aCol.array[i * 3 + 1] = o.g; A.aCol.array[i * 3 + 2] = o.b;
    A.aSize.array[i] = o.s; A.aAlpha.array[i] = o.a;
  }
  A.position.needsUpdate = A.aCol.needsUpdate = A.aSize.needsUpdate = A.aAlpha.needsUpdate = true;
  return p;
}
function sptMonitors(fill, scale, pivot) {                      // grupo de monitores fusionados (usa los materiales compartidos de Sputnik)
  const cells = []; fill(cells);
  const g = hgPart(cells, pivot || [0, 0, 0], [0, 0, 0], SPT.mats); g.scale.setScalar(scale); return g;
}
function sptBuildScene() {
  SPT.mats = hgMakeMats(0x6a7684);
  const g = new THREE.Group();
  // cielo: estrellas de tamaños y tintes distintos + una banda de polvo en espiral, apenas visible, que gira muy despacio
  SPT.stars = sptPoints(620, (i, o) => { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = 70 + Math.random() * 45, s = Math.sqrt(1 - u * u), k = Math.random();
    o.x = r * s * Math.cos(a); o.y = r * u; o.z = r * s * Math.sin(a); o.s = 0.07 + Math.pow(Math.random(), 4) * 0.4; o.a = 0.35 + Math.random() * 0.65;
    if (k < 0.2) { o.r = 0.7; o.g = 0.82; o.b = 1; } else if (k < 0.3) { o.r = 1; o.g = 0.8; o.b = 0.65; } }); g.add(SPT.stars);
  SPT.dust = sptPoints(1100, (i, o) => { const arm = i % 3, t = Math.pow(Math.random(), 0.7), r = 22 + t * 62, a = arm * 2.094 + t * 3.4 + (Math.random() - 0.5) * 0.35;
    o.x = Math.cos(a) * r; o.z = Math.sin(a) * r - 14; o.y = (Math.random() - 0.5) * (4 + t * 9) - 10; o.s = 0.12 + Math.random() * 0.45; o.a = 0.07 + Math.random() * 0.16;
    if (arm === 0) { o.r = 0.45; o.g = 0.6; o.b = 1; } else if (arm === 1) { o.r = 0.8; o.g = 0.5; o.b = 0.85; } else { o.r = 0.4; o.g = 0.85; o.b = 0.9; } }); g.add(SPT.dust);
  // la Tierra: una esfera de puntos con continentes de ruido, y su aliento
  SPT.earth = new THREE.Group();
  const GA = 2.399963, NE = 2200;
  SPT.earth.add(sptPoints(NE, (i, o) => { const y = 1 - 2 * (i + 0.5) / NE, rr = Math.sqrt(1 - y * y), a = i * GA, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const n = Math.sin(x * 3.1 + 1) * Math.cos(z * 2.7) + Math.sin(y * 4.3 + x * 2) * 0.6, land = n > 0.35;
    o.x = x * 6; o.y = y * 6; o.z = z * 6; o.s = land ? 0.13 : 0.085; o.a = land ? 0.85 : 0.5;
    if (land) { o.r = 0.55; o.g = 0.78; o.b = 0.62; } else { o.r = 0.22; o.g = 0.45; o.b = 0.8; } }));
  const eh = mkHalo(0x6fa8d8, 21, 0.1); SPT.earth.add(eh); SPT.earth.userData.halo = eh;
  SPT.earth.position.set(-36, -9, -10); g.add(SPT.earth);
  // la sonda: una esfera de monitores (con franjas de runas), cuatro antenas de monitores y un aliento de puntos
  const tilt = new THREE.Group(); SPT.tilt = tilt; g.add(tilt);
  const probe = new THREE.Group(); SPT.probe = probe; tilt.add(probe);
  probe.add(sptMonitors((c) => { hgDome(c, 0, 0, 0, 6, 6, 6, Math.PI, [1, 3], 0.0); }, 0.2));
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sy]) => {
    probe.add(sptMonitors((c) => { hgChain(c, [[sx * 3.4, sy * 3.4, 3], [sx * 5, sy * 5, 13], [sx * 7.6, sy * 7.6, 27], [sx * 10.5, sy * 10.5, 44]], 3.1, 0, 0, 'F', 1.5, 0.55, 3); }, 0.2));
  });
  SPT.shell = sptPoints(380, (i, o) => { const y = 1 - 2 * (i + 0.5) / 380, rr = Math.sqrt(1 - y * y), a = i * GA, R = 1.5 + Math.random() * 0.25;
    o.x = Math.cos(a) * rr * R; o.y = y * R; o.z = Math.sin(a) * rr * R; o.s = 0.05 + Math.random() * 0.07; o.a = 0.8; o.r = 0.6; o.g = 0.8; o.b = 1; }); probe.add(SPT.shell);
  // órbita: un hilo de puntos y un cometa pequeño que la recorre
  SPT.orbit = sptPoints(260, (i, o) => { const a = i / 260 * 6.283; o.x = Math.cos(a) * 11; o.z = Math.sin(a) * 11 * 0.55; o.y = Math.sin(a) * 2.2; o.s = 0.05; o.a = 0.28; o.r = 0.6; o.g = 0.75; o.b = 1; }); g.add(SPT.orbit);
  SPT.comet = mkHalo(0xbfe6ff, 1.1, 0.8); g.add(SPT.comet);
  SPT.halo = mkHalo(0x9fd0ff, 6, 0.04); probe.add(SPT.halo);
  SPT.stars.material.uniforms.uOpacity.value = 0.75; SPT.dust.material.uniforms.uOpacity.value = 0.7; SPT.orbit.material.uniforms.uOpacity.value = 0.6; SPT.shell.material.uniforms.uOpacity.value = 0.6;
  SPT.earth.children[0].material.uniforms.uOpacity.value = 0.72;
  scene.add(g); SPT.group = g;
}

// ---------- Capítulo I: encajar ----------
function sptConstel(n, R, fn) {                                  // constelación de n vértices (3..8) unidos por hilos de puntos; fn(o, esVértice) tiñe
  const verts = []; for (let v = 0; v < n; v++) { const q = v / n * 6.283 - 1.5708; verts.push([Math.cos(q) * R, Math.sin(q) * R]); }
  const per = 5, tot = n * (per + 1);
  return sptPoints(tot, (i, o) => { const e = Math.floor(i / (per + 1)), u = (i % (per + 1)) / (per + 1), A = verts[e], B = verts[(e + 1) % n], vtx = (i % (per + 1)) === 0;
    o.x = A[0] + (B[0] - A[0]) * u; o.y = A[1] + (B[1] - A[1]) * u; o.z = 0; fn(o, vtx); });
}
function sptBuildPieces() {
  const makers = [
    (c) => hgShell(c, 0, 0, 0, 6, 6, 6, ['+z', '-z', '+x', '-x', '+y'], 0),                                   // caja de pantallas
    (c) => hgSpike(c, 0, -7, 0, [0, 1, 0], 6, 5, 3.2, [0, 0, 1]),                                           // espina
    (c) => hgDome(c, 0, 0, 0, 5, 5, 5, Math.PI / 2, [1], 0),                                                 // cúpula
    (c) => hgChain(c, [[-6, 0, 0], [-3, 0, 4], [3, 0, 4], [6, 0, 0], [3, 0, -4]], 2.6, 0, 0, 'F', 2.2, 1.6, 3),   // arco de monitores
    (c) => hgFeather(c, 0, -6, 0, [0, 1, 0], 7, 4.2, 3.4, [0, 0, 1]),                                       // pluma
    (c) => hgDome(c, 0, 0, 0, 4, 6, 4, Math.PI * 0.85, [2], 0)                                               // cápsula
  ];
  const cols = [[0.75, 0.9, 1], [0.95, 0.78, 0.6], [0.72, 0.85, 0.68], [0.82, 0.7, 0.88], [0.9, 0.89, 0.85], [0.92, 0.65, 0.6]];
  const hexes = [0xbfe6ff, 0xf2c799, 0xb8d9ad, 0xd1b3e0, 0xe7e4de, 0xea9f95];
  const perm = sptShuffle([0, 1, 2, 3, 4, 5]), shapes = sptShuffle([0, 1, 2, 3, 4, 5]);       // perm[i] = lugar al que pertenece la pieza i
  SPT.pieces = []; SPT.sockets = [];
  const owner = []; perm.forEach((k, i) => { owner[k] = i; });
  for (let k = 0; k < 6; k++) {                                // 6 lugares en un anillo alrededor de la sonda: aro de puntos + la constelación de su pieza
    const a = (k + 0.5) * Math.PI / 3, R = 3.3, sg = new THREE.Group(), oi = owner[k], c = cols[oi];
    const ring = sptPoints(36, (i, o) => { const q = i / 36 * 6.283; o.x = Math.cos(q) * 0.55; o.z = Math.sin(q) * 0.55; o.s = 0.04; o.a = 0.7; o.r = c[0]; o.g = c[1]; o.b = c[2]; });
    sg.add(ring); ring.material.uniforms.uOpacity.value = 0.5;
    const con = sptConstel(3 + oi, 0.3, (o, v) => { o.s = v ? 0.07 : 0.032; o.a = v ? 0.95 : 0.5; o.r = c[0]; o.g = c[1]; o.b = c[2]; }); con.rotation.x = -1.5708; con.position.y = 0.02; sg.add(con);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.userData.socket = k; sg.add(hit);
    sg.position.set(Math.cos(a) * R, 0, Math.sin(a) * R); SPT.tilt.add(sg);
    SPT.sockets.push({ k, a, g: sg, ring, con, hit, piece: -1, pos: sg.position.clone() });
  }
  for (let i = 0; i < 6; i++) {
    const sc = 0.2, mesh = new THREE.Group(), c = cols[i];
    mesh.add(sptMonitors(makers[shapes[i]], 1));
    const con = sptConstel(3 + i, 3.4, (o, v) => { o.s = v ? 0.34 : 0.15; o.a = v ? 0.95 : 0.5; o.r = c[0]; o.g = c[1]; o.b = c[2]; }); con.position.y = 7.5; mesh.add(con);
    const halo = mkHalo(hexes[i], 16, 0); mesh.add(halo);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(6.5, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.userData.piece = i; mesh.add(hit);
    mesh.scale.setScalar(sc); mesh.userData.piece = i;
    const base = i * Math.PI / 3 + 0.3;
    mesh.position.set(Math.cos(base) * 8, 0, Math.sin(base) * 8); SPT.group.add(mesh);
    SPT.pieces.push({ i, mesh, hit, halo, con, sc, col: hexes[i], target: perm[i], slot: -1, base, spin: 0.15 + Math.random() * 0.35, shake: 0 });
  }
}
function sptPlace(pi, k) {
  const p = SPT.pieces[pi], s = SPT.sockets[k];
  if (p.slot >= 0) SPT.sockets[p.slot].piece = -1;
  p.slot = k; s.piece = pi; SPT.group.attach(p.mesh); SPT.tilt.attach(p.mesh); SPT.sel = -1; SPT.hintK = -1; SPT.miss = 0;
  MGS.bell(MGS.NOTES[(pi + k) % 6], 0, 1.8, 0.035); vibrateDevice(14);
  if (MG.fx) { p.mesh.getWorldPosition(_sptV); MG.fx.burst(_sptV.x, _sptV.y, _sptV.z, 8, 1.2, 0.9, p.col, 0.14, 0.8); }
}
function sptUnplace(pi) {
  const p = SPT.pieces[pi]; if (p.slot < 0) return;
  SPT.sockets[p.slot].piece = -1; p.slot = -1; SPT.group.attach(p.mesh); SPT.sel = pi;
  MGS.bell(MGS.NOTES[2] / 2, 0, 0.9, 0.02);
}
function sptTap1(rc) {
  const hitsP = rc.intersectObjects(SPT.pieces.map(p => p.hit), false);
  const hitsS = rc.intersectObjects(SPT.sockets.map(s => s.hit), false);
  const dP = hitsP.length ? hitsP[0].distance : 1e9, dS = hitsS.length ? hitsS[0].distance : 1e9;
  if (dP < 1e9 && dP <= dS + 0.8) {
    const pi = hitsP[0].object.userData.piece, p = SPT.pieces[pi];
    if (p.slot >= 0) sptUnplace(pi); else { SPT.sel = SPT.sel === pi ? -1 : pi; MGS.ping(MGS.NOTES[4], 0, 0.7, 0.025); }
  } else if (dS < 1e9 && SPT.sel >= 0) {
    const k = hitsS[0].object.userData.socket, p = SPT.pieces[SPT.sel];
    if (SPT.sockets[k].piece >= 0) return;
    if (p.target === k) sptPlace(SPT.sel, k);
    else {                                                     // no encaja: la pieza tiembla un poco, sin castigo
      p.shake = 1; MGS.ping(MGS.NOTES[0] / 2, 0, 0.8, 0.02); SPT.miss++;
      if (SPT.miss >= 2) { sptSub(sptT('s1b'), 5); SPT.hintK = p.target; SPT.hintT = 6; }
    }
  }
}

// ---------- Capítulo II: transmitir (interfaz DOM) ----------
function sptStartArchive() {
  const en = MG.isEN(), box = SPT.els.panel; box.innerHTML = '';
  const log = document.createElement('div'); log.style.cssText = 'max-height:12vh; overflow-y:auto; font:300 0.68rem/1.7 -apple-system,Helvetica,Arial,sans-serif; letter-spacing:0.03em; text-align:left; color:#b9bfc9; min-height:1.4em; margin-bottom:8px;';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid; grid-template-columns:repeat(2,1fr); gap:6px; max-height:30vh; overflow-y:auto;';
  const ids = sptShuffle([...Array(SPT_FR.length).keys()]).slice(0, 8);
  SPT.fr = ids.map((id, n) => ({ id, dieAt: 12 + n * ((SPT.diskMax - 18) / ids.length), kept: false, sent: false, dead: false, el: null }));
  SPT.fr.forEach(f => {
    const b = document.createElement('button'); b.type = 'button';
    b.style.cssText = 'pointer-events:auto; text-align:left; background:rgba(10,12,16,0.5); border:1px solid rgba(231,228,222,0.16); color:#c3c8d0; padding:9px 10px; font:300 0.68rem/1.45 -apple-system,Helvetica,Arial,sans-serif; letter-spacing:0.02em; cursor:pointer; transition:opacity .8s, border-color .3s, background .3s;';
    b.textContent = en ? SPT_FR[f.id].en : SPT_FR[f.id].es;
    ['mousedown', 'touchstart', 'mouseup', 'touchend'].forEach(ev => b.addEventListener(ev, (e) => e.stopPropagation()));
    b.addEventListener('click', (e) => { e.stopPropagation(); sptSendFrag(f); });
    f.el = b; grid.appendChild(b);
  });
  const bar = document.createElement('div'); bar.style.cssText = 'margin-top:10px; height:2px; background:rgba(231,228,222,0.12); position:relative;';
  const fill = document.createElement('div'); fill.style.cssText = 'position:absolute; left:0; top:0; height:2px; width:100%; background:#bfe6ff; opacity:0.7; box-shadow:0 0 6px rgba(191,230,255,0.4);'; bar.appendChild(fill);
  const done = document.createElement('button'); done.type = 'button'; done.textContent = sptT('close');
  done.style.cssText = 'pointer-events:auto; margin:12px auto 0; display:block; background:rgba(10,10,12,0.3); border:1px solid rgba(255,255,255,0.14); color:#9a968f; padding:8px 18px; font:300 0.62rem -apple-system,Helvetica,Arial,sans-serif; letter-spacing:0.28em; cursor:pointer;';
  ['mousedown', 'touchstart', 'mouseup', 'touchend'].forEach(ev => done.addEventListener(ev, (e) => e.stopPropagation()));
  done.addEventListener('click', (e) => { e.stopPropagation(); sptEndArchive(); });
  box.appendChild(log); box.appendChild(grid); box.appendChild(bar); box.appendChild(done);
  SPT.els.fill = fill; SPT.els.grid = grid; SPT.log = log; SPT.msgs = []; SPT.sent = 0; SPT.arrived = 0; SPT.kept = []; SPT.closing = false;
  box.style.display = 'block'; sptSub(sptT('s2'), 6);
}
function sptLog(who, text, dim) {
  if (!SPT.log) return;
  const d = document.createElement('div'); d.style.cssText = 'opacity:' + (dim ? 0.55 : 1) + ';';
  d.innerHTML = '<span style="color:#7f8a99; letter-spacing:0.22em; font-size:0.58rem;">' + who + '</span>&nbsp; ';
  d.appendChild(document.createTextNode(text)); SPT.log.appendChild(d); SPT.log.scrollTop = SPT.log.scrollHeight; return d;
}
function sptKill(f) {
  f.dead = true; f.el.style.opacity = '0.2'; f.el.style.borderColor = 'rgba(231,228,222,0.05)'; f.el.style.background = 'transparent'; f.el.disabled = true;
  f.el.textContent = '▒▒▒▒ ▒▒▒ ▒▒▒▒▒▒'; MGS.bell(MGS.NOTES[0] / 4, 0, 1.6, 0.015);
}
function sptSendFrag(f) {
  if (SPT.st !== 'archive' || f.sent || f.dead || SPT.closing) return;
  if (SPT.sent >= 4) { sptSub(sptT('s2full'), 4); MGS.ping(MGS.NOTES[0] / 2, 0, 0.7, 0.015); return; }
  const en = MG.isEN(), i = SPT.sent++, d = 2.0 + 1.6 * i;                    // cada viaje es más largo que el anterior
  f.sent = true; f.kept = true; SPT.kept.push(f.id); f.el.style.borderColor = 'rgba(191,230,255,0.7)'; f.el.style.background = 'rgba(40,70,100,0.35)'; f.el.style.opacity = '1'; f.el.disabled = true;
  const ball = mkHalo(0xffd9a8, 1.4, 0.7); SPT.group.add(ball); ball.position.copy(SPT.probe.position);
  SPT.msgs.push({ i, d, t: 0, phase: 'out', ball, reply: '«' + (en ? SPT_FR[f.id].eEn : SPT_FR[f.id].eEs) + '»' });
  sptLog(sptT('you'), en ? SPT_FR[f.id].en : SPT_FR[f.id].es, false); MGS.bell(MGS.NOTES[3], 0, 1.8, 0.03); vibrateDevice(16);
  SPT.earth.userData.farTarget = (SPT.earth.userData.farTarget !== undefined ? SPT.earth.userData.farTarget : SPT.earth.position.x) - 3.2;    // la Tierra se aleja con cada envío
  if (SPT.sent === 1) setTimeout(() => { if (window.isSputnikActive && SPT.st === 'archive') sptSub(sptT('s2late'), 5); }, 1800);
}
function sptEndArchive() {
  if (SPT.st !== 'archive' || SPT.closing) return;
  SPT.closing = true; SPT.fr.forEach(f => { if (!f.sent && !f.dead) sptKill(f); });
  sptSub(sptT('s2end'), 4);
}

// ---------- Capítulo III: deriva ----------
function sptStartDrift() {
  SPT.els.panel.style.display = 'none'; SPT.els.panel.innerHTML = '';
  SPT.items = []; SPT.held = []; SPT.spawnT = 0; SPT.spawned = 0;
  sptSub(sptT('s3'), 7);
}
function sptSpawnItem() {
  const kinds = Object.keys(SPT_ITEMS), kind = kinds[Math.floor(Math.random() * kinds.length)], K = SPT_ITEMS[kind];
  const cr = ((K.hex >> 16) & 255) / 255, cg = ((K.hex >> 8) & 255) / 255, cb = (K.hex & 255) / 255;
  const mesh = new THREE.Group();
  if (kind === 'ruin') mesh.add(sptMonitors((c) => { hgShell(c, 0, 0, 0, 6, 6, 6, ['+z', '+x', '+y'], 0.35); }, 0.17));          // un trozo roto de pantallas
  else if (kind === 'name') mesh.add(sptMonitors((c) => { hgChain(c, [[-5, -3, 0], [-2, 3, 0], [1, -2, 0], [4, 4, 0], [6, -1, 0]], 2.8, 0, 0, 'F', 1.7, 1.2, 1); }, 0.17));   // un glifo que se enciende
  else if (kind === 'voice') mesh.add(sptPoints(90, (i, o) => { const ring = i % 3, q = (i / 3) * 0.4 + ring, R = 0.25 + ring * 0.28; o.x = Math.cos(q) * R; o.z = Math.sin(q) * R; o.y = Math.sin(q * 2) * 0.05; o.s = 0.08; o.a = 0.9 - ring * 0.2; o.r = cr; o.g = cg; o.b = cb; }));   // anillos concéntricos
  else if (kind === 'light') mesh.add(sptPoints(70, (i, o) => { const arm = i % 4, d = Math.floor(i / 4) / 17, q = arm * 1.5708; const R = d * 0.9; o.x = Math.cos(q) * R; o.y = Math.sin(q) * R; o.z = 0; o.s = 0.14 * (1 - d) + 0.04; o.a = 1 - d * 0.7; o.r = cr; o.g = cg; o.b = cb; }));   // una cruz de luz
  else { mesh.add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), new THREE.MeshBasicMaterial({ color: 0x000000 })));                                                                     // un silencio: un hueco con corona
         mesh.add(sptPoints(60, (i, o) => { const q = i / 60 * 6.283; o.x = Math.cos(q) * 0.5; o.y = Math.sin(q) * 0.5; o.z = 0; o.s = 0.06; o.a = 0.7; o.r = cr; o.g = cg; o.b = cb; })); }
  const hit = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })); hit.userData.item = true; mesh.add(hit);
  const halo = mkHalo(K.hex, 2.6, 0.0); mesh.add(halo);
  const it = { kind, mesh, hit, halo, state: 'drift', x: -26, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 16, vx: 2.4 + Math.random() * 0.8, vy: (Math.random() - 0.5) * 0.15, vz: 0, slot: -1, spin: 0.4 + Math.random() * 0.8, ph: Math.random() * 6 };
  mesh.position.set(it.x, it.y, it.z); mesh.userData.it = it; hit.userData.itRef = it; SPT.group.add(mesh); SPT.items.push(it);
}
function sptDropItem(it) { SPT.group.remove(it.mesh); it.mesh.traverse(c => { if (c.geometry && c.geometry.dispose) c.geometry.dispose(); if (c.material && c.material.dispose && !(SPT.mats && (c.material === SPT.mats.body || c.material === SPT.mats.screen))) c.material.dispose(); }); }
function sptTap4(rc) {
  const hits = rc.intersectObjects(SPT.items.map(i => i.hit), false); if (!hits.length) return;
  const it = hits[0].object.userData.itRef;
  if (it.state === 'held') { it.state = 'free'; const d = it.mesh.position.clone().normalize(); it.vx = d.x * 3; it.vy = d.y * 3; it.vz = d.z * 3; SPT.held = SPT.held.filter(x => x !== it); MGS.bell(MGS.NOTES[1] / 2, 0, 1.6, 0.02); return; }
  if (it.state !== 'drift') return;
  if (it.mesh.position.length() > 8) { sptSub(sptT('s3far'), 3); return; }
  if (SPT.held.length >= 3) { sptSub(sptT('s3full'), 4); return; }
  it.state = 'held'; SPT.held.push(it); it.slot = [0, 1, 2].find(s => !SPT.held.some(h => h !== it && h.slot === s));
  MGS.arpeggio([it.slot, it.slot + 2], 0.07, 1.4, 0.035); vibrateDevice(18);
  if (MG.fx) MG.fx.burst(it.mesh.position.x, it.mesh.position.y, it.mesh.position.z, 8, 1.4, 0.9, SPT_ITEMS[it.kind].hex, 0.18, 0.8);
}

// ---------- Interfaz ----------
function sptBuildUI() {
  const en = MG.isEN();
  const ui = MG.buildUI(sptT('h1'));
  const title = document.createElement('div');
  title.style.cssText = 'font-size:0.66rem; font-weight:300; letter-spacing:0.34em; color:#a8a49c;'; title.textContent = sptT('title');
  const chap = document.createElement('div'); chap.style.cssText = 'margin-top:10px; font-size:0.72rem; font-weight:300; letter-spacing:0.3em; color:#e7e4de;';
  ui.extra.appendChild(title); ui.extra.appendChild(chap);
  const sub = document.createElement('div');
  sub.style.cssText = 'position:absolute; left:50%; top:calc(150px + env(safe-area-inset-top,0px)); transform:translateX(-50%); width:min(90vw,640px); text-align:center; font-size:0.95rem; font-weight:300; letter-spacing:0.12em; line-height:1.8; color:#cfd8e3; opacity:0; transition:opacity 1.4s ease; text-shadow:0 0 14px rgba(0,0,0,0.9);';
  ui.root.appendChild(sub);
  const panel = document.createElement('div');
  panel.style.cssText = 'display:none; position:absolute; left:50%; bottom:calc(138px + env(safe-area-inset-bottom,0px)); transform:translateX(-50%); width:min(94vw,560px); pointer-events:none;';
  ui.root.appendChild(panel);
  const bars = [['top'], ['bottom']].map(([pos]) => { const b = document.createElement('div'); b.style.cssText = `position:absolute; left:0; right:0; ${pos}:0; height:0; background:#000; pointer-events:none; transition:height 3s ease;`; ui.root.insertBefore(b, ui.root.firstChild); return b; });
  requestAnimationFrame(() => requestAnimationFrame(() => bars.forEach(b => { b.style.height = '4.5vh'; })));
  SPT.els = { title, chap, sub, panel, hint: ui.hint };
}

// ---------- Capítulos ----------
function sptGo(ch) {
  SPT.ch = ch; SPT.ct = SPT.t;
  SPT.els.chap.textContent = sptT('c' + ch); SPT.els.hint.textContent = sptT('h' + ch);
  MGS.arpeggio([0, 2, 4], 0.14, 2.4, 0.025);
  if (ch === 1) { SPT.st = 'mend'; sptBuildPieces(); sptSub(sptT('s1'), 7); }
  else if (ch === 2) { SPT.st = 'archive'; SPT.pieces.forEach(p => p.mesh.visible = false); SPT.sockets.forEach(s => s.g.visible = false); sptStartArchive(); }
  else if (ch === 3) { SPT.st = 'drift'; sptStartDrift(); }
}

// ---------- Inicio y fin ----------
function sptStart() {
  if (window.isSputnikActive || window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive || window.isWhaleActive) return;
  const en = MG.isEN();
  window.isSputnikActive = true;
  MG.enter(24);
  camera.fov = SPT_ISO.fov; targetFov = SPT_ISO.fov; camera.updateProjectionMatrix();
  userGroup.rotation.order = 'YXZ';
  Object.assign(SPT, { st: 'intro', ch: 0, t: 0, ct: 0, bip: false, bipT: 0, sel: -1, holdT: 0, warnT: 0, idle1: 0, nextCh: 0, kept: [], msgs: [], sent: 0, arrived: 0, items: [], held: [], burnT: 0, endT: 0, subT: 0, closing: false, hintK: -1, hintT: 0, miss: 0 });
  sptBuildScene();
  sptBuildUI();
  hgCamReset(); hgCamBind();
  morphHUD('resonar');
  showSystemToast(sptT('toast'), '#e7e4de');
  setTimeout(() => { if (window.isSputnikActive && SPT.st === 'intro') sptGo(1); }, 2500);
}
window.startSputnikGame = function(data) {
  if (MG.pending || window.isSputnikActive || window.isWhaleActive || window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive) return;
  MG.pending = true;
  MG.reflect(MG.text('sputnik', 'intro'), () => { MG.pending = false; sptStart(); },
    { cancelable: true, onCancel: () => { MG.pending = false; if (data && typeof openProjectPopup === 'function') openProjectPopup(data); } });
};
function sptTeardown() {
  window.isSputnikActive = false; SPT.st = 'idle';
  hgCamUnbind();
  if (SPT.group) { mgDispose(SPT.group); SPT.group = null; }
  SPT.tilt = SPT.probe = SPT.shell = SPT.halo = SPT.earth = SPT.stars = SPT.dust = SPT.orbit = SPT.comet = SPT.mats = null; SPT.pieces = []; SPT.sockets = []; SPT.items = []; SPT.held = []; SPT.msgs = []; SPT.fr = []; SPT.els = {}; SPT.log = null;
}
window.endSputnikGame = function() { if (!window.isSputnikActive) return; sptTeardown(); MG.exit(); setTimeout(() => { MG.reflect(MG.text('sputnik', 'outro'), () => {}); }, 700); };
window.abortSputnikGame = function() { if (!window.isSputnikActive) return; sptTeardown(); MG.exit(); setTimeout(() => { MG.reflect(MG.text('sputnik', 'outro'), () => {}); }, 700); };
window.sptTap = function(cx, cy) {
  if (!window.isSputnikActive || window.isMiniIntro) return;
  _sptRC.setFromCamera({ x: (cx / window.innerWidth) * 2 - 1, y: -(cy / window.innerHeight) * 2 + 1 }, camera);
  if (SPT.st === 'mend') sptTap1(_sptRC); else if (SPT.st === 'drift') sptTap4(_sptRC);
};

// ---------- Actualización ----------
function sptEpilogue() {
  const en = MG.isEN(), L = en ? 'en' : 'es', names = SPT.held.map(h => SPT_ITEMS[h.kind][L]);
  let s = sptT('end1') + ' ';
  if (!names.length) s += sptT('endNone');
  else s += sptT('carry') + ' ' + (names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' ' + sptT('and') + ' ' + names[names.length - 1]) + '.';
  return s + ' ' + sptT('saved')(SPT.kept.length);
}
function sptUpdate(dt) {
  const calm = reduceMotionMQ.matches, t = MG.time, sw = calm ? 0 : 1;
  SPT.t += dt; SPT.subT -= dt;
  if (SPT.els.sub && SPT.subT <= 0) SPT.els.sub.style.opacity = '0';
  const T = SPT.t - SPT.ct;

  // sonda: gira despacio; el bip suena una vez sostenida
  SPT.probe.rotation.y += dt * 0.12 * sw;
  const MT = SPT.mats, bipK = SPT.bip ? Math.max(0, 1 - (SPT.bipT > 0 ? 2.6 - SPT.bipT : 0) * 1.2) : 0;
  MT.screen.uniforms.uTime.value = t; MT.screen.uniforms.uRune.value = SPT.bip ? 0.45 + 0.55 * bipK : 0.12;
  if (SPT.st !== 'burn') MT.screen.uniforms.uCalm.value = SPT.bip ? 0.9 : 0.55;
  SPT.stars.rotation.y += dt * 0.004 * sw; SPT.dust.rotation.y += dt * 0.012 * sw;
  const oa = t * 0.12; SPT.comet.position.set(Math.cos(oa) * 11, Math.sin(oa) * 2.2, Math.sin(oa) * 11 * 0.55);
  SPT.shell.rotation.y += dt * 0.2 * sw; SPT.shell.rotation.x += dt * 0.07 * sw;
  if (SPT.bip && SPT.st !== 'burn') { SPT.bipT -= dt; if (SPT.bipT <= 0) { SPT.bipT = 2.6; sptBip(0.03); SPT.halo.material.opacity = 0.5; } }
  SPT.halo.material.opacity += ((SPT.st === 'burn' ? 0.6 : SPT.bip ? 0.08 : 0.035) - SPT.halo.material.opacity) * Math.min(1, dt * 2);
  SPT.earth.rotation.y += dt * 0.03;
  SPT.earth.userData.halo.material.opacity = 0.06 + 0.02 * Math.sin(t * 0.4);
  if (SPT.earth.userData.farTarget !== undefined) SPT.earth.position.x += (SPT.earth.userData.farTarget - SPT.earth.position.x) * Math.min(1, dt * 0.8);

  if (SPT.st === 'mend') {
    const placed = SPT.sockets.filter(x => x.piece >= 0).length, full = placed === 6;
    SPT.idle1 += dt; SPT.hintT -= dt; if (SPT.hintT <= 0) SPT.hintK = -1;
    if (SPT.idle1 > 40 && SPT.sel >= 0 && SPT.hintK < 0) { SPT.hintK = SPT.pieces[SPT.sel].target; SPT.hintT = 8; SPT.idle1 = 20; }
    SPT.pieces.forEach(p => {
      const sel = SPT.sel === p.i;
      p.halo.material.opacity += ((sel ? 0.34 + 0.12 * Math.sin(t * 5) : 0) - p.halo.material.opacity) * Math.min(1, dt * 8);
      const k = Math.min(1, dt * 5); p.shake = Math.max(0, p.shake - dt * 2.2);
      if (p.slot >= 0) { p.mesh.position.lerp(SPT.sockets[p.slot].pos, k); p.mesh.scale.setScalar(p.sc * 0.9); p.mesh.rotation.y += dt * 0.25; p.con.visible = false; }
      else {
        const a = p.base + t * 0.06, r = 7.5 + 0.6 * Math.sin(t * 0.5 + p.i);
        _sptV.set(Math.cos(a) * r + Math.sin(t * 48) * 0.22 * p.shake, 1.2 * Math.sin(t * 0.4 + p.i * 1.7), Math.sin(a) * r);
        p.mesh.position.lerp(_sptV, k * 0.6); p.mesh.scale.setScalar(p.sc * (sel ? 1.25 + 0.06 * Math.sin(t * 5) : 1)); p.con.visible = true;
        p.mesh.rotation.x += dt * p.spin * sw; p.mesh.rotation.y += dt * p.spin * 0.7 * sw;
        p.con.rotation.set(-p.mesh.rotation.x, -p.mesh.rotation.y, 0);                  // la constelación se mantiene de frente
        p.con.quaternion.copy(p.mesh.quaternion).invert();
      }
    });
    SPT.sockets.forEach(x => {
      const hint = SPT.hintK === x.k && x.piece < 0, base = x.piece >= 0 ? 0.9 : (SPT.sel >= 0 ? 0.5 + 0.2 * Math.sin(t * 3 + x.k) : 0.5);
      x.ring.material.uniforms.uOpacity.value = hint ? 0.8 + 0.2 * Math.sin(t * 7) : base;
      x.con.material.uniforms.uOpacity.value = x.piece >= 0 ? 0.0 : (hint ? 1 : 0.55 + 0.25 * Math.sin(t * 1.3 + x.k));
    });
    if (full) {
      SPT.holdT += dt;
      if (SPT.holdT > 1.4 && !SPT.bip) { SPT.bip = true; SPT.bipT = 0; sptSub(sptT('s1ok'), 6); MGS.arpeggio([0, 2, 3, 5], 0.2, 3.2, 0.03); SPT.nextCh = SPT.t + 4.5; SPT.st = 'mend_ok'; }
    } else SPT.holdT = 0;
  } else if (SPT.st === 'mend_ok') {
    if (SPT.t > SPT.nextCh) sptGo(2);
  } else if (SPT.st === 'archive') {
    const left = Math.max(0, 1 - T / SPT.diskMax);
    SPT.els.fill.style.width = (left * 100) + '%';
    SPT.shell.material.uniforms.uOpacity.value = 0.06 + 0.54 * left; MT.screen.uniforms.uCalm.value = 0.9 * left; MT.screen.uniforms.uCold.value = 0.5 * (1 - left); SPT.probe.rotation.y += dt * 0.2 * left * sw;
    SPT.fr.forEach(f => { if (!f.sent && !f.dead && T >= f.dieAt) sptKill(f); else if (!f.sent && !f.dead && T > f.dieAt - 4) f.el.style.opacity = String(0.5 + 0.35 * Math.abs(Math.sin(T * 3))); });
    const P = SPT.probe.position, E = SPT.earth.position;
    SPT.msgs.forEach(m => {
      if (m.phase === 'done') return;
      m.t += dt; const u = Math.min(1, m.t / m.d);
      if (m.phase === 'out') { m.ball.position.lerpVectors(P, E, u); if (u >= 1) { m.phase = 'back'; m.t = 0; m.ball.material.color.setHex(0xbfe6ff); MGS.ping(1480, 0, 0.5, 0.02); MG.pulse(0, 0, 0xffd9a8, 1.2, 7, 2, 0.2, 0); } }
      else { m.ball.position.lerpVectors(E, P, u); if (u >= 1) { m.phase = 'done'; SPT.group.remove(m.ball); m.ball.material.dispose(); SPT.arrived++; sptLog(sptT('probe'), m.reply, false); MGS.arpeggio([1, 3], 0.14, 2.2, 0.025); vibrateDevice(18); } }
    });
    const resolved = SPT.fr.every(f => f.sent || f.dead);
    if ((SPT.closing || SPT.sent >= 4 || (resolved && T > 6)) && SPT.arrived >= SPT.sent) {
      SPT.fr.forEach(f => { if (!f.sent && !f.dead) sptKill(f); });
      SPT.st = 'archive_end'; SPT.nextCh = SPT.t + 4; sptSub(sptT('s2end'), 4);
    }
  } else if (SPT.st === 'archive_end') {
    SPT.shell.material.uniforms.uOpacity.value += (0.2 - SPT.shell.material.uniforms.uOpacity.value) * Math.min(1, dt * 1.5);
    if (SPT.t > SPT.nextCh) sptGo(3);
  } else if (SPT.st === 'drift') {
    SPT.spawnT -= dt;
    if (SPT.spawnT <= 0 && T < 30) { sptSpawnItem(); SPT.spawnT = 1.6 + Math.random() * 0.8; }
    SPT.items.forEach(it => {
      const m = it.mesh;
      if (it.state === 'held') {
        const a = it.slot * 2.094 + t * 0.6, r = 3.1;
        _sptV.set(Math.cos(a) * r, Math.sin(t * 0.7 + it.slot) * 0.5, Math.sin(a) * r); m.position.lerp(_sptV, Math.min(1, dt * 4)); m.scale.setScalar(0.85);
        it.halo.material.opacity += (0.5 - it.halo.material.opacity) * Math.min(1, dt * 3);
      } else {
        it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
        if (it.state === 'drift') { m.position.set(it.x, it.y + Math.sin(t * 0.8 + it.ph) * 0.3, it.z); } else { m.position.x += it.vx * dt; m.position.y += it.vy * dt; m.position.z += it.vz * dt; }
        const near = it.state === 'drift' && m.position.length() <= 8;
        it.halo.material.opacity += ((near ? 0.55 + 0.25 * Math.sin(t * 5 + it.ph) : 0.08) - it.halo.material.opacity) * Math.min(1, dt * 4);
      }
      m.rotation.x += dt * it.spin * sw; m.rotation.y += dt * it.spin * 0.6 * sw;
    });
    SPT.items = SPT.items.filter(it => { if (it.state !== 'held' && it.mesh.position.length() > 60) { sptDropItem(it); return false; } return true; });
    if (T >= 36) { SPT.st = 'burn'; SPT.burnT = 0; sptSub(sptT('s3burn'), 5); MGS.arpeggio([5, 3, 2, 0], 0.3, 3.2, 0.04); }
  } else if (SPT.st === 'burn') {
    SPT.burnT += dt; const b = Math.min(1, SPT.burnT / 7);
    SPT.probe.rotation.y += dt * (0.4 + b * 3) * sw;
    MT.screen.uniforms.uCold.value = b; MT.screen.uniforms.uCalm.value = 0; MT.body.uniforms.color.value.setRGB(0.42 + b * 0.5, 0.46 - b * 0.1, 0.52 - b * 0.35);
    SPT.shell.material.uniforms.uTint.value.setRGB(1, 1 - b * 0.45, 1 - b * 0.8);
    SPT.items.forEach(it => { if (it.state !== 'held') it.mesh.visible = false; });
    if (MG.fx && SPT.burnT > 0.5 && SPT.burnT < 7.5) { const k = Math.random(); MG.fx.emit(-0.5 + (Math.random() - 0.5), (Math.random() - 0.5), 0, -4 - Math.random() * 3, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5), 1.6, k < 0.5 ? 0xffb070 : 0xff7a3a, 0.28, 0.9, 0.5); }
    SPT.held.forEach((it, idx) => { if (SPT.burnT > 3.5 + idx * 1.1 && it.mesh.visible) { it.mesh.visible = false; MG.fx.burst(it.mesh.position.x, it.mesh.position.y, it.mesh.position.z, 22, 3, 2.2, SPT_ITEMS[it.kind].hex, 0.3, 0.9); MGS.bell(MGS.NOTES[(idx * 2 + 1) % 6] * 2, 0, 2.4, 0.04); } });
    if (SPT.burnT > 7) { const sc = Math.max(0, 1 - (SPT.burnT - 7) / 1.5); SPT.probe.scale.setScalar(sc); }
    if (SPT.burnT > 7.6 && SPT.st === 'burn') { SPT.st = 'epilogue'; SPT.endT = 0; sptSub(sptEpilogue(), 12); SPT.els.panel.style.display = 'none'; }
  } else if (SPT.st === 'epilogue') {
    SPT.endT += dt;
    if (SPT.endT > 11) { window.endSputnikGame(); return; }
  }
  if (!window.isSputnikActive) return;

  // cámara: giro libre a distancia fija + zoom (mismo manejo que Hoguera y Ballena)
  const CM = HG_CAM;
  if (!CM.ptrs.size) { CM.yawT += CM.yawV * dt; CM.yawV *= Math.exp(-dt * 3.2); }
  const kc = 1 - Math.exp(-dt * 9);
  CM.yaw += (CM.yawT - CM.yaw) * kc; CM.pit += (CM.pitT - CM.pit) * kc; CM.zoom += (CM.zoomT - CM.zoom) * kc;
  const asp = window.innerWidth / window.innerHeight, fit = Math.max(1, 1.5 / asp);
  const D = SPT_ISO.dist * (SPT.st === 'drift' ? 1.25 : 1) * fit * CM.zoom;
  const psi = SPT_ISO.yaw + CM.yaw + Math.sin(t * 0.05) * 0.03 * sw, phi = Math.max(0.05, Math.min(1.2, SPT_ISO.pitch + CM.pit));
  const Tg = SPT_ISO.target;
  userGroup.position.set(Tg.x + D * Math.sin(psi) * Math.cos(phi), Tg.y + D * Math.sin(phi), Tg.z + D * Math.cos(psi) * Math.cos(phi));
  userGroup.rotation.set(-phi, psi, 0);
  // HUD (reutiliza las cuatro etiquetas del juego de la ballena)
  MG.setHUD({ 'lives-value': String(SPT.ch || 0), 'level-value': String(SPT.kept.length), 'files-value': String(SPT.held.length), 'combo-value': String(SPT.bip ? 1 : 0) });
}

window.sptStart = sptStart;

// ==========================================
// 🐢 JUEGO OTRO: LA TORTUGA-PLANETA (sección WebAR · anclar lo digital en el mundo y esperar)
//   Un coloso lento que da un paso cada treinta segundos y lleva un jardín en el caparazón. Se siembra con un toque, se da un sorbo de agua
//   y el resto es esperar: lo que crece, crece con tiempo real (también mientras no se mira). El mismo jardín vive en la página y,
//   en AR, sobre la mesa: la tortuga es una sola. Demasiada agua también detiene. No se pierde nada, solo se espera.
// ==========================================
window.isTortugaActive = false;
const TRT_ISO = { yaw: 0.6, pitch: 0.34, dist: 27, fov: 42, target: new THREE.Vector3(0, 1.2, 0) };
const TRT_KEY = 'dac_tortuga_v1';
const TRT_ST = { sprout: 14, stem: 38, bud: 66, bloom: 96 };                       // segundos de crecimiento de cada etapa
const TRT_R = 7, TRT_H = 4.6, TRT_STEP = 30;                                        // radio y altura del caparazón; segundos por paso
const TRT_HEX = [0xf2c799, 0xea9f95, 0xd1b3e0, 0xbfe6ff, 0xf0e08a, 0xb8d9ad, 0xe7e4de];
const TRT_PLOTS = (() => { const a = [[0, 0]]; for (let k = 0; k < 6; k++) { const q = k * Math.PI / 3 + 0.3; a.push([Math.cos(q) * 0.52 * TRT_R, Math.sin(q) * 0.52 * TRT_R]); } return a; })();
const TRT_TXT = {
  es: {
    title: 'LA TORTUGA-PLANETA', toast: 'Un coloso lento lleva un jardín a cuestas.',
    h: 'Toca un lugar del caparazón para sembrar. Toca un brote para darle un sorbo de agua: uno basta. Lo demás es esperar. Arrastra el espacio vacío para girar; pellizca para acercar.',
    s0: '…camina una vez cada treinta segundos…', plant: '…una semilla. Ahora, esperar…', water: '…un sorbo. Crece despacio…', flood: '…demasiada agua también detiene. Espera…',
    sprout: '…brotó…', bloom: '…floreció…', away: '…creció mientras no mirabas…', step: '…un paso…', done: '…ya florece. Lleva un bosque a cuestas y sigue caminando.', seed: '…aún es semilla…',
    ar0: 'Toca con el dedo o el controlador un lugar del caparazón', ar1: 'Es la misma tortuga que en la página',
    lbl: 'TORTUGA', lblOn: 'MODELOS'
  },
  en: {
    title: 'THE TURTLE-PLANET', toast: 'A slow colossus carries a garden on its back.',
    h: 'Tap a place on the shell to sow. Tap a sprout to give it a sip of water: one is enough. The rest is waiting. Drag empty space to turn; pinch to zoom.',
    s0: '…it walks once every thirty seconds…', plant: '…a seed. Now, wait…', water: '…a sip. It grows slowly…', flood: '…too much water also stops it. Wait…',
    sprout: '…it sprouted…', bloom: '…it bloomed…', away: '…it grew while you were not looking…', step: '…a step…', done: '…it blooms now. It carries a forest and keeps walking.', seed: '…still a seed…',
    ar0: 'Touch a place on the shell with your finger or controller', ar1: 'It is the same turtle as on the page',
    lbl: 'TURTLE', lblOn: 'MODELS'
  }
};
function trtT(k) { return TRT_TXT[(window.currentLang === 'en') ? 'en' : 'es'][k]; }

// ---------- Modelo compartido (página y AR): crecimiento, riego y guardado ----------
const TRT = { plots: TRT_PLOTS.map(() => ({ seed: false, t: 0, water: 0, flood: 0, stage: 0 })), steps: 0, stepT: 0, saveT: 0, loaded: false, away: false };
function trtStageOf(t, seed) { return !seed ? -1 : t >= TRT_ST.bloom ? 3 : t >= TRT_ST.bud ? 2 : t >= TRT_ST.sprout ? 1 : 0; }
function trtInit() {                                                              // al abrir (página o AR): carga lo guardado y deja crecer lo que pasó mientras no se miraba
  const now = Date.now(); TRT.away = false;
  if (!TRT.loaded) {
    TRT.loaded = true;
    try {
      const j = JSON.parse(localStorage.getItem(TRT_KEY) || 'null');
      if (j && Array.isArray(j.plots)) { j.plots.slice(0, TRT.plots.length).forEach((s, i) => { const p = TRT.plots[i]; p.seed = !!s.s; p.t = Math.min(TRT_ST.bloom, +s.t || 0); p.stage = trtStageOf(p.t, p.seed); }); TRT.steps = j.steps | 0; TRT.lastT = +j.at || now; }
    } catch (e) {}
  }
  if (TRT.lastT) {
    const off = Math.max(0, Math.min(1800, (now - TRT.lastT) / 1000)) * 0.25;                                // mientras no se mira, crece, pero más despacio
    if (off > 0) TRT.plots.forEach(p => { if (p.seed && p.t < TRT_ST.bloom) { const t0 = p.t; p.t = Math.min(TRT_ST.bloom, p.t + off); p.stage = trtStageOf(p.t, true); if (p.t - t0 > 5) TRT.away = true; } });
  }
  TRT.lastT = now;
}
function trtSave() { try { localStorage.setItem(TRT_KEY, JSON.stringify({ plots: TRT.plots.map(p => ({ s: p.seed ? 1 : 0, t: Math.round(p.t * 10) / 10 })), steps: TRT.steps, at: Date.now() })); } catch (e) {} }
function trtCounts() { let seeds = 0, sprouts = 0, blooms = 0; TRT.plots.forEach(p => { if (p.seed) { seeds++; if (p.t >= TRT_ST.sprout) sprouts++; if (p.t >= TRT_ST.bloom) blooms++; } }); return { seeds, sprouts, blooms }; }
function trtGrow(dt) {                                                            // devuelve la lista de eventos de este cuadro
  const ev = []; TRT.lastT = Date.now();
  TRT.plots.forEach((p, k) => {
    if (!p.seed) return;
    p.flood = Math.max(0, p.flood - dt); p.water = Math.max(0, p.water - dt * 0.02);
    if (p.t < TRT_ST.bloom) p.t = Math.min(TRT_ST.bloom, p.t + dt * (p.flood > 0 ? 0 : 1 + 1.5 * p.water));
    const s = trtStageOf(p.t, true); if (s > p.stage) { p.stage = s; ev.push({ k, stage: s }); }
  });
  TRT.stepT += dt; if (TRT.stepT >= TRT_STEP) { TRT.stepT -= TRT_STEP; TRT.steps++; ev.push({ step: true }); }
  TRT.saveT += dt; if (TRT.saveT > 5) { TRT.saveT = 0; trtSave(); }
  return ev;
}
function trtTend(k) {                                                             // un toque: sembrar, regar con medida o, si ya floreció, solo saludar
  const p = TRT.plots[k]; if (!p) return null;
  if (!p.seed) { p.seed = true; p.t = 0; p.water = 0.3; p.flood = 0; p.stage = 0; trtSave(); return 'plant'; }
  if (p.t >= TRT_ST.bloom) return 'bloomed';
  if (p.water > 0.65) { p.flood = 6; p.water = 0.3; return 'flood'; }             // demasiada agua: se detiene unos segundos, no se pierde nada
  p.water = Math.min(1, p.water + 0.5); return 'water';
}

// ---------- Construcción de la tortuga (la misma para la página y para la mesa) ----------
//   mk(n, fn) fabrica nubes de puntos: sptPoints en la página, arPoints (tamaños en metros) en AR. sk = factor de tamaño de punto.
function trtBlob(mk, n, cx, cy, cz, rx, ry, rz, c, s, a) {
  return mk(n, (i, o) => { const u = Math.random() * 2 - 1, q = Math.random() * 6.2832, w = Math.sqrt(1 - u * u), r = 0.55 + 0.45 * Math.random();
    o.x = cx + Math.cos(q) * w * rx * r; o.y = cy + u * ry * r; o.z = cz + Math.sin(q) * w * rz * r; o.s = s; o.a = a; o.r = c[0]; o.g = c[1]; o.b = c[2]; });
}
function trtBuild(mk, sk) {
  const R = TRT_R, H = TRT_H, GA = 2.399963, root = new THREE.Group(), B = { root, sk, plants: [], legs: [], plotPos: [], pulse: [] };
  // caparazón orgánico: escudos hexagonales en relieve (como placas de verdad), surcos entre ellos, anillos de crecimiento, nódulos y púas en el borde
  const SC = [[0, 0]]; for (let k = 0; k < 6; k++) { const q = k * Math.PI / 3 + 0.3; SC.push([Math.cos(q) * 0.52 * R, Math.sin(q) * 0.52 * R]); } for (let k = 0; k < 12; k++) { const q = k * Math.PI / 6 + 0.3; SC.push([Math.cos(q) * 0.96 * R, Math.sin(q) * 0.96 * R]); }
  const NOD = []; for (let k = 0; k < 6; k++) { const q = k * Math.PI / 3 + 0.3 + Math.PI / 6; NOD.push([Math.cos(q) * 0.3 * R, Math.sin(q) * 0.3 * R, 0.55]); NOD.push([Math.cos(q) * 0.74 * R, Math.sin(q) * 0.74 * R, 0.7]); }
  const vor = (x, z) => { let d1 = 1e9, d2 = 1e9; for (let i = 0; i < SC.length; i++) { const d = Math.hypot(x - SC[i][0], z - SC[i][1]); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; } return [d1, d2]; };
  const sstep = (a0, b0, x) => { const u = Math.max(0, Math.min(1, (x - a0) / (b0 - a0))); return u * u * (3 - 2 * u); };
  const bump = (x, z) => { const [d1, d2] = vor(x, z), ed = d2 - d1; let b = 0.95 * sstep(0.1, 1.7, ed) + 0.3 * (1 - Math.min(1, d1 / (R * 0.3))); NOD.forEach(n => { const dd = (x - n[0]) * (x - n[0]) + (z - n[1]) * (z - n[1]); if (dd < 2) b += n[2] * 1.7 * Math.exp(-dd / 0.2); }); return b * (1 - sstep(0.85 * R, R, Math.hypot(x, z)) * 0.5); };
  const surf = (x, z) => H * Math.sqrt(Math.max(0, 1 - (x * x + z * z) / (R * R))) + bump(x, z);
  const body = [0.5, 0.58, 0.56];
  B.shell = mk(3200, (i, o) => { const y = (i + 0.5) / 3200, rr = Math.sqrt(1 - y * y), a = i * GA, x = Math.cos(a) * rr * R, z = Math.sin(a) * rr * R, [d1, d2] = vor(x, z), ed = d2 - d1;
    o.x = x; o.z = z; o.y = surf(x, z);
    const groove = ed < 0.32, ring = !groove && Math.abs(Math.sin(d1 * 5.2)) < 0.14, nod = NOD.some(n => (x - n[0]) * (x - n[0]) + (z - n[1]) * (z - n[1]) < 0.3);
    o.s = (groove ? 0.07 : nod ? 0.16 : ring ? 0.11 : 0.09) * sk; o.a = groove ? 0.28 : nod ? 0.95 : ring ? 0.8 : 0.5;
    const m = 0.85 + 0.3 * Math.random(); o.r = (groove ? 0.2 : nod ? 0.9 : ring ? 0.72 : 0.4) * m; o.g = (groove ? 0.3 : nod ? 0.82 : ring ? 0.85 : 0.55) * m; o.b = (groove ? 0.28 : nod ? 0.6 : ring ? 0.64 : 0.42) * m; });
  root.add(mk(1800, (i, o) => { let x, z, ed, g = 0; do { const a = Math.random() * 6.2832, r = Math.sqrt(Math.random()) * R * 0.99; x = Math.cos(a) * r; z = Math.sin(a) * r; const v = vor(x, z); ed = v[1] - v[0]; } while (ed > 0.3 && g++ < 80);
    o.x = x; o.z = z; o.y = surf(x, z) + 0.05; o.s = 0.13 * sk; o.a = 0.95; o.r = 0.86; o.g = 0.92; o.b = 0.72; }));     // aristas de los escudos: la placa se lee como placa
  root.add(mk(180, (i, o) => { const k = i % 12, q = k * Math.PI / 6 + 0.3 + Math.PI / 12, u = Math.floor(i / 12) / 14, rr2 = R * (0.97 + 0.04 * u), hh = (1 - u); o.x = Math.cos(q) * (rr2 + 0.4 * hh) * (1 - u * 0.12); o.z = Math.sin(q) * (rr2 + 0.4 * hh) * (1 - u * 0.12); o.y = 0.2 + u * 2.4; o.s = 0.12 * sk; o.a = 0.9; o.r = 0.92; o.g = 0.84; o.b = 0.6; }));   // púas del borde
  root.add(B.shell);
  root.add(mk(90, (i, o) => { const a = i / 90 * 6.2832; o.x = Math.cos(a) * R * 1.01; o.z = Math.sin(a) * R * 1.01; o.y = 0.1; o.s = 0.1 * sk; o.a = 0.7; o.r = 0.6; o.g = 0.75; o.b = 0.7; }));
  B.head = new THREE.Group(); B.head.position.set(R - 0.6, 1.5, 0); root.add(B.head);                                  // cabeza y cuello
  B.head.add(trtBlob(mk, 150, 3.5, 0.35, 0, 1.6, 1.1, 1.0, body, 0.11 * sk, 0.6));
  B.head.add(trtBlob(mk, 70, 1.0, 0.1, 0, 1.6, 0.7, 0.7, body, 0.1 * sk, 0.5));
  [-0.55, 0.55].forEach(z => B.head.add(mk(1, (i, o) => { o.x = 4.5; o.y = 0.7; o.z = z; o.s = 0.2 * sk; o.a = 1; o.r = 1; o.g = 0.95; o.b = 0.8; })));
  B.eyeHalo = mkHalo(0xffe9c0, 1.0, 0.0); B.eyeHalo.position.set(4.5, 0.7, 0); B.head.add(B.eyeHalo);
  [[3.5, 5.6], [3.5, -5.6], [-3.5, 5.6], [-3.5, -5.6]].forEach(([x, z], i) => {                                       // patas que cuelgan y se balancean
    const lg = new THREE.Group(); lg.position.set(x, 0.6, z); lg.add(trtBlob(mk, 110, 0, -1.4, 0, 1.0, 1.7, 1.0, body, 0.1 * sk, 0.55)); root.add(lg); B.legs.push(lg);
  });
  root.add(trtBlob(mk, 50, -R - 1.4, 0.6, 0, 1.3, 0.5, 0.5, body, 0.09 * sk, 0.5));                                   // cola
  TRT_PLOTS.forEach(([x, z], k) => {                                                                                  // el jardín
    const y = surf(x, z) + 0.05, ph = k * 1.7, hex = TRT_HEX[k % TRT_HEX.length], [fr, fg, fb] = arRGB(hex);
    const pts = mk(64, (i, o) => { o.x = x; o.y = y; o.z = z; o.a = 0; o.s = 0.14 * sk;
      if (i < 16) { o.r = 0.55; o.g = 0.85; o.b = 0.6; } else if (i < 40) { o.r = 0.5; o.g = 0.8; o.b = 0.55; } else { o.r = fr; o.g = fg; o.b = fb; } });
    root.add(pts); const halo = mkHalo(hex, 2.6, 0); root.add(halo);
    B.plants.push({ pts, halo, x, y, z, ph, hex, pulse: 0 }); B.plotPos.push(new THREE.Vector3(x, y + 0.8, z));
  });
  B.motes = mk(110, (i, o) => { const a = Math.random() * 6.2832, r = 2 + Math.random() * 9; o.x = Math.cos(a) * r; o.z = Math.sin(a) * r; o.y = 1 + Math.random() * 8; o.s = (0.06 + Math.random() * 0.08) * sk; o.a = 0; o.r = 1; o.g = 0.92; o.b = 0.7; });
  B.motes.userData.ph = Array.from({ length: 110 }, () => Math.random() * 6.28); root.add(B.motes);
  B.walk = 0; B.lift = 0; B.finale = 0;
  return B;
}
const trtSm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
function trtPlantFill(B, k, T, dt, calm) {
  const P = B.plants[k], M = TRT.plots[k], A = P.pts.geometry.attributes, pa = A.position.array, al = A.aAlpha.array, sz = A.aSize.array, co = A.aCol.array, sk = B.sk;
  const t = M.t, sw = calm ? 0 : 1, dr = M.flood > 0 ? 1 : 0, ST = TRT_ST;
  P.pulse = Math.max(0, P.pulse - dt * 1.4);
  al.fill(0);
  if (!M.seed) { pa[0] = P.x; pa[1] = P.y + 0.12; pa[2] = P.z; al[0] = 0.3 + 0.15 * Math.sin(T * 1.5 + k); sz[0] = 0.15 * sk; co[0] = 0.8; co[1] = 0.9; co[2] = 0.95; }
  else {
    const stemH = 0.3 + 2.9 * trtSm(ST.sprout, ST.bud, t), sprouted = t >= ST.sprout;
    const swayX = (u) => Math.sin(T * 0.9 + u * 2.5 + P.ph) * 0.18 * u * sw * (1 + dr) + dr * u * u * 0.9;
    if (!sprouted) { pa[0] = P.x; pa[1] = P.y + 0.12; pa[2] = P.z; al[0] = 0.75 + 0.2 * Math.sin(T * 2 + P.ph); sz[0] = (0.2 + P.pulse * 0.2) * sk; co[0] = 0.95; co[1] = 0.85; co[2] = 0.65; }
    else {
      for (let i = 0; i < 16; i++) { const u = i / 15; pa[i * 3] = P.x + swayX(u); pa[i * 3 + 1] = P.y + u * stemH; pa[i * 3 + 2] = P.z; al[i] = 0.85 * (dr ? 0.5 : 1); sz[i] = (0.11 + P.pulse * 0.08) * sk; if (i === 0) { co[0] = 0.55; co[1] = 0.85; co[2] = 0.6; } }
      const leaf = trtSm(ST.sprout + 4, ST.stem, t);
      for (let j = 0; j < 12; j++) for (let sd = 0; sd < 2; sd++) {
        const idx = 16 + j * 2 + sd, u = 0.25 + 0.6 * j / 11, ang = P.ph + j * 2.4 + sd * Math.PI, len = leaf * (0.45 + 0.55 * Math.sin(j / 11 * Math.PI)) * 1.0;
        pa[idx * 3] = P.x + swayX(u) + Math.cos(ang) * len; pa[idx * 3 + 1] = P.y + u * stemH + len * 0.25 - dr * len * 0.6; pa[idx * 3 + 2] = P.z + Math.sin(ang) * len;
        al[idx] = leaf > 0.02 ? 0.7 * (dr ? 0.5 : 1) : 0; sz[idx] = 0.1 * sk;
      }
      if (t >= ST.stem) {
        const bl = trtSm(ST.bud, ST.bloom, t), rr = 0.15 + 1.15 * bl, topx = P.x + swayX(1), topy = P.y + stemH + 0.1;
        for (let n = 0; n < 24; n++) {
          const idx = 40 + n, inner = n >= 16, q = (inner ? (n - 16) / 8 : n / 16) * 6.2832 + T * 0.1 * sw + (inner ? 0.4 : 0), r = inner ? rr * 0.38 : rr;
          pa[idx * 3] = topx + Math.cos(q) * r; pa[idx * 3 + 1] = topy + (inner ? 0.18 : 0.08 + 0.18 * bl * Math.sin(q * 2 + T * 0.6 * sw)); pa[idx * 3 + 2] = topz(P, q, r);
          al[idx] = (0.45 + 0.5 * bl) * (dr ? 0.5 : 1); sz[idx] = (0.12 + 0.2 * bl + P.pulse * 0.12) * sk;
          if (inner) { co[idx * 3] = 1; co[idx * 3 + 1] = 0.93; co[idx * 3 + 2] = 0.72; }
        }
        P.halo.position.set(topx, topy, P.z);
        P.halo.material.opacity += (((bl > 0.9 ? 0.3 : 0.06) + P.pulse * 0.4) - P.halo.material.opacity) * Math.min(1, dt * 3);
      } else P.halo.material.opacity *= 0.9;
    }
  }
  A.position.needsUpdate = A.aAlpha.needsUpdate = A.aSize.needsUpdate = A.aCol.needsUpdate = true;
}
function topz(P, q, r) { return P.z + Math.sin(q) * r * 0.8; }
function trtAnimate(B, T, dt, calm) {                                             // todo lo que se mueve de la tortuga: patas, cabeza, jardín y luciérnagas
  const sw = calm ? 0 : 1, ph = T * 6.2832 / TRT_STEP;
  B.legs.forEach((lg, i) => { lg.rotation.z = Math.sin(ph + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.3 * sw; });
  B.root.position.y = (B.baseY || 0) + Math.sin(ph * 2) * 0.05 * sw * B.sk;
  B.lift += ((B.finale ? 0.35 : 0) - B.lift) * Math.min(1, dt * 0.8);
  B.head.rotation.z = Math.sin(T * 0.35) * 0.05 * sw + B.lift; B.head.position.y = 1.5 + Math.sin(T * 0.5) * 0.06 * sw;
  B.eyeHalo.material.opacity = 0.12 + 0.05 * Math.sin(T * 0.7);
  for (let k = 0; k < B.plants.length; k++) trtPlantFill(B, k, T, dt, calm);
  const MA = B.motes.geometry.attributes, ph2 = B.motes.userData.ph, want = B.finale ? 0.8 : trtCounts().blooms > 0 ? 0.25 : 0;
  for (let i = 0; i < ph2.length; i++) {
    MA.position.array[i * 3 + 1] += dt * 0.12 * sw; if (MA.position.array[i * 3 + 1] > 10) MA.position.array[i * 3 + 1] = 1;
    MA.aAlpha.array[i] += (want * (0.5 + 0.5 * Math.sin(T * 1.1 + ph2[i])) - MA.aAlpha.array[i]) * Math.min(1, dt * 1.5);
  }
  MA.position.needsUpdate = MA.aAlpha.needsUpdate = true;
}
function trtFeedback(k, res, B, onSub) {                                          // sonido, vibración y pulso visual de un toque
  if (!res) return;
  const P = B.plants[k]; P.pulse = 1;
  if (res === 'plant') { MGS.bell(MGS.NOTES[k % 6], 0, 2.4, 0.03); vibrateDevice(14); onSub && onSub('plant'); }
  else if (res === 'water') { MGS.ping(MGS.NOTES[3] * 2, 0, 0.9, 0.025); MGS.ping(MGS.NOTES[5] * 2, 0.12, 0.8, 0.018); vibrateDevice(10); onSub && onSub('water'); }
  else if (res === 'flood') { MGS.ping(MGS.NOTES[0] / 2, 0, 1.2, 0.02); onSub && onSub('flood'); }
  else if (res === 'bloomed') { MGS.arpeggio([k % 6, (k + 2) % 6], 0.1, 2, 0.02); }
}
function trtEvents(ev, B, onSub) {
  ev.forEach(e => {
    if (e.step) { MGS.ping(62, 0, 2.4, 0.05); MGS.bell(MGS.NOTES[0] / 4, 0.1, 2.6, 0.02); onSub && onSub('step'); }
    else if (e.stage === 1) { MGS.arpeggio([2, 4], 0.1, 1.8, 0.025); B.plants[e.k].pulse = 1; onSub && onSub('sprout'); }
    else if (e.stage === 3) { MGS.arpeggio([0, 2, 3, 5], 0.16, 3, 0.03); B.plants[e.k].pulse = 1; onSub && onSub('bloom'); }
  });
}

// ---------- Escena y juego en la página ----------
const TRP = { data: null, st: 'idle', t: 0, B: null, group: null, stars: null, dust: null, ground: null, sun: null, els: {}, subT: 0, finT: 0, done: false };
const _trV = new THREE.Vector3();
function trpSub(text, secs) { const el = TRP.els.sub; if (!el) return; el.textContent = text; el.style.opacity = '1'; TRP.subT = secs || 6; }
function trpOnSub(kind) { trpSub(trtT(kind), kind === 'step' ? 3 : 5); }
function trpBuildScene() {
  const g = new THREE.Group();
  TRP.stars = sptPoints(560, (i, o) => { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = 80 + Math.random() * 40, s = Math.sqrt(1 - u * u), k = Math.random();
    o.x = r * s * Math.cos(a); o.y = r * u; o.z = r * s * Math.sin(a); o.s = 0.07 + Math.pow(Math.random(), 4) * 0.35; o.a = 0.3 + Math.random() * 0.6;
    if (k < 0.2) { o.r = 0.7; o.g = 0.82; o.b = 1; } else if (k < 0.3) { o.r = 1; o.g = 0.82; o.b = 0.65; } }); g.add(TRP.stars);
  TRP.stars.material.uniforms.uOpacity.value = 0.75;
  TRP.dust = sptPoints(700, (i, o) => { const t = Math.pow(Math.random(), 0.7), r = 26 + t * 60, a = Math.random() * 6.283; o.x = Math.cos(a) * r; o.z = Math.sin(a) * r - 10; o.y = (Math.random() - 0.5) * 18 - 6; o.s = 0.14 + Math.random() * 0.4; o.a = 0.05 + Math.random() * 0.12;
    const k = i % 3; if (k === 0) { o.r = 0.45; o.g = 0.7; o.b = 0.85; } else if (k === 1) { o.r = 0.7; o.g = 0.55; o.b = 0.85; } else { o.r = 0.5; o.g = 0.85; o.b = 0.75; } }); g.add(TRP.dust);
  TRP.ground = sptPoints(420, (i, o) => { o.x = (Math.random() - 0.5) * 100; o.z = (Math.random() - 0.5) * 70; o.y = -2.7; o.s = 0.08 + Math.random() * 0.12; o.a = 0.12 + Math.random() * 0.2; o.r = 0.55; o.g = 0.7; o.b = 0.8; }); g.add(TRP.ground);   // el suelo que pasa despacio
  TRP.sun = mkHalo(0xf2c799, 46, 0.1); TRP.sun.position.set(-70, 22, -60); g.add(TRP.sun);
  TRP.B = trtBuild(sptPoints, 1); TRP.B.baseY = 0; g.add(TRP.B.root);
  scene.add(g); TRP.group = g;
}
function trpBuildUI() {
  const ui = MG.buildUI(trtT('h'));
  const title = document.createElement('div'); title.style.cssText = 'font-size:0.66rem; font-weight:300; letter-spacing:0.34em; color:#a8a49c;'; title.textContent = trtT('title');
  ui.extra.appendChild(title);
  const sub = document.createElement('div');
  sub.style.cssText = 'position:absolute; left:50%; top:calc(150px + env(safe-area-inset-top,0px)); transform:translateX(-50%); width:min(90vw,640px); text-align:center; font-size:0.95rem; font-weight:300; letter-spacing:0.12em; line-height:1.8; color:#cfd8e3; opacity:0; transition:opacity 1.4s ease; text-shadow:0 0 14px rgba(0,0,0,0.9); pointer-events:none;';
  ui.root.appendChild(sub);
  TRP.els = { title, sub, hint: ui.hint };
}
function trpStart() {
  if (window.isTortugaActive || window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive || window.isWhaleActive || window.isSputnikActive) return;
  window.isTortugaActive = true;
  MG.enter(24);
  camera.fov = TRT_ISO.fov; targetFov = TRT_ISO.fov; camera.updateProjectionMatrix();
  userGroup.rotation.order = 'YXZ';
  Object.assign(TRP, { st: 'tend', t: 0, subT: 0, finT: 0, done: false });
  const tg = window.travelerGroup;
  TRP.tsave = tg ? { pos: tg.position.clone(), quat: tg.quaternion.clone(), scale: tg.scale.clone() } : null;
  if (tg) { tg.visible = true; window.hgPose = { pos: new THREE.Vector3(9, -2.7 + ((typeof TRAVELER_FEET !== 'undefined') ? TRAVELER_FEET : 0.6), -0.3), yaw: Math.atan2(-9, 0.3) }; }   // el Viajero, al pie del coloso
  trtInit();
  trpBuildScene(); trpBuildUI();
  hgCamReset(); hgCamBind();
  morphHUD('tortuga');
  showSystemToast(trtT('toast'), '#e7e4de');
  trpSub(TRT.away ? trtT('away') : trtT('s0'), 7);
}
window.startTortugaGame = function(data, view) {
  TRP.data = data || null;
  if (MG.pending || window.isTortugaActive || window.isSputnikActive || window.isWhaleActive || window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive) return;
  if (view) { TRP.view = true; trpStart(); TRP.vT = 6; colViewBar(() => colVoice('tortuga', 1)); return; }
  MG.pending = true;
  MG.reflect(MG.text('tortuga', 'intro'), () => { MG.pending = false; trpStart(); },
    { cancelable: true, onCancel: () => { MG.pending = false; if (data && typeof openProjectPopup === 'function') openProjectPopup(data); } });
};
function trpTeardown() {
  trtSave();
  window.isTortugaActive = false; TRP.st = 'idle'; TRP.view = false;
  const tg = window.travelerGroup; if (tg && TRP.tsave) { tg.position.copy(TRP.tsave.pos); tg.quaternion.copy(TRP.tsave.quat); tg.scale.copy(TRP.tsave.scale); }
  TRP.tsave = null; window.hgPose = null;
  hgCamUnbind();
  if (TRP.group) { mgDispose(TRP.group); TRP.group = null; }
  TRP.B = TRP.stars = TRP.dust = TRP.ground = TRP.sun = null; TRP.els = {};
}
window.endTortugaGame = function() { if (!window.isTortugaActive) return; const w = TRP.done, d = TRP.data, v = TRP.view; trpTeardown(); MG.exit(); if (!v) setTimeout(() => { MG.reflect(MG.text('tortuga', 'outro'), () => colAfter(d, w)); }, 700); };
window.abortTortugaGame = window.endTortugaGame;
window.trtTap = function(cx, cy) {                                                // toque: el lugar del caparazón más cercano al dedo
  if (!window.isTortugaActive || window.isMiniIntro || !TRP.B || TRP.view) return;
  camera.updateMatrixWorld(true); TRP.B.root.updateMatrixWorld(true);
  let best = -1, bd = Math.max(46, window.innerHeight * 0.075);
  TRP.B.plotPos.forEach((p, k) => {
    _trV.copy(p); TRP.B.root.localToWorld(_trV); _trV.project(camera);
    if (_trV.z > 1) return;
    const sx = (_trV.x * 0.5 + 0.5) * window.innerWidth, sy = (-_trV.y * 0.5 + 0.5) * window.innerHeight, d = Math.hypot(sx - cx, sy - cy);
    if (d < bd) { bd = d; best = k; }
  });
  if (best < 0) return;
  const res = trtTend(best); trtFeedback(best, res, TRP.B, (kind) => trpSub(trtT(kind), 5));
  if (res === 'bloomed') trpSub(trtT('bloom'), 3);
};
function trpUpdate(dt) {
  const calm = reduceMotionMQ.matches, t = MG.time, sw = calm ? 0 : 1;
  TRP.t += dt; TRP.subT -= dt;
  if (TRP.els.sub && TRP.subT <= 0) TRP.els.sub.style.opacity = '0';
  const ev = trtGrow(dt); trtEvents(ev, TRP.B, trpOnSub);
  const C = trtCounts();
  if (ev.some(e => e.step) && !calm) { shakeIntensity = Math.max(shakeIntensity, 0.06); if (MG.fx) MG.fx.burst(TRP.B.root.position.x + 3.5, -2.5, 5.6, 6, 1.4, 1.6, 0x9aa3ad, 0.2, 0.9); }
  if (!TRP.done && C.blooms >= 4) { TRP.done = true; TRP.B.finale = 1; TRP.st = 'finale'; TRP.finT = 0; colossusFound('tortuga'); colVoice('tortuga', 1); trpSub(trtT('done'), 12); MGS.arpeggio([0, 2, 3, 5, 4], 0.2, 3.4, 0.03); }
  if (TRP.view) { TRP.vT -= dt; if (TRP.vT <= 0) { TRP.vT = 12 + Math.random() * 5; colVoice('tortuga', 0.7); } }
  else if (TRP.st === 'finale') { TRP.finT += dt; if (TRP.finT > 15) { window.endTortugaGame(); return; } }
  trtAnimate(TRP.B, t, dt, calm);
  // el mundo pasa despacio bajo la tortuga
  const GA = TRP.ground.geometry.attributes.position.array, sp = 0.35 * sw;
  for (let i = 0; i < GA.length; i += 3) { GA[i] -= dt * sp; if (GA[i] < -50) GA[i] += 100; }
  TRP.ground.geometry.attributes.position.needsUpdate = true;
  TRP.stars.rotation.y += dt * 0.004 * sw; TRP.dust.rotation.y += dt * 0.01 * sw;
  TRP.sun.material.opacity = 0.09 + 0.02 * Math.sin(t * 0.3);
  // cámara: giro libre a distancia fija + zoom (igual que Hoguera, Ballena y Sputnik)
  const CM = HG_CAM;
  if (!CM.ptrs.size) { CM.yawT += CM.yawV * dt; CM.yawV *= Math.exp(-dt * 3.2); }
  const kc = 1 - Math.exp(-dt * 9);
  CM.yaw += (CM.yawT - CM.yaw) * kc; CM.pit += (CM.pitT - CM.pit) * kc; CM.zoom += (CM.zoomT - CM.zoom) * kc;
  const asp = window.innerWidth / window.innerHeight, fit = Math.max(1, 1.5 / asp), D = TRT_ISO.dist * fit * CM.zoom;
  const psi = TRT_ISO.yaw + CM.yaw + Math.sin(t * 0.05) * 0.03 * sw, phi = Math.max(0.05, Math.min(1.2, TRT_ISO.pitch + CM.pit)), Tg = TRT_ISO.target;
  userGroup.position.set(Tg.x + D * Math.sin(psi) * Math.cos(phi), Tg.y + D * Math.sin(phi), Tg.z + D * Math.cos(psi) * Math.cos(phi));
  userGroup.rotation.set(-phi, psi, 0);
  MG.setHUD({ 'lives-value': String(TRT.steps), 'level-value': String(C.sprouts), 'files-value': String(C.blooms), 'combo-value': String(C.seeds) });
}

// ---------- Modo AR: la misma tortuga sobre la mesa ----------
const ART = { active: false, group: null, B: null, t: 0, last: 0, hint: null, hintT: 0, ctrlPrev: [false, false] };
const ART_K = 0.032;                                                              // 7 unidades de caparazón → ~22 cm
function artHint(text, secs) {
  if (ART.hint) { camera.remove(ART.hint); if (ART.hint.material.map) ART.hint.material.map.dispose(); ART.hint.material.dispose(); }
  const sp = arTextSprite('', text, 0.5, 0.17); sp.position.set(0, -0.14, -0.55); camera.add(sp); ART.hint = sp; ART.hintT = secs || 6;
}
function arTurtleSetLabel(on) {
  const txt = on ? trtT('lblOn') : trtT('lbl');
  if (window.arTBtn) window.arTBtn.textContent = txt;
  if (window.arTurtle3D) { if (window.arTurtle3D.material.map) window.arTurtle3D.material.map.dispose(); window.arTurtle3D.material.map = arBtnTexture(txt); window.arTurtle3D.material.needsUpdate = true; }
}
function arTurtleStart() {
  if (ART.active || !window.isARSession || !renderer.xr.isPresenting) return;
  if (window.arQuipu && window.arQuipu.active && window.arQuipuStop) window.arQuipuStop();
  trtInit();
  camera.updateMatrixWorld(true);
  const cp = new THREE.Vector3(); camera.getWorldPosition(cp);
  const fw = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld); fw.y = 0;
  if (fw.lengthSq() < 1e-4) fw.set(0, 0, -1); fw.normalize();
  const dist = 0.85, rx = -fw.z, rz = fw.x;                                         // la tortuga camina hacia la derecha de quien mira
  const grp = new THREE.Group(); grp.position.set(cp.x + fw.x * dist, cp.y - 0.72, cp.z + fw.z * dist); grp.rotation.y = Math.atan2(-rz, rx); scene.add(grp);
  const mk = (n, fn) => arPoints(n, (i, o) => { fn(i, o); });                       // los tamaños ya vienen multiplicados por sk
  const B = trtBuild(mk, ART_K); B.root.scale.setScalar(ART_K); grp.add(B.root);
  Object.assign(ART, { active: true, group: grp, B, t: 0, last: performance.now(), ctrlPrev: [false, false] });
  arTurtleSetLabel(true);
  artHint(TRT.away ? trtT('away') : trtT('ar0'), 7);
  MGS.arpeggio([2, 0], 0.3, 3, 0.04);
}
function arTurtleStop() {
  if (!ART.active) return;
  ART.active = false; trtSave();
  if (ART.group) { scene.remove(ART.group); mgDispose(ART.group); ART.group = null; }
  if (ART.hint) { camera.remove(ART.hint); if (ART.hint.material.map) ART.hint.material.map.dispose(); ART.hint.material.dispose(); ART.hint = null; }
  ART.B = null; arTurtleSetLabel(false);
}
function arTurtleToggle() { if (ART.active) arTurtleStop(); else arTurtleStart(); }
function arTurtleTick() {
  if (!ART.active || !ART.group) return;
  arFHUpdate();
  const now = performance.now(), dt = Math.min(0.05, (now - ART.last) / 1000); ART.last = now; ART.t += dt;
  const reduce = reduceMotionMQ.matches, B = ART.B;
  ART.group.updateMatrixWorld(true);
  const ev = trtGrow(dt);
  trtEvents(ev, B, (kind) => { if (kind === 'sprout' || kind === 'bloom' || kind === 'plant' || kind === 'flood') artHint(trtT(kind), 4); });
  // toques: el rayo del controlador (o del dedo sobre la pantalla) que se pulsa cerca de un lugar del caparazón
  [xrController1, xrController2].forEach((ct, ci) => {
    const pressed = !!(ct.visible && ct.userData.sel), edge = pressed && !ART.ctrlPrev[ci]; ART.ctrlPrev[ci] = pressed;
    if (!edge) return;
    ct.updateMatrixWorld(true);
    _arO.setFromMatrixPosition(ct.matrixWorld); _arM.identity().extractRotation(ct.matrixWorld); _arD.set(0, 0, -1).applyMatrix4(_arM).normalize();
    let best = -1, bd = 0.07;
    B.plotPos.forEach((p, k) => { _arP.copy(p); B.root.localToWorld(_arP); const v = _arP.clone().sub(_arO), along = v.dot(_arD); if (along <= 0) return;
      const perp = v.sub(_arD.clone().multiplyScalar(along)).length(); if (perp < bd) { bd = perp; best = k; } });
    if (best >= 0) { const res = trtTend(best); trtFeedback(best, res, B, (kind) => artHint(trtT(kind), 4)); arHaptic(ct, 0.4, 40); }
  });
  trtAnimate(B, ART.t, dt, reduce);
  if (ART.hint) {
    ART.hintT -= dt; ART.hint.material.opacity += ((ART.hintT > 0 ? 1 : 0) - ART.hint.material.opacity) * Math.min(1, dt * 3);
    if (ART.hintT < -1) { camera.remove(ART.hint); if (ART.hint.material.map) ART.hint.material.map.dispose(); ART.hint.material.dispose(); ART.hint = null; }
  }
}
window.arTurtleTick = arTurtleTick; window.arTurtleToggle = arTurtleToggle; window.arTurtleStop = arTurtleStop; window.arTurtle = ART;

// ==========================================================================================
// 🐾 EL BESTIARIO DE COLOSOS
//   Nueve colosos viven en el universo: tres ya estaban (la serpiente, la ballena y la tortuga) y seis se ganan en las secciones.
//   Cada uno se «encuentra» al terminar su Juego Otro. Los encontrados quedan guardados; con el primero llega el logro «Primer coloso»;
//   con los nueve, el logro «Colección de colosos» y su recompensa: el bestiario completo con el mapa de conceptos.
// ==========================================================================================
const COLOSSI = [
  { id: 'serpiente', hex: 0xc9786b, es: ['Serpiente emplumada', 'La Hoguera de Datos', 'El Viajero, libre en el vacío'], en: ['Feathered serpent', 'The Data Bonfire', 'The Traveler, free in the void'],
    con: { es: ['Suficiencia', 'Renuncia', 'Calor compartido'], en: ['Sufficiency', 'Renunciation', 'Shared warmth'] },
    tx: { es: 'Un coloso de monitores que ruge cuando se le da la espalda. Se calma con fuego pequeño: aprender cuánto es suficiente.', en: 'A colossus of monitors that roars when ignored. It calms with a small fire: learning how much is enough.' } },
  { id: 'ballena', hex: 0x9fd0ff, es: ['Ballena cósmica', 'Un canto sin respuesta', 'Cualquier ballena del universo'], en: ['Cosmic whale', 'A song without answer', 'Any whale of the universe'],
    con: { es: ['Alteridad', 'Eco', 'Escucha'], en: ['Otherness', 'Echo', 'Listening'] },
    tx: { es: 'Canta en pulsos y espera. No pide que la entiendas, pide que respondas con el mismo aliento.', en: 'She sings in pulses and waits. She does not ask to be understood, only to be answered with the same breath.' } },
  { id: 'tortuga', hex: 0xb8d9ad, es: ['Tortuga-planeta', 'Un jardín a cuestas', 'Módulo WebAR'], en: ['Turtle-planet', 'A garden on its back', 'WebAR Module'],
    con: { es: ['Anclaje', 'Tiempo lento', 'Cuidado'], en: ['Anchoring', 'Slow time', 'Care'] },
    tx: { es: 'Camina un paso cada treinta segundos y lleva un jardín. Lo que crece, crece también cuando nadie mira.', en: 'She takes one step every thirty seconds and carries a garden. What grows, grows when nobody looks.' } },
  { id: 'condor', hex: 0xd9d6cf, es: ['Cóndor de ceniza', 'Pedir permiso', 'Docencia en Diseño'], en: ['Ash condor', 'Asking permission', 'Design Teaching'],
    con: { es: ['Umbral', 'Confianza', 'Pedagogía del permiso'], en: ['Threshold', 'Trust', 'Pedagogy of permission'] },
    tx: { es: 'Un maestro posado en un risco. Solo se deja acercar quien sabe esperar cuando lo miran.', en: 'A teacher perched on a cliff. Only those who can wait while watched are allowed near.' } },
  { id: 'arbol', hex: 0x8fd6a8, es: ['Pewen-servidor', 'Una red de cuidado', 'GameLab Tadeo'], en: ['Pewen server-tree', 'A network of care', 'Tadeo GameLab'],
    con: { es: ['Mutualismo', 'Redes de cuidado', 'Ecosistema de investigación'], en: ['Mutualism', 'Networks of care', 'Research ecosystem'] },
    tx: { es: 'El pewen, árbol sagrado del pueblo mapuche-pehuenche, vive milenios y da piñones. Aquí sus ramas se apagan si nadie las cuida: nada brilla solo.', en: 'The pewen, sacred tree of the Mapuche-Pehuenche people, lives for millennia and gives piñones. Here its branches go dark if nobody tends them: nothing shines alone.' } },
  { id: 'escarabajo', hex: 0xe0b45c, es: ['Autómata-escarabajo', 'Cerrar el circuito', 'Consola Arduino'], en: ['Automaton beetle', 'Closing the circuit', 'Arduino Console'],
    con: { es: ['Prueba y error', 'Hardware como lenguaje', 'Ritmo de marcha'], en: ['Trial and error', 'Hardware as language', 'Gait'] },
    tx: { es: 'No trae manual. Aprende a caminar cuando sus patas encuentran, probando, un compás común.', en: 'It comes without a manual. It learns to walk when its legs find, by trying, a shared beat.' } },
  { id: 'mariquita', hex: 0xe8756a, es: ['Catarina de pantallas', 'Curar sin controlar', 'MediaLab Cinemateca'], en: ['Screen ladybug', 'Curating without controlling', 'Cinemateca MediaLab'],
    con: { es: ['Curaduría', 'Co-creación', 'Emergencia'], en: ['Curation', 'Co-creation', 'Emergence'] },
    tx: { es: 'Un enjambre de fotogramas que se pinta de motas y decide su rumbo. Curar es invitar, y también dejar ir.', en: 'A swarm of film frames that paints itself with spots and chooses its course. To curate is to invite, and also to let go.' } },
  { id: 'colibri', hex: 0x7fd4c0, es: ['Barbudito del páramo', 'Escuchar el conflicto', 'Games for Change'], en: ['Páramo helmetcrest', 'Listening to the conflict', 'Games for Change'],
    con: { es: ['Empatía', 'Mediación', 'Atención equitativa'], en: ['Empathy', 'Mediation', 'Equitable attention'] },
    tx: { es: 'Un colibrí colosal que eriza la cresta cuando nadie lo escucha. Se calma cuando cada voz es oída, y el frailejón florece.', en: 'A colossal hummingbird that bristles its crest when nobody listens. It calms when each voice is heard, and the frailejón blooms.' } },
  { id: 'medusa', hex: 0xcfa3c4, es: ['Medusa-leviatán', 'Espacio paramétrico', 'TouchDesigner & VR'], en: ['Leviathan jellyfish', 'Parametric space', 'TouchDesigner & VR'],
    con: { es: ['Parámetro', 'Resonancia', 'Exploración'], en: ['Parameter', 'Resonance', 'Exploration'] },
    tx: { es: 'Su cuerpo es una función de tres perillas. Entre muchas formas posibles, algunas resuenan.', en: 'Her body is a function of three dials. Among many possible shapes, a few resonate.' } }
];
function colossiGot() { try { return readUnlocks().colossi || {}; } catch (e) { return {}; } }
function colossiCount() { const g = colossiGot(); return COLOSSI.filter(c => g[c.id]).length; }
function colossusFound(id) {                                                       // se llama al terminar el Juego Otro de cada coloso
  const c = COLOSSI.find(x => x.id === id); if (!c) return false;
  const g = colossiGot(); if (g[id]) return false;
  window._colNewUntil = Date.now() + 25000;
  const u = readUnlocks(); u.colossi = Object.assign({}, g, { [id]: Date.now() }); writeUnlocks(u);
  const en = window.currentLang === 'en', n = colossiCount();
  setTimeout(() => { if (typeof showSystemToast === 'function') showSystemToast((en ? '🐾 COLLECTION · ' : '🐾 COLECCIÓN · ') + (en ? c.en[0] : c.es[0]) + '  ' + n + '/' + COLOSSI.length, '#e7e4de'); }, 1500);
  try { if (typeof updateAchievementsMenu === 'function') updateAchievementsMenu(); if (ACH.open && typeof renderAchievementsPanel === 'function') renderAchievementsPanel(); } catch (e) {}
  return true;
}
function colGlyph(id, hex, locked) {                                                // silueta de puntos y trazos de cada coloso (24×16)
  const G = {
    serpiente: 'M2 12c3-6 5 4 8-1s4-6 7-2 3 3 5 0M19 7l3-2M19 7l3 1', ballena: 'M2 9c4-6 12-6 17 0l3-3M2 9c3 4 12 5 17 0M7 8h.1M17 8c0 1-1 2-3 2',
    tortuga: 'M5 11c0-6 12-6 14 0zM4 11h16M19 9l3-1M7 11v3M16 11v3M9 7l2 2M13 7l-1 2', condor: 'M12 8l-9-5 4 6-4 3 9-2 9 2-4-3 4-6zM12 8v-3M12 5l1 1',
    arbol: 'M12 17V8M12 8l-7-3M12 8l7-3M12 6l-3-3M12 6l3-3M12 10l-4-1M12 10l4-1M8 17h8M5 5h.1M19 5h.1', escarabajo: 'M7 6c0-3 10-3 10 0v6c0 3-10 3-10 0zM12 4v10M7 7l-4-1M7 10l-4 1M17 7l4-1M17 10l4 1M10 3l-1-2M14 3l1-2',
    mariquita: 'M12 15c-5 0-6-8 0-9 6 1 5 9 0 9zM12 6v9M9 9h.1M15 9h.1M9 12h.1M15 12h.1M10 4l-1-2M14 4l1-2M7 10l-3-1M17 10l3-1', colibri: 'M6 13c0-5 5-7 9-5l5-2-4 3 1 3-5 3-3 3-1-3zM15 9h.1M9 9l-5-5M11 8l-1-4M13 7l1-3',
    medusa: 'M5 7c0-6 14-6 14 0zM8 7v6c0 1-1 1-1 2M12 7v7c0 1 1 1 1 2M16 7v6c0 1 1 1 1 2'
  };
  const col = locked ? '#5c6068' : '#' + hex.toString(16).padStart(6, '0');
  return `<svg viewBox="0 0 24 18" width="46" height="35" fill="none" stroke="${col}" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${G[id]}" stroke-dasharray="${locked ? '0.4 1.6' : 'none'}"/></svg>`;
}
function colBestiaryHTML() {                                                       // el cuerpo del bestiario (separado del DOM para poder probarlo)
  const en = window.currentLang === 'en', L = en ? 'en' : 'es', got = colossiGot(), n = colossiCount(), all = n >= COLOSSI.length;
  const cards = COLOSSI.map(c => {
    const has = !!got[c.id];
    if (!has) return `<li class="bst-card is-locked"><div class="bst-glyph">${colGlyph(c.id, c.hex, true)}</div><strong>▒▒▒▒ ▒▒▒▒▒</strong><span class="bst-where">${achEsc(c[L][2])}</span><small>${en ? 'Not found yet.' : 'Aún sin encontrar.'}</small></li>`;
    return `<li class="bst-card is-found" data-id="${c.id}" tabindex="0" role="button" aria-label="${achEsc(c[L][0])} · ${en ? 'view' : 'contemplar'}"><div class="bst-glyph">${colGlyph(c.id, c.hex, false)}</div><strong>${achEsc(c[L][0])}</strong><span class="bst-where">${achEsc(c[L][1])} · ${achEsc(c[L][2])}</span>
      <small>${achEsc(c.tx[L])}</small><div class="bst-chips">${c.con[L].map(k => `<i>${achEsc(k)}</i>`).join('')}</div><em class="bst-visit">${en ? '◉ Look and listen' : '◉ Contemplar y escuchar'}</em><button type="button" class="bst-refl" data-refl="${c.id}">${en ? '📖 Read its reflections' : '📖 Leer sus reflexiones'}</button></li>`;
  }).join('');
  let map = '';
  if (all) {                                                                       // recompensa: el mapa de conceptos que une a los colosos
    const idx = {}; COLOSSI.forEach(c => c.con[L].forEach(k => { (idx[k] = idx[k] || []).push(c[L][0]); }));
    map = `<h3>${en ? 'Concept map' : 'Mapa de conceptos'}</h3><p class="bst-note">${en ? 'Nine colossi, one question: what does it mean to accompany what is bigger and slower than us?' : 'Nueve colosos, una sola pregunta: ¿qué significa acompañar lo que es más grande y más lento que nosotros?'}</p>
      <ul class="bst-map">${Object.keys(idx).map(k => `<li><b>${achEsc(k)}</b><span>${idx[k].map(achEsc).join(' · ')}</span></li>`).join('')}</ul>`;
  }
  return `<button type="button" class="ach-close" aria-label="${en ? 'Close' : 'Cerrar'}">×</button><p class="ach-eyebrow">🐾</p><h2>${en ? 'Colossi collection' : 'Colección de colosos'}</h2>
    <p class="ach-sub">${en ? 'The colossi found in each section of the universe. Tap one you have found to look at it and listen.' : 'Los colosos que viven en cada sección del universo. Toca uno que ya encontraste para contemplarlo y escucharlo.'}</p><p class="ach-count">${n} / ${COLOSSI.length}</p><div class="ach-bar"><i style="width:${Math.round(n / COLOSSI.length * 100)}%"></i></div>
    <ul class="bst-grid">${cards}</ul>${map}`;
}
let _bstEl = null;
function openBestiary() {
  if (!document.getElementById('bst-style')) {
    const st = document.createElement('style'); st.id = 'bst-style';
    st.textContent = `#bst-panel{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;background:rgba(4,5,8,.72);backdrop-filter:blur(6px);font-family:-apple-system,Helvetica,Arial,sans-serif;color:#e7e4de}
      #bst-panel[hidden]{display:none} #bst-panel .ach-box{position:relative;width:min(94vw,720px);max-height:88vh;overflow:auto;padding:26px 22px;background:rgba(10,12,16,.92);border:1px solid rgba(231,228,222,.16);text-align:center}
      .bst-grid{list-style:none;padding:0;margin:18px 0 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;text-align:left}
      .bst-card{padding:12px;border:1px solid rgba(231,228,222,.14);background:rgba(231,228,222,.03);display:flex;flex-direction:column;gap:5px;font-weight:300}
      .bst-card.is-found{cursor:pointer;transition:border-color .2s,background .2s} .bst-card.is-found:hover,.bst-card.is-found:focus-visible{border-color:rgba(231,228,222,.5);background:rgba(231,228,222,.08);outline:none} .bst-refl{align-self:flex-start;margin-top:6px;background:none;border:1px solid rgba(201,168,92,.4);color:#c9a85c;font:inherit;font-size:.62rem;letter-spacing:.14em;padding:5px 10px;cursor:pointer} .bst-refl:hover{background:rgba(201,168,92,.1)} .bst-visit{font-style:normal;font-size:.62rem;letter-spacing:.16em;color:#c9a85c;margin-top:4px} .bst-card.is-locked{opacity:.55} .bst-card strong{font-weight:400;letter-spacing:.06em;font-size:.85rem} .bst-where{font-size:.62rem;letter-spacing:.14em;color:#9a968f;text-transform:uppercase}
      .bst-card small{font-size:.72rem;line-height:1.55;color:#c3c8d0} .bst-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px} .bst-chips i{font-style:normal;font-size:.6rem;letter-spacing:.1em;padding:2px 7px;border:1px solid rgba(231,228,222,.22);color:#cfd3da}
      #bst-panel h3{margin:26px 0 8px;font-weight:300;letter-spacing:.3em;font-size:.72rem;color:#a8a49c} .bst-note{font-size:.8rem;line-height:1.7;color:#cfd3da;margin:0 0 12px}
      .bst-map{list-style:none;padding:0;margin:0;text-align:left;font-size:.74rem;font-weight:300} .bst-map li{padding:6px 0;border-top:1px solid rgba(231,228,222,.08);display:flex;gap:10px;flex-wrap:wrap} .bst-map b{font-weight:400;min-width:12em;letter-spacing:.05em} .bst-map span{color:#9a968f}`;
    document.head.appendChild(st);
  }
  if (!_bstEl) {
    _bstEl = document.createElement('div'); _bstEl.id = 'bst-panel'; _bstEl.hidden = true;
    _bstEl.addEventListener('click', (e) => { if (e.target === _bstEl || (e.target.closest && e.target.closest('.ach-close'))) { closeBestiary(); return; } const rb = e.target.closest && e.target.closest('.bst-refl'); if (rb) { e.stopPropagation(); colReadRefl(rb.dataset.refl); return; } const cd = e.target.closest && e.target.closest('.bst-card.is-found'); if (cd) colVisit(cd.dataset.id); });
    _bstEl.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('is-found')) { e.preventDefault(); colVisit(e.target.dataset.id); } });
    ['touchstart', 'touchmove', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel'].forEach(evt => _bstEl.addEventListener(evt, (e) => e.stopPropagation(), { passive: true }));
    document.body.appendChild(_bstEl);
  }
  _bstEl.innerHTML = '<div class="ach-box">' + colBestiaryHTML() + '</div>'; _bstEl.hidden = false; window._bstOpen = true; isUIOpen = true;
  if (typeof playSound === 'function') playSound('ui');
}
function colViewBar(soundFn) {                                                     // modo contemplación: botón para oír al coloso + salida
  const ui = MG.ui; if (!ui) return; const en = MG.isEN();
  ui.hint.textContent = en ? 'Contemplation: drag to turn, wheel or pinch to come closer. Tap 🔊 to hear it.' : 'Contemplación: arrastra para girar, rueda o pellizco para acercarte. Toca 🔊 para oírlo.';
  const b = document.createElement('button'); b.textContent = en ? '🔊  LISTEN' : '🔊  ESCUCHAR';
  b.style.cssText = 'position:absolute; left:50%; transform:translateX(-50%); bottom:calc(92px + env(safe-area-inset-bottom,0px)); pointer-events:auto; background:rgba(10,10,12,0.45); border:1px solid rgba(201,168,92,0.55); color:#e7d9b4; padding:10px 24px; font-family:inherit; font-size:0.72rem; font-weight:300; letter-spacing:0.3em; cursor:pointer; border-radius:2px;';
  b.addEventListener('click', (e) => { e.stopPropagation(); try { soundFn(); } catch (er) {} });
  ['mousedown', 'touchstart', 'mouseup', 'touchend', 'pointerdown', 'pointerup'].forEach(ev => b.addEventListener(ev, (e) => e.stopPropagation()));
  ui.root.appendChild(b);
  const tag = document.createElement('div'); tag.textContent = en ? 'CONTEMPLATION' : 'CONTEMPLACIÓN';
  tag.style.cssText = 'position:absolute; right:18px; top:calc(84px + env(safe-area-inset-top,0px)); font-size:0.6rem; letter-spacing:0.34em; color:#c9a85c; opacity:0.85; pointer-events:none;'; ui.root.appendChild(tag);
}
const COL_REFL_KEY = { serpiente: 'hoguera', ballena: 'ballena', tortuga: 'tortuga' };
function colReadRefl(id) {                                                         // releer la reflexión inicial y la final de un coloso encontrado
  if (!colossiGot()[id]) return; const k = COL_REFL_KEY[id] || id;
  closeBestiary(); window._bstAfter = null;
  setTimeout(() => { MG.reflect(MG.text(k, 'intro'), () => { MG.reflect(MG.text(k, 'outro'), () => { setTimeout(openBestiary, 300); }, { force: true }); }, { force: true }); }, 350);
}
window.colReadRefl = colReadRefl;
function colVisit(id, force) {                                                            // volver a ver un coloso ya encontrado: relanza su escena
  if ((!force && !colossiGot()[id]) || window.isColossusActive || window.isHogueraActive || window.isWhaleActive || window.isTortugaActive) return;
  closeBestiary(); try { if (ACH.open && typeof closeAchievements === 'function') closeAchievements(); } catch (e) {}
  setTimeout(() => {
    if (id === 'serpiente' && window.startHogueraGame) window.startHogueraGame(true);
    else if (id === 'ballena' && window.startWhaleGame) window.startWhaleGame(null, true);
    else if (id === 'tortuga' && window.startTortugaGame) window.startTortugaGame(null, true);
    else if (COL_DEF[id] && window.startColossusGame) window.startColossusGame(id, null, true);
  }, 450);
}
window.colVisit = colVisit;
function closeBestiary() { if (_bstEl) _bstEl.hidden = true; window._bstOpen = false; isUIOpen = !!ACH.open; if (typeof playSound === 'function') playSound('ui'); const f = window._bstAfter; window._bstAfter = null; if (f) setTimeout(f, 300); }
document.addEventListener('keydown', (e) => { if (window._bstOpen && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeBestiary(); } }, true);
window.openBestiary = openBestiary; window.closeBestiary = closeBestiary;

// ==========================================================================================
// 🐾 MARCO COMÚN DE LOS SEIS COLOSOS NUEVOS (cóndor, árbol, escarabajo, catarina, colibrí, medusa)
//   Cada coloso es una definición COL_DEF[id] = { iso, hud, txt, build(g), update(S,dt,t,calm), tap/down/up(S,x,y), hudVals(S), endAfter }.
//   El marco pone la escena, la cámara orbital, la interfaz, el HUD, el final, el registro en el bestiario y la limpieza.
// ==========================================================================================
window.isColossusActive = false;
const COLG = { id: null, data: null, def: null, t: 0, group: null, S: null, els: {}, subT: 0, won: false, finT: 0, stars: null, dust: null };
const COL_DEF = {};
const _colV = new THREE.Vector3();
function colT(k) { const D = COLG.def; if (!D) return ''; const tx = D.txt[window.currentLang === 'en' ? 'en' : 'es']; return tx && tx[k] !== undefined ? tx[k] : ''; }
function colSub(text, secs) { const el = COLG.els.sub; if (!el || !text) return; el.textContent = text; el.style.opacity = '1'; COLG.subT = secs || 6; }
function colPick(list, cx, cy, maxPx) {                                           // el punto (en coordenadas de mundo) más cercano al dedo, en píxeles
  camera.updateMatrixWorld(true);
  let best = -1, bd = maxPx || Math.max(46, window.innerHeight * 0.075);
  list.forEach((w, i) => { if (!w) return; _colV.copy(w).project(camera); if (_colV.z > 1) return;
    const sx = (_colV.x * 0.5 + 0.5) * window.innerWidth, sy = (-_colV.y * 0.5 + 0.5) * window.innerHeight, d = Math.hypot(sx - cx, sy - cy); if (d < bd) { bd = d; best = i; } });
  return best;
}
function colW(obj, x, y, z) { obj.updateMatrixWorld(true); return obj.localToWorld(new THREE.Vector3(x, y, z)); }
function colFace() { const p = userGroup.position; return Math.atan2(-p.z, p.x); }              // rotación y para que +x local mire hacia la cámara
function colSky(g, tint) {
  COLG.stars = sptPoints(520, (i, o) => { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = 85 + Math.random() * 40, s = Math.sqrt(1 - u * u), k = Math.random();
    o.x = r * s * Math.cos(a); o.y = r * u; o.z = r * s * Math.sin(a); o.s = 0.07 + Math.pow(Math.random(), 4) * 0.35; o.a = 0.3 + Math.random() * 0.6;
    if (k < 0.2) { o.r = 0.7; o.g = 0.82; o.b = 1; } else if (k < 0.3) { o.r = 1; o.g = 0.82; o.b = 0.65; } });
  COLG.stars.material.uniforms.uOpacity.value = 0.72; g.add(COLG.stars);
  COLG.dust = sptPoints(600, (i, o) => { const t = Math.pow(Math.random(), 0.7), r = 24 + t * 60, a = Math.random() * 6.283; o.x = Math.cos(a) * r; o.z = Math.sin(a) * r - 8; o.y = (Math.random() - 0.5) * 22 - 4; o.s = 0.14 + Math.random() * 0.4; o.a = 0.05 + Math.random() * 0.1; o.r = tint[0]; o.g = tint[1]; o.b = tint[2]; });
  g.add(COLG.dust);
}
function colStart(id, view) {
  const D = COL_DEF[id]; if (!D || window.isColossusActive) return;
  window.isColossusActive = true; COLG.id = id; COLG.def = D;
  MG.enter(24);
  camera.fov = D.iso.fov || 42; targetFov = camera.fov; camera.updateProjectionMatrix();
  userGroup.rotation.order = 'YXZ';
  Object.assign(COLG, { t: 0, subT: 0, won: false, finT: 0, view: !!view });
  const g = new THREE.Group(); COLG.group = g; colSky(g, D.sky || [0.5, 0.6, 0.8]);
  COLG.S = D.build(g); scene.add(g);
  const tg = window.travelerGroup;                                                  // el Viajero siempre está: da la medida de la inmensidad del coloso
  COLG.tsave = tg ? { pos: tg.position.clone(), quat: tg.quaternion.clone(), scale: tg.scale.clone() } : null;
  COLG.pose = { pos: new THREE.Vector3(0, (typeof TRAVELER_FEET !== 'undefined') ? TRAVELER_FEET : 0.6, 0), yaw: 0 };
  if (tg) { tg.visible = true; window.hgPose = COLG.pose; }
  COLG.pad = sptPoints(46, (i, o) => { const a = i / 46 * 6.283; o.x = Math.cos(a) * 1.9; o.z = Math.sin(a) * 1.9; o.y = 0.04; o.s = 0.1; o.a = 0.5; o.r = 0.75; o.g = 0.85; o.b = 1; }); g.add(COLG.pad);
  const ui = MG.buildUI(colT('h'));
  const title = document.createElement('div'); title.style.cssText = 'font-size:0.66rem; font-weight:300; letter-spacing:0.34em; color:#a8a49c;'; title.textContent = colT('title'); ui.extra.appendChild(title);
  const sub = document.createElement('div');
  sub.style.cssText = 'position:absolute; left:50%; top:calc(150px + env(safe-area-inset-top,0px)); transform:translateX(-50%); width:min(90vw,640px); text-align:center; font-size:0.95rem; font-weight:300; letter-spacing:0.12em; line-height:1.8; color:#cfd8e3; opacity:0; transition:opacity 1.4s ease; text-shadow:0 0 14px rgba(0,0,0,0.9); pointer-events:none;';
  ui.root.appendChild(sub); COLG.els = { title, sub, hint: ui.hint };
  if (D.plate) { const pl = document.createElement('div');                              // la lámina: nombre científico y número, como en un bestiario grabado
    pl.style.cssText = 'position:absolute; left:18px; bottom:calc(22px + env(safe-area-inset-bottom,0px)); font:italic 300 0.82rem Georgia, "Times New Roman", serif; letter-spacing:0.08em; color:#c9a85c; opacity:0.85; text-shadow:0 0 10px rgba(0,0,0,0.9); pointer-events:none; border-top:1px solid rgba(201,168,92,0.45); padding-top:6px;';
    pl.textContent = D.plate[0] + '  ·  ' + D.plate[1]; ui.root.appendChild(pl); }
  hgCamReset(); hgCamBind();
  window.__colHud = D.hud; morphHUD('coloso');
  if (view) { colViewBar(() => { COLG.vk = (COLG.vk || 0) + 1; if (D.voice) colVoice(COLG.vk % 3 === 0 && D.voiceWin ? D.voiceWin : D.voice, 1); }); COLG.vT = 9; }
  else { showSystemToast(colT('toast'), '#e7e4de'); colSub(colT('s0'), 7); }
  if (D.voice && D.voiceEvery !== undefined) setTimeout(() => { if (window.isColossusActive && COLG.id === id) colVoice(D.voice, 0.6); }, 2200);
}
window.startColossusGame = function(id, data, view) {
  COLG.data = data || null;
  if (MG.pending || window.isColossusActive || window.isTortugaActive || window.isSputnikActive || window.isWhaleActive || window.isTuningGameActive || window.isWiringGameActive || window.isHogueraActive) return;
  if (view) { colStart(id, true); return; }
  MG.pending = true;
  MG.reflect(MG.text(id, 'intro'), () => { MG.pending = false; colStart(id); },
    { cancelable: true, onCancel: () => { MG.pending = false; if (data && typeof openProjectPopup === 'function') openProjectPopup(data); } });
};
function colTeardown() {
  window.isColossusActive = false; hgCamUnbind(); COL_INK.length = 0;
  const tg = window.travelerGroup; if (tg && COLG.tsave) { tg.position.copy(COLG.tsave.pos); tg.quaternion.copy(COLG.tsave.quat); tg.scale.copy(COLG.tsave.scale); }
  COLG.tsave = null; COLG.pose = null; COLG.pad = null; window.hgPose = null;
  if (COLG.def && COLG.def.dispose && COLG.S) { try { COLG.def.dispose(COLG.S); } catch (e) {} }
  if (COLG.group) { mgDispose(COLG.group); COLG.group = null; }
  COLG.S = COLG.stars = COLG.dust = null; COLG.els = {}; COLG.view = false;
}
function colAfter(data, found) {                                                  // al cerrar la reflexión final: (bestiario si se completó) y luego el contenido de la sección
  const open = () => { if (data && typeof openProjectPopup === 'function') openProjectPopup(data); };
  const u = readUnlocks();
  if (found && colossiCount() >= COLOSSI.length && !u.bestiarySeen) { u.bestiarySeen = true; writeUnlocks(u); window._bstAfter = open; setTimeout(openBestiary, 400); } else open();
}
window.colAfter = colAfter;
function colOutro(id, wasFound, data) { setTimeout(() => { MG.reflect(MG.text(id, 'outro'), () => colAfter(data, wasFound)); }, 700); }
window.endColossusGame = function() { if (!window.isColossusActive || COLG.view) return; const id = COLG.id, w = COLG.won, d = COLG.data; colTeardown(); MG.exit(); colOutro(id, w, d); };
window.abortColossusGame = function() { if (!window.isColossusActive) return; const id = COLG.id, d = COLG.data, v = COLG.view; colTeardown(); MG.exit(); if (!v) colOutro(id, false, d); };
window.colTap = function(cx, cy) { if (window.isColossusActive && !COLG.view && !window.isMiniIntro && COLG.def && COLG.def.tap) COLG.def.tap(COLG.S, cx, cy); };
window.colDown = function(cx, cy) { if (window.isColossusActive && !COLG.view && !window.isMiniIntro && COLG.def && COLG.def.down) COLG.def.down(COLG.S, cx, cy); };
window.colUp = function() { if (window.isColossusActive && COLG.def && COLG.def.up) COLG.def.up(COLG.S); };
window.colMaybeBestiary = function() { const u = readUnlocks(); if (colossiCount() >= COLOSSI.length && !u.bestiarySeen) { u.bestiarySeen = true; writeUnlocks(u); setTimeout(openBestiary, 600); } };
function colUpdate(dt) {
  const D = COLG.def, S = COLG.S; if (!D || !S) return;
  const calm = reduceMotionMQ.matches, t = MG.time, sw = calm ? 0 : 1;
  COLG.t += dt; COLG.subT -= dt;
  if (COLG.els.sub && COLG.subT <= 0) COLG.els.sub.style.opacity = '0';
  COLG.stars.rotation.y += dt * 0.004 * sw; COLG.dust.rotation.y += dt * 0.01 * sw;
  if (COLG.view && D.view) D.view(S, dt, t);
  D.update(S, dt, t, calm);
  COL_INK.forEach(m => { m.uniforms.uTime.value = t; });
  const P = COLG.pose; if (P) { const tp = D.travPos ? D.travPos(S) : (D.trav ? [Math.sin(D.trav[0]) * D.trav[1], Math.cos(D.trav[0]) * D.trav[1]] : [0, 12]); P.pos.x = tp[0]; P.pos.z = tp[1]; P.pos.y = ((typeof TRAVELER_FEET !== 'undefined') ? TRAVELER_FEET : 0.6) + (tp[2] || 0); P.yaw = Math.atan2(-tp[0], -tp[1]); COLG.pad.position.set(tp[0], tp[2] || 0, tp[1]); }
  if (COLG.view) { COLG.vT -= dt; if (COLG.vT <= 0) { COLG.vT = 11 + Math.random() * 5; if (D.voice) colVoice(D.voice, 0.7); } }
  else if (D.voice && D.voiceEvery && !COLG.won) { S.vT = (S.vT === undefined ? D.voiceEvery * 0.3 : S.vT) - dt; if (S.vT <= 0) { S.vT = D.voiceEvery * (0.8 + 0.4 * Math.random()); colVoice(D.voice, 0.7); } }
  if (!COLG.view && S.won && !COLG.won) { COLG.won = true; COLG.finT = 0; colossusFound(COLG.id); if (D.voice) colVoice(D.voiceWin || D.voice, 1); colSub(colT('done'), 12); }
  if (COLG.won && !COLG.view) { COLG.finT += dt; if (COLG.finT > (D.endAfter || 14)) { window.endColossusGame(); return; } }
  // cámara: giro libre a distancia fija + zoom (igual que Hoguera, Ballena, Sputnik y Tortuga)
  const CM = HG_CAM, I = D.iso;
  if (!CM.ptrs.size) { CM.yawT += CM.yawV * dt; CM.yawV *= Math.exp(-dt * 3.2); }
  const kc = 1 - Math.exp(-dt * 9);
  CM.yaw += (CM.yawT - CM.yaw) * kc; CM.pit += (CM.pitT - CM.pit) * kc; CM.zoom += (CM.zoomT - CM.zoom) * kc;
  const asp = window.innerWidth / window.innerHeight, fit = Math.max(1, 1.5 / asp), base = D.camDist ? D.camDist(S) : I.dist, Dd = base * fit * (D.camDist ? Math.max(0.7, Math.min(1.3, CM.zoom)) : CM.zoom);
  const psi = I.yaw + CM.yaw + Math.sin(t * 0.05) * 0.03 * sw, phi = Math.max(0.05, Math.min(1.2, I.pitch + CM.pit)), Tg = D.tgFn ? D.tgFn(S) : I.tg;
  userGroup.position.set(Tg[0] + Dd * Math.sin(psi) * Math.cos(phi), Tg[1] + Dd * Math.sin(phi), Tg[2] + Dd * Math.cos(psi) * Math.cos(phi));
  userGroup.rotation.set(-phi, psi, 0);
  const v = D.hudVals(S); MG.setHUD({ 'lives-value': String(v[0]), 'level-value': String(v[1]), 'files-value': String(v[2]), 'combo-value': String(v[3]) });
}

// ---------- Voces propias de los colosos (sintetizadas, con compresor y la reverberación de sala grande) ----------
let _colNB = null;
function colNoiseBuf(ctx) { if (!_colNB || _colNB.sampleRate !== ctx.sampleRate) { _colNB = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate); const d = _colNB.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return _colNB; }
function colVoice(kind, k) {                                                       // k = intensidad 0..1
  try {
    if (!MGS.ok()) return;
    k = k === undefined ? 1 : k;
    const ctx = audioCtx, t = ctx.currentTime, B = MGS.bus();
    const out = ctx.createGain(), comp = ctx.createDynamicsCompressor(); comp.threshold.value = -22; comp.ratio.value = 5;
    out.connect(comp); comp.connect(masterGain); comp.connect(B.input);
    const env = (dur, peak, att) => { out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(peak, t + att); out.gain.exponentialRampToValueAtTime(0.0001, t + dur); };
    const osc = (type, f0, f1, dur, g, dest) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur); const gn = ctx.createGain(); gn.gain.value = g; o.connect(gn); gn.connect(dest || out); o.start(t); o.stop(t + dur + 0.1); return o; };
    const noise = (type, f0, f1, q, dur, g, dest) => { const s = ctx.createBufferSource(); s.buffer = colNoiseBuf(ctx); s.loop = true; const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur); const gn = ctx.createGain(); gn.gain.value = g; s.connect(f); f.connect(gn); gn.connect(dest || out); s.start(t, Math.random()); s.stop(t + dur + 0.1); };
    const lowpass = (hz) => { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = hz; lp.connect(out); return lp; };
    const am = (node, hz, depth) => { const l = ctx.createOscillator(); l.frequency.value = hz; const g = ctx.createGain(); g.gain.value = depth; l.connect(g); g.connect(node.gain); l.start(t); l.stop(t + 4); };
    if (kind === 'condor') {                                                       // chillido de rapaz: aire áspero y armónicos que caen
      env(1.15, 0.34 * k, 0.04); noise('bandpass', 3300, 1300, 2.2, 1.15, 0.9); osc('sawtooth', 2100, 880, 1.0, 0.22); osc('square', 1450, 640, 0.9, 0.1); noise('highpass', 5200, 4200, 0.7, 0.18, 0.7);
    } else if (kind === 'condor_coo') {                                            // arrullo grave y corto, cuando se inclina
      env(1.7, 0.16 * k, 0.25); const o = osc('sine', 330, 270, 1.6, 0.6); osc('triangle', 660, 540, 1.6, 0.12); am(out, 5, 0.04);
    } else if (kind === 'arbol') {                                                 // crujido de madera con un zumbido de racks
      env(3.0, 0.34 * k, 0.6); const lp = lowpass(300); osc('sawtooth', 54, 46, 3.0, 0.3, lp); osc('sine', 98, 92, 3.0, 0.3); osc('sine', 147, 139, 3.0, 0.16); noise('bandpass', 420, 240, 7, 2.2, 0.5);
    } else if (kind === 'escarabajo') {                                            // zumbido mecánico con chasquidos
      env(1.1, 0.3 * k, 0.05); const buzz = ctx.createGain(); buzz.gain.value = 0.5; buzz.connect(out); osc('sawtooth', 92, 112, 1.0, 0.6, buzz); am(buzz, 30, 0.35); osc('sine', 780, 1250, 1.0, 0.08);
      const cl = ctx.createGain(); cl.gain.setValueAtTime(0, t); for (let i = 0; i < 9; i++) { cl.gain.setValueAtTime(0.7, t + i * 0.1); cl.gain.setValueAtTime(0, t + i * 0.1 + 0.018); } cl.connect(out); noise('highpass', 2600, 2600, 0.7, 1.0, 0.6, cl);
    } else if (kind === 'mariquita') {                                             // zumbido suave de élitros y un trino
      env(0.8, 0.2 * k, 0.04); const bz = ctx.createGain(); bz.gain.value = 0.5; bz.connect(out); osc('triangle', 230, 300, 0.7, 0.6, bz); am(bz, 46, 0.4); osc('sine', 1900, 2700, 0.16, 0.25);
    } else if (kind === 'oso') {                                                   // rugido de pecho: vocal que se cierra, pulso lento
      const dur = 1.2 + 1.2 * k; env(dur, 0.5 * k, 0.12);
      const sh = ctx.createWaveShaper(), cv = new Float32Array(512); for (let i = 0; i < 512; i++) cv[i] = Math.tanh((i / 511 * 2 - 1) * 4); sh.curve = cv;
      [[560, 230, 3, 1.0], [980, 520, 4, 0.7], [2300, 1000, 5, 0.3]].forEach(([f0, f1, q, g]) => { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur); const gg = ctx.createGain(); gg.gain.value = g; sh.connect(f); f.connect(gg); gg.connect(out); });
      const amp = ctx.createGain(); amp.gain.value = 0.6; amp.connect(sh); am(amp, 22, 0.4);
      const f0 = 62 + Math.random() * 14; [1, 1.013, 0.5].forEach((m, i) => osc(i === 2 ? 'square' : 'sawtooth', f0 * m * 0.8, f0 * m * 0.6, dur, i === 2 ? 0.2 : 0.5, amp));
      osc('sine', 52, 26, dur, 0.6); noise('bandpass', 900, 260, 0.9, dur, 0.3);
    } else if (kind === 'colibri') {                                                // chillido y castañeteo de un colibrí colosal (dos octavas de cuerpo)
      const n = 6 + Math.round(9 * k), gap = 0.07, tot = n * gap + 0.5; env(tot, 0.4 * k, 0.01);
      const hi = ctx.createOscillator(), lo = ctx.createOscillator(), gh = ctx.createGain(), gl = ctx.createGain(); hi.type = 'sawtooth'; lo.type = 'triangle'; gh.gain.value = 0; gl.gain.value = 0;
      hi.connect(gh); lo.connect(gl); gh.connect(out); gl.connect(out); hi.start(t); lo.start(t); hi.stop(t + tot + 0.1); lo.stop(t + tot + 0.1);
      for (let i = 0; i < n; i++) { const t0 = t + i * gap, f = 5200 + Math.random() * 1200 + (i % 3) * 250;
        hi.frequency.setValueAtTime(f, t0); hi.frequency.exponentialRampToValueAtTime(f * 0.55, t0 + gap * 0.8); lo.frequency.setValueAtTime(f * 0.3, t0); lo.frequency.exponentialRampToValueAtTime(f * 0.17, t0 + gap * 0.8);
        [gh, gl].forEach((gn, j) => { gn.gain.setValueAtTime(0.0001, t0); gn.gain.linearRampToValueAtTime(j ? 0.8 : 0.35, t0 + 0.008); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + gap * 0.92); }); }
      noise('bandpass', 4200, 3000, 1.5, tot, 0.35); am(out, 38, 0.18);
    } else if (kind === 'colibri_song') {                                           // canto bajito: tres notas que descienden, con eco
      env(3.4, 0.2 * k, 0.05); [[3300, 2500, 0], [2900, 2200, 0.5], [2500, 1900, 1.1]].forEach(([f0, f1, d]) => { const o = ctx.createOscillator(), gn = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t + d); o.frequency.exponentialRampToValueAtTime(f1, t + d + 0.35);
        gn.gain.setValueAtTime(0.0001, t + d); gn.gain.linearRampToValueAtTime(0.7, t + d + 0.03); gn.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.45); o.connect(gn); gn.connect(out); o.start(t); o.stop(t + 3);
        const l2 = ctx.createOscillator(), g2 = ctx.createGain(); l2.type = 'sine'; l2.frequency.setValueAtTime(f0 / 4, t + d); l2.frequency.exponentialRampToValueAtTime(f1 / 4, t + d + 0.35); g2.gain.setValueAtTime(0.0001, t + d); g2.gain.linearRampToValueAtTime(0.4, t + d + 0.05); g2.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.7); l2.connect(g2); g2.connect(out); l2.start(t); l2.stop(t + 3); });
    } else if (kind === 'oso_sigh') {                                              // suspiro largo de quien por fin descansa
      env(2.6, 0.14 * k, 0.5); noise('lowpass', 520, 140, 0.8, 2.6, 0.9); osc('sine', 96, 58, 2.6, 0.5);
    } else if (kind === 'medusa') {                                                // canto etéreo: tres voces que suben despacio
      env(3.4, 0.16 * k, 1.1); [392, 494, 587].forEach((f, i) => { const o = osc(i ? 'triangle' : 'sine', f * 0.5, f * 0.52, 3.4, 0.5 - i * 0.1); const v = ctx.createOscillator(); v.frequency.value = 4.5 + i; const vg = ctx.createGain(); vg.gain.value = 3 + i; v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 3.6); });
    } else if (kind === 'tortuga') {                                               // exhalación profunda de un coloso lento
      env(3.4, 0.34 * k, 0.8); osc('sine', 48, 35, 3.4, 0.8); noise('lowpass', 220, 90, 0.7, 3.4, 0.25);
    }
  } catch (e) { if (window.__colDebug) throw e; }
}
window.colVoice = colVoice;
function colMon(fill, scale, mats, pivot) {                                        // grupo de monitores fusionados con sus propios materiales
  const cells = []; fill(cells); const g = hgPart(cells, pivot || [0, 0, 0], [0, 0, 0], mats); g.scale.setScalar(scale); return g;
}
function colMats(S, hex) { const m = hgMakeMats(hex); (S.mats = S.mats || []).push(m); return m; }
function colMatsTick(S, t, calm, rune) { (S.mats || []).forEach(m => { m.screen.uniforms.uTime.value = t; m.screen.uniforms.uCalm.value = calm; if (rune !== undefined) m.screen.uniforms.uRune.value = rune; }); }
function colLimb(out, P, step, r0, r1, s0, s1, runeEvery) {                        // extremidad de monitores: cuatro caras a lo largo de una curva
  let len = 0, prev = hgCR(P, 0);
  for (let i = 1; i <= 30; i++) { const q = hgCR(P, i / 30); len += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]); prev = q; }
  const N = Math.max(2, Math.round(len / step)), F = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  for (let i = 0; i <= N; i++) {
    const u = i / N, c = hgCR(P, u), r = r0 + (r1 - r0) * u, sz = s0 + (s1 - s0) * u;
    F.forEach((n, k) => hgSurf(out, c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r, n, sz, Math.max(sz * 0.9, step * 1.02), sz * 0.8, !!runeEvery && k === 0 && i % runeEvery === 1));
  }
}
function colEll(cx, cy, cz, Rx, Ry, Rz, az, el) {                                  // punto y normal sobre un elipsoide (az desde +x hacia +z)
  const x = Rx * Math.cos(el) * Math.cos(az), y = Ry * Math.sin(el), z = Rz * Math.cos(el) * Math.sin(az);
  return { p: [cx + x, cy + y, cz + z], n: [x / (Rx * Rx), y / (Ry * Ry), z / (Rz * Rz)] };
}

// ---------- Grabado y oro: los colosos orgánicos se dibujan con trazos de tinta (sombreado que sigue la forma) y acentos de oro ----------
//   La tinta es el cuerpo del animal; el oro es lo que el juego va encendiendo (calma, confianza, circuito).
const COL_LD = [0.42, 0.78, 0.46];                                                  // luz de luna
const COL_INK = [], COL_INKC = [0.93, 0.89, 0.78], COL_GOLD = [1, 0.77, 0.3];
function colNorm() { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u); return [s * Math.cos(a), u, s * Math.sin(a)]; }
function colG(c) { c.gold = true; return c; }                                       // marca un color como acento de oro
function colUnit(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function colCross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function colPush(L, x, y, z, c, s, a, d, n) {
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
  L.push({ x, y, z, r: c[0], g: c[1], b: c[2], s: (s || 0.14) * (0.75 + Math.random() * 0.6), a: Math.min(1, (a || 0.85) * (0.72 + Math.random() * 0.28) * (c[3] === undefined ? 1 : c[3])), gold: !!c.gold || (mx > 0.62 && (mx - mn) / mx > 0.55), d: d || null, n: n || null });
}
function colShell(L, n, cx, cy, cz, rx, ry, rz, fn, o) {                           // puntos sobre un elipsoide (con pelaje opcional); fn → [r,g,b]
  o = o || {}; let k = 0, guard = 0;
  while (k < n && guard++ < n * 8) {
    const v = colNorm(); if (o.keep && !o.keep(v[0], v[1], v[2])) continue;
    const f = o.fur ? Math.random() * o.fur : 0, x = cx + (rx + f) * v[0], y = cy + (ry + f) * v[1], z = cz + (rz + f) * v[2];
    let N = colUnit([v[0] / rx, v[1] / ry, v[2] / rz]);
    const lit = 0.4 + 0.8 * Math.max(0, N[0] * COL_LD[0] + N[1] * COL_LD[1] + N[2] * COL_LD[2]);
    let t = colCross(N, [0, 1, 0]); if (Math.hypot(t[0], t[1], t[2]) < 0.25) t = colCross(N, [1, 0, 0]); t = colUnit(t);
    const ph = 0.5 + 0.45 * Math.sin(y * 0.55 + x * 0.2), b2 = colCross(N, t), d = colUnit([t[0] * Math.cos(ph) + b2[0] * Math.sin(ph), t[1] * Math.cos(ph) + b2[1] * Math.sin(ph), t[2] * Math.cos(ph) + b2[2] * Math.sin(ph)]);
    colPush(L, x, y, z, fn(x, y, z, N[0], N[1], N[2], lit), o.s, o.a, d, N); k++;
  }
}
function colTube(L, P, n, r0, r1, fn, o) {                                         // tubo orgánico a lo largo de una curva (los trazos corren a lo largo del miembro)
  o = o || {};
  for (let k = 0; k < n; k++) {
    const u = Math.random(), c = hgCR(P, u), a = hgCR(P, Math.max(0, u - 0.03)), b = hgCR(P, Math.min(1, u + 0.03));
    const T = colUnit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), v = colNorm(), d0 = v[0] * T[0] + v[1] * T[1] + v[2] * T[2];
    const N = colUnit([v[0] - d0 * T[0], v[1] - d0 * T[1], v[2] - d0 * T[2]]), B = colCross(T, N), sp = (Math.random() - 0.5) * 0.5;
    const r = r0 + (r1 - r0) * u + (o.fur ? Math.random() * o.fur : 0), lit = 0.4 + 0.8 * Math.max(0, N[0] * COL_LD[0] + N[1] * COL_LD[1] + N[2] * COL_LD[2]), x = c[0] + N[0] * r, y = c[1] + N[1] * r, z = c[2] + N[2] * r;
    colPush(L, x, y, z, fn(x, y, z, N[0], N[1], N[2], lit, u), o.s, o.a, colUnit([T[0] + B[0] * sp, T[1] + B[1] * sp, T[2] + B[2] * sp]), N);
  }
}
function colLine(L, A, B, n, c, s, a, jit) {                                         // trazo fino (garras, antenas, trazos de circuito)
  const d = colUnit([B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
  for (let i = 0; i < n; i++) { const u = n > 1 ? i / (n - 1) : 0, j = jit || 0; colPush(L, A[0] + (B[0] - A[0]) * u + (Math.random() - 0.5) * j, A[1] + (B[1] - A[1]) * u + (Math.random() - 0.5) * j, A[2] + (B[2] - A[2]) * u + (Math.random() - 0.5) * j, c, s, a, d); }
}
function colFeather(L, root, dir, len, wid, n, fn, s) {                              // pluma: raquis con barbas que se abren y vuelven a cerrarse
  const d = colUnit(dir); let w = [-d[2], 0, d[0]]; const wl = Math.hypot(w[0], w[1], w[2]) || 1; w = [w[0] / wl, 0, w[2] / wl];
  for (let i = 0; i < n; i++) { const u = Math.random(), sp = (Math.random() * 2 - 1) * wid * Math.pow(Math.sin(Math.min(1, u * 1.1) * Math.PI), 0.7) * (0.35 + 0.65 * u);
    colPush(L, root[0] + d[0] * len * u + w[0] * sp, root[1] + d[1] * len * u + (Math.random() - 0.5) * 0.12, root[2] + d[2] * len * u + w[2] * sp, fn(u, sp / (wid || 1)), s, 0.9, colUnit([d[0] + w[0] * sp * 0.25, d[1], d[2] + w[2] * sp * 0.25])); }
}
const COL_INK_VS = `
  attribute vec3 aCol; attribute float aAlpha; uniform float uTime; uniform float uJit; varying vec3 vC; varying float vA;
  float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    vC = aCol; vA = aAlpha; vec3 p = position; float k = floor(uTime * 9.0);
    p += (vec3(h(p * 7.1 + k), h(p * 5.3 + k * 1.7), h(p * 3.9 + k * 2.3)) - 0.5) * uJit;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const COL_INK_FS = `uniform vec3 uTint; uniform float uOpacity; varying vec3 vC; varying float vA; void main() { gl_FragColor = vec4(vC * uTint, vA * uOpacity); }`;
function colCloud(L, pivot, parent) {                                                // convierte la lista en trazos de tinta + puntos de oro, con su pivote
  const g = new THREE.Group(), par = parent || [0, 0, 0], ink = [], gold = [], V = [], C = [], A = [];
  if (!L.length) colPush(L, pivot[0], pivot[1], pivot[2], [0, 0, 0], 0.01, 0);
  L.forEach(p => (p.gold ? gold : ink).push(p));
  const seg = (p, d, len, k, al) => { const lum = Math.max(p.r, p.g, p.b), c = 0.38 + 0.85 * Math.pow(lum, 0.8), hx = d[0] * len / 2, hy = d[1] * len / 2, hz = d[2] * len / 2, x = p.x - pivot[0], y = p.y - pivot[1], z = p.z - pivot[2];
    V.push(x - hx, y - hy, z - hz, x + hx, y + hy, z + hz); for (let i = 0; i < 2; i++) { C.push(COL_INKC[0] * c, COL_INKC[1] * c, COL_INKC[2] * c); A.push(Math.min(1, p.a * al * (0.5 + 0.6 * lum))); } };
  ink.forEach(p => { const lum = Math.max(p.r, p.g, p.b); if (Math.random() > Math.min(1, 0.25 + 1.5 * lum)) return;
    const d = p.d || [0, 1, 0], len = Math.max(0.32, p.s * 3.6) * (0.65 + 0.8 * Math.random()); seg(p, d, len, 0, 1);
    if (p.n && lum < 0.36 && Math.random() < 0.6) seg(p, colUnit(colCross(d, p.n)), len * 0.8, 1, 0.7); });                                           // sombreado cruzado en lo oscuro
  if (!V.length) { V.push(0, 0, 0, 0, 0, 0); C.push(0, 0, 0, 0, 0, 0); A.push(0, 0); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V), 3)); geo.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(C), 3)); geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(A), 1));
  const mat = new THREE.ShaderMaterial({ uniforms: { uTint: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 1 }, uTime: { value: 0 }, uJit: { value: 0.03 } }, vertexShader: COL_INK_VS, fragmentShader: COL_INK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  g.pts = new THREE.LineSegments(geo, mat); g.pts.frustumCulled = false; g.add(g.pts); COL_INK.push(mat);
  g.gold = gold.length ? sptPoints(gold.length, (i, o) => { const p = gold[i], lum = Math.max(p.r, p.g, p.b); o.x = p.x - pivot[0]; o.y = p.y - pivot[1]; o.z = p.z - pivot[2]; o.r = COL_GOLD[0] * (0.55 + 0.6 * lum); o.g = COL_GOLD[1] * (0.55 + 0.6 * lum); o.b = COL_GOLD[2] * (0.55 + 0.6 * lum); o.s = p.s * 1.5; o.a = Math.min(1, p.a * 1.1); }) : null;
  if (g.gold) g.add(g.gold);
  g.position.set(pivot[0] - par[0], pivot[1] - par[1], pivot[2] - par[2]); return g;
}
function colTint(g, r, gg, b) { if (g && g.pts) g.pts.material.uniforms.uTint.value.setRGB(r, gg, b); if (g && g.gold) g.gold.material.uniforms.uTint.value.setRGB(1 + (r - 1) * 0.3, 1, 1 + (b - 1) * 0.3); }
function colOp(g, ink, gold) { if (!g) return; if (g.pts) g.pts.material.uniforms.uOpacity.value = ink; if (g.gold) g.gold.material.uniforms.uOpacity.value = gold === undefined ? ink : gold; }
function colJit(g, v) { if (g && g.pts) g.pts.material.uniforms.uJit.value = v; }
const colMix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- 4 · EL CÓNDOR DE CENIZA (Docencia en Diseño) — pedir permiso ----------
COL_DEF.condor = {
  iso: { yaw: 0.9, pitch: 0.2, dist: 46, tg: [0, 7, 0] }, travPos(S) { return S.path ? S.path(Math.max(0, Math.min(1, (S.D - 8) / 38))) : [4, 3, 0]; },
  tgFn(S) { const p = this.travPos(S); return [0.5 + (p[0] - 0.5) * 0.45, 6 + (p[2] - 6) * 0.45, p[1] * 0.45]; }, sky: [0.75, 0.62, 0.55], hud: ['DISTANCIA', 'CONFIANZA', 'MIRADA', 'PLUMA'], endAfter: 13, voice: 'condor', voiceEvery: 0, plate: ['Vultur gryphus', 'Lám. IV'],
  txt: {
    es: { title: 'EL CÓNDOR DE CENIZA', toast: 'Un maestro posado en un risco.',
      h: 'Sube la montaña manteniendo pulsado, pero solo cuando el cóndor mire a otro lado. Si te mira, suelta y espera: la confianza crece quieta. Cada mojón que se enciende es un permiso concedido. Arrastra el espacio vacío para girar.',
      s0: '…te observa desde la cumbre…', cairn: '…un mojón se enciende: un permiso concedido…', watch: '…te mira. Suelta y baja la mirada…', away: '…mira a otro lado. Ahora puedes avanzar…', back: '…aún no. La confianza se espera, no se empuja…', bow: '…inclina la cabeza. Tócalo…', gift: '…te deja una pluma…', done: '…una pluma de ceniza. Aprender también es que te lo permitan.' },
    en: { title: 'THE ASH CONDOR', toast: 'A teacher perched on a cliff.',
      h: 'Climb the mountain by holding, but only when the condor looks away. If it looks at you, let go and wait: trust grows in stillness. Each cairn that lights up is a permission granted. Drag empty space to turn.',
      s0: '…it watches from the summit…', cairn: '…a cairn lights up: a permission granted…', watch: '…it looks at you. Let go and lower your gaze…', away: '…it looks away. Now you may advance…', back: '…not yet. Trust is waited for, not pushed…', bow: '…it bows its head. Touch it…', gift: '…it leaves you a feather…', done: '…a feather of ash. To learn is also to be allowed.' }
  },
  build(g) {
    const S = { D: 46, trust: 0, cycle: 0, watch: false, hold: false, stage: 'approach', ruffle: 0, hy: 0, bow: 0, open: 0, feather: 0, giftT: 0, msgT: 0, won: false, lastWatch: false };
    // la montaña: un macizo andino imponente; el cóndor reina en una cornisa de la cumbre y el Viajero sube por un sendero de mojones
    const UX = Math.sin(0.9), UZ = Math.cos(0.9), rr = Math.random;
    const sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    const H = (x, z) => {
      const sl = x * UX + z * UZ, w = -x * UZ + z * UX, r = Math.hypot(x, z);
      let h = sl > 0 ? -0.72 * sl : 1.55 * (-sl) * (1 + 0.15 * Math.sin(w * 0.18));
      h += 0.9 * Math.max(0, Math.abs(w) - 8) * (sl > -4 ? 1 : 1.2);
      h += (2.4 * Math.sin(x * 0.21 + 1) * Math.sin(z * 0.17 + 0.5) + 1.2 * Math.sin(x * 0.5 + z * 0.43) + 0.6 * Math.sin(x * 1.1 - z * 0.9)) * (0.25 + sm(0, 14, Math.abs(sl)));
      h += 15 * Math.max(0, 1 - Math.hypot(sl + 30, w - 7) / 15);
      h += 8 * (1 - Math.abs(Math.sin(w * 0.14 + Math.sin(sl * 0.06) * 2.2))) * sm(-2, -14, sl) + 3.5 * Math.abs(Math.sin(sl * 0.11 + w * 0.05)) * sm(-4, -20, sl);   // contrafuertes y barrancos
      h = Math.min(h, 64); const t = sm(11, 7, r); return h * (1 - t) - 0.05 * t;
    };
    S.H = H;
    const SUN = [-0.4, 0.8, 0.45], SL = Math.hypot(...SUN);
    const TP = [], EYE = [34, 16, 28];                                              // puntos del macizo: curvas de nivel (grabado topográfico) y sombreado; los lejanos son más grandes para que la montaña pese
    const shade = (x, z) => { const gx = (H(x + 1, z) - H(x - 1, z)) / 2, gz = (H(x, z + 1) - H(x, z - 1)) / 2, nl = Math.hypot(gx, 1, gz); return Math.max(0, (-gx * SUN[0] + SUN[1] - gz * SUN[2]) / (nl * SL)); };
    const addP = (x, z, h, ct) => { const lt = shade(x, z), snow = h > 18 + 3 * Math.sin(x * 0.3 + z * 0.2), dist = Math.hypot(x - EYE[0], h - EYE[1], z - EYE[2]), fade = 1 - Math.min(1, Math.hypot(x, z) / 140) * 0.45, v = 0.35 + 0.8 * lt, sz = Math.max(0.22, Math.min(1.5, dist / 70));
      TP.push([x, h, z, ct ? sz * 0.8 : sz, (ct ? 0.9 : 0.16 + 0.14 * lt) * fade, snow ? 0.85 * v : (0.62 * v + (ct ? 0.28 : 0)), snow ? 0.92 * v : (0.5 * v + (ct ? 0.2 : 0)), snow ? v + 0.1 : (0.46 * v + (ct ? 0.12 : 0))]); };
    { const X0 = -80, Z0 = -86, ST = 0.9, NX = Math.ceil(138 / ST), NZ = Math.ceil(140 / ST), G = []; for (let i = 0; i <= NX; i++) { const col = new Float32Array(NZ + 1); for (let k = 0; k <= NZ; k++) col[k] = H(X0 + i * ST, Z0 + k * ST); G.push(col); }
      for (let lev = -34; lev <= 62; lev += 2.6) for (let i = 0; i <= NX; i++) for (let k = 0; k <= NZ; k++) { const h0 = G[i][k] - lev;
        if (i < NX) { const h1 = G[i + 1][k] - lev; if ((h0 < 0) !== (h1 < 0)) addP(X0 + (i + h0 / (h0 - h1)) * ST, Z0 + k * ST, lev, true); }
        if (k < NZ) { const h1 = G[i][k + 1] - lev; if ((h0 < 0) !== (h1 < 0)) addP(X0 + i * ST, Z0 + (k + h0 / (h0 - h1)) * ST, lev, true); } } }
    for (let i = 0; i < 9000; i++) { const x = -78 + rr() * 134, z = -84 + rr() * 136; addP(x, z, H(x, z), false); }
    g.add(sptPoints(TP.length, (i, o) => { const q = TP[i]; o.x = q[0]; o.y = q[1]; o.z = q[2]; o.s = q[3]; o.a = q[4]; o.r = q[5]; o.g = q[6]; o.b = q[7]; }));
    for (let L = 0; L < 3; L++) g.add(sptPoints(560, (i, o) => { const x = -190 + 380 * (i / 560); o.x = x; o.z = -118 - L * 18; o.y = 28 + L * 7 + 16 * Math.abs(Math.sin(x * 0.02 + L * 1.7)) + 6 * Math.sin(x * 0.07 + L) + 3 * Math.sin(x * 0.19); o.s = 0.6; o.a = 0.3; o.r = 0.34 + L * 0.04; o.g = 0.4 + L * 0.04; o.b = 0.55 + L * 0.04; }));   // cordillera lejana
    S.sea = sptPoints(900, (i, o) => { const a = rr() * 6.283, r = Math.sqrt(rr()) * 110; o.x = Math.cos(a) * r; o.z = Math.sin(a) * r - 10; o.y = -33 + rr() * 5; o.s = 2 + rr() * 2.4; o.a = 0.05 + rr() * 0.06; o.r = 0.78; o.g = 0.8; o.b = 0.88; }); g.add(S.sea);   // mar de nubes
    S.snow = sptPoints(300, (i, o) => { o.x = (rr() - 0.5) * 70; o.y = (rr() - 0.5) * 34; o.z = (rr() - 0.5) * 70; o.s = 0.12; o.a = 0.5; o.r = 0.9; o.g = 0.94; o.b = 1; }); g.add(S.snow);   // ventisca
    // el sendero y sus mojones: cada uno es un permiso
    S.path = (q) => { const r = 4.5 + q * 36, wig = 2.6 * Math.sin(q * 13) * sm(0, 0.12, q), x = UX * r - UZ * wig, z = UZ * r + UX * wig; return [x, z, H(x, z)]; };
    S.trail = sptPoints(220, (i, o) => { const p = S.path(1 - i / 219 * 0.985); o.x = p[0]; o.z = p[1]; o.y = p[2] + 0.12; o.s = 0.2; o.a = 0.22; o.r = 1; o.g = 0.82; o.b = 0.45; }); g.add(S.trail);
    S.cairns = [0.86, 0.66, 0.47, 0.3, 0.14].map((q) => { const p = S.path(q), cg = new THREE.Group(); cg.position.set(p[0] + 1.1, p[2], p[1] + 0.5);
      cg.add(sptPoints(34, (i, o) => { const k = i % 4, rad = 0.62 - k * 0.12, a = rr() * 6.283, u = rr(); o.x = Math.cos(a) * rad * Math.sqrt(u); o.z = Math.sin(a) * rad * Math.sqrt(u); o.y = 0.12 + k * 0.32 + rr() * 0.1; o.s = 0.14; o.a = 0.8; o.r = 0.6; o.g = 0.55; o.b = 0.5; }));
      const hl = mkHalo(0xffd27a, 3.2, 0.0); hl.position.y = 1.2; cg.add(hl); g.add(cg); return { q, g: cg, halo: hl, on: 0, said: false }; });
    const root = new THREE.Group(); g.add(root); S.bird = root;
    const rn = Math.random;
    const ash = (x, y, z, nx, ny, nz, lit) => { const v = 0.16 + 0.44 * Math.pow(lit, 1.2) + rn() * 0.05 + 0.03 * Math.sin(y * 3.1 + z * 2); return [v * 0.95, v * 0.97, v * 1.1]; };
    const silver = (x, y, z, nx, ny, nz, lit) => { const v = 0.36 + 0.5 * lit + rn() * 0.05; return [v * 0.95, v * 0.97, v * 1.05]; };
    // ---- el torso encorvado (se inclina hacia delante como un cóndor posado), con alas plegadas, pantalones de plumas y cola ----
    let c = [];
    colShell(c, 2600, -0.2, 5.1, 0, 2.5, 3.8, 2.4, ash, { fur: 0.4, s: 0.18, a: 0.7 });                                                              // cuerpo
    colShell(c, 360, 1.0, 5.0, 0, 1.5, 2.6, 1.8, (x, y, z, nx, ny, nz, lit) => ash(x, y, z, nx, ny, nz, lit * 1.3), { fur: 0.3, s: 0.14, keep: (nx) => nx > 0.0 });    // pecho más claro
    [-1, 1].forEach(s => {
      colShell(c, 380, 0.2, 2.9, s * 1.6, 1.3, 1.7, 0.95, ash, { fur: 0.3, s: 0.14 });                                                                // pantalones de plumas
      colShell(c, 320, -0.5, 5.4, s * 2.35, 1.6, 2.9, 0.7, silver, { fur: 0.28, s: 0.14, keep: (nx, ny, nz) => nz * s > 0.1 });                       // hombro (coberteras plegadas)
      for (let k = 0; k < 16; k++) colFeather(c, [0.4 - k * 0.07, 7.4 - k * 0.1, s * (2.2 + k * 0.07)], [-0.42 - k * 0.012, -1, s * 0.02], 5.2 + (k % 4) * 0.5 + k * 0.1, 0.62, 40, (u, e) => (k >= 4 && k <= 11 && u > 0.2 ? silver(0, 0, 0, 0, 0, 0, 0.7 + 0.2 * u) : ash(0, 0, 0, 0, 0, 0, 0.35 + 0.7 * u)), 0.12);   // alas plegadas: plumas largas que caen hacia atrás
    });
    for (let k = 0; k < 11; k++) colFeather(c, [-1.4, 2.0, (k - 5) * 0.28], [-0.42, -1, 0.07 * (k - 5)], 4.6 + (k % 3) * 0.35, 0.4, 36, (u) => ash(0, 0, 0, 0, 0, 0, 0.3 + 0.8 * u), 0.11);   // cola
    const torso = colCloud(c, [-0.6, 2.2, 0]); torso.rotation.z = -0.62; root.add(torso); S.torso = torso;
    // ---- patas escamosas con garras ----
    c = [];
    [-1, 1].forEach(s => { colTube(c, [[0.9, 2.3, s * 1.3], [1.0, 1.2, s * 1.4], [1.0, 0.12, s * 1.4]], 200, 0.5, 0.34, (x, y, z, nx, ny, nz, lit) => { const v = 0.55 + 0.3 * lit + 0.12 * Math.sin(y * 14); return [v * 0.85, v * 0.74, v * 0.7]; }, { s: 0.11, a: 0.95 });
      for (let k = -1; k <= 1; k++) { colTube(c, [[1.0, 0.12, s * 1.4], [1.7 + (k === 0 ? 0.4 : 0), 0.1, s * (1.4 + k * 0.55)], [2.2 + (k === 0 ? 0.6 : 0), 0.0, s * (1.4 + k * 0.85)]], 50, 0.2, 0.16, () => [0.6, 0.52, 0.5], { s: 0.1 }); colLine(c, [2.2 + (k === 0 ? 0.6 : 0), 0.0, s * (1.4 + k * 0.85)], [2.55 + (k === 0 ? 0.6 : 0), -0.18, s * (1.4 + k * 0.95)], 5, [0.12, 0.1, 0.1], 0.13, 0.95); }   // dedos y garras
      colLine(c, [1.0, 0.12, s * 1.4], [0.2, 0.05, s * 1.5], 6, [0.55, 0.48, 0.46], 0.12, 0.9); });
    root.add(colCloud(c, [0, 0, 0]));
    // ---- peñasco donde se posa ----
    c = []; [[1.0, -0.4, 0, 3.6, 1.1, 3.2], [-3.2, -0.5, 1.8, 2.2, 1.0, 1.6], [3.4, -0.5, -1.7, 1.8, 0.8, 1.5], [-1.5, -0.4, -2.6, 2.0, 0.9, 1.5]].forEach(r => colShell(c, 280, r[0], r[1], r[2], r[3], r[4], r[5], (x, y, z, nx, ny, nz, lit) => { const v = 0.24 + 0.4 * lit + rn() * 0.05; return [v * 1.05, v * 0.95, v * 0.9]; }, { fur: 0.1, s: 0.18, a: 0.8 }));
    root.add(colCloud(c, [0, 0, 0]));
    // ---- cuello pelado, con arrugas, y cabeza calva con cresta carnosa, ojo dorado y pico de marfil en gancho (todo gira junto al inclinarse) ----
    const HP = [2.0, 6.9, 0];
    c = [];
    colTube(c, [[2.0, 6.9, 0], [2.5, 8.1, 0], [3.2, 9.0, 0], [3.8, 9.7, 0]], 800, 1.55, 1.0, (x, y, z, nx, ny, nz, lit, u) => { const w = 0.5 + 0.5 * Math.sin(y * 7 + z * 2); const v = 0.45 + 0.4 * lit + 0.12 * w; return [v * 1.0, v * 0.62, v * 0.58]; }, { s: 0.1, a: 0.9 });
    colShell(c, 700, 4.7, 10.5, 0, 1.95, 1.45, 1.35, (x, y, z, nx, ny, nz, lit) => [(0.52 + 0.4 * lit), (0.36 + 0.3 * lit) * 0.85, (0.34 + 0.28 * lit) * 0.82], { fur: 0.06, s: 0.1, a: 0.9 });          // cabeza
    colShell(c, 240, 4.8, 12.1, 0, 1.6, 0.8, 0.26, (x, y, z, nx, ny, nz, lit) => colG([0.92, 0.62, 0.26]), { s: 0.1, a: 0.95 });                                                // cresta carnosa (macho)
    colShell(c, 90, 3.7, 8.7, 0, 0.5, 1.1, 0.7, (x, y, z, nx, ny, nz, lit) => [0.7 + 0.2 * lit, 0.3, 0.3], { s: 0.1, a: 0.9 });                                                  // papada
    colTube(c, [[6.1, 10.5, 0], [7.5, 10.3, 0], [8.3, 9.6, 0], [8.2, 8.7, 0]], 200, 0.6, 0.09, (x, y, z, nx, ny, nz, lit) => { const v = 0.55 + 0.45 * lit; return [v, v * 0.97, v * 0.86]; }, { s: 0.1, a: 0.95 });   // pico en gancho
    colLine(c, [6.3, 10.3, 0], [7.7, 10.1, 0], 8, [0.2, 0.18, 0.17], 0.09, 0.9);                                                                                                       // comisura
    S.head = colCloud(c, HP); root.add(S.head); S.headY0 = S.head.position.y;
    S.eyeHalo = mkHalo(0xffd890, 2.4, 0.1); S.eyeHalo.position.set(5.6 - HP[0], 11.0 - HP[1], 0); S.head.add(S.eyeHalo);
    S.head.add(S.eyeP = sptPoints(2, (i, o) => { o.x = 5.6 - HP[0]; o.y = 10.9 - HP[1]; o.z = i ? -1.2 : 1.2; o.s = 0.3; o.a = 1; o.r = 1; o.g = 0.8; o.b = 0.4; }));
    // ---- gorguera de plumón blanco alrededor de la base del cuello ----
    c = []; for (let k = 0; k < 760; k++) { const a = rn() * 6.283, r = 1.7 + rn() * 1.5, y = 7.3 + (rn() - 0.5) * 1.2 + 0.3 * Math.sin(a * 3) + 0.4 * rn(); colPush(c, 2.0 + Math.cos(a) * r, y, Math.sin(a) * r, [0.92 + rn() * 0.08, 0.92, 0.9], 0.18, 0.88); }
    S.ruff = colCloud(c, [2.0, 7.0, 0]); root.add(S.ruff);
    // ---- alas abiertas: brazo con coberteras en tres filas, secundarias con parche blanco y diez primarias en dedos separados ----
    S.wingG = [-1, 1].map(s => {
      const wc = [], P0 = [1.6, 6.8, s * 2.3];
      colTube(wc, [[0.3, 0.1, 0], [0.5, 0.3, s * 3.8], [0.2, 0.2, s * 7.5]], 320, 1.0, 0.55, (x, y, z, nx, ny, nz, lit) => ash(x, y, z, nx, ny, nz, lit * 1.2), { fur: 0.3, s: 0.14, a: 0.85 });                // brazo y muñeca
      for (let row = 0; row < 3; row++) for (let k = 0; k < 12; k++) colFeather(wc, [-0.2 - row * 0.5, 0.1, s * (0.6 + k * 0.62)], [-1, -0.03, s * 0.04], 1.5 + row * 0.9, 0.5, 20, (u) => silver(0, 0, 0, 0, 0, 0, 0.5 + 0.3 * u), 0.1);   // coberteras
      for (let k = 0; k < 12; k++) { const zr = s * (0.8 + k * 0.6); colFeather(wc, [-1.2, 0.0, zr], [-1, -0.02, s * 0.1 * k * 0.1], 3.4 - Math.abs(k - 5) * 0.03, 0.62, 52, (u) => (k >= 2 && k <= 10 ? [0.86 - 0.18 * u, 0.86 - 0.18 * u, 0.88 - 0.18 * u] : ash(0, 0, 0, 0, 0, 0, 0.55 + 0.6 * u)), 0.12); }   // secundarias (parche blanco)
      for (let k = 0; k < 10; k++) { const zr = s * (7.4 + k * 0.62), a = k * 0.12; colFeather(wc, [-0.4, 0.1, zr], [-Math.cos(a), 0.0, s * Math.sin(a) * 1.15], 4.4 + k * 0.13, 0.5, 56, (u) => (u > 0.82 ? colG([0.9, 0.7, 0.3]) : ash(0, 0, 0, 0, 0, 0, 0.35 + 1.0 * Math.pow(u, 2))), 0.12); }   // primarias en dedos
      const wg = colCloud(wc, [0, 0, 0]); wg.position.set(P0[0], P0[1], P0[2]); wg.rotation.x = s * 1.3; wg.scale.z = 0.3; wg.visible = false; root.add(wg); return wg; });
    S.mist = sptPoints(120, (i, o) => { o.x = (Math.random() - 0.5) * 50; o.y = -1 + Math.random() * 4; o.z = (Math.random() - 0.5) * 30; o.s = 0.4 + Math.random() * 0.5; o.a = 0.06 + Math.random() * 0.06; o.r = 0.75; o.g = 0.74; o.b = 0.78; }); g.add(S.mist);
    S.feather = sptPoints(28, (i, o) => { const u = i / 27; o.x = u * 2.6; o.y = Math.sin(u * 3) * 0.12; o.z = 0; o.s = 0.1 + Math.sin(u * 3.14) * 0.1; o.a = 1; o.r = 0.95; o.g = 0.92; o.b = 0.86; });
    S.feather.material.uniforms.uOpacity.value = 0; g.add(S.feather);
    return S;
  },
  camDist(S) { const p = this.travPos(S), e = Math.hypot(p[0] - 0.5, p[2] - 6, p[1]); return Math.min(66, Math.max(24, e * 1.25 + 16)); },
  update(S, dt, t, calm) {
    const sw = calm ? 0 : 1; S.cycle += dt; S.msgT -= dt;
    const win = Math.max(1.4, 4.2 - 2.8 * S.trust), per = 7.5;
    const watching = S.stage === 'approach' && (S.cycle % per) < win;
    if (watching !== S.watch) { S.watch = watching; if (watching && S.hold) colVoice('condor', 0.7); if (S.hold && watching && S.msgT <= 0) { colSub(colT('watch'), 4); S.msgT = 4; } else if (!watching && S.hold && S.msgT <= 0 && S.stage === 'approach') { colSub(colT('away'), 3); S.msgT = 3; } }
    if (S.stage === 'approach') {
      if (S.hold) {
        if (!S.watch) S.D = Math.max(6, S.D - (3.6 + 2 * S.trust) * dt);
        else { S.D = Math.min(46, S.D + 3.2 * dt); S.ruffle = 1; }
      } else if (S.D < 45.5) S.trust = Math.min(1, S.trust + dt * (S.watch ? 0.05 : 0.02));
      else S.trust = Math.min(1, S.trust + dt * 0.01);
      if (S.D <= 8.2) {
        if (S.trust >= 0.45) { S.stage = 'bow'; S.hold = false; colSub(colT('bow'), 8); MGS.arpeggio([0, 2, 4], 0.2, 3, 0.03); colVoice('condor_coo', 1); }
        else { S.back = true; if (S.msgT <= 0) { colSub(colT('back'), 5); S.msgT = 5; } }
      }
      if (S.back) { S.D += 5 * dt; if (S.D >= 14) S.back = false; }
    } else if (S.stage === 'gift') {
      S.giftT += dt; S.feather.material.uniforms.uOpacity.value = Math.min(1, S.giftT);
      S.feather.position.set(S.bird.position.x + 3 + S.giftT * 0.5, 9 + S.giftT * 0.6 + Math.sin(S.giftT * 1.5) * 0.2, 0.8); S.feather.rotation.z = Math.sin(S.giftT) * 0.4;
      if (S.giftT > 2.5) S.won = true;
    }
    S.ruffle = Math.max(0, S.ruffle - dt * 0.8); S.ruff.scale.setScalar(1 + 0.3 * S.ruffle);
    const bowT = S.stage === 'bow' || S.stage === 'gift' ? 1 : 0; S.bow += (bowT - S.bow) * Math.min(1, dt * 1.5);
    const tgt = colFace() + (S.watch || bowT ? 0 : 1.75);
    S.hy += (tgt - S.hy) * Math.min(1, dt * 3); S.head.rotation.y = S.hy; S.head.rotation.z = -0.62 * S.bow; S.head.position.y = S.headY0 - 0.5 * S.bow;
    S.open += ((bowT ? 0.6 : 0) - S.open) * Math.min(1, dt * 1.2); S.wingG.forEach((w, k) => { const q = Math.min(1, S.open / 0.6); w.rotation.x = (k ? 1 : -1) * (1.3 - 1.85 * q); w.scale.z = 0.3 + 0.7 * q; });
    { const qo = Math.min(1, S.open / 0.6); S.wingG.forEach(w => { w.visible = qo > 0.02; colOp(w, 1, (0.1 + 0.9 * S.trust) * qo); }); } colOp(S.head, 1, 0.1 + 0.9 * S.trust); if (S.eyeP) S.eyeP.material.uniforms.uOpacity.value = 0.25 + 0.75 * S.trust;
    S.eyeHalo.material.opacity += (((S.watch || bowT) ? 0.5 : 0.08) - S.eyeHalo.material.opacity) * Math.min(1, dt * 4);
    S.bird.position.y = Math.sin(t * 0.6) * 0.04 * sw;
    S.cairns.forEach(C => { const on = S.D <= 8 + 38 * C.q + 0.5 ? 1 : 0; C.on += (on - C.on) * Math.min(1, dt * 3); C.halo.material.opacity = 0.5 * C.on; if (on && !C.said) { C.said = true; if (S.msgT <= 0) { colSub(colT('cairn'), 3); S.msgT = 3; } MGS.bell(MGS.NOTES[(S.cairns.indexOf(C) + 1) % 6], 0, 2.4, 0.03); } if (!on) C.said = false; });
    { const TA = S.trail.geometry.attributes.aAlpha.array, qT = Math.max(0, Math.min(1, (S.D - 8) / 38)); for (let i = 0; i < TA.length; i++) { const q = 1 - i / 219 * 0.985; TA[i] = q >= qT ? 0.9 : 0.2; } S.trail.geometry.attributes.aAlpha.needsUpdate = true; }
    { const sp = S.snow.geometry.attributes.position.array, wd = (6 + 8 * (1 - Math.min(1, (S.D - 6) / 40))) * sw; for (let i = 0; i < sp.length; i += 3) { sp[i] += dt * wd * 0.8; sp[i + 1] -= dt * 0.6 * sw; sp[i + 2] += dt * wd * 0.4; if (sp[i] > 35) sp[i] = -35; if (sp[i + 2] > 35) sp[i + 2] = -35; if (sp[i + 1] < -17) sp[i + 1] = 17; } S.snow.geometry.attributes.position.needsUpdate = true; S.snow.position.set(0.5, 6, 0); S.sea.rotation.y += dt * 0.004 * sw; }
    const mp = S.mist.geometry.attributes.position.array; for (let i = 0; i < mp.length; i += 3) { mp[i] += dt * 0.5 * sw; if (mp[i] > 26) mp[i] = -26; } S.mist.geometry.attributes.position.needsUpdate = true;
  },
  tap(S) { if (S.stage === 'bow') { S.stage = 'gift'; S.giftT = 0; colSub(colT('gift'), 6); MGS.bell(MGS.NOTES[2], 0, 3, 0.04); MGS.arpeggio([0, 3, 5], 0.2, 3.4, 0.03); } },
  down(S) { if (S.stage === 'approach') S.hold = true; }, up(S) { S.hold = false; },
  hudVals(S) { return [Math.round(S.D) + ' m', Math.round(S.trust * 100) + '%', S.watch ? '●' : '○', S.stage === 'gift' ? '1' : '0']; }
};

// ---------- 1 · EL ÁRBOL-SERVIDOR (GameLab Tadeo) — una red de cuidado ----------
COL_DEF.arbol = {
  iso: { yaw: 0.6, pitch: 0.12, dist: 68, tg: [0, 15, 0] }, trav: [0.1, 9], sky: [0.45, 0.8, 0.65], hud: ['ENERGÍA', 'RAMAS', 'ESPORAS', 'RED'], endAfter: 13, voice: 'arbol', voiceEvery: 20, plate: ['Araucaria araucana', 'Lám. I'],
  txt: {
    es: { title: 'EL PEWEN-SERVIDOR', toast: 'El árbol sagrado mapuche: se apaga si nadie lo cuida.',
      h: 'Toca una rama apagada para enviarle una espora desde las raíces. La energía se recarga despacio. Las ramas se apagan despacio y las vecinas comparten su luz: reparte el cuidado. Arrastra el espacio vacío para girar.',
      s0: '…sus ramas se apagan despacio…', send: '…una espora sube por la red…', lit: '…una rama vuelve a encenderse…', empty: '…esperar también es cuidar…', done: '…todas brillan y caen los piñones. Nada brilla solo.' },
    en: { title: 'THE PEWEN SERVER-TREE', toast: 'The sacred Mapuche tree: it goes dark if nobody tends it.',
      h: 'Tap a dark branch to send it a spore from the roots. Energy recharges slowly. Branches dim slowly and neighbours share their light: spread the care. Drag empty space to turn.',
      s0: '…its branches slowly go dark…', send: '…a spore climbs the network…', lit: '…a branch lights up again…', empty: '…waiting is also caring…', done: '…they all shine and the piñones fall. Nothing shines alone.' }
  },
  build(g) {
    const S = { energy: 5, lit: 0, sent: 0, allT: 0, won: false, leaves: [], edges: [], pulses: [], msgT: 0 };
    const nodes = [[0, -2.2, 0], [0, 27, 0]]; S.src = nodes[0]; S.trunk = nodes[1];
    const edgesDef = [[0, 1, []]];
    for (let m = 0; m < 3; m++) {
      const ang = m * 2.094 + 0.4, mn = nodes.push([Math.cos(ang) * 8, 29.4, Math.sin(ang) * 8]) - 1; edgesDef.push([1, mn, []]);
      const cnt = m < 2 ? 3 : 2;
      for (let j = 0; j < cnt; j++) { const a2 = ang + (j - (cnt - 1) / 2) * 0.95, ln = nodes.push([nodes[mn][0] + Math.cos(a2) * 5.2, 32.4 + Math.random() * 2, nodes[mn][2] + Math.sin(a2) * 5.2]) - 1; edgesDef.push([mn, ln, [S.leaves.length]]); S.leaves.push({ node: ln, main: mn, lit: Math.random() * 0.22, path: [0, 1, mn, ln] }); }
    }
    S.nodes = nodes.map(n => new THREE.Vector3(n[0], n[1], n[2]));
    const mainLeaves = {}; S.leaves.forEach((L, i) => { (mainLeaves[L.main] = mainLeaves[L.main] || []).push(i); });
    edgesDef.forEach(([a, b, lv]) => { const ls = lv.length ? lv : (b === 1 ? S.leaves.map((_, i) => i) : mainLeaves[b] || []); S.edges.push({ a, b, ls }); });
    const PE = 20, total = S.edges.length * PE;
    S.lines = sptPoints(total, (i, o) => { const e = S.edges[Math.floor(i / PE)], u = (i % PE) / (PE - 1), A = nodes[e.a], B = nodes[e.b];
      o.x = A[0] + (B[0] - A[0]) * u + (Math.random() - 0.5) * 0.12; o.y = A[1] + (B[1] - A[1]) * u; o.z = A[2] + (B[2] - A[2]) * u + (Math.random() - 0.5) * 0.12; o.s = 0.22; o.a = 0.3; o.r = 0.95; o.g = 0.78; o.b = 0.4; });
    g.add(S.lines); S.PE = PE;
    g.add((() => { const c = []; colTube(c, [[0, -2.2, 0], [0.3, 12, 0.2], [0, 27, 0]], 1600, 1.9, 1.5, (x, y, z, nx, ny, nz, lit) => { const v = 0.25 + 0.55 * lit; return [v, v * 0.9, v * 0.75]; }, { fur: 0.5, s: 0.2 }); return colCloud(c, [0, 0, 0]); })());                                     // el tronco: una columna de racks
    S.racks = sptPoints(46, (i, o) => { const row = Math.floor(i / 2); o.x = (i % 2 ? 0.9 : -0.9); o.y = -1 + row * 1.15; o.z = 1.75; o.s = 0.2; o.a = 0.6; o.r = 1; o.g = 0.8; o.b = 0.4; }); g.add(S.racks);
    for (let r = 0; r < 6; r++) { const a = r * 1.047, rp = sptPoints(60, (i, o) => { const u = i / 59; o.x = Math.cos(a) * u * 11 + (Math.random() - 0.5) * 0.2; o.y = -2.2 - Math.sin(u * 2.4) * 2.6; o.z = Math.sin(a) * u * 11 + (Math.random() - 0.5) * 0.2; o.s = 0.1; o.a = 0.35 * (1 - u * 0.5); o.r = 0.5; o.g = 0.65; o.b = 0.55; }); g.add(rp); }   // raíces
    S.srcHalo = mkHalo(0xe8c070, 9, 0.25); S.srcHalo.position.copy(S.nodes[0]); g.add(S.srcHalo);
    S.leaves.forEach(L => { const p = S.nodes[L.node]; L.pos = p;
      L.canopy = trtBlob(sptPoints, 130, p.x, p.y + 0.8, p.z, 3.1, 1.8, 3.1, [0.95, 0.78, 0.4], 0.28, 0.9); g.add(L.canopy);
      L.halo = mkHalo(0xe8c070, 8, 0); L.halo.position.set(p.x, p.y + 0.8, p.z); g.add(L.halo); });
    // verticilos de ramas viejas a lo largo del tronco (la silueta del pewen) y los piñones de la copa
    S.old = sptPoints(5 * 6 * 14, (i, o) => { const k = Math.floor(i / 84), m = Math.floor(i % 84 / 14), u = (i % 14) / 13, a = m * 1.047 + k * 0.5; o.x = Math.cos(a) * u * 5.5; o.z = Math.sin(a) * u * 5.5; o.y = 7 + k * 3.6 - Math.sin(u * 1.5) * 1.6 + u * 0.6; o.s = 0.22; o.a = 0.3 - k * 0.03; o.r = 0.4; o.g = 0.45; o.b = 0.36; }); g.add(S.old);
    S.pin = sptPoints(S.leaves.length * 5, (i, o) => { const L = S.leaves[Math.floor(i / 5)], a = i * 2.4; o.x = L.pos.x + Math.cos(a) * 2.2; o.z = L.pos.z + Math.sin(a) * 2.2; o.y = L.pos.y - 0.4 - (i % 3) * 0.5; o.s = 0.5; o.a = 1; o.r = 1; o.g = 0.78; o.b = 0.4; });
    S.pin.material.uniforms.uOpacity.value = 0; g.add(S.pin);
    S.pp = sptPoints(36, (i, o) => { o.a = 0; o.s = 0.3; o.r = 0.9; o.g = 1; o.b = 0.85; }); g.add(S.pp);
    return S;
  },
  update(S, dt, t, calm) {
    S.energy = Math.min(5, S.energy + dt * 0.95); S.msgT -= dt;
    let all = true, litN = 0;
    // la red micorrícica comparte: las hojas de una misma rama se igualan despacio y las encendidas se apagan más lento
    for (const m in S.mainG || (S.mainG = (() => { const o = {}; S.leaves.forEach(L => { (o[L.main] = o[L.main] || []).push(L); }); return o; })())) { const G = S.mainG[m], avg = G.reduce((x, L) => x + L.lit, 0) / G.length; G.forEach(L => { L.lit += (avg - L.lit) * Math.min(1, dt * 0.12); }); }
    S.leaves.forEach(L => { L.lit = Math.max(0, L.lit - dt / (L.lit > 0.7 ? 260 : 150)); if (L.lit < 0.7) all = false; else litN++; });
    S.lit = litN; S.allT = all ? S.allT + dt : Math.max(0, S.allT - dt * 0.4); if (S.allT > 4 && !S.won) S.won = true;
    if (S.won) S.leaves.forEach(L => { L.lit = Math.min(1, L.lit + dt * 0.5); });
    // pulsos: cada uno recorre el camino raíz → tronco → rama → hoja
    for (let k = S.pulses.length - 1; k >= 0; k--) {
      const p = S.pulses[k]; p.d += dt * 15;
      let seg = 0, rem = p.d; while (seg < p.lens.length && rem > p.lens[seg]) { rem -= p.lens[seg]; seg++; }
      if (seg >= p.lens.length) {
        const L = S.leaves[p.leaf]; L.lit = Math.min(1, L.lit + 0.45); MGS.bell(MGS.NOTES[p.leaf % 6], 0, 2, 0.03); L.halo.material.opacity = 0.7; if (L.lit >= 0.7 && S.msgT <= 0) { colSub(colT('lit'), 3); S.msgT = 3; }
        S.pulses.splice(k, 1); continue;
      }
      p.pos.lerpVectors(S.nodes[p.path[seg]], S.nodes[p.path[seg + 1]], rem / p.lens[seg]);
    }
    const A = S.pp.geometry.attributes, pa = A.position.array, al = A.aAlpha.array; al.fill(0);
    S.pulses.forEach((p, k) => { for (let j = 0; j < 3 && k * 3 + j < 36; j++) { const idx = k * 3 + j; pa[idx * 3] = p.pos.x; pa[idx * 3 + 1] = p.pos.y - j * 0.35; pa[idx * 3 + 2] = p.pos.z; al[idx] = 1 - j * 0.3; } });
    A.position.needsUpdate = A.aAlpha.needsUpdate = true;
    // aspecto: aristas según lo encendido de sus hojas, racks según la energía
    const LA = S.lines.geometry.attributes.aAlpha.array;
    S.edges.forEach((e, ei) => { let m = 0; e.ls.forEach(i => { m = Math.max(m, S.leaves[i].lit); }); for (let j = 0; j < S.PE; j++) LA[ei * S.PE + j] = 0.14 + 0.7 * m; });
    S.lines.geometry.attributes.aAlpha.needsUpdate = true;
    const RA = S.racks.geometry.attributes.aAlpha.array; for (let i = 0; i < RA.length; i++) RA[i] = (i / RA.length < S.energy / 5 ? 0.9 : 0.15) * (0.7 + 0.3 * Math.sin(t * 3 + i * 1.7));
    S.racks.geometry.attributes.aAlpha.needsUpdate = true;
    S.leaves.forEach((L, i) => { L.canopy.material.uniforms.uOpacity.value = 0.12 + 0.88 * L.lit; L.canopy.position.y = Math.sin(t * 0.7 + i) * 0.08 * (calm ? 0 : 1); L.halo.material.opacity += ((0.5 * L.lit * L.lit) - L.halo.material.opacity) * Math.min(1, dt * 2); });
    S.srcHalo.material.opacity = 0.12 + 0.05 * S.energy;
    S.pin.material.uniforms.uOpacity.value = Math.pow(S.leaves.reduce((m, L) => m + L.lit, 0) / S.leaves.length, 2);
  },
  tap(S, cx, cy) {
    const k = colPick(S.leaves.map(L => colW(COLG.group, L.pos.x, L.pos.y + 0.8, L.pos.z)), cx, cy, Math.max(52, window.innerHeight * 0.09));
    if (k < 0) return;
    if (S.energy < 1) { if (S.msgT <= 0) { colSub(colT('empty'), 3); S.msgT = 3; } return; }
    S.energy -= 1; S.sent++;
    const path = S.leaves[k].path, lens = []; for (let i = 0; i < path.length - 1; i++) lens.push(S.nodes[path[i]].distanceTo(S.nodes[path[i + 1]]));
    S.pulses.push({ leaf: k, path, lens, d: 0, pos: new THREE.Vector3().copy(S.nodes[0]) }); if (S.pulses.length > 12) S.pulses.shift();
    MGS.ping(MGS.NOTES[k % 6] * 2, 0, 0.8, 0.02); vibrateDevice(10); if (S.sent === 1) colSub(colT('send'), 4);
  },
  hudVals(S) { return [S.energy.toFixed(1), S.lit + '/8', S.sent, Math.round(S.leaves.reduce((a, L) => a + L.lit, 0) / 8 * 100) + '%']; }
};

// ---------- 2 · EL AUTÓMATA-ESCARABAJO (Consola Arduino) — cerrar el circuito ----------
const COL_PH = [[1, 0.55, 0.45], [1, 0.85, 0.4], [0.5, 0.95, 0.65], [0.55, 0.75, 1]];       // un color por fase de cada pata
COL_DEF.escarabajo = {
  iso: { yaw: 0.7, pitch: 0.42, dist: 42, tg: [0, 3, 0] }, trav: [2.4, 22], sky: [0.9, 0.7, 0.4], hud: ['COMPÁS', 'PATAS', 'PASOS', 'LED'], endAfter: 13, voice: 'escarabajo', voiceEvery: 15, plate: ['Dynastes automaton', 'Lám. II'],
  txt: {
    es: { title: 'EL AUTÓMATA-ESCARABAJO', toast: 'Viene sin manual: se aprende probando.',
      h: 'Toca una pata para cambiar su fase (cada color es un instante del paso). Prueba hasta que todas encuentren un compás común. Arrastra el espacio vacío para girar.',
      s0: '…tropieza: sus patas no se ponen de acuerdo…', better: '…va mejor. Escucha el compás…', ok: '…encuentra el paso…', done: '…camina, y su luz se enciende. Nadie le dio un manual.' },
    en: { title: 'THE AUTOMATON BEETLE', toast: 'It comes without a manual: it is learned by trying.',
      h: 'Tap a leg to change its phase (each colour is an instant of the step). Try until all legs find a shared beat. Drag empty space to turn.',
      s0: '…it stumbles: its legs do not agree…', better: '…better. Listen for the beat…', ok: '…it finds its step…', done: '…it walks, and its light turns on. Nobody gave it a manual.' }
  },
  build(g) {
    const S = { ph: [0, 1, 2, 3, 1, 0], clock: 0, holdT: 0, steps: 0, lastTick: 0, legs: [], won: false, led: 0, rise: 0, bestC: 0, msgT: 0, open: 0 };
    S.body = new THREE.Group(); g.add(S.body);
    const rn = Math.random, GOLD = [0.9, 0.7, 0.34];
    // caparazón: élitros de coleóptero con estrías longitudinales y brillo irisado, partidos por la línea media
    const shell = (x, y, z, nx, ny, nz, lit) => { const st = 0.78 + 0.22 * Math.cos(z * 3.1), v = (0.18 + 0.5 * Math.pow(lit, 1.3)) * st, k = 0.5 + 0.5 * Math.sin(x * 0.35 + ny * 2.2);
      return [v * (0.95 + 0.25 * k), v * (0.72 + 0.2 * k), v * (0.34 + 0.4 * (1 - k))]; };
    const EC = [-2.2, 4.4, 0], ER = [9, 5.6, 6.4];
    S.circ = [];
    [1, -1].forEach(s => {
      const c = []; colShell(c, 1150, EC[0], EC[1], EC[2], ER[0], ER[1], ER[2], shell, { fur: 0.12, s: 0.15, a: 0.88, keep: (nx, ny, nz) => ny > -0.12 && nz * s > 0.02 });
      colLine(c, [EC[0] + ER[0] * 0.95, EC[1] + 0.2, s * 0.15], [EC[0] - ER[0] * 0.95, EC[1] + 0.2, s * 0.15], 48, [1, 0.85, 0.5], 0.13, 0.9);          // la sutura
      const el = colCloud(c, [EC[0], EC[1] + ER[1], s * 0.3], [0, 0, 0]); S.body.add(el); S['el' + (s > 0 ? 'L' : 'R')] = el;
      // circuitos dorados sobre el élitro: se encienden cuando las patas se ponen de acuerdo
      const tr = []; for (let k = 0; k < 5; k++) { let z = s * (1.1 + k * 1.05), x = EC[0] + ER[0] * 0.8; const run = [];
        while (x > EC[0] - ER[0] * 0.8) { const nx = x - 0.5, yy = (xx, zz) => EC[1] + ER[1] * Math.sqrt(Math.max(0, 1 - Math.pow((xx - EC[0]) / ER[0], 2) - Math.pow(zz / ER[2], 2))) + 0.18; colLine(tr, [x, yy(x, z), z], [nx, yy(nx, z), z], 2, GOLD, 0.1, 0.95); x = nx;
          if (rn() < 0.08) { const nz = z + s * (rn() < 0.5 ? 0.5 : -0.5); colLine(tr, [x, yy(x, z), z], [x, yy(x, nz), nz], 3, GOLD, 0.1, 0.95); z = nz; }
          if (rn() < 0.03) tr.push({ x, y: yy(x, z) + 0.05, z, r: 1, g: 0.95, b: 0.7, s: 0.3, a: 1 }); } }
      const cc = colCloud(tr, [EC[0], EC[1] + ER[1], s * 0.3], [EC[0], EC[1] + ER[1], s * 0.3]); el.add(cc); colOp(cc, 0.1); S.circ.push(cc);
    });
    // cuerpo: abdomen, protórax, cabeza y el gran cuerno curvo
    const dark = (x, y, z, nx, ny, nz, lit) => { const v = 0.12 + 0.42 * Math.pow(lit, 1.3); return [v * 0.85, v * 0.7, v * 0.45]; };
    let c = [];
    colShell(c, 480, -2.2, 3.1, 0, 8.4, 2.2, 5.2, dark, { fur: 0.1, s: 0.13, keep: (nx, ny) => ny < 0.5 });                                                   // abdomen
    colShell(c, 560, 8.4, 4.6, 0, 3.8, 3.2, 5.4, shell, { fur: 0.1, s: 0.14, a: 0.9 });                                                                        // protórax
    colShell(c, 300, 12.6, 4.1, 0, 2.5, 2.1, 3.1, dark, { fur: 0.1, s: 0.13 });                                                                               // cabeza
    colTube(c, [[12, 5.2, 0], [14.2, 6.6, 0], [15.6, 9.4, 0], [15.1, 11.8, 0]], 260, 0.8, 0.28, dark, { s: 0.13 });                                            // cuerno
    [-1, 1].forEach(s => { colTube(c, [[13.2, 5.5, s * 0.5], [14.3, 6.3, s * 0.8], [14.6, 7.9, s * 0.4]], 40, 0.18, 0.1, dark, { s: 0.11 });                       // cuernito lateral
      colTube(c, [[14.4, 3.4, s * 1.7], [16.4, 3.1, s * 2.0], [17.4, 3.6, s * 1.1]], 70, 0.5, 0.18, dark, { s: 0.12 });                                          // mandíbulas
      colTube(c, [[13.9, 4.9, s * 2.4], [15.2, 6.2, s * 3.6], [16.3, 6.8, s * 4.3]], 36, 0.1, 0.1, dark, { s: 0.1 });                                            // antena
      colShell(c, 22, 16.6, 6.9, s * 4.4, 0.45, 0.45, 0.8, () => [0.9, 0.7, 0.4], { s: 0.12 }); });
    colShell(c, 14, 14.5, 4.6, 0, 0.4, 0.4, 2.6, () => [0.04, 0.04, 0.05], { s: 0.2, a: 1 });                                                                  // ojos
    S.body.add(colCloud(c, [0, 0, 0], [0, 0, 0]));
    S.led = mkHalo(0xbfffd9, 4.4, 0); S.led.position.set(8.6, 7.9, 0); S.body.add(S.led);
    S.ledPts = sptPoints(1, (i, o) => { o.x = 8.6; o.y = 7.9; o.z = 0; o.s = 0.9; o.a = 0; o.r = 0.7; o.g = 1; o.b = 0.85; }); S.body.add(S.ledPts);
    // seis patas con fémur, tibia, espinas y tarso con garras; cada una se tiñe con su fase
    [[5.6, 1], [5.6, -1], [-0.4, 1], [-0.4, -1], [-6.4, 1], [-6.4, -1]].forEach(([x, s], i) => {
      const dx = x > 2 ? 2.2 : x < -4 ? -2.2 : 0.2, hip = [x, 3.4, s * 4.4], knee = [x + dx, 5.5, s * 8.2], ank = [x + dx * 1.5, 2.5, s * 10.4], foot = [x + dx * 1.7, 0.25, s * 11.5];
      const lc = [], leg = (x1, y1, z1, nx, ny, nz, lit) => { const v = 0.2 + 0.5 * Math.pow(lit, 1.3); return [v * 0.95, v * 0.78, v * 0.42]; };
      colTube(lc, [hip, knee], 150, 0.85, 0.65, leg, { fur: 0.1, s: 0.13 }); colTube(lc, [knee, ank, foot], 150, 0.6, 0.3, leg, { fur: 0.1, s: 0.12 });
      for (let k = 0; k < 7; k++) { const u = 0.2 + k * 0.11, p = hgCR([knee, ank, foot], u); colLine(lc, p, [p[0] + (k % 2 ? 0.5 : -0.5), p[1] + 0.2, p[2] + s * 0.5], 3, [0.85, 0.8, 0.6], 0.09, 0.9); }          // espinas
      colLine(lc, foot, [foot[0] + 0.5, 0.1, foot[2] + s * 0.7], 4, [0.95, 0.9, 0.75], 0.1, 0.9);
      const lg = colCloud(lc, hip, [0, 0, 0]); S.body.add(lg);
      const lamp = mkHalo(0xffffff, 4, 0.4); lamp.position.set(knee[0] - hip[0], knee[1] - hip[1] + 0.6, knee[2] - hip[2]); lg.add(lamp);
      S.legs.push({ g: lg, cloud: lg, s, x, tip: [foot[0] - hip[0], foot[1] - hip[1], foot[2] - hip[2]], y0: lg.position.y, lamp });
    });
    S.ground = sptPoints(380, (i, o) => { o.x = (Math.random() - 0.5) * 70; o.z = (Math.random() - 0.5) * 40; o.y = 0.2; o.s = 0.1 + Math.random() * 0.1; o.a = 0.15 + Math.random() * 0.2; o.r = 0.7; o.g = 0.6; o.b = 0.4; });
    g.add(S.ground);
    S.wingsP = sptPoints(260, (i, o) => { const s = i % 2 ? 1 : -1, u = Math.random(), w = Math.random(); o.x = 3 - u * 15; o.y = 9.8 + u * 1.4 + Math.sin(w * 3) * 0.3; o.z = s * (2 + u * 11 * (0.4 + 0.6 * w)); o.s = 0.14; o.a = 0.75; o.r = 0.8; o.g = 0.92; o.b = 1; });
    S.wingsP.material.uniforms.uOpacity.value = 0; S.body.add(S.wingsP);
    return S;
  },
  coherence(S) {
    const p = S.ph, a = p[0], B = (a + 2) % 4; let ok = 1;
    if (p[3] === a) ok++; if (p[4] === a) ok++; if (p[1] === B) ok++; if (p[2] === B) ok++; if (p[5] === B) ok++;
    return ok / 6;
  },
  update(S, dt, t, calm) {
    const sw = calm ? 0 : 1, coh = this.coherence(S); S.coh = coh; S.msgT -= dt;
    S.clock += dt * (0.7 + 1.0 * coh);
    S.legs.forEach((L, i) => {
      const w = Math.sin(S.clock * 3.77 + S.ph[i] * 1.5708);
      L.g.rotation.y = w * 0.5 * sw * (S.won ? 0.4 : 1); L.g.position.y = L.y0 + Math.max(0, Math.cos(S.clock * 3.77 + S.ph[i] * 1.5708)) * 0.8 * sw;
      const c = COL_PH[S.ph[i]]; L.lamp.material.color.setRGB(c[0], c[1], c[2]); colTint(L.cloud, 0.55 + 0.7 * c[0], 0.55 + 0.7 * c[1], 0.55 + 0.7 * c[2]);
    });
    const cyc = Math.floor(S.clock * 3.77 / 6.283); if (cyc > S.lastTick) { S.lastTick = cyc; S.steps++; if (!S.won) MGS.ping(150 + 90 * coh, 0, 0.14, 0.012 + 0.02 * coh); }
    S.circ.forEach(p => colOp(p, 0.08 + 0.92 * coh * coh));
    S.body.rotation.z = (1 - coh) * Math.sin(t * 9) * 0.045 * sw; S.body.rotation.x = (1 - coh) * Math.sin(t * 7.3) * 0.03 * sw;
    if (coh < 1 && !calm && Math.random() < dt * (1 - coh) * 2 && MG.fx) MG.fx.burst(0, 3, 0, 3, 1.2, 0.6, 0xe0b45c, 0.14, 0.5);
    const sp = 4 * Math.pow(coh, 3) * (S.won ? 0.4 : 1), gp = S.ground.geometry.attributes.position.array;
    for (let i = 0; i < gp.length; i += 3) { gp[i] -= dt * sp; if (gp[i] < -35) gp[i] += 70; } S.ground.geometry.attributes.position.needsUpdate = true;
    if (coh >= 1 && !S.won) { S.holdT += dt; if (S.holdT > 6) { S.won = true; MGS.arpeggio([0, 2, 3, 5], 0.2, 3.4, 0.03); } if (S.msgT <= 0 && S.holdT > 0.3 && S.holdT < 1) { colSub(colT('ok'), 4); S.msgT = 6; } } else if (!S.won) S.holdT = Math.max(0, S.holdT - dt * 2);
    if (coh > S.bestC + 0.15) { S.bestC = coh; if (coh < 1 && S.msgT <= 0) { colSub(colT('better'), 3); S.msgT = 4; } }
    S.led.material.opacity += ((S.won ? 0.9 : Math.pow(coh, 4) * 0.5) - S.led.material.opacity) * Math.min(1, dt * 2);
    S.ledPts.geometry.attributes.aAlpha.array[0] = S.won ? 1 : Math.pow(coh, 4); S.ledPts.geometry.attributes.aAlpha.needsUpdate = true;
    if (S.won) { S.open = Math.min(1, S.open + dt * 0.4); S.elL.rotation.x = -0.5 * S.open; S.elR.rotation.x = 0.5 * S.open; S.wingsP.material.uniforms.uOpacity.value = S.open; S.rise += dt; S.body.position.y = Math.min(5, S.rise * 0.45); }
  },
  tap(S, cx, cy) {
    if (S.won) return;
    const k = colPick(S.legs.map(L => colW(L.g, L.tip[0], L.tip[1], L.tip[2])), cx, cy, Math.max(50, window.innerHeight * 0.085));
    if (k < 0) return;
    S.ph[k] = (S.ph[k] + 1) % 4; MGS.ping(MGS.NOTES[S.ph[k] + 1] * 2, 0, 0.5, 0.025); vibrateDevice(8);
  },
  hudVals(S) { const n = Math.round((S.coh || 0) * 6); return [Math.round((S.coh || 0) * 100) + '%', n + '/6', S.steps, S.won ? '1' : '0']; }
};

// ---------- 3 · LA CATARINA DE PANTALLAS (MediaLab Cinemateca) — curar sin controlar ----------
const COL_TONES = [0xf2c799, 0xea9f95, 0xd1b3e0, 0xbfe6ff, 0xf0e08a, 0xb8d9ad];
const COL_SPOTS = [[-1.45, 1.25], [1.45, 1.25], [-1.7, -0.55], [1.7, -0.55], [-0.95, -1.9], [0.95, -1.9], [0, 0.15]];
COL_DEF.mariquita = {
  iso: { yaw: 0.55, pitch: 0.27, dist: 34, tg: [0, 6.5, 0] }, trav: [1.4, 11], sky: [0.85, 0.55, 0.55], hud: ['FOTOGRAMAS', 'TONOS', 'MOTAS', 'VUELO'], endAfter: 12, voice: 'mariquita', voiceEvery: 0, plate: ['Coccinella cinematographica', 'Lám. III'],
  txt: {
    es: { title: 'LA CATARINA DE PANTALLAS', toast: 'Un enjambre de fotogramas que decide su rumbo.',
      h: 'Toca los fotogramas que quieras invitar al enjambre. Cada uno le pinta una mota con su tono: necesita variedad para tomar forma. Tú no la diriges: ella decide a dónde va. Arrastra el espacio vacío para girar.',
      s0: '…un enjambre sin forma, buscando…', join: '…un fotograma se une…', tone: '…un tono nuevo le pinta una mota…', wings: '…empieza a ser catarina…', done: '…abre los élitros, toma el vuelo y se va. Curar es invitar, y también dejar ir.' },
    en: { title: 'THE SCREEN LADYBUG', toast: 'A swarm of frames that chooses its course.',
      h: 'Tap the frames you want to invite into the swarm. Each paints a spot with its tone: it needs variety to take shape. You do not steer it: it decides where to go. Drag empty space to turn.',
      s0: '…a shapeless swarm, searching…', join: '…a frame joins…', tone: '…a new tone paints a spot…', wings: '…it begins to be a ladybug…', done: '…it opens its shell, takes flight and goes. To curate is to invite, and also to let go.' }
  },
  build(g) {
    const N = 900, rnd = Math.random;
    const S = { N, joined: 0, pool: [], frames: [], spawnT: 0.5, tonePick: 0, fly: 0, flap: 0, f: 0, won: false, msgT: 0, wingsMsg: false, ang: [], rad: [], H: new Float32Array(N * 3), cat: [], spot: [], side: [], ord: [], open: 0, cx: 0, cy: 6, cz: 0, M: new THREE.Matrix4(), TILT: 0.13, HEAD: 0.95 };
    // la hoja: una lámina grande, curva, con nervaduras y rocío, sobre un tallo; la catarina se posa encima
    const leaf = new THREE.Group(); leaf.position.set(0, 6, 0); leaf.rotation.z = S.TILT; g.add(leaf); S.leaf = leaf;
    const LY = (u, v) => 0.9 * v * v - 1.1 * u * u, LW = (u) => Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.18 * u);
    const lp = (n, fn) => leaf.add(sptPoints(n, fn));
    lp(900, (i, o) => { const u = rnd() * 2 - 1, v = (rnd() * 2 - 1) * LW(u); o.x = u * 9; o.z = v * 5.6; o.y = LY(u, v / Math.max(0.2, LW(u))) - 0.05; o.s = 0.12; o.a = 0.12 + 0.18 * (1 - Math.abs(v)); o.r = 0.3; o.g = 0.58 + rnd() * 0.12; o.b = 0.42; });
    lp(60, (i, o) => { const u = i / 59 * 2 - 1; o.x = u * 9; o.y = LY(u, 0) + 0.02; o.z = 0; o.s = 0.2; o.a = 0.8; o.r = 0.6; o.g = 0.95; o.b = 0.7; });                       // nervadura central
    lp(8 * 2 * 16, (i, o) => { const k = Math.floor(i / 32), sd = (i % 32) < 16 ? 1 : -1, j = i % 16 / 15, u0 = -0.8 + k * 0.2, w = LW(u0 + j * 0.28) * 0.92 * j; o.x = (u0 + j * 0.28) * 9; o.z = sd * w * 5.6; o.y = LY(u0 + j * 0.28, sd * w) + 0.02; o.s = 0.14; o.a = 0.55; o.r = 0.5; o.g = 0.88; o.b = 0.62; });   // nervaduras laterales
    lp(220, (i, o) => { const a = i / 220 * 6.283, u = Math.cos(a), v = Math.sin(a) * LW(u); o.x = u * 9; o.z = v * 5.6; o.y = LY(u, Math.sin(a)) + 0.02; o.s = 0.16; o.a = 0.6; o.r = 0.75; o.g = 1; o.b = 0.8; });                  // borde
    lp(9, (i, o) => { const a = i * 2.4, r = 1 + (i % 4) * 0.9; o.x = 2.5 + Math.cos(a) * r * 1.8; o.z = Math.sin(a) * r * 0.9; o.y = 0.12; o.s = 0.42; o.a = 0.9; o.r = 0.8; o.g = 0.95; o.b = 1; });     // rocío
    g.add(sptPoints(80, (i, o) => { const u = i / 79; o.x = -9.5 * u - 0.5 * Math.sin(u * 3.1) * 2; o.y = 6 - u * 6.2 + 1.5 * Math.sin(u * 3.14) * 0.4 - 0.2; o.z = 0.8 * Math.sin(u * 3); o.s = 0.28; o.a = 0.8; o.r = 0.45; o.g = 0.8; o.b = 0.5; }));      // tallo
    for (let k = 0; k < 2; k++) { const lf = new THREE.Group(); lf.position.set(k ? 14 : -15, k ? 1.4 : 2.2, k ? -6 : -3); lf.rotation.set(0.2, k ? 2.3 : 0.7, k ? -0.3 : 0.25); lf.scale.setScalar(0.55); g.add(lf);
      lf.add(sptPoints(260, (i, o) => { const u = rnd() * 2 - 1, v = (rnd() * 2 - 1) * LW(u); o.x = u * 9; o.z = v * 5.6; o.y = LY(u, v / Math.max(0.2, LW(u))); o.s = 0.16; o.a = 0.2; o.r = 0.28; o.g = 0.55; o.b = 0.42; }));
      lf.add(sptPoints(40, (i, o) => { const u = i / 39 * 2 - 1; o.x = u * 9; o.y = LY(u, 0); o.z = 0; o.s = 0.24; o.a = 0.55; o.r = 0.5; o.g = 0.9; o.b = 0.65; })); }
    // la catarina en coordenadas locales (x ancho, y alto, z hacia la cabeza): élitros en cúpula con motas, pronoto, cabeza, antenas y seis patas
    const ax = 2.6, ay = 1.9, az = 3.0, yc = 0.9, cz = -0.3; let n = 0;
    const put = (x, y, z, cat, sp, sd) => { if (n >= N) return; S.H[n * 3] = x; S.H[n * 3 + 1] = y; S.H[n * 3 + 2] = z; S.cat.push(cat); S.spot.push(sp === undefined ? -1 : sp); S.side.push(sd || 0); n++; };
    const dome = (X, Z) => { const q = 1 - (X / ax) * (X / ax) - ((Z - cz) / az) * ((Z - cz) / az); return q > 0 ? yc + ay * Math.sqrt(q) : -1; };
    COL_SPOTS.forEach((p, k) => { const X0 = p[0] * 1.15, Z0 = p[1] * 1.2 - 0.2; for (let j = 0; j < 22; j++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 0.5, X = X0 + Math.cos(a) * r, Z = Z0 + Math.sin(a) * r, y = dome(X, Z); if (y < 0) { j--; continue; } put(X, y + 0.06, Z, 1, k, X < 0 ? -1 : 1); } });
    for (let j = 0; j < 400; j++) { const X = (rnd() * 2 - 1) * ax, Z = cz + (rnd() * 2 - 1) * az, y = dome(X, Z); if (y < 0 || Math.abs(X) < 0.08 || Z > 1.3) continue; put(X, y, Z, 0, undefined, X < 0 ? -1 : 1); }
    for (let j = 0; j < 40; j++) { const Z = cz + (j / 39 * 2 - 1) * az * 0.93, y = dome(0, Z); if (Z < 1.3 && y > 0) put(0, y + 0.03, Z, 2, undefined, 0); }                                  // sutura central
    for (let j = 0; j < 90; j++) { const a = j / 90 * 6.283, X = Math.cos(a) * ax * 0.98, Z = cz + Math.sin(a) * az * 0.98; if (Z < 1.3) put(X, yc + 0.05, Z, 2, undefined, 0); }              // reborde de los élitros
    for (let j = 0; j < 110; j++) { const a = rnd() * 6.283, b = rnd() * 1.4; put(Math.cos(a) * Math.cos(b) * 1.75, 1.7 + Math.sin(b) * 1.05, 2.15 + Math.sin(a) * Math.cos(b) * 0.95, 2); }       // pronoto
    for (let k = 0; k < 2; k++) for (let j = 0; j < 8; j++) { const a = rnd() * 6.283, r = rnd() * 0.3; put((k ? 1 : -1) * 1.05 + Math.cos(a) * r, 2.25 + Math.sin(a) * r * 0.5, 2.5 + Math.sin(a) * r, 3); }                // manchas blancas del pronoto
    for (let j = 0; j < 90; j++) { const a = rnd() * 6.283, b = rnd() * 3.14; put(Math.sin(b) * Math.cos(a) * 1.05, 1.35 + Math.cos(b) * 0.85, 3.45 + Math.sin(b) * Math.sin(a) * 0.9, 2); }  // cabeza
    for (let k = 0; k < 2; k++) for (let j = 0; j < 6; j++) { const a = rnd() * 6.283, r = rnd() * 0.22; put((k ? 1 : -1) * 0.62 + Math.cos(a) * r, 1.75 + Math.sin(a) * r, 4.15 + rnd() * 0.15, 3); }                    // ojos
    for (let k = 0; k < 2; k++) for (let j = 0; j < 16; j++) { const u = j / 15, s = k ? 1 : -1; put(s * (0.35 + u * 1.2 + Math.sin(u * 3) * 0.2), 1.7 + u * 1.5 - u * u * 0.3, 4.1 + u * 2.4, 2, undefined, 0); S.ant = S.ant || {}; S.ant[n - 1] = s; }   // antenas
    for (let k = 0; k < 6; k++) { const s = k < 3 ? -1 : 1, li = k % 3, hz = 1.6 - li * 1.5; for (let j = 0; j < 11; j++) { const u = j / 10, kx = s * 3.1, ky = 1.5, kz = hz + (li - 1) * 0.35, fx = s * 3.5, fz = hz + (li - 1) * 1.1 + 0.8, x = u < 0.5 ? (s * 1.5 + (kx - s * 1.5) * u * 2) : (kx + (fx - kx) * (u - 0.5) * 2), y = u < 0.5 ? (0.9 + (ky - 0.9) * u * 2) : (ky * (1 - (u - 0.5) * 2)), z = u < 0.5 ? (hz + (kz - hz) * u * 2) : (kz + (fz - kz) * (u - 0.5) * 2); put(x, y, z, 2, undefined, 0); } }   // patas
    while (n < N) { const X = (rnd() * 2 - 1) * ax * 0.9, Z = cz + (rnd() * 2 - 1) * az * 0.9, y0 = dome(X, Z); if (y0 < 0 || Math.abs(X) < 0.08 || Z > 1.2) continue; put(X, yc + (y0 - yc) * (0.35 + rnd() * 0.6), Z, 0, undefined, X < 0 ? -1 : 1); }   // volumen interior
    for (let i = 0; i < N; i++) { S.ord.push(rnd()); S.ang.push(rnd() * 6.283); S.rad.push(3.5 + rnd() * 9); }
    S.swarm = sptPoints(N, (i, o) => { o.x = (rnd() - 0.5) * 20; o.y = 6 + (rnd() - 0.5) * 8; o.z = (rnd() - 0.5) * 20; o.s = 0.15; o.a = 0.5; o.r = 0.7; o.g = 0.72; o.b = 0.78; }); { const SZ = S.swarm.geometry.attributes.aSize.array; for (let i = 0; i < N; i++) SZ[i] = [0.15, 0.27, 0.18, 0.26][S.cat[i]]; } g.add(S.swarm);
    S.hwh = []; S.hw = sptPoints(160, (i, o) => { const s = i % 2 ? 1 : -1, u = rnd(), a = rnd() * 6.283; S.hwh.push([s, u, a]); o.x = o.y = o.z = 0; o.s = 0.11; o.a = 0.7; o.r = 0.75; o.g = 0.9; o.b = 1; });
    S.hw.material.uniforms.uOpacity.value = 0; g.add(S.hw);
    S.proj = sptPoints(60, (i, o) => { o.x = (rnd() - 0.5) * 70; o.y = rnd() * 20; o.z = -20 - rnd() * 20; o.s = 0.3 + rnd() * 0.4; o.a = 0.05; o.r = 0.8; o.g = 0.8; o.b = 0.9; }); g.add(S.proj);
    return S;
  },
  spawn(S, g) {
    const tone = this.nextTone(S), fr = new THREE.Group(), a = Math.random() * 6.283, r = 11 + Math.random() * 6, hex = COL_TONES[tone], [cr, cg, cb] = arRGB(hex);
    fr.add(sptPoints(26, (i, o) => { const u = i / 26 * 4; const side = Math.floor(u), w = u - side, W = 1.5, H = 1.0; if (side === 0) { o.x = -W + 2 * W * w; o.y = -H; } else if (side === 1) { o.x = W; o.y = -H + 2 * H * w; } else if (side === 2) { o.x = W - 2 * W * w; o.y = H; } else { o.x = -W; o.y = H - 2 * H * w; } o.z = 0; o.s = 0.17; o.a = 0.95; o.r = cr; o.g = cg; o.b = cb; }));
    fr.add(sptPoints(30, (i, o) => { o.x = (Math.random() - 0.5) * 2.6; o.y = (Math.random() - 0.5) * 1.8; o.z = 0; o.s = 0.12; o.a = 0.25; o.r = cr; o.g = cg; o.b = cb; }));
    const halo = mkHalo(hex, 4.2, 0.25); fr.add(halo);
    const F = { g: fr, tone, a, r, y: 3 + Math.random() * 7, sp: (0.07 + Math.random() * 0.06) * (Math.random() < 0.5 ? 1 : -1), hex, join: 0, life: 0 };
    S.frames.push(F); COLG.group.add(fr);
  },
  nextTone(S) { const t = S.tonePick % 6; S.tonePick++; return [0, 1, 2, 3, 4, 5][(t + (Math.random() < 0.3 ? 1 : 0)) % 6]; },
  update(S, dt, t, calm) {
    const sw = calm ? 0 : 1; S.msgT -= dt; S.spawnT -= dt; S.flap += dt * (1.2 + S.pool.length * 0.07 + new Set(S.pool).size * 0.15);
    if (S.spawnT <= 0 && S.frames.filter(f => !f.join).length < 7 && !S.won) { this.spawn(S); S.spawnT = 2.2; }
    const distinct = new Set(S.pool).size, tf = Math.min(1, S.joined / 7);
    S.f += (tf - S.f) * Math.min(1, dt * 0.8);
    if (S.won) { S.fly += dt; S.open = Math.min(1, S.open + dt * 0.7); }
    const fl = Math.max(0, S.fly - 1.8), ox = fl * fl * 1.4, oy = fl * 1.6 + fl * fl * 0.3, oz = -fl * fl * 3.2;
    // la catarina vive sobre la hoja; el enjambre sin forma flota alrededor y se desvanece al posarse
    const ch = Math.cos(S.HEAD), sh = Math.sin(S.HEAD), ct = Math.cos(S.TILT), st = Math.sin(S.TILT);
    const sx = (X, Y, Z) => { X *= 1.3; Y *= 1.3; Z *= 1.3; const x1 = X * ch + Z * sh + 0.8, y1 = Y + 0.02, z1 = -X * sh + Z * ch; return [x1 * ct - y1 * st + ox, x1 * st + y1 * ct + 6 + oy, z1 + oz]; };
    S.cx = 0.8 * ct + ox; S.cy = 0.8 * st + 8 + oy; S.cz = oz;
    const A = S.swarm.geometry.attributes, pa = A.position.array, co = A.aCol.array, al = A.aAlpha.array, breath = 1 + 0.012 * Math.sin(S.flap * 2.2) * sw;
    const th = S.open * 1.15, cT = Math.cos(th), sT = Math.sin(th), HY = 0.9 + 1.9 * 0.95;
    for (let i = 0; i < S.N; i++) {
      let tx, ty, tz; const inF = S.ord[i] < S.f, cat = S.cat[i];
      if (inF) {
        let x = S.H[i * 3], y = S.H[i * 3 + 1] * breath, z = S.H[i * 3 + 2]; const sd = S.side[i];
        if (sd && S.open > 0) { const dx = x - sd * 0.15, dy = y - HY, c = cT, s2 = sd * sT; x = sd * 0.15 + dx * c - dy * s2; y = HY + dx * s2 + dy * c; }
        if (S.ant && S.ant[i]) x += Math.sin(t * 3 + i) * 0.12 * sw;
        [tx, ty, tz] = sx(x, y, z);
      } else { const a = S.ang[i] + t * 0.15 * (i % 2 ? 1 : -1) * sw, r = S.rad[i]; tx = S.cx + Math.cos(a) * r; ty = S.cy + 1 + Math.sin(a * 1.3 + i) * (r * 0.45); tz = S.cz + Math.sin(a) * r; }
      pa[i * 3] += (tx - pa[i * 3]) * Math.min(1, dt * 2.2); pa[i * 3 + 1] += (ty - pa[i * 3 + 1]) * Math.min(1, dt * 2.2); pa[i * 3 + 2] += (tz - pa[i * 3 + 2]) * Math.min(1, dt * 2.2);
      if (inF) {
        if (cat === 0) { const sh = 0.75 + 0.25 * Math.min(1, Math.max(0, (S.H[i * 3 + 1] - 0.9) / 1.9)); co[i * 3] = 0.95 * sh; co[i * 3 + 1] = 0.16 * sh; co[i * 3 + 2] = 0.14 * sh; al[i] = 0.9; }                      // élitros rojos, más claros en la cima
        else if (cat === 1) { const k = S.spot[i]; if (k < S.pool.length) { const [cr, cg, cb] = arRGB(COL_TONES[S.pool[k]]); co[i * 3] = cr; co[i * 3 + 1] = cg; co[i * 3 + 2] = cb; al[i] = 1; } else { co[i * 3] = 0.1; co[i * 3 + 1] = 0.08; co[i * 3 + 2] = 0.12; al[i] = 0.7; } }
        else if (cat === 2) { co[i * 3] = 0.55; co[i * 3 + 1] = 0.62; co[i * 3 + 2] = 0.85; al[i] = 1; }
        else { co[i * 3] = 0.95; co[i * 3 + 1] = 0.97; co[i * 3 + 2] = 1; al[i] = 1; }
      } else if (S.pool.length) { const [cr, cg, cb] = arRGB(COL_TONES[S.pool[i % S.pool.length]]); co[i * 3] = cr; co[i * 3 + 1] = cg; co[i * 3 + 2] = cb; al[i] = 0.5; } else al[i] = 0.4;
    }
    A.position.needsUpdate = A.aCol.needsUpdate = A.aAlpha.needsUpdate = true;
    // alas membranosas que asoman al abrir los élitros y baten al despegar
    const hp = S.hw.geometry.attributes.position.array, flapW = Math.sin(S.flap * 9) * (0.25 + 0.5 * Math.min(1, fl)) * S.open * sw;
    for (let i = 0; i < S.hwh.length; i++) { const [s, u, a] = S.hwh[i], len = 0.6 + u * 4.6, X = s * len * Math.cos(flapW), Y = 2.2 + len * Math.sin(flapW) * 0.9 * S.open + Math.sin(a) * 0.5 * (1 - u * 0.5), Z = -0.4 - Math.sin(u * 3.14) * 1.6 + Math.cos(a) * 0.6 * (1 - u * 0.5); const q = sx(X, Y, Z); hp[i * 3] = q[0]; hp[i * 3 + 1] = q[1]; hp[i * 3 + 2] = q[2]; }
    S.hw.geometry.attributes.position.needsUpdate = true; S.hw.material.uniforms.uOpacity.value = S.open * 0.9;
    // fotogramas a la deriva y los que se unen
    for (let k = S.frames.length - 1; k >= 0; k--) {
      const F = S.frames[k]; F.life += dt;
      if (!F.join) { F.a += F.sp * dt * sw; F.g.position.set(Math.cos(F.a) * F.r, F.y + Math.sin(t * 0.5 + F.a * 3) * 0.4, Math.sin(F.a) * F.r); F.g.rotation.y = colFace(); }
      else { F.join += dt * 1.2; F.g.position.lerp(_colV.set(S.cx, S.cy, S.cz), Math.min(1, dt * 3)); F.g.scale.setScalar(Math.max(0.01, 1 - F.join)); if (F.join >= 1) { COLG.group.remove(F.g); mgDispose(F.g); S.frames.splice(k, 1); } }
    }
    if (!S.wingsMsg && S.f > 0.6) { S.wingsMsg = true; colSub(colT('wings'), 5); }
    if (!S.won && S.joined >= 7 && distinct >= 5) { S.won = true; MGS.arpeggio([0, 2, 3, 5, 4], 0.2, 3.6, 0.03); }
    S.distinct = distinct;
  },
  tap(S, cx, cy) {
    if (S.won) return;
    const cand = S.frames.filter(f => !f.join), k = colPick(cand.map(F => colW(F.g, 0, 0, 0)), cx, cy, Math.max(56, window.innerHeight * 0.1));
    if (k < 0) return;
    const F = cand[k], before = new Set(S.pool).size; F.join = 0.001; S.pool.push(F.tone); S.joined++;
    MGS.bell(MGS.NOTES[F.tone % 6], 0, 2.2, 0.03); MGS.ping(MGS.NOTES[(F.tone + 2) % 6] * 2, 0.12, 0.8, 0.015); vibrateDevice(10); colVoice('mariquita', 0.45);
    colSub(new Set(S.pool).size > before ? colT('tone') : colT('join'), 3);
  },
  hudVals(S) { return [S.joined, (S.distinct || 0) + '/6', Math.min(S.pool.length, 7) + '/7', S.won ? '1' : '0']; }
};


// ---------- 5 · EL BARBUDITO DEL PÁRAMO (Games for Change) — escuchar el conflicto, en el páramo ----------
const COL_FIG = [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6];
COL_DEF.colibri = {
  iso: { yaw: 0.35, pitch: 0.2, dist: 70, tg: [0, 21, 0], fov: 42 }, trav: [0.15, 15], sky: [0.5, 0.62, 0.55], hud: ['TENSIÓN', 'ESCUCHA', 'VOCES CALMAS', 'COLIBRÍ'], endAfter: 13, voice: 'colibri', voiceEvery: 0, plate: ['Oxypogon guerinii  ×  Espeletia', 'Lám. V'], voiceWin: 'colibri_song',
  txt: {
    es: { title: 'EL BARBUDITO DEL PÁRAMO', toast: 'Un colibrí colosal en el páramo: tres voces que no se oyen.',
      h: 'Mantén pulsada una figura para escucharla: se calma. Pero las otras se tensan donde no miras. Reparte la atención. Arrastra el espacio vacío para girar.',
      s0: '…el colibrí eriza la cresta y chilla entre la niebla: hay tres voces y ninguna se oye…', listen: '…la escuchas. Se va calmando…', neglect: '…las otras se tensan donde no miras…', heard: '…quien es escuchado empieza a escuchar…', done: '…pliega las alas, baja la cresta y canta bajito sobre el frailejón. Nadie fue vencido.' },
    en: { title: 'THE PÁRAMO HELMETCREST', toast: 'A colossal hummingbird of the páramo: three voices that cannot hear each other.',
      h: 'Hold a figure to listen to it: it calms. But the others tense up where you are not looking. Share your attention. Drag empty space to turn.',
      s0: '…the hummingbird bristles its crest and shrieks in the mist: there are three voices and none is heard…', listen: '…you listen. It slowly calms…', neglect: '…the others tense where you are not looking…', heard: '…whoever is heard begins to listen…', done: '…it folds its wings, lowers its crest and sings softly on the frailejón. No one was defeated.' }
  },
  build(g) {
    const S = { a: [0.85, 0.7, 0.8], listen: -1, calmT: 0, won: false, msgT: 0, breath: 0, rumT: 0, agit: 1, down: 0, figs: [], heardMsg: false, neglMsg: false, roarT: 2.5, rear: 0, rp: 0, jx: 0, hy: 0 };
    const rnd = Math.random;
    // --- el páramo: pajonal, frailejones, laguna, cordilleras y niebla ---
    // suelo: pajonal denso con macollas y charcos de turba
    g.add(sptPoints(2600, (i, o) => { const a = rnd() * 6.283, r = 6 + Math.sqrt(rnd()) * 70; o.x = Math.cos(a) * r; o.z = Math.sin(a) * r; o.y = -0.1 + Math.sin(o.x * 0.3) * Math.cos(o.z * 0.25) * 0.35; o.s = 0.1 + rnd() * 0.16; o.a = 0.1 + rnd() * 0.28; o.r = 0.4 + rnd() * 0.1; o.g = 0.5 + rnd() * 0.14; o.b = 0.34 + rnd() * 0.06; }));
    g.add(sptPoints(700, (i, o) => { const c = Math.floor(rnd() * 70), a = c * 2.4, r = 10 + (c % 7) * 8 + rnd() * 2, h = rnd(); o.x = Math.cos(a) * r + (rnd() - 0.5) * 1.6; o.z = Math.sin(a) * r * 0.9 + (rnd() - 0.5) * 1.6; o.y = h * 0.9; o.s = 0.12; o.a = 0.5; o.r = 0.5; o.g = 0.62 + h * 0.15; o.b = 0.4; }));      // macollas de paja
    // bosque de frailejones: muchos, de tres tamaños, más densos hacia el fondo
    const PL = []; for (let k = 0; k < 150; k++) { const a = rnd() * 6.283, r = 17 + Math.pow(rnd(), 0.7) * 44; if (Math.abs(Math.sin(a)) > 0.6 && Math.cos(a) < 0 && r < 28) { k--; continue; } const big = rnd(); PL.push({ x: Math.cos(a) * r, z: Math.sin(a) * r * 0.9, h: big < 0.15 ? 4.6 + rnd() * 2.2 : big < 0.5 ? 2.4 + rnd() * 1.6 : 0.8 + rnd() * 1.2 }); }
    const PER = 40;
    S.fr = sptPoints(PL.length * PER, (i, o) => { const p = PL[Math.floor(i / PER)], j = i % PER, k = p.h / 4;
      if (j < 7) { o.x = p.x; o.z = p.z; o.y = p.h * j / 6; o.s = 0.18; o.a = 0.8; o.r = 0.5; o.g = 0.42; o.b = 0.3; }
      else if (j < 14) { const a = j * 2.2 + p.x; o.x = p.x + Math.cos(a) * 0.22 * (0.5 + k); o.z = p.z + Math.sin(a) * 0.22 * (0.5 + k); o.y = p.h * (j - 7) / 7; o.s = 0.14; o.a = 0.55; o.r = 0.45; o.g = 0.36; o.b = 0.25; }   // hojas muertas del tronco
      else { const L = (j - 14) % 9, a = Math.floor((j - 14) / 9) * 1.57 + L * 0.02 + p.x, u = (0.3 + L / 8 * 1.3) * (0.55 + k * 0.6); o.x = p.x + Math.cos(a) * u * 1.2; o.z = p.z + Math.sin(a) * u * 1.2; o.y = p.h + 0.2 + Math.sin(L / 8 * 2.2) * 0.9 * (0.5 + k * 0.5) - u * 0.1; o.s = 0.16; o.a = 0.75; o.r = 0.72; o.g = 0.8; o.b = 0.7; } });
    g.add(S.fr);
    const BIG = PL.filter(p => p.h > 2.4);
    S.flow = sptPoints(BIG.length * 3, (i, o) => { const p = BIG[Math.floor(i / 3)], j = i % 3; o.x = p.x + (j - 1) * 0.35; o.z = p.z + (j === 1 ? 0.3 : -0.2); o.y = p.h + 1.6 + (j === 1 ? 0.5 : 0); o.s = 0.4; o.a = 1; o.r = 1; o.g = 0.86; o.b = 0.25; });
    S.flow.material.uniforms.uOpacity.value = 0; g.add(S.flow);
    // laguna: espejo de agua con anillos y un reflejo del coloso que tiembla con la tensión
    const LX = -10, LZ = -34;
    g.add(sptPoints(700, (i, o) => { const a = rnd() * 6.283, r = Math.sqrt(rnd()); o.x = LX + Math.cos(a) * r * 17; o.z = LZ + Math.sin(a) * r * 8; o.y = 0.02; o.s = 0.18; o.a = 0.16 + rnd() * 0.12; o.r = 0.4; o.g = 0.62; o.b = 0.82; }));
    g.add(sptPoints(260, (i, o) => { const a = i / 260 * 6.283; o.x = LX + Math.cos(a) * 17.5; o.z = LZ + Math.sin(a) * 8.4; o.y = 0.05; o.s = 0.2; o.a = 0.5; o.r = 0.7; o.g = 0.85; o.b = 0.9; }));
    S.ghost = sptPoints(520, (i, o) => { const t = rnd(), k = i % 4; if (k === 0) { o.x = LX + 0.25 * t; o.y = -t * 8.6; o.z = LZ; o.s = 0.2; } else if (k === 1) { const a = rnd() * 6.283, b = rnd() * 3.14; o.x = LX + 2 + Math.sin(b) * Math.cos(a) * 2.4; o.y = -9.4 - Math.cos(b) * 2.6; o.z = LZ + Math.sin(b) * Math.sin(a) * 2.2; o.s = 0.16; } else if (k === 2) { const a = rnd() * 6.283; o.x = LX + 4.4 + Math.cos(a) * 1; o.y = -12.6 + Math.sin(a) * 1; o.z = LZ + (rnd() - 0.5); o.s = 0.16; } else { o.x = LX - 1.5 + t * 2; o.y = -9 - t * 2.4; o.z = LZ + (rnd() - 0.5) * 1.5; o.s = 0.14; } o.a = 0.45; o.r = 0.55; o.g = 0.78; o.b = 0.95; });
    g.add(S.ghost); S.ghost.userData.y0 = 0;
    // cordilleras: cinco capas con contornos y cumbres, en paralaje
    S.ridges = []; for (let L = 0; L < 5; L++) { const R = sptPoints(560, (i, o) => { const x = -130 + 260 * (i / 560); o.x = x; o.z = -62 - L * 14; const top = 9 + L * 3.2 + 7 * Math.sin(x * 0.04 + L * 2) + 3.5 * Math.sin(x * 0.12 + L) + 1.4 * Math.sin(x * 0.31 + L * 3); o.y = (i % 3 === 0) ? top - (i % 9) * 0.7 : top; o.s = 0.5; o.a = (i % 3 === 0) ? 0.1 : 0.34; o.r = 0.24 + L * 0.03; o.g = 0.34 + L * 0.03; o.b = 0.44 + L * 0.03; }); R.userData.L = L; S.ridges.push(R); g.add(R); }
    // bandas de niebla a tres profundidades + niebla suelta
    S.bands = []; for (let L = 0; L < 3; L++) { const B = sptPoints(150, (i, o) => { o.x = (rnd() - 0.5) * 130; o.y = 1.5 + L * 3.4 + rnd() * 2.2; o.z = -8 - L * 20 - rnd() * 8; o.s = 2.4 + rnd() * 2.2; o.a = 0.05 + rnd() * 0.05; o.r = 0.72; o.g = 0.8; o.b = 0.84; }); B.userData.v = 0.35 + 0.25 * (2 - L); S.bands.push(B); g.add(B); }
    S.mist = sptPoints(170, (i, o) => { o.x = (Math.random() - 0.5) * 90; o.y = Math.random() * 12; o.z = (Math.random() - 0.5) * 70; o.s = 1.2 + Math.random() * 1.6; o.a = 0.07 + Math.random() * 0.07; o.r = 0.7; o.g = 0.78; o.b = 0.82; }); g.add(S.mist);
    // llovizna: solo aparece con la tensión
    S.rain = sptPoints(420, (i, o) => { o.x = (rnd() - 0.5) * 70; o.y = rnd() * 36; o.z = (rnd() - 0.5) * 60; o.s = 0.1; o.a = 0.5; o.r = 0.7; o.g = 0.82; o.b = 0.95; }); S.rain.material.uniforms.uOpacity.value = 0; g.add(S.rain);
    // --- el frailejón milenario: un tronco ancho forrado por siglos de hojas muertas, cicatrices, líquenes, dos coronas laterales y una roseta plateada enorme ---
    S.root = new THREE.Group(); g.add(S.root);
    const rn = Math.random, YEL = [1, 0.84, 0.28], TOP = 27.5;
    let c = [];
    colTube(c, [[0, 0, 0], [0.5, 13, 0.4], [-0.2, TOP, 0]], 3200, 3.5, 2.7, (x, y, z, nx, ny, nz, lit) => { const v = 0.2 + 0.5 * lit; return [v * (0.95 + rn() * 0.15), v * 0.72, v * 0.42]; }, { fur: 0.85, s: 0.24, a: 0.8 });
    for (let k = 0; k < 14; k++) { const y = 1.8 + k * 1.8, r = 3.45 - 0.7 * (y / TOP); for (let j = 0; j < 20; j++) { const a1 = j / 20 * 6.283, a2 = (j + 1) / 20 * 6.283; colLine(c, [Math.cos(a1) * r, y + Math.sin(a1 * 3 + k) * 0.15, Math.sin(a1) * r], [Math.cos(a2) * r, y + Math.sin(a2 * 3 + k) * 0.15, Math.sin(a2) * r], 3, [0.13, 0.09, 0.07], 0.14, 0.75, 0.06); } }   // cicatrices de las hojas de cada año
    for (let k = 0; k < 420; k++) { const a = rn() * 6.283, y0 = TOP - 0.8 - rn() * 3, len = 6 + rn() * 18, r1 = 3.6 + rn() * 1.6 + len / 24 * 1.2;
      colLine(c, [Math.cos(a) * 3.0, y0, Math.sin(a) * 3.0], [Math.cos(a) * r1, y0 - len, Math.sin(a) * r1], 14, [0.5 + rn() * 0.14, 0.38, 0.22], 0.18, 0.75, 0.2); }                                  // la falda de hojas secas
    for (let k = 0; k < 360; k++) { const a = rn() * 6.283, y = 2 + rn() * (TOP - 7), r = 3.5 - 0.7 * (y / TOP) + 0.9; colPush(c, Math.cos(a) * r, y, Math.sin(a) * r, rn() < 0.5 ? [0.35, 0.62, 0.38] : [0.7, 0.72, 0.5], 0.17, 0.75); }   // líquenes y musgo
    const ros = (cx, cy, cz, n, len, per) => { for (let k = 0; k < n; k++) { const a = k / n * 6.283 + rn() * 0.1, ca = Math.cos(a), sa = Math.sin(a), ln = len * (0.75 + rn() * 0.3);
      for (let i = 0; i < per; i++) { const u = Math.pow(rn(), 0.85), w = (rn() * 2 - 1) * ln * 0.17 * Math.pow(Math.sin(Math.min(1, u * 1.05) * Math.PI), 0.55) * (0.4 + 0.6 * (1 - u)), r = ln * u, y = cy + (len / 9) * (2.8 * Math.sin(u * 1.7) - 2.4 * u * u);
        const f = 0.62 + 0.3 * rn(), sil = rn() < 0.22; colPush(c, cx + ca * r - sa * w, y + (rn() - 0.5) * 0.18, cz + sa * r + ca * w, sil ? [0.86, 0.93, 0.86] : [0.5 * f, 0.7 * f, 0.5 * f], 0.2, 0.85); } } };
    ros(0, TOP, 0, 34, 13, 110);
    [[[1.5, 16, 0.5], [6, 21, 2.5], [8.5, 24.5, 3.5], 6.2], [[-1, 18, -0.5], [-5.5, 22, -3], [-8, 25, -4.5], 5.6]].forEach(br => { colTube(c, [br[0], br[1], br[2]], 520, 1.4, 0.9, (x, y, z, nx, ny, nz, lit) => { const v = 0.2 + 0.5 * lit; return [v * 0.98, v * 0.72, v * 0.42]; }, { fur: 0.8, s: 0.2, a: 0.8 }); ros(br[2][0], br[2][1], br[2][2], 16, br[3], 70);
      for (let k = 0; k < 40; k++) { const a = rn() * 6.283, y0 = br[2][1] - 0.4 - rn() * 1.5, len = 3 + rn() * 7; colLine(c, [br[2][0] + Math.cos(a) * 1.0, y0, br[2][2] + Math.sin(a) * 1.0], [br[2][0] + Math.cos(a) * (1.6 + rn()), y0 - len, br[2][2] + Math.sin(a) * (1.6 + rn())], 10, [0.5, 0.38, 0.22], 0.17, 0.7, 0.15); } });   // coronas laterales con su propia falda
    S.root.add(colCloud(c, [0, 0, 0]));
    c = []; colShell(c, 900, 0, TOP + 0.8, 0, 4.3, 1.7, 4.3, (x, y, z, nx, ny, nz, lit) => YEL.map(v => v * (0.55 + 0.55 * lit)), { fur: 0.55, s: 0.2, a: 0.9 });            // la flor donde se posa
    S.root.add(colCloud(c, [0, 0, 0]));
    c = []; [[-9, TOP + 6.5, 3], [8, TOP + 8, -4], [2.5, TOP + 6, 9.5], [-5, TOP + 6.8, -8.5], [10.5, TOP + 5.5, 5.5], [-11, TOP + 4.5, -3], [4.5, TOP + 9.5, -9.5]].forEach(p => { colLine(c, [0, TOP + 1.5, 0], p, 22, [0.55, 0.6, 0.35], 0.15, 0.8, 0.1); colShell(c, 230, p[0], p[1], p[2], 2.1, 1.5, 2.1, (x, y, z, nx, ny, nz, lit) => YEL.map(v => v * (0.6 + 0.6 * lit)), { fur: 0.4, s: 0.2, a: 0.9 }); });
    S.bloom = colCloud(c, [0, 0, 0]); S.root.add(S.bloom); colOp(S.bloom, 0.25, 0.1);
    // --- el barbudito del páramo (Oxypogon): cresta erizada, antifaz oscuro, collar blanco y barba iridiscente ---
    S.bird = new THREE.Group(); S.bird.position.set(0, TOP + 2.3, 0); S.bird.rotation.y = -0.5; S.bird.scale.setScalar(0.45); S.root.add(S.bird); S.by0 = TOP + 2.3;
    const WH = [0.95, 0.94, 0.9];
    const body = (x, y, z, nx, ny, nz, lit) => { const e = rn();
      if (y > 5.4 && nx > -0.25 && e > 0.12) return WH.map(v => v * (0.55 + 0.5 * lit));                              // el collar blanco que baja por el pecho
      if (nx < -0.2) { const v = 0.2 + 0.42 * Math.pow(lit, 1.2), gr = rn() * 0.12; return [v * (0.85 + gr), v * (0.95 + gr * 1.6), v * 0.62]; }   // dorso oliva con brillo verde
      const v = 0.3 + 0.5 * lit; return [v * 0.92, v * 0.82, v * 0.64]; };
    c = []; colShell(c, 2300, 0, 4.9, 0, 3.2, 4.8, 2.7, body, { fur: 0.4, s: 0.2, a: 0.85 });
    for (let k = 0; k < 7; k++) colFeather(c, [-1.7, 2.7, (k - 3) * 0.4], [-0.5, -1, (k - 3) * 0.1], 4.2 + (k % 2) * 0.4, 0.34, 40, (u) => { const v = 0.18 + 0.2 * u; return [v, v, v * 1.15]; }, 0.14);   // cola
    [-1, 1].forEach(s => { colTube(c, [[0.2, 1.8, s * 0.9], [0.25, 0.8, s * 1.0], [0.2, 0.05, s * 1.1]], 70, 0.16, 0.14, () => [0.34, 0.33, 0.38], { s: 0.12 });
      for (let k = -1; k <= 1; k++) colLine(c, [0.2, 0.05, s * 1.1], [0.2 + (k === 0 ? 1.1 : -0.7), 0, s * (1.1 + k * 0.35)], 5, [0.22, 0.22, 0.26], 0.1, 0.95); });
    S.body = colCloud(c, [0, 0, 0]); S.bird.add(S.body);
    // cabeza (pivote en el cuello)
    const NP = [0.3, 8.8, 0];
    const face = (x, y, z, nx, ny, nz, lit) => { const e = rn();
      if (ny > 0.78) return [0.1 + 0.1 * lit, 0.09 + 0.1 * lit, 0.12 + 0.1 * lit];                                  // casquete negro
      if (nx > -0.3 && ny > 0.22 && ny < 0.62 && Math.abs(nz) > 0.35 && e > 0.1) return WH.map(v => v * (0.7 + 0.5 * lit));   // ceja blanca
      if (y < 9.7 && e > 0.2) return WH.map(v => v * (0.55 + 0.5 * lit));                                           // garganta
      if (nx < -0.45) { const v = 0.28 + 0.3 * lit; return [v * 0.9, v * 0.85, v * 0.7]; }
      return [0.09 + 0.14 * lit, 0.08 + 0.12 * lit, 0.1 + 0.14 * lit]; };                                           // antifaz oscuro
    c = []; colShell(c, 760, 1.0, 10.5, 0, 2.3, 2.2, 2.1, face, { fur: 0.22, s: 0.17, a: 0.9 });
    colTube(c, [[3.1, 10.3, 0], [5.6, 10.0, 0], [8.6, 9.5, 0]], 190, 0.24, 0.05, (x, y, z, nx, ny, nz, lit) => [0.28 + 0.4 * lit, 0.29 + 0.4 * lit, 0.34 + 0.4 * lit], { s: 0.13, a: 0.95 });   // pico largo y fino
    [-1, 1].forEach(s => { colShell(c, 16, 2.55, 10.7, s * 1.55, 0.42, 0.42, 0.28, () => [0.02, 0.02, 0.04], { s: 0.3, a: 1 }); colPush(c, 2.9, 11.0, s * 1.4, [1, 1, 1], 0.1, 1); });       // ojos con destello
    S.head = colCloud(c, NP, [0, 0, 0]); S.bird.add(S.head);
    // cresta: cinco púas negras con la punta blanca
    c = []; for (let k = 0; k < 5; k++) { const z = (k - 2) * 0.32, b = [1.3 - k * 0.3, 12.5, z], m = [0.5 - k * 0.55, 14.5 - k * 0.15, z * 1.4], t = [-1.2 - k * 0.95, 17 - k * 0.7, z * 2];
      colTube(c, [b, m, t], 90, 0.3, 0.04, (x, y, z2, nx, ny, nz, lit, u) => (u > 0.7 ? [0.95, 0.95, 0.92] : [0.12 + 0.12 * lit, 0.12 + 0.12 * lit, 0.15 + 0.12 * lit]), { s: 0.12, a: 0.95 }); }
    S.crest = colCloud(c, [0.6, 12.3, 0], NP); S.head.add(S.crest);
    // barba iridiscente (verde, azul y blanco)
    c = []; colTube(c, [[2.3, 9.2, 0], [2.8, 7.2, 0], [3.4, 4.6, 0]], 300, 0.6, 0.1, (x, y, z, nx, ny, nz, lit, u) => (nz > 0.55 && rn() > 0.3) ? [0.95, 0.97, 1] : colMix(colMix([0.15, 0.95, 0.5], [0.2, 0.7, 1], Math.min(1, u * 1.6)), [0.85, 0.95, 1], Math.max(0, u - 0.7) * 3), { s: 0.14, a: 0.95 });
    S.beard = colCloud(c, [2.3, 9.2, 0], NP); S.head.add(S.beard);
    // alas (pivote en el hombro): se pliegan como una capa y se abren al chillar
    S.wings = [-1, 1].map(s => {
      const wc = [], dk = (u) => { const v = 0.22 + 0.3 * (1 - u); return [v * 0.95, v * 0.9, v * 0.7]; };
      colShell(wc, 320, -0.3, 7.5, s * 4.8, 1.7, 0.5, 3.1, (x, y, z, nx, ny, nz, lit) => { const v = 0.22 + 0.4 * lit; return [v * 0.9, v * 0.95, v * 0.62]; }, { fur: 0.2, s: 0.16, keep: (nx, ny) => ny > -0.3 });
      for (let k = 0; k < 13; k++) { const zr = s * (1.4 + k * 0.5), a = k * 0.05; colFeather(wc, [-0.7, 7.5, zr], [-Math.cos(a), -0.02, s * Math.sin(a) * 1.2], 3.2 + k * 0.1, 0.4, 40, (u) => dk(u), 0.13); }
      const wg = colCloud(wc, [-0.3, 7.5, s * 2.7], [0, 0, 0]); wg.rotation.x = s * 1.35; wg.scale.z = 0.35; S.bird.add(wg); return wg; });
    S.eyes = [-1, 1].map(s => { const h = mkHalo(0xbfe6ff, 1.6, 0.0); h.position.set(2.8 - NP[0], 11 - NP[1], s * 1.45); S.head.add(h); return h; });
    S.sig = mkHalo(0xbfe6ff, 36, 0.08); S.sig.position.set(0, TOP + 7, 0); S.root.add(S.sig);
    // --- las tres voces: la familia, el agua y la máquina ---
    const FIGP = [[0, 0, -20], [-17.5, 0, 10], [17.5, 0, 10]];
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Group(); f.position.set(FIGP[i][0], 0, FIGP[i][2]); g.add(f);
      const ps = [];
      if (i === 0) { ps.push(trtBlob(sptPoints, 70, 0, 1.6, 0, 0.6, 1.5, 0.6, [1, 0.6, 0.45], 0.14, 0.8), trtBlob(sptPoints, 40, 0, 3.5, 0, 0.55, 0.55, 0.55, [1, 0.6, 0.45], 0.13, 0.85));
        ps.push(sptPoints(48, (k, o) => { const a = k / 48 * 6.283; o.x = Math.cos(a) * 1.25; o.z = Math.sin(a) * 1.25; o.y = 3.95; o.s = 0.13; o.a = 0.9; o.r = 1; o.g = 0.6; o.b = 0.45; }), sptPoints(14, (k, o) => { const a = k / 14 * 6.283; o.x = Math.cos(a) * 0.55; o.z = Math.sin(a) * 0.55; o.y = 4.3 + (k % 2) * 0.25; o.s = 0.12; o.a = 0.9; o.r = 1; o.g = 0.6; o.b = 0.45; })); }       // campesina con sombrero
      else if (i === 1) { for (let r = 1; r <= 3; r++) ps.push(sptPoints(r * 22, (k, o) => { const a = k / (r * 22) * 6.283; o.x = Math.cos(a) * r * 1.1; o.z = Math.sin(a) * r * 1.1; o.y = 0.1; o.s = 0.13; o.a = 0.85; o.r = 1; o.g = 0.6; o.b = 0.45; }));
        ps.push(sptPoints(46, (k, o) => { const u = k / 45; o.x = Math.sin(u * 9) * 0.3 * (1 - u); o.z = Math.cos(u * 9) * 0.3 * (1 - u); o.y = 0.2 + u * 3.6; o.s = 0.15; o.a = 0.9; o.r = 1; o.g = 0.6; o.b = 0.45; })); }                                                                                          // el agua
      else { const bx = (k, o) => { const ax = Math.floor(Math.random() * 3), sg = Math.random() < 0.5 ? -1 : 1; let u = Math.random() * 2 - 1, v = Math.random() * 2 - 1; if (Math.random() < 0.5) { u = Math.round(u * 3) / 3; v = Math.round(v * 3) / 3; } const q = [0, 0, 0]; q[ax] = sg; q[(ax + 1) % 3] = u; q[(ax + 2) % 3] = v; o.x = q[0] * 1.5; o.y = 2.2 + q[1] * 1.3; o.z = q[2] * 1.5; o.s = 0.13; o.a = 0.85; o.r = 1; o.g = 0.6; o.b = 0.45; };
        ps.push(sptPoints(300, bx), sptPoints(16, (k, o) => { o.x = 0; o.y = 3.6 + k * 0.12; o.z = 0; o.s = 0.12; o.a = 0.9; o.r = 1; o.g = 0.6; o.b = 0.45; }), sptPoints(18, (k, o) => { const a = k / 18 * 6.283; o.x = Math.cos(a) * 0.9; o.y = 5.5; o.z = Math.sin(a) * 0.9; o.s = 0.13; o.a = 0.9; o.r = 1; o.g = 0.6; o.b = 0.45; })); }   // la máquina: una caja de puntos con antena
      ps.forEach(p => f.add(p));
      const halo = mkHalo(0xff8a5c, 5, 0.3); halo.position.set(0, 2.4, 0); f.add(halo);
      const lamp = sptPoints(1, (k, o) => { o.x = 0.9; o.y = 2.2; o.z = 0; o.s = 0.4; o.a = 0; o.r = 1; o.g = 0.9; o.b = 0.6; }); f.add(lamp);
      S.figs.push({ g: f, ps, halo, lamp, base: f.position.clone() });
    }
    return S;
  },
  update(S, dt, t, calm) {
    const sw = calm ? 0 : 1; S.msgT -= dt; S.rumT -= dt; S.roarT -= dt;
    // el conflicto: lo que escuchas se calma; lo demás se tensa; quien ya se calmó ayuda a calmar a los otros
    if (!S.won) {
      for (let i = 0; i < 3; i++) {
        if (S.listen === i) S.a[i] = Math.max(0, S.a[i] - 0.16 * dt);
        else if (S.listen >= 0) S.a[i] = Math.min(1, S.a[i] + 0.035 * dt);
        for (let j = 0; j < 3; j++) if (j !== i && S.a[j] < 0.35) S.a[i] = Math.max(0, S.a[i] - 0.02 * dt);
      }
      const maxA = Math.max(...S.a); if (maxA < 0.2) { S.calmT += dt; if (S.calmT > 3) S.won = true; } else S.calmT = 0;
      if (S.listen >= 0 && S.msgT <= 0 && !S.neglMsg && S.a.some((v, i) => i !== S.listen && v > 0.9)) { S.neglMsg = true; colSub(colT('neglect'), 5); S.msgT = 5; }
      if (!S.heardMsg && S.a.some(v => v < 0.35)) { S.heardMsg = true; colSub(colT('heard'), 5); S.msgT = 5; }
    }
    const mean = (S.a[0] + S.a[1] + S.a[2]) / 3, tgt = S.won ? 0 : mean; S.agit += (tgt - S.agit) * Math.min(1, dt * 1.5);
    S.breath += dt * (0.9 + 1.6 * S.agit);
    S.down += ((S.won ? 1 : 0) - S.down) * Math.min(1, dt * 0.5);
    // su chillido: eriza la cresta, abre las alas con un zumbido y mira al cielo
    if (!S.won && S.agit > 0.5 && S.roarT <= 0) { S.roarT = 7 - 3 * S.agit + Math.random() * 2; S.rear = 1.9; colVoice('colibri', S.agit); if (!calm) shakeIntensity = Math.max(shakeIntensity, 0.25 * S.agit); if (MG.fx && !calm) MG.fx.burst(2, 24, 0, 6, 1.6, 1.6, 0xdff0d0, 0.3, 0.9); }
    S.rear = Math.max(0, S.rear - dt); S.rp += ((S.rear > 0 ? 1 : 0) - S.rp) * Math.min(1, dt * 4);
    const rp = S.rp * (0.4 + 0.6 * S.agit), calmK = 1 - S.agit, q = Math.max(rp, 0.12 * S.agit);
    S.crest.rotation.z = -0.6 * S.agit * (1 - S.down) + 0.3 * calmK;
    S.wings.forEach((w, k) => { const s = k ? 1 : -1; w.rotation.x = s * (1.35 - 1.95 * q) + s * Math.sin(t * 34 + k) * 0.5 * rp * sw; w.scale.z = 0.35 + 0.65 * q; });
    let want = 0; if (S.listen >= 0 && !S.won) { const f = S.figs[S.listen].base, rel = Math.atan2(-f.z, f.x) - S.bird.rotation.y; want = Math.atan2(Math.sin(rel), Math.cos(rel)); want = Math.max(-1.1, Math.min(1.1, want)); } else want = Math.sin(t * 0.35) * 0.35 * sw;
    S.hy += (want - S.hy) * Math.min(1, dt * 3);
    S.head.rotation.y = S.hy + Math.sin(t * 25) * 0.03 * rp * sw; S.head.rotation.z = 0.4 * rp - 0.32 * S.down + Math.sin(S.breath * 0.6) * 0.02 * sw;
    S.beard.rotation.z = Math.sin(t * 1.3) * 0.05 * sw + 0.25 * rp; S.beard.scale.setScalar(1 + 0.1 * rp * Math.sin(t * 30) * sw);
    S.body.scale.set(1 + 0.05 * S.agit + 0.015 * Math.sin(S.breath), 1 + 0.05 * S.agit + 0.025 * Math.sin(S.breath), 1 + 0.05 * S.agit);
    S.bird.position.y = S.by0 + 1.2 * rp + Math.sin(t * 0.8) * 0.12 * sw - 0.5 * S.down; S.bird.rotation.z = -0.1 * rp;
    S.bird.position.x = (Math.random() - 0.5) * 0.25 * S.agit * sw; S.bird.position.z = (Math.random() - 0.5) * 0.25 * S.agit * sw;
    [S.body, S.head, S.crest, S.beard].concat(S.wings).forEach(p => { colTint(p, 1 + 0.16 * S.agit - 0.06 * calmK, 1 - 0.06 * S.agit + 0.04 * calmK, 1 - 0.14 * S.agit + 0.14 * calmK); colOp(p, 1, 0.22 + 0.78 * calmK); colJit(p, 0.03 + 0.16 * S.agit); });
    colOp(S.bloom, 0.25 + 0.75 * Math.pow(calmK, 1.2), 0.08 + 0.92 * Math.pow(calmK, 1.4));
    S.eyes.forEach(e => { e.material.opacity = 0.05 + 0.25 * calmK; });
    S.sig.material.opacity = 0.04 + 0.12 * calmK;
    if (S.agit > 0.45 && S.rumT <= 0) { S.rumT = 2.6; MGS.ping(1600 + 500 * S.agit, 0, 0.12, 0.012 * S.agit); }
    // el páramo responde: la niebla se espesa con la tensión y los frailejones florecen con la calma
    S.mist.material.uniforms.uOpacity.value = 0.45 + 1.4 * S.agit; S.flow.material.uniforms.uOpacity.value = Math.pow(calmK, 1.5);
    const mp = S.mist.geometry.attributes.position.array; for (let i = 0; i < mp.length; i += 3) { mp[i] += dt * (0.5 + 1.5 * S.agit) * sw; if (mp[i] > 45) mp[i] = -45; } S.mist.geometry.attributes.position.needsUpdate = true;
    S.bands.forEach(B => { B.material.uniforms.uOpacity.value = 0.5 + 1.1 * S.agit; const q = B.geometry.attributes.position.array; for (let i = 0; i < q.length; i += 3) { q[i] += dt * B.userData.v * (0.4 + S.agit) * sw; if (q[i] > 65) q[i] = -65; } B.geometry.attributes.position.needsUpdate = true; });
    S.ridges.forEach(R => { R.position.x = Math.sin(t * 0.03 + R.userData.L) * (1 + R.userData.L) * 0.6; R.material.uniforms.uOpacity.value = 0.6 + 0.5 * calmK; });
    S.rain.material.uniforms.uOpacity.value = Math.max(0, S.agit - 0.35) * 1.2;
    { const q = S.rain.geometry.attributes.position.array, fall = 22 + 14 * S.agit; for (let i = 0; i < q.length; i += 3) { q[i + 1] -= dt * fall * sw; q[i] -= dt * 3 * sw; if (q[i + 1] < 0) { q[i + 1] = 30 + Math.random() * 6; q[i] = (Math.random() - 0.5) * 70; } } S.rain.geometry.attributes.position.needsUpdate = true; }
    S.ghost.material.uniforms.uOpacity.value = 0.3 + 0.7 * calmK; S.ghost.position.x = Math.sin(t * 2.4) * 0.35 * S.agit * sw; S.ghost.scale.x = 1 + Math.sin(t * 3.1) * 0.06 * S.agit;
    S.figs.forEach((f, i) => {
      const a = S.a[i], c = a < 0.35 ? [0.6, 0.85, 1] : [1, 0.6 - 0.2 * a, 0.45 - 0.2 * a];
      f.ps.forEach(p => p.material.uniforms.uTint.value.setRGB(c[0], c[1], c[2]));
      f.g.position.x = f.base.x + (Math.random() - 0.5) * 0.25 * a * sw; f.g.position.z = f.base.z + (Math.random() - 0.5) * 0.25 * a * sw;
      f.g.scale.y += ((S.won ? 0.75 : 1) - f.g.scale.y) * Math.min(1, dt);
      f.halo.material.opacity += ((0.1 + 0.4 * a + (S.listen === i ? 0.2 : 0)) - f.halo.material.opacity) * Math.min(1, dt * 3);
      f.halo.material.color.setHex(a < 0.35 ? 0x9fd0ff : 0xff8a5c);
      f.lamp.geometry.attributes.aAlpha.array[0] += (((S.listen === i || a < 0.35) ? 1 : 0) - f.lamp.geometry.attributes.aAlpha.array[0]) * Math.min(1, dt * 3); f.lamp.geometry.attributes.aAlpha.needsUpdate = true;
    });
  },
  down(S, cx, cy) {
    if (S.won) return;
    const k = colPick(S.figs.map(f => colW(f.g, 0, 2.4, 0)), cx, cy, Math.max(70, window.innerHeight * 0.12));
    if (k >= 0) { S.listen = k; if (S.msgT <= 0) { colSub(colT('listen'), 3); S.msgT = 3; } MGS.ping(MGS.NOTES[k + 1], 0, 1.2, 0.02); vibrateDevice(8); }
  },
  up(S) { S.listen = -1; },
  hudVals(S) { const calm = S.a.filter(v => v < 0.35).length; return [Math.round((S.a[0] + S.a[1] + S.a[2]) / 3 * 100) + '%', S.listen >= 0 ? (S.listen + 1) : '–', calm + '/3', S.won ? '♪' : S.agit > 0.6 ? '!!' : '·']; }
};

// ---------- 6 · LA MEDUSA-LEVIATÁN (TouchDesigner & VR) — explorar un espacio paramétrico ----------
const COL_DIAL = [{ x: -6, hex: 0x8fe0ff }, { x: 0, hex: 0xffd28a }, { x: 6, hex: 0xe6a0d0 }];
COL_DEF.medusa = {
  iso: { yaw: 0.25, pitch: 0.2, dist: 38, tg: [0, 7, 0] }, trav: [1.55, 12], sky: [0.8, 0.6, 0.85], hud: ['FRECUENCIA', 'DENSIDAD', 'FASE', 'RESONANCIAS'], endAfter: 13, voice: 'medusa', voiceEvery: 24, plate: ['Medusa parametrica', 'Lám. VI'],
  txt: {
    es: { title: 'LA MEDUSA-LEVIATÁN', toast: 'Su cuerpo es una función de tres perillas.',
      h: 'Toca una perilla (cian, ámbar, rosa) para girarla. Su cuerpo cambia con cada valor; cuando una combinación resuena, canta. Hay tres. Arrastra el espacio vacío para girar.',
      s0: '…su cuerpo cambia con cada perilla…', warm: '…se calienta. Vas cerca…', cold: '…se enfría…', res: '…resuena. Una forma que se sostiene sola…', done: '…las tres formas cantan juntas. Explorar es una manera de escuchar.' },
    en: { title: 'THE LEVIATHAN JELLYFISH', toast: 'Her body is a function of three dials.',
      h: 'Tap a dial (cyan, amber, rose) to turn it. Her body changes with each value; when a combination resonates, she sings. There are three. Drag empty space to turn.',
      s0: '…her body changes with every dial…', warm: '…warmer. You are close…', cold: '…cooling…', res: '…it resonates. A shape that holds itself…', done: '…the three shapes sing together. To explore is a way of listening.' }
  },
  build(g) {
    const S = { v: [0, 0, 0], sm: [0, 0, 0], targets: [], found: [], lock: 0, lockHex: 0xffffff, warm: 0, won: false, msgT: 0, bloom: 0, lastW: 0 };
    const used = [];
    while (S.targets.length < 3) { const c = [Math.floor(Math.random() * 5), Math.floor(Math.random() * 5), Math.floor(Math.random() * 5)]; if (c.every(x => x === 0)) continue; if (used.every(u => Math.abs(u[0] - c[0]) + Math.abs(u[1] - c[1]) + Math.abs(u[2] - c[2]) >= 3)) { used.push(c); S.targets.push(c); } }
    S.NB = 900; S.bell = sptPoints(S.NB, (i, o) => { o.s = 0.17; o.a = 0.7; o.r = 0.85; o.g = 0.7; o.b = 0.95; }); g.add(S.bell);
    S.NT = 16; S.TL = 22; S.tent = sptPoints(S.NT * S.TL, (i, o) => { o.s = 0.13; o.a = 0.5; o.r = 0.85; o.g = 0.6; o.b = 0.9; }); g.add(S.tent);
    S.ring = sptPoints(120, (i, o) => { o.a = 0; o.s = 0.22; o.r = 1; o.g = 1; o.b = 1; }); g.add(S.ring);
    S.halo = mkHalo(0xcfa3c4, 26, 0.1); S.halo.position.set(0, 9, 0); g.add(S.halo);
    S.dials = COL_DIAL.map((D, k) => {
      const dg = new THREE.Group(); dg.position.set(D.x, 1.6, 14); g.add(dg); const [r, gg, b] = arRGB(D.hex);
      dg.add(sptPoints(40, (i, o) => { const a = i / 40 * 6.283; o.x = Math.cos(a) * 1.6; o.y = Math.sin(a) * 1.6; o.z = 0; o.s = 0.12; o.a = 0.6; o.r = r; o.g = gg; o.b = b; }));
      dg.add(sptPoints(5, (i, o) => { const a = -1.5708 + i * 1.2566; o.x = Math.cos(a) * 2.0; o.y = Math.sin(a) * 2.0; o.z = 0; o.s = 0.18; o.a = 0.8; o.r = r; o.g = gg; o.b = b; }));
      const needle = sptPoints(8, (i, o) => { const u = (i + 1) / 8; o.x = 0; o.y = u * 1.5; o.z = 0; o.s = 0.14 + u * 0.06; o.a = 1; o.r = 1; o.g = 1; o.b = 1; }); dg.add(needle);
      const halo = mkHalo(D.hex, 4.4, 0.15); dg.add(halo);
      return { g: dg, needle, halo };
    });
    return S;
  },
  dist(S) { let best = 99; S.targets.forEach((c, i) => { if (S.found[i]) return; best = Math.min(best, Math.abs(c[0] - S.v[0]) + Math.abs(c[1] - S.v[1]) + Math.abs(c[2] - S.v[2])); }); return best; },
  update(S, dt, t, calm) {
    const sw = calm ? 0 : 1; S.msgT -= dt; S.lock = Math.max(0, S.lock - dt * 0.25);
    for (let k = 0; k < 3; k++) S.sm[k] += (S.v[k] - S.sm[k]) * Math.min(1, dt * 3.5);
    const d = this.dist(S), warm = d >= 99 ? 1 : Math.max(0, 1 - d / 8); S.warm += (warm - S.warm) * Math.min(1, dt * 2);
    const f = S.sm[0], dn = S.sm[1], ph = S.sm[2], lobes = 2 + f, rings = 2 + dn * 1.5, tw = ph * 0.38, A = 0.16 + 0.05 * f / 4 + 0.14 * S.lock;
    const BA = S.bell.geometry.attributes, bp = BA.position.array, bc = BA.aCol.array, ba = BA.aAlpha.array, GA = 2.399963, pulse = 1 + 0.07 * Math.sin(t * 1.4) * (1 - 0.5 * S.lock), lc = arRGB(S.lockHex);
    for (let i = 0; i < S.NB; i++) {
      const u = (i + 0.5) / S.NB, th = Math.acos(1 - u * 0.97), phi = i * GA, p2 = phi + tw * th;
      const r = 6.2 * (1 + A * Math.sin(lobes * p2) * Math.sin(th * 1.6)), rr = r * Math.sin(th);
      bp[i * 3] = rr * Math.cos(phi); bp[i * 3 + 1] = 9 + r * 0.78 * Math.cos(th) * pulse; bp[i * 3 + 2] = rr * Math.sin(phi);
      const band = Math.pow(Math.abs(Math.sin(th * rings * 1.9)), 3);
      ba[i] = 0.25 + 0.65 * band + 0.2 * S.lock; const w = S.warm;
      bc[i * 3] = 0.75 + 0.2 * w + (lc[0] - 0.8) * S.lock * 0.5; bc[i * 3 + 1] = 0.62 + 0.25 * w * band + (lc[1] - 0.8) * S.lock * 0.5; bc[i * 3 + 2] = 0.95 - 0.25 * w + (lc[2] - 0.8) * S.lock * 0.5;
    }
    BA.position.needsUpdate = BA.aAlpha.needsUpdate = BA.aCol.needsUpdate = true;
    const TA = S.tent.geometry.attributes, tp = TA.position.array, ta = TA.aAlpha.array, amp = 0.5 + 0.2 * dn;
    for (let k = 0; k < S.NT; k++) { const a = k / S.NT * 6.283 + tw * 0.3, bx = Math.cos(a) * 6.0, bz = Math.sin(a) * 6.0;
      for (let j = 0; j < S.TL; j++) { const idx = k * S.TL + j, u = j / (S.TL - 1);
        tp[idx * 3] = bx * (1 - u * 0.25) + Math.sin(t * 1.1 * sw + k + u * (2 + f)) * amp * u * 2.4; tp[idx * 3 + 1] = 9 + 0.5 - u * 11; tp[idx * 3 + 2] = bz * (1 - u * 0.25) + Math.cos(t * 0.9 * sw + k * 1.3 + u * (2 + ph)) * amp * u * 2.4; ta[idx] = 0.55 * (1 - u * 0.8); } }
    TA.position.needsUpdate = TA.aAlpha.needsUpdate = true;
    S.halo.material.opacity = 0.06 + 0.2 * S.warm + 0.2 * S.lock;
    const RA = S.ring.geometry.attributes; for (let i = 0; i < 120; i++) { const a = i / 120 * 6.283 + t * 0.2 * sw; RA.position.array[i * 3] = Math.cos(a) * 7.6; RA.position.array[i * 3 + 1] = 9 + Math.sin(a * 4 + t) * 0.4; RA.position.array[i * 3 + 2] = Math.sin(a) * 7.6; RA.aAlpha.array[i] = S.lock * 0.9; RA.aCol.array[i * 3] = lc[0]; RA.aCol.array[i * 3 + 1] = lc[1]; RA.aCol.array[i * 3 + 2] = lc[2]; }
    RA.position.needsUpdate = RA.aAlpha.needsUpdate = RA.aCol.needsUpdate = true;
    S.dials.forEach((D, k) => { D.needle.rotation.z = -S.sm[k] * 1.2566; D.halo.material.opacity = 0.1 + 0.25 * S.warm; });
    if (S.won) { S.bloom += dt; S.lock = Math.max(S.lock, 0.8); }
  },
  tap(S, cx, cy) {
    if (S.won) return;
    const k = colPick(S.dials.map(D => colW(D.g, 0, 0, 0)), cx, cy, Math.max(60, window.innerHeight * 0.1)); if (k < 0) return;
    S.v[k] = (S.v[k] + 1) % 5;
    const w = (() => { const d = this.dist(S); return d >= 99 ? 1 : Math.max(0, 1 - d / 8); })();
    MGS.ping(180 + 720 * w + S.v[k] * 20, 0, 0.7, 0.025); vibrateDevice(8);
    if (w > S.lastW + 0.12 && S.msgT <= 0) { colSub(colT('warm'), 3); S.msgT = 4; } else if (w < S.lastW - 0.2 && S.msgT <= 0) { colSub(colT('cold'), 3); S.msgT = 4; } S.lastW = w;
    const hit = S.targets.findIndex((c, i) => !S.found[i] && c[0] === S.v[0] && c[1] === S.v[1] && c[2] === S.v[2]);
    if (hit >= 0) { S.found[hit] = true; S.lock = 1; S.lockHex = COL_DIAL[hit].hex; colSub(colT('res'), 5); MGS.arpeggio([0, 2, 4, 5], 0.16, 3, 0.035); MGS.bell(MGS.NOTES[hit * 2], 0.1, 3, 0.04); vibrateDevice(40); if (S.found.filter(Boolean).length >= 3) S.won = true; }
  },
  hudVals(S) { return [S.v[0] + 1 + '/5', S.v[1] + 1 + '/5', S.v[2] + 1 + '/5', S.found.filter(Boolean).length + '/3']; }
};

// estados de vitrina del modo contemplación: cada coloso muestra su mejor momento, sin juego ni final
COL_DEF.arbol.view = function(S, dt) { S.energy = 5; S.allT = 0; S.leaves.forEach(L => { L.lit += (0.95 - L.lit) * Math.min(1, dt * 0.6); }); };
COL_DEF.escarabajo.view = function(S, dt) { if (!S.vOk) { S.vOk = 1; const a = S.ph[0]; S.ph = [a, (a + 2) % 4, (a + 2) % 4, a, a, (a + 2) % 4]; } S.holdT = 0; };
COL_DEF.mariquita.view = function(S, dt) { if (!S.vOk) { S.vOk = 1; S.pool = [0, 1, 2, 3, 4, 5, 0]; } S.joined = 6.99; S.frames.forEach(F => { }); };
COL_DEF.condor.view = function(S, dt) { S.stage = 'bow'; S.hold = false; S.back = false; S.trust += (0.9 - S.trust) * Math.min(1, dt * 0.8); S.D += (9 - S.D) * Math.min(1, dt * 1.2); };
COL_DEF.colibri.view = function(S, dt) { for (let i = 0; i < 3; i++) S.a[i] += (0.12 - S.a[i]) * Math.min(1, dt * 0.7); S.listen = -1; };
COL_DEF.medusa.view = function(S, dt) { S.vT = (S.vT === undefined ? 0 : S.vT) - dt; if (S.vT <= 0) { S.vT = 8; S.vi = ((S.vi === undefined ? -1 : S.vi) + 1) % 3; S.v = S.targets[S.vi].slice(); S.lock = 1; S.lockHex = COL_DIAL[S.vi].hex; MGS.bell(MGS.NOTES[S.vi * 2], 0.1, 3, 0.04); } };

