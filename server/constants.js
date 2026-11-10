'use strict';

// Everything here is shared with the browser via GET /api/meta so labels stay in one place.

const STAGES = [
  { value: 'applied', label: 'Applied only' },
  { value: 'recruiter_screen', label: 'Recruiter screen' },
  { value: 'hiring_manager_screen', label: 'Hiring manager screen' },
  { value: 'technical', label: 'Technical / skills interview' },
  { value: 'take_home', label: 'Take-home assignment' },
  { value: 'onsite', label: 'Onsite / panel' },
  { value: 'final_round', label: 'Final round' },
  { value: 'offer', label: 'Offer stage' },
];

const OUTCOMES = [
  { value: 'offer_accepted', label: 'Got an offer & accepted' },
  { value: 'offer_declined', label: 'Got an offer & declined' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'ghosted', label: 'Ghosted (never heard back)' },
  { value: 'withdrew', label: 'I withdrew' },
  { value: 'pending', label: 'Still in process' },
];

const CONTACT_ROLES = [
  { value: 'recruiter', label: 'Recruiter (in-house)' },
  { value: 'agency_recruiter', label: 'Agency / third-party recruiter' },
  { value: 'hiring_manager', label: 'Hiring manager' },
  { value: 'interviewer', label: 'Interviewer' },
  { value: 'hr', label: 'HR / People team' },
];

// Rating dimensions. Every dimension is about how candidates were treated during hiring.
const COMPANY_DIMENSIONS = [
  { key: 'overall', label: 'Overall hiring experience', required: true },
  { key: 'communication', label: 'Communication', hint: 'Clear updates, timely replies, set expectations', required: true },
  { key: 'respect', label: 'Respect for candidates', hint: 'Courtesy, valued your time, no bait-and-switch', required: true },
  { key: 'transparency', label: 'Process transparency', hint: 'Clear steps, timeline, salary range shared', required: true },
  { key: 'timeliness', label: 'Speed & responsiveness', hint: 'Reasonable time between stages and to a decision', required: true },
  { key: 'fairness', label: 'Interview relevance & fairness', hint: 'Questions matched the role, no unreasonable asks', required: true },
];

const CONTACT_DIMENSIONS = [
  { key: 'overall', label: 'Overall', required: true },
  { key: 'communication', label: 'Communication', hint: 'Kept you informed, clear and prompt', required: true },
  { key: 'respect', label: 'Professionalism', hint: 'Courteous, prepared, on time', required: true },
  { key: 'transparency', label: 'Honesty', hint: 'Accurate about role, pay and where you stood', required: true },
  { key: 'timeliness', label: 'Responsiveness', hint: 'Followed up when they said they would', required: true },
  { key: 'fairness', label: 'Interview fairness', hint: 'Optional — mainly for hiring managers & interviewers', required: false },
];

const FORUM_CATEGORIES = [
  { slug: 'general', name: 'General Discussion', description: 'Anything about the job search.' },
  { slug: 'networking', name: 'Networking & Referrals', description: 'Find people in your field, swap referrals, team up.' },
  { slug: 'grievances', name: 'Grievances & Venting', description: 'Ghosted? Lowballed? Five rounds for nothing? Let it out.' },
  { slug: 'interview-tips', name: 'Interview Prep & Tips', description: 'Questions you got, what worked, what didn’t.' },
  { slug: 'wins', name: 'Wins & Celebrations', description: 'Offers, callbacks, small victories. Cheer each other on.' },
];

const FLAG_REASONS = [
  { value: 'about_employment', label: 'About working there, not the hiring process' },
  { value: 'harassment', label: 'Harassment or personal attack' },
  { value: 'personal_info', label: 'Shares private personal information' },
  { value: 'spam', label: 'Spam or fake' },
];

// Reviews with this many flags are hidden from public listings.
const FLAG_HIDE_THRESHOLD = 3;

module.exports = {
  STAGES,
  OUTCOMES,
  CONTACT_ROLES,
  COMPANY_DIMENSIONS,
  CONTACT_DIMENSIONS,
  FORUM_CATEGORIES,
  FLAG_REASONS,
  FLAG_HIDE_THRESHOLD,
};
