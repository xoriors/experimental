<script lang="ts">
	let { code }: { code: number } = $props();

	function iconFor(c: number): string {
		if (c === 0) return '☀️';
		if (c <= 2) return '🌤️';
		if (c === 3) return '☁️';
		if (c === 45 || c === 48) return '🌫️';
		if (c >= 51 && c <= 57) return '🌦️';
		if (c >= 61 && c <= 67) return '🌧️';
		if (c >= 71 && c <= 77) return '🌨️';
		if (c >= 80 && c <= 82) return '🌧️';
		if (c >= 85 && c <= 86) return '🌨️';
		if (c >= 95) return '⛈️';
		return '❔';
	}
</script>

<span aria-hidden="true">{iconFor(code)}</span>
