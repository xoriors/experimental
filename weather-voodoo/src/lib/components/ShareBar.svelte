<script lang="ts">
	let { onReset }: { onReset?: () => void } = $props();
	let toast = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;

	function show(msg: string) {
		toast = msg;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => (toast = null), 2200);
	}

	async function copy() {
		if (typeof window === 'undefined') return;
		const url = window.location.href;
		try {
			await navigator.clipboard.writeText(url);
			show('Link copied');
		} catch {
			const input = document.createElement('input');
			input.value = url;
			document.body.appendChild(input);
			input.select();
			try {
				document.execCommand('copy');
				show('Link copied');
			} catch {
				show('Copy failed — long-press the URL bar');
			}
			document.body.removeChild(input);
		}
	}

	async function share() {
		if (typeof navigator === 'undefined' || !('share' in navigator)) {
			await copy();
			return;
		}
		try {
			await navigator.share({
				title: 'Weather forecast',
				text: 'Forecast view',
				url: window.location.href
			});
		} catch {
			// user cancelled
		}
	}
</script>

<div class="share-bar">
	{#if onReset}
		<button
			class="btn-ghost"
			onclick={() => {
				onReset?.();
				show('Reset');
			}}
			title="Clear all selections"
		>↻ Reset</button>
	{/if}
	<button class="btn-ghost" onclick={copy} title="Copy link to clipboard">📋 Copy link</button>
	<button class="btn" onclick={share} title="Share via OS">🔗 Share</button>
</div>

{#if toast}
	<div class="toast" role="status">{toast}</div>
{/if}
