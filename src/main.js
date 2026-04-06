import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';
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
        discard; // Hace un agujero en la malla (deja ver las estrellas)
      } else {
        gl_FragColor = vec4(color, 1.0); // Pinta el píxel de neón brillante
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
// 🔥 SISTEMA WEBXR NATIVO Y FUNCIONAL 🔥
// ==========================================
window.isARSession = false; // Variable global para el estado del visor

// 1. Instanciar botón VR oficial de Three.js
const vrButton = VRButton.createButton(renderer);
vrButton.addEventListener('click', () => { 
  window.isARSession = false; // Activa modo Realidad Virtual
});
document.body.appendChild(vrButton);

// 2. Instanciar botón AR oficial (con soporte para detección de superficies)
const arButton = ARButton.createButton(renderer, { requiredFeatures: ['hit-test'] });
arButton.addEventListener('click', () => { 
  window.isARSession = true; // Activa modo Realidad Aumentada
});
document.body.appendChild(arButton);


const renderScene = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.6, 0.6);
const composer = new EffectComposer(renderer); composer.addPass(renderScene); composer.addPass(bloomPass);

let isSoundEnabled = true; let audioCtx = null; 
function playSound(type, targetPosition = null) {
  if (type === 'laser') vibrateDevice(20);         
  if (type === 'explosion') vibrateDevice(80);     
  if (type === 'damage') vibrateDevice(300);       
  if (type === 'boss_hit') vibrateDevice(50);      
  
  if (!isSoundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    let volumeBase = 1.0; if (targetPosition) volumeBase = Math.max(0, 1 - (ship.position.distanceTo(targetPosition) / 40)); 
    if(type === 'laser') { osc.type = 'square'; osc.frequency.setValueAtTime(880, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(110, audioCtx.currentTime + 0.1); gain.gain.setValueAtTime(0.1 * volumeBase, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1); osc.start(); osc.stop(audioCtx.currentTime + 0.1); }
    else if(type === 'damage') { osc.type = 'triangle'; osc.frequency.setValueAtTime(300, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.3); gain.gain.setValueAtTime(0.4 * volumeBase, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3); osc.start(); osc.stop(audioCtx.currentTime + 0.3); }
    else if(type === 'explosion') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.3); gain.gain.setValueAtTime(0.3 * volumeBase, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3); osc.start(); osc.stop(audioCtx.currentTime + 0.3); }
    else if(type === 'levelup') { osc.type = 'sine'; osc.frequency.setValueAtTime(440, audioCtx.currentTime); osc.frequency.setValueAtTime(554, audioCtx.currentTime + 0.1); osc.frequency.setValueAtTime(659, audioCtx.currentTime + 0.2); osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.3); gain.gain.setValueAtTime(0.2, audioCtx.currentTime); gain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.3); gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6); osc.start(); osc.stop(audioCtx.currentTime + 0.6); }
    else if(type === 'boss_hit') { osc.type = 'square'; osc.frequency.setValueAtTime(150, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.2); gain.gain.setValueAtTime(0.4, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2); osc.start(); osc.stop(audioCtx.currentTime + 0.2); }
    else if(type === 'ui') { osc.type = 'square'; osc.frequency.setValueAtTime(440, audioCtx.currentTime); osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1); gain.gain.setValueAtTime(0.1, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1); osc.start(); osc.stop(audioCtx.currentTime + 0.1); }
  } catch(e) {}
}
function showSystemToast(msg, color) {
  const toast = document.getElementById('system-toast');
  if(!toast) return;
  toast.innerText = msg;
  toast.style.color = '#cc0000'; // Forzamos el rojo siempre
  toast.style.textShadow = 'none'; // 🔥 Bloqueamos el neón
  toast.classList.remove('hidden');
  toast.style.opacity = '1';
  if(window.toastTimer) clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.classList.add('hidden'), 500);
  }, 2500);
}
let isGameStarted = false; let isPaused = false; let isUIOpen = false; let shakeIntensity = 0;
document.addEventListener('visibilitychange', () => { isPaused = document.hidden; });
// ==========================================
// 🔥 MODO CONCENTRACIÓN (ATENUAR PLANETAS)
// ==========================================
function toggleCombatDimming(isCombat) {
  categoryPlanets.forEach(p => {
    if (p.material && p.material.uniforms && p.material.uniforms.color) {
      if (isCombat) {
        // Guardamos su color actual por si estaba 'visitado' o no
        if (!p.userData.preCombatColor) p.userData.preCombatColor = p.material.uniforms.color.value.getHex();
        p.material.uniforms.color.value.setHex(0x111111); // Apagar luces (Casi negro)
      } else {
        // Restaurar luces
        if (p.userData.preCombatColor) {
          p.material.uniforms.color.value.setHex(p.userData.preCombatColor);
          p.userData.preCombatColor = null; 
        } else {
          p.material.uniforms.color.value.setHex(p.userData.visited ? 0x555555 : p.userData.originalColor);
        }
      }
    }
    // Ocultar los textos de los planetas para que no distraigan
    if (p.children.length > 0) p.children[0].visible = !isCombat;
  });
  
  // Ocultar también el satélite durante el combate
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
  initSystem(false); 
});
document.getElementById('skip-btn')?.addEventListener('click', (e) => { 
  e.stopPropagation(); // 🔥 Escudo protector
  e.currentTarget.blur(); 
  initSystem(true); 
});

window.closeAllUIs = function() { 
  document.body.classList.remove('ui-active'); 
  document.getElementById('modal-overlay')?.classList.add('hidden');
  
  // 🔥 AQUÍ AGREGAMOS EL TUTORIAL A LA LISTA DE APAGADO
  document.getElementById('tutorial-ui')?.classList.add('hidden'); 
  
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
  window.closeAllUIs(); 
  document.body.classList.add('ui-active'); // 🔥 Aplica la regla CSS que destruye los botones temporalmente
  document.getElementById('modal-overlay')?.classList.remove('hidden');
  
  document.getElementById(elementId).classList.remove('hidden'); 
  isUIOpen = true; document.getElementById('bg-canvas').classList.add('canvas-blurred'); 
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
bloomPass.strength = isBloomEnabled ? 0.8 : 0; 

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
  bloomPass.strength = isBloomEnabled ? 0.8 : 0; 
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
    bloomPass.strength = isBloomEnabled ? 0.8 : 0; 
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
    showSystemToast('> MODO COMBATE ACTIVADO : PROTEGE LA NAVE <', '#ff0000');
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
    showSystemToast('> MODO EXPLORACIÓN RESTAURADO <', '#00ff00');
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

  // 2. Inyectamos nuestro Shader directamente a la tarjeta gráfica
  const planetMat = new THREE.ShaderMaterial({
    uniforms: {
      color: { value: new THREE.Color(proj.color) },
      lightDir: { value: new THREE.Vector3(1, 1, 1).normalize() } 
    },
    vertexShader: ditherShader.vertexShader,
    fragmentShader: ditherShader.fragmentShader,
    transparent: true, 
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
// 🔥 REPARACIÓN: GAME OVER BLINDADO 🔥
// ==========================================
function triggerGameOver() {
  try {
    playSound('explosion');
    createExplosion(ship.position.x, ship.position.y, ship.position.z);
    
    if(bossEntity) { scene.remove(bossEntity); bossEntity = null; }
    document.getElementById('boss-ui').classList.add('hidden');
    isBossBattle = false;
    hasFoughtBoss = false; 
    
    // 1. Mostramos el puntaje antes de reiniciar nada
    showLeaderboard();
    
    const lbTitle = document.querySelector('#leaderboard-ui h1');
    if(lbTitle) {
        lbTitle.innerText = "¡SISTEMA REINICIADO!";
        lbTitle.style.color = "#ffaa00";
    }
    
    // 2. 🔥 REINICIO TOTAL DE LA DIFICULTAD 🔥
    score = 0; 
    currentLevel = 1; // Devuelve la velocidad a la normalidad
    weaponLevel = 1; 
    playerLives = 3; 
    shipSpeed = 0.5; 
    hasShield = false;
    combatCombo = 0; // Limpia tus combos acumulados
    scrollSpeedBoost = 0; // Quita cualquier aceleración extra
    bossHealth = bossMaxHealth; // Cura al jefe para la próxima partida
    if (typeof comboTimer !== 'undefined') clearTimeout(comboTimer);
    
    if (typeof shieldMesh !== 'undefined' && shieldMesh) shieldMesh.visible = false;
    
    document.getElementById('score-value').innerText = score;
    document.getElementById('level-value').innerText = currentLevel;
    if(typeof updateLivesUI === 'function') updateLivesUI();

    // 3. Restaurar el modo exploración (Paz)
    isCombatActive = false;
    if(typeof asteroids !== 'undefined') { asteroids.forEach(a => scene.remove(a)); asteroids.length = 0; }
    if(typeof enemyProjectiles !== 'undefined') { enemyProjectiles.forEach(p => scene.remove(p)); enemyProjectiles.length = 0; }
    if(typeof fighters !== 'undefined') { fighters.forEach(f => scene.remove(f)); fighters.length = 0; }
    
    const btnCombat = document.getElementById('combat-toggle-btn');
    if(btnCombat) { btnCombat.innerText = '▶'; btnCombat.style.borderColor = '#00ff00'; btnCombat.style.color = '#00ff00'; }
    
    if(typeof toggleCombatDimming === 'function') toggleCombatDimming(false); 
  } catch (error) {
    console.error("Bloqueo evitado en GameOver:", error);
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
const FIREBASE_URL = 'https://gamelab-portafolio-default-rtdb.firebaseio.com//scores.json'; 

async function updateLeaderboardUI() {
  const list = document.getElementById('score-list');
  if(list) list.innerHTML = '<li>Estableciendo conexión satelital... 📡</li>'; 

  try {
    const response = await fetch(FIREBASE_URL);
    const data = await response.json();
    
    let scores = [];
    if (data) {
      for (let key in data) {
        scores.push(data[key]);
      }
    }

    scores.sort((a, b) => b.score - a.score);

    if (list) {
      list.innerHTML = '';
      if (scores.length === 0) {
        list.innerHTML = '<li>Aún no hay registros. ¡Sé el primero!</li>';
      } else {
        scores.slice(0, 5).forEach((s, i) => { 
          list.innerHTML += `<li style="padding: 5px 0; border-bottom: 1px dashed #333;">#${i+1} - <span style="color:#00ffff">${s.name}</span>: ${s.score} pts</li>`; 
        });
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

function startPointerDown(clientX, clientY) {
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
  
  const grabTargets = [...categoryPlanets, ...ambientWhales, ...guardianCats];
  const intersects = dragRaycaster.intersectObjects(grabTargets, true);
  
  if (intersects.length > 0) {
    let hit = intersects[0].object;
    
    // 🔥 EL BLINDAJE CONTRA EL TEXTO: Subimos en la jerarquía hasta encontrar el planeta
    while (hit && hit.parent && hit.parent.type !== 'Scene' && !grabTargets.includes(hit)) {
      hit = hit.parent;
    }
    
    if (hit && grabTargets.includes(hit)) {
      // Ignorar la Anomalía 999 si no se ha descubierto
      if (!(hit.userData.id === 999 && typeof secretDiscovered !== 'undefined' && !secretDiscovered)) {
        draggedPlanet = hit;
        
        // 🔥 MAGIA DE TRES.JS: Creamos un plano invisible mirando a la cámara para arrastrar
        const cameraDir = new THREE.Vector3();
        camera.getWorldDirection(cameraDir);
        cameraDir.negate(); 
        dragPlane.setFromNormalAndCoplanarPoint(cameraDir, draggedPlanet.position);
        
        if (dragRaycaster.intersectPlane(dragPlane, dragIntersection)) {
          dragOffset.copy(dragIntersection).sub(draggedPlanet.position);
        } else {
          dragOffset.set(0, 0, 0);
        }
        
        draggedPlanet.scale.multiplyScalar(1.2);
        if (navigator.vibrate) navigator.vibrate(50);
      }
    }
  }
}

function handlePointerMove(clientX, clientY) {
  if (draggedPlanet) {
    const deltaX = Math.abs(clientX - touchStartX);
    const deltaY = Math.abs(clientY - touchStartY);
    
    if (deltaX > 3 || deltaY > 3) isDraggingPlanet = true;

    if (isDraggingPlanet) {
      mouseNDC.x = (clientX / window.innerWidth) * 2 - 1;
      mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;
      dragRaycaster.setFromCamera(mouseNDC, camera);
      
      if (dragRaycaster.intersectPlane(dragPlane, dragIntersection)) {
        // Movimiento directo y brutal en el plano 3D, sin matemáticas de Z fallidas
        draggedPlanet.position.copy(dragIntersection).sub(dragOffset);
      }
    }
  } 
  else {
    const deltaX = Math.abs(clientX - touchStartX);
    const deltaY = Math.abs(clientY - touchStartY);
    if (deltaX > 5 || deltaY > 5) window.isDraggingCanvas = true;

    if (window.isDraggingCanvas) {
      if (isAligned) {
        targetCarouselAngle += (clientX - lastTouchX) * 0.005;
      } else {
        userGroup.rotation.y -= (clientX - lastTouchX) * 0.005;
        userGroup.rotation.x -= (clientY - lastTouchY) * 0.005;
        if(userGroup.rotation.x > 0.6) userGroup.rotation.x = 0.6;
        if(userGroup.rotation.x < -0.6) userGroup.rotation.x = -0.6;
      }
    }
  }
  lastTouchX = clientX; lastTouchY = clientY;
}

function handlePointerUp() {
  if (draggedPlanet) {
    draggedPlanet.scale.multiplyScalar(1/1.2); 
    
    if (isDraggingPlanet) {
      playSound('ui');
      window.justDropped = true; 
      
      // 🔥 LA CLAVADA PERFECTA
      if (!isAligned && draggedPlanet.userData.id !== undefined && draggedPlanet.userData.id !== 999) {
        if (!draggedPlanet.userData.randomPos) draggedPlanet.userData.randomPos = new THREE.Vector3();
        if (!draggedPlanet.userData.targetPos) draggedPlanet.userData.targetPos = new THREE.Vector3();
        
        let pIndex = categoryPlanets.indexOf(draggedPlanet);
        let sinOffset = (pIndex !== -1) ? Math.sin((Date.now()*0.001) + pIndex) * 0.5 : 0;
        
        draggedPlanet.userData.baseY = draggedPlanet.position.y - sinOffset;
        draggedPlanet.userData.randomPos.copy(draggedPlanet.position);
        draggedPlanet.userData.randomPos.y = draggedPlanet.userData.baseY;
        draggedPlanet.userData.targetPos.copy(draggedPlanet.userData.randomPos);
        
        // 🔥 GUARDAR CONSTELACIÓN AL SOLTAR EL PLANETA
        saveConstellationData();
      }
      
      setTimeout(() => window.justDropped = false, 150);
    }
    
    draggedPlanet = null;
    isDraggingPlanet = false;
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
}, {passive: true});

document.addEventListener('touchmove', (e) => { 
  if(e.touches.length > 0) { 
    handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
    let touchY = e.touches[0].clientY;
    if (!draggedPlanet && (touchStartY - touchY > 40 || touchStartY - touchY < -40)) { 
      triggerScrollExploration(); touchStartY = touchY; 
    } 
  } 
}, {passive: true});

document.addEventListener('touchend', (e) => {
  handlePointerUp();
  if (isAligned && e.changedTouches.length > 0 && !draggedPlanet && !isDraggingPlanet) {
    const touchEndX = e.changedTouches[0].clientX;
    const deltaX = touchEndX - touchStartX;
    const deltaTime = Date.now() - touchStartTime;
    const angleStep = (Math.PI * 2) / categoryPlanetData.length;

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

  if (isAligned && data.id >= 1 && data.id <= 8) {
    const pIndex = categoryPlanetData.findIndex(p => p.id === data.id);
    if (pIndex !== -1) {
      targetCarouselAngle = (Math.PI / 2) - ((pIndex / categoryPlanetData.length) * Math.PI * 2);
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
      descEl.innerHTML = textToType + '<span style="color: #00ffff;">_</span>';
      document.removeEventListener('keydown', skipHandler);
      document.getElementById('portfolio-ui').removeEventListener('click', skipHandler);
    }
  };

  const skipHandler = (e) => { if (e.type === 'keydown' && e.code !== 'Space') return; finishTyping(); };
  document.addEventListener('keydown', skipHandler);
  document.getElementById('portfolio-ui').addEventListener('click', skipHandler);

  window.typewriterTimer = setInterval(() => {
    descEl.innerHTML = textToType.substring(0, charIndex) + '<span style="animation: pulse 1s infinite; opacity: 0.8;">_</span>';
    charIndex++;
    if (charIndex > textToType.length) finishTyping();
  }, 25);
  
  const longDescEl = document.getElementById('project-long-desc'); 
  const expandBtn = document.getElementById('project-expand-btn'); 
  const linkBtn = document.getElementById('project-link'); 
  const mediaContainer = document.getElementById('project-media'); 
  
  let uiColor = data.isVoyager ? '#ff00ff' : (data.id === 99 ? '#00ffff' : '#ff00ff');
  if (data.id === 888) uiColor = '#ffaa00'; 
  if (data.color) uiColor = '#' + data.color.toString(16).padStart(6, '0');
  
  const roleEl = document.getElementById('project-role');
  if (currentRole) {
    roleEl.style.display = 'block';
    roleEl.innerHTML = `<span style="color: ${uiColor};">> ${isEn ? 'ROLE' : 'ROL'}:</span> ${currentRole.toUpperCase()}`;
  } else {
    roleEl.style.display = 'none';
  }

  const techEl = document.getElementById('project-tech-stack');
  techEl.innerHTML = '';
  if (currentTech && currentTech.length > 0) {
    techEl.style.display = 'flex';
    currentTech.forEach(tech => {
      const badge = document.createElement('span');
      badge.innerText = `[ ${tech} ]`;
      badge.style.padding = '4px 8px';
      badge.style.background = 'rgba(255,255,255,0.05)';
      badge.style.border = `1px solid ${uiColor}`;
      badge.style.color = uiColor;
      badge.style.fontSize = '0.8rem';
      badge.style.fontFamily = "'Share Tech Mono', monospace";
      techEl.appendChild(badge);
    });
  } else {
    techEl.style.display = 'none';
  }
  document.getElementById('portfolio-ui').style.borderColor = uiColor; 
  document.getElementById('project-title').style.color = uiColor;

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
      return `<video width="100%" height="100%" controls style="border: none; border-radius: 5px; background: #000; object-fit: contain;">
          <source src="${src}" type="video/mp4">${noVideoStr}</video>`;
    } else {
      return `<iframe width="100%" height="100%" src="${src}" allowfullscreen style="border: none; border-radius: 5px; background: #000;"></iframe>`;
    }
  };
  
  if (finalVideos.length > 0) {
    const vidTitle = isEn ? '> VIDEOGRAPHIC RECORD' : '> REGISTRO VIDEOGRÁFICO';
    contenidoExpandido += `<h3 style="color: ${uiColor}; border-bottom: 1px dashed ${uiColor}; padding-bottom: 5px; margin-top: 10px; text-align: left;">${vidTitle}</h3>`;
    
    if (finalVideos.length === 1) {
      contenidoExpandido += `<div style="width: 100%; aspect-ratio: 16/9; margin-bottom: 10px; border-radius: 5px; border: 1px solid #333;">${renderVideoElement(finalVideos[0])}</div>`;
    } else {
      const vidCounter = isEn ? `Video 1 of ${finalVideos.length}` : `Video 1 de ${finalVideos.length}`;
      contenidoExpandido += `
        <div style="position: relative; width: 100%; aspect-ratio: 16/9; margin-bottom: 5px; background: #111; border-radius: 5px; border: 1px solid #333; display: flex; align-items: center; justify-content: center;">
          <button id="btn-prev-vid" style="position: absolute; left: 0; top: 50%; transform: translateY(-50%); z-index: 10; background: ${uiColor}; color: #000; border: none; padding: 15px 5px; cursor: pointer; font-weight: bold; opacity: 0.8;">&lt;</button>
          <div id="video-content-wrapper" style="width: 100%; height: 100%; z-index: 5;">${renderVideoElement(finalVideos[0])}</div>
          <button id="btn-next-vid" style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); z-index: 10; background: ${uiColor}; color: #000; border: none; padding: 15px 5px; cursor: pointer; font-weight: bold; opacity: 0.8;">&gt;</button>
        </div>
        <div id="video-counter" style="color: #aaa; font-size: 0.8rem; text-align: center; margin-bottom: 15px; font-family: monospace;">${vidCounter}</div>
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

mediaContainer.innerHTML = `<img id="gallery-img" src="${finalGallery[0]}" loading="lazy" style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in;">`;  if (finalGallery.length > 0) {
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
      mediaContainer.innerHTML = `<img id="gallery-img" src="${finalGallery[0]}" style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in;" title="${tooltipStr}">`;
      document.getElementById('gallery-img').onclick = toggleFullscreen;
    } else {
      window.currentGallery = finalGallery; 
      window.currentGalleryIndex = 0; 
      mediaContainer.innerHTML = `
        <button class="carousel-btn left" id="btn-prev" style="position:absolute; left:10px; z-index:10; background:${uiColor}; color:#000; border:none; padding:10px; cursor:pointer;">&#10094;</button>
        <img id="gallery-img" src="${window.currentGallery[0]}" style="max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in;" title="${tooltipStr}">
        <button class="carousel-btn right" id="btn-next" style="position:absolute; right:10px; z-index:10; background:${uiColor}; color:#000; border:none; padding:10px; cursor:pointer;">&#10095;</button>
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
    prevBtn.onmouseover = () => prevBtn.style.color = uiColor;
    prevBtn.onmouseout = () => prevBtn.style.color = '#888';
    nextBtn.onmouseover = () => nextBtn.style.color = uiColor;
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
    playSound('levelup');
    setTimeout(() => {
      openProjectPopup(data);
      targetFov = 75; 
      window.isZooming = false;
    }, 350); 
  };

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
      const models = [voyagerModelTemplate, whaleModelTemplate, gamberModelTemplate, chaplinModelTemplate];
      const activeModel = models[arModelIndex % models.length]; 
      
      if (activeModel) {
        const clone = activeModel.clone();
        clone.position.setFromMatrixPosition(reticle.matrix);
        if(arModelIndex % models.length === 1) clone.scale.set(0.05, 0.05, 0.05);
        else clone.scale.set(0.15, 0.15, 0.15);
        
        scene.add(clone);
        window.spawnedObjects.push(clone); 
        playSound('levelup', clone.position);
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

const reticle = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x00ff00 })); 
reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

let hitTestSource = null; let hitTestSourceRequested = false;

renderer.xr.addEventListener('sessionstart', () => { 
  isGameStarted = true;
  renderer.setRenderTarget(null); 
  
  // 🔥 NUEVO: Lógica de botones AR/VR
  currentXRSession = renderer.xr.getSession(); 
  if (window.isARSession) {
    if (customArBtn) customArBtn.innerText = 'SALIR AR';
    if (customVrBtn) customVrBtn.style.display = 'none';
  } else {
    if (customVrBtn) customVrBtn.innerText = 'SALIR VR';
    if (customArBtn) customArBtn.style.display = 'none';
  }
  if (xrSeparator) xrSeparator.style.display = 'none';
  // 🔥 FIN NUEVO

  document.querySelector('.crt-overlay').style.display = 'none'; 
  window.closeAllUIs(); 
  if(document.getElementById('start-screen')) document.getElementById('start-screen').style.display = 'none'; 
  if(document.getElementById('portfolio-header')) document.getElementById('portfolio-header').style.display = 'none';
  if(document.getElementById('unified-hud')) document.getElementById('unified-hud').style.display = 'none';
  if(document.getElementById('universe-legend')) document.getElementById('universe-legend').style.display = 'none';

  if (document.getElementById('touch-controls')) document.getElementById('touch-controls').style.display = 'none';
  if (document.getElementById('combat-toggle-btn')) document.getElementById('combat-toggle-btn').style.display = 'none';
  if (document.getElementById('menu-toggle')) document.getElementById('menu-toggle').style.display = 'none';

  const session = renderer.xr.getSession();
  
  if (window.isARSession) { 
    scene.background = null;
    particlesMesh.visible = false; ship.visible = false; satelliteGroup.visible = false; 
    if(typeof constellationLine !== 'undefined') constellationLine.visible = false;
    categoryPlanets.forEach(p => p.visible = false); 
    asteroids.forEach(a => a.visible = false); 
    ambientWhales.forEach(w => w.visible = false);
    discoveredVoyagers.forEach(v => v.visible = false);
    guardianCats.forEach(c => c.visible = false);
    scrollKeywords.forEach(k => k.visible = false);
    if(bossEntity) bossEntity.visible = false;
    
    userGroup.position.set(0, 0, 0);
  } else { 
    userGroup.position.set(0, 0, 15); ship.position.set(0, -3, 0); ship.scale.set(0.3, 0.3, 0.3); 
  }
});

renderer.xr.addEventListener('sessionend', () => { 
  window.isARSession = false;

  // Lógica de botones AR/VR
  if (typeof currentXRSession !== 'undefined') currentXRSession = null; 
  if (typeof customVrBtn !== 'undefined' && customVrBtn) customVrBtn.innerText = 'VR';
  if (typeof customArBtn !== 'undefined' && customArBtn) customArBtn.innerText = 'AR';
  if (typeof checkXRSupport === 'function') checkXRSupport();

  document.querySelector('.crt-overlay').style.display = 'block'; 

  if(document.getElementById('portfolio-header')) document.getElementById('portfolio-header').style.display = 'block';
  if(document.getElementById('unified-hud')) document.getElementById('unified-hud').style.display = 'flex';
  if(document.getElementById('universe-legend')) document.getElementById('universe-legend').style.display = 'block';
  if (document.getElementById('menu-toggle')) document.getElementById('menu-toggle').style.display = 'flex';
  if (document.getElementById('combat-toggle-btn')) document.getElementById('combat-toggle-btn').style.display = 'flex';

  particlesMesh.visible = true; ship.visible = true; satelliteGroup.visible = true; 
  categoryPlanets.forEach(p => p.visible = true); asteroids.forEach(a => a.visible = true);
  ambientWhales.forEach(w => w.visible = true); discoveredVoyagers.forEach(v => v.visible = true);
  guardianCats.forEach(c => c.visible = true); scrollKeywords.forEach(k => k.visible = true);
  if(typeof bossEntity !== 'undefined' && bossEntity) bossEntity.visible = true;
  
  isShooting = false;
  
  // 🔥 ARREGLO VR: Protegemos el reseteo de la cámara dentro del retraso de 300ms
  setTimeout(() => {
    renderer.xr.isPresenting = false; 
    renderer.setRenderTarget(null); 
    
    // 1. Reseteo puro de cámara
    camera.fov = 75; camera.quaternion.identity(); 
    camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0); 
    
    // 2. Reseteo inteligente del grupo (Respeta si estás en móvil o PC)
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    userGroup.position.set(0, 0, (isTouch || window.innerWidth < 600) ? 30 : 50); 
    userGroup.rotation.set(0,0,0);
    
    // 3. Reseteo de la nave
    ship.position.set(0, -15, 0); ship.scale.set(0.6, 0.6, 0.6); 
    
    camera.aspect = window.innerWidth / window.innerHeight; 
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight); 
    if (typeof composer !== 'undefined') composer.setSize(window.innerWidth, window.innerHeight);
    
    const canvas = document.getElementById('bg-canvas');
    if (canvas) {
      canvas.style.display = 'block';
      canvas.style.opacity = '1';
    }

    let retries = 0;
    const recoveryInterval = setInterval(() => {
      window.dispatchEvent(new Event('resize'));
      retries++;
      if (retries > 10) clearInterval(recoveryInterval); 
    }, 100);

  }, 300); 
});
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); composer.setSize(window.innerWidth, window.innerHeight); });

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
const constellationMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.2 });
const constellationPositions = new Float32Array(categoryPlanets.length * 3);
const constellationGeo = new THREE.BufferGeometry();
constellationGeo.setAttribute('position', new THREE.BufferAttribute(constellationPositions, 3));
const constellationLine = new THREE.Line(constellationGeo, constellationMat);
scene.add(constellationLine);

let frames = 0; let lastTime = performance.now(); let lowFPSCount = 0;
let totalRotated = 0; let prevAngle = 0;

renderer.setAnimationLoop((timestamp, frame) => {
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

  if (isAR && frame) {
    const referenceSpace = renderer.xr.getReferenceSpace(); 
    if (!hitTestSourceRequested) { session.requestReferenceSpace('viewer').then((refSpace) => { session.requestHitTestSource({ space: refSpace }).then((source) => { hitTestSource = source; }); }); session.addEventListener('end', () => { hitTestSourceRequested = false; hitTestSource = null; reticle.visible = false; }); hitTestSourceRequested = true; }
    if (hitTestSource) { const hitTestResults = frame.getHitTestResults(hitTestSource); if (hitTestResults.length > 0) { const hit = hitTestResults[0]; reticle.visible = true; reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix); } else { reticle.visible = false; } }
  }

  if (!isAR) {
    if(isGameStarted && !isUIOpen && !isXR) { 
      raycaster.setFromCamera(mouseNDC, camera); 
      const intersects = raycaster.intersectObjects([...categoryPlanets, ...discoveredVoyagers, ...ambientWhales, ...guardianCats, satHitbox, ...asteroids], true); 
      const canvasEl = document.getElementById('bg-canvas');
      if(canvasEl) canvasEl.style.cursor = intersects.length > 0 ? 'pointer' : 'crosshair';

      if (intersects.length > 0 && !intersects[0].object.userData.isAsteroid) {
        let obj = intersects[0].object;
        if (obj.type === 'Sprite') obj = obj.parent;
        while(obj.parent && obj.parent.type === 'Group') obj = obj.parent; 
        
        if (window.hoveredObject !== obj) {
          if (window.hoveredObject) {
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
      } else {
        if (window.hoveredObject) {
          if (window.hoveredObject.userData.baseScaleVector) {
            window.hoveredObject.scale.copy(window.hoveredObject.userData.baseScaleVector);
          }
          window.hoveredObject = null;
        }
      }
    }

    let pX = typeof mouseX !== 'undefined' ? mouseX : 0;
    let pY = typeof mouseY !== 'undefined' ? mouseY : 0;
    const parallaxSpeed = isUIOpen ? 0.002 : 0.02; 
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
             hasFoughtBoss = true; isBossBattle = false; playSound('explosion'); createExplosion(bossEntity.position.x, bossEntity.position.y, bossEntity.position.z); 
             
             let bossBonus = 500 + (typeof combatCombo !== 'undefined' ? combatCombo * 10 : 0);
             updateScore(bossBonus); 
             if (typeof showFloatingText === 'function') showFloatingText('+' + bossBonus + ' PTS (COMBO BONUS!)', '#ffaa00', 0, 35, 0);   
             scene.remove(bossEntity); bossEntity = null;       
             document.getElementById('boss-ui').classList.add('hidden'); 
             
             isCombatActive = false; asteroids.forEach(a => scene.remove(a)); asteroids.length = 0; 
             enemyProjectiles.forEach(p => scene.remove(p)); enemyProjectiles.length = 0; fighters.forEach(f => scene.remove(f)); 
             fighters.length = 0;
             const btnCombat = document.getElementById('combat-toggle-btn'); if(btnCombat) { btnCombat.innerText = '▶'; btnCombat.style.borderColor = '#00ff00'; btnCombat.style.color = '#00ff00'; }
             
             // 1. Mostramos el tablero de puntajes
             showLeaderboard(); 
             showSystemToast('AMENAZA NEUTRALIZADA. MODO EXPLORACIÓN RESTAURADO.', '#00ff00');
             if (typeof toggleCombatDimming === 'function') toggleCombatDimming(false);
             
             // 2. 🔥 REINICIO TOTAL DE LA DIFICULTAD PARA LA NUEVA PARTIDA 🔥
             score = 0;
             currentLevel = 1; // Devuelve la velocidad a la normalidad
             combatCombo = 0; // Limpia tus combos acumulados
             scrollSpeedBoost = 0; // Quita cualquier aceleración extra
             bossHealth = bossMaxHealth; // Cura al jefe para la próxima partida
             if (typeof comboTimer !== 'undefined') clearTimeout(comboTimer);
             
             // 3. Actualizamos los textos en pantalla a cero
             document.getElementById('score-value').innerText = score;
             document.getElementById('level-value').innerText = currentLevel;
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
        if (source.gamepad) {
          if (source.gamepad.axes.length >= 3) {
            const xAxis = source.gamepad.axes[2] || source.gamepad.axes[0]; 
            if (xAxis < -0.2 && ship.position.x > -25) { 
              ship.position.x -= (shipSpeed * 1.5); 
              ship.rotation.z = 0.3; 
              isVRMoving = true; 
            } 
            else if (xAxis > 0.2 && ship.position.x < 25) { 
              ship.position.x += (shipSpeed * 1.5); 
              ship.rotation.z = -0.3; 
              isVRMoving = true; 
            }
          }
          if (source.gamepad.buttons.length > 0) {
            if ((source.gamepad.buttons[0] && source.gamepad.buttons[0].pressed) || 
                (source.gamepad.buttons[4] && source.gamepad.buttons[4].pressed) || 
                (source.gamepad.buttons[5] && source.gamepad.buttons[5].pressed)) { 
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
    const planetSpeed = (isUIOpen || isAligned) ? 0.00002 : 0.0003; 
    
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
    const posAttribute = constellationGeo.attributes.position;

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

      if (typeof posAttribute !== 'undefined' && index < posAttribute.count) {
        posAttribute.setXYZ(index, planet.position.x, planet.position.y, planet.position.z);
      }
    });

    if(typeof posAttribute !== 'undefined') posAttribute.needsUpdate = true;
    if (!isAR) constellationLine.visible = !isAligned; 
  } 

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
    menuLeaderboard: "> Salón_de_Fama", // 🔥 NUEVO
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
      <p><strong style="color:#00ffff;">Nombre:</strong> Daniel [Rodriguez Garcia]</p>
      <p><strong style="color:#00ffff;">Ocupación:</strong> Profesor Diseño Interactivo | Dir. GameLab Tadeo</p>
      <p><strong style="color:#00ffff;">Background:</strong> Candidato a Doctorado en Diseño, Arte y Ciencia. Ex-coordinador MediaLab Cinemateca. Profesor de Planta Universidad Jorge Tadeo Lozano.</p>
      <p><strong style="color:#00ffff;">About:</strong> Mi preparación y experiencia se enfocan en el diseño, creación y producción de videojuegos y experiencias interactivas en el espectro de lo virtual y otras disciplinas, especialmente en su aspecto artístico y técnico, pero también en su conceptualización. Poseo una amplia experiencia en la cultura del videojuego como usuario apasionado, pero también como creador y docente, trabajando aspectos de diseño y programación en contextos de entretenimiento, y sobre todo en su uso pedagógico como herramienta de transformación social a través de los "games for change".</p>
      <p><strong style="color:#00ffff;">Skills:</strong> Game Mechanics, TouchDesigner, VR/AR, WebXR, Blender, Unity, Unreal, Godot</p>
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
    menuLeaderboard: "> Hall_of_Fame", // 🔥 NUEVO
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
      <p><strong style="color:#00ffff;">Name:</strong> Daniel [Rodriguez Garcia]</p>
      <p><strong style="color:#00ffff;">Role:</strong> Interactive Design Professor | Dir. Tadeo GameLab</p>
      <p><strong style="color:#00ffff;">Background:</strong> PhD Candidate in Design, Art and Science. Ex-coordinator at MediaLab Cinemateca. Full-time Professor at Universidad Jorge Tadeo Lozano.</p>
      <p><strong style="color:#00ffff;">About:</strong> My background and experience focus on the design, creation, and production of video games and interactive experiences in the virtual spectrum and other disciplines, especially in their artistic and technical aspects, but also in their conceptualization. I have extensive experience in video game culture as a passionate user, but also as a creator and teacher, working on design and programming aspects in entertainment contexts, and especially in its pedagogical use as a tool for social transformation through "games for change".</p>
      <p><strong style="color:#00ffff;">Skills:</strong> Game Mechanics, TouchDesigner, VR/AR, WebXR, Blender, Unity, Unreal, Godot</p>
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
  el.style.textShadow = `0 0 10px ${colorHex}`;
  el.style.fontFamily = "'Share Tech Mono', monospace";
  el.style.fontWeight = 'bold';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '9999';
  el.style.transition = 'all 1s ease-out';
  
  // Proyectar coordenadas 3D a la pantalla 2D
  const vector = new THREE.Vector3(x, y, z);
  vector.project(camera);
  const xPos = (vector.x * 0.5 + 0.5) * window.innerWidth;
  const yPos = (vector.y * -0.5 + 0.5) * window.innerHeight;
  
  el.style.left = `${xPos}px`;
  el.style.top = `${yPos}px`;
  document.body.appendChild(el);
  
  // Animar hacia arriba y desvanecer
  setTimeout(() => { el.style.top = `${yPos - 50}px`; el.style.opacity = '0'; }, 50);
  setTimeout(() => { if(el.parentNode) el.parentNode.removeChild(el); }, 1050);
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
}