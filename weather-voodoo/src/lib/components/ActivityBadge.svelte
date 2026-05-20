<script lang="ts">
	import type { Verdict } from '$lib/types';
	let { verdict, label }: { verdict: Verdict; label: string } = $props();
</script>

<span class="badge badge-{verdict}" title={label}>{label}</span>
