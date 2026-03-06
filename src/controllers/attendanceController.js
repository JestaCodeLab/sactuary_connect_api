import Attendance from '../models/Attendance.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import Event from '../models/Event.js';
import Member from '../models/Member.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';

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
    const { token, memberId, userId, name, email, phone } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'QR token is required' });
    }

    // Find event by QR token
    const event = await Event.findOne({ 'qrCode.token': token });

    if (!event) {
      return res.status(404).json({ error: 'Invalid QR code' });
    }

    // Check if QR code is expired
    if (event.qrCode.expiresAt && new Date() > new Date(event.qrCode.expiresAt)) {
      return res.status(410).json({ error: 'QR code has expired' });
    }

    // Check if event has started
    if (new Date() < new Date(event.startDate)) {
      return res.status(400).json({ 
        error: 'Check-in is not yet available. This event has not started yet.',
        startDate: event.startDate 
      });
    }

    // Check if already checked in
    let existingCheckIn = null;
    
    if (memberId || userId) {
      existingCheckIn = await AttendanceRecord.findOne({
        eventId: event._id,
        $or: [
          memberId ? { memberId } : null,
          userId ? { userId } : null,
        ].filter(Boolean),
      });
    } else if (email) {
      // For guests, check by email to prevent duplicate check-ins
      existingCheckIn = await AttendanceRecord.findOne({
        eventId: event._id,
        email: email,
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

    if (memberId) {
      checkInData.memberId = memberId;
    } else if (userId) {
      checkInData.userId = userId;
    } else {
      // Guest check-in via QR code
      checkInData.name = name;
      checkInData.email = email;
      checkInData.phone = phone;
    }

    const record = await AttendanceRecord.create(checkInData);
    const populated = await record.populate([
      { path: 'memberId', select: 'firstName lastName email' },
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

    const records = await AttendanceRecord.find({ eventId })
      .populate('memberId', 'firstName lastName email phone')
      .populate('userId', 'firstName lastName email')
      .sort({ checkInTime: -1 });

    const stats = {
      total: records.length,
      members: records.filter(r => r.memberId).length,
      users: records.filter(r => r.userId).length,
      guests: records.filter(r => r.checkInMethod === 'guest').length,
      qrCheckIns: records.filter(r => r.checkInMethod === 'qr').length,
      manualCheckIns: records.filter(r => r.checkInMethod === 'manual').length,
    };

    res.json({ records, stats });
  } catch (error) {
    console.error('Error fetching event attendance records:', error);
    res.status(500).json({ error: 'Failed to fetch attendance records' });
  }
};

export const manualCheckIn = async (req, res) => {
  try {
    const { eventId, memberId, userId, name, email, phone, notes } = req.body;

    if (!eventId) {
      return res.status(400).json({ error: 'Event ID is required' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check if already checked in
    const existingCheckIn = await AttendanceRecord.findOne({
      eventId,
      $or: [
        memberId ? { memberId } : null,
        userId ? { userId } : null,
      ].filter(Boolean),
    });

    if (existingCheckIn) {
      return res.status(400).json({ 
        error: 'Already checked in',
        checkInTime: existingCheckIn.checkInTime,
      });
    }

    const checkInData = {
      organizationId: event.organizationId,
      branchId: event.branchId,
      eventId,
      checkInMethod: 'manual',
      checkInTime: new Date(),
      notes,
    };

    if (memberId) {
      checkInData.memberId = memberId;
    } else if (userId) {
      checkInData.userId = userId;
    } else {
      checkInData.checkInMethod = 'guest';
      checkInData.name = name;
      checkInData.email = email;
      checkInData.phone = phone;
    }

    const record = await AttendanceRecord.create(checkInData);
    const populated = await record.populate([
      { path: 'memberId', select: 'firstName lastName email' },
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

export default {
  getAllAttendance,
  getAttendanceById,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  getAttendanceStats,
  checkInWithQR,
  getEventAttendanceRecords,
  manualCheckIn,
};
