// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

// State Management
const STATE = {
    trackingEnabled: false,
    watchId: null,
    intervalId: null,
    sessionTimerId: null,
    entryTime: null,
    isFirstNudgePending: false, // Tracks the 10s "settle" period
    triggerSource: null, // "manual" or "auto"
    autoDetectEnabled: false,
    autoDetectRadius: 100, // Search radius in meters
    lastAutoDetectTime: 0,
    targetLocation: {
        lat: null,
        lng: null,
        radius: 100, // meters
        entryDelay: 10, // seconds
        minInterval: 5, // minutes
        maxInterval: 15, // minutes
        messages: []
    },
    hasNotificationPerms: false,
    hasLocationPerms: false
};

// DOM Elements
const els = {
    toggle: document.getElementById('tracking-toggle'),
    autoDetectToggle: document.getElementById('auto-detect-toggle'),
    autoDetectWarning: document.getElementById('auto-detect-warning'),
    locIndicator: document.getElementById('location-indicator'),
    userPosIndicator: document.getElementById('user-position-indicator'),
    sessionTimerIndicator: document.getElementById('session-timer-indicator'),
    distIndicator: document.getElementById('distance-indicator'),
    notifIndicator: document.getElementById('notification-indicator'),
    btnEnablePerms: document.getElementById('btn-enable-permissions'),
    btnTestNudge: document.getElementById('btn-test-notification'),
    btnUseCurrent: document.getElementById('btn-use-current'),
    inputLat: document.getElementById('target-lat'),
    inputLng: document.getElementById('target-lng'),
    inputRadius: document.getElementById('target-radius'),
    inputEntryDelay: document.getElementById('entry-delay'),
    inputMin: document.getElementById('nudge-min'),
    inputMax: document.getElementById('nudge-max'),
    inputMessages: document.getElementById('nudge-messages'),
    form: document.getElementById('location-form'),
    toastContainer: document.getElementById('toast-container')
};

// Initialize App
function init() {
    loadPreferences();
    checkPermissions();
    setupEventListeners();
    updateUI();

    if (STATE.trackingEnabled) {
        startTracking();
    } else {
        els.toggle.checked = false;
    }
}

// Local Storage
function loadPreferences() {
    try {
        const storedLat = localStorage.getItem('gn_target_lat');
        const storedLng = localStorage.getItem('gn_target_lng');
        const storedRadius = localStorage.getItem('gn_target_radius');
        const storedEntryDelay = localStorage.getItem('gn_entry_delay');
        const storedMin = localStorage.getItem('gn_nudge_min');
        const storedMax = localStorage.getItem('gn_nudge_max');
        const storedMsg = localStorage.getItem('gn_nudge_messages');
        const storedTracking = localStorage.getItem('gn_tracking');
        const storedAutoDetect = localStorage.getItem('gn_auto_detect');

        if (storedLat && storedLng) {
            STATE.targetLocation.lat = parseFloat(storedLat);
            STATE.targetLocation.lng = parseFloat(storedLng);
            els.inputLat.value = storedLat;
            els.inputLng.value = storedLng;
        }
        
        if (storedRadius) {
            STATE.targetLocation.radius = parseInt(storedRadius, 10);
            els.inputRadius.value = storedRadius;
        }

        if (storedEntryDelay) {
            STATE.targetLocation.entryDelay = parseInt(storedEntryDelay, 10);
            els.inputEntryDelay.value = storedEntryDelay;
        }

        if (storedMin) {
            STATE.targetLocation.minInterval = parseInt(storedMin, 10);
            els.inputMin.value = storedMin;
        }

        if (storedMax) {
            STATE.targetLocation.maxInterval = parseInt(storedMax, 10);
            els.inputMax.value = storedMax;
        }

        if (storedMsg) {
            try {
                const parsed = JSON.parse(storedMsg);
                STATE.targetLocation.messages = Array.isArray(parsed) ? parsed : [];
                els.inputMessages.value = STATE.targetLocation.messages.join('\n');
            } catch (e) {
                // Fallback for old format
                STATE.targetLocation.messages = storedMsg.split('\n').map(m => m.trim()).filter(m => m.length > 0);
                els.inputMessages.value = STATE.targetLocation.messages.join('\n');
            }
        }

        if (storedTracking === 'true') {
            STATE.trackingEnabled = true;
            els.toggle.checked = true;
        }

        if (storedAutoDetect === 'true') {
            STATE.autoDetectEnabled = true;
            els.autoDetectToggle.checked = true;
            els.autoDetectWarning.style.display = 'block';
        }
    } catch (e) {
        console.error("Local storage error:", e);
    }
}

function savePreferences() {
    const lat = parseFloat(els.inputLat.value);
    const lng = parseFloat(els.inputLng.value);
    const radius = parseInt(els.inputRadius.value, 10);
    const entryDelay = parseInt(els.inputEntryDelay.value, 10);
    const minInt = parseInt(els.inputMin.value, 10);
    const maxInt = parseInt(els.inputMax.value, 10);
    const messages = els.inputMessages.value.split('\n').map(m => m.trim()).filter(m => m.length > 0);

    if (isNaN(lat) || isNaN(lng)) {
        showToast('Please set a target location first.', 'error');
        return;
    }

    if (minInt > maxInt) {
        showToast('Min interval cannot be greater than Max.', 'error');
        return;
    }

    STATE.targetLocation.lat = lat;
    STATE.targetLocation.lng = lng;
    STATE.targetLocation.radius = radius;
    STATE.targetLocation.entryDelay = entryDelay;
    STATE.targetLocation.minInterval = minInt;
    STATE.targetLocation.maxInterval = maxInt;
    STATE.targetLocation.messages = messages;

    try {
        localStorage.setItem('gn_target_lat', lat);
        localStorage.setItem('gn_target_lng', lng);
        localStorage.setItem('gn_target_radius', radius);
        localStorage.setItem('gn_entry_delay', entryDelay);
        localStorage.setItem('gn_nudge_min', minInt);
        localStorage.setItem('gn_nudge_max', maxInt);
        localStorage.setItem('gn_nudge_messages', JSON.stringify(messages));
        showToast('Preferences saved locally.', 'success');
    } catch (e) {
        showToast('Could not save to local storage.', 'error');
    }
}

function saveTrackingState(isEnabled) {
    try {
        localStorage.setItem('gn_tracking', isEnabled ? 'true' : 'false');
    } catch (e) {}
}

function saveAutoDetectState(isEnabled) {
    try {
        localStorage.setItem('gn_auto_detect', isEnabled ? 'true' : 'false');
    } catch (e) {}
}

// Permissions
async function checkPermissions() {
    STATE.hasNotificationPerms = Notification.permission === 'granted';
    
    // Update Notification UI
    _updateIndicator(els.notifIndicator, STATE.hasNotificationPerms ? 'Notifications: Active' : 'Notifications: Disabled', STATE.hasNotificationPerms);

    if (navigator.permissions) {
        try {
            const locPerm = await navigator.permissions.query({ name: 'geolocation' });
            STATE.hasLocationPerms = locPerm.state === 'granted';
            
            locPerm.onchange = function() {
                STATE.hasLocationPerms = this.state === 'granted';
                if (!STATE.hasLocationPerms && STATE.trackingEnabled) {
                    els.toggle.checked = false;
                    toggleTracking(false);
                }
            };
        } catch (e) {
            console.log("Permissions API not fully supported.");
        }
    }
}

async function requestPermissions() {
    // Request Notification Array
    if (Notification.permission !== 'granted') {
        const p = await Notification.requestPermission();
        STATE.hasNotificationPerms = p === 'granted';
        _updateIndicator(els.notifIndicator, STATE.hasNotificationPerms ? 'Notifications: Active' : 'Notifications: Disabled', STATE.hasNotificationPerms);
    }

    // Geolocation is dynamically requested when we call getCurrentPosition/watchPosition
    if (navigator.geolocation) {
         navigator.geolocation.getCurrentPosition(
            (pos) => {
                STATE.hasLocationPerms = true;
                showToast('Permissions granted!', 'success');
                // Automatically turn on tracking if we have a target
                if (STATE.targetLocation.lat !== null) {
                    els.toggle.checked = true;
                    toggleTracking(true);
                }
            },
            (err) => {
                showToast('Location permission denied.', 'error');
                els.toggle.checked = false;
            }
         );
    }
}

// Core Logic & Math
// Calculate distance between two coords using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // in meters
}

function processLocationUpdate(position) {
    const acc = Math.round(position.coords.accuracy);
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;

    _updateIndicator(els.locIndicator, `GPS Status: Active (±${acc}m)`, true);
    _updateIndicator(els.userPosIndicator, `${userLat.toFixed(5)}, ${userLng.toFixed(5)}`, true);

    // Accuracy Guard: Ignore updates where accuracy is worse than the radius
    const maxAllowedAccuracy = Math.max(STATE.targetLocation.radius || 100, 50);
    if (acc > maxAllowedAccuracy) {
        console.log(`Ignoring update: Accuracy too low (${acc}m > ${maxAllowedAccuracy}m)`);
        _updateIndicator(els.locIndicator, `GPS Status: Low Accuracy (±${acc}m)`, false, true);
        return;
    }

    if (STATE.autoDetectEnabled) {
        checkNearbyBars(userLat, userLng);
    }

    if (STATE.targetLocation.lat === null || STATE.targetLocation.lng === null) {
        _setDistanceText('Target location not set');
        return;
    }

    const distance = calculateDistance(userLat, userLng, STATE.targetLocation.lat, STATE.targetLocation.lng);
    _setDistanceText(`Distance: ${Math.round(distance)}m`);

    // Check if within bounds
    if (distance <= STATE.targetLocation.radius) {
        startZoneSession("manual");
    } else {
        // Only stop if auto-detect also doesn't find anything (handled in checkNearbyBars/stopZoneSession)
        if (!STATE.autoDetectEnabled) {
            stopZoneSession();
        }
    }
}

async function checkNearbyBars(lat, lng) {
    const now = Date.now();
    // Only query Overpass every 60 seconds to avoid rate limiting and battery drain
    if (now - STATE.lastAutoDetectTime < 60000) return;
    STATE.lastAutoDetectTime = now;

    try {
        // Query Overpass API for bars or pubs within the specified radius
        const query = `[out:json][timeout:25];(node["amenity"~"bar|pub"](around:${STATE.autoDetectRadius},${lat},${lng});way["amenity"~"bar|pub"](around:${STATE.autoDetectRadius},${lat},${lng});relation["amenity"~"bar|pub"](around:${STATE.autoDetectRadius},${lat},${lng}););out body;>;out skel qt;`;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'GentleNudgesPWA/1.0 (Privacy-First Hydration App)'
            }
        });
        const data = await response.json();

        if (data.elements && data.elements.length > 0) {
            const barName = data.elements[0].tags.name || "a nearby bar";
            console.log(`Auto-detected bars nearby: ${barName}`);
            startZoneSession("auto", barName);
        } else {
            console.log("No bars detected nearby.");
            // If we are NOT in a manually set zone, stop the session
            if (STATE.targetLocation.lat === null || calculateDistance(lat, lng, STATE.targetLocation.lat, STATE.targetLocation.lng) > STATE.targetLocation.radius) {
                stopZoneSession();
            }
        }
    } catch (e) {
        console.error("Overpass API error:", e);
    }
}

function startZoneSession(source, name) {
    if (!STATE.entryTime) {
        // Just entered the zone
        STATE.entryTime = Date.now();
        STATE.triggerSource = source;
        STATE.isFirstNudgePending = true;
        
        const label = source === "auto" ? `Auto-detected: ${name}` : "Manual target reached";
        showToast(`${label}. Staying ${STATE.targetLocation.entryDelay}s to confirm...`, 'success');

        // Arrival Delay: Only nudge and start timer after the defined delay
        setTimeout(() => {
            // Verify we are still in a session (haven't left in those seconds)
            if (STATE.entryTime && STATE.isFirstNudgePending) {
                STATE.isFirstNudgePending = false;
                triggerSingleNudge(); // First real nudge
                scheduleNextNudge();
                
                STATE.sessionTimerId = setInterval(updateSessionTimer, 1000);
                els.sessionTimerIndicator.classList.add('active');
                
                showToast(`Zone confirmed. Variability timer active.`, 'success');
            }
        }, STATE.targetLocation.entryDelay * 1000); 
    }
}

function scheduleNextNudge() {
    if (!STATE.entryTime) return; // Not in zone

    const minMs = STATE.targetLocation.minInterval * 60 * 1000;
    const maxMs = STATE.targetLocation.maxInterval * 60 * 1000;
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

    console.log(`Scheduling next nudge in ${Math.round(delay/60000)} minutes.`);
    
    STATE.intervalId = setTimeout(() => {
        triggerSingleNudge();
        scheduleNextNudge(); // Recursive call for variability
    }, delay);
}

function stopZoneSession() {
    if (STATE.entryTime) {
        if (STATE.intervalId) {
            clearTimeout(STATE.intervalId);
            STATE.intervalId = null;
        }
        
        if (STATE.sessionTimerId) {
            clearInterval(STATE.sessionTimerId);
            STATE.sessionTimerId = null;
        }
        
        STATE.entryTime = null;
        STATE.isFirstNudgePending = false;
        STATE.triggerSource = null;
        els.sessionTimerIndicator.classList.remove('active');
        _updateIndicator(els.sessionTimerIndicator, 'Time in Zone: 00:00:00', false);
        
        showToast('Left the zone. Timer and nudges paused.', 'success');
    }
}

function updateSessionTimer() {
    if (!STATE.entryTime) return;
    
    const elapsedMs = Date.now() - STATE.entryTime;
    const hours = Math.floor(elapsedMs / 3600000);
    const minutes = Math.floor((elapsedMs % 3600000) / 60000);
    const seconds = Math.floor((elapsedMs % 60000) / 1000);
    
    const formattedTime = [hours, minutes, seconds]
        .map(v => v < 10 ? "0" + v : v)
        .join(":");
        
    _updateIndicator(els.sessionTimerIndicator, `Time in Zone: ${formattedTime}`, true);
}

function triggerSingleNudge() {
    const messages = STATE.targetLocation.messages.length > 0 
        ? STATE.targetLocation.messages 
        : ["You're near the zone! Remember to hydrate. 💧"];
    const randomMsg = messages[Math.floor(Math.random() * messages.length)];

    if (STATE.hasNotificationPerms) {
        new Notification("Gentle Nudge", {
            body: randomMsg,
            icon: "manifest.json" // Placeholder icon
        });
        showToast("Nudge triggered! 💧", "success");
    } else {
        showToast("You're near the zone, but notifications are blocked.", "error");
    }
}

// Geolocation Control
function startTracking() {
    if (!navigator.geolocation) {
        showToast('Geolocation not supported by your browser.', 'error');
        els.toggle.checked = false;
        return;
    }

    STATE.watchId = navigator.geolocation.watchPosition(
        processLocationUpdate,
        (error) => {
            console.error('Watch position error:', error);
            _updateIndicator(els.locIndicator, 'Location: Error acquiring', false, true);
            if (error.code === 1) { // PERMISSION_DENIED
                 toggleTracking(false);
                 els.toggle.checked = false;
                 showToast('Location permission denied.', 'error');
            }
        },
        {
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 5000
        }
    );
    
    belsIndicatorActive(els.locIndicator);
    _setDistanceText('Calculating...');
}

function stopTracking() {
    if (STATE.watchId !== null) {
        navigator.geolocation.clearWatch(STATE.watchId);
        STATE.watchId = null;
    }
    if (STATE.intervalId !== null) {
        clearInterval(STATE.intervalId);
        STATE.intervalId = null;
    }
    if (STATE.sessionTimerId !== null) {
        clearInterval(STATE.sessionTimerId);
        STATE.sessionTimerId = null;
    }
    STATE.entryTime = null;
    _updateIndicator(els.locIndicator, 'GPS Status: Disabled', false);
    _updateIndicator(els.userPosIndicator, 'Your Position: N/A', false);
    _updateIndicator(els.sessionTimerIndicator, 'Time in Zone: 00:00:00', false);
    _setDistanceText('Distance: N/A');
}

function toggleTracking(enabled) {
    STATE.trackingEnabled = enabled;
    saveTrackingState(enabled);

    if (enabled) {
        if (!STATE.hasLocationPerms || !STATE.hasNotificationPerms) {
            showToast('Permissions required to track properly.', 'error');
            requestPermissions();
        } else {
            startTracking();
        }
    } else {
        stopTracking();
    }
}

// Event Listeners
function setupEventListeners() {
    els.toggle.addEventListener('change', (e) => {
        toggleTracking(e.target.checked);
    });

    els.autoDetectToggle.addEventListener('change', (e) => {
        STATE.autoDetectEnabled = e.target.checked;
        saveAutoDetectState(STATE.autoDetectEnabled);
        els.autoDetectWarning.style.display = STATE.autoDetectEnabled ? 'block' : 'none';
        
        if (STATE.autoDetectEnabled) {
            showToast('Auto-detection enabled. Checking nearby...', 'success');
            // Immediate check if tracking is already on
            if (STATE.trackingEnabled) {
                navigator.geolocation.getCurrentPosition(pos => {
                    checkNearbyBars(pos.coords.latitude, pos.coords.longitude);
                });
            }
        }
    });

    els.form.addEventListener('submit', (e) => {
        e.preventDefault();
        savePreferences();
    });

    els.btnEnablePerms.addEventListener('click', requestPermissions);

    els.btnUseCurrent.addEventListener('click', () => {
        if (!navigator.geolocation) {
            showToast('Geolocation not supported.', 'error');
            return;
        }

        showToast('Fetching your location...', 'success');
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                els.inputLat.value = pos.coords.latitude.toFixed(6);
                els.inputLng.value = pos.coords.longitude.toFixed(6);
                showToast('Coordinates updated. Click "Save" to apply.', 'success');
            },
            (err) => {
                showToast('Could not get current location.', 'error');
            },
            { enableHighAccuracy: true }
        );
    });

    els.btnTestNudge.addEventListener('click', () => {
        if (Notification.permission === 'granted') {
             triggerSingleNudge();
             showToast("Test notification sent.", "success");
        } else {
             requestPermissions().then(() => {
                 if (Notification.permission === 'granted') {
                     triggerSingleNudge();
                     showToast("Permissions granted. Test Nudge sent.", "success");
                 }
             });
        }
    });
}

// UI Helpers
function updateUI() {
    // Initial UI Setup if needed
}

function _updateIndicator(el, text, isActive, isError = false) {
    el.querySelector('.text').textContent = text;
    if (isActive) {
        el.classList.add('active');
        el.classList.remove('error');
    } else if (isError) {
        el.classList.add('error');
        el.classList.remove('active');
    } else {
        el.classList.remove('active', 'error');
    }
}

function _setDistanceText(text) {
    els.distIndicator.querySelector('.text').textContent = text;
    if (STATE.targetLocation.radius) {
        // Find if we are close enough to pulse
        const match = text.match(/([0-9]+)m/);
        if (match && parseInt(match[1]) <= STATE.targetLocation.radius) {
            els.distIndicator.classList.add('active');
        } else {
             els.distIndicator.classList.remove('active');
        }
    }
}

function belsIndicatorActive(el) {
    el.querySelector('.text').textContent = 'Location: Searching...';
    el.classList.add('active');
}

function showToast(message, type = 'success') {
    const id = Date.now();
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `${type === 'success' ? '✅' : '⚠️'} ${message}`;
    els.toastContainer.appendChild(t);

    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transform = 'translateY(10px) translateX(-50%)';
        t.style.transition = 'all 0.3s ease';
        setTimeout(() => t.remove(), 300);
    }, 3000);
}

// Boot
init();
