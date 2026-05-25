/**
 * Shared reactive map viewport — persists center + zoom across tab switches
 * (Route / Fixed / Waypoints) so the user doesn't lose their position when
 * switching views. Not URL-serialized (viewport is ephemeral).
 */

let _center = $state<{ lat: number; lon: number } | null>(null);
let _zoom = $state<number | null>(null);

export const mapViewport = {
	get center() { return _center; },
	set center(v) { _center = v; },
	get zoom() { return _zoom; },
	set zoom(v) { _zoom = v; },
};
