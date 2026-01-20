<script>
  export let jobPostings = [];
  // Default job postings if none provided
  const defaultPostings = [
    {
      title: "Professional Software Engineer",
      content: "We are seeking a highly skilled software engineer to join our dynamic team. The ideal candidate will have extensive experience in modern web technologies and a passion for creating innovative solutions."
    },
    {
      title: "Unhinged Developer Position", 
      content: "ATTENTION CODING WARRIORS! We need someone who can battle bugs with the fury of a thousand suns and write code that makes other developers weep tears of joy!"
    },
    {
      title: "Neutral Development Role",
      content: "Standard software development position available. Responsibilities include coding, testing, and maintenance of applications. Standard benefits package included."
    },
    {
      title: "Feline-Approved Programmer",
      content: "Meow meow purr purr. Looking for human who can type while cat sits on keyboard. Must provide adequate lap warmth and treat dispensing capabilities. Purr."
    }
  ];
  $: displayPostings = jobPostings.length > 0 ? jobPostings : defaultPostings;
</script>
<div class="newspaper-container">
  <header class="newspaper-header">
    <h1>THE DAILY DEVELOPER</h1>
    <div class="header-line"></div>
  </header>
  <div class="columns-container">
    {#each displayPostings as posting, index}
      <div class="column">
        <h2 class="job-title">{posting.title}</h2>
        <div class="job-content">
          {posting.content}
        </div>
      </div>
    {/each}
    <!-- Fill remaining columns if less than 5 postings -->
    {#each Array(Math.max(0, 5 - displayPostings.length)) as _, index}
      <div class="column empty-column">
        <h2 class="job-title">More Opportunities</h2>
        <div class="job-content">
          Additional job postings will appear here as they become available. Stay tuned for exciting career opportunities in the tech industry.
        </div>
      </div>
    {/each}
  </div>
</div>
<style>
  .newspaper-container {
    font-family: 'Courier New', 'Monaco', 'Menlo', monospace;
    background-color: #f8f8f0;
    padding: 20px;
    max-width: 1200px;
    margin: 0 auto;
    box-shadow: 0 0 20px rgba(0, 0, 0, 0.1);
  }
  .newspaper-header {
    text-align: center;
    margin-bottom: 30px;
    border-bottom: 3px solid #333;
    padding-bottom: 15px;
  }
  .newspaper-header h1 {
    font-size: 2.5rem;
    font-weight: bold;
    letter-spacing: 3px;
    margin: 0;
    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
  }
  .header-line {
    height: 2px;
    background-color: #333;
    margin: 10px auto;
    width: 80%;
  }
  .columns-container {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 20px;
    column-rule: 1px solid #ccc;
  }
  .column {
    padding: 0 10px;
    min-height: 400px;
  }
  .job-title {
    font-size: 1.1rem;
    font-weight: bold;
    margin-bottom: 15px;
    text-transform: uppercase;
    letter-spacing: 1px;
    border-bottom: 1px solid #666;
    padding-bottom: 5px;
  }
  .job-content {
    text-align: justify;
    line-height: 1.6;
    font-size: 0.9rem;
    hyphens: auto;
    word-spacing: 0.1em;
  }
  .empty-column {
    opacity: 0.6;
    font-style: italic;
  }
  /* Responsive design */
  @media (max-width: 1024px) {
    .columns-container {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  @media (max-width: 768px) {
    .columns-container {
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
    }
    .newspaper-header h1 {
      font-size: 2rem;
    }
  }
  @media (max-width: 480px) {
    .columns-container {
      grid-template-columns: 1fr;
    }
    .newspaper-container {
      padding: 15px;
    }
    .newspaper-header h1 {
      font-size: 1.5rem;
      letter-spacing: 2px;
    }
  }
</style>