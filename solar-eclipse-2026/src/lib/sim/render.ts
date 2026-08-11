/**
 * Canvas renderer for the eclipse sky.
 *
 * Everything drawn here is placed from computed geometry: the Sun sits at its
 * real altitude and azimuth, the Moon at its real offset with the right size
 * ratio and the right orientation relative to the horizon, and the stars where
 * they actually are. The one deliberately artistic element is the corona, which
 * cannot be predicted in advance.
 */

import { DEG, clamp } from '../eclipse/besselian';
import { refraction, skyGeometry, type SkyGeometry } from '../eclipse/local';
import type { Observer } from '../eclipse/besselian';
import { rgb, skyState, starVisibility, type SkyState } from './sky';
import { limbPath, makeLimbProfile } from './limb';
import { makeProminences, type CoronaImage, type Prominence } from './corona';
import { toHorizon, visibleSkyObjects, type SkyObject } from './sky-objects';

export interface Camera {
	/** Half-width of the view in degrees. */
	fieldOfView: number;
	/** Extra pan applied to the view centre, degrees. */
	panAltitude: number;
	panAzimuth: number;
}

export interface Scene {
	observer: Observer;
	time: Date;
	t: number;
	camera: Camera;
	/** Show the horizon and landscape. */
	showLandscape: boolean;
	showLabels: boolean;
	applyRefraction: boolean;
}

const limbProfile = makeLimbProfile();
const prominences = makeProminences();

/** Gnomonic projection of a sky direction onto the screen. */
function project(
	altitude: number,
	azimuth: number,
	centreAlt: number,
	centreAz: number,
	scale: number,
	cx: number,
	cy: number
): { x: number; y: number; visible: boolean } {
	const a = altitude * DEG;
	const a0 = centreAlt * DEG;
	let dAz = (azimuth - centreAz) * DEG;
	dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));

	const cosC = Math.sin(a0) * Math.sin(a) + Math.cos(a0) * Math.cos(a) * Math.cos(dAz);
	if (cosC <= 0.01) return { x: 0, y: 0, visible: false };

	const x = (Math.cos(a) * Math.sin(dAz)) / cosC;
	const y = (Math.cos(a0) * Math.sin(a) - Math.sin(a0) * Math.cos(a) * Math.cos(dAz)) / cosC;
	return { x: cx + x * scale, y: cy - y * scale, visible: true };
}

/** Paint the sky background, blending horizon colour with height and bearing. */
function drawSky(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	sky: SkyState,
	sunAltitude: number,
	centreAlt: number,
	scale: number,
	cy: number
) {
	// Where the horizon falls on screen.
	const horizonY = cy + Math.tan(centreAlt * DEG) * scale;
	const topAltitude = centreAlt + Math.atan(cy / scale) / DEG;

	// Build the gradient from sky altitude rather than from screen fraction, so
	// the warm band stays pinned to the last few degrees above the horizon
	// instead of stretching across the whole frame when zoomed in.
	const yAt = (altitude: number) => cy - Math.tan((altitude - centreAlt) * DEG) * scale;
	const stops: Array<[number, [number, number, number]]> = [
		[0, sky.horizonSunward],
		[2.5, mixColour(sky.horizonSunward, sky.zenith, 0.32)],
		[8, mixColour(sky.horizonSunward, sky.zenith, 0.62)],
		[20, mixColour(sky.horizonSunward, sky.zenith, 0.85)],
		[45, sky.zenith],
		[90, sky.zenith]
	];

	const top = Math.min(0, yAt(Math.max(90, topAltitude)));
	const bottom = Math.max(height, horizonY);
	if (bottom - top > 1) {
		const gradient = ctx.createLinearGradient(0, top, 0, bottom);
		for (const [altitude, colour] of stops) {
			const y = yAt(altitude);
			const offset = clamp((y - top) / (bottom - top), 0, 1);
			gradient.addColorStop(offset, rgb(colour));
		}
		ctx.fillStyle = gradient;
	} else {
		ctx.fillStyle = rgb(sky.zenith);
	}
	ctx.fillRect(0, 0, width, height);

	// A brighter band hugging the horizon under the Sun. During totality this is
	// the ring of light coming from outside the umbra, which stays lit because
	// the shadow is only a few hundred kilometres across.
	if (horizonY > -height && horizonY < height * 2) {
		const glowHeight = Math.max(24, Math.abs(yAt(0) - yAt(4)));
		const glow = ctx.createLinearGradient(0, horizonY - glowHeight, 0, horizonY);
		glow.addColorStop(0, rgb(sky.horizonSunward, 0));
		glow.addColorStop(1, rgb(sky.horizonSunward, sunAltitude < 15 ? 0.7 : 0.3));
		ctx.fillStyle = glow;
		ctx.fillRect(0, horizonY - glowHeight, width, glowHeight);
	}
}

function mixColour(
	a: [number, number, number],
	b: [number, number, number],
	t: number
): [number, number, number] {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Stars and planets, faded in as the sky darkens. */
function drawSkyObjects(
	ctx: CanvasRenderingContext2D,
	scene: Scene,
	sky: SkyState,
	objects: SkyObject[],
	centreAlt: number,
	centreAz: number,
	scale: number,
	cx: number,
	cy: number
) {
	for (const object of objects) {
		const visibility = starVisibility(object.magnitude, sky.darkness);
		if (visibility <= 0.02) continue;

		const horizon = toHorizon(object, scene.time, scene.observer.lat, scene.observer.lon);
		if (horizon.altitude < -0.5) continue;

		const p = project(
			horizon.altitude + (scene.applyRefraction ? refraction(horizon.altitude) : 0),
			horizon.azimuth,
			centreAlt,
			centreAz,
			scale,
			cx,
			cy
		);
		if (!p.visible) continue;

		const size = clamp(2.6 - object.magnitude * 0.55, 0.7, 5.5) * (object.kind === 'planet' ? 1.25 : 1);
		const alpha = visibility;

		if (object.kind === 'planet') {
			const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 4);
			halo.addColorStop(0, `rgba(255,248,232,${alpha * 0.7})`);
			halo.addColorStop(1, 'rgba(255,248,232,0)');
			ctx.fillStyle = halo;
			ctx.beginPath();
			ctx.arc(p.x, p.y, size * 4, 0, Math.PI * 2);
			ctx.fill();
		}

		ctx.fillStyle = `rgba(255,253,246,${alpha})`;
		ctx.beginPath();
		ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
		ctx.fill();

		if (scene.showLabels && object.magnitude < 1.6 && alpha > 0.45) {
			ctx.fillStyle = `rgba(226,232,240,${alpha * 0.75})`;
			ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
			ctx.fillText(object.name, p.x + size + 5, p.y - size - 3);
		}
	}
}

/** The Sun's disc, with limb darkening and the bloom of an overexposed source. */
function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
	const disc = ctx.createRadialGradient(x, y, 0, x, y, radius);
	disc.addColorStop(0, '#fffdf5');
	disc.addColorStop(0.82, '#fff8e2');
	// Real limb darkening leaves the edge at roughly 40 percent of centre
	// brightness, though at this exposure it still reads as white.
	disc.addColorStop(1, '#ffe9b8');
	ctx.fillStyle = disc;
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, Math.PI * 2);
	ctx.fill();
}

function drawSunGlow(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	strength: number
) {
	if (strength <= 0.001) return;
	const extent = radius * (3 + 9 * strength);
	const glow = ctx.createRadialGradient(x, y, radius * 0.8, x, y, extent);
	glow.addColorStop(0, `rgba(255,247,220,${0.5 * strength})`);
	glow.addColorStop(0.35, `rgba(255,236,180,${0.16 * strength})`);
	glow.addColorStop(1, 'rgba(255,230,170,0)');
	ctx.fillStyle = glow;
	ctx.beginPath();
	ctx.arc(x, y, extent, 0, Math.PI * 2);
	ctx.fill();
}

/** The chromosphere and prominences, visible only in the seconds around totality. */
function drawChromosphere(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	sunRadius: number,
	moonRadius: number,
	/** Visible only in the second or two either side of totality. */
	rimAlpha: number,
	/** Prominences stand well above the limb and last the whole of totality. */
	prominenceAlpha: number,
	/** Direction from the Moon's centre towards the Sun's, in canvas radians. */
	tangentAngle: number,
	list: Prominence[]
) {
	if (rimAlpha > 0.01) {
		// The chromosphere is only uncovered on the side where the Sun's limb and
		// the Moon's limb are nearly touching, so it appears as a short arc rather
		// than a complete ring. `tangentAngle` points from the Moon to the Sun.
		const halfWidth = (Math.PI / 180) * (35 + 40 * rimAlpha);
		ctx.save();
		ctx.globalAlpha = rimAlpha;
		ctx.strokeStyle = 'rgba(255,86,74,0.92)';
		ctx.lineWidth = Math.max(1, sunRadius * 0.03);
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.arc(x, y, moonRadius * 1.003, tangentAngle - halfWidth, tangentAngle + halfWidth);
		ctx.stroke();
		ctx.restore();
	}

	if (prominenceAlpha <= 0.01) return;
	ctx.save();
	ctx.globalAlpha = prominenceAlpha;

	for (const p of list) {
		const base = moonRadius;
		// Real prominences reach a few percent of a solar radius above the limb.
		const height = sunRadius * p.height;
		ctx.beginPath();
		ctx.moveTo(x + base * Math.cos(p.angle - p.width), y + base * Math.sin(p.angle - p.width));
		ctx.quadraticCurveTo(
			x + (base + height) * Math.cos(p.angle),
			y + (base + height) * Math.sin(p.angle),
			x + base * Math.cos(p.angle + p.width),
			y + base * Math.sin(p.angle + p.width)
		);
		ctx.closePath();
		const flame = ctx.createRadialGradient(x, y, base, x, y, base + height);
		flame.addColorStop(0, 'rgba(255,118,110,0.85)');
		flame.addColorStop(0.55, 'rgba(255,92,104,0.45)');
		flame.addColorStop(1, 'rgba(255,72,110,0)');
		ctx.fillStyle = flame;
		ctx.fill();
	}
	ctx.restore();
}

/** A simple hilly skyline so the low Sun has something to set behind. */
function drawLandscape(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	horizonY: number,
	sky: SkyState
) {
	if (horizonY > height + 40) return;

	// Ground below the horizon.
	const groundTone = Math.round(10 + 26 * (1 - sky.darkness));
	ctx.fillStyle = `rgb(${groundTone},${groundTone + 2},${groundTone + 6})`;
	ctx.fillRect(0, horizonY, width, Math.max(0, height - horizonY));

	// A ridge line, drawn as a few overlapping smooth humps.
	ctx.beginPath();
	ctx.moveTo(0, horizonY);
	const amplitude = Math.min(28, height * 0.045);
	for (let x = 0; x <= width; x += 6) {
		const u = x / width;
		const ridge =
			Math.sin(u * 7.3 + 0.6) * 0.5 +
			Math.sin(u * 17.1 + 2.1) * 0.28 +
			Math.sin(u * 31.7 + 4.4) * 0.14;
		ctx.lineTo(x, horizonY - ridge * amplitude - amplitude * 0.35);
	}
	ctx.lineTo(width, height);
	ctx.lineTo(0, height);
	ctx.closePath();
	const ridgeTone = Math.round(6 + 16 * (1 - sky.darkness));
	ctx.fillStyle = `rgb(${ridgeTone},${ridgeTone + 1},${ridgeTone + 4})`;
	ctx.fill();
}

export interface RenderResult {
	geometry: SkyGeometry;
	sky: SkyState;
	/** Screen position and size of the Sun, for overlays. */
	sunScreen: { x: number; y: number; radius: number };
}

export function renderScene(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	scene: Scene,
	corona: CoronaImage | null
): RenderResult {
	const geometry = skyGeometry(scene.t, scene.observer);
	const sky = skyState(geometry.altitude, geometry.obscuration, geometry.magnitude);

	const displayedAltitude =
		geometry.altitude + (scene.applyRefraction ? refraction(geometry.altitude) : 0);

	const centreAlt = displayedAltitude + scene.camera.panAltitude;
	const centreAz = geometry.azimuth + scene.camera.panAzimuth;
	// The field of view is the *vertical* one, so that widening it always brings
	// more sky and eventually the horizon into frame regardless of aspect ratio.
	const scale = height / 2 / Math.tan((scene.camera.fieldOfView / 2) * DEG);
	const cx = width / 2;
	const cy = height / 2;

	ctx.clearRect(0, 0, width, height);
	drawSky(ctx, width, height, sky, geometry.altitude, centreAlt, scale, cy);

	const objects = visibleSkyObjects(scene.time);
	drawSkyObjects(ctx, scene, sky, objects, centreAlt, centreAz, scale, cx, cy);

	// Position of the Sun on screen.
	const sunPoint = project(displayedAltitude, geometry.azimuth, centreAlt, centreAz, scale, cx, cy);
	const pixelsPerDegree = scale * DEG;
	const sunRadius = geometry.sunRadius * pixelsPerDegree;
	const moonRadius = geometry.moonRadius * pixelsPerDegree;
	const moonX = sunPoint.x + geometry.offsetRight * pixelsPerDegree;
	const moonY = sunPoint.y - geometry.offsetUp * pixelsPerDegree;

	const totality = geometry.obscuration >= 1;
	// During totality the Moon's limb sits between the Sun's limb (at second and
	// third contact) and the Sun's centre (at mid-totality). How near it is to
	// the Sun's limb decides whether the chromosphere and the diamond ring show:
	// both last only a second or two, so the window has to be genuinely narrow.
	const limbGap = Math.abs(geometry.separation - (geometry.moonRadius - geometry.sunRadius));
	const edgeProximity = clamp(1 - limbGap / (geometry.sunRadius * 0.02), 0, 1);

	// The Sun, corona and Moon go onto their own layer so the Moon can subtract
	// what it covers without punching a hole in the sky behind.
	const layer = document.createElement('canvas');
	layer.width = width;
	layer.height = height;
	const lc = layer.getContext('2d')!;

	if (corona && totality) {
		// The corona only emerges once the photosphere is gone, and it takes an
		// instant to fade up as the last sliver closes.
		const strength = clamp(1 - edgeProximity * 0.55, 0, 1);
		const size = moonRadius * corona.extent * 2 * (geometry.sunRadius / geometry.moonRadius);
		lc.save();
		lc.globalAlpha = strength;
		lc.translate(moonX, moonY);
		// The corona keeps its orientation on the sky, so rotate it with the
		// parallactic angle to keep it fixed relative to the horizon.
		lc.rotate(-geometry.parallactic * DEG);
		lc.drawImage(corona.canvas, -size / 2, -size / 2, size, size);
		lc.restore();
	}

	drawSun(lc, sunPoint.x, sunPoint.y, sunRadius);

	// Erase whatever the Moon covers, using a ragged limb so that Baily's beads
	// appear naturally in the last seconds before and first seconds after totality.
	lc.save();
	lc.globalCompositeOperation = 'destination-out';
	lc.fillStyle = '#000';
	lc.fill(limbPath(limbProfile, moonX, moonY, moonRadius, 900));
	lc.restore();

	ctx.drawImage(layer, 0, 0);

	// Direction from the Moon's centre to the Sun's: the side where the last and
	// first light appears, and where the chromosphere peeps out.
	const tangentAngle = Math.atan2(sunPoint.y - moonY, sunPoint.x - moonX);
	const tangentX = moonX + moonRadius * Math.cos(tangentAngle);
	const tangentY = moonY + moonRadius * Math.sin(tangentAngle);

	// Bloom around whatever is left of the Sun, which is what makes a partial
	// eclipse so hard to notice without a filter.
	if (!totality) {
		drawSunGlow(ctx, sunPoint.x, sunPoint.y, sunRadius, Math.pow(sky.light, 0.55));
	} else if (edgeProximity > 0) {
		// The diamond ring sits at the point of tangency, not at the centre.
		drawSunGlow(ctx, tangentX, tangentY, sunRadius * 0.6, edgeProximity * 0.85);
	}

	if (totality) {
		// The Moon's disc reads as a hole slightly darker than the sky.
		ctx.fillStyle = 'rgba(4,5,10,0.92)';
		ctx.fill(limbPath(limbProfile, moonX, moonY, moonRadius, 720));
		drawChromosphere(
			ctx,
			moonX,
			moonY,
			sunRadius,
			moonRadius,
			edgeProximity,
			0.8,
			tangentAngle,
			prominences
		);
	}

	if (scene.showLandscape) {
		const horizonY = cy + Math.tan(centreAlt * DEG) * scale;
		drawLandscape(ctx, width, height, horizonY, sky);
	}

	return {
		geometry,
		sky,
		sunScreen: { x: sunPoint.x, y: sunPoint.y, radius: sunRadius }
	};
}
