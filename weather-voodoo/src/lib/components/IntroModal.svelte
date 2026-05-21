<script lang="ts">
	type Props = {
		onClose: () => void;
	};
	let { onClose }: Props = $props();

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKey} />

<div
	class="intro-backdrop"
	role="presentation"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClose(); }}
>
	<div
		class="intro-card"
		role="dialog"
		aria-modal="true"
		aria-labelledby="intro-title"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
	>
		<h2 id="intro-title">🌦️ Welcome to Weather Voodoo</h2>
		<p>
			Find the best hours of the next 3 days for an outdoor or marine trip. Wind, gust, rain,
			wave and visibility are blended into a 0–100 score and the best contiguous windows are
			surfaced for you.
		</p>
		<ul>
			<li><strong>Route</strong>: forecast fused along a path (ferry / kayak / drive).</li>
			<li><strong>Fixed location</strong>: one spot (beach, hike, sunset).</li>
			<li>Pick a duration, a time window, and Sea / Land mode — the table colours each hour by score.</li>
		</ul>
		<div class="intro-actions">
			<a class="btn-ghost" href="/help" onclick={onClose}>Read the full help</a>
			<button type="button" class="btn" onclick={onClose}>Got it</button>
		</div>
	</div>
</div>

<style>
	.intro-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		z-index: 2000;
	}
	.intro-card {
		background: var(--bg-elev, var(--bg));
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 1.2rem 1.4rem;
		max-width: 28rem;
		width: 100%;
		box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
	}
	.intro-card h2 {
		margin: 0 0 0.6rem 0;
		font-size: 1.15rem;
	}
	.intro-card p {
		margin: 0 0 0.7rem 0;
		line-height: 1.45;
	}
	.intro-card ul {
		padding-left: 1.1rem;
		margin: 0 0 1rem 0;
		line-height: 1.5;
	}
	.intro-card li {
		margin-bottom: 0.25rem;
	}
	.intro-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
		flex-wrap: wrap;
	}
</style>
