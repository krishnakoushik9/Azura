const EYE_TRACK_ENABLED = true;

(function() {
  if (!EYE_TRACK_ENABLED) return;

  try {
    // 1. Performance & Hardware Guard
    const isLowMemory = navigator.deviceMemory && navigator.deviceMemory < 4;
    const isSlowConn = navigator.connection && (navigator.connection.effectiveType === '2g' || navigator.connection.effectiveType === 'slow-2g');
    if (isLowMemory || isSlowConn) return;

    // 2. Inject Hidden Canvas for Jeeliz
    const camCanvas = document.createElement('canvas');
    camCanvas.id = 'eye-track-canvas';
    Object.assign(camCanvas.style, {
      position: 'fixed', width: '1px', height: '1px', opacity: '0',
      zIndex: '-999', pointerEvents: 'none', top: '0', left: '0'
    });
    document.body.appendChild(camCanvas);

    // 3. Inject Visual FX Canvas
    const fxCanvas = document.createElement('canvas');
    fxCanvas.id = 'eye-fx-canvas';
    Object.assign(fxCanvas.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%',
      zIndex: '8', pointerEvents: 'none', opacity: '0', transition: 'opacity 0.6s ease'
    });
    document.body.appendChild(fxCanvas);
    const ctx = fxCanvas.getContext('2d');

    // 4. Inject Status UI
    const status = document.createElement('div');
    status.id = 'et-status';
    Object.assign(status.style, {
      position: 'fixed', bottom: '90px', left: '20px', zIndex: '920',
      display: 'flex', alignItems: 'center', gap: '6px',
      fontFamily: "'DM Mono', monospace", fontSize: '0.48rem', letterSpacing: '0.18em',
      color: 'rgba(214,167,122,0.5)', textTransform: 'uppercase',
      pointerEvents: 'none', opacity: '0', transition: 'opacity 0.4s ease'
    });
    status.innerHTML = `<div id="et-pip" style="width:5px; height:5px; border-radius:50%; background:rgba(214,167,122,0.3);"></div><span id="et-label">Eye Track · Init</span>`;
    document.body.appendChild(status);
    const pip = document.getElementById('et-pip');
    const label = document.getElementById('et-label');

    // State Variables
    let smoothX = 0.5, smoothY = 0.5;
    let isDetected = false;
    let isFocusPaused = false;
    let lastBlinkTime = 0;
    let spotlightAlpha = 0.38;
    let currentSpotlightAlpha = 0;

    function setStatus(state) {
      status.style.opacity = '1';
      pip.style.animation = 'none';
      if (state === 'active') {
        pip.style.background = 'rgba(214,167,122,0.8)';
        label.textContent = 'Eye Track · On';
      } else if (state === 'paused') {
        pip.style.background = 'rgba(214,167,122,0.5)';
        pip.style.animation = 'breathe 2s infinite';
        label.textContent = 'Eye Track · Paused';
      } else if (state === 'searching') {
        pip.style.background = 'rgba(214,167,122,0.2)';
        label.textContent = 'Eye Track · Searching';
      }
    }

    // 5. Draw Loop
    function draw() {
      const W = fxCanvas.width = window.innerWidth;
      const H = fxCanvas.height = window.innerHeight;
      
      if (!isDetected) {
        fxCanvas.style.opacity = '0';
        requestAnimationFrame(draw);
        return;
      }

      fxCanvas.style.opacity = '1';
      ctx.clearRect(0, 0, W, H);

      if (!isFocusPaused) {
        // Spotlight Alpha Lerp
        currentSpotlightAlpha += (spotlightAlpha - currentSpotlightAlpha) * 0.1;

        // 1. Spotlight Overlay
        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${currentSpotlightAlpha})`;
        ctx.fillRect(0, 0, W, H);

        const x = smoothX * W;
        const y = smoothY * H;
        const innerRad = W < 768 ? 120 : 180;
        const outerRad = W < 768 ? 280 : 420;

        const grad = ctx.createRadialGradient(x, y, innerRad, x, y, outerRad);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, outerRad, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 2. Gaze Dot
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(214,167,122,0.18)';
        ctx.lineWidth = 1;
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = 'rgba(214,167,122,0.55)';
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(draw);
    }

    // 6. Initialize Jeeliz
    function initTracker() {
      const script = document.createElement('script');
      script.src = 'https://appsFaceFilter.jeeliz.com/dist/jeelizFaceFilterES6.js';
      script.type = 'module';
      script.onload = () => {
        import('https://appsFaceFilter.jeeliz.com/dist/jeelizFaceFilterES6.js').then(module => {
          const JFF = module.JEELIZFACEFILTER;
          JFF.init({
            canvasId: 'eye-track-canvas',
            NNCPath: 'https://appsFaceFilter.jeeliz.com/dist/NNC.json',
            callbackReady: (err) => {
              if (err) { status.style.opacity = '0'; return; }
              setStatus('searching');
              requestAnimationFrame(draw);
            },
            callbackTrack: (data) => {
              isDetected = data.detected;
              if (isDetected) {
                // Gaze estimation via head rotation
                const gazeX = Math.max(0, Math.min(1, 0.5 + data.ry * 1.2));
                const gazeY = Math.max(0, Math.min(1, 0.5 - data.rx * 1.4));
                smoothX += (gazeX - smoothX) * 0.08;
                smoothY += (gazeY - smoothY) * 0.08;

                // Blink Detection (both eyes > 0.6)
                const now = Date.now();
                if (data.expressions[3] > 0.6 && data.expressions[4] > 0.6 && now - lastBlinkTime > 800) {
                  lastBlinkTime = now;
                  isFocusPaused = !isFocusPaused;
                  setStatus(isFocusPaused ? 'paused' : 'active');
                  
                  // Blink Flash
                  ctx.save();
                  ctx.fillStyle = 'rgba(214,167,122,0.06)';
                  ctx.fillRect(0, 0, fxCanvas.width, fxCanvas.height);
                  setTimeout(() => ctx.clearRect(0,0,fxCanvas.width,fxCanvas.height), 80);
                  ctx.restore();
                }
                if (!isFocusPaused) setStatus('active');
              } else {
                setStatus('searching');
              }
            }
          });
        }).catch(() => status.style.opacity = '0');
      };
      script.onerror = () => status.style.opacity = '0';
      document.head.appendChild(script);
      
      // Safety timeout for CDN
      setTimeout(() => { if (label.textContent === 'Eye Track · Init') status.style.opacity = '0'; }, 5000);
    }

    // 7. Permission UI Toast
    setTimeout(() => {
      if (sessionStorage.getItem('et-declined')) return;

      const toast = document.createElement('div');
      toast.id = 'et-toast';
      Object.assign(toast.style, {
        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%) translateY(-100px)',
        zIndex: '950', background: 'rgba(30, 22, 14, 0.92)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(214, 167, 122, 0.22)', borderRadius: '16px',
        padding: '16px 20px', fontFamily: "'Outfit', sans-serif", color: '#F3E2D0',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)', width: 'calc(100% - 40px)', maxWidth: '340px',
        transition: 'transform 0.4s ease-out', textAlign: 'center'
      });
      toast.innerHTML = `
        <div style="font-size:0.9rem; margin-bottom:12px;">👁 &nbsp; Enable Eye Tracking Experience</div>
        <div style="font-size:0.65rem; color:rgba(243,226,208,0.6); margin-bottom:16px; line-height:1.5;">
          We use your camera locally — never uploaded or stored anywhere.
        </div>
        <div style="display:flex; justify-content:center; gap:12px; align-items:center;">
          <button id="et-enable" style="background:#D6A77A; color:#1A1410; border:none; border-radius:100px; padding:8px 20px; font-family:'DM Mono'; font-size:0.62rem; letter-spacing:0.14em; cursor:pointer;">ENABLE</button>
          <button id="et-no" style="background:none; border:none; color:rgba(243,226,208,0.4); font-size:0.68rem; cursor:pointer;">No thanks</button>
        </div>
      `;
      document.body.appendChild(toast);
      setTimeout(() => toast.style.transform = 'translateX(-50%) translateY(0)', 100);

      document.getElementById('et-enable').onclick = () => {
        toast.remove();
        initTracker();
      };
      document.getElementById('et-no').onclick = () => {
        toast.remove();
        sessionStorage.setItem('et-declined', '1');
      };
    }, 4000);

    // 8. Visibility Handlers
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (window.JEELIZFACEFILTER) JEELIZFACEFILTER.toggle_pause(true); }
      else { if (window.JEELIZFACEFILTER) JEELIZFACEFILTER.toggle_pause(false); }
    });

  } catch(e) {}
})();