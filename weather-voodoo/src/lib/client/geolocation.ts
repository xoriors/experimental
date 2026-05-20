export function getCurrentPosition(timeoutMs = 10_000): Promise<{ lat: number; lon: number }> {
	return new Promise((resolve, reject) => {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			reject(new Error('Geolocation not supported'));
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
			(err) => reject(err),
			{ timeout: timeoutMs, enableHighAccuracy: false, maximumAge: 60_000 }
		);
	});
}
