// Job Postings Data Structure
// This file contains all job posting variants structured for web application use
export const jobPostings = {
  professional: {
    id: 'professional',
    title: 'Professional Job Posting',
    description: 'A standard, professional job posting following industry best practices',
    content: '', // Will be populated from notepad content
    style: 'professional',
    tone: 'formal'
  },
  unhinged: {
    id: 'unhinged',
    title: 'Unhinged Job Posting',
    description: 'A creative, unconventional job posting with bold personality',
    content: '', // Will be populated from notepad content
    style: 'creative',
    tone: 'bold'
  },
  neutral: {
    id: 'neutral',
    title: 'Neutral Job Posting',
    description: 'A balanced, straightforward job posting',
    content: '', // Will be populated from notepad content
    style: 'neutral',
    tone: 'balanced'
  },
  cat: {
    id: 'cat',
    title: 'Cat-Written Job Posting',
    description: 'A whimsical job posting written from a cat\'s perspective',
    content: '', // Will be populated from notepad content
    style: 'whimsical',
    tone: 'playful'
  }
};

// Utility functions for job posting data
export const getJobPosting = (id) => {
  return jobPostings[id] || null;
};

export const getAllJobPostings = () => {
  return Object.values(jobPostings);
};

export const getJobPostingIds = () => {
  return Object.keys(jobPostings);
};

// Export for CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    jobPostings,
    getJobPosting,
    getAllJobPostings,
    getJobPostingIds
  };
}