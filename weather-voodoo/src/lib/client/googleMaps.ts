/// <reference types="google.maps" />

type GoogleNS = { maps: typeof google.maps };

declare global {
	interface Window {
		__gmReady?: () => void;
		__gmPromise?: Promise<GoogleNS>;
		google?: GoogleNS;
	}
}

export function loadGoogleMaps(apiKey: string): Promise<GoogleNS> {
	if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
	if (window.google?.maps) return Promise.resolve(window.google);
	if (window.__gmPromise) return window.__gmPromise;

	window.__gmPromise = new Promise<GoogleNS>((resolve, reject) => {
		window.__gmReady = () => {
			if (window.google) resolve(window.google);
			else reject(new Error('Google Maps callback fired without window.google'));
		};
		const s = document.createElement('script');
		s.async = true;
		s.defer = true;
		s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=__gmReady`;
		s.onerror = () => reject(new Error('Google Maps script failed to load'));
		document.head.appendChild(s);
	});
	return window.__gmPromise;
}
