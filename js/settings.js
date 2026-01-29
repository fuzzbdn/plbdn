// NY: VÄDERINSTÄLLNINGAR (MED SÖK)
function initWeatherTab() {
    const searchIn = document.getElementById('weatherSearchInput');
    const searchBtn = document.getElementById('searchLocationBtn');
    const resultsDiv = document.getElementById('searchResultsContainer');
    const resultsSelect = document.getElementById('locationResultsSelect');
    
    const currentDisplay = document.getElementById('currentWeatherDisplay');
    const hiddenLat = document.getElementById('weatherLat');
    const hiddenLong = document.getElementById('weatherLong');
    const hiddenName = document.getElementById('weatherCityName');

    // 1. Ladda nuvarande inställning
    fetchData('weather_config').then(data => {
        if (data && data.name) {
            updateCurrentDisplay(data.name, data.latitude, data.longitude);
        } else {
            // Default till Boden om inget är sparat
            updateCurrentDisplay("BODEN", "65.82", "21.69");
        }
    });

    function updateCurrentDisplay(name, lat, long) {
        currentDisplay.innerHTML = `📍 <strong>${name}</strong> <span style="font-size:0.9em; color:#666;">(${lat}, ${long})</span>`;
        hiddenName.value = name;
        hiddenLat.value = lat;
        hiddenLong.value = long;
    }

    // 2. Sökfunktion
    searchBtn.onclick = async () => {
        const query = searchIn.value.trim();
        if (query.length < 2) return showToast("Skriv minst 2 tecken", "info");

        searchBtn.innerText = "Söker...";
        try {
            // Anropa Open-Meteo Geocoding API
            const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=10&language=sv&format=json`;
            const res = await fetch(url);
            const data = await res.json();

            resultsSelect.innerHTML = ""; // Rensa gamla svar

            if (!data.results || data.results.length === 0) {
                showToast("Inga platser hittades", "info");
                resultsDiv.style.display = "none";
            } else {
                // Fyll rullistan
                data.results.forEach(place => {
                    const country = place.country || "";
                    const admin1 = place.admin1 || ""; // Region/Län
                    const label = `${place.name}, ${admin1} ${country}`;
                    
                    const option = document.createElement('option');
                    option.text = label;
                    // Spara data direkt i värdet som JSON för enkelhetens skull
                    option.value = JSON.stringify({
                        name: place.name,
                        lat: place.latitude,
                        long: place.longitude
                    });
                    resultsSelect.add(option);
                });
                
                resultsDiv.style.display = "block";
                
                // Välj första alternativet automatiskt i dolda fälten för smidighet
                if (data.results.length > 0) {
                    const first = data.results[0];
                    updateCurrentDisplay(first.name, first.latitude, first.longitude);
                }
            }
        } catch (e) {
            console.error(e);
            showToast("Kunde inte söka. Kontrollera nätverk.", "error");
        } finally {
            searchBtn.innerText = "🔍 Sök";
        }
    };

    // 3. När man väljer i listan
    resultsSelect.onchange = () => {
        const selectedData = JSON.parse(resultsSelect.value);
        updateCurrentDisplay(selectedData.name, selectedData.lat, selectedData.long);
    };

    // 4. Spara knapp
    document.getElementById('saveWeatherBtn').onclick = async () => {
        const config = {
            name: hiddenName.value,
            latitude: hiddenLat.value,
            longitude: hiddenLong.value
        };
        
        await saveData('weather_config', config);
        showToast("Plats sparad! Displayen uppdateras strax.", "success");
        
        // Dölj sökresultaten efter sparande för en renare vy
        resultsDiv.style.display = "none";
        searchIn.value = "";
    };
    
    // Låt Enter-tangenten söka
    searchIn.onkeydown = (e) => {
        if(e.key === 'Enter') searchBtn.click();
    };
}
