import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';
import Attendance from '../models/Attendance.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import Event from '../models/Event.js';
import Member from '../models/Member.js';
import User from '../models/User.js';
import ServiceCode from '../models/ServiceCode.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';
import { getNextOccurrence, getCurrentOccurrence, getOccurrenceForCheckIn, findOccurrenceByDate, computeOccurrences } from '../utils/occurrenceHelper.js';
import { normalizePhone, findMemberByPhone } from '../utils/phoneUtils.js';
import { serviceCodeService } from '../services/serviceCodeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORTS_DIR = path.join(__dirname, '../../exports');

// List events (org/branch-scoped) with their attendance counts, filterable by
// date range / status / title search - the events themselves are the source of
// truth (so an event with zero check-ins still shows up as 0, not omitted), with
// AttendanceRecord counts merged in per event.
export const getAllAttendance = async (req, res) => {
  try {
    const { startDate, endDate, status, search } = req.query;
    const filter = branchFilter(req);

    const rangeStart = startDate ? new Date(startDate) : null;
    let rangeEnd = null;
    if (endDate) {
      rangeEnd = new Date(endDate);
      rangeEnd.setHours(23, 59, 59, 999);
    }
    const hasDateFilter = !!(rangeStart || rangeEnd);

    if (status && ['scheduled', 'ongoing', 'completed', 'cancelled'].includes(status)) {
      filter.status = status;
    }
    if (search && search.trim()) {
      filter.title = { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    // A recurring event's own startDate is only its *first* occurrence, so it
    // can't be date-filtered in the query the way a one-off event can - a
    // weekly service that started months ago would never match a "this week"
    // filter even though it met this week. Recurring events are therefore
    // matched in JS below, against their actual computed occurrences.
    const dateFilter = {};
    if (rangeStart) dateFilter.$gte = rangeStart;
    if (rangeEnd) dateFilter.$lte = rangeEnd;

    const query = hasDateFilter
      ? { ...filter, $or: [{ isRecurring: { $ne: true }, startDate: dateFilter }, { isRecurring: true }] }
      : filter;

    const events = await Event.find(query)
      .select('title startDate endDate eventType status isRecurring recurrencePattern recurrenceDay recurrenceEndDate')
      .sort({ startDate: -1 })
      .limit(100);

    // For each recurring event, work out which of its occurrences fall inside
    // the requested window (all of them when no date filter is applied).
    const occurrenceWindow = new Map();
    const visibleEvents = events.filter((event) => {
      if (!event.isRecurring) return true;

      const from = rangeStart || new Date(event.startDate);
      const to = rangeEnd || new Date();
      const occurrences = computeOccurrences(event, from, to);

      if (hasDateFilter && occurrences.length === 0) return false;

      occurrenceWindow.set(String(event._id), occurrences);
      return true;
    });

    const eventIds = visibleEvents.map((e) => e._id);

    // Scope the counts to the same window the filter describes, so the numbers
    // shown match what was actually filtered for rather than being a lifetime
    // total across every occurrence the series has ever had.
    const countMatch = { eventId: { $in: eventIds } };
    if (hasDateFilter) {
      const checkInRange = {};
      if (rangeStart) checkInRange.$gte = rangeStart;
      if (rangeEnd) checkInRange.$lte = rangeEnd;
      // occurrenceDate is what a recurring event's records are keyed by;
      // one-off events have none, so fall back to checkInTime.
      countMatch.$or = [{ occurrenceDate: checkInRange }, { occurrenceDate: null, checkInTime: checkInRange }];
    }

    const attendanceCounts = await AttendanceRecord.aggregate([
      { $match: countMatch },
      {
        $group: {
          _id: '$eventId',
          totalCheckIns: { $sum: 1 },
          members: { $sum: { $cond: [{ $ne: ['$memberId', null] }, 1, 0] } },
          guests: { $sum: { $cond: [{ $eq: ['$checkInMethod', 'guest'] }, 1, 0] } },
          qrCheckIns: { $sum: { $cond: [{ $eq: ['$checkInMethod', 'qr'] }, 1, 0] } },
        },
      },
    ]);
    const countsByEvent = new Map(attendanceCounts.map((c) => [String(c._id), c]));

    const results = visibleEvents.map((event) => {
      const counts = countsByEvent.get(String(event._id));
      const occurrences = occurrenceWindow.get(String(event._id));

      // Show the most recent relevant occurrence rather than the series
      // anchor, otherwise a filtered row displays a date outside the very
      // range the user filtered by.
      let eventDate = event.startDate;
      let eventEndDate = event.endDate;
      if (event.isRecurring && occurrences?.length) {
        const latest = occurrences[occurrences.length - 1];
        eventDate = latest.startDate;
        eventEndDate = latest.endDate;
      }

      return {
        eventId: event._id,
        eventTitle: event.title,
        eventDate,
        eventEndDate,
        eventType: event.eventType,
        eventStatus: event.status,
        isRecurring: event.isRecurring,
        occurrencesInRange: event.isRecurring ? (occurrences?.length || 0) : undefined,
        totalCheckIns: counts?.totalCheckIns || 0,
        members: counts?.members || 0,
        guests: counts?.guests || 0,
        qrCheckIns: counts?.qrCheckIns || 0,
      };
    });

    res.json(results);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Failed to fetch attendance records' });
  }
};

export const getAttendanceById = async (req, res) => {
  try {
    const { id } = req.params;
    const record = await Attendance.findOne({ _id: id, organizationId: req.organizationId })
      .populate('eventId', 'title eventType');

    if (!record) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    res.json(record);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Failed to fetch attendance record' });
  }
};

export const createAttendance = async (req, res) => {
  try {
    const { eventId, date, totalPresent, totalAbsent, notes } = req.body;

    if (!eventId || !date) {
      return res.status(400).json({ error: 'Event and date are required' });
    }

    const branchId = resolveCreateBranch(req);
    if (!branchId) {
      return res.status(400).json({ error: 'Branch is required' });
    }

    const record = await Attendance.create({
      organizationId: req.organizationId,
      branchId,
      eventId,
      date,
      totalPresent: totalPresent || 0,
      totalAbsent: totalAbsent || 0,
      notes,
    });

    const populated = await record.populate('eventId', 'title eventType');
    res.status(201).json(populated);
  } catch (error) {
    console.error('Error creating attendance:', error);
    res.status(500).json({ error: 'Failed to create attendance record' });
  }
};

export const updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    delete updates._id;
    delete updates.organizationId;
    delete updates.branchId;
    updates.updatedAt = Date.now();

    const record = await Attendance.findOneAndUpdate(
      { _id: id, organizationId: req.organizationId },
      updates,
      { new: true }
    )
      .populate('eventId', 'title eventType');

    if (!record) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    res.json(record);
  } catch (error) {
    console.error('Error updating attendance:', error);
    res.status(500).json({ error: 'Failed to update attendance record' });
  }
};

export const deleteAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const record = await Attendance.findOneAndDelete({ _id: id, organizationId: req.organizationId });

    if (!record) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    res.json({ message: 'Attendance record deleted successfully' });
  } catch (error) {
    console.error('Error deleting attendance:', error);
    res.status(500).json({ error: 'Failed to delete attendance record' });
  }
};

export const getAttendanceStats = async (req, res) => {
  try {
    // Get stats from AttendanceRecord (individual check-ins)
    const filter = branchFilter(req);
    
    // Total check-ins
    const totalCheckIns = await AttendanceRecord.countDocuments(filter);
    
    // Check-ins by method
    const qrCheckIns = await AttendanceRecord.countDocuments({ ...filter, checkInMethod: 'qr' });
    const manualCheckIns = await AttendanceRecord.countDocuments({ ...filter, checkInMethod: 'manual' });
    const guestCheckIns = await AttendanceRecord.countDocuments({ ...filter, checkInMethod: 'guest' });
    
    // Unique events with check-ins
    const eventsWithCheckIns = await AttendanceRecord.distinct('eventId', filter);
    
    // Recent check-ins (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentCheckIns = await AttendanceRecord.countDocuments({
      ...filter,
      checkInTime: { $gte: sevenDaysAgo },
    });
    
    // Last check-in time
    const lastCheckIn = await AttendanceRecord.findOne(filter)
      .sort({ checkInTime: -1 })
      .select('checkInTime');

    res.json({
      totalCheckIns,
      qrCheckIns,
      manualCheckIns,
      guestCheckIns,
      eventsWithCheckIns: eventsWithCheckIns.length,
      recentCheckIns,
      lastCheckInTime: lastCheckIn?.checkInTime || null,
    });
  } catch (error) {
    console.error('Error fetching attendance stats:', error);
    res.status(500).json({ error: 'Failed to fetch attendance stats' });
  }
};

export const checkInWithQR = async (req, res) => {
  try {
    const { token, serviceCode, memberId, userId, name, email, phone } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'QR token is required' });
    }

    // Find event by QR token
    const event = await Event.findOne({ 'qrCode.token': token });

    if (!event) {
      return res.status(404).json({ error: 'Invalid QR code' });
    }

    // Check if QR code is expired (only for non-recurring events)
    if (!event.isRecurring && event.qrCode.expiresAt && new Date() > new Date(event.qrCode.expiresAt)) {
      return res.status(410).json({ error: 'QR code has expired' });
    }

    // For recurring events, calculate current occurrence and validate service code
    let occurrenceDate = null;
    let checkStartDate = event.startDate;

    if (event.isRecurring && event.usesServiceCodes) {
      // Find current or next occurrence
      const occurrence = getCurrentOccurrence(event) || getNextOccurrence(event);
      if (!occurrence) {
        return res.status(400).json({ error: 'No upcoming occurrences for this event' });
      }

      occurrenceDate = occurrence.startDate;
      checkStartDate = occurrence.startDate;

      // Validate service code
      if (!serviceCode) {
        return res.status(400).json({
          error: 'Service code is required for this event',
          requiresServiceCode: true
        });
      }

      const isValidCode = await serviceCodeService.validateCode(
        serviceCode,
        event._id,
        occurrenceDate
      );

      if (!isValidCode) {
        return res.status(400).json({ error: 'Invalid or expired service code' });
      }
    }

    // Check if event has started
    if (new Date() < new Date(checkStartDate)) {
      return res.status(400).json({
        error: 'Check-in is not yet available. This event has not started yet.',
        startDate: checkStartDate
      });
    }

    // Check if already checked in (scoped to occurrence for recurring events)
    let existingCheckIn = null;
    const duplicateFilter = { eventId: event._id };
    if (occurrenceDate) {
      duplicateFilter.occurrenceDate = occurrenceDate;
    }

    // Try to match phone to an existing member in this organization
    let matchedMember = null;
    if (!memberId && !userId && phone) {
      matchedMember = await findMemberByPhone(Member, phone, event.organizationId);
    }

    // This is a public, unauthenticated endpoint - memberId/userId arrive directly
    // from the client and must be verified as actually belonging to this event's
    // organization before being trusted, otherwise anyone could tie an arbitrary
    // member/user from any org to this attendance record. An invalid id is treated
    // as if it were never supplied (falls back to phone/name/guest matching below)
    // rather than erroring, so this doesn't leak whether a given id exists elsewhere.
    let verifiedMemberId = null;
    if (memberId) {
      const memberDoc = await Member.findOne({ _id: memberId, organizationId: event.organizationId }).select('_id');
      if (memberDoc) verifiedMemberId = memberDoc._id;
    }
    let verifiedUserId = null;
    if (userId) {
      const userDoc = await User.findOne({ _id: userId, organizationId: event.organizationId }).select('_id');
      if (userDoc) verifiedUserId = userDoc._id;
    }

    const resolvedMemberId = verifiedMemberId || (matchedMember ? matchedMember._id : null);

    if (resolvedMemberId || verifiedUserId) {
      existingCheckIn = await AttendanceRecord.findOne({
        ...duplicateFilter,
        $or: [
          resolvedMemberId ? { memberId: resolvedMemberId } : null,
          verifiedUserId ? { userId: verifiedUserId } : null,
        ].filter(Boolean),
      });
    } else if (phone) {
      existingCheckIn = await AttendanceRecord.findOne({
        ...duplicateFilter,
        phone: normalizePhone(phone),
        checkInMethod: 'guest',
      });
    } else if (name && name.trim()) {
      // No phone to key off - fall back to a case-insensitive exact name match
      // within this occurrence so a guest can't rack up unlimited duplicate
      // check-ins by resubmitting the same name with no phone.
      existingCheckIn = await AttendanceRecord.findOne({
        ...duplicateFilter,
        checkInMethod: 'guest',
        name: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      });
    }

    if (existingCheckIn) {
      return res.status(400).json({
        error: 'Already checked in',
        checkInTime: existingCheckIn.checkInTime,
      });
    }

    // Create attendance record
    const checkInData = {
      organizationId: event.organizationId,
      branchId: event.branchId,
      eventId: event._id,
      checkInMethod: 'qr',
      checkInTime: new Date(),
    };

    if (occurrenceDate) {
      checkInData.occurrenceDate = occurrenceDate;
    }

    if (resolvedMemberId) {
      checkInData.memberId = resolvedMemberId;
    } else if (verifiedUserId) {
      checkInData.userId = verifiedUserId;
    } else {
      checkInData.checkInMethod = 'guest';
      checkInData.name = name;
      checkInData.email = email;
      checkInData.phone = normalizePhone(phone);
    }

    const record = await AttendanceRecord.create(checkInData);
    const populated = await record.populate([
      { path: 'memberId', select: 'firstName lastName phone email' },
      { path: 'userId', select: 'firstName lastName email' },
      { path: 'eventId', select: 'title startDate endDate' },
    ]);

    res.status(201).json({
      message: 'Check-in successful',
      record: populated,
    });
  } catch (error) {
    console.error('Error checking in with QR:', error);
    res.status(500).json({ error: 'Failed to check in' });
  }
};

export const getEventAttendanceRecords = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { occurrenceDate } = req.query;

    const event = await Event.findOne({ _id: eventId, organizationId: req.organizationId }).select('_id');
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const filter = { eventId };
    if (occurrenceDate) {
      filter.occurrenceDate = new Date(occurrenceDate);
    }

    const records = await AttendanceRecord.find(filter)
      .populate('memberId', 'firstName lastName email phone')
      .populate('userId', 'firstName lastName email')
      .sort({ checkInTime: -1 });

    const stats = {
      total: records.length,
      members: records.filter(r => r.memberId).length,
      users: records.filter(r => r.userId && !r.memberId).length,
      guests: records.filter(r => !r.memberId && !r.userId).length,
      qrCheckIns: records.filter(r => r.checkInMethod === 'qr').length,
      manualCheckIns: records.filter(r => r.checkInMethod === 'manual' || r.checkInMethod === 'guest').length,
    };

    res.json({ records, stats });
  } catch (error) {
    console.error('Error fetching event attendance records:', error);
    res.status(500).json({ error: 'Failed to fetch attendance records' });
  }
};

export const manualCheckIn = async (req, res) => {
  try {
    const { eventId, memberId, userId, name, email, phone, notes, occurrenceDate: reqOccurrenceDate } = req.body;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required' });
    }

    const event = await Event.findOne({ _id: eventId, organizationId: req.organizationId });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Resolve occurrence date for recurring events
    let occurrenceDate = null;
    if (event.isRecurring) {
      const now = new Date();

      if (reqOccurrenceDate) {
        // Validate the client-supplied date is actually a scheduled occurrence
        // of this series, rather than persisting whatever date was posted.
        const requested = findOccurrenceByDate(event, reqOccurrenceDate);
        if (!requested) {
          return res.status(400).json({ error: 'That date is not a scheduled occurrence of this event' });
        }
        // An occurrence that hasn't begun can only be checked into when it's
        // the imminent one (early arrivals before doors open). Selecting, say,
        // next week's service is rejected - nobody has attended it yet.
        if (now < requested.startDate) {
          const imminent = getOccurrenceForCheckIn(event, now);
          const isImminent = imminent && imminent.startDate.getTime() === requested.startDate.getTime();
          if (!isImminent) {
            return res.status(400).json({
              error: 'Check-in is not yet available. This occurrence has not started yet.',
              startDate: requested.startDate,
            });
          }
        }
        occurrenceDate = requested.startDate;
      } else {
        const occ = getOccurrenceForCheckIn(event, now);
        if (!occ) {
          return res.status(400).json({ error: 'This event series has not started yet' });
        }
        occurrenceDate = occ.startDate;
      }
    }

    // Check if already checked in (scoped to occurrence)
    const duplicateFilter = { eventId };
    if (occurrenceDate) {
      duplicateFilter.occurrenceDate = occurrenceDate;
    }

    // Try to match phone to an existing member in this organization
    let matchedMember = null;
    if (!memberId && !userId && phone) {
      matchedMember = await findMemberByPhone(Member, phone, event.organizationId);
    }

    // Verify memberId/userId actually belong to this org before trusting them -
    // same reasoning as checkInWithQR: even though this route is admin/pastor-only,
    // trusting an unverified cross-org id would let an admin tie a foreign org's
    // member to this attendance record, and later leak that member's name/phone/
    // email to this org via the populated attendance list/export.
    let verifiedMemberId = null;
    if (memberId) {
      const memberDoc = await Member.findOne({ _id: memberId, organizationId: event.organizationId }).select('_id');
      if (memberDoc) verifiedMemberId = memberDoc._id;
    }
    let verifiedUserId = null;
    if (userId) {
      const userDoc = await User.findOne({ _id: userId, organizationId: event.organizationId }).select('_id');
      if (userDoc) verifiedUserId = userDoc._id;
    }

    const resolvedMemberId = verifiedMemberId || (matchedMember ? matchedMember._id : null);

    if (resolvedMemberId || verifiedUserId) {
      const existingCheckIn = await AttendanceRecord.findOne({
        ...duplicateFilter,
        $or: [
          resolvedMemberId ? { memberId: resolvedMemberId } : null,
          verifiedUserId ? { userId: verifiedUserId } : null,
        ].filter(Boolean),
      });

      if (existingCheckIn) {
        return res.status(400).json({
          error: 'Already checked in',
          checkInTime: existingCheckIn.checkInTime,
        });
      }
    } else if (phone) {
      const existingCheckIn = await AttendanceRecord.findOne({
        ...duplicateFilter,
        phone: normalizePhone(phone),
        checkInMethod: 'guest',
      });
      if (existingCheckIn) {
        return res.status(400).json({
          error: 'Already checked in',
          checkInTime: existingCheckIn.checkInTime,
        });
      }
    } else if (name && name.trim()) {
      // No phone to key off - same case-insensitive exact name match fallback
      // used in checkInWithQR, so repeated guest submissions can't rack up
      // unlimited duplicate records.
      const existingCheckIn = await AttendanceRecord.findOne({
        ...duplicateFilter,
        checkInMethod: 'guest',
        name: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
      });
      if (existingCheckIn) {
        return res.status(400).json({
          error: 'Already checked in',
          checkInTime: existingCheckIn.checkInTime,
        });
      }
    }

    const checkInData = {
      organizationId: event.organizationId,
      branchId: event.branchId,
      eventId,
      checkInMethod: 'manual',
      checkInTime: new Date(),
      notes,
    };

    if (occurrenceDate) {
      checkInData.occurrenceDate = occurrenceDate;
    }

    if (resolvedMemberId) {
      checkInData.memberId = resolvedMemberId;
    } else if (verifiedUserId) {
      checkInData.userId = verifiedUserId;
    } else {
      checkInData.checkInMethod = 'guest';
      checkInData.name = name;
      checkInData.email = email;
      checkInData.phone = normalizePhone(phone);
    }

    const record = await AttendanceRecord.create(checkInData);
    const populated = await record.populate([
      { path: 'memberId', select: 'firstName lastName phone email' },
      { path: 'userId', select: 'firstName lastName email' },
      { path: 'eventId', select: 'title startDate endDate' },
    ]);

    res.status(201).json({
      message: 'Check-in successful',
      record: populated,
    });
  } catch (error) {
    console.error('Error manual check-in:', error);
    res.status(500).json({ error: 'Failed to check in' });
  }
};

// Export attendance report for a specific event as CSV or PDF
export const exportEventAttendance = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { format = 'csv', occurrenceDate } = req.query;

    console.log('Export attendance request:', { eventId, format, occurrenceDate });

    const event = await Event.findOne({ _id: eventId, organizationId: req.organizationId });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const filter = { eventId };
    if (occurrenceDate) {
      filter.occurrenceDate = new Date(occurrenceDate);
    }

    const records = await AttendanceRecord.find(filter)
      .populate('memberId', 'firstName lastName email phone')
      .populate('userId', 'firstName lastName email')
      .sort({ checkInTime: 1 });

    const stats = {
      total: records.length,
      members: records.filter(r => r.memberId).length,
      guests: records.filter(r => r.checkInMethod === 'guest').length,
      qrCheckIns: records.filter(r => r.checkInMethod === 'qr').length,
      manualCheckIns: records.filter(r => r.checkInMethod === 'manual').length,
    };

    // Resolve name, type, and contact for each record
    const resolvedRecords = records.map(r => {
      let name = 'Unknown';
      let type = 'Guest';
      let contact = '';

      if (r.memberId) {
        name = `${r.memberId.firstName} ${r.memberId.lastName}`;
        type = 'Member';
        contact = r.memberId.email || r.memberId.phone || '';
      } else if (r.userId) {
        name = `${r.userId.firstName} ${r.userId.lastName}`;
        type = 'User';
        contact = r.userId.email || '';
      } else if (r.name) {
        name = r.name;
        type = 'Guest';
        contact = r.email || r.phone || '';
      }

      return {
        name,
        type,
        method: r.checkInMethod === 'qr' ? 'QR' : r.checkInMethod === 'manual' ? 'Manual' : 'Guest',
        checkInTime: new Date(r.checkInTime).toLocaleString(),
        contact,
      };
    });

    const fileName = `attendance-${eventId}-${new Date().toISOString().split('T')[0]}.${format}`;

    if (format === 'csv') {
      const csvHeaders = ['Name', 'Type', 'Check-In Method', 'Check-In Time', 'Contact'].join(',');
      const csvRows = resolvedRecords.map(r =>
        [r.name, r.type, r.method, r.checkInTime, r.contact]
          .map(val => `"${String(val).replace(/"/g, '""')}"`)
          .join(',')
      );

      const csv = [csvHeaders, ...csvRows].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(csv);
    }

    if (format !== 'pdf') {
      return res.status(400).json({ error: 'Invalid export format' });
    }

    // PDF generation - stream directly to response
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
    doc.pipe(res);

    // Title
    doc.fontSize(18).font('Helvetica-Bold').text('Attendance Report', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(event.title, { align: 'center' });
    doc.fontSize(10).text(
      `${new Date(event.startDate).toLocaleDateString()} — ${new Date(event.endDate).toLocaleDateString()}`,
      { align: 'center' }
    );
    doc.moveDown(0.5);

    // Summary stats
    doc.fontSize(10).font('Helvetica-Bold').text('Summary');
    doc.font('Helvetica').fontSize(9);
    doc.text(`Total Check-Ins: ${stats.total}    Members: ${stats.members}    Guests: ${stats.guests}    QR: ${stats.qrCheckIns}    Manual: ${stats.manualCheckIns}`);
    doc.moveDown(1);

    // Table
    const headers = ['Name', 'Type', 'Method', 'Check-In Time', 'Contact'];
    const colWidths = [180, 70, 80, 170, 180];
    const tableLeft = 30;
    const rowHeight = 20;

    let y = doc.y;

    const drawHeaderRow = () => {
      doc.fontSize(9).font('Helvetica-Bold');
      doc.rect(tableLeft, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill('#f4f4f4').stroke('#dddddd');
      doc.fillColor('#000000');
      let x = tableLeft + 5;
      headers.forEach((header, i) => {
        doc.text(header, x, y + 5, { width: colWidths[i] - 10, lineBreak: false });
        x += colWidths[i];
      });
      y += rowHeight;
      doc.font('Helvetica').fontSize(8);
    };

    drawHeaderRow();

    resolvedRecords.forEach((r, rowIndex) => {
      if (y + rowHeight > doc.page.height - 30) {
        doc.addPage({ size: 'A4', layout: 'landscape', margin: 30 });
        y = 30;
        drawHeaderRow();
      }

      const bgColor = rowIndex % 2 === 0 ? '#f9f9f9' : '#ffffff';
      doc.rect(tableLeft, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill(bgColor).stroke('#dddddd');
      doc.fillColor('#000000');

      const rowData = [r.name, r.type, r.method, r.checkInTime, r.contact];
      let x = tableLeft + 5;
      rowData.forEach((cell, i) => {
        doc.text(cell, x, y + 5, { width: colWidths[i] - 10, lineBreak: false });
        x += colWidths[i];
      });
      y += rowHeight;
    });

    doc.end();
  } catch (error) {
    console.error('Error exporting event attendance:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
    });
    res.status(500).json({
      error: 'Failed to export attendance report',
      details: error.message
    });
  }
};

export const deleteAttendanceRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const record = await AttendanceRecord.findOneAndDelete({ _id: id, organizationId: req.organizationId });

    if (!record) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    res.json({ message: 'Attendance record deleted successfully' });
  } catch (error) {
    console.error('Error deleting attendance record:', error);
    res.status(500).json({ error: 'Failed to delete attendance record' });
  }
};

export default {
  getAllAttendance,
  getAttendanceById,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  deleteAttendanceRecord,
  getAttendanceStats,
  checkInWithQR,
  getEventAttendanceRecords,
  manualCheckIn,
  exportEventAttendance,
};
