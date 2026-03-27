/* ─── LINE 1: KILL SWITCH ─────────────────────────────────── */
const EYE_TRACK_ENABLED = true;
if (!EYE_TRACK_ENABLED) throw new Error('[ET] Disabled');

/* ─── CONFIG ─────────────────────────────────────────────── */
const ET = {
  SPOT_INNER:       window.innerWidth < 768 ? 140 : 210,
  SPOT_OUTER:       window.innerWidth < 768 ? 310 : 480,
  OVERLAY_ALPHA:    0.44,
  LERP:             0.06,
  BLINK_EAR:        0.22,
  BLINK_DEBOUNCE:   950,
  // MediaPipe landmark indices
  L_INNER: 133, L_OUTER: 33, L_TOP: 159, L_BOT: 145, L_IRIS: 468,
  R_INNER: 362, R_OUTER: 263, R_TOP: 386, R_BOT: 374, R_IRIS: 473,
  LEFT_EYE:  [33,133,160,159,158,144,145,153],
  RIGHT_EYE: [362,263,387,386,385,373,374,380],
};

/* ─── STATE ──────────────────────────────────────────────── */
let smoothX = 0.5, smoothY = 0.38;
let focusPaused = false;
let lastBlink = 0;
let fxAlpha = 0, fxTargetAlpha = ET.OVERLAY_ALPHA;
let trackingActive = false;
let animFrameId = null;
let videoEl = null;
let fxCanvas = null, fxCtx = null;
let faceMesh = null;
let cameraStream = null;
let isProcessing = false;

// Calibration state
let isCalibrating = false;
let curCalPoint = null;
let calPoints = []; // [{x, y, rawX, rawY}]
let calLimits = { minX: 0.2, maxX: 0.8, minY: 0.2, maxY: 0.8 };

async function startCalibration() {
  isCalibrating = true;
  fxTargetAlpha = ET.OVERLAY_ALPHA;
  updateStatus('calibrating');

  const points = [
    { x: 0.15, y: 0.15, label: 'Top Left' },
    { x: 0.85, y: 0.15, label: 'Top Right' },
    { x: 0.85, y: 0.85, label: 'Bottom Right' },
    { x: 0.15, y: 0.85, label: 'Bottom Left' },
    { x: 0.5, y: 0.5, label: 'Center' }
  ];

  calPoints = [];
  for (const p of points) {
    curCalPoint = { ...p, samples: [] };
    // Wait for user to focus on the dot
    await new Promise(r => setTimeout(r, 2000));
    
    if (curCalPoint.samples.length > 5) {
      // Average the last samples for stability
      const recent = curCalPoint.samples.slice(-15);
      const avgX = recent.reduce((a, b) => a + b.x, 0) / recent.length;
      const avgY = recent.reduce((a, b) => a + b.y, 0) / recent.length;
      calPoints.push({ ...p, rawX: avgX, rawY: avgY });
    }
  }

  if (calPoints.length >= 4) {
    const rawXs = calPoints.map(p => p.rawX);
    const rawYs = calPoints.map(p => p.rawY);
    calLimits = {
      minX: Math.min(...rawXs),
      maxX: Math.max(...rawXs),
      minY: Math.min(...rawYs),
      maxY: Math.max(...rawYs)
    };
    // Add some buffer
    const padX = (calLimits.maxX - calLimits.minX) * 0.05;
    const padY = (calLimits.maxY - calLimits.minY) * 0.05;
    calLimits.minX += padX;
    calLimits.maxX -= padX;
    calLimits.minY += padY;
    calLimits.maxY -= padY;
    console.log('[ET] Calibrated:', calLimits);
  }

  curCalPoint = null;
  isCalibrating = false;
  updateStatus('active');
}

/* ─── LIBRARY LOADER ─────────────────────────────────────── */
/*
Load MediaPipe FaceMesh. It provides:
- 468 face landmarks per frame
- Iris landmarks (landmarks 468-477) for precise gaze
- Runs via WebAssembly + WebGL, works mobile/desktop
- Model streams progressively — first result in ~2-3s
*/
function loadMediaPipe() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('[ET] MediaPipe timeout')), 15000);

    // Load the camera_utils helper first, then face_mesh
    const scripts = [
      'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
      'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js'
    ];

    let loaded = 0;
    scripts.forEach(src => {
      // Check if already loaded
      if (document.querySelector(`script[src="${src}"]`)) {
        loaded++;
        if (loaded === scripts.length) { clearTimeout(timeout); resolve(); }
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      s.onload = () => {
        loaded++;
        if (loaded === scripts.length) { clearTimeout(timeout); resolve(); }
      };
      s.onerror = () => { clearTimeout(timeout); reject(new Error('[ET] Script load failed: ' + src)); };
      document.head.appendChild(s);
    });
  });
}

/* ─── CAMERA: TRIPLE FALLBACK CHAIN ─────────────────────── */
/*
Try constraints in order from strictest to most permissive.
Android devices sometimes reject facingMode or specific resolutions.
*/
async function startCamera() {
  const constraintChain = [
    // Try 1: Ideal front camera with resolution
    { video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }, audio: false },
    // Try 2: Front camera only, no resolution hint
    { video: { facingMode: 'user' }, audio: false },
    // Try 3: Any camera, no constraints (last resort)
    { video: true, audio: false }
  ];

  let stream = null;
  let lastError = null;

  for (const constraints of constraintChain) {
    try {
      console.log('[ET] Trying camera constraints:', JSON.stringify(constraints.video));
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('[ET] Camera stream obtained:', stream.getVideoTracks()[0].label);
      break; // success
    } catch (err) {
      console.warn('[ET] Camera constraint failed:', err.name, err.message);
      lastError = err;
    }
  }

  if (!stream) {
    console.error('[ET] All camera constraints failed. Last error:', lastError);
    updateStatus('error');
    throw lastError;
  }

  cameraStream = stream;

  // Build video element with ALL required attributes for cross-platform
  videoEl = document.createElement('video');
  videoEl.id = 'et-video';
  
  // CRITICAL: setAttribute for playsinline (iOS Safari ignores the property)
  videoEl.setAttribute('autoplay', '');
  videoEl.setAttribute('muted', '');
  videoEl.setAttribute('playsinline', '');  // iOS REQUIRES this as attribute
  videoEl.setAttribute('webkit-playsinline', '');  // older iOS
  
  Object.assign(videoEl.style, {
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '-1000'
  });

  videoEl.srcObject = stream;
  document.body.appendChild(videoEl);

  // Force play — required on some Android browsers
  try {
    await videoEl.play();
    console.log('[ET] Video playing, dimensions:', videoEl.videoWidth, 'x', videoEl.videoHeight);
  } catch (playErr) {
    console.warn('[ET] video.play() failed:', playErr);
  }

  // Wait for actual video data with timeout
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.warn('[ET] loadeddata timeout — proceeding anyway');
      resolve(); // don't reject, try anyway
    }, 5000);

    if (videoEl.readyState >= 2) {
      clearTimeout(timeout);
      resolve();
    } else {
      videoEl.addEventListener('loadeddata', () => {
        clearTimeout(timeout);
        console.log('[ET] Video loadeddata fired');
        resolve();
      }, { once: true });
    }
  });

  return stream;
}

/* ─── MEDIAPIPE FACEMESH INIT ────────────────────────────── */
async function initFaceMesh() {
  faceMesh = new FaceMesh({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,   // enables iris landmarks (468-477)
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  faceMesh.onResults(onFaceMeshResults);

  // Warm up — send one blank frame
  await faceMesh.initialize();
  console.log('[ET] FaceMesh initialized');
}

/* ─── FRAME PROCESSING LOOP ──────────────────────────────── */
/*
We use requestAnimationFrame to send frames to FaceMesh.
FaceMesh processes asynchronously and calls onFaceMeshResults.
isProcessing flag prevents frame queue buildup.
*/
function startFrameLoop() {
  async function sendFrame() {
    animFrameId = requestAnimationFrame(sendFrame);
    drawFX(); // always draw visual effects at 60fps

    if (!videoEl || videoEl.readyState < 2 || isProcessing) return;
    if (!faceMesh) return;

    isProcessing = true;
    try {
      await faceMesh.send({ image: videoEl });
    } catch (e) {
      console.warn('[ET] FaceMesh send error:', e);
    }
    isProcessing = false;
  }
  sendFrame();
}

/* ─── RESULTS HANDLER ────────────────────────────────────── */
function onFaceMeshResults(results) {
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    trackingActive = false;
    fxTargetAlpha = 0;
    updateStatus('searching');
    return;
  }

  trackingActive = true;
  const landmarks = results.multiFaceLandmarks[0];

  const getRel = (iris, p1, p2, top, bot) => {
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(top.y, bot.y);
    const maxY = Math.max(top.y, bot.y);
    return {
      x: (iris.x - minX) / (maxX - minX || 0.01),
      y: (iris.y - minY) / (maxY - minY || 0.01)
    };
  };

  const lG = getRel(landmarks[ET.L_IRIS], landmarks[ET.L_INNER], landmarks[ET.L_OUTER], landmarks[ET.L_TOP], landmarks[ET.L_BOT]);
  const rG = getRel(landmarks[ET.R_IRIS], landmarks[ET.R_INNER], landmarks[ET.R_OUTER], landmarks[ET.R_TOP], landmarks[ET.R_BOT]);

  const rawX = (lG.x + rG.x) / 2;
  const rawY = (lG.y + rG.y) / 2;

  if (isCalibrating && curCalPoint) {
    curCalPoint.samples.push({ x: rawX, y: rawY });
  }

  let gazeX = (rawX - calLimits.minX) / (calLimits.maxX - calLimits.minX || 0.01);
  let gazeY = (rawY - calLimits.minY) / (calLimits.maxY - calLimits.minY || 0.01);

  gazeX = Math.max(0, Math.min(1, gazeX));
  gazeY = Math.max(0, Math.min(1, gazeY));

  smoothX += (gazeX - smoothX) * ET.LERP;
  smoothY += (gazeY - smoothY) * ET.LERP;

  const leftEAR  = getEAR(landmarks, ET.LEFT_EYE);
  const rightEAR = getEAR(landmarks, ET.RIGHT_EYE);
  const avgEAR   = (leftEAR + rightEAR) / 2;

  if (avgEAR < ET.BLINK_EAR) {
    const now = Date.now();
    if (now - lastBlink > ET.BLINK_DEBOUNCE) {
      lastBlink = now;
      triggerBlink();
    }
  }

  if (!focusPaused) fxTargetAlpha = ET.OVERLAY_ALPHA;
  updateStatus(focusPaused ? 'paused' : 'active');
}

/* ─── EAR CALCULATION ────────────────────────────────────── */
/*
Eye Aspect Ratio using MediaPipe 468-point landmark indices.
Indices mapped to: [outer, top1, top2, inner, bot1, bot2, ...]
We use 6 points: corners + top/bottom pairs.
*/
function getEAR(landmarks, indices) {
  const pt = (i) => landmarks[i];
  const dist = (a, b) => Math.sqrt(
    Math.pow(a.x - b.x, 2) +
    Math.pow(a.y - b.y, 2)
  );
  // For MediaPipe eye landmark ordering:
  // indices[0]=outer corner, indices[4]=top, indices[2]=top2
  // indices[3]=inner, indices[5]=bot, indices[1]=bot2
  const v1 = dist(pt(indices[1]), pt(indices[5]));
  const v2 = dist(pt(indices[2]), pt(indices[4]));
  const h  = dist(pt(indices[0]), pt(indices[3]));
  if (h === 0) return 0.3; // prevent division by zero
  return (v1 + v2) / (2.0 * h);
}

/* ─── BLINK TRIGGER ──────────────────────────────────────── */
function triggerBlink() {
  // Warm flash
  if (fxCtx) {
    fxCtx.save();
    fxCtx.globalAlpha = 0.07;
    fxCtx.fillStyle = '#D6A77A';
    fxCtx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);
    fxCtx.restore();
  }
  focusPaused = !focusPaused;
  fxTargetAlpha = focusPaused ? 0 : ET.OVERLAY_ALPHA;
  updateStatus(focusPaused ? 'paused' : 'active');
  console.log('[ET] Blink detected, focusPaused:', focusPaused);
}

/* ─── CANVAS DRAW ────────────────────────────────────────── */
function drawFX() {
  if (!fxCtx) return;

  fxAlpha += (fxTargetAlpha - fxAlpha) * 0.05;
  if (Math.abs(fxAlpha - fxTargetAlpha) < 0.001) fxAlpha = fxTargetAlpha;

  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

  // Calibration overlay
  if (isCalibrating && curCalPoint) {
    const cx = curCalPoint.x * window.innerWidth;
    const cy = curCalPoint.y * window.innerHeight;
    fxCtx.save();
    // Pulse animation
    const pulse = 1 + Math.sin(Date.now() / 200) * 0.2;
    fxCtx.beginPath();
    fxCtx.arc(cx, cy, 12 * pulse, 0, Math.PI * 2);
    fxCtx.fillStyle = 'rgba(214,167,122,0.8)';
    fxCtx.shadowBlur = 20;
    fxCtx.shadowColor = '#D6A77A';
    fxCtx.fill();
    
    fxCtx.font = '12px DM Mono';
    fxCtx.fillStyle = '#F3E2D0';
    fxCtx.textAlign = 'center';
    fxCtx.fillText('FOCUS HERE', cx, cy + 30);
    fxCtx.restore();
    return; // Don't draw normal FX during calibration
  }

  if (fxAlpha < 0.005) return;

  const px = smoothX * window.innerWidth;
  const py = smoothY * window.innerHeight;

  // Dark peripheral overlay
  fxCtx.save();
  fxCtx.globalAlpha = fxAlpha;
  fxCtx.fillStyle = 'rgba(0,0,0,1)';
  fxCtx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);

  // Cut clear spotlight via destination-out
  const grad = fxCtx.createRadialGradient(px, py, 0, px, py, ET.SPOT_OUTER);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(ET.SPOT_INNER / ET.SPOT_OUTER, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  fxCtx.globalCompositeOperation = 'destination-out';
  fxCtx.fillStyle = grad;
  fxCtx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);
  fxCtx.restore();

  // Gaze dot
  if (trackingActive && !focusPaused && fxAlpha > 0.1) {
    fxCtx.save();
    fxCtx.globalAlpha = Math.min(fxAlpha * 2, 0.55);
    fxCtx.beginPath();
    fxCtx.arc(px, py, 8, 0, Math.PI * 2);
    fxCtx.strokeStyle = 'rgba(214,167,122,0.5)';
    fxCtx.lineWidth = 1;
    fxCtx.stroke();
    fxCtx.beginPath();
    fxCtx.arc(px, py, 2.5, 0, Math.PI * 2);
    fxCtx.fillStyle = 'rgba(214,167,122,0.65)';
    fxCtx.fill();
    fxCtx.restore();
  }
}

/* ─── DOM INJECTION ──────────────────────────────────────── */
function injectDOM() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes etPulse {
      0%,100% { opacity:1; transform:scale(1); }
      50%      { opacity:0.3; transform:scale(0.55); }
    }
    @keyframes etSpin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  fxCanvas = document.createElement('canvas');
  fxCanvas.id = 'eye-fx-canvas';
  Object.assign(fxCanvas.style, {
    position: 'fixed', inset: '0',
    width: '100%', height: '100%',
    zIndex: '8', pointerEvents: 'none'
  });
  fxCanvas.width = window.innerWidth;
  fxCanvas.height = window.innerHeight;
  document.body.appendChild(fxCanvas);
  fxCtx = fxCanvas.getContext('2d');

  window.addEventListener('resize', () => {
    fxCanvas.width = window.innerWidth;
    fxCanvas.height = window.innerHeight;
    ET.SPOT_INNER = window.innerWidth < 768 ? 140 : 210;
    ET.SPOT_OUTER = window.innerWidth < 768 ? 310 : 480;
  });

  // Status pip
  const status = document.createElement('div');
  status.id = 'et-status';
  Object.assign(status.style, {
    position: 'fixed', bottom: '90px', left: '20px', zIndex: '920',
    display: 'flex', alignItems: 'center', gap: '6px',
    fontFamily: "'DM Mono', monospace", fontSize: '0.44rem',
    letterSpacing: '0.18em', color: 'rgba(214,167,122,0.5)',
    textTransform: 'uppercase', pointerEvents: 'none',
    opacity: '0', transition: 'opacity 0.4s'
  });
  status.innerHTML = `
    <div id="et-pip" style="width:5px;height:5px;border-radius:50%;
      background:rgba(214,167,122,0.3);transition:background 0.3s;flex-shrink:0"></div>
    <span id="et-label">Eye Track · Init</span>
  `;
  document.body.appendChild(status);
}

/* ─── STATUS UPDATER ─────────────────────────────────────── */
function updateStatus(state) {
  const pip = document.getElementById('et-pip');
  const lbl = document.getElementById('et-label');
  const sta = document.getElementById('et-status');
  if (!pip || !lbl || !sta) return;
  const map = {
    init:         ['rgba(214,167,122,0.3)',  'Eye Track · Init',         false],
    loading:      ['rgba(214,167,122,0.5)',  'Eye Track · Loading',      true ],
    calibrating:  ['rgba(214,167,122,0.95)', 'Eye Track · Calibrating',  true ],
    active:       ['rgba(214,167,122,0.9)',  'Eye Track · On',           false],
    paused:       ['rgba(214,167,122,0.5)',  'Eye Track · Paused',       true ],
    searching:    ['rgba(214,167,122,0.25)', 'Eye Track · Searching',    false],
    error:        ['rgba(255,80,80,0.6)',    'Eye Track · Error',        false],
  };
  const [color, text, pulse] = map[state] || map.init;
  pip.style.background = color;
  pip.style.animation = pulse ? 'etPulse 2s infinite' : 'none';
  lbl.textContent = text;
  sta.style.opacity = state === 'error' ? '0' : '1';
}

/* ─── PERMISSION TOAST ───────────────────────────────────── */
function showPermissionToast() {
  setTimeout(() => {
    if (sessionStorage.getItem('et-declined')) return;

    const toast = document.createElement('div');
    toast.id = 'et-toast';
    Object.assign(toast.style, {
      position: 'fixed', top: '20px', left: '50%',
      transform: 'translateX(-50%) translateY(-120px)',
      zIndex: '1500',
      background: 'rgba(26, 18, 10, 0.97)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      border: '1px solid rgba(214,167,122,0.28)',
      borderRadius: '18px', padding: '18px 20px',
      fontFamily: "'Outfit', sans-serif", color: '#F3E2D0',
      boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
      width: 'calc(100% - 40px)', maxWidth: '340px',
      transition: 'transform 0.45s cubic-bezier(0.23,1,0.32,1)',
      textAlign: 'center', userSelect: 'none'
    });
    toast.innerHTML = `
      <div style="font-size:1.3rem;margin-bottom:8px;">👁</div>
      <div style="font-size:0.85rem;font-weight:500;margin-bottom:6px;">
        Eye Tracking Experience
      </div>
      <div style="font-size:0.63rem;color:rgba(243,226,208,0.55);
        margin-bottom:18px;line-height:1.6;">
        Camera used locally to spotlight where you look.<br/>
        Nothing is recorded or uploaded.
      </div>
      <div style="display:flex;justify-content:center;gap:14px;align-items:center;">
        <button id="et-enable" style="
          background:#D6A77A;color:#1A1410;border:none;
          border-radius:100px;padding:10px 26px;
          font-family:'DM Mono';font-size:0.63rem;
          letter-spacing:0.12em;font-weight:600;cursor:pointer;
          -webkit-tap-highlight-color:transparent;">
          ENABLE
        </button>
        <button id="et-no" style="
          background:none;border:none;
          color:rgba(243,226,208,0.38);
          font-size:0.7rem;cursor:pointer;padding:10px;
          -webkit-tap-highlight-color:transparent;">
          No thanks
        </button>
      </div>
    `;
    document.body.appendChild(toast);
    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.transform = 'translateX(-50%) translateY(0)';
      });
    });

    // ── ENABLE BUTTON ──────────────────────────────────────────
    document.getElementById('et-enable').addEventListener('click', async (e) => {
      e.stopPropagation();

      // Animate toast out
      toast.style.transform = 'translateX(-50%) translateY(-120px)';
      setTimeout(() => toast.remove(), 500);

      updateStatus('loading');

      try {
        console.log('[ET] Starting camera first...');
        // STEP 1: Camera FIRST (must be in user gesture context)
        await startCamera();
        console.log('[ET] Camera started. Loading MediaPipe...');
        updateStatus('loading');

        // STEP 2: Load MediaPipe scripts
        await loadMediaPipe();
        console.log('[ET] MediaPipe scripts loaded. Initializing FaceMesh...');

        // STEP 3: Init FaceMesh
        await initFaceMesh();
        console.log('[ET] FaceMesh ready. Starting frame loop...');

        // STEP 4: Start processing
        startFrameLoop();
        
        // STEP 5: Calibrate
        await startCalibration();

      } catch (err) {
        console.error('[ET] Init failed at step:', err.message || err);
        updateStatus('error');

        // Show user-friendly error
        const errToast = document.createElement('div');
        Object.assign(errToast.style, {
          position: 'fixed', top: '20px', left: '50%',
          transform: 'translateX(-50%)',
          zIndex: '1500', background: 'rgba(60,20,20,0.95)',
          backdropFilter: 'blur(16px)', border: '1px solid rgba(255,100,100,0.3)',
          borderRadius: '14px', padding: '14px 20px', color: '#ffaaaa',
          fontFamily: "'DM Mono',monospace", fontSize: '0.6rem',
          letterSpacing: '0.1em', textAlign: 'center',
          maxWidth: '300px', width: 'calc(100% - 40px)'
        });
        errToast.textContent = 'Camera could not start. Check browser permissions.';
        document.body.appendChild(errToast);
        setTimeout(() => errToast.remove(), 4000);
      }
    }, { once: true });

    document.getElementById('et-no').addEventListener('click', (e) => {
      e.stopPropagation();
      sessionStorage.setItem('et-declined', '1');
      toast.style.transform = 'translateX(-50%) translateY(-120px)';
      setTimeout(() => toast.remove(), 500);
    }, { once: true });

  }, 4000);
}

/* ─── VISIBILITY CHANGE ──────────────────────────────────── */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    fxTargetAlpha = 0;
    // Pause video track to save battery
    if (cameraStream) {
      cameraStream.getVideoTracks().forEach(t => { t.enabled = false; });
    }
  } else {
    if (cameraStream) {
      cameraStream.getVideoTracks().forEach(t => { t.enabled = true; });
    }
    if (faceMesh && videoEl) startFrameLoop();
  }
});

/* ─── MAIN INIT ──────────────────────────────────────────── */
window.addEventListener('load', () => {
  if (!EYE_TRACK_ENABLED) return;

  // API check
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn('[ET] getUserMedia not available');
    return;
  }

  // Performance gate
  if (navigator.deviceMemory && navigator.deviceMemory < 2) {
    console.warn('[ET] Low memory device, skipping eye track');
    return;
  }
  if (navigator.connection?.effectiveType === 'slow-2g') {
    console.warn('[ET] Slow connection, skipping eye track');
    return;
  }

  console.log('[ET] eye-track.js loaded and ready');
  injectDOM();
  showPermissionToast();
});
