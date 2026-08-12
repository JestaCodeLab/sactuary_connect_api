import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import Event from '../models/Event.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import Message from '../models/Message.js';
import Member from '../models/Member.js';
import ServiceCode from '../models/ServiceCode.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';
import { computeOccurrences, getNextOccurrence, getCurrentOccurrence } from '../utils/occurrenceHelper.js';
import { checkEventLimit } from '../utils/usageLimits.js';
import { serviceCodeService } from '../services/serviceCodeService.js';
import { assertClientUrlMatchesDatabase } from '../utils/urlSafety.js';

// Generates the initial QR code at event creation time, so a QR already
// exists the moment an admin opens the event's detail page. Mirrors the
// non-existing-token branch of generateQRCode below (which additionally
// handles regenerating/reusing tokens for events that already have one).
async function buildQrCode(event) {
  assertClientUrlMatchesDatabase(process.env.CLIENT_URL, process.env.MONGODB_URI);

  const token = uuidv4();
  const expiresAt = event.isRecurring
    ? null
    : (() => {
        const d = new Date(event.endDate);
        d.setHours(d.getHours() + 2);
        return d;
      })();

  const checkInUrl = `${process.env.CLIENT_URL || 'https://app.sanctuaryconnect.org'}/check-in/${token}`;
  const dataUrl = await QRCode.toDataURL(checkInUrl, {
    errorCorrectionLevel: 'M',
    width: 400,
    margin: 2,
  });

  return { token, dataUrl, expiresAt, occurrenceDate: null, generatedAt: new Date() };
}

export const getAllEvents = async (req, res) => {
  try {
    const now = new Date();
    const filter = branchFilter(req);

    // Date range filters from query params
    const { startDate, endDate, status, departmentId } = req.query;

    if (departmentId) {
      filter.departmentId = departmentId;
    }

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

    // Auto-transition: non-recurring ongoing events whose endDate has passed → completed
    await Event.updateMany(
      { ...branchFilter(req), status: 'ongoing', endDate: { $lt: now }, isRecurring: { $ne: true } },
      { $set: { status: 'completed', updatedAt: now } }
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

    const event = await Event.findOne({ _id: id, organizationId: req.organizationId })
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
    const { title, description, eventType, startDate, endDate, location, organizerId, maxCapacity, isRecurring, recurrencePattern, recurrenceDay, recurrenceEndDate, departmentId, reminders } = req.body;

    if (!title || !startDate || !endDate) {
      return res.status(400).json({ error: 'Title, start date, and end date are required' });
    }

    if (new Date(endDate) <= new Date(startDate)) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    if (isRecurring && !recurrencePattern) {
      return res.status(400).json({ error: 'A recurrence pattern is required for recurring events' });
    }

    let cleanReminders;
    if (Array.isArray(reminders)) {
      for (const reminder of reminders) {
        if (!Number.isFinite(reminder.offsetMinutes) || reminder.offsetMinutes < 0) {
          return res.status(400).json({ error: 'Each reminder needs a valid offset in minutes' });
        }
        if (!reminder.message && !reminder.templateId) {
          return res.status(400).json({ error: 'Each reminder needs a message or a template' });
        }
      }
      cleanReminders = reminders.map((r) => ({
        offsetMinutes: r.offsetMinutes,
        message: r.message || undefined,
        templateId: r.templateId || undefined,
      }));
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    // Check event limit
    const limitCheck = await checkEventLimit(req.organizationId);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: 'Event limit reached for your plan',
        code: 'EVENT_LIMIT_EXCEEDED',
        current: limitCheck.current,
        limit: limitCheck.limit,
      });
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
      departmentId: departmentId || undefined,
      isRecurring: isRecurring || false,
      recurrencePattern,
      recurrenceDay,
      recurrenceEndDate,
      usesServiceCodes: isRecurring || false, // Service codes enabled for recurring events
      reminders: cleanReminders,
    });

    // Generate the check-in QR code up front so it's already available the
    // first time an admin opens the event's detail page.
    event.qrCode = await buildQrCode(event);

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

    const existing = await Event.findOne({ _id: id, organizationId: req.organizationId });
    if (!existing) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Validate the merged result (existing values + this partial update), not just
    // whatever subset of fields happens to be in this particular request body.
    const mergedStartDate = updates.startDate !== undefined ? updates.startDate : existing.startDate;
    const mergedEndDate = updates.endDate !== undefined ? updates.endDate : existing.endDate;
    if (new Date(mergedEndDate) <= new Date(mergedStartDate)) {
      return res.status(400).json({ error: 'End date must be after start date' });
    }

    const mergedIsRecurring = updates.isRecurring !== undefined ? updates.isRecurring : existing.isRecurring;
    const mergedRecurrencePattern = updates.recurrencePattern !== undefined ? updates.recurrencePattern : existing.recurrencePattern;
    if (mergedIsRecurring && !mergedRecurrencePattern) {
      return res.status(400).json({ error: 'A recurrence pattern is required for recurring events' });
    }

    const event = await Event.findOneAndUpdate(
      { _id: id, organizationId: req.organizationId },
      updates,
      { new: true }
    );

    res.json(event);
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
};

export const deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findOneAndDelete({ _id: id, organizationId: req.organizationId });

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
    const event = await Event.findOne({ _id: eventId, organizationId: req.organizationId });

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
    const event = await Event.findOne({ _id: id, organizationId: req.organizationId });

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

    const clientUrl = process.env.CLIENT_URL || 'https://app.sanctuaryconnect.org';
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
      .populate('organizerId', 'firstName lastName')
      // Explicitly select only what a public visitor should see. The QR check-in
      // token/image (event.qrCode) is a bearer credential for the public check-in
      // flow - for recurring events it never expires, so leaking it here would let
      // anyone with a share link check people in indefinitely without ever scanning
      // the real QR code.
      .select('title description eventType startDate endDate location maxCapacity organizerId organizationId isPublic shareToken status');

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

    const event = await Event.findOne({ _id: id, organizationId: req.organizationId });
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

    const clientUrl = process.env.CLIENT_URL || 'https://app.sanctuaryconnect.org';
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

    const event = await Event.findOne({ _id: id, organizationId: req.organizationId });
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
    const event = await Event.findOne({ _id: id, organizationId: req.organizationId });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    assertClientUrlMatchesDatabase(process.env.CLIENT_URL, process.env.MONGODB_URI);

    let token = event.qrCode?.token;
    let expiresAt = null;
    let occurrenceDate = null;

    // For recurring events: generate ONE QR token and keep it forever
    if (event.isRecurring) {
      if (!token) {
        // Generate token only once for recurring events
        token = uuidv4();
        event.usesServiceCodes = true;
      }
      // No expiration for recurring event QR codes
    } else {
      // For non-recurring events: generate/refresh token with expiration
      token = uuidv4();
      expiresAt = new Date(event.endDate);
      expiresAt.setHours(expiresAt.getHours() + 2);
    }

    const checkInUrl = `${process.env.CLIENT_URL || 'https://app.sanctuaryconnect.org'}/check-in/${token}`;

    const dataUrl = await QRCode.toDataURL(checkInUrl, {
      errorCorrectionLevel: 'M',
      width: 400,
      margin: 2,
    });

    event.qrCode = {
      token,
      dataUrl,
      expiresAt,
      occurrenceDate,
      generatedAt: new Date(),
    };
    event.updatedAt = new Date();
    await event.save();

    res.json({
      token,
      dataUrl,
      expiresAt,
      checkInUrl,
      occurrenceDate,
      usesServiceCodes: event.usesServiceCodes || false,
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
};

export const getQRCode = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findOne({ _id: id, organizationId: req.organizationId });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!event.qrCode?.token) {
      return res.status(404).json({ error: 'QR code not generated for this event' });
    }

    const now = new Date();

    // For non-recurring events, check expiration
    if (!event.isRecurring && event.qrCode.expiresAt) {
      if (new Date(event.qrCode.expiresAt) < now) {
        return res.status(410).json({ error: 'QR code has expired' });
      }
    }

    const checkInUrl = `${process.env.CLIENT_URL || 'https://app.sanctuaryconnect.org'}/check-in/${event.qrCode.token}`;

    res.json({
      token: event.qrCode.token,
      dataUrl: event.qrCode.dataUrl,
      expiresAt: event.qrCode.expiresAt || null,
      checkInUrl,
      occurrenceDate: event.qrCode.occurrenceDate || null,
      usesServiceCodes: event.usesServiceCodes || false,
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
      .select('title description startDate endDate location eventType qrCode organizationId branchId status isRecurring recurrencePattern recurrenceDay recurrenceEndDate usesServiceCodes');

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
    let occurrenceDate = event.qrCode.occurrenceDate || null;

    if (event.isRecurring && event.qrCode.occurrenceDate) {
      const duration = new Date(event.endDate).getTime() - new Date(event.startDate).getTime();
      responseStartDate = event.qrCode.occurrenceDate;
      responseEndDate = new Date(new Date(event.qrCode.occurrenceDate).getTime() + duration);
    } else if (event.isRecurring) {
      // If no occurrence date set, compute next occurrence
      const nextOccurrence = getNextOccurrence(event, now);
      if (nextOccurrence) {
        occurrenceDate = nextOccurrence.startDate;
        const duration = new Date(event.endDate).getTime() - new Date(event.startDate).getTime();
        responseStartDate = nextOccurrence.startDate;
        responseEndDate = new Date(new Date(nextOccurrence.startDate).getTime() + duration);
      }
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
      usesServiceCodes: (event.isRecurring && event.usesServiceCodes) || false,
      occurrenceDate,
      token,
    });
  } catch (error) {
    console.error('Error fetching event by token:', error);
    res.status(500).json({ error: 'Failed to fetch event details' });
  }
};

export const searchMembersForCheckIn = async (req, res) => {
  try {
    const { token } = req.params;
    const { search = '' } = req.query;

    const event = await Event.findOne({ 'qrCode.token': token }).select('organizationId branchId qrCode');
    if (!event) {
      return res.status(404).json({ error: 'Invalid check-in token' });
    }

    if (!search.trim() || search.trim().length < 2) {
      return res.json({ members: [] });
    }

    const searchRegex = new RegExp(search.trim(), 'i');
    const members = await Member.find({
      organizationId: event.organizationId,
      $or: [
        { firstName: searchRegex },
        { lastName: searchRegex },
      ],
    })
      .select('_id firstName lastName phone')
      .limit(10)
      .lean();

    // Mask phone — show last 4 digits only for identity confirmation
    const results = members.map(m => ({
      _id: m._id,
      firstName: m.firstName,
      lastName: m.lastName,
      phoneTail: m.phone ? m.phone.slice(-4) : null,
    }));

    res.json({ members: results });
  } catch (error) {
    res.status(500).json({ error: 'Search failed' });
  }
};

export const getServiceCode = async (req, res) => {
  try {
    const { id } = req.params;
    const { occurrenceDate } = req.query;

    const event = await Event.findOne({ _id: id, organizationId: req.organizationId });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!event.isRecurring) {
      return res.status(400).json({ error: 'Service codes are only available for recurring events' });
    }

    // Auto-enable service codes for recurring events
    if (!event.usesServiceCodes) {
      event.usesServiceCodes = true;
      await event.save();
    }

    // Determine which occurrence to fetch service code for
    let targetOccurrenceStartDate;
    if (occurrenceDate) {
      // Parse provided occurrence date and find the matching occurrence with correct time-of-day
      const providedDate = new Date(occurrenceDate);
      const occurrences = computeOccurrences(event, providedDate, new Date(providedDate.getTime() + 24 * 60 * 60 * 1000));
      const matchingOccurrence = occurrences.find(occ =>
        occ.startDate.toDateString() === providedDate.toDateString()
      );

      if (!matchingOccurrence) {
        return res.status(404).json({ error: 'No occurrence found for the provided date' });
      }
      targetOccurrenceStartDate = matchingOccurrence.startDate;
    } else {
      // Get current or next occurrence
      const targetOccurrence = getCurrentOccurrence(event) || getNextOccurrence(event);
      if (!targetOccurrence) {
        return res.status(404).json({ error: 'No current or upcoming occurrences for this event' });
      }
      targetOccurrenceStartDate = targetOccurrence.startDate;
    }

    const serviceCode = await serviceCodeService.getCodeForOccurrence(
      event._id,
      targetOccurrenceStartDate
    );

    if (!serviceCode) {
      return res.status(404).json({ error: 'Service code not yet generated for this occurrence' });
    }

    res.json({
      code: serviceCode.code,
      occurrenceDate: serviceCode.occurrenceDate,
      expiresAt: serviceCode.expiresAt,
      usageCount: serviceCode.usageCount,
    });
  } catch (error) {
    console.error('Error fetching service code:', error);
    res.status(500).json({ error: 'Failed to fetch service code' });
  }
};

export const regenerateServiceCode = async (req, res) => {
  try {
    const { id } = req.params;
    const { occurrenceDate } = req.body;

    const event = await Event.findOne({ _id: id, organizationId: req.organizationId });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    if (!event.isRecurring) {
      return res.status(400).json({ error: 'Service codes are only available for recurring events' });
    }

    // Auto-enable service codes for recurring events
    if (!event.usesServiceCodes) {
      event.usesServiceCodes = true;
      await event.save();
    }

    // Determine target occurrence with full date/time info
    let targetOccurrence;
    if (occurrenceDate) {
      // Parse provided occurrence date and find the matching occurrence with correct time-of-day
      const providedDate = new Date(occurrenceDate);
      const occurrences = computeOccurrences(event, providedDate, new Date(providedDate.getTime() + 24 * 60 * 60 * 1000));
      const matchingOccurrence = occurrences.find(occ =>
        occ.startDate.toDateString() === providedDate.toDateString()
      );

      if (!matchingOccurrence) {
        return res.status(400).json({ error: 'No occurrence found for the provided date' });
      }
      targetOccurrence = matchingOccurrence;
    } else {
      // Use current or next occurrence
      targetOccurrence = getCurrentOccurrence(event) || getNextOccurrence(event);
      if (!targetOccurrence) {
        return res.status(400).json({ error: 'No upcoming occurrences for this event' });
      }
    }

    // Generate new service code with proper occurrence end time - forceNew:true
    // because this endpoint is specifically the "Regenerate" action, not a plain
    // get-or-create (that's what GET /:id/service-code is for).
    const serviceCode = await serviceCodeService.generateCodeForOccurrence(
      event._id,
      targetOccurrence.startDate,
      event.organizationId,
      event.branchId,
      { startDate: targetOccurrence.startDate, endDate: targetOccurrence.endDate },
      true
    );

    res.json({
      code: serviceCode.code,
      occurrenceDate: serviceCode.occurrenceDate,
      expiresAt: serviceCode.expiresAt,
      usageCount: serviceCode.usageCount,
    });
  } catch (error) {
    console.error('Error regenerating service code:', error);
    res.status(500).json({ error: 'Failed to regenerate service code' });
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
  searchMembersForCheckIn,
  getServiceCode,
  regenerateServiceCode,
};
