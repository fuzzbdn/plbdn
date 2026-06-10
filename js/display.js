import { fetchData } from './service.js';
import { getISOWeek, isLight, escapeHTML } from './utils.js';
import { DAYS } from './config.js';

// ==========================================
// KONSTANTER
// FIX: Ersätter magiska tal med namngivna konstanter för läsbarhet
// ==========================================
const CONFIG_CACHE_MS  = 5  * 60 * 1000;  // 5 minuter
const WEATHER_CACHE_MS = 15 * 60 * 1000;  // 15 minuter
const POLL_INTERVAL_MS = 60 * 1000;        // 1 minut

// ==========================================
// GLOBALT TILLSTÅND
// ==========================================
let globalStations       = [];
let globalShifts         = [];
let globalCustomThemes   = [];
let globalScheduleData   = {};

let lastWeatherFetchTime = 0;
let cachedWeatherHtml    = '';
let lastWeatherCoords    = ''; // FIX: Spårar koordinater för att rensa cache vid byte
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

/**
 * Tolkar data som kan vara antingen ett objekt eller en JSON-sträng.
 * Skyddar mot fall där databasen returnerar en textsträng istället för objekt.
 * @param {*} data
 * @returns {Object}
 */
function parseSafe(data) {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return {}; }
    }
    return data || {};
}

/**
 * Validerar att ett koordinatpar är inom rimliga geografiska gränser.
 * FIX: Förhindrar att ogiltiga värden från databasen skickas till väder-API:et.
 * @param {*} lat
 * @param {*} lon
 * @returns {{ lat: number, lon: number } | null}
 */
function parseCoords(lat, lon) {
    const parsedLat = parseFloat(lat);
    const parsedLon = parseFloat(lon);
    if (
        isNaN(parsedLat) || isNaN(parsedLon) ||
        parsedLat < -90  || parsedLat > 90   ||
        parsedLon < -180 || parsedLon > 180
    ) return null;
    return { lat: parsedLat, lon: parsedLon };
}

// ==========================================
// HUVUD-FUNKTION
// ==========================================

export async function initDisplay() {
    const urlParams     = new URLSearchParams(window.location.search);
    const displayToken  = urlParams.get('token');

    // FIX: Token visas i felmeddelande men skickas också med i alla API-anrop nedan
    if (!displayToken) {
        document.body.innerHTML = "<h1 style='color:red;text-align:center;padding-top:10%;'>Åtkomst nekad. Display-nyckel saknas i URL:en.</h1>";
        return;
    }

    globalCustomThemes = await fetchData('custom_themes') || [];

    async function updateDisplay() {
        try {
            const now       = new Date();
            const tzoffset  = now.getTimezoneOffset() * 60000;
            const todayStr  = (new Date(now.getTime() - tzoffset)).toISOString().slice(0, 10);

            // Kolla om vi behöver hämta inställningar (var CONFIG_CACHE_MS)
            const fetchConfig = (now.getTime() - cachedConfig.lastConfigFetch > CONFIG_CACHE_MS);

            // FIX: Skicka med displayToken i varje anrop så att servern kan
            // autentisera förfrågan. Utan detta skyddar token ingenting.
            const bundleData = await fetchData(
                'display_bundle',
                `&start_date=${todayStr}&end_date=${todayStr}&include_config=${fetchConfig}&token=${encodeURIComponent(displayToken)}`
            );

            if (!bundleData) return;

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
            // FIX: Inverterat villkor – den tomma if-grenen är borttagen.
            // DOM:en ritas bara om om något faktiskt har ändrats.
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

                // Tema
                // SÄKERHETSNOTERING: t.css injiceras direkt i DOM:en.
                // Säkerställ att CSS valideras/saneras server-side innan lagring,
                // och att en Content Security Policy (CSP) är konfigurerad.
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
                        if (styleEl.innerHTML !== t.css) styleEl.innerHTML = t.css;
                    }
                } else {
                    if (styleEl) styleEl.remove();
                }
            }

            // --- VÄDERHANTERING ---
            // Körs oavsett snapshot, men har egen cooldown via WEATHER_CACHE_MS
            const wc = cachedConfig.weatherConfig;
            if (wc?.latitude && wc?.longitude) {

                // FIX: Validera koordinater innan de skickas till externt API
                const coords = parseCoords(wc.latitude, wc.longitude);
                if (!coords) {
                    console.warn('Ogiltiga väderkoordinater i inställningarna:', wc.latitude, wc.longitude);
                } else {
                    const coordKey = `${coords.lat},${coords.lon}`;

                    // FIX: Rensa väder-cache om koordinaterna har bytts
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
                                    // Spara icon och temperatur separat för säker rendering
                                    cachedWeatherHtml = { icon, temp };
                                    lastWeatherFetchTime = nowMs;
                                }
                            }
                        } catch (err) {
                            console.error('Kunde inte hämta väder:', err);
                        }
                    }

                    // FIX: Använd textContent på separata element istället för innerHTML
                    // med data från ett externt API för att undvika XSS
                    const weatherEl = document.getElementById('weatherWidget');
                    if (weatherEl && cachedWeatherHtml) {
                        weatherEl.innerHTML = '';

                        const locationSpan = document.createElement('span');
                        locationSpan.style.cssText = 'font-size:0.6em; color:var(--sub-text,#666); margin-right:8px; text-transform:uppercase;';
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

    // Starta cykeln
    await updateDisplay();

    // FIX: Yttre try/catch i setInterval-callbacken fångar upp oväntade fel
    // och förhindrar att displayloopen slutar köra tyst
    setInterval(async () => {
        try { await updateDisplay(); }
        catch (e) { console.error('Kritiskt fel i displayloop:', e); }
    }, POLL_INTERVAL_MS);

    // Klockan uppdateras separat för att vara exakt på sekunden
    setInterval(() => {
        const now = new Date();
        const clk = document.getElementById('clock');
        if (clk) clk.innerText = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }, 1000);
}

// ==========================================
// RENDERING
// ==========================================

/**
 * Ritar upp schemarutnätet i DOM:en.
 * FIX: Tidigt avbrott med feedback om grunddata saknas.
 */
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
            const val         = assignments
                .map(a => a.display_name || `${a.first_name || ''} ${a.last_name || ''}`.trim())
                .join(' / ');

            html += `<div class="shift-card ${val ? '' : 'empty'}" data-label="${escapeHTML(sh.label)}">${escapeHTML(val)}</div>`;
        });

        html += `</div>`;
    });

    cont.innerHTML = html;
}
