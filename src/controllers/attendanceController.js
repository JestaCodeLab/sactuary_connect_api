import Attendance from '../models/Attendance.js';
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

export default {
  getAllAttendance,
  getAttendanceById,
  createAttendance,
  updateAttendance,
  deleteAttendance,
  getAttendanceStats,
};
