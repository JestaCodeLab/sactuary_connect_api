import Attendance from '../models/Attendance.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import Event from '../models/Event.js';
import Member from '../models/Member.js';
import { branchFilter, resolveCreateBranch } from '../utils/branchQuery.js';

export const getAllAttendance = async (req, res) => {
  try {
    const records = await Attendance.find(branchFilter(req))
      .populate('eventId', 'title eventType')
      .sort({ date: -1 });
    res.json(records);
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
    const stats = await Attendance.aggregate([
      { $match: branchFilter(req) },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalPresent: { $sum: '$totalPresent' },
          totalAbsent: { $sum: '$totalAbsent' },
        },
      },
      {
        $project: {
          _id: 0,
          totalRecords: 1,
          totalPresent: 1,
          totalAbsent: 1,
          averageRate: {
            $cond: [
              { $eq: [{ $add: ['$totalPresent', '$totalAbsent'] }, 0] },
              0,
              {
                $round: [
                  {
                    $multiply: [
                      { $divide: ['$totalPresent', { $add: ['$totalPresent', '$totalAbsent'] }] },
                      100,
                    ],
                  },
                  1,
                ],
              },
            ],
          },
        },
      },
    ]);

    const lastRecord = await Attendance.findOne(branchFilter(req)).sort({ date: -1 });

    res.json({
      ...(stats[0] || { totalRecords: 0, averageRate: 0, totalPresent: 0, totalAbsent: 0 }),
      lastAttendance: lastRecord ? lastRecord.totalPresent : 0,
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
