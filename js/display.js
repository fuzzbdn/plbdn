import { fetchData } from './service.js';
import { getISOWeek, isLight, escapeHTML } from './utils.js';
import { DAYS } from './config.js';

// ==========================================
// KONSTANTER & GLOBALA TIMERS
// ==========================================
const CONFIG_CACHE_MS  = 5  * 60 * 1000;  // 5 minuter
const WEATHER_CACHE_MS = 15 * 60 * 1000;  // 15 minuter
const FALLBACK_POLL_MS = 10 * 60 * 1000;  // Skyddsnät ifall Pusher tappar anslutningen

// NYTT: Pusher-nycklar är publika (inte hemliga) och kan ligga i klientkoden.
// PUSHER_SECRET ska ALDRIG placeras här - den ligger bara i backend (api/_pusher.js).
const PUSHER_KEY     = 'bd3dbd5cbb9abb426d43';
const PUSHER_CLUSTER = 'eu'; // Samma kluster som i Vercels miljövariabler

let fallbackTimer = null;
let clockTimer    = null;
let pusherClient  = null;
let pusherChannel = null;

// ==========================================
// GLOBALT TILLSTÅND
// ==========================================
let globalStations       = [];
let globalShifts         = [];
let globalCustomThemes   = [];
let globalScheduleData   = {};

let lastWeatherFetchTime = 0;
let cachedWeatherHtml    = '';
let lastWeatherCoords    = ''; 
let lastDataSnapshot     = '';

let cachedConfig = {
    settings:      null,
    message:       null,
    weatherConfig: null,
    lastConfigFetch: 0
};

// ==========================================
// HJÄLPFUNKTIONER
// ==========================================

function getWeatherIcon(code) {
    if (code === 0)                        return '☀️';
    if (code === 1 || code === 2)          return '🌤️';
    if (code === 3)                        return '☁️';
    if (code === 45 || code === 48)        return '🌫️';
    if (code >= 51 && code <= 67)          return '🌧️';
    if (code >= 71 && code <= 86)          return '❄️';
    if (code >= 95)                        return '⛈️';
    return '🌡️';
}

function parseSafe(data) {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return {}; }
    }
    return data || {};
}

function parseCoords(lat, lon) {
    const parsedLat = parseFloat(lat);
    const parsedLon = parseFloat(lon);
    if (
        Number.isNaN(parsedLat) || Number.isNaN(parsedLon) ||
        parsedLat < -90  || parsedLat > 90   ||
        parsedLon < -180 || parsedLon > 180
    ) return null;
    return { lat: parsedLat, lon: parsedLon };
}

/**
 * Läser ut payloaden ur en JWT utan att verifiera signaturen.
 * JWT-payloaden är bara base64-kodad (inte krypterad), så detta avslöjar
 * ingenting som inte redan är läsbart för den som har token. Vi använder
 * den bara för att plocka ut workplaceId till Pusher-kanalens namn.
 */
function decodeJwtPayload(token) {
    try {
        const payload = token.split('.')[1];
        const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

// ==========================================
// HUVUD-FUNKTION
// ==========================================

export async function initDisplay() {
    const urlParams    = new URLSearchParams(window.location.search);
    const displayToken = urlParams.get('token');

    if (!displayToken) {
        document.body.innerHTML = "<h1 style='color:red;text-align:center;padding-top:10%;'>Åtkomst nekad. Display-nyckel saknas i URL:en.</h1>";
        return;
    }

    // --- HÄMTA TEMAN SÄKERT OCH STRUKTURERAT ---
    const themesRes = await fetchData('custom_themes', { token: displayToken });
    globalCustomThemes = (themesRes?.success && Array.isArray(themesRes.data)) ? themesRes.data : [];

    async function updateDisplay() {
        try {
            const now       = new Date();
            const tzoffset  = now.getTimezoneOffset() * 60000;
            const todayStr  = (new Date(now.getTime() - tzoffset)).toISOString().slice(0, 10);

            const fetchConfig = (now.getTime() - cachedConfig.lastConfigFetch > CONFIG_CACHE_MS);

            // --- HÄMTA SCHEMADATA ---
            const bundleRes = await fetchData('display_bundle', {
                start_date: todayStr,
                end_date: todayStr,
                include_config: fetchConfig,
                token: displayToken
            });

            if (!bundleRes?.success || !bundleRes.data) {
                console.error("Kunde inte hämta schemadata:", bundleRes?.error);
                return;
            }

            const bundleData = bundleRes.data;

            globalStations = Array.isArray(bundleData.stations) ? bundleData.stations : [];
            globalShifts   = Array.isArray(bundleData.shifts)   ? bundleData.shifts   : [];

            globalScheduleData = {};
            if (Array.isArray(bundleData.schedule)) {
                bundleData.schedule.forEach(row => {
                    if (!row.is_published) return;
                    const key = `${row.station_id}_${row.shift_id}`;
                    if (!globalScheduleData[key]) globalScheduleData[key] = [];
                    globalScheduleData[key].push(row);
                });
            }

            if (fetchConfig) {
                cachedConfig.settings      = parseSafe(bundleData.settings);
                cachedConfig.message       = parseSafe(bundleData.message);
                cachedConfig.weatherConfig = parseSafe(bundleData.weather_config);
                cachedConfig.lastConfigFetch = now.getTime();
            }

            // --- SNAPSHOT-LOGIK ---
            const currentSnapshot = JSON.stringify({
                sch:     globalScheduleData,
                st:      globalStations,
                sh:      globalShifts,
                msg:     cachedConfig.message?.text,
                showMsg: cachedConfig.message?.show
            });

            if (currentSnapshot !== lastDataSnapshot || fetchConfig) {
                lastDataSnapshot = currentSnapshot;

                const iso      = getISOWeek(now);
                const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
                const titleEl  = document.getElementById('mainTitle');
                if (titleEl) {
                    titleEl.innerText = `Vi som jobbar ${DAYS[dayIndex]} ${now.getDate()}/${now.getMonth() + 1} (v.${iso.week})`;
                }

                renderGrid();

                // Löpande text (marquee)
                const mqContainer = document.getElementById('marqueeContainer');
                if (mqContainer) {
                    const msg = cachedConfig.message;
                    if (msg?.show && msg?.text) {
                        document.getElementById('marqueeText').innerText = msg.text;
                        mqContainer.style.display = 'block';
                    } else {
                        mqContainer.style.display = 'none';
                    }
                }

                // --- SÄKER TEMA-INJEKTION ---
                const themeId = cachedConfig.settings?.theme;
                let styleEl = document.getElementById('custom-theme-style');

                if (themeId && themeId !== 'light') {
                    const t = globalCustomThemes.find(x => x.id === themeId);
                    if (t?.css) {
                        if (!styleEl) {
                            styleEl = document.createElement('style');
                            styleEl.id = 'custom-theme-style';
                            document.head.appendChild(styleEl);
                        }
                        if (styleEl.textContent !== t.css) styleEl.textContent = t.css;
                    }
                } else {
                    if (styleEl) styleEl.remove();
                }
            }

            // --- VÄDERHANTERING ---
            const wc = cachedConfig.weatherConfig;
            if (wc?.latitude && wc?.longitude) {
                const coords = parseCoords(wc.latitude, wc.longitude);
                if (!coords) {
                    console.warn('Ogiltiga väderkoordinater i inställningarna:', wc.latitude, wc.longitude);
                } else {
                    const coordKey = `${coords.lat},${coords.lon}`;

                    if (coordKey !== lastWeatherCoords) {
                        cachedWeatherHtml    = '';
                        lastWeatherFetchTime = 0;
                        lastWeatherCoords    = coordKey;
                    }

                    const nowMs = Date.now();
                    if (nowMs - lastWeatherFetchTime > WEATHER_CACHE_MS || cachedWeatherHtml === '') {
                        try {
                            const weatherRes = await fetch(
                                `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current_weather=true`
                            );
                            if (weatherRes.ok) {
                                const weatherData = await weatherRes.json();
                                if (weatherData?.current_weather) {
                                    const temp = Math.round(weatherData.current_weather.temperature);
                                    const icon = getWeatherIcon(weatherData.current_weather.weathercode);
                                    cachedWeatherHtml = { icon, temp };
                                    lastWeatherFetchTime = nowMs;
                                }
                            }
                        } catch (err) {
                            console.error('Kunde inte hämta väder:', err);
                        }
                    }

                    const weatherEl = document.getElementById('weatherWidget');
                    if (weatherEl && cachedWeatherHtml) {
                        weatherEl.innerHTML = '';

                        const locationSpan = document.createElement('span');
                        locationSpan.className = 'weather-location-text';
                        locationSpan.textContent = wc.name || '';

                        const weatherSpan = document.createElement('span');
                        weatherSpan.textContent = `${cachedWeatherHtml.icon} ${cachedWeatherHtml.temp}°C`;

                        weatherEl.appendChild(locationSpan);
                        weatherEl.appendChild(weatherSpan);
                    }
                }
            }

        } catch (e) {
            console.error('Kunde inte uppdatera display:', e);
        }
    }

    // Rensa gamla timers/anslutningar vid ominitiering (t.ex. vid hot-reload)
    if (fallbackTimer) clearInterval(fallbackTimer);
    if (clockTimer) clearInterval(clockTimer);
    if (pusherChannel) {
        pusherChannel.unbind_all();
        pusherChannel.unsubscribe();
        pusherChannel = null;
    }
    if (pusherClient) {
        pusherClient.disconnect();
        pusherClient = null;
    }

    // Starta med en initial hämtning
    await updateDisplay();

    // --- REALTIDSLYSSNARE VIA PUSHER ---
    const payload      = decodeJwtPayload(displayToken);
    const workplaceId  = payload?.workplaceId;

    if (workplaceId && typeof Pusher !== 'undefined') {
        try {
            pusherClient = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });
            pusherChannel = pusherClient.subscribe(`workplace-${workplaceId}`);

            pusherChannel.bind('schedule-updated', () => {
                updateDisplay();
            });
        } catch (err) {
            console.error('Kunde inte ansluta till Pusher:', err);
        }
    } else {
        console.warn('Kunde inte ansluta till Pusher - saknar workplaceId i token, eller Pusher-biblioteket kunde inte laddas.');
    }

    // --- SKYDDSNÄT: mycket gles polling ifall websocket-anslutningen tappas ---
    fallbackTimer = setInterval(async () => {
        try { await updateDisplay(); }
        catch (e) { console.error('Kritiskt fel i fallback-polling:', e); }
    }, FALLBACK_POLL_MS);

    // Klockan tickar i realtid, oberoende av Pusher/polling
    clockTimer = setInterval(() => {
        const now = new Date();
        const clk = document.getElementById('clock');
        if (clk) clk.innerText = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }, 1000);
}

// ==========================================
// RENDERING
// ==========================================
function renderGrid() {
    const cont = document.getElementById('mainContainer');
    if (!cont) return;

    if (!globalShifts.length || !globalStations.length) {
        cont.innerHTML = '<p style="padding:2rem; text-align:center; color:#888;">Inget schema att visa.</p>';
        return;
    }

    let html = `<div class="time-header-row"><div></div>${globalShifts.map(s => `<div class="time-header">${escapeHTML(s.label)}</div>`).join('')}</div>`;

    globalStations.forEach(st => {
        if (st.is_spacer) {
            html += `<div class="display-row spacer-row"></div>`;
            return;
        }

        const contrast  = isLight(st.color) ? '#000' : '#fff';
        const safeColor = escapeHTML(st.color);

        html += `<div class="display-row" style="--station-color:${safeColor}; --contrast-color:${contrast};">`;
        html += `<div class="station-label">${escapeHTML(st.name)}</div>`;

        globalShifts.forEach(sh => {
            if (!sh || sh.id == null) return;

            const key         = `${st.id}_${sh.id}`;
            const assignments = globalScheduleData[key] || [];
            const val = assignments
                .map(a => {
                    const name = a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim();
                    const note = a.note ? ` <span style="color:#888; font-size:0.8em; font-weight:400;">(${escapeHTML(a.note)})</span>` : '';
                    return `<span>${escapeHTML(name)}${note}</span>`;
                })
                .join(' / ');
            
            const isEmpty = assignments.length === 0;
            html += `<div class="shift-card ${isEmpty ? 'empty' : ''}" data-label="${escapeHTML(sh.label)}">${isEmpty ? '' : val}</div>`;
        });

        html += `</div>`;
    });

    cont.innerHTML = html;
}
