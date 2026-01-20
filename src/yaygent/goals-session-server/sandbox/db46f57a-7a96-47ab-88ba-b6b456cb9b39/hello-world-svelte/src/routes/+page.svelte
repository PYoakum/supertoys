<script>
	// Simple Hello World component
</script>
<svelte:head>
	<title>Hello World - SvelteKit</title>
</svelte:head>
<main>
	<h1>Hello, World!</h1>
	<p>Welcome to your SvelteKit application!</p>
</main>
<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		font-family: Arial, sans-serif;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		text-align: center;
	}
	h1 {
		font-size: 3rem;
		margin-bottom: 1rem;
		text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
	}
	p {
		font-size: 1.2rem;
		opacity: 0.9;
	}
</style>