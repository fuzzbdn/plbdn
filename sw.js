// ==========================================
// SERVICE WORKER FÖR STRUL PWA
// ==========================================

// Byt version när du uppdaterar CSS/JS så att telefonerna hämtar de nya filerna!
const CACHE_NAME = 'strul-cache-v3.13';

// Filer som ska sparas lokalt på telefonen direkt när appen installeras
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/user.html',
    '/admin.html',
    '/display.html',
    '/settings.html',
    '/manual.html',
    '/reset.html',
    '/css/base.css',
    '/css/admin.css',
    '/css/user.css',
    '/css/login.css',
    '/css/display.css',
    '/js/main.js',
    '/js/config.js',
    // Har du andra moduler? Lägg till dem här: '/js/api/schedule.js' etc.
    '/icon-192.png',
    '/icon-512.png',
    '/manifest.webmanifest'
];

// 1. INSTALLATION: Spara alla statiska filer
self.addEventListener('install', (event) => {
    // "Tvinga" den nya service workern att ta över direkt
    self.skipWaiting();
    
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('SW: Cachar statiska filer...');
            return cache.addAll(STATIC_ASSETS);
        })
    );
});

// 2. AKTIVERING: Städa bort gamla versioner
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Om cachenamnet inte matchar nuvarande version, ta bort den
                    if (cacheName !== CACHE_NAME) {
                        console.log('SW: Rensar gammal cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// 3. FETCH: Bestäm hur appen ska hämta data
self.addEventListener('fetch', (event) => {
    
    // Ignorera API-anrop (viktigt! vi vill inte cacha data från databasen)
    // Antar att dina databasanrop går mot /api/ eller Supabase
    if (event.request.url.includes('/api/')) {
        return; // Låt webbläsaren sköta API-anropet normalt
    }

    // Network First-strategi (Försök ladda från nätet först, fall tillbaka på cache om användaren är offline)
    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Om vi får svar från nätet, lägg kopian i cachen och returnera
                return caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            })
            .catch(() => {
                // Om nätet är nere, hämta från cachen
                return caches.match(event.request);
            })
    );
});
