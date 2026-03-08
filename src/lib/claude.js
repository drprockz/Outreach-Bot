import Anthropic from '@anthropic-ai/sdk';
import { trackCost } from '../utils/costTracker.js';
import logger from './logger.js';

const client = new Anthropic();

/**
 * Extract text from response, concatenate all text blocks, strip backticks.
 */
function extractText(response) {
  const texts = response.content.filter((b) => b.type === 'text').map((b) => b.text);
  if (texts.length === 0) return null;
  return texts.join('').replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
}

// --- 1. Lead Generation (with web_search tool) ---

const LEAD_GEN_SYSTEM = `You are a B2B lead generation specialist working for Darshan Parmar, a freelance full-stack web developer based in Mumbai, India.

Your job is to find real potential clients who need web development services. You search the web and return structured lead data.

Rules:
- Only return businesses or individuals who realistically need a website, web app, or web development work
- Prioritize leads with findable direct email addresses (firstname@company.com format)
- Never return generic email prefixes: info, admin, contact, support, hello, team, no-reply
- Return leads with real company names — no vague descriptions
- Verify each lead has a digital presence (website or LinkedIn)
- Score each lead 1–10 based on likelihood they need dev work and can afford it

Return ONLY a raw JSON array. No markdown. No backticks. No preamble. No explanation.`;

export async function findLeads(category, searchQuery, limit, date) {
  const userPrompt = `Today is ${date}. Today's target category: ${category}.

Search for: ${searchQuery}

Find exactly ${limit} real potential clients. Return a JSON array where each object is:
{
  "name": "First Last or Contact Name",
  "company": "Company Name",
  "email": "direct email if found, else empty string",
  "type": "${category}",
  "location": "City, Country",
  "website": "https://... if found, else empty string",
  "pain_point": "One sentence — specific web dev problem this business likely has",
  "source": "${searchQuery}",
  "score": 8
}

Return only the raw JSON array. Nothing else.`;

  logger.info(`Finding leads: category=${category}, query="${searchQuery}", limit=${limit}`);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: LEAD_GEN_SYSTEM,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
    messages: [{ role: 'user', content: userPrompt }],
  });

  trackCost('lead_gen', response);

  const text = extractText(response);
  if (!text) {
    logger.error('No text block in lead gen response');
    return [];
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    logger.error(`Failed to parse lead gen JSON: ${err.message}`);
    logger.error(`Raw response: ${text.substring(0, 500)}`);
    return [];
  }
}

// --- 2. Email Generation ---

const EMAIL_GEN_SYSTEM = `You are writing cold outreach emails on behalf of Darshan Parmar, a freelance full-stack web developer.

Sender profile:
- Name: Darshan Parmar
- Company: Simple Inc
- Website: https://www.simpleinc.in
- Email: darshan@simpleinc.in
- Experience: 4+ years full-stack development
- Skills: React, Vue, NestJS, Node.js, WordPress, PHP, Shopify Liquid, Headless CMS
- Based in: Mumbai, India
- Availability: Taking on 2–3 freelance projects per month

Email rules — follow every single one:
- Under 150 words total
- Never start with "I" — start with an observation about them
- No "I hope this email finds you well" or any filler opener
- No "My name is Darshan" in the body — name goes in sign-off only
- First line must reference something specific about their business or website
- Address exactly one pain point
- One clear ask at the end — a reply, not a link to click
- Zero links anywhere in the body
- Plain text only — no HTML, no bullet points, no bold, no markdown
- No exclamation marks
- Tone: professional, direct, sounds like a human — not a template
- Sign-off: "Darshan" only — no "Best regards", "Sincerely", "Thanks"

Return ONLY a raw JSON object. No markdown. No backticks. No explanation.
Format: {"subject": "...", "body": "..."}`;

export async function generateEmail(lead, sequence = 1, originalSubject = '') {
  let userPrompt;

  if (sequence === 1) {
    userPrompt = `Write a cold outreach email to this prospect:

Name: ${lead.name}
Company: ${lead.company}
Type: ${lead.type}
Location: ${lead.location}
Website: ${lead.website}
About them: ${lead.pain_point}
Their likely pain point: ${lead.pain_point}

The email must feel like Darshan personally researched this company and identified one specific, real problem he can solve.

Return only: {"subject": "...", "body": "..."}`;
  } else if (sequence === 2) {
    userPrompt = `Write a follow-up bump email. This is the second touch — they did not reply to the first email sent 3 days ago.

Lead name: ${lead.name}
Company: ${lead.company}
Original subject: ${originalSubject}

Rules:
- Maximum 2 sentences total
- Do not re-pitch or summarise the first email
- Casual human bump — like "Wanted to make sure this didn't get buried."
- Same email thread (subject line must be "Re: ${originalSubject}")
- Sign-off: Darshan

Return only: {"subject": "Re: ${originalSubject}", "body": "..."}`;
  } else if (sequence === 3) {
    userPrompt = `Write the third email in a cold outreach sequence. They have not replied to 2 previous emails. Provide a small free insight about their website or business — no pitch.

Lead name: ${lead.name}
Company: ${lead.company}
Website: ${lead.website}
Their pain point: ${lead.pain_point}
Original subject: ${originalSubject}

Rules:
- Under 80 words
- Open with a genuine observation about something fixable on their site or in their business
- Frame it as a free observation, not a sales pitch
- Soft close: "Happy to share a few more thoughts if useful"
- Confident and helpful tone — no desperation
- Sign-off: Darshan

Return only: {"subject": "Re: ${originalSubject}", "body": "..."}`;
  } else if (sequence === 4) {
    userPrompt = `Write the final breakup email. Fourth and last touch. They have not replied to any previous emails.

Lead name: ${lead.name}
Company: ${lead.company}
Original subject: ${originalSubject}

Rules:
- Under 50 words
- Acknowledge timing may not be right
- Leave door open — no neediness, no guilt
- Classic breakup email format (these often get the highest reply rates)
- Warm, genuine, no passive aggression
- Sign-off: Darshan

Return only: {"subject": "Re: ${originalSubject}", "body": "..."}`;
  }

  logger.info(`Generating email: lead=${lead.name}, sequence=${sequence}`);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: EMAIL_GEN_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });

  trackCost('email_write', response);

  const text = extractText(response);
  if (!text) {
    logger.error('No text block in email gen response');
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    logger.error(`Failed to parse email gen JSON: ${err.message}`);
    return null;
  }
}

// --- 3. Reply Classification ---

const CLASSIFY_SYSTEM = `You are an email reply classifier for a freelance developer's cold outreach system.

Classify the reply into exactly one of these categories:

- hot: Genuine buying interest. Signals: "interested", "tell me more", "what's your rate", "what do you charge", "sounds good", "let's discuss", "can you help", "we need this"
- schedule: Wants to book a call or meeting. Signals: "call", "meet", "zoom", "calendar", "book a time", "availability", "schedule", "when are you free"
- soft: Interested but not now. Signals: "maybe later", "not right now", "reach out in", "try us in X months", "send your portfolio", "send more info", "keep in touch"
- unsubscribe: Wants no more contact. Signals: "not interested", "remove me", "unsubscribe", "stop emailing", "don't contact me", "take me off your list"
- ooo: Out of office auto-reply. Signals: "out of office", "on leave", "on vacation", "will return", "auto-reply", "automatic reply"
- other: Does not fit any category above

Return ONLY a raw JSON object. No markdown. No explanation.
Format: {"classification": "hot", "summary": "One sentence summary of what they said", "urgent": true}

Set urgent: true ONLY for hot and schedule. All others: urgent: false.`;

export async function classifyReply(senderEmail, subject, body) {
  const userPrompt = `Classify this email reply:

From: ${senderEmail}
Subject: ${subject}
Body:
${body}

Return only: {"classification": "...", "summary": "...", "urgent": true/false}`;

  logger.info(`Classifying reply from: ${senderEmail}`);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    system: CLASSIFY_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });

  trackCost('classify', response);

  const text = extractText(response);
  if (!text) {
    logger.error('No text block in classify response');
    return { classification: 'other', summary: 'Failed to classify', urgent: false };
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    logger.error(`Failed to parse classify JSON: ${err.message}`);
    return { classification: 'other', summary: 'Parse error', urgent: false };
  }
}

// --- 4. Hot Lead Alert ---

const ALERT_SYSTEM = `You are writing an internal alert email to notify Darshan Parmar that a cold outreach lead has responded positively. Darshan may be reading this on his phone — write for mobile scanning.

Return ONLY a raw JSON object.
Format: {"subject": "...", "body": "..."}`;

export async function generateAlert(classification, lead, reply, sentDate, sequence) {
  const userPrompt = `Write an urgent alert email for this positive reply:

Classification: ${classification}
Lead name: ${lead.name}
Company: ${lead.company}
Their email: ${lead.email}
Reply summary: ${reply.summary}
Their exact reply:
${reply.raw_body}

Original cold email sent: ${sentDate}
Sequence number: ${sequence}

Requirements:
- Subject must open with "HOT LEAD —" or "CALL REQUEST —" depending on classification
- Include their exact reply quoted in the body
- Suggest a specific next action (e.g. "Reply within 2 hours", "Propose a 30-min call this week")
- Under 200 words total

Return only: {"subject": "...", "body": "..."}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: ALERT_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });

  trackCost('alert', response);

  const text = extractText(response);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// --- 5. Daily Report ---

const REPORT_SYSTEM = `You are generating a daily outreach performance report for Darshan Parmar, a freelance developer running an automated cold email system.

Write the report as a clean HTML email body — professional, easy to scan on mobile. No external CSS. Inline styles only.

Color scheme:
- Page background: #ffffff
- Primary text: #1a1a1a
- Section headers: #4f46e5
- Hot lead rows: background #dcfce7, border-left 3px solid #16a34a
- Schedule rows: background #dbeafe, border-left 3px solid #2563eb
- Metric numbers: font-weight bold, font-family monospace
- Muted labels: #6b7280
- Dividers: #e5e7eb

Return ONLY the HTML string starting from a <div> tag. Not a full HTML document. No backticks.`;

export async function generateDailyReport(stats) {
  const userPrompt = `Generate today's outreach performance report:

Date: ${stats.date}
Day: ${stats.day}

TODAY:
- Sent: ${stats.sent}
- Bounced: ${stats.bounced}
- Follow-ups sent: ${stats.followups}
- Replies received: ${stats.replies}
- Hot leads: ${stats.hot}
- Schedule requests: ${stats.schedule}
- Unsubscribes: ${stats.unsub}

HOT LEADS TODAY (JSON):
${JSON.stringify(stats.hotLeads, null, 2)}

SCHEDULE REQUESTS TODAY (JSON):
${JSON.stringify(stats.scheduleLeads, null, 2)}

SOFT INTEREST TODAY (JSON):
${JSON.stringify(stats.softLeads, null, 2)}

PIPELINE TOTALS:
- Cold: ${stats.pipeline.cold || 0}
- Contacted: ${stats.pipeline.contacted || 0}
- Hot: ${stats.pipeline.hot || 0}
- Schedule: ${stats.pipeline.schedule || 0}
- Soft: ${stats.pipeline.soft || 0}
- Closed: ${stats.pipeline.closed || 0}
- Rejected: ${stats.pipeline.rejected || 0}
- Dormant: ${stats.pipeline.dormant || 0}

MONTH TO DATE:
- Total sent: ${stats.mtd.sent}
- Total replies: ${stats.mtd.replies}
- Reply rate: ${stats.mtd.replyRate}%
- Hot leads: ${stats.mtd.hot}
- Projects closed: ${stats.mtd.closed}
- API cost MTD: $${stats.mtd.costUsd} (₹${stats.mtd.costInr})

TOMORROW:
- Target category: ${stats.tomorrowCategory}
- Follow-ups due: ${stats.tomorrowFollowups}

Generate a clean HTML report. Hot leads and schedule requests must be visually prominent with colored backgrounds. Include all sections. Sign off with "Outreach Agent — outreach.simpleinc.in".`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: REPORT_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });

  trackCost('report', response);

  const text = extractText(response);
  return text || '<div>Report generation failed.</div>';
}
