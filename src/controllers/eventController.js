import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import Event from '../models/Event.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import Message from '../models/Message.js';
import Member from '../models/Member.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';
import { computeOccurrences, getNextOccurrence, getCurrentOccurrence } from '../utils/occurrenceHelper.js';

export const getAllEvents = async (req, res) => {
  try {
    const now = new Date();
    const filter = branchFilter(req);

    // Date range filters from query params
    const { startDate, endDate, status } = req.query;
    
    if (startDate) {
      filter.startDate = { ...filter.startDate, $gte: new Date(startDate) };
    }
    
    if (endDate) {
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999); // Include entire end date
      filter.startDate = { ...filter.startDate, $lte: endDateTime };
    }

    // Status filter
    if (status && ['scheduled', 'ongoing', 'completed', 'cancelled'].includes(status)) {
      filter.status = status;
    }

    // Auto-transition: non-recurring scheduled events whose endDate has passed → completed
    await Event.updateMany(
      { ...branchFilter(req), status: 'scheduled', endDate: { $lt: now }, isRecurring: { $ne: true } },
      { $set: { status: 'completed', updatedAt: now } }
    );

    // Auto-transition: non-recurring scheduled events that have started but not ended → ongoing
    await Event.updateMany(
      { ...branchFilter(req), status: 'scheduled', startDate: { $lte: now }, endDate: { $gte: now }, isRecurring: { $ne: true } },
      { $set: { status: 'ongoing', updatedAt: now } }
    );

    // Auto-transition: recurring events whose recurrenceEndDate has passed → completed
    await Event.updateMany(
      { ...branchFilter(req), isRecurring: true, status: 'scheduled', recurrenceEndDate: { $lt: now, $exists: true } },
      { $set: { status: 'completed', updatedAt: now } }
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
    const now = new Date();
    
    const event = await Event.findById(id)
      .populate('organizerId', 'firstName lastName email');

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Auto-transition event status based on current time
    let statusChanged = false;

    if (event.isRecurring) {
      // Recurring events are completed only when the series ends
      if (event.status === 'scheduled' && event.recurrenceEndDate && event.recurrenceEndDate < now) {
        event.status = 'completed';
        event.updatedAt = now;
        statusChanged = true;
      }
    } else {
      if (event.status === 'scheduled') {
        if (event.endDate < now) {
          event.status = 'completed';
          event.updatedAt = now;
          statusChanged = true;
        } else if (event.startDate <= now && event.endDate >= now) {
          event.status = 'ongoing';
          event.updatedAt = now;
          statusChanged = true;
        }
      } else if (event.status === 'ongoing' && event.endDate < now) {
        event.status = 'completed';
        event.updatedAt = now;
        statusChanged = true;
      }
    }

    if (statusChanged) {
      await event.save();
    }

    res.json(event);
  } catch (error) {
    console.error('Error fetching event:', error);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
};

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

// Get upcoming occurrences for a recurring event
export const getUpcomingOccurrences = async (req, res) => {
  try {
    const { id } = req.params;
    const rangeDays = parseInt(req.query.range) || 30;

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!event.isRecurring) {
      return res.status(400).json({ error: 'Event is not a recurring event' });
    }

    const now = new Date();
    const rangeEnd = new Date(now);
    rangeEnd.setDate(rangeEnd.getDate() + rangeDays);

    const occurrences = computeOccurrences(event, now, rangeEnd);

    // Attach attendance count for each occurrence
    const result = await Promise.all(
      occurrences.map(async (occ) => {
        const attendeeCount = await AttendanceRecord.countDocuments({
          eventId: event._id,
          occurrenceDate: occ.startDate,
        });
        return { startDate: occ.startDate, endDate: occ.endDate, attendeeCount };
      })
    );

    res.json(result);
  } catch (error) {
    console.error('Error fetching occurrences:', error);
    res.status(500).json({ error: 'Failed to fetch occurrences' });
  }
};

export const generateQRCode = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const token = uuidv4();
    let expiresAt;
    let occurrenceDate = null;

    if (event.isRecurring) {
      // For recurring events, generate QR for the current or next occurrence
      const occurrence = getCurrentOccurrence(event) || getNextOccurrence(event);
      if (!occurrence) {
        return res.status(400).json({ error: 'No upcoming occurrences for this recurring event' });
      }
      expiresAt = new Date(occurrence.endDate);
      expiresAt.setHours(expiresAt.getHours() + 2);
      occurrenceDate = occurrence.startDate;
    } else {
      expiresAt = new Date(event.endDate);
      expiresAt.setHours(expiresAt.getHours() + 2);
    }

    const checkInUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/check-in/${token}`;

    const dataUrl = await QRCode.toDataURL(checkInUrl, {
      errorCorrectionLevel: 'M',
      width: 400,
      margin: 2,
    });

    event.qrCode = { token, dataUrl, expiresAt, occurrenceDate };
    event.updatedAt = new Date();
    await event.save();

    res.json({
      token,
      dataUrl,
      expiresAt,
      checkInUrl,
      occurrenceDate,
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

    const now = new Date();
    const hasValidQR = event.qrCode?.token && event.qrCode?.expiresAt && new Date(event.qrCode.expiresAt) > now;

    // For recurring events, auto-refresh if QR is expired or missing
    if (event.isRecurring && !hasValidQR) {
      const occurrence = getCurrentOccurrence(event) || getNextOccurrence(event);
      if (!occurrence) {
        return res.status(400).json({ error: 'No upcoming occurrences for this recurring event' });
      }

      const token = uuidv4();
      const expiresAt = new Date(occurrence.endDate);
      expiresAt.setHours(expiresAt.getHours() + 2);
      const checkInUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/check-in/${token}`;

      const dataUrl = await QRCode.toDataURL(checkInUrl, {
        errorCorrectionLevel: 'M',
        width: 400,
        margin: 2,
      });

      event.qrCode = { token, dataUrl, expiresAt, occurrenceDate: occurrence.startDate };
      event.updatedAt = now;
      await event.save();

      return res.json({
        token,
        dataUrl,
        expiresAt,
        checkInUrl,
        occurrenceDate: occurrence.startDate,
      });
    }

    if (!hasValidQR) {
      if (!event.qrCode?.token) {
        return res.status(404).json({ error: 'QR code not generated for this event' });
      }
      return res.status(410).json({ error: 'QR code has expired' });
    }

    const checkInUrl = `${process.env.CLIENT_URL || 'http://localhost:3000'}/check-in/${event.qrCode.token}`;

    res.json({
      token: event.qrCode.token,
      dataUrl: event.qrCode.dataUrl,
      expiresAt: event.qrCode.expiresAt,
      checkInUrl,
      occurrenceDate: event.qrCode.occurrenceDate || null,
    });
  } catch (error) {
    console.error('Error fetching QR code:', error);
    res.status(500).json({ error: 'Failed to fetch QR code' });
  }
};

export const getEventByToken = async (req, res) => {
  try {
    const { token } = req.params;
    const now = new Date();

    const event = await Event.findOne({ 'qrCode.token': token })
      .select('title description startDate endDate location eventType qrCode organizationId branchId status isRecurring recurrenceEndDate');

    if (!event) {
      return res.status(404).json({ error: 'Invalid or expired check-in token' });
    }

    // Check if QR code is expired
    if (event.qrCode.expiresAt && new Date() > new Date(event.qrCode.expiresAt)) {
      return res.status(410).json({ error: 'Check-in token has expired' });
    }

    // For recurring events, compute occurrence-specific dates
    let responseStartDate = event.startDate;
    let responseEndDate = event.endDate;

    if (event.isRecurring && event.qrCode.occurrenceDate) {
      const duration = new Date(event.endDate).getTime() - new Date(event.startDate).getTime();
      responseStartDate = event.qrCode.occurrenceDate;
      responseEndDate = new Date(new Date(event.qrCode.occurrenceDate).getTime() + duration);
    }

    res.json({
      eventId: event._id,
      title: event.title,
      description: event.description,
      startDate: responseStartDate,
      endDate: responseEndDate,
      location: event.location,
      eventType: event.eventType,
      status: event.status,
      isRecurring: event.isRecurring || false,
      occurrenceDate: event.qrCode.occurrenceDate || null,
      token,
    });
  } catch (error) {
    console.error('Error fetching event by token:', error);
    res.status(500).json({ error: 'Failed to fetch event details' });
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
  getUpcomingOccurrences,
  generateQRCode,
  getQRCode,
  getEventByToken,
};
