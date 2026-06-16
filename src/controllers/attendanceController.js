import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';
import Attendance from '../models/Attendance.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import Event from '../models/Event.js';
import Member from '../models/Member.js';
import ServiceCode from '../models/ServiceCode.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';
import { getNextOccurrence, getCurrentOccurrence } from '../utils/occurrenceHelper.js';
import { normalizePhone, findMemberByPhone } from '../utils/phoneUtils.js';
import { serviceCodeService } from '../services/serviceCodeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORTS_DIR = path.join(__dirname, '../../exports');

export const getAllAttendance = async (req, res) => {
  try {
    // Get recent individual check-ins (last 50) grouped by event
    const recentCheckIns = await AttendanceRecord.find(branchFilter(req))
      .populate('eventId', 'title startDate eventType')
      .populate('memberId', 'firstName lastName')
      .populate('userId', 'firstName lastName')
      .sort({ checkInTime: -1 })
      .limit(50);

    // Group by event and count
    const eventMap = new Map();
    
    recentCheckIns.forEach(record => {
      const eventId = record.eventId?._id?.toString();
      if (!eventId) return;
      
      if (!eventMap.has(eventId)) {
        eventMap.set(eventId, {
          eventId: record.eventId._id,
          eventTitle: record.eventId.title,
          eventDate: record.eventId.startDate,
          eventType: record.eventId.eventType,
          checkIns: [],
          totalCheckIns: 0,
          members: 0,
          guests: 0,
          qrCheckIns: 0,
        });
      }
      
      const event = eventMap.get(eventId);
      event.totalCheckIns++;
      event.checkIns.push(record);
      
      if (record.memberId) event.members++;
      if (record.checkInMethod === 'guest') event.guests++;
      if (record.checkInMethod === 'qr') event.qrCheckIns++;
    });

    const groupedRecords = Array.from(eventMap.values())
      .sort((a, b) => new Date(b.eventDate).getTime() - new Date(a.eventDate).getTime())
      .slice(0, 20); // Return top 20 events

    res.json(groupedRecords);
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Failed to fetch attendance records' });
  }
};

export const getAttendanceById = async (req, res) => {
  try {
    const { id } = req.params;
    const record = await Attendance.findById(id)
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
    updates.updatedAt = Date.now();

    const record = await Attendance.findByIdAndUpdate(id, updates, { new: true })
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
    const record = await Attendance.findByIdAndDelete(id);

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

    const resolvedMemberId = memberId || (matchedMember ? matchedMember._id : null);

    if (resolvedMemberId || userId) {
      existingCheckIn = await AttendanceRecord.findOne({
        ...duplicateFilter,
        $or: [
          resolvedMemberId ? { memberId: resolvedMemberId } : null,
          userId ? { userId } : null,
        ].filter(Boolean),
      });
    } else if (phone) {
      existingCheckIn = await AttendanceRecord.findOne({
        ...duplicateFilter,
        phone: normalizePhone(phone),
        checkInMethod: 'guest',
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
    } else if (userId) {
      checkInData.userId = userId;
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

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Resolve occurrence date for recurring events
    let occurrenceDate = null;
    if (event.isRecurring) {
      if (reqOccurrenceDate) {
        occurrenceDate = new Date(reqOccurrenceDate);
      } else {
        const occ = getCurrentOccurrence(event) || getNextOccurrence(event);
        occurrenceDate = occ ? occ.startDate : null;
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

    const resolvedMemberId = memberId || (matchedMember ? matchedMember._id : null);

    if (resolvedMemberId || userId) {
      const existingCheckIn = await AttendanceRecord.findOne({
        ...duplicateFilter,
        $or: [
          resolvedMemberId ? { memberId: resolvedMemberId } : null,
          userId ? { userId } : null,
        ].filter(Boolean),
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
    } else if (userId) {
      checkInData.userId = userId;
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

    const event = await Event.findById(eventId);
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

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(csv);
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
    const record = await AttendanceRecord.findByIdAndDelete(id);

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
