import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import Event from '../models/Event.js';
import Message from '../models/Message.js';
import Member from '../models/Member.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';

export const getAllEvents = async (req, res) => {
  try {
    const now = new Date();
    const filter = branchFilter(req);

    // Auto-transition: scheduled events whose endDate has passed → completed
    await Event.updateMany(
      { ...filter, status: 'scheduled', endDate: { $lt: now } },
      { $set: { status: 'completed', updatedAt: now } }
    );

    // Auto-transition: scheduled events that have started but not ended → ongoing
    await Event.updateMany(
      { ...filter, status: 'scheduled', startDate: { $lte: now }, endDate: { $gte: now } },
      { $set: { status: 'ongoing', updatedAt: now } }
    );

    const events = await Event.find(filter)
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

function generateRecurringDates(startDate, endDate, pattern, recurrenceDay, recurrenceEndDate) {
  const dates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const duration = end.getTime() - start.getTime();
  const recurEnd = recurrenceEndDate ? new Date(recurrenceEndDate) : new Date(start);

  if (!recurrenceEndDate) {
    recurEnd.setDate(recurEnd.getDate() + 28); // Default 4 weeks ahead
  }

  let current = new Date(start);
  // Move to the next occurrence of the recurrence day
  if (recurrenceDay !== undefined) {
    while (current.getDay() !== recurrenceDay) {
      current.setDate(current.getDate() + 1);
    }
  }
  // Skip the first date (it's the template event itself)
  const increment = pattern === 'weekly' ? 7 : pattern === 'biweekly' ? 14 : 30;
  current.setDate(current.getDate() + increment);

  while (current <= recurEnd) {
    const instanceStart = new Date(current);
    const instanceEnd = new Date(instanceStart.getTime() + duration);
    dates.push({ startDate: instanceStart, endDate: instanceEnd });

    if (pattern === 'monthly') {
      current.setMonth(current.getMonth() + 1);
    } else {
      current.setDate(current.getDate() + increment);
    }
  }

  return dates;
}

export const createEvent = async (req, res) => {
  try {
    const { title, description, eventType, startDate, endDate, location, organizerId, maxCapacity, isRecurring, recurrencePattern, recurrenceDay, recurrenceEndDate } = req.body;

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
      isRecurring: isRecurring || false,
      recurrencePattern,
      recurrenceDay,
      recurrenceEndDate,
    });

    await event.save();

    // Generate recurring instances
    if (isRecurring && recurrencePattern) {
      const dates = generateRecurringDates(startDate, endDate, recurrencePattern, recurrenceDay, recurrenceEndDate);
      const instances = dates.map((d) => ({
        organizationId: req.organizationId,
        branchId,
        title,
        description,
        eventType,
        startDate: d.startDate,
        endDate: d.endDate,
        location,
        organizerId: organizerId || req.user.userId,
        maxCapacity,
        parentEventId: event._id,
      }));

      if (instances.length > 0) {
        await Event.insertMany(instances);
      }
    }

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

export const generateInstances = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!event.isRecurring || !event.recurrencePattern) {
      return res.status(400).json({ error: 'Event is not a recurring event' });
    }

    // Find the latest existing instance to generate from
    const latestInstance = await Event.findOne({ parentEventId: event._id })
      .sort({ startDate: -1 });

    const generateFrom = latestInstance ? latestInstance.startDate : event.startDate;
    const duration = new Date(event.endDate).getTime() - new Date(event.startDate).getTime();

    // Generate 4 more weeks from the latest instance
    const endGenDate = new Date(generateFrom);
    endGenDate.setDate(endGenDate.getDate() + 28);

    const dates = generateRecurringDates(
      generateFrom,
      new Date(new Date(generateFrom).getTime() + duration),
      event.recurrencePattern,
      event.recurrenceDay,
      event.recurrenceEndDate || endGenDate
    );

    const instances = dates.map((d) => ({
      organizationId: event.organizationId,
      branchId: event.branchId,
      title: event.title,
      description: event.description,
      eventType: event.eventType,
      startDate: d.startDate,
      endDate: d.endDate,
      location: event.location,
      organizerId: event.organizerId,
      maxCapacity: event.maxCapacity,
      parentEventId: event._id,
    }));

    let created = 0;
    if (instances.length > 0) {
      const result = await Event.insertMany(instances);
      created = result.length;
    }

    res.json({ message: `Generated ${created} event instance(s)` });
  } catch (error) {
    console.error('Error generating instances:', error);
    res.status(500).json({ error: 'Failed to generate event instances' });
  }
};

export const generateQRCode = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Generate or refresh QR code token
    const token = uuidv4();
    const expiresAt = new Date(event.endDate);
    expiresAt.setHours(expiresAt.getHours() + 2); // Valid for 2 hours after event ends

    // Generate QR code data URL
    const qrData = JSON.stringify({
      eventId: event._id,
      token,
      type: 'attendance',
    });

    const dataUrl = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: 'M',
      width: 400,
      margin: 2,
    });

    event.qrCode = {
      token,
      dataUrl,
      expiresAt,
    };
    event.updatedAt = new Date();
    await event.save();

    res.json({
      token,
      dataUrl,
      expiresAt,
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
};

export const getQRCode = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!event.qrCode || !event.qrCode.token) {
      return res.status(404).json({ error: 'QR code not generated for this event' });
    }

    // Check if QR code is expired
    if (event.qrCode.expiresAt && new Date() > new Date(event.qrCode.expiresAt)) {
      return res.status(410).json({ error: 'QR code has expired' });
    }

    res.json({
      token: event.qrCode.token,
      dataUrl: event.qrCode.dataUrl,
      expiresAt: event.qrCode.expiresAt,
    });
  } catch (error) {
    console.error('Error fetching QR code:', error);
    res.status(500).json({ error: 'Failed to fetch QR code' });
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
  generateInstances,
  generateQRCode,
  getQRCode,
};
