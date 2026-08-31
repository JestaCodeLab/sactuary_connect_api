import SupportTicket from '../models/SupportTicket.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import notificationService from '../services/notificationService.js';
import { sendSupportTicketEmail } from '../utils/email.js';

const TICKET_TYPES = ['support', 'feature_request'];
const PRIORITIES = ['low', 'medium', 'high'];

/**
 * Create a support ticket or feature request. Open to any authenticated
 * org member regardless of role - this is a channel to the platform, not
 * an org-management action, so it isn't permission-gated like the rest of
 * the custom-role system.
 * POST /api/support
 */
export const createTicket = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization context required' });
    }

    const { type, subject, description, priority = 'medium' } = req.body;

    if (!TICKET_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${TICKET_TYPES.join(', ')}` });
    }
    if (!subject?.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (!description?.trim()) {
      return res.status(400).json({ error: 'Description is required' });
    }
    if (!PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
    }

    const ticket = await SupportTicket.create({
      organizationId,
      createdBy: req.user.userId,
      type,
      subject: subject.trim(),
      description,
      priority,
    });

    // Best-effort: alert superadmins by email (they have no in-app inbox of
    // their own) and notify the org admin in-app (in case a non-admin
    // teammate submitted it, so the admin stays in the loop). Neither
    // should fail the ticket submission itself.
    notifySubmission(ticket, req.user.userId, organizationId).catch((err) =>
      console.error('Error sending support ticket notifications:', err)
    );

    res.status(201).json({ message: 'Ticket submitted successfully', ticket });
  } catch (error) {
    console.error('Error creating support ticket:', error);
    res.status(500).json({ error: 'Failed to submit ticket' });
  }
};

const notifySubmission = async (ticket, submitterId, organizationId) => {
  const [org, submitter, superadmins] = await Promise.all([
    Organization.findById(organizationId).select('churchName adminId'),
    User.findById(submitterId).select('firstName lastName'),
    User.find({ role: 'superadmin', verified: true }).select('email'),
  ]);

  const submitterName = submitter ? `${submitter.firstName} ${submitter.lastName}` : 'A team member';
  const churchName = org?.churchName || 'An organization';

  await sendSupportTicketEmail(
    superadmins.map((s) => s.email),
    churchName,
    submitterName,
    ticket.type,
    ticket.subject,
    ticket.description
  );

  if (org?.adminId) {
    const typeLabel = ticket.type === 'feature_request' ? 'feature request' : 'support ticket';
    await notificationService.createNotification(
      org.adminId,
      organizationId,
      'support_ticket_submitted',
      `New ${typeLabel} submitted: ${ticket.subject}`,
      `${submitterName} submitted a ${typeLabel}: "${ticket.subject}"`,
      {
        relatedModel: 'SupportTicket',
        relatedModelId: ticket._id,
        actionUrl: `/dashboard/support/${ticket._id}`,
      }
    );
  }
};

/**
 * List all tickets for the caller's organization (shared org-wide view -
 * any teammate can see what's already been raised, not just their own).
 * GET /api/support
 */
export const getTickets = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const tickets = await SupportTicket.find({ organizationId })
      .populate('createdBy', 'firstName lastName email')
      .sort({ updatedAt: -1 });
    res.json({ tickets });
  } catch (error) {
    console.error('Error fetching support tickets:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
};

/**
 * GET /api/support/:id
 */
export const getTicketById = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const ticket = await SupportTicket.findOne({ _id: req.params.id, organizationId })
      .populate('createdBy', 'firstName lastName email');
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json({ ticket });
  } catch (error) {
    console.error('Error fetching support ticket:', error);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
};

/**
 * Reply to a ticket. A closed ticket is terminal (raise a new one instead);
 * replying to a resolved ticket reopens it - "resolved" was the platform's
 * call, and an org following up means it wasn't actually resolved for them.
 * POST /api/support/:id/replies
 */
export const addReply = async (req, res) => {
  try {
    const organizationId = req.user.organizationId;
    const { message } = req.body;

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const ticket = await SupportTicket.findOne({ _id: req.params.id, organizationId });
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    if (ticket.status === 'closed') {
      return res.status(400).json({ error: 'This ticket is closed. Please submit a new ticket.' });
    }

    const author = await User.findById(req.user.userId).select('firstName lastName');
    ticket.replies.push({
      authorId: req.user.userId,
      authorName: author ? `${author.firstName} ${author.lastName}` : 'Team member',
      authorRole: 'org',
      message: message.trim(),
    });

    if (ticket.status === 'resolved') {
      ticket.status = 'open';
    }

    await ticket.save();
    res.json({ message: 'Reply sent', ticket });
  } catch (error) {
    console.error('Error replying to support ticket:', error);
    res.status(500).json({ error: 'Failed to send reply' });
  }
};

export default {
  createTicket,
  getTickets,
  getTicketById,
  addReply,
};
