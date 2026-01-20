<script>
  import NewspaperLayout from './lib/NewspaperLayout.svelte';
  // Job posting data - can be loaded from external source
  const jobPostings = [
    {
      title: "Senior Full-Stack Developer",
      content: "We are seeking an experienced full-stack developer to join our innovative team. You will be responsible for developing scalable web applications using modern technologies. The ideal candidate has 5+ years of experience with React, Node.js, and cloud platforms. We offer competitive salary, flexible working arrangements, and comprehensive benefits package."
    },
    {
      title: "EXTREME CODING NINJA WANTED!!!",
      content: "ARE YOU READY TO CODE LIKE YOUR LIFE DEPENDS ON IT?! We need a LEGENDARY developer who can write code faster than lightning and debug with the precision of a samurai! Must be able to survive on energy drinks and pizza while creating MIND-BLOWING applications that will revolutionize the digital world! APPLY NOW OR FOREVER HOLD YOUR PEACE!"
    },
    {
      title: "Software Developer Position",
      content: "Standard software development role available at established technology company. Responsibilities include application development, code review, and system maintenance. Requirements: Bachelor's degree in Computer Science or related field, 3+ years experience. Competitive salary and standard benefits provided. Regular business hours, occasional overtime as needed."
    },
    {
      title: "Purr-fect Programming Position",
      content: "Meow! Seeking human servant... er, developer to join our feline-friendly workplace. Must be skilled in scratching... I mean, coding. Previous experience with yarn... we mean JavaScript preferred. Ability to work while cat supervises from keyboard essential. Compensation includes treats, belly rubs, and occasional dead mouse gifts. Purr purr meow!"
    },
    {
      title: "Remote Frontend Specialist",
      content: "Join our distributed team as a frontend specialist focusing on user experience and interface design. You will work with cutting-edge frameworks and collaborate with designers to create beautiful, functional web applications. Strong skills in HTML, CSS, JavaScript, and modern frameworks required. Remote work with quarterly team meetups."
    }
  ];
</script>
<main>
  <NewspaperLayout {jobPostings} />
</main>
<style>
  main {
    min-height: 100vh;
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
    padding: 20px 0;
  }
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Courier New', monospace;
  }
</style>