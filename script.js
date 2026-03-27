// ── SECURITY ──
(function() {
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent);
  console.log('[Azura Security] UA:', navigator.userAgent);
  console.log('[Azura Security] Mobile detected:', isMobile);
  console.log('[Azura Security] outerW:', window.outerWidth, 'innerW:', window.innerWidth, 'diff:', window.outerWidth - window.innerWidth);
  console.log('[Azura Security] outerH:', window.outerHeight, 'innerH:', window.innerHeight, 'diff:', window.outerHeight - window.innerHeight);

  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (e.key === 'F12') { e.preventDefault(); return false; }
    if (e.ctrlKey && e.shiftKey && 'IJCKijck'.includes(e.key)) { e.preventDefault(); return false; }
    if (e.ctrlKey && 'uUsS'.includes(e.key)) { e.preventDefault(); return false; }
    if (e.metaKey && e.altKey && 'iI'.includes(e.key)) { e.preventDefault(); return false; }
  });

  if (!isMobile) {
    const t = 250;
    setInterval(() => {
      if (window.outerWidth - window.innerWidth > t || window.outerHeight - window.innerHeight > t) {
        document.body.innerHTML = '<div style="display:flex;height:100vh;align-items:center;justify-content:center;font-family:monospace;color:#D6A77A;background:#1A1410;letter-spacing:.25em;">ACCESS RESTRICTED</div>';
      }
    }, 900);
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  // ── SQUARES ──
  (function() {
    const canvas = document.getElementById('sq-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const SZ = 46;
    let W, H;
    const off = { x: 0, y: 0 };
    let mx = -9999, my = -9999;

    function resize() { W = canvas.width = innerWidth; H = canvas.height = innerHeight; }
    resize();
    addEventListener('resize', resize);
    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const ox = off.x % SZ, oy = off.y % SZ;
      const cols = Math.ceil(W / SZ) + 2, rows = Math.ceil(H / SZ) + 2;
      for (let c = -1; c < cols; c++) {
        for (let r = -1; r < rows; r++) {
          const sx = c * SZ - ox, sy = r * SZ - oy;
          const gx = Math.floor((mx + ox) / SZ);
          const gy = Math.floor((my + oy) / SZ);
          if (c === gx && r === gy) {
            ctx.fillStyle = 'rgba(214,167,122,0.09)';
            ctx.fillRect(sx, sy, SZ, SZ);
          }
          ctx.strokeStyle = 'rgba(214,167,122,0.07)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(sx, sy, SZ, SZ);
        }
      }
      off.x += 0.26; off.y += 0.26;
      requestAnimationFrame(draw);
    }
    draw();
  })();

  // ── TUBES ──
  (function() {
    const canvas = document.getElementById('tubes-canvas');
    if (!canvas || !window.THREE) return;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1A1410, 1);
    renderer.setSize(window.innerWidth, window.innerHeight);

    const aspect = window.innerWidth / window.innerHeight;
    const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 100);
    camera.position.z = 5;

    // --- Lighting ---
    // Lights removed: using MeshBasicMaterial for strands

    // --- Mouse Tracking ---
    const rawTarget = new THREE.Vector3(0, 0, 0);
    document.addEventListener('mousemove', (e) => {
      const ndcX = (e.clientX / window.innerWidth)  * 2 - 1;
      const ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
      const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
      vec.unproject(camera);
      const dir = vec.sub(camera.position).normalize();
      const dist = -camera.position.z / dir.z;
      rawTarget.copy(camera.position).addScaledVector(dir, dist);
      rawTarget.z = 0;
    });

    // --- Tube Strand System ---
    const strands = [];
    const numStrands = 60;

    for (let i = 0; i < numStrands; i++) {
      const historyLength = Math.floor(Math.random() * (45 - 25 + 1)) + 25;
      const radius = Math.random() * (0.009 - 0.003) + 0.003;
      const lerpSpeed = Math.random() * (0.18 - 0.08) + 0.08;
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 0.16,
        (Math.random() - 0.5) * 0.16,
        (Math.random() - 0.5) * 0.06
      );
      const delay = Math.floor(Math.random() * 36);

      let color, opacity;
      if (i % 3 === 0) {
        color = 0xD6A77A; opacity = Math.random() * (0.90 - 0.55) + 0.55;
      } else if (i % 3 === 1) {
        color = 0xF3E2D0; opacity = Math.random() * (0.60 - 0.30) + 0.30;
      } else {
        color = 0x8C6A4F; opacity = Math.random() * (0.75 - 0.40) + 0.40;
      }

      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        depthWrite: false
      });

      const smoothedPos = new THREE.Vector3(0, 0, 0);
      const history = [];
      for (let h = 0; h < historyLength; h++) {
        history.push(new THREE.Vector3(0, 0, 0));
      }

      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      scene.add(mesh);

      strands.push({
        historyLength,
        radius,
        lerpSpeed,
        offset,
        delay,
        smoothedPos,
        history,
        mesh
      });
    }

    // --- Resize Handler ---
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // --- Animation Loop ---
    let frameCount = 0;
    function animate() {
      frameCount++;

      strands.forEach(strand => {
        if (frameCount < strand.delay) return;

        const targetWithOffset = rawTarget.clone().add(strand.offset);
        strand.smoothedPos.lerp(targetWithOffset, strand.lerpSpeed);

        strand.history.unshift(strand.smoothedPos.clone());
        if (strand.history.length > strand.historyLength) {
          strand.history.pop();
        }

        if (strand.history.length < 2) return;

        const curve = new THREE.CatmullRomCurve3(strand.history);
        const tubularSegments = Math.min(strand.history.length - 1, 30);
        const newGeo = new THREE.TubeGeometry(curve, tubularSegments, strand.radius, 4, false);

        if (strand.mesh.geometry) strand.mesh.geometry.dispose();
        strand.mesh.geometry = newGeo;
      });

      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    animate();
  })();

  // ── EVENT REGISTRATION MODAL ──
  (function() {
    const overlay = document.getElementById('reg-modal');
    const closeBtn = document.getElementById('reg-close');
    const submitBtn = document.getElementById('reg-submit');
    const soonClose = document.getElementById('reg-soon-close');
    const formArea = document.getElementById('reg-form-area');
    const soonArea = document.getElementById('reg-soon-area');
    const eventLabel = document.getElementById('reg-event-name');
    const errorMsg = document.getElementById('reg-error');

    const FORM_LINK = 'https://forms.gle/GZ3QQcRTru544QB19';

    const EVENT_NAMES = {
      paper:     'Paper Presentation',
      poster:    'Poster Presentation',
      expo:      'Project Expo',
      vibe:      'Vibe Coding Contest',
      ipl:       'IPL Auction',
      smash:     'Smash Karts',
      pictogram: 'Pictogram Puzzles'
    };

    function openModal(type, eventKey) {
      eventLabel.textContent = EVENT_NAMES[eventKey] || eventKey;
      errorMsg.style.display = 'none';

      if (type === 'form') {
        formArea.style.display = 'flex';
        soonArea.style.display = 'none';
      } else if (type === 'soon') {
        formArea.style.display = 'none';
        soonArea.style.display = 'flex';
      }

      overlay.classList.add('active');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      overlay.classList.remove('active');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      document.getElementById('reg-name').value = '';
      document.getElementById('reg-roll').value = '';
      document.getElementById('reg-mobile').value = '';
      errorMsg.style.display = 'none';
    }

    // Attach click to ev-cards
    document.querySelectorAll('.ev-card').forEach(card => {
      card.addEventListener('click', () => {
        const type = card.dataset.type;
        const eventKey = card.dataset.event;
        if (type === 'freefire') return; // handled by Phase 3
        openModal(type, eventKey);
      });
    });

    closeBtn.addEventListener('click', closeModal);
    soonClose.addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    submitBtn.addEventListener('click', () => {
      const name   = document.getElementById('reg-name').value.trim();
      const roll   = document.getElementById('reg-roll').value.trim();
      const mobile = document.getElementById('reg-mobile').value.trim();

      if (!name || !roll || !/^\d{10}$/.test(mobile)) {
        errorMsg.style.display = 'block';
        return;
      }

      // Build prefilled Google Form URL
      const finalURL = FORM_LINK + 
        '?usp=pp_url' +
        '&entry.name=' + encodeURIComponent(name) +
        '&entry.roll=' + encodeURIComponent(roll) +
        '&entry.mobile=' + encodeURIComponent(mobile);

      closeModal();
      window.open(finalURL, '_blank');
    });
  })();

  // ── FREEFIRE POPUP ──
  (function() {
    const ffOverlay  = document.getElementById('ff-overlay');
    const ffClose    = document.getElementById('ff-close');
    const ffAudio    = document.getElementById('ff-audio');

    function openFF() {
      ffOverlay.classList.add('active');
      ffOverlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      if (ffAudio) {
        ffAudio.volume = 0.55;
        ffAudio.currentTime = 0;
        ffAudio.play().catch(() => {
          // Autoplay blocked by browser
        });
      }
    }

    function closeFF() {
      ffOverlay.classList.remove('active');
      ffOverlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (ffAudio) {
        ffAudio.pause();
        ffAudio.currentTime = 0;
      }
    }

    // Trigger on Freefire card click
    document.querySelectorAll('.ev-card').forEach(card => {
      if (card.dataset.type === 'freefire') {
        card.addEventListener('click', () => {
          openFF();
        });
      }
    });

    // Auto-trigger: March 28 2026, 10:00 AM to 3:00 PM, once per session
    (function autoTrigger() {
      const shown = sessionStorage.getItem('ff-popup-shown');
      if (shown) return;

      const now = new Date();
      const isDay = now.getFullYear() === 2026 &&
                    now.getMonth() === 2 &&          // 0-indexed: March = 2
                    now.getDate() === 28;
      const hour = now.getHours();
      const inWindow = hour >= 10 && hour < 15;      // 10 AM to 3 PM

      if (isDay && inWindow) {
        sessionStorage.setItem('ff-popup-shown', '1');
        setTimeout(() => openFF(), 1800);
      }
    })();

    ffClose.addEventListener('click', closeFF);

    ffOverlay.addEventListener('click', (e) => {
      if (e.target === ffOverlay) closeFF();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ffOverlay.classList.contains('active')) {
        closeFF();
      }
    });
  })();

  // ── UI ENHANCEMENTS (Dock, Section Reveal, Scroll Audio) ──
  (function() {
    // 1. Scroll Whoosh Audio
    const whoosh = new Audio('Pop-ups/dragon-studio-simple-whoosh-02-433006.mp3');
    whoosh.volume = 0.38;
    whoosh.preload = 'auto';

    let whooshLocked = false;
    let whooshStopTimer = null;
    let whooshUnlockTimer = null;

    window.addEventListener('scroll', () => {
      if (whooshLocked || !document.hasFocus()) return;
      whooshLocked = true;

      // Cancel any pending stop from a previous play
      clearTimeout(whooshStopTimer);

      try {
        whoosh.currentTime = 0.85;
        const playPromise = whoosh.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              whooshStopTimer = setTimeout(() => {
                whoosh.pause();
              }, 1600);
            })
            .catch(() => {});
        }
      } catch(e) {}

      // Unlock only after the clip has fully played + buffer gap
      // 1600ms play duration + 400ms dead zone = 2000ms total cooldown
      clearTimeout(whooshUnlockTimer);
      whooshUnlockTimer = setTimeout(() => {
        whooshLocked = false;
      }, 2000);

    }, { passive: true });

    // 2. Dock Injection & Section Tracking
    const dock = document.createElement('div');
    dock.className = 'azura-dock';
    const navItems = [
      { label: 'Home', selector: '.hero' },
      { label: 'Events', selector: 'section:first-of-type' },
      { label: 'Venue', selector: '.venue-section' },
      { label: 'Team', selector: 'section:last-of-type' }
    ];

    navItems.forEach(item => {
      const pill = document.createElement('div');
      pill.className = 'dock-pill';
      pill.innerHTML = `${item.label}<div class="dock-dot"></div>`;
      pill.onclick = () => {
        const target = document.querySelector(item.selector);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      };
      dock.appendChild(pill);
      item.element = pill;
    });

    document.body.appendChild(dock);

    // 3. Reveal Observer & Active Section Tracking
    const observerOptions = { threshold: 0.15 };
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('section-revealed');
        }
      });
    }, observerOptions);

    const activeObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          navItems.forEach(item => {
            const section = document.querySelector(item.selector);
            if (section === entry.target || section?.contains(entry.target)) {
              item.element.classList.add('active');
            } else {
              item.element.classList.remove('active');
            }
          });
        }
      });
    }, { threshold: 0.5 });

    // Target sections for reveal and active tracking
    const targets = document.querySelectorAll('section, .stats-bar, .prize-banner, .hero');
    targets.forEach(t => {
      if (t.tagName === 'SECTION' || t.classList.contains('stats-bar') || t.classList.contains('prize-banner')) {
        t.classList.add('section-reveal');
        revealObserver.observe(t);
      }
      activeObserver.observe(t);
    });
  })();

  // ── FULLSCREEN & MOBILE DOCK ENHANCEMENTS ──
  (function() {
    // 1. Fullscreen Request on Interaction
    const requestFullscreen = () => {
      const doc = document.documentElement;
      try {
        if (doc.requestFullscreen) doc.requestFullscreen();
        else if (doc.webkitRequestFullscreen) doc.webkitRequestFullscreen();
        else if (doc.mozRequestFullScreen) doc.mozRequestFullScreen();
        else if (doc.msRequestFullscreen) doc.msRequestFullscreen();
      } catch (err) {}
      window.removeEventListener('touchstart', requestFullscreen);
      window.removeEventListener('click', requestFullscreen);
    };

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOS) {
      window.addEventListener('touchstart', requestFullscreen, { once: true });
      window.addEventListener('click', requestFullscreen, { once: true });
    }

    // 2. iOS Viewport Height Fix
    const setVH = () => {
      let vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };
    setVH();
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', setVH);
  })();

  // ── PWA INSTALL PROMPT ──
  (function() {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('[PWA] ServiceWorker registered', reg.scope))
        .catch(err => console.error('[PWA] ServiceWorker failed', err));
    }

    // iOS --vh fix (Safari collapses viewport with address bar)
    function setVH() {
      document.documentElement.style.setProperty('--vh', window.innerHeight * 0.01 + 'px');
    }
    setVH();
    window.addEventListener('resize', setVH);
    window.addEventListener('orientationchange', () => setTimeout(setVH, 150));

    // Detect if already running as PWA (fullscreen/standalone)
    const isStandalone = window.matchMedia('(display-mode: fullscreen)').matches
                      || window.matchMedia('(display-mode: standalone)').matches
                      || window.navigator.standalone === true;

    console.log('[PWA] Standalone status:', isStandalone);
    if (isStandalone) return; // Already fullscreen, nothing to show

    // Build install banner
    const banner = document.createElement('div');
    banner.id = 'pwa-banner';
    banner.innerHTML = `
      <div class="pwa-inner">
        <div class="pwa-icon">⬇</div>
        <div class="pwa-text">
          <div class="pwa-title">Add to Home Screen</div>
          <div class="pwa-sub">Launch fullscreen — no browser bars</div>
        </div>
        <button class="pwa-btn" id="pwa-install-btn">Install</button>
        <button class="pwa-dismiss" id="pwa-dismiss-btn" aria-label="Dismiss">✕</button>
      </div>
    `;
    document.body.appendChild(banner);

    const installBtn = document.getElementById('pwa-install-btn');
    const dismissBtn = document.getElementById('pwa-dismiss-btn');

    // Dismiss: hide for this session
    dismissBtn.addEventListener('click', () => {
      banner.classList.remove('pwa-visible');
      sessionStorage.setItem('pwa-dismissed', '1');
    });

    // Android/Desktop Chrome: capture beforeinstallprompt
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('[PWA] beforeinstallprompt fired');
      e.preventDefault();
      deferredPrompt = e;

      if (!sessionStorage.getItem('pwa-dismissed')) {
        setTimeout(() => banner.classList.add('pwa-visible'), 2500);
      }
    });

    installBtn.addEventListener('click', () => {
      if (deferredPrompt) {
        // Android/Desktop: trigger native install dialog
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
          console.log('[PWA] User choice:', choiceResult.outcome);
          deferredPrompt = null;
          banner.classList.remove('pwa-visible');
        });
      } else {
        // iOS: no API available, show manual instructions
        const iosMsg = document.getElementById('pwa-ios-msg');
        if (iosMsg) iosMsg.classList.add('pwa-ios-visible');
        else {
          // Fallback alert for desktop testing if prompt not yet fired
          alert("To install: Use the browser's menu (top right three dots) and click 'Install Azura 2K26'");
        }
      }
    });

    // iOS fallback instruction bubble
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isIOS) {
      console.log('[PWA] iOS detected, setting up instructions');
      // Show iOS-specific instructions since beforeinstallprompt never fires on iOS
      const iosBubble = document.createElement('div');
      iosBubble.id = 'pwa-ios-msg';
      iosBubble.innerHTML = `
        <div class="ios-arrow">▼</div>
        <div class="ios-steps">
          Tap <strong>Share ↑</strong> then<br/>
          <strong>"Add to Home Screen"</strong><br/>
          for fullscreen experience
        </div>
        <button id="pwa-ios-close">Got it</button>
      `;
      document.body.appendChild(iosBubble);
      document.getElementById('pwa-ios-close').addEventListener('click', () => {
        iosBubble.remove();
        sessionStorage.setItem('pwa-dismissed', '1');
      });
      // Show after 3s
      setTimeout(() => {
        if (!sessionStorage.getItem('pwa-dismissed')) {
          banner.classList.add('pwa-visible');
          iosBubble.classList.add('pwa-ios-visible');
        }
      }, 3000);
    }
  })();

  // ── CONTACT POPUP ──
  (function() {
    // Build popup DOM
    const popup = document.createElement('div');
    popup.id = 'contact-popup';
    popup.setAttribute('aria-hidden', 'true');
    popup.innerHTML = `
      <div class="cp-box">
        <div class="cp-name" id="cp-name"></div>
        <div class="cp-actions">
          <button class="cp-btn cp-call" id="cp-call">
            <span class="cp-icon">📞</span>
            <span class="cp-label">Call</span>
          </button>
          <button class="cp-btn cp-wa" id="cp-wa">
            <span class="cp-icon">💬</span>
            <span class="cp-label">WhatsApp</span>
          </button>
        </div>
        <button class="cp-close" id="cp-close" aria-label="Close">✕</button>
      </div>
    `;
    document.body.appendChild(popup);

    const cpName  = document.getElementById('cp-name');
    const cpCall  = document.getElementById('cp-call');
    const cpWa    = document.getElementById('cp-wa');
    const cpClose = document.getElementById('cp-close');

    let currentPhone = '';
    let currentWa    = '';

    function openPopup(phone, wa, name, gender) {
      currentPhone = phone;
      currentWa    = wa;

      // Greeting: add "Sister" suffix for female contacts
      const greeting = gender === 'female'
        ? `Hello ${name} Sister`
        : `Hello ${name}`;

      cpName.textContent = name + (gender === 'female' ? ' 👩' : ' 👤');
      cpCall.dataset.greeting = greeting; // store for reference
      cpWa.dataset.greeting   = greeting;
      cpWa.dataset.wa         = wa;

      popup.classList.add('cp-visible');
      popup.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }

    function closePopup() {
      popup.classList.remove('cp-visible');
      popup.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    // Call button: open dialer + copy to clipboard
    cpCall.addEventListener('click', () => {
      // Copy number to clipboard silently
      try {
        navigator.clipboard.writeText(currentPhone).catch(() => {});
      } catch(e) {}
      // Open dialer
      window.location.href = 'tel:+91' + currentPhone;
      closePopup();
    });

    // WhatsApp button: open wa.me with preloaded greeting
    cpWa.addEventListener('click', () => {
      const greeting = encodeURIComponent(cpWa.dataset.greeting);
      const waNum    = cpWa.dataset.wa;
      window.open('https://wa.me/' + waNum + '?text=' + greeting, '_blank');
      closePopup();
    });

    cpClose.addEventListener('click', closePopup);

    popup.addEventListener('click', (e) => {
      if (e.target === popup) closePopup();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popup.classList.contains('cp-visible')) {
        closePopup();
      }
    });

    // Attach triggers to all .contact-trigger spans
    document.querySelectorAll('.contact-trigger').forEach(span => {
      span.addEventListener('click', () => {
        openPopup(
          span.dataset.phone,
          span.dataset.wa,
          span.dataset.name,
          span.dataset.gender
        );
      });
    });
  })();

  // ── FORCE CACHE REFRESH & SW UPDATE ──
  (function() {
    // 1. Manual Cache Purge (Check for version change)
    const CURRENT_VERSION = 'azura-v2';
    const storedVersion = localStorage.getItem('azura-site-version');

    if (storedVersion !== CURRENT_VERSION) {
      if ('caches' in window) {
        caches.keys().then(names => {
          for (let name of names) caches.delete(name);
        }).then(() => {
          localStorage.setItem('azura-site-version', CURRENT_VERSION);
          // If we had a previous version, force reload once
          if (storedVersion) window.location.reload(true);
        });
      }
    }

    // 2. Service Worker Controller Change Detection
    if ('serviceWorker' in navigator) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    }
  })();
});