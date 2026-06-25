import { fetchData, saveData } from '../service.js';
import { showToast, escapeHTML } from '../utils.js';

export function initWeatherTab() {
    const hiddenName    = document.getElementById('weatherCityName');
    const hiddenLat     = document.getElementById('weatherLat');
    const hiddenLong    = document.getElementById('weatherLong');
    const currentDisplay = document.getElementById('currentWeatherDisplay');
    const searchInput   = document.getElementById('weatherSearchInput');
    const searchBtn     = document.getElementById('searchLocationBtn');
    const resultsContainer = document.getElementById('searchResultsContainer');
    const resultsSelect = document.getElementById('locationResultsSelect');

    if (!hiddenName) return;

    // Säker rendering av väder-display via DOM istället för innerHTML
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

    // Hämta befintlig väderkonfiguration
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

    if (searchBtn && searchInput) {
        const doSearch = async () => {
            const query = searchInput.value.trim();
            if (!query) return showToast("Ange ett stadsnamn att söka efter", "info");

            searchBtn.disabled = true;
            searchBtn.innerText = "Söker...";

            try {
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

                resultsSelect.innerHTML = data.results.map(r => {
                    const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
                    return `<option value="${r.latitude}|${r.longitude}|${escapeHTML(r.name)}">${escapeHTML(label)}</option>`;
                }).join('');

                resultsContainer.style.display = 'block';
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

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
        });
    }

    if (resultsSelect) {
        resultsSelect.addEventListener('change', updateHiddenFromSelect);
    }

    function updateHiddenFromSelect() {
        if (!resultsSelect.value) return;
        const [lat, lon, name] = resultsSelect.value.split('|');
        hiddenLat.value  = lat;
        hiddenLong.value = lon;
        hiddenName.value = name;
        setWeatherDisplay(name, lat, lon, true);
    }

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
        setWeatherDisplay(hiddenName.value);
        if (resultsContainer) resultsContainer.style.display = 'none';
    };
}
