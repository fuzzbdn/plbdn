/**
 * ============================================================================
 * DISPLAY.JS
 * Hanterar logiken för den dygnet-runt-rullande TV-skärmen ("Displayvyn").
 * Använder en JWT-token från URL:en för säkerhet och Pusher för realtidsuppdateringar.
 * Innehåller även en inbyggd väderwidget.
 * ============================================================================
 */

import { fetchData } from './service.js';
import { getISOWeek, isLight, escapeHTML } from './utils.js';
import { DAYS } from './config.js';

// ==========================================
// KONSTANTER & GLOBALA TIMERS
// ==========================================
// Caching används för att minska antalet tunga anrop till databasen
const CONFIG_CACHE_MS  = 15 * 60 * 1000;  // 15 minuter (Inställningar och rullande text ändras sällan)
const WEATHER_CACHE_MS = 30 * 60 * 1000;  // 30 minuter (OpenMeteo-API behöver inte pollas oftare)
const FALLBACK_POLL_MS = 30 * 60 * 1000;  // 30 minuter (Skyddsnät om WebSockets dör)

// Pusher-nycklar. (Dessa är publika och får finnas i klientkoden, den hemliga nyckeln ligger säkert på backend).
const PUSHER_KEY     = 'bd3dbd5cbb9abb426d43';
const PUSHER_CLUSTER = 'eu';

let fallbackTimer = null; // Timer för backup-polling av schemat
let clockTimer    = null; // Timer för den rullande klockan i hörnet
let pusherClient  = null; // Klienten för realtidsanslutningen
let pusherChannel = null; // Den specifika kanalen vi lyssnar på

// ==========================================
// GLOBALT TILLSTÅND (State)
// ==========================================
let globalStations       = [];
let globalShifts         = [];
let globalCustomThemes   = [];
let globalScheduleData   = {};

let lastWeatherFetchTime = 0;
let cachedWeatherHtml    = '';
let lastWeatherCoords    = '';
let lastDataSnapshot     = ''; // Används för att jämföra om något faktiskt ändrats sedan förra uppdateringen

let cachedConfig = {
    settings:      null,
    message:       null,
    weatherConfig: null,
    lastConfigFetch: 0
};

// ==========================================
// HJÄLPFUNKTIONER
// ==========================================

/**
 * Översätter väderkoder från OpenMeteo API till Emojis.
 * @param {number} code - WMO-väderkoden.
 * @returns {string} En emoji som motsvarar vädret.
 */
function getWeatherIcon(code) {
    if (code === 0)                        return '☀️'; // Klart
    if (code === 1 || code === 2)          return '🌤️'; // Halvklart
    if (code === 3)                        return '☁️'; // Mulet
    if (code === 45 || code === 48)        return '🌫️'; // Dimma
    if (code >= 51 && code <= 67)          return '🌧️'; // Regn
    if (code >= 71 && code <= 86)          return '❄️'; // Snö
    if (code >= 95)                        return '⛈️'; // Åska
    return '🌡️'; // Okänt
}

/**
 * Parsar (tolkar) data till ett JavaScript-objekt utan att krascha vid fel.
 * @param {any} data - Den inkommande datan (oftast en JSON-sträng).
 * @returns {Object} Det tolkade objektet eller ett tomt objekt.
 */
function parseSafe(data) {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return {}; }
    }
    return data || {};
}

/**
 * Validerar och tolkar latitud och longitud för väderwidgeten.
 * Säkerställer att koordinaterna ligger inom giltiga gränser för Jorden.
 */
function parseCoords(lat, lon) {
    const parsedLat = Number.parseFloat(lat);
    const parsedLon = Number.parseFloat(lon);
    if (
        Number.isNaN(parsedLat) || Number.isNaN(parsedLon) ||
        parsedLat < -90  || parsedLat > 90   ||
        parsedLon < -180 || parsedLon > 180
    ) return null;
    return { lat: parsedLat, lon: parsedLon };
}

/**
 * Dekodar (läser av) innehållet i en JSON Web Token (JWT) utan att validera signaturen.
 * Eftersom detta sker i webbläsaren kan vi bara LÄSA innehållet, inte säkerställa äktheten
 * (det görs på servern). Används för att extrahera Workplace ID från tokenet.
 * @param {string} token - Den råa JWT-strängen från URL:en.
 * @returns {Object|null} Payload-objektet (t.ex. { workplaceId: '123' })
 */
function decodeJwtPayload(token) {
    try {
        const payload = token.split('.')[1];
        // Atob() dekodar base64. Ersätter först URL-säkra tecken med standardtecken.
        const decoded = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

// ==========================================
// HUVUD-FUNKTION
// ==========================================

/**
 * Startar upp hela TV-skärmsvyn. Validerar token, hämtar data, ritar upp skärmen
 * och sätter upp realtidsanslutningar.
 */
export async function initDisplay() {
    const urlParams    = new URLSearchParams(window.location.search);
    const displayToken = urlParams.get('token');

    // Säkerhetsstopp: Utan token nekas tillgång
    if (!displayToken) {
        document.body.innerHTML = "<h1 style='color:red;text-align:center;padding-top:10%;'>Åtkomst nekad. Display-nyckel saknas i URL:en.</h1>";
        return;
    }

    // 1. Ladda eventuella egenskapade CSS-teman från servern
    const themesRes = await fetchData('custom_themes', { token: displayToken });
    globalCustomThemes = (themesRes?.success && Array.isArray(themesRes.data)) ? themesRes.data : [];

    /**
     * Huvudrutin för att hämta ner dagsfärskt schema och cacha tunga inställningar.
     */
    async function updateDisplay() {
        try {
            const now       = new Date();
            const tzoffset  = now.getTimezoneOffset() * 60000;
            const todayStr  = (new Date(now.getTime() - tzoffset)).toISOString().slice(0, 10);

            // Avgör om det är dags att hämta ner tunga inställningar (temafiler, meddelanden) igen
            const fetchConfig = (now.getTime() - cachedConfig.lastConfigFetch > CONFIG_CACHE_MS);

            // Hämtar en "Bundle" från backend (allt i ett enda nätverksanrop)
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

            // Bygg om det platta schemat till en optimerad Map
            globalScheduleData = {};
            if (Array.isArray(bundleData.schedule)) {
                bundleData.schedule.forEach(row => {
                    // Displayen visar ENDAST pass som administratören har klickat "Publicera" på
                    if (!row.is_published) return;
                    
                    const key = `${row.station_id}_${row.shift_id}`;
                    if (!globalScheduleData[key]) globalScheduleData[key] = [];
                    globalScheduleData[key].push(row);
                });
            }

            // Uppdatera den lokala config-cachen om vi begärde ny data
            if (fetchConfig) {
                cachedConfig.settings      = parseSafe(bundleData.settings);
                cachedConfig.message       = parseSafe(bundleData.message);
                cachedConfig.weatherConfig = parseSafe(bundleData.weather_config);
                cachedConfig.lastConfigFetch = now.getTime();
            }

            // Skapa en "snapshot" (ögonblicksbild) för att se om vi ens behöver rita om skärmen
            const currentSnapshot = JSON.stringify({
                sch:     globalScheduleData,
                st:      globalStations,
                sh:      globalShifts,
                msg:     cachedConfig.message?.text,
                showMsg: cachedConfig.message?.show
            });

            // Rita BARA om skärmen (DOM-uppdatering) om datan har ändrats, eller om cachen just byttes ut
            if (currentSnapshot !== lastDataSnapshot || fetchConfig) {
                lastDataSnapshot = currentSnapshot;

                const iso      = getISOWeek(now);
                const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
                
                const titleEl  = document.getElementById('mainTitle');
                if (titleEl) {
                    titleEl.innerText = `Vi som jobbar ${DAYS[dayIndex]} ${now.getDate()}/${now.getMonth() + 1} (v.${iso.week})`;
                }

                renderGrid(); // Rita det faktiska schemat

                // Hantera rullande informations-banner i botten (Marquee)
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

                // Injektionsmekanism för skräddarsydd (Custom) CSS
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
                } else if (styleEl) {
                    styleEl.remove();
                }
            }

            // ==========================================
            // VÄDERWIDGET (Använder OpenMeteo)
            // ==========================================
            const wc = cachedConfig.weatherConfig;
            if (wc?.latitude && wc?.longitude) {
                const coords = parseCoords(wc.latitude, wc.longitude);
                if (!coords) {
                    console.warn('Ogiltiga väderkoordinater i inställningarna:', wc.latitude, wc.longitude);
                } else {
                    const coordKey = `${coords.lat},${coords.lon}`;

                    // Rensa cache om koordinaterna har ändrats sedan förra hämtningen
                    if (coordKey !== lastWeatherCoords) {
                        cachedWeatherHtml    = '';
                        lastWeatherFetchTime = 0;
                        lastWeatherCoords    = coordKey;
                    }

                    const nowMs = Date.now();
                    // Hämta nytt väder om TTL (Time To Live) har gått ut
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

                    // Rita ut vädret om vi fick ner datan framgångsrikt
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

    // ==========================================
    // STARTA UPP: Rensa gamla anslutningar & Initiera
    // ==========================================
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

    // Gör en initial inläsning direkt när sidan laddas
    await updateDisplay();

    // Läs av vilken arbetsplats (isolerad zon) vi ska lyssna på
    const payload      = decodeJwtPayload(displayToken);
    const workplaceId  = payload?.workplaceId;

    // Statusindikator (den lilla pricken högst upp i hörnet)
    const dot = document.getElementById('connectionDot');
    const setDotState = (state) => {
        if (!dot) return;
        const states = {
            connecting: { color: '#9e9e9e', title: 'Ansluter...' },
            connected:  { color: '#4caf50', title: 'Ansluten – uppdateras i realtid' },
            error:      { color: '#f44336', title: 'Realtidsanslutning misslyckades – polling aktiv' },
        };
        const s = states[state] || states.connecting;
        dot.style.backgroundColor = s.color;
        dot.title = s.title;
    };

    // ==========================================
    // WEBSOCKETS (Pusher) - Realtidsuppdateringar
    // ==========================================
    if (workplaceId && typeof Pusher !== 'undefined') {
        try {
            pusherClient = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });
            
            // Lyssna på anslutningens hälsa och uppdatera statuspricken
            pusherClient.connection.bind('connected',    () => setDotState('connected'));
            pusherClient.connection.bind('disconnected', () => setDotState('error'));
            pusherClient.connection.bind('failed',       () => setDotState('error'));

            // Prenumerera ENBART på den specifika arbetsplatsens dataström (Privacy/Security)
            pusherChannel = pusherClient.subscribe(`workplace-${workplaceId}`);
            
            // När admin klickar på "Publicera", triggas detta event av servern!
            pusherChannel.bind('schedule-updated', () => { updateDisplay(); });
        } catch (err) {
            console.error('Kunde inte ansluta till Pusher:', err);
            setDotState('error');
        }
    } else {
        console.warn('Kunde inte ansluta till Pusher - saknar workplaceId i token, eller Pusher-biblioteket kunde inte laddas.');
        setDotState('error');
    }

    // ==========================================
    // BACKUP & KLOCKA
    // ==========================================
    // Om Pusher (Websockets) av någon anledning skulle brytas, kommer detta 
    // skyddsnät att hämta schemat varje halvtimme ändå.
    fallbackTimer = setInterval(async () => {
        try { await updateDisplay(); }
        catch (e) { console.error('Kritiskt fel i fallback-polling:', e); }
    }, FALLBACK_POLL_MS);

    // Enkel rullande klocka i gränssnittet
    clockTimer = setInterval(() => {
        const now = new Date();
        const clk = document.getElementById('clock');
        if (clk) clk.innerText = now.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
    }, 1000);
}

// ==========================================
// RENDERING
// ==========================================
/**
 * Bygger och ritar ut HTML-strukturen för själva schematypografin (Rutnätet).
 */
function renderGrid() {
    const cont = document.getElementById('mainContainer');
    if (!cont) return;

    if (!globalShifts.length || !globalStations.length) {
        cont.innerHTML = '<p style="padding:2rem; text-align:center; color:#888;">Inget schema att visa.</p>';
        return;
    }

    const timeHeaders = globalShifts.map(s => `<div class="time-header">${escapeHTML(s.label)}</div>`).join('');
    let html = `<div class="time-header-row"><div></div>${timeHeaders}</div>`;

    globalStations.forEach(st => {
        // Möjlighet att lägga till tomma rader ("Spacers") för att gruppera avdelningar
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

            // Hämta vilka som jobbar just här och nu
            const key         = `${st.id}_${sh.id}`;
            const assignments = globalScheduleData[key] || [];
            
            // Formatera namnen (T.ex. "Anna / Kalle") och lägg till eventuella korta noteringar
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
