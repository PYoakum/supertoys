<script>
	import { onMount } from 'svelte';
	import { jobStore } from '../lib/stores/jobStore.js';
	import VariantSelector from '../lib/components/VariantSelector.svelte';
	import JobPosting from '../lib/components/JobPosting.svelte';

	// Load job data on component mount
	onMount(() => {
		jobStore.loadJobData();
	});
</script>

<svelte:head>
	<title>The Daily Developer - Job Opportunities</title>
	<meta name="description" content="Premium job opportunities in the tech industry" />
</svelte:head>

<main class="newspaper-container">
	<!-- Newspaper Header -->
	<header class="newspaper-header">
		<div class="header-ornament">✦ ✦ ✦</div>
		<h1 class="newspaper-title">THE DAILY DEVELOPER</h1>
		<div class="newspaper-subtitle">Premium Technology Career Opportunities</div>
		<div class="header-date">{new Date().toLocaleDateString('en-US', { 
			weekday: 'long', 
			year: 'numeric', 
			month: 'long', 
			day: 'numeric' 
		})}</div>
		<div class="header-ornament">✦ ✦ ✦</div>
	</header>

	<!-- Navigation Bar -->
	<nav class="newspaper-nav">
		<div class="nav-section">CAREERS</div>
		<div class="nav-divider">|</div>
		<div class="nav-section">OPPORTUNITIES</div>
		<div class="nav-divider">|</div>
		<div class="nav-section">TECHNOLOGY</div>
		<div class="nav-divider">|</div>
		<div class="nav-section">INNOVATION</div>
	</nav>

	<!-- Main Content Area -->
	<div class="newspaper-content">
		<!-- Left Column - Main Story -->
		<section class="main-column">
			<div class="breaking-news-banner">
				<span class="breaking-text">FEATURED OPPORTUNITY</span>
			</div>
			
			<!-- Variant Selector -->
			<div class="variant-selector-container">
				<h2 class="section-header">Choose Your Perspective</h2>
				<p class="section-subtitle">Experience this opportunity through different editorial lenses</p>
				<VariantSelector />
			</div>

			<!-- Job Posting Display -->
			<div class="job-posting-container">
				<JobPosting />
			</div>
		</section>

		<!-- Right Column - Sidebar -->
		<aside class="sidebar-column">
			<!-- Market Updates -->
			<div class="sidebar-section">
				<h3 class="sidebar-header">MARKET UPDATES</h3>
				<div class="sidebar-divider"></div>
				<div class="market-item">
					<strong>Tech Hiring:</strong> Up 15% this quarter
				</div>
				<div class="market-item">
					<strong>Remote Work:</strong> 78% of positions offer flexibility
				</div>
				<div class="market-item">
					<strong>Salary Trends:</strong> Average increase of 12%
				</div>
			</div>

			<!-- Industry News -->
			<div class="sidebar-section">
				<h3 class="sidebar-header">INDUSTRY SPOTLIGHT</h3>
				<div class="sidebar-divider"></div>
				<div class="news-item">
					<h4>AI Revolution Continues</h4>
					<p>Machine learning roles see unprecedented demand across all sectors.</p>
				</div>
				<div class="news-item">
					<h4>Cloud Migration Boom</h4>
					<p>Enterprise cloud adoption drives need for specialized architects.</p>
				</div>
			</div>

			<!-- Career Tips -->
			<div class="sidebar-section">
				<h3 class="sidebar-header">CAREER INSIGHTS</h3>
				<div class="sidebar-divider"></div>
				<div class="tip-item">
					<strong>Interview Prep:</strong> Practice system design questions for senior roles
				</div>
				<div class="tip-item">
					<strong>Portfolio:</strong> Showcase real-world problem solving
				</div>
				<div class="tip-item">
					<strong>Networking:</strong> Engage with tech communities online
				</div>
			</div>

			<!-- Advertisement Space -->
			<div class="sidebar-section ad-section">
				<div class="ad-header">SPONSORED</div>
				<div class="ad-content">
					<h4>Boost Your Skills</h4>
					<p>Professional development courses for modern developers</p>
					<div class="ad-cta">Learn More →</div>
				</div>
			</div>
		</aside>
	</div>

	<!-- Footer -->
	<footer class="newspaper-footer">
		<div class="footer-ornament">◆ ◆ ◆</div>
		<div class="footer-content">
			<div class="footer-section">
				<strong>The Daily Developer</strong> - Your trusted source for premium technology career opportunities
			</div>
			<div class="footer-section">
				Established 2024 | Volume 1, Issue 1
			</div>
		</div>
		<div class="footer-ornament">◆ ◆ ◆</div>
	</footer>
</main>

<style>
	.newspaper-container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 20px;
		background: var(--paper-bg);
		min-height: 100vh;
	}

	.newspaper-header {
		text-align: center;
		padding: 30px 0;
		border-bottom: 3px double var(--text-primary);
		margin-bottom: 20px;
	}

	.header-ornament {
		font-size: 1.2em;
		color: var(--accent-gold);
		margin: 10px 0;
	}

	.newspaper-title {
		font-family: var(--font-headline);
		font-size: 3.5em;
		font-weight: 900;
		margin: 15px 0;
		letter-spacing: 0.1em;
		text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
	}

	.newspaper-subtitle {
		font-family: var(--font-serif);
		font-size: 1.2em;
		font-style: italic;
		margin: 10px 0;
		color: var(--text-secondary);
	}

	.header-date {
		font-family: var(--font-serif);
		font-size: 1em;
		margin: 15px 0;
		font-weight: bold;
	}

	.newspaper-nav {
		display: flex;
		justify-content: center;
		align-items: center;
		padding: 15px 0;
		border-bottom: 1px solid var(--border-color);
		margin-bottom: 30px;
		font-family: var(--font-sans);
		font-weight: bold;
		font-size: 0.9em;
		letter-spacing: 0.05em;
	}

	.nav-section {
		padding: 0 15px;
		cursor: pointer;
		transition: color 0.2s ease;
	}

	.nav-section:hover {
		color: var(--accent-gold);
	}

	.nav-divider {
		color: var(--text-secondary);
		margin: 0 5px;
	}

	.newspaper-content {
		display: grid;
		grid-template-columns: 2fr 1fr;
		gap: 40px;
		margin-bottom: 40px;
	}

	.main-column {
		padding-right: 20px;
		border-right: 1px solid var(--border-color);
	}

	.breaking-news-banner {
		background: var(--text-primary);
		color: var(--paper-bg);
		padding: 10px 20px;
		text-align: center;
		margin-bottom: 30px;
		font-family: var(--font-sans);
		font-weight: bold;
		letter-spacing: 0.1em;
	}

	.breaking-text {
		font-size: 1.1em;
	}

	.variant-selector-container {
		margin-bottom: 40px;
		padding: 25px;
		background: rgba(0,0,0,0.02);
		border: 1px solid var(--border-color);
		border-radius: 2px;
	}

	.section-header {
		font-family: var(--font-headline);
		font-size: 1.8em;
		margin-bottom: 10px;
		color: var(--text-primary);
	}

	.section-subtitle {
		font-family: var(--font-serif);
		font-style: italic;
		color: var(--text-secondary);
		margin-bottom: 20px;
	}

	.job-posting-container {
		margin-top: 20px;
	}

	.sidebar-column {
		padding-left: 20px;
	}

	.sidebar-section {
		margin-bottom: 35px;
		padding-bottom: 25px;
		border-bottom: 1px solid var(--border-light);
	}

	.sidebar-section:last-child {
		border-bottom: none;
	}

	.sidebar-header {
		font-family: var(--font-sans);
		font-size: 1em;
		font-weight: bold;
		letter-spacing: 0.05em;
		margin-bottom: 15px;
		color: var(--text-primary);
	}

	.sidebar-divider {
		height: 2px;
		background: var(--accent-gold);
		width: 30px;
		margin-bottom: 15px;
	}

	.market-item, .tip-item {
		margin-bottom: 12px;
		font-family: var(--font-serif);
		font-size: 0.9em;
		line-height: 1.4;
	}

	.news-item {
		margin-bottom: 20px;
	}

	.news-item h4 {
		font-family: var(--font-sans);
		font-size: 0.95em;
		font-weight: bold;
		margin-bottom: 5px;
		color: var(--text-primary);
	}

	.news-item p {
		font-family: var(--font-serif);
		font-size: 0.85em;
		line-height: 1.4;
		color: var(--text-secondary);
		margin: 0;
	}

	.ad-section {
		background: rgba(0,0,0,0.03);
		padding: 20px;
		border: 1px dashed var(--border-color);
		text-align: center;
	}

	.ad-header {
		font-family: var(--font-sans);
		font-size: 0.7em;
		font-weight: bold;
		letter-spacing: 0.1em;
		color: var(--text-secondary);
		margin-bottom: 15px;
	}

	.ad-content h4 {
		font-family: var(--font-sans);
		font-size: 1.1em;
		margin-bottom: 10px;
		color: var(--text-primary);
	}

	.ad-content p {
		font-family: var(--font-serif);
		font-size: 0.9em;
		margin-bottom: 15px;
		color: var(--text-secondary);
	}

	.ad-cta {
		font-family: var(--font-sans);
		font-weight: bold;
		color: var(--accent-gold);
		cursor: pointer;
		transition: color 0.2s ease;
	}

	.ad-cta:hover {
		color: var(--text-primary);
	}

	.newspaper-footer {
		text-align: center;
		padding: 30px 0;
		border-top: 3px double var(--text-primary);
		margin-top: 40px;
	}

	.footer-ornament {
		font-size: 1.1em;
		color: var(--accent-gold);
		margin: 15px 0;
	}

	.footer-content {
		font-family: var(--font-serif);
		font-size: 0.9em;
		color: var(--text-secondary);
		line-height: 1.6;
	}

	.footer-section {
		margin: 8px 0;
	}

	/* Responsive Design */
	@media (max-width: 768px) {
		.newspaper-container {
			padding: 15px;
		}

		.newspaper-title {
			font-size: 2.5em;
		}

		.newspaper-content {
			grid-template-columns: 1fr;
			gap: 30px;
		}

		.main-column {
			padding-right: 0;
			border-right: none;
			border-bottom: 1px solid var(--border-color);
			padding-bottom: 30px;
		}

		.sidebar-column {
			padding-left: 0;
		}

		.newspaper-nav {
			flex-wrap: wrap;
			gap: 10px;
		}

		.nav-divider {
			display: none;
		}
	}

	@media (max-width: 480px) {
		.newspaper-title {
			font-size: 2em;
		}

		.variant-selector-container {
			padding: 15px;
		}

		.section-header {
			font-size: 1.5em;
		}
	}
</style>