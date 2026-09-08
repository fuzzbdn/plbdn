/**
 * ============================================================================
 * WEATHER.JS
 * Hanterar fliken "Väder-Widget" under Inställningar.
 * Låter användaren söka efter en stad, hämtar dess koordinater via 
 * Open-Meteo Geocoding API och sparar detta i databasen så att display.js 
 * vet vilken orts väder som ska visas på TV-skärmen.
 * ============================================================================
 */

import { fetchData, saveData } from '../service.js';
import { showToast, escapeHTML } from '../utils.js';

/**
 * Initierar väderinställningarna, hämtar tidigare sparad ort och binder
 * event-lyssnare till sök- och spara-knapparna.
 */
export function initWeatherTab() {
    // Dolda fält (input type="hidden") som lagrar den valda ortens exakta data
    const hiddenName    = document.getElementById('weatherCityName');
    const hiddenLat     = document.getElementById('weatherLat');
    const hiddenLong    = document.getElementById('weatherLong');
    
    // UI-element
    const currentDisplay   = document.getElementById('currentWeatherDisplay');
    const searchInput      = document.getElementById('weatherSearchInput');
    const searchBtn        = document.getElementById('searchLocationBtn');
    const resultsContainer = document.getElementById('searchResultsContainer');
    const resultsSelect    = document.getElementById('locationResultsSelect');

    if (!hiddenName) return;

    /**
     * Ritar ut vald ort i gränssnittet säkert via DOM API.
     * (Ett säkrare alternativ till att stoppa in strängar direkt i innerHTML).
     * 
     * @param {string} name - Ortens namn.
     * @param {string|null} lat - Latitud (valfritt, visas inom parantes).
     * @param {string|null} lon - Longitud (valfritt).
     * @param {boolean} pendingSave - Om true, visa varning om att datan inte är sparad än.
     */
    const setWeatherDisplay = (name, lat = null, lon = null, pendingSave = false) => {
        currentDisplay.innerHTML = '';
        
        const icon = document.createTextNode('📍 ');
        const strong = document.createElement('strong');
        strong.textContent = name;
        
        currentDisplay.appendChild(icon);
        currentDisplay.appendChild(strong);
        
        if (lat && lon) {
            const coords = document.createElement('span');
            coords.style.cssText = 'color:#999; font-size:0.9em;';
            coords.textContent = ` (${lat}, ${lon})`;
            currentDisplay.appendChild(coords);
            
            if (pendingSave) {
                currentDisplay.appendChild(document.createTextNode(' — Klicka "Spara" för att bekräfta.'));
            }
        }
    };

    // ==========================================
    // 1. Hämta tidigare sparad väderkonfiguration
    // ==========================================
    fetchData('weather_config').then(res => {
        const data = res?.success ? res.data : null;
        if (data?.name) {
            setWeatherDisplay(data.name);
            hiddenName.value  = data.name;
            hiddenLat.value   = data.latitude;
            hiddenLong.value  = data.longitude;
        } else {
            const em = document.createElement('em');
            em.style.color = '#999';
            em.textContent = 'Ingen plats vald ännu.';
            currentDisplay.innerHTML = '';
            currentDisplay.appendChild(em);
        }
    });

    // ==========================================
    // 2. Hantera Sökfunktionen
    // ==========================================
    if (searchBtn && searchInput) {
        /**
         * Skickar sökningen till Open-Meteo och renderar resultaten 
         * i en select-dropdown.
         */
        const doSearch = async () => {
            const query = searchInput.value.trim();
            if (!query) return showToast("Ange ett stadsnamn att söka efter", "info");

            searchBtn.disabled = true;
            searchBtn.innerText = "Söker...";

            try {
                // Anropar Open-Meteos gratis Geocoding-API
                const res = await fetch(
                    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=sv&format=json`
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();

                if (!data.results || data.results.length === 0) {
                    showToast("Inga platser hittades — prova ett annat namn", "info");
                    resultsContainer.style.display = 'none';
                    return;
                }

                // Bygg <option>-element av sökresultaten.
                // Värdet separeras med '|' (Latitud | Longitud | Namn) så vi kan läsa ut det senare.
                resultsSelect.innerHTML = data.results.map(r => {
                    const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
                    return `<option value="${r.latitude}|${r.longitude}|${escapeHTML(r.name)}">${escapeHTML(label)}</option>`;
                }).join('');

                resultsContainer.style.display = 'block';
                
                // Trigga den dolda uppdateringen för det översta (förvalda) sökresultatet
                updateHiddenFromSelect();

            } catch (err) {
                showToast("Kunde inte söka platser — kontrollera nätverksanslutningen", "error");
                console.error("Geocoding-fel:", err);
            } finally {
                searchBtn.disabled = false;
                searchBtn.innerText = "🔍 Sök";
            }
        };

        searchBtn.onclick = doSearch;

        // Tillåt att man trycker Enter-tangenten i sökrutan
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
        });
    }

    // ==========================================
    // 3. Hantera Val av Sökresultat & Sparande
    // ==========================================
    if (resultsSelect) {
        // Uppdatera de dolda fälten (input type="hidden") när användaren byter ort i listan
        resultsSelect.addEventListener('change', updateHiddenFromSelect);
    }

    /**
     * Splittar värdet i dropdown-menyn och fyller de dolda fälten.
     */
    function updateHiddenFromSelect() {
        if (!resultsSelect.value) return;
        const [lat, lon, name] = resultsSelect.value.split('|');
        hiddenLat.value  = lat;
        hiddenLong.value = lon;
        hiddenName.value = name;
        
        // Uppdatera gränssnittet och indikera att användaren måste spara
        setWeatherDisplay(name, lat, lon, true);
    }

    /**
     * Skickar de valda koordinaterna till databasen.
     */
    document.getElementById('saveWeatherBtn').onclick = async () => {
        if (!hiddenLat.value || !hiddenLong.value || !hiddenName.value) {
            return showToast("Sök och välj en plats innan du sparar", "info");
        }
        
        await saveData('weather_config', {
            name:      hiddenName.value,
            latitude:  hiddenLat.value,
            longitude: hiddenLong.value
        });
        
        showToast("Väderplats sparad!", "success");
        setWeatherDisplay(hiddenName.value); // Tar bort "Klicka Spara"-varningen
        
        if (resultsContainer) resultsContainer.style.display = 'none';
    };
}
