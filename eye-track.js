const EYE_TRACK_ENABLED = true;
if (!EYE_TRACK_ENABLED) {
  // Kill switch active: do nothing and exit
  throw new Error('Eye Tracking Disabled'); 
}

// --- BLOCK 2: Config constants ---
const ET = {
  SPOT_INNER: window.innerWidth < 768 ? 130 : 200,  // spotlight clear radius px
  SPOT_OUTER: window.innerWidth < 768 ? 300 : 460,  // spotlight fade radius px
  OVERLAY_ALPHA: 0.42,           // darkness of peripheral dimming
  LERP: 0.07,                    // gaze smoothing (lower = smoother but laggier)
  BLINK_THRESHOLD: 0.23,         // eye aspect ratio below this = blink
  BLINK_DEBOUNCE: 900,           // ms minimum between blink toggles
  DETECTION_INTERVAL: 80,        // ms between face detection calls (≈12fps detection)
  FACE_API_CDN: 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',
  MODEL_URL: 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'
};

// --- BLOCK 3: State ---
let smoothX = 0.5, smoothY = 0.4;   // normalized gaze position
let focusPaused = false;             // blink-toggled pause state
let lastBlink = 0;                   // timestamp of last blink toggle
let fxAlpha = 0;                     // current overlay alpha (animated)
let fxTargetAlpha = ET.OVERLAY_ALPHA;
let trackingActive = false;
let animFrameId = null;
let detectionTimer = null;
let videoEl = null;
let fxCanvas = null, fxCtx = null;

// --- BLOCK 4: Library loader ---
function loadFaceAPI() {
  return new Promise((resolve, reject) => {
    if (window.faceapi) return resolve();
    
    const script = document.createElement('script');
    script.src = ET.FACE_API_CDN;
    script.async = true;
    
    const timeout = setTimeout(() => {
      script.remove();
      reject(new Error('Face-API load timeout'));
    }, 8000);

    script.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Face-API load error'));
    };
    document.head.appendChild(script);
  });
}

// --- BLOCK 5: Model loader ---
async function loadModels() {
  await faceapi.nets.tinyFaceDetector.loadFromUri(ET.MODEL_URL);
  await faceapi.nets.faceLandmark68TinyNet.loadFromUri(ET.MODEL_URL);
}

// --- BLOCK 6: Camera init ---
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 320 },
        height: { ideal: 240 }
      },
      audio: false
    });

    videoEl = document.createElement('video');
    videoEl.id = 'et-video';
    Object.assign(videoEl.style, {
      position: 'fixed', top: '-9999px', left: '-9999px',
      width: '320px', height: '240px', pointerEvents: 'none'
    });
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.srcObject = stream;
    document.body.appendChild(videoEl);

    return new Promise((resolve) => {
      videoEl.onloadeddata = () => {
        startDetectionLoop();
        resolve();
      };
    });
  } catch (e) {
    updateStatus('error');
    return Promise.reject(e);
  }
}

// --- BLOCK 7: Gaze computation from landmarks ---
function computeGaze(landmarks) {
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();

  const avg = (pts) => ({
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length
  });

  const leftCenter = avg(leftEye);
  const rightCenter = avg(rightEye);
  
  const eyeMidX = (leftCenter.x + rightCenter.x) / 2;
  const eyeMidY = (leftCenter.y + rightCenter.y) / 2;

  // Normalized (0..1) - mirrored for front camera
  const rawX = 1 - (eyeMidX / videoEl.videoWidth);
  const rawY = eyeMidY / videoEl.videoHeight;

  // Amplify and clamp
  const gazeX = Math.max(0, Math.min(1, 0.5 + (rawX - 0.5) * 2.2));
  const gazeY = Math.max(0, Math.min(1, 0.5 + (rawY - 0.5) * 2.0));

  // Smoothing
  smoothX += (gazeX - smoothX) * ET.LERP;
  smoothY += (gazeY - smoothY) * ET.LERP;
}

// --- BLOCK 8: Blink detection from landmarks ---
function getEAR(eye) {
  const dist = (p1, p2) => Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  const v1 = dist(eye[1], eye[5]);
  const v2 = dist(eye[2], eye[4]);
  const h = dist(eye[0], eye[3]);
  return (v1 + v2) / (2.0 * h);
}

function checkBlink(landmarks) {
  const leftEAR = getEAR(landmarks.getLeftEye());
  const rightEAR = getEAR(landmarks.getRightEye());
  const avgEAR = (leftEAR + rightEAR) / 2;

  if (avgEAR < ET.BLINK_THRESHOLD) {
    const now = Date.now();
    if (now - lastBlink > ET.BLINK_DEBOUNCE) {
      lastBlink = now;
      triggerBlink();
    }
  }
}

function triggerBlink() {
  // Flash effect
  fxCtx.save();
  fxCtx.globalAlpha = 0.08;
  fxCtx.fillStyle = '#D6A77A'; // warm gold
  fxCtx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);
  setTimeout(() => {
    // Flash cleanup happens in next draw loop naturally via clearRect
  }, 80);
  fxCtx.restore();

  focusPaused = !focusPaused;
  fxTargetAlpha = focusPaused ? 0 : ET.OVERLAY_ALPHA;
  updateStatus(focusPaused ? 'paused' : 'active');
}

// --- BLOCK 9: Detection loop ---
function startDetectionLoop() {
  if (detectionTimer) clearInterval(detectionTimer);
  
  detectionTimer = setInterval(async () => {
    if (!videoEl || videoEl.readyState < 2) return;
    try {
      const result = await faceapi
        .detectSingleFace(videoEl, new faceapi.TinyFaceDetectorOptions({
          inputSize: 224,
          scoreThreshold: 0.4
        }))
        .withFaceLandmarks(true);

      if (result) {
        trackingActive = true;
        if (!focusPaused) fxTargetAlpha = ET.OVERLAY_ALPHA;
        computeGaze(result.landmarks);
        checkBlink(result.landmarks);
        updateStatus(focusPaused ? 'paused' : 'active');
      } else {
        trackingActive = false;
        fxTargetAlpha = 0;
        updateStatus('searching');
      }
    } catch (e) {}
  }, ET.DETECTION_INTERVAL);

  if (!animFrameId) {
    function drawLoop() {
      drawFX();
      animFrameId = requestAnimationFrame(drawLoop);
    }
    drawLoop();
  }
}

// --- BLOCK 10: Canvas draw function ---
function drawFX() {
  // Animate alpha toward target
  fxAlpha += (fxTargetAlpha - fxAlpha) * 0.06;
  if (Math.abs(fxAlpha - fxTargetAlpha) < 0.001) fxAlpha = fxTargetAlpha;

  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  if (fxAlpha < 0.005) return;

  const px = smoothX * window.innerWidth;
  const py = smoothY * window.innerHeight;

  // 1. Dark overlay
  fxCtx.save();
  fxCtx.globalAlpha = fxAlpha;
  fxCtx.fillStyle = 'rgba(0,0,0,1)';
  fxCtx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);

  // 2. Punch clear spotlight
  const grad = fxCtx.createRadialGradient(px, py, 0, px, py, ET.SPOT_OUTER);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(ET.SPOT_INNER / ET.SPOT_OUTER, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  
  fxCtx.globalCompositeOperation = 'destination-out';
  fxCtx.fillStyle = grad;
  fxCtx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);
  fxCtx.restore();

  // 3. Gaze dot
  if (trackingActive && !focusPaused && fxAlpha > 0.1) {
    fxCtx.save();
    fxCtx.globalAlpha = Math.min(fxAlpha * 2, 0.6);
    // Outer ring
    fxCtx.beginPath();
    fxCtx.arc(px, py, 7, 0, Math.PI * 2);
    fxCtx.strokeStyle = 'rgba(214,167,122,0.5)';
    fxCtx.lineWidth = 1;
    fxCtx.stroke();
    // Inner dot
    fxCtx.beginPath();
    fxCtx.arc(px, py, 2.5, 0, Math.PI * 2);
    fxCtx.fillStyle = 'rgba(214,167,122,0.7)';
    fxCtx.fill();
    fxCtx.restore();
  }
}

// --- BLOCK 11: DOM injection ---
function injectDOM() {
  // Styles
  const style = document.createElement('style');
  style.textContent = `
    @keyframes etPulse {
      0%,100% { opacity:1; transform:scale(1); }
      50%      { opacity:0.3; transform:scale(0.6); }
    }
  `;
  document.head.appendChild(style);

  // Canvas
  fxCanvas = document.createElement('canvas');
  fxCanvas.id = 'eye-fx-canvas';
  Object.assign(fxCanvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    zIndex: '8', pointerEvents: 'none'
  });
  fxCanvas.width = window.innerWidth;
  fxCanvas.height = window.innerHeight;
  document.body.appendChild(fxCanvas);
  fxCtx = fxCanvas.getContext('2d');

  // Status UI
  const status = document.createElement('div');
  status.id = 'et-status';
  Object.assign(status.style, {
    position: 'fixed', bottom: '90px', left: '20px', zIndex: '920',
    display: 'flex', alignItems: 'center', gap: '6px',
    fontFamily: "'DM Mono', monospace", fontSize: '0.46rem', letterSpacing: '0.18em',
    color: 'rgba(214,167,122,0.5)', textTransform: 'uppercase',
    pointerEvents: 'none', opacity: '0', transition: 'opacity 0.4s'
  });
  status.innerHTML = `
    <div id="et-pip" style="width:5px; height:5px; border-radius:50%"></div>
    <span id="et-label">Eye Track · Init</span>
  `;
  document.body.appendChild(status);

  window.addEventListener('resize', () => {
    fxCanvas.width = window.innerWidth;
    fxCanvas.height = window.innerHeight;
  });
}

function updateStatus(state) {
  const pip = document.getElementById('et-pip');
  const lbl = document.getElementById('et-label');
  const sta = document.getElementById('et-status');
  if (!pip || !lbl || !sta) return;

  const states = {
    init:      { color:'rgba(214,167,122,0.3)', text:'Eye Track · Init',      pulse:false },
    active:    { color:'rgba(214,167,122,0.85)', text:'Eye Track · On',       pulse:false },
    paused:    { color:'rgba(214,167,122,0.5)', text:'Eye Track · Paused',    pulse:true  },
    searching: { color:'rgba(214,167,122,0.2)', text:'Eye Track · Searching', pulse:false },
    error:     { color:'rgba(255,100,100,0.5)', text:'Eye Track · Error',     pulse:false }
  };

  const s = states[state] || states.init;
  pip.style.background = s.color;
  pip.style.animation = s.pulse ? 'etPulse 2s infinite' : 'none';
  lbl.textContent = s.text;
  sta.style.opacity = state === 'error' ? '0' : '1';
}

// --- BLOCK 12: Cleanup on page hide ---
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (detectionTimer) clearInterval(detectionTimer);
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = null;
    fxTargetAlpha = 0;
  } else {
    if (videoEl && videoEl.srcObject) startDetectionLoop();
  }
});

// --- BLOCK 13: Full init sequence ---
window.addEventListener('load', () => {
  if (!EYE_TRACK_ENABLED) return;
  if (!navigator.mediaDevices?.getUserMedia) return;

  // Performance gate
  if (navigator.deviceMemory && navigator.deviceMemory < 2) return;
  if (navigator.connection?.effectiveType === 'slow-2g') return;

  injectDOM();
  showPermissionToast();
});

function showPermissionToast() {
  setTimeout(() => {
    if (sessionStorage.getItem('et-declined')) return;

    const toast = document.createElement('div');
    toast.id = 'et-toast';
    Object.assign(toast.style, {
      position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%) translateY(-100px)',
      zIndex: '1500', background: 'rgba(30, 22, 14, 0.95)', backdropFilter: 'blur(20px)',
      border: '1px solid rgba(214, 167, 122, 0.3)', borderRadius: '16px',
      padding: '16px 20px', fontFamily: "'Outfit', sans-serif", color: '#F3E2D0',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)', width: 'calc(100% - 40px)', maxWidth: '340px',
      transition: 'transform 0.4s cubic-bezier(0.23, 1, 0.32, 1)', textAlign: 'center'
    });
    toast.innerHTML = `
      <div style="font-size:0.9rem; margin-bottom:12px; font-weight:500;">👁 &nbsp; Eye Tracking Experience</div>
      <div style="font-size:0.65rem; color:rgba(243,226,208,0.6); margin-bottom:16px; line-height:1.5;">
        Allow camera access to enable gaze spotlight.<br/>Processed locally — never stored.
      </div>
      <div style="display:flex; justify-content:center; gap:12px; align-items:center;">
        <button id="et-enable" style="background:#D6A77A; color:#1A1410; border:none; border-radius:100px; padding:9px 24px; font-family:'DM Mono'; font-size:0.65rem; letter-spacing:0.1em; font-weight:600; cursor:pointer;">ENABLE</button>
        <button id="et-no" style="background:none; border:none; color:rgba(243,226,208,0.4); font-size:0.68rem; cursor:pointer;">No thanks</button>
      </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.style.transform = 'translateX(-50%) translateY(0)', 100);

    document.getElementById('et-enable').onclick = async (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      // 1. Remove toast and update status
      toast.remove();
      updateStatus('init');

      try {
        // 2. Prime Camera Permission IMMEDIATELY on user gesture
        // Some browsers require the camera request to be in the same event loop.
        // We request a basic stream just to trigger the permission dialog.
        const primeStream = await navigator.mediaDevices.getUserMedia({ video: true });
        // Immediately stop it to release the hardware for the real init later
        primeStream.getTracks().forEach(track => track.stop());

        // 3. Now load library and models (since we have permission primed)
        await loadFaceAPI();
        await loadModels();

        // 4. Start the real camera with config
        await startCamera();
      } catch (e) {
        console.error('[ET] Enable failed:', e);
        updateStatus('error');
      }
    };

    document.getElementById('et-no').onclick = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
      sessionStorage.setItem('et-declined', '1');
      toast.remove();
    };
  }, 4000);
}
