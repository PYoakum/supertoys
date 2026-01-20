<script>
  export let title = "The Daily Developer";
  export let subtitle = "Your Source for Tech Opportunities";
  export let date = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
</script>
<div class="newspaper">
  <header class="newspaper-header">
    <h1 class="masthead">{title}</h1>
    <p class="subtitle">{subtitle}</p>
    <div class="date-line">{date}</div>
    <div class="divider"></div>
  </header>
  <main class="newspaper-content">
    <slot />
  </main>
</div>
<style>
  .newspaper {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    font-family: 'Times New Roman', Times, serif;
    background: #fefefe;
    box-shadow: 0 0 20px rgba(0,0,0,0.1);
  }
  .newspaper-header {
    text-align: center;
    border-bottom: 3px solid #333;
    padding-bottom: 20px;
    margin-bottom: 30px;
  }
  .masthead {
    font-size: 3.5rem;
    font-weight: bold;
    margin: 0;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #333;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
  }
  .subtitle {
    font-size: 1.2rem;
    font-style: italic;
    margin: 10px 0;
    color: #666;
  }
  .date-line {
    font-size: 1rem;
    font-weight: bold;
    margin: 15px 0;
    color: #333;
  }
  .divider {
    height: 2px;
    background: linear-gradient(to right, transparent, #333, transparent);
    margin: 20px 0;
  }
  .newspaper-content {
    column-count: 3;
    column-gap: 30px;
    column-rule: 1px solid #ddd;
    text-align: justify;
    line-height: 1.6;
  }
  @media (max-width: 768px) {
    .newspaper-content {
      column-count: 1;
    }
    .masthead {
      font-size: 2.5rem;
    }
  }
  @media (max-width: 1024px) and (min-width: 769px) {
    .newspaper-content {
      column-count: 2;
    }
  }
</style>