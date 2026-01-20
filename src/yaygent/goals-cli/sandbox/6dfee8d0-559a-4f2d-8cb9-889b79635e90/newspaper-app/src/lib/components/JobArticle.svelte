<script>
  export let jobContent = "";
  export let headline = "Exciting Career Opportunity Available";
  export let byline = "By The Editorial Team";
  // Parse job content into sections
  $: sections = jobContent.split('\n\n').filter(section => section.trim());
</script>
<article class="job-article">
  <header class="article-header">
    <h2 class="headline">{headline}</h2>
    <p class="byline">{byline}</p>
    <div class="article-divider"></div>
  </header>
  <div class="article-content">
    {#each sections as section, index}
      <p class="article-paragraph" class:drop-cap={index === 0}>
        {section}
      </p>
    {/each}
  </div>
  <footer class="article-footer">
    <div class="contact-box">
      <h3>How to Apply</h3>
      <p>Interested candidates should submit their applications through our online portal or contact our HR department for more information.</p>
    </div>
  </footer>
</article>
<style>
  .job-article {
    break-inside: avoid;
    margin-bottom: 30px;
  }
  .article-header {
    margin-bottom: 20px;
  }
  .headline {
    font-size: 1.8rem;
    font-weight: bold;
    margin: 0 0 10px 0;
    color: #333;
    line-height: 1.2;
  }
  .byline {
    font-size: 0.9rem;
    font-style: italic;
    color: #666;
    margin: 0 0 15px 0;
  }
  .article-divider {
    height: 1px;
    background: #333;
    margin: 15px 0;
  }
  .article-content {
    margin-bottom: 25px;
  }
  .article-paragraph {
    margin: 0 0 15px 0;
    text-indent: 1.5em;
    font-size: 1rem;
    line-height: 1.6;
  }
  .article-paragraph.drop-cap::first-letter {
    float: left;
    font-size: 3.5em;
    line-height: 0.8;
    margin: 0.1em 0.1em 0 0;
    font-weight: bold;
    color: #333;
  }
  .article-footer {
    border-top: 1px solid #ddd;
    padding-top: 20px;
    margin-top: 25px;
  }
  .contact-box {
    background: #f9f9f9;
    border: 1px solid #ddd;
    padding: 15px;
    border-radius: 4px;
  }
  .contact-box h3 {
    margin: 0 0 10px 0;
    font-size: 1.1rem;
    color: #333;
  }
  .contact-box p {
    margin: 0;
    font-size: 0.9rem;
    line-height: 1.5;
  }
  @media (max-width: 768px) {
    .headline {
      font-size: 1.5rem;
    }
    .article-paragraph {
      text-indent: 0;
    }
  }
</style>