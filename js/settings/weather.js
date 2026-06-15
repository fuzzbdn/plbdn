import { fetchData, saveData } from '../service.js';
import { showToast, escapeHTML } from '../utils.js';

export function initWeatherTab() {
    const hiddenName = document.getElementById('weatherCityName');
    const hiddenLat = document.getElementById('weatherLat');
    const hiddenLong = document.getElementById('weatherLong');
    const currentDisplay = document.getElementById('currentWeatherDisplay');
    
    if (!hiddenName) return;

    // Hämta befintlig väderkonfiguration
    fetchData('weather_config').then(data => {
        if (data && data.name) {
            currentDisplay.innerHTML = `📍 <strong>${escapeHTML(data.name)}</strong>`;
            hiddenName.value = data.name;
            hiddenLat.value = data.latitude;
            hiddenLong.value = data.longitude;
        }
    });

    document.getElementById('saveWeatherBtn').onclick = async () => {
        await saveData('weather_config', {
            name: hiddenName.value,
            latitude: hiddenLat.value,
            longitude: hiddenLong.value
        });
        showToast("Väderplats sparad!", "success");
    };
}
