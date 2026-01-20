import { writable } from 'svelte/store';

// Job posting variants data
const jobVariants = {
  professional: {
    title: "Senior Software Engineer",
    company: "TechCorp Industries",
    content: `We are seeking a highly skilled Senior Software Engineer to join our dynamic development team. The ideal candidate will have extensive experience in full-stack development, with particular expertise in modern JavaScript frameworks and cloud technologies.

Key Responsibilities:
• Design and implement scalable web applications
• Collaborate with cross-functional teams to deliver high-quality software solutions
• Mentor junior developers and contribute to technical decision-making
• Participate in code reviews and maintain coding standards

Requirements:
• Bachelor's degree in Computer Science or related field
• 5+ years of professional software development experience
• Proficiency in React, Node.js, and cloud platforms (AWS/Azure)
• Strong problem-solving skills and attention to detail

We offer competitive compensation, comprehensive benefits, and opportunities for professional growth in a collaborative environment.`,
    meta: "Posted: Today | Location: San Francisco, CA | Type: Full-time"
  },
  enthusiastic: {
    title: "AMAZING Software Engineer Opportunity!",
    company: "AWESOME TECH CO!",
    content: `🚀 WOW! Are you ready for the MOST EXCITING software engineering role of your career?! We're looking for a PHENOMENAL developer to join our INCREDIBLE team!

This is NOT just another job - this is your chance to be part of something EXTRAORDINARY! You'll be working with cutting-edge technologies, solving MIND-BLOWING challenges, and creating software that will change the world!

What makes YOU perfect for this role:
• You LOVE coding with the passion of a thousand suns! ☀️
• You dream in JavaScript and wake up thinking about algorithms!
• You're not just a developer - you're a CODE WIZARD! 🧙‍♂️
• You believe that every bug is just a feature waiting to be discovered!

INCREDIBLE Benefits:
• Unlimited coffee (because caffeine = code fuel!)
• Flexible hours (work when your coding powers are strongest!)
• Team game nights (we take our fun SERIOUSLY!)
• The most AMAZING colleagues you'll ever meet!

Don't just apply - LEAP into your future! This opportunity won't last long because we're looking for someone as FANTASTIC as you!`,
    meta: "Posted: RIGHT NOW! | Location: Everywhere & Anywhere! | Type: FULL-TIME AWESOME!"
  },
  robotic: {
    title: "Software Engineer Position - ID: SE-2024-001",
    company: "SYSTEMATIC SOLUTIONS CORP",
    content: `POSITION SUMMARY: Software Engineer required for code generation and system maintenance tasks.

SPECIFICATIONS:
- Unit designation: Senior Software Engineer
- Department: Development Division
- Reporting structure: Engineering Manager Unit
- Classification: Full-time operational status

REQUIRED FUNCTIONS:
1. Execute programming protocols in JavaScript, Python, and related languages
2. Process debugging routines with 99.7% accuracy rate
3. Interface with database systems and API endpoints
4. Generate documentation per company standard procedures
5. Participate in code review cycles as scheduled

MINIMUM SYSTEM REQUIREMENTS:
- Educational module: Computer Science degree or equivalent processing
- Experience buffer: 3-5 years software development operations
- Technical stack compatibility: React.js, Node.js, SQL databases
- Communication protocols: English language processing, team collaboration functions

COMPENSATION PACKAGE:
- Base salary: Market-rate calculation
- Benefits module: Standard corporate package
- Upgrade opportunities: Performance-based advancement protocols

APPLICATION PROCESS:
Submit resume.pdf and cover_letter.txt through designated portal. Processing time: 5-7 business cycles. Confirmation notification will be transmitted upon receipt.

ERROR 404: Humor module not found.`,
    meta: "Posted: 2024-01-15 09:00:00 UTC | Location: OFFICE_LOCATION_001 | Status: ACTIVE"
  },
  cat: {
    title: "Purr-fect Software Engineer Wanted! 🐱",
    company: "Whiskers & Code Inc.",
    content: `Meow there, fellow code cats! 🐾 Are you tired of working with humans who don't appreciate the finer things in life, like knocking things off desks and taking 16-hour naps? Well, we've got the purr-fect opportunity for you!

We're looking for a software engineer who understands that the best code is written at 3 AM while sitting on a warm laptop keyboard. You should be comfortable working in a team environment where meetings are conducted via synchronized purring and all decisions are made by staring intensely at the wall.

What we're looking for:
• Experience with multiple programming languages (we prefer Cat++, but JavaScript will do)
• Ability to debug code while simultaneously ignoring your coworkers
• Strong problem-solving skills (like figuring out how to open doors without opposable thumbs)
• Excellent hunting instincts for tracking down bugs
• Professional experience with version control (preferably Git, but we'll accept experience with litter box management)

Our office perks include:
• Unlimited cardboard boxes for thinking
• Premium catnip in the break room
• Flexible nap schedule (16 hours recommended)
• Laser pointer presentations every Friday
• All the string you can chase

If you're ready to join a company that truly understands the importance of knocking over water glasses and meowing at 5 AM for no apparent reason, we want to hear from you! 

Please submit your resume along with a photo of your favorite cardboard box. References from previous mice are preferred but not required.`,
    meta: "Posted: When the sun hits that one spot on the floor | Location: The warm spot by the window | Type: Full-time (with mandatory nap breaks)"
  },
  eldritch: {
    title: "Software Engineer - The Coding That Should Not Be",
    company: "R'lyeh Technologies & Ancient Systems",
    content: `Ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn... but also, we need a software engineer.

From the depths of the digital abyss, we call to those who dare to code where mortal minds fear to tread. Our ancient corporation, older than the stars themselves, seeks a developer brave enough to work with technologies that predate human understanding of reality.

The Forbidden Requirements:
• Knowledge of programming languages that exist in dimensions beyond human comprehension (JavaScript, Python, and the dreaded CSS will suffice)
• Experience with databases that store not just data, but the screaming souls of a thousand debugging sessions
• Ability to write code that functions even when the laws of physics weep in despair
• Strong problem-solving skills, particularly when the problems involve tentacles and non-Euclidean geometry
• Must be comfortable working with legacy systems that were ancient when the pyramids were young

What We Offer:
• Competitive salary paid in both currency and forbidden knowledge
• Health insurance that covers both physical and existential ailments
• Flexible hours (time is an illusion anyway)
• Remote work options (work from anywhere in this dimension or others)
• Team building exercises that may involve summoning minor deities

The successful candidate will join our team of developers who have gazed into the void of infinite loops and lived to tell the tale. You will work on projects that push the boundaries of what code can do, creating applications that function in ways that would make Lovecraft himself proud.

Warning: Side effects of employment may include temporary madness, speaking in programming languages, and an irresistible urge to add tentacles to all user interface designs.

Do you dare to answer the call? The Old Ones are waiting... and they have excellent benefits.`,
    meta: "Posted: When the stars align correctly | Location: The space between dimensions (or San Francisco) | Type: Eternal servitude (with vacation days)"
  }
};

// Current variant store
export const currentVariant = writable('professional');

// Derived store for current job data
export const currentJob = writable(jobVariants.professional);

// Update current job when variant changes
currentVariant.subscribe(variant => {
  currentJob.set(jobVariants[variant]);
});

// Available variants for the selector
export const availableVariants = writable([
  { key: 'professional', label: 'Professional' },
  { key: 'enthusiastic', label: 'Enthusiastic' },
  { key: 'robotic', label: 'Robotic' },
  { key: 'cat', label: 'Cat-themed' },
  { key: 'eldritch', label: 'Eldritch Horror' }
]);

// Function to change variant
export function setVariant(variant) {
  if (jobVariants[variant]) {
    currentVariant.set(variant);
  }
}