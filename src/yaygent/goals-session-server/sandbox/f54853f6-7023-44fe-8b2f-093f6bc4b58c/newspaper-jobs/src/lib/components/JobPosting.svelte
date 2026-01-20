<script>
  export let job;
  // Format content with proper paragraph breaks
  function formatContent(content) {
    return content.split('\n\n').filter(p => p.trim().length > 0);
  }
  // Get current date for newspaper authenticity
  function getCurrentDate() {
    const options = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    };
    return new Date().toLocaleDateString('en-US', options);
  }
</script>
<article class="job-posting">
  <header class="job-header">
    <h2 class="job-title">{job.title}</h2>
    <div class="job-company">{job.company}</div>
  </header>
  <div class="job-content">
    {#each formatContent(job.content) as paragraph}
      <p>{paragraph}</p>
    {/each}
  </div>
  <footer class="job-meta">
    {job.meta}
  </footer>
</article>
<style>
  .job-posting {
    margin-bottom: 40px;
    padding-bottom: 30px;
    border-bottom: 1px solid var(--newspaper-border);
  }
  .job-posting:last-child {
    border-bottom: none;
    margin-bottom: 0;
  }
  .job-header {
    margin-bottom: 20px;
  }
  .job-title {
    font-family: 'Playfair Display', serif;
    font-size: 1.8rem;
    font-weight: 700;
    margin: 0 0 10px 0;
    color: var(--newspaper-black);
    line-height: 1.2;
  }
  .job-company {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--newspaper-accent);
    margin-bottom: 15px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .job-content {
    font-size: 1rem;
    line-height: 1.7;
    text-align: justify;
    hyphens: auto;
  }
  .job-content :global(p) {
    margin: 0 0 15px 0;
  }
  .job-content :global(p:last-child) {
    margin-bottom: 0;
  }
  .job-meta {
    font-size: 0.9rem;
    color: var(--newspaper-gray);
    margin-top: 15px;
    padding-top: 10px;
    border-top: 1px solid var(--newspaper-border);
    font-style: italic;
  }
  /* Mobile responsive */
  @media (max-width: 768px) {
    .job-title {
      font-size: 1.5rem;
    }
    .job-content {
      text-align: left;
    }
  }
</style>