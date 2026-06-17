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

    // Hämta befintlig väderkonfiguration
    fetchData('weather_config').then(data => {
        if (data && data.name) {
            currentDisplay.innerHTML = `📍 <strong>${escapeHTML(data.name)}</strong>`;
            hiddenName.value  = data.name;
            hiddenLat.value   = data.latitude;
            hiddenLong.value  = data.longitude;
        } else {
            currentDisplay.innerHTML = '<em style="color:#999">Ingen plats vald ännu.</em>';
        }
    });

    // Sök-knappen: anropar Open-Meteo geocoding API
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

                // Fyll rullgardinen med resultaten
                resultsSelect.innerHTML = data.results.map(r => {
                    const label = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
                    return `<option value="${r.latitude}|${r.longitude}|${escapeHTML(r.name)}">${escapeHTML(label)}</option>`;
                }).join('');

                resultsContainer.style.display = 'block';

                // Välj automatiskt det första resultatet
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

        // Enter i sökfältet triggar sökning
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
        });
    }

    // När användaren väljer i rullgardinen — uppdatera de dolda fälten och visningsrutan
    if (resultsSelect) {
        resultsSelect.addEventListener('change', updateHiddenFromSelect);
    }

    function updateHiddenFromSelect() {
        if (!resultsSelect.value) return;
        const [lat, lon, name] = resultsSelect.value.split('|');
        hiddenLat.value  = lat;
        hiddenLong.value = lon;
        hiddenName.value = name;
        currentDisplay.innerHTML = `📍 <strong>${escapeHTML(name)}</strong> <span style="color:#999; font-size:0.9em;">(${lat}, ${lon})</span> — Klicka "Spara" för att bekräfta.`;
    }

    // Spara-knappen
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
        currentDisplay.innerHTML = `📍 <strong>${escapeHTML(hiddenName.value)}</strong>`;
        // Dölj sökresultaten efter sparande
        if (resultsContainer) resultsContainer.style.display = 'none';
    };
}
