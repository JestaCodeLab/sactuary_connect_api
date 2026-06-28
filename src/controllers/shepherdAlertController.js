import ShepherdAlert from '../models/ShepherdAlert.js';
import ShepherdAlertLog from '../models/ShepherdAlertLog.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import Member from '../models/Member.js';
import smsService from '../services/smsService.js';

/**
 * Get all shepherd alerts for an organization
 */
export const getShepherdAlerts = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { branchId, isActive } = req.query;

    const filter = { organizationId };
    if (branchId) filter.branchId = branchId;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const alerts = await ShepherdAlert.find(filter)
      .populate('shepherds.memberId', 'firstName lastName phone')
      .sort({ createdAt: -1 });

    res.json(alerts);
  } catch (error) {
    console.error('Error fetching shepherd alerts:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get a single shepherd alert by ID
 */
export const getShepherdAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user;

    const alert = await ShepherdAlert.findOne({
      _id: id,
      organizationId,
    })
      .populate('shepherds.memberId', 'firstName lastName phone');

    if (!alert) {
      return res.status(404).json({ error: 'Shepherd alert not found' });
    }

    res.json({ alert });
  } catch (error) {
    console.error('Error fetching shepherd alert:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Create a new shepherd alert
 */
export const createShepherdAlert = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const {
      name,
      shepherds,
      absenceThreshold = 3,
      lookbackPeriodDays = 30,
      branchId,
    } = req.body;

    // Validate required fields
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Alert name is required' });
    }

    if (!shepherds || shepherds.length === 0) {
      return res.status(400).json({ error: 'At least one shepherd must be notified' });
    }

    if (absenceThreshold < 1 || absenceThreshold > 10) {
      return res.status(400).json({ error: 'Absence threshold must be between 1 and 10' });
    }

    // Verify shepherd members exist
    const shepherdMembers = await Member.find({
      _id: { $in: shepherds.map(s => s.memberId) },
      organizationId,
    });

    if (shepherdMembers.length !== shepherds.length) {
      return res.status(400).json({ error: 'Some specified shepherds do not exist' });
    }

    // Create alert (monitors all members)
    const alert = new ShepherdAlert({
      organizationId,
      branchId,
      name,
      shepherds,
      absenceThreshold,
      lookbackPeriodDays,
    });

    await alert.save();
    await alert.populate('shepherds.memberId', 'firstName lastName phone');

    res.status(201).json({ alert });
  } catch (error) {
    console.error('Error creating shepherd alert:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Update a shepherd alert
 */
export const updateShepherdAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user;
    const updates = req.body;

    // Validate absence threshold if provided
    if (updates.absenceThreshold !== undefined) {
      if (updates.absenceThreshold < 1 || updates.absenceThreshold > 10) {
        return res.status(400).json({ error: 'Absence threshold must be between 1 and 10' });
      }
    }

    // Verify shepherds if provided
    if (updates.shepherds) {
      const shepherdIds = updates.shepherds.map(s => s.memberId);

      if (shepherdIds.length > 0) {
        const members = await Member.find({
          _id: { $in: shepherdIds },
          organizationId,
        });

        if (members.length !== shepherdIds.length) {
          return res.status(400).json({ error: 'Some specified shepherds do not exist' });
        }
      }
    }

    const alert = await ShepherdAlert.findOneAndUpdate(
      { _id: id, organizationId },
      updates,
      { new: true }
    )
      .populate('shepherds.memberId', 'firstName lastName phone');

    if (!alert) {
      return res.status(404).json({ error: 'Shepherd alert not found' });
    }

    res.json({ alert });
  } catch (error) {
    console.error('Error updating shepherd alert:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Delete a shepherd alert
 */
export const deleteShepherdAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user;

    const alert = await ShepherdAlert.findOneAndDelete({
      _id: id,
      organizationId,
    });

    if (!alert) {
      return res.status(404).json({ error: 'Shepherd alert not found' });
    }

    res.json({ message: 'Shepherd alert deleted successfully' });
  } catch (error) {
    console.error('Error deleting shepherd alert:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Toggle shepherd alert active status
 */
export const toggleShepherdAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user;

    const alert = await ShepherdAlert.findOne({ _id: id, organizationId });

    if (!alert) {
      return res.status(404).json({ error: 'Shepherd alert not found' });
    }

    alert.isActive = !alert.isActive;
    await alert.save();

    res.json({ alert });
  } catch (error) {
    console.error('Error toggling shepherd alert:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Run a shepherd alert check (manually trigger)
 */
export const runShepherdAlertCheck = async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user;

    const alert = await ShepherdAlert.findOne({
      _id: id,
      organizationId,
    })
      .populate('shepherds.memberId');

    if (!alert) {
      return res.status(404).json({ error: 'Shepherd alert not found' });
    }

    if (!alert.isActive) {
      return res.status(400).json({ error: 'Cannot run an inactive alert' });
    }

    const logs = await executeShepherdAlertCheck(alert, organizationId);

    res.json({ 
      logs,
      summary: {
        totalChecked: logs.length,
        triggered: logs.filter(l => l.triggerred).length,
        smsSent: logs.filter(l => l.smsSent).length,
      }
    });
  } catch (error) {
    console.error('Error running shepherd alert check:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get alert history/logs
 */
export const getShepherdAlertLogs = async (req, res) => {
  try {
    const { organizationId } = req.user;
    const { shepherdAlertId, memberId, triggered } = req.query;

    const filter = { organizationId };
    if (shepherdAlertId) filter.shepherdAlertId = shepherdAlertId;
    if (memberId) filter.memberId = memberId;
    if (triggered !== undefined) filter.triggerred = triggered === 'true';

    const logs = await ShepherdAlertLog.find(filter)
      .populate('shepherdAlertId', 'name')
      .populate('memberId', 'firstName lastName')
      .populate('eventId', 'name')
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ logs });
  } catch (error) {
    console.error('Error fetching shepherd alert logs:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Helper function to execute a shepherd alert check
 * Counts absences per member per event and triggers SMS if threshold is met
 */
async function executeShepherdAlertCheck(alert, organizationId) {
  const logs = [];
  const lookbackStart = new Date();
  lookbackStart.setDate(lookbackStart.getDate() - alert.lookbackPeriodDays);

  try {
    // Get ALL members in the organization
    const allMembers = await Member.find({
      organizationId,
    }).lean();

    // For each member, count recent absences
    for (const member of allMembers) {
      // Get all events in the lookback period where this member was marked as present
      const attendanceCount = await AttendanceRecord.countDocuments({
        memberId: member._id,
        createdAt: { $gte: lookbackStart },
      });

      // Get all events in the lookback period (should be much larger than attendance)
      const totalEventsInPeriod = await AttendanceRecord.countDocuments({
        createdAt: { $gte: lookbackStart },
      });

      // Calculate absences (approximate)
      const absenceCount = Math.max(0, totalEventsInPeriod - attendanceCount);

      // Create log entry
      const log = new ShepherdAlertLog({
        organizationId,
        shepherdAlertId: alert._id,
        memberId: member._id,
        memberName: `${member.firstName} ${member.lastName}`,
        memberPhone: member.phone,
        absenceCount,
        absenceThreshold: alert.absenceThreshold,
        lookbackPeriodDays: alert.lookbackPeriodDays,
        checkPeriodStart: lookbackStart,
        checkPeriodEnd: new Date(),
      });

      // Check if threshold is met
      if (absenceCount >= alert.absenceThreshold) {
        log.triggerred = true;

        // Send SMS to each shepherd
        const smsResults = [];
        for (const shepherd of alert.shepherds) {
          try {
            const smsResult = await smsService.sendShepherdAlertSms(
              shepherd.phoneNumber,
              `${member.firstName} ${member.lastName}`,
              absenceCount,
              alert.lookbackPeriodDays,
              organizationId
            );

            smsResults.push({
              memberId: shepherd.memberId,
              phoneNumber: shepherd.phoneNumber,
              status: smsResult.success ? 'sent' : 'failed',
            });

            if (smsResult.success) {
              log.smsSent = true;
              log.smsReference = smsResult.reference;
            } else {
              console.warn(`Failed to send shepherd alert SMS: ${smsResult.error}`);
            }
          } catch (shepherdError) {
            console.error(`Error sending SMS to shepherd ${shepherd.phoneNumber}:`, shepherdError);
            smsResults.push({
              memberId: shepherd.memberId,
              phoneNumber: shepherd.phoneNumber,
              status: 'failed',
            });
          }
        }

        log.recipientsNotified = smsResults;
      }

      await log.save();
      logs.push(log);
    }

    // Update last check time
    alert.lastCheckAt = new Date();
    alert.totalAlertsTriggered += logs.filter(l => l.triggerred).length;
    alert.smsSentCount += logs.filter(l => l.smsSent).length;
    await alert.save();

    return logs;
  } catch (error) {
    console.error('Error executing shepherd alert check:', error);
    throw error;
  }
}

export default {
  getShepherdAlerts,
  getShepherdAlert,
  createShepherdAlert,
  updateShepherdAlert,
  deleteShepherdAlert,
  toggleShepherdAlert,
  runShepherdAlertCheck,
  getShepherdAlertLogs,
};
