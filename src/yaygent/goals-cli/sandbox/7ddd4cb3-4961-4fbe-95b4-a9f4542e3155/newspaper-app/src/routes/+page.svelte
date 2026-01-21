<script>
  import { onMount } from 'svelte';
  // Job posting data - in a real app, this would come from an API or database
  let jobPostings = [
    {
      id: 1,
      title: "Senior Software Engineer",
      type: "professional",
      content: `We are seeking a highly skilled Senior Software Engineer to join our dynamic development team. The ideal candidate will have 5+ years of experience in full-stack development with expertise in modern web technologies.
Key Responsibilities:
• Lead development of scalable web applications
• Mentor junior developers and conduct code reviews
• Collaborate with cross-functional teams on product requirements
• Implement best practices for code quality and testing
Requirements:
• Bachelor's degree in Computer Science or related field
• Proficiency in JavaScript, Python, or Java
• Experience with cloud platforms (AWS, Azure, or GCP)
• Strong problem-solving and communication skills
We offer competitive salary, comprehensive benefits, flexible work arrangements, and opportunities for professional growth in a collaborative environment.`,
      meta: "Posted: Today | Location: Remote/Hybrid | Salary: $90k-$130k"
    },
    {
      id: 2,
      title: "Chief Nap Officer",
      type: "cat",
      content: `*stretches paws and yawns* 
Meow! Our prestigious organization seeks a dedicated feline professional for the esteemed position of Chief Nap Officer. Must have extensive experience in:
Essential Qualifications:
• Advanced sunbeam detection and optimization (minimum 7 years)
• Professional-grade purring with volume control capabilities
• Expert-level cardboard box evaluation and occupancy
• Demonstrated ability to knock items off desks with precision
Daily Responsibilities:
• Supervise all napping operations across multiple locations
• Conduct quality assurance testing of warm laundry piles
• Provide motivational purring during human work sessions
• Maintain optimal treat inventory through strategic begging
Compensation Package:
• Unlimited premium kibble and occasional tuna treats
• Executive scratching post with panoramic window views
• Comprehensive belly rub benefits (when mood permits)
• Flexible schedule accommodating 16-hour sleep requirements
*purrs contentedly while batting at keyboard*`,
      meta: "Posted: After morning nap | Location: Sunny windowsill | Treats: Negotiable"
    },
    {
      id: 3,
      title: "Interdimensional Systems Administrator",
      type: "eldritch",
      content: `The Ancient Ones seek a mortal vessel... *ahem*... a qualified Systems Administrator to maintain our reality-bending computational infrastructure.
Ř̴̰E̸̺̊Q̷̰̈Ù̶̱I̴̱̍R̸̰̈E̸̺̊M̸̰̈E̸̺̊N̸̰̈T̸̰̈S̸̰̈:
• Minimum 3 years experience with non-Euclidean databases
• Fluency in at least 7 programming languages (including R'lyehian)
• Ability to debug code that exists in multiple dimensions simultaneously
• Strong mental fortitude (previous exposure to cosmic horrors preferred)
• Comfortable working with tentacled hardware configurations
D̸̰̈Ṵ̸̈T̸̰̈Ḭ̸̈Ḛ̸̈S̸̰̈:
• Maintain servers that exist outside conventional spacetime
• Troubleshoot network issues across parallel universes
• Perform routine sacrificial offerings to appease the Server Spirits
• Document procedures in languages that haven't been invented yet
B̸̰̈Ḛ̸̈N̸̰̈Ḛ̸̈F̸̰̈Ḭ̸̈T̸̰̈S̸̰̈:
• Competitive salary paid in souls and/or cryptocurrency
• Comprehensive health insurance (covers tentacle injuries)
• Unlimited PTO in the Void Between Worlds
• Company-provided protective wards and sanity insurance
Warning: Side effects may include temporary madness, spontaneous tentacle growth, and an irresistible urge to chant in ancient tongues. The Ancient Ones are an equal opportunity employer and welcome applications from all dimensions.
*The text occasionally shifts and writhes on the page*`,
      meta: "Posted: When the stars align | Location: Between dimensions | Contact: Ph'nglui mglw'nafh"
    }
  ];
  let currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
</script>
<svelte:head>
  <title>The Daily Opportunity - Job Postings</title>
  <meta name="description" content="Professional job opportunities in a classic newspaper format" />
</svelte:head>
<div class="newspaper-container">
  <header class="newspaper-header">
    <h1 class="newspaper-title">The Daily Opportunity</h1>
    <p class="newspaper-subtitle">Your Gateway to Career Excellence</p>
    <p class="newspaper-date">{currentDate}</p>
  </header>
  <main>
    <section class="job-postings-section">
      <h2 class="section-header">Career Opportunities</h2>
      <div class="job-grid">
        {#each jobPostings as job}
          <article class="job-posting" class:professional={job.type === 'professional'} class:cat={job.type === 'cat'} class:eldritch={job.type === 'eldritch'}>
            <h3 class="job-title">{job.title}</h3>
            <div class="job-content">
              {#each job.content.split('\n\n') as paragraph}
                <p>{paragraph}</p>
              {/each}
            </div>
            <div class="job-meta">
              {job.meta}
            </div>
          </article>
        {/each}
      </div>
    </section>
  </main>
  <footer class="newspaper-footer">
    <p style="text-align: center; color: #666; font-style: italic; margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd;">
      The Daily Opportunity - Connecting talent with opportunity since today
    </p>
  </footer>
</div>
<style>
  /* Component-specific styles can go here if needed */
  :global(.job-posting.cat) {
    background: linear-gradient(135deg, #fff9e6, #f0f8ff);
  }
  :global(.job-posting.eldritch) {
    background: linear-gradient(135deg, #1a1a2e, #16213e);
    color: #e0e0e0;
    border-color: #4a4a6a;
  }
  :global(.job-posting.eldritch .job-title) {
    color: #ff6b6b;
  }
  :global(.job-posting.professional) {
    background: linear-gradient(135deg, #f8f9fa, #e9ecef);
  }
</style>