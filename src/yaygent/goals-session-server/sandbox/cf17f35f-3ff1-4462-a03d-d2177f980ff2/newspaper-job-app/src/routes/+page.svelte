<script>
  import '../lib/newspaper.css';
  // Job posting data - this would typically come from an API or props
  const jobPosting = {
    title: "Senior Software Engineer",
    company: "TechCorp Industries",
    location: "San Francisco, CA",
    type: "Full-time",
    salary: "$120,000 - $160,000",
    description: `We are seeking a talented Senior Software Engineer to join our dynamic team. 
    You will be responsible for designing, developing, and maintaining high-quality software solutions 
    that drive our business forward. This is an excellent opportunity to work with cutting-edge 
    technologies and make a significant impact on our products.`,
    responsibilities: [
      "Design and develop scalable web applications",
      "Collaborate with cross-functional teams to define and implement new features",
      "Write clean, maintainable, and efficient code",
      "Participate in code reviews and mentor junior developers",
      "Troubleshoot and debug applications",
      "Stay up-to-date with emerging technologies and industry trends"
    ],
    requirements: [
      "Bachelor's degree in Computer Science or related field",
      "5+ years of experience in software development",
      "Proficiency in JavaScript, Python, or Java",
      "Experience with modern web frameworks (React, Vue, Angular)",
      "Strong understanding of database design and SQL",
      "Excellent problem-solving and communication skills",
      "Experience with cloud platforms (AWS, Azure, GCP) preferred"
    ],
    benefits: [
      "Competitive salary and equity package",
      "Comprehensive health, dental, and vision insurance",
      "Flexible work arrangements and remote options",
      "Professional development opportunities",
      "Generous PTO and parental leave",
      "State-of-the-art office with modern amenities"
    ]
  };
  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
</script>
<svelte:head>
  <title>The Tech Tribune - Career Opportunities</title>
  <meta name="description" content="Latest job opportunities in the tech industry" />
</svelte:head>
<div class="newspaper">
  <header class="newspaper-header">
    <div class="newspaper-date">{currentDate}</div>
    <h1 class="newspaper-title">The Tech Tribune</h1>
    <p class="newspaper-subtitle">Your Source for Premier Career Opportunities</p>
  </header>
  <main class="newspaper-content">
    <article class="job-posting">
      <h1 class="job-headline">{jobPosting.title}</h1>
      <div class="job-content">
        <strong>{jobPosting.company}</strong> • {jobPosting.location} • {jobPosting.type}
        <br><strong>Salary:</strong> {jobPosting.salary}
      </div>
      <div class="decorative-line">❦ ❦ ❦</div>
      <div class="job-content">
        {jobPosting.description}
      </div>
      <h2 class="job-subheading">Key Responsibilities</h2>
      <div class="job-content">
        <ul>
          {#each jobPosting.responsibilities as responsibility}
            <li>{responsibility}</li>
          {/each}
        </ul>
      </div>
      <div class="job-requirements">
        <h3>Requirements & Qualifications</h3>
        <ul>
          {#each jobPosting.requirements as requirement}
            <li>{requirement}</li>
          {/each}
        </ul>
      </div>
      <h2 class="job-subheading">What We Offer</h2>
      <div class="job-content">
        <ul>
          {#each jobPosting.benefits as benefit}
            <li>{benefit}</li>
          {/each}
        </ul>
      </div>
      <div class="decorative-line">❦ ❦ ❦</div>
      <div class="job-content">
        <strong>Ready to join our team?</strong> We're looking for passionate individuals who thrive 
        in a collaborative environment and are excited about building the future of technology. 
        This position offers excellent growth opportunities and the chance to work on projects 
        that impact millions of users worldwide.
      </div>
    </article>
  </main>
  <footer class="job-footer">
    <p>To apply for this position, please send your resume and cover letter to careers@techcorp.com</p>
    <p>TechCorp Industries is an equal opportunity employer committed to diversity and inclusion.</p>
  </footer>
</div>