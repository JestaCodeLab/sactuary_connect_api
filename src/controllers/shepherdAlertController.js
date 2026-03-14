import ShepherdAlert from '../models/ShepherdAlert.js';
import ShepherdAlertLog from '../models/ShepherdAlertLog.js';
import Event from '../models/Event.js';
import AttendanceRecord from '../models/AttendanceRecord.js';
import Member from '../models/Member.js';
import SmsCredit from '../models/SmsCredit.js';
import Transaction from '../models/Transaction.js';
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
      .populate('monitoredEventIds', 'name date')
      .populate('alertRecipients.memberId', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json({ alerts });
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
      .populate('monitoredEventIds', 'name date')
      .populate('alertRecipients.memberId', 'firstName lastName phone');

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
      description,
      monitoredEventIds,
      alertRecipients,
      absenceThreshold = 3,
      lookbackPeriodDays = 30,
      smsTemplate,
      checkSchedule = 'weekly',
      checkDayOfWeek = 5,
      branchId,
    } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Alert name is required' });
    }

    if (!monitoredEventIds || monitoredEventIds.length === 0) {
      return res.status(400).json({ error: 'At least one event must be monitored' });
    }

    if (!alertRecipients || alertRecipients.length === 0) {
      return res.status(400).json({ error: 'At least one alert recipient is required' });
    }

    if (absenceThreshold < 1 || absenceThreshold > 10) {
      return res.status(400).json({ error: 'Absence threshold must be between 1 and 10' });
    }

    // Verify events exist and belong to organization
    const events = await Event.find({
      _id: { $in: monitoredEventIds },
      organizationId,
    });

    if (events.length !== monitoredEventIds.length) {
      return res.status(400).json({ error: 'Some specified events do not exist' });
    }

    // Create alert
    const alert = new ShepherdAlert({
      organizationId,
      branchId: branchId || null,
      name,
      description,
      monitoredEventIds,
      alertRecipients,
      absenceThreshold,
      lookbackPeriodDays,
      smsTemplate,
      checkSchedule,
      checkDayOfWeek,
    });

    await alert.save();
    await alert.populate('monitoredEventIds', 'name date');
    await alert.populate('alertRecipients.memberId', 'firstName lastName');

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

    // Verify events if provided
    if (updates.monitoredEventIds) {
      const events = await Event.find({
        _id: { $in: updates.monitoredEventIds },
        organizationId,
      });

      if (events.length !== updates.monitoredEventIds.length) {
        return res.status(400).json({ error: 'Some specified events do not exist' });
      }
    }

    const alert = await ShepherdAlert.findOneAndUpdate(
      { _id: id, organizationId },
      updates,
      { new: true }
    )
      .populate('monitoredEventIds', 'name date')
      .populate('alertRecipients.memberId', 'firstName lastName');

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
    }).populate('monitoredEventIds');

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
    // Get all monitored events
    const events = await Event.find({
      _id: { $in: alert.monitoredEventIds },
    });

    // For each event, check member attendance
    for (const event of events) {
      // Get all attendance records for this event in lookback period
      const attendanceRecords = await AttendanceRecord.find({
        eventId: event._id,
        createdAt: { $gte: lookbackStart },
      }).lean();

      // Get all members who should have attended
      const allMembers = await Member.find({
        organizationId,
      }).lean();

      for (const member of allMembers) {
        // Count absences for this member at this event
        const attendedCount = attendanceRecords.filter(
          r => r.memberId && r.memberId.toString() === member._id.toString()
        ).length;

        const possibleCount = attendanceRecords.filter(
          r => r.eventId.toString() === event._id.toString()
        ).length;

        const absenceCount = Math.max(0, possibleCount - attendedCount);

        // Create log entry
        const log = new ShepherdAlertLog({
          organizationId,
          shepherdAlertId: alert._id,
          memberId: member._id,
          memberName: `${member.firstName} ${member.lastName}`,
          memberPhone: member.phone,
          eventId: event._id,
          eventName: event.name,
          absenceCount,
          absenceThreshold: alert.absenceThreshold,
          lookbackPeriodDays: alert.lookbackPeriodDays,
          checkPeriodStart: lookbackStart,
          checkPeriodEnd: new Date(),
        });

        // Check if threshold is met
        if (absenceCount >= alert.absenceThreshold) {
          log.triggerred = true;

          // Send SMS to alert recipients
          try {
            const smsMessage = alert.smsTemplate
              .replace('{memberName}', `${member.firstName} ${member.lastName}`)
              .replace('{eventName}', event.name)
              .replace('{absenceCount}', absenceCount)
              .replace('{lookbackPeriodDays}', alert.lookbackPeriodDays);

            log.smsMessage = smsMessage;
            log.smsAttempted = true;

            // Send to each recipient
            const smsResults = [];
            for (const recipient of alert.alertRecipients) {
              try {
                const smsResult = await smsService.sendSms(recipient.phoneNumber, smsMessage, organizationId);
                smsResults.push({
                  memberId: recipient.memberId,
                  phoneNumber: recipient.phoneNumber,
                  status: smsResult.success ? 'sent' : 'failed',
                });

                if (smsResult.success) {
                  log.smsSent = true;
                  log.smsReference = smsResult.reference;

                  // Deduct SMS credit
                  const smsCredit = await SmsCredit.getOrCreate(organizationId);
                  await smsCredit.deductCredits(1);

                  // Record transaction
                  await new Transaction({
                    organizationId,
                    type: 'shepherd_alert_sms',
                    direction: 'outflow',
                    amount: 0, // SMS already tracked in SmsCredit
                    description: `SMS for Shepherd Alert: ${alert.name} - ${member.firstName} ${member.lastName}`,
                    relatedModel: 'ShepherdAlertLog',
                    relatedModelId: log._id,
                    metadata: {
                      alertId: alert._id,
                      memberId: member._id,
                      eventId: event._id,
                    },
                  }).save();
                }
              } catch (recipientError) {
                console.error(
                  `Error sending SMS to ${recipient.phoneNumber}:`,
                  recipientError
                );
                smsResults.push({
                  memberId: recipient.memberId,
                  phoneNumber: recipient.phoneNumber,
                  status: 'failed',
                });
              }
            }

            log.recipientsNotified = smsResults;
          } catch (smsError) {
            console.error('Error processing SMS for shepherd alert:', smsError);
            log.error = smsError.message;
          }
        }

        await log.save();
        logs.push(log);
      }
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
