import crypto from 'crypto';
import Event from '../models/Event.js';
import Message from '../models/Message.js';
import Member from '../models/Member.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';

export const getAllEvents = async (req, res) => {
  try {
    const events = await Event.find(branchFilter(req))
      .populate('organizerId', 'firstName lastName email')
      .sort({ startDate: -1 });
    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
};

export const getEventById = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id)
      .populate('organizerId', 'firstName lastName email');

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
};

export const createEvent = async (req, res) => {
  try {
    const { title, description, eventType, startDate, endDate, location, organizerId, maxCapacity } = req.body;

    if (!title || !startDate || !endDate) {
      return res.status(400).json({ error: 'Title, start date, and end date are required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    const event = new Event({
      organizationId: req.organizationId,
      branchId,
      title,
      description,
      eventType,
      startDate,
      endDate,
      location,
      organizerId: organizerId || req.user.userId,
      maxCapacity,
    });

    await event.save();
    res.status(201).json(event);
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
};

export const updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updatedAt: Date.now() };
    delete updates._id;
    delete updates.organizationId;
    delete updates.branchId;

    const event = await Event.findByIdAndUpdate(id, updates, { new: true });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
};

export const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findByIdAndDelete(id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
};

export const registerForEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.status(201).json({ message: 'Registered for event successfully', eventId });
  } catch (error) {
    console.error('Error registering for event:', error);
    res.status(500).json({ error: 'Failed to register for event' });
  }
};

export const generateShareLink = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Generate share token if not already set
    if (!event.shareToken) {
      event.shareToken = crypto.randomBytes(16).toString('hex');
      event.isPublic = true;
      event.updatedAt = new Date();
      await event.save();
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const shareUrl = `${clientUrl}/events/${event.shareToken}`;

    res.json({ shareUrl, shareToken: event.shareToken });
  } catch (error) {
    console.error('Error generating share link:', error);
    res.status(500).json({ error: 'Failed to generate share link' });
  }
};

export const getPublicEvent = async (req, res) => {
  try {
    const { shareToken } = req.params;
    const event = await Event.findOne({ shareToken, isPublic: true })
      .populate('organizerId', 'firstName lastName');

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    res.json(event);
  } catch (error) {
    console.error('Error fetching public event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
};

export const shareEventByEmail = async (req, res) => {
  try {
    const { id } = req.params;
    const { memberIds, message: customMessage } = req.body;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!memberIds || memberIds.length === 0) {
      return res.status(400).json({ error: 'At least one member must be selected' });
    }

    // Ensure share link exists
    if (!event.shareToken) {
      event.shareToken = crypto.randomBytes(16).toString('hex');
      event.isPublic = true;
      await event.save();
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    const shareUrl = `${clientUrl}/events/${event.shareToken}`;

    const startDate = new Date(event.startDate).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const body = customMessage
      ? `${customMessage}\n\nEvent: ${event.title}\nDate: ${startDate}\nLocation: ${event.location || 'TBD'}\n\nView details: ${shareUrl}`
      : `You're invited to ${event.title}!\n\nDate: ${startDate}\nLocation: ${event.location || 'TBD'}\n\nView details: ${shareUrl}`;

    // Create a message record
    await Message.create({
      organizationId: req.organizationId,
      branchId: resolveCreateBranch(req),
      subject: `Event Invitation: ${event.title}`,
      body,
      recipientType: 'individual',
      recipientCount: memberIds.length,
      channel: 'email',
      status: 'sent',
      sentAt: new Date(),
      authorId: req.user.userId,
    });

    res.json({ message: `Event shared with ${memberIds.length} member(s)` });
  } catch (error) {
    console.error('Error sharing event by email:', error);
    res.status(500).json({ error: 'Failed to share event' });
  }
};

export default {
  getAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  registerForEvent,
  generateShareLink,
  getPublicEvent,
  shareEventByEmail,
};
