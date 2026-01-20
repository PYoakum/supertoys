<script>
  import NewspaperLayout from '$lib/components/NewspaperLayout.svelte';
  import JobArticle from '$lib/components/JobArticle.svelte';
  // Sample job content - in a real app this would come from an API or store
  const jobContent = `We are seeking a talented Software Engineer to join our dynamic team. This role offers an exciting opportunity to work on cutting-edge projects and contribute to innovative solutions.
The ideal candidate will have strong programming skills and a passion for technology. You will be responsible for developing high-quality software applications and collaborating with cross-functional teams.
Key responsibilities include writing clean, maintainable code, participating in code reviews, and contributing to architectural decisions. Experience with modern web technologies and agile development practices is highly valued.
We offer competitive compensation, comprehensive benefits, and opportunities for professional growth. Join us in building the future of technology and making a meaningful impact in the industry.`;
  const additionalContent = `Our company culture emphasizes innovation, collaboration, and continuous learning. We believe in empowering our employees to take ownership of their work and pursue their professional interests.
The successful candidate will work in a modern office environment with state-of-the-art equipment and tools. Remote work options are available, and we support flexible working arrangements to promote work-life balance.
This position offers excellent career advancement opportunities within a growing organization. We invest in our employees through training programs, conference attendance, and mentorship opportunities.`;
</script>
<svelte:head>
  <title>The Daily Developer - Career Opportunities</title>
  <meta name="description" content="Latest career opportunities in technology and software development" />
</svelte:head>
<NewspaperLayout 
  title="The Daily Developer"
  subtitle="Your Premier Source for Tech Career Opportunities"
>
  <JobArticle 
    jobContent={jobContent}
    headline="Software Engineer Position: Join Our Innovation Team"
    byline="By Career Services Department"
  />
  <div class="secondary-article">
    <h3 class="secondary-headline">Company Culture & Benefits</h3>
    <div class="secondary-content">
      {#each additionalContent.split('\n\n') as paragraph}
        <p>{paragraph}</p>
      {/each}
    </div>
  </div>
  <div class="sidebar-content">
    <div class="info-box">
      <h4>Quick Facts</h4>
      <ul>
        <li>Full-time position</li>
        <li>Competitive salary</li>
        <li>Remote work options</li>
        <li>Health & dental benefits</li>
        <li>Professional development</li>
      </ul>
    </div>
    <div class="info-box">
      <h4>Required Skills</h4>
      <ul>
        <li>JavaScript/TypeScript</li>
        <li>React or Svelte</li>
        <li>Node.js</li>
        <li>Git version control</li>
        <li>Problem-solving</li>
      </ul>
    </div>
  </div>
</NewspaperLayout>
<style>
  .secondary-article {
    break-inside: avoid;
    margin: 30px 0;
    padding: 20px 0;
    border-top: 2px solid #333;
  }
  .secondary-headline {
    font-size: 1.4rem;
    font-weight: bold;
    margin: 0 0 15px 0;
    color: #333;
  }
  .secondary-content p {
    margin: 0 0 15px 0;
    text-indent: 1.5em;
    line-height: 1.6;
  }
  .sidebar-content {
    break-inside: avoid;
    margin-top: 30px;
  }
  .info-box {
    background: #f5f5f5;
    border: 2px solid #333;
    padding: 15px;
    margin-bottom: 20px;
    break-inside: avoid;
  }
  .info-box h4 {
    margin: 0 0 10px 0;
    font-size: 1.1rem;
    font-weight: bold;
    color: #333;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .info-box ul {
    margin: 0;
    padding-left: 20px;
  }
  .info-box li {
    margin-bottom: 5px;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  @media (max-width: 768px) {
    .secondary-content p {
      text-indent: 0;
    }
  }
</style>